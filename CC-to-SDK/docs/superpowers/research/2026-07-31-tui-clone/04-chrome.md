# Domain 4 — Chrome around the conversation

Claude Code **2.1.220** (`~/claude-code-bundle/2.1.220/cli.pretty.js`, 579,698 lines) vs.
`CC-to-SDK/harness/src/tui/`.

All upstream line numbers are `cli.pretty.js` line numbers. Identifiers are minified; every claim
below is anchored on a string literal or a structural read of the cited line. Inferences are marked
**[inf]**. Where I could not settle something from source I write **not determined**.

---

## 0. Verdict on the prior finding

| Prior claim | Verdict | Evidence |
|---|---|---|
| Footer contains no **model name** | **Holds.** | The footer tree is `oVf` (L494378) → `[statusLine block, hint row]` + `[chips row, notification column]`. No model is rendered anywhere in it. Model appears in the **startup header** (`pQo`, L453220 → `dQo` = `model+effortSuffix`), in `/status`, and in the statusLine JSON (`model.id` / `model.display_name`, L189000). |
| Footer contains no **cost** | **Holds.** No cost string in the footer subtree. Cost is available only via `/cost` and via the statusLine JSON's `cost` object (L484846 — see §2, it is *undocumented* in the setup-agent schema). |
| Footer contains no **git branch** | **Holds** — with a caveat. No branch string. But the footer *does* carry a **PR badge** for the current branch (`u4e` at L494443, gated by `prStatusFooterEnabled`, L494218), and a **worktree** name never reaches the footer. |
| Footer contains no **working directory** | **Holds.** cwd is in the startup header (`AMe(cwd)`, L453256/L453293) and the statusLine JSON, not the footer. |
| Those four are exposed "only to a user-configured `statusLine`" | **Partly.** They are exposed to `statusLine` (§2), *and* model + cwd are on the startup header, *and* all four are in `/status`. The footer is the surface that omits them. |
| Context indicator reads `23% until auto-compact`, never "context left" | **Holds exactly.** L488935: `` let Hkb = _kb ? `${100 - d6f}% context used` : `${d6f}% until auto-compact`; ``. `grep -c 'context left' cli.pretty.js` → **0**. |

Two corrections to the earlier pass, both in §3:

- The irregular past-tense table has **77 entries, not 71** (L427494, `Jvr`). Full table extracted below.
- It is **not** used by the spinner. It conjugates the **grouped tool-use activity line** in the
  transcript (L428041) — the "Thought for 12s, edited 3 files, …" summary row. The single-subagent
  rule is real (`P === 1 && !hasSubagentMessages`), just attached to a different widget.

---

## 1. The footer / status area

### 1.1 Structure

`oVf` (L494378) renders, inside `<Box width={columns} flexDirection={row|column} flexWrap="wrap"
alignItems="flex-start" paddingLeft={2} paddingRight={2} columnGap={1}>` (L494654):

```
┌ left column (Ftl, L494643) ────────────────┐  ┌ right column (Wtl / $tl, L494670) ─┐
│ 1. statusLine block   (Otl, L494630)       │  │ A. notification column (zRr)        │
│ 2. hint / mode row    (Ntl → Wci → ctl)    │  │ B. chips row (Jci, L494399)         │
└────────────────────────────────────────────┘  └─────────────────────────────────────┘
                       + workflow strip (uZa, L494660)
```

Column direction flips to `"column"` when a screen reader is active (`WAt = xmk ? "column" : "row"`,
L494622). The right column is **suppressed entirely in fullscreen mode** (`Utl = LRn ? null : <zRr…>`,
L494639, where `LRn = ds()`).

### 1.2 The hint row (`ctl`, L493800) — the hint ladder

Two implementations. A "dense" one behind the remote gate `Ke("tengu_copper_thistle", false)`
(L493818) and the shipped one. The dense branch computes a single winner into `I0` (L493900-493916),
which is the clearest statement of the ladder; the shipped branch pushes a list `G2` with the same
precedence expressed as sequential guards. **Dense ladder, first match wins:**

| # | `I0` value | Condition | Rendered literal |
|---|---|---|---|
| 1 | `warmup` | voice enabled **and** mic warming | `<hZe/>` voice-warmup widget |
| 2 | `interrupt` | viewing an in-process teammate that stopped | `esc to return to team lead` |
| 3 | `agents` / `none` | `!denseShowHint` | left-arrow agents widget, or nothing |
| 4 | `interrupt_agents` / `interrupt` | `isLoading && !isSelecting` | `esc to interrupt` (+ ` · ` + agents widget) |
| 5 | `memories` | session memories present | `enter to view memories` |
| 6 | `manage` | ≥1 task, or tasks selectable | `down to manage` / `enter to view tasks` |
| 7 | `ctrl_t` | todo panel toggleable | `ctrl+t to show tasks` / `…to hide tasks` |
| 8 | `agents` | left-arrow detach available, empty input | left-arrow agents widget |
| 9 | `voice` | voice idle + hint budget unspent | `hold <key> to speak` |
| 10 | `cycle` | non-default mode and mode is settable | `(shift+tab to cycle)` |
| 11 | `shortcuts` | `showHint && !isSelecting` | `? for shortcuts` (L493968) |
| — | `none` | otherwise | nothing |

In the **shipped** branch the same content is assembled as an ordered list `G2` (L494046-494190),
separated by a dim `" · "`, in this render order (L494192):

```
[mode chip] · [bg-detach] · [PR status] · [footer links] · [tasks chip] · [memories chip] · [hints…]
```

`? for shortcuts` is pushed **only** when everything else is empty *and* the mode chip is in the
default mode: `if (G2.length === 0 && !TZe && !(ttl && HRn) && !Yjt && Zjt.length === 0 && !ERn &&
Vjt)` (L494096). `HRn = !aPi(mode)` = "mode is not default", so a *non-default* mode chip suppresses
the shortcuts hint while the *default* chip does not.

### 1.3 The mode chip — exact literals

Table at **L41541** (`gGl`), accessors `Que`=indicator, `t1e`=symbol, `$O`=color (L41522-41530):

