// test/tui/shortcuts-grid.test.tsx — F6 T14 (DG62/DG63): the three-column shortcuts grid, and the two things
// that make it more than a layout change.
//   1. THE MERGE. Upstream's `Y6t` entries (L459475-634) come first, in upstream's own column order, for the
//      subset whose bindings/features exist here; our own honest rows follow them. Nothing implemented was
//      dropped to make the list match upstream's, and nothing upstream has that ccx does NOT is advertised.
//   2. THE LIVENESS. Every chord in the grid is resolved from the LIVE table, so a rebind moves the sentence
//      and an unbind removes it — pinned here against a REBOUND lookup, not against the default one, because
//      only a rebind can tell derivation apart from a hand-typed literal that happens to be right today.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ShortcutsGrid, ROWS } from "../../src/tui/ShortcutsOverlay.js";
import { SHORTCUT_ROWS, defaultLookup, shortcutGrid, withModSep } from "../../src/tui/keys/hints.js";
import { newlineHint } from "../../src/tui/composerFrame.js";

const NEWLINE = newlineHint(false);
const grid = (lookup = defaultLookup, platform: NodeJS.Platform = "darwin") => shortcutGrid(lookup, { platform, newline: NEWLINE });
const flat = (lookup = defaultLookup, platform: NodeJS.Platform = "darwin") => grid(lookup, platform).flat();
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const unwrapped = (s: string): string => stripAnsi(s).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

describe("the entry-set merge (DG63)", () => {
  it("carries upstream's own entries, in upstream's three-column order", () => {
    const [one, two, three] = grid();
    // Column 1 (`width: 24`): the prefixes, upstream's three first.
    expect(one!.slice(0, 3)).toEqual(["! for shell mode", "/ for commands", "@ for file paths"]);
    // Column 2 (`width: 35`): upstream's five, in its order (the newline ladder is its seventh slot, after
    // two `null`s that hold no entry at all).
    expect(two!.slice(0, 5)).toEqual([
      "double tap esc to clear input", "shift + tab to auto-accept edits",
      "ctrl + o for verbose output", "ctrl + t to toggle tasks", NEWLINE,
    ]);
    // Column 3: upstream's, minus `ctrl+v` (images) and `alt+o` (fast mode), which ccx does not have.
    expect(three!.slice(0, 6)).toEqual([
      "ctrl + _ to undo", "ctrl + z to suspend", `${withModSep("opt+p")} to switch model`,
      "ctrl + s to stash prompt", "ctrl + g to edit in $EDITOR", "/keybindings to customize",
    ]);
  });

  it("keeps OUR extra honest rows, after upstream's", () => {
    const [one, two, three] = grid();
    // WAVE C TASK 14: `# for memory` left this column with the mode itself (spec owner-decision) — the row
    // is not "dropped to match upstream", the FEATURE is gone, which is the honesty contract's own test.
    expect(one!.slice(3)).toEqual(["? for this help"]);
    expect(two!.slice(5)).toContain("⏎ to send");
    expect(two!.slice(5)).toContain("ctrl + r to search history");
    expect(three!.slice(6)).toContain("ctrl + b to run in background");
    expect(three!.slice(6)).toContain("ctrl + c twice to exit");
  });

  it("advertises nothing upstream has that ccx does not implement", () => {
    const cells = flat().join("\n");
    expect(cells).not.toContain("paste images");        // images are a non-goal
    expect(cells).not.toContain("/btw");                // no such feature
    expect(cells).not.toContain("fast mode");           // no fast mode
  });

  it("is one-to-one with the audited key-column corpus — every advertised cell has a ROWS entry", () => {
    // The honesty audit runs over ROWS (the title-case key/label rendering); the grid prints the same rows as
    // sentences. If the two could drift, an unproven chord could reach the screen through the grid alone.
    expect(flat(defaultLookup, process.platform)).toHaveLength(ROWS.length);
    expect(SHORTCUT_ROWS.every((r) => r.cell !== undefined || r.ladder === true || r.phrase !== undefined)).toBe(true);
  });
});

describe("every chord is resolved from the live table (DG62)", () => {
  it("follows a rebinding — the sentence moves with the key", () => {
    const moved = (action: string) => (action === "app:toggleTodos" ? ["alt+k"] : action === "chat:cycleMode" ? ["ctrl+q"] : defaultLookup(action));
    const cells = flat(moved);
    expect(cells).toContain(`${withModSep("opt+k")} to toggle tasks`);
    expect(cells).toContain("ctrl + q to auto-accept edits");
    expect(cells).not.toContain("ctrl + t to toggle tasks");
    expect(cells).not.toContain("shift + tab to auto-accept edits");
  });

  it("drops an unbound action's cell entirely — `$e`'s three-state contract, not a stale literal", () => {
    const cells = flat((action) => (action === "chat:modelPicker" ? [] : defaultLookup(action)));
    expect(cells.some((c) => c.includes("switch model"))).toBe(false);
    expect(cells.some((c) => c.includes("(unbound)"))).toBe(false);
  });

  it("prefers a plain binding over a chord, like every other derived hint", () => {
    // `chat:externalEditor` is bound to `ctrl+x ctrl+e`, `ctrl+g` and `ctrl+x ctrl+g`; the cell takes the
    // plain one, which is the chord upstream prints too (`pA("chat:externalEditor","Chat","ctrl+g")`).
    expect(flat()).toContain("ctrl + g to edit in $EDITOR");
    // …and with no plain binding left, the chord itself, spelled member by member.
    const chordOnly = (action: string) => (action === "chat:killAgents" ? ["ctrl+x ctrl+k"] : defaultLookup(action));
    expect(flat(chordOnly)).toContain("ctrl + x ctrl + k to stop agents");
  });

  it("drops the ctrl+z cell on Windows, where suspendProcess is a no-op", () => {
    expect(flat(defaultLookup, "win32")).not.toContain("ctrl + z to suspend");
    expect(flat(defaultLookup, "darwin")).toContain("ctrl + z to suspend");
  });
});

describe("<ShortcutsGrid>", () => {
  it("renders the live grid, and a REBOUND table changes what it prints", async () => {
    const a = render(<ShortcutsGrid fixedWidth />);
    await waitFor(() => unwrapped(a.lastFrame() ?? "").includes("! for shell mode"));
    expect(unwrapped(a.lastFrame() ?? "")).toContain("ctrl + t to toggle tasks");
    a.unmount();

    const b = render(<ShortcutsGrid fixedWidth />, { userLayers: [{ context: "Global", bindings: { "ctrl+t": null, "alt+k": "app:toggleTodos" } }] });
    await waitFor(() => unwrapped(b.lastFrame() ?? "").includes("! for shell mode"));
    const painted = unwrapped(b.lastFrame() ?? "");
    expect(painted).toContain(`${withModSep(process.platform === "darwin" ? "opt+k" : "alt+k")} to toggle tasks`);
    expect(painted).not.toContain("ctrl + t to toggle tasks");
    b.unmount();
  });
});
