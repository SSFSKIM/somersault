# Claude Agent SDK (TypeScript) — Surface Reference

> **Verdict basis** for the CC → Agent SDK feature-parity map. Every later parity task
> classifies CC features against *this* surface. Ground truth = the SDK's bundled
> `.d.ts` files; the public docs are used only to flag doc-vs-implementation gaps.

- **Package:** `@anthropic-ai/claude-agent-sdk`
- **Installed version:** `0.3.178`
- **Ground-truth source:** `probes/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (6,567 lines)
  - Entry: `sdk.mjs` (`"main"`), types `sdk.d.ts` (`"types"`). Auxiliary `.d.ts`: `sdk-tools.d.ts` (built-in tool input schemas), `bridge.d.ts`, `assistant.d.ts`, `browser-sdk.d.ts`.
- **Docs cross-ref:** <https://code.claude.com/docs/en/agent-sdk/typescript> (TypeScript API Reference)
- **Runtime-exported names** (verified via `import * as sdk from './sdk.mjs'`): `AbortError`, `DirectConnectError`, `DirectConnectTransport`, `EXIT_REASONS`, `HOOK_EVENTS`, `InMemorySessionStore`, `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, `createSdkMcpServer`, `deleteSession`, `filterEscalatingDefaultMode`, `foldSessionSummary`, `forkSession`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `importSessionToStore`, `listSessions`, `listSubagents`, `parseDirectConnectUrl`, `query`, `renameSession`, `resolveSettings`, `startup`, `tagSession`, `tool`.

**Legend for gap flags:** 🟢 in both `.d.ts` and docs · 🔵 `.d.ts` only (undocumented) · 🟠 docs only (no matching `.d.ts` symbol).

---

## 1. Exported functions (signature one-liners)

Source: `.d.ts` (`export declare function`) + runtime export check. Docs document only the 10 marked 🟢.

| Function | Signature | Source |
|---|---|---|
| `query` | `query({ prompt: string \| AsyncIterable<SDKUserMessage>, options?: Options }): Query` | 🟢 |
| `startup` | `startup({ options?: Options, initializeTimeoutMs?: number }?): Promise<WarmQuery>` | 🟢 |
| `tool` | `tool<Schema>(name, description, inputSchema: Schema, handler: (args, extra) => Promise<CallToolResult>, extras?: { annotations?, searchHint?, alwaysLoad? }): SdkMcpToolDefinition<Schema>` | 🟢 |
| `createSdkMcpServer` | `createSdkMcpServer(options: { name, version?, instructions?, tools?, alwaysLoad? }): McpSdkServerConfigWithInstance` | 🟢 |
| `listSessions` | `listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>` | 🟢 |
| `getSessionMessages` | `getSessionMessages(sessionId, options?: GetSessionMessagesOptions): Promise<SessionMessage[]>` | 🟢 |
| `getSessionInfo` | `getSessionInfo(sessionId, options?: GetSessionInfoOptions): Promise<SDKSessionInfo \| undefined>` | 🟢 |
| `renameSession` | `renameSession(sessionId, title, options?: SessionMutationOptions): Promise<void>` | 🟢 |
| `tagSession` | `tagSession(sessionId, tag: string \| null, options?: SessionMutationOptions): Promise<void>` | 🟢 |
| `resolveSettings` | `resolveSettings(opts?: ResolveSettingsOptions): Promise<ResolvedSettings>` *(@alpha)* | 🟢 |
| `deleteSession` | `deleteSession(sessionId, options?: SessionMutationOptions): Promise<void>` | 🔵 |
| `forkSession` | `forkSession(sessionId, options?: ForkSessionOptions): Promise<ForkSessionResult>` | 🔵 |
| `getSubagentMessages` | `getSubagentMessages(sessionId, agentId, options?: GetSubagentMessagesOptions): Promise<SessionMessage[]>` | 🔵 |
| `listSubagents` | `listSubagents(sessionId, options?: ListSubagentsOptions): Promise<string[]>` | 🔵 |
| `filterEscalatingDefaultMode` | `filterEscalatingDefaultMode(resolved: ResolvedSettings): Settings` *(@alpha)* | 🔵 |
| `foldSessionSummary` | `foldSessionSummary(prev, key, entries, options?): SessionSummaryEntry` *(@alpha)* | 🔵 |
| `importSessionToStore` | `importSessionToStore(sessionId, store: SessionStore, options?): Promise<void>` *(@alpha)* | 🔵 |

