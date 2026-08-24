// H4 — the session store is a CONTRACT, not an implementation detail.
// Two claims the happy-path corpus cannot make:
//   1. cross-engine resume: a session WRITTEN by engine A must be resumable by
//      engine B (the real test of store-format equivalence; same-engine resume
//      only proves an engine agrees with itself)
//   2. filesystem equivalence: after the same workload, both engines must leave
//      structurally identical session records
//
// Run: cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m2/cross-resume.ts [--engineB <name>]
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts, normalizeValue } from "../src/differ.js";
import { baseOptions, CONFIG_DIR, drive, resetSandbox, resultsOf, type ScenarioContext } from "../src/harness.js";
import { startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT } from "../src/runTurn.js";

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";
const cassette = join(REFORGE_ROOT, "cassettes", "m1-resume.jsonl");
if (!existsSync(cassette)) {
  console.error("ABORT: resume cassette missing — run: npx tsx m1/run.ts --scenario resume");
  process.exit(1);
}

const projectsDir = join(CONFIG_DIR, "projects");
const sessionFiles = (): string[] =>
  existsSync(projectsDir)
    ? readdirSync(projectsDir).flatMap((d) =>
        readdirSync(join(projectsDir, d))
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => join(projectsDir, d, f)),
      )
    : [];

/** Structural shape of a stored session: the record types and their order. */
function storeShape(file: string): unknown {
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return rows.map((r: Record<string, unknown>) => ({
    type: r.type,
    role: (r.message as { role?: string })?.role,
    keys: Object.keys(r).sort(),
  }));
}

async function withProxy<T>(fn: (ctx: ScenarioContext) => Promise<T>, tag: string): Promise<T> {
  const proxy = await startReplayProxy(cassette, join(REFORGE_ROOT, "cassettes", `m2-xresume-observed-${tag}.jsonl`));
  const ctx: ScenarioContext = {
    engine: "",
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: () => {},
  };
  try {
    return await fn(ctx);
  } finally {
    await proxy.close();
  }
}

async function writeSession(engine: string, tag: string): Promise<{ sessionId: string; files: string[]; messages: unknown[] }> {
  rmSync(projectsDir, { recursive: true, force: true });
  resetSandbox();
  return withProxy(async (ctx) => {
    ctx.engine = enginePath(engine);
    const messages = await drive("Remember the codeword REFORGE_RESUME_BRAVO. Reply with exactly OK.", {
      ...baseOptions(ctx),
      allowedTools: [],
      maxTurns: 1,
      permissionMode: "bypassPermissions",
    });
    const init = messages.find((m) => (m as { type?: string }).type === "system") as { session_id?: string };
    return { sessionId: init?.session_id ?? "", files: sessionFiles(), messages };
  }, tag);
}

async function resumeSession(engine: string, sessionId: string, tag: string): Promise<unknown[]> {
  return withProxy(async (ctx) => {
    ctx.engine = enginePath(engine);
    return drive("Reply with exactly the codeword from earlier in this conversation.", {
      ...baseOptions(ctx),
      allowedTools: [],
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      resume: sessionId,
    });
  }, tag);
}

console.log("=== H4: cross-engine resume + session-store equivalence ===");

// --- 1. store shape written by each engine, same workload --------------------
console.log("\nwriting a session with engine-real ...");
const wroteA = await writeSession("engine-real", "writeA");
const shapeA = wroteA.files.map(storeShape);
console.log(`  session ${wroteA.sessionId.slice(0, 8)}… | files: ${wroteA.files.length} | records: ${(shapeA[0] as unknown[])?.length ?? 0}`);

console.log(`writing a session with ${engineB} ...`);
const wroteB = await writeSession(engineB, "writeB");
const shapeB = wroteB.files.map(storeShape);
console.log(`  session ${wroteB.sessionId.slice(0, 8)}… | files: ${wroteB.files.length} | records: ${(shapeB[0] as unknown[])?.length ?? 0}`);

const shapeDiff = diffTranscripts(normalizeValue(shapeA) as unknown[], normalizeValue(shapeB) as unknown[]);
console.log(`\nstore shape: ${shapeDiff.length === 0 ? "identical" : `${shapeDiff.length} difference(s)`}`);
for (const f of shapeDiff.slice(0, 8)) console.log(`  ${f.path}: ${JSON.stringify(f.a)?.slice(0, 80)} != ${JSON.stringify(f.b)?.slice(0, 80)}`);

// --- 2. cross-engine resume --------------------------------------------------
// engineB's session is on disk right now; have engine-real resume it, and vice versa.
console.log(`\ncross-resume: engine-real resumes the session written by ${engineB} ...`);
const crossA = await resumeSession("engine-real", wroteB.sessionId, "crossA");
const crossAText = String(resultsOf(crossA)[0]?.result ?? "");
console.log(`  -> ${crossAText.slice(0, 60) || "(no result)"}`);

console.log("\nre-writing with engine-real, then cross-resuming with " + engineB + " ...");
const wroteA2 = await writeSession("engine-real", "writeA2");
const crossB = await resumeSession(engineB, wroteA2.sessionId, "crossB");
const crossBText = String(resultsOf(crossB)[0]?.result ?? "");
console.log(`  -> ${crossBText.slice(0, 60) || "(no result)"}`);

// --- verdicts ----------------------------------------------------------------
const CODEWORD = "REFORGE_RESUME_BRAVO";
const okShape = shapeDiff.length === 0;
const okCrossA = crossAText.includes(CODEWORD);
const okCrossB = crossBText.includes(CODEWORD);
const okXDiff = diffTranscripts(crossA, crossB).length === 0;

console.log("\n=== verdicts ===");
console.log(`  store shape identical:              ${okShape ? "PASS" : "FAIL"}`);
console.log(`  engine-real resumes ${engineB.padEnd(18)} ${okCrossA ? "PASS" : "FAIL"}`);
console.log(`  ${engineB} resumes engine-real${" ".repeat(Math.max(1, 12 - engineB.length))} ${okCrossB ? "PASS" : "FAIL"}`);
console.log(`  both cross-resumes transcript-equal: ${okXDiff ? "PASS" : "FAIL"}`);
const ok = okShape && okCrossA && okCrossB && okXDiff;
console.log(ok ? "\nALL PASS — the store format is interchangeable across engines" : "\nFAILURES");
process.exitCode = ok ? 0 : 1;
