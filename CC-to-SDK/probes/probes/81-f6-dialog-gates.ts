// Probe 81 — the three SDK premises the F6 wave (dialogs/pickers/panels) hangs on. Probe 78 settled
// the wire shape (suggestions arrive, echoing them back suppresses later consults IN-SESSION with
// destination:"session"). F6's acceptance goes further on three axes this probe settles:
//
//   Q1. destination:"localSettings" — does returning updatedPermissions with the suggestion's
//       destination REWRITTEN to "localSettings" (a) write <cwd>/.claude/settings.local.json, and
//       (b) suppress the consult in a FRESH query() process over the same cwd (the quit-and-relaunch
//       half of F6 acceptance #2)? The fresh process must load the file, so BOTH runs use
//       settingSources:["local"] — probe 78 used [] and could not see this.
//   Q2. EnterPlanMode — upstream has a dedicated "Enter plan mode?" dialog (DG28). Does the tool
//       exist headlessly, and does calling it reach canUseTool? (ExitPlanMode does — probe 66.)
//   Q3. Todo items — DG56–DG58 render owner tags, blocker lines and an in-progress activity
//       sub-line. What does the TodoWrite input actually carry headlessly (activeForm? owner?
//       blockedBy?), and do the TaskCreate/TaskUpdate task tools exist in the headless tool list?
//
// RESULT (run 2026-08-05, sonnet-4-6, keyed):
//   Q1 SETTLED YES — the echoed suggestion with destination rewritten to "localSettings" WROTE
//     <cwd>/.claude/settings.local.json in upstream's exact rule grammar:
//       { "permissions": { "allow": ["Read(//var/.../probe81-outside-<pid>/**)"] } }
//     and a FRESH query() process over the same cwd (settingSources:["local"]) consulted ZERO times.
//     The quit-and-relaunch half of F6 acceptance #2 is real. (Two suggestion variants again arrived —
//     raw and /private symlink-resolved — same as probe 78; the dialog picks one.)
//   Q2 SETTLED NO — EnterPlanMode executed headlessly (assistant tool_use, turn result=success) but
//     NEVER reached canUseTool: zero consults. There is no hook to hang an "Enter plan mode?" dialog
//     on → DG28 is UNREACHABLE headlessly; record it beside CM6/CM7. (The init tool-list check printed
//     false/[] for everything — initializationResult's tools field did not populate in this shape, so
//     only the zero-consult fact is load-bearing, not the list.)
//   Q3 — no TodoWrite fired; the model used TaskCreate {subject, description} ×3 + TaskUpdate
//     {taskId, status:"in_progress"}. Owner/blocker/activity are schema-optional and absent unless the
//     model sends them → DG58 renders those decorations only when present on the wire.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = join(tmpdir(), `probe81-${process.pid}`);
mkdirSync(base, { recursive: true });
const OUT = join(tmpdir(), `probe81-outside-${process.pid}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "one.txt"), "OUTSIDE-ONE\n");
writeFileSync(join(OUT, "two.txt"), "OUTSIDE-TWO\n");

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s: string) => console.log(`[${dt()}] ${s}`);
const localSettingsPath = join(base, ".claude", "settings.local.json");

function makeInput() {
  const pending: SDKUserMessage[] = [];
  let notify: (() => void) | null = null;
  let closed = false;
  async function* input(): AsyncIterable<SDKUserMessage> {
    while (!closed) {
      while (pending.length) yield pending.shift()!;
      await new Promise<void>((r) => (notify = r));
    }
  }
  return {
    input,
    send: (text: string) => { pending.push({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "" } as SDKUserMessage); notify?.(); },
    close: () => { closed = true; notify?.(); },
  };
}

async function drainTurn(q: AsyncGenerator<unknown>, label: string, onMessage?: (m: any) => void): Promise<void> {
  while (true) {
    const { value: m, done } = await q.next();   // manual .next(): a for-await break kills the transport (probe 75)
    if (done) return;
    const mm = m as any;
    onMessage?.(mm);
    if (mm.type === "result") { log(`${label}: result=${mm.subtype}`); return; }
  }
}

// ---------- Q1 run A: grant with destination:"localSettings", watch the file ----------
{
  const io = makeInput();
  const consults: string[] = [];
  let granted = false;
  const q = query({
    prompt: io.input(),
    options: {
      model: "claude-sonnet-4-6", cwd: base, settingSources: ["local"], permissionMode: "default", maxTurns: 12,
      canUseTool: async (name, toolInput, options) => {
        consults.push(name);
        log(`Q1A CONSULT #${consults.length} tool=${name}`);
        const o = (options ?? {}) as Record<string, unknown>;
        const sugs = Array.isArray(o.suggestions) ? (o.suggestions as any[]) : [];
        for (const s of sugs) log(`  suggestion: ${JSON.stringify(s)}`);
        if (name === "Read" && !granted && sugs.length) {
          granted = true;
          // The engine's own suggestion, destination REWRITTEN to localSettings — the F6 design's exact move.
          const perms = [{ ...sugs[0], destination: "localSettings" }];
          log(`  → allow + updatedPermissions=${JSON.stringify(perms)}`);
          return { behavior: "allow", updatedInput: toolInput, updatedPermissions: perms } as any;
        }
        return { behavior: "allow", updatedInput: toolInput };
      },
    },
  });
  try {
    io.send(`Using tools only, no commentary: Read ${join(OUT, "one.txt")} and repeat its contents.`);
    await drainTurn(q as any, "Q1A turn 1 (grant localSettings)");
    log(`Q1A file exists after grant: ${existsSync(localSettingsPath)}`);
    if (existsSync(localSettingsPath)) log(`Q1A settings.local.json = ${readFileSync(localSettingsPath, "utf8")}`);
    if (!granted) log(`Q1A INVALID: Read never consulted or no suggestion arrived — nothing was granted.`);
  } finally { io.close(); q.close?.(); }
}