| mode | title | shortTitle | **indicator (footer)** | symbol | color |
|---|---|---|---|---|---|
| `default` | Manual | Manual | `manual mode` | `⏸` (U+23F8) | `inactive` |
| `plan` | Plan | Plan | `plan mode` | `⏸` | `planMode` |
| `acceptEdits` | Accept edits | Accept | `accept edits` | `⏵⏵` (U+23F5 ×2) | `autoAccept` |
| `bypassPermissions` | Bypass Permissions | Bypass | `bypass permissions` | `⏵⏵` | `error` |
| `dontAsk` | Don't Ask | DontAsk | `don't ask` | `⏵⏵` | `error` |
| `auto` | Auto | Auto | `auto mode` | `⏵⏵` | `warning` |

Rendered as `` `${symbol} ${indicator} on` `` plus, **only for non-default modes and only when the
footer is not crowded**, `` ` (shift+tab to cycle)` `` (L494038). The chip renders in **every** mode
including default (`ttl = dne && jOb ? … : null`, where `jOb` = "this session may change the
permission mode"). So a fresh default session's footer is:

```
  ⏸ manual mode on · ? for shortcuts
```

Confidence: high. The `!(ttl && HRn)` guard at L494096 only makes sense if `ttl` is non-null in
default mode. Screen-reader announcement on cycle is `` `[${Que(mode)} on]` `` (L495914).

Bash mode short-circuits the whole row: `! for shell mode` in `color: "bashBorder"` (L493866).

### 1.4 Other footer elements, with their conditions

**Left column, hint row (`ctl`)**
| Element | Literal | Condition | Line |
|---|---|---|---|
| stash chip | `› stashed` (`Ge.pointerSmall` = U+203A) | `hasStash` | 494340 |
| `/goal` chip | `◎ /goal active (2m 3s)` — `Y3r` = U+25CE, pulsing color over 20 frames | `activeGoal.setAt` set | 488962-489000 |
| tasks chip | count badge / `↓ to view` | ≥1 running task | 492905 |
| memories chip | `` `${n} ${memory|memories} recalled` `` | ≥1 session memory | 492973 |
| feedback drafts | `` `${n} feedback draft(s)` `` | `feedbackDrafts` queue | 493618 |
| selection hint | `option+click to native select` / `shift+click to native select` / `ctrl+c to copy` | fullscreen + selection settings | 494155-494165 |
| PR status | PR badge or `pur(prNeedsAuth)` | `prStatusFooterEnabled ?? true` | 493877, 494218 |

**Right column, notification stack (`$Ja`, L494452)** — rendered top-to-bottom:
| Element | Literal | Condition | Line |
|---|---|---|---|
| voice | `● REC · tap to send` / `listening…` | recording/processing | 489050 |
| overage | `Now using usage credits` | `isUsingOverage && !team/enterprise` | 489498 |
| apiKeyHelper slow | `apiKeyHelper is taking a while (12s)` | helper >10 s | 489500 |
| auth error | `Not logged in · Run /login`, or `Authentication error · Try again` under `CLAUDE_CODE_REMOTE` | apiKeyStatus invalid/missing | 489502 |
| verbose tokens | `` `${tokenUsage} tokens` `` | **`verbose` only** | 489504 |
| pro-plan reset | server-provided reset string, refreshed every 30 s | pro plan | 489476 |
| auto-updater | version/updating chips | native vs package-manager install | 488784 |
| closed issues | `✓ Your issue #123 has been closed. Thanks for reporting!` | polled | 493240 |
| sandbox | `⧈ Sandbox blocked 3 operations · ctrl+o for details · /sandbox to disable` | sandbox violations, 5 s window | 489030 |
| **notification slot** | whatever is `current` in the queue | see §1.6 | 488834 |

**Right column, chips row (`Jci`, L494399)** — joined by dim `" · "`:
`hipaa` badge · cloud-session link (`◉ <name>`) · IDE selection (`⧉ 12 lines selected` / `⧉ In
foo.ts`, L494494) · `Debug` · bridge chip · PR badge · mode labels (`focus`, `memory paused`, joined
with `" & "`, L494464).

### 1.5 The context indicator

`Hli` (L488912). It is **not a permanent chip** — it is pushed into the notification queue under
key `token-warning`, `priority:"medium"`, `timeoutMs: 18_000_000` (5 h), `exemptFromDiffPanelHold`
(L489324), and only while `level !== "ok"`.

Level computation (`uOu`, L163990; window helpers L164138):

```
usable        = contextWindow − 20_000            (Tbe, L164100 — reserved output)
compactAt     = usable − 13_000                   (Sfo, L163981)
effective i   = autoCompactEnabled ? compactAt : usable
warnAt        = i − 20_000
blockAt       = (fullWindow − reservedOutput) − 3_000
pctLeft       = max(0, round((i − used) / i × 100))

used ≥ blockAt              → level "blocked"
autoCompact && used ≥ compactAt → level "compact"
used ≥ warnAt               → level "warn"
otherwise                   → level "ok"           (indicator hidden)
```

Rendered text (L488932-488942):

| Case | Literal | Style |
|---|---|---|
| auto-compact on, window came from a model default | `` `${pctLeft}% until auto-compact` `` | `dimColor`, `wrap:"truncate"` |
| auto-compact on, window resolved by `source==="auto"` | `` `${100 - pct}% context used` `` | same |
| either of the above + a warning suffix | `` `${text} · ${suffix}` `` | same |
| auto-compact off | `` `Context low (${pctLeft}% remaining) · Run /compact to compact & continue` `` | `color:"error"` |
| auto-compact off + `DISABLE_COMPACT` | `` `Context low (${pctLeft}% remaining)` `` | `color:"error"` |

Suppressed entirely while `MRr()` (a diff-panel / external-store flag) or `isBriefOnly` is true
(L489322).

### 1.6 The notification queue = the real "hint ladder"

`Ds()` (L393964). Priorities `{immediate:0, high:1, medium:2, low:3}` (L394062); lowest number
wins (`Iq_`, L394054). Default display time **8000 ms** (`fXs`, L394058); per-item `timeoutMs`
overrides. Behaviors:

- `priority:"immediate"` **preempts** the current item and requeues it (unless the preempted item is
  itself immediate without `requeueOnPreempt`).
- `fold(prev, next)` merges a repeat of the same `key` in place instead of queueing a duplicate.
- `invalidates: string[]` drops named keys from the queue.
- `pinned: true` bypasses the queue into a persistent `pinned` list.
- Items carry either `text` (+`color`; dim when no color), `segments[]`, or `jsx` (L488834-488870).

