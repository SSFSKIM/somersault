import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A row the ENGINE writes for itself at session start and unlinks on exit. We never write these —
 *  identity is steered via CLAUDE_CODE_SESSION_NAME / _KIND (probe 57). */
export interface RegistryRow {
  pid: number; sessionId?: string; cwd: string; name?: string; kind?: string;
  entrypoint?: string; procStart?: string; startedAt?: number; status?: string;
}

export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME ?? homedir(), ".claude", "sessions");
}

export function readRegistry(env: NodeJS.ProcessEnv = process.env): RegistryRow[] {
  let files: string[];
  try { files = readdirSync(sessionsDir(env)); } catch { return []; }
  const out: RegistryRow[] = [];
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const r = JSON.parse(readFileSync(join(sessionsDir(env), f), "utf8")) as RegistryRow;
      if (typeof r?.pid === "number") out.push(r);
    } catch { /* a corrupt row must not sink the listing */ }
  }
  return out;
}
