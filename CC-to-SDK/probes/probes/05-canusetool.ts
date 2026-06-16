// Probe 05 — programmatic permission control via canUseTool. Deny Bash and
// confirm the denial surfaces (SDKPermissionDeniedMessage / deny reason).
// canUseTool routes through the bidirectional control_request channel, which
// is only opened in STREAMING INPUT mode (async-iterable prompt), so the
// prompt is supplied as an AsyncIterable<SDKUserMessage>.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

let canUseToolCalled = false;
let deniedTool = "";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const workdir = mkdtempSync(join(tmpdir(), "probe-canuse-"));

async function* promptStream() {
  yield {
    type: "user" as const,
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user" as const,
      content: `Create a file named probe.txt containing the word hi in ${workdir} using the Write tool.`,
    },
  };
}

const messages: any[] = [];
let result: any;
let sawPermissionDenied = false;

// Build a clean child env: strip inherited CLAUDE*/CLAUDECODE markers that put
// the nested SDK into a trusted/auto-approve mode and bypass the permission
// callback. Keep PATH + the API key.
const cleanEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v === undefined) continue;
  if (/^CLAUDE/i.test(k) || k === "CLAUDECODE" || /^CMUX_/i.test(k) || k === "AI_AGENT") continue;
  cleanEnv[k] = v;
}

const q = query({
  prompt: promptStream(),
  options: {
    maxTurns: 3,
    permissionMode: "default",
    settingSources: [],
    env: cleanEnv,
    cwd: workdir,
    canUseTool: async (toolName: string, input: Record<string, unknown>) => {
      canUseToolCalled = true;
      // Deny the first file-mutating / command tool the agent reaches for.
      if (toolName === "Write" || toolName === "Bash" || toolName === "Edit") {
        deniedTool = toolName;
        return { behavior: "deny" as const, message: "probe-deny" };
      }
      return { behavior: "allow" as const, updatedInput: input };
    },
  },
});

for await (const m of q) {
  messages.push(m);
  if (m.type === "system" && (m as any).subtype === "permission_denied") sawPermissionDenied = true;
  if ("result" in m) {
    result = m;
    break;
  }
}

const allText = JSON.stringify(messages);
const sawDenyReason = /probe-deny/.test(allText);

console.log("=== PROBE 05 canUseTool ===");
console.log("canUseTool called:", canUseToolCalled, "| denied tool:", deniedTool);
console.log("SDKPermissionDeniedMessage seen:", sawPermissionDenied);
console.log("'probe-deny' present in stream:", sawDenyReason);
console.log("result.subtype:", result?.subtype);
console.log("result.result:", brief(result?.result, 250));

// canUseTool is consulted before a permission-gated tool and its 'deny'
// decision short-circuits the call (reason surfaces to the model).
const pass = canUseToolCalled && !!deniedTool && sawDenyReason;
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
console.log(
  "note: in headless default mode the CLI auto-allows safe Bash (e.g. `echo hi`) without consulting canUseTool; permission-gated tools (Write/Edit) DO route through it.",
);
