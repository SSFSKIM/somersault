// Probe 100b — can `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=true` force the follow-up suggestion on headlessly?
//
// WHY THIS EXISTS. Probe 100 found `promptSuggestions: true` alone produces NOTHING headlessly: zero
// `prompt_suggestion` frames across two eligible turns, and no frames at all in the post-result window.
// The obvious reading is "the surface is dead for a headless harness". Reading the installed 2.1.226
// bundle says that reading is premature. The CLI's own enable function is:
//
//   function w9o(){ let e = process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION;
//     if (md(e)) return L(…,{enabled:!1, source:Ae("env")}),          !1;   // env explicitly false
//     if (yr(e)) return L(…,{enabled:!0, source:Ae("env")}),          !0;   // env explicitly TRUE → returns here
//     if (!nt("tengu_chomp_inflection", !1)) return L(…,{source:"growthbook"}), !1;
//     if (Ln())  return L(…,{enabled:!1, source:Ae("non_interactive")}), !1;
//     …
//
// The env=true branch RETURNS BEFORE both the growthbook gate and the non-interactive check. If the SDK
// path runs through this same function, then the env var — not the `promptSuggestions` option — is the
// lever that reaches a headless harness, and EP-C5 gets the real upstream feature instead of a homemade
// imitation. If it still produces nothing, the feature is genuinely out of reach and the fallback stands
// on much firmer ground than "we tried the documented option once".
//
// SECOND QUESTION, same run. Probe 100's fallback arm cost 9.1s and $0.0106 per suggestion, because a bare
// `query()` spawns the CLI with Claude Code's full system prompt. Per turn, in the composer, that is not a
// nearly-free pre-fill — it is a second agent. A plain-string `systemPrompt` REPLACES that default prompt
// entirely, so this probe measures the same suggestion with a minimal one. If the cheap variant is close in
// quality, the fallback's real cost is that number, not probe 100's.
//
// THIRD, cheap: probe 100 saw `getSessionInfo().customTitle === "Alpha"` on a session nothing ever renamed,
// while `firstPrompt` was the verbatim prompt. That looks like headless auto-titling — but one observation
// on one session is an anecdote. Both sessions here are re-read to see whether a topic title appears again.
import { query, getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 240_000;

console.log("=== PROBE 100b — env-var override for prompt_suggestion · cheap fallback cost ===");

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

const SCRIPT = [
  "Reply with exactly one word: ALPHA",
  "Now reply with exactly one word: BRAVO",
  "In about four sentences, explain what a terminal escape sequence is.",
];

/** `env` REPLACES the subprocess environment rather than extending it (recorded SDK gotcha), so the parent
 *  env — which is where the OAuth token lives — must be spread in or the arm fails to authenticate and the
 *  probe reports "no suggestion" for an auth reason it never sees. */
async function runArm(label: string, opts: { sdkOption: boolean; envVar: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "probe100b-"));
  console.log(`\n───────── ARM ${label} — promptSuggestions:${opts.sdkOption} · env:${opts.envVar} ─────────`);

  const q = inputQueue();
  const Q = query({
    prompt: q.iterable as any,
    options: {
      model: MODEL,
      cwd: dir,
      permissionMode: "bypassPermissions",
      settingSources: [],
      includePartialMessages: true,
      maxTurns: 6,
      ...(opts.sdkOption ? { promptSuggestions: true } : {}),
      ...(opts.envVar ? { env: { ...process.env, CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "true" } } : {}),
    } as any,
  });

  let sid: string | undefined;
  let idx = 0;
  const suggestions: { turn: number; afterResultMs: number; text: string }[] = [];
  const tailFrames = new Set<string>();
  const costs: number[] = [];
  let lastResultAt = 0;
  let awaitingTail = false;

  q.push(userTurn(SCRIPT[0]));
  const deadline = setTimeout(() => { console.log("DEADLINE — closing input"); q.close(); }, DEADLINE_MS);
  try {
    for await (const m of Q) {
      const mm = m as any;
      const now = Date.now();
      if (mm.type === "stream_event") continue;
      if (mm.type === "system" && mm.subtype === "init" && !sid) { sid = mm.session_id; console.log(`  init · session ${sid}`); }
      if (awaitingTail && mm.type !== "result") tailFrames.add(`${mm.type}${mm.subtype ? "/" + mm.subtype : ""}`);
      if (mm.type === "prompt_suggestion") {
        suggestions.push({ turn: idx, afterResultMs: now - lastResultAt, text: String(mm.suggestion ?? "") });
        console.log(`  *** prompt_suggestion (turn ${idx}, +${now - lastResultAt}ms): ${JSON.stringify(mm.suggestion)}`);
        continue;
      }
      if (mm.type === "result") {
        lastResultAt = now;
        awaitingTail = true;
        costs.push(mm.total_cost_usd ?? 0);
        const delta = costs.length > 1 ? costs[costs.length - 1] - costs[costs.length - 2] : costs[0];
        console.log(`  [turn ${idx}] ${mm.subtype} · turn cost $${delta.toFixed(6)} (cumulative $${(mm.total_cost_usd ?? 0).toFixed(6)})`);
        await new Promise((r) => setTimeout(r, 3000));
        awaitingTail = false;
        idx++;
        if (idx >= SCRIPT.length) { q.close(); break; }
        q.push(userTurn(SCRIPT[idx]));
      }
    }
  } catch (e: any) {
    console.log("  STREAM THREW:", e?.name, e?.message);
  }
  clearTimeout(deadline);
  q.close();
  console.log(`  post-result window frame types: ${tailFrames.size ? [...tailFrames].join(", ") : "(none)"}`);
  return { sid, suggestions, dir, costs };
}

