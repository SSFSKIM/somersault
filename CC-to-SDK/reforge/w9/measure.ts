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
import { defaultStateRoots, entriesOf, stateSnapshot, type StateEntry } from "../src/state.js";
import { enginePath, REFORGE_ROOT, SANDBOX } from "../src/runTurn.js";
import { SCENARIOS } from "../m1/scenarios.js";

const args = process.argv.slice(2);
const phase = args.includes("--phase") ? args[args.indexOf("--phase") + 1] : "flush";
const runs = args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 5;
const TAG = "resume"; // the corpus's storage-bearing scenario: writes a session, then resumes it
const scenario = SCENARIOS.find((s) => s.tag === TAG)!;
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

async function once(seedBaseline: boolean): Promise<{ entries: StateEntry[]; raw: ReturnType<typeof rawTranscripts> }> {
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
  };
  try {
    await scenario.run(ctx);
  } catch (e) {
    console.log(`  (run threw: ${(e as Error).message.slice(0, 120)})`);
  }
  const raw = rawTranscripts();
  const entries = entriesOf(snapshotNow(), "config");
  await proxy.close();
  return { entries, raw };
}

/** Two config snapshots, compared the way the corpus runner compares them (own-map normalization per side). */
const same = (a: unknown[], b: unknown[]): boolean =>
  diffTranscripts([makeRunNormalizer(a)(a)], [makeRunNormalizer(b)(b)]).length === 0;

if (phase === "flush") {
  console.log(`=== flush schedule: ${runs} replays of '${TAG}' on engine-real, config reset before each ===`);
  const takes: { entries: StateEntry[]; raw: ReturnType<typeof rawTranscripts> }[] = [];
  for (let i = 0; i < runs; i++) {
    takes.push(await once(true));
    const t = takes[i];
    console.log(`  take ${i + 1}: ${t.raw.length} transcript file(s), ${t.raw.map((r) => r.bytes).join("/")} bytes, ${t.entries.length} config entries`);
  }
  const rawByteSets = new Set(takes.map((t) => JSON.stringify(t.raw.map((r) => r.bytes).sort())));
  const rawHashSets = new Set(takes.map((t) => JSON.stringify(t.raw.map((r) => r.sha256).sort())));
  const recordCounts = new Set(
    takes.map((t) => JSON.stringify(t.entries.filter((e) => e.records).map((e) => e.records!.length).sort())),
  );
  const snapshotStable = takes.every((t) => same(takes[0].entries, t.entries));
  console.log("\n--- results ---");
  console.log(`  raw sha256 identical across takes: ${rawHashSets.size === 1 ? "YES" : `NO (${rawHashSets.size} distinct)`}`);
  console.log(`  raw byte LENGTHS identical:        ${rawByteSets.size === 1 ? "YES" : `NO (${rawByteSets.size} distinct: ${[...rawByteSets].join(" | ")})`}`);
  console.log(`  record COUNTS identical:           ${recordCounts.size === 1 ? "YES" : `NO (${recordCounts.size} distinct: ${[...recordCounts].join(" | ")})`}`);
  console.log(`  PROJECTED config snapshot stable:  ${snapshotStable ? "YES" : "NO"}`);
  if (!snapshotStable) {
    for (let i = 1; i < takes.length; i++) {
      const d = diffTranscripts([makeRunNormalizer(takes[0].entries)(takes[0].entries)], [makeRunNormalizer(takes[i].entries)(takes[i].entries)]);
      for (const f of d.slice(0, 5)) console.log(`    take1 vs take${i + 1} ${f.path}: ${JSON.stringify(f.a)?.slice(0, 90)} != ${JSON.stringify(f.b)?.slice(0, 90)}`);
    }
  }
  process.exitCode = snapshotStable ? 0 : 1;
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
