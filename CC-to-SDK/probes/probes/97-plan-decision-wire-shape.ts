// Probe 97 — the plan-decision wire shape: what EXACTLY does canUseTool receive when a session in
// permissionMode "plan" wants to exit plan mode?
//
// Question (gates the plan dialog): the QA sprint found live plan approvals rendering as GENERIC
// permission dialogs rather than a plan-review dialog. The suspect is classification evidence — the
// host classifies a parked decision by what canUseTool hands it, and if the plan-exit consult looks
// like every other tool consult, `kind:"plan"` is unreachable. So:
//   Q1. What is the EXACT toolName string for the plan-exit consult? (ExitPlanMode? exit_plan_mode?)
//   Q2. What are the input keys, and does the input carry the plan MARKDOWN (the thing a plan dialog
//       must render) or just a handle?
//   Q3. What is in the 3rd `options` arg — suggestions, decisionReason, title, displayName,
//       description? Probe 78 censused those for Read/Write/Edit; this asks whether the plan consult
//       carries anything that distinguishes it beyond the tool name itself.
//   Q4. After returning {behavior:"allow"}, does the SDK REPORT the mode change — any message whose
//       payload names the new permission mode — or is the host expected to track it?
//
// Method: one streaming-input session, permissionMode:"plan", cheap model, one short turn. Every
// canUseTool invocation is logged in full (long strings truncated at 200 chars). The plan-exit call is
// ALLOWED once with updatedInput:input; every other consult is denied so the turn stays cheap and the
// probe cannot touch the filesystem. All frames after the allow are dumped, and the session is
// interrogated afterwards (initializationResult) for any mode field.
//
// RUN 1 WAS INVALID (recorded, not hidden): with default `settingSources` the session loaded the
// machine's USER settings — global agents, hooks, skills — and the model answered the planning prompt
// by dispatching an async `Agent` subagent to explore an empty tmp dir, then ended the turn without
// ever reaching ExitPlanMode. Zero consults, nothing proven. The fix is isolation: settingSources:[]
// (no user/project config), a disallowedTools fence around the delegation + exploration tools, and a
// prompt that forbids tool use so the only tool left to call is the plan exit itself.
//
// RESULT (run 2026-08-06, claude-haiku-4-5, keyed via CC-to-SDK/.env) — see the ANSWER block at the
// bottom of this file, written from the live run.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 180_000;
const TRUNC = 200;

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const log = (s: string) => console.log(`[${dt()}] ${s}`);

function trunc(v: unknown): unknown {
  if (typeof v === "string") return v.length > TRUNC ? `${v.slice(0, TRUNC)}…(len=${v.length})` : v;
  if (Array.isArray(v)) return v.map(trunc);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = trunc(val);
    return out;
  }
  return v;
}
const j = (v: unknown) => JSON.stringify(trunc(v));

function inputQueue() {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const push = (text: string) => {
    items.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: "",
    } as unknown as SDKUserMessage);
    wake?.();
    wake = null;
  };
  const close = () => {
    closed = true;
    wake?.();
    wake = null;
  };
  const iterable = (async function* (): AsyncIterable<SDKUserMessage> {
    while (true) {
      if (items.length) {
        yield items.shift()!;
        continue;
      }
      if (closed) return;
      await new Promise<void>((r) => (wake = r));
    }
  })();
  return { iterable, push, close };
}

const cwd = mkdtempSync(join(tmpdir(), "probe97-"));
console.log("=== PROBE 97 — plan-decision wire shape ===");
console.log(`cwd: ${cwd} · model: ${MODEL} · permissionMode: plan`);

const q = inputQueue();
const ac = new AbortController();
const timer = setTimeout(() => {
  log("DEADLINE reached — aborting");
  ac.abort();
}, DEADLINE_MS);

