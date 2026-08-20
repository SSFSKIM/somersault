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
  writeFileSync(join(out, "evicted.mjs"), EVICTED_SRC);
  writeFileSync(join(out, "successor.mjs"), SUCCESSOR_SRC);
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

/** THE EVICTED HOLDER (fix wave G / G1). Its commit is the UNMODIFIED production composition —
 *  `writeTargetDoc(doc, {expectVersion, fence})` — and the only thing added is a wrapper around the fence
 *  the lock hands out: it forwards the call untouched and floods the libuv threadpool around it.
 *
 *  WHY A FLOOD AND NOT A SLEEP. `fence` checks the lock directory and then refreshes the lease, and those
 *  are two syscalls with an event-loop turn between them. The finding is that an eviction landing in that
 *  turn sets `lost` and yet lets the fence RESOLVE, so the caller reads its version and renames — an
 *  evicted owner committing beside its successor. The turn is normally microseconds wide. `UV_THREADPOOL_SIZE=1`
 *  plus a queue of `pbkdf2` jobs (which run on that same pool) stretches it to about a second, and the
 *  stretch is not a contrivance: eviction happens to a holder that has stopped refreshing, and a holder
 *  stops refreshing precisely because its loop or its pool is stalled. The window is widest exactly when it
 *  is likeliest to be entered.
 *
 *  `when` picks WHICH of the fence's two detectors the eviction has to be caught by, and both are run:
 *   - `"before"` floods before the fence is called, so its own `readdir` runs after the break and sees the
 *     successor's marker — the side that was already correct;
 *   - `"after"` floods between the fence's `readdir` and the `utimes` it submits when that resolves, so
 *     the directory check passes and only the REFRESH can see the loss — the side G1 names. */
const EVICTED_SRC = `import { writeFileSync, appendFileSync } from "node:fs";
import { pbkdf2 } from "node:crypto";
const [mod, target, held, log, staleRaw, jobsRaw, when] = process.argv.slice(2);
const { withFileLock, readTargetDoc, writeTargetDoc, applyEdit } = await import(mod);
const say = (s) => appendFileSync(log, s + "\\n");
const block = () => new Promise((r) => pbkdf2("pw", "salt", 300000, 32, "sha512", () => r()));
const blockers = [];
const flood = () => { for (let i = 0; i < Number(jobsRaw); i++) blockers.push(block()); };
await withFileLock(target, async (fence) => {
  writeFileSync(held, String(Date.now()));            // the successor may start contending now
  let first = true;
  const injected = async () => {
    if (!first) return fence();
    first = false;
    if (when === "before") flood();
    const p = fence();                                 // submits its \`readdir\` synchronously
    if (when === "after") flood();
    try { await p; say("HOLDER_FENCE_RESOLVED"); } catch (e) { say("HOLDER_FENCE_REFUSED " + (e && e.code ? e.code : "?")); throw e; }
  };
  const { doc, version } = await readTargetDoc(target);
  try {
    await writeTargetDoc(target, applyEdit(doc, ["n"], 1, "replace"), { expectVersion: version, fence: injected });
    say("HOLDER_COMMITTED");
  } catch (e) { say("HOLDER_COMMIT_REFUSED " + (e && e.code ? e.code : "?")); }
  await Promise.all(blockers);
}, { staleMs: Number(staleRaw) }).catch((e) => say("HOLDER_LOCK_FAILED " + String(e && e.message).slice(0, 60)));
`;

/** The SUCCESSOR: an ordinary contender on the real lock. It waits out the stale window, breaks the lease
 *  of a holder that has stopped refreshing (exactly what `withFileLock` does for a crashed writer), and
 *  then HOLDS — so the evicted holder's commit, if it happens at all, lands inside this critical section
 *  where a trace can see it. */
