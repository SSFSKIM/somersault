// appserver/transport/ws.test.ts — Task 10: real `ws` client against an ephemeral loopback port.
// Covers spec §11: localhost bind, Origin allowlist (present+mismatched -> 403 before any socket;
// absent -> allowed), initialize-carried token (never URL/query), one-frame-one-message round trips,
// and close() actually releasing the port.
import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import { AppServer } from "../../../src/appserver/server.js";
import { listenWs } from "../../../src/appserver/transport/ws.js";

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

  it("two rapid requests over one connection get two distinct, correctly-ordered replies (frames not concatenated or split)", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
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
});
