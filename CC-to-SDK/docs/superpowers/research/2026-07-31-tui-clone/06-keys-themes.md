# W4-06 — Keybindings and Themes: Claude Code 2.1.220 vs. `cc-harness` TUI

Read-only research. Two pinned tables extracted verbatim from the real binary, then diffed against ours.

**Upstream source.** `~/claude-code-bundle/2.1.220/cli.pretty.js` (579,698 lines, beautified but minified).
All line numbers below are into that file unless prefixed with a repo path.

**Our source.** `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/src/tui/`.
`Claude Code Src/` was not consulted anywhere in this research, per instruction.

**Evidence standard.** Everything in the two extraction sections is a literal quote from the bundle with a
line cite. Anything I could not settle from the bundle is written as **not determined**. Inferences are
labelled *(inference)*.

---

## Corrections to `MAP.md`

Two of `MAP.md`'s claims about these landmarks are wrong, and a third is imprecise. Recording them because
downstream work will otherwise repeat the mistake.

| `MAP.md` says | Actually |
|---|---|
| "Keybindings for all 20 UI contexts (line 186,116)" and lists `Terminal` … `info` among them | The default table has **19** context blocks. The **20** valid contexts are the separate registry `War` at **line 186,159**, which includes `DiffPanel` (a valid context with *zero* default bindings) and does **not** include `Terminal` or `info` |
| Context list includes `Terminal` and `info` | Both are false positives from grepping `context:`. `context: "Terminal"` (line 394,597) writes a **Zed editor keymap file** (`{ context: "Terminal", bindings: { "shift-enter": ["terminal::SendText", "\x1B\r"] } }`) — an external editor's config, not a Claude Code UI context. `context: "info"` (line 489,921) is an entry in a **slash-command category map** (`context: "info", diff: "info", help: "info", …`) |
| Context list omits `Transcript` | `Transcript` is a real context with 20 default bindings |
| "All 6 themes … defined inline at line 41,474" | Line 41,474 holds only the **id enum** (`ZDi = ["dark","light","light-daltonized","dark-daltonized","light-ansi","dark-ansi"]`). The six **palettes** are at **line 156,475** |

---

# Deliverable 1 — The keybinding table

## 1.1 What was extracted

- **19 context blocks** in the default table `jar` (line 186,118), holding **180 key→action bindings**
  (179 unconditional + 1 WSL-only).
- **20 valid contexts** in the registry `War` (line 186,159) — the 19 above plus `DiffPanel`, which has a
  description and passes validation but ships no default binding.
- **134 valid action names** in `f_s` (line 186,160) — a superset of the 180 bindings' actions; some actions
  (`app:toggleReplTab`, `app:redraw`, `strip:jump1`…`strip:new`, `confirm:previousField`, `diff:back`,
  `permission:toggleDebug`, `selection:clear`) exist with **no default key**, i.e. they are rebind-only.

Per-context binding counts: Global 11 · Chat 23 · Autocomplete 4 · Settings 16 · Confirmation 10 · Tabs 4 ·
Transcript 20 · HistorySearch 6 · Task 2 · ThemePicker 2 · Scroll 14 · Help 1 · Attachments 6 · Footer 11 ·
MessageSelector 15 · DiffDialog 17 · ModelPicker 3 · Select 12 · Plugin 3.

## 1.2 Context registry, with upstream's own descriptions

Verbatim from `y9u` (line 186,160). These descriptions *are* the semantics of the context stack.

| context | upstream description | default bindings |
|---|---|---|
| `Global` | Active everywhere, regardless of focus | 11 |
| `Chat` | When the chat input is focused | 23 |
| `Autocomplete` | When autocomplete menu is visible | 4 |
| `Confirmation` | When a confirmation/permission dialog is shown | 10 |
| `Help` | When the help overlay is open | 1 |
| `Transcript` | When viewing the transcript | 20 |
| `HistorySearch` | When searching command history (ctrl+r) | 6 |
| `Task` | When a task/agent is running in the foreground | 2 |
| `ThemePicker` | When the theme picker is open | 2 |
| `Settings` | When the settings menu is open | 16 |
| `Tabs` | When tab navigation is active | 4 |
| `Attachments` | When navigating image attachments in a select dialog | 6 |
| `Footer` | When footer indicators are focused | 11 |
| `MessageSelector` | When the message selector (rewind) is open | 15 |
| `DiffDialog` | When the diff dialog is open | 17 |
| `DiffPanel` | When the diff sidebar panel is open | **0** |
| `ModelPicker` | When the model picker is open | 3 |
| `Select` | When a select/list component is focused | 12 |
| `Plugin` | When the plugin dialog is open | 3 |
| `Scroll` | When a scrollable view is focused (fullscreen layout) | 14 |

## 1.3 Platform branching — exact

Line 186,118, verbatim:

```js
Qgo = Pt(),
mmy = Qgo === "windows" || Qgo === "wsl",
hmy = mmy ? "alt+v" : "ctrl+v",
gmy = Qgo !== "windows" || (toe()
        ? _Ji("1.4.0", ">=1.2.23")
        : _Ji(process.versions.node, ">=22.17.0 <23.0.0 || >=24.2.0")),
m9u = gmy ? "shift+tab" : "meta+m",
```

Reading it:

1. **`Qgo`** is the platform, from `Pt()`. The domain is `["darwin","linux","win32","freebsd","openbsd",
   "netbsd","android","aix","sunos","cygwin","haiku","macos","windows","wsl","unknown"]` (line 101,185).
   `Pt()` also **coerces to `"macos"`** when `LC_TERMINAL === "iTerm2"` or `TERM_PROGRAM` is
   `Apple_Terminal` / `iTerm.app` (line 182,940) — i.e. an iTerm2 session is treated as macOS regardless of
   the real OS.
2. **Paste key `hmy`** — `alt+v` on Windows and WSL, `ctrl+v` everywhere else. Bound to `chat:imagePaste`.
   On WSL *only*, `ctrl+v` is **additionally** bound to the same action:
   `...Qgo === "wsl" && { "ctrl+v": "chat:imagePaste" }` — so WSL gets both `alt+v` and `ctrl+v`.
3. **Mode-cycle key `m9u`** — `shift+tab` unless the runtime is too old to deliver it on Windows.
   The version gate is: non-Windows always passes; on Windows it needs Bun `>=1.2.23` (the build's own
   version literal is `"1.4.0"`, so this passes) or Node `>=22.17.0 <23.0.0 || >=24.2.0`. Otherwise the key
   degrades to **`meta+m`**. `toe()` in this compiled build is `function toe() { return !0 }` (line 17,759),
   so the Bun branch is what actually evaluates — meaning **in the shipped binary `m9u` is always
   `shift+tab`** *(inference from the constant-folded `toe`)*; the Node branch is dead code retained for the
   npm build.
4. `m9u` is used **twice**: `Chat` → `chat:cycleMode` and `Confirmation` → `confirm:cycleMode`. `hmy` once.
5. Separately, `Tabs` binds the string literal `"shift+tab"` → `tabs:previous` (not `m9u`), so on a degraded
   Windows runtime tab-navigation keeps `shift+tab` while mode-cycling moves to `meta+m`.

**A runtime-only branch worth noting** (line 423,531): the *displayed* chord for `task:background` becomes
`"ctrl+b ctrl+b (twice)"` when `terminal === "tmux"` and the resolved chord is `ctrl+b`, because tmux eats
`ctrl+b` as its prefix. The binding is unchanged; only the hint text adapts.

## 1.4 Reserved / non-rebindable keys

From `vQr`, `d_s`, `p_s` (line 186,151), merged by `h9u()` — the macOS block is appended only when
`Pt() === "macos"`.

