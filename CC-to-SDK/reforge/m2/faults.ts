// H2 runner — replay fault-injected cassettes into A=engine-real and B=<engine>
// and diff. What matters is not that the turn succeeds (it usually must not)
// but that BOTH engines fail the SAME way: same retries, same surfaced error.
// This is the path a reimplementation is most likely to get wrong and the
// happy-path corpus can never see.
//
// Run: cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m2/faults.ts [--engineB <name>]
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts, normalizeValue } from "../src/differ.js";
import { deriveFaultCassette, type FaultKind } from "../src/faults.js";
import { resetSandbox, type ScenarioContext } from "../src/harness.js";
import { scrubRequestBody, startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, saveTranscript } from "../src/runTurn.js";
import { SCENARIOS } from "../m1/scenarios.js";

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";
const KINDS: FaultKind[] = ["overloaded", "rate-limited", "server-error", "truncated-stream", "malformed-event"];
const BASE_TAG = "plain"; // simplest healthy cassette to derive from
const scenario = SCENARIOS.find((s) => s.tag === BASE_TAG)!;
const healthy = join(REFORGE_ROOT, "cassettes", `m1-${BASE_TAG}.jsonl`);

if (!existsSync(healthy)) {
  console.error(`ABORT: base cassette missing — run: npx tsx m1/run.ts --scenario ${BASE_TAG}`);
  process.exit(1);
}

// Default backoff makes a 5-fault × 2-engine sweep run for tens of minutes.
// CLAUDE_CODE_MAX_RETRIES (an env knob present in the payload) bounds it — and
// bounding makes the suite STRICTER, not weaker: with a fixed budget the retry
// count itself becomes a diffable behavior instead of a timing artifact.
const MAX_RETRIES = process.env.REFORGE_MAX_RETRIES ?? "1";

async function replay(engine: string, cassette: string, tag: string, side: string) {
  const observed = join(REFORGE_ROOT, "cassettes", `m2-fault-${tag}-observed-${side}.jsonl`);
  rmSync(observed, { force: true });
  const proxy = await startReplayProxy(cassette, observed);
  const events: unknown[] = [];
  const ctx: ScenarioContext = {
    engine: enginePath(engine),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (e, p) => events.push({ event: e, payload: p }),
  };
  resetSandbox();
  const savedRetries = process.env.CLAUDE_CODE_MAX_RETRIES;
  process.env.CLAUDE_CODE_MAX_RETRIES = MAX_RETRIES; // reaches the engine via baseOptions' env spread
  let messages: unknown[];
  try {
    messages = await scenario.run(ctx);
  } catch (e) {
    messages = [{ type: "reforge-exception", name: (e as Error).name, message: String((e as Error).message).slice(0, 200) }];
  } finally {
    if (savedRetries === undefined) delete process.env.CLAUDE_CODE_MAX_RETRIES;
    else process.env.CLAUDE_CODE_MAX_RETRIES = savedRetries;
  }
  await proxy.close();
  const requests = existsSync(observed)
    ? readFileSync(observed, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .map((r: { method: string; path: string; requestBody: string }) => ({
          method: r.method,
          path: r.path,
          body: normalizeValue(JSON.parse(scrubRequestBody(r.requestBody) || "null")),
        }))
    : [];
  return { messages, requests };
}

const verdicts: { kind: string; pass: boolean; note: string }[] = [];

for (const kind of KINDS) {
  console.log(`\n━━━ fault: ${kind} ━━━`);
  const cassette = join(REFORGE_ROOT, "cassettes", `m2-fault-${kind}.jsonl`);
  deriveFaultCassette(healthy, cassette, kind);

  const a = await replay("engine-real", cassette, kind, "A");
  const b = await replay(engineB, cassette, kind, "B");
  saveTranscript(`m2-fault-${kind}-A`, { engine: "engine-real", messages: a.messages, durationMs: 0 });
  saveTranscript(`m2-fault-${kind}-B`, { engine: engineB, messages: b.messages, durationMs: 0 });

  // How did the engine surface it, and did it retry? Both are behavior.
  const outcome = (msgs: unknown[]) => {
    const exc = msgs.find((m) => (m as { type?: string }).type === "reforge-exception") as { message?: string } | undefined;
    if (exc) return `throw: ${String(exc.message).slice(0, 60)}`;
    const res = msgs.find((m) => (m as { type?: string }).type === "result") as { subtype?: string } | undefined;
    return res ? `result:${res.subtype}` : "no result";
  };
  const apiCalls = (reqs: unknown[]) => reqs.filter((r) => String((r as { path?: string }).path).includes("/v1/messages")).length;

  console.log(`  A(real):  ${outcome(a.messages)} | /v1/messages attempts: ${apiCalls(a.requests)}`);
  console.log(`  B(${engineB}): ${outcome(b.messages)} | /v1/messages attempts: ${apiCalls(b.requests)}`);

  const tDiff = diffTranscripts(a.messages, b.messages);
  const rDiff = diffTranscripts(a.requests, b.requests);
  for (const f of [...tDiff, ...rDiff].slice(0, 6))
    console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 70)} != ${JSON.stringify(f.b)?.slice(0, 70)}`);

  // Substance gate — the hollow-pass guard for fault testing. Before this
  // existed, the retry exhausted the cassette and every fault surfaced as the
  // PROXY's fallback 500: the engines agreed, but on the harness's own error,
  // so 529/429/truncated were never actually exercised.
  const sawFallback = JSON.stringify(a.messages).includes("reforge-replay: no cassette entry");
  if (sawFallback) console.log("    substance: FAIL — engine saw the proxy fallback, not the injected fault");
  const pass = tDiff.length === 0 && rDiff.length === 0 && !sawFallback;
  console.log(`  ${pass ? "PASS — engines fail identically on the injected fault" : "FAIL"}`);
  verdicts.push({ kind, pass, note: outcome(a.messages) });
}

console.log("\n=== M2/H2 fault-injection verdicts ===");
for (const v of verdicts) console.log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.kind.padEnd(17)} ${v.note}`);
const allPass = verdicts.every((v) => v.pass);
console.log(allPass ? "\nALL PASS" : "\nFAILURES");
process.exitCode = allPass ? 0 : 1;
