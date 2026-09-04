// C13c / W10c — the grading lane for scenarios whose deadlines had to be moved.
//
//   npx tsx w10/timed.ts --record [--scenario <tag>]   # once, live, at the PIN's own deadlines
//   npx tsx w10/timed.ts          [--scenario <tag>]   # graded, offline, at the profile's
//
// ## Why this is not a corpus scenario
//
// `m1/run.ts` grades every scenario against `engine-real`, and `engine-real` is
// a compiled Mach-O binary: the deadlines are `var NAME=<number>` declarators
// inside it and nothing the harness can reach moves them. A scenario that needs
// one moved therefore has no oracle in that lane. What it has instead is the
// GRAPH pair — `engine-extracted` against `engine-strangled` — which is the
// identical-code pair the corpus already treats as its self-test: any
// difference there is a harness or splice defect, because the application code
// on both sides is the same bytes minus the manifest's excisions.
//
// ## Why the recording is made at the PIN's deadlines and replayed at the
// profile's
//
// The stall detector fires after 45 s of unchanged output. That is affordable
// ONCE — the scout said "recorded once, or declared unaffordable with the
// number" — and not on every replay, of which a gate does at least two. So the
// live take pays the 45 s and the replays pay 1.8 s, and the cassette still
// matches because the notification's CONTENT is a function of the command and
// the summary, not of when the deadline expired. The scenario is built against
// whichever deadlines are in force (`TimedScenarioSpec.make`), so the harness's
// own wait moves with them; a fixed wait would either cost 56 s per replay or
// send the second turn before the notification existed, and the second failure
// is silent because a turn with no attachment still looks like a turn.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts, makeRunNormalizer, normalizeValue } from "../src/differ.js";
import { scrubRequestBody } from "../src/canonical.js";
import { requireRecordCredential } from "../src/env.js";
import { baselineSeedHash, EMPTY_PRECONDITION, type RecordedPrecondition, type Scenario } from "../src/harness.js";
import { ENGINE_VERSION } from "../src/pin.js";
import { runScenarioOnce } from "../src/runScenario.js";
import { REFORGE_ROOT, enginePath, saveTranscript } from "../src/runTurn.js";
import { entriesOf } from "../src/state.js";
import { W10_TIMED_SCENARIOS, type EffectiveDeadlines } from "./scenarios.js";
import { timedEngine } from "./timed-engine.js";
import { describeProfile, locateTimerChunk, type DeadlineRole } from "./timers.js";

const args = process.argv.slice(2);
const record = args.includes("--record");
const onlyIdx = args.indexOf("--scenario");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
if (onlyIdx >= 0 && (only === undefined || only.startsWith("--"))) {
  console.error("ABORT: --scenario requires a value.");
  process.exit(2);
}
const specs = W10_TIMED_SCENARIOS.filter((s) => (only ? s.tag === only : true));
if (specs.length === 0) {
  console.error(`ABORT: unknown scenario '${only}'. Known: ${W10_TIMED_SCENARIOS.map((s) => s.tag).join(", ")}`);
  process.exit(2);
}

/** The pinned deadlines, derived once from the bundle. */
const PINNED = Object.fromEntries(locateTimerChunk().deadlines.map((d) => [d.role, d.value])) as EffectiveDeadlines;

const cassetteFor = (tag: string) => join(REFORGE_ROOT, "cassettes", `m1-${tag}.jsonl`);
const sidecarFor = (tag: string) => join(REFORGE_ROOT, "cassettes", `m1-${tag}.precondition.json`);

/** Requests as the differ compares them — the same projection `m1/run.ts` applies. */
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

function report(label: string, findings: { path: string; a: unknown; b: unknown }[]): boolean {
  if (findings.length === 0) {
    console.log(`    ${label}: identical`);
    return true;
  }
  console.log(`    ${label}: ${findings.length} difference(s)`);
  for (const f of findings.slice(0, 10)) {
    console.log(`      ${f.path}: ${JSON.stringify(f.a)?.slice(0, 100)}  !=  ${JSON.stringify(f.b)?.slice(0, 100)}`);
  }
  return false;
}

mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });
if (record) requireRecordCredential();

const verdicts: { tag: string; pass: boolean }[] = [];

