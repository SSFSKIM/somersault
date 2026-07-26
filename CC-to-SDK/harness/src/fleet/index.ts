import { listRoster } from "./roster.js";
import { readRegistry as realReadRegistry } from "./registry.js";
import { isPidLive as realIsPidLive, socketAnswers as realSocketAnswers } from "./liveness.js";
import { hostSocketPath } from "./paths.js";
import { projectRow } from "./project.js";
import type { AgentsRow } from "./project.js";
import type { HostStatus } from "../host/ops.js";
import { askStatus as realAskStatus } from "./status.js";

export * from "./paths.js"; export * from "./roster.js"; export * from "./registry.js";
export * from "./liveness.js"; export * from "./project.js"; export * from "./status.js";

export interface FleetDeps {
  readRegistry: typeof realReadRegistry;
  isPidLive: (pid: number, procStart?: string) => Promise<boolean>;
  socketAnswers: (p: string) => Promise<boolean>;
  askStatus: (p: string) => Promise<HostStatus | undefined>;
}

/** Read-only. Rows are projected at read time; nothing here writes or unlinks — `ccx fleet gc` owns that. */
export async function collectFleet(env: NodeJS.ProcessEnv = process.env,
  deps: FleetDeps = { readRegistry: realReadRegistry, isPidLive: realIsPidLive, socketAnswers: realSocketAnswers, askStatus: realAskStatus }): Promise<AgentsRow[]> {
  const registry = deps.readRegistry(env);
  const rows = listRoster(env);
  const settled = await Promise.allSettled(rows.map(async (roster) => {
    // Registry rows are keyed by pid and pids are RECYCLED, while a roster row outlives the registry
    // row it was paired with — so `find(r => r.pid === ...)` can hand us a stranger's row. Prefer OUR
    // stamp: it is the one immune to recycling, and a corpse's stored stamp cannot match the stranger's
    // (which `ps` would happily confirm), so liveness answers "dead" and we never touch the socket.
    const reg = registry.find((r) => r.pid === roster.pid);
    const sock = hostSocketPath(roster.pid, env);
    const pidLive = await deps.isPidLive(roster.pid, roster.procStart ?? reg?.procStart);
    const answers = pidLive ? await deps.socketAnswers(sock) : false;
    const liveStatus = answers ? await deps.askStatus(sock) : undefined;
    return projectRow({ roster, ...(reg ? { registry: reg } : {}), pidLive, socketAnswers: answers, ...(liveStatus ? { liveStatus } : {}) });
  }));
  // Per row, not per listing: one host that throws mid-probe must cost its own row and nothing else.
  // Under Promise.all it took down the whole command — including the rows that already said `done`,
  // which is the terminal blindness this listing exists to prevent.
  return settled.map((s, i) => s.status === "fulfilled" ? s.value
    : projectRow({ roster: rows[i], pidLive: false, socketAnswers: false }));
}
