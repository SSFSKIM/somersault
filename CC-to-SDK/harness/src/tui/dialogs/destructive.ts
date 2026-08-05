// tui/dialogs/destructive.ts — the destructive-command warning table the Bash permission dialog prints
// under the command (F6 T4). A VERBATIM transcription of 2.1.220's `MQg` (L154440) — patterns, categories
// and warning literals, in bundle order — plus its lookup `lLu`/`cLu` (L154066-154075).
//
// Two properties of the upstream lookup are load-bearing and easy to lose:
//   · the FIRST matching row wins, so the table order IS the priority order — `rm -rf` must read as
//     "recursively force-remove", never as the plainer `rm_recursive`/`rm_force` rows sitting below it;
//   · the command is sliced to 10 000 characters BEFORE matching (a pathological one-liner is not worth
//     the backtracking), which means a `rm -rf` hiding past that cut is deliberately not warned about.
// No pattern carries the `g` flag, so `.test()` here is stateless — do not add one.

export interface DestructiveRow {
  pattern: RegExp;
  /** Upstream's analytics key. Kept because the Bash dialog's rule-suggestion arm (T6) keys off it. */
  category: string;
  warning: string;
}

/** `MQg`, L154440. */
export const DESTRUCTIVE_PATTERNS: readonly DestructiveRow[] = [
  { pattern: /\bgit\s+reset\s+--hard\b/, category: "git_reset_hard", warning: "Note: may discard uncommitted changes" },
  { pattern: /\bgit\s+push\b[^;&|\n]*[ \t](--force|--force-with-lease|-f)\b/, category: "git_force_push", warning: "Note: may overwrite remote history" },
  { pattern: /\bgit\s+clean\b(?![^;&|\n]*(?:-[a-zA-Z]*n|--dry-run))[^;&|\n]*-[a-zA-Z]*f/, category: "git_clean_force", warning: "Note: may permanently delete untracked files" },
  { pattern: /\bgit\s+checkout\s+(--\s+)?\.[ \t]*($|[;&|\n])/, category: "git_checkout_dot", warning: "Note: may discard all working tree changes" },
  { pattern: /\bgit\s+restore\s+(--\s+)?\.[ \t]*($|[;&|\n])/, category: "git_restore_dot", warning: "Note: may discard all working tree changes" },
  { pattern: /\bgit\s+stash[ \t]+(drop|clear)\b/, category: "git_stash_drop", warning: "Note: may permanently remove stashed changes" },
  { pattern: /\bgit\s+branch\s+(-D[ \t]|--delete\s+--force|--force\s+--delete)\b/, category: "git_branch_force_delete", warning: "Note: may force-delete a branch" },
  { pattern: /\bgit\s+(commit|push|merge)\b[^;&|\n]*--no-verify\b/, category: "git_no_verify", warning: "Note: may skip safety hooks" },
  { pattern: /\bgit\s+commit\b[^;&|\n]*--amend\b/, category: "git_commit_amend", warning: "Note: may rewrite the last commit" },
  { pattern: /(^|[;&|\n][ \t]*)rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|(^|[;&|\n][ \t]*)rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]/, category: "rm_recursive_force", warning: "Note: may recursively force-remove files" },
  { pattern: /(^|[;&|\n][ \t]*)rm\s+-[a-zA-Z]*[rR]/, category: "rm_recursive", warning: "Note: may recursively remove files" },
  { pattern: /(^|[;&|\n][ \t]*)rm\s+-[a-zA-Z]*f/, category: "rm_force", warning: "Note: may force-remove files" },
  { pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, category: "sql_drop_truncate", warning: "Note: may drop or truncate database objects" },
  { pattern: /\bDELETE\s+FROM\s+\w+[ \t]*(;|"|'|\n|$)/i, category: "sql_delete_from", warning: "Note: may delete all rows from a database table" },
  { pattern: /\bkubectl\s+delete\b/, category: "kubectl_delete", warning: "Note: may delete Kubernetes resources" },
  { pattern: /\bterraform\s+destroy\b/, category: "terraform_destroy", warning: "Note: may destroy Terraform infrastructure" },
];

/** `lLu` L154066: only the first 10 000 characters are scanned. */
const SCAN_LIMIT = 10_000;

/** `lLu` L154066-154072 — the first row in table order whose pattern matches, if any. */
export function destructiveMatch(command: string): DestructiveRow | undefined {
  const scanned = command.length > SCAN_LIMIT ? command.slice(0, SCAN_LIMIT) : command;
  return DESTRUCTIVE_PATTERNS.find((row) => row.pattern.test(scanned));
}

/** `cLu` L154073-154075 (upstream returns `null`; `undefined` is this codebase's absent). */
export function destructiveWarning(command: string): string | undefined {
  return destructiveMatch(command)?.warning;
}
