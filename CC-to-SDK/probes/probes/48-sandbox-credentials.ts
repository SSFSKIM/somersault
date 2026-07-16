// Probe 48 — SandboxSettings.credentials redaction (Wave 2, 0.3.211-new security surface).
//
// Declared surface (sdk.d.ts ~6075): sandbox.credentials.envVars[{name, mode:'deny'|'mask',
// injectHosts?}] — deny UNSETS the var for sandboxed commands; mask substitutes a sentinel + proxy
// injection (needs egress proxy → out of scope here). credentials.files[{path, mode:'deny'}] blocks
// reads. macOS = sandbox-exec.
// Questions (deny-mode only):
//   1. Does env deny hide the var from sandboxed Bash while a control var stays visible?
//   2. Does file deny block reading the credential file?
//   3. Is the sandbox actually ENGAGED (write outside workspace fails) — guards against a silent
//      "sandbox unavailable → ran unsandboxed" false negative?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe48-"));
const secretFile = join(dir, "secret-cred.txt");
writeFileSync(secretFile, "FILE-SECRET-CONTENT");
console.log("=== PROBE 48 sandbox credentials ===\ncwd:", dir);
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (240s) — probe wedged, exiting"); process.exit(2); }, 240_000).unref?.();

const outputs: string[] = [];
const handle = query({
  prompt: `Run the Bash tool exactly three times, one command per call, and after each call quote its full output verbatim on its own line:\n1. echo "ENV:[$PROBE_FAKE_SECRET][$PROBE_PLAIN]"\n2. cat ${secretFile} || echo READ-BLOCKED\n3. touch /tmp/probe48-escape.txt && echo WROTE-OUTSIDE || echo WRITE-BLOCKED\nThen reply with exactly: SANDBOX-DONE`,
  options: {
    model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", cwd: dir, maxTurns: 6, settingSources: [],
    env: { ...process.env, PROBE_FAKE_SECRET: "hunter2", PROBE_PLAIN: "visible" },
    sandbox: {
      enabled: true,
      credentials: {
        envVars: [{ name: "PROBE_FAKE_SECRET", mode: "deny" }],
        files: [{ path: secretFile, mode: "deny" }],
      },
    },
  } as any,
});

let resultText = "";
for await (const m of handle as any) {
  if (m.type === "assistant") for (const b of m.message?.content ?? []) {
    if (b.type === "tool_use") console.log("[tool_use]", b.name, brief(b.input, 160));
  }
  if (m.type === "user") for (const b of m.message?.content ?? [])
    if (b.type === "tool_result") { const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content); outputs.push(t); console.log("[tool_result]", brief(t, 250)); }
  if (m.type === "system" && m.subtype !== "init") console.log("[system]", m.subtype, brief(m, 150));
  if (m.type === "result") { resultText = String(m.result ?? ""); console.log("[result]", m.subtype, "|", brief(m.result, 200)); }
}

const all = outputs.join("\n---\n");
console.log("\n=== VERDICT ===");
const envHidden = all.includes("ENV:[][visible]") || (!all.includes("hunter2") && all.includes("visible"));
const fileBlocked = !all.includes("FILE-SECRET-CONTENT");
const engaged = !all.includes("WROTE-OUTSIDE");
console.log("[Q1] env deny (hunter2 hidden, control visible):", envHidden ? "✅" : "❌ leaked");
console.log("[Q2] file deny (content unreadable):", fileBlocked ? "✅" : "❌ leaked");
console.log("[Q3] sandbox engaged (outside write blocked):", engaged ? "✅" : "⚠️ outside write SUCCEEDED — sandbox may be off/lenient; interpret Q1/Q2 accordingly");
if (envHidden && fileBlocked) console.log("REACHABLE ✅ — credentials deny-mode redaction works headlessly via options.sandbox.");
else console.log("CHECK LOG ⚠️ — at least one redaction did not hold.");
process.exit(0);
