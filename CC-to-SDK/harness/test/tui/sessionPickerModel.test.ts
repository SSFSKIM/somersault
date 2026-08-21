// tui/test/sessionPickerModel.test.ts — the pure model layer that is not SessionPicker.tsx itself
// (session-picker.test.tsx owns that component and the in-pane `previewItems` it still calls). This file
// is T-RESUME T1's own: canon's full-screen `/resume` view (`yvc` L583551) needs a DIFFERENT projection
// (detail-all, not the in-pane's compact fold) and a DIFFERENT window (a row budget the caller supplies,
// not the fixed `PREVIEW_ROWS` the pane still uses) — `transcriptItems` below is that, plus the tagged
// `PreviewLoad` the picker's loader now resolves.
import { describe, it, expect } from "vitest";
import { transcriptItems, type PreviewLoad } from "../../src/tui/sessionPickerModel.js";
import { projectCompact, projectPending } from "../../src/tui/toolRenderer.js";
import { replayDocument } from "../../src/tui/replay.js";
import { previewProjection } from "../../src/tui/sessionPickerModel.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

// The same tiny SDK-shaped fixtures `toolRenderer.test.tsx` and `session-picker.test.tsx` already use —
// `replayDocument` (which `transcriptItems` calls internally) reads exactly this envelope off disk.
const call = (id: string, name: string, input: unknown) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content: string, isError = false) =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });
const prose = (text: string, id = `t-${text}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } });
const assistantText = (text: string) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] } });

/** The itemRows arithmetic `transcriptItems` and `previewTail` both run: a line is one physical row, a
 *  gutter block is its (already-wrapped) body's row count. */
const paintedRows = (items: readonly RenderItem[]): number =>
  items.reduce((n, i) => n + (i.kind === "line" ? 1 : Math.max(1, i.body.length)), 0);

describe("transcriptItems — canon's full-screen /resume window (T-RESUME T1, D-W9)", () => {
  it("projects detail-all: an expanded-tool turn's error body is UNBOUNDED, where the old compact path clips it and hides the marker's own last line", () => {
    // LT15 (toolRenderer.tsx): a generic error clips to ERROR_PHYSICAL_ROWS=10 physical lines in compact,
    // unbounded in detail-all. Fifteen lines makes line 11 a body row detail-all keeps and compact provably
    // cannot — compact would have to show it AND the "…+N lines" marker in the same row budget, and it never
    // shows both.
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i}`);
    const msgs = [call("x-1", "DoSomething", {}), result("x-1", lines.join("\n"), true), prose("done")];
    const { items } = transcriptItems(msgs, { width: 80, budget: 200 });
    expect(items.some((i) => i.kind === "gutter-block")).toBe(true);
    expect(JSON.stringify(items)).toContain("line 14");                    // the 15th line: detail-all is unbounded
    expect(JSON.stringify(items)).not.toContain("+5 lines");               // …and never needs the compact marker
    // THE OLD PATH, side by side: `projectCompact` (what the in-pane `previewItems` still runs) clips the
    // same error to its first ERROR_PHYSICAL_ROWS=10 lines plus a "…+N lines" marker — line 14 is a body row
    // the compact projection provably lacks.
    const document = replayDocument(msgs, { width: 80, frame: false });
    const context = previewProjection(80);
    const compact = [...projectCompact(document, context), ...projectPending(document, context, new Set())];
    expect(JSON.stringify(compact)).not.toContain("line 14");
    expect(JSON.stringify(compact)).toContain("+5 lines");
  });

  it("tail-anchors to the budget: 300 single-line messages at budget 200 start no earlier than message 100", () => {
    const msgs = Array.from({ length: 300 }, (_, i) => assistantText(`reply number ${i}`));
    const { items } = transcriptItems(msgs, { width: 60, budget: 200 });
    const first = items.find((i): i is Extract<RenderItem, { kind: "line" }> => i.kind === "line");
    expect(first).toBeDefined();
    const match = first!.line.text.match(/reply number (\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(100);
    // The tail is anchored on the true LAST message — never blind before it, unlike the raw-window cut.
    expect(JSON.stringify(items)).toContain("reply number 299");
  });

  it("reads at most 2×budget raw messages — a session far longer than that never sees its earliest rows", () => {
    const msgs = Array.from({ length: 1000 }, (_, i) => assistantText(`row ${i}`));
    const { items } = transcriptItems(msgs, { width: 60, budget: 50 });
    // 2×50 = 100 raw messages read (rows 900..999); nothing before row 900 can possibly appear.
    expect(JSON.stringify(items)).not.toContain('"row 899"');
    expect(JSON.stringify(items)).toContain("row 999");
  });

  it("physically fits an injected small fullscreen budget by PAINTED rows, not raw item count (plan-review catch)", () => {
    // A run of short one-liners around ONE very wide line that only becomes many rows once actually
    // wrapped at `width` — the FSW T17 bug class: counting the unwrapped item as "one row" would let this
    // single message alone blow a 5-row budget wide open once painted.
    const wide = "zzzzzzzzzz ".repeat(20).trim(); // wraps into several rows at width 20
    const msgs = [
      assistantText("alpha"), assistantText("bravo"), assistantText("charlie"),
      assistantText(wide),
      assistantText("delta"),
    ];
    const budget = 5;
    const { items } = transcriptItems(msgs, { width: 20, budget });
    // The whole point: it FITS. A naive item-count (not row-count) window would have kept all 5 raw
    // messages, painting far more than 5 rows once `wide` wrapped.
    expect(paintedRows(items)).toBeLessThanOrEqual(budget);
    // And it fits BECAUSE painted rows were counted, not because the window happened to land on item
    // boundaries: the wrapped `wide` line's rows crowded out the earlier short ones.
    expect(JSON.stringify(items)).not.toContain("alpha");
    // Canon's own non-goal (spec R-1): no in-view "more above" indicator exists in this view at all — the
    // return shape has nowhere to carry one, and nothing resembling upstream's own copy for it appears.
    expect(JSON.stringify(items)).not.toMatch(/more above/i);
  });

  it("returns just { items } — no hidden/truncated count, unlike the in-pane PreviewPane shape", () => {
    const { items, ...rest } = transcriptItems([assistantText("hi")], { width: 60, budget: 200 });
    expect(items.length).toBeGreaterThan(0);
    expect(Object.keys(rest)).toEqual([]);
  });
});

describe("PreviewLoad — the tagged preview state (T-RESUME T1)", () => {
  it("is exactly the three-arm union the spec names, and a consumer can switch on `.state` alone", () => {
    const arms: PreviewLoad[] = [{ state: "loading" }, { state: "loaded", messages: [1, 2] }, { state: "failed", error: "boom" }];
    const describe = (l: PreviewLoad): string => {
      switch (l.state) {
        case "loading": return "…";
        case "loaded": return `${l.messages.length} messages`;
        case "failed": return `error: ${l.error}`;
      }
    };
    expect(arms.map(describe)).toEqual(["…", "2 messages", "error: boom"]);
  });
});
