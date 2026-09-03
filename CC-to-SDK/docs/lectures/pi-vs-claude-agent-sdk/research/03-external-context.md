# External Context Report: Pi Agent Harness vs. Claude Agent SDK

Research date: 2026-09-03. Produced by a web-research subagent for the lecture at `../index.html`.
Every factual claim carries a URL. **[VERIFIED]** = fetched from a primary source (GitHub API, npm/PyPI
registry, official docs, vendor blog). **[REPORTED]** = secondary coverage or community opinion.

---

## Part 1 — Pi

### 1.1 Identity, ownership, and hard numbers

**[VERIFIED]** The repository is `earendil-works/pi`, described as "AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI." As of 2026-09-03 the GitHub API reports **101,004 stars, 12,559 forks, 172 open issues, MIT license**, created **2025-08-09**, last pushed **2026-09-02**. Source: `https://api.github.com/repos/earendil-works/pi` and https://github.com/earendil-works/pi

**[VERIFIED]** npm package `@earendil-works/pi-coding-agent`, latest **0.84.4** published 2026-08-28, MIT licensed, binary `pi`. The scope has 43 published versions starting at 0.74.0 on 2026-05-07 — the namespace migration date. Also carries a `legacy-node20` dist-tag pinned at 0.74.2. Source: `https://registry.npmjs.org/@earendil-works/pi-coding-agent`

**[VERIFIED]** Release cadence is roughly weekly-to-biweekly: v0.80.6 (2026-07-09) through v0.84.4 (2026-08-28) is 15 releases in about seven weeks. Source: `https://api.github.com/repos/earendil-works/pi/releases`

**[VERIFIED]** Pi was acquired. Mario Zechner's post "I've sold out" states he joined Earendil (founded by Armin Ronacher, Colin, and others) and brought pi with him; he is "a shareholder of Earendil and in charge of all pi decisions, along with Armin and Colin"; "pi is MIT licensed. It will stay MIT licensed." He describes a planned three-tier model — MIT core, Fair Source value-add, proprietary enterprise — none built at time of writing. https://mariozechner.at/posts/2026-04-08-ive-sold-out/

**[VERIFIED]** Rename announcement: `badlogic/pi-mono` → `earendil-works/pi`, npm scope `@earendil-works`, 0.74.0 first release from the new scope; old `@mariozechner/*` deprecated at 0.73.1. https://pi.dev/news/2026/5/7/pi-has-a-new-home

**[VERIFIED]** Earendil's public RFC site lists roadmap items: *Pi Licensing* (Discussion), *Pi Telemetry* (Implemented), *Pi Analytics* (Discussion), *New Locked Pi Install* (Discussion), *Experimental Pi Flag* (Published), *Dynamic Model Configuration In Pi* (Discussion), *Terminal Multiplexers* (Published). https://rfc.earendil.com

### 1.2 Documented feature surface (pi.dev docs)

**[VERIFIED]** Docs index groups: Start Here (Overview, Quickstart, Usage, Providers, Security, Containerization, Settings, Keybindings, Sessions, Compaction), Customization (Extensions, Skills, Prompt Templates, Themes, Pi Packages, Custom Models, Custom Providers), Reference (Session Format), Programmatic Usage (SDK, RPC Mode, JSON Event Stream Mode, TUI Components), Platform Setup, Development. https://pi.dev/docs/latest

**Extensions** — **[VERIFIED]** TypeScript modules loaded via `jiti` (no compile step), auto-discovered from `~/.pi/agent/extensions/*.ts` and `.pi/extensions/*.ts` (the latter only after project trust). `pi.on(event, handler)` across `session_start`, `before_agent_start`, `turn_start`, `message_*`, `tool_*`, `agent_end`, `session_before_compact`, `session_tree`, `input`, `model_select`, and provider-level `before_provider_headers` / `before_provider_request` / `after_provider_response`. They can register tools (TypeBox schemas, custom `renderCall`/`renderResult`), **override built-in tools by registering a matching name**, mutate the active tool set at runtime, register providers, drive UI dialogs, and control sessions (`newSession`, `fork`, `navigateTree`). https://pi.dev/docs/latest/extensions

**SDK (embedding)** — **[VERIFIED]** `createAgentSession()`, `createAgentSessionRuntime()`; classes `AgentSession`, `ModelRuntime`, `SessionManager`, `DefaultResourceLoader`; tools via `defineTool()` with TypeBox; `SessionManager.inMemory()`; `runPrintMode()`. Fully headless without the TUI. https://pi.dev/docs/latest/sdk

**RPC and JSON modes** — **[VERIFIED]** RPC: JSONL over stdin/stdout, bidirectional (`prompt`, `steer`, `abort`, `compact`, `get_state`, `get_messages`), with an extension-UI sub-protocol. https://pi.dev/docs/latest/rpc — JSON mode is one-way delta-only streaming. https://pi.dev/docs/latest/json

