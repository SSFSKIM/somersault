# 07 — Subagents, Teams, and Orchestration (Claude Code v2.1.251)

Source of record: `/Users/new/claude-code-bundle/2.1.251/cli.pretty.js` (881,404 lines, beautified)
plus `/Users/new/claude-code-bundle/2.1.251/modules/*`. All `cli.pretty.js:N` anchors are line
numbers in that file. Where a minified identifier is quoted it is qualified by its binding line.
Anything not directly evidenced is marked **INFERRED**.

---

## Executive summary

1. The delegation tool is named **`Agent`** (`Task` is a legacy alias, `cli.pretty.js:402072`). Its
   input schema is `{description, prompt, subagent_type?, model?, run_in_background?, name?,
   team_name?, mode?, isolation?, cwd?}` (`:467905-467907`); `team_name` and `mode` are documented
   as *deprecated and ignored*, and `cwd` is never exposed to the model.
2. Its description text is **assembled at runtime** from ~8 predicates (fork gate, coordinator mode,
   Pro plan, teammate context, remote gate, general-purpose availability). There is no single static
   string: `wlt()` at `:467626` builds it.
3. `subagent_type: "fork"` is a real built-in agent definition (`Ux`, `:520000`) with
   `model:"inherit"`, `tools:["*"]`, `maxTurns:200`, an **empty system prompt**, and a spawn path
   that copies the parent's rendered system prompt, full message array, and REPL replay log.
4. Built-in agent types are assembled by `_ee()` (`:451592`): `general-purpose`, `statusline-setup`,
   a plugin-supplied `CLAUDE_AGENT`, `Explore` + `Plan`, a gated `web-fetch`, and
   `claude-code-guide`. **`output-style-setup` no longer exists** (zero occurrences).
5. Nesting is capped at **3** by default (`jS()`, `:260161`, GrowthBook `tengu_hazel_trellis`, env
   `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); concurrency at **20** (`AXn()`, `:75048`, env
   `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).
6. Teams are gated by `io()` (`:78472`): env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` **or** CLI
   `--agent-teams`, AND GrowthBook `tengu_amber_flint` (default on). One implicit team;
   `teammateMode` ∈ `auto|tmux|iterm2|in-process`, default **`in-process`** (`:603531`).
7. `isolation:"worktree"` runs `git worktree add [--no-checkout] --no-track -B worktree-<name>
   <path> <base>` into `<gitRoot>/.claude/worktrees/<name>` (`:458452-458530`), auto-removed when
   the dirty/ahead check `qut()` (`:459565`) says nothing changed.
8. `isolation:"remote"` (CCR = the claude.ai remote-code API) is gated by `bz()` (`:467576`) and
   silently downgrades to `worktree` or local when unavailable.
9. `/loop` has two modes — cron-backed fixed interval and `ScheduleWakeup`-driven dynamic pacing —
   with four sentinels and two embedded preambles under `modules/`.
10. `TodoWrite`/`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList` are **removed by default on new
    models**: `FL()` (`:465397`) disables them for opus-gen 4/8, sonnet-5, fable-5, mythos-5 unless
    `CLAUDE_CODE_ENABLE_TODO_TOOLS=true` or GrowthBook `tengu_rosy_wren`.

---

## 1. The Agent tool

### 1.1 Identity and aliases

```js
// cli.pretty.js:402072
var i = { Task: "Agent", KillShell: "TaskStop", KillBash: "TaskStop",
          AgentOutputTool: "TaskOutput", BashOutputTool: "TaskOutput",
          AgentOutput: "TaskOutput", BashOutput: "TaskOutput",
          ListPeers: "ListAgents", Brief: "SendUserMessage",
          ListMcpResources: "ListMcpResourcesTool", ReadMcpResource: "ReadMcpResourceTool",
          ReadMcpResourceDir: "ReadMcpResourceDirTool" };
```

This is the canonical rename map. The tool object at `:467919` declares `name: yt` (the `Agent`
name constant) with `aliases: [Hf]` (the legacy `Task` name),
`searchHint: "delegate work to a subagent"`, and a short `description()` returning the literal
`"Launch a new agent"` (`:467937`). The long text comes from `prompt()`.

### 1.2 Input schema — verbatim

Base (`vxn`, `cli.pretty.js:467905`):

```js
f({
  description: i().describe("A short (3-5 word) description of the task"),
  prompt:      i().describe("The task for the agent to perform"),
  subagent_type: i().optional().describe("The type of specialized agent to use for this task"),
  model: ie(["sonnet","opus","haiku","fable"]).optional().describe(
    `Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the configured default subagent model. If omitted, uses the agent definition's model, else the default (inherits from the parent unless a default subagent model is configured). Ignored for subagent_type: "fork" — forks always inherit the parent model.`
    + (Fs()   // coordinator mode
       ? a.CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL
         ? " Unavailable on this session: this parameter is ignored — do not set it."
         : " Set this only when EXPLICITLY asked by the user for a specific model, never because the task seems small, simple, or cheap; otherwise omit it so the worker uses the default (the session model, unless a default subagent model is configured)."
       : "")),
  run_in_background: q().optional().describe("Agents run in the background by default; you will be notified when one completes. Set to false only when your very next action depends on this agent's result and nothing else could usefully happen while it runs — otherwise leave it in the background so the user can hand you other work.")
})
```

Extended (`Exn`, `cli.pretty.js:467906-467907`):

```js
name: i().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)     // Hrr, cli.pretty.js:137606
  .refine(t => t !== _p, { message: `"<reserved>" is reserved — SendMessage routes it to the main conversation` })
  .refine(t => !xH(t),  { message: 'name must not be a reserved recipient ("main" or "team-lead", in any spelling) or have the shape of an agent id — those already address an agent directly' })
  .optional().describe("Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running."),
