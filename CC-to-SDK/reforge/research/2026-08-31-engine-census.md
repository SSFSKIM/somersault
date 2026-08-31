# Engine subsystem census — Claude Code 2.1.251

Source: `~/claude-code-bundle/2.1.251/` (`modules/` = 1800 `.js` files / 34,402,726 B minified;
`cli.pretty.js` = 39,530,538 B / 881,404 lines / 1793 chunk sections). Method: `rg -l` over
`modules/` for distinctive literals, `wc -c` on hits, import-graph analysis, and small windowed
reads of `cli.pretty.js`. All byte figures are **minified** unless marked "pretty lines".

## Headline

The engine is **not** evenly spread across 1792 chunks. One chunk — **`chunk-fy12d89p.js`,
3,995,555 B (11.6% of all JS, 108,162 pretty lines)** — is the agent engine proper: every built-in
tool implementation, the system prompt, the compaction prompt, the query loop, the permission
decision path, the hook dispatch sites, the control-protocol handler. It imports the JSX runtime
**not at all**, so it is entirely headless logic. Everything else is either a supporting library, a
peripheral product feature, or the terminal UI.

Because that chunk is minified into one file, its internal structure is invisible to `grep -l`. It
is however cleanly *labelled from the inside*: 862 distinct `tengu_*` telemetry event literals are
distributed through it in feature-coherent runs, which yields a usable internal map (below).

---

## Summary table

Line offsets like `fy@75.9k` mean "line 75,900 of `chunk-fy12d89p.js`'s section in `cli.pretty.js`",
counted from that chunk's `// ====` separator at pretty line 411,873.

