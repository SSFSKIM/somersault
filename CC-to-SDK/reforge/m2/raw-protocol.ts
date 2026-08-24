// H5 — drive the engine WITHOUT sdk.mjs, speaking stream-json over stdio
// directly. The wrapper is a lens: it normalizes, filters, and can hide
// protocol behavior (this project's original motive was hooks that never fire
// headlessly). engine-ts must satisfy the PROTOCOL, not merely whatever the
// current wrapper chooses to surface — so the harness needs one driver that
// sees the wire unmediated.
//
// Run: cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m2/raw-protocol.ts [--engineB <name>]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts } from "../src/differ.js";
import { CONFIG_DIR } from "../src/harness.js";
import { startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, SANDBOX, saveTranscript } from "../src/runTurn.js";

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";
const cassette = join(REFORGE_ROOT, "cassettes", "m1-plain.jsonl");
if (!existsSync(cassette)) {
  console.error("ABORT: plain cassette missing — run: npx tsx m1/run.ts --scenario plain");
  process.exit(1);
}

const PROMPT = "Reply with exactly the single word SELFTEST_OK and nothing else.";

/** Speak stream-json to the engine binary directly; return every wire line. */
function driveRaw(engine: string, baseUrl: string): Promise<{ lines: unknown[]; exitCode: number | null; stderr: string }> {
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
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: CONFIG_DIR,
        ANTHROPIC_BASE_URL: baseUrl,
        DISABLE_TELEMETRY: "1",
        DISABLE_ERROR_REPORTING: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
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
  const proxy = await startReplayProxy(cassette, join(REFORGE_ROOT, "cassettes", `m2-raw-observed-${side}.jsonl`));
  try {
    return await driveRaw(engine, `http://127.0.0.1:${proxy.port}`);
  } finally {
    await proxy.close();
  }
}

console.log("=== H5: raw stream-json protocol (no sdk.mjs) ===");
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

const ok = substantive && diff.length === 0 && a.exitCode === b.exitCode;
console.log(ok ? "\nPASS — engines are equivalent at the raw protocol layer" : "\nFAIL");
process.exitCode = ok ? 0 : 1;
