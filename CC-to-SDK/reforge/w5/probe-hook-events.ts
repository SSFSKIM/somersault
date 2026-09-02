// W5 probe — WHICH hook events actually fire on the headless seam, and can a
// COMMAND hook (a shell script, not a callback) be registered without touching
// the filesystem's settings layers?
//
// Campaign spec C8 / the live-probe-first discipline.
//
// ---------------------------------------------------------------------------
// THE POPULATION UNDER TEST IS NOT CHOSEN HERE (C8 fix wave 2, 2026-09-01).
//
// This probe got its answer wrong twice, and both times the error was upstream
// of the measurement: it was in WHAT GOT MEASURED. The first take inherited
// "8 of 30 events" from a `coverage.md` line written against a different pin.
// The second take replaced that with a hand-written list of "every event with a
// dispatcher a single tool-using turn could plausibly reach" — judgment again,
// and it silently omitted three events that fire (PostCompact, TaskCreated,
// Notification). An event nobody thought to watch cannot be measured as absent;
// a list the tester writes can only ever confirm the tester.
//
// So the watched list is now DERIVED FROM THE ARTIFACT. Upstream keeps the
// enumeration of record — one object literal mapping every hook event to the
// function that dispatches it — and
// `research/tools/extract-hook-registry.ts` snapshots it into a pin-keyed
// fixture that the gate re-derives every run. All 33 registry events are
// watched, in every phase, on both hook paths. Nothing about which events
// "seem reachable" is decided in this file.
//
// AND EVERY VERDICT NAMES ITS CONDITION. A negative is only evidence if the
// firing condition was actually created, so each event carries one, and the
// verdict table below reports one of three things per event:
//
//   FIRED  — observed: in a phase here, or — when the row carries a `firedIn`
//            — in the named run elsewhere in the campaign that created its
//            condition. Provenance is printed either way, never elided.
//   DEAD   — the condition WAS created in a phase here, and it did not fire
//   OPEN   — the condition is named but not created, so nothing is claimed
//
// OPEN is the honest shape for an event whose condition needs machinery out of
// proportion to the cell (an eliciting MCP server, a teammate session, a
// `--worktree` launch). It is not a negative and must never be counted as one.
//
// And OPEN is a STATE, not a verdict: a row leaves it the moment someone
// anywhere creates the condition it names. `PermissionDenied` did exactly that
// (2026-09-02) — see its entry — which is why the table reads a row's evidence
// from the whole campaign rather than only from this file's own phases.
//
// ---------------------------------------------------------------------------
// THE SECOND QUESTION: the wave's one non-trivial fixture. `Options.hooks`
// takes CALLBACKS only (`HookCallbackMatcher.hooks: HookCallback[]`), and a
// callback never reaches the executor's command path — so nothing in the corpus
// grades the hook-input record as the BYTE STREAM a command hook reads on stdin,
// which is what the owned PostToolUse module's field order actually is. Command
// hooks live in settings, and `settingSources: ["project"]` would drag the
// operator's ancestor `.claude/` directories in (the W3 recording trap). The
// SDK's `Options.settings` is the way out if it works: an INLINE settings object
// loaded into the flag-settings layer, no filesystem source enabled.
//
// Both kinds of hook are registered for every event in every phase anyway,
// because the two paths differ in TIMING even though they no longer differ in
// reach (see the mechanism note below): a dispatch that runs before host-hook
// registration completes, or after the SDK iterator has ended, is visible on the
// settings path and invisible on the callback one.
//
// ---------------------------------------------------------------------------
// THE MECHANISM, corrected. An earlier revision of this file claimed a callback
// reaches a dispatcher "only if that dispatcher hands the executor the session
// hooks registry", and read SessionStart's callback silence as structural. The
// bundle refutes it. `Options.hooks` entries are NOT registry entries: the
// initialize handler runs them through `createHookCallback`, tags them
// `origin:"sdkHost"` and pushes them into a GLOBAL store
// (`Y().registeredHooks`); the lookup every dispatcher's executor performs
// (`IE(event)`, chunk-fy12d89p offset 538966) returns that global store's entry
// for the event UNCONDITIONALLY, merged with the settings layers, whether or not
// a registry was handed to the executor. So a callback can observe a dispatcher
// that passes no registry.
//
// What the executor-request bytes do say is unchanged and still true: `vUt`,
// `tz` and `EE` call their executor with no session hooks registry, which is why
// the owned modules forward none. SessionStart's callback silence is a TIMING
// artifact — its dispatch precedes host-hook registration — not unreachability.
//
// Run: cd reforge && set -a; . ../.env; set +a; npx tsx w5/probe-hook-events.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { query, type HookEvent, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, pushable, resetSandbox, userMessage, type ScenarioContext } from "../src/harness.js";
import { requireRecordCredential } from "../src/env.js";
import { deriveFaultCassette } from "../src/faults.js";
import { startRecordProxy, startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, SANDBOX, sdkEnv } from "../src/runTurn.js";
import { readFixture } from "../research/tools/extract-hook-registry.js";

