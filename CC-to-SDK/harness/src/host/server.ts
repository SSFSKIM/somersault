import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { hostOp } from "./ops.js";
import type { ControlOp, HostStatus } from "./ops.js";
import { decodeFrame, encodeEvent, encodeReply } from "./wire.js";
import type { HostEvent, HostFrame } from "./wire.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";

export interface HostHandlers {
  status(): HostStatus;
  // The `prompt` gate's OWN truthful signal — NOT status().status. status() deliberately projects a
  // parked turn as {state:"blocked", status:"idle"} for consumers (spec-mandated), which makes it "idle"
  // for the entire duration of a park — the state a background host spends real time in by design. A
  // gate built on that projection is open exactly when a turn is mid-flight, letting a second `prompt`
  // re-enter SessionHost.runTask and reset the turn buffer out from under it.
  busy(): boolean;
  stop(): Promise<void>;
  pending(): PendingEntry[];
  answer(toolUseID: string, outcome: DecisionOutcome, by: string): { ok: boolean; alreadyAnsweredBy?: string; error?: string };
  /** `uuid` (M3 §1a-b) is the caller's id for the user item this turn starts from — forwarded verbatim to
   *  the session's submit opts, never invented here: a host-minted id would stitch to nothing.
   *  `images` (F9 T-IMAGE Task 5/I3b) is the claim list from the `prompt` op's own `images` field —
   *  staged-file ids the client has already written bytes to. Validating/reading/assembling them into
   *  the turn's content and deleting every claimed file afterward is entirely `runTask`'s job (host.ts);
   *  this signature only has to carry the claim through. */
  prompt(text: string, uuid?: string, images?: { stagedId: string; sha256: string }[]): Promise<void>;
  interrupt(): Promise<void>;
  /** Register ONE sink for ONE connection; the returned function unregisters it. The sink is what the
   *  server writes to that socket — fan-out lives in the host's follower set, never here. */
  follow(deliver: (ev: HostEvent) => void): () => void;
  /** The A2b control-op passthrough — one call per wire op, dispatched by `dispatch` below. */
  control(op: ControlOp): Promise<Record<string, unknown>>;
  /** Swap the underlying session for a resume of `sessionId`. Gated exactly like `prompt` (see the
   *  `resume` dispatch arm) — a turn in flight must refuse it, not race it. */
  resume(sessionId: string): Promise<void>;
  /** Swap the underlying session for a FRESH conversation — the engine half of /clear. Gated exactly
   *  like `resume` and for the same reason. */
  clear(): Promise<void>;
  /** The seq of the last started turn — read by the `prompt` reply so a client can correlate its
   *  submit() to this turn's `end` event (adapter, Task 5). */
  turnSeq(): number;
  // GB T4: the background-task surface. `tasks` reads the host's own snapshot and never fails — it
  // never touches the session. `background`/`stopTask` call through to the session and throw (dispatch's
  // catch turns it into `{ok:false, error:…}`) when the session lacks the member.
  tasks(): BackgroundTaskInfo[];
  background(toolUseId?: string): Promise<boolean>;
  stopTask(taskId: string): Promise<void>;
  // C5 T3: Esc-Esc rewind — anchors/dryRun are read-only passthroughs; `rewind` is gated like `resume`
  // (see the dispatch arm) because it swaps the underlying engine.
  rewindAnchors(): Promise<RewindAnchor[]>;
  rewindDryRun(uuid: string): Promise<RewindDryRun>;
  /** Gated like `resume` (see the dispatch arm) — busy must refuse, not race. */
  rewind(anchor: { uuid: string; prevUuid: string | null }, scope: RewindScope): Promise<void>;
  // W3 T1: the settings/dirs surface. get_settings/list_dirs are read-only; the rest mutate the host's
  // flag-state accumulator. None of these are busy-gated — they touch only the dynamic flag layer, not
  // the engine conversation, so they are safe to run mid-turn (unlike resume/rewind).
  getSettings(): Promise<unknown>;
  listDirs(): { path: string; source: "cwd" | "launch" | "session" }[];
  addDir(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  setOutputStyle(style: string): Promise<void>;
  addRule(behavior: "allow" | "ask" | "deny", rule: string): Promise<void>;
  removeRule(behavior: "allow" | "ask" | "deny", rule: string): Promise<void>;
  // WAVE C TASK 11 (EP-C6): the effort flip. Same flag-layer group, same no-busy-gate rule — it touches the
  // dynamic settings layer, never the engine conversation, so it is safe mid-turn.
  setEffort(level: "low" | "medium" | "high" | "xhigh" | "max"): Promise<void>;
  // F9 T-IMAGE Task 5 (I3b): mint a staging file. Synchronous by contract (`ImageStaging.stage` is a
  // cheap mkdir+empty-write, never busy-gated — like the flag-layer ops above, it touches only the
  // staging directory, not the engine conversation) — never awaited by dispatch, so this can never be the
  // thing that delays a status reply mid-turn.
  stageImage(descriptor: { mediaType: string; dimensions: { width: number; height: number }; size: number; sha256: string }): { path: string };
}

/** A frame with no newline in sight past this is a runaway peer, not an op. Same-user only (the socket
 *  sits under a 0o700 dir), but a detached host outlives its parent, so an unbounded buffer is not free.
 *  Bounds client→host traffic ONLY — small fixed-shape ops (`status`/`answer`/`prompt`). The OTHER
 *  direction (host→client event frames, which carry SDK messages including large tool results) has its
 *  own, much larger cap in `RemoteChatSession` — the two are not the same traffic and must not share a
 *  constant (see client/remote.ts's `MAX_FRAME` for why reusing this one broke a legitimate stream). */
const MAX_FRAME = 256 * 1024;

/** Final-review finding 3: every op literal `hostOp`'s discriminated union recognizes, read off the
 *  schema itself (`_zod.propValues.op`, the same Set the union's own fast-path discriminator uses) so
 *  this can never drift from the literals actually listed in `ops.ts`. What this buys: `dispatch` below
 *  can now tell "this host's schema has never heard of this op at all" (a genuinely OLDER host — the
 *  wire's own version-skew signal, `chatAdapter.ts`'s `IMAGE_VERSION_SKEW_NOTICE`) apart from "this host
 *  knows the op but the payload failed some OTHER check" (a bad dimension, an empty prompt with no
 *  images) — both used to collapse to the identical "unknown op" string, which is what let a validation
 *  rejection misreport as skew. */
const KNOWN_OPS: ReadonlySet<string> = new Set(
  [...(hostOp._zod.propValues?.op ?? [])].filter((v): v is string => typeof v === "string"),
);

/** One UDS listener per SESSION (not per fleet). NDJSON frames, one op per line; the connection stays
 *  open so A2 can add a long-lived `follow` stream over the same socket. */
export class HostServer {
  private server: Server;
  private closing = false;
  private open = new Set<Socket>();
  private closeResolve!: () => void;
  readonly closed: Promise<void> = new Promise((r) => { this.closeResolve = r; });

