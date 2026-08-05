// tui/dialogs/explainCommand.ts — the ctrl+e "explain this command" generator (canon `bsl`, L504910-42).
//
// Upstream issues ONE non-streaming Messages request against the main-loop model with a real
// `tool_choice:{type:"tool",name:"explain_command"}` and parses the forced tool's 4-field input.
// The agent SDK's query() surface has no tool_choice at all, so that exact call is not reachable from
// this harness's declared dependency set. Probe 98 (live, 2026-08-06) measured the three routes that ARE
// reachable and spec W-T13 records the choice: native structured output (`outputFormat: json_schema`,
// already wrapped by src/structured/run.ts) — 3/3 well-formed in ~6 s with ZERO new dependencies.
// The raw-Messages route is faster (2.8 s) but costs promoting `@anthropic-ai/sdk` from transitive peer
// to declared dependency AND making the harness source an OAuth bearer credential itself; the nested
// query()-fenced-to-an-MCP-tool route works 3/3 but takes 14-16 s (CLI subprocess spawn dominates).
//
// So the transport is INJECTED and UNDEFAULTED: `explainCommand` owns the contract (system prompt,
// user prompt, forced-tool schema, abort signal) and validates the four fields itself, and swapping in
// the faster route later is a one-file change. Note the shape difference the injection hides: structured
// output returns the object directly, the raw route returns it inside a tool_use block — either way the
// transport hands back a bare `unknown` and the validation below is the single gate.

import { z } from "zod";
import type { HarnessConfig } from "../../config/types.js";
import type { HarnessDeps } from "../../harness.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export interface Explanation { explanation: string; reasoning: string; risk: string; riskLevel: RiskLevel }

/** Canon `bsl`'s destructured argument (minus `messages` — see buildExplainPrompt). */
export interface ExplainArgs { toolName: string; toolInput: unknown; toolDescription?: string; signal?: AbortSignal }

/** What a transport is asked to fulfil: one shot, these three strings, this schema. */
export interface ExplainRequest { system: string; prompt: string; schema: typeof EXPLAIN_TOOL_SCHEMA; signal?: AbortSignal }
/** Returns the raw four-field object (or anything else — `explainCommand` is the validator). */
export type ExplainTransport = (req: ExplainRequest) => Promise<unknown>;

/** L504943. */
export const EXPLAIN_SYSTEM_PROMPT = "Analyze shell commands and explain what they do, why you're running them, and potential risks.";

/** L504955 — the forced tool. */
export const EXPLAIN_TOOL_SCHEMA = {
  name: "explain_command",
  description: "Provide an explanation of a shell command",
  input_schema: {
    type: "object",
    properties: {
      explanation: { type: "string", description: "What this command does (1-2 sentences)" },
      reasoning: { type: "string", description: "Why YOU are running this command. Start with \"I\" - e.g. \"I need to check the file contents\"" },
      risk: { type: "string", description: "What could go wrong, under 15 words" },
      riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "LOW (safe dev workflows), MEDIUM (recoverable changes), HIGH (dangerous/irreversible)" },
    },
    required: ["explanation", "reasoning", "risk", "riskLevel"],
  },
} as const;

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const; // kept in step with the schema's enum by explain-command.test.ts

/** `XQf` L505005-505014. */
export function riskLabel(level: Explanation["riskLevel"]): string { return level === "LOW" ? "Low risk" : level === "MEDIUM" ? "Med risk" : "High risk"; }
/** `YQf` L504995-505004 — theme role names, resolved by the caller's `role()`. */
export function riskColorRole(level: Explanation["riskLevel"]): "success" | "warning" | "error" { return level === "LOW" ? "success" : level === "MEDIUM" ? "warning" : "error"; }

