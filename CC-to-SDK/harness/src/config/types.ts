import type { AgentDefinition, McpServerConfig, PermissionMode, SdkPluginConfig, SessionStore, EffortLevel, ThinkingConfig } from "@anthropic-ai/claude-agent-sdk";
import type { HooksMap } from "../hooks/types.js";
import type { PermissionBroker } from "../permissions/types.js";
import type { TelemetryConfig } from "./telemetry.js";

export type SettingSource = "user" | "project" | "local";

export interface HarnessConfig {
  cwd?: string;
  model?: string;
  fallbackModel?: string;
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
  // canUseTool; dontAsk replaces canUseTool entirely (joins auto/bypass as broker-replacing) — verified.
  permissionMode?: PermissionMode;
  // interactive permission broker (incr3): when set, resolveOptions wires it as the SDK canUseTool.
  // Only consulted in broker-live modes (default/acceptEdits/plan); bypassPermissions/dontAsk bypass it.
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
  plugins?: SdkPluginConfig[];
  // escape hatches
  env?: Record<string, string | undefined>;
  extraOptions?: Record<string, unknown>;  // merged last into SDK Options
}

export const DEFAULTS = {
  settingSources: ["user", "project", "local"] as SettingSource[],
  includeBuiltinAgents: true,
  forkSubagent: true,                       // model can autonomously spawn a transcript-inheriting fork subagent
  workflow: false,                          // Workflow fan-outs are a cost multiplier — deliberate opt-in
  enableFileCheckpointing: true,
  toolPreset: "claude_code" as const,
  provider: "anthropic" as const,
  model: "claude-opus-4-8",                 // harness-wide default model (opus-4-8 is already 1M — probe 26)
  permissionMode: "auto" as PermissionMode, // SDK-native auto classifier
  effort: "xhigh" as EffortLevel,           // default reasoning effort
};
