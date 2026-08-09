// test/tui/resize-midturn.test.tsx — Wave R task 6, acceptance A3 (qa2-09): resizing DURING a streaming turn
// must leave exactly ONE elapsed-time spinner row and ONE `esc to interrupt`, and the interrupt that ends the
// turn must leave neither behind. The QA finding saw up to four spinner rows carrying three
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
import { spinnerRows } from "./helpers/spinnerRow.js";

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

// The needles are read off the code, not guessed: `spinnerStatus` (spinner.ts) builds
// `(3s · ↓ 142 tokens)` with the token clause present only once the eased estimate is > 0, and
// `formatElapsed` switches to `1m05s` past a minute. Counting is done over the WHOLE stripped frame rather
// than per line: a duplicate spinner is a duplicate row, and a per-line filter would also silently pass a
// frame whose rows had been concatenated. Every width used below keeps the row under ink-testing-library's
// fixed 100-column stdout (longest possible: glyph + the 18-char `Flibbertigibbeting…` + the tail ≈ 50), so
// no assertion here depends on where the fake terminal happens to wrap.
//
// WAVE C TASK 6 REPOINTED THE SECOND NEEDLE AND KEPT THE RULE. This file used to count `esc to interrupt`
// occurrences as its spinner-row census. That copy is not spinner copy any more — the tail lost it and the
// footer hint list carries it on every busy frame — so counting it would now return 1 no matter how many
// spinners the tree held, and the whole file would pass vacuously. The census is the ELAPSED TAIL, which
// only a mounted spinner can print, plus `spinnerRows` for the gerund itself.
const ELAPSED_TAIL = /\((\d+m\d{2}s|\d+s)(?: · [↓↑] [\d.]+k? tokens)?\)/g;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const gerundRows = (f: () => string | undefined) => spinnerRows(strip(frame(f)));
/** Every elapsed tail in the frame, as its clock READING — `["1s"]`, or `["0s","2s","3s"]` on the frame QA
 *  photographed. Counting alone cannot tell one clock from three frozen ones that all read `0s`, which is
 *  what the first version of this file asserted (fix round 1, finding F6). */
const elapsedValues = (f: () => string | undefined) => [...strip(frame(f)).matchAll(ELAPSED_TAIL)].map((m) => m[1]);
const elapsedRows = (f: () => string | undefined) => elapsedValues(f).length;
const secs = (v: string) => { const m = /^(?:(\d+)m)?(\d+)s$/.exec(v); if (!m) throw new Error(`unparseable elapsed: ${v}`); return Number(m[1] ?? 0) * 60 + Number(m[2]); };
/** Wait for the live clock to actually MOVE, and return the reading it moved off. There is no clock seam at
 *  this level and this deliberately does not add one: `TurnSpinner`'s `now` prop IS injectable, but ChatApp
 *  never passes it (ChatApp.tsx's `<TurnSpinner startedAt tokens />`), and threading one through production
 *  code for a test's convenience is not worth it. The real clock is enough — the spinner re-renders itself
 *  every 120 ms (TurnSpinner.tsx's `setInterval`), so this polls rather than sleeping a fixed second, and
 *  returns as soon as the reading ticks over (≤ ~1 s). */
async function elapsedMoves(f: () => string | undefined) {
  const before = elapsedValues(f);
  expect(before).toHaveLength(1);
  await waitFor(() => elapsedValues(f).some((v) => v !== before[0]), 4000);
  return before[0];
}

