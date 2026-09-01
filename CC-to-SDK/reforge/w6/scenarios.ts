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
//     pre-check's twelve-rung ladder produces the same transcript whether a rung
//     was evaluated and passed or never reached. A scenario cannot separate them.
//   the ARMS `auto` MODE OWNS. The mode is gate-guarded and this project pins
//     every gate to its compiled-in disabled default (§3.3), so the classifier
//     path cannot run here at all. `w6/probe-permissions.ts` measures the
//     refusal through BOTH paths the SDK exposes rather than assuming it.
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
 * `echo` IS the point in one cell: it is the command default mode approves
 * without asking, so an ASK RULE that forces a prompt for it is the only way to
 * show a rule overriding an auto-approval.
 */
const ECHO_PROMPT =
  "Use the Bash tool exactly once to run exactly `echo REFORGE_W6_ECHO`. Do not run anything else and do not use any other tool. " +
  "If the tool is denied, do not retry; reply with exactly DENIED.";

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
const broker = (ctx: ScenarioContext, decide?: (tool: string, input: Record<string, unknown>) => { behavior: "deny"; message: string } | null) =>
  async (toolName: string, input: Record<string, unknown>, opts: Record<string, unknown>) => {
    ctx.collect("consult", {
      toolName,
      decisionReason: opts.decisionReason ?? null,
      matchedAskRule: (opts.matchedAskRule as { source?: string; toolName?: string; ruleContent?: string } | undefined) ?? null,
      blockedPath: opts.blockedPath ?? null,
      suggestions: Array.isArray(opts.suggestions) ? (opts.suggestions as PermissionUpdate[]).length : 0,
    });
    const refusal = decide?.(toolName, input);
    if (refusal) return refusal;
    return { behavior: "allow" as const, updatedInput: input };
  };

/** Every `{type:"system",subtype:"permission_denied"}` frame in a transcript, projected. */
const denials = (msgs: unknown[]) =>
  msgs
    .filter((m) => (m as { type?: string; subtype?: string }).type === "system" && (m as { subtype?: string }).subtype === "permission_denied")
    .map((m) => m as { tool_name?: string; decision_reason_type?: string; message?: string });

const consults = (events: unknown[]) =>
  events.filter((e) => (e as { event?: string }).event === "consult").map((e) => (e as { payload: Record<string, unknown> }).payload);

