// X6 — the end-to-end proof that a real credential never reaches the engine.
//
// The schema test (`src/env.test.ts`) proves what `engineEnv` BUILDS. This proves
// what actually happens when the engine runs: a live record-mode turn, driven
// against a STUB upstream with a FAKE credential, whose Bash command dumps its
// own environment.
//
// The leak it is watched against was real and specific. Record mode used to hand
// the engine the operator's credential, and the pinned engine's subprocess
// environment sanitizer preserves `ANTHROPIC_API_KEY` (it strips
// `CLAUDE_CODE_OAUTH_TOKEN`). So any recorded scenario whose Bash command read
// the environment put a live key into a tool result — and tool results flow into
// the next request body, hence into the cassette, the observed log and the
// transcript, all of which are committed. The fix moves the credential out of
// the engine entirely: the child holds a placeholder and the RECORD PROXY swaps
// the real value into the outbound auth header.
//
// The assertion has both halves, because either alone is satisfiable by a
// broken harness: the fake credential must appear NOWHERE the engine can reach,
// AND the placeholder must be visible in the engine's own environment dump while
// the stub upstream saw the fake credential on the wire. A harness that simply
// failed to authenticate would pass the first half alone.
//
// No network: the "upstream" is a local stub. Nothing here needs a real key.
//
// Run: npx tsx src/credential-leak.test.ts
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLACEHOLDER_CREDENTIALS } from "./env.js";
import { startRecordProxy } from "./proxy.js";
import { runTurn } from "./runTurn.js";

/** Obviously fake, and shaped like the real thing so a substring search is meaningful. */
const FAKE_REAL_KEY = "sk-ant-api03-FAKE-LEAKTEST-CREDENTIAL-000000";
const PLACEHOLDER = PLACEHOLDER_CREDENTIALS.ANTHROPIC_API_KEY;

const failures: string[] = [];
let pass = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

const sse = (events: unknown[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

/** Turn 1: call Bash with a command that prints the engine's environment. */
const TOOL_TURN = sse([
  { type: "message_start", message: { id: "msg_leaktest_1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_reforge_leaktest", name: "Bash", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: "printenv", description: "dump the environment" }) } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
]);

/** Turn 2+: end the turn. */
const TEXT_TURN = sse([
  { type: "message_start", message: { id: "msg_leaktest_2", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "REFORGE_LEAKTEST_DONE" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: "message_stop" },
]);

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "reforge-leaktest-"));
  const cassette = join(work, "leaktest.jsonl");

  // --- the stub upstream: records what auth it was given, serves canned SSE ---
  const seenAuth: { authorization?: string; xApiKey?: string }[] = [];
  let turn = 0;
  const stub = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seenAuth.push({ authorization: req.headers.authorization as string | undefined, xApiKey: req.headers["x-api-key"] as string | undefined });
      // The engine opens with a `HEAD /api/hello` reachability probe; only the
      // real message POSTs get a turn (counting the probe served the tool turn
      // to a HEAD and the run silently did nothing).
      const isMessages = req.method === "POST" && (req.url ?? "").includes("/v1/messages");
      if (!isMessages) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(turn++ === 0 ? TOOL_TURN : TEXT_TURN);
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  const stubPort = (stub.address() as { port: number }).port;

  // --- the record proxy, holding the only copy of the "real" credential -------
  const proxy = await startRecordProxy(cassette, `http://127.0.0.1:${stubPort}`, { name: "ANTHROPIC_API_KEY", value: FAKE_REAL_KEY });

  // The engine env is SELECTED from this process's environment, so make the
  // fake key the only credential it can select. Never a real one: this test
  // must be runnable by an operator who is logged in.
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  process.env.ANTHROPIC_API_KEY = FAKE_REAL_KEY;

  let capture: Awaited<ReturnType<typeof runTurn>> | null = null;
  let thrown = "";
  try {
    capture = await runTurn({
      engine: "engine-real",
      prompt: "Use the Bash tool to run exactly `printenv` and report its output verbatim.",
      mode: "record",
      baseUrl: `http://127.0.0.1:${proxy.port}`,
      allowedTools: ["Bash"],
      maxTurns: 3,
    });
  } catch (e) {
    thrown = String((e as Error).message);
  }
  await proxy.close();
  await new Promise<void>((r) => stub.close(() => r()));

  const cassetteBytes = readFileSync(cassette, "utf8");
  const transcript = JSON.stringify(capture?.messages ?? []);

  // --- the run has to have HAPPENED, or every leak assertion is vacuous ------
  check("the turn ran", thrown === "", thrown);
  check("the engine executed the Bash tool", cassetteBytes.includes("toolu_reforge_leaktest") && cassetteBytes.includes("tool_result"));
  check("the environment dump reached the request body", cassetteBytes.includes("ANTHROPIC_API_KEY="));
  check("the stub upstream was actually called", seenAuth.length >= 2, `${seenAuth.length} request(s)`);

  // --- the placeholder DID reach the engine ---------------------------------
  check("the engine's own environment shows the placeholder", cassetteBytes.includes(`ANTHROPIC_API_KEY=${PLACEHOLDER}`));

  // --- the real credential went on the WIRE, and only there ------------------
  check("the stub upstream received the real credential", seenAuth.every((h) => h.xApiKey === FAKE_REAL_KEY));
  check("the stub upstream never saw the placeholder", seenAuth.every((h) => h.xApiKey !== PLACEHOLDER && h.authorization === undefined));

  // --- and nowhere else -----------------------------------------------------
  check("the real credential is not in the cassette", !cassetteBytes.includes(FAKE_REAL_KEY));
  check("the real credential is not in the transcript", !transcript.includes(FAKE_REAL_KEY));
  check("the real credential is not in the error text", !thrown.includes(FAKE_REAL_KEY));

  // The vacuity trap this guards is specific: if the stub serves the tool turn
  // to the engine's opening `HEAD /api/hello` probe, the run does nothing, the
  // environment is never dumped, and every leak assertion passes on an empty
  // cassette. `REFORGE_LEAK_DEBUG=1` prints what was actually exchanged.
  if (process.env.REFORGE_LEAK_DEBUG) {
    for (const l of cassetteBytes.split("\n").filter(Boolean)) {
      const e = JSON.parse(l) as { seq: number; method: string; path: string; requestBody: string };
      console.log(`  exchange ${e.seq}: ${e.method} ${e.path} (${e.requestBody.length} request bytes)`);
    }
  }
  rmSync(work, { recursive: true, force: true });

  console.log(`=== credential leak: ${pass} check(s) ===`);
  for (const f of failures) console.log(`  FAIL — ${f}`);
  console.log(failures.length === 0 ? "PASS — the engine holds a placeholder; only the proxy holds the credential" : `FAIL — ${failures.length} violation(s)`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
