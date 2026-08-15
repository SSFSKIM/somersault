import { describe, it, expect } from "vitest";
import { resolveReviewRange, execFileGit } from "../../../src/appserver/reviewTarget.js";

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
//
// A NOTE THAT IS MERELY PRESENT IS NOT THE CONTRACT — the reason it carries is. So these assert CONTENT, and
// specifically that a process which never ran to completion never borrows the mute-exit-1 ancestry reading:
// "no common ancestor" is a claim about two histories, and there are none to compare if git never spoke.
describe("resolveReviewRange over the real execFile", () => {
  it("DEGRADES on a NUL byte in the branch, which node rejects SYNCHRONOUSLY before any spawn", async () => {
    // `schema/review.ts` is `z.string().min(1)`, so a JSON-RPC client can put a NUL here. `execFile` validates
    // argv up front and THROWS `ERR_INVALID_ARG_VALUE` inside the promise executor — the one path that escaped.
    const r = await resolveReviewRange({ type: "baseBranch", branch: "ma\u0000in" }, process.cwd());
    expect(r.range).toBeUndefined();
    expect(r.note).toContain("ERR_INVALID_ARG_VALUE");
    expect(r.note).not.toContain("no common ancestor");
  });
  it("DEGRADES when cwd does not exist (spawn ENOENT, the STRING `code` that used to collapse to exit 1)", async () => {
    const r = await resolveReviewRange({ type: "baseBranch", branch: "main" }, "/nonexistent-dir-for-review-target");
    expect(r.range).toBeUndefined();
    // Node reports this as `spawn git ENOENT` with EMPTY stderr — precisely the shape a non-numeric `code`
    // collapsed to 1 wore as unrelated histories. Name the spawn; there is no history here to have a gap in.
    expect(r.note).toContain("ENOENT");
    expect(r.note).not.toContain("no common ancestor");
    expect(r.note).not.toContain("unknown error");
  });
  it("DEGRADES when the TIMEOUT kills git — `code` is null, non-numeric for the OTHER reason", async () => {
    // Measured against real git at 1ms: killed 8/8, the whole loop 32ms, because a spawn alone costs more than
    // a millisecond. Empty stderr again, so this is the second half of the same trap and needs its own reason.
    const r = await resolveReviewRange({ type: "baseBranch", branch: "main" }, process.cwd(), { git: execFileGit(1) });
    expect(r.range).toBeUndefined();
    expect(r.note).toMatch(/killed with SIG/);
    expect(r.note).not.toContain("no common ancestor");
  });
  it("DEGRADES when cwd is not a repository (real git, real non-zero exit)", async () => {
    const r = await resolveReviewRange({ type: "baseBranch", branch: "main" }, "/tmp");
    expect(r.range).toBeUndefined();
    // git's own stderr rides through verbatim, and asserting its WORDS would pin a locale (git translates
    // them), so pin the shape: a real exit carries a real message, never the claim reserved for a mute exit 1.
    expect(r.note).toMatch(/could not resolve a merge-base with main: \S/);
    expect(r.note).not.toContain("no common ancestor");
  });
});
