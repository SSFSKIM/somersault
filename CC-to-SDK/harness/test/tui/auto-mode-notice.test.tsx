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
import { AUTO_MODE_DESCRIPTION, AUTO_MODE_NOTICE_DELAY_MS, autoModeNoticeText, shouldShowAutoModeNotice } from "../../src/tui/autoModeNotice.js";
import { loadPrefs, savePrefs, type CcxPrefs } from "../../src/tui/prefs.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

// Every prefs read/write in this file is redirected to a throwaway fleet root — the real ~/.claude must
// never be touched, and the notice's whole point is that it WRITES a flag.
const roots: string[] = [];
const tmpRoot = (): NodeJS.ProcessEnv => { const d = mkdtempSync(join(tmpdir(), "ccx-automode-")); roots.push(d); return { ...process.env, CCX_FLEET_ROOT: d }; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }

/** Mirrors the hook's projected transcript into `sink` on every render, so assertions see raw item text.
 *  `savePrefs` is optional and only the two guard tests below pass it — undefined leaves the hook on the real
 *  one (`deps.savePrefs ?? realSavePrefs`), which the temp-root env already redirects. */
function Host({ fake, env, sink, savePrefs, initialMode, initialTokenSource }: { fake: FakeRemote; env: NodeJS.ProcessEnv; sink: { text: string }; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void; initialMode?: string; initialTokenSource?: string }) {
  const c = useChat(() => fake, { initialMode, initialTokenSource }, { env, savePrefs });
  // FSW T3: read the WHOLE finalized projection, not just its committed head. `staticItems` is now only
  // the part that has left the live window and been written into <Static>; `finalizedItems` is the transcript
  // these content assertions are actually about.
  sink.text = [...c.state.finalizedItems, ...c.state.pendingItems].flatMap(itemLines).join("|");
  return <Text>m:{c.state.mode}</Text>;
}

describe("shouldShowAutoModeNotice", () => {
  it("is true on a fresh install and false once the flag is set", () => {
    expect(shouldShowAutoModeNotice({})).toBe(true);
    expect(shouldShowAutoModeNotice({ hasSeenAutoModeEntryWarning: true })).toBe(false);
  });
});

// T2: canon's two-variant copy (2.1.236 L676952-676958) — base + tail are IDENTICAL in both variants;
// the subscription (oauth) variant omits only the cost sentence. String-level, not a formatter unit test
// in isolation: both assertions pin the exact sentence text so a future edit to either variant has to
// touch this file, not silently drift.
describe("autoModeNoticeText", () => {
  const COST_SENTENCE = "Sessions are slightly more expensive.";
  it("oauth variant omits the cost sentence", () => {
    const text = autoModeNoticeText({ oauth: true });
    expect(text).not.toContain(COST_SENTENCE);
    expect(text).toContain("Ideal for long-running tasks.");
    expect(text).toContain("Shift+Tab to change mode.");
  });
  it("api-key (non-oauth) variant contains the cost sentence, verbatim and unchanged from the legacy single-variant string", () => {
    const text = autoModeNoticeText({ oauth: false });
    expect(text).toContain(COST_SENTENCE);
    expect(text).toBe(AUTO_MODE_DESCRIPTION);
  });
});

