import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
const execFileP = promisify(execFile);

/** Fixed layout, not configurable: daemon-spawn.sh already assumes exactly these paths (it prints
 *  `worktree=<cwd> (branch worktree-<name>)` from them). `repo` is RESOLVED first — main composes it
 *  from `--cwd` as typed, and a relative worktree path is one rmSession refuses to act on, so a row
 *  written from one could never be removed. */
export function worktreePaths(repo: string, name: string): { path: string; branch: string } {
  return { path: join(resolve(repo), ".claude", "worktrees", name), branch: `worktree-${name}` };
}

export interface WorktreeDeps { exists: (p: string) => boolean; git: (args: string[]) => Promise<string> }
const defaults: WorktreeDeps = {
  exists: existsSync,
  git: async (args) => (await execFileP("git", args, { timeout: 30000 })).stdout,
};

/** The absolute path the session will run in. Failure PROPAGATES: a worker spawned into a directory
 *  `git worktree add` did not create would silently run in whatever the cwd fell back to — which is the
 *  shared checkout the worktree existed to isolate it from. */
export async function ensureWorktree(repo: string, name: string, deps: WorktreeDeps = defaults): Promise<string> {
  const root = resolve(repo);
  const { path, branch } = worktreePaths(root, name);
  if (deps.exists(path)) return path;                 // reuse: re-adding fails, and a resumed daemon must land here
  await deps.git(["-C", root, "worktree", "add", "-b", branch, path]);
  return path;
}
