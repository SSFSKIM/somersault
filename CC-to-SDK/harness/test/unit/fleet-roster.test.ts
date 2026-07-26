import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRoster, readRoster, listRoster, finalizeRoster } from "../../src/fleet/roster.js";
import type { RosterRow } from "../../src/fleet/roster.js";

let env: NodeJS.ProcessEnv;
const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  short: "a1b2c3d4", pid: 100, cwd: "/w", kind: "bg", name: "worker-1", state: "working", startedAt: 1, ...over,
});
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-roster-")) }; });

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
