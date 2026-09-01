// X6 acceptance — the five-case credential/allowlist matrix (§3.3), plus the
// gate-pinning postconditions.
//
// Every case is watched REJECTING its violation and ACCEPTING its legitimate
// neighbour, per §3.1's non-vacuity doctrine: a schema test that only ever
// builds valid environments proves nothing about what the schema excludes.
//
// No credential VALUE is ever printed. The fixtures use obviously-fake strings
// and the assertions compare against those fixtures, not against the real env.
//
// Run: npx tsx src/env.test.ts
import {
  assertSchema,
  CREDENTIAL_VARS,
  describeCredential,
  engineEnv,
  MissingCredentialError,
  PINNED_ENTRYPOINT,
  PLACEHOLDER_CREDENTIALS,
  PLATFORM_PASSTHROUGH,
  recordCredential,
  REPLAY_PLACEHOLDER_TOKEN,
  selectCredential,
} from "./env.js";

let pass = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
function throws(label: string, fn: () => unknown, match?: RegExp): void {
  try {
    fn();
    failures.push(`${label} — expected a throw, got none`);
  } catch (e) {
    const msg = String((e as Error).message);
    if (match && !match.test(msg)) failures.push(`${label} — threw the wrong error: ${msg}`);
    else pass++;
  }
}

const FAKE_OAUTH = "sk-ant-oat01-FAKE-FIXTURE-VALUE";
const FAKE_KEY = "sk-ant-api03-FAKE-FIXTURE-VALUE";
const PLATFORM = { PATH: "/usr/bin:/bin", HOME: "/Users/fixture", TMPDIR: "/tmp/fixture/", SHELL: "/bin/zsh", TERM: "xterm-256color", LANG: "en_US.UTF-8" };
const BASE = { baseUrl: "http://127.0.0.1:1234", configDir: "/reforge/config", bun: "/reforge/toolchain/bun" };

// ---------------------------------------------------------------------------
// Case 1 — OAuth only. Record SELECTS it (so the engine takes the OAuth path)
// but the child gets the placeholder; the real token goes on the wire from the
// record proxy. Replay is unchanged.
// ---------------------------------------------------------------------------
{
  const parent = { ...PLATFORM, CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH };
  const rec = engineEnv({ ...BASE, mode: "record", parent });
  check("1 record: selects the OAuth VARIABLE", "CLAUDE_CODE_OAUTH_TOKEN" in rec);
  check("1 record: the child gets the placeholder, not the real token", rec.CLAUDE_CODE_OAUTH_TOKEN === PLACEHOLDER_CREDENTIALS.CLAUDE_CODE_OAUTH_TOKEN);
  check("1 record: the real token reaches NO child variable", !Object.values(rec).includes(FAKE_OAUTH));
  check("1 record: no API key appears", !("ANTHROPIC_API_KEY" in rec));
  check("1 record: describeCredential names the var, not the value", describeCredential(rec) === "CLAUDE_CODE_OAUTH_TOKEN (placeholder — the record proxy injects the real value)");
  check("1 record: description leaks no value", !describeCredential(rec).includes(FAKE_OAUTH));
  // …and the harness DOES still resolve the real credential — for the proxy,
  // from the parent, never from the child env.
  check("1 record: the proxy's credential is the real OAuth token", JSON.stringify(recordCredential(parent)) === JSON.stringify({ name: "CLAUDE_CODE_OAUTH_TOKEN", value: FAKE_OAUTH }));

  const rep = engineEnv({ ...BASE, mode: "replay", parent });
  check("1 replay: substitutes the placeholder", rep.CLAUDE_CODE_OAUTH_TOKEN === REPLAY_PLACEHOLDER_TOKEN);
  check("1 replay: the parent's real token never reaches the child", !Object.values(rep).includes(FAKE_OAUTH));
}

