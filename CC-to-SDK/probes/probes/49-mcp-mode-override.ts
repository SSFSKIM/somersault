// Probe 49 — setMcpPermissionModeOverride() + RefreshMcpTools (Wave 2, both 0.3.211-new).
//
// Declared surface: Query.setMcpPermissionModeOverride(serverName, 'default'|'auto'|null) → {warning?}
// (sdk.d.ts:2278); RefreshMcpTools tool {server?} (sdk-tools.d.ts:708). Probe 40 showed RefreshMcpTools
// ABSENT with no MCP servers configured — hypothesis: it appears once a server is attached.
// Questions:
//   1. With an SDK MCP server attached, is RefreshMcpTools in init.tools (or deferred-reachable)?
//   2. Under permissionMode "default", does calling our MCP tool consult canUseTool?
//   3. After setMcpPermissionModeOverride(server, "auto"), does the SAME tool skip canUseTool?
//   4. What does the override return ({warning?}) and does mode null restore consultation?
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { brief } from "../lib/runProbe.ts";

const TOOL_ID = "mcp__probeovr__overrideCanary";
console.log("=== PROBE 49 MCP mode override ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

let handlerRuns = 0;
const server = createSdkMcpServer({
  name: "probeovr",
  tools: [tool("overrideCanary", "Returns OK.", { note: z.string().optional() }, async () => { handlerRuns++; return { content: [{ type: "text", text: "OK" }] }; })],
});

function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const canUse: string[] = [];
let phaseTag = "p1";
const perPhase: Record<string, number> = {};
let initTools: string[] = [];
const resolvers: (() => void)[] = [];
const nextResult = () => new Promise<void>((r) => resolvers.push(r));

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: {
    model: "claude-sonnet-4-6", permissionMode: "default", maxTurns: 12, settingSources: [],
    mcpServers: { probeovr: server }, disallowedTools: [],
    canUseTool: async (toolName: string) => {
      canUse.push(`${phaseTag}:${toolName}`);
      perPhase[phaseTag] = (perPhase[phaseTag] ?? 0) + 1;
      console.log(`[canUseTool:${phaseTag}]`, toolName);
      return { behavior: "allow" };
    },
  } as any,
});

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "init") initTools = mm.tools ?? [];
    if (mm.type === "assistant") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_use") console.log(`[tool_use:${phaseTag}]`, b.name, brief(b.input, 100));
    if (mm.type === "result") { console.log(`[result:${phaseTag}]`, mm.subtype); resolvers.shift()?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

const callTurn = `Call the overrideCanary tool once (find it via ToolSearch if needed), then reply DONE.`;

// ---- Q2: baseline call under default mode ----
let p = nextResult(); q.push(userTurn(callTurn)); await Promise.race([p, sleep(90_000)]);
console.log("\n[Q1] RefreshMcpTools in init.tools:", initTools.includes("RefreshMcpTools") ? "✅" : "— absent", "| tools:", brief(initTools.filter((t) => /mcp|refresh/i.test(t)), 200));
console.log("[Q2] canUseTool consultations in p1:", perPhase.p1 ?? 0);

// ---- Q3: override to auto, call again ----
phaseTag = "p2";
try {
  const r = await handle.setMcpPermissionModeOverride("probeovr", "auto");
  console.log("[Q3] setMcpPermissionModeOverride(probeovr, auto) →", brief(r, 200));
} catch (e) { console.log("[Q3] override THREW:", brief(String(e), 300)); }
p = nextResult(); q.push(userTurn(callTurn)); await Promise.race([p, sleep(90_000)]);
console.log("[Q3] canUseTool consultations in p2 (auto):", perPhase.p2 ?? 0);

// ---- Q4: restore with null, call again ----
phaseTag = "p3";
try {
  const r = await handle.setMcpPermissionModeOverride("probeovr", null);
  console.log("[Q4] setMcpPermissionModeOverride(probeovr, null) →", brief(r, 200));
} catch (e) { console.log("[Q4] restore THREW:", brief(String(e), 300)); }
p = nextResult(); q.push(userTurn(callTurn)); await Promise.race([p, sleep(90_000)]);
console.log("[Q4] canUseTool consultations in p3 (restored):", perPhase.p3 ?? 0);

console.log("\n=== VERDICT ===");
console.log("handler runs:", handlerRuns, "| canUse trail:", brief(canUse, 300));
const worked = (perPhase.p1 ?? 0) > 0 && (perPhase.p2 ?? 0) === 0;
if (worked) console.log("REACHABLE ✅ — override 'auto' silences canUseTool for the server;", (perPhase.p3 ?? 0) > 0 ? "null restores consultation." : "null did NOT restore in-window ⚠️.");
else console.log(`INCONCLUSIVE ⚠️ — p1=${perPhase.p1 ?? 0} p2=${perPhase.p2 ?? 0} p3=${perPhase.p3 ?? 0} (see log; MCP permission may need disallow-native/allowedTools shaping per the D3 lesson).`);
q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
