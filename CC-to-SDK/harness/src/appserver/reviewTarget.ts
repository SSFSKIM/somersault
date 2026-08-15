// appserver/reviewTarget.ts — the ONE piece of host-side git a review needs.
//
// Only `baseBranch` needs it, and it needs it for a reason the prompt cannot cover: "changes relative to
// main" means the merge-base range, not a diff against main's TIP, and a model asked to work that out
// itself gets it wrong in exactly the case that matters (a base branch that has moved on). Codex resolves
// the same thing with its own merge-base subprocess (git-utils/src/branch.rs:15-48).
//
// IT DEGRADES, IT DOES NOT FAIL. An unresolvable base — a ref that does not exist, an unborn branch, a
// directory that is not a repository, two histories with no common ancestor — still yields a runnable review:
// the prompt falls back to naming the branch and the reason rides along as a note. (A detached HEAD is NOT one
// of these: `git merge-base --end-of-options main HEAD` exits 0 there.) Nothing here throws, including before
// the spawn. Refusing the whole request would trade a slightly vaguer review for no review at all.
import { execFile } from "node:child_process";
import type { ReviewTarget } from "./schema/review.js";

export type GitFn = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const defaultGit: GitFn = (args, cwd) =>
  new Promise((resolve) => {
    // The try is the CONTRACT, not defensiveness: node validates argv BEFORE it spawns, so a client-supplied
    // branch carrying a NUL byte throws ERR_INVALID_ARG_VALUE synchronously right here, and an exception out of
    // this executor would escape the caller as a failure. Any pre-spawn rejection becomes a non-zero exit, like
    // every other way git can decline — which is the one shape the degrade path below knows how to read.
    try {
      execFile("git", args, { cwd, timeout: 10_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
        // `code` is a NUMBER on a real exit, the STRING "ENOENT" when the spawn itself fails, and null when the
        // timeout kills git — anything non-numeric collapses to 1, so `GitFn`'s declared `code: number` is true.
        const c = err && (err as NodeJS.ErrnoException & { code?: number | string }).code;
        resolve({ code: err ? (typeof c === "number" ? c : 1) : 0, stdout, stderr });
      });
    } catch (e) { resolve({ code: 1, stdout: "", stderr: String(e) }); }
  });

export async function resolveReviewRange(
  target: ReviewTarget,
  cwd: string,
  deps: { git?: GitFn } = {},
): Promise<{ range?: string; note?: string }> {
  if (target.type !== "baseBranch") return {};
  const git = deps.git ?? defaultGit;
  // `--end-of-options` because `branch` arrives from a CLIENT and this is the boundary where it stops being
  // a string and starts being an argument. `execFile` already rules out a shell, but it does not stop git
  // from reading a dash-leading value as one of its OWN flags: measured on git 2.55, `git merge-base
  // --all-the-things HEAD` answers "unknown option", while with the guard the identical value answers "Not
  // a valid object name" — a ref that does not exist, which is exactly the degrade path below.
  const r = await git(["merge-base", "--end-of-options", target.branch, "HEAD"], cwd);
  const base = r.stdout.trim();
  if (r.code !== 0 || !base) {
    // UNRELATED HISTORIES are the one failure git reports mutely: exit 1 with empty stdout AND empty stderr. It
    // is also the one with a crisp explanation, so name it instead of letting it read as "unknown error".
    const why = r.stderr.trim() || (r.code === 1 ? "no common ancestor" : "unknown error");
    return { note: `could not resolve a merge-base with ${target.branch}: ${why}` };
  }
  return { range: `${base}..HEAD` };
}
