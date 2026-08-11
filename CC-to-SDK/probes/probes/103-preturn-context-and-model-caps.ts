// probes/probes/103-preturn-context-and-model-caps.ts — QA wave 2 grounding (W3/W4):
// two declared-vs-reachable questions the wave-2 fixes hang on:
//  (1) does getContextUsage() answer BEFORE the first turn (statusLine context_window_size 0
//      pre-turn — s2qa6-05: is a real value reachable at first paint)?
//  (2) does supportedModels() expose an effort-support signal for Haiku (s2qa4-06: the ccx
//      effort gate treats absent `supportsEffort` as supported — what does the live catalog say)?
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; npx tsx probes/103-preturn-context-and-model-caps.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const gates: Array<() => void> = [];
const waits: Array<Promise<void>> = [];
for (let i = 0; i < 1; i++) waits.push(new Promise<void>(r => gates.push(r)));

async function* input() {
  await waits[0];
  yield { type: "user" as const, message: { role: "user" as const, content: "Reply with exactly one word: GAMMA" }, parent_tool_use_id: null, session_id: "x" };
}

(async () => {
  console.log("=== probe 103: pre-turn getContextUsage() + supportedModels effort signal ===");
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) { console.log("ABORT: no token in env"); process.exit(1); }

  const q = query({ prompt: input(), options: { model: "claude-opus-4-8", maxTurns: 2 } as any });

  // Phase 1: BEFORE releasing the first message — pre-turn control calls.
  try {
    const usage = await (q as any).getContextUsage();
    console.log("PRE-TURN getContextUsage RESOLVED:", JSON.stringify(usage));
  } catch (e) { console.log("PRE-TURN getContextUsage THREW:", (e as Error).message.slice(0, 140)); }

  try {
    const models = await (q as any).supportedModels();
    const keys = new Set<string>();
    for (const m of models ?? []) Object.keys(m ?? {}).forEach(k => keys.add(k));
    console.log("supportedModels count:", (models ?? []).length, "field union:", [...keys].sort().join(","));
    for (const m of models ?? []) {
      const id = m?.id ?? m?.model ?? m?.value ?? "?";
      const effortish = Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => /effort|capab|support|feature/i.test(k)));
      console.log("  model:", id, "effort-ish fields:", JSON.stringify(effortish));
    }
  } catch (e) { console.log("supportedModels THREW:", (e as Error).message.slice(0, 140)); }

  // Phase 2: one real turn, then re-read usage for contrast.
  gates[0]();
  for await (const msg of q as any) {
    if (msg.type === "result") {
      console.log("[turn 1] subtype:", msg.subtype);
      try {
        const usage = await (q as any).getContextUsage();
        console.log("POST-TURN getContextUsage:", JSON.stringify(usage));
      } catch (e) { console.log("POST-TURN getContextUsage THREW:", (e as Error).message.slice(0, 140)); }
      break;
    }
  }
  console.log("=== VERDICT inputs above; probe done ===");
  process.exit(0);
})();
