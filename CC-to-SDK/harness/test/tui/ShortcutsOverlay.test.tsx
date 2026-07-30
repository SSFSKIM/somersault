// test/tui/ShortcutsOverlay.test.tsx — the `?` help overlay (Stage C5 task 7): a pure-display bordered
// keymap panel; ANY keypress closes it. Rows are checked only against bindings that actually exist in
// this codebase (ChatApp.tsx / editor.ts / ChatComposer.tsx) — a row for a binding we don't implement
// would be a false promise. Mirrors RewindPicker.test.tsx's waitFor-before-keys discipline.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ShortcutsOverlay } from "../../src/tui/ShortcutsOverlay.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
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

  it("any keypress calls onClose", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<ShortcutsOverlay onClose={() => { closed++; }} />);
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    await new Promise((r) => setTimeout(r, 20));   // let useInput subscribe
    stdin.write("x");
    await waitFor(() => closed === 1);
  });
});
