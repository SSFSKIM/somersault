# Parity — 13-tool-web

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 13.1 | WebFetch URL fetch + markdown extraction | ✅ provided | WebFetch tool (deferred) — WebFetchInput.url/prompt (sdk-tools.d.ts:688) | Bundled WebFetch tool is identical; surface it via ToolSearch/allowedTools (shouldDefer:true). | P1 | doc | feb |
| 13.2 | WebFetch HTTP→HTTPS upgrade | ✅ provided | WebFetch tool (claude_code preset) | Internal to the bundled WebFetch tool. | P2 | doc | feb |
| 13.3 | WebFetch redirect handling (same-host follow, cross-host inform) | ✅ provided | WebFetch tool (claude_code preset) | Redirect policy internal to the bundled WebFetch tool. | P2 | doc | feb |
| 13.4 | WebFetch 15-min URL cache | ✅ provided | WebFetch tool (claude_code preset) | Process-global cache inside CC; transparent to the SDK. | P2 | doc | feb |
| 13.5 | WebFetch domain preflight blocklist | ✅ provided | WebFetch tool (claude_code preset) | Preflight internal to CC; disable via skipWebFetchPreflight setting for blocked-egress enterprises. | P2 | doc | feb |
| 13.6 | WebFetch skipWebFetchPreflight setting | 🔧 configurable | Options.settings / settingSources — skipWebFetchPreflight in CC settings.json | Provide via the flag-settings layer (Options.settings) or a project/user settings file. | P2 | inferred | feb |
| 13.7 | WebFetch preapproved-host fast path | ✅ provided | WebFetch tool (claude_code preset) | Host allowlist baked into the bundled WebFetch tool; domain:<host> permission rules extend it via permissions config. | P2 | doc | feb |
| 13.8 | WebFetch per-domain permission rules | 🔧 configurable | Options permission rules (canUseTool / settings allow rules) — WebFetch domain:<host> | Add allow/deny rules for `WebFetch` with ruleContent domain:<host>, or intercept via canUseTool. | P1 | doc | feb |
| 13.9 | WebFetch binary-content persistence | ✅ provided | WebFetch tool (claude_code preset) | Internal to the bundled WebFetch tool. | P3 | doc | feb |
| 13.10 | WebSearch query | ✅ provided | WebSearch tool (deferred) — WebSearchInput.query (sdk-tools.d.ts:698) | Bundled WebSearch tool is identical; surface via ToolSearch/allowedTools (shouldDefer:true). | P1 | doc | feb |
| 13.11 | WebSearch allowed/blocked domains | ✅ provided | WebSearchInput.allowed_domains / blocked_domains (sdk-tools.d.ts:706,710) | Same params on the bundled WebSearch tool; filtering happens in the Anthropic API, not client-side. | P1 | doc | feb |
| 13.12 | WebSearch provider gating | ✅ provided | WebSearch tool (claude_code preset) — provider gate internal | Gate honored inside CC based on the configured API provider; no SDK-level toggle needed. | P2 | doc | feb |
| 13.13 | WebSearch streaming progress | ✅ provided | WebSearch tool (claude_code preset); SDKToolProgressMessage stream | Progress surfaced as tool_progress system messages over the SDK message stream. | P2 | inferred | feb |
| 13.14 | WebSearch mandatory Sources reminder | ✅ provided | WebSearch tool (claude_code preset) | Trailer/prompt baked into the bundled WebSearch tool. | P3 | doc | feb |
