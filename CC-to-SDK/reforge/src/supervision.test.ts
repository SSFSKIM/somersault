// C13c / W10c — controls for the process-supervision surface.
//
//   npx tsx src/supervision.test.ts
//
// The cut's negative control for this capability is "a scenario that leaks a
// child must FAIL the state diff", and the honest way to watch that is to leak
// one: every check below that claims a leak is seen spawns a real process and
// waits for the surface to name it. An in-process fake would prove that the
// code returns what it was told to.
//
// The other half matters as much and is easier to get wrong: the surface must
// be QUIET. It runs on every scenario in the corpus, on a machine that is doing
// other things, and a survivor set that picked up the operator's browser would
// redden a scenario for a reason that is not behaviour. So the drop rule and
// the settle rule each have a control asserting the NEGATIVE direction.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedScriptedChild } from "../w10/child.js";
import {
  canonicalCommand,
  descendantsOf,
  findEngineChild,
  leaksIn,
  processBaseline,
  processSnapshot,
  processTable,
  type ProcessRow,
} from "./supervision.js";
import { REFORGE_ROOT, SANDBOX } from "./runTurn.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};
const throws = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Start a process this one is NOT the parent of, and return its pid.
 *
 * `detached: true` is not enough: it makes the child a session leader while
 * leaving this process as its parent, so the ancestry route would attribute it
 * and the CWD and COMMAND routes would never be exercised. A background job
 * inside a `sh -c` that then exits is what an orphan actually is — which is
 * also what `Pde.detach()` leaves once the engine goes away.
 */
function orphan(command: string, cwd: string): number {
  // The background job's stdout must go to /dev/null, not to `sh`'s: it is
  // inherited, so `spawnSync` would block until the CHILD closed the pipe —
  // waiting out the very lifetime this helper exists to escape — and the
  // child's bytes would land in the same buffer the pid is read from.
  const r = spawnSync("/bin/sh", ["-c", `${command} >/dev/null 2>&1 & echo $!`], { cwd, encoding: "utf8" });
  const pid = Number((r.stdout ?? "").trim());
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`orphan: could not start ${command} — ${JSON.stringify(r.stdout)} ${JSON.stringify(r.stderr)}`);
  return pid;
}

