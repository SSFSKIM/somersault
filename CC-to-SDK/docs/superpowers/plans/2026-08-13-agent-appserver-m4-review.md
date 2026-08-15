# M4 — Review Domain + Elicitation Kind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt Codex's review domain into the agent app server — `review/start` with Codex's four target
variants, delivered as a detached review thread whose `ReportFindings` tool call is harvested into typed,
file/line-anchored findings — and make MCP elicitation reachable through the control plane as a fourth
decision kind.

**Architecture:** A review is an **ordinary turn** on a **new detached thread** rooted at the target
thread's cwd. The server builds an English prompt naming the target (Codex's shape) and the reviewing
agent fetches its own code via its own tools. Findings are harvested by intercepting the `ReportFindings`
`tool_use` on the frame stream the app server already maps into items, reading the payload out of the
call's `input` (probe 109). No child session, no event re-stamping, no structured-output plumbing, no
server-owned diff seam. Elicitation reuses the existing decision park wholesale: a fourth `DecisionKind`,
a fourth outcome variant, and a bridge that turns the SDK's `onElicitation` callback into a park and the
park's answer back into an `ElicitResult`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod/v4 schemas, vitest, `@anthropic-ai/claude-agent-sdk` 0.3.227.

## Global Constraints

- **Spec is `CC-to-SDK/docs/superpowers/specs/2026-08-13-agent-appserver-m4-review-design.md`.** On any conflict between this plan and the spec, STOP and report — do not silently diverge.
- **Adopt Codex's names verbatim** (D-M4-4): method `review/start`; params `{threadId, target, delivery?}`; result `{turn, reviewThreadId}`; target variants `uncommittedChanges` | `baseBranch{branch}` | `commit{sha,title?}` | `custom{instructions}`. Wire spelling is camelCase, discriminated on `type`.
- **`delivery: "inline"` is REFUSED, never silently degraded** (D-M4-2). `"detached"` is the only supported value in M4 and is the default when omitted.
- **Structured findings, with an honest fallback** (D-M4-1): a review turn with no `ReportFindings` call yields `findings: []` **plus** `unstructured: true` and the assistant prose — never a silent "clean".
- **`onElicitation` is FAIL-CLOSED.** Returning `null` sends no response and leaves the MCP server hanging until it times out (`sdk.d.ts:1300-1310`). Every settle path — including teardown and system deny — MUST return a real `ElicitResult`. This is the single most important correctness rule in the elicitation half.
- **Resist adding to hot files.** New modules over growth; target <500 LoC each.
- Dense hand-style, **no Prettier**, ESM specifiers end in `.js`, DI-by-deps for testability.
- **TDD**: failing test → red → minimal implementation → green → `npm run typecheck`.
- `git add` only the files named in each task. **No `Co-Authored-By`. Never push. Never `git stash`.**
- Commands run from `CC-to-SDK/harness/`. Implementers stop at the clean keyless skip for live tests; **the controller runs all keyed steps**.

---

### Task 1: Review params schema + target vocabulary

**Files:**
- Create: `src/appserver/schema/review.ts`
- Modify: `src/appserver/schema/index.ts` (re-export)
- Test: `test/unit/appserver/review-schema.test.ts`

**Interfaces:**
- Produces: `reviewStartParams` (zod), and the inferred types `ReviewTarget`, `ReviewDelivery` consumed by Tasks 2, 3 and 5.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/review-schema.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/review-schema.test.ts`
Expected: FAIL — cannot find module `schema/review.js`.

- [ ] **Step 3: Write the schema**

```ts
// appserver/schema/review.ts — `review/start` params (M4 §surface). Codex's shape verbatim
// (app-server-protocol/src/protocol/v2/review.rs:17-64): the same method name, the same four target
// variants, the same discriminator. Adopting the vocabulary costs nothing and keeps every future parity
// comparison a lookup rather than a translation.
//
// `inline` PARSES here and is REFUSED in the handler (D-M4-2). The split is deliberate: a client that
// sends a value Codex accepts deserves an actionable "not supported yet, use detached" rather than a
// generic schema rejection that reads like a typo.
import { z } from "zod/v4";

export const reviewTargetParams = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommittedChanges") }),
  z.object({ type: z.literal("baseBranch"), branch: z.string().min(1) }),
  z.object({ type: z.literal("commit"), sha: z.string().min(1), title: z.string().optional() }),
  z.object({ type: z.literal("custom"), instructions: z.string().min(1) }),
]);
export type ReviewTarget = z.infer<typeof reviewTargetParams>;

export const reviewStartParams = z.object({
  threadId: z.string().min(1),
  target: reviewTargetParams,
  // Default applied HERE so the handler reads one value and never re-derives the default.
  delivery: z.enum(["detached", "inline"]).default("detached"),
});
export type ReviewDelivery = z.infer<typeof reviewStartParams>["delivery"];
```

- [ ] **Step 4: Re-export from the schema barrel**

Add to `src/appserver/schema/index.ts`, matching the existing export style in that file:

```ts
export * from "./review.js";
```

- [ ] **Step 5: Run the test and typecheck**

Run: `npx vitest run test/unit/appserver/review-schema.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/schema/review.ts src/appserver/schema/index.ts test/unit/appserver/review-schema.test.ts
git commit -m "feat(as4): review/start params — Codex's four target variants"
```

---

### Task 2: The review prompt builder (pure)

**Files:**
- Create: `src/appserver/reviewPrompt.ts`
- Test: `test/unit/appserver/review-prompt.test.ts`

**Interfaces:**
- Consumes: `ReviewTarget` (Task 1).
- Produces: `buildReviewPrompt(target: ReviewTarget, resolved?: {range?: string}): string` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/review-prompt.test.ts
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/review-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the builder**

```ts
// appserver/reviewPrompt.ts — target descriptor → the English prompt that drives a review turn.
//
// THE MODEL FETCHES ITS OWN SUBJECT. Codex never computes or injects a diff (review_request.rs); it names
// the target and lets the reviewing agent run git through its own shell tool, and probe 109 confirmed the
// same shape works for us (the model reached for `Bash` and `Read` unprompted). So this builds a PROMPT,
// not a payload — which is why a review needs no server-owned diff seam.
//
// The one thing the prompt must not leave to chance is the OUTPUT CHANNEL: `ReportFindings` is a native
// SDK tool whose input IS the findings array, and probe 109 showed a plain instruction is enough to make
// the model call it. Every variant therefore ends with the same deliverable sentence.
import type { ReviewTarget } from "./schema/review.js";