// ---------------------------------------------------------------------------
// Case 2 — API key only. Record falls back to it; replay still uses OAuth
// placeholder and drops the key.
// ---------------------------------------------------------------------------
{
  const parent = { ...PLATFORM, ANTHROPIC_API_KEY: FAKE_KEY };
  const rec = engineEnv({ ...BASE, mode: "record", parent });
  check("2 record: selects the API-key VARIABLE when it is the only credential", "ANTHROPIC_API_KEY" in rec);
  check("2 record: the child gets the API-key placeholder", rec.ANTHROPIC_API_KEY === PLACEHOLDER_CREDENTIALS.ANTHROPIC_API_KEY);
  check("2 record: no OAuth var invented", !("CLAUDE_CODE_OAUTH_TOKEN" in rec));
  // THE LEAK THIS CLOSES: the pinned engine's subprocess sanitizer preserves
  // ANTHROPIC_API_KEY, so a real value here would be readable by any Bash
  // command the engine runs — and tool output flows into the next request body,
  // hence into the cassette and the transcript.
  check("2 record: the real API key reaches NO child variable", !Object.values(rec).includes(FAKE_KEY));
  check("2 record: the proxy's credential is the real API key", JSON.stringify(recordCredential(parent)) === JSON.stringify({ name: "ANTHROPIC_API_KEY", value: FAKE_KEY }));

  const rep = engineEnv({ ...BASE, mode: "replay", parent });
  check("2 replay: drops the API key", !("ANTHROPIC_API_KEY" in rep));
  check("2 replay: placeholder present", rep.CLAUDE_CODE_OAUTH_TOKEN === REPLAY_PLACEHOLDER_TOKEN);
}

// ---------------------------------------------------------------------------
// Case 3 — BOTH set. This is the case the schema exists for: upstream's own
// precedence is that ANTHROPIC_API_KEY SHADOWS the OAuth token, which silently
// bills metered credits instead of the subscription. Selection must pick OAuth
// and the key must not reach the child at all — shadowing cannot happen if only
// one variable is present.
// ---------------------------------------------------------------------------
{
  const parent = { ...PLATFORM, CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH, ANTHROPIC_API_KEY: FAKE_KEY };
  check("3 selectCredential prefers OAuth", selectCredential(parent) === "CLAUDE_CODE_OAUTH_TOKEN");
  const rec = engineEnv({ ...BASE, mode: "record", parent });
  check("3 record: OAuth selected", rec.CLAUDE_CODE_OAUTH_TOKEN === PLACEHOLDER_CREDENTIALS.CLAUDE_CODE_OAUTH_TOKEN);
  check("3 record: the API key is NOT passed (no shadowing possible)", !("ANTHROPIC_API_KEY" in rec));
  check("3 record: exactly one credential", CREDENTIAL_VARS.filter((n) => n in rec).length === 1);
  check("3 record: neither real value reaches the child", !Object.values(rec).includes(FAKE_OAUTH) && !Object.values(rec).includes(FAKE_KEY));
  check("3 record: the proxy injects the OAuth token, not the key", recordCredential(parent)?.value === FAKE_OAUTH);
  // Negative control: a hand-built env carrying both must be REJECTED, so the
  // "exactly one" property is enforced rather than merely produced.
  throws("3 assertSchema rejects a two-credential env", () =>
    assertSchema({ CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH, ANTHROPIC_API_KEY: FAKE_KEY }), /exactly one credential/);
}

// ---------------------------------------------------------------------------
// Case 4 — no credential at all. Record must REFUSE; replay must PROCEED.
// (Replays are served offline by the proxy; requiring auth for them would make
// every offline grade depend on the operator being logged in.)
// ---------------------------------------------------------------------------
{
  const parent = { ...PLATFORM };
  check("4 selectCredential reports none", selectCredential(parent) === null);
  check("4 recordCredential reports none (nothing for the proxy to inject)", recordCredential(parent) === null);
  throws("4 record refuses without a credential", () => engineEnv({ ...BASE, mode: "record", parent }), /record mode needs a credential/);
  try {
    engineEnv({ ...BASE, mode: "record", parent });
  } catch (e) {
    check("4 the refusal is the typed error", e instanceof MissingCredentialError);
  }
  const rep = engineEnv({ ...BASE, mode: "replay", parent });
  check("4 replay proceeds with the placeholder", rep.CLAUDE_CODE_OAUTH_TOKEN === REPLAY_PLACEHOLDER_TOKEN);
}

