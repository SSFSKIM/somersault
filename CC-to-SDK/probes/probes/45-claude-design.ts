// Probe 45 — ClaudeDesign tool (Wave 2), headlessly.
//
// Declared surface: sdk-tools.d.ts ClaudeDesignInput {operation: string ("list" first), arguments: {}}.
// Probe 40 inventory: ABSENT from the default headless tool list (DesignSync IS present, curiously).
// Design-blocking questions:
//   1. Confirm absence behaviorally: does the model see any ClaudeDesign tool at all?
//   2. Is DesignSync the surviving design surface? (log its self-reported schema; do NOT call it —
//      it may reach claude.ai.)
import { runProbe, brief } from "../lib/runProbe.ts";

console.log("=== PROBE 45 ClaudeDesign ===");
const { messages, result } = await runProbe(
  `Two steps. Step 1: if you have a tool named exactly ClaudeDesign, call it once with operation "list" and arguments {}. If you do NOT have it, do not call anything for step 1. Step 2: reply with a line "CLAUDEDESIGN: yes|no" saying whether the ClaudeDesign tool is in your tool list, and a line "DESIGNSYNC: <one-sentence description of your DesignSync tool's input schema, from its tool definition, or 'absent'>".`,
  { model: "claude-sonnet-4-6", maxTurns: 3, settingSources: [] },
);
for (const m of messages as any[]) {
  if (m.type === "assistant") for (const b of m.message?.content ?? []) {
    if (b.type === "tool_use") console.log("[tool_use]", b.name, brief(b.input, 200));
    if (b.type === "text") console.log("[text]", brief(b.text, 500));
  }
  if (m.type === "user") for (const b of m.message?.content ?? [])
    if (b.type === "tool_result") console.log("[tool_result]", brief(typeof b.content === "string" ? b.content : JSON.stringify(b.content), 300));
}
console.log("[result]", result?.subtype, "|", brief(result?.result, 400));
process.exit(0);
