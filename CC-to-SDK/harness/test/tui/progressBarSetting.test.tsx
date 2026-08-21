// test/tui/progressBarSetting.test.ts — T-CH34: the `terminalProgressBarEnabled` setting's useChat half,
// `reduced-motion.test.tsx`'s Part 1 idiom applied to this row (that file's own header records why: the
// F8 T6 review found the ENTIRE reduceMotion wiring shippable with zero coverage of this exact seam — the
// `/config` switch arm, the setter's persist, and the seeded initial value — so this row gets the same
// three-cut coverage from day one instead of retroactively.
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { useChat } from "../../src/tui/useChat.js";
import type { CcxPrefs } from "../../src/tui/prefs.js";

const roots: string[] = [];
const tmpRoot = (): NodeJS.ProcessEnv => { const d = mkdtempSync(join(tmpdir(), "ccx-progressbar-")); roots.push(d); return { ...process.env, CCX_FLEET_ROOT: d }; };
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }

/** Mirrors `reduced-motion.test.tsx`'s `Host`: reads the REAL `useChat` state, exposes the setter AND
 *  `submit` so the `/config` command path is reachable, and hands the seeded pref back out through
 *  `savePrefs`. */
function Host({ fake, env, sink, savePrefs, api, seed }: { fake: FakeRemote; env: NodeJS.ProcessEnv; sink: { enabled: boolean }; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void; api?: { setEnabled?: (v: boolean) => void; submit?: (s: string) => void }; seed?: boolean }) {
  const c = useChat(() => fake, { ...(seed === undefined ? {} : { initialTerminalProgressBarEnabled: seed }) }, { env, savePrefs });
  sink.enabled = c.state.terminalProgressBarEnabled;
  if (api) { api.setEnabled = c.setTerminalProgressBarEnabled; api.submit = c.submit; }
  return <Text>pb:{String(c.state.terminalProgressBarEnabled)}</Text>;
}

describe("useChat — the `terminalProgressBarEnabled` setting (T-CH34)", () => {
  it("defaults to TRUE when the caller seeds nothing — canon's own polarity", async () => {
    // kills the nearest wrong implementation: a default of `false` (reduceMotion's polarity, copied
    // without flipping it) would fail this specific assertion and nothing else in this file.
    const env = tmpRoot(), fake = fakeRemote(), sink = { enabled: false };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} />);
    await tick();
    try { expect(sink.enabled).toBe(true); } finally { unmount(); }
  });

  it("picks up `initialTerminalProgressBarEnabled` — the seam `chatMain.tsx` feeds it through", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { enabled: true };
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} seed={false} />);
    await tick();
    try { expect(sink.enabled).toBe(false); } finally { unmount(); }
  });

  it("`setTerminalProgressBarEnabled` flips the live state AND persists the `{ terminalProgressBarEnabled }` patch, both directions", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { enabled: true };
    const saves: Partial<CcxPrefs>[] = [], api: { setEnabled?: (v: boolean) => void } = {};
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} api={api} savePrefs={(patch) => { saves.push(patch); }} />);
    await tick();
    try {
      expect(sink.enabled).toBe(true);
      await act(async () => { api.setEnabled!(false); });
      expect(sink.enabled).toBe(false);
      expect(saves).toEqual([{ terminalProgressBarEnabled: false }]);
      await act(async () => { api.setEnabled!(true); });
      expect(sink.enabled).toBe(true);
      expect(saves).toEqual([{ terminalProgressBarEnabled: false }, { terminalProgressBarEnabled: true }]);
    } finally { unmount(); }
  });

  it("`/config progressBar=false` — the useChat.ts switch arm — flips state AND persists, and `=true` flips it back", async () => {
    const env = tmpRoot(), fake = fakeRemote(), sink = { enabled: true };
    const saves: Partial<CcxPrefs>[] = [], api: { submit?: (s: string) => void } = {};
    const { unmount } = render(<Host fake={fake} env={env} sink={sink} api={api} savePrefs={(patch) => { saves.push(patch); }} />);
    await tick();
    try {
      expect(sink.enabled).toBe(true);
      await act(async () => { api.submit!("/config progressBar=false"); });
      await tick();
      expect(sink.enabled).toBe(false);
      expect(saves).toEqual([{ terminalProgressBarEnabled: false }]);
      await act(async () => { api.submit!("/config progressBar=true"); });
      await tick();
      expect(sink.enabled).toBe(true);
      expect(saves).toEqual([{ terminalProgressBarEnabled: false }, { terminalProgressBarEnabled: true }]);
    } finally { unmount(); }
  });
});
