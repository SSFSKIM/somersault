// Probe 99 — is a RUNTIME permission-mode change refused, or silently accepted?
//
// Question (gates Wave T task 16's fix): `allowDangerouslySkipPermissions` is set only from the LAUNCH
// mode (harness src/config/resolveOptions.ts:66-67). So a session launched WITHOUT it that later calls
// setPermissionMode("bypassPermissions") is asking for something the flag never authorised. Task 16
// changed useChat's applyMode to move the mode truth only AFTER the setter resolves, and to print a
// refusal line when it rejects — but that fix rests on a premise nobody had measured:
//   Q1. Does `query.setPermissionMode("bypassPermissions")` REJECT on a session launched without
//       allowDangerouslySkipPermissions, or does it RESOLVE and leave the engine in the old mode?
//       If it resolves silently, task 16's catch never fires and the status bar still lies.
//   Q2. Same question for "auto", which is MODEL-gated (harness src/config/autoModel.ts): on a model
//       that cannot run auto, does the setter reject, or resolve while the engine falls back?
//   Q3. Does any frame REPORT the engine's effective mode afterwards, so a client could reconcile
//       without trusting the setter's return? (Probe 97 Q4 asked this for the plan path.)
//   Q4. Control: does a mode change the session IS entitled to ("plan") resolve cleanly, so a
//       rejection in Q1/Q2 is attributable to the refusal and not to the setter being broken?
//
// SAFETY. This probe deliberately ASKS for bypassPermissions, the mode in which the agent stops
// asking before running commands. It is fenced so that outcome cannot matter: cwd is a fresh mkdtemp,
// settingSources is [] (no user/project config, no hooks, no skills), canUseTool DENIES every consult
// unconditionally, and the prompt forbids tool use. If the flip were wrongly granted, there is still
// no tool the model can execute and no directory worth writing to. Nothing here can run a command.
//
// Method: one streaming-input session (control methods need it), cheap model, no turn longer than a
// sentence. Each setter is called inside its own try/catch and the outcome recorded as
// resolved/rejected plus the error text. After each attempt the session is asked for a trivial turn so
// any mode-bearing frame the CLI emits is captured.
//
// RESULT (run 2026-08-06, claude-haiku-4-5, keyed via CC-to-SDK/.env) — see the ANSWER block at the
// bottom of this file, written from the live run.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 180_000;

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const log = (s: string) => console.log(`[${dt()}] ${s}`);

type Attempt = { mode: string; outcome: "resolved" | "rejected"; error?: string };
const attempts: Attempt[] = [];
// Every frame that names a permission mode, in arrival order — Q3's evidence.
const modeSightings: Array<{ after: string; type: string; subtype?: string; mode: unknown }> = [];

const cwd = mkdtempSync(join(tmpdir(), "probe99-"));

// The streaming input channel. Turns are pushed by resolving `nextTurn`; the generator idles between.
let pushTurn: (text: string | null) => void = () => {};
async function* inputs(): AsyncGenerator<SDKUserMessage> {
  for (;;) {
    const text = await new Promise<string | null>((r) => { pushTurn = r; });
    if (text === null) return;
    yield { type: "user", session_id: "", parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "text", text }] } } as SDKUserMessage;
  }
}

const q = query({
  prompt: inputs(),
  options: {
    cwd, model: MODEL,
    permissionMode: "default",            // NOT bypass, and NOT allowDangerouslySkipPermissions — the whole point
    settingSources: [],                   // probe-97 lesson: default settingSources loads the machine's real config
    // Belt to the canUseTool brace: the model is told not to, the broker refuses, and these are gone.
    disallowedTools: ["Bash", "Write", "Edit", "Task", "Agent", "WebFetch", "WebSearch"],
    canUseTool: async (toolName: string) => {
      log(`  canUseTool DENIED ${toolName} (probe never allows a tool)`);
      return { behavior: "deny", message: "probe 99 denies every tool" } as never;
    },
  },
});

let currentLabel = "launch";
function noteFrame(m: any) {
  const mode = m?.permissionMode ?? m?.mode ?? m?.data?.permissionMode
    ?? m?.initializationResult?.permissionMode ?? m?.result?.permissionMode;
  if (mode !== undefined) modeSightings.push({ after: currentLabel, type: m?.type, subtype: m?.subtype, mode });
}

/** Drain frames until this turn's result arrives, recording any mode-bearing frame. */
async function runTurn(it: AsyncIterator<any>, text: string, label: string): Promise<void> {
  currentLabel = label;
  pushTurn(text);
  for (;;) {
    const { value, done } = await it.next();
    if (done) return;
    noteFrame(value);
    if (value?.type === "system" && value?.subtype === "init") log(`  init: permissionMode=${JSON.stringify(value?.permissionMode)}`);
    if (value?.type === "result") { log(`  turn result: subtype=${value?.subtype} is_error=${value?.is_error}`); return; }
  }
}

