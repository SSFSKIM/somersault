// Probe 106 — does `interrupt: true` on a canUseTool DENY actually end the turn?
//
// Question (gates the Wave-2 acceptance A4 fix): rejecting a plan with an EMPTY feedback row must end
// the turn the way upstream's does — the deny row lands and the model says nothing more. ccx today
// returns `{behavior:"deny", message:"User rejected the plan."}` and the model volunteers a follow-up
// paragraph asking what to change. sdk.d.ts DECLARES `interrupt?: boolean` on `PermissionResult`'s deny
// arm with no doc comment anywhere, so declared ≠ reachable: only a live run says whether it stops the
// turn, what the stream looks like when it does, and whether the deny message still reaches the model.
//
//   Q1. With `interrupt: true`, does any assistant TEXT follow the denied ExitPlanMode?
//   Q2. What terminates the stream — a normal `result/success`, an error subtype, or a throw?
//   Q3. Control arm: the same deny WITHOUT the flag — does the follow-up paragraph appear (the ccx
//       behaviour A4 measured)?
//   Q4. Is the tool_result still delivered with our message (so the transcript row keeps its copy)?
//   Q5. THE ONE THAT DECIDES SHIPPABILITY: does the SESSION survive an interrupt-deny? `Session.interrupt()`
//       carries a recorded caution that the query stream may die at teardown; if the same is true here the
//       REPL would lose its engine every time a plan is waved off, which is far worse than a stray paragraph.
//       Arm A therefore pushes a second prompt after the interrupted turn and reads it to its own result.
//
// Both arms run in one process, back to back, each in its own throwaway cwd with `settingSources: []`
// so the machine's own agents/hooks/skills cannot answer the planning prompt instead.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 180_000;

