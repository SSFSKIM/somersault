// Probe 04 — hooks fire and can block. PreToolUse on Bash returns a block
// decision; includeHookEvents surfaces hook_started/hook_response system msgs.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

let preFired = false;
let postFired = false;

const messages: any[] = [];
let result: any;
const hookEventTypes: string[] = [];

for await (const m of query({
  prompt: "Run the bash command: echo hi",
  options: {
    maxTurns: 3,
    permissionMode: "bypassPermissions",
    includeHookEvents: true,
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            async () => {
              preFired = true;
              // Block via PreToolUse hookSpecificOutput permissionDecision='deny'.
              return {
                decision: "block",
                reason: "probe-block",
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: "probe-block",
                },
              };
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async () => {
              postFired = true;
              return {};
            },
          ],
        },
      ],
    },
  },
})) {
  messages.push(m);
  if (m.type === "system") {
    const st = (m as any).subtype;
    if (typeof st === "string" && st.startsWith("hook_")) hookEventTypes.push(st);
  }
  if ("result" in m) result = m;
}

const allText = JSON.stringify(messages);
const sawBlockReason = /probe-block/.test(allText);
const sawHookEvents = hookEventTypes.length > 0;

console.log("=== PROBE 04 hooks ===");
console.log("PreToolUse hook fired (callback ran):", preFired);
console.log("PostToolUse hook fired:", postFired);
console.log("hook_* system event subtypes seen:", brief(hookEventTypes));
console.log("'probe-block' reason present in stream:", sawBlockReason);
console.log("result.subtype:", result?.subtype);
console.log("result.result:", brief(result?.result, 200));

// PASS = the PreToolUse hook callback fired AND blocking was surfaced
// (either via a hook event stream or the block reason appearing).
const pass = preFired && (sawHookEvents || sawBlockReason);
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
