// Probe 44 — ReportFindings tool (Wave 2), headlessly.
//
// Declared surface: sdk-tools.d.ts ReportFindingsInput {level?, findings[≤32]: {file, line?, summary,
// failure_scenario, category?, verdict?, outcome?}}; ReportFindingsOutput. Probe 40 inventory: PRESENT.
// Design-blocking questions:
//   1. Does a forced ReportFindings call SUCCEED headlessly (tool_result, not error)?
//   2. What does the tool_result / any side-channel frame look like (how would a harness consume it)?
import { runProbe, brief } from "../lib/runProbe.ts";

console.log("=== PROBE 44 ReportFindings ===");
const { messages, result } = await runProbe(
  `You MUST call the ReportFindings tool exactly once with this input: level "low", findings = a single finding with file "src/example.ts", line 3, summary "Probe finding: placeholder defect for tool-reachability testing", failure_scenario "None — synthetic probe input", category "correctness". After the tool call returns, reply with exactly: REPORTED`,
  { model: "claude-sonnet-4-6", maxTurns: 3, settingSources: [] },
);
let used = false, toolResult = "";
for (const m of messages as any[]) {
  if (m.type === "assistant") for (const b of m.message?.content ?? [])
    if (b.type === "tool_use") { console.log("[tool_use]", b.name, brief(b.input, 300)); if (b.name === "ReportFindings") used = true; }
  if (m.type === "user") for (const b of m.message?.content ?? [])
    if (b.type === "tool_result") { toolResult = typeof b.content === "string" ? b.content : JSON.stringify(b.content); console.log("[tool_result]", brief(toolResult, 400)); }
  if (!["assistant", "user", "system", "result", "stream_event"].includes(m.type) || (m.type === "system" && m.subtype !== "init"))
    console.log("[frame]", m.type, m.subtype ?? "", brief(m, 300));
}
console.log("[result]", result?.subtype, "|", brief(result?.result, 120));
console.log("\n=== VERDICT ===");
if (used && !toolResult.toLowerCase().includes("error")) console.log("REACHABLE ✅ — ReportFindings callable headlessly; result:", brief(toolResult, 200));
else if (used) console.log("CALLED BUT ERRORED ⚠️ —", brief(toolResult, 300));
else console.log("NOT CALLED ❌ — model never invoked ReportFindings (tool missing or refused).");
process.exit(0);
