import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { readRoster } from "../../src/fleet/roster.js";

const fleets: string[] = [];
const tmpFleet = () => { const d = mkdtempSync(join(tmpdir(), "ccx-int-")); fleets.push(d); return d; };
afterEach(() => { for (const d of fleets.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A session we drive by hand: `emit` pushes a message into the live turn, `finish` ends it, and
 *  `askPermission` fires the broker exactly as the SDK would. */
function drivable() {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  return {
    sessionId: "sid-int",
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

async function startHost(kind: "bg" | "interactive" = "bg") {
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const session = drivable();
  const host = new SessionHost(
    { short: "dddddddd", name: "int", cwd: process.cwd(), kind, config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" });
  await host.start();
  return { host, session, env, path: hostSocketPath(process.pid, env) };
}

describe("host + client over a real socket", () => {
  it("a client follows a live turn it joined late, from the turn's start", async () => {
    const { host, session, path } = await startHost();
    const turn = host.runTask("go");
    session.emit({ type: "assistant", n: 1 });
    session.emit({ type: "assistant", n: 2 });
    const c = await RemoteChatSession.connect(path);
    const seen: any[] = [];
    c.follow((e) => seen.push(e));
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.filter((e) => e.kind === "message").map((e) => e.data.n)).toEqual([1, 2]);
    session.emit({ type: "assistant", n: 3 });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.filter((e) => e.kind === "message").map((e) => e.data.n)).toEqual([1, 2, 3]);
    c.detach(); session.finish(); await turn; await host.stop();
  });

  it("two clients see the same park; the first answer wins and the second is told who answered", async () => {
    const { host, path } = await startHost();
    const a = await RemoteChatSession.connect(path, { label: "tty-a" });
    const b = await RemoteChatSession.connect(path, { label: "tty-b" });
    const seenA: any[] = [], seenB: any[] = [];
    a.follow((e) => seenA.push(e)); b.follow((e) => seenB.push(e));
    const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t9", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 80));
    // EXACT counts, not `.some`. One park must produce one permission event per client; a fan-out that
    // broadcasts once per registered follower delivers it N times to each of N clients, and `.some`
    // passes cheerfully on 2, 4 or 16 copies.
    expect(seenA.filter((e) => e.kind === "permission")).toHaveLength(1);
    expect(seenB.filter((e) => e.kind === "permission")).toHaveLength(1);
    expect((await a.status()).state).toBe("blocked");
    const first = await a.answer("t9", { kind: "allow_once" });
    expect(first.alreadyAnsweredBy).toBeUndefined();
    const second = await b.answer("t9", { kind: "deny" });
    expect(second.ok).toBe(true);
    expect(second.alreadyAnsweredBy).toBe("tty-a");
    await expect(decision).resolves.toEqual({ kind: "allow_once" });   // the FIRST answer, not the last
    a.detach(); b.detach(); await host.stop();
  });

  it("detach leaves the host and its park untouched; a re-attached client still sees the park", async () => {
    const { host, path } = await startHost();
    const a = await RemoteChatSession.connect(path);
    a.follow(() => {});
    const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t10", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 50));
    a.detach();
    await new Promise((r) => setTimeout(r, 50));
    const b = await RemoteChatSession.connect(path);
    expect((await b.pending()).pending.map((p: any) => p.toolUseID)).toEqual(["t10"]);
    expect((await b.status()).state).toBe("blocked");
    await b.answer("t10", { kind: "deny" });
    await expect(decision).resolves.toEqual({ kind: "deny" });
    b.detach(); await host.stop();
  });

  it("stop over the socket records a terminal roster state and settles the park", async () => {
    const { host, env, path } = await startHost();
    const c = await RemoteChatSession.connect(path);
    const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t11", signal: new AbortController().signal });
    await c.stopHost().catch(() => {});          // the host closes the socket as it stops
    await expect(decision).resolves.toEqual({ kind: "deny" });
    expect(readRoster("dddddddd", env)?.state).toBe("stopped");
    c.detach();
  });

  it("an interactive host with no client attached denies rather than parking", async () => {
    const { host } = await startHost("interactive");
    await expect(host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t12", signal: new AbortController().signal }))
      .resolves.toEqual({ kind: "deny" });
    await host.stop();
  });
});
