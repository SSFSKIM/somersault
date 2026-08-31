import { connect } from "node:net";
import type { Socket } from "node:net";
import { decodeFrame } from "../host/wire.js";
import type { HostEvent } from "../host/wire.js";
import type { HostStatus } from "../host/ops.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { DecisionOutcome, PermissionDecision } from "../permissions/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";

/** Long enough that a busy host answering a `status` while streaming a turn is never mistaken for a
 *  dead one; short enough that a client does not sit on a promise that will never settle. */
const REQUEST_TIMEOUT_MS = 10_000;
// The rewind ops are the exception to the 10s default: rewind_dryrun and rewind are not cheap replies the
// host composes from memory — the host forwards them to the engine's live transport, which diffs the
// working tree against its file checkpoints. Measured live over `ccx attach`, that round trip regularly
// exceeds 10s on a loaded machine, and a timeout here is user-visible damage rather than a safety net: the
// picker greys out BOTH code choices and shows the raw "pre-upgrade host, or a wedged one" text, so a
// perfectly healthy host reads as broken and the flagship restore is unavailable until the user backs out
// and re-selects. rewind_anchors keeps the default — it is a transcript read, not an engine call.
const REWIND_TIMEOUT_MS = 60_000;
// The MUTATING rewind gets no client deadline at all. A deadline on a destructive op is not a safety net,
// it is a lie: the protocol has no cancellation, so when the timer fires the client reports failure while
// the host keeps going — reverting the working tree and truncating the conversation afterwards, with the
// late reply dropped and no transcript rebuild. Waiting is the honest behaviour; a genuinely dead host is
// still caught, because the socket closing rejects every in-flight request (see the close handler).
const NO_TIMEOUT = Number.POSITIVE_INFINITY;
// Live-feedback fix (2026-08-06): compact is the rewind lesson again, worse. The host replies only after
// the ENGINE's summarization turn completes — a full LLM pass over the whole context, routinely 30–120s on
// a real session — so the 10s default fired mid-work every time and reported a healthy host as wedged
// ("host did not answer compact within 10000ms" in live use). Like the mutating rewind, a fired timer here
// is a lie, not a safety net: the engine keeps compacting and succeeds after the client has already printed
// failure. Capped rather than NO_TIMEOUT only because compact is non-destructive — an abandoned wait costs
// a notice line, not a torn restore.
const COMPACT_TIMEOUT_MS = 300_000;

/** THIS direction's own cap — NOT the server's `MAX_FRAME`. The two directions carry different traffic:
 *  the server bounds small fixed-shape client→host ops (`status`/`answer`/`prompt`), while this buffers
 *  host→client **event** frames, which carry SDK messages including tool results — and follow.ts's own
 *  TurnBuffer is explicitly sized around a single 2 MiB one. Reusing the server's 256 KiB cap here once
 *  destroyed the connection on a legitimate ~500 KiB event before its terminating newline ever arrived —
 *  worse than the runaway-peer case the cap exists to guard. 32 MiB is comfortably above any real single
 *  SDK message while still bounding a peer that never sends a newline at all. */
const MAX_FRAME = 32 * 1024 * 1024;

/** A `ChatSession`-shaped handle on a host running in another process. Held by an attached client in
 *  place of a local Session. `detach()` is NOT `dispose()`: it drops this connection and leaves the
 *  host, its turn and its parked decisions exactly as they were — the only way to end the session is
 *  `stopHost()`, the explicit `stop` op. */
export class RemoteChatSession {
  private nextId = 1;
  private inflight = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private followers = new Map<number, (ev: HostEvent) => void>();
  private nextFollowerId = 1;
  private buf = "";

  private followAck?: Promise<unknown>;
  private closeCbs = new Set<(e: Error) => void>();
  private closedWith?: Error;

  private constructor(private sock: Socket, private label: string, private maxFrame: number) {
    sock.on("data", (c) => this.onData(c.toString("utf8")));
    // Every awaited request must settle when the peer goes, or an attached client hangs on a host that
    // already exited — the same parked-promise class this project keeps rediscovering.
    const fail = (e: Error) => {
      for (const { reject } of this.inflight.values()) reject(e);
      this.inflight.clear();
      if (!this.closedWith) {   // first error wins — a later close/error is not a second event
        this.closedWith = e;
        for (const cb of [...this.closeCbs]) { try { cb(e); } catch { /* one subscriber's failure is not another's */ } }
      }
    };
    sock.on("close", () => fail(new Error("host connection closed")));
    sock.on("error", (e) => fail(e as Error));
  }

