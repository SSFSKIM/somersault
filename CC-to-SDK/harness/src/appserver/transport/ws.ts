// appserver/transport/ws.ts — WebSocket transport wrapping AppServer.connect() (spec §11): binds
// loopback by default, refuses a present-but-disallowed Origin at the HTTP upgrade itself (a real 403,
// before any WebSocket exists), and never reads the token off the URL/query — initialize's own Bearer
// check (Task 6, server.ts) is the only auth path this transport defers to.
//
// Origin allowlist semantics: an ABSENT Origin header (a non-browser client — CLI, curl, this test
// suite) is always allowed; browsers always send Origin, so absence can't be a browser-attacker bypass.
// A PRESENT Origin is checked against `allowOrigins`: if the option is omitted entirely, any origin is
// allowed (no allowlist configured — the caller opted out of the check); if it is explicitly `[]`, no
// origin passes (lock the door with an empty list). `ws`'s `verifyClient(info, cb)` 2-arg form is the
// right hook here — `cb(false, 403, msg)` makes `ws` write a real "HTTP/1.1 403 …" response and destroy
// the socket, so the client sees a genuine upgrade-time 403 rather than a silently-dropped connection.
import { WebSocketServer, type WebSocket } from "ws";
import type { AppServer } from "../server.js";
import type { PeerSink } from "../peer.js";

export interface WsListenOpts { host?: string /* default "127.0.0.1" */; port?: number /* default 0 = ephemeral */; allowOrigins?: string[]; token?: string }

export function listenWs(server: AppServer, opts: WsListenOpts): Promise<{ port: number; close(): Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 0;
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({
      host,
      port,
      verifyClient(info, cb) {
        const origin = info.req.headers.origin;
        if (origin && opts.allowOrigins && !opts.allowOrigins.includes(origin)) { cb(false, 403, "Forbidden"); return; }
        cb(true);
      },
    });
    wss.once("error", reject);
    wss.once("listening", () => {
      const addr = wss.address();
      const boundPort = typeof addr === "object" && addr !== null ? addr.port : port;
      wss.on("connection", (ws: WebSocket) => {
        const sink: PeerSink = {
          write: (line) => ws.send(line.endsWith("\n") ? line.slice(0, -1) : line), // one WS text frame per JSON message — trailing NDJSON newline is transport noise here
          buffered: () => ws.bufferedAmount,
          end: () => ws.close(1013),
        };
        const conn = server.connect(sink);
        ws.on("message", (data) => conn.feed(String(data) + "\n"));
        ws.on("close", () => conn.close());
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
