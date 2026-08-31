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
 * Must never reach the child. `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` is
 * the one opt-IN that would let the GrowthBook disk cache be read while
 * telemetry is off (research §4) — i.e. the single documented way a cached gate
 * blob could override a compiled-in default under our own kill-switches. It is
 * not in the allowlist, so it cannot arrive by inheritance; this asserts it
 * cannot arrive by hand either.
 */
export const FORBIDDEN_VARS = ["CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF"] as const;

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

/** Human-readable, credential-safe description of what a built env carries. */
export function describeCredential(env: Record<string, string>): string {
  const present = CREDENTIAL_VARS.filter((n) => n in env);
  if (present.length === 0) return "none";
  const name = present[0];
  const placeholder = env[name] === REPLAY_PLACEHOLDER_TOKEN;
  return `${present.join("+")}${placeholder ? " (replay placeholder)" : " (from parent, value not printed)"}`;
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
  if (opts.bun) env.BUN = opts.bun;

  if (opts.mode === "record") {
    const name = selectCredential(parent);
    if (name === null) throw new MissingCredentialError();
    env[name] = parent[name]!;
  } else {
    env.CLAUDE_CODE_OAUTH_TOKEN = REPLAY_PLACEHOLDER_TOKEN;
  }

  const overrides = Object.entries(knobs.gateOverrides ?? {});
  for (const [name, value] of overrides) {
    if (ALLOWED.has(name)) throw new Error(`env schema violation: '${name}' is an allowlisted var, not a gate override`);
    env[name] = value;
  }

  assertSchema(env, overrides.map(([n]) => n));
  return env;
}
