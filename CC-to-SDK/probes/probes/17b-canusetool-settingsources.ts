// Probe 17b — WHY did probe 17 see zero canUseTool calls? Hypothesis: query() defaults settingSources to
// ALL, so this machine's ~/.claude settings pre-ALLOW Bash/Read/Edit via permission rules → the broker is
// never consulted. Isolate it: run `default` mode across settingSources variants and an explicit
// disallowedTools, recording which tools actually route to canUseTool. This decides whether the increment-3
// REPL must run with settingSources:[] (or restricted) for inline permission dialogs to fire at all.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";

async function run(label: string, extra: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "probe17b-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  const calls: string[] = [];
  const toolsRun: string[] = [];
  let result: any, err: string | undefined;
  try {
    for await (const m of query({
      prompt: "Do two things in the current directory: (1) edit note.txt replacing ORIGINAL with CHANGED, (2) run the bash command: echo hi. Then say done.",
      options: {
        model: MODEL, cwd: dir, maxTurns: 8, permissionMode: "default",
        canUseTool: async (tool: string, input: any) => { calls.push(tool); return { behavior: "allow", updatedInput: input } as any; },
        ...extra,
      },
    })) {
      if (m.type === "assistant") for (const b of (m as any).message?.content ?? []) if (b?.type === "tool_use") toolsRun.push(b.name);
      if ("result" in m) result = m;
    }
  } catch (e: any) { err = e.message; }
  console.log(`\n[${label}] subtype=${result?.subtype}${err ? "  THREW " + err : ""}`);
  console.log(`   tools model invoked: ${brief([...new Set(toolsRun)])}`);
  console.log(`   canUseTool called for: ${brief([...new Set(calls)])}  ${calls.length ? "← BROKER FIRED" : "← broker bypassed"}`);
  return { calls: [...new Set(calls)], toolsRun: [...new Set(toolsRun)] };
}

console.log("=== PROBE 17b canUseTool × settingSources ===  model:", MODEL);
const all = await run("default + settingSources:ALL (query default)", {});
const none = await run("default + settingSources:[]", { settingSources: [] });
const disallow = await run("default + settingSources:[] + disallowedTools:[Bash,Edit]", { settingSources: [], disallowedTools: ["Bash", "Edit"] });

console.log("\n--- VERDICT ---");
console.log(`settingSources ALL → broker fired for: ${brief(all.calls) || "NOTHING"}`);
console.log(`settingSources []  → broker fired for: ${brief(none.calls) || "NOTHING"}`);
console.log(`settingSources [] + disallow → broker fired for: ${brief(disallow.calls) || "NOTHING"}`);
console.log(none.calls.length
  ? "✓ HYPOTHESIS CONFIRMED — ambient settings pre-allowed tools; settingSources:[] makes the broker fire. REPL must restrict settingSources."
  : "✗ settingSources:[] did NOT make the broker fire — deeper headless limitation; revisit the feature premise.");
