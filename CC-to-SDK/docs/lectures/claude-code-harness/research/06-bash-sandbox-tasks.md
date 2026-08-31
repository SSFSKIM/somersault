# 06 — Bash, sandboxing, and background tasks

Source of truth: `~/claude-code-bundle/2.1.251/cli.pretty.js` (881,404 lines, beautified from the
2.1.251 arm64 binary; `VERSION: "2.1.251"`, `GIT_SHA: 37534ac596d80cefb02d272f036adba4ba055d2c`,
`BUILD_TIME: 2026-08-28T14:51:38Z` — all three at `cli.pretty.js:472362`). Every line number below
is `cli.pretty.js:<n>`. Symbols are minified **per chunk**, so names like `yi`, `LG`, `$ct` are
local to their chunk; they are cited as navigation aids, not as stable API.

---

## Executive summary

1. **Bash is not a persistent shell.** Every call spawns a fresh login-ish shell (`bash -c` /
   `zsh -c`) whose environment is restored from a **shell snapshot script** written once per session
   into `~/.claude/shell-snapshots/snapshot-<shell>-<ts>-<rand>.sh` (`472229`).
2. **`cd` persistence is faked**: the wrapper appends `pwd -P >| <cwd-file>` to every command and the
   harness reads that file back to move the session cwd (`472466`, `472740`). That readback is
   heavily validated (`472487`).
3. **Timeouts**: default `120000` ms, max `600000` ms, both overridable by `BASH_DEFAULT_TIMEOUT_MS` /
   `BASH_MAX_TIMEOUT_MS` (`413444`–`413462`). Output caps at `30000` chars, ceiling `150000`
   (`BASH_MAX_OUTPUT_LENGTH`, `414416`).
4. **The model-facing tool description now has two variants**: a long legacy one and a terse "lean"
   one chosen per-model by `leanPrompt(model)` (`515565`). The git-commit/PR playbook with the
   heredoc examples still exists but only in the long variant (`515425`).
5. **Sandboxing is on by default where supported**; macOS uses a generated `sandbox-exec` SBPL
   profile (`683431`), Linux uses bubblewrap plus a local filtering HTTP/SOCKS proxy (`680421`).
   Violations are appended to stderr inside a `<sandbox_violations>` block (`684717`).
6. **`dangerouslyDisableSandbox`** is a first-class input field (`515719`) gated by
   `sandbox.allowUnsandboxedCommands` (`111182`); using it forces an `ask` permission decision
   (`515928`).
7. **Permission analysis runs on a hand-written tree-sitter-bash-shaped parser** compiled into the
   bundle (`chunk-fgwne0fb.js`, `ZE()` at `398569`). No Haiku-powered command classifier remains for
   Bash; the LLM path is now the generic "auto mode" classifier.
8. **Background work is unified under a task registry.** `BashOutput`/`KillShell` are now *aliases*
   for `TaskOutput`/`TaskStop` (`402072`), and `TaskOutput` is explicitly marked DEPRECATED in favour
   of `Read` on the task's output file (`476029`).
9. **Three distinct auto-background paths** exist: 2 s "armed for Ctrl+B", timeout-triggered, and
   turn-abort-triggered (`516108`–`516250`). `assistantAutoBackgrounded` is gone from the codebase.
10. A **`Monitor` tool** (feature-gated on `tengu_amber_sentinel`) streams one notification per
    stdout line from a long-running command or a WebSocket (`233682`, `187475`).

---

## 1. The Bash tool surface

### 1.1 Tool object

Defined at `515841` as `yi = kt({ name: Qe, … })` where `Qe === "Bash"`. Notable declarative fields:

```js
yi = kt({ name: Qe, enablesCodeExecution: !0, ruleContentField: "command",
          searchHint: "execute shell commands",
          remoteExecution: { supported: !0, refusedInputFields: qUt },
          maxResultSizeChars: 30000, strict: !0, … })
```
— `cli.pretty.js:515842`

`qUt` (the fields a *remote* execution refuses) is
`["dangerouslyDisableSandbox", "run_in_background", "_simulatedSedEdit"]` (`413894`).

`userFacingName()` returns `"SandboxedBash"` instead of `"Bash"` when
`CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR` is set and the call will be sandboxed (`515897`); it
returns the Edit tool's rendering when the command is a rewritable `sed -i` (`515894`, see §7.4).

### 1.2 Input schema (verbatim)

`cli.pretty.js:515719` — `wzt` is the full schema; `Tzt` is the model-facing one.

| field | type | notes |
|---|---|---|
| `command` | `string`, `.refine(e$, Ucr)` | required. `Ucr` = `"command contains control characters that would be hidden in the approval dialog"` |
| `timeout` | `number?`, wrapped in `NL(...)` | numeric-string-coercing; described as `` `Optional timeout in milliseconds (max ${F0()})` `` |
| `description` | `string?` | long guidance text, quoted below |
| `run_in_background` | `boolean?`, wrapped in `Yb(...)` | `"Set to true to run this command in the background."` — **omitted from the schema entirely when background tasks are disabled** |
| `dangerouslyDisableSandbox` | `boolean?`, wrapped in `Yb(...)` | `"Set this to true to dangerously override sandbox mode and run commands without sandboxing."` |
| `_simulatedSedEdit` | `{filePath, newContent, baseHash?}?` | `"Internal: pre-computed sed edit result from preview"` — **always stripped** from the model-facing schema |
| `…eEe()` | spread | additional gated fields |

The two wrappers are string-tolerant coercions, which matters for a replicator:

```js
function Yb(n = q()) { return Sa(q2t, n); }
function q2t(n) { return n === "true" ? !0 : n === "false" ? !1 : n; }   // 764470
function NL(e = v()) { return Sa(EN, e); }                               // 460123
// EN: trims, accepts /^[-+]?\d+(\.\d+)?$/ strings → Number
```

The model-facing schema:

```js
Tzt = m(() => ($d()
  ? wzt().omit({ run_in_background: !0, _simulatedSedEdit: !0 })
  : wzt().omit({ _simulatedSedEdit: !0 })).superRefine((e, t) => {}))
```
— `515719`. `$d()` is `j2().backgroundTasksDisabled || CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` (`233667`).

There is also a **legacy-shape coercion** (`HWt`, `515108`) that accepts `timeout_ms` and rewrites it
to `timeout`.

#### `description` field text (verbatim, `515719`)

```
Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.

For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
- ls → "List files in current directory"
- git status → "Show working tree status"
- npm install → "Install package dependencies"

For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:
- find . -name "*.tmp" -exec rm {} \; → "Find and delete all .tmp files recursively"
- git reset --hard origin/main → "Discard all local changes and match remote main"
- curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements"
```

### 1.3 Output schema (verbatim field list)

`Hcr` at `515744`. Fields the model or client sees:

- `stdout`, `stderr` — strings
- `rawOutputPath?` — "Path to raw output file for large MCP tool outputs"
- `interrupted` — bool
- `isImage?` — "Flag to indicate if stdout contains image data"
- `backgroundTaskId?` — "ID of the background task if command is running in background"
- `backgroundedByUser?` — "True if the user manually backgrounded the command with Ctrl+B"
- `backgroundedByTurnAbort?` — "@internal True if a plugin's turn abort moved the running command to the background"
- `backgroundedToDeliverMessage?` — "@internal True if the command was moved to the background so a message queued for the model could reach it"
- `timedOutAfterMs?` — "Set when the command hit its timeout and was auto-backgrounded; the timeout value in ms"
- `backgroundCwdHint?` — "Model-facing note that the session cwd was not changed by a backgrounded command containing a directory-change builtin (cd/pushd/popd/chdir)"
- `backgroundEndsWithFinalResponse?` (literal `true`) — "True when this backgrounded command is owned by a synchronous subagent and is therefore terminated when that agent gives its final response; absent when the command survives (main loop, async subagents)"
- `dangerouslyDisableSandbox?` — "Flag to indicate if sandbox mode was overridden"
- `returnCodeInterpretation?` — "Semantic interpretation for non-error exit codes with special meaning"
- `noOutputExpected?`
- `structuredContent?`
- `persistedOutputPath?` / `persistedOutputSize?` — "set when output is too large for inline"
- `staleReadFileStateHint?` — "Model-facing note listing readFileState entries whose mtime bumped during this command"
- `ghRateLimitHint?`
- `gitOperation?` — "Structured classification of git/gh operations detected in this command (commit/push/merge/rebase/PR). Client-facing — lets clients render git activity without re-parsing stdout; **not surfaced to the model**."

### 1.4 The tool prompt the model sees

`izt` (`515565`) is the dispatcher:

```js
async function izt(e, t, r = !1, o = []) {
  if (td(e)) return Scr(t, r, o);   // lean variant, per-model
  …                                  // full legacy variant
}
```

`td(e)` is `leanPrompt(model)` (`651364`), a per-model/gate decision. **Both variants exist in
2.1.251.** A replicator must decide which to emit; the lean one is what recent Opus-class models get.

#### 1.4a Lean variant (`Scr`, `515543`) — assembled text

Header + rules, in order:

```
Executes a bash command and returns its output.
[+ Windows Git-Bash note, if win32]

- Working directory persists between calls, but prefer absolute paths — `cd` in a compound command can trigger a permission prompt. Shell state (env vars, functions) does not persist; the shell is initialized from the user's profile.
- IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.
- Command output is displayed to you, not reliably to the user.
[- Commands are cheap to run and their errors are informative: run the straightforward command rather than perfecting it mentally first, and adjust from what it prints.]   ← gated on rZn()
- `timeout` is in milliseconds: default 120000, max 600000.
- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. No `&` needed.[ Foreground `sleep` is blocked; use Monitor with an until-loop to wait on a condition.]
```

The `find`/`grep` half of the avoid-list is dropped when `Ny()` is true — `Ny()` is the
"ant-native" build predicate (`413584`), which also shadows `find`/`grep` with `bfs`/`ugrep` in the
shell snapshot (§2.3). Then the lean git block (`_cr`, `515524`):

```
# Git
- Interactive flags (`-i`, e.g. `git rebase -i`, `git add -i`) are not supported in this environment.
- Use the `gh` CLI for GitHub operations (PRs, issues, API).
- Commit or push only when the user asks[ — and for a completed change, per the pre-ship gate below]. If on the default branch, branch first.
- End git commit messages with:
{attribution}
- End PR bodies with:
{pr attribution}
```

The Windows note (`nzt`, `515406`) verbatim:

> This tool runs Git Bash (POSIX sh), not cmd.exe or PowerShell. Use Unix shell syntax: `/dev/null`
> not `NUL`, forward slashes, `$VAR` not `%VAR%` or `$env:VAR`.
> [+ `Do not use PowerShell here-strings (@'…'@) or backtick continuation here — for multi-line
> strings use a heredoc.`]

#### 1.4b Full variant (`izt`, `515565`; assembled return at `515569`)

```
Executes a given bash command and returns its output.
[+ Windows note]

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

- File search: Use Glob (NOT find or ls)
- Content search: Use Grep (NOT grep or rg)
- Read files: Use Read (NOT cat/head/tail)
- Edit files: Use Edit (NOT sed/awk)
- Write files: Use Write (NOT echo >/cat <<EOF)
- Communication: Output text directly (NOT echo/printf)
While the Bash tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.

# Instructions
…
```

(The bullet strings are built from tool-name constants: `` `File search: Use ${ti} (NOT find or ls)` ``
etc.; `D$e` is the constant `"Communication: Output text directly (NOT echo/printf)"` at `515398`.)

The `# Instructions` list (`U` in `515565`) verbatim:

- "If your command will create new directories or files, first use this tool to run `ls` to verify the parent directory exists and is the correct location."
- `Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")`
- "Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it. In particular, never prepend `cd <current-directory>` to a `git` command — `git` already operates on the current working tree, and the compound triggers a permission prompt."
- "You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). By default, your command will timeout after 120000ms (2 minutes)."
- (`rzt()`, `515414`) "You can use the `run_in_background` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later. You do not need to check the output right away - you'll be notified when it finishes. You do not need to use '&' at the end of the command when using this parameter."
- "For git commands:" → nested:
  - "Prefer to create a new commit rather than amending an existing commit."
  - "Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach."
  - "Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue."
- "Avoid unnecessary `sleep` commands:" → nested:
  - "Do not sleep between commands that can run immediately — just run them."
  - (Monitor gate) `Use the Monitor tool to stream events from a background process (each stdout line is a notification). For one-shot "wait until done," use Bash with run_in_background instead.`
  - "If your command is long running and you would like to be notified when it finishes — use `run_in_background`. No sleep needed."
  - "Do not retry failing commands in a sleep loop — diagnose the root cause."
  - "If waiting for a background task you started with `run_in_background`, you will be notified when it completes — do not poll."
  - (Monitor gate) "Long leading `sleep` commands are blocked. To poll until a condition is met, use Monitor with an until-loop (e.g. `until <check>; do sleep 2; done`) — you get a notification when the loop exits. Do not chain shorter sleeps to work around the block."
  - (no Monitor) "If you must poll an external process, use a check command (e.g. `gh run view`) rather than sleeping first." / "If you must sleep, keep the duration short to avoid blocking the user."
- (ant-native only) "When running `find`, search from `.` (or a specific path), not `/` — scanning the full filesystem can exhaust system resources on large trees."
- (ant-native only) ``When using `find -regex` with alternation, put the longest alternative first. Example: use `'.*\.\(tsx\|ts\)'` not `'.*\.\(ts\|tsx\)'` — the second form silently skips `.tsx` files.``

#### 1.4c The git-commit / PR playbook (`ycr`, `515425`) — verbatim

Gated on `$q()` (`496993`), i.e. `includeGitInstructions` setting / `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS`.

```
# Committing changes with git

Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. The numbered steps below indicate which commands should be batched in parallel.

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., restore ., clean -f, branch -D) unless the user explicitly requests these actions. Taking unauthorized destructive actions is unhelpful and can result in lost work, so it's best to ONLY run these commands when given direct instructions
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- CRITICAL: Always create NEW commits rather than amending, unless the user explicitly requests a git amend. When a pre-commit hook fails, the commit did NOT happen — so --amend would modify the PREVIOUS commit, which may result in destroying work or losing previous changes. Instead, after hook failure, fix the issue, re-stage, and create a NEW commit
- When staging files, prefer adding specific files by name rather than using "git add -A" or "git add .", which can accidentally include sensitive files (.env, credentials) or large binaries
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive

1. Run the following bash commands in parallel, each using the Bash tool:
  - Run a git status command to see all untracked files. IMPORTANT: Never use the -uall flag as it can cause memory issues on large repos.
  - Run a git diff command to see both staged and unstaged changes that will be committed.
  - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
  - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
  - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
  - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
  - Ensure it accurately reflects the changes and their purpose
3. Run the following commands in parallel:
   - Add relevant untracked files to the staging area.
   - Create the commit with a message ending with:
   {ATTRIBUTION}
   - Run git status after the commit completes to verify success.
   Note: git status depends on the commit completing, so run it sequentially after the commit.
4. If the commit fails due to pre-commit hook: fix the issue and create a NEW commit

Important notes:
- NEVER run additional commands to read or explore code, besides git bash commands
- NEVER use the Read or Agent tools
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- IMPORTANT: Do not use --no-edit with git rebase commands, as the --no-edit flag is not a valid option for git rebase.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:
<example>
git commit -m "$(cat <<'EOF'
   Commit message here.

   {ATTRIBUTION}
   EOF
   )"
</example>
```

…then the PR section:

```
# Creating pull requests
Use the gh command via the Bash tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. Run the following bash commands in parallel using the Bash tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files (never use -uall flag)
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and `git diff [base-branch]...HEAD` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request title and summary:
   - Keep the PR title short (under 70 characters)
   - Use the description/body for details, not the title
3. Run the following commands in parallel:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.
<example>
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
{obe()}

## Test plan
{ibe()}

{PR ATTRIBUTION}
EOF
)"
</example>

Important:
- DO NOT use the Read or Agent tools
- Return the PR URL when you're done, so the user can see it

# Other common operations
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments
```

**The `Co-Authored-By` line itself** is built at `502427`:

```js
let e = QOt(), t = `Co-Authored-By: ${HZn(at())} <noreply@anthropic.com>`, r = Je(), o = r.attribution;
```

i.e. `Co-Authored-By: <display name> <noreply@anthropic.com>`, subject to the `attribution` setting.

#### 1.4d The pre-ship gate (`FPe`, `515387`)

New relative to February: if `/verify`, `/simplify`, `/code-review` skills are loaded, the Bash
prompt gains a paragraph forcing the model to state, immediately before `git commit`, whether each
named check RAN or was NOT RUN. Full text at `515387`; the operative clause:

> "Token budget, background mode, or autonomy level are not valid reasons to skip. A user request to
> ship or open a PR does not waive this; skip a check only if the user explicitly told you not to
> run it, and say so in that sentence, quoting their words."

---

## 2. Execution model

### 2.1 No persistent shell — per-command spawn

`LG(command, signal, "bash"|"powershell", opts)` at `472604` is the single shell-exec entry point
(Bash tool, Monitor, `!` passthrough, internal helpers all route through it). Nothing keeps a shell
alive between calls. `jht` (`472412`) is the bash *provider*:

```js
return { type: "bash", shellPath: e, detached: !0, stdin: "pipe",
         async buildExecCommand(_, C) { … }, getSpawnArgs(_) { … },
         async getEnvironmentOverrides(_, C, A) { … } };
```
— `472427`. Key facts: **`detached: true`** (own process group, so the whole tree can be killed with
`process.kill(-pid, …)`), **stdin is a pipe** (not a PTY).

`getSpawnArgs` (`472470`):

```js
getSpawnArgs(_) {
  let C = u !== void 0;                                   // u = snapshot path
  if (C) n("Spawning shell without login (-l flag skipped)");
  return ["-c", ...C ? [] : ["-l"], _];
}
```

So: **with a snapshot → `bash -c <cmd>`; without → `bash -c -l <cmd>`.** The snapshot replaces the
login shell.

### 2.2 The wrapper command string (`buildExecCommand`, `472427`–`472469`)

The literal `command` from the model is never the argv. It is embedded in an `&&`-joined preamble:

1. `source '<snapshot.sh>' 2>/dev/null || true` (if a snapshot exists)
2. Windows only: `export TEMP=… TMP=…[ TMPDIR=…]`
3. credential env block (`b2e(storageV5)`), unless `scrubCredentialEnv`
4. remote only: `export BUN_OPTIONS="--smol${BUN_OPTIONS:+ $BUN_OPTIONS}"`
5. extglob off — `fDn(shell)` at `472398`:
   `shopt -u extglob 2>/dev/null || true` (bash) /
   `setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true` (zsh)
6. `gDn()` (`472404`): `{ \builtin unalias -- 'unsetenv'; \builtin unset -f -- 'unsetenv'; } >/dev/null 2>&1 || true`
7. optional "sl-gate" PATH/PYTHONPATH carrier (`Dht`, `472390`)
8. `eval '<the model's command>'`
9. `pwd -P >| '<cwd file>'`

then, if `CLAUDE_CODE_SHELL_PREFIX` is set, the whole thing is wrapped by that prefix (`472467`).

Two pre-passes run on the raw command first:
- `Cht` (`472341`): rewrites `>NUL` → `>/dev/null` unless the command contains `<`, `$`, or a backtick.
- `vht`/`bht` (`472049`): quoting for `eval`. If the command contains a pipe and is "simple enough"
  (`Eht`, `472334` — no heredoc, no input redirect), `< /dev/null` is appended
  (`bht`: `` "'" + e.replaceAll("'", `'"'"'`) + "'" + " < /dev/null" ``) so a piped command cannot
  block on stdin.

Heredoc detection is regex-based (`lCe`, `472308`) and deliberately excludes bit-shift lookalikes
(`2<<3`, `$(( a<<b ))`, `[[ 1 << 2 ]]`).

### 2.3 The shell snapshot

Written once per session by `wht` (`472229`). Path:

```js
let A = mre(be(), "shell-snapshots");
let M = mre(A, `snapshot-${r}-${_}-${C}${x !== void 0 ? `-${x}` : ""}.sh`);
//        r = "zsh"|"bash"|"sh", _ = Date.now(), C = 6 random base36 chars, x = session tag
```
— `472238`–`472240`. `be()` is the Claude home (`~/.claude`). The file is **unlinked at process exit**
(`vt(async () => { await le().unlink(M) … })`, `472285`).

It is generated by running the user's real shell with a **generator script** (`JOn`, `472204`) —
i.e. the harness sources your rc file once and then *dumps* the resulting state into a flat script:

```sh
SNAPSHOT_FILE='<path>'
source "<~/.zshrc|~/.bashrc|~/.profile>" < /dev/null

# First, create/clear the snapshot file
echo "# Snapshot file" >| "$SNAPSHOT_FILE"

# When this file is sourced, we first unalias to avoid conflicts
# This is necessary because aliases get "frozen" inside function definitions at definition time,
# which can cause unexpected behavior when functions use commands that conflict with aliases
echo "# Unset all aliases to avoid conflicts with functions" >> "$SNAPSHOT_FILE"
echo "unalias -a 2>/dev/null || true" >> "$SNAPSHOT_FILE"

<capture block>
<ripgrep / find / grep / pkill / PATH block>

# Exit silently on success, only report errors
if [ ! -f "$SNAPSHOT_FILE" ]; then
  echo "Error: Snapshot file was not created at $SNAPSHOT_FILE" >&2
  exit 1
fi
```

Config file choice (`iCe`, `472084`): `.zshrc` if the shell path contains `zsh`, `.bashrc` if it
contains `bash`, else `.profile` — always under `os.homedir()`. If it doesn't exist, the snapshot is
built from Claude Code defaults only.

The capture block (`XOn`, `472088`) verbatim, **zsh branch**:

```sh
echo "# Functions" >> "$SNAPSHOT_FILE"

# Force autoload all functions first
typeset -f > /dev/null 2>&1

# Now get user function names - filter completion functions (single underscore prefix)
# but keep double-underscore helpers (e.g. __zsh_like_cd from mise, __pyenv_init)
typeset +f | grep -vE '^_[^_]' | while read func; do
  typeset -f "$func" >> "$SNAPSHOT_FILE"
done

echo "# Shell Options" >> "$SNAPSHOT_FILE"
setopt | sed 's/^/setopt /' | head -n 1000 >> "$SNAPSHOT_FILE"
```

**bash branch**:

```sh
# shopt before functions: a body using extglob/globstar syntax only
# re-parses with the option on.
echo "# Shopt" >> "$SNAPSHOT_FILE"
shopt -p | head -n 1000 >> "$SNAPSHOT_FILE"

echo "# Functions" >> "$SNAPSHOT_FILE"

# Force autoload all functions first
declare -f > /dev/null 2>&1

# Now get user function names - filter completion functions (single underscore prefix)
# but keep double-underscore helpers (e.g. __zsh_like_cd from mise, __pyenv_init)
# One eval per function so a body that no longer parses (rc=2, not fatal
# in non-POSIX bash) drops only itself. The %q literal needs no fork
# at source time, unlike a base64 command substitution.
declare -F | cut -d' ' -f3 | grep -vE '^_[^_]' | while read func; do
  printf 'eval %q > /dev/null 2>&1\n' "$(declare -f "$func")" >> "$SNAPSHOT_FILE"
done

echo "# Shell Options" >> "$SNAPSHOT_FILE"
set -o | grep "on" | awk '{print "set -o " $1}' | head -n 1000 >> "$SNAPSHOT_FILE"
echo "shopt -s expand_aliases" >> "$SNAPSHOT_FILE"
```

Both branches then capture aliases:

```sh
echo "# Aliases" >> "$SNAPSHOT_FILE"
# Filter out winpty aliases on Windows to avoid "stdin is not a tty" errors
# Git Bash automatically creates aliases like "alias node='winpty node.exe'" for
# programs that need Win32 Console in mintty, but winpty fails when there's no TTY
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
  alias | grep -v "='winpty " | sed 's/^alias //g' | sed 's/^/alias -- /' | head -n 1000 >> "$SNAPSHOT_FILE"
else
  alias | sed 's/^alias //g' | sed 's/^/alias -- /' | head -n 1000 >> "$SNAPSHOT_FILE"
fi
```

Note the `head -n 1000` cap on shopt/setopt/set-o/aliases — a hard ceiling a replicator must match.

Then `QOn` (`472147`) appends the tool-shadowing block:

- **ripgrep** (`zOn`, `472057`): if the binary supports `argv0` dispatch, a *shell function* is
  written; otherwise an alias. Both are wrapped in
  `if ! (unalias rg 2>/dev/null; command -v rg) >/dev/null 2>&1; then … fi` — i.e. only shadow `rg`
  when the user has none.
- **find/grep** (`qOn`, `472065`, ant-native builds only): unconditionally `unalias find`/`unalias grep`
  then define functions dispatching to embedded `bfs` and `ugrep`:
  `sCe("find", "bfs", ["-S","dfs","-regextype","findutils-default"])` and
  `sCe("grep", "ugrep", ["-G","--ignore-files","--hidden","-I","--exclude-dir=.git",…,".jj",".sl"])`.
- **pkill** (`KOn`, `472071`) — a self-protection shim, verbatim:

```sh
unalias pkill 2>/dev/null || true
function pkill {
  if [ -n "${CLAUDE_PID:-}" ] && [ -r "/proc/${CLAUDE_PID}/comm" ]; then
    local _cc_skip="" _cc_a
    local -a _cc_probe=()
    for _cc_a in ${1+"$@"}; do
      if [ -n "$_cc_skip" ]; then _cc_skip=""; continue; fi
      case "$_cc_a" in
        --signal) _cc_skip=1 ;;
        --signal=*|-e|--echo) ;;
        -[0-9]*) ;;
        -[PUGOF]?*) _cc_probe+=("$_cc_a") ;;
        -[ABCDEFGHIJKLMNOPQRSTUVWXYZ][ABCDEFGHIJKLMNOPQRSTUVWXYZ0-9]*) ;;
        *) _cc_probe+=("$_cc_a") ;;
      esac
    done
    if command pgrep ${_cc_probe[@]+"${_cc_probe[@]}"} 2>/dev/null | command grep -qx "${CLAUDE_PID}"; then
      printf 'pkill: refusing to run — this pattern matches the Claude CLI process (PID %s). Narrow the pattern, or target your own children with `pkill -P $$ ...`.\n' "${CLAUDE_PID}" >&2
      return 1
    fi
  fi
  command pkill ${1+"$@"}
}
```

Finally `PATH` is pinned with a randomized heredoc terminator to defeat injection:

```sh
# Add PATH to the file
cat >> "$SNAPSHOT_FILE" << 'PATH_END_<16 random base36 chars>'
export PATH=<quoted PATH>
PATH_END_<same>
```
— `472195`–`472201`.

The generator runs with a **10 s timeout** (`fre = 1e4`, `472051`), `maxBuffer: 1048576`, and env
`{...(CLAUDE_CODE_DONT_INHERIT_ENV ? {} : inherited), SHELL, GIT_EDITOR: "true", CLAUDECODE: "1"}`
(`472251`). Failure telemetry: `tengu_shell_snapshot_failed`, `tengu_shell_unknown_error`,
`tengu_shell_snapshot_error`.

A second probe, `Tht` (`472293`), runs `<shell> -c env` and records the *names* of variables the
login environment defines, used later to reason about which env vars a command could alter.

**Cadence: once per process.** `oyt` memoizes into `m0.shellConfig` (`472581`); `J9n` (`472592`)
resets it. There is no refresh on rc-file change.

### 2.4 Login shell selection (`EDn`, `472545`)

```js
let e = a.CLAUDE_CODE_SHELL;
if (e) if ((e.includes("bash") || e.includes("zsh")) && await dCe(e)) return e;
       else n(`CLAUDE_CODE_SHELL="${e}" is not a valid bash/zsh path, falling back to detection`);
let t = a.SHELL, r = t && (t.includes("bash") || t.includes("zsh")), o = t?.includes("bash");
let [u, d] = await Promise.all([Va("zsh"), Va("bash")]);         // which zsh / which bash
let _ = ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
let A = (o ? ["bash","zsh"] : ["zsh","bash"]).flatMap(M => _.map(F => `${F}/${M}`));
…
if (r && await dCe(t)) A.unshift(t);       // $SHELL wins if it's bash/zsh and executable
```

So the order is: `CLAUDE_CODE_SHELL` → `$SHELL` (only if bash/zsh) → `which bash|zsh` (preferring the
family `$SHELL` names) → the four fixed prefixes. `dCe` (`472536`) tests `X_OK` and falls back to
running `--version`. On total failure it throws:

> "No suitable shell found. Claude CLI requires a Posix shell environment. Please ensure you have a
> valid shell installed and the SHELL environment variable set."

`fish`, `nu`, `csh` etc. are never used as the executor.

### 2.5 Environment handed to the child

`xDn` (`472815`):

```js
{ ...Na(),                                   // the sanitized base env
  SHELL: shellType === "bash" ? binShell : undefined,
  GIT_EDITOR: "true",
  ...envOverrides, ...sandboxEnv,
  ...Oxe({ sessionId, effortLevel, source: "agent" }),
  ...(unsetEnv && Object.fromEntries(unsetEnv.map(k => [k, undefined]))) }
```

`Oxe` (`431800`) injects:

```js
{ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: <id>, CLAUDE_CODE_CHILD_SESSION: "1",
  CLAUDE_PID: String(process.pid),
  [AI_AGENT], [CLAUDE_EFFORT], [TRACEPARENT] }
```

`getEnvironmentOverrides` (`472475`) adds `CLAUDE_CODE_EXECPATH = process.execPath` and, when
sandboxed, `TMPDIR`, `CLAUDE_CODE_TMPDIR`, `TMPPREFIX = <tmp>/zsh`.

Temp dir: `ly()` = `CLAUDE_CODE_TMPDIR || "/tmp"`; `xl()` = `<ly()>/claude-<uid>`, created `0700` and
**ownership-verified** (`dY`, `756731`) — it refuses a pre-created dir owned by another uid, refuses
symlinks (`O_NOFOLLOW`), and chmods back to `0700`. `pY()` (`756805`) falls back to
`/tmp/claude-<uid>` when the path exceeds 44 bytes, because AF_UNIX socket paths must fit.

`Vd` (`775046`) is the allowlist of env var *names* that survive sanitization into children; it
includes `PATH SHELL TERM COLORTERM LANG TZ USER TMPDIR HTTP_PROXY HTTPS_PROXY NO_PROXY
NODE_TLS_REJECT_UNAUTHORIZED …` and the `BASH_*` knobs.

### 2.6 cwd tracking and why `cd` prompts

After each command the wrapper writes `pwd -P` into `<tmp>/claude-<id>-cwd` (or
`<sandboxTmpDir>/cwd-<id>` when sandboxed). On completion (`472740`) the harness reads **at most
65536 bytes** (`vDn`, `472535`) and runs it through `zht` (`472487`), which rejects the value if it:

- contains a dot-segment → `"shell cwd read-back contains a dot-segment; ignoring"`
- is an NT-namespace device path → `"…is an NT-namespace device path; ignoring"`
- is a network path (Windows) → `"…is a network path; ignoring"`
- crosses a foreign automount host → `"…crosses a foreign automount host; ignoring"`
- is not absolute → `"…is not an absolute path; ignoring"`
- resolves through a network symlink/junction → `"…resolves through a network symlink/junction; ignoring"`
- is not a directory / not readable → `"…is not a directory; ignoring"` / `"…is not readable; ignoring"`

Telemetry on failure: `tengu_shell_set_cwd {success:false}`.

The **permission** side is separate and is where "`cd` can trigger a prompt" comes from
(§5.5): `Lb` (`443587`) recognizes `cd|pushd|popd|chdir` after wrapper-stripping; `fL` (`443591`)
answers "does any sub-command change directory". Multiple `cd`s in one command produce
`"Multiple directory changes in one command require approval for clarity"` (`443458`), and `cd` + `git`
produces a dedicated safety ask (§5.5).

`CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` and `T1t` (`472914`) reset the shell cwd back to the
project dir between calls; the model-facing note is `w1t` (`472912`):

```js
var w1t = (e) => `${e.trim()}
Shell cwd was reset to ${ee()}`
```

### 2.7 Pipe, not PTY

`MDn` (`472818`) builds `stdio`:

```js
function MDn(e, t, r, o) {
  let u = t ? [e, "pipe", "pipe"] : [e, r, r];   // t = "caller wants onStdout"
  if (o !== void 0) u[rmn] = o;                  // extra fd (sandbox observer socket)
  return u;
}
```

Default path (`t` false): **stdout and stderr are both the same file descriptor**, an fd opened on
the task's output file (`nLe(zn.path, "w")`, `472712`). That is why stdout/stderr interleave in
timestamp order on disk. When a caller supplies `onStdout` (Monitor, `!` passthrough), real pipes are
used and stderr is tagged separately.

There is a `(allow pseudo-tty)` branch in the sandbox profile (`683455`) but it is for programs that
allocate their own pty; Claude Code does **not** give the command a controlling terminal.

---

## 3. Timeouts and output

### 3.1 Timeout constants

```js
var $qt = new Set, Uqt = 120000, Bqt = 600000;                          // 413444
function aye(e = process.env) {                                          // 413445  → default
  let t = e.BASH_DEFAULT_TIMEOUT_MS;
  if (t) { let r = ol(t); if (!isNaN(r) && r > 0) return r; }
  return Uqt;
}
function K9e(e = process.env) {                                          // 413454  → max
  let t = e.BASH_MAX_TIMEOUT_MS;
  if (t) { let r = ol(t); if (!isNaN(r) && r > 0) return Math.max(r, aye(e)); }
  return Math.max(Bqt, aye(e));
}
```

**Confirmed: 120000 default, 600000 max**, both env-overridable, with `max >= default` enforced.
The prompt text and the schema description both interpolate these live.

Effective per-call timeout (`516108`):

```js
let Pe = Math.min(Oe || bK(), F0(), r?.maxTimeoutMs ?? Infinity);
```
i.e. `min(requested || default, max, remote-constraint-max)`. Then `WMt` (`413466`) may shrink it
further when `CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS` is set and the call can auto-background:
`Math.min(effective, Math.max(envValue, 2000))` (`Hqt = 2000`, `413465`).

`LG`'s own fallback when no timeout is passed is `TDn = 1800000` (30 min, `472535`) — used by
Monitor and internal helpers, not by the Bash tool.

### 3.2 Output caps and the truncation message