/** Every event upstream's dispatcher registry knows — the enumeration of record. */
const REGISTRY = readFixture();
const WATCHED = REGISTRY.events.map((e) => e.event) as HookEvent[];

/**
 * Per event: the condition that makes its dispatcher run, and the phase below
 * that creates it. `phase: null` means no phase HERE creates it. That is an
 * OPEN row — never a negative — unless the row also carries `firedIn`, which
 * names the run elsewhere in the campaign that did create the condition and
 * observed the dispatch; such a row is FIRED, with that provenance printed.
 *
 * Every entry is read off the dispatcher's call sites in the pinned bundle (the
 * `callSites` section of the registry fixture points at them), not guessed.
 */
const CONDITIONS: Record<string, { phase: string | null; firedIn?: string; condition: string }> = {
  PreToolUse: { phase: "batch", condition: "any tool call" },
  PostToolUse: { phase: "batch", condition: "a tool call that succeeds" },
  PostToolUseFailure: { phase: "tool-failure", condition: "a tool call that fails (`dQ`'s error arm)" },
  PostToolBatch: { phase: "batch", condition: "two tool calls issued in one assistant response" },
  UserPromptSubmit: { phase: "batch", condition: "any user prompt" },
  Stop: { phase: "batch", condition: "the main agent finishes a turn" },
  SubagentStop: { phase: "subagent", condition: "an Agent dispatch finishes (also observed on the compaction path, which is not the named condition)" },
  SubagentStart: { phase: "subagent", condition: "an Agent dispatch starts" },
  MessageDisplay: { phase: "batch", condition: "an assistant message is displayed" },
  SessionStart: { phase: "batch", condition: "every run starts one" },
  SessionEnd: { phase: "session-end", condition: "`/clear`, session resume, or the app's own shutdown() teardown (three callers)" },
  PreCompact: { phase: "compact", condition: "a compaction (`/compact`, or the auto threshold)" },
  PostCompact: { phase: "compact", condition: "the same compaction, after the summary exists (`wFt` awaits `kPe` at 2812705)" },
  Notification: {
    phase: "permission-delay",
    condition: "a can_use_tool request left unanswered past the 6000 ms notify timer (`S3e`, armed before every sendRequest in createCanUseTool)",
  },
  PermissionRequest: { phase: "permission-delay", condition: "a tool call evaluated by the permission system (not bypassed)" },
  PermissionDenied: {
    phase: null,
    firedIn: "w6/probe-permissions.ts phase `auto-classifier-unavailable`, recorded as corpus scenario `perm-auto-classifier-deny` (w6/scenarios.ts)",
    condition:
      "a denial whose `decisionReason` is the AUTO-MODE CLASSIFIER — the sole call site is guarded on " +
      "`decisionReason.classifier === \"auto-mode\"`, so an ordinary deny does not reach it (the permission-delay " +
      "phase here denies one and it does not fire: the right answer to the wrong condition). CREATED 2026-09-02, " +
      "and not by a better prompt — under `auto`, with the classifier's OWN `/v1/messages` call answered 400 at " +
      "record time, upstream denies fail-closed with `{type:\"classifier\", classifier:\"auto-mode\"}`, which is " +
      "byte-for-byte the guard on the dispatcher's sole call site. The event FIRED on BOTH hook paths — the SDK " +
      "callback and the settings-layer command hook — and the dispatcher is now spliced as the manifest row " +
      "`permission-denied-hooks`.",
  },
  TaskCreated: { phase: "tasks", condition: "a TaskCreate tool call (dispatched inside the tool's own `call()`)" },
  TaskCompleted: { phase: "tasks", condition: "a TaskUpdate that moves a task's status to `completed`" },
  StopFailure: { phase: "api-error", condition: "a turn that ends in an api_error / prompt_too_long / malformed-tool-use message" },
  InstructionsLoaded: { phase: "memory", condition: "a CLAUDE.md-class memory file loads (type User/Project/Local/Managed)" },
  UserPromptExpansion: { phase: "slash-expansion", condition: "a slash command, skill or MCP prompt is expanded into a prompt" },
  DirectoryAdded: {
    phase: null,
    condition:
      "`/add-dir`, or an MCP `register_repo_root` call. MEASURED 2026-09-01: the slash command refuses headlessly " +
      "(\"/add-dir isn't available in this environment\"), so the cheap route does not create the condition and the " +
      "MCP route needs a server — the phase that tried it was removed rather than left standing as a fake negative.",
  },
  CwdChanged: {
    phase: "cwd-change",
    condition:
      "the tracked cwd MOVES (`onCwdChanged`), with a CwdChanged or FileChanged hook registered to arm the watcher. " +
      "The tracked cwd moves headlessly through the Bash tool's post-command tracking (the `tengu_shell_set_cwd` " +
      "block), which reads the shell's final PWD and calls `onCwdChanged` when a `cd` persists past the command. " +
      "W5 left this OPEN because no phase ran a `cd`; the `cwd-change` phase creates the condition, so the verdict " +
      "here is now a measurement in either direction.",
  },
  FileChanged: { phase: "file-watch", condition: "a watcher event on a path a FileChanged hook's MATCHER named (the matcher arms chokidar; hook output does not)" },
  PreModelSwitch: { phase: "model-switch", condition: "a model change proposed (`/model`), before it is applied" },
  PostModelSwitch: { phase: "model-switch", condition: "the app state's `mainLoopModel` actually changes" },
  Elicitation: { phase: null, condition: "an MCP server issues an elicitation request — needs an eliciting MCP server" },
  ElicitationResult: { phase: null, condition: "that elicitation is answered — same server" },
  TeammateIdle: { phase: null, condition: "a teammate session goes idle (`na()`-gated teammate loop)" },
  WorktreeCreate: { phase: null, condition: "a `--worktree` launch with a WorktreeCreate hook registered (`Z8()`); the entrypoint is not on the SDK's Options" },
  WorktreeRemove: { phase: null, condition: "the same worktree torn down" },
  Setup: { phase: null, condition: "a run launched with a setup trigger (`setupTrigger`, resolved at CLI arg parsing and not exposed on the SDK's Options)" },
  ConfigChange: { phase: null, condition: "the interactive app's config-change subscriber fires (`Kve` in the REPL app-state chunk)" },
};

