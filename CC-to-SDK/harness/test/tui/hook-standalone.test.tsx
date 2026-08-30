// test/tui/hook-standalone.test.tsx — bl8 T-QY Task 3: canon `Qy`'s two standalone shapes (shape 1 labeled,
// shape 2 the Stop errors-only form) and the live in-progress counter `di`. Global Constraints' exact copy
// (gutters, dim/bold rules, one-decimal durations, the D21 verbose/detail gate) is verified against
// `research-hookblock.md` §A5/§A6, with ccx's own recorded divergences (D3: `hook_name` not command text;
// shape 2 scoped to errors-only, no stopReason/feedback/hint — see `stopHookItems`'s own doc comment).
//
// Row-shape correctness is proven end to end through `projectCompact`/`projectDetail` — the real production
// entry points, mirroring bl7 T-HOOKBLOCK Task 2's spec D13 discipline (a document built through a real
// `TranscriptDocument`, `hookRuns` threaded exactly as `useChat`'s `projectionContext()` does). The D21-true
// branch of the live counter is exercised directly against the exported pure builders (`hooksItemRows`/
// `hookLiveItems`) instead, because `projectPending` hardcodes `projection:"compact", verbose:false` in its
// own `full` construction and so can never itself reach that branch — see that function's own comment.
//
// The Static-lifecycle (plan-review F2) cell — two same-label pairs completing across two reconciles with a
// forced Static publish between them — lives in `test/tui/useChat.test.tsx`, beside the D20 advisor cell it
// reuses the withholding seam from; it needs the full `useChat` + `fakeRemote` harness this file has no use
// for otherwise.
import { describe, expect, it } from "vitest";
import { hookLiveItems, hooksItemRows, projectCompact, projectDetail, projectPending, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import type { RenderLine } from "../../src/tui/render.js";

const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0, expandHint: "" };
const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body") =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } }) as Record<string, unknown>;
const prose = (text: string, id = `t-${text.slice(0, 6)}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
const lineTexts = (items: readonly RenderItem[]) => items.filter((i): i is RenderItem & { kind: "line" } => i.kind === "line").map((i) => i.line.text);
const lineOf = (items: readonly RenderItem[], text: string): RenderLine =>
  (items.find((i): i is RenderItem & { kind: "line" } => i.kind === "line" && i.line.text === text) ?? (() => { throw new Error(`no line ${text}`); })()).line;

// A CLOSED cluster (call → result → a breaker) so every standalone hook entry lands BOUNDED — park-after-
// cluster, spec D12/Task 2 — never in the unbounded trailing window Task 3's own F2 discipline withholds.
// Step 1 is about the ROW SHAPE, not the Static lifecycle (that is the separate Step 3 cell, elsewhere).
const closedDoc = () => built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
const callSeq = (doc: TranscriptDocument) => doc.toolEvents()[0]!.callSequence;

describe("bl8 T-QY Task 3, shape 1 (canon Qy labeled form): standalone non-Stop hook rows", () => {
  it("2 PostToolUse entries: 'Ran 2 PostToolUse hooks' dim, count not bold, no duration; per-hook lines only outside compact/non-verbose", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [
      { id: "h1", name: "PostToolUse:Read", durationMs: 200, afterSequence: seq, event: "PostToolUse" },
      { id: "h2", name: "PostToolUse:Read", durationMs: 300, afterSequence: seq, event: "PostToolUse" },
    ];
    const compact = projectCompact(doc, { ...context, hookRuns });
    const texts = lineTexts(compact);
    expect(texts).toContain("  ⎿  Ran 2 PostToolUse hooks");
    expect(texts.some((t) => t.includes("PostToolUse:Read ("))).toBe(false);   // compact, not verbose: no per-hook lines
    const header = lineOf(compact, "  ⎿  Ran 2 PostToolUse hooks");
    expect(header.dim).toBe(true);
    expect(header.bold).toBeUndefined();

    // The D21-true branch (per-hook lines) is unreachable through `projectDetail`: detail-all/detail-
    // collapsed BYPASS the fold entirely (`projectAll`'s own `full.projection==="compact" && !full.verbose`
    // guard around `foldAnchored`), the same pre-existing constraint the expanded cluster's OWN hook block
    // lives under (`expandedMemberItems` is only ever reached through a compact-mode fold expansion too).
    // So the gate is exercised directly against the exported pure builder, exactly as the D6 live-counter
    // tests below do for the identical reason.
    const item = { label: "PostToolUse", entries: [{ id: "h1", name: "PostToolUse:Read", durationMs: 200 }, { id: "h2", name: "PostToolUse:Read", durationMs: 300 }] };
    // bl9 D10: canon has no folded-and-verbose state (verbose unfolds unconditionally, R2 @177046212);
    // compact shows NO per-hook lines regardless of the verbose flag. The extras are transcript-surface
    // (projection !== "compact") strictly.
    const verboseTexts = hooksItemRows(item, { ...context, projection: "compact", verbose: true }).map((i) => (i.kind === "line" ? i.line.text : ""));
    expect(verboseTexts.some((t) => t.includes("PostToolUse:Read ("))).toBe(false);
  });

  it("1 entry renders the singular 'hook'", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [{ id: "h1", name: "PostToolUse:Read", durationMs: 200, afterSequence: seq, event: "PostToolUse" }];
    expect(lineTexts(projectCompact(doc, { ...context, hookRuns }))).toContain("  ⎿  Ran 1 PostToolUse hook");
  });

  // Fix wave 4 (coalescing regression): two Read calls fold into ONE cluster, and each call's own raw
  // tool_use/tool_result message entries become guaranteed-empty deferred passthrough rows parked while the
  // run is open (see `FoldAtom.rendersNothing`'s doc comment, toolFold.ts). Before the fix, wave 3 gave every
  // one of those rows its own point `HookSlot`, so a PostToolUse pair stamped one at each Read's own
  // resultSequence landed at two DIFFERENT weave positions and rendered as two adjacent "Ran 1 PostToolUse
  // hook" rows instead of coalescing into one "Ran 2" row — violating the plan's same-label-in-one-drain-
  // window coalescing constraint (docs/superpowers/plans/2026-08-30-bl8-t-qy.md, Global Constraints).
  it("2 sequential Reads in one cluster: two PostToolUse entries (one per Read) still coalesce into ONE 'Ran 2' row", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"), prose("done"));
    const [read1, read2] = doc.toolEvents();
    const hookRuns = [
      { id: "h1", name: "PostToolUse:Read", durationMs: 200, afterSequence: read1!.result!.resultSequence, event: "PostToolUse" },
      { id: "h2", name: "PostToolUse:Read", durationMs: 300, afterSequence: read2!.result!.resultSequence, event: "PostToolUse" },
    ];
    const texts = lineTexts(projectCompact(doc, { ...context, hookRuns }));
    expect(texts).toContain("  ⎿  Ran 2 PostToolUse hooks");
    expect(texts.filter((t) => /Ran \d+ PostToolUse hooks?/.test(t))).toHaveLength(1);   // never two adjacent "Ran 1"s
  });
});

// Task-3 review CRITICAL: `trailingRunCut`'s second `while` loop (meant to also withhold a hooks item that
// is NOT at the tail but whose label still shows a same-label straggler in `hookLive`) was dead code — after
// the first loop, `items[cut-1]` can never be `"hooks"` again, so the second loop's own first condition
// always breaks on its first iteration. A BOUNDED item (closed by a later breaker, per `closedDoc()` above —
// no second tool call needed, since a single call/result/breaker already produces a non-trailing position,
// see the shape-1 cell above) published to Static as `Ran 1` even while its label was still live; once the
// straggler resolved and the SAME render id (`entries[0]`'s id) grew to `Ran 2`, `useChat.ts`'s
// `publishedIds` filter had already latched the stale `Ran 1` row and would never emit the correction.
describe("bl8 T-QY Task 3 review Critical: a BOUNDED hooks item withholds while its label is still live", () => {
  it("closed/bounded item stays off the finalized projection while hookLive shows the same label in flight, then finalizes as 'Ran 2' once it clears", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const h1 = { id: "h1", name: "PostToolUse:Read", durationMs: 200, afterSequence: seq, event: "PostToolUse" };
    const h2 = { id: "h2", name: "PostToolUse:Read", durationMs: 300, afterSequence: seq, event: "PostToolUse" };

    // Only h1 has completed; a same-label straggler (h2) is still in flight (hookLive: PostToolUse -> 1).
    // The item is genuinely BOUNDED (closedDoc's breaker already fixes its position, per shape-1 above) —
    // not the unbounded-trailing case the first `while` loop already covers unconditionally.
    const live = projectCompact(doc, { ...context, hookRuns: [h1], hookLive: new Map([["PostToolUse", 1]]) });
    const liveTexts = lineTexts(live);
    expect(liveTexts.some((t) => t.includes("PostToolUse hook"))).toBe(false);   // withheld, not "Ran 1 ... hook(s)"

    // The straggler resolves: hookLive clears, and the SAME item now carries both entries.
    const resolved = projectCompact(doc, { ...context, hookRuns: [h1, h2], hookLive: new Map() });
    const resolvedTexts = lineTexts(resolved);
    expect(resolvedTexts).toContain("  ⎿  Ran 2 PostToolUse hooks");
    expect(resolvedTexts.filter((t) => /Ran \d+ PostToolUse hooks?/.test(t))).toHaveLength(1);   // never a frozen "Ran 1" alongside it
  });
});

describe("bl8 T-QY Task 3, shape 2 (canon Qy Stop form, scoped to ccx's wire): errors-only standalone rows", () => {
  it("every entry exitCode:0 renders NOTHING — canon's own early exit", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [
      { id: "h1", name: "Stop", durationMs: 5, afterSequence: seq, event: "Stop", exitCode: 0 },
      { id: "h2", name: "Stop", durationMs: 5, afterSequence: seq, event: "Stop", exitCode: 0 },
    ];
    expect(lineTexts(projectCompact(doc, { ...context, hookRuns })).some((t) => t.toLowerCase().includes("stop hook"))).toBe(false);
  });

  it("one failed entry of two: bold count in the header, one error line, count is the WHOLE batch not just failures", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [
      { id: "h1", name: "Stop", durationMs: 5, afterSequence: seq, event: "Stop", exitCode: 0 },
      { id: "h2", name: "Stop", durationMs: 5, afterSequence: seq, event: "Stop", exitCode: 2, stderr: "boom" },
    ];
    const items = projectCompact(doc, { ...context, hookRuns });
    const texts = lineTexts(items);
    expect(texts).toContain("⏺ Ran 2 stop hooks");
    expect(texts).toContain("  ⎿  Stop hook error: boom");
    const header = lineOf(items, "⏺ Ran 2 stop hooks");
    expect(header.segments?.some((s) => s.bold === true && s.text === "2")).toBe(true);
  });

  it("empty stderr falls back to 'exit {code}', and one entry singularizes 'hook'", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [{ id: "h1", name: "Stop", durationMs: 5, afterSequence: seq, event: "Stop", exitCode: 2 }];
    const texts = lineTexts(projectCompact(doc, { ...context, hookRuns }));
    expect(texts).toContain("⏺ Ran 1 stop hook");
    expect(texts).toContain("  ⎿  Stop hook error: exit 2");
  });
});

// bl8 F1 fix: `projectDetail` (both variants) always takes `projectAll`'s UNGROUPED else-branch
// (`anchored.flatMap`), which never touches `foldAnchored`/`segmentRuns`/`weaveStandaloneHooks` at all — so a
// standalone hook entry vanished ENTIRELY (header row included, not just the per-hook detail lines) under
// ctrl+O. Canon's richest hook detail is exactly what should show there (research-hookblock.md §A5); instead
// ccx showed nothing. Fix: a parallel weave over the `Anchored[]` list by sequence in `projectAll`'s non-fold
// branch, reusing `hooksItemRows` — no claim tracking (nothing else absorbs hooks in detail mode), so a
// PreToolUse entry surfaces standalone here too (correct: transcript mode shows every hook, canon's own rule).
describe("bl8 F1: standalone hooks survive projectDetail (both variants), not just projectCompact", () => {
  it("detail-all: the standalone hook header row still renders", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [{ id: "h1", name: "PostToolUse:Read", durationMs: 200, afterSequence: seq, event: "PostToolUse" }];
    const items = projectDetail(doc, { ...context, hookRuns, projection: "detail-all" });
    expect(lineTexts(items)).toContain("  ⎿  Ran 1 PostToolUse hook");
    // detail-all is verbose, so the D21 gate is open — per-hook lines show too.
    expect(lineTexts(items)).toContain("     ⎿ PostToolUse:Read (0.2s)");
  });

  it("detail-collapsed: the standalone hook header row AND per-hook lines both render — the D21 gate keys off `projection !== \"compact\"`, true for either detail variant regardless of verbose", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [{ id: "h1", name: "PostToolUse:Read", durationMs: 200, afterSequence: seq, event: "PostToolUse" }];
    const items = projectDetail(doc, { ...context, hookRuns, projection: "detail-collapsed" });
    expect(lineTexts(items)).toContain("  ⎿  Ran 1 PostToolUse hook");
    expect(lineTexts(items)).toContain("     ⎿ PostToolUse:Read (0.2s)");
  });

  it("a PreToolUse entry also surfaces standalone in detail mode (no cluster to absorb it there)", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [{ id: "h1", name: "PreToolUse:Read", durationMs: 90, afterSequence: seq, event: "PreToolUse" }];
    const items = projectDetail(doc, { ...context, hookRuns, projection: "detail-all" });
    expect(lineTexts(items)).toContain("  ⎿  Ran 1 PreToolUse hook");
  });

  it("hook still renders at its correct position (before the closing 'done' prose)", () => {
    const doc = closedDoc(), seq = callSeq(doc);
    const hookRuns = [{ id: "h1", name: "PostToolUse:Read", durationMs: 200, afterSequence: seq, event: "PostToolUse" }];
    const texts = lineTexts(projectDetail(doc, { ...context, hookRuns, projection: "detail-all" }));
    const hookIndex = texts.indexOf("  ⎿  Ran 1 PostToolUse hook");
    const doneIndex = texts.indexOf("done");
    expect(hookIndex).toBeGreaterThanOrEqual(0);
    expect(doneIndex).toBeGreaterThan(hookIndex);
  });
});