// ---------------------------------------------------------------------------
// Case 5 — a per-gate override seeded in the PARENT. The child must not see it.
// This is the whole point of the allowlist: `CLAUDE_CODE_LUMINOUS_WHISTLE` is a
// documented, still-live per-gate override in the public 2.1.251 build, so an
// operator who exported it would be changing the ORACLE's behavior.
// ---------------------------------------------------------------------------
{
  const parent = {
    ...PLATFORM,
    CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH,
    CLAUDE_CODE_LUMINOUS_WHISTLE: "1",
    CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF: "1",
    CLAUDE_CODE_SUBAGENT_MODEL: "claude-fixture",
    ANTHROPIC_MODEL: "claude-fixture",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "1",
  };
  for (const mode of ["record", "replay"] as const) {
    const env = engineEnv({ ...BASE, mode, parent });
    check(`5 ${mode}: the seeded gate override is dropped`, !("CLAUDE_CODE_LUMINOUS_WHISTLE" in env));
    check(`5 ${mode}: the disk-cache opt-in is dropped`, !("CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF" in env));
    check(`5 ${mode}: other CLAUDE_CODE_* knobs are dropped`, !("CLAUDE_CODE_SUBAGENT_MODEL" in env) && !("CLAUDE_CODE_MAX_OUTPUT_TOKENS" in env));
    check(`5 ${mode}: other ANTHROPIC_* vars are dropped`, !("ANTHROPIC_MODEL" in env));
  }
  // …and the SAME override, when a caller seeds it deliberately, DOES reach the
  // child. Without this half, case 5 would also pass for a builder that simply
  // never emits that variable — the allowlist has to be what stands between the
  // parent and the child, not an accident of the value being unreachable.
  const seeded = engineEnv({ ...BASE, mode: "replay", parent, knobs: { gateOverrides: { CLAUDE_CODE_LUMINOUS_WHISTLE: "1" } } });
  check("5 a DELIBERATE override does reach the child", seeded.CLAUDE_CODE_LUMINOUS_WHISTLE === "1");
}

