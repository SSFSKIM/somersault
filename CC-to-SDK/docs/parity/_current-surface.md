# Current Claude Code Surface + February-Delta Checklist

Captures the **current** (v2.1.x, June 2026) Claude Code capability surface and marks
which items already exist in the **February 2026** reference snapshot under
`Claude Code Src/`. Items marked `no` in Section C are the **post-February delta** —
present now, absent from the Feb source — and MUST be carried into the parity rows.

- **Live harness observation** (controller running inside current CC) is authoritative for "what current CC exposes".
- **Web docs** (`code.claude.com/docs`, June 2026) expand it.
- **Feb existence** is determined by grepping `Claude Code Src/src/` (tools dir, commands dir, targeted greps). Evidence paths are absolute.
- Method: `ls src/tools`, `ls src/commands`, targeted `grep -rIn` per capability. Tools live as `src/tools/<Name>Tool/`; slash commands as `src/commands/<name>`.

> Doc-host note: `code.claude.com/docs/en/<page>.md` is the canonical host; `docs.claude.com` / `platform.claude.com` 301/307-redirect there. Page index: `https://code.claude.com/docs/llms.txt`.

---

## Section A — Current tool inventory (built-in + extended)

Authoritative source: live harness (deferred-tool list + `system-reminder`) cross-checked against
[`tools-reference`](https://code.claude.com/docs/en/tools-reference.md). One-line purpose each.

### A.1 Always-loaded built-in tools

| Tool | Purpose |
|---|---|
| `Agent` | Spawns a subagent with its own context window to handle a task (named or forked). |
| `AskUserQuestion` | Asks multiple-choice questions to gather requirements / clarify ambiguity. |
| `Bash` | Executes shell commands; supports `run_in_background` for dev servers / watch builds. |
| `Edit` | Exact-string targeted edits to a file (read-before-edit enforced). |
| `Read` | Reads file contents (text, images, PDFs, notebooks) with line numbers. |
| `Write` | Creates or overwrites a file with full content. |
| `Glob` | Finds files by name pattern (`**` recursive); sorted by mtime, capped 100. |
| `Grep` | ripgrep-based content search; modes `files_with_matches` / `content` / `count`. |
| `Skill` | Executes a skill within the main conversation. |
| `ToolSearch` | Searches for and loads deferred tools when tool-search is enabled. |
| `Workflow` | Runs a dynamic workflow: a script orchestrating many subagents in background, returns one result. |
| `ScheduleWakeup` | Reschedules the next iteration of a self-paced `/loop` (Claude calls internally, 1 min–1 hr out). |
| `TodoWrite` | Session task checklist (disabled by default ≥ v2.1.142 in favor of Task* tools). |

### A.2 Extended / deferred tools (loaded on demand via `ToolSearch`, or feature-gated)

| Tool | Purpose |
|---|---|
| `WebFetch` | Fetches a URL, converts to markdown, runs an extraction prompt via a small fast model. |
| `WebSearch` | Runs a query against Anthropic's web-search backend; returns titles + URLs (no fetch). |
| `Monitor` | Runs a background command, streams each output line back so Claude reacts mid-conversation. |
| `LSP` | Language-server code intelligence: definitions, references, type errors, call hierarchies (needs a code-intelligence plugin). |
| `NotebookEdit` | Modifies a Jupyter notebook one cell at a time (`replace`/`insert`/`delete`). |
| `EnterWorktree` | Creates an isolated git worktree and switches into it (or switches to an existing one by `path`). |
| `ExitWorktree` | Exits a worktree session, returns to original directory. |
| `EnterPlanMode` | Switches to plan mode to design an approach before coding. |
| `ExitPlanMode` | Presents a plan for approval and exits plan mode. |
| `CronCreate` | Schedules a recurring/one-shot prompt within the current session (5-field cron). |
| `CronList` | Lists all scheduled tasks in the session. |
| `CronDelete` | Cancels a scheduled task by ID. |
| `RemoteTrigger` | Creates/updates/runs/lists **Routines** on claude.ai; backs the `/schedule` command. |
| `PushNotification` | Sends a desktop notification (+ phone push via Remote Control) for long-running / scheduled work. |
| `SendMessage` | Messages an agent-team teammate, or resumes a subagent by agent ID (agent-teams gated). |
| `TaskCreate` | Creates a task in the task list. |
| `TaskGet` | Retrieves full details for a specific task. |
| `TaskList` | Lists all tasks with current status. |
| `TaskOutput` | (Deprecated) Retrieves output from a background task; prefer `Read` on the output file. |
| `TaskStop` | Kills a running background task by ID. |
| `TaskUpdate` | Updates task status/deps/details, or deletes tasks. |
| `DesignSync` | Design-sync tool observed in live deferred-tool list (no public docs page; likely IDE/design-handoff surface). |
| `TeamCreate` | Creates an agent team with multiple teammates (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). |
| `TeamDelete` | Disbands an agent team and cleans up teammate processes (agent-teams gated). |
| `ListMcpResourcesTool` | Lists resources exposed by connected MCP servers. |
| `ReadMcpResourceTool` | Reads a specific MCP resource by URI. |
| `PowerShell` | Executes PowerShell natively (Windows default; opt-in elsewhere). |
| `WaitForMcpServers` | Waits for still-connecting MCP servers (only when tool-search disabled). |
| `ShareOnboardingGuide` | Uploads `ONBOARDING.md`, returns a share link (claude.ai subscribers). |

> The live deferred-tool list also surfaces MCP-provided tools (Gmail, Google Calendar/Drive, PayPal, Stripe, Cloudflare suite). Those are **MCP connector tools**, not built-in CC tools — out of scope for the built-in inventory.

### A.3 Built-in subagent types (current)

`general-purpose`, `Explore`, `Plan`, `claude` (catch-all), `claude-code-guide`, plus plugin-provided agents
(`agent-sdk-dev:*`, `feature-dev:*`, `code-simplifier`, `codex:codex-rescue`, `plugin-dev:*`, `statusline-setup`).
Feb source ships built-in agents in `src/tools/AgentTool/built-in/`: `generalPurposeAgent`, `exploreAgent`, `planAgent`, `claudeCodeGuideAgent`, `verificationAgent`, `statuslineSetup`.

---

## Section B — Current CC feature inventory (from docs)

Capability | one-line | doc URL

| Capability | One-line | Doc URL |
|---|---|---|
| Slash commands | Built-in + custom `/` commands (project `.claude/commands/`, user `~/.claude/commands/`, plugin). | https://code.claude.com/docs/en/commands.md |
| settings.json | Layered settings (managed / user / project / local) with permissions, env, hooks, model, worktree keys. | https://code.claude.com/docs/en/settings.md |
| Server-managed settings | Org-pushed managed settings users can't override. | https://code.claude.com/docs/en/server-managed-settings.md |
| Hooks (reference) | Event-driven shell/prompt hooks; command + prompt-based variants. | https://code.claude.com/docs/en/hooks.md |
| Hook events | PreToolUse, PostToolUse, Stop, SubagentStop, SessionStart, SessionEnd, UserPromptSubmit, PreCompact, Notification, **WorktreeCreate, WorktreeRemove**. | https://code.claude.com/docs/en/hooks.md |
| Subagents (custom) | Markdown-defined custom subagents with frontmatter (tools, model, `isolation: worktree`, `maxTurns`). | https://code.claude.com/docs/en/sub-agents.md |
| Agents in parallel | Run subagents / agent view / agent teams / workflows in parallel. | https://code.claude.com/docs/en/agents.md |
| Agent teams | A lead agent supervising peer Claude sessions via shared task list (experimental gate). | https://code.claude.com/docs/en/agent-teams.md |
| Agent view | Manage multiple background agents with a dedicated view. | https://code.claude.com/docs/en/agent-view.md |
| Output styles | Swap the system-prompt persona (`default`, `Explanatory`, `Learning`, custom). | https://code.claude.com/docs/en/output-styles.md |
| Skills | Reusable prompt-based workflows run through the `Skill` tool; project/user/plugin scopes. | https://code.claude.com/docs/en/skills.md |
| Plugins | Bundle commands/agents/skills/hooks/MCP/monitors; install from marketplaces. | https://code.claude.com/docs/en/plugins.md |
| Plugin marketplaces | Create/distribute and discover prebuilt plugins. | https://code.claude.com/docs/en/plugin-marketplaces.md |
| Sandboxing (Bash) | OS-level sandbox for the Bash tool (filesystem/network confinement). | https://code.claude.com/docs/en/sandboxing.md |
| Sandbox environments | Choose a sandbox environment (local / cloud). | https://code.claude.com/docs/en/sandbox-environments.md |
| Background tasks | `Bash run_in_background` + `/tasks`; Task* tools manage a task list. | https://code.claude.com/docs/en/tools-reference.md |
| Scheduled tasks (`/loop`, cron) | In-session repeat/poll/remind via `/loop` + `CronCreate/List/Delete`; 7-day expiry, session-scoped. | https://code.claude.com/docs/en/scheduled-tasks.md |
| Routines (cloud) | Saved CC config run on Anthropic cloud via schedule / API / GitHub triggers; `/schedule` CLI. | https://code.claude.com/docs/en/routines.md |
| Desktop scheduled tasks | Local recurring tasks scheduled from the Desktop app. | https://code.claude.com/docs/en/desktop-scheduled-tasks.md |
| Git worktrees | `--worktree`/`-w` flag + `EnterWorktree`/`ExitWorktree`; `.worktreeinclude`, `worktree.baseRef`, subagent `isolation: worktree`. | https://code.claude.com/docs/en/worktrees.md |
| Checkpointing / rewind | Auto file checkpoints per prompt; `/rewind` or `Esc Esc` to restore code/conversation or summarize. | https://code.claude.com/docs/en/checkpointing.md |
| Plan mode | Design-before-code mode (`EnterPlanMode`/`ExitPlanMode`); permission mode `plan`. | https://code.claude.com/docs/en/permission-modes.md |
| Ultraplan | Plan in the cloud. | https://code.claude.com/docs/en/ultraplan.md |
| Workflows (dynamic) | JS script orchestrating dozens–hundreds of subagents in background; `Workflow` tool; `ultracode` keyword; bundled `/deep-research`. | https://code.claude.com/docs/en/workflows.md |
| Goal (`/goal`) | Set a completion condition; Claude keeps working across turns until a fast-model evaluator confirms it. | https://code.claude.com/docs/en/goal.md |
| Channels | MCP-server-pushed events into a running session (Telegram/Discord/iMessage/webhook); `--channels`. | https://code.claude.com/docs/en/channels.md |
| Fast mode | `/fast` toggle: ~2.5x faster Opus at higher per-token cost (`fastMode` setting). | https://code.claude.com/docs/en/fast-mode.md |
| Remote control | Drive a local session from claude.ai / mobile app. | https://code.claude.com/docs/en/remote-control.md |
| MCP | stdio / SSE / HTTP / SDK / claude.ai connectors; managed MCP; tool search. | https://code.claude.com/docs/en/mcp.md |
| Memory (CLAUDE.md) | Layered `CLAUDE.md` project/user memory + auto-memory recall. | https://code.claude.com/docs/en/memory.md |
| Permission modes | `default`, `acceptEdits`, `bypassPermissions`, `plan`, `auto` (+ SDK `dontAsk`). | https://code.claude.com/docs/en/permission-modes.md |
| Auto mode | Auto-approve tool calls within a turn. | https://code.claude.com/docs/en/auto-mode-config.md |
| Statusline | Custom status line script. | https://code.claude.com/docs/en/statusline.md |
| Keybindings | Customize keyboard shortcuts (`~/.claude/keybindings.json`). | https://code.claude.com/docs/en/keybindings.md |
| Voice dictation | Voice input. | https://code.claude.com/docs/en/voice-dictation.md |
| Advisor | API-side server tool to escalate hard decisions (no referenceable tool name). | https://code.claude.com/docs/en/advisor.md |
| Sessions / fork | Name, resume, switch, branch (`--fork-session`). | https://code.claude.com/docs/en/sessions.md |
| CC on the web | Run tasks in a fresh cloud sandbox cloned from GitHub. | https://code.claude.com/docs/en/claude-code-on-the-web.md |
| Slack / Chrome / Desktop / IDE | Surface integrations. | https://code.claude.com/docs/en/slack.md |
| Deep links | Launch sessions from links. | https://code.claude.com/docs/en/deep-links.md |

---

## Section C — Delta checklist (the post-February delta)

`exists in Feb source?` = `yes` / `no` / `unknown`, with absolute-path evidence. `candidate verdict bucket`
uses the methodology taxonomy (`provided` ✅ / `configurable` 🔧 / `build` 🏗 / `not-possible` 🚫 / `unknown` ❔).

> **Rule:** every `no` row is a post-Feb capability and is a reconciliation must-carry.

| Capability | Exists in Feb source? | Evidence (file path / grep result) | Candidate verdict bucket |
|---|---|---|---|
| `Agent` tool | yes | `src/tools/AgentTool/` | provided |
| `AskUserQuestion` tool | yes | `src/tools/AskUserQuestionTool/` | provided |
| `Bash` tool | yes | `src/tools/BashTool/` | provided |
| `Edit` tool | yes | `src/tools/FileEditTool/` | provided |
| `Read` tool | yes | `src/tools/FileReadTool/` | provided |
| `Write` tool | yes | `src/tools/FileWriteTool/` | provided |
| `Glob` tool | yes | `src/tools/GlobTool/` | provided |
| `Grep` tool | yes | `src/tools/GrepTool/` | provided |
| `Skill` tool | yes | `src/tools/SkillTool/` | provided |
| `ToolSearch` tool | yes | `src/tools/ToolSearchTool/` | provided |
| `Workflow` tool | yes | `src/tools/WorkflowTool/`; `src/tasks/LocalWorkflowTask/` | provided |
| `TodoWrite` tool | yes | `src/tools/TodoWriteTool/` | provided |
| `ScheduleWakeup` tool (named loop-reschedule tool) | no | grep `ScheduleWakeup` → only a comment in `src/services/tools/StreamingToolExecutor.ts:50` ("wake up getRemainingResults"); no `ScheduleWakeupTool` dir | build |
| `WebFetch` tool | yes | `src/tools/WebFetchTool/` | provided |
| `WebSearch` tool | yes | `src/tools/WebSearchTool/` | provided |
| `Monitor` tool | yes | `src/tools/MonitorTool/MonitorTool.ts` | provided |
| `LSP` tool | yes | `src/tools/LSPTool/` | provided |
| `NotebookEdit` tool | yes | `src/tools/NotebookEditTool/` | provided |
| `EnterWorktree` / `ExitWorktree` tools | yes | `src/tools/EnterWorktreeTool/`, `src/tools/ExitWorktreeTool/` | provided |
| `EnterPlanMode` / `ExitPlanMode` tools | yes | `src/tools/EnterPlanModeTool/`, `src/tools/ExitPlanModeTool/` (incl. `ExitPlanModeV2Tool.ts`) | provided |
| `CronCreate`/`CronList`/`CronDelete` tools | yes | `src/tools/ScheduleCronTool/{CronCreateTool,CronListTool,CronDeleteTool}.ts` | provided |
| `RemoteTrigger` tool (routines backing) | yes | `src/tools/RemoteTriggerTool/` | provided |
| `PushNotification` tool | yes | `src/tools/PushNotificationTool/`; gated `feature('KAIROS')` in `src/tools.ts:45` | provided |
| `SendMessage` tool | yes | `src/tools/SendMessageTool/` | provided |
| `TaskCreate/Get/List/Output/Stop/Update` tools | yes | `src/tools/{TaskCreateTool,TaskGetTool,TaskListTool,TaskOutputTool,TaskStopTool,TaskUpdateTool}/` | provided |
| `TeamCreate` / `TeamDelete` tools | yes | `src/tools/TeamCreateTool/`, `src/tools/TeamDeleteTool/`; `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | provided |
| `DesignSync` tool | no | grep `designsync`/`DesignSync` → 0 hits anywhere in `src/` | unknown |
| `PowerShell` tool | yes | `src/tools/PowerShellTool/` | provided |
| `ListMcpResourcesTool` / `ReadMcpResourceTool` | yes | `src/tools/ListMcpResourcesTool/`, `src/tools/ReadMcpResourceTool/` | provided |
| Slash commands (custom) | yes | `src/commands/` (dozens of `.ts`/`.tsx` + dirs) | configurable |
| settings.json | yes | `src/tools/ConfigTool/supportedSettings.ts` | configurable |
| Server-managed settings | yes | managed-settings handling in `src/tools/ConfigTool/`, `src/bootstrap/` | provided |
| Hooks (PreToolUse … Notification) | yes | `src/hooks/`, `src/utils/hooks/`, `src/commands/hooks/` | provided |
| Hook events `WorktreeCreate`/`WorktreeRemove` | unknown | worktree infra exists (`EnterWorktreeTool/`, `commands/.../worktree`); the specific *hook events* not separately confirmed by grep — verify | unknown |
| Subagents (custom, frontmatter) | yes | `src/tools/AgentTool/loadAgentsDir.ts`, `runAgent.ts`, `prompt.ts`; `src/commands/agents/` | provided |
| Agent teams | yes | `src/tools/TeamCreateTool/`, `src/coordinator/coordinatorMode.ts`, `src/commands/peers/` | provided |
| Agent view | unknown | `agentView`/`AgentView` grep → 0 hits; background-agent infra exists (`tasks/RemoteAgentTask/`) but no named "agent view" surface | unknown |
| Output styles (default/Explanatory/Learning) | yes | `src/constants/outputStyles.ts`; `src/outputStyles/`; `src/commands/output-style/` | configurable |
| Skills system | yes | `src/skills/`, `src/tools/SkillTool/`, `src/tools/DiscoverSkillsTool/`, `src/commands/skills/` | provided |
| Plugins | yes | `src/plugins/`, `src/types/plugin.ts`, `src/commands/plugin/` | provided |
| Plugin marketplaces | yes | grep `marketplace` → `src/plugins/builtinPlugins.ts`, `src/types/plugin.ts`, `src/commands/plugin/` | provided |
| Sandboxing (Bash) | yes | `src/commands/sandbox-toggle/`, `src/commands/init.ts` | provided |
| Background tasks (`run_in_background`, `/tasks`) | yes | `src/commands/tasks/`, `src/tasks.ts`, `src/tasks/LocalShellTask/` | provided |
| Scheduled tasks (`/loop` + cron) | yes | `src/tools/ScheduleCronTool/`; `/loop` is a bundled skill | provided |
| Routines (cloud, `/schedule`) | yes | `src/tools/RemoteTriggerTool/` backs `/schedule` (cloud routines) | provided |
| Git worktrees (`--worktree`, `.worktreeinclude`) | yes | `src/tools/EnterWorktreeTool/`, `src/setup.ts`, `src/main.tsx`, `src/tasks/LocalAgentTask/` | provided |
| Checkpointing / rewind (`/rewind`, `Esc Esc`) | yes | `src/utils/fileHistory.ts`, `src/commands/rewind/`, `src/keybindings/defaultBindings.ts` (rewind) | provided |
| Plan mode | yes | `src/tools/EnterPlanModeTool/`, `src/tools/ExitPlanModeTool/`, `src/commands/plan/` | provided |
| Ultraplan | yes | `src/commands/ultraplan.tsx`; `feature('ULTRAPLAN')` in `src/commands.ts:104` | configurable |
| Workflows (dynamic, multi-agent) | yes | `src/tools/WorkflowTool/`, `src/tasks/LocalWorkflowTask/`, `src/commands/workflows/` | provided |
| `ultracode` keyword (workflow opt-in / xhigh) | unknown | grep `ultracode`/`xhigh` → 0 hits; `ultraplan` exists but `ultracode` keyword (v2.1.154+) not found | unknown |
| Bundled `/deep-research` workflow | no | no `deep-research` command file; only a generic "deep research" mention in `src/constants/prompts.ts:382` referring to Explore agent (not the bundled workflow command) | build |
| `/goal` command (keep working toward a goal) | no | grep `/goal`/`GoalTool`/`goalCondition` → no command file, no GoalTool; only "tick/goal tag (autonomous mode auto-prompt)" comments in `src/utils/log.ts:27,35` (precursor autonomous-mode plumbing) | configurable |
| Channels (`--channels`, push events) | yes | `src/main.tsx:1635,1690`, `src/interactiveHelpers.tsx` (`isChannelsEnabled`, `--channels` allowlist) | configurable |
| Fast mode (`/fast`, `fastMode`) | yes | `src/commands/fast/fast.tsx`, `src/utils/fastMode.ts`, `src/query.ts:671` (`fastModeEnabled`) | configurable |
| Remote control (drive from web/mobile) | yes | `src/commands/{remote-env,remote-setup,teleport,mobile}/`, `src/commands.ts:76` (remoteControlServer) | build/not-possible |
| MCP (stdio/sse/http/sdk/connectors) | yes | `src/tools/MCPTool/`, `src/tools/McpAuthTool/`, `src/commands/mcp/` | provided |
| Memory (CLAUDE.md + auto-memory) | yes | `src/memdir/`, `src/commands/memory/` | configurable |
| Permission modes (default/acceptEdits/bypass/plan/auto) | yes | `src/tools/ConfigTool/supportedSettings.ts:113` (`permissions.defaultMode`) | provided |
| Auto mode | yes | auto-approve plumbing in query/permission layer; supportedSettings | provided |
| Statusline | yes | `src/commands/statusline.tsx` | configurable |
| Keybindings | yes | `src/keybindings/`, `src/commands/keybindings/` | build |
| Voice dictation | yes | `src/voice/`, `src/commands/voice/`, `src/hooks/useVoiceIntegration.tsx` | build |
| Advisor (server tool) | yes | `src/commands/advisor.ts`, `canUserConfigureAdvisor` | not-possible |
| Sessions / fork | yes | `src/commands/{fork,resume,session,share}/` | provided |
| CC on the web (cloud sandbox) | yes | `src/remote/`, `src/self-hosted-runner/`, `src/environment-runner/` | not-possible |

### Post-February delta (rows marked `no`)

These are the capabilities **present in current CC but absent from the Feb source** — the must-carry delta:

1. **`/goal` command** — keep-working-toward-a-goal; only autonomous-mode precursor comments exist in Feb (`src/utils/log.ts`), no `/goal` command or GoalTool.
2. **Bundled `/deep-research` workflow** — the shipped multi-agent research workflow command; Feb has the workflow *engine* but not this bundled command.
3. **`ScheduleWakeup` tool** — the named tool that reschedules a self-paced `/loop`; not present as a tool in Feb (only an unrelated comment).
4. **`DesignSync` tool** — observed live; zero occurrences anywhere in the Feb `src/`.

> **Caveats for the reconciliation pass (not counted in the 4 "no" rows, but worth a second look):**
> - `ultracode` keyword and `Hook events WorktreeCreate/WorktreeRemove` and `Agent view` are marked **unknown** (grep found no direct evidence, but adjacent infra exists). Resolve these empirically before finalizing — any that resolve to "no" join the delta.
> - The **Routines cloud product framing** (`/schedule` + API/GitHub triggers, claude.ai routines UI) is backed by `RemoteTriggerTool` in Feb (so "yes" at the tool level), but the *expanded trigger surface* (API `/fire` endpoint, GitHub-event triggers) is newer doc surface — treat as feb-present-tool / post-feb-surface-expansion.
> - `/goal` is bucketed `configurable` (it is a thin wrapper over a session-scoped prompt-based Stop hook, which the SDK exposes), not `build`.
