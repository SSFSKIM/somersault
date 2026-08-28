// test/live/appserver-cross-session.test.ts — M8's keyed acceptance (spec rows 7–11). Gated exactly like
// every other file under test/live/: without a key the whole describe skips, so this runs in CI as a
// no-op and against a real engine when a key is present.
//
// ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────────────────────────────
// Everything the inbound half does hangs off ONE premise no unit test can establish: that a real CLI,
// handed a message over its peer socket, replays it as a `type:"user"` frame carrying
// `origin.kind === "peer"`. That attribution is the WHOLE recognition rule (src/peer/address.ts,
// `peerArrival`) — there is deliberately no envelope-text fallback, because measuring this machine's own
// transcripts found 52 user rows containing a complete `<cross-session-message …>` envelope of which only
// 12 were real arrivals. So the unit suite proves what this server does GIVEN a stamped frame; only a
// keyed run proves the engine stamps one. LEG 1 is that proof, and every later leg presumes it.
//
// ── WHAT THE FIRST KEYED RUN MEASURED (2026-08-28) ─────────────────────────────────────────────────
// Four things this file's own first green run settled, each now carried by an assertion rather than by a
// comment, and two of them are DIVERGENCES from what the spec's prose said:
//
//   M1 · THE HEALTHY TERMINAL IS `completed`, and a peer message SKIPS `queued`. A host turn's bracket is
//        `queued` → `started` → `completed`; an inbound peer message's is `started` → `completed`. Both
//        asserted (LEG 6 for the host shape, LEG 1 for the peer shape) — `isTerminalState` in
//        appserver/peerInbound.ts is written as the NEGATION ("not queued and not started"), so the leg
//        that proves it recognised the terminal is the one whose adopted turn reaches `turn/completed`.
//
//   M2 · THE SUBMIT UUID RIDES ON `command_uuid`, NOT ON `uuid`. The frame's own `uuid` is FRESH on every
//        frame — three different `uuid`s for one `command_uuid` — so `uuid` identifies the FRAME and
//        `command_uuid` identifies the MESSAGE. LEG 6 asserts both halves: `command_uuid` carries the
//        uuid this server submitted under, and no frame's `uuid` ever does. `isOurs` matching both fields
//        is therefore belt-and-braces rather than a coin flip, and the busy gate it leans on is never
//        actually exercised by a mis-match.
//
//   M3 · `turn/started` PRECEDES `thread/peerMessage`, not the other way round. The engine emits the
//        message's `command_lifecycle` `started` BEFORE it replays the `type:"user"` frame — so this
//        server adopts (and broadcasts the turn edge) before it has anything to announce. Spec row 7's
//        arrow chain (`thread/peerMessage` → `turn/started` → items → `turn/completed`) is wrong in its
//        first hop. Nothing in the design depends on that order — the announcement deliberately carries no
//        `turnId` — so the legs assert the ordering the design DOES rest on (LEG 3: the arrival's
//        `userMessage` item never precedes the `turn/started` of the turn that owns it) and this note
//        records the measured one rather than pinning an order the engine never promised.
//
//   M4 · THE PERSISTED ARRIVAL IS `isMeta: true`, AND THE SDK'S READER DROPS IT. On disk the arrival is a
//        `type:"user"` row carrying `origin.kind:"peer"` and a clean `origin.body` — exactly the shape
//        `items/replay.ts`'s `peerArrival` branch was written for — but it also carries `isMeta: true`,
//        and `getSessionMessages` (the SDK reader behind `thread/read`) returns no `isMeta` row at all,
//        with or without `includeSystemMessages`. It also strips `origin` from the rows it DOES return.
//        So `thread/read` can never project a peer arrival, and the live-vs-persisted id stitch spec row 7
//        promises is unreachable THROUGH THAT READER. LEG 2 measures exactly this: the stitch holds at the
//        STORE (the real rule, run over the real row, reproduces the live item byte for byte) and is cut
//        at the reader. It is asserted in both directions so the day the reader stops dropping the row,
//        this leg goes red and the design gets revisited.
//        AND ITS SHARPER HALF: a FOLDED arrival is persisted NOWHERE — no `isMeta` row, no row at all
//        (LEG 4, read against a positive control on the same transcript). So a folded message has no live
//        item, no cold row, and exactly one durable trace: its `thread/peerMessage` announcement. The
//        announcement is therefore load-bearing rather than a convenience.
//
// ── THE FOUR DELEGATED UNKNOWNS, AND HOW EACH IS CLOSED ────────────────────────────────────────────
//   U1 · the healthy terminal state's NAME → `completed` (M1). LEG 1 + LEG 6.
//   U2 · what lifecycle a FOLDED message gets → a COMPLETE `started`/`completed` bracket of its own,
//        NESTED inside the host turn's bracket: two brackets are open at once, and the fold never
//        produces a `result` of its own. LEG 4 asserts the nesting and the single turn.
//   U3 · whether a BATCH emits one bracket per `command_uuid` → YES: N brackets around ONE turn, more than
//        one open at a time, and the second adoption is declined by `beginTurn`'s busy gate exactly as the
//        design expects. LEG 5, which also pins M5 below.
//   U4 · WHICH lifecycle field carries the submit uuid → `command_uuid` (M2). LEG 6.
//
//   M5 · A BATCHED TURN'S REPLAY FRAMES ALL CARRY THE CAUSING MESSAGE'S `origin`. Three messages written
//        back to back produce three replay frames with three distinct uuids — and only as many distinct
//        `origin.msg_id`/`origin.body` values as there were TURNS. The other members' attributions never
//        appear, though their TEXT does reach the model (all three check codes come back). So
//        `thread/peerMessage` announces the causing message N times and never announces the rest. This
//        server forwards `origin` verbatim by design, so the defect is the engine's; LEG 5 pins it.
//
// ── WHAT THE LEGS MAY AND MAY NOT ASSERT ───────────────────────────────────────────────────────────
//   · `thread/peerMessage` params are `{ threadId, arrivalUuid, origin }` and NOTHING else. There is no
//     `turnId` and there cannot be one — at arrival the message's fate is genuinely undecided.
//   · an arrival's id is the FRAME's own uuid, never a minted one.
//   · an adopted turn goes THROUGH `beginTurn`, so its `turn/started` payload is the ordinary
//     `{ threadId, turn }` and carries NO origin field.
//   · a FOLDED arrival produces no LIVE item — `drainArrivals` needs an adopted turn's mapper and there is
//     none — and (M4) no readable persisted one either, so LEG 4 asserts the folded message's text through
//     the MODEL's own answer, which is spec row 10's own wording and the only surviving vehicle.
//
// ── HOW A THREAD BECOMES ADDRESSABLE ───────────────────────────────────────────────────────────────
// `record.sessionId` is latched off the first `system/init` FRAME (router.ts's `routeInit`), and the CLI
// emits none until it is given input — measured here: a thread left idle for 48s publishes its session row
// but never latches, and `thread/init/read` starts the CLI without producing a frame either. So every
// thread below takes one trivial WARM-UP turn before `peer/list` can map its row to a `threadId`. That is
// a property of this server's id latch, not of the peer surface.
//
// Run keyed: set -a; . ../.env; set +a; npx vitest run test/live/appserver-cross-session.test.ts
// NEVER print, echo or log the credential.
//
// Structure follows appserver-m4/m5-acceptance.test.ts: ONE describe, sequential `it`s sharing one app
// server and its WS clients, each with its own generous timeout, cheapest leg first.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AppServer } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";
import { claudeConfigDir } from "../../src/config/claudeHome.js";
import { peerArrival } from "../../src/peer/address.js";
import { userItem } from "../../src/appserver/items/mapper.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