team_name: i().optional().describe("Deprecated; ignored. The session has a single implicit team."),
mode: yir().optional().describe("Deprecated; ignored. Subagents inherit the parent session's permission mode; agent-definition frontmatter may override it."),
isolation: ie(["worktree","remote"]).optional().describe('Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" launches the agent in a remote cloud environment (always runs in background; availability is gated).'),
cwd: i().optional().describe('Absolute path to run the agent in. Overrides the working directory for all filesystem and shell operations within this agent. Mutually exclusive with isolation: "worktree".')
```

The **exposed** schema is `cln()` (`:467909-467911`):

```js
let e = Exn().omit({ cwd: !0 });                 // cwd is NEVER exposed to the model
return $d() || TG() ? e.omit({ run_in_background: !0 }) : e;
```

So `cwd` is internal-only, and `run_in_background` disappears when either `$d()` (a
synchronous-only context) or `TG()` (the fork gate) is on.

### 1.3 Output schema — verbatim (`xxn`, `cli.pretty.js:467912-467914`)

A discriminated union of three shapes:

```js
// completed
{ ...agentResultBase, status: "completed", prompt, worktreePath?, worktreeBranch? }
// async_launched
{ status: "async_launched", isAsync?: true, agentId, description,
  resolvedModel?  ("Model in use at the backgrounding transition (a pre-background swap is reflected here)"),
  modelsUsed?[]   ("Ordered distinct models used before backgrounding (length > 1 means a mid-run swap)"),
  prompt, outputFile ("Path to the output file for checking agent progress"),
  canReadOutputFile? ("Whether the calling agent has Read/Bash tools to check progress") }
// remote_launched
{ status: "remote_launched", taskId ("The ID of the remote agent task"),
  sessionUrl ("The URL of the cloud session"), description, prompt, outputFile }
```

A fourth status, `teammate_spawned`, is returned from the teammate branch (`:467987`) without being
declared in the output schema.

### 1.4 Description assembly — `wlt()` (`cli.pretty.js:467626`)

Controlling predicates:

| symbol | def | meaning |
|---|---|---|
| `TG()` | `:519996` | fork gate on (`qmr() !== "disabled"`) |
| `Fs()` | `:613938` | coordinator mode |
| `bz()` | `:467576` | remote/CCR isolation available |
| `lN()` | `:633967` | synchronous-only context (no `run_in_background`, no `name`) |
| `na()` | `:634033` | this session *is* a teammate |
| `Jk() === "default"` | `:467744` | non-lean prompt variant |
| `Fn() === "pro"` | `:467745` | Claude Pro plan |
| `td(e)` | `:467741` | model-dependent "new prompt" variant |

Base paragraph (`pe`, `:467743-467748`):

```
Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.

Available agent types are listed in <system-reminder> messages in the conversation.{PRO_CLAUSE}

When using the Agent tool, specify a subagent_type to select an agent: `"fork"` forks yourself (the fork inherits your full conversation context and always runs on your model — a `model` override is ignored); any other type — or omitting it — starts a fresh agent (general-purpose by default).
```

With the fork gate off the last paragraph degrades to
`"When using the Agent tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used."`

**Pro-plan clause** (`fe`, `:467743`) — a hard anti-spawn instruction:

```
**Do not spawn agents unless the user asks.** Each spawn starts cold and re-derives context you already have — it's the expensive path on this plan. A task with "multiple angles," "thorough," or several parts is not a request to spawn; handle it inline with your own tools. Only use this tool when the user explicitly says to use a subagent, or names one of the available agent types.
```

**Fork semantics** (`C`, `:467628`) — present only when the fork gate is on and fork is permitted:

```
## When to fork

Fork yourself (pass `subagent_type: "fork"`) when the intermediate tool output isn't worth keeping in your context. The criterion is qualitative — "will I need this output again" — not task size. Fork open-ended questions. If research can be broken into independent questions, launch parallel forks in one message. A fork beats a fresh subagent for this — it inherits context and shares your cache.

Forks are cheap because they share your prompt cache.

**Don't peek.** The tool result includes an `output_file` path — do not Read or tail it. You get a completion notification; trust it. Reading the transcript mid-flight pulls the fork's tool noise into your context, which defeats the point of forking.