const t0 = Date.now();
const dt = (): string => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const log = (s: string): void => { console.log(`[${dt()}] ${s}`); };
const trunc = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n)}…(len=${s.length})` : s);

function inputQueue() {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const push = (text: string): void => {
    items.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" } as unknown as SDKUserMessage);
    wake?.(); wake = null;
  };
  const close = (): void => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* (): AsyncIterable<SDKUserMessage> {
    while (true) {
      if (items.length) { yield items.shift()!; continue; }
      if (closed) return;
      await new Promise<void>((r) => (wake = r));
    }
  })();
  return { iterable, push, close };
}

interface ArmResult {
  label: string;
  planExitSeen: boolean;
  textAfterDeny: string[];
  toolResults: { is_error: unknown; content: string }[];
  terminator: string;
  threw?: string;
  /** Q5, arm A only: what a follow-up turn on the SAME session did after the interrupted one. */
  survivor?: string;
}

async function runArm(label: string, interrupt: boolean, probeSurvival = false): Promise<ArmResult> {
  const cwd = mkdtempSync(join(tmpdir(), "probe106-"));
  const q = inputQueue();
  const ac = new AbortController();
  const timer = setTimeout(() => { log(`${label}: DEADLINE — aborting`); ac.abort(); }, DEADLINE_MS);
  const out: ArmResult = { label, planExitSeen: false, textAfterDeny: [], toolResults: [], terminator: "(none)" };
  let denied = false;
  let planFilePath: string | null = null;

  const session = query({
    prompt: q.iterable,
    options: {
      model: MODEL, cwd, permissionMode: "plan", abortController: ac,
      settingSources: [],
      disallowedTools: ["Agent", "Task", "SendMessage", "Glob", "Grep", "Read", "Bash", "WebSearch", "WebFetch"],
      canUseTool: async (toolName, input, _options) => {
        if (/exit.?plan/i.test(toolName)) {
          out.planExitSeen = true; denied = true;
          if (typeof (input as { planFilePath?: unknown }).planFilePath === "string") planFilePath = (input as { planFilePath: string }).planFilePath;
          log(`${label}: DENY ExitPlanMode  interrupt=${interrupt}`);
          return { behavior: "deny", message: "User rejected the plan.", ...(interrupt ? { interrupt: true } : {}) };
        }
        return { behavior: "deny", message: "probe 106 denies non-plan-exit tools" };
      },
    },
  });

  q.push(
    "Do NOT use any tools to explore or read anything — you already have everything you need. " +
      "From general knowledge, plan how you would add a --version flag to a Node.js CLI. " +
      "Keep the plan to three short bullet points. " +
      "As soon as the plan is written, call ExitPlanMode to present it and exit plan mode.",
  );

  // ONE loop for both turns, and never `break` before the last one: breaking out of a `for await` calls
  // the async generator's `.return()`, which ENDS the SDK query — a first attempt at Q5 broke at the
  // interrupted turn's result and then read a dead stream, which would have "proved" the session died
  // when the probe itself had killed it.
  if (probeSurvival) out.survivor = "(stream ended with no result frame — session did NOT survive)";
  let results = 0;
  try {
    for await (const m of session) {
      const anyM = m as any;
      const afterFirstTurn = results >= 1;
      log(`${label}: MSG ${anyM.type}${anyM.subtype ? `/${anyM.subtype}` : ""}${anyM.type === "system" && anyM.subtype === "init" ? ` session_id=${anyM.session_id}` : ""}`);
      if (anyM.type === "assistant") {
        for (const b of anyM.message?.content ?? []) {
          if (b.type === "text" && b.text.trim()) {
            log(`${label}:   assistant text${afterFirstTurn ? " (turn 2)" : denied ? " (AFTER DENY)" : ""}: ${trunc(b.text)}`);
            if (denied && !afterFirstTurn) out.textAfterDeny.push(b.text);
          }
          if (b.type === "tool_use") log(`${label}:   tool_use ${b.name}`);
        }
      }
      if (anyM.type === "user" && Array.isArray(anyM.message?.content)) {
        for (const b of anyM.message.content) {
          if (b.type === "tool_result") {
            const content = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
            log(`${label}:   tool_result is_error=${b.is_error} content=${trunc(content)}`);
            out.toolResults.push({ is_error: b.is_error, content });
          }
        }
      }
      if (anyM.type === "result") {
        results++;
        log(`${label}:   result #${results}: subtype=${anyM.subtype} is_error=${anyM.is_error} num_turns=${anyM.num_turns} result=${trunc(String(anyM.result ?? ""), 160)}`);
        if (results === 1) {
          out.terminator = `result/${anyM.subtype}`;
          if (!probeSurvival) break;
          log(`${label}: pushing a SECOND prompt on the same session (Q5)`);
          q.push("Reply with exactly: STILL-ALIVE");
          continue;
        }
        out.survivor = `result/${anyM.subtype} is_error=${anyM.is_error} result=${trunc(String(anyM.result ?? ""), 120)}`;
        break;
      }
    }
  } catch (err: any) {
    out.threw = `${err?.name}: ${String(err?.message ?? err).slice(0, 300)}`;
    out.terminator = out.terminator === "(none)" ? `THREW ${out.threw}` : out.terminator;
    if (probeSurvival && out.survivor === undefined) out.survivor = `THREW ${out.threw}`;
    log(`${label}: THREW ${out.threw}`);
  } finally {
    q.close(); clearTimeout(timer);
    if (planFilePath?.startsWith(join(homedir(), ".claude", "plans"))) rmSync(planFilePath, { force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
  return out;
}

console.log("=== PROBE 106 — plan deny + interrupt ===");
const only = process.env.PROBE106_ARM;          // "A" / "B" to run one arm (the control arm is the pricey one)
const arms: ArmResult[] = [];
if (only !== "B") arms.push(await runArm("A(interrupt)", true, true));
if (only !== "A") arms.push(await runArm("B(control)", false));

console.log("\n=== SUMMARY ===");
for (const a of arms) {
  console.log(`\n${a.label}`);
  console.log(`  plan-exit consult seen : ${a.planExitSeen}`);
  console.log(`  assistant TEXT after deny: ${a.textAfterDeny.length} block(s)`);
  for (const t of a.textAfterDeny) console.log(`    - ${trunc(t, 200)}`);
  console.log(`  tool_results: ${a.toolResults.map((r) => `is_error=${r.is_error} ${trunc(r.content, 120)}`).join(" | ") || "(none)"}`);
  console.log(`  terminator: ${a.terminator}`);
  if (a.survivor !== undefined) console.log(`  next turn on the SAME session: ${a.survivor}`);
}

// ── ANSWER (live runs of 2026-08-11, claude-haiku-4-5, keyed from CC-to-SDK/.env) ─────────────────
// A1. `interrupt: true` ENDS THE TURN. Zero assistant text blocks follow the denied ExitPlanMode; the
//     stream goes tool_result → one bare `user` frame (the interrupt sentinel) → `result` in the same
//     millisecond. The control arm produced the follow-up paragraph every time — one on the first run
//     ("I see the plan was rejected… could you let me know what changes you'd like"), and on a later run
//     the model re-planned and re-presented FOUR more times before giving up (14 turns), which is the
//     A4 failure mode exactly.
// A2. The terminator is `result/error_during_execution` with `is_error: true` and an EMPTY `result`
//     string. In ccx that is a `turnFailureOf` failure that `Session.submit` RESOLVES with (never
//     rejects), and `SessionHost.runTask` discards the outcome — so no `✗` line reaches the transcript.
// A3. (control) — see A1.
// A4. THE DENY MESSAGE IS DISCARDED ON THE INTERRUPT ARM. With the flag the tool_result carries the
//     CLI's own canonical rejection text ("The user doesn't want to proceed with this tool use… STOP
//     what you are doing and wait for the user to tell you how to proceed.", the bundle's `Dpt`
//     L376056) instead of the message we sent; without the flag it carries ours verbatim. So the bare
//     plan rejection stops putting ccx-authored words in the user's mouth at all — the engine's own
//     wording is what the model reads, which is what upstream's model reads too.
// A5. THE SESSION SURVIVES. A second prompt pushed onto the same query after the interrupted turn ran
//     normally and answered `STILL-ALIVE` (`result/success`). A fresh `system/init` is emitted first and
//     it carries the SAME `session_id` (9e2205d4… both times), so no identity rotates under the client.
//     METHOD NOTE, recorded because it inverted the answer once: the first attempt `break`-ed out of the
//     `for await` at the interrupted turn's result and then read a dead stream. Breaking a `for await`
//     calls the generator's `.return()`, which ends the SDK query — the probe had killed the session it
//     was asking about. Both turns now run in ONE loop with a single break at the end.
