// harness/test/unit/daemon-content.test.ts — F10 T-IMGREACH Task 12 (I4): the daemon transport for
// `submit_content` — a NEW op literal, the 24 MiB canonical-derived frame cap, client-side
// normalize-then-preflight, the 10s partial-line deadline, and honest old-daemon semantics. Every test
// here runs over a REAL Unix domain socket (this track's convention for the daemon layer) — no
// simulated transport.
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, connect } from "node:net";
import type { Socket } from "node:net";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { DaemonServer } from "../../src/daemon/server.js";
import type { DaemonServerTimers } from "../../src/daemon/server.js";
import { daemonRequest } from "../../src/daemon/client.js";
import {
  connectDaemon, daemonSubmitTurn, preflightOp, DaemonFrameTooLargeError, DAEMON_IMAGE_SKEW_NOTICE,
} from "../../src/daemon/connect.js";
import type { DaemonClient, NonEmptyBlocks } from "../../src/daemon/connect.js";
import { daemonOp, DAEMON_MAX_FRAME_BYTES, DAEMON_PARTIAL_LINE_MS } from "../../src/daemon/types.js";
import { normalizeTurnInput, MAX_TOTAL_TEXT } from "../../src/session/turnInput.js";
import type { UserContentBlock, UserTurnInput } from "../../src/session/turnInput.js";
import { startPreF10DaemonServer } from "../fixtures/preF10DaemonServer.js";
import { triple } from "./boundaryTriple.js";

// =====================================================================================================
// Shared fixtures / helpers

const HERE = dirname(fileURLToPath(import.meta.url));
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const img = (data = PNG_1X1): UserContentBlock => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
// A real, header-readable PNG at EXACTLY POST_PROCESS_BYTE_BUDGET (512,000) decoded bytes — the largest
// single image `normalizeTurnInput` will ever pass — read from the committed, deterministic fixture
// (test/fixtures/images/make.mjs) rather than re-synthesized here.
const MAX_IMAGE_B64 = readFileSync(join(HERE, "..", "fixtures", "images", "exactly-512000.png")).toString("base64");
const maxImageBlock = (): UserContentBlock => ({ type: "image", source: { type: "base64", media_type: "image/png", data: MAX_IMAGE_B64 } });

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) { if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
// A short REAL wait — long enough for a same-process UDS write/close to actually propagate, short
// enough that the suite stays fast. Used only where there is nothing to poll FOR (confirming an absence).
const nextTick = () => new Promise<void>((r) => setTimeout(r, 20));

/** A controllable clock satisfying `DaemonServerTimers` — the partial-line deadline's boundary matrix
 *  needs to cross a 10-second cap without a real 10-second wait per row. */
function createFakeTimers(): DaemonServerTimers & { advance(ms: number): void } {
  let now = 0;
  let nextId = 1;
  const pending: { id: number; at: number; fn: () => void }[] = [];
  return {
    setTimeout(fn, ms) { const id = nextId++; pending.push({ id, at: now + ms, fn }); return id; },
    clearTimeout(handle) { const i = pending.findIndex((p) => p.id === handle); if (i >= 0) pending.splice(i, 1); },
    advance(ms: number) {
      now += ms;
      for (const p of [...pending].sort((a, b) => a.at - b.at)) {
        if (p.at > now) continue;
        const i = pending.indexOf(p);
        if (i < 0) continue;   // already cleared by the time its turn came up
        pending.splice(i, 1);
        p.fn();
      }
    },
  };
}

/** A lightweight raw NDJSON server for routing/normalize/preflight cells that need a real socket but
 *  no real Session/SDK plumbing — it records exactly what it received (RAW, pre-schema) and answers a
 *  generic done/result for anything. */
function fixtureDaemon(): Promise<{ server: { path: string }; ops: any[]; rawLines: string[]; connections: number; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const path = join(mkdtempSync(join(tmpdir(), "cc-daemon-fixture-")), "sock");
    const ops: any[] = [];
    const rawLines: string[] = [];
    let connections = 0;
    const srv = createServer((sock: Socket) => {
      connections++;
      let buf = "";
      const onData = (d: Buffer) => {
        buf += d.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        sock.off("data", onData);
        const line = buf.slice(0, nl);
        rawLines.push(line);
        const op = JSON.parse(line);
        ops.push(op);
        sock.write(JSON.stringify({ type: "done", result: `did:${op.op}` }) + "\n");
        sock.end();
      };
      sock.on("data", onData);
      sock.on("error", () => {});
    });
    srv.listen(path, () => resolve({
      server: { path }, ops, rawLines, connections,
      close: () => new Promise<void>((r) => srv.close(() => r())),
    }));
  });
}

