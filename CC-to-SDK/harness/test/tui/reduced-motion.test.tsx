// test/tui/reduced-motion.test.tsx — F8 Task 6 REVIEW (Finding A). The whole feature was wired with no test
// anywhere in the tree: a reviewer sabotage that dropped all three `reducedMotion={motionReduced}` props at
// ChatApp.tsx:1594-1596, dropped the `case "reduceMotion":` arm at useChat.ts:2142, and dropped
// `reducedMotion: reducedMotion(prefs)` at chatMain.tsx:837 — all at once — left the suite green (6679
// passed, only the unrelated known-flaky `/copy` case failed). This file closes that hole two ways, on the
// precedent of two existing tests named in the review:
//
//   1. `duration-row.test.tsx`'s useChat half — drive the REAL hook with a seeded initial value, flip it
//      through the hook's own setter AND through the `/config` command text, and assert both the live state
//      and the persisted `savePrefs` patch. This is the ONLY coverage of useChat.ts:2142's `reduceMotion` arm.
//
//   2. `compaction-row.test.tsx:144-152`'s "end to end through ChatApp" seam — mount the real `<ChatApp>`
//      with `CLAUDE_AX_SCREEN_READER=1` (never a hand-passed prop) and prove the resolve at ChatApp.tsx:1026
//      reaches all three live-turn indicator mounts at ChatApp.tsx:1594-1596: the spinner glyph, the
//      compaction bar, and the retry countdown all stop self-repainting.
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { renderWithKeymap, tick as rafTick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { useChat } from "../../src/tui/useChat.js";
import type { CcxPrefs } from "../../src/tui/prefs.js";
import { spinnerUp } from "./helpers/spinnerRow.js";

const roots: string[] = [];
const tmpRoot = (): NodeJS.ProcessEnv => { const d = mkdtempSync(join(tmpdir(), "ccx-motion-")); roots.push(d); return { ...process.env, CCX_FLEET_ROOT: d }; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const line = (f: () => string | undefined) => plain(f()).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

// ── Part 1: the useChat half, `duration-row.test.tsx`'s exact idiom ────────────────────────────────────

/** Mirrors `duration-row.test.tsx`'s `Host`: reads the REAL `useChat` state, exposes the setter AND `submit`
 *  so the `/config` command path is reachable, and hands the seeded pref back out through `savePrefs`. */
function Host({ fake, env, sink, savePrefs, api, seed }: { fake: FakeRemote; env: NodeJS.ProcessEnv; sink: { reducedMotion: boolean }; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void; api?: { setMotion?: (v: boolean) => void; submit?: (s: string) => void }; seed?: boolean }) {
  const c = useChat(() => fake, { ...(seed === undefined ? {} : { initialPrefersReducedMotion: seed }) }, { env, savePrefs });
  sink.reducedMotion = c.state.prefersReducedMotion;
  if (api) { api.setMotion = c.setPrefersReducedMotion; api.submit = c.submit; }
  return <Text>rm:{String(c.state.prefersReducedMotion)}</Text>;
}

describe("useChat — the `prefersReducedMotion` setting (F8 T6)", () => {
  it("defaults to false when the caller seeds nothing", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { reducedMotion: true };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} />);
    await tick();
    try { expect(sink.reducedMotion).toBe(false); } finally { unmount(); }
  });

  it("picks up `initialPrefersReducedMotion` — the seam `chatMain.tsx` feeds it through", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { reducedMotion: false };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} seed />);
    await tick();
    try { expect(sink.reducedMotion).toBe(true); } finally { unmount(); }
  });

  it("`setPrefersReducedMotion` flips the live state AND persists the `{ prefersReducedMotion }` patch, both directions", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { reducedMotion: false };
    const saves: Partial<CcxPrefs>[] = [], api: { setMotion?: (v: boolean) => void } = {};
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} api={api} savePrefs={(patch) => { saves.push(patch); }} />);
    await tick();
    try {
      expect(sink.reducedMotion).toBe(false);
      await act(async () => { api.setMotion!(true); });
      expect(sink.reducedMotion).toBe(true);
      expect(saves).toEqual([{ prefersReducedMotion: true }]);
      await act(async () => { api.setMotion!(false); });
      expect(sink.reducedMotion).toBe(false);
      expect(saves).toEqual([{ prefersReducedMotion: true }, { prefersReducedMotion: false }]);
    } finally { unmount(); }
  });

  it("`/config reduceMotion=true` — the useChat.ts:2142 switch arm — flips state AND persists, and `=false` flips it back", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { reducedMotion: false };
    const saves: Partial<CcxPrefs>[] = [], api: { submit?: (s: string) => void } = {};
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} api={api} savePrefs={(patch) => { saves.push(patch); }} />);
    await tick();
    try {
      expect(sink.reducedMotion).toBe(false);
      await act(async () => { api.submit!("/config reduceMotion=true"); });
      await tick();
      expect(sink.reducedMotion).toBe(true);
      expect(saves).toEqual([{ prefersReducedMotion: true }]);
      await act(async () => { api.submit!("/config reduceMotion=false"); });
      await tick();
      expect(sink.reducedMotion).toBe(false);
      expect(saves).toEqual([{ prefersReducedMotion: true }, { prefersReducedMotion: false }]);
    } finally { unmount(); }
  });
});

