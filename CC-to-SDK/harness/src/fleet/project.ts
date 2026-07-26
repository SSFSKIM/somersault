import { TERMINAL } from "./roster.js";
import type { FleetState, RosterRow } from "./roster.js";
import type { RegistryRow } from "./registry.js";

/** The row shape doperpowers' _poll_until_done parses: id (short), sessionId, state, status, cwd. */
export interface AgentsRow {
  id: string; sessionId: string; state: FleetState; status: "busy" | "idle";
  cwd: string; name: string;
  unresponsive?: boolean;   // live pid, silent socket — a hung host, not a failed one
  noHumanSeam?: boolean;    // a bare --bg with no permission config: nothing can ever route to `ask`
}

export interface ProjectInput {
  roster: RosterRow;
  registry?: RegistryRow;
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
  const { roster, registry, pidLive, socketAnswers, liveStatus } = input;
  const base = { id: roster.short, cwd: roster.cwd, name: roster.name,
    ...(roster.noHumanSeam ? { noHumanSeam: true } : {}) };

  // A finished session's identity comes from its OWN row. The engine unlinks its registry row on exit
  // and files those rows by pid, so a registry row still matching a dead session's pid belongs to a
  // DIFFERENT process — taking its sessionId would hand the consumer a stranger's session to act on.
  if (TERMINAL.has(roster.state)) return { ...base, sessionId: roster.sessionId ?? "", state: roster.state, status: "idle" };
  const sessionId = registry?.sessionId ?? roster.sessionId ?? "";
  if (pidLive && socketAnswers && liveStatus) return { ...base, sessionId, state: liveStatus.state, status: liveStatus.status };
  if (pidLive && socketAnswers) return { ...base, sessionId, state: roster.state, status: "busy" };
  if (pidLive) return { ...base, sessionId, state: roster.state, status: "busy", unresponsive: true };
  return { ...base, sessionId, state: "error", status: "idle" };
}
