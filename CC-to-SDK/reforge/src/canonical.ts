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
 * Tier 2 — run-scoped IDENTIFIERS, scrubbed in the ENCLOSING SHAPE the engine
 * mints them into.
 *
 * The differ handles these by MAPPING (see `RUN_ID_KEYS` in `differ.ts`), which
 * is strictly stronger and is why they are not in tier 1: mapping keeps the
 * consistency check alive, pattern-scrubbing does not. The replay hash has no
 * second side to build a map from, so it uses these instead.
 *
 * These used to be SHAPE-ONLY — `\ba[0-9a-f]{16}\b` and a bare RFC-4122 — applied
 * to every string anywhere in the body. Shape-exactness bounded what they could
 * eat but not WHERE, so two genuinely different requests that merely CONTAINED
 * id-shaped tokens canonicalized identically and could share a replay key: the
 * proxy would serve the first match, report zero fallbacks, and feed both engines
 * the same wrong response. (W0 boundary review, lens 3.)
 *
 * So each pattern now carries the prose the ENGINE writes around the id. The
 * enclosing shapes are not guessed — they are the complete inventory of every
 * occurrence in the recorded corpus and in every replay-time observed body:
 *
 *   - `agentId: a8b1…`                     — the subagent-result header
 *   - `to: 'a8b1…'`                        — the SendMessage address in that header
 *   - `/tasks/a8b1….output`                — the task output path
 *   - `<task-id>a8b1…</task-id>`           — the background task-notification
 *   - `…/<uuid>/tasks/`                    — the session directory in those paths
 *   - `read the full transcript at: …/<uuid>.jsonl`
 *                                          — the post-compaction continuation
 *
 * The last one is the SIXTH shape this comment predicted, found by C7/W4 exactly
 * as described: the continuation message the engine puts in front of a carried
 * summary names the session's own transcript file, and it rides in the FIRST USER
 * MESSAGE of every request after a compact_boundary — as that message's SECOND
 * text block, behind the system-reminder block the engine leads with. No recording had
 * carried it before, because `slash-compact` stops at the boundary and never
 * sends another request; the two scenarios that continue past one missed their
 * body hash on every post-compaction request. The scrub keeps the directory —
 * which is harness state and discriminates a project — and replaces only the
 * per-run session uuid in the file name.
 *
 * A future scenario that mints an id into a SEVENTH shape will miss its body hash
 * and fail loudly as a positional fallback — the safe direction. The unsafe
 * direction, a wrong match, is what the tightening removes; `assertNoKeyCollisions`
 * in `proxy.ts` is the structural backstop that makes any residual over-reach
 * unexploitable rather than silent.
 *
 * `src/canonical.test.ts` is the negative control: it feeds strings that merely
 * LOOK adjacent (a 40-hex sha, a tool_use id, a bare id outside any engine prose)
 * and proves they survive and still discriminate.
 */