const STDIN_DUMP = join(SANDBOX, "probe-command-hook-stdin.json");
/**
 * Where each event's command hook appends its marker — one file per event.
 *
 * Deliberately NOT in the sandbox: `resetSandbox()` runs at the top of every
 * phase, so a marker written there would be wiped by the next phase before it
 * could be read. `.scratch/` is gitignored and drained per phase instead.
 */
const MARKERS = join(REFORGE_ROOT, ".scratch", "w5-probe-markers");
const markerFile = (e: string) => join(MARKERS, `${e}.log`);

/**
 * A command hook that appends one line naming the event it was dispatched for,
 * and the record's key set.
 *
 * Appending rather than overwriting so a phase that fires the same event twice
 * is visible as two lines, and reading the record's own `hook_event_name` off
 * stdin rather than trusting the registration — a dispatcher that stamped the
 * wrong event name would otherwise be invisible here. The key set is what tells
 * a splice which fields the record carries.
 */
const markerHook = (e: string) => ({
  hooks: [
    {
      type: "command" as const,
      command: `node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{let n,k;try{const i=JSON.parse(s);n=i.hook_event_name;k=Object.keys(i).join(",")}catch{n="<unparsed>";k=""}require("fs").appendFileSync(${JSON.stringify(
        markerFile(e),
      )},n+" | "+k+"\\n")})'`,
    },
  ],
});

/**
 * The FileChanged condition needs more than a marker hook: the watcher is armed
 * from the hook's MATCHER, not from anything the hook prints. `U()` reads every
 * registered FileChanged matcher, splits it on `|`, resolves each piece against
 * the cwd and hands the resulting list to chokidar — so a matcher-less hook
 * arms nothing and a watchPaths document on stdout is ignored.
 */