```js
var Hin = 150000, xin = 30000;                                           // 414416
function cye() {                                                          // 414417
  return uee("BASH_MAX_OUTPUT_LENGTH", process.env.BASH_MAX_OUTPUT_LENGTH, xin, Hin).effective;
}
```

`uee` (`414400`) validates the env override and logs one of:
- `` `Invalid value "${t}" (using default: ${r})` ``
- `` `Capped from ${u} to ${o}` ``

Truncation (`uyt`, `472893`) — **verbatim**:

```js
function uyt(e) {
  let t = aut(e);                                   // data:image/… → never truncate
  if (t) return { totalLines: 1, truncatedContent: e, isImage: t };
  let r = cye();
  if (e.length <= r) return { totalLines: Pn(e, "\n") + 1, truncatedContent: e, isImage: t };
  let o = e.slice(0, r), u = Pn(e, "\n", r) + 1, d = `${o}\n\n... [${u} lines truncated] ...`;
  return { totalLines: Pn(e, "\n") + 1, truncatedContent: d, isImage: t };
}
```

So the exact marker is:

```
<first 30000 chars>

... [N lines truncated] ...
```

where **N is the number of lines in the *kept* prefix + 1**, not the number dropped. (This looks like
a bug, or at least a counter-intuitive label, and is worth replicating deliberately.)

The separate `TaskOutput` truncation (`475960`) uses `TASK_MAX_OUTPUT_LENGTH` (default `32000`,
ceiling `160000`) and prepends:

```
[Truncated. Full output: <path>]

```
or, when the path is omitted:
```
[Truncated to the last <N> characters; the earlier part of the report is not retrievable.]

```

### 3.3 In-memory buffer → spill file

`jx` (`414494`) is the output collector.

- In-memory cap `NKt = 8388608` (8 MB, `414458`).
- Below the cap, stdout and stderr accumulate in **two separate strings**.
- Above it, `#p` opens a spill file and everything is appended **interleaved**, with stderr chunks
  prefixed `[stderr] ` (`414547`, `414561`).
- Once spilled, `getStderr()` returns `""` and `getStdout()` returns the last 5 lines plus:

```
Output truncated (<KB>KB total). Full output saved to: <path>
```
or, if the spill failed:
```
Output truncated (<KB>KB total). The full output could not all be saved to <path>; that file may be missing or incomplete.
```
— `414571`.

If the output file is unreadable at read time:

```
<bash output unavailable: output file <path> could not be read (<CODE>). This usually means another Claude Code process in the same project deleted it during startup cleanup.>
```
— `414601`.

Live progress is sampled by a `wde(1000)` ring buffer of recent lines plus a 1 s poll
(`$Kt = 1000`, `414458`) reading the tail (`UKt = 4096` bytes) — this drives the TUI's rolling
5-line / 100-line preview and the `bash_progress` tool-progress events (`516135`).

Disk-full detection (`KKt`, `414643`) produces:

```
Command output was lost: the temp filesystem at <dir> is full (<N>MB free). The child process's stdout/stderr writes failed with ENOSPC. Free up space or set CLAUDE_CODE_TMPDIR to a directory on a filesystem with room.
```
(and an out-of-inodes variant).

### 3.4 Exit codes and their reporting

Sentinels (`414616`): `GU = 137` (SIGKILL / interrupt), `WUe = 143` (SIGTERM / timeout).
`#C` maps a null exit code with SIGTERM to `144`; a spawn `error` event to `1`; abort-before-spawn to
`145` with stderr `"Command aborted before execution"` (`414892`).

Post-exit stderr/stdout prefixes (`414780`–`414793`):

- `Command killed: its output file was replaced or could no longer be verified`
- `` `Command killed: output file exceeded ${jjt}` ``
- `` `Command timed out after ${$t(this.#p)}` `` — e.g. `Command timed out after 2m`

Kill sequence (`#h`, `414800`): `SIGTERM` to the pid, then a 1500 ms backstop
(`WKt = 1500`) after which `process.kill(-pid, "SIGKILL")` reaps the whole process group, polling
every 100 ms (`zKt`).

The model-facing exit-code line is appended by the tool `call` (`516010`):

```js
if (z.isError && !ct) { if (ge.code !== 0) F.append(`Exit code ${ge.code}`); }
```

`returnCodeInterpretation` comes from `Wlr` (`515092`), a per-binary table:

```js
Hlr = (e) => ({ isError: e !== 0, message: e !== 0 ? `Command failed with exit code ${e}` : undefined });
ov  = (msg) => (t) => ({ isError: t >= 2, message: t === 1 ? msg : undefined });
jlr = new Map([
  ["grep",  ov("No matches found")], ["rg", ov("No matches found")],
  ["egrep", ov("No matches found")], ["fgrep", ov("No matches found")],
  ["find",  ov("Some directories were inaccessible")],
  ["diff",  ov("Files differ")],
  ["test",  ov("Condition is false")], ["[", ov("Condition is false")]]);
```

plus `git diff` → `"Files differ"` and `git grep` → `"No matches found"` (`515100`). Crucially, for
these binaries **exit 1 is not an error** — only `>= 2` is. The base command is taken from the **last**
sub-command in the split (`Ua(e).at(-1)`).

`noOutputExpected` (`Ncr`, `515705`) is true when every sub-command's head word is in
`Fcr = {mv, cp, rm, mkdir, rmdir, chmod, chown, chgrp, touch, ln, cd, export, unset, wait}` (`515679`).

### 3.5 Interrupt / abort framing

If the tool result is an error and the command was aborted, the harness appends (`515960`):

```
<error>Command was aborted before completion</error>
```

Errors are thrown as `ux` carrying `{stdout, stderr, code, interrupted, hadSandboxViolation}`
(`516045`). Stdout leading blank lines are stripped and trailing whitespace trimmed before the model
sees it (`515949`).

### 3.6 Persisted large output

When the run produced an output file, `I$t` (`515067`) copies it into the session's `tool-results`
directory and the result carries `persistedOutputPath` / `persistedOutputSize`; the model sees a
preview envelope built by `rue(...)` instead of the full text (`515952`).

---

## 4. Sandboxing

### 4.0 Two layers

The sandbox is **not** hand-rolled in the CLI. It is a vendored copy of
`@anthropic-ai/sandbox-runtime` ("srt") inlined into the bundle, plus a thin Claude Code manager on
top.

- **Layer A — sandbox-runtime**, `cli.pretty.js:680300`–`684760`. Platform wrappers (macOS seatbelt,
  Linux bwrap, Windows `srt-win`), the in-process HTTP/SOCKS mux proxy, the violation stores, the
  credential-sentinel machinery. Exported as one object literal `ct` at `684740`.
- **Layer B — Claude Code's sandbox manager**, `cli.pretty.js:685980`–`688060`. Reads settings,
  builds the srt config, applies policy gates, wraps `ct`. Exported as `pt` at `688045` — this is the
  `pt.isSandboxingEnabled()` / `pt.wrapWithSandbox()` / `pt.annotateStderrWithSandboxFailures()`
  object referenced throughout the Bash tool.

A replicator can treat the boundary as real: Layer A is a general-purpose library with no Claude
concepts in it; Layer B is where settings, permission modes, and the `/sandbox` command live.

### 4.1 Where the decision is made

`bv(input, opts)` (`443645`) is the single "should this run sandboxed" predicate:

```js
function bv(e, t) {
  if (bu() && l$()) return !0;                                  // forced-confining contexts
  if (!pt.isSandboxingEnabled()) return !1;
  if ((e.shellType ?? "bash") === "bash" && D() === "windows" && WN() === null) return !1;   // no Git Bash
  let r = t?.disableUnsandboxedCommands === !0 || j2().unsandboxedCommandsDisabled || a.CLAUDE_CODE_EVAL_CONFINED;
  if (e.dangerouslyDisableSandbox && !r && pt.areUnsandboxedCommandsAllowed()) return !1;
  if (!e.command) return Boolean(r);
  if (!r && zrn(e.command)) return !1;                          // sandbox.excludedCommands match
  return !0;
}
```

`zrn` (`443600`) matches the command — and its wrapper-stripped and `LD_*`/`DYLD_*`/`PATH`-stripped
variants — against `settings.sandbox.excludedCommands`, using three rule shapes (`443634`):

```js
case "prefix":   return t === e.prefix || t.startsWith(e.prefix + " ");
case "exact":    return t === e.command;
case "wildcard": return NP(e.pattern, t);
```

### 4.2 Settings schema (verbatim descriptions, `111182`)

```
sandbox: {
  enabled?: boolean
  failIfUnavailable?: boolean
    "Exit with an error at startup if sandbox.enabled is true but the sandbox cannot start (missing
     dependencies or unsupported platform). When false (default), a warning is shown and commands run
     unsandboxed. Intended for managed-settings deployments that require sandboxing as a hard gate."
  autoAllowBashIfSandboxed?: boolean
  allowUnsandboxedCommands?: boolean
    "Allow commands to run outside the sandbox via the dangerouslyDisableSandbox parameter. When
     false, the dangerouslyDisableSandbox parameter is completely ignored and all commands must run
     sandboxed. Default: true."
  network: { … }            // httpProxyPort, socksProxyPort, tlsTerminate, allowUnixSockets,
                            // allowAllUnixSockets, allowMachLookup, …
  filesystem: { … }         // disabled, allowWrite[], denyWrite[], denyRead[], …
  credentials: { … }        // envVars[{name, mode:"deny"|"mask"}], allowPlaintextInject
  ignoreViolations?: Record<string, string[]>
  enableWeakerNestedSandbox?: boolean
  enableWeakerNetworkIsolation?: boolean
    "macOS only: Allow access to com.apple.trustd.agent in the sandbox. Needed for Go-based CLI tools
     (gh, gcloud, terraform, etc.) to verify TLS certificates when using httpProxyPort with a MITM
     proxy and custom CA. **Reduces security** — opens a potential data exfiltration vector through
     the trustd service. Default: false"
  allowAppleEvents?: boolean
    "macOS only: Allow sandboxed commands to send Apple Events (and look up the appleeventsd Mach
     service). Needed for `open`, `osascript`, and browser-based auth flows that open URLs.
     **Removes code-execution isolation** — sandboxed commands can launch other applications
     unsandboxed with no user prompt, and can script running apps (e.g. Terminal) subject to the
     user's per-app TCC automation consent. Only honored from user, managed/policy, or CLI
     (--settings) settings — project settings (.claude/settings.json and .claude/settings.local.json)
     are ignored. Default: false"
  excludedCommands?: string[]
  ripgrep?: { command, args? }   // "Only honored from user, managed/policy, or CLI (--settings) settings…"
  bwrapPath?: string             // "Linux/WSL only: Absolute path to the bwrap (bubblewrap) binary.
                                 //  Overrides auto-detection via PATH. Only honored from admin-controlled
                                 //  managed settings."
  socatPath?: string             // "Linux/WSL only: Absolute path to the socat binary used for the
                                 //  sandbox network proxy. …"
}
```

Two provenance guards live at `111004`:
`Je = ["bwrapPath","ripgrep","socatPath"]` (managed-settings only) and
`qe = ["allowAppleEvents","credentials","enableWeakerNestedSandbox","enableWeakerNetworkIsolation",
"filesystem.disabled","network.allowAllUnixSockets","network.allowMachLookup",
"network.allowUnixSockets","network.httpProxyPort","network.socksProxyPort","network.tlsTerminate"]`
(not honored from project settings).

### 4.3 macOS: the generated seatbelt profile

`PR({readConfig, writeConfig, httpProxyPort, socksProxyPort, needsNetworkRestriction, allowUnixSockets,
allowAllUnixSockets, allowLocalBinding, allowMachLookup, allowPty, allowGitConfig,
enableWeakerNetworkIsolation, allowAppleEvents, logTag})` at `683431` builds the SBPL text. The
static preamble, **verbatim**:

```scheme
(version 1)
(deny default (with message "<LOGTAG>"))

; LogTag: <LOGTAG>

; Essential permissions - based on Chrome sandbox policy
; Process permissions
(allow process-exec)
(allow process-fork)
(allow process-info* (target same-sandbox))
(allow signal (target same-sandbox))
(allow mach-priv-task-port (target same-sandbox))

; User preferences
(allow user-preference-read)

; Mach IPC - specific services only (no wildcard)
(allow mach-lookup
  (global-name "com.apple.audio.systemsoundserver")
  (global-name "com.apple.distributed_notifications@Uv3")
  (global-name "com.apple.FontObjectsServer")
  (global-name "com.apple.fonts")
  (global-name "com.apple.logd")
  (global-name "com.apple.lsd.mapdb")
  (global-name "com.apple.PowerManagement.control")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.securityd.xpc")
  (global-name "com.apple.coreservices.launchservicesd")
)
```

Conditional blocks that follow:

```scheme
; trustd.agent - needed for Go TLS certificate verification (weaker network isolation)
(allow mach-lookup (global-name "com.apple.trustd.agent"))          ; iff enableWeakerNetworkIsolation

; Apple Events - opt-in; needed for open/osascript to talk to other apps (appleeventsd)
(allow appleevent-send)                                              ; iff allowAppleEvents
(allow mach-lookup (global-name "com.apple.coreservices.appleevents"))
; Launch Services open requests need the lsopen operation plus, on
; macOS 14/15, coreservicesd and the quarantine resolver - without
; these open fails with -10822 kLSServerCommunicationErr or -54
(allow lsopen)
(allow mach-lookup (global-name "com.apple.CoreServices.coreservicesd"))
(allow mach-lookup (global-name "com.apple.coreservices.quarantine-resolver"))

; User-specified XPC/Mach services                                   ; from network.allowMachLookup
(allow mach-lookup (global-name-prefix "<prefix>"))   |  (allow mach-lookup (global-name "<name>"))
```

then the fixed tail:

```scheme
; POSIX IPC - shared memory
(allow ipc-posix-shm)

; POSIX IPC - semaphores for Python multiprocessing
(allow ipc-posix-sem)

; IOKit - specific operations only
(allow iokit-open
  (iokit-registry-entry-class "IOSurfaceRootUserClient")
  (iokit-registry-entry-class "RootDomainUserClient")
  (iokit-user-client-class "IOSurfaceSendRight")
)

; IOKit properties
(allow iokit-get-properties)

; Specific safe system-sockets, doesn't allow network access
(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))

; sysctl - specific sysctls only
(allow sysctl-read
  (sysctl-name "hw.activecpu") … (sysctl-name "kern.version") …
  (sysctl-name-prefix "hw.optional.arm") (sysctl-name-prefix "hw.perflevel")
  (sysctl-name-prefix "kern.proc.all") (sysctl-name-prefix "kern.proc.pgrp.")
  (sysctl-name-prefix "kern.proc.pid.") (sysctl-name-prefix "machdep.cpu.")
  (sysctl-name-prefix "net.routetable.")
)

; V8 thread calculations
(allow sysctl-write
  (sysctl-name "kern.tcsm_enable")
)

; Distributed notifications
(allow distributed-notification-post)

; Specific mach-lookup permissions for security operations
(allow mach-lookup (global-name "com.apple.SecurityServer"))

; File I/O on device files
(allow file-ioctl (literal "/dev/null"))
(allow file-ioctl (literal "/dev/zero"))
(allow file-ioctl (literal "/dev/random"))
(allow file-ioctl (literal "/dev/urandom"))
(allow file-ioctl (literal "/dev/dtracehelper"))
(allow file-ioctl (literal "/dev/tty"))

(allow file-ioctl file-read-data file-write-data
  (require-all
    (literal "/dev/null")
    (vnode-type CHARACTER-DEVICE)
  )
)
```

(The full `sysctl-read` list — ~55 entries — is on the single line `683432`.)

**Network section** (`683433`):

```scheme
; Network
(allow network*)                                       ; when no restriction is needed
```
otherwise, selectively:

```scheme
(allow network-bind (local ip "*:*"))                  ; allowLocalBinding
(allow network-inbound (local ip "*:*"))
(allow network-outbound (remote ip "localhost:*"))

(allow system-socket (socket-domain AF_UNIX))          ; allowAllUnixSockets
(allow network-bind (local unix-socket (path-regex #"^/")))
(allow network-outbound (remote unix-socket (path-regex #"^/")))

(allow system-socket (socket-domain AF_UNIX))          ; per-path allowUnixSockets
(allow network-bind (local unix-socket (subpath "<path>")))
(allow network-outbound (remote unix-socket (subpath "<path>")))

(allow network-bind    (local  ip "localhost:<httpProxyPort>"))    ; the proxy loopback holes
(allow network-inbound (local  ip "localhost:<httpProxyPort>"))
(allow network-outbound (remote ip "localhost:<httpProxyPort>"))
(… same three for socksProxyPort when different)
```

**Everything else is denied by `(deny default)`** — a sandboxed command's only route off-box is the
loopback proxy.

**File read** (`kR`, `683401`): when no read config, `(allow file-read*)`. Otherwise:
`(allow file-read*)` then a deny set built from `denyOnly` (subpath or regex per glob-ness), an allow
set from `allowWithinDeny`, glob-aware re-denies (`CR`, `683344`), `(allow file-read* (literal "/"))`
when a deny covers root, `(allow file-read-metadata (vnode-type DIRECTORY))` so `ls` of a denied dir
still stats, then `Zh(...)` deny-unlink/create around read-denied paths, then
`(allow file-write-unlink file-write-create …)` for the write roots.

