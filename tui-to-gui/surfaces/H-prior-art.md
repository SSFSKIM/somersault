# Lane H — prior art: how other GUIs that host a coding agent translate the terminal's surfaces

Date: 2026-09-10. Method: web research only (WebSearch + WebFetch), five parallel survey
batches, then synthesis and spot-verification. Every claim below carries a URL and the date
read, and is marked `observed` (the source says it) or `inferred` (my reading of the source).
Where no evidence was found, the card says **not found** rather than guessing.

**cmux constraint honoured.** cmux is GPL-licensed. Everything said about it here comes from
its README prose, docs and screenshot captions. No cmux source file was opened and nothing is
reproduced from it.

**What afleet is, for the reader of this file.** A native macOS app in a Slack shape that hosts
the unmodified `claude` binary over its headless stream-json protocol: sidebar of projects and
sessions, an Activity view, a middle timeline, a right-hand tabbed panel (Thread, Agents, Files,
Source Control, Terminal, Browser, GitHub), an inline composer with mode/model/effort pickers.
Root spec: `/Users/new/developer/github/afleet/docs/doperpowers/specs/2026-09-03-afleet-workspace-design.md`
(§1 purpose, §2 vocabulary, §8 shell). Protocol gaps that bound every recommendation:
`/Users/new/developer/github/afleet/docs/tui-parity/README.md` §6.


## Products covered

Forty-one products, in five groups. Primary URL for each; all read 2026-09-10.

