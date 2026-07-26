import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget, stopSession, rmSession, fleetGc, sendStop, gitRemoveWorktree } from "../../src/cli/lifecycle.js";
import { writeRoster, readRoster, listRoster } from "../../src/fleet/roster.js";
import type { RosterRow } from "../../src/fleet/roster.js";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-life-")) }; });
afterEach(() => { rmSync(env.CCX_FLEET_ROOT!, { recursive: true, force: true }); });   // its own temp dir, nothing else
const row = (o: Partial<RosterRow> = {}): RosterRow => ({ short: "a1b2c3d4", sessionId: "sid-1", pid: 100, cwd: "/w", kind: "bg", name: "w1", state: "working", startedAt: 1, ...o });

describe("resolveTarget", () => {
  it("resolves by short id", () => { writeRoster(row(), env); expect(resolveTarget("a1b2c3d4", env).short).toBe("a1b2c3d4"); });
  it("resolves by full session id", () => { writeRoster(row(), env); expect(resolveTarget("sid-1", env).short).toBe("a1b2c3d4"); });
  it("resolves by name", () => { writeRoster(row(), env); expect(resolveTarget("w1", env).short).toBe("a1b2c3d4"); });
  it("throws listing matches when a name is ambiguous — never picks one silently", () => {
    writeRoster(row(), env); writeRoster(row({ short: "b2c3d4e5", pid: 101, sessionId: "sid-2" }), env);
    expect(() => resolveTarget("w1", env)).toThrow(/a1b2c3d4[\s\S]*b2c3d4e5|b2c3d4e5[\s\S]*a1b2c3d4/);
  });
  it("throws a clear error for an unknown target", () => { expect(() => resolveTarget("zzzzzzzz", env)).toThrow(/zzzzzzzz/); });
});

describe("stopSession", () => {
  it("records `stopped`, which daemon-finalize.sh routes down its error arm", async () => {
    writeRoster(row(), env);
    await stopSession("a1b2c3d4", env, { sendStop: async () => true });
    expect(readRoster("a1b2c3d4", env)!.state).toBe("stopped");
  });
  it("is idempotent on an already-dead session", async () => {
    writeRoster(row({ state: "done" }), env);
    await expect(stopSession("a1b2c3d4", env, { sendStop: async () => false })).resolves.toBeUndefined();
  });
  it("losing the race to the session's own exit leaves `done` standing — a finished worker did not fail", async () => {
    writeRoster(row({ state: "done", endedAt: 5 }), env);
    await stopSession("a1b2c3d4", env, { sendStop: async () => false });
    expect(readRoster("a1b2c3d4", env)).toMatchObject({ state: "done", endedAt: 5 });
  });
  it("tolerates a row a concurrent rm already unlinked — like rm, stop may race a session's exit", async () => {
    let stopped = false;
    await expect(stopSession("a1b2c3d4", env, { sendStop: async () => { stopped = true; return false; } })).resolves.toBeUndefined();
    expect(stopped).toBe(false);             // no row ⇒ no pid to address
  });
  it("still throws on an ambiguous target — the silence is for a row that is GONE, not for a guess", async () => {
    writeRoster(row(), env); writeRoster(row({ short: "b2c3d4e5", pid: 101, sessionId: "sid-2" }), env);
    await expect(stopSession("w1", env, { sendStop: async () => false })).rejects.toThrow(/ambiguous[\s\S]*a1b2c3d4[\s\S]*b2c3d4e5/);
  });
});

