// tui/src/RetryRow.tsx — Wave T Task 13: the live-turn row that REPLACES the spinner while the API is in
// trouble. The QA fleet watched a 72-second motionless spinner during an outage with no sign anything was
// wrong; upstream never shows that, because `qyn` (bundle L407975-408035, mounted at L407973) takes over the
// whole indicator slot the moment a retry status exists — hence `status ? <RetryRow/> : <TurnSpinner/>` at
// ChatApp's single mount, not two rows side by side.
//
// Copy is verbatim canon, character for character (L407989-8001 stalled — label L407992, tail L407997; and
// L408002-34 retrying — tail L408007, label L408010), and `✻` is
// `i5` (L41482) — the same glyph the spinner animates, here held still and painted `error`. Structure
// mirrors TurnSpinner's flat <Text> rather than canon's `<Box width={2}>` glyph cell: the visible row is
// identical and one Text cannot be re-wrapped into two lines by a narrow test terminal.
//
// THE ONE DIVERGENCE — the stalled row's ` · will retry in <dur>` clause is dropped. Canon computes `$ra`
// from `GLe.deadline` BEFORE branching on `kind`, so upstream's stalled row does carry a countdown, and
// L358821 mints it as `{ kind: "stalled", deadline: Date.now() + Math.max(0, Kn - ss) }`. But `Kn` is
// `Math.min(pYi(authKind), streamWatchdog)` — the abort timeout of the very fetch that stalled, chosen per
// request from env vars and a gate (`dYi`/`pYi`, L99030-99044) INSIDE the `claude` CLI subprocess we spawn.
// No frame reports it, and our stall is measured from the REPL's turn clock, a different origin. So there is
// no honest source for that number out here and it is omitted rather than invented — the same reduction
// `retryStatus.ts` documents for upstream's `b0p` disjunction. If a future wire frame ever carries the
// abort instant, `RetryStatus["stalled"]` gains a `deadline` and the clause comes back verbatim.
import React from "react";
import { Text } from "ink";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { useAnimationClock } from "./animationClock.js";
import type { RetryStatus } from "./retryStatus.js";

const GLYPH = "✻";                                        // canon `i5`, L41482 — U+273B, held still, not animated

/** Canon `ra(Ura, {mostSignificantOnly: Ura >= 300000})` where `Ura` is canon's own
 *  `Math.max(0, Math.ceil(remaining / 1000)) * 1000` (computed at L407976, before the `kind` branch).
 *  Restricted to that call site: the argument is always a
 *  whole number of seconds, so `ra`'s 59.5→60 carry normalisation is unreachable and left out. */
export function retryCountdown(remainingMs: number): string {
  const ms = Math.max(0, Math.ceil(remainingMs / 1000)) * 1000;
  if (ms < 60000) return Math.floor(ms / 1000) + "s";
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
  if (ms >= 300000) return d > 0 ? d + "d" : h > 0 ? h + "h" : m + "m";
  return m + "m " + Math.round(ms % 60000 / 1000) + "s";
}

/** The indicator row for a live `RetryStatus`. `now` is injectable exactly as TurnSpinner's is, so a test
 *  pins the countdown without touching timers; the 120 ms tick only exists to make the countdown move on its
 *  own, which is what canon's per-animation-frame recompute buys. F8 T6: that tick is `useAnimationClock`
 *  now, disarmed under reduced motion — its RETURN VALUE is unused (the countdown arithmetic below still
 *  reads `now()` directly), it is only here to force the periodic repaint, or none at all when frozen. */
export function RetryRow({ status, now = Date.now, reducedMotion = false }: { status: RetryStatus; now?: () => number; reducedMotion?: boolean }) {
  useAnimationClock(reducedMotion ? null : 120, 0, now);
  const err = resolveThemeColor(themeTokens().error);
  if (status.kind === "stalled")
    return (
      <Text>
        <Text color={err}>{GLYPH + " Waiting for API response"}</Text>
        <Text dimColor>{" · check your network"}</Text>
      </Text>
    );
  return (
    <Text>
      <Text color={err}>{GLYPH + " " + status.label}</Text>
      <Text dimColor>{` · Retrying in ${retryCountdown(status.deadline - now())} · attempt ${status.attempt}/${status.maxRetries}`}</Text>
    </Text>
  );
}
