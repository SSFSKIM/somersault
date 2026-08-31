# 12 — The network/service layer: API client, auth, providers, telemetry, updater

**Source of record:** `~/claude-code-bundle/2.1.251/cli.pretty.js` (881,404 lines, beautified from the
2.1.251 arm64 Mach-O bundle; `VERSION: "2.1.251"`, `BUILD_TIME: "2026-08-28T14:51:38Z"`,
`GIT_SHA: 37534ac596d80cefb02d272f036adba4ba055d2c`). All `cli.pretty.js:NNNN` anchors below point at
that file. Symbols are minified **per chunk**, so a name like `Ne` means different things in
different chunks; every anchor names the chunk-local identifier together with its line.

Anything marked **INFERRED** is a reading of surrounding code rather than a directly quoted literal.

---

## Executive summary

1. Claude Code talks to Anthropic through a **vendored `@anthropic-ai/sdk` v0.112.1** (`cli.pretty.js:236067`),
   wrapped by a Claude-Code-owned client factory (`lM`, `cli.pretty.js:846490`) that picks one of **eight**
   provider back ends: `firstParty`, `bedrock`, `vertex`, `foundry`, `anthropicAws`, `anthropicGoogleCloud`,
   `mantle`, `gateway` (`cli.pretty.js:877171`).
2. Every request carries `x-app: cli` (or `cli-bg`), `User-Agent: claude-cli/2.1.251 (external, <entrypoint>)`,
   `X-Claude-Code-Session-Id`, and a `metadata.user_id` that is a **JSON blob** of device/account/session ids
   (`aC`, `cli.pretty.js:497908`) — not an opaque string.
3. Betas live in one hand-maintained registry of **33 live entries** (`cli.pretty.js:303292`); which ones ship on a
   given request is decided per model + provider + gate by `Ru`/`BV` (`cli.pretty.js:306516`).
4. The model catalog is **baked into the binary** — 17 models with per-provider ids, context windows,
   max-output, pricing tiers and capability flags (`cli.pretty.js:876976`); aliases resolve `opus→claude-opus-5`,
   `sonnet→claude-sonnet-5`, `haiku→claude-haiku-4-5`, `fable→claude-fable-5`, `best→fable`.
5. Auth has five real flavors: claude.ai/Console **OAuth + PKCE(S256)** on a loopback `/callback`
   (`cli.pretty.js:312933`), `ANTHROPIC_API_KEY`, an `apiKeyHelper` script with a 5-minute TTL
   (`cli.pretty.js:313470`), cloud-provider credential chains, and a **workload-identity-federation (WIF)
   profile** path. Credentials go to the macOS Keychain under service `Claude Code-credentials`
   (`cli.pretty.js:650780`) with `~/.claude/.credentials.json` (mode 0600) as fallback.
6. Retries are two-layered: the vendored SDK retries 408/409/429/5xx with `0.5·2ⁿ` capped at 8 s
   (`cli.pretty.js:240258`), and Claude Code's own loop retries with `500·2^(n−1)` capped at 32 s (300 s for
   persistent 429s), honoring `Retry-After` as a floor (`kV`, `cli.pretty.js:227981`), default 10 attempts.
7. **Statsig is gone.** 2.1.251 uses **GrowthBook** in remote-eval mode against
   `https://api.anthropic.com/api/eval-authed/sdk-zAZezfDKGoZuXXKe` (`cli.pretty.js:302004`), with 379 distinct
   `tengu_*` gate reads.
8. **Sentry is gone too.** Crash/error reporting goes to **Datadog** at
   `https://http-intake.logs.us5.datadoghq.com/api/v2/logs` with the public key
   `pubea5604404508cdd34afb69e6f42a05bc` (`cli.pretty.js:312658`), gated to first-party + a 190-entry event
   allowlist. Analytics events go to `https://api.anthropic.com/api/event_logging/v2/batch`
   (`cli.pretty.js:309602`); OTLP metrics/logs/traces are the customer-facing surface.
9. The native updater polls **every 30 minutes** (`cli.pretty.js:269863`), fetches
   `https://downloads.claude.ai/claude-code-releases/{stable|latest}` for a version string, then a
   per-version `manifest.json`, verifies SHA-256, and atomically re-points the `~/.local/bin/claude` symlink
   at `~/.local/share/claude/versions/<v>` under a lock.
10. Rate limits are surfaced through ~30 `anthropic-ratelimit-unified-*` response headers
    (`cli.pretty.js:299263`) covering the 5-hour and 7-day windows, per-model weekly claims, overage/extra-usage,
    and a "slow / lower-priority" lane; `/usage` reads `GET /api/oauth/usage` (`cli.pretty.js:329357`).

---

## 1. Request construction

### 1.1 Base URLs per provider

`dr(provider, model, region)` — `cli.pretty.js:846771`.

| provider | base URL | override env |
|---|---|---|
| `firstParty` | `https://api.anthropic.com` | `ANTHROPIC_BASE_URL` |
| `bedrock` | `https://bedrock-runtime.<region>.amazonaws.com` | `ANTHROPIC_BEDROCK_BASE_URL` |
| `mantle` | `https://bedrock-mantle.<region>.api.aws` | `ANTHROPIC_BEDROCK_MANTLE_BASE_URL` |
| `anthropicAws` | `https://aws-external-anthropic.<region>.api.aws` | `ANTHROPIC_AWS_BASE_URL` |
| `anthropicGoogleCloud` | `https://claude.googleapis.com` | `ANTHROPIC_GOOGLE_CLOUD_BASE_URL` |
| `vertex` | `https://<region>-aiplatform.googleapis.com` (`global`→`https://aiplatform.googleapis.com`; `us`/`eu`→`https://aiplatform.<r>.rep.googleapis.com`, `Cve`, `cli.pretty.js:110554`) | `ANTHROPIC_VERTEX_BASE_URL` |
| `foundry` | resolved from `ANTHROPIC_FOUNDRY_RESOURCE` | `ANTHROPIC_FOUNDRY_BASE_URL` |
| `gateway` | the enterprise gateway's `url` (JWT session) | via `/login` |

First-party-ness is decided by host equality against the single-element allowlist `["api.anthropic.com"]`
(`NT`, `cli.pretty.js:877221`), or forced by `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL`. Many behaviors
(1M-context beta, prompt-cache 1h, Datadog, gzip, attribution) key off *that* predicate rather than off
`provider === "firstParty"`.

The OAuth/console constant block (`cli.pretty.js:744037`):

| key | value |
|---|---|
| `BASE_API_URL` | `https://api.anthropic.com` |
| `CONSOLE_AUTHORIZE_URL` | `https://platform.claude.com/oauth/authorize` |
| `CLAUDE_AI_AUTHORIZE_URL` | `https://claude.com/cai/oauth/authorize` |
| `CLAUDE_AI_ORIGIN` | `https://claude.ai` |
| `TOKEN_URL` | `https://platform.claude.com/v1/oauth/token` |
| `API_KEY_URL` | `https://api.anthropic.com/api/oauth/claude_cli/create_api_key` |
| `ROLES_URL` | `https://api.anthropic.com/api/oauth/claude_cli/roles` |
| `CONSOLE_SUCCESS_URL` | `https://platform.claude.com/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dclaude-code` |
| `CLAUDEAI_SUCCESS_URL` | `https://platform.claude.com/oauth/code/success?app=claude-code` |
| `MANUAL_REDIRECT_URL` | `https://platform.claude.com/oauth/code/callback` |
| `CLIENT_ID` | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| `DESIGN_CLIENT_ID` | `59637612-477b-4836-a601-b0589eda7704` |
| `MCP_PROXY_URL` | `https://mcp-proxy.anthropic.com` |
| `MCP_PROXY_PATH` | `/v1/mcp/{server_id}` |

`CLAUDE_CODE_CUSTOM_OAUTH_URL` may retarget the whole block, but only to a three-entry allowlist
(`cli.pretty.js:744047`): `https://beacon.claude-ai.staging.ant.dev`, `https://claude.fedstart.com`,
`https://claude-staging.fedstart.com`. Anything else throws
`"CLAUDE_CODE_CUSTOM_OAUTH_URL is not an approved endpoint."` `CLAUDE_CODE_OAUTH_CLIENT_ID` overrides
`CLIENT_ID`.

### 1.2 Default headers

Assembled in `lM` (`cli.pretty.js:846490`):

```js
{ "x-app": wt() ? "cli-bg" : "cli",
  "User-Agent": jI(),
  "X-Claude-Code-Session-Id": <sessionId>,
  ...ANTHROPIC_CUSTOM_HEADERS,
  ...CLAUDE_CODE_CONTAINER_ID     && { "x-claude-remote-container-id": ... },
  ...CLAUDE_CODE_REMOTE_SESSION_ID&& { "x-claude-remote-session-id": ... },
  ...CLAUDE_AGENT_SDK_CLIENT_APP  && { "x-client-app": ... },
  ...agentId       && { "x-claude-code-agent-id": ... },
  ...parentAgentId && { "x-claude-code-parent-agent-id": ... } }
```

`CLAUDE_CODE_ADDITIONAL_PROTECTION` (truthy) adds `x-anthropic-additional-protection: true`.
The session-id header name literal is `X-Claude-Code-Session-Id` (`HMe`, `cli.pretty.js:304158`).

**User-Agent variants** (three distinct builders, easy to confuse):

| fn | format | used for |
|---|---|---|
| `jI()` `cli.pretty.js:315678` | `claude-cli/2.1.251 (external, <CLAUDE_CODE_ENTRYPOINT‖cli>[, agent-sdk/<v>][, client-app/<v>][, workload/<w>])` | **the inference client**, plus `/api/claude_code_shared_session_transcripts` |
| `WI()` `cli.pretty.js:315690` | `claude-code/2.1.251 (<entrypoint>, agent-sdk/<v>, client-app/<v>)` | MCP transports, IDE websockets |
| `Ka()` `cli.pretty.js:58218` | `claude-code/2.1.251` (bare) | telemetry/metrics/gateway-discovery HTTP |
| `ySn()` `cli.pretty.js:315699` | `Claude-User (claude-code/2.1.251; +https://support.anthropic.com/)` | outbound web fetches |

**`anthropic-client-platform`** (`Cg()`, `cli.pretty.js:58221`) maps `CLAUDE_CODE_ENTRYPOINT` →
`claude_code_vscode`, `claude_code_remote` (for `remote`, `remote_baku`, `remote_cowork`, `remote_desktop`,
`remote_mobile`, `claude-in-teams`), `claude_code_sdk` (`sdk-cli`/`sdk-ts`/`sdk-py`), `claude_code_mcp`,
`claude_code_github_action`, `claude_code_local_agent`, `claude_in_slack`, `claude-in-slack`, default
`claude_code_cli`. It is sent on the ancillary HTTP surfaces, not by the SDK client itself.

`anthropic-version: 2023-06-01` is a literal on the ancillary fetches (`cli.pretty.js:261996`, `262210`,
`262664`, `263101`, `263252`, `255110`, `141184`); the messages path gets it from the vendored SDK.

**`ANTHROPIC_CUSTOM_HEADERS`** (`i2t`, `cli.pretty.js:846656`) is newline-separated `Name: value`; blank lines
and lines without `:` are skipped; names/values are trimmed. It is merged into `defaultHeaders` *before* the
Claude-Code-owned keys are validated, and a header value the HTTP runtime rejects raises
`InvalidRequestHeaderValueError` naming the source (`u3t`, `cli.pretty.js:304181`). On Bedrock/Vertex/
Foundry/etc. an `Authorization` supplied this way is honored only under the matching `..._SKIP_..._AUTH` flag.

### 1.3 Extra body params

`vM(betas)` — `cli.pretty.js:497790`:

- Parses `CLAUDE_CODE_EXTRA_BODY` as a JSON object; non-objects log an error and are ignored.
- If `metadata.user_id` in that object is itself JSON containing a `tk` key, `tk` is **stripped**.
- Merges `anthropic_beta` (array) with the request's computed betas, de-duplicated. This is the
  **Bedrock** path for betas — Bedrock gets `body.anthropic_beta` where first-party gets the `betas` param
  (`otr`, `cli.pretty.js:306562`; explicit log line at `cli.pretty.js:498566` for afk-mode).

`aC({agentContext})` — `cli.pretty.js:497908` — builds `metadata`:

```js
{ user_id: JSON.stringify({
    ...CLAUDE_CODE_EXTRA_METADATA (object, sanitized),
    device_id, account_uuid, session_id,
    ...parent_session_id, ...tk /* turn-attribution key, remote only */ }) }
```

If the serialized blob exceeds the cap (`nOe`), the extra-metadata layer is dropped, then the custom layer,
until it fits. `device_id` is the 32-byte hex `userID` persisted in `~/.claude.json` (`Qk`,
`cli.pretty.js:312430`).

### 1.4 The final `/v1/messages` body

`cli.pretty.js:498606`:

```js
{ model: XI(d.model),          // alias → provider id
  messages, system, tools, tool_choice,
  ...betas && { betas: [...] },
  metadata: aC({agentContext}),
  max_tokens, thinking,
  ...temperature,              // 1 when thinking is off and the model allows it
  ...context_management,       // when the context-management beta is on
  ...contextHintBody, ...cacheEvictBody,
  ...serverSideFallbacks,      // { fallbacks: ... }
  ...CLAUDE_CODE_EXTRA_BODY,
  ...output_config,            // { effort, task_budget, format }
  ...speed: "fast",            // fast-mode
  ...thread,                   // thread/replay planning
  ...diagnostics: { previous_message_id } }
```

