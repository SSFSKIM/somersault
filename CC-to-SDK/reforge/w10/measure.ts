// C13c / W10c — the two measurements this wave owes, taken with the machinery
// it built rather than reasoned about.
//
//   npx tsx w10/measure.ts --phase supervision   # does any EXISTING scenario leak a child?
//   npx tsx w10/measure.ts --phase timer         # the timer knob's negative control
//
// ## Why the supervision census comes BEFORE the surface is graded
//
// Adding a member to the state snapshot makes it part of every scenario's
// verdict at once. If the corpus already leaves processes behind — a
// backgrounded agent, an `npm` the seed forgot, a shell the engine reaps late —
// then wiring it in first would turn a measurement into 63 red scenarios and
// the wave would spend its time undoing that instead of reading it. So the
// census runs the corpus through the surface WITHOUT grading it, and the number
// it produces is what says whether the surface can be switched on.
//
// ## Why the timer control is TWO REWRITTEN engines and not rewritten-vs-base
//
// The claim is "moving this constant moves the behaviour", and the honest
// comparison holds everything else fixed. A rewritten engine against the base
// graph differs by the rewrite MACHINERY as well as by the value — a copied
// tree, re-pointed specifiers, a fresh boot — so a difference would have two
// candidate causes. Both arms here are re-materialized copies that went through
// the identical rewrite; one carries the pinned value written back verbatim,
// the other the perturbed one. The only difference between them is the number.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts } from "../src/differ.js";
import { baseOptions, resetSandbox, type Scenario, type ScenarioContext } from "../src/harness.js";
import { startReplayProxy } from "../src/proxy.js";
import { CONFIG_DIR, enginePath, REFORGE_ROOT, SANDBOX } from "../src/runTurn.js";
import { awaitQuiesce, defaultStateRoots } from "../src/state.js";
import { leaksIn, processBaseline, processSnapshot, type ProcessSnapshot } from "../src/supervision.js";
import { SCENARIOS as M1_SCENARIOS } from "../m1/scenarios.js";
import { M2C_SCENARIOS } from "../m2c/scenarios.js";
import { M3_SCENARIOS } from "../m3/scenarios.js";
import { W1_SCENARIOS } from "../w1/scenarios.js";
import { W2_SCENARIOS } from "../w2/scenarios.js";
import { W3_SCENARIOS } from "../w3/scenarios.js";
import { W4_SCENARIOS } from "../w4/scenarios.js";
import { W5_SCENARIOS } from "../w5/scenarios.js";
import { W6_SCENARIOS } from "../w6/scenarios.js";
import { W9_SCENARIOS } from "../w9/scenarios.js";
import { timedEngine } from "./timed-engine.js";
import { DEADLINES, describeProfile, locateTimerChunk, type TimerProfile } from "./timers.js";

const CORPUS: Scenario[] = [
  ...M1_SCENARIOS,
  ...M2C_SCENARIOS,
  ...M3_SCENARIOS,
  ...W1_SCENARIOS,
  ...W2_SCENARIOS,
  ...W3_SCENARIOS,
  ...W4_SCENARIOS,
  ...W5_SCENARIOS,
  ...W6_SCENARIOS,
  ...W9_SCENARIOS,
];

const args = process.argv.slice(2);
const phase = args.includes("--phase") ? args[args.indexOf("--phase") + 1] : "supervision";
const only = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : undefined;
const cassetteFor = (tag: string) => join(REFORGE_ROOT, "cassettes", `m1-${tag}.jsonl`);

/**
 * One offline replay, with a process snapshot around it.
 *
 * Deliberately NOT `runScenarioOnce`: that is the graded path, and this is the
 * measurement that decides whether the surface belongs in it. Threading a
 * measurement flag through the graded runner would have made the census depend
 * on the thing it is measuring.
 */
async function replayWithSupervision(s: Scenario, engine: string): Promise<{ snap: ProcessSnapshot; threw: string | null }> {
  const cassette = cassetteFor(s.tag);
  const proxy = await startReplayProxy(cassette, join(REFORGE_ROOT, "cassettes", "w10-measure-observed-A.jsonl"));
  const ctx: ScenarioContext = {
    engine,
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: () => {},
    mode: "replay",
  };
  resetSandbox(s.precondition);
  const baseline = processBaseline();
  let threw: string | null = null;
  try {
    await s.run(ctx);
  } catch (e) {
    threw = String((e as Error).message).slice(0, 120);
  }
  const q = await awaitQuiesce(defaultStateRoots(SANDBOX, CONFIG_DIR));
  if (!q.settled) console.log("    (never quiesced)");
  const snap = await processSnapshot(baseline, { detached: s.detachedChildren, label: s.tag });
  await proxy.close();
  return { snap, threw };
}

