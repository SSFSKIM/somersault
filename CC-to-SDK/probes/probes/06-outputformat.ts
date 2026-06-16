// Probe 06 — structured output via outputFormat json_schema.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const messages: any[] = [];
let result: any;

for await (const m of query({
  prompt: "Return JSON with answer=hello",
  options: {
    maxTurns: 3,
    permissionMode: "bypassPermissions",
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
      },
    },
  },
})) {
  messages.push(m);
  if ("result" in m) result = m;
}

console.log("=== PROBE 06 outputFormat ===");
console.log("result.subtype:", result?.subtype);
// Structured result may surface under result.structured_output / structuredOutput / parsed / result.
const candidates = {
  structured_output: result?.structured_output,
  structuredOutput: result?.structuredOutput,
  parsed: result?.parsed,
  result: result?.result,
};
console.log("result keys:", brief(Object.keys(result || {})));
for (const [k, v] of Object.entries(candidates)) {
  if (v !== undefined) console.log(`result.${k}:`, brief(v, 300));
}

// Find an object (or parseable string) with answer === 'hello'.
function extractAnswer(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "object" && typeof v.answer === "string") return v.answer;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      if (p && typeof p.answer === "string") return p.answer;
    } catch { /* not json */ }
  }
  return undefined;
}
const answer =
  extractAnswer(result?.structured_output) ??
  extractAnswer(result?.structuredOutput) ??
  extractAnswer(result?.parsed) ??
  extractAnswer(result?.result);

console.log("extracted answer:", JSON.stringify(answer));
const pass = result?.subtype === "success" && answer === "hello";
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