Notable: `max_tokens` is `min(override, oDe(model))` where `oDe` reads `CLAUDE_CODE_MAX_OUTPUT_TOKENS`
clamped to the catalog's `max_output_tokens.upper` (`cli.pretty.js:499596`). Thinking budget is clamped to
`[1024, max_tokens-1]`.

### 1.5 The `x-anthropic-billing-header` that is not a header

`XBt` (`cli.pretty.js:846252`) builds the string

```
x-anthropic-billing-header: cc_version=2.1.251.<hash>; cc_entrypoint=<entrypoint>; [cch=00000;] [cc_workload=<w>;] [cc_is_subagent=true;] [cc_prev_req=req_…;] [cc_prompt_id=<uuid>;]
```

and it is prepended as the **first system-prompt block** (`cli.pretty.js:498447`), not sent as an HTTP header.
`cch=00000;` is added on first-party (with a first-party base URL) and on Vertex. `cc_prev_req` and
`cc_prompt_id` are only added on first-party. `CLAUDE_CODE_ATTRIBUTION_HEADER` (falsy) suppresses the whole
line.

### 1.6 anthropic-beta strings — the complete registry

`he(name, header)` freezes `{name, header}` pairs; the live list is `C4` (`cli.pretty.js:303292`).
Two entries in the source array are `null` in this build (`P8e`, `R4`, `LSt`) and are filtered out.

| header string | internal name | switched on by |
|---|---|---|
| `claude-code-20250219` | `claude_code` | every non-haiku model (`Ru`, `cli.pretty.js:306521`); force-added for agentic queries |
| `oauth-2025-04-20` | `oauth_auth` | OAuth/claude.ai inference auth, or WIF profile auth (`cli.pretty.js:306523`) |
| `interleaved-thinking-2025-05-14` | `interleaved_thinking` | thinking-capable model && `!DISABLE_INTERLEAVED_THINKING` |
| `context-1m-2025-08-07` | `long_context` | `[1m]` model suffix (`Cc`), or `b3t()` sonnet-4-6 window override |
| `context-management-2025-06-27` | `context_management` | `USE_API_CONTEXT_MANAGEMENT` or `cQ(model)`, on `r0()` providers, unless experimental betas are off |
| `structured-outputs-2025-12-15` | `structured_outputs` | gate `tengu_tool_pear` + model supports it |
| `web-search-2025-03-05` | `web_search` | Vertex (when the model needs it) and Foundry only |
| `advanced-tool-use-2025-11-20` | `tool_search` | — (registered; selection is via `vr` in this build) |
| `tool-search-tool-2025-10-19` | `tool_search` | tool-search path |
| `effort-2025-11-24` | `effort` | `output_config.effort` present (`e8n`, `cli.pretty.js:497892`) |
| `task-budgets-2026-03-13` | `task_budgets` | `taskBudget` present + first-party-ish (`t8n`) |
| `prompt-caching-scope-2026-01-05` | `prompt_caching_scope` | `uw()` (first-party-ish, experimental betas allowed) |
| `prompt-caching-evict-2026-05-12` | `prompt_caching_evict` | `evictCacheOnComplete` + sticky betas |
| `extended-cache-ttl-2025-04-11` | `extended_cache_ttl` | 1h cache TTL chosen |
| `fast-mode-2026-02-01` | `speed` | fast-mode request (`speed: "fast"`) |
| `redact-thinking-2026-02-12` | `redact_thinking` | thinking model, non-interactive off, first-party-ish |
| `thinking-token-count-2026-05-13` | `thinking_token_count` | thinking model + `provider === firstParty` |
| `afk-mode-2026-01-31` | `afk_mode` | auto-mode ("afk") active |
| `advisor-tool-2026-03-01` | `advisor_tool` | advisor tool in the tool list |
| `cache-diagnosis-2026-04-07` | `cache_diagnosis` | cache-diagnosis path |
| `context-hint-2026-04-09` | `context_hint` | context-hint controller emits a param |
| `mcp-servers-2025-12-04` | `mcp_servers` | `/v1/mcp_servers` calls |
| `files-api-2025-04-14` | `files_api` | Files API |
| `environments-2025-11-01` | `environments` | environment-runner API (`cli.pretty.js:255110`) |
| `ccr-byoc-2025-07-29` | `ccr_byoc` | `POST /v1/code/github/import-token` (`cli.pretty.js:61315`) |
| `mid-conversation-system-2026-04-07` | `mid_conversation_system` | model has the `mid_conv_system` capability |
| `per-turn-control-2026-07-01` | `per_message_effort` | per-turn effort enabled |
| `server-side-fallback-2026-06-01` | `server_side_fallback` | server-side fallback lane |
| `server-side-fallback-2026-07-01` | `server_side_fallback_category` | category variant of the same |
| `fallback-credit-2026-06-01` | `fallback_credit` | fallback-credit lane |
| `x-cc-internal-mid-conv-cache-promotion` | `mid_conv_cache_promotion_latch` | internal latch |
| `x-cc-internal-mid-conv-cache-promotion-ok` | `mid_conv_cache_promotion_ok_latch` | internal latch |
| `auto-mode-classifier-2026-07-16` | `auto_mode_classifier` | auto-mode classifier calls |
| `thinking-display-updates-2026-08-18` | `thinking_display_updates` | `connector_text` thinking display on first-party |

Plus **user-supplied** betas via `ANTHROPIC_BETAS` (comma-separated, trimmed, `cli.pretty.js:306546`) and
SDK-supplied `Gp()` betas (`ZSt`, `cli.pretty.js:306565`). Unknown strings are wrapped by `Jc` into
`{name: s, header: s}` so they pass through verbatim.

Two filter sets matter:

- `Zc = {interleaved_thinking, long_context, tool-search-tool}` (`cli.pretty.js:303380`) — these are **stripped
  from the header on Bedrock** and re-injected into `body.anthropic_beta` instead (`BV`/`otr`,
  `cli.pretty.js:306552`).
- `Yw` (`cli.pretty.js:306589`) — the 11 betas allowed to survive on third-party providers:
  `claude_code`, `interleaved_thinking`, `long_context`, `context_management`, `structured_outputs`,
  `web_search`, `effort`, `tool_search`, `afk_mode`, `fallback_credit`, `mid_conversation_system`.

`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` (or a `hipaa` gate) turns off the experimental class wholesale
(`OV`, `cli.pretty.js:303345`).

Beta strings that live only in the **vendored SDK** (not in Claude Code's own registry, but reachable through
it): `managed-agents-2026-04-01`, `dreaming-2026-04-21`, `agent-memory-2026-07-22`,
`user-profiles-2026-03-24`, `message-batches-2024-09-24`, `token-counting-2024-11-01`,
`oidc-federation-2026-04-01` (`cli.pretty.js:237466`–`239193`, `235891`).

### 1.7 Model registry and aliases

The catalog is one hand-maintained object literal, `eqt` (`cli.pretty.js:876976`), 14,649 chars, self-described
as *"Hand-maintained baked-in model catalog — the source of truth for per-model provider IDs and metadata."*

**Pricing tiers** (USD per Mtok: input / output / cache-write-5m / cache-write-1h / cache-read / web-search-per-req):

| tier | in | out | cw5m | cw1h | cr | ws |
|---|---|---|---|---|---|---|
| `tier_2_10` | 2 | 10 | 2.5 | 4 | 0.2 | 0.01 |
| `tier_3_15` | 3 | 15 | 3.75 | 6 | 0.3 | 0.01 |
| `tier_5_25` | 5 | 25 | 6.25 | 10 | 0.5 | 0.01 |
| `tier_10_50` | 10 | 50 | 12.5 | 20 | 1 | 0.01 |
| `tier_15_75` | 15 | 75 | 18.75 | 30 | 1.5 | 0.01 |
| `haiku_35` | 0.8 | 4 | 1 | 1.6 | 0.08 | 0.01 |
| `haiku_45` | 1 | 5 | 1.25 | 2 | 0.1 | 0.01 |

**Models** (17). `ctx` = context window; `1m` = native 1M; `β1m` = supports the `context-1m` beta;
`[1m]` = accepts the suffix.

| catalog id | first-party id | ctx | max_out (def/upper) | pricing | capabilities | default effort |
|---|---|---|---|---|---|---|
| `claude-3-5-haiku` | `claude-3-5-haiku-20241022` | 200k (implicit) | 8192/8192 | haiku_35 | — | — |
| `claude-haiku-4-5` | `claude-haiku-4-5-20251001` | 200k, `[1m]` | 32000/64000 | haiku_45 | context_management | — |
| `claude-3-5-sonnet` | `claude-3-5-sonnet-20241022` | 200k (implicit) | 8192/8192 | tier_3_15 | — | — |
| `claude-3-7-sonnet` | `claude-3-7-sonnet-20250219` | 200k (implicit) | 32000/64000 | tier_3_15 | — | — |
| `claude-sonnet-4-0` | `claude-sonnet-4-20250514` | 200k, β1m, `[1m]` | 32000/64000 | tier_3_15 | context_management | — |
| `claude-sonnet-4-5` | `claude-sonnet-4-5-20250929` | 200k, β1m, `[1m]` | 32000/64000 | tier_3_15 | context_management | — |
| `claude-sonnet-4-6` | `claude-sonnet-4-6` | 200k, β1m, `[1m]` | 32000/128000 | tier_3_15 | effort, max_effort, adaptive_thinking, context_management | — |
| `claude-sonnet-5` | `claude-sonnet-5` | **1M native** (bedrock/vertex/foundry too) | 64000/128000 | tier_2_10 | effort, max_effort, xhigh_effort, adaptive_thinking, mid_conv_system, context_management | high |
| `claude-opus-4-0` | `claude-opus-4-20250514` | 200k, `[1m]` | 32000/32000 | tier_15_75 | context_management | — |
| `claude-opus-4-1` | `claude-opus-4-1-20250805` | 200k, `[1m]` | 32000/32000 | tier_15_75 | context_management | — |
| `claude-opus-4-5` | `claude-opus-4-5-20251101` | 200k, `[1m]` | 32000/64000 | tier_5_25 | context_management | — |
| `claude-opus-4-6` | `claude-opus-4-6` | 200k, β1m, `[1m]` | 64000/128000 | tier_5_25 | effort, max_effort, adaptive_thinking, context_management | — |
| `claude-opus-4-7` | `claude-opus-4-7` | **1M native**, β1m, `[1m]` | 64000/128000 | tier_5_25 | + xhigh_effort | xhigh |
| `claude-opus-4-8` | `claude-opus-4-8` | **1M native**, β1m, `[1m]` | 64000/128000 | tier_5_25 | + mid_conv_system, fast_mode, lean_prompt | high |
| `claude-opus-5` | `claude-opus-5` | **1M native**, β1m, `[1m]` | 64000/128000 | tier_5_25 | + thinking_disabled_effort_cap, refusal_fallback, opus_5_prompt_bundle | high |
| `claude-fable-5` | `claude-fable-5` | **1M native**, β1m | 64000/128000 | tier_10_50 | effort…, rejects_disabled_thinking, mid_conv_system, lean_prompt, fable_5_mitigations, refusal_fallback | high |
| `claude-mythos-5` | `claude-mythos-5` | **1M native**, β1m | 64000/128000 | tier_10_50 | — (first-party only; all 3P ids `null`) | — |

**Provider id mapping** — the pattern is stable: Bedrock prefixes `us.anthropic.`, Vertex uses `@YYYYMMDD`
for dated models and the bare id for 4.6+, Mantle uses `anthropic.<id>`. Examples:
`claude-opus-4-5` → bedrock `us.anthropic.claude-opus-4-5-20251101-v1:0`, vertex `claude-opus-4-5@20251101`;
`claude-opus-4-6` → bedrock `us.anthropic.claude-opus-4-6-v1`; `claude-opus-5` → bedrock
`us.anthropic.claude-opus-5`, mantle `anthropic.claude-opus-5`. `claude-mythos-5` has **no** third-party ids.
`claude-3-5-*`, `3-7-sonnet`, `sonnet-4-0`, `opus-4-0/4-1` have `anthropic_google_cloud: null` and
`mantle: null`.

**Aliases** (`cli.pretty.js:876976`, `aliases:`), with per-provider overrides:

| alias | default | bedrock | vertex | foundry | mantle | anthropic_aws | gateway |
|---|---|---|---|---|---|---|---|
| `opus` | `claude-opus-5` | `claude-opus-5` | `claude-opus-5` | `claude-opus-4-6` | `claude-opus-5` | `claude-opus-5` | `claude-opus-4-7` |
| `sonnet` | `claude-sonnet-5` | `claude-sonnet-4-5` | `claude-sonnet-4-5` | `claude-sonnet-4-5` | `claude-sonnet-4-5` | `claude-sonnet-4-6` | `claude-sonnet-4-6` |
| `haiku` | `claude-haiku-4-5` | — | — | — | — | — | — |
| `fable` | `claude-fable-5` | — | — | — | — | — | — |

`best: "fable"`; `latest_per_family: {fable: claude-fable-5, opus: claude-opus-5, sonnet: claude-sonnet-5,
haiku: claude-haiku-4-5}`; `defaults: {}`, `alias_migration: {}`.

Accepted alias tokens (`pN`, `cli.pretty.js:876960`): `sonnet`, `opus`, `haiku`, `fable`, `best`,
`sonnet[1m]`, `opus[1m]`, `fable[1m]`, `opusplan`. `MT()` restricts "tier" aliases to the first four.

**`opusplan`** — a mode, not a model: it means *Opus while in plan mode, Sonnet otherwise*
(`cli.pretty.js:738294`, description literal `"Use Opus in plan mode, Sonnet otherwise"`). Resolution at
`cli.pretty.js:305205`: `mode === "opus"` picks `bl()` (opus, upgraded to `[1m]` if `opusplan[1m]`), else
`uf()` (sonnet). Org model restrictions can clamp the plan-mode upgrade with a
`"Plan mode: the opusplan upgrade model is not permitted…"` notice (`cli.pretty.js:305224`).