| Subsystem | Anchor evidence | Chunks | Est. size | Client/server | Seam quality |
|---|---|---|---|---|---|
| Agent query loop / turn driver | `tengu_api_query`, `tengu_query_error`, `tengu_malformed_tool_use_retry_outcome`, `tengu_orphaned_messages_tombstoned` | `fy12d89p` @75–80k; `dvbbv89q` (375 KB) headless driver | ~250 KB | client (calls server) | medium — long async generator, many closures |
| API client (Anthropic SDK) | `stream ended without producing a Message with role=assistant`, `/v1/messages`, `/v1/files` | `92vbp1ze` (159 KB) | 159 KB | **server-coupled** wire format; client transport | high — vendored SDK, replaceable wholesale |
| Retry / 529 / model fallback | `tengu_api_529_background_dropped`, `tengu_api_opus_fallback_triggered`, `tengu_api_custom_529_overloaded_error`, `tengu_api_fallback_last_resort`, `overloaded_error`, `prompt_too_long` | `fy12d89p` @24–26k, @34k, @75–76k | ~120 KB | client policy over server errors | medium |
| Bedrock / Vertex adapters | `CLAUDE_CODE_USE_BEDROCK`, `bedrock-runtime`, `@aws-sdk/`, `@smithy/` | `fxe5jdkd`, `05h180m3`, `m2r2y7fs`, `yx9c8yaw` +9 | ~505 KB | server-coupled (3rd-party) | high — isolated adapter chunks |
| System-prompt assembly | `You are an interactive CLI tool that helps users with software engineering tasks`, `Is a git repository: `, `Here is useful information about the environment`, `tengu_sysprompt_block`, `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` | `fy12d89p` @336–350 (env block), @17.9–18.7k (prompt text), @85.3k (assembly+hash); `7g4v1yq9` (boundary marker) | ~120 KB | client | **high** — env block is one 12-line named function |
| CLAUDE.md / memory loading | `tengu_memdir_index_assembled`, `tengu_memory_bulk_inflate`, `Since this memory is user-scope` | `fy12d89p` @15–23k, @90–93k; `9e2ns8ty` (244 KB) | ~350 KB | client | medium |
| Compaction | `compact_boundary` (14 chunks), `Your task is to create a detailed summary of the conversation`, `<analysis>`, `tengu_time_based_microcompact`, `tengu_reactive_compact_triggered` | `fy12d89p` @3.6k, @8.4k, @45–48k, @70k, @76.3k; `81xmkgbw`, `g461tywa`, `kje2nmp8` | ~180 KB | client | **high** — prompt + boundary emit are distinct literals |
| Token counting / context sizing | `tengu_context_size`, `countTokens`, `autoCompactEnabled` | `fy12d89p` @85.4k; `92vbp1ze`; `z0mqep56` (31 KB, UI) | ~40 KB | mixed (`/v1/messages/count_tokens` is server) | high |
| Session store / transcript JSONL | `tengu_transcript_write_failed`, `tengu_chain_parent_cycle`, `tengu_resume_consistency_delta`, `projects`, `.jsonl` | `fy12d89p` @4–10k; `d78hxkfm` (233 KB atomic-write/journal layer); `trstwd25` (178 KB) | ~450 KB | client | medium — storage layer is a Result-monad module set |
| Resume / fork | `resumeSessionId`, `forkSession`, `Resume rejected by --resume-drops-turn:`, `tengu_fork_subagent_enabled` | `dvbbv89q`, `wcxa8qd7`, `ert2f9ar`, `wwwdzdhk`, `kc98mm72`; `fy12d89p` @5–9k, @40–42k | ~200 KB | client | medium |
| Bash tool (exec, timeout, background) | `Command timed out after`, `tengu_bash_tool_command_executed`, `tengu_bash_command_timeout_backgrounded`, `BashOutput`, `KillShell` | `fy12d89p` @2.9k (executor class), @60k (shell snapshot/cwd), @100–105k | ~200 KB | client | **high** — ES class with `#`-private fields |
| Bash command safety / AST | `tengu_bash_dangerous_rm_too_complex`, `tengu_bash_ast_too_complex`, `tengu_ant_overly_broad_bash_detected` | `fy12d89p` @28–30k; `w7bq1qyb` (287 KB prefix/word analysis) | ~350 KB | client | medium |
| Sandboxing | `sandbox-exec`, `SeccompFilter`, `apply-seccomp`, `bwrap`, `npx sandbox-runtime windows-install` | `q4xe0m2r` (582 KB — also holds picomatch + `@bufbuild/cel` + protobuf policy engine) | ~180 KB own logic in a 582 KB chunk | client (OS-coupled) | low — CEL policy engine tangles with vendored protobuf |
| Read tool | `Reads a file from the local filesystem`, `cat -n format`, `[Truncated: PARTIAL view — ` | desc: `hx5r9amq` (4.8 KB); impl: `fy12d89p` | ~60 KB | client | **very high** — description lives alone in a 4.8 KB chunk |
| Write / Edit tools | `Writes a file to the local filesystem` (`2z83fvw5`), `Performs exact string replacement`, `String to replace not found in file.`, `tengu_edit_tool_stale_read` | `fy12d89p` @100–101k; `2z83fvw5` (40 KB) | ~90 KB | client | **very high** — already spliced (`write-tool-result`) |
| Glob | `Fast file pattern matching tool that works with any codebase size` | `y30v0ja7` (1.4 KB) desc; impl `fy12d89p` | ~30 KB | client | **very high** — already spliced (`glob-result`) |
| Grep | `A powerful search tool built on ripgrep`, `files_with_matches`, `output_mode` | `hdmehzg7` (5.3 KB) desc; impl `fy12d89p` @54.3k | ~50 KB | client | **very high** |
| WebFetch | `Fetches content from a specified URL`, `Web page content: ---`, `tengu_web_fetch_provenance_prompt`, `tengu_web_fetch_http_error` | `qe0j59w7` (4.2 KB) desc; `fy12d89p` @50–52k | ~40 KB | client fetch + **server-side summarizer sub-call** | high |
| WebSearch | `Allows Claude to search the web`, `web_search_tool_result`, `allowed_domains` | `2z83fvw5` (40 KB); `fy12d89p` | ~25 KB | **server-side** (server-executed tool) | n/a — cannot reimplement |
| NotebookEdit | `NotebookEdit` in 8 chunks; `6f1kqfdx`, `df3fzcr9` | `fy12d89p` @20.9k | ~20 KB | client | high |
| TodoWrite / task list | `Use this tool to create and manage a structured task list`, `activeForm`, `in_progress` | `fy12d89p` @37–39k; `02kp6pz0` | ~40 KB | client | **very high** — already spliced (`task-create-result`) |
| Agent / Task tool (subagents) | `Launch a new agent to handle complex, multi-step tasks`, `subagent_type`, `tengu_agent_tool_completed`, `tengu_subagent_type_normalized`, `tengu_async_agent_stall_timeout` | `fy12d89p` @55–58k; `bf5vvscj` (113 KB) | ~180 KB | client (recursive) | medium — nested loop reentry |
| `.claude/agents` loading | `.claude/agents`, `tengu_agent_parse_error`, `tengu_agent_hooks_origin_untrusted` | `fy12d89p` @37–40k; `q4xe0m2r`; `z0mqep56` | ~60 KB | client | high |
| MCP integration | `StdioClientTransport`, `notifications/initialized`, `tools/call`, `tengu_mcp_connect_timeout_retry`, `Tool ${e.name} has an output schema but did not return structured content` | `4mp04j81` (136 KB transports), `1bxday80` (131 KB call+validate), `25pekgrs` (317 KB MCP SDK+ajv), `h5an0epa` (107 KB zod), `cp17pc9s`, `5m1nsy57`, `zfrf5ppd` | ~800 KB (≈400 KB own) | client | high — vendored SDK behind a thin adapter |
| Hooks engine | `PreToolUse`/`PostToolUse`/`SessionStart`/`UserPromptSubmit`/`PreCompact`/`SubagentStop`, `hookSpecificOutput`, `permissionDecision`, `tengu_pre_tool_hooks_cancelled`, `tengu_sdk_hook_callback_timeout` | `7g4v1yq9` (82 KB schema+events), `x5kv85y3` (13 KB exec+digest), `df3fzcr9` (12 KB), `zvj6yvpp` (4.5 KB), `scxwkz2z` (15 KB), `hooks-worker.js` (5 KB); dispatch `fy12d89p` @30–33k, @70–74k | ~150 KB | client | **high** — event names are unique literals |
| Permission system | `permission_denials`, `acceptEdits`, `bypassPermissions`, `alwaysAllowRules`, `No mode-specific handling for '${d.name}' in acceptEdits mode`, `Invalid permission rule`, `tengu_tool_use_granted_in_config` | `hw8qz4q5` (114 KB rule matching), `8c6qx8qp` (60 KB rule parse/validate), `6f1kqfdx` (5 KB settings sources), `fk13r7sg` (3 KB alias/glob), `fy12d89p` @30–37k | ~250 KB | client | **high** — decision fns return plain objects |
| `canUseTool` brokering | `can_use_tool`, `tengu_tool_use_can_use_tool_rejected/allowed`, `Permission mode override over the control channel is tighten-only` | `fy12d89p` @38–45k, @66k; `dvbbv89q`; `mfkbzdqf` | ~60 KB | client | high |
| SDK / stream-json control protocol | `control_request`, `control_response`, subtypes `set_permission_mode` / `set_max_thinking_tokens` / `apply_flag_settings` / `mcp_message` / `can_use_tool`, `stream-json` | `fy12d89p` @38.7k (switch), @42.3k, @45.2k; `mfkbzdqf` (118 KB), `kje2nmp8` (114 KB), `dvbbv89q` (375 KB), `g1qrzvef` | ~350 KB | client | **high** — one `switch (type)` with literal cases |
| Slash commands | `SlashCommand`, `.claude/commands`, `allowed-tools`, `tengu_skill_tool_slash_prefix` | `fy12d89p` @10–12.5k, @35.9k; `q4xe0m2r`; `4k4029wq`; `ym91g959` | ~120 KB | client | high |
| Skills | `SKILL.md`, `tengu_skill_tool_invocation`, `tengu_dynamic_skills_changed`, `tengu_plugin_skills_dir_loaded`, `tengu_skill_scoped_variant_note` | `fy12d89p` @23.5k, @52k, @56–58k, @100k; `g461tywa` (302 KB); 60 embedded `.md`/`.md.zst` skill assets | ~300 KB | client | high |
| Plugins + marketplace | `marketplace.json`, `extraKnownMarketplaces`, `tengu_plugin_install_failed`, `tengu_plugin_folder_shadowed` | `ayse5xx9` (207 KB), `4k4029wq` (159 KB), `kje2nmp8` (114 KB) +11; `fy12d89p` @10–17k, @95–101k | ~960 KB dedicated | client | medium |
| Output styles | `output-style`, `output_style` | `fy12d89p` @500, @17.9k; `6thm48px`; `q4xe0m2r`; `7g4v1yq9`; `8c6qx8qp` | ~30 KB | client | high |
| Feature gates ("tengu") | 2,179 distinct `"tengu_*"` literals bundle-wide; `tengu_client_data_stale_refetch`, `tengu_model_capability_from_client_data` | gate fn exported from `bsdtxcdc`; call sites everywhere (862 in `fy12d89p`) | call sites are pervasive | **server-fed** config blob, **client-evaluated** | low — gates are inlined at every decision point |
| Telemetry / OTel | `OpenTelemetry SDK Context Key SUPPRESS_TRACING`, `OTLPExporterError`, `@grpc/`, `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | `bsdtxcdc` (809 KB, ~half OTel), `865b79fd` (268 KB OTLP), `whwpx844` (394 KB gRPC/protobuf), `a5550q46` | ~1.2 MB | **server ingest** | high — stub the emit fn, delete the rest |
| Statsig / Sentry | only `~/.claude/statsig` **cache directory name**; `sentry` appears in `zn7e9204`/`thc3f1cf`/`ynzt0fm1` | — | negligible | n/a | n/a — **no bundled Statsig SDK in 2.1.251** |
| OAuth / login | `oauth_console_profile_login`, `oauth/token`, `setup-token`, `claude.ai/api` | `vw4db4kz` (34 KB), `kd3hsk0w` (17 KB), `jnp7j84v` (55 KB), `tb103f96` (4 KB) | ~110 KB | **server endpoints** | high — isolated chunks |
| Auto-updater / native install | `Native installer version-lock callback failed`, `Native installer: canary ${w} exceeds maxVersion`, `claude command at ${u.executable} missing or broken` | `21s77bk2` (39 KB), `rsmvjmyy` (39 KB), `ambpyr8z` (38 KB), `ts31w1v5` (23 KB) | ~140 KB | server (release manifests) | high — drop entirely |
| File-history / rewind | `tengu_file_history_snapshot_success`, `tengu_file_history_rewind_failed` | `fy12d89p` @40–42k | ~60 KB | client | high |
| **TUI / Ink render layer** | `react.transitional.element`, `HostTransitionContext`, `Yoga`, `decstbmRendererEnabled` | jsx-runtime `wk3xnwvn` (941 B), React core `w6mhhrt2` (6.4 KB), Ink+yoga `dxy3a77e` (331 KB), + **288 JSX-importing chunks** | **6.82 MB (19.8%)** | client | n/a — **exclude from denominator** |
| Peripheral cloud features | `tengu_teleport_*`, `ccr_bundle`, `dir_sync_upload`, `worker_status`, `self_hosted_runner_*`, `bridge_server_session_config`, `remote_headless_session`, `[computer-use]`, `com.anthropic.claude_code_browser_extension`, `CLAUDE_CODE_ARTIFACT` | `cv70r1ww`(180 KB), `5cj70w9w`(186 KB), `kde8ssj1`(176 KB), `211zp74w`(137 KB), `mfkbzdqf`(118 KB), `9magbkx1`(100 KB) +~60 | ~3.0 MB dedicated | mixed, mostly server | n/a — **exclude** |

---

## Internal map of `chunk-fy12d89p.js` (the engine chunk)

Derived by extracting all 862 distinct `tengu_*` literals with line numbers and bucketing them.
Pretty-line offsets relative to the chunk start; the chunk is 108,162 pretty lines ≈ 4.91 MB
beautified ≈ 4.00 MB minified (roughly 0.81 × pretty).

| Lines | Region |
|---|---|
| 0–5k | process bootstrap, crash handlers, env/git snapshot block, transcript writer |
| 5k–10k | transcript chaining, session persistence, resume consistency, fork/rename |
| 10k–20k | plugins + skills sync, model-capability resolution, memdir index, review config |
| 20k–25k | team/org memory sync, image validation, quota + limits |
| 25k–30k | tool_use/tool_result pairing validation, refusal handling |
| 30k–35k | bash safety AST, auto-mode classifier, **pre/post tool hooks**, **API 529 / model fallback** |
| 35k–40k | **permission grant/deny**, git ops, `.claude/agents` parsing |
| 40k–45k | file-history snapshot/rewind, resume edge cases, dir sync upload |
| 45k–50k | teleport, worktrees, prompt-cache breakpoints, reactive compaction |
| 50k–55k | skill tool, WebFetch, subagent fanout, exit-plan-mode |
| 55k–60k | **Agent/Task tool**, skill authoring, Write tool, file-change tracking |
| 60k–65k | **shell snapshot / Bash cwd**, REPL, brief/send |
| 65k–70k | worktree ops, MCP call path, **tool_use lifecycle** (success/error/cancel/progress) |
| 70k–75k | microcompact, memory extraction, **stop hooks**, goals |
| 75k–80k | **model fallback, query loop (`tengu_api_query`), compaction driver** |
| 80k–85k | attachments, @-mentions, ultrathink keywords, hook prompt handling |
| 85k–90k | **system-prompt assembly**, context sizing, request normalization, caching |
| 90k–95k | org memory, PR guidance, ultraplan |
| 95k–100k | plugin install |
| 100k–105k | **Edit tool**, **Bash tool execution/backgrounding** |
| 105k–108k | content-block healing, tool_result pairing repair |

---

## A. Granularity — where method-level seams exist

The current manifest excises single methods by string anchor (all three splices target one method,
`mapToolResultToToolResultBlockParam`). That technique generalizes cleanly where a subsystem is a
**pure function or small class whose body contains a unique long literal**. What I saw:

**Clean method-level seams (splice today, low risk):**

- **Per-tool result formatting and validation.** The Edit validator is a plain function returning
  `{ result, behavior, message, meta, errorCode }` with the unique literal
  `String to replace not found in file.`. Same shape for Write, Glob, Grep, Todo. This is the
  family already proven.
- **Tool description generators.** Read, Glob, Grep, WebFetch each live in their own 1–5 KB chunk
  (`hx5r9amq`, `y30v0ja7`, `hdmehzg7`, `qe0j59w7`) exporting one description function with a
  `td(e) ? brief : full` branch. These are whole-*chunk* seams, not just method seams — the
  cheapest ownership wins available. **[Corrected 2026-08-31, caught by adversarial review and
  verified against the extracted chunks: "exporting one description function" is wrong. The four
  chunks export 15/3/17/4 symbols and import 2/3/10/4 other chunks respectively, carrying real
  behavior beyond descriptions (Read page-range parsing, Grep defer policy, WebFetch
  cache-TTL/prompt construction — and `q6t`, the Write freshness-suffix constant the
  `write-tool-result` splice derives). Whole-chunk ownership therefore requires an
  export-and-consumer inventory and per-export acceptance; the campaign spec §2.2 prices it
  accordingly.]**
- **Environment block.** `Primary working directory: … / Is a git repository: ${…} / Platform: …`
  is one 12-line function taking a snapshot object. Splice-sized.
- **Compaction.** The summarization prompt and the `compact_boundary` emit are separate unique
  literals; the trigger policy (`tengu_reactive_compact_triggered`, microcompact) is separately
  anchored.
- **Bash executor.** An ES class with `#`-private fields whose finalizer contains
  `Command timed out after ${…}` — a nameable unit with a narrow interface.
