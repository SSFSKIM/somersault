// X1/§3.4 — the normalization spec, in ONE module, shared by the two layers
// that need it.
//
// Two consumers, and they are comparing different things:
//
//   * `src/differ.ts` compares TWO CONTEMPORANEOUS RUNS (engine A vs engine B).
//     It can afford a stateful canonical form: it collects the run-scoped
//     identifiers each side minted and MAPS them to <id0>, <id1>… in first-seen
//     order, so an engine that used two ids where the oracle used one still
//     diffs.
//   * `src/proxy.ts` compares A RUN AGAINST A RECORDING made at some earlier
//     time. A hash has no second side to build a map from, so it needs a
//     STATELESS canonical form: the same values, pattern-scrubbed in place.
//
// Before this module the two layers had drifted: the proxy scrubbed a date and
// `metadata`, the differ scrubbed a dozen more things, and every request whose
// prose carried a run-scoped `agentId` or an inline `duration_ms` missed the
// body hash and was served POSITIONALLY — a silent weakening of the exactness
// guarantee the match exists to provide (2026-08-31 tech-debt entry, superseded
// by §3.4).
//
// THE RULE FOR GROWING THIS FILE (§3.4): every scrub carries written
// justification and a regression test proving it cannot eat a value-shaped
// CONTRACT. Over-scrubbing is worse than under-scrubbing here — a missed match
// degrades to positional order and is now fatal, but a WRONG match silently
// serves the right-looking response to a drifted request.

/**
 * Tier 1 — values that differ between ANY two runs, including two runs of the
 * same engine. Shared by the differ and the replay hash.
 *
 * Each entry existed already in `differ.ts` and was found by a measured diff;
 * the comments record which one.
 */
