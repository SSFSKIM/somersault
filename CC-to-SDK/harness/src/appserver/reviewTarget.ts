// appserver/reviewTarget.ts — the ONE piece of host-side git a review needs.
//
// Only `baseBranch` needs it, and it needs it for a reason the prompt cannot cover: "changes relative to
// main" means the merge-base range, not a diff against main's TIP, and a model asked to work that out
// itself gets it wrong in exactly the case that matters (a base branch that has moved on). Codex resolves
// the same thing with its own merge-base subprocess (git-utils/src/branch.rs:15-48).
//
// IT DEGRADES, IT DOES NOT FAIL. An unresolvable base (a branch that does not exist, a detached HEAD, a
// directory that is not a repository) still yields a runnable review — the prompt falls back to naming the
// branch and the reason rides along as a note. Refusing the whole request would trade a slightly vaguer
// review for no review at all.
import { execFile } from "node:child_process";
import type { ReviewTarget } from "./schema/review.js";

export type GitFn = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const defaultGit: GitFn = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 10_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
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
    return { note: `could not resolve a merge-base with ${target.branch}: ${(r.stderr || "unknown error").trim()}` };
  }
  return { range: `${base}..HEAD` };
}
