import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRoster, readRoster, listRoster, finalizeRoster } from "../../src/fleet/roster.js";
import type { RosterRow } from "../../src/fleet/roster.js";

let env: NodeJS.ProcessEnv;
const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  short: "a1b2c3d4", pid: 100, cwd: "/w", kind: "bg", name: "worker-1", state: "working", startedAt: 1, ...over,
});
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-roster-")) }; });
afterEach(() => { rmSync(env.CCX_FLEET_ROOT!, { recursive: true, force: true }); });

describe("roster", () => {
  it("round-trips a row", () => {
    writeRoster(row(), env);
    expect(readRoster("a1b2c3d4", env)).toMatchObject({ short: "a1b2c3d4", name: "worker-1", state: "working" });
  });
  it("returns undefined for an unknown short", () => { expect(readRoster("ffffffff", env)).toBeUndefined(); });
  it("lists every row", () => {
    writeRoster(row(), env); writeRoster(row({ short: "b2c3d4e5", pid: 101 }), env);
    expect(listRoster(env).map((r) => r.short).sort()).toEqual(["a1b2c3d4", "b2c3d4e5"]);
  });
  it("finalize stamps the terminal state and endedAt without losing other fields", () => {
    writeRoster(row({ sessionId: "sid-1", worktree: "/w/.claude/worktrees/wt" }), env);
    finalizeRoster("a1b2c3d4", "done", env, () => 999);
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("done"); expect(r.endedAt).toBe(999);
    expect(r.sessionId).toBe("sid-1"); expect(r.worktree).toBe("/w/.claude/worktrees/wt");
  });
  it("finalize on an unknown short is a no-op, not a throw — it must be idempotent for rm/stop", () => {
    expect(() => finalizeRoster("ffffffff", "stopped", env)).not.toThrow();
  });
  it("first terminal state wins — a losing `stop` must not overwrite a truthful `done`", () => {
    writeRoster(row(), env);
    finalizeRoster("a1b2c3d4", "done", env, () => 100);
    finalizeRoster("a1b2c3d4", "stopped", env, () => 200);
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("done"); expect(r.endedAt).toBe(100);
  });
  it("leaves no partial row behind — a reader never sees a truncated file", () => {
    // writeFileSync truncates before writing; a host killed in that window strands the session
    // permanently, because finalizeRoster early-returns on an unreadable row.
    writeRoster(row(), env);
    expect(readdirSync(join(env.CCX_FLEET_ROOT!, "roster")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  it("refuses to write a row whose short is not 8 hex — it would be written but never listed", () => {
    expect(() => writeRoster(row({ short: "nope" }), env)).toThrow(/nope/);
  });
  it("skips well-formed JSON that is not a row", () => {
    writeRoster(row(), env);
    writeFileSync(join(env.CCX_FLEET_ROOT!, "roster", "dddddddd.json"), "[]");
    expect(listRoster(env).map((r) => r.short)).toEqual(["a1b2c3d4"]);
  });
  it("returns [] when the roster directory does not exist at all", () => {
    expect(listRoster({ CCX_FLEET_ROOT: join(tmpdir(), "ccx-does-not-exist-" + Date.now()) })).toEqual([]);
  });
  it("round-trips procStart — our own copy of the host stamp, which outlives the engine's row", () => {
    writeRoster(row({ procStart: "Sat Jul 25 02:55:52 2026" }), env);
    expect(readRoster("a1b2c3d4", env)!.procStart).toBe("Sat Jul 25 02:55:52 2026");
  });
  it("round-trips the noHumanSeam flag, which agents surfaces", () => {
    writeRoster(row({ noHumanSeam: true }), env);
    expect(readRoster("a1b2c3d4", env)!.noHumanSeam).toBe(true);
  });
  it("skips unparseable rows rather than failing the whole listing", () => {
    writeRoster(row(), env);
    mkdirSync(join(env.CCX_FLEET_ROOT!, "roster"), { recursive: true });
    writeFileSync(join(env.CCX_FLEET_ROOT!, "roster", "cccccccc.json"), "{ not json");
    expect(listRoster(env).map((r) => r.short)).toEqual(["a1b2c3d4"]);
  });
});
