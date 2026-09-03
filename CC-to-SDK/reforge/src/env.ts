// X6 — the allowlisted child environment and its two credential schemas.
//
// Campaign spec §3.3 (`docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`).
//
// WHY THIS EXISTS. Every engine subprocess used to inherit the operator's whole
// environment. That is a determinism hole with a measured mechanism, not a
// tidiness complaint: `reforge/research/2026-08-31-gate-blob-resolution.md`
// found that at least one PER-GATE env override survives in the public build
// (`CLAUDE_CODE_LUMINOUS_WHISTLE`, research line 80), and the bundle carries
// ~200 other `CLAUDE_CODE_*` knobs. An operator whose shell happens to export
// one of them would change what the ORACLE does — and the harness would call
// the resulting difference an engine defect.
//
// So the child env is CONSTRUCTED, never inherited:
//   - a minimal platform set, copied from the parent only if the parent has it;
//   - the vars the harness deliberately sets (config dir, proxy base URL,
//     telemetry kill-switches, the GrowthBook kill-switch, the pinned runtime);
//   - exactly one credential, chosen by SCHEMA rather than by inheritance.
//
// Everything else — every other CLAUDE_CODE_*, every ANTHROPIC_*, every stray
// operator var — is dropped. `assertSchema` re-checks that as a postcondition,
// so a future caller that hand-builds an env cannot quietly widen it.
//
// NEVER print a credential VALUE. `describeCredential` reports the variable
// NAME, which is the only part that is a fact about the run.

/** RECORD talks to the real API and needs real auth. REPLAY never authenticates. */
export type EnvMode = "record" | "replay";

/**
 * Replay's fixed, non-secret credential. Replays are served entirely by the
 * local proxy, so the engine's auth path only has to be *satisfied*, never
 * valid — proven by the gate-resolution research, which drove a full offline
 * scenario green on a deliberately bogus token. A constant here is strictly
 * better than passing the operator's real token into 22 scenarios × 2 engines
 * of offline replay: it cannot leak, and it cannot make a replay depend on
 * whether the operator happens to be logged in.
 */
export const REPLAY_PLACEHOLDER_TOKEN = "sk-ant-oat01-reforge-replay-placeholder-not-a-secret";

/**
 * The placeholder the engine gets IN EITHER MODE, per credential variable.
 *
 * RECORD mode used to hand the engine the operator's REAL credential, because
 * record mode talks to the real API. It does not have to: the engine talks to
 * the RECORD PROXY, and the proxy is ours. So the engine now holds a placeholder
 * in record mode too and `startRecordProxy` swaps the real value into the
 * outbound auth header (`src/proxy.ts`).
 *
 * WHY, measured (W0 boundary review, lens 3): the pinned engine's subprocess
 * environment sanitizer strips `CLAUDE_CODE_OAUTH_TOKEN` from the environments
 * it gives to Bash commands, but PRESERVES `ANTHROPIC_API_KEY` unless
 * `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is set. A recorded scenario whose Bash
 * command printed its environment would therefore put the operator's live API
 * key into a tool result — and tool results flow into the next request body, so
 * into the cassette, the observed log, and the transcript, all of which are
 * committed.
 *
 * The placeholder keeps the ENGINE'S REQUEST SHAPE intact: it is written to the
 * SAME variable the parent's real credential lives in, so the engine still
 * chooses the OAuth path for an OAuth operator and the API-key path for an
 * API-key one, and the proxy only has to substitute a value.
 */
export const PLACEHOLDER_CREDENTIALS: Record<CredentialVar, string> = {
  CLAUDE_CODE_OAUTH_TOKEN: REPLAY_PLACEHOLDER_TOKEN,
  ANTHROPIC_API_KEY: "sk-ant-api03-reforge-placeholder-not-a-secret",
};

/**
 * The credential variables the engine understands, in SELECTION order.
 *
 * Project policy prefers the OAuth token (it bills the Pro/Max subscription).
 * Upstream's own precedence is the opposite — `ANTHROPIC_API_KEY` SHADOWS the
 * OAuth token when both are set — which is why reforge's documented run recipe
 * had to say `unset ANTHROPIC_API_KEY` by hand. Selection replaces that: the
 * schema picks one and the other never reaches the child, so the recipe cannot
 * be got wrong and the precedence is ours rather than accidental.
 */
export const CREDENTIAL_VARS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
export type CredentialVar = (typeof CREDENTIAL_VARS)[number];

