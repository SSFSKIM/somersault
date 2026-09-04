// W10 corpus scenarios — the executor's unreached surface, recorded.
//
// The corpus has 63 scenarios and its Bash calls are `echo`, `mkdir`, `chmod`
// and `sleep`. That reaches ONE of `dZe`'s six result arms, no truncation, no
// backgrounding, no timeout, no compound command and no pre-spawn refusal
// (scout §4.2). These are the six recordings that buy the rest of it, plus the
// two that need C13c's machinery.
//
// EVERY COMMAND IS THE SCRIPTED CHILD or a compound built from shell builtins,
// so what the engine executed is a declaration rather than whatever `sleep`
// happened to do on the day. `w10/child.ts` derives the exact bytes each plan
// produces, so a scenario's `check` can assert the OUTPUT and not merely that
// something ran.
//
// WHICH ENGINE SET, AND WHY. The six below run on the corpus's own pair —
// `engine-real` as oracle, `engine-extracted` under test — because none of them
// needs a deadline moved: the background hint's 2 s is affordable once, the
// truncation ladder and the compound chain are instantaneous, and the timeout
// is declared by the tool call rather than by a constant. The two in
// `W10_TIMED_SCENARIOS` cannot run on `engine-real` at all — the oracle is a
// compiled binary and the rewrite is of the graph's own bytes — so they are
// graded on the identical-code GRAPH pair (`engine-extracted` vs
// `engine-strangled`), where any difference is a harness defect, exactly as the
// corpus's own pair is read. `w10/timed.ts` drives them and says so per run.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { baseOptions, drive, pushable, resultsOf, usedTool, userMessage, type Scenario } from "../src/harness.js";
import { SANDBOX } from "../src/runTurn.js";
import { childCommand, expectedOutput, seedScriptedChild, SCRIPTED_CHILD_NAME, type ChildPlan } from "./child.js";
import type { DeadlineRole, TimerProfile } from "./timers.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Bash tool's own truncation threshold at this pin: `xin = 30000`, the default `BASH_MAX_OUTPUT_LENGTH`. */
export const BASH_MAX_OUTPUT_DEFAULT = 30_000;

/** The notification prefix the engine builds every backgrounded-command summary from (`ZCe`). */
export const BACKGROUND_NOTIFICATION_PREFIX = "Background command ";

/** Every tool_use block of a given name, with its input — what the moat claims are asserted against. */
const toolUses = (msgs: unknown[], name: string): { id?: string; input?: Record<string, unknown> }[] => {
  const out: { id?: string; input?: Record<string, unknown> }[] = [];
  for (const m of msgs) {
    const mm = m as { type?: string; message?: { content?: unknown } };
    if (mm.type !== "assistant") continue;
    const c = mm.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c as { type?: string; name?: string; id?: string; input?: Record<string, unknown> }[]) {
      if (b?.type === "tool_use" && b.name === name) out.push({ id: b.id, input: b.input });
    }
  }
  return out;
};

/** Every tool_result's text, in order. */
const toolResults = (msgs: unknown[]): string[] => {
  const out: string[] = [];
  for (const m of msgs) {
    const c = (m as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c as { type?: string; content?: unknown }[]) {
      if (b?.type !== "tool_result") continue;
      out.push(typeof b.content === "string" ? b.content : JSON.stringify(b.content));
    }
  }
  return out;
};

/**
 * The `system`/`task_notification` frames the engine emits into the SDK stream.
 *
 * MEASURED on the corpus's existing `background-task` recording, which drives
 * the AGENT tool's flag: the notification is not only an attachment on the next
 * request, it is its own frame carrying `task_id`, `tool_use_id`, `status`,
 * `output_file` and `summary`. That makes the moat claim a STRUCTURAL assertion
 * — a frame whose `tool_use_id` is the Bash call's and whose `summary` is the
 * sentence the engine composed — rather than a substring search over the
 * capture, which would also match the prompt that asked for it.
 */