**File write** (`DR`, `683419`): `(allow file-write* (subpath …))` for `allowOnly`, then
`(deny file-write* …)` for `denyWithinAllow` **plus an unconditional built-in list** (`vR`, `683275`):

```js
Go = [".gitconfig", ".gitmodules", ".bashrc", ".bash_profile", ".zshrc",
      ".zprofile", ".profile", ".ripgreprc", ".mcp.json"];        // 680305
Dv = [".git", ".vscode", ".idea"];
lc() → [".vscode", ".idea", ".claude/commands", ".claude/agents"]  // 680306
// vR() → resolve(cwd, X) and `**/X` for each of Go; resolve(cwd,X) and `**/X/**` for each lc();
//        plus .git/hooks (always) and .git/config (unless allowGitConfig)
```

So **a sandboxed command can never write your rc files, `.mcp.json`, `.git/hooks`, `.git/config`, or
`.claude/commands` / `.claude/agents`** even inside an allowed write root. This is the anti-persistence
core of the design.

Every deny/allow group is emitted by `Bs` (`683367`) as
`` `(deny file-write* … (with message "<LOGTAG>"))` ``, so violations are attributable in the log
stream.

**Final argv** (`qh`, `683467`):

```js
["env", ...unsetEnv.flatMap(v => ["-u", v]), ...setEnvPairs, ...proxyEnvPairs,
 "/usr/bin/sandbox-exec", "-p", <profile text>, <resolved shell>, "-c", <command>]
```

If nothing needs restricting (`!needsNetworkRestriction && !denies && !writeConfig && !envChanges &&
!gitSafeDirs`) the command is returned **unwrapped**.

`LOGTAG` is per-command, not per-process. `Hh` is minted once
(`` var Hh = `_${Math.random().toString(36).slice(2,11)}_SBX` ``, `683285`), and each command's tag is

```js
function NR(e) { return `CMD64_${Er(e)}_END_${Hh}`; }                       // 683286
function Er(e) { let t = e.slice(0,100); return Buffer.from(t).toString("base64"); }  // 680483
```

i.e. `CMD64_<base64 of the first 100 chars of the command>_END__<9 random chars>_SBX`. That tag goes
into **every** `(with message …)` clause including `(deny default …)`, so a `log stream` line can be
attributed to the exact command that caused it.

**Always-writable roots** — `Pz()` at `680416` — are prepended to `allowOnly` on both macOS and
Linux:

```js
["/dev/stdout","/dev/stderr","/dev/null","/dev/tty","/dev/dtracehelper",
 "/dev/autofs_nowait","/tmp/claude","/private/tmp/claude",
 join(home, ".npm/_logs"), join(home, ".claude/debug")]
```

**Glob→regex** — `Ho(e)` at `680501` — is the translation used wherever a path contains a wildcard:

```js
"^" + e.replace(/[.^$+{}()|\\]/g,"\\$&").replace(/\[([^\]]*?)$/g,"\\[$1")
      .replace(/\*\*\//g,"__GLOBSTAR_SLASH__").replace(/\*\*/g,"__GLOBSTAR__")
      .replace(/\*/g,"[^/]*").replace(/\?/g,"[^/]")
      .replace(/__GLOBSTAR_SLASH__/g,"(.*/)?").replace(/__GLOBSTAR__/g,".*") + "$"
```

`Ki(p)` (`683289`) renders an *allow* target — `(subpath "p")` or `(regex "<Ho(p)>")`;
`mi(p)` (`683295`) renders a *deny* target, using `Ho(p)` with the trailing `$` swapped for `(/.*)?$`
so a denied glob covers everything beneath it. `pd(expr, allows)` wraps a deny in
`(require-all <expr> (require-not <allow>) …)`.

The exact emission order in `kR` (`683401`) is load-bearing — SBPL is last-match-wins, so:

1. `(allow file-read*)` baseline
2. deny each `denyOnly`
3. allow each `allowWithinDeny`
4. glob-aware re-denies (`CR`, `683314`) as `require-all … require-not …`
5. `(allow file-read* (literal "/"))` if a deny covered root
6. `(allow file-read-metadata (vnode-type DIRECTORY))` if any deny exists — directory `stat` always
   survives, so `ls` of a denied dir reports it rather than erroring oddly
7. `Zh(denies)` (`683384`): `(deny file-write-unlink file-write-create …)` on every denied path **and
   each of its ancestor directories** (`md`, `683375`) — this blocks the delete-and-recreate attack on
   a read-denied file
8. allow `file-write-unlink file-write-create` over the write roots

`OR(q, logTag)` (`683334`) then adds the trailing section
`; File read: keep read-denied paths inside write roots in place` with `(deny file-write-unlink …)`,
so a command cannot unlink a read-denied file that happens to sit inside a writable root.

### 4.4 Violation detection

Three producers feed one store.

- **macOS** — `Xh` (`683490`) spawns
  `log stream --predicate '(eventMessage ENDSWITH "<Hh>")' --style compact`, scrapes lines matching
  `/Sandbox:\s+(.+)$/` that contain `deny`, and decodes the `/CMD64_(.+?)_END/` marker to recover the
  command. Three classes are always dropped: `mDNSResponder`,
  `mach-lookup com.apple.diagnosticd`, `mach-lookup com.apple.analyticsd` (`683518`). If `log stream`
  itself fails you get `[Sandbox Monitor] Failed to start log stream: <msg>` and violation reporting
  silently stops — **enforcement continues, but `<sandbox_violations>` goes empty**.
- **Linux** — `zh(cb, opts)` (`683528`) is *not* seccomp-audit. It opens an observe unix socket at
  `/tmp/srt-obs-XXXX/s<hex>.sock` that the seccomp shim writes JSON lines to
  (`{path, syscall, observe_init_error}`), synthesized as `deny <syscall> <path>`.
  Errors: `[Sandbox Linux Monitor] observe filter not installed: <err>`; a missing socket at wrap time
  logs `[Sandbox Linux] observe socket missing — supervisor not running; continuing without violation
  monitoring`.
- **Proxy** — `kd()` (`684159`) records `deny network-outbound <host>:<port> (<reason>)` and, when TLS
  is terminated, `deny http-request <METHOD> <url-with-query-elided> (<reason>)`.

The store is `f6t` (`683215`): a ring buffer capped at **100** entries with a listener set. Every
stored line is sanitized by `dd` (`683272`) — control characters collapsed to spaces — and has `<`
and `>` stripped. That last step is an explicit **prompt-injection defence**: a violation line is
attacker-influenced text (it contains a path) that lands in the model's context, so it must not be
able to open a tag.

Suppression comes from `sandbox.ignoreViolations` via `Yi` (`683260`), a
`{ "*": [substr…], "<command substr>": [substr…] }` map: the `"*"` key applies to all commands,
other keys match against the command text.

Violations are folded into the command's stderr by `DC` (`684717`):

```js
o += "\n" + "<sandbox_violations>" + "\n";
for (let u of r) o += u.line + "\n";
o += "</sandbox_violations>";
```

exposed as `SandboxRuntime.annotateStderrWithSandboxFailures` and called at `516025`. `rbe` (`515076`)
strips the block again before the TUI decides whether the result is "truncated".

### 4.5 Retry-unsandboxed flow

Two mechanisms:

1. **Model-driven** — the system prompt (`DPt`, `491318`) tells the model to retry with
   `dangerouslyDisableSandbox: true` when it sees sandbox-shaped failures. Verbatim (`491328`):

   > You should always default to running commands within the sandbox. Do NOT attempt to set
   > `dangerouslyDisableSandbox: true` unless:
   > - The user *explicitly* asks you to bypass sandbox
   > - A specific command just failed and you see evidence of sandbox restrictions causing the
   >   failure. Note that commands can fail for many reasons unrelated to the sandbox (missing files,
   >   wrong arguments, network issues, etc.).
   >
   > Evidence of sandbox-caused failures includes:
   > - "Operation not permitted" errors for file/network operations
   > - Access denied to specific paths outside allowed directories
   > - Network connection failures to non-whitelisted hosts
   > - Unix socket connection errors
   >
   > When you see evidence of sandbox-caused failure:
   > - Immediately retry with `dangerouslyDisableSandbox: true` (don't ask, just do it)
   > - Briefly explain what sandbox restriction likely caused the failure. Be sure to mention that
   >   the user can use the `/sandbox` command to manage restrictions.
   > - This goes through the permission gate (a user prompt, or the auto-mode classifier when auto
   >   mode is active)
   >
   > Treat each command you execute with `dangerouslyDisableSandbox: true` individually. Even if you
   > have recently run a command with this setting, you should default to running future commands
   > within the sandbox.
   > Do not suggest adding sensitive paths like ~/.bashrc, ~/.zshrc, ~/.ssh/*, or credential files to
   > the sandbox allowlist.

   When unsandboxed commands are disallowed, the block is replaced by:

   > - All commands MUST run in sandbox mode - the `dangerouslyDisableSandbox` parameter is disabled
   >   by policy.
   > - Commands cannot run outside the sandbox under any circumstances.
   > - If a command fails due to sandbox restrictions, work with the user to adjust sandbox settings
   >   instead.

   Plus, when a network config exists:

   > Network egress goes through a filtering proxy. Attempt requests and read the error rather than
   > predicting whether a host is reachable; denied connections are reported in a
   > `<sandbox_violations>` block explaining the reason.

   And the tmpdir rule:

   > For temporary files, always use the `$TMPDIR` environment variable. TMPDIR is automatically set
   > to the correct sandbox-writable directory in sandbox mode. Do NOT use `/tmp` directly - use
   > `$TMPDIR` instead.
   >
   > *(or, when TMPDIR is not exported)* For temporary files, create a scratch directory with
   > `mktemp -d` and reference it by absolute path. Do NOT assume `$TMPDIR` is set — the sandbox does
   > not export it in this configuration.

   The prompt header itself:

   > ## Bash command sandbox
   > By default, Bash tool commands run in a sandbox. This sandbox controls which directories and
   > network hosts commands may access or modify without an explicit override.
   >
   > The sandbox has the following restrictions:
   > Filesystem: {…}
   > Network: {…}
   > Ignored violations: {…}

   Path lists in that JSON are capped at 50 entries with
   `` `... and ${t} more (truncated for prompt size)` `` (`491314`).

2. **Automatic, REPL-only** (`474756`):

```js
if (… e.name === Qe && fe instanceof ux && fe.hadSandboxViolation
    && x?.dangerouslyDisableSandbox !== !0 && pt.isSandboxingEnabled()
    && pt.areUnsandboxedCommandsAllowed())
  return n("REPL Bash sandbox violation — auto-retrying unsandboxed"),
         A({ ...x, dangerouslyDisableSandbox: !0 }, { toolUseID: F });
```

### 4.6 Permission consequence of the override

`checkPermissions` (`515917`): if the model set `dangerouslyDisableSandbox`, the decision would
otherwise be allow, and the command *would* have been sandboxed without the flag, the result is
forced to:

```js
{ behavior: "ask",
  decisionReason: { type: "sandboxOverride", reason: "dangerouslyDisableSandbox" },
  message: "Run outside of the sandbox" }
```
— `515928`. Two consequences worth copying:

- A `sandboxOverride` decision is **not bypassable by `bypassPermissions` mode** — the bypass branch
  short-circuits on `A.decisionReason?.type === "sandboxOverride"` (`444637`). "YOLO mode" still
  prompts for an unsandboxed command.
- The decision is **stripped when forwarded across the remote-worker transport** (`147718`), so a
  remote worker cannot inherit someone else's sandbox waiver.

There is no `sandbox: true` input parameter anywhere in 2.1.251 — the only model-facing knob is the
negative `dangerouslyDisableSandbox`. (`constraints.sandbox === "required"` at `515994` is a
server-side remote-execution constraint, not a tool param.)

### 4.7 auto-allow-if-sandboxed

`A8e` (`442852`) implements `sandbox.autoAllowBashIfSandboxed` — the mechanism that makes a sandboxed
session feel prompt-free. Its gate is `o9()` (`687723`):
`wI() && (settings.sandbox.autoAllowBashIfSandboxed ?? true)` where `wI()` (`687720`) is
`!isScrubEnabled() && platform !== "windows"`.

It returns `null` (fall through to the normal permission flow) unless **all** of:

- sandboxing enabled, `autoAllowBashIfSandboxed` on, `bv(input)` true, and `!Q8e(permCtx)`.
  `Q8e` (`307581`) is `mode === "plan" || permCtx.sandboxAutoAllowSuspended === true`; the suspension
  flag arrives via a `"sandbox_auto_allow_suspended"` context update (`88489`).
- no un-allowlisted env-var assignment (the `Ww`/`cW` allowlist) in argv or bare tokens
- no `/dev/tcp/` or `/dev/udp/` redirect target
- not (a directory-change builtin **and** an `rm`/`rmdir` in the same command)
- each `rm`/`rmdir` independently passes the destructive-removal check `dL()`

On success (`Orn`, `442996`):

```js
{ behavior: "allow", updatedInput: e, decisionReason: { type: "other", reason: JNe } }
var JNe = "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)";   // 267508
```

Matching deny and ask rules still win over auto-allow.

### 4.8 The loopback proxy (network egress)

**There is a real in-process proxy** — HTTP *and* SOCKS5 multiplexed on one loopback port inside the
Claude Code node process.

`uC(askCallback, portRange)` at `684240` builds it:
- `ea = dh({…})` — the HTTP proxy server (also handles `CONNECT` and optional TLS MITM)
- `ta = hh({…})` — the SOCKS server
- `na = yh({ httpServer: ea, handleSocksConnection, httpBackendPortRange })` — a **mux** that sniffs
  the first bytes and dispatches HTTP vs SOCKS on the same socket

It listens on `127.0.0.1` and is `unref()`'d. Log line:
`Mux proxy (HTTP+SOCKS) listening on localhost:<port>`.

#### Allowlist decision order (`Tg(port, host, askCb, encodedCmd)`, `684174`)

1. no config → **deny**, reason `sandbox policy unavailable`
2. malformed host → **deny**, `malformed host` (log: `Denying malformed host: "<h>":<p>`)
3. `deniedDomains` match → **deny**, reason `deniedDomainReasons[pattern] ?? "host is on the deny list"`
   (log: `Denied by config rule: <h>:<p>`)
4. `allowedDomains` match → **allow** (log: `Allowed by config rule: <h>:<p>`)
5. no ask-callback, or `strictAllowlist` → **deny**, `"host is not on the allow list"`
   (log: `No matching config rule, denying: <h>:<p>`)
6. otherwise → **prompt the user** (log: `No matching config rule, asking user: <h>:<p>` →
   `User allowed:` / `User denied:` with reason `"user denied"`, or `"permission prompt failed"`)

The 403 body (`Ko`, `680722`):

```js
var Gm = "denied by sandbox policy";                        // 680675
res.writeHead(403, { "Content-Type": "text/plain",
                     "X-Proxy-Error": "blocked-by-sandbox-runtime" });
