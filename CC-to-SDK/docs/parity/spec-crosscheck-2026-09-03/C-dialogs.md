# Lane C — §41.19–§41.28 (statusLine · notifications · title · dialogs · transcript · paste/copy · terminal-setup · /config · diagnostics)

Spec read: `/Users/new/.claude/jobs/4b30d1a4/tmp/spec257/41-tui-rendering.md:5990-8983`.
Bundles used for verification: `~/claude-code-bundle/2.1.251/cli.pretty.js` (our canon target) and
`~/claude-code-bundle/2.1.257/cli.pretty.js`. Cites to 251 are plain `L<line>`; cites to 257 use the
spec's `[chunk-*.js:LINE]` form.

Repo root for our side: `/Users/new/Developer/GitHub/somersault/CC-to-SDK/`. §§0–6 were first written
against the frozen pre-bl10 checkout at `.../codex_somersault/CC-to-SDK/`; **every cite has since been
re-verified against somersault and corrected in place** — see **§7** for the full ledger of what moved,
what was withdrawn, and two corrections that exist only in the shipped bl10 code (C11, C12).

---

## 0. Top takeaways

1. **The terminal title's busy prefix is the wrong glyph pair, and two whole gates are missing.**
   We animate braille `⠂`/`⠐`; 2.1.251 animates `◐`/`◑`, holds a **static `✳` under any multiplexer**
   (gate default-on) and **freezes the frame when the terminal loses focus**. Verified in the binary,
   not a 257-only hop. → §1 C1.
2. **The statusLine payload is missing eight field groups that 2.1.251 already emits, and `resets_at`
   is the wrong type.** We send ISO strings where every canon consumer (and canon's own documented
   schema) says Unix epoch seconds; `workspace.repo` / `workspace.git_worktree` are pure local git
   reads we could ship today. → §1 C2, §3.
3. **The statusLine child process is missing four environment variables canon sets** (`CLAUDECODE=1`,
   `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_PID`) — a script written for
   Claude Code that keys off any of them silently does nothing under `ccx`. → §1 C3.
4. **Our dialog frame indents its body 1 column; canon indents 2.** One constant, every
   permission/plan/consent dialog, and bl10's shell inherits the number. → §1 C4.
5. **The `/config` Config tab is the largest single specified gap**: canon groups ~60 rows into eight
   named sections with a per-row writer target and a `→ settings.json` migration marker; ours is a
   flat list of ten. The spec plus 2.1.251 `L759927`/`L759934` give the whole registry verbatim. → §3.
6. **`/terminal-setup` is entirely unbuilt** and the spec supplies every payload, path and outcome
   string byte-for-byte (§41.25). This is the K40 `shift+enter` row's other half. → §3.
7. **Two whole command-hook settings we have never modelled**: `subagentStatusLine` (JSONL per-task
   decoration) and `fileSuggestion` (replaces the `@`-mention file index). → §2.

---

## 1. Corrections — things we built that canon does differently

### C1. Terminal title: wrong busy glyphs, no multiplexer pin, no focus freeze — **verified**

**We do** (`harness/src/tui/terminalTitle.ts:46-49`, `:100`, `:120`):
```
TERMINAL_TITLE_BUSY_FRAMES = ["⠂", "⠐"]     // U+2802 / U+2810
```
animated unconditionally at 960 ms whenever `setBusy(true)` and reduced motion is off.

**Canon does** (§41.21.3; verified at **2.1.251 L167992-L168002**):
```js
var sB = ["◐", "◑"], lB = "✳", uTe = 960;
...
let Utt = t5e() !== null && I("tengu_static_title_under_mux", !0), KMo = Ba();
ko(jtt, Btt || Ott || Utt || !Ltt || !KMo ? null : uTe);
let JMo = Ltt && !Utt ? sB[QMo] ?? lB : lB;
```
Three deltas:
* Glyphs are `◐` (U+25D0) / `◑` (U+25D1), not braille. Our braille pair is 2.1.220's `dhi`
  (`~/claude-code-bundle/2.1.220/cli.pretty.js:549863`) — it changed **before** 2.1.251, so this is a
  stale transcription against our own canon target, not a 251→257 hop.
* `Utt` — under tmux/screen/zellij with `tengu_static_title_under_mux` (**default true**) the interval
  is nulled *and* the selector returns the static `✳`. In every tmux pane canon shows `✳ <title>`;
  we alternate braille.
* `KMo = Ba()` is `isTerminalFocused`. Canon stops the interval on focus-out and the glyph **freezes
  at whatever frame it was showing**. We keep animating in an unfocused window, i.e. we keep writing
  an OSC 0 every 960 ms into a terminal nobody is looking at.

`docs/parity/tui-ux.md:2235` currently records the braille pair as canon-faithful and names only two
missing arms (`terminalTitleFromRename`, kitty ST terminator). Three more belong on that row.

### C2. statusLine payload: `resets_at` unit + eight missing field groups — **verified**