/** SP-R0's repro needs at least one emitted line LONGER THAN THE NEW WIDTH. It supplies that as ONE long
 *  logical line rather than as pre-wrapped rows, and the distinction is measured, not assumed (fix round 1,
 *  finding F1 — the first version of this comment said the paragraph was "wrapped into 120-column rows" and
 *  that is simply false): `renderMarkdown` does not wrap prose at ANY width. `opts.width` reaches exactly one
 *  consumer, `renderTable` (markdown.ts:234 → :249, src/tui/mdTable.ts), so this 531-character paragraph
 *  renders as a SINGLE RenderLine at 120, 70 and 40 alike (measured). What satisfies the condition is the
 *  TERMINAL: the line is far longer than any width used below, so the surface printing it folds it and the
 *  frame carries rows wider than the post-shrink width — which is also why the check below is on the frame's
 *  rows and not on the render's. */
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
    await waitFor(() => elapsedRows(r.lastFrame) > 0);   // the tail only opens once the eased estimate clears zero
    expect(gerundRows(r.lastFrame)).toBe(1);
    expect(elapsedRows(r.lastFrame)).toBe(1);
    // …and the over-wide content really is on screen, or the shrink below is not the filed repro.
    expect(strip(frame(r.lastFrame)).split("\n").some((l) => l.trimEnd().length > 70)).toBe(true);

    // Let the clock TICK before each resize, so the assertions below bite against a moving value: a build
    // that minted a spinner per width would show two readings, and one that froze the surviving row at the
    // pre-resize reading would fail the `>` (fix round 1, finding F6 — every assertion here used to read
    // `0s`, which one clock and three stopped ones satisfy equally).
    const t0 = await elapsedMoves(r.lastFrame);
    cols = 70; resize.fire(); await tick();                         // the shrink, mid-stream
    expect(gerundRows(r.lastFrame)).toBe(1);
    expect(elapsedValues(r.lastFrame)).toHaveLength(1);
    expect(secs(elapsedValues(r.lastFrame)[0])).toBeGreaterThan(secs(t0));
    // A delta arriving AFTER the resize re-snapshots the live region at the new width — the second half of a
    // mid-turn resize, and the moment a width-keyed spinner would mint its twin.
    fake.pushEvent(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Still streaming after the shrink." } }));
    await waitFor(() => strip(frame(r.lastFrame)).includes("Still streaming"));
    expect(gerundRows(r.lastFrame)).toBe(1);
    expect(elapsedRows(r.lastFrame)).toBe(1);

    const t1 = await elapsedMoves(r.lastFrame);
    cols = 110; resize.fire(); await tick();                        // …and back out again
    expect(gerundRows(r.lastFrame)).toBe(1);
    expect(elapsedValues(r.lastFrame)).toHaveLength(1);
    expect(secs(elapsedValues(r.lastFrame)[0])).toBeGreaterThan(secs(t1));

    r.stdin.write("\x1b");                                          // Esc on a busy turn is always interrupt
    await waitFor(() => gerundRows(r.lastFrame) === 0);
    expect(gerundRows(r.lastFrame)).toBe(0);                           // no stale spinner survives the interrupt
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
    await waitFor(() => elapsedRows(r.lastFrame) > 0);   // the tail only opens once the eased estimate clears zero
    // The clock moves across the run (it is let tick before the 2nd and 4th shrinks — two waits, not four,
    // because each costs up to a real second and two are enough to make the reading change twice). THIS is
    // the case qa2-09's frame belongs to: three elapsed times coexisting after successive mid-turn shrinks.
    // With a still clock the whole loop reads `0s` and cannot tell three rows apart from one (fix round 1, F6).
    let prev = elapsedValues(r.lastFrame)[0];
    for (const w of [100, 90, 80, 70]) {
      if (w === 90 || w === 70) prev = await elapsedMoves(r.lastFrame);
      cols = w; resize.fire(); await tick();
      expect(gerundRows(r.lastFrame)).toBe(1);
      expect(elapsedValues(r.lastFrame)).toHaveLength(1);            // …exactly one clock, not one per width
      expect(secs(elapsedValues(r.lastFrame)[0])).toBeGreaterThanOrEqual(secs(prev));   // …and it is the LATEST reading
    }
    r.stdin.write("\x1b");
    await waitFor(() => gerundRows(r.lastFrame) === 0);
    expect(elapsedRows(r.lastFrame)).toBe(0);
    r.unmount();
  });
});