export const RUN_ID_SHAPE_SCRUBS: [RegExp, string][] = [
  [/\bagentId: a[0-9a-f]{16}\b/g, "agentId: <agent-id>"],
  [/\bto: 'a[0-9a-f]{16}'/g, "to: '<agent-id>'"],
  [/\/tasks\/a[0-9a-f]{16}\.output\b/g, "/tasks/<agent-id>.output"],
  [/<task-id>a[0-9a-f]{16}<\/task-id>/g, "<task-id><agent-id></task-id>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/tasks\/)/g, "<uuid>$1"],
  [
    /(read the full transcript at: \S*\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jsonl)/g,
    "$1<session-uuid>$2",
  ],
  // C13c/W10c — the LOCAL SHELL's own run-scoped ids, which are `b` + 8 base36
  // rather than the Agent tool's `a` + 16 hex. C12a's census recorded that
  // second shape and nothing rendered it; the executor recordings do, in four
  // sentences the engine writes straight into a tool result and therefore into
  // the NEXT request body.
  //
  // WHY THIS IS LOAD-BEARING RATHER THAN TIDY. Without these, the replay hash
  // misses on every turn after a backgrounded command and the proxy falls back
  // to positional serving — and `bash-background-control` exhausted a 5-entry
  // cassette with 16 requests, which is not a degraded measurement but no
  // measurement at all. This is the tech-debt item of 2026-08-31 ("the proxy
  // scrubs less than its differ") meeting a scenario that cannot be recorded
  // around it.
  //
  // Each is anchored on the sentence the engine writes, never on the bare shape:
  // a naked `b[0-9a-z]{8}` would also match ordinary prose. The proxy's own
  // collision guard is the backstop — if any of these erased a distinction a
  // cassette depends on, the replay REFUSES TO START rather than misroutes.
  [/(Command running in background with ID: )b[0-9a-z]{8}\b/g, "$1<shell-task-id>"],
  [/(Command was manually backgrounded by user with ID: )b[0-9a-z]{8}\b/g, "$1<shell-task-id>"],
  // BOTH SPELLINGS, and the difference is not cosmetic: the tool's own
  // retrieval envelope writes `<task_id>` with an UNDERSCORE, while the
  // task-notification attachment writes `<task-id>` with a HYPHEN. The first
  // pass covered only the underscore, and the hyphenated one kept the hash
  // missing on every turn after a notification — found by canonicalizing the
  // observed bodies against the cassette and reading the first differing byte,
  // which is a cheaper way to answer this than another live take.
  [/<task_id>b[0-9a-z]{8}<\/task_id>/g, "<task_id><shell-task-id></task_id>"],
  [/<task-id>b[0-9a-z]{8}<\/task-id>/g, "<task-id><shell-task-id></task-id>"],
  [/\/tasks\/b[0-9a-z]{8}\.output\b/g, "/tasks/<shell-task-id>.output"],
  // …and the AUTO-backgrounding sentence, which is a different one from the
  // manual one above: `WMt`'s timeout arm writes "was moved to the background
  // (ID: <id>)" where the control-request arm writes "was manually backgrounded
  // by user with ID: <id>". Two arms, two sentences, and a rule that covered one
  // left `bash-timeout-background` missing the hash on every turn after the
  // deadline.
  [/(was moved to the background \(ID: )b[0-9a-z]{8}(\))/g, "$1<shell-task-id>$2"],
  // …and the persisted tool-result file, whose id `src/differ.ts` maps out of the
  // same path on the differential side (`RUN_ID_TEXT_PATTERNS`).
  [/\/tool-results\/b[0-9a-z]{8}\.(txt|json)\b/g, "/tool-results/<tool-result-id>.$1"],
  // …whose DIRECTORY carries the session uuid, exactly as the `/tasks/` rule
  // above already handles for the agent path. The differ maps this uuid through
  // `session_id`; the hash has no map and must scrub it.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/tool-results\/)/g, "<uuid>$1"],
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
 *
 * ANCHORED to the whole `gitStatus:` envelope, not to the bare `\nStatus:\n …
 * \n\nRecent commits:\n` interior it was written for. Unanchored, any string
 * carrying those two headings — a user prompt, a file the engine read back, a
 * tool result quoting a status report — had everything from `Status:` to the end
 * of the string erased, so two different requests could share a replay key. The
 * envelope sentence is engine-authored boilerplate and is present in every
 * occurrence in the corpus (always in `system[].text`); the branch line, the
 * "Main branch" line and the git user between the sentence and `Status:` are
 * preserved by the capture group, so they still discriminate.
 */
export const HOST_STATE_SCRUBS: [RegExp, string][] = [
  [
    /(gitStatus: This is the git status at the start of the conversation\.[\s\S]*?\nStatus:\n)[\s\S]*?(\n\nRecent commits:\n)[\s\S]*$/g,
    "$1<git-status>$2<git-log>",
  ],
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

/**
 * The engine's own MIDNIGHT-ROLLOVER notice, removed as a WHOLE MESSAGE rather
 * than scrubbed as a sentence.
 *
 * WHAT THE ENGINE ACTUALLY EMITS, read off the pinned bundle rather than
 * inferred from the sentence. Two producers build the notice, and BOTH hand it
 * to the same renderer: the `date` attachment (`_0e` @33257, reached from the
 * attachment builder @2584129) and the `date_change` attachment @3936332. Each
 * calls `hs([xe({content: <sentence>, isMeta: true})])`, and `hs` @3915515 wraps
 * every string content in `hl` @3913327 — `<system-reminder>\n${e}\n</system-reminder>`.
 * So the notice never reaches a request body as a bare sentence inside some
 * other prose: it arrives as its OWN conversation message whose entire content
 * is the wrapped notice, either as a content string or as a lone `text` block.
 *
 * WHY THAT DISTINCTION IS THE WHOLE FIX. The first attempt removed the bare
 * SENTENCE with a string replace, which leaves the message itself — an extra
 * element in `messages[]` carrying `<system-reminder>\n\n</system-reminder>`.
 * One side then has a message the other does not, the arrays are different
 * lengths, and the bodies still canonicalize differently: the defect the rule
 * was written for survived the rule. It was validated only by two same-side runs
 * (a gate that happened not to straddle midnight), which is why it read as
 * fixed. Removing the MESSAGE is what makes the two bodies equal.
 *
 * WHY REMOVAL AND NOT A DATE SCRUB. The date scrub below equalizes two bodies
 * that both carry the notice. The failure this rule exists for is the other one:
 * the corpus runs engine A and engine B SEQUENTIALLY, so a run that starts at
 * 23:59 has A cross midnight mid-session and emit the notice while B, started
 * after the rollover, sees no change and emits nothing. The message is then
 * PRESENT IN ONE BODY AND ABSENT FROM THE OTHER, which no substitution can
 * equalize. Measured: W7.6a's first full gate run failed exactly one row of 110
 * — the corpus, inside the equivalence phase — and the same phase on the same
 * faithful build was green twice afterwards, both times wholly on one side of
 * midnight.
 *
 * FIELD-SCOPED, per §3.4, and the scope is `messages[]`. The removal only ever
 * fires on an element of the conversation array whose content is EXACTLY the
 * wrapped envelope — nothing before it, nothing after it, the whole string. A
 * user prompt that quotes the sentence, mentions a date change, or embeds the
 * notice inside other prose is a different string and survives untouched; the
 * regression tests below hold that neighbour.
 *
 * WHAT IS GIVEN UP, stated rather than glossed. After this the harness cannot
 * see "one engine noticed midnight and the other did not". That is not a
 * property of the graph under test — it is the wall clock landing between two
 * process spawns — and it belongs with the run-scoped ids the differ already
 * maps out. The whole message is dropped, so NOTHING in it is compared: an
 * engine that emits the notice at the wrong turn, never, twice, or with the
 * wrong date is invisible to this surface (measured by the C10.6-fix
 * verification round). That is the rule's cost, accepted because no scenario
 * can create the rollover; whichever wave owns the `date_change` renderer owes
 * a contract test for it.
 *
 * The em dash is `—` in the bundle's source and a real character in the
 * emitted string; the pattern spans it with a bounded run of non-newline
 * characters so it matches either.
 */
const DATE_ROLLOVER_MESSAGE =
  /^<system-reminder>\nThe date has changed\. Today's date is now \d{4}-\d{2}-\d{2}\. No need to announce the new date[^\n]*?clock shows it\.\n<\/system-reminder>$/;

const isRolloverText = (v: unknown): boolean => typeof v === "string" && DATE_ROLLOVER_MESSAGE.test(v);

/**
 * Drop the rollover MESSAGE from a Messages request body.
 *
 * Three emitted shapes, all covered: the notice as a message's whole content
 * string, as a message's lone `text` block, and as one `text` block among
 * others (which the renderer does not currently produce, but which costs
 * nothing to cover and is the shape a future attachment merge would take —
 * there the BLOCK goes and the message stays).
 */
function dropDateRolloverMessage(o: unknown): unknown {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return o;
  const body = o as Record<string, unknown>;
  if (!Array.isArray(body.messages)) return o;
  const kept: unknown[] = [];
  let moved = false;
  for (const m of body.messages) {
    if (m === null || typeof m !== "object" || Array.isArray(m)) {
      kept.push(m);
      continue;
    }
    const msg = m as Record<string, unknown>;
    if (isRolloverText(msg.content)) {
      moved = true;
      continue;
    }
    if (!Array.isArray(msg.content)) {
      kept.push(m);
      continue;
    }
    const blocks = msg.content.filter(
      (b) => !(b !== null && typeof b === "object" && (b as { type?: unknown }).type === "text" && isRolloverText((b as { text?: unknown }).text)),
    );
    if (blocks.length === msg.content.length) {
      kept.push(m);
      continue;
    }
    // A message left with NO blocks is dropped outright; one left with some is
    // kept minus the notice. Tracking `moved` rather than comparing lengths is
    // the difference between the two: a block-only edit changes no length, and
    // the first version of this function returned the body unchanged for it.
    moved = true;
    if (blocks.length > 0) kept.push({ ...msg, content: blocks });
  }
  return moved ? { ...body, messages: kept } : o;
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
    // The rollover MESSAGE goes before anything walks the strings, for the
    // reason above `DATE_ROLLOVER_MESSAGE`: a substitution cannot equalize a
    // message one side does not have, and erasing only its sentence leaves the
    // message behind.
    return JSON.stringify(mapStrings(scrubEngineAuthoredFields(dropDateRolloverMessage(o)), (s) => applyAll(RUN_VALUE_SCRUBS, s)));
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
