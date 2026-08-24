// H3 — partial-message streaming. ccx renders off `includePartialMessages`
// stream events, so their SHAPE and ORDER are load-bearing behavior that the
// final-message corpus cannot see: an engine could batch deltas differently,
// coalesce text, or reorder block starts and still produce identical final
// messages.
//
// Diffing raw deltas verbatim would be brittle (chunk boundaries are not
// semantics), so this grades the two things that are: the ordered sequence of
// stream_event TYPES, and the reassembled text those deltas add up to.
//
// Run: cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m2/partials.ts [--engineB <name>]
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diffTranscripts } from "../src/differ.js";
import { baseOptions, drive, resetSandbox, type ScenarioContext } from "../src/harness.js";
import { startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, saveTranscript } from "../src/runTurn.js";

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";
const cassette = join(REFORGE_ROOT, "cassettes", "m1-plain.jsonl");
if (!existsSync(cassette)) {
  console.error("ABORT: plain cassette missing — run: npx tsx m1/run.ts --scenario plain");
  process.exit(1);
}

async function run(engine: string, side: string): Promise<unknown[]> {
  const observed = join(REFORGE_ROOT, "cassettes", `m2-partials-observed-${side}.jsonl`);
  rmSync(observed, { force: true });
  const proxy = await startReplayProxy(cassette, observed);
  const ctx: ScenarioContext = {
    engine: enginePath(engine),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: () => {},
  };
  resetSandbox();
  try {
    return await drive("Reply with exactly the single word SELFTEST_OK and nothing else.", {
      ...baseOptions(ctx),
      allowedTools: [],
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
    });
  } finally {
    await proxy.close();
  }
}

/** Ordered stream_event type sequence — the shape of the stream. */
const eventShape = (msgs: unknown[]) =>
  msgs
    .filter((m) => (m as { type?: string }).type === "stream_event")
    .map((m) => {
      const e = (m as { event?: { type?: string; delta?: { type?: string }; content_block?: { type?: string } } }).event;
      return [e?.type, e?.content_block?.type ?? e?.delta?.type].filter(Boolean).join(":");
    });

/** Text reassembled from deltas — must equal what the final message says. */
const reassembled = (msgs: unknown[]) =>
  msgs
    .filter((m) => (m as { type?: string }).type === "stream_event")
    .map((m) => (m as { event?: { delta?: { type?: string; text?: string } } }).event)
    .filter((e) => e?.delta?.type === "text_delta")
    .map((e) => e!.delta!.text ?? "")
    .join("");

const finalText = (msgs: unknown[]) => {
  const res = msgs.find((m) => (m as { type?: string }).type === "result") as { result?: string } | undefined;
  return String(res?.result ?? "");
};

console.log("=== H3: partial-message streaming ===");
const a = await run("engine-real", "A");
const b = await run(engineB, "B");
saveTranscript("m2-partials-A", { engine: "engine-real", messages: a, durationMs: 0 });
saveTranscript("m2-partials-B", { engine: engineB, messages: b, durationMs: 0 });

const shapeA = eventShape(a);
const shapeB = eventShape(b);
console.log(`  stream events: A=${shapeA.length} B=${shapeB.length}`);
console.log(`  A shape: ${shapeA.slice(0, 8).join(" → ")}${shapeA.length > 8 ? " …" : ""}`);

const substantive = shapeA.length > 0;
console.log(`  partials actually streamed: ${substantive ? "yes" : "NO — includePartialMessages produced nothing"}`);

const shapeDiff = diffTranscripts(shapeA, shapeB);
console.log(`  event-type sequence: ${shapeDiff.length === 0 ? "identical" : `${shapeDiff.length} difference(s)`}`);
for (const f of shapeDiff.slice(0, 8)) console.log(`    ${f.path}: ${JSON.stringify(f.a)} != ${JSON.stringify(f.b)}`);

const textA = reassembled(a);
const textB = reassembled(b);
console.log(`  reassembled text: A=${JSON.stringify(textA.slice(0, 40))} B=${JSON.stringify(textB.slice(0, 40))}`);
const coherentA = finalText(a).includes(textA.trim()) && textA.trim().length > 0;
console.log(`  deltas reassemble to the final message: ${coherentA ? "yes" : "NO"}`);

// full-transcript diff too — partials included
const fullDiff = diffTranscripts(a, b);
console.log(`  full transcript (partials included): ${fullDiff.length === 0 ? "identical" : `${fullDiff.length} difference(s)`}`);
for (const f of fullDiff.slice(0, 6)) console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 70)} != ${JSON.stringify(f.b)?.slice(0, 70)}`);

const ok = substantive && shapeDiff.length === 0 && textA === textB && coherentA && fullDiff.length === 0;
console.log(ok ? "\nPASS — partial streams are equivalent and coherent" : "\nFAIL");
process.exitCode = ok ? 0 : 1;
