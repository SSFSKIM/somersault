// Probe 56b — Probe 56 proved an SDK-spawned session writes ~/.claude/sessions/<pid>.json with
// entrypoint:"sdk-cli". Open question: does the real `claude agents` VIEW surface that row, or does it
// filter by entrypoint/liveness? Holds a streaming-input session open, then shells out to the real
// `claude agents --json --all` and looks for our pid.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".claude", "sessions");
const before = new Set(readdirSync(DIR));

let release!: () => void;
const gate = new Promise<void>((r) => (release = r));
async function* prompts() {
  yield { type: "user" as const, session_id: "", parent_tool_use_id: null, message: { role: "user" as const, content: "Reply with exactly: HOLDING" } };
  await gate; // keeps the session (and its registry row) alive while we inspect
}

const q = query({ prompt: prompts(), options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions" } });

console.log("=== PROBE 56b is an sdk-cli session visible in `claude agents`? ===");
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init") {
    // Row should exist by now; find it.
    const mine = readdirSync(DIR).filter((f) => !before.has(f));
    console.log("new registry rows:", mine);
    let ourPid: number | undefined;
    for (const f of mine) {
      try {
        const j = JSON.parse(readFileSync(join(DIR, f), "utf8"));
        console.log(`  ${f}: entrypoint=${j.entrypoint} kind=${j.kind} name=${j.name} version=${j.version}`);
        ourPid = j.pid;
      } catch {}
    }

    let rows: any[] = [];
    try {
      rows = JSON.parse(execFileSync("claude", ["agents", "--json", "--all"], { encoding: "utf8", timeout: 30000 }));
    } catch (e: any) {
      console.log("claude agents failed:", e.message);
    }
    console.log("agents rows:", rows.length);
    const hit = rows.find((r) => r.pid === ourPid || r.sessionId === (m as any).session_id);
    console.log("OUR SESSION IN AGENTS VIEW:", hit ? JSON.stringify(hit) : "NOT LISTED");
    console.log("");
    console.log(hit
      ? "VERDICT: sdk-cli sessions ARE surfaced by the real agents view"
      : "VERDICT: the row exists on disk but the agents view FILTERS it (entrypoint or liveness gate)");
    console.log(hit ? "RESULT: PASS" : "RESULT: FAIL");
    release();
  }
  if ("result" in m) break;
}
