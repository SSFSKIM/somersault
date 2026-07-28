// test/live/appserver-m1.test.ts — Task 13: the spec's M1 acceptance, quoted verbatim (§12): "Live
// acceptance: a scripted WS client runs spawn→subscribe→turn→park→respond→completed against a real
// session." Real `AppServer` (default sessionFactory — no DI fakes), real `listenWs` on an ephemeral
// loopback port, a hand-rolled WS JSON-RPC client (same style as wsTransport.test.ts) driving the shipped
// wire end to end against the real SDK.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AppServer } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

interface Notif { method: string; params: any }

/** Minimal WS JSON-RPC "lite" client (spec §4: no jsonrpc field, NDJSON-over-one-frame-per-message —
 *  ws.ts already speaks one text frame per message, see transport/ws.ts). Buffers every notification it
 *  has ever seen so `waitFor` can find one that arrived before the caller started waiting for it — the
 *  park/turn machinery here gives no guarantee about when the test gets around to awaiting a match. */
class RpcClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  readonly notifications: Notif[] = [];
  private waiters: Array<{ pred: (n: Notif) => boolean; resolve: (n: Notif) => void }> = [];
  constructor(private ws: WebSocket) {
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (typeof msg.id !== "undefined" && (Object.prototype.hasOwnProperty.call(msg, "result") || Object.prototype.hasOwnProperty.call(msg, "error"))) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      if (typeof msg.method === "string") {
        const n: Notif = { method: msg.method, params: msg.params ?? {} };
        this.notifications.push(n);
        const i = this.waiters.findIndex((w) => w.pred(n));
        if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(n); }
      }
    });
  }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timed out after ${timeoutMs}ms waiting for a reply to ${method} (id ${id})`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitFor(label: string, timeoutMs: number, pred: (n: Notif) => boolean): Promise<Notif> {
    const existing = this.notifications.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = { pred, resolve: (n: Notif) => { clearTimeout(timer); resolve(n); } };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label} (saw: ${this.notifications.map((n) => n.method).join(", ") || "<nothing>"})`));
      }, timeoutMs);
      this.waiters.push(entry);
    });
  }
}

function wsOpen(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

live("M1 live acceptance: spawn -> subscribe -> turn -> park -> respond -> completed", () => {
  it("a real WS client drives a real session through one full write-permission park/respond cycle", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-appserver-m1-"));
    const server = new AppServer({}); // no token — this test only exercises the wire, not auth (covered by wsTransport.test.ts)
    const { port, close: closeListener } = await listenWs(server, {});
    const ws = await wsOpen(`ws://127.0.0.1:${port}`);
    const client = new RpcClient(ws);
    let threadId: string | undefined;
    try {
      const init = await client.call("initialize", { clientInfo: { name: "m1-live-test" } });
      expect(init.userAgent).toBe("cc-harness-appserver");

      // `settingSources: []` is load-bearing, not tidiness: the harness defaults to loading user +
      // project + local settings, and a developer's own `~/.claude/settings.json` (a `defaultMode`,
      // any `permissions.allow` Bash rule) would pre-authorize the command and the turn would run to
      // completion with no park at all — which is exactly how the first keyed run failed.
      const started = await client.call("thread/start", { config: { permissionMode: "default", cwd, settingSources: [], model: "claude-sonnet-4-6" }, unattended: "park" });
      threadId = started.thread.id;
      expect(threadId).toBeTruthy();

      const sub = await client.call("thread/subscribe", { threadId });
      expect(sub.subscribed).toBe(true);

      // A file write, not a bash command. The first keyed run used `echo appserver-live-ok` and the turn
      // ran clean through to completion with NO park at all: under permissionMode "default" the SDK does
      // not consult canUseTool for a trivial echo, so there was nothing to answer. A write does park —
      // which is also the shape test/live/daemon-permissions.e2e.test.ts already proves for this engine.
      const turn = await client.call("turn/start", { threadId, input: "Create a file note.txt in the current directory containing exactly: appserver-live-ok" });
      expect(turn.turn.status).toBe("inProgress");

      // Park: the model must actually call a write tool and the injected canUseTool broker must actually
      // route it into decision/requested — this is the SDK-level behavior only the keyed run proves.
      const requested = await client.waitFor("decision/requested (write permission)", 90_000, (n) => n.method === "decision/requested" && n.params.threadId === threadId);
      const entry = requested.params.decision;
      expect(entry.kind).toBe("permission");
      expect(["Write", "Edit"]).toContain(entry.toolName);
      expect(typeof entry.toolUseID).toBe("string");

      const respond = await client.call("decision/respond", { threadId, toolUseId: entry.toolUseID, answer: { kind: "allow_once" } });
      expect(respond.ok).toBe(true);

      // decision/resolved's notification field is `toolUseId` (server.ts broadcastDecision) — NOT the
      // `toolUseID` spelling PendingDecision uses; read the shipped code, don't guess the casing.
      await client.waitFor("decision/resolved", 20_000, (n) => n.method === "decision/resolved" && n.params.toolUseId === entry.toolUseID);

      const completed = await client.waitFor("turn/completed", 60_000, (n) => n.method === "turn/completed" && n.params.threadId === threadId);
      expect(completed.params.turn.status).toBe("completed");

      const items = client.notifications.filter((n) => n.method === "item/started" || n.method === "item/completed").map((n) => n.params.item);
      const toolCall = items.find((it) => it.type === "toolCall" && it.view === "fileChange" && (it.tool === "Write" || it.tool === "Edit"));
      expect(toolCall, `expected a Write/Edit toolCall item with view "fileChange" among: ${JSON.stringify(items)}`).toBeTruthy();
      const agentMessage = items.find((it) => it.type === "agentMessage");
      expect(agentMessage, `expected an agentMessage item among: ${JSON.stringify(items)}`).toBeTruthy();
    } finally {
      if (threadId) { try { await client.call("thread/close", { threadId }, 10_000); } catch { /* best-effort cleanup */ } }
      ws.close();
      await closeListener();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});