**We do** (`harness/src/tui/statusLine.ts:409-419`, `:462-470`):
`rate_limits.{five_hour,seven_day}.resets_at` is `string | null` (the SDK's ISO timestamp), and the
payload carries `session_id · transcript_path · cwd · prompt_id · effort · session_name · model ·
workspace{current_dir,project_dir,added_dirs} · version · output_style · cost · context_window ·
exceeds_200k_tokens · fast_mode · thinking · rate_limits`.

**Canon** (2.1.251 **L157272**, the whole builder on one line; §41.19.3):
* `resets_at` is a **number, Unix epoch seconds** — canon's own store rounds it
  (`L436513`: `{ utilization: Number(u), resets_at: Math.round(Number(d)) }`) and the documented
  schema says `"resets_at": number // Unix epoch seconds` (spec :6109). A script doing
  `date -r "$(jq .rate_limits.five_hour.resets_at)"` — the shape the setup agent teaches — breaks on
  ours. Fix is one line: `Math.floor(Date.parse(iso)/1000)`.
* Missing keys, all present in **2.1.251**, not 257-only:

  | Key | Canon source | Reachable for us? |
  |---|---|---|
  | `workspace.git_worktree` | `...de && { git_worktree: de }` L157272 | **Yes** — local `git rev-parse`. |
  | `workspace.repo {host,owner,name}` | `...pe && { repo: pe }` L157272 | **Yes** — parse `git remote get-url origin`. |
  | `rate_limits.spend_limit` | `...Ne()==="gateway" && kt.overage && {...}` L157271 | Gateway-only; N/A for us. |
  | `prompt_cache` (12 fields) | `...sqe()` L157272 | ❌ no SDK surface for cache warmth. |
  | `remote.session_id` | `...Gr() !== null && {...}` L157272 | N/A. |
  | `pr {number,url,review_state?,kind?}` | `...Re && {...}` L157272 | ❌ no PR model yet (footer has none either). |
  | `worktree {...}` | `...Ve && {...}` L157272 | Only if we grow a `--worktree` mode. |
  | `vim.mode` / `agent.name` | L157272 | N/A (no vim, no `--agent`). |
  | `scratchpad_dir`, `agent_type` | shared hook base, §41.19.3 :6232-6234 | ❌ no SDK surface. |

  `docs/parity/tui-ux.md:389` lists only six absent keys (`vim`, `fast_mode`, `agent`, `remote`, …)
  and `fast_mode` is now built; the four rows above marked **Yes / ❌ no SDK surface** are new.
* Spec §41.19.3 :6300 also records a canon quirk worth pinning so we don't "fix" it: **`agent.type`
  is documented but never emitted** — the real field is a top-level `agent_type`.

### C3. statusLine child environment is missing four variables — **verified**

**We do** (`harness/src/tui/statusLine.ts:161-166`): `{...process.env, CLAUDE_PROJECT_DIR, COLUMNS, LINES}`.

**Canon** (§41.19.4 :6343; 2.1.251 hook runner `Nq` at **L494775-L494779**, extra env at **L431800**):
```js
{ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: e.sessionId, CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_PID: String(process.pid) }
```
merged over a credential-scrubbed `process.env` (`Na()` L854868 — deletes `CLAUDE_CODE_OAUTH_TOKEN`,
`CLAUDE_CODE_ARTIFACTS_API_TOKEN`, `CLAUDE_CODE_SLACK_TAG_TOKEN` and the base-URL family, and only
when any of its triggers fire; it is **not** a general secret scrub, so `ANTHROPIC_API_KEY` is
inherited in canon too). User-visible: a statusLine script that branches on `CLAUDECODE` (the
documented "am I inside Claude Code" marker) or reads `CLAUDE_CODE_SESSION_ID` gets nothing from us.
Also worth adopting the three token deletions — our statusLine currently hands the user's OAuth token
to an arbitrary shell command from the settings file.

### C4. Dialog frame body padding is 1; canon's is 2 — **verified**

**We do** (`harness/src/tui/dialogs/DialogFrame.tsx:133`, `:139`; the default is declared at `:87`
and destructured at `:115`): header `paddingX={1}`, body `innerPaddingX = 1`.

**Canon** (§41.22.7 :7263; 2.1.251 **L568795**, used at **L568813**):
```js
var sv = 2, Ix = 1, av = 2;
...
oe = e(o, { flexDirection: "column", paddingX: sv, children: G });   // normal
H = e(o, { flexDirection: "column", paddingX: Ix, flexShrink: 0, children: G }); // Ua() — constrained viewport
```
So: **2** columns normally, dropping to **1** *and losing the rule entirely* in a constrained viewport.
We ship the constrained form as the only form. Every permission, plan, consent and bl10 dialog is one
column narrower-indented than canon. bl10's `me`-alignment work is the right place to fix it, and it
should also add the constrained arm (which we currently have no equivalent of at all).

One smaller `me` prop delta while you are there: canon's `isCancelActive: false` swaps in a *static*
default footer rather than dropping the binding silently — we have no equivalent. (canon's `titleEnd`
dim + `wrap:"truncate-start"` rule, §41.22.7 :7279, **is** met by bl10 at `DialogFrame.tsx:124`.)

### C5. statusLine refresh: two triggers we do not have — **spec-only (257 cites), design-relevant**

`harness/src/tui/statusLine.ts:263-320` implements mount-run, `poke()` and the `refreshInterval` poll.
§41.19.5 lists five triggers; the two we lack:
* **Reset deadline** — after each payload build canon arms a one-shot timer for the moment the
  soonest rate-limit window or prompt-cache entry expires, **plus 1000 ms** (`Y4t`,
  `[chunk-bq8epagv.js:409031]`, `:409173`). Without it a script printing "5h: 92%" keeps printing 92%
  after the window resets until some other input happens to fire.
* **Command-text change** — an immediate, *un-debounced* run when `statusLine.command` itself changes,
  which also re-arms the telemetry latches `[chunk-bq8epagv.js:409132]`.

Also §41.19.5 :6396 gives canon's exact trigger set `e8t = ["tokenUsage","permissionMode","vimMode",
"mainLoopModel","fastMode","effortValue","thinkingEnabled","prStatus"]` **plus a new assistant
message** — our doc comment at `statusLine.ts:250` lists the same set with `lastAssistantMessageId`
substituting for the message trigger and `vimMode` correctly absent. Good match; worth re-citing to
251/257 since the comment cites 2.1.220 line numbers.

### C6. Notification divergences already recorded, plus one not recorded

`harness/src/tui/desktopNotify.ts` matches §41.20 closely (channels, `auto` table, three escape
families, raw bell). Recorded-and-fine: monotonic kitty ids (`:121`), the synchronous Apple Terminal
arm (`:94`), the ghostty `;`→`:` title substitution (`:153`), the narrowed default event set (`:48`).
**Not recorded:** canon's iTerm2 body is `title: message` only *when a title is present*, otherwise the
**bare message** (`[chunk-f57d96nb.js:497774]`, `let m = p ? \`${p}: ${o}\` : o`). We always prefix
`ccx: ` because `title` defaults to `NOTIF_TITLE` (`:123`). Harmless today; it becomes a real
divergence the moment a caller wants an untitled notification.

Also: our permission notification fires immediately (`harness/src/tui/useChat.ts:2182`). Canon has
**two** paths and only one of them is immediate — the terminal-channel one, on dialog reveal
(2.1.251 `L168536`, `CI` → `qb(message, "permission_prompt")`); the *`Notification` hook* one is
`setTimeout(…, 6000)` with an unref'd timer and a disposer, so a prompt answered inside six seconds
never fires the hook (`L521715-L521723`, `S3e = 6000` at `L445027`), and
`CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS` suppresses it entirely. That belongs to the
hooks lane, but the 6000 ms + disposer shape is worth knowing before we wire a `Notification` hook.

### C7. `/copy` copies but never offers, and writes no sidecar — **verified in 2.1.251**

