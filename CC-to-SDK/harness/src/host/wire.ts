import type { PendingDecision } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import type { TurnFailure } from "../session/turnResult.js";
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
  // `decision` (the bare outcome KIND) stays exactly where it was — a client built before M3 reads it and
  // nothing else. `answer` (§1a-e) is the same outcome object the `answer` op carried, and it is what a
  // client that did not win the race needs to reconstruct the settlement: the kind string alone drops
  // `deny.feedback`, `question_answer.answers`, `plan_approve.mode`, every payload the three decision
  // families carry. Optional because a pre-M3 host emits none, and because the wire must stay additive.
  | { kind: "decision_settled"; toolUseID: string; by: string; decision: string; answer?: DecisionOutcome }
  | { kind: "tasks_changed"; tasks: BackgroundTaskInfo[] }                   // REPLACE snapshot (Task 4 emits)
  | { kind: "task"; data: unknown }                                         // raw task lifecycle frame (Task 4 emits)
  | { kind: "state"; status: HostStatus }
  // A conversation rewind replaced the engine: the persisted transcript is now TRUNCATED, so every
  // follower (not just whoever confirmed it) must rebuild from disk. A generic `state` event is not
  // enough — its handler only syncs permissionMode, so other attached clients would keep rendering the
  // pre-rewind transcript, and /copy would keep offering text the host no longer knows about, while
  // their next prompt runs against the truncated conversation.
  // `prevUuid` is the uuid the host handed `resumeSessionAt` — the last row the restored conversation
  // keeps. A follower needs it to cut its own rebuild at the same place the confirming client does
  // (EP-S1); without it a second attached client renders the pre-rewind chain. Optional because a host
  // built before this field existed emits none, and the client's fallback is "show the rows unchanged".
  // `cleared` is the OTHER outcome, and it must be a POSITIVE signal rather than the absence of a prevUuid
  // (W-S8): a restore to the session's FIRST message swaps to a fresh, empty conversation on a NEW session
  // id, and a follower whose cached id has not flipped yet would read the OLD file — still holding every
  // discarded turn — and, with no anchor to cut at, render all of it back. It never travels with `prevUuid`.
  | { kind: "rewound"; sessionId?: string; prevUuid?: string; cleared?: true }
  // `result` (§1a-f) is the turn's own result, and turn-end is the ONLY frame that can carry it: Session's
  // read loop resolves a `result` frame into the submit waiter and never hands it to `onMessage`
  // (session.ts:313-325), which is the sole feed the `message` events above ride — P106 measured 88 message
  // frames on a following client and zero carrying one. Optional because a pre-M3 host emits none, because a
  // turn can legitimately end without one (an errored result subtype carries no text), and because it never
  // travels with `error`: a turn that threw produced no result to send.
  // `failure` (§1a-f) is the SOFT tag of a turn that RESOLVED reporting failure — a terminal `is_error`
  // result resolves the submit waiter carrying `TurnFailure` (session.ts:32) rather than throwing, so
  // `error?: string` (thrown turns, and ONLY thrown turns) can never describe it. The three fields'
  // pairings are the contract: `error` travels with neither of the other two, while `result` and
  // `failure` CAN travel together — a failed outcome still has a result value. Optional for the same
  // reason as `result`: a pre-M3 host emits none, and a healthy turn has no tag to send.
  | { kind: "turn"; phase: "start" | "end"; seq?: number; result?: unknown; failure?: TurnFailure; error?: string; truncated?: boolean };

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