describe("rmSession", () => {
  it("deletes the roster row for an already-exited session", async () => {
    writeRoster(row({ state: "done" }), env);
    await rmSession("a1b2c3d4", env, { sendStop: async () => false, worktreeClean: async () => true, removeWorktree: async () => {} });
    expect(existsSync(join(env.CCX_FLEET_ROOT!, "roster", "a1b2c3d4.json"))).toBe(false);
  });
  it("removes a CLEAN worktree", async () => {
    writeRoster(row({ state: "done", worktree: "/repo/.claude/worktrees/wt" }), env);
    let removed = false;
    await rmSession("a1b2c3d4", env, { sendStop: async () => false, worktreeClean: async () => true, removeWorktree: async () => { removed = true; } });
    expect(removed).toBe(true);
  });
  it("refuses a DIRTY worktree, reporting why, and keeps the roster row", async () => {
    writeRoster(row({ state: "done", worktree: "/repo/.claude/worktrees/wt" }), env);
    let removed = false;
    await expect(rmSession("a1b2c3d4", env, { sendStop: async () => false, worktreeClean: async () => false, removeWorktree: async () => { removed = true; } }))
      .rejects.toThrow(/dirty/i);
    expect(readRoster("a1b2c3d4", env)).toBeDefined();
    expect(removed).toBe(false);               // refusing must not still delete the uncommitted work
  });
  it("is idempotent — a second rm does not throw", async () => {
    writeRoster(row({ state: "done" }), env);
    const d = { sendStop: async () => false, worktreeClean: async () => true, removeWorktree: async () => {} };
    await rmSession("a1b2c3d4", env, d);
    await expect(rmSession("a1b2c3d4", env, d)).resolves.toBeUndefined();
  });
  it("reports an ambiguous target instead of exiting clean having removed nothing", async () => {
    // "not found ⇒ already done" is what makes rm idempotent, but swallowing EVERY resolution failure
    // swallows ambiguity too: `ccx rm w1` with two w1s would succeed silently and delete neither.
    writeRoster(row(), env); writeRoster(row({ short: "b2c3d4e5", pid: 101, sessionId: "sid-2" }), env);
    await expect(rmSession("w1", env, { sendStop: async () => false, worktreeClean: async () => true, removeWorktree: async () => {} }))
      .rejects.toThrow(/ambiguous[\s\S]*a1b2c3d4[\s\S]*b2c3d4e5/);
    expect(listRoster(env)).toHaveLength(2);
  });
  it("removes a row whose worktree is already gone — a vanished worktree holds no work to lose", async () => {
    // The default cleanliness probe answers `false` for every git failure, and "no such directory" is
    // one: a row left behind by a half-finished rm would then be refused as "dirty" forever, naming a
    // path that does not exist. Deliberately NOT injecting worktreeClean — that default is the subject.
    const gone = join(env.CCX_FLEET_ROOT!, "worktrees", "wt");
    writeRoster(row({ state: "done", worktree: gone }), env);
    let removed = false;
    await rmSession("a1b2c3d4", env, { sendStop: async () => false, removeWorktree: async () => { removed = true; } });
    expect(readRoster("a1b2c3d4", env)).toBeUndefined();
    expect(removed).toBe(true);                // and the removal is still delegated, never assumed done
  });
  it("REFUSES when the worktree removal fails — keeping the row AND the directory", async () => {
    // `git worktree remove` also fails when the path is a MAIN working tree, and the old code answered
    // every failure with `rm -rf`: a session started as `--worktree .` on a clean checkout passed the
    // cleanliness gate and `ccx rm` then deleted the repository. Nothing about a failed probe licenses a
    // delete — least of all of files git never listed (an ignored `.env`, build output).
    const wt = join(env.CCX_FLEET_ROOT!, "repo"); mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".env"), "secret");
    writeRoster(row({ state: "done", worktree: wt }), env);
    const err = await rmSession("a1b2c3d4", env, {
      sendStop: async () => false, worktreeClean: async () => true,
      removeWorktree: (p) => gitRemoveWorktree(p, async () => { throw new Error("fatal: 'repo' is a main working tree"); }),
    }).then(() => undefined, (e: Error) => e);
    expect(existsSync(join(wt, ".env"))).toBe(true);             // the directory, ignored files and all, survives
    expect(readRoster("a1b2c3d4", env)).toBeDefined();           // and so does the row — refusing loudly is the correct outcome
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain(wt);                          // naming the path
    expect(err!.message).toMatch(/main working tree/);           // and git's own words
  });
  it("refuses a worktree path that is not absolute, before stopping or deleting anything", async () => {
    // Stored verbatim from `--worktree wt`, and every use of it here (existsSync, `git -C`, the removal)
    // resolves against THIS process's cwd — not the session's. A miss then reads as "clean" and the
    // removal runs somewhere else entirely.
    writeRoster(row({ state: "done", worktree: "wt" }), env);
    let stopped = false, removed = false;
    await expect(rmSession("a1b2c3d4", env, {
      sendStop: async () => { stopped = true; return false; }, worktreeClean: async () => true,
      removeWorktree: async () => { removed = true; },
    })).rejects.toThrow(/absolute/);
    expect([stopped, removed]).toEqual([false, false]);
    expect(readRoster("a1b2c3d4", env)).toBeDefined();
  });
  it("tells the host to stop BEFORE touching its worktree — never pull one out from under a live session", async () => {
    writeRoster(row({ worktree: "/repo/.claude/worktrees/wt" }), env);
    const seen: string[] = [];
    await rmSession("a1b2c3d4", env, {
      sendStop: async () => { seen.push("stop"); return true; },
      worktreeClean: async () => { seen.push("clean"); return true; },
      removeWorktree: async () => { seen.push("remove"); },
    });
    expect(seen).toEqual(["stop", "clean", "remove"]);
  });
});

describe("gitRemoveWorktree", () => {
  it("delegates the deletion to git and deletes nothing itself", async () => {
    const wt = join(env.CCX_FLEET_ROOT!, "wt"); mkdirSync(wt, { recursive: true }); writeFileSync(join(wt, "f"), "x");
    let args: string[] = [];
    await gitRemoveWorktree(wt, async (a) => { args = a; return {}; });
    expect(args).toEqual(["-C", wt, "worktree", "remove", "--force", wt]);
    expect(existsSync(join(wt, "f"))).toBe(true);   // this fake git removed nothing, and neither may we
  });
  it("asks git nothing about a worktree that is already gone", async () => {
    // Otherwise the now-fatal `git -C <gone>` failure would refuse the row forever, undoing the
    // vanished-worktree case worktreeClean's own short-circuit exists for.
    let asked = false;
    await expect(gitRemoveWorktree(join(env.CCX_FLEET_ROOT!, "vanished"), async () => { asked = true; return {}; })).resolves.toBeUndefined();
    expect(asked).toBe(false);
  });
});

