import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path";
import { loadPromptTemplate, interpolateTemplate } from "../plugins/claude/scripts/lib/prompts.mjs";
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
