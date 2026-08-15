import { describe, it, expect } from "vitest";
import { buildReviewPrompt } from "../../../src/appserver/reviewPrompt.js";

describe("buildReviewPrompt", () => {
  it("names ReportFindings as the deliverable in every variant", () => {
    for (const t of [
      { type: "uncommittedChanges" as const },
      { type: "baseBranch" as const, branch: "main" },
      { type: "commit" as const, sha: "abc123" },
      { type: "custom" as const, instructions: "review the auth flow" },
    ]) {
      expect(buildReviewPrompt(t)).toContain("ReportFindings");
    }
  });
  it("names the uncommitted working tree, not a commit range", () => {
    const p = buildReviewPrompt({ type: "uncommittedChanges" });
    expect(p).toMatch(/uncommitted|working tree/i);
  });
  it("uses the RESOLVED range for baseBranch when one is supplied, and the branch otherwise", () => {
    const withRange = buildReviewPrompt({ type: "baseBranch", branch: "main" }, { range: "abc123..HEAD" });
    expect(withRange).toContain("abc123..HEAD");
    const without = buildReviewPrompt({ type: "baseBranch", branch: "main" });
    expect(without).toContain("main");
  });
  it("carries the commit sha, and the custom instructions verbatim", () => {
    expect(buildReviewPrompt({ type: "commit", sha: "deadbee" })).toContain("deadbee");
    expect(buildReviewPrompt({ type: "custom", instructions: "review the auth flow" })).toContain("review the auth flow");
  });

  // ── Beyond the plan's floor: the prompt is the whole review instruction, so the parts that make a
  // review useful rather than merely well-formed are worth pinning too.
  it("carries the commit title when one is supplied, and omits the parens when it is not", () => {
    expect(buildReviewPrompt({ type: "commit", sha: "deadbee", title: "fix: off-by-one" })).toContain("fix: off-by-one");
    expect(buildReviewPrompt({ type: "commit", sha: "deadbee" })).not.toContain("()");
  });
  it("asks for anchored findings with a concrete failure scenario, and an empty array when clean", () => {
    const p = buildReviewPrompt({ type: "uncommittedChanges" });
    expect(p).toContain("failure_scenario");
    expect(p).toMatch(/empty findings array/i);
  });
  it("is pure — same arguments, same string; a resolved range cannot leak into other variants", () => {
    const a = buildReviewPrompt({ type: "commit", sha: "abc123" });
    const b = buildReviewPrompt({ type: "commit", sha: "abc123" }, { range: "zzz999..HEAD" });
    expect(b).toBe(a);
    expect(buildReviewPrompt({ type: "custom", instructions: "x" }, { range: "zzz999..HEAD" })).not.toContain("zzz999");
  });
});