**We do** (`harness/src/tui/useChat.ts:2378-2396`): `/copy [N]` copies the Nth-latest assistant
message and posts `Copied to clipboard (${t.length} characters, ${lines} lines)` — canon's exact
summary line.

**Canon** (§41.24.6; 2.1.251 **L320210**, **L320236**): `/copy` opens a **picker** offering the full
response plus **one entry per fenced code block**; the full entry is labelled `Full response` with the
description `<n> chars, <m> lines`. Selecting one copies it **and writes a sidecar file** (dir mode
`0700`, file UTF-8, extension from the block's language, default `.txt`), then returns:
```
Copied to clipboard (${t.length} characters, ${i} lines)
⚠ ${u}; the file below is unaffected      ← only when the clipboard write failed
Also written to ${d}
```
A `copyFullResponse` global-config flag (labelled `Skip the /copy picker` in `/config`) skips the
picker — which is effectively the mode we ship as the only mode. `docs/parity/tui-ux.md:438` already
holds `/copy` at 🟡 for `/copy N`, which is now closed; the picker + sidecar are the residue and were
not named.

### C8. Transcript screen: our pager is a different animal — **known, but three specifics are new**

`harness/src/tui/TranscriptPager.tsx` is a bordered overlay in the composer slot with the hint row
`j/k ↑↓ line · Ctrl-U/D ½page · Ctrl-B/F b/space page · g/G top/bottom · Ctrl-E … · q/Esc close`
(`:57-58`). `docs/parity/tui-ux.md:799-806` already records the overlay-vs-screen divergence and the
absent in-pager search. Three things the spec adds that the scorecard does not have:
* **Transcript mode forces verbose rendering** — the message list ORs its verbose flag with
  `screen === "transcript"` (§41.23.2 :7642, `[chunk-bq8epagv.js:394315]`). Our pager's two
  projections are `detail-all` / `detail-collapsed`, which is close but is a *local* fold flip, not
  the settings-level verbose flag.
* The bottom bar is **one of three** — search bar, help panel, or hint bar — and the hint bar has a
  documented degrade: full form
  `dialog waiting · Showing detailed transcript · ctrl+o to toggle · ↑↓ scroll · v to open in editor · ? for shortcuts`,
  collapsing to a bare `? for shortcuts` when it does not fit, with a right-aligned `verbose ` badge
  (`YJ = "verbose "`, `QJ = 2`, `[chunk-bq8epagv.js:395450]`, `:395457`).
* The `?` help panel is a **two-column legend of twelve entries** (§41.23.2 :7672) — that is the
  content spec for a surface we do not have.

### C9. Hint key-name grammar mixes canon's three columns

`harness/src/tui/keys/hints.ts:36-39` prints `enter → ⏎`, `backspace → ⌫`, `delete → Del`,
`pagedown → PgDn` in what it calls the title grammar. Canon's table (§41.22.10 :7451) is three
columns — `title / lower / glyph` — and `⏎`/`⌫` are the **glyph** column; the title column is
`Enter`/`Backspace`/`Delete`/`PageDown`. Our `LOWER_NAMES` table (`:66-69`) matches canon's lower
column exactly. This is a documented deliberate divergence in our header, so it is a "know the real
table" item rather than a bug — but if the bl10 keyhint bar wants canon-exact strings, the three-column
table plus the `default`/`compact`/`symbol` presets (`[chunk-7ycjby1h.js:319866]`) are what it needs.

### C10. `pasteCache.ts`'s header is stale (doc-only)

`harness/src/tui/pasteCache.ts:13-14` says the write is "called from a keystroke handler". It is not
any more — `harness/src/tui/promptHistory.ts:113` is the only call site, gated on
`PASTE_INLINE_MAX = 1024` (`:47`). That is **exactly** canon's shape (§41.24.2: spill at history-write
time, `SGr = 1024`, verified at 2.1.251 **L36333** `var M = 100, Ee = 1024, …`). The code is right;
the comment misdescribes it.

---

## 2. Unknown unknowns — specified canon behaviour with no scorecard row

1. **`subagentStatusLine`** (§41.19.10, `[chunk-bq8epagv.js:409607]`). A second command setting that
   decorates each running task row. It does **not** go through the hook runner: direct shell-out,
   5000 ms timeout, input = hook base + `columns` + a `tasks[]` array, output is **JSONL** —
   one `{ id, content }` per line, malformed lines logged and skipped. Cadence: first tick at 300 ms,
   then every 5000 ms, re-entrancy-guarded. **Reachability: good** — it is a local subprocess over
   data our `TaskPanel` already has. Our only mention of the key is
   `harness/src/appserver/configDomain.ts:202` as a pass-through settings name.

2. **`fileSuggestion`** (§41.19.8, `[chunk-1kg58a1a.js:150224]`). `{ type:"command", command }`; the
   `@`-mention picker pipes the hook base plus a `query` field and reads one path per line. When
   configured it **replaces the built-in file index entirely**, capped at 15 suggestions in the
   command's own line order; `AbortSignal.timeout(5000)`; abort or non-zero exit both return `[]`
   silently. **Reachability: good** — our `fileComplete.ts` owns the index it would replace.
   Currently only a name in `configDomain.ts:187`.

3. **The dialog store's placement semantics** (§41.22.5). We mount through `overlayChain` +
   `useChat` state fields (bl10 D4 explicitly defers the registry). What the spec documents and we
   have no analogue for: `place:"under"` (unshift instead of push — queue behind what the user is
   already looking at), `holdsTop` (only `mcp_elicitation`), `succeeds`, `hideWhile` (default
   `["panel"]`), `shownAt` → a **150 ms input grace period**, and `revealSeq` (bumped when the dialog
   above closes, to re-fire per-reveal hooks). The suppression ladder is four-valued in priority
   order: `progress > panel > draft > typing` (`[chunk-bq8epagv.js:399728]`). Reachability: entirely
   client-side; nothing needs SDK data.

4. **The `draft` placeholder strings** (§41.22.5 :7198). A dialog suppressed because the user is
   mid-draft renders a dim placeholder instead of vanishing:
   `Claude has a question for you — it shows once you send or clear what you're typing.` and
   `Claude has a suggestion for you — it shows once you send or clear what you're typing.`
   We simply queue or drop. This is a real UX affordance with no row.

5. **`local_jsx` mount/unmount resolution** (§41.22.2). The dialog promise resolves `"closed"` when
   programmatically aborted and `"dismissed"` when the user escaped, and three flags differ per call
   site — most notably **a slash command typed mid-turn keeps the prompt live (`hidesPrompt:false`)
   where the same command at rest hides it**, and `retireAtTurnBoundary` closes opted-in dialogs at
   three points in the query pipeline. Our dialogs are uniformly pane-owning.

