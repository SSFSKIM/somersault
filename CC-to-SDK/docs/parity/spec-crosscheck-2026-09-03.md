# Cross-check of the Claude Code Harness Specification (2.1.257) against ccx — 2026-09-03

> **What this is.** A separate effort produced a replication-grade specification of the Claude Code
> binary — 55 chapters, ~52 MB, every constant and prompt cited to `chunk:line` — first for 2.1.257 and,
> as of 2026-09-07, re-cut against **2.1.263** (the CLI installed on this machine). This document records
> what ten research lanes found when they read the TUI-relevant chapters against our implementation and
> our scorecard (`tui-ux.md`, `coverage.md`), what was independently verified in the binaries, and what
> the program should take from it. The ten lane reports, with every citation, sit beside this file in
> `spec-crosscheck-2026-09-03/`.
>
> **Where the corpus lives.** `~/claude-code-bundle/2.1.257/SPEC/` and `~/claude-code-bundle/2.1.263/SPEC/`
> on host `s`; the 257 and 263 libraries are mirrored under the job scratch dir used for this pass. The
> bundles themselves (`cli.pretty.js` + `tools/where.py`) for 2.1.220/234/236/241/251/257/258/263 are on
> this machine under `~/claude-code-bundle/`.

## 1. The one-paragraph answer

Yes — there is a great deal to take, and it falls into four kinds. **(a) Ledger corrections:** several of
our "permanently out of reach" verdicts rest on a CLI gate that was removed before our own canon target,
and a few ✅ rows were scored against layouts we invented rather than against the bundle. **(b) Live
defects the spec exposed** — behaviours that are wrong today, not merely unfaithful: the permission
dialog's "don't ask again" arm discards the engine's narrow suggestion and grants the whole tool; the
output-style picker sends lower-case ids into a case-sensitive registry and is probably a silent no-op;
Esc during a turn empties the prompt queue into the composer where canon leaves it queued; Ctrl-L
destroys the draft where canon repaints. **(c) Unknown unknowns:** whole canon subsystems with no
scorecard row that are fully reachable — the spinner tip sub-line, the fullscreen boot canary, the
git-backed `@` file index, batched queue draining, the full `/config` registry, `/terminal-setup`, the
`/context` grid the SDK already hands us. **(d) A better way to work:** the spec library (263 re-cut) is a
far better canon reference than per-wave bundle spelunking, and its citation discipline exposes how
fragile ours is (2,581 bare line numbers across 159 source files).

## 2. Provenance and confidence

- **Ten lanes**, one opus research agent each: A renderer/layout/themes (ch. 41 §1–14), B message and
  tool rendering + spinner (§15–18a), C dialogs/statusLine/paste/config (§19–28), D input pipeline and
  keybindings (ch. 42 §1–13), E composer/autocomplete/queue/interrupt ladder (§14–25), F slash commands
  (ch. 28), G version drift 241→251→257→263 (A5 + changelog map), H dialog surfaces in non-TUI chapters
  (24, 21, 35, 20, 13, 06, 49, 32, 10, 17, 47, 23), I the headless/SDK control protocol against our
  reachability ledger (ch. 45, 27), J transcript persistence formats (ch. 35, 13, A3).
- **Every finding is labelled verified or spec-only.** "Verified" means the lane re-read the cited line
  in `cli.pretty.js` (2.1.251 and/or 2.1.257) itself; the coordinator additionally re-grepped the four
  headline claims (prompt-suggestion gate flip; Ctrl+E explainer removal; file-permission session-row
  removal; output-style registry keys). The spec's own review loop did not converge (its tech-debt note
  estimates material residual error mass, higher in chapters 21/06/49/32 which had only a capped second
  pass), which is why the lanes verified rather than trusted.
