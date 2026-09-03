# Pi Agent Harness — Technical Inventory

Produced 2026-09-03 by a source-inventory subagent for the lecture at `../index.html`.

Source: `/Users/new/Developer/GitHub/somersault/pi`, version **0.84.4** (`packages/coding-agent/package.json:3`), a few commits past the `v0.84.4` tag. License **MIT**, Copyright 2025 Mario Zechner (`LICENSE:1-3`). The GitHub org has moved from `badlogic/pi-mono` to `earendil-works/pi`.

## 1. Architecture layering

Ten npm workspace packages under `packages/` (`package.json:3-12`). Build order reveals the dependency DAG: `tui → telemetry → ai → agent → session-backends/sqlite-node → protocol → client → server → coding-agent` (`package.json:15`).

- **`@earendil-works/pi-tui`** — terminal UI library, no agent knowledge.
- **`@earendil-works/pi-telemetry`** — vendor-neutral span contracts only; no exporter (`packages/telemetry/README.md:5-13`).
- **`@earendil-works/pi-ai`** — provider/model layer.
- **`@earendil-works/pi-agent-core`** — the agent loop and state; depends only on `pi-ai`, `pi-telemetry`, `diff`, `ignore`, `typebox`, `yaml` (`packages/agent/package.json:37-44`).
- **`@earendil-works/pi-coding-agent`** — the `pi` CLI plus the library/SDK. `bin: { pi: "dist/bundle/cli.js" }` (`packages/coding-agent/package.json:9`).
- **`pi-protocol` / `pi-server` / `pi-client` / `session-backends/sqlite-node`** — a separate, newer remote-session surface (§7).

Everything runs **in one Node process**; Node ≥ 22.19 (`package.json:81`). Standalone binaries via `bun build --compile` for six targets (`scripts/build-binaries.sh:73, 159`). Sub-processes appear only where the design pushes them — tools shell out, and the sub-agent *example* spawns whole `pi` processes (`examples/extensions/subagent/index.ts:1-13`).

**Embedding as a library.** `createAgentSession(options)` returns `{ session: AgentSession, extensionsResult, modelFallbackMessage? }` (`packages/coding-agent/src/core/sdk.ts:91-98, 173`). `AgentSession` exposes `prompt/steer/followUp`, `subscribe`, `setModel/setThinkingLevel/cycleModel`, `navigateTree`, `compact/abortCompaction`, `abort`, `dispose`, plus `agent`, `messages`, `isStreaming` (`docs/sdk.md:71-111`). Multi-session hosts: `createAgentSessionRuntime()` / `AgentSessionRuntime` owning `newSession`, `switchSession`, `fork`, clone, `importFromJsonl` — the same layer the built-in interactive, print, and RPC modes use (`docs/sdk.md:116-167`). Options: `customTools`, `tools`/`excludeTools`, `resourceLoader`, `sessionManager`, `settingsManager`, `modelRuntime` (`sdk.ts:39-88`).

`sdk.ts:306-372` is the wiring map: `Agent` is constructed with `systemPrompt: ""`, and each extension event is bound to an agent-core hook — `context` → `transformContext` (`sdk.ts:362-366`), `before_provider_headers` → `transformHeaders` (`:330-340`), `before_provider_request` → `onPayload` (`:343-349`), `after_provider_response` → `onResponse` (`:350-360`), `tool_call` → `agent.beforeToolCall` (`core/agent-session.ts:495`), `tool_result` → `agent.afterToolCall` (`agent-session.ts:509`).

**Two transports.** RPC mode is LF-delimited JSONL on stdin/stdout (§7). `pi-protocol` is a binary format: 4-byte big-endian length prefix + one CBOR item, `PROTOCOL_VERSION = 1` (`packages/protocol/README.md:5-10`; `src/schemas.ts:3`; `src/framing.ts:28-39`). Nine commands (`list|create|attach|detach|prompt|steer|abort|set_model|set_thinking`, `schemas.ts:291-326`) vs RPC's ~30. `PiServer` ships **no CLI and no coding-agent service** (`packages/server/README.md:38`); no auth in the protocol layer, only `0o600` on the Unix socket (`packages/server/src/transports/unix/types.ts:5-6`). The coding agent consumes the *client* half via `RemoteSession` (`src/client/remote-session.ts:66-419`). Treat as a second, in-progress product surface.

## 2. Provider/model layer (`pi-ai`)

### Two registries: providers vs. API transports

Pi separates the **provider** (identity, auth, catalog, dispatch) from the **API** (wire protocol) — `packages/ai/README.md:232-234`. `Provider` at `packages/ai/src/models.ts:97-149`: `id`, `name`, `baseUrl?`, `headers?`, required `auth: ProviderAuth`, sync `getModels()`, optional `refreshModels(context)`, optional `filterModels`, plus `stream`, `streamSimple`, optional `fetchDeferred`/`cancelDeferred`. API transports satisfy `ProviderStreams` (`src/types.ts:272-281`).

