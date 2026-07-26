import { describe, it, expect } from "vitest";
import { mintShortId, isShortId, fleetRoot, rosterPath, runDir, hostSocketPath } from "../../src/fleet/paths.js";

describe("short ids", () => {
  it("mints exactly 8 lowercase hex chars", () => {
    for (let i = 0; i < 200; i++) expect(mintShortId()).toMatch(/^[0-9a-f]{8}$/);
  });
  it("is deterministic under an injected rng", () => {
    expect(mintShortId(() => 0)).toBe("00000000");
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
  it("keys the roster by short id", () => { expect(rosterPath("a1b2c3d4", env)).toBe("/home/u/.claude/ccx/roster/a1b2c3d4.json"); });
  it("keys the socket by pid, not session id", () => {
    // The session id does not exist when --bg must already listen, and it rotates on /resume.
    expect(hostSocketPath(4242, env)).toBe("/home/u/.claude/ccx/run/4242.sock");
    expect(runDir(env)).toBe("/home/u/.claude/ccx/run");
  });
  it("honours CCX_FLEET_ROOT for test isolation", () => {
    expect(fleetRoot({ HOME: "/home/u", CCX_FLEET_ROOT: "/tmp/t1" })).toBe("/tmp/t1");
  });
});
