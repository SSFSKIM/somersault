// tui/src/ThinkingIndicator.tsx — the pre-first-frame "thinking…" placeholder: a spinner + elapsed seconds.
// One interval, created on mount and cleared on unmount; ChatApp mounts this ONLY during the gap (busy &&
// no streamed content yet), so the timer exists only while waiting. `now` is injectable for deterministic tests.
import React, { useEffect, useState } from "react";
import { Text } from "ink";

const FRAMES = ["✨", "✦", "✧", "✦"];

export function ThinkingIndicator({ startedAt, now = Date.now }: { startedAt: number; now?: () => number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 120); return () => clearInterval(t); }, []);
  const frame = FRAMES[tick % FRAMES.length];
  const secs = Math.max(0, Math.floor((now() - startedAt) / 1000));
  return <Text dimColor>{`${frame} Thinking… ${secs}s`}</Text>;
}