  /** Fires once when the connection dies (peer close or socket error), AFTER in-flight requests were
   *  rejected. A subscriber added after the close fires immediately — a late subscriber must not wait
   *  forever on a connection that is already gone. */
  onClose(cb: (e: Error) => void): () => void {
    if (this.closedWith) { try { cb(this.closedWith); } catch { /* ignore */ } return () => {}; }
    this.closeCbs.add(cb);
    return () => { this.closeCbs.delete(cb); };
  }

  /** `maxFrame` overrides MAX_FRAME — test-only, so the over-cap-flood guard test can trip the cap with
   *  a few hundred KiB instead of flooding the real 32 MiB, the same DI escape hatch as SessionHost's
   *  `disposeGraceMs`. Production callers get the real cap by omitting it. */
  static connect(socketPath: string, opts: { label?: string; maxFrame?: number } = {}): Promise<RemoteChatSession> {
    return new Promise((resolve, reject) => {
      const sock = connect(socketPath);
      sock.once("error", reject);
      sock.once("connect", () => { sock.off("error", reject); resolve(new RemoteChatSession(sock, opts.label ?? `client-${process.pid}`, opts.maxFrame ?? MAX_FRAME)); });
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    for (let nl = this.buf.indexOf("\n"); nl >= 0; nl = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
      const frame = decodeFrame(line);
      if (!frame) continue;
      // Routed on `t === "event"` before the id is even looked at: a pushed event can never be mistaken
      // for a correlated reply, nor a reply for an event, whatever either happens to carry.
      if (frame.t === "event") { for (const cb of [...this.followers.values()]) { try { cb(frame as HostEvent); } catch { /* one follower's failure is not another's */ } } continue; }
      const id = (frame as Record<string, unknown>)["id"];
      if (typeof id !== "number") continue;   // an id-less reply (a pre-A2a host) has no waiter to find — the deadline below covers it
      const waiter = this.inflight.get(id);
      if (!waiter) continue;
      this.inflight.delete(id);
      waiter.resolve(frame);
    }
    // This direction's own cap (see MAX_FRAME above): a host in a bad state that writes data with no
    // terminating newline must not grow this buffer without bound for the life of a long-lived attached
    // UI. The server destroys such a peer on ITS cap; we destroy such a host on OURS — `close`'s
    // `fail()` handler then rejects every in-flight request rather than leaving them parked on a
    // connection that is gone.
    if (this.buf.length > this.maxFrame) { this.buf = ""; this.sock.destroy(); }
  }

  private send<T>(op: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      // A deadline, because a silent peer is a real case, not a hypothetical: a host started before
      // this stage answers without the `id` we correlate on (its schema strips the unknown key), so
      // its reply is dropped in onData and this promise would never settle without one.
      const timer = timeoutMs === NO_TIMEOUT ? undefined : setTimeout(() => {
        if (!this.inflight.delete(id)) return;   // already settled by a reply — never reject a promise that already resolved
        reject(new Error(`host did not answer ${String(op["op"])} within ${timeoutMs}ms (a pre-upgrade host, or a wedged one)`));
      }, timeoutMs);
      (timer as { unref?: () => void } | undefined)?.unref?.();
      this.inflight.set(id, {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); },
      });
      this.sock.write(JSON.stringify({ ...op, id }) + "\n");
    });
  }

  // Every reply the server can send — including `status`/`pending`/etc — may also come back as the
  // generic `{ ok:false, error }` a throwing handler produces (server.ts's onConnection wraps every
  // dispatch in try/catch), so `error` is a real field on every one of these, not decoration.
  status(): Promise<HostStatus & { ok: boolean; error?: string }> { return this.send({ op: "status" }); }
  pending(): Promise<{ ok: boolean; pending: PendingEntry[]; error?: string }> { return this.send({ op: "pending" }); }
  /** @deprecated the 3-way subset of answerDecision — kept so existing callers (test/integration) keep
   *  working; delegates rather than duplicating the flat-shape logic. */
  answer(toolUseID: string, decision: PermissionDecision): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }> {
    return this.answerDecision(toolUseID, decision);
  }
  /** Structured kinds travel under `answer`; the PAYLOAD-FREE 3-way kinds keep the FLAT legacy fields so
   *  an old host's schema still parses a new client's permission answer (spec: upgrade compat, read-side
   *  only). The flat field is a bare kind STRING and can carry nothing else, so the moment a permission
   *  answer has a payload — F6 T3's `allow_with_updates.updatedPermissions`, `allow_once.updatedInput`,
   *  `deny.feedback`, BL6's `deny.reason` — it must go structured or the payload is silently dropped on the
   *  wire. That last one is not hypothetical: `reason` is the human-decline discriminator and a decline
   *  carries no feedback by definition, so a predicate that only asked about `feedback` sent it flat and the
   *  gate went on reporting an absent user. THE TEST IS "IS THERE ANYTHING BUT THE KIND", per arm — not a
   *  hand-kept list of fields, which is what let a new field slip through the first time. */
  answerDecision(toolUseID: string, outcome: DecisionOutcome): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }> {
    const bareKind = Object.keys(outcome).length === 1;   // `kind` and nothing else
    const flat = bareKind && (outcome.kind === "allow_once" || outcome.kind === "allow_always" || outcome.kind === "deny");
    return this.send(flat ? { op: "answer", toolUseID, decision: outcome.kind, by: this.label }
                          : { op: "answer", toolUseID, answer: outcome, by: this.label });
  }
  tasksOp() { return this.send<{ ok: boolean; error?: string; tasks?: BackgroundTaskInfo[] }>({ op: "tasks" }); }
  backgroundOp() { return this.send<{ ok: boolean; error?: string; backgrounded?: boolean }>({ op: "background" }); }
  stopTaskOp(taskId: string) { return this.send<{ ok: boolean; error?: string }>({ op: "stop_task", taskId }); }
  /** `uuid` (M3 §1a-b) stamps the user item this turn starts from — a TRAILING OPTIONAL, so every existing
   *  caller is unchanged. `images` (F9 T-IMAGE Task 5/I3b), same discipline: every existing caller that
   *  never stages an image omits it entirely, and an old host's schema — which does not know the key —
   *  simply strips it, which is fine, because a client that reaches this method WITH images has already
   *  proven the host understands `stageImage` (a separate op that fails LOUDLY on an old host, see
   *  chatAdapter.ts) before ever getting here. Omitted keys, not `undefined` values: the schema refuses
   *  an empty one, and a key carrying `undefined` is not the same offer as no key. */
  prompt(text: string, uuid?: string, images?: { stagedId: string; sha256: string }[]): Promise<{ ok: boolean; accepted?: boolean; seq?: number; error?: string }> {
    return this.send({ op: "prompt", text, ...(uuid ? { uuid } : {}), ...(images && images.length ? { images } : {}) });
  }
  /** F9 T-IMAGE Task 5 (I3b): mint a staging file for one image. An `error: "unknown op"` reply is the
   *  LOUD version-skew signal (an old host's discriminated union does not recognize this literal at all,
   *  server.ts's dispatch) — `chatAdapter.ts` is what turns that into the client-facing restart notice. */
  stageImageOp(descriptor: { mediaType: string; dimensions: { width: number; height: number }; size: number; sha256: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    return this.send({ op: "stageImage", ...descriptor });
  }
  interrupt(): Promise<{ ok: boolean; error?: string }> { return this.send({ op: "interrupt" }); }
  stopHost(): Promise<{ ok: boolean; error?: string }> { return this.send({ op: "stop" }); }

  // Task 2's control ops — one method per op, `…Op` suffix keeps this raw wire client visibly distinct
  // from the `ChatSession` methods the Task 5 adapter layers on top.
  setModelOp(model?: string) { return this.send<{ ok: boolean; error?: string }>({ op: "set_model", ...(model ? { model } : {}) }); }
  setPermissionModeOp(mode: string) { return this.send<{ ok: boolean; error?: string }>({ op: "set_permission_mode", mode }); }
  setThinkingOp(maxTokens: number | null) { return this.send<{ ok: boolean; error?: string }>({ op: "set_thinking", maxTokens }); }
  /** FOUR catalogs (M3 §1a-d) — `agents` is the SDK's supportedAgents, forwarded verbatim by the host's
   *  control passthrough. Every one is optional here for the same reason `error` is: a throwing handler
   *  answers the generic `{ok:false, error}` instead, and a pre-M3 host answers without `agents`. */
  capabilitiesOp() { return this.send<{ ok: boolean; error?: string; models?: unknown[]; commands?: unknown[]; mcpServers?: unknown[]; agents?: unknown[] }>({ op: "capabilities" }); }
  compactOp() { return this.send<{ ok: boolean; error?: string; outcome?: unknown }>({ op: "compact" }, COMPACT_TIMEOUT_MS); }
  usageOp() { return this.send<{ ok: boolean; error?: string; usage?: unknown }>({ op: "usage" }); }
  contextUsageOp() { return this.send<{ ok: boolean; error?: string; usage?: unknown }>({ op: "context_usage" }); }
  mcpStatusOp() { return this.send<{ ok: boolean; error?: string; servers?: unknown[] }>({ op: "mcp_status" }); }
  mcpReconnectOp(name: string) { return this.send<{ ok: boolean; error?: string }>({ op: "mcp_reconnect", name }); }
  mcpToggleOp(name: string, enabled: boolean) { return this.send<{ ok: boolean; error?: string }>({ op: "mcp_toggle", name, enabled }); }
  resumeOp(sessionId: string) { return this.send<{ ok: boolean; error?: string }>({ op: "resume", sessionId }); }
  /** The engine half of /clear — a fresh-conversation engine swap, busy-gated server-side like resume. */
  clearOp() { return this.send<{ ok: boolean; error?: string }>({ op: "clear" }); }

  // C5 T3: Esc-Esc rewind wire ops. anchors/dryRun are read-only; rewind is busy-gated server-side (see
  // server.ts's dispatch arm), same as resumeOp.
  rewindAnchorsOp() { return this.send<{ ok: boolean; error?: string; anchors?: RewindAnchor[] }>({ op: "rewind_anchors" }); }
  rewindDryRunOp(uuid: string) { return this.send<{ ok: boolean; error?: string; dryRun?: RewindDryRun }>({ op: "rewind_dryrun", uuid }, REWIND_TIMEOUT_MS); }
  rewindOp(uuid: string, prevUuid: string | null, scope: RewindScope) { return this.send<{ ok: boolean; error?: string }>({ op: "rewind", uuid, prevUuid, scope }, NO_TIMEOUT); }

  // W3 T2: settings/dirs wire ops, same `…Op` shape as the control ops above. get_settings/list_dirs are
  // read-only passthroughs; the rest mutate the host's flag-state accumulator (server.ts's dispatch never
  // busy-gates any of these, unlike resume/rewind, so the default timeout is fine).
  getSettingsOp() { return this.send<{ ok: boolean; error?: string; settings?: unknown }>({ op: "get_settings" }); }
  listDirsOp() { return this.send<{ ok: boolean; error?: string; dirs?: { path: string; source: "cwd" | "launch" | "session" }[] }>({ op: "list_dirs" }); }
  addDirOp(path: string) { return this.send<{ ok: boolean; error?: string }>({ op: "add_dir", path }); }
  removeDirOp(path: string) { return this.send<{ ok: boolean; error?: string }>({ op: "remove_dir", path }); }
  setOutputStyleOp(style: string) { return this.send<{ ok: boolean; error?: string }>({ op: "set_output_style", style }); }
  addRuleOp(behavior: "allow" | "ask" | "deny", rule: string) { return this.send<{ ok: boolean; error?: string }>({ op: "add_rule", behavior, rule }); }
  removeRuleOp(behavior: "allow" | "ask" | "deny", rule: string) { return this.send<{ ok: boolean; error?: string }>({ op: "remove_rule", behavior, rule }); }
  /** W-C T11: the effort flip (EP-C6). Same `…Op` shape and same never-busy-gated flag-layer group as
   *  `setOutputStyleOp` — the host answers it with `applyFlagSettings({effortLevel})` (probe 102). */
  setEffortOp(level: "low" | "medium" | "high" | "xhigh" | "max") { return this.send<{ ok: boolean; error?: string }>({ op: "set_effort", level }); }
  /** Task 2 (bl8 T-ADVCMD). Same `…Op` shape and same never-busy-gated flag-layer group as `setEffortOp` —
   *  the host answers it with `applyFlagSettings({advisorModel})` (P119 case 4). `model` is nullable, not
   *  optional: `null` round-trips as the JSON value `null`, canon's explicit "off", never a dropped field. */
  setAdvisorModelOp(model: string | null) { return this.send<{ ok: boolean; error?: string }>({ op: "set_advisor_model", model }); }

  /** Subscribe to the host's pushed events. The first live subscription sends `follow`; the last one
   *  leaving sends `unfollow`. Followers are keyed by a per-call token, not by the callback reference,
   *  so subscribing the same function twice creates two independent subscriptions (dropping one leaves
   *  the other's events flowing), and the returned unsubscribe is itself idempotent — calling it twice
   *  cannot send a second `unfollow` for a subscriber count that only ever dropped once. */
  follow(cb: (ev: HostEvent) => void): () => void {
    const id = this.nextFollowerId++;
    const first = this.followers.size === 0;
    this.followers.set(id, cb);
    if (first) { this.followAck = this.send({ op: "follow" }); this.followAck.catch(() => {}); }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.followers.delete(id);
      if (this.followers.size === 0) { void this.send({ op: "unfollow" }).catch(() => {}); this.followAck = undefined; }
    };
  }

  /** The in-flight (or settled) `follow` ack for the currently-live subscription — `undefined` before
   *  the first `follow()` and again once the last follower leaves; the next `follow()` re-sends and
   *  re-populates it. */
  whenFollowed(): Promise<unknown> | undefined { return this.followAck; }

  /** Drop this connection. The host keeps running, its turn keeps going, and anything parked stays
   *  parked — that is the whole distinction between detach and stop. */
  detach(): void { this.sock.destroy(); }
}
