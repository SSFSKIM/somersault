// test/tui/fold-expand.test.tsx — TOOL-STREAM TASK 8: the state and the re-projection that make a cluster
// EXPANDABLE. Tasks 3–5b collapsed a contiguous run into ONE row under fullscreen; Tasks 6–7 got a decoded
// click to a registered sink. Nothing between them yet holds the answer to "which cluster is open", and
// nothing turns that answer back into rows. This file pins both halves plus the two seams they cross.
//
// THE ANCHOR IS THE KEY, and that is the whole reason the state can be held at all. A group's ITEM id is
// derived from its full membership (`group:read-1,bash-1:row`), so it changes every time the run absorbs
// another call — an expansion keyed on it would close itself the moment the cluster grew. The anchor is the
// run's EARLIEST-ISSUED call (`FoldGroup.anchorId`) rather than `memberIds[0]`, because membership also
// REORDERS when overlapping members settle out of order (cell (f), E1); call order is stamped once, so the
// anchor survives growth, the settle, and the hand-over from the pending region to Static.
//
// AND THE RE-PROJECTION MUST COVER BOTH STREAMS. A still-growing cluster is withheld from Static and lives
// in `projectPending`; once its last member settles there is no further blink and no further append, so a
// toggle that re-projected only the finalized document would leave a live cluster collapsed with nothing
// left to correct it. Cell (e) is that guard and it asserts against `pendingItems` alone.
import React, { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import { projectCompact, projectPending, toolOwnerKey, TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
import { wrapItem } from "../../src/tui/wrapItems.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import type { RenderLine } from "../../src/tui/render.js";
import type { RendererChoice } from "../../src/tui/renderer.js";

// The same fixture grammar `toolRenderer.test.tsx` uses, kept local so this file can be read on its own.
const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
const FS = { ...context, fullscreen: true, expandHint: "" };
const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body", isError = false) =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } }) as Record<string, unknown>;
const prose = (text: string, id = `t-${text.slice(0, 6)}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
// A path tool's header argument is an OSC-8 hyperlink, so its `text` carries the escape between the paren
// and the label. Strip it: these cells are about WHICH rows appeared, not about the link (pinned elsewhere).
const unlink = (text: string) => text.replace(/\x1b]8;;[^\x07]*\x07/g, "");
const lineTexts = (items: readonly RenderItem[]) => items.filter((i) => i.kind === "line").map((i) => unlink((i as { line: RenderLine }).line.text));
const groupRows = (items: readonly RenderItem[]) => items.filter((i) => i.id.startsWith("group:"));
const bodies = (items: readonly RenderItem[]) => items.flatMap((i) => (i.kind === "gutter-block" ? [i.body.map((l) => l.text)] : []));

// ── (a) THE WRAP SEAM ───────────────────────────────────────────────────────────────────────────────────
// A hit test (Task 9/10) reads the tag off the row it hit, and the fullscreen viewport hit-tests PAINTED
// rows — `wrapItemsToWidth`'s output, not the projection's. Of `wrapOne`'s four paths three carry the tag
// for free (two identity returns and the gutter-block spread); the wrapped-LINE arm mints
// `{ kind, id, line }` from scratch and drops it, so an over-wide cluster row would be the ONE row shape
// that cannot be clicked. All four are pinned, because "three of four" is not a property anyone can rely on.
describe("T8 (a): foldAnchor survives every wrap path", () => {
  const long = "x".repeat(60);
  const tag = "read-1";
  const cases: Record<string, RenderItem> = {
    "line that fits (identity)": { kind: "line", id: "l-fit", line: { text: "short" }, foldAnchor: tag },
    "line that WRAPS (the arm that minted a fresh object)": { kind: "line", id: "l-wrap", line: { text: long }, foldAnchor: tag },
    "truncating header (identity by construction)": { kind: "line", id: "l-trunc", line: { text: long }, wrap: "truncate-end", foldAnchor: tag },
    "gutter block that fits (identity)": { kind: "gutter-block", id: "b-fit", gutter: TOOL_RESULT_GUTTER, body: [{ text: "short" }], foldAnchor: tag },
    "gutter block whose BODY wraps (the spread)": { kind: "gutter-block", id: "b-wrap", gutter: TOOL_RESULT_GUTTER, body: [{ text: long }], foldAnchor: tag },
  };
  for (const [name, item] of Object.entries(cases))
    it(`keeps the tag on every painted row: ${name}`, () => {
      const rows = wrapItem(item, 20);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.foldAnchor).toBe(tag);
    });
  it("actually exercised the wrapping arms rather than five identity returns", () => {
    expect(wrapItem(cases["line that WRAPS (the arm that minted a fresh object)"]!, 20).length).toBeGreaterThan(1);
    expect(wrapItem(cases["gutter block whose BODY wraps (the spread)"]!, 20)[0]).not.toBe(cases["gutter block whose BODY wraps (the spread)"]);
  });
});

// ── (b) THE EXPANDED PROJECTION ─────────────────────────────────────────────────────────────────────────
// Canon's expanded cluster shows every absorbed `tool_use`, in the FULL listing form — the same one the
// ctrl+o pager renders — so the expansion is a genuine "show me what that row summarised", not a second
// compact view. Three member shapes have to survive it: an ordinary counted call, a silently-absorbed one
// (TodoWrite earns no counter, so the collapsed sentence never mentions it), and a SUPPRESSED one
// (ToolSearch projects to `[]` normally — inside an expanded cluster it must still show a row, spec A6).
describe("T8 (b): an expanded cluster projects its members, in detail, all tagged", () => {
  const doc = () => built(
    call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
    call("todo-1", "TodoWrite", { todos: [] }), result("todo-1", "ok"),
    call("ts-1", "ToolSearch", { query: "select:Read" }), result("ts-1", "{}"),
    call("mcp-1", "mcp__srv__thing", { q: "x" }), result("mcp-1", "l1\nl2\nl3\nl4\nl5\nl6"),
    prose("done"));

  it("collapses to ONE row with no expansion, and the anchor is its first member", () => {
    const rows = groupRows(projectCompact(doc(), FS));
    expect(rows.filter((i) => i.kind === "line")).toHaveLength(1);
    expect(rows[0]!.id).toBe("group:read-1,todo-1,ts-1,mcp-1:row");
    expect(rows[0]!.foldAnchor).toBe("read-1");          // the collapsed row is tagged too — Task 9 hit-tests it
  });

  it("replaces the fold row with every member's per-call items, tagged with the anchor", () => {
    const items = projectCompact(doc(), { ...FS, expandedFolds: new Set(["read-1"]) });
    expect(groupRows(items)).toEqual([]);                                        // the fold row is GONE
    const texts = lineTexts(items);
    expect(texts.some((t) => t.includes("Read(a.ts)"))).toBe(true);
    expect(texts.some((t) => t.includes("TodoWrite"))).toBe(true);               // silently absorbed, still shown
    expect(texts.some((t) => t.includes("ToolSearch"))).toBe(true);              // suppressed → its GENERIC header row
    expect(texts.some((t) => t.includes("mcp__srv__thing"))).toBe(true);
    expect(texts.at(-1)).toBe("done");                                           // the breaker still follows it
    // Every item the cluster produced carries the anchor; nothing outside it does.
    for (const item of items) expect(item.foldAnchor).toBe(lineTexts([item])[0] === "done" ? undefined : "read-1");
  });

  it("renders members in the DETAIL form, not the compact one (an expanded body is not clipped to three rows)", () => {
    const collapsedBodies = bodies(projectCompact(doc(), FS));
    const expanded = bodies(projectCompact(doc(), { ...FS, expandedFolds: new Set(["read-1"]) }));
    const mcpBody = expanded.find((b) => b[0] === "l1")!;
    expect(mcpBody).toEqual(["l1", "l2", "l3", "l4", "l5", "l6"]);               // unbounded — `detail-all`
    expect(mcpBody.some((line) => line.includes("+"))).toBe(false);              // …and no `… +N lines` marker
    expect(collapsedBodies).toEqual([]);                                          // the collapsed row has no body at all
  });

  it("expands ONLY the anchored cluster — a second run beside it stays collapsed", () => {
    const two = built(
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("mid"),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"), prose("done"));
    const items = projectCompact(two, { ...FS, expandedFolds: new Set(["read-2"]) });
    expect(groupRows(items).map((i) => i.id)).toEqual(["group:read-1:row"]);     // the un-anchored one is untouched
    expect(lineTexts(items).some((t) => t.includes("Read(b.ts)"))).toBe(true);
  });
});

// ── (b2) THE DE-DUP, INHERITED FROM TASK 3 ──────────────────────────────────────────────────────────────
// An errored `popsOutOnError` bookkeeping call that STAYED in its run (its window was not clear) is emitted
// STANDALONE so the failure is never swallowed — and it is left in `memberIds`, because relocation decides
// membership and this one did not relocate. Canon has no such problem: it keeps the `tool_use` inside the
// cluster and pushes only the `tool_result` out, two halves of one call. Our atoms carry both halves
// together, so iterating `memberIds` naively draws the same failed call twice.
describe("T8 (b2): a member the projection already emitted standalone is not drawn twice", () => {
  // The read-2 call lands strictly inside `(todo-1.callSequence, todo-1.resultSequence)`, which is exactly
  // what makes `windowIsClear` refuse the relocation and leave the errored TodoWrite in `memberIds`.
  const doc = () => built(
    call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
    call("todo-1", "TodoWrite", { todos: [] }),
    call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"),
    result("todo-1", "board is locked", true),
    prose("done"));

  it("leaves the errored call in memberIds AND emits it standalone (the setup this cell guards)", () => {
    const rows = groupRows(projectCompact(doc(), FS));
    expect(rows[0]!.id).toBe("group:read-1,read-2,todo-1:row");                  // it stayed a member
    expect(lineTexts(projectCompact(doc(), FS)).filter((t) => t.includes("TodoWrite"))).toHaveLength(1);
  });

  it("shows the failed TodoWrite EXACTLY once when its cluster is expanded", () => {
    const items = projectCompact(doc(), { ...FS, expandedFolds: new Set(["read-1"]) });
    expect(lineTexts(items).filter((t) => t.includes("TodoWrite"))).toHaveLength(1);
    // …and the two members that were NOT emitted standalone are both there.
    expect(lineTexts(items).filter((t) => t.includes("Read("))).toHaveLength(2);
  });
});

// ── The hook: toggle, reset, and the pending-projection pin ─────────────────────────────────────────────
type Hook = ReturnType<typeof useChat>;
const tick = (ms = 20) => new Promise((r) => { setTimeout(r, ms); });
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function mount(session: () => ChatSession): { api: { c?: Hook } } {
  const api: { c?: Hook } = {};
  // `cwd` is pinned so a header's path argument reads the same on every machine (`displayPath` shortens
  // against it), and `isFullscreen` is the whole point: the cluster only exists under the widened policy.
  function H() { const c = useChat(session, { cwd: "/work" }, { now: () => 0, columns: () => 100, rows: () => 40, home: "/home/me", platform: "darwin", isFullscreen: () => true }); api.c = c; return <Text>{c.state.busy ? "BUSY" : "IDLE"}</Text>; }
  render(<H />);
  return { api };
}
const allTexts = (c: Hook) => lineTexts([...c.state.finalizedItems, ...c.state.pendingItems]);

describe("T8 (c)/(d): toggleFold round-trips, and the set dies at the conversation boundary", () => {
  it("toggleFold(anchor) re-projects the finalized cluster, and a second call restores it", async () => {
    const fake = fakeRemote();
    const { api } = mount(() => fake);
    await tick();
    for (const m of [call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"), prose("done")])
      fake.pushEvent({ kind: "message", data: m });
    await waitFor(() => groupRows(api.c!.state.finalizedItems).length > 0);
    expect(allTexts(api.c!).some((t) => t.includes("Read 2 files"))).toBe(true);

    api.c!.toggleFold("read-1");
    await waitFor(() => groupRows(api.c!.state.finalizedItems).length === 0);
    expect(allTexts(api.c!).filter((t) => t.includes("Read("))).toHaveLength(2);

    api.c!.toggleFold("read-1");
    await waitFor(() => groupRows(api.c!.state.finalizedItems).length === 1);
    expect(allTexts(api.c!).filter((t) => t.includes("Read("))).toHaveLength(0);
  });

  it("clears the expansion set at replaceDocument, so the next conversation opens collapsed", async () => {
    const fake = fakeRemote();
    const { api } = mount(() => fake);
    await tick();
    const conversation = [call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"), prose("done")];
    for (const m of conversation) fake.pushEvent({ kind: "message", data: m });
    await waitFor(() => groupRows(api.c!.state.finalizedItems).length > 0);
    api.c!.toggleFold("read-1");
    await waitFor(() => groupRows(api.c!.state.finalizedItems).length === 0);

    api.c!.clear();                                   // → replaceDocument, the one relevant reset site
    await waitFor(() => api.c!.state.finalizedItems.length === 0);
    // The SAME ids come back (a rebuilt transcript reuses them, which is exactly why the set must not
    // survive the boundary) — and the cluster opens collapsed.
    for (const m of conversation) fake.pushEvent({ kind: "message", data: m });
    await waitFor(() => api.c!.state.finalizedItems.length > 0);
    await tick();
    expect(groupRows(api.c!.state.finalizedItems)).toHaveLength(1);
    expect(allTexts(api.c!).filter((t) => t.includes("Read("))).toHaveLength(0);
  });
});

// ── (e) THE A10 PIN, AGAINST `pendingItems` ─────────────────────────────────────────────────────────────
// A run no breaker has closed is WITHHELD from Static (`trailingRunCut` — the next collapsible call would
// change its counts, its sentence and its membership-derived id) and drawn by the PENDING projection alone.
// Two implementations pass every cell above and fail this one: an expansion keyed on the group's ITEM id,
// which changes the moment the run absorbs another call, and a `toggleFold` that re-projects only the
// finalized document.
//   THE RUN HERE IS SETTLED, NOT RUNNING, AND THAT IS THE POINT. While a member is still open the hook runs
// a 600 ms repaint interval for the blinking leader, and that repaint re-projects the pending region on its
// own — so an open run would hide a finalized-only toggle behind the very next tick. Once every member has
// a result and no prose has closed the run there is no blink, no interval and no further append: the
// toggle's own re-projection is the only thing that can move this row, which is exactly the claim.
describe("T8 (e): the growable cluster expands in the PENDING projection and stays expanded as it grows", () => {
  it("toggles a settled-but-unclosed run — the one nothing else will repaint", async () => {
    const fake = fakeRemote();
    const { api } = mount(() => fake);
    await tick();
    for (const m of [call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("bash-1", "Bash", { command: "npm run build" }), result("bash-1", "ok")])
      fake.pushEvent({ kind: "message", data: m });
    await waitFor(() => groupRows(api.c!.state.pendingItems).length > 0);
    expect(api.c!.state.finalizedItems.filter((i) => i.id.startsWith("group:"))).toEqual([]);   // Static has none of it
    expect(lineTexts(api.c!.state.pendingItems)).toEqual(["  Read 1 file, ran 1 shell command"]);  // settled form: no blinking glyph
    await tick(80);                                                              // …and nothing repaints it
    expect(lineTexts(api.c!.state.pendingItems)).toEqual(["  Read 1 file, ran 1 shell command"]);

    api.c!.toggleFold("read-1");
    await waitFor(() => groupRows(api.c!.state.pendingItems).length === 0);
    expect(lineTexts(api.c!.state.pendingItems).some((t) => t.includes("Read(a.ts)"))).toBe(true);
    expect(lineTexts(api.c!.state.pendingItems).some((t) => t.includes("Bash(npm run build)"))).toBe(true);

    // The run grows. `memberIds` — and therefore the group's item id — changes; the ANCHOR does not.
    fake.pushEvent({ kind: "message", data: call("bash-2", "Bash", { command: "npm test" }) });
    fake.pushEvent({ kind: "message", data: result("bash-2", "ok") });
    await waitFor(() => lineTexts(api.c!.state.pendingItems).some((t) => t.includes("Bash(npm test)")));
    expect(groupRows(api.c!.state.pendingItems)).toEqual([]);                    // still expanded
    expect(lineTexts(api.c!.state.pendingItems).some((t) => t.includes("Read(a.ts)"))).toBe(true);
  });
});

// ── (f) THE ANCHOR IS CALL ORDER, NOT ARRIVAL-INTO-THE-RUN ORDER ────────────────────────────────────────
// E1, from the external whole-branch review. `memberIds` is built in ACCUMULATION order — the order the
// anchored stream hands atoms to `segmentRuns` — and that stream anchors an OPEN call at its `callSequence`
// but a SETTLED one at its `resultSequence`. So two overlapping calls whose later-started one finishes first
// REORDER the run at the moment the earlier one settles: `[read-1, read-2]` becomes `[read-2, read-1]`, and an
// anchor read off `memberIds[0]` silently moves with it. The expansion recorded under `read-1` is then
// orphaned and the cluster collapses by itself mid-turn, with no user action — A10's "and after it settles".
//   Cell (e) above cannot see this: its calls are sequential, so arrival order and call order agree and every
// implementation passes. The fixture here is the smallest one where they DISAGREE, and it asserts the
// reordering itself first so the cell cannot quietly stop exercising it.
describe("T8 (f): a run that reorders at settlement keeps its anchor (E1)", () => {
  // read-1 call, read-2 call, read-2 RESULT, read-1 result: the later-started call finishes first.
  const OVERLAP = [call("read-1", "Read", { file_path: "/work/a.ts" }), call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2")];
  const inFlight = () => built(...OVERLAP);
  const settled = () => built(...OVERLAP, result("read-1"));
  const live = new Set(["read-1"]);                                  // read-1 is the turn's one still-running call

  it("the fixture really does reorder the run at settlement (the premise this cell rests on)", () => {
    expect(groupRows(projectPending(inFlight(), FS, live)).map((i) => i.id)).toContain("group:read-1,read-2:pending-row");
    expect(groupRows(projectPending(settled(), FS, live)).map((i) => i.id)).toContain("group:read-2,read-1:unclosed-row");
  });

  it("tags both frames with the EARLIEST-ISSUED call, not the first to arrive in the run", () => {
    expect(groupRows(projectPending(inFlight(), FS, live))[0]!.foldAnchor).toBe("read-1");
    expect(groupRows(projectPending(settled(), FS, live))[0]!.foldAnchor).toBe("read-1");
  });

  it("keeps the hand-over to Static on the same anchor once a breaker closes the run", () => {
    const closed = built(...OVERLAP, result("read-1"), prose("done"));
    const rows = groupRows(projectCompact(closed, FS));
    expect(rows.map((i) => i.id)).toEqual(["group:read-2,read-1:row"]);           // still reordered…
    expect(rows[0]!.foldAnchor).toBe("read-1");                                   // …and still anchored on read-1
  });

  it("A10: a cluster expanded while read-1 was in flight is STILL expanded after read-1 settles", () => {
    const open = { ...FS, expandedFolds: new Set(["read-1"]) };
    expect(groupRows(projectPending(inFlight(), open, live))).toEqual([]);
    const after = projectPending(settled(), open, live);
    expect(groupRows(after)).toEqual([]);                                         // the fold row must not come back
    expect(lineTexts(after).filter((t) => t.includes("Read("))).toHaveLength(2);
    for (const item of after) expect(item.foldAnchor).toBe("read-1");
  });

  it("keeps stability against APPENDS, which is the property (e) already relied on", () => {
    // A third read issued and settled after both: it joins the run, and the anchor does not move to it.
    const grown = built(...OVERLAP, result("read-1"), call("read-3", "Read", { file_path: "/work/c.ts" }), result("read-3"));
    const rows = groupRows(projectPending(grown, FS, live));
    expect(rows[0]!.id).toBe("group:read-2,read-1,read-3:unclosed-row");
    expect(rows[0]!.foldAnchor).toBe("read-1");
  });
});

// ══ T-CLICKGATE Task 3 — `expandedItems`, the SEPARATE namespace beside `expandedFolds` ═══════════════════
// A single clickable RESULT (T-CLICKGATE Task 1/2), not a fold cluster: keyed by `toolOwnerKey`, threaded as
// `ProjectionOptions.expandedItems`, and re-projected by the SAME `reconcile()` a fold toggle uses.
describe("T-CLICKGATE Task 3 (g): the row model — detail-all, banded, ONE padding row, and still clickable", () => {
  const errorLines = (n: number) => Array.from({ length: n }, (_, i) => `err line ${i + 1}`).join("\n");
  const doc = () => built(call("e-1", "Mystery", {}), result("e-1", errorLines(12), true));

  it("collapses to the ten-row clip with a marker when NOT expanded (the premise)", () => {
    const block = projectCompact(doc(), FS).find((i) => i.kind === "gutter-block")!;
    expect(block.body).toHaveLength(11);                              // 10 clipped rows + the marker
    expect(block.body.at(-1)!.text).toMatch(/…\s*\+2 lines?/);
    expect(block.clickable).toBe(true);
  });

  it("shows every line with no marker, a background band on every row, and one blank padding row, once its OWNER key is in the set", () => {
    const ownerKey = projectCompact(doc(), FS).find((i) => i.kind === "gutter-block")!.ownerKey!;
    const items = projectCompact(doc(), { ...FS, expandedItems: new Set([ownerKey]) });
    const block = items.find((i) => i.kind === "gutter-block")!;
    expect(block.body.map((l) => l.text)).toEqual([
      "Error: err line 1", "err line 2", "err line 3", "err line 4", "err line 5",
      "err line 6", "err line 7", "err line 8", "err line 9", "err line 10",
      "err line 11", "err line 12", "",                               // the ONE padding row
    ]);
    expect(block.body.every((l) => l.bg !== undefined)).toBe(true);    // banded — REAL rows, not a wrapper pad
    expect(block.clickable).toBe(true);                                // Task 1's as-if-compact bit survives
    expect(block.expanded).toBe(true);                                 // hover suppressed (shared `expanded` field)
    const header = items.find((i) => i.kind === "line" && i.id.endsWith(":header"))!;
    expect(header.expanded).toBe(true);                                // the WHOLE owner, header included
  });

  it("an unrelated owner in the set never touches THIS one (no cross-item bleed)", () => {
    const items = projectCompact(doc(), { ...FS, expandedItems: new Set(["tool:some-other-call:9"]) });
    const block = items.find((i) => i.kind === "gutter-block")!;
    expect(block.body).toHaveLength(11);                              // still clipped
  });
});

type ItemHook = ReturnType<typeof useChat>;
function mountItems(session: () => ChatSession): { api: { c?: ItemHook } } {
  const api: { c?: ItemHook } = {};
  function H() { const c = useChat(session, { cwd: "/work" }, { now: () => 0, columns: () => 100, rows: () => 40, home: "/home/me", platform: "darwin", isFullscreen: () => true }); api.c = c; return <Text>{c.state.busy ? "BUSY" : "IDLE"}</Text>; }
  render(<H />);
  return { api };
}
const errBody = (n: number) => Array.from({ length: n }, (_, i) => `err line ${i + 1}`).join("\n");
const gutterBlockOf = (c: ItemHook) => [...c.state.finalizedItems, ...c.state.pendingItems].find((i) => i.kind === "gutter-block")!;

describe("T-CLICKGATE Task 3 (h)/(i): toggleItemExpand round-trips, and the set dies at the conversation boundary", () => {
  it("toggleItemExpand(ownerKey) re-projects the finalized result, and a second call restores it", async () => {
    const fake = fakeRemote();
    const { api } = mountItems(() => fake);
    await tick();
    fake.pushEvent({ kind: "message", data: call("e-1", "Mystery", {}) });
    fake.pushEvent({ kind: "message", data: result("e-1", errBody(12), true) });
    await waitFor(() => api.c!.state.finalizedItems.some((i) => i.kind === "gutter-block"));
    expect(gutterBlockOf(api.c!).body).toHaveLength(11);

    const ownerKey = gutterBlockOf(api.c!).ownerKey!;
    api.c!.toggleItemExpand(ownerKey);
    await waitFor(() => gutterBlockOf(api.c!).body.length > 11);
    expect(gutterBlockOf(api.c!).body.map((l) => l.text)).toContain("err line 12");

    api.c!.toggleItemExpand(ownerKey);
    await waitFor(() => gutterBlockOf(api.c!).body.length === 11);
    expect(gutterBlockOf(api.c!).body.map((l) => l.text)).not.toContain("err line 12");
  });

  it("clears the expansion set at replaceDocument, so the next conversation opens collapsed", async () => {
    const fake = fakeRemote();
    const { api } = mountItems(() => fake);
    await tick();
    const conversation = [call("e-1", "Mystery", {}), result("e-1", errBody(12), true)];
    for (const m of conversation) fake.pushEvent({ kind: "message", data: m });
    await waitFor(() => api.c!.state.finalizedItems.some((i) => i.kind === "gutter-block"));
    const ownerKey = gutterBlockOf(api.c!).ownerKey!;
    api.c!.toggleItemExpand(ownerKey);
    await waitFor(() => gutterBlockOf(api.c!).body.length > 11);

    api.c!.clear();                                     // → replaceDocument, the one relevant reset site
    await waitFor(() => api.c!.state.finalizedItems.length === 0);
    // The SAME tool-use id comes back (a rebuilt transcript reuses it, which is exactly why the set must not
    // survive the boundary) — and the result opens collapsed, not carrying the stale expansion over.
    for (const m of conversation) fake.pushEvent({ kind: "message", data: m });
    await waitFor(() => api.c!.state.finalizedItems.some((i) => i.kind === "gutter-block"));
    expect(gutterBlockOf(api.c!).body).toHaveLength(11);
  });
});

// ── T-CLICKGATE Task 3 (j): THE OTHER RESET SITE — a renderer flip closes every expanded result too ───────
// `refoldFor`'s own doc (`useChat.ts`): the affordance that opens an owner is the fullscreen renderer's
// alone, so leaving the set standing across a flip would carry an invisible expansion into a screen with no
// way to close it. Driven through the SAME renderer-switch seam `tui-switch.test.tsx`'s own `refoldFor`
// cell uses, kept local per this suite's own no-cross-file-test-import convention.
describe("T-CLICKGATE Task 3 (j): an item expanded under fullscreen does not survive the flip back to classic", () => {
  it("closes the result the moment the renderer leaves fullscreen", async () => {
    const CLASSIC: RendererChoice = { mode: "classic", reason: "default_off" };
    const FULLSCREEN: RendererChoice = { mode: "fullscreen", reason: "settings_on" };
    const fake = fakeRemote();
    let api: ItemHook | undefined;
    function Probe() {
      const [mode, setMode] = useState<"classic" | "fullscreen">("fullscreen");
      const live = useRef(mode); live.current = mode;
      const chat = useChat(() => fake, {
        cwd: "/work", rendererChoice: FULLSCREEN,
        selectRenderer: (tui) => (tui === "fullscreen" ? FULLSCREEN : CLASSIC),
        switchRenderer: (tui) => { const choice = tui === "fullscreen" ? FULLSCREEN : CLASSIC; setMode(choice.mode); return choice; },
      }, { rows: () => 24, columns: () => 100, home: "/home/me", platform: "darwin", now: () => 0,
        isFullscreen: () => live.current === "fullscreen", savePrefs: () => {}, env: {} });
      api = chat;
      return <Text>x</Text>;
    }
    render(<Probe />);
    await tick();
    fake.pushEvent({ kind: "message", data: call("e-1", "Mystery", {}) });
    fake.pushEvent({ kind: "message", data: result("e-1", errBody(12), true) });
    await waitFor(() => api!.state.finalizedItems.some((i) => i.kind === "gutter-block"));
    const ownerKey = gutterBlockOf(api!).ownerKey!;

    api!.toggleItemExpand(ownerKey);                     // opens the result under fullscreen
    await waitFor(() => gutterBlockOf(api!).body.length > 11);

    api!.submit("/tui default");                         // the leaving arm: refoldFor(false) runs first
    await tick(120);
    expect(gutterBlockOf(api!).body).toHaveLength(11);    // clipped again — the expansion did not survive
  });
});
