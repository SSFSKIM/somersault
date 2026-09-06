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
import { resetSandbox, type Scenario, type ScenarioContext } from "../src/harness.js";
import { startReplayProxy } from "../src/proxy.js";
import { CONFIG_DIR, enginePath, REFORGE_ROOT, SANDBOX } from "../src/runTurn.js";
import { awaitQuiesce, defaultStateRoots } from "../src/state.js";
import { leaksIn, processBaseline, processSnapshot, reapSurvivors, type ProcessSnapshot } from "../src/supervision.js";
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
import { W10_SCENARIOS } from "./scenarios.js";
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
  // This wave's own, so the census covers them the moment they are recorded and
  // the timer control can name one whose Bash command outlives the hint.
  ...W10_SCENARIOS,
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
async function replayWithSupervision(s: Scenario, engine: string): Promise<{ snap: ProcessSnapshot; threw: string | null; reaped: number; dropped: number }> {
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
  const { snapshot: snap, dropped, attributed } = await processSnapshot(baseline, { detached: s.detachedChildren, label: s.tag });
  // Reaped after the snapshot, so the NEXT scenario's baseline is the same world
  // this one started from — and so the census cannot leave an engine child whose
  // `sessions/<pid>` files redden a later config-dir inventory. BY PID: the
  // census runs on a machine that is doing other things, and a command-text
  // sweep reaches processes it never graded (see `reapSurvivors`).
  const reaped = reapSurvivors(attributed);
  await proxy.close();
  return { snap, threw, reaped, dropped };
}

