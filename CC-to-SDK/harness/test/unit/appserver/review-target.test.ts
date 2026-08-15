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
  it("names unrelated histories, which merge-base reports as exit 1 with NO stderr at all", async () => {
    const r = await resolveReviewRange({ type: "baseBranch", branch: "orphan" }, "/repo", {
      git: async () => ({ code: 1, stdout: "", stderr: "" }),
    });
    expect(r.range).toBeUndefined();
    expect(r.note).toContain("no common ancestor");   // not "unknown error" — this failure has a crisp cause
  });
});

// The DEFAULT git — no `deps`, so the real `execFile` runs. None of these need a fixture repo or a network:
// each one dies before, or at, the spawn. The `--end-of-options` GIT BEHAVIOUR (does the flag truly neutralize
// a dash-leading ref?) is the half that needs a real repo, and stays with Task 10's live acceptance.
describe("resolveReviewRange over the real execFile", () => {
  it("DEGRADES on a NUL byte in the branch, which node rejects SYNCHRONOUSLY before any spawn", async () => {
    // `schema/review.ts` is `z.string().min(1)`, so a JSON-RPC client can put a NUL here. `execFile` validates
    // argv up front and THROWS `ERR_INVALID_ARG_VALUE` inside the promise executor — the one path that escaped.
    const r = await resolveReviewRange({ type: "baseBranch", branch: "ma\u0000in" }, process.cwd());
    expect(r.range).toBeUndefined();
    expect(r.note).toBeTruthy();
  });
  it("DEGRADES when cwd does not exist (spawn ENOENT, whose `code` is a STRING)", async () => {
    const r = await resolveReviewRange({ type: "baseBranch", branch: "main" }, "/nonexistent-dir-for-review-target");
    expect(r.range).toBeUndefined();
    expect(r.note).toBeTruthy();
  });
  it("DEGRADES when cwd is not a repository (real git, real non-zero exit)", async () => {
    const r = await resolveReviewRange({ type: "baseBranch", branch: "main" }, "/tmp");
    expect(r.range).toBeUndefined();
    expect(r.note).toBeTruthy();
  });
});
