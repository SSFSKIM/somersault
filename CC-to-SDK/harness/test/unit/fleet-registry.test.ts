import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegistry } from "../../src/fleet/registry.js";

let env: NodeJS.ProcessEnv, dir: string;
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "ccx-reg-"));
  dir = join(home, ".claude", "sessions");
  mkdirSync(dir, { recursive: true });
  env = { HOME: home };
});
const put = (pid: number, body: unknown) => writeFileSync(join(dir, `${pid}.json`), JSON.stringify(body));

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
  it("returns [] when the directory does not exist", () => { expect(readRegistry({ HOME: "/nope" })).toEqual([]); });
});
