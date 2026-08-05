import { describe, it, expect } from "vitest";
import {
  EXPLAIN_SYSTEM_PROMPT, EXPLAIN_TOOL_SCHEMA, buildExplainPrompt, explainCommand, riskLabel, riskColorRole,
  structuredExplainTransport, type ExplainRequest, type ExplainTransport, type Explanation,
} from "../../src/tui/dialogs/explainCommand.js";

const GOOD: Explanation = {
  explanation: "Lists the files in the current directory, including hidden ones.",
  reasoning: "I need to see what is in this directory before editing.",
  risk: "None; it only reads directory metadata.",
  riskLevel: "LOW",
};
/** Records what the transport was handed, and answers with whatever the test supplies. */
function fakeTransport(answer: unknown | (() => Promise<unknown>), seen: { req?: ExplainRequest } = {}): ExplainTransport & { seen: typeof seen } {
  const t = (async (req: ExplainRequest) => { seen.req = req; return typeof answer === "function" ? await (answer as () => Promise<unknown>)() : answer; }) as any;
  t.seen = seen; return t;
}

describe("explain-command constants (canon L504943 / L504955)", () => {
  it("EXPLAIN_SYSTEM_PROMPT is the canon string, character for character", () => {
    expect(EXPLAIN_SYSTEM_PROMPT).toBe("Analyze shell commands and explain what they do, why you're running them, and potential risks.");
  });

  it("EXPLAIN_TOOL_SCHEMA is the canon forced tool, character for character", () => {
    expect(EXPLAIN_TOOL_SCHEMA).toEqual({
      name: "explain_command",
      description: "Provide an explanation of a shell command",
      input_schema: {
        type: "object",
        properties: {
          explanation: { type: "string", description: "What this command does (1-2 sentences)" },
          reasoning: { type: "string", description: 'Why YOU are running this command. Start with "I" - e.g. "I need to check the file contents"' },
          risk: { type: "string", description: "What could go wrong, under 15 words" },
          riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "LOW (safe dev workflows), MEDIUM (recoverable changes), HIGH (dangerous/irreversible)" },
        },
        required: ["explanation", "reasoning", "risk", "riskLevel"],
      },
    });
  });
});

describe("riskLabel / riskColorRole (canon XQf L505005-14, YQf L504995-5004)", () => {
  it("labels", () => {
    expect(riskLabel("LOW")).toBe("Low risk");
    expect(riskLabel("MEDIUM")).toBe("Med risk");
    expect(riskLabel("HIGH")).toBe("High risk");
  });
  it("theme roles", () => {
    expect(riskColorRole("LOW")).toBe("success");
    expect(riskColorRole("MEDIUM")).toBe("warning");
    expect(riskColorRole("HIGH")).toBe("error");
  });
});

describe("buildExplainPrompt (canon L504915-24)", () => {
  const input = { command: "ls -la", timeout: 2000 };
  const json = JSON.stringify(input, null, 2);

  it("with a description", () => {
    expect(buildExplainPrompt({ toolName: "Bash", toolInput: input, toolDescription: "Runs a shell command" }))
      .toBe(`Tool: Bash\nDescription: Runs a shell command\n\nInput:\n${json}\n\n\nExplain this command in context.`);
  });

  it("without a description the Description line is absent entirely", () => {
    const p = buildExplainPrompt({ toolName: "Bash", toolInput: input });
    expect(p).toBe(`Tool: Bash\n\nInput:\n${json}\n\n\nExplain this command in context.`);
    expect(p).not.toContain("Description:");
  });

  it("a string toolInput is passed through unserialized (canon d6b L504885-92)", () => {
    expect(buildExplainPrompt({ toolName: "Bash", toolInput: "ls -la" })).toContain("Input:\nls -la\n");
  });

  it("an unserializable toolInput degrades to String() instead of throwing", () => {
    const cyclic: any = { a: 1 }; cyclic.self = cyclic;
    expect(() => buildExplainPrompt({ toolName: "Bash", toolInput: cyclic })).not.toThrow();
    expect(buildExplainPrompt({ toolName: "Bash", toolInput: cyclic })).toContain("[object Object]");
  });

  it("never carries a recent-conversation block (unreachable upstream — both consult sites pass no messages)", () => {
    expect(buildExplainPrompt({ toolName: "Bash", toolInput: input })).not.toContain("Recent conversation context");
  });
});