6. **`viewMode` / `verbose` / `defaultView` / brief-mode resolution chain** (§41.23.4-5). Four-step
   precedence: `--verbose` flag > `settings.viewMode === "verbose"` > `Cfe()` forcing false >
   the settings cascade (`[chunk-chr1kh62.js:454166]`). Plus `/brief` (`isBriefOnly`), `/focus`
   (`briefTranscript`), `CLAUDE_CODE_BRIEF`, gate `tengu_kairos_brief`, and the streaming-preview
   hold selector `Nse(screen, isBriefOnly, briefTranscript) → "hidden"|"focus"|"none"`.
   `docs/parity/tui-ux.md:545` has a ❌ row for brief/focus but not for the resolution chain or for
   `verbose`/`viewMode`/`defaultView` as settings.

7. **The visible-input truncation placeholder** (§41.24.1 :7809). Above `rat = 1e4` visible
   characters the composer folds the middle into `[...Truncated text #N +M lines...]`, keeping
   `rU/2 = 500` chars of head and 500 of tail. Verified at 2.1.251 **L159358** (`var jpe = 1e4, DT = 1000`)
   and **L159362**. We *recognise* the species (`pasteChips.ts:61`, `:84`) but produce it nowhere —
   `promptHistory.ts:166` says so in as many words. Purely local; nothing blocks it.

8. **The on-disk image cache** (§41.24.3). `<configDir>/image-cache/<sessionId>/<pasteId>.<subtype>`,
   mode `0600`, `datasync`ed, in-memory path map capped at 200 FIFO, and eviction that is
   **session-scoped rather than age-scoped** — the sweep `rm -rf`s every session directory except the
   current one. We keep pasted images in memory only (`harness/src/tui/clipboardImage.ts` has no
   persistence). The consequence is the same one text pastes have: an `[Image #N]` recalled from a
   transcript written by an earlier process can never be re-expanded.