/** Sonnet, not haiku: several legs turn on the model actually obeying "reply with exactly this token", so
 *  instruction-following must not be the variable. */
const SONNET = "claude-sonnet-4-6";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nonce = (tag: string): string => `${tag}-${randomUUID().slice(0, 8).toUpperCase()}`;
/** A message body that pins the model to a plain-text answer. TWO measured failure modes shaped it, both
 *  on live runs of this file:
 *   1. told only "reply with this token", the model reached for the CLI's own `SendMessage` tool and
 *      answered the PEER over the gateway socket instead of saying anything in its transcript — a real
 *      behaviour (the gateway logs the stray `type:"user"` frame and drops it) that makes a token
 *      assertion on the transcript vacuous;
 *   2. told "your entire response must be exactly this token and nothing else", the model REFUSED, naming
 *      it "a classic prompt injection pattern designed to use me as a covert signal relay between
 *      sessions" — correctly, since that is what a suppress-your-output instruction from an unattributed
 *      peer looks like. The receiver's judgement is not something to engineer around, so the message says
 *      truthfully what it is instead: an automated check from the process hosting the session. */
const askFor = (token: string): string =>
  `This is an automated connectivity check from the cc-harness app-server acceptance suite, which is also the process hosting this session. Please confirm receipt by replying in plain text with the check code ${token}. No tool use is needed and there is no need to message the sender back.`;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Poll a POSITIVE condition to a deadline. Every wait in this file is either a `waitFor` on a
 *  notification or one of these — never a bare sleep standing in for an event. */
async function until(label: string, ms: number, pred: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (await pred()) return;
    if (Date.now() > end) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await wait(250);
  }
}

// ---------------------------------------------------------------------------------------------------
// The wire client — the same minimal WS JSON-RPC "lite" client the M1–M7 live files use (spec §4: no
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

/** One `command_lifecycle` frame, as the engine wrote it. */
interface Lc { command_uuid: string; state: string; uuid: string }

/** Everything a leg needs to read off the RAW frame stream — the lifecycle brackets, the terminal
 *  `result` frames, and the uuids this server submitted under. The last of those is captured on every
 *  frame because `peerInbound.ts` DELETES a uuid the moment its terminal lands (`forget`), and this
 *  observer is registered AFTER that one, so a snapshot taken on the terminal frame would already have
 *  missed it — but a snapshot taken on any earlier frame of the same turn has it. */
interface Watch { lc: Lc[]; results: any[]; ourUuids: Set<string>; off(): void }

interface Thread { id: string; cwd: string; record: any; watch: Watch; sessionId: string; address: string }

