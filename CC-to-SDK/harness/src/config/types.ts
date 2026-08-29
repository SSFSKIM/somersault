import type {
  AgentDefinition, McpServerConfig, PermissionMode, SdkPluginConfig, SessionStore, EffortLevel, ThinkingConfig,
  SdkBeta, ToolConfig, OnElicitation, OnUserDialog, SpawnOptions, SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import type { HooksMap } from "../hooks/types.js";
import type { PermissionBroker } from "../permissions/types.js";
import type { TelemetryConfig } from "./telemetry.js";

export type SettingSource = "user" | "project" | "local";

export interface HarnessConfig {
  cwd?: string;
  model?: string;
  fallbackModel?: string;
  // bl7 T-ADVISOR task 1 (D6/D7): the server-side advisor tool's model, folded into `settings` at
  // settings.ts (lands on the SDK's Settings.advisorModel). DEFAULT OFF — absent means no advisor consult
  // at all, the `promptSuggestionEnabled` polarity for a paid secondary-model feature (~$0.39/consult).
  // No client-side model-catalog validation and no client-side cost/frequency limiter (ccx has no catalog;
  // a bad pairing surfaces as the server's own `model_not_found`).
  advisorModel?: string;
  maxTurns?: number;
  // turn controls (verified live 2026-06-18; specs/2026-06-18-sdk-capability-closeout-design.md)
  effort?: EffortLevel;                    // 'low'|'medium'|'high'|'xhigh'|'max' — reasoning effort
  thinking?: ThinkingConfig;               // {type:'adaptive'|'disabled'} | {type:'enabled',budgetTokens}
  outputFormat?: unknown;                  // SDK OutputFormat ({type:'json_schema',schema}) — passthrough (probe 36)
  maxBudgetUsd?: number;                   // hard USD ceiling; EXCEEDED → hard stop: throws OR empty result (timing-dependent)
  taskBudget?: { total: number };          // token-pacing hint; opus-4-8-only (sonnet/haiku return 400)
  includePartialMessages?: boolean;        // emit SDKPartialAssistantMessage stream_event frames
  forwardSubagentText?: boolean;           // forward nested subagent text/thinking (parent_tool_use_id set)
  // settings / context
  settingSources?: SettingSource[];        // default all three
  settings?: Record<string, unknown>;      // inline settings object passed to SDK
  managedSettings?: Record<string, unknown>;
  disableProjectContext?: boolean;         // → settingSources [] (skip CLAUDE.md/files)
  excludeDynamicSections?: boolean;        // drop git/date dynamic blocks
  // persona
  outputStyle?: string;                    // mapped to systemPrompt preset append
  appendSystemPrompt?: string;             // extra append text
  // permissions / tools
  // permissionMode: 6 SDK modes. acceptEdits auto-accepts edits but still routes non-edit tools to
  // canUseTool; dontAsk and bypassPermissions replace canUseTool entirely. `auto` does NOT — probe 64
  // shows it consults the broker whenever a rule routes a tool to `ask`, exactly as `default` does.
  // What summons the broker is the ask rule, not the mode.
  permissionMode?: PermissionMode;
  // interactive permission broker (incr3): when set, resolveOptions wires it as the SDK canUseTool.
  // Consulted in default/acceptEdits/plan/auto; bypassPermissions and dontAsk bypass it.
  permissionBroker?: PermissionBroker;
  allowedTools?: string[];
  disallowedTools?: string[];
  toolPreset?: "claude_code" | "none";     // default claude_code
  toolAliases?: Record<string, string>;
  webFetchDomains?: { allow?: string[]; deny?: string[] };
  // sandbox — `network` mirrors the SDK SandboxNetworkSettings object
  // (allowedDomains/allowLocalBinding/allowUnixSockets/…), NOT a boolean.
  sandbox?: boolean | {
    enabled?: boolean;
    network?: Record<string, unknown>;          // SDK SandboxNetworkSettings
    filesystem?: Record<string, unknown>;        // SDK SandboxFilesystemSettings (allowWrite/denyRead/…)
    // credential protection (probe 48: deny-mode live-verified — env var unset + file read kernel-blocked
    // under engaged sandbox-exec; "mask" additionally needs the egress proxy, untested)
    credentials?: { files?: { path: string; mode: "deny" }[]; envVars?: { name: string; mode: "deny" | "mask" }[] };
    autoAllowBashIfSandboxed?: boolean;
    allowUnsandboxedCommands?: boolean;
    failIfUnavailable?: boolean;
    excludedCommands?: string[];                  // run these OUTSIDE the sandbox (e.g. gh, docker)
    enableWeakerNestedSandbox?: boolean;
    enableWeakerNetworkIsolation?: boolean;
  };
  // provider
  provider?: "anthropic" | "bedrock" | "vertex" | "foundry";
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  // observability (W3.1, probe 51): env-gated OTLP metrics + log events from the CLI subprocess
  telemetry?: TelemetryConfig;
  // agents
  agents?: Record<string, AgentDefinition>;
  includeBuiltinAgents?: boolean;          // default true
  // fork subagent (probes 33/33d): model-triggered, transcript-INHERITING subagent via subagent_type:"fork".
  // default ON → sets CLAUDE_CODE_FORK_SUBAGENT=1 AND advertises "fork" in the system prompt. BOTH are
  // required: 33d proved the env var alone is inert — the model never picks fork unless told it exists.
  // Cost when the model chooses fork: the child inherits the FULL parent transcript (more tokens).
  forkSubagent?: boolean;                  // default true
  // Workflow orchestration (probe 36, re-verified on 0.3.211): the native Workflow tool runs script-driven
  // multi-agent fan-outs headlessly (async_launched background task; children do NOT stream into the parent;
  // the return value re-enters the turn via TaskOutput/task-notification). OPT-IN (unlike forkSubagent):
  // a workflow is a cost MULTIPLIER (dozens of child agents), so the operator must enable it deliberately.
  // true → allowlists Workflow+Task* retrieval tools AND advertises the pattern in the system prompt
  // (33d lesson: an unadvertised capability is inert — the model won't reach for it on its own).
  workflow?: boolean;                      // default false
  // checkpointing / mcp / plugins
  enableFileCheckpointing?: boolean;       // default true
  // session persistence — the SDK persists transcripts to ~/.claude/projects by default
  resume?: string;                         // SDK session_id to reload prior context
  // time-travel (probes 37/37b): resume only up to (and including) this message uuid — conversation
  // rewind. Anchor may be an assistant OR user message uuid (user-prompt uuids also drive rewindFiles,
  // so one anchor serves both). WITHOUT forkSession this is DESTRUCTIVE: same session_id, and the
  // persisted transcript is truncated at the anchor. With forkSession: non-destructive branch (new id).
  resumeAt?: string;                       // SDK resumeSessionAt; use with `resume`
  // SDK 0.3.227 `resumeDropsTurn` — with `resumeAt`, names the PROMPT uuid of the turn the truncation
  // discards, and the CLI then refuses at fork time if anything past the anchor belongs to some other turn
  // (a queued user message the session absorbed mid-turn, a transcript append). The refusal arrives as an
  // `error_during_execution` result whose message starts `Resume rejected by --resume-drops-turn:` and is
  // DETERMINISTIC — recover by resuming plainly, never by retrying the same fork. Omit for the unvalidated
  // truncation. Print/headless lane only (which is the only lane this harness drives).
  droppedTurnUuid?: string;                // SDK resumeDropsTurn; use with `resumeAt`
  forkSession?: boolean;                   // branch into a NEW session id instead of resuming in place
  persistSession?: boolean;                // default SDK-true; false = ephemeral (no disk persistence)
  sessionStore?: SessionStore;             // BYO transcript-mirror backend (advanced; pure passthrough)
  sessionStoreFlush?: "batched" | "eager"; // mirror flush cadence (SDK default batched; ignored w/o sessionStore)
  sessionStoreLoadTimeoutMs?: number;      // resume-materialization timeout per store load()/listSubkeys() call (SDK default 60s)
  // compaction (Spec B): tune/disable the SDK's native auto-compaction (these are SDK Settings fields)
  autoCompactEnabled?: boolean;            // false disables the native ~167k safety net
  autoCompactWindow?: number;              // tokens of headroom before auto-compaction
  // task tools (Phase 2 A1): durable Task* MCP server
  taskTools?: boolean | { dir?: string; listId?: string; agentName?: string };
  // swarm / coordinator (Phase 2 A2): peer teammate orchestration over an in-process bus
  swarm?: boolean | { team?: string; coordinatorPersona?: boolean; tools?: string[]; permissions?: { allow?: string[]; escalateToCoordinator?: boolean; onPlanApproval?: "default" | "acceptEdits" | "auto" | "bypassPermissions" } };
  // context introspection (domain 6, agent-facing): expose a GetContextUsage MCP tool to the model
  contextTool?: boolean;
  // hooks (domain 8): programmatic SDK hooks (Partial<Record<HookEvent, HookCallbackMatcher[]>>).
  // Build with the src/hooks builders + mergeHooks. NOTE: SessionStart/SessionEnd do NOT fire via
  // this programmatic path (verified) — no builder exists for them; raw passthrough is the user's choice.
  hooks?: HooksMap;
  mcpServers?: Record<string, McpServerConfig>;
  /** M7, and NOT a caller knob: the in-process MCP servers a thread's CLIENT-DECLARED tools are published
   *  under. The app server owns it end to end — it writes this onto the transient config of one engine
   *  build (never onto the record it rebuilds from) and refuses any client that sets it — so the value is
   *  `unknown` here rather than `McpServerConfig`: nothing in this layer constructs or inspects it.
   *  Merged into `mcpServers` LAST, after `extraOptions`, in resolveOptions. */
  dynamicToolServers?: Record<string, unknown>;
  plugins?: SdkPluginConfig[];
  // ── Wave-4 knob sweep (probes 53/53b/54; spec 2026-07-17-wave4-knob-completion-design) ──
  // session identity/plumbing
  sessionId?: string;                      // caller-chosen session UUID (probe 53 ✅ — init.session_id honors it)
  title?: string;                          // initial session title (probe 53 ✅ — getSessionInfo().customTitle round-trips)
  continueSession?: boolean;               // SDK `continue`: resume the most recent conversation in cwd (excl. with resume)
  abortController?: AbortController;       // cancel the underlying query; Session/harness callers usually manage their own
  // main-thread agent
  agent?: string;                          // apply this agents[] entry's prompt/tools/model to the MAIN thread (probe 53 ✅)
  // context / tools
  additionalDirectories?: string[];        // extra absolute paths Claude may access beyond cwd
  skills?: string[] | "all";               // filter which discovered skills load into the main session
  toolConfig?: ToolConfig;                 // per-builtin-tool config (e.g. askUserQuestion.previewFormat)
  strictMcpConfig?: boolean;               // fail hard on invalid MCP config instead of skipping
  betas?: SdkBeta[];                       // API beta headers (probe 53: context-1m accepted on sonnet-4-6, no error)
  maxThinkingTokens?: number;              // initial thinking budget (runtime lever: setMaxThinkingTokens — probe 25)
  planModeInstructions?: string;           // replaces the default plan-mode system-prompt section
  permissionPromptToolName?: string;       // MCP tool consulted for permission prompts (declared-only wire, unprobed)
  // callbacks (probe-grounded)
  onElicitation?: OnElicitation;           // MCP elicitation handler (probe 43b ✅ stdio round-trip)
  onUserDialog?: OnUserDialog;             // request_user_dialog handler (probe 43: wireable, NO deterministic headless trigger)
  supportedDialogKinds?: string[];         // dialog kinds onUserDialog actually renders — CLI fails closed on absence
  /** Declares that this consumer renders a per-task stop control wired to the `stop_task` control request
   *  (0.3.250). Structural, not behavioural-on-our-side: the CLI reads it off the `initialize` request and,
   *  when declared, an interrupt on an open-input session aborts only the turn and leaves running background
   *  agents/workflows alive to be stopped one at a time. ABSENCE FAILS CLOSED — an interrupt kills them —
   *  so this is the difference between our Stop killing background work and sparing it. Truthful for the
   *  bundled TUI, whose Background panel stops a single row (`BgTasksPanel onStop` → `stopBgTask` →
   *  `session.stopTask`); a library caller that ships no such control must leave it unset. First-attached-
   *  client wins on multi-client sessions, and a closed-input one-shot run (`-p`) kills hold-back tasks
   *  regardless. */
  perTaskStopAffordance?: boolean;
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess; // custom CLI child placement (probe 50 ✅ end-to-end)
  // process plumbing
  pathToClaudeCodeExecutable?: string;
  executable?: "bun" | "deno" | "node";
  executableArgs?: string[];
  extraArgs?: Record<string, string | null>; // extra CLI args (null = boolean flag) — escape hatch like extraOptions
  stderr?: (data: string) => void;         // subprocess stderr tap
  debug?: boolean;                         // CLI debug logging (pairs with stderr/debugFile)
  debugFile?: string;
  // dead/partial knobs — wired for completeness, DO NOT rely on them headless:
  includeHookEvents?: boolean;             // settings-layer hooks emit frames as of SDK 0.3.237 (P116, 2026-08-30); in-process `options.hooks` callbacks still emit none
  promptSuggestions?: boolean;             // 🚫 DEAD headless (probes 53/53b: no prompt_suggestion frame after result)
  agentProgressSummaries?: boolean;        // 🟡 PARTIAL (probe 54: task_progress fires; summary never populated in a 45s subagent)
  // escape hatches
  env?: Record<string, string | undefined>;
  extraOptions?: Record<string, unknown>;  // merged last into SDK Options, except resolveOptions' SERVER_OWNED keys
}

/** The SDK env flag that strips the `mcp__<server>__` prefix off every MCP tool name (`d.bool()` in the
 *  shipped bundle: falsy, or anything outside `1/true/yes/on`, reads as off). Named here because two layers
 *  must agree on it — the app server writes it onto a declaring thread's engine config, and resolveOptions
 *  re-asserts it past the `extraOptions` hatch. A truthy value collapses every declared namespace into one
 *  flat space, which is the whole naming scheme dynamic tools are addressed by. */
export const MCP_NO_PREFIX_ENV = "CLAUDE_AGENT_SDK_MCP_NO_PREFIX";

export const DEFAULTS = {
  settingSources: ["user", "project", "local"] as SettingSource[],
  includeBuiltinAgents: true,
  forkSubagent: true,                       // model can autonomously spawn a transcript-inheriting fork subagent
  workflow: false,                          // Workflow fan-outs are a cost multiplier — deliberate opt-in
  enableFileCheckpointing: true,
  toolPreset: "claude_code" as const,
  provider: "anthropic" as const,
  model: "claude-opus-5",                   // harness-wide default (Claude-5 gen; auto-capable — probe 72)
  permissionMode: "auto" as PermissionMode, // SDK-native auto classifier
  effort: "xhigh" as EffortLevel,           // default reasoning effort
};
