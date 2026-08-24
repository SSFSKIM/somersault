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

/**
 * The cassette was recorded by the `resume` scenario across BOTH of its queries
 * through ONE proxy, so replay must use one proxy too. A fresh proxy per query
 * restarts the consumed set, and the resume turn is then served the FIRST turn's
 * response by positional fallback — which is exactly how this suite failed once
 * the cassette stopped hash-matching. Replay topology must mirror recording
 * topology.
 */
async function withSharedProxy<T>(tag: string, fn: (mk: () => ScenarioContext) => Promise<T>): Promise<T> {
  const proxy = await startReplayProxy(cassette, join(REFORGE_ROOT, "cassettes", `m2-xresume-observed-${tag}.jsonl`));
  const mk = (): ScenarioContext => ({ engine: "", baseUrl: `http://127.0.0.1:${proxy.port}`, collect: () => {} });
  try {
    return await fn(mk);
  } finally {
    const fb = proxy.fallbackServed();
    if (fb > 0) console.log(`  WARN ${tag}: ${fb} request(s) served POSITIONALLY (body hash missed — cassette may be stale)`);
    await proxy.close();
  }
}

/**
 * One proxy, both queries — write a session then resume it, exactly as the
 * cassette was recorded. `writer` creates the session; `resumer` resumes it.
 */
async function writeThenResume(
  writer: string,
  resumer: string,
  tag: string,
): Promise<{ sessionId: string; files: string[]; wrote: unknown[]; resumed: unknown[] }> {
  rmSync(projectsDir, { recursive: true, force: true });
  resetSandbox();
  return withSharedProxy(tag, async (mk) => {
    const w = mk();
    w.engine = enginePath(writer);
    const wrote = await drive("Remember the codeword REFORGE_RESUME_BRAVO. Reply with exactly OK.", {
      ...baseOptions(w),
      allowedTools: [],
      maxTurns: 1,
      permissionMode: "bypassPermissions",
    });
    const init = wrote.find((m) => (m as { type?: string }).type === "system") as { session_id?: string };
    const sessionId = init?.session_id ?? "";
    const files = sessionFiles();

    const r = mk();
    r.engine = enginePath(resumer);
    const resumed = await drive("Reply with exactly the codeword from earlier in this conversation.", {
      ...baseOptions(r),
      allowedTools: [],
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      resume: sessionId,
    });
    return { sessionId, files, wrote, resumed };
  });
}

console.log("=== H4: cross-engine resume + session-store equivalence ===");

// --- 1. store shape written by each engine, same workload; the cross-resume in
// each pair is the real interchange test (writer != resumer) -----------------
console.log(`\nengine-real writes, ${engineB} resumes ...`);
const pairA = await writeThenResume("engine-real", engineB, "realWrites");
const shapeA = pairA.files.map(storeShape);
const crossBText = String(resultsOf(pairA.resumed)[0]?.result ?? "");
console.log(`  session ${pairA.sessionId.slice(0, 8)}… | records: ${(shapeA[0] as unknown[])?.length ?? 0} | resumed -> ${crossBText.slice(0, 40) || "(no result)"}`);

console.log(`\n${engineB} writes, engine-real resumes ...`);
const pairB = await writeThenResume(engineB, "engine-real", "engineBWrites");
const shapeB = pairB.files.map(storeShape);
const crossAText = String(resultsOf(pairB.resumed)[0]?.result ?? "");
console.log(`  session ${pairB.sessionId.slice(0, 8)}… | records: ${(shapeB[0] as unknown[])?.length ?? 0} | resumed -> ${crossAText.slice(0, 40) || "(no result)"}`);

const shapeDiff = diffTranscripts(normalizeValue(shapeA) as unknown[], normalizeValue(shapeB) as unknown[]);
console.log(`\nstore shape: ${shapeDiff.length === 0 ? "identical" : `${shapeDiff.length} difference(s)`}`);
for (const f of shapeDiff.slice(0, 8)) console.log(`  ${f.path}: ${JSON.stringify(f.a)?.slice(0, 80)} != ${JSON.stringify(f.b)?.slice(0, 80)}`);

const crossA = pairB.resumed;
const crossB = pairA.resumed;

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