/** Named once so the four variants cannot drift apart, and so a test can assert the contract in one place. */
const DELIVERABLE =
  "Report every defect you find by calling the ReportFindings tool — that tool call is the deliverable, " +
  "not prose. Anchor each finding to a repo-relative file path and a line where you can. If you find " +
  "nothing worth reporting, call ReportFindings with an empty findings array.";

export function buildReviewPrompt(target: ReviewTarget, resolved?: { range?: string }): string {
  const scope = ((): string => {
    switch (target.type) {
      case "uncommittedChanges":
        return "Review the uncommitted changes in this repository's working tree — staged, unstaged, and untracked files.";
      case "baseBranch":
        // The resolved merge-base range when the host could compute one (Task 3); the branch name is the
        // honest fallback, and saying "merge-base" keeps the model from diffing against the branch TIP.
        return resolved?.range
          ? `Review the changes in the commit range ${resolved.range}.`
          : `Review the changes on this branch relative to its merge-base with ${target.branch}.`;
      case "commit":
        return `Review the changes introduced by commit ${target.sha}${target.title ? ` (${target.title})` : ""}.`;
      case "custom":
        return target.instructions;
    }
  })();
  return `${scope}\n\n${DELIVERABLE}`;
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run test/unit/appserver/review-prompt.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/appserver/reviewPrompt.ts test/unit/appserver/review-prompt.test.ts
git commit -m "feat(as4): review prompt builder — target descriptor to prompt, ReportFindings as the deliverable"
```

---

### Task 3: Merge-base resolution for `baseBranch`

**Files:**
- Create: `src/appserver/reviewTarget.ts`
- Test: `test/unit/appserver/review-target.test.ts`

**Interfaces:**
- Produces: `resolveReviewRange(target, cwd, deps?) : Promise<{range?: string; note?: string}>` — consumed by Task 5.
- **Read for prior art first:** `CC-to-SDK/claude-plugin-codex/plugins/claude-companion/` contains a tested pure-git diff module with a merge-base resolver. Reuse its approach (and its edge cases) rather than reinventing; do not import across that boundary — it is plugin JS for a different runtime.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/review-target.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/review-target.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the resolver**

```ts
// appserver/reviewTarget.ts — the ONE piece of host-side git a review needs.
//
// Only `baseBranch` needs it, and it needs it for a reason the prompt cannot cover: "changes relative to
// main" means the merge-base range, not a diff against main's TIP, and a model asked to work that out
// itself gets it wrong in exactly the case that matters (a base branch that has moved on). Codex resolves
// the same thing with its own merge-base subprocess (git-utils/src/branch.rs:15-48).
//
// IT DEGRADES, IT DOES NOT FAIL. An unresolvable base (a branch that does not exist, a detached HEAD, a
// directory that is not a repository) still yields a runnable review — the prompt falls back to naming the
// branch and the reason rides along as a note. Refusing the whole request would trade a slightly vaguer
// review for no review at all.
import { execFile } from "node:child_process";
import type { ReviewTarget } from "./schema/review.js";

export type GitFn = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const defaultGit: GitFn = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 10_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });

export async function resolveReviewRange(
  target: ReviewTarget,
  cwd: string,
  deps: { git?: GitFn } = {},
): Promise<{ range?: string; note?: string }> {
  if (target.type !== "baseBranch") return {};
  const git = deps.git ?? defaultGit;
  // `--end-of-options` because `branch` arrives from a CLIENT and this is the boundary where it stops being
  // a string and starts being an argument. `execFile` already rules out a shell, but it does not stop git
  // from reading a dash-leading value as one of its OWN flags: measured on git 2.55, `git merge-base
  // --all-the-things HEAD` answers "unknown option", while with the guard the identical value answers "Not
  // a valid object name" — a ref that does not exist, which is exactly the degrade path below.
  const r = await git(["merge-base", "--end-of-options", target.branch, "HEAD"], cwd);
  const base = r.stdout.trim();
  if (r.code !== 0 || !base) {
    return { note: `could not resolve a merge-base with ${target.branch}: ${(r.stderr || "unknown error").trim()}` };
  }
  return { range: `${base}..HEAD` };
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run test/unit/appserver/review-target.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/appserver/reviewTarget.ts test/unit/appserver/review-target.test.ts
git commit -m "feat(as4): merge-base resolution for baseBranch reviews — degrades, never fails"
```

---

### Task 4: Harvest findings from the `ReportFindings` tool_use (pure)

**Files:**
- Create: `src/appserver/reviewFindings.ts`
- Test: `test/unit/appserver/review-findings.test.ts`

**Interfaces:**
- Produces: `type ReviewFinding`, `harvestFindings(frame: unknown): {findings: ReviewFinding[]; level?: string} | undefined` — consumed by Task 6.
- **The shape is the SDK's, not ours** — `ReportFindingsInput` at `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:771-814`. Read it before writing the type. Required per finding: `file`, `summary`, `failure_scenario`. Optional: `line`, `short_summary`, `category`, `verdict`, `outcome`. Top level also carries `level`.
- **Probe 109 is the evidence** the payload rides `tool_use.input` — read its RESULT block (`CC-to-SDK/probes/probes/109-reportfindings-harvest.ts`) before starting.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/review-findings.test.ts
import { describe, it, expect } from "vitest";
import { harvestFindings } from "../../../src/appserver/reviewFindings.js";

const frame = (content: unknown) => ({ type: "assistant", message: { content } });
const call = (input: unknown) => ({ type: "tool_use", name: "ReportFindings", id: "toolu_1", input });

describe("harvestFindings", () => {
  it("harvests the findings array out of the tool_use INPUT", () => {
    const got = harvestFindings(frame([call({
      level: "high",
      findings: [{ file: "a.ts", line: 3, summary: "off-by-one", failure_scenario: "lastN(x,2) returns 3", category: "correctness" }],
    })]));
    expect(got?.findings).toHaveLength(1);
    expect(got?.findings[0]).toMatchObject({ file: "a.ts", line: 3, category: "correctness" });
    expect(got?.level).toBe("high");
  });
  it("returns undefined for a frame with no ReportFindings call", () => {
    expect(harvestFindings(frame([{ type: "text", text: "hi" }]))).toBeUndefined();
    expect(harvestFindings(frame([{ type: "tool_use", name: "Bash", id: "t", input: {} }]))).toBeUndefined();
    expect(harvestFindings({ type: "result" })).toBeUndefined();
  });
  it("treats an EMPTY findings array as a real report, not as absence", () => {
    const got = harvestFindings(frame([call({ findings: [] })]));
    expect(got).toBeDefined();
    expect(got?.findings).toEqual([]);
  });
  it("drops malformed findings instead of rejecting the whole report", () => {
    const got = harvestFindings(frame([call({ findings: [
      { file: "a.ts", summary: "ok", failure_scenario: "s" },
      { line: 4 },                                   // no file/summary/failure_scenario
    ] })]));
    expect(got?.findings).toHaveLength(1);
  });
  it("harvests a SUBAGENT's report too — this function holds no opinion about nesting", () => {
    // D-M4-7. A reviewing agent may dispatch subagents, and `ReportFindings` is written for exactly that
    // shape; a finding from a subagent of the review is still a finding about the review's subject. The
    // sibling route for TodoWrite (`router.ts:213`) DROPS nested frames, and copying that reflex here
    // would silently discard the findings of any review that fanned out. Nesting policy belongs to the
    // wiring (Task 6), not to this pure read, so this stays blind to the field on purpose.
    const nested = { type: "assistant", parent_tool_use_id: "toolu_parent", message: { content: [call({
      findings: [{ file: "b.ts", summary: "leak", failure_scenario: "close() never runs on the error path" }],
    })] } };
    expect(harvestFindings(nested)?.findings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/review-findings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the harvester**

```ts
// appserver/reviewFindings.ts — read a review's findings off the frame stream.
//
// THE PAYLOAD IS THE TOOL CALL'S INPUT, NOT ITS RESULT. `ReportFindings` is a native SDK tool whose
// declared input IS the findings array (sdk-tools.d.ts:771-814); the result is a receipt
// ("3 findings reported."). Probe 109 verified the whole path live: default headless session, plain
// instruction, payload on `tool_use.input`, clean tool_result, `success` turn. So harvesting is a READ of
// a frame the app server already routes — not a second engine loop and not structured-output plumbing.
//
// AN EMPTY ARRAY IS A REPORT. `{findings: []}` means the reviewer looked and found nothing, which is a
// different fact from "the reviewer never reported" (Task 6's unstructured fallback) — conflating them is
// how a review turns into a silent all-clear.
//
// MALFORMED ENTRIES ARE DROPPED, NOT FATAL. The model authors this payload; one bad entry must not cost
// the whole report. The three required fields are the SDK's own.

export type ReviewFinding = {
  file: string;
  summary: string;
  failure_scenario: string;
  line?: number;
  short_summary?: string;
  category?: string;
  verdict?: "CONFIRMED" | "PLAUSIBLE";
  outcome?: "fixed" | "skipped" | "no_change_needed";
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function toFinding(raw: unknown): ReviewFinding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const file = str(r.file), summary = str(r.summary), failure = str(r.failure_scenario);
  if (!file || !summary || !failure) return undefined;   // the SDK's three required fields
  const f: ReviewFinding = { file, summary, failure_scenario: failure };
  if (typeof r.line === "number" && Number.isFinite(r.line)) f.line = r.line;
  if (str(r.short_summary)) f.short_summary = String(r.short_summary);
  if (str(r.category)) f.category = String(r.category);
  if (r.verdict === "CONFIRMED" || r.verdict === "PLAUSIBLE") f.verdict = r.verdict;
  if (r.outcome === "fixed" || r.outcome === "skipped" || r.outcome === "no_change_needed") f.outcome = r.outcome;
  return f;
}

export function harvestFindings(frame: unknown): { findings: ReviewFinding[]; level?: string } | undefined {
  const f = frame as { type?: unknown; message?: { content?: unknown } } | null;
  if (!f || f.type !== "assistant" || !Array.isArray(f.message?.content)) return undefined;
  for (const block of f.message.content as Array<Record<string, unknown>>) {
    if (block?.type !== "tool_use" || block.name !== "ReportFindings") continue;
    const input = block.input as { findings?: unknown; level?: unknown } | undefined;
    const raw = Array.isArray(input?.findings) ? input.findings : [];
    return {
      findings: raw.map(toFinding).filter((x): x is ReviewFinding => x !== undefined),
      ...(str(input?.level) ? { level: String(input?.level) } : {}),
    };
  }
  return undefined;
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `npx vitest run test/unit/appserver/review-findings.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/appserver/reviewFindings.ts test/unit/appserver/review-findings.test.ts
git commit -m "feat(as4): harvest review findings from the ReportFindings tool_use input"
```

---

### Task 5: `review/start` — the handler

**Files:**
- Create: `src/appserver/review.ts`
- Modify: `src/appserver/server.ts` (register `"review/start"` in the handler table, ~line 430 beside `fs/read`)
- Test: `test/unit/appserver/review-start.test.ts`

**Interfaces:**
- Consumes: `reviewStartParams` (T1), `buildReviewPrompt` (T2), `resolveReviewRange` (T3).
- Produces: the `reviewStart` Handler, and a per-review record marker consumed by Task 6.

**Design notes the implementer must honor:**
- **The target thread's engine is never touched.** Detached delivery needs only the target thread's **cwd** (`threadCwd`, `registry.ts`) — the review runs on a NEW thread rooted there. This is why `review/start` works for a fleet-origin thread as readily as an inProcess one, and why it must NOT be added to `FLEET_UNSUPPORTED`.
- Create the review thread through the SAME path `thread/start` uses (`startThread` in `server.ts`) so it is an ordinary registry record with an ordinary turn lifecycle.
- Reply `{turn, reviewThreadId}` — Codex's result shape.
- `delivery: "inline"` → refuse with `ERR.INVALID_PARAMS` and a message naming detached as the supported path.
- **Make "review only" true in policy, not just in the prompt.** Task 2's prompt tells the agent "Review
  only — do not edit, fix, or commit anything", and a promise the server does not enforce is a promise the
  server should not print. Create the review thread with the edit tools disallowed, reusing this
  codebase's own convention for a read-only agent rather than inventing one: `READONLY_DISALLOW =
  ["Edit", "Write", "NotebookEdit"]` (`src/config/agents.ts:4`), which the built-in read-only agents
  already use, reaching the SDK through `resolveOptions` (`src/config/resolveOptions.ts:39`). Merge it with
  whatever the caller's config already carries — do not clobber a caller's `disallowedTools`.
  **State the limit honestly in the code comment: this is risk reduction, not a guarantee.** The review
  needs `Bash` for git, and `Bash` can write; what this removes is the likely accidental path — a model
  "helpfully" applying the fix it just found, which it would do through `Edit`. Combined with D-M4-5
  (review turns park like any other turn), a write attempt that does slip through parks for a human rather
  than landing silently. Add a test asserting the review thread is created with the edit tools disallowed
  and that a caller-supplied `disallowedTools` survives the merge.

- [ ] **Step 1: Write the failing test**

Follow the harness in `test/unit/appserver/shell-command.test.ts` verbatim — `mkSink`/`boot`/`addRecord`
and wire-level `conn.feed`. The one addition is a `sessionFactory` dep (`AppServerDeps.sessionFactory`,
`server.ts:41`), which is how the test sees both the cwd the review thread was created with and the prompt
it submitted.

```ts
// test/unit/appserver/review-start.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const servers: AppServer[] = [];
let conn: { feed(chunk: string): void };
let lines: string[];
let nextId = 100;

/** Records every session this server built, so a test can assert the cwd the REVIEW thread was rooted at
 *  and the prompt it was handed — the two facts `review/start` is responsible for. */
function factory() {
  const built: Array<{ config: Record<string, unknown>; submitted: unknown[] }> = [];
  const sessionFactory: AppServerDeps["sessionFactory"] = (config) => {
    const entry = { config, submitted: [] as unknown[] };
    built.push(entry);
    return { submit: async (p: unknown) => { entry.submitted.push(p); return { result: {} }; },
      interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {},
      sessionId: `sess-${built.length}`, isEnded: () => false } as never;
  };
  return { built, sessionFactory };
}

function boot(deps: AppServerDeps = {}): AppServer {
  const srv = new AppServer({}, deps);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
  return srv;
}

/** A target thread to review — hand-built, because `review/start` never touches its engine. */
function addRecord(srv: AppServer, cwd: string, origin: "inProcess" | "fleet" = "inProcess"): string {
  const id = srv.registry.mint();
  const now = Math.floor(Date.now() / 1000);
  const rec = { id, origin, session: { submit: async () => ({ result: {} }), interrupt: async () => ({}),
      dispose: async () => {}, onFrame: () => () => {}, sessionId: "target", isEnded: () => false },
    unattended: "park", busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [],
    subscribers: new Set(), chain: Promise.resolve(), createdAt: now, updatedAt: now, cwd,
    settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
  } as unknown as ThreadRecord;
  srv.registry.set(id, rec);      // use whatever the registry's real insert seam is named
  return id;
}

const send = (method: string, params: unknown) => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  return id;
};
const replyTo = (id: number) => parsed(lines).find((m) => m.id === id) as Record<string, any> | undefined;

afterEach(() => { for (const s of servers.splice(0)) void s.shutdown?.(); });

describe("review/start", () => {
  it("refuses delivery:inline with an actionable message naming detached", async () => {
    const srv = boot(factory());
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t, target: { type: "uncommittedChanges" }, delivery: "inline" });
    await new Promise((r) => setImmediate(r));
    expect(replyTo(id)?.error?.code).toBe(ERR.INVALID_PARAMS);
    expect(String(replyTo(id)?.error?.message)).toMatch(/detached/i);
  });

  it("refuses a delivery value that is neither inline nor detached", async () => {
    // Carried forward from the Task 1 review: the schema tests pin that `detached` is the default and that
    // `inline` survives verbatim, but nothing pinned the enum CLOSED. Written as `z.string()` it would pass
    // all of those and let `delivery: "streamed"` reach this handler on a path no one specified. Two
    // supported values, and everything else is a bad request.
    const srv = boot(factory());
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t, target: { type: "uncommittedChanges" }, delivery: "streamed" });
    await new Promise((r) => setImmediate(r));
    expect(replyTo(id)?.error?.code).toBe(ERR.INVALID_PARAMS);
  });

  it("creates a NEW review thread, replies {turn, reviewThreadId}, and roots it at the target's cwd", async () => {
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo/target");
    const id = send("review/start", { threadId: t, target: { type: "uncommittedChanges" } });
    await new Promise((r) => setImmediate(r));
    const res = replyTo(id)?.result;
    expect(res?.reviewThreadId).toBeTruthy();
    expect(res?.reviewThreadId).not.toBe(t);          // a NEW thread, not the target
    expect(res?.turn?.id).toBeTruthy();
    expect(f.built.at(-1)?.config.cwd).toBe("/repo/target");
  });

  it("submits a prompt naming the target and ReportFindings", async () => {
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    send("review/start", { threadId: t, target: { type: "uncommittedChanges" } });
    await new Promise((r) => setImmediate(r));
    const prompt = String(f.built.at(-1)?.submitted[0] ?? "");
    expect(prompt).toMatch(/uncommitted|working tree/i);
    expect(prompt).toContain("ReportFindings");
  });

  it("works for a FLEET-origin target — the target's engine is never touched", async () => {
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo/fleet", "fleet");
    const id = send("review/start", { threadId: t, target: { type: "uncommittedChanges" } });
    await new Promise((r) => setImmediate(r));
    expect(replyTo(id)?.error).toBeUndefined();
    expect(replyTo(id)?.result?.reviewThreadId).toBeTruthy();
  });

  it("refuses an unknown threadId with THREAD_NOT_FOUND", async () => {
    const srv = boot(factory());
    const id = send("review/start", { threadId: "th_nope", target: { type: "uncommittedChanges" } });
    await new Promise((r) => setImmediate(r));
    expect(replyTo(id)?.error?.code).toBe(ERR.THREAD_NOT_FOUND);
  });
});
```

**Note for the implementer:** `addRecord` above uses `srv.registry.set(...)`; check the registry's actual
insert seam (`registry.ts`) and match `shell-command.test.ts`'s hand-built-record helper exactly rather
than inventing one. If the real helper differs, follow the real one — this block is the assertions'
contract, not a licence to add a registry API.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/review-start.test.ts`
Expected: FAIL — `review/start` is not a registered method.

