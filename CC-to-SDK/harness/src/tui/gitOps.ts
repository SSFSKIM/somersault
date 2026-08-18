// tui/src/gitOps.ts — TS Task 4: a port of canon 2.1.234's git-operation recognizer `vFr` (194436–194473), the
// thing that turns a folded shell run's "ran 3 shell commands" into "committed abc123f, pushed to main". It is a
// PURE (command, output) → ops function with no clock, no I/O and no notion of a run; `toolFold.ts` owns the
// bookkeeping (which results get scraped, and the `gitOpBashCount` tally that keeps a git call from being spoken
// twice). Lives outside `toolFold.ts` because it is a self-contained table of a dozen regexes with its own
// vocabulary — see harness/CLAUDE.md's "prefer a new module over growing a hot file".
//
// Two properties of canon that look like oversights and are NOT:
//   * NO exit code is ever consulted (§B.3 of the T1 addendum). Success is inferred purely from the SHAPE of the
//     output — `[branch sha]`, `… -> ref`, "Fast-forward", "Successfully rebased", a PR url. The neighbouring
//     telemetry path does check `exitCode === 0` (194357); this one deliberately does not, so a shell call that
//     exited non-zero after a successful commit still reports the commit.
//   * the command patterns match ANYWHERE in the string, so `echo "git push" && ls` is a *candidate* whose
//     output simply fails the result predicate. Recognition is (command shape AND output shape), never one alone.
//
// One DELIBERATE DEPARTURE from canon, recorded in spec §3.1: canon tests `/--amend\b/` against the RAW command
// (194441) while `Pya` tests its own flags against the quote-stripped one (194294) — so canon reads
// `git commit -m "revert the --amend"` as an amend. We strip quotes for BOTH.

/** `SFr` (194291–194293): `git`, optionally followed by any run of `-c k=v` / `-C dir` / `--opt=val` prefixes,
 *  then the subcommand on a word boundary. `tail` is appended after that boundary (only `merge` uses it). */