const taskNotifications = (msgs: unknown[]): { tool_use_id?: string; status?: string; summary?: string }[] =>
  msgs.filter((m) => {
    const mm = m as { type?: string; subtype?: string };
    return mm.type === "system" && mm.subtype === "task_notification";
  }) as { tool_use_id?: string; status?: string; summary?: string }[];

// ---- the six that need no machinery -----------------------------------------

/**
 * THE MOAT SCENARIO (scout §4.5 #1). `run_in_background: true` is presented
 * headlessly — `$d()` is false, so `Tzt()` keeps the field — and the arm it
 * reaches is `Kee`, which registers the task, backgrounds the shell and arms
 * `xWt`. Zero of the corpus's Bash calls set it today; the `background-task`
 * scenario drives the AGENT tool's flag, which is a different subsystem.
 *
 * TWO TURNS, AND A WAIT BETWEEN THEM. The completion notification is pushed
 * with `priority: "next"` and delivered on the NEXT user turn, so a second turn
 * sent before the child finished would carry nothing. The child's schedule is
 * declared (`--chunks 3 --every 300`, so ~600 ms of sleeping) and the wait is
 * comfortably past it; the wait delays only the harness and is applied
 * identically to both engines.
 */
const BG_PLAN: ChildPlan = { bytes: 60, chunks: 3, everyMs: 300 };

const backgroundExplicit: Scenario = {
  tag: "bash-background-explicit",
  title: "a Bash command the model backgrounds, and its completion notification on the next turn",
  detachedChildren: [],
  run: async (ctx) => {
    seedScriptedChild(SANDBOX);
    const input = pushable<SDKUserMessage>();
    const messages: unknown[] = [];
    input.push(
      userMessage(
        `Use the Bash tool to run exactly \`${childCommand(BG_PLAN)}\` with the run_in_background parameter set to true, ` +
          `and with the description "reforge background probe". Do not wait for it and do not run anything else. ` +
          `Reply with exactly REFORGE_BG_STARTED.`,
      ),
    );
    let results = 0;
    for await (const m of query({
      prompt: input,
      options: { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 4, permissionMode: "bypassPermissions" },
    })) {
      messages.push(m);
      if ((m as { type?: string }).type !== "result") continue;
      results++;
      if (results === 1) {
        await sleep(2_500);
        input.push(userMessage("Reply with exactly REFORGE_BG_DONE."));
      } else input.end();
    }
    return messages;
  },
  check: (msgs) => {
    const uses = toolUses(msgs, "Bash");
    if (uses.length === 0) return "Bash tool never used";
    if (!uses.some((u) => u.input?.run_in_background === true)) {
      return `no Bash call set run_in_background — inputs were ${JSON.stringify(uses.map((u) => u.input))}`;
    }
    // The notification is the point, and it is asserted structurally: a
    // `system`/`task_notification` frame whose `tool_use_id` is THIS Bash call's
    // and whose `summary` is the sentence the engine composed from `ZCe`.
    const bg = uses.find((u) => u.input?.run_in_background === true);
    const notes = taskNotifications(msgs);
    if (notes.length === 0) return "no task_notification frame — the backgrounded command's completion never reached the session";
    const mine = notes.filter((n) => n.tool_use_id === bg?.id);
    if (mine.length === 0) {
      return `a task_notification arrived but for ${JSON.stringify(notes.map((n) => n.tool_use_id))}, not for the backgrounded Bash call ${JSON.stringify(bg?.id)}`;
    }
    if (!mine.some((n) => String(n.summary ?? "").startsWith(BACKGROUND_NOTIFICATION_PREFIX))) {
      return `the notification's summary is not the engine's backgrounded-command sentence: ${JSON.stringify(mine.map((n) => n.summary))}`;
    }
    return null;
  },
};

/**
 * The `background_tasks` control subtype (scout §4.5 #2). W7 fired this ARM
 * against an EMPTY registry, so it answered success without touching a shell —
 * FIRED arm, UNREACHED effect. This is the effect: a real `local_bash` running,
 * backgrounded by its `tool_use_id`, and the notification that follows.
 *
 * `q.backgroundTasks(toolUseId)` is the installed SDK's own sender, so the
 * frame is the one a host would send rather than one the harness hand-built.
 */
