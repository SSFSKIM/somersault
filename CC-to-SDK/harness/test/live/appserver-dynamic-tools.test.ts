// harness/test/live/appserver-dynamic-tools.test.ts — the M7 dynamic-tools spec's two KEYED acceptance
// rows (6 and 7): a client declares a tool at `thread/start`, a real model calls it, and the CLIENT is the
// tool runtime — the call travels out as `tool/callRequested` and the client's `tool/callResult` is what
// the model reads back.
//
// ── QUOTA GATE ─────────────────────────────────────────────────────────────────────────────────────
// Written and landed KEYLESS: the Claude weekly quota was exhausted when this file was authored, so its
// only run so far is the clean skip. THE FIRST KEYED RUN IS DUE AFTER 2026-08-26 1pm, and until it has
// happened this file's verdict is "not yet observed" rather than "green" — a skipped suite proves the
// gating works and nothing else. This is the same standing this milestone's sibling live file
// (`appserver-image-input.test.ts`) has, and the scorecard's `tool/callRequested` row carries
// `probe-gated` until both scenarios below have actually run.
//
// ── WHAT ONLY A KEY CAN SETTLE ─────────────────────────────────────────────────────────────────────
// The keyless suites (`test/unit/appserver/dynamic-tools*.test.ts`) already prove the declaration gate,
// the park trio, every teardown, the verbatim advertisement, and the whole exchange through the
// production closure — an MCP client of our own driving the instance the factory was handed. What none of
// them can reach is everything on the far side of the ENGINE:
//
//   1. the declaration survives the SDK→CLI hop as a mounted in-process MCP server at all, `_meta`
//      (`anthropic/alwaysLoad`) included — it is JSON-serialized onto the CLI's control protocol, and only
//      a live run observes what the model was actually offered;
//   2. the model's call rides the ordinary permission surface (`decision/requested` FIRST, then the tool
//      call) rather than bypassing the broker;
//   3. the stream classifies an `mcp__…` tool call as the `mcp` species end to end;
//   4. the model USES the answer the client supplied — the whole product claim;
//   5. the model's `arguments` conform to the declared JSON Schema (scenario B: the `required` field is
//      present in every call), which the in-memory `tools/list` row can only prove was ADVERTISED.
//
// ── THE TWO SCENARIOS ──────────────────────────────────────────────────────────────────────────────
// A (spec row 6) — one thread, one call, the full ordering: `decision/requested` → allow over the wire →
// `tool/callRequested` → `tool/callResult` carrying a value the model could not have invented → an
// `mcp`-species item completes → the reply contains that value. Plus the `mcpServer/set` refusal on the
// same declaring thread (rev 2p's conservative-first rule; a keyed survival row is what would relax it).
// B (spec row 7) — N=3 calls on their own thread, asserting the declared `required` field is present in
// every `arguments` the model sent.
//
// THE DISCRIMINATING VALUE. The answer the client supplies is a nonce the model has no way to produce
// from the prompt: it is generated per run. A reply containing it can only have come from the client's
// own `tool/callResult`, which is exactly the claim.
//
// Run keyed: set -a; . ../.env; set +a; npx vitest run test/live/appserver-dynamic-tools.test.ts
// Prefer the OAuth token (bills the subscription); NEVER print, echo or log either credential.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AppServer } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

/** Sonnet, not haiku: the subject is whether a declared tool is REACHED and its answer USED, so tool-use
 *  competence must not be the variable. */
const SONNET = "claude-sonnet-4-6";

/** Probe 115's raw JSON Schema, verbatim — the declaration shape this milestone was grounded on, carrying
 *  a description, a required string and a bounded integer. */
const PROBE_115_SCHEMA = {
  type: "object",
  properties: {
    ticket: { type: "string", description: "ticket id like ABC-123" },
    severity: { type: "integer", minimum: 1, maximum: 5 },
  },
  required: ["ticket"],
} as const;

const DECLARATION = [
  {
    type: "namespace",
    name: "ops",
    description: "the operations ticket system — the only source of ticket status",
    tools: [
      {
        type: "function",
        name: "ticket_status",
        description: "Look up the current status of one operations ticket. This is the ONLY way to learn a ticket's status; never guess one.",
        inputSchema: PROBE_115_SCHEMA,
      },
    ],
  },
];

