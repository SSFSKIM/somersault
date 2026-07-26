import { TERMINAL } from "./roster.js";
import type { FleetState, RosterRow } from "./roster.js";

/** The row shape doperpowers' _poll_until_done parses: id (short), sessionId, state, status, cwd. */
export interface AgentsRow {
  id: string; sessionId: string; state: FleetState; status: "busy" | "idle";
  cwd: string; name: string;
  unresponsive?: boolean;   // live pid, silent socket — a hung host, not a failed one
}

export interface ProjectInput {
  roster: RosterRow;
  pidLive: boolean;
  socketAnswers: boolean;
  liveStatus?: { state: FleetState; status: "busy" | "idle" };
}

/** State is DERIVED at read time — we never rewrite the roster from a read command. Four arms:
 *   terminal                      → as-is
 *   live pid + socket answers     → the host's live status
 *   live pid + socket silent      → roster state, flagged unresponsive (a live process is not a failure)
 *   dead pid                      → error (or the poller waits forever on a SIGKILLed host) */
export function projectRow(input: ProjectInput): AgentsRow {
  const { roster, pidLive, socketAnswers, liveStatus } = input;
  const base = { id: roster.short, cwd: roster.cwd, name: roster.name };

  // Identity comes from the session's OWN row, live or finished, and there is deliberately no second
  // source. The engine's registry files its rows by the pid of the CLI subprocess it spawns — not the
  // host's — so any row that did match our pid would belong to a DIFFERENT process, and taking its
  // sessionId would hand the consumer a stranger's session to resume, reply to, or delete.
  if (TERMINAL.has(roster.state)) return { ...base, sessionId: roster.sessionId ?? "", state: roster.state, status: "idle" };
  const sessionId = roster.sessionId ?? "";
  if (pidLive && socketAnswers && liveStatus) return { ...base, sessionId, state: liveStatus.state, status: liveStatus.status };
  if (pidLive && socketAnswers) return { ...base, sessionId, state: roster.state, status: "busy" };
  if (pidLive) return { ...base, sessionId, state: roster.state, status: "busy", unresponsive: true };
  return { ...base, sessionId, state: "error", status: "idle" };
}
