import { DEFAULTS, type HarnessConfig } from "./types.js";
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
  if (config.hooks) options.hooks = config.hooks;
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
  return { ...options, ...(config.extraOptions ?? {}) };
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