const watchedPathHook = (e: string) => ({
  matcher: SANDBOX,
  ...markerHook(e),
});

interface PhaseResult {
  /** callback fires, by event */
  callbacks: Map<string, number>;
  /** command-hook marker lines, by event */
  commands: Map<string, string[]>;
  /**
   * What the engine actually said, truncated. A phase whose condition silently
   * failed to be created ("Unknown slash command", a tool the model declined to
   * call) is otherwise indistinguishable from a dispatcher that did not fire —
   * which is the exact confusion this whole probe exists to remove.
   */
  results: string[];
  error?: string;
}

/** Read every marker file written so far and clear them, so a phase reports only its own fires. */
function drainMarkers(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(MARKERS)) return out;
  for (const f of readdirSync(MARKERS)) {
    const lines = readFileSync(join(MARKERS, f), "utf8").split("\n").filter(Boolean);
    if (lines.length > 0) out.set(f.replace(/\.log$/, ""), lines);
    rmSync(join(MARKERS, f), { force: true });
  }
  return out;
}

interface PhaseSpec {
  label: string;
  condition: string;
  extra: Partial<Options>;
  next: (results: number) => string | null;
  /** run after `resetSandbox()`, before the query — for phases whose condition is a file on disk */
  prepare?: () => void;
  /**
   * Serve from a cassette instead of the live API. The api_error condition is a
   * RESPONSE, and the only way to create one on purpose is to author it: the
   * fault derivation the H2 suite already owns turns a healthy recording into
   * one whose first exchange is a 500.
   */
  replayFrom?: { source: string; fault: Parameters<typeof deriveFaultCassette>[2] };
  knobs?: Parameters<typeof sdkEnv>[2];
  focus?: string[];
}

/**
 * Run one phase: a fresh sandbox, a throwaway cassette, callbacks and command
 * hooks for every registry event, and whatever conversation the phase needs.
 *
 * `next` is in the W4 shape (return the next user message, or null to end) so a
 * phase can be a single prompt or a multi-exchange conversation without two code
 * paths.
 */
async function phase(spec: PhaseSpec): Promise<PhaseResult> {
  const cassette = join(REFORGE_ROOT, "cassettes", `w5-probe-${spec.label}.jsonl.tmp`);
  mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });
  rmSync(MARKERS, { recursive: true, force: true });
  mkdirSync(MARKERS, { recursive: true });
  resetSandbox();
  spec.prepare?.();

  let proxy: Awaited<ReturnType<typeof startRecordProxy>>;
  let mode: ScenarioContext["mode"];
  if (spec.replayFrom) {
    deriveFaultCassette(spec.replayFrom.source, cassette, spec.replayFrom.fault);
    proxy = await startReplayProxy(cassette);
    mode = "replay";
  } else {
    rmSync(cassette, { force: true });
    proxy = await startRecordProxy(cassette);
    mode = "record";
  }

  const callbacks = new Map<string, number>();
  const ctx: ScenarioContext = {
    engine: enginePath("engine-real"),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (event) => callbacks.set(event, (callbacks.get(event) ?? 0) + 1),
    mode,
    knobs: spec.knobs,
  };

  const hooks = Object.fromEntries(
    WATCHED.map((e) => [e, [{ hooks: [async () => (ctx.collect(e), { continue: true } as const)] }]]),
  );
  // The command-hook side. PostToolUse keeps the original stdin dump (the
  // field-order question this probe also answers); every watched event gets a
  // marker hook, so a dispatch the callback path misses on timing is still seen.
  const settingsHooks: Record<string, unknown[]> = {
    PostToolUse: [{ hooks: [{ type: "command", command: `cat > ${JSON.stringify(STDIN_DUMP)}` }] }, markerHook("PostToolUse")],
    // the two watcher events carry a MATCHER, which is what actually arms the
    // file watcher (see `watchedPathHook`)
    CwdChanged: [watchedPathHook("CwdChanged")],
    FileChanged: [watchedPathHook("FileChanged")],
  };
  for (const e of WATCHED) if (!(e in settingsHooks)) settingsHooks[e] = [markerHook(e)];

  const options: Options = {
    ...baseOptions(ctx),
    permissionMode: "bypassPermissions",
    hooks,
    settings: { hooks: settingsHooks },
    ...spec.extra,
  };

  const input = pushable<SDKUserMessage>();
  const first = spec.next(0);
  if (first === null) throw new Error(`probe phase ${spec.label}: needs at least one user message`);
  input.push(userMessage(first));
  const said: string[] = [];
  let error: string | undefined;
  try {
    let results = 0;
    for await (const m of query({ prompt: input, options })) {
      if ((m as { type?: string }).type !== "result") continue;
      said.push(String((m as { result?: unknown }).result ?? "").replace(/\s+/g, " ").slice(0, 160));
      results++;
      const following = spec.next(results);
      if (following === null) input.end();
      else input.push(userMessage(following));
    }
  } catch (e) {
    error = (e as Error).message.slice(0, 200);
  }
  await proxy.close();
  rmSync(cassette, { force: true });
  // Read the FILES after the iterator ends: a dispatcher that runs during
  // teardown (SessionEnd) can fire after the last message is yielded, so an
  // in-process counter read at this point would under-report it.
  return { callbacks, commands: drainMarkers(), results: said, error };
}

