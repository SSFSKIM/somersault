import { describe, expect, it } from "vitest";
import { classifyToolEvent, foldClauses, segmentRuns, type FoldAtom, type FoldClass, type GroupCounts } from "../../src/tui/toolFold.js";
import { recognizeGitOps } from "../../src/tui/gitOps.js";
import type { ToolEvent } from "../../src/tui/transcriptModel.js";

const OPTIONS = { cwd: "/repo", home: "/home/u" };
let nextSequence = 0;
/** `settled` false leaves the call in flight (no `result`), `"error"` settles it as an error — R5.2 says neither
 *  changes a count. `resultSequence` defaults to `callSequence + 1000`, which puts EVERY call's result after every
 *  other call — i.e. models a fully concurrent turn. Any cell that cares which of two calls settled first (the
 *  pop-out window test) must state both endpoints itself; the default cannot tell concurrent from sequential. */
function tool(name: string, input: unknown, options: { id?: string; sequence?: number; result?: number; settled?: boolean | "error"; output?: string; sidecar?: unknown } = {}): ToolEvent {
  const callSequence = options.sequence ?? ++nextSequence, id = options.id ?? `tool-${callSequence}`, settled = options.settled ?? true;
  const resultSequence = options.result ?? callSequence + 1000;
  return { id, name, input, callSequence, route: "top-level", ...(settled === false ? {} : { result: { content: options.output ?? "ok", isError: settled === "error", resultSequence, ...(options.sidecar === undefined ? {} : { sidecar: { scope: "call" as const, value: options.sidecar } }) } }) };
}
const atom = (event: ToolEvent): FoldAtom => ({ kind: "tool", event });
const counts = (over: Partial<GroupCounts> = {}): GroupCounts => ({ readCount: 0, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [], ...over });
const texts = (list: readonly { text: string }[]) => list.map((c) => c.text);
const joined = (list: readonly { text: string }[]) => texts(list).join(", ");

