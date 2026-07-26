import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget, stopSession, rmSession, fleetGc } from "../../src/cli/lifecycle.js";
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