**10 `KnownApi` transports** (`src/types.ts:17-27`): `openai-completions`, `mistral-conversations`, `openai-responses`, `azure-openai-responses`, `openai-codex-responses`, `anthropic-messages`, `bedrock-converse-stream`, `google-generative-ai`, `google-vertex`, `pi-messages`. `Api = KnownApi | (string & {})` (`:29`). Lazy factories (`api/lazy.ts:73-97`); Bedrock uses a variable-specifier import so bundlers cannot follow it into the AWS SDK (`api/bedrock-converse-stream.lazy.ts:10-13`).

**40 built-in providers** from `builtinProviders()` (`src/providers/all.ts:89-132`): amazon-bedrock, ant-ling, anthropic, azure-openai-responses, baseten, cerebras, cloudflare-ai-gateway, cloudflare-workers-ai, deepseek, fireworks, github-copilot, google, google-vertex, groq, huggingface, kimi-coding, minimax, minimax-cn, mistral, moonshotai, moonshotai-cn, nvidia, openai, openai-codex, opencode, opencode-go, openrouter, qwen-token-plan (+cn, +individual), radius, together, vercel-ai-gateway, xai, xiaomi, xiaomi-token-plan (ams/cn/sgp), zai, zai-coding-cn. The generated `MODELS` catalog holds **39** — `radius` is dynamic-only (`all.ts:50-53`).

**Provider-to-API is many-to-many.** `opencode` covers four APIs (`providers/opencode.ts:9-24`); `cloudflare-ai-gateway`, `github-copilot` (with `filterModels`), `opencode-go` three each; `fireworks` two. `openai-codex` is OAuth-only (`providers/openai-codex.ts:7-22`). `radius` is hand-written with `refreshModels` (`providers/radius.ts:20-81`).

### Model counts

Not derivable from the source tree: `packages/ai/src/providers/data/` is gitignored (`.gitignore:11`), hydrated at build time. Numbers from the published `@earendil-works/pi-ai@0.84.4` tarball, `dist/providers/data/.manifest.json` `generatedAt: 2026-08-28T22:00:02.569Z`.

**39 providers, 1,290 text models, 50 image models** (`src/image-models.generated.ts:6-759`).

| Provider | Models | | Provider | Models |
|---|---|---|---|---|
| openrouter | 333 | | anthropic | 13 |
| vercel-ai-gateway | 225 | | google-vertex | 13 |
| amazon-bedrock | 118 | | moonshotai (+cn) | 10 each |
| huggingface | 69 | | zai-coding-cn | 10 |
| opencode | 61 | | qwen-token-plan-individual | 8 |
| cloudflare-ai-gateway | 49 | | openai-codex | 7 |
| openai | 38 | | zai | 7 |
| azure-openai-responses | 38 | | groq | 6 |
| github-copilot | 33 | | kimi-coding, xai | 4 each |
| mistral | 32 | | ant-ling, deepseek, minimax (+cn), xiaomi | 3 each |
| opencode-go | 25 | | cerebras, xiaomi-token-plan ×3 | 2 each |
| google, nvidia | 22 each | | | |
| together | 20 | | | |
| baseten | 19 | | | |
| cloudflare-workers-ai, qwen-token-plan (+cn) | 18 each | | | |
| fireworks | 17 | | | |

By transport: `openai-completions` 653, `anthropic-messages` 296, `bedrock-converse-stream` 118, `openai-responses` 105, `azure-openai-responses` 38, `mistral-conversations` 32, `google-generative-ai` 28, `google-vertex` 13, `openai-codex-responses` 7, `pi-messages` 0 (Radius fetches live).

**How the catalog is built** (`packages/ai/scripts/generate-models.ts`, 3,078 lines): models.dev `api.json` (`:1431`, highest priority `:2401-2406`), OpenRouter `/v1/models` (`:1075`), Vercel AI Gateway (`:1139`), NVIDIA NIM filter (`:1050-1053`). **Only tool-calling models survive** (`if (m.tool_call !== true) continue` at 26 sites; `README.md:5`). Hand-maintained correction block (`:2408-2470`). Atomic staged output with rollback (`:3025-3034`). Weekday cron republishes (`.github/workflows/publish-model-catalog.yml:19-20`).

### Unified message and stream abstraction

`packages/ai/src/types.ts`. Content: `TextContent` (`:350-354`), `ThinkingContent` (`:356-364`, `thinkingSignature` + `redacted`), `ImageContent` (`:366-370`), `ToolCall` (`:372-380`, Google `thoughtSignature`, Responses `namespace`). Messages: `UserMessage` (`:421-425`), `AssistantMessage` (`:427-447`, `api`, `provider`, `model`, `responseModel?`, `usage`, `stopReason`, `diagnostics?`, `deferred?`), `ToolResultMessage<TDetails>` (`:449-465`, `addedToolNames`). `Context = { systemPrompt?, messages, tools? }` (`:521-525`); `Tool = { name, description, parameters: TSchema, constrainedSampling? }` (`:514-519`). `StopReason` (`:405`): `pending|stop|length|toolUse|error|aborted|deferred`.

`Model<TApi>` (`:830-859`): `id`, `name`, `api`, `provider`, `baseUrl`, `reasoning`, `thinkingLevelMap?`, `input`, `cost`, `contextWindow`, `maxTokens`, `samplingParams?`, `headers?`, conditionally typed `compat`.

