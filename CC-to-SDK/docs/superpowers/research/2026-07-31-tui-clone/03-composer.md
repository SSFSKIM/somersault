# W4 research — the composer domain (Claude Code 2.1.220 vs `ccx`)

Reference: `~/claude-code-bundle/2.1.220/cli.pretty.js` (579,698 lines, minified-then-beautified).
Every `Lnnnnnn` below is a line number in that file. Ours: `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/src/tui/`.

Evidence convention: quoted string literals are verbatim from the bundle. Anything I could not read
directly is marked **[inference]** or **not determined**. `\xA0` is a non-breaking space, `\u276F` is `❯`.

---

## 0. Where the composer lives upstream

| Piece | Line | Notes |
|---|---|---|
| Keybinding table `jar` (all 20 contexts) | **L186118** | one array literal; `War` (context list) L186159; reserved-key table `vQr` L186151 |
| The composer component (the big one) | **L495222–L496279** | ~1,000 lines; render/JSX at L496223–L496241 |
| Prompt-glyph component `RRn` / `rui` | **L494720 / L494733** | |
| Placeholder generator `MVf` / selector `NVf` | **L495095 / L495107** | |
| Editing model hook `r5o` (the key table) | **L395612–L395866** | |
| Text-buffer class `sd` (motions, viewport, render) | **L394700–L395250** | |
| `Vs` = plain input; `gZa` = vim input | **L396299 / L492326** | |
| Autocomplete engine `F9f` | **L490505–L491120** | |
| Suggestion popup renderer `DXe` | **L432430** | row renderer `q7p` L432489 |
| History nav hook `Z6f` | **L489521** | |
| Inline reverse-search `r9f` + its prompt `xWf` | **L489642 / L493443** | |
| Full-screen history picker `qGf` | **L492153** | |
| Vim state machine `hHa` + command tables | **L434185 / L433923–L434185** | |
| Paste chips (`agr`, `HDo`, `KF`) | **L317381–L317400** | |
| Paste/drag ingest `zhn` | **L395980** | |
| Command queue (`popAllEditable` etc.) | **L149090–L149155** | |
| Hint/footer row `Wci` + `ctl` | **L493714 / L493811** | |

---

## 1. The composer's visual form

### 1.1 Border — it is NOT a box

L496235:

```js
t_ = A9 ? {} : { borderColor: (() => {
  let Wt = { bash: "bashBorder" };
  if (Wt[_]) return Wt[_];
  if (aZ()) return "promptBorder";
  let Cn = ER(); if (Cn && Ov.includes(Cn)) return fV[Cn];
  return "promptBorder";
})(), borderStyle: "round", borderLeft: !1, borderRight: !1, borderBottom: !0 }
```

So: `borderStyle: "round"` with **`borderLeft:false, borderRight:false, borderBottom:true`** — a horizontal
rule above and below the input, **no vertical sides**. Colour is the theme token `promptBorder`, replaced by
`bashBorder` in `!` bash mode, or by a teammate's colour when viewing an agent. In screen-reader mode
(`A9 = Ea()`) the whole border object is `{}` — no border at all.

The container is `flexDirection:"row", alignItems:"flex-start", justifyContent:"flex-start", width:"100%"`
holding `[<prompt glyph>, <input, flexGrow:1 flexShrink:1>]` (L496240).

### 1.2 `borderText` — labels painted onto the border

The same Box takes `borderText: A9 ? void 0 : oQ ?? n8 ?? FPe` (L496240). Three candidates, in priority order:

- `oQ = WVf(Lr === !0, Wr)` — ultracode banner (not in scope here).
- `n8` = history position, when navigating history (L496163):
  `{ content: " ${vt.dim(SO)} ", position: "top", align: "start", offset: 2 }` where
  `SO = AVf(historyIndex, historyTotal, historyEdited)` (L494870):
  ```js
  function AVf(e, t, r) {
    if (e === 0 || r) return;           // not in history, or the recalled entry was edited → no label
    if (t === null) return "History";   // total not yet known
    return `History ${Math.max(1, t - e + 1)}/${t}`;
  }
  ```
  So the top rule literally reads `── History 3/57 ──` while you arrow through past prompts.
- `FPe = mrf([nQ, eR])` — effort-level tag + fast-mode tag.

### 1.3 Prompt glyph

`RRn` (L494720):
```js
Vtl = cVf ? <>{"$\xA0"}</> : <>{Ge.pointer}{"\xA0"}</>;
return <Text color={themeColor} dimColor={isLoading}>{Vtl}</Text>;
```
- Normal: **`Ge.pointer` + NBSP**. `Ge.pointer` is `"\u276F"` (`❯`) on unicode-capable terminals and `">"` on
  the non-unicode fallback set (both defined L104968).
- Screen-reader mode: `"$\xA0"`.
- Bash mode (`rui`, L494733): `<Text color="bashBorder" dimColor={isLoading}>{"!\xA0"}</Text>`.
- **`dimColor: isLoading`** — the glyph dims while a turn is running. That is the only composer-chrome change
  during a turn.
- Not determined: no `#` prefix glyph exists. `mP()` (L236131) recognises **only** `!` → `"bash"`; everything
  else is `"prompt"`. Upstream 2.1.220 has **no `#` memory mode in the composer.**

### 1.4 Placeholder text

`MVf` (L495095) builds the suggestion pool:
```js
let t = e.exampleFiles?.length ? N1(e.exampleFiles) : "<filepath>",
    r = ["fix lint errors", "fix typecheck errors", `how does ${t} work?`, `refactor ${t}`,
         "how do I log an error?", `edit ${t} to...`, `write a test for ${t}`,
         "create a util logging.py that..."];
return `Try "${N1(r)}"`;
```
`N1` picks at random; `exampleFiles` is harvested from `git log -n 1000 --pretty=format: --name-only
--diff-filter=M`, filtered against a lockfile/generated/config denylist (L495082), top 5, refreshed weekly
(`kNb = 604800000`).

`NVf` (L495107) selects which placeholder shows — first match wins:
1. input non-empty → **no placeholder**
2. viewing an agent → `` `Message @${name}…` `` (name truncated at `PVf = 20` chars with `…`)
3. queue non-empty **and** `queuedCommandUpHintCount < 3` → **`"Press up to edit queued messages"`**
4. `submitCount < 1 && !hasMessages && promptSuggestionEnabled` → the `Try "…"` string

Otherwise there is no placeholder at all. Two more override it at the call site (L496239):
`$et = b9 && as ? as : Wge ?? iH` — a model-generated prompt suggestion beats
`` `Comment on ${n} selected line(s)…` `` (IDE diff selection) beats `NVf`'s result.

Placeholder rendering (`t_p`, L395963) — the **first character of the placeholder is drawn inverted** (that is
the cursor), the rest dim:
```js
a = vt.dim(e);
if (r && n && o) a = e.length > 0 ? i(e[0]) + vt.dim(e.slice(1)) : i(" ");
```

### 1.5 Multi-line growth and cursor

- Wrap width: `HK = Wr - NNb` with `NNb = 3` (L496279) → columns − 3. The buffer wraps at
  `sd.fromText(text, columns)` → `new Nyp(text, columns - 1)` (L394703).