**Sessions** — **[VERIFIED]** JSONL under `~/.pi/agent/sessions/` keyed by cwd, stored as a **tree** (id + parentId). `/tree`, `/fork`, `/clone`, `/resume`, `/export` (HTML), `/share` (gist). https://pi.dev/docs/latest/sessions

**Compaction** — **[VERIFIED]** Triggers when `contextTokens > contextWindow - reserveTokens`; defaults `reserveTokens: 16384`, `keepRecentTokens: 20000`; manual `/compact [instructions]`; configurable/disable-able. https://pi.dev/docs/latest/compaction

**Skills** — **[VERIFIED]** `SKILL.md` + YAML frontmatter; discovered from `~/.pi/agent/skills/`, `.pi/skills/`, packages, settings, CLI. Follows the Agent Skills standard leniently (name may differ from directory) so skill repos can be shared across harnesses. https://pi.dev/docs/latest/skills

**Prompt templates** — **[VERIFIED]** Markdown files; filename → command; `$1`, `$@`, `${1:-default}`, `${@:N:L}`. https://pi.dev/docs/latest/prompt-templates

**Packages** — **[VERIFIED]** Bundle extensions/skills/prompts/themes; `pi install npm:@scope/pkg@version | git:github.com/user/repo@ref | local`; `pi` key in `package.json`; gallery keyed by the `pi-package` npm keyword. https://pi.dev/docs/latest/packages

**Providers and OAuth** — **[VERIFIED]** 40+ providers incl. Anthropic, OpenAI, Gemini, Azure OpenAI, Bedrock, Vertex, Mistral, Groq, DeepSeek, xAI, Cerebras, Cloudflare, plus Ollama/LM Studio/vLLM/llama.cpp via `models.json`. Six subscription OAuth logins via `/login`: ChatGPT Plus/Pro (Codex, "Officially endorsed by OpenAI: Codex for OSS"), Claude Pro/Max, GitHub Copilot, xAI, OpenRouter, Radius. https://pi.dev/docs/latest/providers

**Security and containerization** — **[VERIFIED]** "Pi does not include a built-in sandbox." Project trust "is not a sandbox." Mitigation is external: Gondolin micro-VM, plain Docker, OpenShell policy sandbox. https://pi.dev/docs/latest/security · https://pi.dev/docs/latest/containerization

### 1.3 Philosophy — Mario Zechner's own writing

**[VERIFIED]** "What I learned building an opinionated and minimal coding agent" (2025-11-30). https://mariozechner.at/posts/2025-11-30-pi-coding-agent/

- Governing rule: **"if I don't need it, it won't be built."**
- **No MCP:** "MCP servers are overkill for most use cases, and they come with significant context overhead." Alternative: CLI tools with READMEs — progressive disclosure.
- **No sub-agents:** "You have zero visibility into what that sub-agent does. It's a black box within a black box."
- **No plan mode:** file-based plans are shareable and versionable.
- **No to-dos:** "to-do lists generally confuse models more than they help."
- **No background bash:** "Use tmux instead."
- **No permission system:** "everybody is running in YOLO mode anyways to get any productive work done."
- **Minimal system prompt:** under 1,000 tokens; "frontier models have been RL-trained up the wazoo, so they inherently understand what a coding agent is."
- Through-line: **"Observability trumps automation."**

### 1.4 Ecosystem

**[VERIFIED]** npm search `keywords:pi-package` returns a fuzzy total of 8,966 (upper bound). Top genuine hits: `pi-mcp-adapter`, `pi-subagents`, `pi-web-access`, `pi-background-tasks`, `@plannotator/pi-extension`, `pi-lens` (LSP/linters/formatters), `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-ask-user-question`. **[REPORTED]** Blogs cite 2,143 (implicator.ai) and "5,000+" (composio) for the gallery. Check https://pi.dev/packages directly.

**[VERIFIED]** Official gallery sample: `@getpipher/pi-statusline`, `pi-web-ui`, `@trim21/personal-pi-extensions` (bwrap sandbox), `@pi-kaush/pi-tool-call-markers`, `pi-studio`, `@zhuxixi/pi-agent-board`, `@yusukeshib/pi-babysit`. https://pi.dev/packages

**[REPORTED]** Fork **OMP ("Oh My Pi")** adds LSP, DAP debugging, role-based model routing, "Hashline Edits"; claims 31 built-in tools and a Rust core. Repository not located via GitHub API; npm `oh-my-pi@0.2.0` exists. Treat as unverified. https://betterstack.com/community/guides/ai/oh-my-pi-ai-coding-agent/

**[VERIFIED]** HN reception of the philosophy post: 421 points, 173 comments. https://news.ycombinator.com/item?id=46844822

