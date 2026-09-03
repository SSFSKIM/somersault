// C12a/W9a — the two measurements the cut said to take before deciding, taken
// with the machinery this wave built rather than by reasoning about it.
//
//   npx tsx w9/measure.ts --phase flush      # the 100 ms drain: is the stored transcript stable?
//   npx tsx w9/measure.ts --phase first-run  # does a run against an EMPTY config dir differ from the next one?
//
// Both replay one storage-bearing scenario offline, so neither needs a
// credential and neither is a recording.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts, makeRunNormalizer } from "../src/differ.js";
import { baseOptions, CONFIG_DIR, drive, resetSandbox, type ScenarioContext } from "../src/harness.js";
import { emptyPreconditionFor } from "../src/precondition.js";
import { ENGINE_VERSION } from "../src/pin.js";
import { startReplayProxy } from "../src/proxy.js";
import { awaitQuiesce, defaultStateRoots, entriesOf, stateSnapshot, type StateEntry } from "../src/state.js";
import { enginePath, REFORGE_ROOT, SANDBOX } from "../src/runTurn.js";
import { SCENARIOS as M1_SCENARIOS } from "../m1/scenarios.js";
import { M2C_SCENARIOS } from "../m2c/scenarios.js";
import { M3_SCENARIOS } from "../m3/scenarios.js";
import { W1_SCENARIOS } from "../w1/scenarios.js";
import { W2_SCENARIOS } from "../w2/scenarios.js";
import { W3_SCENARIOS } from "../w3/scenarios.js";
import { W4_SCENARIOS } from "../w4/scenarios.js";
import { W5_SCENARIOS } from "../w5/scenarios.js";
import { W6_SCENARIOS } from "../w6/scenarios.js";

const SCENARIOS = [...M1_SCENARIOS, ...M2C_SCENARIOS, ...M3_SCENARIOS, ...W1_SCENARIOS, ...W2_SCENARIOS, ...W3_SCENARIOS, ...W4_SCENARIOS, ...W5_SCENARIOS, ...W6_SCENARIOS];

const args = process.argv.slice(2);
const phase = args.includes("--phase") ? args[args.indexOf("--phase") + 1] : "flush";
const runs = args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 5;
// The scenario under measurement. `resume` writes a session and resumes it (the
// storage-bearing scenario by construction); `compact-continue` is the LONG one,
// and the two answer different questions — see the wave record.
const TAG = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : phase === "flush" ? "compact-continue" : "resume";
const scenario = SCENARIOS.find((s) => s.tag === TAG);
if (scenario === undefined) {
  console.error(`ABORT: unknown scenario '${TAG}'`);
  process.exit(2);
}
const cassette = join(REFORGE_ROOT, "cassettes", `m1-${TAG}.jsonl`);
if (!existsSync(cassette)) {
  console.error(`ABORT: cassette missing — run: npx tsx m1/run.ts --scenario ${TAG}`);
  process.exit(2);
}

