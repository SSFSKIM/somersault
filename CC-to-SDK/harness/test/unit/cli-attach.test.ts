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
    expect(got.initialEntries).toEqual([]);
    expect(got.sessionId).toBeUndefined();
  });
  // F1 Task 4: ONE ordered, identity-bearing bootstrap stream — never a pre-flattened RenderLine[].
  it("returns one ordered, identified bootstrap stream instead of flattened lines", async () => {
    const messages = [
      { type: "user", uuid: "u-1", message: { content: [{ type: "text", text: "hi" }] }, timestamp: "2026-01-01T00:00:00Z" },
      { type: "assistant", message: { id: "a-1", content: [{ type: "text", text: "hey" }] } },
    ];
    const target = "w1";
    const deps = { resolve: () => row({ sessionId: "u-live" }), messages: async () => messages };
    const prepared = await prepareAttach(target, deps);
    expect(prepared.initialEntries).toEqual(messages.map((message) => ({ kind: "sdk", source: "disk", message }))); expect(prepared).not.toHaveProperty("initialLines");
  });
  it("returns the existing identified dim fallback notice when the disk read fails", async () => {
    const target = "w1";
    const deps = { resolve: () => row({ sessionId: "u-live" }), messages: async () => [] as unknown[] };
    const prepared = await prepareAttach(target, { ...deps, messages: async () => { throw new Error("offline"); } });
    expect(prepared.initialEntries).toEqual([{ kind: "local", identity: "attach:no-persisted-history", event: { kind: "notice", lines: [{ text: "⚠ no persisted history yet — showing live turn only", dim: true }] } }]);
  });
});
