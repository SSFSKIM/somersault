// harness/src/session/chatSession.ts — the REPL-facing session contract, promoted from the old tui
// package so the lib Session and the remote adapter satisfy ONE interface (spec A2b §2).
import type { CompactOutcome } from "../compaction/index.js";
import type { DecisionOutcome, PermissionDecision } from "../permissions/types.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { HostEvent } from "../host/wire.js";
import type { BackgroundTaskInfo } from "./session.js";

/** The subset of a session the REPL drives (the lib Session satisfies this structurally). */
export interface ChatSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxTokens: number | null): Promise<void>;
  capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
  compact(): Promise<CompactOutcome>;
  interrupt(): Promise<unknown>;
  getContextUsage(): Promise<unknown>;
  usage(): Promise<unknown>;
  mcpServerStatus(): Promise<unknown[]>;
  reconnectMcpServer(name: string): Promise<void>;
  toggleMcpServer(name: string, enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
  readonly sessionId?: string;
}

/** Decision surface a REMOTE session exposes: parked entries (any kind) + settlement + answering. A
 *  local lib Session does not implement this (its broker seam predates it); consumers feature-test. */
export interface DecisionFeed {
  onDecision(cb: (entry: PendingDecision) => void): () => void;
  onDecisionSettled(cb: (s: { toolUseID: string; by: string; decision: string }) => void): () => void;
  answerDecision(toolUseID: string, outcome: DecisionOutcome): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }>;
}

/** Background-task surface (host path only — the lib Session exposes the SDK levers under other names). */
export interface BgTasks {
  listBgTasks(): Promise<BackgroundTaskInfo[]>;
  background(): Promise<boolean>;
  stopBgTask(taskId: string): Promise<void>;
}

/** The raw host event stream, replay-first. SINGLE-consumer: the first subscriber is flushed every
 *  event buffered since connect; later subscribers get live events only. */
export interface SessionEvents {
  onSessionEvent(cb: (ev: HostEvent) => void): () => void;
}

export function hasDecisionFeed(s: ChatSession): s is ChatSession & DecisionFeed {
  return typeof (s as Partial<DecisionFeed>).answerDecision === "function";
}
export function hasBgTasks(s: ChatSession): s is ChatSession & BgTasks {
  return typeof (s as Partial<BgTasks>).listBgTasks === "function";
}
export function hasSessionEvents(s: ChatSession): s is ChatSession & SessionEvents {
  return typeof (s as Partial<SessionEvents>).onSessionEvent === "function";
}

/** @deprecated Goal B renames this surface to DecisionFeed. Kept as its OWN interface (not a type
 *  alias onto DecisionFeed) — not-yet-migrated consumers (`useChat.ts`, `test/tui/helpers/fakeRemote.ts`,
 *  the integration tests) still call `onPermission`/`onPermissionSettled`/`answerPermission` and are NOT
 *  this task's files (plan-review C1c: T7 renames their call sites and deletes this + hasPermissionFeed
 *  in the same branch). Aliasing to DecisionFeed here would narrow `hasPermissionFeed`'s guard onto the
 *  new method names and break every one of those unmigrated call sites' typecheck today. */
export interface PermissionFeed {
  onPermission(cb: (entry: PendingDecision) => void): () => void;
  onPermissionSettled(cb: (s: { toolUseID: string; by: string; decision: string }) => void): () => void;
  answerPermission(toolUseID: string, decision: PermissionDecision): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }>;
}
/** @deprecated see PermissionFeed above — deleted alongside it in T7. */
export function hasPermissionFeed(s: ChatSession): s is ChatSession & PermissionFeed {
  return typeof (s as Partial<PermissionFeed>).answerPermission === "function";
}
