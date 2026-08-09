// tui/test/escape.test.tsx — CC's Esc-Esc semantics (CM15, F0 acceptance 2): idle + text arms a local
// "Esc again to clear" (second press pushes the buffer to history, then clears); idle + EMPTY composer is
// the ONLY path that reaches ChatApp's rewind arm; busy Esc always interrupts, buffer untouched. Mirrors
// test/tui/chat.test.tsx's render/fakeRemote/frame/waitFor idiom — this file has no `tick` helper either,
// so "await a tick before writing keys" is done via `waitFor(() => frame(lastFrame).includes("❯\u00a0"))`
// (Task 1's precedent), not a literal `tick()`.
// That NBSP is load-bearing wherever this idiom appears: F5 Task 2 gave the composer upstream's real
// glyph, `Ge.pointer` + `\xA0` (bundle L494723), and the transcript's user echo is the SAME pointer + a
// NORMAL space — so `❯` alone no longer says "the composer is mounted"; the NBSP is what distinguishes it
// from a prompt sitting in the transcript above.
import { describe, it, expect } from "vitest";
import React from "react";
// F2 task 6: ChatApp/ChatComposer read stdin through <KeymapProvider> now, not `useInput` — rendered bare
// they have no input path at all, so every render here goes through the provider wrapper.
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../../src/session/chatSession.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
// Copied from chat.test.tsx (that file keeps it private, per the brief) — a fakeRemote() extended onto the
// RewindOps surface, so hasRewind() is true and the picker's anchor fetch is observable.
type RewindFakeOpts = { rewindAnchors?: () => Promise<RewindAnchor[]>; rewindDryRun?: (uuid: string) => Promise<RewindDryRun>; rewind?: (anchor: RewindAnchor, scope: RewindScope) => Promise<void> };
function fakeRewindRemote(rewindOpts: RewindFakeOpts, remoteOpts: FakeRemoteOpts = {}) {
  const base = fakeRemote(remoteOpts);
  return { ...base, rewindAnchors: rewindOpts.rewindAnchors ?? (async () => []), rewindDryRun: rewindOpts.rewindDryRun ?? (async () => ({ canRewind: true }) as RewindDryRun), rewind: rewindOpts.rewind ?? (async () => {}) };
}

describe("Escape semantics (CM15, F0 acceptance 2)", () => {
  it("idle + text: first Esc arms 'Esc again to clear' and keeps the buffer; second Esc clears; Up restores as newest history", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("draft text");
    await waitFor(() => frame(lastFrame).includes("draft text"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    expect(frame(lastFrame)).toContain("draft text");                 // buffer intact
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
    stdin.write("\x1b");
    await waitFor(() => !frame(lastFrame).includes("draft text"));    // cleared
    stdin.write("\x1b[A");                                            // Up
    await waitFor(() => frame(lastFrame).includes("draft text"));     // newest history entry
  });

  it("idle + text: the rewind picker NEVER opens (second Esc clears instead)", async () => {
    let anchorsFetched = 0;
    const fake = fakeRewindRemote({ rewindAnchors: async () => { anchorsFetched++; return []; } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("x"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    stdin.write("\x1b"); await waitFor(() => !frame(lastFrame).includes("Esc again to clear"));
    expect(anchorsFetched).toBe(0);
  });

  it("busy + text: Esc interrupts and the buffer survives", async () => {
    let interrupted = 0;
    // fakeRemote()'s opts have no `run` field — a hanging turn is scripted the same way chat.test.tsx's
    // "Esc on an idle composer arms..." test does it: `submit` pushes the turn-start event itself (busy is
    // driven by that host event, not by submit()'s own promise state) and then never resolves.
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); },
      interrupt: async () => { interrupted++; },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("go"); await waitFor(() => frame(lastFrame).includes("go"));
    stdin.write("\r");                                                // start the hanging turn
    await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
    stdin.write("typed during turn");
    await waitFor(() => frame(lastFrame).includes("typed during turn"));
    stdin.write("\x1b");
    await waitFor(() => interrupted === 1);
    expect(frame(lastFrame)).toContain("typed during turn");
  });

  it("the arm expires after escClearMs", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} escClearMs={60} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("aa"); await waitFor(() => frame(lastFrame).includes("aa"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    await waitFor(() => !frame(lastFrame).includes("Esc again to clear"));   // expired; buffer intact
    expect(frame(lastFrame)).toContain("aa");
  });

  it("a non-Esc keystroke disarms (default window, so expiry cannot mask a missing disarm)", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("aa"); await waitFor(() => frame(lastFrame).includes("aa"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    stdin.write("b");                                                        // disarms
    await waitFor(() => frame(lastFrame).includes("aab"));
    expect(frame(lastFrame)).not.toContain("Esc again to clear");
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    expect(frame(lastFrame)).toContain("aab");                               // re-armed first press, nothing cleared
  });

  it("typing into an empty composer revokes a pending rewind arm — the two hints can never contradict", async () => {
    const fake = fakeRewindRemote({ rewindAnchors: async () => [] });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x1b");                                                     // empty composer: arms rewind
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("x");                                                        // buffer now non-empty → rewind arm must die
    await waitFor(() => !frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b");                                                     // second Esc: clear-arm, NOT rewind
    await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
  });
});
