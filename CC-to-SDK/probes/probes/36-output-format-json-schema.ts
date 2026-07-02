// probes/probes/36-output-format-json-schema.ts
// QUESTION: does options.outputFormat {type:'json_schema', schema} work headlessly (streaming input mode)?
// sdk.d.ts declares it (OutputFormat = JsonSchemaOutputFormat, sdk.d.ts:1691-1697,2030) — declared ≠ reachable.
// Consumed by: plan Task 8 (appserver outputSchema→outputFormat wiring) and Task 13 (review prompts fallback).
// VERDICT (2026-07-03, claude-sonnet-5, OAuth): **WIRED — with a field-location catch.**
//   - options.outputFormat {type:'json_schema', schema} is accepted headlessly (init ok, no option error).
//   - The schema-conforming payload arrives as a PARSED OBJECT in `result.structured_output`;
//     `result.result` remains free prose. So consumers must read structured_output, not parse result text.
//   - maxTurns:1 starves it (subtype=error_max_turns, result undefined); give the turn headroom.
//   - PLUMBING NOTE: harness Session.readLoop resolves submit() with {result: mm.result} only — it DROPS
//     structured_output. Task 8 must add it (additive): resolve({result, structuredOutput: mm.structured_output}).
import { query } from "@anthropic-ai/claude-agent-sdk";

const schema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["approve", "needs-attention"] },
    summary: { type: "string" },
  },
  required: ["verdict", "summary"],
  additionalProperties: false,
};

async function* prompts() {
  yield {
    type: "user" as const,
    message: { role: "user" as const, content: "Review this change: `const x = 1`. Reply per the output schema." },
    parent_tool_use_id: null,
  };
}

const q = query({
  prompt: prompts(),
  options: { outputFormat: { type: "json_schema", schema }, model: "claude-sonnet-5", maxTurns: 4 } as any,
});

for await (const m of q as any) {
  if (m.type === "system" && m.subtype === "init") console.log("init ok, model =", m.model);
  if (m.type === "result") {
    console.log("result.subtype =", m.subtype);
    console.log("result.result =", JSON.stringify(m.result)?.slice(0, 500));
    console.log("structured_output =", JSON.stringify((m as any).structured_output ?? null)?.slice(0, 500));
    try {
      const parsed = JSON.parse(typeof m.result === "string" ? m.result : "null");
      console.log("parses as JSON:", !!parsed, "| keys:", parsed && Object.keys(parsed).join(","));
    } catch {
      console.log("parses as JSON: false");
    }
  }
}