- [ ] **Step 3: Write the handler**

Create `src/appserver/review.ts`. Structure (fill in against the real `startThread`/`beginTurn` signatures — read `server.ts` and `turns.ts` first):

```ts
// appserver/review.ts — `review/start` (M4). Codex's whole review REQUEST surface is one method
// (app-server-protocol/src/protocol/common.rs:908-912) reusing the ordinary turn lifecycle, and so is
// ours: no cancel, no list, no review-specific turn machinery.
//
// A REVIEW IS AN ORDINARY TURN ON A NEW THREAD. Detached delivery needs exactly one thing from the target
// thread — its CWD — so this never touches the target's engine, which is also why a fleet-origin thread
// can be reviewed as readily as an inProcess one (no entry in FLEET_UNSUPPORTED).
//
// INLINE IS REFUSED, NOT DEGRADED (D-M4-2). Codex's inline path runs a CHILD session and splices its
// events onto the parent turn by re-stamping ids (core/src/tasks/review.rs:95-181); the SDK gives us no
// way to re-stamp a child's events, and running the review as a plain turn on the caller's thread would
// contaminate the conversation — the very thing Codex's child session exists to prevent.
```

The handler body, in order:
1. `safeParse` → `ERR.INVALID_PARAMS` on failure.
2. `delivery === "inline"` → `ERR.INVALID_PARAMS`, message: `"delivery:inline is not supported yet — use delivery:detached, which runs the review on a new thread (reviewThreadId)"`.
3. Look up the target record → `ERR.THREAD_NOT_FOUND` if absent.
4. `const cwd = threadCwd(record)`.
5. `const resolved = await resolveReviewRange(parsed.data.target, cwd)`.
6. `const prompt = buildReviewPrompt(parsed.data.target, resolved)`.
7. Create the review thread via the same seam `thread/start` uses, with `cwd`.
8. Mark the record as a review record (a field on `ThreadRecord`, e.g. `reviewOf?: string`) so Task 6 knows to harvest and where to attribute.
9. Start the turn with `prompt` through the normal turn spine.
10. Reply `{ turn, reviewThreadId }`.