/** The model-visible name the SDK publishes a namespaced declaration under. Asserted rather than assumed:
 *  the whole naming invariant rides on the `mcp__<server>__<tool>` prefix surviving. */
const WIRE_TOOL = "mcp__ops__ticket_status";

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
  /** Index of the next notification to arrive — hand it to `waitFor`/`since` to scope a read to one leg. */
  mark(): number { return this.notifications.length; }
  on(listener: (n: Notif) => void): void { this.listeners.push(listener); }
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

live("app-server dynamic tools — a declared tool reaches a real model and the client answers it", () => {
  let root = "";
  let server: AppServer;
  let listener: { port: number; close(): Promise<void> };
  let ws: WebSocket;
  let a: RpcClient;
  const held = new Set<string>();

  /** A DECLARING thread, subscribed. `settingSources: []` so the developer's own settings cannot add MCP
   *  servers or tools; permissionMode is left at its DEFAULT on purpose — scenario A's first claim is that
   *  a dynamic tool parks the ordinary permission decision, which a `bypassPermissions` thread would hide.
   *  `unattended: "park"` is what makes that decision wait for this client instead of being auto-denied. */
  async function startDeclaringThread(): Promise<string> {
    const started = await a.call("thread/start", {
      config: { cwd: root, model: SONNET, settingSources: [], maxTurns: 6 },
      unattended: "park",
      dynamicTools: DECLARATION,
    }, 180_000);
    const id = String(started.thread.id);
    held.add(id);
    await a.call("thread/subscribe", { threadId: id }, 30_000);
    return id;
  }

  beforeAll(async () => {
    // `realpathSync`: on macOS `tmpdir()` is a symlink (/var → /private/var) and the cwd a thread reports
    // is compared against paths the engine resolved.
    root = realpathSync(mkdtempSync(join(tmpdir(), "cc-appserver-dyntools-")));
    server = new AppServer({}); // no token: this run exercises dynamic tools, not auth
    listener = await listenWs(server, {});
    ws = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    a = new RpcClient(ws);
    const init = await a.call("initialize", { clientInfo: { name: "dynamic-tools-acceptance" }, watchThreads: true });
    expect(init.userAgent).toBe("cc-harness-appserver");
    // THE DOWNGRADE MARKER, checked exactly as a declaring client is told to: an old server strips the
    // unknown `dynamicTools` field silently and starts a toolless thread, so its absence means "this
    // server cannot host my tools" and every assertion below would be measuring the wrong thing.
    expect(init.dynamicTools, "initialize did not advertise dynamicTools — the declarations would be silently dropped").toBe(true);
  }, 180_000);

  afterAll(async () => {
    try {
      // The session ids must be read BEFORE the records go: `thread/delete` addresses the STORE, and the
      // registry row is the only thing that maps a thread id to it.
      const sessions = [...held].map((id) => server?.registry.get(id)?.sessionId).filter((s): s is string => !!s);
      for (const id of [...held]) { try { await a?.call("thread/close", { threadId: id }, 30_000); } catch { /* already closed */ } }
      // These threads ran at a temp `cwd`, so their transcripts land in the operator's own
      // `~/.claude/projects/<slug>`; removed rather than left as litter (the M5 acceptance precedent).
      for (const sessionId of sessions) { try { await a?.call("thread/delete", { threadId: sessionId }, 30_000); } catch { /* best-effort */ } }
      try { await server?.shutdown(); } catch { /* best-effort */ }
      ws?.close();
      try { await listener?.close(); } catch { /* best-effort */ }
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("SCENARIO A — permission parks first, the client answers the call, and the model's reply carries the client's own value", async () => {
    const threadId = await startDeclaringThread();
    // A nonce: no prompt-only answer can produce it, so a reply containing it came from the tool result.
    const nonce = `BLOCKED-${randomUUID().slice(0, 8).toUpperCase()}`;

    const mark = a.mark();
    const started = await a.call("turn/start", {
      threadId,
      input: "What is the current status of ticket ABC-123? Use the ops ticket_status tool to find out, then reply with the status verbatim and nothing else.",
    }, 180_000);
    expect(started.turn?.status, "turn/start did not report an in-flight turn").toBe("inProgress");
    const turnId = String(started.turn.id);

    // (1) THE PERMISSION PARKS FIRST. A dynamic tool is an ordinary MCP tool to the broker, so the model's
    //     call must reach the client as a decision before it reaches it as a tool call.
    const requested = await a.waitFor("decision/requested for the dynamic tool", 300_000,
      (n) => n.method === "decision/requested" && n.params.threadId === threadId && n.params.decision?.toolName === WIRE_TOOL, mark);
    const decision = requested.params.decision;
    expect(decision.kind, "the dynamic tool's park is not an ordinary permission decision").toBe("permission");
    // The ORDERING claim, not just the presence one: nothing was asked of the client as a tool call before
    // the permission was asked.
    expect(a.since(mark).filter((n) => n.method === "tool/callRequested").length,
      "a tool/callRequested arrived BEFORE the permission decision — the broker was bypassed").toBe(0);

    expect((await a.call("decision/respond", { threadId, toolUseId: decision.toolUseId, answer: { kind: "allow_once" } }, 30_000)).ok).toBe(true);

    // (2) THE CALL REACHES THE CLIENT, with the active turn's id and the model's own arguments.
    const callNote = await a.waitFor("tool/callRequested", 300_000,
      (n) => n.method === "tool/callRequested" && n.params.threadId === threadId, mark);
    expect(callNote.params.turnId, "the parked call did not name the active turn").toBe(turnId);
    expect(callNote.params.namespace).toBe("ops");
    expect(callNote.params.tool).toBe("ticket_status");
    expect(String(callNote.params.arguments?.ticket ?? ""), "the model omitted the declared required field").toContain("ABC-123");

    // (3) THE CLIENT IS THE TOOL RUNTIME.
    expect(await a.call("tool/callResult", {
      threadId, callId: callNote.params.callId,
      contentItems: [{ type: "inputText", text: nonce }],
      success: true,
    }, 30_000)).toEqual({});

    // Everything the ORDERING claim needed is captured; from here a model that decides to look the ticket
    // up twice must not deadlock the turn on an unanswered park. Installed only now, because an auto-allow
    // armed earlier would have raced the explicit answer above and won.
    a.on((n) => {
      if (n.params?.threadId !== threadId) return;
      if (n.method === "decision/requested" && n.params.decision?.kind === "permission") {
        void a.call("decision/respond", { threadId, toolUseId: n.params.decision.toolUseId, answer: { kind: "allow_once" } }, 30_000).catch(() => {});
      } else if (n.method === "tool/callRequested" && n.params.callId !== callNote.params.callId) {
        void a.call("tool/callResult", { threadId, callId: n.params.callId, contentItems: [{ type: "inputText", text: nonce }], success: true }, 30_000).catch(() => {});
      }
    });

    const done = await a.waitFor("turn/completed", 300_000,
      (n) => n.method === "turn/completed" && n.params.threadId === threadId && n.params.turn?.id === turnId, mark);
    expect(done.params.turn.status, `the turn did not complete cleanly: ${JSON.stringify(done.params.turn)}`).toBe("completed");

    // (4) THE STREAM CLASSIFIES IT AS THE `mcp` SPECIES — items/types.ts's `toolView`, end to end.
    const items = a.since(mark).filter((n) => n.method === "item/completed" && n.params.turnId === turnId).map((n) => n.params.item);
    const toolItem = items.find((i: any) => i?.type === "toolCall" && i.tool === WIRE_TOOL);
    expect(toolItem, `no completed toolCall item named ${WIRE_TOOL}: ${JSON.stringify(items.map((i: any) => i?.tool ?? i?.type))}`).toBeTruthy();
    expect(toolItem.view, "a dynamic tool call did not classify as the mcp species").toBe("mcp");

    // (5) MODEL-DEPENDENT, and the whole product claim: the reply uses what the CLIENT answered.
    const text = items.filter((i: any) => i?.type === "agentMessage").map((i: any) => String(i.text ?? "")).join("\n");
    expect(text, `the reply did not carry the client-supplied tool result: ${JSON.stringify(text)}`).toContain(nonce);
  }, 900_000);

  it("SCENARIO A (second half) — mcpServer/set is refused on the declaring thread", async () => {
    // rev 2p's conservative-first rule, measured on a LIVE declaring thread rather than a fake one: an
    // accepted set would silently erase thread-lifetime state, and whether the SDK's runtime control frame
    // can carry an in-process server instance at all is what a later keyed survival row would settle.
    const threadId = await startDeclaringThread();
    await expect(a.call("mcpServer/set", { threadId, servers: {} }, 30_000)).rejects.toMatchObject({ code: -32602 });
  }, 300_000);

  it("SCENARIO B — the declared schema binds the model: the required field is present in all three calls", async () => {
    // Its OWN thread, so scenario A's answers are not in context. The in-memory `tools/list` row proves the
    // schema was ADVERTISED verbatim; only a live run proves the model's arguments conform to it.
    const threadId = await startDeclaringThread();
    const seen: Array<Record<string, unknown>> = [];
    a.on((n) => {
      // Scenario A owns the permission-ORDERING claim and answers its one decision by hand; this row's
      // subject is the model's arguments, so its three parks are auto-allowed (the M2 acceptance's own
      // `autoAllow` pattern). Left unanswered they would simply hang the turn — the thread is
      // `unattended: "park"` here exactly as it is there.
      if (n.method === "decision/requested" && n.params.threadId === threadId && n.params.decision?.kind === "permission") {
        void a.call("decision/respond", { threadId, toolUseId: n.params.decision.toolUseId, answer: { kind: "allow_once" } }, 30_000).catch(() => {});
        return;
      }
      if (n.method !== "tool/callRequested" || n.params.threadId !== threadId) return;
      seen.push(n.params.arguments ?? {});
      // Answered inline: three sequential calls in one turn only happen if each one settles.
      void a.call("tool/callResult", {
        threadId, callId: n.params.callId,
        contentItems: [{ type: "inputText", text: "open" }],
        success: true,
      }, 30_000).catch(() => {});
    });

    const mark = a.mark();
    const started = await a.call("turn/start", {
      threadId,
      input: "Look up the status of these three tickets with the ops ticket_status tool, one call each: ABC-101, ABC-102, ABC-103. Then reply with one line per ticket.",
    }, 180_000);
    const turnId = String(started.turn.id);
    const done = await a.waitFor("turn/completed (scenario B)", 600_000,
      (n) => n.method === "turn/completed" && n.params.threadId === threadId && n.params.turn?.id === turnId, mark);
    expect(done.params.turn.status, `the turn did not complete cleanly: ${JSON.stringify(done.params.turn)}`).toBe("completed");

    expect(seen.length, `expected at least three tool calls, saw ${seen.length}`).toBeGreaterThanOrEqual(3);
    for (const [i, args] of seen.entries()) {
      // THE ROW'S SUBJECT: `ticket` is the declared `required` field, and it is present and well-typed in
      // EVERY call — that is the claim, so it is asserted per call rather than over the set. `severity` is
      // optional and deliberately unasserted: its bounds are the advertisement's claim, not the model's
      // obligation.
      expect(typeof args.ticket, `call ${i + 1} omitted the required \`ticket\` field: ${JSON.stringify(args)}`).toBe("string");
      expect(String(args.ticket), `call ${i + 1} did not name a ticket: ${JSON.stringify(args)}`).toMatch(/ABC-10[123]/);
    }
    // All three tickets were actually looked up — a count alone would pass on one ticket fetched thrice.
    // Stated as coverage rather than as an exact call count, which no prompt can promise.
    const tickets = new Set(seen.map((s) => String(s.ticket)));
    for (const id of ["ABC-101", "ABC-102", "ABC-103"]) {
      expect([...tickets].join(","), `no call named ${id}`).toContain(id);
    }
  }, 900_000);
});
