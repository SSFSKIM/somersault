// M0.5 — transcript normalization + structural diff.
//
// The normalization spec IS the definition of "behaviorally equivalent": every
// key listed here is declared incidental (ids, clocks, costs); everything else
// is behavior and must match. Grow this list only with justification — each
// addition widens what the harness cannot see.
import { readFileSync } from "node:fs";
import { canonicalizeToolResultOrder, RUN_VALUE_SCRUBS } from "./canonical.js";

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
  // The OS process id, which the initialize control_response reports back to its
  // host (upstream's payload builder writes `pid: process.pid`). Two engines are
  // two processes, so this can never match and it says nothing about behaviour.
  // It became visible only when the raw driver started sending `initialize` and
  // reading the answer off the wire — the SDK consumes that frame, so no
  // scenario had ever seen the field. Scrubbed rather than mapped: unlike a
  // session id it is not correlated with anything else in the transcript, so
  // there is no consistency claim to preserve.
  "pid",
  // C12a/W9a — `.claude.json`'s volatile block, which the config half of the
  // state surface reads. The per-project record the engine rewrites at the end
  // of every run carries a wall clock, four durations and a cost; `skillUsage`
  // carries the timestamp of the last invocation next to the COUNT.
  //
  // ENUMERATED RATHER THAN PATTERNED, deliberately. The obvious pattern —
  // anything ending `Time`, `At`, `Duration` — would also eat `firstStartTime`,
  // which this wave made a DECLARED INPUT (the empty precondition seeds it) and
  // therefore a graded fact. §3.4's rule is that over-scrubbing is the worse
  // direction, and a new volatile field appearing in a later pin should show up
  // as a red diff someone reads rather than be silently eaten by a pattern.
  //
  // WHAT THEY HIDE: how long the last run took and what it cost. WHAT THEY WOULD
  // MISS: nothing this surface claims — the neighbouring fields in the same
  // block are graded (`lastTotalInputTokens`, `lastLinesAdded`,
  // `lastGracefulShutdown`, `lastVersionBase`, `skillUsage.*.usageCount`), and
  // `lastSessionId` is not scrubbed at all: its value is the session uuid the
  // run-id map already bound from the transcript, so an engine that named a
  // DIFFERENT session there still diffs.
  "lastCost",
  "lastAPIDuration",
  "lastAPIDurationWithoutRetries",
  "lastToolDuration",
  "lastDuration",
  "lastStartTime",
  "lastUsedAt",
]);

// Clock-valued keys follow naming conventions — scrub by pattern, not enumeration.
// (Found by the M0.6 self-test: ttft_ms / ttft_stream_ms / time_to_request_ms.)
const SCRUB_KEY_PATTERNS = [/_ms$/, /Ms$/, /_at$/, /_seconds$/, /_time$/];

const isScrubbedKey = (k: string) => SCRUB_KEYS.has(k) || SCRUB_KEY_PATTERNS.some((p) => p.test(k));

// Whole message types that are pure environment telemetry, not engine behavior.
const DROP_MESSAGE_TYPES = new Set(["rate_limit_event"]);

// Value-level scrubs live in src/canonical.ts, shared with the replay proxy's
// match hash (§3.4). Key-based scrubbing cannot reach a value embedded in a
// string — the engine echoes its base URL into user-facing error text, and
// renders clocks into tool-result prose — so these are matched by shape, each
// one justified where it is declared and regression-tested in canonical.test.ts.
const VALUE_SCRUBS = RUN_VALUE_SCRUBS;

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
 *
 * THE COMPACTION KEYS (C7/W4) ARE HERE FOR ONE REASON: the messages they name
 * are not all in the transcript. A `compact_boundary` reports which messages it
 * preserved by uuid, and some of those are engine-internal frames the SDK never
 * emits — so their ids appear ONLY under these keys and nowhere as a message
 * `uuid`. Without them in this set the map has no entry to make, and two runs of
 * the SAME engine disagree on `preserved_messages.uuids[1]`. Adding them keeps
 * the consistency check rather than weakening it: the map is built over the
 * whole transcript in traversal order, so an engine that preserved a DIFFERENT
 * message names a uuid the map already bound to another placeholder, and the
 * diff still fires. What is discarded is only the value of an id nothing else
 * can pin.
 */
