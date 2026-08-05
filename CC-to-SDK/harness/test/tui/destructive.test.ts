// tui/test/destructive.test.ts — the destructive-command warning table (F6 T4). Every expectation is a
// transcription of 2.1.220's `MQg` (L154440) plus its lookup `lLu`/`cLu` (L154066-154075): the FIRST row
// whose pattern matches wins, so the table order IS the priority order and `rm -rf` must read as
// "recursively force-remove", never as the plainer `rm_recursive` / `rm_force` rows that sit below it.
import { describe, it, expect } from "vitest";
import { DESTRUCTIVE_PATTERNS, destructiveMatch, destructiveWarning } from "../../src/tui/dialogs/destructive.js";

describe("destructive table", () => {
  it("carries all 16 bundle rows, in bundle order (L154440)", () => {
    expect(DESTRUCTIVE_PATTERNS.map((r) => r.category)).toEqual([
      "git_reset_hard", "git_force_push", "git_clean_force", "git_checkout_dot", "git_restore_dot",
      "git_stash_drop", "git_branch_force_delete", "git_no_verify", "git_commit_amend",
      "rm_recursive_force", "rm_recursive", "rm_force",
      "sql_drop_truncate", "sql_delete_from", "kubectl_delete", "terraform_destroy",
    ]);
  });

  // One positive per row. The literals are the bundle's own `warning` strings, character for character.
  it.each([
    ["git reset --hard HEAD~1", "Note: may discard uncommitted changes"],
    ["git push --force origin main", "Note: may overwrite remote history"],
    ["git push -f", "Note: may overwrite remote history"],
    ["git push --force-with-lease origin main", "Note: may overwrite remote history"],
    ["git clean -fd", "Note: may permanently delete untracked files"],
    ["git checkout .", "Note: may discard all working tree changes"],
    ["git checkout -- .", "Note: may discard all working tree changes"],
    ["git restore .", "Note: may discard all working tree changes"],
    ["git stash drop", "Note: may permanently remove stashed changes"],
    ["git stash clear", "Note: may permanently remove stashed changes"],
    ["git branch -D feature/x", "Note: may force-delete a branch"],
    ["git branch --delete --force feature/x", "Note: may force-delete a branch"],
    ["git commit --no-verify -m wip", "Note: may skip safety hooks"],
    ["git commit --amend --no-edit", "Note: may rewrite the last commit"],
    ["rm -rf build", "Note: may recursively force-remove files"],
    ["rm -r build", "Note: may recursively remove files"],
    ["rm -f build/out.js", "Note: may force-remove files"],
    ["psql -c 'DROP TABLE users'", "Note: may drop or truncate database objects"],
    ["psql -c 'TRUNCATE TABLE users'", "Note: may drop or truncate database objects"],
    ['psql -c "DELETE FROM users"', "Note: may delete all rows from a database table"],
    ["kubectl delete pod api-0", "Note: may delete Kubernetes resources"],
    ["terraform destroy -auto-approve", "Note: may destroy Terraform infrastructure"],
  ])("warns on %j", (command, warning) => {
    expect(destructiveWarning(command)).toBe(warning);
  });

  it("is silent on commands the table does not name", () => {
    for (const safe of ["ls -la", "git status", "npm run build", "rm --help", "echo rm -rf"]) {
      expect(destructiveWarning(safe)).toBeUndefined();
    }
  });

  it("honours the git-clean dry-run lookahead (L154440 `git_clean_force`)", () => {
    expect(destructiveWarning("git clean -n")).toBeUndefined();
    expect(destructiveWarning("git clean --dry-run -fd")).toBeUndefined();
    expect(destructiveWarning("git clean -fdn")).toBeUndefined();
  });

  it("resolves ties by table order, not by specificity", () => {
    expect(destructiveMatch("rm -rf x")?.category).toBe("rm_recursive_force");
    expect(destructiveMatch("rm -fr x")?.category).toBe("rm_recursive_force");
    expect(destructiveMatch("rm -Rf x")?.category).toBe("rm_recursive_force");
    // `git commit --amend --no-verify` matches both rows; `git_no_verify` is the earlier one.
    expect(destructiveMatch("git commit --amend --no-verify")?.category).toBe("git_no_verify");
  });

  it("only sees the first 10 000 characters (`lLu` L154067)", () => {
    expect(destructiveWarning("echo " + "x".repeat(10_000) + " && rm -rf /")).toBeUndefined();
    expect(destructiveWarning("echo x && rm -rf /")).toBe("Note: may recursively force-remove files");
  });

  it("anchors the rm rows to a command position, so a filename ending in rm does not fire", () => {
    expect(destructiveWarning("npm -r install")).toBeUndefined();
    expect(destructiveWarning("cargo rm -r foo")).toBeUndefined();      // `rm` is not at a command boundary
    expect(destructiveWarning("cd /tmp && rm -r foo")).toBe("Note: may recursively remove files");
  });
});
