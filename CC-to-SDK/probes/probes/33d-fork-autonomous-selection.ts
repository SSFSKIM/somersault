// Probe 33d — Does the model AUTONOMOUSLY pick subagent_type:"fork", or must we advertise it?
//
// 33/33b/33c proved the MECHANISM: env CLAUDE_CODE_FORK_SUBAGENT=1 + explicit subagent_type:"fork" →
// child inherits the parent transcript headlessly. But all three EXPLICITLY TOLD the model to use "fork".
// The feature we're building is model-TRIGGERED: the model decides to fork on its own, like spawning any
// subagent. So the unverified premise is SELECTION, not inheritance. This probe isolates it.
//
// Realistic config: the full `claude_code` tool preset (NOT allowedTools:["Agent"]) so the model sees the
// real subagent tool schema — that schema is where "fork" would be discoverable as an enum value.
//
// SECRET discriminator (as in 33c): a codeword lives ONLY in the parent turn. When a fork child runs, it
// can recall it; a clean-slate child cannot. We record, per run: which subagent_type the model chose, and
// whether the SECRET surfaced in child output (proof of inheritance whenever fork WAS chosen).
//
// Conditions (env=1 for all three; vary only what the model is TOLD):
//   A — autonomy under functional pressure: "delegate, but do NOT re-pass the codeword." Fork is the only
//       way to satisfy this. We name NO subagent_type. If the model still fails to reach for "fork", it
//       doesn't know the capability exists → we must ADVERTISE it. If it picks "fork" → env flip suffices.
//   B — autonomy WITH advertisement: same task, but the system prompt announces the "fork" type + when to
//       use it. Does advertising make the model choose it?
//   C — explicit (control): we instruct subagent_type:"fork". Re-confirms mechanism + inheritance under
//       the claude_code preset (33c used allowedTools:["Agent"]).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const SECRET = "FALCON-77";

const FORK_HINT =
  `A special subagent_type "fork" is available on the Agent/Task tool. A "fork" subagent INHERITS this ` +
  `conversation's full context (everything we've discussed), unlike a normal subagent which starts blank. ` +
  `Prefer subagent_type:"fork" whenever the sub-task depends on what we've already discussed in this session.`;

const BASE_TASK = [
  `First, silently remember this secret codeword: ${SECRET}. Do NOT repeat it back yet.`,
  `Now delegate a sub-task: use the Agent/Task tool to spawn exactly ONE subagent (run_in_background:false — WAIT for it).`,
  `The subagent must answer: "What secret codeword was mentioned earlier in this conversation? Reply with ONLY the codeword, or NONE."`,
  `IMPORTANT: do NOT write the codeword anywhere in your instructions to the subagent — it must rely on context it already has.`,
  `After it replies, tell me verbatim what it said.`,
].join(" ");

interface Obs { spawned: boolean; types: (string | undefined)[]; leaked: boolean; async: boolean; childKnew: boolean; childTexts: string[]; finalText: string; }

async function run(label: string, opts: { hint: boolean; forceForkType: boolean }): Promise<Obs> {
  process.env.CLAUDE_CODE_FORK_SUBAGENT = "1";
  const prompt = opts.forceForkType
    ? BASE_TASK.replace("spawn exactly ONE subagent", 'spawn exactly ONE subagent with subagent_type set to "fork"')
    : BASE_TASK;
  const systemPrompt = opts.hint
    ? { type: "preset" as const, preset: "claude_code" as const, append: FORK_HINT }
    : { type: "preset" as const, preset: "claude_code" as const };

  const obs: Obs = { spawned: false, types: [], leaked: false, async: false, childKnew: false, childTexts: [], finalText: "" };
  let result: any;
  for await (const m of query({ prompt, options: { systemPrompt, permissionMode: "bypassPermissions", maxTurns: 12 } })) {
    if (m.type === "assistant")
      for (const b of (m as any).message?.content || [])
        if (b.type === "tool_use" && /agent|task/i.test(String(b.name))) {
          obs.spawned = true; obs.types.push((b.input as any)?.subagent_type);
          if (JSON.stringify(b.input || {}).includes(SECRET)) obs.leaked = true;
        }
    if ((m as any).parent_tool_use_id && m.type === "assistant")
      for (const b of (m as any).message?.content || []) if (b.type === "text") obs.childTexts.push("[child] " + b.text);
    if (m.type === "user")
      for (const b of (m as any).message?.content || []) if (b.type === "tool_result") {
        const c = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        obs.childTexts.push("[tool_result] " + c);
        if (/Async agent launched|working in the background/i.test(c)) obs.async = true;
      }
    if ("result" in m) result = m;
  }
  obs.finalText = String(result?.result || "");
  obs.childKnew = obs.childTexts.some((t) => t.includes(SECRET));
  const chose = (t?: string) => (t ?? "(none/omitted)");
  console.log(`\n--- ${label} ---`);
  console.log("spawned:", obs.spawned, "| subagent_type(s):", JSON.stringify(obs.types.map(chose)), "| async:", obs.async, "| leaked:", obs.leaked);
  console.log("child output:", brief(obs.childTexts, 400));
  console.log(">> CHILD KNEW SECRET (inheritance):", obs.childKnew);
  console.log("parent final:", brief(obs.finalText, 140));
  return obs;
}

console.log("=== PROBE 33d fork-subagent AUTONOMOUS SELECTION (claude_code preset, headless) ===");
const a = await run("A: env on, NO fork mention (autonomy under pressure)", { hint: false, forceForkType: false });
const b = await run("B: env on, system prompt ADVERTISES fork", { hint: true, forceForkType: false });
const c = await run("C: explicit subagent_type:fork (mechanism/inheritance control)", { hint: false, forceForkType: true });

const pickedFork = (o: Obs) => o.types.some((t) => String(t).toLowerCase() === "fork");
console.log("\n=== VERDICT ===");
console.log("A picked fork unprompted :", pickedFork(a), "| A child inherited:", a.childKnew);
console.log("B picked fork (advertised):", pickedFork(b), "| B child inherited:", b.childKnew);
console.log("C picked fork (forced)   :", pickedFork(c), "| C child inherited:", c.childKnew);
if (!c.childKnew) console.log("⚠️ mechanism control C did NOT inherit — investigate before trusting A/B.");
else if (pickedFork(a) && a.childKnew) console.log("ENV FLIP SUFFICES ✅ : model autonomously chose fork with no advertisement. Feature = set the env var.");
else if (pickedFork(b) && b.childKnew) console.log("ADVERTISE TO TRIGGER ✅ : model picks fork only once told it exists. Feature = env var + a system-prompt note about fork.");
else console.log("INCONCLUSIVE: neither A nor B autonomously forked (but C works). Re-tighten the advertisement / task.");
