// W5 corpus family — the hooks matrix (campaign spec C8 / §3.2's "which hook
// events fire headlessly, with what payloads").
//
// THE COVERAGE PROBLEM THIS EXISTS TO FIX. One scenario in the 24-strong corpus
// this wave inherited registers a hook at all (`hooks`: a PreToolUse and a
// PostToolUse callback around one `echo`), so two of the engine's live events
// were graded and the rest were not — and each event has its OWN dispatcher,
// building its OWN hook-input record with its own field set. The dispatchers are
// what W5 owns, so without these recordings most of the wave would have been
// unspliceable: a splice whose solo sabotage cannot turn a scenario red is dead
// code the gate would have to refuse.
//
// WHICH EVENTS ARE LIVE, RE-MEASURED RATHER THAN INHERITED — TWICE.
// `w5/probe-hook-events.ts` re-measured the 2026-06 "8 of 30" number against the
// PINNED engine. Its first take drove ONE batched tool turn with CALLBACKS only
// and reported eight live events; C8's boundary review found the negatives that
// take produced were vacuous, and the re-measured probe (a phase per firing
// condition, callbacks AND settings command hooks on every event) fires TWELVE:
//
//   PreToolUse, PostToolUse, PostToolBatch, UserPromptSubmit, Stop,
//   MessageDisplay  — the original six, on an ordinary tool turn
//   SubagentStart, SubagentStop  — on an Agent dispatch (`hooks-subagent`)
//   PostToolUseFailure  — on a tool call that fails (`hooks-tool-failure`)
//   PreCompact          — on a compaction (`hooks-precompact`)
//   SessionStart        — on every run, COMMAND path only (`hooks-session-start`)
//   SessionEnd          — on teardown, and by callback on `/clear`
//                         (`hooks-session-end`)
//
// Only Notification did not fire in any phase; its one call site in the pinned
// bundle is MCP-elicitation completion. The callback/command split is not a
// detail: `vUt` (SessionStart) and `tz` (PreCompact) call their executor with no
// session hooks registry, so a callback-only probe cannot see them at all — which
// is exactly how four live events were mistaken for dead ones.
//
// EIGHT RECORDINGS. The scout budgeted one per uncovered event; the probe showed
// a single no-tool turn fires UserPromptSubmit, MessageDisplay and Stop together,
// so `hooks-prompt-submit` carries all three. The batch, subagent, failure,
// compaction, session-start and session-end events each need their own turn
// SHAPE and get their own scenario, and the command-hook cell is the matrix's one
// non-trivial cell (see below).
//
// THE COMMAND-HOOK CELL. `Options.hooks` takes CALLBACKS, and a callback is
// handed a JavaScript object — so nothing in the corpus grades the hook-input
// record as the BYTE STREAM a hook actually reads, which is what the owned
// dispatchers' field ORDER is (`post-tool-hooks/reference.js`: "FIELD ORDER IS
// BEHAVIOUR, not style"). Command hooks live in settings, and turning on a
// filesystem setting source would drag the operator's ancestor `.claude/`
// directories into the recording (the trap W3 hit). The probe settled the way
// out: `Options.settings` takes an INLINE settings object into the flag-settings
// layer with `settingSources: []` still in force, and the command ran with the
// engine's serialised record on stdin. `hooks-command` writes a normalised
// projection of that stdin into the sandbox, where the state surface grades it.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseOptions, converse, drive, resultText, resultsOf, usedTool, type Scenario, type ScenarioContext } from "../src/harness.js";
import { SANDBOX, sdkEnv } from "../src/runTurn.js";
import { seedGitRepo } from "../w3/scenarios.js";

/**
 * Working directories OUTSIDE the sandbox, for the two scenarios that must open
 * a filesystem setting source.
 *
 * `settingSources: ["project"]` is the only way to make the engine load a
 * project CLAUDE.md or a project slash command — and it walks ANCESTORS, so
 * running it in the sandbox would drag this repository's own CLAUDE.md chain
 * into the recording (the W3 trap, measured again by the hook probe: three
 * ancestor memories loaded before the seeded one). A `/tmp` directory has no
 * ancestors to find. Realpath'd because macOS resolves `/tmp` to `/private/tmp`
 * and the engine reports the resolved path.
 */
const MEMORY_DIR = join(realpathSync("/tmp"), "reforge-w5-memory");
const SLASH_DIR = join(realpathSync("/tmp"), "reforge-w5-slash");
/** The file the watcher scenario changes; the FileChanged matcher is the sandbox that holds it. */
const WATCHED_FILE = "watched.txt";

/** Where the command hook writes its projection — inside the sandbox, so the state surface sees it. */
const HOOK_STDIN_FILE = join(SANDBOX, "hook-stdin.txt");
/** The same, for the SessionStart record — the one event no callback can observe. */
const SESSION_START_FILE = join(SANDBOX, "session-start-stdin.txt");

/**
 * A callback matcher that records the event and the fields of its input that
 * are the ENGINE's rather than the run's.
 *
 * Deliberately narrow. Harness events are a diffed surface, so a payload
 * carrying `session_id`, `transcript_path` or a message uuid would differ
 * between two replays of the same cassette for reasons that have nothing to do
 * with hook dispatch. What each dispatcher is graded on here is the shape it
 * builds — which event name it stamps, and the event-specific fields it adds on
 * top of the common prefix.
 */
const watch = (ctx: ScenarioContext, event: string, project: (input: Record<string, unknown>) => unknown) => [
  {
    hooks: [
      async (input: unknown) => {
        ctx.collect(event, project(input as Record<string, unknown>));
        return { continue: true } as const;
      },
    ],
  },
];

/**
 * How long `hooks-permission` makes the permission answer take.
 *
 * Upstream arms a 6000 ms notify timer (`S3e`, chunk-g1qrzvef) immediately
 * before every `can_use_tool` sendRequest, and Notification is what that timer
 * fires. Just past it: the condition is the overrun, and waiting longer only
 * makes the scenario slower on every replay.
 */
const NOTIFY_ANSWER_DELAY_MS = 7500;

/**
 * The record projection both task dispatchers are graded on — ONE function,
 * because the two records are the same shape and writing two would state the
 * twinning as a coincidence rather than as the contract.
 *
 * `task_id` is a run-scoped uuid, so its VALUE cannot go on a diffed surface;
 * what can is whether the completion dispatcher named the task the creation
 * dispatcher made. Held in a module-scoped box that each run overwrites on its
 * TaskCreated fire, the way the subagent scenario links its two agent ids.
 */
