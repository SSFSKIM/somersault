# Lane E — composer, autocomplete, history, queue, interrupt ladder, mode cycle
Spec chapter `42-input-and-keybindings.md` §42.14–§42.25 vs `harness/src/tui/`.
Our-side repo: **`/Users/new/Developer/GitHub/somersault/CC-to-SDK`** (all `file:line` below re-verified
there — see §7).
Bundle cites are absolute `cli.pretty.js` line numbers; `257:` = `~/claude-code-bundle/2.1.257/`,
`251:` / `220:` likewise. "verified" = I read the cited bundle lines myself.

---

## 0. Top takeaways

1. **Esc / Ctrl-C on a running turn silently empties the queue into the composer.** Canon aborts the
   turn and *returns* — the queue is untouched. `useChat.ts:3624-3631` vs §42.21.2 / `257:403192`.
   **Verified.** Highest-value correction in the lane: it moves user data. → §1.1
2. **The Shift+Tab ring is wrong in both directions.** Ours is a fixed 4-cycle
   `default→acceptEdits→plan→auto`; canon is `default→acceptEdits→plan→[bypassPermissions]→[auto]→default`
   with each optional mode independently gated. We offer `auto` where canon would hide it (and probe 99
   says the engine then *refuses*), and never offer `bypassPermissions`. `useChat.ts:174-176`,
   `settingsRows.ts:27` vs §42.22.3 / `257:631197-631217`, identical at `251:756871-756885`.
   **Verified, not a 251→257 hop.** → §1.2
3. **The queue drains one entry per turn; canon drains a whole same-mode batch as one turn**, and can
   additionally fold queued prompts into the turn *already running* (§42.20.4a, unbuilt). Three prompts
   typed ahead cost three turns in ccx and one in canon. `useChat.ts:3348-3366` vs `257:428448-428474`.
   **Verified.** → §1.3, §2.1
4. **`ctrl+l` (`chat:clearInput`) clears the composer buffer in ccx; canon never clears the buffer with
   it** — at 2.1.257 both `chat:clearInput` and `chat:clearScreen` are the *same* handler, a bare
   `forceRedraw()`; at 2.1.220 it was redraw + a 2000 ms arm whose second press runs `/clear`.
   `ChatComposer.tsx:1053` vs §42.21.7 / `257:413842-413849`, `257:414012`, `220:495848-495866`.
   **Verified. The F0/W1 "convergence on 2.1.220" was based on a misreading.** → §1.4
5. **The `@` file index is a different machine.** Canon builds one process-level index from
   `git ls-files --recurse-submodules` (+ a background `--others --exclude-standard` pass, + `.claude/*`
   markdown, + a ripgrep `--hidden` fallback) and searches it with a specific 6-term scoring function;
   ccx does a live recursive `readdir` capped at 1000 entries that skips *all* dotfiles/dotdirs and
   hardcodes `node_modules`. Consequences: `.github/…` and every tracked dotfile are uncompletable,
   `dist/`-style generated trees are completable and eat the cap, and ranking differs materially.
   `fileComplete.ts:29-47,110-129` vs §42.18.1-42.18.5 / `257:487593`, `257:514344`, `257:514405`.
   **Verified.** → §1.5, §3.1, §4.1
6. **`popAllEditable` has two filters we don't have**: with a non-empty draft, bash entries are excluded
   outright; in a mixed queue the popped set collapses to `prompt` and the bash entries *stay queued*.
   `queue.ts:107-132` vs §42.20.3 / `257:48518-48538` (same at `251:422301`). **Verified.** → §1.6
7. **Canon's `#` is Slack-channel completion, not memory** — confirming Wave C task 14's removal was right
   *and* naming what actually occupies the sigil. §42.16.3 / `257:404042`, `257:404553`. → §5, §2.6

---

## 1. Corrections — things we built that canon does differently

### 1.1 Interrupt destroys the queue *(verified, not a 251→257 change)*

**Ours:** `harness/src/tui/useChat.ts:3624-3631`
```ts
function interrupt() {
  drainGen.current++;
  const q = queueRef.current;
  if (q.length) setComposerPrefill({ text: q.map(e => e.value).join("\n"), token: Date.now(), mode: "prepend" });
  queueRef.current = []; setQueue([]);
  void session.interrupt().catch(() => {});
}
```
So any Esc/Ctrl-C during a busy turn empties the queue and prepends every queued prompt above the live
draft. Recorded in the scorecard as a *fix* ("F0, t3, CM49").

**Canon** (§42.21.2, `257:403183-403205`): the cancel function's precedence is
1. a running turn wins over everything — `if (ue !== void 0 && !ue.aborted || Se) return …, I(), !0;`
   (`257:403192`) — abort and stop, no queue handling at all;
2. *otherwise*, if the queue holds a `Bte`-editable command, pull it into the draft (`257:403197`);
3/4. background work / kill agents — **both unreachable from Escape**, because Escape always passes
   `suppressBackgroundAgentKill: true` (`257:403218`) and both later branches open with `!wn`.

The queue is only *cleared* by a confirmed `chat:killAgents` (`ctrl+x ctrl+k`) and even then only when
`Tn = runningAgent || armedRewind || passiveBackgroundTask` (`257:403244-403251`); the cleared commands
are then written to history with undo disarmed.

**Impact:** in ccx, interrupting a long turn (the single most common reason to press Esc) drops your
type-ahead into the composer as one `\n`-joined blob that no longer auto-sends. In canon the queue
survives and drains after. This is user data being moved by a keystroke whose advertised meaning is
"interrupt".

### 1.2 Shift+Tab ring order and gating *(verified in 257 **and** 251)*

**Ours:** `useChat.ts:174-176` over `settingsRows.ts:27`
```ts
export const PERMISSION_MODE_OPTIONS = ["default", "acceptEdits", "plan", "auto"];
const LADDER = PERMISSION_MODE_OPTIONS;
function ladderNext(mode) { const i = LADDER.indexOf(mode); return i >= 0 ? LADDER[(i+1)%LADDER.length] : "default"; }
```
`auto` is unconditional; `bypassPermissions` is deliberately off-cycle (comment: "stays off-cycle (/yolo)").

**Canon** (§42.22.3, `257:631197-631217`, byte-equivalent at `251:756871-756885`):
```
default → acceptEdits → plan → [bypassPermissions if WJt] → [auto if UW] → default
bypassPermissions → [auto if UW] → default ;  dontAsk → default ;  default arm → default
```
* `WJt(e) = !!e.isBypassPermissionsModeAvailable && !cy()` (`257:631195`) — available whenever the
  *resolved* startup mode is `bypassPermissions` **or** `--allow-dangerously-skip-permissions` was
  passed, minus the `permissions.disableBypassPermissionsMode: "disable"` killswitch and `--restricted`.
