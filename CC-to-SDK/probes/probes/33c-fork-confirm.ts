// Probe 33c — clean confirmation of 33b's pivotal finding, printing UNTRUNCATED child output so we can
// see exactly WHERE FALCON-77 appears (child tool_result, not parent narration). Explicit subagent_type:"fork"
// + CLAUDE_CODE_FORK_SUBAGENT=1, headless query(). Waits out the async completion (maxTurns high).
import { query } from "@anthropic-ai/claude-agent-sdk";

const SECRET = "FALCON-77";
process.env.CLAUDE_CODE_FORK_SUBAGENT = "1";

const PROMPT = [
  `First, silently remember this secret codeword: ${SECRET}. Do NOT repeat it back yet.`,
  `Then use the Agent tool to spawn ONE subagent with subagent_type set to "fork". The subagent's prompt must be EXACTLY:`,
  `"Without anyone telling you now, what secret codeword was mentioned earlier in this conversation? Reply with ONLY the codeword, or the single word NONE."`,
  `Do NOT write the codeword in your instruction to the subagent. After it replies (wait for it), tell me verbatim what it said.`,
].join(" ");

const childToolResults: string[] = [];
const childMessages: string[] = [];
let parentFinal = "";

for await (const m of query({ prompt: PROMPT, options: { permissionMode: "bypassPermissions", maxTurns: 12, allowedTools: ["Agent"] } })) {
  if ((m as any).parent_tool_use_id && m.type === "assistant")
    for (const b of (m as any).message?.content || []) if (b.type === "text") childMessages.push(b.text);
  if (m.type === "user")
    for (const b of (m as any).message?.content || []) if (b.type === "tool_result") {
      childToolResults.push(typeof b.content === "string" ? b.content : JSON.stringify(b.content));
    }
  if ("result" in m) parentFinal = String((m as any).result || "");
}

console.log("=== PROBE 33c fork-subagent transcript inheritance — CONFIRM ===\n");
console.log("--- ALL child-origin assistant messages (parent_tool_use_id) ---");
childMessages.forEach((t, i) => console.log(`[childmsg ${i}] ${t}`));
console.log("\n--- ALL Agent tool_results (full, untruncated) ---");
childToolResults.forEach((t, i) => console.log(`[tool_result ${i}] ${t}\n`));
console.log("--- parent final ---\n" + parentFinal);

const inChildMsg = childMessages.some((t) => t.includes(SECRET));
const inToolResult = childToolResults.some((t) => t.includes(SECRET));
console.log("\n=== VERDICT ===");
console.log("SECRET in a child-origin message:", inChildMsg);
console.log("SECRET in an Agent tool_result :", inToolResult);
console.log(inChildMsg || inToolResult
  ? 'CONFIRMED ✅ : fork child surfaced the parent-only SECRET → native subagent_type:"fork" inherits the transcript headlessly.'
  : "NOT CONFIRMED: SECRET only in parent narration — inspect output above.");