const BG_CONTROL_PLAN: ChildPlan = { bytes: 80, chunks: 8, everyMs: 700 };

const backgroundControl: Scenario = {
  tag: "bash-background-control",
  title: "the host backgrounds a running Bash through the background_tasks control request",
  detachedChildren: [],
  run: async (ctx) => {
    seedScriptedChild(SANDBOX);
    const input = pushable<SDKUserMessage>();
    const messages: unknown[] = [];
    input.push(
      userMessage(
        `Use the Bash tool to run exactly \`${childCommand(BG_CONTROL_PLAN)}\` and then report its output. ` +
          `Do not set run_in_background.`,
      ),
    );
    const q = query({
      prompt: input,
      options: { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 4, permissionMode: "bypassPermissions" },
    });
    let sent = false;
    let results = 0;
    for await (const m of q) {
      messages.push(m);
      if (!sent) {
        const use = toolUses([m], "Bash")[0];
        if (use?.id !== undefined) {
          sent = true;
          const id = use.id;
          // Once the tool is actually RUNNING, not the instant the block
          // appears: the same race `m3`'s interrupt scenario measured, where
          // firing on the block produced a hard exit with no frames.
          setTimeout(() => {
            void q
              .backgroundTasks(id)
              .then((ok) => ctx.collect("background_tasks", { toolUseId: id, backgrounded: ok }))
              .catch((e) => ctx.collect("background_tasks", { toolUseId: id, error: String((e as Error).message).slice(0, 120) }));
          }, 1_500);
        }
      }
      if ((m as { type?: string }).type !== "result") continue;
      results++;
      if (results === 1) {
        await sleep(4_000);
        input.push(userMessage("Reply with exactly REFORGE_BGC_DONE."));
      } else input.end();
    }
    return messages;
  },
  check: (msgs, events) => {
    const fired = events.find((e) => (e as { event?: string }).event === "background_tasks") as
      | { payload?: { backgrounded?: unknown; error?: unknown } }
      | undefined;
    if (fired === undefined) return "the background_tasks control request was never sent";
    if (fired.payload?.backgrounded !== true) {
      return `background_tasks answered ${JSON.stringify(fired.payload)} — the EFFECT (a real running shell) was not reached`;
    }
    const notes = taskNotifications(msgs);
    if (notes.length === 0) return "no task_notification frame — the shell was backgrounded but its completion never reached the session";
    if (!notes.some((n) => String(n.summary ?? "").startsWith(BACKGROUND_NOTIFICATION_PREFIX))) {
      return `the notification's summary is not the engine's backgrounded-command sentence: ${JSON.stringify(notes.map((n) => n.summary))}`;
    }
    return null;
  },
};

/**
 * Auto-backgrounding on timeout (scout §4.5 #3). `Gcr` arms `en.onTimeout` only
 * when `r_r(command)` holds: a `kind: "simple"` parse, no `git` subcommand, and
 * a first word outside `$cr = ["sleep"]`. The scripted child satisfies all
 * three where `sleep 30` — the obvious choice — is excluded BY DESIGN.
 */
const TIMEOUT_PLAN: ChildPlan = { bytes: 120, chunks: 12, everyMs: 800 };