- **A method error, caught and corrected.** The session's working directory was the frozen
  `codex_somersault` checkout, which predates the bl10 merge. All ten lanes first read `harness/src` from
  it; all ten were re-run against the live `somersault` tree and rewrote their line numbers in place. Two
  findings were withdrawn as a result (both things bl10 had shipped), one scare evaporated (bl10's
  spacing invariant correctly keeps `⎿` results glued to their tool header), and no headline verdict
  changed. The live tree also pins SDK 0.3.251 whose bundled CLI is exactly 2.1.251 — our canon.
- **Counts across the ten reports:** ~96 corrections, ~104 unknown unknowns, ~66 known gaps now
  specified, ~150 verbatim asset pointers, ~200 confirmations, ~40 spec defects.

## 3. Ledger corrections — verdicts in `coverage.md` / `tui-ux.md` that are wrong

Ranked by how much they change what we would build.

| # | Recorded verdict | What is true | Evidence | Report |
|---|---|---|---|---|
| L1 | `promptSuggestions` 🚫 dead headless (probes 100/100b, `full-potential.md:174`); we built `suggester.ts`, a paid Haiku side-session, on it | The emitter gate was a double-bind on 2.1.220–241 (`!isTruthy(CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION)` while the same var was the only enabler) and flipped to `!== false` by 2.1.251. Probes ran against 2.1.226 and tested exactly the closed arms. Our pinned CLI is 2.1.251, on the new side | verified across six bundles | I §P1 |
| L2 | `includeHookEvents` 🚫 dead headless (`coverage.md`, `full-potential.md:174`) | Probe 53b measured programmatic hooks with no settings hook present; probes 116/119 later measured live frames; `host/host.ts` defaults the flag on and `hookPairs.ts` depends on it. The ledger contradicts our shipped code | verified | I §P2 |
| L3 | "SessionStart dead at startup AND resume" | True only for SDK callback hooks (they cannot exist yet when the hook runs — structural, stop probing). Settings-layer SessionStart hooks run and emit lifecycle frames unconditionally, no flag; probe 119 recorded one. Deterministic start-of-session context injection is reachable today | verified | I §P3, §E1 |
| L4 | `default_to_no` is the one `can_use_tool` field the SDK drops | Five are dropped: `default_to_no`, `suppress_always_allow_rule`, `requires_user_interaction`, `classifier_approvable`, `decision_reason_type`. Three are exactly what a permission dialog needs, so our card can offer "always allow" on an ask the engine says must not | verified | I §P4 |
| L5 | "interrupt spares background tasks" | Only on an open-input session; a one-shot string prompt still kills them (closed-input exception), and the spare/kill branch is gated on a `perTaskStopAffordance` predicate we read as inert | verified | I §P5 |
| L6 | Ctrl+E command explainer scored as a gap (`tui-ux.md` three rows) and carried as debt A6 | Canon deleted it at 2.1.257 (`confirm:toggleExplanation` 5→0→0 across 251/257/263). At a 257+ baseline it becomes a ccx addition; A6 is dead debt | verified | G §3.1 |
| L7 | `/context`, `/status`, effort dialog scored ✅ | All three are scored against our own invented layout. Canon's `/context` is a grid/legend view and the SDK already returns the entire analyser payload (`gridRows`, categories, memory/MCP/agent/skill detail); canon's `/status` is ~20 Title-case rows in two groups sharing two rows with ours; canon's effort dialog is a horizontal slider with clamped ends, ours wraps | verified | H §7.1 B1–B3, §7.2 C2 |
| L8 | `CTRL-B-1` in the session picker: "a widening we cannot perform" | Canon's Ctrl+B is a client-side *narrow* over `gitBranch` we already carry, default off. Directly buildable | verified | H §7.3 |
| L9 | K2 "`null` consumes as explicitly unbound ✅" | Canon does not consume an explicit `null`; the key bubbles to the editor. Our behaviour is coherent and load-bearing (eight suppression blocks exist because of it) — keep ✅, rewrite the rule, add a divergence row | verified 251+257 | D §1.1 |
| L10 | K16 ❌, K21 "matches upstream's empty `DiffPanel`", K1 counts | K16 is 🟡 (two of three shipped); canon's `DiffPanel` binds `ctrl+x b`; canon 251 has 21 contexts/~190 entries/145 actions, ours 72 actions in 17 namespaces | verified | D §1.5–1.8 |
| L11 | Tab status (OSC 21337) ❌ | Canon's capability predicate is hard-coded `false`; no build emits it. Re-mark 🚫 | verified | C §3c |
| L12 | Terminal title row ✅ with braille busy glyphs | 2.1.251 uses `◐`/`◑`, pins a static `✳` under any multiplexer (gate default on), and freezes on focus loss. Our pair is 2.1.220's | verified | C §C1 |
| L13 | "#" memory mode recorded as an over-ship | Confirmed and settled: canon's `#` is Slack-channel completion; no producer of the memory renderer exists | verified | E §2.6, H §7.2 C3 |
| L14 | Task panel second line presented as parity | Canon never reads `activeForm` for that line; ours is a defensible substitution and should be recorded as a divergence | verified | H §7.3 |

