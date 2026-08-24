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
  // harness-side artifacts of background work (subagent scenario): a per-run
  // temp path, not engine behavior
  "output_file",
]);

// Clock-valued keys follow naming conventions — scrub by pattern, not enumeration.
// (Found by the M0.6 self-test: ttft_ms / ttft_stream_ms / time_to_request_ms.)
const SCRUB_KEY_PATTERNS = [/_ms$/, /Ms$/, /_at$/, /_seconds$/, /_time$/];

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
const VALUE_SCRUBS: [RegExp, string][] = [
  [/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>"],
  // Clock values rendered INTO prose, where key scrubbing cannot reach them:
  // the subagent tool result carries "<usage>…duration_ms: 26</usage>".
  [/\b(\w*_ms): \d+/g, "$1: <ms>"],
];

/**
 * Keys whose values are identifiers minted LOCALLY BY THE ENGINE (not replayed
 * from the cassette), so their literal values can never match across engines.
 * They also leak into free text — the subagent scenario embeds its agentId in
 * prose the model then quotes — so key-level scrubbing alone cannot reach them.
 *
 * These are mapped rather than blanked: each distinct id becomes <id0>, <id1>,
 * … in first-seen order, everywhere it appears. That keeps the *consistency*
 * check alive (an engine that used two different ids where the oracle used one
 * still diffs) while discarding the unmatchable random value.
 */
const RUN_ID_KEYS = new Set(["session_id", "uuid", "agentId", "task_id", "request_id", "message_id"]);

function collectRunIds(v: unknown, into: Map<string, string>): void {
  if (Array.isArray(v)) {
    for (const x of v) collectRunIds(x, into);
    return;
  }
  if (v === null || typeof v !== "object") return;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (RUN_ID_KEYS.has(k) && typeof val === "string" && val.length >= 6 && !into.has(val)) {
      into.set(val, `<id${into.size}>`);
    }
    collectRunIds(val, into);
  }
}

function makeScrubString(ids: Map<string, string>) {
  // longest-first so a shorter id that is a substring of another cannot shadow it
  const ordered = [...ids.entries()].sort((a, b) => b[0].length - a[0].length);
  return (s: string) => {
    let out = VALUE_SCRUBS.reduce((acc, [re, to]) => acc.replace(re, to), s);
    for (const [id, placeholder] of ordered) out = out.split(id).join(placeholder);
    return out;
  };
}

function normalizeWith(v: unknown, scrub: (s: string) => string): unknown {
  if (typeof v === "string") return scrub(v);
  if (Array.isArray(v)) return v.map((x) => normalizeWith(x, scrub));
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = isScrubbedKey(k) ? "<scrubbed>" : normalizeWith(val, scrub);
    }
    return out;
  }
  return v;
}

/** Single-value normalization (no run-scoped id mapping — use normalizeTranscript for that). */
export function normalizeValue(v: unknown): unknown {
  return normalizeWith(v, makeScrubString(new Map()));
}

/**
 * Build a normalizer whose id map is derived from `sources` — use when the ids
 * appear as KEYS in one artifact (the transcript) but only inside free TEXT in
 * another (the request bodies the engine sent). Normalization is idempotent, so
 * output can be handed to diffTranscripts safely.
 */
export function makeRunNormalizer(...sources: unknown[]): (v: unknown) => unknown {
  const ids = new Map<string, string>();
  for (const s of sources) collectRunIds(s, ids);
  const scrub = makeScrubString(ids);
  return (v: unknown) => normalizeWith(v, scrub);
}

export function normalizeTranscript(messages: unknown[]): unknown[] {
  const ids = new Map<string, string>();
  collectRunIds(messages, ids);
  const scrub = makeScrubString(ids);
  return messages
    .filter((m) => !DROP_MESSAGE_TYPES.has((m as { type?: string })?.type ?? ""))
    .map((m) => normalizeWith(m, scrub));
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