if (phase === "supervision") {
  // ---- the surface's first measurement, over the whole corpus ---------------
  // A CENSUS OF NOTHING IS NOT A PASS. Both ways of reaching zero scenarios —
  // a `--scenario` tag no corpus scenario answers to, and a scope in which none
  // has a cassette yet — used to print "no existing scenario leaks a child",
  // which is the surface's green light and would have been earned by measuring
  // nothing. They ABORT instead, on the same argument `w10/timed.ts` and
  // `w10/record.ts` refuse an unknown tag: a typo must not read as evidence.
  const scoped = CORPUS.filter((s) => (only ? s.tag === only : true));
  if (only !== undefined && scoped.length === 0) {
    console.error(`ABORT: unknown scenario '${only}'. Known: ${CORPUS.map((s) => s.tag).join(", ")}`);
    process.exit(2);
  }
  const targets = scoped.filter((s) => existsSync(cassetteFor(s.tag)));
  const missing = scoped.length - targets.length;
  if (targets.length === 0) {
    console.error(`ABORT: none of the ${scoped.length} scenario(s) in scope has a cassette, so there is nothing to census.`);
    process.exit(2);
  }
  console.log(`=== supervision census: ${targets.length} scenario(s) with a cassette${missing > 0 ? `, ${missing} skipped for having none` : ""} ===`);
  console.log("  (offline replays on engine-real; every survivor is a process the run left behind)\n");

  const rows: { tag: string; survivors: number; leaks: number; dropped: number; detail: string }[] = [];
  for (const s of targets) {
    const { snap, threw, reaped, dropped } = await replayWithSupervision(s, enginePath("engine-real"));
    const leaks = leaksIn(snap);
    rows.push({
      tag: s.tag,
      survivors: snap.survivors.length,
      leaks: leaks.length,
      dropped,
      detail: snap.survivors.map((x) => `${x.declared === null ? "LEAK" : "declared"} ${x.command.slice(0, 70)}`).join(" | "),
    });
    const mark = leaks.length > 0 ? "LEAK" : snap.survivors.length > 0 ? "declared" : "clean";
    console.log(`  ${mark.padEnd(9)} ${s.tag.padEnd(28)} ${snap.survivors.length} survivor(s)${reaped > 0 ? `, ${reaped} reaped` : ""}${threw ? ` [run threw: ${threw}]` : ""}`);
    for (const x of snap.survivors) console.log(`      ${x.declared === null ? "LEAK    " : "declared"} ${x.orphaned ? "orphan " : "child  "} ${x.command.slice(0, 110)}`);
  }

  // HOW NOISY THE MACHINE WAS, which is what says whether the drop rule is
  // load-bearing or decorative. Counted from the surface's own reports rather
  // than asserted: every one of these is a process that appeared during a
  // scenario and could not be tied to it by lineage, cwd or command.
  const droppedTotal = rows.reduce((n, r) => n + r.dropped, 0);
  console.log(`  (${droppedTotal} unattributable new process(es) were dropped across the ${rows.length} scenario(s) — the drop rule's load on this machine)`);

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
    console.error(`ABORT: no cassette for '${tag}' — record it first: npx tsx w10/record.ts --scenario ${tag}`);
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

  const arm = async (label: string, profile: TimerProfile): Promise<{ msgs: unknown[]; threw: string | null }> => {
    const engine = timedEngine(profile, "engine-extracted");
    console.log(`\n-- ${label}: ${describeProfile(profile)} ${engine.built ? "(built)" : "(cached)"} --`);
    const proxy = await startReplayProxy(cassetteFor(tag), join(REFORGE_ROOT, "cassettes", `w10-measure-observed-${label}.jsonl`));
    const ctx: ScenarioContext = { engine: engine.engine, baseUrl: `http://127.0.0.1:${proxy.port}`, collect: () => {}, mode: "replay" };
    resetSandbox(s.precondition);
    let msgs: unknown[] = [];
    let threw: string | null = null;
    try {
      msgs = await s.run(ctx);
    } catch (e) {
      threw = String((e as Error).message).slice(0, 120);
      console.log(`  (run threw: ${threw})`);
    }
    await awaitQuiesce(defaultStateRoots(SANDBOX, CONFIG_DIR));
    await proxy.close();
    return { msgs, threw };
  };

  /** The frame the hint OWNS: the engine registers the task and says so. */
  const startedIn = (msgs: readonly unknown[]): number =>
    msgs.filter((m) => (m as { type?: string }).type === "system" && (m as { subtype?: string }).subtype === "task_started").length;

  const a = await arm("control", CONTROL);
  const b = await arm("perturbed", PERTURBED);

  const findings = diffTranscripts(a.msgs, b.msgs);
  console.log(`\n--- results ---`);
  console.log(`  control produced ${a.msgs.length} message(s), perturbed ${b.msgs.length}`);
  console.log(`  ${findings.length} difference(s) between the two arms`);
  for (const f of findings.slice(0, 12)) {
    console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 110)}  !=  ${JSON.stringify(f.b)?.slice(0, 110)}`);
  }

  // THE NAMED CHANGE, not merely A change. "The arms differ" is satisfied by a
  // replay that fell over on one side, by a clock that leaked into a message, by
  // a proxy served out of order — none of which is the hint moving, and a
  // control that would pass on them is not evidence for the claim it prints. So
  // both arms must have COMPLETED, and the difference must be the frame this
  // deadline owns: shortening the gate makes the command auto-background, and
  // the engine emits one more `system`/`task_started` than the pinned arm does.
  const startedA = startedIn(a.msgs);
  const startedB = startedIn(b.msgs);
  console.log(`  task_started frames: control ${startedA}, perturbed ${startedB}`);
  const completed = a.threw === null && b.threw === null;
  const ok = completed && startedB > startedA;
  console.log(
    ok
      ? `\nPASS — moving ONE constant (${pinned.role}: ${pinnedValue} → 300 ms) makes the command auto-background: ${startedB - startedA} more task_started frame(s), inside ${findings.length} moved field(s)`
      : !completed
        ? `\nFAIL — an arm did not complete (control: ${a.threw ?? "ok"}; perturbed: ${b.threw ?? "ok"}), so the two transcripts are not a comparison of the deadline.`
        : `\nFAIL — the perturbed arm did not background sooner (task_started ${startedA} → ${startedB}). Either the command finishes before ${pinnedValue} ms (choose one that does not) or the hint does not reach this lane (report which).`,
  );
  process.exitCode = ok ? 0 : 1;
} else {
  console.error(`unknown --phase ${phase} (supervision | timer)`);
  process.exitCode = 2;
}