- **Hook dispatch.** Every event name is a unique string, and the dispatch sites are tagged by
  distinct telemetry events per phase (pre / post / post-failure / stop).
- **Control protocol.** One `switch (…) { case "control_request": … }` with literal subtype cases.
- **Permission rule matching.** `hw8qz4q5` and `8c6qx8qp` are near-dedicated chunks whose functions
  return plain decision records.

**Tangled — do not attempt method-level splices:**

- **Feature gates.** 2,179 gate names, 862 call sites in the engine chunk alone, inlined into the
  middle of conditionals. There is no seam; the only sane move is to fix the gate resolver to a
  constant table and let dead branches fall away.
- **Sandboxing.** `q4xe0m2r` interleaves the platform sandbox launchers with a vendored CEL
  evaluator and protobuf runtime in one 582 KB chunk. Reimplement behind an interface, don't splice.
- **The query loop.** `@75–80k` is a long async generator with heavy closure capture across
  retry/fallback/compaction; it is a *module* boundary, not a *method* boundary.
- **Session/transcript storage.** `d78hxkfm` is a Result-monad filesystem layer with inode-identity
  checks threaded through every call; the seam is the whole module.
- **The engine chunk's own boundary.** Cross-chunk symbols are minified per-chunk, so any splice
  reaching outside its own chunk must go through the `import{…}from"/$bunfs/root/chunk-…"` list —
  which is exactly why `deriveArgs` exists. Expect that pattern to be needed more often as splices
  move from leaf formatters into the loop.