res.end(reason + "\n");
```

#### Where the allowlist comes from

`getNetworkRestrictionConfig()` (`684488`) returns `{allowedHosts, deniedHosts}`. The config is
assembled by `eht()` (`687000`–`687380`) from:

- `sandbox.network.allowedDomains` / `deniedDomains` (schema `wn()`, `111099`)
- **merged with `WebFetch(domain:…)` permission *allow* rules** — see `xo()` at `210590`, where
  `permissions.allow` is dropped when `sandbox.network.allowManagedDomainsOnly === true`. This is the
  non-obvious coupling: your WebFetch allowlist is also your sandbox's egress allowlist.
- `deniedDomainReasons` — a per-pattern human reason string
- `strictAllowlist` — true if **any** of user/managed/flag settings set it; project settings ignored
- session grants added by `pt.addSessionAllowedHost(host)` after a user approves a prompt

When the sandbox is off but the scrub lane is on (`HVe()`), the config degrades to
`{allowedDomains: undefined, deniedDomains: [], allowAllUnixSockets: true}` — no network restriction.

#### Command attribution through the proxy

The proxy **username carries the command id** (`Mv`, `680490`): `ls = "srt"`, username is
`srt.<commandId>` when it fits in 255 bytes, else bare `srt`; `pc()` (`680495`) decodes it. That is
how a proxy-side deny gets attributed back to a specific Bash tool call.

#### TLS termination

`tlsTerminate` and `mitmProxy` are mutually exclusive
(`network.tlsTerminate and network.mitmProxy are mutually exclusive`, `684265`). When on, an
in-process MITM CA (`Fu()`, `680545`) is generated ephemerally or loaded from
`caCertPath`/`caKeyPath`, and the cert path plus trust bundle are added to the sandbox's read-allow
list. This is what lets the credential-sentinel machinery substitute real secrets on egress.
`excludeDomains` skips termination per host, with a loud error if a masked credential targets an
excluded host.

#### The network-access prompt

Dialog kind `sandbox_network_access` (`146301`):

```js
payload: { host, port?, forwardedFromWorker?, workerName? }
result:  { allow, persistToSettings, persistRow } | "cancelled"
```

- notification title (`167834`): `A sandboxed command needs network access`
- status-line label (`167835`): `sandbox request`
- SDK/bridge description (`146324`, `522484`): `Allow network connection to <host>?`
- teammate variant (`172678`): `<worker> needs network access to <host>`

Approval persists as a `WebFetch(domain:<host>)` rule in local settings **plus**
`pt.addSessionAllowedHost(host)`.

`Wi` (`680421`) builds the child env for a proxied sandbox. Verbatim shape:

```
SANDBOX_RUNTIME=1
[TMPDIR=<CLAUDE_CODE_TMPDIR|CLAUDE_TMPDIR|/tmp/claude>]
[<CA cert vars>=<caCertPath>]                       // Uv list
NO_PROXY=localhost,127.0.0.1,::1,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
no_proxy=<same>
HTTP_PROXY=http://[user:token@]localhost:<httpPort>
HTTPS_PROXY=…  http_proxy=…  https_proxy=…
GIT_CONFIG_PARAMETERS='http.proxyAuthMethod=basic'        // when a token is set
ALL_PROXY=<http://…|socks5h://…>   all_proxy=…  GRPC_PROXY=…  grpc_proxy=…
GIT_SSH_COMMAND=ssh -o ControlMaster=no -o ControlPath=none -o ProxyCommand='nc -X 5 -x localhost:<socks> %h %p'      // macOS
GIT_SSH_COMMAND=ssh -o ControlMaster=no -o ControlPath=none -o ProxyCommand='socat - PROXY:localhost:%h:%p,proxyport=<http>[,proxyauth=user:token]'   // Linux
FTP_PROXY=socks5h://…  ftp_proxy=…  RSYNC_PROXY=localhost:<socks>
DOCKER_HTTP_PROXY=…  DOCKER_HTTPS_PROXY=…
CLOUDSDK_PROXY_TYPE=http  CLOUDSDK_PROXY_ADDRESS=localhost  CLOUDSDK_PROXY_PORT=<http>
[CLOUDSDK_PROXY_USERNAME/PASSWORD]
[JAVA_TOOL_OPTIONS=… -Djava.net.preferIPv4Stack=true]      // when allowLocalBinding
```

`socat` is the Linux dependency behind `sandbox.socatPath`. Git `safe.directory` entries are injected
as `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` pairs (`dc`, `680462`), collapsing to
`safe.directory=*` past 8 directories (`Fv = 8`).

### 4.9 E2BIG diagnostic

Because every deny path is spliced into the profile text, huge worktree lists can blow the exec arg
limit. `Sht` (`471993`) produces a bespoke message:

> Could not start `<bin>`: the command line plus environment exceed the OS exec argument limit
> (E2BIG). At spawn: command line `<n>` across `<k>` args (largest single arg `<m>`); environment
> `<n>` across `<k>` vars (largest: `<NAME>` at `<m>`). The Bash sandbox profile adds `<N>` filesystem
> deny paths to every command, `<M>` of them for registered git worktrees, which grow this list
> without bound. From another terminal, remove worktrees you no longer need
> (`git worktree remove <path>`; `git worktree prune` for already-deleted checkouts), then restart
> Claude Code so the profile is rebuilt without them — or relax the Bash sandbox for this session
> with `/sandbox`.

### 4.10 Windows

Sandboxed bash on Windows requires Git Bash as the inner shell (`Hht`, `472407`). If the configured
shell isn't an absolute `bash.exe`/`sh.exe`, it warns
`` `sandbox: shell "<x>" is not an absolute bash-family exe SRT accepts as an inner shell; falling
back to Git Bash for the sandboxed child` `` and, absent Git Bash, throws:

> Sandboxed bash on Windows requires Git Bash, which is not installed. Install Git Bash, or run this
> command unsandboxed (dangerouslyDisableSandbox).

Windows-specific refusals: `windows_argv_too_long` (`687932`) —

> Command is too long to run in the Windows sandbox: the assembled command line is near the OS
> limit… Write the script to a file and run that file instead, or split the command up.

and `windows_mapped_drive_cwd` (`687941`).

### 4.11 Linux: bubblewrap + seccomp

#### Dependencies (`Bh`, `682659`)

Hard failures: `bubblewrap (bwrap) not executable at <path>`, `bubblewrap (bwrap) not installed`,
`socat not executable at <path>`, `socat not installed`. Soft warning:
`seccomp not available - unix socket access not restricted`.

#### The seccomp shim

Arch gate `kh()` (`682454`) permits only `x64` and `arm64`. On `ia32`:

> [SeccompFilter] 32-bit x86 (ia32) is not currently supported due to missing socketcall() syscall
> blocking. The current seccomp filter only blocks socket(AF_UNIX, ...), but on 32-bit x86,
> socketcall() can be used to bypass this.

The filter's **only** job is blocking `socket(AF_UNIX, …)`, because bwrap cannot filter unix sockets
by path — which is why the settings doc says *"macOS only: Unix socket paths to allow. Ignored on
Linux (seccomp cannot filter by path)."* The `apply-seccomp` binary is searched for at
`<bundleDir>/vendor/seccomp/<arch>/apply-seccomp` and `../` variants, then in global npm installs of
`@anthropic-ai/sandbox-runtime` under `npm root -g`, `/usr/lib/node_modules`,
`/usr/local/lib/node_modules`, `/opt/homebrew/lib/node_modules`, `~/.npm/lib/node_modules`,
`~/.npm-global/lib/node_modules` (`682444`, `682487`). `TR(applyPath, argv0)` (`682730`) builds the
prefix `ARGV0=<argv0> <applyPath> ` which is **prepended to the shell command string** — so
`apply-seccomp` execs the shell.

**No landlock. No user-supplied seccomp policy.** One vendored filter, one syscall.

#### Mount plan (`IR`, `682795`)

- with a write config: `--ro-bind / /`, then `--bind <p> <p>` for each `allowOnly` path
  (realpath'd and symlink-escape checked); without one: `--bind / /`
- deny-write paths (`denyWithinAllow` ∪ `vR()`) are re-bound read-only: `--ro-bind <p> <p>`
- a deny path that **doesn't exist** gets an empty tmpdir or `/dev/null` bind-mounted at its first
  non-existent ancestor, so it cannot be created
- a deny path that is a **symlink** gets `--ro-bind /dev/null <symlink>`, logged
  `[Sandbox Linux] Mounted /dev/null at symlink <p> to prevent symlink replacement attack`
- deny-read **directories** become `--tmpfs <dir>` (`$h`, `682758`) with write paths re-`--bind`ed on
  top and `allowWithinDeny` paths re-exposed `--ro-bind`; deny-read **files** become
  `--ro-bind /dev/null <file>`
- masked credential files become `--ro-bind <fakePath> <realPath>`
- ancestor "pins" (`--bind <dir> <dir>`) are added for parents of mount targets with an lstat-verified
  symlink check that throws:
  `Sandbox ancestor-pin verification failed: cannot lstat <p> (<code>). Refusing to build a mount plan
  with unverifiable pin components.`
- mount-point litter is tracked in set `Dc` and cleaned at exit (`682640`):
  `[Sandbox Linux] Cleaned up bwrap mount point (file|dir): <p>`

#### The argv (`Gh`, `683140`)

```
bwrap
  --new-session --die-with-parent
  [--bind <observeSock> <observeSock>              # only when seccomp is present
   --setenv SRT_OBSERVE_SOCK <observeSock>
   --setenv SRT_ENCODED_CMD <base64 cmd>]
  [--unsetenv NAME]…                               # credentials.envVars mode "deny"
  [--setenv NAME VAL]…                             # credentials.envVars mode "mask"
  [--setenv GIT_CONFIG_KEY_n … / GIT_CONFIG_VALUE_n … / GIT_CONFIG_COUNT n]
  [--unshare-net                                   # iff needsNetworkRestriction
   --bind <httpBridgeSock> <httpBridgeSock>
   --bind <socksBridgeSock> <socksBridgeSock>      # if distinct
   --setenv <proxy vars from Wi(3128, 1080, …)>…
   --setenv CLAUDE_CODE_HOST_HTTP_PROXY_PORT <n>
   --setenv CLAUDE_CODE_HOST_SOCKS_PROXY_PORT <n>]
  <…mount plan from IR()…>
  --dev /dev
  --unshare-pid
  --unshare-user --cap-drop ALL --proc /proc       # normal
  --unshare-user --bind /proc /proc                # iff enableWeakerNestedSandbox
  -- <shell> -c <finalCommandString>
```

Namespaces used: **net, pid, user**. Not cgroup, not ipc, not uts. `enableWeakerNestedSandbox` drops
`--cap-drop ALL` and swaps the real `--proc` mount for a bind of the host `/proc` — that is the escape
hatch for running the sandbox *inside* another container.

Missing-bridge errors:
`Linux HTTP bridge socket does not exist: <p>. The bridge process may have died. Try reinitializing
the sandbox.` (and the SOCKS twin). Success log:
`[Sandbox Linux] Wrapped command with bwrap (<network, filesystem, env, seccomp(unix-block)>)
restrictions)`.

#### Re-creating TCP inside the net namespace (`wR`, `682739`)

Because the net namespace is unshared, no TCP port exists inside. The final command string is:

```sh
<socat> TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:<httpSock> >/dev/null 2>&1 &
<socat> TCP-LISTEN:1080,fork,reuseaddr UNIX-CONNECT:<socksSock> >/dev/null 2>&1 &
trap "kill %1 %2 2>/dev/null; exit" EXIT
<seccompPrefix><shell> -c <command>          # or: eval <command> when no seccomp
```

all wrapped as `<shell> -c '<script>'`. **Inside a Linux sandbox the proxy is always
`localhost:3128` (HTTP) and `localhost:1080` (SOCKS)**, regardless of the host-side ports.

On the host, `Wh(httpPort, socksPort, socatPath)` (`682675`) runs the mirror pair:

```
socat UNIX-LISTEN:/tmp/…/claude-http-<hex>.sock,fork,reuseaddr TCP:localhost:<httpPort>,keepalive,keepidle=10,keepintvl=5,keepcnt=3
socat UNIX-LISTEN:/tmp/…/claude-socks-<hex>.sock,fork,reuseaddr TCP:localhost:<socksPort>,…
```

with 5 retries waiting for the sockets, else `Failed to create bridge sockets after 5 attempts`.

#### Container / devcontainer detection

Class `dk` (`303229`): `isDocker()` = existence of `/.dockerenv`; `isBubblewrapSandbox()` =
`linux && env.CLAUDE_CODE_BUBBLEWRAP`; `isRootOutsideDeliberateSandbox()` =
`uid 0 && !IS_SANDBOX && !CLAUDE_CODE_BUBBLEWRAP`. Consumed by `Vwe()` (`687703`):

```js
function Vwe() {
  if (!Qgt().disableNoSandbox) return !1;
  return !bu() && !Me(a.IS_SANDBOX) && !Vh.getIsBubblewrapSandbox();
}
```

So Docker/devcontainer does **not** silently disable sandboxing — it only makes the "No Sandbox"
option remain available in `/sandbox` when the org gate `disableNoSandbox` would otherwise remove it.

### 4.12 Settings provenance, tiering, and remote gates

Managed/trust gating (`111004`, consumed at `111936`–`111950`):
`["bwrapPath","ripgrep","socatPath"]` surface as **shell settings** (path-to-executable risk);
the eleven keys in `qe` surface as **sandbox settings**; both feed the "Managed settings need your
review before they apply" dialog. `no = new Set(["credentials","network.tlsTerminate"])` (`111950`)
additionally attaches `network.allowedDomains` to that review row, because those two together
determine *where secrets get injected*.

Settings-tier restriction table (`Ct`, `210499`) — which direction of each flag counts as
"restrictive" and can therefore be pushed down from a parent tier:

| key | restrictive |
|---|---|
| `sandbox.enabled` | true |
| `sandbox.failIfUnavailable` | true |
| `sandbox.autoAllowBashIfSandboxed` | false |
| `sandbox.allowUnsandboxedCommands` | false |
| `sandbox.enableWeakerNestedSandbox` | false |
| `sandbox.enableWeakerNetworkIsolation` | false |
| `sandbox.allowAppleEvents` | false |
| `sandbox.network.allowManagedDomainsOnly` | true |

`sandbox.filesystem` (`Ln`, `111099`): `allowWrite`, `denyWrite`, `denyRead`, `allowRead`,
`allowManagedReadPathsOnly`, `disabled`. The `disabled` doc, verbatim (abbreviated):

> macOS and Linux/WSL only: skip filesystem isolation entirely while keeping network and seccomp
> isolation. Ignored on native Windows … Sandboxed commands get unrestricted read/write access to the
> host filesystem; network egress is still confined to network.allowedDomains. Intended for
> deployments whose goal is egress control rather than filesystem containment. Does not change Bash
> prompting: sandbox.autoAllowBashIfSandboxed is independent and still defaults to true…

`sandbox.network` (`wn`, `111099`): `allowedDomains`, `deniedDomains`, `strictAllowlist`,
`allowManagedDomainsOnly`, `allowUnixSockets`, `allowAllUnixSockets`, `allowLocalBinding`,
`allowMachLookup`, `httpProxyPort`, `socksProxyPort`, `tlsTerminate{caCertPath,caKeyPath}`.

**Remote gates** — `Qgt()` (`685986`) reads a Statsig-style blob (`PY()` returns `{}` locally,
`685984`): `disableNoSandbox`, `forbidUnsandboxedCommands` (→ `c9()`, `687736`),
`requireSandboxedAttempt` (`687739`), and `filesystemPolicy` ∈ `"strict" | "relaxed" |
"relaxedIfForced"` → `F2()` (`686060`), the value that shows up as `filesystem_policy` in Bash
telemetry.

**Env vars**:

| var | site | effect |
|---|---|---|
| `CLAUDE_CODE_FORCE_SANDBOX=1` | `255380` | injected into bridge child sessions to force sandboxing |
| `CLAUDE_CODE_SANDBOXED` | `76049`, `248397`, `311163` | marks a spawned child as already sandboxed |
| `IS_SANDBOX=1` | `303267`, `308553`, `687706` | "already in a container"; suppresses root warnings, keeps "No Sandbox" available |
| `CLAUDE_CODE_BUBBLEWRAP` | `303267` | same, bwrap-specific |
| `CONTAINER_SANDBOX_MOUNT_POINT` | `308551` | Windows container detection |
| `CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR` | `515896` | renders the tool as `SandboxedBash` |
| `SANDBOX_RUNTIME=1` | `680422` | set *inside* the sandbox so children can tell |
| `SRT_OBSERVE_SOCK`, `SRT_ENCODED_CMD` | `683148` | Linux violation-observer plumbing |
| `CLAUDE_CODE_HOST_HTTP_PROXY_PORT` / `..._SOCKS_...` | `683168` | host-side ports, informational inside the ns |
| `CLAUDE_CODE_TMPDIR` / `CLAUDE_TMPDIR` | `680426` | override the sandbox `TMPDIR` (default `/tmp/claude`) |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | `854786` | the separate "env scrub" lane; with `l$()` (`854808`, currently hardcoded `false`) it would force-sandbox unconditionally |
| `CLAUDE_CODE_EVAL_CONFINED` | `443655` | forces `disableUnsandboxedCommands` |

### 4.13 `/sandbox` UI copy and initialization errors

Mode picker (`vo`, `668485`):
`Sandbox BashTool, with auto-allow` → `✓ Sandbox enabled with auto-allow for bash commands`;
`Sandbox BashTool, with regular permissions` → `✓ Sandbox enabled with regular bash permissions`;
`No Sandbox` → `○ Sandbox disabled`.

Override picker (`xo`, `668405`) help text, verbatim:

> **Allow unsandboxed fallback:** When a command fails due to sandbox restrictions, Claude can retry
> with dangerouslyDisableSandbox to run outside the sandbox (falling back to default permissions).
>
> **Strict sandbox mode:** All bash commands invoked by the model must run in the sandbox unless they
> are explicitly listed in excludedCommands.

Locked by policy: `Override settings are managed by a higher-priority configuration and cannot be
changed locally.` Docs link: `https://code.claude.com/docs/en/sandboxing#configure-sandboxing`.

Status panel (`G`, `668229`) headings: `Sandbox is not enabled`, `Excluded Commands:`,
`Filesystem Read Restrictions:` / `Denied:` / `Allowed within denied:`,
`Filesystem Write Restrictions:` / `Allowed:` / `Denied within allowed:`,
`Network Restrictions[ (Managed)]:` / `Allowed:` / `Denied:`, `Allowed Unix Sockets:`, plus
`⚠ Warning: Glob patterns not fully supported on Linux` and
`The following patterns will be ignored: …`.

Initialization / execution errors, verbatim:

- `687918` — `Sandbox is required but failed to initialize<: reason>. Restart to retry.`
- `687920` — `Sandbox is enabled but failed to initialize<: reason>. Sandboxing is disabled for the rest of this session; restart to retry.`
- `687947` — `Linux sandbox <HTTP|SOCKS> bridge socket is missing (socat may have died). Restart to retry.`
- `687985` — `sandbox: the task output directory chain under the temp root is no longer plain directories (<p>); refusing to run sandboxed commands until it is restored`
- `515996` — `This call must run inside a fully confining sandbox and none is available here. The command was not run.`
- `515997` — `This call carries file deny lists that cannot be enforced here yet. The command was not run.`
- `683143` / `683177` — `Shell '<x>' not found in PATH`
- `687793` (`l9()`, "why is the sandbox not on"):
  - `sandbox is enabled but WSL1 is not supported (requires WSL2)`
  - `sandbox is enabled but the Windows sandbox is not active on this session (feature gate off)`
  - `sandbox is enabled but <platform> is not supported (requires macOS, Linux, or WSL2)`
  - `sandbox is enabled but dependencies are missing: <errs> · install missing tools (e.g. apt install bubblewrap socat) or run /sandbox for details`

