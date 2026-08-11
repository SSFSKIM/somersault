// tui/src/worktrees.ts — "does this project have more than one git worktree?", the gate upstream puts on the
// `/resume` picker's Ctrl+W control (`R` at L476627, computed as `D(it.length > 1)` over the enumeration).
//
// The argv is upstream's verbatim (L35980-35984): hooks and fsmonitor are disabled for the call, so a repo
// with a slow or hostile `core.fsmonitor` cannot stall the picker, and a 5s timeout caps it regardless.
// Failure of any kind — not a repo, no git on PATH, a timeout — is FALSE, not a throw: upstream reports
// `success: false` and simply hides the control, and a picker that cannot open because git is unhappy would
// be a worse answer than a picker with one fewer chord.
import { execFile } from "node:child_process";

export const WORKTREE_ARGV = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=", "worktree", "list", "--porcelain"] as const;
export const WORKTREE_TIMEOUT_MS = 5000;

/** Injected so tests never spawn a process (and so the caller could route through its own git seam later). */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;

const runGit: GitRunner = (args, cwd) => new Promise((resolve, reject) => {
  execFile("git", [...args], { cwd, timeout: WORKTREE_TIMEOUT_MS, windowsHide: true }, (err, stdout) => err ? reject(err) : resolve(stdout));
});

/** `--porcelain` opens every record with a `worktree <path>` line and nothing else does, so the record count
 *  is that line count — a branch NAMED `worktree-x` sits on a `branch ` line and cannot be miscounted. */
export const countWorktrees = (porcelain: string): number =>
  porcelain.split("\n").filter((l) => l.startsWith("worktree ")).length;

export async function hasWorktrees(cwd: string, run: GitRunner = runGit): Promise<boolean> {
  try { return countWorktrees(await run(WORKTREE_ARGV, cwd)) > 1; } catch { return false; }
}
