import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPromptTemplate, interpolateTemplate } from "../plugins/claude-companion/scripts/lib/prompts.mjs";
import { makeTempDir } from "./helpers.mjs";

test("interpolateTemplate substitutes multiple known {{VARS}}", () => {
  assert.equal(
    interpolateTemplate("Hello {{NAME}}, you are {{AGE}}.", { NAME: "Ada", AGE: "36" }),
    "Hello Ada, you are 36."
  );
});

test("interpolateTemplate replaces an unknown {{TOKEN}} (matching the pattern) with empty string", () => {
  assert.equal(interpolateTemplate("a {{MISSING}} b", { OTHER: "1" }), "a  b");
});

test("interpolateTemplate leaves tokens that don't match [A-Z_]+ intact", () => {
  // lowercase / mixed-case / digit-containing tokens are not matched by the /\{\{([A-Z_]+)\}\}/g regex
  assert.equal(interpolateTemplate("{{lower}} {{Mixed}} {{V1}}", { lower: "x" }), "{{lower}} {{Mixed}} {{V1}}");
});

test("interpolateTemplate ignores inherited (non-own) properties", () => {
  const variables = Object.create({ INHERITED: "nope" });
  assert.equal(interpolateTemplate("{{INHERITED}}", variables), "");
});

test("loadPromptTemplate reads <rootDir>/prompts/<name>.md", () => {
  const rootDir = makeTempDir();
  fs.mkdirSync(path.join(rootDir, "prompts"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "prompts", "greeting.md"), "Hi {{NAME}}!", "utf8");
  const template = loadPromptTemplate(rootDir, "greeting");
  assert.equal(template, "Hi {{NAME}}!");
  assert.equal(interpolateTemplate(template, { NAME: "World" }), "Hi World!");
});

// Live-testing feedback: adversarial-review.md only said "matching the provided schema" without
// ever inlining it, unlike claude-review.md's explicit "no prose before or after" + literal shape
// -- the model filled the gap with a plausible-looking but wrong shape (decision/no next_steps
// instead of verdict/next_steps), which then failed structured-output parsing outright. Both
// review prompts share one schema (schemas/review-output.schema.json); this pins them to the same
// strict, fully-inlined contract so they can't silently drift apart again.
test("claude-review.md and adversarial-review.md both inline the same strict JSON output contract", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../plugins/claude-companion");
  const claudeReview = fs.readFileSync(path.join(root, "prompts", "claude-review.md"), "utf8");
  const adversarialReview = fs.readFileSync(path.join(root, "prompts", "adversarial-review.md"), "utf8");

  for (const text of [claudeReview, adversarialReview]) {
    assert.match(text, /Output STRICTLY a single JSON object.*no prose before or after/);
    assert.match(text, /"verdict":"approve"\|"needs-attention"/);
    assert.match(text, /"next_steps":\["\.\.\."\]/);
  }
});
