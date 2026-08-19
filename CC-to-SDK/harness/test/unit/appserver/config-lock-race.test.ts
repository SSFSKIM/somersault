// test/unit/appserver/config-lock-race.test.ts — M5 fix wave C: mutual exclusion, measured.
//
// This file exists because the defects it pins were invisible to every other kind of test. The lock's
// whole subject is two OPERATING-SYSTEM PROCESSES contending on one real filesystem, and the milestone's
// own review found the general form of the mistake that let them ship: an injected test double is a title
// for the storage layer. A fake lock, or a `Promise.all` inside one process, measures libuv scheduling a
// single program — it cannot produce the interleave where one process's pathname-only `unlink` removes
// another's freshly created lock, which is exactly what did happen: with one abandoned lock and four
// contenders, 32 of 250 trials on this machine (43 of 250 on the verifier's) put two or more processes
// inside the critical section at once, every one of them losing an update, with zero refusals reported.
//
// So the children below are real `node` processes running the REAL compiled module through the REAL
// composition `runConfigWrite` uses — `withFileLock(read → CAS → apply → fenced commit)` — over one
// settings file per trial. Under mutual exclusion the file's counter must equal the number of processes
// that were told their write committed. Anything less is a lost update; a `maxDepth` above 1 is two
// critical sections in flight at once. The run costs ~20s, which is the price of measuring the only
// property this code has.
import { describe, it, expect } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const harnessRoot = fileURLToPath(new URL("../../../", import.meta.url));
const mkTmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

interface Run { racers: number; trials: number; stepMs: number; staleMs: number; holdMs: number }
// Contention: the critical section is short and the stale window is long, so a lease cannot plausibly
// expire inside one — an eviction there would be CORRECT behaviour and would still fail the overlap
// assertion, leaving the row measuring the box's scheduler. The seeded leftovers are stamped ten minutes
// into the past, so they are stale for any value of `staleMs` and the break path runs on the first pass.
const CONTEND: Run = { racers: 4, trials: 25, stepMs: 200, staleMs: 3_000, holdMs: 15 };
// The eviction case, in miniature: every critical section OUTLIVES the stale window, which is the
// production shape (a writer stalled 45s against a 30s window) at a scale a suite can spend. The holder
// keeps its lease from a timer; a waiter that broke it on age instead would enter, and the row would see
// both an overlap and a refusal from the evicted holder's fence.
const OUTLIVE: Run = { racers: 3, trials: 5, stepMs: 2_400, staleMs: 400, holdMs: 600 };

/** The child has to be plain `node`, and plain `node` cannot import TypeScript on every version this
 *  package supports (`engines: >=18`). So the REAL module is compiled once with the repo's own tsc — not
 *  re-implemented in the child, which would test a copy instead of the code. (Same shape as
 *  archive.test.ts's cross-process harness, for the same reason.) */
function compileConfigWriteToJs(): string {
  const out = mkTmp("m5lockjs-");
  try {
    execFileSync(process.execPath, [
      join(harnessRoot, "node_modules", "typescript", "bin", "tsc"),
      join(harnessRoot, "src", "appserver", "configWrite.ts"),
      "--module", "nodenext", "--target", "es2022", "--skipLibCheck",
      "--rootDir", join(harnessRoot, "src"), "--outDir", out,
    ], { stdio: "pipe", cwd: harnessRoot });
  } catch (e) {
    throw new Error(`tsc failed compiling configWrite.ts:\n${(e as { stdout?: Buffer }).stdout ?? "(no output)"}`);
  }
  writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(out, "child.mjs"), CHILD_SRC);
  return out;
}

