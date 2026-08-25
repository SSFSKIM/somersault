// probe 116 — the M7 spec's three KEYED RIDERS, measured on the production app-server wire the same way
// the acceptance file (`test/live/appserver-dynamic-tools.test.ts`) drives it. Run AFTER that file is
// green: these are discovery items riding the same key, not acceptance rows.
//
//   R1 (_meta hop, T6 review): a `deferLoading: true` tool should be ABSENT from the model's direct
//      tool list and reachable only through ToolSearch. The keyless rows prove we EMIT
//      `_meta["anthropic/alwaysLoad"] = false`; only this run shows what the CLI did with it. The
//      discriminator is behavioral: if the hop survived, a ToolSearch toolCall item completes BEFORE the
//      deferred tool's `tool/callRequested`; if it did not, the call arrives with no ToolSearch leg.
//   R2 (audio result, T3 review): `{type:"audio", data, mimeType}` is correct MCP AudioContent and
//      round-trips through a real MCP client — but Claude takes no audio INPUT, so an audio TOOL RESULT
//      may still fail the turn downstream. Unmeasured in either direction until this run.
//   R3 (unsettled park, T6): production `MCP_TOOL_TIMEOUT` is effectively unbounded; the stated bound is
//      the turn's own interrupt. Measured here: a park nobody answers, watched for SPONTANEOUS_WAIT_MS,
//      then interrupted — and the late `tool/callResult` retried after the interrupt to see the real
//      recovery surface a slow client meets.
//
// Run keyed (from harness/):  set -a; . ../.env; set +a; npx tsx scripts/probe-116-m7-keyed-riders.ts
// NEVER print, echo or log either credential.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AppServer } from "../src/appserver/server.js";
import { listenWs } from "../src/appserver/transport/ws.js";

const SONNET = "claude-sonnet-4-6";
const SPONTANEOUS_WAIT_MS = 180_000;

if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.log("P116: no key in env — nothing to measure (source ../.env first)");
  process.exit(0);
}

interface Notif { method: string; params: any }

class RpcClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  readonly notifications: Notif[] = [];
  private waiters: Array<{ pred: (n: Notif) => boolean; resolve: (n: Notif) => void }> = [];
  private listeners: Array<(n: Notif) => void> = [];
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
        for (const l of this.listeners) l(n);
        const i = this.waiters.findIndex((w) => w.pred(n));
        if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(n); }
      }
    });
  }
  mark(): number { return this.notifications.length; }
  on(listener: (n: Notif) => void): void { this.listeners.push(listener); }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timed out after ${timeoutMs}ms waiting for a reply to ${method}`)); }, timeoutMs);
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

/** Minimal valid WAV: RIFF/fmt/data, 8kHz mono 8-bit, 8 samples of midpoint silence (58 bytes). */
function tinyWav(): string {
  const samples = Buffer.alloc(8, 0x80);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(8000, 4);
  fmt.writeUInt32LE(8000, 8); fmt.writeUInt16LE(1, 12); fmt.writeUInt16LE(8, 14);
  const chunk = (id: string, body: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32LE(body.length);
    return Buffer.concat([Buffer.from(id, "ascii"), len, body]);
  };
  const inner = Buffer.concat([Buffer.from("WAVE", "ascii"), chunk("fmt ", fmt), chunk("data", samples)]);
  const riff = chunk("RIFF", inner);
  return `data:audio/wav;base64,${riff.toString("base64")}`;
}

const SCHEMA = {
  type: "object",
  properties: { ticket: { type: "string", description: "ticket id like ABC-123" } },
  required: ["ticket"],
} as const;

async function main() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cc-appserver-p116-")));
  const server = new AppServer({});
  const listener = await listenWs(server, {});
  const ws = await wsOpen(`ws://127.0.0.1:${listener.port}`);
  const a = new RpcClient(ws);
  const held = new Set<string>();

  const init = await a.call("initialize", { clientInfo: { name: "probe-116" }, watchThreads: true });
  console.log(`P116 init: dynamicTools=${init.dynamicTools}`);

  async function startThread(dynamicTools: unknown[]): Promise<string> {
    const started = await a.call("thread/start", {
      config: { cwd: root, model: SONNET, settingSources: [], maxTurns: 12 },
      unattended: "park",
      dynamicTools,
    }, 180_000);
    const id = String(started.thread.id);
    held.add(id);
    await a.call("thread/subscribe", { threadId: id });
    return id;
  }

  /** Allow every permission on the thread; answer tool calls via `answer` (return undefined to LEAVE PARKED). */
  function autopilot(threadId: string, answer: (n: Notif) => unknown | undefined) {
    a.on((n) => {
      if (n.params?.threadId !== threadId) return;
      if (n.method === "decision/requested" && n.params.decision?.kind === "permission") {
        void a.call("decision/respond", { threadId, toolUseId: n.params.decision.toolUseId, answer: { kind: "allow_once" } }).catch(() => {});
      } else if (n.method === "tool/callRequested") {
        const contentItems = answer(n);
        if (contentItems === undefined) return;
        void a.call("tool/callResult", { threadId, callId: n.params.callId, contentItems, success: true }).catch((e) => console.log(`P116 callResult refused: code=${e.code} ${e.message}`));
      }
    });
  }

  try {
    // ── R1: the _meta hop ─────────────────────────────────────────────────────────────────────────
    {
      const nonce = `LOG-${randomUUID().slice(0, 8).toUpperCase()}`;
      const threadId = await startThread([{
        type: "namespace", name: "ops", description: "the operations system",
        tools: [
          { type: "function", name: "ticket_status", description: "Look up one ticket's status.", inputSchema: SCHEMA },
          { type: "function", name: "audit_log", description: "Fetch the audit log for one ticket. The ONLY source of audit data.", inputSchema: SCHEMA, deferLoading: true },
        ],
      }]);
      autopilot(threadId, (n) => [{ type: "inputText", text: n.params.tool === "audit_log" ? nonce : "open" }]);
      const mark = a.mark();
      const started = await a.call("turn/start", {
        threadId,
        input: "Fetch the audit log for ticket ABC-123 using the ops audit_log tool, then reply with the log text verbatim and nothing else.",
      }, 180_000);
      const turnId = String(started.turn.id);
      const done = await a.waitFor("R1 turn/completed", 600_000,
        (n) => n.method === "turn/completed" && n.params.threadId === threadId && n.params.turn?.id === turnId, mark);
      const items = a.since(mark).filter((n) => n.method === "item/completed" && n.params.turnId === turnId).map((n) => n.params.item);
      const toolNames = items.filter((i: any) => i?.type === "toolCall").map((i: any) => String(i.tool));
      const callIdx = a.since(mark).findIndex((n) => n.method === "tool/callRequested" && n.params.tool === "audit_log");
      const searchIdx = a.since(mark).findIndex((n) => n.method === "item/completed" && n.params.item?.type === "toolCall" && /toolsearch/i.test(String(n.params.item?.tool ?? "")));
      const text = items.filter((i: any) => i?.type === "agentMessage").map((i: any) => String(i.text ?? "")).join("\n");
      console.log(`P116 R1: turn=${done.params.turn.status} toolCallItems=[${toolNames.join(", ")}]`);
      console.log(`P116 R1: audit_log callRequested=${callIdx >= 0} ToolSearchItemSeen=${searchIdx >= 0} ToolSearchBeforeCall=${searchIdx >= 0 && callIdx >= 0 && searchIdx < callIdx}`);
      console.log(`P116 R1: replyCarriesNonce=${text.includes(nonce)}`);
      console.log(`P116 R1 verdict: ${callIdx < 0 ? "deferred tool UNREACHABLE — hop or ToolSearch loading failed" : searchIdx >= 0 && searchIdx < callIdx ? "_meta SURVIVED: deferred tool loaded via ToolSearch then called" : "_meta DID NOT gate: call arrived with no ToolSearch leg (alwaysLoad lost or defaulted true)"}`);
    }

    // ── R2: audio tool result ─────────────────────────────────────────────────────────────────────
    {
      const threadId = await startThread([{
        type: "namespace", name: "media", description: "alert sounds",
        tools: [{ type: "function", name: "play_alert", description: "Play the alert sound for a ticket; returns the sound that was played.", inputSchema: SCHEMA }],
      }]);
      const wav = tinyWav();
      autopilot(threadId, () => [{ type: "inputAudio", audioUrl: wav }]);
      const mark = a.mark();
      let outcome = "unknown";
      let detail = "";
      try {
        const started = await a.call("turn/start", {
          threadId,
          input: "Call the media play_alert tool once with ticket ABC-9, then reply with one short sentence describing what the tool returned.",
        }, 180_000);
        const turnId = String(started.turn.id);
        // A failed/interrupted turn still arrives as `turn/completed` — the terminal state lives in
        // `turn.status` ("completed" | "failed" | "interrupted"), turns.ts:342.
        const done = await a.waitFor("R2 turn settlement", 600_000,
          (n) => n.method === "turn/completed" && n.params.threadId === threadId, mark);
        outcome = String(done.params.turn?.status);
        if (done.params.turn?.error) detail = `error=${String(done.params.turn.error)} `;
        const items = a.since(mark).filter((n) => n.method === "item/completed" && n.params.turnId === turnId).map((n) => n.params.item);
        detail += items.filter((i: any) => i?.type === "agentMessage").map((i: any) => String(i.text ?? "")).join(" / ");
      } catch (e: any) {
        outcome = `threw: code=${e.code} ${e.message}`;
      }
      const errs = a.since(mark).filter((n) => /error/i.test(n.method)).map((n) => `${n.method}:${JSON.stringify(n.params).slice(0, 200)}`);
      console.log(`P116 R2: outcome=${outcome} errors=[${errs.join(" | ")}]`);
      console.log(`P116 R2: modelReply=${JSON.stringify(detail).slice(0, 300)}`);
      console.log(`P116 R2 verdict: ${outcome === "completed" ? "audio tool result ACCEPTED end to end" : "audio tool result FAILED downstream — scorecard note due"}`);
    }

    // ── R3: unsettled park ────────────────────────────────────────────────────────────────────────
    {
      const threadId = await startThread([{
        type: "namespace", name: "ops3", description: "the operations system",
        tools: [{ type: "function", name: "ticket_status", description: "Look up one ticket's status. The ONLY source.", inputSchema: SCHEMA }],
      }]);
      autopilot(threadId, () => undefined); // permissions allowed, calls left parked
      const mark = a.mark();
      await a.call("turn/start", {
        threadId,
        input: "Look up the status of ticket ABC-777 with the ops3 ticket_status tool and reply with it.",
      }, 180_000);
      const call = await a.waitFor("R3 tool/callRequested", 300_000,
        (n) => n.method === "tool/callRequested" && n.params.threadId === threadId, mark);
      const t0 = Date.now();
      const settled = await Promise.race([
        a.waitFor("spontaneous settlement", SPONTANEOUS_WAIT_MS,
          (n) => n.method === "turn/completed" && n.params.threadId === threadId, a.mark())
          .then((n) => ({ how: `turn/completed status=${n.params.turn?.status}`, ms: Date.now() - t0 }), () => null),
        new Promise<null>((r) => setTimeout(() => r(null), SPONTANEOUS_WAIT_MS + 5_000)),
      ]);
      if (settled) {
        console.log(`P116 R3: park settled SPONTANEOUSLY via ${settled.how} after ${settled.ms}ms — a production timeout EXISTS`);
      } else {
        console.log(`P116 R3: no spontaneous settlement within ${SPONTANEOUS_WAIT_MS}ms — the park is client-bounded, as designed`);
        const m2 = a.mark();
        await a.call("turn/interrupt", { threadId }, 60_000);
        const after = await a.waitFor("post-interrupt turn settlement", 120_000,
          (n) => n.method === "turn/completed" && n.params.threadId === threadId, m2);
        console.log(`P116 R3: interrupt settled the turn via ${after.method} (turn.status=${after.params.turn?.status}) after ${Date.now() - t0}ms total`);
        try {
          const r = await a.call("tool/callResult", { threadId, callId: call.params.callId, contentItems: [{ type: "inputText", text: "late" }], success: true });
          console.log(`P116 R3: LATE callResult unexpectedly accepted: ${JSON.stringify(r)}`);
        } catch (e: any) {
          console.log(`P116 R3: late callResult refused as expected: code=${e.code} message=${JSON.stringify(e.message)}`);
        }
      }
    }
  } finally {
    const sessions = [...held].map((id) => server.registry.get(id)?.sessionId).filter((s): s is string => !!s);
    for (const id of [...held]) { try { await a.call("thread/close", { threadId: id }, 30_000); } catch { /* closed */ } }
    for (const sessionId of sessions) { try { await a.call("thread/delete", { threadId: sessionId }, 30_000); } catch { /* best-effort */ } }
    try { await server.shutdown(); } catch { /* best-effort */ }
    ws.close();
    try { await listener.close(); } catch { /* best-effort */ }
    rmSync(root, { recursive: true, force: true });
  }
  console.log("P116: done");
  process.exit(0);
}

main().catch((e) => { console.error("P116 FATAL:", e); process.exit(1); });