Sample producers: `env-hook` (low/medium, 5 s/8 s, L489294), `external-editor-hint`
(`priority:"immediate"`, 5 s, `ctrl+g to edit in <editor>`, L489307), `token-warning` (medium, 5 h),
`idle-return-hint` (medium, `timeoutMs: 2147483647` — effectively permanent —
`new task? /clear to save 45.2k tokens`, L549225), `stop-hook-error` (immediate,
`Stop hook error occurred · ctrl+o to see`, L237210), `compaction-blocked-by-hook` (immediate,
warning, L307929), `auto-mode-gate-plan-exit-fallback` (immediate, warning, 10 s, L229950).

---

## 2. The `statusLine` extension point

### 2.1 Placement

`b0b` (L484852), mounted as `Otl` in the footer's left column **above** the hint row (L494630),
gated on `mode === "prompt" && !smallTerminal && !exitMessage.show && !isPasting &&
statusLineIsConfigured`. Container: `<Box paddingX={padding ?? 0} gap={2}>` (L484940). Text is
rendered `dimColor` with `wrap: "truncate"`; **multi-line output is supported** — the text is split
and rendered as a column (`g3f`, L484942). Config shape is parsed by `sMt` (L147037) and supports
`{ type:"command", command, padding?, refreshInterval?, hideVimModeIndicator? }` (the last two read
at L484917 and L494636).

### 2.2 The stdin JSON — documented schema

Verbatim from the `statusline-setup` agent prompt, **L188988-L189060**:

```jsonc
{
  "session_id": "string",              // Unique session ID
  "session_name": "string",            // Optional: name set via /rename
  "prompt_id": "string",               // Optional: UUID of the prompt (same as OTel prompt.id)
  "transcript_path": "string",
  "cwd": "string",
  "model":     { "id": "string", "display_name": "string" },
  "workspace": { "current_dir": "string", "project_dir": "string", "added_dirs": ["string"],
                 "git_worktree": "string",          // optional, linked worktree
                 "repo": { "host": "string", "owner": "string", "name": "string" } },
  "version": "string",                              // e.g. "2.1.220"
  "output_style": { "name": "string" },
  "context_window": {
     "total_input_tokens": number, "total_output_tokens": number,
     "context_window_size": number,
     "current_usage": { "input_tokens": number, "output_tokens": number,
                        "cache_creation_input_tokens": number,
                        "cache_read_input_tokens": number } | null,
     "used_percentage": number | null, "remaining_percentage": number | null },
  "effort":   { "level": "low"|"medium"|"high"|"xhigh"|"max" },   // only if model supports effort
  "thinking": { "enabled": boolean },
  "rate_limits": { "five_hour": { "used_percentage": number, "resets_at": number },
                   "seven_day": { "used_percentage": number, "resets_at": number } },
  "vim":      { "mode": "INSERT"|"NORMAL"|"VISUAL"|"VISUAL LINE" },
  "agent":    { "name": "string", "type": "string" },
  "pr":       { "number": number, "url": "string",
                "review_state": "approved"|"pending"|"changes_requested"|"draft" },
  "worktree": { "name","path","branch","original_cwd","original_branch" }
}
```

### 2.3 The stdin JSON — what the code *actually* emits

`H0b` (L484846) emits **five documented-schema-omitted fields**. This is the payload builder, not
the prompt, so it is authoritative:

```js
cost: { total_cost_usd, total_duration_ms, total_api_duration_ms,
        total_lines_added, total_lines_removed },
exceeds_200k_tokens: boolean,
fast_mode: boolean,
remote: { session_id },        // present when running as a remote session
pr:  { …, kind }               // `kind` is emitted but undocumented
```

Everything documented is emitted; `rate_limits` percentages are `utilization * 100` and `resets_at`
is Unix **seconds** (L484846). **This is where cost lives** — it exists nowhere else in the chrome.

### 2.4 Execution, cadence, failure

Runner `B8s` (L366191):

- Skipped when: non-interactive (`iee()`), the `statusLine` source is disabled (`fd("statusLine")`),
  or **workspace trust is not accepted** (`W7e()`) — the latter also raises a setup-issue counter and
  logs `Status line command skipped: workspace trust not accepted` (L484928).
- Runs via the shared external-hook runner (`Y2o`) with an `AbortController`; the previous run is
  aborted before a new one starts (L484877).
- **Output handling:** stdout is trimmed, split on `\n`, blank lines dropped, rejoined with `\n`
  (L366213). Empty output ⇒ the status line is cleared. stderr is logged only.
- **Failures:** any non-zero exit ⇒ **nothing is rendered** (no stale text kept, no error shown to the
  user); one telemetry event is emitted per session classified as `spawn_failed` / `timeout` /
  `nonzero_exit`, and exceptions as `exec_error` (L366222-366232).
- **Timeout:** the elapsed-vs-`xm` comparison is what classifies a timeout. `xm = 600000` is defined
  at L223612 — but in a *different* module scope, so I cannot prove it is the binding in scope at
  L366191. **Not determined**; assume "a large timeout, likely 10 min", and treat the effective cap as
  the hook runner's own. Needs a probe if the number matters.

**Cadence** (`b0b`, L484895-484925):
1. On mount.
2. **Debounced 300 ms** (`Dee(…, 300)`) on any change to: last assistant message id, `tokenUsage`,
   `permissionMode`, `vimMode`, `mainLoopModel`, `fastMode`, `effortValue`, `thinkingEnabled`,
   `prStatus`.
3. Optional polling: `Lc(refresh, refreshInterval * 1000)` when `statusLine.refreshInterval` is set
   (clamped to ≥1 s).
4. Immediately when the `command` string itself changes.

Also: if `disableAllHooks: true` while a statusLine is configured, it logs
`Status line is configured but disableAllHooks is true` (warn) but still runs (L484931).

---

## 3. The spinner

### 3.1 Glyphs and timing

Base sequence (`HYe`, L395923), cached on `process.env.TERM`:

```js
TERM === "xterm-ghostty" ? ["·","✢","✳","✶","✻","✻"]     // U+00B7 2722 2733 2736 273B 273B
                         : ["·","✢","✳","✶","✻","✽"]     // U+00B7 2722 2733 2736 273B 273D
```

`MGo = [...base, ...base.reverse()]` (L408345) → 12 frames. **But the frame index is not a
tick counter:** `BtH(t) = Math.round(triangle(t, 2000) * (base.length − 1))` (L407870) — a
**2000 ms triangle wave over indices 0…5**. The animation clock ticks at **100 ms**, or **50 ms**
while `mode === "requesting"` (`zp(t ? null : e === "requesting" ? 50 : 100)`, L407893). Reduced
motion (`prefersReducedMotion`, or VS Code + a remote gate) replaces the pulse with a static
`●` (U+25CF, `wGo` at L407791) whose brightness breathes on a 2000 ms cycle (L407688).