describe("explainCommand", () => {
  const args = { toolName: "Bash", toolInput: { command: "ls -la" }, toolDescription: "Runs a shell command" };

  it("returns the four parsed fields from a well-formed result", async () => {
    const t = fakeTransport({ ...GOOD });
    await expect(explainCommand(args, t)).resolves.toEqual(GOOD);
  });

  it("hands the transport the canon system prompt, the built prompt, the forced-tool schema and the signal", async () => {
    const ac = new AbortController();
    const t = fakeTransport({ ...GOOD });
    await explainCommand({ ...args, signal: ac.signal }, t);
    expect(t.seen.req!.system).toBe(EXPLAIN_SYSTEM_PROMPT);
    expect(t.seen.req!.prompt).toBe(buildExplainPrompt(args));
    expect(t.seen.req!.schema).toBe(EXPLAIN_TOOL_SCHEMA);
    expect(t.seen.req!.signal).toBe(ac.signal);
  });

  it("keeps only the four fields — a chatty transport cannot smuggle extras through", async () => {
    const t = fakeTransport({ ...GOOD, extra: "ignored", riskScore: 3 });
    const out = await explainCommand(args, t);
    expect(Object.keys(out).sort()).toEqual(["explanation", "reasoning", "risk", "riskLevel"]);
  });

  for (const [label, bad] of [
    ["a missing field", { explanation: "a", reasoning: "b", risk: "c" }],
    ["an out-of-enum riskLevel", { ...GOOD, riskLevel: "CRITICAL" }],
    ["a lowercase riskLevel", { ...GOOD, riskLevel: "low" }],
    ["a non-string field", { ...GOOD, risk: 7 }],
    ["a non-object", "LOW risk, it just lists files"],
    ["null", null],
    ["undefined", undefined],
    ["an array", [GOOD]],
  ] as const) {
    it(`rejects on ${label}`, async () => {
      await expect(explainCommand(args, fakeTransport(bad))).rejects.toThrow(/malformed/i);
    });
  }

  it("propagates a transport rejection rather than swallowing it", async () => {
    const t = fakeTransport(async () => { throw new Error("upstream 529"); });
    await expect(explainCommand(args, t)).rejects.toThrow("upstream 529");
  });
});

describe("structuredExplainTransport (the no-new-dependency route, probe 98 path C)", () => {
  /** Stands in for src/structured/run.ts's runStructured — never touches the SDK or the network. */
  function fakeRunner(answer: unknown, seen: { schema?: any; prompt?: string; config?: any } = {}) {
    const r = (async (schema: any, prompt: string, config: any) => { seen.schema = schema; seen.prompt = prompt; seen.config = config; return answer; }) as any;
    r.seen = seen; return r as typeof r & { seen: typeof seen };
  }
  const req: ExplainRequest = { system: EXPLAIN_SYSTEM_PROMPT, prompt: "Tool: Bash\n…", schema: EXPLAIN_TOOL_SCHEMA };

  it("drives the structured runner with the four-field schema and returns its object unchanged", async () => {
    const run = fakeRunner({ ...GOOD });
    await expect(structuredExplainTransport({}, run)(req)).resolves.toEqual(GOOD);
    expect(run.seen.prompt).toBe(req.prompt);
    // the zod schema it drives must be the canon input_schema's four fields, same enum
    const shape = run.seen.schema.shape;
    expect(Object.keys(shape).sort()).toEqual(["explanation", "reasoning", "risk", "riskLevel"]);
    expect(shape.riskLevel.options).toEqual(["LOW", "MEDIUM", "HIGH"]);
  });

  it("carries the canon system prompt as an append and fences the nested run", async () => {
    const run = fakeRunner({ ...GOOD });
    await structuredExplainTransport({ model: "claude-haiku-4-5" }, run)(req);
    expect(run.seen.config.appendSystemPrompt).toBe(EXPLAIN_SYSTEM_PROMPT);
    expect(run.seen.config.settingSources).toEqual([]);   // probe 97: default sources drag this machine's config in
    expect(run.seen.config.allowedTools).toEqual([]);
    expect(run.seen.config.forkSubagent).toBe(false);
    expect(run.seen.config.workflow).toBe(false);
    expect(run.seen.config.model).toBe("claude-haiku-4-5"); // caller config still wins on the knobs it sets
  });

  it("forwards the caller's AbortSignal into the run's AbortController", async () => {
    const ac = new AbortController();
    const run = fakeRunner({ ...GOOD });
    const p = structuredExplainTransport({}, run)({ ...req, signal: ac.signal });
    await p;
    expect(run.seen.config.abortController.signal.aborted).toBe(false);
    ac.abort();
    expect(run.seen.config.abortController.signal.aborted).toBe(true);
  });

  it("an already-aborted signal aborts the run's controller immediately", async () => {
    const ac = new AbortController(); ac.abort();
    const run = fakeRunner({ ...GOOD });
    await structuredExplainTransport({}, run)({ ...req, signal: ac.signal });
    expect(run.seen.config.abortController.signal.aborted).toBe(true);
  });
});