**Don't race.** After launching, you know nothing about what the fork found. Never fabricate or predict fork results in any format — not as prose, summary, or structured output. The notification arrives as a user-role message in a later turn; it is never something you write yourself. If the user asks a follow-up before the notification lands, tell them the fork is still running — give status, not a guess.

**Writing a fork prompt.** Since the fork inherits your context, the prompt is a *directive* — what to do, not what the situation is. Be specific about scope: what's in, what's out, what another agent is handling. Don't re-explain background.
```

**Prompt-writing section** (`A`, `:467630`), always present:

```
## Writing the prompt

Any agent other than a fork starts with zero context. Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters.
- Explain what you're trying to accomplish and why.
- Describe what you've already learned or ruled out.
- Give enough context about the surrounding problem that the agent can make judgment calls rather than just following a narrow instruction.
- If you need a short response, say so ("report in under 200 words").
- Lookups: hand over the exact command. Investigations: hand over the question — prescribed steps become dead weight when the premise is wrong.

For fresh agents, terse command-style prompts produce shallow, generic work.

**Never delegate understanding.** Don't write "based on your findings, fix the bug" or "based on the research, implement it." Those phrases push synthesis onto the agent instead of doing it yourself. Write prompts that prove you understood: include file paths, line numbers, what specifically to change.
```

**Modern ("new prompt") tail** (`:467749-467761`) — the variant most sessions see:

```
- The agent's final report is not shown to the user — relay what matters.
- Use SendMessage with the agent's ID or name to continue a previously spawned agent with its context intact; a new Agent call starts fresh (except subagent_type: "fork", which inherits your context).
- Each agent type's model, reasoning effort, and tools come from its definition (`.claude/agents/*.md` frontmatter or SDK `agents`).
- `isolation: "worktree"` gives the agent its own git worktree (auto-cleaned if unchanged).
- `isolation: "remote"` runs the agent in a remote CCR sandbox (always background).        [only when bz()]
- Subagents run in the background by default; you'll be notified when one completes. Pass `run_in_background: false` only when your very next action depends on the result and nothing else could usefully happen while it runs — otherwise background it so the user can interject. Never fabricate or predict a pending agent's results — the notification is never something you write yourself; if the user asks before it arrives, say it's still running.
- `run_in_background` and `name` are unavailable here — only synchronous subagents.        [only when lN()]
- `name` is unavailable here — teammates cannot spawn teammates.                            [only when na()]
```

An older long-form "## Usage notes" branch (`:467764-467779`) is retained for the legacy variant and
carries the "Trust but verify" line:

```
- Trust but verify: an agent's summary describes what it intended to do, not necessarily what it did. When an agent writes or edits code, check the actual changes before reporting the work as done.
```

The description also carries two worked examples (`x` at `:467632` for the fork variant, `B` at
`:467636` otherwise) whose sole purpose is teaching that the completion notification is a *separate
later turn*, never something the model writes.

### 1.5 Agent-type listing injection

Types are not in the tool description. They arrive as a `<system-reminder>` delta
(`agent_listing_delta`, `cli.pretty.js:519073-519090`):

```
Available agent types for the Agent tool:                 // e.isInitial
New agent types are now available for the Agent tool:     // otherwise
<lines>

The following agent types are no longer available:
- <type>

When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently.
```

Each line is formatted by `klt()` (`cli.pretty.js:467621-467624`):

```js
`- ${e.agentType}: ${whenToUse} (Tools: ${Sxn(e)})`
```

`Sxn()` (`:467609-467620`) renders the tool column: the intersection when both `tools` and
`disallowedTools` are set (`"None"` if empty), the list when only `tools`,
`` `All tools except ${r.join(", ")}` `` when only `disallowedTools`, else `"All tools"`.
`whenToUseLean` replaces `whenToUse` in lean mode.

### 1.6 Built-in agent definitions — verbatim

Assembly (`_ee()`, `cli.pretty.js:451592`):

```js
function _ee() {
  let e = EZ();                              // :451562
  if (e === "none") return [];               // CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS && SDK host
  if (e === "coordinator") return getCoordinatorAgents();   // chunk-06vq7b79.js
  let t = [MB];                              // general-purpose
  if (!Dr())    t.push(xnt);                 // statusline-setup
  if (!iMe())   t.push(CLAUDE_AGENT);        // chunk-5gtk87p8.js
  if (pI())     t.push(lb, I2);              // Explore, Plan
  if (CZ())     t.push(Kxe);                 // web-fetch
  if (CLAUDE_CODE_ENTRYPOINT not in {sdk-ts, sdk-py, sdk-cli}) t.push(Pnt);  // claude-code-guide
  return t;
}
```

`EZ()` returns `"coordinator"` whenever `Fs()` is true — in coordinator mode the entire built-in set
is *replaced* by a single `worker` agent.

#### `general-purpose` (`MB`, `cli.pretty.js:451374`)

```js
{ agentType: "general-purpose",
  whenToUse: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
  tools: ["*"], source: "built-in", baseDir: "built-in", getSystemPrompt: A_n }