**Also runtime-exported (not in the function table above):** classes/consts `AbortError`, `InMemorySessionStore` *(@alpha)*, `DirectConnectError`, `DirectConnectTransport`, `parseDirectConnectUrl`, and the consts `EXIT_REASONS`, `HOOK_EVENTS`, `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`.

---

## 2. `Options` fields

Source: `.d.ts` `export declare type Options` (lines ~1293–2026). The docs page lists **all of
these except 4** and adds **one phantom field** — see flags. Defaults are from JSDoc; “—” = no
documented default (required-or-undefined).

| Field | Type | Default | Purpose | Source |
|---|---|---|---|---|
| `abortController` | `AbortController` | — | Cancel the query; aborts + cleans up resources. | 🟢 |
| `additionalDirectories` | `string[]` | — | Extra absolute dirs Claude may access beyond cwd. | 🟢 |
| `agent` | `string` | — | Main-thread agent name (≈ `--agent`); applies that agent's prompt/tools/model. | 🟢 |
| `agents` | `Record<string, AgentDefinition>` | — | Programmatically define subagents invokable via the Agent tool. | 🟢 |
| `allowedTools` | `string[]` | — | Tools auto-allowed without permission prompt. (`'Skill'` here deprecated → use `skills`.) | 🟢 |
| `canUseTool` | `CanUseTool` | — | Permission callback run before each tool execution. | 🟢 |
| `continue` | `boolean` | — | Continue most-recent conversation in cwd. Mutually exclusive with `resume`. | 🟢 |
| `cwd` | `string` | `process.cwd()` | Session working directory. | 🟢 |
| `disallowedTools` | `string[]` | — | Tools removed from context; cannot be used. | 🟢 |
| `toolAliases` | `Record<string, string>` | — | Single-hop alias map applied before tool-name resolution (redirect built-ins to MCP tools). | 🔵 |
| `tools` | `string[] \| { type:'preset', preset:'claude_code' }` | — | Base set of built-in tools (`[]` disables all). | 🟢 |
| `env` | `{ [k]: string \| undefined }` | inherits `process.env` | Subprocess env; **REPLACES** env entirely when set (spread `process.env` yourself). | 🟢 |
| `executable` | `'bun' \| 'deno' \| 'node'` | auto-detected | JS runtime to run Claude Code. | 🟢 |
| `executableArgs` | `string[]` | — | Extra args to the JS runtime. | 🟢 |
| `extraArgs` | `Record<string, string \| null>` | — | Extra raw CLI args (`null` = boolean flag). | 🟢 |
| `fallbackModel` | `string` | — | Comma-separated fallback model list when primary is overloaded. | 🟢 |
| `enableFileCheckpointing` | `boolean` | — | Track file changes so `Query.rewindFiles()` can restore them. | 🟢 |
| `toolConfig` | `ToolConfig` | — | Per-tool config for built-ins (currently `askUserQuestion.previewFormat`). | 🟢 |
| `forkSession` | `boolean` | — | On resume, fork to a new session ID instead of continuing. | 🟢 |
| `betas` | `SdkBeta[]` | — | Enable beta features (only `'context-1m-2025-08-07'`). | 🟢 |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | — | Hook callbacks per event. | 🟢 |
| `onElicitation` | `OnElicitation` | — | Callback for MCP elicitation requests not handled by hooks. | 🟢 |
| `onUserDialog` | `OnUserDialog` | — | Callback for `request_user_dialog` blocking dialogs. | 🔵 |
| `supportedDialogKinds` | `string[]` | — | Which `dialog_kind`s `onUserDialog` can render (requires `onUserDialog`). | 🔵 |
| `persistSession` | `boolean` | `true` | When false, no disk persistence / not resumable. | 🟢 |
| `sessionStore` | `SessionStore` | `undefined` | Mirror transcripts to an external store *(@alpha)*. | 🟢 |
| `sessionStoreFlush` | `SessionStoreFlush` | `'batched'` | Flush aggressiveness to `sessionStore` *(@alpha)*. | 🟢 |
| `loadTimeoutMs` | `number` | `60_000` | Timeout per `sessionStore.load()`/`listSubkeys()` on resume *(@alpha)*. | 🟢 |
| `includeHookEvents` | `boolean` | `false` | Emit `hook_started`/`hook_progress`/`hook_response` system messages. | 🟢 |
| `includePartialMessages` | `boolean` | — | Emit `SDKPartialAssistantMessage` streaming events. | 🟢 |
| `forwardSubagentText` | `boolean` | — | Forward subagent text/thinking blocks (not just tool_use/result). | 🟢 |
| `thinking` | `ThinkingConfig` | adaptive (model-dependent) | Thinking/reasoning behavior (`adaptive`/`enabled`/`disabled`). | 🟢 |
| `effort` | `EffortLevel` | `'high'` | Reasoning effort (`low`/`medium`/`high`/`xhigh`/`max`). | 🟢 |
| `maxThinkingTokens` | `number` | — | **Deprecated** → use `thinking`. | 🟢 |
| `maxTurns` | `number` | — | Max conversation turns before stopping. | 🟢 |
| `maxBudgetUsd` | `number` | — | USD budget cap → `error_max_budget_usd` result. | 🟢 |
| `taskBudget` | `{ total: number }` | — | API-side token task budget *(@alpha)*. | 🟢 |
| `mcpServers` | `Record<string, McpServerConfig>` | — | MCP server configs by name. | 🟢 |
| `model` | `string` | CLI default | Claude model id. | 🟢 |
| `outputFormat` | `OutputFormat` (`JsonSchemaOutputFormat`) | — | Structured-output schema. | 🟢 |
| `pathToClaudeCodeExecutable` | `string` | built-in | Path to the Claude Code binary. | 🟢 |
| `permissionMode` | `PermissionMode` | `'default'` | Session permission mode. | 🟢 |
| `planModeInstructions` | `string` | — | Custom plan-mode workflow body (when `permissionMode:'plan'`). | 🟢 |
| `allowDangerouslySkipPermissions` | `boolean` | — | Required `true` for `bypassPermissions`. | 🟢 |
| `permissionPromptToolName` | `string` | — | MCP tool to route permission prompts through. | 🟢 |
| `plugins` | `SdkPluginConfig[]` | — | Load local plugins (commands/agents/skills/hooks). | 🟢 |
| `promptSuggestions` | `boolean` | — | Emit a `prompt_suggestion` after each turn. | 🟢 |
| `agentProgressSummaries` | `boolean` | `false` | Periodic AI progress summaries for running subagents (`task_progress.summary`). | 🟢 |
| `resume` | `string` | — | Session ID to resume. | 🟢 |
| `sessionId` | `string` (UUID) | auto-generated | Use a specific session ID. | 🟢 |
| `resumeSessionAt` | `string` (UUID) | — | Resume only up to this message UUID. | 🟢 |
| `sandbox` | `SandboxSettings` | — | Command-execution sandbox config. | 🟢 |
| `settings` | `string \| Settings` | — | Path or object → "flag settings" layer (≈ `--settings`). | 🟢 |
| `managedSettings` | `Settings` | — | Policy-tier settings from the parent process (filtered restrictive-only). | 🟢 |
| `settingSources` | `SettingSource[]` | all sources | Which filesystem settings to load (`[]` = none; needs `'project'` for CLAUDE.md). | 🟢 |
| `skills` | `string[] \| 'all'` | omitted (CLI default) | Enable skills (single place; no need to add `'Skill'` to `allowedTools`). | 🟢 |
| `debug` | `boolean` | — | Verbose debug logging (≈ `--debug`). | 🟢 |
| `debugFile` | `string` | — | Write debug logs to a file (implies debug). | 🟢 |
| `stderr` | `(data: string) => void` | — | Callback for subprocess stderr. | 🟢 |
| `strictMcpConfig` | `boolean` | — | Only use `mcpServers` (≈ `--strict-mcp-config`). | 🟢 |
| `systemPrompt` | `string \| string[] \| { type:'preset', preset:'claude_code', append?, excludeDynamicSections? }` | — | System prompt config / preset. | 🟢 |
| `title` | `string` | auto from 1st msg | Custom session title. | 🟢 |
| `spawnClaudeCodeProcess` | `(options: SpawnOptions) => SpawnedProcess` | default local spawn | Custom process spawner (VM/container/remote). | 🟢 |
| **`outputStyle`** | *(docs claim it exists)* | — | **PHANTOM** — listed by the docs page but **absent from `sdk.d.ts` v0.3.178**. | 🟠 |

