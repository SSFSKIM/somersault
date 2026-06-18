// Probe 15 — PERMISSION MODES acceptEdits & dontAsk (P4). PermissionMode has 6 values
// (sdk.d.ts:2055); the harness exercises 4 (default/plan/auto/bypass). This clarifies the two
// unexplored modes by running a file edit + a bash call under each, with a canUseTool recorder.
// A tool that is ABSENT from canUseTool under a mode was auto-permitted by that mode (broker
// bypassed); a tool PRESENT was routed to the broker. (auto/bypass replace canUseTool entirely.)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";

async function underMode(mode: string) {
  const dir = mkdtempSync(join(tmpdir(), "probe15-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  const canUse: string[] = [];
  const toolsRun: string[] = [];
  let result: any;
  let err: string | undefined;
  try {
    for await (const m of query({
      prompt:
        "Do two things in the current directory: (1) edit the file note.txt, replacing ORIGINAL with CHANGED. " +
        "(2) run the bash command: echo hi. Then say done.",
      options: {
        model: MODEL,
        cwd: dir,
        maxTurns: 8,
        permissionMode: mode as any,
        canUseTool: async (toolName: string, input: any) => {
          canUse.push(toolName);
          return { behavior: "allow", updatedInput: input } as any;
        },
      },
    })) {
      if (m.type === "assistant")
        for (const b of (m as any).message?.content ?? []) if (b?.type === "tool_use") toolsRun.push(b.name);
      if ("result" in m) result = m;
    }
  } catch (e: any) {
    err = e.message;
  }
  console.log(`\n[mode=${mode}] subtype=${result?.subtype}${err ? "  THREW " + err : ""}`);
  console.log(`   tools the model invoked: ${brief([...new Set(toolsRun)])}`);
  console.log(`   canUseTool was called for: ${brief([...new Set(canUse)])}  (empty = mode auto-allowed, broker bypassed)`);
  return { canUse: [...new Set(canUse)], toolsRun: [...new Set(toolsRun)], subtype: result?.subtype, err };
}

console.log("=== PROBE 15 permission modes acceptEdits / dontAsk ===  model:", MODEL);
const accept = await underMode("acceptEdits");
const dont = await underMode("dontAsk");

console.log("\n--- VERDICT ---");
console.log("acceptEdits — canUseTool invoked for:", brief(accept.canUse), "| tools run:", brief(accept.toolsRun));
console.log("dontAsk     — canUseTool invoked for:", brief(dont.canUse), "| tools run:", brief(dont.toolsRun));
console.log("(interpretation: a tool absent from canUseTool under a mode was auto-permitted by that mode.)");
