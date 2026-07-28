// test/integration/loopback.test.ts — Task 7: the foreground code path end to end, minus ink itself.
// A real SessionHost (detached:false, exactly the shape runForegroundImpl builds) behind a real UDS
// server, driven by remoteChatSession(path) exactly as the REPL's makeSession() would drive it: connect,
// submit a turn, see it render from events, park/answer a permission over the SAME live connection (the
// connection-counted rule that makes a loopback client's mere presence what keeps a request parked
// instead of denied), then tear down bounded (<2s, the teardown-liveness class this project keeps
// re-verifying).
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";

const fleets: string[] = [];
const tmpFleet = () => { const d = mkdtempSync(join(tmpdir(), "ccx-loop-")); fleets.push(d); return d; };
afterEach(() => { for (const d of fleets.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A session we drive by hand — mirrors test/integration/host-client.test.ts's `drivable()`. */
function drivable() {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  return {
    sessionId: "sid-loop",
    submit(_p: string, onMessage: (m: unknown) => void) {
      emit = onMessage;
      return new Promise<unknown>((r) => { finish = () => r(undefined); });
    },
    dispose: async () => {},
    interrupt: async () => {},
    emit: (m: unknown) => emit(m),
    finish: () => finish(),
  };
}

async function startHost() {
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const session = drivable();
  // detached:false is the exact shape runForegroundImpl builds (spec A2b §4) — the case in which a
  // permission must PARK only because a live connection is present, and deny the instant it is not.
  const host = new SessionHost(
    { short: "eeeeeeee", name: "loop", cwd: process.cwd(), kind: "interactive", detached: false, config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" });
  await host.start();
  return { host, session, env, path: hostSocketPath(process.pid, env) };
}

const stopQuietly = (host: SessionHost) => host.stop("done").catch(() => {});

describe("foreground loopback round trip (Task 7)", () => {
  it("whenReady → submit renders from events and returns the result; a parked permission on the SAME connection PARKS, answerDecision settles it, and teardown is bounded", async () => {
    const { host, session, path } = await startHost();
    const client = remoteChatSession(path);
    try {
      await client.whenReady();

      // --- submit renders from events, and the turn's result comes back ---
      const seen: any[] = [];
      const submitPromise = client.submit("go", (m) => seen.push(m));
      await new Promise((r) => setTimeout(r, 60));            // let the prompt op round-trip and runTask start
      session.emit({ type: "assistant", n: 1 });
      session.emit({ type: "assistant", n: 2 });
      session.emit({ type: "result", n: 3, result: "done!" });
      session.finish();
      const out = await submitPromise as { result?: any };
      expect(seen.map((m) => m.n)).toEqual([1, 2, 3]);
      expect(out.result).toMatchObject({ type: "result", result: "done!" });

      // --- a permission parked while THIS client is connected must PARK, not deny ---
      const permSeen: { toolUseID: string }[] = [];
      client.onDecision((e) => permSeen.push(e));
      let settled = false;
      const decision = host.broker()
        .request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "t-loop-1", signal: new AbortController().signal })
        .then((d) => { settled = true; return d; });
      await new Promise((r) => setTimeout(r, 60));
      expect(permSeen.map((e) => e.toolUseID)).toEqual(["t-loop-1"]);
      expect(settled).toBe(false);                             // PARKED — the connection-counted rule, loopback case
      expect(client.pendingNow().map((e) => e.toolUseID)).toEqual(["t-loop-1"]);

      // --- answerDecision settles it ---
      const reply = await client.answerDecision("t-loop-1", { kind: "allow_once" });
      expect(reply.ok).toBe(true);
      await expect(decision).resolves.toEqual({ kind: "allow_once" });
      expect(settled).toBe(true);

      // --- teardown: dispose() (detach) then host.stop("done") — bounded, not a hang ---
      const t0 = Date.now();
      await client.dispose();
      await host.stop("done");
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      client.detach();
      await stopQuietly(host);
    }
  });

  it("an interactive (detached:false) host with NO client attached denies a permission immediately, rather than parking it", async () => {
    const { host } = await startHost();
    try {
      await expect(host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t-loop-2", signal: new AbortController().signal }))
        .resolves.toEqual({ kind: "deny" });
    } finally {
      await stopQuietly(host);
    }
  });
});
