import type { PendingEntry } from "../permissions/pending.js";
import type { HostStatus } from "./ops.js";

/** Server-pushed frames. A reply is NOT one of these: replies keep A1's bare `{ok:…}` shape so a host
 *  started before this change stays readable by a client built after it. Only a connection that sent
 *  `follow` ever receives an event, so an A1 client cannot be confused by one. */
export type HostEvent =
  | { kind: "message"; data: unknown }                                      // one SDK message from the turn
  | { kind: "permission"; entry: PendingEntry }                             // a decision just parked
  | { kind: "permission_settled"; toolUseID: string; by: string; decision: string }
  | { kind: "state"; status: HostStatus }
  | { kind: "turn"; phase: "start" | "end"; error?: string; truncated?: boolean };

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
