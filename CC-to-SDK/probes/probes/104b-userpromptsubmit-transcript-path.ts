// probes/probes/104-userpromptsubmit-transcript-path.ts — QA wave 2 Task 6 (EP-D4, s2qa6-04):
// the statusLine payload's `transcript_path` and `prompt_id` are declared on `BaseHookInput` and the
// dossier calls them reachable — but "declared ≠ reachable" is this project's governing rule, and the
// whole feature hangs on ONE question: does a programmatic `UserPromptSubmit` hook, registered through
// `Options.hooks` on a live interactive-shaped session, actually receive both fields populated?
//
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; npx tsx probes/104-userpromptsubmit-transcript-path.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

let seen: Record<string, unknown> | undefined;

async function* input() {
  yield { type: "user" as const, message: { role: "user" as const, content: "Reply with exactly one word: DELTA" }, parent_tool_use_id: null, session_id: "x" };
}

(async () => {
  console.log("=== probe 104: UserPromptSubmit hook input — transcript_path / prompt_id ===");
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) { console.log("ABORT: no token in env"); process.exit(1); }

  const q = query({
    prompt: input(),
    options: {
      model: "claude-haiku-4-5",
      maxTurns: 1,
      hooks: {
        UserPromptSubmit: [{ hooks: [async (i: unknown) => { seen = i as Record<string, unknown>; return {}; }] }],
      },
    } as any,
  });

  for await (const m of q) {
    if ((m as any).type === "result") break;
  }

  if (!seen) { console.log("VERDICT: the hook NEVER FIRED — both payload fields are unreachable by this route"); process.exit(2); }
  console.log("hook input keys:", Object.keys(seen).sort().join(","));
  console.log("  session_id      :", JSON.stringify((seen as any).session_id));
  console.log("  transcript_path :", JSON.stringify((seen as any).transcript_path));
  console.log("  prompt_id       :", JSON.stringify((seen as any).prompt_id));
  console.log("  cwd             :", JSON.stringify((seen as any).cwd));
  const ok = typeof (seen as any).transcript_path === "string" && typeof (seen as any).prompt_id === "string";
  console.log(ok ? "VERDICT: BOTH fields present and string — the latch route is real"
                 : "VERDICT: at least one field missing — see the keys above");
  process.exit(ok ? 0 : 3);
})();