export const RUN_VALUE_SCRUBS: [RegExp, string][] = [
  // The replay proxy binds an EPHEMERAL port per run and the engine echoes its
  // base URL into user-facing error text ("check your inference gateway
  // (127.0.0.1:64277)"). Found by the H2 fault suite.
  [/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>"],
  // Clocks rendered INTO prose, where key-based scrubbing cannot reach them.
  // Two renderings, both measured: the subagent tool result writes
  // "<usage>…duration_ms: 26</usage>", and the background task-notification
  // writes "<duration_ms>1739</duration_ms>".
  [/\b(\w*_ms): \d+/g, "$1: <ms>"],
  [/<(\w*_ms)>\d+<\/\1>/g, "<$1><ms></$1>"],
  // The billing header's cc_version carries a per-PROCESS suffix
  // ("2.1.251.b71" vs "2.1.251.12d"); the version is behavior, the suffix is not.
  [/(cc_version=\d+\.\d+\.\d+)\.[0-9a-z]+/g, "$1.<proc>"],
  // The engine opens a per-PROCESS unix socket and reports the path on
  // system:init ("/tmp/cc-socks/68386.sock"). A fresh pid every run.
  [/(\/cc-socks\/)\d+\.sock/g, "$1<pid>.sock"],
  // Plan-mode file names end in two RANDOM words. The prompt-derived prefix is
  // behavior — the engine names the file after the request — so keep it.
  [/(\/plans\/[a-z0-9-]+?)-[a-z]+-[a-z]+\.md/g, "$1-<rand>.md"],
];

/**
 * Tier 2 — run-scoped IDENTIFIERS, scrubbed by shape.
 *
 * The differ handles these by MAPPING (see `RUN_ID_KEYS` in `differ.ts`), which
 * is strictly stronger and is why they are not in tier 1: mapping keeps the
 * consistency check alive, pattern-scrubbing does not. The replay hash has no
 * second side to build a map from, so it uses these instead.
 *
 * Both patterns are deliberately SHAPE-EXACT rather than loose:
 *
 *   - agent ids are `a` followed by exactly 16 lowercase hex digits, and the
 *     `\b` anchors mean a longer hex run (a sha1/sha256, a content hash) cannot
 *     match. Measured forms in request prose: "agentId: a8b1bb212b0c2aeb2",
 *     "SendMessage with to: 'a8b1…'", "<task-id>a8b1…</task-id>", and the task
 *     output path "…/tasks/a8b1….output".
 *   - session/task directory names are RFC-4122 shaped, again `\b`-anchored.
 *
 * `src/canonical.test.ts` is the negative control for both: it feeds strings
 * that merely LOOK adjacent (a 40-hex sha, a tool_use id, a model name, a
 * configured timeout) and proves they survive.
 */
export const RUN_ID_SHAPE_SCRUBS: [RegExp, string][] = [
  [/\ba[0-9a-f]{16}\b/g, "<agent-id>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<uuid>"],
];

/**
 * Tier 3 — HOST state, scrubbed for the replay hash ONLY.
 *
 * The `<env>`-adjacent `gitStatus` block a dispatched Agent receives embeds the
 * cwd's `git status --short` and `git log --oneline -n 5`. The differential
 * sandbox lives inside this repository, so that block changes with every edit
 * and every commit — which rotted the `subagent` and `background-task`
 * cassettes continuously, for reasons that have nothing to do with any engine.
 *
 * This is the one place where the hash legitimately scrubs MORE than the differ,
 * and the asymmetry is the point: the hash compares a live run against a
 * recording from the past, so host state is noise to it; the differ compares two
 * runs happening now, where both sides see the same host state and the text
 * therefore stays fully graded. Nothing is blinded — an engine that stopped
 * emitting the git block, or emitted it wrongly, still fails the request-surface
 * diff.
 *
 * Rejected alternative: making the sandbox git-invisible (a `GIT_CEILING_DIRECTORIES`
 * pin, or its own fixed repository). The ceiling only half-worked — `git status`
 * and `git log` went quiet but the is-a-repo flag, branch name and global
 * `user.name` survived — and a sandbox-owned repository would drop a `.git`
 * directory and a seed commit into a directory that `search-tools` greps and
 * `file-tools` writes into, perturbing scenarios that have nothing to do with git.
 */
export const HOST_STATE_SCRUBS: [RegExp, string][] = [
  [/\nStatus:\n[\s\S]*?\n\nRecent commits:\n[\s\S]*$/g, "\nStatus:\n<git-status>\n\nRecent commits:\n<git-log>"],
];

/**
 * Tier 0 — the WALL CLOCK the engine stamps into its own prompt text, scrubbed
 * ONLY inside the fields the ENGINE authors (`system`, `tools[].description`).
 *
 * Measured: the WebSearch tool description carries "The current month is August
 * 2026. You MUST use this year when searching…", so the corpus recorded in
 * August stopped hash-matching on 1 September and EVERY scenario degraded to the
 * positional fallback — which §3.4 had just made fatal, so the equivalence phase
 * of the gate went red on all five surfaces while every graded surface was still
 * identical. Exactly the `Today's date` rot one tier down, one calendar unit
 * slower.
 *
 * Two phrasings exist in the pinned bundle — "The current month is ${m} — use
 * this when searching for recent information." and "The current month is ${m}.
 * You MUST use this year…" — so the pattern anchors on the sentence PREFIX they
 * share and leaves each continuation intact.
 *
 * FIELD-SCOPED on purpose. Every other prose scrub runs body-wide (`mapStrings`
 * walks every string anywhere), which is the over-reach the collision backstop
 * in `proxy.ts` exists to make unexploitable. Here the scoping is free: the
 * string only ever occurs in engine-authored fields, so restricting it to those
 * costs nothing and means a USER prompt that happens to discuss a month stays
 * fully discriminating.
 */
export const ENGINE_PROMPT_SCRUBS: [RegExp, string][] = [[/The current month is [A-Z][a-z]+ \d{4}/g, "The current month is <month>"]];

const applyAll = (rules: [RegExp, string][], s: string) => rules.reduce((acc, [re, to]) => acc.replace(re, to), s);

/**
 * Canonicalize an ordering that is NOT a contract.
 *
 * Parallel tool calls come back in COMPLETION order, which races: the oracle
 * disagrees with itself run to run, so sampling can never certify a third valid
 * ordering. Remove the nondeterminism at its source instead — within one
 * message, sort `tool_result` blocks by `tool_use_id`.
 *
 * Safe precisely because the ids come from the cassette's assistant message, so
 * they are identical across engines, and because only arrival order is
 * discarded, never a result or its content. Shared with the replay hash because
 * the racy order lands in REQUEST BODIES too — `parallel-tools` missed its body
 * hash for exactly this reason.
 */
export function canonicalizeToolResultOrder(items: unknown[]): unknown[] {
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
  // The prompt-cache breakpoint attaches POSITIONALLY (to the last block), so
  // WHICH tool_result carries it is decided by the arrival order just sorted
  // away. Whether the engine sets a breakpoint at all is real behavior (it
  // drives cost), so keep the COUNT as an explicit element.
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

function mapStrings(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return canonicalizeToolResultOrder(v).map((x) => mapStrings(x, f));
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = mapStrings(val, f);
    return out;
  }
  return v;
}

/**
 * The DIFFER's request-surface scrub: run-scoped values that the id map does not
 * cover, plus the two structural scrubs the recording already had.
 *
 * Deliberately does NOT apply `RUN_ID_SHAPE_SCRUBS` — the differ maps those ids
 * instead, which is strictly stronger, and blanking them here first would
 * destroy the map's consistency check.
 */
/**
 * Apply `ENGINE_PROMPT_SCRUBS` to the two fields the engine authors and the
 * caller never does: the `system` prompt (a string or an array of text blocks)
 * and each tool's `description`. Returns the body unchanged when it is not
 * shaped like a Messages request.
 */
function scrubEngineAuthoredFields(o: unknown): unknown {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return o;
  const body = o as Record<string, unknown>;
  const scrub = (v: unknown) => mapStrings(v, (s) => applyAll(ENGINE_PROMPT_SCRUBS, s));
  const out: Record<string, unknown> = { ...body };
  if ("system" in out) out.system = scrub(out.system);
  if (Array.isArray(out.tools)) {
    out.tools = out.tools.map((t) =>
      t !== null && typeof t === "object" && typeof (t as { description?: unknown }).description === "string"
        ? { ...(t as Record<string, unknown>), description: scrub((t as { description: string }).description) }
        : t,
    );
  }
  return out;
}

export function scrubRequestBody(body: string): string {
  // The engine stamps the current date into its system prompt, so an unscrubbed
  // cassette ROTS AT MIDNIGHT: the live body stops hash-matching the recording.
  // Measured — a cassette recorded 2026-08-24 stopped matching on 2026-08-25 and
  // every replay silently degraded to positional matching.
  const dated = body.replace(/Today's date is \d{4}-\d{2}-\d{2}/g, "Today's date is <date>");
  try {
    const o = JSON.parse(dated);
    if ((o as { metadata?: unknown })?.metadata) (o as { metadata?: unknown }).metadata = "<scrubbed>";
    return JSON.stringify(mapStrings(scrubEngineAuthoredFields(o), (s) => applyAll(RUN_VALUE_SCRUBS, s)));
  } catch {
    // A body that is not JSON has no fields to scope to (bodyless probes, and
    // any future non-Messages payload). Fall back to body-wide: under-matching
    // here is a fatal fallback, which is loud.
    return applyAll(RUN_VALUE_SCRUBS, applyAll(ENGINE_PROMPT_SCRUBS, dated));
  }
}

/**
 * The REPLAY HASH's canonical form: everything `scrubRequestBody` does, plus the
 * two tiers a stateless single-sided comparison additionally needs.
 */
export function canonicalizeForHash(body: string): string {
  const base = scrubRequestBody(body);
  try {
    return JSON.stringify(mapStrings(JSON.parse(base), (s) => applyAll(HOST_STATE_SCRUBS, applyAll(RUN_ID_SHAPE_SCRUBS, s))));
  } catch {
    return applyAll(HOST_STATE_SCRUBS, applyAll(RUN_ID_SHAPE_SCRUBS, base));
  }
}
