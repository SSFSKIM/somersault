import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-control-"));

/** A fake HostSession exercising every optional control member, per the brief's fixture. `calls`
 *  records each control passthrough so a test can assert the underlying session member actually fired
 *  (not just that `control()` returned {ok:true}). */
function fakeSession(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fake = {
    submit: async (_p: string, on: (m: unknown) => void) => { on({ type: "assistant" }); return { result: {} }; },
    sessionId: "sid-123", dispose: async () => { calls.push("disposed"); },
    setModel: async (m?: string) => { calls.push(`setModel:${m}`); },
    setPermissionMode: async (m: string) => { calls.push(`mode:${m}`); },
    setMaxThinkingTokens: async (t: number | null) => { calls.push(`think:${t}`); },
    capabilities: async () => ({ models: [1], commands: [2], mcpServers: [3] }),
    compact: async () => ({ ok: true, result: "success" }),
    usage: async () => ({ cost: 1 }), getContextUsage: async () => ({ totalTokens: 5 }),
    mcpServerStatus: async () => [{ name: "linear" }],
    reconnectMcpServer: async (n: string) => { calls.push(`rec:${n}`); },
    toggleMcpServer: async (n: string, e: boolean) => { calls.push(`tog:${n}:${e}`); },
    ...over,
  };
  return { calls, fake };
}

const hostFor = (session: unknown, opens?: unknown[]) =>
  new SessionHost(
    { short: "c0c0c0c0", name: "t", cwd: "/tmp", kind: "bg", config: {} as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
    { openSession: (c: unknown) => { opens?.push(c); return session as any; }, procStartOf: async () => "start" },
  );

describe("SessionHost.control", () => {
  it("capabilities round-trips the session's capabilities()", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(await host.control({ op: "capabilities" })).toEqual({ ok: true, models: [1], commands: [2], mcpServers: [3] });
    await host.stop();
  });

  it("set_model calls through to the session and reports ok", async () => {
    const { calls, fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(await host.control({ op: "set_model", model: "m" })).toEqual({ ok: true });
    expect(calls).toContain("setModel:m");
    await host.stop();
  });

  it("throws a named error when the session lacks the member (no compact)", async () => {
    const { fake } = fakeSession({ compact: undefined });
    const host = hostFor(fake);
    await host.start();
    await expect(host.control({ op: "compact" })).rejects.toThrow("compact unsupported by this host");
    await host.stop();
  });

  it("status() carries the session's sessionId", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(host.status().sessionId).toBe("sid-123");
    await host.stop();
  });

  it("stamps turn seq into start/end frames, incrementing once per turn", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const seen: HostEvent[] = [];
    host.follow((e) => seen.push(e));
    await host.runTask("x");
    expect(seen.filter((e) => e.kind === "turn")).toEqual([
      { kind: "turn", phase: "start", seq: 1 },
      { kind: "turn", phase: "end", seq: 1 },
    ]);
    await host.runTask("y");
    const turns = seen.filter((e) => e.kind === "turn");
    expect(turns[turns.length - 2]).toEqual({ kind: "turn", phase: "start", seq: 2 });
    expect(turns[turns.length - 1]).toEqual({ kind: "turn", phase: "end", seq: 2 });
    await host.stop();
  });

  it("turnSeq() reports the seq of the last started turn", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(host.turnSeq()).toBe(0);
    await host.runTask("x");
    expect(host.turnSeq()).toBe(1);
    await host.runTask("y");
    expect(host.turnSeq()).toBe(2);
    await host.stop();
  });

  it("resumeSession swaps the underlying session (openSession called again with resume:id) and disposes the old one", async () => {
    const { calls, fake } = fakeSession();
    const opens: any[] = [];
    const host = hostFor(fake, opens);
    await host.start();
    await host.resumeSession("resume-id-1");
    expect(opens).toHaveLength(2);
    expect(opens[1]).toMatchObject({ resume: "resume-id-1" });
    expect(calls).toContain("disposed");
    await host.stop();
  });

  it("resumeSession is refused while a turn is in flight, same as a second prompt", async () => {
    let resolveSubmit!: () => void;
    const fake = {
      submit: async (_p: string, _on: (m: unknown) => void) => new Promise((r) => { resolveSubmit = () => r({ result: {} }); }),
      sessionId: "sid-123", dispose: async () => {},
    };
    const host = hostFor(fake);
    await host.start();
    const running = host.runTask("x");
    await expect(host.resumeSession("id")).rejects.toThrow(/busy/);
    resolveSubmit();
    await running;
    await host.stop();
  });
});