The small dot spinner used elsewhere (`Su`, L408243) *does* advance one frame per 120 ms over the
full 12-frame array.

### 3.2 The verb

`n3t()` (L406837) returns `$ta` — **186 verbs**, alphabetical, at L406847 — merged with the
`spinnerVerbs` setting: `{ mode: "append" | "replace", verbs: string[] }` (schema at L42035).

Selection: `const [q] = useState(() => N1(n3t()))` — sampled **once per spinner mount** (L408149).
The displayed message is then a **fallback chain**, not the verb alone:

```js
U = (overrideMessage ?? activeTodo.activeForm ?? activeTodo.subject ?? (defaultVerb || randomVerb)) + "…"
```

So whenever a live todo list has a non-pending, non-completed item, **the spinner shows that todo's
`activeForm`**, and the random verb is only the last resort. The verb text is shimmered (a moving
bright band, `KEr` at L407452, glimmer index derived from `columns` and elapsed).

### 3.3 The parenthetical tail

Assembled at L408043-408049 into `(a · b · c · d)` with dim parens, in this order, each dropped when
the terminal is too narrow (width budget computed at L408033-408041):

| Slot | Literal | Condition |
|---|---|---|
| `spinnerSuffix` | caller-supplied (e.g. hook `statusMessage`) | when passed |
| elapsed | `ra(ms)` → `3s` · `1m 05s` · `2h 03m` · `1d 04h` (L107079) | `verbose \|\| hasStatus \|\| tokens>0 \|\| elapsed>16 s` |
| tokens | `↓ 1.2k tokens` (arrow `↑` while `requesting`, `↓` otherwise — `I0p`, L408020) | tokens > 0 and width allows |
| status | see below | width allows |

The status slot's text (L408005-408019):

| `N.kind` | Literal |
|---|---|
| `tool-running` | `` `running tool for ${ra(ms)}` `` |
| `tool-done` | `` `ran tool for ${ra(ms)}` `` |
| `thinking` | `` `${thinkingWord}${effortSuffix}` `` |
| `thought-for` | `` `thought for ${n}s` `` |
| `none` | *(nothing)* |

`thinkingWord` escalates with thinking duration (`GtH`, L407874):
`< 10 s` → `thinking`; `≥ 10 s` → `still thinking`; `≥ 20 s` → `thinking more`;
`≥ 30 s` → `thinking some more`; `≥ 45 s` → `almost done thinking`.

**There is no `esc to interrupt` in the spinner.** That string lives in the footer hint ladder and
only while `isLoading` (§1.2 rung 4, `F8f` at L494203).

Token count is an **animated estimate**, not a real counter: `tokens = round(responseLength / 4)`
ramped toward the true value at 50 ms steps (L407927-407945).

### 3.4 What else rides along

Below the spinner row (`q0p`, L408160):

- **Compaction progress bar**: a `pill`-variant bar plus `` `${pct}%` `` when compacting and the
  terminal is ≥ 8 columns of bar (L408052).
- **Next todo**: `` `Next: ${subject}` `` — takes precedence over tips.
- **Tip**: `` `Tip: ${text}` ``. Suppressed by `spinnerTipsEnabled: false`. Two hard-coded overrides
  beat the catalog (L408158): elapsed > **30 min** → `Use /clear to start fresh when switching topics
  and free up context`; elapsed > **30 s** and the user has never used `/btw` → `Use /btw to ask a
  quick side question without interrupting Claude's current work`.
- **Retry banner** replaces the whole row (`qyn`, L408062): `Waiting for API response · will retry in
  1m 05s · check your network` (stalled), or `<error> · Retrying in 30s (resets 3:00 PM) · attempt
  2/5` (retrying).
- **Brief/remote variant** (`ona`, L408186): a dots animation `"." → ".." → "..."` at 300 ms,
  `Reconnecting…` / `Disconnected` in error color, and a right-aligned `` `${n} in background` ``.

### 3.5 Subagents — the conjugation table (corrected)

Not in the spinner. In the **grouped tool-use summary row** (L428041):

```js
let Fe = NAH(e.messages),                                   // does the group contain subagent messages
    ge = P === 1 && !Fe ? e.agentDescriptions?.[0] : void 0, // exactly one agent, no nested messages
    Oe = ge !== void 0 ? s8p(ge) : void 0;                   // conjugate
// running → bold Oe.running ; finished → bold Oe.done
// fallback when not conjugatable: "running agent · <description>" / "ran agent · <description>"
// fallback for N agents:         "running 3 agents" / "ran 3 agents"
```

`s8p` (L427477) returns `{ running, done, infinitive }` by conjugating the **first word** of the
description, preserving capitalization, handling `re-`/`un-`/`over-`… prefixes (`XSH`, L427497), and
also conjugating verbs after a `and `/`then ` connective (`qqo`, L427475, using the allow-list `zSH`
of ~200 known verbs). `r8p` (L427453) refuses to conjugate when the word is <2 or >16 chars,
non-alphabetic, ALL CAPS, already a past participle (`Qfa`), or already ends in `ing`/`ed`/`s`.

**Irregular past-tense table `Jvr`, 77 entries** (L427494):

```
begin→began, bind→bound, bring→brought, build→built, buy→bought, catch→caught, choose→chose,
come→came, cut→cut, debug→debugged, dig→dug, do→did, draw→drew, feed→fed, feel→felt,
fight→fought, find→found, fly→flew, forget→forgot, freeze→froze, get→got, give→gave, go→went,
have→had, hide→hid, hit→hit, hold→held, input→input, keep→kept, know→knew, lead→led,
leave→left, let→let, lose→lost, make→made, mean→meant, meet→met, override→overrode,
overwrite→overwrote, pay→paid, put→put, quit→quit, read→read, rebuild→rebuilt, redo→redid,
rerun→reran, reset→reset, rewrite→rewrote, run→ran, see→saw, seek→sought, send→sent, set→set,
show→showed, shut→shut, sit→sat, sleep→slept, spend→spent, spin→spun, split→split,
spread→spread, stand→stood, sweep→swept, sync→synced, take→took, teach→taught, tear→tore,
tell→told, think→thought, throw→threw, understand→understood, undo→undid, unset→unset, win→won,
unwrap→unwrapped, unzip→unzipped, write→wrote
```

