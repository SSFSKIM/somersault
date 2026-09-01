// W6 corpus family — the permission-mode matrix (campaign spec C9 / §3.2's
// "permission-mode matrix, 6 modes x representative tools").
//
// THE COVERAGE PROBLEM THIS EXISTS TO FIX. Of the forty-five scenarios this wave
// inherited, twenty-two run `bypassPermissions` and two run `default`; no
// scenario has ever run `acceptEdits`, `plan`, `dontAsk` or `auto`, and none has
// ever carried a permission RULE. So the subsystem W6 owns was graded on one
// mode and one decision shape — an ask answered by an SDK host — and the six
// modes and three rule behaviours upstream's own schema enumerates were
// unexercised.
//
// THE AXES ARE NOT CHOSEN HERE. `research/fixtures/permission-surface-<pin>.json`
// derives them from the pinned bundle — six modes from four independent
// enumerations that must agree, three rule behaviours confirmed against the
// values the graph compares against, eleven decisionReason kinds read off the
// message builder's own switch — and the gate re-derives it every run. C8 was
// corrected twice for choosing a population by judgment; this wave does not.
//
// WHAT A RECORDING CAN AND CANNOT SETTLE. Two families are unrecordable here and
// are graded by `strangle/permissions-parity.test.ts` instead:
//
//   the REFUSALS. The rule checker answers `null` when nothing objects, and the
//     pre-check's thirteen-rung ladder produces the same transcript whether a
//     rung was evaluated and passed or never reached. A scenario cannot separate
//     them.
//   SOME OF the arms `auto` mode owns — and this entry has been corrected twice,
//     which is worth more than the entry. It first said the mode was gate-guarded
//     and therefore unreachable: `w6/probe-permissions.ts` measured it ACCEPTED
//     through both paths, because upstream's auto gate is three local conditions
//     and not a pinned feature flag. It then said the classifier could not run
//     here: the classifier makes its OWN API call, and the probe now counts those
//     — it ran, and it allowed. What a recording still cannot reach is the
//     classifier's BLOCK verdict (which needs an input this project has not
//     designed) and the transition arms nothing in the corpus moves into or out of
//     `auto` to render. The fail-closed arm below IS recorded.
//
// TWO OPERATIONAL TRAPS, inherited from C8's second boundary round and obeyed
// throughout this file:
//
//   a bare `allowedTools: ["Bash"]` entry SHADOWS `canUseTool` — the callback is
//     never consulted — so no scenario here names a tool it also wants brokered.
//   default mode auto-approves READ-ONLY shell commands without consulting the
//     broker at all, so `echo` measures nothing. `mkdir -p` is the cheapest
//     command that is not read-only, and it is what the Bash cells use.
//
// A third is obeyed by construction: every `canUseTool` here answers
// immediately, because an answer slower than 6000 ms fires a Notification hook
// frame (W5's condition, and not this wave's).
//
// RULE FIXTURES RIDE `Options.settings`. An inline settings object reaches the
// flag-settings layer with `settingSources: []` still in force, so nothing on
// the filesystem is read and W3's ancestor-directory trap does not apply. That
// is the seam C8 found for command hooks; permission rules are the same shape.
import { join } from "node:path";
import type { Options, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, drive, resultText, resultsOf, usedTool, type Scenario, type ScenarioContext } from "../src/harness.js";
import { classifierUnavailable } from "../src/faults.js";
import { SANDBOX } from "../src/runTurn.js";

/** The file every Write cell targets. Absolute and inside the sandbox, so a model-chosen path cannot escape. */
const TARGET = join(SANDBOX, "perm.txt");
/** The path a PermissionRequest hook rewrites a Write onto — the ask rule below names it. */
const REWRITTEN = join(SANDBOX, "rewritten.txt");

const writePrompt = (path: string) =>
  `Use the Write tool exactly once to create the file ${path} containing the single line REFORGE_W6. ` +
  `Do not use Bash and do not use any other tool. If the tool is denied, do not retry and do not try another approach; ` +
  `reply with exactly DENIED.`;

/**
 * `mkdir -p` rather than `echo`: default mode auto-approves read-only shell
 * commands WITHOUT consulting the broker, so a Bash cell built on `echo`
 * measures the auto-approval and not the permission chain.
 */
const MKDIR_PROMPT =
  "Use the Bash tool exactly once to run exactly `mkdir -p reforge-w6-dir`. Do not run anything else and do not use any other tool. " +
  "If the tool is denied, do not retry; reply with exactly DENIED.";

/**
 * `chmod` for the acceptEdits cell, and the reason is a MEASURED correction to
 * the mode's own prose.
 *
 * Upstream describes `acceptEdits` as "Auto-accept file edit operations", and
 * the obvious reading is that it covers the file TOOLS. It covers seven shell
 * commands as well — `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `sed` — which
 * the Bash tool's own mode handler auto-allows by base command. The fixture
 * carries that list (`acceptEditsBashCommands`), derived from the bundle like
 * every other axis. The first take of this scenario used `mkdir` and its
 * substance check correctly refused it: the Bash half was auto-approved too, so
 * the turn graded no asymmetry at all.
 *
 * `chmod` mutates (so default mode does not auto-approve it) and is not on the
 * accept-edits list, which is exactly the pair of properties this cell needs.
 */
const CHMOD_PROMPT =
  "Use the Bash tool exactly once to run exactly `chmod 600 perm.txt`. Do not run anything else and do not use any other tool. " +
  "If the tool is denied, do not retry; reply with exactly DENIED.";

/**
 * `echo` IS the point in one cell: it is the command default mode approves
 * without asking, so an ASK RULE that forces a prompt for it is the only way to
 * show a rule overriding an auto-approval.
 */
