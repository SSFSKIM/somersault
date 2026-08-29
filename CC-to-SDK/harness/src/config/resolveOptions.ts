import { DEFAULTS, MCP_NO_PREFIX_ENV, type HarnessConfig } from "./types.js";
import { resolveSettings } from "./settings.js";
import { resolveSystemPrompt } from "./outputStyle.js";
import { resolveSandbox } from "./sandbox.js";
import { resolveProviderEnv } from "./provider.js";
import { resolveTelemetryEnv } from "./telemetry.js";
import { resolveTools } from "./tools.js";
import { resolveAgents } from "./agents.js";
import { resolveAutoModel } from "./autoModel.js";
import { resolveModelAlias } from "./models.js";
import { createPermissionGate } from "../permissions/gate.js";
import { mergeHooks } from "../hooks/merge.js";
import { buildModelSwitchHooks } from "../hooks/modelSwitch.js";

/** The four keys `extraOptions` may NOT overwrite once this function has computed one.
 *
 *  `extraOptions` is spread LAST on purpose — it is the escape hatch for SDK options this config has no
 *  first-class field for, and features rely on it winning. That ordering is only safe while ONE actor writes
 *  the whole config. It is not: the app server builds a config AROUND a client-supplied one (`server.ts`'s
 *  `buildConfig` injects the decision broker and the elicitation bridge; `review.ts`'s `reviewConfig`
 *  re-roots `cwd` and adds the read-only denials), and the client's own `extraOptions` travels inside it. So
 *  for these keys "the hatch wins" meant a client could switch off a guarantee the server established for
 *  someone else — a review pointed at another tree, its edit tools handed back, every parked decision
 *  auto-approved, an MCP elicitation that never reaches a client.
 *
 *  WHY A NAMED LIST RATHER THAN REVERSING THE SPREAD: reversing it would make every typed field beat the
 *  hatch and break its whole purpose. These four are the ones where the value is a POLICY the server owns
 *  rather than a preference the caller expressed — the isolation boundary (`cwd`), the read-only tool policy
 *  (`disallowedTools`), and the two callbacks that are the only path a question takes to a human
 *  (`canUseTool`, `onElicitation`). Everything else, security-adjacent or not, stays overridable: a
 *  `sandbox` or a `permissionMode` is the same client's own choice arriving by another route, so there is no
 *  boundary being crossed there.
 *
 *  RE-ASSERTED ONLY WHERE SOMETHING WAS COMPUTED. A key the typed config never set is absent from `options`
 *  and the hatch still wins it outright — there is no guarantee to defeat in that case, which keeps this from
 *  quietly becoming a blocklist. */
const SERVER_OWNED = ["cwd", "disallowedTools", "canUseTool", "onElicitation"] as const;