> **Gap call-out (Options):** 64 fields in `.d.ts`. The docs page omits 3 real fields
> (`toolAliases`, `onUserDialog`, `supportedDialogKinds`) and lists 1 field that does not exist
> in the `.d.ts` (`outputStyle`). When classifying CC parity, treat the `.d.ts` set as authoritative.

---

## 3. `Query` methods

Source: `.d.ts` `interface Query extends AsyncGenerator<SDKMessage, void>`. Docs document 18; the
🔵 rows are real methods the docs omit. (All control-request methods require streaming input mode.)

| Method | Signature | Source |
|---|---|---|
| `interrupt` | `(): Promise<void>` | 🟢 |
| `setPermissionMode` | `(mode: PermissionMode): Promise<void>` | 🟢 |
| `setModel` | `(model?: string): Promise<void>` | 🟢 |
| `setMaxThinkingTokens` | `(maxThinkingTokens: number \| null, thinkingDisplay?: 'summarized'\|'omitted'\|null): Promise<void>` *(deprecated → `thinking`)* | 🟢 |
| `applyFlagSettings` | `(settings: { [K in keyof Settings]?: Settings[K] \| null }): Promise<void>` | 🟢 |
| `initializationResult` | `(): Promise<SDKControlInitializeResponse>` | 🟢 |
| `supportedCommands` | `(): Promise<SlashCommand[]>` | 🟢 |
| `supportedModels` | `(): Promise<ModelInfo[]>` | 🟢 |
| `supportedAgents` | `(): Promise<AgentInfo[]>` | 🟢 |
| `mcpServerStatus` | `(): Promise<McpServerStatus[]>` | 🟢 |
| `getContextUsage` | `(): Promise<SDKControlGetContextUsageResponse>` | 🔵 |
| `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` | `(): Promise<SDKControlGetUsageResponse>` *(experimental)* | 🔵 |
| `readFile` | `(path, options?: { maxBytes?, encoding?: 'utf-8'\|'base64' }): Promise<SDKControlReadFileResponse \| null>` | 🔵 |
| `reloadPlugins` | `(): Promise<SDKControlReloadPluginsResponse>` | 🔵 |
| `reloadSkills` | `(): Promise<SDKControlReloadSkillsResponse>` | 🔵 |
| `accountInfo` | `(): Promise<AccountInfo>` | 🟢 |
| `rewindFiles` | `(userMessageId, options?: { dryRun? }): Promise<RewindFilesResult>` | 🟢 |
| `seedReadState` | `(path, mtime): Promise<void>` | 🔵 |
| `reconnectMcpServer` | `(serverName): Promise<void>` | 🟢 |
| `toggleMcpServer` | `(serverName, enabled): Promise<void>` | 🟢 |
| `setMcpServers` | `(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>` | 🟢 |
| `streamInput` | `(stream: AsyncIterable<SDKUserMessage>): Promise<void>` | 🟢 |
| `stopTask` | `(taskId): Promise<void>` | 🟢 |
| `backgroundTasks` | `(toolUseId?): Promise<boolean>` | 🔵 |
| `close` | `(): void` | 🟢 |

