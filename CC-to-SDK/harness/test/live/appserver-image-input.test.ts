// harness/test/live/appserver-image-input.test.ts — the 2026-08-23 app-server image-input spec's
// acceptance item 8, the one KEYED row: an image declared as `turn/start` input ITEMS reaches a real
// model through the real app-server wire, and the model's reply is about the pixels.
//
// ── QUOTA GATE ─────────────────────────────────────────────────────────────────────────────────────
// Written and landed KEYLESS: the Claude weekly quota was exhausted when this file was authored, so its
// only run so far is the clean skip. THE FIRST KEYED RUN IS DUE AFTER 2026-08-26 1pm, and until it has
// happened this file's verdict is "not yet observed" rather than "green" — a skipped suite proves the
// gating works and nothing else. Everything the keyless side of acceptance can prove is already proven
// by `test/unit/appserver/turns.test.ts`, `test/unit/turn-items.test.ts` and
// `test/integration/host-image-transport.test.ts`; what only a key can settle is whether a real engine
// receives the block array this server assembles as an IMAGE at all, which is the whole subject here.
//
// ── WHAT MAKES THE VERDICT DISCRIMINATING ──────────────────────────────────────────────────────────
// Each leg sends a two-band PNG and asks for both colours in left-to-right order. A model that never saw
// the pixels can guess ONE colour; it cannot produce two independent correct colour names, in order, for
// two different images — which is why the image is banded rather than solid (probe 113's solid-colour
// generator, extended to two bands) and why leg 2 uses a completely different pair. Leg 2 also runs on
// its OWN thread, so leg 1's image is not in its context and cannot be answered from memory.
//
// ── THE TWO ITEM KINDS, BOTH LIVE ──────────────────────────────────────────────────────────────────
// LEG 1 sends a `data:` URL — the path bounded by `MAX_DATA_URL_CHARS` (240,000 chars = 180 KB decoded,
// which binds before the 256 KiB inbound frame does), the one a REMOTE client has. LEG 2 sends a
// `localImage` absolute path — the length-unbounded path (the byte, dimension and format caps still
// apply), resolved by the one-descriptor bounded read, and the only way a client gets a large image to
// the model in v1. They are different resolution routes in `appserver/turnItems.ts` and a green run on
// one says nothing about the other.
//
// Contract assertions (these test OUR code and fail only if we broke something): `turn/start` reports an
// in-flight turn, the turn completes, nothing parks on a `bypassPermissions` thread, and the `userMessage`
// item carries the canonical `[Image #1]` echo after the text fold. The colour assertions are the
// MODEL-DEPENDENT half and are tagged at their site.
//
// Run keyed: set -a; . ../.env; set +a; npx vitest run test/live/appserver-image-input.test.ts
// Prefer the OAuth token (bills the subscription); NEVER print, echo or log either credential.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import WebSocket from "ws";
import { AppServer } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

/** Sonnet, not haiku: the subject is whether the image ARRIVED, so the reading of it must not be the
 *  variable. This is the model `image-submit.e2e.test.ts` already proved reads these exact bytes. */
const SONNET = "claude-sonnet-4-6";
const PROMPT = "Reply with only the two colors in this image, in left-to-right order, as two lowercase words separated by a comma. Nothing else.";