## 4. Live defects — wrong today, independent of fidelity

| # | Defect | Fix shape | Report |
|---|---|---|---|
| X1 | **"Yes, and don't ask again" ignores `options.suggestions`** and grants a whole-tool rule. For `SandboxNetworkAccess` the engine sends the narrow `WebFetch(domain:<host>)` rule; we approve every host for the session and persist a rule no engine path reads | On that arm prefer `suggestions` when present; do not add to the session allowlist when one was applied. `smallDialogOptions.ts`, `permissions/gate.ts` | H §7.2 C1 |
| X2 | **`/output-style` ids are lower-case** (`explanatory`); canon's registry is `{default:null, Proactive, Concise, Explanatory, Learning}` and resolution is `table[key] ?? null` → default. Every built-in style set from the picker is probably a silent no-op. Missing `Concise` (added 2.1.251) | One live probe to confirm, then capitalise the ids | H §7.1 B9; coordinator-verified |
| X3 | **Esc / Ctrl-C during a running turn empties the queue into the composer.** Canon (220, 251 and 257 alike): running turn → abort and return; the pop-to-composer is the *idle* branch. We pop precisely when canon does not | Move the pop from `useChat.interrupt()` to the idle arm of `ChatApp.onInterrupt`; admit bash entries only when the draft is empty (`Bte`) | E §1.1, §7.2 |
| X4 | **Ctrl-L clears the composer buffer.** In 220/251/257 `chat:clearInput` and `chat:clearScreen` are the same `forceRedraw()` handler; at 220 there was an additional 2000 ms double-press to `/clear`, never a buffer clear | Make Ctrl-L a redraw; add `chat:clearScreen`; in fullscreen at 263 it clears the transcript | E §1.4, G §1b.3 |
| X5 | **Wheel guard drops real arrow keys on every terminal** within 75 ms of a wheel tick. Canon gates that limb on JetBrains JediTerm only and instead runs an arrow-burst detector (≥8 arrows/100 ms) that shows a toast without eating the key | Gate on `TERMINAL_EMULATOR === "JetBrains-JediTerm"`; port the burst toast | A §1.1 |
| X6 | **statusLine payload**: `resets_at` is an ISO string; canon (and its documented schema) sends Unix epoch seconds. Child env lacks `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_PID`, and we pass the OAuth token into an arbitrary shell command | One-line unit fix; add the four vars; scrub the three token names canon scrubs | C §C2, §C3 |
| X7 | **`CLAUDE_CODE_DISABLE_MOUSE`/`_CLICKS` parsed as raw truthiness**; canon parses tri-state, so `=0` enables the mouse there and disables it here | Reuse `renderer.ts`'s `envBool` | A §1.2 |
| X8 | **Shift+Tab ring**: `auto` offered unconditionally (engine refuses on incapable models, probe 99); `bypassPermissions` never offered where canon puts it between `plan` and `auto` when available | Gate `auto` on availability; insert `bypassPermissions` when the bypass consent is held | E §1.2 |
| X9 | **`popAllEditable`** pulls bash entries into a non-empty draft, where the `!` line becomes prose sent to the model | Two filters from canon's `Bte` | E §1.6 |
| X10 | **`/compact <instructions>` drops its argument**; the local twin is `supportsNonInteractive`, so it is reachable engine-side today | Pass `cmd.args` through `session.compact()` | F §1.5 |
| X11 | **A typed POSIX path is rejected as `Unknown command`**; canon `stat()`s `/<name>` and treats it as prose. Also `KIND_MAP` has six transcription errors (invented `pride`; five missing) | Adopt canon's `looksLikeCommand` + stat fallback; fix the table from 2.1.251 `L209408` | F §1.1, §1.4 |
| X12 | **`history.jsonl` scoping**: we key on launch `cwd`; canon keys on the project root, so history fragments per subdirectory. We dedup on every read (canon only in the fullscreen picker) and our dedup key ignores paste identity | One call to the git top-level we already compute | J §1.1–1.4 |
| X13 | **File-permission session row** `Yes, allow all edits during this session` was deleted at 2.1.251; canon composes ConsentRow factories naming the mode switched into. Plan dialog's bypass row label and the empty-plan `Yes` (a real `setMode default` consent in canon) are likewise 220-stale | Transcribe the factory templates and the mode-description table (H §4.1) | H §1.1–1.3 |
| X14 | **Denial copy**: canon has four framed sentences (main/subagent × feedback/none); we send the user's typed feedback bare and tell subagents to stop rather than try another approach | Table in H §1.5 | H §1.5 |
| X15 | **Linux + decomposed non-ASCII path**: the SDK's NFC normalisation is darwin-only while canon's is unconditional, so the CLI writes one project dir and `listSessions` reads another; `/resume` is empty | Tracker entry; probe on Linux before shipping there | J §3.5 |

