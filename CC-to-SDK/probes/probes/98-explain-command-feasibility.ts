// Probe 98 — can THIS harness build Claude Code's ctrl+e "explain this command" affordance
// (the Bash permission dialog's explainer) while billing the user's Claude SUBSCRIPTION?
//
// Upstream (bundle L504910-942) implements it as ONE non-streaming Anthropic Messages request with
// `tool_choice:{type:"tool",name:"explain_command"}` against the main-loop model, parsing a 4-field
// tool input: explanation / reasoning / risk / riskLevel(LOW|MEDIUM|HIGH). We cannot copy that
// verbatim: `harness/package.json` declares ONLY `@anthropic-ai/claude-agent-sdk`, and sdk.d.ts has
// ZERO `tool_choice`/`toolChoice` — the agent SDK's query() surface cannot force a single tool.
// So the question is which reachable path, if any, produces the same 4 fields on subscription auth:
//
//   A. RAW MESSAGES — `@anthropic-ai/sdk` (transitive peer, 0.104.2) constructed with the OAuth token
//      as `authToken` (Bearer, NOT apiKey/x-api-key) + `anthropic-beta: oauth-2025-04-20` (the header
//      the bundled CLI itself carries: the string is in claude-agent-sdk-darwin-arm64/claude, and the
//      binary's own docs say /v1/messages REQUIRES it for Bearer auth). True forced tool_choice.
//      A1 = bare system prompt. A2 = "You are Claude Code…" spoof system block, tried only if A1 fails.
//   B. NESTED query() FENCED TO ONE IN-PROCESS MCP TOOL — createSdkMcpServer + tool() defining
//      explain_command with the 4-field zod schema, allowedTools restricted to just it. NEAR-forced
//      (the model chooses), so reliability must be measured, not assumed. 3 runs.
//   C. NATIVE STRUCTURED OUTPUT — `outputFormat:{type:"json_schema"}` on a one-shot query(), the path
//      harness/src/structured/run.ts already wraps. No tool at all; the 4 fields come back on
//      result.structured_output. Run alongside B for a like-for-like latency/reliability comparison.
//
// Probe 97's lesson is applied to B and C: `settingSources: []`, or this machine's global agents /
// hooks / skills load into the nested session and derail it.
//
// ANSWER (live run 2026-08-06, claude-haiku-4-5, OAuth token from CC-to-SDK/.env): see the ANSWER
// block at the bottom of this file, written from the recorded run.
import Anthropic from "@anthropic-ai/sdk";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const MODEL = "claude-haiku-4-5-20251001";
const OAUTH_BETA = "oauth-2025-04-20";
const COMMAND = "ls -la";
const RUNS = 3;

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const log = (s: string) => console.log(`[${dt()}] ${s}`);
const hr = (s: string) => console.log(`\n${"=".repeat(78)}\n${s}\n${"=".repeat(78)}`);

/** Never let a credential reach stdout: scrub anything that looks like one out of error text. */
function safe(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-<REDACTED>")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer <REDACTED>");
}
function errShape(e: unknown): Record<string, unknown> {
  const any = e as any;
  return {
    name: any?.name ?? typeof e,
    status: any?.status,
    type: any?.error?.type ?? any?.error?.error?.type,
    message: safe(String(any?.message ?? e)).slice(0, 400),
    requestId: any?.request_id ?? any?.requestID,
  };
}

// ── the shared contract: upstream's 4 fields ────────────────────────────────────────────────────
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const DESCRIPTIONS = {
  explanation: "A clear, concise explanation of what the command does",
  reasoning: "Why this command is being run / what it accomplishes in context",
  risk: "What could go wrong or what the command could affect",
  riskLevel: "Overall risk of running the command",
};
const RAW_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    explanation: { type: "string", description: DESCRIPTIONS.explanation },
    reasoning: { type: "string", description: DESCRIPTIONS.reasoning },
    risk: { type: "string", description: DESCRIPTIONS.risk },
    riskLevel: { type: "string", enum: RISK_LEVELS, description: DESCRIPTIONS.riskLevel },
  },
  required: ["explanation", "reasoning", "risk", "riskLevel"],
};
const ZOD_SHAPE = {
  explanation: z.string().describe(DESCRIPTIONS.explanation),
  reasoning: z.string().describe(DESCRIPTIONS.reasoning),
  risk: z.string().describe(DESCRIPTIONS.risk),
  riskLevel: z.enum(RISK_LEVELS).describe(DESCRIPTIONS.riskLevel),
};
const EXPLAIN_SYSTEM =
  "You explain shell commands for a developer about to approve one. " +
  "Call the explain_command tool exactly once with your analysis. Do not answer in prose.";