**`AssistantMessageEvent`** (`:535-551`), twelve arms: `start`, `text_start|text_delta|text_end`, `thinking_start|thinking_delta|thinking_end`, `toolcall_start|toolcall_delta|toolcall_end`, terminal `done` or `error`. Every non-terminal event carries `contentIndex` and a running `partial` (`README.md:671`). Stream object: `AssistantMessageEventStream` (`utils/event-stream.ts:69-83`) with `push()`, `end()`, `result()`.

### Registering a custom provider

Library: **`createProvider(input)`** (`models.ts:762-862`) — `id`, `name?`, `baseUrl?`, `headers?`, `auth`, `models`, `fetchModels?`, `filterModels?`, `api: ProviderStreams | Partial<Record<TApi, ProviderStreams>>`. Register with `models.setProvider(provider)` (`:225-230`). Examples `README.md:1000-1096`.

Coding-agent: **`pi.registerProvider(...)`** — full `Provider` or legacy `(name, config)` (`core/model-registry.ts:131-136`; `core/provider-composer.ts:45-71`). Layering built-in → `models.json` → extension → `modelOverrides` (`provider-composer.ts:420-451`). Custom transport = invent an `api` string + supply `streamSimple` — anthropic example uses `api: "custom-anthropic-api"` (`examples/extensions/custom-provider-anthropic/index.ts:579, 609`); gitlab-duo delegates to built-in factories behind a `backend` discriminator (`custom-provider-gitlab-duo/index.ts:327-346`), exchanging a GitLab OAuth token for a short-lived token with a 25-minute cache (`:39, 185-207`).

### Thinking levels

`ThinkingLevel = "minimal"|"low"|"medium"|"high"|"xhigh"|"max"` (`types.ts:83`); `ModelThinkingLevel` adds `"off"`; `ThinkingLevelMap` maps to provider-native tokens or `null` (`:85`). `xhigh`/`max` opt-in (`models.ts:902-911`); `clampThinkingLevel()` (`:913-932`). Defaults `{minimal:1024, low:2048, medium:8192, high:16384}` + 1024 reserve (`api/simple-options.ts:55-77`); `thinkingBudgets` setting (`docs/settings.md:36-49`).

Per transport:
- **Anthropic**: adaptive (`thinking:{type:"adaptive"}` + `output_config.effort`, `api/anthropic-messages.ts:805-823, 1067-1078`) vs budget (`:1081-1085`); drops `temperature` when thinking on (`:1037`).
- **OpenAI Responses / Azure / Codex**: `reasoning:{effort, summary}` + `include:["reasoning.encrypted_content"]` (`api/openai-responses.ts:324-340`).
- **OpenAI Completions**: **eleven** `compat.thinkingFormat` branches — `zai`, `qwen`, `qwen-chat-template`, `chat-template`, `baseten`, `deepseek`, `openrouter`, `ant-ling`, `together`, `string-thinking`, default `reasoning_effort` (`api/openai-completions.ts:866-963`); token cap in three spellings (`:997-1017`).
- **Google**: Gemini-3/Gemma-4 `thinkingLevel` vs Gemini-2.x `thinkingBudget` (`api/google-generative-ai.ts:390-401, 450-526`).
- **Mistral**: `"none"|"high"` (`api/mistral-conversations.ts:901-906`).

### Prompt caching

`CacheRetention = "none"|"short"|"long"` (`types.ts:108`), default `"short"`. Anthropic (`api/anthropic-messages.ts:50-74, 188`): up to three breakpoints — system prompt (two blocks in Claude-Code OAuth mode, `:1011-1033`); **last** tool definition when `supportsCacheControlOnTools`, never on deferred tools (`:1048, 1055, 1360`); last block of final message when user-role, covering tool results (`:1288-1317`). OpenAI Completions: `prompt_cache_key` + `prompt_cache_retention:"24h"` (`api/openai-completions.ts:810-815`); `cacheControlFormat:"anthropic"` for OpenRouter `anthropic/*` (`:1074-1120`). Responses: `prompt_cache_options:{mode:"explicit"}` opt-out (`api/openai-responses.ts:290-297`). Bedrock: `cachePoint` blocks behind allowlist, `AWS_BEDROCK_FORCE_CACHE=1` (`api/bedrock-converse-stream.ts:833-852`). Google: `cacheRead` only (`api/google-generative-ai.ts:224-233`).

### Usage and cost

`Usage` (`types.ts:382-403`): `input`, `output`, `cacheRead`, `cacheWrite`, `cacheWrite1h?`, `reasoning?`, `totalTokens`, nested `cost`. **`calculateCost(model, usage)`** (`models.ts:878-898`): cached tokens priced separately (`:894-895`), tiers by `inputTokensAbove` applied to the entire request (`:882-887`), 1h cache writes at 2× base input (`:890-895`). Every adapter calls it. OpenAI Responses/Codex post-multiply by service-tier factor (`api/openai-responses.ts:350-377`).

### OAuth and auth resolution

Seven flows in `packages/ai/src/auth/oauth/`, lazily loaded (`load.ts:9-68`):

