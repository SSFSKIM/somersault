// test/tui/settings-dialog.test.tsx — Wave S t5 (EP-S4b): the Config tab's list is a real `Select` now, so it
// WINDOWS from the height it is given, reports what it clipped with upstream's counted indicators, and answers
// the four paging keys it never had. `test/tui/settingsRows.test.ts` covers the PURE row model (buildRows /
// filterRows / cycleEnum) and is deliberately not the file this extends — nothing there renders a component.
//
// W-S3 governs the shape: the fix is the MIGRATION, not a pair of hand-bound paging handlers. Binding
// pageup/pagedown onto a list that renders every row it has is the "resolves but moves nothing" defect F2
// exists to remove — with five rows and no window there is no page to turn.
//
// Rendered bare this dialog has no input path at all (every scope/action/fallback hook is a no-op without a
// `<KeymapProvider>` above it), so every render goes through `renderWithKeymap`, and every key is written only
// after a tick — Ink's input subscription is a passive effect (harness/CLAUDE.md).
import React from "react";
import { Box } from "ink";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { SettingsDialog, SETTINGS_CHROME_ROWS, settingsVisibleRows } from "../../src/tui/SettingsDialog.js";
import { POINTER } from "../../src/tui/select/Select.js";

const frame = (f: () => string | undefined) => f() ?? "";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const props = () => ({
  tab: "Config", onTabChange: () => {}, mode: "default", thinkLevel: "default", outputStyle: "default",
  onDone: () => {}, applyMode: async () => {}, setThink: async () => {}, applyOutputStyle: async () => {},
  fetchStatus: async () => [], fetchUsage: async () => [], fetchStats: async () => [],
  onOpenModelPicker: () => {}, savePrefs: () => {},
});

/** The label on the row carrying the `❯` gutter — f6-acceptance.test.tsx's `focusedRow`, which is not exported
 *  from there. Reads from the FIRST pointer on the line so the frame's `│` border rule does not get in. */
const focusedRowLabel = (f: () => string | undefined): string => {
  const line = plain(frame(f)).split("\n").find((l) => l.includes(POINTER));
  return line === undefined ? "" : line.slice(line.indexOf(POINTER) + POINTER.length).trim();
};
/** How many of the five Config rows the frame is currently painting. Matched on the row's GUTTER + label, not
 *  on the bare label: the gutter is `❯` on the focused row, `↑`/`↓` on a window edge that has more beyond it
 *  (Select.tsx:282-284) and a space otherwise, and a bare-label match would also count the `/` query's echo. */
const ROW_LABELS = ["Theme", "Model", "Output style", "Default permission mode", "Thinking mode"];
const shownRows = (f: () => string | undefined): number =>
  ROW_LABELS.filter((label) => new RegExp(`[${POINTER}↑↓ ] ${label}\\b`).test(plain(frame(f)))).length;