const SUCCESSOR_SRC = `import { existsSync, appendFileSync } from "node:fs";
const [mod, target, held, log, staleRaw, holdRaw] = process.argv.slice(2);
const { withFileLock, readTargetDoc, writeTargetDoc, applyEdit } = await import(mod);
const say = (s) => appendFileSync(log, s + "\\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
while (!existsSync(held)) await sleep(2);
try {
  await withFileLock(target, async (fence) => {
    say("SUCCESSOR_ENTER");
    const { doc, version } = await readTargetDoc(target);
    await sleep(Number(holdRaw));
    await writeTargetDoc(target, applyEdit(doc, ["by"], "successor", "replace"), { expectVersion: version, fence });
    say("SUCCESSOR_COMMITTED");
  }, { staleMs: Number(staleRaw) });
} catch (e) { say("SUCCESSOR_REFUSED " + (e && e.code ? e.code : "?")); }
say("SUCCESSOR_EXIT");
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

  /** One eviction, two real processes, and the trace of who was inside the critical section when.
   *  `holdMs` outlasts the flood, so the evicted holder's commit — if the fence lets it through — is
   *  recorded strictly between the successor's ENTER and its EXIT. */
  async function evict(mod: string, when: "before" | "after"): Promise<{ lines: string[]; doc: { n?: number; by?: string } }> {
    const dir = mkTmp("m5evict-");
    const target = join(dir, "settings.json"), held = join(dir, "held"), log = join(dir, "log");
    writeFileSync(target, '{"n":0}\n');
    writeFileSync(log, "");
    const kids = [
      // UV_THREADPOOL_SIZE=1: the pool the fence's own `readdir`/`utimes` run on is the pool the flood
      // occupies, which is what makes the gap between them measurable rather than theoretical.
      spawn(process.execPath, [join(mod, "evicted.mjs"), join(mod, "appserver", "configWrite.js"), target, held, log, "400", "16", when],
        { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, UV_THREADPOOL_SIZE: "1" } }),
      spawn(process.execPath, [join(mod, "successor.mjs"), join(mod, "appserver", "configWrite.js"), target, held, log, "400", "2000"],
        { stdio: ["ignore", "ignore", "inherit"] }),
    ];
    await Promise.all(kids.map((k) => new Promise<number>((r) => k.on("exit", (c) => r(c ?? -1)))));
    return { lines: readFileSync(log, "utf8").split("\n").filter(Boolean), doc: JSON.parse(readFileSync(target, "utf8")) };
  }

  it("an EVICTED holder does not commit — the fence fails on the lease refresh, not only on the directory", async () => {
    // MEASURED BEFORE THE FIX, 5 of 5 trials and again 3 of 3 at these settings:
    //   ["SUCCESSOR_ENTER","HOLDER_FENCE_RESOLVED","HOLDER_COMMITTED","SUCCESSOR_REFUSED ConfigLocked",…]
    // The evicted holder's fence said `ok`, its version check passed (the successor had read but not yet
    // written), and it renamed its bytes over the file INSIDE the successor's critical section — after
    // which the legitimate owner was refused for a conflict the evicted writer had caused. Two writers in
    // one critical section, one of them told `ok`, is the whole of what this lock exists to prevent.
    const mod = compileConfigWriteToJs();
    for (const when of ["after", "before"] as const) {
      const { lines, doc } = await evict(mod, when);
      const enter = lines.indexOf("SUCCESSOR_ENTER"), exit = lines.indexOf("SUCCESSOR_EXIT");
      const committed = lines.indexOf("HOLDER_COMMITTED");
      // The control FIRST: a trial where nobody was evicted measures the scheduler, not the fence.
      expect(`${when}: successor entered=${enter >= 0}`).toBe(`${when}: successor entered=true`);
      expect(`${when}: evicted holder's fence: ${lines.find((l) => l.startsWith("HOLDER_FENCE_")) ?? "(never called)"}`)
        .toBe(`${when}: evicted holder's fence: HOLDER_FENCE_REFUSED ConfigLocked`);
      expect(`${when}: evicted holder committed inside the successor's section: ${committed > enter && (exit < 0 || committed < exit)}`)
        .toBe(`${when}: evicted holder committed inside the successor's section: false`);
      // …and the successor, which really does own the lock, must be able to finish. A fence that refused
      // the RIGHT writer would satisfy every line above and still have destroyed the method.
      expect(`${when}: successor: ${lines.find((l) => l.startsWith("SUCCESSOR_COMMITTED") || l.startsWith("SUCCESSOR_REFUSED")) ?? "(nothing)"}`)
        .toBe(`${when}: successor: SUCCESSOR_COMMITTED`);
      // The bytes are the last word: the owner's edit is on disk and the evicted writer's is not.
      expect(`${when}: ${JSON.stringify(doc)}`).toBe(`${when}: ${JSON.stringify({ n: 0, by: "successor" })}`);
    }
  }, 180_000);
});