- [ ] **Step 4: Register the method**

In `src/appserver/server.ts`, import `reviewStart` and add to the handler table beside the M3 entries:

```ts
    "review/start": reviewStart,
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run test/unit/appserver/review-start.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/review.ts src/appserver/server.ts test/unit/appserver/review-start.test.ts
git commit -m "feat(as4): review/start — detached review thread at the target's cwd, inline refused"
```

---

### Task 6: `review/findings` notification, review item, and the prose fallback

**Files:**
- Modify: `src/appserver/review.ts` (harvest wiring), `src/appserver/turns.ts` **only if** the frame sink needs a hook — prefer wiring in `review.ts`
- Test: `test/unit/appserver/review-findings-wire.test.ts`

**Interfaces:**
- Consumes: `harvestFindings` (T4), the review record marker (T5).
- Produces: the `review/findings` notification — **add it to the notification catalog** so the drift gate counts it (Task 9).

**Behavior:**
- On each frame of a review turn, run `harvestFindings`. On a hit, broadcast `review/findings {threadId, turnId, findings, level?, unstructured: false}` and emit a review item into the item stream.
- On review-turn completion with **no** hit: broadcast `review/findings {threadId, turnId, findings: [], unstructured: true, prose}` where `prose` is the turn's assistant text. **Never** emit a bare empty array in this case — that is the silent-all-clear failure the spec forbids.
- An explicit `{findings: []}` report is `unstructured: false` with an empty array.
- **Harvest nested frames too, and the notification is ADDITIVE (D-M4-7).** Do NOT copy the
  `parent_tool_use_id` guard that `router.ts:213` uses for TodoWrite. That guard is right for a todo list —
  private working state a subagent must not attribute to the main turn — and wrong here: a reviewing agent
  may dispatch subagents, `ReportFindings` is written for that shape, and a finding from a subagent of the
  review is still a finding about the review's subject. Dropping them would produce a review that reports
  nothing while prose says otherwise — the same silent all-clear the fallback exists to prevent, arriving
  through a different door. Consequences to implement, not just to note: one notification per
  `ReportFindings` call (a client APPENDS; nothing here supersedes an earlier notification), and
  `sawReport` is set by ANY harvest, nested included, so the unstructured fallback fires only when
  literally nothing reported.