```

System prompt (`A_n`, `cli.pretty.js:451358-451373`), verbatim:

```
You are an agent for Claude Code, Anthropic's official CLI for Claude. Given the user's message, you should use the tools available to complete the task. Complete the task fully—don't gold-plate, but don't leave it half-done. When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.
- You are already the dedicated agent for this task. Do the work directly — do not re-delegate your entire assignment to another single subagent.
```

It has **no model field** — it inherits the session default via `q0(N8(...))`.

#### `Explore` (`lb`, `cli.pretty.js:413639`)

```js
{ agentType: "Explore", whenToUse: oKt, whenToUseLean: sKt,
  disallowedTools: [Agent, Artifact, ?, Write, Edit, ?],   // [yt, Si, Wh, Kt, ar, mc]
  source: "built-in", baseDir: "built-in", model: "inherit", omitClaudeMd: true,
  getSystemPrompt: () => rKt() }
```

`oKt` (long form):
```
Fast read-only search agent for locating code. Use it to find files by pattern (eg. "src/components/**/*.tsx"), grep for symbols or keywords (eg. "API endpoints"), or answer "where is X defined / which files reference Y." Do NOT use it for code review, design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than whole files and will miss content past its read window. When calling, specify search breadth: "quick" for a single targeted lookup, "medium" for moderate exploration, or "very thorough" to search across multiple locations and naming conventions.
```

`sKt` (lean form):
```
Read-only search agent for broad fan-out searches — when answering means sweeping many files, directories, or naming conventions and you only need the conclusion, not the file dumps. It reads excerpts rather than whole files, so it locates code; it doesn't review or audit it. Specify search breadth: "medium" for moderate exploration, "very thorough" for multiple locations and naming conventions.
```

System prompt `rKt()` (`cli.pretty.js:413603-413637`), verbatim with tool names interpolated:

```
You are a file search specialist for Claude Code, Anthropic's official CLI for Claude. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching        (or `find` via Bash on the bash-grep variant)
- Use Grep for searching file contents with regex (or `grep` via Bash)
- Use Read when you know the specific file path you need to read
- Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail)
- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification
- Adapt your search approach based on the thoroughness level specified by the caller
- Communicate your final report directly as a regular message - do NOT attempt to create files

NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:
- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations
- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files

Complete the user's search request efficiently and report your findings clearly.
```

On Windows the parenthetical tool lists switch to PowerShell equivalents (`Get-ChildItem, git status,
git log, git diff, Get-Content, Select-Object -First/-Last`, and `New-Item, Remove-Item, Copy-Item,
Move-Item, …` for the NEVER list).

**Explore's model is special-cased.** `N8()` (`cli.pretty.js:413640-413646`):

```js
function N8(e, t) {
  if (e.agentType !== "Explore" || e.source !== "built-in") return e.model;
  if (a.CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP) return "inherit";
  return iKt(t) ? "opus" : "inherit";
}
var mUe = ["haiku","sonnet","opus"], gUe = "opus";
```

On first-party auth, when the parent's model sits *above* opus in the ladder, Explore is capped down
to opus rather than inheriting. `CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP` removes the cap.

#### `Plan` (`I2`, `cli.pretty.js:413707`)

```js
{ agentType: "Plan",
  whenToUse: "Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.",
  disallowedTools: [yt, Si, Wh, Kt, ar, mc],   // same deny set as Explore
  source: "built-in", tools: lb.tools, baseDir: "built-in", model: "inherit", omitClaudeMd: true,
  getSystemPrompt: () => aKt() }
```

System prompt `aKt()` (`cli.pretty.js:413648-413706`) — the same READ-ONLY preamble as Explore, then:

```
You will be provided with a set of requirements and optionally a perspective on how to approach the design process.

## Your Process

1. **Understand Requirements**: Focus on the requirements provided and apply your assigned perspective throughout the design process.

2. **Explore Thoroughly**:
   - Read any files provided to you in the initial prompt
   - Find existing patterns and conventions using Glob, Grep, and Read
   - Understand the current architecture
   - Identify similar features as reference
   - Trace through relevant code paths
   - Use Bash ONLY for read-only operations (...)
   - NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification

3. **Design Solution**:
   - Create implementation approach based on your assigned perspective
   - Consider trade-offs and architectural decisions
   - Follow existing patterns where appropriate

4. **Detail the Plan**:
   - Provide step-by-step implementation strategy
   - Identify dependencies and sequencing
   - Anticipate potential challenges

## Required Output

End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- path/to/file1.ts
- path/to/file2.ts
- path/to/file3.ts

REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files. You do NOT have access to file editing tools.
```

#### `statusline-setup` (`xnt`, `cli.pretty.js:451546`)

```js
{ agentType: "statusline-setup",
  whenToUse: "Use this agent to configure the user's Claude Code status line setting.",
  tools: ["Read","Edit"], source: "built-in", baseDir: "built-in",
  model: "sonnet", color: "orange", getSystemPrompt: () => M_n() }
