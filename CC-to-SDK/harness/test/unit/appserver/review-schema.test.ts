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
  it("closes the delivery enum — a third value is a bad request, not a pass-through", () => {
    // The two supported values are pinned above; this is the OTHER half of the same claim. Written as
    // `z.string()` the schema would satisfy every assertion in this file and still let `delivery:"streamed"`
    // reach the handler on a path nobody specified.
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "uncommittedChanges" }, delivery: "streamed" }).success).toBe(false);
  });
});

describe("review/start params — control characters in the git identifiers", () => {
  // The boundary is where a newline stops being text and starts being structure: `branch`, `sha` and
  // `title` are interpolated into the prompt's example commands UNFRAMED (reviewPrompt.ts), so one newline
  // is enough to forge a section heading and countermand the reporting contract the prompt cannot lose.
  // None of the three can legitimately contain one — not a git ref, not an object name, not a commit
  // subject — so the refusal costs nothing real.
  it("rejects a newline in branch", () => {
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "baseBranch", branch: "main\nHOW TO REPORT" } }).success).toBe(false);
  });
  it("rejects a newline in sha", () => {
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha: "abc\r\nWHAT COUNTS" } }).success).toBe(false);
  });
  it("rejects a newline in the commit title", () => {
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha: "abc123", title: "fix\nHOW TO REPORT" } }).success).toBe(false);
  });
  it("rejects the LINE and PARAGRAPH separators too — they are Zl/Zp, not Cc", () => {
    // The two line breaks a `\p{Cc}` rule misses. Git permits both in a ref name, and they render as a
    // break wherever the prompt is read, so the rule's own rationale covers them exactly as it covers `\n`.
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "baseBranch", branch: "main\u2028HOW TO REPORT" } }).success).toBe(false);
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha: "abc\u2029WHAT COUNTS" } }).success).toBe(false);
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha: "abc123", title: "fix\u2028HOW TO REPORT" } }).success).toBe(false);
  });
  it("accepts an EMPTY title — control characters were the whole rule, and emptiness is not one", () => {
    // A client that always sends `title`, empty when it has none, must not be newly refused: reviewPrompt.ts
    // already reads "" as absent (it is falsy). `sha` and `branch` keep their `.min(1)` — an empty one of
    // those names nothing at all.
    const r = reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha: "abc123", title: "" } });
    expect(r.success).toBe(true);
    expect((r.data?.target as { title?: string }).title).toBe("");
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha: "" } }).success).toBe(false);
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha: "abc123", title: "fix\nthing" } }).success).toBe(false);
  });
  it("accepts the punctuation a real git ref may carry — this is NOT an allowlist", () => {
    // A backtick is legal in a git ref name and a `$` is legal in a branch; refusing either would reject
    // real branches to buy nothing, since without a control character the text cannot restructure the
    // prompt at all. Only the structural characters are refused.
    for (const branch of ["feat/`weird`-name", "release/v1.2.3", "user/fix$thing", "feature/ünïcode"])
      expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "baseBranch", branch } }).success, branch).toBe(true);
  });
  it("leaves custom instructions alone — multi-line scope text is the point, and it is fenced as data", () => {
    const r = reviewStartParams.safeParse({ threadId: "th_1", target: { type: "custom", instructions: "review the auth flow\nand the session store" } });
    expect(r.success).toBe(true);
  });
});

