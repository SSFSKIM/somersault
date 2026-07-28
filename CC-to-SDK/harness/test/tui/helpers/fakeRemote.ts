// test/tui/helpers/fakeRemote.ts — a scriptable fake mirroring the RemoteChat wire contract
// (src/client/chatAdapter.ts's route()): ChatSession & DecisionFeed & BgTasks & SessionEvents, with test
// hooks (pushEvent/parkPermission/settlePermission) to drive the host event stream directly — so tui tests
// can exercise the SAME "host event stream is the single rendering source" contract the real adapter
// honors, instead of a bespoke onMessage-callback fake (spec A2b Task 6; renamed onto the Decision/BgTasks
// surface in Goal B Task 7 — the deprecated PermissionFeed names are gone).
import type { HostEvent } from "../../../src/host/wire.js";
import type { PendingEntry } from "../../../src/permissions/pending.js";
import type { DecisionOutcome } from "../../../src/permissions/types.js";
import type { ChatSession, DecisionFeed, BgTasks, SessionEvents } from "../../../src/session/chatSession.js";

export type FakeRemote = ChatSession & DecisionFeed & BgTasks & SessionEvents & {
  disposed: number;
  answeredCalls: { toolUseID: string; decision: DecisionOutcome }[];
  /** Push one host frame straight into the wire pipe — replay-first, single-consumer, exactly like the
   *  real adapter's route(): decision/decision_settled ALSO notify the DecisionFeed callbacks. */
  pushEvent(ev: HostEvent): void;
  /** Convenience: park + notify (`pushEvent({kind:"decision", entry})`). */
  parkPermission(entry: PendingEntry): void;
  /** Convenience: settle + notify (`pushEvent({kind:"decision_settled", ...})`). */
  settlePermission(toolUseID: string, by: string, decision: string): void;
};

export interface FakeRemoteOpts {
  sessionId?: string;
  /** Messages the DEFAULT submit streams through the event pipe (turn start → messages → turn end). */
  submitMessages?: unknown[] | ((prompt: string) => unknown[]);
  submit?: (prompt: string, onMessage: (m: unknown) => void) => Promise<{ result: unknown }>;
  answerDecision?: (toolUseID: string, outcome: DecisionOutcome) => Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }>;
  setPermissionMode?: (mode: string) => unknown;
  setModel?: (model?: string) => unknown;
  setMaxThinkingTokens?: (maxTokens: number | null) => unknown;
  capabilities?: () => unknown;
  compact?: () => unknown;
  interrupt?: () => unknown;
  getContextUsage?: () => unknown;
  usage?: () => unknown;
  mcpServerStatus?: () => unknown;
  reconnectMcpServer?: (name: string) => unknown;
  toggleMcpServer?: (name: string, enabled: boolean) => unknown;
  dispose?: () => unknown;
  listBgTasks?: () => unknown;
  background?: () => unknown;
  stopBgTask?: (taskId: string) => unknown;
}

export function fakeRemote(opts: FakeRemoteOpts = {}): FakeRemote {
  let seq = 0;
  const pendingList: PendingEntry[] = [];
  const decisionCbs = new Set<(e: PendingEntry) => void>();
  const settledCbs = new Set<(s: { toolUseID: string; by: string; decision: string }) => void>();
  let eventCb: ((ev: HostEvent) => void) | undefined;
  const backlog: HostEvent[] = [];
  const answeredCalls: { toolUseID: string; decision: DecisionOutcome }[] = [];

  // Mirrors chatAdapter.ts's route(): decision(_settled) kinds ALSO drive the DecisionFeed
  // callbacks; every kind (incl. those) forwards to the single onSessionEvent consumer.
  const route = (ev: HostEvent): void => {
    if (ev.kind === "decision") {
      pendingList.push(ev.entry);
      for (const cb of [...decisionCbs]) cb(ev.entry);
    } else if (ev.kind === "decision_settled") {
      const i = pendingList.findIndex((e) => e.toolUseID === ev.toolUseID);
      if (i >= 0) pendingList.splice(i, 1);
      for (const cb of [...settledCbs]) cb({ toolUseID: ev.toolUseID, by: ev.by, decision: ev.decision });
    }
    if (eventCb) eventCb(ev); else backlog.push(ev);
  };

  const defaultSubmit = async (prompt: string, onMessage: (m: unknown) => void) => {
    const mySeq = seq++;
    route({ kind: "turn", phase: "start", seq: mySeq });
    const messages = typeof opts.submitMessages === "function" ? opts.submitMessages(prompt)
      : opts.submitMessages ?? [{ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }];
    for (const m of messages) { onMessage(m); route({ kind: "message", data: m }); }
    route({ kind: "turn", phase: "end", seq: mySeq });
    return { result: "done" };
  };

  const fake: FakeRemote = {
    sessionId: opts.sessionId ?? "sess-1",
    disposed: 0,
    answeredCalls,
    submit: opts.submit ?? defaultSubmit,
    async setPermissionMode(mode) { await opts.setPermissionMode?.(mode); },
    async setModel(model) { await opts.setModel?.(model); },
    async setMaxThinkingTokens(maxTokens) { await opts.setMaxThinkingTokens?.(maxTokens); },
    async capabilities() { return ((await opts.capabilities?.()) as any) ?? { models: [], commands: [], mcpServers: [] }; },
    async compact() { return ((await opts.compact?.()) as any) ?? { ok: true, preTokens: 0, postTokens: 0 }; },
    async interrupt() { return await opts.interrupt?.(); },
    async getContextUsage() { return ((await opts.getContextUsage?.()) as any) ?? { totalTokens: 5, maxTokens: 100 }; },
    async usage() { return ((await opts.usage?.()) as any) ?? {}; },
    async mcpServerStatus() { return ((await opts.mcpServerStatus?.()) as any) ?? []; },
    async reconnectMcpServer(name) { await opts.reconnectMcpServer?.(name); },
    async toggleMcpServer(name, enabled) { await opts.toggleMcpServer?.(name, enabled); },
    async dispose() { fake.disposed++; await opts.dispose?.(); },
    onDecision(cb) { decisionCbs.add(cb); for (const e of [...pendingList]) cb(e); return () => { decisionCbs.delete(cb); }; },
    onDecisionSettled(cb) { settledCbs.add(cb); return () => { settledCbs.delete(cb); }; },
    async answerDecision(toolUseID, outcome) {
      answeredCalls.push({ toolUseID, decision: outcome });
      if (opts.answerDecision) return opts.answerDecision(toolUseID, outcome);
      fake.settlePermission(toolUseID, "me", outcome.kind);
      return { ok: true };
    },
    async listBgTasks() { return ((await opts.listBgTasks?.()) as any) ?? []; },
    async background() { return ((await opts.background?.()) as any) ?? false; },
    async stopBgTask(taskId) { await opts.stopBgTask?.(taskId); },
    onSessionEvent(cb) {
      if (!eventCb) { eventCb = cb; for (const ev of backlog.splice(0)) cb(ev); }
      else eventCb = cb;                      // single consumer: a re-subscribe replaces (useChat's session swap)
      return () => { if (eventCb === cb) eventCb = undefined; };
    },
    pushEvent(ev) { route(ev); },
    parkPermission(entry) { route({ kind: "decision", entry }); },
    settlePermission(toolUseID, by, decision) { route({ kind: "decision_settled", toolUseID, by, decision }); },
  };
  return fake;
}
