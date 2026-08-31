import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { HarnessConfig } from "./config/types.js";
import { resolveOptions, stampMcpTimeouts } from "./config/resolveOptions.js";
import { validateHarnessConfig } from "./config/validate.js";
import { TaskStore } from "./tasks/store.js";
import { createTaskMcpServer } from "./tasks/server.js";
import { SwarmRuntime } from "./swarm/runtime.js";
import { createSwarmMcpServer } from "./swarm/server.js";
import { applyCoordinatorPersona, NATIVE_TASK_TOOLS } from "./swarm/coordinator.js";
import { withContextTool, type QueryHolder, type RawContextUsage } from "./context/server.js";
import { normalizeTurnInput, type UserTurnInput } from "./session/turnInput.js";
import { oneShotUserTurn } from "./session/session.js";

export interface HarnessDeps { query?: typeof sdkQuery; }

export interface RunResult { result: unknown; messages: unknown[]; sessionId?: string; }

export interface Harness {
  options: Record<string, unknown>;
  run(prompt: UserTurnInput): Promise<RunResult>;
  stream(prompt: UserTurnInput): AsyncGenerator<unknown>;
  rewind(userMessageId: string, opts?: { dryRun?: boolean }): Promise<unknown>;
  supportedCommands(): Promise<unknown>;
  supportedModels(): Promise<unknown>;
  supportedAgents(): Promise<unknown>;
  getContextUsage(): Promise<unknown>;
  accountInfo(): Promise<unknown>;
  usage(): Promise<unknown>;
  initializationResult(): Promise<unknown>;
  tasks?: TaskStore;
  swarm?: SwarmRuntime;
}

export function createHarness(config: HarnessConfig = {}, deps: HarnessDeps = {}): Harness {
  validateHarnessConfig(config);
  const query = deps.query ?? sdkQuery;
  const options = resolveOptions(config);

  let tasks: TaskStore | undefined;
  let swarm: SwarmRuntime | undefined;
  let ctxHolder: QueryHolder | undefined;

  if (config.swarm) {
    const so = config.swarm === true ? {} : config.swarm;
    const to = config.taskTools && config.taskTools !== true ? config.taskTools : {};
    swarm = new SwarmRuntime({ query }, { cwd: config.cwd, taskOptions: to, permissions: so.permissions });
    tasks = swarm.tasks; // share the runtime's store with cc-tasks if enabled
    const existing = (options.mcpServers as Record<string, unknown>) ?? {};
    options.mcpServers = { ...existing, "cc-swarm": createSwarmMcpServer(swarm) };
    // Disable native per-session Task tools so the shared cc-tasks store is authoritative (avoids split-brain).
    const dis = (options.disallowedTools as string[] | undefined) ?? [];
    options.disallowedTools = [...new Set([...dis, ...NATIVE_TASK_TOOLS])];
    if (so.coordinatorPersona) applyCoordinatorPersona(options, so.tools);
  }

  if (config.taskTools) {
    const opts = config.taskTools === true ? {} : config.taskTools;
    tasks = tasks ?? new TaskStore({ cwd: config.cwd, dir: opts.dir, listId: opts.listId, agentName: opts.agentName });
    const existing = (options.mcpServers as Record<string, unknown>) ?? {};
    options.mcpServers = { ...existing, "cc-tasks": createTaskMcpServer(tasks) };
    // Same-named NATIVE tools shadow MCP tools (the D3 lesson) — on CLI 2.1.211 the model demonstrably
    // picks native TaskCreate over the deferred mcp__cc-tasks__TaskCreate, writing to the WRONG store.
    // Disallow the native set so the durable store is authoritative (matches swarm/daemon paths).
    const dis = (options.disallowedTools as string[] | undefined) ?? [];
    options.disallowedTools = [...new Set([...dis, ...NATIVE_TASK_TOOLS])];
  }
  // Re-stamp AFTER cc-swarm/cc-tasks joined and BEFORE cc-context does: the injected introspection
  // tools are exempt from `mcpToolTimeoutMs` by design (see the knob's jsdoc); a server that already
  // carries a timeout — including everything resolveOptions stamped — keeps it.
  if (config.mcpToolTimeoutMs !== undefined && options.mcpServers)
    options.mcpServers = stampMcpTimeouts(options.mcpServers as Record<string, unknown>, config.mcpToolTimeoutMs);
  if (config.contextTool) {
    ctxHolder = {};
    const merged = withContextTool(options, ctxHolder);
    options.mcpServers = merged.mcpServers;
    options.allowedTools = merged.allowedTools;
  }
  // A Harness drives ONE query at a time; `active` tracks the most recent one.
  // Control methods (rewind/supported*) are SDK control requests that require an
  // OPEN transport (sdk.d.ts:2242, streaming mode) — call them while a query is
  // still streaming, not after run() completes. Concurrent/interactive multi-session
  // use (per-query control handles) is a Phase-2 concern.
  let active: any = null;

  /** The array case switches `query()` into STREAMING-INPUT mode — that is a real behavioural difference,
   *  not a type detail (probe 100's `oneTurn` uses the same shape and settles cleanly). A string prompt
   *  keeps the string form, but it does NOT keep its length unchecked: this arm never reaches Session's
   *  builder (`query()` is handed the string directly), so it calls the same normalizer itself. That is
   *  what makes MAX_TOTAL_TEXT bind `run`, `stream` and — through `harness.run` — `runStructured`. */
  function start(prompt: UserTurnInput) {
    const p = typeof prompt === "string"
      ? (normalizeTurnInput(prompt) as string)
      : (async function* () { yield oneShotUserTurn(prompt); })();
    active = query({ prompt: p as any, options: options as any });
    if (ctxHolder) ctxHolder.query = active as { getContextUsage(): Promise<RawContextUsage> };
    return active;
  }

  async function* stream(prompt: UserTurnInput) {
    const q = start(prompt);
    for await (const m of q) yield m;
  }

  async function run(prompt: UserTurnInput): Promise<RunResult> {
    const messages: unknown[] = [];
    let result: unknown; let sessionId: string | undefined;
    for await (const m of stream(prompt)) {
      messages.push(m);
      const mm = m as any;
      if (mm.type === "system" && mm.subtype === "init") sessionId = mm.session_id;
      if ("result" in mm) result = mm.result;
    }
    return { result, messages, sessionId };
  }

  const call = (name: string) => async (...args: any[]) => {
    if (!active || typeof active[name] !== "function")
      throw new Error(`${name}() unavailable: start a query first`);
    return active[name](...args);
  };

  return {
    options,
    run,
    stream,
    rewind: (id, opts) => call("rewindFiles")(id, opts),
    supportedCommands: call("supportedCommands"),
    supportedModels: call("supportedModels"),
    supportedAgents: call("supportedAgents"),
    getContextUsage: call("getContextUsage"),
    accountInfo: call("accountInfo"),
    usage: call("usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"),
    initializationResult: call("initializationResult"),
    tasks,
    swarm,
  };
}

/** Resume a prior session by id: a thin wrapper over createHarness with `resume` set.
 *  Stateless — the returned handle applies `sessionId` to EVERY run() it makes, so the idiomatic
 *  use is ONE continuation run per handle; thread the returned run().sessionId forward for the next
 *  turn (for linear multi-turn, prefer the daemon's long-lived session). */
export function resumeHarness(sessionId: string, config: HarnessConfig = {}, deps?: HarnessDeps): Harness {
  return createHarness({ ...config, resume: sessionId }, deps);
}