export const RUN_ID_KEYS: ReadonlySet<string> = new Set([
  "session_id",
  "uuid",
  "agentId",
  "task_id",
  "request_id",
  "message_id",
  // compact_boundary's own wire fields (upstream `rSe`).
  "logical_parent_uuid",
  "head_uuid",
  "anchor_uuid",
  "tail_uuid",
  // W5's C8 boundary round. `hook_id` correlates a `hook_started` frame with its
  // `hook_response`; `new_conversation_id` is the fresh conversation `/clear`
  // mints. Both are minted per RUN, so two runs of the same engine differ on
  // them — and because the map is one-to-one, correlating them wrongly (one id
  // for two hooks, or a response answering a different start) still diffs.
  "hook_id",
  "new_conversation_id",
  // C12a/W9a's six, and the reason they are KEYS rather than shapes. The stored
  // transcript's envelope carries five ids and a `slug`, and two of
  // the lexemes are AMBIGUOUS BY VALUE: an agent id and a task id are both
  // `a` + 16 hex, and `promptId`, `leafUuid`, `parentUuid` and `uuid` are all
  // RFC-4122. A shape-keyed rule cannot tell those apart, so it would either map
  // a task id as an agent id (a wrong binding, the unsafe direction §3.4 names)
  // or map every uuid-shaped string anywhere (which erases `tool_use_id`s the
  // cassette replays identically and that therefore MUST match literally). The
  // property name is the disambiguator, and `research/fixtures/run-id-shapes-
  // 2.1.251.json` enumerates the shapes each key is observed to carry so a pin
  // that re-lexes one reddens rather than silently binding the wrong thing.
  //
  // What each buys, stated as the defect it must still catch:
  //  - `parentUuid` / `logicalParentUuid`: a record chained to the WRONG parent
  //    still diffs, because the map is one-to-one and the wrong parent's uuid is
  //    already bound to another placeholder. Blanket-scrubbing them would have
  //    made every chain identical — which is precisely the defect class the
  //    storage subsystem exists to avoid.
  //  - `leafUuid`: the resume pointer. A divergent leaf is the difference
  //    between resuming the conversation and resuming a prefix of it.
  //  - `promptId`: correlates every record of one turn. An engine that minted
  //    two where the oracle minted one still diffs.
  //  - `agentId`: already mapped from the transcript surface; named again here
  //    because the STORED envelope is where the route-by-agent policy writes it.
  //  - `sessionId`: the stored spelling of `session_id`, which is already mapped.
  //  - `slug`: TWO different values under one property name, both run-scoped and
  //    both mapped. (i) In the STORED ENVELOPE it is a per-run session name the
  //    engine mints and starts writing at the compact boundary — records before
  //    the boundary carry no `slug` at all, and every record after one carries
  //    e.g. `curious-yawning-pebble`. That is what the map is for here, and
  //    getting it wrong is what reddened seven corpus scenarios: this rule
  //    briefly carried a value guard that admitted only project keys, and the
  //    session name went unmapped. (ii) In the STATE SURFACE it is the project
  //    key — the harness's own absolute cwd with its separators flattened —
  //    which `src/state.ts` lifts out of the entry path deliberately so this map
  //    can reach the path string too; it is not minted by the engine at all and
  //    is mapped because it is a fact about THIS MACHINE that would otherwise put
  //    an operator's home directory into every state-surface finding.
  //    A THIRD meaning exists upstream and the corpus never reaches it; see
  //    `RUN_ID_VALUE_GUARDS` below for what mapping all three costs.
  "parentUuid",
  "logicalParentUuid",
  "leafUuid",
  "promptId",
  "sessionId",
  "slug",
]);

/**
 * The same keys, whose values are ARRAYS of uuids rather than one uuid. Kept
 * separate so the walk cannot mistake an arbitrary string array for identifiers.
 */
export const RUN_ID_ARRAY_KEYS: ReadonlySet<string> = new Set(["uuids", "all_uuids"]);

const isRunId = (v: unknown): v is string => typeof v === "string" && v.length >= 6;

/**
 * Per-key VALUE guards. EMPTY, and it took two corrections to get here.
 *
 * `slug` is not one field. The census found 124 values under it in no known
 * lexeme class beside 2,531 project keys, and the first reading of that — the
 * artifact records (`artifactRead:{slug,ver}`, the `artifact-changed` queue
 * events) name an ARTIFACT, and a name is behaviour — produced a guard that
 * mapped only values beginning with the flattened path separator. The reading
 * was wrong about which field the 124 were. Measured on a compacted transcript:
 * every record AFTER a compact_boundary carries `slug: "encapsulated-noodling-neumann"`,
 * a three-word name the engine mints PER RUN, and the guard left it unmapped —
 * which reddened all seven compaction-bearing corpus scenarios on the state
 * surface and, through them, two dark liveness rows whose covering scenarios
 * they are.
 *
 * WHAT MAPPING THE WHOLE VALUE COSTS, since a partial scrub is not available:
 * the slug's leading component is a PROMPT-DERIVED TITLE when the session has
 * one (`use-the-read-tool-humming-bentley`) and one more random word when it
 * does not (`curious-yawning-pebble`), so the plan-file rule in
 * `src/canonical.ts` — keep the prefix, scrub the two random words — is not
 * stable here: it would leave a random adjective in place on every untitled
 * session. Mapping the whole value therefore hides which prompt a session was
 * named after. That claim is not lost, it moves: the title path is C12c's
 * (`saveCustomTitle` / `saveAiGeneratedTitle`) and belongs in that wave's
 * contract test, where it can be graded directly instead of inferred from a
 * scrubbed name.
 *
 * The other residual risk is recorded rather than guarded: an artifact slug IS a name, and mapping it would let two engines
 * naming different artifacts grade identical. It is bounded today by
 * reachability — no recorded body or transcript in the corpus contains an
 * artifact record, which is what the census's 124 turned out NOT to be — and the
 * one-to-one map keeps the weaker claim alive regardless (an engine that used
 * two slugs where the oracle used one still diffs). Whichever wave makes the
 * artifact family reachable re-adjudicates this rule.
 */
