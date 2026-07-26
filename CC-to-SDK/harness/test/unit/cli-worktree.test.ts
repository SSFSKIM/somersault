import { describe, it, expect } from "vitest";
import { isAbsolute, join, resolve } from "node:path";
import { worktreePaths, ensureWorktree } from "../../src/cli/worktree.js";

describe("worktreePaths", () => {
  it("uses the layout daemon-spawn.sh assumes — fixed, not configurable", () => {
    expect(worktreePaths("/repo", "wt")).toEqual({ path: "/repo/.claude/worktrees/wt", branch: "worktree-wt" });
  });
  it("resolves a relative repo, because rm REFUSES a worktree it cannot locate", () => {
    // main composes this from `inv.config.cwd ?? process.cwd()`, and --cwd is stored exactly as typed.
    // A relative repo yields a relative worktree path, and rmSession rejects a non-absolute worktree
    // outright — the row would be permanently unremovable, over a path that was never even wrong here.
    const { path } = worktreePaths("sub", "wt");
    expect(isAbsolute(path)).toBe(true);
    expect(path).toBe(join(resolve("sub"), ".claude", "worktrees", "wt"));
  });
});

describe("ensureWorktree", () => {
  it("creates the worktree on branch worktree-<name> when absent", async () => {
    const calls: string[][] = [];
    const p = await ensureWorktree("/repo", "wt", { exists: () => false, git: async (a) => { calls.push(a); return ""; } });
    expect(p).toBe("/repo/.claude/worktrees/wt");
    expect(calls[0]).toEqual(["-C", "/repo", "worktree", "add", "-b", "worktree-wt", "/repo/.claude/worktrees/wt"]);
  });
  it("REUSES an existing worktree instead of failing", async () => {
    // Not merely tolerant: `git worktree add` on an existing path fails, and a RESUMED daemon must
    // land in the same checkout its first turn wrote into.
    const calls: string[][] = [];
    const p = await ensureWorktree("/repo", "wt", { exists: () => true, git: async (a) => { calls.push(a); return ""; } });
    expect(p).toBe("/repo/.claude/worktrees/wt");
    expect(calls).toEqual([]);
  });
  it("runs git against the RESOLVED repo, and hands back an absolute path", async () => {
    const calls: string[][] = [];
    const p = await ensureWorktree("sub", "wt", { exists: () => false, git: async (a) => { calls.push(a); return ""; } });
    expect(p).toBe(join(resolve("sub"), ".claude", "worktrees", "wt"));
    expect(calls[0]![1]).toBe(resolve("sub"));       // `git -C` against the string as typed would depend on git's cwd
    expect(calls[0]![6]).toBe(p);
  });
  it("propagates a failed `git worktree add` instead of returning a path nothing created", async () => {
    // main reports this and returns non-zero. Swallowing it would spawn a worker into a directory that
    // does not exist, in a checkout it was supposed to be isolated from.
    await expect(ensureWorktree("/repo", "wt", { exists: () => false, git: async () => { throw new Error("fatal: branch 'worktree-wt' already exists"); } }))
      .rejects.toThrow(/already exists/);
  });
});
