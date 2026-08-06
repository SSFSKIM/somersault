// test/tui/resize-midturn.test.tsx — Wave R task 6, acceptance A3 (qa2-09): resizing DURING a streaming turn
// must leave exactly ONE elapsed-time spinner row and ONE `esc to interrupt`, and the interrupt that ends the
// turn must leave neither behind. The QA finding saw up to four `esc to interrupt` rows carrying three
// different elapsed times in a single frame, and its claim that this self-heals at end of turn was REFUTED by
// measurement (spec §12 item 14): every stale row survived the interrupt verbatim.
//
// WHAT THIS FILE CAN AND CANNOT SEE — read before adding to it. `ink-testing-library` reports the LAST
// RENDERED FRAME, not the terminal's accumulated screen, so the duplication QA photographed (a repaint whose
// erase was computed against the pre-shrink wrap height, leaving the previous frame's rows on screen) is
// invisible here BY CONSTRUCTION. What this file pins is the layer below it: ChatApp mounts exactly one
// live-turn slot (ChatApp.tsx's `state.busy && !pagerUp` arm, one <TurnSpinner>), a resize re-renders that
// tree through Task 1's size state without minting a second one, and `turn phase:end` — which is what an
// interrupt produces on the wire — clears both the spinner and the streaming region. A regression that put a
// second spinner into the element tree (a per-width memo, a keyed remount, a spinner moved into a list) would
// fail here; a repaint-erase regression would not, and is covered by the live A3 cell in
// scripts/resize-matrix.sh, which drives a real tmux window. Both exist deliberately.
import React from "react";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";

// The composer seeds and appends prompt history under `fleetRoot()`; without this it would touch the real
// ~/.claude (a defect regardless of whether the test passes).
let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-rm-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

const frame = (f: () => string | undefined) => f() ?? "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** resize-state.test.tsx's seam, verbatim in shape: subscribe → unsubscribe, the contract ChatApp defaults to
 *  over `process.stdout`'s "resize" event. A test cannot resize ink-testing-library's fake stdout. */
function fakeResize() {
  const cbs = new Set<() => void>();
  return { onResize: (cb: () => void) => { cbs.add(cb); return () => { cbs.delete(cb); }; }, fire: () => { for (const cb of [...cbs]) cb(); } };
}

// The needles are read off the code, not guessed: `spinnerStatus` (spinner.ts:66) builds
// `(3s · 142 tokens · esc to interrupt)` with the token clause present only once tokens > 0, and `formatElapsed`
// switches to `1m 05s` past a minute. Counting is done over the WHOLE stripped frame rather than per line: a
// duplicate spinner is a duplicate row, and a per-line filter would also silently pass a frame whose rows had
// been concatenated. Every width used below keeps the row under ink-testing-library's fixed 100-column stdout
// (longest possible: glyph + the 18-char `Flibbertigibbeting…` + the 36-char tail ≈ 58), so no assertion here
// depends on where the fake terminal happens to wrap.
const ELAPSED_TAIL = /\((?:\d+m )?\d+s(?: · \d+ tokens)? · esc to interrupt\)/g;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const escRows = (f: () => string | undefined) => count(strip(frame(f)), /esc to interrupt/g);
const elapsedRows = (f: () => string | undefined) => count(strip(frame(f)), ELAPSED_TAIL);

/** SP-R0's repro needs at least one emitted line LONGER THAN THE NEW WIDTH. The live region renders markdown
 *  at `columnsFn()`, so a paragraph this long is wrapped into 120-column rows that the 70-column shrink then
 *  overflows — the condition a shrink with only short rows on screen cannot reproduce. */
const LONG_PARA = "This paragraph exists to put emitted rows wider than the post-shrink width on screen, because a shrink whose frame carries no over-wide line cannot reproduce the defect at all. ".repeat(3);

const streamEvent = (event: unknown) => ({ kind: "message" as const, data: { type: "stream_event", event } });

