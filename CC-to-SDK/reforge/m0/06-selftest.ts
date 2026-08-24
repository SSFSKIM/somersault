// M0.6 — harness self-test on the perfect pair: engine-real vs engine-extracted
// are the SAME 2.1.241 application code in different packaging, so after
// normalization their replay transcripts must be identical. Any diff here is a
// hole in the normalization spec (or the proxy), not a behavioral difference —
// the differ grading itself before it ever grades a reimplementation.
//
// Per scenario:
//   1. record : engine-real → record proxy → real API   ⇒ cassette (once, reused)
//   2. replay : engine-real → replay proxy (offline)    ⇒ transcript A
//   3. replay : engine-extracted → replay proxy         ⇒ transcript B
//   4. diff   : transcripts A vs B  +  requests-emitted A vs B
// Run:  cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m0/06-selftest.ts
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts, normalizeValue } from "../src/differ.js";
import { scrubRequestBody, startRecordProxy, startReplayProxy } from "../src/proxy.js";
import { REFORGE_ROOT, runTurn, saveTranscript, type TurnCapture } from "../src/runTurn.js";

interface Scenario {
  tag: string;
  prompt: string;
  allowedTools: string[];
  maxTurns: number;
}

const SCENARIOS: Scenario[] = [
  {
    tag: "plain",
    prompt: "Reply with exactly the single word SELFTEST_OK and nothing else.",
    allowedTools: [],
    maxTurns: 1,
  },
  {
    tag: "tool",
    prompt: "Use the Bash tool to run exactly `echo REFORGE_TOOL_OK` and then report its output verbatim.",
    allowedTools: ["Bash"],
    maxTurns: 3,
  },
];

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.error("ABORT: no auth in env — source CC-to-SDK/.env first.");
  process.exit(1);
}
mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });

async function proxiedTurn(engine: string, port: number, s: Scenario): Promise<TurnCapture> {
  return runTurn({
    engine,
    prompt: s.prompt,
    allowedTools: s.allowedTools,
    maxTurns: s.maxTurns,
    env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` },
  });
}

function report(label: string, findings: ReturnType<typeof diffTranscripts>): boolean {
  if (findings.length === 0) {
    console.log(`  ${label}: IDENTICAL after normalization`);
    return true;
  }
  console.log(`  ${label}: ${findings.length} difference(s)`);
  for (const f of findings.slice(0, 12)) {
    console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 90)}  !=  ${JSON.stringify(f.b)?.slice(0, 90)}`);
  }
  return false;
}

function loadObservedRequests(file: string): unknown[] {
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

let allPass = true;

for (const s of SCENARIOS) {
  console.log(`\n━━━ scenario: ${s.tag} ━━━`);
  const cassette = join(REFORGE_ROOT, "cassettes", `m06-${s.tag}.jsonl`);

  // -- 1. record (live, once per scenario) ------------------------------------
  if (existsSync(cassette) && !process.argv.includes("--rerecord")) {
    console.log("cassette exists — reusing (pass --rerecord to refresh)");
  } else {
    rmSync(cassette, { force: true });
    const rec = await startRecordProxy(cassette);
    console.log(`recording via 127.0.0.1:${rec.port} → api.anthropic.com ...`);
    const aRecord = await proxiedTurn("engine-real", rec.port, s);
    await rec.close();
    saveTranscript(`m06-${s.tag}-A-record`, aRecord);
    const entries = readFileSync(cassette, "utf8").split("\n").filter(Boolean).length;
    console.log(`recorded ${entries} API exchange(s):`, cassette);
  }

  // -- 2+3. replay both engines offline ---------------------------------------
  const observedOf: Record<string, string> = {};
  async function replayThrough(engine: string, side: string): Promise<TurnCapture> {
    const observed = join(REFORGE_ROOT, "cassettes", `m06-${s.tag}-observed-${side}.jsonl`);
    rmSync(observed, { force: true });
    observedOf[side] = observed;
    const rp = await startReplayProxy(cassette, observed);
    const capture = await proxiedTurn(engine, rp.port, s);
    const unmatched = rp.unmatched();
    const unserved = rp.unserved();
    await rp.close();
    if (unmatched.length > 0) console.log(`  WARN ${side}: ${unmatched.length} request(s) matched no cassette entry`);
    if (unserved.length > 0) console.log(`  WARN ${side}: ${unserved.length} cassette entr(ies) never served`);
    saveTranscript(`m06-${s.tag}-${side}`, capture);
    return capture;
  }

  console.log("replay: engine-real (A) ...");
  const aReplay = await replayThrough("engine-real", "A");
  console.log("replay: engine-extracted (B) ...");
  const bReplay = await replayThrough("engine-extracted", "B");

  // -- 4. diff ----------------------------------------------------------------
  const tOk = report("transcripts A vs B", diffTranscripts(aReplay.messages, bReplay.messages));
  const reqA = loadObservedRequests(observedOf["A"]);
  const reqB = loadObservedRequests(observedOf["B"]);
  const rOk = report("requests-emitted A vs B", diffTranscripts(reqA, reqB));
  allPass &&= tOk && rOk;
}

console.log(
  allPass
    ? "\nPASS — differ + proxy + normalization spec hold on the identical-code pair (all scenarios)"
    : "\nFAIL — normalization spec or proxy has holes; fix before grading any reimplementation",
);
process.exitCode = allPass ? 0 : 1;