// `parked` is sampled BEFORE the child waits, so it answers "was this child waiting when the barrier was
// released?" rather than the weaker "did it eventually start". After the release every child runs the same
// wall-clock schedule, so all four meet each trial's lock within a millisecond of each other.
const CHILD_SRC = `import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
const [mod, root, ready, go, trialsRaw, stepRaw, staleRaw, holdRaw] = process.argv.slice(2);
const { withFileLock, readTargetDoc, writeTargetDoc, applyEdit } = await import(mod);
const trials = Number(trialsRaw), step = Number(stepRaw), staleMs = Number(staleRaw), holdMs = Number(holdRaw);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(ready, existsSync(go) ? "late" : "parked");
while (!existsSync(go)) await sleep(2);
const startMs = Number(readFileSync(go, "utf8"));
for (let i = 0; i < trials; i++) {
  const target = root + "/t" + i + "/settings.json";
  const trace = root + "/t" + i + "/trace";
  const wait = startMs + i * step - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    await withFileLock(target, async (fence) => {
      appendFileSync(trace, "ENTER " + process.pid + "\\n");
      try {
        const { doc, version } = await readTargetDoc(target);
        await sleep(holdMs);                               // the read-modify-write window
        const n = typeof doc.n === "number" ? doc.n : 0;
        await writeTargetDoc(target, applyEdit(doc, ["n"], n + 1, "replace"), { expectVersion: version, fence });
      } finally { appendFileSync(trace, "EXIT " + process.pid + "\\n"); }
    }, { staleMs });
    appendFileSync(trace, "OK " + process.pid + "\\n");
  } catch (e) {
    appendFileSync(trace, "REFUSED " + process.pid + " " + (e && e.code ? e.code : "?") + " " + String(e && e.message).slice(0, 90) + "\\n");
  }
}
`;

type Outcome = { parked: string[]; trials: { counter: number; committed: number; maxDepth: number; refusals: string[] }[] };

/** One contended run: `trials` independent settings files, `racers` processes, every process taking every
 *  file's lock at the same wall-clock instant. `seed` plants whatever leftover this variant is about. */
async function contend(mod: string, seed: (dir: string) => void, R: Run): Promise<Outcome> {
  const { racers: RACERS, trials: TRIALS, stepMs: STEP_MS, staleMs: STALE_MS, holdMs: HOLD_MS } = R;
  const root = mkTmp("m5lock-");
  for (let i = 0; i < TRIALS; i++) {
    mkdirSync(join(root, `t${i}`));
    writeFileSync(join(root, `t${i}`, "settings.json"), '{"n":0}\n');
    writeFileSync(join(root, `t${i}`, "trace"), "");
    seed(join(root, `t${i}`));
  }
  const bar = mkTmp("m5bar-");
  const go = join(bar, "go");
  const stderr: string[] = Array.from({ length: RACERS }, () => "");
  const exits = Array.from({ length: RACERS }, (_, k) => {
    const kid = spawn(process.execPath, [
      join(mod, "child.mjs"), join(mod, "appserver", "configWrite.js"), root,
      join(bar, `r${k}`), go, String(TRIALS), String(STEP_MS), String(STALE_MS), String(HOLD_MS),
    ], { stdio: ["ignore", "ignore", "pipe"] });
    kid.stderr.on("data", (d: Buffer) => { stderr[k] += d.toString(); });
    return new Promise<number>((res) => kid.on("exit", (c) => res(c ?? -1)));
  });
  const deadline = Date.now() + 60_000;
  while (Array.from({ length: RACERS }, (_, k) => k).some((k) => !existsSync(join(bar, `r${k}`))) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 2));
  const parked = Array.from({ length: RACERS }, (_, k) => readFileSync(join(bar, `r${k}`), "utf8"));
  writeFileSync(go, String(Date.now() + 250));
  const codes = await Promise.all(exits);
  if (codes.some((c) => c !== 0)) throw new Error(`child failed: ${JSON.stringify(codes)}\n${stderr.join("\n")}`);

  const trials = Array.from({ length: TRIALS }, (_, i) => {
    const lines = readFileSync(join(root, `t${i}`, "trace"), "utf8").split("\n").filter(Boolean);
    let depth = 0, maxDepth = 0;
    for (const l of lines) { if (l.startsWith("ENTER")) { depth++; maxDepth = Math.max(maxDepth, depth); } else if (l.startsWith("EXIT")) depth--; }
    const doc = JSON.parse(readFileSync(join(root, `t${i}`, "settings.json"), "utf8")) as { n?: number };
    // A leftover lock is a leftover only if it is nobody's: every claim must be released.
    expect(readdirSync(join(root, `t${i}`)).filter((f) => f.includes(".lock") || f.includes(".tmp-"))).toEqual([]);
    return {
      counter: doc.n ?? 0,
      committed: lines.filter((l) => l.startsWith("OK")).length,
      maxDepth,
      refusals: lines.filter((l) => l.startsWith("REFUSED")).map((l) => l.split(" ")[2]),
    };
  });
  return { parked, trials };
}