**Context-window resolution** — `jw(model, betas)` (`cli.pretty.js:306203`):
1. `[1m]` suffix (and not `CLAUDE_CODE_DISABLE_1M_CONTEXT`) → `1_000_000`
2. betas include `context-1m-2025-08-07` **and** `wC(model)` → `1_000_000`
3. native-1M model on a provider that supports it (`A_`) → `1_000_000`
4. sonnet-4-6 with a `kelp_forest_sonnet` remote override in `(200000, 1_000_000]` → that value
5. `CLAUDE_CODE_MAX_CONTEXT_TOKENS` for non-`claude-*` (custom) models
6. otherwise `200_000` (`q8e`)

`A_(model)` (`cli.pretty.js:306146`) gates native-1M per provider: first-party-with-first-party-URL, the two
`MH()` providers (`anthropicAws`, `anthropicGoogleCloud`) and `mantle` get it unconditionally; bedrock/vertex/
foundry require the model's `context.native_1m_3p[provider] === true`; `gateway` requires all three.
A live diagnostic warns that Vertex rejects the `context-1m` beta for Sonnet 4.5/4 with a 400
(`cli.pretty.js:876872`).

`XI(model)` (`cli.pretty.js:305959`) is alias→provider-id resolution, and it honors
`policySettings.availableModels` (an allowlist) and `policySettings.modelOverrides`.

### 1.8 Model env vars

| env var | effect |
|---|---|
| `ANTHROPIC_MODEL` | main-loop model (`p3t`, `cli.pretty.js:304986`); lower priority than a CLI/session pin, higher than settings `model` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_` / `_HAIKU_` / `_FABLE_` | rebind the tier alias (`U2e`, `cli.pretty.js:703097`) |
| `ANTHROPIC_SMALL_FAST_MODEL` | highest-priority haiku-tier binding; also `_AWS_REGION` sibling |
| `ANTHROPIC_DEFAULT_*_MODEL_NAME` / `_DESCRIPTION` | picker labels |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` (+ `_NAME`, `_DESCRIPTION`) | injects a custom picker entry |
| `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_AUTO_MODE_MODEL`, `CLAUDE_CODE_BG_CLASSIFIER_MODEL`, `CLAUDE_CONTEXT_COLLAPSE_MODEL` | scoped model pins (`cli.pretty.js:210626`) |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | output/context clamps |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` | kills every 1M path |
| `DISABLE_PROMPT_CACHING`, `_HAIKU`, `_SONNET`, `_OPUS`, `_FABLE`, `_MYTHOS` | per-tier cache disable (`wGe`, `cli.pretty.js:497820`) |

The small/fast model resolver is `mm()` (`cli.pretty.js:304929`): `ANTHROPIC_SMALL_FAST_MODEL` wins; else if
no haiku binding exists at all and the provider is bedrock/vertex with no explicit model pin and no opus
override, it falls back to **sonnet** rather than haiku (a deliberate 3P availability hedge); else the
haiku-tier default `claude-haiku-4-5`.

### 1.9 Secondary ("small model") call sites

Two helpers, both one-shot, thinking mechanically disabled, no tools (`cli.pretty.js:499579`):

- `ZA({systemPrompt, userPrompt, outputFormat, signal, options})` — forces `model: mm()` (the small/fast model).
- `aX(...)` — identical but uses the caller-supplied model (main-loop or explicit).

Enumerated `querySource` values (35 distinct, `grep 'querySource: "…"'`); the ones that go through `ZA`
(i.e. actually route to haiku) plus their prompt intent:

| querySource | site | prompt gist |
|---|---|---|
| `generate_session_title` | `cli.pretty.js:93589` | ~1,900-char system prompt: name a session as a 2–5-word noun phrase, lead with the most specific identifier, drop request verbs; JSON schema `{title}` |
| `tool_use_summary_generation` | `cli.pretty.js:483820` | label a batch of completed tool calls in ≤ a few words ("Searched in auth/", "Fixed NPE in UserService") |
| `mcp_datetime_parse` | `cli.pretty.js:151698` | parse a natural-language datetime for an MCP call |
| `teleport_generate_title` | `cli.pretty.js:456762` | JSON schema `{title, branch}` for a cloud session |
| `web_fetch_apply` | `cli.pretty.js:464378` | apply the user's instruction to fetched page text |
| `feedback` (GitHub issue title) | `cli.pretty.js:592266` | "Generate a concise, technical issue title (max 80 chars) … prefix `[Bug]`/`[Feature Request]`" |
| `rename_generate_name` | `cli.pretty.js:763327` | summarize a conversation into a name; JSON schema `{name}` |
| `plugin_eval_mock` | `cli.pretty.js:771156` | mock a tool response in plugin-eval (falls back to `aX` when a model is pinned) |
| `plugin_eval_judge` | `cli.pretty.js:776622` | LLM-judge verdict (same fallback) |

Sources that deliberately use the **main** model (`aX`, or a direct `Iv` call): `insights` (three sites,
`cli.pretty.js:386983/387125/387321`), `compact`, `auto_mode*`, `side_question`, `hook_prompt`, `hook_agent`,
`agent_*`, `artifact_comment_*`, `narration`, `away_summary`, `extract_memories`, `prompt_suggestion`,
`agent_summary`, `sdk`, `repl_sampling`, `web_search_tool`. `permission_explainer`
(`cli.pretty.js:165315`) and `agent_namer` (`cli.pretty.js:781711`) call `Iv` directly with an explicit model.
`model_validation` (`cli.pretty.js:253644`) is a 1-token `"Hi"` probe with `maxRetries: 0`.

`jde()` / `Xl()` (`cli.pretty.js:303395`) classify each source as `main` / `subagent` / `auxiliary`, which in
turn drives cache-TTL selection, per-turn-effort eligibility, and low-priority 529 waiting.

---

## 2. Auth

### 2.1 Resolution order

`Nl()` (auth-token source, `cli.pretty.js:313665`) and `qg()` (API-key source, `cli.pretty.js:313782`):

**Auth token (Bearer):** `ANTHROPIC_AUTH_TOKEN` → `CLAUDE_CODE_OAUTH_TOKEN` →
`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` / `CCR_OAUTH_TOKEN_FILE` → `apiKeyHelper` → WIF profile →
stored claude.ai login (only if scopes include `user:inference`) → none.

**API key (`x-api-key`):** `ANTHROPIC_API_KEY` (only once approved — the key's SHA is recorded in
`customApiKeyResponses.approved`) → the `/login`-managed key from the keychain → `apiKeyHelper` → none.

`Tl()` (`cli.pretty.js:313645`) decides whether OAuth is the active credential; it returns false when a
console API key or `apiKeyHelper` is in play, or the provider is third-party.

`vo` (`cli.pretty.js:304175`) is the human-readable source table used in error messages:
`ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, `CCR_OAUTH_TOKEN_FILE`, `claude.ai`, `ANTHROPIC_CUSTOM_HEADERS`,
`CLAUDE_AGENT_SDK_CLIENT_APP`, `CLAUDE_CODE_CONTAINER_ID`, `CLAUDE_CODE_REMOTE_SESSION_ID`,
`User-Agent environment`.

### 2.2 OAuth (claude.ai / Console) — the `/login` and `setup-token` flow

**Scopes** (`cli.pretty.js:744030`):

```
M_  = "user:inference"
KN  = "user:profile"
s   = "org:create_api_key"
x5  = [user:profile, user:inference, user:sessions:claude_code, user:mcp_servers, user:file_upload]
rkn = dedupe([org:create_api_key, user:profile] ++ x5)   // the default authorize scope set
wJ  = [user:design:read, user:design:write]              // /design-login
Pwr = [user:projects:read, user:projects:write, user:plugins]
```

`--inference-only` (or an inference-only token mint) requests just `["user:inference"]`.

**Authorize URL** (`r4t`, `cli.pretty.js:312933`) — `CLAUDE_AI_AUTHORIZE_URL` when logging in with claude.ai,
else `CONSOLE_AUTHORIZE_URL`:

```
?code=true
&client_id=<CLIENT_ID or oauthClient.clientId>
&response_type=code
&redirect_uri=http://localhost:<port>/callback     (or MANUAL_REDIRECT_URL in manual mode)
&scope=<space-joined>
&code_challenge=<S256(verifier)>
&code_challenge_method=S256
&state=<random>
[&orgUUID=…][&login_hint=…][&login_method=…]
```

**Redirect port is dynamic**, not fixed — it is an ephemeral loopback listener, passed in as `port`
(`cli.pretty.js:312936`); the "manual" path instead uses `https://platform.claude.com/oauth/code/callback`
and the user pastes the code back.

**Token exchange** (`Ubn`, `cli.pretty.js:312944`): `POST <TOKEN_URL>` JSON
`{grant_type: "authorization_code", code, redirect_uri, client_id, code_verifier, state[, expires_in]}`,
30 s timeout. `401` → `"Authentication failed: Invalid authorization code"`. Emits
`tengu_oauth_token_exchange_success`.

**Refresh** (`C$`, `cli.pretty.js:312957`): `POST <TOKEN_URL>` JSON
`{grant_type: "refresh_token", refresh_token, client_id, scope: <x5 or supplied>}`, 30 s.
Returns `{accessToken, refreshToken (rotated, defaults to the old one), expiresAt = now + expires_in*1000,
refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier, profile, tokenAccount}`. Refresh-token
expiry defaults to **30 days** (`Iee = 2592000000`) when the server doesn't say. A token is treated as
expiring **5 minutes early** (`oN`, `cli.pretty.js:313035`). Cross-process contention surfaces as
`OAuthRefreshLockTimeoutError` (`cli.pretty.js:846241`); a dead refresh token raises `OAuthRefreshDeadError`
("run /login to re-authenticate"). Events: `tengu_oauth_token_refresh_success` / `_failure`.

**Revoke** on logout (`rS`, `cli.pretty.js:313013`): `POST <TOKEN_URL>/revoke`
`{token, token_type_hint: "refresh_token", client_id}`, 5 s, failures are non-fatal.

**Roles** (`cli.pretty.js:313019`): `GET <ROLES_URL>` → `{organization_role, workspace_role,
organization_name}` stored on `oauthAccount`; emits `tengu_oauth_roles_stored`.

**Console API-key mint** (`cli.pretty.js:313026`): `POST <API_KEY_URL>` → `{raw_key}` stored via the keychain
path; emits `tengu_oauth_api_key`.

**Profile / account info:**
- `GET /api/oauth/profile` with `Authorization: Bearer` (`ope`, `cli.pretty.js:312895`), 10 s.
- `GET /api/claude_cli_profile?account_uuid=…` with `x-api-key` + `anthropic-beta: oauth-2025-04-20`
  (`Ztr`, `cli.pretty.js:312883`) — the API-key equivalent.
- `POST /api/oauth/validate` (`ipe`, `cli.pretty.js:312907`).

Subscription mapping (`Nee`, `cli.pretty.js:313027`): `claude_max→max`, `claude_pro→pro`,
`claude_enterprise→enterprise`, `claude_team→team`. Also read: `rate_limit_tier`, `seat_tier`,
`has_extra_usage_enabled`, `billing_type`, `cc_onboarding_flags`, `claude_code_trial_ends_at`,
`claude_code_trial_duration_days`. Profile is re-fetched at most once per **24 h** (`Dee = 86400000`).

### 2.3 Credential storage

**macOS Keychain** (`cli.pretty.js:267080`–`267170`), via `security(1)`:

- service name = `a0("-credentials")` (`cli.pretty.js:650780`):
  `` `Claude Code${OAUTH_FILE_SUFFIX}-credentials${configDirHash}` ``
  where `OAUTH_FILE_SUFFIX` is `""` (prod), `-local-oauth`, `-staging-oauth`, or `-custom-oauth`, and
  `configDirHash` is `-<sha256(configDir).slice(0,8)>` **only when `CLAUDE_CONFIG_DIR` is set**. So the
  default is exactly **`Claude Code-credentials`**.
- account = `$USER` (or `os.userInfo().username`), sanitized to `[A-Za-z0-9._-]+`, else `claude-code-user`
  (`xC`, `cli.pretty.js:650785`).
- write: `security add-generic-password -U -a <acct> -s <svc> -X <hex>` fed on **stdin** (`-i`) when the
  command line would be ≤ 4032 bytes, else via argv with a warning. 2 s timeout.
- read: `security find-generic-password -a <acct> -w -s <svc>`; exit codes 44 and 36 are treated as "absent",
  everything else as a transient failure that serves the stale cache. In-memory cache TTL 30 s
  (`Aqt`, `cli.pretty.js:650798`), failure-backoff 1 s.
- `security show-keychain-info` exit 36 is probed to detect a locked keychain (`cli.pretty.js:267172`).

**Plaintext fallback**: `<configDir>/.credentials.json`, `mkdir` + `writeFile` + `chmod` **0600** (decimal
384), with the warning literal `"Warning: Storing credentials in plaintext."` (`cli.pretty.js:267180`).
Config dir is `CLAUDE_SECURESTORAGE_CONFIG_DIR` → `CLAUDE_CONFIG_DIR` → `~/.claude`
(`$T`, `cli.pretty.js:650774`). The composite store (`I`, `cli.pretty.js:267035`) writes keychain-first and
falls back to plaintext only on a **non-transient** keychain failure, emitting
`tengu_feature_sad{secure_storage_credentials_write, plaintext_fallback_used}`.

### 2.4 API key + apiKeyHelper