- Visible-line cap: `iQ = ds() ? Math.max(PNb, Math.floor(rows/2) - DNb) : undefined` with `PNb = 3, DNb = 5`
  (L496164, L496279). In the **fullscreen** layout the composer scrolls internally at ~rows/2 − 5 lines
  (min 3); in the classic layout it is **unbounded** and simply grows.
- Viewport scrolling keeps the cursor line roughly centred (`getViewportStartLine`, L394706:
  `n = Math.floor(e/2); o = max(0, cursorLine - n)`).
- Cursor: `sd.render` (L394732) wraps the grapheme at the offset in `invert()`; past end-of-text it renders
  `cursorChar`, which is `" "` (`Vs`, L396302: `cursorChar: e.showCursor && !screenReader ? " " : ""`).
- **Terminal-focus aware** (`Vs`, L396300): `c = !terminalFocus ? identity : ...` — when the terminal loses
  focus the cursor stops being drawn inverted.

### 1.6 Idle vs running

The composer body is identical. What changes:
- prompt glyph dims (`dimColor: isLoading`);
- the hint row below it swaps from `"? for shortcuts"` to the interrupt chord (see §5.4);
- `focus: !we && !ae` (L496229) — focus is dropped only while **history-searching** or when the outer app
  says so, **not** while a turn runs. You keep typing; the text queues.
- While a permission park is open the composer additionally renders
  `<Text dimColor>Waiting for permission…</Text>` above itself (L496241).
- External editor in flight replaces the whole bordered row with
  `<Text dimColor italic>Save and close editor to continue...</Text>` (L496237).

---

## 2. Editing model

### 2.1 The `Chat` keybinding context, verbatim (L186118)

```js
{ context: "Chat", bindings: {
  escape: "chat:cancel",
  "ctrl+l": "chat:clearInput",
  "cmd+k": "chat:clearScreen",
  "ctrl+x ctrl+k": "chat:killAgents",
  [m9u]: "chat:cycleMode",            // m9u = "shift+tab", or "meta+m" on old Windows Node/Bun
  "meta+p": "chat:modelPicker",
  "meta+o": "chat:fastMode",
  "meta+t": "chat:thinkingToggle",
  "meta+w": "chat:workflowKeywordToggle",
  enter: "chat:submit",
  "ctrl+j": "chat:newline",
  up: "history:previous",
  down: "history:next",
  "ctrl+_": "chat:undo", "ctrl+-": "chat:undo",
  "ctrl+shift+-": "chat:undo", "ctrl+shift+_": "chat:undo",
  "ctrl+x ctrl+e": "chat:externalEditor",
  "ctrl+g": "chat:externalEditor",
  "ctrl+s": "chat:stash",
  [hmy]: "chat:imagePaste",           // hmy = "ctrl+v", or "alt+v" on Windows/WSL
  ...(platform === "wsl" && { "ctrl+v": "chat:imagePaste" }),
  space: "voice:pushToTalk"
} }
```

And `Global` (same line), which also reaches the composer:
```js
{ context: "Global", bindings: { "ctrl+c": "app:interrupt", "ctrl+d": "app:exit",
  "ctrl+t": "app:toggleTodos", "ctrl+o": "app:toggleTranscript", "ctrl+shift+b": "app:toggleBrief",
  "ctrl+r": "history:search", "ctrl+up": "app:diffFileListUp", "ctrl+down": "app:diffFileListDown",
  "meta+up": "app:diffFileListUp", "meta+down": "app:diffFileListDown", "ctrl+]": "app:openArtifact" } }
```

Reserved / un-rebindable (L186151): `ctrl+c`, `ctrl+d`, `ctrl+m` ("identical to Enter in terminals (both send
CR)"), `capslock` — plus warnings for `ctrl+z`, `ctrl+\`, and the macOS `cmd+*` set.

### 2.2 The raw key table inside `r5o` (L395676–L395830)

**Ctrl map** (`te`, L395676):

| Key | Action |
|---|---|
| `ctrl+a` | `startOfLogicalLine()` — logical, not visual, line |
| `ctrl+b` | `left()` |
| `ctrl+c` | double-press: 1st shows exit message, 2nd exits; a 3rd callback clears a non-empty input |
| `ctrl+d` | empty buffer → double-press exit; else `del()` (forward delete) |
| `ctrl+e` | `endOfLogicalLine()` |
| `ctrl+f` | `right()` |
| `ctrl+h` | `deleteTokenBefore() ?? backspace()` |
| `ctrl+k` | kill to end of line → **kill ring, append** |
| `ctrl+n` | down / history-next |
| `ctrl+p` | up / history-previous |
| `ctrl+u` | kill to start of line → kill ring, prepend; if ≥3 chars killed, notify `"Ctrl+Y to paste deleted text"` (5 s) |
| `ctrl+w` | delete word before → kill ring, prepend |
| `ctrl+y` | **yank** (paste from kill ring) |

**Meta/Alt map** (`de`, L395676): `alt+b` prevWord · `alt+f` nextWord · `alt+d` deleteWordAfter ·
**`alt+y` yank-pop** (cycles the kill ring at the yank site; `ee()` at L395670).

**Named keys** (`Fe`, L395740–L395830):

| Key | Behaviour |
|---|---|
| `escape` | double-press (`Pee`, 800 ms default). 1st: notify `"Esc again to clear"` (1000 ms). 2nd: **push the text to prompt history via `cgr(e)`**, then clear buffer + reset history cursor. Suppressed entirely when `disableEscapeDoublePress` (set when a suggestion popup is open, L496229). |
| `left` | `super` → startOfLine · `ctrl`/`meta`/`fn` → prevWord · else left. On an **empty** buffer, left-arrow is a detach gesture with an arm/fire/absorb/reject state machine and the notice `"Press ← again"` / `"Ambiguous ←, press again to detach"` |
| `right` | `super` → endOfLine · `ctrl`/`meta`/`fn` → nextWord · else right |
| `up` / `down` | ignored with shift/ctrl/meta; else move line, falling through to history at the buffer edge |
| `backspace` | `super` → kill-to-line-start · `meta`/`ctrl` → delete-word-before · else `deleteTokenBefore() ?? backspace()` |
| `delete` | `super`/`meta` → kill-to-line-end · else forward delete |
| `home` / `end` | line start / line end (no-op with ctrl) |
| `pageup` / `pagedown` | line start / line end (no-op in fullscreen or with ctrl) |
| `return` | see below |
| `enter` | (distinct key name — numpad/⌥⏎) always inserts `\n` |
| `tab` | returns `undefined` → handed to the Autocomplete context |

Ignored key names (`tV_`, L395866): `insert, clear, enter, center, undefined, mouse, f1..f12`.

**Newline vs submit** (`ae`, L395700):
```js
function ae({ meta, shift }) {
  if (multiline && offset > 0 && text[offset-1] === "\\")
    return CXs(), W.backspace().insert("\n");     // backslash continuation: eat the "\", insert newline
  if (meta || shift) return W.insert("\n");        // ⌥⏎ / ⇧⏎
  if (FXs()) return W.insert("\n");                // Apple Terminal with a "shift" newline binding installed
  if (onSubmit) onSubmit(text);
  return W;
}
```
plus `ctrl+j` → `chat:newline` from the binding table. Hint strings (`Z_a`, L493448):
`"shift + ⏎ for newline"` (Apple Terminal / configured terminals) · `"\⏎ for newline"` ·
`"backslash (\) + return (⏎) for newline"`.