| File | Provider | Flow |
|---|---|---|
| `anthropic.ts` | Claude Pro/Max | PKCE auth-code, loopback port 53692 + manual paste; token endpoint `platform.claude.com/v1/oauth/token` (`:31`) |
| `openai-codex.ts` | ChatGPT Plus/Pro | PKCE loopback 1455 or RFC 8628 device code (`:519-537`); `chatgpt_account_id` from JWT (`:396-416`) |
| `github-copilot.ts` | GitHub Copilot | Device code → Copilot token exchange; per-account `baseUrl` (`:501-506`) |
| `kimi-coding.ts` | Kimi For Coding | Device code; returns `Authorization` header (`:293-295`) |
| `xai.ts` | xAI | Device code, form-encoded |
| `openrouter.ts` | OpenRouter | PKCE; exchanges for permanent API key (`:127-132, 305-307`) |
| `radius.ts` | Radius gateway | Loopback 1456 or device code; endpoints from `GET <gateway>/v1/oauth` (`:49-66, 357-403`) |

`/login` offers Codex, Claude Pro/Max, GitHub Copilot, xAI, OpenRouter, Radius (`docs/providers.md:15-56`). **No OAuth module writes to disk** — `CredentialStore` (`auth/types.ts:65-94`), default in-memory; coding agent backs it with `~/.pi/agent/auth.json` mode `0600` (`core/auth-storage.ts:25, 52`).

**Resolution order** (`auth/resolve.ts:63-110`): `overrides.env`; request-level `overrides.apiKey`; **a stored credential owns the provider** (`:87-104`); only then env vars / AWS profiles / ADC (`:106-109`). "No silent env fallback after a failed refresh" (`:44-49`). Refresh double-checked-locked with 5-min floor, 15 s timeout (`:119-179`). `envMap` at `env-api-keys.ts:68-120` (36 providers). API-key values support `!command`, `$VAR`, `${VAR}` (`docs/providers.md:141-184`).

### Retries, errors, overflow, estimation, proxy

**Two independent retry layers:**
- **Transport** — `retryProviderRequest` (`utils/provider-retry.ts:105-125`). Every vendor SDK invoked with `maxRetries: 0` and wrapped, *because SDK backoff timers ignore `AbortSignal`* (`:97-104`). Retryable: `x-should-retry:true`, 408/409/429/≥500 (`:23-35`). Delay from `retry-after-ms`/`retry-after`, else `min(0.5·2^i, 8)s` with 25% jitter (`:51-67`). Server delay above `maxRetryDelayMs` (60 s) **fails immediately** (`:37-49`). Default `maxRetries` 0.
- **Turn** — `retryAssistantCall` (`utils/retry.ts:163-212`), regex classification with non-retryable deny-list checked first (`:7-24` vs `:26-90`). Backoff `baseDelayMs·2^(attempt-1)`, no jitter, no cap (`:196`).

**Errors never throw out of a stream** (`README.md:897`). `formatProviderError(normalizeProviderError(e))` (`utils/error-body.ts:38-54, 128-135`). Additive `diagnostics` channel (`utils/diagnostics.ts:32-45`) — Codex WebSocket→SSE fallback (`openai-codex-responses.ts:348-357`).

**Context overflow** (`utils/overflow.ts`): `isContextOverflow` (`:134-163`) matches 25 per-provider regexes (`:37-63`) with throttling deny-list (`:69-78`); silent overflow (`:144-150`) and length-stop overflow (`:152-160`) detections.

**Token estimation**: `CHARS_PER_TOKEN = 4`, 4800 chars per image (`utils/estimate.ts:14-15`); anchor-plus-tail (`:63-103`).

**Proxy** (`utils/node-http-proxy.ts:141-161`): full `NO_PROXY` semantics (`:74-116`); SOCKS/PAC rejected (`:156-158`). Only Bedrock (`bedrock-converse-stream.ts:207-215`) and Codex Bun WebSocket shim consult it; others use ambient `undici.EnvHttpProxyAgent`.

### The faux provider

`fauxProvider(options)` (`providers/faux.ts:685-708`) — a first-class provider with keyless auth. `setResponses`, `appendResponses`, `getPendingResponseCount`, `state.callCount` (`:132-154, 663-671`). Simulates cache hits by common-prefix (`:229-267`) and deferred responses (`:120-124`).

### Three more things

**`pi-messages` is pi's own protocol.** `POST <baseUrl>/messages` with `{model, context, options}` — internal `Context` verbatim — answered by SSE of pi events (`api/pi-messages.ts:1-10, 52-83`). Radius is the shipping consumer (`providers/radius-config.ts:61-68`). Server-side rewrite reporting via `PiMessagesRewriteImpact` (`:42-49`).

**`transform-messages.ts` is the shared pre-flight** (`:64-223`): image downgrade, cross-model thinking→text with signature stripping, tool-call-id normalization, repair of errored/orphaned histories. This makes mid-session model switching across vendors work.

**Constrained sampling** (`api/constrained-sampling.ts`): strict-JSON-schema rewriting rejecting 16 constructs (`:12-29, 100-127`), throws on `strict:"require"` failure (`:218-226`); OpenAI Lark/regex grammar tools (`:157-206`).

