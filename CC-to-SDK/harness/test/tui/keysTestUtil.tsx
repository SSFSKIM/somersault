// tui/test/keysTestUtil.tsx — render a component tree UNDER the root keymap (F2 task 5). Every scope /
// action / fallback hook is a no-op without a `<KeymapProvider>` above it, so from task 6 onward a component
// test that renders `<ChatApp>` / `<ChatComposer>` / a dialog bare has no input path at all: `stdin.write`
// goes nowhere. This helper is the one-line migration — swap `render(...)` for `renderWithKeymap(...)`.
//
// `rerender` re-wraps, so a test can mount/unmount children under the SAME provider instance (that is how
// scope precedence by mount order is exercised) instead of tearing the whole tree down.
import React from "react";
import { render } from "ink-testing-library";
import { KeymapProvider, type KeymapDeps } from "../../src/tui/keys/KeymapProvider.js";

/** Ink's input subscription is a passive effect: the provider attaches its stdin `data` listener AFTER the
 *  first paint, so a test must await one tick before writing keys (harness/CLAUDE.md). */
export const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

export function renderWithKeymap(ui: React.ReactNode, deps?: KeymapDeps) {
  const wrap = (node: React.ReactNode) => <KeymapProvider deps={deps}>{node}</KeymapProvider>;
  const instance = render(wrap(ui));
  return { ...instance, rerender: (next: React.ReactNode) => { instance.rerender(wrap(next)); } };
}
