// Probe 09 — HEADLESS HOOK COVERAGE MAP. The SDK *declares* 30 HOOK_EVENTS, but
// declared != headlessly-reachable (cf. cron/push, which are dead headless).
// This registers a recorder on EVERY event, drives a 2-turn streaming session
// (a Bash tool call + a Task subagent spawn), and records which events actually
// fire under a plain headless query(). It also verifies the two highest-value
// CONTROL paths: context injection (UserPromptSubmit / SessionStart
// additionalContext) and tool blocking (PreToolUse permissionDecision='deny').
import { query, HOOK_EVENTS } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const PROMPT_CODEWORD = "ORCHID-7731"; // injected via UserPromptSubmit.additionalContext
const START_CODEWORD = "MARLIN-5520"; // injected via SessionStart.additionalContext

const fired: Record<string, number> = {};
const samples: Record<string, unknown> = {};
let preToolWithAgentId = false; // subagent-attributed PreToolUse (agent_id present)
let blockedOnce = false;

// Capture a compact, comparable snapshot of each event's runtime input shape.
function pick(ev: string, input: any): unknown {
  const keys = [
    "hook_event_name", "source", "tool_name", "agent_id", "agent_type",
    "stop_hook_active", "trigger", "prompt", "message", "permission_mode",
    "task_subject", "title", "file_path", "notification",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (input?.[k] !== undefined) out[k] = input[k];
  out._inputKeys = Object.keys(input ?? {});
  return out;
}

const hooks: Record<string, unknown> = {};
for (const ev of HOOK_EVENTS) {
  hooks[ev] = [
    {
      hooks: [
        async (input: any) => {
          fired[ev] = (fired[ev] ?? 0) + 1;
          if (!samples[ev]) samples[ev] = pick(ev, input);
          if (ev === "PreToolUse" && input?.agent_id) preToolWithAgentId = true;
          // Inject extra context on the two lifecycle/turn entry points.
          if (ev === "UserPromptSubmit") {
            return {
              hookSpecificOutput: {
                hookEventName: "UserPromptSubmit",
                additionalContext: `IMPORTANT: the secret prompt codeword is ${PROMPT_CODEWORD}.`,
              },
            };
          }
          if (ev === "SessionStart") {
            return {
              hookSpecificOutput: {
                hookEventName: "SessionStart",
                additionalContext: `IMPORTANT: the secret session codeword is ${START_CODEWORD}.`,
              },
            };
          }
          // Block exactly one Bash invocation to prove the deny path end-to-end,
          // then allow subsequent ones so the run can complete.
          if (ev === "PreToolUse" && input?.tool_name === "Bash" && !blockedOnce) {
            blockedOnce = true;
            return {
              decision: "block",
              reason: "probe-block-once",
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: "probe-block-once",
              },
            };
          }
          return {};
        },
      ],
    },
  ];
}

// 2-turn streaming-input session, gated so turn 2 is sent only after turn 1's result.
let resolveT1!: () => void;
const t1 = new Promise<void>((r) => (resolveT1 = r));
let resolveT2!: () => void;
const t2 = new Promise<void>((r) => (resolveT2 = r));

function userMsg(content: string) {
  return {
    type: "user" as const,
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user" as const, content },
  };
}

async function* prompts() {
  yield userMsg(
    "What is the secret prompt codeword and the secret session codeword you were told? " +
      "State both explicitly. Then run the bash command: echo hi",
  );
  await t1;
  yield userMsg(
    "Now use the Task tool to launch a general-purpose subagent whose entire job is to run " +
      "the bash command: echo SUBAGENT_OK — then tell me you are done.",
  );
  await t2;
}

const messages: any[] = [];
const assistantText: string[] = [];
const hookSystemSubtypes: string[] = [];
let result1: any;
let result2: any;

const ac = new AbortController();
const killer = setTimeout(() => ac.abort(), 150_000); // hard safety stop

const q = query({
  prompt: prompts(),
  options: {
    maxTurns: 14,
    permissionMode: "bypassPermissions",
    includeHookEvents: true,
    abortController: ac,
    hooks: hooks as any,
  },
});

let results = 0;
try {
  for await (const m of q) {
    messages.push(m);
    if (m.type === "assistant") {
      for (const block of (m as any).message?.content ?? []) {
        if (block?.type === "text") assistantText.push(block.text);
      }
    }
    if (m.type === "system") {
      const st = (m as any).subtype;
      if (typeof st === "string" && st.startsWith("hook_")) hookSystemSubtypes.push(st);
    }
    if ("result" in m) {
      results++;
      if (results === 1) {
        result1 = m;
        resolveT1();
      } else {
        result2 = m;
        resolveT2();
        break;
      }
    }
  }
} finally {
  clearTimeout(killer);
}

const allAssistant = assistantText.join("\n");
const recalledPrompt = allAssistant.includes(PROMPT_CODEWORD);
const recalledStart = allAssistant.includes(START_CODEWORD);
const allText = JSON.stringify(messages);

const declared = [...HOOK_EVENTS];
const firedEvents = declared.filter((e) => (fired[e] ?? 0) > 0);
const dormant = declared.filter((e) => !(fired[e] ?? 0));

console.log("=== PROBE 09 hooks coverage ===");
console.log(`declared HOOK_EVENTS: ${declared.length}`);
console.log(`FIRED headlessly (${firedEvents.length}):`, firedEvents.join(", "));
console.log(`DORMANT headlessly (${dormant.length}):`, dormant.join(", "));
console.log("");
console.log("fire counts:", brief(fired, 800));
console.log("");
for (const e of firedEvents) console.log(`  sample[${e}]:`, brief(samples[e], 320));
console.log("");
console.log("CONTROL — UserPromptSubmit additionalContext recalled:", recalledPrompt, `(${PROMPT_CODEWORD})`);
console.log("CONTROL — SessionStart additionalContext recalled:", recalledStart, `(${START_CODEWORD})`);
console.log("CONTROL — PreToolUse deny fired & block reason in stream:", blockedOnce, "/", /probe-block-once/.test(allText));
console.log("ATTRIBUTION — PreToolUse seen with agent_id (subagent):", preToolWithAgentId);
console.log("hook_* system subtypes seen:", brief([...new Set(hookSystemSubtypes)]));
console.log("turn1 result.subtype:", result1?.subtype, "| turn2 result.subtype:", result2?.subtype);
console.log("aborted:", ac.signal.aborted);

// PASS = the option is live (≥ the core lifecycle/tool events fired) AND at
// least one context-injection path works AND blocking works.
const core = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"];
const coreFired = core.every((e) => (fired[e] ?? 0) > 0);
const pass = coreFired && (recalledPrompt || recalledStart) && blockedOnce;
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