// ---------------------------------------------------------------------------
// Gate pinning (§3.3) — the kill-switch is set and the opt-in is refused.
// ---------------------------------------------------------------------------
{
  const parent = { ...PLATFORM, CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH };
  for (const mode of ["record", "replay"] as const) {
    const env = engineEnv({ ...BASE, mode, parent });
    check(`gate ${mode}: DISABLE_GROWTHBOOK=1`, env.DISABLE_GROWTHBOOK === "1");
    check(`gate ${mode}: CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === "1");
    check(`gate ${mode}: DISABLE_TELEMETRY=1`, env.DISABLE_TELEMETRY === "1");
    check(`gate ${mode}: the disk-cache opt-in is absent`, !("CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF" in env));
  }
  // Negative control: the forbidden var is refused even when a caller declares
  // it as a deliberate override — the one var no experiment may seed.
  throws("gate: the disk-cache opt-in cannot be seeded as an override", () =>
    engineEnv({ ...BASE, mode: "replay", parent, knobs: { gateOverrides: { CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF: "1" } } }),
    /must never reach the engine/);

  // CLAUDE_CODE_SUBPROCESS_ENV_SCRUB was proposed as defense in depth against
  // the record-mode key leak. It is FORBIDDEN instead: at the pin, a truthy
  // value forces the permission mode to `default`, overriding the
  // bypassPermissions every corpus scenario is recorded under — it would grade a
  // different engine, not a hardened one. The leak is closed at its source.
  for (const mode of ["record", "replay"] as const) {
    const env = engineEnv({ ...BASE, mode, parent: { ...parent, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" } });
    check(`gate ${mode}: an inherited SUBPROCESS_ENV_SCRUB is dropped`, !("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB" in env));
  }
  throws("gate: SUBPROCESS_ENV_SCRUB cannot be seeded as an override either", () =>
    engineEnv({ ...BASE, mode: "replay", parent, knobs: { gateOverrides: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" } } }),
    /must never reach the engine/);
}

// ---------------------------------------------------------------------------
// Allowlist mechanics: platform passthrough, deliberate knobs, and the
// postcondition that refuses anything outside the schema.
// ---------------------------------------------------------------------------
{
  const parent = { ...PLATFORM, CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH };
  const env = engineEnv({ ...BASE, mode: "record", parent, knobs: { maxRetries: "1" } });
  for (const name of ["PATH", "HOME", "TMPDIR", "SHELL", "TERM", "LANG"]) {
    check(`platform ${name} passes through`, env[name] === (PLATFORM as Record<string, string>)[name]);
  }
  check("absent platform vars are not invented", !("LC_ALL" in env) && !("USER" in env));
  check("PLATFORM_PASSTHROUGH is the source of truth", PLATFORM_PASSTHROUGH.includes("PATH"));
  check("CLAUDE_CONFIG_DIR is set from the harness", env.CLAUDE_CONFIG_DIR === "/reforge/config");
  check("ANTHROPIC_BASE_URL is the proxy seam", env.ANTHROPIC_BASE_URL === BASE.baseUrl);
  check("CLAUDE_CODE_MAX_RETRIES comes from the knob", env.CLAUDE_CODE_MAX_RETRIES === "1");
  check("BUN points at the pinned runtime", env.BUN === BASE.bun);
  // The entrypoint is PINNED, not inherited: it lands in every request body as
  // cc_entrypoint, and it was measurably leaking from the recording shell.
  check("CLAUDE_CODE_ENTRYPOINT is pinned", env.CLAUDE_CODE_ENTRYPOINT === PINNED_ENTRYPOINT);
  check("a parent entrypoint cannot override the pin",
    engineEnv({ ...BASE, mode: "record", parent: { ...parent, CLAUDE_CODE_ENTRYPOINT: "operator-shell" } }).CLAUDE_CODE_ENTRYPOINT === PINNED_ENTRYPOINT);
  check("no retries var when the knob is unset", !("CLAUDE_CODE_MAX_RETRIES" in engineEnv({ ...BASE, mode: "record", parent })));
  // C7/W4's addition. Two halves, and the second is the one that matters: the
  // knob has to reach the child when a scenario declares it, and the variable
  // has to be ABSENT for every scenario that does not — a corpus-wide
  // auto-compact threshold would silently change what the other 30 recordings
  // are grading. Inheriting it is refused by the same allowlist as everything
  // else: an operator export never reaches the child, only the knob does.
  check(
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE comes from the knob",
    engineEnv({ ...BASE, mode: "record", parent, knobs: { autoCompactPct: "1" } }).CLAUDE_AUTOCOMPACT_PCT_OVERRIDE === "1",
  );
  check("no auto-compact override when the knob is unset", !("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" in engineEnv({ ...BASE, mode: "record", parent })));
  check(
    "an INHERITED auto-compact override is dropped",
    !("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE" in engineEnv({ ...BASE, mode: "record", parent: { ...parent, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "99" } })),
  );
  // configDir: null is how the isolation probe asks for the UNISOLATED env.
  check("configDir null omits the var", !("CLAUDE_CONFIG_DIR" in engineEnv({ ...BASE, mode: "replay", parent, knobs: { configDir: null } })));

  throws("assertSchema rejects an unlisted var", () => assertSchema({ ...env, CLAUDE_CODE_LUMINOUS_WHISTLE: "1" }), /outside the allowlist/);
  throws("assertSchema rejects an unlisted ANTHROPIC_* var", () => assertSchema({ ...env, ANTHROPIC_MODEL: "x" }), /outside the allowlist/);
  check("assertSchema accepts the env the builder produced", (() => { assertSchema(env); return true; })());
  check("assertSchema accepts a DECLARED override", (() => { assertSchema({ ...env, CLAUDE_CODE_LUMINOUS_WHISTLE: "1" }, ["CLAUDE_CODE_LUMINOUS_WHISTLE"]); return true; })());
  throws("a gate override may not shadow an allowlisted var", () =>
    engineEnv({ ...BASE, mode: "replay", parent, knobs: { gateOverrides: { DISABLE_GROWTHBOOK: "0" } } }), /allowlisted var, not a gate override/);
  throws("a platform knob outside PLATFORM_PASSTHROUGH is refused", () =>
    engineEnv({ ...BASE, mode: "replay", parent, knobs: { platform: { NOT_A_PLATFORM_VAR: "x" } } }), /not in PLATFORM_PASSTHROUGH/);
}

console.log(`=== env schema: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(failures.length === 0 ? "PASS — allowlist + credential schemas hold on all five parent shapes" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
