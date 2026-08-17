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
import { SHORTCUT_ROWS, UNBOUND, defaultLookup, fullscreenOnlyRows, shortcutGrid, shortcutRows, withModSep } from "../../src/tui/keys/hints.js";
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

  // FSW BACKLOG 5 — THE WHEEL IS BOUND AND DELIBERATELY UNADVERTISED. `wheelup`/`wheeldown` are real entries
  // in the binding table (the `Scroll` and `Transcript` blocks), so `defaultLookup` would happily resolve
  // them into a sentence — but a grid of CHORDS is a list of keys the reader can press, and a pointer gesture
  // printed as "wheelup to scroll" is a key nobody has. Nothing here is exempt from the honesty contract by
  // being unprintable; it is exempt from the GRID by not being a chord.
  it("never prints a pointer gesture as a chord", () => {
    const cells = [...flat(), ...SHORTCUT_ROWS.map((r) => r.phrase ?? r.label)].join("\n");
    expect(cells.toLowerCase()).not.toContain("wheel");
    expect(cells.toLowerCase()).not.toContain("scroll wheel");
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

// FSW BACKLOG 2 — the rows that exist in the ALTERNATE-SCREEN renderer only, and the two ways they can lie.
describe("the fullscreen-only rows", () => {
  const DUMP_LABEL = "open transcript in $EDITOR (while scrolled)";
  const only = (lookup = defaultLookup) => fullscreenOnlyRows(lookup, "darwin");
  const gridFs = (lookup = defaultLookup) => shortcutGrid(lookup, { platform: "darwin", newline: NEWLINE, fullscreen: true }).flat();

  it("key off the LIVE table, so a rebind moves the row and an unbind empties its key column", () => {
    expect(only()).toEqual([["V", DUMP_LABEL]]);
    const moved = (a: string) => (a === "scroll:dumpTranscript" ? ["alt+v"] : defaultLookup(a));
    expect(only(moved)).toEqual([["Alt-V", DUMP_LABEL]]);
    expect(only((a) => (a === "scroll:dumpTranscript" ? [] : defaultLookup(a)))).toEqual([["(unbound)", DUMP_LABEL]]);
  });

  it("the sentence derives its chord too, and disappears when nothing binds the action", () => {
    expect(gridFs()).toContain("v to open in $EDITOR when scrolled");
    const moved = (a: string) => (a === "scroll:dumpTranscript" ? ["alt+v"] : defaultLookup(a));
    expect(gridFs(moved)).toContain(`${withModSep("opt+v")} to open in $EDITOR when scrolled`);
    expect(gridFs(moved)).not.toContain("v to open in $EDITOR when scrolled");
    expect(gridFs((a) => (a === "scroll:dumpTranscript" ? [] : defaultLookup(a))).some((c) => c.includes("when scrolled"))).toBe(false);
  });

  // THE CHECK BITES (keys-bindings.test.ts's own pattern). This set used to be a string DIFFERENCE against the
  // classic key columns, so a fullscreen row that happened to resolve to a key a classic row also prints fell
  // out of it silently — out of the printed grid's audit corpus with it, which is the honesty contract losing
  // a row by accident. Selecting on the `fullscreen` FLAG cannot do that.
  it("keeps a fullscreen row whose key collides with a classic one", () => {
    const collide = (a: string) => (a === "scroll:dumpTranscript" ? ["ctrl+t"] : defaultLookup(a));
    expect(shortcutRows(collide, "darwin").some(([k]) => k === "Ctrl-T")).toBe(true);   // `app:toggleTodos` prints it too
    expect(only(collide)).toEqual([["Ctrl-T", DUMP_LABEL]]);
  });

  // FSW BACKLOG FIX F2 — THE ROW'S PROMISE IS ABOUT A CONTEXT, so the lookup has to be about that context too.
  // `when scrolled` names `Scroll`, and the grid renders where `Scroll` is NOT live — so `{live:true}` (the
  // pill's honest restriction) is the wrong instrument here and an unrestricted lookup is the wrong one too:
  // it answers from every context in the table, and would print the chord a user bound in the ctrl+O pager as
  // though it dumped from the scrollback. The row carries its own `contexts` and the lookup is asked with it.
  it("resolves the dump from the SCROLL context alone, whatever else in the table binds it", () => {
    const elsewhere: typeof defaultLookup = (a, opts) =>
      a !== "scroll:dumpTranscript" ? defaultLookup(a) : opts?.contexts?.includes("Scroll") ? [] : ["alt+v"];
    expect(only(elsewhere)).toEqual([[UNBOUND, DUMP_LABEL]]);            // the key column says the unbind took
    expect(gridFs(elsewhere).some((c) => c.includes("when scrolled"))).toBe(false);   // …the sentence says nothing
    // The positive control: asked WITH the Scroll context, the same row still prints the default key.
    expect(only()).toEqual([["V", DUMP_LABEL]]);
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

  // FSW BACKLOG FIX F2, through the real provider — the pure test above proves the row ASKS for `Scroll`;
  // this proves the live lookup ANSWERS for it. Unbind the scrollback's `v`, bind the action in the ctrl+O
  // pager instead: the sentence must go, not move to a key that dumps nothing from the scrollback.
  it("drops the fullscreen dump sentence when the action is bound outside the Scroll context", async () => {
    const c = render(<ShortcutsGrid fixedWidth fullscreen />, { userLayers: [
      { context: "Scroll", bindings: { v: null } },
      { context: "Transcript", bindings: { "alt+v": "scroll:dumpTranscript" } },
    ] });
    // Matched on the clause BEFORE the fixed-width column break — the cell is 35 columns wide and this row's
    // sentence spans two of them, with a neighbouring column's text between the halves in the frame.
    await waitFor(() => unwrapped(c.lastFrame() ?? "").includes("! for shell mode"));
    expect(unwrapped(c.lastFrame() ?? "")).not.toContain("to open in $EDITOR");
    c.unmount();

    const d = render(<ShortcutsGrid fixedWidth fullscreen />);
    await waitFor(() => unwrapped(d.lastFrame() ?? "").includes("! for shell mode"));
    expect(unwrapped(d.lastFrame() ?? "")).toContain("v to open in $EDITOR");
    d.unmount();
  });
});
