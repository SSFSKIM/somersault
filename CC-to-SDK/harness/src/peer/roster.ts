// src/peer/roster.ts — who is addressable on this machine, read from the ENGINE's own session registry.
// The rows are another program's file: this module projects what is present and omits what is absent,
// because a row that invents a default is a row that lies about a session we do not own.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir } from "../config/claudeHome.js";
import { isPidLive as realIsPidLive } from "../fleet/liveness.js";
import { keyFileName } from "./address.js";

export interface PeerRow {
  address: string;
  sessionId?: string;
  pid: number;
  entrypoint?: string; kind?: string; name?: string; cwd?: string;
  version?: string; peerProtocol?: number; peerFeatures?: string[];
  alive: boolean;
  inboxBound: boolean;
}

export interface RosterDeps {
  readDir(dir: string): string[];
  readFile(path: string): string;
  exists(path: string): boolean;
  isPidLive(pid: number, procStart?: string): Promise<boolean>;
}

const realDeps: RosterDeps = {
  readDir: (d) => readdirSync(d),
  readFile: (p) => readFileSync(p, "utf8"),
  exists: (p) => existsSync(p),
  isPidLive: (pid, procStart) => realIsPidLive(pid, procStart),
};

/** NEVER `~/.claude`: `CLAUDE_CONFIG_DIR` REPLACES that path outright, and this harness's own tenant
 *  preset exports it per tenant. Reading the literal home directory under a preset lists the wrong
 *  namespace's peers and omits the right ones. */
export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDir(env), "sessions");
}

export async function readPeerRows(env: NodeJS.ProcessEnv = process.env, deps: RosterDeps = realDeps): Promise<PeerRow[]> {
  const dir = sessionsDir(env);
  let names: string[];
  try { names = deps.readDir(dir); } catch { return []; }
  const out: PeerRow[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;   // key files and anything else are not rows
    let j: Record<string, unknown>;
    try { j = JSON.parse(deps.readFile(join(dir, name))) as Record<string, unknown>; } catch { continue; }
    const sock = j.messagingSocketPath;
    const pid = j.pid;
    if (typeof sock !== "string" || !sock || typeof pid !== "number") continue; // no address, no row
    const row: PeerRow = {
      address: `uds:${sock}`,
      pid,
      alive: await deps.isPidLive(pid, typeof j.procStart === "string" ? j.procStart : undefined),
      inboxBound: deps.exists(sock),
    };
    // Present-or-absent, one key at a time, rather than a spread of the whole object: the row carries
    // fields we do not model, and forwarding them wholesale would publish another program's internals
    // as if they were our contract.
    if (typeof j.sessionId === "string") row.sessionId = j.sessionId;
    if (typeof j.entrypoint === "string") row.entrypoint = j.entrypoint;
    if (typeof j.kind === "string") row.kind = j.kind;
    if (typeof j.name === "string") row.name = j.name;
    if (typeof j.cwd === "string") row.cwd = j.cwd;
    if (typeof j.version === "string") row.version = j.version;
    if (typeof j.peerProtocol === "number") row.peerProtocol = j.peerProtocol;
    if (Array.isArray(j.peerFeatures)) row.peerFeatures = j.peerFeatures.filter((f): f is string => typeof f === "string");
    out.push(row);
  }
  return out;
}

/** The auth token a sender prepends when writing to a peer's inbox. Read by SOCKET PATH — the key file is
 *  named for the hash of that path — and never printed or logged anywhere. */
export function peerTokenFor(socketPath: string, pid: number, env: NodeJS.ProcessEnv = process.env, deps: RosterDeps = realDeps): string | undefined {
  const dir = sessionsDir(env);
  try {
    const j = JSON.parse(deps.readFile(join(dir, keyFileName(pid, socketPath)))) as { peerToken?: unknown };
    return typeof j.peerToken === "string" ? j.peerToken : undefined;
  } catch { return undefined; }
}
