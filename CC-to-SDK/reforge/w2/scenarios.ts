// W2 corpus family — "the lean arm of a search-tool description" (campaign spec
// C5 / §3.2).
//
// Every one of the four description functions this wave owns has the same shape:
// `leanPrompt(model) ? brief : full`. The corpus already reached both arms for
// Read and WebFetch — their descriptions ride in 23 of the 24 scenarios' requests,
// and `api-error` is the one that takes the lean arm, because its deliberately
// invalid model id falls outside the lean-prompt family test. Glob and Grep had
// neither: their descriptions appear in exactly ONE request in the whole corpus
// (`search-tools`, the only scenario whose allowedTools admit them), and that
// scenario runs a sonnet model, so their lean arms were unexecuted everywhere.
//
// This scenario is the intersection of those two facts and nothing more: the
// search-tools tool set, on the api-error model. The request is emitted with the
// full tool catalog before the model id is rejected, which is what carries the
// lean Glob and Grep descriptions onto the graded `requests` surface.
//
// The alternative was to flip the lean-prompt policy directly — it reads
// `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT`. Contract X6 forbids a child adding an env
// var outside the schema, and for good reason: that variable would change the
// system prompt of every graded run, not just this one's tool descriptions.
import { baseOptions, drive, type Scenario } from "../src/harness.js";

export const W2_SCENARIOS: Scenario[] = [
  {
    tag: "search-tools-lean",
    title: "search-tool descriptions on a lean-prompt model",
    run: (ctx) =>
      drive("Reply with exactly OK.", {
        ...baseOptions(ctx),
        allowedTools: ["Write", "Glob", "Grep"],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
        model: "claude-reforge-does-not-exist",
      }),
    // Same surface as `api-error`: the SDK throws at the query level rather than
    // returning an error result. The claim this scenario grades is in the
    // REQUEST it emitted on the way there, which the three-surface diff compares
    // for both engines; the check below only asserts the run got that far.
    check: (msgs) =>
      msgs.some(
        (m) =>
          (m as { type?: string; message?: string }).type === "reforge-exception" &&
          String((m as { message?: string }).message).includes("issue with the selected model"),
      )
        ? null
        : "no model-error surfaced",
  },
];
