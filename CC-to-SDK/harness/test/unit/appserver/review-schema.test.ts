// appserver/review-schema.test.ts — Task 1: `review/start` params. Pins the vocabulary itself, because the
// point of the module is that the names are CODEX'S (protocol/v2/review.rs:39-64) — a rename here is a
// parity regression, not a refactor. `inline` parsing green is the deliberate half: the refusal is the
// handler's job (D-M4-2), so a client sending a value Codex accepts reads "not supported yet", not "invalid".
import { describe, it, expect } from "vitest";
import { reviewStartParams } from "../../../src/appserver/schema/review.js";

describe("review/start params", () => {
  it("carries all four Codex target variants through to the parsed value", () => {
    // Deep-equal the OUTPUT, not just `.success`: zod STRIPS undeclared keys, so a schema that dropped or
    // misspelled `title` (the vocabulary's only optional field) would still parse green while `title`
    // vanished from what the prompt builder later reads. Same reason threadId is read back, not assumed.
    const base = { threadId: "th_1" };
    for (const target of [
      { type: "uncommittedChanges" },
      { type: "baseBranch", branch: "main" },
      { type: "commit", sha: "abc123" },
      { type: "commit", sha: "abc123", title: "fix: thing" },
      { type: "custom", instructions: "review the auth flow" },
    ]) {
      const r = reviewStartParams.safeParse({ ...base, target });
      expect(r.success).toBe(true);
      expect(r.data?.target).toEqual(target);
      expect(r.data?.threadId).toBe("th_1");
    }
  });
  it("defaults delivery to detached and preserves inline VERBATIM (refused later, not degraded here)", () => {
    const p = reviewStartParams.parse({ threadId: "th_1", target: { type: "uncommittedChanges" } });
    expect(p.delivery).toBe("detached");
    // D-M4-2 is that `inline` reaches the handler intact to be REFUSED there. A `.catch("detached")` or a
    // normalizing transform would silently degrade it and still report success — so pin the parsed value.
    const inline = reviewStartParams.safeParse({ threadId: "th_1", target: { type: "uncommittedChanges" }, delivery: "inline" });
    expect(inline.success).toBe(true);
    expect(inline.data?.delivery).toBe("inline");
  });
  it("rejects an unknown target type, a blank branch, and a blank threadId", () => {
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "nope" } }).success).toBe(false);
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "baseBranch", branch: "" } }).success).toBe(false);
    expect(reviewStartParams.safeParse({ threadId: "", target: { type: "uncommittedChanges" } }).success).toBe(false);
  });
});
