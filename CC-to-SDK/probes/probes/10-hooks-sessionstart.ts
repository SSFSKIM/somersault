// Probe 10 — isolate SessionStart / SessionEnd reachability. Probe 09 showed
// SessionStart DORMANT in streaming-input mode. Canonical Claude Code use of
// SessionStart is boot-time context injection (additionalContext), so we must
// know if it's reachable headlessly at all. Variable under test: prompt mode
// (plain STRING prompt, non-streaming) + settingSources loaded. Single cheap turn.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const START_CODEWORD = "MARLIN-5520";
const fired: Record<string, number> = {};
const samples: Record<string, unknown> = {};

function rec(ev: string, extra?: () => unknown) {
  return [
    {
      hooks: [
        async (input: any) => {
          fired[ev] = (fired[ev] ?? 0) + 1;
          if (!samples[ev]) samples[ev] = { hook_event_name: input?.hook_event_name, source: input?.source, _keys: Object.keys(input ?? {}) };
          return extra ? extra() : {};
        },
      ],
    },
  ];
}

const hooks: Record<string, unknown> = {
  SessionStart: rec("SessionStart", () => ({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `IMPORTANT: the secret session codeword is ${START_CODEWORD}.` },
  })),
  SessionEnd: rec("SessionEnd"),
  UserPromptSubmit: rec("UserPromptSubmit"),
  Stop: rec("Stop"),
};

const assistantText: string[] = [];
let result: any;

// PLAIN STRING prompt (non-streaming) + default settingSources (load CLAUDE.md etc).
for await (const m of query({
  prompt: "What is the secret session codeword you were told? State it explicitly, then say done.",
  options: {
    maxTurns: 2,
    permissionMode: "bypassPermissions",
    includeHookEvents: true,
    hooks: hooks as any,
  },
})) {
  if (m.type === "assistant") {
    for (const block of (m as any).message?.content ?? []) if (block?.type === "text") assistantText.push(block.text);
  }
  if ("result" in m) {
    result = m;
    break;
  }
}

const recalled = assistantText.join("\n").includes(START_CODEWORD);

console.log("=== PROBE 10 SessionStart (string-prompt mode) ===");
console.log("fire counts:", brief(fired));
console.log("SessionStart fired:", (fired.SessionStart ?? 0) > 0, "| sample:", brief(samples.SessionStart));
console.log("SessionEnd fired:", (fired.SessionEnd ?? 0) > 0, "| sample:", brief(samples.SessionEnd));
console.log("SessionStart additionalContext recalled:", recalled, `(${START_CODEWORD})`);
console.log("result.subtype:", result?.subtype);

const pass = (fired.SessionStart ?? 0) > 0;
console.log(pass ? "RESULT: PASS (SessionStart IS reachable in string-prompt mode)" : "RESULT: FAIL (SessionStart dormant even in string-prompt mode)");