**Recommended next splice wave, in order:** the remaining per-tool result formatters (Read, Grep,
Bash, Edit) → the tool-description chunks (whole-chunk ownership, four tiny files) → the environment
block → the compaction prompt + boundary emit → hook dispatch → permission decision functions.

## B. Denominator — what is actually in the 39.5 MB

Measured on the 34.4 MB of minified `.js` in `modules/` (the pretty file inflates by ~15%).

| Bucket | Bytes | % | How measured |
|---|---|---|---|
| **TUI / Ink / React** | 6.82 MB | **19.8%** | union of the 288 chunks importing the JSX runtime (`wk3xnwvn`) or Ink (`dxy3a77e`) |
| **Vendored libraries (dedicated chunks)** | 4.66 MB | 13.5% | 22 curated chunks, verified by literal sampling |
| **Vendored standalone assets** | 1.02 MB | 3.0% | `mermaid.min.js` 786 KB, `hljsBundle.generated.min.js` 167 KB, `chart.umd.min.js` 64 KB |
| **Vendored inside mixed chunks** | ~1.5 MB | ~4% | OTel half of `bsdtxcdc`, zod-locale/i18n bulk of `zn7e9204`, CEL/protobuf of `q4xe0m2r` |
| **Peripheral product features** | ~3.0 MB | ~9% | dedicated chunks for teleport/file-sync, cowork/teammates, self-hosted runner, bridge server, computer-use, chrome bridge, artifacts, plugin marketplace, remote-control |
| **Headless engine logic** | ~17.4 MB | **~50%** | remainder; of which `chunk-fy12d89p.js` alone is 4.0 MB |