9. **No age eviction for our paste cache.** Canon sweeps `<configDir>/paste-cache/*.txt` and
   `*.txt.tmp.*` by mtime against `cleanupPeriodDays` (§41.24.2 :7921). `pasteCache.ts` writes and
   never deletes; `CCX_FLEET_ROOT/paste-cache` grows without bound. (Our only sweeps are
   `harness/src/host/imageStaging.ts`'s orphan sweep and the host session retention.)

10. **`/statusline` + the `statusline-setup` agent** (§41.19.7, §41.19.2). A `prompt`-type command
    with `allowedTools: [Agent, "Read(~/**)", "Edit(~/.claude/settings.json)"]` dispatching a built-in
    sonnet agent whose system prompt **is** the user-facing stdin contract. We have no `/statusline`.
    Reachability: good — it is a subagent dispatch with a fixed prompt.

11. **Policy substitution + safe mode for `statusLine`.** `Qbe(e) { return T_() ? be("policySettings")?.statusLine : e }`
    (§41.19.1 :6013) and the `/statusline` safe-mode refusal template (§41.19.7 :6529). We have no
    policy tier; worth knowing the shape before one is added.

12. **The `/config` accessibility form** (§41.26.3 :8672). Under accessibility mode the row list is
    replaced by a numbered form: `Enter a number to change [1-N], or <key>:` /
    `Invalid selection "<x>". Enter a number between 1 and N.` We have no accessibility arm for any
    dialog.

13. **Console/stderr capture** (§41.27.1). `patchConsole` replaces all 17 console methods (two groups,
    `lx` at default level and `ax` at warn/error) and wraps `process.stderr.write` so a write **marks
    the previous frame contaminated and schedules a repaint** in the alternate screen. Our fullscreen
    renderer has no such contamination hook; a stray stderr write from a dependency corrupts the frame
    until the next natural repaint. Worth a Wave-R-adjacent row.

14. **Frame/debug telemetry env switches** (§41.27.2-4). `CLAUDE_CODE_FRAME_TIMING_LOG`,
    `CLAUDE_CODE_FRAME_TIMING_SAMPLE_EVERY`, `CLAUDE_CODE_BENCH_LIVE_COUNTS`,
    `CLAUDE_CODE_DEBUG_REPAINTS`, `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT`,
    `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL`, `CLAUDE_CODE_NATIVE_CURSOR`. Diagnostics only, but
    `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT` and `CLAUDE_CODE_DEBUG_REPAINTS` are exactly the two levers
    the fullscreen wave hand-rolled ad hoc.

15. **`iTerm2` clipboard-access probe** (§41.25.6). `defaults read com.googlecode.iterm2
    AllowClipboardAccess`, written back as a boolean, with the instruction constant
    `iTerm2 → Settings → General → Selection → check "Applications in terminal may access clipboard"`.
    Our `harness/src/tui/clipboardCheck.ts` is a *different* probe (is there an image on the
    clipboard); the OSC-52-will-not-work-here diagnosis has no counterpart.

---

## 3. Known gaps now specified

### 3a. `/config` panel — `tui-ux.md:820-823` holds `/config` at 🟡; the spec closes the "what rows" question

**Ours** (`harness/src/tui/settingsRows.ts:59-68`): ten flat rows — `theme`, `model`, `outputStyle`,
`permissionMode`, `thinking`, `showTurnDuration`, `reduceMotion`, `progressBar`,
`promptSuggestionEnabled`, `copyOnSelect`. No sections, no writer targets, no policy-lock line.

**Canon** — §41.26.1-4 plus the 2.1.251 registry, verified at **L759927** and **L759934**:

```js
za = ["Appearance","Model & output","Display","Input & controls","Connections","Advanced","Experimental","Internal"]
kd = {
  Appearance: ["theme","language","reduceMotion"],
  "Model & output": ["model","fast","switchModelsOnFlag","autoContinueAtUsageLimit","outputStyle",
                     "defaultView","verbose","autoCompact","thinking","permissionMode","useAutoModeDuringPlan"],
  Display: ["autoScroll","progressBar","tips","turnDuration","prStatus","externalEditorContext"],
  "Input & controls": ["editor","askUserQuestionTimeout","modelProposedGoals","copyOnSelect",
                       "promptSuggestionEnabled","agentsView","checkpoints","workflows",
                       "workflowKeywordTriggerEnabled","artifacts"],
  Connections: ["notifChannel","inputNeededNotifEnabled","agentPushNotifEnabled","autoConnectIde",
                "autoInstallIdeExtension","diffTool","chrome","remoteControl","remoteHomeSettings",
                "dialogExpiry","crossSessionInbound","showExternalIncludesDialog","apiKey"],
  Advanced: oi.map(i => i.id),   // exactly ["autoUpdatesChannel","worktreeBaseRef","gitignore","copyFullResponse","recap"]
  Experimental: ["precomputeCompactionEnabled","timestamps","showStatusInTerminalTab","teammateMode"],
  Internal: ["snipEnabled","snipDebug","doneMeansMerged","autoUploadSessions",
             "autoAddRemoteControlDaemonWorker","autofixPrMode"]   // dead in this build
}
```
Points the spec settles that we would otherwise guess at:
* **Only three row types exist**: `boolean`, `enum`, `managedEnum`. No number, no free text. A boolean
  renders the literal string `true`/`false` — no glyph, no on/off wording (§41.26.2 :8548). **Ours
  already matches** (`settingsRows.ts` uses `String(...)`).
* Four writer targets per row: user `settings.json`, local `settings.local.json`, single-key user
  write, and the global config store (§41.26.2 :8542). Ours writes everything to
  `harness/src/tui/prefs.ts` — that is a recorded divergence per-key but it means we have no place to
  express the `→ settings.json ` migration marker or the policy-lock reason line.
* The `Advanced` header always reads `ADVANCED — MOVING TO SETTINGS.JSON` (the plain `ADVANCED` arm is
  unreachable in this build — §41.26.1 :8524).
* Label column width = `min(44, max(14, availableWidth - 16))` (§41.26.3 :8634). Compare our
  `SETTINGS_ROW_INSET = 6` in `SettingsDialog.tsx:125`/`:190`, which solves a different (real) problem.
* Search placeholder `Search settings…`, empty state `No settings match "<q>"`, indicators
  `↑ N more above` / `↓ N more below` — **ours match** (`select/overflow.ts:17`).
* Three footer states and the **lock-dependent first chord** (§41.26.3 :8645-8663): not locked →
  `enter/space to change`; locked with `source === "policy"` → `enter/space to **retry**`; locked with
  any other source → the chord is **omitted entirely** and the footer starts at `/ to search`.
  Since bl10 our Settings footer is the derived keyhint bar (`SettingsDialog.tsx:78-84`); only
  `SEARCH_FOOTER` remains a literal (`:88`), deliberately. Canon's `↑ to tabs` is still not
  advertised — a divergence tied to the header-focus split we deferred as bl10 D3, and the spec
  confirms that split is exactly what makes `↑ to tabs` honest.
* Activation: enter, space, **left, right and tab** all activate the focused row; any printable key
  seeds the search box; a plain enum **cycles** `(index+1) % options.length`; a `managedEnum` opens a
  sub-dialog (§41.26.4). Ours cycles enums via `cycleEnum` — match.
* On close the panel emits a system message: `Set theme to <name>`, `Set editor mode to <mode>`, an
  enabled/disabled line for auto-compact, or **`Config dialog dismissed`** when nothing changed
  (§41.26.4 :8694-8698). Our `summarizeChanges` prints `Set Model to <value>` — same family; the
  no-change literal is worth pinning.
* Inline warning under the thinking row:
  `Changing thinking mode mid-conversation will increase latency and may reduce quality.`
  (§41.26.3 :8668) — we have `THINKING_WARNING` in `settingsRows.ts`; worth a byte check.

**Nearest-term additions with an existing implementation and no row**: `notifChannel` (we ship
`preferredNotifChannel` + `notifEvents` in `prefs.ts:79` with **no `/config` surface at all** — the
channel is only settable by hand-editing `prefs.json`), and `showStatusInTerminalTab` (canon's own row
is gated by `tengu_terminal_sidebar`, default false).

**251→257 hop**: 257 adds `timeFormat` to `Display` (§41.26.2 :8580, :8498). 251's `Display` has no
`timeFormat`.

### 3b. `/terminal-setup` — `tui-ux.md:2063` (K40) holds the receiving half at 🟡; §41.25 supplies the installer

Everything needed is verbatim in §41.25:
* Eligibility predicate `Qae()` — `darwin && Apple_Terminal || vscode || cursor || windsurf ||
  alacritty || zed` (:8131). **The guard is not a multiplexer test** — the "exit tmux" help text is
  printed for *any* terminal outside that set (:8403).
* The native-Shift+Enter name map (ghostty/kitty/iTerm2/WezTerm/Warp/Windows Terminal) (:8139).
* Remote-editor refusal by `.vscode-server`/`.cursor-server`/`.windsurf-server`/`.devin-server` in the
  path (:8154).
* VS Code family: settings dir per platform, `VSCode → Code`, `Devin Desktop → Devin` (fallback
  `Windsurf`); the exact `keybindings.json` object
  `{key:"shift+enter", command:"workbench.action.terminal.sendSequence", args:{text:"\x1B\r"}, when:"terminalFocus"}`;
  backup to `<path>.<4 random hex bytes>.bak`; the two extra `settings.json` edits
  (`terminal.integrated.mouseWheelScrollSensitivity = 3`,
  `terminal.integrated.gpuAcceleration = "off"`) and their five outcome strings (:8214-8257).
* Apple Terminal: plist path, two PlistBuddy `Add`-then-`Set` operations
  (`useOptionAsMetaKey bool true`, `Bell bool false`), both `Default Window Settings` and
  `Startup Window Settings`, the macOS ≥ 27 and screen-reader suppression conditions, the restore
  (`defaults import` + `killall cfprefsd`), and all seven outcome strings (:8260-8341).
* Alacritty TOML payload + idempotence check; Zed `keymap.json` with `["terminal::SendText","\x1B\r"]`
  and its XDG-only-on-Linux path rule (:8343-8387).
* The unsupported-terminal help template verbatim (:8424-8438), the iTerm2-over-SSH addendum, and the
  onboarding prompt `Use Claude Code's terminal setup?` with buttons
  `Yes, use recommended settings` / `No, maybe later with /terminal-setup` (:8474).
* One behavioural trap to reproduce or deliberately not: `shiftEnterKeyBindingInstalled: true` is
  persisted **whenever the terminal is in `vt`**, including remote sessions where nothing was written;
  only `zed` can veto it (:8171-8199).

### 3c. Tab status (OSC 21337) — `tui-ux.md:2238` scores ❌; the spec says **canon emits nothing**

§41.21.5: the palette, the encoder and the clear string all exist, but the capability predicate is
hard-coded false —
```js
function aXe() { return !1; }
```
`[chunk-wt8jnma3.js:784808-784810]`. So **no build emits a tab-status sequence.** Our ❌ is de facto
parity; the row should be re-marked 🚫/N-A rather than a gap, which is a free point of accuracy in
§3's denominator. (The `showStatusInTerminalTab` `/config` row does exist and is gated by
`tengu_terminal_sidebar`, default false.)

