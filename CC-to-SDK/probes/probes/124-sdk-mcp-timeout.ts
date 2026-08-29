// Probe 124 — Is the 0.3.251 per-server SDK-MCP timeout ENFORCED headlessly?
//
// sdk.d.ts 0.3.251 adds `timeout` (ms) to CreateSdkMcpServerOptions / McpSdkServerConfig, delivered
// via the initialize request's new sdkMcpServerConfigs. Claims to verify live:
//   - a per-server timeout caps a tool call at that wall-clock (hard; progress does not extend it)
//   - values below 1000ms are IGNORED (fall through to MCP_TOOL_TIMEOUT or the default)
// Two in-process servers, one turn: `slowsrv` (timeout 5000, tool sleeps 60s → should fail ~5s) and
// `ctrlsrv` (timeout 500 → ignored, tool sleeps 3s → should complete ~3s). The model is told to call
// both and report outcomes; we time tool_use→tool_result per server ourselves.
//
// Run from CC-to-SDK/probes:  npx tsx probes/124-sdk-mcp-timeout.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

function loadKey(): void {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const file = process.env.CCX_ENV_FILE ?? resolve(import.meta.dirname, "../../.env");
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch (e) { console.log("[env] could not read env file:", (e as Error)?.name); }
  }
  delete process.env.ANTHROPIC_API_KEY;
  console.log("[env] keyed:", Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN));
}
loadKey();

const log = (...a: unknown[]) => console.log("[p124]", ...a);
setTimeout(() => { log("!!! GLOBAL WATCHDOG (300s)"); process.exit(2); }, 300_000).unref?.();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const slow = createSdkMcpServer({
  name: "slowsrv",
  timeout: 5_000,
  tools: [tool("slow_wait", "Waits a long time then returns.", { seconds: z.number().optional() }, async () => {
    log("slowsrv tool ENTERED (will sleep 60s unless killed)");
    await sleep(60_000);
    return { content: [{ type: "text", text: "slowsrv finished the full wait" }] };
  })],
} as never);
const ctrl = createSdkMcpServer({
  name: "ctrlsrv",
  timeout: 500, // below 1000 → documented to be IGNORED
  tools: [tool("short_wait", "Waits three seconds then returns.", {}, async () => {
    log("ctrlsrv tool ENTERED (sleeps 3s)");
    await sleep(3_000);
    return { content: [{ type: "text", text: "ctrlsrv finished its 3s wait" }] };
  })],
} as never);

const started = new Map<string, number>();  // tool name → tool_use timestamp
const q = query({
  prompt: "Call the mcp__slowsrv__slow_wait tool once. After it returns or errors, call the "
    + "mcp__ctrlsrv__short_wait tool once. Then report each tool's outcome verbatim, prefixed "
    + "SLOW: and SHORT:. Do not retry either tool.",
  options: {
    model: "haiku",
    cwd: process.cwd(),
    settingSources: [],
    maxTurns: 6,
    mcpServers: { slowsrv: slow, ctrlsrv: ctrl },
    allowedTools: ["mcp__slowsrv__slow_wait", "mcp__ctrlsrv__short_wait"],
  } as never,
});

for await (const m of q as AsyncIterable<Record<string, unknown>>) {
  const msg = m as { type: string; message?: { content?: Array<Record<string, unknown>> }; subtype?: string };
  if (msg.type === "assistant") {
    for (const b of msg.message?.content ?? []) {
      if (b.type === "tool_use") { started.set(String(b.id), Date.now()); log(`tool_use ${b.name}`); }
      if (b.type === "text" && String(b.text).trim()) log("assistant:", String(b.text).trim().slice(0, 160));
    }
  }
  if (msg.type === "user") {
    for (const b of (msg.message?.content ?? []) as Array<Record<string, unknown>>) {
      if (b.type === "tool_result") {
        const t0 = started.get(String(b.tool_use_id));
        const elapsed = t0 ? ((Date.now() - t0) / 1000).toFixed(1) : "?";
        log(`tool_result after ${elapsed}s  is_error=${b.is_error ?? false}  content=${JSON.stringify(b.content).slice(0, 220)}`);
      }
    }
  }
  if (msg.type === "result") { log(`result subtype=${msg.subtype}`); break; }
}
log("DONE");
process.exit(0);
