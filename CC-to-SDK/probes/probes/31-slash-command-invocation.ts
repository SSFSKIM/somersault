// probes/probes/31-slash-command-invocation.ts — A1 for Increment D: are the 105 supportedCommands()
// actually INVOKABLE headless, or only listable? Probe 21 found the built-ins /model //help //resume gate
// as "not available" headless. This probe submits a few representative slash commands AS PROMPTS and dumps
// the raw frames + result, to classify each: EXECUTES / GATED("not available") / TREATED-AS-PLAIN-TEXT.
// Categories tested: built-in (/help), a SKILL (/brainstorming), a user command (/review).
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/31-slash-command-invocation.ts
import { openSession } from "../../harness/dist/index.js";

async function trySlash(label: string, cmd: string): Promise<void> {
  const s = openSession({ model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any);
  const frames: string[] = [];
  try {
    const turn = s.submit(cmd, (m: any) => {
      const t = m?.type, sub = m?.subtype;
      const note = m?.message?.content ? JSON.stringify(m.message.content).slice(0, 100)
        : (m?.result ?? m?.text ?? m?.error ?? "");
      frames.push(`${t}${sub ? "/" + sub : ""}${note ? " :: " + String(note).slice(0, 100) : ""}`);
    });
    const result = await Promise.race([
      turn.then((r) => String(r.result)),
      new Promise<string>((res) => setTimeout(() => res("__TIMEOUT_25s__ (still running — slash cmd not a clean headless turn)"), 25000)),
    ]);
    console.log(`\n[${label}] submit(${JSON.stringify(cmd)})`);
    console.log("  frames:", frames.length ? frames.join(" | ").slice(0, 360) : "(none)");
    console.log("  result:", JSON.stringify(result).slice(0, 280));
  } catch (e) {
    console.log(`\n[${label}] submit(${JSON.stringify(cmd)}) ERROR:`, (e as Error).message);
  } finally {
    s.dispose().catch(() => {});   // don't await — a hung turn would block dispose too
  }
}

(async () => {
  console.log("=== probe 31: slash-command invocation reachability (headless) ===");
  await trySlash("builtin /help", "/help");
  await trySlash("skill /brainstorming", "/brainstorming");
  await trySlash("user /review", "/review");
  // control: a plain prompt that names a skill, to see if the MODEL would invoke a Skill tool on its own
  await trySlash("plain mention", "Use the brainstorming skill to plan a todo app. Just confirm you can in one sentence.");
  console.log("\n--- verdict ---");
  console.log("Classify each: EXECUTES (ran the command/skill) / GATED ('not available'/'unknown') / PLAIN-TEXT (model just chatted).");
  console.log("If skills GATE as prompts but a Skill tool exists, invocation must go through the model (Skill tool), not /slash.");
})();