const ECHO_PROMPT =
  "Use the Bash tool exactly once to run exactly `echo REFORGE_W6_ECHO`. Do not run anything else and do not use any other tool. " +
  "If the tool is denied, do not retry; reply with exactly DENIED.";

/**
 * A file outside every allowed working directory. Absolute, tiny, and present on
 * any machine this project runs on.
 */
const OUTSIDE_CWD = "/etc/hosts";

const READ_OUTSIDE_PROMPT =
  `Use the Read tool exactly once on the file ${OUTSIDE_CWD}. Do not use any other tool. ` +
  "If the tool is denied, do not retry; reply with exactly DENIED.";

/**
 * THE MODE WALK'S PLAN TURN IS A READ, NOT A WRITE, and the substitution is a
 * measured correction rather than a convenience.
 *
 * Changing to plan makes the engine inject a system reminder that forbids edits
 * and declares itself to supersede every other instruction, and the model obeys
 * it against any framing: three takes aimed a Write at that turn and none of them
 * produced a tool call — the second answered, in as many words, that it would not
 * emit the call "regardless of how the request is framed". The refusal is the
 * ENGINE's behaviour (the reminder is the engine's own text), so no prompt is
 * going to buy a Write here. Aiming at the one file the reminder does sanction,
 * the plan file, gets the call but not a usable cell: the engine names that file
 * with a per-session random word, so a replay looks it up under a different name
 * than the recorded response wrote, and two requests miss their body hash.
 *
 * What the reminder DOES permit is read-only work — and a read outside the
 * allowed directories is ask-worthy, so it is a decision and not a formality.
 * Measured, in `w6/probe-permissions.ts` phase `working-dir`: in default mode the
 * same call reaches `canUseTool` carrying "Path is outside allowed working
 * directories" and two suggestions, and `perm-working-dir` records that half.
 * Here the launch fact makes the bypass rung answer above it and the read simply
 * succeeds, which is the asymmetry this turn is for.
 */
const PLAN_TURN_PROMPT = READ_OUTSIDE_PROMPT;

/** A settings-layer permission-rule fixture, in the flag-settings layer. */
const rules = (spec: Partial<Record<"allow" | "deny" | "ask", string[]>>) => ({ permissions: spec }) as Options["settings"];

/**
 * A broker that records every consult and allows.
 *
 * The projection is deliberately narrow: the harness diffs the event surface, so
 * a payload carrying a tool_use id or a request id would differ between two
 * replays of the same cassette for reasons that have nothing to do with the
 * permission decision. What is graded is the DECISION's own shape — which tool
 * was asked about, why the engine says it is asking, and whether a user rule
 * forced the prompt.
 */
const broker = (
  ctx: ScenarioContext,
  decide?: (tool: string, input: Record<string, unknown>) => { behavior: "deny"; message: string } | null,
  /**
   * Answer this many milliseconds late.
   *
   * Only the two PermissionRequest-hook cells use it, and they must: the engine
   * RACES the hook dispatch against the host's `canUseTool`, and both are
   * control-channel round trips, so an immediate broker wins often enough that
   * the hook's decision never lands. Being consulted is not the same as
   * deciding — the first take of those two cells asserted the former and
   * measured nothing.
   *
   * Well under the 6000 ms notify timer, so no Notification frame is armed
   * (W5's trap, and not this wave's condition to create).
   */
  delayMs = 0,
) =>
  async (toolName: string, input: Record<string, unknown>, opts: Record<string, unknown>) => {
    ctx.collect("consult", {
      toolName,
      decisionReason: opts.decisionReason ?? null,
      matchedAskRule: (opts.matchedAskRule as { source?: string; toolName?: string; ruleContent?: string } | undefined) ?? null,
      blockedPath: opts.blockedPath ?? null,
      suggestions: Array.isArray(opts.suggestions) ? (opts.suggestions as PermissionUpdate[]).length : 0,
    });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const refusal = decide?.(toolName, input);
    if (refusal) return refusal;
    return { behavior: "allow" as const, updatedInput: input };
  };

/** How long the two hook cells make the host wait, so the hook's decision can land. */
const HOOK_RACE_DELAY_MS = 1500;

/**
 * Whether the session's init frame OFFERED the tool at all — the non-vacuity
 * guard every rule cell needs.
 *
 * A whole-tool deny rule is applied by removing the tool from the session, not
 * by refusing it at decision time, so a rule cell built on one produces a
 * transcript that looks exactly like a denial (tool attempted, no consult, no
 * effect) while the permission chain never runs. Two of this wave's cells were
 * written that way and passed; the branch attestation is what caught them. Any
 * cell whose subject is the RULE ENGINE has to assert the tool survived the
 * filter first.
 */
const toolOffered = (msgs: unknown[], tool: string): boolean =>
  msgs.some((m) => {
    const f = m as { type?: string; subtype?: string; tools?: unknown };
    return f.type === "system" && f.subtype === "init" && Array.isArray(f.tools) && f.tools.includes(tool);
  });

/** Every `{type:"system",subtype:"permission_denied"}` frame in a transcript, projected. */
const denials = (msgs: unknown[]) =>
  msgs
    .filter((m) => (m as { type?: string; subtype?: string }).type === "system" && (m as { subtype?: string }).subtype === "permission_denied")
    .map((m) => m as { tool_name?: string; decision_reason_type?: string; message?: string });

/**
 * The text of every `tool_result` block in the transcript.
 *
 * The permission subsystem's messages reach a MODEL through here and nowhere
 * else: a denied tool call's result content is the sentence the decision carried.
 * Reading the model's prose instead would grade the model's paraphrase.
 */
