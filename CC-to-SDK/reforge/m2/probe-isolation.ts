// M2b/H1 probe — can the harness run against an ISOLATED config dir without
// changing engine behavior? Isolation is what stops corpus runs from writing
// into the user's real ~/.claude (63 session files already leaked), but a fresh
// dir may trip first-run/onboarding state that alters what the engine does.
//
// Decisive comparison: same cassette, same engine, shared-config vs isolated
// config. If the transcripts and emitted requests match, isolation is free.
//
// Run:  cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m2/probe-isolation.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffTranscripts, normalizeValue } from "../src/differ.js";
import { resetSandbox, type ScenarioContext } from "../src/harness.js";
import { scrubRequestBody, startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT } from "../src/runTurn.js";
import { SCENARIOS } from "../m1/scenarios.js";

const TAG = "bash-tool"; // exercises a tool, a hook-free path, and two API round-trips
const scenario = SCENARIOS.find((s) => s.tag === TAG)!;
const cassette = join(REFORGE_ROOT, "cassettes", `m1-${TAG}.jsonl`);
if (!existsSync(cassette)) {
  console.error(`ABORT: cassette missing (${cassette}) — run m1/run.ts --scenario ${TAG} first.`);
  process.exit(1);
}

const realConfigDir = join(process.env.HOME!, ".claude");
const projectsDir = join(realConfigDir, "projects");
const countRealSessions = () =>
  readdirSync(projectsDir)
    .filter((d) => d.includes("reforge-sandbox"))
    .reduce((n, d) => n + readdirSync(join(projectsDir, d)).filter((f) => f.endsWith(".jsonl")).length, 0);

async function run(label: string, configDir: string | null) {
  const observed = join(REFORGE_ROOT, "cassettes", `m2-iso-observed-${label}.jsonl`);
  rmSync(observed, { force: true });
  const proxy = await startReplayProxy(cassette, observed);
  const events: unknown[] = [];
  const baseCtx: ScenarioContext = {
    engine: enginePath("engine-real"),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (e, p) => events.push({ event: e, payload: p }),
  };
  // inject CLAUDE_CONFIG_DIR by wrapping the scenario's env through process.env
  const savedEnv = process.env.CLAUDE_CONFIG_DIR;
  if (configDir) process.env.CLAUDE_CONFIG_DIR = configDir;
  else delete process.env.CLAUDE_CONFIG_DIR;
  resetSandbox();
  let messages: unknown[];
  try {
    messages = await scenario.run(baseCtx);
  } finally {
    if (savedEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedEnv;
    await proxy.close();
  }
  const requests = readFileSync(observed, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((r: { method: string; path: string; requestBody: string }) => ({
      method: r.method,
      path: r.path,
      body: normalizeValue(JSON.parse(scrubRequestBody(r.requestBody) || "null")),
    }));
  return { messages, events, requests };
}

console.log("=== M2b/H1 probe: CLAUDE_CONFIG_DIR isolation ===");

const before = countRealSessions();
console.log(`real ~/.claude reforge-sandbox sessions BEFORE: ${before}`);

console.log("\nrun 1: shared config (current behavior) ...");
const shared = await run("shared", null);
const afterShared = countRealSessions();
console.log(`  real-store sessions after: ${afterShared} (+${afterShared - before})`);

const isoDir = mkdtempSync(join(tmpdir(), "reforge-config-"));
mkdirSync(isoDir, { recursive: true });
console.log(`\nrun 2: isolated config (${isoDir}) ...`);
const isolated = await run("isolated", isoDir);
const afterIso = countRealSessions();
console.log(`  real-store sessions after: ${afterIso} (+${afterIso - afterShared})`);

const isoSessions = existsSync(join(isoDir, "projects"))
  ? readdirSync(join(isoDir, "projects")).reduce(
      (n, d) => n + readdirSync(join(isoDir, "projects", d)).filter((f) => f.endsWith(".jsonl")).length,
      0,
    )
  : 0;
console.log(`  isolated-store sessions written: ${isoSessions}`);

console.log("\n--- behavioral equivalence (shared vs isolated) ---");
const tDiff = diffTranscripts(shared.messages, isolated.messages);
const rDiff = diffTranscripts(shared.requests, isolated.requests);
const show = (label: string, d: ReturnType<typeof diffTranscripts>) => {
  console.log(`  ${label}: ${d.length === 0 ? "identical" : `${d.length} difference(s)`}`);
  for (const f of d.slice(0, 8)) console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 80)} != ${JSON.stringify(f.b)?.slice(0, 80)}`);
};
show("transcripts", tDiff);
show("requests", rDiff);

const contained = afterIso - afterShared === 0 && isoSessions > 0;
console.log("\n=== verdict ===");
console.log(`  isolation contains writes: ${contained ? "YES" : "NO"} (real +${afterIso - afterShared}, isolated ${isoSessions})`);
console.log(`  behavior unchanged: ${tDiff.length === 0 && rDiff.length === 0 ? "YES" : "NO"}`);
console.log(
  contained && tDiff.length === 0 && rDiff.length === 0
    ? "\nISOLATION IS FREE — adopt CLAUDE_CONFIG_DIR in baseOptions"
    : "\nISOLATION HAS A COST — inspect diffs before adopting",
);
rmSync(isoDir, { recursive: true, force: true });