let createdTaskId: unknown;
const taskRecord = (i: Record<string, unknown>) => {
  if (i.hook_event_name === "TaskCreated") createdTaskId = i.task_id;
  return {
    event: i.hook_event_name,
    subject: i.task_subject,
    description: i.task_description,
    hasTaskId: typeof i.task_id === "string" && (i.task_id as string).length > 0,
    sameTaskAsCreated: i.task_id === createdTaskId,
    // Upstream stamps the teammate and team names into both records; on a
    // headless run there is no teammate, so JSON drops both — and their absence
    // is what distinguishes this seam from a teammate session.
    hasTeammateName: "teammate_name" in i,
    hasTeamName: "team_name" in i,
  };
};

/** The context a UserPromptSubmit hook injects — graded on the REQUEST surface, not just the event log. */
const INJECTED_CONTEXT = "REFORGE_INJECTED_CONTEXT: the codeword is REFORGE_PROMPT_HOOK_OK.";

/**
 * The projection the command hook writes, as a `node -e` program.
 *
 * WHY A PROJECTION AND NOT THE RAW STDIN. The state surface hashes file
 * contents with no normalisation (`src/state.ts`, deliberately), and the raw
 * record carries `session_id` and `transcript_path` — run-scoped, so a raw dump
 * would differ between the two engines on every replay and the scenario would
 * grade nothing but its own noise. The projection keeps exactly the parts that
 * are the dispatcher's contract:
 *
 *   - the KEY ORDER, verbatim, which is the serialisation contract itself;
 *   - the event name, tool name, tool input and tool response, which are the
 *     fields this dispatcher adds on top of the common prefix;
 *   - the TYPE of the two run-scoped fields, so their presence is still graded
 *     even though their values cannot be;
 *   - whether the record's `cwd` is the directory the hook process runs in.
 */
const STDIN_PROJECTION = [
  'let s="";',
  'process.stdin.on("data",(d)=>{s+=d});',
  'process.stdin.on("end",()=>{',
  "const i=JSON.parse(s);",
  "const out=[",
  '"keys="+Object.keys(i).join(","),',
  '"hook_event_name="+i.hook_event_name,',
  '"tool_name="+i.tool_name,',
  '"tool_input="+JSON.stringify(i.tool_input),',
  '"tool_response="+JSON.stringify(i.tool_response),',
  '"permission_mode="+i.permission_mode,',
  '"session_id:"+typeof i.session_id,',
  '"transcript_path:"+typeof i.transcript_path,',
  '"cwd_is_hook_cwd="+(i.cwd===process.cwd()),',
  '].join("\\n");',
  `require("fs").writeFileSync(${JSON.stringify(HOOK_STDIN_FILE)},out+"\\n");`,
  "});",
].join("");

/**
 * The same projection for the SessionStart record, which no callback can see.
 *
 * `vUt` hands its executor no session hooks registry, so `Options.hooks` cannot
 * reach it however the run is shaped — the settings layer is the only path, and
 * a file the state surface hashes is the only grading surface.
 *
 * WHAT THE BYTES SHOW, AND WHY IT IS FEWER FIELDS THAN THE DISPATCHER BUILDS.
 * The record is JSON-serialised onto the hook's stdin, and JSON drops keys whose
 * value is `undefined`. On the headless seam the agent type, the model and the
 * session title are all undefined (no subagent, no explicit model on the
 * dispatch, and the title lookup answers only for the interactive session), as
 * are the two common-prefix fields `prompt_id` and `effort` — a session start
 * has no prompt yet. So five of the dispatcher's ten keys reach the hook, and
 * their ABSENCE is graded here as sharply as the presence of the rest: a
 * dispatcher that stamped a value into any of them would write a different file.
 * The full ten-key construction is graded by `strangle/hooks-parity.test.ts`,
 * where the ports can be given values this seam never supplies.
 */
const SESSION_START_PROJECTION = [
  'let s="";',
  'process.stdin.on("data",(d)=>{s+=d});',
  'process.stdin.on("end",()=>{',
  "const i=JSON.parse(s);",
  "const out=[",
  '"keys="+Object.keys(i).join(","),',
  '"hook_event_name="+i.hook_event_name,',
  '"source="+i.source,',
  '"agent_type_present="+("agent_type" in i),',
  '"model_present="+("model" in i),',
  '"session_title_present="+("session_title" in i),',
  '"session_id:"+typeof i.session_id,',
  '"transcript_path:"+typeof i.transcript_path,',
  '"cwd_is_hook_cwd="+(i.cwd===process.cwd()),',
  '].join("\\n");',
  `require("fs").writeFileSync(${JSON.stringify(SESSION_START_FILE)},out+"\\n");`,
  "});",
].join("");

/**
 * `/compact` refuses a conversation with too little history, and the compactor
 * refuses one with nothing to summarize — W4's two lessons, in six exchanges.
 */
const COMPACT_FILLER = [
  "Remember the codeword REFORGE_PRECOMPACT_ECHO. Reply with exactly OK.",
  "Name three primary colors, one per line, nothing else.",
  "Name three prime numbers under 20, one per line, nothing else.",
  "Name three continents, one per line, nothing else.",
  "Name three planets, one per line, nothing else.",
  "Name three metals, one per line, nothing else.",
];

