import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mintShortId, isShortId, fleetRoot, rosterDir, rosterPath, runDir, hostSocketPath } from "../../src/fleet/paths.js";

describe("short ids", () => {
  it("mints exactly 8 lowercase hex chars", () => {
    for (let i = 0; i < 200; i++) expect(mintShortId()).toMatch(/^[0-9a-f]{8}$/);
  });
  it("is deterministic under an injected rng", () => {
    expect(mintShortId(() => 0)).toBe("00000000");
    expect(mintShortId(() => 0.9999)).toBe("ffffffff");
  });
  it("validates length strictly — 7 and 9 are rejected", () => {
    // _lib.sh gates the entire purge on [ ${#short} -eq 8 ]; a 7- or 9-char id disables it silently.
    expect(isShortId("a1b2c3d4")).toBe(true);
    expect(isShortId("a1b2c3d")).toBe(false);
    expect(isShortId("a1b2c3d4e")).toBe(false);
    expect(isShortId("A1B2C3D4")).toBe(false);
    expect(isShortId("a1b2c3g4")).toBe(false);
  });
});

describe("paths", () => {
  const env = { HOME: "/home/u" } as NodeJS.ProcessEnv;
  it("roots the fleet under ~/.claude/ccx", () => { expect(fleetRoot(env)).toBe("/home/u/.claude/ccx"); });
  it("keys the roster by short id, off the one place the `roster` segment lives", () => {
    // roster.ts must compose on rosterDir: a second copy of the segment diverges silently, because a
    // readdir of the wrong directory just yields an empty fleet.
    expect(rosterDir(env)).toBe("/home/u/.claude/ccx/roster");
    expect(rosterPath("a1b2c3d4", env)).toBe("/home/u/.claude/ccx/roster/a1b2c3d4.json");
  });
  it("keys the socket by pid, not session id", () => {
    // The session id does not exist when --bg must already listen, and it rotates on /resume.
    expect(hostSocketPath(4242, env)).toBe("/home/u/.claude/ccx/run/4242.sock");
    expect(runDir(env)).toBe("/home/u/.claude/ccx/run");
  });
  it("falls back to homedir on an EMPTY HOME, not just an unset one", () => {
    // HOME="" with ?? composes ".claude/ccx" — a relative path resolved against the reader's cwd.
    expect(fleetRoot({ HOME: "" })).toBe(join(homedir(), ".claude", "ccx"));
  });
  it("honours CCX_FLEET_ROOT for test isolation", () => {
    expect(fleetRoot({ HOME: "/home/u", CCX_FLEET_ROOT: "/tmp/t1" })).toBe("/tmp/t1");
  });
  it("resolves a relative CCX_FLEET_ROOT to an absolute path", () => {
    expect(fleetRoot({ HOME: "/home/u", CCX_FLEET_ROOT: "rel/ccx" })).toBe(resolve("rel/ccx"));
  });
});
