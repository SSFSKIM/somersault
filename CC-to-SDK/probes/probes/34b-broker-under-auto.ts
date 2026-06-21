// probes/probes/34b-broker-under-auto.ts — confirms the B2 broker path fires under the PRODUCTION posture.
// Probe 34 proved the parked-handler mechanism under bypassPermissions. The Director's default is
// approvals_reviewer=auto_review → permissionMode:"auto" (model-gated AI classifier). This checks that an
// allowlisted in-process broker tool (mcp__cc-dyn__*) still gets called under "auto" — i.e. allowedTools
// pre-approves it without the classifier blocking it. If this failed, the whole Linear path would be dead
// in production even though 34 passed.
// Run: set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/34b-broker-under-auto.ts
import { openSession } from "../../harness/dist/index.js";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

(async () => {
  let parked = 0;
  const brokerTool = tool(
    "linear_graphql",
    "Execute a GraphQL query against Linear. Call it, then report the returned value.",
    { query: z.string() },
    async (args: any) => {
      const reply: any = await new Promise((resolve) => setTimeout(() => { parked++; resolve({ ok: true, echoed: args?.query ?? null }); }, 40));
      return { content: [{ type: "text" as const, text: JSON.stringify(reply) }] };
    },
  );
  const TOOL_ID = "mcp__cc-dyn__linear_graphql";
  const s = openSession({
    model: "claude-opus-4-8",
    permissionMode: "auto",                 // <-- production posture, NOT bypassPermissions
    mcpServers: { "cc-dyn": createSdkMcpServer({ name: "cc-dyn", version: "0.1.0", tools: [brokerTool] }) },
    allowedTools: [TOOL_ID],                // pre-approve the brokered tool the way withDynamicTools does
  } as any);

  let toolFired = false;
  const r = await s.submit(
    "Call the linear_graphql tool with query exactly \"PING-AUTO\". Then reply with ONLY the JSON field `echoed` from the result.",
    (m: any) => { if (m?.type === "assistant") for (const c of m?.message?.content ?? []) if (c?.type === "tool_use" && String(c?.name ?? "").includes("linear_graphql")) toolFired = true; },
  );
  await s.dispose();

  const finalText = String(r?.result ?? "");
  const roundTripped = finalText.includes("PING-AUTO");
  console.error("=== PROBE 34b: broker tool under permissionMode:auto ===");
  console.error(`tool_use observed: ${toolFired} | handler parked: ${parked}x | final: ${JSON.stringify(finalText).slice(0, 120)}`);
  const verdict = toolFired && parked >= 1 && roundTripped;
  console.error(`VERDICT: ${verdict ? "PASS — allowlisted broker tool fires under auto (production path live)" : "FAIL — auto blocks the brokered tool; revisit allowedTools/canUseTool"}`);
  process.exit(verdict ? 0 : 1);
})().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