const timeoutBackground: Scenario = {
  tag: "bash-timeout-background",
  title: "a Bash call that outlives its declared timeout and is auto-backgrounded",
  detachedChildren: [],
  run: async (ctx) => {
    seedScriptedChild(SANDBOX);
    const input = pushable<SDKUserMessage>();
    const messages: unknown[] = [];
    input.push(
      userMessage(
        `Use the Bash tool to run exactly \`${childCommand(TIMEOUT_PLAN)}\` with the timeout parameter set to 2000. ` +
          `Then report what the tool told you, verbatim.`,
      ),
    );
    let results = 0;
    for await (const m of query({
      prompt: input,
      options: { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 4, permissionMode: "bypassPermissions" },
    })) {
      messages.push(m);
      if ((m as { type?: string }).type !== "result") continue;
      results++;
      if (results === 1) {
        await sleep(9_000);
        input.push(userMessage("Reply with exactly REFORGE_TIMEOUT_DONE."));
      } else input.end();
    }
    return messages;
  },
  check: (msgs) => {
    const uses = toolUses(msgs, "Bash");
    if (uses.length === 0) return "Bash tool never used";
    if (!uses.some((u) => Number(u.input?.timeout) === 2_000)) {
      return `no Bash call declared timeout=2000 — inputs were ${JSON.stringify(uses.map((u) => u.input))}`;
    }
    // One of the two outcomes `WMt` produces, and WHICH is engine behaviour the
    // differ compares: an auto-backgrounded task, or the timeout sentence. What
    // must not happen is neither — a command that simply ran to completion means
    // the deadline was never reached and the scenario grades nothing.
    const backgrounded = taskNotifications(msgs).some((n) => String(n.summary ?? "").startsWith(BACKGROUND_NOTIFICATION_PREFIX));
    const timedOut = toolResults(msgs).some((r) => /timed out/i.test(r));
    if (!backgrounded && !timedOut) {
      return "neither the timeout sentence nor a backgrounded-task notification appeared — the deadline was never reached";
    }
    return null;
  },
};

/**
 * The truncation ladder (scout §4.5 #4). `cye()` reads
 * `BASH_MAX_OUTPUT_LENGTH` and defaults to `xin = 30000` (measured at this
 * pin), so 40,000 deterministic bytes is comfortably past it and inside the
 * `Hin = 150000` cap. The output is the scripted child's, so the exact bytes
 * are known before the recording exists.
 */
const LARGE_PLAN: ChildPlan = { bytes: 40_000, chunks: 1 };

const largeOutput: Scenario = {
  tag: "bash-large-output",
  title: "a Bash command whose stdout runs past BASH_MAX_OUTPUT_LENGTH",
  detachedChildren: [],
  run: (ctx) => {
    seedScriptedChild(SANDBOX);
    return drive(
      `Use the Bash tool to run exactly \`${childCommand(LARGE_PLAN)}\`. Do not print its output back to me. ` +
        `Reply with exactly REFORGE_LARGE_OK followed by nothing else.`,
      { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 3, permissionMode: "bypassPermissions" },
    );
  },
  check: (msgs) => {
    if (!usedTool(msgs, "Bash")) return "Bash tool never used";
    const results = toolResults(msgs);
    if (results.length === 0) return "no tool_result at all";
    const biggest = Math.max(...results.map((r) => r.length));
    if (biggest > BASH_MAX_OUTPUT_DEFAULT + 5_000) {
      return `the largest tool_result is ${biggest} bytes — past the ${BASH_MAX_OUTPUT_DEFAULT}-byte default with no truncation applied`;
    }
    // The notice upstream writes, quoted from the pin rather than guessed:
    // `\n... [output truncated - ${n}KB removed]`, where n is the rounded
    // kilobytes past `cye()`'s effective cap. 40,000 declared bytes against the
    // measured 30,000-byte default leaves ~10 KB removed.
    if (!results.some((r) => /\[output truncated[^\]]*\]/.test(r))) {
      return `no tool_result carries a truncation notice, so the ladder was not reached (largest ${biggest} bytes of a declared ${LARGE_PLAN.bytes})`;
    }
    // The child's output is derived, so the FIRST bytes are known: a truncation
    // that dropped the head instead of the middle would still say "truncated".
    if (!results.some((r) => r.includes(expectedOutput(LARGE_PLAN).slice(0, 24)))) {
      return "the surviving output does not begin with the bytes the declared schedule produces";
    }
    return null;
  },
};

/**
 * The compound-safety chain (scout §4.5 #5), which C13b consumes: one command
 * carrying a pipe, a redirect, a subshell and TWO `cd`s, so `drn`'s aggregate,
 * `KTe`'s too-complex arms and the two live-but-dark `Fy` callers W6 left OPEN
 * — the multi-`cd` aggregator and the subcommand merge tie-break — are all on
 * the path at once.
 *
 * Everything it touches is created by the command itself, so the sandbox state
 * it leaves is a function of the command rather than of what a previous
 * scenario happened to leave.
 */