---

## 4. `SDKMessage` union members

Source: `.d.ts` `export declare type SDKMessage = ...` (35 members). The `type`/`subtype`
discriminant is from each member's definition. Docs list 31 (omits the 4 marked 🔵).

| Member | `type` / `subtype` discriminant | When emitted | Source |
|---|---|---|---|
| `SDKAssistantMessage` | `assistant` | An assistant message (possibly from a subagent: `subagent_type`/`task_description`). | 🟢 |
| `SDKUserMessage` | `user` | A user message in the conversation stream. | 🟢 |
| `SDKUserMessageReplay` | `user` | A replayed user message (on resume). | 🟢 |
| `SDKResultMessage` | `result` (`success` \| `error_during_execution` \| `error_max_turns` \| `error_max_budget_usd` \| `error_max_structured_output_retries`) | Terminal turn result (success or one of four error subtypes). | 🟢 |
| `SDKSystemMessage` | `system` / `init` | Session initialization (init payload). | 🟢 |
| `SDKPartialAssistantMessage` | `stream_event` | Streaming partial assistant content (when `includePartialMessages`). | 🟢 |
| `SDKCompactBoundaryMessage` | `system` / `compact_boundary` | A context-compaction boundary (manual/auto). | 🟢 |
| `SDKStatusMessage` | `system` / `status` | Status update. | 🟢 |
| `SDKAPIRetryMessage` | `system` / `api_retry` | API request failed with a retryable error and will retry. | 🟢 |
| `SDKModelRefusalFallbackMessage` | `system` / `model_refusal_fallback` | Model refusal handled via fallback (retracts prior turn frames). | 🔵 |
| `SDKLocalCommandOutputMessage` | `system` / `local_command_output` | Output of a local (slash) command. | 🟢 |
| `SDKHookStartedMessage` | `system` / `hook_started` | A hook began (when `includeHookEvents`). | 🟢 |
| `SDKHookProgressMessage` | `system` / `hook_progress` | Hook progress update. | 🟢 |
| `SDKHookResponseMessage` | `system` / `hook_response` | Hook completed with a response. | 🟢 |
| `SDKPluginInstallMessage` | `system` / `plugin_install` | Headless plugin-install progress (started/installed/failed/completed). | 🟢 |
| `SDKToolProgressMessage` | `tool_progress` | Progress notification from a (long-running) tool. | 🟢 |
| `SDKAuthStatusMessage` | `auth_status` | Authentication status / interactive-auth output. | 🟢 |
| `SDKTaskNotificationMessage` | `system` / `task_notification` | Background task settled/stopped notification. | 🟢 |
| `SDKTaskStartedMessage` | `system` / `task_started` | A background task started. | 🟢 |
| `SDKTaskUpdatedMessage` | `system` / `task_updated` | A background task was updated. | 🟢 |
| `SDKTaskProgressMessage` | `system` / `task_progress` | Periodic task/subagent progress (carries `summary` when `agentProgressSummaries`). | 🟢 |
| `SDKThinkingTokensMessage` | `system` / `thinking_tokens` | Thinking-token usage update. | 🔵 |
| `SDKSessionStateChangedMessage` | `system` / `session_state_changed` | Session state changed (`startup`/`resume`/`clear`/`compact`). | 🟢 |
| `SDKWorkerShuttingDownMessage` | `system` / `worker_shutting_down` | The worker subprocess is shutting down. | 🔵 |
| `SDKCommandsChangedMessage` | `system` / `commands_changed` | Slash-command list changed mid-session (REPLACE cached list). | 🟢 |
| `SDKNotificationMessage` | `system` / `notification` | A notification surfaced to the user. | 🟢 |
| `SDKFilesPersistedEvent` | `system` / `files_persisted` | Files were persisted to disk. | 🟢 |
| `SDKToolUseSummaryMessage` | `tool_use_summary` | Summary of a tool use. | 🟢 |
| `SDKMemoryRecallMessage` | `system` / `memory_recall` | Memory was recalled into context. | 🟢 |
| `SDKRateLimitEvent` | `rate_limit_event` | Rate-limit info changed. | 🟢 |
| `SDKElicitationCompleteMessage` | `system` / `elicitation_complete` | An MCP elicitation completed. | 🟢 |
| `SDKPermissionDeniedMessage` | `system` / `permission_denied` | A permission request was denied. | 🟢 |
| `SDKPromptSuggestionMessage` | `prompt_suggestion` | Predicted next user prompt (after `result`, when `promptSuggestions`). | 🟢 |
| `SDKMirrorErrorMessage` | `system` / `mirror_error` | `sessionStore` mirror write failed *(@alpha mirroring)*. | 🟢 |
| `SDKInformationalMessage` | `system` / `informational` | Informational system notice. | 🔵 |