export const W6_SCENARIOS: Scenario[] = [
  {
    // MODE CELL: acceptEdits x {Write, Bash}. Upstream's own semantics for the
    // mode are "Auto-accept file edit operations" — so the claim under test is
    // asymmetric, and one turn tests both halves: the Write must NOT reach the
    // broker and the Bash MUST. A scenario that only wrote a file would pass on
    // an engine that auto-accepted everything.
    tag: "perm-accept-edits",
    title: "acceptEdits auto-accepts the Write and still brokers the Bash",
    run: (ctx) =>
      drive(
        `First use the Write tool exactly once to create ${TARGET} containing the single line REFORGE_W6. ` +
          "Then use the Bash tool exactly once to run exactly `mkdir -p reforge-w6-dir`. Do not combine them and do not use any other tool. " +
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
    // MODE CELL: plan x Write. "Planning mode, no actual tool execution" — so
    // the decision must not be an allow, and the file must not exist afterwards.
    // The state surface grades the second half; this grades the first.
    tag: "perm-plan-mode",
    title: "plan mode refuses a Write",
    run: (ctx) => drive(writePrompt(TARGET), { ...baseOptions(ctx), maxTurns: 4, permissionMode: "plan", canUseTool: broker(ctx) }),
    check: (msgs, events) => {
      if (!usedTool(msgs, "Write")) return "the Write was never attempted, so plan mode refused nothing";
      const consulted = consults(events).some((c) => c.toolName === "Write");
      const denied = denials(msgs).some((d) => d.tool_name === "Write");
      if (!consulted && !denied) return "plan mode neither brokered nor denied the Write — no permission decision was made";
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
    // is the pre-check's first rung and the ordering claim the whole ladder
    // rests on.
    tag: "perm-rule-deny",
    title: "a deny rule beats a broker that would have allowed",
    run: (ctx) =>
      drive(writePrompt(TARGET), {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "default",
        settings: rules({ deny: ["Write"] }),
        canUseTool: broker(ctx),
      }),
    check: (msgs, events) => {
      if (!usedTool(msgs, "Write")) return "the Write was never attempted";
      if (consults(events).some((c) => c.toolName === "Write")) return "the broker was consulted despite a matching deny rule";
      const denial = denials(msgs).find((d) => d.tool_name === "Write");
      if (!denial) return "no permission_denied frame for the denied Write";
      if (denial.decision_reason_type !== "rule") {
        return `the denial's decision_reason_type is ${JSON.stringify(denial.decision_reason_type)}, not "rule"`;
      }
      return null;
    },
  },

  {
    // RULE CELL: an ALLOW rule, in default mode, on a command the mode would
    // otherwise broker. The rule must make the consult disappear — which is the
    // allow-rule decision's default arm, reached only when the tool itself
    // neither denies nor asks.
    tag: "perm-rule-allow",
    title: "an allow rule runs a non-read-only command without brokering it",
    run: (ctx) =>
      drive(MKDIR_PROMPT, {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "default",
        settings: rules({ allow: ["Bash(mkdir:*)"] }),
        canUseTool: broker(ctx),
      }),
    check: (msgs, events) => {
      if (!usedTool(msgs, "Bash")) return "the Bash call was never attempted";
      if (consults(events).some((c) => c.toolName === "Bash")) return "the broker was consulted despite a matching allow rule";
      if (denials(msgs).length > 0) return "the allow rule produced a denial";
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
    check: (msgs, events) => {
      if (!usedTool(msgs, "Bash")) return "the Bash call was never attempted";
      const consult = consults(events).find((c) => c.toolName === "Bash");
      if (!consult) return "the ask rule did not force a broker consult — this cell grades nothing without one";
      if (consult.matchedAskRule === null) return "the consult carried no matchedAskRule, so the host cannot tell a rule forced it";
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
    tag: "perm-bypass-deny-rule",
    title: "bypassPermissions meets a deny rule",
    run: (ctx) =>
      drive(writePrompt(TARGET), {
        ...baseOptions(ctx),
        maxTurns: 4,
        permissionMode: "bypassPermissions",
        settings: rules({ deny: ["Write"] }),
      }),
    check: (msgs) => {
      if (!usedTool(msgs, "Write")) return "the Write was never attempted, so nothing was decided under bypass";
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
        settings: rules({ ask: [`Write(${REWRITTEN})`] }),
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                async (input: unknown) => {
                  const record = input as { tool_name?: string; tool_input?: Record<string, unknown> };
                  ctx.collect("permissionRequestHook", { toolName: record.tool_name });
                  if (record.tool_name !== "Write") return { continue: true };
                  return {
                    continue: true,
                    permissionRequestResult: {
                      behavior: "allow",
                      updatedInput: { ...record.tool_input, file_path: REWRITTEN },
                    },
                  } as never;
                },
              ],
            },
          ],
        },
        canUseTool: broker(ctx),
      }),
    check: (msgs, events) => {
      if (!events.some((e) => (e as { event?: string }).event === "permissionRequestHook")) {
        return "the PermissionRequest hook never fired, so the rewrite path was not taken";
      }
      if (!usedTool(msgs, "Write")) return "the Write was never attempted";
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
                    permissionRequestResult: { behavior: "deny", message: "reforge W6: denied by the PermissionRequest hook" },
                  } as never;
                },
              ],
            },
          ],
        },
        canUseTool: broker(ctx),
      }),
    check: (msgs, events) => {
      if (!events.some((e) => (e as { event?: string }).event === "permissionRequestHook")) return "the PermissionRequest hook never fired";
      if (!usedTool(msgs, "Write")) return "the Write was never attempted";
      const text = resultText(msgs);
      if (text.includes("REFORGE_W6") && !text.includes("DENIED")) return "the Write appears to have succeeded despite the hook's deny";
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
    //   -> plan, then a Write      ALLOWED — the pre-check's rung 11 has a
    //                              second disjunct nothing else in the corpus
    //                              reaches: plan mode with bypass AVAILABLE
    //                              allows. A transition that rebuilt the context
    //                              instead of carrying it forward loses the
    //                              launch fact and this becomes a refusal.
    //   -> dontAsk, then a Write   DENIED, with a decision reason naming the
    //                              mode. A setter that reported success without
    //                              applying anything would still be in plan here
    //                              and would allow it.
    //   -> a mode that does not    the guard's first refusal, surfaced by the SDK
    //      parse                   as a rejected promise carrying the error
    //                              envelope's own sentence.
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
        options: { ...baseOptions(ctx), maxTurns: 8, permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true },
      });
      const turns = [writePrompt(join(SANDBOX, "plan-mode.txt")), writePrompt(join(SANDBOX, "dont-ask.txt"))];
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
    check: (msgs, events) => {
      const setters = events
        .filter((e) => (e as { event?: string }).event === "setPermissionMode")
        .map((e) => (e as { payload: Record<string, unknown> }).payload);
      if (setters.length !== 3) return `expected three mode changes, saw ${setters.length}`;
      const bad = setters[2];
      if (bad.accepted !== false) return "the guard ACCEPTED a mode that does not parse — its first refusal did not fire";
      if (bad.refusedWithMessage !== true) return "the refusal carried no message, so the error envelope's payload is ungraded";
      if (!usedTool(msgs, "Write")) return "no Write was attempted, so no mode change changed a decision";
      const denied = denials(msgs);
      if (denied.length === 0) return "no permission_denied frame: the dontAsk turn did not refuse, so the setter's effect is ungraded";
      if (denied.some((d) => d.decision_reason_type !== "mode")) {
        return `a denial's decision_reason_type is ${JSON.stringify(denied.map((d) => d.decision_reason_type))}, and dontAsk's must be "mode"`;
      }
      return null;
    },
  },
];
