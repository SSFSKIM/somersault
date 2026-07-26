import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { readRoster } from "../../src/fleet/roster.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-teardown-"));

/** A session whose dispose NEVER settles — exactly what a turn whose request never returns produces. */
const wedged = (over: Record<string, unknown> = {}) => ({
  sessionId: "sid",
  submit: async () => undefined,
  dispose: () => new Promise<void>(() => {}),
  ...over,
});

const hostWith = (session: any, env: NodeJS.ProcessEnv, disposeGraceMs?: number) =>
  new SessionHost({ short: "ffffffff", name: "t", cwd: "/tmp", kind: "bg", config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start", disposeGraceMs });

describe("SessionHost teardown", () => {
  it("returns even when dispose never settles", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const host = hostWith(wedged(), env, 50);
    await host.start();
    await expect(host.stop("stopped")).resolves.toBeUndefined();   // must not hang
    expect(readRoster("ffffffff", env)?.state).toBe("stopped");
  }, 10_000);

  it("closes the socket server even when dispose never settles", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const host = hostWith(wedged(), env, 50);
    await host.start();
    await host.stop("stopped");
    // The server's own close promise is the observable: a host that left it open is a host that will
    // never exit, which is the whole defect.
    await expect((host as any).server.closed).resolves.toBeUndefined();
  }, 10_000);

  it("interrupts the turn before disposing, so the normal path never needs the timeout", async () => {
    const order: string[] = [];
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const session = wedged({
      interrupt: async () => { order.push("interrupt"); },
      dispose: async () => { order.push("dispose"); },
    });
    const host = hostWith(session, env);
    await host.start();
    await host.stop("stopped");
    expect(order).toEqual(["interrupt", "dispose"]);
  });

  it("a session with no interrupt() is disposed anyway", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const disposed = vi.fn(async () => {});
    const host = hostWith({ sessionId: "s", submit: async () => undefined, dispose: disposed }, env);
    await host.start();
    await host.stop("stopped");
    expect(disposed).toHaveBeenCalled();
  });

  it("a throwing interrupt does not prevent teardown", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const disposed = vi.fn(async () => {});
    const host = hostWith({ sessionId: "s", submit: async () => undefined, dispose: disposed,
      interrupt: async () => { throw new Error("no interrupt for you"); } }, env);
    await host.start();
    await expect(host.stop("stopped")).resolves.toBeUndefined();
    expect(disposed).toHaveBeenCalled();
  });
});
