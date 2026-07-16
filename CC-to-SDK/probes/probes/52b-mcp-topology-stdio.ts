// Probe 52b — runtime MCP topology for a PROCESS-BASED (stdio) server — the path 52 proved SDK-type
// servers can't take (toggle(true)/reconnect throw "SDK servers should be handled in print.ts";
// toggle(false) is a silent no-op). The daemon ops will manage stdio/http servers, so this is the
// production-relevant half. The canary tool returns its server pid → reconnect is verifiable as a
// pid change, toggle-off as UNAVAILABLE.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { brief } from "../lib/runProbe.ts";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "lib", "topo-stdio-server.ts");
const tsxBin = join(here, "..", "node_modules", ".bin", "tsx");
console.log("=== PROBE 52b MCP runtime topology (stdio) ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (420s) — probe wedged, exiting"); process.exit(2); }, 420_000).unref?.();

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
let phaseTag = "warm"; const pidByPhase: Record<string, string> = {};

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
    if (mm.type === "user") for (const b of mm.message?.content ?? [])
      if (b.type === "tool_result") { const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content); const pid = /pid=(\d+)/.exec(t)?.[1]; if (pid) pidByPhase[phaseTag] = pid; }
    if (mm.type === "result") { console.log(`[result:${phaseTag}]`, mm.subtype, "|", brief(mm.result, 60)); resolvers.shift()?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

const status = async (label: string) => {
  try { const s = await handle.mcpServerStatus(); console.log(`[status:${label}]`, brief(s.map((x: any) => `${x.name}:${x.status ?? x.state ?? "?"}`), 250)); return s; }
  catch (e) { console.log(`[status:${label}] THREW`, brief(String(e), 150)); return []; }
};
const callTurn = `Call the topoCanary tool once (find it via ToolSearch if needed). If the tool cannot be found or the call fails, reply exactly UNAVAILABLE; otherwise reply with exactly what it returned.`;
const turn = async (tag: string) => { phaseTag = tag; const p = nextResult(); q.push(userTurn(callTurn)); await Promise.race([p, sleep(90_000)]); };

{ const p = nextResult(); q.push(userTurn("Reply with exactly: READY")); await Promise.race([p, sleep(60_000)]); }

// ---- Q1: dynamic add (stdio) ----
try { const r = await handle.setMcpServers({ probetopo: { type: "stdio", command: tsxBin, args: [serverPath] } }); console.log("[Q1] setMcpServers(+stdio probetopo) →", brief(r, 200)); }
catch (e) { console.log("[Q1] setMcpServers THREW:", brief(String(e), 300)); }
await status("after-add");
await turn("p1-added");
console.log("[Q1] pid after add:", pidByPhase["p1-added"] ?? "— no call");

// ---- Q2: toggle off / on ----
try { await handle.toggleMcpServer("probetopo", false); console.log("[Q2] toggle(false) resolved"); }
catch (e) { console.log("[Q2] toggle(false) THREW:", brief(String(e), 300)); }
await status("toggled-off");
await turn("p2-off");
console.log("[Q2] pid while off:", pidByPhase["p2-off"] ?? "— no call (expected)");
try { await handle.toggleMcpServer("probetopo", true); console.log("[Q2] toggle(true) resolved"); }
catch (e) { console.log("[Q2] toggle(true) THREW:", brief(String(e), 300)); }
await status("toggled-on");
await turn("p3-on");
console.log("[Q2] pid after re-enable:", pidByPhase["p3-on"] ?? "— no call");

// ---- Q3: reconnect (expect pid change) ----
try { await handle.reconnectMcpServer("probetopo"); console.log("[Q3] reconnect resolved"); }
catch (e) { console.log("[Q3] reconnect THREW:", brief(String(e), 300)); }
await status("reconnected");
await turn("p4-reconnected");
console.log("[Q3] pid after reconnect:", pidByPhase["p4-reconnected"] ?? "— no call", "(was", pidByPhase["p3-on"] ?? pidByPhase["p1-added"], ")");

// ---- Q4: remove ----
try { const r = await handle.setMcpServers({}); console.log("[Q4] setMcpServers({}) →", brief(r, 200)); }
catch (e) { console.log("[Q4] setMcpServers({}) THREW:", brief(String(e), 300)); }
await status("after-remove");

console.log("\n=== VERDICT ===");
console.log("pids:", JSON.stringify(pidByPhase));
const addOk = !!pidByPhase["p1-added"];
const toggleOk = !pidByPhase["p2-off"] && !!pidByPhase["p3-on"];
const prev = pidByPhase["p3-on"] ?? pidByPhase["p1-added"];
const reconnOk = !!pidByPhase["p4-reconnected"] && pidByPhase["p4-reconnected"] !== prev;
if (addOk && toggleOk && reconnOk) console.log("REACHABLE ✅ — full stdio topology: add connects, toggle gates the tool, reconnect respawns (pid changed), remove disconnects.");
else console.log(`PARTIAL ⚠️ — add=${addOk} toggle=${toggleOk} reconnect-pid-change=${reconnOk} (see log).`);
q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
process.exit(0);
