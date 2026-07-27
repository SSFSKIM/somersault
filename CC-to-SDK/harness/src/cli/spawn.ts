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

/** Reconstructed, not forwarded raw: --worktree is a NAME the parent has already resolved (it travels
 *  as the --__worktree marker below, a path), and --bg itself must not repeat or the child would fork
 *  again. */
function configFlags(inv: CcxInvocation): string[] {
  const out: string[] = [];
  const c = inv.config as Record<string, string | undefined>;
  for (const [flag, key] of [["--model", "model"], ["--effort", "effort"], ["--resume", "resume"],
    ["--permission-mode", "permissionMode"]] as const) {
    if (c[key]) out.push(flag, c[key]!);
  }
  // --settings is the one flag parseCcx hands back as an OBJECT (it accepts inline JSON *or* a file path
  // and reads the file). Pushed raw it becomes the argv token "[object Object]" and the child's re-parse
  // throws — a gateway daemon dead at startup, invisibly, because the parent already printed its banner.
  // Stringified it round-trips through the parser's inline-JSON branch, file already resolved.
  if (inv.config.settings) out.push("--settings", JSON.stringify(inv.config.settings));
  // Seconds, the human CLI unit — the child's own parseCcx arm re-validates it and hostOptsFrom converts
  // to ms. Forwarded unconditionally when set: a --detachable spawn is the ONLY caller that combines
  // --idle-timeout with a fork, and the child's re-parse has no --detachable of its own to gate on.
  if (inv.idleTimeoutSec) out.push("--idle-timeout", String(inv.idleTimeoutSec));
  return out;
}

/** Forks a fully detached host and returns immediately. The child re-enters this binary via --__host,
 *  which keeps one code path for the session regardless of how it was started. */
export function spawnDetached(inv: CcxInvocation, deps: SpawnDeps = { spawn: realSpawn }): { short: string; banner: string } {
  const short = mintShortId(deps.rand ?? Math.random);
  const name = inv.name ?? short;
  const kind = inv.bg ? "bg" : "interactive";
  // execArgv FIRST: under a `tsx` dev run process.argv[1] is a .ts file whose loader lives only in the
  // parent's execArgv, and bare node does not remap this repo's mandated `./x.js` specifiers back to .ts —
  // the child dies at its first relative import (ERR_MODULE_NOT_FOUND) before it can write a roster row.
  // For a packaged `node dist/…` invocation execArgv is empty, so this is a no-op in production.
  // The resolved worktree rides with the markers, not as a --worktree flag: only the CHILD writes the
  // roster row, and `worktree` is the single field `ccx rm` acts on — a path that stops here leaves rm
  // with nothing to clean up. A flag would also re-enter the parser's NAME domain in the child.
  const args = [...process.execArgv, process.argv[1], "--__host", short, "--__kind", kind,
    ...(inv.worktreePath ? ["--__worktree", inv.worktreePath] : []),
    ...configFlags(inv), ...(inv.prompt ? [inv.prompt] : [])];
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_SESSION_NAME: name, CLAUDE_CODE_SESSION_KIND: kind };
  for (const v of INHERITED_SESSION_VARS) delete env[v];
  const child = deps.spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],   // nothing may hold the parent shell open
    cwd: inv.config.cwd ?? process.cwd(),    // the resolved worktree; without it parallel daemons share one checkout
    env,
  });
  // The ignored stdio is deliberate and stays, so a failed exec has no other channel back: with no
  // listener Node THROWS the unhandled 'error' event and the parent dies with a stack trace on top of a
  // banner that already claimed success. Say it in our own words instead, naming the short id the
  // consumer is about to poll for.
  child.on("error", (e: Error) => console.error(`ccx: could not spawn detached host ${short}: ${e.message}`));
  child.unref();
  return { short, banner: formatBanner(short) };
}