- `apiKeyHelper` is a **settings** key (not env): a shell command whose stdout is the credential.
  It is refused when it comes from project/local settings without trust, and it is ignored entirely in
  `--bare` mode except via `flagSettings` (`oS`, `cli.pretty.js:313826`).
- TTL: `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`, default **300000 ms** (`nte`, `cli.pretty.js:313470`);
  clock skew allowance 30000 ms (`mI`); helper output capped at 16384 bytes (`rte`).
- If the helper's output parses as a JWT-ish value with an `exp`, that expiry wins over the TTL
  (`lte`, `cli.pretty.js:313880`).
- The helper's value is installed as `Authorization: Bearer <v>` (`ur`, `cli.pretty.js:846766`) — it is an
  auth **token**, not `x-api-key`, unless resolved through `qg()`.
- Related knobs: `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`, `CLAUDE_CODE_HOST_CREDS_FILE`,
  `CLAUDE_CODE_HOST_AUTH_ENV_VAR`, `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`.
- Key-shape telemetry classifies keys as `sk_ant_api03` / `api02` / `admin` / `other` / `non_sk_ant`
  (`Vbn`, `cli.pretty.js:313746`).
- `proxyAuthHelper` is the sibling for `Proxy-Authorization` (`cli.pretty.js:111638` settings schema;
  `CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER`, `CLAUDE_CODE_PROXY_AUTH_HELPER_TTL_MS`).

### 2.5 Bedrock

`CLAUDE_CODE_USE_BEDROCK=1`. Client branch at `cli.pretty.js:846503`.

- Region: `AWS_REGION` → `AWS_DEFAULT_REGION` → the AWS shared-config `region` → **`us-east-1`**
  (`TAe`/`DT`, `cli.pretty.js:72890`). A per-model override exists for the small/fast model:
  `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION` (`ye`, `cli.pretty.js:846616`).
- `CLAUDE_CODE_SKIP_BEDROCK_AUTH` → passes `skipAuth: true` to `AnthropicBedrock` and leaves any
  user-supplied `Authorization`/`x-api-key` header in place.
- `AWS_BEARER_TOKEN_BEDROCK` (trimmed) becomes `Authorization: Bearer …` and `apiKey`.
- Otherwise: `awsCredentialExport` settings helper → a cached provider chain `oR(region)` unless
  `CLAUDE_CODE_SKIP_AWS_CRED_CACHE`. `awsAuthRefresh` is the settings hook for `aws sso login`-style refresh.
- `ANTHROPIC_BEDROCK_SERVICE_TIER` → `X-Amzn-Bedrock-Service-Tier`.
- Streaming guard: a non-`application/vnd.amazon.eventstream` content type on the streaming path raises
  `BedrockUnexpectedContentTypeError` with an explicit "a gateway or proxy is transforming the response body"
  message; suppressed by `CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_GUARD`
  (`cli.pretty.js:846737`).
- `ANTHROPIC_BEDROCK_REGION_PREFIX` exists in the env registry (region-prefix override for model ids).
- **Mantle** (`CLAUDE_CODE_USE_MANTLE`) is a Bedrock sibling; when both Bedrock and Mantle are set, `za(model)`
  routes per-model — a model whose bedrock id is `null` but whose mantle id is not goes to Mantle
  (`cli.pretty.js:877183`). `/status` renders it as `"Amazon Bedrock + Amazon Bedrock (Mantle)"`.

### 2.6 Vertex

`CLAUDE_CODE_USE_VERTEX=1`. Client branch at `cli.pretty.js:846540`.

- Project: `GCLOUD_PROJECT` → `GOOGLE_CLOUD_PROJECT` → `gcloud_project` → `google_cloud_project`, else
  `ANTHROPIC_VERTEX_PROJECT_ID` is passed to `buildVertexGoogleAuth`.
- Default region: `CLOUD_ML_REGION`, else **`us-east5`** (`C5t`, `cli.pretty.js:110547`).
- **Per-model region overrides** (`J5`, `cli.pretty.js:110577`; table at `cli.pretty.js:110464`), matched by
  model-id prefix:

  | prefix | env var |
  |---|---|
  | `claude-3-5-sonnet` | `VERTEX_REGION_CLAUDE_3_5_SONNET` |
  | `claude-3-7-sonnet` | `VERTEX_REGION_CLAUDE_3_7_SONNET` |
  | `claude-sonnet-4-5` | `VERTEX_REGION_CLAUDE_4_5_SONNET` |
  | `claude-sonnet-4-6` | `VERTEX_REGION_CLAUDE_4_6_SONNET` |
  | `claude-3-5-haiku` | `VERTEX_REGION_CLAUDE_3_5_HAIKU` |
  | `claude-haiku-4-5` | `VERTEX_REGION_CLAUDE_HAIKU_4_5` |
  | `claude-opus-4-1` | `VERTEX_REGION_CLAUDE_4_1_OPUS` |
  | `claude-opus-4-5` | `VERTEX_REGION_CLAUDE_4_5_OPUS` |
  | `claude-opus-4-6` | `VERTEX_REGION_CLAUDE_4_6_OPUS` |
  | `claude-opus-4-7` | `VERTEX_REGION_CLAUDE_4_7_OPUS` |
  | `claude-opus-4-8` | `VERTEX_REGION_CLAUDE_4_8_OPUS` |
  | `claude-sonnet-4` | `VERTEX_REGION_CLAUDE_4_0_SONNET` |
  | `claude-sonnet-5` | `VERTEX_REGION_CLAUDE_5_SONNET` |
  | `claude-fable-5` | `VERTEX_REGION_CLAUDE_FABLE_5` |
  | `claude-opus-4` | `VERTEX_REGION_CLAUDE_4_0_OPUS` |
  | `claude-opus-5` | `VERTEX_REGION_CLAUDE_5_OPUS` |

  (Prefix matching is `startsWith` over this ordered list, so `claude-sonnet-4-5` must precede
  `claude-sonnet-4`.)
- `CLAUDE_CODE_SKIP_VERTEX_AUTH` skips ADC and lets a user-supplied `Authorization` through.
- `gcpAuthRefresh` is the settings hook for re-running `gcloud auth`.

### 2.7 Foundry, Claude-Platform-on-AWS, Claude-Platform-on-Google-Cloud, Gateway

| provider | env | auth | skip flag |
|---|---|---|---|
| `foundry` | `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_AUTH_TOKEN` | `DefaultAzureCredential` + `getBearerTokenProvider(…, "https://cognitiveservices.azure.com/.default")` | `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` (`cli.pretty.js:846519`) |
| `anthropicAws` | `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `ANTHROPIC_AWS_WORKSPACE_ID`, `ANTHROPIC_AWS_API_KEY` | AWS credential chain | `CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH` (`cli.pretty.js:846527`) |
| `anthropicGoogleCloud` | `CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD`, `ANTHROPIC_GOOGLE_CLOUD_PROJECT`, `_LOCATION` (default `global`), `_WORKSPACE_ID` | ADC | `CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH` (`cli.pretty.js:846535`) |
| `mantle` | `CLAUDE_CODE_USE_MANTLE` | as Bedrock | `CLAUDE_CODE_SKIP_MANTLE_AUTH` |
| `gateway` | `CLAUDE_CODE_USE_GATEWAY` + a `/login`-established enterprise-gateway session | `Authorization: Bearer <gateway JWT>`, TLS fingerprint pinned per host | — |

`anthropicGoogleCloud` interpolates project/location/workspace **into the URL path**, so those env vars are
charset-gated to `[A-Za-z0-9_-]+` and rejected otherwise with an explicit "URL metacharacters would rewrite
the project/workspace" error (`le`, `cli.pretty.js:846296`).

Gateway sessions are restored at startup with a TLS-fingerprint re-verify; a mismatch prints
`"Cloud gateway <host> TLS certificate changed since you connected — run /login to verify and reconnect."`
(`cli.pretty.js:313625`).

### 2.8 Workload Identity Federation (WIF) / Anthropic profiles

A path the February tables don't cover at all. `ANTHROPIC_FEDERATION_RULE_ID` + `ANTHROPIC_ORGANIZATION_ID`
(+ optional `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_WORKSPACE_ID`, `ANTHROPIC_PROFILE`,
`ANTHROPIC_CONFIG_DIR`) drive an OIDC-federation token exchange in the vendored SDK
(`anthropic-beta: oauth-2025-04-20,oidc-federation-2026-04-01`, `cli.pretty.js:236588`), or a profile file
under `~/.config/anthropic`. `jd()` (`cli.pretty.js:313588`) decides whether the profile path is active; a
stored claude.ai login takes precedence over an *implicit* profile, with the warning
`"An Anthropic profile (~/.config/anthropic) is configured, but a claude.ai login exists — using the
claude.ai login. Set ANTHROPIC_PROFILE=<name> to use the profile instead."` (`cli.pretty.js:313567`).
`IV()`/`rO()` (`cli.pretty.js:315710`) is the shared "auth headers for ancillary Anthropic calls" resolver
and returns `{headers: {}, error, reasonCode}` with reason codes `third_party`, `no_oauth_token`, `gateway`,
`no_api_key`, `wif_error`.

### 2.9 What `/status` shows

`tnt()` (`cli.pretty.js:272329`) — the auth panel: `Login` (Expired), `Login method: <max|pro|team|
enterprise> account`, `Auth token: <source>`, `API key: <source>`, `Profile`, `Organization`, `Email`.
`nnt()` (`cli.pretty.js:272355`) — the transport panel: `API provider` (display names
`Amazon Bedrock`, `Google Vertex AI`, `Microsoft Foundry`, `Claude Platform on AWS`,
`Claude Platform on Google Cloud`, `Amazon Bedrock (Mantle)`, `Cloud gateway`; `cli.pretty.js:877169`),
base URL, region/project/workspace, `"<X> auth skipped"` lines for each skip flag, `Proxy`,
`Additional CA cert(s)`, `mTLS client cert` / `client key`.

The AWS region line is annotated with its provenance: `"<r> (from AWS config)"`, or
`"<r> (default — region env var invalid, ignored; fix or unset AWS_REGION / AWS_DEFAULT_REGION)"`, or
`"<r> (default — set AWS_REGION or add a region to your AWS config)"` (`cli.pretty.js:272445`).

### 2.10 Rate limits, 5h/7d windows, extra usage

`Zp` (`cli.pretty.js:299246`) is the unified rate-limit state machine, fed from response headers. Complete
header set (`grep anthropic-ratelimit-unified-`):

```
-status                         -reset                          -representative-claim
-5h-utilization                 -5h-reset                       -5h-surpassed-threshold
-7d-utilization                 -7d-reset                       -7d-surpassed-threshold
-grace-status                   -grace-5h-utilization           -grace-7d-utilization
-overage-status                 -overage-reset                  -overage-utilization
-overage-in-use                 -overage-period                 -overage-disabled-reason
-overage-surpassed-threshold    -overage-period-channel-utilization
-overage-period-monthly-utilization
-slow-status                    -slow-offer                     -slow-retry-after
-slow-budget-utilization        -slow-budget-reset              -slow-max-wait
-fallback                       -upgrade-paths
```

Claim types (`cli.pretty.js:299283`): `five_hour` (reset synthesized at **+18000 s = 5 h**), `seven_day`,
`seven_day_opus`, `seven_day_sonnet` (**+604800 s = 7 d**); anything else defaults to +3600 s. Additional
claim kinds appear in the `/usage` schema (`cli.pretty.js:329330`): `seven_day_oauth_apps`, `cinder_cove`,
`extra_usage`, `limits`. Display names (`Fw`, `cli.pretty.js:436223`): `five_hour → "session limit"`,
`seven_day → "weekly limit"`, `seven_day_opus → "Opus limit"`, `seven_day_sonnet → "Sonnet limit"`,
`seven_day_overage_included → "Fable 5 limit"`, `overage → "usage credit limit"`.

`retry-after` is **derived**: it is set only when `status === "rejected"` and overage is absent or also
rejected, as `max(0, resetsAt − now)` (`updateRetryAfter`, `cli.pretty.js:299293`). Early warnings default
their reset horizon to 4 h (5h window) or 120 h (7d window) when the server omits it.

Extra usage / purchase surfaces: `hasExtraUsageEnabled` on the profile; `/usage-credits` (formerly
`/extra-usage`, `cli.pretty.js:504319`); links `https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans`
and `https://claude.ai/settings/usage?from=cc_cli_limit_message` (`cli.pretty.js:329366`).
A `/low-priority` lane ("Continue now at lower priority · uses your weekly limit") lets a session keep
working past the 5-hour wall against the weekly budget (`cli.pretty.js:845436`, `749162`). There is also a
once-a-week `"Reset your session limit now and keep working; once a week, still counts toward your weekly
limit"` command (`cli.pretty.js:504349`).

---

## 3. Streaming and resilience

### 3.1 Timeouts

| constant | value | source |
|---|---|---|
| whole-request timeout | `API_TIMEOUT_MS`, default **600000 ms** | `cli.pretty.js:846500` |
| stream idle (first-party) | `lr = 180000 ms` | `cli.pretty.js:846678` |
| stream idle (other providers) | `max(CLAUDE_STREAM_IDLE_TIMEOUT_MS, 300000)` | `Qdn`, `cli.pretty.js:846675` |
| byte-stream idle | `CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS`, else the gate `tengu_byte_stream_idle_timeout_ms`, clamped to `[10000, 1800000]` | `cr`, `cli.pretty.js:846681` |
| first-byte window | `CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS` clamped to `[10000, 1800000]`; else the idle timeout, or `API_TIMEOUT_MS − 1000` when that is larger | `pr`, `cli.pretty.js:846694` |
| first-byte body-size allowance | `+1000 ms` per 32 KiB of request body | `yr`, `cli.pretty.js:846720` |
| stall-log ladder | 15 s, 30 s, 60 s, 120 s | `Rr`, `cli.pretty.js:846786` |
| oauth-refresh pre-init (GrowthBook) | `Xt(refresh, Xx, "timeout")` then a 5 s `init` | `cli.pretty.js:302010` |