```

Its prompt ends (`:451544`) with
`- IMPORTANT: At the end of your response, inform the parent agent that this "statusline-setup" agent must be used for further status line changes.`
The `/statusline` command dispatches it by emitting the literal text
`Create an Agent with subagent_type "statusline-setup" and the prompt "<args>"` (`:504355`).

**`output-style-setup` is gone** — `grep -c 'output-style-setup' cli.pretty.js` → `0`.

#### `web-fetch` (`Kxe`, `cli.pretty.js:451561`)

`agentType: "web-fetch"` (`Dc`, `:422364`), `tools: [WebFetch]`, `model: "inherit"`,
`color: "blue"`, `maxTurns: 15`, `omitClaudeMd: true`. Gated by `CZ()` (`:451582`), which requires
`CLAUDE_CODE_WEB_FETCH_AGENT` or GrowthBook `tengu_clever_orbit`, the `allow_web_fetch` policy, not
`CLAUDE_CODE_SIMPLE`, and `EZ() === "default"`. It is the only agent for which `isolation` is
force-ignored (`:467938`):
`[web-fetch agent] isolation:'<x>' ignored; the built-in web-fetch agent always runs as a local agent`.
It also runs **foreground by default** — the `fE(en)` predicate (`:422369`) suppresses the background
default at `:467944`.

#### `claude-code-guide` (`Pnt`, `cli.pretty.js:451301`)

`model: "haiku"`, `permissionMode: "dontAsk"`, tools `[Glob, Grep, Read, WebFetch, WebSearch]` (or
`[Bash, Read, WebFetch, WebSearch]` on the bash-grep variant). Its system prompt (`T_n()`,
`:451382-451465`) is a ~90-line five-domain doc-routing prompt with hard-coded doc-map URLs
(`https://code.claude.com/docs/en/claude_code_docs_map.md`, `https://platform.claude.com/llms.txt`,
`https://claude.com/docs/llms.txt`, `https://claude.com/docs/claude-tag/overview.md`). Its
`getSystemPrompt` appends a live inventory of the user's custom skills, custom agents, MCP servers,
plugin skills, and configured settings keys.

#### `comment-thread-analyst` (`cli.pretty.js:728603`)

Programmatic-only: `tools: [Artifact]`, `model: "inherit"`, `maxTurns: 6`, dispatched by the artifact
comment pipeline. Its `whenToUse` ends `"Dispatched programmatically by the artifact comment
pipeline; not intended for direct spawning."`

#### `claude` (`zae`, `cli.pretty.js:61670`)

`whenToUse: "Catch-all for any task that doesn't fit a more specific agent. FleetView's default when
no agent name is typed."`, `tools: ["*"]`, `appendSystemPrompt: true`.

#### `fork` (`Ux`, `cli.pretty.js:520000`)

```js
var Ux = { agentType: m6,   // "fork"
  whenToUse: 'Fork — inherits full conversation context. Selected explicitly via subagent_type: "fork" when the fork gate is on; never the default.',
  tools: ["*"], maxTurns: 200, model: "inherit", permissionMode: "bubble",
  source: "built-in", baseDir: "built-in", getSystemPrompt: () => "" };
```

Note the empty system prompt — a fork's system prompt is the *parent's* (§3.2).

`workflow-subagent` is covered in §6.5.

---

## 2. Custom agents

### 2.1 `.claude/agents/*.md` frontmatter — full field set

Parsed by `ngr()` (`cli.pretty.js:451835-451910`):

| key | type | handling |
|---|---|---|
| `name` | string, **required** | rejects a leading `-`; rejects `:` after NFKC normalization (reserved for plugin namespacing) |
| `description` | string, **required** | becomes `whenToUse`; literal `\n` sequences expand to real newlines |
| `color` | string | accepted only if in the theme colour list `ef` |
| `model` | string | trimmed; `"inherit"` (case-insensitive) preserved as the literal `"inherit"`, anything else passed through |
| `background` | `true`/`false`/`"true"`/`"false"` | anything else logs `has invalid background value` |
| `memory` | `user` \| `project` \| `local` | invalid → warning `has invalid memory value` |
| `isolation` | `worktree` \| `remote` | invalid → warning `has invalid isolation value` |
| `effort` | via `xk()` | `Uh` levels or an integer; invalid → warning |
| `permissionMode` | member of `gy` | invalid → warning; applied only when valid |
| `maxTurns` | positive integer | invalid → `Must be a positive integer.` |
| `cacheTtl` | via `TWt()` | |
| `tools` | list via `PE()` | |
| `disallowedTools` | list via `PE()` | |
| `skills` | list via `h_()` | |
| `initialPrompt` | non-empty string | |
| `observer` | non-empty trimmed string | observer-pairing target |
| `observerMessage` | non-empty string | |
| `observeSubagents` | `false`/`"false"` → `false`, else undefined | |
| `mcpServers` | array | each element validated against `Dnt()` = `string \| Record<string, config>`; invalid entries dropped with a log |
| `hooks` | object | parsed by `z_n(frontmatter, name)` |

