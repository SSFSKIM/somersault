// tui/src/TurnSpinner.tsx — the live-turn indicator: an animated ✻ asterisk-pulse glyph (Claude accent), a
// thinking gerund, and the dim parenthetical `({elapsed} · {↓|↑} {N} tokens · {phase})`. ChatApp mounts it
// only while a turn is in flight. `now`/`verb`/`pick` are injectable for deterministic tests.
//
// WAVE C TASK 6 — everything past the glyph changed. Three of the four pieces are per-frame state that has
// to live in a component because it is a function of the ANIMATION clock, not of the wire:
//   · the eased character count (`animRef`) walks toward `meter.chars` in 50 ms steps, so the token figure
//     climbs smoothly instead of stepping once per `message_delta` (spec D-C6);
//   · the phase machine (`phaseRef`) is upstream's `m0p`/`h0p` pair, advanced once per frame; and
//   · the gerund is RE-PICKED on every phase transition — upstream re-picks its store's `defaultVerb` on
//     each `resetOverrides()`, which its engine calls between phases, and that is the mid-turn rotation
//     QA-6 reported as a bug in our fixed-per-turn version.
// All three read from `spinner.ts`, which owns the arithmetic and is unit-tested there; this file is the
// clock and the refs. Mutating refs during render is upstream's own shape (`D.current = m0p(D.current, P)`).
import React, { useRef } from "react";
import { Text } from "ink";
import { ACCENT } from "./banner.js";
import {
  glyphFor, spinnerBase, spinnerInterval, pickVerb, spinnerStatus, easeChars, estimateTokens, EASE_STEP_MS,
  initPhaseState, advancePhase, phaseFor, thinkingStatusOf, rotateVerb, type SpinnerPhase,
} from "./spinner.js";
import { useAnimationClock } from "./animationClock.js";
import { IDLE_METER, type SpinnerMeter } from "./liveTurn.js";
import stringWidth from "string-width";

/** F8 TASK 3 replaced the twelve-frame ping-pong at 120 ms with canon's own animation: SIX glyphs walked by
 *  a raised cosine (`spinner.ts`'s `glyphFor`) off `useAnimationClock`, which repaints at 100 ms — 50 while
 *  requesting — and is the same clock the character easing counts its 50 ms steps against. */
export function TurnSpinner({ startedAt, verb, meter = IDLE_METER, columns = 80, verbose = false, reducedMotion = false, env = process.env, now = Date.now, pick = pickVerb }: {
  startedAt: number; verb?: string; meter?: SpinnerMeter; columns?: number; verbose?: boolean;
  reducedMotion?: boolean; env?: NodeJS.ProcessEnv; now?: () => number; pick?: () => string;
}) {
  // LAZY, not `useRef(verb ?? pick())`: an argument is evaluated on every render, so the eager form drew a
  // fresh verb from `pick` each frame and threw it away — invisible with `Math.random`, and an off-by-N
  // walk through an injected list in a test.
  const verbRef = useRef<string>();
  if (verbRef.current === undefined) verbRef.current = verb ?? pick();
  const animRef = useRef({ chars: 0, at: 0 });                 // eased char count + the animation ms it was last advanced to
  const phaseRef = useRef(initPhaseState());
  const kindRef = useRef<SpinnerPhase["kind"]>("none");

  const animMs = useAnimationClock(spinnerInterval(meter.mode, reducedMotion), startedAt, now);
  // The easing's cursor belongs to the clock, so it resets WITH the clock. A new `startedAt` sends `animMs`
  // back to 0 while `animRef.at` still holds the last turn's high mark, and `floor((0 - at)/50)` is negative
  // — no step ever runs, so the second turn's token figure sits on the first turn's number until the clock
  // climbs back past it. One stamp, one cursor.
  const stampRef = useRef(startedAt);
  if (stampRef.current !== startedAt) { stampRef.current = startedAt; animRef.current = { chars: 0, at: 0 }; }
  // Under reduced motion the eased count SNAPS to its target (canon L507780: `if (t) ie.current = B`).
  // There is no animation to ease, and easing against a clock nobody advances would freeze the number.
  if (reducedMotion) animRef.current = { chars: meter.chars, at: animMs };
  else {
    const steps = Math.floor((animMs - animRef.current.at) / EASE_STEP_MS);
    if (steps > 0) animRef.current = { chars: easeChars(animRef.current.chars, meter.chars, steps), at: animRef.current.at + steps * EASE_STEP_MS };
  }

  // startedAt can be 0 for ONE frame: useChat sets busy and the start stamp in two setState calls that do
  // not commit together here, so the first painted frame has busy=true and startedAt=0 — and `now() - 0` is
  // milliseconds since 1970, which rendered as "(29758130m 59s)" in the real binary (pty acceptance, w3.9).
  // Only a live frame showed it; every unit test passed a real stamp. Treat a non-positive stamp as "just
  // started" rather than trusting the caller.
  const clock = now();
  const elapsedMs = startedAt > 0 ? clock - startedAt : 0;
  const input = {
    now: clock, isThinking: meter.isThinking, hasActiveTools: meter.hasActiveTools,
    thinkingStatus: thinkingStatusOf(meter.lastBurst, meter.isThinking, clock),
    // RECORDED DIVERGENCE (constraint 12): upstream gates both tool rungs on `tengu_shining_fractals`,
    // whose call-site default is false, so a stock 2.1.220 never prints them. The Wave C spec lists
    // `running tool for {t}` / `ran tool for {t}` as shipped copy, so ccx turns them on here.
    showToolTimer: true,
  };
  phaseRef.current = advancePhase(phaseRef.current, input);
  const phase = phaseFor(phaseRef.current, input);
  if (phase.kind !== kindRef.current) {
    if (verb === undefined) verbRef.current = rotateVerb(verbRef.current!, kindRef.current, phase.kind, pick);
    kindRef.current = phase.kind;
  }

  const gerund = `${verbRef.current!}…`;
  const status = spinnerStatus({
    elapsedMs, tokens: estimateTokens(animRef.current.chars), mode: meter.mode, phase,
    columns, messageWidth: stringWidth(gerund), verbose,   // `Y`; spinnerStatus adds upstream's own +2 glyph cell
  });
  return (
    <Text>
      <Text color={ACCENT}>{reducedMotion ? spinnerBase(env)[0]! : glyphFor(animMs, env)}</Text>
      <Text>{` ${gerund}`}</Text>
      {status ? <Text dimColor>{` ${status}`}</Text> : null}
    </Text>
  );
}
