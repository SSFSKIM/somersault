import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeReviewPayload,
  parseStructuredOutput,
  renderReviewResult,
  renderStatusReport,
  renderStoredJobResult
} from "../plugins/claude/scripts/lib/render.mjs";

test("parseStructuredOutput parses valid JSON", () => {
  const result = parseStructuredOutput('{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}');
  assert.equal(result.parseError, null);
  assert.equal(result.parsed.verdict, "approve");
});

test("parseStructuredOutput returns a parseError for non-JSON text (the raw-fallback trigger)", () => {
  const result = parseStructuredOutput("final text");
  assert.equal(result.parsed, null);
  assert.ok(result.parseError);
  assert.equal(result.rawOutput, "final text");
});

test("parseStructuredOutput falls back to fallback.failureMessage when rawOutput is empty", () => {
  const result = parseStructuredOutput("", { failureMessage: "no output at all" });
  assert.equal(result.parsed, null);
  assert.equal(result.parseError, "no output at all");
});

test("normalizeReviewPayload trims strings and defaults malformed findings", () => {
  const normalized = normalizeReviewPayload({
    verdict: "  needs-attention  ",
    summary: "  something  ",
    findings: [{ severity: "high", title: "t", body: "b", file: "f.js", line_start: 3, line_end: 1 }, {}],
    next_steps: ["  step one  ", "", 42]
  });
  assert.equal(normalized.verdict, "needs-attention");
  assert.equal(normalized.summary, "something");
  assert.equal(normalized.findings[0].line_end, 3, "line_end below line_start collapses to line_start");
  assert.equal(normalized.findings[1].severity, "low");
  assert.equal(normalized.findings[1].title, "Finding 2");
  assert.deepEqual(normalized.next_steps, ["step one"]);
});

test("renderReviewResult: schema-valid payload renders findings-first markdown sorted by severity, labeled Claude", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "needs-attention",
        summary: "Two issues found.",
        findings: [
          { severity: "low", title: "Nit", body: "Minor.", file: "b.js", line_start: 2, line_end: 2, recommendation: "" },
          { severity: "critical", title: "SQL injection", body: "Unescaped input.", file: "a.js", line_start: 10, line_end: 12, recommendation: "Use parameterized queries." }
        ],
        next_steps: ["Fix the injection."]
      },
      rawOutput: "irrelevant-once-parsed",
      parseError: null
    },
    { reviewLabel: "Review", targetLabel: "working tree diff" }
  );

  assert.match(output, /^# Claude Review/);
  assert.match(output, /Target: working tree diff/);
  assert.match(output, /Verdict: needs-attention/);
  const criticalIndex = output.indexOf("SQL injection");
  const lowIndex = output.indexOf("Nit");
  assert.ok(criticalIndex > -1 && lowIndex > -1 && criticalIndex < lowIndex, "critical finding must render before low finding");
  assert.match(output, /\(a\.js:10-12\)/);
  assert.match(output, /Recommendation: Use parameterized queries\./);
  assert.match(output, /Next steps:/);
});

test("renderReviewResult: non-JSON final text falls back to raw text (fake worker's plain 'final text')", () => {
  const parsed = parseStructuredOutput("final text");
  const output = renderReviewResult(parsed, { reviewLabel: "Adversarial Review", targetLabel: "working tree diff" });

  assert.match(output, /^# Claude Adversarial Review/);
  assert.match(output, /Claude did not return valid structured JSON\./);
  assert.match(output, /Raw final message:/);
  assert.match(output, /final text/);
});

test("renderReviewResult: valid JSON with the wrong shape reports a validation error, not a crash", () => {
  const output = renderReviewResult(
    {
      parsed: { verdict: "approve", summary: "Looks fine." },
      rawOutput: JSON.stringify({ verdict: "approve", summary: "Looks fine." }),
      parseError: null
    },
    { reviewLabel: "Review", targetLabel: "working tree diff" }
  );

  assert.match(output, /Claude returned JSON with an unexpected review shape\./);
  assert.match(output, /Missing array `findings`\./);
  assert.match(output, /Raw final message:/);
});

test("renderStoredJobResult prefers rendered output for structured review jobs and appends the rescue-tool resume affordance", () => {
  const output = renderStoredJobResult(
    {
      id: "review-123",
      status: "completed",
      title: "Claude Adversarial Review",
      jobClass: "review",
      threadId: "thr_123"
    },
    {
      threadId: "thr_123",
      rendered: "# Claude Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
      result: {
        result: { verdict: "needs-attention", summary: "One issue.", findings: [], next_steps: [] },
        rawOutput: '{"verdict":"needs-attention","summary":"One issue.","findings":[],"next_steps":[]}'
      }
    }
  );

  assert.match(output, /^# Claude Adversarial Review/);
  assert.doesNotMatch(output, /^\{/);
  assert.match(output, /Claude thread ID: thr_123/);
  assert.match(output, /Continue via the rescue tool with resume:true \(thread thr_123\)\./);
  assert.doesNotMatch(output, /codex resume/i);
});

test("renderStatusReport renders a Claude-branded status page without crashing", () => {
  const output = renderStatusReport({
    config: { stopReviewGate: true },
    running: [
      { id: "review-1", status: "running", kindLabel: "review", threadId: "thr_1", phase: "reviewing", elapsed: "5s" }
    ],
    latestFinished: { id: "advrev-2", status: "completed", kindLabel: "adversarial-review", threadId: "thr_2", duration: "10s" },
    recent: [],
    needsReview: true
  });

  assert.match(output, /^# Claude Status/);
  assert.match(output, /Review gate: enabled/);
  assert.match(output, /Active jobs:/);
  assert.match(output, /Claude Thread ID/);
  assert.match(output, /Continue via the rescue tool with resume:true \(thread thr_1\)\./);
  assert.match(output, /Latest finished:/);
  assert.match(output, /fresh Claude adversarial review/);
});