## 5. Unknown unknowns worth building — no scorecard row today, reachable, ranked

1. **Spinner tip sub-line** (B §2.1). Canon's spinner is a block: line 2 is `narration → Next: <task> → <label>: <tip>` from a 70-entry registry with deterministic selection, `~/.claude.json`-style persistence, one tip per turn, and two time-based pre-emptions (30 min `/clear` nudge, 30 s `/btw` nudge). Entirely local. Turn narration itself is 257-only, off by default, fullscreen-only: record, don't build.
2. **Fullscreen boot canary** (A §2.1). We ship `DEFAULT_ON = true` for the alternate screen with no self-heal; canon records a per-launch pending marker and auto-disables fullscreen after two failed starts (`crash_auto_off`), with two stderr banners and a `/tui` suffix. Entirely local; the missing safety net for our own default.
3. **Git-backed `@` file index** (E §1.5, §3.1). Canon indexes `git ls-files --recurse-submodules` (+ untracked pass, `.claude/*` markdown, ripgrep fallback) with no depth/count cap and a specific six-term score; ours is a 1000-entry `readdir` that skips every dotfile and cannot complete `.github/…` or `.claude/agents/foo.md`.
4. **Queue batch drain** (E §1.3). Canon drains every same-mode queued prompt into one turn; ours runs one turn per entry. Three type-aheads cost three system prompts here and one there. Mid-turn absorption (E §2.1) is the bigger sibling and needs a probe.
5. **The `/config` registry** (C §3a). Eight named sections, ~60 rows, per-row writer target, the `→ settings.json` migration marker, lock-dependent footer chord, type-to-search on any printable key (D §1.10). We have ten flat rows. 257 adds `Time format`; 263 adds one more.
6. **`/terminal-setup`** (C §3b). Entirely unbuilt; every payload, path and outcome string is verbatim in §41.25. The other half of the K40 `shift+enter` row.
7. **`auto` theme OSC 11 tier** (A §3.1). Fully specified and verified at 2.1.251: query, parser, luminance split, tmux DCS race, latch, DEC 2031 re-probe. Prerequisite: enable `?2031h`.
8. **`/context` grid** (H §7.1 B1). The SDK already returns the analyser payload; we render one dim line. Plus the over-limit banner templates and the `blocked` band our warning ladder omits.
9. **Canon's `/status` field set** (H §7.2 C2). `Version`, `Session name`, `Session ID`, `Session kind`, account rows, `MCP servers` count summary, `Setting sources` — most reachable today; bl10's Status tab kept `formatStatus`.
10. **Permission dialog fail-safes** (H §2). `matchedAskRule` is on our wire and never named in the dialog it triggered; `defaultToNo` decline-first ordering; `standingRowVetoed` (homoglyph check computable client-side); plan approvals withheld above 200 000 chars or on markdown-unsafe plans; AskUserQuestion multi-select quoting.
11. **Persistence records we already receive and discard** (J §1, §2). 33 of 38 transcript record types never reach `getSessionMessages` but arrive verbatim in `SessionStore.append()`: resume-time `permission-mode` and `cost-state` restoration are buildable on the store seam; `listSubagents`/`getSubagentMessages` are declared SDK surface we wrap neither; `~/.claude/sessions/` liveness we read for addressing only; `.session-aliases` for `/add-dir` → `/resume` widening; picker `fileSize` and `tag` are already on the rows.
12. **Slash-command routing** (F §1.2, §2.1). The SDK's `system.init` advertises the un-narrowed command list while the engine dispatches only the `runsHeadless` subset, so ~85 forwarded names cost a model turn to be refused; canon's own `terminal_slash_commands` field and the §22 predicate replace our five-name honesty list. Three of those five (`/agents`, `/extra-usage`, `/fast`) have headless twins the engine would answer — probe first. Cheap wins in the engine-side column: `/recap`, `/reload-skills`, `/init`, `/security-review`, `/insights`, `/list-agents`.
13. **Smaller, cheap, exact**: three missing reserved keys (`ctrl+[`, `ctrl+i`, `ctrl+h`, D §3.1); arrow-burst toast and tmux `mouse`/`focus-events` hints (A §2.2–2.3); `/scroll-speed` and the wheel base factor (A §2.4); `/color` on the palette we already ship (A §2.5); OSC 8 `id=` so wrapped links stitch (A §1.4); kitty `ESC[>5u` (A §1.3); reduced-motion glyph `●` (B §1.4); spinner verb held for the whole turn (B §1.2); four markdown tokenizer overrides incl. the fast-path regex that drops `+ ` bullets and `1)` lists into plain paragraphs (B §1.3); keyhint bar `+N more` overflow and italic hint row (C §C11–C12); dialog body indent 2 not 1 (C §C4); `/copy` picker with per-code-block entries and the sidecar file (C §C7); `/tasks` `Completed` section, `/model` search box and session-only header, `Concise` output style, `/memory` (H §7); `/rename` with no argument, `/export` as a dialog over the rendered transcript, picker Title-case footer chords, current session filtered from the picker (H §7.3).