### 3d. Desktop notifications — `tui-ux.md:2237` holds 🟡 on "canon's `Yxu` event inventory is larger"

The spec names the inventory (§41.20.1 :6595): 14 types —
`permission_prompt, idle_prompt, auth_success, elicitation_dialog, agent_needs_input, agent_completed,
elicitation_url_dialog, worker_permission_prompt, push_notification, computer_use_enter,
computer_use_exit, quota_auto_resume_fired, quota_auto_resume_stale, quota_auto_resume_disabled` —
and §41.20.6 gives every message text. Of those, the ones we could observe today are
`auth_success` (`Claude Code login successful`) and the two `agent_*` we already ship. The rest name
features we do not have. That is enough to close the "larger inventory" arm as *mostly unreachable*
rather than leave it open.

### 3e. Terminal title — `tui-ux.md:2235` names two missing arms; the spec names four more

Beyond C1's three: `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` has **six** functional read sites in canon,
not one (§41.21.4 :8944), and it deliberately does **not** cover the FleetView attach path, which
writes OSC 0 unconditionally. Also: `/resume` sets the title to `claude · resume`
(`[chunk-gknwc3xw.js:526823]`), and an attached background job writes its state into the title
(`[chunk-stanqxmj.js:695517]`) — two surfaces where we set nothing.

---

## 4. Verbatim assets worth pinning

We do not have these verbatim anywhere in the repo (checked by grep):

| Asset | Where | Why |
|---|---|---|
| The `statusline-setup` agent system prompt — **the** user-facing stdin contract | spec §41.19.2, `41-tui-rendering.md:6028-6191` | If we ever ship `/statusline` this is the whole feature; it also documents fields we do not emit. |
| ~~The keyhint action→description registry `Ye`~~ **— already shipped by bl10** at `harness/src/tui/dialogs/keyhints.ts:18-43`. Residual: canon's `confirm:nextField`/`confirm:previousField`/`confirm:toggle`/`app:toggleReplTab` + five `app:*diff*` rows, omitted by design | 2.1.251 **L568825** | Keep the full line on file for when those actions get registered. |
| The three-column key-name table `L` + modifier table `T` and the `default`/`compact`/`symbol` presets `A` | `[chunk-7ycjby1h.js:319866]`, `:319894`; spec §41.22.10 :7438-7482 | Canon-exact hint strings if we want them. |
| The `figures` Unicode/ASCII table (12 fallback pairs + the shared box-drawing family) and the five-state status table `est` | `[chunk-6zzgwqxb.js:297532]`, `[chunk-1a9yt55g.js:6457]`; spec §41.22.12 | We ship only `tick` (`harness/src/tui/figures.ts:18`) and `POINTER` (`select/Select.tsx:37`). |
| The 23 keyboard-scope names **with their documented meanings** | `[chunk-1kg58a1a.js:112109]`; spec §41.22.11 :7540 | Our `keys/types.ts` scope set can be audited against it in one diff. |
| `/config` notification-channel labels with the dim wire-protocol suffixes (`iTerm2 (OSC 9)`, `Terminal Bell (\a)`, `Kitty (OSC 99)`, `Ghostty (OSC 777)`, …) plus the short forms `bell`/`iterm2+bell`/`none` | spec §41.20.7 :6827-6839 | Needed the moment a `notifChannel` row exists. |
| The whole `/terminal-setup` payload/string corpus | spec §41.25 | See 3b. |
| The `/config` row registry (id · label · type · writer · default) | spec §41.26.2 :8554-8615 + 2.1.251 L759934 | See 3a. |
| The dialog `draft`-suppression placeholders | spec §41.22.5 :7198 | Two strings, real UX. |
| `lGn` — the lost-paste removal notice: `<labels> is/are no longer available and was/were removed from the prompt` | `[chunk-1kg58a1a.js:47420-47423]` | We have `lostPasteLabel` (`promptHistory.ts:167`) but not this sentence. |
| The transcript help-panel legend (12 entries) and the full hint-bar string | spec §41.23.2 :7658-7675 | See C8. |
| `[...Truncated text #N +M lines...]` + `rat = 1e4` / `rU = 1000` | 2.1.251 **L159358**, **L159362**; spec §41.24.1 | See §2 item 7. |
| `/copy` picker labels + the three-line confirmation and its warning-only degrade | 2.1.251 **L320210**, **L320236**; spec §41.24.6 | See C7. |
| `No image found in clipboard. …` — **we already have this** (`keys/hints.ts:143-144`). Not needed. | — | — |

---

## 5. Confirmations — built and matching

* `statusLine` settings schema, including no `timeout` and no `type:"static"`, and the asymmetric
  `.catch(void 0)` on `refreshInterval` only (`statusLine.ts:87-100`).
* Every failure resolves to `undefined` and the row is **removed**; stderr goes only to the debug log;
  stdout normalisation is trim → split → per-line trim → drop empties → rejoin, with no line cap and
  no ANSI stripping (`statusLine.ts:137`, `:190-194`; canon 2.1.251 L496152-L496161 read line-for-line).
* 300 ms trailing debounce, poll ticks through the debounce, in-flight run aborted before each new
  run, 32-bit timer clamp, 600 000 ms hard timeout (`statusLine.ts:33-38`, `:224`, `:305-315`).