/** A REAL DaemonServer + DaemonSupervisor over a fake SDK query: end-to-end frame-cap / deadline /
 *  UTF-8-split behavior, with an honest capture of the content the SUPERVISOR actually submitted (one
 *  layer below the wire, past normalization). `id` is a genuinely spawned session — required so a turn
 *  reaches the fake query rather than dying on "unknown session" before this task's own machinery runs. */
async function realDaemon(opts: { logger?: (m: string) => void; timers?: DaemonServerTimers } = {}): Promise<{
  path: string; id: string; supervisor: { submitted: unknown[] }; closed: () => number;
}> {
  const d = mkdtempSync(join(tmpdir(), "cc-daemon-real-"));
  const path = join(d, "sock");
  const submitted: unknown[] = [];
  const fakeQuery = ({ prompt }: any) => (async function* () {
    for await (const turn of prompt) {
      submitted.push(turn.message.content);
      yield { type: "result", subtype: "success", user_message_uuid: turn.uuid, result: "ok" };
    }
  })();
  const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: join(d, "sessions") });
  const server = new DaemonServer(sup, path, opts);
  await server.listen();
  let closedCount = 0;
  (server as unknown as { server: import("node:net").Server }).server.on("connection", (sock) => sock.on("close", () => { closedCount++; }));
  const id = (await daemonRequest(path, { op: "spawn" }))[0].id as string;
  return { path, id, supervisor: { submitted }, closed: () => closedCount };
}

/** A well-formed `submit_content` op, padded with a plain-ASCII text block until `JSON.stringify` is
 *  EXACTLY `bytes` — asserted before returning, so the padding arithmetic is never trusted blind. */
function opOfExactSerializedSize(bytes: number, id = "i"): unknown {
  const base = { op: "submit_content", id, input: [{ type: "text", text: "" }] };
  const baseLen = Buffer.byteLength(JSON.stringify(base), "utf8");
  if (bytes < baseLen) throw new Error(`target ${bytes} smaller than the base op's own ${baseLen} bytes`);
  const op = { op: "submit_content", id, input: [{ type: "text", text: "x".repeat(bytes - baseLen) }] };
  const actual = Buffer.byteLength(JSON.stringify(op), "utf8");
  if (actual !== bytes) throw new Error(`padding arithmetic off: got ${actual}, wanted ${bytes}`);
  return op;
}
/** Writes a well-formed op of exactly `bytes` (the LINE, excluding the trailing newline) directly to
 *  the socket — bypassing the client entirely, for the SERVER's own bound. */
function writeRawOpOfExactSize(path: string, bytes: number, id = "i"): void {
  const line = JSON.stringify(opOfExactSerializedSize(bytes, id));
  if (Buffer.byteLength(line, "utf8") !== bytes) throw new Error("writeRawOpOfExactSize: size assertion failed");
  const sock = connect(path);
  sock.on("connect", () => sock.write(line + "\n"));
  sock.on("error", () => {});
}

// =====================================================================================================
// Step 2: the client-side old-daemon mapping, against a REAL pre-F10 server (vendored, not simulated).

describe("I4: pre-F10 daemon skew mapping (real vendored peer)", () => {
  it("I4: a schema-valid submit_content answered `bad request` maps to the explicit pre-F10 notice", async () => {
    const fixture = await startPreF10DaemonServer();
    const client = connectDaemon(fixture.path);
    await expect(client.submitContent("id", [{ type: "text", text: "hi" }, img()], () => {}))
      .rejects.toThrow(DAEMON_IMAGE_SKEW_NOTICE);
    await fixture.close();
  });

  it("I4: ZERO legacy-fallback text turns — the client never downgrades to `submit`", async () => {
    const fixture = await startPreF10DaemonServer();
    const client = connectDaemon(fixture.path);
    await client.submitContent("id", [{ type: "text", text: "hi" }, img()], () => {}).catch(() => {});
    expect(fixture.ops).toHaveLength(1);
    expect((fixture.ops[0] as { op: string }).op).toBe("submit_content");
    await fixture.close();
  });

  it("I4: an ordinary `submit` against the same pre-F10 server still works — the mapping is SCOPED", async () => {
    // If the notice leaked onto `submit`, every text turn against an old daemon would claim an image skew.
    const fixture = await startPreF10DaemonServer();
    const client = connectDaemon(fixture.path);
    await expect(client.submit("id", "hello", () => {})).resolves.toMatchObject({ result: expect.anything() });
    await fixture.close();
  });
});