The markdown **body** (trimmed) becomes the system prompt. When agent memory is enabled (`ta()`) and
`memory` is set, `X_t()` appends the primed memory block to the body, and `Read`/`Write`/`Edit` are
force-added to an explicit `tools` list so the agent can reach its memory files (`:451884-451888`).

### 2.2 Plugin agents — the reduced schema

Parsed by `Ant()` (`cli.pretty.js:451109-451163`). Differences from `.claude/agents/`:

- `agentType` is namespaced: `[pluginName, ...subdirs, name].join(":")` (`:451123`).
- `description` falls back through `description` → `when_to_use` → `when-to-use` →
  `` `Agent from ${plugin} plugin` ``.
- Three keys are read and **explicitly refused** (`:451141-451143`):
  `Plugin agent file <path> sets <permissionMode|hooks|mcpServers>, which is ignored for plugin agents. Use .claude/agents/ for this level of control.`
- `isolation` accepts only `"worktree"` (not `"remote"`).
- File size cap **1 MiB** (`vnt = 1048576`, `:451094`); larger or non-regular files are skipped.

Plugin agent directories: the plugin's `agentsPath` (default `agents/`) plus any `agentsPaths`
entries, which may name a directory or a single `.md` file (`:451167-451205`).

### 2.3 Discovery order and precedence

`I9t()` (`cli.pretty.js:429569-429608`) scans the `agents` subdirectory across four scopes, and the
resulting array order **is** precedence order:

```js
let ge = [...B /*policySettings*/, ...W /*userSettings*/, ...pe /*additionalDirectory*/, ...fe /*projectSettings*/];
```

- `policySettings`: `<policyDir>/.claude/agents`
- `userSettings`: `<userClaudeDir>/agents` — skipped entirely when `Fd("agents")` (an agents
  kill-switch) is on
- `projectSettings`: every project dir's `.claude/agents`, plus — **for `agents` only** — each
  additional working directory's `.claude/agents`, tagged `fromAdditionalDirectory: true`
- If the workspace root and the git root differ, the git root's `.claude/agents` is added too
  (`:429573-429580`)

Files are deduplicated **by inode** across scopes (`:429587-429600`), so a symlink or hard link
loaded from two scopes is kept once, logging
`Skipping duplicate file '<path>' from <source> (same inode already loaded from <source>)`.

The directory walk `O9t()` (`:429609+`) recurses subdirectories, follows symlinks, and accepts any
`.md` file.

Trust gating: `Vxe()` (`:451102-451106`) refuses frontmatter `hooks` and `mcpServers` when the source
folder is untrusted:
`Skipping frontmatter hooks for agent '<type>': the folder its definition file came from is not trusted (source: <source>). Run Claude Code in that folder once and accept the trust dialog, or set projects[<path>].hasTrustDialogAccepted: true in <settings>.`

### 2.4 Type resolution and error messages

`d_()` (`cli.pretty.js:422361`) is the normalizer used for fuzzy matching:

```js
e.normalize("NFKC").toLowerCase().replace(/[\p{White_Space}\p{Pd}_]+/gu, "")
```

Case-, whitespace-, dash-, and underscore-insensitive. Resolution in the Agent tool
(`:467937-467958`):

1. Exact `agentType` match → use it.
2. Otherwise collect all definitions whose normalized type matches. If **>1** →
   `Agent type '<t>' is ambiguous — matches <a>, <b (unavailable)>. Use the exact name: <a> or <b>`.
3. Exactly 1 and available → normalize silently (`tengu_subagent_type_normalized`).
4. Exactly 1 but denied → `Agent type '<t>' has been denied by permission rule 'Agent(<t>)' from <source>.`
   or, if its tools are all denied, `Rye(gs)`.
5. None → `Agent type '<t>' not found. Available agents: <list|none>`.

Omitting `subagent_type` when no general-purpose agent is available yields
`` `${ZWt}. Available agents: <list>` `` — `ZWt` is the "you must choose one of the listed agent
types" sentence also used in the description.

---

## 3. Subagent runtime

### 3.1 Preconditions, in order (`Ane.call`, `cli.pretty.js:467919`+)

1. **Coordinator model clamp** — `if (Fs() && CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL) model = undefined` (`:467926`).
2. **Depth cap** (`:467928-467929`):
   ```
   Subagent nesting limit reached (depth <W> of <z>). Complete this task directly using your tools instead of spawning another agent. If the user explicitly requested deeper nesting, ask them to raise CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH.
   ```
   `jS()` (`cli.pretty.js:260161`, chunk-9xdt2ay0.js):
   ```js
   var o = 3, _ = "tengu_hazel_trellis";
   function jS() {
     let n = a.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH;
     if (n !== void 0) return n;
     // cached GrowthBook lookup; must be an integer >= 1, else 3
   }
   ```
3. **Teammate nesting** (`:467933`):
   ``Teammates cannot spawn other teammates — the team roster is flat. To spawn a subagent instead, omit the `name` parameter.``