## 6. Probes to run first — cheap, and each one flips a ledger row

Ordered by information per dollar. All against the pinned SDK 0.3.251 unless noted.

1. **Prompt suggestions** (I §P1): `promptSuggestions: true`, env `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=1`, four cheap turns (past `early_conversation` and `cache_cold`), second arm without the env var. A frame in any arm retires `suggester.ts`'s paid generator.
2. **Bash stdout during a running command** (G §1b.6): re-run probe 84 on a 0.3.26x SDK. Three 🚫 rows rest on it; 2.1.259 fixed a live-output preview bug that presupposes the frames exist.
3. **Hook lifecycle frames by species** (I §P2, §P3, §P6): settings-layer command hook for all 33 events, `includeHookEvents` on vs omitted, marker files and `hook_started` counted separately. Replaces three inconsistent census rows.
4. **Output-style casing** (X2): set `Explanatory` vs `explanatory` via `applyFlagSettings`, inspect the system prompt the engine builds.
5. **`can_use_tool` wire fields** (I §P4): `JSON.stringify` the whole options bag on a live consult; confirm the five-field drop list on the pinned SDK rather than from `sdk.d.ts`.
6. **Interrupt on a one-shot prompt** (I §P5): three arms; log `system/init.capabilities`.
7. **`terminal_slash_commands`** (F §2.1): re-run probe 112 with plugins/skills loaded to see whether the field is a usable honesty list or a narrow terminal subset.
8. **Symlinked cwd** (J §3.4): launch under a symlink, compare `listSessions({dir})` with `ls ~/.claude/projects`.