| key | reason | severity |
|---|---|---|
| `ctrl+c` | Cannot be rebound - used for interrupt/exit (hardcoded) | error |
| `ctrl+d` | Cannot be rebound - used for exit (hardcoded) | error |
| `ctrl+m` | Cannot be rebound - identical to Enter in terminals (both send CR) | error |
| `capslock` | Caps Lock is not delivered to terminal applications | error |
| `ctrl+z` | Unix process suspend (SIGTSTP) | **warning** |
| `ctrl+\` | Terminal quit signal (SIGQUIT) | error |
| `cmd+c` / `cmd+v` / `cmd+x` | macOS system copy / paste / cut | error (macOS only) |
| `cmd+q` / `cmd+w` | macOS quit application / close window/tab | error (macOS only) |
| `cmd+tab` / `cmd+space` | macOS app switcher / Spotlight | error (macOS only) |

## 1.5 The precedence model — how contexts stack

This is the part that matters most to us, so it is spelled out mechanically. Sources: `ePt` (line 183,234),
`sut` (line 183,200), `Gbp` (line 398,368), `cZs` (line 398,121), `ugo` (line 183,155), `cut` (line 183,327).

### The core rule: an ordered array, first match wins

The resolver signature is `ePt(keypress, activeContexts /* ordered */, allBindings, pendingChord)`. Its
terminal loop is literally:

```js
for (let c of t) {            // t = the ordered active-context array
  let u = l.get(c);           // l = contexts that matched this chord
  if (u) {
    if (u.action === null) return { type: "unbound" };
    return { type: "match", action: u.action };
  }
}
```

So **priority is positional**: index 0 of the active-context array wins over index 1, and so on. A context
that binds the key at all consumes it; a context that binds it to `null` consumes it as *explicitly
unbound* and stops the search (that is how a user unbinds a default without the next context inheriting it).

### How the ordered array is built: a DOM scope chain

`Gbp(node)` walks **from the focused node up its parent chain**, pushing each ancestor's
`attributes.keybindingScope` if it is a valid context name:

```js
function Gbp(e) {
  let t = [], r = Lgn(e);
  while (r) {
    let n = r.attributes.keybindingScope;
    if (typeof n === "string" && g9u(n)) t.push(n);
    r = r.parentNode;
  }
  return t;
}
```

The application root is rendered with `keybindingScope: "Global"` (line 398,345), so **`Global` is always
last** — the outermost frame, checked only after every enclosing scope has declined. This is exactly the
modal-over-chat model: a dialog mounted inside the tree contributes its context at a *lower index* than the
chat's, so it wins; when it unmounts, its scope leaves the chain and the chat's binding is live again with
no bookkeeping.

### Four dispatch layers, in order

Per keypress (`cZs`, line 398,121 → the `V5o` handler), in this order:

1. **`swallowAll`** — if any registered scope declared `swallowAll`, the keypress is dropped outright and
   nothing else runs (line 398,208). A hard modal.
2. **`preemptiveScopes`** — resolved against `[...preemptiveScopes.keys(), "Global"]` *before* the focus
   chain (line 398,222–223). A scope can therefore claim a key over the focused element without being an
   ancestor of it.
3. **The focus scope chain** — `ePt(key, Gbp(target), …)` (line 398,260), the rule above.
4. **Legacy handler-registry fallback** — if the chain produced nothing (or no node was focused), it falls
   back to `sut(key, [...handlerContexts, ...activeContexts, "Global"], …)` (line 398,146). Here
   `handlerContexts` are the contexts of every currently-registered action handler, `activeContexts` are
   those registered imperatively via the `cut(context, enabled)` hook (line 183,327 — a `useLayoutEffect`
   that registers on mount and unregisters on unmount), and `Global` is again appended last.

One concrete call site shows the convention plainly (line 541,743):
`H.resolve(E, A, [...H.activeContexts, "Chat", "Global"])` — imperative contexts first, then `Chat`, then
`Global`.

### Chords

Chords are space-separated keystroke sequences with a **1-second inter-key timeout** (documented in the
keybindings skill text, line 520,884). The resolver returns `chord_started` and stashes a `pending` prefix
whenever *any* binding in an active context is a strict extension of what has been typed (`Q4u`, line
183,224). `escape` while a chord is pending returns `chord_cancelled` and eats the key. Defaults using
chords: `ctrl+x ctrl+k`, `ctrl+x ctrl+e`, `ctrl+x ctrl+b`.

### Key normalisation and matching

`car()` (line 182,950) parses `"ctrl+shift+p"` into `{key, ctrl, alt, shift, meta, super}`; aliases:
`control→ctrl`, `opt`/`option`→`alt`, `cmd`/`command`/`super`/`win`→`super`, `esc→escape`, `return→enter`,
`del→delete`, `space→" "`, and the arrow glyphs `↑↓←→`. Equality (`uar`, line 183,178) treats **`alt` and
`meta` as the same modifier** — `(e.alt || e.meta) === (t.alt || t.meta)` — which the keybindings skill also
states in prose: *"`alt` and `meta` are identical in terminals"* (line 520,884).

### User customisation and merge order

`~/.claude/keybindings.json` (`TQr()`, line 186,316) is `{ $schema, $docs, bindings: [ {context, bindings} ] }`.
Merge is `[...defaults, ...userBindings]` (line 186,333) and, **within one context, later wins**
(`ugo`, line 183,155 scans forward and keeps the last non-superseded entry). So user bindings are purely
additive; to *move* a binding you must unbind the old key with `null` and add the new one. The file is
hot-watched via chokidar with `usePolling` and a 500 ms stability threshold (line 186,388), so edits apply
live. Validation is a separate pass producing typed errors/warnings written to the debug log
(`parse_error`, `invalid_context`, `invalid_action`, `duplicate`, `reserved`).

`command:<name>` is a second action form (regex `^command:[a-zA-Z0-9:\-_]+$`) that runs a slash command as
if typed; it is **only legal in the `Chat` context** (warned otherwise, line 186,204).

## 1.6 Keys upstream handles *outside* the table

The `jar` table is not the whole keymap. These are handled by component code and never appear in it — worth
knowing because several are things we do implement.

| key | surface | behaviour | line |
|---|---|---|---|
| `ctrl+a` `ctrl+b` `ctrl+d` `ctrl+e` `ctrl+f` `ctrl+h` `ctrl+k` `ctrl+n` `ctrl+p` `ctrl+u` `ctrl+w` `ctrl+y` | composer | Emacs readline: line start · left · delete-or-EOF · line end · right · delete-token/backspace · kill-to-end · history next · history prev · kill-to-start · kill-word-back · **yank** | 395,700 (`te` table) |
| `alt+b` `alt+f` `alt+d` `alt+y` | composer | prev word · next word · delete-word-after · **yank-pop** | 395,700 (`de` table) |
| `escape` (1st) | composer with text | shows hint `"Esc again to clear"` | 395,632 |
| `escape` (2nd within window) | composer with text | **clears the input** (and pushes it to history) | 395,635 |
| `escape escape` | composer **empty** | rewind / message selector — `"Press esc twice to go up a few messages and try again."` | 308,287 |
| `ctrl+d` (1st) | composer empty | shows an exit hint | 395,644 |
| `ctrl+d` (2nd) | composer empty | exits | 395,646 |
| `←` `←` | composer **empty** | opens the agents view; refuses with *"Cannot open agents — you have unsent text in the input"* when non-empty | 395,751, 548,878 |
| `?` | composer empty, no modifiers, insert mode | opens the shortcuts help: `Wt === "?" && !Cn.ctrl && !Cn.meta && Lt.current === "" && (!Ae \|\| Te === "INSERT")` | 495,774 |
| `shift+enter` | composer | newline — **not a Claude Code binding**; installed into the *terminal's own* keymap by `/terminal-setup`, which sends `ESC CR`. Hint text falls back to `"\⏎ for newline"` or `"backslash (\) + return (⏎) for newline"` when not installed | 433,225–433,228, 351,000–351,005 |
| `{` `}` `/` `n` `N` `[` `v` `?` | transcript pager | prev/next prompt · search · next/prev match · print to scrollback · open in editor · close help | 547,405–547,455 |
| kill-ring | composer | a real kill-ring with append/prepend direction and yank-pop; hint `"Ctrl+Y to paste deleted text"` fires after a ≥3-char kill | 395,655–395,690 |

Also: `/keybindings` upstream is `{ name: "keybindings", description: "Open your keyboard shortcuts file" }`
(line 317,877) — it opens the JSON file for editing, confirming the divergence our parity doc already records.

## 1.7 The 19 contexts, every binding, with our columns

Legend for **ours**: ✅ bound to the equivalent action · ⚠️ bound but different · ❌ not bound ·
N/A the surface does not exist in our TUI.

**Totals across the 180 bindings: ✅ 67 equivalent · ⚠️ 12 bound-but-different · ❌ 63 not bound (surface exists on our side) · N/A 38 (surface does not exist on our side).**

#### `Global` (11 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `ctrl+c` | `app:interrupt` | ✅ | interrupt when busy; else arms and a 2nd press exits (`ChatApp.tsx:107-111`) |
| `ctrl+d` | `app:exit` | ⚠️ | EOF exit on the FIRST press when the composer is empty (`ChatComposer.tsx:94`); upstream needs two |
| `ctrl+t` | `app:toggleTodos` | ✅ | toggles the todo/TaskPanel (`ChatApp.tsx:106`) |
| `ctrl+o` | `app:toggleTranscript` | ✅ | opens the transcript pager (`ChatApp.tsx:104`) |
| `ctrl+shift+b` | `app:toggleBrief` | ❌ | no brief surface |
| `ctrl+r` | `history:search` | ✅ | opens the history-search overlay (`ChatApp.tsx:105`) |
| `ctrl+up` | `app:diffFileListUp` | ❌ | no diff file list |
| `ctrl+down` | `app:diffFileListDown` | ❌ | no diff file list |
| `meta+up` | `app:diffFileListUp` | ❌ | no diff file list |
| `meta+down` | `app:diffFileListDown` | ❌ | no diff file list |
| `ctrl+]` | `app:openArtifact` | ❌ | no artifact surface |

#### `Chat` (23 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `escape` | `chat:cancel` | ⚠️ | busy → interrupt (same); **idle → arms rewind**, where upstream clears the input when text is present |
| `ctrl+l` | `chat:clearInput` | ✅ | `clearInput` (`editor.ts:240`) |
| `cmd+k` | `chat:clearScreen` | ❌ | `/clear` only |
| `ctrl+x ctrl+k` | `chat:killAgents` | ✅ | 2 s chord, then its own 3 s double-press confirm (`ChatComposer.tsx:105`) |
| `[m9u]` | `chat:cycleMode` | ✅ | `shift+tab` cycles default→acceptEdits→plan→auto (`ChatComposer.tsx:100`); ladder contents differ from upstream |
| `meta+p` | `chat:modelPicker` | ❌ | `/model` only |
| `meta+o` | `chat:fastMode` | ❌ | no fast mode |
| `meta+t` | `chat:thinkingToggle` | ❌ | `/think` only |
| `meta+w` | `chat:workflowKeywordToggle` | ❌ | no workflow keywords |
| `enter` | `chat:submit` | ✅ | submit (`editor.ts:250`) |
| `ctrl+j` | `chat:newline` | ✅ | newline — reaches the insert branch as `\n`, the `key.ctrl` branch at `editor.ts:239` is dead |
| `up` | `history:previous` | ✅ | history previous when on row 0 (`editor.ts:205`) |
| `down` | `history:next` | ✅ | history next when on the last row (`editor.ts:206`) |
| `ctrl+_` | `chat:undo` | ⚠️ | branch exists (`editor.ts:242`) but is **unreachable** — inserts a literal `\x1f` |
| `ctrl+-` | `chat:undo` | ⚠️ | same dead branch |
| `ctrl+shift+-` | `chat:undo` | ❌ | not bound |
| `ctrl+shift+_` | `chat:undo` | ❌ | not bound |
| `ctrl+x ctrl+e` | `chat:externalEditor` | ✅ | 2 s chord → `$VISUAL`/`$EDITOR`/`vi` (`ChatComposer.tsx:106`) |
| `ctrl+g` | `chat:externalEditor` | ✅ | same, no chord needed |
| `ctrl+s` | `chat:stash` | ✅ | stash/restore the buffer (`editor.ts:241`) |
| `[hmy]` | `chat:imagePaste` | ❌ | no image paste |
| `ctrl+v` *(WSL only)* | `chat:imagePaste` | ❌ | no image paste |
| `space` | `voice:pushToTalk` | N/A | no voice mode — space types a space |

#### `Autocomplete` (4 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `tab` | `autocomplete:accept` | ✅ | completes the command name / accepts the mention (`editor.ts:252`) |
| `escape` | `autocomplete:dismiss` | ✅ | closes the popup (`editor.ts:253`) |
| `up` | `autocomplete:previous` | ✅ | `editor.ts:205` |
| `down` | `autocomplete:next` | ✅ | `editor.ts:206` |

#### `Settings` (16 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `escape` | `confirm:no` | ✅ | closes the dialog (`SettingsDialog.tsx:97`) |
| `up` | `select:previous` | ✅ | `:104` |
| `down` | `select:next` | ✅ | `:105` |
| `k` | `select:previous` | ✅ | `:104` |
| `j` | `select:next` | ✅ | `:105` |
| `ctrl+p` | `select:previous` | ✅ | `:104` |
| `ctrl+n` | `select:next` | ✅ | `:105` |
| `space` | `select:accept` | ✅ | activates the row (`:106`) |
| `enter` | `select:accept` | ✅ | activates the row (`:106`) |
| `/` | `settings:search` | ✅ | enters search mode (`:103`) |
| `r` | `settings:retry` | ❌ | no retry — our Status/Usage/Stats tabs are static |
| `d` | `settings:periodDay` | ❌ | no day-period toggle |
| `w` | `settings:periodWeek` | ❌ | no week-period toggle |
| `t` | `settings:sortByTokens` | ❌ | no sort-by-tokens |
| `ctrl+u` | `scroll:halfPageUp` | ❌ | no scrolling in the dialog |
| `ctrl+d` | `scroll:halfPageDown` | ❌ | no scrolling in the dialog |

#### `Confirmation` (10 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `y` | `confirm:yes` | ❌ | **not bound** — we use `a`/`A` and digits |
| `n` | `confirm:no` | ❌ | **not bound** — we use `d`/`D` and digit 3 |
| `enter` | `confirm:yes` | ✅ | applies the highlighted option (`PermissionDialog.tsx:32`) |
| `escape` | `confirm:no` | ✅ | deny (`:29`) |
| `up` | `confirm:previous` | ✅ | `:30` |
| `down` | `confirm:next` | ✅ | `:31` |
| `tab` | `confirm:nextField` | ❌ | no multi-field confirmation |
| `space` | `confirm:toggle` | ⚠️ | only in `QuestionDialog` multi-select (`:68`); the permission dialog ignores it |
| `[m9u]` | `confirm:cycleMode` | ❌ | cannot change mode from inside a dialog |
| `ctrl+e` | `confirm:toggleExplanation` | ❌ | no explanation toggle |

#### `Tabs` (4 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `tab` | `tabs:next` | ✅ | next tab in `SettingsDialog.tsx:99` / `PermissionsDialog.tsx:168` |
| `shift+tab` | `tabs:previous` | ✅ | previous tab (`:98` / `:167`) |
| `right` | `tabs:next` | ✅ | next tab (`:101` / `:170`) |
| `left` | `tabs:previous` | ✅ | previous tab (`:100` / `:169`) |

#### `Transcript` (20 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `ctrl+e` | `transcript:toggleShowAll` | ❌ | no show-all toggle (documented gap, `pager.ts:3-5`) |
| `ctrl+c` | `transcript:exit` | ✅ | `pager.ts:13` |
| `escape` | `transcript:exit` | ✅ | `pager.ts:10` |
| `q` | `transcript:exit` | ✅ | `pager.ts:27` |
| `ctrl+u` | `scroll:halfPageUp` | ✅ | `pager.ts:14` |
| `ctrl+d` | `scroll:halfPageDown` | ✅ | `pager.ts:15` |
| `ctrl+b` | `scroll:fullPageUp` | ✅ | `pager.ts:16` |
| `ctrl+f` | `scroll:fullPageDown` | ✅ | `pager.ts:17` |
| `ctrl+n` | `scroll:lineDown` | ✅ | `pager.ts:18` |
| `ctrl+p` | `scroll:lineUp` | ✅ | `pager.ts:19` |
| `g` | `scroll:top` | ✅ | `pager.ts:32` |
| `shift+g` | `scroll:bottom` | ✅ | via `input === "G"` at `pager.ts:33`; the `key.shift` branch at `:32` is dead |
| `j` | `scroll:lineDown` | ✅ | `pager.ts:28` |
| `k` | `scroll:lineUp` | ✅ | `pager.ts:29` |
| `space` | `scroll:fullPageDown` | ✅ | `pager.ts:30` |
| `b` | `scroll:fullPageUp` | ✅ | `pager.ts:31` |
| `up` | `scroll:lineUp` | ✅ | `pager.ts:23` |
| `down` | `scroll:lineDown` | ✅ | `pager.ts:24` |
| `home` | `scroll:top` | ❌ | not bound |
| `end` | `scroll:bottom` | ❌ | not bound |

#### `HistorySearch` (6 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `ctrl+r` | `historySearch:next` | ✅ | next match, wraps (`HistorySearchOverlay.tsx:36`) |
| `escape` | `historySearch:accept` | ✅ | accept into the composer (`:37`) |
| `tab` | `historySearch:accept` | ✅ | accept (`:37`) |
| `ctrl+c` | `historySearch:cancel` | ✅ | cancel (`:34`) |
| `enter` | `historySearch:execute` | ✅ | execute immediately (`:38`) |
| `ctrl+s` | `historySearch:cycleScope` | ✅ | cycle scope session→project→everywhere (`:35`) |

#### `Task` (2 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `ctrl+x ctrl+b` | `task:background` | ❌ | only the bare `ctrl+b` alias exists |
| `ctrl+b` | `task:background` | ✅ | backgrounds the running turn (`ChatApp.tsx:112`) |

#### `ThemePicker` (2 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `ctrl+t` | `theme:toggleSyntaxHighlighting` | ❌ | no syntax-highlight toggle |
| `ctrl+e` | `theme:editCustom` | ❌ | no custom-theme authoring |

#### `Scroll` (14 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `pageup` | `scroll:pageUp` | ⚠️ | only inside the transcript pager (`pager.ts:25`), not a general Scroll context |
| `pagedown` | `scroll:pageDown` | ⚠️ | only inside the transcript pager (`pager.ts:26`) |
| `wheelup` | `scroll:lineUp` | ❌ | no mouse support |
| `wheeldown` | `scroll:lineDown` | ❌ | no mouse support |
| `ctrl+home` | `scroll:top` | ❌ | not bound |
| `ctrl+end` | `scroll:bottom` | ❌ | not bound |
| `ctrl+shift+c` | `selection:copy` | ❌ | no in-app selection |
| `cmd+c` | `selection:copy` | ❌ | no in-app selection |
| `shift+left` | `selection:extendLeft` | ❌ | no in-app selection |
| `shift+right` | `selection:extendRight` | ❌ | no in-app selection |
| `shift+up` | `selection:extendUp` | ❌ | no in-app selection |
| `shift+down` | `selection:extendDown` | ❌ | no in-app selection |
| `shift+home` | `selection:extendLineStart` | ❌ | no in-app selection |
| `shift+end` | `selection:extendLineEnd` | ❌ | no in-app selection |

#### `Help` (1 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `escape` | `help:dismiss` | ⚠️ | **any key** closes the overlay (`ShortcutsOverlay.tsx:40`), and the key ALSO fires `ChatApp`'s global chords |

#### `Attachments` (6 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `right` | `attachments:next` | N/A | no image attachments |
| `left` | `attachments:previous` | N/A | no image attachments |
| `backspace` | `attachments:remove` | N/A | no image attachments |
| `delete` | `attachments:remove` | N/A | no image attachments |
| `down` | `attachments:exit` | N/A | no image attachments |
| `escape` | `attachments:exit` | N/A | no image attachments |

#### `Footer` (11 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `up` | `footer:up` | N/A | no focusable footer |
| `ctrl+p` | `footer:up` | N/A | no focusable footer |
| `down` | `footer:down` | N/A | no focusable footer |
| `ctrl+n` | `footer:down` | N/A | no focusable footer |
| `right` | `footer:next` | N/A | no focusable footer |
| `left` | `footer:previous` | N/A | no focusable footer |
| `enter` | `footer:openSelected` | N/A | no focusable footer |
| `escape` | `footer:clearSelection` | N/A | no focusable footer |
| `x` | `footer:close` | N/A | no focusable footer |
| `backspace` | `footer:dismiss` | N/A | no focusable footer |
| `delete` | `footer:dismiss` | N/A | no focusable footer |

#### `MessageSelector` (15 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `up` | `messageSelector:up` | ✅ | `RewindPicker.tsx:34` |
| `down` | `messageSelector:down` | ✅ | `RewindPicker.tsx:35` |
| `k` | `messageSelector:up` | ❌ | not bound in the rewind picker |
| `j` | `messageSelector:down` | ❌ | not bound in the rewind picker |
| `ctrl+p` | `messageSelector:up` | ❌ | not bound |
| `ctrl+n` | `messageSelector:down` | ❌ | not bound |
| `ctrl+up` | `messageSelector:top` | ❌ | no top/bottom jump |
| `shift+up` | `messageSelector:top` | ❌ | no top/bottom jump |
| `meta+up` | `messageSelector:top` | ❌ | no top/bottom jump |
| `shift+k` | `messageSelector:top` | ❌ | no top/bottom jump |
| `ctrl+down` | `messageSelector:bottom` | ❌ | no top/bottom jump |
| `shift+down` | `messageSelector:bottom` | ❌ | no top/bottom jump |
| `meta+down` | `messageSelector:bottom` | ❌ | no top/bottom jump |
| `shift+j` | `messageSelector:bottom` | ❌ | no top/bottom jump |
| `enter` | `messageSelector:select` | ✅ | selects the anchor → dry-run → scope stage (`RewindPicker.tsx:36`) |

#### `DiffDialog` (17 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `escape` | `diff:dismiss` | N/A | no diff dialog surface |
| `left` | `diff:previousSource` | N/A | no diff dialog surface |
| `right` | `diff:nextSource` | N/A | no diff dialog surface |
| `up` | `diff:previousFile` | N/A | no diff dialog surface |
| `down` | `diff:nextFile` | N/A | no diff dialog surface |
| `enter` | `diff:viewDetails` | N/A | no diff dialog surface |
| `j` | `diff:nextFile` | N/A | no diff dialog surface |
| `k` | `diff:previousFile` | N/A | no diff dialog surface |
| `pageup` | `scroll:pageUp` | N/A | no diff dialog surface |
| `pagedown` | `scroll:pageDown` | N/A | no diff dialog surface |
| `space` | `scroll:fullPageDown` | N/A | no diff dialog surface |
| `shift+space` | `scroll:fullPageUp` | N/A | no diff dialog surface |
| `b` | `scroll:fullPageUp` | N/A | no diff dialog surface |
| `g` | `scroll:top` | N/A | no diff dialog surface |
| `shift+g` | `scroll:bottom` | N/A | no diff dialog surface |
| `home` | `scroll:top` | N/A | no diff dialog surface |
| `end` | `scroll:bottom` | N/A | no diff dialog surface |

#### `ModelPicker` (3 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `left` | `modelPicker:decreaseEffort` | ❌ | no effort axis |
| `right` | `modelPicker:increaseEffort` | ❌ | no effort axis |
| `s` | `modelPicker:thisSessionOnly` | ❌ | no session-only scope |

#### `Select` (12 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `up` | `select:previous` | ✅ | every picker |
| `down` | `select:next` | ✅ | every picker |
| `j` | `select:next` | ⚠️ | `ThemeDialog.tsx:47` / `OutputStylePicker.tsx:36` only; `SessionPicker`/`ModelPicker`/`BgTasksPanel` lack it |
| `k` | `select:previous` | ⚠️ | same partial coverage |
| `ctrl+n` | `select:next` | ⚠️ | same partial coverage |
| `ctrl+p` | `select:previous` | ⚠️ | same partial coverage |
| `pageup` | `select:pageUp` | ❌ | no paging in any picker |
| `pagedown` | `select:pageDown` | ❌ | no paging in any picker |
| `home` | `select:first` | ❌ | not bound |
| `end` | `select:last` | ❌ | not bound |
| `enter` | `select:accept` | ✅ | every picker |
| `escape` | `select:cancel` | ✅ | every picker |

#### `Plugin` (3 bindings)

| upstream key | upstream action | ours | how we differ |
|---|---|---|---|
| `space` | `plugin:toggle` | N/A | no plugin dialog |
| `i` | `plugin:install` | N/A | no plugin dialog |
| `f` | `plugin:favorite` | N/A | no plugin dialog |

#### `DiffPanel` (0 bindings)

Declared valid in `War` (line 186,159) with the description "When the diff sidebar panel is open", but the default table ships **no** binding for it — it exists purely so users can bind into it.

## 1.8 Our precedence model, and why it is the deeper gap

Our TUI has **no keybinding table, no context registry, and no scope stack.** Verified by reading every
key-handling file: 17 independent `useInput` callbacks with hand-written early returns; `useFocus` /
`useFocusManager` are never imported and `useInput`'s `isActive` option is never passed anywhere in the
directory.

Ink broadcasts every keypress to every subscribed handler (each `useInput` becomes its own
`internal_eventEmitter.on('input', …)` listener) — there is no propagation-stopping. A handler's `return`
exits only that handler. So "precedence" is achieved two inconsistent ways:

1. **By unmounting.** `ChatApp.tsx:124–186` is one nested ternary occupying the composer slot; when an
   overlay arm wins, `<ChatComposer>` is not rendered and its `useInput` unsubscribes. The precedence order
   is literally the ternary order: `shortcutsOpen` → `transcriptOpen` → `historyOpen` → `rewinding` →
   `rewindPicker` → `bgPanelOpen` → `modelPicker` → `settings` → `permissions` → `themeDialog` → `addDir` →
   `picker` → `pending` → composer.
2. **By hand-checked flags in the parent.** `ChatApp`'s own `useInput` (`ChatApp.tsx:83–113`) is never
   unmounted, so it early-returns on a hardcoded list of six flags (`transcriptOpen`, `historyOpen`,
   `settings.open`, `permissions.open`, `themeDialog.open`, `addDir.open`), with `ctrl+z` deliberately
   hoisted above all of them.

**The list is incomplete, and that produces real double-fires.** `shortcutsOpen`, `rewindPicker.open`,
`bgPanelOpen`, `modelPicker.open`, `picker.open`, `state.pending` and `state.rewinding` are not gated. Some
of that is intentional (a documented decision at `ChatApp.tsx:76–81` keeps Ctrl-C/Z/B/T live during
dialogs), but the ShortcutsOverlay case is a genuine collision: it closes on *any* key
(`ShortcutsOverlay.tsx:40`) while `ChatApp`'s handler acts on the same key — pressing `ctrl+o` with help
open closes the help **and** opens the transcript pager; `ctrl+c` closes it **and** arms exit.

Upstream's model makes that class of bug structurally impossible: the modal contributes a scope at a lower
index, the first match consumes the key, and nothing downstream ever sees it.

### Dead / broken bindings on our side (found while inventorying)

1. **`ctrl+_` / `ctrl+-` undo is unreachable and corrupts the buffer.** Terminals send a bare `0x1f`. Ink's
   `parse-keypress.js` sets `ctrl:true` only for `s.length===1 && s <= '\x1a'`, so `0x1f` arrives with
   `key.ctrl === false` and `input === '\x1f'`. It never enters `if (key.ctrl)` at `editor.ts:232`, falls
   through to the insert branch at `editor.ts:259`, and **inserts a literal `\x1f`**. Only reducer-level
   tests exist (`test/tui/editor.test.ts:342,357,359` call `applyKey(s,"_",{ctrl:true})` directly), so
   nothing catches it. `ShortcutsOverlay.tsx:18` advertises "Ctrl-_ undo edit" — currently a false promise.
2. **`ctrl+j` at `editor.ts:239` is dead but harmless.** `0x0a` matches parse-keypress's `s === '\n'` branch
   first → `name:'enter'`, `ctrl:false`, so it arrives as `input:'\n'` and inserts a newline via
   `editor.ts:259` anyway. Same observable behaviour, dead code path.
3. **`pager.ts:32`'s `key.shift` branch is dead.** `Shift+G` arrives as `input === "G"`, so
   `input === "g" && key.shift` never holds; `pager.ts:33` is what handles bottom-jump.

## 1.9 Gap table — keybindings

| # | upstream | ours | classification | effort |
|---|---|---|---|---|
| K1 | Declarative keybinding table (`jar`), 19 contexts × 180 bindings, one source of truth | 17 ad-hoc `useInput` callbacks, no table | **missing** | L |
| K2 | Ordered-context precedence resolver (`ePt`), first-match-wins over a focus scope chain, `Global` last | Nested-ternary unmounting + 6 hand-checked flags; known double-fires | **missing** | L |
| K3 | `swallowAll` and `preemptiveScopes` dispatch layers above the focus chain | none | **missing** | M |
| K4 | Chord support with 1 s timeout, generic (`ctrl+x ctrl+k`, `ctrl+x ctrl+e`, `ctrl+x ctrl+b`) | two bespoke `useRef` timestamp chords with a 2 s window, hardcoded to `ctrl+x` | **partial** | M |
| K5 | User rebinding via `~/.claude/keybindings.json`, additive merge, `null` to unbind, hot reload, typed validation, reserved-key registry | none; `/keybindings` shows a read-only overlay | **missing** | L |
| K6 | `command:<name>` bindings (run a slash command from a key, Chat-only) | none | **missing** | S |
| K7 | Key normalisation + alias table (`car`/`mPt`), `alt≡meta` equality | Ink's raw `key` object, compared inline | **partial** | S |
| K8 | Platform branching: `alt+v` vs `ctrl+v` paste; `shift+tab` vs `meta+m`; iTerm2⇒macOS coercion; tmux `ctrl+b ctrl+b` hint | none — `shift+tab` hardcoded, no paste key at all | **missing** | S |
| K9 | Composer kill-ring with `ctrl+y` yank and `alt+y` yank-pop | kills discard the text | **missing** | S |
| K10 | `ctrl+b` (left) / `ctrl+f` (right) / `ctrl+h` (delete-token) in the composer | not bound in the composer (`ctrl+b`/`ctrl+f` are ours only inside the pager) | **missing** | S |
| K11 | `ctrl+n` / `ctrl+p` as history next/prev in the composer | not bound (ours are pager/list-only) | **missing** | S |
| K12 | `alt+d` delete-word-after | not bound | **missing** | S |
| K13 | `escape escape` with text ⇒ clear input; with empty buffer ⇒ rewind | `escape escape` ⇒ rewind **always** | **divergent** | S |
| K14 | `←←` on an empty composer ⇒ agents view | not bound | **missing** (no agents view) | M |
| K15 | Confirmation dialog: `y` / `n` | `a` / `A` / `d` / `D` + digits `1`–`3` | **divergent** | S |
| K16 | Confirmation: `tab` next field, `shift+tab` cycle mode, `ctrl+e` toggle explanation | none | **missing** | S |
| K17 | `meta+p` model picker · `meta+t` thinking · `meta+o` fast mode · `meta+w` workflow keyword | slash commands only (`/model`, `/think`) | **missing** | S each |
| K18 | `cmd+k` clear screen (Chat) | `/clear` only | **missing** | S |
| K19 | `ctrl+shift+b` toggle brief · `ctrl+]` open artifact | none | **missing** (no such surfaces) | M |
| K20 | `ctrl+up`/`ctrl+down`/`meta+up`/`meta+down` diff file list | none | **not applicable** (no diff file list) | — |
| K21 | Whole `DiffDialog` context (17 bindings) and `DiffPanel` | none | **not applicable** | L |
| K22 | Whole `Scroll` context (14) — wheel, `ctrl+home`/`ctrl+end`, `shift+arrows` selection, `ctrl+shift+c`/`cmd+c` copy | none | **missing** | L |
| K23 | Whole `Footer` context (11) — focusable footer indicators | none | **not applicable** | M |
| K24 | Whole `Attachments` context (6) — image attachment navigation | none | **not applicable** (no image paste) | M |
| K25 | Whole `Plugin` context (3) | none | **not applicable** | S |
| K26 | `ModelPicker`: `←`/`→` effort, `s` this-session-only | none (arrows unused in our picker) | **missing** | S |
| K27 | `MessageSelector`: `j`/`k`, `ctrl+n`/`ctrl+p`, top/bottom jumps (`ctrl+up`, `shift+up`, `meta+up`, `shift+k`, and mirrors) | `up`/`down`/`enter` only | **partial** | S |
| K28 | `Select`: `j`/`k`, `ctrl+n`/`ctrl+p`, `pageup`/`pagedown`, `home`/`end` | `SessionPicker`/`ModelPicker` have arrows+enter only; `ThemeDialog`/`OutputStylePicker` do have `j`/`k`/`ctrl+n`/`ctrl+p` | **partial** | S |
| K29 | `Settings`: `r` retry, `d`/`w` period, `t` sort-by-tokens, `ctrl+u`/`ctrl+d` half-page | none (our Usage/Stats tabs are static) | **missing** | M |
| K30 | `Transcript`: `ctrl+e` toggle-show-all, `home`/`end` | not bound (documented gap at `pager.ts:3–5`) | **missing** | S |
| K31 | `Task`: `ctrl+x ctrl+b` as an alias for `ctrl+b` | only `ctrl+b` | **partial** | S |
| K32 | `ThemePicker`: `ctrl+t` syntax-highlight toggle, `ctrl+e` edit custom theme | none | **missing** | M |
| K33 | Pager extras `{`/`}`/`/`/`n`/`N`/`[`/`v` | none | **missing** | M |
| K34 | `space` ⇒ `voice:pushToTalk` in Chat | space types a space | **not applicable** (no voice) | — |
| K35 | `ctrl+v`/`alt+v` ⇒ `chat:imagePaste` | none | **missing** | M |
| K36 | `Help` context: only `escape` dismisses | **any key** dismisses | **divergent** (superset) | S |
| K37 | `ctrl+z` is a **reserved-key warning** ("Unix process suspend (SIGTSTP)") and is **not bound** | bound to detach, hoisted above every gate | **divergent** — a key we bind that upstream leaves free | S |
| K38 | `ctrl+d` on empty composer requires **two** presses | exits on **one** | **divergent** | S |
| K39 | Our `ctrl+_`/`ctrl+-` undo is unreachable and inserts `\x1f` | upstream binds four aliases and they work | **divergent** (a live bug) | S |
| K40 | `shift+enter` newline via `/terminal-setup` writing the host terminal's keymap | none | **missing** | M |

### Keys where we do something **actively different** from upstream

These are the ones a Claude Code user will feel as wrong. Ordered by how likely they are to bite.

| key | upstream | ours | why it will feel wrong |
|---|---|---|---|
| `escape escape` **with text in the composer** | clears the input (after an "Esc again to clear" hint) | opens the rewind picker | a muscle-memory buffer-clear silently opens a destructive time-travel dialog |
| `ctrl+z` | **not bound** — flagged as a terminal-reserved SIGTSTP warning | detach + exit (attached) / notice (loopback) | the user expects the shell to suspend the process; instead the session detaches |
| `ctrl+d` on an empty composer | first press hints, second exits | exits on the first press | a stray `ctrl+d` ends the session with no confirmation |
| `y` / `n` in a permission dialog | `confirm:yes` / `confirm:no` | unbound — `y` and `n` do nothing; we use `a`/`A`/`d`/`D` | the two most reflexive confirmation keys are dead |
| `ctrl+_` / `ctrl+-` | undo the last edit | **inserts a raw `\x1f` control character into the buffer** (dead branch) | advertised in our own help overlay; visibly corrupts the input |
| `ctrl+b` in the composer | move cursor left (readline) | background the turn / open the bg panel | readline users lose left-arrow; ours is a global that also collides with tmux's prefix |
| `ctrl+f` in the composer | move cursor right (readline) | unbound in the composer (pager-only) | readline right-arrow silently does nothing |
| `ctrl+n` / `ctrl+p` in the composer | history next / previous | unbound in the composer | readline history navigation silently does nothing |
| `ctrl+y` | yank from the kill-ring | unbound | `ctrl+u` then `ctrl+y` loses the text permanently |
| any key while the `?` help overlay is open | only `escape` dismisses; every other key is inert | dismisses **and** the key also fires `ChatApp`'s global chord | `ctrl+o` closes help and opens the pager in one press |

### Keys we bind that upstream leaves free

| key | ours | upstream |
|---|---|---|
| `ctrl+z` | detach + exit | not bound; **reserved-key warning** (SIGTSTP) |
| `ctrl+b` (in the chat composer, not a foreground Task) | background the turn / open bg panel | in `Chat` it is free (readline left); `ctrl+b` is bound only in `Task` and `Transcript` |
| `a` / `A` / `d` / `D` in a permission dialog | allow-once / allow-always / deny | free in `Confirmation` (upstream uses `y`/`n`) |
| `k` / `x` in the bg-tasks panel | stop the selected task | no equivalent context upstream |
| `1` / `2` / `3` in the rewind picker's scope stage | restore both / conversation / code | `MessageSelector` binds no digits |
| any key in the `?` overlay | close | only `escape` in `Help` |

---

# Deliverable 2 — The theme system

## 2.1 Registry and picker

Six themes, ids at line 41,474:

```js
ZDi = ["dark", "light", "light-daltonized", "dark-daltonized", "light-ansi", "dark-ansi"],
W3r = ["auto", ...ZDi]
```

`auto` is a **selection value only**, not a palette — it resolves to `dark` or `light` at read time (§2.5).

Palette lookup (`tY`, line 156,423), verbatim:

```js
switch (e) {
  case "light":            return bZg;
  case "light-ansi":       return EZg;
  case "dark-ansi":        return SZg;
  case "light-daltonized": return AZg;
  case "dark-daltonized":  return TZg;
  default:                 return vZg;   // dark
}
```

Picker rows, verbatim (line 440,674) — all seven, in this order, followed by any custom themes and a
"New custom theme…" row when custom-theme authoring is enabled:

| value | label |
|---|---|
| `auto` | Auto (match terminal) |
| `dark` | Dark mode |
| `light` | Light mode |
| `dark-daltonized` | Dark mode (colorblind-friendly) |
| `light-daltonized` | Light mode (colorblind-friendly) |
| `dark-ansi` | **Dark mode (ANSI colors only)** |
| `light-ansi` | **Light mode (ANSI colors only)** |

The picker header is `"Choose the text style that looks best with your terminal"`. Default on first run is
`theme: "dark"` (line 377,294). `lpo(e) { return e.startsWith("light") }` (line 156,419) is the
is-light-theme predicate used for contrast decisions.

## 2.2 The complete token table — 72 tokens × 6 themes

All six palettes carry the **identical 72-key set in the identical order** (verified programmatically), so
there are no theme-specific tokens and no fallbacks. 432 values total. Source: line 156,475.

| # | token | dark | light | dark-daltonized | light-daltonized | dark-ansi | light-ansi |
|---|---|---|---|---|---|---|---|
| 1 | `autoAccept` | `rgb(175,135,255)` | `rgb(135,0,255)` | `rgb(175,135,255)` | `rgb(135,0,255)` | `ansi:magentaBright` | `ansi:magenta` |
| 2 | `autoAcceptShimmer` | `rgb(208,180,255)` | `rgb(208,180,255)` | `rgb(208,180,255)` | `rgb(208,180,255)` | `ansi:magentaBright` | `ansi:magentaBright` |
| 3 | `skill` | `rgb(175,135,255)` | `rgb(135,0,255)` | `rgb(175,135,255)` | `rgb(135,0,255)` | `ansi:magentaBright` | `ansi:magenta` |
| 4 | `bashBorder` | `rgb(253,93,177)` | `rgb(255,0,135)` | `rgb(51,153,255)` | `rgb(0,102,204)` | `ansi:magentaBright` | `ansi:magenta` |
| 5 | `claude` | `rgb(215,119,87)` | `rgb(215,119,87)` | `rgb(255,153,51)` | `rgb(255,153,51)` | `ansi:redBright` | `ansi:redBright` |
| 6 | `claudeShimmer` | `rgb(235,159,127)` | `rgb(245,149,117)` | `rgb(255,183,101)` | `rgb(255,183,101)` | `ansi:yellowBright` | `ansi:yellowBright` |
| 7 | `claudeBlue_FOR_SYSTEM_SPINNER` | `rgb(147,165,255)` | `rgb(87,105,247)` | `rgb(153,204,255)` | `rgb(51,102,255)` | `ansi:blueBright` | `ansi:blue` |
| 8 | `claudeBlueShimmer_FOR_SYSTEM_SPINNER` | `rgb(177,195,255)` | `rgb(117,135,255)` | `rgb(183,224,255)` | `rgb(101,152,255)` | `ansi:blueBright` | `ansi:blueBright` |
| 9 | `permission` | `rgb(177,185,249)` | `rgb(87,105,247)` | `rgb(153,204,255)` | `rgb(51,102,255)` | `ansi:blueBright` | `ansi:blue` |
| 10 | `permissionShimmer` | `rgb(207,215,255)` | `rgb(137,155,255)` | `rgb(183,224,255)` | `rgb(101,152,255)` | `ansi:blueBright` | `ansi:blueBright` |
| 11 | `planMode` | `rgb(72,150,140)` | `rgb(0,102,102)` | `rgb(102,153,153)` | `rgb(51,102,102)` | `ansi:cyanBright` | `ansi:cyan` |
| 12 | `ide` | `rgb(71,130,200)` | `rgb(71,130,200)` | `rgb(71,130,200)` | `rgb(71,130,200)` | `ansi:blue` | `ansi:blueBright` |
| 13 | `promptBorder` | `rgb(136,136,136)` | `rgb(153,153,153)` | `rgb(136,136,136)` | `rgb(153,153,153)` | `ansi:white` | `ansi:white` |
| 14 | `promptBorderShimmer` | `rgb(166,166,166)` | `rgb(183,183,183)` | `rgb(166,166,166)` | `rgb(183,183,183)` | `ansi:whiteBright` | `ansi:whiteBright` |
| 15 | `text` | `rgb(255,255,255)` | `rgb(0,0,0)` | `rgb(255,255,255)` | `rgb(0,0,0)` | `ansi:whiteBright` | `ansi:black` |
| 16 | `inverseText` | `rgb(0,0,0)` | `rgb(255,255,255)` | `rgb(0,0,0)` | `rgb(255,255,255)` | `ansi:black` | `ansi:white` |
| 17 | `inactive` | `rgb(153,153,153)` | `rgb(102,102,102)` | `rgb(153,153,153)` | `rgb(102,102,102)` | `ansi:white` | `ansi:blackBright` |
| 18 | `inactiveShimmer` | `rgb(193,193,193)` | `rgb(142,142,142)` | `rgb(193,193,193)` | `rgb(142,142,142)` | `ansi:whiteBright` | `ansi:white` |
| 19 | `subtle` | `rgb(80,80,80)` | `rgb(175,175,175)` | `rgb(80,80,80)` | `rgb(175,175,175)` | `ansi:white` | `ansi:blackBright` |
| 20 | `suggestion` | `rgb(177,185,249)` | `rgb(87,105,247)` | `rgb(153,204,255)` | `rgb(51,102,255)` | `ansi:blueBright` | `ansi:blue` |
| 21 | `remember` | `rgb(177,185,249)` | `rgb(0,0,255)` | `rgb(153,204,255)` | `rgb(51,102,255)` | `ansi:blueBright` | `ansi:blue` |
| 22 | `background` | `rgb(0,204,204)` | `rgb(0,153,153)` | `rgb(0,204,204)` | `rgb(0,153,153)` | `ansi:cyanBright` | `ansi:cyan` |
| 23 | `success` | `rgb(78,186,101)` | `rgb(44,122,57)` | `rgb(51,153,255)` | `rgb(0,102,153)` | `ansi:greenBright` | `ansi:green` |
| 24 | `error` | `rgb(255,107,128)` | `rgb(171,43,63)` | `rgb(255,102,102)` | `rgb(204,0,0)` | `ansi:redBright` | `ansi:red` |
| 25 | `warning` | `rgb(255,193,7)` | `rgb(150,108,30)` | `rgb(255,204,0)` | `rgb(255,153,0)` | `ansi:yellowBright` | `ansi:yellow` |
| 26 | `merged` | `rgb(175,135,255)` | `rgb(135,0,255)` | `rgb(175,135,255)` | `rgb(135,0,255)` | `ansi:magentaBright` | `ansi:magenta` |
| 27 | `warningShimmer` | `rgb(255,223,57)` | `rgb(200,158,80)` | `rgb(255,234,50)` | `rgb(255,183,50)` | `ansi:yellowBright` | `ansi:yellowBright` |
| 28 | `diffAdded` | `rgb(34,92,43)` | `rgb(105,219,124)` | `rgb(0,68,102)` | `rgb(153,204,255)` | `ansi:green` | `ansi:green` |
| 29 | `diffRemoved` | `rgb(122,41,54)` | `rgb(255,168,180)` | `rgb(102,0,0)` | `rgb(255,204,204)` | `ansi:red` | `ansi:red` |
| 30 | `diffAddedDimmed` | `rgb(71,88,74)` | `rgb(199,225,203)` | `rgb(62,81,91)` | `rgb(209,231,253)` | `ansi:green` | `ansi:green` |
| 31 | `diffRemovedDimmed` | `rgb(105,72,77)` | `rgb(253,210,216)` | `rgb(62,44,44)` | `rgb(255,233,233)` | `ansi:red` | `ansi:red` |
| 32 | `diffAddedWord` | `rgb(56,166,96)` | `rgb(47,157,68)` | `rgb(0,119,179)` | `rgb(51,102,204)` | `ansi:greenBright` | `ansi:greenBright` |
| 33 | `diffRemovedWord` | `rgb(179,89,107)` | `rgb(209,69,75)` | `rgb(179,0,0)` | `rgb(153,51,51)` | `ansi:redBright` | `ansi:redBright` |
| 34 | `red_FOR_SUBAGENTS_ONLY` | `rgb(220,38,38)` | `rgb(220,38,38)` | `rgb(255,102,102)` | `rgb(204,0,0)` | `ansi:redBright` | `ansi:red` |
| 35 | `blue_FOR_SUBAGENTS_ONLY` | `rgb(106,155,204)` | `rgb(106,155,204)` | `rgb(102,178,255)` | `rgb(0,102,204)` | `ansi:blueBright` | `ansi:blue` |
| 36 | `green_FOR_SUBAGENTS_ONLY` | `rgb(22,163,74)` | `rgb(22,163,74)` | `rgb(102,255,102)` | `rgb(0,204,0)` | `ansi:greenBright` | `ansi:green` |
| 37 | `yellow_FOR_SUBAGENTS_ONLY` | `rgb(202,138,4)` | `rgb(202,138,4)` | `rgb(255,255,102)` | `rgb(255,204,0)` | `ansi:yellowBright` | `ansi:yellow` |
| 38 | `purple_FOR_SUBAGENTS_ONLY` | `rgb(130,125,189)` | `rgb(130,125,189)` | `rgb(178,102,255)` | `rgb(128,0,128)` | `ansi:magentaBright` | `ansi:magenta` |
| 39 | `orange_FOR_SUBAGENTS_ONLY` | `rgb(217,119,87)` | `rgb(217,119,87)` | `rgb(255,178,102)` | `rgb(255,128,0)` | `ansi:redBright` | `ansi:redBright` |
| 40 | `pink_FOR_SUBAGENTS_ONLY` | `rgb(196,102,134)` | `rgb(196,102,134)` | `rgb(255,153,204)` | `rgb(255,102,178)` | `ansi:magentaBright` | `ansi:magentaBright` |
| 41 | `cyan_FOR_SUBAGENTS_ONLY` | `rgb(8,145,178)` | `rgb(8,145,178)` | `rgb(102,204,204)` | `rgb(0,178,178)` | `ansi:cyanBright` | `ansi:cyan` |
| 42 | `professionalBlue` | `rgb(106,155,204)` | `rgb(106,155,204)` | `rgb(106,155,204)` | `rgb(106,155,204)` | `rgb(106,155,204)` | `ansi:blueBright` |
| 43 | `chromeYellow` | `rgb(251,188,4)` | `rgb(251,188,4)` | `rgb(251,188,4)` | `rgb(251,188,4)` | `ansi:yellowBright` | `ansi:yellow` |
| 44 | `clawd_body` | `rgb(215,119,87)` | `rgb(215,119,87)` | `rgb(215,119,87)` | `rgb(215,119,87)` | `ansi:redBright` | `ansi:redBright` |
| 45 | `clawd_background` | `rgb(0,0,0)` | `rgb(0,0,0)` | `rgb(0,0,0)` | `rgb(0,0,0)` | `ansi:black` | `ansi:black` |
| 46 | `userMessageBackground` | `rgb(55, 55, 55)` | `rgb(240, 240, 240)` | `rgb(55, 55, 55)` | `rgb(220, 220, 220)` | `ansi:blackBright` | `ansi:white` |
| 47 | `userMessageBackgroundHover` | `rgb(70, 70, 70)` | `rgb(252, 252, 252)` | `rgb(70, 70, 70)` | `rgb(232, 232, 232)` | `ansi:white` | `ansi:whiteBright` |
| 48 | `composerSidebarBackground` | `rgb(38, 38, 38)` | `rgb(245, 245, 245)` | `rgb(38, 38, 38)` | `rgb(235, 235, 235)` | `ansi:blackBright` | `ansi:white` |
| 49 | `selectionBg` | `rgb(38, 79, 120)` | `rgb(180, 213, 255)` | `rgb(38, 79, 120)` | `rgb(180, 213, 255)` | `ansi:blue` | `ansi:cyan` |
| 50 | `bashMessageBackgroundColor` | `rgb(65, 60, 65)` | `rgb(250, 245, 250)` | `rgb(65, 60, 65)` | `rgb(250, 245, 250)` | `ansi:black` | `ansi:whiteBright` |
| 51 | `memoryBackgroundColor` | `rgb(55, 65, 70)` | `rgb(230, 245, 250)` | `rgb(55, 65, 70)` | `rgb(230, 245, 250)` | `ansi:blackBright` | `ansi:white` |
| 52 | `rate_limit_fill` | `rgb(177,185,249)` | `rgb(87,105,247)` | `rgb(153,204,255)` | `rgb(51,102,255)` | `ansi:yellow` | `ansi:yellow` |
| 53 | `rate_limit_empty` | `rgb(80,83,112)` | `rgb(39,47,111)` | `rgb(69,92,115)` | `rgb(23,46,114)` | `ansi:white` | `ansi:black` |
| 54 | `fastMode` | `rgb(255,120,20)` | `rgb(255,106,0)` | `rgb(255,120,20)` | `rgb(255,106,0)` | `ansi:redBright` | `ansi:red` |
| 55 | `fastModeShimmer` | `rgb(255,165,70)` | `rgb(255,150,50)` | `rgb(255,165,70)` | `rgb(255,150,50)` | `ansi:redBright` | `ansi:redBright` |
| 56 | `effortUltra` | `rgb(175,135,255)` | `rgb(135,0,255)` | `rgb(175,135,255)` | `rgb(135,0,255)` | `ansi:magentaBright` | `ansi:magenta` |
| 57 | `briefLabelYou` | `rgb(122,180,232)` | `rgb(37,99,235)` | `rgb(122,180,232)` | `rgb(37,99,235)` | `ansi:blueBright` | `ansi:blue` |
| 58 | `briefLabelClaude` | `rgb(215,119,87)` | `rgb(215,119,87)` | `rgb(255,153,51)` | `rgb(255,153,51)` | `ansi:redBright` | `ansi:redBright` |
| 59 | `rainbow_red` | `rgb(235,95,87)` | `rgb(235,95,87)` | `rgb(235,95,87)` | `rgb(235,95,87)` | `ansi:red` | `ansi:red` |
| 60 | `rainbow_orange` | `rgb(245,139,87)` | `rgb(245,139,87)` | `rgb(245,139,87)` | `rgb(245,139,87)` | `ansi:redBright` | `ansi:redBright` |
| 61 | `rainbow_yellow` | `rgb(250,195,95)` | `rgb(250,195,95)` | `rgb(250,195,95)` | `rgb(250,195,95)` | `ansi:yellow` | `ansi:yellow` |
| 62 | `rainbow_green` | `rgb(145,200,130)` | `rgb(145,200,130)` | `rgb(145,200,130)` | `rgb(145,200,130)` | `ansi:green` | `ansi:green` |
| 63 | `rainbow_blue` | `rgb(130,170,220)` | `rgb(130,170,220)` | `rgb(130,170,220)` | `rgb(130,170,220)` | `ansi:cyan` | `ansi:cyan` |
| 64 | `rainbow_indigo` | `rgb(155,130,200)` | `rgb(155,130,200)` | `rgb(155,130,200)` | `rgb(155,130,200)` | `ansi:blue` | `ansi:blue` |
| 65 | `rainbow_violet` | `rgb(200,130,180)` | `rgb(200,130,180)` | `rgb(200,130,180)` | `rgb(200,130,180)` | `ansi:magenta` | `ansi:magenta` |
| 66 | `rainbow_red_shimmer` | `rgb(250,155,147)` | `rgb(250,155,147)` | `rgb(250,155,147)` | `rgb(250,155,147)` | `ansi:redBright` | `ansi:redBright` |
| 67 | `rainbow_orange_shimmer` | `rgb(255,185,137)` | `rgb(255,185,137)` | `rgb(255,185,137)` | `rgb(255,185,137)` | `ansi:yellow` | `ansi:yellow` |
| 68 | `rainbow_yellow_shimmer` | `rgb(255,225,155)` | `rgb(255,225,155)` | `rgb(255,225,155)` | `rgb(255,225,155)` | `ansi:yellowBright` | `ansi:yellowBright` |
| 69 | `rainbow_green_shimmer` | `rgb(185,230,180)` | `rgb(185,230,180)` | `rgb(185,230,180)` | `rgb(185,230,180)` | `ansi:greenBright` | `ansi:greenBright` |
| 70 | `rainbow_blue_shimmer` | `rgb(180,205,240)` | `rgb(180,205,240)` | `rgb(180,205,240)` | `rgb(180,205,240)` | `ansi:cyanBright` | `ansi:cyanBright` |
| 71 | `rainbow_indigo_shimmer` | `rgb(195,180,230)` | `rgb(195,180,230)` | `rgb(195,180,230)` | `rgb(195,180,230)` | `ansi:blueBright` | `ansi:blueBright` |
| 72 | `rainbow_violet_shimmer` | `rgb(230,180,210)` | `rgb(230,180,210)` | `rgb(230,180,210)` | `rgb(230,180,210)` | `ansi:magentaBright` | `ansi:magentaBright` |

## 2.3 Semantic roles

There is no separate "role" indirection: the token *is* the role, and components pass the token name
straight into `color=` / `backgroundColor=` / `borderColor=` props on the vendored Ink `Text`/`Box`. I
counted every literal `color:"<token>"`-style prop across the bundle — **956 usages**. The frequency shows
which roles carry the UI:

| role | token(s) | prop usages |
|---|---|---|
| error | `error` | 189 |
| warning | `warning` | 160 |
| success | `success` | 105 |
| suggestion / hint | `suggestion` | 81 |
| permission (dialogs, headings) | `permission` | 79 |
| Claude brand | `claude` | 70 |
| primary text | `text` | 51 |
| dim / de-emphasised | `subtle` (38), `inactive` (35) | 73 |
| mascot | `clawd_body` (36), `clawd_background` (6) | 42 |
| plan mode | `planMode` | 11 |
| IDE integration | `ide` | 9 |
| user-message background | `userMessageBackground` | 9 |
| bash tool border | `bashBorder` | 6 |
| fast mode | `fastMode` | 6 |
| auto-accept mode | `autoAccept` | 5 |
| background (accent fill) | `background` | 29 |
| memory (`#`) | `remember` (7), `memoryBackgroundColor` (2) | 9 |

Four naming conventions carry meaning:

- **`*Shimmer`** — every animated token has a `<base>Shimmer` twin (`claudeShimmer`,
  `permissionShimmer`, `warningShimmer`, `autoAcceptShimmer`, `promptBorderShimmer`, `inactiveShimmer`,
  `fastModeShimmer`, `claudeBlueShimmer_FOR_SYSTEM_SPINNER`, and all seven `rainbow_*_shimmer`). They read
  0 direct prop usages because they are consumed as the `shimmerColor` prop of the per-character glimmer
  renderer (line 396,181 / 407,453), which interpolates base→shimmer along a moving index.
- **`*_FOR_SUBAGENTS_ONLY`** — eight colours (`red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`,
  `cyan`) reserved for subagent identity, dispatched through a name map
  `fV = { red: "red_FOR_SUBAGENTS_ONLY", … }` (line 188,627). The suffix is a hard convention: these are the
  only place a raw colour word is allowed, and they must not be reused for semantic state.
- **`*_FOR_SYSTEM_SPINNER`** — `claudeBlue…`, reserved for the spinner so it does not drift with the brand.
- **`diff*`** — a six-token family: `diffAdded` / `diffRemoved` (line backgrounds),
  `diffAddedDimmed` / `diffRemovedDimmed` (context lines), `diffAddedWord` / `diffRemovedWord` (intra-line
  word-level highlight). Selection is dynamic (line 419,983):
  `R = i === "add" ? (n ? "diffAddedDimmed" : "diffAdded") : (n ? "diffRemovedDimmed" : "diffRemoved")`, so
  they show 0 static prop usages.
- **`rainbow_*`** — a seven-hue ROYGBIV ramp plus shimmer twins, identical across all four non-ANSI themes.

Full role inventory, grouped:

| group | tokens |
|---|---|
| mode indicators | `autoAccept`, `planMode`, `fastMode`, `effortUltra`, `skill`, `merged` |
| brand / identity | `claude`, `claudeBlue_FOR_SYSTEM_SPINNER`, `clawd_body`, `clawd_background`, `briefLabelYou`, `briefLabelClaude`, `professionalBlue`, `chromeYellow` |
| state | `success`, `error`, `warning`, `permission`, `suggestion`, `remember` |
| text hierarchy | `text`, `inverseText`, `inactive`, `subtle` |
| chrome | `promptBorder`, `bashBorder`, `background`, `ide` |
| surfaces | `userMessageBackground`, `userMessageBackgroundHover`, `composerSidebarBackground`, `bashMessageBackgroundColor`, `memoryBackgroundColor`, `selectionBg` |
| diff | the six `diff*` |
| subagents | the eight `*_FOR_SUBAGENTS_ONLY` |
| usage meter | `rate_limit_fill`, `rate_limit_empty` |
| decoration | the fourteen `rainbow_*` |

## 2.4 How the two `-ansi` variants differ structurally

Confirmed: **they are the same 72 keys, but every value is a symbolic `ansi:<name>` reference instead of a
literal colour.** Value grammar, from the validator `JFe` (line 156,441):

```js
/^rgb\(\s?\d{1,3},\s?\d{1,3},\s?\d{1,3}\s?\)$/   // rgb(r,g,b)   — what the 4 non-ANSI themes use
/^#[0-9a-fA-F]{6}$/ | /^#[0-9a-fA-F]{3}$/        // hex          — accepted, unused in built-ins
/^ansi256\(\d{1,3}\)$/                            // 256-colour   — accepted, unused in built-ins
e.startsWith("ansi:") && wZg.has(e.slice(5))      // named ANSI   — what the 2 ANSI themes use
```

The legal ANSI names are exactly the 16-colour terminal palette (`wZg`, line 156,476): `black`, `red`,
`green`, `yellow`, `blue`, `magenta`, `cyan`, `white` and their eight `*Bright` twins. Resolution is a
switch that dispatches to chalk's named methods rather than truecolor (`iVe`, line 168,176) — e.g.
`ansi:red` → `chalk.red` for foreground, `chalk.bgRed` for background. Non-ANSI values go through
`upo`/`CZg.rgb(r,g,b)` instead (line 156,458).

Three structural consequences, all visible in the table:

1. **Colours are *terminal-defined*, not app-defined.** `ansi:red` renders as whatever red the user's
   terminal profile sets. That is the point — the ANSI themes exist so Claude Code inherits the user's
   colour scheme instead of overriding it.
2. **Massive collapse of distinctions.** In `dark`, `diffAdded` (`rgb(34,92,43)`) and `diffAddedDimmed`
   (`rgb(71,88,74)`) are separate greens; in `dark-ansi` both are `ansi:green`. Likewise
   `autoAccept`/`autoAcceptShimmer`/`skill`/`bashBorder` are four distinct hues in `dark` and all
   `ansi:magentaBright` in `dark-ansi`. Shimmer animation degrades to a no-op wherever base and shimmer
   collapse to the same name.
3. **One deliberate escape hatch.** `dark-ansi`'s `professionalBlue` is `"rgb(106,155,204)"` — the single
   literal RGB value in either ANSI theme. Everything else is symbolic. *(Inference: it is used for an
   external-brand mark where an approximation is unacceptable; the bundle does not say why.)*
4. **Light/dark inversion is by name.** `light-ansi` uses base names (`ansi:black` text, `ansi:blue`
   permission); `dark-ansi` uses `*Bright` names (`ansi:whiteBright` text, `ansi:blueBright` permission).
   The `text`/`inverseText` pair flips: `black`/`white` in light, `whiteBright`/`black` in dark.

## 2.5 `auto` and terminal-background detection

Resolution (`eV`, line 156,199 → `Ibe`, line 156,186):

```js
function eV(e) {
  if (e === "auto") return Ibe();
  if (cpo(e)) return e;                 // one of the 6 ids
  let t = F$(e);                        // "custom:<slug>" → slug
  return t && vps(t) || "dark";         // custom theme's declared base, else dark
}
function Ibe() { return xXr ?? sNu() ?? "dark"; }
```

A three-tier chain, most authoritative first:

**Tier 1 — live OSC 11 probe (`esy` / `watchSystemTheme`, line 168,486).** Sends the terminal an
`OSC 11` background-colour query. When `process.env.TMUX || process.env.STY` is set, the request is wrapped
in a **DCS passthrough** with a 2000 ms race; if that times out it falls back to flushing and sending the
bare query (`via=mux-bare`). The reply is parsed by `iNu` → `Wiy`, which accepts `rgba?:RRRR/GGGG/BBBB`
(any 1–4 hex digits per channel, normalised by `16**len - 1`) or `#hex`, then classifies by **relative
luminance**:

```js
return 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b > 0.5 ? "light" : "dark";
```

The result is cached in `xXr` via `emo()`, which emits on an event bus (`nNu`) so mounted components
re-render. The probe **re-runs on terminal resize and on focus regain**, so moving between a light and dark
terminal profile mid-session re-themes live. It also self-disables: if the first probe gets no reply,
`amo = false` and it never probes again.

**Tier 2 — `COLORFGBG` (`sNu`, line 156,229).** Takes the **last** `;`-separated field, requires an integer
0–15, then: `n <= 6 || n === 8 ? "dark" : "light"`.

**Tier 3 — hard default `"dark"`.**

**Our situation.** `theme.ts:10` sets `auto: { accent: "#d97757", … }`, byte-identical to `dark`, and the
header comment records the reason: *"terminal-background detection isn't available headlessly"*. That is a
real constraint for the daemon path, but it does **not** hold for the foreground REPL: Tier 2
(`process.env.COLORFGBG`) is a pure env read with no TTY interaction and would work today; Tier 1 needs raw
stdin plus a write to stdout, which the foreground REPL already owns. So the gap is smaller than the
comment implies.

## 2.6 Custom and plugin themes

Not in scope for the pinned table, but it is the extension point our five-theme model has no analogue for.

- Location `~/.claude/themes/*.json`, schema `{ name, base, overrides }` (line 166,090).
- `base` must be one of the six built-ins (else silently `"dark"`).
- `overrides` are filtered twice: the key must already exist in the base palette
  (`Object.hasOwn(l, c)`) **and** the value must pass `JFe`. Unknown keys and malformed values are dropped
  without error, so a custom theme can never introduce a new token.
- 256 KB per-file cap; files over it are skipped with a warning.
- Referenced as `custom:<slug>`; slugs are `toLowerCase().replace(/[^a-z0-9]+/g,"-")`.
- Hot-watched with chokidar (300 ms stability threshold), so edits re-theme live.
- A parallel `pluginThemesStore` lets plugins contribute themes through the same merge.
- `theme:editCustom` (`ctrl+e` in the `ThemePicker` context) opens the authoring flow.

## 2.7 Gap table — themes

| # | upstream | ours | classification | effort |
|---|---|---|---|---|
| T1 | 72 semantic tokens per theme | 3 (`accent`, `diffAdd`, `diffRemove`) — `theme.ts:7` | **partial** (~4%) | L |
| T2 | 6 palettes + `auto` | 5 (`auto`, `dark`, `light`, `dark-daltonized`, `light-daltonized`) — `theme.ts:9–15` | **partial** | S (rows) / L (tokens) |
| T3 | `dark-ansi` / `light-ansi`, values symbolic `ansi:<name>` so the terminal owns the colours | none; our five are literal | **missing** | M |
| T4 | Value grammar `rgb()` \| `#hex` \| `ansi256()` \| `ansi:<name>` with a validator | free-form strings, unvalidated; we mix `#d97757` with bare `"green"`/`"red"` in the same record (`theme.ts:10–14`) | **divergent** | S |
| T5 | `auto` resolves live: OSC 11 probe (tmux-DCS-wrapped, 2 s race) → `COLORFGBG` → `dark`; re-probes on resize/focus; emits so the UI re-renders | `auto` is a static alias for `dark` (`theme.ts:10`, comment at :18–19) | **missing** | M (Tier 2 alone: S) |
| T6 | `lpo()` is-light predicate driving contrast decisions | none | **missing** | S |
| T7 | Shimmer twin per animated token, consumed by a per-character glimmer renderer | no animation, no shimmer tokens | **missing** | M |
| T8 | 8 `*_FOR_SUBAGENTS_ONLY` identity colours with a name map | none — subagents are not colour-coded | **missing** | S |
| T9 | 6-token diff family (added/removed × normal/dimmed/word) | 2 (`diffAdd`, `diffRemove`) | **partial** | S |
| T10 | Semantic state tokens `success`/`error`/`warning`/`permission`/`suggestion`/`remember` (614 combined usages) | none — our renderers hardcode ANSI names: `"red"` (`render.ts:87`), `"cyan"`/`"yellow"`/`"green"` (`highlight.ts:27,29,63`), `"cyan"` (`markdown.ts:30`), `"red"`/`"cyan"`/`"yellow"`/`"green"`/`"magenta"` (`ChatStatusBar.tsx:6,8,13,15,16,17`) | **missing** | M |
| T11 | Text-hierarchy tokens `text`/`inverseText`/`inactive`/`subtle` | Ink's `dimColor` boolean only | **missing** | S |
| T12 | Surface/background tokens (6) incl. `selectionBg` and per-mode message backgrounds | composer border colour only, hardcoded `"magenta"`/`"blue"` (`ChatComposer.tsx:141`) | **missing** | M |
| T13 | 14 `rainbow_*` decoration tokens | none | **not applicable** | — |
| T14 | `rate_limit_fill`/`rate_limit_empty` usage meter | none (we print text percentages) | **missing** | S |
| T15 | Custom themes: `~/.claude/themes/*.json`, `{name, base, overrides}`, key+value filtered against the base, 256 KB cap, hot-watched, `custom:<slug>` | none | **missing** | M |
| T16 | Plugin-contributed themes | none | **missing** | M |
| T17 | `theme:editCustom` (`ctrl+e`) and `theme:toggleSyntaxHighlighting` (`ctrl+t`) in the picker | neither | **missing** | M |
| T18 | Picker labels + order (7 rows) | first 5 rows match upstream **verbatim** (`theme.ts:20–23`); the two ANSI rows are absent | **partial** | S |
| T19 | Theme change repaints everything (React re-render over a full-screen renderer) | recolours **new output only** — Ink's `<Static>` scrollback keeps the colours it was written with (recorded in `docs/parity/tui-ux.md:91–93`) | **divergent** | L |

### The shape of the theme gap in one line

Upstream's theme is **a 72-token semantic contract that every component reads by name**. Ours is
**an accent colour plus two diff colours**, with the other ~15 colours our TUI actually paints hardcoded as
raw ANSI names in five different files, invisible to `setTheme()`. Widening `ThemeTokens` is the
prerequisite for every other row in this table — T3, T5, T7, T15 and T19 all sit downstream of it.

---

## Appendix — reproduce this

```sh
cd ~/claude-code-bundle/2.1.220
sed -n '186118p' cli.pretty.js      # the keybinding table (6,076 chars, one line)
sed -n '186159,186160p' cli.pretty.js  # War (20 contexts) + y9u (descriptions) + f_s (134 actions)
sed -n '156475p' cli.pretty.js      # the six palettes (15,449 chars, one line)
sed -n '156419,156470p' cli.pretty.js  # tY / JFe / Lcs / lpo
sed -n '166186,166240p' cli.pretty.js  # Ibe / eV / iNu / sNu  (auto resolution)
sed -n '183155,183290p' cli.pretty.js  # ugo / Y4u / dgo / sut / ePt  (precedence)
sed -n '398360,398380p' cli.pretty.js  # Gbp  (focus scope chain)
```

Do **not** `grep -o '.\{0,400\}pattern.\{0,600\}'` against this file — the 165 KB lines make that
backtrack for minutes. Use `python3` line-indexed slicing instead.