const userPrompt = (cmd: string) => `Explain this command: ${cmd}`;

function summarize(v: unknown): string {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return `<non-object: ${JSON.stringify(v)?.slice(0, 120)}>`;
  const keys = Object.keys(o);
  const missing = ["explanation", "reasoning", "risk", "riskLevel"].filter((k) => !(k in o));
  const lens = keys.map((k) => `${k}:${typeof o[k] === "string" ? (o[k] as string).length : "?"}`);
  return `keys=[${keys.join(",")}] missing=[${missing.join(",") || "none"}] lens={${lens.join(" ")}} riskLevel=${String(o.riskLevel)}`;
}

// ── PATH A — raw Messages, forced tool_choice, Bearer(OAuth) ────────────────────────────────────
async function pathA() {
  hr("PATH A — raw @anthropic-ai/sdk Messages with tool_choice + OAuth Bearer");
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  log(`env: CLAUDE_CODE_OAUTH_TOKEN present=${Boolean(token)} len=${token?.length ?? 0} | ANTHROPIC_API_KEY present=${Boolean(process.env.ANTHROPIC_API_KEY)}`);
  if (!token) { log("A: SKIP (no OAuth token in env — run with `set -a; . ../.env; set +a`)"); return; }

  const attempt = async (label: string, system: Array<{ type: "text"; text: string }>, beta: boolean) => {
    const client = new Anthropic({
      apiKey: null,               // do NOT let it fall back to x-api-key / config-file resolution
      authToken: token,           // → Authorization: Bearer <token>
      defaultHeaders: beta ? { "anthropic-beta": OAUTH_BETA } : {},
      maxRetries: 0,
    });
    const started = Date.now();
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system,
        tools: [{ name: "explain_command", description: "Explain a shell command to the user.", input_schema: RAW_TOOL_SCHEMA }],
        tool_choice: { type: "tool", name: "explain_command" },
        messages: [{ role: "user", content: userPrompt(COMMAND) }],
      });
      const ms = Date.now() - started;
      const block = res.content.find((c) => c.type === "tool_use") as any;
      log(`A[${label}] OK in ${ms}ms — stop_reason=${res.stop_reason} blocks=[${res.content.map((c) => c.type).join(",")}] usage=${JSON.stringify(res.usage)}`);
      log(`A[${label}] parsed → ${block ? summarize(block.input) : "NO tool_use BLOCK"}`);
      if (block) console.log(JSON.stringify(block.input, null, 2));
      return true;
    } catch (e) {
      log(`A[${label}] FAILED in ${Date.now() - started}ms — ${JSON.stringify(errShape(e))}`);
      return false;
    }
  };

  const ok1 = await attempt("A1 bare system + beta header", [{ type: "text", text: EXPLAIN_SYSTEM }], true);
  if (!ok1) {
    // Isolate the two variables the CLI differs on: the beta header, and the identity system block.
    await attempt("A1b bare system, NO beta header", [{ type: "text", text: EXPLAIN_SYSTEM }], false);
    await attempt("A2 Claude Code identity block + beta header", [
      { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: "text", text: EXPLAIN_SYSTEM },
    ], true);
  }
}

