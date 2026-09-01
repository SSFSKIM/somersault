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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { baseOptions, converse, drive, resultText, resultsOf, usedTool, type Scenario, type ScenarioContext } from "../src/harness.js";
import { SANDBOX } from "../src/runTurn.js";

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
    // folds a hook's stdout back in as new custom instructions and refuses to
    // compact at all if a hook blocks. Neither arm is reachable from a callback
    // that returns `{continue:true}`, so what this recording grades is the
    // record and the no-op result; the oracle grades the rest.
    tag: "hooks-precompact",
    title: "PreCompact fires on a real compaction, with the manual trigger",
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
];
