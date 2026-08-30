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
import { groupItems, projectCompact, projectPending, toolOwnerKey, TOOL_RESULT_GUTTER, type GroupForm, type RenderItem } from "../../src/tui/toolRenderer.js";
import { wrapItem } from "../../src/tui/wrapItems.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import type { FoldGroup } from "../../src/tui/toolFold.js";
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

// ── T-CLUSTER Task 2: the expansion interleaves absorbed thinking with member rows ──────────────────────
// bl6 Task 1 gave `FoldGroup.absorbedThinking` (key, messageSequence, raw body). This is the read side: an
// expanded cluster must show every absorbed thinking body, in transcript order against the member calls it
// sat beside — canon's `∴` gutter over the FULL dim-markdown body, no duration clause anywhere (spec D4).
// The ORDER KEY IS `callSequence`/`messageSequence`, NEVER `memberIds` position: membership reorders as
// overlapping calls settle out of order (T8 (f), above), so an implementation that just walks `memberIds`
// and appends thinking rows afterward gets both member order and thinking placement wrong at once — which
// is exactly what the second cell below is built to catch.
describe("T-CLUSTER Task 2: absorbed thinking interleaves with member rows in transcript order", () => {
  // A message whose ONLY content is thinking (no `tool_use` riding along) — the standalone/leading shape
  // Task 1's own Cell 3 pipeline test uses, and the one a mid-run absorbed thought takes on the wire.
  const leadingThought = (messageId: string, thinking: string) =>
    ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "thinking", thinking, signature: "sig" }] } }) as Record<string, unknown>;
  // The full ordered text stream a reader sees: `line` items contribute their (delink'd) text, a
  // `gutter-block`'s body contributes one entry per body row — same order the items array already holds.
  const allTexts = (items: readonly RenderItem[]): string[] =>
    items.flatMap((i) => (i.kind === "line" ? [unlink(i.line.text)] : i.body.map((l) => l.text)));
  const THINKING_GUTTER_GLYPH = "∴";

  it("shows the ∴ gutter and the FULL dim-markdown body between the two Read rows it sat between", () => {
    const doc = built(
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      leadingThought("m-think", "Alpha\n\nBeta"),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"),
      prose("done"));

    // Not on the collapsed path at all.
    const collapsed = allTexts(projectCompact(doc, FS));
    expect(collapsed.some((t) => t.includes("Alpha"))).toBe(false);
    expect(collapsed.some((t) => t.includes(THINKING_GUTTER_GLYPH))).toBe(false);

    const items = projectCompact(doc, { ...FS, expandedFolds: new Set(["read-1"]) });
    const texts = allTexts(items).map((t) => t.trim());
    const ia = texts.findIndex((t) => t.includes("Read(a.ts)"));
    const ithink = texts.findIndex((t) => t === "Alpha");
    const ibeta = texts.findIndex((t) => t === "Beta");
    const ib = texts.findIndex((t) => t.includes("Read(b.ts)"));
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ithink).toBeGreaterThan(ia);
    expect(ibeta).toBeGreaterThan(ithink);
    expect(ib).toBeGreaterThan(ibeta);

    // No "thought for"/duration clause anywhere in the expanded form (spec D4).
    expect(texts.some((t) => /thought for/i.test(t))).toBe(false);
    expect(texts.some((t) => /\bctrl\+o\b/i.test(t))).toBe(false);

    // The gutter itself: dim+italic ∴, on a `line` item tagged like every other cluster row; the BODY line
    // is dim but NOT italic (render.ts:18's note — the gutter is italic, the body never is).
    const gutterLine = items.find((i): i is Extract<RenderItem, { kind: "line" }> =>
      i.kind === "line" && i.line.gutter?.text.includes(THINKING_GUTTER_GLYPH) === true);
    expect(gutterLine).toBeDefined();
    expect(gutterLine!.line.gutter).toMatchObject({ dim: true, italic: true });
    expect(gutterLine!.line.italic).not.toBe(true);
    expect(gutterLine!.line.dim).toBe(true);
    expect(gutterLine!.foldAnchor).toBe("read-1");
    expect(gutterLine!.expanded).toBe(true);
  });

  it("orders the expansion by transcript sequence, not memberIds position — the ORDERING KILL CELL", () => {
    // read-1 calls, then a mid-run thought, then read-2 calls — but read-2 SETTLES FIRST, which reorders
    // the finalized `memberIds` to [read-2, read-1] (same mechanic as T8 (f) above). The correct expansion
    // order still follows `callSequence`/`messageSequence`: Read(a.ts), then the thought, then Read(b.ts).
    // An implementation that walks `memberIds` verbatim renders Read(b.ts) before Read(a.ts); one that
    // additionally appends absorbed thinking after every member renders the thought last of all. Both are
    // wrong here, and only the correct total order passes.
    const doc = built(
      call("read-1", "Read", { file_path: "/work/a.ts" }),
      leadingThought("m-think", "Gamma"),
      call("read-2", "Read", { file_path: "/work/b.ts" }),
      result("read-2"),
      result("read-1"),
      prose("done"));

    // The premise: the run really did reorder at settlement.
    expect(groupRows(projectCompact(doc, FS))[0]!.id).toBe("group:read-2,read-1:row");

    const items = projectCompact(doc, { ...FS, expandedFolds: new Set(["read-1"]) });
    const texts = allTexts(items).map((t) => t.trim());
    const ia = texts.findIndex((t) => t.includes("Read(a.ts)"));
    const igamma = texts.findIndex((t) => t === "Gamma");
    const ib = texts.findIndex((t) => t.includes("Read(b.ts)"));
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(igamma).toBeGreaterThan(ia);
    expect(ib).toBeGreaterThan(igamma);
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

// ── bl7 T-ADVISOR TASK 4 (A7): AN ADVISOR RESULT IS A BREAKER ───────────────────────────────────────────
// Spec §3.5: once the render arms exist (Task 2), an advisor entry flips from `neutral` (`items.length===0`
// early-exit) to `breaker` in `entryAtom` — canon's segmenter takes the same disposition (advisor blocks
// match no absorb/park predicate and take the flush arm). This is a PIN, not a new behavior: Task 2's render
// arms already made the entry non-empty, so `entryAtom`'s existing "did it render something real" rule
// already closes a still-open tool cluster the moment an advisor entry follows it — exactly as `prose` does
// in cell (f) above ("keeps the hand-over to Static on the same anchor once a breaker closes the run").
// EXPECT GREEN-FIRST: this cell is not expected to fail before the comment/test land; it exists so nobody
// later "fixes" the breaker into absorption.
const advisorResult = (toolUseId = "srv1", content: Record<string, unknown> = { type: "advisor_result", text: "looks fine", stop_reason: "end_turn" }) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: "adv-1", content: [{ type: "advisor_tool_result", tool_use_id: toolUseId, content }] } }) as Record<string, unknown>;