4. **Teammate background** (`:467935`):
   `In-process teammates cannot spawn background agents. Use run_in_background=false for synchronous subagents.`
   and, for a definition with `background:true` (`:467993`):
   `In-process teammates cannot spawn background agents. Agent '<type>' has background: true in its definition.`
5. **Permission deny by agent type** — rule grammar `Agent(<agentType>)` (`:467939`, `:467944`).
6. **Budget** (`:467964`):
   `Budget limit reached ($X spent of the $Y maximum). New agents cannot be started. Complete the remaining work directly with your tools, or wrap up with the results you already have.`
7. **Concurrency cap** (`At()`, `:467960-467969`):
   ```
   Concurrent subagent limit reached. You can run <N> subagents at once. Do not retry. If the user wants more concurrent subagents, ask them to increase CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS.
   ```
   `AXn()` (`cli.pretty.js:75048`): `var J = 20; return a.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ?? J;`
   The cap is **bypassed** when GrowthBook `tengu_amber_kestrel` is on, or when
   `Wv(mainLoopModel, effort, appState.ultracode)` returns true (`:467965-467967`) — ultracode
   sessions are exempt.
8. **Required MCP servers** (`:467977-467991`) — waits up to 30 s for pending clients, then:
   ```
   Agent '<type>' requires MCP servers matching: <list>. MCP servers with tools: <list|none>. Use /mcp to configure and authenticate the required MCP servers.
   ```
9. **Fork preconditions** (`Plt()`, `cli.pretty.js:468393-468400`):
   - `isolation:"remote"` → `Fork cannot use isolation: "remote" — a remote session cannot inherit the conversation context. Omit isolation (or use "worktree"), or spawn a named agent type for remote work.`
   - inside a fork already → `Fork is not available inside a forked worker. Complete your task directly using your tools.`

An `agent.spawn` **hook** runs before launch; a plugin can veto:
`Subagent spawn denied by a plugin: <deny>` (`:468002`). The hook may also rewrite the model
(`B = yn.model`, `:468003`).

### 3.2 Fork vs fresh — what is inherited

Fresh agent (`:468040-468050`):
```js
br = await zH([Jn], hn, additionalDirs);   // Jn = en.getSystemPrompt(...)
Lr = [xe({ content: e })];                 // one user message: the prompt
override = { systemPrompt: pi(br) }        // when no worktree and no cwd
availableTools = Yn                        // recomputed from the agent's permission context
```

Fork (`:468035-468039`, `:468055-468060`):
```js
Nr = A.renderedSystemPrompt ?? uD({ mainThreadAgentDefinition, toolUseContext, customSystemPrompt,
                                    defaultSystemPrompt, appendSystemPrompt, skillsPersistencePrompt })
Lr = fWn(e, M);                            // synthesized assistant+user pair (below)
override = { systemPrompt: Nr,
             replHydration: { kind: "fork", log: [...parent REPL replay log] } }
availableTools      = A.options.tools      // the PARENT's exact tool array
useExactTools       = true
forkContextMessages = A.messages           // the PARENT's full message history
model               = "inherit"
```

`fWn()` (`cli.pretty.js:520006-520012`) builds the fork's opening turn by cloning the parent's
in-flight assistant message, then appending a synthetic user message with one `tool_result` per
outstanding `tool_use` carrying the text `"Fork started — processing in background"` (`ldr`,
`:520004`), followed by the fork's directive text. That is how a fork begins mid-turn without an
unbalanced `tool_use`.

The fork also receives its worktree note when one was created:
`if (We && Er) Lr.push(xe({ content: mWn(cwd, Er.worktreePath) }))` (`:468061`).

Model resolution: `Lt = (Pr) => q0(N8(en, dn), dn, We ? "inherit" : Pr, pe)` (`:467996`) — `N8()`
applies the Explore cap, `q0()` resolves `"inherit"` against the parent model `dn = cm(A)`, and forks
force `"inherit"` regardless of the `model` argument. Precedence, highest first:

1. `"inherit"` if fork (unconditional)
2. the `agent.spawn` hook's returned model
3. the Agent tool's `model` input (unless coordinator + `…FORCE_WORKER_INHERIT_MODEL`)
4. the agent definition's `model` frontmatter (after the Explore cap)
5. the configured default subagent model
6. the parent/session model

### 3.3 Background vs foreground decision (`cli.pretty.js:467944`)

```js
let Ve = nn && !Oe || Pt || !Oe && u !== !1;      // nn=coordinator, Pt=forkGate&&!teammate, Oe=isTeammate
let Xe = ut || (u === !0 || en.background === !0 || !fE(en) && Ve) && !tt;   // ut=remote, tt=$d()
```

Remote is always background. Otherwise background if the caller asked for it, or the definition says
`background:true`, or (the agent is not web-fetch AND the session default is background). The session
default is background in coordinator mode, under the fork gate, and generally whenever
`run_in_background !== false`. `$d()` forces foreground everywhere.