Other: Cloudflare base-URL templating (`api/cloudflare.ts:1-15`) and Workers binding transport (`api/cloudflare-gateway-binding.ts:79-143`); `openai-codex-responses` raw fetch to `/codex/responses`, zstd, WebSocket with SSE fallback (`:211-228, 293-366`); `mistral-conversations` posts to `v1/chat/completions` with 9-char tool-call ids (`:26, 362-397`); Bedrock/Vertex/Azure api-key-optional. Pre-0.81 global API survives at `@earendil-works/pi-ai/compat` (`compat.ts:198-230`), slated for removal (`README.md:1577`).

## 3. Agent core (`pi-agent-core`)

`agentLoop()` / `agentLoopContinue()` return `EventStream<AgentEvent, AgentMessage[]>` terminating on `agent_end` (`packages/agent/src/agent-loop.ts:32-55, 65-94, 146-151`). `runLoop` (`:156-273`) has **no iteration cap** — no `maxSteps`. Outer loop re-enters on follow-ups (`:261-266`); inner runs while `hasMoreToolCalls || pendingMessages.length > 0` (`:175`). Provider `error`/`aborted` exits immediately with no in-loop retry (`:215-219`). A `length` stop fails *every* tool call in the batch unexecuted (`:227-233`).

Tool batches parallel by default (`src/agent.ts:237`); preparation sequential so `beforeToolCall` fires in order; execution `Promise.all` (`agent-loop.ts:497-555`). Any tool with `executionMode: "sequential"` forces the batch serial (`:409-424`).

Schemas are **TypeBox** (`src/types.ts:16`). `AgentTool` = `{ name, description, parameters, label, prepareArguments?, executionMode?, execute(toolCallId, params, signal?, onUpdate?) }` (`types.ts:387-410`). Results split `content` / `details`, plus `usage?`, `addedToolNames?`, `terminate?` (`types.ts:362-376`). Errors must be **thrown** (`types.ts:395`). Early termination requires unanimity (`agent-loop.ts:589-591`).

`AgentEvent` 10 arms: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start/update/end` (`types.ts:429-444`).

Steering and follow-up: two `PendingMessageQueue`s, mode `"all"` or `"one-at-a-time"` (`agent.ts:125-159, 231-232`). Abort: one `AbortController` per run (`agent.ts:491-496`); partial output preserved (`agent-loop.ts:344-357`).

Hooks on `AgentLoopConfig`: required `convertToLlm`, optional `transformContext`, `getApiKey`, `shouldStopAfterTurn`, `prepareNextTurn`, `beforeToolCall`, `afterToolCall`, `getSteeringMessages`, `getFollowUpMessages` (`types.ts:149-294`). Transport seam `StreamFn` (`types.ts:28-32`), `setDefaultStreamFn` (`src/stream-fn.ts:11-13`). `src/proxy.ts` is the remote SSE variant (`proxy.ts:118-259`).

**The core has no default system prompt.** `harness/system-prompt.ts` is 34 lines, one function `formatSkillsForSystemPrompt()` (`:3-25`). `AgentState.systemPrompt` initialises to `""` (`agent.ts:75`).

**Caveat.** `packages/agent/src/harness/` contains a second-generation durable harness (`AgentHarness`, lane/record store v4) whose 2,941-line spec `docs/harness.md` describes intended behaviour; the implementation throws `HarnessNotImplemented` (`harness/agent-harness.ts:347-442`). The shipping CLI uses the `Agent` class.

## 4. Extension system

**Exactly 36 events**, from `pi.on()` overloads at `packages/coding-agent/src/core/extensions/types.ts:1257-1301`:

*Startup/resources* — `project_trust`, `resources_discover`.
*Session* — `session_start`, `session_info_changed`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`, `session_compact_failed`, `session_shutdown`, `session_before_tree`, `session_tree`.
*Provider/context* — `context`, `before_provider_request`, `before_provider_headers`, `after_provider_response`.
*Agent* — `before_agent_start`, `agent_start`, `agent_end`, `agent_settled`, `ui_prompt_start`, `ui_prompt_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`.
*Model* — `model_select`, `thinking_level_select`.
*Tool/input* — `tool_call`, `tool_result`, `user_bash`, `input`.

What they can do:
- **Block a tool.** `tool_call` returns `{ block, reason?, terminate? }` (`types.ts:1125-1134`). `emitToolCall` short-circuits on first `block` (`runner.ts:986-1002`); a throwing handler propagates and blocks (`agent-session.ts:501-506`). Fail-safe is the contract (`docs/extensions.md:2922`).
- **Mutate args.** `event.input` mutable in place; **no re-validation** after mutation (`docs/extensions.md:786-794`).
- **Mutate results.** `tool_result` chains partial patches over `content`, `details`, `isError`, `usage` (`types.ts:1144-1149`).
- **Replace a finalized message.** `message_end` returns `{ message }` (`types.ts:1151-1154`).
- **Rewrite the LLM context.** `context` receives a `structuredClone`, returns replacement messages (`runner.ts:1034-1064`).
- **Inject a message and/or replace the system prompt per turn.** `before_agent_start` returns `{ message?, systemPrompt? }` (`types.ts:1156-1160`); applied `agent-session.ts:1285-1306`; carries `systemPromptOptions` (`types.ts:717-727`).
- **Rewrite wire payload/headers.** `before_provider_request`, `before_provider_headers` (`types.ts:694-714`).
- **Intercept user `!` bash.** `user_bash` (`types.ts:1137-1142`).
- **Intercept input.** `input` → `{action: "continue"|"transform"|"handled"}` (`types.ts:880-883`).
- **Own project trust.** `project_trust` (`types.ts:526-531`).
- **Cancel session transitions/compaction, or supply a custom summary** (`types.ts:1162-1189`).

