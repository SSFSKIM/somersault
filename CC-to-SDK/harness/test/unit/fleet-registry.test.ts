import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegistry, sessionsDir } from "../../src/fleet/registry.js";

let env: NodeJS.ProcessEnv, dir: string, home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ccx-reg-"));
  dir = join(home, ".claude", "sessions");
  mkdirSync(dir, { recursive: true });
  env = { HOME: home };
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });
const put = (pid: number, body: unknown) => writeFileSync(join(dir, `${pid}.json`), JSON.stringify(body));

describe("sessionsDir", () => {
  it("composes <HOME>/.claude/sessions", () => {
    expect(sessionsDir({ HOME: "/home/u" })).toBe("/home/u/.claude/sessions");
  });
  it("follows CLAUDE_CONFIG_DIR — probe 61: that is where a tenant-isolated session writes its row", () => {
    expect(sessionsDir({ HOME: "/home/u", CLAUDE_CONFIG_DIR: "/t/cfg" })).toBe("/t/cfg/sessions");
  });
});

describe("readRegistry", () => {
  it("reads <pid>.json rows written by the engine", () => {
    put(4242, { pid: 4242, sessionId: "sid-1", cwd: "/w", name: "worker-1", kind: "bg", entrypoint: "sdk-cli", procStart: "Sat Jul 25 02:55:52 2026" });
    expect(readRegistry(env)).toEqual([expect.objectContaining({ pid: 4242, sessionId: "sid-1", kind: "bg", name: "worker-1" })]);
  });
  it("ignores non-<pid>.json files", () => {
    put(4242, { pid: 4242, cwd: "/w" });
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, "abc.json"), "{}");
    expect(readRegistry(env).map((r) => r.pid)).toEqual([4242]);
  });
  it("skips corrupt rows instead of throwing", () => {
    put(1, { pid: 1, cwd: "/w" });
    writeFileSync(join(dir, "2.json"), "{ nope");
    expect(readRegistry(env).map((r) => r.pid)).toEqual([1]);
  });
  it("skips a row with no cwd — RegistryRow types it string, and row.cwd.startsWith would throw", () => {
    put(4242, { pid: 4242 });
    put(4243, { pid: 4243, cwd: 7 });
    put(1, { pid: 1, cwd: "/w" });
    expect(readRegistry(env).map((r) => r.pid)).toEqual([1]);
  });
  it("skips pid 0 and negative pids — both are process-group wildcards to kill(2)", () => {
    put(0, { pid: 0, cwd: "/w" });
    put(5, { pid: -1, cwd: "/w" });                                  // the guard is on the body, not the filename
    expect(readRegistry(env)).toEqual([]);
  });
  it("skips non-integer and non-finite pids", () => {
    put(3, { pid: 1.5, cwd: "/w" });
    writeFileSync(join(dir, "4.json"), '{"pid":1e999,"cwd":"/w"}');   // JSON.parse -> Infinity
    expect(readRegistry(env)).toEqual([]);
  });
  it("returns [] when the directory does not exist", () => { expect(readRegistry({ HOME: "/nope" })).toEqual([]); });
});