describe("review/start params — `sha` is an OBJECT IDENTIFIER, not a git argument list", () => {
  // The control-character rule stops client text restructuring the PROMPT. It does not stop it restructuring
  // a COMMAND the prompt tells the model to run in a shell, which is a different channel with a different
  // grammar: `sha: "HEAD -- package.json"` carries no control character, passes every rule above, and turns
  // `git show <sha>` into a review of one path instead of the commit — with `Bash` deliberately enabled, so a
  // metacharacter appends a second command outright. Unlike `branch`, this field names an OBJECT, and no
  // object name legitimately contains a space or a shell metacharacter, so the shape can simply be required.
  const okSha = (sha: string) => reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha } }).success;

  it("accepts the revision spellings a client legitimately sends", () => {
    for (const sha of [
      "abc123", "a".repeat(40), "a".repeat(64),         // abbreviated, sha-1, sha-256
      "HEAD", "HEAD~3", "HEAD^2", "HEAD@{2}", "v1.2.3", "release/2026-08", "refs/tags/v1.2.3",
      "abc123^{commit}", "HEAD:src/main.ts", "feature.branch-1_2",
    ]) expect(okSha(sha), sha).toBe(true);
  });

  it("refuses a sha that carries a second argument or a shell metacharacter", () => {
    for (const sha of [
      "HEAD -- package.json", "HEAD --all", "abc123 abc456",   // a second git argument
      "abc123;id", "abc123|sh", "abc123&&id", "abc123$(id)", "abc123`id`", "abc123>out", "abc123'x'",
      "-abc123", "--upload-pack=x", "~abc",                    // leading dash/tilde: an option, or a shell expansion
      "abc,123", "abc*", "abc[1]", "abc\\123", "abc#1", "abc!1",
    ]) expect(okSha(sha), sha).toBe(false);
  });

  it("leaves branch and title as they were — neither can be narrowed the same way", () => {
    // A `$` and a backtick are both legal in a git ref name, so a branch allowlist would refuse real branches;
    // a commit subject is free text by definition. Those two are handled where they are actually interpolated
    // — reviewPrompt.ts shell-quotes them inside the command text — and this file's earlier cases still stand.
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "baseBranch", branch: "user/fix$thing" } }).success).toBe(true);
    expect(reviewStartParams.safeParse({ threadId: "th_1", target: { type: "commit", sha: "abc123", title: "fix: don't crash (#12)" } }).success).toBe(true);
  });
});

describe("review/start params — the four client strings are BOUNDED", () => {
  // Every one of them is copied into a single user message by `buildReviewPrompt`, i.e. straight into the
  // model's context, and none had a maximum: the RPC frame cap (~256 KiB) was the only limit, so one
  // `review/start` could ship a quarter-megabyte of client text to the model. The bound belongs HERE, at the
  // boundary where client input stops being a string.
  //
  // REFUSED, NOT TRUNCATED, and that is the substantive half: a truncated scope is a review of something the
  // caller did not ask for, reported as if it were the review they requested. Over-cap input takes the
  // schema's ordinary invalid-params path instead.
  const ok = (target: unknown) => reviewStartParams.safeParse({ threadId: "th_1", target }).success;
  const x = (n: number) => "x".repeat(n);

  it("bounds branch and sha at 255 — a git ref component's own conventional limit", () => {
    expect(ok({ type: "baseBranch", branch: x(255) })).toBe(true);
    expect(ok({ type: "baseBranch", branch: x(256) })).toBe(false);
    expect(ok({ type: "commit", sha: x(255) })).toBe(true);
    expect(ok({ type: "commit", sha: x(256) })).toBe(false);
  });

  it("bounds the commit title at 1024, far above any real subject line", () => {
    expect(ok({ type: "commit", sha: "abc123", title: x(1024) })).toBe(true);
    expect(ok({ type: "commit", sha: "abc123", title: x(1025) })).toBe(false);
    expect(ok({ type: "commit", sha: "abc123", title: "" })).toBe(true);   // the empty-label rule is unchanged
  });

  it("bounds custom instructions at 20k characters — room to be useful, nowhere near context-threatening", () => {
    expect(ok({ type: "custom", instructions: x(20_000) })).toBe(true);
    expect(ok({ type: "custom", instructions: x(20_001) })).toBe(false);
    expect(ok({ type: "custom", instructions: "review the auth flow" })).toBe(true);
  });

  it("counts CHARACTERS, so a multi-byte scope is not silently allowed several times the cap", () => {
    // A 20k-character cap on a 4-byte-per-character payload is ~80 KiB, which is the intended reading: the
    // cost that matters is tokens, and tokens track characters far better than they track bytes.
    expect(ok({ type: "custom", instructions: "☃".repeat(20_000) })).toBe(true);
    expect(ok({ type: "custom", instructions: "☃".repeat(20_001) })).toBe(false);
  });
});