describe("bl8 T-QY Task 3, D6: the live in-progress hook counter", () => {
  it("non-Pre/Post: 'Running {Event} hook…' (dim, event bold) unconditionally while live, through projectPending", () => {
    const doc = built(prose("hi"));
    const texts = lineTexts(projectPending(doc, { ...context, hookLive: new Map([["Stop", 1]]) }));
    expect(texts).toContain("Running Stop hook…");
    const line = lineOf(projectPending(doc, { ...context, hookLive: new Map([["Stop", 1]]) }), "Running Stop hook…");
    expect(line.segments?.[0]?.preStyled).toBe(true);   // the dim-ambient/bold-label passthrough (F3 Task 1's rule)
  });

  it("count 2 pluralizes to 'hooks…'", () => {
    const doc = built(prose("hi"));
    expect(lineTexts(projectPending(doc, { ...context, hookLive: new Map([["Stop", 2]]) }))).toContain("Running Stop hooks…");
  });

  it("empty map renders nothing", () => {
    const doc = built(prose("hi"));
    expect(lineTexts(projectPending(doc, { ...context, hookLive: new Map() })).some((t) => t.includes("Running"))).toBe(false);
  });

  it("Pre/PostToolUse renders '{N} {Event} {hook|hooks} ran' only under the transcript-surface predicate (projection !== \"compact\")", () => {
    const compactOpts = { ...context, projection: "compact" as const, verbose: false };
    expect(hookLiveItems(new Map([["PreToolUse", 1]]), compactOpts)).toHaveLength(0);   // compact, non-verbose: nothing
    // bl9 D10: canon has no folded-and-verbose state (verbose unfolds unconditionally, R2 @177046212);
    // compact+verbose still gates closed — the extras key off the transcript surface strictly, never verbose.
    const verboseOpts = { ...context, projection: "compact" as const, verbose: true };
    expect(hookLiveItems(new Map([["PreToolUse", 1]]), verboseOpts)).toHaveLength(0);
    const detailOpts = { ...context, projection: "detail-collapsed" as const, verbose: false };
    const rows = hookLiveItems(new Map([["PreToolUse", 1]]), detailOpts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind === "line" ? rows[0]!.line.text : "").toBe("1 PreToolUse hook ran");
    expect((rows[0]!.kind === "line" ? rows[0]!.line : undefined)?.segments?.[0]?.preStyled).toBe(true);
  });

  it("hooksItemRows dispatches 'Stop' to shape 2 and every other label to shape 1", () => {
    expect(hooksItemRows({ label: "Stop", entries: [{ id: "h1", name: "Stop", durationMs: 5, exitCode: 0 }] }, { ...context, projection: "compact", verbose: false })).toHaveLength(0);
    expect(hooksItemRows({ label: "SessionStart", entries: [{ id: "h1", name: "SessionStart", durationMs: 5 }] }, { ...context, projection: "compact", verbose: false })).toHaveLength(1);
  });
});