function report(spec: PhaseSpec, r: PhaseResult): void {
  console.log(`\n=== phase ${spec.label} — ${spec.condition} ===`);
  if (r.error) console.log(`  query threw: ${r.error}`);
  const fired = WATCHED.filter((e) => (r.callbacks.get(e) ?? 0) > 0 || (r.commands.get(e) ?? []).length > 0);
  const rows = spec.focus ? [...new Set([...spec.focus, ...fired])] : fired;
  for (const e of rows) {
    const cb = r.callbacks.get(e) ?? 0;
    const cmd = r.commands.get(e) ?? [];
    const verdict = cb > 0 || cmd.length > 0 ? "FIRED" : "-    ";
    console.log(`  ${verdict}  ${e.padEnd(20)} callback=${cb}  command=${cmd.length}`);
    if (cmd.length > 0) console.log(`         record: ${cmd[0].slice(0, 220)}`);
  }
  if (rows.length === 0) console.log("  (nothing fired)");
  for (const [i, t] of r.results.entries()) console.log(`  said[${i}]: ${t}`);
  if (spec.label === "permission-delay") console.log(`  canUseTool consulted ${consults}×  (0 means the condition was never created)`);
}

/** `/compact` refuses a conversation with too little history — W4's lesson, reused. */
const FILLER = [
  "Remember the codeword REFORGE_PROBE_PRECOMPACT. Reply with exactly OK.",
  "Name three primary colors, one per line, nothing else.",
  "Name three prime numbers under 20, one per line, nothing else.",
  "Name three continents, one per line, nothing else.",
  "Name three planets, one per line, nothing else.",
  "Name three metals, one per line, nothing else.",
];

/**
 * The notify timer is 6000 ms (`S3e`, chunk-g1qrzvef), armed immediately before
 * every can_use_tool `sendRequest`. Answering just past it is the whole
 * condition; answering much later only makes the phase slower.
 */
const NOTIFY_TIMER_MS = 6000;
const ANSWER_DELAY_MS = NOTIFY_TIMER_MS + 1500;
/** How many times canUseTool was actually consulted — the permission phase's own substance check. */
let consults = 0;