Reading: a from-scratch headless engine does **not** face 39.5 MB. It faces roughly **4 MB of core
engine (one chunk)** plus a few hundred KB each of hooks, permissions, MCP adapter, session storage,
skills/commands, and the control protocol — call it **5–6 MB minified of genuinely load-bearing
logic**, with the rest either excluded (TUI, telemetry, updater, cloud features) or satisfied by
picking an equivalent npm dependency (zod, ajv, MCP SDK, Anthropic SDK, picomatch, highlight.js).

**Biggest vendored libraries, by chunk (exclude these first):**

| Bytes | Chunk | Library |
|---|---|---|
| 785,819 | `mermaid.min.js` | mermaid (standalone asset) |
| 589,971 | `chunk-zf9x9kff.js` | highlight.js grammars |
| 394,277 | `chunk-whwpx844.js` | `@grpc/grpc-js` + protobufjs |
| 358,815 | `chunk-2nekdxm8.js` | `@azure/msal-*` + proxy agents |
| 331,093 | `chunk-dxy3a77e.js` | Ink + yoga + React reconciler host |
| 316,546 | `chunk-25pekgrs.js` | MCP SDK + ajv |
| 289,411 | `chunk-g7yqachy.js` | node-forge |
| 267,525 | `chunk-865b79fd.js` | OTLP exporters |
| 248,953 | `chunk-4484s0rw.js` | xmldom / DOM implementation |
| 183,270 | `chunk-rhgsmj4b.js` | parse5 |
| 170,223 | `chunk-fxe5jdkd.js` | `@smithy/core` |
| 169,870 | `chunk-8n46n48n.js` | minipass / lru-cache / tar |
| 166,578 | `hljsBundle.generated.min.js` | highlight.js bundle (asset) |
| 159,240 | `chunk-92vbp1ze.js` | `@anthropic-ai/sdk` |
| 158,626 | `chunk-j0b15692.js` | google-auth-library / gaxios / qs |
| 157,327 | `chunk-0zr2cwhm.js` | xmldom sax |
| 147,741 | `chunk-05h180m3.js` | AWS Bedrock client |
| 135,004 | `chunk-gqesm3qg.js` | fs-extra + inquirer |
| 125,811 | `chunk-3kxn5jvk.js` | acorn |
| 117,672 | `chunk-kpmgf61v.js` | ajv codegen |
| 107,180 | `chunk-h5an0epa.js` | zod v4 |