* Render: `padding` is horizontal only; each line is an independently truncated dim `Text`; the SGR
  of all preceding lines is re-prefixed onto each later line (`statusLine.ts:589-620` —
  `carryForwardSgr`/`forceDim` are canon's `m3f`/`wc` by a byte-level route).
* Mount gate `mode === "prompt" && !exitMessage.show && !isPasting && statusLineConfigured`, and a
  configured statusLine suppressing `? for shortcuts` (`Footer.tsx:178`, `footerModel.ts:33`).
* Fullscreen reserves a blank row for the unresolved statusLine (`tui-ux.md:538` D1) — canon's own
  single-space reservation, §41.19.6 :6473.
* Select primitive: default 5 visible, 8 chrome rows reserved, 0.6 label fraction, `❯` pointer with
  ASCII fallback, wrap-around navigation, `↑ N more above` / `↓ N more below`
  (`select/selectModel.ts:16-28`, `select/Select.tsx:37`, `:246`, `select/overflow.ts:17`) — matches
  §41.22.8's `Vs = 8`, `As = 0.6`, `[chunk-chcax9s1.js:446662]`.
* Dialog frame is a **single top rule, not a box**, with a `paddingTop:1` equivalent
  (`dialogs/DialogFrame.tsx:91-96`) — §41.22.7.
* Notification channel set, `auto` resolution table, iTerm2 OSC 9 / kitty triple OSC 99 with
  `d=0:p=title` → `p=body` → `d=1:a=focus` / ghostty OSC 777 / raw BEL, all DCS-wrapped except the
  bell (`desktopNotify.ts:37-43`, `:133-155`) — §41.20.1-3.
* Terminal title: OSC 0 BEL-terminated, ANSI stripped, 960 ms cadence, `sessionTitle ?? aiTitle ??
  name ?? fallback` precedence, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` as a full kill switch including
  the exit clear (`terminalTitle.ts:51-60`, `:92`, `:123-129`) — §41.21.1-4.
* Paste: `[Pasted text #N]` / `[Pasted text #N +M lines]` / `[Image #N]`, the four-species recogniser,
  the anchored `deleteTokenBefore` regex, atomic-token cursor motion, 800-char chip threshold,
  `max(0, min(rows-10, 2))` newline threshold (`pasteChips.ts:21`, `:47-84`) — §41.24.1.
* Paste cache: `sha256(content).slice(0,16) + ".txt"`, mode `0600`, spill **at history-write time**
  above 1024 characters (`pasteCache.ts:32-46`, `promptHistory.ts:47`, `:105-113`) — §41.24.2, and
  1024 verified at 2.1.251 L36333.
* Image paste: magic-byte media typing, drag-and-drop path species, the binary-garbage guard, and the
  clipboard-miss strings (`clipboardImage.ts`, `media/imageDims.ts`, `keys/hints.ts:143`) — §41.24.4.
* `Pasting…` and `paste again to expand` as footer strings replacing the hint row
  (`Footer.tsx:56-60`) — §41.24.5.
* `/copy N` indexing the recent-assistant ring with canon's `\n`-count-plus-one line arithmetic
  (`useChat.ts:2355-2371`) — §41.24.6's summary line.
* bl10's keyhint cap of 4 is canon's `Pe = 4` (2.1.251 **L568834**) — shipped at
  `dialogs/keyhints.ts:46` — and the `me`-derived frame prop list (`titleEnd`, `onCancel`, the auto
  hint bar) is shipped at `dialogs/DialogFrame.tsx:113-116` and matches §41.22.7.

---

## 6. Spec defects

1. **§41.19.4's shell row is wrong on POSIX.** The table says *"Shell | `bash`, or PowerShell on
   Windows without Git Bash"* `[chunk-he91yzga.js:539513]`. `UD()` does return `"bash"`
   (2.1.251 **L74782**), but that value only selects the *non-PowerShell branch*; the actual spawn on
   non-Windows is
   ```js
   let ns = Pe ? pr : !0;
   hn = Hwt(Lt, [], { env: gn, cwd: yn, shell: ns, detached: nt, windowsHide: !0, ... });
   ```
   — `shell: true`, i.e. **`/bin/sh -c`**, not bash. Verified identically at 2.1.257
   **cli.pretty.js:148764-148770** and 2.1.251 **L494806-L494812**. `bash` is only literal on Windows,
   where `ns` is the Git Bash path. Consequence for us: `harness/src/tui/statusLine.ts:130-133`'s
   `/bin/sh -c` is **correct**, and a "fix it to bash" reading of the spec would be a regression on
   Debian-family hosts where `/bin/sh` is dash.
2. **§41.26.2's row table is 257-shaped and should not be diffed against 2.1.251 as-is.** `timeFormat`
   is listed under `Display`; 2.1.251's `kd.Display` (**L759934**) is
   `["autoScroll","progressBar","tips","turnDuration","prStatus","externalEditorContext"]` with no
   `timeFormat`. Anyone implementing against 251 should drop that row. (`A5-cross-version-notes.md`
   §A5.11 is the place to check for the rest of the hop; I did not read it.)
3. **Minor, §41.19.4 :6347.** "Because the settings schema has no `timeout`, the effective hard timeout
   is 600 seconds" — true, but the paragraph then says the real bound is the `AbortController`, which
   the controller aborts "on the next scheduled run". With no `refreshInterval` and no input change
   there *is* no next scheduled run, so a hung command genuinely holds for the full 600 s. Our
   implementation arms its own unref'd 600 s timer (`statusLine.ts:207`), which is the same outcome by
   a more explicit route.

No contradictions found between the spec and our recorded pty evidence in this lane.

---

## 7. Re-verification against somersault (post-bl10)

I wrote §§0–6 against `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK` — the frozen
pre-bl10 checkout. Every item is re-checked below against
`/Users/new/Developer/GitHub/somersault/CC-to-SDK`. **All corrected line numbers are also fixed in
place above**; this section is the ledger of what moved.

**Byte-identical in both trees** (`cmp -s`, so every cite in those files stands unchanged):
`statusLine.ts`, `terminalTitle.ts`, `desktopNotify.ts`, `pasteCache.ts`, `pasteChips.ts`,
`promptHistory.ts`, `TranscriptPager.tsx`, `settingsRows.ts`, `Footer.tsx`, `footerModel.ts`,
`prefs.ts`, `figures.ts`, `select/Select.tsx`, `select/selectModel.ts`, `select/overflow.ts`,
`keys/hints.ts`, `copy.ts`, `clipboardCheck.ts`. That covers **C1, C2, C3, C5, C6, C8, C9, C10**,
§2 items 6–9 and 15, §3b–3e, and the bulk of §5 — all **unchanged**.

### Item-by-item

| Item | Verdict | Detail |
|---|---|---|
| **C1** terminal title glyphs / mux pin / focus freeze | **unchanged** | `terminalTitle.ts` identical in both trees; still braille `⠂`/`⠐`, still no `Utt`/`Ba()` gates. Cites `:46-49`, `:100`, `:120` stand. |
| **C2** statusLine payload | **unchanged** | `statusLine.ts` identical; cites `:409-419`, `:462-470` stand. |
| **C3** statusLine child env | **unchanged** | Cite `:161-166` stands. |
| **C4** dialog frame body indent 1 vs canon 2 | **unchanged, cites corrected** | bl10 rewrote `dialogs/DialogFrame.tsx` (106 → ~145 lines) but **did not change the padding**: header is still `paddingX={1}` (now **`:133`**, was `:97`), body still `paddingX={innerPaddingX}` with `innerPaddingX = 1` (now **`:139`**, default declared at **`:87`**/**`:115`**, was `:103`). Canon's `sv = 2` (2.1.251 L568795/L568813) is still unmet, and there is still no constrained-viewport (`Ua()`) arm. |
| **C4 sub-note**, `titleEnd` not dim/truncate-start | **WITHDRAWN** | bl10 added it correctly: `DialogFrame.tsx:124` — `<Text dimColor wrap="truncate-start">{titleEnd}</Text>`. |
| **C4 sub-note**, `isCancelActive: false` static-footer arm | **unchanged** | Still absent; bl10's frame has `onCancel`/`hintScope`/`hintActions` but no `isCancelActive` equivalent. |
| **C7** `/copy` picker + sidecar | **unchanged, cites corrected** | `useChat.ts` moved: the `/copy` block is now **`:2378-2396`** (was `:2355-2371`), summary line at **`:2394`**. Still no picker, no code-block entries, no sidecar, no `copyFullResponse`. |
| **C6** permission-notify immediacy | **unchanged, cite corrected** | `useChat.ts:2182` (was `:2174`); `idle_prompt` at `:1816` (was `:1808`). |
| **C8** transcript screen | **unchanged** | `TranscriptPager.tsx` identical; cites `:57-58` stand. |
| **§2 item 3** dialog-store placement semantics | **unchanged** | bl10 D4 held: no dialog registry shipped. `McpDialog.tsx` (new, 349 lines) + `mcpDialogModel.ts` (new, 283) mount through the existing `overlayChain`/`useChat` pattern. `place:"under"`, `holdsTop`, `succeeds`, `hideWhile`, `shownAt`'s 150 ms input grace and `revealSeq` remain unmodelled. |
| **§2 item 12** `/config` accessibility numbered form | **unchanged** | Still absent. |
| **§3a** `/config` sections + row registry | **unchanged, one sub-claim corrected** | `settingsRows.ts` is byte-identical — still ten flat rows, no sections, no writer targets, no `→ settings.json` marker. `SETTINGS_ROW_INSET` moved to **`:125`** and `settingsRowWidth` to **`:190`** (was `:120-121`). **Corrected sub-claim:** I wrote that `SettingsDialog.tsx:75-82` "hard-codes three footer strings". bl10 deleted two of them — `NORMAL_FOOTER` and `READONLY_FOOTER` are gone, replaced by the derived keyhint bar (`SettingsDialog.tsx:78-84`); only `SEARCH_FOOTER` is still a literal (**`:88`**), deliberately, because the `/` query swallows every key. The `↑ to tabs` point survives: the chord is still not advertised, and §41.26.3's header-focus split (bl10 D3) is still deferred. |
| **§4** the `Ye` action→description registry as a "we don't have it" asset | **WITHDRAWN (downgraded)** | bl10 shipped it: `harness/src/tui/dialogs/keyhints.ts:18-43`, transcribed from 2.1.251 L568825, plus `MAX_HINTS = 4` at **`:46`** (canon `Pe = 4`, L568834). Deliberately partial — only actions our own scopes bind — so canon's `confirm:nextField`/`confirm:previousField`/`confirm:toggle`/`app:toggleReplTab` and the five `app:*diff*` rows are absent by design, not by omission. The asset row should read "have it, minus deliberately-unregistered actions". |
| **§5** "bl10's *planned* keyhint cap of 4" | **corrected** | It is **shipped**, not planned: `dialogs/keyhints.ts:46`. Same for the `me`-derived frame prop list (`titleEnd`, `onCancel`, hint bar) — shipped at `DialogFrame.tsx:113-116`. |
| **§3a / bl10 entry points** | **corrected** | `/status`, `/usage`, `/cost`, `/stats` now open the Settings dialog on their tab (`commands.ts:40-41`, `:95`, `:100`), and `/permissions` gained canon's **Auto mode** tab (`PermissionsDialog.tsx:67` — six tabs in canon's verified order). My §1 draft read the pre-bl10 five-tab list; nothing in §§0–6 asserted otherwise, but the "text dumps" framing in the bl10 spec quote is now historical. |

### Two new corrections found only in the shipped bl10 code

**C11. The keyhint bar drops overflow silently; canon appends `+N more`.** — *verified*
`harness/src/tui/dialogs/keyhints.ts:94-102` returns at most `MAX_HINTS` entries and stops. Canon's
`Z` packs as many as fit and then appends a count (§41.22.10 :7502; 2.1.251 **L568949**):
```js
return { fellBack: !1, text: Q > 0 ? `${f.join(O)}${O}+${Q} more` : f.join(O), hadEntryWithoutDescription: D };
```
So a dialog with six reachable hints reads `… · +2 more` in canon and just stops at four in ours —
the user is not told anything was elided. Note canon's `Q` is measured against a **width** budget as
well as the count cap, which our count-only cap does not model.

**C12. The hint row is dim; canon's is dim *and italic*.** — *verified*
`harness/src/tui/dialogs/DialogFrame.tsx:141` renders `<Text dimColor>{hints.join(" · ")}</Text>`.
Canon (§41.22.10 :7509; 2.1.251 **L568875**): `e(t, { dimColor: !0, italic: !0, children: x.text })`.
Also: canon's ` · ` separator is itself a dim span emitted by the joiner `fe`
(`[chunk-pgmfs7an.js:634289]`) — ours is inside one uniformly-dim `<Text>`, which paints the same
cells, so only the italic is a real pixel difference.

### Not re-read

`ChatApp.tsx`, `ChatComposer.tsx`, `FullscreenViewport.tsx`, `Line.tsx`, `Transcript.tsx`,
`chatMain.tsx`, `composerFrame.tsx`, `keys/bindings.ts`, `liveWindow.ts`, `settingsFile.ts`,
`streamingItems.ts`, `toolRenderer.tsx` also differ between the trees, but §§0–6 cite none of them
except `keys/bindings.ts` (transcript scope, §1 C8) and `composerFrame.tsx` (the "no terminal-setup
command" note, §3b) — both re-confirmed present in somersault by grep. `clipboardImage.ts` differs
and is cited only without line numbers (§5), and its `readClipboardImage`/magic-byte contract is
unchanged.