// =====================================================================================================
// Step 2b: the routing contract.

// COMPILE-TIME ONLY — never invoked (vitest only transpiles test bodies with esbuild and never
// type-checks; `npm run typecheck`'s `tsc --noEmit` is what reads these). Wrapping the bad-shaped calls
// in functions this file never calls keeps them from actually executing at runtime while still making
// each `@ts-expect-error` a real, enforced pin: if the call below it ever stopped being a type error,
// `tsc` would fail on an "unused directive" instead.
function _typeCheck_submitContentRejectsAString(client: DaemonClient): void {
  // @ts-expect-error — a string belongs on `submit`; if this line ever compiles, the narrowing regressed
  void client.submitContent("id", "hello", () => {});
}
function _typeCheck_submitContentRejectsEmptyArray(client: DaemonClient): void {
  // @ts-expect-error — `[]` is not assignable to NonEmptyBlocks; the wire schema's `.min(1)` agrees.
  void client.submitContent("id", [], () => {});
}
void _typeCheck_submitContentRejectsAString;
void _typeCheck_submitContentRejectsEmptyArray;

describe("I4: the routing contract", () => {
  it("I4: submitContent does not ACCEPT a string — the type is the routing rule", () => {
    expect(typeof _typeCheck_submitContentRejectsAString).toBe("function");
  });

  it("I4: submitContent does not ACCEPT an EMPTY array — a bad payload must not become a skew report", () => {
    expect(typeof _typeCheck_submitContentRejectsEmptyArray).toBe("function");
  });

  it("I4: an empty array forced past the type is refused LOCALLY, never mapped to the skew notice", async () => {
    const { server, ops, close } = await fixtureDaemon();
    const client = connectDaemon(server.path);
    // The cast is the point: this is what a JS caller or a widened future type would do. The local
    // `daemonOp` parse must catch it before the mapping can attribute it to the peer's age.
    const err = await client.submitContent("id", [] as unknown as NonEmptyBlocks, () => {}).catch((e) => e);
    expect(err.message).toMatch(/invalid submit_content payload/);
    expect(err.message).not.toContain(DAEMON_IMAGE_SKEW_NOTICE);
    expect(ops).toHaveLength(0);   // nothing was written
    await close();
  });

  it("I4: daemonSubmitTurn throws on an empty array rather than routing it", () => {
    const client = connectDaemon("unused-sock");
    expect(() => daemonSubmitTurn(client, "id", [] as UserContentBlock[], () => {})).toThrow(/at least one content block/);
  });

  it("I4: daemonSubmitTurn routes a STRING to `submit` — the op literal on the wire says so", async () => {
    const { server, ops, close } = await fixtureDaemon();
    await daemonSubmitTurn(connectDaemon(server.path), "id", "hello", () => {});
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "submit", prompt: "hello" });
    await close();
  });

  it("I4: daemonSubmitTurn routes an ARRAY to `submit_content`", async () => {
    const { server, ops, close } = await fixtureDaemon();
    await daemonSubmitTurn(connectDaemon(server.path), "id", [{ type: "text", text: "hi" }, img()], () => {});
    expect(ops[0]).toMatchObject({ op: "submit_content" });
    expect((ops[0] as { input: unknown[] }).input).toHaveLength(2);
    await close();
  });

  it("I4: every op daemonSubmitTurn can emit PARSES against the live schema", () => {
    for (const input of ["hi", [{ type: "text", text: "hi" }, img()]] as UserTurnInput[]) {
      const op = typeof input === "string" ? { op: "submit", id: "i", prompt: input } : { op: "submit_content", id: "i", input };
      expect(daemonOp.safeParse(op).success).toBe(true);
    }
  });
});

// =====================================================================================================
// Step 3: normalize + preflight before transport.

