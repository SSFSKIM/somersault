// harness/src/client/chatAdapter.ts — a lazily-connecting ChatSession over RemoteChatSession. The REPL's
// makeSession() must return synchronously (ink renders immediately); every method awaits `ready`.
import { RemoteChatSession } from "./remote.js";
import type { HostEvent } from "../host/wire.js";
import type { ChatSession, DecisionFeed, BgTasks, SessionEvents, RewindOps, RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { CompactOutcome } from "../compaction/index.js";

export interface RemoteChatOpts { label?: string; resume?: string; connect?: (p: string, o?: { label?: string }) => Promise<RemoteChatSession>; }
export type RemoteChat = ChatSession & DecisionFeed & BgTasks & SessionEvents & RewindOps & { detach(): void; whenReady(): Promise<void>; pendingNow(): PendingDecision[] };

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
    async submit(prompt, onMessage) {
      const r = await ready;
      // One in-flight submit per client: a second would clobber turnSink/turnWaiter under the first
      // (this adapter is public API — the REPL's own queue already serializes, but callers vary).
      if (turnWaiter || turnSink) throw new Error("a submit is already in flight on this client");
      let result: unknown;
      turnSink = (m) => { if ((m as { type?: string })?.type === "result") result = m; onMessage(m); };
      let seqReply: { ok: boolean; seq?: number; error?: string };
      try { seqReply = await r.prompt(prompt); } catch (e) { turnSink = undefined; throw e; }
      if (!seqReply.ok || seqReply.seq === undefined) { turnSink = undefined; throw new Error(seqReply.error ?? "prompt refused"); }
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
    onSessionEvent(cb) {
      if (!eventCb) { eventCb = cb; for (const ev of backlog.splice(0)) { try { cb(ev); } catch {} } }
      else eventCb = cb;                     // single consumer: a re-subscribe replaces (useChat's session swap)
      return () => { if (eventCb === cb) eventCb = undefined; };
    },
  };
}
