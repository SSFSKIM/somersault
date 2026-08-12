// test/helpers/fakeHost.ts — the fleet test substrate (M3 Task 5).
//
// A REAL `HostServer` (src/host/server.ts) listening on a REAL unix socket, driven by hand-written stub
// handlers instead of a `SessionHost`. Every fleet test (M3 Tasks 6–11) talks to this, so what it gets
// wrong they all get wrong — silently, and in the false-green direction. Two rules keep it honest:
//
//  1. The WIRE is copied, never invented. Frame shapes come from `src/host/wire.ts`, the follow replay
//     order and the answer receipts from `src/host/host.ts` (cited at each site) and from P106's live
//     recording (2026-08-11). Where production stays SILENT — the `stop` op — so does this.
//  2. The HOST half of an op is MODELLED; the ENGINE half is the test's. Every frame a real host emits
//     from its own code, with no engine answer in between, happens here: park's decision+state
//     (host.ts:818-819), interrupt's system settlements (:922 → :871-879) and the swap burst that resume
//     and clear both ride (:499-513). What only an engine can produce — a turn's messages and its end
//     frame (including the throw an interrupt provokes), task lifecycle frames — stays the test's, via
//     the `emit*`/`beginTurn`/`endTurn`/`settle` controls: a fake that guessed at those would assert its
//     own fiction and six suites would assert it back. `rewind` splits along that same line, per SCOPE
//     (Task 5 review minor 25, closed by Task 11): a `conversation` rewind is fully host-side — the dry
//     run is skipped (host.ts:777) and the swap burst follows — so it is MODELLED here, through the very
//     same `swapEngine` resume and clear ride; `both`/`code` open with a dry run and a file restore only
//     an engine can answer (:779-784), so those are recorded alone and a case that wants their aftermath
//     drives `emitTasksChanged`/`setStatus`/`emitRewound` itself.
import { HostServer } from "../../src/host/server.js";
import type { HostHandlers } from "../../src/host/server.js";
import type { HostEvent } from "../../src/host/wire.js";
import type { HostStatus } from "../../src/host/ops.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import type { RosterRow } from "../../src/fleet/roster.js";
import type { PendingDecision } from "../../src/permissions/pending.js";
import type { DecisionKind, DecisionOutcome } from "../../src/permissions/types.js";
import type { BackgroundTaskInfo } from "../../src/session/session.js";
import type { RewindAnchor, RewindDryRun } from "../../src/session/chatSession.js";
import type { TurnFailure } from "../../src/session/turnResult.js";

/** A park as a test writes one: an id plus whatever the case is about. Everything else is filled with a
 *  well-formed default, so the `decision` frame on the wire is always a complete `PendingDecision`. */
export type PendingDecisionLike = Partial<PendingDecision> & { toolUseID: string };

export interface FakeHostOpts {
  /** Start with a turn already in flight (seq 1) — the mid-turn attach every fleet task exercises. */
  busy?: boolean;
  /** Seeds the settings mirror (`permissionMode`/`model`/`thinkingTokens`) and the conversation id, and,
   *  if given, overrides the derived `state`/`status`. Same overlay `setStatus` patches into later — and
   *  the same one the setter ops and the resume/clear swap write their own truth into. */
  status?: Partial<HostStatus>;
  /** Take the `stop` op and NEVER let go of the socket — a host wedged mid-exit. The other shape of a
   *  stop that does not complete, and the one §1e's first stuck reason ("the host has not closed the
   *  connection") is about; the default models the real `SessionHost.stop`, which tears its sockets down. */
  stopHangs?: boolean;
  short?: string; name?: string; cwd?: string;
  /** The pid the socket path is keyed by — `hostSocketPath(pid, env)`, exactly as a real host keys its
   *  own. Defaults to THIS process's, which is both truthful (the fake really does run here) and the
   *  only pid guaranteed to read live off `isPidLive`. Two fakes alive at once under one fleet root need
   *  distinct pids, or the second's `listen` unlinks the first's socket file. */
  pid?: number;
  env?: NodeJS.ProcessEnv;
}