describe("useChat — auto-mode entry notice", () => {
  // T2 seam test (plan-review catch): the token source travels main.ts → ChatClientOpts.hookOpts →
  // ChatApp props → useChat's own opts, ending as ONE optional string field, `initialTokenSource`. This
  // drives it end-to-end through the RENDERED notice text — not the formatter alone — so a break anywhere
  // in that chain (a dropped field in chatMain.tsx or ChatApp.tsx) fails here even though autoModeNotice.ts
  // itself is untouched.
  it("a fake accountInfo OAuth token source threaded through opts renders the oauth variant (no cost sentence)", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} initialTokenSource="CLAUDE_CODE_OAUTH_TOKEN" />);
    await tick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "auto" } }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS); });
      expect(sink.text).toContain(autoModeNoticeText({ oauth: true }));
      expect(sink.text).not.toContain("Sessions are slightly more expensive.");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("an api-key token source (and an absent/unknown one) both keep the cost sentence", async () => {
    for (const initialTokenSource of ["ANTHROPIC_API_KEY", undefined]) {
      const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
      const { unmount } = render(<Host fake={fake} env={env} sink={sink} initialTokenSource={initialTokenSource} />);
      await tick();
      vi.useFakeTimers();
      try {
        await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "auto" } }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS); });
        expect(sink.text).toContain("Sessions are slightly more expensive.");
      } finally { vi.useRealTimers(); unmount(); }
    }
  });

  // The new reachable path Task 1 opened: a session that LAUNCHES in auto (opts.initialMode === "auto"),
  // never a mode CHANGE. The effect is keyed on `[mode]`, which React fires on mount too, so the notice
  // must fire on this path exactly as it does on a later host `state` frame — and the once-per-install
  // latch (the prefs flag) still has to hold across it.
  // Real timers deliberately, not fake ones: the effect's setTimeout is armed at MOUNT, which happens
  // inside `render()` below — before any `vi.useFakeTimers()` this test could install — so a later switch
  // to fake time would never see that already-scheduled real timer (the sibling comment in
  // keys-acceptance.test.tsx:194 records the same hazard the other direction: fake timers before render
  // stall Ink's own mount). A flat real-time wait past the 800ms delay is simpler and just as conclusive.
  it("a session that launches already in auto shows the notice once, and records the once-per-install flag", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} initialMode="auto" />);
    await act(async () => { await new Promise((r) => setTimeout(r, AUTO_MODE_NOTICE_DELAY_MS + 150)); });
    expect(sink.text).toContain(AUTO_MODE_DESCRIPTION);
    expect(loadPrefs(env).hasSeenAutoModeEntryWarning).toBe(true);
    expect(sink.text.split(AUTO_MODE_DESCRIPTION)).toHaveLength(2);     // one occurrence — the mount fire, not a double
    unmount();
  });

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

  // The two below pin the PER-PROCESS ref specifically. The "exactly once" assertion in the first test cannot:
  // it redelivers an UNCHANGED mode, which useChat.ts:571 drops before `mode` moves, so the effect never re-runs
  // and the ref is never consulted — and even if it did re-run, the prefs flag written by the first fire would
  // suppress it on its own. So both tests here stub savePrefs away (the flag never lands on disk) and move the
  // mode for real, leaving `autoNoticeShown` as the only thing that can hold the notice to one.
  it("the per-process guard survives leaving auto and coming back, even when the prefs flag never persists", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const saves: Partial<CcxPrefs>[] = [];
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} savePrefs={(patch) => { saves.push(patch); }} />);
    await tick();
    vi.useFakeTimers();
    try {
      const push = async (permissionMode: string) => {
        await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode } }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS); });
      };
      await push("auto");
      expect(sink.text.split(AUTO_MODE_DESCRIPTION)).toHaveLength(2);          // one occurrence
      await push("default");                                                   // a real mode change: the effect re-runs
      await push("auto");                                                      // …and re-runs again, on the ref this time
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS * 2); });
      expect(sink.text.split(AUTO_MODE_DESCRIPTION)).toHaveLength(2);          // still one — the ref held it
      expect(saves).toEqual([{ hasSeenAutoModeEntryWarning: true }]);          // and it only ever tried to persist once
      expect(loadPrefs(env).hasSeenAutoModeEntryWarning).toBeUndefined();      // nothing reached disk to do the suppressing
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("a prefs write that throws is swallowed — the notice still shows, once, and the timer doesn't kill the session", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} savePrefs={() => { throw new Error("EROFS: read-only file system"); }} />);
    await tick();
    vi.useFakeTimers();
    try {
      const push = async (permissionMode: string) => {
        await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode } }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS); });
      };
      await push("auto");                                                      // an unguarded throw here rejects the timer advance
      expect(sink.text).toContain(AUTO_MODE_DESCRIPTION);
      await push("default"); await push("auto");
      expect(sink.text.split(AUTO_MODE_DESCRIPTION)).toHaveLength(2);          // the ref is the ONLY guard left, and it holds
    } finally { vi.useRealTimers(); unmount(); }
  });
});
