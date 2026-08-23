// harness/test/fixtures/preF10DaemonServer.ts — F10 T-IMGREACH Task 12 (I4): a VENDORED (not simulated)
// pre-F10 daemon peer. This is the exact `onConnection`/`handle` error-handling shape of
// src/daemon/server.ts as it stood at commit b78ee57572 (this task's own parent) — ONE catch spanning
// both `JSON.parse` and schema validation, so every rejected op comes back as the identical
// `bad request: <message>` shape regardless of WHY it was rejected. That monolithic shape is exactly
// what makes a pre-F10 daemon unable to tell "never heard of this literal" apart from "payload is
// wrong" — the asymmetry the client-side skew mapping (`DAEMON_IMAGE_SKEW_NOTICE`, src/daemon/
// connect.ts) exists to close from the CLIENT's side, since the peer itself cannot.
//
// The op union below is deliberately NARROWER than the real pre-F10 `daemonOp` (only `submit`, the one
// op this task's tests actually exercise) — narrowing it further only makes the fixture MORE honest
// about not knowing `submit_content`, never less.
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";

const submitOp = z.object({ op: z.literal("submit"), id: z.string(), prompt: z.string() });
const preF10DaemonOp = z.discriminatedUnion("op", [submitOp]);

export interface PreF10DaemonServer {
  path: string;
  /** Every op RAW (pre-schema, pre-rejection) this server's socket ever received a full line for —
   *  including ones the vendored schema went on to refuse. This is what lets a test assert the client
   *  sent `submit_content` exactly once even though the fixture itself never parses that literal. */
  ops: unknown[];
  close(): Promise<void>;
}

export function startPreF10DaemonServer(): Promise<PreF10DaemonServer> {
  const dir = mkdtempSync(join(tmpdir(), "cc-daemon-pref10-"));
  const path = join(dir, "sock");
  const ops: unknown[] = [];

  const send = (sock: Socket, o: unknown) => sock.write(JSON.stringify(o) + "\n");
  // VENDORED VERBATIM (commit b78ee57572, daemon/server.ts:63-67's shape): one catch, one message
  // family, for both a JSON.parse failure and a schema-validation failure alike.
  const handle = (sock: Socket, line: string): void => {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch (e) { send(sock, { ok: false, error: `bad request: ${(e as Error).message}` }); sock.end(); return; }
    ops.push(raw);
    let op;
    try { op = preF10DaemonOp.parse(raw); }
    catch (e) { send(sock, { ok: false, error: `bad request: ${(e as Error).message}` }); sock.end(); return; }
    if (op.op === "submit") {
      send(sock, { type: "chunk", message: { type: "assistant", message: { content: [{ type: "text", text: "ack" }] } } });
      send(sock, { type: "done", result: "did:" + op.prompt });
      sock.end();
    }
  };

  const server = createServer((sock) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      sock.off("data", onData);
      handle(sock, buf.slice(0, nl));
    };
    sock.on("data", onData);
    sock.on("error", () => {});
  });

  return new Promise((resolve) => {
    server.listen(path, () => resolve({
      path,
      ops,
      close: () => new Promise<void>((r) => server.close(() => r())),
    }));
  });
}
