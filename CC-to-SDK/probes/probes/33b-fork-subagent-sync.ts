// Probe 33b — tighten probe 33's two confounds before declaring native fork-subagent dead:
//   (1) In 33, the fork-ON child launched ASYNC/background, so the captured "NONE" was the parent's
//       (possibly premature) narration, not the child's real answer.
//   (2) The installed sdk-tools.d.ts:423 implies the 0.3.178 trigger is an EXPLICIT subagent_type:"fork"
//       (the web docs describe a later "omit the type" trigger). Test the explicit form too.
// Both conditions force SYNCHRONOUS dispatch (run_in_background:false) so we capture the child's actual
// tool_result. Same SECRET discriminator: a transcript-inheriting child reports FALCON-77; clean-slate → NONE.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const SECRET = "FALCON-77";

function parentPrompt(useForkType: boolean): string {
  const typeClause = useForkType
    ? `Call the Agent tool with description, prompt, subagent_type set to "fork", and run_in_background set to false (you MUST wait for the result, do not background it).`
    : `Call the Agent tool with ONLY description and prompt, and run_in_background set to false (you MUST wait for the result, do not background it). Do NOT set subagent_type.`;
  return [
    `First, silently remember this secret codeword: ${SECRET}. Do NOT repeat it back yet.`,
    `Then use the Agent tool to spawn exactly ONE subagent and WAIT for it. ${typeClause}`,
    `The subagent's prompt must be EXACTLY: "Without anyone telling you now, what secret codeword was mentioned earlier in this conversation? Reply with ONLY the codeword, or the single word NONE if you have none."`,
    `Do NOT write the codeword anywhere in your instruction to the subagent.`,
    `After it replies, tell me verbatim what it said.`,
  ].join(" ");
}

async function run(label: string, useForkType: boolean) {
  process.env.CLAUDE_CODE_FORK_SUBAGENT = "1"; // env on for both; vary only the trigger form
  let spawned = false, leaked = false, childKnew = false, async = false;
  const types: any[] = [], childTexts: string[] = [];
  let result: any;
  for await (const m of query({ prompt: parentPrompt(useForkType), options: { permissionMode: "bypassPermissions", maxTurns: 8, allowedTools: ["Agent"] } })) {
    if (m.type === "assistant") {
      for (const b of (m as any).message?.content || []) {
        if (b.type === "tool_use" && String(b.name).toLowerCase().includes("agent")) {
          spawned = true; types.push((b.input as any)?.subagent_type);
          if (JSON.stringify(b.input || {}).includes(SECRET)) leaked = true;
        }
      }
    }
    if ((m as any).parent_tool_use_id && m.type === "assistant")
      for (const b of (m as any).message?.content || []) if (b.type === "text") childTexts.push("[child] " + b.text);
    if (m.type === "user")
      for (const b of (m as any).message?.content || []) if (b.type === "tool_result") {
        const c = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        childTexts.push("[tool_result] " + c);
        if (/Async agent launched|working in the background/i.test(c)) async = true;
      }
    if ("result" in m) result = m;
  }
  childKnew = childTexts.some((t) => t.includes(SECRET));
  console.log(`\n--- ${label} ---`);
  console.log("spawned:", spawned, "| subagent_type:", JSON.stringify(types), "| dispatched async:", async, "| leaked:", leaked);
  console.log("child output:", brief(childTexts, 420));
  console.log(">> CHILD KNEW SECRET:", childKnew);
  console.log("parent final:", brief(String(result?.result || ""), 120));
  return { spawned, leaked, childKnew, async };
}

console.log("=== PROBE 33b fork-subagent SYNC + explicit-type (headless) ===");
const forkType = await run('subagent_type:"fork", sync', true);
const omitted = await run("subagent_type omitted, sync", false);

console.log("\n=== VERDICT ===");
const valid = (r: any) => r.spawned && !r.leaked && !r.async;
if (forkType.childKnew && valid(forkType))
  console.log('NATIVE FORK REACHABLE ✅ via explicit subagent_type:"fork" (sync). Child inherited parent transcript.');
else if (omitted.childKnew && valid(omitted))
  console.log("NATIVE FORK REACHABLE ✅ via omitted type (sync). Child inherited parent transcript.");
else if (!forkType.childKnew && !omitted.childKnew && (valid(forkType) || valid(omitted)))
  console.log("NATIVE FORK NOT REACHABLE headlessly ❌ (confirmed, sync): both trigger forms gave a clean-slate child. → RECONSTRUCTED route (forkSession()+resume as a self-call tool).");
else console.log("INCONCLUSIVE: re-inspect (no valid synchronous run — async/leak/no-spawn).");