const RUN_ID_VALUE_GUARDS: Record<string, RegExp> = {};

/**
 * Run-scoped ids that appear ONLY inside free text — never as the value of any
 * property — with the shape that finds them and the reason each is here.
 *
 * WHY THIS EXISTS AT ALL, and why it is a MAP rather than a scrub. The
 * property-keyed rules above cannot reach an id the engine only ever writes
 * into a sentence. C12a met the same problem from the other side and solved it
 * by LIFTING: `src/state.ts` pulls the project key out of an entry path into a
 * property so the map can bind it. That is not available here, because the
 * string is the ENGINE's own output rather than a snapshot the harness builds.
 *
 * A value scrub would have been easier and is the wrong tool: it erases, and
 * erasure loses the consistency claim. A map keeps it — the same id mentioned
 * three times in one run binds to one placeholder, so an engine that used TWO
 * ids where the oracle used one still diffs, and an id that appears in a
 * DIFFERENT sentence than the oracle put it in still diffs too.
 *
 * Each pattern must capture the id in group 1, and must be anchored on enough
 * surrounding text that it cannot match something that is not an id.
 */
const RUN_ID_TEXT_PATTERNS: readonly [re: RegExp, why: string][] = [
  [
    /\/tool-results\/(b[0-9a-z]{8})\.(?:txt|json)/g,
    // C13c/W10c, from `bash-large-output`. A tool result past the persistence
    // threshold is written to `…/<session-uuid>/tool-results/<id>.txt` and
    // REPLACED by a `<persisted-output>` envelope quoting that path — so the
    // path is in the tool result, in the request body that echoes it, and in
    // `tool_use_result.persistedOutputPath`, and the id in it appears as a bare
    // property value exactly ZERO times (measured). Everything else in the path
    // stays graded: the session uuid is mapped by `session_id`, the project key
    // by `slug`, and an engine that persisted to a different DIRECTORY still
    // diffs. Only the per-result file name goes.
    "the persisted tool-result file's own id (C13c: `<persisted-output>` paths)",
  ],
];

/** What the text patterns admit, as data — for the fixture and for a reader. */
export const runIdTextPatterns = (): { source: string; why: string }[] =>
  RUN_ID_TEXT_PATTERNS.map(([re, why]) => ({ source: re.source, why }));

function collectRunIds(v: unknown, into: Map<string, string>, keys: ReadonlySet<string> = RUN_ID_KEYS): void {
  if (Array.isArray(v)) {
    for (const x of v) collectRunIds(x, into, keys);
    return;
  }
  if (typeof v === "string") {
    // Ids that live only in prose (see `RUN_ID_TEXT_PATTERNS`). Collected here
    // rather than at the property level because there is no property to key on.
    for (const [re] of RUN_ID_TEXT_PATTERNS) {
      for (const m of v.matchAll(re)) if (isRunId(m[1]) && !into.has(m[1])) into.set(m[1], `<id${into.size}>`);
    }
    return;
  }
  if (v === null || typeof v !== "object") return;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (keys.has(k) && isRunId(val) && (RUN_ID_VALUE_GUARDS[k]?.test(val) ?? true) && !into.has(val)) {
      into.set(val, `<id${into.size}>`);
    } else if (RUN_ID_ARRAY_KEYS.has(k) && Array.isArray(val)) {
      for (const id of val) if (isRunId(id) && !into.has(id)) into.set(id, `<id${into.size}>`);
    }
    collectRunIds(val, into, keys);
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

// The tool_result ordering canonicalization is shared with the replay hash —
// the racy completion order lands in request BODIES too, so a hash that did not
// apply it missed `parallel-tools` by construction.
const canonicalizeArray = canonicalizeToolResultOrder;

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
  return makeRunNormalizerOver(RUN_ID_KEYS, sources);
}

/**
 * The same normalizer over a CHOSEN key set — the mutation seam §3.4 asks for.
 *
 * A rule in `RUN_ID_KEYS` is only evidence if removing it changes an answer, and
 * that cannot be shown from outside a module whose key set is a constant. So the
 * set is a parameter here and `src/differ.test.ts` runs each rule's own controls
 * with that rule deleted: a rule whose deletion changes nothing is a rule that
 * was never load-bearing, and the test says so by name.
 */
export function makeRunNormalizerOver(keys: ReadonlySet<string>, sources: readonly unknown[]): (v: unknown) => unknown {
  const ids = new Map<string, string>();
  for (const s of sources) collectRunIds(s, ids, keys);
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
