import { describe, it, expect } from "vitest";
import { isAbsolute, join, resolve } from "node:path";
import { worktreePaths, ensureWorktree } from "../../src/cli/worktree.js";

/** A git that answers `rev-parse --show-toplevel` with `root` (newline and all, as the real one does) and
 *  `worktree list --porcelain` with `listed`, recording every call. NOTHING here shells out: the deps seam
 *  exists precisely so these tests never touch a real repository. */
function fakeGit(root: string, listed: string[] = []) {
  const calls: string[][] = [];
  return { calls, git: async (a: string[]) => {
    calls.push(a);
    if (a[2] === "rev-parse") return `${root}\n`;
    if (a[2] === "worktree" && a[3] === "list") return listed.map((p) => `worktree ${p}\nHEAD 0000000\n\n`).join("");
    return "";
  } };
}
const added = (calls: string[][]): string[][] => calls.filter((a) => a[3] === "add");

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
    const g = fakeGit("/repo");
    const p = await ensureWorktree("/repo", "wt", { exists: () => false, git: g.git });
    expect(p).toBe("/repo/.claude/worktrees/wt");
    expect(added(g.calls)).toEqual([["-C", "/repo", "worktree", "add", "-b", "worktree-wt", "/repo/.claude/worktrees/wt"]]);
  });
  it("REUSES an existing worktree git still lists, instead of failing", async () => {
    // Not merely tolerant: `git worktree add` on an existing path fails, and a RESUMED daemon must
    // land in the same checkout its first turn wrote into.
    const g = fakeGit("/repo", ["/repo", "/repo/.claude/worktrees/wt"]);
    const p = await ensureWorktree("/repo", "wt", { exists: () => true, git: g.git });
    expect(p).toBe("/repo/.claude/worktrees/wt");
    expect(added(g.calls)).toEqual([]);
  });
  it("REFUSES a directory that exists but is no longer a registered worktree", async () => {
    // A re-cloned repository, a pruned `.git/worktrees`, a half-finished manual cleanup: each leaves the
    // directory behind without its registration. Reusing it runs the worker somewhere git does not track,
    // and `ccx rm` can then never remove it — `git worktree remove` fails and rmSession refuses rather
    // than deleting recursively, so the row outlives every attempt to clean it up.
    const g = fakeGit("/repo", ["/repo"]);           // the main checkout is listed; ours is not
    await expect(ensureWorktree("/repo", "wt", { exists: () => true, git: g.git })).rejects.toThrow(/not a registered worktree/);
    expect(added(g.calls)).toEqual([]);
  });
  it("REFUSES a name that is not one path segment, rather than handing back the shared checkout", async () => {
    // `worktreePaths("/repo", "../..")` is `/repo` itself, which exists — so the reuse branch returned the
    // MAIN checkout as an isolated worktree with no git call and no error, every downstream claim of
    // isolation intact. "" is the likelier one: `--worktree "$WT"` with WT unset. git THROWS here, so a
    // rejection that names the name is what proves the check runs before any git call rather than after.
    const git = async (): Promise<string> => { throw new Error("git must not run"); };
    for (const bad of ["", ".", "..", "../..", "a/b", "/abs", "sub/../../.."]) {
      await expect(ensureWorktree("/repo", bad, { exists: () => true, git })).rejects.toThrow(/single path segment/);
    }
  });
  it("takes the repository root from git, not from the directory the command was invoked in", async () => {
    // `--cwd <subdir>` put the layout at `<subdir>/.claude/worktrees/<name>` — `git -C <subdir> worktree
    // add` succeeds there — which is off the fixed path the consumer greps, and the next run from the real
    // root then dies on the `worktree-wt` branch that subdirectory run already took.
    const g = fakeGit("/repo");
    const p = await ensureWorktree("/repo/sub/dir", "wt", { exists: () => false, git: g.git });
    expect(p).toBe("/repo/.claude/worktrees/wt");
    expect(g.calls[0]).toEqual(["-C", "/repo/sub/dir", "rev-parse", "--show-toplevel"]);
    expect(added(g.calls)).toEqual([["-C", "/repo", "worktree", "add", "-b", "worktree-wt", "/repo/.claude/worktrees/wt"]]);
  });
  it("runs git against the RESOLVED repo, and hands back an absolute path", async () => {
    const g = fakeGit(resolve("sub"));
    const p = await ensureWorktree("sub", "wt", { exists: () => false, git: g.git });
    expect(p).toBe(join(resolve("sub"), ".claude", "worktrees", "wt"));
    expect(g.calls[0]![1]).toBe(resolve("sub"));     // `git -C` against the string as typed would depend on git's cwd
    expect(added(g.calls)[0]![6]).toBe(p);
  });
  it("propagates a failed `git worktree add` instead of returning a path nothing created", async () => {
    // main reports this and returns non-zero. Swallowing it would spawn a worker into a directory that
    // does not exist, in a checkout it was supposed to be isolated from.
    await expect(ensureWorktree("/repo", "wt", { exists: () => false, git: async (a) => {
      if (a[2] === "rev-parse") return "/repo\n";
      throw new Error("fatal: branch 'worktree-wt' already exists");
    } })).rejects.toThrow(/already exists/);
  });
});
