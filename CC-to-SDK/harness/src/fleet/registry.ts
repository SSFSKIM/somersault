import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir } from "../config/claudeHome.js";

/** A row the ENGINE writes for itself at session start and unlinks on exit. We never write these —
 *  identity is steered via CLAUDE_CODE_SESSION_NAME / _KIND (probe 57). */
export interface RegistryRow {
  pid: number; sessionId?: string; cwd: string; name?: string; kind?: string;
  entrypoint?: string; procStart?: string; startedAt?: number; status?: string;
}

/** The registry follows CLAUDE_CONFIG_DIR (probe 61): a session spawned with a per-tenant config dir —
 *  which is exactly what tenantHarnessConfig does — writes its row to <CLAUDE_CONFIG_DIR>/sessions and
 *  NOT under HOME. Reading only HOME would hide every tenant-isolated session behind an empty list.
 *  The resolution itself is `claudeConfigDir`'s, shared with the config domain's user layer — two
 *  spellings of one rule is how the config domain came to ignore the variable for a whole milestone. */
export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDir(env), "sessions");
}

export function readRegistry(env: NodeJS.ProcessEnv = process.env): RegistryRow[] {
  const dir = sessionsDir(env);
  let files: string[];
  try { files = readdirSync(dir); } catch { return []; }
  const out: RegistryRow[] = [];
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as RegistryRow;
      // Guard the whole RegistryRow contract, not just `pid`'s type: a row typed valid but missing
      // `cwd` turns one malformed file into a fatal for the listing, and pid 0/-1/1.5 are meaningless
      // (0 and -1 are process-group wildcards in POSIX signal semantics).
      if (typeof r?.pid === "number" && Number.isInteger(r.pid) && r.pid > 0 && typeof r.cwd === "string") out.push(r);
    } catch { /* a corrupt row must not sink the listing */ }
  }
  return out;
}