describe("F1 fold classifier (R1.1–R1.3)", () => {
  it("classifies the three always-collapsible native tools", () => {
    expect(classifyToolEvent({ name: "Read", input: { file_path: "/repo/a.ts" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Glob", input: { pattern: "**/*.ts" } })).toEqual({ collapsible: true, kind: "search" });
    expect(classifyToolEvent({ name: "Grep", input: { pattern: "todo" } })).toEqual({ collapsible: true, kind: "search" });
  });
  it("classifies any mcp__ tool as an MCP call, ahead of every other rule", () => {
    expect(classifyToolEvent({ name: "mcp__github__list_issues", input: {} })).toEqual({ collapsible: true, kind: "mcp" });
    expect(classifyToolEvent({ name: "mcp__x__Read", input: { file_path: "/repo/a.ts" } })).toEqual({ collapsible: true, kind: "mcp" });
  });
  it("renders every non-read/search tool standalone", () => {
    for (const name of ["Edit", "Write", "NotebookEdit", "Agent", "Task", "TodoWrite", "SomeUnknownTool"])
      expect(classifyToolEvent({ name, input: { file_path: "/repo/a.ts" } })).toEqual({ collapsible: false });
  });
  it("classifies a Bash command by the head word of every statement", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "grep -r x src" } })).toEqual({ collapsible: true, kind: "search" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat a | head" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "ls -la" } })).toEqual({ collapsible: true, kind: "list" });
  });
  it("lets the ignored word set decide nothing at all", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "echo hi" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "echo start && cat a" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: ":" } })).toEqual({ collapsible: false });
  });
  it("lets one foreign head word poison the whole command", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "ls && npm test" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "npm test" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat a > b; rm b" } })).toEqual({ collapsible: false });
  });
  it("glues a redirection to its statement instead of splitting on its `&`/`|`", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat a 2>&1" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat a &>out" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat a >|out" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat f <&3" } })).toEqual({ collapsible: true, kind: "read" });
  });
  it("keeps a LEADING redirect in the statement, so it becomes the head word", () => {
    // Not a bug: upstream's parser puts leading redirects inside the `command` node (2.1.220 L141080), so `OE` never
    // drops them and the head word is the redirect itself. Confirmed by parsing each of these with the real
    // tree-sitter-bash 0.25.1 grammar, which agrees (`command` allows `repeat(choice(variable_assignment, redirect))`
    // before the name) — all three arrive as ONE statement and classify as nothing.
    expect(classifyToolEvent({ name: "Bash", input: { command: "2>/dev/null rg x" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: ">out cat f" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "2> /dev/null cat f" } })).toEqual({ collapsible: false });
  });
  it("still separates on a real `&&`, background `&` and `|&`", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "grep x f 2>/dev/null && npm test" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "sleep 1 & cat f" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "ls |& wc -l" } })).toEqual({ collapsible: true, kind: "list" });
  });
  it("prefers list over search over read when one command is several kinds", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "ls | wc -l" } })).toEqual({ collapsible: true, kind: "list" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "grep x a | wc -l" } })).toEqual({ collapsible: true, kind: "search" });
  });
  it("never splits inside quotes, substitutions or subshells", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "grep 'a && b' src" } })).toEqual({ collapsible: true, kind: "search" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat $(ls | head -1)" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "(ls; cat a)" } })).toEqual({ collapsible: false });
  });
  it("drops a heredoc body instead of reading statements out of it", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<EOF\npayload with npm test words\nEOF" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<-EOF\n\tnpm test\n\tEOF" } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<'EOF'\n$x npm test\nEOF" } })).toEqual({ collapsible: true, kind: "read" });
  });
  it("keeps splitting after a heredoc terminator, and swallows an unterminated body", () => {
    // `grep` still lands as its own statement, so read AND search are both set and search wins the kind.
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<EOF\nbody\nEOF\ngrep x f" } })).toEqual({ collapsible: true, kind: "search" });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<EOF\nbody\nEOF\nnpm test" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<EOF\nbody" } })).toEqual({ collapsible: true, kind: "read" });
  });
  it("takes a quoted heredoc delimiter verbatim, with no escape processing", () => {
    // Upstream's lexer copies quoted delimiter content character for character (L141310–141314): a backslash inside
    // `'…'` is part of the terminator word, and `<<\EOF` quotes only the character right after the backslash.
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<'E\\zOF'\nbody\nE\\zOF\nnpm test" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<\\EOF\nbody\nEOF\nnpm test" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "cat <<'EOF'\nlog 2>&1\nrun && npm test\nEOF" } })).toEqual({ collapsible: true, kind: "read" });
  });
  it("falls back to the whole command as one statement for a delimiter upstream refuses to scan", () => {
    // A double-quoted delimiter holding ` $ \ or a newline aborts the parse (L141326), as does a word that stopped on
    // a character it cannot end on (`E"OF"`); `parse()` then returns null and `OE` yields the WHOLE command as one
    // statement (L359731–359733). Only its first word decides — `cat` still folds as a read, `npm` still poisons.
    expect(classifyToolEvent({ name: "Bash", input: { command: 'cat <<"\\$EOF"\nbody\n$EOF\nnpm test' } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: 'cat <<"E\\zOF"\nbody\nE\\zOF\nnpm test' } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: 'cat <<"E\\"OF"\nbody\nE"OF\nnpm test' } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: 'cat <<E"OF"\nbody\nEOF\nnpm test' } })).toEqual({ collapsible: true, kind: "read" });
    expect(classifyToolEvent({ name: "Bash", input: { command: 'npm run x <<"$E"\nbody\nls' } })).toEqual({ collapsible: false });
  });
  it("never mistakes a herestring for a heredoc", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "wc -l <<<hi; npm test" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "wc -l <<<hi" } })).toEqual({ collapsible: true, kind: "read" });
  });
  it("drops comments and blank statements", () => {
    expect(classifyToolEvent({ name: "Bash", input: { command: "# look around\nls -la\n" } })).toEqual({ collapsible: true, kind: "list" });
  });
  it("treats a Bash call with no string command as standalone", () => {
    expect(classifyToolEvent({ name: "Bash", input: {} })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: { command: "" } })).toEqual({ collapsible: false });
    expect(classifyToolEvent({ name: "Bash", input: undefined })).toEqual({ collapsible: false });
  });
});

describe("F1 fold counters (R1.4–R1.5)", () => {
  const group = (atoms: readonly FoldAtom[]) => {
    const items = segmentRuns(atoms, OPTIONS), first = items[0];
    if (first?.kind !== "group") throw new Error("expected a group");
    return first.group;
  };
  it("dedupes path-bearing reads by path", () => {
    expect(group([atom(tool("Read", { file_path: "/repo/a.ts" })), atom(tool("Read", { file_path: "/repo/a.ts" }))]).counts.readCount).toBe(1);
    expect(group([atom(tool("Read", { file_path: "/repo/a.ts" })), atom(tool("Read", { file_path: "/repo/b.ts" }))]).counts.readCount).toBe(2);
  });
  it("discards the operation count entirely once any path-bearing read exists", () => {
    expect(group([atom(tool("Read", { file_path: "/repo/a.ts" })), atom(tool("Bash", { command: "cat b" }))]).counts.readCount).toBe(1);
  });
  it("counts path-less reads as operations", () => {
    expect(group([atom(tool("Bash", { command: "cat a" })), atom(tool("Bash", { command: "cat b" }))]).counts.readCount).toBe(2);
    expect(group([atom(tool("Read", { path: "/repo/a.ts" }))]).counts.readCount).toBe(1);
  });
  it("counts searches, lists and MCP calls with their server names", () => {
    const g = group([atom(tool("Grep", { pattern: "todo" })), atom(tool("Glob", { pattern: "**/*" })), atom(tool("Bash", { command: "ls" })),
      atom(tool("mcp__github__list_issues", {})), atom(tool("mcp__github__get_issue", {})), atom(tool("mcp__linear__search", {}))]);
    expect(g.counts).toMatchObject({ searchCount: 2, listCount: 1, mcpCallCount: 3, mcpServerNames: ["github", "linear"], readCount: 0 });
  });
  it("keeps counting an errored call (R5.2)", () => {
    expect(group([atom(tool("Read", { file_path: "/repo/a.ts" }, { settled: "error" })), atom(tool("Read", { file_path: "/repo/b.ts" }))]).counts.readCount).toBe(2);
  });
});

describe("F1 fold hints (R4.7–R4.8)", () => {
  const hintOf = (atoms: readonly FoldAtom[]) => { const first = segmentRuns(atoms, OPTIONS)[0]; return first?.kind === "group" ? first.group.hint : undefined; };
  it("uses the display path of a read, latest wins", () => {
    expect(hintOf([atom(tool("Read", { file_path: "/repo/src/a.ts" })), atom(tool("Read", { file_path: "/elsewhere/b.ts" }))])).toBe("/elsewhere/b.ts");
    expect(hintOf([atom(tool("Read", { file_path: "/repo/src/a.ts" }))])).toBe("src/a.ts");
    expect(hintOf([atom(tool("Read", { file_path: "/home/u/notes.md" }))])).toBe("~/notes.md");
  });
  it("wraps a search pattern in double quotes", () => expect(hintOf([atom(tool("Grep", { pattern: "todo" }))])).toBe('"todo"'));
  it("renders a shell command as a collapsed $ line", () => {
    expect(hintOf([atom(tool("Bash", { command: "ls   -la" }))])).toBe("$ ls -la");
    expect(hintOf([atom(tool("Bash", { command: "cat a\n\n   cat b  " }))])).toBe("$ cat a\ncat b");
  });
  it("truncates a long command to 300 characters including the ellipsis", () => {
    const hint = hintOf([atom(tool("Bash", { command: `cat ${"x".repeat(500)}` }))]) ?? "";
    expect(hint).toHaveLength(300); expect(hint.endsWith("…")).toBe(true);
  });
});

describe("F1 run segmentation (R1.8)", () => {
  it("folds a single collapsible call", () => {
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 4 }))], OPTIONS);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "group", group: { anchorSequence: 4, open: false, memberIds: ["tool-4"] } });
  });
  it("splits two runs on real assistant text and emits each group at its first member", () => {
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 })), atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 2 })),
      { kind: "breaker", sequence: 3 }, atom(tool("Read", { file_path: "/repo/c.ts" }, { sequence: 4 }))], OPTIONS);
    expect(items.map((i) => i.kind)).toEqual(["group", "passthrough", "group"]);
    expect(items[0]).toMatchObject({ group: { anchorSequence: 1, counts: { readCount: 2 } } });
    expect(items[1]).toEqual({ kind: "passthrough", sequence: 3 });
    expect(items[2]).toMatchObject({ group: { anchorSequence: 4, counts: { readCount: 1 } } });
  });
  it("never breaks a run on a neutral atom, and replays it after the group", () => {
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 })), { kind: "neutral", sequence: 2 },
      atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 3 }))], OPTIONS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "group", group: { anchorSequence: 1, counts: { readCount: 2 }, memberIds: ["tool-1", "tool-3"] } });
    expect(items[1]).toEqual({ kind: "passthrough", sequence: 2 });
  });
  it("passes a neutral atom straight through when no run is open", () => {
    expect(segmentRuns([{ kind: "neutral", sequence: 1 }, { kind: "breaker", sequence: 2 }], OPTIONS))
      .toEqual([{ kind: "passthrough", sequence: 1 }, { kind: "passthrough", sequence: 2 }]);
  });
  it("flushes on a non-collapsible tool and emits it standalone", () => {
    const edit = tool("Edit", { file_path: "/repo/a.ts" }, { sequence: 2 });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 })), atom(edit), atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 3 }))], OPTIONS);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool", "group"]);
    expect(items[1]).toEqual({ kind: "tool", event: edit });
  });
  it("marks a run open when any member is still in flight", () => {
    const open = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 })), atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 2, settled: false }))], OPTIONS);
    expect(open[0]).toMatchObject({ kind: "group", group: { open: true } });
    const settled = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1, settled: "error" }))], OPTIONS);
    expect(settled[0]).toMatchObject({ kind: "group", group: { open: false } });
  });
  it("returns nothing for no atoms", () => expect(segmentRuns([], OPTIONS)).toEqual([]));
});