Mid-session disable (`518612`):

> The Bash command sandbox has been disabled. Commands now run without sandbox restrictions; the
> earlier sandbox instructions no longer apply.

### 4.14 Sandbox telemetry

There is **no `tengu_sandbox_*` event family** for the state machine. Sandbox lifecycle rides the
generic feature triple (`820556`):

```js
function y(name, extra)      { s("tengu_feature_ok",  { feature_name: name, ...extra }); }
function p(name, code, extra) { s("tengu_feature_bad", { ...extra, feature_name: name, error_code: code }); }
function g(name, code, extra) { s("tengu_feature_sad", { ...extra, feature_name: name, error_code: code }); }
```

| feature_name | level | error_code | site |
|---|---|---|---|
| `sandbox_init` | ok | — | `688016` |
| `sandbox_init` | sad | `sandbox_init_failed` | `688020` |
| `sandbox_exec` | ok | — | `687955`, `687982` |
| `sandbox_exec` | sad | `sandbox_exec_lazy_init` | `687916` |
| `sandbox_exec` | bad | `sandbox_exec_not_initialized` | `687921` |
| `sandbox_exec` | sad | `sandbox_linux_bridge_dead` | `687945` |
| `sandbox_exec` | bad | `windows_argv_too_long` | `687932` |
| `sandbox_exec` | bad | `windows_mapped_drive_cwd` | `687941` |
| `sandbox_exec` | sad | `windows_policy_refusal` | `568449` |
| `sandbox_exec` | sad | `remote_floor_refusal` | `515994` |
| `sandbox_exec` | sad | `remote_deny_list_unenforceable` | `515997` |
| `sandbox_exec` | sad | `atomic_write_staging_dir_create_failed` | `686514` |
| `sandbox_exec` | bad | `atomic_write_staging_dir_tampered` | `767907` |
| `sandbox_exec` | sad | `task_output_deny_skipped` | `686652` |
| `sandbox_set_settings` | ok | — | `687908` |
| `sandbox_exclude_command` | ok | — | `688057` |
| `sandbox_windows_install` | ok/sad/bad | `uac_cancelled`, `uac_cancelled_provisioned`, `uac_timeout`, `config_conflict`, `status_probe_failed`, `trust_ca_failed`, `persistent_ca_failed`, `user_not_provisioned`, `cred_not_readable`, `wfp_not_installed`, `install_threw` | `26237`–`26280` |

Two dedicated `tengu_*` events exist, both about the post-run **scrub sweeper**:
`tengu_sandbox_scrub_removed_non_symlink` (`687469`, property
`{kind: "directory"|"file"|"other"|"unknown"}`) and `tengu_sandbox_scrub_spared_unreachable`
(`687572`, `687578`).

The richest per-command signal is on the Bash tool events themselves (`516034`, `516064`):
`sandboxed, sandbox_enabled, dangerously_disable_sandbox, filesystem_policy, had_sandbox_violation,
call_origin, permission_mode`.

### 4.15 Deliberate gaps in the implementation

- No landlock, no per-command seccomp policy, no cgroup/uts/ipc namespaces.
- Credential **masking** (`credentials.envVars` mode `"mask"`) is fully implemented on Linux via
  `--ro-bind <fake> <real>` sentinel files, but **degrades to `deny` on macOS and Windows** — stated in
  the schema doc and enforced at `683470` with the log line
  `[Sandbox macOS] file mask degrades to deny on macOS until the interposer lands`.
- Glob patterns in `filesystem.allowWrite` / `denyWrite` are **silently dropped on Linux**
  (`Skipping glob pattern on Linux/WSL: <p>`, `684443`). Only read-side globs are expanded, via
  `readdirSync(recursive)` + the `Ho()` regex (`us()`, `680504`). The `/sandbox` panel warns about
  this; a replicator on Linux should not promise glob write rules.
- The macOS violation monitor depends on `/usr/bin/log stream`. If it fails, enforcement continues but
  `<sandbox_violations>` stays empty — the model loses its retry signal.

---

## 5. Command safety analysis

### 5.1 The parser

`ZE()` (`398569`, chunk `chunk-fgwne0fb.js`) returns `{ parse }` — a **hand-written recursive-descent
parser bundled into the binary**, not tree-sitter WASM and not `shell-quote`. Its node type names are
tree-sitter-bash's: `program`, `list`, `pipeline`, `command`, `command_name`, `word`, `string`,
`raw_string`, `concatenation`, `number`, `variable_assignment`, `redirected_statement`,
`negated_command`, `command_substitution`, `process_substitution`, `expansion`, `simple_expansion`,
`arithmetic_expansion`, `ansi_c_string`, `translated_string`, `heredoc_start/body/content/end`,
`comment`, `ERROR`. So the February "tree-sitter Bash AST" claim is *shape*-accurate; the
implementation is now in-house.

Guard rails: input longer than `SS = 1e4` chars is not parsed at all (`439743`, `439805`) — it is
treated as one opaque command.

### 5.2 Splitting into sub-commands

`Ua(e)` (`439743`) — the workhorse, used everywhere:

```js
var Jhe = new Set(["program", "list", "pipeline"]);
var E9e = new Set(["&&", "||", "|", ";", "&", "|&", "\n"]);
function Ua(e) {
  if (!e) return [];
  if (e.length > SS) return [e];
  let t = ZE().parse(e); if (!t) return [e];
  let r = [], o = (u) => {
    if (E9e.has(u.type) || u.type === "comment") return;
    if (u.type === "redirected_statement") { for (let d of u.children) if (!d.type.endsWith("_redirect")) o(d); return; }
    if (Jhe.has(u.type)) { for (let d of u.children) o(d); return; }
    r.push(u.text);
  };
  o(t.type === "ERROR" && t.children[0]?.type === "program" ? t.children[0] : t);
  return r;
}
```

So operators are dropped, `program/list/pipeline` are descended into, redirections are stripped from
their statement, and **anything else (including a `subshell`, `command_group`, `if_statement`) is
pushed whole**. That last property is what makes subshells "not decomposable" downstream.

`rW` (`439770`) is the stricter variant used where only plain commands are acceptable; it returns
`null` the moment it meets a node that isn't `command`/`variable_assignment`.

`ru(e)` (`439805`) is the token-level splitter (argv words) built on the same AST.

### 5.3 Wrapper stripping (`Ah`, `442471`)

Before classification, a command is peeled of transparent wrappers via a regex list:

```js
[ /^timeout[ \t]+(…flags…)*(?:--[ \t]+)?\d+(?:\.\d+)?[smhd]?[ \t]+/,
  /^time[ \t]+(?:--[ \t]+)?/,
  /^nice(?:[ \t]+-n[ \t]+-?\d+|[ \t]+-\d+)?[ \t]+(?:--[ \t]+)?/,
  /^stdbuf(?:[ \t]+-[ioe][LN0-9]+)+[ \t]+(?:--[ \t]+)?/,
  /^nohup[ \t]+(?:--[ \t]+)?/,
  /^command(?:[ \t]+-p+)*(?:[ \t]+--)?[ \t]+(?!-)/,
  /^builtin(?:[ \t]+--)?[ \t]+(?!-)/,
  /^noglob[ \t]+(?!-)/ ]
```

plus leading `NAME=value` assignments **only when NAME is in the benign allowlist** `cW` (`442458`):
`GOEXPERIMENT GOOS GOARCH CGO_ENABLED GO111MODULE RUST_BACKTRACE RUST_LOG NODE_ENV PYTHONUNBUFFERED
PYTHONDONTWRITEBYTECODE PYTEST_DISABLE_PLUGIN_AUTOLOAD PYTEST_DEBUG ANTHROPIC_API_KEY LANG LANGUAGE
LC_ALL LC_CTYPE LC_TIME CHARSET TERM COLORTERM NO_COLOR FORCE_COLOR TZ LS_COLORS LSCOLORS GREP_COLOR
GREP_COLORS GCC_COLORS TIME_STYLE BLOCK_SIZE BLOCKSIZE COLUMNS LINES CLICOLOR CLICOLOR_FORCE CI
DEBIAN_FRONTEND GIT_TERMINAL_PROMPT`. Comment lines are stripped first (`nQ`, `442461`).

### 5.4 Semantic classification (`KTe`, `245656`)

`dde(command)` → `{kind: "simple", commands, bareAssignmentNames}` | `{kind: "too-complex", reason, …}`.

