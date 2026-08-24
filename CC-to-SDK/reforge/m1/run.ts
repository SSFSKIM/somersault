// M1 corpus runner — for every scenario: ensure a cassette exists (recorded
// live once through engine-real), then replay it OFFLINE into engine-real (A)
// and engine-extracted (B) and diff three behavioral surfaces:
//   1. SDK message transcripts   2. harness-side events (hooks/permission consults)
//   3. the API requests each engine emitted
// On the identical-code pair every diff is a harness/normalization defect; once
// engine-ts exists, every diff is a reimplementation defect.
//
// Run:  cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m1/run.ts [--scenario <tag>] [--rerecord]
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts, normalizeValue, type DiffFinding } from "../src/differ.js";
import { resetSandbox, type Scenario, type ScenarioContext } from "../src/harness.js";
import { scrubRequestBody, startRecordProxy, startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, saveTranscript } from "../src/runTurn.js";
import { SCENARIOS } from "./scenarios.js";

const args = process.argv.slice(2);
const only = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : undefined;
const rerecord = args.includes("--rerecord");

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.error("ABORT: no auth in env — source CC-to-SDK/.env first.");
  process.exit(1);
}
mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });

interface RunResult {
  messages: unknown[];
  events: unknown[];
  observedFile: string;
}

async function runOnce(s: Scenario, engineName: string, mode: "record" | "replay", cassette: string, side: string): Promise<RunResult> {
  const observedFile = join(REFORGE_ROOT, "cassettes", `m1-${s.tag}-observed-${side}.jsonl`);
  rmSync(observedFile, { force: true });
  const proxy =
    mode === "record" ? await startRecordProxy(cassette) : await startReplayProxy(cassette, observedFile);
  const events: unknown[] = [];
  const ctx: ScenarioContext = {
    engine: enginePath(engineName),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (event, payload) => events.push({ event, payload }),
  };
  resetSandbox();
  let messages: unknown[];
  try {
    messages = await s.run(ctx);
  } catch (e) {
    messages = [{ type: "reforge-exception", name: (e as Error).name, message: String((e as Error).message).slice(0, 200) }];
  }
  const unmatched = mode === "replay" ? proxy.unmatched() : [];
  const unserved = mode === "replay" ? proxy.unserved() : [];
  await proxy.close();
  if (unmatched.length > 0) console.log(`    WARN ${side}: ${unmatched.length} request(s) matched no cassette entry`);
  if (unserved.length > 0) console.log(`    WARN ${side}: ${unserved.length} cassette entr(ies) never served`);
  return { messages, events, observedFile };
}

function loadObservedRequests(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((r: { method: string; path: string; requestBody: string }) => ({
      method: r.method,
      path: r.path,
      body: normalizeValue(JSON.parse(scrubRequestBody(r.requestBody) || "null")),
    }));
}

function report(label: string, findings: DiffFinding[]): boolean {
  if (findings.length === 0) {
    console.log(`    ${label}: identical`);
    return true;
  }
  console.log(`    ${label}: ${findings.length} difference(s)`);
  for (const f of findings.slice(0, 10)) {
    console.log(`      ${f.path}: ${JSON.stringify(f.a)?.slice(0, 100)}  !=  ${JSON.stringify(f.b)?.slice(0, 100)}`);
  }
  return false;
}

const verdicts: { tag: string; pass: boolean }[] = [];

for (const s of SCENARIOS) {
  if (only && s.tag !== only) continue;
  console.log(`\n━━━ ${s.tag} — ${s.title} ━━━`);
  const cassette = join(REFORGE_ROOT, "cassettes", `m1-${s.tag}.jsonl`);

  if (!existsSync(cassette) || rerecord) {
    rmSync(cassette, { force: true });
    console.log("  recording live via engine-real ...");
    const rec = await runOnce(s, "engine-real", "record", cassette, "record");
    saveTranscript(`m1-${s.tag}-record`, { engine: "engine-real", messages: rec.messages, durationMs: 0 });
    const entries = existsSync(cassette) ? readFileSync(cassette, "utf8").split("\n").filter(Boolean).length : 0;
    console.log(`  recorded ${entries} API exchange(s)`);
  } else {
    console.log("  cassette exists — reusing");
  }

  console.log("  replaying offline: A=engine-real, B=engine-extracted ...");
  const a = await runOnce(s, "engine-real", "replay", cassette, "A");
  const b = await runOnce(s, "engine-extracted", "replay", cassette, "B");
  saveTranscript(`m1-${s.tag}-A`, { engine: "engine-real", messages: a.messages, durationMs: 0 });
  saveTranscript(`m1-${s.tag}-B`, { engine: "engine-extracted", messages: b.messages, durationMs: 0 });

  const tOk = report("transcripts", diffTranscripts(a.messages, b.messages));
  const eOk = report("events", diffTranscripts(a.events, b.events));
  const rOk = report("requests", diffTranscripts(loadObservedRequests(a.observedFile), loadObservedRequests(b.observedFile)));
  // substance check — guards the hollow-pass class (identical-but-empty behavior)
  const failure = s.check?.(a.messages, a.events) ?? null;
  if (failure) console.log(`    substance: FAIL — ${failure}`);
  else if (s.check) console.log("    substance: ok");
  verdicts.push({ tag: s.tag, pass: tOk && eOk && rOk && !failure });
}

console.log("\n=== M1 corpus verdicts ===");
for (const v of verdicts) console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.tag}`);
const allPass = verdicts.every((v) => v.pass);
console.log(allPass ? "\nALL PASS" : "\nFAILURES — on the identical-code pair these are harness defects; fix before grading engine-ts");
process.exitCode = allPass ? 0 : 1;
