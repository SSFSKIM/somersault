import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, sep } from "node:path";
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

/** The name is a PATH the moment it leaves the parser, and nothing downstream re-checks it, so it has to
 *  be one segment. `--worktree ../..` joins straight back out of the layout to the repository root — which
 *  exists, so the reuse branch below used to hand back the SHARED checkout as an isolated one, with no git
 *  call and no error, while the banner and the roster row both claimed isolation. `--worktree ""` — what an
 *  unset shell variable expands to — collapses to the worktrees directory itself. Joining the name onto the
 *  base must therefore reproduce it verbatim; separators are rejected outright on top of that, because
 *  `a/b` survives the join yet lands off the fixed layout every consumer greps. */
function assertSegment(name: string, base: string): void {
  if (name && !name.includes("/") && !name.includes(sep) && join(base, name) === `${base}${sep}${name}`) return;
  throw new Error(`invalid worktree name ${JSON.stringify(name)}: expected a single path segment (not empty, ".", ".." or a path)`);
}

/** The absolute path the session will run in. Failure PROPAGATES: a worker spawned into a directory
 *  `git worktree add` did not create would silently run in whatever the cwd fell back to — which is the
 *  shared checkout the worktree existed to isolate it from. */
export async function ensureWorktree(repo: string, name: string, deps: WorktreeDeps = defaults): Promise<string> {
  const from = resolve(repo);
  assertSegment(name, join(from, ".claude", "worktrees"));   // before any git: the name is what decides the path
  // The root is GIT's top level, not the directory the command was invoked in. `--cwd <subdir>` used to put
  // the layout at `<subdir>/.claude/worktrees/<name>` — `git -C <subdir> worktree add` succeeds there — which
  // is not the path daemon-spawn.sh greps, and a later run from the real root then dies on the
  // `worktree-<name>` branch that subdirectory run already took.
  const root = (await deps.git(["-C", from, "rev-parse", "--show-toplevel"])).trim();
  const { path, branch } = worktreePaths(root, name);
  if (deps.exists(path)) {
    // An existing DIRECTORY is not an existing worktree: a re-clone, a pruned `.git/worktrees` or a
    // half-finished manual cleanup each leave the directory behind without its registration. Reusing one
    // runs the worker somewhere git does not track, and `ccx rm` can then never remove it — `git worktree
    // remove` fails and rmSession refuses (correctly) rather than deleting recursively.
    const listed = (await deps.git(["-C", root, "worktree", "list", "--porcelain"]))
      .split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length).trim());
    if (!listed.includes(path)) throw new Error(`${path} exists but is not a registered worktree of ${root} — delete it yourself once you know what it is, or pick another name`);
    return path;                                      // reuse: re-adding fails, and a resumed daemon must land here
  }
  await deps.git(["-C", root, "worktree", "add", "-b", branch, path]);
  return path;
}