// F3 Task 3: the pending-thought buffer. Upstream `PMd` (bundle L302266–302272) pushes the thinking
// message itself INTO the open accumulator and adds `min(Δt, rRo)` to its `thoughtForMs`, so the thought
// belongs to whatever run is being accumulated at that moment and dies with the next flush. Our groups
// are tool runs (a thought-only group has no members and is never emitted), so the equivalent is a HELD
// contribution: applied at once to a run already open, buffered for the run that starts next, and
// dropped by the very flushes that end upstream's accumulator — a breaker AND a standalone tool.
describe("F3 thought attachment (upstream Ae_/PMd, cap rRo = 600000)", () => {
  const thought = (sequence: number, ms: number, summary?: string): FoldAtom =>
    ({ kind: "neutral", sequence, thoughtForMs: ms, ...(summary === undefined ? {} : { thinkingSummary: summary }) });
  const firstGroup = (atoms: readonly FoldAtom[]) => { const first = segmentRuns(atoms, OPTIONS).find((i) => i.kind === "group"); return first?.kind === "group" ? first.group : undefined; };

  it("attaches a held thought to the run that STARTS after it, as the first clause", () => {
    const group = firstGroup([thought(1, 3200), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 2 })), atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 3 }))]);
    expect(group?.counts).toMatchObject({ thoughtForMs: 3200, readCount: 2 });
    expect(joined(foldClauses(group!.counts, false))).toBe("Thought for 3s, read 2 files");
  });

  it("attaches to a run that is ALREADY open", () => {
    const group = firstGroup([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 })), thought(2, 5000), atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 3 }))]);
    expect(group?.counts).toMatchObject({ thoughtForMs: 5000, readCount: 2 });
  });

  it("keeps the thought on the run it was open for when a breaker closes that run", () => {
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 })), thought(2, 4000), { kind: "breaker", sequence: 3 },
      atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 4 }))], OPTIONS);
    // The neutral atom is replayed straight after the group it interrupted (upstream's deferred buffer),
    // so the breaker's own passthrough is third and the run it opens is fourth.
    expect(items.map((i) => i.kind)).toEqual(["group", "passthrough", "passthrough", "group"]);
    expect(items[0]).toMatchObject({ kind: "group", group: { counts: { thoughtForMs: 4000 } } });
    expect(items[3]).toMatchObject({ kind: "group", group: { counts: { readCount: 1 } } });
    expect((items[3] as { group: { counts: GroupCounts } }).group.counts.thoughtForMs).toBeUndefined();
  });

  it("DISCARDS a buffered thought on a breaker", () => {
    const group = firstGroup([thought(1, 9000), { kind: "breaker", sequence: 2 }, atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 3 }))]);
    expect(group?.counts.thoughtForMs).toBeUndefined();
    expect(joined(foldClauses(group!.counts, false))).toBe("Read 1 file");
  });

  it("DISCARDS a buffered thought on a standalone (non-collapsible) tool, upstream's other flush", () => {
    const items = segmentRuns([thought(1, 9000), atom(tool("Edit", { file_path: "/repo/a.ts" }, { sequence: 2 })), atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 3 }))], OPTIONS);
    expect(items.map((i) => i.kind)).toEqual(["passthrough", "tool", "group"]);
    expect((items[2] as { group: { counts: GroupCounts } }).group.counts.thoughtForMs).toBeUndefined();
  });

  it("renders nothing at all for a thought with no following run", () => {
    const items = segmentRuns([thought(1, 12000)], OPTIONS);
    expect(items).toEqual([{ kind: "passthrough", sequence: 1 }]);
  });

  it("sums consecutive thoughts and caps EACH contribution at 600000 ms", () => {
    const group = firstGroup([thought(1, 900000), thought(2, 1500), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 3 }))]);
    expect(group?.counts.thoughtForMs).toBe(601500);
  });

  it("ignores a neutral atom carrying no (or a zero) duration", () => {
    expect(firstGroup([{ kind: "neutral", sequence: 1 }, atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 2 }))])?.counts.thoughtForMs).toBeUndefined();
    expect(firstGroup([thought(1, 0), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 2 }))])?.counts.thoughtForMs).toBeUndefined();
  });

  it("carries the LATEST thinking summary onto the group (Task 4 consumes it)", () => {
    const group = firstGroup([thought(1, 1000, "checking the config"), thought(2, 1000, "now reading it"), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 3 }))]);
    expect(group?.latestThinkingSummary).toBe("now reading it");
    expect(firstGroup([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 }))])?.latestThinkingSummary).toBeUndefined();
  });
});

// TS Task 3: the fullscreen fold-policy widening (canon 2.1.234). Two axes are pinned in every cell — what the
// CLASSIC renderer returns (frozen, A9's model-level guard) and what the FULLSCREEN renderer returns — because the
// whole widening is an `opts.fullscreen` gate and a regression that leaks into classic is the one failure this
// wave cannot ship.
describe("TS fullscreen fold policy — classification (canon 2.1.234 Krr 236807–236816)", () => {
  const FULL = { fullscreen: true } as const;
  /** [tool name, input, classic result, fullscreen result] */
  const TABLE: readonly [string, unknown, FoldClass, FoldClass][] = [
    // Bash: `isBash: !l && c` (236816) — bash-kind ONLY when the command is not read-ish, so every read-ish
    // classification still wins and its counter stays exactly where canon puts it.
    ["Bash", { command: "npm run build" }, { collapsible: false }, { collapsible: true, kind: "bash" }],
    ["Bash", { command: "git status" }, { collapsible: false }, { collapsible: true, kind: "bash" }],
    ["Bash", { command: "cat a.ts" }, { collapsible: true, kind: "read" }, { collapsible: true, kind: "read" }],
    ["Bash", { command: "grep -r x src" }, { collapsible: true, kind: "search" }, { collapsible: true, kind: "search" }],
    ["Bash", { command: "ls -la" }, { collapsible: true, kind: "list" }, { collapsible: true, kind: "list" }],
    // An ignored-word-only command decides nothing (`l` false), so `!l && c` still makes it bash under fullscreen.
    ["Bash", { command: "echo hi" }, { collapsible: false }, { collapsible: true, kind: "bash" }],
    // 237153 bumps `bashCount` BEFORE destructuring `input.command`, so a command-less Bash is still a bash member.
    ["Bash", {}, { collapsible: false }, { collapsible: true, kind: "bash" }],
    // PowerShell is the SECOND name in canon's bash-tool list `ipe = [_i, js]` (169942 → 82177 / 82198), so it
    // takes the same `isBash` and the same command recording. Its read-ish half is canon's own `oJS`
    // (346523–346550) over cmdlet sets (346735) with `xw`'s alias resolution (344447 / 230900) — `cat` and `ls`
    // are aliases of Get-Content / Get-ChildItem, a bare `npm` is nothing, and there is no list kind at all.
    ["PowerShell", { command: "npm run build" }, { collapsible: false }, { collapsible: true, kind: "bash" }],
    ["PowerShell", { command: "get-content a.ts" }, { collapsible: false }, { collapsible: true, kind: "read" }],
    ["PowerShell", { command: "cat a.ts" }, { collapsible: false }, { collapsible: true, kind: "read" }],
    ["PowerShell", { command: "Select-String todo" }, { collapsible: false }, { collapsible: true, kind: "search" }],
    // `Get-ChildItem` is in BOTH cmdlet sets and in neither list set: canon reports search+read and no list, so
    // `PMd`'s branch order lands it on search — never on the `list` kind Bash's `ls` takes.
    ["PowerShell", { command: "ls" }, { collapsible: false }, { collapsible: true, kind: "search" }],
    ["PowerShell", { command: "write-host hi" }, { collapsible: false }, { collapsible: true, kind: "bash" }],
    // `iE = "ToolSearch"` is fullscreen-only and takes `popsOutOnError: o`, which is false for it (236807–236809).
    ["ToolSearch", {}, { collapsible: false }, { collapsible: true, kind: "silent", popsOutOnError: false }],
    // `Joi` (236734) — the five board tools, all `popsOutOnError: true`.
    ["TodoWrite", { todos: [] }, { collapsible: false }, { collapsible: true, kind: "silent", popsOutOnError: true }],
    ["TaskCreate", {}, { collapsible: false }, { collapsible: true, kind: "silent", popsOutOnError: true }],
    ["TaskGet", {}, { collapsible: false }, { collapsible: true, kind: "silent", popsOutOnError: true }],
    ["TaskUpdate", {}, { collapsible: false }, { collapsible: true, kind: "silent", popsOutOnError: true }],
    ["TaskList", {}, { collapsible: false }, { collapsible: true, kind: "silent", popsOutOnError: true }],
    // Deliberate NON-widening: canon never collapses the web tools, and intuition ("a fetch is a read") is wrong.
    ["WebFetch", { url: "https://x" }, { collapsible: false }, { collapsible: false }],
    ["WebSearch", { query: "x" }, { collapsible: false }, { collapsible: false }],
    ["Write", { file_path: "/repo/a.ts" }, { collapsible: false }, { collapsible: false }],
    ["Edit", { file_path: "/repo/a.ts" }, { collapsible: false }, { collapsible: false }],
    ["NotebookEdit", { notebook_path: "/repo/a.ipynb" }, { collapsible: false }, { collapsible: false }],
    ["Agent", {}, { collapsible: false }, { collapsible: false }],
    ["Task", {}, { collapsible: false }, { collapsible: false }],
    ["SomeUnknownTool", {}, { collapsible: false }, { collapsible: false }],
    // Unchanged by the widening — the three always-collapsible natives and MCP return before any new arm.
    ["Read", { file_path: "/repo/a.ts" }, { collapsible: true, kind: "read" }, { collapsible: true, kind: "read" }],
    ["Glob", { pattern: "**/*.ts" }, { collapsible: true, kind: "search" }, { collapsible: true, kind: "search" }],
    ["Grep", { pattern: "todo" }, { collapsible: true, kind: "search" }, { collapsible: true, kind: "search" }],
    ["mcp__github__list_issues", {}, { collapsible: true, kind: "mcp" }, { collapsible: true, kind: "mcp" }],
  ];
  it.each(TABLE)("classifies %s under both renderers", (name, input, classic, fullscreen) => {
    expect(classifyToolEvent({ name, input })).toEqual(classic);
    expect(classifyToolEvent({ name, input }, {})).toEqual(classic);
    expect(classifyToolEvent({ name, input }, { fullscreen: false })).toEqual(classic);
    expect(classifyToolEvent({ name, input }, FULL)).toEqual(fullscreen);
  });
});