describe("a mid-turn resize leaves one spinner, and the interrupt clears it (A3)", () => {
  it("holds exactly one elapsed row and one `esc to interrupt` across a shrink and a re-grow, and none after the interrupt", async () => {
    let cols = 120;
    const resize = fakeResize();
    // escape.test.tsx's pattern: the fake has to push its own wire frames, so it is declared before it is
    // built. An interrupt on the real host ENDS the turn — the client never clears `busy` itself — so the
    // fake answers `session.interrupt()` with the `turn phase:end` frame the host would send.
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({ interrupt: () => { fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); } });
    const deps = { columns: () => cols, getSessionMessages: async () => [] as any[] };
    const r = renderWithKeymap(<ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));       // the composer's own pointer + NBSP (bundle L494723), spelled out: the band above uses a normal space

    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent(streamEvent({ type: "message_start", message: { id: "msg_a3" } }));
    fake.pushEvent(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    fake.pushEvent(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: LONG_PARA } }));
    fake.pushEvent(streamEvent({ type: "message_delta", usage: { output_tokens: 142 } }));
    await waitFor(() => escRows(r.lastFrame) > 0);
    expect(escRows(r.lastFrame)).toBe(1);
    expect(elapsedRows(r.lastFrame)).toBe(1);
    // …and the over-wide content really is on screen, or the shrink below is not the filed repro.
    expect(strip(frame(r.lastFrame)).split("\n").some((l) => l.trimEnd().length > 70)).toBe(true);

    cols = 70; resize.fire(); await tick();                         // the shrink, mid-stream
    expect(escRows(r.lastFrame)).toBe(1);
    expect(elapsedRows(r.lastFrame)).toBe(1);
    // A delta arriving AFTER the resize re-snapshots the live region at the new width — the second half of a
    // mid-turn resize, and the moment a width-keyed spinner would mint its twin.
    fake.pushEvent(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Still streaming after the shrink." } }));
    await waitFor(() => strip(frame(r.lastFrame)).includes("Still streaming"));
    expect(escRows(r.lastFrame)).toBe(1);
    expect(elapsedRows(r.lastFrame)).toBe(1);

    cols = 110; resize.fire(); await tick();                        // …and back out again
    expect(escRows(r.lastFrame)).toBe(1);
    expect(elapsedRows(r.lastFrame)).toBe(1);

    r.stdin.write("\x1b");                                          // Esc on a busy turn is always interrupt
    await waitFor(() => escRows(r.lastFrame) === 0);
    expect(escRows(r.lastFrame)).toBe(0);                           // no stale spinner survives the interrupt
    expect(elapsedRows(r.lastFrame)).toBe(0);
    expect(strip(frame(r.lastFrame))).not.toContain("Still streaming");   // …nor the live region it sat under
    r.unmount();
  });

  // A2's accumulation cell, at the component level: the filed frame carried THREE different elapsed times, so
  // one resize is not the shape that produced it. Successive shrinks with no intervening turn event are.
  it("accumulates no spinner rows across four successive mid-turn resizes", async () => {
    let cols = 120;
    const resize = fakeResize();
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({ interrupt: () => { fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); } });
    const deps = { columns: () => cols, getSessionMessages: async () => [] as any[] };
    const r = renderWithKeymap(<ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} onResize={resize.onResize} />);
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));       // the composer's own pointer + NBSP (bundle L494723), spelled out: the band above uses a normal space
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent(streamEvent({ type: "message_start", message: { id: "msg_a3b" } }));
    fake.pushEvent(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    fake.pushEvent(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: LONG_PARA } }));
    await waitFor(() => escRows(r.lastFrame) > 0);
    for (const w of [100, 90, 80, 70]) {
      cols = w; resize.fire(); await tick();
      expect(escRows(r.lastFrame)).toBe(1);
      expect(elapsedRows(r.lastFrame)).toBe(1);
    }
    r.stdin.write("\x1b");
    await waitFor(() => escRows(r.lastFrame) === 0);
    expect(elapsedRows(r.lastFrame)).toBe(0);
    r.unmount();
  });
});
