// probes/probes/34-broker-tool-roundtrip.ts — A1 gate for the app-server B2 rework.
// PREMISE UNDER TEST: an in-process SDK MCP tool handler can BLOCK on an out-of-band reply
// (the exact shape of peer.request("item/tool/call", …) → Director executes → reply arrives on a
// SEPARATE code path) and return that reply as the tool result, with the agent then using it.
// Under B2 this single premise gates BOTH linear_graphql AND report_outcome (same broker path).
//
// The handler does NOT resolve its own promise. It enqueues {id, resolve} and a separate async
// "director loop" drains the queue after a delay and resolves it — so the SDK must tolerate an MCP
// handler parked on an external channel (real peer.request parks on stdin from the Director).
//
// Run: set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/34-broker-tool-roundtrip.ts
import { openSession } from "../../harness/dist/index.js";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

type Pending = { id: number; payload: any; resolve: (v: any) => void };

(async () => {
  // A mock "Director" channel: requests pushed here are answered out-of-band by drainLoop().
  const outbox: Pending[] = [];
  let wake: (() => void) | null = null;
  let drained = 0;
  const ticks: number[] = [];
  let seq = 0;

  // The separate code path that delivers replies (mirrors Peer.feed() handling a {id,result}).
  let stop = false;
  const drainLoop = (async () => {
    while (!stop) {
      if (outbox.length === 0) { await new Promise<void>((r) => (wake = r)); continue; }
      const req = outbox.shift()!;
      await new Promise((r) => setTimeout(r, 40)); // simulate round-trip latency to the Director
      drained++;
      req.resolve({ ok: true, echoed: req.payload?.query ?? null, servedBy: "mock-director" });
    }
  })();

  // The broker tool: enqueue → PARK on an externally-resolved promise → return the reply verbatim.
  const brokerTool = tool(
    "broker_echo",
    "Echo the given text by round-tripping through the host. Call it, then report the echoed value.",
    { query: z.string() },
    async (args: any) => {
      const id = ++seq;
      const t0 = Date.now();
      const reply: any = await new Promise((resolve) => {
        outbox.push({ id, payload: args, resolve });
        wake?.(); wake = null;
      });
      ticks.push(Date.now() - t0);
      return { content: [{ type: "text" as const, text: JSON.stringify(reply) }] };
    },
  );

  const TOOL_ID = "mcp__broker__broker_echo";
  const s = openSession({
    model: "claude-opus-4-8",
    permissionMode: "bypassPermissions",
    mcpServers: { broker: createSdkMcpServer({ name: "broker", version: "0.1.0", tools: [brokerTool] }) },
    allowedTools: [TOOL_ID],
  } as any);

  let toolFired = false;
  const prompt =
    "Call the broker_echo tool with query exactly \"PING-42\". When it returns, reply with ONLY the value of the JSON field `echoed` from the tool result. Nothing else.";
  const r = await s.submit(prompt, (m: any) => {
    if (m?.type === "assistant") {
      for (const c of m?.message?.content ?? []) {
        if (c?.type === "tool_use" && String(c?.name ?? "").includes("broker_echo")) toolFired = true;
      }
    }
  });
  await s.dispose();
  stop = true; wake?.(); await drainLoop;

  const finalText = String(r?.result ?? "");
  const roundTripped = finalText.includes("PING-42");
  console.error("=== PROBE 34: brokered MCP tool round-trip ===");
  console.error(`tool_use observed:        ${toolFired}`);
  console.error(`out-of-band drains:       ${drained} (handler parked ${ticks.length}x, latencies=${JSON.stringify(ticks)}ms)`);
  console.error(`final result:             ${JSON.stringify(finalText).slice(0, 160)}`);
  console.error(`echoed value round-tripped: ${roundTripped}`);
  const verdict = toolFired && drained >= 1 && ticks.every((t) => t >= 35) && roundTripped;
  console.error(`\nVERDICT: ${verdict ? "PASS — SDK MCP handler can park on an out-of-band reply and return it (B2 broker path is reachable)" : "FAIL — premise NOT proven; do NOT build B2 on this"}`);
  process.exit(verdict ? 0 : 1);
})().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
