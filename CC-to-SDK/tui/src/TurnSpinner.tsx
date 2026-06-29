// tui/src/TurnSpinner.tsx — the live-turn indicator: an animated ✻ asterisk-pulse glyph (Claude accent) + a
// random thinking verb (fixed per mount = per turn) + a dim "(elapsed · esc to interrupt)" tail. ChatApp
// mounts it only while a turn is in flight, so each turn picks a fresh verb. `now`/`verb` injectable for
// deterministic tests. Supersedes the old ThinkingIndicator (which only covered the pre-first-frame gap).
import React, { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import { ACCENT } from "./banner.js";
import { glyphFrame, pickVerb, spinnerStatus } from "./spinner.js";

export function TurnSpinner({ startedAt, verb, tokens = 0, now = Date.now }: { startedAt: number; verb?: string; tokens?: number; now?: () => number }) {
  const [tick, setTick] = useState(0);
  const verbRef = useRef(verb ?? pickVerb());                 // picked once on mount → stable for the turn
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 120); return () => clearInterval(t); }, []);
  return (
    <Text>
      <Text color={ACCENT}>{glyphFrame(tick)}</Text>
      <Text>{" " + verbRef.current + "…"}</Text>
      <Text dimColor>{" " + spinnerStatus(now() - startedAt, tokens)}</Text>
    </Text>
  );
}
