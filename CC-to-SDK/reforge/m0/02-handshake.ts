// M0.2 — handshake: does sdk.mjs (0.3.237) complete a full live turn against the
// EXTRACTED payload (the pinned version) running as plain JS under bun, as it would
// against a real binary? Decisive signals:
//   1. system:init arrives (stream-json handshake works) and reports the engine identity
//   2. the turn completes with a result carrying the expected text + usage
// Run:  cd reforge && set -a; . ../.env; set +a; npx tsx m0/02-handshake.ts
import { runTurn, saveTranscript } from "../src/runTurn.js";
import { requireRecordCredential } from "../src/env.js";

const TOKEN_PHRASE = "HANDSHAKE_OK";

const engines = process.argv.slice(2);
const targets = engines.length > 0 ? engines : ["engine-extracted", "engine-real"];

requireRecordCredential(); // live turns — needs the one selected credential (X6)

for (const engine of targets) {
  console.log(`\n=== M0.2 handshake: ${engine} ===`);
  const capture = await runTurn({
    engine,
    prompt: `Reply with exactly the single word ${TOKEN_PHRASE} and nothing else.`,
  });
  const init = capture.messages.find((m: any) => m?.type === "system" && m?.subtype === "init") as any;
  const result = capture.messages.find((m: any) => m?.type === "result") as any;
  console.log("messages:", capture.messages.map((m: any) => `${m.type}${m.subtype ? ":" + m.subtype : ""}`).join(" "));
  console.log("init:", init ? { model: init.model, tools: init.tools?.length, apiKeySource: init.apiKeySource, agentVersion: init.agent_version ?? init.version } : "(MISSING)");
  console.log("result:", result ? {
    subtype: result.subtype,
    text: String(result.result ?? "").slice(0, 60),
    turns: result.num_turns,
    usage: result.usage ? { in: result.usage.input_tokens, out: result.usage.output_tokens } : undefined,
  } : "(MISSING)");
  const ok = Boolean(init) && result?.subtype === "success" && String(result.result).includes(TOKEN_PHRASE);
  console.log(ok ? `PASS — ${engine} completed a full turn through sdk.mjs` : `FAIL — see transcript`);
  console.log("transcript:", saveTranscript(`m02-${engine}`, capture));
  if (!ok) process.exitCode = 1;
}
