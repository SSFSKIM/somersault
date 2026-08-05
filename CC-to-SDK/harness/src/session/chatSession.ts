// harness/src/session/chatSession.ts — the REPL-facing session contract, promoted from the old tui
// package so the lib Session and the remote adapter satisfy ONE interface (spec A2b §2).
import type { CompactOutcome } from "../compaction/index.js";
import type { DecisionOutcome } from "../permissions/types.js";
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
  /** The engine half of /clear (live-feedback fix, 2026-08-06): swap to a FRESH conversation so the
   *  context is actually freed — the UI wipe alone was a lie. Optional: a pre-upgrade host has no
   *  `clear` op, and the REPL degrades to the old screen-only clear with a notice. */
  clearSession?(): Promise<void>;
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

/** Esc-Esc rewind surface (host path only, like DecisionFeed). Two anchors per row (probe 68c):
 *  `uuid` (the selected prompt) drives rewindFiles; `prevUuid` (the nearest preceding REAL row)
 *  drives resumeSessionAt, because resumeSessionAt KEEPS its anchor and drops only what follows.
 *  prevUuid null = first prompt (or first-after-compact) → code-only restore. */
export type RewindScope = "both" | "conversation" | "code";
/** `timestamp` is the persisted row's own ISO string (every `type:"user"` row on disk carries one), carried
 *  so the F6 T10 confirmation panel can print upstream's `(<relative time>)` under the message it is about to
 *  restore to (`RZ(new Date(D.timestamp))`, bundle L487190). Optional because it is a display nicety, not a
 *  rewind input: a row without one simply loses that line. */
export interface RewindAnchor { uuid: string; prevUuid: string | null; text: string; index: number; timestamp?: string }
export interface RewindDryRun { canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string }
export interface RewindOps {
  rewindAnchors(): Promise<RewindAnchor[]>;
  rewindDryRun(uuid: string): Promise<RewindDryRun>;
  rewind(anchor: RewindAnchor, scope: RewindScope): Promise<void>;
}

/** Settings/dirs surface (host path only — W3 T1's flag-state accumulator). Mirrors `HostHandlers`'
 *  getSettings/listDirs/addDir/removeDir/setOutputStyle/addRule/removeRule exactly; the in-process lib
 *  Session does not implement this (its config is fixed at construction, like DecisionFeed's broker seam
 *  predating it) — consumers feature-test with `hasSettingsOps`. */
export interface SettingsOps {
  getSettings(): Promise<unknown>;
  listDirs(): Promise<{ path: string; source: "cwd" | "launch" | "session" }[]>;
  addDir(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  setOutputStyle(style: string): Promise<void>;
  addRule(behavior: "allow" | "ask" | "deny", rule: string): Promise<void>;
  removeRule(behavior: "allow" | "ask" | "deny", rule: string): Promise<void>;
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
export function hasRewind(s: ChatSession): s is ChatSession & RewindOps {
  return typeof (s as Partial<RewindOps>).rewind === "function" && typeof (s as Partial<RewindOps>).rewindAnchors === "function";
}
export function hasSettingsOps(s: ChatSession): s is ChatSession & SettingsOps {
  return typeof (s as Partial<SettingsOps>).getSettings === "function" && typeof (s as Partial<SettingsOps>).addDir === "function";
}