Companion tables: **`Qvr`, 26 irregular gerunds** (`begin→beginning`, `commit→committing`,
`control→controlling`, `debug→debugging`, `emit→emitting`, `equip→equipping`, `forget→forgetting`,
`format→formatting`, `input→inputting`, `occur→occurring`, `omit→omitting`, `output→outputting`,
`permit→permitting`, `prefer→preferring`, `quit→quitting`, `refer→referring`, `rerun→rerunning`,
`reset→resetting`, `screenshot→screenshotting`, `snapshot→snapshotting`, `submit→submitting`,
`sync→syncing`, `transfer→transferring`, `unset→unsetting`, `unwrap→unwrapping`, `unzip→unzipping`)
and `Qfa`, a past-participle blocklist.

### 3.6 Our verb list has drifted

Our 187-verb list at `spinner.ts:17` is upstream's 186 **plus `"Evaporating"`** (line 26), which
does not exist in 2.1.220. Order and spelling otherwise match exactly, including `Flambéing` and
`Sautéing`. This is a "we ship more than upstream" defect.

---

## 4. Startup

### 4.1 Two different first screens

**Common path** (returning user, no unseen release notes, no `CLAUDE_CODE_FORCE_FULL_LOGO`) →
`pQo` (L453220). No border. A mascot glyph block to the left, and to the right:

```
Claude Code v2.1.220                       ← bold "Claude Code", dim "v…"
<model><effortSuffix> · <billingType>      ← both dim; splits to two lines if too wide
@<agentName> · <truncated cwd>             ← dim; cwd middle-elided by AMe (L452750)
```

Plus a trial badge (` · 14 days left`-style, `T6t`) in `warning`/`suggestion` color.

**First run / unseen release notes** → the boxed welcome (L453390-453488):
`borderStyle:"round"`, `borderColor:"claude"`, `borderText: " Claude Code v2.1.220 "` positioned
`top`/`align:"start"` at `offset: 3` (or `" Claude Code "` at offset 1 in compact layout). Inside,
`flexDirection` is `"row"` when `columns >= 70` else `"column"` (`I0r`, L452722):

```
┌ Claude Code v2.1.220 ─────────────────────────┬──────────────────────────┐
│  Welcome back <name>!            (bold)       │ Tips for getting started │
│  <mascot>                                     │ ✓ Run /init to create …  │
│  <model+effort> · <billing> · <org>   (dim)   │   Ask Claude to create … │
│  @<agent> · <cwd>                     (dim)   │ ──────────────────────── │
│  <trial badge>                                │ What's new               │
│                                               │  • <release note line>   │
│                                               │ /release-notes for more  │
└───────────────────────────────────────────────┴──────────────────────────┘
```

Greeting (`A6t`, L452741): `` `Welcome back ${name}!` `` when a name is known and ≤20 chars, else
`Welcome back!`. Left column width from `wLa`/`TLa` (L452727-452740); max 50 (`vdf`).

### 4.2 The startup "Tips for getting started" feed

`YLa` (L453017) — a **completion checklist**, not static bullets. Items come from `hBs()`
(L316062):

```js
[ { key:"workspace", text:"Ask Claude to create a new app or clone a repository",
    isComplete:false, isCompletable:true, isEnabled: <in a workspace> },
  { key:"claudemd",  text:"Run /init to create a CLAUDE.md file with instructions for Claude",
    isComplete:<CLAUDE.md exists>, isCompletable:true, isEnabled: <not in a workspace> } ]
```

Disabled items are dropped; **incomplete items sort first**; completed items get a `✓ ` prefix
(`Ge.tick`). If `cwd === os.homedir()`, one extra line is appended: `Note: You have launched claude
in your home directory. For the best experience, launch it in a project directory instead.`
The "What's new" feed (`KLa`, L453013) shows ≤3 release-note lines with footer `/release-notes for
more` and empty message `Check the Claude Code changelog for updates`.

### 4.3 The full Clawd ASCII banner

`PLe` (L400723). This is **not** the REPL startup screen — it is used by `claude setup-token`
(L411284), the onboarding flow (L553487), and the doctor/migration screens (L553952, L554002). Three
variants: 15 lines of block art for dark themes, a different 15 for light themes, an `iea` component
for `Apple_Terminal`, and a **one-line degradation** — `Welcome to Claude Code v2.1.220` — when a
screen reader is active or `rows < 30` (`vSp = 30`, `Dgt = 58` width, L400938).

The one string `Welcome to Claude` that the map flags at L184,196 is a *different* widget: the IDE
onboarding dialog's title `✻ Welcome to Claude Code for <IDE>` (L184196).

### 4.4 Spinner tips: selection and cadence

Catalog `Phm` (L543435) — ~40 built-in entries plus plugin- and marketplace-contributed ones. Each:
`{ id, content(ctx) → string, cooldownSessions, isRelevant() → boolean, priority?, providerAgnostic?,
maxLifetimeShows? }`.

Filtering (`Hmi`, L543366):
1. If `spinnerTipsOverride.excludeDefault`, only the user's custom tips.
2. Non-first-party auth ⇒ keep only `providerAgnostic: true` entries.
3. `await isRelevant(ctx)`.
4. `sessionsSinceLastShown(id) >= cooldownSessions`.
5. `lifetimeShows(id) < maxLifetimeShows` when set.

Selection (`Ohm`, L543650): sort by **sessions-since-last-shown descending**, tie-break by
**`priority` descending**, take the first. One tip is chosen per session and recorded via `bmi`
(L543684).

Sample literals (all at L543435-543560): `Use /statusline to set up a custom status line that will
display beneath the input box` (cooldown 25), `Double-tap esc to rewind the conversation to a
previous point in time` (10), `Hit Enter to queue up additional messages while Claude is working.`
(5), `Use /theme to change the color theme` (20), `Try setting environment variable
COLORTERM=truecolor for richer colors` (30), `Name your conversations with /rename to find them
easily in /resume later` (15).

### 4.5 The startup-announcement mechanism

Schema `oFy` (L241174):

```js
{ feature: string, command?: string, startsAt: ISO8601+tz, endsAt: ISO8601+tz,
  hideCommandChip?: boolean, creditless?: boolean, titleLabel?: string,
  commandBlurb?: string, tipBlurb?: string, isTopPriorityAnnouncement?: boolean,
  announcementLines?: [{ text: string, style?: "bold"|"dim" }],
  tips?: string[], redeemBy?: string }
```

Renderer at L454392: either the caller-supplied `announcementLines` as a column, or the default
composition:

```
<titleLabel ?? "Feature of the week:"> /<command> — <commandBlurb>
Get $5.00 in usage credits when you run it · Redeem by <redeemBy>
Terms apply: https://www.anthropic.com/legal/promotion-terms
```