The first-byte watchdog distinguishes a genuine stall from a laptop sleep: it samples every 1 s, and if more
than half the window was "slept" (gaps > 5 s) it throws `StreamSuspendedError`
("Stream watchdog detected system suspend; aborting to retry on a fresh connection") instead of
`StreamNoResponseError` (`cli.pretty.js:846728`). Telemetry: `tengu_api_no_response_timeout`.

### 3.2 Retry policy — two layers

**Layer 1, vendored SDK** (`cli.pretty.js:240214`):
retry when `x-should-retry: true`, or status ∈ {408, 409, 429, ≥500}; never when `x-should-retry: false`.
Delay = `retry-after-ms` → `retry-after` (seconds, or an HTTP-date) → default
`min(0.5·2^(maxRetries−remaining), 8) · (1 − 0.25·rand())` seconds (`cli.pretty.js:240258`). A 401 with a
token cache triggers exactly one cache-invalidate-and-retry.

**Layer 2, Claude Code's own loop** (`cli.pretty.js:446160`):

```js
kV(attempt, retryAfterHeader, cap = 32000):        // cli.pretty.js:227981
  base   = min(500 * 2^(attempt-1), cap)
  jitter = round(base + rand()*0.25*base)
  return retryAfterHeader ? max(retryAfter*1000, jitter) : jitter
```

Constants (`cli.pretty.js:445922`, `446405`):

| name | value | meaning |
|---|---|---|
| `cin` | 10 | default max retries |
| `uin` | 300 | max retries under `CLAUDE_CODE_RETRY_WATCHDOG` |
| `X_e` | 15 | clamp for `CLAUDE_CODE_MAX_RETRIES` (unless watchdog) |
| `bQ` | 3 | max mid-stream 529 retries before falling back |
| `Vun` | 300000 | backoff cap for persistent 429s |
| `uJe` | 21600000 | 6 h absolute cap on a single persistent-429 wait |
| `Kun` | 60000 | a `Retry-After` longer than this throws instead of waiting (unless watchdog) |
| `Yun` | 30000 | wait is sliced into 30 s chunks so abort/UI stay responsive |
| `X7e` | 3000 | floor for the `max_tokens` context-overflow re-fit |
| `pin` | 1000 | delay for remote 401/403 |

`CLAUDE_CODE_MAX_RETRIES` over 15 is clamped with a one-shot warning. Events: `tengu_api_retry`,
`tengu_api_retry_after_too_long`, `tengu_api_persistent_retry_wait`, `tengu_api_error`, `tengu_api_success`,
`tengu_api_retries_exhausted` (also an OTEL log event).

**Retryable-network classification** (`cli.pretty.js:445950`): the stale-connection set `sH` plus
`EPROTO`, `FailedToOpenSocket`, `ERR_OSSL_*`, `ERR_SSL_*`. On an `ECONNRESET`-class error with
`CLAUDE_CODE_CLIENT_CERT` set, the mTLS material is re-read and the global agents rebuilt before retrying
(`Jun`, `cli.pretty.js:445956`) — a mid-rotation-certificate hedge.

**Special retry classes:**
- `max_tokens` context overflow → recompute `max_tokens` from the reported input tokens and retry
  (`tengu_max_tokens_context_overflow_adjustment`, `cli.pretty.js:446166`).
- Mid-stream **529** before any content → up to `bQ = 3` retries, or a **low-priority capacity wait** whose
  delay the server dictates (`tengu_streaming_529_retry`, `onRetryStatus({kind: "low_priority_waiting"})`).
- 401/403 on first-party with an `apiKeyHelper` → re-run the helper (`Q_e`, `cli.pretty.js:445934`).
- `anthropic-dispatch-id` header fallback: a connection error before the first event with a dispatch id set
  retries once without it (`tengu_dispatch_header_fallback`, `cli.pretty.js:499332`).

### 3.3 Streaming → non-streaming fallback

On a stream error where nothing usable was yielded, the loop **falls back to a non-streaming request**
(`cli.pretty.js:499371`), emitting `tengu_streaming_fallback_to_non_streaming` and
`tengu_nonstreaming_fallback_started` with a `fallback_cause`. Disabled by
`CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`, or by the gates `tengu_disable_streaming_to_non_streaming_fallback`
and `tengu_watchdog_skip_nonstreaming_fallback` (the latter only for watchdog aborts, and automatically when
`CLAUDE_CODE_REMOTE`).

When content **was** already yielded, the loop instead **finalizes a partial response**: it synthesizes a
`stop_reason` (`tool_use` if a tool block was emitted, else `end_turn`), appends one of four explicit notices —
"The response stopped arriving", "Server error mid-response", "Your computer went to sleep mid-response",
"Connection lost mid-response" — and emits `tengu_streaming_partial_finalized` (`cli.pretty.js:499310`).

### 3.4 Client-side fallback model

`--fallback-model` (CLI) or `fallbackModel` (settings) is parsed by `sJn` (`cli.pretty.js:233155`):
comma-separated, `"default"` expands to the current default, deduplicated, each entry validated, **capped at
3** (`Q = 3`, `cli.pretty.js:233172`). Trigger: a persistent 529/overload path throws `jf(model, fallback,
"overloaded", err)` and emits `tengu_api_opus_fallback_triggered` / `tengu_model_fallback_triggered`
(`cli.pretty.js:499363`). A separate **server-side** fallback exists via the
`server-side-fallback-2026-06-01` / `-2026-07-01` betas and a `fallbacks` body field, plus a
**refusal fallback** (`refusal_fallback` capability on Opus 5 / Fable 5) with its own dialog and telemetry
(`tengu_refusal_fallback_*`).

### 3.5 Request-body gzip

`he()` (`cli.pretty.js:846310`) decides per request: only for the first-party host (`NT`), only under Bun,
only for string bodies, only above **4096 chars** (`Kn`; 1024 for the CCR worker), never with
`ANTHROPIC_UNIX_SOCKET`, a proxy, or mTLS. Env override `CLAUDE_CODE_GZIP_REQUEST_BODIES` (and
`CLAUDE_CODE_GZIP_CCR_REQUEST_BODIES`); gates `tengu_atomic_ocean` / `tengu_gzip_request_bodies` /
`tengu_gentle_hammock`. On a 400/403/415 that does **not** look like it came from Anthropic (no `req_` request
id, no `cf-ray`), the request is re-sent uncompressed and gzip is latched off — persisted for **7 days**
(`$n = 604800000`) when the rejection looked like a middlebox. Events: `tengu_gzip_request_body_fallback`,
`tengu_gzip_request_body_latch_cleared`, `tengu_gzip_request_body_skipped`.

### 3.6 Proxy, TLS, sockets

| env | effect |
|---|---|
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `NO_PROXY` (+ lowercase) | standard proxy selection (`cli.pretty.js:294453`, `110980`) |
| `CLAUDE_CODE_PROXY_RESOLVES_HOSTS` | let the proxy do DNS |
| `CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER`, `CLAUDE_CODE_PROXY_AUTH_HELPER_TTL_MS` | `proxyAuthHelper` settings hook |
| `NODE_EXTRA_CA_CERTS` | appended to the built-in CA set; logged as a note when mTLS is also on (`cli.pretty.js:628775`) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | passthrough (in the "sensitive env" set) |
| `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `CLAUDE_CODE_CLIENT_KEY_PASSPHRASE` | mTLS; PEM files ≤ 1 MiB, must contain a PEM block; cert/key are cross-checked with `checkPrivateKey` and a **mismatched pair is ignored** as a mid-rotation read (`cli.pretty.js:628650`) |
| `ANTHROPIC_UNIX_SOCKET` | route over a unix socket (the `claude ssh` remote path); disables gzip, bootstrap, and preconnect |

A **preconnect** `HEAD <base>/api/hello` fires at init on first-party with no proxy/socket/mTLS
(`cli.pretty.js:285204`).

### 3.7 Vendored SDK identity

`@anthropic-ai/sdk` **0.112.1** (`Q`, `cli.pretty.js:236067`), sending
`X-Stainless-Lang: js`, `X-Stainless-Package-Version: 0.112.1`, `X-Stainless-OS`, `X-Stainless-Arch`,
`X-Stainless-Runtime: node`, `X-Stainless-Runtime-Version`, `X-Stainless-Retry-Count`, `X-Stainless-Timeout`
(`cli.pretty.js:236080`, `240283`). Bun 1.4.1 is the runtime (`cli.pretty.js:73804`). Also vendored:
`axios` (the ancillary HTTP client), `openid-client` 5.7.1, GrowthBook JS SDK 1.6.1, the AWS SDK v3
credential providers, `@azure/identity` (MSAL), and the OpenTelemetry JS SDK.

---

## 4. Non-Anthropic models

There is **no OpenAI-compatible gateway** in 2.1.251. Everything speaks the Anthropic Messages shape.

The closest thing is `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` (`cli.pretty.js:304449`): when set, and the
provider is first-party, and `ANTHROPIC_BASE_URL` points at a **non**-first-party host, Claude Code calls
`GET <ANTHROPIC_BASE_URL>/v1/models?limit=1000` with `anthropic-version: 2023-06-01` plus whatever credential
is available, and turns the results into extra model-picker entries labeled `"From gateway"`, cached in
`~/.claude/cache/gateway-models.json`. It filters to ids matching `/(claude|anthropic)/i` and drops ids that
collide with the baked catalog (`cli.pretty.js:141184`). So a proxy can advertise custom Claude-shaped models,
not a different vendor's API.

The separate `gateway` **provider** (`CLAUDE_CODE_USE_GATEWAY` + `/login`) is an Anthropic-blessed enterprise
relay with its own JWT and TLS-fingerprint pinning; `claude gateway` requires the native binary and refuses to
run under npm (`"claude gateway requires the native binary. Install via https://claude.ai/install.sh instead
of npm."`, `cli.pretty.js:876472`).

The `ENABLE_TOOL_SEARCH` diagnostic makes the constraint explicit:
`"[ToolSearch:optimistic] disabled: ANTHROPIC_BASE_URL=… is not a first-party Anthropic host. Set
ENABLE_TOOL_SEARCH=true (or auto / auto:N) if your proxy forwards tool_reference blocks."`
(`cli.pretty.js:34150`).

Skip-auth flags, collected: `CLAUDE_CODE_SKIP_BEDROCK_AUTH`, `CLAUDE_CODE_SKIP_VERTEX_AUTH`,
`CLAUDE_CODE_SKIP_FOUNDRY_AUTH`, `CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH`,
`CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH`, `CLAUDE_CODE_SKIP_MANTLE_AUTH`,
`CLAUDE_CODE_SKIP_AWS_CRED_CACHE`.

---

## 5. Telemetry

### 5.1 Feature flags: GrowthBook, not Statsig

**Statsig is gone.** The only remaining traces are a legacy `statsig` directory name in two cleanup lists
(`cli.pretty.js:124150`, `722608`).

2.1.251 uses **GrowthBook JS SDK 1.6.1** in `remoteEval` mode (`cli.pretty.js:302004`):

| | |
|---|---|
| `apiHost` | `https://api.anthropic.com/` |
| `clientKey` | `sdk-zAZezfDKGoZuXXKe` |
| eval endpoint (authed) | `POST <host>/api/eval-authed/<clientKey>` (`cli.pretty.js:301973`) |
| eval endpoint (fallback) | `POST <host>/api/eval/<clientKey>` |
| features endpoint (SDK default, unused in remote-eval) | `GET <host>/api/features/<clientKey>` (`cli.pretty.js:299729`) |
| streaming | `GET <host>/sub/<clientKey>` (SSE; disabled here) |
| `cacheKeyAttributes` | `["id", "organizationUUID"]` |
| init timeout | 5000 ms |
| cache defaults | `staleTTL 60 s`, `maxAge 4 h`, `maxEntries 10`, key `gbFeaturesCache` |
| disk cache | `~/.claude.json` → `cachedGrowthBookFeatures` (`cli.pretty.js:267383`, `285232`) |
| kill switch | `DISABLE_GROWTHBOOK` |

Resolution order for a flag (`getFeatureValueWithSource`, `cli.pretty.js:302036`): environment override →
config override → in-memory remote-eval payload → the `cachedGrowthBookFeatures` disk snapshot → the
caller-supplied default. Sources are labeled `override` / `payload` / `disk` / `fallback` / `disabled`.
Exposure events are queued while the client is warming and drained on first successful eval.

**Gate volume:** 379 distinct `tengu_*` flag reads (`I("tengu_…", default)`). The names are deliberately
opaque two-word codenames (`tengu_amber_lattice`, `tengu_basalt_scarp`, `tengu_copper_lantern`,
`tengu_alder_compass`, …). Domain-relevant readable ones include `tengu_byte_stream_idle_timeout_ms`,
`tengu_disable_streaming_to_non_streaming_fallback`, `tengu_watchdog_skip_nonstreaming_fallback`,
`tengu_stream_watchdog_default_on`, `tengu_prompt_cache_1h_config`, `tengu_gzip_request_bodies`,
`tengu_atomic_ocean`, `tengu_gentle_hammock`, `tengu_1p_event_batch_config`, `tengu_canary`,
`tengu_usage_overage_included_models`, `tengu_rate_limit_promo_notices`, `tengu_tool_pear`,
`tengu_windows_credman`.

