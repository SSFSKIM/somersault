import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { HostServer } from "../../src/host/server.js";

let srv: HostServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

function ask(path: string, op: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = connect({ path }, () => s.write(JSON.stringify(op) + "\n"));
    let buf = "";
    s.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { s.end(); resolve(JSON.parse(buf.slice(0, i))); } });
    s.on("error", reject);
  });
}

/** One connection, many ops. `ask` opens a fresh connection per op, so only this exercises the framing
 *  invariant A2's `follow` stream depends on: the socket survives a reply, and survives a rejected op. */
function session(path: string) {
  const s = connect({ path });
  s.on("error", () => {});
  let buf = ""; const waiting: ((v: any) => void)[] = [];
  s.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { const line = buf.slice(0, i); buf = buf.slice(i + 1); waiting.shift()?.(JSON.parse(line)); }
  });
  return {
    ready: new Promise<void>((r) => s.once("connect", () => r())),
    ask: (op: unknown) => { const p = new Promise<any>((r) => waiting.push(r)); s.write(JSON.stringify(op) + "\n"); return p; },
    close: () => s.destroy(),
  };
}

describe("HostServer", () => {
  it("answers a status op with the handler's snapshot", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "blocked", status: "idle", waitingFor: "Bash(rm -rf build/)" }), stop: async () => {} }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "status" })).toEqual({ ok: true, state: "blocked", status: "idle", waitingFor: "Bash(rm -rf build/)" });
  });
  it("rejects an unknown op without killing the connection handler", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const bad = await ask(sock, { op: "nonsense" });
    expect(bad.ok).toBe(false);
    expect(await ask(sock, { op: "status" })).toMatchObject({ ok: true, state: "working" });
  });
  it("serves further ops on the SAME connection after rejecting one", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const c = session(sock); await c.ready;
    expect(await c.ask({ op: "nonsense" })).toMatchObject({ ok: false });
    expect(await c.ask({ op: "status" })).toMatchObject({ ok: true, state: "working" });
    c.close();
  });
  it("invokes the stop handler and resolves `closed`", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    let stopped = false;
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => { stopped = true; } }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "stop" })).toMatchObject({ ok: true });
    expect(stopped).toBe(true);
    const s = srv; srv = undefined;
    await s.close();
    await s.closed;   // Task 7's host awaits this to exit; a `closed` that never settles hangs it forever
  });
  it("close() does not block on an open client connection", async () => {
    // node's server.close() waits for every open connection to end. Without destroying them, the
    // `stop` op deadlocks: the handler calls close(), which waits for the very connection that is
    // waiting for the stop ack. It self-heals only when the client's 1s timeout fires.
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const held = connect({ path: sock });
    await new Promise((r) => held.once("connect", r));
    await Promise.race([srv.close(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("close() hung on an open connection")), 2000))]);
    held.destroy();
    srv = undefined;
  });
  it("close() is idempotent and removes the socket file", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen(); await srv.close(); await srv.close();
    const { existsSync } = await import("node:fs");
    expect(existsSync(sock)).toBe(false);
  });
});