const consults: { at: string; tool: string; decision: string }[] = [];
let planExitSeen = false;
let planExitAllowedAt: string | null = null;
// Plan mode writes the plan into the REAL ~/.claude/plans/ before consulting; the probe deletes it.
let planFilePath: string | null = null;

const session = query({
  prompt: q.iterable,
  options: {
    model: MODEL,
    cwd,
    permissionMode: "plan",
    abortController: ac,
    // Isolation (see RUN 1 note in the header): no user/project settings, no delegation, no explore.
    settingSources: [],
    disallowedTools: ["Agent", "Task", "SendMessage", "Glob", "Grep", "Read", "Bash", "WebSearch", "WebFetch"],
    canUseTool: async (toolName, input, options) => {
      const at = dt();
      console.log(`\n[${at}] ── canUseTool #${consults.length + 1} ──────────────────────────`);
      log(`  toolName (exact): ${JSON.stringify(toolName)}`);
      log(`  input keys      : ${JSON.stringify(Object.keys(input))}`);
      log(`  options keys    : ${JSON.stringify(Object.keys(options as object))}`);
      // Everything in the 3rd arg except the AbortSignal (not serializable, not evidence).
      const optDump: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(options as unknown as Record<string, unknown>)) {
        if (k === "signal") {
          optDump[k] = `<AbortSignal aborted=${(v as AbortSignal)?.aborted}>`;
          continue;
        }
        optDump[k] = v;
      }
      log(`  options full    : ${j(optDump)}`);

      // The plan-exit consult gets the full input dump; other tools get keys only (kept cheap).
      const isPlanExit = /exit.?plan/i.test(toolName);
      if (isPlanExit) {
        planExitSeen = true;
        log(`  *** PLAN-EXIT CONSULT ***`);
        log(`  input full      : ${j(input)}`);
        for (const [k, v] of Object.entries(input)) {
          log(`    input.${k}: type=${typeof v} ${j(v)}`);
        }
        if (typeof input.planFilePath === "string") planFilePath = input.planFilePath;
        planExitAllowedAt = at;
        consults.push({ at, tool: toolName, decision: "allow" });
        log(`  DECISION: allow (updatedInput = input)`);
        return { behavior: "allow", updatedInput: input };
      }
      log(`  input (truncated): ${j(input)}`);
      consults.push({ at, tool: toolName, decision: "deny" });
      log(`  DECISION: deny (probe keeps the turn cheap and read-only)`);
      return { behavior: "deny", message: "probe 97 denies non-plan-exit tools" };
    },
  },
});

q.push(
  "Do NOT use any tools to explore or read anything — you already have everything you need. " +
    "From general knowledge, plan how you would add a --version flag to a Node.js CLI. " +
    "Keep the plan to three short bullet points. " +
    "As soon as the plan is written, call ExitPlanMode to present it and exit plan mode.",
);

let sawResult = false;
try {
  for await (const m of session) {
    const anyM = m as any;
    const tag = `${anyM.type}${anyM.subtype ? `/${anyM.subtype}` : ""}`;
    log(`MSG ${tag} keys=[${Object.keys(anyM).join(", ")}]`);
    // Hunt for any field that reports a permission mode — Q4.
    const dump = JSON.stringify(anyM);
    if (/permission_?mode|permissionMode|acceptEdits|"plan"/i.test(dump)) {
      log(`  ^ MODE-BEARING FRAME: ${j(anyM)}`);
    }
    if (anyM.type === "assistant") {
      for (const b of anyM.message?.content ?? []) {
        if (b.type === "text") log(`  assistant text: ${j(b.text)}`);
        if (b.type === "tool_use") log(`  assistant tool_use: name=${JSON.stringify(b.name)} id=${b.id} input=${j(b.input)}`);
      }
    }
    if (anyM.type === "user") {
      const content = anyM.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "tool_result") log(`  tool_result: is_error=${b.is_error} content=${j(b.content)}`);
        }
      } else log(`  user content: ${j(content)}`);
    }
    if (anyM.type === "system") log(`  system frame: ${j(anyM)}`);
    if (anyM.type === "result") {
      sawResult = true;
      log(`  result: ${j(anyM)}`);
      break;
    }
  }
} catch (err: any) {
  log(`THREW ${err?.name}: ${String(err?.message ?? err).slice(0, 400)}`);
} finally {
  // Q4 follow-up: ask the live session what it thinks its mode is now.
  try {
    const init = await session.initializationResult();
    log(`initializationResult(): ${j(init)}`);
  } catch (err: any) {
    log(`initializationResult() failed: ${err?.message}`);
  }
  q.close();
  clearTimeout(timer);
  // Leave no plan file behind in the user's real ~/.claude/plans/ (guarded to that directory).
  if (planFilePath?.startsWith(join(homedir(), ".claude", "plans"))) {
    rmSync(planFilePath, { force: true });
    log(`cleaned up plan file: ${planFilePath}`);
  }
}