  /** How many peers currently hold a socket open (attached or not — a client that never sends `follow`
   *  still counts, the same way `this.open` does). */
  connectionCount(): number { return this.open.size; }

  constructor(private handlers: HostHandlers, private socketPath: string) {
    this.server = createServer((s) => this.onConnection(s));
  }

  async listen(): Promise<void> {
    mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    rmSync(this.socketPath, { force: true });          // a stale file from a SIGKILLed predecessor
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.server.once("error", onErr);
      this.server.listen(this.socketPath, () => { this.server.off("error", onErr); resolve(); });
    });
    // the startup listener is gone now; an unhandled post-listen 'error' (an accept-time EMFILE, say)
    // throws out of the event loop and kills the whole detached host
    this.server.on("error", () => {});
  }

  async close(): Promise<void> {
    if (this.closing) return this.closed;   // a racing caller waits for the real close, not a bare return
    this.closing = true;
    const done = new Promise<void>((resolve) => this.server.close(() => resolve()));
    for (const s of this.open) s.destroy();   // close() waits for every open connection; the `stop` op
    this.open.clear();                        // is answered over one, so waiting on it would deadlock
    await done;
    rmSync(this.socketPath, { force: true });
    this.closeResolve();
  }

  private onConnection(sock: Socket): void {
    this.open.add(sock);
    // A vanished client releases its host-side subscription too — otherwise a follow() registered by a
    // connection that then disconnects leaks its host-side callback for the life of the host.
    sock.once("close", () => { this.open.delete(sock); this.unfollow(sock); });
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf8");
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        // a throwing handler (or an unserializable snapshot) must answer an error frame, not reject
        // unowned and take the host process down with it. The id is parsed off the frame BEFORE the op
        // is validated, so a malformed op still gets a correlated error reply rather than an orphan the
        // client cannot match.
        const frame = decodeFrame(line);
        const id = typeof frame?.["id"] === "number" ? (frame["id"] as number) : undefined;
        try { sock.write(encodeReply(id, await this.dispatch(frame, sock))); }
        catch (e) { sock.write(encodeReply(id, { ok: false, error: (e as Error).message })); }
      }
      if (buf.length > MAX_FRAME) { buf = ""; sock.destroy(); }
    });
    sock.on("error", () => { /* a client that vanished mid-write is not our failure */ });
  }

  private async dispatch(frame: HostFrame | undefined, sock: Socket): Promise<Record<string, unknown>> {
    if (!frame) return { ok: false, error: "bad json" };
    const op = hostOp.safeParse(frame);
    if (!op.success) {
      // "unknown op" is reserved for a literal this schema has NEVER heard of — the real version-skew
      // signal. A recognized literal whose payload failed some OTHER check (a refine, a field bound)
      // gets its own honest reason instead of reusing that string (final-review finding 3).
      const literal = (frame as Record<string, unknown>)["op"];
      const recognized = typeof literal === "string" && KNOWN_OPS.has(literal);
      return { ok: false, error: recognized ? "invalid op payload" : "unknown op" };
    }
    switch (op.data.op) {
      case "status": return { ok: true, ...this.handlers.status() };
      case "stop": await this.handlers.stop(); return { ok: true };
      case "pending": return { ok: true, pending: this.handlers.pending() };
      // Exactly one of the flat legacy `decision` or the structured `answer` must be present — an old
      // client (pre-Goal-B) only ever sends `decision`, so that shape stays supported forever; ambiguity
      // (both, or neither) is refused here rather than silently preferring one.
      case "answer": {
        const d = op.data;
        const outcome = d.answer ?? (d.decision ? ({ kind: d.decision } as const) : undefined);
        if (!outcome || (d.answer && d.decision)) return { ok: false, error: "answer needs exactly one of decision|answer" };
        return { ...this.handlers.answer(d.toolUseID, outcome, d.by) };
      }
      // A prompt is NOT awaited before replying: a turn runs for minutes, and holding the reply would
      // stall this connection's every other op — including the `interrupt` that ends the very turn it
      // is waiting on. The turn's progress travels as events instead. Gated on `busy()`, the handler's
      // OWN flag — NOT `status().status`, whose "blocked"/idle projection reads idle for the entire
      // duration of a park (see HostHandlers.busy's doc). A second prompt landing mid-turn, parked or
      // not, would reset the TurnBuffer under the running turn and let turn one's completion finalize
      // the roster while turn two is still going.
      case "prompt": {
        if (this.handlers.busy()) return { ok: false, error: "busy" };
        // `text` is optional on the wire now (finding 2: an image-only prompt sends none) — the schema's
        // own `.refine` already guarantees at least one image is present when it is absent, so `""` here
        // is never a silently-empty turn.
        void this.handlers.prompt(op.data.text ?? "", op.data.uuid, op.data.images).catch(() => {});
        // runTask increments its seq synchronously before its first await, so it is readable here — the
        // client correlates its submit() to THIS turn's end event by it (adapter, Task 5). This holds
        // EVEN with staged images attached: runTask reserves the seq before it ever touches the
        // filesystem to read them back (host.ts's runTask, load-bearing per spec v3.1 "Turn correlation").
        return { ok: true, accepted: true, seq: this.handlers.turnSeq() };
      }
      // F9 T-IMAGE Task 5 (I3b): synchronous mint, never awaited — see HostHandlers.stageImage's doc.
      case "stageImage": return { ok: true, ...this.handlers.stageImage({ mediaType: op.data.mediaType, dimensions: op.data.dimensions, size: op.data.size, sha256: op.data.sha256 }) };
      case "interrupt": await this.handlers.interrupt(); return { ok: true };
      case "follow": {
        // Idempotent per connection: a client that sends `follow` twice must not end up with two
        // sinks writing every event to it twice.
        if (!this.unfollows.has(sock)) {
          this.unfollows.set(sock, this.handlers.follow((ev) => {
            try { sock.write(encodeEvent(ev)); } catch { /* the peer went away mid-write; close handles it */ }
          }));
        }
        return { ok: true, following: true };
      }
      case "unfollow": { this.unfollow(sock); return { ok: true, following: false }; }
      case "set_model": case "set_permission_mode": case "set_thinking": case "capabilities": case "compact":
      case "usage": case "context_usage": case "mcp_status": case "mcp_reconnect": case "mcp_toggle":
        return await this.handlers.control(op.data);
      // resume swaps the session under the socket; gated exactly like prompt and for the same reason.
      case "resume": {
        if (this.handlers.busy()) return { ok: false, error: "busy" };
        await this.handlers.resume(op.data.sessionId);
        return { ok: true };
      }
      // clear swaps the engine for a FRESH conversation (the real /clear); gated exactly like resume.
      case "clear": {
        if (this.handlers.busy()) return { ok: false, error: "busy" };
        await this.handlers.clear();
        return { ok: true };
      }
      case "tasks": return { ok: true, tasks: this.handlers.tasks() };
      case "background": return { ok: true, backgrounded: await this.handlers.background() };
      case "stop_task": await this.handlers.stopTask(op.data.taskId); return { ok: true };
      case "rewind_anchors": return { ok: true, anchors: await this.handlers.rewindAnchors() };
      case "rewind_dryrun": return { ok: true, dryRun: await this.handlers.rewindDryRun(op.data.uuid) };
      // rewind swaps the underlying engine under the socket; gated exactly like resume and for the same reason.
      case "rewind": {
        if (this.handlers.busy()) return { ok: false, error: "busy" };
        await this.handlers.rewind({ uuid: op.data.uuid, prevUuid: op.data.prevUuid }, op.data.scope);
        return { ok: true };
      }
      case "get_settings": return { ok: true, settings: await this.handlers.getSettings() };
      case "list_dirs": return { ok: true, dirs: this.handlers.listDirs() };
      case "add_dir": await this.handlers.addDir(op.data.path); return { ok: true };
      case "remove_dir": await this.handlers.removeDir(op.data.path); return { ok: true };
      case "set_output_style": await this.handlers.setOutputStyle(op.data.style); return { ok: true };
      case "set_effort": await this.handlers.setEffort(op.data.level); return { ok: true };
      case "add_rule": await this.handlers.addRule(op.data.behavior, op.data.rule); return { ok: true };
      case "remove_rule": await this.handlers.removeRule(op.data.behavior, op.data.rule); return { ok: true };
    }
  }

  private unfollows = new Map<Socket, () => void>();
  private unfollow(sock: Socket): void {
    const off = this.unfollows.get(sock); this.unfollows.delete(sock); off?.();
  }
}