**`ExtensionAPI`** (`types.ts:1252-1500`): `on`, `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`/`getFlag`, `registerMessageRenderer`, `registerMarkdownTransformer`, `registerEntryRenderer`, `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`/`getSessionName`, `setLabel`, `exec`, `getActiveTools`/`getAllTools`/`setActiveTools`, `getCommands`, `setModel`, `getThinkingLevel`/`setThinkingLevel`, `registerProvider`/`unregisterProvider`, `events`.

`sendMessage` takes `deliverAs: "steer"|"followUp"|"nextTurn"` + `triggerTurn` (`types.ts:1365-1368`). `appendEntry` writes a `custom` entry that **never** enters LLM context vs `custom_message` which does (`docs/extensions.md:1418, 1473`).

**Tool definition** (`types.ts:451-500`): `name`, `label`, `description`, `promptSnippet?`, `promptGuidelines?`, TypeBox `parameters`, `constrainedSampling?`, `renderShell?`, `prepareArguments?`, `executionMode?`, `execute(toolCallId, params, signal, onUpdate, ctx)`, optional `renderCall`/`renderResult`. Renderer inheritance per slot (`docs/extensions.md:2095`).

**`ctx.ui`** (`types.ts:133-284`) — `select`/`confirm`/`input`/`editor`, `notify`, `onTerminalInput`, `setStatus`, `setWorkingMessage`/`setWorkingVisible`/`setWorkingIndicator`, `setHiddenThinkingLabel`, `setWidget`, `setFooter`, `setHeader`, `setTitle`, `custom<T>()`, `pasteToEditor`, `setEditorText`/`getEditorText`, `addAutocompleteProvider`, `setEditorComponent`/`getEditorComponent`, `theme`, `getAllThemes`/`getTheme`/`setTheme`, `getToolsExpanded`/`setToolsExpanded`.

**`ctx`** adds `mode` (`"tui"|"rpc"|"json"|"print"`), `hasUI`, `cwd`, `sessionManager`, `modelRegistry`, `model`, `scopedModels`, `thinkingLevel`, `isIdle`, `isProjectTrusted`, `signal`, `abort`, `hasPendingMessages`, `shutdown`, `getContextUsage`, `compact`, `getSystemPrompt` (`types.ts:309-349`). `ExtensionCommandContext` — `getSystemPromptOptions`, `waitForIdle`, `newSession`, `fork`, `navigateTree`, `switchSession`, `reload` — withheld from event handlers because they deadlock (`types.ts:355-389`).

**Custom providers from extensions.** Full `Provider` or `registerProvider(name, ProviderConfig)` with `baseUrl`, `apiKey`, `api`, `headers`, `authHeader`, `models[]`, `refreshModels`, `oauth {...}`, `streamSimple` (`types.ts:1507-1551`).

**Loading.** `.pi/extensions/` (project, post-trust) → `~/.pi/agent/extensions/` → configured paths (`loader.ts:779-803`). Bare `*.ts`/`*.js`, `<dir>/index.ts`, or `package.json` with `pi.extensions` (`loader.ts:666-753`). Loaded via **jiti** (`loader.ts:498-510`). npm deps from sibling `node_modules` (`with-deps` example). Pi packages via `npm:`/`git:`/URL (`docs/packages.md:22-90`). `-e/--extension`; SDK `InlineExtension` (`types.ts:1584-1592`) — pi's llama.cpp integration ships as one (`src/extensions/index.ts:4`).

Error isolation per handler (`runner.ts:851-883`). First registration per tool/flag wins (`runner.ts:500-511, 524-530`); duplicate commands get `/review:1` (`docs/extensions.md:1529`).

**Resources.** *Skills* implement the Agent Skills spec with one divergence — `name` need not match directory (`docs/skills.md:7, 144`). Loaded from `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, `.agents/skills/` walking up, plus packages/settings/`--skill` (`:24-34`). Frontmatter: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation` (`:142-150`). Names/descriptions in prompt as `<available_skills>` XML (`core/skills.ts:355-381`); cross-harness reuse (`~/.claude/skills`, `~/.codex/skills`, `:46-55`). *Prompt templates* `.md` with `$1`/`$@`/`${1:-default}`/`${@:N:L}` (`docs/prompt-templates.md:9-17, 65-96`). *Context files* `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md` first-match per directory, walked to root (`core/resource-loader.ts:71-90, 119-157`). *Themes* JSON with 51 color tokens (`docs/themes.md:163-169`).