> **Gap call-out (SDKMessage):** 35 members in `.d.ts`; docs enumerate 31. The 4 undocumented:
> `SDKModelRefusalFallbackMessage`, `SDKThinkingTokensMessage`, `SDKWorkerShuttingDownMessage`,
> `SDKInformationalMessage`.

---

## 5. `AgentDefinition` fields

Source: `.d.ts` `export declare type AgentDefinition` (lines ~38–92).

| Field | Type | Required | Purpose |
|---|---|---|---|
| `description` | `string` | yes | Natural-language "when to use this agent". |
| `prompt` | `string` | yes | The agent's system prompt. |
| `tools` | `string[]` | no | Allowed tool names; omit = inherit all. (`'Skill'` deprecated → `skills`.) |
| `disallowedTools` | `string[]` | no | Tool names to disallow (MCP server-level specs remove whole servers). |
| `model` | `string` | no | Model alias/ID, or `'inherit'`/omit = main model. |
| `mcpServers` | `AgentMcpServerSpec[]` | no | MCP servers for this agent (`string \| Record<string, McpServerConfigForProcessTransport>`). |
| `criticalSystemReminder_EXPERIMENTAL` | `string` | no | Experimental critical reminder appended to system prompt. |
| `skills` | `string[]` | no | Skill names to preload into the agent context. |
| `initialPrompt` | `string` | no | Auto-submitted first user turn (when this is the main-thread agent). |
| `maxTurns` | `number` | no | Max agentic turns before stopping. |
| `background` | `boolean` | no | Run as a fire-and-forget background task when invoked. |
| `memory` | `'user' \| 'project' \| 'local'` | no | Scope for auto-loading agent-memory files. |
| `effort` | `'low'\|'medium'\|'high'\|'xhigh'\|'max' \| number` | no | Reasoning effort (named level or integer). |
| `permissionMode` | `PermissionMode` | no | Permission mode for this agent's tool executions. |