/** node calls a connect listener ASYNCHRONOUSLY, and sendStop's `s.write` closes over the `const s` still
 *  being initialised — a fake invoking it synchronously would hit the temporal dead zone. Defer, as the
 *  real one does, and let each test flush with `tick()` before emitting. */
function fakeSocket() {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    written: [] as string[], destroyed: false,
    write(d: string) { this.written.push(d); return true; },
    on(e: string, fn: () => void) { (handlers[e] ??= []).push(fn); return this; },
    destroy() { this.destroyed = true; return this; },
    emit(e: string) { for (const fn of handlers[e] ?? []) fn(); },
  };
}
const connectTo = (s: ReturnType<typeof fakeSocket>) => (_p: string, onConnect: () => void) => { queueMicrotask(onConnect); return s; };
const tick = () => new Promise<void>((r) => setImmediate(r));

/** These cases must settle on the EVENT, so bound the wait: the suite's own timeout is 120s and the
 *  deadline under test is deliberately unreachable, which would let a hang pass as a slow success. */
async function settles<T>(p: Promise<T>, ms = 200): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return await Promise.race([p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`still pending after ${ms}ms`)), ms); })]);
}

describe("sendStop", () => {
  it("never connects when nothing answers the socket", async () => {
    let connected = false;
    expect(await sendStop("/nope.sock", { socketAnswers: async () => false, connect: () => { connected = true; return fakeSocket(); } })).toBe(false);
    expect(connected).toBe(false);
  });
  it("sends the stop op and resolves on the host's ack", async () => {
    const s = fakeSocket();
    const p = sendStop("/s.sock", { socketAnswers: async () => true, connect: connectTo(s), deadlineMs: 30_000 });
    await tick(); s.emit("data");
    expect(await settles(p)).toBe(true);
    expect(s.written).toEqual([JSON.stringify({ op: "stop" }) + "\n"]);
    expect(s.destroyed).toBe(true);
  });
  it("SETTLES when the host closes the connection instead of replying", async () => {
    // The measured host behaviour: a closing host destroys the open connection carrying the ack, and one
    // that FINs auto-destroys the socket — which node answers by CLEARING socket.setTimeout. With
    // handlers for data/error/setTimeout only, this promise stayed pending forever, so `rm`'s caller
    // never recorded `stopped` and the process exited 0 with the row still `working`. The 30s deadline
    // here is deliberately unreachable: only the `close` handler can settle this.
    const s = fakeSocket();
    const p = sendStop("/s.sock", { socketAnswers: async () => true, connect: connectTo(s), deadlineMs: 30_000 });
    await tick(); s.emit("close");
    expect(await settles(p)).toBe(false);
    expect(s.destroyed).toBe(true);
  });
  it("gives up on an absolute deadline when the host holds the connection open in silence", async () => {
    const s = fakeSocket();
    expect(await sendStop("/s.sock", { socketAnswers: async () => true, connect: connectTo(s), deadlineMs: 5 })).toBe(false);
  });
  it("settles once — our own destroy() re-enters through close after a reply", async () => {
    const s = fakeSocket();
    const p = sendStop("/s.sock", { socketAnswers: async () => true, connect: connectTo(s), deadlineMs: 30_000 });
    await tick(); s.emit("data"); s.emit("close");
    expect(await settles(p)).toBe(true);
  });
});

describe("fleetGc", () => {
  const runDirOf = () => { const d = join(env.CCX_FLEET_ROOT!, "run"); mkdirSync(d, { recursive: true }); return d; };
  it("removes the socket of a host that no longer answers", async () => {
    const d = runDirOf(); writeFileSync(join(d, "100.sock"), "");
    expect(await fleetGc(env, { socketAnswers: async () => false })).toEqual([join(d, "100.sock")]);
    expect(existsSync(join(d, "100.sock"))).toBe(false);
  });
  it("keeps a socket that ANSWERS — sweeping one would kill a live host's address", async () => {
    const d = runDirOf(); writeFileSync(join(d, "100.sock"), "");
    expect(await fleetGc(env, { socketAnswers: async () => true })).toEqual([]);
    expect(existsSync(join(d, "100.sock"))).toBe(true);
  });
  it("leaves anything that is not a socket alone — gc reaps addresses, not the whole run dir", async () => {
    const d = runDirOf(); writeFileSync(join(d, "notes.txt"), "x");
    expect(await fleetGc(env, { socketAnswers: async () => false })).toEqual([]);
    expect(existsSync(join(d, "notes.txt"))).toBe(true);
  });
  it("returns [] when there is no run directory at all", async () => {
    expect(await fleetGc(env, { socketAnswers: async () => false })).toEqual([]);
  });
  it("is idempotent — a second gc finds nothing left to reap", async () => {
    const d = runDirOf(); writeFileSync(join(d, "100.sock"), "");
    const deps = { socketAnswers: async () => false };
    await fleetGc(env, deps);
    expect(await fleetGc(env, deps)).toEqual([]);
  });
});