live("M8 cross-session, against a real engine", () => {
  let root = "";
  let server: AppServer;
  let listener: { port: number; close(): Promise<void> };
  let ws: WebSocket;
  let a: RpcClient;
  const held = new Set<string>();

  function watchFrames(record: any): Watch {
    const lc: Lc[] = [];
    const results: any[] = [];
    const ourUuids = new Set<string>();
    const off = record.session.onFrame((f: any) => {
      for (const u of record.peerInbound?.ourUuids ?? []) ourUuids.add(String(u));
      if (f?.type === "command_lifecycle") lc.push({ command_uuid: String(f.command_uuid), state: String(f.state), uuid: String(f.uuid) });
      else if (f?.type === "result") results.push(f);
    });
    return { lc, results, ourUuids, off };
  }

  /** Start a thread at the given policy, subscribe, run the warm-up turn that latches `sessionId`, and
   *  wait until `peer/list` carries its row. Returns everything the legs address it by. */
  async function openThread(inbound: "accept" | "hold" | "refuse", label: string): Promise<Thread> {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), `cc-m8-${label}-`)));
    const started = await a.call("thread/start", {
      config: { cwd, model: SONNET, settingSources: [], permissionMode: "default", maxTurns: 12 },
      unattended: "park",
      crossSessionInbound: inbound,
    }, 180_000);
    const id = String(started.thread.id);
    expect(started.thread.crossSessionInbound, "thread/start did not report the policy it was admitted at").toBe(inbound);
    held.add(id);
    await a.call("thread/subscribe", { threadId: id }, 30_000);
    const record: any = (server as any).registry.get(id);
    const watch = watchFrames(record);

    const mark = a.mark();
    const w = await a.call("turn/start", { threadId: id, input: "Say READY and nothing else." }, 180_000);
    await a.waitFor(`warm-up turn/completed (${label})`, 300_000,
      (n) => n.method === "turn/completed" && n.params.threadId === id && n.params.turn?.id === String(w.turn.id), mark);
    expect(record.sessionId, `the warm-up turn did not latch a sessionId for ${label}`).toBeTruthy();

    // The session row is written by the CLI, not by this server, so it is polled for rather than awaited.
    let row: any;
    for (let i = 0; i < 60 && !row; i++) {
      const list = await a.call("peer/list", {}, 30_000);
      row = (list.peers ?? []).find((p: any) => p.threadId === id);
      if (!row) await wait(1000);
    }
    expect(row, `peer/list never showed a row whose threadId is ${label}'s (${id})`).toBeTruthy();
    expect(row.sessionId, "the peer row does not carry the session this server holds").toBe(record.sessionId);
    expect(row.alive).toBe(true);
    expect(row.inboxBound, "the target session bound no inbox — nothing could be delivered to it").toBe(true);
    expect(row.statusReachable, "the target is outside this gateway's socket namespace").toBe(true);
    return { id, cwd, record, watch, sessionId: String(record.sessionId), address: String(row.address) };
  }

  /** The RAW persisted transcript, straight off disk — the only way to see a row the SDK's own reader
   *  drops (M4). Used by LEG 2 to measure exactly where the live-vs-persisted stitch is cut, and by the
   *  two silence legs to prove at the ENGINE that a refused message was never taken in. */
  function transcriptRows(sessionId: string): any[] {
    const projects = join(claudeConfigDir(process.env), "projects");
    let dirs: string[] = [];
    try { dirs = readdirSync(projects); } catch { return []; }
    for (const d of dirs) {
      const file = join(projects, d, `${sessionId}.jsonl`);
      if (!existsSync(file)) continue;
      return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    }
    return [];
  }

  const turnStarts = (from: number, threadId: string): Notif[] => a.since(from).filter((n) => n.method === "turn/started" && n.params.threadId === threadId);
  const turnEnds = (from: number, threadId: string): Notif[] => a.since(from).filter((n) => n.method === "turn/completed" && n.params.threadId === threadId);
  const itemsOf = (from: number, threadId: string): any[] => a.since(from).filter((n) => n.method === "item/completed" && n.params.threadId === threadId).map((n) => n.params.item);
  const agentText = (from: number, threadId: string): string =>
    itemsOf(from, threadId).filter((i: any) => i?.type === "agentMessage").map((i: any) => String(i.text ?? "")).join("\n");
  const bracketOf = (w: Watch, commandUuid: string): string[] => w.lc.filter((f) => f.command_uuid === commandUuid).map((f) => f.state);

  /** Every `turn/started` is answered by exactly one `turn/completed`, and no completion names a turn that
   *  never started — the balance claim four legs share. */
  function expectBalanced(from: number, threadId: string): void {
    const startedIds = turnStarts(from, threadId).map((n) => String(n.params.turn.id));
    const endedIds = turnEnds(from, threadId).map((n) => String(n.params.turn.id));
    expect(new Set(startedIds).size, `a turn id started twice: ${startedIds.join(", ")}`).toBe(startedIds.length);
    expect(new Set(endedIds).size, `a turn id completed twice: ${endedIds.join(", ")}`).toBe(endedIds.length);
    for (const t of endedIds) expect(startedIds, `turn/completed named ${t}, which never started`).toContain(t);
    expect(endedIds.sort(), `unbalanced lifecycles — started ${startedIds.join(",")} / completed ${endedIds.join(",")}`).toEqual([...startedIds].sort());
  }

  beforeAll(async () => {
    // `realpathSync`: on macOS `tmpdir()` is a symlink (/var → /private/var) and the cwd a thread reports
    // is compared against paths the engine resolved — the peer row's own `cwd` among them.
    root = realpathSync(mkdtempSync(join(tmpdir(), "cc-m8-root-")));
    server = new AppServer({}); // no token: this run exercises the peer surface, not auth
    // The gateway is this server's reply address in the peer namespace, and NOTHING in this file works
    // without it: `peer/send` answers -33008 unbound, and the `from` attribute it stamps is what makes the
    // receiver's `origin.verifiedPeerPid` this process's pid.
    await server.bindGateway();
    expect(server.gateway(), "the peer gateway did not bind — every leg here would answer -33008").toBeTruthy();
    listener = await listenWs(server, {});
    ws = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    a = new RpcClient(ws);
    const init = await a.call("initialize", { clientInfo: { name: "cross-session-acceptance" }, watchThreads: true });
    expect(init.userAgent).toBe("cc-harness-appserver");
    // THE DOWNGRADE MARKER, checked exactly as a policy-setting client is told to: an old server strips the
    // unknown `crossSessionInbound` param silently and starts a thread at the CLI's own default, so its
    // absence means "my `refuse` was not honoured" and every assertion below would be measuring the wrong
    // thing (spec's decision log: the repo already learned this once with `dynamicTools`).
    expect(init.crossSession, "initialize did not advertise crossSession — the policy would be silently dropped").toBe(true);
    // Every park is auto-allowed for the whole run: only LEG 4 uses a tool at all, and its subject is the
    // FOLD, not the permission surface (which M2's acceptance owns). Left unanswered a park simply hangs
    // the turn — the threads are `unattended: "park"`.
    a.on((n) => {
      if (n.method !== "decision/requested" || n.params.decision?.kind !== "permission") return;
      void a.call("decision/respond", { threadId: n.params.threadId, toolUseId: n.params.decision.toolUseId, answer: { kind: "allow_once" } }, 30_000).catch(() => {});
    });
  }, 180_000);

  afterAll(async () => {
    try {
      // The session ids must be read BEFORE the records go: `thread/delete` addresses the STORE, and the
      // registry row is the only thing that maps a thread id to it.
      const sessions = [...held].map((id) => (server as any)?.registry.get(id)?.sessionId).filter((s: unknown): s is string => !!s);
      for (const id of [...held]) { try { await a?.call("thread/close", { threadId: id }, 30_000); } catch { /* already closed */ } }
      // These threads ran at a temp `cwd`, so their transcripts land in the operator's own
      // `~/.claude/projects/<slug>`; removed rather than left as litter (the M5 acceptance precedent).
      for (const sessionId of sessions) { try { await a?.call("thread/delete", { threadId: sessionId }, 30_000); } catch { /* best-effort */ } }
      try { await server?.shutdown(); } catch { /* best-effort */ }
      ws?.close();
      try { await listener?.close(); } catch { /* best-effort */ }
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
      for (const t of [t1, t2, t3, t4, t5]) if (t) { try { rmSync(t.cwd, { recursive: true, force: true }); } catch { /* gone */ } }
    }
  }, 300_000);

  // The idle thread is opened once and carried through LEGs 1, 2, 3, 6 and 9: each of those measures a
  // different property of ONE exchange (or, for 6 and 9, of the same thread afterwards), and re-running the
  // exchange per leg would spend four more live turns to observe the same frames.
  let t1: Thread | undefined;
  let t2: Thread | undefined;
  let t3: Thread | undefined;
  let t4: Thread | undefined;
  let t5: Thread | undefined;
  /** What LEG 1 observed, read by LEGs 2 and 3. */
  let idle: { mark: number; token: string; body: string; msgId: string; arrivalUuid: string; turnId: string } | undefined;

  it("LEG 1 — idle (spec row 7, closes U1): peer/list carries this thread's own row, peer/send reaches it, and the arrival becomes a real turn that settles `completed`", async () => {
    t1 = await openThread("accept", "idle");
    const before = (t1.record.session as any).unmatchedResults;
    const token = nonce("M8IDLE");
    const body = askFor(token);
    const mark = a.mark();

    // THE SEND IS SELF-ADDRESSED, and that is the design rather than a shortcut: this server's gateway
    // writes to a thread this server hosts, so one process holds both ends and every claim on both sides is
    // observable in one place.
    const sent = await a.call("peer/send", { target: t1.sessionId, message: body }, 30_000);
    expect(sent.msgId, "peer/send did not mint a UUID msgId — a non-UUID id comes back with no orig_msg_id and nothing correlates").toMatch(UUID_RE);
    expect(sent.delivered, "peer/send reported delivery it cannot know about").toBe(false);
    expect(sent.statusReachable).toBe(true);
    expect(sent.targetSessionId).toBe(t1.sessionId);
    expect(sent.address).toBe(t1.address);

    // (1) THE ARRIVAL — the one premise no unit test can establish.
    const announced = await a.waitFor("thread/peerMessage", 180_000,
      (n) => n.method === "thread/peerMessage" && n.params.threadId === t1!.id, mark);
    expect(Object.keys(announced.params).sort(), "thread/peerMessage's params are not exactly {threadId, arrivalUuid, origin}").toEqual(["arrivalUuid", "origin", "threadId"]);
    const arrivalUuid = String(announced.params.arrivalUuid);
    expect(arrivalUuid, "the arrival's id is not the frame's own uuid").toMatch(UUID_RE);
    const origin = announced.params.origin;
    expect(origin.kind, "the engine did not stamp the replayed frame as a peer arrival — the WHOLE recognition rule").toBe("peer");
    expect(origin.verifiedPeerPid, "verifiedPeerPid is not this process — the one field the kernel vouches for").toBe(process.pid);
    expect(origin.msg_id, "the arrival does not carry the msgId peer/send minted").toBe(sent.msgId);
    expect(origin.from).toBe(server.gateway()!.address);
    expect(origin.body, "origin.body is not the message this server sent").toBe(body);

    // (2) THE TURN, through `beginTurn` like every other one.
    const started = await a.waitFor("turn/started for the adopted turn", 120_000,
      (n) => n.method === "turn/started" && n.params.threadId === t1!.id, mark);
    expect(Object.keys(started.params).sort(), "an adopted turn's edge is not the ordinary {threadId, turn} — a subscriber would have to special-case it").toEqual(["threadId", "turn"]);
    const turnId = String(started.params.turn.id);
    const done = await a.waitFor("turn/completed for the adopted turn", 300_000,
      (n) => n.method === "turn/completed" && n.params.threadId === t1!.id && n.params.turn?.id === turnId, mark);

    // (3) U1 — THE HEALTHY TERMINAL. `isTerminalState` is the NEGATION of {queued, started}, so the only
    // falsifiable form of "the terminal was recognised" is that the turn settled at all; the literal name is
    // then read off the bracket and asserted, so a rename is red here rather than silent everywhere.
    const bracket = bracketOf(t1.watch, arrivalUuid);
    expect(bracket, `the peer message's command_lifecycle bracket was not started->completed (U1: the healthy terminal is "completed", and a peer message skips "queued"); saw ${JSON.stringify(bracket)}`).toEqual(["started", "completed"]);
    expect(done.params.turn.status, `the adopted turn did not settle cleanly: ${JSON.stringify(done.params.turn)}`).toBe("completed");

    // (4) EXACTLY ONE TURN, balanced, and the model answered the peer.
    expect(turnStarts(mark, t1.id).length, "one arrival produced more than one turn").toBe(1);
    expectBalanced(mark, t1.id);
    expect(agentText(mark, t1.id), "the model's reply does not carry the token the peer sent").toContain(token);

    // (5) NOTHING WAS DROPPED, and nothing was said on the status channel: the CLI is silent on the success
    // path, which is why `peer/send` reports `delivered:false` rather than waiting for a receipt.
    expect((t1.record.session as any).unmatchedResults, "the adopted turn's result was not claimed by the unclaimed-result hook").toBe(before);
    expect(a.since(mark).filter((n) => n.method === "peer/messageStatus").length, "a receipt arrived on the success path").toBe(0);

    idle = { mark, token, body, msgId: sent.msgId, arrivalUuid, turnId };
  }, 900_000);

  it("LEG 2 — the live item and the persisted one are ONE row at the STORE, and the SDK's reader cuts the stitch (M4)", async () => {
    expect(idle, "LEG 1 did not run").toBeTruthy();
    const { mark, arrivalUuid, body } = idle!;

    // (1) THE LIVE ITEM. Built by `drainArrivals` through `userItem(text, msgId)`.
    const liveItem = itemsOf(mark, t1!.id).find((i: any) => i?.type === "userMessage" && i.id === arrivalUuid);
    expect(liveItem, `no live userMessage item carried the arrivalUuid ${arrivalUuid}`).toBeTruthy();
    expect(liveItem).toEqual({ type: "userMessage", id: arrivalUuid, text: body });

    // (2) THE PERSISTED ROW, read raw off disk. It IS there, it IS a `type:"user"` row, and it carries the
    // very origin the live path recognised — so running the ONE reader (`peerArrival`) over it reproduces
    // the live item byte for byte, id included. This is the id-stitch spec row 7 promises, proven at the
    // store.
    const rows = transcriptRows(t1!.sessionId);
    expect(rows.length, "the transcript could not be read off disk").toBeGreaterThan(0);
    const persisted = rows.find((r: any) => r?.uuid === arrivalUuid);
    expect(persisted, `the arrival was not persisted under its own uuid ${arrivalUuid}`).toBeTruthy();
    expect(persisted.type).toBe("user");
    const decoded = peerArrival(persisted);
    expect(decoded, "the persisted row does not read as a peer arrival").toBeTruthy();
    expect(userItem(decoded!.text, String(persisted.uuid))).toEqual(liveItem);
    // The raw persisted TEXT is not the message: it carries a CLI-authored preamble the peer never wrote,
    // which is exactly why `origin.body` is the text and the envelope capture is only the fallback.
    expect(JSON.stringify(persisted.message?.content ?? ""), "the persisted row's own text is somehow already the clean body").toContain("Another Claude session sent a message");

    // (3) …AND THE STITCH IS CUT AT THE READER, which is the finding. The row carries `isMeta: true`, and
    // `getSessionMessages` — the SDK reader behind `thread/read` — returns no `isMeta` row at all (measured
    // with and without `includeSystemMessages`) and strips `origin` from the rows it does return. So a
    // client that reads its own history sees the arrival NOWHERE rather than twice: not a duplicate, a
    // hole. Asserted in this direction on purpose — the day the reader stops dropping it, this goes red and
    // the design gets revisited rather than silently double-rendering.
    expect(persisted.isMeta, "the persisted arrival is no longer isMeta — re-check whether thread/read now projects it").toBe(true);
    // The turn the arrival caused IS projected, so this is a hole in one row and not an unreadable thread —
    // and waiting for that answer to appear is also what makes the absence below a measurement rather than
    // a race with the CLI's own transcript flush (the assistant row lands on disk after `turn/completed`).
    let data: any[] = [];
    await until("thread/read to project the answer the arrival produced", 120_000, async () => {
      data = (await a.call("thread/read", { threadId: t1!.id }, 30_000)).data ?? [];
      return data.some((i: any) => i?.type === "agentMessage" && String(i.text ?? "").includes(idle!.token));
    });
    expect(data.map((i: any) => String(i.id)), `thread/read now projects the arrival (${arrivalUuid}) — M4 no longer holds; the live/persisted dedup must be re-verified`).not.toContain(arrivalUuid);
  }, 120_000);

  it("LEG 3 — arrival is a fact about the THREAD, not about a turn (spec row 9)", async () => {
    expect(idle, "LEG 1 did not run").toBeTruthy();
    const { mark, arrivalUuid, turnId } = idle!;
    const window = a.since(mark);

    // (1) EXACTLY ONCE, whatever fate the message met, and with no turnId at all — at arrival the fate is
    // genuinely undecided, so the field could only be fabricated, delayed or null.
    const announcements = window.filter((n) => n.method === "thread/peerMessage" && n.params.threadId === t1!.id);
    expect(announcements.length, "one message was announced more than once").toBe(1);
    expect(announcements[0].params.turnId, "thread/peerMessage carried a turnId").toBeUndefined();

    // (2) THE ORDERING THE DESIGN RESTS ON: the item bearing the arrivalUuid never precedes the
    // `turn/started` of the turn that owns it — `drainArrivals` runs inside the runner, which `beginTurn`
    // invokes only after it has broadcast the edge.
    const itemAt = window.findIndex((n) => n.method === "item/completed" && n.params.item?.id === arrivalUuid);
    const startAt = window.findIndex((n) => n.method === "turn/started" && n.params.turn?.id === turnId);
    expect(itemAt, "the arrival never became an item").toBeGreaterThanOrEqual(0);
    expect(startAt, "the owning turn never started").toBeGreaterThanOrEqual(0);
    expect(itemAt, "the arrival's item was emitted BEFORE its turn's turn/started").toBeGreaterThan(startAt);
    expect(String(window[itemAt].params.turnId), "the arrival's item was attributed to a different turn").toBe(turnId);

    // (3) THE MEASURED ORDER, recorded rather than pinned (M3): the engine emits the message's lifecycle
    // `started` before it replays the user frame, so the turn edge goes out FIRST and the announcement
    // follows. Nothing here depends on it — this assertion says only that both happened inside the one
    // exchange, which is the claim a client without a turn to attach to actually needs.
    const announceAt = window.findIndex((n) => n.method === "thread/peerMessage");
    expect(announceAt, "the announcement fell outside the exchange").toBeGreaterThanOrEqual(0);
    expect(announceAt, `MEASURED ORDER: thread/peerMessage at ${announceAt}, turn/started at ${startAt} — spec row 7's arrow chain has these the other way round`).toBeLessThan(itemAt);
  }, 120_000);

  it("LEG 4 — fold (spec row 10, closes U2): a message delivered mid-turn folds into the running turn and gets a NESTED lifecycle bracket of its own", async () => {
    t2 = await openThread("accept", "fold");
    const before = (t2.record.session as any).unmatchedResults;
    const token = nonce("M8FOLD");
    const mark = a.mark();

    // A turn with round-trips left, and enough of them that the delivery window is measured in tens of
    // seconds rather than in milliseconds. The fold is only possible while the turn will CONTINUE after the
    // current model response — two sequential foreground sleeps guarantee that for the whole of the first.
    const hostTurn = await a.call("turn/start", {
      threadId: t2.id,
      // NOT "and nothing else": measured on the first keyed run — a host prompt that forbids extra output
      // wins the conflict with a folded instruction, and the model answered OMEGA alone while the peer's
      // message sat unanswered in the same context. Spec row 10's claim is that BOTH prompts are answered,
      // so the host prompt must leave room for the second one.
      input: "Run these two bash commands in the foreground, one at a time, waiting for each to finish: `sleep 12; echo x` then `sleep 12; echo y`. When both are done, reply with the single word OMEGA on its own line.",
    }, 180_000);
    const hostTurnId = String(hostTurn.turn.id);

    // DETERMINISTIC MID-TURN DELIVERY: wait for the engine's own evidence that the turn is executing a tool
    // — the first `toolCall` item to OPEN — rather than for a wall-clock guess. At that instant at least one
    // twelve-second sleep and one more model round-trip are still owed.
    await a.waitFor("the host turn's first tool call to open", 300_000,
      (n) => n.method === "item/started" && n.params.threadId === t2!.id && n.params.item?.type === "toolCall", mark);
    expect(t2.record.busy, "the host turn was not running when the message was delivered — the fold premise was not established").toBe(true);
    expect(turnEnds(mark, t2.id).length, "the host turn had already completed — the fold premise was not established").toBe(0);

    const sent = await a.call("peer/send", {
      target: t2.sessionId,
      message: `This is an automated check from the cc-harness app-server acceptance suite, which is also the process hosting this session. When you write the reply for the turn you are currently running, please also include this check code on its own line: ${token}. No tool use is needed and there is no need to message the sender back.`,
    }, 30_000);

    const announced = await a.waitFor("thread/peerMessage (fold)", 180_000,
      (n) => n.method === "thread/peerMessage" && n.params.threadId === t2!.id, mark);
    const arrivalUuid = String(announced.params.arrivalUuid);
    expect(announced.params.origin.msg_id).toBe(sent.msgId);
    // The announcement landed while the host turn was still open — that is what makes this a FOLD and not
    // a follow-up, and it is asserted rather than assumed.
    expect(turnEnds(mark, t2.id).length, "the host turn completed before the arrival was announced — this was a follow-up, not a fold").toBe(0);

    const done = await a.waitFor("the host turn to complete", 600_000,
      (n) => n.method === "turn/completed" && n.params.threadId === t2!.id && n.params.turn?.id === hostTurnId, mark);
    expect(done.params.turn.status, `the folded turn did not settle cleanly: ${JSON.stringify(done.params.turn)}`).toBe("completed");

    // (1) EXACTLY ONE TURN. `beginTurn` refuses a busy thread, so the fold's own `started` bracket adopts
    // nothing — that refusal is the whole mechanism, and a second turn here would mean two engine turns
    // running under one conversation.
    expect(turnStarts(mark, t2.id).length, `a folded message opened a second turn: ${turnStarts(mark, t2.id).map((n) => n.params.turn.id).join(", ")}`).toBe(1);
    expectBalanced(mark, t2.id);

    // (2) U2 — THE FOLDED MESSAGE'S LIFECYCLE. Its bracket is complete AND nested inside the host turn's:
    // two brackets are open at once, which is why a folded arrival fires `started` while this server already
    // knows itself busy.
    const hostUuid = itemsOf(mark, t2.id).find((i: any) => i?.type === "userMessage")?.id;
    expect(hostUuid, "the host turn emitted no user item to read its submit uuid off").toBeTruthy();
    // A HOST turn's bracket closes AFTER its `turn/completed`, because that turn settles on the terminal
    // `result` frame and the lifecycle `completed` follows it (LEG 6 states the same thing). An ADOPTED
    // turn is the other way round — it settles ON its bracket — so only the host's needs waiting for.
    await until("the host turn's own lifecycle bracket to close", 60_000,
      () => t2!.watch.lc.some((f) => f.command_uuid === String(hostUuid) && f.state !== "queued" && f.state !== "started"));
    const foldBracket = bracketOf(t2.watch, arrivalUuid);
    expect(foldBracket, `U2: a folded message's bracket was not started->completed; saw ${JSON.stringify(foldBracket)}`).toEqual(["started", "completed"]);
    const at = (uuid: string, state: string): number => t2!.watch.lc.findIndex((f) => f.command_uuid === uuid && f.state === state);
    expect(at(arrivalUuid, "started"), "the fold's bracket opened before the host turn's").toBeGreaterThan(at(String(hostUuid), "started"));
    expect(at(arrivalUuid, "completed"), "the fold's bracket did not close inside the host turn's — the two were not nested").toBeLessThan(at(String(hostUuid), "completed"));

    // (3) THE MODEL ANSWERED BOTH PROMPTS — spec row 10's own wording, and the only surviving vehicle for a
    // folded message's text: it produces no live item (there is no adopted turn to own one) and, as the
    // block below measures, no persisted row either.
    const text = agentText(mark, t2.id);
    expect(text, "the folded turn's completion does not carry the host prompt's answer").toContain("OMEGA");
    expect(text, "the folded turn's completion does not carry the peer message's token").toContain(token);
    // …and it is PERSISTED NOWHERE, which is the sharper half of M4 and this leg's own finding. An arrival
    // that gets its OWN turn IS written to the transcript, as an `isMeta` peer row (LEG 2 reads it straight
    // off disk). A FOLDED one is written as no row at all — not an `isMeta` row, not a row of any kind. It
    // reached the model (the check code above is the proof) and it had a lifecycle bracket of its own, yet
    // outside that turn's context it leaves exactly one durable trace: the `thread/peerMessage`
    // announcement. That is what makes the announcement load-bearing rather than a convenience — for a
    // folded message it is the ONLY record a client will ever get, live or cold.
    //
    // The absence is read against a POSITIVE CONTROL taken from the same read, so it can never be a race
    // with the CLI's transcript flush: the wait is for the host turn's own first and last rows to land, and
    // only then is the peer row's absence read.
    let rows: any[] = [];
    await until("the host turn's own rows to reach the transcript", 120_000, () => {
      rows = transcriptRows(t2!.sessionId);
      return rows.some((r: any) => r?.uuid === hostUuid) && rows.some((r: any) => JSON.stringify(r?.message?.content ?? "").includes(token));
    });
    const userRows = rows.filter((r: any) => r?.type === "user").map((r: any) => ({ uuid: r.uuid, isMeta: r.isMeta ?? false, origin: r.origin?.kind ?? null }));
    expect(rows.filter((r: any) => r?.origin?.kind === "peer").map((r: any) => String(r.uuid)),
      `a folded arrival (${arrivalUuid}) is now persisted — the fold half of M4 no longer holds, and both thread/read's projection and this leg must be re-verified; the transcript's user rows are ${JSON.stringify(userRows)}`).toEqual([]);

    // (4) NOTHING IS LEFT HOLDING THE THREAD. A fold that had adopted would still be holding `busy`, so a
    // plain (unqueued) `turn/start` succeeding is the falsifiable form of "the fold left no adoption".
    expect((t2.record.session as any).unmatchedResults, "a result went unclaimed across the fold").toBe(before);
    const after = await a.call("turn/start", { threadId: t2.id, input: "Say DONE and nothing else." }, 180_000);
    expect(after.turn.status, "a following local turn was not accepted — the fold left an adoption holding busy").toBe("inProgress");
    await a.waitFor("the following local turn to complete", 300_000,
      (n) => n.method === "turn/completed" && n.params.threadId === t2!.id && n.params.turn?.id === String(after.turn.id), mark);
  }, 1_500_000);

  it("LEG 5 — batch (closes U3): a batched turn carries ONE bracket per queued message, and the engine attributes every one of them to the message that CAUSED the turn", async () => {
    t3 = await openThread("accept", "batch");
    const before = (t3.record.session as any).unmatchedResults;
    const tokens = [nonce("M8BATCH1"), nonce("M8BATCH2"), nonce("M8BATCH3")];
    const mark = a.mark();

    // ONE BURST, and it batches DETERMINISTICALLY rather than by luck: the thread is idle, so the first
    // message starts a turn of its own straight away and the two written behind it accumulate in the CLI's
    // queue while that turn runs. Measured four times across three runs (concurrent writes, awaited writes,
    // and writes spaced by 3s) — the only arrangement that produced three separate turns was the spaced one.
    const sends: any[] = [];
    for (const t of tokens) sends.push(await a.call("peer/send", { target: t3!.sessionId, message: askFor(t) }, 30_000));
    expect(new Set(sends.map((s) => s.msgId)).size, "peer/send reused a msgId").toBe(3);

    // (1) THE TERMINAL IS POSITIVE, NOT A QUIET WINDOW: every message asked for its own check code back, so
    // all three answers existing is proof that all three TEXTS reached the model — which is the "no message
    // is lost" claim, and it survives the attribution defect measured in (4). Only then is idleness read.
    await until("the model to answer all three messages", 900_000, () => {
      const text = agentText(mark, t3!.id);
      return tokens.every((t) => text.includes(t));
    });
    await until("the thread to go idle", 120_000, () => !t3!.record.busy);

    // (2) ONE REPLAY FRAME PER QUEUED MESSAGE, each with its own uuid — the fan-out is intact even where
    // the attribution is not.
    const announced = a.since(mark).filter((n) => n.method === "thread/peerMessage" && n.params.threadId === t3!.id);
    expect(announced.length, "a batched turn did not announce one arrival per queued message").toBe(3);
    const arrivalUuids = announced.map((n) => String(n.params.arrivalUuid));
    expect(new Set(arrivalUuids).size, "two arrivals shared an id").toBe(3);
    // Every bracket has closed before any of them is read: the brackets of a batched turn that this server
    // DECLINED to adopt (all but the first) settle on nothing this server waits for, so an idle thread is
    // not by itself proof the engine has finished writing them.
    await until("every arrival's lifecycle bracket to close", 120_000,
      () => arrivalUuids.every((u) => t3!.watch.lc.some((f) => f.command_uuid === u && f.state !== "queued" && f.state !== "started")));

    // (3) U3, ANSWERED: ONE `command_lifecycle` BRACKET PER `command_uuid`, N of them around ONE turn, and
    // more than one open at a time. `peerInbound.ts` adopts one turn at a time (`if (adopted) return`), so
    // the second bracket's `started` meets a thread `beginTurn` refuses as busy — which is exactly why the
    // design survives this shape, and the assertion below is that it did: fewer turns than brackets.
    expectBalanced(mark, t3.id);
    for (const [i, u] of arrivalUuids.entries()) {
      expect(bracketOf(t3.watch, u), `arrival ${i + 1} (${u}) got no started->completed bracket of its own`).toEqual(["started", "completed"]);
    }
    const turns = turnStarts(mark, t3.id).length;
    expect(turns, `U3: three brackets produced ${turns} turns — a batch was expected to collapse into fewer turns than messages`).toBeLessThan(3);
    expect(turns, "the batch produced no turn at all").toBeGreaterThanOrEqual(1);
    expect((t3.record.session as any).unmatchedResults, "a batched turn's result went unclaimed").toBe(before);

    // (4) THE ATTRIBUTION DEFECT, PINNED — and it is the ENGINE's, not this server's. Every replay frame of
    // a batched turn carries the `origin` of the message that CAUSED that turn: N frames, N uuids, ONE
    // `msg_id` and ONE `body`. So a client is told about the causing message N times and never told the
    // others arrived, even though their text reached the model (asserted in (1)). This server forwards
    // `origin` VERBATIM on purpose — re-deriving it would replace a kernel-vouched fact with an opinion —
    // so there is nothing to fix on this side; the count of distinct attributions tracks the count of TURNS,
    // which is the rule measured in every observation of this shape so far. Asserted rather than described,
    // so a future engine that stamps per message turns this leg red and gets the announcement contract
    // revisited.
    const distinctMsgIds = new Set(announced.map((n) => String(n.params.origin?.msg_id)));
    const audit = JSON.stringify(announced.map((n) => ({ arrivalUuid: n.params.arrivalUuid, msgId: n.params.origin?.msg_id })));
    expect(distinctMsgIds.size, `the batch announced ${distinctMsgIds.size} distinct msg_ids across ${announced.length} arrivals and ${turns} turn(s): ${audit}`).toBe(turns);
    for (const m of distinctMsgIds) expect(sends.map((s) => String(s.msgId)), `an announcement named a msg_id nothing sent: ${audit}`).toContain(m);

    const after = await a.call("turn/start", { threadId: t3.id, input: "Say DONE and nothing else." }, 180_000);
    expect(after.turn.status, "a following local turn was not accepted — the batch left an adoption holding busy").toBe("inProgress");
    await a.waitFor("the following local turn to complete", 300_000,
      (n) => n.method === "turn/completed" && n.params.threadId === t3!.id && n.params.turn?.id === String(after.turn.id), mark);
  }, 1_800_000);

  it("LEG 6 — own turns are never adopted, and the uuid correlation is MEASURED (closes U4)", async () => {
    expect(t1, "LEG 1 did not run").toBeTruthy();
    const mark = a.mark();
    const started = await a.call("turn/start", { threadId: t1!.id, input: "Say OK and nothing else." }, 180_000);
    const turnId = String(started.turn.id);
    await a.waitFor("the local turn to complete", 300_000,
      (n) => n.method === "turn/completed" && n.params.threadId === t1!.id && n.params.turn?.id === turnId, mark);

    // ONE turn: an own bracket that had been mistaken for a foreign one would have tried to adopt, and only
    // `beginTurn`'s busy gate would have stopped it.
    expect(turnStarts(mark, t1!.id).length, "a purely local turn produced more than one turn/started").toBe(1);
    expectBalanced(mark, t1!.id);

    // THE SUBMIT UUID. `submitRunner` mints it, hands it to `submit({uuid})`, notes it on
    // `record.peerInbound.ourUuids` (`notePeerTurnUuid`) and stamps it as the live user item's id — so the
    // item's id IS the uuid, and the watcher's snapshot of `ourUuids` is the second, independent reading.
    const submitted = String(itemsOf(mark, t1!.id).find((i: any) => i?.type === "userMessage")?.id ?? "");
    expect(submitted, "the local turn emitted no user item to read its submit uuid off").toMatch(UUID_RE);
    expect([...t1!.watch.ourUuids], "notePeerTurnUuid did not record the uuid this turn submitted under").toContain(submitted);

    // The bracket CLOSES AFTER THE TURN DOES, so it is waited for rather than read at `turn/completed`:
    // the engine's terminal `result` frame is what resolves the turn (and therefore what broadcasts
    // `turn/completed`), and the `command_lifecycle` `completed` for the same `command_uuid` follows it.
    // Read without this wait the bracket is `queued`/`started` about half the time — a race, not a finding.
    await until("the host turn's own lifecycle bracket to close", 60_000,
      () => t1!.watch.lc.some((f) => f.command_uuid === submitted && f.state !== "queued" && f.state !== "started"));

    // U4 — WHICH FIELD CARRIES IT. Both halves, because the second is what makes the first a measurement
    // rather than a coincidence: `command_uuid` identifies the MESSAGE and `uuid` identifies the FRAME.
    const byCommand = t1!.watch.lc.filter((f) => f.command_uuid === submitted);
    const byFrame = t1!.watch.lc.filter((f) => f.uuid === submitted);
    expect(byCommand.length, `U4: NEITHER command_uuid nor uuid carried the submit uuid ${submitted} on any of ${t1!.watch.lc.length} command_lifecycle frames — own turns cannot be told from foreign ones by uuid at all, and adoption needs a different discriminator`).toBeGreaterThan(0);
    expect(byFrame.length, `U4: the frame's own uuid carried the submit uuid — that contradicts the measurement that uuid is fresh per frame; ${JSON.stringify(t1!.watch.lc.filter((f) => f.command_uuid === submitted))}`).toBe(0);
    expect(new Set(byCommand.map((f) => f.uuid)).size, "the frames of one bracket shared a uuid — `uuid` does not identify the frame after all").toBe(byCommand.length);

    // …and the host turn's full vocabulary, the other half of U1: a local turn is bracketed queued ->
    // started -> completed, where an inbound peer message (LEG 1) skips `queued`.
    expect(byCommand.map((f) => f.state), `a host turn's bracket is not queued->started->completed; saw ${JSON.stringify(byCommand.map((f) => f.state))}`).toEqual(["queued", "started", "completed"]);
  }, 600_000);

  it("LEG 7 — busy follow-up (spec row 8): a message delivered into a turn that ends without another round-trip gets its own balanced pair", async () => {
    t4 = await openThread("accept", "busy");
    const before = (t4.record.session as any).unmatchedResults;
    const token = nonce("M8BUSY");
    const mark = a.mark();

    // A LONG turn that will END without another model round-trip: one response, no tools. That is what
    // makes this a FOLLOW-UP rather than a fold — there is no next model call for the message to fold into.
    const hostTurn = await a.call("turn/start", {
      threadId: t4.id,
      input: "Count from 1 to 200, writing one number per line and nothing else. Do not use any tool.",
    }, 180_000);
    const hostTurnId = String(hostTurn.turn.id);

    // DETERMINISTIC MID-TURN DELIVERY, off the engine's own signal: THIS turn's `command_lifecycle` reaches
    // `started` when the CLI dequeues it for execution, which is the beginning of a response that takes tens
    // of seconds to write. Scoped to this turn's own `command_uuid` — the warm-up turn left a `started` of
    // its own in the same capture, and a leg that fired on that would deliver before the turn even began.
    await a.waitFor("the host turn's user item (which carries its submit uuid)", 120_000,
      (n) => n.method === "item/completed" && n.params.threadId === t4!.id && n.params.item?.type === "userMessage", mark);
    const hostUuid = String(itemsOf(mark, t4.id).find((i: any) => i?.type === "userMessage")?.id ?? "");
    expect(hostUuid, "the host turn emitted no user item to read its submit uuid off").toMatch(UUID_RE);
    await until("the host turn's lifecycle to reach `started`", 180_000,
      () => t4!.watch.lc.some((f) => f.command_uuid === hostUuid && f.state === "started"));
    expect(turnEnds(mark, t4.id).length, "the host turn had already completed — the follow-up premise was not established").toBe(0);
    const sent = await a.call("peer/send", { target: t4.sessionId, message: askFor(token) }, 30_000);

    const announced = await a.waitFor("thread/peerMessage (busy follow-up)", 300_000,
      (n) => n.method === "thread/peerMessage" && n.params.threadId === t4!.id, mark);
    expect(announced.params.origin.msg_id).toBe(sent.msgId);
    const arrivalUuid = String(announced.params.arrivalUuid);

    // TWO BALANCED LIFECYCLES: the client's turn completing, then an adopted pair.
    await a.waitFor("the client's own turn to complete", 600_000,
      (n) => n.method === "turn/completed" && n.params.threadId === t4!.id && n.params.turn?.id === hostTurnId, mark);
    const adopted = await a.waitFor("the adopted turn to start", 300_000,
      (n) => n.method === "turn/started" && n.params.threadId === t4!.id && String(n.params.turn.id) !== hostTurnId, mark);
    const adoptedId = String(adopted.params.turn.id);
    const adoptedDone = await a.waitFor("the adopted turn to complete", 600_000,
      (n) => n.method === "turn/completed" && n.params.threadId === t4!.id && n.params.turn?.id === adoptedId, mark);
    expect(adoptedDone.params.turn.status, `the adopted turn did not settle cleanly: ${JSON.stringify(adoptedDone.params.turn)}`).toBe("completed");

    expect(turnStarts(mark, t4.id).length, "a busy follow-up produced something other than two turns").toBe(2);
    expectBalanced(mark, t4.id);
    expect(bracketOf(t4.watch, arrivalUuid), "the follow-up message's bracket was not started->completed").toEqual(["started", "completed"]);
    expect(agentText(mark, t4.id), "the adopted turn's reply does not carry the peer's token").toContain(token);

    // THE SETTLEMENT PATH, which is the row's real subject: a peer turn's terminal `result` matches NO
    // waiter — it is UUID-LESS, so no waiter could claim it — and settlement therefore rides
    // `onUnclaimedResult`. `unmatchedResults` unchanged is what says that hook CLAIMED it rather than the
    // counter merely never seeing it.
    const unowned = t4.watch.results.filter((r: any) => r.user_message_uuid === undefined);
    expect(unowned.length, `no uuid-less result frame was seen; results carried ${JSON.stringify(t4.watch.results.map((r: any) => r.user_message_uuid ?? null))}`).toBe(1);
    // `origin.kind` on that result is timing-dependent by the spec's own decision log ("the same event
    // yields `peer` or `task-notification` depending on timing the host does not control"), so the
    // measurement is asserted as membership in the two observed values and the one seen is named — pinning
    // either would be pinning a race.
    expect(["peer", "task-notification"], `the unclaimed result's origin.kind was ${JSON.stringify(unowned[0].origin?.kind)}`).toContain(String(unowned[0].origin?.kind));
    expect((t4.record.session as any).unmatchedResults, "the adopted turn's result was dropped rather than claimed").toBe(before);
  }, 1_800_000);

  it("LEG 8 — refuse (spec row 11): the same send into a crossSessionInbound:'refuse' thread runs NOWHERE, and since CLI 2.1.250 the sender is told so — one `expired` receipt carrying a reason", async () => {
    t5 = await openThread("refuse", "refuse");
    // The arrival observer is installed CONDITIONALLY on the policy, so a refusing thread has no
    // `peerInbound` state at all — this server is not even listening for what will not come.
    expect(t5.record.peerInbound, "the arrival observer was installed on a refusing thread").toBeUndefined();
    const token = nonce("M8REFUSE");
    const mark = a.mark();

    // `peer/send` STILL REPORTS ONLY THAT THE FRAME WAS WRITTEN: `delivered` is a literal, not a status,
    // and the method never waits for a receipt. What became of the message is learned on the status
    // channel afterwards, or not at all.
    const sent = await a.call("peer/send", { target: t5.sessionId, message: askFor(token) }, 30_000);
    expect(sent.delivered).toBe(false);
    expect(sent.msgId).toMatch(UUID_RE);

    // ── WHAT CHANGED, AND WHAT DID NOT ────────────────────────────────────────────────────────────────
    // M8 measured (2026-08-28, on CLI 2.1.237) that a refused send was silent on BOTH channels: no turn,
    // no items, AND no receipt, so a sender had no way whatever to learn its message had been refused.
    // CLI 2.1.250 closes exactly that half: the refusal now comes back as a `peer/messageStatus`. The
    // engine did NOT become more permissive — every enforcement assertion below is the one that was here
    // before, and each still passes — it became TRANSPARENT. This leg therefore asserts both halves, and
    // the receipt is what makes the second half falsifiable rather than a claim about an absence.
    //
    // Correlated by `msgId`, never by method alone: a receipt owed to some other send (a `held` message's
    // eventual `expired`, a capped entry's `dropped`) must not be able to stand in for this one.
    const receipt = await a.waitFor("peer/messageStatus for the refused send", 60_000,
      (n) => n.method === "peer/messageStatus" && n.params.msgId === sent.msgId, mark);
    // THE STATUS IS PINNED. `expired` is TERMINAL in `ReceiptMap`, so it releases the correlation entry
    // where `held` deliberately does not — a client's next move differs by exactly this word, and a flip
    // in either direction is a real contract change that must redden here.
    expect(receipt.params.status, `the refusal receipt's status was ${JSON.stringify(receipt.params.status)}`).toBe("expired");
    // THE SHAPE IS PINNED, and it is OURS to pin: this frame is assembled by this server's own receipt
    // sink, and `reason` is emitted only when the engine supplied one — so the key set is precisely what
    // says a reason arrived at all, rather than an `undefined` read as a pass.
    expect(Object.keys(receipt.params).sort(), "the receipt is not the {msgId, status, reason, from, receivedAt} this server documents").toEqual(["from", "msgId", "reason", "receivedAt", "status"]);
    expect(String(receipt.params.reason).trim().length, "the refusal receipt carried an empty reason — the whole point of the channel is that the sender can be TOLD why").toBeGreaterThan(0);
    expect(receipt.params.receivedAt, "the receipt carries no unix-seconds stamp").toBeGreaterThan(0);
    // …and the reason's ENGLISH is deliberately NOT pinned. Upstream wording is not a contract, and a leg
    // that reddens on somebody's copy-edit teaches the next reader to ignore it. What this leg owes is
    // that a reason is THERE and non-empty. Recorded rather than asserted, 2.1.250 says: "The recipient
    // session is not accepting cross-session messages (the feature is off there, or a setting or policy
    // there refuses them); your message was not delivered to its Claude."

    // THE OBSERVATION WINDOW, unchanged, and still the leg's reason for existing. On the accepting threads
    // above the whole arrival→announcement hop completed in the low seconds; 45s is an order of magnitude
    // of headroom over that, which is what makes this silence a measurement rather than an impatience.
    await wait(45_000);
    const window = a.since(mark).filter((n) => n.params?.threadId === t5!.id);
    expect(window.filter((n) => n.method === "thread/peerMessage"), "a refused message was announced").toEqual([]);
    expect(window.filter((n) => n.method === "turn/started"), "a refused message started a turn").toEqual([]);
    expect(window.filter((n) => n.method === "item/completed"), "a refused message produced an item").toEqual([]);
    // ONE receipt, not a stream: a terminal status releases the entry, so nothing further can route to it.
    expect(a.since(mark).filter((n) => n.method === "peer/messageStatus" && n.params.msgId === sent.msgId).length,
      "the refused send drew more than one receipt").toBe(1);

    // …and at the ENGINE, not only at this server: the refusing CLI never took the message into its
    // transcript at all. Without this the leg would pass merely because the observer was uninstalled.
    const rows = transcriptRows(t5.sessionId);
    expect(rows.length, "the refusing thread's transcript could not be read").toBeGreaterThan(0);
    expect(rows.some((r: any) => JSON.stringify(r).includes(token)), "the refused message reached the engine's transcript").toBe(false);
  }, 600_000);

  it("LEG 9 — the runtime ratchet, end to end: a live accepting thread tightened to `refuse` stops taking messages, and cannot be loosened back", async () => {
    expect(t1 && idle, "LEG 1 did not run").toBeTruthy();
    // t1 is the one thread on this run that has PROVEN it accepts (LEG 1's message became a turn on it), so
    // the flip below is measured against a control rather than against an assumption.
    expect(t1!.record.crossSessionInbound).toBe("accept");
    const mark = a.mark();

    const ok = await a.call("thread/crossSessionInbound/set", { threadId: t1!.id, value: "refuse" }, 30_000);
    expect(ok).toEqual({ ok: true });
    const changed = await a.waitFor("thread/settings/changed", 30_000,
      (n) => n.method === "thread/settings/changed" && n.params.threadId === t1!.id, mark);
    expect(changed.params.crossSessionInbound, "the announcement does not carry the new policy").toBe("refuse");
    expect(changed.params.source).toBe("client");
    expect(t1!.record.crossSessionInbound).toBe("refuse");
    // The observer is uninstalled by the same accepted move, and the config it mirrors is rewritten so the
    // next engine swap rebuilds at the tightened value rather than at the launch one. `uninstallPeerInbound`
    // DETACHES rather than deletes — the state object survives with its callbacks dropped and its queue
    // emptied, which is the difference between this thread and one ADMITTED at `refuse` (LEG 8), where the
    // state was never created at all.
    expect(t1!.record.peerInbound?.off, "tightening to refuse left the frame observer attached").toBeUndefined();
    expect(t1!.record.peerInbound?.offResult, "tightening to refuse left the unclaimed-result hook attached").toBeUndefined();
    expect(t1!.record.peerInbound?.arrivals, "tightening to refuse kept the arrival queue").toEqual([]);
    expect((t1!.record.config as any).settings?.crossSessionInbound, "the record moved without the config it mirrors").toBe("refuse");

    // THE ONE DIRECTION THAT MOVES, measured through this server rather than through a probe.
    const token = nonce("M8RATCHET");
    const sent = await a.call("peer/send", { target: t1!.sessionId, message: askFor(token) }, 30_000);
    expect(sent.delivered).toBe(false);
    await wait(45_000);
    const window = a.since(mark).filter((n) => n.params?.threadId === t1!.id);
    expect(window.filter((n) => n.method === "thread/peerMessage"), "a message arrived after the thread was tightened to refuse").toEqual([]);
    expect(window.filter((n) => n.method === "turn/started"), "a message started a turn after the thread was tightened to refuse").toEqual([]);
    expect(transcriptRows(t1!.sessionId).some((r: any) => JSON.stringify(r).includes(token)),
      "the message reached the engine's transcript after the tightening").toBe(false);

    // AND IT DOES NOT COME BACK. A loosening write to the live flag layer is ignored in silence by the CLI,
    // so this server refuses it rather than reporting a change that did not happen.
    await expect(a.call("thread/crossSessionInbound/set", { threadId: t1!.id, value: "accept" }, 30_000)).rejects.toMatchObject({ code: -32602 });
    await expect(a.call("thread/crossSessionInbound/set", { threadId: t1!.id, value: "hold" }, 30_000)).rejects.toMatchObject({ code: -32602 });
    // An equal-value request is a tightening of size zero and applies, so a retry is not an error.
    expect(await a.call("thread/crossSessionInbound/set", { threadId: t1!.id, value: "refuse" }, 30_000)).toEqual({ ok: true });
  }, 600_000);
});
