// test/unit/peer/arrival-log-race.test.ts — the marker count's one real claim, measured across OPERATING
// SYSTEM PROCESSES: `logged` may over-report, and must never come out short.
//
// Its sibling `arrival-log.test.ts` drives the contended paths through an injected `renameSync` seam, which
// is the right instrument for "what does this store DO when a competitor writes here" — but a seam cannot
// produce the interleave this file exists for. Stale-lock recovery is a JUDGMENT followed by a DELETE, and
// the defect is that another writer's fresh claim can land between the two and be destroyed by a judgment
// that was never about it. Both writers then enter the marker read-modify-write, both derive `dropped` from
// the same base, and the loser's bytes are identical to the winner's — no read-back can see it, and the
// session's history silently certifies itself complete.
//
// So the racers below are real `node` processes running the REAL compiled store, and the corpse they
// contend over is made the way production makes one: a writer SIGKILLed while it holds the lock. What is
// amplified is only how OFTEN they meet one — the leftover is snapshotted from that real death and cloned
// into every trial directory, so each trial puts every racer on the break path at the same instant instead
// of waiting for a crash to coincide with contention on its own. Nothing about the lock's shape is assumed:
// the clone is whatever bytes (or directory) the store's own acquire path left behind.
//
// The assertion is the invariant and nothing narrower: for each trial, either the count grew by exactly the
// number of appends, or the session says it is degraded. A short count with nothing to show for it is the
// failure this file names.
import { describe, it, expect } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARRIVAL_LOG_CAP, contentHash16, fsArrivalStore, type ArrivalEntry } from "../../../src/peer/arrivalLog.js";

const harnessRoot = fileURLToPath(new URL("../../../", import.meta.url));
const mkTmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

const TRIALS = 200;
const RACERS = 12;
const STEP_MS = 40;       // one racer's append, the store's 40ms lock budget included
/** The store's own `LOCK_STALE_MS` plus a margin, paid ONCE: the corpse is aged before it is cloned, so
 *  every clone is born already older than the lease. */
const AGE_MS = 5_000 + 400;
const LONG_AGO = Date.now() - 600_000;

/** Plain `node` cannot import TypeScript on every version this package supports, so the REAL module is
 *  compiled once with the repo's own tsc — never re-implemented in the child, which would measure a copy.
 *  (Same shape and same reason as appserver/config-lock-race.test.ts.) */
function compileStoreToJs(): string {
  const out = mkTmp("m9arrjs-");
  try {
    execFileSync(process.execPath, [
      join(harnessRoot, "node_modules", "typescript", "bin", "tsc"),
      join(harnessRoot, "src", "peer", "arrivalLog.ts"),
      "--module", "nodenext", "--target", "es2022", "--skipLibCheck",
      "--rootDir", join(harnessRoot, "src"), "--outDir", out,
    ], { stdio: "pipe", cwd: harnessRoot });
  } catch (e) {
    throw new Error(`tsc failed compiling arrivalLog.ts:\n${(e as { stdout?: Buffer }).stdout ?? "(no output)"}`);
  }
  writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(out, "corpse.mjs"), CORPSE_SRC);
  writeFileSync(join(out, "racer.mjs"), RACER_SRC);
  return out;
}

/** THE CORPSE-MAKER. It appends in a loop, so the lock is held for most of its wall clock; the parent
 *  SIGKILLs it and keeps the leftover. Nothing here simulates a crash — the process really is gone
 *  mid-section, which is the only way to get a leftover whose SHAPE is the acquire path's own. */
const CORPSE_SRC = `import { fsArrivalStore } from "./peer/arrivalLog.js";
const [root] = process.argv.slice(2);
const store = fsArrivalStore(root);
for (let i = 0; ; i++) store.append({
  v: 1, id: "c" + String(i).padStart(5, "0"), sessionId: "corpse", anchor: null, seq: i,
  observedAt: new Date().toISOString(), origin: { kind: "peer" }, text: "m" + i,
});
`;

/** A racer: one append per trial, every racer on the same wall clock, so all of them meet the trial's
 *  leftover inside the same handful of microseconds. `parked` is sampled BEFORE the wait, so it answers
 *  "was this process waiting when the barrier lifted" rather than the weaker "did it start". */
const RACER_SRC = `import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fsArrivalStore } from "./peer/arrivalLog.js";
const [root, ready, go, trialsRaw, stepRaw, meRaw] = process.argv.slice(2);
const trials = Number(trialsRaw), step = Number(stepRaw), me = Number(meRaw);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(ready, existsSync(go) ? "late" : "parked");
while (!existsSync(go)) await sleep(2);
const startMs = Number(readFileSync(go, "utf8"));
const store = fsArrivalStore(root);
for (let i = 0; i < trials; i++) {
  // COARSE, then EXACT. A timer wake is quantised to the platform's own granularity and spreads the
  // racers over milliseconds — orders of magnitude wider than the window this file is about. The spin
  // costs a few milliseconds of CPU and puts every racer into the store within microseconds.
  const at = startMs + i * step;
  const coarse = at - 5 - Date.now();
  if (coarse > 0) await sleep(coarse);
  while (Date.now() < at) { /* the barrier's last few milliseconds, spent precisely */ }
  try {
    store.append({
      v: 1, id: "r" + me, sessionId: "t" + i, anchor: null, seq: 900000 + me,
      observedAt: new Date().toISOString(), origin: { kind: "peer" }, text: "racer " + me,
    });
  } catch { /* the parent reads the store, not us */ }
}
`;