describe("TS fullscreen fold policy — segmentation (canon 2.1.234 iNp 237140–237210)", () => {
  const FULL = { ...OPTIONS, fullscreen: true };
  const groups = (items: readonly ReturnType<typeof segmentRuns>[number][]) =>
    items.flatMap((i) => (i.kind === "group" ? [i.group] : []));

  it("absorbs a bash call and a silent call into ONE run with the reads", () => {
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 })),
      atom(tool("Bash", { command: "git status" }, { sequence: 2 })), atom(tool("TodoWrite", { todos: [] }, { sequence: 3 }))], FULL);
    expect(items).toHaveLength(1);
    const group = groups(items)[0]!;
    expect(group.memberIds).toEqual(["tool-1", "tool-2", "tool-3"]);
    expect(group.counts).toMatchObject({ readCount: 1, bashCount: 1, searchCount: 0, listCount: 0, mcpCallCount: 0 });
  });
  it("keeps a read-ish bash out of bashCount (canon 236816 `!l && c`)", () => {
    const items = segmentRuns([atom(tool("Bash", { command: "cat a" }, { sequence: 1 })), atom(tool("Bash", { command: "npm test" }, { sequence: 2 }))], FULL);
    expect(groups(items)[0]!.counts).toMatchObject({ readCount: 1, bashCount: 1 });
  });
  it("records EVERY bash command by tool-use id for the T4 scraper (237152)", () => {
    const items = segmentRuns([atom(tool("Bash", { command: "git commit -m x" }, { sequence: 1 })), atom(tool("Bash", { command: "cat a" }, { sequence: 2 })),
      atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 3 }))], FULL);
    expect([...groups(items)[0]!.bashCommands!]).toEqual([["tool-1", "git commit -m x"], ["tool-2", "cat a"]]);
  });
  it("records a PowerShell command too — canon's bash-tool list is two names (169942)", () => {
    const items = segmentRuns([atom(tool("PowerShell", { command: "git commit -m x" }, { sequence: 1 })), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 2 }))], FULL);
    expect(groups(items)[0]!.counts).toMatchObject({ readCount: 1, bashCount: 1 });
    expect([...groups(items)[0]!.bashCommands!]).toEqual([["tool-1", "git commit -m x"]]);
  });
  // NB this cell pins SEGMENTATION only. It builds fold atoms directly, so it does NOT exercise the `foldAtoms`
  // suppression gate that decides whether a ToolSearch ever becomes a `tool` atom in the first place — the
  // projection still diverts the three `isSuppressedTool` names to `neutral` unless `fullscreen` is set. That gate
  // is owed a test at the projection level (Task 5, which switches the projection over); nothing here can fail if
  // it regresses.
  it("lets a silently-absorbed call OPEN a run and own its anchor (addendum §A.1)", () => {
    const items = segmentRuns([atom(tool("ToolSearch", { query: "x" }, { sequence: 1 })), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 2 }))], FULL);
    const group = groups(items)[0]!;
    expect(group.memberIds).toEqual(["tool-1", "tool-2"]);
    expect(group.anchorSequence).toBe(1);
    expect(group.counts.readCount).toBe(1);
  });
  it("emits NO group for a run whose every member is silent (deliberate divergence from 518513)", () => {
    expect(segmentRuns([atom(tool("TodoWrite", { todos: [] }, { sequence: 1 })), atom(tool("ToolSearch", {}, { sequence: 2 }))], FULL)).toEqual([]);
  });
  // The relocate/stay discriminator is a WINDOW test on sequences (spec §3.1, round 5): canon asks whether
  // anything else was pushed into the accumulator between the silent call's own message and the arrival of its
  // error result, and the exact translation is "does any other atom's call or result sequence fall strictly
  // inside `(callSequence, resultSequence)`". Every cell below therefore states BOTH endpoints of every call —
  // a fixture that lets the default `callSequence + 1000` stand makes the whole turn concurrent and cannot tell
  // the four orderings apart.
  it("(a) RELOCATES an errored silent call out when nothing landed inside its result window", () => {
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 3, result: 4, settled: "error" });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1, result: 2 })), atom(todo)], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool"]);
    expect(groups(items)[0]!.memberIds).toEqual(["tool-1"]);
    expect(items[1]).toEqual({ kind: "tool", event: todo });
  });
  it("(b) KEEPS an errored silent call inside when a same-batch sibling was issued before its error result", () => {
    // The sibling's CALL (4) lands inside the window (3, 6) — canon's `o.messages.at(-1)` is that sibling's
    // assistant message, not ours, so the relocation branch is never taken and the run merely closes. The call
    // KEEPS its membership, and still earns the standalone row every branch of 237198–237210 pushes (round 6).
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 3, result: 6, settled: "error" });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1, result: 2 })), atom(todo),
      atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 4, result: 7 }))], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool", "group"]);
    expect(groups(items)[0]!.memberIds).toEqual(["tool-1", "tool-3"]);
    expect(items[1]).toEqual({ kind: "tool", event: todo });
    expect(groups(items)[1]!.memberIds).toEqual(["tool-4"]);
  });
  it("(c) RELOCATES when the follow-on call was issued only AFTER the error result arrived", () => {
    // A one-atom lookahead sees a collapsible next atom and keeps the failure folded away; the window (3, 4) is
    // empty, so canon relocates and the failed board write earns its own row.
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 3, result: 4, settled: "error" });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1, result: 2 })), atom(todo),
      atom(tool("Read", { file_path: "/repo/b.ts" }, { sequence: 5, result: 6 }))], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool", "group"]);
    expect(groups(items)[0]!.memberIds).toEqual(["tool-1"]);
    expect(items[1]).toEqual({ kind: "tool", event: todo });
    expect(groups(items)[1]!.memberIds).toEqual(["tool-5"]);
  });
  it("(d) KEEPS an errored silent call inside when a concurrent sibling's result landed FIRST", () => {
    // Atom order is result order, so the sibling precedes the errored call and no lookahead can see it — but its
    // call (2) AND its result (3) both sit inside the window (1, 5). Canon's last message is then that absorbed
    // `tool_result`, for which `Pka` returns `[]` (236929) and the relocation is refused.
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 1, result: 5, settled: "error" });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 2, result: 3 })), atom(todo)], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool"]);
    expect(groups(items)[0]!.memberIds).toEqual(["tool-2", "tool-1"]);
    expect(items[1]).toEqual({ kind: "tool", event: todo });
  });
  it("(e) RELOCATES when the only thing after the error is a thought", () => {
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 3, result: 4, settled: "error" });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1, result: 2 })), atom(todo),
      { kind: "neutral", sequence: 2, messageSequence: 5, thoughtForMs: 4000 }], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool", "passthrough"]);
    expect(items[1]).toEqual({ kind: "tool", event: todo });
  });
  it("(f) REFUSES the relocation for a same-message sibling that did NOT error (round 6, canon 237200)", () => {
    // Every `tool_use` block of one assistant entry carries the SAME `callSequence` (transcriptModel :186), so a
    // sibling sits exactly ON the window's lower edge and a strictly-inside scan cannot see it. Canon does, via
    // `f.every((g) => m.has(g))`: the batch relocates only if EVERY tool_use of that message errored. Here the
    // sibling read succeeded, so the errored board write keeps its membership.
    const todo = tool("TodoWrite", { todos: [] }, { id: "todo", sequence: 2, result: 5, settled: "error" });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { id: "read", sequence: 2, result: 6 })), atom(todo)], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool"]);
    expect(groups(items)[0]!.memberIds).toEqual(["read", "todo"]);
    expect(items[1]).toEqual({ kind: "tool", event: todo });
  });
  it("(g) ALLOWS it when that same-message sibling errored too — and pins the window's exclusive endpoints", () => {
    // The mirror of (f): every tool_use of the message errored, so canon pops the whole message and we relocate.
    // This is also the ONLY cell that defends strict-inside: widen `inside` to `>= from && <= to` and the sibling's
    // own `callSequence` (2 === from) starts blocking, which puts `todo` back in `memberIds` and fails here.
    const todo = tool("TodoWrite", { todos: [] }, { id: "todo", sequence: 2, result: 5, settled: "error" });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { id: "read", sequence: 2, result: 6, settled: "error" })), atom(todo)], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool"]);
    expect(groups(items)[0]!.memberIds).toEqual(["read"]);
    expect(items[1]).toEqual({ kind: "tool", event: todo });
  });
  it("gives an errored silent call its own row even when it STAYS in a cluster that IS emitted (round 6)", () => {
    // The commonest ordering, and the one the round-5 wording left open: the read's result (4) lands inside the
    // window (2, 6) so the relocation is refused, the run has a visible member so the group renders — and canon's
    // `n.push(c)` (237210, outside the if/else) still puts the failed board write on screen.
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 2, result: 6, settled: "error" });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1, result: 4 })), atom(todo)], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool"]);
    expect(groups(items)[0]!.counts.readCount).toBe(1);
    expect(groups(items)[0]!.memberIds).toEqual(["tool-1", "tool-2"]);
    expect(items[1]).toEqual({ kind: "tool", event: todo });
  });
  it("never swallows an errored silent call whose group is suppressed (spec §3.1, round 5)", () => {
    // The exact hole: relocation refused (the sibling read was issued inside the window), and the run has no
    // visible member to carry a group. Both rules together must still leave the failure on screen.
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 1, result: 4, settled: "error" });
    const items = segmentRuns([atom(todo), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 2, result: 5 }))], FULL);
    expect(items.map((i) => i.kind)).toEqual(["tool", "group"]);
    expect(items[0]).toEqual({ kind: "tool", event: todo });
    expect(groups(items)[0]!.memberIds).toEqual(["tool-2"]);
  });
  it("never leaks a thought held for a popped-out call into the NEXT run", () => {
    // The pop can empty `memberIds` before the flush, and a flush that returns early without resetting the
    // accumulator carries its `thoughtForMs` forward — a later group would speak a clause it never earned.
    const items = segmentRuns([{ kind: "neutral", sequence: 0, messageSequence: 1, thoughtForMs: 5000 },
      atom(tool("TodoWrite", { todos: [] }, { sequence: 2, result: 3, settled: "error" })),
      atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 4, result: 5 }))], FULL);
    expect(items.map((i) => i.kind)).toEqual(["passthrough", "tool", "group"]);
    expect(groups(items)[0]!.counts.thoughtForMs).toBeUndefined();
  });
  it("never lets a pop-out shift an already-formed run's anchor (spec invariant over canon)", () => {
    const items = segmentRuns([atom(tool("TodoWrite", { todos: [] }, { sequence: 1, result: 2 })), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 3, result: 4 })),
      atom(tool("TaskUpdate", {}, { sequence: 5, result: 6, settled: "error" }))], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group", "tool"]);
    expect(groups(items)[0]!.memberIds).toEqual(["tool-1", "tool-3"]);
    expect(groups(items)[0]!.anchorSequence).toBe(1);
  });
  it("renders a lone errored silent call standalone with no cluster at all (canon 237204–237206)", () => {
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 1, result: 2, settled: "error" });
    expect(segmentRuns([atom(todo)], FULL)).toEqual([{ kind: "tool", event: todo }]);
  });
  it("never pops out ToolSearch, whose popsOutOnError is false", () => {
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1, result: 2 })), atom(tool("ToolSearch", {}, { sequence: 3, result: 4, settled: "error" }))], FULL);
    expect(items.map((i) => i.kind)).toEqual(["group"]);
    expect(groups(items)[0]!.memberIds).toEqual(["tool-1", "tool-3"]);
  });
  it("leaves CLASSIC segmentation of the same atoms exactly as it ships today", () => {
    const todo = tool("TodoWrite", { todos: [] }, { sequence: 3 }), bash = tool("Bash", { command: "git status" }, { sequence: 2 });
    const items = segmentRuns([atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 1 })), atom(bash), atom(todo)], OPTIONS);
    expect(items).toEqual([{ kind: "group", group: expect.objectContaining({ memberIds: ["tool-1"] }) }, { kind: "tool", event: bash }, { kind: "tool", event: todo }]);
    const group = groups(items)[0]!;
    expect(group.counts.bashCount).toBeUndefined();
    expect(group.bashCommands).toBeUndefined();
  });
  it("records NO bash commands on a classic run, even for the read-ish Bash it does absorb", () => {
    const items = segmentRuns([atom(tool("Bash", { command: "cat a" }, { sequence: 1 }))], OPTIONS);
    expect(groups(items)[0]!.bashCommands).toBeUndefined();
    expect(groups(items)[0]!.counts).toEqual({ readCount: 1, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [] });
  });
});

