// test/tui/selectionCapture.test.ts — F10 T-SELECT S6: `documentSelectionText` (src/tui/mouse/documentText.ts),
// the pure document-walk extractor Task 8 adds so a copy can capture rows an auto-scrolled sweep dragged
// past the painted window. No React here — `selectionAutoScroll.test.tsx` proves the wiring (the timer, the
// real `ViewportHitmap.selectedText()` ref) and carries the MOUNTED counterpart of case (a)'s own claim;
// this file proves the ALGORITHM against hand-built `HitRow` fixtures, `selectionAddress.test.ts`'s own style.
//
// THE CENTRAL CLAIM (brief, verbatim): "the document-walk extractor must agree byte-for-byte with
// `extractText` for a fully visible selection." Case (a) below does not just call `documentSelectionText`
// and trust it — it builds the SAME selection a SECOND, INDEPENDENT way (a plain numeric `SelectionState`,
// the exact machinery `selectedSpans`/`extractText` already use for the live paint) and asserts the two
// strings are `toBe`-identical. A documentText.ts that quietly diverged from the paint path (a different
// join rule, an off-by-one in its own re-derivation) would still pass a self-referential test; it cannot
// pass this one.
import { describe, it, expect } from "vitest";
import type { HitRow } from "../../src/tui/mouse/hitmap.js";
import type { SelectionAddresses } from "../../src/tui/mouse/address.js";
import { remapSelection } from "../../src/tui/mouse/address.js";
import { createSelectionState, selectedSpans, type SelectionState } from "../../src/tui/mouse/selection.js";
import { extractText } from "../../src/tui/mouse/extract.js";
import { documentSelectionText } from "../../src/tui/mouse/documentText.js";

// `selectionAddress.test.ts`'s own `mkRow` factory, reused verbatim (this file's fixtures are ASCII,
// gutter-free, single-width rows throughout, so column N is always char index N-1).
const mkRow = (overrides: Partial<HitRow> & Pick<HitRow, "text">): HitRow => ({
  itemKey: "k", ownerKey: overrides.itemKey ?? "k", width: overrides.text.length, gutterWidth: 0, softWrap: "hard", kind: "line",
  charStart: 0, charEnd: overrides.text.length, textStart: 0, clickable: false, ...overrides,
});

// Five single-row items, each its own distinct 10-character alphabet — a document deep enough that a
// 3-row "window" (i2..i4) genuinely leaves i0/i1 off it, the shape Task 8's own off-window capture exists
// for. `ord` is the one DOCUMENT ordinal function every case shares.
const ITEM = { i0: "0123456789", i1: "ABCDEFGHIJ", i2: "abcdefghij", i3: "KLMNOPQRST", i4: "klmnopqrst" };
const documentRows: readonly HitRow[] = (Object.keys(ITEM) as (keyof typeof ITEM)[]).map((k) => mkRow({ itemKey: k, text: ITEM[k] }));
const windowRows: readonly HitRow[] = documentRows.slice(2); // [i2, i3, i4] — document ordinals 2..4
const ord = (k: string): number | undefined => {
  const at = (Object.keys(ITEM) as string[]).indexOf(k);
  return at < 0 ? undefined : at;
};

describe("F10 S6 — documentSelectionText: byte-for-byte parity with the paint path, for a wholly visible selection", () => {
  it("agrees with a SECOND, independently-built numeric SelectionState over the same window", () => {
    // Independent construction #1 — the paint path's own machinery, numeric cells directly (no addresses
    // involved at all): anchor at i2's column 3 (char index 2), focus at i3's column 5 (char index 4).
    const state: SelectionState = createSelectionState();
    state.anchor = { row: 1, col: 3 };
    state.focus = { row: 2, col: 5 };
    const viaWindow = extractText(selectedSpans(state, windowRows), windowRows);
    expect(viaWindow.length).toBeGreaterThan(0); // premise: the hand-built cells really do select something

    // Independent construction #2 — the SAME two grapheme positions, named as durable addresses instead of
    // screen cells, run through `documentSelectionText`.
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "i2", charOffset: 2, charEnd: 3 },
      focus: { itemKey: "i3", charOffset: 4, charEnd: 5 },
      span: null,
    };
    const viaAddress = documentSelectionText(windowRows, addrs, ord);
    expect(viaAddress).toBe(viaWindow);
  });
});