if (phase === "supervision") {
  // ---- the surface's first measurement, over the whole corpus ---------------
  const targets = CORPUS.filter((s) => (only ? s.tag === only : true)).filter((s) => existsSync(cassetteFor(s.tag)));
  const missing = CORPUS.filter((s) => (only ? s.tag === only : true)).length - targets.length;
  console.log(`=== supervision census: ${targets.length} scenario(s) with a cassette${missing > 0 ? `, ${missing} skipped for having none` : ""} ===`);
  console.log("  (offline replays on engine-real; every survivor is a process the run left behind)\n");

  const rows: { tag: string; survivors: number; leaks: number; detail: string }[] = [];
  for (const s of targets) {
    const { snap, threw } = await replayWithSupervision(s, enginePath("engine-real"));
    const leaks = leaksIn(snap);
    rows.push({
      tag: s.tag,
      survivors: snap.survivors.length,
      leaks: leaks.length,
      detail: snap.survivors.map((x) => `${x.declared === null ? "LEAK" : "declared"} ${x.command.slice(0, 70)}`).join(" | "),
    });
    const mark = leaks.length > 0 ? "LEAK" : snap.survivors.length > 0 ? "declared" : "clean";
    console.log(`  ${mark.padEnd(9)} ${s.tag.padEnd(28)} ${snap.survivors.length} survivor(s)${threw ? ` [run threw: ${threw}]` : ""}`);
    for (const x of snap.survivors) console.log(`      ${x.declared === null ? "LEAK    " : "declared"} ${x.orphaned ? "orphan " : "child  "} ${x.command.slice(0, 110)}`);
  }

  const leaking = rows.filter((r) => r.leaks > 0);
  console.log(`\n=== ${rows.length} scenario(s) measured: ${leaking.length} leak a child, ${rows.filter((r) => r.survivors > 0 && r.leaks === 0).length} leave a DECLARED one ===`);
  for (const r of leaking) console.log(`  LEAK  ${r.tag}: ${r.detail}`);
  console.log(
    leaking.length === 0
      ? "PASS — no existing scenario leaves an undeclared process behind, so the surface can be graded without re-declaring the corpus"
      : `FAIL — ${leaking.length} scenario(s) leave an undeclared process; each needs a declaration or a finding before the surface is graded`,
  );
  process.exitCode = leaking.length === 0 ? 0 : 1;
} else if (phase === "timer") {
  // ---- the negative control: a perturbed timer moves the background hint ----
  const tag = only ?? "bash-timeout-background";
  const s = CORPUS.find((x) => x.tag === tag);
  if (s === undefined) {
    console.error(`ABORT: unknown scenario '${tag}' — the timer control needs a recorded scenario whose Bash command outlives the hint`);
    process.exit(2);
  }
  if (!existsSync(cassetteFor(tag))) {
    console.error(`ABORT: no cassette for '${tag}' — record it first: npx tsx m1/run.ts --scenario ${tag}`);
    process.exit(2);
  }
  const pinned = DEADLINES.find((d) => d.role === "background-hint")!;
  const pinnedValue = locateTimerChunk().deadlines.find((d) => d.role === "background-hint")!.value;
  const CONTROL: TimerProfile = { "background-hint": pinnedValue };
  const PERTURBED: TimerProfile = { "background-hint": 300 };

  console.log(`=== the background hint's negative control, on '${tag}' ===`);
  console.log(`  the deadline: ${pinned.effect}`);
  console.log(`  arm A (control):   ${describeProfile(CONTROL)} — the pinned value, written back through the same rewrite`);
  console.log(`  arm B (perturbed): ${describeProfile(PERTURBED)}`);

  const arm = async (label: string, profile: TimerProfile): Promise<unknown[]> => {
    const engine = timedEngine(profile, "engine-extracted");
    console.log(`\n-- ${label}: ${describeProfile(profile)} ${engine.built ? "(built)" : "(cached)"} --`);
    const proxy = await startReplayProxy(cassetteFor(tag), join(REFORGE_ROOT, "cassettes", `w10-measure-observed-${label}.jsonl`));
    const ctx: ScenarioContext = { engine: engine.engine, baseUrl: `http://127.0.0.1:${proxy.port}`, collect: () => {}, mode: "replay" };
    resetSandbox(s.precondition);
    let msgs: unknown[] = [];
    try {
      msgs = await s.run(ctx);
    } catch (e) {
      console.log(`  (run threw: ${String((e as Error).message).slice(0, 120)})`);
    }
    await awaitQuiesce(defaultStateRoots(SANDBOX, CONFIG_DIR));
    await proxy.close();
    return msgs;
  };

  // `baseOptions` is referenced so a future reader sees the arms share the
  // corpus's own options; the scenario builds them itself.
  void baseOptions;
  const a = await arm("control", CONTROL);
  const b = await arm("perturbed", PERTURBED);

  const findings = diffTranscripts(a, b);
  console.log(`\n--- results ---`);
  console.log(`  control produced ${a.length} message(s), perturbed ${b.length}`);
  console.log(`  ${findings.length} difference(s) between the two arms`);
  for (const f of findings.slice(0, 12)) {
    console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 110)}  !=  ${JSON.stringify(f.b)?.slice(0, 110)}`);
  }
  const ok = findings.length > 0;
  console.log(
    ok
      ? `\nPASS — moving ONE constant (${pinned.role}: ${pinnedValue} → 300 ms) moves the graded output; the fields above are which`
      : `\nFAIL — the two arms are identical, so the rewrite is grading nothing on this scenario. Either the command finishes before ${pinnedValue} ms (choose one that does not) or the hint does not reach this lane (report which).`,
  );
  process.exitCode = ok ? 0 : 1;
} else {
  console.error(`unknown --phase ${phase} (supervision | timer)`);
  process.exitCode = 2;
}
