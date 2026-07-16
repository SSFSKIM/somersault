// Probe 00 — auth health check. Run this FIRST before any paid probe session (house rule from the
// 2026-07 incident: an org-policy-disabled OAuth token makes every live run fail with a "success"
// result whose TEXT is the error — read the result text, not just the subtype).
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const m of query({ prompt: "Reply OK", options: { model: "claude-haiku-4-5-20251001", maxTurns: 1, permissionMode: "bypassPermissions" } })) {
  if ("result" in m) {
    const text = String((m as any).result ?? "");
    const suspicious = /disabled|credit|usage|api key|unauthorized|billing/i.test(text);
    console.log("subtype:", (m as any).subtype, "| text:", text.slice(0, 120));
    console.log(suspicious ? "HEALTH ❌ — auth/billing problem, fix .env before probing" : "HEALTH ✅");
    process.exit(suspicious ? 1 : 0);
  }
}
console.log("HEALTH ❌ — no result message arrived");
process.exit(1);