describe("T8 (g) / bl7 T-ADVISOR A7: an advisor_tool_result entry is a breaker", () => {
  it("closes a still-open tool cluster into Static, exactly as prose would", () => {
    const doc = built(
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("bash-1", "Bash", { command: "npm test" }), result("bash-1", "ok"),
      advisorResult());
    const items = projectCompact(doc, FS);
    const rows = groupRows(items);
    expect(rows).toHaveLength(1);                                     // the cluster PUBLISHED — a breaker closed it
    expect(rows[0]!.id).toBe("group:read-1,bash-1:row");
    expect(lineTexts(items).some((t) => t.includes("Advisor has reviewed"))).toBe(true);
  });

  it("control: WITHOUT the advisor entry the same cluster stays unclosed and is withheld from Static (the premise this pin rests on)", () => {
    const doc = built(
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("bash-1", "Bash", { command: "npm test" }), result("bash-1", "ok"));
    expect(groupRows(projectCompact(doc, FS))).toEqual([]);
  });
});

// ── round review F1: an unresolved advisor row gets the SAME withholding a growable tool run gets ──────────
// Unlike an open tool call (excluded from `projectCompact`'s output by `!event.result`, toolRenderer.tsx
// :1460) or a still-growing fold run (withheld by `trailingRunCut`), an unresolved advisor consult had
// NEITHER protection before this fix: `entryAtom` classifies it a `breaker` the moment its render arms make
// it non-empty (T8 (g) above), regardless of resolution state, so it published into Static the instant its
// message frame landed and could never self-correct once resolved (Static is append-only; the resolved
// re-projection shares the SAME item id and is filtered out as already-published). Fixed by tagging the
// entry `openAdvisor` (`buildAnchoredEntries`) and extending `trailingRunCut`'s growability scan to treat a
// trailing `openAdvisor` breaker exactly like a growable tool run — withheld from `projectCompact`, drawn
// live by `projectPending`, and published exactly once the moment `advisor_tool_result` resolves it.
const advisorConsult = (toolUseId = "srv1") =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: "adv-consult", content: [{ type: "server_tool_use", id: toolUseId, name: "advisor", input: {} }] } }) as Record<string, unknown>;

