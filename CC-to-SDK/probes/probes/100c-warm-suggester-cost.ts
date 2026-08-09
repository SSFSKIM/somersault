// Probe 100c — what does the EP-C5 fallback actually cost when the suggester session is WARM?
//
// WHY THIS EXISTS. Probes 100 and 100b settled that `prompt_suggestion` is unreachable headlessly, so the
// harness must generate the composer pre-fill itself. Both probes measured that fallback the naive way —
// one fresh `query()` per suggestion — and got ~8–9 s and ~$0.010 EVERY TIME. At one suggestion per turn
// that is a second agent running beside the real one, and it would sink the feature on cost alone.
//
// But that number is an artefact of the measurement, not of the feature. Two things make a cold one-shot
// expensive, and neither is intrinsic:
//   1. Each `query()` SPAWNS THE CLI. Most of the 8 s is process startup, not inference.
//   2. Each spawn pays a cold prompt cache. Probe 100 showed this arithmetically without extra spend: in
//      its arm A the first turn cost $0.036147 while turns 2 and 3 cost $0.002125 and $0.003101 — and the
//      control arm's per-turn deltas were $0.002126 / $0.002798, i.e. IDENTICAL to arm A's once warm. The
//      whole gap was turn 1's cache write. Shrinking the system prompt barely helped (100b arm 3:
//      8101 ms / $0.010002 vs 9103 ms / $0.010599), which says the input bulk is the CLI's tool
//      definitions, not the prompt — and tool definitions cache.
//
// So the honest question for the spec is not "what does a cold one-shot cost" but "what does the Nth
// suggestion cost from a suggester session the harness keeps warm". That is what a real implementation
// would do, and it is the number EP-C5's cost/benefit turns on.
//
// WHAT COUNTS AS AN ANSWER. One persistent streaming session with a minimal system prompt, then four
// suggestion requests pushed through it back to back. Request 1 pays the spawn and the cache write and is
// expected to look like the one-shots. Requests 2–4 are the real per-turn figure. Reported as latency and
// as a cost DELTA per request (`total_cost_usd` is cumulative on a streaming session, so consecutive
// results must be subtracted — reporting the raw field per request would overstate every later one).
//
// A failure mode to avoid: a warm session ACCUMULATES the earlier requests in its context, so the later
// deltas could creep for a reason the real feature would share. Four transcript tails of different lengths
// are used and each delta is printed, so creep is visible rather than averaged away.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";

console.log("=== PROBE 100c — warm suggester session: per-suggestion latency and cost ===");

const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
function inputQueue() {
  const items: unknown[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () {
    while (true) {
      if (items.length) { yield items.shift(); continue; }
      if (closed) return;
      await new Promise<void>((r) => (wake = r));
    }
  })();
  return { iterable, push, close };
}

/** Four different transcript tails — a real suggester sees a new one each turn. */
const TAILS = [
  "user: In about four sentences, explain what a terminal escape sequence is.\nassistant: A terminal escape sequence is a series of bytes beginning with ESC that a terminal emulator interprets as a command rather than as text. OSC sequences in particular set window state such as the tab title.",
  "user: Add a --verbose flag to the CLI.\nassistant: Added `--verbose` to the argument parser and threaded it into the logger. It defaults to false and enables debug-level output when set.",
  "user: The test suite fails on CI but passes locally.\nassistant: The failing test depends on the system timezone. CI runs in UTC and the assertion hard-codes a local offset, so it drifts.",
  "user: Rename the User model to Account.\nassistant: Renamed the model, its table, and 14 references across 6 files. The migration is written but not applied.",
];

const dir = mkdtempSync(join(tmpdir(), "probe100c-"));
const q = inputQueue();
const Q = query({
  prompt: q.iterable as any,
  options: {
    model: MODEL,
    cwd: dir,
    permissionMode: "bypassPermissions",
    settingSources: [],
    maxTurns: 12,
    allowedTools: [],
    systemPrompt:
      "You predict the user's next message in a coding session. For each transcript tail, reply with ONE " +
      "short imperative follow-up under 12 words. No quotes, no preamble, nothing else.",
  } as any,
});

const started = Date.now();
let idx = 0;
let turnStart = Date.now();
let prevCost = 0;
let reply = "";
const rows: { n: number; ms: number; delta: number; text: string }[] = [];

q.push(userTurn("Transcript tail:\n\n" + TAILS[0] + "\n\nOne follow-up:"));
try {
  for await (const m of Q) {
    const mm = m as any;
    if (mm.type === "assistant") reply += (mm.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
    if (mm.type === "result") {
      const total = mm.total_cost_usd ?? 0;
      const delta = total - prevCost;
      prevCost = total;
      const ms = Date.now() - turnStart;
      rows.push({ n: idx + 1, ms, delta, text: reply.trim() });
      console.log(`  request ${idx + 1}: ${ms}ms · $${delta.toFixed(6)} · ${JSON.stringify(reply.trim().slice(0, 70))}`);
      reply = "";
      idx++;
      if (idx >= TAILS.length) { q.close(); break; }
      turnStart = Date.now();
      q.push(userTurn("Transcript tail:\n\n" + TAILS[idx] + "\n\nOne follow-up:"));
    }
  }
} catch (e: any) {
  console.log("STREAM THREW:", e?.name, e?.message);
}
q.close();

console.log("\n########## VERDICT ##########");
if (rows.length < 2) {
  console.log("UNDETERMINED — fewer than two requests completed, so there is no warm figure.");
} else {
  const warm = rows.slice(1);
  const avgMs = Math.round(warm.reduce((a, r) => a + r.ms, 0) / warm.length);
  const avgCost = warm.reduce((a, r) => a + r.delta, 0) / warm.length;
  console.log(`cold request 1 (spawn + cache write): ${rows[0].ms}ms · $${rows[0].delta.toFixed(6)}`);
  console.log(`warm requests 2..${rows.length}: avg ${avgMs}ms · avg $${avgCost.toFixed(6)} each`);
  console.log(`  per-request deltas: ${warm.map((r) => `$${r.delta.toFixed(6)}`).join(", ")}  (creep visible here if any)`);
  console.log(`  per-request latency: ${warm.map((r) => `${r.ms}ms`).join(", ")}`);
  console.log(`\ncompare to a COLD one-shot per suggestion (probe 100b arm 3): 8101ms · $0.010002`);
  console.log(`EP-C5 fallback verdict: keeping ONE warm suggester session costs ~$${avgCost.toFixed(6)} and`);
  console.log(`~${avgMs}ms per suggestion, against ~$0.0100 and ~8100ms if each suggestion spawns its own CLI.`);
  console.log(`The spinner-free window after a turn ends is where that ${avgMs}ms lands, so the pre-fill`);
  console.log(`arrives while the user is still reading the reply — but the spec must treat it as ASYNC and`);
  console.log(`must not block the composer on it.`);
}
console.log(`\ntotal probe wall time: ${Date.now() - started}ms · total session cost $${prevCost.toFixed(6)}`);