describe("SettingsDialog — the Config list windows from the height it is given (A6)", () => {
  it("windows the Config list and reports what it clipped", async () => {
    const r = render(<SettingsDialog {...props()} rows={11} columns={80} />);
    await waitFor(() => frame(r.lastFrame).includes("Theme"));
    // The 5 Config rows cannot all fit under a frame this short.
    expect(plain(frame(r.lastFrame))).toMatch(/↓ \d+ more below/);
    expect(shownRows(r.lastFrame)).toBeLessThan(5);
    r.unmount();
  });

  it("shows every row and neither indicator when the pane is tall enough", async () => {
    const r = render(<SettingsDialog {...props()} rows={40} columns={80} />);
    await waitFor(() => frame(r.lastFrame).includes("Theme"));
    expect(shownRows(r.lastFrame)).toBe(5);
    expect(plain(frame(r.lastFrame))).not.toMatch(/more below/);
    expect(plain(frame(r.lastFrame))).not.toMatch(/more above/);
    r.unmount();
  });

  // The window is a FUNCTION of the height, not two states. Two heights that differ by one row must differ by
  // one visible row and by one in the counted indicator — a constant satisfies neither.
  it("grows the window one row per row of pane, and counts the clipped rows", async () => {
    const a = render(<SettingsDialog {...props()} rows={14} columns={80} />);
    await waitFor(() => frame(a.lastFrame).includes("Theme"));
    expect(shownRows(a.lastFrame)).toBe(settingsVisibleRows(14));
    expect(plain(frame(a.lastFrame))).toContain(`↓ ${5 - settingsVisibleRows(14)} more below`);
    a.unmount();
    const b = render(<SettingsDialog {...props()} rows={15} columns={80} />);
    await waitFor(() => frame(b.lastFrame).includes("Theme"));
    expect(shownRows(b.lastFrame)).toBe(settingsVisibleRows(15));
    expect(settingsVisibleRows(15)).toBe(settingsVisibleRows(14) + 1);
    expect(plain(frame(b.lastFrame))).toContain(`↓ ${5 - settingsVisibleRows(15)} more below`);
    b.unmount();
  });

  it("draws `↑ N more above` once the cursor has scrolled the window off the top", async () => {
    const r = render(<SettingsDialog {...props()} rows={13} columns={80} />);
    await waitFor(() => frame(r.lastFrame).includes("Theme"));
    r.stdin.write("\x1b[F");                                     // end — the last row, window at the bottom
    await waitFor(() => focusedRowLabel(r.lastFrame).startsWith("Thinking mode"));
    expect(plain(frame(r.lastFrame))).toMatch(/↑ \d+ more above/);
    expect(plain(frame(r.lastFrame))).not.toMatch(/more below/);
    r.unmount();
  });

  it("moves the selection with the paging keys", async () => {
    const r = render(<SettingsDialog {...props()} rows={11} columns={80} />);
    await waitFor(() => focusedRowLabel(r.lastFrame) !== "");
    const before = focusedRowLabel(r.lastFrame);
    r.stdin.write("\x1b[6~");                                    // pagedown
    await tick();
    expect(focusedRowLabel(r.lastFrame)).not.toBe(before);
    r.stdin.write("\x1b[H");                                     // home
    await tick();
    expect(focusedRowLabel(r.lastFrame).startsWith("Theme")).toBe(true);
    r.stdin.write("\x1b[F");                                     // end
    await tick();
    expect(focusedRowLabel(r.lastFrame).startsWith("Thinking mode")).toBe(true);
    r.stdin.write("\x1b[5~");                                    // pageup
    await tick();
    expect(focusedRowLabel(r.lastFrame).startsWith("Thinking mode")).toBe(false);
    r.unmount();
  });

  // The gutter is the `Select`'s now. Reproducing the old `❯ `/`  ` prefix inside the row body would render
  // `❯ ❯ Theme` and quietly break every existing frame assertion that greps for `❯ Theme`.
  it("draws exactly one pointer on the focused row", async () => {
    const r = render(<SettingsDialog {...props()} rows={40} columns={80} />);
    await waitFor(() => frame(r.lastFrame).includes("Theme"));
    expect(plain(frame(r.lastFrame))).toContain(`${POINTER} Theme`);
    expect(plain(frame(r.lastFrame))).not.toContain(`${POINTER} ${POINTER}`);
    r.unmount();
  });

  it("leaves the / search surface exactly as it was", async () => {
    const r = render(<SettingsDialog {...props()} rows={24} columns={80} />);
    await waitFor(() => frame(r.lastFrame).includes("Theme"));
    r.stdin.write("/");
    await waitFor(() => plain(frame(r.lastFrame)).includes("Search settings…"));
    for (const ch of "th") { r.stdin.write(ch); await tick(); }   // must land in the query, not move a cursor
    await tick();
    const f = plain(frame(r.lastFrame));
    expect(f).toContain("Type to filter");
    expect(f).toContain("Theme");
    expect(f).toContain("Thinking mode");
    // No `Select` is mounted while the query is open, so nothing carries a pointer and nothing was windowed.
    expect(f).not.toContain(POINTER);
    expect(f).not.toMatch(/more below/);
    r.unmount();
  });

  // The search picks a ROW, not an index — which is why the focus is keyed by row id. Enter closes the query,
  // remounts the `Select`, and `defaultFocusValue` must land on what the search selected.
  it("hands the row the search picked back to the remounted list", async () => {
    const r = render(<SettingsDialog {...props()} rows={24} columns={80} />);
    await waitFor(() => frame(r.lastFrame).includes("Theme"));
    r.stdin.write("/");
    await waitFor(() => plain(frame(r.lastFrame)).includes("Search settings…"));
    for (const ch of "output") { r.stdin.write(ch); await tick(); }
    await waitFor(() => plain(frame(r.lastFrame)).includes("Output style"));
    r.stdin.write("\r");
    await waitFor(() => !plain(frame(r.lastFrame)).includes("Type to filter"));
    expect(focusedRowLabel(r.lastFrame).startsWith("Output style")).toBe(true);
    r.unmount();
  });

  it("takes its chrome budget from an enumeration, and never returns a window of zero", () => {
    // 11 = 7 unconditional box rows + 2 (the most of the three conditional rows that can coexist — the
    // warning hangs off the LAST option, so it and `↓ N more below` are mutually exclusive) + 1 ChatStatusBar
    // + 1 for Ink's `>=`. It was 12 until the t5 review; each expectation below is recomputed, not adjusted.
    // The mutual exclusion is real and the 2 is still one short in one state — `↑ N more above` and the
    // warning CAN coexist — which the row-clip round measured and left as a stated residual with its two
    // closures priced; see the constant's own docblock. That is a budget question, not this pin's.
    expect(SETTINGS_CHROME_ROWS).toBe(11);
    expect(settingsVisibleRows(24)).toBe(13);                    // 24 − 11
    expect(settingsVisibleRows(13)).toBe(2);                     // 13 − 11
    expect(settingsVisibleRows(12)).toBe(1);                     // 12 − 11
    expect(settingsVisibleRows(11)).toBe(1);                     // the floor, not 0 — a one-row list beats none
    expect(settingsVisibleRows(4)).toBe(1);
  });
});