describe("round review F1: an unresolved advisor row is withheld from Static, exactly like a growable tool run", () => {
  it("compact EXCLUDES the unresolved row entirely — it never enters projectCompact's output while spinning", () => {
    const doc = built(prose("hi"), advisorConsult());
    expect(lineTexts(projectCompact(doc, FS)).some((t) => t.includes("Advising"))).toBe(false);
  });

  it("pending SHOWS it live, exactly where compact withholds it", () => {
    const doc = built(prose("hi"), advisorConsult());
    expect(lineTexts(projectPending(doc, FS)).some((t) => t.includes("Advising"))).toBe(true);
  });

  it("compact carries it EXACTLY ONCE, the moment advisor_tool_result resolves it — and pending drops it", () => {
    const doc = built(prose("hi"), advisorConsult(), advisorResult("srv1"));
    const compactTexts = lineTexts(projectCompact(doc, FS));
    expect(compactTexts.filter((t) => t.includes("Advising")).length).toBe(1);
    expect(compactTexts.some((t) => t.includes("Advisor has reviewed"))).toBe(true);  // the separate result row
    expect(lineTexts(projectPending(doc, FS)).some((t) => t.includes("Advising"))).toBe(false);
  });
});

// bl7 T-HOOKBLOCK Task 2, spec D13 — the tests-pass-wiring-dead guard, third round running (D13 decision
// log). This is deliberately NOT built from prebuilt `FoldAtom`s: it goes through a REAL `TranscriptDocument`
// (`appendSdk`) and the two real production entry points, so a dropped `hookRuns:` forward at ANY of the
// three `segmentRuns` call sites in `toolRenderer.tsx` (`foldAnchored`, and `projectPending`'s `settled`/
// `dynamic` folds, which share one options object) shows up here as a silently-missing hook line rather than
// a green unit suite hiding a dead wire.
describe("bl7 T-HOOKBLOCK Task 2: hookRuns reaches rendered output through the real production pipeline (spec D13)", () => {
  const allText = (items: readonly RenderItem[]) => [...lineTexts(items), ...bodies(items).flat()].join("\n");

  it("projectCompact (foldAnchored's segmentRuns call site): a settled, breaker-closed run shows the hook line", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
    const callSequence = doc.toolEvents()[0]!.callSequence;
    const items = projectCompact(doc, { ...context, expandHint: "", hookRuns: [{ id: "h1", name: "PreToolUse:Read", durationMs: 200, afterSequence: callSequence, event: "PreToolUse" }] });
    expect(allText(items)).toContain("Ran 1 PreToolUse hook");
  });

  it("projectPending (the settled+dynamic segmentRuns call sites): a still-growing run shows the hook line too", () => {
    // No breaker: the lone Read call is the TRAILING run `trailingRunCut` withholds from Static, so this
    // exercises the OTHER two production call sites — the ones `projectCompact` above never reaches.
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"));
    const callSequence = doc.toolEvents()[0]!.callSequence;
    const items = projectPending(doc, { ...context, expandHint: "", hookRuns: [{ id: "h1", name: "PreToolUse:Read", durationMs: 200, afterSequence: callSequence, event: "PreToolUse" }] });
    expect(allText(items)).toContain("Ran 1 PreToolUse hook");
  });

  it("drops a hook stamped before the call and shows none (the fold's own attribution, exercised end to end)", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
    const callSequence = doc.toolEvents()[0]!.callSequence;
    const items = projectCompact(doc, { ...context, expandHint: "", hookRuns: [{ id: "h1", name: "PreToolUse:Read", durationMs: 200, afterSequence: callSequence - 1, event: "PreToolUse" }] });
    expect(allText(items)).not.toContain("PreToolUse");
  });
});