// ── Part 2: end to end through ChatApp, `compaction-row.test.tsx:144-152`'s seam ───────────────────────
//
// `CLAUDE_AX_SCREEN_READER=1` is the ONLY thing set — never a hand-passed `reducedMotion` prop — so a
// passing test here can only mean the resolve at ChatApp.tsx:1026 (`screenReaderEnabled(process.env)`) ran
// AND its result reached the mount at ChatApp.tsx:1594-1596. Each of the three rows disarms its own
// self-repaint interval under reduced motion (TurnSpinner/CompactionRow: `useAnimationClock(null, …)`;
// RetryRow: `useAnimationClock(reducedMotion ? null : 120, …)`), so with fake timers advanced far past every
// row's own tick, an unwired row (the sabotage) repaints and its frame changes; a correctly wired row does
// not self-repaint at all, and the frame is byte-identical.
describe("ChatApp: CLAUDE_AX_SCREEN_READER freezes all three live-turn indicators (F8 T6 review, Finding A)", () => {
  it("freezes the turn spinner glyph", async () => {
    vi.stubEnv("CLAUDE_AX_SCREEN_READER", "1");
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await rafTick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      for (let i = 0; i < 400 && !spinnerUp(line(lastFrame)); i++) await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      expect(spinnerUp(line(lastFrame))).toBe(true);
      const first = line(lastFrame);
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });   // far past the 50-100ms spinner tick
      expect(line(lastFrame)).toBe(first);                                    // no self-repaint — the glyph never moved
    } finally { unmount(); }
  });

  it("freezes the compaction bar", async () => {
    vi.stubEnv("CLAUDE_AX_SCREEN_READER", "1");
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await rafTick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } }); });
      for (let i = 0; i < 400 && !line(lastFrame).includes("Compacting conversation…"); i++) await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      expect(line(lastFrame)).toContain("Compacting conversation…");
      const first = line(lastFrame);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });  // two full minutes of bar-fill time
      expect(line(lastFrame)).toBe(first);                                     // glyph AND percentage unmoved
    } finally { unmount(); }
  });

  it("freezes the retry countdown row", async () => {
    vi.stubEnv("CLAUDE_AX_SCREEN_READER", "1");
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await rafTick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await act(async () => {
        fake.pushEvent({ kind: "message", data: { type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 60_000, error_status: 529, error: "overloaded" } });
      });
      for (let i = 0; i < 400 && !line(lastFrame).includes("Retrying in"); i++) await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      expect(line(lastFrame)).toContain("Retrying in");
      const first = line(lastFrame);
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });   // far past the 120ms retry tick
      expect(line(lastFrame)).toBe(first);                                     // countdown never advanced on its own
    } finally { unmount(); }
  });

  // Controls, `retry-row.test.tsx`'s "WITHOUT reduced motion… proving the freeze above is the prop, not a
  // test artifact" idiom applied to all three mounts: same fixture, same elapsed time, `CLAUDE_AX_SCREEN_
  // READER` left UNSET. Without one of these, a future change that stopped a row repainting for some other
  // reason (a broken timer, an accidentally-`null` interval) would leave the freeze test above green forever
  // — it only ever proves "the frame didn't change", never "…and it would have without the flag".
  it("CONTROL: without the flag, the same elapsed time DOES move the turn spinner glyph", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await rafTick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      for (let i = 0; i < 400 && !spinnerUp(line(lastFrame)); i++) await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      expect(spinnerUp(line(lastFrame))).toBe(true);
      const first = line(lastFrame);
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(line(lastFrame)).not.toBe(first);
    } finally { unmount(); }
  });

  it("CONTROL: without the flag, the same elapsed time DOES move the compaction bar", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await rafTick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } }); });
      for (let i = 0; i < 400 && !line(lastFrame).includes("Compacting conversation…"); i++) await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      expect(line(lastFrame)).toContain("Compacting conversation…");
      const first = line(lastFrame);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(line(lastFrame)).not.toBe(first);
    } finally { unmount(); }
  });

  it("CONTROL: without the flag, the same elapsed time DOES move the retry countdown row", async () => {
    const fake = fakeRemote();
    const { lastFrame, unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await rafTick();
    vi.useFakeTimers();
    try {
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await act(async () => {
        fake.pushEvent({ kind: "message", data: { type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 60_000, error_status: 529, error: "overloaded" } });
      });
      for (let i = 0; i < 400 && !line(lastFrame).includes("Retrying in"); i++) await act(async () => { await vi.advanceTimersByTimeAsync(5); });
      expect(line(lastFrame)).toContain("Retrying in");
      const first = line(lastFrame);
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(line(lastFrame)).not.toBe(first);
    } finally { unmount(); }
  });
});
