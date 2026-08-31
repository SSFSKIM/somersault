# Claude Code 2.1.251 — Bundle Anatomy, Boot, CLI Surface, Configuration

Research notes mined from `/Users/new/claude-code-bundle/2.1.251/cli.pretty.js` (881,404 lines; 1,792
beautified ESM chunks + the `cli` entry stub) and `modules/`. Every line citation below is
`cli.pretty.js:<line>` unless another file is named. Claims marked **INFERRED** were not read
directly from code.

## Executive summary

1. The shipped artifact is a **Bun standalone executable** (`Bun.isStandaloneExecutable`, 770029)
   whose `__BUN` section holds an **ESM chunk graph** — a 19 KB `cli` entry stub plus 1,792
   `chunk-*.js` modules, each paired with precompiled JS bytecode; assets are addressed as
   `/$bunfs/root/<name>`.
2. **The binary *is* ripgrep.** When re-exec'd with `argv[0] == "rg"` it runs ripgrep 14.1.1
   (verified live). Search resolution returns `{mode:"embedded", command: process.execPath,
   args:["--no-config"], argv0:"rg"}` (685293).
3. Five native `.node` addons ship inside: audio capture (voice), computer-use input + a Swift
   macOS bridge (Claude in Chrome / computer use), an image processor, and a URL-event handler for
   the macOS deep-link `.app`.
4. **157 markdown/text docs ship inside the binary** — the whole `claude-api` skill corpus (8
   languages × claude-api/managed-agents), the dataviz/design/run/artifact skill bundles, the
   `claude-code-guide` references, loop preambles, and artifact HTML templates — mostly
   zstd-compressed and decompressed at require time via `Bun.zstdDecompressSync` (742317).
5. Boot is a **two-stage argument parse**: ~18 hard-coded fast paths in the entry stub (daemon,
   pty-host, MCP servers, background/agents, self-hosted runner, tmux worktree, deep link) run
   *before* commander exists; only then does `main` build the commander tree (748318).
6. The main command carries **113 flags** (43 hidden) and there are **19 top-level subcommands**;
   `claude config` and `claude migrate-installer` are **gone** in 2.1.251.
7. Settings merge over five sources, lowest→highest: `userSettings < projectSettings <
   localSettings < flagSettings < policySettings` (80769, 209440). The policy tier is a union of
   MDM plist / Windows registry / `managed-settings.json` / `managed-settings.d/` / remote-org
   settings.
8. **Statsig is dead** — only a legacy `~/.claude/statsig` directory name survives, for cleanup.
   Feature flags are now **GrowthBook**, cached in `~/.claude.json` under `cachedGrowthBookFeatures`,
   refreshed every 360 min by default (310413). ~355 distinct flags, mostly two-word codenames.
9. Env vars are read through a **typed registry of 971 declared variables** in 8 namespaces with
   zod-style coercions (`str/rawStr/bool/triBool/int{min,max,digitsOnly}/enum`) (770014–770497).
10. Native install layout: versions under `$XDG_DATA_HOME/claude/versions/<v>`, staging under
    `$XDG_CACHE_HOME/claude/staging`, locks under `$XDG_STATE_HOME/claude/locks`, and the launcher
    at `~/.local/bin/claude` — **a bare symlink into the versions dir**, not a shell script.

---

## 1. Bundle & process anatomy

### 1.1 Packaging

| fact | value | anchor |
|---|---|---|
| Executable | Mach-O 64-bit arm64, 197,171,680 B | MAP.md |
| Bun payload | `__BUN,__bun` section, offset 66,191,360, size 130,383,427 B | MAP.md |
| Module count | 1,977 resolved (1,801 `.js`, 5 `.node`, 60 `.md`, 97 `.md.zst`, 12 `.txt`, 1 asset) | MAP.md |
| Runtime probe | `jl() => typeof Bun < "u" && Bun.isStandaloneExecutable === !0` | 770029 |
| Bun version (telemetry tag) | `"bun_version:1.4.1"` | 73804 |
| Build metadata | `VERSION "2.1.251"`, `BUILD_TIME "2026-08-28T14:51:38Z"`, `GIT_SHA "37534ac596d80cefb02d272f036adba4ba055d2c"`, `DD_SOURCEMAP_GROUP "darwin"` | modules/cli, 748394 |

The build-info object is **inlined verbatim at every use site** (hundreds of copies) rather than
imported — a constant-folding artifact of the Bun build. It also carries
`HOOKS_WORKER_URL: "/$bunfs/root/src/plugins/functionHooks/hooks-worker/hooks-worker.js"`, the only
`src/`-pathed module in the bundle (5,258 B; a `worker_threads` worker that hosts in-process
"function hooks" and posts ops back over a MessagePort).

Modules are addressed by the virtual path `/$bunfs/root/<name>`; JS imports use static
`import … from "/$bunfs/root/chunk-*.js"`, and non-JS assets use `import.meta.require(...)` or the
zstd loader below.

### 1.2 Embedded asset loader (`chunk-t0k3nmf2.js`, 742317)

```js
var u = [40, 181, 47, 253];                       // zstd magic 28 B5 2F FD
function s(t){ return t.length >= 4 && u.every((e,r)=> t[r] === e) }
function Z2t(t,e){ return d(t) ? t : c(e,t) }      // resolve relative to import.meta.dirname
async function RX(t,e){ let r = await i(Z2t(t,e)); return (s(r) ? await Bun.zstdDecompress(r) : r).toString("utf8") }
function nt(t,e){ … Bun.zstdDecompressSync … }     // sync variant, throws "embedded text asset is missing or corrupt"
```

So `.md.zst` / `.txt.zst` assets are *sniffed*, not trusted by extension — a plain file passes
through unchanged.

### 1.3 Native `.node` addons

Each addon is loaded through a one-line chunk (`T.exports = ue("/$bunfs/root/<name>.node")`).

| addon | size | loader chunk | purpose (evidence) |
|---|---|---|---|
| `audio-capture.node` | 438 KB | `chunk-ag3jcbj1.js` (267568) | Voice dictation. Consumer logs `[voice] audio-capture-napi loaded in …ms` and calls `isNativeAudioAvailable()` (699499). A non-embedded fallback search path exists for `vendor/audio-capture/arm64-<os>[-musl]/audio-capture.node` (121863). |
| `computer-use-input.node` | — | `chunk-mad3xsd3.js` (628180) | Synthetic mouse/keyboard input for computer use. Wrapper adds `isSupported`; throws `"@ant/computer-use-input is not supported on this platform"` (24613). Helpers around it drive `pbcopy`/`pbpaste`, `moveMouse`, click/drag. |
| `computer-use-swift.node` | — | `chunk-nywmdnq6.js` (650758) | macOS Swift bridge exporting `.computerUse` (729746). Owns a **CFRunLoop pump** (`_drainMainRunLoop` on a 1 ms `setInterval`, 729780), an Esc global hotkey, and a 30 s native-call timeout (`computer-use native call exceeded ${e}ms`). |
| `image-processor.node` | — | `chunk-dcywvmhb.js` (349342) | Image decode/resize for pasted and read images (replaces `sharp`; `SHARP_*` env vars still appear in the env registry). |
| `url-handler.node` | — | `chunk-gmyz5g8j.js` (541756) | Exports `waitForUrlEvent(e)` (26165–26180). Used by the macOS deep-link stub app. |

**Deep-link plumbing.** `chunk-…` at 363297 defines the handler app:
`com.anthropic.claude-code-url-handler`, `~/Applications/Claude Code URL Handler.app`, a Linux
`.desktop` at `$XDG_DATA_HOME/applications/claude-code-url-handler.desktop` with
`Exec="<path>" --handle-uri %u`, and Windows
`HKEY_CURRENT_USER\Software\Classes\<scheme>\shell\open\command` = `"<path>" --handle-uri "%1"`.
The scheme is `claude-cli://` (111232). When the binary is launched as the handler app,
`process.env.__CFBundleIdentifier === "com.anthropic.claude-code-url-handler"` routes to
`handleUrlSchemeLaunch()` (748528). Registration can be blocked by the settings key
`disableDeepLinkRegistration` (111232).

### 1.4 Vendored ripgrep — the binary is its own `rg`

`pY()` (685287):

```js
if (bo(a.USE_BUILTIN_RIPGREP)) { let {cmd:r}=lu("rg",[]); if (r!=="rg") return {mode:"system",command:r,args:[]} }
if (jl()) {                                            // standalone Bun executable
  let r = { mode:"embedded", command: process.execPath, args:["--no-config"], argv0:"rg" };
  if (FC(process.execPath)) return r;                  // execPath resolvable
  let {cmd:o}=lu("rg",[]); if (o!=="rg") return {mode:"system",command:o,args:[]};
  return r;
}
let {cmd:t}=lu("rg",[]); return { mode:"system", command:t, args:[] };
```

Verified live (`execv(<versions/2.1.251>, ["rg","--no-config","--version"])`):

```
ripgrep 14.1.1 (rev 392624bedd)
features:+pcre2   simd(compile):+NEON   simd(runtime):+NEON
```

Notes: `USE_BUILTIN_RIPGREP=0/false/no/off` forces the system `rg`; the fallback error string is
`"ripgrep not found on PATH. Install it (brew install ripgrep / apt install ripgrep / winget
install BurntSushi.ripgrep.MSVC) or use the native claude binary which embeds it."` (685304). A
first-use probe runs `<cmd> --version` and asserts the output starts with `"ripgrep "`, then emits
`tengu_ripgrep_availability {working, using_system}` (685851). If `rg` was resolved only by bare
name on `PATH`, searches outside the working directory are refused because Read deny-rules cannot be
applied (685372). `sandbox.ripgrep = {command, args}` overrides it, honored only from user /
managed / `--settings` (111182). An `EAGAIN` retry falls back to `-j 1` (685765).

### 1.5 Embedded document inventory (`modules/*.md|.txt`)

Registries map virtual asset paths to skill-relative file names. Load sites:

| registry | anchor | contents |
|---|---|---|
| `claude-api` skill | 266545 (`chunk-acbm64c6.js`, 266542) | 68 entries: `<lang>/claude-api/{README,batches,files-api,streaming,tool-use,sdk-upgrade}.md` for csharp/go/java/php/python/ruby/typescript, `<lang>/managed-agents/README.md`, `curl/{examples,managed-agents}.md`, and 22 `shared/*.md` (admin-api, agent-design, anthropic-cli, claude-platform-on-aws, cost-optimization, error-codes, live-sources, managed-agents-{api-reference,client-patterns,core,environments,events,memory,multiagent,onboarding,outcomes,overview,scheduled-deployments,self-hosted-sandboxes,tools,webhooks}, model-migration, models, platform-availability, prompt-audit, prompt-caching, token-counting, tool-use-concepts). Same object carries the model-id constants (§4.7). |
| dataviz skill | 272468 | `references/{anti-patterns,choosing-a-form,color-formula,components,interaction,marks-and-anatomy,palette}.md` + `scripts/validate_palette.{js,py}` + `SKILL-8zd8x5rj.md` |
| `run` skill | 211166 | `examples/{cli,electron,library,playwright,server,tui}.md` + `SKILL-9ddmsnpa.md` |
| artifact templates | 254324 | `dashboard`/`report`/`data-table`/`explainer` → `template.html` |
| `claude-code-guide` skill | 323226 | `references/{claude-tag,live-sources,plugin-eval,plugin-eval-quickref,recent-changes}.md` |
| Cowork plugin authoring | 621726 | `references/{component-schemas,example-plugins,mcp-servers,search-strategies}.md` |
| design-canvas skill | 267464 | `payload.template.html` (742 KB zstd) + `seed-canvas.mjs` |
| loop preambles | 704523 | `loopAutonomousPreamble-*.md`, `loopAutonomousPreamblePersistent-*.md` |

Bundled skills with parseable frontmatter: `artifact-components`, `artifact-dashboard`,
`artifact-data-table`, `artifact-design`, `artifact-diagramming`, `artifact-explainer`,
`artifact-pr-review`, `artifact-report`, `design`, `design-sync`, `doc`, `plan-artifact`,
`prototype`, `run`, `run-skill-generator`, `verify`, `whiteboard`, `whiteboard-mp`, `workshop`,
`Data Visualization`. (Several `SKILL-*.md` files were extracted as UTF-16 and read as spaced text;
their frontmatter is intact but the extractor did not transcode.)

Bundled-skill kill switch: `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` or `disableBundledSkills: true`
(33351). Official marketplace: `{source:"github", repo:"anthropics/claude-plugins-official"}` under
the id `claude-plugins-official` (31701); auto-install suppressible by
`CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`.

Other vendored JS assets: `chart.umd.min.js` (583718), `hljsBundle.generated.min.js` (328408),
`mermaid.min.js` (647194) — all artifact-rendering dependencies.

---

## 2. Entrypoint & boot sequence

### 2.1 The `cli` stub (`modules/cli`, 14 lines, reproduced in cli.pretty.js:1–390)

Executed order:

1. `process.env.NoDefaultCurrentDirectoryInExePath = "1"`; `process.env.COREPACK_ENABLE_AUTO_PIN = "0"`.
2. `JCt()` (from `chunk-267dcw4z.js`).
3. If `CLAUDE_CODE_REMOTE === "true"`, append `--max-old-space-size=8192` to `NODE_OPTIONS`.
4. `YCt(process.argv)` — deep-link argument-injection guard: rejects any argument *after*
   `--handle-uri <uri>` with
   `"claude: rejected deep-link invocation — unexpected arguments after the URI."` (589145).
5. `--version` / `-v` / `-V` (optionally `+ --verbose`) prints `2.1.251 (Claude Code)` and, with
   `--verbose`, `Commit: <GIT_SHA>`, then returns — **before** `process.cwd()` is even validated.
6. `Z()` — cwd sanity check; on `ENOENT` prints
   `"The current directory no longer exists (it was deleted or moved). Start Claude Code from an existing directory."`
7. `profileCheckpoint("cli_entry")` from `chunk-5eyryw6w.js`.
8. Optional `pinStorageV5FromEnv()` when `CLAUDE_CODE_HOVER_REST` is set and argv[0] isn't
   `--preload`/`--bg-spare`.

Then a ladder of **fast paths that bypass commander entirely**:

| trigger | handler chunk | checkpoint |
|---|---|---|
| `--eval-mock-server <a> <b>` | `chunk-nwjhabpa.js` | `cli_eval_mock_server_path` |
| `--claude-in-chrome-mcp` | `chunk-673wb1gs.js` | `cli_claude_in_chrome_mcp_path` |
| `--chrome-native-host` | `chunk-m6qy5av3.js` | `cli_chrome_native_host_path` |
| `--computer-use-mcp` | `chunk-2k8dh1ab.js` | `cli_computer_use_mcp_path` |
| `--daemon-worker <id>` | `chunk-sgf6zjmc.js` | — |
| `--bg-pty-host <sock> <cols> <rows> -- …` | `chunk-60t82ke8.js` | — |
| `--bg-spare …` | `chunk-rhf1jbxt.js` | — |
| `--preload …` | `chunk-1pfgk3bj.js` | — |
| `remote-control` \| `rc` \| `remote` \| `sync` \| `bridge` | `chunk-55z5a7vg.js` | `cli_bridge_path` |
| `daemon …` (after skipping leading `--dangerously-skip-permissions` / `--allow-dangerously-skip-permissions`) | `chunk-at9evzf8.js` | `cli_daemon_path` |
| `logs`\|`attach`\|`stop`\|`kill`\|`respawn`\|`rm`, or `--bg`/`--background` anywhere | `chunk-e5mbzrwh.js` | `cli_bg_path` |
| `agents` positional, or `globalConfig.defaultToAgentsView === true` | FleetView via `chunk-5vv54pjd.js` | — |
| `self-hosted-runner [orchestrator\|setup\|doctor\|code-sign\|decode-token]` | `chunk-{p4c3wmbx,f2b775d1,02kp6pz0,ja0s98nh,q2ekb4ff,5cj70w9w}.js` | `cli_self_hosted_runner_path` |
| `--tmux`/`--tmux=classic` **and** `-w`/`--worktree` | `chunk-4sjwmf5z.js` `execIntoTmuxWorktree` | `cli_tmux_worktree_fast_path` |
| `--update` / `--upgrade` (alone) | argv rewritten to `["update"]` | — |
| `--bare` (before `--`) | sets `CLAUDE_CODE_SIMPLE=1` | — |