// Produces a plain object that is structurally the SDK `Options`.
export function resolveOptions(config: HarnessConfig): Record<string, unknown> {
  const settings = resolveSettings(config);
  const systemPrompt = resolveSystemPrompt(config, settings.systemPromptExcludeDynamic);
  const tools = resolveTools(config);
  const sandbox = resolveSandbox(config);
  // Telemetry lowest precedence: provider flags can't collide with OTEL_* keys, but a user env
  // override (config.env, merged last inside resolveProviderEnv) should win over the typed config.
  const env = { ...resolveTelemetryEnv(config.telemetry), ...resolveProviderEnv(config) };
  // Unlock the native fork subagent (paired with the FORK_SUBAGENT_NOTE in systemPrompt — both required, 33d).
  if (config.forkSubagent ?? DEFAULTS.forkSubagent) env.CLAUDE_CODE_FORK_SUBAGENT = "1";
  const agents = resolveAgents(config);

  const options: Record<string, unknown> = {
    settingSources: settings.settingSources,
    systemPrompt,
    tools: tools.tools,
    agents,
    // SDK contract (live-verified W3.3): enableFileCheckpointing is REJECTED alongside sessionStore
    // ("backup blobs are not mirrored"). With a store, default it off; an explicit true still passes
    // through so the caller gets the SDK's own error rather than a silent override.
    enableFileCheckpointing: config.enableFileCheckpointing ?? (config.sessionStore ? false : DEFAULTS.enableFileCheckpointing),
  };
  if (settings.settings) options.settings = settings.settings;
  if (settings.managedSettings) options.managedSettings = settings.managedSettings;
  if (tools.allowedTools) options.allowedTools = tools.allowedTools;
  if (tools.disallowedTools) options.disallowedTools = tools.disallowedTools;
  if (tools.toolAliases) options.toolAliases = tools.toolAliases;
  if (sandbox) options.sandbox = sandbox;
  // SDK contract (sdk.d.ts): a provided `env` REPLACES the subprocess environment
  // entirely — it is NOT merged with process.env. Spread process.env first so our
  // provider flags/overrides augment (not erase) PATH/HOME/ANTHROPIC_API_KEY/etc.
  if (Object.keys(env).length) options.env = { ...process.env, ...env };
  // Alias FIRST, then default: a tier name ("opus") becomes an explicit id here, so downstream — the auto
  // gate below, the daemon roster, the status bar — never sees a word the SDK would resolve to an older model.
  const model = resolveModelAlias(config.model) ?? DEFAULTS.model;
  options.model = model;
  if (config.fallbackModel) options.fallbackModel = resolveModelAlias(config.fallbackModel);
  if (config.maxTurns !== undefined) options.maxTurns = config.maxTurns;
  const effort = config.effort ?? DEFAULTS.effort;
  if (effort) options.effort = effort;
  if (config.thinking) options.thinking = config.thinking;
  if (config.outputFormat) options.outputFormat = config.outputFormat;
  if (config.maxBudgetUsd !== undefined) options.maxBudgetUsd = config.maxBudgetUsd;
  if (config.taskBudget) options.taskBudget = config.taskBudget;
  if (config.includePartialMessages) options.includePartialMessages = config.includePartialMessages;
  if (config.forwardSubagentText) options.forwardSubagentText = config.forwardSubagentText;
  const mode = config.permissionMode ?? DEFAULTS.permissionMode;
  if (mode) options.permissionMode = mode;
  // `auto` is MODEL-GATED (see autoModel.ts's live-verified set). Force a supported model ONLY when the
  // caller EXPLICITLY chose auto — do NOT run the gate when auto is merely the default, or an explicit
  // non-auto-capable model (e.g. haiku) would be silently overridden to sonnet. The default is auto-capable.
  if (config.permissionMode === "auto") options.model = resolveAutoModel(model);
  // SDK contract: bypassPermissions REQUIRES allowDangerouslySkipPermissions. Centralized here.
  if (mode === "bypassPermissions") options.allowDangerouslySkipPermissions = true;
  if (config.permissionBroker) options.canUseTool = createPermissionGate(config.permissionBroker);
  if (config.mcpServers) options.mcpServers = config.mcpServers;
  if (config.plugins) options.plugins = config.plugins;
  if (config.cwd) options.cwd = config.cwd;
  if (config.resume) options.resume = config.resume;
  if (config.resumeAt) options.resumeSessionAt = config.resumeAt;
  if (config.droppedTurnUuid) options.resumeDropsTurn = config.droppedTurnUuid;
  if (config.forkSession !== undefined) options.forkSession = config.forkSession;
  if (config.persistSession !== undefined) options.persistSession = config.persistSession;
  if (config.sessionStore) options.sessionStore = config.sessionStore;
  if (config.sessionStoreFlush) options.sessionStoreFlush = config.sessionStoreFlush;
  if (config.sessionStoreLoadTimeoutMs !== undefined) options.loadTimeoutMs = config.sessionStoreLoadTimeoutMs;
  // Model-switch governance (Wave D): the policy's Pre/PostModelSwitch fragment joins the user's own
  // hooks — user fragments first, policy appended; both run and a deny from either wins at the SDK.
  if (config.modelSwitchPolicy) options.hooks = mergeHooks(config.hooks ?? {}, buildModelSwitchHooks(config.modelSwitchPolicy));
  else if (config.hooks) options.hooks = config.hooks;
  // Wave-4 knob sweep — one-line passthroughs (probe verdicts in types.ts jsdoc).
  if (config.sessionId) options.sessionId = config.sessionId;
  if (config.title) options.title = config.title;
  if (config.continueSession !== undefined) options.continue = config.continueSession;
  if (config.abortController) options.abortController = config.abortController;
  if (config.agent) options.agent = config.agent;
  if (config.additionalDirectories) options.additionalDirectories = config.additionalDirectories;
  if (config.skills !== undefined) options.skills = config.skills;
  if (config.toolConfig) options.toolConfig = config.toolConfig;
  if (config.strictMcpConfig !== undefined) options.strictMcpConfig = config.strictMcpConfig;
  if (config.betas) options.betas = config.betas;
  if (config.maxThinkingTokens !== undefined) options.maxThinkingTokens = config.maxThinkingTokens;
  if (config.planModeInstructions) options.planModeInstructions = config.planModeInstructions;
  if (config.permissionPromptToolName) options.permissionPromptToolName = config.permissionPromptToolName;
  if (config.onElicitation) options.onElicitation = config.onElicitation;
  if (config.onUserDialog) options.onUserDialog = config.onUserDialog;
  if (config.supportedDialogKinds) options.supportedDialogKinds = config.supportedDialogKinds;
  if (config.perTaskStopAffordance !== undefined) options.perTaskStopAffordance = config.perTaskStopAffordance;
  if (config.spawnClaudeCodeProcess) options.spawnClaudeCodeProcess = config.spawnClaudeCodeProcess;
  if (config.pathToClaudeCodeExecutable) options.pathToClaudeCodeExecutable = config.pathToClaudeCodeExecutable;
  if (config.executable) options.executable = config.executable;
  if (config.executableArgs) options.executableArgs = config.executableArgs;
  if (config.extraArgs) options.extraArgs = config.extraArgs;
  if (config.stderr) options.stderr = config.stderr;
  if (config.debug !== undefined) options.debug = config.debug;
  if (config.debugFile) options.debugFile = config.debugFile;
  if (config.includeHookEvents !== undefined) options.includeHookEvents = config.includeHookEvents;
  if (config.promptSuggestions !== undefined) options.promptSuggestions = config.promptSuggestions;
  if (config.agentProgressSummaries !== undefined) options.agentProgressSummaries = config.agentProgressSummaries;
  const merged = { ...options, ...(config.extraOptions ?? {}) };
  for (const key of SERVER_OWNED) if (key in options) merged[key] = options[key];
  // M7 — THE SERVER-OWNED DYNAMIC-TOOL OVERLAY, and it is merged HERE, on the returned object, for a
  // reason the SERVER_OWNED list above cannot serve: this is not a typed field the hatch might overwrite,
  // it is a set of servers that must join whatever `mcpServers` ended up being — the caller's, or the one
  // `extraOptions` replaced them with. A merge before the hatch would let a client's own `mcpServers` key
  // erase the whole overlay with nothing raised anywhere; the model would simply never be offered the
  // tools the thread declared. Spread into a NEW object so no caller's map is mutated.
  //   The env line beside it is the same reasoning applied to the one flag the naming scheme rests on: a
  // truthy CLAUDE_AGENT_SDK_MCP_NO_PREFIX strips the `mcp__<server>__` prefix and collapses every declared
  // namespace together, and an `extraOptions.env` replaces the env wholesale — including the falsification
  // the app server already wrote onto this config.
  if (config.dynamicToolServers) {
    merged.mcpServers = { ...(merged.mcpServers as Record<string, unknown> | undefined), ...config.dynamicToolServers };
    // `process.env` when the merge left no env at all (an `extraOptions.env: undefined`): a bare one-key env
    // would REPLACE the subprocess environment — PATH and the credentials with it — where the SDK's own
    // default is to inherit. Same base the typed path uses above.
    const base = typeof merged.env === "object" && merged.env !== null ? merged.env as Record<string, unknown> : process.env;
    merged.env = { ...base, [MCP_NO_PREFIX_ENV]: "" };
  }
  // Stamped LAST so it covers whatever `mcpServers` ended up being — the typed field, an
  // `extraOptions` replacement, or the M7 overlay just merged above. `harness.ts` re-stamps after it
  // attaches cc-tasks/cc-swarm, which join the map after this function returns.
  if (config.mcpToolTimeoutMs !== undefined && merged.mcpServers)
    merged.mcpServers = stampMcpTimeouts(merged.mcpServers as Record<string, unknown>, config.mcpToolTimeoutMs);
  return merged;
}