/** Whatever the acquire path left behind, copied verbatim — a file's bytes or a directory's children. The
 *  test never spells the lock's shape, so it keeps measuring the same property when the shape changes. */
type LockShape = { file: Buffer } | { children: Array<{ name: string; body: Buffer }> };
const snapshotLock = (path: string): LockShape =>
  lstatSync(path).isDirectory()
    ? { children: readdirSync(path).map((name) => ({ name, body: readFileSync(join(path, name)) })) }
    : { file: readFileSync(path) };
const plantLock = (path: string, shape: LockShape): void => {
  if ("file" in shape) writeFileSync(path, shape.file, { mode: 0o600 });
  else {
    mkdirSync(path, { mode: 0o700 });
    for (const c of shape.children) writeFileSync(join(path, c.name), c.body, { mode: 0o600 });
  }
  utimesSync(path, LONG_AGO / 1000, LONG_AGO / 1000);
};

const filler = (sid: string, n: number): ArrivalEntry => ({
  v: 1, id: `f${String(n).padStart(4, "0")}`, sessionId: sid,
  anchor: { afterUuid: `u${n}`, prevUuid: null, fp: { type: "user", hash: contentHash16(`row${n}`) } },
  seq: n, observedAt: new Date().toISOString(), origin: { kind: "peer" }, text: `m${n}`,
});

describe("the arrival count across processes", () => {
  it("never comes out short when several writers break the same corpse's lock", async () => {
    const js = compileStoreToJs();
    const root = mkTmp("m9arr-");

    // 1. A real death, mid-section. Retried because a kill that misses the lock leaves nothing to clone.
    const corpseRoot = mkTmp("m9corpse-");
    const lockPath = join(corpseRoot, "corpse", ".marker.lock");
    for (let attempt = 0; attempt < 6 && !existsSync(lockPath); attempt++) {
      const maker = spawn(process.execPath, [join(js, "corpse.mjs"), corpseRoot], { stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 250));
      maker.kill("SIGKILL");
      await new Promise((r) => maker.on("exit", r));
    }
    expect(existsSync(lockPath)).toBe(true);   // the fixture is a crashed holder, or it is nothing

    // 2. Age it past the lease ONCE, then snapshot: a clone of an aged corpse is aged wherever it lands,
    //    however the lock records its own age.
    await new Promise((r) => setTimeout(r, AGE_MS));
    const shape = snapshotLock(lockPath);

    // 3. One session per trial: filled to the cap so every racer's append evicts (which is the only thing
    //    that touches the marker at all), then handed the cloned corpse.
    const setup = fsArrivalStore(root);
    const before: number[] = [];
    for (let i = 0; i < TRIALS; i++) {
      const sid = `t${i}`;
      for (let n = 0; n < ARRIVAL_LOG_CAP; n++) setup.append(filler(sid, n));
      before.push(setup.counts(sid).logged);
      plantLock(join(root, sid, ".marker.lock"), shape);
    }

    // 4. Race.
    const barrier = mkTmp("m9bar-");
    const go = join(barrier, "go");
    const racers = Array.from({ length: RACERS }, (_, me) =>
      spawn(process.execPath, [join(js, "racer.mjs"), root, join(barrier, `ready-${me}`), go, String(TRIALS), String(STEP_MS), String(me)], { stdio: "ignore" }));
    for (;;) {
      if (readdirSync(barrier).filter((f) => f.startsWith("ready-")).length === RACERS) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(Array.from({ length: RACERS }, (_, me) => readFileSync(join(barrier, `ready-${me}`), "utf8"))).toEqual(Array(RACERS).fill("parked"));
    writeFileSync(go, String(Date.now() + 300));
    await Promise.all(racers.map((r) => new Promise((res) => r.on("exit", res))));

    // 5. The invariant. Exact, or loudly unable to say — never short and silent.
    const store = fsArrivalStore(root);
    const short: string[] = [];
    let exact = 0, degraded = 0;
    for (let i = 0; i < TRIALS; i++) {
      const sid = `t${i}`;
      if (store.isDegraded(sid)) { degraded++; continue; }   // "I cannot tell you" is an allowed answer
      const after = store.counts(sid).logged;
      if (after < before[i] + RACERS) short.push(`${sid}: ${before[i]} + ${RACERS} appends -> ${after}`);
      else exact++;
    }
    if (process.env.M9_RACE_VERBOSE) console.log(`trials=${TRIALS} exact=${exact} degraded=${degraded} short=${short.length}`, short.slice(0, 5));
    expect(short).toEqual([]);
    // …and the exclusion has to be doing real work: a run where every racer merely degraded would satisfy
    // the line above while proving nothing about whether the count survives contention.
    expect(exact).toBeGreaterThanOrEqual(TRIALS / 2);
  }, 180_000);
});
