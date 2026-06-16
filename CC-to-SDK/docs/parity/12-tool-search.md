# Parity — 12-tool-search

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 12.1 | Glob filename search | ✅ provided | Glob tool (claude_code preset) — GlobInput (sdk-tools.d.ts:555) | Bundled Glob tool is identical; ripgrep vendored in the CC process. | P1 | doc | feb |
| 12.2 | Glob mtime sort + 100-result cap | ✅ provided | Glob tool (claude_code preset) | Cap/sort internal to the bundled Glob tool; globLimits.maxResults overridable inside CC context. | P2 | doc | feb |
| 12.3 | Glob hidden/no-ignore env toggles | 🔧 configurable | Options.env — pass CLAUDE_CODE_GLOB_HIDDEN / CLAUDE_CODE_GLOB_NO_IGNORE | Override via Options.env (env REPLACES process.env when set). | P2 | inferred | feb |
| 12.4 | Grep ripgrep regex content search | ✅ provided | Grep tool (claude_code preset) — GrepInput.pattern (sdk-tools.d.ts:565) | Bundled Grep tool is identical. | P1 | doc | feb |
| 12.5 | Grep output modes | ✅ provided | GrepInput.output_mode (sdk-tools.d.ts:581) | Same enum on the bundled Grep tool. | P1 | doc | feb |
| 12.6 | Grep context/line-number flags | ✅ provided | GrepInput -A/-B/-C/context/-n/-i/multiline (sdk-tools.d.ts:585-625) | All flags present on the bundled Grep tool. | P1 | doc | feb |
| 12.7 | Grep head_limit/offset pagination | ✅ provided | GrepInput.head_limit, GrepInput.offset (sdk-tools.d.ts:617,621) | Same pagination params on the bundled Grep tool. | P1 | doc | feb |
| 12.8 | Grep type/glob file filters | ✅ provided | GrepInput.type, GrepInput.glob (sdk-tools.d.ts:613,577) | Same filters on the bundled Grep tool. | P1 | doc | feb |
| 12.9 | Grep -o only-matching flag | ✅ provided | GrepInput['-o'] (sdk-tools.d.ts:609) | SDK's bundled Grep adds `-o`, which is ABSENT from the Feb spec input schema — the live SDK tool is a superset of the Feb CC tool here. | P1 | doc | post-feb |
| 12.10 | ripgrep timeout/EAGAIN/buffer handling | ✅ provided | Grep/Glob tools (claude_code preset); env override via Options.env | Robustness internal to the vendored ripgrep wrapper in CC; tune timeout via env. | P2 | doc | feb |
| 12.11 | Permission ignore-pattern injection | ✅ provided | Grep/Glob tools (claude_code preset) + permissions deny rules | Ignore patterns derived from CC permission context; influence via permission rules / settingSources. | P2 | inferred | feb |
| 12.12 | ToolSearch deferred-tool discovery | ✅ provided | ToolSearch tool (claude_code preset); enabled via ENABLE_TOOL_SEARCH env / Options | The deferred-tool mechanism is part of the CC process; WebFetch/WebSearch/NotebookEdit etc. are surfaced through it. | P2 | inferred | feb |
| 12.13 | Embedded search-tool bundle (ANT bfs/ugrep) | 🏗 build | — | ANT-internal embedded-binary path; not exposed to or replicable via the SDK. | Pnon-goal | inferred | feb |
