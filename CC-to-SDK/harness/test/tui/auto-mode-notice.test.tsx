// test/tui/auto-mode-notice.test.tsx — Wave T Task 2: the auto-mode entry notice (bundle L547286 string,
// L547934-955 gate). Driven through the HOST `state` arm, never through applyMode: applyMode yields a
// macrotask before it sets the mode (a deadlock under fake timers) and appends a model-check notice of its
// own into the very transcript these assertions search.
//
// Assertions read the projected `RenderItem[]` off the hook, NOT the rendered frame: the notice is ~490
// columns of prose, so Ink hard-wraps it at whatever word boundary the terminal width lands on and a
// frame substring check would be pinning a wrap point.
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { useChat } from "../../src/tui/useChat.js";
import { AUTO_MODE_DESCRIPTION, AUTO_MODE_NOTICE_DELAY_MS, shouldShowAutoModeNotice } from "../../src/tui/autoModeNotice.js";
import { loadPrefs, savePrefs } from "../../src/tui/prefs.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

// Every prefs read/write in this file is redirected to a throwaway fleet root — the real ~/.claude must
// never be touched, and the notice's whole point is that it WRITES a flag.
const roots: string[] = [];
const tmpRoot = (): NodeJS.ProcessEnv => { const d = mkdtempSync(join(tmpdir(), "ccx-automode-")); roots.push(d); return { ...process.env, CCX_FLEET_ROOT: d }; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }

/** Mirrors the hook's projected transcript into `sink` on every render, so assertions see raw item text. */
function Host({ fake, env, sink }: { fake: FakeRemote; env: NodeJS.ProcessEnv; sink: { text: string } }) {
  const c = useChat(() => fake, {}, { env });
  sink.text = [...c.state.staticItems, ...c.state.pendingItems].flatMap(itemLines).join("|");
  return <Text>m:{c.state.mode}</Text>;
}

describe("shouldShowAutoModeNotice", () => {
  it("is true on a fresh install and false once the flag is set", () => {
    expect(shouldShowAutoModeNotice({})).toBe(true);
    expect(shouldShowAutoModeNotice({ hasSeenAutoModeEntryWarning: true })).toBe(false);
  });
});

describe("useChat — auto-mode entry notice", () => {
  it("a host state frame turning the mode to auto appends the verbatim notice 800ms later, exactly once, and records the flag", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "auto" } }); });
      expect(sink.text).not.toContain("Auto mode lets Claude handle permission prompts automatically");   // not yet — the delay is real
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS); });
      expect(sink.text).toContain("Auto mode lets Claude handle permission prompts automatically");
      expect(sink.text).toContain(AUTO_MODE_DESCRIPTION);                                                 // verbatim, em dash and all
      expect(loadPrefs(env).hasSeenAutoModeEntryWarning).toBe(true);
      // A REDELIVERED state frame (another client's echo, a follow re-drain) must not append a second copy.
      await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "auto" } }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS * 2); });
      expect(sink.text.split(AUTO_MODE_DESCRIPTION)).toHaveLength(2);                                     // one occurrence
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("an install that has already seen it stays silent", async () => {
    const env = tmpRoot(); savePrefs({ hasSeenAutoModeEntryWarning: true }, env);
    const fake = fakeRemote(), sink = { text: "" };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "auto" } }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS * 2); });
      expect(sink.text).not.toContain("Auto mode lets Claude handle permission prompts automatically");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("a mode that never reaches auto shows nothing", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "plan" } }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS * 2); });
      expect(sink.text).not.toContain("Auto mode lets Claude handle permission prompts automatically");
      expect(loadPrefs(env).hasSeenAutoModeEntryWarning).toBeUndefined();
    } finally { vi.useRealTimers(); unmount(); }
  });
});
