import { describe, expect, it } from "vitest";
import { classifyToolEvent, foldClauses, segmentRuns, type FoldAtom, type GroupCounts } from "../../src/tui/toolFold.js";
import type { ToolEvent } from "../../src/tui/transcriptModel.js";

const OPTIONS = { cwd: "/repo", home: "/home/u" };
let nextSequence = 0;
/** `settled` false leaves the call in flight (no `result`), `"error"` settles it as an error — R5.2 says neither
 *  changes a count. */
function tool(name: string, input: unknown, options: { id?: string; sequence?: number; settled?: boolean | "error" } = {}): ToolEvent {
  const callSequence = options.sequence ?? ++nextSequence, id = options.id ?? `tool-${callSequence}`, settled = options.settled ?? true;
  return { id, name, input, callSequence, route: "top-level", ...(settled === false ? {} : { result: { content: "ok", isError: settled === "error", resultSequence: callSequence + 1000 } }) };
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
