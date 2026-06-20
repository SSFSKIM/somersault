// Probe 25 — does `setMaxThinkingTokens(n)` work as a RUNTIME thinking lever on the chat (streaming-input,
// non-daemon) Session path? Grounds increment 11 (a `/think <level>` control + launch flag in cc-harness-chat).
// The chat REPL drives a streaming-input Session and would call `session.setMaxThinkingTokens(n)` from a slash
// command (mirrors how incr-10's ladder calls setModel/setPermissionMode live). The audit confirmed the method
// exists (Session.setMaxThinkingTokens → q.setMaxThinkingTokens, bridge-wired, daemon-live-tested) but NO probe
// verifies its RUNTIME effect on the non-daemon path — the one A1 gap before designing `/think`.
//
// Detection: extended-thinking output arrives as assistant message content blocks of type "thinking". Per turn we
// count thinking blocks + thinking chars. The crux design questions:
//   Cell A (open WITHOUT thinking): turn1 expect 0 thinking → setMaxThinkingTokens(BIG) → turn2: does thinking
//     APPEAR? (⇒ the lever can ENABLE thinking on an already-open session, like setModel swaps live — so `/think`
//     works on a default session) → setMaxThinkingTokens(0) → turn3: does thinking VANISH? (⇒ `/think off` works)
//   Cell B (open WITH thinking budgetTokens:2048): turn1 expect thinking → setMaxThinkingTokens(0) → turn2: does
//     it DISABLE a session that started with thinking? (the alternative design: open with a baseline, adjust down)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-sonnet-4-6"; // thinking-capable
// a prompt that reliably elicits extended reasoning when thinking is enabled, but is cheap
const reason = (n: number) => `Reason carefully step by step, then give the final answer. Puzzle #${n}: ` +
  `Three friends — Ana, Ben, Cara — each have a different pet (cat, dog, fish) and a different color shirt (red, green, blue). ` +
  `Ana's shirt isn't red. The dog owner wears blue. Cara has the fish. Ben isn't wearing green. Who owns the cat, and what color does that person wear?`;

// minimal async-iterable input queue (mirrors harness Session's streaming-input prompt; from probe 20/24)
function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });

// run a streaming session: for each step, push a prompt, count thinking on that turn, then run step.after() (the
// control change) once the turn's `result` lands. Returns per-turn {thinkBlocks, thinkChars, textChars}.
async function session(label: string, openOpts: Record<string, unknown>, steps: { prompt: string; after?: (q: any) => Promise<void> }[]) {
  const per: { thinkBlocks: number; thinkChars: number; textChars: number }[] = steps.map(() => ({ thinkBlocks: 0, thinkChars: 0, textChars: 0 }));
  let idx = 0; let err: string | undefined;
  const q = inputQueue();
  const handle = query({ prompt: q.iterable as any, options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 4, settingSources: [] as any, ...openOpts } as any });
  q.push(userTurn(steps[0].prompt));
  try {
    for await (const m of handle as any) {
      const mm = m as any;
      if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
        if (b?.type === "thinking") { per[idx].thinkBlocks++; per[idx].thinkChars += (b.thinking ?? "").length; }
        else if (b?.type === "text") per[idx].textChars += (b.text ?? "").length;
      }
      if (mm.type === "result") {
        if (steps[idx].after) { try { await steps[idx].after!(handle); } catch (e) { err = "control: " + (e as Error).message; } }
        idx++;
        if (idx < steps.length) q.push(userTurn(steps[idx].prompt)); else q.close();
      }
    }
  } catch (e) { err = (err ? err + " | " : "") + (e as Error).message; }
  console.log(`\n[${label}] open=${brief(openOpts, 80)}`);
  per.forEach((p, i) => console.log(`   turn${i + 1}: thinkingBlocks=${p.thinkBlocks} thinkingChars=${p.thinkChars} textChars=${p.textChars}`));
  if (err) console.log(`   NOTE: ${err}`);
  return per;
}

console.log("=== PROBE 25 — setMaxThinkingTokens as a runtime thinking lever (streaming-input Session) ===");

// Cell A — opened WITHOUT thinking; can the lever ENABLE then DISABLE thinking mid-session?
const A = await session("A · enable-then-disable from no-thinking", {}, [
  { prompt: reason(1), after: async (q) => { await q.setMaxThinkingTokens(8000); } },
  { prompt: reason(2), after: async (q) => { await q.setMaxThinkingTokens(0); } },
  { prompt: reason(3) },
]);

// Cell B — opened WITH a baseline thinking budget; can the lever DISABLE / adjust it down mid-session?
const B = await session("B · disable from baseline-thinking", { thinking: { type: "enabled", budgetTokens: 2048 } }, [
  { prompt: reason(4), after: async (q) => { await q.setMaxThinkingTokens(0); } },
  { prompt: reason(5) },
]);

console.log("\n=== VERDICTS ===");
console.log(`P1 turn1 no-thinking baseline:        ${A[0].thinkBlocks === 0 ? "YES (0 thinking blocks without config)" : `thinking present anyway (blocks=${A[0].thinkBlocks}) — model auto-thinks`}`);
console.log(`P2 setMaxThinkingTokens ENABLES live:  ${A[1].thinkBlocks > 0 ? `YES (turn2 blocks=${A[1].thinkBlocks}, chars=${A[1].thinkChars}) — /think works on a default session` : "NO (turn2 still 0) — must open WITH a baseline budget"}`);
console.log(`P3 setMaxThinkingTokens(0) DISABLES:   ${A[2].thinkBlocks === 0 ? "YES (turn3 back to 0) — /think off works" : `NO (turn3 blocks=${A[2].thinkBlocks}) — 0 does not disable, need another off path`}`);
console.log(`P4 baseline-open thinking fires:       ${B[0].thinkBlocks > 0 ? `YES (blocks=${B[0].thinkBlocks})` : "NO/UNCLEAR (0)"}`);
console.log(`P5 disable from baseline mid-session:  ${B[1].thinkBlocks === 0 ? "YES (turn2 back to 0)" : `NO (turn2 blocks=${B[1].thinkBlocks})`}`);
process.exit(0);