const gitSub = (sub: string, tail = ""): RegExp => new RegExp(`\\bgit(?:\\s+-[cC]\\s+\\S+|\\s+--\\S+=\\S+)*\\s+${sub}\\b${tail}`);
/** The constants at 194645–194650, each under its canon name in the comment. */
const RE_COMMIT = gitSub("commit");                               // Upp
const RE_PUSH = gitSub("push");                                   // TLn
const RE_DRY_RUN = /(?:^|\s)(?:-n|--dry-run)(?=\s|$)/;            // xya
const RE_CHERRY_PICK = gitSub("cherry-pick");                     // J5b
const RE_MERGE = gitSub("merge", "(?!-)");                        // X5b — `(?!-)` is what excludes `git merge-base`
const RE_REBASE = gitSub("rebase");                               // Z5b
const RE_QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g;                   // eQo — the quote-stripper
const RE_PR_URL = /https?:\/\/[^/\s"]+\/([^\s"]+?)\/(?:pull|pull-requests|-\/merge_requests)\/(\d+)/;   // tQo
const RE_COMMIT_LINE = /^\[(?:([\w./-]+)|detached HEAD)(?: \(root-commit\))? ([0-9a-f]{4,})\]/m;        // l6b
const RE_PUSH_REF = /^\s*[+\-*!= ]?\s*(?:\[new branch\]|[0-9a-f]+\.\.+[0-9a-f]+)\s+\S+\s*->\s*(\S+)/m;  // Gpp
const RE_PR_FALLBACK = /[Pp]ull request (?:(\S+)#)?#?(\d{1,9})\b/;                                      // inside Vpp (194419)

export type GitCommitKind = "committed" | "amended" | "cherry-picked";
export type GitPrAction = "created" | "edited" | "merged" | "commented" | "closed" | "reopened" | "ready" | "draft" | "auto-merge-enabled" | "auto-merge-disabled";
/** The four slots of canon's flat result object, whose zod schema is `QZo` (194645). Flat is load-bearing: a
 *  later `if` OVERWRITES an earlier one, which is why merge and rebase share `branch` and a command that did
 *  both reports only the rebase (194456–194459). */
export type GitCommitOp = { sha: string; kind: GitCommitKind; branch?: string };
export type GitPushOp = { branch: string };
export type GitBranchOp = { ref: string; action: "merged" | "rebased" };
export type GitPrOp = { number: number; url?: string; action: GitPrAction };
export type GitOps = { commit?: GitCommitOp; push?: GitPushOp; branch?: GitBranchOp; pr?: GitPrOp };

/** `Iya` (194645) in DECLARATION order — `find` takes the first entry that matches anywhere in the command, so
 *  `gh pr close … && gh pr reopen …` reports "closed". `gh pr review` is deliberately absent (194646 is consumed
 *  by an unrelated function). */
const PR_VERBS: readonly { re: RegExp; action: GitPrAction }[] = [
  { re: /\bgh\s+pr\s+create\b/, action: "created" }, { re: /\bgh\s+pr\s+edit\b/, action: "edited" },
  { re: /\bgh\s+pr\s+merge\b/, action: "merged" }, { re: /\bgh\s+pr\s+comment\b/, action: "commented" },
  { re: /\bgh\s+pr\s+close\b/, action: "closed" }, { re: /\bgh\s+pr\s+reopen\b/, action: "reopened" },
  { re: /\bgh\s+pr\s+ready\b/, action: "ready" },
];

/** `zpp` (194391–194395): strip erase-in-line, turn a column move into a newline, turn CRs into newlines — so a
 *  progress-rewritten `git commit` line still starts at a `/m` anchor. */
const normalize = (output: string): string => output.replace(/\x1b\[[0-9;]*K/g, "").replace(/\x1b\[[0-9]*G/g, "\n").replace(/\r/g, "\n");
/** `Pya`'s `r` (194294) and our `--amend` departure both read this. */
const stripQuotes = (command: string): string => command.replace(RE_QUOTED, " ");
/** `Dya` (194416–194418): the argument segment of the `git push` itself — everything after the subcommand up to
 *  the first shell separator, so a `-n` belonging to a later statement cannot veto the push. */
const pushArgs = (command: string): string => (command.split(RE_PUSH)[1] ?? "").split(/[&|;\n]/)[0] ?? "";
/** `$pp` (194423–194435): the first BARE token after the subcommand — flags skipped, and the scan stops dead at a
 *  redirection or a separator so `git merge > out` yields no ref at all. */
function firstRef(command: string, sub: string): string | undefined {
  const rest = command.split(gitSub(sub))[1];
  if (!rest) return undefined;
  for (const word of rest.trim().split(/\s+/)) {
    if (/^(?:[\d*]*[<>]|[&|;])/.test(word)) break;
    if (word.startsWith("-")) continue;
    return word;
  }
  return undefined;
}
/** `qpp` (194396–194401). Group 1 is absent for a detached HEAD, group 2 is the short sha. */
function commitLine(output: string): { sha: string; branch?: string } | undefined {
  const m = normalize(output).match(RE_COMMIT_LINE);
  if (m?.[2] === undefined) return undefined;
  return { sha: m[2], ...(m[1] === undefined ? {} : { branch: m[1] }) };
}
/** `Oya` + `rQo` (194370 / 194325): the LAST pr url anywhere in the output wins. */
function lastPrUrl(output: string): { number: number; url: string } | undefined {
  const all = output.match(new RegExp(RE_PR_URL.source, "g"));
  const m = all === null ? null : RE_PR_URL.exec(all[all.length - 1]!);
  return m?.[1] && m?.[2] ? { number: parseInt(m[2], 10), url: m[0] } : undefined;
}
/** `Pya` (194294–194304): the verb, then the two modifier overrides that rename it. */
function prAction(command: string): GitPrAction | undefined {
  const action = PR_VERBS.find((entry) => entry.re.test(command))?.action, stripped = stripQuotes(command);
  if (action === "merged") {
    if (/--disable-auto\b/.test(stripped)) return "auto-merge-disabled";
    if (/--auto\b/.test(stripped)) return "auto-merge-enabled";
  } else if (action === "ready" && /--undo\b/.test(stripped)) return "draft";
  return action;
}

/** `vFr(command, output)` (194436–194473). Every branch is independent and the object is flat, so one shell call
 *  can report a commit AND a push (`git commit && git push`) but never two commits. */
export function recognizeGitOps(command: string, output: string): GitOps {
  const ops: GitOps = {}, cherryPicked = RE_CHERRY_PICK.test(command);
  if (RE_COMMIT.test(command) || cherryPicked) {
    const line = commitLine(output);
    // The departure: `stripQuotes` here, where canon reads the raw command.
    if (line) ops.commit = { sha: line.sha, kind: cherryPicked ? "cherry-picked" : /--amend\b/.test(stripQuotes(command)) ? "amended" : "committed", ...(line.branch === undefined ? {} : { branch: line.branch }) };
  }
  if (RE_PUSH.test(command) && !RE_DRY_RUN.test(pushArgs(command))) {
    const branch = output.match(RE_PUSH_REF)?.[1];
    if (branch) ops.push = { branch };
  }
  if (RE_MERGE.test(command) && /(Fast-forward|Merge made by)/.test(output)) {
    const ref = firstRef(command, "merge");
    if (ref) ops.branch = { ref, action: "merged" };
  }
  if (RE_REBASE.test(command) && /Successfully rebased/.test(output)) {
    const ref = firstRef(command, "rebase");
    if (ref) ops.branch = { ref, action: "rebased" };   // overwrites a merge in the same slot — canon 194456
  }
  const action = prAction(command);
  if (action !== undefined) {
    const url = lastPrUrl(output);
    if (url) ops.pr = { number: url.number, url: url.url, action };
    else {
      // `Vpp` (194419–194422) — the no-url fallback, which yields a number and no link.
      const m = output.match(RE_PR_FALLBACK);
      if (m?.[2]) ops.pr = { number: parseInt(m[2], 10), action };
    }
  }
  return ops;
}
