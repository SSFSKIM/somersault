// §3.3 flip-liveness — does a per-gate environment override actually reach the
// engine, and is the allowlist what stands between the operator's shell and the
// oracle's behavior?
//
//   npx tsx m3/flip-liveness.ts [--scenario <tag>]
//
// Two halves, and the second is the one that must never be skipped:
//
//   POSITIVE — seed a per-gate override INSIDE the allowlist (a declared
//   `knobs.gateOverrides`, i.e. the harness asking for it in code) and look for
//   a behavioral difference. A difference proves the resolver precedence is what
//   `research/2026-08-31-gate-blob-resolution.md` says it is: the env override
//   is consulted BEFORE the compiled-in default, so the defaults fixture
//   describes reality only because the environment is locked.
//
//   NEGATIVE CONTROL — seed the SAME variable in the parent process, run through
//   the normal env schema, and require that nothing changes. This is the half
//   that grades the allowlist itself. Without it, "no difference" is
//   indistinguishable from "the gate does nothing".
//
// Candidates are read from the committed gate-defaults fixture's own
// `perGateEnvOverrides` inventory, so this test cannot drift from the bundle:
// at a pin bump the inventory is regenerated and this sweep follows it.
//
// Replay note: a flipped run legitimately asks for things the cassette never
// recorded, so positional fallbacks and unmatched requests are EXPECTED here and
// are not graded. The signal is the request-body diff, which shows a
// prompt-shaped change before any response is needed.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts, makeRunNormalizer, normalizeValue } from "../src/differ.js";
import { scrubRequestBody } from "../src/canonical.js";
import { resetSandbox, type Scenario, type ScenarioContext } from "../src/harness.js";
import { startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT } from "../src/runTurn.js";
import { fixturePath, type GateFixture } from "../research/tools/extract-gate-defaults.js";
import { ENGINE_VERSION } from "../src/pin.js";
import { SCENARIOS as M1_SCENARIOS } from "../m1/scenarios.js";
import { M2C_SCENARIOS } from "../m2c/scenarios.js";
import { M3_SCENARIOS } from "./scenarios.js";

const ALL = [...M1_SCENARIOS, ...M2C_SCENARIOS, ...M3_SCENARIOS];
const args = process.argv.slice(2);
const TAG = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : "multi-turn";
const scenario: Scenario | undefined = ALL.find((s) => s.tag === TAG);
if (!scenario) {
  console.error(`ABORT: unknown scenario '${TAG}'`);
  process.exit(2);
}
const cassette = join(REFORGE_ROOT, "cassettes", `m1-${TAG}.jsonl`);
if (!existsSync(cassette)) {
  console.error(`ABORT: cassette missing — run: npx tsx m1/run.ts --scenario ${TAG}`);
  process.exit(2);
}
const fixtureFile = fixturePath(ENGINE_VERSION);
if (!existsSync(fixtureFile)) {
  console.error(`ABORT: gate fixture missing — run: npx tsx research/tools/extract-gate-defaults.ts`);
  process.exit(2);
}
const fixture: GateFixture = JSON.parse(readFileSync(fixtureFile, "utf8"));

interface Capture {
  messages: unknown[];
  requests: unknown[];
}

function loadObserved(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((r: { method: string; path: string; requestBody: string }) => ({
      method: r.method,
      path: r.path,
      body: normalizeValue(JSON.parse(scrubRequestBody(r.requestBody) || "null")),
    }));
}

async function run(label: string, gateOverrides?: Record<string, string>): Promise<Capture> {
  const observed = join(REFORGE_ROOT, "cassettes", `m3-flip-observed-${label}.jsonl`);
  rmSync(observed, { force: true });
  const proxy = await startReplayProxy(cassette, observed);
  const ctx: ScenarioContext = {
    engine: enginePath("engine-real"),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: () => {},
    mode: "replay",
    ...(gateOverrides ? { knobs: { gateOverrides } } : {}),
  };
  resetSandbox();
  let messages: unknown[];
  try {
    messages = await scenario!.run(ctx);
  } catch (e) {
    messages = [{ type: "reforge-exception", message: String((e as Error).message).slice(0, 200) }];
  }
  await proxy.close();
  return { messages, requests: loadObserved(observed) };
}