describe("F10 S6 — off-window capture: the document walk reaches rows a window-bounded one cannot", () => {
  it("a lower endpoint above the window: the DOCUMENT call returns the off-screen text too; the WINDOW call (real windowOrdinals) returns only the visible part", () => {
    // A clean full-row sweep — i0's first char through i3's last — so every span below is a FULL row and
    // no partial-column snapping arithmetic is in play.
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "i0", charOffset: 0, charEnd: 1 },
      focus: { itemKey: "i3", charOffset: 9, charEnd: 10 },
      span: null,
    };

    const docText = documentSelectionText(documentRows, addrs, ord);
    expect(docText).toBe(`${ITEM.i0}\n${ITEM.i1}\n${ITEM.i2}\n${ITEM.i3}`); // i0 is off-window, and it's here

    // The WINDOW's own view of the identical addresses, through the REAL windowed path (`remapSelection`,
    // the same function `FullscreenViewport`'s paint calls every render) with windowRows' TRUE ordinal
    // range — not `documentSelectionText` handed a truncated array (which has no notion of "off this
    // array's edge but still earlier in the document" and would clamp to the wrong side).
    const winState = createSelectionState();
    const verdict = remapSelection(winState, addrs, windowRows, ord, { first: 2, last: 4 });
    expect(verdict).toBe("ok"); // one end (i3) is genuinely on the window; not the "both off" offscreen case
    const winText = extractText(selectedSpans(winState, windowRows), windowRows);
    expect(winText).toBe(`${ITEM.i2}\n${ITEM.i3}`); // i0/i1 — off this window — are NOT in this string
    expect(docText).not.toBe(winText);
    expect(docText.length).toBeGreaterThan(winText.length);
  });
});

describe("F10 S6 — the join rule: continuation joins with nothing, a hard row joins with \\n (extract.ts:36-49)", () => {
  it("a soft-wrapped item's two rows join with NO separator", () => {
    const wrapped: readonly HitRow[] = [
      mkRow({ itemKey: "w1", text: "0123456789", charStart: 0, charEnd: 10 }),
      mkRow({ itemKey: "w1", text: "ABCDEFGHIJ", charStart: 10, charEnd: 20, softWrap: "continuation" }),
    ];
    const wordinal = (k: string) => (k === "w1" ? 0 : undefined);
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "w1", charOffset: 0, charEnd: 1 },
      focus: { itemKey: "w1", charOffset: 19, charEnd: 20 },
      span: null,
    };
    expect(documentSelectionText(wrapped, addrs, wordinal)).toBe("0123456789ABCDEFGHIJ"); // no \n, no space
  });

  it("two separate HARD-row items join WITH \\n (the multi-item case above already carries this — pinned again in isolation)", () => {
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "i2", charOffset: 0, charEnd: 1 },
      focus: { itemKey: "i3", charOffset: 9, charEnd: 10 },
      span: null,
    };
    const text = documentSelectionText(windowRows, addrs, ord);
    expect(text).toBe(`${ITEM.i2}\n${ITEM.i3}`);
    expect(text).toContain("\n");
  });
});

describe("F10 S6 — addresses that resolve nowhere", () => {
  it("an itemKey absent from the document returns \"\", never throws", () => {
    const addrs: SelectionAddresses = { anchor: { itemKey: "ghost", charOffset: 0, charEnd: 1 }, focus: null, span: null };
    expect(documentSelectionText(documentRows, addrs, () => undefined)).toBe("");
  });
});