---

## 6. `McpServerConfig` variants

Source: `.d.ts`. `McpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfigWithInstance`.
(Note: `McpServerConfigForProcessTransport` is the serializable subset that swaps the SDK variant for plain `McpSdkServerConfig`.)

| Variant | Discriminant | Key fields |
|---|---|---|
| `McpStdioServerConfig` | `type?: 'stdio'` (default) | `command` (req), `args?`, `env?`, `timeout?`, `alwaysLoad?` |
| `McpSSEServerConfig` | `type: 'sse'` | `url` (req), `headers?`, `tools?: McpServerToolPolicy[]`, `timeout?`, `alwaysLoad?` |
| `McpHttpServerConfig` | `type: 'http'` | `url` (req), `headers?`, `tools?: McpServerToolPolicy[]`, `timeout?`, `alwaysLoad?` |
| `McpSdkServerConfigWithInstance` | `type: 'sdk'` | `name` (req) + `instance: McpServer` (live, non-serializable; produced by `createSdkMcpServer`) |
| `McpClaudeAIProxyServerConfig` *(only in `McpServerStatusConfig`, not the input union)* | `type: 'claudeai-proxy'` | `url`, `id`, `timeout?` |

---

## 7. `PermissionMode` values

Source: `.d.ts` (`export declare type PermissionMode`). 6 values — docs match exactly.