describe("F1 fold clauses (R3.8 + §3.4)", () => {
  it("capitalizes only the first clause and keeps counts bold", () => {
    expect(foldClauses(counts({ readCount: 2 }), false)).toEqual([{ text: "Read 2 files", boldRanges: [[5, 6]] }]);
    expect(joined(foldClauses(counts({ searchCount: 1, readCount: 2 }), false))).toBe("Searched for 1 pattern, read 2 files");
    expect(foldClauses(counts({ searchCount: 1, readCount: 2 }), false)[1]).toEqual({ text: "read 2 files", boldRanges: [[5, 6]] });
  });
  it("orders search, read, list, then mcp", () => {
    expect(texts(foldClauses(counts({ readCount: 1, searchCount: 1, listCount: 1, mcpCallCount: 1, mcpServerNames: ["github"] }), false)))
      .toEqual(["Searched for 1 pattern", "read 1 file", "listed 1 directory", "called github"]);
  });
  it("uses present-participle verbs while active", () => {
    expect(joined(foldClauses(counts({ readCount: 2 }), true))).toBe("Reading 2 files");
    expect(joined(foldClauses(counts({ searchCount: 3, listCount: 2, mcpCallCount: 1, mcpServerNames: ["github"] }), true)))
      .toBe("Searching for 3 patterns, listing 2 directories, calling github");
  });
  it("pluralizes each noun exactly", () => {
    expect(joined(foldClauses(counts({ searchCount: 2 }), false))).toBe("Searched for 2 patterns");
    expect(joined(foldClauses(counts({ readCount: 1 }), false))).toBe("Read 1 file");
    expect(joined(foldClauses(counts({ listCount: 1 }), false))).toBe("Listed 1 directory");
    expect(joined(foldClauses(counts({ listCount: 4 }), false))).toBe("Listed 4 directories");
  });
  it("builds the MCP clause from server names", () => {
    expect(foldClauses(counts({ mcpCallCount: 1, mcpServerNames: ["github"] }), false)).toEqual([{ text: "Called github", boldRanges: [] }]);
    expect(foldClauses(counts({ mcpCallCount: 3, mcpServerNames: ["github", "claude.ai slack"] }), false))
      .toEqual([{ text: "Called github, slack 3 times", boldRanges: [[21, 22]] }]);
    expect(joined(foldClauses(counts({ mcpCallCount: 2, mcpServerNames: [] }), false))).toBe("Called MCP 2 times");
  });
  it("puts a thought clause first, always capitalized, with a bold duration", () => {
    expect(foldClauses(counts({ thoughtForMs: 90000, readCount: 1 }), false))
      .toEqual([{ text: "Thought for 1m 30s", boldRanges: [[12, 18]] }, { text: "read 1 file", boldRanges: [[5, 6]] }]);
    expect(joined(foldClauses(counts({ thoughtForMs: 500 }), true))).toBe("Thinking for 1s");
    expect(foldClauses(counts({ thoughtForMs: 0, readCount: 1 }), false)).toEqual([{ text: "Read 1 file", boldRanges: [[5, 6]] }]);
  });
  it("emits nothing for all-zero counts", () => expect(foldClauses(counts(), false)).toEqual([]));
});

