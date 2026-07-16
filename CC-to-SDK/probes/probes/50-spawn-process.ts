// Probe 50 — spawnClaudeCodeProcess (Wave 2): custom subprocess spawn, headlessly.
//
// Declared surface (sdk.d.ts:2014, 6515-6593): Options.spawnClaudeCodeProcess?: (SpawnOptions) =>
// SpawnedProcess — the seam that lets a host place the CLI subprocess anywhere (container/VM/remote),
// as long as the returned object satisfies the SpawnedProcess stream/exit interface. The forwarded
// abort signal fires only AFTER the SDK's graceful stdin-EOF + ~2s grace path.
// Design-blocking questions:
//   1. Is the callback actually invoked headlessly (and with what command/args/env shape)?
//   2. Does a session run END-TO-END through a custom-spawned process (init + result)?
//   3. Does teardown propagate (child exits after close — no orphan)?
import { query } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { brief } from "../lib/runProbe.ts";

console.log("=== PROBE 50 spawnClaudeCodeProcess ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (180s) — probe wedged, exiting"); process.exit(2); }, 180_000).unref?.();

let spawnCalls = 0;
let capturedCmd = "", capturedArgs: string[] = [], envKeys = 0;
let child: any;

const handle = query({
  prompt: "Reply with exactly: SPAWNED-OK",
  options: {
    model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", maxTurns: 1, settingSources: [],
    spawnClaudeCodeProcess: (o: any) => {
      spawnCalls++;
      capturedCmd = o.command; capturedArgs = o.args ?? []; envKeys = Object.keys(o.env ?? {}).length;
      console.log("[spawn cb] command:", brief(o.command, 120), "| args:", brief(o.args, 200), "| env keys:", envKeys, "| cwd:", o.cwd);
      child = spawn(o.command, o.args, { cwd: o.cwd, env: o.env, stdio: ["pipe", "pipe", "pipe"], signal: o.signal });
      child.stderr?.on("data", () => {});
      return child;
    },
  } as any,
});

let initSeen = false, resultText = "";
for await (const m of handle as any) {
  if (m.type === "system" && m.subtype === "init") initSeen = true;
  if (m.type === "result") resultText = String(m.result ?? "");
}
await new Promise((r) => setTimeout(r, 2500));
const exited = child ? (child.exitCode !== null || child.killed) : false;

console.log("\n=== VERDICT ===");
console.log("[Q1] callback invoked:", spawnCalls, "time(s) | cmd:", brief(capturedCmd, 100), "| args[0..3]:", brief(capturedArgs.slice(0, 4), 200));
console.log("[Q2] end-to-end:", initSeen && resultText.includes("SPAWNED-OK") ? "✅ init + result through custom spawn" : `❌ init:${initSeen} result:${brief(resultText, 80)}`);
console.log("[Q3] child exited after stream end:", exited ? "✅" : `❌ (exitCode=${child?.exitCode}, killed=${child?.killed})`);
if (spawnCalls > 0 && initSeen && resultText.includes("SPAWNED-OK")) console.log("REACHABLE ✅ — custom spawn seam works headlessly; remote placement is a transport exercise.");
else console.log("NOT WORKING ❌");
process.exit(0);