/** Stamp `timeout` onto every MCP server config that does not declare its own (a declared value always
 *  wins). New objects throughout — no caller's map or server config is mutated. The SDK declares
 *  `timeout` on all five server shapes, so all five are stamped: `type:"sdk"` instances, stdio configs
 *  (explicit `type:"stdio"` or the type-less `command` form), and `type:"http"` / `type:"sse"` remotes. */
export function stampMcpTimeouts(servers: Record<string, unknown>, timeoutMs: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    const c = cfg as Record<string, unknown> | null;
    const stampable = c && typeof c === "object" && c.timeout === undefined
      && (c.type === "sdk" || c.type === "stdio" || c.type === "http" || c.type === "sse"
        || (c.type === undefined && typeof c.command === "string"));
    out[name] = stampable ? { ...c, timeout: timeoutMs } : cfg;
  }
  return out;
}

/** The permission mode the engine will ACTUALLY start in for this config — the host's initial mode
 *  truth (spec: one mode field, seeded here so a fresh client's status bar never shows a placeholder). */
export function resolvedPermissionMode(config: HarnessConfig): string {
  return String((resolveOptions(config) as { permissionMode?: string }).permissionMode ?? "default");
}

/** The model the engine will ACTUALLY run for this config, read back the same way — so a caller that has
 *  to reason about model-gated behaviour (the host's plan-upgrade applier and `auto`) sees the alias
 *  resolution, the DEFAULTS fallback and the explicit-auto swap above, not the raw config field. */
export function resolvedModel(config: HarnessConfig): string | undefined {
  const m = (resolveOptions(config) as { model?: unknown }).model;
  return typeof m === "string" ? m : undefined;
}