One oddity worth copying: `if (W.isAtStart() && gon(ze)) return W.insert(ze).left();` (L395830) — typing `!`
at offset 0 inserts it and moves the cursor **left of it**, because the outer `onChange` (`hk`, L495485) then
strips the `!` and flips the component into bash mode. The `.left()` keeps the offset correct across that swap.

### 2.3 Undo

`o9f` (L489736): a snapshot ring, `maxBufferSize: 50`, `debounceMs: 1000` (L495478). Each entry is
`{ text, cursorOffset, pastedContents, timestamp }`, so undo restores **the pasted-content map too**, not just
text. Pushes are debounced except when `immediate` — and `immediate` is set whenever vim mode is on and we are
not mid-INSERT (L495477), so vim gets per-command granularity.

### 2.4 Kill ring

A real kill ring, not a single register: `dispatch({type:"kill", text, direction:"append"|"prepend"})`,
`yank`, `yankPop`, `interrupt` (any non-kill keystroke ends the accumulation run, L395838). Deleted text is
also announced to screen readers via `NXs` (L395955), which spells out `"new line"`, `"tab"`, `"space"` for
whitespace-only kills.

### 2.5 Multi-line paste detection and display — **the bracketed-paste chip**

Detection (`k0`, L495700):
```js
let Cn = stripANSI(text).replace(/\r\n|\r/g, "\n").replaceAll("\t", "    ");
let cl = kmt(Cn);                                   // newline count
let $p = Math.max(0, Math.min(rows - 10, 2));       // = 2 on any normal terminal
if (Cn.length > CMt || cl > $p) { …chip… } else eQ(Cn);
```
with `CMt = 800` (L153739). So: **>800 characters, or more than 2 newlines** → the paste is stored out of band
and a chip is inserted.

