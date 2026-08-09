// test/tui/ShortcutsOverlay.test.tsx — the `?` help overlay (Stage C5 task 7, F0 KB6): a pure-display
// bordered keymap panel that closes on Escape ONLY — every other key is swallowed here, not left to leak
// into whatever's underneath. Rows are checked only against bindings that actually exist in this codebase
// (ChatApp.tsx / editor.ts / ChatComposer.tsx) — a row for a binding we don't implement would be a false
// promise. Mirrors RewindPicker.test.tsx's waitFor-before-keys discipline.
//
// F2 task 7: "swallowed" stopped being a promise the overlay's own `useInput` had to keep. The overlay pushes
// the `Help` context and calls `useSwallowKeys(true)`, so the PROVIDER drops every key that Help does not
// bind — including `Global`'s own bindings, which is the F0 ctrl+o double-fire regression stated structurally
// rather than by inspection. The sibling probe below stands in for the tree underneath (ChatApp's globals +
// the retiring composer's fallback): registered BEFORE the overlay, it is exactly what a leak would reach.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { useKeyActions, useKeyFallback } from "../../src/tui/keys/KeymapProvider.js";
import { ShortcutsOverlay } from "../../src/tui/ShortcutsOverlay.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const tick = () => new Promise((r) => setTimeout(r, 20));   // let useInput subscribe
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
/** F6 T14: the overlay is upstream's three-COLUMN grid now, so a cell is a sentence and a cell too wide for
 *  its column is wrapped across two physical lines (`backslash (\) + return (⏎) for` / `newline`). Unwrap the
 *  whole frame before looking for one — matching per line would silently lose whichever cell straddles the
 *  break, which reads as "the grid stopped advertising it". honesty.test.tsx's own idiom. */
const unwrapped = (frameText: string): string => stripAnsi(frameText).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ");

describe("<ShortcutsOverlay>", () => {
  it("renders the heading and upstream's three-column grid, for real bindings only", async () => {
    const { lastFrame } = render(<ShortcutsOverlay onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    const f = unwrapped(frame(lastFrame));
    // Upstream's own entries, in upstream's own words (`Y6t`, L459475-634).
    expect(f).toContain("! for shell mode");
    expect(f).toContain("/ for commands");
    expect(f).toContain("@ for file paths");
    expect(f).toContain("double tap esc to clear input");
    expect(f).toContain("shift + tab to auto-accept edits");
    expect(f).toContain("ctrl + o for verbose output");
    expect(f).toContain("ctrl + t to toggle tasks");
    expect(f).toContain("ctrl + _ to undo");
    expect(f).toContain("ctrl + s to stash prompt");
    expect(f).toContain("ctrl + g to edit in $EDITOR");
    expect(f).toContain("/keybindings to customize");
    // …and OURS, retained after them (the F2 honesty contract: an implemented row is not dropped to match
    // upstream's list exactly).
    expect(f).toContain("? for this help");
    expect(f).toContain("ctrl + r to search history");
    expect(f).toContain("ctrl + b to run in background");
    // Upstream entries whose FEATURE does not exist here must not be advertised — and as of Wave C Task 14
    // the `#` memory mode is one of those: the spec's owner-decision section removed the mode, so the cell
    // that advertised it had to go with it or the overlay would promise a key that does nothing.
    expect(f).not.toContain("# for memory");
    expect(f).not.toContain("paste images");
    expect(f).not.toContain("/btw");
    expect(f).not.toContain("fast mode");
  });

  it("only Escape closes the overlay; other keys neither close nor leak", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<ShortcutsOverlay onClose={() => { closed++; }} />);
    await tick();
    stdin.write("x"); stdin.write("\x0f");                     // 'x', Ctrl-O
    await tick();
    expect(closed).toBe(0);
    expect(frame(lastFrame)).toContain("esc closes");
    stdin.write("\x1b");
    await waitFor(() => closed === 1);
  });

  it("swallows the tree underneath — a Global binding and plain text reach neither action nor fallback (F0 acceptance 5)", async () => {
    const toggleTranscript = vi.fn(), toggleTodos = vi.fn(), fallback = vi.fn();
    let closed = 0;
    const Underneath = () => {
      useKeyActions({ "app:toggleTranscript": toggleTranscript, "app:toggleTodos": toggleTodos });
      useKeyFallback(fallback);
      return null;
    };
    const { stdin } = render(<><Underneath /><ShortcutsOverlay onClose={() => { closed++; }} /></>);
    await tick();
    stdin.write("\x0f");                                       // Ctrl-O: Global's app:toggleTranscript
    stdin.write("\x14");                                       // Ctrl-T: Global's app:toggleTodos
    stdin.write("x");                                          // a single printable key
    stdin.write("typed run");                                  // a multi-character text event
    await tick();
    expect(toggleTranscript).not.toHaveBeenCalled();
    expect(toggleTodos).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(closed).toBe(0);
    stdin.write("\x1b");                                       // Help's own binding still resolves
    await waitFor(() => closed === 1);
  });
});