async function main(): Promise<void> {
  const specs: PhaseSpec[] = [
    {
      // the original batched-echo turn, unchanged — the "middle" of the matrix
      label: "batch",
      condition: "one batched two-tool turn, nothing fails",
      extra: { allowedTools: ["Bash"], maxTurns: 4 },
      next: (r) =>
        r === 0
          ? "You must emit TWO Bash tool_use blocks in a SINGLE assistant response — do not wait for any result before issuing the next. The two commands, in this order: `echo REFORGE_PROBE_1`, `echo REFORGE_PROBE_2`. After both results come back, reply with their outputs joined by a comma."
          : null,
    },
    {
      // `dQ` calls `zNt`/PostToolUseFailure on the error arm of tool execution,
      // so the condition is an is_error tool_result.
      label: "tool-failure",
      condition: "a Bash call that exits non-zero",
      extra: { allowedTools: ["Bash"], maxTurns: 4 },
      next: (r) =>
        r === 0
          ? "Use the Bash tool to run exactly `reforge-no-such-command-probe --fail` ONCE. It will fail; that is expected and correct. Do not retry it, do not try a different command. After the failure, reply with exactly REFORGE_PROBE_FAILED."
          : null,
      focus: ["PostToolUseFailure"],
    },
    {
      // W4's slash-compact recipe, the cheaper of its two (the auto threshold
      // needs a ~40,000-token payload). `wFt` awaits `tz` and then `kPe`, so ONE
      // compaction is the condition for both compaction events.
      label: "compact",
      condition: "/compact drives a real compaction (tz, then kPe)",
      extra: { allowedTools: [] },
      next: (r) => (r < FILLER.length ? FILLER[r] : r === FILLER.length ? "/compact" : null),
      focus: ["PreCompact", "PostCompact"],
    },
    {
      label: "session-end",
      condition: "/clear ends the session inside the run",
      extra: { allowedTools: [] },
      next: (r) => (r === 0 ? "Reply with exactly REFORGE_PROBE_SESSION." : r === 1 ? "/clear" : null),
      focus: ["SessionEnd"],
    },
    {
      // THE PERMISSION PHASE. Every earlier phase ran `bypassPermissions`, which
      // skips the permission system outright — so the notify timer could never
      // arm and PermissionRequest could never dispatch. THREE gotchas, all
      // measured here:
      //   1. `permissionMode` must not bypass;
      //   2. `allowedTools` must NOT name the tool — a bare allow SHADOWS
      //      canUseTool (the SDK warns), so the callback is never consulted;
      //   3. the COMMAND must not be auto-approvable. Default mode approves
      //      read-only shell commands without consulting canUseTool at all, so
      //      a phase built on `echo` measures nothing: `mkdir` is the cheapest
      //      command that is not read-only.
      label: "permission-delay",
      condition: `canUseTool answers a non-read-only command after ${ANSWER_DELAY_MS} ms, past the ${NOTIFY_TIMER_MS} ms notify timer; a second call is denied`,
      extra: {
        maxTurns: 6,
        permissionMode: "default",
        canUseTool: async (_tool: string, input: Record<string, unknown>) => {
          consults++;
          await new Promise((r) => setTimeout(r, ANSWER_DELAY_MS));
          // deny the second consult, to create an ordinary denial alongside the
          // slow allow — PermissionDenied's own guard is narrower than this, and
          // the point of creating one is to be able to say so with evidence.
          if (String(input.command ?? "").includes("DENY")) return { behavior: "deny" as const, message: "reforge probe denial" };
          return { behavior: "allow" as const, updatedInput: input };
        },
      },
      next: (r) =>
        r === 0
          ? "Use the Bash tool to run exactly `mkdir -p reforge-probe-notify` and then, in a SECOND Bash tool call, exactly `mkdir -p reforge-probe-DENY`. Do not combine them. Report what happened."
          : null,
      focus: ["Notification", "PermissionRequest", "PermissionDenied"],
    },
    {
      // Both subagent events off one Agent dispatch. Cheap enough to belong
      // here rather than being deferred to the corpus: SubagentStop was
      // observed firing on the COMPACTION path, which is not the condition
      // anyone would name for it, so the named condition has to be created.
      label: "subagent",
      condition: "one Agent dispatch starts and finishes",
      extra: { allowedTools: ["Task", "Agent", "Bash"], maxTurns: 8 },
      next: (r) =>
        r === 0
          ? "Use the Task tool exactly once to dispatch a general-purpose subagent whose entire job is to reply with the word REFORGE_PROBE_SUBAGENT. When it returns, reply with exactly REFORGE_PROBE_DELEGATED."
          : null,
      focus: ["SubagentStart", "SubagentStop"],
    },
    {
      // `xUt` is dispatched inside TaskCreate's own `call()`; `eGe` inside the
      // TaskUpdate arm that moves a status to `completed`. One conversation
      // creates both conditions.
      label: "tasks",
      condition: "one TaskCreate, then a TaskUpdate to status=completed",
      extra: { allowedTools: ["TaskCreate", "TaskUpdate", "TaskList"], maxTurns: 8 },
      next: (r) =>
        r === 0
          ? "Use the TaskCreate tool exactly once to create a task with subject 'REFORGE_PROBE_TASK' and description 'probe'. Then use the TaskUpdate tool exactly once to set that same task's status to completed. Then reply with exactly REFORGE_PROBE_TASKED."
          : null,
      focus: ["TaskCreated", "TaskCompleted"],
    },
    {
      // The api_error arm of the query loop (`HPe` at 2722595) needs the API to
      // return an error the engine turns into an isApiErrorMessage. That is a
      // RESPONSE, so it is authored rather than provoked: the H2 fault
      // derivation rewrites a healthy recording's first exchange into a 500.
      label: "api-error",
      condition: "a 500 from the API, replayed — the isApiErrorMessage arm",
      extra: { allowedTools: [], maxTurns: 2 },
      replayFrom: { source: join(REFORGE_ROOT, "cassettes", "m1-plain.jsonl"), fault: "server-error" },
      knobs: { maxRetries: "1" },
      next: (r) => (r === 0 ? "Reply with exactly OK." : null),
      focus: ["StopFailure"],
    },
    {
      // `Qqe` fires per memory file loaded, for types User/Project/Local/Managed.
      // A CLAUDE.md in the cwd is the Project one.
      label: "memory",
      condition: "a CLAUDE.md in the working directory loads as Project memory",
      // `settingSources: []` (the corpus default) also turns memory loading OFF,
      // so the condition cannot be created without opening a filesystem source.
      // That is the W3 recording trap in miniature — the probe accepts it
      // because a probe grades nothing but its own verdict; a RECORDING built on
      // this phase would have to pin the ancestor chain instead.
      extra: { allowedTools: [], maxTurns: 2, settingSources: ["project"] },
      prepare: () => writeFileSync(join(SANDBOX, "CLAUDE.md"), "# Probe memory\n\nThe codeword is REFORGE_PROBE_MEMORY.\n"),
      next: (r) => (r === 0 ? "Reply with exactly OK." : null),
      focus: ["InstructionsLoaded"],
    },
    {
      // `Ldt` fires when a slash command, skill or MCP prompt is EXPANDED. A
      // project command file is the cheapest of the three.
      label: "slash-expansion",
      condition: "a project slash command is expanded",
      extra: { allowedTools: [], maxTurns: 3, settingSources: ["project"] },
      prepare: () => {
        mkdirSync(join(SANDBOX, ".claude", "commands"), { recursive: true });
        writeFileSync(join(SANDBOX, ".claude", "commands", "reforgeprobe.md"), "Reply with exactly REFORGE_PROBE_SLASH.\n");
      },
      next: (r) => (r === 0 ? "/reforgeprobe" : null),
      focus: ["UserPromptExpansion"],
    },
    {
      // The watcher is armed from the FileChanged hook's MATCHER, and only if
      // one of the two watcher events has a hook at all. Both are registered
      // here with the sandbox as their matcher, and then a file inside it is
      // written and rewritten.
      label: "file-watch",
      condition: "a FileChanged hook whose matcher is the sandbox, then files under it change",
      extra: { allowedTools: ["Write", "Edit", "Bash"], maxTurns: 8 },
      next: (r) =>
        r === 0
          ? "Use the Write tool to create a file `watched.txt` containing exactly `one`. Then use the Write tool again to overwrite it with exactly `two`. Then reply with exactly REFORGE_PROBE_WATCHED."
          : null,
      focus: ["FileChanged", "CwdChanged"],
    },
    {
      // The other watcher event, and the one W5 left OPEN. `file-watch` arms the
      // watcher and enables Bash but never MOVES the tracked cwd, so CwdChanged's
      // condition went uncreated — an absence of evidence, not a negative. This
      // phase creates it: the Bash tool's post-command tracking reads the shell's
      // final PWD and calls `onCwdChanged` when a `cd` persists past the command,
      // so one `cd` into a subdirectory of the armed matcher is the whole
      // condition. The matcher is the sandbox and the subdirectory is inside it,
      // so the watcher covers the destination as well as the origin.
      //
      // Two exchanges, and the second is EVIDENCE rather than mechanism. The
      // tracker appends its `pwd` write to every command it runs and reads it
      // back afterwards, so the `cd` alone already reports the move; the second
      // command's `pwd` is what makes that visible in the transcript when a
      // verdict needs explaining.
      label: "cwd-change",
      condition: "a Bash `cd` that persists past its command, under an armed CwdChanged matcher",
      extra: { allowedTools: ["Bash"], maxTurns: 8 },
      prepare: () => mkdirSync(join(SANDBOX, "moved"), { recursive: true }),
      next: (r) =>
        r === 0
          ? "Use the Bash tool to run exactly `cd moved` and nothing else."
          : r === 1
            ? "Use the Bash tool to run exactly `pwd`, then reply with exactly REFORGE_PROBE_CWD."
            : null,
      focus: ["CwdChanged", "FileChanged"],
    },
    {
      // `gdt` fires from the app-state reducer when `mainLoopModel` actually
      // moves; `mdt` from the pre-switch chain that runs before it.
      label: "model-switch",
      condition: "/model changes the main-loop model mid-session",
      extra: { allowedTools: [], maxTurns: 4 },
      next: (r) =>
        r === 0 ? "Reply with exactly OK." : r === 1 ? "/model haiku" : r === 2 ? "Reply with exactly REFORGE_PROBE_MODEL." : null,
      focus: ["PreModelSwitch", "PostModelSwitch"],
    },
  ];

  // `--only a,b` runs a subset. For iterating on ONE condition while designing
  // its phase; the verdict table is suppressed, because a table missing phases
  // would read as a measurement rather than as a partial run.
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg >= 0 ? new Set(process.argv[onlyArg + 1].split(",")) : null;

  const results = new Map<string, PhaseResult>();
  for (const spec of specs) {
    if (only && !only.has(spec.label)) continue;
    const r = await phase(spec);
    results.set(spec.label, r);
    report(spec, r);
    // The stdin dump lives in the sandbox, which the NEXT phase wipes, so the
    // command-hook answer is read while it still exists.
    if (spec.label === "batch") {
      console.log("\n=== command hook via Options.settings (flag-settings layer) ===");
      try {
        const raw = readFileSync(STDIN_DUMP, "utf8");
        console.log(`  RAN — ${raw.length} bytes on stdin`);
        console.log(`  key order: ${Object.keys(JSON.parse(raw) as Record<string, unknown>).join(", ")}`);
      } catch {
        console.log("  did NOT run (no stdin dump written)");
      }
    }
  }
  if (only) {
    console.log("\n(--only: partial run, no verdict table — a table missing phases is not a measurement)");
    rmSync(MARKERS, { recursive: true, force: true });
    return;
  }

  // ---- the verdict table: every registry event, one row ---------------------
  console.log(`\n=== per-event verdict — all ${WATCHED.length} registry events (${REGISTRY.registry.binding}@${REGISTRY.registry.chunk}) ===`);
  const tally = { FIRED: 0, DEAD: 0, OPEN: 0 };
  for (const e of [...WATCHED].sort()) {
    const spec = CONDITIONS[e];
    if (!spec) throw new Error(`registry event ${e} has no named firing condition — add one before reporting a verdict`);
    const where = [...results]
      .filter(([, p]) => (p.callbacks.get(e) ?? 0) > 0 || (p.commands.get(e) ?? []).length > 0)
      .map(([label, p]) => `${label}(cb=${p.callbacks.get(e) ?? 0},cmd=${(p.commands.get(e) ?? []).length})`);
    // Order matters: a row whose condition was created ELSEWHERE in the campaign
    // and fired there is FIRED, not OPEN — `phase: null` only ever meant "no
    // phase in THIS file creates it", which is a fact about this probe's cells
    // and not about the event.
    const verdict = where.length > 0 || spec.firedIn ? "FIRED" : spec.phase !== null ? "DEAD " : "OPEN ";
    tally[verdict.trim() as keyof typeof tally]++;
    const provenance =
      where.join(" ") ||
      (spec.firedIn ? `elsewhere: ${spec.firedIn}` : spec.phase !== null ? `condition created in phase '${spec.phase}'` : "condition NOT created");
    console.log(`  ${verdict}  ${e.padEnd(20)} ${provenance}`);
    console.log(`         condition: ${spec.condition}`);
  }
  console.log(`\n  FIRED ${tally.FIRED}   DEAD ${tally.DEAD}   OPEN ${tally.OPEN}   (of ${WATCHED.length})`);
  console.log(
    "\n  FIRED means observed — in a phase here, or in the run named after 'elsewhere:'.\n" +
      "  DEAD means the condition WAS created here and the dispatcher did not run.\n" +
      "  OPEN means the condition is named but not created — no claim either way.\n" +
      "  Neither is 'the event does not exist': the registry says it does.",
  );
  rmSync(MARKERS, { recursive: true, force: true });
}

await main();