/** `d6b` L504885-92: strings go in verbatim; everything else is pretty JSON, degrading to String(). */
function serializeInput(input: unknown): string {
  if (typeof input === "string") return input;
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

/** L504915-24. Upstream also splices a "Recent conversation context:" block built from the last three
 *  assistant messages, but BOTH consult sites call the generator with `messages: […] ?? []` (L505027),
 *  so that branch is unreachable in practice and is omitted here. Its surrounding blank line is kept, so
 *  this is byte-identical to what upstream produces on every real call. */
export function buildExplainPrompt({ toolName, toolInput, toolDescription }: ExplainArgs): string {
  return `Tool: ${toolName}
${toolDescription ? `Description: ${toolDescription}
` : ""}
Input:
${serializeInput(toolInput)}


Explain this command in context.`;
}

function parse(value: unknown): Explanation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const { explanation, reasoning, risk, riskLevel } = v;
  if (typeof explanation !== "string" || typeof reasoning !== "string" || typeof risk !== "string") return null;
  if (typeof riskLevel !== "string" || !(RISK_LEVELS as readonly string[]).includes(riskLevel)) return null;
  return { explanation, reasoning, risk, riskLevel: riskLevel as RiskLevel }; // rebuilt field-by-field: no extras survive
}

/** One explanation, or a rejection. Upstream logs + returns null on a parse failure (L504935-38); we
 *  reject instead so the caller can distinguish "still loading" from "unavailable" without a sentinel. */
export async function explainCommand(args: ExplainArgs, transport: ExplainTransport): Promise<Explanation> {
  const raw = await transport({ system: EXPLAIN_SYSTEM_PROMPT, prompt: buildExplainPrompt(args), schema: EXPLAIN_TOOL_SCHEMA, signal: args.signal });
  const parsed = parse(raw);
  if (!parsed) throw new Error("explain: malformed explanation result");
  return parsed;
}

// ── the shipping transport: native structured output, zero new dependencies ──────────────────────
// `runStructured` is typed on a zod schema (it derives the JSON schema itself via z.toJSONSchema), so
// the canon `input_schema` cannot be handed to it literally — EXPLAIN_OUTPUT_SCHEMA below mirrors it
// field for field, taking its descriptions FROM the canon object so the two cannot drift.

const P = EXPLAIN_TOOL_SCHEMA.input_schema.properties;
export const EXPLAIN_OUTPUT_SCHEMA = z.object({
  explanation: z.string().describe(P.explanation.description),
  reasoning: z.string().describe(P.reasoning.description),
  risk: z.string().describe(P.risk.description),
  riskLevel: z.enum(RISK_LEVELS).describe(P.riskLevel.description),
});

/** Structurally `runStructured` (src/structured/run.ts), injected so this file stays SDK-free at load. */
export type StructuredRunner = (schema: z.ZodType, prompt: string, config?: HarnessConfig, deps?: HarnessDeps) => Promise<unknown>;

export function structuredExplainTransport(config: HarnessConfig = {}, run?: StructuredRunner): ExplainTransport {
  return async (req) => {
    const runner = run ?? (await import("../../structured/run.js")).runStructured as StructuredRunner;
    // AbortSignal in, AbortController out: HarnessConfig owns the controller, the caller owns the signal.
    const abortController = new AbortController();
    if (req.signal) {
      if (req.signal.aborted) abortController.abort();
      else req.signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }
    // caller config first: the fences below are NOT overridable, but model/cwd/provider/… still apply.
    return runner(EXPLAIN_OUTPUT_SCHEMA, req.prompt, {
      ...config,
      // fenced: probe 97 — the default setting sources drag this machine's agents/hooks/skills into the
      // nested run; the fork/workflow notes are irrelevant system-prompt weight for a one-shot explainer.
      settingSources: [], allowedTools: [], maxTurns: 2, forkSubagent: false, workflow: false,
      // upstream's `system` is the whole system prompt; the harness seam can only APPEND to the
      // claude_code preset, which keeps the CLI's own identity in front of it.
      appendSystemPrompt: req.system, abortController,
    });
  };
}