/**
 * Platform variables copied from the parent when present.
 *
 * Judged against what the engine actually does rather than trimmed to taste: it
 * shells out for Bash/git (PATH, SHELL), resolves `~` and its own caches (HOME),
 * writes task output files and unix sockets (TMPDIR), and renders and decodes
 * text (TERM, LANG/LC_ALL). USER/LOGNAME are what `whoami`-shaped code reads. Too
 * narrow a set does not fail silently — it fails as a boot check or a tool
 * error, which is why this list is allowed to be generous where the variable
 * carries no behavior switch.
 */
export const PLATFORM_PASSTHROUGH = ["PATH", "HOME", "TMPDIR", "SHELL", "TERM", "LANG", "LC_ALL", "USER", "LOGNAME"] as const;

/**
 * Must never reach the child.
 *
 * `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` is the one opt-IN that would let
 * the GrowthBook disk cache be read while telemetry is off (research §4) — i.e.
 * the single documented way a cached gate blob could override a compiled-in
 * default under our own kill-switches.
 *
 * `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is here for a different and sharper reason.
 * It is the knob that would harden the engine's subprocess environments, and the
 * W0 boundary review proposed setting it as defense in depth against the API-key
 * leak. READING THE PINNED BUNDLE SAYS NO: at 2.1.251 a truthy value FORCES THE
 * PERMISSION MODE TO `default` ("Permission mode forced to default —
 * CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set (allowed_non_write_users hardening)"),
 * overriding the `bypassPermissions` every corpus scenario is recorded under. It
 * would not harden the graded engine; it would silently grade a DIFFERENT one.
 * The leak is closed at its source instead — the engine never receives a real
 * credential (see `PLACEHOLDER_CREDENTIALS`) — which makes the sanitizer's
 * behavior irrelevant rather than load-bearing.
 *
 * Neither is in the allowlist, so neither can arrive by inheritance; this asserts
 * neither can arrive by hand either.
 */
export const FORBIDDEN_VARS = ["CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF", "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"] as const;