- [ ] **Step 1: Write the failing test**

Reuse Task 5's harness block verbatim (`mkSink`/`boot`/`factory`/`addRecord`/`send`/`parsed`) — the only
addition is driving frames into the review turn, which the `onFrame` member of the fake session in
`factory()` exposes: capture the emitted callback and call it with the assistant frame shapes from Task 4's
test. Assert on `parsed(lines)` filtered to `method === "review/findings"`.

```ts
// test/unit/appserver/review-findings-wire.test.ts
describe("review findings on the wire", () => {
  it("broadcasts review/findings with unstructured:false when ReportFindings is called", async () => {});
  it("distinguishes an EXPLICIT empty report (unstructured:false) from NO report (unstructured:true)", async () => {});
  it("carries the assistant prose on the unstructured fallback", async () => {});
  it("emits a review item so an items-only subscriber still sees the review", async () => {});
  it("does NOT harvest on a non-review thread's turn", async () => {});
  // D-M4-7, both halves: a subagent's report must reach the wire, and it must count as a report.
  it("broadcasts a SUBAGENT's ReportFindings (frame carries parent_tool_use_id)", async () => {});
  it("two reports in one turn broadcast TWICE — the notification is additive, not a replacement", async () => {});
  it("a subagent-only report suppresses the unstructured fallback", async () => {});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/review-findings-wire.test.ts`
Expected: FAIL — no `review/findings` notification is ever broadcast.

- [ ] **Step 3: Implement the wiring**

Harvest per frame; accumulate `sawReport` and the prose for the turn; on turn end, emit the fallback when `!sawReport`. Keep the whole of it inside `review.ts` — do not grow `turns.ts`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run test/unit/appserver/review-findings-wire.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/appserver/review.ts test/unit/appserver/review-findings-wire.test.ts
git commit -m "feat(as4): review/findings notification + review item, with an honest unstructured fallback"
```

---

### Task 7: The `elicitation` decision kind (types + outcome, fail-closed)

**Files:**
- Modify: `src/permissions/types.ts` (`DecisionKind`, `DecisionOutcome`)
- Modify: `src/appserver/schema/decisions.ts` (outcome union)
- Create: `src/appserver/elicitationMap.ts` (outcome ↔ `ElicitResult`)
- Test: `test/unit/appserver/elicitation-map.test.ts`

**Interfaces:**
- Produces: `outcomeToElicitResult(outcome: DecisionOutcome): ElicitResult` — consumed by Task 8.

**The rule that governs this task:** `OnElicitation` returning `null` sends **no response** and leaves the
MCP server hanging until it times out (`sdk.d.ts:1300-1310`). Every outcome — including the universal
system `{kind:"deny"}` that teardown settles every park with (`broker.ts:51`) — MUST map to a real
`ElicitResult`. There is no null path.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/elicitation-map.test.ts
import { describe, it, expect } from "vitest";
import { outcomeToElicitResult } from "../../../src/appserver/elicitationMap.js";

describe("outcomeToElicitResult — FAIL-CLOSED: never null", () => {
  it("maps an elicitation accept to action:accept with its content", () => {
    expect(outcomeToElicitResult({ kind: "elicitation_accept", content: { name: "ada" } }))
      .toEqual({ action: "accept", content: { name: "ada" } });
  });
  it("maps decline and cancel", () => {
    expect(outcomeToElicitResult({ kind: "elicitation_decline" })).toEqual({ action: "decline" });
    expect(outcomeToElicitResult({ kind: "elicitation_cancel" })).toEqual({ action: "cancel" });
  });
  it("maps the UNIVERSAL SYSTEM DENY to decline — the teardown path must answer, not hang", () => {
    expect(outcomeToElicitResult({ kind: "deny" })).toEqual({ action: "decline" });
  });
  it("maps every other outcome kind to a real result rather than returning null", () => {
    for (const o of [
      { kind: "allow_once" as const },
      { kind: "allow_always" as const },
      { kind: "question_answer" as const, answers: {} },
    ]) {
      const r = outcomeToElicitResult(o as never);
      expect(r).toBeTruthy();
      expect(["accept", "decline", "cancel"]).toContain(r.action);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/elicitation-map.test.ts`