Payload is fetched remotely (`tengu_startup_announcements`, L454600) and visibility is gated by
remote flags at L165409 (`startup_announcement`, `fable5_launch_show`, …). The related
`companyAnnouncements: string[]` setting (L42035) shows one randomly-chosen enterprise announcement
at startup. The same campaign also feeds two spinner-tip entries (`fotw-campaign`,
`fotw-campaign-upsell`, L543440-543455).

---

## 5. Notifications and terminal integration

### 5.1 OSC catalog

`Bb` (L148427) — the complete set the client knows:

```js
{ SET_TITLE_AND_ICON:0, SET_ICON:1, SET_TITLE:2, SET_COLOR:4, SET_CWD:7, HYPERLINK:8,
  ITERM2:9, SET_FG_COLOR:10, SET_BG_COLOR:11, SET_CURSOR_COLOR:12, CLIPBOARD:52,
  KITTY:99, RESET_COLOR:104, RESET_FG_COLOR:110, RESET_BG_COLOR:111,
  RESET_CURSOR_COLOR:112, SEMANTIC_PROMPT:133, GHOSTTY:777,
  ITERM2_PROPRIETARY:1337, TAB_STATUS:21337 }
```

iTerm2 OSC 9 sub-codes: `{NOTIFY:0, BADGE:2, PROGRESS:4}`; progress states
`{CLEAR:0, SET:1, ERROR:2, INDETERMINATE:3}` (L148428).

### 5.2 Terminal title

`useTerminalTitle` / `CVe` (L182826) writes `OSC 0 ; <sanitized text> ST`. The REPL wires it through
`vhl` (L547546):

```js
CVe(disabled ? null : noPrefix ? title : `${prefix} ${title}`)
// prefix: idle → "✳" (phi = U+2733)
//         busy → alternates ["⠂","⠐"] (dhi, L549863) every 960 ms (abm)
```

Title text is the first non-empty of: `/rename`d session name (only when
`terminalTitleFromRename !== false`) → the model-generated session topic title → the `--agent` name →
one further fallback → `"Claude Code"` (L547719). The topic title is produced by a Haiku-class call
with a 3-7-word sentence-case prompt (L350140).

Disabled by `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` (L547561). On exit the title is reset with
`OSC 0 ; ST` (`a0u`, L148428, written at L181507).

### 5.3 Tab status (OSC 21337)

`useTabStatus` / `igo` (L182806), gated by the remote flag `tengu_terminal_sidebar` **and** the
setting `showStatusInTerminalTab` (L547731). States (L182822):

```js
idle:    { indicator: rgb(0,215,95),   status: "Idle",     statusColor: rgb(136,136,136) }
busy:    { indicator: rgb(255,149,0),  status: "Working…", statusColor: rgb(255,149,0)   }
waiting: { indicator: rgb(95,135,255), status: "Waiting",  statusColor: rgb(95,135,255)  }
```

When tab status is on, the animated title prefix is suppressed (`noPrefix: Z2`, L549385).

### 5.4 Desktop notifications

Channel enum (L41474): `["auto","iterm2","terminal_bell","iterm2_with_bell","kitty","ghostty",
"notifications_disabled"]`, setting `preferredNotifChannel`.

`auto` resolution (`SQ_`, L405813): `Apple_Terminal` → `terminal_bell` **only if the profile's Bell
is disabled** (read via `osascript` + `defaults export com.apple.Terminal`, L405854); `iTerm.app` →
`iterm2`; `kitty` → `kitty`; `ghostty` → `ghostty`; anything else → `no_method_available`.

Emitters (`use()`, L180444):
- iTerm2: `OSC 9 ; "<title>: <message>" ST`
- Kitty: three `OSC 99` writes — `i=<id>:d=0:p=title`, `i=<id>:p=body`, `i=<id>:d=1:a=focus`
- Ghostty: `OSC 777 ; notify ; <title> ; <message> ST`
- Bell: a bare `\x07`
- Progress: `OSC 9 ; 4 ; <state> ; <pct> ST`, gated by `terminalProgressBarEnabled`

Title defaults to `"Claude Code"` (`mTp`, L405872). Control characters are stripped from all payloads
(`PJr`, L180436).

Triggers include: `Claude is waiting for your input` after `messageIdleNotifThresholdMs` idle with no
turn running (L549215); `<agent> needs permission for <tool>` (L540249); `<worker> needs network
access to <host>` (L540304); `Claude Code login successful` (L410787).

### 5.5 Alt screen and resize

Alt-screen entry (L180654): `…\x1B[?1049h\x1B[?1004l…\x1B[0m\x1B[?25h\x1B[2J\x1B[H`; exit
(L180659): `\x1B[?1049l` + mouse-tracking restore + cursor hide. Alt screen is opt-in — setting
`tui: "fullscreen"` or `CLAUDE_CODE_NO_FLICKER=1` (schema at L42035); the default renderer stays on
the main screen.

Resize (`handleResize`, L180644): subscribed on `stdout.on("resize")` alongside
`process.on("SIGCONT")` (L180674). `syncTerminalSize()` re-reads columns/rows, recomputes the
alt-screen park patch, resets screen-reader diff state, and — in alt screen — re-emits mouse tracking
and forces a full erase-before-paint. Only then does it re-render. `SIGCONT` (resume from Ctrl-Z)
re-enters the alt screen or rebuilds both frame buffers and marks the previous frame contaminated
(L180617).

---

## 6. Things worth knowing that were not asked

1. **Fullscreen mode changes the chrome shape.** `ds()` gates roughly a dozen footer decisions: it
   removes the entire right notification column (L494639), narrows right padding to 1, and enables
   commit/push/PR/branch/bash lines in the tool-group summary (L428005-428026).
2. **Screen-reader mode (`Ea()`) is a first-class layout mode**, not a colour tweak: it flips the
   footer to a column, degrades the welcome banner to one line, drops the mascot entirely (`d4`
   returns `null`, L452822), replaces the prompt pointer with `$ ` (L494722), and suppresses
   elapsed/token slots on the spinner (`!k &&` guards at L408043).
3. **`prefersReducedMotion` is a real setting** (L42035) that swaps the spinner pulse for a breathing
   `●`, freezes the title prefix, and disables shimmer/flash.
4. **`spinnerVerbs` and `spinnerTipsOverride` are user-configurable** — a user can replace the whole
   verb vocabulary and the whole tip catalog from settings.