/** Deliberate, schema-checked additions a caller may make. Nothing else is accepted. */
export interface EngineEnvKnobs {
  /**
   * `undefined` → the harness config dir (the normal case). `null` → omit the
   * variable entirely, which ONLY the isolation probe wants (it exists to prove
   * that omitting it leaks into the operator's real `~/.claude`).
   */
  configDir?: string | null;
  /** Bounds retry backoff so a fault sweep is minutes, not tens of minutes (H2). */
  maxRetries?: string;
  /**
   * Per-gate env overrides, seeded ON PURPOSE by the flip-liveness experiment
   * (§3.3). Kept separate from the allowlist so that "the harness set this" and
   * "the operator's shell had this" can never be confused: an override only
   * reaches the child when a caller names it here, in code.
   */
  gateOverrides?: Record<string, string>;
  /** Extra platform vars a specific driver needs (e.g. GIT_* pinning). Names are asserted. */
  platform?: Record<string, string>;
  /**
   * `CLAUDE_CODE_EAGER_FLUSH` — DEFAULT ON. The engine writes its session
   * transcript on a 100 ms timer, and what is in the file when the query
   * resolves is therefore a race. This makes the drain synchronous: six sites in
   * the headless loop chunk (`chunk-dvbbv89q.js`) read the variable and
   * `await flushSessionStorage()` after each record.
   *
   * THE CUT SAID DECIDE BY MEASUREMENT, IN ORDER, AND THE ORDER WAS FOLLOWED.
   *  (a) Byte-stable, no mechanism? Refuted. `resume` (16 records) was stable
   *      across five replays, but `compact-continue` (~50 records) produced
   *      33,175 / 33,175 / 33,166 / 34,220 bytes and 49, 50 or 71 records across
   *      replays of the SAME engine — while its 29 SDK messages and 8 results
   *      were byte-identical every time and the proxy served zero fallbacks. The
   *      engine's observable behaviour is deterministic; what it leaves on disk
   *      is not.
   *  (b) Observed quiesce? Implemented (`awaitQuiesce`, and KEPT — see below) and
   *      insufficient: the variance survived it unchanged, because it is not a
   *      sampling error. Measured cause: this scenario COMPACTS, and the
   *      transcript compactor rewrites the file in place while the 100 ms drain
   *      is still appending — so the timer arm lands on 49 records (the rewrite
   *      won) or 71 (it did not), for the same eight exchanges. Waiting longer
   *      cannot decide a race that has already been decided.
   *  (c) So this, with the negative control the cut asked for:
   *      `w9/measure.ts --phase flush` runs BOTH arms and requires the contrast —
   *      unstable without the knob, stable with it. A determinism knob whose
   *      absence changes nothing would be grading nothing.
   *
   * WHAT IT CHANGES ON THE DIFFERENTIAL SURFACE, per §3.4. It removes the write
   * QUEUE's batching from every graded run: the file is now written record by
   * record, so a reimplementation that dropped, reordered or double-counted
   * entries INSIDE the queue would leave the same file as one that did not. That
   * is a real loss and it is where C12c's mutation battery has to pay for it —
   * "dropped pendingEntries replay" and "queue item resolved before its bytes
   * landed" are already on that wave's list, and they are now load-bearing rather
   * than belt-and-braces. What it does NOT change is the CONTENT contract: the
   * eager arm produces the SETTLED state every time — 49 records, the
   * post-compaction file — where the timer arm produces the settled state or the
   * one where the rewrite lost, at random.
   * It also touches no API traffic, so no cassette's body hash moves.
   *
   * `awaitQuiesce` stays in `src/state.ts` even though this made it unnecessary
   * for the corpus: it is what turns "the file was still moving" from an
   * invisible sampling error into a named, failing outcome, and the next
   * storage-bearing surface (C15a's task-output directory) has no such knob.
   *
   * Set false ONLY by the negative control.
   */
  eagerFlush?: boolean;
  /**
   * `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` — the auto-compaction threshold, as a
   * percentage of the effective context window, for the ONE scenario that grades
   * the trigger policy. A string because the engine parses it with `parseFloat`.
   *
   * WHY AN ENV VAR IS THE RIGHT ANSWER HERE, and why it is not a precedent for
   * inheriting one. The natural reactive trigger is `effectiveWindow − 13,000`
   * tokens, which for the corpus's model is ≈167,000 — reaching it live would
   * take on the order of a hundred exchanges with deliberately enormous tool
   * outputs and a multi-megabyte cassette, for one predicate. Upstream ships the
   * cheap path itself: `W3()` reads this variable as `testPctOverride` and
   * lowers the threshold to a percentage of the same window, so two exchanges
   * reach it. There is no SDK option for it, which is the distinction contract
   * X6 actually draws — a scenario may declare what it asks the engine to do,
   * and where upstream exposes that only as a variable, the variable is the
   * declaration.
   *
   * APPROVED BY THE X6 OWNER: campaign spec
   * `docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`, the
   * C6–C10 bloc's scout-driven corrections — "`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
   * is approved for the X6 allowlist (C3 sign-off recorded here) to make
   * compaction-depth recordable cheaply". Set identically for both engines by
   * the scenario that declares it, so it moves no differential.
   */
  autoCompactPct?: string;
}

export interface EngineEnvOptions {
  mode: EnvMode;
  /** ANTHROPIC_BASE_URL — the record/replay proxy seam. */
  baseUrl?: string;
  knobs?: EngineEnvKnobs;
  /** The parent environment to SELECT from. Injectable so the matrix test needs no global mutation. */
  parent?: Record<string, string | undefined>;
  /** Absolute path of the pinned bun; the engine wrapper scripts read it. */
  bun?: string;
  /** Harness-owned config dir default. */
  configDir?: string;
}

export class MissingCredentialError extends Error {
  constructor() {
    super(
      `ABORT: record mode needs a credential in the parent environment — set one of ${CREDENTIAL_VARS.join(" or ")} ` +
        `(source CC-to-SDK/.env). Replay mode needs none.`,
    );
    this.name = "MissingCredentialError";
  }
}

/**
 * Which credential variable RECORD mode would select from this parent, or
 * `null` if none is available. Returns the NAME — never the value.
 */
export function selectCredential(parent: Record<string, string | undefined>): CredentialVar | null {
  for (const name of CREDENTIAL_VARS) {
    const v = parent[name];
    if (typeof v === "string" && v.length > 0) return name;
  }
  return null;
}

/**
 * Guard for entry points that will RECORD. Asks the schema which credential it
 * would select, so the guard and the builder can never disagree — the old
 * hand-written `if (!OAUTH && !API_KEY)` guards drifted from what actually
 * reached the child the moment selection replaced inheritance.
 *
 * Prints the variable NAME it selected. Never the value.
 */
export function requireRecordCredential(parent: Record<string, string | undefined> = process.env as Record<string, string | undefined>): CredentialVar {
  const name = selectCredential(parent);
  if (name === null) {
    console.error(new MissingCredentialError().message);
    process.exit(1);
  }
  console.log(`auth: recording with ${name} (value not printed)`);
  return name;
}