for (const spec of specs) {
  console.log(`\n━━━ ${spec.tag} — ${spec.title} ━━━`);
  console.log(`  profile: ${describeProfile(spec.timers)}`);
  console.log(`  why not the oracle: ${spec.why}`);
  const cassette = cassetteFor(spec.tag);
  const sidecar = sidecarFor(spec.tag);
  const declared = EMPTY_PRECONDITION;
  const baselineSha256 = baselineSeedHash(ENGINE_VERSION);

  if (record) {
    // THE PIN'S OWN DEADLINES. A recording made against a rewritten engine
    // would be a cassette of a build nothing else runs; the corpus's oracle is
    // the real binary and this take is the closest thing this scenario has to
    // one.
    const s: Scenario = spec.make(PINNED);
    const waitFor = Object.entries(spec.timers).map(([role]) => `${role}=${PINNED[role as DeadlineRole]}ms`).join(", ");
    console.log(`  recording live via engine-real at the PINNED deadlines (${waitFor}) — this take pays the real wait, once ...`);
    const staged = `${cassette}.recording`;
    rmSync(staged, { force: true });
    const rec = await runScenarioOnce({ scenario: s, engineName: "engine-real", mode: "record", cassette: staged, side: "record", precondition: declared, engineB: "engine-strangled" });
    if (!rec.ok) {
      rmSync(staged, { force: true });
      console.log("    DISCARDED: the recording failed its determinism checks — nothing promoted");
      verdicts.push({ tag: spec.tag, pass: false });
      continue;
    }
    const infra = rec.messages.some((m) => {
      const t = (m as { type?: string }).type;
      return t === "reforge-exception" && /rate limit|temporarily limiting|overloaded|502|503|504/i.test(String((m as { message?: unknown }).message ?? ""));
    });
    if (infra) {
      rmSync(staged, { force: true });
      console.log("    DISCARDED: the recording captured an infrastructure failure, not engine behaviour");
      verdicts.push({ tag: spec.tag, pass: false });
      continue;
    }
    const substance = s.check?.(rec.messages, rec.events) ?? null;
    if (substance !== null) {
      // A take in which the DEADLINE never fired is not a recording of this
      // scenario. Promoting it would freeze a cassette that answers a
      // conversation where nothing happened, and every replay after it would
      // grade that.
      rmSync(staged, { force: true });
      console.log(`    DISCARDED: the live take did not exercise the behaviour — ${substance}`);
      verdicts.push({ tag: spec.tag, pass: false });
      continue;
    }
    saveTranscript(`m1-${spec.tag}-record`, { engine: "engine-real", messages: rec.messages, durationMs: 0 });
    renameSync(staged, cassette);
    writeFileSync(sidecar, JSON.stringify({ declared, baselineSha256 } satisfies RecordedPrecondition, null, 2) + "\n");
    console.log(`  recorded ${readFileSync(cassette, "utf8").split("\n").filter(Boolean).length} API exchange(s); sidecar written`);
    verdicts.push({ tag: spec.tag, pass: true });
    continue;
  }

  if (!existsSync(cassette)) {
    console.log(`    REFUSING TO GRADE: no cassette. Record it once: npx tsx w10/timed.ts --record --scenario ${spec.tag}`);
    verdicts.push({ tag: spec.tag, pass: false });
    continue;
  }
  const recorded = existsSync(sidecar) ? (JSON.parse(readFileSync(sidecar, "utf8")) as RecordedPrecondition) : undefined;
  if (recorded === undefined || typeof recorded.baselineSha256 !== "string") {
    console.log("    REFUSING TO GRADE: the cassette has no precondition sidecar, so nothing says what world it answers.");
    verdicts.push({ tag: spec.tag, pass: false });
    continue;
  }
  if (recorded.baselineSha256 !== baselineSha256) {
    console.log(`    REFUSING TO GRADE: the baseline seed has moved since the recording (${recorded.baselineSha256.slice(0, 12)} → ${baselineSha256.slice(0, 12)}).`);
    verdicts.push({ tag: spec.tag, pass: false });
    continue;
  }

  // The two engines, both re-materialized through the identical rewrite so the
  // ONLY difference between them is which splices the strangled one carries.
  const A = timedEngine(spec.timers, "engine-extracted");
  const B = timedEngine(spec.timers, "engine-strangled");
  console.log(`  A=${A.base} ${A.built ? "(built)" : "(cached)"}, B=${B.base} ${B.built ? "(built)" : "(cached)"}; applied ${A.applied.map((x) => `${x.role} ${x.from}→${x.to}`).join(", ")}`);

  const effective: EffectiveDeadlines = { ...PINNED, ...spec.timers };
  const s = spec.make(effective);
  const run = (engine: string, side: string) =>
    runScenarioOnce({ scenario: s, engineName: engine, mode: "replay", cassette, side, precondition: recorded.declared, engineB: "engine-strangled" });

  console.log(`  replaying offline at ${describeProfile(spec.timers)} ...`);
  const a = await run(A.engine, "A");
  const b = await run(B.engine, "B");
  saveTranscript(`m1-${spec.tag}-A`, { engine: A.base, messages: a.messages, durationMs: 0 });
  saveTranscript(`m1-${spec.tag}-B`, { engine: B.base, messages: b.messages, durationMs: 0 });

  const sOk = report(`state (${a.state.roots.map((r) => `${r.entries.length} ${r.name}`).join(", ")} entr${entriesOf(a.state, "sandbox").length === 1 ? "y" : "ies"}, engine ${a.state.engine})`, diffTranscripts([a.state], [b.state]));
  const tOk = report("transcripts", diffTranscripts(a.messages, b.messages));
  const eOk = report("events", diffTranscripts(a.events, b.events));
  const rOk = report(
    "requests",
    diffTranscripts(loadObservedRequests(a.observedFile).map(makeRunNormalizer(a.messages)), loadObservedRequests(b.observedFile).map(makeRunNormalizer(b.messages))),
  );
  const substance = ([["A", s.check?.(a.messages, a.events) ?? null], ["B", s.check?.(b.messages, b.events) ?? null]] as const).filter(([, f]) => f !== null);
  for (const [side, failure] of substance) console.log(`    substance: FAIL [${side}] — ${failure}`);
  if (substance.length === 0) console.log("    substance: ok");
  verdicts.push({ tag: spec.tag, pass: a.ok && b.ok && sOk && tOk && eOk && rOk && substance.length === 0 });
}

console.log("\n=== W10 timed verdicts ===");
for (const v of verdicts) console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.tag}`);
const allPass = verdicts.every((v) => v.pass);
console.log(allPass ? `\nALL PASS${record ? " — recorded" : " — the graph pair agrees at the rewritten deadlines"}` : "\nFAILURES");
process.exitCode = allPass ? 0 : 1;