## 7. Version drift — what a re-baseline buys

- **Recommendation: move the canon target from 2.1.251 to 2.1.263** (installed CLI, re-cut spec available) at the next round boundary, and cite the spec chapter + `chunk:line` alongside the quoted literal from then on. Rationale in G §1.14: 2,581 bare `L<n>` references in our source, 36 within 80 chars of a version string; minified symbol names are no more stable than line numbers; the bundle a citation names is carried only by prose in `tui-ux.md`'s header.
- **251→257 TUI-visible** (G §1): Ctrl+E explainer removed; `/effort` gains `s` = session-only and a context canon named `EffortSlider` where we invented `EffortDialog` (user-visible in `keybindings.json`); an `Agents` context; `/config` `Time format`; `/add-dir <subdir>` now loads that dir's skills/commands/agents (inverts two ✅ rows); network-path refusal; spinner keeps running behind a slash panel; `/model` gateway labels; queued-ask notification delay.
- **257→263 TUI-visible** (G §1b): an unannounced interactive plugin panel above the prompt (`ctrl+x ctrl+a`, three contexts, eight actions); word-editing keys re-flipped to Bash semantics (reverses a Wave-C correction); `ctrl+l`/`cmd+k` clear the transcript in fullscreen; the terminal progress indicator now respects background work (we already name that defect in our own row); grapheme integrity at wrap boundaries (patched-Ink territory, file with the other two Ink items); `/diff` side panel — present in 2.1.251 already, so "Added X" bullets frequently mean "ungated X" and several 258–263 features are buildable from the 251 bundle.
- **Harness-visible, non-TUI** (G §2): hooks strict validation, `permissions.blockReadsOutsideWorkingDirectories` (not in `sdk.d.ts` at 0.3.251), `timeFormat`/`timeZone`, the signed model catalog and `behavesAs`, the permission-mode ceiling (our `resolveOptions` auto-grants bypass where canon refuses), MCP project-approval refusals, `bashOutputMaxChars`/`taskOutputMaxChars`, `--permission-prompts none`, `--append-subagent-system-prompt`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (voids our subagent model overrides). Also: first-party release notes for 2.1.228–2.1.260 are compiled into the 2.1.263 binary at `cli.pretty.js:50526`, including 2.1.257's own 105-bullet entry.
- **Unmodelled substrate** (I §2): CLI flags reachable through `extraArgs` with real product value — `--workload` billing attribution, `--exclude-dynamic-system-prompt-sections` (static prefix caching across tenants), `--system-prompt-snapshot`, `--replay-user-messages` (delivery ACKs), `--init-only` (zero-turn config verifier); eleven stdout frame subtypes the SDK passes through untyped (`model_fallback`, `model_consent_fallback`, `assistant.supersedes`, …); `deferred_tool_use` as a terminal state our success classifier reads as success; capability tokens we neither read nor feature-detect.

## 8. Spec defects found (feed back to the SPEC project)