/** The credential variable, and its REAL value, that the record proxy injects. */
export interface RecordCredential {
  name: CredentialVar;
  value: string;
}

/**
 * Resolve the real credential the RECORD PROXY will put on the wire.
 *
 * This is the only place a real credential value is read, and it is read in the
 * HARNESS process — never from the engine's environment, which by construction
 * holds a placeholder. Returns `null` when the parent has none, which is what a
 * stub-upstream test wants (nothing to inject, nothing to leak).
 */
export function recordCredential(parent: Record<string, string | undefined> = process.env as Record<string, string | undefined>): RecordCredential | null {
  const name = selectCredential(parent);
  return name === null ? null : { name, value: parent[name]! };
}

/** Human-readable, credential-safe description of what a built env carries. */
export function describeCredential(env: Record<string, string>): string {
  const present = CREDENTIAL_VARS.filter((n) => n in env);
  if (present.length === 0) return "none";
  const name = present[0];
  // Under X6 the child NEVER holds a real credential in either mode; anything
  // else means a caller hand-built an env that bypassed `engineEnv`.
  const placeholder = env[name] === PLACEHOLDER_CREDENTIALS[name];
  return `${present.join("+")}${placeholder ? " (placeholder — the record proxy injects the real value)" : " (NOT the placeholder — a real credential reached the child)"}`;
}

/**
 * The vars the harness sets on purpose, with the reason each one is here.
 * Kept as data so `assertSchema` and the tests grade the same list the builder
 * uses — a second hand-maintained copy is how allowlists rot.
 */
export const HARNESS_SET_VARS = [
  "CLAUDE_CONFIG_DIR", //            H1: reforge-owned config dir, never the operator's ~/.claude
  "ANTHROPIC_BASE_URL", //           the record/replay proxy seam
  "CLAUDE_CODE_MAX_RETRIES", //      H2: bounds retry backoff so retry COUNT is diffable
  "DISABLE_TELEMETRY", //            gate kill-switch (research §2) + no telemetry traffic
  "DISABLE_ERROR_REPORTING", //      no Sentry traffic
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", // gate kill-switch + skips the client-data bootstrap fetch
  "DISABLE_GROWTHBOOK", //           §3.3: the NARROWEST gate kill-switch, independent of the telemetry chain
  "BUN", //                          §3.5: the pinned compile-target runtime the engine wrappers exec
  "CLAUDE_CODE_ENTRYPOINT", //       pinned (see PINNED_ENTRYPOINT) — the engine writes it into every request body
  "CLAUDE_AGENT_SDK_VERSION", //     set by sdk.mjs from its own version; listed so assertSchema accepts it
  "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", // C7/W4: the auto-compact threshold knob (see `autoCompactPct`; C3 sign-off in the spec's C6–C10 bloc)
  "CLAUDE_CODE_EAGER_FLUSH", //      C12a/W9a: the transcript drain, made synchronous so the fourth surface grades a file and not a race (see `eagerFlush`)
] as const;

/**
 * The entrypoint label the engine stamps into its billing metadata, and
 * therefore into every request body: `cc_entrypoint=<value>`.
 *
 * MEASURED, and the first thing the allowlist caught. This variable was being
 * INHERITED, so every cassette recorded from inside a Claude Code session
 * carried `sdk-cli` while the same recording made from a plain terminal would
 * have carried `sdk-ts`. The corpus's match key silently depended on which
 * shell the operator happened to record from — precisely the operator-env
 * coupling §3.3 exists to remove.
 *
 * It has to be PINNED rather than left to a default, because reforge drives the
 * engine two ways: through `sdk.mjs` (which sets `sdk-ts` when the variable is
 * absent) and raw over stdio (which sets nothing at all). Those two drivers
 * share cassettes — `m2/raw-protocol.ts` replays the `plain` recording — so an
 * unpinned entrypoint makes the raw driver's body hash miss by construction.
 *
 * The pinned value matches the existing corpus. Moving it to `sdk-ts` (arguably
 * the truthful label for the SDK-driven lane) is a one-character change that
 * costs a full corpus re-record, so it is deferred to the next pin bump, when a
 * re-record happens anyway. Logged in `docs/tech-debt-tracker.md`.
 */
export const PINNED_ENTRYPOINT = "sdk-cli";

const ALLOWED = new Set<string>([...PLATFORM_PASSTHROUGH, ...HARNESS_SET_VARS, ...CREDENTIAL_VARS]);

