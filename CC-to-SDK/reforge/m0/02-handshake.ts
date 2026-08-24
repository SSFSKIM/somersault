// M0.2 — handshake: does sdk.mjs (0.3.237) complete a full live turn against the
// EXTRACTED 2.1.241 payload running as plain JS under bun, exactly as it would
// against a real binary? Decisive signals:
//   1. system:init arrives (stream-json handshake works) and reports the engine identity
//   2. the turn completes with a result carrying the expected text + usage
// Run:  cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m0/02-handshake.ts
import { runTurn, saveTranscript } from "../src/runTurn.js";

const TOKEN_PHRASE = "HANDSHAKE_OK";

const engines = process.argv.slice(2);
const targets = engines.length > 0 ? engines : ["engine-extracted", "engine-real"];

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.error("ABORT: no CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY in env — source CC-to-SDK/.env first.");
  process.exit(1);
}

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