// bl7 T-HOOKBLOCK Task 3, spec §2.5 "Expanded block" — canon @177046924, appended AFTER the sorted
// member/thinking interleave `expandedMemberItems` above already builds, taking NO part in its sort. Values
// chosen (200ms/200ms) so `toFixed(1)` has no float-edge ambiguity (0.35 would format as "0.3", not "0.4").
describe("bl7 T-HOOKBLOCK Task 3: the expanded cluster's own PreToolUse hook block", () => {
  const oneRead = () => built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
  const readSequence = (doc: TranscriptDocument) => doc.toolEvents()[0]!.callSequence;

  it("(a) header + two per-hook lines, exact gutters, dim, AFTER the member row", () => {
    const doc = oneRead();
    const callSequence = readSequence(doc);
    const hookRuns = [
      { id: "h1", name: "PreToolUse:Read", durationMs: 200, afterSequence: callSequence, event: "PreToolUse" },
      { id: "h2", name: "PreToolUse:Read", durationMs: 200, afterSequence: callSequence, event: "PreToolUse" },
    ];
    const items = projectCompact(doc, { ...FS, hookRuns, expandedFolds: new Set(["read-1"]) });
    const texts = lineTexts(items);
    const iMember = texts.findIndex((t) => t.includes("Read(a.ts)"));
    const iHeader = texts.indexOf("  ⎿  Ran 2 PreToolUse hooks (0.4s)");
    const iHook1 = texts.indexOf("     ⎿ PreToolUse:Read (0.2s)");
    const iHook2 = texts.lastIndexOf("     ⎿ PreToolUse:Read (0.2s)");
    expect(iMember).toBeGreaterThanOrEqual(0);
    expect(iHeader).toBeGreaterThan(iMember);
    expect(iHook1).toBeGreaterThan(iHeader);
    expect(iHook2).toBeGreaterThan(iHook1);
    // Both lines are `kind: "line"`, dim — never `gutter-block` (the per-hook gutter is 7 chars, not one of
    // that kind's two fixed five-column constants), and tagged like every other expanded-cluster row.
    const header = items.find((i) => i.kind === "line" && unlink((i as { line: RenderLine }).line.text) === "  ⎿  Ran 2 PreToolUse hooks (0.4s)")!;
    expect((header as { line: RenderLine }).line.dim).toBe(true);
    expect(header.foldAnchor).toBe("read-1");
    expect(header.expanded).toBe(true);
  });

  it("(b) hookCount 1 renders singular 'hook'", () => {
    const doc = oneRead();
    const callSequence = readSequence(doc);
    const items = projectCompact(doc, { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:Read", durationMs: 200, afterSequence: callSequence, event: "PreToolUse" }], expandedFolds: new Set(["read-1"]) });
    expect(lineTexts(items)).toContain("  ⎿  Ran 1 PreToolUse hook (0.2s)");
  });

  it("(c) zero hooks: the block strings are ABSENT from the expanded output (feature-kill guard)", () => {
    const doc = oneRead();
    const items = projectCompact(doc, { ...FS, expandedFolds: new Set(["read-1"]) }); // no hookRuns at all
    expect(lineTexts(items).join("\n")).not.toContain("PreToolUse");
  });

  it("(d) gates on hookInfos non-empty, NOT on hookTotalMs > 0 (a zero-duration hook still gets the block)", () => {
    const doc = oneRead();
    const callSequence = readSequence(doc);
    const items = projectCompact(doc, { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:Read", durationMs: 0, afterSequence: callSequence, event: "PreToolUse" }], expandedFolds: new Set(["read-1"]) });
    expect(lineTexts(items)).toContain("  ⎿  Ran 1 PreToolUse hook (0.0s)");
    expect(lineTexts(items)).toContain("     ⎿ PreToolUse:Read (0.0s)");
  });
});

// bl7 T-HOOKBLOCK Task 3, review carry-forward (2), AMENDED by the round review (F3): the two rare flush
// paths do NOT share one rule after all. The non-collapsible standalone close (line ~637, e.g. WebFetch)
// still closes on the flushing call's own `callSequence` — that call is never a hook-attribution candidate
// of its own, so nothing changes there. The errored `popsOutOnError` pop-out (line ~622) is different: THIS
// call's own `PreToolUse` pair is stamped `afterSequence === callSequence` (the normal wire order — the hook
// fires between `tool_use` and `tool_result`), which sits exactly on a flat `callSequence` boundary's
// exclusive edge. Canon's raw-message-stream segmenter has already counted that hook by the time it
// evaluates this same pop-out condition (the hook message always precedes the result in wire order), so
// excluding it was the divergence, not the rule. The fix widens the pop-out site's boundary to the closing
// call's `resultSequence` — but ONLY when `windowIsClear` already holds, since a clear window guarantees no
// OTHER atom's call/result sequence can occupy that widened slot (only `C`'s own hook can).
describe("bl7 T-HOOKBLOCK Task 3, carry-forward (amended by round review F3): the pop-out site's widened boundary", () => {
  it("popsOutOnError pop-out flush, window CLEAR: a hook stamped at the failing call's OWN callSequence now counts — no pop-out, hook lands in the surviving run", () => {
    const doc = built(
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("todo-1", "TodoWrite", { todos: [] }), result("todo-1", "board locked", true),
      prose("done"));
    const todoSequence = doc.toolEvents().find((e) => e.id === "todo-1")!.callSequence;
    const options = { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:TodoWrite", durationMs: 300, afterSequence: todoSequence, event: "PreToolUse" }] };
    // Collapsed form (no `expandedFolds`): membership alone proves no relocation happened.
    expect(groupRows(projectCompact(doc, options))[0]!.id).toBe("group:read-1,todo-1:row");
    // Expanded form: the absorbed hook actually renders in the group's own block.
    const expanded = lineTexts(projectCompact(doc, { ...options, expandedFolds: new Set(["read-1"]) }));
    expect(expanded).toContain("  ⎿  Ran 1 PreToolUse hook (0.3s)");
    expect(expanded).toContain("     ⎿ PreToolUse:TodoWrite (0.3s)");
  });

  it("window NOT CLEAR (sibling interference present): a hook on the closing call stays excluded — the fallback boundary is unchanged", () => {
    // Same shape as T8 (b2)'s fixture: read-2's call AND result both land strictly inside
    // `(todo-1.callSequence, todo-1.resultSequence)`, so `windowIsClear` refuses and the boundary must stay
    // at `callSequence` — widening here would risk pulling in a sibling's hook, not just this call's own.
    const doc = built(
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("todo-1", "TodoWrite", { todos: [] }),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"),
      result("todo-1", "board is locked", true),
      prose("done"));
    const todoSequence = doc.toolEvents().find((e) => e.id === "todo-1")!.callSequence;
    const options = { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:TodoWrite", durationMs: 300, afterSequence: todoSequence, event: "PreToolUse" }] };
    expect(groupRows(projectCompact(doc, options))[0]!.id).toBe("group:read-1,read-2,todo-1:row");  // stayed a member regardless (sibling interference)
    const expanded = lineTexts(projectCompact(doc, { ...options, expandedFolds: new Set(["read-1"]) }));
    expect(expanded.join("\n")).not.toContain("PreToolUse");                 // boundary NOT widened: no new misattribution
  });

  it("non-collapsible standalone close: a hook stamped at the closing call's OWN callSequence is still excluded (unchanged by F3)", () => {
    const doc = built(
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("web-1", "WebFetch", { url: "https://example.com" }), result("web-1", "body"));
    const webSequence = doc.toolEvents().find((e) => e.id === "web-1")!.callSequence;
    const items = projectCompact(doc, {
      ...FS, expandedFolds: new Set(["read-1"]),
      hookRuns: [{ id: "h1", name: "PreToolUse:WebFetch", durationMs: 300, afterSequence: webSequence, event: "PreToolUse" }],
    });
    expect(lineTexts(items).join("\n")).not.toContain("PreToolUse");
  });
});

// Re-review G2 (spec D12 causal invariant): `windowIsClear`'s strictly-inside test only catches a sibling
// whose OWN call or result lands inside the failing call's `(from, to)` window — it misses a sibling that
// SPANS the window entirely (issued before `from`, still open past `to`), because neither of ITS endpoints
// is strictly inside either. Such a spanning sibling is not membership "interference" (nothing of its own
// landed between the failing call and its result, so relocation must still proceed), but its pending
// PreToolUse hook can land anywhere across its own open span — including exactly on the failing call's own
// boundary — and that hook is causally the SPANNING sibling's, never the closing call's, WHEN it shares the
// closing call's own tool.
//
// Fix wave 4 (finding J2, superseding wave 3 H2's scoped re-review below): a spanning sibling's mere
// existence does not prove a hook stamped at the failing call's own callSequence belongs to that sibling —
// only a SAME-TOOL spanning sibling could plausibly own it, because `resolveRunHooks`'s per-tool
// `capForTool` (spec D12's unified rule) already refuses to let ANY run claim a `"PreToolUse:Tc"` entry
// without a member of tool `Tc` — a cross-tool spanning sibling can never absorb it regardless of how far
// the boundary widens, so refusing to widen on ITS account was over-cautious. The wave 3 H2 test below
// treated the fixture's spanning A as disqualifying purely because IT existed, independent of tool — that
// was the artifact this wave corrects: `hasSpanningSibling` is now scoped to siblings of the closing call's
// OWN tool, so a cross-tool spanning sibling (Read, here) no longer blocks TodoWrite's own hook from
// widening into TodoWrite's own group, and relocation is correctly suppressed once the hook is retained.
describe("bl7 fix wave 4 (finding J2, unifies waves 2-3): the spanning-sibling widening guard is scoped to the closing call's OWN tool", () => {
  it("A(call1/result6) spans C(call4/err5) but is a DIFFERENT tool (Read, not TodoWrite): widening proceeds, C's own PreToolUse:TodoWrite hook is retained, and relocation is suppressed", () => {
    const doc = built(
      call("a-1", "Read", { file_path: "/work/a.ts" }),                      // opens first, stays open (spans everything below) — a DIFFERENT tool than C
      call("mid-1", "Read", { file_path: "/work/mid.ts" }), result("mid-1"), // an ordinary completed sibling, settles before C
      call("todo-1", "TodoWrite", { todos: [] }), result("todo-1", "board locked", true),
      result("a-1"),                                                        // A finally settles AFTER C's error
      prose("done"));
    const todoSequence = doc.toolEvents().find((e) => e.id === "todo-1")!.callSequence;
    // Stamped at exactly todo-1's own callSequence — the normal-order shape F3's widening exists to catch.
    const options = { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:TodoWrite", durationMs: 300, afterSequence: todoSequence, event: "PreToolUse" }] };
    // Relocation is now SUPPRESSED: todo-1's own hook is retained (see below), so it stays a member of
    // mid-1's run rather than popping out into a standalone row — canon's own "a run that absorbed a hook
    // never relocates its errored member" rule (Task 3, carry-forward (4)), now reachable via a WIDENED
    // boundary instead of only via an earlier member's hook.
    const compact = groupRows(projectCompact(doc, options));
    // A collapsed group carrying hooks emits an extra `:hooks` row alongside its own `:row` (spec §2.5 form 2).
    expect(compact.map((i) => i.id)).toEqual(["group:mid-1,todo-1:row", "group:mid-1,todo-1:hooks", "group:a-1:row"]);
    // The retained hook renders in mid-1's own expanded block — it is todo-1's OWN hook, never A's (A holds
    // no TodoWrite member, so the tool-name guard would refuse it there regardless).
    const expandedMid = lineTexts(projectCompact(doc, { ...options, expandedFolds: new Set(["mid-1"]) }));
    expect(expandedMid).toContain("  ⎿  Ran 1 PreToolUse hook (0.3s)");
    expect(expandedMid).toContain("     ⎿ PreToolUse:TodoWrite (0.3s)");
    // Not A's: A holds only a Read member, and the entry names TodoWrite.
    const expandedA = lineTexts(projectCompact(doc, { ...options, expandedFolds: new Set(["a-1"]) }));
    expect(expandedA.join("\n")).not.toContain("PreToolUse");
  });

  it("same-tool control: a spanning TodoWrite sibling STILL refuses WIDENING, so mid-1's run never claims the entry — but bl8's D5 gate lets d-1's OWN all-silent run claim it on its own merits", () => {
    // Identical shape to the test above, except the spanning sibling D is the SAME tool as the closing call
    // (TodoWrite, not Read) — the one case the unified rule still must refuse: D could just as plausibly own
    // a PreToolUse:TodoWrite entry stamped inside its own wide-open span, so `hasSpanningSibling` still
    // blocks todo-1's own boundary from WIDENING to claim it, and the entry is never swept into mid-1's run
    // that way — todo-1 still pops out of it exactly as before this task.
    //
    // bl8 T-QY Task 2 changes what happens NEXT, though: D is `d-1`, an all-silent TodoWrite run of its own
    // (opened before everything else, settling only after todo-1 pops out and mid-1's run flushes). Before
    // D5, `flush` never even CALLED `resolveRunHooks` for an all-silent run (`visibleMembers > 0` guarded
    // the whole block), so this entry was simply dropped, unclaimed by anyone. D5 resolves `hooks` BEFORE
    // that visibility test, so d-1's own trailing flush now runs `resolveRunHooks` for real — and the entry
    // (stamped at afterSequence 4) legitimately falls inside d-1's OWN causal window (`[1, 6)`, d-1's own
    // settled `resultSequence` as its TodoWrite cap): d-1 is ALSO a TodoWrite member, open across the exact
    // span the entry could plausibly have arrived in, same as cell (k)'s open-member rule. This is NOT the
    // widening path the J2 guard defends against — it is the ordinary per-tool causal rule finding a
    // DIFFERENT, legitimate owner once D5 gives its run a chance to ask at all. Canon's own single-accumulator
    // model would have absorbed this hook into d-1's still-open accumulator too (bl8 research-silentrun-hooks.md).
    const doc = built(
      call("d-1", "TodoWrite", { todos: [] }),                              // opens first, stays open (spans everything below) — the SAME tool as C
      call("mid-1", "Read", { file_path: "/work/mid.ts" }), result("mid-1"),
      call("todo-1", "TodoWrite", { todos: [] }), result("todo-1", "board locked", true),
      result("d-1"),
      prose("done"));
    const todoSequence = doc.toolEvents().find((e) => e.id === "todo-1")!.callSequence;
    const options = { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:TodoWrite", durationMs: 300, afterSequence: todoSequence, event: "PreToolUse" }] };
    const compact = groupRows(projectCompact(doc, options));
    // mid-1 alone (no hooks) plus d-1's own all-silent group, now visible under D5 with the entry absorbed —
    // canon's `BM` clause form (research Part 2.2), rendered as d-1's row's own sole line.
    expect(compact.map((i) => i.id)).toEqual(["group:mid-1:row", "group:d-1:row"]);
    expect(compact.find((i) => i.id === "group:d-1:row")).toMatchObject({ line: { text: "  Ran 1 PreToolUse hook (0.3s)" } });
    // mid-1's OWN expanded content — scoped to its own `foldAnchor`, since the whole-document projection now
    // legitimately contains "PreToolUse" elsewhere (d-1's row) — never mentions the entry: the widening
    // refusal still holds, unaffected by D5.
    const expandedMid = projectCompact(doc, { ...options, expandedFolds: new Set(["mid-1"]) })
      .filter((i) => (i as { foldAnchor?: string }).foldAnchor === "mid-1");
    expect(lineTexts(expandedMid).join("\n")).not.toContain("PreToolUse");
  });

  it("same-tool control (regression, unaffected by this wave): a spanning Read sibling DOES claim a PreToolUse:Read entry once its own settled window resolves it there", () => {
    const doc = built(
      call("a-1", "Read", { file_path: "/work/a.ts" }),
      call("mid-1", "Read", { file_path: "/work/mid.ts" }), result("mid-1"),
      call("todo-1", "TodoWrite", { todos: [] }), result("todo-1", "board locked", true),
      result("a-1"),
      prose("done"));
    const todoSequence = doc.toolEvents().find((e) => e.id === "todo-1")!.callSequence;
    const options = { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:Read", durationMs: 300, afterSequence: todoSequence, event: "PreToolUse" }] };
    const expandedA = lineTexts(projectCompact(doc, { ...options, expandedFolds: new Set(["a-1"]) }));
    expect(expandedA.some((t) => t.includes("PreToolUse:Read"))).toBe(true);
  });
});

// bl7 T-HOOKBLOCK Task 3, review carry-forward (4): canon @162916xxx —
// `if(!(u.hookCount>0||(u.relevantMemories?.length??0)>0)&&B.length>0&&…)` — a cluster that absorbed a
// PreToolUse hook never relocates its errored member out, even when `windowIsClear` would otherwise allow it.
// ccx has no `relevantMemories` counter (unreachable, spec §4), so the OR narrows to the one operand we can
// build: hooks resolved for the run's window up to the failing call's own `callSequence` (the same boundary
// its flush closes on).
describe("bl7 T-HOOKBLOCK Task 3: an errored popsOutOnError call is not relocated out of a run that absorbed a hook (canon @162916xxx)", () => {
  const doc = () => built(
    call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
    call("todo-1", "TodoWrite", { todos: [] }), result("todo-1", "board locked", true),
    prose("done"));

  it("baseline: pops out normally when the window is clear and NO hooks were absorbed", () => {
    const items = groupRows(projectCompact(doc(), FS));
    expect(items[0]!.id).toBe("group:read-1:row");
  });

  it("does NOT pop out when the run already absorbed a PreToolUse hook, even though the window is otherwise clear", () => {
    const readSequence = doc().toolEvents().find((e) => e.id === "read-1")!.callSequence;
    const items = groupRows(projectCompact(doc(), { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:Read", durationMs: 100, afterSequence: readSequence, event: "PreToolUse" }] }));
    expect(items[0]!.id).toBe("group:read-1,todo-1:row");
  });

  // Round review F3: the sibling of the case above, on the call actually BEING considered for relocation
  // (not an earlier member) — the specific edge the finding raised, with no passing-for-the-right-reason
  // coverage before this fix (a hook on an earlier member never touched the widened-boundary code path).
  it("also does NOT pop out when the hook belongs to the CLOSING call itself, not an earlier member", () => {
    const todoSequence = doc().toolEvents().find((e) => e.id === "todo-1")!.callSequence;
    const items = groupRows(projectCompact(doc(), { ...FS, hookRuns: [{ id: "h1", name: "PreToolUse:TodoWrite", durationMs: 100, afterSequence: todoSequence, event: "PreToolUse" }] }));
    expect(items[0]!.id).toBe("group:read-1,todo-1:row");
  });
});

// bl7 T-HOOKBLOCK Task 5 fix, spec §2.5 collapsed-row form 1 (toolRenderer.tsx:918-929, "form 1" in
// task-5-fix-report.md). `segmentRuns` cannot produce this fixture through the real pipeline TODAY: the one
// case with zero `otherClauses` is an all-silent run, and `segmentRuns`'s flush gate drops it before `emit()`
// ever runs (toolFold.ts:532-539, a deliberate, documented divergence — canon instead routes hooks on such a
// run to the standalone hook renderer, out of scope this round). This is acceptable and expected: the fixture
// below is a `FoldGroup` built DIRECTLY, bypassing `segmentRuns` entirely, and pins `groupItems`'/`groupRowLine`'s
// own contract for the day a real member class makes "zero other clauses, nonzero hooks" reachable.
describe("bl7 T-HOOKBLOCK Task 5 fix: collapsed-row form 1 — hooks are the run's ONLY clause (LATENT, pinned at the FoldGroup layer)", () => {
  // Zeroed exactly like `toolFold.test.ts`'s `counts()` helper — every base counter at its empty value, so
  // `foldClauses` returns `[]` (pinned there as "emits nothing for all-zero counts") and the ONLY thing this
  // run has to say is its hooks.
  const hookOnlyGroup = (): FoldGroup => ({
    counts: { readCount: 0, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [], hookCount: 3, hookTotalMs: 450 },
    memberIds: ["hook-only-1"], anchorId: "hook-only-1", anchorSequence: 1, open: false,
  });
  const opts = { ...FS, projection: "compact" as const, verbose: false };

  it("takes over the WHOLE sentence with a bold count, and emits NO separate dim hook line", () => {
    const items = groupItems(hookOnlyGroup(), "published", opts);
    // Form 2's shape (hooks alongside another clause) is a second `gutter-block` item — its total absence
    // here is the form-1/form-2 discriminator: exactly one `line` item, nothing else.
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("line");
    expect(items.some((i) => i.kind === "gutter-block")).toBe(false);
    expect(items[0]!.id).toBe("group:hook-only-1:row");
    const line = (items[0] as { line: RenderLine }).line;
    // The plain (SGR-stripped) sentence: the hook clause IS the whole row, verbatim `hookSentenceClause`
    // wording/punctuation — no ordinary clause, no "and", no trailing hook line.
    expect(unlink(line.text)).toBe("  Ran 3 PreToolUse hooks (0.5s)");
    // The count carries its own `\x1b[1m…\x1b[22m` span with no dim re-open after it — the same bold-count
    // byte pattern `toolRenderer.test.tsx`'s settled-read row pins, here over the hook sentence instead.
    const run = line.segments?.find((s) => "preStyled" in s && s.preStyled === true) as { text: string } | undefined;
    expect(run?.text).toBe("\x1b[38;2;153;153;153m\x1b[2mRan \x1b[1m3\x1b[22m PreToolUse hooks (0.5s)\x1b[22m\x1b[39m");
  });

  it("active form uses the SAME branch (no otherClauses to distinguish it) and still emits one line only", () => {
    const items = groupItems(hookOnlyGroup(), "active", opts);
    expect(items.filter((i) => i.kind === "line" || i.kind === "gutter-block")).toHaveLength(1);
    expect(unlink((items[0] as { line: RenderLine }).line.text)).toContain("Ran 3 PreToolUse hooks (0.5s)");
  });
});
