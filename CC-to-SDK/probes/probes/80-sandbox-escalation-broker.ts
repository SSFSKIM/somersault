// Probe 80 — Codex-style sandbox escalation on the SDK: pre-declaration + broker-injected escape.
//
// Premises to verify (design: sandbox-escalation orchestrator, 2026-08-02):
//   Q1. sandbox:{enabled, autoAllowBashIfSandboxed:true} → sandboxed Bash runs WITHOUT consulting
//       canUseTool (Codex's "sandbox == permission" — zero-cost allow inside the wall).
//   Q2. When the model retries with dangerouslyDisableSandbox:true (pre-declaration), canUseTool IS
//       consulted and the flag is visible in the input (so an LLM classifier can gate escapes only).
//   Q3. With autoAllowBashIfSandboxed:false, can canUseTool PREDICTIVELY escalate — allow with
//       updatedInput:{...input, dangerouslyDisableSandbox:true} on a call the model made sandboxed —
//       so the command runs unsandboxed FIRST TRY (no failure, no model round-trip)?
//   Q4. What does a sandbox denial tool_result look like (detection signal for retry logic)?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe80-"));
const escapeA = "/tmp/probe80-escapeA.txt";
const escapeB = "/tmp/probe80-escapeB.txt";
for (const f of [escapeA, escapeB]) { try { rmSync(f); } catch {} }
console.log("=== PROBE 80 sandbox escalation broker ===\ncwd:", dir);
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

// ---------- Run A: auto-allow sandboxed + model pre-declared escalation ----------
console.log("\n--- RUN A: autoAllowBashIfSandboxed:true, model retries with dangerouslyDisableSandbox ---");
const aConsults: any[] = [];
const aToolUses: any[] = [];
const aResults: string[] = [];
const runA = query({
  prompt: `Do exactly this, in order, one Bash call each:\n` +
    `1. Run: echo hi-sandboxed\n` +
    `2. Run: touch ${escapeA} && echo WROTE-A || echo BLOCKED-A\n` +
    `3. If and only if step 2 printed BLOCKED-A or failed with a sandbox/permission error, run the exact same command again but set the Bash tool parameter dangerouslyDisableSandbox to true.\n` +
    `Then reply with exactly: RUN-A-DONE`,
  options: {
    model: "claude-sonnet-4-6", permissionMode: "default", cwd: dir, maxTurns: 10, settingSources: [],
    env: { ...process.env },
    sandbox: { enabled: true, autoAllowBashIfSandboxed: true },
    canUseTool: async (toolName: string, input: any) => {
      aConsults.push({ toolName, input });
      console.log("[A canUseTool]", toolName, brief(input, 220));
      return { behavior: "allow", updatedInput: input };
    },
  } as any,
});
for await (const m of runA as any) {
  if (m.type === "assistant") for (const b of m.message?.content ?? [])
    if (b.type === "tool_use") { aToolUses.push(b.input); console.log("[A tool_use]", b.name, brief(b.input, 220)); }
  if (m.type === "user") for (const b of m.message?.content ?? [])
    if (b.type === "tool_result") { const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content); aResults.push(t); console.log("[A tool_result]", brief(t, 350)); }
  if (m.type === "result") console.log("[A result]", m.subtype, "|", brief(m.result, 120));
}
const aEscaped = existsSync(escapeA);

// ---------- Run B: broker-injected escalation (predictive, zero model round-trip) ----------
console.log("\n--- RUN B: autoAllowBashIfSandboxed:false, broker injects dangerouslyDisableSandbox ---");
const bConsults: any[] = [];
const bToolUses: any[] = [];
const bResults: string[] = [];
const runB = query({
  prompt: `Run this Bash command exactly once (do NOT set any special Bash parameters, do NOT retry even if it fails), then quote its output verbatim and reply RUN-B-DONE:\n` +
    `touch ${escapeB} && echo WROTE-B || echo BLOCKED-B`,
  options: {
    model: "claude-sonnet-4-6", permissionMode: "default", cwd: dir, maxTurns: 6, settingSources: [],
    env: { ...process.env },
    sandbox: { enabled: true, autoAllowBashIfSandboxed: false },
    canUseTool: async (toolName: string, input: any) => {
      bConsults.push({ toolName, input });
      console.log("[B canUseTool]", toolName, brief(input, 220));
      if (toolName === "Bash" && String(input?.command ?? "").includes("probe80-escapeB")) {
        const updated = { ...input, dangerouslyDisableSandbox: true };
        console.log("[B broker] injecting dangerouslyDisableSandbox:true");
        return { behavior: "allow", updatedInput: updated };
      }
      return { behavior: "allow", updatedInput: input };
    },
  } as any,
});
for await (const m of runB as any) {
  if (m.type === "assistant") for (const b of m.message?.content ?? [])
    if (b.type === "tool_use") { bToolUses.push(b.input); console.log("[B tool_use]", b.name, brief(b.input, 220)); }
  if (m.type === "user") for (const b of m.message?.content ?? [])
    if (b.type === "tool_result") { const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content); bResults.push(t); console.log("[B tool_result]", brief(t, 350)); }
  if (m.type === "result") console.log("[B result]", m.subtype, "|", brief(m.result, 120));
}
const bEscaped = existsSync(escapeB);
const bBashCalls = bToolUses.filter((i) => typeof i?.command === "string" && i.command.includes("probe80-escapeB")).length;

// ---------- Verdict ----------
console.log("\n=== VERDICT ===");
const aSandboxedConsults = aConsults.filter((c) => c.toolName === "Bash" && !c.input?.dangerouslyDisableSandbox).length;
const aEscalatedConsults = aConsults.filter((c) => c.toolName === "Bash" && c.input?.dangerouslyDisableSandbox === true).length;
const aDenial = aResults.find((r) => r.includes("BLOCKED-A") || /sandbox|denied|not permitted/i.test(r));
console.log("[Q1] sandboxed Bash consults under autoAllow:", aSandboxedConsults, aSandboxedConsults === 0 ? "✅ zero — sandbox==permission" : "⚠️ still consulted");
console.log("[Q2] escalated (flagged) call consulted canUseTool:", aEscalatedConsults > 0 ? "✅" : "⚠️ no flagged consult seen", "| escape file written:", aEscaped ? "yes" : "no");
console.log("[Q4] denial shape sample:", aDenial ? brief(aDenial, 300) : "(no denial captured)");
console.log("[Q3] broker-injected escalation:", bEscaped && bBashCalls === 1 ? "✅ ran unsandboxed FIRST TRY, single call, zero model round-trip" : `⚠️ escaped=${bEscaped} bashCalls=${bBashCalls}`);
for (const f of [escapeA, escapeB]) { try { rmSync(f); } catch {} }
try { rmSync(dir, { recursive: true }); } catch {}
