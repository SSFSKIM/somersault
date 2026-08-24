// M3-A — the Tier-1 surfaces the ccx inventory ranked highest, which the M1/M2c
// corpus still could not see. Each is a contract whose breakage is severe:
// hung turns, uncancellable work, silent permission bypass, wedged task panels.
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  baseOptions,
  drive,
  pushable,
  resultsOf,
  resultText,
  usedTool,
  type Scenario,
} from "../src/harness.js";
import { SANDBOX } from "../src/runTurn.js";

/** A caller-minted user message carrying the correlation fields ccx depends on. */
function trackedUserMessage(text: string, uuid: string, originKind: "human" | "auto-continuation") {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    uuid,
    origin: { kind: originKind },
    session_id: "",
  } as never;
}

const frames = (msgs: unknown[], subtype: string) =>
  msgs.filter((m) => (m as { type?: string; subtype?: string }).type === "system" && (m as { subtype?: string }).subtype === subtype);

export const M3_SCENARIOS: Scenario[] = [
  {
    // Tier 1 #1/#2: ccx settles a turn by matching result.user_message_uuid to
    // the uuid it minted when pushing the message, and guards provenance with
    // origin.kind. An engine that drops or rewrites either field leaves every
    // turn waiting forever — the single most severe failure in the inventory.
    // MEASURED (m3/probe-origin.ts, run on the RAW stream-json path so the
    // result is attributable to the ENGINE, not to sdk.mjs): of the origin kinds
    // the SDK types declare — human | channel | peer — **only `human` survives
    // onto the result frame**. `peer`, `channel`, and unknown kinds all arrive
    // as `origin: null`, i.e. unattributed, which fails closed at strict
    // isHuman() trust gates.
    //
    // Both halves are the contract: the recognized kind survives, and everything
    // else is DISCARDED rather than passed through — an engine that echoed the
    // caller's kind verbatim would let unattributed input walk through those
    // gates. Two consequences worth carrying: ccx's own "auto-continuation"
    // stamping reaches the engine as unattributed, and peer/channel attribution
    // is not deliverable over this path at all.
    tag: "uuid-correlation",
    title: "caller uuid round-trips; origin survives only for recognized kinds",
    run: async (ctx) => {
      const input = pushable<never>();
      const messages: unknown[] = [];
      const uuids = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ];
      const origins = [
        { kind: "human" },
        { kind: "auto-continuation" }, // not an SDK kind — must be discarded
        { kind: "peer", from: "reforge-peer", fromMode: "bypass" },
      ];
      const push = (i: number, text: string) =>
        input.push({
          type: "user",
          message: { role: "user", content: [{ type: "text", text }] },
          parent_tool_use_id: null,
          uuid: uuids[i],
          origin: origins[i],
          session_id: "",
        } as never);
      push(0, "Reply with exactly ONE.");
      let results = 0;
      for await (const m of query({
        prompt: input as AsyncIterable<never>,
        options: { ...baseOptions(ctx), allowedTools: [], permissionMode: "bypassPermissions" },
      })) {
        messages.push(m);
        if ((m as { type?: string }).type === "result") {
          results++;
          if (results === 1) push(1, "Reply with exactly TWO.");
          else if (results === 2) push(2, "Reply with exactly THREE.");
          else input.end();
        }
      }
      ctx.collect("pushed", { uuids });
      return messages;
    },
    check: (msgs) => {
      const rs = resultsOf(msgs) as { user_message_uuid?: string; origin?: { kind?: string } | null }[];
      if (rs.length !== 3) return `expected 3 results, saw ${rs.length}`;
      const expected = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ];
      for (let i = 0; i < 3; i++) {
        if (rs[i].user_message_uuid !== expected[i])
          return `turn ${i + 1} did not echo the caller uuid (got ${rs[i].user_message_uuid})`;
      }
      if (rs[0].origin?.kind !== "human") return `human origin dropped on turn 1 (${JSON.stringify(rs[0].origin)})`;
      if (rs[1].origin != null) return `unknown origin kind was passed through: ${JSON.stringify(rs[1].origin)}`;
      if (rs[2].origin != null) return `non-human origin was passed through: ${JSON.stringify(rs[2].origin)}`;
      return null;
    },
  },

  {
    // Tier 2 #8, highest-traffic control method: Esc / ctrl-c. The turn must
    // actually stop AND settle — an engine that ignores interrupt leaves work
    // running with no way to cancel it.
    tag: "interrupt",
    title: "interrupt() stops a running turn and the turn settles",
    run: async (ctx) => {
      const input = pushable<never>();
      const messages: unknown[] = [];
      input.push(
        trackedUserMessage(
          "Use the Bash tool to run exactly `sleep 25 && echo REFORGE_SHOULD_NOT_FINISH`, then report its output.",
          "33333333-3333-4333-8333-333333333333",
          "human",
        ),
      );
      const q = query({
        prompt: input as AsyncIterable<never>,
        options: { ...baseOptions(ctx), allowedTools: ["Bash"], maxTurns: 3, permissionMode: "bypassPermissions" },
      });
      let interrupted = false;
      try {
        for await (const m of q) {
          messages.push(m);
          // Interrupt once the tool is actually RUNNING. Firing the moment the
          // tool_use block appears races the engine's own dispatch, and the
          // measured outcome was a hard exit(1) with no frames at all.
          if (!interrupted && usedTool([m], "Bash")) {
            interrupted = true;
            setTimeout(() => {
              void q.interrupt().catch(() => {});
            }, 1500);
            ctx.collect("interrupt", { after: "Bash tool_use, +1500ms" });
          }
          if ((m as { type?: string }).type === "result") input.end();
        }
      } catch (e) {
        // An interrupted engine may terminate the stream rather than settle it;
        // that is an outcome to compare, not a harness error.
        messages.push({ type: "reforge-interrupt-outcome", message: String((e as Error).message).slice(0, 120) });
      }
      return messages;
    },
    check: (msgs, events) => {
      if (!events.some((e) => (e as { event?: string }).event === "interrupt")) return "interrupt() was never reached";
      // The contract: the interrupted work must NOT complete, and the turn must
      // reach a definite end (a result frame, or a terminated stream) rather
      // than hanging. Which of the two the engine chooses is itself behavior the
      // differ compares between engines.
      const ended =
        resultsOf(msgs).length > 0 || msgs.some((m) => (m as { type?: string }).type === "reforge-interrupt-outcome");
      if (!ended) return "turn neither settled nor terminated after interrupt";
      // "Did it complete?" must be judged on tool RESULTS, not on any mention of
      // the marker: the tool_use block necessarily contains the command string
      // it was asked to run, so a whole-transcript substring search always trips.
      // Measured shape of a successful interrupt: the tool_result says the tool
      // use was rejected, and the turn ends error_during_execution.
      let completed = false;
      let rejected = false;
      for (const m of msgs) {
        const c = (m as { message?: { content?: unknown } }).message?.content;
        if (!Array.isArray(c)) continue;
        for (const b of c as { type?: string; content?: unknown }[]) {
          if (b?.type !== "tool_result") continue;
          const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
          if (text.includes("REFORGE_SHOULD_NOT_FINISH")) completed = true;
          if (/rejected|interrupt|doesn't want to proceed/i.test(text)) rejected = true;
        }
      }
      if (completed) return "the interrupted command ran to completion";
      if (!rejected) return "no tool_result showed the tool use being cut short";
      return null;
    },
  },

  {
    // Tier 1 #6: the permission broker's option bag and its allow arm. ccx
    // routes on tool name and renders from these fields; the allow arm's
    // updatedInput must actually change what runs, or "approve with edits"
    // silently executes the original input.
    // Uses Write, not a read-only Bash echo: default mode auto-approves
    // read-only commands WITHOUT consulting the broker, so a read-only probe
    // measures nothing (same trap the M2b permission scenario hit).
    tag: "permission-bag",
    title: "canUseTool receives a populated bag; updatedInput takes effect",
    run: (ctx) =>
      drive(
        `Use the Write tool to create ${SANDBOX}/permcheck.txt containing exactly the line REFORGE_ORIGINAL. Then use the Read tool on that same path and reply with exactly the line you read.`,
        {
          ...baseOptions(ctx),
          maxTurns: 4,
          permissionMode: "default",
          canUseTool: async (toolName, input, opts) => {
            ctx.collect("bag", {
              toolName,
              bagKeys: Object.keys(opts ?? {}).sort(),
              hasToolUseID: Boolean((opts as { toolUseID?: string })?.toolUseID),
              hasSignal: Boolean((opts as { signal?: unknown })?.signal),
            });
            if (toolName !== "Write") return { behavior: "allow", updatedInput: input as Record<string, unknown> };
            // "approve with edits": the tool must run the REWRITTEN input.
            return {
              behavior: "allow",
              updatedInput: { ...(input as Record<string, unknown>), content: "REFORGE_REWRITTEN\n" },
            };
          },
        },
      ),
    check: (msgs, events) => {
      const bag = events.find(
        (e) => (e as { event?: string; payload?: { toolName?: string } }).event === "bag" &&
          (e as { payload?: { toolName?: string } }).payload?.toolName === "Write",
      ) as { payload?: { toolName?: string; hasToolUseID?: boolean; hasSignal?: boolean } } | undefined;
      if (!bag) return "canUseTool was never consulted for Write";
      if (!bag.payload!.hasToolUseID) return "bag lacked toolUseID (ccx keys its dialogs by it)";
      if (!bag.payload!.hasSignal) return "bag lacked an abort signal";
      const t = resultText(msgs);
      if (t.includes("REFORGE_ORIGINAL")) return "updatedInput was ignored — the original content was written";
      return t.includes("REFORGE_REWRITTEN") ? null : "rewritten content never reached the reply";
    },
  },

  {
    // Tier 2 #10: the background-task sidechannel. ccx's task panel and ctrl-B
    // depend on task_started / task_notification bookends and the
    // background_tasks_changed level signal (REPLACE semantics).
    // MEASURED: this scenario is irreducibly racy on the diff surfaces. A
    // backgrounded agent completes concurrently with the parent turn, and its
    // completion is spliced into the parent's CONVERSATION ARRAY either before
    // or after the parent's own reply. Lane canonicalization fixes the frame and
    // request interleaving (and does, here), but conversation order inside a
    // request body is a real contract and must not be sorted away — and
    // `subagent_stats.completed` legitimately reads 0 or 1 depending on the same
    // timing. Ending the turn early does not help either: the two engines then
    // stop at different frame counts.
    //
    // So it grades on its substance assertion alone: the dispatch-time
    // sidechannel frames (`task_started` with a tool_use_id, and
    // `background_tasks_changed` carrying a tasks array), which ARE deterministic.
    substanceOnly:
      "backgrounded work completes concurrently with the parent turn; the splice point in the parent's conversation is a race that cannot be canonicalized without discarding real conversation ordering",
    tag: "background-task",
    title: "backgrounded Agent emits task_started and background_tasks_changed at dispatch",
    run: (ctx) =>
      drive(
        "Use the Agent tool with run_in_background set to true to dispatch one subagent (subagent_type 'general-purpose') whose entire task is: reply with the single word REFORGE_BG_OK. Do not wait for it; immediately reply with exactly DISPATCHED.",
        {
          ...baseOptions(ctx),
          allowedTools: ["Agent"],
          maxTurns: 2,
          permissionMode: "bypassPermissions",
        },
      ),
    check: (msgs) => {
      if (!usedTool(msgs, "Agent")) return "Agent tool never used";
      const started = frames(msgs, "task_started");
      const changed = frames(msgs, "background_tasks_changed");
      if (started.length === 0) return "no task_started frame";
      if (changed.length === 0) return "no background_tasks_changed frame";
      const tasks = (changed[0] as { tasks?: { task_id?: string; task_type?: string }[] }).tasks;
      if (!Array.isArray(tasks)) return "background_tasks_changed carried no tasks array";
      return (started[0] as { tool_use_id?: string }).tool_use_id ? null : "task_started lacked tool_use_id";
    },
  },

  {
    // Tier 2 #9: fork must mint a NEW session id without destroying the parent.
    // If fork semantics are wrong the parent conversation is reserved-live and
    // becomes undeletable — a data-loss-adjacent failure, not a cosmetic one.
    tag: "fork-session",
    title: "forkSession mints a new id and preserves the parent's context",
    run: async (ctx) => {
      const first = await drive("Remember the codeword REFORGE_FORK_DELTA. Reply with exactly OK.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
      });
      const init = first.find((m) => (m as { type?: string }).type === "system") as { session_id?: string };
      const parentId = init?.session_id ?? "";
      const forked = await drive("Reply with exactly the codeword from earlier in this conversation.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        resume: parentId,
        forkSession: true,
      });
      const forkInit = forked.find((m) => (m as { type?: string }).type === "system") as { session_id?: string };
      ctx.collect("fork", { newIdDiffers: (forkInit?.session_id ?? "") !== parentId });
      return [...first, { type: "reforge-query-boundary" }, ...forked];
    },
    check: (msgs, events) => {
      const fork = events.find((e) => (e as { event?: string }).event === "fork") as
        | { payload?: { newIdDiffers?: boolean } }
        | undefined;
      if (!fork?.payload?.newIdDiffers) return "forkSession reused the parent session id";
      const rs = resultsOf(msgs);
      if (rs.length !== 2) return `expected 2 results, saw ${rs.length}`;
      return String(rs[1].result ?? "").includes("REFORGE_FORK_DELTA")
        ? null
        : "forked session lost the parent's context";
    },
  },
];
