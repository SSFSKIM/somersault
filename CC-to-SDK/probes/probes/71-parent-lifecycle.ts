// Probe 71 helper — the PARENT process under test. argv: <dir> <mode: exit|kill>
//
// It holds two kinds of child at once:
//   (A) an SDK-owned engine subprocess — a real `query()` whose engine process we substitute via the
//       SDK's own `spawnClaudeCodeProcess` seam (probe 50 verified that seam runs end to end), so the
//       child is under the SDK's real lifecycle management (registered in its process-exit kill set,
//       fed by the SDK's stdin pipe) but reports its own fate instead of needing credentials.
//   (B) a DETACHED sibling process it merely started (`detached:true` + `unref()`), the shape
//       `ccx --bg` uses for a background session host.
// Then it either exits cleanly (mode=exit) or waits to be SIGKILLed (mode=kill).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [dir, mode] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const worker = join(here, "71-worker-child.mjs");

// (B) detached sibling — the ccx --bg shape.
const det = spawn(process.execPath, [worker, dir, "detached"], {
  detached: true, stdio: "ignore", env: process.env,
});
det.unref();

// (A) SDK-owned engine subprocess via the documented custom-spawn seam.
const q = query({
  prompt: "unused — the substitute engine never answers",
  options: {
    permissionMode: "bypassPermissions",
    maxTurns: 1,
    spawnClaudeCodeProcess: (_opts: any) =>
      spawn(process.execPath, [worker, dir, "inproc"], { stdio: ["pipe", "pipe", "pipe"], env: process.env }),
  } as any,
});
// Start consuming so the SDK actually spawns and wires the transport; it will never yield a message.
void (async () => { try { for await (const _ of q) { /* never */ } } catch { /* transport dies with us */ } })();

setTimeout(() => {
  writeFileSync(join(dir, "parent.pid"), String(process.pid));
  if (mode === "exit") {
    writeFileSync(join(dir, "parent.mode"), "exiting-cleanly");
    process.exit(0);                 // triggers the SDK's process.on("exit") cleanup path
  }
  writeFileSync(join(dir, "parent.mode"), "waiting-for-sigkill");
}, 1500);

// mode=kill: idle until the driver SIGKILLs us.
setInterval(() => {}, 1000);
