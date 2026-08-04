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
  // `replay` marks a frame the follow() drain handed a LATE joiner out of the turn buffer rather than one
  // that just arrived. It is history, not news: a client may render it, but must not stamp it with an
  // arrival clock (F3 final review — `ccx attach` mid-turn was deriving a ~0s Agent duration from
  // dispatch/result stamps taken microseconds apart at attach time). Absent on every live frame.
  | { kind: "message"; data: unknown; replay?: true }                        // one SDK message from the turn

  | { kind: "decision"; entry: PendingDecision }                            // a decision just parked (any kind)
  | { kind: "decision_settled"; toolUseID: string; by: string; decision: string }
  | { kind: "tasks_changed"; tasks: BackgroundTaskInfo[] }                   // REPLACE snapshot (Task 4 emits)
  | { kind: "task"; data: unknown }                                         // raw task lifecycle frame (Task 4 emits)
  | { kind: "state"; status: HostStatus }
  // A conversation rewind replaced the engine: the persisted transcript is now TRUNCATED, so every
  // follower (not just whoever confirmed it) must rebuild from disk. A generic `state` event is not
  // enough — its handler only syncs permissionMode, so other attached clients would keep rendering the
  // pre-rewind transcript, and /copy would keep offering text the host no longer knows about, while
  // their next prompt runs against the truncated conversation.
  | { kind: "rewound"; sessionId?: string }
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