const COMPOUND_COMMAND = "mkdir -p one two && cd one && cd ../two && (printf 'alpha\\n'; printf 'beta\\n') | tr 'ab' 'AB' > merged.txt && cat merged.txt";

const compoundSafety: Scenario = {
  tag: "bash-compound-safety",
  title: "one Bash call with a pipe, a redirect, a subshell and two cd's",
  detachedChildren: [],
  run: (ctx) =>
    drive(
      `Use the Bash tool to run exactly this command, as a single call, and then report its output verbatim:\n` +
        `${COMPOUND_COMMAND}`,
      { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 3, permissionMode: "bypassPermissions" },
    ),
  check: (msgs) => {
    const uses = toolUses(msgs, "Bash");
    if (uses.length === 0) return "Bash tool never used";
    const cmd = String(uses[0].input?.command ?? "");
    if ((cmd.match(/\bcd\b/g) ?? []).length < 2) return `the recorded command carries fewer than two cd's: ${JSON.stringify(cmd)}`;
    if (!cmd.includes("|") || !cmd.includes(">") || !cmd.includes("(")) {
      return `the recorded command is missing a pipe, a redirect or a subshell: ${JSON.stringify(cmd)}`;
    }
    // `tr 'ab' 'AB'` over `alpha`/`beta` is `AlphA` and `BetA`: the transform is
    // asserted, not merely that something was written.
    if (!toolResults(msgs).some((r) => r.includes("AlphA") && r.includes("BetA"))) {
      return `the pipeline's output is not in any tool_result: ${JSON.stringify(toolResults(msgs)).slice(0, 200)}`;
    }
    return null;
  },
};

/**
 * The PRE-SPAWN refusal (scout §4.5 #6): the working directory the executor
 * would spawn into no longer exists, which reaches `rw` and the two `R(...)`
 * refusals in `yi.call`.
 *
 * THE HARNESS DELETES IT, not the model. The alternative — asking the model to
 * `cd` somewhere and then remove it — makes the scenario's stimulus depend on
 * how the model chose to phrase two commands, which is exactly the
 * nondeterminism a recorded corpus is built to remove. Here the model runs one
 * ordinary command in a subdirectory, the scenario removes that directory
 * between turns, and the second command meets a cwd that is gone.
 */
const DOOMED = "doomed";

const prespawnError: Scenario = {
  tag: "bash-prespawn-error",
  title: "a second Bash call whose tracked working directory has been deleted",
  detachedChildren: [],
  run: async (ctx) => {
    seedScriptedChild(SANDBOX);
    mkdirSync(join(SANDBOX, DOOMED), { recursive: true });
    const input = pushable<SDKUserMessage>();
    const messages: unknown[] = [];
    input.push(userMessage(`Use the Bash tool to run exactly \`cd ${DOOMED} && pwd\`. Report its output verbatim.`));
    let results = 0;
    for await (const m of query({
      prompt: input,
      options: { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 4, permissionMode: "bypassPermissions" },
    })) {
      messages.push(m);
      if ((m as { type?: string }).type !== "result") continue;
      results++;
      if (results === 1) {
        // The engine has recorded `<sandbox>/doomed` as this session's working
        // directory. Take it away.
        rmSync(join(SANDBOX, DOOMED), { recursive: true, force: true });
        ctx.collect("cwd-removed", { path: DOOMED, stillThere: existsSync(join(SANDBOX, DOOMED)) });
        input.push(userMessage("Now use the Bash tool to run exactly `pwd` and report what the tool told you, verbatim."));
      } else input.end();
    }
    return messages;
  },
  check: (msgs, events) => {
    const removed = events.find((e) => (e as { event?: string }).event === "cwd-removed") as { payload?: { stillThere?: unknown } } | undefined;
    if (removed === undefined) return "the scenario never removed the working directory";
    if (removed.payload?.stillThere !== false) return "the scenario tried to remove the working directory and it is still there";
    const results = toolResults(msgs);
    if (toolUses(msgs, "Bash").length < 2 || results.length < 2) {
      return `expected two Bash calls with two results, saw ${toolUses(msgs, "Bash").length} call(s) and ${results.length} result(s)`;
    }
    // THE SHARP CLAIM, and it is a negative one. Either the executor refuses
    // before spawning or it recovers to one of its three roots — WHICH of the
    // two is engine behaviour the differ compares, so neither is asserted here.
    // What must not happen is a second `pwd` that reports the deleted directory
    // as though it were still the working directory.
    if (results[1].includes(`/${DOOMED}`)) {
      return `the second call reported the deleted directory as its cwd: ${JSON.stringify(results[1].slice(0, 160))}`;
    }
    return null;
  },
};

