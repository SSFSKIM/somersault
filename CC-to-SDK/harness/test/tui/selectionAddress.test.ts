// test/tui/selectionAddress.test.ts — F10 T-SELECT S4b: the pure selection-address algorithms —
// SelectionAddr/SelectionEndpoint, the side-specific containment lookup, document-order comparison, and the
// two projections (remapSelection / projectSelectionOnto). No React: every case here is a plain function
// call against hand-built HitRow fixtures, so a containment defect is reviewable in isolation from Task 6's
// viewport wiring.
import { describe, it, expect } from "vitest";
import type { HitRow } from "../../src/tui/mouse/hitmap.js";
import {
  locateEndpoint, orderEndpoints, remapSelection, projectSelectionOnto,
  type SelectionEndpoint, type SelectionAddresses,
} from "../../src/tui/mouse/address.js";
import { createSelectionState, type SelectionState } from "../../src/tui/mouse/selection.js";

/** F10 S4 — a local factory for EVERY HitRow literal this file builds, mirroring `hitmap.test.ts`'s and
 *  `selection.test.ts`'s own `mkRow` pattern. Kept HERE (not shared), and used for every fixture row below
 *  (no hand-rolled HitRow object literal anywhere else in this file), so T-HOVER's merge, which adds a
 *  required `ownerKey` field to `HitRow`, has exactly ONE place in this file to extend — this module never
 *  references `ownerKey` itself. */
const mkRow = (overrides: Partial<HitRow> & Pick<HitRow, "text">): HitRow => ({
  itemKey: "k", width: overrides.text.length, gutterWidth: 0, softWrap: "hard", kind: "line",
  charStart: 0, charEnd: overrides.text.length, textStart: 0, ...overrides,
});

describe("F10 S4 — side-specific containment (round-3 F2: one half-open rule loses the trailing grapheme)", () => {
  // One item wrapped into two rows: source [0,10) and [10,20).
  const rows: HitRow[] = [
    mkRow({ itemKey: "i1", text: "0123456789" }),
    mkRow({ itemKey: "i1", text: "abcdefghij", softWrap: "continuation", charStart: 10, charEnd: 20 }),
  ];
  const ord = (k: string) => (k === "i1" ? 0 : undefined);
  const win = { first: 0, last: 0 };
  it("the LOWER endpoint at a wrap boundary takes the FOLLOWING row (charStart <= v < charEnd)", () =>
    expect(locateEndpoint(rows, { itemKey: "i1", charOffset: 10, charEnd: 11 }, "lower", ord, win))
      .toMatchObject({ row: 2, col: 1, virtual: false }));
  it("the UPPER endpoint at the same boundary takes the PRECEDING row's trailing edge (charStart < v <= charEnd)", () =>
    expect(locateEndpoint(rows, { itemKey: "i1", charOffset: 9, charEnd: 10 }, "upper", ord, win))
      .toMatchObject({ row: 1, col: 11, virtual: false }));
  it("the UPPER endpoint at item EOF is the last row's end", () =>
    expect(locateEndpoint(rows, { itemKey: "i1", charOffset: 19, charEnd: 20 }, "upper", ord, win))
      .toMatchObject({ row: 2, col: 11 }));
  it("an UPPER endpoint whose charEnd overruns the item's current length (past EOF, not just AT it) still snaps to the LAST row's end", () =>
    expect(locateEndpoint(rows, { itemKey: "i1", charOffset: 98, charEnd: 99 }, "upper", ord, win))
      .toMatchObject({ row: 2, col: 11 }));
  it("an endpoint past the item's current char count clamps into it (the item shrank)", () =>
    expect(locateEndpoint(rows, { itemKey: "i1", charOffset: 99, charEnd: 100 }, "lower", ord, win))
      .toMatchObject({ row: 2, col: 11 }));
  it("an item that is off the window but still in the document is VIRTUAL, clamped to the edge it left by", () =>
    expect(locateEndpoint(rows, { itemKey: "i0", charOffset: 3, charEnd: 4 }, "lower", (k) => (k === "i0" ? -1 : 0), win))
      .toMatchObject({ virtual: true, edge: -1, row: 1 }));
  it("an item absent from the DOCUMENT is undefined — the one case that clears", () =>
    expect(locateEndpoint(rows, { itemKey: "gone", charOffset: 1, charEnd: 2 }, "lower", () => undefined, win)).toBeUndefined());
});

