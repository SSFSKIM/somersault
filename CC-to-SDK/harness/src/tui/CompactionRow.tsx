// tui/src/CompactionRow.tsx — Wave S Task 11 (W-S7): the indicator row for a compaction pass in flight.
// It takes the SAME single live-turn slot TurnSpinner owns (ChatApp's one mount) rather than sitting
// beside it — upstream's compaction spinner replaces the ordinary one, and two pulsing verbs stacked would
// read as two things running.
//
// THE BAR IS THEATRE and the curve lives next door in compactionBar.ts, which says so at length: nothing on
// the SDK wire reports compaction progress, so the fill is a wall-clock saturating curve. This component
// only paints it; do not teach it to look for a real number, there isn't one.
//
// Geometry is upstream's (L407977-978, L408060): the verb line, then the bar indented `marginLeft: 2` with a
// one-column gap before a dim `NN%`. Under 8 usable cells the BAR is suppressed and the verb line stays —
// a narrow terminal loses the decoration, not the news that something is running.
//
// ONE DELIBERATE COLOUR DIVERGENCE, recorded rather than silent: upstream passes no `fillColor` at :407978,
// so its pill renders the FILLED run in the default foreground and dims only the empty run. We paint the
// fill `ACCENT` — the house colour every other live-turn glyph in this REPL already uses (TurnSpinner's
// pulse, the banner), so a default-foreground fill would read as the odd one out here. Geometry is canon;
// this one colour is ours.
import React, { useRef } from "react";
import { Box, Text } from "ink";
import { ACCENT } from "./banner.js";
import { SPINNER_INTERVAL_MS, spinnerBase, glyphFor } from "./spinner.js";
import { useAnimationClock } from "./animationClock.js";
import { COMPACTING_VERB, BAR_MARGIN_LEFT, barCells, barWidth, compactionRatio } from "./compactionBar.js";

/** `now` is injectable exactly as TurnSpinner's and RetryRow's are — and here it MUST be fed the same clock
 *  `startedAt` was stamped from (useChat stamps it with the injected `deps.now`, ChatApp threads that same
 *  function in), because an elapsed computed across two clocks is the "(29758130m 59s)" bug in bar form. */
export function CompactionRow({ startedAt, now = Date.now, columns, reducedMotion = false, env = process.env }: { startedAt: number; now?: () => number; columns: number; reducedMotion?: boolean; env?: NodeJS.ProcessEnv }) {
  const ratioRef = useRef(0);                                  // monotonic: the bar may never walk backwards
  const animMs = useAnimationClock(reducedMotion ? null : SPINNER_INTERVAL_MS, startedAt, now);
  // The BAR freezes with the glyph. Its ratio is a function of wall-clock elapsed, so left reading `now()`
  // it would keep advancing on any unrelated parent rerender while the glyph stood still — a half-stopped
  // animation, which is worse than either state. Under reduced motion it reads the frozen clock instead:
  // `useAnimationClock(null, …)` holds its water line still rather than merely disarming its timer, so this
  // branch is the whole of the freeze. `ratioRef`'s monotonic floor keeps it from ever walking back.
  //
  // A non-positive stamp reads as "just started". NOT TurnSpinner's race — that one exists because `busy` and
  // `turnStartedAt` are two separate setStates, so a frame can legally have busy=true and startedAt=0; here
  // the flag and the stamp are ONE object written in ONE setState, so a mounted row always has a real stamp.
  // The guard is kept only as a cheap floor against a caller passing 0 directly (the pure tests do).
  const ratio = ratioRef.current = compactionRatio(reducedMotion ? animMs : (startedAt > 0 ? now() - startedAt : 0), ratioRef.current);
  const width = barWidth(columns);
  const { fill, empty } = barCells(ratio, width);
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={ACCENT}>{reducedMotion ? spinnerBase(env)[0]! : glyphFor(animMs, env)}</Text>
        <Text>{" " + COMPACTING_VERB + "…"}</Text>
      </Text>
      {width > 0 ? (
        <Box flexDirection="row" marginLeft={BAR_MARGIN_LEFT} gap={1}>
          <Text><Text color={ACCENT}>{fill}</Text><Text dimColor>{empty}</Text></Text>
          <Text dimColor>{ratio + "%"}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