/** Normalized difference across both observable surfaces, with evidence. */
function differs(a: Capture, b: Capture): { transcripts: number; requests: number; evidence: string[] } {
  const na = makeRunNormalizer(a.messages);
  const nb = makeRunNormalizer(b.messages);
  const t = diffTranscripts(a.messages, b.messages);
  const r = diffTranscripts(a.requests.map(na), b.requests.map(nb));
  // A count alone is not evidence — a flip has to be readable as a behavior
  // change, not just as a number.
  const evidence = [...r, ...t]
    .slice(0, 3)
    .map((f) => `${f.path}: ${JSON.stringify(f.a)?.slice(0, 90)} != ${JSON.stringify(f.b)?.slice(0, 90)}`);
  return { transcripts: t.length, requests: r.length, evidence };
}

/**
 * The override is read raw from the environment and returned AS THE GATE VALUE
 * (`if (e !== void 0) return e`), so flipping a gate means supplying a value
 * whose truthiness is the opposite of the compiled-in default. `""` is defined
 * but falsy, which is how a default-true gate is turned off.
 */
const flipValue = (dflt: unknown): string => (dflt === true ? "" : "1");

console.log(`=== §3.3 flip-liveness (scenario: ${TAG}, pin ${ENGINE_VERSION}) ===`);
console.log(`  candidates from the fixture inventory: ${fixture.perGateEnvOverrides.length}`);

const baseline = await run("baseline");
// Self-consistency: two identical runs must agree, or nothing below means anything.
const baseline2 = await run("baseline2");
const selfDiff = differs(baseline, baseline2);
console.log(`  baseline self-consistency: transcripts ${selfDiff.transcripts}, requests ${selfDiff.requests} difference(s)`);
if (selfDiff.transcripts + selfDiff.requests > 0) {
  console.error("ABORT: the baseline disagrees with itself — this scenario cannot detect a flip");
  process.exit(1);
}

const observedFlips: { gate: string; env: string; transcripts: number; requests: number }[] = [];
const silent: { gate: string; env: string }[] = [];

for (const entry of fixture.perGateEnvOverrides) {
  for (const env of entry.env) {
    const dflt = fixture.gates[entry.gate]?.default;
    const value = flipValue(dflt);
    const cap = await run(`flip-${env}`, { [env]: value });
    const d = differs(baseline, cap);
    const flipped = d.transcripts + d.requests > 0;
    console.log(
      `  ${flipped ? "FLIP" : "  · "} ${entry.gate} via ${env}=${JSON.stringify(value)} (default ${JSON.stringify(dflt)})` +
        `${flipped ? ` → transcripts ${d.transcripts}, requests ${d.requests}` : " → no observable difference"}`,
    );
    if (flipped) {
      observedFlips.push({ gate: entry.gate, env, transcripts: d.transcripts, requests: d.requests });
      for (const line of d.evidence) console.log(`         ${line}`);
    }
    else silent.push({ gate: entry.gate, env });
  }
}

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL — mandatory regardless of the positive result.
// ---------------------------------------------------------------------------
console.log("\n--- negative control: the same overrides seeded in the PARENT environment ---");
const seeded: string[] = [];
for (const entry of fixture.perGateEnvOverrides) {
  for (const env of entry.env) {
    process.env[env] = flipValue(fixture.gates[entry.gate]?.default);
    seeded.push(env);
  }
}
console.log(`  seeded ${seeded.length} per-gate override(s) into process.env`);
const controlled = await run("negative-control");
const controlDiff = differs(baseline, controlled);
for (const env of seeded) delete process.env[env];
const controlOk = controlDiff.transcripts + controlDiff.requests === 0;
console.log(
  `  child behavior with a contaminated parent: transcripts ${controlDiff.transcripts}, requests ${controlDiff.requests} difference(s) — ` +
    `${controlOk ? "IDENTICAL to baseline (the allowlist holds)" : "CHANGED — the allowlist is leaking"}`,
);

console.log(`\n=== verdict ===`);
console.log(`  observed flips: ${observedFlips.length}/${seeded.length} — ${observedFlips.map((f) => f.env).join(", ") || "none"}`);
console.log(`  no observable difference: ${silent.length}`);
console.log(`  negative control: ${controlOk ? "PASS" : "FAIL"}`);
if (observedFlips.length === 0) {
  console.log(
    `  NOTE: no flip was observable on this scenario. That is itself a determinism result — under the pinned\n` +
      `  environment the disabled path is the only reachable one — but it is a WEAKER result than an observed\n` +
      `  flip, because it cannot distinguish "the allowlist blocked it" from "the gate does nothing here".\n` +
      `  The negative control is what carries the claim in that case.`,
  );
}
// The negative control is the gate. An observed flip strengthens the finding but
// its absence is a documented outcome, not a failure (§3.3): some overrides are
// guarded by predicates — first-party base URL, interactive TUI — that a
// proxied headless replay can never satisfy.
process.exitCode = controlOk ? 0 : 1;