// ── PATH B — nested query() fenced to one in-process MCP tool ───────────────────────────────────
async function pathB() {
  hr(`PATH B — nested query() fenced to one SDK-MCP tool (${RUNS} runs)`);
  const TOOL = "mcp__explain__explain_command";
  const stats: Array<{ ms: number; called: boolean; keys: string; turns?: number; cost?: number }> = [];

  for (let i = 1; i <= RUNS; i++) {
    let received: unknown = null;
    const server = createSdkMcpServer({
      name: "explain",
      version: "1.0.0",
      tools: [
        tool("explain_command", "Explain a shell command to the user before they approve it.", ZOD_SHAPE,
          async (args) => { received = args; return { content: [{ type: "text", text: "recorded" }] }; }),
      ],
    });

    const started = Date.now();
    let called = false, turns: number | undefined, cost: number | undefined, prose = "";
    const q = query({
      prompt: userPrompt(COMMAND),
      options: {
        model: MODEL,
        settingSources: [],                       // probe 97: default sources inherit this machine's config
        systemPrompt: EXPLAIN_SYSTEM,
        mcpServers: { explain: server },
        allowedTools: [TOOL],
        disallowedTools: ["Bash", "Read", "Glob", "Grep", "Task", "Agent", "WebSearch", "WebFetch"],
        maxTurns: 3,
        canUseTool: async (name, input) => {
          log(`B[run${i}] canUseTool(${name})`);
          return { behavior: "allow", updatedInput: input } as any;
        },
      },
    });
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === "assistant") {
        for (const c of m.message?.content ?? []) {
          if (c.type === "tool_use") { called = true; log(`B[run${i}] tool_use → ${c.name}`); }
          if (c.type === "text" && c.text.trim()) prose += c.text;
        }
      }
      if (m.type === "result") { turns = m.num_turns; cost = m.total_cost_usd; log(`B[run${i}] result subtype=${m.subtype} turns=${m.num_turns} cost=${m.total_cost_usd}`); }
    }
    const ms = Date.now() - started;
    log(`B[run${i}] ${ms}ms called=${called} handlerArgs → ${received ? summarize(received) : "<handler never ran>"}`);
    if (!called && prose) log(`B[run${i}] PROSE INSTEAD: ${JSON.stringify(prose.slice(0, 200))}`);
    if (i === 1 && received) console.log(JSON.stringify(received, null, 2));
    stats.push({ ms, called, keys: received ? Object.keys(received as object).join(",") : "-", turns, cost });
  }
  const hits = stats.filter((s) => s.called).length;
  log(`B SUMMARY: tool called ${hits}/${RUNS}; latencies=[${stats.map((s) => `${s.ms}ms`).join(", ")}]; costs=[${stats.map((s) => s.cost ?? "?").join(", ")}]`);
}

// ── PATH C — native structured output (no tool) ─────────────────────────────────────────────────
async function pathC() {
  hr(`PATH C — one-shot query() with outputFormat json_schema (${RUNS} runs)`);
  const schema = z.object(ZOD_SHAPE);
  const stats: Array<{ ms: number; ok: boolean; cost?: number }> = [];

  for (let i = 1; i <= RUNS; i++) {
    const started = Date.now();
    let out: unknown, subtype = "", cost: number | undefined;
    const q = query({
      prompt: userPrompt(COMMAND),
      options: {
        model: MODEL,
        settingSources: [],
        systemPrompt: "You explain shell commands for a developer about to approve one. Answer only with the structured fields.",
        allowedTools: [],
        maxTurns: 2,
        outputFormat: { type: "json_schema", schema: z.toJSONSchema(schema, { target: "draft-7" }) } as any,
      },
    });
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === "result") { out = m.structured_output; subtype = m.subtype; cost = m.total_cost_usd; }
    }
    const ms = Date.now() - started;
    let ok = false;
    try { schema.parse(out); ok = true; } catch (e) { log(`C[run${i}] zod reject: ${safe(String((e as any).message)).slice(0, 200)}`); }
    log(`C[run${i}] ${ms}ms subtype=${subtype} cost=${cost} valid=${ok} → ${out ? summarize(out) : "<no structured_output>"}`);
    if (i === 1 && out) console.log(JSON.stringify(out, null, 2));
    stats.push({ ms, ok, cost });
  }
  log(`C SUMMARY: valid ${stats.filter((s) => s.ok).length}/${RUNS}; latencies=[${stats.map((s) => `${s.ms}ms`).join(", ")}]; costs=[${stats.map((s) => s.cost ?? "?").join(", ")}]`);
}