5. **The footer is width-aware in three separate places**: the mode-cycle hint (`H8f`, L493879, drops
   below 60 columns when other chips are present), the chips row (`Xci = 60`, L494511), and the
   spinner tail's four slots each compute their own budget (L408033-408041).
6. **`Now using usage credits`** (L489498) is the only billing string in the footer, and only for
   non-team/enterprise accounts in overage.
7. **Hyperlinks are real OSC 8** throughout the chrome (`Ro`/`Link`, L381668) — PR badges, cloud
   session names, and closed-issue numbers are clickable.

---

## 7. Gap table

Effort: S ≤ ½ day · M ≈ 1-2 days · L > 2 days.

| # | Upstream (2.1.220) | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| C1 | Footer mode chip `⏸ manual mode on` / `⏵⏵ accept edits on (shift+tab to cycle)`; 6-mode label table L41541 | `ChatStatusBar.tsx:14` renders `mode <rawSdkModeString>` in a 4-way colour map (`modeColor`, line 6) | divergent | S | no |
| C2 | Footer carries **no** model name | `ChatStatusBar.tsx:13` `model <name>` always | divergent (we ship more) | S | no |
| C3 | Context indicator is a **transient notification**, hidden while `level === "ok"`, text `23% until auto-compact` / `Context low (17% remaining) · Run /compact to compact & continue` | `ChatStatusBar.tsx:16` permanent `ctx 42%` + `⚠ auto-compact soon` at ≥80% | divergent | M | needs a probe — does the SDK expose enough (`getContextUsage`) to compute upstream's token-absolute thresholds? |
| C4 | Hint ladder: 11 rungs, one winner, `? for shortcuts` only when nothing else and mode is default | `ChatStatusBar.tsx:20` two fixed strings: `[↑↓·1/2/3·esc]` or `⇧Tab mode · Esc interrupt · ? help` | partial | M | no |
| C5 | Notification queue with 4 priorities, fold/invalidate/pin, 8 s default, preemption (L393964) | none — `notice()` appends a transcript line | missing | M | no |
| C6 | `statusLine` extension point: config, 300 ms-debounced re-run, `refreshInterval`, abort, trust gate, multi-line dim truncate output | none | missing | M | no |
| C7 | `statusLine` stdin JSON: 20 top-level fields incl. undocumented `cost` / `exceeds_200k_tokens` / `fast_mode` / `remote` | n/a | missing | M | needs a probe — several fields (`transcript_path`, `prompt_id`, `context_window.*`, `rate_limits`) must be sourced from the SDK; some may be unavailable |
| C8 | `statusline-setup` built-in agent (L189100: `tools:["Read","Edit"]`, `model:"sonnet"`, `color:"orange"`) | none | missing | S | no |
| C9 | Spinner glyph advances as a **2000 ms triangle over 6 base glyphs**; clock 100 ms (50 ms while requesting) | `TurnSpinner.tsx:13` 120 ms tick over 12 frames (`spinner.ts:8`) | divergent | S | no |
| C10 | Ghostty `TERM` variant of the glyph set (L395923) | none | missing | S | no |
| C11 | Verb list = 186 verbs | 187 — `spinner.ts:26` has `"Evaporating"`, absent upstream | divergent (we ship more) | S | no |
| C12 | Message = `overrideMessage ?? activeTodo.activeForm ?? activeTodo.subject ?? verb` | always a random verb (`TurnSpinner.tsx:12`) | missing | S | no |
| C13 | `spinnerVerbs` / `spinnerTipsEnabled` / `spinnerTipsOverride` settings | none | missing | S | no |
| C14 | Spinner tail slots: suffix · elapsed · `↓ 1.2k tokens` · thinking/tool status, each width-budgeted; elapsed shown only past 16 s unless verbose | `spinner.ts:66` always `(3s · 142 tokens · esc to interrupt)` | divergent | M | no |
| C15 | Thinking-word escalation ladder (`thinking` → `still thinking` → `thinking more` → `thinking some more` → `almost done thinking`, L407874) | none | missing | S | no |
| C16 | `esc to interrupt` lives in the **footer**, only while loading | inside the spinner tail (`spinner.ts:67`) | divergent (we ship more) | S | no |
| C17 | Token count is `responseLength/4`, animated toward truth | real `message_delta` output tokens, un-animated | divergent (arguably better; still a fidelity gap) | S | no |
| C18 | Spinner tips (`Tip: …`), `Next: <todo>`, retry banner, compaction progress bar | none | missing | L | no |
| C19 | Tip catalog: ~40 entries with `cooldownSessions` / `priority` / `maxLifetimeShows`, most-stale-first selection | none | missing | L | no |
| C20 | Single-subagent description conjugation (77-entry irregular table, 26 gerunds, prefix + connective handling) on the tool-group summary | none | missing | M | no |
| C21 | Startup header: mascot + `Claude Code v2.1.220` + `model · billing` + `@agent · cwd`, no box | `banner.ts:19` boxed `✻ Welcome to Claude Code` + `cwd`/`model`/`mode` + 3 static tips | divergent | M | no |
| C22 | Boxed welcome only on first run / unseen release notes, with `Welcome back <name>!`, side-by-side feeds, `columns>=70` layout switch | box is unconditional; no feeds | divergent | M | no |
| C23 | Startup tips = a completion **checklist** (`✓ ` prefix, incomplete-first) + home-directory warning | 3 hard-coded bullets (`banner.ts:31-33`) | divergent | S | no |
| C24 | Screen-reader / `rows<30` degradation of the banner to one line | none | missing | S | no |
| C25 | Startup announcements (remote schema + renderer + `companyAnnouncements`) | none | not applicable — no remote flag service; `companyAnnouncements` half is buildable | S | no |
| C26 | Terminal title `OSC 0`, idle `✳ <title>` / busy `⠂`/`⠐` at 960 ms, name→topic→agent→`Claude Code`, reset on exit, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | none | missing | S | no |
| C27 | Model-generated session topic title (3-7 words, sentence case) | none | missing | M | needs a probe — the SDK has no small-model side-call primitive exposed; would need a nested `query()` |
| C28 | Tab status `OSC 21337` idle/busy/waiting with colours | none | missing | S | no |
| C29 | Desktop notifications: iTerm2 `OSC 9`, Kitty `OSC 99` ×3, Ghostty `OSC 777`, bell; `auto` channel resolution incl. the Apple Terminal `defaults export` probe | none | missing | M | no |
| C30 | Idle notification `Claude is waiting for your input` on threshold | none | missing | S | no |
| C31 | `idle-return-hint` (`new task? /clear to save 45.2k tokens`) after `CLAUDE_CODE_IDLE_THRESHOLD_MINUTES` (default 75) with ≥100k context | none | missing | S | no |
| C32 | iTerm2 progress bar `OSC 9;4` behind `terminalProgressBarEnabled` | none | missing | S | no |
| C33 | Alt-screen renderer behind `tui:"fullscreen"` / `CLAUDE_CODE_NO_FLICKER`; virtualized scrollback | none (Ink `<Static>` main-screen only; W2 already recorded this as a deliberate divergence) | not applicable | L | no |
| C34 | Resize: `stdout.on("resize")` + `SIGCONT`, size resync, alt-screen erase-before-paint | Ink's own resize handling only; no `SIGCONT` handler | partial | S | no |
| C35 | `prefersReducedMotion` (static `●`, no shimmer/flash) | none | missing | S | no |
| C36 | Screen-reader layout mode (column footer, no mascot, `$ ` pointer, suppressed spinner slots) | none | missing | M | no |
| C37 | Footer chips: stash, `◎ /goal active`, tasks, `N memories recalled`, `N feedback drafts`, IDE selection `⧉ 12 lines selected`, sandbox-blocked, `Debug`, `hipaa`, PR badge, mode labels | `⟳ streaming` and `⚙ N bg` only (`ChatStatusBar.tsx:18-19`) | divergent (we ship two chips upstream does not) | M | no |
| C38 | `Not logged in · Run /login` / `Authentication error · Try again`; `apiKeyHelper is taking a while (12s)`; `Now using usage credits`; auto-updater chips | none | missing | M | needs a probe — does the SDK surface auth-state changes to a client at all? |
| C39 | `{tokens} tokens` shown in the footer **only** under `verbose` | none | missing | S | no |
| C40 | Rate-limit percentages reach the user only via `statusLine` JSON and `/usage` | `usageWarning()` puts `⚠ 5h 92%` in the footer at ≥80% (`usageFormat.ts:58`, `ChatStatusBar.tsx:17`) | divergent (we ship more) | S | no |
| C41 | `think` level is a Config row + a spinner `effortSuffix`, never a footer chip | `ChatStatusBar.tsx:15` `think <level>` chip | divergent (we ship more) | S | no |
| C42 | OSC 8 hyperlinks throughout the chrome | none | missing | M | no |
| C43 | Width-aware truncation at three points in the footer + `wrap:"truncate"` everywhere | none — the bar can overflow narrow terminals | missing | M | no |