console.log("\n=== SUMMARY ===");
console.log(`consults: ${consults.length}`);
for (const c of consults) console.log(`  ${c.at} ${c.tool} → ${c.decision}`);
console.log(`plan-exit consult seen: ${planExitSeen}${planExitAllowedAt ? ` (allowed at ${planExitAllowedAt})` : ""}`);
console.log(`result frame seen: ${sawResult}`);

// ── ANSWER (from the live run of 2026-08-06; raw trace in waveT-probe-findings.md) ───────────────
// A1. toolName is exactly "ExitPlanMode" (PascalCase, no namespace).
// A2. input keys are ["plan","planFilePath"]. `plan` is the FULL plan MARKDOWN (785 chars in this run,
//     headings and all) — a plan dialog can render the real document, no fetch needed. `planFilePath`
//     is an absolute path the CLI already wrote the plan to, under ~/.claude/plans/<slug>.md.
// A3. THE CLASSIFICATION ANSWER, and it is the negative one: the 3rd arg has the SAME key set as every
//     other tool consult (probe 78 saw the identical ten on Read/Write/Edit) —
//       signal · suggestions · blockedPath · decisionReason · title · displayName · description ·
//       toolUseID · agentID · requestId
//     but for ExitPlanMode only FOUR are defined: signal, toolUseID, requestId, and
//     displayName:"ExitPlanMode" (the raw tool name, not a human phrase like Read's "Read file").
//     suggestions, blockedPath, decisionReason, title, description and agentID are all UNDEFINED.
//     So there is NO flag, no reason type, no kind marker saying "this is a plan decision" — the only
//     evidence is toolName === "ExitPlanMode" plus the input shape. That is exactly why live plan
//     approvals render as generic permission dialogs: a host that classifies by the options payload has
//     nothing to classify on and falls through to the default. Classification MUST be name-driven.
//     There is also no title/description to render, so a plan dialog has to supply its own wording.
// A4. THE MODE CHANGE IS REPORTED. 10ms after the allow returned, the session emitted
//       {type:"system", subtype:"status", status:null, permissionMode:"default", uuid, session_id}
//     — a dedicated frame carrying the NEW mode. The host does not have to infer it. The tool_result
//     that follows also carries a structured sidecar, tool_use_result:{plan, isAgent:false, filePath},
//     alongside the text "User has approved your plan. You can now start coding…".
// SIDE FACTS worth keeping:
//   · The plan file is written by a Write call that NEVER reaches canUseTool — plan mode privileges
//     writes into ~/.claude/plans/, so the host cannot gate (or see a consult for) that file.
//   · ExitPlanMode was listed in system/init `tools` but was DEFERRED: the model had to call
//     ToolSearch("select:ExitPlanMode") before it could invoke it (it first misfired with
//     Skill{skill:"ExitPlanMode"} → "Unknown skill"). A plan-mode host should expect that detour.
//   · `EnterPlanMode` also exists in the tool list — the reverse transition is a tool too.