describe("I4: normalize-then-preflight before transport", () => {
  it("I4: the client normalizes before sending — the wire carries CANONICAL base64", async () => {
    const { server, rawLines, close } = await fixtureDaemon();
    const noisy = PNG_1X1.replace(/(.{20})/g, "$1\n");
    await connectDaemon(server.path).submitContent("id",
      [{ type: "text", text: "x" }, { type: "image", source: { type: "base64", media_type: "image/png", data: noisy } }], () => {});
    expect(rawLines[0]).toContain(PNG_1X1);
    expect(rawLines[0]).not.toContain("\\n");   // no whitespace-padded base64 on this socket
    await close();
  });

  it("I4: THE HONEST PREMISE — no NORMALIZED payload can reach the 24 MiB cap", () => {
    // MAX_AGGREGATE_BYTES retains only ten of these twenty maximum images (5,120,000 decoded bytes) and
    // degrades the rest to short failure text, and MAX_TOTAL_TEXT bounds the text half at ~6 MiB of
    // worst-case escaping. The ceiling on a normalized op is ~13 MiB. The client preflight is
    // defence-in-depth over the SERVER's bound — which raw writers DO exceed (Step 4 below).
    const twenty = Array.from({ length: 20 }, () => maxImageBlock());
    const worst = "\u0001".repeat(MAX_TOTAL_TEXT);   // a control char: 6 bytes each once JSON-escaped
    const input = normalizeTurnInput([{ type: "text", text: worst }, ...twenty]);
    const bytes = Buffer.byteLength(JSON.stringify({ op: "submit_content", id: "i", input }), "utf8");
    expect(bytes).toBeLessThan(DAEMON_MAX_FRAME_BYTES);
  });

  it.each(triple(4096))("I4 boundary: preflightOp at an INJECTED limit, $label", ({ at, passes }) => {
    const op = opOfExactSerializedSize(at);
    if (passes) expect(preflightOp(op, 4096)).toBe(at);
    else expect(() => preflightOp(op, 4096)).toThrow(DaemonFrameTooLargeError);
  });

  it("I4: over-cap is refused BEFORE a byte is written — the request seam is never reached", async () => {
    const { server, connections, close } = await fixtureDaemon();
    const sent: unknown[] = [];
    const client = connectDaemon(server.path, (p, op, onLine) => { sent.push(op); return daemonRequest(p, op, onLine); }, 4096);
    await expect(client.submitContent("id", [{ type: "text", text: "x".repeat(8192) }], () => {}))
      .rejects.toBeInstanceOf(DaemonFrameTooLargeError);
    expect(sent).toHaveLength(0);        // the transport was never invoked…
    expect(connections).toBe(0);         // …so the server never saw a connection
    await close();
  });

  it("I4: DaemonFrameTooLargeError reports both numbers, and the LIMIT is the one in force", async () => {
    const { server, close } = await fixtureDaemon();
    const client = connectDaemon(server.path, daemonRequest, 4096);
    const err = await client.submitContent("id", [{ type: "text", text: "x".repeat(8192) }], () => {}).catch((e) => e);
    expect(err.limit).toBe(4096);                    // the injected limit, not the constant
    expect(err.bytes).toBeGreaterThan(4096);
    expect(new DaemonFrameTooLargeError(1, DAEMON_MAX_FRAME_BYTES).limit).toBe(DAEMON_MAX_FRAME_BYTES);
    await close();
  });

  it("I4: an image-only array reaches the supervisor as the I1-LABELLED block array", async () => {
    const { supervisor, path, id } = await realDaemon();
    await connectDaemon(path).submitContent(id, [img()], () => {});
    expect(supervisor.submitted[0]).toEqual([
      { type: "text", text: "[Image #1]" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1 } },
    ]);
  });
});

// =====================================================================================================
// Step 4: the server's frame cap and partial-line deadline, over real sockets.

