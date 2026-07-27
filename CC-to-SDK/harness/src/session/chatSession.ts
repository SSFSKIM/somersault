// harness/src/session/chatSession.ts — the REPL-facing session contract, promoted from the old tui
// package so the lib Session and the remote adapter satisfy ONE interface (spec A2b §2).
import type { CompactOutcome } from "../compaction/index.js";
import type { PermissionDecision } from "../permissions/types.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { HostEvent } from "../host/wire.js";

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

/** Permission surface a REMOTE session exposes: parked entries + settlement + answering. A local lib
 *  Session does not implement this (its broker seam predates it); consumers feature-test. */
export interface PermissionFeed {
  onPermission(cb: (entry: PendingEntry) => void): () => void;
  onPermissionSettled(cb: (s: { toolUseID: string; by: string; decision: string }) => void): () => void;
  answerPermission(toolUseID: string, decision: PermissionDecision): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }>;
}

/** The raw host event stream, replay-first. SINGLE-consumer: the first subscriber is flushed every
 *  event buffered since connect; later subscribers get live events only. */
export interface SessionEvents {
  onSessionEvent(cb: (ev: HostEvent) => void): () => void;
}

export function hasPermissionFeed(s: ChatSession): s is ChatSession & PermissionFeed {
  return typeof (s as Partial<PermissionFeed>).answerPermission === "function";
}
export function hasSessionEvents(s: ChatSession): s is ChatSession & SessionEvents {
  return typeof (s as Partial<SessionEvents>).onSessionEvent === "function";
}
