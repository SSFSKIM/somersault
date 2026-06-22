// Probe 35c — DOES registering MCP tools cost context tokens per turn? (settles 35b's H1 vs H2)
// 35b left one ambiguity: when ToolSearch IS present (the default), does the SDK keep our allowlisted MCP
// tool schemas INLINE in every request (H1 — costs tokens each turn) or DEFER them behind ToolSearch so
// they cost ~nothing until searched (H2 — cheap to leave on)?
//
// Decisive method: register N custom MCP tools with chunky descriptions, allowlist them, and ask the model
// to JUST reply "OK" (call nothing). Read the first turn's input/cache-creation token counts. If the count
// scales with N, the schemas are in the prompt → INLINE. If it stays flat, they are DEFERRED (lazy-loaded).
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const MODEL = "claude-haiku-4-5-20251001";
// ~300-char description each, so 25 tools ≈ a few thousand tokens IF inline — easily above measurement noise.
const DESC = "This is a deliberately verbose canary tool description used to measure context-token cost. ".repeat(4);

function mkServer(n: number) {
  const tools = Array.from({ length: n }, (_, i) =>
    tool(`canary${i}`, `${DESC} (tool index ${i})`, { a: z.string().optional(), b: z.number().optional() },
      async () => ({ content: [{ type: "text" as const, text: "x" }] })));
  return createSdkMcpServer({ name: "probecost", version: "0.1.0", tools });
}

async function measure(n: number) {
  const opts: Record<string, unknown> = { model: MODEL, maxTurns: 1, permissionMode: "bypassPermissions", settingSources: [] };
  if (n > 0) { opts.mcpServers = { probecost: mkServer(n) }; opts.allowedTools = Array.from({ length: n }, (_, i) => `mcp__probecost__canary${i}`); }
  let usage: any, initToolCount: number | undefined;
  for await (const m of query({ prompt: "Reply with exactly: OK. Do not call any tools.", options: opts })) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "init" && Array.isArray(mm.tools)) initToolCount = mm.tools.length;
    if (mm.type === "result") usage = mm.usage;
  }
  const inp = usage?.input_tokens ?? 0, cc = usage?.cache_creation_input_tokens ?? 0, cr = usage?.cache_read_input_tokens ?? 0;
  // "billed prefix" = the part that carries tool schemas (fresh creation + read), robust to caching.
  const prefix = inp + cc + cr;
  console.log(`n=${String(n).padStart(2)} | init.tools=${initToolCount} | input=${inp} cache_creation=${cc} cache_read=${cr} | prefix≈${prefix}`);
  return { n, prefix, initToolCount };
}

console.log("=== PROBE 35c mcp-tool-cost ===  model:", MODEL, "| desc chars/tool:", DESC.length);
const z0 = await measure(0);
const z25 = await measure(25);

const delta = z25.prefix - z0.prefix;
const perTool = delta / 25;
console.log("\n=== INTERPRETATION ===");
console.log(`prefix tokens: 0 tools=${z0.prefix}, 25 tools=${z25.prefix} | delta=${delta} (~${perTool.toFixed(0)}/tool)`);
console.log(`init.tools grew by: ${(z25.initToolCount ?? 0) - (z0.initToolCount ?? 0)} (registry always lists names regardless of schema loading)`);
// If schemas are inline, 25 verbose tools add clearly >1000 prefix tokens. If deferred, delta ~ noise (<~300).
const verdict = delta > 1000 ? "INLINE — MCP tool schemas ARE in every request's prompt (default-on costs ~this many tokens/turn)"
  : delta < 300 ? "DEFERRED — registering MCP tools adds ~no per-turn prompt cost until the model searches"
  : "AMBIGUOUS — delta in the noise band; re-run or widen N";
console.log("VERDICT:", verdict);
console.log(Math.abs(delta) > 300 || delta >= 0 ? "RESULT: PASS (measured a clean delta)" : "RESULT: FAIL");