Two chunks are large and *mixed*, so they cannot simply be dropped: **`chunk-bsdtxcdc.js` (809 KB)**
is the OpenTelemetry SDK *plus* the engine's shared constants (tool names, permission modes, control
schemas) — it is imported almost everywhere; and **`chunk-zn7e9204.js` (973 KB)** is zod locale
catalogs + formatjs i18n message data + the settings schema.

## Server-side boundary (cannot be recreated)

- **WebSearch** is a server-executed tool (`web_search_tool_result`); the engine only formats it.
- **The Messages API wire semantics** — streaming event order, `stop_reason`, cache-control
  breakpoints, `overloaded_error` / `prompt_too_long` shapes, token accounting — are fixed by the
  server; the engine's contribution is retry and fallback *policy* on top.
- **Token counting** via `count_tokens` is a server round-trip.
- **OAuth** (`oauth/token`, `setup-token`, `claude.ai/api`) and **telemetry ingest** (OTLP) are
  endpoints, not logic.
- **Feature gates** are the interesting hybrid: names and defaults are compiled in, but real values
  arrive in a server-delivered client-data blob (`tengu_client_data_stale_refetch`,
  `tengu_model_capability_from_client_data`) and are evaluated locally. Behavioral equivalence
  against `engine-real` therefore depends on a value the server supplies — worth pinning explicitly
  in the differential harness.
- **WebFetch** is a hybrid: fetch is local, but the summarization step is a model call.

## Notes for the harness

- The `// ==== <chunk> ====` separators in `cli.pretty.js` give a stable chunk↔line index
  (`rg -n "^// ==== "`), which makes "which chunk owns this pretty line" a one-line lookup.
- `tengu_*` literals are the best available internal labels for minified regions; the mapping above
  can be regenerated in seconds and is worth re-running on each pin bump to detect code motion.
- 60 `.md` + 97 `.md.zst` + 12 `.txt` assets in `modules/` are embedded skill/doc payloads, not
  code; exclude them from any size accounting.
