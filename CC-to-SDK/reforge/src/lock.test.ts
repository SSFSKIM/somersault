// Controls for the single-writer sandbox lock (H1, `src/lock.ts`).
//
// The lock's whole value is in three answers, and each is watched here IN REAL
// PROCESSES rather than simulated, because two of the three are facts about pids
// and signals that an in-process fake cannot have: a live holder refuses a
// second acquirer BY NAME, a dead holder's record is taken over rather than
// obeyed forever, and a CHILD of the holder is not a peer — it runs the holder's
// own work in the holder's turn and must neither be refused nor release the lock
// when it exits.
//
// Every control runs against a lock path in a temp directory. The real
// `.sandbox.lock` is never touched: this suite is a gate phase, and a gate phase
// that stole the gate's own lock would be a control that breaks what it grades.
//
//   npx tsx src/lock.test.ts
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REFORGE_ROOT } from "./runTurn.js";
import { acquireSandboxLock, OWNER_ENV, releaseSandboxLock, sandboxLockHolder, type LockRecord } from "./lock.js";

const mode = process.argv[2];
const argPath = process.argv[3];

// ---- child modes -----------------------------------------------------------
if (mode === "--hold") {
  // The HOLDER. Acquires, says so, and stays alive until it is signalled — the
  // parent needs a live pid to be refused by, and a real signal to watch the
  // release path handle.
  acquireSandboxLock("lock control: the holder", argPath);
  console.log(`HELD ${process.pid}`);
  setTimeout(() => process.exit(0), 30_000);
} else if (mode === "--recheck") {
  // THE INHERITED CHILD THAT OUTLIVES ITS HOLDER. It calls the lock TWICE, the
  // way a real suite does — `resetSandbox()` runs at the top of every scenario —
  // and between the two calls the world changes underneath it: the record its
  // marker names is replaced by another LIVE pid. The first call is the
  // holder's own work and must be exempt; the second is a stranger inside
  // somebody else's run and must be refused BY NAME.
  acquireSandboxLock("lock control: the inherited child, first call", argPath);
  console.log(`EXEMPT ${process.pid}`);
  const go = `${argPath}.go`;
  const until = Date.now() + 30_000;
  while (!existsSync(go) && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
  try {
    acquireSandboxLock("lock control: the inherited child, second call", argPath);
    console.log(`ACQUIRED-AGAIN holder=${sandboxLockHolder(argPath)?.pid}`);
    process.exit(0);
  } catch (e) {
    console.log(`REFUSED ${(e as Error).message}`);
    process.exit(1);
  }
} else if (mode === "--acquire") {
  // The SECOND ACQUIRER. Its verdict is its exit status; its stdout/stderr is
  // what the parent reads to check the refusal names somebody findable.
  try {
    acquireSandboxLock("lock control: the second acquirer", argPath);
    console.log(`ACQUIRED holder=${sandboxLockHolder(argPath)?.pid}`);
    process.exit(0);
  } catch (e) {
    console.log(`REFUSED ${(e as Error).message}`);
    process.exit(1);
  }
} else {
  // ---- the controls --------------------------------------------------------
  let pass = 0;
  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail = ""): void => {
    if (ok) pass++;
    else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  };

  const box = mkdtempSync(join(tmpdir(), "reforge-lock-"));
  const lockPath = join(box, ".sandbox.lock");
  const SELF = join(REFORGE_ROOT, "src", "lock.test.ts");

  // THE MARKER IS SCRUBBED FROM EVERY SPAWN, and this suite is the one place
  // that has to be deliberate about it: as a gate phase it inherits the gate's
  // own owner marker, and a child that carried it would be recognised as the
  // gate's work and never refused — so the refusal control would pass by
  // accident, on the wrong mechanism.
  const cleanEnv = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    delete env[OWNER_ENV];
    return env;
  };
  const held = (): LockRecord | null => (existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, "utf8")) as LockRecord) : null);

  const waitFor = (child: ChildProcessWithoutNullStreams, re: RegExp, ms: number): Promise<RegExpMatchArray> =>
    new Promise((resolve, reject) => {
      let seen = "";
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${re} (saw: ${seen.slice(0, 200)})`)), ms);
      const onData = (b: Buffer): void => {
        seen += b.toString("utf8");
        const m = seen.match(re);
        if (m) {
          clearTimeout(timer);
          resolve(m);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
    });

  const holder = spawn("npx", ["tsx", SELF, "--hold", lockPath], { cwd: REFORGE_ROOT, env: cleanEnv() });
  const exited = new Promise<void>((r) => holder.on("exit", () => r()));
  try {
    const holderPid = Number((await waitFor(holder, /HELD (\d+)/, 60_000))[1]);
    check("a holder writes a lock naming its own pid and its argv", held()?.pid === holderPid && (held()?.argv ?? "").includes("--hold"), JSON.stringify(held()));

    // ---- two acquirers in two processes -------------------------------------
    const second = spawnSync("npx", ["tsx", SELF, "--acquire", lockPath], { cwd: REFORGE_ROOT, encoding: "utf8", env: cleanEnv() });
    const secondOut = `${second.stdout ?? ""}${second.stderr ?? ""}`;
    check("a second process is REFUSED while the first is alive", second.status !== 0, `exit ${second.status}: ${secondOut.slice(0, 120)}`);
    check("…and the refusal names the holder's pid", secondOut.includes(String(holderPid)), secondOut.slice(0, 200));
    check("…and its argv, so the operator can find it in the process table", secondOut.includes("--hold"), secondOut.slice(0, 200));
    check("…and it neither waited nor stole: the lock still names the holder", held()?.pid === holderPid, JSON.stringify(held()));

    // ---- a child carrying the owner's marker is not a peer -------------------
    const childEnv = cleanEnv();
    childEnv[OWNER_ENV] = String(holderPid);
    const child = spawnSync("npx", ["tsx", SELF, "--acquire", lockPath], { cwd: REFORGE_ROOT, encoding: "utf8", env: childEnv });
    const childOut = `${child.stdout ?? ""}${child.stderr ?? ""}`;
    check("a child carrying the owner's marker is NOT refused", child.status === 0, `exit ${child.status}: ${childOut.slice(0, 200)}`);
    check("…and it does not take ownership: the lock still names the owner", held()?.pid === holderPid, JSON.stringify(held()));
    check("…and its exit does not release the lock the owner still holds", existsSync(lockPath));

    // ---- …but the exemption is re-decided on EVERY call ----------------------
    // The one an in-process fake cannot show: a child that was rightly exempt
    // when it started, still carrying the marker, after the lock has changed
    // hands. Cached, its first answer would stand for the rest of its life and
    // it would keep resetting the sandbox inside the new owner's run.
    {
      const holderRecord = readFileSync(lockPath, "utf8");
      const go = `${lockPath}.go`;
      rmSync(go, { force: true });
      const orphanEnv = cleanEnv();
      orphanEnv[OWNER_ENV] = String(holderPid);
      const orphan = spawn("npx", ["tsx", SELF, "--recheck", lockPath], { cwd: REFORGE_ROOT, env: orphanEnv });
      const orphanOut: string[] = [];
      orphan.stdout.on("data", (b: Buffer) => orphanOut.push(b.toString("utf8")));
      orphan.stderr.on("data", (b: Buffer) => orphanOut.push(b.toString("utf8")));
      const orphanExit = new Promise<number | null>((r) => orphan.on("exit", (code) => r(code)));
      try {
        await waitFor(orphan, /EXEMPT \d+/, 60_000);
        check("an inherited child is exempt on its FIRST call", orphanOut.join("").includes("EXEMPT"));
        // The new gate, standing in for itself: a live pid that is not the one
        // the orphan's marker names. This process is the most honestly live pid
        // available to write there.
        writeFileSync(lockPath, JSON.stringify({ pid: process.pid, argv: "npx tsx strangle/gate.ts (the new holder)" } satisfies LockRecord) + "\n");
        writeFileSync(go, "");
        const code = await orphanExit;
        const out = orphanOut.join("");
        check("…and REFUSED on the next one, once the lock has changed hands", code === 1, `exit ${code}: ${out.slice(0, 200)}`);
        check("…naming the pid that holds it NOW, not the marker it inherited", out.includes(`pid ${process.pid}`), out.slice(0, 300));
        check("…and it did not take the new holder's lock", held()?.pid === process.pid, JSON.stringify(held()));
      } finally {
        orphan.kill("SIGKILL");
        rmSync(go, { force: true });
        // Give the holder its record back: the release control below asks
        // whether a SIGTERMed holder deletes ITS OWN lock, and it will not
        // delete one that names somebody else.
        writeFileSync(lockPath, holderRecord);
      }
    }

    // ---- the release path, driven by the signal the gate is killed with ------
    holder.kill("SIGTERM");
    await exited;
    check("a SIGTERMed holder releases the lock instead of leaving it behind", !existsSync(lockPath));
  } finally {
    holder.kill("SIGKILL");
  }

  // ---- a lock naming a dead pid is taken over ------------------------------
  {
    // A genuinely dead pid rather than a made-up one: spawnSync has already
    // reaped this child, so the pid is real and gone — which is the shape a
    // SIGKILLed gate leaves behind.
    const corpse = spawnSync("/bin/echo", ["done"]);
    writeFileSync(lockPath, JSON.stringify({ pid: corpse.pid, argv: "npx tsx strangle/gate.ts" } satisfies LockRecord) + "\n");
    delete process.env[OWNER_ENV];
    let threw = "";
    try {
      acquireSandboxLock("lock control: the takeover", lockPath);
    } catch (e) {
      threw = (e as Error).message;
    }
    check("a lock naming a DEAD pid is taken over, not obeyed", threw === "" && held()?.pid === process.pid, threw || JSON.stringify(held()));
    releaseSandboxLock(lockPath);
    check("…and releasing gives it back", !existsSync(lockPath));
  }

  rmSync(box, { recursive: true, force: true });

  console.log(`=== sandbox lock: ${pass} check(s) ===`);
  for (const f of failures) console.log(`  FAIL — ${f}`);
  if (pass === 0) {
    console.log("FAIL — no control ran");
    process.exitCode = 1;
  } else {
    console.log(failures.length === 0 ? "PASS — one writer, named refusals, dead holders taken over, children exempt" : `FAIL — ${failures.length} control(s) failed`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  }
}
