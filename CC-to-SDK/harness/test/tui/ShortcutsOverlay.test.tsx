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
import { renderWithKeymap as render, tick as flush } from "./keysTestUtil.js";
import { useKeyActions, useKeyFallback } from "../../src/tui/keys/KeymapProvider.js";
import { ShortcutsOverlay } from "../../src/tui/ShortcutsOverlay.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const tick = () => new Promise((r) => setTimeout(r, 20));   // let useInput subscribe
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
/** Find the exact keymap row for `key` (border char + key + whitespace boundary, so "Esc" doesn't match
 *  the "Esc Esc" row and vice versa) and return its full text — so a check against the row's label fails
 *  if that row is ever dropped, unlike a bare `toContain(key)` which any incidental match elsewhere satisfies. */
function rowFor(frameText: string, key: string): string {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^│ ${esc}(?:\\s|$)`);
  const line = stripAnsi(frameText).split("\n").find((l) => re.test(l));
  if (line === undefined) throw new Error(`ShortcutsOverlay: no row found for key ${JSON.stringify(key)}`);
  return line;
}

describe("<ShortcutsOverlay>", () => {
  it("renders the heading and the keymap rows for real bindings", async () => {
    const { lastFrame } = render(<ShortcutsOverlay onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    const f = frame(lastFrame);
    expect(rowFor(f, "Esc Esc")).toContain("rewind");
    expect(rowFor(f, "⇧Tab")).toContain("mode ladder");
    expect(rowFor(f, "Ctrl-T")).toContain("todo panel");
    expect(rowFor(f, "Ctrl-B")).toContain("background");
    expect(rowFor(f, "!")).toContain("bash");
    expect(rowFor(f, "#")).toContain("memory");
    expect(rowFor(f, "?")).toContain("this help");
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
    await flush();
    stdin.write("\x0f");                                       // Ctrl-O: Global's app:toggleTranscript
    stdin.write("\x14");                                       // Ctrl-T: Global's app:toggleTodos
    stdin.write("x");                                          // a single printable key
    stdin.write("typed run");                                  // a multi-character text event
    await flush();
    expect(toggleTranscript).not.toHaveBeenCalled();
    expect(toggleTodos).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(closed).toBe(0);
    stdin.write("\x1b");                                       // Help's own binding still resolves
    await waitFor(() => closed === 1);
  });
});
