// appserver/transport/ws.ts — WebSocket transport wrapping AppServer.connect() (spec §11): binds
// loopback by default, refuses a present-and-not-allowlisted Origin at the HTTP upgrade itself (a real
// 403, before any WebSocket exists), and never reads the token off the URL/query — initialize's own
// Bearer check (Task 6, server.ts) is the only auth path this transport defers to.
//
// Origin allowlist semantics — FAILS CLOSED by default: an ABSENT Origin header (a non-browser client —
// CLI, curl, this test suite) is always allowed; browsers always send Origin, so absence can't be a
// browser-attacker bypass. A PRESENT Origin is checked against `allowOrigins`, and an OMITTED
// `allowOrigins` behaves exactly like an explicit `[]` — no origin passes. This matters because browsers
// do not gate cross-origin WebSocket upgrades the way they gate fetch/XHR, so any web page open in the
// user's browser can attempt to open a socket to this loopback control plane; a caller must opt a browser
// origin in explicitly via `allowOrigins: [...]`. `ws`'s `verifyClient(info, cb)` 2-arg form is the right
// hook here — `cb(false, 403, msg)` makes `ws` write a real "HTTP/1.1 403 …" response and destroy the
// socket, so the client sees a genuine upgrade-time 403 rather than a silently-dropped connection.
import { WebSocketServer, type WebSocket } from "ws";
import type { AppServer } from "../server.js";
import type { PeerSink } from "../peer.js";

export interface WsListenOpts { host?: string /* default "127.0.0.1" */; port?: number /* default 0 = ephemeral */; allowOrigins?: string[] /* omitted === [] — fails closed; a present Origin header is refused unless explicitly allowlisted */; token?: string }

export function listenWs(server: AppServer, opts: WsListenOpts): Promise<{ port: number; close(): Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 0;
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({
      host,
      port,
      verifyClient(info, cb) {
        const origin = info.req.headers.origin;
        if (!origin) { cb(true); return; } // absent Origin — non-browser client, always allowed
        if ((opts.allowOrigins ?? []).includes(origin)) { cb(true); return; } // omitted allowOrigins === [] — fail closed
        cb(false, 403, "Forbidden");
      },
    });
    // Durable for the server's whole lifetime (not `.once`): a bind failure before "listening" rejects
    // the promise below, but a server-level error AFTER listening (e.g. an OS-level socket error) must
    // not go unhandled — `.once` would consume its single invocation on that later error and leave the
    // next one with no listener at all, crashing the process (Finding 3).
    let settled = false;
    wss.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
    wss.once("listening", () => {
      settled = true;
      const addr = wss.address();
      const boundPort = typeof addr === "object" && addr !== null ? addr.port : port;
      wss.on("connection", (ws: WebSocket) => {
        const sink: PeerSink = {
          write: (line) => ws.send(line.endsWith("\n") ? line.slice(0, -1) : line), // one WS text frame per JSON message — trailing NDJSON newline is transport noise here
          buffered: () => ws.bufferedAmount,
          end: () => ws.close(1013),
        };
        const conn = server.connect(sink);
        let torn = false;
        const teardown = () => { if (torn) return; torn = true; conn.close(); };
        ws.on("message", (data) => conn.feed(String(data) + "\n"));
        ws.on("close", teardown);
        // A protocol-level error (e.g. an unmasked client frame) fires BELOW the app protocol, before any
        // authentication — without this listener Node's EventEmitter throws for lack of one and kills the
        // whole process, taking every other connection with it (Finding 1, CRITICAL). Tear down only this
        // connection through the same path a normal close uses; the server and every other connection
        // keep running.
        ws.on("error", teardown);
      });
      resolve({
        port: boundPort,
        close: () => new Promise<void>((res, rej) => {
          for (const client of wss.clients) client.terminate();
          wss.close((err) => (err ? rej(err) : res()));
        }),
      });
    });
  });
}