// ── TS Task 4 ────────────────────────────────────────────────────────────────────────────────────────────────
// The git-operation scraper (canon `vFr` 194436–194473, driven by `odS` 236993–237019) and the fullscreen half of
// the clause chain (518574–518626). Recognition inputs are quoted from T1's addendum §B.3, not re-derived.
const COMMIT_OUT = "[main abc123f] wire the fold\n 1 file changed, 4 insertions(+)";
const PUSH_OUT = "To github.com:o/r.git\n   abc1234..def5678  main -> main\n";
const PR_URL_OUT = "https://github.com/owner/repo/pull/12\n";

describe("TS git-op recognition (canon vFr 194436–194473)", () => {
  it("recognizes a commit and takes the sha and branch off the `[branch sha]` line", () => {
    expect(recognizeGitOps("git commit -m x", COMMIT_OUT)).toEqual({ commit: { sha: "abc123f", kind: "committed", branch: "main" } });
  });
  it("accepts canon's `-c k=v` / `-C dir` / `--opt=val` prefixes between `git` and the subcommand (SFr 194291)", () => {
    for (const cmd of ["git -C /repo commit -m x", "git -c user.name=me commit -m x", "git --git-dir=/r/.git commit -m x"])
      expect(recognizeGitOps(cmd, COMMIT_OUT).commit?.sha).toBe("abc123f");
  });
  it("reads a detached-HEAD and a root commit (l6b 194649)", () => {
    expect(recognizeGitOps("git commit -m x", "[detached HEAD 1234abcd] x")).toEqual({ commit: { sha: "1234abcd", kind: "committed" } });
    expect(recognizeGitOps("git commit -m x", "[main (root-commit) abc1234] x").commit).toEqual({ sha: "abc1234", kind: "committed", branch: "main" });
  });
  it("normalises ANSI erase/column escapes and CRs before matching (zpp 194391)", () => {
    expect(recognizeGitOps("git commit -m x", "\x1b[2K\x1b[1G[main abc1234] x").commit?.sha).toBe("abc1234");
  });
  it("classifies `--amend` as an amended commit", () => {
    expect(recognizeGitOps("git commit --amend --no-edit", COMMIT_OUT).commit?.kind).toBe("amended");
  });
  it("DEPARTURE from canon: the `--amend` test runs on the quote-stripped command (spec §3.1)", () => {
    // Canon tests `/--amend\b/` against the RAW command (194441) while `Pya` tests its flags against the
    // quote-stripped one (194294) — so canon misreads this as an amend. We strip consistently.
    expect(recognizeGitOps('git commit -m "revert the --amend"', COMMIT_OUT).commit?.kind).toBe("committed");
  });
  it("classifies a cherry-pick, which outranks the amend test", () => {
    expect(recognizeGitOps("git cherry-pick abc1234", COMMIT_OUT).commit?.kind).toBe("cherry-picked");
    expect(recognizeGitOps("git cherry-pick --amend abc1234", COMMIT_OUT).commit?.kind).toBe("cherry-picked");
  });
  it("recognizes NO commit when the output carries no `[branch sha]` line", () => {
    expect(recognizeGitOps("git commit -m x", "nothing to commit, working tree clean")).toEqual({});
  });
  it("recognizes a push from the `-> ref` line, updated or brand new (Gpp 194650)", () => {
    expect(recognizeGitOps("git push origin main", PUSH_OUT)).toEqual({ push: { branch: "main" } });
    expect(recognizeGitOps("git push -u origin feature", "To g:o/r.git\n * [new branch]      feature -> feature\n")).toEqual({ push: { branch: "feature" } });
  });
  it("refuses a dry-run push, and only inside the push argument segment (xya + Dya 194416)", () => {
    expect(recognizeGitOps("git push --dry-run origin main", PUSH_OUT)).toEqual({});
    expect(recognizeGitOps("git push -n origin main", PUSH_OUT)).toEqual({});
    // `-n` after the `&&` belongs to another statement, so `Dya`'s first segment never sees it.
    expect(recognizeGitOps("git push origin main && echo -n done", PUSH_OUT)).toEqual({ push: { branch: "main" } });
  });
  it("recognizes a merge only on canon's two output shapes, and never `git merge-base` (X5b 194645)", () => {
    expect(recognizeGitOps("git merge feature", "Fast-forward\n a | 1 +")).toEqual({ branch: { ref: "feature", action: "merged" } });
    expect(recognizeGitOps("git merge feature", "Merge made by the 'ort' strategy.")).toEqual({ branch: { ref: "feature", action: "merged" } });
    expect(recognizeGitOps("git merge feature", "Already up to date.")).toEqual({});
    expect(recognizeGitOps("git merge-base main dev", "Fast-forward")).toEqual({});
  });
  it("recognizes a rebase and lets it overwrite a merge in the shared branch slot (194456)", () => {
    expect(recognizeGitOps("git rebase main", "Successfully rebased and updated refs/heads/f.")).toEqual({ branch: { ref: "main", action: "rebased" } });
    expect(recognizeGitOps("git merge x && git rebase main", "Fast-forward\nSuccessfully rebased and updated refs/heads/f."))
      .toEqual({ branch: { ref: "main", action: "rebased" } });
  });
  it("takes the first BARE token after the subcommand as the ref, skipping flags and stopping at a redirect ($pp 194423)", () => {
    expect(recognizeGitOps("git merge --no-ff feature", "Fast-forward").branch?.ref).toBe("feature");
    expect(recognizeGitOps("git merge > out.txt", "Fast-forward")).toEqual({});
  });
  it("recognizes every `gh pr` verb canon lists, in declaration order (Iya 194645)", () => {
    const verbs: readonly (readonly [string, string])[] = [["create", "created"], ["edit", "edited"], ["merge", "merged"], ["comment", "commented"], ["close", "closed"], ["reopen", "reopened"], ["ready", "ready"]];
    for (const [sub, action] of verbs)
      expect(recognizeGitOps(`gh pr ${sub} 12`, PR_URL_OUT).pr).toEqual({ number: 12, url: "https://github.com/owner/repo/pull/12", action });
    // `Iya.find` takes the FIRST entry in declaration order, not the first occurrence in the command.
    expect(recognizeGitOps("gh pr close 12 && gh pr reopen 12", PR_URL_OUT).pr?.action).toBe("closed");
    // `gh pr review` is deliberately absent from `Iya` (194646 belongs to another consumer).
    expect(recognizeGitOps("gh pr review --approve 12", PR_URL_OUT)).toEqual({});
  });
  it("applies the two `Pya` modifier overrides against the quote-stripped command (194294)", () => {
    expect(recognizeGitOps("gh pr merge --auto 12", PR_URL_OUT).pr?.action).toBe("auto-merge-enabled");
    expect(recognizeGitOps("gh pr merge --disable-auto 12", PR_URL_OUT).pr?.action).toBe("auto-merge-disabled");
    expect(recognizeGitOps("gh pr ready --undo 12", PR_URL_OUT).pr?.action).toBe("draft");
    expect(recognizeGitOps('gh pr merge -b "land it with --auto later" 12', PR_URL_OUT).pr?.action).toBe("merged");
  });
  it("takes the LAST pr url in the output, and falls back to a bare `Pull request #N` (Oya 194370 / Vpp 194419)", () => {
    expect(recognizeGitOps("gh pr create", "https://github.com/o/r/pull/3\nhttps://github.com/o/r/pull/9\n").pr)
      .toEqual({ number: 9, url: "https://github.com/o/r/pull/9", action: "created" });
    expect(recognizeGitOps("gh pr create", "Pull request #7 created")).toEqual({ pr: { number: 7, action: "created" } });
    expect(recognizeGitOps("gh pr create", "created nothing at all")).toEqual({});
  });
  it("recognizes a commit and a push out of ONE compound command", () => {
    expect(recognizeGitOps("git commit -m x && git push origin main", COMMIT_OUT + "\n" + PUSH_OUT))
      .toEqual({ commit: { sha: "abc123f", kind: "committed", branch: "main" }, push: { branch: "main" } });
  });
});