const box = mkdtempSync(join(tmpdir(), "reforge-supervision-"));
const started: ReturnType<typeof spawn>[] = [];
const orphans: number[] = [];
try {
  // ---- the table reads ------------------------------------------------------
  {
    const table = processTable();
    check("the process table is read and parsed", table.size > 10, `${table.size} row(s)`);
    check("…including this process, with its real parent", table.get(process.pid)?.ppid === process.ppid, JSON.stringify(table.get(process.pid)));
    check("…and command lines are not truncated to a terminal width",
      [...table.values()].some((r) => r.command.length > 200), `longest ${Math.max(...[...table.values()].map((r) => r.command.length))}`);
  }

  // ---- canonicalization ----------------------------------------------------
  check("a command line's harness paths become stable tokens",
    canonicalCommand(`/bin/bash ${SANDBOX}/reforge-child.sh --bytes 4`) === "/bin/bash <sandbox>/reforge-child.sh --bytes 4",
    canonicalCommand(`/bin/bash ${SANDBOX}/reforge-child.sh --bytes 4`));
  check("…with the LONGEST path winning, so the sandbox is not swallowed by the repo root",
    !canonicalCommand(`${SANDBOX}/x`).startsWith("<reforge>"), canonicalCommand(`${SANDBOX}/x`));

  // ---- A LEAK IS SEEN -------------------------------------------------------
  const script = seedScriptedChild(box);
  {
    const baseline = processBaseline();
    // An ORPHAN, which is what `Pde.detach()` leaves once the engine exits: its
    // lineage is gone, so the ancestry route cannot see it and the COMMAND
    // route — the scripted child's own file name — is what has to.
    const leakedPid = orphan(`${script} --bytes 40 --chunks 30 --every 900`, "/");
    orphans.push(leakedPid);
    await sleep(400);

    const snap = await processSnapshot(baseline, { settleMs: 200, label: "leak-control" });
    const mine = snap.survivors.filter((s) => s.command.includes("reforge-child.sh"));
    check("a leaked child appears in the survivor set", mine.length >= 1, JSON.stringify(snap.survivors).slice(0, 200));
    check("…recorded as a LEAK, because nothing declared it", mine.every((s) => s.declared === null));
    check("…and as ORPHANED, because the process that started it is gone", mine.every((s) => s.orphaned));
    check("…and `leaksIn` names it", leaksIn(snap).some((s) => s.command.includes("reforge-child.sh")));
    check("…with its command canonicalized, so no harness path is graded",
      mine.every((s) => !s.command.includes(REFORGE_ROOT)), JSON.stringify(mine.map((s) => s.command)));

    // …and the SAME run, declared, is not a leak. This is the pair the wave
    // needs: "left a child running" and "left the child it said it would" must
    // be different verdicts over identical process tables.
    const declaredSnap = await processSnapshot(baseline, { settleMs: 200, detached: ["reforge-child.sh"], label: "declared-control" });
    const declaredMine = declaredSnap.survivors.filter((s) => s.command.includes("reforge-child.sh"));
    check("the same survivor, DECLARED, is not a leak", declaredMine.length >= 1 && declaredMine.every((s) => s.declared === "reforge-child.sh"),
      JSON.stringify(declaredMine));
    check("…and `leaksIn` no longer names it", !leaksIn(declaredSnap).some((s) => s.command.includes("reforge-child.sh")));
    check("…while the declaration does not ERASE it: the survivor is still recorded, so an engine that failed to detach still diffs",
      declaredSnap.survivors.some((s) => s.command.includes("reforge-child.sh")));

    // Kill it and the surface goes quiet — the negative direction, without which
    // "a leak is seen" could be a surface that reports something always.
    try {
      process.kill(leakedPid, "SIGKILL");
    } catch {
      // already gone
    }
    await sleep(400);
    const after = await processSnapshot(baseline, { settleMs: 200, label: "quiet-control" });
    check("once the child is gone the surface is quiet again",
      !after.survivors.some((s) => s.command.includes("reforge-child.sh")), JSON.stringify(after.survivors).slice(0, 200));
  }

  // ---- ATTRIBUTION: an unrelated new process is DROPPED ---------------------
  {
    const baseline = processBaseline();
    // An orphan with no reforge token in its argv and a cwd outside the sandbox:
    // the operator's machine doing something during side A and not side B. All
    // three routes must decline it, or the surface is a coin flip on a shared
    // machine.
    const strangerPid = orphan("/bin/sleep 20", "/");
    orphans.push(strangerPid);
    await sleep(400);
    const snap = await processSnapshot(baseline, { settleMs: 200, label: "drop-control" });
    check("a new process with no tie to this run is DROPPED, not graded",
      !snap.survivors.some((s) => /\/bin\/sleep 20$/.test(s.command)), JSON.stringify(snap.survivors).slice(0, 240));
    try {
      process.kill(strangerPid, "SIGKILL");
    } catch {
      // already gone
    }
  }

  // ---- ATTRIBUTION: the ancestry route --------------------------------------
  {
    const baseline = processBaseline();
    // Still OUR child — not detached — so its parent chain reaches this process
    // even though `/bin/sleep 21` carries no reforge token at all.
    const mine = spawn("/bin/sleep", ["21"], { stdio: "ignore", cwd: "/" });
    started.push(mine);
    await sleep(300);
    const snap = await processSnapshot(baseline, { settleMs: 200, label: "ancestry-control" });
    check("a survivor with no marker is still attributed when its lineage reaches this process",
      snap.survivors.some((s) => /\/bin\/sleep 21$/.test(s.command)), JSON.stringify(snap.survivors).slice(0, 240));
    check("…and it is NOT recorded as orphaned, because its parent is alive",
      snap.survivors.filter((s) => /\/bin\/sleep 21$/.test(s.command)).every((s) => !s.orphaned));
    mine.kill("SIGKILL");
    await sleep(200);
  }

  // ---- THE SETTLE RULE ------------------------------------------------------
  {
    const baseline = processBaseline();
    // A child that exits BETWEEN the two samples: present in the first, gone
    // from the second, so it must not be recorded.
    const briefPid = orphan(`${script} --bytes 0 --chunks 2 --every 300`, "/");
    orphans.push(briefPid);
    await sleep(120);
    const snap = await processSnapshot(baseline, { settleMs: 600, label: "settle-control" });
    check("a child that exits between the two samples is not recorded as a survivor",
      !snap.survivors.some((s) => s.command.includes("--every 300")), JSON.stringify(snap.survivors).slice(0, 240));
  }

  // ---- the descendant walk, and the engine-child rule -----------------------
  {
    const t = new Map<number, ProcessRow>([
      [10, { pid: 10, ppid: 1, command: "root" }],
      [11, { pid: 11, ppid: 10, command: "a" }],
      [12, { pid: 12, ppid: 11, command: "b" }],
      [13, { pid: 13, ppid: 10, command: "c" }],
      [14, { pid: 14, ppid: 99, command: "elsewhere" }],
    ]);
    check("the descendant walk reaches every generation", descendantsOf(t, 10).map((r) => r.pid).sort().join(",") === "11,12,13",
      descendantsOf(t, 10).map((r) => r.pid).join(","));
    check("…and nothing outside the tree", !descendantsOf(t, 10).some((r) => r.pid === 14));
    // A cycle in the table must not hang the walk.
    const cyc = new Map<number, ProcessRow>([
      [20, { pid: 20, ppid: 21, command: "x" }],
      [21, { pid: 21, ppid: 20, command: "y" }],
    ]);
    check("a cyclic table does not hang the descendant walk", descendantsOf(cyc, 20).length <= 2);
  }
  {
    const engineish = `${REFORGE_ROOT}/build/real-binary --print`;
    const one = new Map<number, ProcessRow>([
      [100, { pid: 100, ppid: 0, command: "harness" }],
      [101, { pid: 101, ppid: 100, command: engineish }],
      [102, { pid: 102, ppid: 101, command: "/bin/bash -c echo" }],
    ]);
    const found = findEngineChild(one, 100);
    check("the engine child is found under the harness pid by a path the harness constructed", found?.pid === 101, JSON.stringify(found));
    check("…and it carries its own descendants", found?.descendants.map((d) => d.pid).join(",") === "102", JSON.stringify(found?.descendants));
    check("…canonicalized, never as this machine's path", found?.command.startsWith("<reforge>/build/") === true, found?.command);

    const two = new Map(one);
    two.set(103, { pid: 103, ppid: 100, command: `${REFORGE_ROOT}/toolchain/bun ${REFORGE_ROOT}/build/graph/cli` });
    const why = throws(() => findEngineChild(two, 100));
    check("TWO engine children under one harness is a refusal, not a first match", why !== null && /2 engine children/.test(why), String(why).slice(0, 160));

    const none = new Map<number, ProcessRow>([[100, { pid: 100, ppid: 0, command: "harness" }]]);
    check("no engine running is null, not an error", findEngineChild(none, 100) === null);

    // An engine-looking command that is NOT under this harness is not ours —
    // which is what makes the rule safe on a machine running two checkouts.
    const elsewhere = new Map<number, ProcessRow>([
      [100, { pid: 100, ppid: 0, command: "harness" }],
      [200, { pid: 200, ppid: 199, command: engineish }],
      [199, { pid: 199, ppid: 0, command: "someone else's harness" }],
    ]);
    check("an engine under somebody ELSE's harness is not this one's", findEngineChild(elsewhere, 100) === null);
  }
} finally {
  for (const c of started) {
    try {
      if (c.pid !== undefined) process.kill(c.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const pid of orphans) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  // EVERY CHILD IS REAPED BEFORE THIS PROCESS EXITS, and the sweep is by the
  // test's OWN temp directory rather than by a program name. Two reasons: the
  // orphan helper's background `sleep` is a GRANDCHILD whose pid this file never
  // saw, and a name-based sweep (`pkill -f reforge-child.sh`) would reach a
  // sibling worker's processes in a shared checkout. The measured cost of not
  // doing this is on the record: a leaked engine child's `sessions/<pid>` files
  // reddened a later gate's config-dir inventory.
  for (const row of processTable().values()) {
    if (!row.command.includes(box)) continue;
    try {
      process.kill(row.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  rmSync(box, { recursive: true, force: true });
}

console.log(`=== process supervision: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(
    failures.length === 0
      ? "PASS — a real leaked child is named, a declared one is not a leak, and an unrelated process is dropped rather than graded"
      : `FAIL — ${failures.length} control(s) failed`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
