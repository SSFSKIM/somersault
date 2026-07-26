import { listRoster } from "./roster.js";
import { isPidLive as realIsPidLive, socketAnswers as realSocketAnswers } from "./liveness.js";
import { hostSocketPath } from "./paths.js";
import { projectRow } from "./project.js";
import type { AgentsRow } from "./project.js";
import type { HostStatus } from "../host/ops.js";
import { askStatus as realAskStatus } from "./status.js";

export * from "./paths.js"; export * from "./roster.js"; export * from "./registry.js";
export * from "./liveness.js"; export * from "./project.js"; export * from "./status.js";

export interface FleetDeps {
  isPidLive: (pid: number, procStart?: string) => Promise<boolean>;
  socketAnswers: (p: string) => Promise<boolean>;
  askStatus: (p: string) => Promise<HostStatus | undefined>;
}

/** Read-only, and sourced from OUR roster alone. The engine's registry (readRegistry, still exported —
 *  it documents the format) is deliberately not consulted: it files `<pid>.json` under the pid of the
 *  CLI subprocess the SDK spawns, never the host's own, so joining on `r.pid === roster.pid` matched
 *  nothing on the happy path and could only ever pair a row with a STRANGER that happened to land on
 *  that pid. Identity now comes from the host itself, which stamps its sessionId onto its row as soon
 *  as the engine reports one. Nothing here writes or unlinks — `ccx fleet gc` owns that. */
export async function collectFleet(env: NodeJS.ProcessEnv = process.env,
  deps: FleetDeps = { isPidLive: realIsPidLive, socketAnswers: realSocketAnswers, askStatus: realAskStatus }): Promise<AgentsRow[]> {
  const rows = listRoster(env);
  const settled = await Promise.allSettled(rows.map(async (roster) => {
    const sock = hostSocketPath(roster.pid, env);
    const pidLive = await deps.isPidLive(roster.pid, roster.procStart);
    const answers = pidLive ? await deps.socketAnswers(sock) : false;
    const liveStatus = answers ? await deps.askStatus(sock) : undefined;
    return projectRow({ roster, pidLive, socketAnswers: answers, ...(liveStatus ? { liveStatus } : {}) });
  }));
  // Per row, not per listing: one host that throws mid-probe must cost its own row and nothing else.
  // Under Promise.all it took down the whole command — including the rows that already said `done`,
  // which is the terminal blindness this listing exists to prevent.
  return settled.map((s, i) => s.status === "fulfilled" ? s.value
    : projectRow({ roster: rows[i], pidLive: false, socketAnswers: false }));
}
