// M0.5 — transcript normalization + structural diff.
//
// The normalization spec IS the definition of "behaviorally equivalent": every
// key listed here is declared incidental (ids, clocks, costs); everything else
// is behavior and must match. Grow this list only with justification — each
// addition widens what the harness cannot see.
import { readFileSync } from "node:fs";

export const SCRUB_KEYS = new Set([
  // identity / entropy
  "session_id",
  "uuid",
  "id",
  "request_id",
  "message_id",
  "parent_tool_use_id_fallback", // (placeholder; parent_tool_use_id itself is behavioral)
  // clocks
  "timestamp",
  "started_at",
  "completed_at",
  "duration_ms",
  "duration_api_ms",
  "durationMs",
  "resets_at",
  "retry_after",
  "retryAfter",
  // billing / rate volatile
  "total_cost_usd",
  "costUSD",
  "unified_rate_limit_fallback",
]);

// Clock-valued keys follow naming conventions — scrub by pattern, not enumeration.
// (Found by the M0.6 self-test: ttft_ms / ttft_stream_ms / time_to_request_ms.)
const SCRUB_KEY_PATTERNS = [/_ms$/, /Ms$/, /_at$/, /_seconds$/];

const isScrubbedKey = (k: string) => SCRUB_KEYS.has(k) || SCRUB_KEY_PATTERNS.some((p) => p.test(k));

// Whole message types that are pure environment telemetry, not engine behavior.
const DROP_MESSAGE_TYPES = new Set(["rate_limit_event"]);

/**
 * Value-level scrubs. The replay proxy binds an EPHEMERAL port per run, and the
 * engine echoes its base URL into user-facing error text ("check your inference
 * gateway (127.0.0.1:64277)"). That port is assigned by the harness, so it is
 * incidental — but it is embedded in a string, where key-based scrubbing cannot
 * reach it. Found by the H2 fault suite: two engines produced byte-identical
 * error messages that differed only in the port each was handed.
 */
const VALUE_SCRUBS: [RegExp, string][] = [[/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>"]];

const scrubString = (s: string) => VALUE_SCRUBS.reduce((acc, [re, to]) => acc.replace(re, to), s);

export function normalizeValue(v: unknown, keyPath: string[] = []): unknown {
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map((x) => normalizeValue(x, keyPath));
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = isScrubbedKey(k) ? "<scrubbed>" : normalizeValue(val, [...keyPath, k]);
    }
    return out;
  }
  return v;
}

export function normalizeTranscript(messages: unknown[]): unknown[] {
  return messages
    .filter((m) => !DROP_MESSAGE_TYPES.has((m as { type?: string })?.type ?? ""))
    .map((m) => normalizeValue(m));
}

export interface DiffFinding {
  index: number;
  path: string;
  a: unknown;
  b: unknown;
}

function diffValue(a: unknown, b: unknown, path: string, index: number, out: DiffFinding[], cap: number): void {
  if (out.length >= cap) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) diffValue(a[i], b[i], `${path}[${i}]`, index, out, cap);
    return;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys)
      diffValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, index, out, cap);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ index, path, a, b });
}

/** Diff two normalized transcripts message-by-message. Empty result = equivalent. */
export function diffTranscripts(aRaw: unknown[], bRaw: unknown[], cap = 50): DiffFinding[] {
  const a = normalizeTranscript(aRaw);
  const b = normalizeTranscript(bRaw);
  const out: DiffFinding[] = [];
  if (a.length !== b.length) out.push({ index: -1, path: "(message count)", a: a.length, b: b.length });
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n && out.length < cap; i++) diffValue(a[i], b[i], `msg[${i}]`, i, out, cap);
  return out;
}

export function loadTranscript(file: string): unknown[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
