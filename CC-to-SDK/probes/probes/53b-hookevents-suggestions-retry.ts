// Probe 53b — false-dead guard for probe 53's two NO verdicts, on sonnet with realistic prompts.
//   5' includeHookEvents — is the miss haiku-specific / prompt-specific? Also try a matcher'd hook.
//   6' promptSuggestions — try a real micro-task (file listing) where a follow-up is plausible.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

console.log("=== PROBE 53b hookEvents + suggestions retry (sonnet) ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (240s) — probe wedged, exiting"); process.exit(2); }, 240_000).unref?.();

const verdicts: string[] = [];

{
  const messages: any[] = [];
  for await (const m of query({
    prompt: "Run this bash command: ls. Then reply with one short sentence noting how many entries you saw.",
    options: {
      settingSources: [], maxTurns: 4, model: "claude-sonnet-4-6", permissionMode: "bypassPermissions",
      includeHookEvents: true, promptSuggestions: true,
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [async () => ({ continue: true })] }] },
    } as any,
  })) messages.push(m);
  const types = new Set(messages.map((m: any) => m.type + (m.subtype ? `/${m.subtype}` : "")));
  console.log("frame types:", [...types].join(", "));
  const hookish = [...types].filter((t) => t.includes("hook"));
  const sug = messages.find((m: any) => m.type === "prompt_suggestion");
  console.log("suggestion frame:", brief(sug, 200));
  verdicts.push(`5' includeHookEvents (sonnet, matcher'd): ${hookish.length ? `YES ✅ (${hookish.join(", ")})` : "NONE ❌ — dead for programmatic hooks headless"}`);
  verdicts.push(`6' prompt_suggestion (sonnet, real task): ${sug ? `YES ✅ ("${brief(sug.suggestion, 100)}")` : "NO ❌ — dead headless"}`);
}

console.log("\n=== PROBE 53b VERDICTS ===");
for (const v of verdicts) console.log(" -", v);
process.exit(0);
