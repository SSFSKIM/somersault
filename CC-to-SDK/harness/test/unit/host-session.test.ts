import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { readRoster } from "../../src/fleet/roster.js";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-host-")), HOME: "/home/u" }; });

const opts = () => ({ short: "a1b2c3d4", name: "w1", cwd: "/w", kind: "bg" as const, config: {}, env });
/** Always inject procStartOf: a unit test must not spawn `ps`. */
const deps = (openSession: any) => ({ openSession, procStartOf: async () => "Sat Jul 25 02:55:52 2026" });
/** A fake session: resolves the turn only when we let it, so we can observe `working` mid-flight. */
function fakeSession() {
  let finish!: () => void;
  const turn = new Promise<void>((r) => (finish = r));
  return { finish, session: { submit: async () => { await turn; return { result: {} }; }, sessionId: "sid-1", dispose: async () => {} } };
}

describe("SessionHost", () => {
  it("writes a working roster row at start, before any session id exists", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start();
    expect(readRoster("a1b2c3d4", env)).toMatchObject({ short: "a1b2c3d4", name: "w1", state: "working", kind: "bg" });
    await h.stop();
  });
  it("records its own procStart, so a crashed host can later be told apart from a live one", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start();
    expect(readRoster("a1b2c3d4", env)!.procStart).toBe("Sat Jul 25 02:55:52 2026");
    await h.stop();
  });
  it("records noHumanSeam on the roster row when the caller reports one", async () => {
    const h = new SessionHost({ ...opts(), noHumanSeam: true }, deps(() => fakeSession().session as any));
    await h.start();
    expect(readRoster("a1b2c3d4", env)!.noHumanSeam).toBe(true);
    await h.stop();
  });
  it("reports busy while a turn runs and idle/done after it finishes", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start();
    const running = h.runTask("do it");
    expect(h.status()).toMatchObject({ state: "working", status: "busy" });
    f.finish(); await running;
    expect(h.status()).toMatchObject({ state: "done", status: "idle" });
    await h.stop();
  });
  it("finalizes the roster to done when the task completes", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start(); const running = h.runTask("x"); f.finish(); await running; await h.stop();
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("done"); expect(typeof r.endedAt).toBe("number");
  });
  it("finalizes to error when the turn throws", async () => {
    const h = new SessionHost(opts(), deps(() => ({ submit: async () => { throw new Error("boom"); }, sessionId: "s", dispose: async () => {} }) as any));
    await h.start(); await h.runTask("x").catch(() => {}); await h.stop();
    expect(readRoster("a1b2c3d4", env)!.state).toBe("error");
  });
  it("stop() finalizes to stopped, not done — daemon-finalize.sh routes it down the error arm", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start(); await h.stop("stopped");
    expect(readRoster("a1b2c3d4", env)!.state).toBe("stopped");
  });
  it("records the sessionId into the roster once the engine reports one", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start(); const running = h.runTask("x"); f.finish(); await running; await h.stop();
    expect(readRoster("a1b2c3d4", env)!.sessionId).toBe("sid-1");
  });
});