describe("I4: the server's frame cap and partial-line deadline", () => {
  it("I4: a ONE-maximum-image prompt succeeds", async () => {
    const { supervisor, path, id } = await realDaemon();
    await connectDaemon(path).submitContent(id, [{ type: "text", text: "x" }, maxImageBlock()], () => {});
    expect(supervisor.submitted[0]).toHaveLength(2);
  });

  it("I4: a TWO-maximum-image prompt succeeds (~1.37 MiB of base64, well inside 24 MiB)", async () => {
    const { supervisor, path, id } = await realDaemon();
    await connectDaemon(path).submitContent(id, [maxImageBlock(), maxImageBlock()], () => {});
    expect((supervisor.submitted[0] as UserContentBlock[]).filter((b) => b.type === "image")).toHaveLength(2);
  });

  it("I4: a maximum JSON-ESCAPED-text prompt succeeds", async () => {
    // MAX_TOTAL_TEXT-1 units of a control character, which JSON-escapes to 6 bytes each — ~6 MiB on the
    // wire. This is the cell the 16 MiB 2-bytes-per-unit derivation would have been fine with and the
    // old 1 MiB cap would have wrongly dropped.
    const text = "\u0001".repeat(MAX_TOTAL_TEXT - 1);
    const { supervisor, path, id } = await realDaemon();
    await connectDaemon(path).submitContent(id, [{ type: "text", text }, img()], () => {});
    expect(((supervisor.submitted[0] as UserContentBlock[])[0] as { text: string }).text).toHaveLength(MAX_TOTAL_TEXT - 1);
  });

  it("I4: a frame over the cap, written RAW, drops the connection", async () => {
    // raw, because the client preflight would refuse it — this is the SERVER's own bound under test
    const { path, closed } = await realDaemon();
    const sock = connect(path);
    sock.on("connect", () => sock.write("x".repeat(DAEMON_MAX_FRAME_BYTES + 1)));
    sock.on("error", () => {});
    await waitFor(() => closed() === 1);
  });

  it("I4: a held-open UNDER-CAP partial line is dropped after the 10s deadline, with a logged reason", async () => {
    const logs: string[] = [];
    const fakeTimers = createFakeTimers();
    const { path } = await realDaemon({ logger: (m: string) => logs.push(m), timers: fakeTimers });
    const sock = connect(path);
    await new Promise<void>((r) => sock.once("connect", r));
    sock.write("{");                                            // one byte, no newline, forever
    await nextTick();                                           // let the byte actually land server-side
    fakeTimers.advance(DAEMON_PARTIAL_LINE_MS + 1);             // strictly past the cap — the timer fires here
    await waitFor(() => sock.destroyed);
    expect(logs.join("\n")).toMatch(/partial line held over .*ms with no newline/);
  });

  it("I4: EOF with a non-empty partial buffer is a DROP, not a parse", async () => {
    const { path, supervisor } = await realDaemon();
    const sock = connect(path);
    sock.on("connect", () => sock.end('{"op":"submit_content","id":"i","inp'));   // half a frame, then EOF
    sock.on("error", () => {});
    await waitFor(() => sock.destroyed);
    expect(supervisor.submitted).toHaveLength(0);
  });

  it("I4: a multi-byte UTF-8 character split across two chunks survives (StringDecoder)", async () => {
    // A naive `chunk.toString("utf8")` accumulator corrupts this — the cell must FAIL against that.
    const { path, supervisor, id } = await realDaemon();
    const multi = Buffer.from("日", "utf8");                 // 3 bytes
    const line = Buffer.from(JSON.stringify({ op: "submit_content", id, input: [{ type: "text", text: "日" }] }) + "\n", "utf8");
    const cut = line.indexOf(multi) + 1;                         // mid-character
    const sock = connect(path);
    await new Promise<void>((r) => sock.once("connect", r));
    sock.write(line.subarray(0, cut));
    await nextTick();
    sock.write(line.subarray(cut));
    await waitFor(() => supervisor.submitted.length === 1);
    expect((supervisor.submitted[0] as UserContentBlock[])[0]).toMatchObject({ text: "日" });
  });
});

// =====================================================================================================
// Step 4b: the daemon's boundary matrix, off the two constants.

describe("I4 boundary matrix", () => {
  it.each(triple(DAEMON_MAX_FRAME_BYTES))("I4 boundary: raw frame of $label bytes", async ({ at, passes }) => {
    const { path, supervisor, closed, id } = await realDaemon();
    writeRawOpOfExactSize(path, at, id);
    // A ~24 MiB write/read/JSON.parse round-trip is real work — the default 2s poll window is tuned for
    // small ops, not this one.
    if (passes) await waitFor(() => supervisor.submitted.length === 1, 15_000);
    else await waitFor(() => closed() === 1, 15_000);
  }, 20_000);

  it.each(triple(DAEMON_PARTIAL_LINE_MS))("I4 boundary: partial line held $label ms", async ({ at, passes }) => {
    // INCLUSIVE, like every other cap in this track: held for exactly DAEMON_PARTIAL_LINE_MS the line
    // survives; one millisecond more and the connection drops. The server arms its timer at cap+1 for
    // exactly this reason — see the constant's doc comment.
    const fakeTimers = createFakeTimers();
    const { path } = await realDaemon({ timers: fakeTimers });
    const sock = connect(path);
    await new Promise<void>((r) => sock.once("connect", r));
    sock.write("{");
    await nextTick();
    fakeTimers.advance(at);
    await nextTick();
    expect(sock.destroyed).toBe(!passes);
  });

  it("I4 boundary: the deadline is CLEARED by a completed line — a slow but well-formed client is not killed", async () => {
    const fakeTimers = createFakeTimers();
    const { path, supervisor, id } = await realDaemon({ timers: fakeTimers });
    const sock = connect(path);
    await new Promise<void>((r) => sock.once("connect", r));
    sock.write(`{"op":"submit","id":"${id}","prompt":"hi"}\n`);
    fakeTimers.advance(DAEMON_PARTIAL_LINE_MS * 3);
    await waitFor(() => supervisor.submitted.length === 1);
    expect(sock.destroyed).toBe(false);
  });
});
