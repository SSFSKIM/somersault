import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWarmPool } from "../../src/warm/pool.js";
import type { StartupFn, WarmHandle } from "../../src/warm/pool.js";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Fake startup: records warmed options, mints handles whose query() echoes prompts as one result. */
function fakeStartup(log: { options: Record<string, unknown>[]; handles: FakeHandle[] }): StartupFn {
  return async ({ options }) => {
    log.options.push(options);
    const h = new FakeHandle();
    log.handles.push(h);
    return h;
  };
}
class FakeHandle implements WarmHandle {
  closed = false;
  queried: unknown | undefined;
  query(prompt: unknown) {
    this.queried = prompt;
    return (async function* () { for await (const t of prompt as AsyncIterable<any>) yield { type: "result", subtype: "success", result: "warm:" + t.message.content }; })();
  }
  close() { this.closed = true; }
}

describe("createWarmPool (W3.2)", () => {
  it("fills to size on creation and refills after take", async () => {
    const log = { options: [] as Record<string, unknown>[], handles: [] as FakeHandle[] };
    const pool = createWarmPool({}, { size: 2, deps: { startup: fakeStartup(log) } });
    await tick();
    expect(pool.stats()).toMatchObject({ warm: 2, pending: 0, taken: 0, misses: 0 });
    expect(pool.take()).not.toBeNull();
    await tick();
    expect(pool.stats()).toMatchObject({ warm: 2, taken: 1 }); // topped back up
    expect(log.handles.length).toBe(3);
    pool.close();
  });

  it("returns null (and counts a miss) when empty — caller cold-spawns", async () => {
    let release!: (h: WarmHandle) => void;
    const slow: StartupFn = () => new Promise((r) => { release = r; });
    const pool = createWarmPool({}, { size: 1, deps: { startup: slow } });
    expect(pool.take()).toBeNull();
    expect(pool.stats().misses).toBe(1);
    release(new FakeHandle());
    await tick();
    expect(pool.take()).not.toBeNull();
    pool.close();
  });

  it("frozen delegate routes to the broker bound at take(); unbound fails CLOSED", async () => {
    const log = { options: [] as Record<string, unknown>[], handles: [] as FakeHandle[] };
    const pool = createWarmPool({}, { size: 1, deps: { startup: fakeStartup(log) } });
    await tick();
    const frozen = log.options[0].canUseTool as (n: string, i: unknown) => Promise<any>;
    expect(typeof frozen).toBe("function");
    // before any binding: deny (never allow-by-default)
    expect((await frozen("Bash", {})).behavior).toBe("deny");
    const seen: string[] = [];
    pool.take({ canUseTool: async (name) => { seen.push(name); return { behavior: "allow" }; } });
    expect((await frozen("Bash", {})).behavior).toBe("allow");
    expect(seen).toEqual(["Bash"]);
    pool.close();
  });

  it("falls back to the base config's broker when no binding is given", async () => {
    const log = { options: [] as Record<string, unknown>[], handles: [] as FakeHandle[] };
    const decisions: string[] = [];
    const pool = createWarmPool(
      { permissionBroker: { request: async (req) => { decisions.push(req.toolName); return { kind: "allow_once" }; } } },
      { size: 1, deps: { startup: fakeStartup(log) } },
    );
    await tick();
    pool.take(); // no binding
    const frozen = log.options[0].canUseTool as (n: string, i: unknown, o?: unknown) => Promise<any>;
    const d = await frozen("Read", {}, { suggestions: [] });
    expect(d.behavior).toBe("allow");
    expect(decisions).toEqual(["Read"]);
    pool.close();
  });

  it("close() discards warm slots AND late-arriving warms; take-after-close is null", async () => {
    const log = { options: [] as Record<string, unknown>[], handles: [] as FakeHandle[] };
    let release!: (h: WarmHandle) => void;
    let calls = 0;
    const startup: StartupFn = async ({ options }) => {
      calls++;
      if (calls === 1) { log.options.push(options); const h = new FakeHandle(); log.handles.push(h); return h; }
      return new Promise((r) => { release = r; }); // second warm stays in flight
    };
    const pool = createWarmPool({}, { size: 2, deps: { startup } });
    await tick();
    expect(pool.stats()).toMatchObject({ warm: 1, pending: 1 });
    pool.close();
    expect(log.handles[0].closed).toBe(true);
    const late = new FakeHandle();
    release(late);
    await tick();
    expect(late.closed).toBe(true);            // teardown-liveness: in-flight warm closed on arrival
    expect(pool.take()).toBeNull();
    expect(pool.stats().warm).toBe(0);
  });

  it("lease.discard() closes an unused handle but never a used one", async () => {
    const log = { options: [] as Record<string, unknown>[], handles: [] as FakeHandle[] };
    const pool = createWarmPool({}, { size: 2, deps: { startup: fakeStartup(log) } });
    await tick();
    const a = pool.take()!;
    a.discard();
    expect(log.handles.some((h) => h.closed)).toBe(true);
    const b = pool.take()!;
    b.queryFn({ prompt: (async function* () {})() });
    b.discard();
    const used = log.handles.find((h) => h.queried);
    expect(used!.closed).toBe(false);
    pool.close();
  });
});

describe("daemon warm path (W3.2)", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "warm-daemon-"));
  const coldQuery = (sink: string[]) => ({ prompt }: any) => {
    sink.push("cold");
    return (async function* () { for await (const t of prompt) yield { type: "result", subtype: "success", result: "cold:" + t.message.content }; })();
  };

  it("a default spawn consumes a warm slot (flagged in the registry); resume spawns stay cold", async () => {
    const log = { options: [] as Record<string, unknown>[], handles: [] as FakeHandle[] };
    const cold: string[] = [];
    const sup = new DaemonSupervisor(
      { query: coldQuery(cold) as any, startup: fakeStartup(log) },
      { dir: dir(), warmPool: { size: 1 } },
    );
    await tick();
    const warmId = sup.spawn({});
    expect(sup.list().find((r) => r.id === warmId)?.warm).toBe(true);
    const r = await sup.submit(warmId, "hi", () => {});
    expect(r.result).toBe("warm:hi");
    expect(cold).toEqual([]);
    const coldId = sup.spawn({ resume: "some-session" });
    expect(sup.list().find((r2) => r2.id === coldId)?.warm).toBeUndefined();
    await sup.submit(coldId, "yo", () => {}).catch(() => {});
    expect(cold).toEqual(["cold"]);
    await sup.shutdown();
  });

  it("a non-default model spawns cold; shutdown closes remaining warm slots", async () => {
    const log = { options: [] as Record<string, unknown>[], handles: [] as FakeHandle[] };
    const cold: string[] = [];
    const sup = new DaemonSupervisor(
      { query: coldQuery(cold) as any, startup: fakeStartup(log) },
      { dir: dir(), warmPool: { size: 1 } },
    );
    await tick();
    const id = sup.spawn({ model: "claude-sonnet-4-6" });
    await sup.submit(id, "hi", () => {});
    expect(cold).toEqual(["cold"]);
    expect(sup.list().find((r) => r.id === id)?.warm).toBeUndefined();
    await sup.shutdown();
    expect(log.handles.every((h) => h.closed)).toBe(true); // pool discarded on shutdown
  });
});
