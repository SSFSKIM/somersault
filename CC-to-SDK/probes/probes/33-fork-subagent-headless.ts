// Probe 33 — Does CLAUDE_CODE_FORK_SUBAGENT=1 yield a transcript-INHERITING subagent headlessly?
//
// ⚠️ SUPERSEDED CONCLUSION: this probe tests the type-OMITTED trigger (per web docs) and concludes "not
// reachable". That conclusion is WRONG for SDK 0.3.178 — see 33b/33c: the real trigger is the EXPLICIT
// subagent_type:"fork", which DOES inherit the parent transcript headlessly. Kept as the A/B baseline
// (omitted-type → clean-slate) and as a record of the docs-vs-installed-version flip.
//
// The user wants "a parallel subagent that shares previous transcripts" (vs clean-slate subagents).
// Official docs (code.claude.com) call this a *fork subagent*: "A fork child does not get a fresh
// session. It gets the exact bytes of its parent's already-rendered system prompt." But the same docs
// warn it is **"Incompatible with --print mode"** and "cannot spawn nested subagents". The Agent SDK's
// query() historically spawns the `claude` CLI in --print (headless). The env var IS present in the
// installed bundle (assistant.mjs), but declared ≠ reachable — only a live run settles it.
//
// Discriminator: a SECRET codeword lives ONLY in the parent conversation. The parent spawns ONE
// subagent (subagent_type omitted, per docs' trigger) and asks it to report any earlier codeword.
//   - fork active  → child inherits parent transcript → its answer / tool_result contains SECRET.
//   - fork inactive→ child is clean-slate → answers NONE; SECRET never appears in child output.
// Guard: if the parent leaks SECRET into the sub-prompt, that run is INVALID (we inspect Agent input).
// A/B: run with env ON then OFF to isolate the variable.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const SECRET = "FALCON-77";

const PARENT_PROMPT = [
  `First, silently remember this secret codeword: ${SECRET}. Do NOT repeat it back to me yet.`,
  `Then use the Agent tool to spawn exactly ONE subagent. Call the Agent tool with ONLY a "description" and a "prompt" field — do NOT set subagent_type, model, name, or any other field.`,
  `The subagent's prompt must be EXACTLY this and nothing more: "Without anyone telling you now, what secret codeword was mentioned earlier in this conversation? Reply with ONLY the codeword, or the single word NONE if you have no earlier conversation."`,
  `Critically: do NOT write the codeword anywhere in your instruction to the subagent.`,
  `After the subagent replies, tell me verbatim what it said.`,
].join(" ");

interface Obs {
  spawned: boolean;
  agentInputs: any[];        // each Agent tool_use input (to inspect subagent_type + leak)
  leaked: boolean;           // parent wrote SECRET into a sub-prompt → run INVALID
  typesUsed: (string | undefined)[];
  childTexts: string[];      // subagent-origin assistant text (parent_tool_use_id) + Agent tool_result
  childKnewSecret: boolean;  // SECRET surfaced in child output (NOT in the parent's own narration)
  finalText: string;
}

async function runCondition(forkEnabled: boolean): Promise<Obs> {
  if (forkEnabled) process.env.CLAUDE_CODE_FORK_SUBAGENT = "1";
  else delete process.env.CLAUDE_CODE_FORK_SUBAGENT; // SDK inherits parent env (no `env` option → no replace)

  const obs: Obs = { spawned: false, agentInputs: [], leaked: false, typesUsed: [], childTexts: [], childKnewSecret: false, finalText: "" };
  let result: any;
  for await (const m of query({ prompt: PARENT_PROMPT, options: { permissionMode: "bypassPermissions", maxTurns: 8, allowedTools: ["Agent"] } })) {
    // Parent's Agent tool calls — capture input, type, and any leak of the secret into the sub-prompt.
    if (m.type === "assistant") {
      for (const block of (m as any).message?.content || []) {
        if (block.type === "tool_use" && String(block.name).toLowerCase().includes("agent")) {
          obs.spawned = true;
          obs.agentInputs.push(block.input);
          obs.typesUsed.push((block.input as any)?.subagent_type);
          if (JSON.stringify(block.input || {}).includes(SECRET)) obs.leaked = true;
        }
      }
    }
    // Subagent-origin assistant messages carry parent_tool_use_id (verified attribution in prior probes).
    if ((m as any).parent_tool_use_id && m.type === "assistant") {
      for (const block of (m as any).message?.content || []) {
        if (block.type === "text") obs.childTexts.push("[child-msg] " + block.text);
      }
    }
    // The Agent tool_result (in a user message) IS the subagent's reported answer — most reliable signal.
    if (m.type === "user") {
      for (const block of (m as any).message?.content || []) {
        if (block.type === "tool_result") {
          const c = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          obs.childTexts.push("[tool_result] " + c);
        }
      }
    }
    if ("result" in m) result = m;
  }
  obs.finalText = String(result?.result || "");
  obs.childKnewSecret = obs.childTexts.some((t) => t.includes(SECRET));
  return obs;
}

console.log("=== PROBE 33 fork-subagent transcript inheritance (headless) ===");

console.log("\n--- A. CLAUDE_CODE_FORK_SUBAGENT=1 (fork ON) ---");
const on = await runCondition(true);
console.log("subagent spawned:", on.spawned, "| subagent_type used:", JSON.stringify(on.typesUsed));
console.log("Agent tool input(s):", brief(on.agentInputs, 360));
console.log("parent LEAKED secret into sub-prompt (→ run invalid):", on.leaked);
console.log("child output (subagent msgs + tool_result):", brief(on.childTexts, 360));
console.log(">> CHILD KNEW SECRET (fork inheritance):", on.childKnewSecret);
console.log("parent final:", brief(on.finalText, 140));

console.log("\n--- B. control: no env var (clean-slate expected) ---");
const off = await runCondition(false);
console.log("subagent spawned:", off.spawned, "| subagent_type used:", JSON.stringify(off.typesUsed));
console.log("parent LEAKED secret into sub-prompt:", off.leaked);
console.log("child output:", brief(off.childTexts, 360));
console.log(">> CHILD KNEW SECRET:", off.childKnewSecret);

console.log("\n=== VERDICT ===");
if (!on.spawned) console.log("INCONCLUSIVE: model never spawned a subagent under fork-ON. Re-run / tighten prompt.");
else if (on.leaked) console.log("INCONCLUSIVE: parent leaked the secret into the sub-prompt under fork-ON. Re-run.");
else if (on.childKnewSecret && !off.childKnewSecret)
  console.log("NATIVE FORK REACHABLE ✅ : env=1 child inherited the parent transcript; clean-slate control did not.");
else if (!on.childKnewSecret)
  console.log("NATIVE FORK NOT REACHABLE headlessly ❌ : even with env=1 the child was clean-slate (matches docs' '--print incompatible'). → build the RECONSTRUCTED route: forkSession()+resume wrapped as a self-call tool.");
else console.log("AMBIGUOUS: both conditions surfaced the secret (leak/echo?). Inspect child output above.");