Expected: FAIL — module not found / kinds do not exist.

- [ ] **Step 3: Extend the kinds**

In `src/permissions/types.ts`:

```ts
export type DecisionKind = "permission" | "question" | "plan" | "elicitation";
```

and add to `DecisionOutcome`:

```ts
  /** MCP elicitation (M4). Mirrors MCP's own ElicitResult action enum — `content` is only meaningful on
   *  accept, and only for `mode:"form"` requests (an url-mode elicitation has nothing to fill in). */
  | { kind: "elicitation_accept"; content?: Record<string, string | number | boolean | string[]> }
  | { kind: "elicitation_decline" }
  | { kind: "elicitation_cancel" }
```

Mirror the three in `src/appserver/schema/decisions.ts`'s `decisionOutcomeParams` union, and add
`elicitation` to the kind→valid-answers table at the top of `broker.ts` (the `deny` family must stay valid
for it, since teardown settles every kind that way).

- [ ] **Step 4: Write the mapper**

```ts
// appserver/elicitationMap.ts — a settled decision → the MCP result the SDK owes its server.
//
// FAIL-CLOSED IS THE WHOLE POINT. `OnElicitation` returning null sends NO response (sdk.d.ts:1300-1310):
// the MCP server is left waiting until it times out, which for a `mode:"url"` auth elicitation means a
// user staring at a browser tab that never resolves. So every outcome maps to a real ElicitResult, and the
// default is `decline` rather than a throw — including the universal system `{kind:"deny"}` that broker
// teardown settles every park with (broker.ts:51), which is exactly the path that would otherwise hang a
// server when a thread closes with an elicitation still parked.
import type { DecisionOutcome } from "../permissions/types.js";
import type { ElicitationResult } from "@anthropic-ai/claude-agent-sdk";

export function outcomeToElicitResult(outcome: DecisionOutcome): ElicitationResult {
  switch (outcome.kind) {
    case "elicitation_accept": return { action: "accept", ...(outcome.content ? { content: outcome.content } : {}) };
    case "elicitation_cancel": return { action: "cancel" };
    // decline, deny, and every non-elicitation kind that can reach a park (teardown's system deny above
    // all) share one answer: a well-formed refusal the MCP server can act on immediately.
    default: return { action: "decline" };
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run test/unit/appserver/elicitation-map.test.ts && npm run typecheck`
Expected: PASS. Fix any exhaustiveness errors the new `DecisionKind` member surfaces in existing `switch`es — **make them explicit, never silence with a cast**.

- [ ] **Step 6: Run the full decisions suite (this task widens a shared union)**

