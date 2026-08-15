import { describe, it, expect } from "vitest";
import { resolveReviewRange } from "../../../src/appserver/reviewTarget.js";

const okGit = (out: string) => async () => ({ code: 0, stdout: out, stderr: "" });
const failGit = async () => ({ code: 128, stdout: "", stderr: "fatal: Not a valid object name" });

describe("resolveReviewRange", () => {
  it("returns a merge-base range for baseBranch", async () => {
    const r = await resolveReviewRange({ type: "baseBranch", branch: "main" }, "/repo", { git: okGit("abc123\n") });
    expect(r.range).toBe("abc123..HEAD");
  });
  it("DEGRADES rather than failing when merge-base cannot be computed", async () => {
    const r = await resolveReviewRange({ type: "baseBranch", branch: "nope" }, "/repo", { git: failGit });
    expect(r.range).toBeUndefined();
    expect(r.note).toBeTruthy();          // the reason travels; the review still runs
  });
  it("is a no-op for the three non-baseBranch targets", async () => {
    for (const t of [
      { type: "uncommittedChanges" as const },
      { type: "commit" as const, sha: "abc" },
      { type: "custom" as const, instructions: "x" },
    ]) {
      const r = await resolveReviewRange(t, "/repo", { git: failGit });
      expect(r).toEqual({});              // no git call needed, no note
    }
  });
  it("passes the branch as a REF, never as a git option", async () => {
    let seen: string[] = [];
    await resolveReviewRange({ type: "baseBranch", branch: "--all-the-things" }, "/repo", {
      git: async (args) => { seen = args; return { code: 128, stdout: "", stderr: "fatal: Not a valid object name" }; },
    });
    // `--end-of-options` must come BEFORE the branch, or git parses a dash-leading branch as a flag.
    expect(seen.indexOf("--end-of-options")).toBeGreaterThan(-1);
    expect(seen.indexOf("--end-of-options")).toBeLessThan(seen.indexOf("--all-the-things"));
  });
});
