// harness/src/client/chatAdapter.ts — a lazily-connecting ChatSession over RemoteChatSession. The REPL's
// makeSession() must return synchronously (ink renders immediately); every method awaits `ready`.
import { createHash } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { RemoteChatSession } from "./remote.js";
import type { HostEvent } from "../host/wire.js";
import type { ChatSession, DecisionFeed, BgTasks, SessionEvents, RewindOps, RewindAnchor, RewindScope, SettingsOps, EffortLevel } from "../session/chatSession.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { CompactOutcome } from "../compaction/index.js";
import type { UserTurnInput } from "../session/turnInput.js";
import { MAX_IMAGES_PER_PROMPT, jpegDimensions, pngDimensions, gifDimensions, webpDimensions } from "../media/imageDims.js";

/** F9 T-IMAGE Task 5 (I3b), spec v3.1: "version skew is LOUD" — the exact message a caller (`useChat.ts`)
 *  matches on to render this as a capability NOTICE rather than a turn-failure error line. Shared as one
 *  constant so the throw site and the render site cannot drift apart. */
export const IMAGE_VERSION_SKEW_NOTICE = "image paste needs a restarted host";

export interface RemoteChatOpts { label?: string; resume?: string; connect?: (p: string, o?: { label?: string }) => Promise<RemoteChatSession>; }
export type RemoteChat = ChatSession & DecisionFeed & BgTasks & SessionEvents & RewindOps & SettingsOps & { detach(): void; whenReady(): Promise<void>; pendingNow(): PendingDecision[] };

