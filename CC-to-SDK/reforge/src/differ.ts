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
  // The billing header's cc_version carries a per-PROCESS suffix
  // ("2.1.241.b71" vs "2.1.241.12d"); the version is behavior, the suffix is not.
  [/(cc_version=\d+\.\d+\.\d+)\.[0-9a-z]+/g, "$1.<proc>"],
  // Plan-mode file names end in two RANDOM words
  // (".../plans/reply-with-exactly-still-here-toasty-fiddle.md" vs
  // "…-spicy-candy.md"). The prompt-derived prefix is behavior — the engine
  // names the file after the request — so keep it and scrub only the suffix.
  // Drawn from a large space, so triage-by-sampling can never certify it.
  [/(\/plans\/[a-z0-9-]+?)-[a-z]+-[a-z]+\.md/g, "$1-<rand>.md"],
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

/**
 * Canonicalize an ordering that is NOT a contract.
 *
 * Parallel tool calls come back in COMPLETION order, which races: the oracle
 * disagrees with itself run to run. Sampling the oracle twice only observes two
 * of the possible orderings, so an engine producing a third *valid* ordering
 * still diffs. Remove the nondeterminism at its source instead: within one
 * message, sort tool_result blocks by `tool_use_id`.
 *
 * This is safe precisely because the ids come from the cassette's assistant
 * message, so they are identical across engines — and it discards only the
 * arrival order, never the set of results or their contents. Ordering that IS a
 * contract (the sequence of messages, of content blocks the model authored) is
 * untouched.
 */
function canonicalizeArray(items: unknown[]): unknown[] {
  const allToolResults =
    items.length > 1 &&
    items.every(
      (x) =>
        x !== null &&
        typeof x === "object" &&
        (x as { type?: string }).type === "tool_result" &&
        typeof (x as { tool_use_id?: unknown }).tool_use_id === "string",
    );
  if (!allToolResults) return items;
  const sorted = [...items].sort((a, b) =>
    String((a as { tool_use_id: string }).tool_use_id).localeCompare(String((b as { tool_use_id: string }).tool_use_id)),
  );
  // The prompt-cache breakpoint is attached POSITIONALLY (to the last block of
  // the message), so which tool_result carries it is decided by the same racy
  // arrival order we just sorted away. Whether the engine sets a breakpoint at
  // all is real behavior (it drives cost), so keep the COUNT as an explicit
  // element and drop the positional attachment.
  let breakpoints = 0;
  const stripped = sorted.map((x) => {
    const o = x as Record<string, unknown>;
    if (!("cache_control" in o)) return x;
    breakpoints++;
    const { cache_control: _drop, ...rest } = o;
    return rest;
  });
  return breakpoints > 0 ? [...stripped, { type: "reforge-cache-breakpoints", count: breakpoints }] : stripped;
}

function normalizeWith(v: unknown, scrub: (s: string) => string): unknown {
  if (typeof v === "string") return scrub(v);
  if (Array.isArray(v)) return canonicalizeArray(v).map((x) => normalizeWith(x, scrub));
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

/**
 * The array-level canonicalization above cannot reach parallel tool results in a
 * TRANSCRIPT, because the SDK emits one message PER result block — so the racy
 * completion order shows up as message order. Sort each maximal run of
 * consecutive single-tool_result messages by `tool_use_id`, for the same reason
 * and with the same safety: the ids come from the cassette, and only arrival
 * order is discarded.
 */
const singleToolResultId = (m: unknown): string | null => {
  const content = (m as { type?: string; message?: { content?: unknown } })?.message?.content;
  if ((m as { type?: string })?.type !== "user" || !Array.isArray(content) || content.length !== 1) return null;
  const b = content[0] as { type?: string; tool_use_id?: unknown };
  return b?.type === "tool_result" && typeof b.tool_use_id === "string" ? b.tool_use_id : null;
};

function canonicalizeToolResultRuns(messages: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < messages.length; ) {
    const id = singleToolResultId(messages[i]);
    if (id === null) {
      out.push(messages[i++]);
      continue;
    }
    let j = i;
    while (j < messages.length && singleToolResultId(messages[j]) !== null) j++;
    const run = messages.slice(i, j);
    if (run.length > 1) run.sort((a, b) => singleToolResultId(a)!.localeCompare(singleToolResultId(b)!));
    out.push(...run);
    i = j;
  }
  return out;
}

/**
 * Concurrency lanes.
 *
 * A backgrounded subagent runs WHILE the parent turn finishes, so three streams
 * of frames progress at once and their interleaving is a race: measured on the
 * identical-code pair, both engines emitted exactly the same 15 frames in the
 * same per-lane order, differing only in where the subagent's frames and the
 * async task notifications landed relative to the parent's result.
 *
 * Order *within* a lane is a contract (task_started → task_updated →
 * task_notification; a turn's own frames). Interleaving *between* lanes is not.
 * So stable-partition into lanes and concatenate in a fixed lane order. Nothing
 * is dropped — a missing or reordered frame inside any lane still diffs.
 *
 * Note `task_started` is emitted synchronously at dispatch and lands identically
 * on both engines; it is laned with the async notifications anyway, which is
 * harmless because both sides lane it the same way.
 */
const ASYNC_TASK_SUBTYPES = new Set(["background_tasks_changed", "task_started", "task_updated", "task_notification", "task_progress"]);

function laneOf(m: unknown): string {
  const f = m as { type?: string; subtype?: string; parent_tool_use_id?: string | null };
  if (typeof f?.parent_tool_use_id === "string" && f.parent_tool_use_id) return `2:subagent:${f.parent_tool_use_id}`;
  if (f?.type === "system" && f.subtype && ASYNC_TASK_SUBTYPES.has(f.subtype)) return "1:async-task";
  return "0:root";
}

function canonicalizeLanes(messages: unknown[]): unknown[] {
  const lanes = new Map<string, unknown[]>();
  for (const m of messages) {
    const k = laneOf(m);
    const bucket = lanes.get(k);
    if (bucket) bucket.push(m);
    else lanes.set(k, [m]);
  }
  if (lanes.size <= 1) return messages;
  return [...lanes.keys()].sort().flatMap((k) => lanes.get(k)!);
}

export function normalizeTranscript(messages: unknown[]): unknown[] {
  const ids = new Map<string, string>();
  collectRunIds(messages, ids);
  const scrub = makeScrubString(ids);
  const filtered = messages.filter((m) => !DROP_MESSAGE_TYPES.has((m as { type?: string })?.type ?? ""));
  return canonicalizeLanes(canonicalizeToolResultRuns(filtered)).map((m) => normalizeWith(m, scrub));
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