// ── ADDENDUM 1 — is path A billed to the SUBSCRIPTION or to metered API credits? ────────────────
// A 200 alone doesn't answer it. The rate-limit response headers do: subscription (OAuth/"unified")
// traffic is metered by `anthropic-ratelimit-unified-*`, metered API traffic by the classic
// `anthropic-ratelimit-{requests,input-tokens,output-tokens}-*` family. Header NAMES + numeric
// values only — never the request's auth header.
async function addendumBilling() {
  hr("ADDENDUM 1 — billing attribution of path A (response rate-limit headers)");
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) { log("SKIP (no OAuth token)"); return; }
  const client = new Anthropic({
    apiKey: null, authToken: token,
    defaultHeaders: { "anthropic-beta": OAUTH_BETA }, maxRetries: 0,
  });
  const { response, data } = await client.messages
    .create({
      model: MODEL, max_tokens: 512, system: [{ type: "text", text: EXPLAIN_SYSTEM }],
      tools: [{ name: "explain_command", description: "Explain a shell command to the user.", input_schema: RAW_TOOL_SCHEMA }],
      tool_choice: { type: "tool", name: "explain_command" },
      messages: [{ role: "user", content: userPrompt("git status") }],
    })
    .withResponse();
  const rl: Record<string, string> = {};
  response.headers.forEach((v, k) => { if (k.startsWith("anthropic-ratelimit") || k === "anthropic-organization-id") rl[k] = v; });
  log(`stop_reason=${data.stop_reason} — rate-limit headers:`);
  console.log(JSON.stringify(rl, null, 2));
  const unified = Object.keys(rl).some((k) => k.includes("unified"));
  log(`VERDICT: ${unified ? "UNIFIED (subscription) rate-limit family present" : "classic per-token API rate-limit family only"}`);
}

// ── ADDENDUM 2 — path B lost ~5s to a ToolSearch round-trip (SDK-MCP tools defer by default).
// `alwaysLoad: true` is supposed to pin the tool into the prompt. Does it remove the hop?
async function addendumAlwaysLoad() {
  hr("ADDENDUM 2 — path B with alwaysLoad:true (does the ToolSearch hop disappear?)");
  let received: unknown = null;
  const server = createSdkMcpServer({
    name: "explain", version: "1.0.0", alwaysLoad: true,
    tools: [tool("explain_command", "Explain a shell command to the user before they approve it.", ZOD_SHAPE,
      async (args) => { received = args; return { content: [{ type: "text", text: "recorded" }] }; },
      { alwaysLoad: true })],
  });
  const started = Date.now();
  const seen: string[] = [];
  const q = query({
    prompt: userPrompt(COMMAND),
    options: {
      model: MODEL, settingSources: [], systemPrompt: EXPLAIN_SYSTEM,
      mcpServers: { explain: server }, allowedTools: ["mcp__explain__explain_command"],
      disallowedTools: ["Bash", "Read", "Glob", "Grep", "Task", "Agent", "WebSearch", "WebFetch", "ToolSearch"],
      maxTurns: 3,
    },
  });
  for await (const m of q as AsyncIterable<any>) {
    if (m.type === "assistant") for (const c of m.message?.content ?? []) if (c.type === "tool_use") { seen.push(c.name); log(`tool_use → ${c.name}`); }
    if (m.type === "result") log(`result subtype=${m.subtype} turns=${m.num_turns} cost=${m.total_cost_usd}`);
  }
  log(`${Date.now() - started}ms toolSequence=[${seen.join(",")}] handlerArgs → ${received ? summarize(received) : "<never ran>"}`);
}