export interface FakeHostControls {
  socketPath: string;
  /** A roster row pointing at this host — NOT written to disk: a test that wants it in the roster calls
   *  `writeRoster(row, env)` itself, so a fleet listing only ever contains rows its own case put there. */
  row: RosterRow;
  emitMessage(m: unknown): void;
  emitTask(t: unknown): void;
  /** REPLACE the task snapshot and push it (the host never merges — probe 39). The snapshot is what a
   *  later `follow` replays. */
  emitTasksChanged(tasks: unknown[]): void;
  beginTurn(seq: number): void;
  /** §1a-f pairing contract (wire.ts's turn member): `error` is a THROWN turn and travels alone;
   *  `result` and `failure` describe a turn that RESOLVED and may travel together. */
  endTurn(seq: number, opts?: { error?: string; result?: unknown; failure?: TurnFailure }): void;
  /** Make the NEXT prompt complete SYNCHRONOUSLY inside its own handler — turn/start AND turn/end both
   *  emitted before the server writes the prompt reply, so a trivially-fast own turn's end beats its own
   *  reply on the wire (external review F2). `opts` is `endTurn`'s shape. */
  completeNextPromptInline(opts?: { error?: string; result?: unknown; failure?: TurnFailure }): void;
  park(entry: PendingDecisionLike): void;
  /** Settle a park host-side, decision_settled then state. With an `answer` this is the human path
   *  (§1a-e: the whole outcome travels, host.ts:860-861); without one it is the SDK-ABORT path — a bare
   *  deny plus state, host.ts's onAutoSettle (:128-132). NOT interrupt's settlement: that one emits the
   *  bare deny ALONE (settleParkedForSystem) and the `interrupt` op reproduces it. */
  settle(toolUseID: string, by: string, answer?: DecisionOutcome): void;
  setStatus(patch: Partial<HostStatus>): void;
  emitRewound(p: { sessionId?: string; prevUuid?: string; cleared?: true }): void;
  promptCalls: Array<{ text: string; uuid?: string }>;
  /** Every op name the server dispatched, in order. NB `unfollow` is recorded from the unregister
   *  callback, which a socket CLOSE also fires — assert with `toContain`/filters on a case that
   *  disconnects. */
  ops: string[];
  /** The same sequence with each op's handler arguments, for tests that assert what was forwarded. */
  opCalls: Array<{ op: string; args: unknown[] }>;
  /** Planted replies, keyed by op name. For a control op (`usage`, `capabilities`, `compact`,
   *  `context_usage`, `mcp_status`, …) the value is the WHOLE reply body; for `get_settings`,
   *  `list_dirs`, `rewind_anchors` and `rewind_dryrun` it is the payload the server wraps. */
  replies: Record<string, unknown>;
  /** Planted REFUSALS, keyed by op name: the op is still recorded, then THROWS — which `host/server.ts`'s
   *  dispatch wraps as `{ok:false, error}` (:136-137), the shape every host-side refusal reaches a client
   *  in. For the refusals whose trigger a fake cannot stage: `rewind`'s parked-decision gate
   *  (host.ts:758) fires when the HOST holds a park this server's mirror has not caught up with, a gap
   *  that exists only for the width of one frame's travel. */
  refuse: Record<string, string>;
  close(): Promise<void>;
}

/** Which outcome kinds each parked kind may settle with — host.ts's KIND_ANSWERS, verbatim. */
const KIND_ANSWERS: Record<DecisionKind, ReadonlySet<string>> = {
  permission: new Set(["allow_once", "allow_with_updates", "allow_always", "deny"]),
  question: new Set(["question_answer", "deny"]),
  plan: new Set(["plan_approve", "plan_reject", "deny"]),
};