A GrowthBook experiment exposure is itself logged into the 1P pipeline as body `growthbook_experiment` with
`event_type: "GrowthbookExperimentEvent"` (`cli.pretty.js:310228`).

### 5.2 First-party analytics ("tengu")

`s(eventName, metadata)` (`cli.pretty.js:701694`) enqueues into a 1000-entry ring until a sink attaches, then
forwards. The sink is `initialize1PEventLogging` (`cli.pretty.js:310242`), which builds an OTel
`LoggerProvider` named `com.anthropic.claude_code.events` over a custom batch exporter:

| | |
|---|---|
| endpoint | `https://api.anthropic.com/api/event_logging/v2/batch` (or `https://api-staging.anthropic.com` when `ANTHROPIC_BASE_URL` is staging) (`cli.pretty.js:309602`) |
| defaults | timeout 10 s, `maxBatchSize` 200, `maxAttempts` 8, backoff 500 → 30000 ms, `batchDelayMs` 100 |
| batch config | overridable by the gate `tengu_1p_event_batch_config` (`baseUrl`, `path`, `skipAuth`, `maxAttempts`, batch sizes) |
| export interval | `OTEL_LOGS_EXPORT_INTERVAL`, default 10000 ms; batch 200; queue 8192 |
| durability | failed batches are persisted to a per-session telemetry log/JSON file and retried on next start |
| payload | `{event_name, event_id, core_metadata, user_metadata, event_metadata, user_id}` (`cli.pretty.js:310192`) |

**Kill switches** (`zh()`, `cli.pretty.js:302653`): non-first-party provider, an active cloud gateway,
any of `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` / `DISABLE_TELEMETRY` / `DO_NOT_TRACK`, or
`CLAUDE_CODE_CUSTOM_OAUTH_URL` being set.

**Volume:** 2,179 distinct `"tengu_*"` string literals; 1,615 distinct names passed to `s(...)`.

**The feature-health triad** (`cli.pretty.js:820520`) is the single densest convention:

```js
y(feature)                -> s("tengu_feature_ok",  {feature_name})
p(feature, errorCode, x)  -> s("tengu_feature_bad", {feature_name, error_code, ...})
g(feature, errorCode, x)  -> s("tengu_feature_sad", {feature_name, error_code, ...})
Hr(feature, fn, mapErr)   -> await fn(), then y() or p()
```

713 distinct `y(...)` feature names and 386 distinct `p(...)` names. Network-layer examples:
`api_bootstrap_fetch`, `api_gzip_request_body`, `api_key_verify`, `api_metrics_opt_out_check`,
`api_mtls_cert_reload`, `api_request`, `api_usage_fetch`, `api_usage_fetch_at_wall`, `feedback_submit`,
`internal_metrics_export`, `oauth_create_api_key`, `oauth_fetch_roles`, `oauth_profile_fetch`,
`oauth_token_exchange`, `oauth_token_refresh`, `oauth_token_revoke`, `oauth_token_validate`,
`provider_route`, `secure_storage_credentials_write`, `update_apply`, `update_check`, `update_download`,
`native_cleanup_versions`.

Notable per-request events: `tengu_api_error`, `tengu_api_success`, `tengu_api_retry`,
`tengu_api_after_normalize`, `tengu_api_cache_breakpoints`, `tengu_api_no_response_timeout`,
`tengu_api_fallback_last_resort`, `tengu_streaming_*` (watchdog retry, stale-connection retry, 529 retry,
partial finalized, close-after-complete, fallback-to-non-streaming), `tengu_model_fallback_triggered`,
`tengu_live_model_switch`, `tengu_refusal_fallback_*`, `tengu_fallback_credit_*`,
`tengu_client_data_cache_key`, `tengu_thinking_disabled_sanitized`, `tengu_effort_clamped_thinking_disabled`,
`tengu_rotunda_pennant_replay` / `_strip`.

### 5.3 Datadog error reporting (this is where "Sentry" went)

`cli.pretty.js:312658`:

| | |
|---|---|
| endpoint | `https://http-intake.logs.us5.datadoghq.com/api/v2/logs` |
| header | `DD-API-KEY: pubea5604404508cdd34afb69e6f42a05bc` |
| batch | max 100 events, 5 s POST timeout, flush interval derived from a gate |
| a second (browser/RUM-style) intake | `https://browser-intake-us5-datadoghq.com/api/v2/logs`, batch 25, 10 s (`cli.pretty.js:347313`) |
| sourcemap group | `DD_SOURCEMAP_GROUP: "darwin"` (build constant) |

Two distinct feeds:

1. **Error reports** (`Fte`, `cli.pretty.js:73830`) — enabled by `per()` (`cli.pretty.js:531937`): requires
   `!DISABLE_ERROR_REPORTING`, `!zh()`, provider `firstParty` **and** a first-party base URL, a version
   ≥ some floor, and an "untaintable" credential (`oSn` refuses when the credential came from
   `ANTHROPIC_AUTH_TOKEN` or `apiKeyHelper`). Payload: `ddtags` (`service`, `team:claude-code`, `version`,
   `env:external`, `origin`, `platform`, `os_release`, `user_bucket`, `entrypoint`, `node_version`,
   `bun_version:1.4.1`, `is_native_runtime`, `model`, `error_code`, `session_kind`, `has_attacher`,
   `renderer_mode`), plus `error.{kind,message,stack,fingerprint,handling}` (message ≤ 4000, stack ≤ 16000),
   top-20 `error_frames`, and the resolved `feature_flags`. `user_bucket` is
   `sha256(deviceId)[0:8] mod 30`.
   A large redaction pipeline (`m$`, `cli.pretty.js:304442`) scrubs home paths → `~/`, usernames → `<user>`,
   emails, IPs, phone numbers, URLs, AWS ARNs, base64 blobs → `<blob>`, MCP server names, API error bodies,
   and header values before anything leaves.
   Errors **never** reported: `APIUserAbortError`, `AuthenticationError`, `McpSessionExpiredError`, plus
   two path-shaped allowances (`cli.pretty.js:73845`).
2. **Allowlisted product events** (`_Ne`, `cli.pretty.js:312744`): a hardcoded set of **190** event names
   (`LSr`) — `tengu_feature_ok/bad/sad`, `tengu_api_error`, `tengu_api_success`, `tengu_init`, `tengu_exit`,
   `tengu_cancel`, all the `tengu_mcp_*` and `chrome_bridge_*` names, `tengu_auto_mode_*`,
   `tengu_refusal_fallback_*`, `tengu_model_fallback_triggered`, etc. — mirrored to Datadog. Per-peer rate
   limiting for the MCP subset: 10 forwards per 60 s window, 200 tracked keys. High-cardinality attributes
   (`mcpServerName`, `errorMessageHash`, `skill_name_hash`, …) are stripped (`MSr`, `cli.pretty.js:312662`).
   Disabled by `JO()` — a BYOC environment without `CLAUDE_CODE_BYOC_ENABLE_DATADOG`.

### 5.4 OpenTelemetry — the customer-facing surface

Enabled by `CLAUDE_CODE_ENABLE_TELEMETRY` (`cli.pretty.js:265027`).

**Metrics** (`cli.pretty.js:80946`):

| metric | unit | description |
|---|---|---|
| `claude_code.session.count` | — | CLI sessions started |
| `claude_code.lines_of_code.count` | — | lines modified (`type` = added/removed, `model`) |
| `claude_code.pull_request.count` | — | PRs created |
| `claude_code.commit.count` | — | git commits created |
| `claude_code.cost.usage` | USD | session cost |
| `claude_code.token.usage` | tokens | tokens used |
| `claude_code.code_edit_tool.decision` | — | Edit/Write/NotebookEdit accept/reject |
| `claude_code.active_time.total` | s | total active time |

**Spans** (tracer `com.anthropic.claude_code.tracing` v1.0.0, `cli.pretty.js:531200`):
`claude_code.interaction` (attrs `user_prompt`, `user_prompt_length`, `interaction.sequence`,
`interaction.duration_ms`), `claude_code.llm_request` (`model`, `gen_ai.system: anthropic`,
`gen_ai.request.model`, `llm_request.context` ∈ {tool, interaction, standalone}, `speed`, `query_source`,
`agent_id`, `parent_agent_id`; on end: `input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_creation_tokens`, `ttft_ms`, `duration_ms`, `status_code`, `request_id`/`gen_ai.response.id`,
`client_request_id`, `stop_reason`/`gen_ai.response.finish_reasons`, `response.has_tool_call`),
`claude_code.tool`, `claude_code.tool.execution`, `claude_code.tool.blocked_on_user` (`decision`, `source`),
`claude_code.hook`, `claude_code.compaction`, `claude_code.bash.subprocess`, `claude_code.mcp.rpc`,
`claude_code.subagent.spawn`. A `gen_ai.request.attempt` span event carries `attempt` +
`client_request_id`. `TRACEPARENT` / `TRACESTATE` are honored in non-interactive mode; a `traceresponse`
response header is turned into a span link with `link.type: "parent_of"`.

**Log events** — `Po(name, attrs)` (`cli.pretty.js:60259`) emits a record whose **body** is
`claude_code.<name>` and whose attributes always include `event.name`, `event.timestamp`, `event.sequence`,
plus `prompt.id` and `workspace.host_paths` (from `CLAUDE_CODE_WORKSPACE_HOST_PATHS`, `|`-separated) when
present. Names found (27; per-chunk minification means this is a lower bound):

```
api_error   api_refusal   api_request   api_retries_exhausted   assistant_response
at_mention  auth          compaction    feedback_survey
hook_execution_start  hook_execution_complete  hook_plugin_metrics  hook_registered
internal_error  mcp_server_connection  permission_mode_changed
plugin_installed  plugin_loaded  retention_sweep  skill_activated
subagent_completed  system_prompt  tool  tool_decision  tool_result  user_prompt
```

**Env vars honored** (74 `OTEL_*` names in the binary):

- Enable/exporters: `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER`
  (`otlp` / `console` / `prometheus` / `none`, comma-separated).
- Protocol/endpoint: `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc` / `http/json` / `http/protobuf`, each a separate
  lazily-imported chunk), `OTEL_EXPORTER_OTLP_ENDPOINT`, `_HEADERS`, `_COMPRESSION`, `_TIMEOUT`,
  `_CERTIFICATE`, `_CLIENT_CERTIFICATE`, `_CLIENT_KEY`, `_INSECURE`, plus per-signal
  `_METRICS_` / `_LOGS_` / `_TRACES_` variants and `_METRICS_TEMPORALITY_PREFERENCE`.
- Prometheus: `OTEL_EXPORTER_PROMETHEUS_HOST`, `_PORT`.
- Intervals/limits: `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_LOGS_EXPORT_INTERVAL`,
  `OTEL_TRACES_EXPORT_INTERVAL`, `OTEL_BSP_*`, `OTEL_BLRP_*`, `OTEL_*_ATTRIBUTE_*_LIMIT`,
  `OTEL_SPAN_*_COUNT_LIMIT`, `OTEL_FLUSH_TIMEOUT_MS`, `OTEL_SHUTDOWN_TIMEOUT_MS`.
- Content controls (Claude-Code-specific): `OTEL_LOG_USER_PROMPTS` (else the prompt is `<REDACTED>`),
  `OTEL_LOG_ASSISTANT_RESPONSES` (defaults to the former), `OTEL_LOG_TOOL_CONTENT`, `OTEL_LOG_TOOL_DETAILS`,
  `OTEL_LOG_RAW_API_BODIES`, `OTEL_CONTENT_MAX_LENGTH`.
- Attribute controls: `OTEL_METRICS_INCLUDE_SESSION_ID`, `_INCLUDE_VERSION`, `_INCLUDE_ACCOUNT_UUID`,
  `_INCLUDE_ENTRYPOINT`, `_INCLUDE_RESOURCE_ATTRIBUTES`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_SERVICE_NAME`,
  `OTEL_SCOPE_NAME`, `OTEL_SCOPE_VERSION`, `OTEL_TRACES_SAMPLER`, `_SAMPLER_ARG`, `OTEL_DIAG_STDERR`.
- Helper: `otelHeadersHelper` settings hook + `OTEL_HEADERS_HELPER_DEBOUNCE_MS`.
- Anthropic-internal parallel set (ignored externally): `ANT_OTEL_*`, `ANT_CLAUDE_CODE_METRICS_ENDPOINT`,
  `BETA_TRACING_ENDPOINT` (posts to `<endpoint>/v1/traces` and `/v1/logs`, `cli.pretty.js:264899`).

Resource attributes are `service.name: claude-code`, `service.version: 2.1.251`, OS/host detectors, plus
`wsl.version` on WSL. Env-detected attributes starting `user.` or `identity.` are filtered out when
Claude-Code-supplied attributes exist (`cli.pretty.js:264882`).

**The org opt-out**: before exporting to the Anthropic-internal BigQuery sink, Claude Code calls
`GET /api/claude_code/organizations/metrics_enabled` (cached 1 h in-process, 24 h on disk in
`metricsStatusCache`) and skips export unless `metrics_logging_enabled` is true
(`cli.pretty.js:264519`, `264644`). The internal sink itself is
`POST https://api.anthropic.com/api/claude_code/metrics` (`cli.pretty.js:264614`) with a transformed payload:
`{resource_attributes: {service.name, service.version, os.type, os.version, host.arch,
aggregation.temporality, user.customer_type: "claude_ai"|"api", user.subscription_type}, metrics: [...]}`.
It refuses to send when the resolved credential does not belong to the endpoint's host
(`misrouted_credential`) or when a WIF dispatch host differs.

### 5.5 Opt-out precedence

`x()` (`cli.pretty.js:697489`) returns one of three modes:

```
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC  ->  "essential-traffic"   (the widest umbrella)
DISABLE_TELEMETRY                          ->  "no-telemetry"
DO_NOT_TRACK (truthy)                      ->  "no-telemetry"
otherwise                                  ->  "default"
```

`Ct()` = essential-traffic-only; `_j()` = any opt-out. Essential-traffic mode additionally suppresses the
updater's version lookup, gateway model discovery, bootstrap, feedback submission, DesignSync, Projects,
`--enable-live-preview`, and shared-transcript upload, each with its own explicit message (e.g.
`"DesignSync is unavailable while nonessential network traffic is restricted
(CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set)."`, `cli.pretty.js:295923`).

Other opt-outs: `DISABLE_ERROR_REPORTING`, `DISABLE_BUG_COMMAND`
(`"<cmd> has been disabled via the DISABLE_BUG_COMMAND environment variable"`, `cli.pretty.js:845850`),
`DISABLE_GROWTHBOOK`, `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES`, `DISABLE_NON_ESSENTIAL_MODEL_CALLS`.

### 5.6 `/bug` and `/feedback`

`H$e` (`cli.pretty.js:523890`): `POST /api/claude_cli_feedback`, `Content-Type: application/json`, 30 s
timeout, through the axios wrapper `bt` (which handles auth, data-residency refusal, and 401→refresh→retry).
Response `{feedback_id}`. Blocked when `Ct()` (essential-traffic) or the managed policy denies
`allow_product_feedback` (→ `failureReason: "policy_blocked"`).

Payload (`Gl`, `cli.pretty.js:523869`): `latestAssistantMessageId`, `latestAssistantAPIMessageId`,
`lastInterruptedAssistantAPIMessageId`, `message_count`, `datetime`, `description`, `surface`, `scope`,
`platform`, `gitRepo`, `commitSha`, `remoteWorkspace`, `remoteSessionId`, `terminal`, `version`,
`transcript`, `errors` (the recent-error ring), `lastApiRequest`, `subagentTranscripts`, `rawTranscriptJsonl`,
`recentSessionTranscripts`, `debugLog` (tail-truncated with an explicit
`[debug log truncated to last N of M bytes]` header), and survey fields
(`survey_appearance_id`, `survey_response`, `survey_type`). Over the size cap the raw transcript is dropped
and re-tried; third-party-provider transcripts are excluded and counted. Events:
`tengu_bug_report_submitted` / `tengu_bug_report_failed`, feature health `feedback_submit` /
`feedback_precompact`.

`/bug`'s GitHub-issue title is generated by the small model (§1.9). There is also a **`SendFeedback` tool**
(`cli.pretty.js:478049`) that only writes a **local draft** for the user to review — it sends nothing —
capped per session (`tengu_feedback_draft_call_capped`, `tengu_feedback_draft_created`).

### 5.7 Other first-party endpoints on the same host

| endpoint | purpose | anchor |
|---|---|---|
| `GET /api/claude_cli/bootstrap?entrypoint&model` | client config: `additional_model_options`, `additional_model_costs`, `model_access`, `org_model_default`, `auto_compact_windows`, `oauth_account`, `client_data` | `cli.pretty.js:141092` |
| `GET /api/oauth/usage[?at_wall=1&skip_spend=1]` | the `/usage` data source | `cli.pretty.js:329357` |
| `GET /api/claude_code/settings` | managed settings | `cli.pretty.js:381228` |
| `GET /api/claude_code/policy_limits` | policy limits | `cli.pretty.js:378554` |
| `GET /api/claude_code/skills` | server-side skills | `cli.pretty.js:278274` |
| `GET /api/claude_code/notification/preferences` | notifications | `cli.pretty.js:141546` |
| `POST /api/claude_code_penguin_mode` | feature probe | `cli.pretty.js:303884` |
| `GET /api/claude_code_grove` | feature probe | `cli.pretty.js:61246` |
| `POST /api/claude_code_shared_session_transcripts` | `/share` | `cli.pretty.js:161533` |
| `/v1/code/sessions[...]` | cloud/remote sessions (list, events, mark_read, presence, archive) | `cli.pretty.js:306892`–`307076` |
| `POST /v1/code/github/import-token` | CCR BYOC GitHub token import (`anthropic-beta: ccr-byoc-2025-07-29`) | `cli.pretty.js:61315` |
| `GET /v1/mcp_servers?limit=1000` | connector discovery (`anthropic-beta: mcp-servers-2025-12-04`) | `cli.pretty.js:213787` |
| `HEAD /api/hello`, `GET <TOKEN_URL origin>/v1/oauth/hello` | connectivity probes | `cli.pretty.js:43253`, `285206` |

Bootstrap's `client_data` is cached per `{entrypoint, model, org}` slot in `~/.claude.json`
(`clientDataCacheSlots`), with a staleness window `Pnr` and a `tengu_client_data_cache_key` event recording
slot hit/miss/staleness. Bootstrap is skipped for third-party providers, essential-traffic mode, and
unix-socket sessions.

---

## 6. Auto-updater

### 6.1 Install layouts

`W()` (`cli.pretty.js:48607`), on top of XDG helpers (`cli.pretty.js:583099`):

| path | value |
|---|---|
| versions dir | `${XDG_DATA_HOME:-~/.local/share}/claude/versions` |
| staging dir | `${XDG_CACHE_HOME:-~/.cache}/claude/staging` |
| lock dir | `${XDG_STATE_HOME:-~/.local/state}/claude/locks` |
| launcher | `~/.local/bin/claude` (`claude.exe` on Windows) |

`installMethod` in `~/.claude.json` is one of `native` / `local` (npm-local) / global; `tee()` detects
`development` / `npm-local` / `npm-global` / `native` at runtime.

### 6.2 Channels and version lookup

`autoUpdatesChannel` setting; unset means **`latest`**, the alternative is **`stable`**
(`DP`, `cli.pretty.js:97567`; validation rejects anything but `stable`/`latest`, and explicitly rejects `rc`
with `"Invalid channel: rc. Use 'stable' or 'latest'"`, `cli.pretty.js:48247`).

Native: `GET https://downloads.claude.ai/claude-code-releases/{channel}` → a bare version string; 30 s
timeout, 3 attempts (`cli.pretty.js:48216`, `48222`). Events `tengu_version_check_success` /
`tengu_version_check_failure`.

npm: `npm view @anthropic-ai/claude-code@{stable|latest} version --registry https://registry.npmjs.org/`
run from `$HOME` (`cli.pretty.js:578258`, `719112`). Homebrew installs pick their channel by **cask name**,
not by settings — the `claude-code` cask tracks stable (`cli.pretty.js:215502`).

A `tengu_canary` gate can pin a specific external version above the channel's, capped by an org
`maxVersion`; `forceDowngradeEnabled` + `maxVersion` can force a downgrade
(`tengu_auto_updater_forced_downgrade`, `tengu_native_update_forced_downgrade`).

### 6.3 Download and install

`st()` (`cli.pretty.js:48364`):

1. `GET <base>/<version>/manifest.json` and, in parallel, `manifest.zst.json` (optional). 10 s timeout,
   3 attempts on connection drops.
2. Platform key = `<os>-<arch>` with `-musl` / `-android` suffixes on Linux (`cli.pretty.js:48590`).
   Missing platform → `"Native binaries for <p> are not available on this release channel (version <v>
   ships: …)"`.
3. `GET <base>/<version>/<platform>/claude[.zst]` streamed to the staging dir, SHA-256 verified against
   the manifest (compressed checksum verified separately when zstd is used, with a decompressed-size cap).
   Stall timeout **120 s** without bytes (`StallTimeoutError`), total deadline **600 s**, **3** attempts,
   1 s between; a zstd frame rejection falls back to the uncompressed URL. `chmod 0755` on success.
4. Atomic move into `~/.local/share/claude/versions/<version>`.
5. **Launcher activation** (`Dt`, `cli.pretty.js:48846`): POSIX creates a symlink at `~/.local/bin/claude` →
   the version path; if one exists, it writes `claude.tmp.<pid>.<ts>` and `rename()`s over it. It **refuses**
   to overwrite a launcher it does not own — anything that is neither a symlink into a `claude/versions/`
   directory nor an npm shim gets the warning
   `"Not replacing <p>: it was not created by the native installer … remove <p> and re-run the update"`
   and returns `refused`. Windows copies the binary, renaming the old one to `.old.<ts>` and restoring it on
   failure.
6. The whole activation runs under a version lock in `~/.local/state/claude/locks`, PID-based with up to 4
   attempts and exponential 1 s→5 s backoff; contention emits `tengu_native_update_lock_failed` with the
   holder's PID.

Events: `tengu_binary_download_attempt`, `_success`, `_failure`, `tengu_binary_manifest_fetch_failure`,
`tengu_binary_platform_not_found`, `tengu_native_install_binary_success`/`_failure`,
`tengu_native_update_complete`, `_skipped_max_version`, `_skipped_minimum_version`,
`tengu_version_lock_acquired`/`_failed`, feature health `update_check` / `update_download` / `update_apply`
with codes such as `update_download_checksum_mismatch`, `update_download_stall_timeout`,
`update_download_zst_fallback`, `update_apply_native_symlink_failed`,
`update_apply_native_activation_refused_external_launcher`, `update_apply_lock_contention`.

### 6.4 Cadence and disable

The React updater component runs the check on mount and then on a **30-minute** interval
(`ko(he, 1800000)`, `cli.pretty.js:269863`). It self-damps: a `no_permissions` result stops checks for the
session, and two consecutive Windows `claude.exe` lock failures (`un = 2`) stop them too.

`DY()` (`cli.pretty.js:312412`) returns the reason updates are off, in order:

1. `DISABLE_UPDATES` → `{type:"env"}`
2. `DISABLE_AUTOUPDATER` → `{type:"env"}`
3. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` → `{type:"env"}`
4. config `autoUpdates === false` (unless `installMethod === "native"` and `autoUpdatesProtectedForNative`)
   → `{type:"config"}`
5. development build → `{type:"development"}`

There is a one-time migration that converts the legacy `autoUpdates: false` preference into
`env: {DISABLE_AUTOUPDATER: "1"}` in user settings (`tengu_migrate_autoupdates_to_settings`,
`cli.pretty.js:747999`). `FORCE_AUTOUPDATE_PLUGINS` lets plugin auto-update continue while CLI updates are
off.

### 6.5 Commands

- `claude update` (alias `upgrade`) — "Check for updates and install if available" (`cli.pretty.js:748630`).
- `claude install [target]` — "Install Claude Code native build. Use [target] to specify version (stable,
  latest, or specific version)", `--force` (`cli.pretty.js:748633`).
- `claude doctor` — "Check the health of your Claude Code installation. Reads settings files in the current
  directory without a trust prompt. For a full checkup that can also fix issues, run /doctor in a session."
  (`cli.pretty.js:748619`); its report starts `["Claude Code doctor", "", "Running: <installationType>
  (<version>)"]` and can probe the keychain (`cli.pretty.js:74129`).
- Windows sandbox: `claude … install` — "Install the Windows sandbox user and network filters. Self-elevates
  (one UAC prompt)…" (`cli.pretty.js:748624`).
- `migrate-installer` survives as the npm-global → native migration path; the auto-updater labels the npm-local
  route `wasMigrated: true` in `tengu_auto_updater_success`.

Version cleanup (`native_cleanup_versions`) prunes old `versions/` entries but skips when the launcher is
externally managed, because it then cannot know which versions are still needed (`cli.pretty.js:49131`).

### 6.6 Release notes

Three sources (`cli.pretty.js:720505`):

```
KDn = https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md   (human link)
FRt = https://code.claude.com/docs/en/changelog                          (docs link)
y   = https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md  (fetched)
```

cached at `~/.claude/cache/changelog.md`. In addition, a **baked-in** changelog string for the most recent
releases ships in the binary (`cli.pretty.js:720603`, starting `## 2.1.250\n- Bug fixes and reliability
improvements\n\n## 2.1.248\n- Added \`--restricted\`…`) so `/release-notes` works offline.

---

## 7. Miscellany worth stealing

- **Client request id.** Header name `x-client-request-id` (`SDe`, `cli.pretty.js:846672`); it threads through
  gzip telemetry, the first-byte watchdog arming map, and the LLM span (`client_request_id`).
- **`anthropic-dispatch-id`.** `Qie = "anthropic-dispatch-id"` with values `v2s` / `v2d`
  (`cli.pretty.js:497775`) — a server-routing hint that is dropped and retried once on a pre-first-event
  connection error.
- **Model-capability cache.** `~/.claude/cache/model-capabilities.json` holds `{id, max_input_tokens,
  max_tokens}` from `/v1/models` with a timestamp, mode 0600 (`cli.pretty.js:306100`).
- **Prompt-cache TTL choice.** `FIt` (`cli.pretty.js:497854`): OAuth subscribers on the allowlist from the
  `tengu_prompt_cache_1h_config` gate get `1h`, everyone else `5m`; overage usage forces `5m`. A `1h` choice
  adds the `extended-cache-ttl-2025-04-11` beta.
- **Non-conforming model names** are scrubbed before telemetry with two regexes:
  `^[A-Za-z0-9._:[\]-]{1,100}$` and `^[A-Za-z0-9._:[\]-]{1,91}@\d{8}(\[\d{1,3}[mM]\])?$`
  (`cli.pretty.js:303417`) — otherwise `"nonconforming"`.
- **`CLAUDE_CODE_SIMULATE_PROXY_USAGE`** strips every beta except `oauth-2025-04-20` and logs which ones it
  dropped (`cli.pretty.js:498585`) — a built-in way to reproduce a proxy that eats beta headers.

---

## Deltas vs the February parity rows

**22-service-api**

- **22.4 "Azure AI Foundry"** understates the provider count. 2.1.251 has **eight** providers, not four:
  `firstParty`, `bedrock`, `vertex`, `foundry`, plus `anthropicAws` (Claude Platform on AWS),
  `anthropicGoogleCloud` (Claude Platform on Google Cloud), `mantle` (Amazon Bedrock (Mantle)) and `gateway`
  (enterprise cloud gateway). Each has its own env var, base URL, credential chain and skip-auth flag
  (`cli.pretty.js:877169`, `877171`). Bedrock+Mantle can be active simultaneously with **per-model** routing.
- **22.5 "Fork-specific OpenAI provider path"** — confirmed absent. There is no OpenAI-shaped client anywhere.
  The nearest surface is `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`, which reads a *Claude-shaped*
  `/v1/models` from a custom `ANTHROPIC_BASE_URL` and only surfaces ids matching `/(claude|anthropic)/i`
  (`cli.pretty.js:141184`). The row's verdict stands; its framing ("a parallel client") is the only option.
- **22.6 "Custom base URL / gateway / proxy override"** is now three distinct things that behave differently:
  (a) `ANTHROPIC_BASE_URL` — still `firstParty` but *not* `jo()`, which silently disables the 1M-context beta
  path, prompt-cache 1h, Datadog, gzip, bootstrap `cch=`, `cc_prev_req`/`cc_prompt_id`, and tool-search;
  (b) `CLAUDE_CODE_USE_GATEWAY` — a real provider with a JWT and TLS pinning;
  (c) `CLAUDE_CODE_CUSTOM_OAUTH_URL` — allowlisted to three FedStart/staging hosts, throws otherwise.
  A replica that only maps (a) will silently lose a lot of behavior.
- **22.7 "Model registry / capability matrix"** — the registry is a **baked object literal** with 17 models,
  pricing tiers, per-provider ids, `max_output_tokens`, `capabilities[]`, `default_effort`, `advisor_rank`,
  `fallback_chain`, `picker`, `deprecation.retirement_dates`, `min_cli_version`. Two capability layers the
  Feb row doesn't name: `effort` / `max_effort` / `xhigh_effort` / `adaptive_thinking` /
  `thinking_disabled_effort_cap`, and `lean_prompt` / `fable_5_mitigations` / `opus_5_prompt_bundle` /
  `refusal_fallback` (prompt-shape and safety behaviors keyed off the model id). Also new since February:
  the `fable` and `mythos` families and `best: "fable"`.
- **22.9 "Retry with exponential backoff"** — the row says "internal". Concretely: **two** stacked retry
  layers with different formulas (SDK `0.5·2ⁿ` cap 8 s; Claude Code `500·2^(n−1)` cap 32 s / 300 s),
  default 10 attempts, `CLAUDE_CODE_MAX_RETRIES` clamped at 15, a `Retry-After` floor, a 60 s
  refuse-to-wait threshold, a 6 h absolute cap for persistent 429s, and a `CLAUDE_CODE_RETRY_WATCHDOG` mode
  that raises the cap to 300 attempts.
- **22.10 "Streaming → non-streaming fallback"** — there is a *third* behavior the row misses: when content
  was already yielded, Claude Code does **not** fall back; it synthesizes a `stop_reason` and appends one of
  four explicit truncation notices (`cli.pretty.js:499310`). Two extra kill switches exist beyond
  `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`: the gates `tengu_disable_streaming_to_non_streaming_fallback`
  and `tengu_watchdog_skip_nonstreaming_fallback`, the latter auto-on under `CLAUDE_CODE_REMOTE`.
- **22.15 "Bootstrap fetch"** — still accurate, and richer than described: it also returns `model_access`
  entitlements, `org_model_default` (with `override_user_selection`), `auto_compact_windows`, and a
  per-`{entrypoint, model, org}` `client_data` cache slot.
- **22.17 "claude.ai (Max/Pro) inference rate limits"** — the *surface* is far larger than "not possible"
  implies: ~30 `anthropic-ratelimit-unified-*` headers, four claim types with synthesized resets
  (5 h / 7 d / 7 d-opus / 7 d-sonnet), a grace band, an overage/extra-usage channel with monthly and channel
  utilization, and a "slow / lower-priority" lane with its own budget, offer, max-wait and retry-after.
  Any replica that wants parity with `/usage` and `/status` has to model all of these, even if it can only
  populate them under API-key billing.
- **Missing row entirely — request-body gzip.** Not in the February tables at all. It is a real,
  observable wire behavior on first-party (`Content-Encoding: gzip` above 4 KiB) with a persisted 7-day
  latch-off on middlebox rejection.
- **Missing row entirely — the `x-anthropic-billing-header` system-prompt line.** It looks like a header but
  is the first system block, and `CLAUDE_CODE_ATTRIBUTION_HEADER` turns it off.
- **Missing row entirely — `metadata.user_id` composition.** It is a JSON blob, not an opaque id, and it
  carries `device_id` / `account_uuid` / `session_id` / `parent_session_id`.

**25-service-oauth-auth**

- **25.1 / 25.2** — the flow is now fully documented above (PKCE S256, dynamic loopback port, manual-redirect
  fallback, `orgUUID` / `login_hint` / `login_method` params, the exact scope sets). The "not-possible for
  third-party SDK apps" verdict is a licensing constraint, not a technical one; the mechanics are simple.
- **25.3 "apiKeyHelper"** — needs numbers: default TTL **300000 ms** (`CLAUDE_CODE_API_KEY_HELPER_TTL_MS`),
  30 s skew allowance, 16 KiB output cap, JWT `exp` overrides the TTL, and the value is installed as
  `Authorization: Bearer`, not `x-api-key`. Also: it is refused from project/local settings without trust.
- **25.5 "Refresh-token rotation with cross-process lockfile"** — confirmed, plus details the row lacks:
  refresh-token expiry defaults to **30 days**, access tokens are treated as expired **5 minutes** early,
  and lock contention surfaces as a named `OAuthRefreshLockTimeoutError` rather than a generic failure.
- **25.7 "macOS Keychain"** — service name is now derivable: `Claude Code-credentials` by default, with an
  environment suffix (`-local-oauth` / `-staging-oauth` / `-custom-oauth`) and a
  `-<sha256(configDir)[0:8]>` suffix **only** when `CLAUDE_CONFIG_DIR` is set; account is `$USER`.
  Writes go through `security -i` on stdin below 4032 bytes to keep secrets out of argv.
- **25.9 "Trusted-device enrollment"** — still present (`getTrustedDeviceToken`, `cli.pretty.js:255110`),
  now used by the environment-runner API, not just claude.ai.
- **Missing row entirely — WIF / Anthropic profiles.** `ANTHROPIC_FEDERATION_RULE_ID` +
  `ANTHROPIC_ORGANIZATION_ID` (or `~/.config/anthropic` profiles via `ANTHROPIC_PROFILE`) is a **third**
  first-party auth flavor alongside API key and OAuth, with its own beta pair
  (`oauth-2025-04-20,oidc-federation-2026-04-01`) and its own precedence rules against a stored claude.ai
  login.
- **Missing row entirely — `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` / `CCR_OAUTH_TOKEN_FILE` /
  `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR` / `CLAUDE_CODE_HOST_CREDS_FILE` /
  `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`.** A whole "host process injects the credential" family that the
  February snapshot predates.
- **Missing row entirely — mTLS.** `CLAUDE_CODE_CLIENT_CERT` / `_KEY` / `_KEY_PASSPHRASE`, with
  mid-rotation mismatch detection and automatic reload-and-retry on stale-connection errors.

**26-service-analytics-flags**

- **26.1 "logEvent → BigQuery"** — the endpoint is now nameable:
  `POST https://api.anthropic.com/api/event_logging/v2/batch`, batch 200, 8 attempts, 500→30000 ms backoff,
  with a disk-backed retry queue. The OTel logger scope `com.anthropic.claude_code.events` is unchanged.
- **26.2 "Datadog third-party event sink"** — the gating described in February
  (`NODE_ENV==='production'` + firstParty) is **not** what 2.1.251 does. `per()`
  (`cli.pretty.js:531937`) additionally requires a *first-party base URL* and an **untaintable credential**:
  a session authenticated via `ANTHROPIC_AUTH_TOKEN` or `apiKeyHelper` is refused
  (`blocked_auth_token_env` / `blocked_api_key_helper`). BYOC environments are excluded unless
  `CLAUDE_CODE_BYOC_ENABLE_DATADOG`. The intake host and public key are quotable
  (`https://http-intake.logs.us5.datadoghq.com/api/v2/logs`, `pubea5604404508cdd34afb69e6f42a05bc`), and a
  second browser-intake host exists. The event allowlist is 190 names, with per-peer rate limiting for MCP
  events.
- **26.3 "OpenTelemetry"** — the row calls it "the ONE telemetry surface customers control" and is right, but
  the surface is much wider than implied: 74 `OTEL_*` variables, three exporter protocols each in a
  separately-loaded chunk, a Prometheus exporter, an `otelHeadersHelper` settings hook with a debounce, and
  six content-redaction switches (`OTEL_LOG_USER_PROMPTS` etc.). Also: eight metrics, ten span names, and
  27 log-event names, all enumerated above.
- **26.4 "GrowthBook remote feature-flag resolution"** — confirmed and now fully specified: client key
  `sdk-zAZezfDKGoZuXXKe`, `apiHost https://api.anthropic.com/`, `remoteEval: true`, authed eval path
  `/api/eval-authed/<key>` with a fallback to `/api/eval/<key>`, `cacheKeyAttributes ["id",
  "organizationUUID"]`, and a `cachedGrowthBookFeatures` disk snapshot in `~/.claude.json` that is read even
  when the client is disabled. `DISABLE_GROWTHBOOK` is a real kill switch (with a user-visible message for
  Remote Control). 379 gates.
- **26.5 / 26.6 / 26.7** — unchanged in substance.
- **26.11 "Disable analytics"** — the precedence is now explicit and worth copying verbatim:
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` > `DISABLE_TELEMETRY` > `DO_NOT_TRACK`, producing
  `essential-traffic` / `no-telemetry` / `default`, plus a *fourth* implicit killer —
  `CLAUDE_CODE_CUSTOM_OAUTH_URL` being set disables the whole 1P pipeline (`zh()`,
  `cli.pretty.js:302653`).
- **Missing row entirely — Statsig.** If any downstream doc still says "Statsig", it is wrong for 2.1.251:
  Statsig is gone; GrowthBook replaced it.
- **Missing row entirely — Sentry.** Likewise. Error reporting is Datadog, and the classification/redaction
  pipeline (`m$`, 20+ redaction passes) is arguably the more interesting half.
- **Missing row entirely — the feature-health triad.** `tengu_feature_ok` / `_bad` / `_sad` with 713 / 386
  distinct `feature_name`s is the single most-used telemetry convention in the binary and has no parity row.
- **Missing row entirely — the org metrics opt-out call.**
  `GET /api/claude_code/organizations/metrics_enabled` gates the internal metrics export, cached 1 h
  in-process and 24 h on disk.
- **No parity file covers the updater at all.** Section 6 above is entirely new ground relative to the
  February tables.

---

## Open questions

1. **Where does `wt()` (the `x-app: cli-bg` switch) come from?** The literal is at `cli.pretty.js:846490`;
   I did not trace the predicate. It is presumably "running as a background/detached worker", which would
   matter for a replica that also spawns background sessions. **INFERRED.**
2. **The `null` beta slots.** `P8e`, `R4`, `LSt` are `null` in this build and filtered out of `C4`
   (`cli.pretty.js:303292`). They are almost certainly build-time-DCE'd internal betas; their header strings
   are not recoverable from this binary.
3. **`Ru`'s exact provider matrix.** I read the branch structure but did not exhaustively evaluate
   `uw()` / `As()` / `r0()` / `MH()` / `jo()` for every (provider × model × credential) combination.
   The table in §1.6 is accurate about *which condition* gates each beta, not about the full truth table.
4. **Bedrock `body.anthropic_beta` vs header.** `otr` sends only the `Zc` subset in the body
   (`cli.pretty.js:306562`), while `BV` strips that same subset from the header — but afk-mode is sent
   *both* ways depending on `A3t()` (`cli.pretty.js:498566`). I did not determine what `A3t()` tests.
5. **`CLAUDE_CODE_EXTRA_METADATA` sanitization.** `HMt()` sanitizes the parsed object
   (`cli.pretty.js:497905`) but I did not read its rules (key allowlist? length caps?).
6. **The `x-anthropic-billing-header` version hash.** `cc_version=2.1.251.<e>` where `e` is
   `fTt(messagesPreNormalize)` (`cli.pretty.js:498446`) — a prompt-shape hash, presumably for cache-hit
   attribution. Its exact input is unverified. **INFERRED.**
7. **Log-event completeness.** The 27 `Po(...)` names are what a single-chunk grep finds. Because the emitter
   is imported under different minified names per chunk, other call sites may exist. A full enumeration would
   need per-chunk import resolution.
8. **`/status` billing-source line.** `Dn()?.billingType` distinguishes `usage_based` from subscription
   billing (`cli.pretty.js:93122`, `315077`) and feeds a status-line `billingType` field
   (`cli.pretty.js:744895`), but I did not find the exact user-visible copy for each value.
9. **Updater `maxVersion` / `forceDowngradeEnabled` source.** `ree()` supplies both
   (`cli.pretty.js:48793`); it is presumably managed-settings or a bootstrap field, not traced here.
10. **The `X7e`/`ee`/`ot`/`Re` constant names in the download path** are chunk-local; I read their values
    (3000 / 3 / 120000 / 600000) but a different chunk may reuse the same identifiers with other values, so
    cross-referencing them by name will mislead.