export const W5_SCENARIOS: Scenario[] = [
  {
    // Three events, one no-tool turn. UserPromptSubmit is the only one of the
    // three whose payload the engine puts back into the CONVERSATION — the
    // dispatcher's record is what the executor hands the callback, and the
    // callback's `additionalContext` comes back as a block in the next request —
    // so this scenario grades that dispatcher on the request surface as well as
    // in the event log. Stop and MessageDisplay are graded on their records.
    tag: "hooks-prompt-submit",
    title: "UserPromptSubmit (with injected context), MessageDisplay and Stop fire on a no-tool turn",
    run: (ctx) =>
      drive("Reply with exactly the codeword you were given in your context and nothing else.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 2,
        permissionMode: "bypassPermissions",
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                async (input: unknown) => {
                  const i = input as { hook_event_name?: string; prompt?: string };
                  ctx.collect("UserPromptSubmit", { event: i.hook_event_name, promptLength: i.prompt?.length });
                  return {
                    continue: true,
                    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: INJECTED_CONTEXT },
                  } as const;
                },
              ],
            },
          ],
          MessageDisplay: watch(ctx, "MessageDisplay", (i) => ({
            event: i.hook_event_name,
            index: i.index,
            final: i.final,
            hasDelta: typeof i.delta === "string",
          })),
          Stop: watch(ctx, "Stop", (i) => ({
            event: i.hook_event_name,
            stopHookActive: i.stop_hook_active,
            // `background_tasks` and `session_crons` are the two fields the Stop
            // dispatcher adds that no other event carries; empty here, and their
            // PRESENCE is the claim.
            backgroundTasks: Array.isArray(i.background_tasks) ? i.background_tasks.length : "absent",
            sessionCrons: Array.isArray(i.session_crons) ? i.session_crons.length : "absent",
            hasLastAssistantMessage: typeof i.last_assistant_message === "string",
          })),
        },
      }),
    check: (msgs, events) => {
      const fired = (name: string) => events.filter((e) => (e as { event?: string }).event === name).length;
      for (const e of ["UserPromptSubmit", "MessageDisplay", "Stop"]) {
        if (fired(e) === 0) return `${e} hook never fired`;
      }
      // The injected context has to have REACHED the model, or the dispatcher
      // was graded on nothing but the fact that it ran.
      return resultText(msgs).includes("REFORGE_PROMPT_HOOK_OK") ? null : "the injected context never reached the model";
    },
  },

  {
    // PostToolBatch is the one event that needs a turn SHAPE rather than a
    // registration: it fires once per batch of tool calls the engine issued
    // together, so it needs at least two tool_use blocks in one assistant
    // message. `parallel-tools` already produces that shape and registers no
    // hooks; this is that shape with the batch hook attached.
    tag: "hooks-batch",
    title: "PostToolBatch fires once for a batch of parallel tool calls",
    run: (ctx) =>
      drive(
        "You must emit TWO Bash tool_use blocks in a SINGLE assistant response — do not wait for any result before issuing the next. The two commands, in this order: `echo REFORGE_BATCH_1`, `echo REFORGE_BATCH_2`. Issuing them one per turn is wrong. After both results come back, reply with their outputs joined by a comma.",
        {
          ...baseOptions(ctx),
          allowedTools: ["Bash"],
          maxTurns: 4,
          permissionMode: "bypassPermissions",
          hooks: {
            PostToolBatch: watch(ctx, "PostToolBatch", (i) => ({
              event: i.hook_event_name,
              // `tool_calls` is this dispatcher's whole reason for existing: the
              // batch record carries the CALLS, where every per-tool event
              // carries one tool_name/tool_input pair.
              toolCalls: Array.isArray(i.tool_calls)
                ? (i.tool_calls as { tool_name?: string }[]).map((c) => c.tool_name)
                : "absent",
            })),
          },
        },
      ),
    check: (msgs, events) => {
      const batch = events.filter((e) => (e as { event?: string }).event === "PostToolBatch");
      if (batch.length === 0) return "PostToolBatch hook never fired — the calls were probably not batched";
      const calls = (batch[0] as { payload?: { toolCalls?: unknown } }).payload?.toolCalls;
      if (!Array.isArray(calls) || calls.length < 2) return `the batch record carried ${JSON.stringify(calls)}, not a batch`;
      const t = resultText(msgs);
      const missing = ["REFORGE_BATCH_1", "REFORGE_BATCH_2"].filter((k) => !t.includes(k));
      return missing.length === 0 ? null : `outputs missing from the reply: ${missing.join(",")}`;
    },
  },

  {
    // The two subagent events, and the OTHER arm of the Stop dispatcher. One
    // function serves Stop and SubagentStop through an internal conditional, and
    // the two arms build different records — SubagentStop adds `agent_id`,
    // `agent_transcript_path` and `agent_type` — so a wave that owns it needs a
    // recording on each arm. This is the only scenario in the corpus that
    // reaches the subagent one.
    tag: "hooks-subagent",
    title: "SubagentStart, SubagentStop and the parent Stop fire around an Agent dispatch",
    run: (ctx) => {
      // The agent id CORRELATION, held per run. A projection can only report the
      // TYPE of `agent_id` — the value is run-scoped, so collecting it would diff
      // between the two engines for reasons that have nothing to do with hook
      // dispatch. What is not run-scoped is whether the two dispatchers named the
      // SAME agent: one function starts the subagent and another stops it, and an
      // id that did not survive the round trip is a real plumbing defect that
      // `typeof === "string"` on each end cannot see. Comparing them inside one
      // run and collecting the BOOLEAN keeps the surface diffable and grades the
      // link. Declared here rather than at module scope so each engine's run gets
      // its own.
      let startAgentId: unknown;
      return drive(
        "Use the Agent tool to dispatch exactly one subagent with subagent_type 'general-purpose', running in the foreground (not in the background). Its entire task is: reply with the single word REFORGE_SUBAGENT_HOOKED. When it returns, reply with exactly what it said.",
        {
          ...baseOptions(ctx),
          allowedTools: ["Agent"],
          maxTurns: 4,
          permissionMode: "bypassPermissions",
          hooks: {
            SubagentStart: watch(ctx, "SubagentStart", (i) => {
              startAgentId = i.agent_id;
              return {
                event: i.hook_event_name,
                agentType: i.agent_type,
                hasAgentId: typeof i.agent_id === "string",
              };
            }),
            SubagentStop: watch(ctx, "SubagentStop", (i) => ({
              event: i.hook_event_name,
              agentType: i.agent_type,
              hasAgentId: typeof i.agent_id === "string",
              // The link between the two arms: same run, same agent.
              agentIdMatchesStart: typeof i.agent_id === "string" && i.agent_id === startAgentId,
              // The field that only exists on this arm of the dispatcher.
              hasAgentTranscriptPath: typeof i.agent_transcript_path === "string",
              stopHookActive: i.stop_hook_active,
            })),
            Stop: watch(ctx, "Stop", (i) => ({
              event: i.hook_event_name,
              stopHookActive: i.stop_hook_active,
              // Absent on the Stop arm, present on the SubagentStop arm: the
              // conditional's whole observable difference, in one field.
              hasAgentTranscriptPath: typeof i.agent_transcript_path === "string",
            })),
          },
        },
      );
    },
    check: (msgs, events) => {
      const fired = (name: string) => events.filter((e) => (e as { event?: string }).event === name).length;
      if (!usedTool(msgs, "Agent")) return "Agent tool never used";
      for (const e of ["SubagentStart", "SubagentStop", "Stop"]) {
        if (fired(e) === 0) return `${e} hook never fired`;
      }
      const stop = events.find((e) => (e as { event?: string }).event === "SubagentStop") as
        | { payload?: { agentIdMatchesStart?: boolean } }
        | undefined;
      if (stop?.payload?.agentIdMatchesStart !== true) {
        return "SubagentStop carried a different agent_id than SubagentStart — the id did not survive the round trip";
      }
      return resultText(msgs).includes("REFORGE_SUBAGENT_HOOKED") ? null : "subagent result not folded into the final reply";
    },
  },

  {
    // The matrix's non-trivial cell: a COMMAND hook, so the hook-input record is
    // graded as the byte stream it is serialised into rather than as an object
    // handed to a callback. Registered through `Options.settings` — an inline
    // settings object in the flag-settings layer — so no filesystem setting
    // source is enabled and nothing outside the sandbox is read.
    //
    // The grading surface is the SANDBOX, not the event log: the hook writes its
    // projection to a file, and `src/state.ts` compares the tree with content
    // hashes between the two engines. A dispatcher that renamed a field,
    // reordered the record, or dropped `tool_response` produces a different file
    // and a different hash.
    tag: "hooks-command",
    title: "a command hook receives the PostToolUse record on stdin, in field order",
    run: async (ctx) => {
      const msgs = await drive(
        "Use the Bash tool to run exactly `echo REFORGE_COMMAND_HOOK` and then report its output verbatim.",
        {
          ...baseOptions(ctx),
          allowedTools: ["Bash"],
          maxTurns: 3,
          permissionMode: "bypassPermissions",
          settings: {
            hooks: {
              PostToolUse: [{ hooks: [{ type: "command", command: `node -e '${STDIN_PROJECTION}'` }] }],
            },
          },
        },
      );
      // Read back INSIDE the run, while this engine's sandbox is still the
      // current one — the runner wipes it before the next side runs, so a check
      // that read the file afterwards would be reading whichever engine went
      // last. Collecting it puts the byte stream on the events surface as well
      // as leaving it on the state surface: two independent gradings of the same
      // serialisation, and something for the substance check to assert on.
      ctx.collect("PostToolUse:stdin", existsSync(HOOK_STDIN_FILE) ? readFileSync(HOOK_STDIN_FILE, "utf8") : null);
      return msgs;
    },
    check: (msgs, events) => {
      if (!resultText(msgs).includes("REFORGE_COMMAND_HOOK")) return "result lacks tool output";
      const dump = events.find((e) => (e as { event?: string }).event === "PostToolUse:stdin") as
        | { payload?: string | null }
        | undefined;
      const text = dump?.payload;
      if (typeof text !== "string") return "the command hook never ran — no record was written to the sandbox";
      // The field ORDER, asserted as the engine's contract rather than as
      // whatever this take happened to produce. Written out here and derived
      // from upstream's body in `strangle/hooks-parity.test.ts`: two independent
      // statements of the same claim, neither reading the owned module.
      const expected =
        "keys=session_id,transcript_path,cwd,prompt_id,permission_mode,effort,hook_event_name,tool_name,tool_input,tool_response,tool_use_id,duration_ms";
      const keys = text.split("\n")[0];
      if (keys !== expected) return `the record's field order changed:\n      ${keys}\n      ${expected}`;
      return text.includes("tool_response=") ? null : "the record carried no tool_response";
    },
  },

  // ==========================================================================
  // The four events C8's boundary review found live. Each one's dispatcher had
  // no covering scenario because the wave believed the event was dead, so each
  // needs the turn shape that CREATES its firing condition — which is the whole
  // finding, restated as corpus.
  // ==========================================================================

  {
    // PostToolUseFailure, and the guard that separates it from PostToolUse.
    // Upstream runs the two through different dispatchers off the success and
    // error arms of one tool call, so a scenario that only ever succeeds grades
    // the failure record not at all. Both callbacks are registered here and the
    // check asserts the SPLIT — the failure fired, the success dispatcher did
    // not — because "PostToolUseFailure fired" alone would also pass on an
    // engine that fired both.
    tag: "hooks-tool-failure",
    title: "PostToolUseFailure fires on a tool call that fails, and PostToolUse does not",
    run: (ctx) =>
      drive(
        "Use the Bash tool to run exactly `reforge-no-such-command-probe --fail` ONCE. It will fail; that is expected and correct. Do not retry it, do not try a different command, do not investigate. After the failure, reply with exactly REFORGE_TOOL_FAILED.",
        {
          ...baseOptions(ctx),
          allowedTools: ["Bash"],
          maxTurns: 4,
          permissionMode: "bypassPermissions",
          hooks: {
            PostToolUseFailure: watch(ctx, "PostToolUseFailure", (i) => ({
              event: i.hook_event_name,
              toolName: i.tool_name,
              // The three fields that exist on THIS record and on no other:
              // the error text, the interrupt flag, and a duration.
              hasError: typeof i.error === "string" && (i.error as string).length > 0,
              isInterrupt: i.is_interrupt,
              hasDuration: typeof i.duration_ms === "number",
              // Present on the PostToolUse record, absent here: the failure
              // dispatcher carries the error INSTEAD of a tool_response.
              hasToolResponse: "tool_response" in i,
            })),
            PostToolUse: watch(ctx, "PostToolUse", (i) => ({ event: i.hook_event_name, toolName: i.tool_name })),
          },
        },
      ),
    check: (msgs, events) => {
      const fired = (name: string) => events.filter((e) => (e as { event?: string }).event === name).length;
      if (!usedTool(msgs, "Bash")) return "Bash tool never used";
      if (fired("PostToolUseFailure") === 0) return "PostToolUseFailure never fired — the command probably succeeded";
      if (fired("PostToolUse") > 0) return "PostToolUse fired on a failing call — the two arms are not separated";
      const rec = events.find((e) => (e as { event?: string }).event === "PostToolUseFailure") as
        | { payload?: { hasError?: boolean; hasToolResponse?: boolean } }
        | undefined;
      if (rec?.payload?.hasError !== true) return "the failure record carried no error text";
      if (rec?.payload?.hasToolResponse !== false) return "the failure record carried a tool_response";
      return null;
    },
  },

  {
    // PreCompact. Upstream awaits it on the compaction path itself, so the
    // condition is a real compaction and W4's manual recipe is the cheap one —
    // the reactive threshold needs a ~40,000-token payload for the same
    // dispatcher.
    //
    // This dispatcher is not a generator and its result is CONSUMED: the engine
    // folds a hook's stdout back in as new custom instructions, narrates every
    // result to the operator, and refuses to compact at all if a hook blocks. A
    // callback that returns `{continue:true}` produces exactly ONE result shape
    // — succeeded, unblocked, silent — so a callback-only recording would
    // exercise one path through a reduction with a dozen.
    //
    // So the scenario registers three COMMAND hooks alongside the callback, one
    // per result shape a hook process can produce: succeeded with output (which
    // becomes a custom instruction), failed with output, and failed silently.
    // The two failure phrasings differ only by whether the hook printed
    // anything, and nothing but a real failing process renders either.
    //
    // What is still out of reach and left to the oracle: a BLOCKED hook (which
    // would refuse the compaction this scenario exists to record), a CANCELLED
    // one (which needs a timeout), and the delegated-observation arm (which
    // needs an agent kind the headless Agent tool cannot produce).
    // C8's second round added PostCompact to this scenario rather than giving
    // it one of its own: upstream's manual-compaction function awaits `tz` and
    // then `kPe` on the SAME path, so one compaction is the firing condition for
    // both and a second recording would record the same HTTP traffic twice.
    tag: "hooks-precompact",
    title: "PreCompact and PostCompact fire on a real compaction, and PreCompact's results become the engine's verdict",
    run: (ctx) =>
      converse({ ...baseOptions(ctx), allowedTools: [], permissionMode: "bypassPermissions",
        hooks: {
          PreCompact: watch(ctx, "PreCompact", (i) => ({
            event: i.hook_event_name,
            // The two fields only this record carries. `trigger` is also the
            // matchQuery, which is why a matcher for this event matches on
            // "manual" or "auto" where a tool-scoped one matches a tool name.
            trigger: i.trigger,
            customInstructions: i.custom_instructions,
          })),
          // The same compaction, after the summary exists. Its record carries
          // `compact_summary` where PreCompact carries `custom_instructions`,
          // and its verdict is display-only: by the time it runs there is
          // nothing left to block, so unlike PreCompact a hook here cannot
          // change what happens — only what the operator is told.
          PostCompact: watch(ctx, "PostCompact", (i) => ({
            event: i.hook_event_name,
            trigger: i.trigger,
            hasCompactSummary: typeof i.compact_summary === "string" && (i.compact_summary as string).length > 0,
            // Present on the PreCompact record, absent here.
            hasCustomInstructions: "custom_instructions" in i,
          })),
        },
        settings: {
          hooks: {
            PreCompact: [
              // A hook's OUTPUT is its stdout when it succeeds and its STDERR
              // when it fails (upstream reads `status===0 ? stdout : stderr`),
              // which is why the loud failure below writes to stderr — a
              // failing hook that printed to stdout would render as the SILENT
              // failure arm and grade the wrong phrasing.
              { hooks: [{ type: "command", command: "echo REFORGE_PRECOMPACT_INSTRUCTION" }] },
              { hooks: [{ type: "command", command: "echo REFORGE_PRECOMPACT_LOUD_FAILURE >&2; exit 1" }] },
              { hooks: [{ type: "command", command: "exit 1" }] },
            ],
          },
        },
      }, (results) => {
        if (results < COMPACT_FILLER.length) return COMPACT_FILLER[results];
        if (results === COMPACT_FILLER.length) return "/compact";
        return null;
      }),
    check: (msgs, events) => {
      const pre = events.filter((e) => (e as { event?: string }).event === "PreCompact");
      if (pre.length === 0) return "PreCompact never fired — the conversation did not compact";
      const p = (pre[0] as { payload?: { trigger?: unknown; customInstructions?: unknown } }).payload;
      if (p?.trigger !== "manual") return `PreCompact carried trigger ${JSON.stringify(p?.trigger)}, not "manual"`;
      if (p?.customInstructions !== null) return `custom_instructions was ${JSON.stringify(p?.customInstructions)}, not null`;
      const boundary = msgs.find((m) => (m as { subtype?: string }).subtype === "compact_boundary");
      if (!boundary) return "no compact_boundary frame — PreCompact fired but nothing compacted";
      const post = events.filter((e) => (e as { event?: string }).event === "PostCompact");
      if (post.length === 0) return "PostCompact never fired — the compaction did not reach the post arm";
      const q = (post[0] as { payload?: { hasCompactSummary?: unknown; hasCustomInstructions?: unknown } }).payload;
      if (q?.hasCompactSummary !== true) return "the PostCompact record carried no compact_summary";
      if (q?.hasCustomInstructions !== false) return "the PostCompact record carried custom_instructions, which is PreCompact's field";
      const rs = resultsOf(msgs);
      return rs.length === COMPACT_FILLER.length + 1 ? null : `expected ${COMPACT_FILLER.length + 1} results, saw ${rs.length}`;
    },
  },

  {
    // SessionStart — the one live event `Options.hooks` cannot reach AT ALL.
    // Upstream's dispatcher hands its executor no session hooks registry, so the
    // function-hook lookup has nothing to look in and a callback is never
    // consulted however the run is shaped. The settings layer still resolves, so
    // this is the second command-hook cell, and like the first it is graded on
    // the SANDBOX: the projection's bytes are the record's serialisation.
    //
    // That mechanism is exactly what made this event look dead. A callback-only
    // probe measured the registration path, not the dispatcher.
    tag: "hooks-session-start",
    title: "a command hook receives the SessionStart record — the event no callback can see",
    run: async (ctx) => {
      const msgs = await drive("Reply with exactly REFORGE_SESSION_START and nothing else.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 2,
        permissionMode: "bypassPermissions",
        hooks: {
          // Registered and expected NOT to fire. That negative is the claim
          // about the dispatcher's executor request, and it is only meaningful
          // beside the command hook below, which fires on the same run.
          SessionStart: watch(ctx, "SessionStart", (i) => ({ event: i.hook_event_name })),
        },
        settings: {
          hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node -e '${SESSION_START_PROJECTION}'` }] }] },
        },
      });
      ctx.collect(
        "SessionStart:stdin",
        existsSync(SESSION_START_FILE) ? readFileSync(SESSION_START_FILE, "utf8") : null,
      );
      return msgs;
    },
    check: (msgs, events) => {
      if (!resultText(msgs).includes("REFORGE_SESSION_START")) return "the turn did not complete";
      if (events.some((e) => (e as { event?: string }).event === "SessionStart")) {
        return "a SessionStart CALLBACK fired — upstream passes this dispatcher no registry, so the seam changed";
      }
      const dump = events.find((e) => (e as { event?: string }).event === "SessionStart:stdin") as
        | { payload?: string | null }
        | undefined;
      const text = dump?.payload;
      if (typeof text !== "string") return "the SessionStart command hook never ran — no record was written";
      // Stated as the engine's contract, and derived independently from
      // upstream's body in `strangle/hooks-parity.test.ts`. Five keys, not the
      // dispatcher's ten: the rest are undefined on this seam and JSON drops
      // them (see SESSION_START_PROJECTION).
      const expected = "keys=session_id,transcript_path,cwd,hook_event_name,source";
      const keys = text.split("\n")[0];
      if (keys !== expected) return `the record's field order changed:\n      ${keys}\n      ${expected}`;
      // `source` is also this dispatcher's matchQuery, so it is what a settings
      // matcher for this event selects on.
      if (!text.includes("source=startup")) return "the record's source is not 'startup'";
      const stamped = ["agent_type", "model", "session_title"].filter((f) => text.includes(`${f}_present=true`));
      return stamped.length === 0 ? null : `the record stamped ${stamped.join(",")}, which are undefined on this seam`;
    },
  },

  {
    // SessionEnd. Upstream has exactly two call sites — session RESUME and
    // `/clear` — so `/clear` is the one a headless run reaches, and it is the
    // one that puts the dispatcher INSIDE the observation window. The event also
    // fires on ordinary teardown, but that fire lands after the SDK iterator has
    // ended and after the state surface is sampled, so a scenario that waited
    // for it would be grading a race.
    //
    // Unlike every other dispatcher in the family this one is not a generator
    // and its results are not yielded anywhere: it writes failures to stderr and
    // CLEARS the session's hooks. What the callback proves is that it ran with
    // the reason the caller gave it.
    //
    // A failing COMMAND hook rides along, because the drain's reporting arm — a
    // failed hook with output is named on stderr, everything else is silent — is
    // the only part of this dispatcher a succeeding hook cannot move. Its
    // failure is expected and is not a scenario failure.
    tag: "hooks-session-end",
    title: "SessionEnd fires with reason 'clear' when /clear ends the session",
    run: (ctx) =>
      converse({ ...baseOptions(ctx), allowedTools: [], permissionMode: "bypassPermissions",
        hooks: {
          SessionEnd: watch(ctx, "SessionEnd", (i) => ({
            event: i.hook_event_name,
            // The record's one event-specific field, and also its matchQuery.
            reason: i.reason,
          })),
          Stop: watch(ctx, "Stop", (i) => ({ event: i.hook_event_name })),
        },
        settings: {
          // Stderr, not stdout: a failed hook's `output` is its stderr, so a
          // failure that printed to stdout would be reported as the silent kind.
          hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "echo REFORGE_SESSION_END_FAILURE >&2; exit 1" }] }] },
        },
      }, (results) => {
        if (results === 0) return "Reply with exactly REFORGE_SESSION_END and nothing else.";
        if (results === 1) return "/clear";
        return null;
      }),
    check: (msgs, events) => {
      if (!resultText(msgs).includes("REFORGE_SESSION_END")) return "the first turn did not complete";
      const ends = events.filter((e) => (e as { event?: string }).event === "SessionEnd");
      if (ends.length === 0) return "SessionEnd never fired — /clear did not end the session";
      const reason = (ends[0] as { payload?: { reason?: unknown } }).payload?.reason;
      return reason === "clear" ? null : `SessionEnd carried reason ${JSON.stringify(reason)}, not "clear"`;
    },
  },

  // ==========================================================================
  // The events C8's SECOND round found live. The first round's probe still chose
  // its own watched list; this one derives it from upstream's dispatcher
  // registry and creates a firing condition per event, which took the live set
  // from twelve to twenty-three. These six scenarios are the recordings for the
  // dispatchers that became spliceable as a result.
  // ==========================================================================

  {
    // Notification AND PermissionRequest, off one tool call — and the whole
    // reason the wave read Notification as dead is the option that makes this
    // scenario work at all.
    //
    // Every earlier hook scenario runs `bypassPermissions`, which skips the
    // permission system outright: no PermissionRequest dispatch, and no
    // can_use_tool request for the notify timer to be armed around. Upstream
    // arms a 6000 ms timer immediately before every `can_use_tool` sendRequest
    // and fires Notification when it expires, so the condition is a permission
    // answer that takes LONGER THAN SIX SECONDS. This scenario's `canUseTool`
    // sleeps past it deliberately.
    //
    // Two further gotchas, both measured and both silent: naming the tool in
    // `allowedTools` SHADOWS `canUseTool` (the SDK warns and never consults it),
    // and default mode auto-approves read-only shell commands without consulting
    // it either — so the command has to be one that writes. `mkdir` is the
    // cheapest that qualifies.
    //
    // On replay this scenario really does wait out the delay again, on both
    // sides. That is the point rather than a cost: the harness owns the answer
    // timing, so the condition is reproduced offline rather than remembered.
    tag: "hooks-permission",
    title: "PermissionRequest fires on a permission consult, and Notification when the answer is slow",
    run: (ctx) =>
      drive("Use the Bash tool to run exactly `mkdir -p reforge-permission-probe` and then reply with exactly REFORGE_PERMISSION_OK.", {
        ...baseOptions(ctx),
        // deliberately NOT allowedTools: ["Bash"] — see above
        maxTurns: 4,
        permissionMode: "default",
        canUseTool: async (tool: string, input: Record<string, unknown>) => {
          ctx.collect("canUseTool", { tool });
          await new Promise((r) => setTimeout(r, NOTIFY_ANSWER_DELAY_MS));
          return { behavior: "allow" as const, updatedInput: input };
        },
        hooks: {
          PermissionRequest: watch(ctx, "PermissionRequest", (i) => ({
            event: i.hook_event_name,
            toolName: i.tool_name,
            // `permission_suggestions` exists on this record and on no other:
            // it is what upstream offers a hook that wants to rewrite the rule
            // rather than the call. Absent on this seam, and its ABSENCE is the
            // claim — a dispatcher that stamped suggestions would differ here.
            hasSuggestions: "permission_suggestions" in i,
            suggestions: i.permission_suggestions ?? null,
          })),
          Notification: watch(ctx, "Notification", (i) => ({
            event: i.hook_event_name,
            // `notification_type` is also this dispatcher's matchQuery, so a
            // settings matcher for this event selects on it.
            notificationType: i.notification_type,
            hasMessage: typeof i.message === "string" && (i.message as string).length > 0,
            // Upstream builds `title` into the record; JSON drops it when the
            // caller passes none, which is what the permission-timer caller does.
            hasTitle: "title" in i,
          })),
        },
      }),
    check: (msgs, events) => {
      const fired = (name: string) => events.filter((e) => (e as { event?: string }).event === name).length;
      if (fired("canUseTool") === 0) return "canUseTool was never consulted — the permission condition was not created";
      if (fired("PermissionRequest") === 0) return "PermissionRequest never fired on a consulted tool call";
      if (fired("Notification") === 0) return "Notification never fired — the answer did not outlast the notify timer";
      const n = events.find((e) => (e as { event?: string }).event === "Notification") as
        | { payload?: { notificationType?: unknown; hasMessage?: boolean } }
        | undefined;
      if (n?.payload?.hasMessage !== true) return "the Notification record carried no message";
      return resultText(msgs).includes("REFORGE_PERMISSION_OK") ? null : "the turn did not complete";
    },
  },

  {
    // TaskCreated and TaskCompleted, off one conversation. Neither is dispatched
    // from the query loop: TaskCreated runs inside the TaskCreate tool's own
    // `call()`, and TaskCompleted on the TaskUpdate arm that moves a status to
    // `completed` — so the condition is not "a turn" but "these two tool calls,
    // in this order", and no other scenario in the corpus makes them.
    //
    // The two dispatchers are near-twins (the same nine parameters, the same
    // record shape, the same executor request) and differ only in the event name
    // they stamp. That is exactly the pair a single-event recording would grade
    // hollowly, so both callbacks are registered and the check asserts BOTH.
    tag: "hooks-tasks",
    title: "TaskCreated fires on TaskCreate, TaskCompleted when a task is marked completed",
    run: (ctx) =>
      drive(
        "Do these two things with the task tools, in order, and nothing else. FIRST: use the TaskCreate tool exactly once to create a task with subject 'REFORGE_TASK_SUBJECT' and description 'REFORGE_TASK_DESCRIPTION'. SECOND: use the TaskUpdate tool exactly once on that same task to set its status to completed. Then reply with exactly REFORGE_TASKS_OK.",
        {
          ...baseOptions(ctx),
          allowedTools: ["TaskCreate", "TaskUpdate"],
          maxTurns: 8,
          permissionMode: "bypassPermissions",
          hooks: {
            // One projection for both, because the records ARE the same shape —
            // writing two would state the twinning as a coincidence rather than
            // as the contract.
            TaskCreated: watch(ctx, "TaskCreated", taskRecord),
            TaskCompleted: watch(ctx, "TaskCompleted", taskRecord),
          },
        },
      ),
    check: (msgs, events) => {
      const of = (name: string) => events.filter((e) => (e as { event?: string }).event === name);
      for (const e of ["TaskCreated", "TaskCompleted"]) {
        if (of(e).length === 0) return `${e} never fired`;
      }
      const created = (of("TaskCreated")[0] as { payload?: Record<string, unknown> }).payload;
      const completed = (of("TaskCompleted")[0] as { payload?: Record<string, unknown> }).payload;
      if (created?.subject !== "REFORGE_TASK_SUBJECT") return `TaskCreated carried subject ${JSON.stringify(created?.subject)}`;
      // The SAME task, through both dispatchers. A run-scoped id cannot be
      // collected (it would diff between engines for reasons unrelated to hook
      // dispatch), but whether the two records named one task is not run-scoped
      // and is a real plumbing claim — the W5 subagent scenario grades the
      // agent-id link the same way.
      if (completed?.sameTaskAsCreated !== true) return "TaskCompleted named a different task than TaskCreated";
      return resultText(msgs).includes("REFORGE_TASKS_OK") ? null : "the turn did not complete";
    },
  },

  {
    // StopFailure, whose condition is a RESPONSE rather than a prompt: upstream
    // dispatches it on the arms where a turn ends in an api-error, a
    // prompt-too-long or an exhausted malformed-tool-use retry. No prompt makes
    // the real API return one on demand, so the cassette is recorded healthy and
    // then AUTHORED (`Scenario.deriveFault`, the H2 derivation the fault suite
    // already owns): its first exchange becomes a 500, and both engines replay
    // the same failure.
    //
    // What that buys is the guard as much as the record. This dispatcher refuses
    // twice — for a delegated-observation subagent, and for a session with no
    // StopFailure hook registered — and the second refusal is the common case on
    // every session in the world. A recording can only ever show the arm that
    // ran; the parity oracle grades the refusals.
    //
    // The retry bound is declared here (X6) because the fault entry is served
    // repeatedly: without it the engine's default backoff turns a two-second
    // scenario into a multi-minute one for no extra evidence.
    tag: "hooks-stop-failure",
    title: "StopFailure fires when a turn ends in an API error",
    deriveFault: "server-error",
    run: (ctx) =>
      drive("Reply with exactly REFORGE_STOP_FAILURE_OK and nothing else.", {
        ...baseOptions(ctx),
        env: sdkEnv(ctx.mode, ctx.baseUrl, { ...ctx.knobs, maxRetries: "1" }),
        allowedTools: [],
        maxTurns: 2,
        permissionMode: "bypassPermissions",
        hooks: {
          StopFailure: watch(ctx, "StopFailure", (i) => ({
            event: i.hook_event_name,
            // The two fields only this record carries. `error` is also the
            // matchQuery, so a matcher for this event selects on the error kind.
            error: i.error,
            hasErrorDetails: "error_details" in i,
            // Present only when the failing turn had produced assistant text;
            // upstream coerces an empty join to undefined, and JSON then drops
            // the key — so the key's ABSENCE here is the graded claim.
            hasLastAssistantMessage: "last_assistant_message" in i,
          })),
          Stop: watch(ctx, "Stop", (i) => ({ event: i.hook_event_name })),
        },
      }),
    check: (_msgs, events) => {
      const sf = events.filter((e) => (e as { event?: string }).event === "StopFailure");
      if (sf.length === 0) return "StopFailure never fired — the injected fault did not reach the api-error arm";
      const p = (sf[0] as { payload?: { error?: unknown } }).payload;
      if (typeof p?.error !== "string" || p.error.length === 0) return `StopFailure carried error ${JSON.stringify(p?.error)}`;
      // The other half of the split: a turn that FAILED must not also report a
      // clean stop. Without this, an engine that fired both would pass.
      if (events.some((e) => (e as { event?: string }).event === "Stop")) {
        return "Stop fired on a failing turn — the failure and success arms are not separated";
      }
      return null;
    },
  },

  {
    // InstructionsLoaded — one dispatch per memory file the engine loads, which
    // means the condition is a project CLAUDE.md and a filesystem setting source
    // to make it visible. It runs in a `/tmp` directory rather than the sandbox
    // for the reason MEMORY_DIR states: `project` walks ancestors, and this
    // repository has a CLAUDE.md chain the recording must not absorb.
    //
    // Its record is the family's oddest: three of its five event-specific fields
    // (`globs`, `trigger_file_path`, `parent_file_path`) come out of an options
    // bag that a top-level project memory does not fill, so they are undefined
    // and JSON drops them. Their absence is graded here; the oracle supplies
    // values this seam never does.
    tag: "hooks-memory",
    title: "InstructionsLoaded fires when a project CLAUDE.md is loaded",
    run: (ctx) => {
      rmSync(MEMORY_DIR, { recursive: true, force: true });
      mkdirSync(MEMORY_DIR, { recursive: true });
      seedGitRepo(MEMORY_DIR);
      writeFileSync(
        join(MEMORY_DIR, "CLAUDE.md"),
        "# Sandbox conventions\n\nWhen the user's message is exactly PING, reply with exactly the single word REFORGE_MEMORY_HOOKED and nothing else.\n",
      );
      return drive("PING", {
        ...baseOptions(ctx),
        cwd: MEMORY_DIR,
        settingSources: ["project"],
        allowedTools: [],
        maxTurns: 2,
        permissionMode: "bypassPermissions",
        hooks: {
          InstructionsLoaded: watch(ctx, "InstructionsLoaded", (i) => ({
            event: i.hook_event_name,
            // The path is run-scoped only in its directory, so the BASENAME is
            // what can be compared; the memory type and the load reason are the
            // dispatcher's own classification and are fully diffable.
            fileName: String(i.file_path ?? "").split("/").pop(),
            memoryType: i.memory_type,
            // Also this dispatcher's matchQuery.
            loadReason: i.load_reason,
            hasGlobs: "globs" in i,
            hasTriggerFilePath: "trigger_file_path" in i,
            hasParentFilePath: "parent_file_path" in i,
          })),
        },
      });
    },
    check: (msgs, events) => {
      const il = events.filter((e) => (e as { event?: string }).event === "InstructionsLoaded");
      if (il.length === 0) return "InstructionsLoaded never fired — no memory file was loaded";
      const p = (il[0] as { payload?: Record<string, unknown> }).payload;
      if (p?.fileName !== "CLAUDE.md") return `the record named ${JSON.stringify(p?.fileName)}, not the seeded CLAUDE.md`;
      if (p?.memoryType !== "Project") return `the record classified the memory as ${JSON.stringify(p?.memoryType)}, not Project`;
      return resultText(msgs).includes("REFORGE_MEMORY_HOOKED") ? null : "the seeded CLAUDE.md did not reach the prompt";
    },
  },

  {
    // UserPromptExpansion — dispatched when a slash command, a skill or an MCP
    // prompt is EXPANDED into the prompt the model sees, which is a moment no
    // other scenario in the corpus reaches. A project command file is the
    // cheapest of the three conditions, and it needs the same `/tmp` working
    // directory as the memory scenario for the same ancestor reason.
    //
    // This dispatcher also carries a registration guard keyed on the AGENT id
    // when there is one and the session id otherwise — the only one in the
    // family that chooses between them — and that choice is invisible to any
    // recording, because a run with no hook registered produces no observable.
    tag: "hooks-slash",
    title: "UserPromptExpansion fires when a project slash command is expanded",
    run: (ctx) => {
      rmSync(SLASH_DIR, { recursive: true, force: true });
      mkdirSync(join(SLASH_DIR, ".claude", "commands"), { recursive: true });
      seedGitRepo(SLASH_DIR);
      writeFileSync(
        join(SLASH_DIR, ".claude", "commands", "reforgeprobe.md"),
        "Reply with exactly REFORGE_SLASH_OK and nothing else.\n",
      );
      return drive("/reforgeprobe", {
        ...baseOptions(ctx),
        cwd: SLASH_DIR,
        settingSources: ["project"],
        allowedTools: [],
        maxTurns: 2,
        permissionMode: "bypassPermissions",
        hooks: {
          UserPromptExpansion: watch(ctx, "UserPromptExpansion", (i) => ({
            event: i.hook_event_name,
            // The four fields that exist only on this record, and the prompt the
            // expansion produced. `expansion_type` distinguishes a slash command
            // from an MCP prompt; `command_source` says which layer supplied it.
            expansionType: i.expansion_type,
            commandName: i.command_name,
            commandArgs: i.command_args,
            commandSource: i.command_source,
            prompt: i.prompt,
          })),
        },
      });
    },
    check: (msgs, events) => {
      const ex = events.filter((e) => (e as { event?: string }).event === "UserPromptExpansion");
      if (ex.length === 0) return "UserPromptExpansion never fired — the command was probably not expanded";
      const p = (ex[0] as { payload?: Record<string, unknown> }).payload;
      if (p?.commandName !== "reforgeprobe") return `the record named ${JSON.stringify(p?.commandName)}`;
      if (p?.expansionType !== "slash_command") return `the record classified the expansion as ${JSON.stringify(p?.expansionType)}`;
      return resultText(msgs).includes("REFORGE_SLASH_OK") ? null : "the expanded command did not reach the model";
    },
  },

  {
    // FileChanged — the one dispatcher in the family reached by the FILESYSTEM
    // rather than by the conversation. Upstream arms a chokidar watcher from the
    // registered FileChanged hooks' MATCHERS (each is split on `|` and resolved
    // against the cwd); nothing a hook prints arms it, and a hook with no
    // matcher arms nothing. So this scenario registers a matcher over the
    // sandbox through the settings layer, and then writes a file inside it.
    //
    // WHAT IS COLLECTED, AND WHY IT IS ONE EVENT RATHER THAN ONE PER FIRE. The
    // watcher debounces with a 500 ms stability threshold, so how many times it
    // fires for a create-then-overwrite is a property of the filesystem's
    // timing, not of the dispatcher — collecting per fire would put that timing
    // on a diffed surface. The scenario accumulates instead and emits ONE
    // observation at the end: that the dispatcher ran, which files it named, and
    // that it stamped an event kind. A sabotaged dispatcher never reaches the
    // watcher helper, so it collects `fired: false` and the scenario reddens.
    tag: "hooks-file-watch",
    title: "FileChanged fires for a file under a registered matcher",
    substanceOnly:
      "the watcher's fire COUNT and ordering are filesystem timing (chokidar debounces with a 500 ms stability " +
      "threshold), so the per-fire event stream is not a contract; the accumulated observation is, and the check asserts it",
    run: async (ctx) => {
      const seen = new Set<string>();
      let kinds = 0;
      // ONE write, then a real sleep inside the same turn. The watcher debounces
      // with a 500 ms stability threshold, so a turn that ends the moment the
      // file lands races the dispatch it exists to observe — measured: the first
      // take wrote twice and replied immediately, and the fire arrived after the
      // query had closed on BOTH replay sides. The sleep is not padding; it is
      // the part of the condition the filesystem owns.
      const msgs = await drive(
        `Do exactly three things, in order, and nothing else. FIRST: use the Write tool to create a file named ${WATCHED_FILE} containing exactly \`one\`. SECOND: use the Bash tool to run exactly \`sleep 3\`. THIRD: reply with exactly REFORGE_WATCHED_OK.`,
        {
          ...baseOptions(ctx),
          allowedTools: ["Write", "Bash"],
          maxTurns: 6,
          permissionMode: "bypassPermissions",
          hooks: {
            FileChanged: [
              {
                hooks: [
                  async (input: unknown) => {
                    const i = input as { file_path?: string; event?: string };
                    const name = String(i.file_path ?? "").split("/").pop() ?? "";
                    if (name.endsWith(".txt")) seen.add(name);
                    if (typeof i.event === "string" && i.event.length > 0) kinds++;
                    return { continue: true } as const;
                  },
                ],
              },
            ],
          },
          // The matcher is what arms the watcher, and `Options.hooks` carries no
          // matcher — so the arming registration has to go through the settings
          // layer even though the grading one is a callback.
          settings: { hooks: { FileChanged: [{ matcher: SANDBOX, hooks: [{ type: "command", command: "true" }] }] } },
        },
      );
      ctx.collect("FileChanged:accumulated", { fired: seen.size > 0 || kinds > 0, files: [...seen].sort(), everyFireNamedAKind: kinds > 0 });
      return msgs;
    },
    check: (msgs, events) => {
      const acc = events.find((e) => (e as { event?: string }).event === "FileChanged:accumulated") as
        | { payload?: { fired?: boolean; files?: string[]; everyFireNamedAKind?: boolean } }
        | undefined;
      if (acc?.payload?.fired !== true) return "FileChanged never fired — the matcher did not arm the watcher";
      if (!acc.payload.files?.includes(WATCHED_FILE)) return `the watcher named ${JSON.stringify(acc.payload.files)}, not ${WATCHED_FILE}`;
      if (acc.payload.everyFireNamedAKind !== true) return "the record carried no event kind";
      return resultText(msgs).includes("REFORGE_WATCHED_OK") ? null : "the turn did not complete";
    },
  },
];