async function main() {
  const phases = process.argv.slice(2);
  const want = (p: string) => phases.length === 0 || phases.includes(p);
  log(`probe 98 start — model=${MODEL} command=${JSON.stringify(COMMAND)} phases=${phases.join(",") || "all"}`);
  if (want("A")) await pathA().catch((e) => log(`A threw: ${JSON.stringify(errShape(e))}`));
  if (want("B")) await pathB().catch((e) => log(`B threw: ${JSON.stringify(errShape(e))}`));
  if (want("C")) await pathC().catch((e) => log(`C threw: ${JSON.stringify(errShape(e))}`));
  if (want("bill")) await addendumBilling().catch((e) => log(`billing addendum threw: ${JSON.stringify(errShape(e))}`));
  if (want("load")) await addendumAlwaysLoad().catch((e) => log(`alwaysLoad addendum threw: ${JSON.stringify(errShape(e))}`));
  hr("done");
}
main();

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ANSWER (live, 2026-08-06, claude-haiku-4-5-20251001, OAuth token from CC-to-SDK/.env)
//
// YES — ctrl+e explain is buildable, and PATH A REPRODUCES UPSTREAM EXACTLY, on subscription billing.
//
// A ✅ FIRST TRY. `new Anthropic({apiKey:null, authToken:<oauth>, defaultHeaders:{"anthropic-beta":
//   "oauth-2025-04-20"}})` + real `tool_choice:{type:"tool",name:"explain_command"}`.
//   HTTP 200 in 2798 ms; stop_reason=tool_use; content blocks = [tool_use] ONLY (no prose preamble);
//   usage 811 in / 209 out; all four fields present and well-formed, riskLevel="LOW".
//   No "You are Claude Code" identity spoof was needed — A2 never had to run.
//   BILLING PROVEN, not assumed: the response carries the UNIFIED rate-limit family
//   (anthropic-ratelimit-unified-5h-utilization 0.47, -7d-utilization 0.67, -representative-claim
//   "five_hour", -overage-status "rejected" / -overage-disabled-reason "out_of_credits"), i.e. it is
//   metered against the Pro/Max subscription window. The classic per-token API-credit rate-limit
//   headers are absent — and the org has no credits to spend, so it cannot silently be billing them.
//
// B ✅ works, 5× slower, and near-forcing held. Tool called 3/3 runs (100%), never prose.
//   Wall clock 15752 / 13891 / 15098 ms. The handler received exactly the 4 zod fields each time.
//   Default SDK-MCP tools DEFER: every run burned a `ToolSearch` round-trip before the real call.
//   ADDENDUM 2 (alwaysLoad:true on both server and tool) removed that hop — tool sequence became
//   [mcp__explain__explain_command] alone — but wall clock was unchanged at 14997 ms, so the cost is
//   subprocess spawn + session init, not the extra hop. Also note canUseTool is SHADOWED by bare
//   allowedTools entries (SDK warning CLAUDE_SDK_CAN_USE_TOOL_SHADOWED).
//
// C ✅ works: `outputFormat:{type:"json_schema"}` (what harness/src/structured/run.ts already wraps).
//   3/3 valid against the zod schema. 6485 / 5819 / 7151 ms — ~2.3× faster than B, still ~2.3×
//   slower than A, because it also spawns the CLI subprocess.
//
// RECOMMENDATION: Path A, with Path C as the no-new-dependency fallback. A is the only one that is
// genuinely FORCED (server-side tool_choice) rather than merely persuaded, and at ~2.8 s it is the
// only latency a human holding down ctrl+e will tolerate. Costs of A: `@anthropic-ai/sdk` must be
// promoted from transitive peer to a declared harness dependency, and the harness must source the
// bearer credential itself — CLAUDE_CODE_OAUTH_TOKEN when set (long-lived, what this project uses),
// otherwise ~/.claude/.credentials.json → claudeAiOauth.accessToken, which EXPIRES (~12 h; the file
// also carries refreshToken/expiresAt and the CLI refreshes via /v1/oauth/token) and would have to be
// refreshed or re-read. If that credential plumbing is judged not worth it, ship C: same 4 fields,
// zero new dependencies, ~6 s.