const toolResultBlocks = (msgs: unknown[]): { text: string; isError: boolean }[] => {
  const out: { text: string; isError: boolean }[] = [];
  for (const m of msgs) {
    const content = (m as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as { type?: string; content?: unknown; is_error?: boolean }[]) {
      if (block?.type !== "tool_result") continue;
      out.push({ text: typeof block.content === "string" ? block.content : JSON.stringify(block.content), isError: block.is_error === true });
    }
  }
  return out;
};

const toolResults = (msgs: unknown[]): string[] => toolResultBlocks(msgs).map((b) => b.text);

const consults = (events: unknown[]) =>
  events.filter((e) => (e as { event?: string }).event === "consult").map((e) => (e as { payload: Record<string, unknown> }).payload);

/**
 * Split a multi-turn transcript at its `result` frames, so a check can ask what
 * ONE turn did.
 *
 * A whole-transcript `usedTool` cannot enforce a per-turn design rule, and the
 * one scenario in this file that has such a rule was passing without it: the
 * mode walk requires a tool call after EVERY mode change, and its check asked
 * only whether a Write appeared anywhere — so a recording in which the plan turn
 * emitted no tool call at all satisfied it on the strength of the dontAsk turn's
 * Write. That is precisely the hollow pass the walk's own comment says it exists
 * to prevent, one level up: the design rule was written down and then graded by
 * an assertion too coarse to see it.
 *
 * The frames of turn *n* are those between result *n-1* and result *n*, result
 * frame included, which is what makes `denialsIn` below answer "did THIS turn
 * refuse" rather than "did the session ever refuse".
 */
