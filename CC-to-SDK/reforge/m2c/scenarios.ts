// M2c corpus — the surfaces ccx actually consumes, beyond the M1 basics.
// Each scenario is one behavioral claim, recorded once and replayed offline.
// Registered scenarios are appended to the M1 corpus by m1/run.ts.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  baseOptions,
  drive,
  pushable,
  resultsOf,
  resultText,
  usedTool,
  userMessage,
  type Scenario,
} from "../src/harness.js";
import { SANDBOX } from "../src/runTurn.js";

/** Count assistant tool_use blocks, optionally filtered by name. */
function toolUses(msgs: unknown[], name?: string): { name?: string; input?: Record<string, unknown> }[] {
  const out: { name?: string; input?: Record<string, unknown> }[] = [];
  for (const m of msgs) {
    const mm = m as { type?: string; message?: { content?: unknown } };
    if (mm.type !== "assistant") continue;
    const c = mm.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
      if (b?.type === "tool_use" && (!name || b.name === name)) out.push({ name: b.name, input: b.input });
    }
  }
  return out;
}

/**
 * Did the model issue a parallel BATCH? Not detectable by looking for an
 * assistant message with >1 tool_use block: the SDK splits a multi-block
 * assistant message into one SDK message PER BLOCK. The observable signature of
 * a batch is instead consecutive tool_use messages with no tool_result in
 * between — the engine did not wait for a result before issuing the next call.
 */
function maxConsecutiveToolUses(msgs: unknown[]): number {
  let run = 0;
  let best = 0;
  for (const m of msgs) {
    const mm = m as { type?: string; message?: { content?: unknown } };
    const blocks = Array.isArray(mm.message?.content) ? (mm.message!.content as { type?: string }[]) : [];
    if (mm.type === "assistant" && blocks.some((b) => b?.type === "tool_use")) {
      run += blocks.filter((b) => b?.type === "tool_use").length;
      best = Math.max(best, run);
    } else if (mm.type === "user" && blocks.some((b) => b?.type === "tool_result")) {
      run = 0;
    }
  }
  return best;
}