export const W10_SCENARIOS: Scenario[] = [
  backgroundExplicit,
  backgroundControl,
  timeoutBackground,
  largeOutput,
  compoundSafety,
  prespawnError,
];

// ---- the two that need the machinery ----------------------------------------

/**
 * The deadlines actually in force for a run, in milliseconds — the pinned
 * values with a profile's overrides applied.
 *
 * A timed scenario is BUILT against these rather than against a fixed sleep,
 * and that is not a convenience. The stall detector fires 45 s after the output
 * stops at this pin and 1.8 s after it under the profile, so a scenario with
 * one hard-coded wait would either take 56 s on every replay or send its second
 * turn before the notification existed — and the second failure is silent, because
 * a turn that carries no attachment still looks like a turn.
 */
export type EffectiveDeadlines = Record<DeadlineRole, number>;

/** A scenario that cannot be graded against the compiled oracle, and the reason. */
export interface TimedScenarioSpec {
  tag: string;
  title: string;
  /** what the graded (replay) lane rewrites */
  timers: TimerProfile;
  /** why this scenario cannot be graded against `engine-real` */
  why: string;
  /** the scenario, built against the deadlines actually in force */
  make(effective: EffectiveDeadlines): Scenario;
}

/**
 * THE STALL DETECTOR. `kWt` polls the output file every `stall-poll` (5,000 ms
 * at this pin) and fires when the file has been unchanged for `stall-idle`
 * (45,000 ms) AND the last line matches one of `ylr`'s seven interactive-prompt
 * regexes — the list `research/tools/extract-shell-timers.ts` derives.
 *
 * The command is the scripted child's prompt tail followed by a plain `sleep`,
 * which is what a command blocked on a prompt actually looks like: output that
 * stops with a question on the last line and a process that has not exited.
 */
const stallPlan: ChildPlan = { bytes: 40, chunks: 1, promptTail: true };

const stallDetect = (d: EffectiveDeadlines): Scenario => {
  // Long enough for the detector to sample an already-idle file at least twice
  // after the threshold expires, plus a margin for the notification to reach
  // the queue. Derived, so the RECORDING pays the pin's 45 s once and every
  // replay pays the profile's 1.8 s.
  const holdSeconds = Math.ceil((d["stall-idle"] + d["stall-poll"] * 3 + 4_000) / 1_000);
  const waitMs = d["stall-idle"] + d["stall-poll"] * 2 + 3_000;
  const command = `${childCommand(stallPlan)}; sleep ${holdSeconds}`;
  return {
    tag: "bash-stall-detect",
    title: "a backgrounded command that stops producing output on an interactive prompt",
    // The shell is deliberately still running when the scenario ends, and
    // whether the engine reaps it on shutdown is itself what the supervision
    // surface grades here.
    // DERIVED from the command this scenario actually runs, so the declaration
    // cannot drift from it: the backgrounded shell carries the child's name, and
    // the `sleep` it ends with is its own process once the child has exited.
    detachedChildren: [SCRIPTED_CHILD_NAME, `sleep ${holdSeconds}`],
    run: async (ctx) => {
      seedScriptedChild(SANDBOX);
      const input = pushable<SDKUserMessage>();
      const messages: unknown[] = [];
      input.push(
        userMessage(
          `Use the Bash tool to run exactly \`${command}\` with run_in_background set to true and the description ` +
            `"reforge stall probe". Do not wait for it. Reply with exactly REFORGE_STALL_STARTED.`,
        ),
      );
      let results = 0;
      for await (const m of query({
        prompt: input,
        options: { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 4, permissionMode: "bypassPermissions" },
      })) {
        messages.push(m);
        if ((m as { type?: string }).type !== "result") continue;
        results++;
        if (results === 1) {
          await sleep(waitMs);
          input.push(userMessage("Reply with exactly REFORGE_STALL_DONE."));
        } else input.end();
      }
      return messages;
    },
    check: (msgs) => {
      if (!usedTool(msgs, "Bash")) return "Bash tool never used";
      const stalled = taskNotifications(msgs).filter((n) => String(n.summary ?? "").includes("waiting for interactive input"));
      if (stalled.length === 0) {
        return `the stall detector never fired — no task_notification said the command appears to be waiting for interactive input (summaries: ${JSON.stringify(taskNotifications(msgs).map((n) => n.summary))})`;
      }
      if (!stalled.every((n) => String(n.summary ?? "").startsWith(BACKGROUND_NOTIFICATION_PREFIX))) {
        return `the stall notification's summary is not the engine's backgrounded-command sentence: ${JSON.stringify(stalled.map((n) => n.summary))}`;
      }
      return null;
    },
  };
};

