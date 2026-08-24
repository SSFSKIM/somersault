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
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap } from "./keysTestUtil.js";
import { AUTO_MODE_DESCRIPTION, AUTO_MODE_NOTICE_DELAY_MS, ACCOUNT_NOTICE_DEADLINE_MS, autoModeNoticeText, shouldShowAutoModeNotice } from "../../src/tui/autoModeNotice.js";
import { loadPrefs, savePrefs, type CcxPrefs } from "../../src/tui/prefs.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import { createAccountBridge, type AccountBridge } from "../../src/tui/accountBridge.js";

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
function Host({ fake, env, sink, savePrefs, initialMode, initialTokenSource, accountBridge }: { fake: FakeRemote; env: NodeJS.ProcessEnv; sink: { text: string }; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void; initialMode?: string; initialTokenSource?: string; accountBridge?: AccountBridge }) {
  const c = useChat(() => fake, { initialMode, initialTokenSource, accountBridge }, { env, savePrefs });
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

  // T2 REVIEW FIX (Important): every case above drives `useChat` DIRECTLY through `Host`, so a break in the
  // real forwarding chain — `main.ts`'s `hookOpts` → `ChatClientOpts.hookOpts` (chatMain.tsx) → `ChatApp`'s
  // own `hookOpts` prop → the `{ ...(hookOpts ?? {}), ... }` spread into `useChat`'s opts (ChatApp.tsx:374) —
  // fails NONE of them. This test closes that gap by mounting the real `ChatApp`, exactly as it is mounted
  // in production, with `hookOpts.initialTokenSource` set: only `ChatApp`'s own prop-spread carries the field
  // from here into `useChat`, so severing that spread (the reviewer's mutation) has to break this test even
  // though every `Host`-driven case above stays green.
  it("ChatApp forwards hookOpts.initialTokenSource to useChat — the real notice renders without the cost sentence", async () => {
    const env = tmpRoot();
    const fake = fakeRemote();
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const flat = (r: { lastFrame: () => string | undefined }) => strip(r.lastFrame() ?? "").replace(/\n/g, " ").replace(/\s+/g, " ");
    const waitForFrame = async (r: { lastFrame: () => string | undefined }, cond: (text: string) => boolean, timeout = 3000) => {
      const start = Date.now();
      for (;;) {
        if (cond(flat(r))) return;
        if (Date.now() - start > timeout) throw new Error(`waitForFrame timeout; last frame: ${flat(r)}`);
        await new Promise((res) => setTimeout(res, 10));
      }
    };
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()}
        hookOpts={{ initialTokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }}
        deps={{ env, columns: () => 80, rows: () => 24, getSessionMessages: async () => [] }} />,
    );
    try {
      await waitForFrame(r, (t) => t.includes("❯"));   // the composer prompt glyph — mount settled
      fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "auto" } });
      // Real time deliberately (see the sibling comment above on the "launches already in auto" case): the
      // notice effect's setTimeout arms as part of this same render pass, before any fake-timer install could
      // intercept it.
      await waitForFrame(r, (t) => t.includes("Ideal for long-running tasks."), AUTO_MODE_NOTICE_DELAY_MS + 2000);
      expect(flat(r)).not.toContain("Sessions are slightly more expensive.");
    } finally { r.unmount(); }
  }, 10000);

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

  // F10 T-MAINT item 1 — THE COLD-START RACE, and the second deadline that bounds it. Every cell below
  // drives the mode to auto AFTER installing fake timers, which is what puts BOTH of the notice's timers
  // (the 800 ms delay and the remaining-budget deadline armed inside its callback) on the fake clock —
  // see this file's own note on the mount-armed-timer hazard. `initialTokenSource` is deliberately left
  // UNSET in all of them: it is exactly the value a cold launch loses, and the bridge is what replaces it.
  const REMAINING = ACCOUNT_NOTICE_DEADLINE_MS - AUTO_MODE_NOTICE_DELAY_MS;   // 2200 — the total is 3000
  const deferredBridge = () => {
    let settle!: (f: { tokenSource: string } | undefined) => void, fail!: (e: unknown) => void;
    const bridge = createAccountBridge();
    bridge.offer(new Promise((res, rej) => { settle = res as typeof settle; fail = rej; }));
    return { bridge, settle, fail };
  };
  const toAuto = async (fake: FakeRemote) => {
    await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "auto" } }); });
  };

  it("account facts landing at 2999 ms from arming win: the OAuth variant, with no cost sentence", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { bridge, settle } = deferredBridge();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} accountBridge={bridge} />);
    await tick();
    vi.useFakeTimers();
    try {
      await toAuto(fake);
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS + REMAINING - 1); });   // 2999
      expect(sink.text).not.toContain("Auto mode lets Claude handle permission prompts automatically");   // still waiting
      await act(async () => { settle({ tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }); await vi.advanceTimersByTimeAsync(0); });
      expect(sink.text).toContain(autoModeNoticeText({ oauth: true }));
      expect(sink.text).not.toContain("Sessions are slightly more expensive.");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("account facts landing at 3001 ms are too late: the deadline already fell back to the unknown arm", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { bridge, settle } = deferredBridge();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} accountBridge={bridge} />);
    await tick();
    vi.useFakeTimers();
    try {
      await toAuto(fake);
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS + REMAINING + 1); });   // 3001
      await act(async () => { settle({ tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }); await vi.advanceTimersByTimeAsync(0); });
      expect(sink.text).toContain("Sessions are slightly more expensive.");
      expect(sink.text.split(AUTO_MODE_DESCRIPTION)).toHaveLength(2);        // one notice, not two
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("a handshake that never completes falls back AT the deadline, not before it and not never", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const bridge = createAccountBridge();
    bridge.offer(new Promise(() => {}));                                     // the mute-engine shape
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} accountBridge={bridge} />);
    await tick();
    vi.useFakeTimers();
    try {
      await toAuto(fake);
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS + REMAINING - 1); });
      expect(sink.text).not.toContain("Auto mode lets Claude handle permission prompts automatically");
      await act(async () => { await vi.advanceTimersByTimeAsync(2); });
      expect(sink.text).toContain(AUTO_MODE_DESCRIPTION);                    // the cost-sentence variant
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("a REJECTING handshake falls back immediately — no reason to sit out the remaining 2200 ms", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { bridge, fail } = deferredBridge();
    fail(new Error("no credentials"));
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} accountBridge={bridge} />);
    await tick();
    vi.useFakeTimers();
    try {
      await toAuto(fake);
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS); });
      expect(sink.text).toContain(AUTO_MODE_DESCRIPTION);                    // already there, deadline untouched
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("unmounting between the delay and the answer cancels: nothing is appended, nothing is left parked", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { bridge, settle } = deferredBridge();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} accountBridge={bridge} />);
    await tick();
    vi.useFakeTimers();
    try {
      await toAuto(fake);
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS); });   // the callback is now awaiting
      const before = sink.text;
      unmount();
      await act(async () => { settle({ tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }); await vi.advanceTimersByTimeAsync(REMAINING * 2); });
      expect(sink.text).toBe(before);
      expect(sink.text).not.toContain("Auto mode lets Claude handle permission prompts automatically");
      expect(vi.getTimerCount()).toBe(0);                                    // the cleanup cleared the deadline too
    } finally { vi.useRealTimers(); }
  });

  // F10 fix-wave review finding P2: the SAME race as "unmounting between the delay and the answer" above,
  // but the session stays MOUNTED and only leaves auto mode — a real, reachable path (Shift+Tab, or a
  // host `state` frame) that `disposed.current` alone cannot catch, since the component never unmounts.
  // Before the fix, `settleRace?.(undefined)` on cleanup unblocked the awaiting callback with `facts =
  // undefined`, and the callback's only other guard (`disposed.current`) was still false — so it fell
  // through and appended the auto-mode notice into a thread that is, by the time it lands, back in
  // "default" mode, and burned the once-per-process ref doing it.
  it("leaving auto mode before accountInfo() resolves must not append the notice or burn the once-only guard", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { text: "" };
    const { bridge, settle } = deferredBridge();
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} accountBridge={bridge} />);
    await tick();
    vi.useFakeTimers();
    try {
      await toAuto(fake);
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS); });   // callback now awaiting bridge.read()
      // A real mode change AWAY from auto, still mounted — reruns the `[mode]`-keyed effect and its cleanup.
      await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "default" } }); });
      const before = sink.text;
      await act(async () => { settle({ tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" }); await vi.advanceTimersByTimeAsync(REMAINING * 2); });
      expect(sink.text).toBe(before);
      expect(sink.text).not.toContain(AUTO_MODE_DESCRIPTION);
      expect(sink.text).not.toContain(autoModeNoticeText({ oauth: true }));
      expect(loadPrefs(env).hasSeenAutoModeEntryWarning).toBeUndefined();      // the stale attempt never persisted the flag either
      // Re-entering auto afterward still shows the notice once — the once-only guard was NOT consumed by
      // the stale, cancelled attempt. The bridge's live promise is already settled (with the earlier oauth
      // facts) by this point, so the second, genuine fire renders the oauth variant.
      await act(async () => { fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "auto" } }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_MODE_NOTICE_DELAY_MS + REMAINING + 10); });
      expect(sink.text).toContain(autoModeNoticeText({ oauth: true }));
    } finally { vi.useRealTimers(); unmount(); }
  });
});
