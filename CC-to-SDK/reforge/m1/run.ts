// M1 corpus runner — for every scenario: ensure a cassette exists (recorded
// live once through engine-real), then replay it OFFLINE into engine-real (A)
// and engine-extracted (B) and diff three behavioral surfaces:
//   1. SDK message transcripts   2. harness-side events (hooks/permission consults)
//   3. the API requests each engine emitted
// On the identical-code pair every diff is a harness/normalization defect; once
// engine-ts exists, every diff is a reimplementation defect.
//
// Run:  cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m1/run.ts [--scenario <tag>] [--rerecord]
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { diffTranscripts, makeRunNormalizer, normalizeValue, type DiffFinding } from "../src/differ.js";
import { resetSandbox, type Scenario, type ScenarioContext } from "../src/harness.js";
import { scrubRequestBody, startRecordProxy, startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, saveTranscript } from "../src/runTurn.js";
import { M2C_SCENARIOS } from "../m2c/scenarios.js";
import { M3_SCENARIOS } from "../m3/scenarios.js";
import { SCENARIOS as M1_SCENARIOS } from "./scenarios.js";

const SCENARIOS = [...M1_SCENARIOS, ...M2C_SCENARIOS, ...M3_SCENARIOS];

const args = process.argv.slice(2);
// `--scenario` with no value used to leave `only` undefined, which silently ran
// the ENTIRE corpus instead of the one scenario the caller asked for. Treat a
// missing or flag-shaped value as an error, not as "no filter".
const scenarioIdx = args.indexOf("--scenario");
const scenarioArg = scenarioIdx >= 0 ? args[scenarioIdx + 1] : undefined;
if (scenarioIdx >= 0 && (scenarioArg === undefined || scenarioArg.startsWith("--"))) {
  console.error("ABORT: --scenario requires a value.");
  process.exit(2);
}
const only = scenarioArg;
const rerecord = args.includes("--rerecord");
// engine under test (side B). A is always engine-real, the oracle.
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.error("ABORT: no auth in env — source CC-to-SDK/.env first.");
  process.exit(1);
}
mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });

interface RunResult {
  messages: unknown[];
  events: unknown[];
  observedFile: string;
}

async function runOnce(s: Scenario, engineName: string, mode: "record" | "replay", cassette: string, side: string): Promise<RunResult> {
  const observedFile = join(REFORGE_ROOT, "cassettes", `m1-${s.tag}-observed-${side}.jsonl`);
  rmSync(observedFile, { force: true });
  const proxy =
    mode === "record" ? await startRecordProxy(cassette) : await startReplayProxy(cassette, observedFile);
  const events: unknown[] = [];
  const ctx: ScenarioContext = {
    engine: enginePath(engineName),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (event, payload) => events.push({ event, payload }),
  };
  resetSandbox();
  let messages: unknown[];
  try {
    messages = await s.run(ctx);
  } catch (e) {
    messages = [{ type: "reforge-exception", name: (e as Error).name, message: String((e as Error).message).slice(0, 200) }];
  }
  const unmatched = mode === "replay" ? proxy.unmatched() : [];
  const unserved = mode === "replay" ? proxy.unserved() : [];
  await proxy.close();
  if (unmatched.length > 0) console.log(`    WARN ${side}: ${unmatched.length} request(s) matched no cassette entry`);
  if (unserved.length > 0) console.log(`    WARN ${side}: ${unserved.length} cassette entr(ies) never served`);
  return { messages, events, observedFile };
}

/**
 * H1 regression gate. Cassettes are recordings of real prompts; if the engine's
 * config dir leaks, they capture the operator's identity, memory index, and
 * personal commands — a privacy problem and a determinism problem (the
 * recording would change whenever that state changes). Checked at record time.
 */
function cassetteIsClean(cassette: string): boolean {
  const text = readFileSync(cassette, "utf8");
  // The sandbox path legitimately sits under $HOME, so bare-home is not a
  // marker; the operator's real config dir and identity are.
  const markers: [string, string][] = [
    [join(homedir(), ".claude"), "operator config dir"],
    ["Memory index", "operator memory index"],
    ["@gmail.com", "operator email"],
  ];
  const hits = markers.filter(([m]) => text.includes(m)).map(([, label]) => label);
  if (hits.length > 0) {
    // Must REJECT, not just flag: setting process.exitCode here was overwritten
    // by the final verdict assignment, and the contaminated take was promoted
    // and reused anyway — a leaking run could exit 0. Caller discards the
    // staged file and fails the scenario.
    console.log(`    LEAK: cassette contains ${hits.join(", ")} — config isolation is not holding`);
    return false;
  }
  console.log("    leak check: clean");
  return true;
}

