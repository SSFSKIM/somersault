import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { collectFleet } from "../../src/fleet/index.js";
import { writeRoster } from "../../src/fleet/roster.js";
import type { RosterRow } from "../../src/fleet/roster.js";
import { renderAgents } from "../../src/cli/agents.js";
import type { AgentsRow } from "../../src/fleet/project.js";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-fleet-")), HOME: "/nope" }; });
const row = (o: Partial<RosterRow> = {}): RosterRow => ({ short: "a1b2c3d4", pid: 100, cwd: "/w", kind: "bg", name: "w1", state: "working", startedAt: 1, ...o });

const deps = (over: any = {}) => ({
  readRegistry: () => [], isPidLive: async () => false, socketAnswers: async () => false,
  askStatus: async () => undefined, ...over,
});

describe("collectFleet", () => {
  it("lists a FINISHED session — the whole reason the roster exists", async () => {
    writeRoster(row({ state: "done", sessionId: "sid-1", endedAt: 5 }), env);
    const rows = await collectFleet(env, deps());
    expect(rows).toEqual([expect.objectContaining({ id: "a1b2c3d4", sessionId: "sid-1", state: "done", status: "idle" })]);
  });
  it("asks the live host for status when its socket answers", async () => {
    writeRoster(row({ sessionId: "sid-1" }), env);
    const rows = await collectFleet(env, deps({
      isPidLive: async () => true, socketAnswers: async () => true,
      askStatus: async () => ({ state: "blocked", status: "idle" }),
    }));
    expect(rows[0]).toMatchObject({ state: "blocked", status: "idle" });
  });
  it("projects error for a dead pid with a non-terminal roster row", async () => {
    writeRoster(row({ state: "working", sessionId: "sid-1" }), env);
    expect((await collectFleet(env, deps()))[0].state).toBe("error");
  });
  it("falls back to the roster's own procStart once the engine has unlinked its row", async () => {
    // The engine unlinks ~/.claude/sessions/<pid>.json on exit, but our roster row outlives it. With
    // no stamp at all, isPidLive(pid, undefined) answers "live" and the poller waits on a corpse.
    writeRoster(row({ state: "working", sessionId: "sid-1", procStart: "Sat Jul 25 02:55:52 2026" }), env);
    const seen: (string | undefined)[] = [];
    const rows = await collectFleet(env, deps({ isPidLive: async (_p: number, ps?: string) => { seen.push(ps); return false; } }));
    expect(seen[0]).toBe("Sat Jul 25 02:55:52 2026");
    expect(rows[0].state).toBe("error");
  });
  it("prefers a live registry sessionId over the roster's", async () => {
    writeRoster(row({ sessionId: undefined }), env);
    const rows = await collectFleet(env, deps({
      readRegistry: () => [{ pid: 100, cwd: "/w", sessionId: "sid-live" }],
      isPidLive: async () => true, socketAnswers: async () => true, askStatus: async () => ({ state: "working", status: "busy" }),
    }));
    expect(rows[0].sessionId).toBe("sid-live");
  });
  it("never unlinks anything — agents is read-only", async () => {
    // Not "one file survived": the whole fleet root must come back byte-identical. Every row here
    // LOOKS stale (dead pid, one already terminal, a leftover socket) — exactly the state a read that
    // swept up after itself would race a restart on. Deletion belongs to `ccx fleet gc` alone.
    writeRoster(row({ state: "working" }), env);
    writeRoster(row({ short: "deadbeef", pid: 101, state: "done", endedAt: 5 }), env);
    mkdirSync(join(env.CCX_FLEET_ROOT!, "run"), { recursive: true });
    writeFileSync(join(env.CCX_FLEET_ROOT!, "run", "100.sock"), "stale");
    const before = tree(env.CCX_FLEET_ROOT!);
    await collectFleet(env, deps());
    expect(tree(env.CCX_FLEET_ROOT!)).toEqual(before);
    expect(before.length).toBe(3);                 // 2 roster rows + 1 socket — so the toEqual above can't pass vacuously
  });
});

/** Every file under `root`, as `relative path\0bytes` — a deletion, a truncation or a rewrite all show. */
function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d).sort()) {
    const p = join(d, f); const s = statSync(p);
    if (s.isDirectory()) walk(p); else out.push(`${relative(root, p)}\0${s.size}`);
  } };
  walk(root); return out;
}

const arow = (o: Partial<AgentsRow> = {}): AgentsRow =>
  ({ id: "a1b2c3d4", sessionId: "sid-1", state: "working", status: "busy", cwd: "/w", name: "w1", ...o });

describe("renderAgents", () => {
  it("hides terminal rows by default and shows them under --all", () => {
    const rows = [arow({ id: "aaaaaaaa", state: "working" }), arow({ id: "bbbbbbbb", state: "blocked" }),
      arow({ id: "cccccccc", state: "done" }), arow({ id: "dddddddd", state: "error" }), arow({ id: "eeeeeeee", state: "stopped" })];
    expect(JSON.parse(renderAgents(rows, { json: true, all: false })).map((r: AgentsRow) => r.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(JSON.parse(renderAgents(rows, { json: true, all: true })).map((r: AgentsRow) => r.id)).toHaveLength(5);
  });
  it("filters by cwd on a path-segment boundary, not a bare prefix", () => {
    const rows = [arow({ id: "aaaaaaaa", cwd: "/w" }), arow({ id: "bbbbbbbb", cwd: "/w/sub" }),
      arow({ id: "cccccccc", cwd: "/workspace" }), arow({ id: "dddddddd", cwd: "/other" })];
    expect(JSON.parse(renderAgents(rows, { json: true, all: true, cwdFilter: "/w" })).map((r: AgentsRow) => r.id))
      .toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });
  it("emits the full row shape as JSON — the poller reads it with .get()", () => {
    expect(JSON.parse(renderAgents([arow()], { json: true, all: true })))
      .toEqual([{ id: "a1b2c3d4", sessionId: "sid-1", state: "working", status: "busy", cwd: "/w", name: "w1" }]);
  });
  it("renders one aligned text line per row", () => {
    expect(renderAgents([arow(), arow({ id: "bbbbbbbb", state: "blocked", status: "idle" })], { json: false, all: true }))
      .toBe("a1b2c3d4  working  busy  w1  /w\nbbbbbbbb  blocked  idle  w1  /w");
  });
  it("flags unresponsive and no-human-seam rows in text output", () => {
    expect(renderAgents([arow({ unresponsive: true, noHumanSeam: true })], { json: false, all: true }))
      .toBe("a1b2c3d4  working  busy  w1  /w  (unresponsive)  ⚠ no human seam");
    expect(renderAgents([arow()], { json: false, all: true })).not.toMatch(/unresponsive|human seam/);
  });
  it("renders an empty fleet as an empty string, not a stray newline", () => {
    expect(renderAgents([], { json: false, all: true })).toBe("");
  });
});
