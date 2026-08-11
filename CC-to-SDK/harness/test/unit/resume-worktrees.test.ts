// test/unit/resume-worktrees.test.ts — the `/resume` picker's Ctrl+W gate (Wave S T10). Upstream shows the
// worktree toggle only when `git worktree list --porcelain` enumerates MORE THAN ONE worktree, and it runs
// git with a hardened argv (hooks and fsmonitor off) under a 5s timeout (bundle L35980-35984). Pure parsing
// plus a DI'd runner — no git process is spawned here.
import { describe, it, expect } from "vitest";
import { countWorktrees, hasWorktrees, WORKTREE_ARGV, WORKTREE_TIMEOUT_MS } from "../../src/tui/worktrees.js";

const PORCELAIN_ONE = `worktree /repo\nHEAD abc\nbranch refs/heads/main\n`;
const PORCELAIN_TWO = `${PORCELAIN_ONE}\nworktree /repo/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n`;

describe("worktree detection — upstream's `D(it.length > 1)` gate", () => {
  it("counts one `worktree ` record per enumerated checkout", () => {
    expect(countWorktrees(PORCELAIN_ONE)).toBe(1);
    expect(countWorktrees(PORCELAIN_TWO)).toBe(2);
    expect(countWorktrees("")).toBe(0);
    // `bare` and `detached` records carry no path line of their own; only the `worktree ` prefix counts, and a
    // branch named `worktree-x` must not be mistaken for one.
    expect(countWorktrees("worktree /repo\nbranch refs/heads/worktree-x\n")).toBe(1);
  });

  it("is TRUE only above one worktree — a plain clone offers no worktree axis to widen", async () => {
    expect(await hasWorktrees("/repo", async () => PORCELAIN_ONE)).toBe(false);
    expect(await hasWorktrees("/repo", async () => PORCELAIN_TWO)).toBe(true);
  });

  it("runs upstream's exact argv against the project dir", async () => {
    let seen: { args: readonly string[]; cwd: string } | undefined;
    await hasWorktrees("/proj", async (args, cwd) => { seen = { args, cwd }; return PORCELAIN_TWO; });
    expect(seen?.cwd).toBe("/proj");
    expect([...seen!.args]).toEqual(["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=", "worktree", "list", "--porcelain"]);
    expect([...WORKTREE_ARGV]).toEqual([...seen!.args]);
    expect(WORKTREE_TIMEOUT_MS).toBe(5000);
  });

  it("reports FALSE on any failure — not a git repo, no git, a timeout (upstream returns success:false)", async () => {
    expect(await hasWorktrees("/nope", async () => { throw new Error("not a git repository"); })).toBe(false);
  });
});
