// appserver/transport/ws.test.ts — Task 10: real `ws` client against an ephemeral loopback port.
// Covers spec §11: localhost bind, Origin allowlist (present+mismatched -> 403 before any socket;
// absent -> allowed; omitted allowOrigins fails closed), initialize-carried token (never URL/query),
// one-frame-one-message round trips, close() actually releasing the port, a per-connection protocol
// error not taking down the process or other connections, and a durable server-level error handler.
import { describe, it, expect } from "vitest";
import net from "node:net";
import crypto from "node:crypto";
import WebSocket from "ws";
import { AppServer } from "../../../src/appserver/server.js";
import { listenWs } from "../../../src/appserver/transport/ws.js";

// A raw TCP client that performs the HTTP/1.1 Upgrade handshake by hand, then can write arbitrary
// (including protocol-invalid) frames straight onto the wire — `ws`'s own client always masks
// correctly, so reproducing Finding 1 (an unmasked client frame) needs a socket below `ws`'s client API.
function rawUpgrade(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    socket.once("data", (buf) => {
      if (buf.toString("utf8", 0, 12).includes("101")) resolve(socket); else reject(new Error("handshake failed: " + buf.toString()));
    });
    socket.once("error", reject);
  });
}

const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "s" });
const rpc = (ws: WebSocket, obj: object) => ws.send(JSON.stringify(obj));
const once = (ws: WebSocket) => new Promise<any>((r) => ws.once("message", (d) => r(JSON.parse(String(d)))));
const opened = (ws: WebSocket) => new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });

