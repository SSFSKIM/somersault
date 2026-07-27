// Probe 66 — ExitPlanMode under permissionMode:"plan": deny-with-feedback loops, allow proceeds — and
// who flips the mode afterwards?
//
// Goal B premise check. Swarm's planApproval.ts assumes: plan mode routes ExitPlanMode through
// canUseTool; deny(message) makes the model keep planning; allow lets the turn proceed; the HARNESS
// owns the post-approval mode switch (swarm has postApprovalMode). None of that was ever probed in the
// main-session shape (swarm runs teammates). Also: after allow, does the CLI keep enforcing plan-mode
// read-only (i.e. must we setPermissionMode before edits can run)?
import { query } from "@anthropic-ai/claude-agent-sdk";

let exitCalls = 0;
const toolsConsulted: string[] = [];

const q = query({
  prompt:
    "Plan how to create a file named hello.txt containing 'hi'. Keep the plan to 2 short steps. " +
    "When the plan is ready, call ExitPlanMode. If approved, immediately create the file with the Write tool.",
  options: {
    model: "claude-haiku-4-5-20251001",
    maxTurns: 8,
    settingSources: [],
    permissionMode: "plan",
    cwd: process.env.PROBE_CWD ?? process.cwd(),
    canUseTool: async (toolName, input) => {
      toolsConsulted.push(toolName);
      console.log(`[canUseTool] ${toolName} input=${JSON.stringify(input).slice(0, 300)}`);
      if (toolName === "ExitPlanMode") {
        exitCalls++;
        if (exitCalls === 1) {
          console.log("[canUseTool] DENY with feedback (keep planning)");
          return { behavior: "deny", message: "Revise the plan: hello.txt must contain 'hello world' instead. Then call ExitPlanMode again." } as any;
        }
        console.log("[canUseTool] ALLOW (plan approved)");
        return { behavior: "allow", updatedInput: input } as any;
      }
      return { behavior: "allow", updatedInput: input } as any;
    },
  },
});

console.log("=== PROBE 66 ExitPlanMode approval loop ===");
let resultSubtype = "", sawWriteToolUse = false, sawWriteResult = false;
try {
  for await (const m of q) {
    const mm = m as any;
    if (mm.type === "assistant") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_use") {
          console.log(`[tool_use] ${b.name} ${JSON.stringify(b.input).slice(0, 200)}`);
          if (b.name === "Write") sawWriteToolUse = true;
        }
      }
    }
    if (mm.type === "user") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_result") {
          console.log(`[tool_result] is_error=${b.is_error} ${JSON.stringify(b.content).slice(0, 250)}`);
          if (sawWriteToolUse && !b.is_error) sawWriteResult = true;
        }
      }
    }
    if (mm.type === "system" && mm.subtype !== "init") console.log(`[system/${mm.subtype}] ${JSON.stringify(mm).slice(0, 200)}`);
    if ("result" in mm) { resultSubtype = mm.subtype; break; }
  }
} catch (e: any) { console.log("STREAM THREW:", e?.message); }

console.log("");
console.log(`ExitPlanMode calls   : ${exitCalls} (2 expected: deny→revise→allow)`);
console.log(`tools consulted      : ${toolsConsulted.join(", ")}`);
console.log(`Write attempted/ran  : ${sawWriteToolUse}/${sawWriteResult}  (ran=false ⇒ plan mode still enforced after allow ⇒ WE own the mode flip)`);
console.log(`result subtype       : ${resultSubtype}`);
