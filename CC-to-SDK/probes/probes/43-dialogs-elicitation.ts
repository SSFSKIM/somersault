// Probe 43 — onElicitation + onUserDialog (Wave 2), headlessly.
//
// Declared surface: OnElicitation (sdk.d.ts:1265) fires when an MCP server requests user input and no
// hook handled it; unhandled → auto-declined. onUserDialog (1275) renders request_user_dialog control
// requests, gated by supportedDialogKinds (fail-closed: absent kind → never emitted; non-empty kinds
// WITHOUT the callback → "throws at option intake"). MCP SDK 1.29 gives SDK-type servers
// server.elicitInput() — our deterministic trigger.
// Questions:
//   1. Intake validation: supportedDialogKinds without onUserDialog throws?
//   2. Does an SDK-server elicitInput() during a tool call reach onElicitation headlessly?
//   3. Do the Elicitation / ElicitationResult HOOKS fire around it?
//   4. Does the accepted content flow back to the MCP tool handler?
//   (onUserDialog itself has no deterministic headless trigger — refusal_fallback_prompt needs a real
//   refusal; we wire it + kinds and record no-break/no-emit.)
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { brief } from "../lib/runProbe.ts";

console.log("=== PROBE 43 dialogs + elicitation ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (240s) — probe wedged, exiting"); process.exit(2); }, 240_000).unref?.();

// ---- Q1: intake validation (no tokens) ----
try {
  const bad: any = query({ prompt: "x", options: { supportedDialogKinds: ["refusal_fallback_prompt"], maxTurns: 1 } as any });
  // intake may throw lazily on first pull
  await bad.next();
  console.log("[Q1] no throw ❌ — kinds without onUserDialog was ACCEPTED");
  try { await bad.return?.(); } catch {}
} catch (e) {
  console.log("[Q1] throws at intake ✅ :", brief(String(e), 160));
}

// ---- main session: elicitation round-trip ----
let handlerGot = "";
const serverCfg = createSdkMcpServer({
  name: "probeelicit",
  tools: [tool("needsInput", "Asks the user for their name via elicitation, returns it.", {}, async () => {
    const res = await (serverCfg as any).instance.server.elicitInput({
      message: "Probe: what is your name?",
      requestedSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    });
    handlerGot = JSON.stringify(res);
    return { content: [{ type: "text", text: `ELICITED:${JSON.stringify(res)}` }] };
  })],
});

let onElicitationCalls: any[] = [];
let dialogCalls = 0;
const hookLog: string[] = [];

const handle = query({
  prompt: "Call the needsInput tool once (find it via ToolSearch if needed), then reply with exactly what it returned.",
  options: {
    model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", maxTurns: 5, settingSources: [],
    mcpServers: { probeelicit: serverCfg },
    onElicitation: async (req: any) => {
      onElicitationCalls.push(req);
      console.log("[onElicitation]", brief(req, 300));
      return { action: "accept", content: { name: "ProbeUser" } };
    },
    onUserDialog: async (req: any) => { dialogCalls++; console.log("[onUserDialog]", brief(req, 200)); return { behavior: "cancelled" }; },
    supportedDialogKinds: ["refusal_fallback_prompt"],
    hooks: {
      Elicitation: [{ hooks: [async (i: any) => { hookLog.push("Elicitation"); console.log("[HOOK Elicitation]", brief({ ...i, transcript_path: undefined }, 250)); return {}; }] }],
      ElicitationResult: [{ hooks: [async (i: any) => { hookLog.push("ElicitationResult"); console.log("[HOOK ElicitationResult]", brief({ ...i, transcript_path: undefined }, 250)); return {}; }] }],
    },
  } as any,
});

let resultText = "";
for await (const m of handle as any) {
  if (m.type === "assistant") for (const b of m.message?.content ?? [])
    if (b.type === "tool_use") console.log("[tool_use]", b.name, brief(b.input, 100));
  if (m.type === "user") for (const b of m.message?.content ?? [])
    if (b.type === "tool_result") console.log("[tool_result]", brief(typeof b.content === "string" ? b.content : JSON.stringify(b.content), 250));
  if (m.type === "system" && ["elicitation_complete"].includes(m.subtype)) console.log("[system]", m.subtype, brief(m, 200));
  if (m.type === "result") { resultText = String(m.result ?? ""); console.log("[result]", m.subtype, "|", brief(m.result, 200)); }
}

console.log("\n=== VERDICT ===");
console.log("[Q2] onElicitation called:", onElicitationCalls.length > 0 ? `✅ ×${onElicitationCalls.length}` : "❌ never");
console.log("[Q3] elicitation hooks fired:", hookLog.length ? `✅ ${hookLog.join(",")}` : "— none");
console.log("[Q4] content back to handler:", handlerGot.includes("ProbeUser") ? "✅ " + brief(handlerGot, 160) : "❌ " + brief(handlerGot || "(handler saw nothing)", 200));
console.log("[info] onUserDialog calls (expected 0):", dialogCalls);
if (onElicitationCalls.length && handlerGot.includes("ProbeUser")) console.log("REACHABLE ✅ — full elicitation round-trip works headlessly via onElicitation.");
else console.log("CHECK LOG ⚠️ — round-trip incomplete; note declared fallback: unhandled elicitations auto-decline.");
process.exit(0);