// ── ROW-CLIP ROUND — THE HORIZONTAL HALF OF THE SAME WINDOW ───────────────────────────────────────────────
// The window reserves ROWS and counts OPTIONS, which only adds up while ONE OPTION IS ONE LINE. The Model row
// breaks it at a narrow width: `Model` + `Default (recommended)` + the `For a specific model ID, use /model.`
// hint is 67 columns against a body of `columns − 6`, so below 73 it takes a second LINE while still counting
// as one option — and measured on the non-debug clear-counting instrument (see `SETTINGS_ROW_INSET`) the
// composed ChatApp frame behind `/config` then drew a full-screen `clearTerminal` at panes 12, 13 and 14 at
// both 60 and 70 columns. The repair is the clip in `RowBody`, not a budget term: a term subtracts a constant
// and this shortfall scales with how many wrapped rows the window happens to hold.
//
// THE `<Box width>` WRAPPER IS LOAD-BEARING, not decoration — the same trap permissions-dialog.test.tsx spells
// out. `ink-testing-library`'s fake stdout reports a FIXED 100 columns whatever a test passes, and an Ink box
// with no explicit width grows to fit its content, so a dialog handed `columns={60}` still lays out inside 100
// and an unclipped 67-column row simply widens the box instead of wrapping. Pinning the parent's width is what
// makes the wrap real and the line-count assertion a measurement.
//
// 80 AND 60 ARE THE PAIR because every wrappable CHROME literal wraps identically at both: the widest is
// NORMAL_FOOTER at 49 columns against a content width of `columns − 4`, so it holds one line down to 53. The
// frame's line count can therefore move only if a ROW wrapped. `rows={40}` shows all five, so neither counted
// indicator is drawn either.
describe("SettingsDialog — a Config row is clipped to the width it is given (row-clip round)", () => {
  const at = (cols: number) => <Box width={cols}><SettingsDialog {...props()} rows={40} columns={cols} /></Box>;
  const lines = (f: () => string | undefined) => plain(frame(f)).split("\n").length;

  it("keeps the Model row to one line at a width its hint does not fit", async () => {
    const wide = render(at(80));
    await waitFor(() => plain(frame(wide.lastFrame)).includes("For a specific model ID, use /model."));
    const tall = lines(wide.lastFrame);
    wide.unmount();
    const narrow = render(at(60));
    await waitFor(() => plain(frame(narrow.lastFrame)).includes("Default (recommended)"));
    // The DIM hint is what the clip eats into first, and `truncateLabel` reserves one column for its own `…`:
    // the head is 28 columns of a 54-column body, leaving 26 for `   For a specific model ID, use /model.`.
    expect(plain(frame(narrow.lastFrame)), "the hint that no longer fits is clipped, ellipsis and all").toContain("For a specific model I…");
    expect(plain(frame(narrow.lastFrame)), "…and the whole hint is gone from the frame").not.toContain("use /model.");
    expect(lines(narrow.lastFrame), "…and the frame is no taller for it — one option is still one line").toBe(tall);
    narrow.unmount();
  });

  /** The `/` query's own list is drawn OUTSIDE the `Select` (it deliberately does not mount one), with a
   *  two-space indent where the list has `Select`'s pointer gutter and `gap={1}` — the same six columns in, so
   *  the same clip and the same width. Without it the search arm is the one surface where a row can still wrap. */
  it("clips the same row in the `/` search list", async () => {
    const r = render(at(60));
    await waitFor(() => plain(frame(r.lastFrame)).includes("Default (recommended)"));
    r.stdin.write("/");
    await waitFor(() => plain(frame(r.lastFrame)).includes("Search settings…"));
    for (const ch of "model") { r.stdin.write(ch); await tick(); }
    await waitFor(() => plain(frame(r.lastFrame)).includes("Default (recommended)"));
    expect(plain(frame(r.lastFrame))).toContain("For a specific model I…");
    expect(plain(frame(r.lastFrame))).not.toContain("use /model.");
    r.unmount();
  });
});