// ---------------------------------------------------------------------------------------------------
// Probe 113's deterministic PNG generator (hand-rolled IHDR/IDAT/IEND, zlib, no image dependency), with
// one change: two vertical colour bands instead of one solid fill. No fixture file, and bytes of exactly
// the kind the live SDK is already known to accept.
// ---------------------------------------------------------------------------------------------------
function bandedPng(left: [number, number, number], right: [number, number, number], size = 64): Buffer {
  const crc = (buf: Buffer): number => {
    let c = ~0;
    for (const byte of buf) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const o = y * (1 + size * 3);
    raw[o] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = x < size / 2 ? left : right;
      raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString("base64")}`;

// ---------------------------------------------------------------------------------------------------
// The wire client — the same minimal WS JSON-RPC "lite" client the M1–M5 live files use (spec §4: no
// jsonrpc field), mirrored rather than imported because none of them exports it.
// ---------------------------------------------------------------------------------------------------
interface Notif { method: string; params: any }

class RpcClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  readonly notifications: Notif[] = [];
  private waiters: Array<{ pred: (n: Notif) => boolean; resolve: (n: Notif) => void }> = [];
  constructor(private ws: WebSocket) {
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      if (typeof m.id !== "undefined" && (Object.prototype.hasOwnProperty.call(m, "result") || Object.prototype.hasOwnProperty.call(m, "error"))) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(Object.assign(new Error(m.error.message), { rpc: true, code: m.error.code, data: m.error.data }));
        else p.resolve(m.result);
        return;
      }
      if (typeof m.method === "string") {
        const n: Notif = { method: m.method, params: m.params ?? {} };
        this.notifications.push(n);
        const i = this.waiters.findIndex((w) => w.pred(n));
        if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(n); }
      }
    });
  }
  /** Index of the next notification to arrive — hand it to `waitFor`/`since` to scope a read to one leg. */
  mark(): number { return this.notifications.length; }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timed out after ${timeoutMs}ms waiting for a reply to ${method} (id ${id})`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitFor(label: string, timeoutMs: number, pred: (n: Notif) => boolean, from = 0): Promise<Notif> {
    const existing = this.notifications.slice(from).find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = { pred, resolve: (n: Notif) => { clearTimeout(timer); resolve(n); } };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label} (saw since mark: ${this.notifications.slice(from).map((n) => n.method).join(", ") || "<nothing>"})`));
      }, timeoutMs);
      this.waiters.push(entry);
    });
  }
  since(from: number): Notif[] { return this.notifications.slice(from); }
}

function wsOpen(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

live("app-server image input — an items turn delivers real pixels to a real engine", () => {
  let root = "";
  let server: AppServer;
  let listener: { port: number; close(): Promise<void> };
  let ws: WebSocket;
  let a: RpcClient;
  const held = new Set<string>();

  /** A thread configured as every other app-server live acceptance configures one: `settingSources: []`
   *  so the developer's own settings cannot change the engine's tools, `bypassPermissions` so nothing
   *  parks (asserted per turn below rather than assumed). */
  async function startThread(cwd: string): Promise<string> {
    const started = await a.call("thread/start", {
      config: { cwd, model: SONNET, settingSources: [], permissionMode: "bypassPermissions", maxTurns: 4 },
      unattended: "park",
    }, 180_000);
    const id = String(started.thread.id);
    held.add(id);
    return id;
  }

  /** One items turn, followed to its end. Returns the model's text and the user echo the server emitted. */
  async function runItemsTurn(threadId: string, input: unknown[], label: string): Promise<{ text: string; userEcho: string }> {
    const mark = a.mark();
    const started = await a.call("turn/start", { threadId, input }, 180_000);
    expect(started.turn?.status, `${label}: turn/start did not report an in-flight turn`).toBe("inProgress");
    const turnId = String(started.turn.id);
    const done = await a.waitFor(`turn/completed (${label})`, 300_000,
      (n) => n.method === "turn/completed" && n.params.threadId === threadId && n.params.turn?.id === turnId, mark);
    expect(done.params.turn.status, `${label}: the turn did not complete cleanly: ${JSON.stringify(done.params.turn)}`).toBe("completed");
    // Nothing parked — the unattended claim, checked rather than assumed.
    expect(a.since(mark).filter((n) => n.method === "decision/requested" && n.params.threadId === threadId).map((n) => n.params.decision?.toolName),
      `${label}: a decision parked on a bypassPermissions thread — the config did not take`).toEqual([]);
    const items = a.since(mark).filter((n) => n.method === "item/completed" && n.params.turnId === turnId);
    const userEcho = items.filter((n) => n.params.item?.type === "userMessage").map((n) => String(n.params.item.text ?? "")).join("");
    const text = items.filter((n) => n.params.item?.type === "agentMessage").map((n) => String(n.params.item.text ?? "")).join("\n").toLowerCase();
    return { text, userEcho };
  }

  beforeAll(async () => {
    // `realpathSync`: on macOS `tmpdir()` is a symlink (/var → /private/var), and `localImage` paths are
    // compared against what the resolver opened.
    root = realpathSync(mkdtempSync(join(tmpdir(), "cc-appserver-image-")));
    server = new AppServer({}); // no token: this run exercises image input, not auth
    listener = await listenWs(server, {});
    ws = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    a = new RpcClient(ws);
    const init = await a.call("initialize", { clientInfo: { name: "image-input-acceptance" }, watchThreads: true });
    expect(init.userAgent).toBe("cc-harness-appserver");
  }, 180_000);

  afterAll(async () => {
    try {
      // The session ids must be read BEFORE the records go: `thread/delete` addresses the STORE, and the
      // registry row is the only thing that maps a thread id to it.
      const sessions = [...held].map((id) => server?.registry.get(id)?.sessionId).filter((s): s is string => !!s);
      for (const id of [...held]) { try { await a?.call("thread/close", { threadId: id }, 30_000); } catch { /* already closed */ } }
      // The one thing a KEYED run leaves in a real store: these threads ran at a temp `cwd`, so their
      // transcripts land in the operator's own `~/.claude/projects/<slug of that cwd>`. Removed here
      // rather than left as litter (`appserver-m5-acceptance.test.ts`'s precedent) — `thread/delete`
      // refuses BUSY on a live thread, which is why it follows the closes rather than replacing them.
      for (const sessionId of sessions) { try { await a?.call("thread/delete", { threadId: sessionId }, 30_000); } catch { /* best-effort */ } }
      try { await server?.shutdown(); } catch { /* best-effort */ }
      ws?.close();
      try { await listener?.close(); } catch { /* best-effort */ }
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("LEG 1 — a `data:` image item: the reply names both bands, and the user echo carries [Image #1]", async () => {
    const threadId = await startThread(root);
    const { text, userEcho } = await runItemsTurn(threadId, [
      { type: "text", text: PROMPT },
      { type: "image", url: dataUrl(bandedPng([255, 0, 0], [0, 0, 255])) },
    ], "leg 1");

    // CONTRACT — the canonical shape's user-visible half: ONE text fold, then the numbered image echo.
    expect(userEcho, "the user echo did not carry the canonical [Image #N] marker").toContain("[Image #1]");
    expect(userEcho.indexOf("[Image #1]"), "the image echo must follow the text fold, not precede it").toBeGreaterThan(0);

    // MODEL-DEPENDENT — the point of the whole file: the reply is about the pixels.
    expect(text, `the reply did not name the left band: ${JSON.stringify(text)}`).toContain("red");
    expect(text, `the reply did not name the right band: ${JSON.stringify(text)}`).toContain("blue");
  }, 600_000);

  it("LEG 2 — a `localImage` item on its own thread: a different pair, read off the filesystem", async () => {
    const png = join(root, "bands.png");
    writeFileSync(png, bandedPng([255, 255, 0], [255, 0, 255]));
    // Its OWN thread: leg 1's image must not be in context, or a remembered answer could pass for a read one.
    const threadId = await startThread(root);
    const { text, userEcho } = await runItemsTurn(threadId, [
      { type: "text", text: PROMPT },
      { type: "localImage", path: png },
    ], "leg 2");

    expect(userEcho, "the user echo did not carry the canonical [Image #N] marker").toContain("[Image #1]");
    // Same ordering claim as leg 1's, on the OTHER resolution route — the canonical shape is a property of
    // `resolveInputItems`, not of how the bytes were obtained, so checking it once would leave half of it
    // unpinned.
    expect(userEcho.indexOf("[Image #1]"), "the image echo must follow the text fold, not precede it").toBeGreaterThan(0);

    // MODEL-DEPENDENT. Magenta is named several ways by different models; the alternation admits the
    // synonyms and nothing else — "red"/"blue" would not satisfy it. These two ARE the cross-leg
    // discriminator: no ANSWER TO THIS PROMPT that satisfies them could have satisfied leg 1's `red` +
    // `blue` — a verbose enough reply naming all four colours would satisfy both assertion sets, which is
    // why the claim is about answering the question rather than about the strings — so a model answering
    // from the prompt alone rather than the pixels cannot pass both legs with one reply. (A
    // literal `not.toEqual(leg1Text)` was dropped: it adds nothing here and passes vacuously whenever
    // leg 1 is filtered out with `-t`, which a quota-bounded keyed run has every reason to do.)
    expect(text, `the reply did not name the left band: ${JSON.stringify(text)}`).toContain("yellow");
    expect(text, `the reply did not name the right band: ${JSON.stringify(text)}`).toMatch(/magenta|purple|pink/);
  }, 600_000);
});