/** The raw bytes of every stored transcript, as sha256 + length — what "byte-stable" literally means. */
function rawTranscripts(): { path: string; bytes: number; sha256: string }[] {
  return entriesOf(snapshotNow(), "config")
    .filter((e) => e.path.endsWith(".jsonl"))
    .map((e) => {
      const buf = readFileSync(join(CONFIG_DIR, e.path));
      return { path: e.path, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
    });
}

const snapshotNow = () => stateSnapshot(defaultStateRoots(SANDBOX, CONFIG_DIR), []);

async function once(seedBaseline: boolean, eagerFlush = true): Promise<{ entries: StateEntry[]; raw: ReturnType<typeof rawTranscripts> }> {
  resetSandbox(seedBaseline ? {} : { seed: [] });
  if (!seedBaseline) {
    // The unseeded arm: take the baseline back out, so the engine meets a
    // genuinely empty config dir and mints its own first-run state.
    rmSync(join(CONFIG_DIR, ".claude.json"), { force: true });
  }
  const proxy = await startReplayProxy(cassette, join(REFORGE_ROOT, "cassettes", `w9-measure-observed.jsonl`));
  const ctx: ScenarioContext = {
    engine: enginePath("engine-real"),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: () => {},
    mode: "replay",
    knobs: { eagerFlush },
  };
  try {
    await scenario!.run(ctx);
  } catch (e) {
    console.log(`  (run threw: ${(e as Error).message.slice(0, 120)})`);
  }
  const q = await awaitQuiesce(defaultStateRoots(SANDBOX, CONFIG_DIR));
  if (!q.settled) console.log("  (never quiesced)");
  const raw = rawTranscripts();
  const entries = entriesOf(snapshotNow(), "config");
  await proxy.close();
  return { entries, raw };
}

/** Two config snapshots, compared the way the corpus runner compares them (own-map normalization per side). */
const same = (a: unknown[], b: unknown[]): boolean =>
  diffTranscripts([makeRunNormalizer(a)(a)], [makeRunNormalizer(b)(b)]).length === 0;

if (phase === "flush") {
  // BOTH ARMS, and the contrast is the point: a determinism knob whose absence
  // changes nothing would be grading nothing (the cut's own condition for
  // branch (c)).
  const arm = async (eager: boolean) => {
    const takes: { entries: StateEntry[]; raw: ReturnType<typeof rawTranscripts> }[] = [];
    for (let i = 0; i < runs; i++) {
      takes.push(await once(true, eager));
      const t = takes[i];
      console.log(`  ${eager ? "eager " : "timer "} take ${i + 1}: ${t.raw.map((r) => r.bytes).join("/")} bytes, ${t.entries.filter((e) => e.records).map((e) => e.records!.length).join("/")} record(s)`);
    }
    return {
      takes,
      rawHashes: new Set(takes.map((t) => JSON.stringify(t.raw.map((r) => r.sha256).sort()))).size,
      rawBytes: new Set(takes.map((t) => JSON.stringify(t.raw.map((r) => r.bytes).sort()))).size,
      counts: new Set(takes.map((t) => JSON.stringify(t.entries.filter((e) => e.records).map((e) => e.records!.length).sort()))).size,
      stable: takes.every((t) => same(takes[0].entries, t.entries)),
    };
  };
  console.log(`=== flush schedule: ${runs} replays of '${TAG}' on engine-real, per arm, config reset before each ===`);
  console.log(`\n-- arm ON: CLAUDE_CODE_EAGER_FLUSH=1 (the harness default) --`);
  const on = await arm(true);
  console.log(`\n-- arm OFF: the engine's own 100 ms drain — THE NEGATIVE CONTROL --`);
  const off = await arm(false);

  console.log("\n--- results ---");
  for (const [label, a] of [["eager (default)", on], ["timer (control)", off]] as const) {
    console.log(`  ${label}: raw sha256 sets ${a.rawHashes}, byte-length sets ${a.rawBytes}, record-count sets ${a.counts}, projected snapshot ${a.stable ? "STABLE" : "UNSTABLE"}`);
  }
  if (!on.stable) {
    for (let i = 1; i < on.takes.length; i++) {
      for (const f of diffTranscripts([makeRunNormalizer(on.takes[0].entries)(on.takes[0].entries)], [makeRunNormalizer(on.takes[i].entries)(on.takes[i].entries)]).slice(0, 5)) {
        console.log(`    take1 vs take${i + 1} ${f.path}: ${JSON.stringify(f.a)?.slice(0, 90)} != ${JSON.stringify(f.b)?.slice(0, 90)}`);
      }
    }
  }
  // The raw sha256 never matches and is not expected to: every record carries a
  // fresh session uuid, a fresh promptId and a millisecond clock, which is why
  // the surface projects rather than hashes. What must be stable is the byte
  // LENGTH, the record COUNT and the projected snapshot.
  const ok = on.stable && on.counts === 1 && !off.stable;
  console.log(
    ok
      ? `\nPASS — with the drain forced the snapshot is stable across ${runs} replays, and WITHOUT it the same ${runs} replays disagree (the control fires)`
      : !on.stable
        ? "\nFAIL — the snapshot is still unstable WITH the eager drain: branch (c) is not sufficient either"
        : "\nFAIL — the negative control did not fire: the 100 ms drain produced a stable snapshot too, so this knob is grading nothing on this scenario",
  );
  process.exitCode = ok ? 0 : 1;
} else if (phase === "first-run") {
  console.log("=== first-run behaviour: does the run after a TOTAL wipe differ from the next one? ===");
  console.log(`\n-- arm A: genuinely empty config dir (no baseline seed), twice --`);
  const u1 = await once(false);
  const u2 = await once(false);
  console.log(`  entries: ${u1.entries.length} / ${u2.entries.length}`);
  const unseededStable = same(u1.entries, u2.entries);
  console.log(`  two unseeded runs agree: ${unseededStable ? "YES" : "NO"}`);
  if (!unseededStable) {
    for (const f of diffTranscripts([makeRunNormalizer(u1.entries)(u1.entries)], [makeRunNormalizer(u2.entries)(u2.entries)]).slice(0, 8)) {
      console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 90)} != ${JSON.stringify(f.b)?.slice(0, 90)}`);
    }
  }
  console.log(`\n-- arm B: the EMPTY precondition's baseline seed (${JSON.stringify(Object.keys(JSON.parse(emptyPreconditionFor(ENGINE_VERSION).seed![0].content)))}), twice --`);
  const s1 = await once(true);
  const s2 = await once(true);
  console.log(`  entries: ${s1.entries.length} / ${s2.entries.length}`);
  const seededStable = same(s1.entries, s2.entries);
  console.log(`  two seeded runs agree: ${seededStable ? "YES" : "NO"}`);
  if (!seededStable) {
    for (const f of diffTranscripts([makeRunNormalizer(s1.entries)(s1.entries)], [makeRunNormalizer(s2.entries)(s2.entries)]).slice(0, 8)) {
      console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 90)} != ${JSON.stringify(f.b)?.slice(0, 90)}`);
    }
  }
  console.log(`\n-- what the seed changes: paths present in one arm and not the other --`);
  const setOf = (e: StateEntry[]) => new Set(e.map((x) => x.path.replace(/[0-9a-f-]{36}/g, "<uuid>")));
  const [U, S] = [setOf(u1.entries), setOf(s1.entries)];
  console.log(`  unseeded only: ${[...U].filter((p) => !S.has(p)).join(", ") || "(none)"}`);
  console.log(`  seeded only:   ${[...S].filter((p) => !U.has(p)).join(", ") || "(none)"}`);
  process.exitCode = seededStable ? 0 : 1;
} else {
  console.error(`unknown --phase ${phase}`);
  process.exitCode = 2;
}
