// Probe 42b — permission-hook routing (focused follow-up to 42's confound).
//
// 42 lesson: safe read-only Bash (echo/cat) is AUTO-APPROVED under permissionMode "default" — 9 Bash
// runs produced just 1 canUseTool call, so the deny/defer scenarios never exercised the permission
// path. Here every command WRITES (redirects), which needs real permission.
// Questions:
//   1. PermissionRequest hook: fires per request? full input shape?
//   2. canUseTool deny → does the PermissionDenied hook fire?
//   3. PreToolUse permissionDecision:'defer' → is canUseTool consulted (defer = hand to normal flow)?
//   4. PreToolUse 'deny' vs canUseTool deny — which PermissionDenied attributes?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe42b-"));
console.log("=== PROBE 42b permission hooks ===\ncwd:", dir);
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

const log: string[] = [];
const canUse: { tool: string; cmd: string }[] = [];
const hooks: any = {
  PreToolUse: [{ hooks: [async (i: any) => {
    const cmd = String((i.tool_input as any)?.command ?? "");
    log.push(`PreToolUse:${brief(cmd, 60)}`);
    if (cmd.includes("DEFER-TEST")) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer", permissionDecisionReason: "probe defer" } };
    if (cmd.includes("HOOKDENY-TEST")) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "probe hook deny" } };
    return {};
  }] }],
  PermissionRequest: [{ hooks: [async (i: any) => { log.push("PermissionRequest"); console.log("[PermissionRequest INPUT]", brief({ ...i, transcript_path: undefined, session_id: undefined }, 500)); return {}; }] }],
  PermissionDenied: [{ hooks: [async (i: any) => { log.push("PermissionDenied"); console.log("[PermissionDenied INPUT]", brief({ ...i, transcript_path: undefined, session_id: undefined }, 500)); return {}; }] }],
};

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
  options: {
    model: "claude-sonnet-4-6", permissionMode: "default", cwd: dir, maxTurns: 12, settingSources: [], hooks,
    canUseTool: async (toolName: string, input: any) => {
      const cmd = String(input?.command ?? "");
      canUse.push({ tool: toolName, cmd: brief(cmd, 60) });
      log.push(`canUseTool:${toolName}:${brief(cmd, 40)}`);
      console.log("[canUseTool]", toolName, brief(cmd, 80));
      if (cmd.includes("DENY-TEST")) return { behavior: "deny", message: "probe denies DENY-TEST" };
      return { behavior: "allow", updatedInput: input };
    },
  } as any,
});

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "result") { console.log("[result]", mm.subtype); resolvers.shift()?.(); }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

const turns = [
  `Run the Bash tool once with command: date > stamp-a.txt — then reply A-DONE.`,
  `Run the Bash tool once with command: date > DENY-TEST.txt — it may be denied; that is expected; do not retry. Reply B-DONE.`,
  `Run the Bash tool once with command: date > DEFER-TEST.txt — then reply C-DONE.`,
  `Run the Bash tool once with command: date > HOOKDENY-TEST.txt — it may be denied; that is expected; do not retry. Reply D-DONE.`,
];
for (const t of turns) { const p = nextResult(); q.push(userTurn(t)); await Promise.race([p, sleep(90_000)]); }
q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}

console.log("\n=== VERDICT ===");
console.log("event order:", log.join(" → "));
console.log("canUseTool calls:", canUse.length, brief(canUse, 400));
const deferReachedBroker = log.some((l, i) => l.includes("DEFER-TEST") && log.slice(i).some((x) => x.startsWith("canUseTool") && x.includes("DEFER-TEST")));
console.log("[Q3] defer → canUseTool consulted:", deferReachedBroker ? "✅" : "❌");
console.log("[Q2] PermissionDenied fired:", log.includes("PermissionDenied") ? "✅" : "❌");
process.exit(0);