Run: `npx vitest run test/unit/appserver`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/permissions/types.ts src/appserver/schema/decisions.ts src/appserver/elicitationMap.ts src/appserver/broker.ts test/unit/appserver/elicitation-map.test.ts
git commit -m "feat(as4): elicitation decision kind — fail-closed outcome mapping, never null"
```

---

### Task 8: Wire `onElicitation` into the park

**Files:**
- Create: `src/appserver/elicitation.ts`
- Modify: the app server's session-config seam (where `startThread` builds the session config in `server.ts`)
- Test: `test/unit/appserver/elicitation-park.test.ts`

**Interfaces:**
- Consumes: `outcomeToElicitResult` (T7), the broker's park (`broker.ts`).
- **Park keying:** `ElicitationRequest` carries **no `toolUseId`**, and the park registry is keyed by one
  (`broker.ts:39`). Synthesize a stable key from the callback's `requestId` (e.g. `elicit:<requestId>`) —
  it is unique per request and is the value an out-of-band response would have to echo.

- [ ] **Step 1: Write the failing test**

Reuse Task 5's harness block. Capture the `onElicitation` the server builds by asserting on the config
passed to `factory()`'s `sessionFactory` (it is a field of that config, exactly as `canUseTool` is), then
invoke it directly with an `ElicitationRequest` and a `requestId`, and answer the resulting park over the
wire with `decision/respond`. The teardown case calls `thread/close` while the returned promise is still
pending and asserts what it resolves to — **the assertion is `{action:"decline"}`, and a `null` resolution
is the specific failure this test exists to catch.**

```ts
// test/unit/appserver/elicitation-park.test.ts
describe("MCP elicitation parks as a decision", () => {
  it("parks with kind 'elicitation' and announces decision/requested", async () => {});
  it("carries serverName, message, mode and requestedSchema onto the parked entry", async () => {});
  it("resolves the onElicitation promise with {action:'accept', content} when answered accept", async () => {});
  it("resolves with {action:'decline'} when answered decline", async () => {});
  it("resolves with {action:'decline'} — NOT null — when the thread is torn down while parked", async () => {});
  it("keys the park off requestId, since an ElicitationRequest carries no toolUseId", async () => {});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/elicitation-park.test.ts`
Expected: FAIL — nothing wires `onElicitation`.

- [ ] **Step 3: Implement the bridge**

`makeOnElicitation(srv, threadId): OnElicitation` — parks the request as a `kind:"elicitation"` decision,
awaits the settle, and returns `outcomeToElicitResult(outcome)`. Never returns `null`. Wire it into the
session config the app server builds for every thread it starts (alongside `canUseTool`).

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run test/unit/appserver/elicitation-park.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/appserver/elicitation.ts src/appserver/server.ts test/unit/appserver/elicitation-park.test.ts
git commit -m "feat(as4): MCP elicitation parks as a decision and always answers its server"
```

---

### Task 9: Scorecard rows, schema artifacts, drift gate

**Files:**
- Modify: `CC-to-SDK/docs/parity/appserver.md` (rows for `review/start`, the `review/findings` notification, the elicitation kind)
- Modify: `CC-to-SDK/docs/parity/coverage.md` (domain 10 entry)
- Regenerate: the app-server JSON-Schema artifacts (`--emit-schema`; see `harness/schema/json/stable/appserver.json`)

- [ ] **Step 1: Register `review/start` in `methodSchemas`, THEN regenerate**

**Plan gap found during Task 1 — this step exists because of it.** `src/appserver/schema/index.ts` is a
method-schema REGISTRY, not a re-export barrel, and the generated artifacts are emitted from it. Dispatch
reads the handler table in `server.ts` (Task 5), so the method *works* without an entry here — but it would
be absent from `schema/json/stable/appserver.json`, failing spec acceptance #6 and this task's count check.
It lands HERE rather than in Task 1 deliberately: registering a method no handler answers yet turns
`schemaGen.test.ts` and `exports.test.ts` red for Tasks 2–8.

Add the entry alongside the existing ones (match their exact shape):

```ts
  "review/start": { params: reviewStartParams },
```

Then run the emit path the M2b/M3 tasks used (`--emit-schema`) and confirm the review types appear.

Also remove the unused `export * from "./review.js"` line Task 1 added to that file if it still has no
consumer — Tasks 2/3/5 import from `schema/review.js` directly, and a registry file should not carry a
barrel line nothing reads.

- [ ] **Step 2: Add the scorecard rows**

One row per new method/notification, status `shipped(M4)`, with the same column discipline the M3 rows use (origin scope: `review/start` is `both` — it never touches the target's engine).

- [ ] **Step 3: Run the drift gate**

Run (from `CC-to-SDK/`): `node scripts/drift-check.mjs`
Expected: every walked token has a row; no staleness; the registered-method count has risen by exactly 1
(58 → 59) and the notification count by exactly 1.

- [ ] **Step 4: Commit**

Stage the registry edit from Step 1 alongside the docs — the Global Constraints make this list binding, so a
file missing from it is a file left uncommitted. Both artifacts are listed because the emitter writes
`stable` and `experimental` on every run (`schema/emit.ts` splits on `entry.experimental`); if the
experimental one comes back byte-identical, `git add` on it is simply a no-op.

```bash
git add CC-to-SDK/harness/src/appserver/schema/index.ts CC-to-SDK/docs/parity/appserver.md CC-to-SDK/docs/parity/coverage.md CC-to-SDK/harness/schema/json/stable/appserver.json CC-to-SDK/harness/schema/json/experimental/appserver.json
git commit -m "feat(as4): register review/start in methodSchemas; scorecard rows + schema artifacts"
```

---

### Task 10: Final verification — the spec's acceptance, live

**Files:**
- Create: `test/live/appserver-m4-acceptance.test.ts`

Executes the spec's acceptance section as written. **Keyed — the controller runs this, not the implementer.**
Guard it exactly as the M3 acceptance does (skip cleanly without a key; fail fast if `dist/` is older than
`src/`).

- [ ] **Step 1: Write the acceptance legs**

One leg per numbered acceptance item in the spec:
1. `uncommittedChanges` in a dirty scratch repo → `{turn, reviewThreadId}`, then a `review/findings`
   notification whose findings name files that exist.
2. A planted off-by-one is found, anchored to that file, with a `failure_scenario` naming concrete inputs.
3. `baseBranch` reviews from the merge-base — a file changed only on the base branch yields no finding.
4. A review that ends with no `ReportFindings` call yields `findings: []` **and** `unstructured: true` with
   the prose retained.
5. `delivery: "inline"` is refused with a message naming detached.
6. The drift gate is green (run it as a step, assert exit 0).
7. **Elicitation round-trips through the app server** (spec acceptance 7, added rev 3). Create
   `test/live/fixtures/elicit-stdio-server.ts` — a ~15-line stdio MCP server with one tool that calls
   `server.server.elicitInput(...)` and returns the result in its text content. Copy the shape from
   `CC-to-SDK/probes/lib/elicit-stdio-server.ts` rather than importing across the workspace boundary.
   Then, entirely over the wire: start a thread with that server registered, prompt the model to call the
   tool, await a `decision/requested` whose `kind` is `elicitation`, answer it with `decision/respond`
   carrying an accept plus content, and assert the accepted content appears in the tool's own result —
   which is what proves the answer travelled back *into* the MCP server rather than merely settling our
   park. **It MUST be a stdio server**: an in-process SDK-type server answers "Client does not support
   form elicitation" (probe 43), and that is the whole reason probe 43b exists. The fail-closed teardown
   case is NOT a leg here — it lives in Task 8's unit tests, where a torn-down park can be forced
   deterministically instead of raced.

- [ ] **Step 2: Run the full unit suite**

Run: `npx vitest run test/unit`
Expected: all pass, count risen by this milestone's new tests.

- [ ] **Step 3: Run the keyed acceptance (controller only)**

Run from `harness/`: `set -a; . ../.env; set +a; npx vitest run test/live/appserver-m4-acceptance.test.ts`
Expected: every leg green.

- [ ] **Step 4: Commit**

```bash
git add test/live/appserver-m4-acceptance.test.ts
git commit -m "test(as4): M4 acceptance — the spec's review and elicitation obligations, live"
```

---

## After the plan

Route findings that changed design understanding into the spec's living tail (Decision Log / Surprises),
per doperpowers:execspec. Then the closing whole-branch external review — codex native review via
doperpowers:codex-companion `review --base <merge-base> --model gpt-5.6-sol` — which has caught real
cross-boundary defects both internal review layers missed on M1, M2 and M3, and a fix-wave regression on
M3. It is a fixed step, not a formality; **the fix wave it produces gets its own review.**
