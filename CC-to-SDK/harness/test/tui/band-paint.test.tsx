// tui/test/band-paint.test.tsx — T-CLICK Task 1 (spec §2.3 D9): the band marker + its full-width paint.
//
// TWO QUESTIONS, TWO HALVES. (1) Does the PROJECTION set `RenderItem.band` on exactly the rows that make up
// an expanded block's visual band — header, result body, the trailing pad row, and every `expandedMemberItems`
// row — while leaving the absorbed-thinking/member margin and the T-SPACE separators unmarked? That is a fact
// about `toolRenderer.tsx` and is checked against the REAL production path (`projectCompact`), the same
// idiom `fold-expand.test.tsx`'s own T-CLUSTER Task 2 cell uses, rather than a hand-rolled literal that could
// silently drift from what the projection actually emits.
//   (2) Does a MARKED row's background actually reach the terminal's last column, and does an unmarked one
// stay exactly as narrow as it always was? That is a fact about `Line.tsx`/`RenderItemView`'s PAINT, and a
// projection-level check cannot see it (a `band: true` flag proves nothing about pixels) — so it is checked
// against a REAL mounted frame (`FullscreenFrame` + `FullscreenViewport`, `ink-testing-library`), the same
// pairing `fold-hitmap.test.tsx`'s header explains is the only instrument that can catch this class of bug.
// A literal `RenderItem[]` fixture stands in for the document there (this file's own concern is the paint,
// not the projection, which part (1) already exercises against the real pipeline).
//
// NEITHER half touches the hitmap or click dispatch (T-CLICK Task 2's job, spec §3): the fold-click suite's
// existing 27 cases, including the blank-tail pins at :707/:714, are asserted unchanged by the gate this
// ticket runs, not re-pinned here.
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { FullscreenViewport } from "../../src/tui/FullscreenViewport.js";
import { Transcript } from "../../src/tui/Transcript.js";
import { TOOL_RESULT_GUTTER, projectCompact, type RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { themeTokens } from "../../src/tui/theme.js";
import { tick } from "./keysTestUtil.js";

// ══ Part 1 — the PROJECTION: `.band` lands on exactly the right rows ═══════════════════════════════════════
const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 80, now: 0 };
const FS = { ...context, fullscreen: true, expandHint: "" };
const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body", isError = false) =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } }) as Record<string, unknown>;
const prose = (text: string, id = `t-${text.slice(0, 6)}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
// The standalone/leading thinking shape T-CLUSTER Task 2's own fixture uses — no `tool_use` riding along.
const leadingThought = (messageId: string, thinking: string) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "thinking", thinking, signature: "sig" }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
const errorLines = (n: number) => Array.from({ length: n }, (_, i) => `err line ${i + 1}`).join("\n");
const isLine = (i: RenderItem): i is Extract<RenderItem, { kind: "line" }> => i.kind === "line";
const isBlockOf = (i: RenderItem, ownerKey: string): i is Extract<RenderItem, { kind: "gutter-block" }> => i.kind === "gutter-block" && i.ownerKey === ownerKey;

// A >10-line error (clickable when collapsed) beside a two-Read cluster with a thought sitting between the
// calls — one document exercising every row class Task 1's marker rule distinguishes: a clickable owner's
// header/body/pad row, a cluster member's header/body, absorbed thinking's margin-then-body, and the
// separators `withLeadingSeparator` inserts ahead of each top-level block.
const doc = () => built(
  prose("hello there"),
  call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
  leadingThought("m-think", "Investigating the files"),
  call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"),
  call("err-1", "Mystery", {}), result("err-1", errorLines(12), true),
  prose("all done"),
);

describe("T-CLICK Task 1: the tool-result owner's header, body, and trailing pad row are banded", () => {
  it("bands the header and gutter-block only once the owner is the clicked-open one", () => {
    const collapsed = projectCompact(doc(), FS);
    const ownerKey = collapsed.find((i): i is Extract<RenderItem, { kind: "gutter-block" }> => i.kind === "gutter-block")!.ownerKey!;

    // Collapsed premise: neither the header nor the body carries the marker yet.
    const collapsedHeader = collapsed.find((i) => isLine(i) && i.line.text.includes("Mystery"));
    const collapsedBlock = collapsed.find((i) => isBlockOf(i, ownerKey));
    expect(collapsedHeader).toBeDefined();
    expect(collapsedBlock).toBeDefined();
    expect(collapsedHeader!.band).not.toBe(true);
    expect(collapsedBlock!.band).not.toBe(true);

    const expanded = projectCompact(doc(), { ...FS, expandedItems: new Set([ownerKey]) });
    const header = expanded.find((i) => isLine(i) && i.line.text.includes("Mystery"));
    const block = expanded.find((i) => isBlockOf(i, ownerKey));
    expect(header).toBeDefined();
    expect(block).toBeDefined();
    expect(header!.band).toBe(true);
    expect(block!.band).toBe(true);
    // The trailing pad row `withExpandedMarker` mints lives INSIDE this one item's body — proving it is
    // present at all is this cell's job; Part 2 proves it actually PAINTS full width.
    expect((block as Extract<RenderItem, { kind: "gutter-block" }>).body.at(-1)!.text).toBe("");
  });
});

describe("T-CLICK Task 1: an expanded fold cluster bands every row except its own leading margins", () => {
  it("marks member headers/bodies and the absorbed-thinking body, but never the margin blanks ahead of them", () => {
    const expanded = projectCompact(doc(), { ...FS, expandedFolds: new Set(["read-1"]) });
    const foldItems = expanded.filter((i) => i.foldAnchor === "read-1");
    expect(foldItems.length).toBeGreaterThan(0);

    // Every row this cluster contributes is either a blank-text MARGIN (the member's own leading blank, or
    // the absorbed-thought's `Box{marginTop}` stand-in) or real content — and the fixture must exercise both,
    // or the invariant below would pass vacuously.
    const margins = foldItems.filter((i) => isLine(i) && i.line.text === "");
    const content = foldItems.filter((i) => !(isLine(i) && i.line.text === ""));
    expect(margins.length).toBeGreaterThan(0);
    expect(content.length).toBeGreaterThan(0);
    for (const m of margins) expect(m.band).not.toBe(true);
    for (const c of content) expect(c.band).toBe(true);

    // The two member Read calls' own result bodies are `gutter-block`s within `content` above — confirm the
    // union actually covers that shape too, not only bare `line` rows.
    expect(content.some((i) => i.kind === "gutter-block")).toBe(true);
  });
});

describe("T-CLICK Task 1: a T-SPACE separator is never part of the band", () => {
  it("carries no `band` regardless of what it precedes", () => {
    const expanded = projectCompact(doc(), { ...FS, expandedItems: new Set(["ignore"]), expandedFolds: new Set(["read-1"]) });
    const seps = expanded.filter((i) => i.id.startsWith("sep:"));
    expect(seps.length).toBeGreaterThan(0);
    for (const s of seps) expect(s.band).not.toBe(true);
  });
});

// ══ Part 2 — the PAINT: a banded row reaches the terminal edge, an unbanded one does not ═══════════════════
// A plain-text (SGR-stripped) width check only proves the PADDING reaches the edge — it would pass exactly
// as well if that padding were uncolored spaces. Canon's rectangle is a real background box (research §1.3),
// so this half asserts the literal `\x1b[48;...` background escape itself is present, and — for the two row
// shapes that carry their OWN leading gutter column ahead of the shared band paint (the `⎿` tool-result
// connector, and a `line`'s inline `l.gutter`, e.g. the absorbed-thinking `"∴ "` bullet) — that the escape
// PRECEDES the gutter glyph, not just the text that follows it. The `tabs.test.tsx`/`line-substrate.test.tsx`
// convention: raw, un-stripped frame bytes, `toContain`/`indexOf` against the literal code.
const COLS = 40;
const dock = <Box flexDirection="column"><Text>dock</Text></Box>;
// A wide `rows` grant (a tall region, a one-line dock) so all eight rows below land inside the sticky window
// whole — this file's concern is per-row paint width, not scroll geometry, which `fold-hitmap.test.tsx` and
// `fold-click.test.tsx`'s TALL_DOC already own.
const scene = (items: readonly RenderItem[]) => (
  <FullscreenFrame mode="fullscreen" rows={40} dock={dock} regionChildren={<>
    <Transcript staticItems={[]} pendingItems={[]} streaming={[] as readonly RenderLine[]} />
    <FullscreenViewport finalizedItems={items} pendingItems={[]} streaming={[] as readonly RenderLine[]} columns={COLS} />
  </>} />
);
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
/** `Line.tsx`'s literal 24-bit background escape for a theme token — `hover.test.tsx`'s/`fold-click.test.tsx`'s
 *  own `sgrBg`, kept local per this suite's no-cross-file-test-imports convention. */
const sgrBg = (rgbToken: string): string => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgbToken)!;
  return `\x1b[48;2;${m[1]};${m[2]};${m[3]}m`;
};
const BAND = sgrBg(themeTokens().userMessageBackgroundHover);

// One of each row class Task 1 distinguishes, in a fixed, known order — position alone locates each row in
// the painted frame (every text here is short of `COLS`, so nothing wraps and the mapping is 1:1). "thought"
// stands in for an absorbed-thinking body row: a `line` item wearing an inline `l.gutter` (`"∴ "`), the SAME
// gutter shape `render.ts`'s `withThinkingGutter` mints in production.
const PAINT_DOC: readonly RenderItem[] = [
  { kind: "line", id: "header", band: true, line: { text: "HEADER" } },                                        // banded header
  { kind: "line", id: "collapsed", line: { text: "COLLAPSED" } },                                              // ordinary row, unchanged
  { kind: "gutter-block", id: "result", gutter: TOOL_RESULT_GUTTER, band: true, body: [{ text: "body row" }, { text: "" }] }, // banded body + pad row (⎿ connector column)
  { kind: "line", id: "thought", foldAnchor: "a1", band: true, line: { text: "thinking text", gutter: { text: "∴ ", dim: true, italic: true } } }, // banded absorbed-thinking row (inline l.gutter)
  { kind: "line", id: "margin", foldAnchor: "a1", line: { text: "" } },                                        // cluster margin, never banded
  { kind: "line", id: "member", foldAnchor: "a1", band: true, line: { text: "MEMBER" } },                      // banded cluster member
  { kind: "line", id: "sep", line: { text: "" } },                                                             // T-SPACE separator shape
];

describe("T-CLICK Task 1: banded rows paint a REAL full-width background, including their own leading gutter columns", () => {
  it("carries the literal background escape edge-to-edge — through the ⎿ connector and the inline l.gutter bullet — on every `band: true` row, and nowhere else", async () => {
    const { lastFrame } = render(scene(PAINT_DOC));
    await settle();
    const rows = (lastFrame() ?? "").split("\n");
    const plainRows = rows.map((r) => r.replace(/\x1b\[[0-9;]*m/g, ""));

    // Fixed row order (PAINT_DOC, one row per entry — nothing here wraps): 0 header, 1 collapsed, 2 body,
    // 3 pad, 4 thought, 5 margin, 6 member, 7 sep.
    const [headerRow, collapsedRow, bodyRow, padRow, thoughtRow, marginRow, memberRow, sepRow] = rows as string[];

    // Premise: the rows actually landed where the fixed fixture order says they should.
    expect(plainRows[0]).toContain("HEADER");
    expect(plainRows[1]).toContain("COLLAPSED");
    expect(plainRows[2]).toContain("body row");
    expect(plainRows[4]).toContain("thinking text");
    expect(plainRows[6]).toContain("MEMBER");

    // Plain-text width: proves padding reaches the edge (the premise every row below is checked against),
    // but NOT that it is colored — that is what the SGR assertions after this block are for.
    expect(plainRows[0]!.length).toBe(COLS);          // header
    expect(plainRows[2]!.length).toBe(COLS);          // body
    expect(plainRows[3]!.length).toBe(COLS);          // pad
    expect(plainRows[4]!.length).toBe(COLS);          // thought
    expect(plainRows[6]!.length).toBe(COLS);          // member
    expect(plainRows[1]!.length).toBe("COLLAPSED".length);
    expect(plainRows[5]!.length).toBeLessThan(COLS);  // margin
    expect(plainRows[7]!.length).toBeLessThan(COLS);  // sep

    // The BACKGROUND itself, on RAW (un-stripped) bytes: a row padded with plain uncolored spaces — exactly
    // what finding 1's unfixed gutter Box/inline `l.gutter` produced under the glyph columns — still passes
    // every plain-text check above but fails these.
    expect(headerRow).toContain(BAND);
    expect(bodyRow).toContain(BAND);
    expect(padRow).toContain(BAND);
    expect(thoughtRow).toContain(BAND);
    expect(memberRow).toContain(BAND);
    expect(collapsedRow).not.toContain(BAND);
    expect(marginRow).not.toContain(BAND);
    expect(sepRow).not.toContain(BAND);

    // The rectangle's LEADING EDGE: the background escape must appear BEFORE the row's own gutter glyph, not
    // merely somewhere later in the row — the exact defect a band that starts only after the gutter produces.
    const bandIdxInBody = bodyRow.indexOf(BAND);
    const glyphIdxInBody = bodyRow.indexOf("⎿");     // TOOL_RESULT_GUTTER's `⎿`
    expect(bandIdxInBody).toBeGreaterThanOrEqual(0);
    expect(glyphIdxInBody).toBeGreaterThan(bandIdxInBody);

    const bandIdxInThought = thoughtRow.indexOf(BAND);
    const glyphIdxInThought = thoughtRow.indexOf("∴"); // the absorbed-thinking `∴` bullet
    expect(bandIdxInThought).toBeGreaterThanOrEqual(0);
    expect(glyphIdxInThought).toBeGreaterThan(bandIdxInThought);
  });
});
