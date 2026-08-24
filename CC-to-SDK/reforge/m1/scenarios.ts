// M1 corpus — every scenario is one behavioral claim about the engine, recorded
// once as a cassette and replayed offline into every engine build. Keep prompts
// exact and closed-ended: determinism at the model layer comes from the cassette,
// but determinism of *engine* behavior (which tools run, which hooks fire, what
// gets consulted) comes from these being tightly specified.
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  baseOptions,
  drive,
  hasThinking,
  pushable,
  resultsOf,
  resultText,
  usedTool,
  userMessage,
  type Scenario,
} from "../src/harness.js";

export const SCENARIOS: Scenario[] = [
  {
    tag: "plain",
    title: "single no-tool turn",
    run: (ctx) =>
      drive("Reply with exactly the single word SELFTEST_OK and nothing else.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
      }),
    check: (msgs) => (resultText(msgs).includes("SELFTEST_OK") ? null : "result lacks SELFTEST_OK"),
  },

  {
    tag: "bash-tool",
    title: "one Bash execution round-trip",
    run: (ctx) =>
      drive("Use the Bash tool to run exactly `echo REFORGE_TOOL_OK` and then report its output verbatim.", {
        ...baseOptions(ctx),
        allowedTools: ["Bash"],
        maxTurns: 3,
        permissionMode: "bypassPermissions",
      }),
    check: (msgs) =>
      !usedTool(msgs, "Bash")
        ? "Bash tool never used"
        : resultText(msgs).includes("REFORGE_TOOL_OK")
          ? null
          : "result lacks tool output",
  },

  {
    tag: "file-tools",
    title: "Write then Read in the sandbox",
    run: (ctx) =>
      drive(
        "Using the Write tool, create a file named alpha.txt in the current directory containing exactly the line REFORGE_FILE_BODY. Then use the Read tool to read alpha.txt back, and finally reply with the line you read.",
        {
          ...baseOptions(ctx),
          allowedTools: ["Write", "Read"],
          maxTurns: 4,
          permissionMode: "bypassPermissions",
        },
      ),
    check: (msgs) =>
      !usedTool(msgs, "Write")
        ? "Write tool never used"
        : !usedTool(msgs, "Read")
          ? "Read tool never used"
          : resultText(msgs).includes("REFORGE_FILE_BODY")
            ? null
            : "result lacks file body",
  },

  {
    // NOTE: the first version of this scenario denied a Bash `echo` and passed
    // hollowly — default mode auto-approves read-only commands WITHOUT
    // consulting canUseTool, so the tool ran and events were identical-empty.
    // A mutating tool (Write) is what actually forces a broker consult.
    tag: "permission-broker",
    title: "default-mode canUseTool consult; deny a Write",
    run: (ctx) =>
      drive(
        "Use the Write tool to create a file named blocked.txt containing the line SHOULD_BE_BLOCKED. If the tool is denied, do not retry; reply with exactly DENIED_ACKNOWLEDGED.",
        {
          ...baseOptions(ctx),
          maxTurns: 3,
          permissionMode: "default",
          canUseTool: async (toolName, input) => {
            ctx.collect("canUseTool", { toolName, file: (input as { file_path?: string })?.file_path });
            return { behavior: "deny", message: "reforge: denied by policy" };
          },
        },
      ),
    check: (msgs, events) =>
      !events.some((e) => (e as { event?: string; payload?: { toolName?: string } }).event === "canUseTool" && (e as { payload?: { toolName?: string } }).payload?.toolName === "Write")
        ? "canUseTool was never consulted for Write"
        : resultText(msgs).includes("DENIED_ACKNOWLEDGED")
          ? null
          : "result lacks DENIED_ACKNOWLEDGED",
  },

  {
    tag: "hooks",
    title: "PreToolUse + PostToolUse fire around Bash",
    run: (ctx) =>
      drive("Use the Bash tool to run exactly `echo REFORGE_HOOKED` and then report its output verbatim.", {
        ...baseOptions(ctx),
        allowedTools: ["Bash"],
        maxTurns: 3,
        permissionMode: "bypassPermissions",
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input) => {
                  const i = input as { hook_event_name?: string; tool_name?: string; tool_input?: { command?: string } };
                  ctx.collect("PreToolUse", { tool: i.tool_name, command: i.tool_input?.command });
                  return { continue: true };
                },
              ],
            },
          ],
          PostToolUse: [
            {
              hooks: [
                async (input) => {
                  const i = input as { tool_name?: string };
                  ctx.collect("PostToolUse", { tool: i.tool_name });
                  return { continue: true };
                },
              ],
            },
          ],
        },
      }),
    check: (msgs, events) => {
      const fired = (name: string) => events.some((e) => (e as { event?: string }).event === name);
      if (!fired("PreToolUse")) return "PreToolUse hook never fired";
      if (!fired("PostToolUse")) return "PostToolUse hook never fired";
      return resultText(msgs).includes("REFORGE_HOOKED") ? null : "result lacks tool output";
    },
  },

  {
    tag: "multi-turn",
    title: "two user messages over one streaming-input session",
    run: async (ctx) => {
      const input = pushable<ReturnType<typeof userMessage>>();
      const messages: unknown[] = [];
      input.push(userMessage("Remember the codeword REFORGE_ALPHA. Reply with exactly OK."));
      let results = 0;
      for await (const m of query({
        prompt: input,
        options: { ...baseOptions(ctx), allowedTools: [], permissionMode: "bypassPermissions" },
      })) {
        messages.push(m);
        if ((m as { type?: string }).type === "result") {
          results++;
          if (results === 1) input.push(userMessage("Reply with exactly the codeword I asked you to remember, in lowercase."));
          else input.end();
        }
      }
      return messages;
    },
    check: (msgs) => {
      const rs = resultsOf(msgs);
      if (rs.length !== 2) return `expected 2 results, saw ${rs.length}`;
      return String(rs[1].result ?? "").toLowerCase().includes("reforge_alpha") ? null : "second result lacks codeword";
    },
  },

  {
    tag: "resume",
    title: "second query resumes the first query's session",
    run: async (ctx) => {
      const first = await drive("Remember the codeword REFORGE_RESUME_BRAVO. Reply with exactly OK.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
      });
      const init = first.find((m) => (m as { type?: string; subtype?: string }).type === "system") as { session_id?: string };
      const sessionId = init?.session_id;
      ctx.collect("resume", { hadSessionId: Boolean(sessionId) });
      const second = await drive("Reply with exactly the codeword from earlier in this conversation.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        resume: sessionId,
      });
      return [...first, { type: "reforge-query-boundary" }, ...second];
    },
    check: (msgs) => {
      const rs = resultsOf(msgs);
      if (rs.length !== 2) return `expected 2 results, saw ${rs.length}`;
      return String(rs[1].result ?? "").includes("REFORGE_RESUME_BRAVO") ? null : "resumed session lost the codeword";
    },
  },

  {
    tag: "api-error",
    title: "nonexistent model surfaces an API error",
    run: (ctx) =>
      drive("Reply with exactly OK.", {
        ...baseOptions(ctx),
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        model: "claude-reforge-does-not-exist",
      }),
    // The SDK surfaces this as a query-level throw (captured by the runner as a
    // reforge-exception message), not as an error result.
    check: (msgs) =>
      msgs.some(
        (m) =>
          (m as { type?: string; message?: string }).type === "reforge-exception" &&
          String((m as { message?: string }).message).includes("issue with the selected model"),
      )
        ? null
        : "no model-error surfaced",
  },

  {
    // Adaptive thinking (sonnet-5 default: thinking {type:"adaptive"} + effort
    // high) SKIPS thinking on trivial prompts — 17*23 recorded zero thinking
    // blocks. The task must be hard enough that the model actually thinks.
    tag: "thinking",
    title: "extended thinking streams through",
    run: (ctx) =>
      drive(
        "How many positive integers n with 1 <= n <= 1000 are divisible by 3 or by 5 but not by both? Work it out carefully, then reply with exactly the number and nothing else.",
        {
          ...baseOptions(ctx),
          allowedTools: [],
          maxTurns: 1,
          permissionMode: "bypassPermissions",
          maxThinkingTokens: 4096,
        },
      ),
    check: (msgs) => (hasThinking(msgs) ? null : "no thinking block in transcript"),
  },
];