The `too-complex` reasons (verbatim, each with a `differential: true` flag meaning "the parse and the
shell might disagree"):

- "Contains lone surrogate"
- "Contains control characters"
- "Contains Unicode whitespace"
- "Contains backslash-escaped whitespace"
- "Contains zsh ~[ dynamic directory syntax"
- "Contains zsh =cmd equals expansion"
- "Contains zsh <N-M> numeric-range glob"
- "Contains brace with quote character (expansion obfuscation)"
- "Parser aborted (timeout, resource limit, or over-length)" (`nodeType: "PARSE_ABORT"`)
- "Parser skipped input between top-level statements"
- "Parser did not consume trailing input"

The last two are a **coverage check**: the child node spans are sorted and every gap must consist
only of whitespace/`;`/`&`/backslash-newline (`245692`). This closes the classic "parser ignores a
chunk the shell will run" hole.

Telemetry: `tengu_bash_ast_too_complex {nodeTypeId}` (`443402`).

### 5.5 The permission pipeline

`$ct(input, ctx, …)` at `443375` is the top:

1. **`bashCommandClamps`** — a per-spawn allowlist of command *forms*. On miss:
   > Permission to use Bash with command `<cmd>` has been denied: this agent's Bash use is clamped to
   > a fixed set of command forms (per-spawn bashCommandClamp), and the span `<span>` matches none of
   > them. Allowed forms: `<list>`
   or, for unverifiable structure:
   > … the command has structure the clamp cannot verify (substitution, control flow, or an
   > undecomposable compound) — no clamp rule can admit it. Issue plain commands matching the clamped
   > forms.
   Telemetry `tengu_bash_command_clamp_denied`.

2. **`jrn`** (`443394`) — the real analysis:
   - `dde` → if `too-complex`, `{behavior:"ask", bashMissKind:"too-complex"}` with the reason text.
   - `A8e` — sandbox auto-allow (§4.7).
   - `aQ` — exact-rule matching (`442801`).
   - `w8e`/`mrn`/`drn` — pipe-segment decomposition and per-segment recursion (`442400`–`442440`).
   - `I8` — path-level checks on redirect targets and rm/rmdir arguments.
   - mode-specific handling (`T8e`, `442345`): in `acceptEdits`, the base commands
     `["mkdir","touch","rm","rmdir","mv","cp","sed"]` (`frn`, `442334`) auto-allow.
   - read-only auto-allow (`_8e`, §5.6).

3. **`&` background operator** — even if everything allows, a `&` forces an ask:
   > This command uses the `&` background operator, which defers execution past approval-time safety
   > checks. Approve only if you trust it.
   (`decisionReason.type: "safetyCheck"`, `classifierApprovable: !1`,
   `circuitBreaker: "backgroundOperator"`, `443389`).

Compound-shell operators outside a decomposable pipe:
> This command uses shell operators that require approval for safety   (`bashMissKind: "shell-operators"`, `442423`)

`cd`-related asks (`442419`, `443456`):
> Multiple directory changes in one command require approval for clarity   (`bashMissKind: "multi-cd"`)

> This command changes directory before running git, which can execute untrusted hooks from the
> target directory. Approve only if you trust it.   (`bashMissKind: "cd-git-compound"`)

> This command creates git repository structure files (HEAD/objects/refs/hooks) and then runs git,
> which can execute hooks/fsmonitor from the created files.   (`bashMissKind: "cd-git-compound"`)

Denial:
> Permission to use Bash with command `<cmd>` has been denied.   (`442805`)

Fallthrough:
> This command requires approval   (`bashMissKind: "no-rule-match"`, `442810`)

Multi-segment aggregate:
> Permission denied for: `<segment>`   (`442410`)

### 5.6 Read-only classification (`_8e`, `442191`)

The gate that lets read-only commands run without a prompt, and it is strict. Rejection messages,
verbatim:

- `Command too long for read-only analysis`
- `` `Not a simple read-only command: ${reason}` ``
- `Not a simple read-only command: contains a subshell`
- ``Not a simple read-only command: `&` defers execution past approval-time checks``
- `Bare assignment to a non-allowlisted environment variable can alter behavior of subsequent commands`
- `Command contains unquoted variable expansion`
- `Command contains Windows UNC path that could be vulnerable to WebDAV attacks` (→ **ask**, not passthrough)
- `Compound commands with cd and git require permission checks for enhanced security`
- `The current directory has bare-repo indicators (HEAD/objects/refs outside a .git/ directory). Git may treat it as a git dir and run config/hooks from here, so git commands need approval.`
- `The .git file or symlink here redirects to a location Claude cannot verify is safe (it may have been planted by an untrusted archive). Git commands need approval.`
- `Compound commands that create git internal files and run git require permission checks for enhanced security`
- `Git commands outside the original working directory require permission checks when sandbox is enabled`
- `Command is not read-only, requires further permission checks`

Per-sub-command it additionally rejects: redirects whose op isn't in the safe set and whose target
isn't `/dev/null` or an fd dup; any `/dev/tcp/` or `/dev/udp/` target; `<` from a UNC path;
non-allowlisted env vars; UNC args.

The read/search/list taxonomy used for concurrency and tool-choice hints (`515679`):

```js
Icr = {find, grep, rg, ag, ack, locate, which, whereis}        // "search"
Ocr = {cat, head, tail, less, more, wc, stat, file, strings, jq, awk, cut, sort, uniq, tr}  // "read"
Dcr = {ls, tree, du}                                            // "list"
Lcr = {echo, printf, true, false, ":"}                          // neutral, skipped
```

### 5.7 `Bash(...)` rule prefix extraction (`w3e`, `442412`)

This is what fills the "always allow `Bash(git status:*)`" suggestion:

```js
function w3e(e) {
  let t = krn(e);                        // heredoc-aware: analyse the text before "<<"
  if (t) return lyt(yi.name, t);
  if (e.includes("\n")) { let o = wr(e).trim(); if (o) return lyt(yi.name, o); }
  let r = KNt(e);                        // two-token prefix
  if (r) return lyt(yi.name, r);
  return ayt(yi.name, e);                // fall back to the exact command
}
```

`KNt` (`442366`) is the two-token extractor:
- skip leading `NAME=value` — **but bail entirely if NAME isn't in `cW`**
- require ≥2 remaining words
- bail if the head word's basename is in `oQ` (`442387`):
  `sh bash zsh fish csh tcsh ksh dash cmd powershell pwsh env xargs command builtin noglob nice
  stdbuf nohup timeout time watch ionice chrt setsid taskset strace ltrace script flock unshare
  nsenter sudo doas pkexec su runuser`
- require the second word to look like a subcommand: `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`
- return `"<cmd> <subcmd>"`

`g9n` (`442396`) is the one-token variant with the same guards.

Rule matching against a stored rule is `preparePermissionMatcher` (`515852`) + `NP`/`o6`
(glob-ish prefix match); the `xargs` prefix is explicitly tolerated
(`_ === \`xargs ${d}\` || _.startsWith(\`xargs ${d} \`)`).

### 5.8 What is NOT here

- **No hard-coded banned-command list.** There is no `curl`/`wget`/`sudo` refusal table. `Bcr` at
  `515719` (`[...P$t, "wget"]`) is only the telemetry `command_type` bucket list
  (`npm yarn pnpm node python python3 go cargo make docker terraform webpack vite jest pytest curl
  git gh dotnet msbuild nuget bun bunx npx deno pwsh pip uv poetry gradle mvn nx turbo tsc eslint
  prettier build test serve watch dev xcodebuild swift bazel nix nix-shell nix-build nix-env`,
  `515084`).
- **No `command_injection_detected` Haiku prompt.** Grepping the whole bundle finds no such string.
  The LLM-in-the-loop path is now the generic **auto mode** classifier, described to the user as
  *"Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for
  risky actions and prompt injection before executing…"* (`162636`). Bash routes into it through
  `toAutoClassifierInput(e) { … return e.command; }` (`515858`).

### 5.9 The one hard input block: long leading `sleep`

`validateInput` (`515906`), active only when the Monitor feature is on and the call isn't already
backgrounded:

```js
{ result: !1,
  message: `Blocked: ${r}. To wait for a condition, use Monitor with an until-loop (e.g. \`until <check>; do sleep 2; done\`). To wait for a command you started, use run_in_background: true. Do not chain shorter sleeps to work around this block.`,
  errorCode: 10 }
```

`r` comes from `o_r` (`515769`): the first sub-command must match `/^sleep\s+(\d+(?:\.\d*)?)\s*$/`
with a value ≥ `h1t = 25` seconds (`472830`), producing either
`` `sleep <n> followed by: <rest>` `` or `` `standalone sleep <n>` ``.

### 5.10 Destructive-operation classification

`Ob`/`T9e` (`439370`) scans the command against a pattern table (`Htn`) producing
`{category, warning}` pairs used for confirmation copy and telemetry. The PowerShell twin (`qrn`,
`443660`) is fully visible and shows the shape:

| category | warning |
|---|---|
| `remove_item_recursive_force` | "Note: may recursively force-remove files" |
| `remove_item_recursive` | "Note: may recursively remove files" |
| `remove_item_force` | "Note: may force-remove files" |
| `clear_content_glob` | "Note: may clear content of multiple files" |
| `format_volume` | "Note: may format a disk volume" |
| `clear_disk` | "Note: may clear a disk" |
| `git_reset_hard` | "Note: may discard uncommitted changes" |
| `git_force_push` | "Note: may overwrite remote history" |
| `git_clean_force` | "Note: may permanently delete untracked files" |
| `git_stash_drop` | "Note: may permanently remove stashed changes" |
| `sql_drop_truncate` | "Note: may drop or truncate database objects" |
| `stop_computer` / `restart_computer` | "Note: will shut down / restart the computer" |

`Aee` (`439374`) then computes a *target scope* for rm-class categories (`none` / `unknown` /
`mixed` / a scope name) by symbolically evaluating leading `cd`/`pushd`/`popd` (`qtn`, `439404`) —
this is why `git_destructive_target` and `destructive_target_scope` appear in the telemetry at
`516034`.

### 5.11 Telemetry (the observable state machine)

- `tengu_bash_tool_command_executed` / `tengu_bash_tool_command_failed` (`516064`, `516034`) —
  fields: `command_type, stdout_length, stderr_length, exit_code, interrupted, executor_shell,
  executor_shell_overridden, sandboxed, sandbox_enabled, dangerously_disable_sandbox,
  filesystem_policy, call_origin, had_sandbox_violation, was_backgrounded, tool_use_id,
  destructive_category, destructive_target_scope, git_destructive_target, permission_mode`
- `tengu_bash_ast_too_complex`, `tengu_bash_command_clamp_denied`
- `tengu_bash_command_explicitly_backgrounded`, `tengu_bash_command_timeout_backgrounded`,
  `tengu_bash_command_turn_abort_backgrounded`, `tengu_bash_task_ack`
- `tengu_shell_snapshot_failed`, `tengu_shell_snapshot_error`, `tengu_shell_unknown_error`,
  `tengu_shell_set_cwd`, `tengu_bash_tool_reset_to_original_dir`
- `tengu_input_bash` (the `!` passthrough), `tengu_git_index_lock_error`
- `tengu_agent_worktree_cwd_escape_blocked`
- OTel span `claude_code.bash.subprocess` with `shell.type`, `command_length`, `timeout_ms`,
  `command`, `command_prefix`, `exit_code`, `stdout_bytes`, `stderr_bytes`, `interrupted`,
  `backgrounded` (`472720`).

---

## 6. Background tasks

### 6.1 Tool inventory and the alias remap

```js
var i = { Task: "Agent", KillShell: "TaskStop", KillBash: "TaskStop",
          AgentOutputTool: "TaskOutput", BashOutputTool: "TaskOutput",
          AgentOutput: "TaskOutput", BashOutput: "TaskOutput",
          ListPeers: "ListAgents", Brief: "SendUserMessage", … };
```
— `402072`. **`BashOutput` and `KillShell` no longer exist as tools**; they are accepted names that
resolve to `TaskOutput` / `TaskStop`.

### 6.2 `run_in_background` mechanics

In `Gcr` (`516107`):

```js
if (Ee === !0 && !tt) {                       // Ee = run_in_background, tt = backgrounding disabled
  if (en.status === "completed") { let hn = await ut; if (hn.preSpawnError) return hn; }
  let fn = await Ve();                        // Ve() → Kee(...) registers the task
  return s("tengu_bash_command_explicitly_backgrounded", { command_type: wK(ge) }),
         { stdout: "", stderr: "", code: 0, interrupted: !1, backgroundTaskId: fn };
}
```

So an explicitly backgrounded command returns **empty stdout, exit 0** immediately.

`Kee` (`514717`) mints the registry entry:

```js
let { taskOutput: x } = u, M = x.taskId;
let F = { ...Md(M, "local_bash", o, d), type: "local_bash", status: "running",
          command: r, cwd: ee(), completionStatusSentInAttachment: !1,
          shellCommand: u, lastReportedTotalLines: 0, isBackgrounded: !0,
          agentId: _, kind: C };
A.register(F);
u.background(M, { capMs: C !== "monitor" ? SWt(_) : undefined });
```

The **task id is the output-collector id**, minted by `Oh("local_bash")` — so the id and the output
file are one-to-one. Output path: `yl(id)` → `<tasks dir>/<id>.output` (`25301`), where the tasks dir
is `<Claude home>/<sessionId>/tasks` (`25288`).

Subagent-owned background shells get a **1 hour hard cap** (`SWt`, `514604`:
`CLAUDE_SUBAGENT_BG_SHELL_MAX_MS || glr` where `glr = 3600000`).

### 6.3 The message the model gets (verbatim, `b1t` at `472908`)

```js
let C = r ? `Command was manually backgrounded by user with ID: ${e}. Output is being written to: ${t}.`
        : o ? `Command was moved to the background (ID: ${e}) so that a message that arrived while it was running can reach you; it was not interrupted. Output is being written to: ${t}.`
        : u !== void 0 ? `Command did not complete within its ${Math.max(1, Math.round(u/1000))}s timeout and was moved to the background (ID: ${e}). Output is being written to: ${t}.`
        : `Command running in background with ID: ${e}. Output is being written to: ${t}.`;
let A = d ? "If it exits while you are still working you will be notified, but it is terminated when you give your final response and no notification can follow that — so do not end your turn to wait for it; if you need its result, wait for it before giving your final response."
        : r ? undefined
        : "You will be notified when it completes.";
let x = r ? undefined : `To check interim output, use Read on that file path.`;
return [C, A, x].filter(Boolean).join(" ");
```

Plus, when a backgrounded command contained a `cd`-family builtin (`516085`):

> Session cwd remains `<cwd>`; directory changes made by the backgrounded command do not apply to
> subsequent commands.

### 6.4 Task-completion notification

`M$e` (`514673`) fires when a background shell exits. It first appends a terminator to the output
file (`tLe`, `514680`):

```
\n[exited with code <N>]\n     or     \n[killed]\n
```

then builds a `<task-notification>` via `Pu` (`433496`) with tag constants from
`chunk-qpcjd2zp.js`: `Dl="task-notification"`, `S0="task-id"`, `QCe="tool-use-id"`,
`QAt="task-type"`, `XJe="output-file"`, `e_="status"`, `N_="summary"`. For a shell task the emitted
block is:

```xml
<task-notification>
<task-id>{taskId}</task-id>
<tool-use-id>{toolUseId}</tool-use-id>
<output-file>{path}</output-file>
<status>completed|failed|killed</status>
<summary>{summary}</summary>
</task-notification>
```

The summary (`x$e`, `514640`) with prefix `ZCe = "Background command "`:

- `Background command "<desc>" completed (exit code N)`
- `Background command "<desc>" failed with exit code N`
- `Background command "<desc>" was stopped`

Monitor tasks get their own phrasing:
- `Monitor "<desc>" ended without producing output`
- `Monitor "<desc>" stream ended`
- `Monitor "<desc>" script failed`
- `Monitor "<desc>" stopped`

It is enqueued with `mode: "task-notification", priority: "next", skipAttachments: true` — i.e. it is
injected as a **user-role message at the next turn boundary**, wrapped in a `<system-reminder>`
(documented for the model at `75153`: *"Worker results arrive as user-role messages containing
`<task-notification>` XML, delivered as harness input… They are not the user speaking, and never
something you write yourself"*).

Status mapping (`P$e`, `514817`): `interrupted → "killed"`, `code===0 → "completed"`, else `"failed"`.

`blr` (`514686`) is the *withdrawal* path: when the task's result can instead be delivered directly
as the pending tool result, the queued notification is consumed with
`reason: "delivered_as_tool_result"`.

Stall watchdog `kWt` (`514619`): every `mlr = 45000` ms of no new output bytes it checks the tail
against interactive-prompt patterns (`ylr`, `514617`: `(y/n)`, `[y/n]`, `(yes/no)`,
`Do you|Would you|Shall I|Are you sure|Ready to …?`, `Press (any key|Enter)`, `Continue?`,
`Overwrite?`) and surfaces that the process is likely waiting on input.

### 6.5 `TaskOutput` (a.k.a. `BashOutput`)

`hSt` at `476014`. Input schema (`MFn`, `475968`) — verbatim descriptions:

```js
ot({ task_id: i().describe("The task ID to get output from"),
     block:  Yb(q().default(!0)).describe("Whether to wait for completion"),
     timeout: v().min(0).max(600000).default(30000).describe("Max wait time in ms") })
```

**There is no `filter` regex and no cursor/offset.** The whole current output is returned every time.

`description()`:

> [Deprecated] — for bash and remote_agent tasks, prefer Read on the output file path; for local_agent
> tasks, use the Agent tool result directly

`prompt()`, verbatim (`476029`):

```
DEPRECATED: Background tasks return their output file path in the tool result, and you receive a <task-notification> with the same path when the task completes.
- For bash tasks: prefer using the Read tool on that output file path — it contains stdout/stderr.
- For local_agent tasks: use the Agent tool result directly. Do NOT Read the .output file — it is a symlink to the full subagent conversation transcript (JSONL) and will overflow your context window.
- For remote_agent tasks: prefer using the Read tool on the output file path — it contains the streamed remote session output (same as bash).

- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions
```

Blocking semantics (`IFn`, `476000`): poll `getAppState().tasks[id]` every **100 ms** until status
leaves `running|pending` or the timeout expires; abort throws. Non-blocking returns
`retrieval_status: "not_ready"`.

Result envelope (`476062`):

```
<retrieval_status>success|not_ready|timeout</retrieval_status>

<task_id>…</task_id>

<task_type>…</task_type>

<status>…</status>

<exit_code>…</exit_code>

<output>
…
</output>

<error>…</error>
```

For `local_bash`, output is `[stdout, stderr].filter(Boolean).join("\n")` (`475987`).

Validation failure: `` `No task found with ID: ${e}` `` plus a listing of live task ids (`476102`).

### 6.6 `TaskStop` (a.k.a. `KillShell` / `KillBash`)

`Dre` at `473795`. Schema:

```js
ot({ task_id: i().optional().describe("The ID of the background task to stop. Agent-team teammates and named background agents are also accepted by agent ID or name."),
     shell_id: i().optional().describe("Deprecated: use task_id instead") })
```

Output schema: `{ message, task_id, task_type, command? }`.
`description()`: `"Stop a running background task by ID"`.
`prompt()` = `VXn` (`641639`), verbatim:

```
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- To stop an agent-team teammate, pass its agent ID ("name@team") or bare teammate name as task_id
- To stop a background agent spawned with a name, pass that name as task_id
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
```

Failures: `"Missing required parameter: task_id"` (code 1),
`` `Task ${d} is not running (status: ${_.status})` `` (code 3).
Success: `` `Successfully stopped task: ${C.taskId} (${C.command})` ``.
There is also an observer guard (`473677`):
`` `Observer ${F} cannot stop itself; use the task UI or a main-session TaskStop.` ``

### 6.7 `Monitor`

Name constant `ma = "Monitor"` (`667667`); enabled by `RI() && as()` where
`RI() = I("tengu_amber_sentinel", !1)` (`233676`) — a gated feature.

Input schema (`ue`, `187475`):

```js
ot({ description: i().describe("Short human-readable description of what you are monitoring (shown in notifications)."),
     timeout_ms: v().min(1000).optional().default(300000)
        .describe("Kill the monitor after this deadline. Default 300000ms, max 3600000ms. Ignored when persistent is true."),
     persistent: q().optional().default(!1)
        .describe("Run for the lifetime of the session (no timeout). Use for session-length watches like PR monitoring or log tails. Stop with TaskStop."),
     command: string?.describe("Shell command or script. Each stdout line is an event; exit ends the watch."),
     ws: { url, protocols? }?.describe("WebSocket to open. Each text frame is an event; binary frames are reported as a placeholder line. Socket close ends the watch. Cannot be combined with command.") })
  .refine(exactly-one-of(command, ws))
  .refine(persistent || timeout_ms <= 3600000, { message: "timeout_ms must be ≤ 3600000", path: ["timeout_ms"] })
```

Constants: `N = 3600000` (max), `F = 1800000` (remote clamp), `B = 300000` (default).
In remote mode (`lBn`, `187478`) `persistent` is forced off and the timeout clamped to 30 min.

Output: `{ taskId, timeoutMs, persistent? }`, rendered to the model as (`187539`):

> Monitor started (task `<id>`, persistent — runs until TaskStop or session end | timeout `<n>`ms).
> You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while
> you are waiting for the user — an event is not their reply.

The tool prompt (`Dmn`, `233682` + `Omn`, `233742` + `Pmn`, `233669`) is long; the load-bearing
parts, verbatim:

> Start a background monitor that streams events from a long-running script. Each stdout line is an
> event — you keep working and notifications arrive in the chat. Events arrive on their own schedule
> and are not replies from the user, even if one lands while you're waiting for the user to answer a
> question.
>
> Pick by how many notifications you need:
> - **One** ("tell me when the server is ready / the build finishes") → use **Bash with
>   `run_in_background`** and a command that exits when the condition is true, e.g.
>   `` until grep -q "Ready in" dev.log; do sleep 0.5; done ``. You get a single completion
>   notification when it exits.
> - **One per occurrence, indefinitely** ("tell me every time an ERROR line appears") → Monitor with
>   an unbounded command (`tail -f`, `inotifywait -m`, `while true`).
> - **One per occurrence, until a known end** ("emit each CI step result, stop when the run
>   completes") → Monitor with a command that emits lines and then exits.

> **Don't use an unbounded command for a single notification.** `tail -f`, `inotifywait -m`, and
> `while true` never exit on their own… Note that `tail -f log | grep -m 1 ...` does *not* fix this:
> if the log goes quiet after the match, `tail` never receives SIGPIPE and the pipeline hangs anyway.

> **Coverage — silence is not success.** When watching a job or process for an outcome, your filter
> must match every terminal state, not just the happy path. A monitor that greps only for the success
> marker stays silent through a crashloop, a hung process, or an unexpected exit — and silence looks
> identical to "still running." Before arming, ask: *if this process crashed right now, would my
> filter emit anything?* If not, widen it.

> Stdout lines within 200ms are batched into a single notification, so multiline output from a single
> event groups naturally.
>
> The script runs in the same shell environment as Bash. Exit ends the watch (exit code is reported).
> Timeout → killed. Set `persistent: true` for session-length watches… Use TaskStop to cancel early.

Mechanically (`de`, `187487`): `Monitor` calls the same `LG(..., "bash", {onStdout: O.onData,
preventCwdChanges: !0, shouldUseSandbox: bv({command})})`, registers a task with `kind: "monitor"`,
and arms a `setTimeout` that emits `[Monitor timed out — re-arm if needed.]` then `TaskStop`s itself.
Only **stdout** is an event stream; stderr goes to the output file. Rate limiting exists — an
over-chatty monitor is suppressed with (`463322`):

> `[<N> events suppressed — output rate too high. Consider using TaskStop to restart this monitor
> with a more selective filter.]`

WebSocket permission check `pe` (`187510`) denies SSRF ranges, compliance-disabled egress, and
sandbox-policy-blocked hosts:
> `Monitor cannot open a WebSocket to <host>: <detail>.`
and otherwise asks: `Monitor will open a WebSocket to <url> (subprotocols: …)`.

### 6.8 Auto-backgrounding: three paths

All in `Gcr` (`516107`–`516250`) with `kzt = 2000` (`515680`).

1. **Arming at 2 s.** After the command has run for `kzt` ms the harness registers a *non-backgrounded*
   task (`YFt`, `514735`, with `isBackgrounded: !1`) and emits a `background_hint` tool-progress event.
   This is what makes **Ctrl+B** (`645906`, chord `ctrl+b`, or `ctrl+b ctrl+b` under tmux, keyhint
   *"run in background"*) possible mid-command. Confirming it calls `Kdt` (`514779`) which flips
   `isBackgrounded`, spills output to disk, and installs the stall watchdog.

2. **Timeout.** `Pde` (`414700`) is constructed with `canAutoBackground` (`u`); at timeout its static
   `#v` handler either calls the registered `onTimeout` callback (→ background) or kills with `143`:

   ```js
   static #v(e) { if (e.#y && e.#d) e.#d(e.background.bind(e)); else e.#h(WUe); }
   ```
   Eligibility (`r_r` → `n_r`, `515758`/`515745`): the command must parse `simple`, must contain **no
   git sub-command**, and its first sub-command's head word must not be `sleep`
   (`$cr = ["sleep"]`, `515719`). Telemetry `tengu_bash_command_timeout_backgrounded`;
   the result carries `timedOutAfterMs`.

3. **Turn abort.** When the turn is aborted for a reason that "backgrounds the shell"
   (`$A.backgroundsTheShell(reason, caller)`), a non-git command is moved to the background rather
   than killed (`Pt = !tt && !/git/i.test(ge)`, `516112`); telemetry
   `tengu_bash_command_turn_abort_backgrounded`, result flag `backgroundedByTurnAbort`.

A fourth flavour, `backgroundedToDeliverMessage`, fires when a user message queued mid-command needs
to reach the model (`JFt`, `514763`).

Ack telemetry `tengu_bash_task_ack` (`516100`) tags the trigger as
`user | turn_abort | deliver_message | timeout | explicit`.

### 6.9 Interrupts spare background tasks

`Pde.#E` (`414723`):

```js
#E() {
  let e = Za(this.#l.reason);
  if (e === "interrupt" || $A.backgroundsTheShell(e, this.#f)) return;   // ← do NOT kill
  this.kill();
}
```

So an abort whose reason is a plain user interrupt, or one classified as "backgrounds the shell",
leaves the child alive. Conversely `nct()` (`414625`) force-kills every `liveShellCommands` entry —
that is the shutdown path, not the interrupt path. Backgrounded commands are removed from
`liveShellCommands` on `detach()` (`414833`).

### 6.10 Output-file guards on background shells

`#T` (`414755`) polls the output file every `qKt = 5000` ms:
- size over `ZOe` (default cap) → kill with 137, message
  `` `Command killed: output file exceeded ${jjt}` ``
- file replaced / unverifiable → kill with 137, message
  `Command killed: its output file was replaced or could no longer be verified`

### 6.11 Disabling background work

- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` or the `backgroundTasksDisabled` gate → `$d()` true →
  `run_in_background` is **removed from the schema** and the `rzt()` prompt paragraph disappears.
- `CLAUDE_AUTO_BACKGROUND_TASKS`, `CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS`,
  `CLAUDE_CODE_AUTO_BACKGROUND_WORKER_CHECKIN_SECONDS`,
  `CLAUDE_SUBAGENT_BG_SHELL_MAX_MS`, `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP` tune the rest.
- Remote calls can carry `constraints.background === "forbidden"`.

---

## 7. Adjacent execution details

### 7.1 The `!` user bash passthrough

`processBashCommand` in `chunk-2v4t1zym.js` (`108954`). It is a *REPL input mode*, not a tool the
model calls:

```js
let l = Je().respondToBashCommands ?? !0;
s("tengu_input_bash", { powershell: u, respond: l });
let d = xe({ content: pF({ inputString: `<bash-input>${n}</bash-input>`, … }) });
…
let t = (await yi.call({ command: n, dangerouslyDisableSandbox: !0 }, o, …)).data;
…
return { messages: [ …, d, xe({ content: `<bash-stdout>${P}</bash-stdout><bash-stderr>${y}</bash-stderr>` }) ],
         shouldQuery: c };
```

Three things a replicator must copy:
1. **User-typed `!` commands always run unsandboxed** (`dangerouslyDisableSandbox: !0`, `108967`).
2. The transcript markers are `<bash-input>`, `<bash-stdout>`, `<bash-stderr>` — and the toolUseId is
   suffixed `":inner"` (`dGe`, `515841`) so the permission layer treats it as a nested call.
3. `respondToBashCommands` (default true) decides whether the model is queried after the command; if
   false, an `nz()` sentinel is prepended and `shouldQuery` is false.

Failure path: `` `<bash-stderr>Command failed: ${…}</bash-stderr>` ``.
The `<bash-input>` marker is also what history-restore keys on (`151468`).

Slash commands use a parallel pair, `<local-command-stdout>` / `<local-command-stderr>` (`76470` ff.).

### 7.2 Git awareness

**a) Startup snapshot** (`EMTt` at `496967`). Runs `git status --short`, `git log --oneline -n 5`,
`git config user.name`, current branch and main branch, all with `--no-optional-locks`, and injects:

```
This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.

Current branch: <branch>

Main branch (you will usually use this for PRs): <main>

Git user: <name>

Status:
<status or "(clean)">

Recent commits:
<log>
```

`status` is capped at `KMe = 2000` chars with:

```
... (truncated because it exceeds 2k characters. If you need more information, run "git status" using Bash)
```

Gated by `$q()` — `includeGitInstructions` / `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` — and skipped
entirely under `CLAUDE_CODE_REMOTE`.

**b) Per-command git-operation classification** (`R3e`, `449350`). After each non-backgrounded Bash
call, the harness parses command + stdout to produce the `gitOperation` result field:
`{commit:{sha,kind:"committed"|"amended"|"cherry-picked",branch?}, push:{branch},
branch:{ref,action:"merged"|"rebased"}, pr:{number,url?,action}}`. It is explicitly
**client-facing only, not surfaced to the model** (`515744`), and it feeds session→PR linking
(`a1t` at `449444`, `markPrResolvedThisSession`).

**c) Repository-shape safety** — bare-repo indicators and untrusted `.git` redirection force approval
for git commands (§5.6); `.git/hooks` and `.git/config` are unconditionally write-denied in the
sandbox (§4.3); `git safe.directory` is injected as `GIT_CONFIG_KEY_n` pairs (§4.8).

**d)** `.git/index.lock': File exists` in stdout emits `tengu_git_index_lock_error` (`516009`).

### 7.3 "Use Grep instead of grep" and friends

The tool description carries it (§1.4), but two enforcement layers back it up:
- The shell snapshot shadows `rg` (always, when the user has none) and `find`/`grep` (ant-native
  builds) with the bundled binaries (§2.3).
- `USE_BUILTIN_RIPGREP` and `sandbox.ripgrep.{command,args}` control which ripgrep the shadow points
  at, the latter honoured only from user/managed/CLI settings.

There is also a `noOutputExpected` classifier (§3.4) and a `t_r` search/read/list classifier (§5.6)
that let the harness treat a `grep` invocation as concurrency-safe and read-only.

### 7.4 `sed -i` intercepted as a file Edit

`Vee` (`515579`) parses a single-command `sed -i` invocation and, when it matches a
simple substitution, the Bash tool:
- reports `userFacingName()` as the Edit tool rendering (`515894`),
- stashes a *write* permission for the target path (`515913`),
- and if the client sends back `_simulatedSedEdit`, applies the pre-computed edit through the file
  layer instead of shelling out (`jcr`, `515782`), refusing when the path resolves outside the
  editable roots:
  > `<path>`: when this edit was checked the path resolved outside the directories edits may land in;
  > not applying it. Use the Edit tool (or add the directory) for files outside the working
  > directories.

### 7.5 Post-command file-state reconciliation

After a non-backgrounded command the harness diffs `readFileState` mtimes (`zcr`) and appends
(`516090`):

```
[This command modified N files you've previously read: a.ts, b.ts and 3 more. Call Read before editing.]
```

and re-reads small changed files into `readFileState` (`KWt`, `515355`, capped at 10 MB per file).

### 7.6 `<claude-code-hint>` — stdout as a control channel

`oct` (`431816`) scans command stdout for lines matching

```
^[ \t]*<claude-code-hint\s+([^>]*?)\s*/>[ \t]*$
```

with `v="1"` and `type="plugin"`, **strips them from the model-facing output**, and routes the value
into the session's pending-hint queue. Unsupported `v`/`type`/empty value are dropped with a debug
log. A replicator that ignores this will leak the tags into the transcript.

### 7.7 GitHub rate-limit reminder

`Gtt` (`449543`) appends, once per backoff window, when a `gh` command reports a rate limit:

```
<system-reminder>GitHub API rate limit exceeded (5,000/hr shared across all tools and agents). Run `gh api rate_limit --jq .resources` and sleep until reset before further gh calls. If polling in a loop, use ScheduleWakeup instead of retrying.</system-reminder>
```

### 7.8 Worktree isolation guards

When an agent is pinned to a worktree, `LG` refuses to spawn if the cwd escapes it (`472620`–`472657`):

- > The working-directory isolation context for this agent was lost, so this command would run in the
  > parent session's directory instead of this agent's worktree (`<path>`). Refusing to run it. Retry
  > the command; if this keeps failing, report that worktree isolation was lost.
- > This agent is isolated in the worktree `<path>`, but its working directory "`<cwd>`" no longer
  > exists and the only recovery target is the parent session's shared checkout. Refusing to run
  > there — the isolation worktree appears to have been removed. Report this instead of retrying.
- > Working directory "`<cwd>`" no longer exists. Please restart Claude from an existing directory.
- > Working directory "`<cwd>`" was deleted; shell cwd recovered to "`<new>`". Re-issue your command
  > (it will run from the recovered directory).

Telemetry `tengu_agent_worktree_cwd_escape_blocked` with reasons
`context_lost | worktree_gone | shared_checkout | command_redirect`.

### 7.9 Image output from bash

If stdout is a `data:image/…;base64,…` URI (`aut`, `472834`), truncation is skipped entirely, the
payload is decoded, re-encoded and possibly resized (`sue`), and the tool result becomes an image
content block (`515935`, `y1t`). The reader caps at `kre` bytes when reading from the output file
(`472880`).

---

## Deltas vs the February parity rows

### `10-tool-bash.md`

| row | February claim | 2.1.251 reality |
|---|---|---|
| 10.1 | "Single bash command execution" | Still true, but the command is **wrapped**, not executed as typed: snapshot source + extglob-off + `unsetenv` unalias + `eval '<cmd>'` + `pwd -P >| file`, joined by `&&` (`472427`). A replicator that just runs `bash -c "$cmd"` will differ on aliases, functions, `$PATH`, and cwd persistence. |
| 10.2 | "max 600000" | **Confirmed**: `Uqt = 120000`, `Bqt = 600000` at `413444`. New: the effective value is `min(requested, max, remoteMaxTimeoutMs)` and can be *shrunk* by `CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS` (`413466`). |
| 10.3 | `run_in_background` present | Still present, **but the field is omitted from the schema entirely** when background tasks are disabled (`515719`) rather than being ignored. Result on launch is `{stdout:"", stderr:"", code:0, backgroundTaskId}`. |
| 10.4 | "Auto-backgrounding on timeout" | Now **three** distinct paths (timeout / turn-abort / deliver-message) plus a 2 s "arm for Ctrl+B" step, each with its own result flag and telemetry event (§6.8). Timeout auto-background is **gated**: refused for git commands and for leading `sleep`. |
| 10.5 | "assistantAutoBackgrounded (KAIROS)" | **Gone.** Zero occurrences of `assistantAutoBackgrounded` in the bundle. Replaced by `timedOutAfterMs`, `backgroundedByUser`, `backgroundedByTurnAbort`, `backgroundedToDeliverMessage`, `backgroundEndsWithFinalResponse`. This row should be rewritten. |
| 10.6 | "OS-level command sandboxing" | Far larger than the row implies, and **it is a vendored library**: `@anthropic-ai/sandbox-runtime` inlined at `680300`–`684760` (`ct`, `684740`) with a Claude Code manager on top (`pt`, `688045`). Three platform backends (macOS seatbelt, Linux bwrap + a vendored `apply-seccomp` AF_UNIX blocker, Windows `srt-win`); an unconditional write-deny list covering rc files, `.mcp.json`, `.git/hooks`, `.git/config`, `.claude/commands`, `.claude/agents` (§4.3); an **in-process HTTP+SOCKS mux proxy** whose allowlist is merged from `sandbox.network.allowedDomains` *and* `WebFetch(domain:…)` permission rules, with per-command attribution through the proxy username (§4.8); optional TLS MITM; three violation producers feeding one 100-entry ring buffer that strips `<`/`>` as injection defence (§4.4). Settings now include `failIfUnavailable`, `allowUnsandboxedCommands`, `enableWeakerNestedSandbox`, `enableWeakerNetworkIsolation`, `allowAppleEvents`, `credentials`, `ignoreViolations`, `bwrapPath`, `socatPath`, `ripgrep`, `filesystem.disabled`, `network.allowManagedDomainsOnly`, `network.strictAllowlist`, plus a managed-settings-only provenance tier and remote gates (`disableNoSandbox`, `forbidUnsandboxedCommands`, `filesystemPolicy`). |
| 10.7 | "Per-call sandbox override" | Confirmed, plus the un-noted consequence: setting it **forces `behavior:"ask"`** with `decisionReason.type === "sandboxOverride"` and message `"Run outside of the sandbox"` (`515928`), and it is stripped from remote calls (`413894`). |
| 10.8 | "Output truncation / persistence" | Confirmed and now exact: 30000 default / 150000 ceiling; the marker is `` `\n\n... [N lines truncated] ...` `` where **N counts the kept lines, not the dropped ones**; separate 8 MB in-memory→spill threshold with `[stderr] ` prefixes and an `Output truncated (NKB total). Full output saved to: <path>` tail. |
| 10.9 | "tree-sitter Bash AST permission analysis" | Shape-correct, implementation changed: a **hand-written parser bundled as `chunk-fgwne0fb.js`** exposing tree-sitter-bash node names (`398569`). Also new: a span-coverage check rejecting commands where the parser skipped or failed to consume input (`245692`). |
| 10.10 | `_simulatedSedEdit` internal | Still internal and still always stripped, and the surrounding behaviour is richer than the row: `userFacingName()` renders as an Edit, a write permission is stashed, and the apply path enforces the editable-roots boundary (`515782`). |
| 10.11 | "Git/PR operation tracking — no SDK surface" | Now a **typed result field** `gitOperation` on the Bash output schema (`515744`), explicitly annotated "Client-facing — … not surfaced to the model." Still not a model-visible capability, but it *is* a structured contract a client can consume. |
| 10.12 | "Disable background tasks" | Confirmed (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`), with the schema-omission consequence noted above. |
| 10.13 | "Image output from bash" | Confirmed (`isImage`), with the additional detail that image output bypasses truncation entirely. |
| — | *(missing row)* | **The lean vs full tool description split** (`515565`). A parity table for the Bash tool should record that the prompt text is model-dependent. |
| — | *(missing row)* | **The long-`sleep` input block** (`515906`, errorCode 10) — a hard `validateInput` refusal, not a permission decision. |
| — | *(missing row)* | **The shell snapshot mechanism** as a first-class capability (`~/.claude/shell-snapshots`, `472229`). |
| — | *(missing row)* | **`bashCommandClamps`** — per-spawn command-form clamping (`443375`). |

### `15-tool-tasks.md`

| row | February claim | 2.1.251 reality |
|---|---|---|
| 15.5 | "TaskStop tool" | Confirmed; `KillShell`/`KillBash` are **aliases** on the same tool (`473795`), and it also accepts agent IDs / teammate names. |
| 15.6 | "CC itself deprecates TaskOutput in favor of Read on the output-file path" | **Confirmed verbatim** — the tool's own `description()` starts `"[Deprecated]"` and its `prompt()` starts `"DEPRECATED:"` (`476029`). The row's inference was right. Add: `block`/`timeout` semantics are a 100 ms poll to a 30 s default / 600 s max, and there is **no output filter or cursor**. |
| 15.7 | "Background task runtime (AppState.tasks)" | Confirmed. Registry entry shape for shells is at `514717`: `{type:"local_bash", status, command, cwd, shellCommand, lastReportedTotalLines, isBackgrounded, agentId, kind, notified, terminal:{summary,output_file}}`. Note `kind: "monitor"` as a distinct flavour. |
| 15.8 | "run_in_background surfaces as a Task started/notification; output file readable via Read" | Confirmed, and the exact notification XML and summary strings are now pinned (§6.4). Add: the output file gets a `[exited with code N]` / `[killed]` terminator appended before the notification fires (`514680`). |
| — | *(missing row)* | **`Monitor`** (`667667`, gate `tengu_amber_sentinel`) — a per-stdout-line notification stream with a `ws:` WebSocket source, `persistent` mode, 200 ms batching, and automatic suppression of over-chatty monitors. Nothing in the February tables covers it. |
| — | *(missing row)* | **Task-notification injection contract** — `<task-notification>` with `<task-id>/<tool-use-id>/<output-file>/<status>/<summary>`, delivered as a user-role message inside a `<system-reminder>` at the next turn boundary, with a withdrawal path when the result can be delivered as a tool result instead (`514686`). |
| — | *(missing row)* | **Subagent background-shell cap** of 1 h (`CLAUDE_SUBAGENT_BG_SHELL_MAX_MS`, `514604`) and `backgroundEndsWithFinalResponse` semantics. |
| — | *(missing row)* | **Interrupt sparing** — `Pde.#E` (`414723`) does not kill on a plain interrupt. |

---

## Open questions

1. **`jjt` and `ZOe`** — the background output-file size cap constants referenced at `414785` and
   `472604` were not resolved to numbers. `ZOe` is the default `#u` on `Pde`; its value determines
   when a background command is killed for output volume.
3. **The `Htn` destructive-pattern table for POSIX shell** (`439365`) was inferred from its
   PowerShell twin (`443660`). The bash table's exact patterns and categories are unread.
4. **`I8`** (`443440` call site) — the path-level redirect/rm permission layer — was not read. It is
   the piece that decides whether `> /etc/passwd` or `rm -rf ~` is denied outright.
5. **`H$t`/`Flr`** (`515033`) — a per-(tool, command) dedupe used only when sandboxing; its purpose
   (suppressing repeated sandbox prompts for an identical command?) is inferred, not confirmed.
6. **`FE()`** (`75056`) gates whether a background shell's result is delivered as a tool result
   (`GMt`, `515967`) versus only as a notification. The gate's condition is unread and it changes the
   observable protocol.
7. **Whether the lean description is the default for current production models.** `td(e)` →
   `leanPrompt(model)` (`651364`) resolves through a gate table (`651290`–`651360`) using obfuscated
   experiment names (`CLAUDE_CODE_GORSE_PLOVER`, `tengu_velvet_tide`, `opus_5_prompt_bundle`). A live
   probe against the real CLI would settle it faster than reading further.
8. **`b2e(storageV5)`** (`472449`) injects a credential block into every command's preamble. What it
   contains — and therefore what a sandboxed command can read from its own environment — was not
   traced. Related: `sandbox.credentials.envVars` `deny`/`mask` modes and `eor(...)` (`472461`).