/** What mutual exclusion means here, stated once. Each line is one of the pre-fix measurements. */
function assertExclusive(name: string, R: Run, { parked, trials }: Outcome): void {
  expect(parked, `${name}: every racer must be waiting when the barrier opens`).toEqual(Array.from({ length: R.racers }, () => "parked"));
  const overlapped = trials.filter((t) => t.maxDepth > 1).length;
  const lost = trials.filter((t) => t.counter !== t.committed).length;
  const refused = trials.flatMap((t) => t.refusals);
  expect(`${name}: overlapping critical sections in ${overlapped}/${R.trials} trials`).toBe(`${name}: overlapping critical sections in 0/${R.trials} trials`);
  expect(`${name}: lost updates in ${lost}/${R.trials} trials`).toBe(`${name}: lost updates in 0/${R.trials} trials`);
  // ...and nobody may be starved out of a path that was never actually held.
  expect(`${name}: refusals ${JSON.stringify(refused)}`).toBe(`${name}: refusals []`);
  expect(trials.every((t) => t.committed === R.racers), `${name}: every racer must commit exactly once per trial`).toBe(true);
}

describe("withFileLock across real processes (D-M5-24)", () => {
  it("four OS processes, four kinds of leftover: no overlap, no lost update, no silent success", async () => {
    const mod = compileConfigWriteToJs();
    const stale = new Date(Date.now() - 600_000);
    const variants: [string, (dir: string) => void][] = [
      // (a) nothing left behind — plain contention on a free path.
      ["free", () => {}],
      // (b) a claim abandoned by a crashed writer: the post-D-M5-24 leftover. Every racer takes the break
      //     path on its first pass, which is precisely where two waiters used to delete each other's fresh
      //     lock — the break is now `unlink` of a name only its owner can have, then an emptiness-checked
      //     `rmdir`, and `unlink` cannot remove a directory at all.
      ["abandoned claim", (dir) => {
        mkdirSync(join(dir, "settings.json.lock"));
        writeFileSync(join(dir, "settings.json.lock", "99999-deadwriter"), "99999-deadwriter\n");
        utimesSync(join(dir, "settings.json.lock", "99999-deadwriter"), stale, stale);
      }],
      // (c) a lock file written by a build older than D-M5-24 — the exact leftover the pre-fix
      //     measurement used, where 32 of 250 trials lost an update.
      ["legacy lock file", (dir) => {
        writeFileSync(join(dir, "settings.json.lock"), "99999-deadwriter");
        utimesSync(join(dir, "settings.json.lock"), stale, stale);
      }],
      // (d) the same, and UNREADABLE — the umask-0477 shape, whose bytes the old break and the old
      //     release both needed and neither could get, wedging the target permanently. Broken on age.
      ["unreadable legacy lock file", (dir) => {
        writeFileSync(join(dir, "settings.json.lock"), "99999-deadwriter", { mode: 0o200 });
        utimesSync(join(dir, "settings.json.lock"), stale, stale);
      }],
    ];
    for (const [name, seed] of variants) assertExclusive(name, CONTEND, await contend(mod, seed, CONTEND));
  }, 180_000);

  it("a critical section that OUTLIVES the stale window is not evicted — the holder keeps its lease", async () => {
    // The production loss in miniature. There, a writer stalled 45s against a 30s window had its lock
    // broken at exactly 30s; the breaker committed, was told `ok`, and the evicted writer's own rename
    // erased those bytes. Here every section runs 600ms against a 400ms window, three processes deep. A
    // waiter that judged the holder dead by clock age would enter — showing up as an overlap — and the
    // evicted holder's fence would then refuse, showing up as a refusal. Neither is allowed.
    assertExclusive("outlives the stale window", OUTLIVE, await contend(compileConfigWriteToJs(), () => {}, OUTLIVE));
  }, 180_000);
});