/**
 * THE SIGTERM->SIGKILL ESCALATION. `#h` sends SIGTERM, arms a `sigterm-to-sigkill`
 * (1,500 ms) backstop that process-group-SIGKILLs, and polls liveness every
 * `post-kill-liveness-poll` (100 ms) so a process that died of the TERM cancels
 * the backstop before it fires. A child that IGNORES SIGTERM is the only way the
 * backstop is ever reached, and the corpus has none — every command it runs dies
 * of the first signal.
 *
 * ## The command form is a MEASUREMENT, not a preference
 *
 * Two upstream facts have to hold at once, and the obvious command satisfies
 * neither pair:
 *
 *  1. THE TIMEOUT MUST KILL RATHER THAN BACKGROUND. `Gcr` computes
 *     `nn = !tt && r_r(command)` and passes it as `shouldAutoBackground`; when
 *     it is true the deadline BACKGROUNDS the shell and nothing is ever
 *     signalled. `r_r` is false when the parse is not `kind: "simple"`, when a
 *     subcommand is a `git` command, or when the FIRST WORD of the first
 *     subcommand is in `$cr = ["sleep"]`. A plain `./reforge-child.sh …` is
 *     simple, so it takes the backgrounding arm — which is what the sibling
 *     scenario `bash-timeout-background` grades, deliberately.
 *  2. THE SIGNALLED PROCESS MUST BE THE ONE THAT IGNORES THE SIGNAL. `#h`
 *     signals the SHELL's pid and cancels its backstop as soon as that pid is
 *     gone. MEASURED on this host: `bash -c '<one simple command>'` exec-
 *     optimizes, so the shell IS the script and survives; `bash -c '<cmd> >
 *     file'` and `bash -c '<cmd>; true'` do NOT, so bash dies of the TERM, the
 *     liveness poll sees the pid gone, the backstop is CANCELLED — and the
 *     script it started is orphaned and survives. That path reaches neither the
 *     escalation nor a clean shutdown, and the supervision surface would report
 *     it as a leak.
 *
 * `sleep 0 && exec ./reforge-child.sh …` satisfies both, and each half is doing
 * one job: the leading `sleep` puts `sleep` at the head of `Ua`'s first
 * subcommand so `r_r` is false and the deadline kills, and the explicit `exec`
 * replaces the shell with the script unconditionally, so the pid `#h` signals is
 * the pid that traps. Measured: it survives SIGTERM and dies of the group
 * SIGKILL.
 *
 * The trigger is the tool's own `timeout` rather than an interrupt, because a
 * timeout is a declaration in the tool call while an interrupt is a race against
 * the engine's dispatch — measured in `m3`'s interrupt scenario, where firing on
 * the tool_use block produced a hard exit with no frames at all.
 */
const killPlan: ChildPlan = { bytes: 60, chunks: 20, everyMs: 600, ignoreTerm: true };

/** See the block above: both halves are load-bearing and each was measured. */
const KILL_COMMAND = `sleep 0 && exec ${childCommand(killPlan)}`;