/** Real-shaped bodies for the control ops a test did not plant a reply for (host.ts's control()). */
const CONTROL_DEFAULTS: Record<string, Record<string, unknown>> = {
  capabilities: { ok: true, models: [], commands: [], mcpServers: [] },
  compact: { ok: true, outcome: {} },
  usage: { ok: true, usage: {} },
  context_usage: { ok: true, usage: {} },
  mcp_status: { ok: true, servers: [] },
  mcp_reconnect: { ok: true },
  mcp_toggle: { ok: true },
};

// 8 lowercase hex or nothing: `writeRoster` refuses any other shape, and doperpowers' _lib.sh gates its
// purge path on the length (fleet/paths.ts). A per-process counter keeps two fakes in one file distinct.
let nth = 0;
const mintShort = (): string => `fa5e${(++nth).toString(16).padStart(4, "0")}`;

export async function startFakeHost(opts: FakeHostOpts = {}): Promise<FakeHostControls> {
  const env = opts.env ?? process.env;
  const pid = opts.pid ?? process.pid;
  const socketPath = hostSocketPath(pid, env);
  const short = opts.short ?? mintShort();
  // No `procStart`: a row without one reads live for as long as its pid does (RosterRow's doc), which is
  // what "this host is up" has to look like to `collectFleet`/`projectRow`.
  const row: RosterRow = { short, pid, cwd: opts.cwd ?? process.cwd(), kind: "interactive", name: opts.name ?? short, state: "working", startedAt: Date.now() };

  const followers = new Set<(ev: HostEvent) => void>();
  const buffered: unknown[] = [];                    // the TurnBuffer: what a late follower is replayed
  const parked: PendingDecision[] = [];
  const settledBy = new Map<string, string>();
  let tasks: BackgroundTaskInfo[] = [];
  let busy = !!opts.busy;
  let seq = busy ? 1 : 0;                            // a turn in flight is a turn that started
  let inlineComplete: { error?: string; result?: unknown; failure?: TurnFailure } | undefined; // F2: end this prompt inline
  const patch: Partial<HostStatus> = { ...opts.status };
  const ops: string[] = [];
  const opCalls: Array<{ op: string; args: unknown[] }> = [];
  const promptCalls: Array<{ text: string; uuid?: string }> = [];
  const replies: Record<string, unknown> = {};
  const refuse: Record<string, string> = {};
  // Recorded FIRST, then refused: a planted refusal is a host that took the op and said no, so the op log
  // must show it arrived (see `refuse`).
  const record = (op: string, ...args: unknown[]): void => {
    ops.push(op); opCalls.push({ op, args });
    const no = refuse[op];
    if (no) throw new Error(no);
  };

  /** host.ts's status() (:884-895): a park projects as blocked/idle, and the settings mirror rides BOTH
   *  arms. `permissionMode` is never absent from a real one — `private mode = "default"` (:144), seeded
   *  from the launch config in start() and spread into both arms at :892 — while `model`/`thinkingTokens`
   *  ARE omitted until set, so a mirror can tell "unset" from a value the host invented. An explicit
   *  `setStatus` patch wins over the derivation: it is the test saying so. */
  const status = (): HostStatus => {
    const first = parked[0];
    const derived: HostStatus = first
      ? { state: "blocked", status: "idle", waitingFor: `${first.kind}:${first.toolName}` }
      : { state: "working", status: busy ? "busy" : "idle" };
    return { ...derived, permissionMode: "default", ...patch };
  };

  // One follower's failure is that follower's problem (host.ts's deliver()).
  const deliver = (cb: (ev: HostEvent) => void, ev: HostEvent): void => { try { cb(ev); } catch { /* dropped from this event, not from the set */ } };
  const emit = (ev: HostEvent): void => { for (const cb of [...followers]) deliver(cb, ev); };
  const pushState = (): void => emit({ kind: "state", status: status() });

  // BOTH the turn buffer and the settled-by receipts reset before the start frame (host.ts:308) — a
  // receipt that outlived its turn answers a stale client `alreadyAnsweredBy` where the real host says
  // `no parked request <id>`.
  const beginTurn = (n: number): void => { busy = true; seq = n; buffered.length = 0; settledBy.clear(); emit({ kind: "turn", phase: "start", seq: n }); };

  /** The turn-END emitter, shared by the `endTurn` control and the inline-complete prompt path (F2). The
   *  §1a-f pairing is the contract, so an impossible combination fails HERE rather than teaching a client to
   *  read a frame the host cannot produce: a turn that THREW carries no result. */
  const emitEnd = (n: number, o: { error?: string; result?: unknown; failure?: TurnFailure } = {}): void => {
    if (o.error !== undefined && (o.result !== undefined || o.failure !== undefined)) {
      throw new Error("turn-end contract: `error` is a thrown turn and travels alone — never with result/failure");
    }
    busy = false;
    emit({ kind: "turn", phase: "end", seq: n, ...(o.result === undefined ? {} : { result: o.result }),
      ...(o.failure === undefined ? {} : { failure: o.failure }), ...(o.error === undefined ? {} : { error: o.error }) });
  };

  /** host.ts's settleParkedForSystem (:871-879), the path `interrupt` (:922) and teardown both take:
   *  `denyAll()` settles straight into the registry, so the host emits one BARE deny per entry itself —
   *  in park order, with no `answer` payload (a system deny has none the kind string drops) and, unlike
   *  answer() (:860-861), NO trailing `state`. Reproduced, not tidied: a follower learns the turn is over
   *  from the end frame the engine's throw produces, and a fake that pushed `state` here would green a
   *  client that never reads one. */
  const settleParkedForSystem = (): void => {
    for (const e of parked.splice(0, parked.length)) {
      settledBy.set(e.toolUseID, "system");
      emit({ kind: "decision_settled", toolUseID: e.toolUseID, by: "system", decision: "deny" });
    }
  };

  /** host.ts's swapEngine (:456-513), host half: the frames every engine swap owes its followers, in
   *  source order — the emptied task snapshot (:499), the state that republishes the settings mirror and
   *  the new conversation id (:501), and `rewound` LAST, after the old engine is gone (:512-513).
   *  Everything session-scoped resets with the swap (:488). `resumedFrom = extra.resume` is written first
   *  (:463), which is why a resume's frames name the resumed conversation while /clear's name none: the
   *  fresh engine has minted no id yet, so the resume target IS currentSessionId() — and a /clear that
   *  left the discarded id standing is how a follower re-renders the transcript just thrown away. */
  const swapEngine = (resume: string | undefined, announce: { prevUuid?: string; cleared?: true } = {}): void => {
    if (resume === undefined) delete patch.sessionId; else patch.sessionId = resume;
    buffered.length = 0; settledBy.clear();
    tasks = []; emit({ kind: "tasks_changed", tasks });
    pushState();
    emit({ kind: "rewound", ...(patch.sessionId ? { sessionId: patch.sessionId } : {}), ...announce });
  };

  const settle = (toolUseID: string, by: string, answer?: DecisionOutcome): void => {
    const i = parked.findIndex((e) => e.toolUseID === toolUseID);
    if (i >= 0) parked.splice(i, 1);
    settledBy.set(toolUseID, by);
    // The whole outcome travels when there is one (§1a-e); a system deny has no payload the kind string
    // drops, so it ships without an `answer` key at all — the onAutoSettle shape (host.ts:128-132), which
    // pushes state after it. Interrupt's own settlement does not; see settleParkedForSystem below.
    emit(answer ? { kind: "decision_settled", toolUseID, by, decision: answer.kind, answer } : { kind: "decision_settled", toolUseID, by, decision: "deny" });
    pushState();
  };

  const answer: HostHandlers["answer"] = (toolUseID, outcome, by) => {
    const entry = parked.find((e) => e.toolUseID === toolUseID);
    // Kind-checked BEFORE settling, so a mismatched answer leaves the park intact for a correct one.
    // The three receipt strings are P106's recorded verdicts, live-measured 2026-08-11.
    if (entry && !KIND_ANSWERS[entry.kind].has(outcome.kind)) return { ok: false, error: `kind mismatch: ${entry.kind} park cannot take ${outcome.kind}` };
    if (!entry) {
      const who = settledBy.get(toolUseID);
      // Answered-by-someone-else is NOT a refusal: two humans racing one prompt is normal, and the loser
      // is told who won. Never-parked-at-all is the error case.
      return who ? { ok: true, alreadyAnsweredBy: who } : { ok: false, error: `no parked request ${toolUseID}` };
    }
    settle(toolUseID, by, outcome);
    return { ok: true };
  };

  const handlers: HostHandlers = {
    status: () => { record("status"); return status(); },
    // Not an op: the server reads this on every prompt/resume/clear/rewind gate check.
    busy: () => busy,
    // NO REPLY. `SessionHost.stop` tears every socket down before the dispatch could write one (P106:
    // the client sees a close and nothing else) — a stop-ACK here would green a client that waits for one.
    stop: async () => { record("stop"); if (opts.stopHangs) return new Promise<void>(() => {}); await server.close(); },
    pending: () => { record("pending"); return parked.slice(); },
    answer: (toolUseID, outcome, by) => { record("answer", toolUseID, outcome, by); return answer(toolUseID, outcome, by); },
    // runTask bumps the seq and emits `start` SYNCHRONOUSLY, before its first await — which is what makes
    // the seq the server puts in the prompt reply (read after this call) this turn's own.
    prompt: async (text, uuid) => {
      record("prompt", text, uuid); promptCalls.push({ text, ...(uuid ? { uuid } : {}) });
      beginTurn(seq + 1);
      // F2: complete the turn INLINE — turn/end is emitted here, before this handler returns, so it precedes
      // the prompt reply the server writes next (turnSeq() still reads this turn's seq, the reply matches).
      if (inlineComplete !== undefined) { const o = inlineComplete; inlineComplete = undefined; emitEnd(seq, o); }
    },
    // The turn's own end frame is NOT emitted here: it comes from the SDK stream throwing under the
    // interrupt (host.ts's runTask catch arm, :363) — engine-mediated, so the test emits it via endTurn.
    interrupt: async () => { record("interrupt"); settleParkedForSystem(); },
    follow: (sink) => {
      record("follow");
      // REPLAY ORDER, copied from host.ts's follow() (SessionHost.follow, ~:600-633 at 48aa3285f3):
      // turn-start-if-busy → buffered messages marked `replay:true` → parked decisions → the task
      // snapshot → state LAST (it describes "right now", everything above it is history). Every frame
      // goes out synchronously here, so the whole burst reaches the client BEFORE the `follow` reply the
      // server writes when this returns — the ordering P106 measured.
      if (busy) deliver(sink, { kind: "turn", phase: "start", seq });
      for (const m of buffered) deliver(sink, { kind: "message", data: m, replay: true });
      for (const entry of parked) deliver(sink, { kind: "decision", entry });
      if (tasks.length) deliver(sink, { kind: "tasks_changed", tasks });
      deliver(sink, { kind: "state", status: status() });
      followers.add(sink);
      return () => { record("unfollow"); followers.delete(sink); };
    },
    control: async (op) => {
      record(op.op, op);
      // A setter moves the host's own mirror and republishes it on `state` — the reply carries nothing
      // (host.ts's control()). This is the channel a foreign client's setting change reaches others by.
      if (op.op === "set_model") { patch.model = op.model; pushState(); return { ok: true }; }
      if (op.op === "set_permission_mode") { patch.permissionMode = op.mode; pushState(); return { ok: true }; }
      if (op.op === "set_thinking") { patch.thinkingTokens = op.maxTokens ?? undefined; pushState(); return { ok: true }; }
      return (replies[op.op] as Record<string, unknown> | undefined) ?? CONTROL_DEFAULTS[op.op] ?? { ok: true };
    },
    // Both go through the ONE swap seam the real host has (resumeSession :580-585, clearSession :591-596),
    // so both put the same burst on the wire — differing only in what `rewound` announces.
    resume: async (sessionId) => { record("resume", sessionId); swapEngine(sessionId); },
    clear: async () => { record("clear"); swapEngine(undefined, { cleared: true }); },
    turnSeq: () => seq,
    tasks: () => { record("tasks"); return tasks; },
    background: async () => { record("background"); return true; },
    stopTask: async (taskId) => { record("stop_task", taskId); },
    rewindAnchors: async () => { record("rewind_anchors"); return (replies.rewind_anchors as RewindAnchor[] | undefined) ?? []; },
    rewindDryRun: async (uuid) => { record("rewind_dryrun", uuid); return (replies.rewind_dryrun as RewindDryRun | undefined) ?? { canRewind: false }; },
    // host.ts's rewind (:756-797), host half only — see rule 2 in the header for where the line falls.
    // The refusal comes first and is fully host-side (`currentSessionId()`, :762): a host whose engine
    // never minted an id has no conversation to fork from, whatever the caller's anchor says. Then the
    // conversation arm, which for `scope:"conversation"` is the whole op — no dry run, no file restore,
    // just the swap, announced `{cleared:true}` when there is no anchor before the prompt (W-S8's
    // `clearing`) and `{prevUuid}` otherwise.
    rewind: async (anchor, scope) => {
      record("rewind", anchor, scope);
      if (!patch.sessionId) throw new Error("no session to rewind");
      if (scope !== "conversation") return;                 // the engine half is the test's
      if (anchor.prevUuid) swapEngine(patch.sessionId, { prevUuid: anchor.prevUuid });
      else swapEngine(undefined, { cleared: true });
    },
    getSettings: async () => { record("get_settings"); return replies.get_settings ?? {}; },
    listDirs: () => { record("list_dirs"); return (replies.list_dirs as ReturnType<HostHandlers["listDirs"]> | undefined) ?? []; },
    addDir: async (path) => { record("add_dir", path); },
    removeDir: async (path) => { record("remove_dir", path); },
    setOutputStyle: async (style) => { record("set_output_style", style); },
    addRule: async (behavior, rule) => { record("add_rule", behavior, rule); },
    removeRule: async (behavior, rule) => { record("remove_rule", behavior, rule); },
    setEffort: async (level) => { record("set_effort", level); },
  };

  const server = new HostServer(handlers, socketPath);
  await server.listen();

  return {
    socketPath, row, promptCalls, ops, opCalls, replies, refuse,
    // A `stream_event` partial fans out LIVE but is deliberately kept out of the replay buffer
    // (host.ts:333, P106-measured): thousands of token deltas would evict the turn's real frames, and a
    // late follower cannot use a delta it missed anyway — the completed message supersedes them all.
    emitMessage: (m) => { if ((m as { type?: unknown } | null)?.type !== "stream_event") buffered.push(m); emit({ kind: "message", data: m }); },
    emitTask: (t) => emit({ kind: "task", data: t }),
    emitTasksChanged: (next) => { tasks = next as BackgroundTaskInfo[]; emit({ kind: "tasks_changed", tasks }); },
    beginTurn,
    endTurn: (n, o = {}) => emitEnd(n, o),
    completeNextPromptInline: (o) => { inlineComplete = o ?? {}; },
    park: (e) => {
      const entry: PendingDecision = { sessionId: "s-fake", toolName: "Bash", kind: "permission", input: {}, createdAt: Date.now(), ...e };
      parked.push(entry);
      // TWO frames, in this order (host.ts's broker, :818-819): the entry, then — unconditionally — the
      // state that carries `waitingFor`. The second is what flips a follower's mirror to blocked; a park
      // that emitted the entry alone would leave every attached client reading the host as idle.
      emit({ kind: "decision", entry });
      pushState();
    },
    settle,
    setStatus: (p) => { Object.assign(patch, p); pushState(); },
    emitRewound: (p) => emit({ kind: "rewound", ...p }),
    close: () => server.close(),
  };
}
