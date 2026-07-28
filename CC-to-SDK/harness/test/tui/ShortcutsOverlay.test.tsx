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

describe("<ShortcutsOverlay>", () => {
  it("renders the heading and the keymap rows for real bindings", async () => {
    const { lastFrame } = render(<ShortcutsOverlay onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    const f = frame(lastFrame);
    expect(f).toContain("Esc Esc");
    expect(f).toContain("rewind");
    expect(f).toContain("Tab");
    expect(f).toContain("Ctrl+B");
    expect(f).toContain("!");
    expect(f).toContain("#");
    expect(f).toContain("?");
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