**Counts:** missing **24** · partial **2** · divergent **14** · not applicable **3** · total **43**.
Of the 14 divergent, **6 are "we ship more than upstream"**: C2 (footer model), C11 (extra verb),
C16 (esc-to-interrupt in the spinner), C37 (`⟳ streaming` and `⚙ N bg` chips), C40 (plan-usage chip),
C41 (`think` chip). C3 is also over-shipping in the "always visible" direction.

### Parity-doc claims that do not survive contact with the bundle

`docs/parity/tui-ux.md` §3 (lines 272-286) scores 11 of 12 rows ✅ at ~92%. Against 2.1.220:

| Claim | Reality |
|---|---|
| "Status bar (model · mode · ctx%) ✅" | Upstream's footer has none of the three. Should be ✗/divergent. |
| "Spinner glyph ✅ `·✢✳✶✻✽` fwd+reverse" | Glyph set correct; **timing model wrong** (C9) and the ghostty variant is missing (C10). |
| "Spinner thinking verbs (187, random) ✅" | 186 upstream; we have one extra (C11). And the verb is the **last** fallback, not the primary source (C12). |
| "`esc to interrupt` affordance on spinner ✅" | Upstream puts it in the footer, not the spinner (C16). |
| "Context-left % + threshold warning ✅" | Different trigger model, different text, different surface (C3). |
| "Permission-mode indicator (color) ✅" | Colours are ours, not upstream's 6-entry table; no symbol, no `on` suffix, no cycle hint (C1). |
| "`? for shortcuts` hint line ✅" | We show a fixed 3-item string, not a one-winner ladder (C4). |
| "Plan-usage warning chip ✅" | Upstream has no such chip (C40). |

The section is also missing rows entirely for: statusLine, terminal title, notifications, tab status,
tips, announcements, the notification queue, reduced motion, screen-reader mode, and resize.

---

## 8. Confidence and gaps

**High confidence** (read directly from the rendering code, literals quoted):
mode-indicator table, context-indicator text and thresholds, the hint ladder's precedence, the
spinner glyph set and clock, the verb list and its fallback chain, the thinking-word ladder, the
conjugation tables, the statusLine payload builder and cadence, the OSC catalog, the title/tab-status
wiring, the notification channels, the startup header and boxed-welcome composition, the tip catalog
and its selection rule.

**Medium confidence / inference marked:**
- The footer mode chip rendering in **default** mode. I did not observe a running client; the
  conclusion rests on `ttl = dne && jOb ? … : null` (L494038) plus the `!(ttl && HRn)` guard at
  L494096, which is only meaningful if `ttl` is truthy in default mode. **[inf]**, but I would build
  against it.
- `ds()` = fullscreen and `Ea()` = screen-reader. Both are consistent with every usage I read but
  neither name is in a string literal. **[inf]**
- The fourth fallback in the title chain (`Ql`, L547719). **Not determined.**

**Not determined:**
- The statusLine command's actual timeout. `xm = 600000` (L223612) is the constant used in the
  telemetry classification but sits in a different module scope; I could not prove it is the binding
  at L366225.
- `messageIdleNotifThresholdMs`'s default value (read from settings at L549215, default not located).
- Whether the tip is re-selected mid-session or only at session start. The store field `spinnerTip`
  is read by the spinner (L408125) but I did not find its writer.

**Deliberately not chased** (out of this domain, or low value for the gap table): the theme token
tables at L41474, the keybinding table at L186116, the mascot art bytes, the workflow strip (`uZa`),
the voice widgets beyond their footer strings, and the FleetView chrome at L537757/L539240.

**Three flagged as needing a probe before design**, all about SDK reachability rather than upstream
behaviour: C3 (can we compute token-absolute compaction thresholds?), C7 (which statusLine JSON
fields can we actually populate?), C38 (does the SDK surface auth state to a client?). C27 is a
fourth, softer one — a nested `query()` for title generation is possible but its cost/latency profile
is unmeasured.
