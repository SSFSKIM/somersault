// Probe 71 — What survives the death of the harness process? (doperpowers P2, part b/c)
//
// Design question: can a subagent run as its OWN harness session that survives the parent session
// dying? Part (a) (probe 70b) settled that a native Task subagent is a SUBFILE of the parent session,
// not a session. This probe settles the PROCESS half — the "6 shells + 5 subagents die with the
// session" failure case — and it does so WITHOUT credentials, by substituting the engine subprocess
// through the SDK's own `spawnClaudeCodeProcess` seam and by exercising the real bundled `claude`
// binary's stdin coupling.
//
// Three cases, two parent-death modes:
//   A. SDK-owned engine subprocess (what an in-process session/teammate/subagent runs inside)
//   B. detached sibling process (the `ccx --bg` shape)
//   C. the REAL bundled `claude` CLI in the SDK's own stream-json mode: what does it do when the
//      stdin pipe its parent held goes away? (no turn is ever submitted, so no tokens are spent)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = join(here, "..", "node_modules", ".bin", "tsx");
const parentScript = join(here, "71-parent-lifecycle.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readPid = (dir: string, tag: string) => Number(readFileSync(join(dir, `${tag}.pid`), "utf8"));
const events = (dir: string, tag: string) => existsSync(join(dir, `${tag}.events`)) ? readFileSync(join(dir, `${tag}.events`), "utf8").trim().split("\n").map((l) => l.split(" @")[0]) : [];
const beat = (dir: string, tag: string) => existsSync(join(dir, `${tag}.beat`)) ? Number(readFileSync(join(dir, `${tag}.beat`), "utf8")) : 0;

async function waitFor(pred: () => boolean, ms = 20_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(200); }
  return false;
}

async function runCase(mode: "exit" | "kill") {
  const dir = mkdtempSync(join(tmpdir(), `probe71-${mode}-`));
  console.log(`\n########## parent death mode: ${mode.toUpperCase()} ##########`);
  console.log("scratch:", dir);
  const p = spawn(tsx, [parentScript, dir, mode], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let perr = "";
  p.stderr.on("data", (b) => { perr += String(b); });

  const ready = await waitFor(() => existsSync(join(dir, "inproc.pid")) && existsSync(join(dir, "detached.pid")) && existsSync(join(dir, "parent.pid")));
  if (!ready) { console.log("SETUP FAILED — children never registered. parent stderr tail:", perr.slice(-600)); return; }
  const parentPid = readPid(dir, "parent"), inprocPid = readPid(dir, "inproc"), detPid = readPid(dir, "detached");
  console.log(`pids: parent=${parentPid} sdk-engine-child=${inprocPid} detached-sibling=${detPid}`);
  console.log(`before: engine alive=${alive(inprocPid)} detached alive=${alive(detPid)}`);

  if (mode === "kill") {
    await sleep(1200);
    process.kill(parentPid, "SIGKILL");
    console.log("parent SIGKILLed");
  } else {
    await waitFor(() => !alive(parentPid), 15_000);
    console.log("parent exited cleanly (process.exit(0))");
  }
  await waitFor(() => !alive(parentPid), 10_000);

  // Give any death signal / EOF time to land, then sample twice to distinguish "alive" from "zombie".
  await sleep(2500);
  const beat1 = beat(dir, "detached");
  const engineAlive1 = alive(inprocPid), detAlive1 = alive(detPid);
  await sleep(1500);
  const beat2 = beat(dir, "detached");

  console.log(`\nAFTER parent death (${mode}):`);
  console.log(`  SDK engine child  : alive=${engineAlive1}  events=${JSON.stringify(events(dir, "inproc"))}`);
  console.log(`  detached sibling  : alive=${detAlive1}  events=${JSON.stringify(events(dir, "detached"))}  heartbeat advancing=${beat2 > beat1}`);
  if (alive(detPid)) process.kill(detPid, "SIGKILL");
  if (alive(inprocPid)) process.kill(inprocPid, "SIGKILL");
  if (alive(parentPid)) process.kill(parentPid, "SIGKILL");
  return { engineAlive: engineAlive1, engineEvents: events(dir, "inproc"), detAlive: detAlive1, detBeats: beat2 > beat1 };
}

console.log("=== PROBE 71 what survives the harness process? (keyless) ===");
const exitCase = await runCase("exit");
const killCase = await runCase("kill");

// --- Case C: the REAL bundled claude CLI, stdin coupling only (no turn submitted, no tokens) -----
console.log("\n########## case C: real bundled `claude` CLI, stdin coupling ##########");
const sdkPkg = join(here, "..", "node_modules", "@anthropic-ai");
const platformPkg = readdirSync(sdkPkg).find((d) => d.startsWith("claude-agent-sdk-") && existsSync(join(sdkPkg, d, "claude")));
const bin = platformPkg ? join(sdkPkg, platformPkg, "claude") : undefined;
console.log("bundled binary:", bin ?? "(not found)");
if (bin) {
  // Exactly the SDK's own argv shape for a headless streaming session (ProcessTransport.initialize).
  const args = ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--permission-mode", "bypassPermissions"];
  const c = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" } });
  let exited: { code: number | null; sig: string | null } | undefined;
  c.on("exit", (code, sig) => { exited = { code, sig }; });
  await sleep(3000);
  console.log(`  spawned pid=${c.pid}; alive after 3s: ${!exited}`);
  c.stdin.end();                       // exactly what happens when the SDK parent goes away
  const gone = await waitFor(() => !!exited, 15_000);
  console.log(`  after stdin EOF: exited=${gone} ${JSON.stringify(exited ?? {})}`);
  if (!gone) c.kill("SIGKILL");
}

console.log("\n=== SUMMARY ===");
console.log("clean parent exit :", JSON.stringify(exitCase));
console.log("parent SIGKILL    :", JSON.stringify(killCase));
