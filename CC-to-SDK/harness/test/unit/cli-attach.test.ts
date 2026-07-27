import { describe, it, expect } from "vitest";
import { prepareAttach } from "../../src/cli/attach.js";
import type { RosterRow } from "../../src/fleet/roster.js";
import { hostSocketPath } from "../../src/fleet/paths.js";

function row(over: Partial<RosterRow> = {}): RosterRow {
  return { short: "0a1b2c3d", pid: 4242, cwd: "/repo", kind: "interactive", name: "w1", state: "working", startedAt: 0, ...over };
}

describe("prepareAttach — DI, no sockets", () => {
  it("throws with the resume hint for a TERMINAL roster row instead of attaching to a dead host", async () => {
    await expect(prepareAttach("w1", { resolve: () => row({ state: "done", sessionId: "u-1" }) }))
      .rejects.toThrow(/session 0a1b2c3d has ended \(done\).*ccx --resume u-1/s);
  });
  it("names the target rather than <uuid> when a TERMINAL row has no sessionId yet", async () => {
    await expect(prepareAttach("w1", { resolve: () => row({ state: "error" }) }))
      .rejects.toThrow(/ccx --resume <uuid>/);
  });
  it("a LIVE row returns the socket path keyed by the row's OWN pid, not process.pid", async () => {
    const r = row({ pid: 9999, sessionId: "u-live", cwd: "/repo/wt" });
    const got = await prepareAttach("w1", { resolve: () => r, messages: async () => [] });
    expect(got.socketPath).toBe(hostSocketPath(9999));
    expect(got.short).toBe("0a1b2c3d");
    expect(got.sessionId).toBe("u-live");
    expect(got.cwd).toBe("/repo/wt");
  });
  it("reads history via the injected messages() fn, keyed by sessionId and the row's cwd", async () => {
    const seen: { id: string; opts: { cwd?: string } }[] = [];
    const r = row({ sessionId: "u-live", cwd: "/repo/wt" });
    await prepareAttach("w1", {
      resolve: () => r,
      messages: async (id, opts) => { seen.push({ id, opts }); return [{ type: "user", message: { content: [{ type: "text", text: "hi" }] }, timestamp: "2026-01-01T00:00:00Z" }]; },
    });
    expect(seen[0]).toEqual({ id: "u-live", opts: { cwd: "/repo/wt" } });
  });
  it("a row with no sessionId yet (no turn started) gets an EMPTY replay, never touching messages()", async () => {
    const got = await prepareAttach("w1", { resolve: () => row({ sessionId: undefined }), messages: async () => { throw new Error("messages must not run"); } });
    expect(got.initialLines).toEqual([]);
    expect(got.sessionId).toBeUndefined();
  });
  it("a messages() failure (missing/corrupt transcript) degrades to the no-history notice, not a throw", async () => {
    const got = await prepareAttach("w1", { resolve: () => row({ sessionId: "u-live" }), messages: async () => { throw new Error("ENOENT"); } });
    expect(got.initialLines).toEqual([{ text: "⚠ no persisted history yet — showing live turn only", dim: true }]);
  });
});
