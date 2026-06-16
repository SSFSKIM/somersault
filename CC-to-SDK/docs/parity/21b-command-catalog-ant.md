# Parity — 21b-command-catalog-ant

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 21b.1 | ANT-only internal commands (/version,/bridge-kick,/commit,/issue,/onboarding,/teleport,/share,/summary,/ctx_viz,/backfill-sessions,/break-cache,/bughunter,/mock-limits,/reset-limits,/ant-trace,/perf-issue,/env,/oauth-refresh,/debug-tool-call,/autofix-pr,/agents-platform,...) | 🚫 not-possible | — | Login-gated to Anthropic-internal (USER_TYPE==='ant') accounts; never registered for external users, so they never appear in supportedCommands() and cannot be invoked through the SDK. No external parity possible. | Pnon-goal | doc | feb |
| 21b.2 | ANT runtime-gated public commands (/files,/tag,/cost ANT branch) | 🚫 not-possible | — | The ANT-only branches/visibility require USER_TYPE==='ant'; external SDK sessions never satisfy the gate. /tag's session-tagging concept is separately available via SDK tagSession(), but the slash command itself is ANT-gated. | Pnon-goal | inferred | feb |