const killEscalation = (d: EffectiveDeadlines): Scenario => {
  // Past the backstop and its liveness polling, with room for the executor to
  // finish composing the result.
  const waitMs = d["sigterm-to-sigkill"] + d["post-kill-liveness-poll"] * 5 + 3_000;
  return {
    tag: "bash-kill-escalation",
    title: "a timed-out Bash command whose child ignores SIGTERM",
    // Nothing may survive: the escalation exists precisely so that a child which
    // ignores SIGTERM is still gone. The EMPTY declaration makes any survivor a
    // LEAK on the supervision surface — which is this scenario's second claim,
    // and the one that catches the cancelled-backstop path described above.
    detachedChildren: [],
    run: async (ctx) => {
      seedScriptedChild(SANDBOX);
      const msgs = await drive(
        `Use the Bash tool to run exactly this command, as a single call, with the timeout parameter set to 1500, ` +
          `and then report what the tool told you, verbatim:\n${KILL_COMMAND}`,
        { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 3, permissionMode: "bypassPermissions" },
      );
      // The escalation happens AFTER the tool result is composed, so a snapshot
      // taken the instant the query resolves would grade a kill still in flight.
      await sleep(waitMs);
      return msgs;
    },
    check: (msgs) => {
      const uses = toolUses(msgs, "Bash");
      if (uses.length === 0) return "Bash tool never used";
      if (!uses.some((u) => Number(u.input?.timeout) === 1_500)) {
        return `no Bash call declared timeout=1500 — inputs were ${JSON.stringify(uses.map((u) => u.input))}`;
      }
      const cmd = String(uses[0].input?.command ?? "");
      if (!cmd.includes("--ignore-term")) return "the recorded command does not carry --ignore-term, so the backstop was never needed";
      if (!cmd.includes("exec ")) return `the recorded command lost its \`exec\`, so the signalled pid is bash and not the trapping script: ${JSON.stringify(cmd)}`;
      if (!/^\s*sleep\s/.test(cmd)) return `the recorded command lost its leading sleep, so \`r_r\` is true and the deadline backgrounds instead of killing: ${JSON.stringify(cmd)}`;
      // Read from the TOOL RESULT, not from the capture: the command string is
      // echoed back in the tool_use block, so a whole-capture search for
      // "timeout" matches the request that asked for one.
      if (!toolResults(msgs).some((r) => /timed out|killed|terminated/i.test(r))) {
        return `no tool_result says the command was stopped: ${JSON.stringify(toolResults(msgs)).slice(0, 200)}`;
      }
      return null;
    },
  };
};

export const W10_TIMED_SCENARIOS: TimedScenarioSpec[] = [
  {
    tag: "bash-stall-detect",
    title: "a backgrounded command that stops producing output on an interactive prompt",
    // `stall-poll` down from 5,000 and `stall-idle` down from 45,000. BOTH, and
    // only both: a 1.8 s idle threshold left behind a 5 s poll would be
    // unobservable, because the detector cannot notice an idle file it does not
    // sample.
    timers: { "stall-poll": 400, "stall-idle": 1_800 },
    why: "the stall detector needs 45 s of unchanged output at this pin, which is affordable ONCE for the recording and not on every replay; the oracle is a compiled binary whose constants cannot be moved, so the graded pair is extracted-vs-strangled",
    make: stallDetect,
  },
  {
    tag: "bash-kill-escalation",
    title: "a timed-out Bash command whose child ignores SIGTERM",
    // The backstop from 1,500 ms to 400 ms, and the liveness poll from 100 ms to
    // 40 ms so the CANCEL path still has several samples inside the shorter
    // window — a poll left at 100 ms inside a 400 ms backstop grades a coarser
    // race than the pinned pair does.
    timers: { "sigterm-to-sigkill": 400, "post-kill-liveness-poll": 40 },
    why: "the escalation is only reachable with a child that ignores SIGTERM plus the backstop's full wait; the rewrite is of the graph's own bytes, which the compiled oracle does not share",
    make: killEscalation,
  },
];