Auto-backgrounding of a *foreground* agent: `wxn()` (`cli.pretty.js:467901-467904`) returns
**120000 ms** when `CLAUDE_AUTO_BACKGROUND_TASKS` is truthy, else 0 (disabled). It is passed as
`autoBackgroundMs` (`:468191`), and the sync path races the run against `qn.backgroundSignal`
(`:468250`). A separate 2000 ms timer (`bxn = 2000`, `:467900`) emits a `background_hint`
tool-progress event (`:468243`).

Stall detection: `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`, default **600000 ms** (`:467293`).

### 3.4 Tool result shapes (`mapToolResultToToolResultBlockParam`, `cli.pretty.js:468340-468370`)

`async_launched`:

```
Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)
agentId: <id> (internal ID - do not mention to user. Use SendMessage with to: '<id>', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives — do not report, assume, or predict them; continue other work or respond to the user in the meantime.
Do not duplicate this agent's work — avoid working with the same files or topics it is using.
output_file: <path>
Do NOT Read or tail this file via the shell tool — it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.
```

The last three lines appear only when `canReadOutputFile` is true (the parent has `Read` or `Bash`);
otherwise:
`In your own words, briefly tell the user what you launched — do not echo this tool result. Agent results will arrive in a subsequent message. If the user asks for progress, say the agent is still running.`

`completed` — the agent's content blocks, then a trailer:

```
agentId: <id> (use SendMessage with to: '<id>', summary: '<5-10 word recap>' to continue this agent)
worktreePath: <path>
worktreeBranch: <branch>
<usage>subagent_tokens: N
tool_uses: N
duration_ms: N</usage>
```

Empty output is replaced by `(Subagent completed but returned no output.)`. Agent types in `QWt` skip
the trailer entirely when there is no worktree.

### 3.5 Completion notification format

The parent is re-invoked with a user-role message. The coordinator prompt documents the exact XML
(`cli.pretty.js:75149-75163`):

```xml
<task-notification>
<task-id>{agentId}</task-id>
<status>completed|failed|killed|blocked</status>
<summary>{human-readable status summary}</summary>
<result>{agent's final text response}</result>
<usage>
  <subagent_tokens>N</subagent_tokens>
  <tool_uses>N</tool_uses>
  <duration_ms>N</duration_ms>
</usage>
</task-notification>
```

- `<result>` and `<usage>` are optional sections.
- `<summary>` is one of `"finished"`, `"failed: {error}"`, `"was stopped"`, or
  `"stopped at its N-turn limit"` (a partial result; continue with `SendMessage` to the task-id).
- It is wrapped in a `<system-reminder>` opening with the header
  `[SYSTEM NOTIFICATION - NOT USER INPUT]` (`rht`, `cli.pretty.js:74672`).
- The scheduled-task counterpart header is
  `[SCHEDULED TASK - AUTOMATED FIRING OF A CONFIGURED PROMPT]` (`cli.pretty.js:74709`).

Polling responses (`task_status` reminder, `cli.pretty.js:518954-518967`):

```
Background agent "<desc>" (<taskId>) is still running. Progress: <deltaSummary> Do NOT spawn a duplicate. You will be notified when it completes. You can read partial output at <path> or send it a message with SendMessage.
Task "<desc>" (<taskId>) was stopped by the user.
Task <id> (type: <t>) (status: <s>) (description: <d>) Delta: <deltaSummary> Read the output file to retrieve the result: <path>
```

### 3.6 Progress surfacing

The foreground path installs an `onMessage` handler (`Ol`, `cli.pretty.js:468210-468237`) converting
each subagent message into a parent `progress` event with `toolUseID: "agent_" + parentMessageId` and
`data: { type: "agent_progress", message, prompt, agentId, agentType, isBuiltIn, description,
resolvedModel, modelsUsed }`. By default only `tool_use` / `tool_result` blocks are forwarded;
`forwardSubagentText` widens it to all assistant text (`:468231-468232`, `:468252`).

API-retry state is surfaced separately as `{ type: "agent_api_retry", attempt, maxRetries,
retryDelayMs, errorStatus, errorCategory }`, de-duplicated on a `source:attempt:maxRetries:category`
key (`:468225-468228`).

**agentProgressSummaries** — periodic AI summaries of a running agent — is a *launch option*, not a
tool field: `Zfe()` (`cli.pretty.js:82110`) reads
`host.launchOptions.sdkAgentProgressSummariesEnabled()`. It is combined with coordinator/fork mode at
spawn time: `enableSummarization: Zfe() || (nn || Pt) && !Le()` (`:468193`) — coordinator and fork
sessions summarize even without the flag.

### 3.7 Spawn telemetry

`Elt` (`cli.pretty.js:467786-467812`) accumulates a per-session snapshot:

```js
{ spawned, requested: {background, foreground, unset}, started_in_background,
  max_depth, spawned_by_subagents, completed, failed,
  killed: {parent, user, system},
  refused: {depth_limit, concurrency_limit, budget},
  by_type: {<agentType>: count} }
```

`tengu_agent_tool_selected` (`:468010`) records `agent_type, model, source, color,
is_built_in_agent, is_resume, is_async, is_fork, agent_depth, agent_system_prompt_chars`.

<!--NEXT-->