| Value | Meaning |
|---|---|
| `default` | Standard; prompts for dangerous operations. |
| `acceptEdits` | Auto-accept file-edit operations. |
| `bypassPermissions` | Bypass all checks (requires `allowDangerouslySkipPermissions`). |
| `plan` | Planning mode; no actual tool execution. |
| `dontAsk` | Don't prompt; deny if not pre-approved. |
| `auto` | Model classifier approves/denies permission prompts. |

---

## 8. `HookEvent` values  ⭐ (docs are vague here — `.d.ts` is authoritative)

Source: `.d.ts` `export declare type HookEvent` **and** the `HOOK_EVENTS` runtime const
(both list the same **30** events, in this order). The docs page does **not** enumerate them.

1. `PreToolUse`
2. `PostToolUse`
3. `PostToolUseFailure`
4. `PostToolBatch`
5. `Notification`
6. `UserPromptSubmit`
7. `UserPromptExpansion`
8. `SessionStart`
9. `SessionEnd`
10. `Stop`
11. `StopFailure`
12. `SubagentStart`
13. `SubagentStop`
14. `PreCompact`
15. `PostCompact`
16. `PermissionRequest`
17. `PermissionDenied`
18. `Setup`
19. `TeammateIdle`
20. `TaskCreated`
21. `TaskCompleted`
22. `Elicitation`
23. `ElicitationResult`
24. `ConfigChange`
25. `WorktreeCreate`
26. `WorktreeRemove`
27. `InstructionsLoaded`
28. `CwdChanged`
29. `FileChanged`
30. `MessageDisplay`

> **Gap call-out (HookEvent):** all 30 are 🔵 from a parity standpoint — they are fully defined in
> the `.d.ts`/`HOOK_EVENTS` const but the public TypeScript reference page does not list the event
> names. Hook *input* and *specific-output* types exist in the `.d.ts` for every event above.

---

## 9. `SettingSource` values

Source: `.d.ts` (`export declare type SettingSource = 'user' | 'project' | 'local'`). Docs match.

| Value | File |
|---|---|
| `user` | `~/.claude/settings.json` |
| `project` | `.claude/settings.json` |
| `local` | `.claude/settings.local.json` |

Related (not part of `SettingSource`, but in `.d.ts`): `ResolvedSettingSource = SettingSource | 'managed' | 'flag'` — adds the policy tier (`managed`) and the `--settings`/`settings`-option tier (`flag`). 🔵

---

## 10. Session functions

Source: `.d.ts`. The 5 marked 🟢 are documented as the "Session Management" group; the rest are
🔵 (real exports, undocumented). `SessionMutationOptions` ≈ `{ dir?, sessionStore? }`.