The stub also runs a mini arg-scanner `XCt` (589095) that harvests `--cwd --settings --add-dir
--plugin-dir --plugin-dir-no-mcp --mcp-config --strict-mcp-config --restricted` plus a bare `agents`
positional, and a second scanner `Dt` that pre-extracts `--dangerously-skip-permissions
--allow-dangerously-skip-permissions --permission-mode --model --effort --agent` into
`dispatchDefaults` for the agents view.

Before commander loads, if the first argv token is **not** in
`NON_REPL_SUBCOMMANDS = {"update","upgrade","doctor"}` (34442) and it is not `mcp serve`,
`plugin[s] eval`, or `remote-control`/`rc`, the stub calls `startCapturingEarlyInput()` so keystrokes
typed during boot are not lost. It then kicks `startMdmRawRead()` and `startKeychainPrefetch()` in
parallel and finally imports `main` from `chunk-thc3f1cf.js`
(`cli_before_main_import` → `cli_after_main_import` → `cli_after_main_complete`).

### 2.2 `main()` (748513) then `run()` (748552)

`main`:

1. `main_function_start` checkpoint; installs `process.on("exit")` banner writer.
2. `--handle-uri <uri>` → `enableConfigs()` then `handleDeepLinkUri(uri)` → `process.exit(rc)`.
3. `__CFBundleIdentifier === "com.anthropic.claude-code-url-handler"` → `handleUrlSchemeLaunch()`.
4. `claude import [source]` rewrite (502778): argv becomes `[…prefix, "--", "/import <rest>"]`,
   i.e. the subcommand *starts an interactive session running the `/import` slash command*. If the
   config can't be read: `"Could not read Claude Code config — run \`claude\` with no arguments to
   recover it."`; if the feature is off: ``"`claude import` is not yet available in this build. Run
   `claude` and use /mcp or edit ~/.claude/settings.json directly."``
5. `hn({interactivity:{kind:"detect"}})`, `main_before_run`, `await run(...)`.

`run()` builds the program with `Bn()` and then decides how much of the command tree to register:

```js
let k = process.argv.slice(2), v = lR("-p",k) || lR("--print",k), R = mwt(yrr,k) !== -1;  // yrr = cc:// or cc+unix:// url
if (v && !R) return await u.parseAsync(process.argv);      // print mode: skip subcommand registration
if (!Srr(k) && !R) return await u.parseAsync(process.argv); // no positional/--help: skip too
… register gateway, mcp, auth, project, plugin, setup-token, agents, ultrareview, auto-mode,
  remote-control, doctor, sandbox, update, install, import, import-conversations …
```

`Srr(t)` = `t.some(e => !e.startsWith("-") || e === "--" || e === "--help" || /^-[^-]*h/.test(e))`
(272561). This is a **deliberate boot-latency optimisation**: the interactive/print happy path never
constructs the ~19 subcommand subtrees.

Non-interactive detection, `ps(t)` (747916):

```js
o = -p|--print present; d = --init-only present; u = any arg starting with --sdk-url
return o || d || u || !process.stdout.isTTY;
```

So **piping stdout alone forces headless**, which is why `-p`'s help text warns the trust dialog is
skipped.

Client-type resolution (747889): `GITHUB_ACTIONS` → `github-action`; else `CLAUDE_CODE_ENTRYPOINT`
∈ {`sdk-ts`→`sdk-typescript`, `sdk-py`→`sdk-python`, `sdk-cli`, `claude-vscode`, `local-agent`,
`claude-desktop`}; else `remote` if `CLAUDE_CODE_ENTRYPOINT === "remote"` or any of
`CLAUDE_CODE_SESSION_ACCESS_TOKEN` / `CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR` /
`CLAUDE_SESSION_INGRESS_TOKEN_FILE`; else `cli`. Other entrypoint literals seen elsewhere:
`claude-desktop-3p` (313564), `claude-in-teams` (729128), `remote_cowork` (215237),
`remote_desktop` (878686), `bench` (419166), `local_agent` (729196).

### 2.3 Top-level subcommands (all registered in `run()`, 748552–748740)

| command | aliases | notes / description string |
|---|---|---|
| `claude [prompt]` | — | `"Claude Code - starts an interactive session by default, use -p/--print for non-interactive output"` |
| `gateway --config <path>` | — | `"Run the enterprise auth/telemetry gateway"`; sets a gateway flag via a `preSubcommand` hook |
| `auth` | — | `"Manage authentication"` → `login [--email --sso --console --claudeai]`, `status [--json --text]`, `logout` |
| `project` | — | `"Manage Claude Code project state"` → `purge [path] [--dry-run -y/--yes -i/--interactive --all]` |
| `mcp` | — | `"Configure and manage MCP servers"`; positional options enabled |
| `plugin` | `plugins` | `"Manage Claude Code plugins"` |
| `setup-token` | — | `"Set up a long-lived authentication token (requires Claude subscription)"` |
| `agents` | — | `"Manage background agents"`; 11 own options (setting-sources, cwd, add-dir, plugin-dir[-no-mcp], settings, mcp-config, strict-mcp-config, restricted, permission-mode, dangerously-skip-permissions) |
| `ultrareview [target]` | — | cloud multi-agent review; `--json --timeout <min> --post --no-post` |
| `auto-mode` | — | `"Inspect or reset auto mode classifier configuration"` → `defaults [--label]`, `config`, `reset [-y]`, `critique [--model]` |
| `remote-control` | `rc` | **hidden**; `"Control local sessions from claude.ai/code or the Claude mobile app"`; `helpOption(false)`, unknown options allowed |
| `doctor` | — | `"Check the health of your Claude Code installation. Reads settings files in the current directory without a trust prompt. For a full checkup that can also fix issues, run /doctor in a session."` |
| `sandbox` | — | **hidden** → `install` (Windows sandbox user + network filters, self-elevating UAC, JSON `{status,message}`), `status` (one JSON line) |
| `update` | `upgrade` | `"Check for updates and install if available"` |
| `install [target]` | — | `"Install Claude Code native build. Use [target] to specify version (stable, latest, or specific version)"`; `--force` |
| `import [source]` | — | `"Import config from another AI coding agent into Claude Code"`; `[codex\|gemini]`, `--dry-run`, `--yes[=<digest>]` |
| `import-conversations <exportPath>` | — | **hidden**; `--cwd <dir>`, `--dry-run` |
| `self-hosted-runner …` | — | handled in the entry stub, not commander |
| `daemon …` | — | handled in the entry stub (`scr()`, 589139) |

Five extra rows are injected into `--help` only, and are actually served by the stub's `cli_bg_path`
(747094):

```
attach <id>   Open a background session in this terminal. <id> is the short id that `claude --bg` prints and `claude agents` lists
logs <id>     Print a background session's recent terminal output
stop|kill <id> Stop a background session. Its conversation is kept: `claude attach <id>` opens it again, `claude --resume` works once it is stopped
respawn [id] [--all]  Restart a background session, or all of them with --all, so it runs the current Claude Code version
rm <id>       Delete a background session, and its worktree when that is safe. Works on sessions that have already exited
```

**`mcp` subtree** (747334): `serve [-d --verbose]`, `add <name> <commandOrUrl> [args...]`
(`-s/--scope local|user|project` default `local`, `-t/--transport stdio|sse|http`, `-e/--env`,
`-H/--header`, `--client-id`, `--client-secret`, `--callback-port`, hidden `--xaa`),
`xaa {setup,login,show,clear}` (only when `CLAUDE_CODE_ENABLE_XAA=1`), `remove <name> [-s]`,
`list`, `get <name>`, `login <name> [--no-browser]`, `logout <name>`, `add-json <name> <json>`,
`add-from-claude-desktop [-s]`, `reset-project-choices`.

**`plugin` subtree** (747367): `init <name>`, `validate <path> [--strict]`, `tag [path]`,
`list [--json --available]`, `eval [target]` (early-access gated; `--case --tag --runs --model
--judge-model --max-cost-usd --output-dir --eval-dir --json --threshold --ablation --scaffold`) with
`eval init [name]`, `details <name>`, `marketplace {add,list,remove,update}`, `install <plugin>`,
`uninstall <plugin>`, `prune`, `enable <plugin>`, `disable [plugin]`, `update <plugin>`. Every
subcommand accepts a hidden `--cowork` ("Use cowork_plugins directory").

### 2.4 Main-command flags — all 113

`Option` construction begins at 748394. "hidden" = `.hideHelp()`.