Chip literals (L317381):
```js
function agr(e, t) {
  if (t === 0) return `[Pasted text #${e}]`;
  return `[Pasted text #${e} +${t} lines]`;
}
function HDo(e) { return `[Image #${e}]`; }
```
Recogniser (L317389):
```js
/\[(Pasted text|Image|Audio|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g
```
Lost-content forms (L317398): `` `[Pasted text #${id} — content no longer available]` `` and
`` `[...Truncated text #${id} — content no longer available...]` ``.

Chip behaviour, all of it:
- **Atomic delete**: `deleteTokenBefore()` (L395149) matches
  `/(^|\s)\[(Pasted text #\d+(?: \+\d+ lines)?|Image #\d+|Audio #\d+|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]$/`
  and removes the whole chip on one backspace.
- **Cursor cannot sit inside one**: `snapOutOfPlaceholder` on word motions, plus a `useEffect` (L495400) that
  snaps the offset to the nearer edge if it lands in the middle.
- **Paste-again-to-expand**: after a chip is created, if the content is ≤ `lgr = 1e5` chars (L317645) an
  8-second window opens (L495760) during which pasting the *same* text again replaces the chip with the real
  text inline (`bDo`, L317418). The hint line reads **`"paste again to expand"`** (L493779).
- **`"Pasting…"`** is shown while a paste is being assembled (L493776).
- On submit, `fSe` (L317403) substitutes text chips back into the outgoing prompt.
- Pastes are persisted under a `"paste-cache"` dir keyed by content hash (L317330) so they survive across
  sessions and can be resolved when recalled from history.

---

## 3. Autocomplete

### 3.1 The `Autocomplete` context, verbatim (L186118)

```js
{ context: "Autocomplete", bindings: {
  tab: "autocomplete:accept",
  escape: "autocomplete:dismiss",
  up: "autocomplete:previous",
  down: "autocomplete:next"
} }
```
That is the whole context — four keys. Everything else is handled inside `F9f`'s own `handleKeyDown`
(L491083–L491119):
- `ctrl+n` / `ctrl+p` also move the selection (guarded against a pending chord).
- `return` (no shift, no meta) → **`ze()` = accept-and-execute**, i.e. Enter accepts *and* runs the command,
  where Tab (`Pe()` = `nt`) accepts *without* executing. This is the key Tab/Enter difference.
- `tab` with a suggestion list already open falls through to `autocomplete:accept`; with **no** list and an
  empty input it emits the hint `` `Use ${alt+t} to toggle thinking` `` (3 s).
- `right` on an empty input accepts the model's prompt suggestion.
- Selection wraps (`>= length-1 → 0`, `<= 0 → length-1`, L491102).

### 3.2 Trigger rules

Slash (`Pli`, L489935):
```js
/[\s\u3002\u3001\uFF1F\uFF01]\/([a-zA-Z0-9._:-]*)$/     // note the LEADING whitespace/CJK-punct requirement
```
The token must be preceded by whitespace or CJK punctuation — plus a separate `e.startsWith("/")` head case,
and a denylist `tRb` of names that never suggest. The cursor must be at the end of the partial name
(`if (t > o + 1 + a.length) return null`). Command names are `[a-zA-Z0-9._:-]`.

`@` file mention — two regexes, both requiring a word boundary:
- `ARb = /(^|[\s\u3002\u3001\uFF1F\uFF01])@([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|"[^"]*"?)$/u` (L491153) — full
  path chars, **quoted paths supported** (`@"my file.ts"`).
- `Bli = /(^|[\s\u3002\u3001\uFF1F\uFF01])@([\w-]*)$/` (L491155) — the narrower one used for `@teammate` DMs.

Also live in the same engine: `#channel` Slack (`tQa = /(^|\s)#([a-z0-9][a-z0-9_-]*)$/`), emoji
(`rQa = /(^|\s):([a-z0-9_+-]{2,})$/` for suggestions, `vRb = /(^|\s):([a-z0-9_+-]+):$/` for inline
substitution), MCP resources/templates, bash path completion, `/resume <title>` completion, and per-command
`getArgumentCompletions`.

Debounces: file/`@` walk 50 ms, Slack 150 ms, MCP slash-templates 150 ms (L490600–L490620).

### 3.3 Popup layout (`DXe`, L432430)

```js
let d = o ? s0H : Math.max(1, Math.min(Math.max(6, Math.floor(rows/2)), rows - 3));
```
- Rows: overlay mode is fixed at **`s0H = 5`**; inline mode is `clamp(max(6, rows/2), 1, rows-3)` — so on a
  50-row terminal, 25 rows; on a 24-row terminal, 12.
- Column width: `p = maxColumnWidth ?? max(displayText widths) + 5`. For the slash catalog,
  `maxColumnWidth = max(command name lengths) + 6` (L490510).
- Each row is **1 or 2 terminal lines** (`a0H`, L432457): 2 if the description doesn't fit in
  `columns − nameCol − tagWidth − kindLane − sourceTag − 4`, where the name column is capped at
  `min(maxColumnWidth, floor(columns * 0.4))`.
- Scroll window keeps the selection near the middle (walk up to `floor(d/2)` rows above, then fill below,
  then backfill above) — L432436–L432444.
- The list is bottom-aligned (`justifyContent:"flex-end"`) and **padded with blank rows** to a fixed height so
  the composer does not jump as the list shrinks.
- Selected row → `color: "suggestion"`; unselected → `dimColor: true` (L432499, L432540).
- Rows are **mouse-interactive**: `onMouseEnter → setHoveredSuggestion`, `onClick → select(index)`, and a
  hovered id overrides the keyboard selection for rendering (L432451).
- File / MCP-resource rows render as `` `${icon} ${displayText} – ${description}` `` with an en-dash (L432520).
- Empty-state message: `` `No commands match "${input}"` `` (L490779), or `"Loading…"` / `"No matching prompts"` /
  `"No history yet"` in the history picker.

### 3.4 Inline ghost text (`inlineGhostText`)

Separate from the popup: `V`/`K` (L490543–L490556) compute a **dim inline completion suffix** for the current
partial slash command (or bash command), rendered by `sd.render`'s `n` parameter (L394780) as the remaining
characters after the cursor, dimmed. `Tab` with only ghost text and no list still accepts it.

Also separate: **`argumentHint`** (L496229 → L396283) — for a completed `/command ` the hint renders after the
input, `dimColor`, `wrap:"truncate-end"`, preceded by a space if the value doesn't end in one.

---

## 4. Attachments

There are two distinct things sharing the word.

### 4.1 In the composer: inline chips, not a strip

An image paste (`gK`, L495686) allocates an id, stores
`{id, type:"image", content, mediaType, filename, dimensions, sourcePath}` in `pastedContents`, and inserts the
text chip `` `[Image #${id}]` `` into the buffer. There is **no separate attachment tray in the composer** —
the chip *is* the representation, living in the text.

Chip highlighting (L495393):
```js
for (let Cn of Ad) if (xe === Cn.start)
  Wt.push({ start: Cn.start, end: Cn.end, color: void 0, inverse: !0, priority: 8 });
```
When the cursor is at an image/audio chip's start, the **whole chip renders inverse** and the normal cursor is
suppressed (`dE = Ad.some(w => w.start === xe)` → `showCursor: !Ss && !we && !dE`, L496229). Chips are garbage
collected from `pastedContents` when their text is deleted from the buffer (L495694).

### 4.2 Ingest paths

Clipboard image (`chat:imagePaste`, ctrl+v / alt+v on Windows-WSL) → `Zce` (L495920): reads the system
clipboard as an image; on failure falls back to pasting clipboard *text*; if neither, notifies
`"No image found in clipboard. Use ctrl+v to paste images."` or, over SSH,
`"No image found in clipboard. You're SSH'd; try scp?"`.

Drag-and-drop (`zhn` → `E`, L396020):
```js
let k = w.split(/ (?=\/|[A-Za-z]:\\)/).flatMap(P => P.split("\n")).filter(P => P.trim());
```
The pasted string is split on space-before-an-absolute-path (or `C:\`) and on newlines; each token that reads
as an image file is loaded and becomes an `[Image #N]` chip with `sourcePath` + `filename` set (telemetry
`input_image_drag`); non-image tokens are re-joined and pasted as ordinary text. macOS screenshot temp paths
are detected specially. On macOS/WSL, an *empty* paste payload is treated as "the terminal swallowed an image"
and triggers a clipboard read.

Spacing: after inserting a chip, `sD` (L495767) prepends a space to the **next** typed character unless it is
one of `.,?!:;)]` — so `[Image #1]` followed by typing reads naturally.

### 4.3 The `Attachments` keybinding context is a *dialog* context

L186118:
```js
{ context: "Attachments", bindings: { right: "attachments:next", left: "attachments:previous",
  backspace: "attachments:remove", delete: "attachments:remove",
  down: "attachments:exit", escape: "attachments:exit" } }
```
Its own description (L186159): **"When navigating image attachments in a select dialog"**. The implementation
is at L396480–L396580, inside the select/question-dialog option renderer, and the chip component is `N4o`
(L393880):
```js
let Ebr = `[Image #${bq_}]`;
… <Text backgroundColor={bg} inverse={isSelected} bold={isSelected}>{Ebr}</Text>
```
wrapped in an OSC-8 hyperlink (`Ro`) to `pathToFileURL(storedImagePath)` when the terminal supports links.
Also bound in that dialog: `chat:externalEditor` and `chat:imagePaste` are re-registered in the `Chat` context
(L396503, L396518), and a bare `attachments:remove` from the composer with empty text removes the **last**
attachment (L396521: `V_p = focused && !attachmentsFocused && text === "" && attachments.length > 0`).

---

## 5. Queueing and interruption

### 5.1 Typing during a turn

The composer is never disabled. `chat:submit` while a turn runs pushes onto a global command queue
(`Fy`, L149090) as an entry with `{value, mode, priority: "now"|"next"|"later", pastedContents, origin}`.
`P5` (L148879) is the "editable, human-origin, non-meta" predicate that decides which queued entries the UI
lets you pull back.

### 5.2 Displaying the queue

Queued entries are surfaced as **`queued_command` attachments in the transcript stream** (L148836, L238731),
not as a dedicated composer widget. The composer's only queue affordance is the placeholder
**`"Press up to edit queued messages"`**, shown for the first 3 sessions (`queuedCommandUpHintCount < LNb`,
`LNb = 3`, L495114/L495120). *(Where exactly the queued rows draw in the transcript: **not determined** — I
did not locate the renderer.)*

### 5.3 Editing / cancelling the queue

Two modes, gated by `sV()` (L…, `CLAUDE_CODE_KB_COHESION_FIXES` env flag; **default off**):

- **Default (flag off)** — `Uge()` (L495505): Up on an empty composer with a non-empty queue calls
  `GU()` → `popAllEditable` (L149094), which **drains every editable queued command back into the composer at
  once**, joined by `\n`, restoring their images, cursor placed after the recalled text. `Escape` does the same
  (L495636). Non-editable entries stay queued.
- **Flag on** — a per-item cursor: `queueEditIndex` walks the queue with Up/Down, `popEditableAt(i)`
  (L149121) pulls **one** entry into the composer, Escape clears the index. Any composer edit resets the index
  to null (L495252).

### 5.4 Escape, stage by stage

Order of consumption inside `KI` (L495620–L495640):
1. `qm()` — if a queue-edit index is open, clear it; else if an agent-view has a cancel, cancel it; else if the
   help overlay is open, close it. Consumed.
2. Vim: if editorMode is vim and mode ≠ NORMAL, Escape belongs to vim (exit to NORMAL). Consumed.
3. If any suggestion popup is open → `autocomplete:dismiss` (and `disableEscapeDoublePress` is on, so the
   editor's Esc-Esc-clear is suppressed while a popup is up).
4. If the queue has editable entries → pop them back into the composer.
5. `chat:cancel` — interrupt the running turn.
6. `if (p && !te && !a) EN()` — messages exist, composer empty, **not** running → a `Pee` double-press whose
   second fire calls `w()`, i.e. **Esc-Esc on an idle empty composer opens the message selector / rewind**
   (the `MessageSelector` context is documented at L186159 as "the message selector (rewind)").
7. Otherwise the editor's own Escape: first press notifies `"Esc again to clear"`, second **saves the text to
   prompt history** and clears the buffer.

Ctrl-C is separate (`app:interrupt`, `Global`) and also double-press: the hint line reads
`` `Press ${key} again to ${action}` `` where action is `"/clear"`, `"exit"`, or
`"detach (session keeps running)"` when remote/catch-up (L493757). Ctrl-L / cmd+K use the same double-press
helper with a **2000 ms** window (L495853) instead of the default 800 ms (`fpy = 800`, L186... `Pee` L…).

---

## 6. History

### 6.1 Storage

`~/.claude/history.jsonl` (L317450), append-only with a file lock, entries
`{display, timestamp, sessionId, project, pastedContents}`. Writes are skipped entirely when
`CLAUDE_CODE_SKIP_PROMPT_HISTORY` is set (`cgr`, L317540). Cap `gDo = 100` entries scanned. Text pastes inside
a recalled prompt are re-resolved from the paste cache; unresolvable ones are rewritten to
`[Pasted text #N — content no longer available]` (`au_`, L317525).

### 6.2 Dedup

`UUd` (L317460): iterate newest-first, skip entries whose `display` was already yielded —
**exact-text dedup across the whole scan, newest wins**, applied per scope. Scope filter is
`o.project !== currentProject` for `"project"` and `o.sessionId !== currentSession` for `"session"`.

### 6.3 Up/Down navigation (`Z6f`, L489521)

- Up from line 0 (or always, when `disableCursorMovementForUpDownKeys` — set when a suggestion popup is open
  or a footer item is selected, L496229) → previous entry; Down at the last line → next.
- The **live draft is stashed** at index 0 and restored on the way back down (`p`/`f`, L489590).
- **Per-index edit cache** (`w.current`, a `Map`): if you edit a recalled prompt and keep arrowing, your edit
  is remembered at that index (L489594) — not just the draft.
- The buffer's **mode is preserved**: entering history from bash mode filters history to bash entries only
  (`T.current = mode === "bash" ? mode : undefined`, L489551).
- Loading is incremental — it pages the file as you go (`VLb(V+1, ce)`, L489620) rather than reading it all.
- After the 2nd Up, a one-time contextual hint appears advertising `ctrl+r` / `history:search` (L489545).
- The border label reads `History n/total` (§1.2) and disappears once you edit the recalled entry
  (`historyEdited`).
- Multi-line prompts are restored verbatim (`display` is stored with newlines; `M()` sets the offset to
  `text.length` for Up and `0` for Down, L489530).

### 6.4 `HistorySearch` context, verbatim (L186118)

```js
{ context: "HistorySearch", bindings: {
  "ctrl+r": "historySearch:next",
  escape:   "historySearch:accept",      // Esc ACCEPTS
  tab:      "historySearch:accept",
  "ctrl+c": "historySearch:cancel",
  enter:    "historySearch:execute",
  "ctrl+s": "historySearch:cycleScope"
} }
```

Two implementations, selected by `yie()` = `MN() && ds()` (fullscreen layout):

- **Inline reverse-i-search** (`r9f` L489642, prompt `xWf` L493443) — the classic. Prompt literal is
  `"search prompts:"`, or **`"no matching prompt:"`** on a failed match, dim; then a single-line input sized
  to the query; then, in vim mode with an empty query, `"esc i / for slash commands"`. Matching is
  `lastIndexOf(query.toLowerCase())` walking backwards through history, deduped by display text, and it
  **rewrites the composer buffer in place** to each match, setting the cursor to the match offset.
- **Full-screen picker** (`qGf`, L492153) — title
  `` <>Search prompts <Text color="suggestion">· {scope}</Text></> ``, placeholder `"Filter history…"`,
  scopes cycled by ctrl+s over `SDo` (initial `"everywhere"`). Ranking (L492196) is two-class:
  **substring matches first, then subsequence matches** (`oDb`, L492213), order preserved within each class.
  Rows render as `<dim age>` (padded to `WGf = 8`) + first line of the prompt, truncated. Layout is
  side-by-side preview at ≥100 columns, stacked below otherwise; preview is a `borderStyle:"round"`
  `borderDimColor` box of `aci = 6` lines with a "+N more" tail. Empty messages: `"Loading…"` /
  `"No matching prompts"` / `"No history yet"`. Extra hint chips: scope chord, and in vim mode
  `"Esc i / for slash commands"`.

---

## 7. Vim mode — scoping the deferred work

Enabled by `editorMode: "vim"` in settings (`hU()`, L493476: `Dc("editorMode","normal").value === "vim"`;
schema at L42039, options `["normal","vim"]`, `"emacs"` is legacy-mapped to normal). Settings row id `editor`,
label `"Editor mode"` (L315582).

### 7.1 Modes

Four: **`"INSERT"`, `"NORMAL"`, `"VISUAL"`, `"VISUAL LINE"`** (L189044, L434225–L434228).

### 7.2 Indicator

L493789:
```js
Wel = gRn ? <Text dimColor key="vim-indicator">{"-- "}{vimMode}{" --"}</Text> : null;
```
so `-- INSERT --`, `-- VISUAL --`, `-- VISUAL LINE --`, dim, in the hint row under the composer, in a
`gap: 1` row alongside the reverse-search prompt and the mode/hint chips. Shown when
`hU() && !hideVimModeIndicator && vimMode !== "NORMAL" && !isSearching` (L493781) — **NORMAL shows nothing.**
`statusLine.hideVimModeIndicator` (L42035) suppresses it for status-line scripts that render `vim.mode`
themselves.

### 7.3 Key surface (`dHa` dispatcher, L433927; tables L433923–L434185)

Command-state machine: `idle → count → operator → operatorCount → operatorFind → operatorTextObj → find →
g → operatorG → replace → indent`.

- **Motions** (`oKo`, L433924): `h l <space> j k w b e W B E 0 ^ $`, plus `gj gk gg G`, `f F t T` with `;` `,`
  repeat/reverse.
- **Operators** (`nKo`, L433923): `d`→delete, `c`→change, `y`→yank. Doubled (`dd`,`cc`,`yy`) = linewise.
  Counts on both sides (`2d3w`).
- **Text objects** (`sKo` `cHa`, L433924/L433925): `i`/`a` × `w W " ' \` ( ) b [ ] { } B < >`.
- **Normal-mode singles** (`sIH`, L434155): `g r > < ~ x s S J p P D C Y G . ; , u i I a A o O`,
  plus `v`/`V` to enter visual, `0` to line start, digits for counts.
- **Visual-mode table** (`_IH`, L434172): `x s X D C S R Y r ~ u U p P > < v V o J $ g G ; ,`.
- Undo `u` → the shared undo ring; **dot-repeat `.`** → replays `lastChange`, including the inserted text of
  an `i`/`a`/`c` sequence (`A.current.lastChange`, L434200–L434260).
- A named register with linewise flag, plus `lastFind`.
- Arrow keys, backspace, delete are mapped onto `h l k j`/`x` in NORMAL and VISUAL (L434500, L434543).
- Ctrl/meta chords **fall through to the emacs key table** in NORMAL/INSERT (L434388).
- `?` in NORMAL with idle command → help overlay; `/` in NORMAL → history search (L434516, L434521).
- `j`/`k` in NORMAL at the buffer's first/last logical line → history prev/next (L434526).
- **INSERT-mode remaps**: `vimInsertModeRemaps` config (L42039) — *"Each key is exactly two printable
  characters typed in sequence; `<Esc>` (return to NORMAL mode) is the only supported target"*, e.g.
  `{"jj": "<Esc>"}`. Implemented with a timing window `VYp` and an offset check (L434420).

### 7.4 Size estimate

`hHa` + `rXp` + the command tables + the operator/motion implementation functions
(`Z4t, e5t, t5t, zzo, Kzo, Yzo, Xzo, Qzo, Jzo, tAn, rAn, qzo, Vzo, DYp, FYp, BYp, jYp, kYp, LYp, aKo, …`)
occupy roughly **L433900–L434610 ≈ 700 beautified lines**, on top of the shared `sd` buffer already needed for
the emacs layer. **[inference]** A faithful port is an L-sized piece of work; a NORMAL/INSERT subset with
`hjkl w b e 0 $ x dd cc yy p i a A I o O u` and no visual mode, no text objects, no dot-repeat is an M.

---

## 8. Things worth knowing that weren't asked

1. **Keybindings are user-customisable and hot-reloaded.** `~/.claude/keybindings.json`
   (`{ "bindings": [ { "context": …, "bindings": { "ctrl+k": "chat:newline" | "command:compact" | null } } ] }`),
   watched with chokidar (500 ms stability, polling, atomic), validated with duplicate/reserved/parse
   diagnostics (L186220–L186470). `"command:<name>"` bindings execute a slash command as if typed and are only
   legal in the `Chat` context. `null` unbinds. Every UI hint string is generated from the *live* binding
   (`pc(action, context, fallback)`), so a rebinding changes every displayed chord.
2. **Live syntax highlighting inside the composer.** `LA` (L495390) builds a priority-ordered highlight span
   list over the input: ultrathink keywords shimmer (per-character animated colour), ultraplan keywords
   shimmer, workflow keywords in `autoAccept` + shimmer, file mentions in `suggestion`, MCP resources, Slack
   channels, `@teammate` mentions in the teammate's own theme colour, image chips inverse, history-search
   match dim. Priorities 1/5/8/10/15/20.
3. **Keyword side effects the composer announces.** Typing an "ultrathink" keyword raises
   `"Deeper reasoning requested for this turn"`; ultraplan raises `"This prompt will launch an ultraplan
   session in Claude Code on the web"`; `/code-review ultra` raises a contextual note; a workflow keyword
   raises `` `Dynamic workflow requested for this turn · ${alt+w} to ignore` `` and backspace at the keyword's
   end dismisses it (L495430–L495470).
4. **The stash hint is behavioural.** If the buffer shrinks from ≥20 chars to ≤5 and the user has never used
   stash, the composer suggests `Tip: ctrl+s stash` (L495468).
5. **Mouse support.** Click in the composer moves the cursor to the clicked offset (`sQ`, L496185); text
   selection over the composer region deletes the selected span (`Gge`, L496195); suggestion rows respond to
   hover and click.
6. **Mode indicator strings** (`gGl`, L41536): `default → "manual mode"` (symbol `\u23F8`, colour `inactive`),
   `plan → "plan mode"` (`\u23F8`, `planMode`), `acceptEdits → "accept edits"` (`\u23F5\u23F5` = `⏵⏵`,
   `autoAccept`), `auto → "auto mode"` (`⏵⏵`, `warning`), `bypassPermissions → "bypass permissions"` (`⏵⏵`,
   `error`), `dontAsk → "don't ask"` (`⏵⏵`, `error`). Rendered as `` `${symbol} ${indicator} on` ``.
   A mode switch is announced to screen readers as `` `[${indicator} on]` `` (L495880).
7. **Hint-row states** (`ctl`, L493811–L494010), exactly one at a time:
   `warmup | interrupt | interrupt_agents | ctrl_t | agents | memories | manage | voice | cycle | shortcuts |
   none`. Idle default is `"? for shortcuts"`; running is the `esc` interrupt chord; first-run is
   `(shift+tab to cycle)`.
8. **Help-overlay content** (`Y6t`, L459472) — the `?` overlay's own columns:
   `"! for shell mode"`, `"/ for commands"`, `"@ for file paths"`, `"/btw for side question"`,
   `"double tap esc to clear input"`, `` `${ctrl+o} for verbose output` ``, `shift+tab auto-accept edits`,
   `ctrl+t toggle tasks`.
9. **Screen-reader mode changes the composer materially**: no border, `$ ` prompt, `preserveTrailingWhitespace`
   on, placeholder hidden while dictating, cursor char empty.
10. **`space` is bound to `voice:pushToTalk` in the `Chat` context** — with a validator that warns if a user
    rebinds it to a bare letter because "it prints into the input during warmup" (L186200).

---

## 9. Gap table

Effort: S ≈ under a day · M ≈ 1–3 days · L ≈ a week+. "Needs a probe" means the blocker is whether the Claude
Agent SDK exposes the capability, not whether we can write the UI.

| # | Upstream (2.1.220) | Ours today | Class | Effort | Probe? |
|---|---|---|---|---|---|
| **Visual form** |
| V1 | Border is `round` with **left/right/bottom off** — two horizontal rules, colour token `promptBorder` (L496235) | Full rounded box, `borderStyle="round"` all four sides (`ChatComposer.tsx:144`) | divergent | S | no |
| V2 | Prompt glyph `❯\xA0` (`Ge.pointer`, L494723), dimmed while a turn runs; `!\xA0` in bash mode; `$\xA0` for screen readers | `"› "` (U+203A), never dimmed, no bash/SR variant (`ChatComposer.tsx:145`) | divergent | S | no |
| V3 | Placeholder is a random `Try "<example>"` seeded from git-modified files, with 4 precedence rules incl. `"Press up to edit queued messages"` (L495095/L495107) | Fixed `"Ask Claude anything…"` (`ChatComposer.tsx:147`) | divergent | M | no |
| V4 | `borderText` history label `History n/total` painted on the top rule (L494870/L496163) | none | missing | S | no |
| V5 | Placeholder's first char renders inverted as the cursor (L395967) | Separate `<Text inverse>{" "}</Text>` then dim text — close but not the same shape (`ChatComposer.tsx:147`) | partial | S | no |
| V6 | Cursor suppressed when terminal loses focus (L396300) | Always drawn (`ChatComposer.tsx:23`) | missing | S | needs a probe (Ink focus events) |
| V7 | `maxVisibleLines` viewport with centred scroll in fullscreen (L394706) | Renders every line, unbounded (`ChatComposer.tsx:18`) | missing | M | no |
| V8 | External editor in flight → `"Save and close editor to continue..."` italic in the bordered row (L496237) | `spawnSync` blocks Ink; nothing is drawn (`externalEditor.ts:27`) | missing | S | no |
| V9 | `"Waiting for permission…"` line inside the composer while a park is open (L496241) | Composer is **unmounted** while `state.pending` (`ChatApp.tsx:186` — last ternary arm) | divergent | M | no |
| **Editing model** |
| E1 | Kill ring with `ctrl+y` yank and `alt+y` yank-pop, append/prepend direction, run-interrupt (L395640–L395680) | `killToEnd`/`killToStart`/`killWordBack` discard the text (`editor.ts:74–84`) | missing | M | no |
| E2 | `ctrl+u` ≥3 chars → `"Ctrl+Y to paste deleted text"` hint (L395652) | none | missing | S | no |
| E3 | `alt+d` delete-word-after (L395676) | not bound (`editor.ts:227`) | missing | S | no |
| E4 | `ctrl+b` / `ctrl+f` = left/right; `ctrl+n` / `ctrl+p` = down/up-with-history (L395676) | not bound | missing | S | no |
| E5 | `ctrl+h` = `deleteTokenBefore ?? backspace` (L395676) | not bound | missing | S | no |
| E6 | `home`/`end`/`pageup`/`pagedown` → line start/end (L395798) | not bound | missing | S | needs a probe (Ink does not surface these as key flags — the W2 pager note already records this) |
| E7 | `super+left/right` = line start/end; `super+backspace` = kill-to-line-start; `meta/super+delete` = kill-to-line-end (L395760–L395795) | not bound | missing | S | needs a probe (Ink `key.meta` only) |
| E8 | `ctrl+a`/`ctrl+e` operate on the **logical** line (L395676) | operate on the **visual/array** line (`editor.ts:72`) — same thing for us since we do not wrap, but diverges once wrapping lands | divergent | S | no |
| E9 | Escape double-press clears **and pushes the cleared text to prompt history** (`cgr`, L395636) | Esc with no popup → `onInterrupt` → arm rewind; no clear-input at all (`ChatComposer.tsx:118`, `ChatApp.tsx:67`) | divergent | M | no |
| E10 | `"Esc again to clear"` notification, 1000 ms (L395638) | `"Press Esc again to rewind"` (`ChatApp.tsx:187`) | divergent | S | no |
| E11 | Undo ring stores `{text, cursorOffset, pastedContents}`, cap 50, 1000 ms debounce (L489736) | Stores `{lines, cursor}`, cap 100, no debounce (`editor.ts:14`, `editor.ts:276`) | partial | S | no |
| E12 | `\`-continuation eats the backslash **and** flags `hasUsedBackslashReturn` for hint suppression (L395700) | Eats the backslash, no flag (`editor.ts:104`) | partial | S | no |
| E13 | Shift+Enter / Alt+Enter insert a newline (L395705) | not handled; only `ctrl+j` and `\`+Enter (`editor.ts:239/247`) | missing | S | needs a probe (Ink `key.shift` on return is terminal-dependent) |
| E14 | Terminal-specific newline hint strings (`Z_a`, L493448) | Fixed `\⏎ newline` in the footer (`ChatComposer.tsx:152`) | divergent | S | no |
| **Paste** |
| P1 | Paste >800 chars **or** >2 newlines → `[Pasted text #N +M lines]` chip; content stored out of band, substituted at submit (L495700, L317381) | Paste is inserted verbatim and split into lines (`editor.ts:45`) | **missing** | M | no |
| P2 | Atomic chip delete via `deleteTokenBefore` regex (L395149) | n/a — no chips | missing | S | no |
| P3 | Cursor cannot rest inside a chip (snap-out + effect) (L395149, L495400) | n/a | missing | S | no |
| P4 | `"paste again to expand"` within 8 s, ≤100 k chars (L495760, L493779) | n/a | missing | M | no |
| P5 | `"Pasting…"` indicator (L493776) | none | missing | S | no |
| P6 | Paste cache persisted to disk by content hash, survives session restore (L317330) | n/a | missing | M | no |
| P7 | ANSI stripped, CRLF normalised, tabs → 4 spaces on paste (L495700) | Only bracketed-paste markers stripped (`editor.ts:39`) | partial | S | no |
| **Autocomplete** |
| A1 | `Tab` accepts **without** executing; `Enter` accepts **and executes** (L491083/L491112) | `Tab` completes the name; `Enter` submits `/name` immediately for commands but only *accepts* for mentions (`editor.ts:248–252`) | divergent | S | no |
| A2 | `ctrl+n`/`ctrl+p` move the selection (L491100) | not bound | missing | S | no |
| A3 | Selection **wraps** at both ends (L491102) | Clamped, does not wrap (`editor.ts:153/182`) | divergent | S | no |
| A4 | Popup height `clamp(max(6, rows/2), 1, rows-3)`, blank-padded to fixed height, bottom-aligned (L432431) | Fixed 8 rows, no padding (`ChatComposer.tsx:27`) | divergent | S | no |
| A5 | Two-line rows when the description doesn't fit; name column capped at 40% of width (L432457) | One line, description hard-sliced at 48 chars (`ChatComposer.tsx:40`) | divergent | S | no |
| A6 | Selected row = `color:"suggestion"`, others `dimColor` (L432499) | Selected row = `inverse` (`ChatComposer.tsx:38/58`) | divergent | S | no |
| A7 | Mouse hover + click on rows (L432451) | none | missing | M | needs a probe (Ink mouse events) |
| A8 | Slash trigger requires **preceding whitespace or CJK punctuation**, and cursor at token end (`Pli`, L489935) | Only fires when `/` is the very first char of an empty buffer (`editor.ts:201`) | partial | S | no |
| A9 | `@` accepts full path chars incl. `. / \ ( ) [ ] ~ :` and **quoted paths** `@"a b.ts"` (`ARb`, L491153) | `@` closes on any whitespace, no quoting (`editor.ts:148`) | partial | S | no |
| A10 | Inline **ghost text** for a partial command, dim, `Tab` accepts (L490543, L394780) | none | missing | M | no |
| A11 | `argumentHint` rendered inline after a completed `/command ` (L396283) | Shown as a popup column only (`ChatComposer.tsx:39`) | partial | S | no |
| A12 | Empty state `No commands match "…"` (L490779) | `/{query} — no matches` (`ChatComposer.tsx:31`) | divergent | S | no |
| A13 | Debounced async completions (50/150 ms), stale-response guards (L490600) | Synchronous full-tree walk at popup open, cap 1000 files (`fileComplete.ts:15`) | divergent | M | no |
| A14 | Directory completion is **iterative** — accepting a dir re-opens the popup one level deeper (L490900) | Accepts the whole relative path and closes (`editor.ts:155`) | missing | M | no |
| A15 | Emoji (`:smile:`), Slack `#channel`, `@teammate` DM, MCP resources/templates, bash-path, `/resume <title>` completions | none | missing | L | needs a probe (per-source; MCP resource listing is SDK-reachable, the rest are not) |
| **Attachments** |
| T1 | `[Image #N]` chip in the buffer, inverse when the cursor is on it, cursor suppressed (L495393, L496229) | none | missing | M | needs a probe (does the SDK accept image content blocks on a user turn?) |
| T2 | Clipboard image paste on `ctrl+v` with text fallback + SSH-aware failure notice (L495920) | 🚫 in our scorecard ("non-terminal / out of scope") | missing | M | needs a probe |
| T3 | Drag-and-drop: split on absolute-path boundaries, image tokens become chips, the rest pastes as text (L396020) | none | missing | M | no |
| T4 | `Attachments` keybinding context inside select dialogs (←/→ navigate, backspace remove, esc exit) (L186118) | none — our `QuestionDialog` has no attachments | not applicable (until T1 exists) | — | no |
| T5 | Chip is an OSC-8 hyperlink to the stored image file (L393885) | none | missing | S | no |
| T6 | Smart spacing after a chip (space unless next char is `.,?!:;)]`) (L495767) | Trailing space after an accepted `@path` — different rule (`editor.ts:158`) | divergent | S | no |
| **Queue** |
| Q1 | Placeholder `"Press up to edit queued messages"`, first 3 sessions (L495114) | Dim `⋯ queued: <text>` rows above the composer (`ChatApp.tsx:121`) | divergent | S | no |
| Q2 | `Up` on an empty composer pops **all** editable queued commands back into the buffer, images restored (L149094, L495505) | `Up` goes to prompt history; no queue interaction (`editor.ts:205`) | missing | M | no |
| Q3 | `Escape` pops the queue back into the composer before it interrupts (L495636) | `Escape` clears the queue outright and interrupts (`useChat.ts:891`) — the text is destroyed | **divergent (data-losing)** | S | no |
| Q4 | Per-item queue-edit cursor behind `CLAUDE_CODE_KB_COHESION_FIXES` (L149121) | none | missing | M | no |
| Q5 | Queue entries carry `priority: now/next/later` and a `pastedContents` map (L149090) | Plain `string[]` (`useChat.ts:117`) | partial | M | no |
| **History** |
| H1 | Persisted `~/.claude/history.jsonl`, cross-session, with `CLAUDE_CODE_SKIP_PROMPT_HISTORY` opt-out (L317450, L317540) | Up/Down history is **in-memory, per composer mount** (`editor.ts:12`); the Ctrl-R overlay reads persisted transcripts instead (`historySearch.ts:15`) | divergent | M | no |
| H2 | Dedup = exact-text, newest-wins, across the whole scan (L317469) | Up/Down dedups only **consecutive** duplicates (`editor.ts:113`); the Ctrl-R overlay does full dedup (`historySearch.ts:28`) | partial | S | no |
| H3 | Per-index edit cache — edits to a recalled prompt survive further arrowing (L489594) | Edits are lost on the next Up/Down (`editor.ts:125`) | missing | S | no |
| H4 | History filtered by input mode (bash history separate) (L489551) | not filtered | missing | S | no |
| H5 | `History n/total` border label, hidden once edited (L494870) | none | missing | S | no |
| H6 | Contextual `ctrl+r` hint after the 2nd Up (L489545) | none | missing | S | no |
| H7 | Recalled prompts restore their `pastedContents` (L317540) | n/a — no chips | missing | M | no |
| H8 | Inline reverse-i-search with `"search prompts:"` / `"no matching prompt:"` prompt, rewriting the buffer in place (L493443) | Full-screen-style bordered overlay only (`HistorySearchOverlay.tsx:47`) | divergent | M | no |
| H9 | Picker: substring-then-subsequence ranking, scope cycling, age column, preview pane, side-by-side ≥100 cols (L492196) | Ranking + scope cycling + age column present (`historySearch.ts:42`, `HistorySearchOverlay.tsx:35`); **no preview pane, no responsive layout** | partial | M | no |
| H10 | `Esc`/`Tab` accept, `Enter` execute, `ctrl+r` next, `ctrl+c` cancel, `ctrl+s` scope | all six match (`HistorySearchOverlay.tsx:33–43`) | ✅ match | — | no |
| **Vim** |
| M1 | 4 modes, full motion/operator/text-object/dot-repeat/register surface (§7) | none — deliberate deferral (`tui-ux.md` §1 row) | missing | L | no |
| M2 | `-- INSERT --` dim indicator, hidden in NORMAL, suppressible via `statusLine.hideVimModeIndicator` (L493789) | none | missing | S | no |
| M3 | `vimInsertModeRemaps` (`{"jj":"<Esc>"}`, two printable chars, `<Esc>` only target) (L42039) | none | missing | S | no |
| M4 | `editorMode` setting row `"Editor mode"` with `normal|vim` (L315582) | none (our SettingsDialog ships 5 Config rows, this is not one) | missing | S | no |
| **Cross-cutting** |
| X1 | Every hint string is generated from the **live** keybinding via `pc(action, context, fallback)`; `~/.claude/keybindings.json` is hot-reloaded and validated (L186220) | Hard-coded chord strings throughout; `/keybindings` is read-only (`tui-ux.md` W3 divergence) | missing | L | no |
| X2 | Live highlight spans in the buffer (mentions, keywords, shimmer, chips) with a priority system (L495390) | Plain text (`ChatComposer.tsx:18`) | missing | M | no |
| X3 | Click-to-move-cursor and selection-delete in the composer (L496185, L496195) | none | missing | M | needs a probe (Ink mouse) |
| X4 | Mode indicator strings `⏵⏵ accept edits on` / `⏸ plan mode` with theme colours (L41536) | `mode <name>` in the status bar with our own colour map (`ChatStatusBar.tsx:14`) | divergent | S | no |
| X5 | Hint row is a single-slot state machine (`? for shortcuts` idle → interrupt chord while running) (L493811) | Static footer `⏎ send · \⏎ newline · @ files · / commands · ! bash · ⇧Tab mode` (`ChatComposer.tsx:152`) plus a separate status bar | divergent | S | no |
| X6 | Screen-reader variant: no border, `$ ` prompt, whitespace preserved (L494723, L396302) | none | missing | M | no |
| X7 | `#` is **not** a composer mode upstream — `mP()` only knows `!` (L236131) | `#` = memory mode, blue border (`editor.ts:35`) | divergent (**ours is an addition, not a gap**) | — | no |
| X8 | `space` bound to `voice:pushToTalk` in `Chat` (L186118) | n/a | not applicable | — | no |

**Counts:** 62 rows — **missing 34 · partial 10 · divergent 16 · not applicable 2** (one row, H10, is a clean
match and is listed for completeness). Needs-a-probe flags: 10.

---

## 10. Confidence and gaps

**High confidence** (read the code directly, quoted literals): the `Chat`/`Autocomplete`/`HistorySearch`/
`Attachments` keybinding tables; the full `r5o` key table; the paste chip literals, thresholds and lifecycle;
the placeholder generator and its precedence; the border/glyph/borderText render; the suggestion popup
geometry; the vim mode set, indicator string and command tables; the history file format, dedup rule and both
search UIs; the queue pop semantics.

**Medium confidence / inference, flagged inline:**
- Where queued messages are *drawn* in the transcript — I found the `queued_command` attachment plumbing
  (L148836, L238731, L310334) but not the renderer. Marked **not determined** in §5.2.
- Whether upstream's permission dialog visually replaces or sits above the composer. The composer's own render
  contains `"Waiting for permission…"` (L496241), which strongly implies it stays mounted, but I did not read
  the parent layout. Gap V9 is classified on that inference.
- The vim effort estimate (§7.4) is a line-count-derived judgement, not a measurement.
- `aZ()`, `ER()`, `Ov`, `fV` in the border-colour selector (V1) are unresolved; I read them as "a teammate/
  agent colour override" from usage, not from their definitions.

**Deliberately not covered** (outside the composer domain, though they touch it): the transcript renderer, the
spinner, the status line, the `?` help overlay's full layout, the model/thinking/fast-mode pickers the composer
early-returns into, voice input, and the `Footer` context's task/workflow/memory navigation — the composer
hosts the `Footer` keybindings (L496045) but the surfaces they drive are someone else's domain.

**Two things I would probe before building:**
1. Whether the Agent SDK accepts image content blocks on a user turn at all (gates T1/T2/T3 — a whole
   sub-domain).
2. Whether Ink surfaces `home`/`end`/`pageup`/`pagedown`, `shift+return`, and mouse events in this terminal
   setup (gates E6, E7, E13, A7, X3). The W2 pager work already found `home`/`end` do not arrive as key flags,
   which is evidence the answer is partly no.