**Settings** (`~/.pi/agent/settings.json`, `.pi/settings.json`, deep-merged): `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `modelThinkingLevels`, `thinkingBudgets`, `hideThinkingBlock`, `theme`, `externalEditor`, `defaultProjectTrust`, `doubleEscapeAction`, `treeFilterMode`, `tuiMode`, `httpProxy`, `compaction.*`, `branchSummary.*`, `retry.*`, `steeringMode`, `followUpMode`, `transport`, `terminal.*`, `images.*`, `shellPath`, `shellCommandPrefix`, `npmCommand`, `defaultTools`, `sessionDir`, `enabledModels`, `markdown.*`, `packages`, `extensions`, `skills`, `prompts`, `themes`, `enableSkillCommands` (`docs/settings.md:24-318`).

## 5. Session model

**v3 JSONL** at `~/.pi/agent/sessions/--<cwd-dashed>--/<ISO>_<uuid>.jsonl` (`docs/session-format.md:5-11`; `core/session-manager.ts:476-481, 952-955`). Line 1 `SessionHeader {type,version,id,timestamp,cwd,parentSession?}`; every other line extends `{type,id,parentId,timestamp}` (`session-manager.ts:32-51`). Nine entry types: `message`, `thinking_level_change`, `model_change`, `compaction`, `branch_summary`, `custom`, `custom_message`, `label`, `session_info` (`:53-153`). **No index file** — `list()` walks directories (`:494, 812-843`). Files not created until first assistant message (`:1016-1043`). Migrations v1→v2→v3 (`:230-296`).

Tree by `parentId`; branching is a leaf-pointer move, never deletes (`:845-855, 1361-1366`). `/tree` offers no-summary / summarize / summarize-with-instructions (`interactive-mode.ts:5223-5227`). `/fork` and `/clone` via `createBranchedSession` (`:1414-1514`); `forkFrom()` cross-project (`:1581-1632`).

Compaction (`core/compaction/compaction.ts`): triggers when `contextTokens > contextWindow - reserveTokens`, 16384 / 20000 defaults (`:132-136, 235-238`). Resumes from previous `firstKeptEntryId`, **iterative summary update** (`:750-829`). Cut points never tool results (`:308-321`); mid-turn cut → turn-prefix summary (`:451-460`). `length` stop is hard failure (`:545-553`). Reasons `manual`/`threshold`/`overflow`; overflow recovery compacts and retries once (`agent-session.ts:2152-2195`). `getContextUsage()` returns `tokens: null` right after compaction (`:3375-3419`).

Persistence pluggability **not** in v3 `SessionManager` (concrete; `inMemory()` only alternative, `:1570-1572`). It exists in the harness stack: `SessionStorage`/`SessionRepo` (`packages/agent/src/harness/session/types.ts:290-326, 361-373`), 16-case conformance kit (`harness/session/testing/conformance.ts:92-1016`) that `session-backends/sqlite-node` passes.

## 6. Built-in tools, MCP, sub-agents, permissions

Eight tools: **`read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`** (`core/tools/index.ts:95-105`). Defaults `read`, `bash`, `edit`, `write` (`docs/settings.md:226-244`). `grep`/`find` shell out to ripgrep/fd (`grep.ts:177`; `find.ts:225`). Presets `createCodingTools`, `createReadOnlyTools`, `createAllTools` (`index.ts:195-223`). Truncation 50 KB / 2000 lines.

Any built-in **replaced** by same-name registration (`docs/extensions.md:2080-2099`), or `--no-builtin-tools`. Pluggable `*Operations` interfaces route execution to SSH/containers/micro-VM, plus `spawnHook` (`docs/extensions.md:2111-2166`).

**MCP: none.** `README.md:499`. No MCP code in `packages/*/src`.

**Sub-agents: none built-in.** `README.md:501`. Worked example `examples/extensions/subagent/` — spawns `pi` in JSON mode per task, four agent definitions, three workflow templates (`subagent/README.md:1-65`).

**Permissions: none built-in.** Root `README.md`. `docs/security.md:31-37`: "A partial in-process sandbox would be easy to misunderstand as a security boundary." Project trust is "only an input-loading guard" (`:37`). Instead: `tool_call` gate (`examples/extensions/permission-gate.ts:13-33`), OS sandbox via `@anthropic-ai/sandbox-runtime` (`examples/extensions/sandbox/index.ts:1-42`), or Gondolin micro-VM overriding all seven tools + `user_bash` (`docs/containerization.md:19-43`).

## 7. Interfaces

**Interactive TUI.** `TuiMainScreen` (differential) and `TuiAltScreen` (application-owned viewport, OSC 133/8/52, search); CSI 2026 synchronized output (`packages/tui/README.md:57-62, 652-662`). Component `{ render(width): string[]; handleInput?; invalidate() }` (`docs/tui.md:13-27`). Built-ins: editor, markdown, image, select-list, settings-list, scroll-view, box, stacks, loaders (`packages/tui/src/index.ts:13-44`). Editor 2,363 lines. Kitty/iTerm2 images. Native modifier-key modules (`native-modifiers.ts:7-49`).

Keybindings: 44 `tui.*` (`keybindings.ts:71-210`) + 41 `app.*` (`core/keybindings.ts:74-233`), `~/.pi/agent/keybindings.json` (`docs/keybindings.md:193-207`).

**Print / JSON mode**: one function by `mode` (`src/modes/print-mode.ts:20, 33-168`). JSON: header line then one JSON line per event, `partial` stripped (`:122-127`; `json-event.ts:46-61`; `docs/json.md:87-92`). Auto-select: non-TTY → print (`src/main.ts:110-121`).

**RPC mode** — LF JSONL with bespoke reader (`docs/rpc.md:20-37`; `rpc/jsonl.ts:21-58`). ~30 commands (`rpc-types.ts:20-74`). `prompt` responds at *acceptance* (`rpc-mode.ts:394-416`). Events = JSON stream + `agent_settled`, `bash_execution_update`, retry, `extension_error` (`docs/rpc.md:861-884`). **No permission method** — approval via extension-UI sub-protocol `extension_ui_request`/`extension_ui_response` (`docs/rpc.md:1184-1226`). `RpcClient` (`rpc-client.ts:56-609`).

**Evals** (`packages/evals`): real-model `AgentSession`s in temp workspaces, `vitest-evals`, A/B tables (`README.md:3-19`; `src/pi-harness.ts:246-250`).

## 8. Customizability ceiling

Designed to be replaced: every built-in tool; the tool set; the provider layer (full `Provider` with own `stream`); the LLM context; wire payload/headers; the editor; footer/header/widgets/status/working indicator; autocomplete; markdown pipeline; renderers; compaction and branch summarization; project trust; keybindings; themes. SDK `DefaultResourceLoader` exposes `systemPromptOverride`, `skillsOverride`, `promptsOverride`, `themesOverride`, `agentsFilesOverride`, `extensionFactories` (`core/resource-loader.ts:177-192`). Brand: `piConfig.name` / `piConfig.configDir` (`src/config.ts:496-505`; `docs/development.md:22-35`).

**System prompt fully replaceable.** `buildSystemPrompt()` (`core/system-prompt.ts:28-169`) ~40 lines: role sentence, `Available tools` from `promptSnippet`s, tool-conditional `Guidelines`, paths to pi's own docs. `customPrompt` skips all of it, keeping appended text, `<project_context>`, skills block, cwd (`:46-72`). Four override paths: `--system-prompt`, `.pi/SYSTEM.md`/`~/.pi/agent/SYSTEM.md` (`resource-loader.ts:1024-1033`), `before_agent_start`, SDK `systemPromptOverride`. `--append-system-prompt` / `APPEND_SYSTEM.md` add.

**Requires a fork:** the agent loop's turn structure/batch semantics/unanimity rule; TUI shell composition in `interactive-mode.ts` (6,575 lines — slots replaceable, orchestration not); v3 session format and `SessionManager`; RPC command vocabulary; built-in interactive-only slash commands (`docs/extensions.md:1590`); JSON-mode event shape; the ten `KnownApi` transports.

## 9. Quality and operations

Deterministic tests use the **faux provider** and `test/suite/harness.ts` — no real APIs/keys/network (`test/suite/README.md:5-10`). `createHarness()` (`harness.ts:101-224`). `packages/server` ships `sendFragmented(chunk, splitAt)` (`server/src/testing/client.ts:20-55`).

Telemetry contracts-only, opt-in: `TelemetryContext.startSpan(options, callback)`, default frozen no-op, no exporter (`packages/telemetry/src/index.ts:14-22`; `noop.ts:11-20`). Twelve spans (`packages/agent/docs/telemetry-schema.md:9-354`), never prompts/payloads. Install ping settings-gated with `PI_TELEMETRY` override, analytics off by default (`docs/settings.md:60-61, 84-86`).

Supply chain: exact-pinned deps, `save-exact=true`, `min-release-age=2`, pre-commit lockfile block, published `npm-shrinkwrap.json`, `--ignore-scripts` everywhere, lifecycle-script allowlist, scheduled `npm audit`/`audit signatures`. Lockstep releases via **npm trusted publishing (GitHub OIDC)**, source tarball + six Bun binaries with `SHA256SUMS` (`AGENTS.md`; `.github/workflows/build-binaries.yml:121, 297-343`).

## 10. Design philosophy, quoted

- "Pi is aggressively extensible so it doesn't have to dictate your workflow… This keeps the core minimal while letting you shape pi to fit how you work." (`packages/coding-agent/README.md:497`)
- "**No MCP.** … **No sub-agents.** … **No permission popups.** … **No plan mode.** … **No built-in to-dos.** They confuse models. … **No background bash.** Use tmux. Full observability, direct interaction." (`README.md:499-509`)
- "Adapt pi to your workflows, not the other way around, without having to fork and modify pi internals." (`README.md:15`)
- "Pi is a minimal terminal coding harness. It is designed to stay small at the core while being extended through TypeScript extensions, skills, prompt templates, themes, and pi packages." (`docs/index.md:3`)
- On the absent sandbox: "This is intentional. … Real isolation needs to come from the operating system or a virtualization/container boundary." (`docs/security.md:35`)
- Self-documenting: "pi can create extensions. Ask it to build one for your use case." (`docs/extensions.md:1`); the default system prompt hard-codes paths to pi's own docs (`core/system-prompt.ts:138-145`).

---

## Caveats on evidence

1. **Model counts are not source-verifiable** — from the npm tarball (manifest `generatedAt: 2026-08-28`), drift by design.
2. **`packages/agent/src/harness/` is specified but not implemented** — `HarnessNotImplemented`. Treat `docs/harness.md` as roadmap.
3. **Tool code is duplicated** across `packages/agent/src/harness/tools/` and `packages/coding-agent/src/core/tools/`. The CLI runs the coding-agent copies.
