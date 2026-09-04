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
import { baseOptions, drive, pushable, resultsOf, resultText, usedTool, userMessage, type Scenario } from "../src/harness.js";
import { SANDBOX } from "../src/runTurn.js";
import { childCommand, expectedOutput, seedScriptedChild, SCRIPTED_CHILD_NAME, type ChildPlan } from "./child.js";
import type { TimerProfile } from "./timers.js";

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

/** The whole capture as text — for facts that arrive as an attachment rather than as a tool result. */
const allText = (msgs: unknown[]): string => JSON.stringify(msgs);

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
    if (resultsOf(msgs).length !== 2) return `expected 2 results, saw ${resultsOf(msgs).length}`;
    // The notification is the point. It arrives as an ATTACHMENT on the second
    // turn rather than as a tool result, so it is looked for over the whole
    // capture; the prefix is the engine's own (`ZCe`) rather than prose.
    if (!allText(msgs).includes(BACKGROUND_NOTIFICATION_PREFIX)) {
      return `the backgrounded command's notification (${JSON.stringify(BACKGROUND_NOTIFICATION_PREFIX)}…) never reached the session`;
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
    if (!allText(msgs).includes(BACKGROUND_NOTIFICATION_PREFIX)) {
      return `the backgrounded command's notification (${JSON.stringify(BACKGROUND_NOTIFICATION_PREFIX)}…) never reached the session`;
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
    // differ compares: an auto-backgrounded task, or the timeout sentence.
    const text = allText(msgs);
    if (!text.includes("timed out") && !text.includes(BACKGROUND_NOTIFICATION_PREFIX)) {
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
    if (!results.some((r) => /truncated/i.test(r))) {
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
    if (!events.some((e) => (e as { event?: string }).event === "cwd-removed")) return "the scenario never removed the working directory";
    if (toolUses(msgs, "Bash").length < 2) return `expected two Bash calls, saw ${toolUses(msgs, "Bash").length}`;
    const text = allText(msgs);
    // Either the executor refuses before spawning, or it recovers to one of its
    // three roots — WHICH is engine behaviour the differ compares. What must not
    // happen is a second `pwd` that silently reports the deleted directory.
    if (!/no such file|does not exist|restart Claude|shell|directory/i.test(text)) {
      return "the second call neither refused nor mentioned the missing directory";
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

/** A corpus scenario plus the deadlines it rewrites, and the reason it cannot run on the oracle. */
export interface TimedScenario {
  scenario: Scenario;
  timers: TimerProfile;
  /** why this scenario cannot be graded against `engine-real` */
  why: string;
}

/**
 * THE STALL DETECTOR. `kWt` polls the output file every `plr` (5,000 ms) and
 * fires when the file has been unchanged for `mlr` (45,000 ms) AND the last
 * line matches one of `ylr`'s seven interactive-prompt regexes. Fifty seconds
 * of wall clock per replay is not a corpus scenario; rewritten to 400 ms and
 * 1,800 ms it is two seconds.
 *
 * The command is the scripted child's prompt tail followed by a plain `sleep`,
 * which is what a command blocked on a prompt actually looks like: output that
 * stops with a question on the last line and a process that does not exit.
 */
const stallPlan: ChildPlan = { bytes: 40, chunks: 1, promptTail: true };
const STALL_COMMAND = `${childCommand(stallPlan)}; sleep 12`;

const stallDetect: Scenario = {
  tag: "bash-stall-detect",
  title: "a backgrounded command that stops producing output on an interactive prompt",
  // The shell is deliberately still running when the scenario ends: `sleep 12`
  // outlives the two turns, and whether the engine reaps it on shutdown is
  // itself the thing the supervision surface grades.
  detachedChildren: [SCRIPTED_CHILD_NAME, "sleep 12"],
  run: async (ctx) => {
    seedScriptedChild(SANDBOX);
    const input = pushable<SDKUserMessage>();
    const messages: unknown[] = [];
    input.push(
      userMessage(
        `Use the Bash tool to run exactly \`${STALL_COMMAND}\` with run_in_background set to true and the description ` +
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
        await sleep(5_000);
        input.push(userMessage("Reply with exactly REFORGE_STALL_DONE."));
      } else input.end();
    }
    return messages;
  },
  check: (msgs) => {
    if (!usedTool(msgs, "Bash")) return "Bash tool never used";
    if (!allText(msgs).includes("waiting for interactive input")) {
      return "the stall detector never fired — no notification said the command appears to be waiting for interactive input";
    }
    return null;
  },
};

/**
 * THE SIGTERM->SIGKILL ESCALATION. `#h` sends SIGTERM, arms a `WKt` (1,500 ms)
 * backstop that process-group-SIGKILLs, and polls liveness every `zKt`
 * (100 ms) so a process that died of the TERM cancels the backstop. A child
 * that ignores SIGTERM is the only way the backstop ever fires, and the corpus
 * has none — every command it runs dies of the first signal.
 *
 * The trigger is the tool's own `timeout` rather than an interrupt, because a
 * timeout is a declaration in the tool call and an interrupt is a race against
 * the engine's dispatch (measured in `m3`'s interrupt scenario).
 */
const killPlan: ChildPlan = { bytes: 60, chunks: 20, everyMs: 600, ignoreTerm: true };

const killEscalation: Scenario = {
  tag: "bash-kill-escalation",
  title: "a timed-out Bash command whose child ignores SIGTERM",
  // Nothing may survive: the escalation exists precisely so that a child which
  // ignores SIGTERM is still gone. An empty declaration makes any survivor a
  // LEAK on the supervision surface.
  detachedChildren: [],
  run: (ctx) => {
    seedScriptedChild(SANDBOX);
    return drive(
      `Use the Bash tool to run exactly \`${childCommand(killPlan)}\` with the timeout parameter set to 1500. ` +
        `Then report what the tool told you, verbatim.`,
      { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 3, permissionMode: "bypassPermissions" },
    );
  },
  check: (msgs) => {
    const uses = toolUses(msgs, "Bash");
    if (uses.length === 0) return "Bash tool never used";
    if (!uses.some((u) => Number(u.input?.timeout) === 1_500)) {
      return `no Bash call declared timeout=1500 — inputs were ${JSON.stringify(uses.map((u) => u.input))}`;
    }
    if (!uses.some((u) => String(u.input?.command ?? "").includes("--ignore-term"))) {
      return "the recorded command does not carry --ignore-term, so the backstop was never needed";
    }
    const text = allText(msgs);
    if (!/timed out|killed|terminated/i.test(text)) return "nothing in the capture says the command was stopped";
    return null;
  },
};

export const W10_TIMED_SCENARIOS: TimedScenario[] = [
  {
    scenario: stallDetect,
    // `stall-poll` down from 5,000 and `stall-idle` down from 45,000. Both, and
    // only both: leaving the poll at 5 s would make a 1.8 s idle threshold
    // unobservable, because the detector cannot notice an idle file it does not
    // sample.
    timers: { "stall-poll": 400, "stall-idle": 1_800 },
    why: "the stall detector needs 45 s of unchanged output at this pin; the oracle is a compiled binary whose constants cannot be moved, so the pair is extracted-vs-strangled",
  },
  {
    scenario: killEscalation,
    // The backstop, from 1,500 ms down to 400 ms, and the liveness poll from
    // 100 ms to 40 ms so the cancel path still has several samples inside it —
    // a poll left at 100 ms inside a 400 ms window grades a coarser race than
    // the pinned one does.
    timers: { "sigterm-to-sigkill": 400, "post-kill-liveness-poll": 40 },
    why: "the escalation is only reachable with a child that ignores SIGTERM plus the backstop's full wait; the rewrite is of the graph's own bytes, which the oracle does not share",
  },
];