describe("F10 S4 — a gutter block's hard \\n gap and its empty rows (round-3 F2 fallout, extended to multi-row blocks)", () => {
  // A two-body-row gutter block: "readme" (6 chars) + "\n" + "second" (6 chars) — the \n rides row A's own
  // end per Task 4's sourceRowRanges contract, so row A is [0,7) and row B is [7,13).
  const gutterRows: HitRow[] = [
    mkRow({ itemKey: "g1", text: "readme", charStart: 0, charEnd: 7, kind: "gutter-block" }),
    mkRow({ itemKey: "g1", text: "second", charStart: 7, charEnd: 13, kind: "gutter-block" }),
  ];
  const gord = (k: string) => (k === "g1" ? 0 : undefined);
  const gwin = { first: 0, last: 0 };
  it("an upper endpoint whose value falls on the \\n between two body rows snaps to the preceding row's end", () =>
    expect(locateEndpoint(gutterRows, { itemKey: "g1", charOffset: 6, charEnd: 7 }, "upper", gord, gwin))
      .toMatchObject({ row: 1, col: 7 }));

  // A blank hard line contributes a zero-width row (charStart === charEnd) — Task 4's own contract for what
  // a blank line mints. Neither containment predicate can EVER match it (both require the strict-inequality
  // side to have room), so it is invisible to the binary search regardless of which value is probed.
  const blankRows: HitRow[] = [
    mkRow({ itemKey: "g2", text: "readme", charStart: 0, charEnd: 7, kind: "gutter-block" }),
    mkRow({ itemKey: "g2", text: "", width: 0, charStart: 7, charEnd: 7, kind: "gutter-block" }),
    mkRow({ itemKey: "g2", text: "second", charStart: 7, charEnd: 13, kind: "gutter-block" }),
  ];
  const bord = (k: string) => (k === "g2" ? 0 : undefined);
  const bwin = { first: 0, last: 0 };
  it("an empty hard row is skipped by the LOWER rule, which lands on the FOLLOWING row", () =>
    expect(locateEndpoint(blankRows, { itemKey: "g2", charOffset: 7, charEnd: 8 }, "lower", bord, bwin))
      .toMatchObject({ row: 3, col: 1 }));
  it("the same value, on the UPPER rule, is skipped in the OTHER direction — the PRECEDING row's end", () =>
    expect(locateEndpoint(blankRows, { itemKey: "g2", charOffset: 6, charEnd: 7 }, "upper", bord, bwin))
      .toMatchObject({ row: 1, col: 7 }));
});

describe("F10 S4 — orderEndpoints: document position first, source offset second, never the anchor/focus role", () => {
  const ord = (k: string) => (k === "i1" ? 0 : k === "i2" ? 1 : undefined);
  it("a pair backwards BY ITEM is returned in document order", () => {
    const a: SelectionEndpoint = { itemKey: "i2", charOffset: 5, charEnd: 6 };
    const b: SelectionEndpoint = { itemKey: "i1", charOffset: 2, charEnd: 3 };
    expect(orderEndpoints(a, b, ord)).toEqual([b, a]);
  });
  it("a pair backwards BY OFFSET within the same item is returned in document order", () => {
    const a: SelectionEndpoint = { itemKey: "i1", charOffset: 9, charEnd: 10 };
    const b: SelectionEndpoint = { itemKey: "i1", charOffset: 2, charEnd: 3 };
    expect(orderEndpoints(a, b, ord)).toEqual([b, a]);
  });
});