describe("TS git-op scraping in segmentRuns (canon odS 236993–237019, call site 237212)", () => {
  const FULL = { ...OPTIONS, fullscreen: true };
  const groups = (items: readonly ReturnType<typeof segmentRuns>[number][]) => items.flatMap((i) => (i.kind === "group" ? [i.group] : []));
  const commit = (sequence: number, command = "git commit -m x", output = COMMIT_OUT) => tool("Bash", { command }, { sequence, result: sequence + 1, output });

  it("scrapes AT ABSORPTION, so the still-open trailing run already carries the sha", () => {
    const items = segmentRuns([atom(commit(1)), atom(tool("Read", { file_path: "/repo/a.ts" }, { sequence: 3, settled: false }))], FULL);
    const group = groups(items)[0]!;
    expect(group.open).toBe(true);
    expect(group.counts.commits).toEqual([{ sha: "abc123f", kind: "committed", branch: "main" }]);
  });
  it("keeps bashCount GROSS and tallies gitOpBashCount in parallel — a subtraction, never a transfer", () => {
    // The transfer bug decrements `bashCount` here; this cell then sees it become undefined (emit drops a zero),
    // and the clause suite's two-call cell sees the header lie that follows.
    const group = groups(segmentRuns([atom(commit(1))], FULL))[0]!;
    expect(group.counts.bashCount).toBe(1);
    expect(group.counts.gitOpBashCount).toBe(1);
  });
  it("bumps gitOpBashCount ONCE per result however many ops that result yielded (237016)", () => {
    const group = groups(segmentRuns([atom(commit(1, "git commit -m x && git push origin main", COMMIT_OUT + "\n" + PUSH_OUT))], FULL))[0]!;
    expect(group.counts).toMatchObject({ bashCount: 1, gitOpBashCount: 1 });
    expect(group.counts.commits).toHaveLength(1);
    expect(group.counts.pushes).toEqual([{ branch: "main" }]);
  });
  it("reports gitOpBashCount 0 for a shell run that yielded nothing (canon emits the pair, 237035)", () => {
    const group = groups(segmentRuns([atom(tool("Bash", { command: "npm test" }, { sequence: 1, result: 2 }))], FULL))[0]!;
    expect(group.counts).toMatchObject({ bashCount: 1, gitOpBashCount: 0 });
    expect(group.counts.commits).toBeUndefined();
  });
  it("scrapes an ERRORED result too — canon consults no exit code anywhere (§B.3)", () => {
    const bash = tool("Bash", { command: "git commit -m x" }, { sequence: 1, result: 2, settled: "error", output: COMMIT_OUT });
    expect(groups(segmentRuns([atom(bash)], FULL))[0]!.counts.commits).toEqual([{ sha: "abc123f", kind: "committed", branch: "main" }]);
  });
  it("scrapes nothing for a call still in flight", () => {
    const group = groups(segmentRuns([atom(tool("Bash", { command: "git commit -m x" }, { sequence: 1, settled: false }))], FULL))[0]!;
    expect(group.counts).toMatchObject({ bashCount: 1, gitOpBashCount: 0 });
    expect(group.counts.commits).toBeUndefined();
  });
  it("prefers the per-call structured sidecar's stdout+stderr over the flat content (P94)", () => {
    const bash = tool("Bash", { command: "git commit -m x" }, { sequence: 1, result: 2, output: "", sidecar: { stdout: "", stderr: COMMIT_OUT } });
    expect(groups(segmentRuns([atom(bash)], FULL))[0]!.counts.commits).toEqual([{ sha: "abc123f", kind: "committed", branch: "main" }]);
  });
  it("appends without dedup — canon's arrays are append-only, dedup lives at render (§B.5)", () => {
    const group = groups(segmentRuns([atom(commit(1)), atom(commit(3))], FULL))[0]!;
    expect(group.counts.commits).toHaveLength(2);
    expect(group.counts).toMatchObject({ bashCount: 2, gitOpBashCount: 2 });
  });
  it("never scrapes a read-ish bash command into an op (the recorded superset is inert)", () => {
    const group = groups(segmentRuns([atom(tool("Bash", { command: "cat log" }, { sequence: 1, result: 2, output: COMMIT_OUT }))], FULL))[0]!;
    expect(group.counts.readCount).toBe(1);
    expect(group.counts.commits).toBeUndefined();
  });
  it("scrapes a PowerShell git call too — both bash-tool names record commands (169942)", () => {
    const ps = tool("PowerShell", { command: "git commit -m x" }, { sequence: 1, result: 2, output: COMMIT_OUT });
    expect(groups(segmentRuns([atom(ps)], FULL))[0]!.counts.commits).toEqual([{ sha: "abc123f", kind: "committed", branch: "main" }]);
  });
  // The two end-to-end cells: real atoms in, the actual header sentence out. These are what a transfer
  // implementation makes lie — the model-level `bashCount` cell above catches the mechanism, these catch the screen.
  it("END TO END: one recognized git call speaks the commit and NO shell clause", () => {
    const group = groups(segmentRuns([atom(commit(1))], FULL))[0]!;
    expect(foldClauses(group.counts, false, { fullscreen: true }).map((c) => c.text)).toEqual(["Committed abc123f"]);
  });
  it("END TO END: one git call beside one plain shell call still says `ran 1 shell command`", () => {
    const items = segmentRuns([atom(commit(1)), atom(tool("Bash", { command: "npm test" }, { sequence: 3, result: 4 }))], FULL);
    expect(foldClauses(groups(items)[0]!.counts, false, { fullscreen: true }).map((c) => c.text)).toEqual(["Committed abc123f", "ran 1 shell command"]);
  });
  it("scrapes NOTHING under the classic renderer, which carries no git fields at all", () => {
    const items = segmentRuns([atom(commit(1)), atom(tool("Bash", { command: "cat a" }, { sequence: 3, result: 4, output: COMMIT_OUT }))], OPTIONS);
    expect(groups(items)[0]!.counts).toEqual({ readCount: 1, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [] });
  });
});

