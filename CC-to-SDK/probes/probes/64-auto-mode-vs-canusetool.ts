// Probe 64 — Does `permissionMode: "auto"` consult `canUseTool` at all?
//
// The question decides whether the human seam A2a builds is reachable in the posture we actually
// ship. `config/types.ts` carries a note recording `auto` as broker-replacing ("dontAsk replaces
// canUseTool entirely (joins auto/bypass as broker-replacing) — verified") and says the broker is
// "only consulted in broker-live modes (default/acceptEdits/plan)". That note is the basis for a real
// design decision, and it is a code comment, not a probe of this combination — `auto` WITH an
// explicit `ask` rule and a broker present has never been run.
//
// It matters twice over. `DEFAULTS.permissionMode` is `auto`, so a bare `ccx --bg` runs under it; and
// doperpowers spawns every worker `--bg --permission-mode auto`. If `auto` never consults the broker,
// then no park can ever occur in either path, and `state: "blocked"` is reachable only when someone
// configures `default` + ask rules by hand.
//
// Method: the same scenario twice in one file, changing ONE thing. Same model (auto-capable, or the
// mode silently degrades to `default` and the comparison is a lie — probe 18d), same isolation, same
// ask rule. Report per mode whether canUseTool fired and whether the tool ran anyway.
import { query } from "@anthropic-ai/claude-agent-sdk";

// Auto is MODEL-GATED. sonnet-4-6 is the cheapest model in the harness's supported set
// (src/config/autoModel.ts); on anything else `auto` falls back to `default` and both runs would
// look identical for the wrong reason.
const MODEL = "claude-sonnet-4-6";

interface Run { mode: string; brokerFired: boolean; toolRan: boolean; sawToolUse: boolean; result?: any; threw?: string }

async function run(mode: "default" | "auto"): Promise<Run> {
  const out: Run = { mode, brokerFired: false, toolRan: false, sawToolUse: false };
  const q = query({
    prompt: "Run the bash command `echo probe64-ok`. Use the Bash tool. Then reply DONE.",
    options: {
      model: MODEL,
      maxTurns: 2,
      settingSources: [],                                   // keep the user's own allowlists out
      permissionMode: mode,
      settings: { permissions: { ask: ["Bash(*)"] } } as any,
      canUseTool: async (toolName, input) => {
        out.brokerFired = true;
        console.log(`  [${mode}] canUseTool FIRED for ${toolName} -> allow`);
        return { behavior: "allow", updatedInput: input } as any;
      },
    },
  });
  try {
    for await (const m of q) {
      const mm = m as any;
      if (mm.type === "assistant") {
        for (const b of mm.message?.content ?? []) if (b.type === "tool_use") out.sawToolUse = true;
      }
      if (mm.type === "user") {
        for (const b of mm.message?.content ?? []) if (b.type === "tool_result") out.toolRan = true;
      }
      if ("result" in mm) { out.result = mm; break; }
    }
  } catch (e: any) { out.threw = e?.message ?? String(e); }
  return out;
}

console.log("=== PROBE 64 permissionMode auto vs canUseTool ===");
console.log(`model: ${MODEL} (auto-capable; an unsupported model silently degrades auto to default)`);
console.log("");

const dflt = await run("default");
console.log(`[default] broker fired: ${dflt.brokerFired} | tool_use emitted: ${dflt.sawToolUse} | tool ran: ${dflt.toolRan}`);
const auto = await run("auto");
console.log(`[auto]    broker fired: ${auto.brokerFired} | tool_use emitted: ${auto.sawToolUse} | tool ran: ${auto.toolRan}`);
console.log("");

for (const r of [dflt, auto]) {
  if (r.result?.is_error) console.log(`[${r.mode}] result is_error, text: ${JSON.stringify(r.result?.result).slice(0, 160)}`);
  if (r.threw) console.log(`[${r.mode}] threw: ${r.threw}`);
}

// The control arm is `default`. If the model called no tool there either, the run proves nothing about
// either mode — the same degenerate-turn trap that made probes 62 and 63 print verdicts they had not
// earned. Refuse to rule rather than manufacture a premise a design will then be built on.
if (!dflt.sawToolUse) {
  console.log("VERDICT: INCONCLUSIVE — the control run (`default`) emitted no tool_use, so there was");
  console.log("         nothing for either mode's broker to be consulted about. Check the result text");
  console.log("         above (a limited account answers without calling anything) and re-run.");
  console.log("RESULT: INCONCLUSIVE");
} else if (dflt.brokerFired && !auto.brokerFired) {
  console.log("VERDICT: `auto` is BROKER-REPLACING — canUseTool is consulted under `default` and NOT");
  console.log("         under `auto`. No park can occur in the default posture or in doperpowers'");
  console.log("         `--permission-mode auto` spawn; `state: \"blocked\"` needs explicit `default` + ask rules.");
  console.log("RESULT: PASS (auto replaces the broker — confirms the code comment)");
} else if (dflt.brokerFired && auto.brokerFired) {
  console.log("VERDICT: `auto` STILL CONSULTS canUseTool with an explicit ask rule present. The");
  console.log("         'broker-replacing' note does not hold for this combination — the human seam is");
  console.log("         reachable in the posture we actually ship, including doperpowers' workers.");
  console.log("RESULT: PASS (auto consults the broker — CORRECTS the code comment)");
} else {
  console.log("VERDICT: UNEXPECTED — the control run emitted a tool_use but its broker never fired.");
  console.log("         The ask rule is not routing as probe 58 found; do not draw a conclusion about");
  console.log("         `auto` from this run.");
  console.log("RESULT: INCONCLUSIVE");
}