**Anthropic first-party** — Claude Desktop Code tab (https://code.claude.com/docs/en/desktop) · Cowork
(https://claude.com/docs/cowork/overview) · Claude Code VS Code extension
(https://code.claude.com/docs/en/vs-code) · Claude Code JetBrains plugin
(https://code.claude.com/docs/en/jetbrains) · Claude Code on the web
(https://code.claude.com/docs/en/claude-code-on-the-web) · the CLI agent view, included because it is
Anthropic's only fully-specified fleet UI (https://code.claude.com/docs/en/agent-view).

**OpenAI and GitHub** — Codex desktop app, now a surface inside the ChatGPT desktop app
(https://learn.chatgpt.com/docs/permission-modes.md) · Codex IDE extension
(https://learn.chatgpt.com/docs/codex/ide) · Codex cloud (https://learn.chatgpt.com/docs/cloud.md) ·
GitHub Copilot agent mode and the Agents window (https://code.visualstudio.com/docs/agents/run/agents-window)
· GitHub Copilot cloud agent (https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent).

**Editors, terminals and the protocol** — Agent Client Protocol v1 and v2
(https://agentclientprotocol.com) · Zed agent panel and Threads Sidebar (https://zed.dev/docs/ai/agent-panel)
· Cursor (https://cursor.com/docs/agent/overview.md) · Warp (https://docs.warp.dev) · Kiro
(https://kiro.dev/docs) · JetBrains Junie (https://junie.jetbrains.com/docs) · Windsurf Cascade, now
Devin Desktop (https://docs.windsurf.com) · Google Antigravity (https://antigravity.google/docs/home/) ·
Goose (https://goose-docs.ai/docs/guides/goose-permissions/) · GitKraken Desktop and Kepler
(https://help.gitkraken.com/gitkraken-desktop/agents/, https://www.gitkraken.com/kepler).

**Multi-session Claude Code managers, afleet's direct competitors** — Superset (https://superset.sh) ·
Conductor (https://conductor.build) · Crystal, deprecated (https://github.com/stravu/crystal) → Nimbalyst
(https://docs.nimbalyst.com) · Vibe Kanban, sunsetting (https://vibekanban.com/docs) · Claude Squad
(https://github.com/smtg-ai/claude-squad) · cmux (https://cmux.com) · Sculptor
(https://imbue.com/sculptor) · Terragon, shut down (https://github.com/terragon-labs/terragon-oss) ·
Omnara (https://github.com/omnara-ai/omnara) · Happy Coder (https://github.com/slopus/happy) · Emdash
(https://emdash.com) · Pane (https://runpane.com) · Abralo (https://abralo.com) · AgentsRoom
(https://agentsroom.dev) · FleetCode (https://github.com/built-by-as/FleetCode) · Claudia/opcode
(https://github.com/winfunc/opcode) · Xum, formerly `coder/cmux` (https://xum.coder.com).

**Standalone agent products** — Amp (https://ampcode.com/docs) · Devin (https://docs.devin.ai) · Factory
Droids (https://docs.factory.ai) · Augment Code and Cosmos (https://docs.augmentcode.com) · Cline
(https://docs.cline.bot) · Roo Code (https://roocodeinc.github.io/Roo-Code/) · Kilo Code
(https://kilo.ai/docs).

**Liveness corrections that change how this file should be read.** Crystal deprecated February 2026,
succeeded by Nimbalyst. Vibe Kanban sunsetting; Bloop shut down April 2026. Terragon shut down 9 February
2026 and open-sourced. Omnara pivoted away from Claude Code. Async (async.build) is a waitlist page, not
a product. Cubic is an AI code reviewer, not a session manager. All `[observed]` from the products' own
sites, read 2026-09-10.

**What could not be verified.** OpenAI's Codex launch post (`openai.com/index/introducing-the-codex-app/`)
returns HTTP 403 to fetchers, so its claims rest on docs and press. Thinking and reasoning *rendering* is
undocumented for Claude Desktop, claude.ai/code, Codex, Cline, Roo, Kilo, Augment and Factory — the
"not found" in card 3 is broad and real. Several comparison pages in this space are published by vendors
of competing tools, and `runpane.com/llms-full.txt` contains passages written to instruct language models
how to rank Pane; only first-party factual details were cited and every vendor ranking was ignored.

## Headline

1. **afleet is on the winning side of the field's central architectural split, and one competitor
   published the post-mortem.** Of fourteen multi-session Claude Code managers, the ones that render a
   real permission card all speak to the engine structurally — Nimbalyst on the Agent SDK with no
   `node-pty` at all, Sculptor on "streaming JSON with the control protocol enabled", Crystal via
   `--permission-prompt-tool` over a unix socket, Happy via a permission MCP server. The pty wrappers pay
   a documented tax: Claude Squad special-cases the trust prompt and ships a tmux-timeout FAQ; cmux fakes
   `tmux` with a `PATH` shim; Omnara shipped terminal-output parsing, called it "fragile and hard to
   maintain", and rewrote onto the SDK. afleet should say this out loud in its own docs, because it is the
   reason its decision cards can exist at all.
2. **But the same split carries a standing policy risk — not a live cost.** On 2026-05-14 Anthropic
   announced that Agent SDK usage on subscription plans would move to a separate capped credit billed at
   full API rates; Zed's post put the stakes plainly, saying subscriptions "previously subsidized agent
   usage at roughly 15-30x compared to API pricing" and calling it "a major cost increase" for heavy
   agent users, and Zed shipped Terminal Threads — a PTY-hosted `claude` in the thread sidebar — as its
   mitigation. **The change was then paused on 2026-06-15 and has not taken effect.** Anthropic's help
   centre article, dated 2026-06-16, says "We're pausing the changes to Claude Agent SDK usage described
   below", that "Claude Agent SDK, `claude -p`, and third-party app usage still draw from your
   subscription's usage limits", that the announced monthly credit "isn't available", and "When we have
   an update, we'll share it before anything takes effect"; Zed's June 16 update agrees — "There is no
   separate Agent SDK credit to claim, and subscription limits are unchanged"
   (https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan and
   https://zed.dev/blog/anthropic-subscription-changes, both read 2026-09-10) `[observed]`.
   So the finding for afleet is not "headless hosting is expensive today" — it is that **the commercial
   terms under which afleet hosts the binary are the vendor's to change, a revision is explicitly
   promised, and afleet has no mitigation designed**. Zed's Terminal Threads is the field's only worked
   answer: a second, non-protocol hosting path kept alongside the structured one. Whether afleet wants
   that escape hatch is an owner decision; whether it wants to be *able* to build one is an architectural
   one, and it is cheaper to keep the seam than to retrofit it. (A coordinator note frames this as the
   third such intervention this year, after a January OAuth block and a February terms-of-service change;
   neither is corroborated by the two sources above, so treat the pattern as `[unverified in this lane]`
   and the pause itself as the observed fact.)
3. **The single strongest idea found is peek-before-attach, and afleet's Activity view is one rung short
   of it.** Claude Code's own agent view opens a panel on `Space` showing the untruncated sentence the row
   cuts off, the linked PR, `waiting 3m`, and a reply box, with `↑`/`↓` between waiting sessions and `→`
   to attach — and states the design target: "Most of the time the peek panel is enough and you don't need
   to open the full transcript." Nimbalyst reaches the same answer by hovering a card to stream a live
   transcript. afleet answers permission asks in place and otherwise opens the channel; the middle rung is
   missing, and it is what keeps a fleet from degrading into N chat windows.
4. **Adopt the engine's own status vocabulary rather than minting one.** `claude agents --json` publishes
   `state` ∈ `working|blocked|done|failed|stopped`, `status` ∈ `busy|waiting|idle`, and `waitingFor` ∈
   `permission prompt | input needed | sandbox request | worker request | dialog open` (verified
   first-hand). That last enum turns "needs you" from a boolean into the five causes afleet already draws
   cards for. afleet reads these as free strings today and, per parity gap 8, writes them itself for its
   own children — so using the enumerated values costs nothing and makes afleet legible to every other
   tool on the machine.
5. **One comment mechanism should serve diffs, plans and files, and it is the highest-value composition
   in this file.** Inline comments on a diff that accumulate and bundle into the next user message — with
   the location injected for the model, "at `src/auth.ts:47`, don't catch the error here" — appear in
   claude.ai/code, Claude Desktop, Codex's review pane, VS Code's `Add Feedback`, Cline's Kanban, Factory,
   Conductor (where comments become composer attachments) and Antigravity. VS Code goes furthest: the
   agent resolves each comment and resolved comments disappear from the diff. afleet has Monaco, the Files
   and Source Control tabs, and a composer that already composes host-side text into the user frame. The
   same mechanism turns the plan card into an editable plan document.
6. **Name the three things a message typed mid-turn can mean.** VS Code, Codex, Zed, Amp, Cursor and Warp
   converged independently on distinguishing queue / steer / stop-and-send, and Augment and Roo built full
   queue panels with edit, reorder and pause. Zed states the limit that matters here: steering "is only
   available for the Zed Agent, since Zed can't detect turn boundaries for external agents" — afleet,
   reading stream-json directly, can. Roo also ships the one correctness warning in this study: "Queued
   messages act as approval for the next action", not controlled by its auto-approve settings. afleet is
   structurally safe from that, and the rule belongs in the composer's contract before someone adds the
   convenience.
7. **Where afleet already leads, and should not trade away.** Its permission card with a three-scope
   destination picker is matched only by Nimbalyst among the wrappers. Its Agents tab — a task-id-keyed
   tree with locally ticked elapsed time, per-node transcripts, and a four-state delivery model for relayed
   messages — exceeds every agent surface found. Its live thinking-token estimate is something no surveyed
   product claims. The gaps are not in fidelity; they are the peek rung, the comment mechanism, the queue
   verbs, and per-channel cost attribution — the four places the *fleet*, not the channel, needs a surface.

---

---

## Pattern card 1 — Permission prompts

### The approaches found

| # | Approach | Products |
|---|---|---|
| 1a | **Inline card in the transcript**, answered in place, three-to-four buttons | Claude Desktop Code tab, Claude Code VS Code panel, Cline/Roo/Kilo, Zed (ACP `session/request_permission`), Conductor-class wrappers |
| 1b | **A fourth-option vocabulary fixed by protocol**: `allow_once`, `allow_always`, `reject_once`, `reject_always` | Agent Client Protocol, and therefore every ACP client (Zed, Neovim, Emacs, JetBrains via ACP) |
| 1c | **Mode as a policy over a per-tool matrix**, not a flat enum | Cowork: each connector tool is `Always allow` / `Needs approval` / `Blocked`, and the mode (`Manual` / `Auto` / `Skip`) decides how the matrix is read |
| 1d | **Answer from the fleet list without opening the session** | Claude Code CLI agent view (peek panel), GitKraken Desktop Agents view, afleet Activity (already built) |
| 1e | **Edit the proposed input before approving** | Claude Code VS Code panel (edit the diff, and the model is *told* you edited it), Warp (approve / edit / reject / redirect), Cursor "Ask Every Time" (reported broken in Dec 2025) |
| 1f | **Classifier-decided auto-approval** with a named judge | Goose `Smart Approve` (an LLM `PermissionJudge`, decisions cached in `permission.yaml`), Cowork `Auto` |
| 1g | **Mode-independent approval floor** — a small class of asks that appear even in the most permissive mode | Claude Desktop (session archive: "You see the approval card in every permission mode, including Auto and Bypass permissions"); Cowork deletion protection; Warp destructive-operation confirmation |
| 1h | **Host-owned confirmation the engine cannot bypass** | Claude Code VS Code: a native Quick Pick `Execute`/`Cancel` on every `mcp__ide__executeCode`, documented as separate from `PreToolUse` hooks |
| 1i | **Sandbox instead of prompts** — reduce the ask rate rather than improve the ask | Codex CLI/IDE/app (approval policy and sandbox are two separate knobs); VS Code Copilot terminal sandbox, where "approval is only requested when a command must run outside the sandbox"; Cursor sandboxing; Sculptor containers |
| 1j | **Self-de-escalating autonomy** | Cowork `Auto`: "If Claude keeps running into blocks, it switches back to asking for your permission for each step" |
| 1k | **A second agent answers the prompt in the human's place** | Codex `Auto-review` (`approvals_reviewer = "auto_review"`, the mode is labelled `Approve for me` in the composer control and "Auto-review in settings"): fires only on escalations, shows each item as `Reviewing` / `Approved` / `Denied` / `Aborted` / `Timed out` with **a risk level and a user-authorization assessment**, has a circuit breaker (abort the turn after 3 consecutive or 10-in-50 denials), and `/approve` overrides one denial for a single retry. VS Code `Assisted permissions` — "Uses an LLM judge to assess each tool call", flagged experimental and explicitly "not a security boundary". Goose `Smart Approve` |
| 1l | **A rule engine over command text, with an explicit disclaimer** | VS Code `chat.tools.terminal.autoApprove` — a regex/subcommand map (`"mkdir": true`, `"/^git (status\|show\\b.*)$/": true`, `"del": false`), compound commands pass only if every part is `true` and none is `false`; `chat.tools.edits.autoApprove` does the same by glob (`"**/.env": false`). The docs call it "a best-effort convenience, not a security boundary", and `false` prompts rather than blocks — blocking needs a `PreToolUse` hook returning `permissionDecision: "deny"` |
| 1m | **Two-step approval separating the action from its result entering context** | VS Code URL tools: `Request approval` (contacting) and `Response approval` (adding to context), with the rule stated — "Approving a request does not approve its response". The same split appears per tool in `Chat: Manage Tool Approval`, which gives every tool two checkboxes: pre-approval ("without approval") and **post-approval ("without reviewing result")** |
| 1n | **Approval scope as an explicit three-way at the moment of asking** | VS Code: "approve a single use or grant approval for the session, workspace, or all future invocations", with the `Allow` dropdown carrying session and workspace entries, plus `Chat: Reset Tool Confirmations`; Codex app connector strings `Allow once` / `Always allow sending to this chat`, revocable at `Settings > Computer use > Manage` |
| 1o | **Granular policy per prompt category** | Codex `approval_policy = { granular = { sandbox_approval, rules, mcp_elicitations, request_permissions, skill_approval } }` — keep some categories interactive and auto-reject others; destructive MCP/app annotations always prompt regardless |

| 1p | **No permission surface at all** — the wrapper flips the engine into auto-approve and relies on a sandbox, a notification, or the TUI underneath | Sculptor (tools "auto-approved"; **Settings has no permissions section**); Terragon ("Always review agent actions" is the whole guidance); Emdash (a per-provider `Auto-approve` toggle, "Skip permission prompts for file operations"); Superset and cmux (notification only: a desktop alert plus a red or yellow indicator); Conductor (tool approval shipped **enterprise-gated**) |
| 1q | **The host replaces the engine's own tools rather than intercepting them** | Sculptor **disables the built-in `AskUserQuestion` and `ExitPlanMode` and registers its own replacements**, so Claude blocks on the tool call while Sculptor renders a native panel, and pending questions "persist across reloads and harness restarts" |
| 1r | **A side channel purpose-built to carry the ask out of the pty** | Crystal launched `claude` with `--permission-prompt-tool mcp__crystal-permissions__approve_permission` and received the ask as an MCP tool call over a unix socket; Happy runs a permission MCP server ("Claude requests permission → MCP server intercepts → Sends to mobile → Mobile responds → MCP approves/denies") |
| 1s | **Per-tool-class permission modes richer than the engine's own** | Happy `PermissionMode`: `ask`, `enabled`, `disabled`, **`ask-file-write`, `ask-bash`, `ask-file-write-bash`, `ask-tool-use`**; Omnara defaults keyed to provenance (built-in → allow, **MCP tools → ask**, custom API → allow) with `always_deny` as a mode where the model is *told* it was denied so it can route around |
| 1t | **Approval from a chat surface outside the app** | Omnara in Slack: `Permission requested for run_command` showing the command, buttons `Allow` / `Deny`, resolving to `✓ Allowed by @maya · operator` with an append-only audit trail |

**The most important comparison in this file.** Among the fourteen multi-session Claude Code managers
surveyed, **only two ship a real inline permission card, and only one has full scoping**: Nimbalyst offers
`Deny` / `Allow Once` / `Session` (the shown pattern until app close) / `Always`, where `Always` **writes the
pattern into the engine's own `.claude/settings.local.json`** and where patterns read `Bash(git:*)`,
`Edit`, `WebFetch(domain:github.com)` (https://docs.nimbalyst.com, read 2026-09-10) `[observed]`. Happy
ships a three-button card through its permission MCP server `[observed]`. Every other product either has no
card, notifies instead, or gates the feature behind an enterprise flag. afleet's built card with a
three-scope destination picker is therefore not table stakes — it is the differentiator, and it exists
because afleet answers `can_use_tool` directly instead of scraping a terminal.

Scope of an *always-allow*: Claude Code's VS Code plugin dialog uses three words afleet can reuse verbatim —
`Install for you` (user), `Install for this project` (project), `Install locally` (local) — for plugin
install scope, and a banner then asks for a restart
(https://code.claude.com/docs/en/vs-code, read 2026-09-10) `[observed]`.
Batch approval of several pending asks at once: **not found** in any product surveyed.

### Recommendation for afleet

Keep the inline card (1a) — it is already built at `App/Decisions/PermissionCardView.swift` with the
three-scope destination picker that only Anthropic's own plugin dialog matches — and add two things
prior art shows are load-bearing and afleet does not yet have.

First, **edit-before-approve on `Edit`/`Write` cards, with the model told**. The VS Code panel's
wording is the design: "If you edit the proposed content directly in the diff view before accepting,
Claude is told that you modified it so it doesn't assume the file matches its original proposal"
(https://code.claude.com/docs/en/vs-code, read 2026-09-10) `[observed]`. afleet's route already exists —
root spec §3 records that edit-before-approve is "`allow` with `updatedInput` plus the Monaco diff" —
so the missing half is the *notice to the model*, not the mechanism. Cursor's forum shows the failure
mode when the notice is skipped: edits made at the prompt were reported not to reach the executed
command (https://forum.cursor.com/t/editing-agent-terminal-commands-still-runs-the-original-command/145507,
read 2026-09-10) `[observed]`.

Second, **a mode-independent approval floor owned by afleet** (1g/1h). afleet is a host, and hosts in
this field reserve a handful of asks the engine's permission mode cannot silence: Anthropic does it for
session archival and for `mcp__ide__executeCode`. afleet's natural members are the ones the parity
inventory calls trust and consent moments that the protocol skips entirely (README §6 item 10:
workspace trust, `.mcp.json` approval, managed-settings approval) plus its own destructive actions
(remove a worktree, `/logout`'s census, *Stop everything*). Those already exist as `App/Consent/`
surfaces; the point prior art adds is to state the floor as a rule, so `bypassPermissions` never reads
as "afleet will not ask about anything."

Do **not** adopt 1c wholesale. A per-tool matrix editor is attractive, but the parity inventory's
gap 2 says the persisted-settings surface is read-mostly and there is no request that removes a rule
(README §6 item 2; root spec §7.7 `/permissions`). A matrix afleet could draw but not write would be a
lie. The honest version is Anthropic's own: `/permissions` opens a read-only rules view, and rules are
only *added* through `updatedPermissions` on an open ask — which is exactly what afleet already does.

**Not found:** batch approval anywhere; a permission-rule *editor* in any GUI in this field.

---

## Pattern card 2 — Tool activity: folding, live output, expansion levels, raw view

### The approaches found

| # | Approach | Products |
|---|---|---|
| 2a | **Whole-transcript density levels**, chosen from a dropdown | Claude Desktop Code tab `Transcript view` (`Ctrl+O` cycles): `Normal` = "Tool calls collapsed into summaries, with full text responses"; `Verbose` = "Every tool call, file read, and intermediate step Claude takes"; `Summary` = "Only Claude's final responses and the changes it made" |
| 2b | **A fold with named exceptions** | Claude Code VS Code `Focus view`: hides tool calls, results and thinking behind expandable rows, but "Claude's latest to-do list stays visible, and so does the text a pending question from Claude is asking about"; `Ctrl+Option+F`, persists across sessions, setting `focusView` |
| 2c | **Per-call collapse with a live label naming the tool currently running** | VS Code Copilot subagent rows (collapsed by default, showing the agent name and the currently executing tool: "Reading file…", "Searching codebase…"); GitHub cloud agent logs (subagent activity collapsed "with a heads-up display showing what it's working on right now") |
| 2d | **Clustering related calls plus inline previews of output** | GitHub Copilot cloud agent Agents tab: "Related tool calls are clustered to cut noise; tool outputs show inline previews; file changes use expandable diff views; each tool call has its own icon; and bash commands are displayed for transparency" |
| 2e | **Status and kind as protocol fields the client renders** | ACP `ToolCall{toolCallId, title, kind, status, content, locations, rawInput, rawOutput}`; `status` ∈ `pending|in_progress|completed|failed` where `pending` means "hasn't started running yet because the input is either streaming or awaiting approval"; `kind` ∈ `read|edit|delete|move|search|execute|think|fetch|other`; `rawInput`/`rawOutput` are the raw view, carried on every call |
| 2f | **Live terminal output as a first-class content type** | ACP `{"type":"terminal","terminalId":...}` inside a tool call; the client shows live output and "continues to display it even after the terminal is released" |
| 2g | **A separate raw/verbose surface built as a product**, not a toggle | VS Code `Agent Debug Log`: four views — `Logs` (timestamp, event type, summary; expandable to the full system prompt or a tool's input/output; flat list or **tree grouped by subagent**; filters `Discovery` / `Tool calls` / `LLM requests`), `Agent Flow Chart` (node graph of agent↔subagent interactions), `Summary` (total tool calls, token usage, error count, duration), `Cache Explorer` (side-by-side diff of consecutive model requests to find prompt-cache misses); export/import as OTLP JSON; `/troubleshoot` lets the agent answer questions about its own run |
| 2h | **Hover metadata on a command row** | VS Code: terminal command decorations show start time, duration and exit code on hover |

### Recommendation for afleet

§8.3 already specifies the fold afleet needs — clusters labelled by the engine's own `tool_use_summary`,
falling back to counts and elapsed time, expandable to one row per call. That matches 2c/2d and is the
right default. Three additions, in value order.

**Take 2b's exceptions as the design, not the fold.** The interesting part of `Focus view` is not that it
hides tool activity but that it refuses to hide two things: the current to-do list and the text a pending
question refers to. afleet's equivalent list is longer and it is already enumerable — a pending decision
card, a banner (rate limit, auth, trust), and a running task with a *Stop*. Whatever density level a user
picks, an item they must act on stays drawn. Write that as a rule so every future row inherits it. It is
also the counter to the VS Code `AskUserQuestion` bug in card 7: a fold that hides the explanation behind
a question is the same failure as a modal that covers it.

**The `pending` state in 2e is a gap in afleet's cluster rendering.** ACP makes explicit what afleet's
timeline currently blurs: a tool call awaiting approval and a tool call running are different states of the
same row. afleet draws the decision card, but the *cluster row* for that call has no distinguished state.
One glyph — awaiting you — closes it, and it is the row-level counterpart to the sidebar badge of card 9.

**Live output while a tool runs is afleet's largest missing capability, and prior art confirms it matters.**
Parity gap 1 is exactly this: "Nothing on the wire during a running tool or a thinking subagent," with the
remedy being to tail task output files and tick elapsed locally. 2f shows what the ceiling looks like when
the protocol does carry it — a live terminal inside the tool row that keeps its scrollback after the process
is released. afleet's Terminal tab is GhosttyKit, so the *rendering* half already exists; the missing half is
the plumbing the parity inventory already scoped. Prior art's contribution is the argument for priority:
every product surveyed shows something while a tool runs, and the two that show the least (Codex app, Codex
IDE) are the two with no documented folding UI at all.

Do not build 2g (an Agent Debug Log product) in v1. It is the best raw view in the field and it is a
separate application. afleet's raw view is already scoped as a per-item affordance (§8.3 "Hidden meta …
the raw view keeps them") and `RawCaptureSwitch.swift` exists. Note 2g in the backlog as the shape a
diagnostics panel would take if one is ever wanted, and note the one piece of it that is cheap and
disproportionately useful: a per-session summary of total tool calls, token usage, error count and
duration, which afleet can compute from data it already reduces.

**Not found:** any product that lets the user change the *fold level of one cluster* persistently, as
opposed to expanding it for the moment.

---

## Pattern card 3 — Thinking and reasoning display

### The approaches found

| # | Approach | Products |
|---|---|---|
| 3a | **Collapsed blocks in the transcript, with an expand-all key** | Claude Code VS Code: reasoning renders as collapsed blocks; click one to read it; `Ctrl+O` expands or collapses **every** thinking block in the session |
| 3b | **Thinking folded together with tool calls under one switch** | Amp: `amp.terminal.detailsExpandedByDefault` (default `false`) "shows thinking and tool-call details expanded", and `Alt+T` toggles it per session; Claude Code VS Code `Focus view` folds thinking with tool activity |
| 3c | **Reasoning as a control, not a display** | Codex: `/reasoning` picks effort (`low, medium, high, xhigh, max, ultra`), GPT-5.6 shipped a "thinking slider", model picker `⌃⇧M`; Factory `Tab` cycles reasoning effort; Amp `Alt+D` toggles reasoning effort, `Alt+R` toggles fast mode; VS Code model-picker hover shows a `Low`/`Medium`/`High` tier |
| 3d | **Reasoning as a private channel the product declines to show** | Codex auto-review "never [sees] hidden reasoning"; VS Code notes that "thinking tokens count toward the model's context window, even though they are not visible in the response" |
| 3e | **A graded work log rather than raw reasoning** | Devin's planner work log: accordions holding "Devin's retro of its work at each step", with 🟢/🟠/🔴 corresponding to A/B/C grades |
| 3f | **A protocol content type for thought chunks** | ACP: thinking arrives as its own session-update kind, so a client can style it distinctly rather than inferring it from text; `ToolKind` also includes `think` |

**Not found:** any product that shows a live token estimate while thinking streams; any product that
persists a per-block expansion state.

### Recommendation for afleet

afleet already exceeds every product here. §8.3 renders thinking as a collapsible "Thought for N seconds"
*with the live estimate from `system/thinking_tokens` while streaming* — 3d says the rest of the field does
not even claim that number is available, and no product surveyed shows it. Keep it, and keep the copy
"Thought for N seconds", which is the terminal's own.

One addition and one non-addition.

**Add 3a's expand-all.** A single key that opens or closes every thinking block in a channel is trivially
cheap and is the only ergonomic that repeated across products. `Ctrl+O` is taken in afleet's world; the
menu bar is the natural home (§2 notes it is largely unused).

**Do not fold thinking together with tool activity (3b).** Amp and the VS Code `Focus view` put them under
one switch because both are "detail". They are not the same thing to a user reading a transcript: tool
activity is what the agent *did* and thinking is what it *considered*, and afleet already draws them as
different row kinds. Two independent controls, or one control that keeps thinking's own disclosure state,
is the faithful reading of the terminal.

The reasoning-effort control (3c) is already afleet's effort picker (§7.7 `/effort` → `apply_flag_settings
{effortLevel}`), with the documented caveat that `max` cannot be set mid-session. Nothing to add.

---

## Pattern card 4 — Diffs, review, checkpoints and rewind

### The approaches found

| # | Approach | Products |
|---|---|---|
| 4a | **Diff as a protocol content type on the tool call** | ACP `ToolCallContent` `{"type":"diff", path, oldText (null for new files), newText}`, so the client renders it natively rather than parsing text |
| 4b | **A dedicated diff pane in the app**, file list left, changes right, opened from a `+12 -1` indicator in the timeline | Claude Desktop Code tab (`Cmd+Shift+D`), claude.ai/code (session-level `+42 -18`) |
| 4c | **A multi-buffer review tab with per-hunk accept/reject** | Zed: `Review Changes` (`ctrl-shift-r`) "opens a special multi-buffer tab with all changes" where you "accept or reject each individual change hunk, or the whole set"; `agent.single_file_review: true` puts the same keep/reject controls inline in files |
| 4d | **Native editor diff driven by an IDE bridge** | Claude Code VS Code (built-in `ide` MCP server), JetBrains plugin (`Diff tool` setting, `auto` vs `terminal`, appears only when connected to the IDE) |
| 4e | **Inline line comments on the diff that queue and bundle into the next message** | claude.ai/code and Claude Desktop: select a line, type feedback, `Enter`; "Comments queue up until you send your next message, then they're bundled with it. Claude sees "at `src/auth.ts:47`, don't catch the error here" alongside your main instruction" |
| 4f | **The agent reviews its own diff** and leaves inline comments | Claude Desktop `Review code` button in the diff toolbar; scoped to compile errors, logic errors, security and obvious bugs, explicitly not style |
| 4g | **Rewind as a three-way choice on a hovered message** | Claude Code VS Code: `Fork conversation from here`, `Rewind code to here`, `Fork conversation and rewind code` — a *different* triad from the CLI `/rewind` menu (`Restore code and conversation`, `Restore conversation`, `Restore code`, `Summarize from here`, `Summarize up to here`, `Never mind`) |
| 4h | **A checkpoint button on each message that caused edits** | Zed `Restore Checkpoint` |
| 4i | **Artifacts instead of raw diffs**: plans, walkthroughs, screenshots and browser recordings as reviewable deliverables | Antigravity (`Plan`, `Walkthrough`, `Screenshots`, `Browser Recordings`; a walkthrough is created "when it has completed task implementation" and "includes a concise summary of the changes") |
| 4j | **PR creation from the diff view** | claude.ai/code `Create PR` (full, draft, or GitHub's compose page with a generated title and description) |

One implementation note worth carrying: Anthropic's cloud diffs are "computed… from raw git blob content,
so diff drivers and `textconv` filters configured in the repository don't apply"
(https://code.claude.com/docs/en/claude-code-on-the-web, read 2026-09-10) `[observed]`. Checkpoint budget in
the VS Code panel is the 100 most recent per session, and "each file's first snapshot… the VS Code
extension uses as the baseline for its session diffs" `[observed]`.

### Recommendation for afleet

afleet already has the strongest primitive here — `structuredPatch` on `tool_use_result` and a Monaco
diff (parity §7, root spec §8.4) — and 4a confirms the field's direction: a diff is a typed content object,
not text to parse. Two additions, one of which is the single most stealable idea in this card.

**Build 4e: inline comments on a diff that bundle into the next user message.** This is Anthropic's house
pattern, present on two surfaces, and it is the only mechanism found anywhere that lets a user steer with
*location* without describing the location in prose. afleet has everything it needs: the Files tab is
Monaco, the composer already composes host-side text into the user frame (§3's v1.1 editor-context item is
literally this: "selection chips and `@path#L12-30` mentions composed by afleet into the user frame"). The
prior art says the payoff is larger than a mention: the comments accumulate against the diff and ride the
next send. It converts the Files and Source Control tabs from viewers into review surfaces, and it needs
no protocol change.

**Reconcile the rewind vocabulary (4g).** Anthropic ships two different word sets for one engine feature.
afleet's §8.5 currently offers edit-via-rewind plus *Fork from here* on refusal, and §7.7 `/rewind` does
the three-step `rewind_files` dance. The VS Code triad is the better GUI shape — three named outcomes on a
hovered message, rather than a command with a menu — and it maps exactly onto afleet's three mechanisms
(`--fork-session`, `rewind_files`, `rewind_conversation`). Use those three labels.

Do not build 4c's multi-buffer review tab: afleet's Source Control tab is explicitly not a staging surface
(root spec §3 out-of-scope: "staging and committing from Source Control"). Per-hunk accept/reject belongs
to the *permission card* for an `Edit`, which is where afleet's `updatedInput` route already sits (card 1),
not to a separate review mode.

4i (artifacts) is a genuine capability afleet lacks and cannot get from the wire: nothing in the protocol
emits a walkthrough or a browser recording. Note it in the backlog as an afleet-authored feature, not a
translation.

---

## Pattern card 5 — Subagents and parallel work

### The approaches found

| # | Approach | Products |
|---|---|---|
| 5a | **A tree or list beside a per-agent transcript** | afleet's Agents tab (§8.8); Claude Desktop `Tasks` pane ("shows the background work running inside the current session: subagents, background shell commands, and dynamic workflows… Click any entry to see its output in the **subagent pane** or stop it"); Codex `Subagents` panel |
| 5b | **Subagents as read-only peer chats** | VS Code Copilot: each subagent is a peer chat with a **lock icon** that "don't accept input"; the parent shows an indicator carrying the subagent's **model, elapsed time, and active tool call**; hidden from the tab strip unless opened from the `Chats` dropdown or the running-subagents indicator; a **draggable pill** opens parent and child side by side, deliberately distinct from the non-draggable background-activity pill |
| 5c | **Inspect but do not steer, stated as a limit** | ChatGPT Work Subagents view (read-only `Active` / `Done` lists, no per-subagent stop or steer); Amp: subagents "can't communicate with each other, you can't guide them mid-task", and "The main agent only receives their final summary rather than monitoring their step-by-step work" |
| 5d | **A collapsed tool-call row that names the tool currently running** | VS Code Copilot ("Reading file…", "Searching codebase…"); GitHub cloud agent logs (collapsed "with a heads-up display showing what it's working on right now") |
| 5e | **Named specialist agents rather than anonymous workers** | Amp (`Oracle`, `Search`, `Librarian`, `Painter`, `Read Thread`); Roo Code modes (`🪃 Orchestrator`, `💻 Code`, `🏗️ Architect`, `🪲 Debug`, `❓ Ask`); Augment Cosmos Experts; Codex built-ins `default`, `worker`, `explorer` |
| 5f | **An orchestration overlay separate from the transcript** | Factory `Mission Control` (`Ctrl+T`): "One view for everything: which feature is being built, which worker Droid is on it, what tools it's using, and how the Mission is progressing"; features grouped into milestones; you can "pause the orchestrator, describe what you are seeing in plain language, and ask it to recover" |
| 5g | **Each child is a full peer with its own URL and its own machine** | Devin managed Devins: "Each managed Devin is a full Devin, running in its own isolated virtual machine"; the parent can "Spin up managed Devins", "Message child sessions", "Monitor ACU consumption", "Put child sessions to sleep or terminate them"; "Each has its own session link, so you can inspect its work or message it directly" |
| 5h | **A shared board and mailbox on disk** | Cline Agent Teams: state at `~/.cline/data/teams/[team-name]/` holding "Task board with current tasks and status", an "Inter-agent mailbox", and a "Mission log with activity history"; "Team state persists across sessions" |
| 5i | **Per-subagent cost and token attribution** | Cline ("per-subagent stats (tool calls, tokens, cost) in the chat UI"); VS Code (hover a subagent section for its credits); Devin (ACU per managed Devin) |
| 5j | **A frontmatter switch controlling who may invoke an agent** | VS Code `user-invocable: false` (subagent-only) and `disable-model-invocation: true` (user-only); Cursor `user-invocable: false` for skills |

### Recommendation for afleet

§8.8 already specifies the richest agent surface in this survey — a tree keyed by task id with locally
ticked elapsed time, an activity line from `task_progress`, a per-node transcript authored by agent type
with model badges, per-node *Stop* / *Move to background* / *Send message* with a four-state delivery model,
and decisions mirrored onto nodes. Nothing found exceeds it. Three refinements.

**Adopt 5b's honesty about what a child chat is.** afleet's *Send message* is a relay through the main
agent's `SendMessage` tool with delivery states — which is exactly right, because there is no
host-initiated resume. VS Code's lock icon is the visual form of the same fact and afleet's tree has no
equivalent: a node's transcript looks like a channel, so a user will try to type into it. A lock, or the
absence of a composer plus one line saying the only route is a relay, closes that gap before it opens.

**Take 5i: per-agent cost.** Three independent products attribute cost to a subagent, and the VS Code
`/usage` breakdown names "subagent-heavy or highly parallel sessions" as a top consumption category.
afleet polls `get_usage` and has the run tree; the attribution join is `task_id`. This pairs with card 11's
fleet usage pane and is the same build.

**5f is the shape of afleet's *fleet*, not its agents tab.** Factory's Mission Control is what afleet's
Activity view becomes if it grows a hierarchy: one view of which work is in flight, who holds it, and what
it is doing. Worth noting for the roadmap, not for v1 — but it is the argument for keeping Activity a
*query* (as §7.6 specifies) rather than a notification log, because a query can later group by run.

**Not found:** any product that draws parked agents (finished but holding children) as a distinct state.
afleet's parking rule in §8.8 has no prior art, which means no prior art contradicts it either.

---

## Pattern card 6 — Queueing and steering while a turn runs

### The approaches found

| # | Approach | Products |
|---|---|---|
| 6a | **A three-way send control naming the three real semantics** | VS Code Copilot: while a request runs the `Send` button becomes a dropdown — `Add to Queue` (waits until the response finishes), `Steer with Message` (yields after the current tool finishes, then processes your message), `Stop and Send` (cancels outright and sends). Default set by `chat.requestQueuing.defaultAction` (`steer` by default). **Pending messages can be dragged to reorder** |
| 6b | **A per-message override of the queue/steer default** | Codex IDE: `chatgpt.followUpQueueMode` = `queue` (hold for the next run) or `steer` (redirect the active run), and `Cmd/Ctrl+Shift+Enter` flips the behaviour for a single message |
| 6c | **A steer toggle beside the queue** | Zed: "Messages sent while the agent is in the generating state get, by default, queued"; a `Steer` toggle delivers a queued message sooner, "interrupting it at its next step (usually between a tool call and a response)"; `Send Now` (double-enter) on a queued message; queued messages can be **edited or removed** |
| 6d | **Type-and-Enter *is* the steer, with no queue widget at all** | Claude Desktop Code tab: "click the stop button to interrupt immediately, or type a correction and press Enter to send it without stopping the running action. Claude reads the correction as soon as the current action completes and adjusts before its next step" |
| 6e | **Steering as a prompt box below the log** in a cloud session | GitHub Copilot cloud agent: "Copilot implements your input after it finishes its current tool call"; each steering message consumes AI credits; `Stop session` "ends the GitHub Actions run and preserves any commits already pushed" |
| 6f | **A settings-level policy rather than a per-send choice** | Codex app: `Settings > General > Follow-up behavior` — steer the active run vs wait for the next one |
| 6g | **A side chat that does not touch the running turn** | Codex `/side` ("a temporary side chat without interrupting the main chat", `⌘⌥S`); VS Code `/btw`; Claude Code VS Code `/btw` side panel; Cursor side chats; afleet `/btw` → `side_question` |
| 6h | **Comment on an artifact without stopping execution** | Antigravity: leave feedback on an artifact "and the agent will incorporate your input without stopping its execution flow" |
| 6i | **Goal-level controls above the composer** | Codex goal mode: a progress row that "lets you pause, resume, edit, or clear the goal while ChatGPT works" |
| 6j | **Three tiers of urgency for one message** | Amp: `Enter` steers by default and "arrives after the current step"; the palette's `prompt: queue message` defers "until the agent finishes"; `Enter Enter` on a queued message "steers it sooner". `↑`/`↓` move to queued and previous messages "so you can edit them" |
| 6k | **A full queue widget with lifecycle controls** | Augment message queue: a collapsible panel above the chat input; `Enter` queues, `Cmd/Ctrl+Enter` "send[s] immediately, interrupting the current agent turn"; per-item **Edit**, **Delete**, **Reorder** (drag), **Send now**, and **Pause / Resume**; and "When a queued message hits an error, the queue automatically pauses" |
| 6l | **Queued messages as bordered cards, editable in place** | Roo Code: cards labelled `Queued Messages:`; click a card to edit, `Enter` saves, `Escape` cancels, multiple editable at once, trash icon deletes; FIFO with no reordering and no hard limit; "Queued messages remain in the queue" on error |

**The field's clearest shipped hazard sits in this family.** Roo Code documents that "Queued messages act as
approval for the next action": when a queued item is picked up, Roo proceeds with pending tool calls, file
writes or commands "even if auto-approval is disabled", and this "is not controlled by" the auto-approve
settings (https://roocodeinc.github.io/Roo-Code/features/message-queueing, read 2026-09-10) `[observed]`. A
queue that silently answers a permission prompt is a queue that can approve something the user never read.

Two products state the safety rule explicitly: stopping does **not** roll back completed edits or commands —
you restore a checkpoint instead (VS Code, https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode,
read 2026-09-10) `[observed]`; and `Stop session` preserves commits already pushed (GitHub cloud agent)
`[observed]`.

### Recommendation for afleet

afleet's queue chip is already built and already correct on the hardest point: `App/Composer/QueueChip.swift`
removes a row only when `command_lifecycle` says the id left the queue, never optimistically, because "a
cancel the engine declines would otherwise vanish a message that is still going to run." Prior art adds two
things afleet does not have.

**Adopt 6a's vocabulary on the send control.** afleet today has one send that queues when a turn is running,
plus Esc to interrupt (§8.5, §8.7). The field has converged — independently, at Microsoft, OpenAI and Zed —
on naming three distinct intents at the moment of sending: queue it, steer with it, or stop and send it.
Those are three different things a user wants and one button cannot express. afleet has all three
mechanisms already: queue is the default, "stop and send" is `interrupt` then send, and *steer* is the one
that needs a decision — the engine's queue delivers at the turn boundary, so a true mid-turn steer may not
be reachable over the wire. That is a card-level open question, not a design (see **Open**).

**Let a queued message be edited (6c/6k/6l).** Zed, Augment and Roo all allow editing a queued message;
afleet allows only cancel (`cancel_async_message`). Editing is cancel-then-resend with the text carried
into the composer, which is the same two requests afleet already makes. Augment's panel is the fullest
form and shows what else is cheap once the rows are editable: reorder, send-now, and pause the whole
queue. Pause is the one worth taking — it is the user's answer to "the agent is going wrong and I have
four messages stacked behind it."

**Write down that afleet's queue never carries approval.** Roo's hazard above is the one finding in this
file that is a correctness rule rather than a preference. afleet is structurally safe here — a queued
message is a `user` frame, a permission answer is a control response to `can_use_tool`, and the two do
not share a path — but the rule should be stated in the composer's contract so no future "send answers
the pending card too" convenience is added. Augment's auto-pause on error is the constructive version of
the same instinct: when something needs the user, the queue stops rather than pushing past it.

Do not build 6f (a settings-level follow-up policy). Codex has it because its composer has no room for a
dropdown; afleet's composer has the room, and a per-send choice is strictly more informative than a mode.

**Open for the owner / a probe:** does the engine's `command_lifecycle` queue admit anything between
"deliver at the next turn" and "interrupt now"? If not, afleet's `Steer with Message` collapses into
`Add to Queue` and the control should offer two options, not three. The parity inventory does not record
this; it is a probe.

---

## Pattern card 7 — Plan mode, plan approval and structured questions

### The approaches found

| # | Approach | Products |
|---|---|---|
| 7a | **Plan as a permission mode** whose exit is itself a permission request | Claude Code everywhere (`Plan` in the mode selector; approving exits into the mode the chosen option names); ACP models the same thing generically — an exit-mode tool "typically requests permission via `session/request_permission` with `"kind": "switch_mode"`", offering options such as "Yes, and auto-accept all actions" (`allow_always`), "Yes, and manually accept actions" (`allow_once`), "No, stay in architect mode" (`reject_once`) |
| 7b | **The plan opens as an editable Markdown document with inline comments** | Claude Code VS Code: "VS Code automatically opens the plan as a full Markdown document where you can add inline comments to give feedback before Claude begins" |
| 7c | **A dedicated plan pane in a draggable layout** | Claude Desktop Code tab |
| 7d | **A live, structured plan the agent replaces wholesale** | ACP: `sessionUpdate: "plan"` with `PlanEntry{content, priority: high|medium|low, status: pending|in_progress|completed}`; "The Agent MUST send a complete list of all plan entries in each update" and "The Client MUST replace the current plan completely" |
| 7e | **A review policy setting that decides whether the agent stops at all** | Antigravity Settings → Agent → `Artifact Review`: `Request Review (Recommended)` — "The agent always halts and requests your explicit approval before proceeding with proposed changes" — vs `Always Proceed` — "The agent never halts for manual review and immediately proceeds with executing its plans" |
| 7f | **Named modes distinct from permission modes** | ACP example modes `ask` / `architect` / `code`; Cline's Plan/Act toggle |
| 7g | **Structured multiple-choice asks as a modal overlay** | Claude Code VS Code `AskUserQuestion`: an overlay on the transcript, footer `Submit answers / Esc to cancel` |

**7g is the field's clearest anti-pattern, documented by Anthropic's own open bugs.** The overlay cannot
be moved, resized or collapsed; the transcript cannot be scrolled while it is open; and `Esc` cancels the
question and discards the options — so the explanation the question refers to becomes unreadable at the
exact moment the user must answer it
(https://github.com/anthropics/claude-code/issues/67509 and https://github.com/anthropics/claude-code/issues/62390,
read 2026-09-10, both open with no maintainer reply) `[observed]`.

### Recommendation for afleet

afleet's plan-approval and question cards are inline timeline cards (§8.4, `App/Decisions/PlanCardView.swift`,
`QuestionCardView.swift`). That is already the right answer to 7g and it should stay: **the card is docked
in the transcript, the transcript stays scrollable, and dismissal is non-destructive.** Record the reason —
the failure mode above is a real, shipped, unfixed bug in the vendor's own GUI, and it is the strongest
available argument against ever promoting a decision card to a modal sheet.

Two upgrades from prior art.

**Open the plan in the Files tab as an editable document with inline comments (7b), while the card stays
in the timeline.** afleet has both halves already: the plan markdown arrives on the `ExitPlanMode` ask, the
Files tab is Monaco, and card 4's comment-bundling mechanism is the same mechanism. The card keeps the
three answers (*Approve*, *Approve and auto-accept edits*, *Reject with feedback*); *Reject with feedback*
gets the accumulated comments for free. This is the highest-value composition in this file: one comment
mechanism serves diffs, plans and files.

**Do not build 7d.** afleet has no wire source for a structured plan list — the engine's plan arrives as
markdown on the approval request, and the todo list is a tool result. ACP's plan schema is what a *client*
gets when the agent speaks ACP; Claude Code does not. Rendering afleet's own parse of the markdown as a
checklist would be invention, not translation. Say so in the backlog rather than leaving it as an
apparent gap.

7e (a global "never stop for review" policy) is `bypassPermissions` under another name and afleet already
gates it (§8.6). Nothing to add.

---

## Pattern card 8 — Settings for a CLI-backed engine

### The approaches found

| # | Approach | Products |
|---|---|---|
| 8a | **Two explicit tiers, stated in the docs: host settings vs engine settings** | Claude Code VS Code (`Extension settings` in VS Code's own settings vs `Claude Code settings` in `~/.claude/settings.json` shared with the CLI); Codex (`chatgpt.*` are host settings and "don't go in `config.toml`"; model, approvals, sandbox, MCP, personalization live in `~/.codex/config.toml` shared by app, CLI and IDE, with a gear that opens that file) |
| 8b | **A picker that separates which agent loop from where tools run** | VS Code `agent harness` picker (`Copilot`, `Local`, `Claude`, `Codex`, `Cloud`): "The agent harness coordinates the agent loop. The execution environment determines where tools run" |
| 8c | **A real MCP management UI over a config file** | Codex app (`Settings > MCP servers > Add server`, name + `STDIO` or `Streamable HTTP`, `Authenticate` for OAuth servers, `Restart`, `/mcp` for live status); Claude Code VS Code `/mcp` dialog (add, remove at local/user/project scope, enable/disable, reconnect, manage OAuth, status strings `Connected` / `Failed`); Cline (`Configure` tab opening the JSON, `Remote Servers` tab with name/URL/transport, enable/disable/restart/timeout/remove); Devin (`Customize → MCPs` with Personal/Organization/Enterprise scopes, `Connect`, and a **`Test listing tools`** button that "spins up an isolated test environment" to discover tools) |
| 8d | **A three-scope install/permission picker with a restart banner** | Claude Code VS Code plugins dialog: `Install for you` (user), `Install for this project` (project), `Install locally` (local); "a banner prompts you to restart Claude Code to apply them"; tabs `Plugins` (installed with toggles, available below, search filter) and `Marketplaces` (add by GitHub repo/URL/local path) |
| 8e | **Per-tool permission editors of three kinds** | Cowork per-connector-tool `Always allow` / `Needs approval` / `Blocked`; Kilo `Auto Approve` tab with `allow` / `ask` / `deny` per tool key and glob-matched MCP names; Roo Code auto-approve dropdown of tiles carrying **risk labels** (Low / Medium / Medium-High / High); VS Code `Chat: Manage Tool Approval` Quick Pick grouped by source with pre- and post-approval checkboxes |
| 8f | **Precedence written down and enforced** | Amp (`~/.config/amp/settings.json` user > `.amp/settings.json` workspace, enterprise managed overrides both, and `amp.keymap` inverts that); Augment (`deny > webhook-policy > script-policy > allow`, first match wins within a policy, strictest across policies); Factory ("Org-managed settings have top priority; local/project settings cannot weaken org policy or exceed the org maximum"); Claude Desktop (`claude_desktop_config.json` beats `.mcp.json` on a name clash; `~/.claude.json` beats `.mcp.json` for a stdio name) |
| 8g | **Delegating the decision to a program** | Amp `"action": "delegate"` with a `"to"` target on `$PATH`; Augment `webhook-policy` (HTTP endpoint replying `{"allow": true, "output": "..."}`) and `script-policy` (local script, JSON on stdin, "Exit code 0: Allow") |
| 8h | **Redirect rather than reimplement** | Claude Desktop: `/config` "opens Settings → Claude Code and ignores arguments"; `/permissions` replies "isn't available in this environment"; claude.ai/code: `/config` opens the settings section and "text after the command, including `key=value`, is ignored" |
| 8i | **Spending and iteration caps as settings** | Roo Code `Max Cost` alongside `Max Count`, with a prompt "when approaching your cost limit"; Kilo per-agent `steps` ("hard cap on agentic iterations per turn") and org per-user daily spending limits; Cline **removed** its max-requests cap in v3.35 as "adding complexity without providing meaningful value" |
| 8j | **A named permission for the agent looping on a failure** | Kilo `doom_loop`, which "defaults to `ask`", pausing when the agent repeats a failing action |

### Recommendation for afleet

This is the family where afleet's constraint bites hardest and where prior art is most useful, because the
constraint is not unique: **every product here that wraps a CLI has the same two-tier problem, and every one
of them solved it by naming the tiers rather than by hiding the seam.**

**State 8a as afleet's rule.** afleet's Settings window is app-level (C5 §9: Environment, Engine,
ConfigHome, Storage, Developer) — that is the host tier and it is right. The engine tier is
`<configHome>/settings.json` and friends, and parity gap 2 says afleet can barely write it: one key over
the protocol (`outputStyle`), `/config key=value` as text for about forty keys, and nothing for permission
rules, hooks, MCP scopes or `~/.claude.json`. Both Anthropic and OpenAI shipped the honest answer: a gear
that opens the file, plus a small number of surfaces where a real UI exists. afleet should do the same and
say which is which *in the UI*, exactly as parity gap 2's own remedy proposes ("say so in the UI").

**Build 8c, and only 8c, as a real editor.** MCP is the one settings area where every product in this
survey built a genuine UI rather than a file link, because `claude mcp add` is a documented CLI write path
and MCP servers have state (connected, failed, needs OAuth) that a file cannot show. §7.7 already routes
`/mcp` to an MCP popover from `mcp_status` with the `mcp_*` requests behind it — that is `routed-only`
today and it should become a designed surface. Take Devin's `Test listing tools` idea: a button that
proves a server works before it is trusted, which afleet can do with `RefreshMcpTools` (parity §7 lists it
as a capability with no terminal surface at all).

**Take 8d's three words for the *Always allow* destination picker.** afleet's picker already offers user,
project and local (§7.7, `App/Decisions/PermissionCardView.swift`). `Install for you` / `Install for this
project` / `Install locally` is the vendor's own phrasing of the same three scopes and is clearer than the
settings-file names.

**Do not build 8e as a matrix, for the reason in card 1** — afleet cannot remove a rule over the wire. Do
take one detail from Roo: **risk labels on whatever afleet does show.** A read-only rules view from
`get_settings` that annotates each rule with what it permits is more useful than the same list unannotated,
and it costs nothing.

**8j is worth stealing outright and has no afleet equivalent.** An agent repeating a failing action is a
real failure mode that afleet can detect host-side — the timeline reducer sees repeated identical tool
calls with error results — and the terminal has no surface for it. A notice row plus a *Stop* is a small,
GUI-only win. File it as an afleet-authored feature.

**Not found:** a hooks editor in any product (Factory has `/hooks`, Cline's hooks page is a stub, Claude
Code's `/hooks` is read-only). Parity §7 already lists "a hook editor (`/hooks` is read-only)" as a place
the GUI exceeds the terminal; prior art confirms nobody has built one, so afleet would be first.

---

## Pattern card 9 — Multi-session and fleet views

### The approaches found

| # | Approach | Products |
|---|---|---|
| 9a | **Sidebar of sessions, grouped by project**, with filters by status/project/environment | Claude Desktop Code tab (filter by status, project, or environment; group by project), claude.ai/code, Claude Code VS Code (Activity Bar spark icon list) |
| 9b | **Sidebar of sessions grouped by *state*, states ordered by urgency** | Claude Code CLI agent view: `Pinned`, `Ready for review`, `Needs input`, `Working`, `Completed`, with `Ctrl+S` switching to group-by-directory |
| 9c | **One card per git worktree**, the worktree being the unit of work | GitKraken Desktop Agents view, Conductor, Crystal, Claude Squad, Antigravity Agent Manager |
| 9d | **Kanban board**, task cards moving through columns | Vibe Kanban |
| 9e | **Tabs with attention decoration** rather than a list | cmux (blue ring on the pane, tab indicator carrying the notification text, branch, cwd, PR status, ports), Warp (per-tab state icon plus attention badge), Claude Code VS Code (tab dot: blue = permission pending, orange = finished while hidden) |
| 9f | **A notification mailbox / inbox panel** collecting cross-session notifications | Warp (bell icon, sidebar mailbox), cmux (unified panel `⌘I`, `⌘⇧U` to the latest unread, dock badge), Antigravity Agent Manager (Inbox), afleet Activity (already built) |
| 9g | **User-defined groups** over automatic grouping | Claude Code VS Code session groups, saved per workspace folder, multi-select, right-click create/move/remove, search flattens across groups |
| 9h | **Machines as first-class sidebar entities** | Claude mobile device cards for any host running `claude remote-control`; Superset groups workspaces **under hosts** with counts (`desktop`, `cloud`, `gpu-box`, `mobile`, `cli`) |
| 9i | **A board whose columns and the sidebar's groups walk the same buckets** | Superset: `List` and `Board` layouts over `Idle`, `Working`, `Needs attention`, `Needs review`, `Merged`, `Deleted`, derived from agent status × PR state — "the two views can never disagree" |
| 9j | **Lifecycle-shaped groups rather than agent-state groups** | Conductor: `backlog`, `in progress`, `in review`, `done`, each row labelled with the PR title when one exists |
| 9k | **A three-bucket accordion, the cheapest possible inbox** | Vibe Kanban: flat list or an accordion of `Needs Attention` (raised-hand icon), `Idle`, `Running`; the workspace's status is a roll-up of its sessions' |
| 9l | **A phase kanban *plus* a separate attention list** | Nimbalyst: Session Kanban (`Backlog`, `Planning`, `Implementing`, `Validating`, `Complete`) alongside an attention list grouping `Awaiting input`, `Running`, `Unread`, with **`Mark all read`** that "clears unread state without approving or answering anything" |
| 9m | **Hover a row to peek a live transcript** | Nimbalyst: hovering a kanban card "opens a live peek transcript that streams token-by-token for running sessions" |
| 9n | **Three independent status tracks on one row** | Terragon: task status (`Unread` blue dot, `Pending` yellow clock, `Running` spinner, `Complete` green check, `Error` red X), PR status (`Draft`/`Open`/`Merged`/`Closed`), CI status (`Pending`/`Success`/`Failure`) |
| 9o | **The fleet self-sorts by who needs you** | cmux `app.reorderOnNotification` bumps a notified workspace up the rail |
| 9p | **Metadata-rich rows** | cmux (branch, PR status/number, cwd, listening ports, **latest notification text**, each individually toggleable); Superset (`+46−1` diff summary, `↑N`/`↓N` ahead/behind, agent chips shown only when several run); Conductor (GitHub state — merged, failing CI, conflicts — plus "waiting on permission"); Emdash (`running · 4m`, `done · 8m ago`, PR and CI badges) |
| 9q | **Explicit contention handling** | Junie: sessions owned by another Junie process "appear dimmed and unopenable" — "This prevents two terminal UIs from controlling the same live session at the same time" |
| 9r | **Title-bar badges that filter the list** | VS Code Copilot: an unread-sessions badge and an in-progress-sessions badge, each click-to-filter |
| 9s | **Notifications split by reason, not by event** | VS Code (`notifyWindowOnResponseReceived` vs `notifyWindowOnConfirmation`, each `off` / `windowNotFocused` / `always`); Warp (`Complete` / `Request` / `Error`); Kiro (`Action Required` / `Success` / `Failure`); Happy (`Permission Requests`, `Error Alerts`, `Task Completion`, `User Input Required`); Amp — "the thread you are viewing never sends a notification" |

**A second full status vocabulary, from the wrappers.** Junie's is the cleanest four found — `Working…`,
`Awaiting input`, `Ready`, and a relative time for saved non-live sessions
(https://junie.jetbrains.com/docs/junie-cli-worktrees.html, read 2026-09-10) `[observed]`. Cursor defines
its three operationally: `ACTIVE` = "A turn is running, waiting on background work, or about to start";
`IDLE` = "The last turn finished and follow-ups are accepted"; `ARCHIVED` = "Terminal; claims end and
workspace state can be deleted" `[observed]`. Emdash derives exactly three states from installed hooks —
working, **awaiting input**, done — and its changelog carries the bug afleet will hit: "Stale
awaiting-input indicator on tab close" `[observed]`.

**How the wrappers get the status at all.** None of them read it off the transcript. Superset installs
"lifecycle hooks and command wrappers (in `~/.superset/bin`)" and says plainly that removing them
"disables those features"; Emdash "installs marker-tagged entries in the agent's user-level config" that
"silently do nothing when the agent runs outside an Emdash session"; GitKraken registers hooks on Claude
Code's lifecycle events including permission requests; Happy heartbeats `(thinking, mode)` every two
seconds; Omnara made `requires_user_input` a flag on the message itself (all read 2026-09-10)
`[observed]`. afleet gets the same facts natively from the control protocol, which is why it does not need
any of this machinery.

**Nobody uses a kanban as the live view.** Vibe Kanban — the product named for it — runs its kanban as a
separate cloud planning plane and gives the local fleet a `Needs Attention` / `Idle` / `Running` accordion
`[observed]`. Nimbalyst has a phase kanban *and* a separate attention list `[observed]`. Every product
that manages a live fleet sorts by who needs you. `[inferred]`

**Status vocabulary.** The only fully-enumerated first-party vocabulary is the CLI's, and it is machine-
readable. `claude agents --json` gives `state` ∈ `working|blocked|done|failed|stopped`, `status` ∈
`busy|waiting|idle`, and — when `status` is `waiting` — `waitingFor` ∈ `permission prompt | input needed |
sandbox request | worker request | dialog open`
(https://code.claude.com/docs/en/agent-view, read 2026-09-10, verified first-hand) `[observed]`. The docs
draw the distinction afleet's badges need: "A session that finished its turn and is waiting for your next
instruction reads `done`, not `blocked`. `blocked` always means the session needs something from you"
`[observed]`. The agent view also separates two orthogonal facts into one glyph: **colour encodes task
state** (Working animated, Needs input yellow, Idle dimmed, Completed green, Failed red, Stopped grey)
while **shape encodes process liveness** (`✻`/`✽` alive, `∙` exited — "You can still peek at the row, and
when you reply or attach, Claude restarts from where it left off", `✢` a `/loop` session sleeping) `[observed]`.
A third independent dimension rides at the right edge: PR label colour `[observed]`.

**Peek before attach.** The single strongest idea found in the whole survey. `Space` opens a peek panel
showing "the sentence the row truncates at the terminal edge" — for a blocked session the exact question
above a reply input, for a finished one its result, for a working one its full status sentence — plus
linked PRs and a `waiting 3m` line. The docs state the design target outright: "Most of the time the peek
panel is enough and you don't need to open the full transcript." `↑`/`↓` peek at adjacent sessions
without closing; `→` attaches; numbered choices are answered by pressing the number key; `Tab` fills a
suggested reply; `!` prefixes a Bash command; an undeliverable reply "is saved and sent to the session as
its next prompt when its process starts again"
(https://code.claude.com/docs/en/agent-view, read 2026-09-10) `[observed]`.

**Clearing attention.** cmux auto-dismisses only when three conditions hold at once — app focused AND the
workspace tab active AND the originating pane focused
(https://manaflow-ai-cmux.mintlify.app/features/notifications, read 2026-09-10) `[observed]`. Kilo Code's
open issue #7529 records the opposite failure: a spinner while running, nothing at all while blocked, so
"idle" and "waiting for input" look identical
(https://github.com/Kilo-Org/kilocode/issues/7529, read 2026-09-10) `[observed]`.

**Answering from the list.** GitKraken's Agents view shows a bell icon and a `Waiting for input` label on
the card and lets you "respond directly from Agent Sessions View without switching to the session"; it
gets the state by registering hooks on Claude Code's lifecycle events including permission requests, and
says only event metadata is sent (https://help.gitkraken.com/gitkraken-desktop/agents/, read 2026-09-10)
`[observed]`. Live status indicators are available for Claude Code from GitKraken 12.0.0 `[observed]`.

### Recommendation for afleet

afleet's Activity view is already the right widget and already answers plain permission asks in place
(`App/Activity/ActivityModel.swift`, `ActivityItem.card` non-nil "for exactly one shape: a plain
permission ask, still open, that does not carry `requires_user_interaction`"). Three changes from prior art.

**Adopt the engine's own status vocabulary instead of minting one.** afleet reads `status` and `waitingFor`
as free strings today (`FleetKit` `ForeignPresence`, `RegistryRecord`) and, per parity gap 8, *writes*
them itself for its own children. Both sides should use the enumerated values above. That makes "needs
you" five named causes rather than one boolean — permission prompt, input needed, sandbox request, worker
request, dialog open — which is exactly the set of decision kinds §8.4 already draws cards for, and it
makes afleet's presence records legible to `claude agents` and to every other tool that reads them.

**Add a peek layer between the Activity row and the channel.** Today Activity answers a permission ask in
place and otherwise opens the channel. The middle rung is missing: one untruncated sentence, the linked
PR, `waiting Nm`, a reply box, and `↑`/`↓` to move between waiting channels without leaving. On a Slack-
shaped window this is a popover or a preview pane, not a new region. It is the affordance that keeps a
fleet from degrading into N chat windows, and it is the reason the terminal's own fleet view works.

**Split the badge into two channels.** afleet's sidebar badges today carry unread, pending-decision count,
running, and foreign presence (§8.2). Prior art separates *task state* from *process liveness*, and afleet
has both facts already — the holder set and the registry mirror know whether a process is alive; the
timeline knows whether the turn is done. A dead-process channel that still has a result to read is a
different row from a live channel that is thinking, and one glyph can say both.

Group ordering: follow 9b's urgency order rather than 9a's alphabetical projects, at least for the
Activity view. Note that the terminal puts `Ready for review` *above* `Needs input` — reviewing finished
work is treated as more urgent than unblocking running work. That is a product call for the owner.

**Draw contention, do not just tolerate it (9q).** afleet has the hardest version of this problem —
§7.2's observed holder set, and a `contended` origin when more than one process appends to a session.
Junie's answer is the minimum viable UI for it: the row is dimmed and cannot be opened, with the reason
stated. afleet already computes the fact; the card is that the sidebar should *show* it as a state, not
only as a banner after the user has already opened the channel.

**Not found:** enumerated status words for the Claude Desktop or claude.ai/code sidebars; any product
that reorders a fleet list by predicted user value rather than by state (cmux reorders by recency of
notification, which is the closest).

---

## Pattern card 10 — Terminal integration

### The approaches found

| # | Approach | Products |
|---|---|---|
| 10a | **The GUI *is* the terminal**: the agent runs in a pty and the app adds a control plane around it | cmux (native Swift/AppKit on libghostty; workspaces, split panes, unread state, socket API), Warp, Claude Code JetBrains plugin ("runs the `claude` command in your IDE's integrated terminal and connects to it"), Claude Code VS Code with `useTerminal` |
| 10b | **A real embedded terminal beside a headless agent** | Claude Desktop Code tab (terminal pane, `` Ctrl+` ``, opens in the session working directory, `+` for a new tab, right-click a folder → `Open in terminal`; **local sessions only**), GitKraken Agents view, afleet's Terminal tab (GhosttyKit) |
| 10c | **Terminals as a protocol extension the agent drives and the client draws** | ACP: `terminal/create` (command, args, env, cwd, `outputByteLimit`) returns a `terminalId` before the command finishes; `terminal/output` returns `{output, truncated, exitStatus}`; `terminal/wait_for_exit`, `terminal/kill`, `terminal/release`; the terminal is embedded in a tool call as `{"type":"terminal","terminalId":...}` and the client "continues to display it even after the terminal is released" |
| 10d | **Hand-off out of the GUI, explicitly as a fork** | Claude Code web: `Open in > Terminal` copies `claude --teleport <session-id>`; "the terminal gets its own copy of the session: new work there stays local and doesn't appear in the cloud session"; one-way |
| 10e | **Hand-off into another surface, with a stated transaction** | Claude Desktop `Continue in` → pushes the branch, summarizes the conversation, creates the cloud session, then asks whether to archive or keep the local session; requires a clean working tree |
| 10f | **Referencing a terminal's output as context** | Claude Code VS Code `@terminal:name`; Cline `@terminal` |
| 10g | **Honest escape hatch**: commands the GUI does not implement are marked and opened in a terminal | Claude Code VS Code `/` Customize menu, where "items with a terminal icon open in the integrated terminal" |

The VS Code panel names its own weakness in the docs: "Visibility for background tasks in the extension
is limited compared to the CLI. For better visibility, have Claude output the command so you can run it in
VS Code's integrated terminal" (https://code.claude.com/docs/en/vs-code, read 2026-09-10) `[observed]`.
That is the gap afleet's Terminal tab exists to fill, stated by the vendor.

### Recommendation for afleet

afleet is already 10b and has the strongest form of it (real GhosttyKit panes, C7.1/C7.4). Two additions.

**Take 10g as a UI convention.** afleet's command router (§7.7) already intercepts the engine's refusal
text `/<name> isn't available in this environment.` and replaces it with its own explanation. Prior art
gives that explanation a home: an icon on the entry in the command list, before the user runs it, saying
this one opens a terminal. Anthropic's own GUI does exactly this rather than half-building a dialog, and
the terminal it opens is right there in the panel. That converts three of §7.7's awkward rows
(`/install-github-app`, the attach-only commands, anything in `terminal_slash_commands`) from a refusal
into an affordance.

**State the hand-off transaction (10d/10e).** §7.7 has `open in terminal` in the header menu and §8.2 has
*Attach* on background jobs. Anthropic's two hand-offs are worth copying in their honesty: `--teleport`
says plainly that the terminal gets a *copy* and new work there does not flow back; `Continue in` lists
its four steps and its precondition. afleet's *Attach* has a harder version of the same problem — the
parity inventory's contended-session case — and the copy should say which way the session moves, not just
that it moves.

**Not found:** any product that attaches a GUI to a *running* interactive TUI session and renders it as
structured rows rather than as a pty. Every product either owns the process headless or draws the pty.
That is the boundary afleet's foreign-live channels sit on, and prior art gives no precedent for it.

---

## Pattern card 11 — Context and cost display

### The approaches found

| # | Approach | Products |
|---|---|---|
| 11a | **A ring or bar near the model picker** showing context-window fill | Claude Desktop usage ring (click for session context usage *and* plan usage for the period; "plan usage is shared across all your Claude Code surfaces"), Claude Code VS Code context indicator in the prompt box, Zed ("how many tokens you are consuming for your currently active thread near the profile selector"), Cursor status bar percentage |
| 11b | **A dedicated usage dialog with attribution** | Claude Code VS Code `/usage` → `Account & usage`: usage bars for the current session and week with time-until-reset, a breakdown flagging behaviours at ≥10% of recent usage, and attribution tables per skill, subagent, plugin and MCP server, with a `Day`/`Week` toggle |
| 11c | **Compaction as a visible, inspectable timeline entry** | Zed: a `Context Compacted` entry you can open to inspect the summary; auto-compaction via `agent.auto_compact`; a banner offering `Start New Thread` for models under 80,000 tokens of context, plus `New From Summary` |
| 11d | **Automatic recovery at the limit** | Claude Desktop limit card with `Auto-continue when limits reset` — the app retries the interrupted turn once the limit resets |
| 11e | **Third-party meters spanning several agents** | Splunk `token-meter` (tray app + dashboard across Claude Code/Desktop, Codex, Cursor, OpenCode, Kiro), with per-run cost, context pressure and an optional session budget |
| 11f | **No cost figure at all**, only context | Claude Desktop, claude.ai/code (cloud sessions have "no separate compute charges") |

The VS Code `/usage` breakdown names the expensive behaviours explicitly — cache misses, long context, and
"subagent-heavy or highly parallel sessions" (https://code.claude.com/docs/en/vs-code, read 2026-09-10)
`[observed]`. That last category is a fleet app's own failure mode, named by the vendor.

### Recommendation for afleet

afleet's parity gap 13 says context and cost are poll-only but complete: `get_context_usage` after every
`result`, `get_usage` on a timer, `get_session_cost.text` parsed for the status line (README §6 item 13),
and §7 already promises "a context panel from `get_context_usage` (categories, per-tool message breakdown,
autocompact threshold) with no turn spent, better than the terminal's `/context`". Prior art says build
the second half too: **the attribution dialog (11b) at the fleet level, not the channel level.**

The reason is specific to afleet. Every product in this survey shows usage for one session, because every
product is one session at a time. afleet is the first surface where "which of my nine running channels is
eating the week's limit" is answerable, and `get_usage` is already polled globally. A `Usage` pane —
Settings window or an Activity sub-view — with a per-channel and per-subagent-type table and a Day/Week
toggle is a small build on data already collected, and it is the one place afleet can beat Anthropic's
own GUI rather than match it.

Second, **make compaction inspectable (11c)**. §8.3 renders compaction as a divider. Zed makes it an
expandable entry holding the summary. afleet has the summary — it is in the transcript — and a divider
that opens is strictly more faithful to what happened than a divider that does not.

Third, **`Auto-continue when limits reset` (11d)** is already scoped: root spec §3 lists "usage-limit
auto-continue rebuilt from `rate_limit_event.resetsAt`" as v1.1. Prior art confirms the shape and confirms
Anthropic ships it, so it should not slip further.

**Not found:** a per-turn dollar figure in any GUI in this field. Cost is shown as plan-limit consumption,
not currency, everywhere except third-party meters (11e).

---

## Pattern card 12 — Slash commands and command palettes

### The approaches found

| # | Approach | Products |
|---|---|---|
| 12a | **`/` inserts a token into the composer; arguments follow as prose** | Claude Desktop: "Select one and it appears highlighted in the input field. Type your task after it and send as usual" |
| 12b | **`/` opens a curated menu, not raw passthrough**, with a separate filterable dialog under a Customize section | Claude Code VS Code; the docs record the cost honestly — "Commands and skills: Subset (type / to see available)", "`!` bash shortcut: No", "Tab completion: No" |
| 12c | **The command list is a protocol notification the agent pushes** | ACP `available_commands_update`; `AvailableCommand{name, description, input:{hint}}` where `hint` is "A hint to display when the input hasn't been provided yet"; invocation is ordinary prompt text and the agent parses the prefix itself |
| 12d | **Picker-commands are replaced by GUI, and their arguments still work as text** | claude.ai/code: `/config` opens the settings section and "text after the command, including `key=value`, is ignored"; `/plugin` and `/resume` do not exist; `/model sonnet`, `/effort`, `/fast`, `/color`, `/rename` take arguments instead |
| 12e | **Skills and commands unified behind one `/` namespace**, with a frontmatter switch to hide model-only skills | Cursor 2.4 (`SKILL.md`, `user-invocable: false` hides a skill from slash autocomplete while keeping it available to the model); Claude Code 2026 unification of custom commands and skills |
| 12f | **A separate command palette beyond slash autocomplete** | OpenCode TUI `Ctrl+P`; VS Code Command Palette entries (`Claude Code: Toggle Focus view`, `Claude Code: Add Session Tab to Group`, `Claude Code: Mark Session as Unread`) |
| 12g | **Saved prompt templates invoked with `/`** | Antigravity Workflows |
| 12h | **Stacked invocation** | Hermes Agent: `/skill-a /skill-b do XYZ` loads both in order in one turn, with autocomplete and ghost text for the chained names |

### Recommendation for afleet

§7.7's three-class router (local, terminal-only, pass-through) is already more complete than anything
found, because it is the only design that reconciles a *GUI* command table with an *engine* command list
rather than picking one. Prior art adds three concrete things.

**Take 12d's rule as afleet's rule, and write it down: the GUI replaces the picker, and the argument form
still works.** claude.ai/code does exactly this — `/model` opens nothing but `/model sonnet` sets the
model. §7.7's table already routes `/model <name>` and the picker to the same control requests; the rule
should be stated so every future row inherits it, and so `/config key=value` (the one row where afleet
passes text through) is understood as the exception rather than the pattern.

**Take 12c's `hint` field.** afleet builds autocomplete from the handshake's `commands` list. ACP shows the
minimum a GUI needs beyond a name and description: a per-command argument hint rendered as placeholder
text. If `initialize.commands` carries argument metadata, use it; if it does not, that is a spec-defect
line worth filing (see the end of this file).

**Do not adopt 12b's subset honestly-labelled approach.** Anthropic's VS Code panel documents that its `/`
menu is a subset and that tab completion and `!` are absent. afleet already has `!` (host-side shell escape,
§8.5) and a full union table, so the subset framing is a step down. What is worth copying from 12b is the
*terminal icon* convention (card 10) for the rows afleet genuinely cannot serve.

**Not found:** any GUI that renders a slash command's *output* differently from a normal assistant turn.
Everywhere, running a command produces ordinary transcript content — which is what afleet's pass-through
class assumes.

---

## Pattern card 13 — Composer: mentions, images, history, ghost text, shortcuts

### The approaches found

| # | Approach | Products |
|---|---|---|
| 13a | **`@` for files with fuzzy matching and a line-range form** | Claude Code VS Code (`@auth` matches `auth.js`, `AuthService.ts`; trailing slash for folders; `Option+K` inserts `@app.ts#5-10` from the current editor selection); JetBrains (`Cmd+Option+K` inserts `@src/auth.ts#L1-99`); Factory (`@` fuzzy file autocomplete); Cline (`@/path/to/file`, folders need a trailing slash, multi-root `@workspace-name:/path`) |
| 13b | **A wide mention vocabulary beyond files** | Roo Code: `@problems`, `@terminal`, `@a1b2c3d` (a commit: message, author, date, full diff), `@git-changes`, `@https://…` (fetched, cleaned, converted to Markdown); Devin: `@Repos, @Files, @Macros, @Playbooks, @Skills, @Secrets, @Sessions`; Zed: "files, directories, symbols, previous threads, skills, diagnostics, branch diffs, and URLs to fetch"; Amp: `@@` searches threads, `@T-…` references a thread by id, `@`-tagging a person invites them |
| 13c | **Deliberately *not* building mention types** | Cline: no `@problems` / `@terminal` / `@url` / `@git` — "For other context — git history, web pages, terminal errors — just describe it", and Cline "will run `git log`, fetch the URL, or read the output itself" |
| 13d | **Paste turns into structured context automatically** | Zed: pasted multi-line code "automatically formats them as @-mentions with the file context", `cmd-shift-v` pastes raw; Codex: pastes over 10,000 characters auto-convert to attachments with `Show in text field` to restore |
| 13e | **Per-turn context visibility control** | Claude Code VS Code: the prompt-box footer shows how many lines are selected and clicking the indicator toggles visibility — "the eye-slash icon means hidden from Claude" |
| 13f | **Drag-and-drop with a modifier** | Codex ("drag while holding Shift", so the editor does not take the drop); Cline ("hold **Shift** while dragging files into the chat input"); Claude Code VS Code (`Shift`+drag adds attachments with an `X` to remove); Zed (drag an image from the file system directly into the message editor) |
| 13g | **Prompt history on the arrow keys** | Codex ("↑ restores the last prompt when the composer is empty"); Factory (`Up`/`Down` = input history); Amp (`Ctrl+R` prompt history, `↑`/`↓` move to queued and previous messages to edit them) |
| 13h | **A slash command that becomes an editable chip** | Devin: after selection "the command appears as a chip in the input field", and "Clicking on the chip will expand it into the full prompt template", editable before send |
| 13i | **Prompt enhancement as a button** | Augment ("Enhance Prompt ✨" rewrites a rough prompt "with codebase references and conventions" for you to review and edit; Cosmos `⌘E`, `⌘Z` restores the original) |
| 13j | **Open the prompt in `$EDITOR`** | Amp `Ctrl+G` |
| 13k | **Rebindable keys through the host's own shortcut editor** | Claude Code VS Code and Augment (VS Code Keyboard Shortcuts editor, `Cmd+K Cmd+S`); Codex app (`Settings › Keyboard Shortcuts`, searchable "by command name or by pressing the key combo", resettable); Amp (`amp.keymap`, chords, arrays to add, `null` to unbind) |
| 13l | **Send-key configurability** | Claude Code VS Code `useCtrlEnterToSend`; Codex `chatgpt.composerEnterBehavior` = `enter` / `cmdIfMultiline` / `cmdAlways`; Amp (`Enter` sends, `Ctrl+J` newline in any terminal) |
| 13m | **Voice as a first-class composer input** | Codex (dictation `⌃⇧D` with a custom dictionary, voice `⌃⇧V`); VS Code Voice Mode (push-to-talk to interrupt mid-response, "aware of your active session"); Claude Code agent view (push-to-talk into the peek reply input); Kilo voice transcription |

**Not found:** ghost-text prompt suggestions in any product except Claude Code itself (afleet's
`prompt_suggestion` route, §8.5) and Hermes Agent's chained-skill ghost text. This is a place afleet is
ahead by default, not behind.

### Recommendation for afleet

afleet's composer (§8.5, `App/Composer/`) already has `/`, `@` via `file_suggestions`, `!` host-side shell,
image paste, file drop, three pickers, the queue chip, edit-via-rewind and ghost text. Prior art's
contribution is three specific additions and one warning.

**Add 13e — per-turn context visibility.** afleet's v1.1 editor-context item (root spec §3) composes
selection chips into the user frame. The VS Code panel shows the missing half: the chip must be
*revocable in one click*, with a state that reads at a glance. This is the smallest change in this file
with the largest effect on trust, because it is the only mechanism found anywhere that lets a user see and
retract what the model is about to receive.

**Add 13h — the slash-command chip that expands into an editable template.** afleet's router already
distinguishes local, terminal-only and pass-through commands, and the pass-through class sends text. A
custom command or skill whose body is a prompt template is exactly the case Devin's chip serves: the user
picks it, sees what will actually be sent, edits it, and sends. afleet has the command list from
`initialize` and the body on disk under `<configHome>`, so the expansion is a file read.

**Consider 13b selectively, and read 13c as the counter-argument.** Roo's mention vocabulary is the widest
found and Cline explicitly rejected building it. afleet's honest middle is parity §7's own note: an `@`
picker that can add MCP resources and agents from `mcp_status` and `initialize`, "where the terminal's
unified provider is the only reference". Those two are afleet's, they come from data it already has, and
they do not duplicate something the engine will do if asked.

**The warning:** 13l shows three products making the send key configurable, and afleet has already decided
this (§8.5: Enter sends, Shift+Enter newline, Cmd+Enter also sends). Keep it. The reason is in §8.7's
panel-focus rule — afleet has a full TUI in a pane and a real editor, so keys are contended; a
user-configurable send key on top of that is a support burden the terminal never had.

---

## Pattern card 14 — What a surveyed product does that neither the terminal nor afleet's spec has

Each item names the product and the source. These are additions, not translations: nothing here is a
faithful rendering of a terminal surface, so each would be an afleet-authored feature.

| # | The thing | Product / source |
|---|---|---|
| 14a | **Peek panel with reply** — one untruncated sentence, the linked PR, `waiting Nm`, a reply box, `↑`/`↓` between waiting sessions, `→` to attach, and a recap posted on attach | Claude Code CLI agent view (https://code.claude.com/docs/en/agent-view) |
| 14b | **Inline diff comments that bundle into the next message**, with the location injected for the model | claude.ai/code and Claude Desktop; also Codex review pane gutter `+`, VS Code 1.127 `Add Feedback` gutter glyph, Cline Kanban (comments "sent back to the agent as feedback"), Factory point-and-comment, Antigravity artifact comments |
| 14c | **The agent reviews its own diff**, scoped to correctness and security, explicitly not style | Claude Desktop `Review code` button |
| 14d | **A findings sidebar with severity classes** — `Bugs` (Severe / Non-severe), `Flags` (Investigate / Informational), `Security` (Critical / Warning with CWE ids), resolved items dimmed and sorted to the bottom | Devin Review (https://docs.devin.ai/work-with-devin/devin-review.md) |
| 14e | **Confidence scoring of a task before running it**, including bulk pre-scoring of a backlog from Linear/Jira without starting sessions | Devin (🟢 🟡 🔴) |
| 14f | **A cost pill as a t-shirt size**, hover for the exact figure and job count | Devin Review ACU pill (XS–XL) |
| 14g | **Compaction as a priced, expandable audit row** showing tokens before and after, the cost, and what was carried forward | Roo Code `ContextCondenseRow` |
| 14h | **A persistent todo list re-injected into context every N messages** so intent survives compaction | Cline focus chain |
| 14i | **A staged edit to a live plan** — the user's edits apply "only when Roo processes the next todo list update", so editing never races the agent | Roo Code task todo list |
| 14j | **Per-item play buttons on a plan**, running one step, all steps, or stopping | Augment Tasklist |
| 14k | **A follow-up question with a default answer and a 1–300 s timeout**, so an unattended run unblocks itself without full auto-approve | Roo Code |
| 14l | **A reversible rewind** — a banner after reverting with `Redo` / `Redo All` and "Send a new message to make this permanent" | Kilo Code |
| 14m | **A named permission for the agent repeating a failing action** (`doom_loop`), defaulting to `ask` | Kilo Code |
| 14n | **A second agent that answers approval prompts**, with per-item status, a risk level, a circuit breaker (3 consecutive or 10-in-50 denials abort the turn) and a human one-shot override (`/approve`) | Codex auto-review |
| 14o | **Two-step approval separating an action from its result entering context** ("Approving a request does not approve its response"), and post-approval as its own checkbox | VS Code Copilot |
| 14p | **A commit trailer linking a commit back to the agent thread** (`Amp-Thread-ID`), so `git log` is navigable | Amp |
| 14q | **An activity feed with a query language** — `/feed?time=7d&q=label:bug`, `author:me archived:true` — plus Snooze (until next agent message, 8 am, or Monday) and Mark as Unread | Amp |
| 14r | **Adopting foreign sessions**: discover local sessions from other agents' CLIs, list them under an `External` filter with recency buckets, show a one-time banner, and take ownership on first message | VS Code Copilot |
| 14s | **Chat-input banners driven by external state** — `2 of 5 checks failed` → `Fix Checks` / `Reveal Checks`; comment count → `Address Comments` / `Reveal Comments` | VS Code Copilot |
| 14t | **A diagnostics product for the agent run** — event log with expandable payloads, a tree grouped by subagent, a flow chart, a summary (tool calls, tokens, errors, duration), a cache explorer diffing consecutive model requests, OTLP export, and `/troubleshoot` so the agent answers questions about its own run | VS Code Agent Debug Log |
| 14u | **Time-travel command history** — greyed-out future commands, click one to jump to that moment in the session | Devin Shell tab |
| 14v | **Non-code artifact previews beside the session** — documents, presentations, spreadsheets, PDFs, live sites | Factory App; Antigravity screenshots and browser recordings |
| 14w | **Scheduled and event-triggered agent runs** on dedicated background worktrees | Codex automations, VS Code Automations, Claude Desktop scheduled tasks, Cowork `/schedule` |
| 14x | **Deep links and copy-the-handle affordances** — `codex://threads/<id>`, `Copy working dir` / `Copy conversation path` / `Copy session ID` / `Copy deep link` | Codex app |
| 14y | **Screen-reader turn anchors** — every turn opens with a visually hidden heading naming the prompt that started it, so heading navigation is turn navigation | Claude Code VS Code |
| 14z | **A repo agent-readiness score with a remediation path** (`/readiness-report`, `/readiness-fix`) | Factory |

### Recommendation for afleet

Six of these are cheap, sit on data afleet already has, and are worth the backlog now: **14b** (the comment
mechanism that serves diffs, plans and files — see cards 4 and 7), **14a** (peek, card 9), **14g**
(compaction as an expandable row, card 11), **14m** (a doom-loop notice, card 8), **14y** (turn anchors,
which cost one accessibility attribute per row and which nobody else has), and **14p** (a commit trailer,
which afleet's Source Control tab can write and read).

Two are strategically significant and should be owner decisions rather than backlog items. **14r
(adopting foreign sessions)** is the thing afleet already does structurally — foreign live channels are a
first-class origin (§7.1) — and Microsoft's version shows the missing verb: an explicit *adopt on first
message* with a one-time banner. afleet's §7.4 lifecycle has this transition; the prior art is that it
should be *offered*, not just supported. **14n (a second agent answering approvals)** is the field's
answer to approval fatigue and afleet is unusually well placed to build it — parity §7 already lists "a
classifier-in-flight indicator (the terminal has none), a per-decision auto-mode log from
`AUTOMODE_DECISION_LOG=1`" — but it is a product and safety decision, not a technical one.

The rest are noted for completeness. **14t** is a separate application. **14e**, **14z** and **14d**
belong to products that own the whole task lifecycle; afleet hosts a binary and does not.

---

## Product × surface family

One word per cell: the approach that product takes. `—` = not found in that product's primary sources.
Columns are the fourteen families in order: 1 permissions · 2 tool activity · 3 thinking · 4 diffs ·
5 subagents · 6 queue/steer · 7 plan · 8 settings · 9 fleet · 10 terminal · 11 context/cost ·
12 commands · 13 composer · 14 beyond.

| Product | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Desktop Code | inline | levels | — | pane+comments | tasks-pane | type-to-steer | pane | redirect | filters | embedded | ring | insert-token | mentions | browser |
| Claude Code VS Code | inline | focus-view | collapsed | rewind-triad | tabs | — | document | two-tier | groups | handoff | usage-dialog | curated | redact | side-thread |
| Claude Code web | inline | — | — | comments+PR | — | send | dropdown | redirect | sidebar | teleport | ring | args | repos | autofix-PR |
| CLI agent view | peek-reply | — | — | — | — | — | — | — | state-groups | attach | — | — | dictation | peek |
| Codex app | auto-review | — | control | review-pane | panel | policy | goal | config.toml | bell-activity | embedded | status | palette | shift-drag | computer-use |
| Copilot Agents window | levels+judge | debug-log | styles | pending+checkpoint | peer-chats | three-way | agent | harness | badges | bang-prefix | popover | slash | feedback | agent-merge |
| ACP / Zed | four-kinds | statuses | thought-chunk | patch+hunks | fork | steer-toggle | plan-entries | config-options | threads | display-only | usage+bands | hint | auto-mention | follow |
| Cursor | run-modes | delegate | block | checkpoint-files | tiles | nudge | editable | customize | pinned | — | ring | modes | side-chat | best-of-n |
| Warp | edit-approve | — | — | per-file | pill-bar | panel | questions | org-tiers | mailbox | native | breakdown | toolbelt | reorder | takeover |
| Kiro | tiered-rule | — | effort | three-verbs | waves | — | specs | scoped | needs-attention | named-servers | ascii-bar | unified | chip-tab | properties |
| Junie | typed-rules | terminal | level | per-file | — | — | tabbed-doc | allowlist | four-words | terminal | — | named-args | — | debugger |
| Antigravity | policy | — | — | artifacts | subagents | comment | request-review | artifact-review | inbox | — | — | workflows | — | recordings |
| Superset | notify | — | — | tabs+PR | worktrees | — | chat-only | agents | board | pty | usage | — | rich-editor | automations |
| Conductor | enterprise | — | effort | comments→composer | tabs | editable | plan | harnesses | lifecycle | big-terminal | context | slash | pills | checks-gate |
| Nimbalyst | four-button | widgets | extended | per-edit | workstreams | — | structured-tool | engine-files | kanban+peek | ghostty | tools-report | typeahead | chips | wakeups |
| Vibe Kanban | variant | typed | — | comments-banner | worktree | queue-button | approve-card | native-config | accordion | xterm | gauge-bands | discovered | rich-text | preview |
| Claude Squad | autoyes | — | — | diff-tab | tmux | attach | — | profiles | flat | tmux | — | — | — | checkout-pause |
| cmux | notify | — | — | — | native-panes | fork | — | project-json | rail+lifecycle | libghostty | — | own-palette | — | telemetry-API |
| Sculptor | auto-approve | cards | effort | files-panel | tabs | editable | plan-toggle | harnesses | tabs+palette | user-only | pre-compact | skills | pills | extensions |
| Happy | mcp-server | — | heartbeat | git-diff | — | queue | — | precedence | push-only | mode-switch | — | — | voice | notify-CLI |
| Emdash | auto-toggle | ran-N | grouped | editable-diff | worktrees | ordered | acp-modes | library | tasks | tmux | bar | popover | drafts | browser |
| Terragon | none | stream | — | github | sandboxes | rate-aware | — | web | three-tracks | none | — | — | — | automations |
| Amp | file-rules | alt-T | alt-T | changes-pane | isolated | three-tier | — | precedence | feed+snooze | thread-URL | showCosts | palette | thread-mentions | commit-trailer |
| Devin | plan-level | progress | graded | findings | managed | side-chats | confidence | customize | sessions | shell-tab | ACU-pill | chips | playbooks | time-travel |
| Factory | autonomy-dial | ctrl-O | tab | point-comment | mission-control | — | spec-mode | org-max | sessions | bang-mode | context | full-set | history | readiness |
| Augment | play-button | expand | — | checkpoints | experts | full-queue | tasklist | scopes | pinned | approve | dashboards | palette | enhance | remote |
| Cline | auto-table | per-agent | — | shadow-git | teams | — | plan-act | marketplace | kanban | tui | progress-bar | slash | at-paths | focus-chain |
| Roo Code | tiles+risk | expand | — | two-restore | boomerang | cards | modes | per-concern | — | at-terminal | condense-row | mode-slash | widest | budget-cap |
| Kilo Code | allow-ask-deny | — | — | revert-banner | agent-manager | — | modes | jsonc | — | at-terminal | steps-cap | typeahead | mermaid | doom-loop |
| Goose | smart-approve | — | — | — | subagent-ext | — | — | modes | — | cli+gui | — | — | — | judge-cache |
| GitKraken | answer-in-list | — | — | worktree | — | — | — | hooks | cards+bell | embedded | — | — | — | agent-graph |

## Sources

Every URL below was read on **2026-09-10**. Grouped as in *Products covered*. Where a claim in a card is
load-bearing, the card repeats the URL inline.

**Anthropic** — code.claude.com/docs/en/desktop · /desktop-quickstart · /desktop-scheduled-tasks ·
/permission-modes · /checkpointing · /vs-code · /jetbrains · /claude-code-on-the-web · /web-quickstart ·
/mobile · /remote-control · /agent-view · /agents · /whats-new · /whats-new/2026-w17 ·
claude.com/docs/cowork/overview · support.claude.com/en/articles/13345190 · /13947068 ·
marketplace.visualstudio.com/items?itemName=anthropic.claude-code ·
plugins.jetbrains.com/plugin/27310-claude-code-beta- · platform.claude.com/docs/en/agent-sdk/permissions ·
github.com/anthropics/claude-code/issues/67509 · /issues/62390 · /issues/38299

**OpenAI and GitHub** — learn.chatgpt.com/docs/permission-modes.md · /sandboxing/auto-review.md ·
/agent-approvals-security.md · /permissions.md · /reference/commands.md · /reference/settings.md ·
/developer-commands.md · /developer-settings.md · /custom-prompts.md · /extend/mcp.md · /plugins.md ·
/code-review.md · /integrated-terminal.md · /image-inputs.md · /long-running-work.md · /projects ·
/notifications.md · /environments/modes.md · /environments/git-worktrees.md · /cloud.md ·
/agent-configuration/subagents.md · /codex/ide · /whats-new.md · /features.md · /third-party/github.md ·
code.visualstudio.com/docs/agents/run/approvals · /run/tools · /run/subagents · /run/agents-window ·
/run/review-code-edits · /run/planning · /run/artifacts · /run/sessions/manage-sessions ·
/run/agent-harnesses · /guides/optimize-usage · /agent-customization/mcp-servers ·
code.visualstudio.com/docs/copilot/chat/chat-agent-mode · /chat-checkpoints · /chat-debug-view ·
code.visualstudio.com/docs/chat/chat-overview · /review-code-edits ·
code.visualstudio.com/updates/v1_107 · v1_108 · v1_110 · v1_127 · v1_135 · v1_137 ·
docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent ·
/how-tos/use-copilot-agents/cloud-agent/research-plan-iterate ·
/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents ·
/how-tos/agents/copilot-coding-agent/using-the-copilot-coding-agent-logs ·
github.blog/changelog/2026-01-26 · /2026-03-19 · /2026-03-20 · /2026-04-01 · /2025-07-02 · /2025-08-19 ·
github.com/microsoft/vscode/issues/317195 · github.com/microsoft/vscode-copilot-chat/issues/5118

**Protocol, editors and terminals** — agentclientprotocol.com/protocol/tool-calls · /protocol/agent-plan ·
/protocol/session-modes · /protocol/slash-commands · /protocol/terminals · /protocol/v1/schema ·
/protocol/v2/schema · /protocol/v2/migration · /protocol/v2/tool-calls · /protocol/v2/agent-plan ·
/protocol/v2/prompt-lifecycle · /protocol/v2/session-config-options · /protocol/v2/session-list ·
/protocol/v2/elicitation · /protocol/v2/slash-commands · /protocol/v2/initialization ·
/protocol/v1/cancellation · /rfds/session-usage · /rfds/session-compaction · /rfds/session-notices ·
/rfds/session-info-update · /rfds/session-fork · /rfds/plan-operations · /rfds/tool-call-name ·
/rfds/next-edit-suggestions · /rfds/v2/permission-requests ·
/rfds/v2/client-filesystem-terminal-capabilities · /get-started/clients · /get-started/registry ·
zed.dev/docs/ai/agent-panel · /ai/agents · /ai/tool-permissions · /ai/sandboxing · /ai/agent-profiles ·
/ai/agent-settings · /ai/external-agents · /ai/mcp · /ai/skills · /ai/instructions · /ai/tools ·
/ai/parallel-agents · /ai/terminal-threads · zed.dev/blog/terminal-threads · /blog/parallel-agents ·
zed.dev/blog/anthropic-subscription-changes ·
support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan ·
github.com/zed-industries/zed/issues/57546 · /62077 · /62631 · /62892 · /63085 · /63355 · /63741 ·
/63796 · /63943 · cursor.com/docs/agent/overview.md · /agent/plan-mode.md · /agent/agents-window.md ·
/agent/agent-review.md · /agent/security/run-modes.md · /subagents.md · /mcp.md · /hooks.md · /rules.md ·
/customize-cursor.md · /configuration/worktrees.md · /cloud-agent/settings.md · /cloud-agent/api/endpoints.md
· /cloud-agent/mobile.md · /reference/keyboard-shortcuts.md · cursor.com/help/ai-features/agent.md ·
/help/ai-features/side-chats.md · cursor.com/changelog/2-4 · /changelog/page/7 · /changelog/page/8 ·
cursor.com/blog/codex-model-harness · forum.cursor.com/t/editing-agent-terminal-commands-still-runs-the-original-command/145507
· docs.warp.dev/agent-platform/warp-agents/capabilities-overview/agent-notifications ·
docs.warp.dev/guides/agent-workflows/how-to-edit-agent-code-in-warp/ · kiro.dev/docs/web/using-the-agent.md
· /docs/web/using-the-agent/creating-tasks.md · /docs/ide/chat/notifications.md · /docs/ide/chat/dev-servers.md
· /docs/ide/chat/slash-commands.md · /docs/cli/chat/context.md · /docs/cli/chat/settings.md ·
/docs/cli/terminal-ui.md · /docs/cli/v3/tangent.md · /docs/models/effort.md · /docs/hooks/types.md ·
/docs/steering.md · /docs/specs/correctness.md · /docs/crew/chat/message-controls.md ·
junie.jetbrains.com/docs/junie-ide-plugin.html · /docs/action-allowlist.html · /docs/junie-cli-plan-mode.html
· /docs/junie-cli-worktrees.html · /docs/junie-cli-remote-mode.html · /docs/custom-slash-commands.html ·
/docs/guidelines-and-memory.html · /docs/junie-review-agent.html · jetbrains.com/help/ai-assistant/junie-agent.html
· docs.windsurf.com/windsurf/terminal.md · /windsurf/cascade/modes.md · /windsurf/cascade/worktrees.md ·
antigravity.google/docs/home/ · /docs/agent/ · /docs/walkthrough/ · /docs/artifact-review/ ·
/docs/ide/allowlist-denylist/ · goose-docs.ai/docs/guides/goose-permissions/ ·
help.gitkraken.com/gitkraken-desktop/agents/ · gitkraken.com/kepler

**Multi-session managers** — superset.sh · superset.sh/changelog · docs.superset.sh/agent-integration ·
/agent-status · /workspaces · /tasks · /faq · github.com/superset-sh/superset · conductor.build ·
conductor.build/docs/concepts/workspaces-and-branches · /concepts/parallel-agents · /concepts/workflow ·
/concepts/agent-modes · /reference/diff-viewer · /reference/settings · /reference/checks ·
/reference/big-terminal-mode · news.ycombinator.com/item?id=44594584 · github.com/stravu/crystal ·
docs.nimbalyst.com · nimbalyst.com · github.com/Nimbalyst/nimbalyst · vibekanban.com/docs ·
vibekanban.com/blog/shutdown · github.com/BloopAI/vibe-kanban · github.com/smtg-ai/claude-squad ·
cmux.com · cmux.com/guides · cmux.com/compare · manaflow-ai-cmux.mintlify.app/features/notifications ·
github.com/manaflow-ai/cmux · imbue.com/sculptor · imbue.com/blog/sculptor-announce ·
github.com/imbue-ai/sculptor · terragonlabs.com · github.com/terragon-labs/terragon-oss ·
github.com/omnara-ai/omnara · docs.omnara.com/tools/permissions · news.ycombinator.com/item?id=44878650 ·
news.ycombinator.com/item?id=46991591 · github.com/slopus/happy · mintlify.wiki/slopus/happy ·
emdash.com · github.com/generalaction/emdash · runpane.com · abralo.com · agentsroom.dev ·
github.com/built-by-as/FleetCode · github.com/winfunc/opcode · xum.coder.com · github.com/coder/cmux

**Standalone agents** — ampcode.com/docs/tools · /docs/threads · /docs/orbs · /docs/puck · /docs/cli ·
/docs/cli/settings · /docs/cli/keybindings · /docs/models-and-subagents · ampcode.com/manual ·
ampcode.com/news/tool-level-permissions · docs.devin.ai/work-with-devin/devin-session-tools.md ·
/work-with-devin/devin-review.md · /work-with-devin/devin-handoff.md · /work-with-devin/mcp.md ·
/work-with-devin/slash-commands.md · /get-started/first-run.md · cognition.com/blog/devin-can-now-manage-devins
· cognition.com/blog/devin-2-1 · docs.factory.ai/autonomy-and-safety/auto-run ·
/autonomy-and-safety/specification-mode · /droid-cli/cli-reference · /cli/getting-started/overview ·
/missions/overview · docs.factory.ai/factory-app/overview · docs.augmentcode.com/using-augment/agent ·
/using-augment/tasklist.md · /using-augment/message-queue.md · /cli/permissions.md ·
/cosmos/sessions-overview.md · /cosmos/keyboard-command-reference.md · /setup-augment/vscode-keyboard-shortcuts.md
· docs.cline.bot/features/auto-approve · /features/checkpoints · /features/subagents.md · /features/plan-and-act
· /usage/ide.md · /usage/tui.md · /usage/kanban.md · /kanban/core-workflow.md · /mcp/mcp-overview.md ·
/core-workflows/using-commands.md · /core-workflows/working-with-files.md · /core-workflows/task-management.md
· /cli/agent-teams.md · /customization/hooks.md · cline.bot/blog/cline-v3-25 · /blog/cline-v3-35 ·
roocodeinc.github.io/Roo-Code/features/auto-approving-actions · /features/checkpoints · /features/boomerang-tasks
· /features/message-queueing · /features/task-todo-list · /features/intelligent-context-condensing ·
/basic-usage/the-chat-interface · /basic-usage/using-modes · /basic-usage/context-mentions ·
/update-notes/v3.25/ · github.com/RooCodeInc/Roo-Code/pull/6167 ·
kilo.ai/docs/getting-started/settings/auto-approving-actions · /docs/getting-started/cost-controls-and-usage-safeguards
· /docs/code-with-ai · /docs/code-with-ai/features/checkpoints · /docs/code-with-ai/agents/chat-interface ·
github.com/Kilo-Org/kilocode/issues/7529