// ---------- Q1 run B: FRESH process-level query over the same cwd — the relaunch half ----------
{
  const io = makeInput();
  const consults: string[] = [];
  const q = query({
    prompt: io.input(),
    options: {
      model: "claude-sonnet-4-6", cwd: base, settingSources: ["local"], permissionMode: "default", maxTurns: 12,
      canUseTool: async (name, toolInput) => { consults.push(name); log(`Q1B CONSULT #${consults.length} tool=${name}`); return { behavior: "allow", updatedInput: toolInput }; },
    },
  });
  try {
    io.send(`Using tools only, no commentary: Read ${join(OUT, "two.txt")} and repeat its contents.`);
    await drainTurn(q as any, "Q1B turn 1 (fresh session over same cwd)");
    const reads = consults.filter((c) => c === "Read").length;
    log(`Q1 VERDICT: fresh-session Read consulted ${reads}× (0 = localSettings persisted AND honoured across relaunch — acceptance #2 is real; 1+ = the rule did not survive)`);
    log(`Q1B file now: ${existsSync(localSettingsPath) ? readFileSync(localSettingsPath, "utf8") : "(absent)"}`);
  } finally { io.close(); q.close?.(); }
}

// ---------- Q2 + Q3: EnterPlanMode reachability and the todo/task tool census ----------
{
  const io = makeInput();
  const consults: { tool: string; keys: string[] }[] = [];
  const todoInputs: unknown[] = [];
  const q = query({
    prompt: io.input(),
    options: {
      model: "claude-sonnet-4-6", cwd: base, settingSources: [], permissionMode: "default", maxTurns: 16,
      canUseTool: async (name, toolInput, options) => {
        consults.push({ tool: name, keys: Object.keys((options ?? {}) as object) });
        log(`Q2/3 CONSULT tool=${name} inputKeys=[${Object.keys(toolInput ?? {}).join(",")}]`);
        if (name === "EnterPlanMode") log(`  !! EnterPlanMode REACHED canUseTool — DG28 is buildable. input=${JSON.stringify(toolInput)}`);
        return { behavior: "allow", updatedInput: toolInput };
      },
    },
  });
  try {
    const init = await (q as any).initializationResult();
    const tools: string[] = init?.tools ?? [];
    log(`Q2 tool list has EnterPlanMode: ${tools.includes("EnterPlanMode")} · ExitPlanMode: ${tools.includes("ExitPlanMode")}`);
    log(`Q3 task tools present: ${JSON.stringify(tools.filter((t) => /Todo|Task/i.test(t)))}`);

    io.send("Call the EnterPlanMode tool now to enter plan mode for the task 'rename a variable'. Tools only, no commentary.");
    await drainTurn(q as any, "Q2 turn (EnterPlanMode)", (mm) => {
      if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_use" && /plan/i.test(b.name)) log(`  assistant tool_use: ${b.name} input=${JSON.stringify(b.input)}`);
      }
    });
    log(`Q2 VERDICT: EnterPlanMode consulted ${consults.filter((c) => c.tool === "EnterPlanMode").length}× (0 with the tool absent from the list = DG28 unreachable headlessly)`);

    io.send("Using the TodoWrite tool (or TaskCreate if that is what you have), create a todo list with exactly 3 items: 'write parser' (in progress), 'add tests' (pending), 'update docs' (pending). Then stop.");
    await drainTurn(q as any, "Q3 turn (todo census)", (mm) => {
      if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_use" && /Todo|Task/i.test(b.name)) { todoInputs.push({ name: b.name, input: b.input }); log(`  todo tool_use: ${b.name} input=${JSON.stringify(b.input)}`); }
      }
    });
    const first = todoInputs[0] as any;
    if (first?.input?.todos?.length) {
      const item = first.input.todos[0];
      log(`Q3 VERDICT: item keys=[${Object.keys(item).join(",")}] (owner/blockedBy/activity present? that decides DG58's scope)`);
    } else if (first?.input) {
      log(`Q3 VERDICT: first task-tool input keys=[${Object.keys(first.input).join(",")}]`);
    } else log(`Q3 INCONCLUSIVE: no todo/task tool_use observed.`);
  } finally { io.close(); q.close?.(); }
}

rmSync(base, { recursive: true, force: true }); rmSync(OUT, { recursive: true, force: true });
log("probe 81 done");
process.exit(0);