* `UW(e) = !!e.isAutoModeAvailable && PC()` (`257:631189`) — circuit breaker, `disableAutoMode`
  killswitch, **and model capability**.
* `dontAsk` is only ever *escaped* by the cycle, never entered; it is set by the startup resolver
  (CLI flag, `--permission-mode`, agent frontmatter `permissionMode`, or settings
  **`permissions.defaultMode`** — a *nested* key, not top-level `permissionMode`).

**Impact, two halves.** (a) ccx offers `auto` on models that cannot take it; Wave T's own probe 99
established the engine then *refuses* and stays put, so the user gets a refusal notice where canon
would simply have skipped the rung. (b) A ccx user who accepted the `/yolo` bypass consent still cannot
reach `bypassPermissions` from the keyboard ring, where canon puts it between `plan` and `auto`.
No scorecard row covers ring order or gating — §1's "Shift+Tab cycles permission mode" row is ✅ and
speaks only to the chord.

Also worth pinning: **the ring never reverses**. Canon has a directional ring `Ozt`
(`["plan","default","acceptEdits"]` + optional modes, `257:405114`) but its only caller is the
`proactivityMenu:*` dispatcher, which is a stub returning `false` (§42.22.4). So "shift+shift+tab goes
back" is not a canon behaviour and must not be invented.

### 1.3 Drain granularity *(verified)*

**Ours:** `useChat.ts:3348-3366` — `drainNext()` takes `q[0]`, dispatches it, and the turn's `finally`
re-drains. One queued prompt = one turn.

**Canon** (§42.20.4, `257:428448-428474`): if the head is a slash command or `mode === "bash"`, exactly
one entry drains. Otherwise `dequeueAllMatching` scans the **whole** queue and takes every entry whose
mode equals the head's and which is not a slash command — *skipping over* non-matching entries rather
than stopping at them — and hands the whole batch to one `executeInput`, i.e. **one turn**. Three stop
latches close the scan: `screeningPending`, `promptSubmitted !== undefined`, `drainOnly === true`.
So `[plain, slash, plain]` drains both plain entries together and leaves the slash command for the next
drain.

**Impact:** type three follow-ups while Claude is working. ccx runs three separate turns (three system
prompts, three context reloads, three cost events); canon runs one. This is a cost and latency
difference, not only a fidelity one.

### 1.4 `chat:clearInput` clears the buffer *(verified across 220/251/257)*

**Ours:** `ChatComposer.tsx:1053` — `"chat:clearInput": () => handleKey(CTRL_L)`, and the editor's
ctrl+l clears the composer buffer. Scorecard §1 row: "Ctrl-L (clear **input**) ✅ — W1 converged on
2.1.220's `chat:clearInput`".

**Canon:**
* 2.1.257 (§42.21.7): `"chat:clearScreen": qio, "chat:clearInput": qio` (`257:414012`), where
  `qio = Wio = () => n6n(rlo)` (`257:413842-413849`) bumps a counter whose effect is
  `forceRedraw()` (`257:413834-413837`). The unbound `app:redraw` has the identical handler. Neither
  touches the prompt buffer.
* 2.1.220 — the build W1 read: `Rne = () => { t8(w => w+1); R0.current = L0; yK(); }` (`220:495862`),
  where `yK = Pee(OPe, Bge, void 0, 2000)` and `Bge` runs `/clear` (`220:495856-495859`). So even there
  ctrl+l was *redraw + a 2000 ms double-press that clears the **conversation***, and both halves of that
  arm are gated on `ds()` (fullscreen), so in the classic renderer it was redraw-only. It never cleared
  the composer.

**Impact:** ccx's ctrl+l destroys a draft; canon's repaints the screen. A muscle-memory ctrl+l (very
common as "redraw this terminal") loses work in ccx. Also: we have no `chat:clearScreen` action at all,
so the pair cannot be reproduced.

### 1.5 The `@` file index *(verified)*

**Ours:** `fileComplete.ts:29-31, 57-75` — `collectEntries` is a live recursive `readdir` from the walk
root, `cap = 1000`, `IGNORE = new Set(["node_modules", ".git"])`, `skipDir = IGNORE.has(name) || name.startsWith(".")`,
and files starting with `.` are skipped too. Re-walked on every root change with a 50 ms debounce
(`ChatComposer.tsx:1211-1223`).

**Canon** (§42.18.4, verified at `257:514344`, `257:514405`, `257:514486-514520`): a process-level
in-memory index, never persisted, built from four merged sources —
**A** `git -c core.quotepath=false ls-files --recurse-submodules` from the repo root, 5000 ms timeout;
**B** on non-zero exit, ripgrep `--files --follow --hidden --glob '!.git/' '!.svn/' '!.hg/' '!.bzr/' '!.jj/' '!.sl/'`
(+ `--no-ignore-vcs` when `respectGitignore` is false);
**C** `.md` files under `.claude/{commands,agents,output-styles,skills,workflows,routines}` at four
source roots, as **absolute** paths, each ≤ 1 MiB and a regular file;
**D** a background `git ls-files --others [--exclude-standard]` pass merged in when it lands.
Directories are synthesised from every path's ancestor chain. **There is no max depth and no max file
count** — only process timeouts and ripgrep's stdout cap. Ignore filtering is an in-process `ignore`
matcher over `.ignore`/`.rgignore` only (repo root + cwd), fail-open; `.gitignore` is honoured
*indirectly* by `git ls-files`. `node_modules` is **not** hardcoded anywhere.

Four concrete behavioural deltas:
* **Dotfiles and dot-directories are completable in canon and not in ccx.** `@.github/workflows/ci.yml`,
  `@.claude/agents/foo.md`, `@.env.example` — all tracked, all in canon's index, all invisible in ccx.
  (Only the *explicit-path* completer filters dotfiles upstream, `257:403755`.)
* **Gitignored trees are excluded in canon and included in ccx.** A `dist/` or `target/` tree eats the
  1000-entry cap and buries real files.
* **The 1000 cap truncates depth-first**, so on a large repo whole subtrees are unreachable through `@`.
* **The cwd-relative rebasing and submodule inclusion** are absent.

### 1.6 `popAllEditable` filters *(verified in 257 and 251)*

**Ours:** `queue.ts:107-132` — `joinQueuedForComposer` takes every `isEditableQueueEntry` entry, joins
with `\n`, and `useChat.ts:3449-3457` removes all of them from the queue.