function loadObservedRequests(file: string): unknown[] {
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

/**
 * Paths where the ORACLE disagreed with itself, mapped to the values it actually
 * produced there. A per-surface map, never shared across surfaces: transcripts,
 * events and requests all use `msg[i]…` path syntax, so one merged set would let
 * a request-side path excuse a transcript-side difference.
 */
type OracleVariance = Map<string, unknown[]>;

const varianceOf = (findings: DiffFinding[]): OracleVariance => {
  const m: OracleVariance = new Map();
  for (const f of findings) m.set(f.path, [f.a, f.b]);
  return m;
};

/**
 * Is this A-vs-B difference explained by the oracle's own nondeterminism?
 * Only if B produced one of the values the ORACLE was observed to produce at
 * that path. Excusing every value at a variable path would let an engine emit a
 * third, invalid value (e.g. a tool_result the oracle never returns) and still
 * be reported identical.
 */
const withinOracleVariance = (f: DiffFinding, v?: OracleVariance): boolean => {
  const alts = v?.get(f.path);
  if (!alts) return false;
  const b = JSON.stringify(f.b);
  return alts.some((alt) => JSON.stringify(alt) === b);
};

function report(label: string, findings: DiffFinding[], variance?: OracleVariance): boolean {
  if (findings.length === 0) {
    console.log(`    ${label}: identical`);
    return true;
  }
  const genuine = findings.filter((f) => !withinOracleVariance(f, variance));
  const flaky = findings.length - genuine.length;
  const note = flaky > 0 ? ` (${flaky} attributed to oracle nondeterminism)` : "";
  if (genuine.length === 0) {
    console.log(`    ${label}: identical modulo ${flaky} nondeterministic path(s)`);
    return true;
  }
  console.log(`    ${label}: ${genuine.length} difference(s)${note}`);
  for (const f of genuine.slice(0, 10)) {
    console.log(`      ${f.path}: ${JSON.stringify(f.a)?.slice(0, 100)}  !=  ${JSON.stringify(f.b)?.slice(0, 100)}`);
  }
  return false;
}

/**
 * Failure triage. A diff between A and B means "the engines differ" ONLY if the
 * oracle is deterministic on this scenario. Measured counter-example: parallel
 * tool execution returns tool_result blocks in COMPLETION order, so two runs of
 * the same engine disagree. Without this, such scenarios produce a flaky gate
 * and — worse — teach you to ignore red.
 *
 * So on any diff, replay the ORACLE a second time and collect the paths where it
 * disagrees with itself. Those paths are nondeterministic and not attributable
 * to the engine under test.
 */
async function oracleVariance(
  s: Scenario,
  cassette: string,
  a: RunResult,
): Promise<{ transcripts: OracleVariance; events: OracleVariance; requests: OracleVariance; total: number }> {
  const a2 = await runOnce(s, "engine-real", "replay", cassette, "A2");
  const n1 = makeRunNormalizer(a.messages);
  const n2 = makeRunNormalizer(a2.messages);
  const transcripts = varianceOf(diffTranscripts(a.messages, a2.messages));
  const events = varianceOf(diffTranscripts(a.events, a2.events));
  const requests = varianceOf(
    diffTranscripts(loadObservedRequests(a.observedFile).map(n1), loadObservedRequests(a2.observedFile).map(n2)),
  );
  return { transcripts, events, requests, total: transcripts.size + events.size + requests.size };
}

const verdicts: { tag: string; pass: boolean }[] = [];

// A misspelled or valueless --scenario used to select nothing, leaving verdicts
// empty — and `[].every(...)` is vacuously true, so the runner printed ALL PASS
// with exit 0 having executed nothing. Fail loudly instead.
if (only !== undefined && !SCENARIOS.some((s) => s.tag === only)) {
  console.error(`ABORT: unknown scenario '${only}'. Known tags:\n  ${SCENARIOS.map((s) => s.tag).join(", ")}`);
  process.exit(2);
}

for (const s of SCENARIOS) {
  if (only && s.tag !== only) continue;
  console.log(`\n━━━ ${s.tag} — ${s.title} ━━━`);
  const cassette = join(REFORGE_ROOT, "cassettes", `m1-${s.tag}.jsonl`);

  if (!existsSync(cassette) || rerecord) {
    // Record to a temp path and only promote on success: a re-record that hits
    // an outage must not destroy the good cassette it was refreshing. (Measured:
    // `--rerecord` during an API outage deleted a working `plain` cassette and
    // left the scenario ungradable until the outage cleared.)
    const staged = `${cassette}.recording`;
    rmSync(staged, { force: true });
    console.log("  recording live via engine-real ...");
    const rec = await runOnce(s, "engine-real", "record", staged, "record");
    saveTranscript(`m1-${s.tag}-record`, { engine: "engine-real", messages: rec.messages, durationMs: 0 });
    const entries = existsSync(staged) ? readFileSync(staged, "utf8").split("\n").filter(Boolean).length : 0;
    console.log(`  recorded ${entries} API exchange(s)`);
    if (existsSync(staged) && !cassetteIsClean(staged)) {
      rmSync(staged, { force: true });
      console.log("    DISCARDED: contaminated recording rejected — fix config isolation before re-recording");
      verdicts.push({ tag: s.tag, pass: false });
      continue;
    }
    // A recording that captured an infrastructure failure (rate limit, gateway
    // error) is not a cassette — replaying it grades every engine against the
    // same failure and the scenario silently measures nothing. Discard it so the
    // next run re-records, rather than freezing the bad take.
    const infraFail = rec.messages.some((m) => {
      const t = (m as { type?: string }).type;
      const msg = String((m as { message?: unknown }).message ?? "");
      return t === "reforge-exception" && /rate limit|temporarily limiting|overloaded|502|503|504/i.test(msg);
    });
    if (infraFail) {
      rmSync(staged, { force: true });
      const kept = existsSync(cassette);
      console.log(
        `    DISCARDED: recording captured an infrastructure failure (not engine behavior)${kept ? " — previous cassette kept" : " — rerun to re-record"}`,
      );
      verdicts.push({ tag: s.tag, pass: false });
      continue;
    }
    renameSync(staged, cassette);
  } else {
    console.log("  cassette exists — reusing");
  }

  console.log(`  replaying offline: A=engine-real, B=${engineB} ...`);
  const a = await runOnce(s, "engine-real", "replay", cassette, "A");
  const b = await runOnce(s, engineB, "replay", cassette, "B");
  saveTranscript(`m1-${s.tag}-A`, { engine: "engine-real", messages: a.messages, durationMs: 0 });
  saveTranscript(`m1-${s.tag}-B`, { engine: engineB, messages: b.messages, durationMs: 0 });

  const tFind = diffTranscripts(a.messages, b.messages);
  const eFind = diffTranscripts(a.events, b.events);
  // Requests carry engine-minted ids only inside free text, so their id map has
  // to come from that side's transcript, where the ids appear as keys.
  const normA = makeRunNormalizer(a.messages);
  const normB = makeRunNormalizer(b.messages);
  const rFind = diffTranscripts(
    loadObservedRequests(a.observedFile).map(normA),
    loadObservedRequests(b.observedFile).map(normB),
  );

  // Only pay for triage when something actually differs.
  let variance: Awaited<ReturnType<typeof oracleVariance>> | undefined;
  if (tFind.length + eFind.length + rFind.length > 0) {
    console.log("    (diff seen — replaying the oracle again to separate nondeterminism)");
    variance = await oracleVariance(s, cassette, a);
    if (variance.total > 0) console.log(`    oracle is nondeterministic on ${variance.total} path(s)`);
  }

  const tOk = report("transcripts", tFind, variance?.transcripts);
  const eOk = report("events", eFind, variance?.events);
  const rOk = report("requests", rFind, variance?.requests);
  // substance check — guards the hollow-pass class (identical-but-empty behavior)
  const failure = s.check?.(a.messages, a.events) ?? null;
  if (failure) console.log(`    substance: FAIL — ${failure}`);
  else if (s.check) console.log("    substance: ok");
  verdicts.push({ tag: s.tag, pass: tOk && eOk && rOk && !failure });
}

console.log("\n=== M1 corpus verdicts ===");
for (const v of verdicts) console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.tag}`);
if (verdicts.length === 0) {
  console.error("ABORT: no scenario ran — refusing to report a vacuous pass.");
  process.exit(2);
}
const allPass = verdicts.every((v) => v.pass);
console.log(allPass ? "\nALL PASS" : "\nFAILURES — on the identical-code pair these are harness defects; fix before grading engine-ts");
process.exitCode = allPass ? 0 : 1;
