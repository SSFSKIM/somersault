import { listRoster } from "./roster.js";
import { readRegistry as realReadRegistry } from "./registry.js";
import { isPidLive as realIsPidLive, socketAnswers as realSocketAnswers } from "./liveness.js";
import { hostSocketPath } from "./paths.js";
import { projectRow } from "./project.js";
import type { AgentsRow } from "./project.js";
import type { HostStatus } from "../host/ops.js";
import { connect } from "node:net";

export * from "./paths.js"; export * from "./roster.js"; export * from "./registry.js";
export * from "./liveness.js"; export * from "./project.js";

async function realAskStatus(path: string): Promise<HostStatus | undefined> {
  return await new Promise((resolve) => {
    const s = connect({ path }, () => s.write(JSON.stringify({ op: "status" }) + "\n"));
    let buf = ""; const done = (v?: HostStatus) => { s.destroy(); resolve(v); };
    s.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { try { const j = JSON.parse(buf.slice(0, i)); done(j?.ok ? j : undefined); } catch { done(undefined); } } });
    s.on("error", () => done(undefined));
    s.setTimeout(250, () => done(undefined));
  });
}

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
  return await Promise.all(listRoster(env).map(async (roster) => {
    const reg = registry.find((r) => r.pid === roster.pid);
    const sock = hostSocketPath(roster.pid, env);
    // Prefer the engine's stamp, fall back to ours. Ours is the one that survives the engine
    // unlinking its row on exit — without it, a crashed host reads live forever.
    const pidLive = await deps.isPidLive(roster.pid, reg?.procStart ?? roster.procStart);
    const answers = pidLive ? await deps.socketAnswers(sock) : false;
    const liveStatus = answers ? await deps.askStatus(sock) : undefined;
    return projectRow({ roster, ...(reg ? { registry: reg } : {}), pidLive, socketAnswers: answers, ...(liveStatus ? { liveStatus } : {}) });
  }));
}