async function attempt(mode: string): Promise<void> {
  try {
    await (q as any).setPermissionMode(mode);
    attempts.push({ mode, outcome: "resolved" });
    log(`setPermissionMode(${JSON.stringify(mode)}) → RESOLVED`);
  } catch (e) {
    const error = (e as Error)?.message ?? String(e);
    attempts.push({ mode, outcome: "rejected", error });
    log(`setPermissionMode(${JSON.stringify(mode)}) → REJECTED: ${error}`);
  }
}

async function main() {
  const it = (q as any)[Symbol.asyncIterator]();
  log(`cwd=${cwd} model=${MODEL} launch mode=default, allowDangerouslySkipPermissions NOT set`);

  await runTurn(it, "Reply with exactly the word: ready. Do not use any tool.", "launch");

  // Q4 control first — an entitled change. If this rejects, the setter itself is broken and Q1/Q2 prove nothing.
  await attempt("plan");
  await runTurn(it, "Reply with exactly the word: one. Do not use any tool.", "after plan");

  // Q1 — the unentitled one.
  await attempt("bypassPermissions");
  await runTurn(it, "Reply with exactly the word: two. Do not use any tool.", "after bypassPermissions");

  // Q2 — the model-gated one. haiku is not an auto-capable model.
  await attempt("auto");
  await runTurn(it, "Reply with exactly the word: three. Do not use any tool.", "after auto");

  pushTurn(null);
  await (q as any).interrupt?.().catch(() => {});
}

const timer = setTimeout(() => { log("DEADLINE — aborting"); process.exit(1); }, DEADLINE_MS);
main()
  .then(() => {
    clearTimeout(timer);
    console.log("\n================ PROBE 99 RESULT ================");
    console.log("setPermissionMode attempts:");
    for (const a of attempts) console.log(`  ${a.mode.padEnd(20)} ${a.outcome}${a.error ? `  — ${a.error}` : ""}`);
    console.log("\nmode-bearing frames seen:");
    if (modeSightings.length === 0) console.log("  (none — no frame reported an effective permission mode)");
    for (const s of modeSightings) console.log(`  after ${s.after.padEnd(24)} ${s.type}/${s.subtype ?? "-"} → ${JSON.stringify(s.mode)}`);
    console.log("================================================");
  })
  .catch((e) => { clearTimeout(timer); console.error("PROBE FAILED:", e); process.exitCode = 1; })
  .finally(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch {} });

// ================================ ANSWER (live run 2026-08-06) ================================
//
// A1. `setPermissionMode("bypassPermissions")` REJECTS on a session launched without the flag:
//       "Cannot set permission mode to bypassPermissions because the session was not launched with
//        --dangerously-skip-permissions"
//     So the setter is a real gate, not advisory. Wave T task 16's `catch` genuinely fires, and its
//     refusal row carries the engine's own sentence. The fix is PROVEN, not merely plausible.
//
// A2. `setPermissionMode("auto")` on a non-auto model ALSO REJECTS — and this OVERTURNS a standing
//     project premise:
//       "Cannot set permission mode to auto: auto mode unavailable for this model"
//     The recorded contract (harness src/config/autoModel.ts, and the comments in host.ts's
//     applyPlanUpgrade and useChat's applyMode) says an unsupported model makes `auto` fall back to
//     `default` IN SILENCE, which is why both appliers swap the model first. The swap-first ordering
//     is still right — it is what makes `auto` actually succeed — but the hazard it was written to
//     prevent does not exist. The engine refuses loudly instead of lying quietly.
//     Consequence: the "lying chip" cannot arise on the auto path at all. Any comment claiming a
//     silent fallback is now false and must say "the engine REFUSES" instead.
//
// A3. The engine's effective mode IS reportable. `system/init` carries `permissionMode` on every turn,
//     and a `system/status` frame carried it after the accepted change. Crucially, after BOTH
//     rejections `system/init` still read "plan" — the mode the session was actually in. So a client
//     can reconcile from frames and never has to trust the setter's return value alone.
//
// A4. Control passed: the entitled change ("plan") RESOLVED cleanly and the next init reported "plan".
//     The two rejections are therefore attributable to the refusal itself, not to a broken setter.
//
// Cost: ~9 s, four one-word turns on haiku. Nothing was executed — canUseTool denied every consult
// (none were ever requested) and the cwd was a temp dir, removed on exit.
// ==============================================================================================
