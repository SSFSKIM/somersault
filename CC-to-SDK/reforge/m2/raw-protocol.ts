// H5 — drive the engine WITHOUT sdk.mjs, speaking stream-json over stdio
// directly. The wrapper is a lens: it normalizes, filters, and can hide
// protocol behavior (this project's original motive was hooks that never fire
// headlessly). engine-ts must satisfy the PROTOCOL, not merely whatever the
// current wrapper chooses to surface — so the harness needs one driver that
// sees the wire unmediated.
//
// Run: cd reforge && set -a; . ../.env; set +a; npx tsx m2/raw-protocol.ts [--engineB <name>]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { diffTranscripts } from "../src/differ.js";
import { fallbackVerdict, startRecordProxy, startReplayProxy } from "../src/proxy.js";
import { CONFIG_DIR, enginePath, REFORGE_ROOT, SANDBOX, saveTranscript, sdkEnv } from "../src/runTurn.js";
import { requireRecordCredential, type EnvMode } from "../src/env.js";
import { gateCacheCheck } from "../src/leakcheck.js";

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";
/** §3.4 — set false by any fatal positional fallback; folded into the final verdict. */
let replayStrictnessOk = true;
/**
 * Its OWN cassette, not the SDK corpus's `plain` recording.
 *
 * Reusing `m1-plain.jsonl` looked economical and was quietly wrong: print mode
 * driven raw builds a materially different prompt from the same prompt text
 * driven through `sdk.mjs` (measured at this pin: 106 KB vs 77 KB, the raw path
 * additionally injecting the Agent tool's agent-type catalog). So every raw
 * replay was being served its response POSITIONALLY — invisible until §3.4 made
 * fallbacks a graded outcome. Replay topology must match recording topology;
 * `cross-resume` learned the same lesson from the other direction.
 */
const cassette = join(REFORGE_ROOT, "cassettes", "m2-raw.jsonl");

const PROMPT = "Reply with exactly the single word SELFTEST_OK and nothing else.";

/** Speak stream-json to the engine binary directly; return every wire line. */
function driveRaw(engine: string, baseUrl: string, mode: EnvMode): Promise<{ lines: unknown[]; exitCode: number | null; stderr: string }> {
  mkdirSync(SANDBOX, { recursive: true });
  const child = spawn(
    enginePath(engine),
    [
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--max-turns",
      "1",
      "--setting-sources",
      "",
    ],
    {
      cwd: SANDBOX,
      // X6 — the no-wrapper driver spawns the engine itself, so it builds the
      // same allowlisted env sdk.mjs would have been handed. This path was the
      // last one still inheriting the operator's environment wholesale.
      env: sdkEnv(mode, baseUrl),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const lines: unknown[] = [];
  let buf = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => {
    buf += c.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) {
        try {
          lines.push(JSON.parse(line));
        } catch {
          lines.push({ type: "reforge-unparseable", raw: line.slice(0, 200) });
        }
      }
    }
  });
  child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));

  child.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: PROMPT }] },
      parent_tool_use_id: null,
      session_id: "",
    }) + "\n",
  );
  child.stdin.end();

  return new Promise((resolve) => {
    child.on("close", (exitCode) => resolve({ lines, exitCode, stderr: stderr.slice(0, 400) }));
  });
}

async function run(engine: string, side: string) {
  const observed = join(REFORGE_ROOT, "cassettes", `m2-raw-observed-${side}.jsonl`);
  rmSync(observed, { force: true }); // appended to, so a stale file would blend runs
  const proxy = await startReplayProxy(cassette, observed);
  try {
    return await driveRaw(engine, `http://127.0.0.1:${proxy.port}`, "replay");
  } finally {
    if (!fallbackVerdict(engineB, side, proxy.fallbackServed())) replayStrictnessOk = false;
    await proxy.close();
  }
}

console.log("=== H5: raw stream-json protocol (no sdk.mjs) ===");

if (!existsSync(cassette) || args.includes("--rerecord")) {
  requireRecordCredential();
  const staged = `${cassette}.recording`;
  rmSync(staged, { force: true });
  console.log("  recording live through the RAW driver ...");
  const rec = await startRecordProxy(staged);
  await driveRaw("engine-real", `http://127.0.0.1:${rec.port}`, "record");
  await rec.close();
  if (!existsSync(staged)) {
    console.error("FAIL — the raw recording produced no cassette");
    process.exit(1);
  }
  // Same H1 guard the corpus runner applies: a recording that captured the
  // operator's config dir is not a cassette.
  const text = readFileSync(staged, "utf8");
  const markers: [string, string][] = [[join(homedir(), ".claude"), "operator config dir"], ["Memory index", "operator memory index"], ["@gmail.com", "operator email"]];
  const hits = markers.filter(([m]) => text.includes(m)).map(([, l]) => l);
  if (hits.length > 0 || !gateCacheCheck(CONFIG_DIR, "m2-raw/record")) {
    rmSync(staged, { force: true });
    console.error(`FAIL — raw recording rejected: ${hits.join(", ") || "gate-cache leak"}`);
    process.exit(1);
  }
  renameSync(staged, cassette);
  console.log(`  recorded ${text.split("\n").filter(Boolean).length} API exchange(s)`);
}
const a = await run("engine-real", "A");
const b = await run(engineB, "B");
saveTranscript("m2-raw-A", { engine: "engine-real", messages: a.lines, durationMs: 0 });
saveTranscript("m2-raw-B", { engine: engineB, messages: b.lines, durationMs: 0 });

const kinds = (r: { lines: unknown[] }) =>
  r.lines.map((l) => {
    const m = l as { type?: string; subtype?: string };
    return `${m.type}${m.subtype ? ":" + m.subtype : ""}`;
  });

console.log(`  A(real):  exit=${a.exitCode} lines=${a.lines.length} → ${kinds(a).join(" ")}`);
console.log(`  B(${engineB}): exit=${b.exitCode} lines=${b.lines.length} → ${kinds(b).join(" ")}`);
if (a.stderr) console.log(`  A stderr: ${a.stderr.split("\n")[0]}`);
if (b.stderr) console.log(`  B stderr: ${b.stderr.split("\n")[0]}`);

const substantive = a.lines.some((l) => (l as { type?: string }).type === "result");
console.log(`  protocol produced a result: ${substantive ? "yes" : "NO — raw driver never completed a turn"}`);

const diff = diffTranscripts(a.lines, b.lines);
console.log(`  wire lines: ${diff.length === 0 ? "identical" : `${diff.length} difference(s)`}`);
for (const f of diff.slice(0, 8)) console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 70)} != ${JSON.stringify(f.b)?.slice(0, 70)}`);

const ok = replayStrictnessOk && substantive && diff.length === 0 && a.exitCode === b.exitCode;
console.log(ok ? "\nPASS — engines are equivalent at the raw protocol layer" : "\nFAIL");
process.exitCode = ok ? 0 : 1;