**Canon** (§42.20.3, `257:48518-48538`):
```js
let qi = Br === "", _o = d.filter(sr => Bte(sr, qi));            // Bte(e,n) = fh(e) && (n || e.mode !== "bash")
let Eo = _o.every(sr => sr.mode === "bash") ? "bash" : "prompt",
    Xo = Eo === "bash" ? _o : _o.filter(sr => sr.mode !== "bash");
… let ui = d.filter(sr => !si.has(sr));                          // only Xo leaves the queue
```
1. **Draft restriction** — with a non-empty draft (`Br !== ""`), bash entries are refused outright.
2. **Mixed-queue mode collapse** — unless *every* admitted entry is bash, the popped set is the
   prompt-only subset and the bash entries **stay queued**.
`fh` also excludes `isMeta`, non-user origins and `JOe(e)` (`257:48071-48073`).

**Impact:** in ccx an Up on `[prompt, !ls, prompt]` yanks `!ls` into the middle of a multi-line prompt
draft, where it is no longer a bash line (only line 0's `!` sets the mode — `editor.ts:177-180`), so the
shell command silently becomes prose sent to the model. Canon leaves it queued.

### 1.7 The `@` fuzzy score *(verified constants)*

**Ours:** `fileComplete.ts:110-121` — per matched char `1 + streak`, `+5` at index 0, `+3` after `/`;
no gap penalty, no length term (path length is only a *tiebreak*), no camelCase bonus, no smart case.

**Canon** (§42.18.2, `257:487593`, `257:487703-487707`, `257:487738-487748`):
```
fuzzScore = 16*queryLength + 4*(adjacent matches) − Σ_gaps(3 + gapSize)
          + Σ_positions Ho(path,pos,isFirst) + max(0, 32 − (pathLength >> 2))
Ho: pos 0 && first → 8 ; prev char in {/ \ - _ . space} → 8 ; lowercase→uppercase boundary → 6 ; else 0
```
plus: smart case (any uppercase in the query ⇒ case-sensitive matching against the original paths),
query truncated to 64 chars, a 26-bit a–z presence bitmask prefilter, **no exact-prefix special case**,
**no directory-depth and no recency term**, and the exposed `score` is `rank/count ∈ [0,1]` (lower
better) with a `×1.05` penalty for paths containing the case-sensitive substring `test`.

**Impact:** ranking order differs on essentially every non-trivial query. Two specifics worth having:
the separator bonus fires on `-`, `_`, `.` and space as well as `/` (so `fileComplete.ts` under-scores
kebab/snake-case boundaries badly), and the `max(0, 32 − len/4)` short-path term is worth up to 32
points — comparable to two matched characters — which is what makes canon prefer short paths *before*
the tiebreak stage.

### 1.8 Double-Escape rewind: window and first-press feedback *(verified)*

**Ours:** `ChatApp.tsx:154-156, 1407` — `ESC_ARM_MS = 1500`, and the first press posts
`Press Esc again to rewind`.
**Canon** (§42.21.3, `257:412793`): the rewind gesture is `CI(oro, pRe.openMessageSelector)` with a
**no-op first callback**, so the window is the shared 800 ms default (`257:285963` `var a = 800`) and
**the first press produces no visible change at all**. Ours is a documented ccx choice, but the spec
settles the canon values; the `Press Esc again to rewind` string in particular has no upstream
counterpart (upstream's only Escape hint is the composer's `Esc again to clear`, 1000 ms `timeoutMs`
over an 800 ms arm — which ccx *does* match, `ChatComposer.tsx:1379`).

### 1.9 `!` bash mode: execution model and the sigil in the buffer *(spec-only for the model round-trip)*

Two deltas, one already recorded, one not.

**(a) Recorded but now precisely specified.** ccx runs `!` lines with `child_process.exec`, 30 s
timeout, 4 MiB buffer, and **never shows the model the output** (`bash.ts:19-30`; scorecard: "local-only
by design"). Canon (§42.16.1) runs it through the **Bash tool** (or the PowerShell tool) with
`dangerouslyDisableSandbox: true`, wraps the transcript row as `<bash-input>…</bash-input>`, appends a
synthetic user message `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>` and **queries the
model**, gated on `shouldQuery = respondToBashCommands (default true) && !interrupted &&
!backgroundTaskId && !abortController.signal.aborted` (`257:640222-640232`). The non-interrupted error
branch emits the *same* stdout/stderr pair from the exception's partial streams; only a third,
generic branch emits `<bash-stderr>Command failed: …</bash-stderr>`. The setting name to adopt if this
is ever revisited is **`respondToBashCommands`** (boolean, default true, no `/config` row).

**(b) Not recorded.** In canon the `!` **never enters the buffer** — the change handler intercepts it
and switches mode (`257:412513-412524`, verified). Typing `!` at offset 0 in front of existing text
enters bash mode **and keeps the text unchanged**; the `!` is simply not committed. ccx derives the mode
from `lines[0].startsWith("!")` (`editor.ts:177-180`), so the sigil is literally in the buffer and is
rendered *in addition to* the `!`+NBSP prompt glyph (`composerFrame.tsx:57`). Downstream consequences:
`@`-completion spans, cursor columns and the "cursor at offset 0" leave-mode rule all differ by one.
This is a deliberate architectural choice (`promptMode.ts` header) and probably stays — but the leave
rule is worth matching: canon leaves bash mode on `escape`, backspace, delete or `ctrl+u` **at offset 0
only** (`257:412012-412017`).

### 1.10 History read-time dedupe key *(spec-only)*

**Ours:** `promptHistory.ts:149` dedupes on the raw `display` string.
**Canon** (§42.19.2): read-time dedupe is on a canonical form built by `Pcn` (`257:47367`) which
rewrites every `#N` to `#_` and appends a per-placeholder discriminator (`hash:` / `inline:` /
`literal:` / `dead`). So two recalls of the same prompt whose paste ids differ collapse to one row in
canon and to two in ccx.

Also unmatched (spec-only, low value): canon's write-time `addEntry` applies five suppression rules once
any dead paste has been stripped (§42.19.2 — empty after strip; original was a `!` line; original was a
`/` line; a sigil newly introduced by stripping; placeholder references multiplied), and a submission
carrying `fromKeybinding` produces **no** history entry at all.

### 1.11 Action vocabulary gaps that make user keybindings fail *(verified against our table)*

`keys/bindings.ts:420-448` (`VALID_ACTIONS`) omits nine action names canon ships in its Chat context:
`chat:submit`, `chat:queueSubmit`, `chat:newline`, `chat:undo`, `chat:stash`, `chat:clearScreen`,
`chat:imagePaste` is present but `history:previous`, `history:next` and `chat:workflowKeywordToggle`
are not. A `~/.claude/keybindings.json` that names any of them — which a real Claude Code user's file
plausibly does — fails ccx validation with `invalid_action` where canon loads it. Canon's own note is
that `history:previous`/`history:next` have **no registered handler** anyway (§42.19.3): rebinding them
only removes the default, it does not move the behaviour, because Up/Down live in the editor. So the
cheap fix is to accept the names, not to wire them.

Related canon mechanism we have no analogue for (§42.20.1): `chat:submit`'s handler is registered with
`singleKey: !(enter still resolves to chat:submit)`. Under the default binding the dispatcher's
single-key pass **skips** it so `enter` falls through to the editor; rebind the action and the handler
fires directly. That is the general "a key the editor must see unless the user moved the action"
pattern, and `task:background` uses the same trick (§42.23.2).

---

## 2. Unknown unknowns — canon behaviours with no tui-ux.md row

### 2.1 Mid-turn absorption (§42.20.4a) — queued prompts steer the *running* turn
On each iteration the query loop selects queued commands of priority ≤ `next`, emits them as
`queued_command` attachments into the message list handed to the next model iteration, consumes them
with `reason: "absorbed_mid_turn"` and writes their history (`257:122475`, `:122505`, `:122534`). Gated
by `isMidTurnFoldSuspended()`, the turn limit, main-thread/agent-id eligibility, and a `drainOnly` /
`screeningPending` / stale-`promptSubmitted` stop latch. Two safety valves leave commands queued rather
than dropping them. This is what makes typing a correction mid-turn actually redirect Claude instead of
waiting for the turn to end.
**Reachability: flag, do not assert.** It needs the ability to append a user message into an in-flight
query. The Agent SDK's streaming-input mode may permit something equivalent, but nothing in our
transport currently surfaces per-iteration message assembly. Worth a probe before anyone scopes it —
this is the highest-value unbuilt behaviour in the lane.

### 2.2 `/btw` — the side-question channel (§42.20.6)
A `local-jsx` command with `immediate: true` (`257:143528`), which is the *input-layer* switch: an
immediate local-JSX command submitted while a turn runs takes a branch **before** the queue
(`257:425113`). Mounted `{ immediate: true, hidesPrompt: false, retireAtTurnBoundary: true }`, so the
prompt stays usable underneath, and the token is syntax-highlighted in the live input by
`/^\/btw\b/gi` (`257:2697`). Its footer hint `/btw for side question` sits alongside our three prefix
hints. `keys/hints.ts:244` already records it out of scope; the *mechanism* (immediate local-jsx
bypassing the queue) is the new information, and it is the natural home for any ccx side-channel.

### 2.3 `chat:queueSubmit` (`ctrl+x enter`) (§42.20.5)
Calls the same submit with a fourth argument that becomes `wait: true` on the queue item. It does **not**
park an idle submission — queueing is selected solely by `isActive || …`, so on an idle session it
dispatches immediately, exactly like `chat:submit`. What it actually buys: (a) it passes `true` as the
submit callback's second argument, bypassing the "suggestions are showing, do not submit" guard; (b)
`wait: true` reaches the `prompt.submit` hook payload, so a hook can tell the two apart mid-turn.
Not built; the guard-bypass half is the useful part for us.

### 2.4 Oversized-draft truncation (§42.15.5) — the `[...Truncated text #N +M lines...]` species
`rat = 1e4, rU = 1000` (`257:411900`, verified). A draft over 10 000 characters is transformed by
`iat`: allocate a truncation id, walk existing placeholders back-to-front, cut non-text placeholders
that overlap the middle aside for reinsertion, **expand overlapping text placeholders in place**,
truncate to 500 chars from each end of the *transformed* string, reinsert the saved non-text
placeholders at offset 500 immediately before the marker, and rewrite the map. A no-op branch returns
the original input and map when the transformed string came out ≤ 1000 chars. `pasteChips.ts:61,84`
already *recognises* the `...Truncated text` species in both regexes but nothing in ccx produces it.
Reachable — pure local editor work.

### 2.5 `pasted-text-unavailable` repair notice (§42.15.5-42.15.6)
When a placeholder's backing content is gone at submit time canon repairs the prompt and tells the user
(`257:47420`): `"<label> #<id> is no longer available and was removed from the prompt"` /
`"… are no longer available and were removed from the prompt"`, under notification key
`pasted-text-unavailable`, label `Pasted text` or `Truncated text`. The removal is gated on the
placeholder **not** being an image: an unavailable `[Image #N]` is left in place in both the stripped
and expanded forms and is **never reported**. ccx has `lostPasteLabel()` (`promptHistory.ts:167`) for
the *history-recall* path only — the submit-time repair + notification is not built.

### 2.6 `#` Slack-channel completion and `:emoji:` completion (§42.16.3, §42.17.1 branches 6-8)
`#` completes Slack channel names when a *connected* MCP server whose name contains `slack` exists
(`257:404042`), the regex `/(^|\s)#([a-z0-9][a-z0-9_-]*)$/` matches, and the active slash command does
not declare `completesHashChannels`; debounced 150 ms, resolved by calling the `slack_search_channels`
MCP tool with `limit: 20, channel_types: "public_channel,private_channel"` and a 5000 ms timeout, capped
at 10 rows, and recognised channels are highlighted in the live input. Emoji: `:` + ≥2 chars opens a
menu; typing the closing `:` does an inline substitution; setting `emojiCompletionEnabled` (default
true). Both are `CM41` non-goals in the scorecard — but the scorecard lists `#channel` under "the other
completion sources" without saying it is the *only* thing `#` does upstream, which is now settled.

### 2.7 Bash-mode completion lanes (§42.17.1 branches 3, 4, 17)
In canon, bash mode replaces `@`-mentions with three different lanes: **path completion** on the bare
word (branch 3, `directory` type, Tab re-queries for the next segment), **shell-history ghost text**
(branch 4, corpus harvested from previously submitted `!` lines, 60 000 ms TTL, 50-entry cap on the
*load* only — live insertion is uncapped), and **shell completion** on Tab (branch 17, aborts its
predecessor through an `AbortController`, emits `tengu_shell_completion_failed`). ccx's `@`-scan is
deliberately mode-blind (`completions.ts:83-87`) and there is no bash lane at all — so in ccx bash mode
you get `@`-file completion where canon gives you bare-path completion. `CM41` covers the absence; the
*substitution* (we run the wrong lane rather than none) is the new fact.

### 2.8 `fileSuggestion` and `respectGitignore` settings (§42.18.7)
`fileSuggestion: { type: "command", command }` replaces the built-in index entirely — the command is run
with a session/hook payload plus `query`, stdout split on newlines, trimmed, empties dropped, capped at
15, 5000 ms timeout. Gating order is `disableAllHooks` → the capability gate → workspace trust →
managed-policy resolution; note that `CLAUDE_CODE_SIMPLE` / `--bare` does **not** disable it (the
polarity is inverted from what the table name suggests). `respectGitignore` (default true) has a
`/config` row labelled `Respect .gitignore in file picker`; the schema text is
`"Whether file picker should respect .gitignore files (default: true). Note: .ignore files are always respected."`
Both names are already in `src/appserver/configDomain.ts` as pass-through config keys; neither has any
effect in the ccx composer. There is **no setting or env var to bound the index size and none to disable
the `@` picker**.

### 2.9 `/focus` vs `app:toggleBrief` are two independent fields (§42.24.3)
`/focus` writes `briefTranscript`; `app:toggleBrief` (`ctrl+shift+b`) writes `isBriefOnly`; the state
reducer treats them as independent (`257:359110-359118`). The fullscreen requirement applies to
*enabling only* — outside fullscreen `/focus` first checks whether a focus state is already active and,
if so, turns it off and returns. `app:toggleBrief`'s gate blocks *enabling* only: an already-on brief
mode can always be turned off. Neither exists in ccx; both are cheap and the two-field distinction is
the kind of thing a reimplementation collapses by accident.

### 2.10 `CLAUDE_CODE_KB_COHESION_FIXES` — six behaviours behind one env read (§42.24.6)
`Z_()` at `257:336503`. It changes: `task:background` leaves the single-key pass unless rebound; Up/Down
walk a `queueEditIndex` selection instead of pulling the whole queue back; `escape` leaves a non-prompt
input mode from **any** cursor offset; Escape's queue handling in `onKeyDownBefore`; submission
behaviour and input-Escape ownership while a queue-edit selection is live; and exit-hint labels switch
from hard-coded key names to resolved keybinding display text. Scorecard `CM50` records the
per-item queue-edit cursor as "behind upstream's own flag, not built" — the other five effects have no
row. Not urgent (all are opt-in upstream), but if we ever build the queue-edit cursor these five come
with it.

### 2.11 Smaller ones, listed
* **Common-prefix Tab for `@` files** (§42.17.6): Tab computes the longest common prefix of the whole
  result set and, when longer than the typed token, inserts *only* the prefix and leaves the menu open;
  with exactly one match the prefix *is* that match, so the first Tab inserts it bare and a second adds
  the closer. Skipped when any row carries `replacement` metadata. Enter/click have no common-prefix
  phase. Already in the scorecard's "not built" table; the Enter/click asymmetry is new.
* **Tab / Enter / click are three different verbs** (§42.17.6). `Ii` branches on whether an index was
  supplied, so a click is "Enter with an explicit index", not "Tab". They diverge in `custom-title`,
  `file` and **all three** `directory` origins — e.g. for `directory`/`bash-path`, Tab inserts and
  re-queries, Enter inserts *nothing* and submits the input unchanged, click inserts and closes. ccx has
  hover/click (`CM33`, F10 T-HOVER) routed through the Enter arm; canon's click is *not* Enter for
  slash commands either (`shouldExecute: Eo === void 0` ⇒ clicking a slash-command row **fills without
  running it**, `257:404916`).
* **The submission block has three conjuncts, not one** (§42.17.7): rows showing **and** the submit
  callback's second argument was not `true` **and** not every row is a directory row, where
  "directory row" is literally `suggestion.description === "directory"` (`257:413293`).
* **Row selection is hover-first, then keyboard, then row 0** — with one exception that accepts nothing
  at all when a `dm-peer-` row is present with no hover and no keyboard selection.
* **Selection preservation across re-queries** is by id, defaulting to row 0 — **except** `file`,
  `slack-channel`, `custom-title` and the MCP template list, which start with **nothing** selected, and
  the slash menu, which preselects row 0 only when the top hit genuinely prefix-matches. ccx always
  resets to `index: 0` (`completions.ts:180-186`).
* **Race guards are per-provider, not universal** (§42.17.8) — and the `/add-dir` / `/cd` branch has
  **none**, so a slow listing can overwrite the menu after the user has typed on. Ours uses a single
  monotonic generation counter for the `@` walk, which is strictly better; recorded so nobody "fixes" it
  to match.
* **`chat:killAgents`' queue clearing is narrower than its admission** (§42.21.8): the gesture is
  admitted on any of six conditions but only clears the command queue when
  `runningAgent || armedRewind || passiveBackgroundTask`. 3000 ms window, hand-rolled — **not** the
  shared 800 ms `CI` helper.
* **`chat:stash` restores on the next ordinary submission, not on the draft going blank** (§42.21.10) —
  two sites, both showing `Draft restored`; a plain *empty* submit reaches neither (it returns at the
  empty-input guard, which also emits `prompt_submit_empty`).
* **External editor**: `$VISUAL` → `$EDITOR` → first of `code`, `vi`, `nano` on PATH; `code -w` and
  `subl --wait` get a wait flag injected; temp file `<tmpdir>/claude-prompt-<uuid>.md`; on non-zero
  exit / signal / spawn error the draft is left untouched and one of three messages is surfaced
  (§42.21.9, verbatim strings at `257:773222`). `externalEditorContext` (default **false**) prepends
  the last 50 lines of the previous assistant response under the header
  `# ─── Write your reply below this line ──────────────────────────`.
* **`/keybindings` reports success even when no editor launched** (§42.24.2) — a genuine upstream bug;
  do not reproduce it if we ever ship the command's open half.

---

## 3. Known gaps now specified

### 3.1 `@`-mention row (🟡) — the walk is now fully specified
§1's `@`-file row is 🟡 and the F5 "not built" table names the LCP Tab. Everything needed to close the
*index* half is now in §42.18.4/42.18.5: the exact `git ls-files` argv and timeout, the ripgrep argv,
the `.claude/<type>` six-type list `["commands","agents","output-styles","skills","workflows","routines"]`
with its 1 MiB regular-file filter and four-root gating, the background untracked pass, ancestor-chain
directory synthesis, and the `.ignore`/`.rgignore`-only pattern loader memoised on `` `${repoRoot}:${cwd}` ``.
Plus the refresh policy: `j = 5000` ms minimum interval, bypassed by a change in
`<repoRoot>/.git/index` mtime; `L = 1000` ms slow-scan threshold that suppresses further refreshes only
while that mtime is unreadable; demand-driven with no timer; `pathListSignature` = sampled FNV-1a over
~500 evenly spaced entries plus the last, returning `` `${count}:${hex}` ``.

### 3.2 Inline reverse-i-search (🟡) — the remaining strings
Ours has `search prompts:` / `no matching prompt:` and the last-occurrence walk. Canon adds the
vim-mode second dim line `esc i / for slash commands` on an empty query (`257:409717`), and — for the
picker — the two empty states we lack: `Couldn't read prompt history` (status `failed`) and
`Searching older prompts…` (status `scanning` with a query). Our overlay has `Loading…`,
`No matching prompts`, `No history yet` and `Search prompts · <scope>`, which match.
Also unbuilt: the ` · newest N only` title suffix when the scan is truncated, the `Filter history…`
filter placeholder, and the scan budget itself (`textLength + 256` per entry, stop at 16 777 216 —
**UTF-16 code units, not bytes**; a content-hashed paste body contributes **zero**).

### 3.3 Hint rows / prefix cells — `/btw`
`keys/hints.ts:244` says `/btw for side question` is omitted because the feature does not exist. §2.2
above gives the mechanism if the owner ever wants it; the string and its exact footer slot are
`257:410402`, alongside `! for shell mode` (`:410387`), `/ for commands` (`:410392`) and
`@ for file paths` (`:410397`) — all three of which we already carry verbatim.

### 3.4 Queued-message placeholder hints
Canon's two forms (§42.20.3): `Press up to edit queued messages, Enter to send them immediately`
(behind gate `tengu_jiggly_mochi`, default **false**) and `Press up to edit queued messages` (guarded
by `queuedCommandUpHintCount < 3`). The spec's finding matches our own recorded divergence: the counter
**is never incremented anywhere in the bundle**, so the `< 3` gate never closes and the hint shows every
time. Our deliberate invention (we do increment it) is therefore knowingly different from 2.1.257 too,
not just 2.1.220 — worth re-affirming rather than re-litigating.

---

## 4. Verbatim assets worth pinning (we do not have these verbatim)

1. **File-index scoring constants** — `var Uo = 16, jo = 8, fl = 6, hl = 4, Ko = 8, yl = 3, Sl = 1, _l = 100, zo = 64, nZe = 4;`
   [`257:487593`] plus `Ho` and the separator predicate `bl` (`/ \ - _ . space`) at `257:487738-487748`.
   Verified. Would replace `fileComplete.ts:110-121` wholesale.
2. **Ripgrep fallback argv** and the `git ls-files` argv — `257:514405`, `257:514344`. Verified.
3. **`hqn = ["commands","agents","output-styles","skills","workflows","routines"]` and `Doe = 1048576`**
   — `257:49123`. The `.claude/*` markdown index source.
4. **Draft-truncation constants and helper** — `var rat = 1e4, rU = 1000;` and `zeo` at
   `257:411900-411905`. Verified.
5. **Placeholder grammar** — `var z8e = String.raw\`Pasted text|Image|Audio|\.\.\.Truncated text\`` and the
   scanner `wGr` at `257:47158` / `257:47358`. We have equivalents in `pasteChips.ts:61,84`; the
   `uGr` and `dGr` siblings (the leading-path-then-placeholder regex) we do not.
6. **Unavailable-paste notice** — `lGn` at `257:47420` (both singular and plural forms) + key
   `pasted-text-unavailable`.
7. **Autocomplete caps** — `var SV = 15, vzt = 60;` [`257:404143`]: 15 rows, descriptions clamped to 60
   columns. Ours: `rankCandidates` cap 50, `rankCommands` uncapped.
8. **The unified `@` provider's Fuse config** — `threshold: 0.6`, keys/weights
   `displayText:2, name:3, server:1, description:1, agentType:3, uriTemplate:2`, `+0.15` penalty for
   `mcp_resource` rows, files enter the merge at a default score of `0.5` [`257:404170-404176`].
9. **Suggestion id shapes** — `file-<path>`, `mcp-resource-<server>__<uri>`,
   `mcp-template::<server>__<uriTemplate>`, `mcp-template-value::<server>__<resolved>`,
   `agent-<agentType>`, `slack-channel-<name>`, `emoji:<name>`, `dm-<name>`, `dm-peer-<kind>-<ref>-<n>`,
   `resume-title-<sessionId>`, `command-arg-<value>` [`257:404134`]. Ours mints bare paths/names.
10. **Insert formatting `Whe`** [`257:404284`] — confirms `mentionInsertion` (`completionTriggers.ts:102`)
    including that there is **no backslash escaping and no escaping of an embedded quote**.
11. **`Bte` / `fh`** [`257:48071-48075`] — the queue editability predicates (§1.6).
12. **Mode-ring `uje`** [`257:631197`] and its two gates `WJt` / `UW` [`257:631189`, `:631195`].
13. **Bash-mode shell resolution** — `Zk()` [`257:539497`] and `Fit()` [`257:294401`]. Note the
    settings-schema text is *wrong about itself*: it says "Defaults to 'bash' on all platforms (no
    Windows auto-flip)" while `Fit()` resolves by availability.
14. **External-editor strings** — the three failure messages [`257:773222`], the reference-block header
    and `R = 50` [`257:773251`], `var D = { code: "code -w", subl: "subl --wait" }` [`257:773197`].
15. **Message-selector strings** — restore-option labels, `Summarize from here` / `Summarize up to here`
    / `Never mind`, and the four consequence blurbs `f3e` [`257:401841`]; title `Rewind`; empty state
    `Nothing to rewind to yet.`
16. **`ctrl+c` exit message** — `Press <key> again to exit`, or `Press <key> again to detach (session
    keeps running)` in a background/catch-up session [`257:410013`].

---

## 5. Confirmations

* Two modes only (`prompt | bash`) — Wave C task 14's removal of the `#` memory mode is right, and
  canon's `#` is Slack-channel completion (§42.16.3). Our `promptMode.ts` matches `Gg`/`oT`/`vce`.
* Paste thresholds: `Fre = 800` chars **or** `max(0, min(rows-10, 2))` newlines; `CHIP_CHARS = 800`
  and `newlineThreshold(rows)` in `pasteChips.ts:20,296` match `257:460226` / `257:412740`.
* Paste normalisation order (ANSI strip → CRLF/CR→LF → tab→4 spaces) matches `257:412730`.
* Re-paste-to-expand and its `fue = 1e5` cap match `PASTE_LIMIT = 100_000` (`pasteChips.ts:215`).
* Placeholder strings `[Pasted text #N]` / `[Pasted text #N +M lines]` / `[Image #N]` match `257:47347`.
* Paste cache: `SGr = 1024` inline cutoff and directory name `paste-cache` match `pasteCache.ts` /
  `PASTE_INLINE_MAX`. (Canon's `V5t = 1e7` is an **in-memory retained-failed cap**, not a directory
  cap — our "no LRU fallback" divergence note is the right reading.)
* `history.jsonl` record shape `{display, pastedContents, timestamp, project, sessionId}` and the
  `K8e = 100` read cap match `promptHistory.ts:45,59` (`257:47346`, `257:47465`).
* Images/audio are never written to history — only their placeholder text survives in `display`; our
  `appendHistory` skip (`promptHistory.ts:104`) matches `u3t` (`257:47414`).
* `CLAUDE_CODE_SKIP_PROMPT_HISTORY` suppresses all writes — ours matches, including the truthy-vocabulary
  reading rather than a presence check.
* Up/Down recall: Up recalls only from **visual row 0**, Down from the last visual row; modified
  up/down ignored; the mode filter is captured on the first Up press and restricts to bash entries when
  the draft starts with `!`; **there is no prefix search**. All match `editor.ts` / `editorHistory.ts`.
* The queue-drain-on-Up guards: >1 suggestion showing swallows it; the caret must be before the first
  logical newline. `ChatComposer.tsx:879-891` matches §42.19.3 steps 1-2 and 4.
* History picker: default scope `everywhere`, `ctrl+s` cycles session→project→everywhere, substring tier
  then subsequence tier, title `Search prompts · <scope>`, empty states `No matching prompts` /
  `No history yet` / `Loading…`. `historySearch.ts` + `HistorySearchOverlay.tsx` match §42.19.4.
* `ctrl+s` is inert in the *inline* search (scope cycling belongs to the picker alone) — confirmed.
* Ghost text: mid-line `/` only, never a popup; requires the cursor exactly at the token end to render;
  first grapheme drawn as the inverted cursor cell with the remainder dimmed; accepted by
  `autocomplete:accept` (Tab by default), inserting `/name ` with a trailing space; right-arrow does
  **not** accept. `completions.ts:ghostText` + `ChatComposer.tsx:135-138` match §42.17.3.
* Mid-line `/` denylist `{add-dir, cd, resume, plugin, plugins, marketplace}` and the trigger's
  whitespace/CJK boundary — `completionTriggers.ts:15,37` matches `257:403706`/`:403801`/`:403802`.
* `@` trigger regex, token class, quoted form, and the "mid-word `@` never triggers" rule —
  `completionTriggers.ts:40` matches `Mzt` at `257:404238`.
* Wrapping selection in both popups, Tab-fills-never-executes, Enter-executes-unless-argument-hint —
  all match §42.17.6.
* Empty-state string `No commands match "<input>"` and its three guards match `257:404669`.
* Debounce: 50 ms for the file/`@` provider — `MENTION_WALK_DEBOUNCE_MS = 50` matches `257:404467`.
  **No loading spinner** in either.
* `Esc again to clear`: 800 ms arm, 1000 ms hint lifetime — `ChatComposer.tsx` matches `257:537857`.
* Ctrl-C: first press clears the input *and* arms exit, second within 800 ms exits; the shared window is
  `var a = 800` (`257:285963`), and the first-press clear is gated to a focused composer, which is
  exactly Wave 2 t3's fix.
* Ctrl-D: empty buffer → arm/exit; non-empty → forward-delete; `zt` passes no third callback so ctrl+d
  never clears the input. Canon's table also makes **Ctrl-D at the end of a non-empty line completely
  inert** (neither edits nor arms) — worth a spot-check against our reducer, but the shape matches.
* Ctrl-Z: process-group `SIGTSTP`, re-establish raw mode on `SIGCONT`, no default keybinding (it is
  intercepted in the raw key stream), listed terminal-reserved at *warning* severity. Matches ours.
* Clipboard-image hint: 1000 ms debounce, 30 000 ms cooldown, 8000 ms hint lifetime, armed only on a
  genuine unfocused→focused transition. `clipboardHint.ts:20-24` matches `257:725626-725641` exactly.
* `chat:imagePaste` on `ctrl+v` (mac/linux), `alt+v` (Windows), **both** on WSL — our unconditional
  double-bind is a superset and costs nothing.
* Backslash-then-Enter multi-line and the `hasUsedBackslashReturn` flag; `ctrl+j` newline.
* Undo restores text, cursor and `pastedContents` together.

---

## 6. Spec defects

None found in this lane. Every claim I spot-checked against the bundle held, including the three most
surprising ones: `#` is Slack channels and not memory (`257:404042`, `:404553`); the leading-`!` handler
never commits the sigil and leaves an existing buffer untouched (`257:412513-412524`); and
`chat:clearInput` and `chat:clearScreen` share one handler that only forces a redraw
(`257:413842-413849`, `:414012`).

Two places where the spec is *right but easy to misread*, worth flagging to whoever consumes this:
* §42.18.2's "score" is the **exposed** `rank/count` value (lower is better), not the raw `fuzzScore`
  (higher is better). Both appear in the same section; conflating them inverts the ranking.
* §42.15.7's `V5t = 1e7` is explicitly **not** a paste-cache directory cap. Our own tech-debt note about
  never sweeping the cache is unaffected — canon's disk path does no size accounting either
  (`OUd`'s retention sweep is a separate mechanism, not this constant).

### 251 → 257 hop
Nothing in this lane is a 257-only change. I checked the two findings most likely to be:
the mode ring is byte-equivalent at `251:756871-756885`, and `popAllEditable`'s mode-collapse is present
at `251:422301`. `chat:clearInput`/`chat:clearScreen` sharing one handler is already true at
`251:160283`; the *only* version-sensitive item is that at 2.1.220 `chat:clearInput` additionally armed a
2000 ms double-press to `/clear` (`220:495862`), which is gone by 2.1.251 — and which still never
cleared the composer buffer.

---

## 7. Re-verification (coordinator follow-ups)

### 7.1 Checkout correction

The first pass ran against `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK`, a frozen checkout
predating bl10. Everything above has now been re-checked against
**`/Users/new/Developer/GitHub/somersault/CC-to-SDK`** (`git log -1` = `e337ea7 C13b: record final
focused attestation`).

I diffed all 21 files this report cites between the two trees. **Sixteen are byte-identical** —
`keys/hints.ts`, `settingsRows.ts`, `queue.ts`, `fileComplete.ts`, `completions.ts`,
`completionTriggers.ts`, `promptHistory.ts`, `pasteChips.ts`, `pasteCache.ts`, `clipboardHint.ts`,
`editor.ts`, `bash.ts`, `promptMode.ts`, `modeTable.ts`, `historySearch.ts`,
`HistorySearchOverlay.tsx` — so every citation into them stands unchanged.

Five differ: `useChat.ts` (3591→3642 lines), `ChatComposer.tsx` (1554→1557), `ChatApp.tsx`
(2148→2166), `composerFrame.tsx` (171→176), `keys/bindings.ts` (→470). I re-read every cited hunk in
each. **No finding changed — the cited code is substantively identical in all five; only line offsets
moved.** Corrections applied in place above:

| Report item | Old cite | Correct cite (somersault) | Code identical? |
|---|---|---|---|
| §0.1 / §1.1 `interrupt()` empties the queue | `useChat.ts:3573-3580` | **`useChat.ts:3624-3631`** | yes, verbatim |
| §0.2 / §1.2 `LADDER` / `ladderNext` | `useChat.ts:167-169` | **`useChat.ts:174,176`** | yes, verbatim |
| §0.3 / §1.3 `drainNext()` head-only drain | `useChat.ts:3304-3322` | **`useChat.ts:3348-3366`** | yes, verbatim |
| §1.6 `popQueueToComposer()` | `useChat.ts:3405-3412` | **`useChat.ts:3449-3457`** | yes, verbatim |
| §1.8 `ESC_ARM_MS` / rewind hint | `ChatApp.tsx:153-155, 1405` | **`ChatApp.tsx:154-156, 1407`** | yes; `ESC_ARM_MS = 1500`, `ESC_REWIND_TEXT = "Press Esc again to rewind"` |
| §1.11 `VALID_ACTIONS` | `keys/bindings.ts:415-430` | **`keys/bindings.ts:420-448`** | yes; re-grepped the whole 420-448 block — all nine action names (`chat:submit`, `chat:queueSubmit`, `chat:newline`, `chat:undo`, `chat:stash`, `chat:clearScreen`, `history:previous`, `history:next`, `chat:workflowKeywordToggle`) are **still absent** |

Cites into the five changed files that did **not** move, re-confirmed line by line:
`ChatComposer.tsx:1053` (`"chat:clearInput": () => handleKey(CTRL_L)`, §1.4),
`ChatComposer.tsx:1379` (esc-clear hint, §1.8/§5), `ChatComposer.tsx:879-891` (`tryQueueDrain`, §5),
`ChatComposer.tsx:135-138` (ghost cursor rule, §5), `ChatComposer.tsx:114` and `:1206-1223`
(50 ms mention walk, §1.5/§5), `keys/bindings.ts:62` (`"ctrl+l": "chat:clearInput"`),
`composerFrame.tsx:57` (bash `!`+NBSP glyph, §1.9), `settingsRows.ts:27`
(`PERMISSION_MODE_OPTIONS = ["default","acceptEdits","plan","auto"]`, §1.2).

Also re-confirmed in `ChatApp.tsx` because §1.1's impact statement rests on it:
`ChatApp.tsx:681-685` — `onInterrupt` routes a busy Esc straight to `interrupt()`, so the
queue-emptying path in §1.1 is live; `ChatApp.tsx:686` — `onCycleMode` still calls `cycleMode()` with
no availability gate, so §1.2 is live.

The bl10 additions (`McpDialog.tsx`, `mcpDialogModel.ts`, `dialogs/keyhints.ts`, and the
`liveWindow.ts` / `streamingItems.ts` / `toolRenderer.tsx` / `Transcript.tsx` / `Line.tsx` /
`FullscreenViewport.tsx` / dialog-shell changes) are outside this lane and introduce no new composer,
autocomplete, history, queue or interrupt-ladder surface that changes any finding.

### 7.2 The Esc/queue path across 2.1.220, 2.1.251 and 2.1.257

`tui-ux.md` §1's queue row says the pop-back-to-composer behaviour was matched to canon 2.1.220
("fixed 2026-07-31, F0, t3, CM49"). I read the cancel ladder in all three bundles. **All three agree,
and none of them pops the queue while a turn is running.** The shape is the same in every version:
running turn → abort and *return*; only if nothing is running does the queue branch get a chance.

**2.1.257** — `cli.pretty.js:403192-403198`
```js
403192:  if (ue !== void 0 && !ue.aborted || Se)
403193:    return lo.current = Date.now(), s("tengu_cancel", Ko), I(), !0;   // ← running turn: abort, RETURN
...
403194:  let … xr = Tqn(Ye, Sr) && Ce !== void 0,                            // Sr = draft is empty; Tqn = queue has a Bte-editable entry
403197:  if (xr && Ce)
403198:    return Ce(), !0;                                                   // ← the queue pop, reachable ONLY past 403193
```
`Ce` is the pop-to-composer callback. `xr` carries **no** `!wn` guard, so Escape *does* reach it — but
only when idle. The two later branches (`403199`, `403202`) are background work and both open with
`!wn`, which Escape can never satisfy (`403218` always passes `suppressBackgroundAgentKill: !0`).
**Verdict: Esc during a turn → interrupt only, queue left queued. Esc while idle → queue pops.**

**2.1.251** — `cli.pretty.js:153634-153640`
```js
153634:  if (Z !== void 0 && !Z.aborted || re)
153635:    return Ht.current = Date.now(), s("tengu_cancel", Uo), x(), !0;   // ← running turn: abort, RETURN
153636:  let … hi = d9n(ot, mr) && ue !== void 0,                            // mr = IZ() === "" (draft empty)
153639:  if (hi && ue)
153640:    return ue(), !0;                                                   // ← the queue pop
153641:  if (!Xo && Tn && !qt && !Kn && !cje())                               // background work, Escape-suppressed
```
Structurally identical to 257, same variable roles, same ordering. **Verdict: identical to 2.1.257.**

**2.1.220** — `cli.pretty.js:499236-499256`, component destructuring at `:499213`
```js
499236:  D = useCallback((K = !1) => {                                       // K = "suppress background-agent kill"
499240:    if (i !== void 0 && !i.aborted || s) {
499241:      O("tengu_cancel", oe), t();
499242:      return;                                                          // ← running turn: abort, RETURN
499243:    }
499244:    if (N0u()) {
499245:      if (a) {                                                         // a = `popCommandFromQueue` (:499213)
499246:        a();
499247:        return;                                                        // ← the queue pop
499248:      }
499249:    }
499250:    if (!K && x) { if (R()) { … } }                                    // x = a running agent; R = kill them
```
and the registration `Mn("chat:cancel", () => D(!0), { context: "Chat", isActive: j })` at `:499258`.
Note `a` is literally the prop `popCommandFromQueue` (`:499213`), and `x`/`R` are the running-agent
test and the background-agent killer, not the queue.
**Verdict: same three-step ladder. Esc during a turn → abort and return, queue untouched; the pop at
`:499244-499248` is the idle branch. Additionally, because Escape passes `K = !0`, the third step is
unreachable from Escape at 2.1.220 too.**

**Conclusion.** §1.1 holds against 2.1.220 as well as 2.1.251 and 2.1.257 — it is not a hop artefact
and not a case where our pty evidence beats the spec. What the F0/t3/CM49 note got right is that a
queue pop into the composer *exists* in canon; what it got wrong is *when*. Canon pops the queue
**only when there is nothing running**; ccx pops it **precisely when something is running**, which is
the one case canon reserves for a bare interrupt. The two behaviours are near-complementary, so the
row reads as matched while the observable behaviour is inverted. Recommended framing for the owner:
this is a mis-scoped port, not an invented divergence — the fix is to move the pop from
`useChat.interrupt()` (`useChat.ts:3624-3631`) to the idle arm of `ChatApp.onInterrupt`
(`ChatApp.tsx:681-685`), where `state.busy` is already the discriminator, and canon's extra condition
`Sr`/`mr` (the draft must be empty for a bash entry to be admitted) is §1.6's `Bte`.
