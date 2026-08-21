// test/tui/progressBarWiring.test.tsx — T-CH34: the REPL wiring, `terminal-title.test.tsx`'s "the mount
// site" idiom applied to the progress bar. `progressBar.test.ts` already pins the pure driver's byte-level
// contract (`createProgressBar`); what this file asks is only whether `<ChatApp>` DRIVES it — because the
// driver is pure and the mount site is where a port of this shape goes wrong (a busy flag nobody forwards,
// or the wrong signal fed in). Uses the REAL `createProgressBar`, not a hand-rolled spy: deleting the
// `ChatApp.tsx` effect that calls `progressBar.update(...)` must make this file's assertions fail, which a
// spy-only test (one that merely counts calls) would not guarantee if the effect fed it the wrong shape.
import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { renderWithKeymap } from "./keysTestUtil.js";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { createProgressBar } from "../../src/tui/progressBar.js";

async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** One whole turn on the host event stream — `terminal-title.test.tsx`'s own helper, unchanged. */
async function runTurn(fake: FakeRemote, seq: number) {
  await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq }); });
  await act(async () => { fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: `a${seq}`, message: { id: `m${seq}`, content: [{ type: "text", text: "ok" }] } } }); });
  await act(async () => { fake.pushEvent({ kind: "turn", phase: "end", seq }); });
  await tick();
}

const INDETERMINATE = "\x1b]9;4;3;\x07", CLEAR = "\x1b]9;4;0;\x07";

describe("<ChatApp> — the progress-bar mount site (T-CH34)", () => {
  it("forwards a whole turn through the REAL driver: CLEAR at mount, INDETERMINATE at turn start, CLEAR at settle", async () => {
    const writes: string[] = [];
    const progressBar = createProgressBar({ write: (s) => writes.push(s), capability: true, env: {} as NodeJS.ProcessEnv });
    const fake = fakeRemote();
    const { unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} progressBar={progressBar} />);
    await tick();
    try {
      expect(writes).toEqual([CLEAR]);                                  // mount: one CLEAR, canon's own first-mount behavior
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); });
      await waitFor(() => writes.length === 2);
      expect(writes).toEqual([CLEAR, INDETERMINATE]);
      await act(async () => { fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); });
      await waitFor(() => writes.length === 3);
      expect(writes).toEqual([CLEAR, INDETERMINATE, CLEAR]);
    } finally { unmount(); }
  });

  it("never spams — a second turn's start/end after the first writes exactly two more bytes, not one per render", async () => {
    const writes: string[] = [];
    const progressBar = createProgressBar({ write: (s) => writes.push(s), capability: true, env: {} as NodeJS.ProcessEnv });
    const fake = fakeRemote();
    const { unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} progressBar={progressBar} />);
    await tick();
    try {
      await runTurn(fake, 1);
      await waitFor(() => writes.length === 3);                          // mount CLEAR, start INDETERMINATE, end CLEAR
      await runTurn(fake, 2);
      await waitFor(() => writes.length === 5);
      expect(writes).toEqual([CLEAR, INDETERMINATE, CLEAR, INDETERMINATE, CLEAR]);
    } finally { unmount(); }
  });

  it("capability OFF (no `progressBar` prop): a whole turn writes nothing — the WIRING guard, not the driver's", async () => {
    const fake = fakeRemote();
    const { unmount } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await tick();
    try {
      await runTurn(fake, 1);
      // Nothing to assert on directly (there is no writer without a progressBar prop) — this test's job is
      // only to prove ChatApp tolerates the prop's absence (daemon/HOST sessions never pass one) without
      // throwing, matching `terminalTitle`'s same optional-prop contract.
      expect(true).toBe(true);
    } finally { unmount(); }
  });

  it("the setting reaches the effect too, not just `state.busy` — seeded OFF, a whole turn writes nothing", async () => {
    // Kills the nearest wrong implementation: an effect that hardcodes `enabled: true` (reading only
    // `state.busy`, ignoring `state.terminalProgressBarEnabled`) would pass every test above and fail only
    // this one — `initialTerminalProgressBarEnabled: false` reaches `useChat`'s own seeded state through
    // `hookOpts`, so a turn that still emits INDETERMINATE here proves the effect never reads the setting.
    const writes: string[] = [];
    const progressBar = createProgressBar({ write: (s) => writes.push(s), capability: true, env: {} as NodeJS.ProcessEnv });
    const fake = fakeRemote();
    const { unmount } = renderWithKeymap(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} progressBar={progressBar}
        hookOpts={{ initialTerminalProgressBarEnabled: false }} />,
    );
    await tick();
    try {
      expect(writes).toEqual([CLEAR]);                                  // OFF at mount still gets canon's one first-mount CLEAR (m6h's null-> CLEAR path)
      await runTurn(fake, 1);
      expect(writes).toEqual([CLEAR]);                                  // …and NO second write for the turn — the setting, not just busy, gated it
    } finally { unmount(); }
  });
});
