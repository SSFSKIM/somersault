// test/live/appserver-m2-router-smoke.test.ts — the EARLY keyed smoke of the frame router (spec D-M2-9).
//
// Why this exists here, before the setters and the seven tasks that follow: the router's routes are frame
// CONDITIONS, and this milestone has already shipped three condition defects that every unit test passed
// (the plan's route table summarized a behavior and lost a qualifier). A fake pushes whatever frame shape
// the author imagined; only the real engine settles which frames actually arrive and what they carry.
//
// This run is deliberately engine-sourced only — it uses no `thread/*/set` method, because those land in
// the NEXT task. It answers exactly the questions a fake cannot:
//   1. does the init latch work against the real engine (record.sessionId ever gets set)?
//   2. does a real result frame reach `thread/tokenUsage/updated` with a non-empty usage payload?
//   3. does the engine emit `system/status` frames carrying `permissionMode` AT ALL — the spec's open
//      empirical question ("whether model/thinkingTokens have an engine-frame carrier at all is settled
//      empirically in Wave 1")? A no here is a finding, not a failure: it tells the mirror it must trust
//      its write-back leg alone for those knobs.
//   4. does the live `userMessage` item's id equal the id the transcript persisted (probe 70's ALIVE
//      verdict, now proven end to end through the shipped seam rather than through the probe's own call)?
// The full router smoke including the client-set leg runs after the setters exist.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AppServer } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

interface Notif { method: string; params: any }

/** Same minimal WS JSON-RPC "lite" client as appserver-m1.test.ts (spec §4: no jsonrpc field). */
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

live("M2 router smoke: the router's frame conditions against the real engine (D-M2-9)", () => {
  it("a real turn drives the init latch, the usage route, and the live userMessage stitch", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-appserver-m2-router-"));
    const server = new AppServer({});
    const { port, close: closeListener } = await listenWs(server, {});
    const ws = await wsOpen(`ws://127.0.0.1:${port}`);
    const client = new RpcClient(ws);
    let threadId: string | undefined;
    try {
      await client.call("initialize", { clientInfo: { name: "m2-router-smoke" }, watchThreads: true });

      // settingSources: [] for the same reason as the M1 acceptance — a developer's own settings must not
      // change what the engine does here. bypassPermissions keeps the run parkless and fast: this smoke is
      // about FRAMES, and the park machinery already has its own keyed coverage.
      const started = await client.call("thread/start", {
        config: { permissionMode: "bypassPermissions", cwd, settingSources: [], model: "claude-haiku-4-5-20251001" },
        unattended: "park",
      });
      threadId = started.thread.id;
      await client.call("thread/subscribe", { threadId });

      const turn = await client.call("turn/start", { threadId, input: "Reply with exactly: router-smoke-ok" });
      const turnId = turn.turn.id;

      const completed = await client.waitFor("turn/completed", 90_000, (n) => n.method === "turn/completed" && n.params.threadId === threadId);
      expect(completed.params.turn.status).toBe("completed");

      // (2) The usage route, against a real result frame. The unit test pushes a hand-built frame; this is
      // the only proof that the SHAPE the route matches is the shape the engine actually sends.
      const usage = await client.waitFor("thread/tokenUsage/updated", 15_000, (n) => n.method === "thread/tokenUsage/updated" && n.params.threadId === threadId);
      expect(usage.params.usage, "the usage route fired but carried an empty payload — the result frame's field names differ from what routeTokenUsage reads").toBeTruthy();
      expect(Object.keys(usage.params.usage).length).toBeGreaterThan(0);

      // (1) The init latch: a thread whose sessionId never latched reads back an empty page no matter how
      // many turns completed (the M1 lesson — unit fakes set sessionId eagerly at construction).
      const read = await client.call("thread/read", { threadId }, 30_000);
      expect(read.data.length, "thread/read returned an empty page — record.sessionId never latched").toBeGreaterThan(0);

      // (4) The live userMessage item's id must BE the persisted id (probe 70 ALIVE, now end to end
      // through the shipped submit seam rather than the probe's own direct call).
      const liveUser = client.notifications
        .filter((n) => n.method === "item/completed")
        .map((n) => n.params.item)
        .find((it: any) => it.type === "userMessage");
      expect(liveUser, "no live userMessage item was emitted for the turn").toBeTruthy();
      const persistedUser = read.data.find((it: any) => it.id === liveUser.id);
      expect(persistedUser, `the live userMessage id ${liveUser?.id} is absent from the transcript page — the caller-supplied uuid did not survive the shipped seam (probe 70 said it would); read ids: ${JSON.stringify(read.data.map((i: any) => i.id))}`).toBeTruthy();

      // (3) The open empirical question. NOT an assertion — the answer is the deliverable either way, and
      // the spec says so: if the engine never carries these on a frame, the mirror trusts its write-back
      // leg alone for model/thinkingTokens. Printed so the controller records the verdict in the spec.
      const settingsFrames = client.notifications.filter((n) => n.method === "thread/settings/changed");
      const routerMethods = [...new Set(client.notifications.map((n) => n.method))].sort();
      console.log(JSON.stringify({
        smokeVerdict: {
          turnId,
          engineSourcedSettingsChanged: settingsFrames.length,
          settingsPayloads: settingsFrames.map((n) => n.params),
          allNotificationMethodsObserved: routerMethods,
        },
      }, null, 2));
    } finally {
      if (threadId) { try { await client.call("thread/close", { threadId }, 10_000); } catch { /* best-effort cleanup */ } }
      ws.close();
      await closeListener();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 150_000);
});
