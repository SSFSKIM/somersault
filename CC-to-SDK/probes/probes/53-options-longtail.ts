// Probe 53 — the Wave-4 Options long tail (runtime premises worth settling before the knob sweep).
//
// Declared (sdk.d.ts 0.3.211) but NEVER runtime-verified headlessly:
//   1. sessionId — caller-chosen session UUID honored? (daemon could pre-name sessions)
//   2. title — initial title readable back via getSessionInfo (customTitle)?
//   3. agent — main-thread agent (prompt/tools/model applied to the MAIN conversation)?
//   4. outputFormat json_schema — does result.structured_output arrive populated? (runStructured premise)
//   5. includeHookEvents — hook_started/hook_response frames in the stream?
//   6. promptSuggestions — prompt_suggestion frame AFTER result?
//   7. betas ['context-1m-2025-08-07'] — accepted on a Sonnet model, or 400?
// Structural passthroughs (additionalDirectories/skills/strictMcpConfig/debug/toolConfig/
// planModeInstructions) are NOT probed — they're CLI flags with no observable headless assertion
// worth paying for.
import { randomUUID } from "node:crypto";
import { query, getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

console.log("=== PROBE 53 options long tail ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

const verdicts: string[] = [];
async function run(name: string, prompt: string, options: Record<string, unknown>) {
  const messages: any[] = [];
  try {
    for await (const m of query({ prompt, options: { settingSources: [], maxTurns: 4, ...options } as any })) messages.push(m);
  } catch (e: any) {
    console.log(`[${name}] THREW:`, brief(e?.message ?? e, 200));
    return { messages, error: e };
  }
  return { messages, error: null };
}
const init = (ms: any[]) => ms.find((m) => m.type === "system" && m.subtype === "init");
const result = (ms: any[]) => ms.find((m) => m.type === "result");

// ---- 1+2: sessionId + title (one session) ----
{
  const want = randomUUID();
  const { messages } = await run("sessionId/title", "Reply with exactly: OK", {
    model: "claude-haiku-4-5-20251001", sessionId: want, title: "probe-53 custom title",
  });
  const got = init(messages)?.session_id;
  console.log("[1 sessionId] wanted", want, "got", got);
  verdicts.push(`1 sessionId honored: ${got === want ? "YES ✅" : `NO ❌ (got ${got})`}`);
  try {
    const info = await getSessionInfo(got);
    console.log("[2 title] getSessionInfo:", brief({ summary: info?.summary, customTitle: (info as any)?.customTitle }, 200));
    const t = (info as any)?.customTitle ?? info?.summary;
    verdicts.push(`2 title readable: ${t === "probe-53 custom title" ? "YES ✅" : `PARTIAL (customTitle=${(info as any)?.customTitle} summary=${brief(info?.summary, 60)})`}`);
  } catch (e: any) { verdicts.push(`2 title readable: getSessionInfo THREW (${brief(e?.message, 100)})`); }
}

// ---- 3: main-thread agent ----
{
  const { messages } = await run("agent", "Introduce yourself in one short sentence.", {
    model: "claude-haiku-4-5-20251001", agent: "probe-persona",
    agents: { "probe-persona": { description: "probe agent", prompt: "You are PROBE-PERSONA. Whatever the user says, reply with exactly: PROBE-PERSONA-ACTIVE" } },
  });
  const r = result(messages);
  console.log("[3 agent] result:", brief(r?.result, 120));
  verdicts.push(`3 main-thread agent applied: ${String(r?.result ?? "").includes("PROBE-PERSONA-ACTIVE") ? "YES ✅" : `NO/UNCLEAR (${brief(r?.result, 80)})`}`);
}

// ---- 4: structured output ----
{
  const { messages, error } = await run("structured", "What is 2+3? Give the number and the English word for it.", {
    model: "claude-sonnet-4-6",
    outputFormat: { type: "json_schema", schema: { type: "object", properties: { answer: { type: "number" }, word: { type: "string" } }, required: ["answer", "word"], additionalProperties: false } },
  });
  const r = result(messages);
  console.log("[4 structured] subtype:", r?.subtype, "structured_output:", brief(r?.structured_output, 200), "result:", brief(r?.result, 120));
  const so = r?.structured_output;
  verdicts.push(`4 structured_output populated: ${so && typeof so === "object" && (so as any).answer === 5 ? "YES ✅" : error ? `THREW (${brief(error?.message, 80)})` : `NO/OTHER (${brief(so, 100)})`}`);
}

// ---- 5: includeHookEvents ----
{
  const seen = new Set<string>();
  const { messages } = await run("hookEvents", "Run this bash command: echo probe53. Then reply with exactly: DONE", {
    model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", includeHookEvents: true,
    hooks: { PreToolUse: [{ hooks: [async () => ({ continue: true })] }] },
  });
  for (const m of messages) seen.add(m.type + (m.subtype ? `/${m.subtype}` : ""));
  const hookish = [...seen].filter((t) => t.includes("hook"));
  console.log("[5 hookEvents] frame types:", [...seen].join(", "));
  verdicts.push(`5 includeHookEvents frames: ${hookish.length ? `YES ✅ (${hookish.join(", ")})` : "NONE ❌"}`);
}

// ---- 6: promptSuggestions (frame arrives AFTER result — iterate to stream end) ----
{
  const { messages } = await run("suggestions", "Reply with exactly: OK", {
    model: "claude-haiku-4-5-20251001", promptSuggestions: true,
  });
  const sug = messages.find((m) => m.type === "prompt_suggestion");
  console.log("[6 suggestions] frame:", brief(sug, 200));
  verdicts.push(`6 prompt_suggestion emitted: ${sug ? `YES ✅ ("${brief((sug as any).suggestion, 80)}")` : "NO ❌"}`);
}

// ---- 7: betas context-1m on sonnet ----
{
  const { messages, error } = await run("betas", "Reply with exactly: OK", {
    model: "claude-sonnet-4-6", betas: ["context-1m-2025-08-07"],
  });
  const r = result(messages);
  console.log("[7 betas] error:", brief(error?.message, 120), "| result subtype:", r?.subtype, "|", brief(r?.result, 60));
  verdicts.push(`7 betas context-1m on sonnet-4-6: ${error ? `THREW (${brief(error?.message, 100)})` : r?.subtype === "success" ? "ACCEPTED ✅" : `subtype=${r?.subtype} (${brief(r?.result, 80)})`}`);
}

console.log("\n=== PROBE 53 VERDICTS ===");
for (const v of verdicts) console.log(" -", v);
process.exit(0);