### 1.5 Criticisms people report

**[REPORTED]** HN: YOLO-by-default split opinion; "isn't anywhere on the terminal bench leaderboard anymore"; un-Googleable name; minimalism gives up subagent coordination and cross-session context. https://news.ycombinator.com/item?id=46844822

**[REPORTED]** Excluding MCP "merely relocates security concerns to the package layer" — third-party extensions run arbitrary code. https://www.implicator.ai/pi-is-not-a-claude-code-rival-it-is-a-harness-rebellion/

**[REPORTED]** "Pi: A Better AI Coding Tool, Locked Out" — Claude subscribers pay API fees on top. https://yage.ai/share/pi-coding-agent-locked-out-en-20260518.html

**[REPORTED]** Enterprise gaps: no permissions, no SSO/audit/spend caps, per-token billing spikes. https://composio.dev/content/pi-agent-vs-claude-code

---

## Part 2 — Claude Agent SDK

### 2.1 Version, cadence, repositories

**[VERIFIED]** npm `@anthropic-ai/claude-agent-sdk` latest **0.3.259** (2026-09-02), 287 versions since 0.0.4 (2025-09-27), zero runtime dependencies, Node ≥18, license "SEE LICENSE IN README.md". Near-daily cadence. Source: `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk`

**[VERIFIED]** PyPI `claude-agent-sdk` latest **0.2.152** (2026-09-02), MIT, 154 releases, deps `anyio`, `jsonschema`, `mcp`.

**[VERIFIED]** GitHub: `anthropics/claude-agent-sdk-typescript` 1,725 stars / 219 forks / 199 open issues, no license file; `anthropics/claude-agent-sdk-python` 8,027 stars / 1,254 forks.

### 2.2 Official documentation surface

**[VERIFIED]** Docs now live at **`code.claude.com/docs/en/agent-sdk/*`**. Pages: overview, quickstart, troubleshooting, examples, agent-loop, claude-code-features, sessions, session-storage, streaming-vs-single-mode, user-input, streaming-output, structured-outputs, custom-tools, mcp, tool-search, subagents, modifying-system-prompts, skills, plugins, permissions, hooks, file-checkpointing, cost-tracking, observability, todo-tracking, hosting, secure-deployment, typescript, **typescript-v2-preview (marked "removed")**, python, migration-guide. https://code.claude.com/docs/llms.txt

**[VERIFIED]** Overview positions the SDK against the Claude Code CLI, the Client SDK, and **Managed Agents** (hosted). "The SDK is available as a library for Python and TypeScript only. To drive the same agent loop from another language, run the CLI as a subprocess with the `-p` flag." https://code.claude.com/docs/en/agent-sdk/overview

