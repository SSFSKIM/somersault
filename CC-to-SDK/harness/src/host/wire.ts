import type { PendingDecision } from "../permissions/pending.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import type { HostStatus } from "./ops.js";

/** Server-pushed frames. A reply is NOT one of these: replies keep A1's bare `{ok:…}` shape so a host
 *  started before this change stays readable by a client built after it. Only a connection that sent
 *  `follow` ever receives an event, so an A1 client cannot be confused by one.
 *
 *  GB T3: `permission`/`permission_settled` are RENAMED to `decision`/`decision_settled` host-side (they
 *  now cover all three decision kinds, not just the 3-way permission) — the old names are gone from this
 *  union entirely. A pre-Goal-B host's frames still arrive shaped that way over the wire; reading them is
 *  the CLIENT's job (chatAdapter.ts's route() read-alias), not this type's. */
export type HostEvent =
  | { kind: "message"; data: unknown }                                      // one SDK message from the turn
  | { kind: "decision"; entry: PendingDecision }                            // a decision just parked (any kind)
  | { kind: "decision_settled"; toolUseID: string; by: string; decision: string }
  | { kind: "tasks_changed"; tasks: BackgroundTaskInfo[] }                   // REPLACE snapshot (Task 4 emits)
  | { kind: "task"; data: unknown }                                         // raw task lifecycle frame (Task 4 emits)
  | { kind: "state"; status: HostStatus }
  | { kind: "turn"; phase: "start" | "end"; seq?: number; error?: string; truncated?: boolean };

export type HostFrame = ({ t: "event" } & HostEvent) | ({ t?: undefined } & Record<string, unknown>);

export function encodeReply(id: number | undefined, body: Record<string, unknown>): string {
  return JSON.stringify(id === undefined ? body : { ...body, id }) + "\n";
}

export function encodeEvent(ev: HostEvent): string { return JSON.stringify({ t: "event", ...ev }) + "\n"; }

/** Parse one line. Returns undefined for anything that is not a JSON object — a peer writing junk is a
 *  peer to ignore, not a reason to throw inside a detached host nobody is watching. */
export function decodeFrame(line: string): HostFrame | undefined {
  let v: unknown;
  try { v = JSON.parse(line); } catch { return undefined; }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  return v as HostFrame;
}
