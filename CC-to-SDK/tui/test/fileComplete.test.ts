// tui/test/fileComplete.test.ts — pure @-completion: recursive walk (fake fs) + fuzzy ranking.
import { describe, it, expect } from "vitest";
import { collectFiles, rankCandidates, type DirEnt } from "../src/fileComplete.js";

// A fake fs: a map of dir-path → entries. The walk joins with "/" starting from the cwd root "".
const tree: Record<string, DirEnt[]> = {
  "": [{ name: "src", isDir: true }, { name: "node_modules", isDir: true }, { name: ".git", isDir: true }, { name: "README.md", isDir: false }],
  "src": [{ name: "app.ts", isDir: false }, { name: "util", isDir: true }, { name: ".hidden", isDir: false }],
  "src/util": [{ name: "fs.ts", isDir: false }],
  "node_modules": [{ name: "pkg.js", isDir: false }],
};
const readdir = (dir: string): DirEnt[] => tree[dir] ?? [];

describe("collectFiles", () => {
  it("walks recursively, skipping node_modules/.git/dotfiles, returning relative POSIX paths", () => {
    const files = collectFiles("", readdir);
    expect(files.sort()).toEqual(["README.md", "src/app.ts", "src/util/fs.ts"]);   // no node_modules, no .git, no .hidden
  });
  it("honors the cap", () => {
    expect(collectFiles("", readdir, { cap: 2 }).length).toBe(2);
  });
});
describe("rankCandidates", () => {
  it("returns subsequence matches ranked, segment/prefix bonuses first", () => {
    const items = rankCandidates(["src/app.ts", "src/util/fs.ts", "README.md"], "app");
    expect(items[0].path).toBe("src/app.ts");
    expect(items.find((c) => c.path === "README.md")).toBeUndefined();   // "app" is not a subsequence of README.md
  });
  it("empty query returns the first cap files in order", () => {
    expect(rankCandidates(["a", "b", "c"], "", 2).map((c) => c.path)).toEqual(["a", "b"]);
  });
});