**[VERIFIED] TypeScript API surface** (https://code.claude.com/docs/en/agent-sdk/typescript): `query()`, `startup()` (pre-warms the subprocess → `WarmQuery`), `tool()`, `createSdkMcpServer()`, `listSessions()`, `getSessionMessages()`, `getSessionInfo()`, `renameSession()`, `tagSession()`, `resolveSettings()` (alpha). `Options`: `systemPrompt` (string | array with `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | `{type:'preset', preset:'claude_code', append, excludeDynamicSections}`), `settingSources`, `managedSettings`, `permissionMode`, `allowedTools`/`disallowedTools`/`tools`, `canUseTool`, `hooks`, `agents`, `mcpServers`, `skills`, `plugins`, `sandbox`, `outputFormat: {type:'json_schema'}`, `thinking` + `effort`, `maxTurns`, `maxBudgetUsd`, `taskBudget` (alpha), `sessionStore`, `resume`/`continue`/`forkSession`/`resumeSessionAt`, `enableFileCheckpointing`, `spawnClaudeCodeProcess`, `betas`.

**[VERIFIED]** V2 session API **removed** in v0.2.142 (`unstable_v2_createSession`, `unstable_v2_resumeSession`, `unstable_v2_prompt`). https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md

### 2.3 Architecture facts confirmed publicly

**[VERIFIED]** Subprocess model: "The Agent SDK spawns and supervises a `claude` CLI subprocess that owns a shell, a working directory, and session files on disk… One agent session maps to one subprocess." Sizing floor: **1 GiB RAM, 5 GiB disk, 1 CPU per agent**. Limitations: no top-level session timeout, memory growth over long sessions, no per-subagent wall-clock deadline. https://code.claude.com/docs/en/agent-sdk/hosting

**[VERIFIED] — correction to a common assumption:** the SDK no longer ships a bundled `cli.js`. Changelog v0.2.113: "Changed the SDK to spawn a native Claude Code binary (via a per-platform optional dependency) instead of bundled JavaScript." "The bundled binary is pinned to the SDK package version, so updating the SDK is how you update the CLI."

**[VERIFIED]** Backends via env: `ANTHROPIC_API_KEY`; AWS Bedrock; Google Vertex; Microsoft Foundry (`ANTHROPIC_FOUNDRY_PROJECT_ID`, `ANTHROPIC_FOUNDRY_MODEL_NAME`); gateway via `ANTHROPIC_BASE_URL`.

**[VERIFIED] System-prompt ceiling.** Without `systemPrompt`: minimal tool-calling prompt only. With the `claude_code` preset: `append` is "Additions only." Fully custom string: "Default tools: Lost (unless included), Built-in safety: Must be added, Environment context: Must be provided." You can append, or replace wholesale — not surgically edit. https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts

**[VERIFIED] Multi-tenancy caveat:** `settingSources: []` is insufficient isolation — also need `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` ("Auto memory… loads into the system prompt regardless of `settingSources`"), per-tenant `CLAUDE_CONFIG_DIR` and `cwd`. https://code.claude.com/docs/en/agent-sdk/hosting

**[VERIFIED] Licensing and branding.** "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when you use it to power products…" Branding forbids calling your product "Claude Code." https://code.claude.com/docs/en/agent-sdk/overview · https://www.anthropic.com/legal/commercial-terms

**[VERIFIED]** Anthropic's framing: gather context → take action → verify work. https://claude.com/blog/building-agents-with-the-claude-agent-sdk

### 2.4 The subscription/OAuth question — unresolved conflict

1. **[VERIFIED]** SDK overview: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."* https://code.claude.com/docs/en/agent-sdk/overview
2. **[VERIFIED]** Anthropic help center (2026-09-03): credit split **paused** — "As of June 15, 2026… Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits." https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
3. **[VERIFIED, conflicting]** Pi provider docs: *"Anthropic subscription auth is active for Claude Pro/Max accounts. Third-party harness usage draws from extra usage and is billed per token, not against Claude plan limits."* https://pi.dev/docs/latest/providers

Read: (1) restricts developers shipping claude.ai login inside their product; (2) and (3) conflict on billing mechanics. State both with dates.

Timeline **[REPORTED]**: third-party OAuth rejected ~2026-01-09; hard block 2026-04-04 (OpenClaw, OpenCode); reinstated 2026-05-13 under the credit model; reversed hours before 2026-06-15 launch ("nothing changes for now"). Zed: subscriptions "subsidized agent usage at roughly 15-30x compared to API pricing." https://zed.dev/blog/anthropic-subscription-changes · https://devops.com/anthropic-hits-pause-on-claude-agent-sdk-billing-change-for-now/ · https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch

### 2.5 Community perception

**[VERIFIED] Breaking changes** in the changelog: v0.1.0 merged `customSystemPrompt`/`appendSystemPrompt` into `systemPrompt`, removed automatic inclusion of the Claude Code system prompt, stopped loading filesystem settings by default (`settingSources`); v0.2.113 native binary + `options.env` now *replaces* `process.env`; v0.2.142 removed V2 and swapped `TodoWrite` for `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`.

**[REPORTED] Criticisms:** subprocess cold-start; "if you need a deterministic response in under 500 milliseconds, the Agent SDK is not your tool" (augmentcode.com); camelCase/snake_case inconsistency; rename broke imports; three simultaneous changes on 2026-06-15. No substantial primary thread attacks the "black box" specifically — the loudest criticism is billing.

**[REPORTED] Praise:** built-in loop quality, context management, permission model, subagents, enterprise deploy via Bedrock/Vertex/Foundry.

### 2.6 Direct comparisons

**[REPORTED]** Composio benchmark: 30 agentic tool-use tasks across eight harnesses, same model (DeepSeek V4 Flash) through Composio's MCP router. Pi **20/30 (66.7%)** vs Claude Code **16/30 (53.3%)**; avg tokens/task 558,885 vs 741,659; total cost $0.56 vs $3.12; **cost per success $0.028 vs $0.195** (~7×). "Most reviewers, including Pi advocates, still use Claude Code as their primary daily driver… while keeping Pi for cost-sensitive work, local models, and custom workflows." https://composio.dev/content/pi-agent-vs-claude-code — Caveat: commercial vendor benchmarking on its own router; directional only.

**[REPORTED]** "Pi is not a Claude Code rival, it is a harness rebellion." https://www.implicator.ai/pi-is-not-a-claude-code-rival-it-is-a-harness-rebellion/

---

## Failed fetches / unverified

- The New Stack articles on SDK credits returned newsletter shells only.
- OMP repository not found via GitHub API.
- Pi gallery package count disagrees across sources (8,966 fuzzy / 2,143 / "5,000+").
- SEO content farms deliberately excluded; one claimed "62k stars" which the GitHub API contradicts (101,004).
