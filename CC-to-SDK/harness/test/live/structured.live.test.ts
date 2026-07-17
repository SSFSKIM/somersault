// W4.2 live: runStructured round-trips a Zod schema through the real SDK (probe-53 shape).
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runStructured } from "../../src/structured/run.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("runStructured (live)", () => {
  it("returns typed, schema-validated data", async () => {
    const schema = z.object({ answer: z.number(), word: z.string() });
    const data = await runStructured(schema, "What is 2+3? Give the number and the English word for it.", {
      model: "claude-sonnet-4-6", disableProjectContext: true, maxTurns: 3,
    });
    expect(data.answer).toBe(5);
    expect(data.word.toLowerCase()).toContain("five");
  }, 120_000);
});