describe("TS fullscreen fold clauses (canon ZIl 518574–518626)", () => {
  const FULL = { fullscreen: true } as const;
  const full = (over: Partial<GroupCounts>, isActive = false) => foldClauses(counts(over), isActive, FULL);

  it("closes T3's empty-sentence hole: a fullscreen run of only shell calls now speaks", () => {
    expect(joined(full({ bashCount: 2, gitOpBashCount: 0 }))).toBe("Ran 2 shell commands");
    expect(foldClauses(counts({ bashCount: 1, gitOpBashCount: 0 }), false, FULL)).toEqual([{ text: "Ran 1 shell command", boldRanges: [[4, 5]] }]);
    expect(joined(full({ bashCount: 1, gitOpBashCount: 0 }, true))).toBe("Running 1 shell command");
  });
  it("makes the shell clause DISAPPEAR as its one call is recognized as a git op (518467)", () => {
    // The whole no-double-count contract in one cell: gross 1, git-op 1 ⇒ `max(0, 1 - 1)` ⇒ no shell clause.
    expect(joined(full({ bashCount: 1, gitOpBashCount: 1, commits: [{ sha: "abc123f", kind: "committed" }] }))).toBe("Committed abc123f");
  });
  it("still speaks the plain shell calls beside the git op — the SUBTRACTION cell", () => {
    // One `git commit` + one `npm test`: gross 2, git-op 1 ⇒ "ran 1 shell command". A transfer implementation
    // (decrementing `bashCount` at absorption) reports gross 1 here and drops this clause entirely.
    expect(joined(full({ bashCount: 2, gitOpBashCount: 1, commits: [{ sha: "abc123f", kind: "committed" }] })))
      .toBe("Committed abc123f, ran 1 shell command");
  });
  it("floors the subtraction at zero", () => {
    expect(joined(full({ bashCount: 1, gitOpBashCount: 3, commits: [{ sha: "abc123f", kind: "committed" }] }))).toBe("Committed abc123f");
  });
  it("buckets commits by kind in canon's fixed order with the shas joined (518575–518581)", () => {
    expect(texts(full({ commits: [{ sha: "ddd4444", kind: "cherry-picked" }, { sha: "aaa1111", kind: "committed" }, { sha: "ccc3333", kind: "amended" }, { sha: "bbb2222", kind: "committed" }] })))
      .toEqual(["Committed aaa1111, bbb2222", "amended commit ccc3333", "cherry-picked ddd4444"]);
  });
  it("keeps the git verbs fixed while the run is active — they have no present form", () => {
    expect(joined(full({ commits: [{ sha: "abc123f", kind: "committed" }], pushes: [{ branch: "main" }] }, true))).toBe("Committed abc123f, pushed to main");
  });
  it("dedups push branches and joins them (fo, 518584)", () => {
    expect(joined(full({ pushes: [{ branch: "main" }, { branch: "main" }, { branch: "dev" }] }))).toBe("Pushed to main, dev");
    expect(full({ pushes: [{ branch: "main" }] })[0]).toEqual({ text: "Pushed to main", boldRanges: [[10, 14]] });
  });
  it("gives merges and rebases one clause each (518587–518590)", () => {
    expect(texts(full({ branches: [{ ref: "feature", action: "merged" }, { ref: "main", action: "rebased" }] }))).toEqual(["Merged feature", "rebased onto main"]);
  });
  it("gives each PR its own clause, with canon's ten-verb map and the url/no-url object (518593–518595)", () => {
    expect(texts(full({ prs: [{ number: 12, url: "https://x/o/r/pull/12", action: "created" }, { number: 13, action: "commented" }, { number: 14, action: "auto-merge-enabled" }] })))
      .toEqual(["Created #12", "commented on PR #13", "enabled auto-merge on PR #14"]);
    expect(joined(full({ prs: [{ number: 1, action: "ready" }, { number: 2, action: "draft" }, { number: 3, action: "auto-merge-disabled" }] })))
      .toBe("Marked ready PR #1, marked draft PR #2, disabled auto-merge on PR #3");
  });
  it("orders the whole fullscreen sentence exactly as canon pushes its parts (518551–518626)", () => {
    expect(texts(full({
      thoughtForMs: 4000, commits: [{ sha: "a1b2c3d", kind: "committed" }, { sha: "e4f5a6b", kind: "amended" }, { sha: "c7d8e9f", kind: "cherry-picked" }],
      pushes: [{ branch: "main" }], branches: [{ ref: "dev", action: "merged" }, { ref: "trunk", action: "rebased" }], prs: [{ number: 9, action: "created" }],
      searchCount: 1, readCount: 2, listCount: 1, mcpCallCount: 1, mcpServerNames: ["github"], bashCount: 5, gitOpBashCount: 2,
    }))).toEqual([
      "Thought for 4s", "committed a1b2c3d", "amended commit e4f5a6b", "cherry-picked c7d8e9f", "pushed to main",
      "merged dev", "rebased onto trunk", "created PR #9", "searched for 1 pattern", "read 2 files", "listed 1 directory",
      "called github", "ran 3 shell commands",
    ]);
  });
  it("capitalizes whichever clause opens the sentence, git parts included", () => {
    expect(full({ pushes: [{ branch: "main" }], readCount: 1 })[0]!.text).toBe("Pushed to main");
    expect(full({ thoughtForMs: 4000, pushes: [{ branch: "main" }] })[1]!.text).toBe("pushed to main");
  });
  it("FREEZES the classic renderer: no opts, and an explicit false, speak none of it", () => {
    const over: Partial<GroupCounts> = { bashCount: 3, gitOpBashCount: 1, commits: [{ sha: "abc123f", kind: "committed" }], pushes: [{ branch: "main" }], branches: [{ ref: "dev", action: "merged" }], prs: [{ number: 9, action: "created" }], readCount: 1 };
    expect(joined(foldClauses(counts(over), false))).toBe("Read 1 file");
    expect(joined(foldClauses(counts(over), false, {}))).toBe("Read 1 file");
    expect(joined(foldClauses(counts(over), false, { fullscreen: false }))).toBe("Read 1 file");
  });
});