| Function | Source |
|---|---|
| `listSessions(options?)` → `SDKSessionInfo[]` | 🟢 |
| `getSessionInfo(sessionId, options?)` → `SDKSessionInfo \| undefined` | 🟢 |
| `getSessionMessages(sessionId, options?)` → `SessionMessage[]` (`includeSystemMessages?`, `limit?`, `offset?`) | 🟢 |
| `renameSession(sessionId, title, options?)` → `void` | 🟢 |
| `tagSession(sessionId, tag: string \| null, options?)` → `void` (null clears the tag) | 🟢 |
| `deleteSession(sessionId, options?)` → `void` | 🔵 |
| `forkSession(sessionId, options?)` → `{ sessionId }` (`upToMessageId?`, `title?`) | 🔵 |
| `getSubagentMessages(sessionId, agentId, options?)` → `SessionMessage[]` | 🔵 |
| `listSubagents(sessionId, options?)` → `string[]` | 🔵 |
| `importSessionToStore(sessionId, store, options?)` → `void` *(@alpha)* | 🔵 |
| `foldSessionSummary(prev, key, entries, options?)` → `SessionSummaryEntry` *(@alpha)* | 🔵 |
| `InMemorySessionStore` (class) — in-memory `SessionStore` for testing *(@alpha)* | 🔵 |

---

## 11. `SdkPluginConfig`

Source: `.d.ts` `export declare type SdkPluginConfig`.

| Field | Type | Purpose |
|---|---|---|
| `type` | `'local'` | Only `'local'` is supported today. |
| `path` | `string` | Absolute/relative path to the plugin directory. |
| `skipMcpDiscovery` | `boolean?` | Load skills/hooks/agents/commands but skip the plugin's `.mcp.json`/manifest `mcpServers`. |

---

## 12. `CanUseTool` / `PermissionResult`

Source: `.d.ts`.

**`CanUseTool`** = `(toolName: string, input: Record<string, unknown>, options) => Promise<PermissionResult>`,
where `options` carries: `signal: AbortSignal`, `suggestions?: PermissionUpdate[]`, `blockedPath?`,
`decisionReason?`, `title?`, `displayName?`, `description?`, `toolUseID: string`, `agentID?`.

**`PermissionResult`** (discriminated on `behavior`):

| `behavior` | Fields |
|---|---|
| `'allow'` | `updatedInput?`, `updatedPermissions?: PermissionUpdate[]`, `toolUseID?`, `decisionClassification?` |
| `'deny'` | `message` (req), `interrupt?`, `toolUseID?`, `decisionClassification?` |

Supporting types: `PermissionBehavior = 'allow'\|'deny'\|'ask'`; `HookPermissionDecision = 'allow'\|'deny'\|'ask'\|'defer'`;
`PermissionUpdateDestination = 'userSettings'\|'projectSettings'\|'localSettings'\|'session'\|'cliArg'`;
`PermissionUpdate` is a union of `addRules`/`replaceRules`/`removeRules`/`setMode`/`addDirectories`/`removeDirectories`.

---

## Appendix — useful enums/consts (all from `.d.ts`)

- `EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
- `SdkBeta = 'context-1m-2025-08-07'` (only currently-valid `betas` value)
- `ExitReason` / `EXIT_REASONS` = `'clear' | 'resume' | 'logout' | 'prompt_input_exit' | 'other' | 'bypass_permissions_disabled'`
- `ConfigScope = 'local' | 'user' | 'project'`
- `OutputFormatType = 'json_schema'` (so `OutputFormat = JsonSchemaOutputFormat = { type:'json_schema', schema }`)
- `SDKAssistantMessageError = 'authentication_failed' | 'oauth_org_not_allowed' | 'billing_error' | 'rate_limit' | 'overloaded' | 'invalid_request' | 'model_not_found' | 'server_error' | 'unknown' | 'max_output_tokens'`
- `McpServerStatus.status = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'`
- `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` — sentinel marking the static/dynamic split in a `systemPrompt: string[]`.
- `tool()` extras: `annotations?: ToolAnnotations`, `searchHint?: string`, `alwaysLoad?: boolean`.
