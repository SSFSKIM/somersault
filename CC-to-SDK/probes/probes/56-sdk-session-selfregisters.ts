// Probe 56 — Does an SDK-driven session self-register in ~/.claude/sessions/<pid>.json?
//
// Why this matters for the clone: our harness calls query(), which spawns the real `claude` CLI as a
// subprocess. The binary's registry-write path (read from the 2.1.220 Mach-O) runs at session start
// for every session and unlinks on exit. If the SDK-spawned CLI takes that path, our sessions are
// ALREADY partially visible to the real `claude agents`, and "co-registration" is mostly a matter of
// enriching a row that exists rather than fabricating one.
//
// Method: snapshot the registry dir, run a turn slow enough to observe, poll during the turn, diff.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".claude", "sessions");
const snap = () => { try { return new Set(readdirSync(DIR)); } catch { return new Set<string>(); } };

const before = snap();
console.log("=== PROBE 56 SDK session self-registration ===");
console.log("registry dir:", DIR);
console.log("files before:", before.size);

const appeared = new Map<string, string>();
const poll = setInterval(() => {
  for (const f of snap()) {
    if (!before.has(f) && !appeared.has(f)) {
      let body = "";
      try { body = readFileSync(join(DIR, f), "utf8"); } catch { body = "(unreadable)"; }
      appeared.set(f, body);
      console.log(`  + ${f} -> ${body.slice(0, 400)}`);
    }
  }
}, 150);

// A turn with a little work in it, so the session lives long enough to observe.
const q = query({
  prompt: "Count from 1 to 5, one number per line. Nothing else.",
  options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", maxTurns: 1 },
});
for await (const m of q) { if ("result" in m) break; }
clearInterval(poll);

const after = snap();
console.log("files after turn:", after.size);
console.log("new files seen DURING the turn:", appeared.size);
for (const [f, body] of appeared) {
  try {
    const j = JSON.parse(body);
    console.log(`  ${f}: kind=${j.kind} entrypoint=${j.entrypoint} agent=${j.agent} status=${j.status} sessionId=${j.sessionId} procStart=${JSON.stringify(j.procStart)} sock=${JSON.stringify(j.messagingSocketPath)}`);
  } catch { console.log(`  ${f}: <unparsed> ${body.slice(0, 200)}`); }
}
console.log("");
console.log(appeared.size > 0
  ? "VERDICT: SDK-spawned sessions DO self-register (row exists while the turn runs)"
  : "VERDICT: SDK-spawned sessions do NOT self-register — we must write our own rows");
console.log(appeared.size > 0 ? "RESULT: PASS" : "RESULT: FAIL");