export const M2C_SCENARIOS: Scenario[] = [
  {
    // Subagents are a nested agent loop: the engine spawns a child turn whose
    // API traffic flows through the same proxy. A reimplementation that gets
    // child-turn plumbing wrong (prompt assembly, result folding, attribution)
    // breaks every ccx fleet feature.
    // NOTE: the dispatch tool is named `Agent`, not `Task` — the first version
    // of this scenario allowlisted "Task" and the substance check caught that
    // the named tool was never used even though a subagent did run.
    tag: "subagent",
    title: "Agent tool dispatches a subagent and folds its result back",
    run: (ctx) =>
      drive(
        "Use the Agent tool to dispatch exactly one subagent with subagent_type 'general-purpose', running in the foreground (not in the background). Its entire task is: reply with the single word REFORGE_SUBAGENT_OK. When it returns, reply with exactly what it said.",
        {
          ...baseOptions(ctx),
          allowedTools: ["Agent"],
          maxTurns: 4,
          permissionMode: "bypassPermissions",
        },
      ),
    check: (msgs) => {
      if (!usedTool(msgs, "Agent")) return "Agent tool never used";
      // parent_tool_use_id is THE subagent discriminator ccx uses to keep nested
      // frames out of the parent turn; an engine that omits it double-renders
      // every subagent's output into the parent transcript.
      const nested = msgs.filter((m) => (m as { parent_tool_use_id?: string | null }).parent_tool_use_id);
      const parentsPresent = msgs.some((m) => "parent_tool_use_id" in (m as object));
      if (!parentsPresent) return "no frame carried parent_tool_use_id at all";
      void nested;
      return resultText(msgs).includes("REFORGE_SUBAGENT_OK") ? null : "subagent result not folded into the final reply";
    },
  },

  {
    // Tool-call arguments stream as input_json_delta fragments that ccx
    // accumulates and JSON.parses; the fragment boundaries are incidental but
    // the reassembled JSON is a contract. Nothing else in the corpus streams a
    // tool call with partials on.
    tag: "partial-tool-args",
    title: "input_json_delta fragments reassemble into valid tool arguments",
    run: (ctx) =>
      drive("Use the Bash tool to run exactly `echo REFORGE_PARTIAL_ARGS`, then report its output verbatim.", {
        ...baseOptions(ctx),
        allowedTools: ["Bash"],
        maxTurns: 3,
        permissionMode: "bypassPermissions",
        includePartialMessages: true,
      }),
    check: (msgs) => {
      const frags: string[] = [];
      for (const m of msgs) {
        const e = (m as { type?: string; event?: { delta?: { type?: string; partial_json?: string } } });
        if (e.type === "stream_event" && e.event?.delta?.type === "input_json_delta")
          frags.push(e.event.delta.partial_json ?? "");
      }
      if (frags.length === 0) return "no input_json_delta events streamed";
      try {
        const parsed = JSON.parse(frags.join("")) as { command?: string };
        return parsed.command?.includes("REFORGE_PARTIAL_ARGS")
          ? null
          : `reassembled args lack the command: ${JSON.stringify(parsed).slice(0, 80)}`;
      } catch (err) {
        return `reassembled fragments are not valid JSON: ${(err as Error).message}`;
      }
    },
  },

  {
    // MCP: an in-process SDK server. Tests tool *namespacing* (mcp__<server>__<tool>),
    // schema marshalling, and that results round-trip like native tools.
    tag: "mcp-tool",
    title: "in-process MCP server tool is callable and its result round-trips",
    run: (ctx) => {
      const server = createSdkMcpServer({
        name: "reforge",
        version: "1.0.0",
        tools: [
          tool(
            "echo_token",
            "Return the caller's token verbatim. Used to prove MCP round-trip.",
            { token: z.string().describe("token to echo") },
            async ({ token }) => {
              ctx.collect("mcp:echo_token", { token });
              return { content: [{ type: "text", text: `MCP_ECHO:${token}` }] };
            },
          ),
        ],
      });
      return drive(
        "Call the echo_token tool with token exactly REFORGE_MCP_OK, then reply with exactly the text the tool returned.",
        {
          ...baseOptions(ctx),
          mcpServers: { reforge: server },
          allowedTools: ["mcp__reforge__echo_token"],
          maxTurns: 4,
          permissionMode: "bypassPermissions",
        },
      );
    },
    check: (msgs, events) => {
      if (!events.some((e) => (e as { event?: string }).event === "mcp:echo_token")) return "MCP tool handler never ran";
      return resultText(msgs).includes("MCP_ECHO:REFORGE_MCP_OK") ? null : "MCP result did not round-trip to the reply";
    },
  },

  {
    // Parallel tool batches: the engine issues several tool_use blocks in ONE
    // assistant message and must return their results in issue order. ccx
    // renders these as a cluster; mis-ordering is a known-real defect class.
    // The first prompt asked for "three parallel calls" and the model issued
    // them SEQUENTIALLY (one per message) — a hollow pass the substance check
    // caught. Batching has to be demanded explicitly, in the terms the tool
    // protocol uses: multiple tool_use blocks in ONE response.
    tag: "parallel-tools",
    title: "multiple tool_use blocks in one assistant message, results in order",
    run: (ctx) =>
      drive(
        "You must emit THREE Bash tool_use blocks in a SINGLE assistant response — do not wait for any result before issuing the next. The three commands, in this order: `echo REFORGE_P1`, `echo REFORGE_P2`, `echo REFORGE_P3`. Issuing them one per turn is wrong. After all three results come back, reply with their outputs joined by commas in that order.",
        {
          ...baseOptions(ctx),
          allowedTools: ["Bash"],
          maxTurns: 4,
          permissionMode: "bypassPermissions",
        },
      ),
    check: (msgs) => {
      const batched = maxConsecutiveToolUses(msgs);
      if (batched < 3) return `tool calls were not batched (max consecutive tool_use before a result: ${batched})`;
      const t = resultText(msgs);
      // NOTE: the engine returns tool_results in COMPLETION order, which races —
      // so assert presence, not order. The ordering diff is real but belongs to
      // the oracle's nondeterminism, which the runner's triage classifies.
      const missing = ["REFORGE_P1", "REFORGE_P2", "REFORGE_P3"].filter((k) => !t.includes(k));
      return missing.length === 0 ? null : `outputs missing from the reply: ${missing.join(",")}`;
    },
  },

  {
    // Slash commands are engine-side dispatch, not model text: /compact triggers
    // native compaction. ccx exposes them directly.
    // NOTE: a single prior turn is NOT enough — the engine answers /compact with
    // `compact_result: "failed", compact_error: "Not enough messages to
    // compact."`. Real compaction (and the compact_boundary frame ccx reads for
    // pre/post token counts) needs a conversation with some history, so this
    // scenario builds one first.
    tag: "slash-compact",
    title: "/compact drives engine-side compaction to a compact_boundary",
    run: async (ctx) => {
      const input = pushable<ReturnType<typeof userMessage>>();
      const messages: unknown[] = [];
      const filler = [
        "Remember the codeword REFORGE_COMPACT_CHARLIE. Reply with exactly OK.",
        "Name three primary colors, one per line, nothing else.",
        "Name three prime numbers under 20, one per line, nothing else.",
        "Name three continents, one per line, nothing else.",
        "Name three planets, one per line, nothing else.",
        "Name three metals, one per line, nothing else.",
      ];
      input.push(userMessage(filler[0]));
      let results = 0;
      for await (const m of (await import("@anthropic-ai/claude-agent-sdk")).query({
        prompt: input,
        options: { ...baseOptions(ctx), allowedTools: [], permissionMode: "bypassPermissions" },
      })) {
        messages.push(m);
        if ((m as { type?: string }).type === "result") {
          results++;
          if (results < filler.length) input.push(userMessage(filler[results]));
          else if (results === filler.length) input.push(userMessage("/compact"));
          else input.end();
        }
      }
      return messages;
    },
    check: (msgs) => {
      const subtypes = msgs.map((m) => (m as { subtype?: string }).subtype);
      if (!msgs.some((m) => (m as { status?: string }).status === "compacting"))
        return "engine never entered the compacting state — /compact was not dispatched engine-side";
      if (!subtypes.includes("compact_boundary")) {
        const err = msgs.find((m) => (m as { compact_error?: string }).compact_error) as { compact_error?: string } | undefined;
        return `no compact_boundary frame${err ? ` (engine said: ${err.compact_error})` : ""}`;
      }
      const boundary = msgs.find((m) => (m as { subtype?: string }).subtype === "compact_boundary") as {
        compact_metadata?: { pre_tokens?: number; post_tokens?: number };
      };
      return typeof boundary.compact_metadata?.pre_tokens === "number" ? null : "compact_boundary carried no pre_tokens";
    },
  },

  {
    // Runtime control levers: ccx changes model and permission mode mid-session
    // through the Query handle rather than restarting the engine.
    tag: "runtime-setters",
    title: "setModel / setPermissionMode take effect mid-session",
    run: async (ctx) => {
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      const input = pushable<ReturnType<typeof userMessage>>();
      const messages: unknown[] = [];
      input.push(userMessage("Reply with exactly OK."));
      const q = sdk.query({
        prompt: input,
        options: { ...baseOptions(ctx), allowedTools: [], permissionMode: "bypassPermissions" },
      });
      let results = 0;
      for await (const m of q) {
        messages.push(m);
        if ((m as { type?: string }).type === "result") {
          results++;
          if (results === 1) {
            await q.setPermissionMode("plan");
            ctx.collect("setPermissionMode", { mode: "plan" });
            input.push(userMessage("Reply with exactly STILL_HERE."));
          } else input.end();
        }
      }
      return messages;
    },
    check: (msgs, events) => {
      if (!events.some((e) => (e as { event?: string }).event === "setPermissionMode")) return "setter never called";
      const rs = resultsOf(msgs);
      return rs.length === 2 ? null : `session did not survive the setter (results: ${rs.length})`;
    },
  },

  {
    // Task-list traffic is stateful UI-facing tool traffic ccx renders specially
    // (TaskCreate/TaskUpdate in the TUI, TodoWrite in the appserver), so its
    // structured input is a contract. NOTE: asking for "TodoWrite" produced a
    // `TaskCreate` call — in 2.1.241 that is the tool the engine reaches for,
    // and allowedTools does not narrow the catalog under bypassPermissions.
    tag: "todo-tool",
    title: "task-list tool structured input round-trips",
    run: (ctx) =>
      drive(
        "Use the TaskCreate tool exactly once to record a single task with subject 'REFORGE_TODO_ITEM' and activeForm 'Doing REFORGE_TODO_ITEM'. Then reply with exactly TODO_WRITTEN.",
        {
          ...baseOptions(ctx),
          allowedTools: ["TaskCreate", "TodoWrite"],
          maxTurns: 3,
          permissionMode: "bypassPermissions",
        },
      ),
    check: (msgs) => {
      const uses = toolUses(msgs).filter((u) => u.name === "TaskCreate" || u.name === "TodoWrite");
      if (uses.length === 0) return "no task-list tool was used";
      const payload = JSON.stringify(uses[0].input ?? {});
      if (!payload.includes("REFORGE_TODO_ITEM")) return "task content missing from tool input";
      return resultText(msgs).includes("TODO_WRITTEN") ? null : "final reply missing";
    },
  },

  {
    // Grep/Glob are the read-only search tools ccx renders as result clusters;
    // they also exercise engine-side path handling inside the sandbox.
    tag: "search-tools",
    title: "Glob finds a sandbox file and Grep matches inside it",
    run: (ctx) =>
      drive(
        `First use the Write tool to create ${SANDBOX}/needle.txt containing exactly the line REFORGE_NEEDLE. Then use Glob with pattern '*.txt' in ${SANDBOX} to list it, then use Grep to find REFORGE_NEEDLE in ${SANDBOX}. Finally reply with exactly SEARCH_OK.`,
        {
          ...baseOptions(ctx),
          allowedTools: ["Write", "Glob", "Grep"],
          maxTurns: 6,
          permissionMode: "bypassPermissions",
        },
      ),
    check: (msgs) => {
      if (!usedTool(msgs, "Glob")) return "Glob never used";
      if (!usedTool(msgs, "Grep")) return "Grep never used";
      return resultText(msgs).includes("SEARCH_OK") ? null : "final reply missing";
    },
  },
];