Chapter 41: §41.16.6 states the expand affordance unconditionally (canon suppresses it in the fullscreen list — our pty evidence was right); §41.15/16 never specify inter-block `marginTop`; §41.16.3 mislabels `"  ⎿  "` as the same string as the NBSP form; §41.18.2 omits a dead third frame array; §41.10.2's OSC 11 parser is `rgba?:` and unanchored; §41.19.4's "Shell: bash" row is wrong on POSIX (`shell: true` = `/bin/sh -c` — our implementation is right); §41.8.5 does not say the 75 ms arrow drop sits inside the JediTerm gate. Chapter 42: §42.12.6 lists two left-arrow hints, there are three; §42.6.6 silently drops 251's `ctrl+e` row; §42.5 omits `confirm:toggleExplanation → explanation`. Chapter 28: §8 step 8b omits the policy-denied `Args from /<name>:` twin. Chapter 45: §45.14.8 omits the emitter's env-var term (a reimplementer would build a feature that can never fire headlessly); §45.14.6 undersells that callback hooks emit no lifecycle frames on any event; §45.10.2 vs §45.29.1 disagree on which list `system/init.slash_commands` carries. Chapter 35: §35.26.3's "unconditional" history drops are gated on a stripped paste; three "no title" literals documented without cross-reference; the SDK reimplements a strict subset of the picker filter (not stated). Chapter 21: §7.1 misreads the empty-plan fallback (plain `Yes` denies); §7.4's closing paragraph over-generalises the label variant. Chapter 24: §24.14.4's consent-row table hides the 220→251 break; §24.14.3's gate is described in fields SDK hosts never receive. A5: keybinding-context counts are 21→23→26 not 20→22; first-party release notes exist for three of six hop releases, not one; `CONVENTIONS.md`'s worked example cites a 2.1.251-only chunk.

## 9. Three lessons for the program

- **Rows scored against ourselves.** `/context`, `/status`, the effort dialog, the task panel's second line and `CTRL-B-1` all carry a parity claim whose evidence is our own implementation. The fix is procedural: a row enters ✅ only with a bundle cite, and a re-cut against canon is part of every wave's close-out.
- **Species matter in probes.** Hook reachability, interrupt behaviour and prompt suggestions were each measured on one species (callback hooks; open-input sessions; a pre-gate-flip CLI) and generalised. Probe briefs should name the species and the CLI version, and verdicts should carry both.
- **Read from the tree you mean.** Ten agents read a frozen checkout because it was the process cwd. Briefs that name an absolute repo root are not enough when relative paths resolve elsewhere; give agents the root as the first line of the task and verify one citation before trusting the rest.

## 10. Suggested shape of the next round

Not a decision — a candidate list, grouped so each group is one worktree lane of the usual size.

- **bl11-A "ledger and defects"** (small, high value): X1–X14 above, the ledger rewrites in §3, the tracker entries (X15, the three Ink items, tab status → 🚫), `KIND_MAP`, reserved keys, statusLine unit/env, mouse tri-bool, kitty flags, OSC 8 id, reduced-motion glyph, spinner verb hold.
- **bl11-B "probes first"**: the eight probes in §6, each closing a row; `suggester.ts` retirement if P1 fires; `includeHookEvents` and SessionStart rows rewritten.
- **bl11-C "spinner block + boot canary + arrow toast"**: three local subsystems, fully specified, no SDK dependency.
- **bl11-D "composer truth"**: Esc/queue inversion, Ctrl-L, batch drain, `popAllEditable` filters, git-backed `@` index with canon's score, `/btw`-shaped immediate local commands if wanted.
- **bl11-E "dialog fidelity"**: ConsentRow factories + mode table, plan dialog rows, denial copy, `matchedAskRule` stanza, fail-safes, dialog body indent, keyhint overflow/italic, `/permissions` descriptions and shadowed-rule diagnostics.
- **bl11-F "config and status"**: `/config` registry with sections and writer targets, type-to-search, canon `/status` and `/context` views, `/terminal-setup`, `/copy` picker, `/tasks` Completed, `/model` search.
- **Re-baseline to 2.1.263** as its own housekeeping lane: header paragraph in `tui-ux.md`, citation convention, `EffortSlider` rename, Ctrl+E reclassification, `/add-dir` subdir semantics, word-editing keys.