| flag | modifiers | help text |
|---|---|---|
| `-d, --debug [filter]` |  | Enable debug mode with optional category filtering (e.g., "api,hooks" or "!1p,!file") |
| `-d2e, --debug-to-stderr` | **hidden** | (deprecated) Enable debug mode (to stderr) |
| `--debug-file <path>` |  | Write debug logs to a specific file path (implicitly enables debug mode) |
| `--verbose` |  | Override verbose mode setting from config |
| `-p, --print` |  | Print response and exit (useful for pipes). Note: The workspace trust dialog is skipped when Claude is run in non-interactive mode (via -p, or when stdout is not a TTY, e.g. piped or redirected output). Only use this in directo… |
| `--bare` |  | Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper … |
| `--safe-mode` |  | Start with all customizations (CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands and agents, output styles, workflows, custom themes, keybindings, and more) disabled — useful for troubleshooting a broken configura… |
| `--init` | **hidden** | Run Setup hooks with init trigger, then continue |
| `--init-only` | **hidden** | Run Setup and SessionStart:startup hooks, then exit |
| `--maintenance` | **hidden** | Run Setup hooks with maintenance trigger, then continue |
| `--output-format <format>` | choices [`text`, `json`, `stream-json`] | Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming) |
| `--json-schema <schema>` |  | JSON Schema for structured output validation. Example: {"type":"object","properties":{"name":{"type":"string"}},"required":["name"]} |
| `--include-hook-events` |  | Include all hook lifecycle events in the output stream (only works with --output-format=stream-json) |
| `--include-partial-messages` |  | Include partial message chunks as they arrive (only works with --print and --output-format=stream-json) |
| `--forward-subagent-text` |  | Forward subagent text and thinking blocks as assistant/user messages with parent_tool_use_id set (only works with --print and --output-format=stream-json) |
| `--session-mirror` | **hidden** | Emit transcript_mirror frames on stdout (SDK-internal; set by ProcessTransport when sessionStore is configured) |
| `--input-format <format>` | choices [`text`, `stream-json`] | Input format (only works with --print): "text" (default), or "stream-json" (realtime streaming input) |
| `--dangerously-skip-permissions` |  | Bypass all permission checks. Recommended only for sandboxes with no internet access. |
| `--allow-dangerously-skip-permissions` |  | Enable bypassing all permission checks as an option, without it being enabled by default. Recommended only for sandboxes with no internet access. |
| `--thinking <mode>` | choices [`enabled`, `adaptive`, `disabled`] · **hidden** | Thinking mode: enabled (equivalent to adaptive), disabled |
| `--thinking-display <display>` | choices [`summarized`, `omitted`] · **hidden** | How thinking content appears in the response |
| `--max-thinking-tokens <tokens>` | **hidden** | [DEPRECATED. Use --thinking instead for newer models] Maximum number of thinking tokens (only works with --print) |
| `--max-turns <turns>` | **hidden** | Maximum number of agentic turns in non-interactive mode. This will early exit the conversation after the specified number of turns. (only works with --print) |
| `--max-budget-usd <amount>` |  | Maximum dollar amount to spend on API calls (only works with --print) |
| `--task-budget <tokens>` | **hidden** | API-side task budget in tokens (output_config.task_budget) |
| `--replay-user-messages` |  | Re-emit user messages from stdin back on stdout for acknowledgment (only works with --input-format=stream-json and --output-format=stream-json) |
| `--prompt-suggestions [value]` | choices [`true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`] | Enable prompt suggestions. In print/SDK mode, emits a prompt_suggestion message after each turn with a predicted next user prompt |
| `--enable-auth-status` | **hidden** | Enable auth status messages in SDK mode |
| `--allowedTools, --allowed-tools <tools...>` |  | Comma or space-separated list of tool names to allow (e.g. "Bash(git *) Edit") |
| `--tools <tools...>` |  | Specify the list of available tools from the built-in set. Use "" to disable all tools, "default" to use all tools, or specify tool names (e.g. "Bash,Edit,Read"). |
| `--restricted` |  | Restricted mode: removes the built-in tools that run commands or code (Bash, PowerShell, REPL and the other code-running tools) and WebFetch unless --tools names them, and ignores user, project and local settings files (managed… |
| `--disallowedTools, --disallowed-tools <tools...>` |  | Comma or space-separated list of tool names to deny (e.g. "Bash(git *) Edit") |
| `--mcp-config <configs...>` |  | Load MCP servers from JSON files or strings (space-separated) |
| `--permission-prompt-tool <tool>` | **hidden** | MCP tool to use for permission prompts (only works with --print) |
| `--system-prompt <prompt>` |  | System prompt to use for the session |
| `--system-prompt-file <file>` | **hidden** | Read system prompt from a file |
| `--append-system-prompt <prompt>` |  | Append a system prompt to the default system prompt |
| `--append-system-prompt-file <file>` | **hidden** | Read system prompt from a file and append to the default system prompt |
| `--append-subagent-system-prompt <prompt>` | **hidden** | Append a system prompt to every Task-tool subagent's system prompt, propagated to nested subagents (only works with --print). Implies CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT=1. |
| `--plan-mode-instructions <instructions>` | **hidden** | Custom workflow body for plan mode. Replaces the default code-implementation phases in the plan-mode system reminder; the read-only enforcement preamble and ExitPlanMode protocol footer are always kept. |
| `--exclude-dynamic-system-prompt-sections` |  | Move per-machine sections (cwd, env info, memory paths, git status) from the system prompt into the first user message. Improves cross-user prompt-cache reuse. Only applies with the default system prompt (ignored with --system-… |
| `--permission-mode <mode>` |  | Permission mode to use for the session |
| `-c, --continue` |  | Continue the most recent conversation in the current directory |
| `-r, --resume [value]` |  | Resume a conversation by session ID, or open interactive picker with optional search term |
| `--fork-session` |  | When resuming, create a new session ID instead of reusing the original (use with --resume or --continue) |
| `--watch-artifact <artifact>` | **hidden** | Watch a Claude artifact (id or URL) in this session and hear about new versions and comments |
| `--watch-artifact-no-autoreact <artifact>` | **hidden** |  |
| `--prefill <text>` | **hidden** | Pre-fill the prompt input with text without submitting it |
| `--deep-link-origin` | **hidden** | Signal that this session was launched from a deep link |
| `--deep-link-repo <slug>` | **hidden** | Repo slug the deep link ?repo= parameter resolved to the current cwd |
| `--deep-link-last-fetch <ms>` | **hidden** | FETCH_HEAD mtime in epoch ms, precomputed by the deep link trampoline |
| `--prefill-b64 <b64>` | **hidden** | Base64url-encoded --prefill value (deep-link shell-safe launch paths) |
| `--deep-link-cwd-b64 <b64>` | **hidden** | Base64url-encoded working directory (deep-link shell-safe launch paths) |
| `--from-pr [value]` |  | Resume a session linked to a PR by PR number/URL, or open interactive picker with optional search term |
| `--no-session-persistence` |  | Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print) |
| `--resume-session-at <message id>` | **hidden** | When resuming, only messages up to and including the chain entry with <message.id> — any chain-entry UUID, typically the kept turn's last entry (use with --resume in print mode) |
| `--resume-drops-turn <message id>` | **hidden** | With --resume-session-at in print mode: declare the prompt uuid of the turn the truncating resume intends to discard; the resume is refused if the discarded range contains anything not attributable to that turn (absorbed queued… |
| `--reply-on-resume` | **hidden** | When resuming, immediately query if the loaded transcript ends in a user-role message (set by /background mid-turn so the fork continues the in-flight turn). |
| `--rewind-files <user-message-id>` | **hidden** | Restore files to state at the specified user message and exit (requires --resume) |
| `--model <model>` |  | Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g. 'claude-fable-5'). |
| `--effort <level>` |  |  |
| `--agent <agent>` |  | Agent for the current session. Overrides the 'agent' setting. |
| `--betas <betas...>` |  | Beta headers to include in API requests (API key users only) |
| `--fallback-model <model>` |  | Enable automatic fallback to specified model(s) when the default model is overloaded or not available. Accepts a comma-separated list to try each in order. Re-tries the primary at the start of each user turn. (only works with -… |
| `--workload <tag>` | **hidden** | Workload tag for billing-header attribution (cc_workload). Process-scoped; set by SDK daemon callers that spawn subprocesses for cron work. (only works with --print) |
| `--settings <file-or-json>` |  | Path to a settings JSON file or a JSON string to load additional settings from |
| `--managed-settings <json>` | **hidden** | Policy-tier settings JSON from a spawning parent process (SDK use only) |
| `--add-dir <directories...>` |  | Additional directories to allow tool access to |
| `--ide` |  | Automatically connect to IDE on startup if exactly one valid IDE is available |
| `--strict-mcp-config` |  | Only use MCP servers from --mcp-config, ignoring all other MCP configurations |
| `--session-id <uuid>` |  | Use a specific session ID for the conversation (must be a valid UUID) |
| `-n, --name <name>` |  | Set a display name for this session (shown in the prompt box, /resume picker, and terminal title) |
| `--agents <json>` |  |  |
| `--setting-sources <sources>` |  | Comma-separated list of setting sources to load (user, project, local). |
| `--plugin-dir <path>` |  | Load a plugin from a directory or .zip for this session only (repeatable: --plugin-dir A --plugin-dir B.zip) |
| `--plugin-dir-no-mcp <path>` | **hidden** | Like --plugin-dir but the engine will not read this plugin's .mcp.json (caller owns its MCP connections) |
| `--plugin-url <url>` |  | Fetch a plugin .zip from a URL for this session only (repeatable: --plugin-url A --plugin-url B) |
| `--disable-slash-commands` |  | Disable all skills |
| `--chrome` |  | Enable Claude in Chrome integration |
| `--no-chrome` |  | Disable Claude in Chrome integration |
| `--file <specs...>` |  | File resources to download at startup. Format: file_id:relative_path (e.g., --file file_abc:doc.txt file_def:img.png) |
| `-w, --worktree [name]` |  | Create a new git worktree for this session (optionally specify a name) |
| `--tmux` |  | Create a tmux session for the worktree (requires --worktree). Uses iTerm2 native panes when available; use --tmux=classic for traditional tmux. |
| `--advisor <model>` | **hidden** | Enable the server-side advisor tool with the specified model (alias or full ID). |
| `--autocompact <auto|tokens>` |  | Auto-compact window size (auto, or 100k–1M tokens) |
| `--enable-auto-mode` | **hidden** | (deprecated) Opt in to auto mode |
| `--bg, --background` |  | Start the session in the background and return immediately. Prints the id that `claude attach`, `logs`, `stop` and `rm` take; `claude agents` lists them |
| `--messaging-socket-path <path>` | **hidden** | Cross-session messaging server path: a Unix domain socket on Mac/Linux, a \\.\pipe\ name on Windows (defaults to an auto-generated path) |
| `--brief` |  | Enable SendUserMessage tool for agent-to-user communication |
| `--ax-screen-reader` |  | Render screen-reader friendly output (flat text, no decorative borders or animations). |
| `--channels <servers...>` | **hidden** | MCP servers whose channel notifications (inbound push) should register this session. Space-separated server names. |
| `--dangerously-load-development-channels <servers...>` | **hidden** | Load channel servers not on the approved allowlist. For local channel development only. Shows a confirmation dialog at startup. |
| `--agent-id <id>` | **hidden** | Teammate agent ID |
| `--agent-name <name>` | **hidden** | Teammate display name |
| `--team-name <name>` | **hidden** | Team name for teammate coordination |
| `--agent-color <color>` | **hidden** | Teammate UI color |
| `--plan-mode-required` | **hidden** | Require plan mode before implementation |
| `--parent-session-id <id>` | **hidden** | Parent session ID for analytics correlation |
| `--teammate-mode <mode>` | choices [`auto`, `tmux`, `iterm2`, `in-process`] · **hidden** | How to spawn teammates: "tmux", "iterm2", "in-process", or "auto" |
| `--agent-type <type>` | **hidden** | Custom agent type for this teammate |
| `--sdk-url <url>` | **hidden** | Use remote WebSocket endpoint for SDK I/O streaming (only with -p and stream-json format) |
| `--teleport [session]` |  | Resume a teleport session, optionally specify session ID |
| `--cloud [description|session_id|url]` |  | Create a cloud session with the given description, or attach to an existing one by session ID or claude.ai/code URL |
| `--forward-home-settings <true|false>` | choices [`true`, `false`, `1`, `0`] · **hidden** | Whether this launch sends this machine's settings (CLAUDE.md, rules, output styles, preferences, portable permission rules) into the cloud session it creates or attaches to: false = not this launch; true = yes for this launch, … |
| `--remote [description|session_id|url]` | **hidden** | Deprecated alias for --cloud |
| `--environment <environment_id>` |  | Create a new cloud session that runs on the given self-hosted environment (ccpool_...). |
| `--pool <pool_id>` | **hidden** | Deprecated alias for --environment |
| `--correlation-id <id>` | **hidden** | Opaque id echoed back to the environment orchestrator on the work order (requires --environment). |
| `--ref <ref>` | **hidden** | Branch, tag, or SHA to check out in the remote session; defaults to local current branch. Requires --cloud or --environment. |
| `--on-branch <branch>` | **hidden** | Work directly on <branch> in the remote session (checkout and push to it). On self-hosted environments this includes pushing to the default branch when it is not protected — use GitHub branch protection to restrict. Mutually ex… |
| `--remote-control [name]` |  | Start an interactive session with Remote Control enabled (optionally named) |
| `--rc [name]` | **hidden** | Alias for --remote-control |
| `--remote-control-session-name-prefix <prefix>` |  | Prefix for auto-generated Remote Control session names (default: hostname) |

Three flags whose description is a computed expression rather than a literal:
`--watch-artifact-no-autoreact <artifact>` (hidden sibling of `--watch-artifact`),
`--effort <level>` (parsed by `g_t()` which may print `Warning: …` to stderr), and
`--agents <json>`.

### 2.5 Version management, installer, auto-update

**Paths** (`chunk-jcv4bfwt.js`, 583092; consumer `W()` at 48607):

| dir | resolution |
|---|---|
| versions | `${XDG_DATA_HOME ?? ~/.local/share}/claude/versions` |
| staging | `${XDG_CACHE_HOME ?? ~/.cache}/claude/staging` |
| locks | `${XDG_STATE_HOME ?? ~/.local/state}/claude/locks` |
| launcher | `${HOME}/.local/bin/claude` (`claude.exe` on win32) |

Platform key `I8()` (48588): `${platform}-${arch}`, with `linux-<arch>-android` and
`linux-<arch>-musl` variants.

**Launcher.** On POSIX the launcher is a **symlink** `~/.local/bin/claude → …/versions/<v>`
(48886–48900), replaced atomically via `symlink(tmp)` + `rename`. The installer refuses to overwrite
a launcher it did not create:

> `Not replacing ${e}: it was not created by the native installer (not a symlink into a claude/versions/ directory) and is not an npm shim, so this update will not overwrite it. New versions still install under the versions/ directory; remove ${e} and re-run the update to let the installer manage the launcher again.`

On Windows the executable is copied, not symlinked. `DISABLE_INSTALLATION_CHECKS` skips the launcher
health check entirely (48916).

**Release channels.** `Ilt(e)` (48246) accepts a literal `vX.Y.Z` version or one of `stable` /
`latest`; `rc` is explicitly rejected at the install path (`"Invalid channel: rc. Use 'stable' or
'latest'"`) even though the `autoUpdatesChannel` settings enum is `["latest","stable","rc"]`
(schema) and the UI relabels `rc` as "slow". `DP()` (`chunk-43rypww5.js`, 505702) returns
`autoUpdatesChannel` or `"latest"`.

**Download** (48216–48420):

| step | detail |
|---|---|
| base URL | `https://downloads.claude.ai/claude-code-releases` |
| channel pointer | `GET <base>/<channel>` → plain-text version; 3 attempts, 30 s timeout each; emits `tengu_version_check_success` / `tengu_version_check_failure` |
| manifest | `GET <base>/<version>/manifest.json` and `manifest.zst.json` (optional) |
| binary | `GET <base>/<version>/<platform>/claude[.exe]` (`.zst` when a compressed manifest exists) |
| integrity | SHA-256 of the *decompressed* stream must equal `manifest.platforms[<plat>].checksum`; the compressed stream is separately checked against the `.zst` manifest checksum, and the decompressed byte count is capped at `manifest.size` |
| timeouts | stall = 120 s of no data (`CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING`), total deadline = 600 s (`CLAUDE_CODE_DOWNLOAD_DEADLINE_MS_FOR_TESTING`), 3 attempts |
| install | download → staging dir → `chmod 0755` → `rename` to `versions/<v>` with EBUSY retries at 100/500/2000 ms |
| locking | per-version lock in `…/claude/locks`; pid-based or `proper-lockfile`; emits `tengu_version_lock_acquired` / `tengu_version_lock_failed` |
| platform miss | `"Native binaries for ${plat} are not available on this release channel (version ${v} ships: …)."` |

Old versions are garbage-collected by `native_cleanup_versions` (49097–49191), which protects the
version the launcher points at and skips entirely when the launcher is "externally managed".

**`claude update`** (`chunk-rsmvjmyy.js`, 718655; handler `te`, 718902): refuses immediately if
`DISABLE_UPDATES` is set — `"Updates are disabled by your administrator. Contact your IT team to get
the latest version."` It then diagnoses the installation (`native`, `npm-local`, `npm-global`,
`package-manager`, `development`, `unknown`), warns on multiple installations, back-fills
`installMethod` into `~/.claude.json`, and for package-manager installs prints the right upgrade
command (`brew upgrade claude-code`, `winget upgrade Anthropic.ClaudeCode`, `apk upgrade
claude-code`, `mise upgrade claude`) rather than self-updating. Homebrew channel is chosen by **cask
name**, not settings (`claude-code` = stable, `claude-code@latest` = latest). `minimumVersion` /
`requiredMaximumVersion` can pin the version: *"The ${channel} channel is at ${v}, which is
${reason}. Staying on 2.1.251."*

**Auto-update disabled reasons** (`DY()`, 312412):
1. `DISABLE_UPDATES` → `{type:"env", envVar:"DISABLE_UPDATES"}`
2. `DISABLE_AUTOUPDATER` (truthy) → same shape
3. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (via `nve()`)
4. `globalConfig.autoUpdates === false` and not `autoUpdatesProtectedForNative` → `{type:"config"}`

**Auto-update cadence.** The REPL footer component polls every **1,800,000 ms (30 min)**
(`ko(he, 1800000)`, 269862; a second updater component uses the same `Ht = 1800000`, 269988). Result
state lands in the global config as `autoUpdaterResult {version, status, failureHint,
consecutiveExeLockFailures}`; success prints *"Update installed · Restart to apply"* and, for
background sessions, *"… will restart on the new version shortly; background jobs continue
uninterrupted"*.

**Version pinning by policy** (180370): `requiredMinimumVersion` / `requiredMaximumVersion` from
`policySettings` block startup unless the top-level command is one of `{update, install, doctor}`:

> `Claude Code ${v} is older than the minimum version required by your organization (${min}).`
> `Update Claude Code using your organization's approved method, then try again. If automatic updates are available, \`claude update\` may also work.`

> `Claude Code ${v} is newer than the maximum version allowed by your organization (${max}).`
> `Your organization requires version ${max} or older. Install an approved version using your organization's approved method. \`claude install <version>\` may also work.`

**`claude install [target]`** (4372–4420): `installLatest(target ?? channel, force)` → if target was
a channel literal, persist `autoUpdatesChannel` to user settings (mapping `rc`→`stable`) → set up
launcher + shell PATH → clean up npm installs and shell aliases → emit
`tengu_claude_install_command`. Progress strings: `"Checking installation status…"`,
`"Cleaning up old npm installations…"`, `"Installing Claude Code native build <v>…"`,
`"Setting up launcher and shell integration…"`.

---

## 3. Startup work before the first prompt

### 3.1 Profiling checkpoints — the boot timeline

`D` (283312) names the spans; `Mr(name)` records each checkpoint. Ordered:

```
cli_entry → main_tsx_imports_loaded → cli_before_main_import → main_tsx_entry
→ main_function_start → main_before_run → run_function_start → run_commander_initialized
→ preAction_start → preAction_after_mdm → init_function_start → init_configs_enabled
→ init_remote_settings_primed → init_fd_credentials_primed → init_stored_login_primed
→ init_safe_env_vars_applied → init_after_graceful_shutdown → init_after_1p_event_logging
→ init_after_oauth_populate → init_after_remote_settings_check → init_mtls_configured
→ init_network_configured → init_function_end → preAction_after_init → preAction_after_sinks
→ eagerLoadSettings_start → eagerLoadSettings_end → preAction_after_migrations
→ preAction_after_remote_settings → preAction_after_plugin_early_kick
→ run_before_parse → action_handler_start → action_after_input_prompt → action_tools_loaded
→ action_mcp_configs_loaded → action_after_plugins_init → before_validateForceLoginOrg
→ before_connectMcp → after_connectMcp_claudeai → before_growthbook_init → after_growthbook_init
→ before_sandbox_init → after_sandbox_init → before_loadInitialMessages → after_loadInitialMessages
→ before_processUserInput → after_processUserInput → run_after_parse → main_after_run
```

Metrics also emitted: `node_boot_ms`, `pre_action_ms`, `settings_load_ms`.

### 3.2 `preAction` hook (748321)

Runs for **every** command:

1. `await Promise.all([MDM read, keychain])` → `preAction_after_mdm`.
2. `init()` (below) → `preAction_after_init`.
3. Unless `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`, set `process.title = "claude"`.
4. `initSinks()` (analytics/log sinks) → `preAction_after_sinks`.
5. Register inline plugins from `--plugin-dir`, `--plugin-dir-no-mcp`, `--plugin-url`.
6. `await ws(storage)` → migrations → `preAction_after_migrations`.
7. Remote/org settings refresh. Three modes: `forceRemoteSettingsRefresh` (blocking; exits on
   failure), gateway mode (blocking; `"Couldn't load settings from Cloud gateway ${url}. Check your
   network connection, or run \`claude auth login\` to re-authenticate."`), or best-effort
   background. Skipped when the command is under `auth`.
8. Enforce `requiredMinimumVersion`/`requiredMaximumVersion`.
9. `disableSideloadFlags` gate: rejects `--plugin-dir`, `--plugin-dir-no-mcp`, `--plugin-url`,
   `--agents` at startup when set in managed settings.
10. For the root command only: apply `--add-dir`, register built-in plugins for early scan, kick the
    plugin sync in the background → `preAction_after_plugin_early_kick`.

### 3.3 `init()` (285220)

Ordered work: enable configs (`~/.claude.json` + settings) → prime remote settings → prime
credential FDs and stored login → apply "safe" env vars → resolve storage backend → wire GrowthBook
credentials/backend → graceful-shutdown handlers → 1P event logging (+ re-init on GrowthBook
refresh) → OAuth population → repo-detection trust probe → mTLS (`configureGlobalMTLS`) → proxy
agents (`configureGlobalAgents`) → optional agent-proxy for `CLAUDE_CODE_REMOTE` → Windows shell
preflight → scratchpad dir. It also warns if `CLAUDE_CONFIG_DIR` changed after the v5 storage
backend was built:

> `CLAUDE_CONFIG_DIR no longer names ${configHome}, where the v5 storage backend was built at start-up; init() loads its config without it`

Windows shell preflight is a hard exit:

> `Claude Code on Windows requires a shell tool. Git Bash was not found and the PowerShell tool is disabled (CLAUDE_CODE_USE_POWERSHELL_TOOL=0).`
> `  - Install Git for Windows: https://git-scm.com/downloads/win, or`
> `  - Remove CLAUDE_CODE_USE_POWERSHELL_TOOL from your environment or settings.`

A `HEAD ${ANTHROPIC_BASE_URL}/api/hello` preconnect fires (10 s timeout) unless a proxy, unix socket
or client cert is configured, or the provider is not first-party (285200).

### 3.4 Eager settings load (`z5t`, 748472 region / 184960)

Reads, in this order, from raw argv (not commander):
`--settings` → `--managed-settings` → `--setting-sources` → then, if `--restricted` or
`CLAUDE_CODE_RESTRICTED`, calls `setAllowedSettingSources([])`, which leaves only `flagSettings` and
`policySettings` (they are always re-added in `xi()`, 209527).

### 3.5 Onboarding & trust

Onboarding steps (43406–43413), in order, each conditional:
`preflight` → `theme` ("Let's get started." / "Choose the text style that looks best with your
terminal") → `api-key` → `oauth` → `security` ("Security notes:") → `terminal-setup` ("Use Claude
Code's terminal setup?" — Option+Enter on Apple Terminal, Shift+Enter elsewhere). Each transition
emits `tengu_onboarding_step {oauthEnabled, stepId}`; completion writes
`{hasCompletedOnboarding: true, lastOnboardingVersion: "2.1.251"}` into `~/.claude.json` (747478,
748720, 768840).

Trust (`J7`, 311162): returns true immediately for `CLAUDE_CODE_SANDBOXED`; otherwise looks up
`globalConfig.projects[<dir>].hasTrustDialogAccepted` and, failing that, **walks up from the
realpath'd cwd to the git root** checking each ancestor (`PD`, 311176). Acceptance writes the flag
for the *current* dir key (`pNe`, 311205). Untrusted workspaces get:

> `Ignoring ${n} ${kind} entries from ${file}: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects[<key>].hasTrustDialogAccepted: true in ~/.claude.json.`

### 3.6 Interactive / print / stream-json selection

* Interactive REPL is the default when `process.stdin.isTTY && process.stdout.isTTY` and no
  non-interactive trigger fires.
* `ps()` (747916) declares non-interactive on `-p`, `--print`, `--init-only`, any `--sdk-url*`, or
  `!process.stdout.isTTY`.
* `--output-format` ∈ `text|json|stream-json` (default `text`), `--input-format` ∈
  `text|stream-json` (default `text`); both only meaningful with `--print`.
* An "SDK stream" mode is detected by
  `!print && !initOnly && nonInteractive && !hasSdkUrl && inputFormat==="stream-json" &&
  outputFormat==="stream-json"` (254365).
* The daemon spawns children with a fixed argv template:
  `[...execArgs, "--print", "--sdk-url", <url>, "--input-format", "stream-json", "--output-format",
  "stream-json", "--replay-user-messages", "--resume=<url>", "--debug-file", <file>]` (125089).

---

## 4. Configuration system

### 4.1 Sources and precedence

```js
var Is = ["userSettings","projectSettings","localSettings","flagSettings","policySettings"];  // 209440
function tn(){ return ["userSettings","projectSettings","localSettings","flagSettings","policySettings"] } // 80769 (default allowed set)
```

Merge is lowest → highest in that array order; the `enabledPlugins` schema doc states it plainly:
*"Settings precedence is user < project < local < flag < policy"* (111638).

| source | file | anchor |
|---|---|---|
| `userSettings` | `${CLAUDE_CONFIG_DIR ?? ~/.claude}/settings.json` (or `cowork_settings.json` under Cowork) | 210457–210470 |
| `projectSettings` | `<cwd>/.claude/settings.json` | 210479 |
| `localSettings` | `<cwd>/.claude/settings.local.json` (consent-store root may be canonicalised to the git root, with a uid-ownership check) | 210481, 871468 |
| `flagSettings` | `--settings <file-or-json>` | 210472 |
| `policySettings` | union of MDM + registry + managed file + drop-ins + remote | below |

`--setting-sources user,project,local` maps through `Tor()` (209506) and *restricts* the enabled set;
`flagSettings` and `policySettings` are always forced back in (`xi()`, 209527). The CLI default is
all three; `--restricted` reduces it to none.

Legacy local settings: if the canonical local-settings path differs from `<cwd>/.claude/settings.local.json`,
the old location is still read as a "legacy local settings" layer (815487).

### 4.2 The policy (managed) tier

| mechanism | location | anchor |
|---|---|---|
| macOS MDM | `/Library/Managed Preferences/<user>/com.anthropic.claudecode.plist` then `/Library/Managed Preferences/com.anthropic.claudecode.plist`, key `Settings`, converted with `/usr/bin/plutil -convert json -o - --` (5 s timeout) | 207818–207832 |
| Windows registry | `HKLM\SOFTWARE\Policies\ClaudeCode` and `HKCU\SOFTWARE\Policies\ClaudeCode`, value `Settings` | 207818 |
| Managed file | macOS `/Library/Application Support/ClaudeCode/managed-settings.json`; Windows `C:\Program Files\ClaudeCode\managed-settings.json`; other `/etc/claude-code/managed-settings.json` | 209563–209572 |
| Drop-ins | `<managed dir>/managed-settings.d/*.json` (skips dotfiles, sorted, merged in order) | 209547, 210247–210268 |
| WSL inheritance | when `wslInheritsWindowsSettings` is set in an admin-only Windows source, the WSL side also reads `/mnt/c/Program Files/ClaudeCode` and shells `/mnt/c/Windows/System32/reg.exe` | 207818, 210234, 210245 |
| Remote/org | fetched from the API or the Cloud gateway; `forceRemoteSettingsRefresh` makes it blocking | 748333 |

MDM/registry are re-polled on a timer; a change fires a `policySettings` invalidation (685046).
Restrictive-only keys — a managed source can only tighten, never loosen — are enumerated at 210485:
`allowManagedPermissionRulesOnly`, `allowManagedHooksOnly`, `allowManagedMcpServersOnly`,
`enforceAvailableModels`, `disableAllHooks`, `disableClaudeAiConnectors`,
`disableCommandPluginSources`, `disableSideloadFlags`, `disableSkillShellExecution`,
`disableRemoteControl`, `disableAgentView`, … Two keys are "replace, don't merge":
`permissions.defaultMode` and `modelPicker.replaceBuiltInOptions` (210497).

Path-valued keys honored only from *trusted* sources (111004):
`apiKeyHelper, awsAuthRefresh, awsCredentialExport, fileSuggestion, gcpAuthRefresh,
otelHeadersHelper, processWrapper, policyHelpers, proxyAuthHelper, statusLine, subagentStatusLine`;
admin-only: `bwrapPath, ripgrep, socatPath`.

### 4.3 `CLAUDE_CONFIG_DIR` and the legacy `~/.claude.json`

```js
function B(){ return { legacyPath: join(configHome(), ".config.json"),
                       configPath: join(process.env.CLAUDE_CONFIG_DIR || homedir(), `.claude${w4()}.json`) } }  // 267374
function w4(){ return CLAUDE_CODE_CUSTOM_OAUTH_URL ? "-custom-oauth" : {local:"-local-oauth",staging:"-staging-oauth",prod:""}[env] }  // 744018
```

So the global config is `~/.claude.json` in prod, `~/.claude-staging-oauth.json` /
`-local-oauth` / `-custom-oauth` otherwise, and `CLAUDE_CONFIG_DIR` relocates it. Secure storage has
its own override, `CLAUDE_SECURESTORAGE_CONFIG_DIR`; when `CLAUDE_CONFIG_DIR` is set (and the
securestorage override is not), the keychain service name gets a `-<sha256(dir)[0:8]>` suffix so
different config dirs do not share credentials (650790–650800).

Default global config (`qe()`, 311022) — this is the *whole* set of keys that ship with defaults:

```
numStartups:0, installMethod:undefined, autoUpdates:undefined, theme:"dark",
preferredNotifChannel:"auto", verbose:false, editorMode:"normal", autoCompactEnabled:true,
autoScrollEnabled:true, showTurnDuration:true, externalEditorContext:false,
showMessageTimestamps:false, hasSeenTasksHint:false, hasUsedStash:false,
hasUsedBackgroundTask:false, queuedCommandUpHintCount:0, diffTool:"auto",
customApiKeyResponses:{approved:[],rejected:[]}, env:{}, tipsHistory:{}, memoryUsageCount:0,
promptQueueUseCount:0, btwUseCount:0, todoFeatureEnabled:true, showExpandedTodos:false,
briefTranscript:false, messageIdleNotifThresholdMs:60000, autoConnectIde:false,
autoInstallIdeExtension:true, fileCheckpointingEnabled:true, terminalProgressBarEnabled:true,
cachedDynamicConfigs:{}, cachedGrowthBookFeatures:{}, respectGitignore:true,
copyFullResponse:false, unpinOpus47LaunchEffort:false, unpinOpus48LaunchEffort:false,
unpinFable5LaunchEffort:false
```

Per-project entry defaults (`pAe`, 311020):

```
allowedTools:[], mcpContextUris:[], mcpServers:{}, enabledMcpjsonServers:[],
disabledMcpjsonServers:[], hasTrustDialogAccepted:false,
hasClaudeMdExternalIncludesApproved:false, hasClaudeMdExternalIncludesWarningShown:false
```

Other `~/.claude.json` keys observed in code: `oauthAccount` (with `organizationRole`,
`subscriptionCreatedAt`), `userID` / `machineID` / `summonSidKey` (32-byte hex, generated lazily —
312424–312450), `firstStartTime`, `migrationVersion`, `seenNotifications`, `skillUsage`,
`pluginUsage`, `projects{}`, `hasCompletedOnboarding`, `lastOnboardingVersion`,
`autoUpdaterResult`, `autoUpdatesProtectedForNative`, `cachedExperimentFeatures`,
`cachedExperimentData`, `cachedGrowthBookFeaturesAt`, `defaultToAgentsView`,
`legacyOpusMigrationTimestamp`, `sonnet1m45MigrationComplete`, `sonnet45To46MigrationTimestamp`,
`opusProMigrationComplete`, `opusProMigrationTimestamp`, `hasResetAutoModeOptInForDefaultOffer`,
`hasRemoteEnvironment`, `hasSeenAutoDefaultNudge`, `hasSeenEffortMediumNudge`.
The `/skill-doctor` prompt embedded at 215417 documents the usage counters:
*"`skillUsage` (skill name → `{usageCount, lastUsedAt}`), `pluginUsage` (`"<name>@<marketplace>"` →
`{usageCount, lastUsedAt}`), `numStartups`"* and warns `pluginUsage.lastUsedAt` is seeded on
install/enable.

Config-file resilience: a parse failure triggers `tengu_config_parse_error` and an auto-repair from
the cached config under lock, logged as *"saveConfigWithLock: re-read hit a parse error;
auto-repairing from cached config under lock. See GH #3117."* (311776).

Legacy sibling: `${configHome}/.config.json` is still consulted first if it exists (770076).

### 4.4 Settings migrations (ordered set, `migrationVersion = 13`)

`ws(storage)` (748439) = `Sn()` (MCP approval fields) then `Hn(storage)` (the versioned set) then a
background task. `Hn` (748175) runs, **in order**:

| # | fn | what it does |
|---|---|---|
| 1 | `Cn` | `globalConfig.autoUpdates === false` → write `userSettings.env.DISABLE_AUTOUPDATER = "1"`, set the env var in-process, delete `autoUpdates`/`autoUpdatesProtectedForNative`. `tengu_migrate_autoupdates_to_settings` |
| 2 | `vn` | `bypassPermissionsModeAccepted` → `userSettings.skipDangerousModePermissionPrompt = true`, drop the old key |
| 3 | `Dn` | Pro-tier reset to the opus default; records `opusProMigrationComplete` |
| 4 | `Rn` | `model: "sonnet[1m]"` → `"sonnet-4-5-20250929[1m]"`; sets `sonnet1m45MigrationComplete` |
| 5 | `bn` | legacy Opus ids (`claude-opus-4-20250514`, `claude-opus-4-1-20250805`, `claude-opus-4-0`, `claude-opus-4-1`) → `"opus"` |
| 6 | `In` | Sonnet 4.5 ids → `"sonnet"` / `"sonnet[1m]"` |
| 7 | `kn` | `model: "opus"` → `"opus[1m]"` when the 1M gate is on |
| 8 | `yn` | generic model-alias table remap (`tengu_alias_migration`) |
| 9 | `Pn` | `replBridgeEnabled` → `remoteControlAtStartup` |
| 10 | `xn` | copy "user intent" keys out of `~/.claude.json` into `userSettings` when they differ from the shipped default and the settings file has no value. List `wEe` (398359): `theme, editorMode, verbose, preferredNotifChannel, autoCompactEnabled, autoScrollEnabled, fileCheckpointingEnabled, showTurnDuration, showMessageTimestamps, terminalProgressBarEnabled, todoFeatureEnabled, teammateMode, remoteControlAtStartup, autoUploadSessions, inputNeededNotifEnabled, agentPushNotifEnabled` |
| 11 | `An` | `subscriptionNoticeCount` → `seenNotifications["subscription-switch"]` |
| 12 | `Mn` | reset `skipAutoPermissionPrompt` for the auto-mode default offer |

Separately, `Sn()` moves the legacy per-project MCP approval fields
(`enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`) from
`~/.claude.json`'s project entry into `.claude/settings.local.json` (747940). **If any
settings-writing migration fails to persist, `migrationVersion` is not bumped and the whole set
re-runs next startup** — *"Skipping migrationVersion bump: a settings-writing migration failed to
persist; the set re-runs next startup."*

`H4t` (311024) is a separate 45-key list of global-config keys that are considered "user
preferences" — the ones the settings UI mirrors.

### 4.5 `claude config` is gone

There is **no top-level `config` command** in 2.1.251. `grep -c 'claude config'` returns 1, and that
one hit is stale prose inside the embedded `/skill-doctor` document (624041). The `.command("config")`
registrations that exist belong to `auto-mode config`. Configuration is now done through `/config`
in-session (the slash-command registry at 209408 lists `config` under kind `"config"`), through
`/doctor`, or by editing the JSON directly. `migrate-installer` is likewise absent (0 hits).

### 4.6 Settings schema — 165 top-level keys

Definition at 111638. Types abbreviated (`string`, `boolean`, `number`, `array`, `record`, `object`,
`enum`, `union`). Everything is optional.

| key | type | description (verbatim, truncated) |
|---|---|---|
| `$schema` | string | JSON Schema reference for Claude Code settings |
| `apiKeyHelper` | string | Path to a script that outputs authentication values |
| `proxyAuthHelper` | string | Shell command that outputs a Proxy-Authorization header value (EAP) |
| `awsCredentialExport` | string | Path to a script that exports AWS credentials |
| `awsAuthRefresh` | string | Path to a script that refreshes AWS authentication |
| `gcpAuthRefresh` | string | Command to refresh GCP authentication (e.g., gcloud auth application-default login) |
| `processWrapper` | string | Corporate launcher argv prefix for the background-agent supervisor, the sessions and workers it hosts, and the other covered background processes listed in the Claude Code corporate-launcher docume… |
| `policyHelper` | object | Executable that computes managed settings at startup. Honored only from admin-controlled policy sources. |
| `policyHelpers` | object |  |
| `fileSuggestion` | object | Custom file suggestion configuration for @ mentions |
| `respectGitignore` | boolean | Whether file picker should respect .gitignore files (default: true). Note: .ignore files are always respected. |
| `breakReminder` | object | Show a friendly nudge after sustained continuous use (default false). Must be true for the reminder to fire. |
| `quietHours` | object | Show a one-time nudge when you start or keep using the CLI inside your quiet-hours window (default false). |
| `cleanupPeriodDays` | number | Number of days to retain chat transcripts before automatic cleanup (default: 30). Minimum 1. Use a large value for long retention; use --no-session-persistence to disable transcript writes entirely. |
| `desktopSessionCleanupPeriodDays` | number | Retention ceiling in days for session transcripts created or last written by a desktop-host surface (Claude Desktop, Cowork), which are otherwise exempt from the cleanupPeriodDays sweep. 0 (the def… |
| `syncClaudeAiSkills` | boolean | Set to false to turn off syncing of the skills you have enabled on claude.ai. In your user settings (or managed settings): nothing more is downloaded, previously synced skills (~/.claude/skills/syn… |
| `syncClaudeAiPlugins` | boolean | Set to false to turn off syncing of the plugins you have enabled on claude.ai. In your user settings (or managed settings): nothing more is downloaded, previously synced plugins (~/.claude/plugins/… |
| `skillListingMaxDescChars` | number | Per-skill description character cap in the skill listing sent to Claude (default: 1536). Descriptions longer than this are truncated. Raise to opt in to higher per-turn context cost. |
| `skillListingBudgetFraction` | number | Fraction of the context window (in characters) reserved for the skill listing sent to Claude (default: 0.01 = 1%). When the listing exceeds this, descriptions are shortened to fit. Raise to opt in … |
| `wslInheritsWindowsSettings` | boolean | When set to true in either admin-only Windows source \u2014 the HKLM SOFTWARE/Policies/ClaudeCode registry key or C:/Program Files/ClaudeCode/managed-settings.json \u2014 WSL reads managed settings… |
| `env` | record<string,string> | Environment variables to set for Claude Code sessions |
| `attribution` | object | Attribution text for git commits, including any trailers. Empty string hides attribution. |
| `includeCoAuthoredBy` | boolean | Deprecated: Use attribution instead. Whether to include Claude's co-authored by attribution in commits and PRs (defaults to true) |
| `includeGitInstructions` | boolean | Include built-in commit and PR workflow instructions in Claude's system prompt (default: true) |
| `permissions` | permissions | Tool usage permissions configuration |
| `model` | string | Override the default model used by Claude Code |
| `fallbackModel` | array |  |
| `availableModels` | array |  |
| `enforceAvailableModels` | boolean | When true and availableModels is a non-empty array, the Default model selection is also constrained: if the default model for the user tier is not in availableModels, Default resolves to the first … |
| `modelOverrides` | record |  |
| `modelPicker` | object | Rows to show in the /model picker, in order. |
| `modelPricing` | object | Price usage at your organization's contracted rates instead of list price. " + "Affects every spend figure Claude Code reports \u2014 /cost, the status line, the SDK total_cost_usd, " + "--max-budg… |
| `enableAllProjectMcpServers` | boolean | Whether to automatically approve all MCP servers in the project |
| `enabledMcpjsonServers` | array | List of approved MCP servers from .mcp.json |
| `disabledMcpjsonServers` | array | List of rejected MCP servers from .mcp.json |
| `disableClaudeAiConnectors` | boolean | When true in any settings source, claude.ai MCP cloud connectors are not auto-fetched or connected. " + "Only gates auto-fetched connectors \u2014 a claudeai-proxy server passed explicitly " + "(e.… |
| `skillOverrides` | record |  |
| `disableBundledSkills` | boolean | Disable the skills and workflows that ship with Claude Code: bundled skills and workflows are removed entirely; built-in slash commands stay typable but are hidden from the model. Plugins, .claude/… |
| `allowedMcpServers` | array | Enterprise allowlist of MCP servers that can be used. Applies to all scopes including enterprise servers from managed-mcp.json. If undefined, all servers are allowed. If empty array, no servers are… |
| `deniedMcpServers` | array | Enterprise denylist of MCP servers that are explicitly blocked. If a server is on the denylist, it will be blocked across all scopes including enterprise. Denylist takes precedence over allowlist -… |
| `hooks` | hooks | Custom commands to run before/after tool executions |
| `worktree` | object | Directories to include when creating worktrees, via git sparse-checkout (cone mode). " + "Dramatically faster in large monorepos \u2014 only the listed paths are written to disk. |
| `disableAllHooks` | boolean | Disable all hooks and statusLine execution |
| `disableAgentView` | boolean | Disable agent view (`claude agents`, `--bg`, /background, the on-demand daemon). Typically set in managed settings. Equivalent to CLAUDE_CODE_DISABLE_AGENT_VIEW=1. |
| `disableRemoteControl` | boolean | Disable Remote Control (claude.ai/code, `claude remote-control`, `--remote-control`/`--rc`, auto-start, and the in-session toggle). Typically set in managed settings. |
| `disableWorkflows` | boolean | Disable the Workflows feature (also via CLAUDE_CODE_DISABLE_WORKFLOWS). |
| `disableArtifact` | boolean | Deprecated: use enableArtifact: false. Still honored \u2014 true disables the Artifact tool; false is ignored. |
| `enableArtifact` | boolean | Turn the Artifact tool on or off. Off in any of managed, --settings, or user settings wins; project and local settings can only turn it off. Unset defaults to on once the feature is available. |
| `enableWorkflows` | boolean | Enable or disable the Workflows feature for this user. Unset = default by plan once the feature is available. |
| `workflowSizeGuideline` | enum |  |
| `workflowKeywordTriggerEnabled` | boolean |  |
| `disableSkillShellExecution` | boolean | Disable inline shell execution in skills and custom slash commands from user, project, or plugin sources. Commands are replaced with a placeholder instead of being run. |
| `defaultShell` | enum | Default shell for input-box ! commands. Defaults to 'bash' on all platforms (no Windows auto-flip). |
| `respondToBashCommands` | boolean | Whether Claude responds after an input-box ! bash command runs. Set to false to add the command output to context without a response. Default: true. |
| `allowManagedHooksOnly` | boolean | When true (and set in managed settings), only hooks from managed settings run. User, project, and local hooks are ignored. |
| `allowedHttpHookUrls` | array |  |
| `httpHookAllowedEnvVars` | array | Allowlist of environment variable names HTTP hooks may interpolate into headers. When set, each hook's effective allowedEnvVars is the intersection with this list. If undefined, no restriction is a… |
| `allowManagedPermissionRulesOnly` | boolean | When true (and set in managed settings), only permission rules (allow/deny/ask) from managed settings are respected. User, project, local, and CLI argument permission rules are ignored. |
| `allowManagedMcpServersOnly` | boolean | When true (and set in managed settings), allowedMcpServers is only read from managed settings. deniedMcpServers still merges from all sources, so users can deny servers for themselves. Users can st… |
| `allowAllClaudeAiMcps` | boolean | When true (and set in managed settings), claude.ai cloud MCP connectors load alongside managed-mcp.json instead of being suppressed by its exclusive-control lockdown. Default off preserves the lock… |
| `strictPluginOnlyCustomization` | preprocess |  |
| `statusLine` | object | Re-run the status line command every N seconds in addition to event-driven updates |
| `prUrlTemplate` | string |  |
| `footerLinksRegexes` | array | Extra clickable footer badges that appear when a regex matches turn output (tool results and assistant responses). Read from user, flag, and managed settings only; ignored in project .claude/settin… |
| `subagentStatusLine` | object | Custom per-subagent status line shown in the agent panel; receives row context as JSON on stdin |
| `enabledPlugins` | record |  |
| `extraKnownMarketplaces` | record | Additional marketplaces to make available for this repository. Typically used in repository .claude/settings.json to ensure team members have required plugin sources. |
| `additionalMarketplaces` | record | Alias for extraKnownMarketplaces: this key is read exactly as if it were spelled " + "extraKnownMarketplaces. Do not set both in one file \u2014 if both appear, this key is ignored " + "with a warn… |
| `strictKnownMarketplaces` | array |  |
| `allowedMarketplaces` | array | Alias for strictKnownMarketplaces (managed settings only): this key is read exactly as if it " + "were spelled strictKnownMarketplaces. Do not set both in one file \u2014 if both appear, this key "… |
| `blockedMarketplaces` | array |  |
| `disableCommandPluginSources` | boolean | Controls the `command` plugin source, whose plugin directory is produced by running a marketplace-declared command on this machine. true: command-sourced plugins are never installed, updated, or re… |
| `disableSideloadFlags` | boolean | When true (and set in managed settings), rejects the --plugin-dir, --plugin-url, --agents, and non-sdk --mcp-config CLI flags at startup. Closes the CLI-flag bypass of strictKnownMarketplaces. Pair… |
| `pluginSuggestionMarketplaces` | array | Marketplace names whose plugins may surface as contextual install suggestions (relevance-based tips). No marketplace-declared suggestions surface without this allowlist; the built-in first-party fr… |
| `forceLoginMethod` | enum |  |
| `forceLoginGatewayUrl` | string |  |
| `parentSettingsBehavior` | enum |  |
| `managedSourcesBehavior` | enum |  |
| `forceLoginOrgUUID` | union | Organization UUID to require for OAuth login. Accepts a single UUID string or an array of UUIDs (any one is permitted). When set in managed settings, login fails if the authenticated account does n… |
| `forceRemoteSettingsRefresh` | boolean | When set in managed settings, the CLI blocks startup until remote managed settings are freshly fetched, and exits if the fetch fails |
| `otelHeadersHelper` | string | Path to a script that outputs OpenTelemetry headers |
| `outputStyle` | string | Controls the output style for assistant responses |
| `viewMode` | enum | Default transcript view mode on startup |
| `language` | string |  |
| `skipWebFetchPreflight` | boolean | Skip the WebFetch blocklist check for enterprise environments with restrictive security policies |
| `sandbox` | sandbox |  |
| `feedbackSurveyRate` | number | Probability (0\u20131) that the session quality survey appears when eligible. 0.05 is a reasonable starting point. |
| `feedbackDrafts` | enum |  |
| `spinnerTipsEnabled` | boolean | Whether to show tips in the spinner |
| `spinnerVerbs` | object |  |
| `spinnerTipsOverride` | object | Absolute or ~/ local path to a JSON file holding an array of tips (same shapes as `tips`); honored from user, --settings and on-disk managed settings only. Read once per CLI process (restart to pic… |
| `syntaxHighlightingDisabled` | boolean | Whether to disable syntax highlighting in diffs |
| `spellcheck` | object | Turn on spell checking of the prompt input (default: false) |
| `terminalTitleFromRename` | boolean | Whether /rename updates the terminal tab title (defaults to true). Set to false to keep auto-generated topic titles. |
| `promptCacheTtl` | enum |  |
| `subagentPromptCacheTtl` | enum |  |
| `alwaysThinkingEnabled` | boolean | When false, thinking is disabled. When absent or true, thinking is enabled automatically for supported models. |
| `effortLevel` | enum | Persisted effort level for supported models. |
| `modelSettings` | preprocess | Persisted effort level for this model. |
| `ultracode` | boolean | Enable ultracode for the session: xhigh effort plus standing dynamic-workflow orchestration. " + "Session-scoped \u2014 typically provided via --settings or the apply_flag_settings control request;… |
| `autoCompactWindow` | auto\|number | Auto-compact window size |
| `advisorModel` | string | Advisor model for the server-side advisor tool. |
| `fastMode` | boolean | When true, fast mode is enabled. When absent or false, fast mode is off. |
| `fastModePerSessionOptIn` | boolean | When true, fast mode does not persist across sessions. Each session starts with fast mode off. |
| `promptSuggestionEnabled` | boolean | When false, prompt suggestions are disabled. When absent or true, prompt suggestions are enabled. |
| `emojiCompletionEnabled` | boolean | When false, the :emoji: shortcode typeahead (the suggestion popup and the :name: inline replacement) is disabled. When absent or true, it is enabled. |
| `awaySummaryEnabled` | boolean | @internal When false, the session recap (shown when you return after being away for 5+ minutes) is disabled. When absent or true, recap is enabled. Hidden from public SDK types until external launch. |
| `showClearContextOnPlanAccept` | boolean |  |
| `askUserQuestionTimeout` | enum | Idle time before Claude's questions auto-continue with any answers " + "selected so far. Defaults to never \u2014 auto-continue only runs " + "when explicitly set to 60s/5m/10m. |
| `dialogExpiry` | enum |  |
| `agent` | string | Name of an agent (built-in or custom) to use for the main thread. Applies the agent's system prompt, tool restrictions, and model. |
| `modelProposedGoals` | enum | @internal Controls the ProposeGoal tool (model-proposed session goals). 'auto' (the default when absent) lets the model choose per proposal whether to ask for approval via its ask_user parameter; '… |
| `companyAnnouncements` | array | Company announcements to display at startup (one will be randomly selected if multiple are provided) |
| `pluginConfigs` | record | User configuration values for MCP servers keyed by server name |
| `remote` | object | Default environment ID to use for cloud sessions |
| `autoUpdatesChannel` | enum | Release channel for auto-updates (latest or stable) |
| `minimumVersion` | string | Minimum version to stay on - prevents downgrades when switching to stable channel |
| `requiredMinimumVersion` | string | Minimum Claude Code version required to start. If the running version is older, Claude Code exits at startup with instructions to update. Only enforced from managed (policy) settings. |
| `requiredMaximumVersion` | string | Maximum Claude Code version allowed to start. If the running version is newer, Claude Code exits at startup with instructions to install an approved version. Only enforced from managed (policy) set… |
| `plansDirectory` | string | Custom directory for plan files, relative to project root. If not set, defaults to ~/.claude/plans/ |
| `tui` | enum |  |
| `voice` | object | 'hold' (default): hold to talk. 'tap': tap to start, tap to stop+submit. |
| `channelsEnabled` | boolean | Managed-org opt-in for channel notifications (MCP servers with the claude/channel capability pushing inbound messages). claude.ai Teams/Enterprise: default off. Console: default on unless managed s… |
| `allowedChannelPlugins` | array | Managed-org allowlist of channel plugins. When set, " + "replaces the default Anthropic allowlist \u2014 admins decide which " + "plugins may push inbound messages. Undefined falls back to the defa… |
| `prefersReducedMotion` | boolean | Reduce or disable animations for accessibility (spinner shimmer, flash effects, etc.) |
| `doneMeansMerged` | boolean | @internal When true, Claude keeps working until the PR is ready for you to merge, a cron/Monitor is armed to resume later, or it hands you a self-contained next step. |
| `totalTokensReminder` | enum | @internal Emit a <total_tokens>N tokens left</total_tokens> block in the system prompt, after each tool result, and (when totalTokensReminderAfterUserTurn is on) after each regular user prompt. 'in… |
| `totalTokensReminderBudget` | number | @internal Starting budget (tokens) for totalTokensReminder 'padded-countdown' mode. Defaults to 15000000. Server-controlled via GrowthBook; env var CLAUDE_CODE_TOTAL_TOKENS_REMINDER_BUDGET overrides. |
| `totalTokensReminderAfterUserTurn` | boolean | @internal When true, emit the totalTokensReminder block after each regular user prompt and (for 'padded-countdown') re-anchor the task budget to the full configured value at the start of each user … |
| `autoMemoryEnabled` | boolean | Enable auto-memory for this project. When false, Claude will not read from or write to the auto-memory directory. |
| `autoMemoryDirectory` | string | Custom directory path for auto-memory storage. Supports ~/ prefix for home directory expansion. Ignored if set in projectSettings (checked-in .claude/settings.json) for security. When unset, defaul… |
| `autoDreamEnabled` | boolean | Enable background memory consolidation (auto-dream). When set, overrides the server-side default. |
| `showThinkingSummaries` | boolean | Request API-side thinking summaries and show them in the conversation and in the transcript view (ctrl+o). Set explicitly to override the default for your install. |
| `skipDangerousModePermissionPrompt` | boolean | Whether the user has accepted the bypass permissions mode dialog |
| `skipWorkflowUsageWarning` | boolean | @internal Whether the user has accepted the multi-agent workflow usage warning. Until set, auto permission mode prompts before running a workflow. |
| `disableAutoMode` | enum | Disable auto mode |
| `sshConfigs` | array | Unique identifier for this SSH config. Used to match configs across settings sources. |
| `claudeMd` | string | CLAUDE.md-style instructions injected as organization-managed memory. Only honored from managed/policy settings. |
| `claudeMdExcludes` | array |  |
| `pluginTrustMessage` | string |  |
| `theme` | union | Color theme for the UI |
| `editorMode` | enum | Key binding mode for the prompt input |
| `keybindingFlavor` | enum |  |
| `vimInsertModeRemaps` | record |  |
| `verbose` | boolean | Show full tool output instead of truncated summaries |
| `preferredNotifChannel` | enum | Preferred OS notification channel |
| `autoCompactEnabled` | boolean | Automatically compact conversation when context fills |
| `precomputeCompactionEnabled` | boolean | Precompute the compaction summary in the background before it is needed. Only applies when auto-compact is on. |
| `switchModelsOnFlag` | boolean | When safeguards flag a message, automatically switch to a different model to keep chatting. When off, your session will pause instead. |
| `autoContinueAtUsageLimit` | boolean | When a claude.ai usage limit stops your session, wait for the limit to reset and continue the task automatically. When off, the limit dialog offers the wait as a choice instead. |
| `autoScrollEnabled` | boolean | Auto-scroll the conversation view to bottom (fullscreen mode only) |
| `wheelScrollAccelerationEnabled` | boolean | Ramp mouse-wheel scroll speed during fast scrolls (fullscreen mode only) |
| `fileCheckpointingEnabled` | boolean | Snapshot files before edits so /rewind can restore them |
| `showTurnDuration` | boolean |  |
| `showMessageTimestamps` | boolean | Stamp each message with its arrival time |
| `terminalProgressBarEnabled` | boolean | Emit OSC 9;4 progress sequences during long operations |
| `todoFeatureEnabled` | boolean | Enable the todo / task tracking panel |
| `teammateMode` | enum | How spawned teammates execute (tmux, iterm2, in-process, auto) |
| `remoteControlAtStartup` | boolean | Start Remote Control bridge automatically each session |
| `isolatePeerMachines` | boolean | Require explicit approval before SendMessage can reach a peer session on another machine via Remote Control |
| `daemonColdStart` | enum | When no background service is running: 'transient' spawns one for this login session; 'ask' offers to install it persistently |
| `crossSessionInbound` | enum | Inbound cross-session peer messages (SendMessage from your other sessions): 'accept' delivers them, 'hold' parks them for your review without letting Claude act, 'refuse' opts this session out. An … |
| `autoUploadSessions` | boolean | Mirror local sessions to claude.ai as view-only (no remote control) |
| `inputNeededNotifEnabled` | boolean | Push to mobile when a permission prompt or question is waiting |
| `agentPushNotifEnabled` | boolean | Allow Claude to push proactive mobile notifications |

Five feature-module shapes are spread in conditionally (`rt(e)` over `xn = ["autoMode","deepLink",
"voice","briefView","screenReader"]`, 111232–111240), contributing:
`skipAutoPermissionPrompt`, `useAutoModeDuringPlan`, `autoMode{allow,soft_deny,hard_deny,environment,classifyAllShell}`,
`disableDeepLinkRegistration`, `voiceEnabled`, `defaultView`, `axScreenReader`,
plus `permissions.disableAutoMode`. `xaaIdp {issuer, clientId, callbackPort}` is spread in only when
`CLAUDE_CODE_ENABLE_XAA` is set.

**`permissions`** (`bt`, 111497):
`allow[]`, `deny[]`, `ask[]`, `defaultMode` (enum; `"manual"` accepted as an alias for `"default"`),
`disableBypassPermissionsMode: "disable"`, `disableAutoMode: "disable"`, `additionalDirectories[]`,
`.passthrough()`.

**`statusLine`**: `{type:"command", command, padding?, refreshInterval? (min 1),
hideVimModeIndicator?}`. **`subagentStatusLine`**: `{type:"command", command}`.
**`fileSuggestion`**: `{type:"command", command}`.

**`sandbox`** (`tTt`, 111182): `enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed`,
`allowUnsandboxedCommands` (default true), `network`, `filesystem`, `credentials`,
`ignoreViolations: record<string,string[]>`, `enableWeakerNestedSandbox`,
`enableWeakerNetworkIsolation` (macOS trustd), `allowAppleEvents` (macOS; user/managed/CLI only),
`excludedCommands[]`, `ripgrep {command,args}`, `bwrapPath`, `socatPath` (both admin-managed only),
`.passthrough()`.

Validation is *forgiving by construction*: `JEn` (111660) wraps every field in `.catch()` so a bad
value is reported and dropped rather than failing the whole file, with special handling for
`allowedMcpServers` (invalid → **empty allowlist**, i.e. fail closed),
`allowManagedHooksOnly` (invalid → treated as **true**), and `availableModels` (invalid → empty).

### 4.7 Model constants shipped in the bundle (266545)

```
FABLE_ID  claude-fable-5     MYTHOS_ID claude-mythos-5   OPUS_ID   claude-opus-5
SONNET_ID claude-sonnet-5    HAIKU_ID  claude-haiku-4-5
PREV_OPUS_ID claude-opus-4-8  PREV_SONNET_ID claude-sonnet-4-6
```

---

## 5. Environment variables

### 5.1 The typed registry (`chunk-w3k8bej2.js`, 770014–770497)

Eight namespace objects are merged into one accessor:
`var uI = {...U, ...B, ...M, ...N, ...u, ...l, ...i, ...P}; var a = b(uI, T);` (770478). `b()`
installs a memoising getter per variable: it re-reads `process.env[NAME]`, and only re-parses when
the raw string changed. It also exposes `a.set(NAME, value)` and `a.unset(NAME)`.

Coercions (`chunk-nt3hxpjz.js`, 649019):

| helper | semantics |
|---|---|
| `str()` | trimmed string, `""` → `undefined` |
| `rawStr()` | untrimmed string (used for `FORCE_COLOR`, `NODE_DISABLE_COLORS`) |
| `bool()` | true iff lowercased/trimmed ∈ `{"1","true","yes","on"}` (122763) |
| `triBool()` | `true` for the above, `false` for `{"0","false","no","off"}`, else `undefined` |
| `int({min,max,digitsOnly})` | numeric parse with optional `^[+-]?\d+$` strictness and range clamping; out-of-range → `undefined` |
| `enum([...])` | trimmed exact match against the list, else `undefined` |

| namespace | count | domain |
|---|---|---|
| `U` | 62 | auth & credentials (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, AWS/Azure/GCP creds, `MCP_CLIENT_SECRET`, `MCP_XAA_IDP_CLIENT_SECRET`, `USE_LOCAL_OAUTH`, `USE_STAGING_OAUTH`) |
| `B` | 58 | base URLs & providers (`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_{BEDROCK,VERTEX,FOUNDRY,MANTLE,GATEWAY,ANTHROPIC_AWS,ANTHROPIC_GOOGLE_CLOUD}`, `CLAUDE_CODE_GB_BASE_URL`, `CCR_AGENT_PROXY_*`) |
| `M` | 37 | model selection (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL[_NAME/_DESCRIPTION]`, `ANTHROPIC_CUSTOM_MODEL_OPTION*`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_MODEL_CATALOG`, `CLAUDE_CODE_EFFORT_LEVEL`) |
| `N` | 244 | feature toggles (mostly `bool`/`triBool`; includes every `CLAUDE_CODE_<CODENAME>` gate override) |
| `u` | 44 | HTTP/transport (`API_TIMEOUT_MS`, `MAX_THINKING_TOKENS`, `CLAUDE_CODE_MAX_{OUTPUT,CONTEXT}_TOKENS`, `CLAUDE_CODE_MAX_RETRIES`, `CLAUDE_CODE_CLIENT_CERT/KEY`, `HTTP(S)_PROXY`, `MAX_MCP_OUTPUT_TOKENS`) |
| `l` | 188 | OS/terminal/third-party (`TERM`, `TERM_PROGRAM`, `SHELL`, `APPDATA`, `DISPLAY`, `BROWSER`, `GH_TOKEN`, CA-bundle vars, CI detectors) |
| `i` | 64 | telemetry/debug (all `OTEL_*` + `ANT_OTEL_*`, `CLAUDE_CODE_DEBUG_LOG*`, `CLAUDE_CODE_PERFETTO_TRACE`, `DEBUG`) |
| `P` | 274 | session/config/misc (`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SIMPLE`, `CLAUDE_CODE_SAFE_MODE`, `CLAUDE_CODE_RESTRICTED`, `DISABLE_*` command switches, `CLAUDE_CODE_SYNC_*`) |
| **total** | **971** | |

A raw string sweep finds **561 distinct `CLAUDE_CODE_*` literals** in the bundle (some are dynamic
keys or scrub-list entries rather than reads).

### 5.2 Boot- and configuration-relevant variables

| var | type | meaning (anchor) |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | str | Relocates `~/.claude.json` and `~/.claude/`. Warned about if it changes after storage init (285223). Propagated into spawned sandboxes (775185). |
| `CLAUDE_SECURESTORAGE_CONFIG_DIR` | str | Overrides the keychain-service naming root; `""` means "use the plain name" (650790). |
| `ANTHROPIC_CONFIG_DIR` | str | present in the registry (`P` namespace). |
| `CLAUDE_CODE_MANAGED_SETTINGS_PATH` | str | **Declared but inert in this build** — the reader `yEn()` (209573) is compiled to `return;`. Only surfaces in an env-scrub set and a log string (815533). |
| `CLAUDE_CODE_RESTRICTED` | bool | Same as `--restricted`; clears user/project/local settings sources (748482 region / entry stub line 316). |
| `CLAUDE_CODE_SIMPLE` | bool | Set by `--bare`. |
| `CLAUDE_CODE_SAFE_MODE` | bool | Set by `--safe-mode`. |
| `CLAUDE_CODE_SANDBOXED` | bool | Short-circuits the trust check to trusted (311163). |
| `CLAUDE_CODE_ENTRYPOINT` | str | Client identity; drives telemetry + several behavioural branches (747889). |
| `CLAUDE_CODE_HOVER_REST` | bool/str | Pins the v5 storage backend from env at the very top of the stub. |
| `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | bool | Skips `process.title = "claude"` (748328). |
| `CLAUDE_CODE_REMOTE` | bool | Cloud session; also bumps `NODE_OPTIONS --max-old-space-size=8192` in the stub. |
| `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` | — | Suppresses the early plugin-sync kick in `preAction` (748387). |
| `NoDefaultCurrentDirectoryInExePath` / `COREPACK_ENABLE_AUTO_PIN` | — | Set unconditionally by the stub. |
| `USE_BUILTIN_RIPGREP` | bool | Falsy value forces the system `rg` over the embedded one (685288). |
| `DISABLE_UPDATES` | bool | Hard-refuses `claude update` and disables the auto-updater. |
| `DISABLE_AUTOUPDATER` | bool | Disables the auto-updater; also what migration #1 writes into `settings.env`. |
| `DISABLE_INSTALLATION_CHECKS` | bool | Skips launcher/PATH diagnostics (48916). |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | any | "essential-traffic" mode: disables the auto-updater, version lookups, DesignSync, live preview, GrowthBook network (697490). |
| `DISABLE_TELEMETRY`, `DO_NOT_TRACK` | str/bool | "no-telemetry" mode (697492). |
| `DISABLE_GROWTHBOOK` | bool | Disables the flag client outright (310353). |
| `CLAUDE_CODE_GB_BASE_URL`, `CLAUDE_CODE_GB_REFRESH_INTERVAL_MS`, `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` | str/int/bool | GrowthBook endpoint, refresh, and whether the disk cache is readable while telemetry is off (310357). |
| `CLAUDE_INTERNAL_FC_OVERRIDES` | str | Raw environment override blob read by the flag client (310303). |
| `CLAUDE_CODE_STALL_TIMEOUT_MS_FOR_TESTING`, `CLAUDE_CODE_DOWNLOAD_DEADLINE_MS_FOR_TESTING` | int | Updater timeouts (48258). |
| `XDG_DATA_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME` / `XDG_CONFIG_HOME` | str | Install/staging/lock dirs (583097–583116). |
| `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` | bool | Lets a host app own the model provider (and unlock `modelPricing`). |
| `CLAUDE_CODE_PROCESS_WRAPPER` | str | Corporate launcher argv prefix; takes precedence over the `processWrapper` setting. |
| `CLAUDE_CODE_ENABLE_XAA` | bool | Unhides `mcp xaa …` and the `--xaa` flag; also gates the `xaaIdp` settings key **at schema-construction time**. |
| `SELF_HOSTED_RUNNER_*` (≈24 vars) | — | The `self-hosted-runner` subtree's configuration surface. |

### 5.3 Env-var scrub sets

Two named sets bound what is forwarded into subprocesses / sandboxes:
secrets to strip (`Kn`, 335694: `ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN,
CLAUDE_CODE_ARTIFACTS_API_TOKEN, CLAUDE_CODE_MEMORY_API_TOKEN, CLAUDE_CODE_SLACK_TAG_TOKEN,
ANTHROPIC_AUTH_TOKEN, ANTHROPIC_FOUNDRY_API_KEY, ANTHROPIC_FOUNDRY_AUTH_TOKEN, ANTHROPIC_AWS_API_KEY,
ANTHROPIC_CUSTOM_HEADERS, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, …`) and provider/network vars to
preserve (`No`, 390598 / `tbr`, 112634). Background workers strip anything starting with `CLAUDE_`
except `CLAUDE_JOB_DIR`, `CLAUDE_CONFIG_DIR`, `CLAUDE_BG_PTY_AUTH`, plus all `OTEL_*` (597578).

---

## 6. Feature flags

### 6.1 GrowthBook replaced Statsig

`grep -ci statsig` = 2, and both hits are the *string* `"statsig"` used as a legacy directory name in
retention sweeps (`~/.claude/{todos,statsig,logs}`, 722608) and in a config-dir file allowlist
(124150). The live system is GrowthBook (`chunk-bsdtxcdc.js`, 296673; facade re-exported by
`chunk-cvp894ys.js`, 335240).

### 6.2 API

| export | impl | semantics |
|---|---|---|
| `getFeatureValue_CACHED_MAY_BE_STALE(name, default)` | `I`, 310385 | the workhorse; returns `.value` of `getFeatureValueWithSource` |
| `getFeatureValueWithSource_CACHED_MAY_BE_STALE` | `$m`, 310382 | `{value, source}` where source ∈ `{growthbook, fallback, …}` |
| `getFeatureValue_SESSION_PINNED(name, default)` | `gpe`, 310388 | memoises the first read into a per-session `Map` so a mid-session refresh can't flip behaviour |
| `getFeatureValue_CACHED_WITH_REFRESH` | `DH`, 310394 | currently identical to `I` |
| `getFeatureValue_DEPRECATED` | `R4t`, 310379 | async, blocking |
| `checkGate_CACHED_OR_BLOCKING(name)` | `Lp`, 310402 | async gate check |
| `getDynamicConfig_BLOCKS_ON_INIT` / `_CACHED_MAY_BE_STALE` | `dO`/`gh`, 310455/310458 | dynamic configs |
| `initializeGrowthBook` / `refreshGrowthBookFeatures` / `setupPeriodicGrowthBookRefresh` | `mh`/`M7e`/`VRr` | lifecycle |
| `onGrowthBookRefresh(cb)` | `Yh` | late-binding; e.g. cross-session messaging "late-binds" when a refresh turns its gate on (326073) |

The naming is unusually honest: the exported symbols literally encode their staleness contract
(`_CACHED_MAY_BE_STALE`, `_BLOCKS_ON_INIT`, `_SESSION_PINNED`).

### 6.3 Enablement, caching, offline behaviour

```js
function R$(){ return !a.DISABLE_GROWTHBOOK && nP() }                       // 310353 — nP() = telemetry allowed
function I7(){ return a.CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF && !a.DISABLE_GROWTHBOOK && _j() && pr() } // 310357
```

* Cache lives in the **global config**: `saveGlobalConfig(o => ({...o, cachedGrowthBookFeatures,
  cachedExperimentFeatures, cachedExperimentData, cachedGrowthBookFeaturesAt: Date.now()}))`
  (301949). So `~/.claude.json` is the flag cache.
* `readGlobalConfig().cachedGrowthBookFeatures ?? {}` is the read path (301850).
* Offline/first-run: `isGrowthBookCacheEmpty()` = no fresh features **and** an empty cached map
  (310336); consumers then fall back to the per-call default argument. Every `I(name, default)` call
  carries its own default, so a total network failure degrades to the compiled-in defaults.
* Refresh cadence (`CSr`, 310413): base **360 minutes**; the flag `tengu_gb_refresh_interval_minutes`
  can override it, clamped to `[5, 360]`, then jittered by ×`(0.9 + rand·0.2)` and re-capped at 360.
* Auth: the client refreshes the OAuth token pre-init if needed (`"GrowthBook pre-init OAuth
  refresh"`, 301756, with 60 s/5 s/5 s timeouts) and falls back from `/api/eval-authed` to
  `/api/eval` on non-OK (301975).
* User attributes sent (`xnr`, 310373): `id/deviceId`, `sessionId`, `platform`, `apiBaseUrlHost`
  (omitted when it is `api.anthropic.com`), `organizationUUID`, `accountUUID`, `userType`,
  `subscriptionType`, `rateLimitTier`, `organizationRole`, `subscriptionCreatedAt`, `firstTokenTime`,
  `email`, `appVersion`, `githubActionsMetadata`, `entrypoint`, `hasUsedRemoteSession`,
  `hasRemoteEnvironment`.
* One flag is read *without* the client, straight off disk, before anything is initialised:
  `JSON.parse(readFileSync(configPath)).cachedGrowthBookFeatures?.tengu_windows_credman === true`
  (267383) — a bootstrap-order escape hatch for secure-storage selection.

### 6.4 The env-override pattern

The canonical resolver (651299):

```js
function l(e, o, r) { return e || qWt(r) || Fl()?.[o] === !0 || I(o, !1) }
//        ^env var  ^prompt-bundle opt-in  ^per-conversation server override  ^growthbook default false
```

Used as `l(a.CLAUDE_CODE_GAULT_KESTREL, "tengu_gault_kestrel", ctx)` etc. **Every
`CLAUDE_CODE_<TWO_WORD_CODENAME>` env var is a local force-on for the identically-named
`tengu_<two_word_codename>` flag.** Codename env vars present: `AMBER_ASTROLABE, BASALT_COVE,
BISON_CAIRN, BREEZY_HORIZON, CARVED_SLATE, DAPPER_LAGOON, GAULT_KESTREL, GENTLE_PARASOL, GORSE_PLOVER,
HARBOR_KITE, JUNIPER_SUNDIAL, LANTERN_PRISM, LARCH_CISTERN, LUMINOUS_WHISTLE, NANKEEN_KESTREL,
PARCHMENT_FERN, PEWTER_OWL, THISTLE_GREBE, THRIFTY_SONIC, TICKLISH_WHISPER, TOASTY_THIMBLE,
WALNUT_SPIRE, WILLOW_TERN`.

### 6.5 Flag inventory (355 names with literal defaults)

Extracted by matching `"tengu_*"` first-arguments followed by a literal default. Analytics event
names share the `tengu_` prefix and were filtered out by requiring a boolean/number/null/string
default. Values shown are the compiled fallbacks.

**Default `false` (220):** `tengu_alder_compass`, `tengu_amber_anchor`, `tengu_amber_creek`, `tengu_amber_kestrel`, `tengu_amber_lark`, `tengu_amber_lynx`, `tengu_amber_packet`, `tengu_amber_prism`, `tengu_amber_quill_moth`, `tengu_amber_relay`, `tengu_amber_sentinel`, `tengu_auto_mode_worktree_fast_path`, `tengu_basalt_meadow`, `tengu_basalt_scarp`, `tengu_basalt_spur`, `tengu_birch_kettle`, `tengu_bracken_sluice`, `tengu_brass_plover`, `tengu_brass_sled`, `tengu_brick_follow`, `tengu_bridge_attestation_enforce`, `tengu_bridge_initialize_commands`, `tengu_bridge_partial_messages`, `tengu_bridge_requires_action_details`, `tengu_bridge_subagent_text`, `tengu_bridge_vivid`, `tengu_brindle_causeway`, `tengu_c4e_slash_upsell`, `tengu_ccr_bridge`, `tengu_ccr_delta_rehydrate`, `tengu_ccr_handoff_metadata`, `tengu_ccr_idle_heartbeat`, `tengu_ccr_reactivation_beat`, `tengu_ccr_reconnect_beat`, `tengu_ccr_subagent_lazy_hydrate`, `tengu_ccr_subagent_skip_on_delta`, `tengu_ccr_v2_session_crud_cli`, `tengu_cedar_lattice`, `tengu_cedar_marsh`, `tengu_cedar_plume`, `tengu_cedar_transom`, `tengu_chair_sermon`, `tengu_chomp_inflection`, `tengu_chrome_auto_enable`, `tengu_chrome_install_upsell`, `tengu_classifier_summary_kill`, `tengu_classifier_summary_llm_emit`, `tengu_clever_orbit`, `tengu_cobalt_harbor`, `tengu_cobalt_plinth_alder`, `tengu_cobalt_plinth_aspen`, `tengu_cobalt_plinth_bracken`, `tengu_cobalt_plinth_campion`, `tengu_cobalt_plinth_dataviz`, `tengu_cobalt_plinth_fennel`, `tengu_cobalt_plinth_larch`, `tengu_cobalt_plinth_laurel`, `tengu_cobalt_plinth_osier`, `tengu_cobalt_plinth_sedge`, `tengu_cobalt_plinth_tansy`, `tengu_cobalt_plinth_thistle`, `tengu_cobalt_plinth_thrift`, `tengu_cobalt_plinth_yew`, `tengu_cobalt_ridge`, `tengu_cobalt_wren`, `tengu_copper_lantern`, `tengu_copper_thistle`, `tengu_coral_beacon`, `tengu_cowork_auto_mode_include_allowed_write_mcp`, `tengu_cowork_chrome_automode_default`, `tengu_crimson_vector`, `tengu_dapper_dawn`, `tengu_destructive_command_warning`, `tengu_disable_live_host_context`, `tengu_disable_streaming_to_non_streaming_fallback`, `tengu_dreamy_frost`, `tengu_drift_lantern`, `tengu_edit_minimalanchor_jrn`, `tengu_ember_latch`, `tengu_expressive_whistle`, `tengu_fgts`, `tengu_fleet_past_sessions`, `tengu_fleetview_peers`, `tengu_fleetview_simple`, `tengu_flint_harbor_share`, `tengu_gable_onyx_sluice`, `tengu_gb_eval_authed_enable`, `tengu_gleaming_fair`, `tengu_gorse_fathom`, `tengu_gorse_pylon`, `tengu_gorse_sill`, `tengu_gypsum_kite`, `tengu_harbor`, `tengu_harbor_kite_cloud`, `tengu_harbor_kite_pacing_off`, `tengu_harbor_moth`, `tengu_harbor_permissions`, `tengu_harbor_willow`, `tengu_hawthorn_steeple`, `tengu_haze_glass`, `tengu_hazel_osprey`, `tengu_hazel_quire`, `tengu_hover_rest`, `tengu_ide_rc_auto_enable`, `tengu_idle_amber_finch`, `tengu_import`, `tengu_jade_anvil_4`, `tengu_jiggly_mochi`, `tengu_juniper_bassoon`, `tengu_juniper_relay`, `tengu_kairos_brief`, `tengu_kairos_input_needed_push`, `tengu_kairos_loop_persistent`, `tengu_kairos_push_notifications`, `tengu_lantern_prism`, `tengu_lantern_sconce`, `tengu_lantern_spool`, `tengu_larch_pavise`, `tengu_linen_orbit`, `tengu_loggia_denkbild`, `tengu_maple_pier`, `tengu_maple_rung`, `tengu_maple_sundial`, `tengu_marbled_teal`, `tengu_marlin_porch`, `tengu_mcp_claudeai_eligibility_gate`, `tengu_mcp_directory_bff`, `tengu_mcp_issuer_strict_echo`, `tengu_mcp_protocol_negotiation_ccr`, `tengu_mcp_protocol_negotiation_claudeai`, `tengu_mcp_protocol_negotiation_http`, `tengu_mcp_skills`, `tengu_mcp_strip_trailing_xml_tags`, `tengu_mcp_subagent_prompt`, `tengu_medlar_quoin`, `tengu_melodic_wolf`, `tengu_mill_orange`, `tengu_mint_lanes`, `tengu_misty_anchor`, `tengu_moonlit_panda`, `tengu_moss_anchor`, `tengu_moth_copse`, `tengu_nankeen_kestrel`, `tengu_native_cursor`, `tengu_neapolitan`, `tengu_ochre_finch`, `tengu_ochre_wren`, `tengu_onyx_sluice`, `tengu_osier_pylon_trace`, `tengu_paper_halyard`, `tengu_passport_quail`, `tengu_pencil_farmer`, `tengu_pewter_brook`, `tengu_pewter_canteen`, `tengu_plugin_autoupdate_allow_credential_helper`, `tengu_plugin_binary_assets`, `tengu_plum_vx3`, `tengu_pr_footer_surface_suffix`, `tengu_print_engine_loop`, `tengu_propose_goal`, `tengu_quiet_harbor`, `tengu_quiet_slate_wren`, `tengu_reactive_compact_remote`, `tengu_read_dedup_killswitch`, `tengu_record_created_pr_to_ccr`, `tengu_remote_auto_mode_include_destructive_mcp`, `tengu_remote_backend`, `tengu_rename_full_session_fork`, `tengu_saffron_picker_dim`, `tengu_satchel_banjo`, `tengu_scratch`, `tengu_send_file`, `tengu_sepia_moth`, `tengu_shale_finch`, `tengu_shining_fractals`, `tengu_silent_harbor`, `tengu_silk_hinge`, `tengu_skills_dashboard_enabled`, `tengu_slate_finch`, `tengu_slate_harbor`, `tengu_slate_harbor_experiment`, `tengu_slate_lantern`, `tengu_slate_lantern_ember`, `tengu_slate_quoin`, `tengu_slate_thimble`, `tengu_smooth_harbor`, `tengu_sorrel_trellis`, `tengu_stone_shell`, `tengu_structured_output_strict`, `tengu_subagent_cache_evict`, `tengu_tab_read_sep`, `tengu_teal_corbel`, `tengu_teleport_send_to_cloud`, `tengu_terminal_sidebar`, `tengu_thinking_block_resumption`, `tengu_thinking_display_updates`, `tengu_ticklish_whisper`, `tengu_tool_memory_cgroup`, `tengu_tool_pear`, `tengu_trace_lantern`, `tengu_transcript_local_gc`, `tengu_tussock_oriole`, `tengu_umber_lattice`, `tengu_umber_petrel`, `tengu_umber_sluice`, `tengu_vellum_anchor`, `tengu_vellum_siding`, `tengu_velvet_tide`, `tengu_verified_vs_assumed`, `tengu_violin_amati`, `tengu_violin_strad`, `tengu_violin_wood`, `tengu_virtual_knuth`, `tengu_vscode_feedback_survey`, `tengu_vscode_onboarding`, `tengu_vscode_review_upsell`, `tengu_walnut_sconce`, `tengu_walnut_spire`, `tengu_watchdog_skip_nonstreaming_fallback`, `tengu_willow_crate`

**Default `true` (96):** `tengu_amber_flint`, `tengu_amber_sextant`, `tengu_async_goblet`, `tengu_bg_attach_upgrade`, `tengu_bg_binary_takeover`, `tengu_bg_leftarrow_inprocess`, `tengu_bg_revival_guard`, `tengu_bg_spare_enable`, `tengu_bg_worker_ctty`, `tengu_bridge_auth_revive`, `tengu_bridge_host_declined_end`, `tengu_bridge_owner_pinned_end`, `tengu_bridge_placeholder_sweep`, `tengu_bridge_recovery_patience`, `tengu_bridge_repl_v2_cse_shim_enabled`, `tengu_bridge_resume_respects_local_owner`, `tengu_bridge_selfheal_heartbeats`, `tengu_bridge_signed_out_neutral`, `tengu_bridge_subagent_frames`, `tengu_bridge_unarchive_on_resume`, `tengu_ccr_orphan_restore_wake`, `tengu_ccr_orphan_restore_wake_shells`, `tengu_ccr_v2_send_events_cli`, `tengu_cedar_lantern`, `tengu_chrome_tab_group_close`, `tengu_cobalt_harbor_notice`, `tengu_cobalt_plinth_fern`, `tengu_cobalt_plinth_madder`, `tengu_cobalt_plinth_moss`, `tengu_cobalt_plinth_sorrel`, `tengu_cobalt_plinth_teasel`, `tengu_cobalt_thicket`, `tengu_compact_cache_prefix`, `tengu_composed_quail`, `tengu_concurrent_shore`, `tengu_coordinator_panel`, `tengu_copper_kestrel`, `tengu_coral_anchor`, `tengu_cuddly_willow`, `tengu_daemon_refuse_stale_upgrade`, `tengu_daemon_upgrade_defer_busy`, `tengu_dazzling_garden`, `tengu_deep_feather`, `tengu_deferred_stub_tool`, `tengu_ethereal_mist`, `tengu_ethereal_nova`, `tengu_fleetview_pr_batch`, `tengu_foamy_spring`, `tengu_glimmering_glade`, `tengu_harbor_kite`, `tengu_harbor_kite_mode_emit`, `tengu_harbor_kite_win`, `tengu_jade_compass`, `tengu_kairos_cron`, `tengu_kairos_cron_durable`, `tengu_kairos_loop_keepalive`, `tengu_kestrel_moor`, `tengu_keybinding_customization_release`, `tengu_left_arrow_editing_guard`, `tengu_linear_brook`, `tengu_luminous_seal`, `tengu_mcp_auto_background`, `tengu_mcp_connect_timeout_retry`, `tengu_mcp_listen_reopen_park`, `tengu_mcp_proxy_needs_approval_retry`, `tengu_mcp_server_policy_bypass_exempt`, `tengu_mcp_singleton_unwrap`, `tengu_mcp_startup_policy_seed`, `tengu_mcp_stateless_skip_init`, `tengu_memory_bulk_inflate`, `tengu_memory_stream_list`, `tengu_observer_agents_enabled`, `tengu_observer_subagent_fanout`, `tengu_playful_lobster`, `tengu_plugin_command_source_refresh`, `tengu_plugin_official_mkt_git_fallback`, `tengu_ptc_enabled`, `tengu_quartz_pipit`, `tengu_quartz_thimble`, `tengu_repl_mcp_error_throw`, `tengu_saffron_wren`, `tengu_send_user_file`, `tengu_sequential_puffin`, `tengu_session_name_uniqueness`, `tengu_sharded_beacon`, `tengu_static_title_under_mux`, `tengu_stream_watchdog_default_on`, `tengu_surface_failed_mcp_servers`, `tengu_teal_corbel_finial`, `tengu_truncated_response_recovery`, `tengu_turtle_carbon`, `tengu_ultrareview_post_enabled`, `tengu_vscode_resume_precheck`, `tengu_wobbly_pinwheel`, `tengu_workflows_enabled`, `tengu_xterm_atlas_reset`

**Non-boolean defaults (39):** `tengu_amber_redwood2` = "", `tengu_amber_redwood3` = "", `tengu_bg_low_mem_mb` = 1024, `tengu_bg_prewarm_burst_concurrency` = 3, `tengu_bg_prewarm_burst_delay_ms` = 15000, `tengu_bg_prewarm_per_sweep` = 3, `tengu_birch_lantern` = "off", `tengu_bramble_lintel` = null, `tengu_ccr_bundle_max_bytes` = null, `tengu_ccr_no_subscriber_flush_ms` = 0, `tengu_cicada_nap_ms` = 0, `tengu_cinder_plover` = "", `tengu_cinder_wren` = "", `tengu_classifier_disabled_surfaces` = "", `tengu_gb_refresh_interval_minutes` = null, `tengu_hearth_resolved_rows` = "off", `tengu_heron_brook` = "", `tengu_juniper_sundial` = null, `tengu_kairos_brief_stop_hook_text` = "", `tengu_kairos_ready_nudge` = null, `tengu_kestrel_arch` = "off", `tengu_mcp_discovery_cache_enable` = null, `tengu_mcp_listen_reopen_park_tuning` = null, `tengu_mcp_memory_cgroup` = null, `tengu_mem_push_delete_mode` = "corroborate", `tengu_non_deferrable_builtins` = null, `tengu_onyx_plover` = null, `tengu_penguins_off` = null, `tengu_pewter_kite_ms` = 0, `tengu_pewter_owl_model` = "", `tengu_rc_long_turn_nudge` = null, `tengu_saffron_ladder` = null, `tengu_sepia_cormorant` = null, `tengu_soft_slate_nudge` = "baseline", `tengu_startup_notice` = "", `tengu_tool_cgroup_exclude_classes` = null, `tengu_tool_search_unsupported_models` = null, `tengu_ultraplan_config` = null, `tengu_ultraplan_timeout_seconds` = 5400

Flags whose effect I read directly:

| flag | default | controls |
|---|---|---|
| `tengu_gb_refresh_interval_minutes` | null | GrowthBook poll cadence, clamp 5–360 min (310413) |
| `tengu_windows_credman` | — | Windows Credential Manager secure storage; read straight off `~/.claude.json` pre-init (267383, 285232) |
| `tengu_kestrel_moor` | true | ATIS conversation-latch header selection (310445) |
| `tengu_brindle_causeway` | false | dir-sync engine v2 vs v1 (328638) |
| `tengu_workflows_enabled` | true | Workflows feature |
| `tengu_ptc_enabled` | true | programmatic tool calling |
| `tengu_bg_low_mem_mb` | 1024 | background-dispatch low-memory threshold |
| `tengu_bg_prewarm_burst_concurrency` / `_delay_ms` / `tengu_bg_prewarm_per_sweep` | 3 / 15000 / 3 | background spare-process prewarming |
| `tengu_ultraplan_timeout_seconds` | 5400 | ultraplan deadline |
| `tengu_mem_push_delete_mode` | `"corroborate"` | memory delete-propagation policy (also `CLAUDE_CODE_MEMORY_PUSH_DELETE_MODE`) |
| `tengu_maple_pier` | false | auto-mode default nudge (854964) |
| `tengu_fennel_godwit` | false | inverts the `opus_5_prompt_bundle` opt-in inside `l()` (651296) |
| `tengu_soft_slate_nudge` | `"baseline"` | nudge variant |
| `tengu_hearth_resolved_rows`, `tengu_birch_lantern`, `tengu_kestrel_arch` | `"off"` | string-valued rollouts |

Twenty `tengu_cobalt_plinth_<botanical>` flags (alder, aspen, bracken, campion, dataviz, fennel,
fern, larch, laurel, madder, moss, osier, sedge, sorrel, tansy, teasel, thistle, thrift, yew) form
one family — almost certainly per-bundled-skill enablement, given `…_dataviz` sits among plant names
matching the shipped skills. **INFERRED.**

---

### Deltas vs the February parity rows

Rows below are from `docs/parity/01-entrypoint-bootstrap.md` and
`docs/parity/02-settings-schemas-migrations.md`. Only rows where the binary contradicts or
materially extends the Feb snapshot are listed.

| row | Feb claim | 2.1.251 binary | impact |
|---|---|---|---|
| 01.4 | entrypoint identity: `sdk-ts` vs `cli` vs `github-action` | the resolver recognises **9** identities (`github-action`, `sdk-typescript`, `sdk-python`, `sdk-cli`, `claude-vscode`, `local-agent`, `claude-desktop`, `remote`, `cli`) and infers `remote` from three token env vars, not just `CLAUDE_CODE_ENTRYPOINT` (747889) | telemetry + behaviour branches keyed on identity are wider than the row assumes |
| 01.7 | `extraArgs` is the escape hatch for boot flags "not surfaced as a typed Option" | the untyped surface is **43 hidden flags** including `--managed-settings`, `--session-mirror`, `--resume-session-at`, `--resume-drops-turn`, `--reply-on-resume`, `--append-subagent-system-prompt`, `--plan-mode-instructions`, `--task-budget`, `--workload`, `--teammate-mode`, `--agent-{id,name,color,type}`, `--forward-home-settings`, `--correlation-id`, `--on-branch` | a replication target should treat these as first-class, not exotic |
| 01.13 | effort `low/medium/high/max`; SDK adds `xhigh` | the CLI's own `effortLevel` settings enum is `["low","medium","high","xhigh"]` (111638) — **no `max`** | the Feb row's level list is stale |
| 01.14 | budget limits | `--max-budget-usd` is now **visible** (not hidden) while `--max-turns` and `--task-budget` are hidden | minor, but affects "what users can discover" |
| 01.30 | trust dialog / onboarding is REPL-only | confirmed, plus the exact mechanism: trust is `~/.claude.json → projects[<dir>].hasTrustDialogAccepted` with an **ancestor walk to the git root** (311176), and `CLAUDE_CODE_SANDBOXED` short-circuits it | a headless replication can pre-seed trust deterministically |
| new (01.x) | — | `--restricted` / `CLAUDE_CODE_RESTRICTED` did not exist in Feb. It removes shell/code-execution tools + WebFetch, confines file tools to working dirs, refuses `bypassPermissions`, **and empties the settings-source list** (184972) | a whole permission posture the parity table has no row for |
| new (01.x) | — | `--safe-mode` / `CLAUDE_CODE_SAFE_MODE` and `--bare` / `CLAUDE_CODE_SIMPLE` are new boot postures | ditto |
| new (01.x) | — | `--init`, `--init-only`, `--maintenance` run Setup hooks with distinct triggers | boot-lifecycle surface absent from the table |
| 02.1 | precedence "user/project/local" | full order is **user < project < local < flag < policy** (80769); `--setting-sources` restricts only the first three because flag+policy are force-re-added (209527) | the row omits the flag tier's position |
| 02.3/02.4 | managed tier = MDM/plist/registry, injected via `managedSettings` | the policy tier is a **five-way union**: MDM plist (two paths, per-user then device), HKLM+HKCU registry, `managed-settings.json`, `managed-settings.d/*.json` drop-ins, and remote/org settings — plus a WSL bridge that shells `/mnt/c/Windows/System32/reg.exe` | "OS policy" is much larger than a plist read |
| 02.4 | — | `CLAUDE_CODE_MANAGED_SETTINGS_PATH` **is inert in the production build** (`yEn()` folds to `return;`, 209573) | don't plan a test harness around it |
| 02.15 | migrations "run automatically … no API surface" | correct, and now enumerable: **12 ordered migrations behind `migrationVersion = 13`**, with an all-or-nothing version bump so a failed write re-runs the whole set (748175) | replication needs the same idempotence discipline |
| 02.16 | model-alias migrations (sonnet/opus 1m, fennec, legacy) | the current set is sonnet[1m]→sonnet-4-5, legacy-opus→opus, sonnet-4-5→sonnet, opus→opus[1m], plus a generic alias table. The "fennec" migration is gone | list is stale |
| 02.20 | auto-updater keys | `autoUpdatesChannel` enum is `["latest","stable","rc"]` in the schema but the installer **rejects `rc`** (`"Invalid channel: rc. Use 'stable' or 'latest'"`, 48250) and the UI relabels it "slow"; Homebrew ignores the setting entirely and channels by cask name | the setting is not the whole story |
| new (02.x) | — | Statsig is gone; flags are GrowthBook, cached in `~/.claude.json` (`cachedGrowthBookFeatures`), 360-min refresh | any "gate" emulation should target this shape |
| new (02.x) | — | 165 top-level settings keys, ~30 of which are enterprise-governance keys (`strictPluginOnlyCustomization`, `allowManaged*Only`, `allowedMcpServers`, `strictKnownMarketplaces`, `disableSideloadFlags`, `requiredMin/MaximumVersion`, `modelPricing`, …) | the Feb table covers roughly a third of the surface |
| new | — | `claude config` and `claude migrate-installer` **no longer exist** | any parity row or doc assuming `claude config get/set` is wrong |

### Open questions

1. **Statsig-era dynamic configs.** `getDynamicConfig_*` and `cachedDynamicConfigs` survive in the
   global-config defaults (311022), but I did not find a live writer. Is the dynamic-config path
   still fed, or is it vestigial alongside `~/.claude/statsig`?
2. **`tengu_cobalt_plinth_*`.** Twenty flags in one family; I inferred per-skill enablement from the
   `_dataviz` member. Not read from the consumer side.
3. **`Fl()`** (the per-conversation feature-override map consulted in `l()`) — where does it come
   from? It reads like a server-supplied `stream_event`/init payload, but I did not trace its writer.
4. **Windows launcher.** I confirmed the POSIX symlink path and the copy fallback, but not how
   `claude.exe` avoids the "running executable is locked" problem beyond the
   `windows_running_exe_lock` failure hint.
5. **`rc` channel.** The settings enum allows it, the installer rejects it, and the `/config` UI
   labels it "slow". Which layer actually consumes `rc` — is there a separate internal fetch path?
6. **Bytecode.** Every chunk carries a `// @bun @bytecode` marker and a paired bytecode blob left in
   `payload.bin`. Whether the JS text is even parsed at runtime (vs. being a sourcemap/debug
   fallback) is unverified, and it matters for anyone trying to patch a shipped binary.
7. **`audio-capture` vendor path.** Line 121863 searches `vendor/audio-capture/<arch>-<os>[-musl]/`
   *outside* the bundle. Which code path uses the external copy instead of the embedded `.node`?
8. **`CLAUDE_CODE_HOVER_REST` / "storage v5".** The stub pins a storage backend from this env var
   before anything else runs. The v5 storage abstraction (`pinStorageV5`, `hostFiles.serves("system")`,
   folder-listing attestation in `settingsPrime`) looks like a host-served virtual filesystem for
   Desktop/Cowork embedding — its contract is worth a chapter of its own and I only skimmed it.
