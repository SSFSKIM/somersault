// Probe 65 — Does AskUserQuestion reach canUseTool headlessly, and does updatedInput carry the answer?
//
// Goal B premise check. The docs-side claim (19-tool-misc.md) is that the host answers AskUserQuestion
// via the permission callback by returning updatedInput; parity.json says CC's requiresUserInteraction()
// treats AskUserQuestion as always-ask even in bypass. Neither has ever been probed live.
//
// Questions:
//  (1) With NO ask rules (default mode, settingSources:[]) does AskUserQuestion consult canUseTool?
//      (probe 58 doctrine says canUseTool fires only for `ask`-routed tools — is this tool special-cased?)
//  (2) If not, does an explicit ask rule route it?
//  (3) When we return { behavior:"allow", updatedInput: { ...input, answers } }, does the model
//      actually receive the chosen answer (tool_result content + final text reflect it)?
import { query } from "@anthropic-ai/claude-agent-sdk";

const PROMPT =
  "Use the AskUserQuestion tool to ask me ONE question: whether I prefer red or blue " +
  "(two options, labels 'red' and 'blue'). After you receive my answer, reply with exactly " +
  "CHOSE:<label> and nothing else.";

async function phase(
  name: string,
  settings: Record<string, unknown> | undefined,
  permissionMode: "default" | "acceptEdits" | "bypassPermissions" = "default",
  answerStyle: "answers" | "response" = "answers",
) {
  console.log(`\n=== PHASE ${name} (mode=${permissionMode}, style=${answerStyle}) ===`);
  let consulted = false;
  const q = query({
    prompt: PROMPT,
    options: {
      model: "claude-haiku-4-5-20251001",
      maxTurns: 3,
      settingSources: [],
      permissionMode,
      ...(settings ? { settings } : {}),
      canUseTool: async (toolName, input) => {
        consulted = true;
        console.log(`[canUseTool] ${toolName} input=${JSON.stringify(input).slice(0, 400)}`);
        if (toolName === "AskUserQuestion") {
          if (answerStyle === "response") {
            console.log(`[canUseTool] answering via updatedInput.response (free text only)`);
            return { behavior: "allow", updatedInput: { ...input, response: "Neither — I prefer green, actually." } } as any;
          }
          const inp = input as { questions?: { question: string; options: { label: string }[] }[] };
          const answers: Record<string, string> = {};
          for (const qq of inp.questions ?? []) answers[qq.question] = "blue";
          console.log(`[canUseTool] answering via updatedInput.answers=${JSON.stringify(answers)}`);
          return { behavior: "allow", updatedInput: { ...input, answers } } as any;
        }
        return { behavior: "allow", updatedInput: input } as any;
      },
    },
  });
  let finalText = "", resultSubtype = "", sawToolUse = false;
  try {
    for await (const m of q) {
      const mm = m as any;
      if (mm.type === "assistant") {
        for (const b of mm.message?.content ?? []) {
          if (b.type === "tool_use") { sawToolUse = true; console.log(`[tool_use] ${b.name} input=${JSON.stringify(b.input).slice(0, 300)}`); }
          if (b.type === "text") finalText = b.text;
        }
      }
      if (mm.type === "user") {
        for (const b of mm.message?.content ?? []) {
          if (b.type === "tool_result") console.log(`[tool_result] ${JSON.stringify(b.content).slice(0, 400)}`);
        }
      }
      if ("result" in mm) { resultSubtype = mm.subtype; break; }
    }
  } catch (e: any) { console.log("STREAM THREW:", e?.message); }
  console.log(`--- ${name}: tool_use=${sawToolUse} canUseTool consulted=${consulted} result=${resultSubtype}`);
  console.log(`--- final text: ${finalText.slice(0, 200)}`);
  return consulted;
}

console.log("=== PROBE 65 AskUserQuestion × canUseTool ===");
const noRules = await phase("A (no ask rules)", undefined);
if (!noRules) await phase("B (ask rule AskUserQuestion)", { permissions: { ask: ["AskUserQuestion"] } });
// 2026-07-28 extension (Goal B spec review finding 1): the mode matrix. Phase A proved default-mode
// consultation; bypassPermissions silences the broker for every OTHER tool (probes 18d/58/64) — if it
// silences AskUserQuestion too, /yolo sessions lose questions silently and the spec must take a stance.
await phase("C (bypassPermissions)", undefined, "bypassPermissions");
await phase("D (acceptEdits)", undefined, "acceptEdits");
// And the declared-but-unprobed free-text channel: does updatedInput.response reach the model?
await phase("E (response free-text)", undefined, "default", "response");