export function remoteChatSession(socketPath: string, opts: RemoteChatOpts = {}): RemoteChat {
  let raw: RemoteChatSession | undefined;
  let sessionId: string | undefined;
  let turnWaiter: { seq: number; resolve: () => void; reject: (e: Error) => void } | undefined;
  let turnSink: ((m: unknown) => void) | undefined;
  // Turn ends the client saw before a waiter existed for them. The end frame can legitimately be
  // PROCESSED before submit()'s continuation installs its waiter: a fast turn's end can precede the
  // prompt reply on the wire (runTask's continuation races dispatch's), and even a reply-first wire
  // order coalesces into one data chunk whose frames are routed synchronously while the reply's
  // `await` continuation is still queued. Without this ledger, submit() waits forever on a turn that
  // already ended (plan-review finding 1). Entries are consumed on match; the map stays O(1) because
  // turns are strictly sequential per host.
  const endedTurns = new Map<number, string | undefined>();
  const pendingList: PendingDecision[] = [];
  const decisionCbs = new Set<(e: PendingDecision) => void>();
  const settledCbs = new Set<(s: { toolUseID: string; by: string; decision: string }) => void>();
  let eventCb: ((ev: HostEvent) => void) | undefined;
  const backlog: HostEvent[] = [];          // events before the single consumer subscribes

  const route = (ev: HostEvent): void => {
    if (ev.kind === "message") { try { turnSink?.(ev.data); } catch { /* sink is the consumer's problem */ } }
    // READ ALIAS (spec Decision Log): a pre-Goal-B host still emits permission/permission_settled — ingest
    // them as decisions so an upgraded `ccx attach` reads a long-lived old host. kind defaults to
    // "permission" (old entries carry none); a new host's own kind wins the spread. Cast to `any`: the
    // legacy frames are no longer `HostEvent` variants, so `ev` cannot narrow onto them.
    else {
      const k = (ev as { kind: string }).kind;
      if (k === "decision" || k === "permission") {
        const entry = { kind: "permission", ...(ev as any).entry } as PendingDecision;
        pendingList.push(entry); for (const cb of [...decisionCbs]) { try { cb(entry); } catch {} }
      } else if (k === "decision_settled" || k === "permission_settled") {
        const s = ev as any;
        const i = pendingList.findIndex((e) => e.toolUseID === s.toolUseID);
        if (i >= 0) pendingList.splice(i, 1);
        for (const cb of [...settledCbs]) { try { cb({ toolUseID: s.toolUseID, by: s.by, decision: s.decision }); } catch {} }
      } else if (ev.kind === "state") { if (ev.status.sessionId) sessionId = ev.status.sessionId; }
      // Live-feedback fix (2026-08-06): the rewind engine swap can mint a NEW session id, and the host's
      // rewound broadcast is the one frame guaranteed to carry it — the state emit inside swapEngine often
      // fires before the fresh engine's init frame has delivered an id at all. Without this, a client's
      // post-rewind transcript rebuild reads disk under the OLD id.
      // …and FORGET it on the cleared arm (W-S8 review, Important 1), for the same reason clearSession()
      // below forgets it: a first-message restore swaps to a fresh engine that has no id until its first
      // init frame, so `this.session?.sessionId ?? sid` puts the DISCARDED conversation's id on the wire.
      // Overwriting with it would leave /export writing the discarded transcript and /rename and /tag
      // mutating the abandoned session's metadata. A later state (or rewound) event with a real id
      // repopulates. `cleared` is the positive signal; it never travels with a fresh id to adopt.
      else if (ev.kind === "rewound") { if (ev.cleared) sessionId = undefined; else if (ev.sessionId) sessionId = ev.sessionId; }
      else if (ev.kind === "turn" && ev.phase === "end" && ev.seq !== undefined) {
        if (turnWaiter && ev.seq === turnWaiter.seq) { const w = turnWaiter; turnWaiter = undefined; ev.error ? w.reject(new Error(ev.error)) : w.resolve(); }
        else endedTurns.set(ev.seq, ev.error);      // ended before its waiter existed — submit() consults this
      }
    }
    if (eventCb) { try { eventCb(ev); } catch {} } else backlog.push(ev);
  };

  const ready: Promise<RemoteChatSession> = (async () => {
    const r = await (opts.connect ?? ((p, o) => RemoteChatSession.connect(p, o)))(socketPath, { label: opts.label ?? `ccx-${process.pid}` });
    raw = r;
    // A dead host must settle everything a REPL can be waiting on, or busy sticks true and even the
    // Ctrl+C exit path (gated on !busy) becomes unreachable — the teardown-liveness class.
    r.onClose((e) => {
      if (turnWaiter) { const w = turnWaiter; turnWaiter = undefined; w.reject(e); }
      turnSink = undefined;
      // A dead host must also settle every still-parked decision — otherwise useChat's dropPending
      // never fires, the dialog stays mounted on a connection that will never answer, and the only way
      // out is the 10s request timeout or Ctrl+C (the teardown-liveness bug class this project keeps
      // rediscovering). Snapshot pendingList BEFORE routing: route() mutates it as each synthetic
      // decision_settled is processed, and iterating the live array while splicing it would skip
      // entries. Settles exactly once and cannot double-fire against a real decision_settled already in
      // flight: Node delivers all buffered `data` (including any settle the host sent before it went
      // away) before `close` fires, so by the time this callback runs, pendingList already reflects
      // every real settle — an entry this loop touches was never settled for real.
      for (const entry of [...pendingList]) route({ kind: "decision_settled", toolUseID: entry.toolUseID, by: "system", decision: "deny" });
      route({ kind: "turn", phase: "end", error: e.message });   // no seq: pure UI unblock, matches no waiter
    });
    // RESUME BEFORE FOLLOW, and that order is load-bearing (M3 §1a-a): the host announces every engine swap
    // with a `rewound` broadcast, and a client that was already following would receive its OWN resume's
    // announcement and rebuild its transcript from disk on top of the replay it is about to be sent. Issuing
    // the op while this connection is not yet a follower is what makes the self-swap silent to its initiator —
    // the same guarantee `useChat`'s `selfRewind` ref buys the /clear and rewind paths, which have no such
    // pre-follow window because they run on a long-established connection.
    if (opts.resume) { const rep = await r.resumeOp(opts.resume); if (!rep.ok) throw new Error(rep.error ?? "resume refused"); }
    r.follow(route);
    await r.whenFollowed();                 // registration acked — a prompt sent after this cannot race it
    return r;
  })();
  ready.catch(() => {});                     // surfaced per-call below, never unhandled

  const orFail = <T extends { ok: boolean; error?: string }>(rep: T): T => { if (!rep.ok) throw new Error(rep.error ?? "host refused"); return rep; };

  return {
    get sessionId() { return sessionId; },
    whenReady: async () => { await ready; },
    pendingNow: () => [...pendingList],
    // F9 T-IMAGE Task 5 (I3b): the socket-owning adapter is where staging lives (spec v3.1) — it knows
    // the socket, so loopback, detachable and attach all stage through this exact path. A string prompt
    // costs nothing extra (the array branch below never runs); an array prompt walks its image blocks,
    // stages each one (mint → write bytes → claim), and folds every text block into ONE string for the
    // wire (the `prompt` op has one `text` field, not a block array — the host reassembles the real
    // content array itself once it has read the staged bytes back, `host.ts`'s `assembleStagedContent`).
    async submit(prompt: UserTurnInput, onMessage: (m: unknown) => void) {
      const r = await ready;
      // One in-flight submit per client: a second would clobber turnSink/turnWaiter under the first
      // (this adapter is public API — the REPL's own queue already serializes, but callers vary).
      if (turnWaiter || turnSink) throw new Error("a submit is already in flight on this client");
      let text: string;
      const images: { stagedId: string; sha256: string }[] = [];
      // CLIENT-owned until the host accepts the prompt (spec v3.1 "Ownership/GC"): every path staged in
      // THIS call that has not yet been claimed by an accepted prompt gets deleted on any failure this
      // method reaches — version skew, a stage-op failure, a busy refusal, a dead connection. Cleared
      // only once `r.prompt(...)` has actually returned `ok:true` below, past which the HOST owns them.
      const stagedPaths: string[] = [];
      const cleanupStaged = async (): Promise<void> => { for (const p of stagedPaths.splice(0)) await unlink(p).catch(() => {}); };
      if (typeof prompt === "string") { text = prompt; }
      else {
        // `assembleUserContent` (session/turnInput.ts) always puts exactly one text block first — joined
        // defensively rather than assumed, so a future multi-text-block caller degrades to concatenation
        // instead of silently dropping every block past the first.
        text = prompt.filter((b) => b.type === "text").map((b) => b.text).join("");
        // Final-review finding 4: the host's own MAX_IMAGES_PER_PROMPT cap must also gate HERE, before
        // the staging loop — staging every block first and only discovering the excess at the host means
        // this client already paid for (and must then clean up) staged files the host was always going to
        // refuse. Excess blocks degrade the same way an unreadable one does (finding 3): the failure text
        // appended, no `stageImageOp` call at all.
        let imageOrdinal = 0;
        for (const block of prompt) {
          if (block.type !== "image") continue;
          imageOrdinal++;
          if (imageOrdinal > MAX_IMAGES_PER_PROMPT) {
            text += `[Image could not be processed: too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})]`;
            continue;
          }
          const buf = Buffer.from(block.source.data, "base64");
          // Header-decode, not caller-trust — same posture `session/turnInput.ts`'s builder takes: the
          // wire's `UserContentBlock` carries no dimensions field, so this is the only place a REMOTE
          // submit can report one at all.
          const dims = pngDimensions(buf) ?? jpegDimensions(buf) ?? gifDimensions(buf) ?? webpDimensions(buf);
          if (!dims) {
            // Final-review finding 3: degrade CLIENT-SIDE, before ever staging. `ops.ts`'s `stageImage`
            // schema requires POSITIVE dimensions — sending a 0x0 sentinel for an unreadable image used
            // to reach that schema, get rejected, and have this adapter misread the rejection as version
            // skew (the "unknown op"-vs-"invalid payload" honesty fix lives in server.ts's `dispatch`).
            // Never stage what the schema was never going to accept; degrade to the same failure text
            // block `session/turnInput.ts`'s authoritative normalizer would produce for the same reason.
            text += "[Image could not be processed: unreadable image data]";
            continue;
          }
          const sha256 = createHash("sha256").update(buf).digest("hex");
          let stageReply: { ok: boolean; path?: string; error?: string };
          try { stageReply = await r.stageImageOp({ mediaType: block.source.media_type, dimensions: dims, size: buf.length, sha256 }); }
          catch (e) { await cleanupStaged(); turnSink = undefined; throw e; }
          if (!stageReply.ok || !stageReply.path) {
            await cleanupStaged();
            turnSink = undefined;
            // "unknown op" is server.ts's own literal for a discriminated-union parse failure where the OP
            // LITERAL ITSELF is unrecognized — an old host's schema does not know the `stageImage` literal
            // at all. That IS version skew, by construction; a host that recognizes the op but rejects its
            // payload for some OTHER reason now answers "invalid op payload" instead (server.ts), so this
            // check no longer collapses the two together.
            throw new Error(stageReply.error === "unknown op" ? IMAGE_VERSION_SKEW_NOTICE : (stageReply.error ?? "image staging failed"));
          }
          try { await writeFile(stageReply.path, buf); }
          catch (e) { await cleanupStaged(); turnSink = undefined; throw e; }
          stagedPaths.push(stageReply.path);
          images.push({ stagedId: stageReply.path, sha256 });
        }
      }
      let result: unknown;
      turnSink = (m) => { if ((m as { type?: string })?.type === "result") result = m; onMessage(m); };
      let seqReply: { ok: boolean; seq?: number; error?: string };
      try { seqReply = await r.prompt(text, undefined, images.length ? images : undefined); }
      catch (e) { await cleanupStaged(); turnSink = undefined; throw e; }
      if (!seqReply.ok || seqReply.seq === undefined) {
        // Busy-host refusal (or any other prompt-op failure) leaves the staged files unclaimed — this
        // client still owns them, so it cleans up rather than leaving them for the sweep (spec v3.1).
        await cleanupStaged();
        turnSink = undefined;
        throw new Error(seqReply.error ?? "prompt refused");
      }
      // ACCEPTED: ownership passes to the host from here (spec v3.1) — `stagedPaths` is never read again,
      // so there is nothing left in this method that could double-delete a file the host now owns.
      const seq = seqReply.seq;
      try {
        // The end may already be in the ledger — a fast turn's end frame is routed in onData's
        // synchronous loop while this continuation is still queued (see endedTurns above).
        if (endedTurns.has(seq)) { const err = endedTurns.get(seq); endedTurns.delete(seq); if (err) throw new Error(err); }
        else await new Promise<void>((resolve, reject) => { turnWaiter = { seq, resolve, reject }; });
      } finally { turnSink = undefined; }
      return { result };
    },
    async setPermissionMode(mode) { orFail(await (await ready).setPermissionModeOp(mode)); },
    async setModel(model) { orFail(await (await ready).setModelOp(model)); },
    async setMaxThinkingTokens(t) { orFail(await (await ready).setThinkingOp(t)); },
    async capabilities() { const rep = orFail(await (await ready).capabilitiesOp()); return { models: rep.models ?? [], commands: rep.commands ?? [], mcpServers: rep.mcpServers ?? [] }; },
    async compact() { return orFail(await (await ready).compactOp()).outcome as CompactOutcome; },
    // FORGET the cached id (codex review, F6 close). /clear replaces the host's engine with a fresh one that
    // has no session id until its first turn, so the host's own state emit carries none — and `route` only
    // ever OVERWRITES on a truthy id. Left alone, `session.sessionId` would keep pointing at the CLEARED
    // conversation and /export, /rename and /tag would act on the old transcript. A later state (or rewound)
    // event with a real id repopulates it.
    async clearSession() { orFail(await (await ready).clearOp()); sessionId = undefined; },
    async interrupt() { return orFail(await (await ready).interrupt()); },
    async getContextUsage() { return orFail(await (await ready).contextUsageOp()).usage; },
    async usage() { return orFail(await (await ready).usageOp()).usage; },
    async mcpServerStatus() { return orFail(await (await ready).mcpStatusOp()).servers ?? []; },
    async reconnectMcpServer(name) { orFail(await (await ready).mcpReconnectOp(name)); },
    async toggleMcpServer(name, enabled) { orFail(await (await ready).mcpToggleOp(name, enabled)); },
    // dispose() is the ChatSession teardown hook useChat calls on unmount/swap — for a REMOTE session
    // that means detach, never stop: the host, its turn and its parks outlive this client (spec §5).
    async dispose() { raw?.detach(); void ready.catch(() => {}); },
    detach() { raw?.detach(); },
    onDecision(cb) { decisionCbs.add(cb); for (const e of [...pendingList]) { try { cb(e); } catch {} } return () => { decisionCbs.delete(cb); }; },
    onDecisionSettled(cb) { settledCbs.add(cb); return () => { settledCbs.delete(cb); }; },
    async answerDecision(toolUseID, outcome: DecisionOutcome) { return (await ready).answerDecision(toolUseID, outcome); },
    async listBgTasks() { return orFail(await (await ready).tasksOp()).tasks ?? []; },
    async background() { return orFail(await (await ready).backgroundOp()).backgrounded ?? false; },
    async stopBgTask(taskId) { orFail(await (await ready).stopTaskOp(taskId)); },
    async rewindAnchors() { return orFail(await (await ready).rewindAnchorsOp()).anchors ?? []; },
    async rewindDryRun(uuid: string) { return orFail(await (await ready).rewindDryRunOp(uuid)).dryRun ?? { canRewind: false, error: "no reply" }; },
    async rewind(anchor: RewindAnchor, scope: RewindScope) { orFail(await (await ready).rewindOp(anchor.uuid, anchor.prevUuid, scope)); },
    // W3 T2: settings/dirs surface — same await-ready-then-op pattern as stopBgTask/rewindAnchors above.
    async getSettings() { return orFail(await (await ready).getSettingsOp()).settings; },
    async listDirs() { return orFail(await (await ready).listDirsOp()).dirs ?? []; },
    async addDir(path: string) { orFail(await (await ready).addDirOp(path)); },
    async removeDir(path: string) { orFail(await (await ready).removeDirOp(path)); },
    async setOutputStyle(style: string) { orFail(await (await ready).setOutputStyleOp(style)); },
    async addRule(behavior: "allow" | "ask" | "deny", rule: string) { orFail(await (await ready).addRuleOp(behavior, rule)); },
    async removeRule(behavior: "allow" | "ask" | "deny", rule: string) { orFail(await (await ready).removeRuleOp(behavior, rule)); },
    // W-C T11 (EP-C6): the effort flip. The level is already inside the domain by the time it gets here —
    // useChat's `applyEffort` gate is what makes that true, and `ops.ts`'s enum is what makes it enforced.
    async setEffort(level: EffortLevel) { orFail(await (await ready).setEffortOp(level)); },
    onSessionEvent(cb) {
      if (!eventCb) { eventCb = cb; for (const ev of backlog.splice(0)) { try { cb(ev); } catch {} } }
      else eventCb = cb;                     // single consumer: a re-subscribe replaces (useChat's session swap)
      return () => { if (eventCb === cb) eventCb = undefined; };
    },
  };
}
