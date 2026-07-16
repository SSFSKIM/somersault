// Probe 52 — runtime MCP topology: setMcpServers / toggleMcpServer / reconnectMcpServer (Wave 3 item 5).
//
// Declared surface (sdk.d.ts:2470-2507): the trio lives on Query; setMcpServers supports BOTH
// process-based and SDK in-process servers, replaces the dynamic set, returns {added,removed,errors};
// mcpServerStatus() observes. Probe 49 settled the 0.3.211 mode-override pair; the trio itself was
// never probed. Questions:
//   1. Does setMcpServers({name: sdkServer}) mid-session connect it (status + callable)?
//   2. Does toggleMcpServer(name,false) make the tool uncallable, and true restore it?
//   3. Does reconnectMcpServer(name) resolve and leave the tool callable?
//   4. Does setMcpServers({}) remove it ({removed:[name]}, status empty)?
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { brief } from "../lib/runProbe.ts";

console.log("=== PROBE 52 MCP runtime topology ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (420s) — probe wedged, exiting"); process.exit(2); }, 420_000).unref?.();

let handlerRuns = 0; let phaseTag = "p0"; const runsByPhase: Record<string, number> = {};
const server = createSdkMcpServer({
  name: "probetopo",
  tools: [tool("topoCanary", "Returns OK.", { note: z.string().optional() }, async () => { handlerRuns++; runsByPhase[phaseTag] = (runsByPhase[phaseTag] ?? 0) + 1; return { content: [{ type: "text", text: "OK" }] }; })],
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
const resolvers: (() => void)[] = [];
const nextResult = () => new Promise<void>((r) => resolvers.push(r));

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: { model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", maxTurns: 30, settingSources: [] } as any,
});
const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "assistant") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_use") console.log(`[tool_use:${phaseTag}]`, b.name, brief(b.input, 80));
    if (mm.type === "result") { console.log(`[result:${phaseTag}]`, mm.subtype); resolvers.shift()?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

const status = async (label: string) => {
  try { const s = await handle.mcpServerStatus(); console.log(`[status:${label}]`, brief(s.map((x: any) => `${x.name}:${x.status ?? x.state ?? JSON.stringify(x).slice(0, 40)}`), 250)); return s; }
  catch (e) { console.log(`[status:${label}] THREW`, brief(String(e), 150)); return []; }
};
const callTurn = `Call the topoCanary tool once (find it via ToolSearch if needed). If the tool cannot be found or the call fails, reply exactly UNAVAILABLE; otherwise reply exactly DONE.`;
const turn = async (tag: string) => { phaseTag = tag; const p = nextResult(); q.push(userTurn(callTurn)); await Promise.race([p, sleep(90_000)]); };

// warm the session so the control channel is live
{ phaseTag = "warm"; const p = nextResult(); q.push(userTurn("Reply with exactly: READY")); await Promise.race([p, sleep(60_000)]); }
await status("baseline");

// ---- Q1: dynamic add ----
try { const r = await handle.setMcpServers({ probetopo: server }); console.log("[Q1] setMcpServers(+probetopo) →", brief(r, 200)); }
catch (e) { console.log("[Q1] setMcpServers THREW:", brief(String(e), 300)); }
await status("after-add");
await turn("p1-added");
console.log("[Q1] handler runs after add:", runsByPhase["p1-added"] ?? 0);

// ---- Q2: toggle off / on ----
try { await handle.toggleMcpServer("probetopo", false); console.log("[Q2] toggle(false) resolved"); }
catch (e) { console.log("[Q2] toggle(false) THREW:", brief(String(e), 300)); }
await status("toggled-off");
await turn("p2-off");
console.log("[Q2] handler runs while off:", runsByPhase["p2-off"] ?? 0);
try { await handle.toggleMcpServer("probetopo", true); console.log("[Q2] toggle(true) resolved"); }
catch (e) { console.log("[Q2] toggle(true) THREW:", brief(String(e), 300)); }
await turn("p3-on");
console.log("[Q2] handler runs after re-enable:", runsByPhase["p3-on"] ?? 0);

// ---- Q3: reconnect ----
try { await handle.reconnectMcpServer("probetopo"); console.log("[Q3] reconnect resolved"); }
catch (e) { console.log("[Q3] reconnect THREW:", brief(String(e), 300)); }
await status("reconnected");
await turn("p4-reconnected");
console.log("[Q3] handler runs after reconnect:", runsByPhase["p4-reconnected"] ?? 0);

// ---- Q4: remove all ----
try { const r = await handle.setMcpServers({}); console.log("[Q4] setMcpServers({}) →", brief(r, 200)); }
catch (e) { console.log("[Q4] setMcpServers({}) THREW:", brief(String(e), 300)); }
await status("after-remove");

console.log("\n=== VERDICT ===");
console.log("runs by phase:", JSON.stringify(runsByPhase), "| total handler runs:", handlerRuns);
const addOk = (runsByPhase["p1-added"] ?? 0) > 0;
const toggleOk = (runsByPhase["p2-off"] ?? 0) === 0 && (runsByPhase["p3-on"] ?? 0) > 0;
const reconnOk = (runsByPhase["p4-reconnected"] ?? 0) > 0;
if (addOk && toggleOk && reconnOk) console.log("REACHABLE ✅ — full runtime topology (add/toggle/reconnect/remove) works mid-session.");
else console.log(`PARTIAL/INCONCLUSIVE ⚠️ — add=${addOk} toggle=${toggleOk} reconnect=${reconnOk} (see log).`);
q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