describe("ws transport", () => {
  it("initialize with token over ws; bad origin refused with 403 before any socket", async () => {
    const srv = new AppServer({ token: "tok" }, { sessionFactory: () => fakeSession() });
    const { port, close } = await listenWs(srv, { token: "tok", allowOrigins: ["http://ok.test"] });
    const bad = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: "http://evil.test" } });
    const badErr = await new Promise<any>((r) => bad.once("unexpected-response", (_req, res) => r(res)));
    expect(badErr.statusCode).toBe(403);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: "http://ok.test" } });
    await opened(ws);
    rpc(ws, { id: 1, method: "initialize", params: { clientInfo: { name: "web" }, authorization: "Bearer tok" } });
    expect((await once(ws)).result.userAgent).toBe("cc-harness-appserver");
    ws.close();
    await close();
  });

  it("a client with no Origin header at all is allowed (non-browser clients aren't blocked)", async () => {
    const srv = new AppServer({ token: "tok" }, { sessionFactory: () => fakeSession() });
    const { port, close } = await listenWs(srv, { token: "tok", allowOrigins: ["http://ok.test"] });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await opened(ws);
    rpc(ws, { id: 1, method: "initialize", params: { clientInfo: { name: "cli" }, authorization: "Bearer tok" } });
    expect((await once(ws)).result.userAgent).toBe("cc-harness-appserver");
    ws.close();
    await close();
  });

  it("binds loopback by default (127.0.0.1), not 0.0.0.0", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const { close, port } = await listenWs(srv, {});
    expect(port).toBeGreaterThan(0);
    // A connection from the loopback address itself must succeed — proving the server IS listening
    // there, since binding wrong-address would make even this fail.
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await opened(ws);
    ws.close();
    await close();
  });

  it("two rapid requests over one connection are answered by id, each in its own intact frame (not concatenated or split)", async () => {
    // The title says "by id" and not "in order" because ORDER IS NOT A PROPERTY THIS SERVER OFFERS: nothing
    // in peer.ts or dispatch serialises replies, and several handlers await real disk (`thread/list`,
    // `config/*`, `thread/search`). The body indexes the two replies by id for exactly that reason, and
    // asserting arrival order here would pin a guarantee the transport does not make.
    // listSessions IS DI'd (Task 12): this test asserts thread/list's data is exactly [], and the real
    // store wrapper would otherwise hit this machine's actual ~/.claude/projects (thousands of real sessions).
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), listSessions: async () => [] });
    const { port, close } = await listenWs(srv, {});
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await opened(ws);
    rpc(ws, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    await once(ws); // initialize reply
    const replies: any[] = [];
    const gotBoth = new Promise<void>((resolve) => {
      ws.on("message", (d) => {
        const msg = JSON.parse(String(d));
        if (msg.id === 2 || msg.id === 3) { replies.push(msg); if (replies.length === 2) resolve(); }
      });
    });
    rpc(ws, { id: 2, method: "server/status", params: {} });
    rpc(ws, { id: 3, method: "thread/list", params: {} });
    await gotBoth;
    const byId = new Map(replies.map((r) => [r.id, r]));
    expect(byId.get(2).result.threads).toBe(0);
    expect(byId.get(3).result.data).toEqual([]);
    ws.close();
    await close();
  });

  it("close() releases the port — a new listener can rebind it", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const first = await listenWs(srv, { port: 0 });
    const port = first.port;
    await first.close();
    const srv2 = new AppServer({}, { sessionFactory: () => fakeSession() });
    const second = await listenWs(srv2, { port });
    expect(second.port).toBe(port);
    await second.close();
  });

  it("token is never accepted from the URL/query string", async () => {
    const srv = new AppServer({ token: "tok" }, { sessionFactory: () => fakeSession() });
    const { port, close } = await listenWs(srv, { token: "tok" });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=tok&authorization=Bearer%20tok`);
    await opened(ws);
    rpc(ws, { id: 1, method: "thread/list", params: {} }); // never initialized — URL token must not have authed it
    expect((await once(ws)).error.code).toBe(-33003);
    ws.close();
    await close();
  });

  it("allowOrigins omitted fails closed: a present Origin is refused with 403, absent Origin is still allowed", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const { port, close } = await listenWs(srv, {}); // no allowOrigins at all
    const withOrigin = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: "http://anything.test" } });
    const rejected = await new Promise<any>((r) => withOrigin.once("unexpected-response", (_req, res) => r(res)));
    expect(rejected.statusCode).toBe(403);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`); // no Origin header — non-browser client
    await opened(ws);
    rpc(ws, { id: 1, method: "initialize", params: { clientInfo: { name: "no-origin" } } });
    expect((await once(ws)).result.userAgent).toBe("cc-harness-appserver");
    ws.close();
    await close();
  });

  it("a malformed frame on one connection is isolated — the process survives and a fresh connection still completes initialize", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const { port, close } = await listenWs(srv, {});
    const bad = await rawUpgrade(port);
    bad.write(Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f])); // FIN+text, MASK bit unset — a client frame MUST be masked (RFC 6455 §5.1)
    await new Promise((r) => setTimeout(r, 150)); // give the server-side protocol error time to surface and get handled
    bad.destroy();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await opened(ws);
    rpc(ws, { id: 1, method: "initialize", params: { clientInfo: { name: "after-bad" } } });
    expect((await once(ws)).result.userAgent).toBe("cc-harness-appserver");
    ws.close();
    await close();
  });

  it("caps ws payloads at the protocol's own inbound bound (gap 8)", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const { port, close } = await listenWs(srv, {});
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => ws.once("open", r));
    // Race the "connection closed" expectation against a short bounded timer instead of relying on
    // vitest's own 5000ms test timeout: if the maxPayload guard regresses, the socket never closes, and
    // an unbounded await would fail only by timing out with no assertion message — reading as
    // infrastructure flake rather than a semantic regression. With the guard in place the loopback close
    // lands well inside 300ms; with it reverted the timer wins and the test fails fast on a real assertion.
    let closeCode: number | undefined;
    const closed = new Promise<"closed">((r) => ws.once("close", (code) => { closeCode = code; r("closed"); }));
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), 300); });
    ws.send("x".repeat(300 * 1024)); // > 256 KiB + slack — ws kills the connection below the app layer
    const outcome = await Promise.race([closed, timeout]);
    clearTimeout(timer!);
    expect(outcome).toBe("closed");
    expect(closeCode).toBe(1009); // ws's "message too big" close code
    await close();
  });
});
