import { spawn as realSpawn } from "node:child_process";
import { mintShortId } from "../fleet/paths.js";
import { formatBanner } from "./banner.js";
import type { CcxInvocation } from "./args.js";

export interface SpawnDeps { spawn: typeof realSpawn | ((c: string, a: string[], o: any) => any); rand?: () => number }

/** A Claude Code agent's OWN session variables must not reach a detached child. Probe 60: a child that
 *  declares kind=bg while inheriting CLAUDE_JOB_DIR adopts the parent's job, and the agents view then
 *  renders the parent job's id, name and state instead of ours — the session becomes unfindable by
 *  pid, sessionId or name. doperpowers' daemon-spawn.sh runs inside an agent, so this is the real path. */
const INHERITED_SESSION_VARS = ["CLAUDE_JOB_DIR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION"];

/** Reconstructed, not forwarded raw: the parent has already resolved --worktree into config.cwd, and
 *  --bg itself must not repeat or the child would fork again. */
function configFlags(inv: CcxInvocation): string[] {
  const out: string[] = [];
  const c = inv.config as Record<string, string | undefined>;
  for (const [flag, key] of [["--model", "model"], ["--effort", "effort"], ["--resume", "resume"],
    ["--permission-mode", "permissionMode"], ["--settings", "settings"]] as const) {
    if (c[key]) out.push(flag, c[key]!);
  }
  return out;
}

/** Forks a fully detached host and returns immediately. The child re-enters this binary via --__host,
 *  which keeps one code path for the session regardless of how it was started. */
export function spawnDetached(inv: CcxInvocation, deps: SpawnDeps = { spawn: realSpawn }): { short: string; banner: string } {
  const short = mintShortId(deps.rand ?? Math.random);
  const name = inv.name ?? short;
  const kind = inv.bg ? "bg" : "interactive";
  const args = [process.argv[1], "--__host", short, "--__kind", kind, ...configFlags(inv), ...(inv.prompt ? [inv.prompt] : [])];
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_SESSION_NAME: name, CLAUDE_CODE_SESSION_KIND: kind };
  for (const v of INHERITED_SESSION_VARS) delete env[v];
  const child = deps.spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],   // nothing may hold the parent shell open
    cwd: inv.config.cwd ?? process.cwd(),
    env,
  });
  child.unref?.();
  return { short, banner: formatBanner(short) };
}