/**
 * Postcondition check. Runs on every built env (and is exported so a driver that
 * builds its own env — the raw-protocol driver adds nothing, but a future one
 * might — can be held to the same contract).
 */
export function assertSchema(env: Record<string, string>, declaredOverrides: string[] = []): void {
  const overrides = new Set(declaredOverrides);
  for (const forbidden of FORBIDDEN_VARS) {
    if (forbidden in env) throw new Error(`env schema violation: ${forbidden} must never reach the engine (research §4)`);
  }
  for (const name of Object.keys(env)) {
    if (ALLOWED.has(name) || overrides.has(name)) continue;
    throw new Error(
      `env schema violation: '${name}' is outside the allowlist. Add it to PLATFORM_PASSTHROUGH/HARNESS_SET_VARS with a ` +
        `written reason, or pass it as a declared gate override — do not inherit it (X6).`,
    );
  }
  const creds = CREDENTIAL_VARS.filter((n) => n in env);
  if (creds.length > 1) throw new Error(`env schema violation: ${creds.join(" + ")} both present — exactly one credential is selected, never inherited`);
}

/**
 * Build the engine subprocess environment.
 *
 * @throws MissingCredentialError in record mode when the parent has no credential.
 */
export function engineEnv(opts: EngineEnvOptions): Record<string, string> {
  const parent = opts.parent ?? (process.env as Record<string, string | undefined>);
  const knobs = opts.knobs ?? {};
  const env: Record<string, string> = {};

  for (const name of PLATFORM_PASSTHROUGH) {
    const v = parent[name];
    if (typeof v === "string") env[name] = v;
  }
  for (const [name, value] of Object.entries(knobs.platform ?? {})) {
    if (!ALLOWED.has(name)) throw new Error(`env schema violation: platform knob '${name}' is not in PLATFORM_PASSTHROUGH`);
    env[name] = value;
  }

  // Determinism knobs. All three telemetry/traffic switches trip the GrowthBook
  // provider's isEnabled() off through DIFFERENT predicates, and DISABLE_GROWTHBOOK
  // is the narrowest of them — belt, braces, and a third strap, because a single
  // upstream refactor of the telemetry predicate chain would otherwise silently
  // re-enable gate resolution (research §2, §4).
  env.DISABLE_TELEMETRY = "1";
  env.DISABLE_ERROR_REPORTING = "1";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.DISABLE_GROWTHBOOK = "1";
  env.CLAUDE_CODE_ENTRYPOINT = PINNED_ENTRYPOINT;

  if (knobs.configDir !== null) env.CLAUDE_CONFIG_DIR = knobs.configDir ?? opts.configDir ?? "";
  if (env.CLAUDE_CONFIG_DIR === "") delete env.CLAUDE_CONFIG_DIR;
  if (opts.baseUrl) env.ANTHROPIC_BASE_URL = opts.baseUrl;
  if (knobs.maxRetries !== undefined) env.CLAUDE_CODE_MAX_RETRIES = knobs.maxRetries;
  // Absent unless a scenario asks for it, like the retry bound above: the whole
  // corpus is graded at the engine's own threshold, and exactly one scenario
  // lowers it (X6, see `autoCompactPct`).
  if (knobs.autoCompactPct !== undefined) env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = knobs.autoCompactPct;
  // The transcript drain, synchronous by default (see `eagerFlush`). Unlike the
  // knobs above it is ON unless a caller opts out, because it is a property of
  // the harness's measurement regime rather than of one scenario — the same
  // standing as the four telemetry switches.
  if (knobs.eagerFlush !== false) env.CLAUDE_CODE_EAGER_FLUSH = "1";
  if (opts.bun) env.BUN = opts.bun;

  if (opts.mode === "record") {
    // Record mode still SELECTS from the parent — the selection decides which
    // auth path the engine takes, and `startRecordProxy` injects the matching
    // real credential outbound — but the child only ever holds the placeholder.
    const name = selectCredential(parent);
    if (name === null) throw new MissingCredentialError();
    env[name] = PLACEHOLDER_CREDENTIALS[name];
  } else {
    env.CLAUDE_CODE_OAUTH_TOKEN = PLACEHOLDER_CREDENTIALS.CLAUDE_CODE_OAUTH_TOKEN;
  }

  const overrides = Object.entries(knobs.gateOverrides ?? {});
  for (const [name, value] of overrides) {
    if (ALLOWED.has(name)) throw new Error(`env schema violation: '${name}' is an allowlisted var, not a gate override`);
    env[name] = value;
  }

  assertSchema(env, overrides.map(([n]) => n));
  return env;
}