describe("F10 S4 — remapSelection: the publish-time remap, mutating a live SelectionState", () => {
  const rows: HitRow[] = [mkRow({ itemKey: "i1", text: "0".repeat(20) })];
  const ord = (k: string) => (k === "i1" ? 0 : k === "i0" ? -1 : undefined);
  const win = { first: 0, last: 0 };

  it("'ok': orders by DOCUMENT position regardless of which argument was 'anchor', and writes both cells", () => {
    // `anchor` names the numerically HIGHER offset here — a backward drag — so a role-based write would be
    // wrong; the resulting `state.anchor` must still be the document-LOWER endpoint.
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "i1", charOffset: 15, charEnd: 16 },
      focus: { itemKey: "i1", charOffset: 2, charEnd: 3 },
      span: null,
    };
    const state = createSelectionState();
    expect(remapSelection(state, addrs, rows, ord, win)).toBe("ok");
    expect(state.anchor).toEqual({ row: 1, col: 3 });   // lower endpoint: charOffset 2 → column 3
    expect(state.focus).toEqual({ row: 1, col: 17 });   // upper endpoint: charEnd 16 → column 17
    expect(state.anchorSpan).toBeNull();
  });

  it("'ok' with no focus (a plain click) writes only the anchor and leaves focus null", () => {
    const addrs: SelectionAddresses = { anchor: { itemKey: "i1", charOffset: 4, charEnd: 5 }, focus: null, span: null };
    const state = createSelectionState();
    expect(remapSelection(state, addrs, rows, ord, win)).toBe("ok");
    expect(state.anchor).toEqual({ row: 1, col: 5 });
    expect(state.focus).toBeNull();
  });

  it("'ok' carries a live multi-click span through, re-located the same way", () => {
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "i1", charOffset: 4, charEnd: 5 },
      focus: null,
      span: { lo: { itemKey: "i1", charOffset: 0, charEnd: 1 }, hi: { itemKey: "i1", charOffset: 20, charEnd: 20 }, kind: "line" },
    };
    const state = createSelectionState();
    expect(remapSelection(state, addrs, rows, ord, win)).toBe("ok");
    expect(state.anchorSpan).toEqual({ lo: { row: 1, col: 1 }, hi: { row: 1, col: 21 }, kind: "line" });
  });

  it("'gone' when an endpoint's itemKey has left the document, and the live state is cleared", () => {
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "vanished", charOffset: 1, charEnd: 2 }, focus: null, span: null,
    };
    const state = createSelectionState();
    state.anchor = { row: 5, col: 5 }; // a stale pre-existing selection
    expect(remapSelection(state, addrs, rows, () => undefined, win)).toBe("gone");
    expect(state.anchor).toBeNull();
    expect(state.focus).toBeNull();
    expect(state.anchorSpan).toBeNull();
  });

  it("'offscreen' when both ends are virtual off the SAME edge, and the live state is left untouched", () => {
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "i0", charOffset: 1, charEnd: 2 },
      focus: { itemKey: "i0", charOffset: 8, charEnd: 9 },
      span: null,
    };
    const state = createSelectionState();
    state.anchor = { row: 9, col: 9 }; // sentinel: must survive "retain, paint nothing"
    expect(remapSelection(state, addrs, rows, ord, win)).toBe("offscreen");
    expect(state.anchor).toEqual({ row: 9, col: 9 });
  });
});

describe("F10 S4 — projectSelectionOnto: the same projection onto an arbitrary row array, non-mutating", () => {
  const rows: HitRow[] = [mkRow({ itemKey: "i1", text: "0".repeat(20) })];
  const ord = (k: string) => (k === "i1" ? 0 : undefined);

  it("returns a FRESH SelectionState when the addresses resolve", () => {
    const addrs: SelectionAddresses = {
      anchor: { itemKey: "i1", charOffset: 2, charEnd: 3 },
      focus: { itemKey: "i1", charOffset: 10, charEnd: 11 },
      span: null,
    };
    const result = projectSelectionOnto(rows, addrs, ord) as SelectionState;
    expect(result).not.toBeNull();
    expect(result.anchor).toEqual({ row: 1, col: 3 });
    expect(result.focus).toEqual({ row: 1, col: 12 });
  });

  it("returns null when the addresses do not resolve there at all", () => {
    const addrs: SelectionAddresses = { anchor: { itemKey: "gone", charOffset: 0, charEnd: 1 }, focus: null, span: null };
    expect(projectSelectionOnto(rows, addrs, () => undefined)).toBeNull();
  });
});