const ENVONLY = await runArm("1 (env var only)", { sdkOption: false, envVar: true });
const BOTH = await runArm("2 (env var + SDK option)", { sdkOption: true, envVar: true });

// ── the cheap fallback: same suggestion, minimal system prompt ────────────────────────────────────────
console.log("\n───────── ARM 3 — fallback with a MINIMAL system prompt (vs probe 100's 9.1s / $0.0106) ─────────");
const TAIL = [
  "user: In about four sentences, explain what a terminal escape sequence is.",
  "assistant: A terminal escape sequence is a series of bytes beginning with ESC that a terminal",
  "emulator interprets as a command rather than as text to display. They control the cursor, colors,",
  "and window properties such as the tab title. OSC sequences in particular set window state.",
].join("\n");
async function cheapFallback() {
  const dir = mkdtempSync(join(tmpdir(), "probe100b-fb-"));
  const t0 = Date.now();
  let text = "";
  let cost = 0;
  for await (const m of query({
    prompt: "Transcript tail:\n\n" + TAIL + "\n\nOne follow-up:",
    options: {
      model: MODEL,
      cwd: dir,
      permissionMode: "bypassPermissions",
      settingSources: [],
      maxTurns: 1,
      allowedTools: [],
      // A plain string REPLACES Claude Code's default system prompt — the whole point of this arm.
      systemPrompt:
        "You predict the user's next message in a coding session. Reply with ONE short imperative " +
        "follow-up under 12 words. No quotes, no preamble, nothing else.",
    } as any,
  })) {
    const mm = m as any;
    if (mm.type === "assistant") text += (mm.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
    if (mm.type === "result") cost = mm.total_cost_usd ?? 0;
  }
  return { ms: Date.now() - t0, cost, text: text.trim() };
}
let cheap: { ms: number; cost: number; text: string } | null = null;
try {
  cheap = await cheapFallback();
  console.log(`  latency ${cheap.ms}ms · cost $${cheap.cost.toFixed(6)}`);
  console.log(`  suggestion: ${JSON.stringify(cheap.text.slice(0, 160))}`);
} catch (e: any) {
  console.log("  ARM 3 THREW:", e?.name, e?.message);
}

// ── titles again, on two more sessions ───────────────────────────────────────────────────────────────
console.log("\n───────── ARM 4 — is the auto title reproducible? ─────────");
for (const [name, arm] of [["env-only", ENVONLY], ["both", BOTH]] as const) {
  if (!arm.sid) continue;
  try {
    const i: any = await getSessionInfo(arm.sid, { cwd: arm.dir } as any);
    console.log(`  ${name}: summary=${JSON.stringify(i?.summary)} customTitle=${JSON.stringify(i?.customTitle)} firstPrompt=${JSON.stringify(i?.firstPrompt)}`);
  } catch (e: any) {
    console.log(`  ${name}: getSessionInfo THREW ${e?.name}: ${e?.message}`);
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────────────────────────────
console.log("\n########## VERDICT ##########");
const hit = ENVONLY.suggestions.length + BOTH.suggestions.length;
console.log(`env-only suggestions: ${ENVONLY.suggestions.length} · env+option: ${BOTH.suggestions.length}`);
if (hit > 0) {
  console.log("REACHABLE VIA ENV VAR — `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=true` short-circuits both the");
  console.log("growthbook gate and the non-interactive gate, so a headless harness CAN receive the real");
  console.log("upstream `prompt_suggestion` frame. EP-C5 ships the native surface, not an imitation.");
  if (ENVONLY.suggestions.length && !BOTH.suggestions.length) console.log("  NOTE: the SDK option seems to SUPPRESS it — investigate before setting both.");
  if (!ENVONLY.suggestions.length && BOTH.suggestions.length) console.log("  NOTE: BOTH the env var and the option are required together.");
} else {
  console.log("STILL UNREACHABLE — even the env var that short-circuits every gate in the CLI's own enable");
  console.log("function produces no `prompt_suggestion` frame headlessly. The emitter itself is bound to a");
  console.log("surface the SDK transport does not have. EP-C5 must generate its own suggestion.");
  console.log(`Fallback cost to beat: probe 100 full-prompt 9103ms/$0.010599 · minimal-prompt ${cheap?.ms}ms/$${cheap?.cost.toFixed(6)}`);
}