const turnsOf = (msgs: unknown[]): unknown[][] => {
  const out: unknown[][] = [];
  let current: unknown[] = [];
  for (const m of msgs) {
    current.push(m);
    if ((m as { type?: string }).type === "result") {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
};

export const W6_SCENARIOS: Scenario[] = [
  {
    // MODE CELL: acceptEdits x {Write, Bash}. Upstream's own semantics for the
    // mode are "Auto-accept file edit operations" — so the claim under test is
    // asymmetric, and one turn tests both halves: the Write must NOT reach the
    // broker and the Bash MUST. A scenario that only wrote a file would pass on
    // an engine that auto-accepted everything.
    //
    // The Bash half is `chmod`, not `mkdir`, and the first take is why: the mode
    // auto-allows seven file-mutating SHELL commands as well as the file tools
    // (`acceptEditsBashCommands` in the permission-surface fixture), so a `mkdir`
    // was auto-approved and the turn graded no asymmetry. The substance check
    // caught it, which is what a substance check is for.
    tag: "perm-accept-edits",
    title: "acceptEdits auto-accepts the Write and still brokers the Bash",
    run: (ctx) =>
      drive(
        `First use the Write tool exactly once to create ${TARGET} containing the single line REFORGE_W6. ` +
          "Then use the Bash tool exactly once to run exactly `chmod 600 perm.txt`. Do not combine them and do not use any other tool. " +
          "When both are done, reply with exactly BOTH_DONE.",
        { ...baseOptions(ctx), maxTurns: 6, permissionMode: "acceptEdits", canUseTool: broker(ctx) },
      ),
    check: (msgs, events) => {
      const asked = consults(events).map((c) => c.toolName);
      if (!usedTool(msgs, "Write")) return "the Write was never attempted";
      if (!usedTool(msgs, "Bash")) return "the Bash was never attempted";
      if (asked.includes("Write")) return "acceptEdits consulted the broker for a file edit — the mode's whole claim is that it does not";
      if (!asked.includes("Bash")) return "the Bash was not brokered, so this scenario grades no permission decision at all";
      return null;
    },
  },

  {
    // MODE CELL: plan x Write, and it is a CORRECTION to the mode's own prose.
    //
    // Upstream describes `plan` as "Planning mode, no actual tool execution",
    // and this cell was written to the obvious reading of that: the decision must
    // not be an allow, and the file must not exist afterwards. The recording says
    // otherwise, and the second half of that claim was graded by nothing — which
    // is how it survived being wrong.
    //
    // WHAT THE RECORDING SHOWS. The Write reached the broker with
    // `decisionReason: null`, the broker allowed, and `perm.txt` was created. The
    // pre-check explains it exactly: its plan-mode refusal (`Cannot call ${name}
    // while in plan mode`) is guarded on `e.mcpInfo`, so it is an MCP-tool rung
    // and a built-in file tool never reaches it. `Write.checkPermissions` returns
    // a plain `passthrough` under plan, the ladder converts that to an ASK with
    // no reason attached, and the ask goes to the host.
    //
    // So plan mode does not enforce "no tool execution" in the permission chain
    // at all. In an interactive session a human declines the prompt; headless,
    // the model is steered by the plan-mode system reminder the engine injects
    // ("you MUST NOT make any edits… This supercedes any other instructions"),
    // and a host that answers `allow` gets the write. That reminder is a MODEL
    // instruction, not a decision, which is why this cell grades the decision.
    //
    // The claim under test is therefore the one the recording can settle: plan
    // mode DELEGATES a Write it neither allows nor denies. An engine that
    // short-circuited plan mode to an allow would skip the consult and reach the
    // same file; an engine that hard-refused would produce a denial frame. Both
    // are excluded here.
    tag: "perm-plan-mode",
    title: "plan mode delegates a Write to the host rather than deciding it",
    run: (ctx) => drive(writePrompt(TARGET), { ...baseOptions(ctx), maxTurns: 4, permissionMode: "plan", canUseTool: broker(ctx) }),
    check: (msgs, events) => {
      if (!usedTool(msgs, "Write")) return "the Write was never attempted, so plan mode decided nothing";
      const consult = consults(events).find((c) => c.toolName === "Write");
      if (!consult) return "plan mode did not broker the Write — an engine that decided it itself, which is not what upstream does";
      if (consult.decisionReason !== null) {
        return `the consult carries decisionReason ${JSON.stringify(consult.decisionReason)}; plan mode reaches the host through the ladder's passthrough conversion, which attaches none`;
      }
      if (denials(msgs).some((d) => d.tool_name === "Write")) return "plan mode produced a denial frame — it delegates rather than refusing";
      return null;
    },
  },

  {
    // MODE CELL: dontAsk x Write. "Don't prompt for permissions, deny if not
    // pre-approved" — the one mode whose refusal is TERMINAL: no broker consult,
    // a `permission_denied` frame, and a decision reason naming the mode itself.
    tag: "perm-dont-ask",
    title: "dontAsk denies a Write outright, without consulting the broker",
    run: (ctx) => drive(writePrompt(TARGET), { ...baseOptions(ctx), maxTurns: 4, permissionMode: "dontAsk", canUseTool: broker(ctx) }),
    check: (msgs, events) => {
      if (!usedTool(msgs, "Write")) return "the Write was never attempted";
      if (consults(events).some((c) => c.toolName === "Write")) return "dontAsk consulted the broker — the mode exists to not";
      const denial = denials(msgs).find((d) => d.tool_name === "Write");
      if (!denial) return "no permission_denied frame for the Write";
      if (denial.decision_reason_type !== "mode") {
        return `the denial's decision_reason_type is ${JSON.stringify(denial.decision_reason_type)}, not "mode" — a different arm decided it`;
      }
      return null;
    },
  },

  {
    // RULE CELL: a DENY rule, in default mode, with a broker that would allow.
    // The rule must win, and it must win BEFORE the broker is consulted — which
    // is the pre-check's ladder and the ordering claim the whole chain rests on.
    //
    // THE RULE IS COMMAND-SCOPED, and that is not a detail. The first take used
    // `deny: ["Write"]` and passed every check it was given: the Write was
    // attempted, the broker was not consulted, the file was not written. The
    // BRANCH ATTESTATION is what caught it — the pre-check's deny rungs had not
    // executed once across the whole corpus. A WHOLE-TOOL deny rule is applied by
    // REMOVING the tool from the session (upstream filters the tool list on the
    // same matcher), so the model got "No such tool available: Write" and the
    // permission chain never ran at all. Twenty-four tools in that session's init
    // frame instead of twenty-five.
    //
    // A command-scoped rule survives the filter, so the call reaches the chain
    // and is refused at the ladder's input-deny rung. The general form is the
    // one this wave kept learning: A PASSING CHECK IS NOT COVERAGE. Only an
    // inventory of the OWNED code can tell you which rung decided.
    tag: "perm-rule-deny",
    title: "a deny rule beats a broker that would have allowed",
    run: (ctx) =>
      drive(CHMOD_PROMPT, {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "default",
        settings: rules({ deny: ["Bash(chmod:*)"] }),
        canUseTool: broker(ctx),
      }),
    // MEASURED, and it corrects the reading the whole-tool take left behind. A
    // rule denial DOES produce a `permission_denied` frame once it reaches the
    // chain, and the frame's `decision_reason_type` is `subcommandResults` rather
    // than `rule`: the Bash tool decomposes its command, decides per part, and
    // reports the AGGREGATE, so the rule that did the work is nested one level
    // down. That is a reason kind §3.3 of the matrix had listed as OPEN, and this
    // cell is what fires it.
    check: (msgs, events) => {
      if (!toolOffered(msgs, "Bash")) return "Bash was filtered out of the session, so this cell grades the tool filter and not the rule engine";
      if (!usedTool(msgs, "Bash")) return "the Bash call was never attempted";
      if (consults(events).some((c) => c.toolName === "Bash")) return "the broker was consulted despite a matching deny rule";
      const denial = denials(msgs).find((d) => d.tool_name === "Bash");
      if (!denial) return "no permission_denied frame for the denied Bash call";
      if (denial.decision_reason_type !== "subcommandResults") {
        return `the denial's decision_reason_type is ${JSON.stringify(denial.decision_reason_type)}, not the aggregate "subcommandResults" the Bash tool reports`;
      }
      if (!resultText(msgs).includes("DENIED")) return "the model does not report a denial, so the deny rule may not have bitten";
      return null;
    },
  },

  {
    // RULE CELL: a WHOLE-TOOL allow rule, in default mode.
    //
    // The whole-tool part is the measurement. The first take used a CONTENT rule
    // (`Bash(mkdir:*)`), the broker was correctly not consulted, and solo
    // sabotage of the allow-rule decision stayed green — because a content rule
    // is matched by the TOOL's own `checkPermissions`, not by the pre-check's
    // allow-rule rung. Only a whole-tool rule reaches the rung, and only the rung
    // reaches the function this cell exists to cover.
    tag: "perm-rule-allow",
    title: "a whole-tool allow rule reaches the allow-rule decision",
    run: (ctx) =>
      drive(writePrompt(TARGET), {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "default",
        settings: rules({ allow: ["Write"] }),
        canUseTool: broker(ctx),
      }),
    check: (msgs) => {
      if (!usedTool(msgs, "Write")) return "the Write was never attempted";
      if (denials(msgs).length > 0) return "the allow rule produced a denial";
      if (resultText(msgs).includes("DENIED")) return "the model reports the Write was denied despite a whole-tool allow rule";
      return null;
    },
  },

  {
    // RULE CELL: an ASK rule, on a command default mode approves WITHOUT asking.
    // The only way to show a user rule overriding an auto-approval, and the only
    // scenario in the corpus where the broker's `matchedAskRule` field is
    // populated at all — the SDK documents it as "this prompt was rule-forced",
    // and a host makes policy on it.
    tag: "perm-rule-ask",
    title: "an ask rule forces a prompt for a command default mode would auto-approve",
    run: (ctx) =>
      drive(ECHO_PROMPT, {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "default",
        settings: rules({ ask: ["Bash(echo:*)"] }),
        canUseTool: broker(ctx),
      }),
    // MEASURED: the consult arrives WITHOUT `matchedAskRule`, and that is
    // upstream's behaviour rather than a defect. The pre-check's ask-rule rung
    // has two arms — it ANNOTATES a decision the tool was already asking about
    // (`{...decision, matchedAskRule}`) and it CREATES one when the tool passed
    // through (`{behavior:"ask", decisionReason:{type:"rule", rule}}`, with no
    // annotation). `echo` passes through, so this cell takes the second arm. The
    // first take asserted the field and failed; the annotating arm needs a tool
    // that asks for its own reason AND a matching ask rule, and it is graded by
    // `strangle/permissions-parity.test.ts` instead.
    //
    // What this cell grades is the override itself, which nothing else can: a
    // command default mode approves WITHOUT the broker was brokered anyway.
    check: (msgs, events) => {
      if (!usedTool(msgs, "Bash")) return "the Bash call was never attempted";
      const consult = consults(events).find((c) => c.toolName === "Bash");
      if (!consult) return "the ask rule did not force a broker consult — this cell grades nothing without one";
      return null;
    },
  },

  {
    // THE CONTROL THAT IS NOT A CONTROL. The campaign spec and the W5-W7 scout
    // both say `bypassPermissions` short-circuits the rule engine, so a deny rule
    // under bypass should do nothing. Reading upstream's pre-check says the
    // opposite: the bypass arm sits BELOW the deny rules, the allow rules, the
    // tool's own check and the ask rules, so a deny rule still bites.
    //
    // This scenario is what settles it, and it is worth having whichever way it
    // lands: either it records the short-circuit the spec claims, or it records
    // the correction. `w6/probe-permissions.ts` measured it live first.
    //
    // COMMAND-SCOPED for the same reason as the deny cell above: a whole-tool
    // deny rule never reaches the chain, because upstream applies it by removing
    // the tool from the session. Under bypass that would have been the emptiest
    // possible cell — a mode that skips the ask, tested against a rule the mode
    // never sees.
    tag: "perm-bypass-deny-rule",
    title: "bypassPermissions meets a deny rule",
    run: (ctx) =>
      drive(CHMOD_PROMPT, {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "bypassPermissions",
        settings: rules({ deny: ["Bash(chmod:*)"] }),
      }),
    // MEASURED: the rule bites. Under `bypassPermissions`, with no broker armed
    // at all, the command-scoped deny rule still produced a `permission_denied`
    // frame — which is §2's correction stated by a recording rather than by a
    // reading of the bytes.
    check: (msgs) => {
      if (!toolOffered(msgs, "Bash")) return "Bash was filtered out of the session, so this cell grades the tool filter and not the rule engine";
      if (!usedTool(msgs, "Bash")) return "the Bash call was never attempted, so nothing was decided under bypass";
      if (!denials(msgs).some((d) => d.tool_name === "Bash")) return "bypass short-circuited the deny rule — no denial frame, contrary to the pre-check's rung order";
      if (!resultText(msgs).includes("DENIED")) return "bypass appears to have short-circuited the deny rule — the model does not report a denial";
      return null;
    },
  },

  {
    // THE HOOK PATH, and the only scenario that reaches the RULE CHECKER at all.
    //
    // A PermissionRequest hook allows the Write with a REWRITTEN path, which
    // upstream treats as a different tool call and re-checks against the rules.
    // An ask rule names the rewritten path, so the re-check objects with an ASK —
    // and because a hook has already answered there is nobody left to ask, so the
    // engine converts it to a DENY carrying the rule checker's own sentence.
    //
    // That sentence is the message builder's output, which is why this one
    // scenario covers three splices no other can: the rule checker, its ask-rule
    // arm, and the message builder whose forty-five call sites are otherwise all
    // internal.
    tag: "perm-hook-rewrite",
    title: "a PermissionRequest hook rewrites a Write onto a path an ask rule names",
    run: (ctx) =>
      drive(writePrompt(TARGET), {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "default",
        settings: rules({ ask: ["Write(*)", "Write(**)", "Write(rewritten.txt)", `Write(//${REWRITTEN})`] }),
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                async (input: unknown) => {
                  const record = input as { tool_name?: string; tool_input?: Record<string, unknown> };
                  ctx.collect("permissionRequestHook", { toolName: record.tool_name });
                  if (record.tool_name !== "Write") return { continue: true };
                  // The SHAPE is `hookSpecificOutput.decision`, and the first
                  // take of this scenario got it wrong: a hook that returns a
                  // `permissionRequestResult` key fires, is parsed, and has its
                  // decision silently ignored — the scenario passed its substance
                  // check (the hook DID fire) while grading nothing, and solo
                  // sabotage of the rule checker stayed green. A hook whose
                  // output shape is wrong is indistinguishable from a hook with
                  // no opinion.
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: "PermissionRequest",
                      decision: { behavior: "allow", updatedInput: { ...record.tool_input, file_path: REWRITTEN } },
                    },
                  } as never;
                },
              ],
            },
          ],
        },
        canUseTool: broker(ctx, undefined, HOOK_RACE_DELAY_MS),
      }),
    // THE CHECK READS THE TOOL_RESULT, not the model's reply, and getting there
    // took four takes — each of which passed or failed for a reason that was not
    // the cell's claim, which is itself the finding.
    //
    //   1. asserted the hook FIRED. Passes on an engine that parses the hook's
    //      output and ignores its decision — which is what the first take DID,
    //      because the output shape is `hookSpecificOutput.decision` and the
    //      scenario used a `permissionRequestResult` key.
    //   2. asserted the broker was not CONSULTED. Fails on a race the engine is
    //      entitled to win either way; being consulted is not deciding.
    //   3. asserted the MODEL said DENIED. Passed while the rewritten file was
    //      written anyway — the model paraphrased, and an ask rule naming a bare
    //      absolute path never matched.
    //   4. asserted the message builder's `rule` sentence. The rule DID match
    //      this time and the write WAS refused, and the sentence is the Write
    //      tool's own: the rule checker's ask-rule rung has two arms, and when
    //      the tool is already asking it ANNOTATES that decision rather than
    //      building a new one, so the builder is never called.
    //
    // What the cell actually grades, and it is the claim it was written for: a
    // hook's rewritten input is RE-CHECKED against the rules, and an objection
    // there overturns the hook's allow. The evidence is the refusal reaching the
    // model for the REWRITTEN path — a path the model never asked to write.
    check: (msgs) => {
      if (!usedTool(msgs, "Write")) return "the Write was never attempted";
      const refusal = toolResults(msgs).find((r) => r.includes("permissions") && r.includes("rewritten.txt"));
      if (!refusal) {
        return `no tool_result refuses the rewritten path, so the re-check did not object (results: ${JSON.stringify(toolResults(msgs)).slice(0, 220)})`;
      }
      return null;
    },
  },

  {
    // THE HOOK'S OWN DENY, which is a different arm from the rewrite: no
    // re-check, no rule lookup, the hook's message and its interrupt flag
    // straight through. It also races the broker, and the hook is expected to
    // win — the broker here would have ALLOWED, so a consult that decided the
    // call would show up as a written file.
    tag: "perm-hook-deny",
    title: "a PermissionRequest hook denies before the broker can allow",
    run: (ctx) =>
      drive(writePrompt(TARGET), {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "default",
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                async (input: unknown) => {
                  const record = input as { tool_name?: string };
                  ctx.collect("permissionRequestHook", { toolName: record.tool_name });
                  if (record.tool_name !== "Write") return { continue: true };
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: "PermissionRequest",
                      decision: { behavior: "deny", message: "reforge W6: denied by the PermissionRequest hook" },
                    },
                  } as never;
                },
              ],
            },
          ],
        },
        canUseTool: broker(ctx, undefined, HOOK_RACE_DELAY_MS),
      }),
    check: (msgs, events) => {
      if (!events.some((e) => (e as { event?: string }).event === "permissionRequestHook")) return "the PermissionRequest hook never fired";
      if (!usedTool(msgs, "Write")) return "the Write was never attempted";
      const denial = toolResults(msgs).find((r) => r.includes("reforge W6: denied by the PermissionRequest hook"));
      if (!denial) {
        return `no tool_result carries the hook's own deny message, so the hook's decision did not take (results: ${JSON.stringify(toolResults(msgs)).slice(0, 200)})`;
      }
      return null;
    },
  },

  {
    // THE BROKER'S PERMISSION UPDATES. `canUseTool` may return
    // `updatedPermissions`, which the engine FILTERS, applies to the session and
    // persists. Nothing in the corpus has ever returned one, so the filter and
    // both of its write paths were graded by nothing.
    //
    // Two calls in one turn: the first grants `Bash(mkdir:*)` for the session
    // while allowing, the second must then run WITHOUT a consult — which is the
    // only observable proof that the grant was applied rather than accepted and
    // dropped.
    tag: "perm-broker-updates",
    title: "canUseTool grants a session permission, and the next call is not brokered",
    run: (ctx) => {
      let granted = 0;
      return drive(
        "Use the Bash tool exactly once to run exactly `mkdir -p reforge-w6-a`. Then use the Bash tool exactly once more to run exactly " +
          "`mkdir -p reforge-w6-b`. Do not combine them and do not use any other tool. When both are done, reply with exactly BOTH_DONE.",
        {
          ...baseOptions(ctx),
          maxTurns: 6,
          permissionMode: "default",
          canUseTool: async (toolName, input) => {
            granted++;
            ctx.collect("consult", { toolName, nth: granted });
            return {
              behavior: "allow" as const,
              updatedInput: input,
              updatedPermissions: [
                { type: "addRules" as const, rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" as const, destination: "session" as const },
              ],
            };
          },
        },
      );
    },
    check: (msgs, events) => {
      const asked = consults(events);
      if (asked.length === 0) return "the broker was never consulted, so no permission update was ever offered";
      if (!usedTool(msgs, "Bash")) return "no Bash call was attempted";
      if (asked.length > 1) return `the session grant did not take: the broker was consulted ${asked.length} times for the same rule`;
      return null;
    },
  },

  {
    // THE `workingDir` decisionReason, which §3.3 of the matrix carried as OPEN
    // with the condition "a tool call outside the allowed directories" and no run
    // behind it. It costs one scenario.
    //
    // A READ rather than a write, deliberately: the point is the DIRECTORY
    // boundary, and a read isolates it from every other reason a mutation could
    // be asked about. The reason arrives as the ladder's own sentence — "Path is
    // outside allowed working directories" — together with the two permission
    // suggestions the engine offers for widening the boundary, which no other
    // cell in the corpus populates either.
    //
    // `settingSources: []` is what makes the condition hold: nothing on the
    // filesystem adds an `additionalDirectories`, so the sandbox cwd is the whole
    // allowed set and any absolute path outside it is outside all of them.
    tag: "perm-working-dir",
    title: "a read outside the allowed directories is asked about, and the reason names the boundary",
    run: (ctx) => drive(READ_OUTSIDE_PROMPT, { ...baseOptions(ctx), maxTurns: 4, permissionMode: "default", canUseTool: broker(ctx) }),
    check: (msgs, events) => {
      if (!usedTool(msgs, "Read")) return "the Read was never attempted";
      const consult = consults(events).find((c) => c.toolName === "Read");
      if (!consult) return "the read outside the cwd did not reach the broker, so the working-directory boundary decided nothing";
      if (!String(consult.decisionReason ?? "").includes("outside allowed working directories")) {
        return `the consult's decisionReason is ${JSON.stringify(consult.decisionReason)}, which does not name the working-directory boundary`;
      }
      if ((consult.suggestions as number) === 0) return "the consult carried no permission suggestions, and the workingDir arm builds them";
      return null;
    },
  },

  {
    // THE `auto` MODE'S CLASSIFIER, and the two cells nothing else in the corpus
    // could reach.
    //
    // `auto` decides by ASKING A MODEL. Measured on the wire (the probe's
    // `auto-classifier` phase, cassette kept): a `chmod` under `auto` produces a
    // second `/v1/messages` call — toolless, non-streaming, stopping at
    // `</severity>` — which came back `<severity>25`, below the block threshold,
    // so the call was allowed and `canUseTool` was never consulted. THAT IS THE
    // TRAP THIS CELL EXISTS PAST: from the broker's seat, a classifier that ran
    // and allowed is indistinguishable from a fast path that skipped it, and the
    // wave's first reading of this mode drew the wrong conclusion from exactly
    // that silence.
    //
    // What no prompt reliably creates is a classifier that REFUSES, and the
    // `classifier` decisionReason has two producers: the block verdict, and the
    // FAIL-CLOSED arm beneath it — upstream denies with
    // `{type:"classifier", classifier:"auto-mode"}` when the classifier call is
    // unavailable. The second is reachable with a harmless command, by choosing
    // the classifier's own response (`recordInject`, and see `src/faults.ts` for
    // why the status is a 400 rather than something more realistic).
    //
    // Three things this buys that nothing else in the corpus does:
    //
    //   the `classifier` decisionReason, in a RECORDING rather than the oracle;
    //   the PermissionDenied hook event, whose sole dispatch site is guarded on
    //     that exact reason — C8 left it OPEN and C9's first round left it OPEN
    //     with better evidence, and this is the condition both were naming;
    //   the auto-mode arm of the pre-check, under a real classifier answer.
    tag: "perm-auto-classifier-deny",
    title: "an unavailable auto-mode classifier denies fail-closed, and that denial is what dispatches PermissionDenied",
    recordInject: classifierUnavailable,
    run: (ctx) =>
      drive(
        "Use the Bash tool exactly once to run exactly `chmod 600 perm.txt`. Do not run anything else and do not use any other tool. " +
          "If the tool is denied, do not retry; reply with exactly DENIED.",
        {
          ...baseOptions(ctx),
          maxTurns: 4,
          permissionMode: "auto",
          canUseTool: broker(ctx),
          hooks: {
            PermissionDenied: [
              {
                hooks: [
                  async (input: unknown) => {
                    const record = input as { tool_name?: string; reason?: string };
                    ctx.collect("permissionDeniedHook", { toolName: record.tool_name, reason: record.reason });
                    return { continue: true };
                  },
                ],
              },
            ],
          },
        },
      ),
    check: (msgs, events) => {
      if (!usedTool(msgs, "Bash")) return "the Bash call was never attempted, so the classifier was never asked about anything";
      if (consults(events).some((c) => c.toolName === "Bash")) {
        return "the broker was consulted — the fail-closed arm denies outright, so a consult means the classifier's answer was not the deciding one";
      }
      const denial = denials(msgs).find((d) => d.tool_name === "Bash");
      if (!denial) return "no permission_denied frame: the classifier's unavailability did not fail closed";
      if (denial.decision_reason_type !== "classifier") {
        return `the denial's decision_reason_type is ${JSON.stringify(denial.decision_reason_type)}, not "classifier" — a different arm decided it`;
      }
      const fired = events.filter((e) => (e as { event?: string }).event === "permissionDeniedHook");
      if (fired.length === 0) return "the PermissionDenied hook did not fire on a denial carrying the reason its dispatch site is guarded on";
      return null;
    },
  },

  {
    // THE MODE-CHANGE SEAM, over the control channel rather than at spawn — the
    // two paths reach different code, and this is the one the guard lives on.
    //
    // EVERY MODE CHANGE HERE IS FOLLOWED BY A TOOL CALL, and that is the whole
    // design. The first draft walked four modes and then said READY, and solo
    // sabotage measured all three of the seam's splices INERT on it: a session
    // can be told to change mode, believe it did, apply none of the transition's
    // side effects, and produce a byte-identical transcript — as long as nothing
    // afterwards asks it to decide anything. C8's lesson one subsystem over
    // ("check that your own options did not switch the subsystem off") has a
    // sibling here: check that the turn after the change asks the subsystem a
    // question.
    //
    // So the walk is chosen for the DECISIONS it changes, not for the modes it
    // visits:
    //
    //   launch bypassPermissions   the flag is a launch fact, and the transition
    //     (with the flag)          is the only thing that carries it forward
    //   -> plan, then a Write      ALLOWED, with no broker consult — the bypass
    //                              rung's SECOND disjunct, which nothing else in
    //                              the corpus reaches: `F === "bypassPermissions"
    //                              || F === "plan" && isBypassPermissionsModeAvailable`
    //                              returns `{behavior:"allow", decisionReason:
    //                              {type:"mode", mode:"plan"}}`. `perm-plan-mode`
    //                              is the control — same mode, no launch flag,
    //                              and there the Write is delegated to the host
    //                              instead. A transition that rebuilt the context
    //                              rather than carrying it forward loses the
    //                              launch fact, and this cell becomes that ask.
    //   -> dontAsk, then a Write   DENIED, with a decision reason naming the
    //                              mode. A setter that reported success without
    //                              applying anything would still be in plan here
    //                              and would allow it.
    //   -> a mode that does not    the guard's first refusal, surfaced by the SDK
    //      parse                   as a rejected promise carrying the error
    //                              envelope's own sentence.
    //
    // THE PLAN TURN'S PROMPT IS NOT THE ORDINARY ONE, and the reason is a
    // measured re-record. Changing to plan makes the engine inject a plan-mode
    // system reminder — "you MUST NOT make any edits … This supercedes any other
    // instructions you have received" — and under it the model answered DENIED
    // without ever emitting the Write. The turn then decided nothing, and the
    // check, which asked only whether a Write appeared ANYWHERE, passed on the
    // dontAsk turn's. The prompt below names the tool call as the object of the
    // turn rather than the edit as a goal, which is what gets past a reminder
    // that forbids edits; the per-turn check below is what would have caught it.
    tag: "perm-mode-walk",
    title: "set_permission_mode changes what the next tool call decides, twice, and then refuses a mode that does not parse",
    run: async (ctx) => {
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      const { pushable, userMessage } = await import("../src/harness.js");
      const input = pushable<ReturnType<typeof userMessage>>();
      const messages: unknown[] = [];
      input.push(userMessage("Reply with exactly READY."));
      const q = sdk.query({
        prompt: input,
        // NO BROKER, and the attempt to arm one is why it is worth saying so. A
        // host would have made "the plan turn was never consulted" into evidence
        // — but the SDK refuses to wire `canUseTool` at all for a session
        // LAUNCHED in bypassPermissions (it warns as much), and the later change
        // to plan does not re-wire it. The absence of a consult here is therefore
        // a property of the seam, not of the decision, and asserting it would
        // grade nothing. `perm-working-dir` is where the same call meets a host.
        options: { ...baseOptions(ctx), maxTurns: 8, permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true },
      });
      const turns = [PLAN_TURN_PROMPT, writePrompt(join(SANDBOX, "dont-ask.txt"))];
      let results = 0;
      for await (const m of q) {
        messages.push(m);
        if ((m as { type?: string }).type !== "result") continue;
        results++;
        if (results === 1) {
          await q.setPermissionMode("plan");
          ctx.collect("setPermissionMode", { mode: "plan", accepted: true });
          input.push(userMessage(turns[0]));
          continue;
        }
        if (results === 2) {
          await q.setPermissionMode("dontAsk");
          ctx.collect("setPermissionMode", { mode: "dontAsk", accepted: true });
          input.push(userMessage(turns[1]));
          continue;
        }
        let refused: string | null = null;
        try {
          await q.setPermissionMode("reforge-not-a-mode" as never);
        } catch (e) {
          refused = (e as Error).message;
        }
        ctx.collect("setPermissionMode", { mode: "reforge-not-a-mode", accepted: refused === null, refusedWithMessage: refused !== null });
        input.end();
      }
      return messages;
    },
    // PER TURN, not per transcript. The design rule this scenario is built on is
    // "every mode change is followed by a tool call"; the first version of this
    // check asked `usedTool(msgs, "Write")` over the whole run, which one Write
    // in one turn satisfies no matter how many changes went ungraded. The
    // recording it passed had no tool call in the plan turn at all.
    check: (msgs, events) => {
      const setters = events
        .filter((e) => (e as { event?: string }).event === "setPermissionMode")
        .map((e) => (e as { payload: Record<string, unknown> }).payload);
      if (setters.length !== 3) return `expected three mode changes, saw ${setters.length}`;
      const bad = setters[2];
      if (bad.accepted !== false) return "the guard ACCEPTED a mode that does not parse — its first refusal did not fire";
      if (bad.refusedWithMessage !== true) return "the refusal carried no message, so the error envelope's payload is ungraded";

      const turns = turnsOf(msgs);
      if (turns.length < 3) return `expected at least three turns (READY, plan, dontAsk), saw ${turns.length}`;
      const [, planTurn, dontAskTurn] = turns;

      // The plan turn: a Read outside the allowed directories, ALLOWED by the
      // bypass rung's second disjunct — so no denial, no error, and no broker
      // consult. `perm-working-dir` is the control that makes each half mean
      // something: the same call in default mode reaches the host carrying "Path
      // is outside allowed working directories".
      if (!usedTool(planTurn, "Read")) return "the plan turn emitted no tool call, so the change to plan decided nothing";
      if (denials(planTurn).length > 0) {
        return `the plan turn was DENIED (${JSON.stringify(denials(planTurn).map((d) => d.decision_reason_type))}); with bypass available the pre-check allows, so the transition lost the launch fact`;
      }
      // The transcript's own evidence that the call RAN. Any error result fails
      // it, not just one that says "permission": an earlier take of this scenario
      // passed a narrower version of this assertion while its tool call was
      // failing on replay for an unrelated reason. A cell that grades an ALLOW has
      // to insist the call SUCCEEDED, or a broken call reads as a permitted one.
      const planResults = toolResultBlocks(planTurn);
      if (planResults.length === 0) return "the plan turn's Read produced no tool_result, so nothing came back to grade";
      const failed = planResults.find((r) => r.isError);
      if (failed) return `the plan turn's Read came back an error (${JSON.stringify(failed.text).slice(0, 160)}), so it was not allowed and executed`;

      // The dontAsk turn: a Write, DENIED, and the reason names the mode.
      if (!usedTool(dontAskTurn, "Write")) return "the dontAsk turn emitted no tool call, so the change to dontAsk decided nothing";
      const denied = denials(dontAskTurn);
      if (denied.length === 0) return "no permission_denied frame in the dontAsk turn, so the setter's effect is ungraded";
      if (denied.some((d) => d.decision_reason_type !== "mode")) {
        return `a denial's decision_reason_type is ${JSON.stringify(denied.map((d) => d.decision_reason_type))}, and dontAsk's must be "mode"`;
      }
      return null;
    },
  },
];
