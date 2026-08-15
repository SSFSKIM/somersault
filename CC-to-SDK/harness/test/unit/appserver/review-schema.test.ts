// appserver/review-schema.test.ts — Task 1: `review/start` params. Pins the vocabulary itself, because the
// point of the module is that the names are CODEX'S (protocol/v2/review.rs:39-64) — a rename here is a
// parity regression, not a refactor. `inline` parsing green is the deliberate half: the refusal is the
// handler's job (D-M4-2), so a client sending a value Codex accepts reads "not supported yet", not "invalid".
import { describe, it, expect } from "vitest";
import { reviewStartParams } from "../../../src/appserver/schema/review.js";

describe("review/start params", () => {
  it("accepts all four Codex target variants", () => {
    const base = { threadId: "th_1" };
    for (const target of [
      { type: "uncommittedChanges" },
      { type: "baseBranch", branch: "main" },
      { type: "commit", sha: "abc123" },
      { type: "commit", sha: "abc123", title: "fix: thing" },
      { type: "custom", instructions: "review the auth flow" },
    ]) {
      expect(reviewStartParams.safeParse({ ...base, target }).success).toBe(true);
    }
  });
  it("defaults delivery to detached and accepts inline (refused later, not here)", () => {
    const p = reviewStartParams.parse({ threadId: "th_1", target: { type: "uncommittedChanges" } });
    expect(p.delivery).toBe("detached");
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "uncommittedChanges" }, delivery: "inline" }).success).toBe(true);
  });
  it("rejects an unknown target type, a blank branch, and a blank threadId", () => {
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "nope" } }).success).toBe(false);
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "baseBranch", branch: "" } }).success).toBe(false);
    expect(reviewStartParams.safeParse({ threadId: "", target: { type: "uncommittedChanges" } }).success).toBe(false);
  });
});
