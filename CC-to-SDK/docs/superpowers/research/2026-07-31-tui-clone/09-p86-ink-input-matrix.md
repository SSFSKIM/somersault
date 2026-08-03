# P86 — Ink input capability matrix (live, under a pty)

Gates wave **F2** (the declarative keymap). Question: **which key/input events can Ink's input layer
actually deliver to a `useInput` handler in a pty, and in what shape?** Declared ≠ reachable, so every
row below is a live measurement, not a reading of types.

**Environment (recorded by the driver at run time).**

| | |
|---|---|
| ink | **5.2.1** (`harness/node_modules/ink`) |
| react | 18.3.1 |
| node | **v24.18.0** |
| TERM | `xterm-256color`, `COLORTERM=truecolor` |
| pty winsize | 100×30 |
| platform | darwin 25.5.0 |

**Rerun (one command, no credentials, no network):**

```
python3 /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/86-ink-input-matrix.py
```

Optional: `--log <path>` to keep the JSONL, `--json` for a machine-readable dump.

**Artifacts.** Driver `probes/probes/86-ink-input-matrix.py` (`pty.fork`, feeds each sequence alone with a
150 ms gap, drains the pty continuously, replays the append-ordered log). Child
`probes/probes/86-ink-input-child.tsx` (a one-`<Text>` Ink app with a `useInput` handler **and** a
competing `process.stdin.on("data")` raw tap, both appending to one JSONL log).

**Reproducibility.** Two consecutive full runs produced **byte-identical** reports.

**Evidence standard.** Every "useInput received" cell is the verbatim event the handler was called with.
Anything not settled is written **not determined** — nothing here is inferred from declarations. Byte
sequences are written escaped (`\x1b` = ESC = 0x1b). Line cites `pk:N` are into
`harness/node_modules/ink/build/parse-keypress.js`; `ui:N` into
`harness/node_modules/ink/build/hooks/use-input.js`; `app:N` into
`harness/node_modules/ink/build/components/App.js`.

---

## 0. How Ink turns bytes into `(input, key)` — the three facts that explain every surprise

1. `App.handleReadable` (`app:132-139`) drains `stdin.read()` in a loop and re-emits **each chunk
   verbatim**. There is **no escape-sequence buffering and no escape timeout anywhere in Ink**: one read
   chunk = one `useInput` call, always.
2. `parseKeypress` (`pk:118-223`) is a fixed table plus two regexes — `metaKeyCodeRe`
   (`pk:3`, only ESC + a single `[a-zA-Z0-9]`) and `fnKeyRe` (`pk:4`, only ESC + `O|N|[|[[`). Anything it
   does not recognise falls through `pk:222` with **`name: ''` and every modifier `false`**.
3. `useInput` (`ui:47-80`) projects that parse onto a **fixed 14-field boolean record**. There is no
   `name`, no `code`, no `sequence` — `keypress.name`/`keypress.code` are computed and then **thrown
   away**. `input` is rebuilt at `ui:67-75`: `keypress.ctrl ? keypress.name : keypress.sequence`, blanked
   to `''` for any name in `nonAlphanumericKeys` (`pk:86`), then **one leading ESC is stripped**.

Consequence: the fixed-14-boolean projection is the bottleneck, not the parser. The parser knows `home`
from `end` from `insert`; `useInput` has no field to say so, so all three arrive identical.

---

## 1. Full results table

Classification legend — **reachable** (distinct and correctly attributed) · **aliased** (delivered but
indistinguishable from another key; the collision is named) · **misparsed** (delivered with wrong
attribution, or as insertable text) · **undelivered** (no `useInput` call at all).

`flags` lists only the `true` fields of the 14-boolean `key` record; `[-]` means all fourteen are `false`.
**Every row produced exactly one `useInput` call — nothing in this matrix was `undelivered`**, and the raw
tap saw the exact bytes fed in every row without exception, so the "parser knew" column shows what
`parseKeypress` made of those bytes (which is what a raw tap would have to work from).

### 1.1 Navigation

| fed | useInput received | parser knew (raw tap) | class |
|---|---|---|---|
| `\x1b[H` home | `input="" flags=[-]` | `name:"home" code:"[H"` | **aliased** — identical event to end/insert/F-keys |
| `\x1bOH` home (SS3) | `input="" flags=[-]` | `name:"home" code:"OH"` | **aliased** — same |
| `\x1b[1~` home | `input="" flags=[-]` | `name:"home" code:"[1~"` | **aliased** — same |
| `\x1b[F` end | `input="" flags=[-]` | `name:"end" code:"[F"` | **aliased** — indistinguishable from home |
| `\x1bOF` end (SS3) | `input="" flags=[-]` | `name:"end" code:"OF"` | **aliased** — same |
| `\x1b[4~` end | `input="" flags=[-]` | `name:"end" code:"[4~"` | **aliased** — same |
| `\x1b[5~` pageup | `input="" flags=[pageUp]` | `name:"pageup"` | **reachable** |
| `\x1b[6~` pagedown | `input="" flags=[pageDown]` | `name:"pagedown"` | **reachable** |
| `\x1b[2~` insert | `input="" flags=[-]` | `name:"insert"` | **aliased** — indistinguishable from home/end |
| `\x1b[3~` delete | `input="" flags=[delete]` | `name:"delete"` | **aliased** — collides with the Backspace key (`\x7f`, §1.5) |

The all-false collision class is exactly `nonAlphanumericKeys` minus the six names that got a boolean:
`home`, `end`, `insert`, `clear` and `f1`…`f12` all produce byte-identical events. `pk:86` puts them all in
the blank-the-input list (`ui:68-70`), and `ui:47-66` has no field for any of them.

### 1.2 Modified navigation

| fed | useInput received | parser knew | class |
|---|---|---|---|
| `\x1b[1;5A` ctrl+up | `input="" flags=[upArrow,ctrl]` | `up`, ctrl | **reachable** |
| `\x1b[1;5B` ctrl+down | `input="" flags=[downArrow,ctrl]` | `down`, ctrl | **reachable** |
| `\x1b[1;2A` shift+up | `input="" flags=[upArrow,shift]` | `up`, shift | **reachable** |
| `\x1b[1;2B` shift+down | `input="" flags=[downArrow,shift]` | `down`, shift | **reachable** |
| `\x1b[1;2C` shift+right | `input="" flags=[rightArrow,shift]` | `right`, shift | **reachable** |
| `\x1b[1;2D` shift+left | `input="" flags=[leftArrow,shift]` | `left`, shift | **reachable** |
| `\x1b[1;3A` alt+up | `input="" flags=[upArrow,meta]` | `up`, meta | **aliased** — identical to super/cmd+up |
| `\x1b[1;9A` super+up (iTerm) | `input="" flags=[upArrow,meta]` | `up`, meta | **aliased** — identical to alt+up |
| `\x1b[1;5H` ctrl+home | `input="" flags=[ctrl]` | `home`, ctrl | **aliased** — identical to ctrl+end |
| `\x1b[1;5F` ctrl+end | `input="" flags=[ctrl]` | `end`, ctrl | **aliased** — identical to ctrl+home |
| `\x1b[1;2H` shift+home | `input="" flags=[shift]` | `home`, shift | **aliased** — identical to shift+end |
| `\x1b[1;2F` shift+end | `input="" flags=[shift]` | `end`, shift | **aliased** — identical to shift+home |

Why alt and super collapse: `pk:215` computes `key.meta = !!(modifier & 10)`. Decimal 10 is `0b1010`, i.e.
the alt bit (2) **and** the super bit (8) at once — so xterm modifier 3 (alt) and 9 (super) both set the
one `meta` flag, and `ui:65` copies it through. There is no `key.alt` and no `key.super` in the 14-field
record (`ui:47-66`).

Why `ctrl+home ≡ ctrl+end`: the modifier decode at `pk:214-216` is correct, but the *identity* of the key
lives only in `keypress.name`/`code`, which `useInput` discards. The modifier survives; the key does not.

### 1.3 Tab

| fed | useInput received | class |
|---|---|---|
| `\t` | `input="" flags=[tab]` | **reachable** |
| `\x1b[Z` shift+tab | `input="" flags=[shift,tab]` | **reachable** — `pk:84` maps `[Z`→`tab`, `pk:100` forces shift |

Caveat (static, not exercised): `App.handleInput` (`app:152-158`) *also* consumes `tab` / `shift+tab` for
focus traversal, but only when `isFocusEnabled && focusables.length > 0`, and it does not suppress the
`useInput` dispatch. Our probe app registers no focusables, so this path was not exercised — see §5.

### 1.4 Enter forms

| fed | useInput received | class |
|---|---|---|
| `\r` | `input="\r" flags=[return]` | **reachable** |
| `\n` | `input="\n" flags=[-]` | **misparsed** — insertable text; `key.return` is `false` |
| `\x1b\r` ESC-CR (`/terminal-setup`'s shift+enter) | `input="\r" flags=[-]` | **misparsed** — an insertable CR |
| `\x1b[13;2u` CSI-u shift+enter | `input="[13;2u" flags=[-]` | **misparsed** — insertable text |
| `\x1b[13;5u` CSI-u ctrl+enter | `input="[13;5u" flags=[-]` | **misparsed** — insertable text |

`\n`: `pk:150-153` names it `enter`, but `ui:54` sets `key.return` only for the name `return`, and `enter`
is not in `nonAlphanumericKeys` (`pk:86` takes `Object.values(keyName)`, which contains neither `return`
nor `enter`), so the literal `\n` survives into `input`. This is the mechanism our composer already relies
on for `ctrl+j` = newline.

`\x1b\r` is the important one. `metaKeyCodeRe` (`pk:3`) requires `[a-zA-Z0-9]` after the ESC, so CR does
not match it; `fnKeyRe` (`pk:4`) requires `O|N|[`. Nothing matches, so `pk:222` returns `name:''` with all
modifiers false, and `ui:73-74` strips the leading ESC — leaving a bare `"\r"` with **no** `return` flag.
So ESC-CR is *not* aliased to Enter and *not* reported as meta+enter: it has a distinct, if accidental,
signature. `input === "\r" && !key.return` is a usable (if brittle) test for shift+enter; nothing else in
the matrix produces it.

### 1.5 Control-code edge cases

| fed | useInput received | class |
|---|---|---|
| `\x1f` ctrl+_ / ctrl+- | `input="\x1f" flags=[-]` | **misparsed** — lands in the text-insert path |
| `\x00` ctrl+space | ``input="`" flags=[ctrl]`` | **misparsed** — reported as ctrl+backtick |
| `\x08` ctrl+h | `input="" flags=[backspace]` | **misparsed** — reported as the Backspace key; `ctrl` is `false` |
| `\x7f` Backspace key | `input="" flags=[delete]` | **aliased** — reported as **delete**, colliding with `\x1b[3~` |
| `\x1a` ctrl+z | `input="z" flags=[ctrl]` | **reachable** (raw mode delivers the byte; no SIGTSTP) |

**`\x1f` confirms the prior finding exactly.** The ctrl+letter branch is `pk:178-182`, guarded by
`s.length === 1 && s <= '\x1a'`. Since `0x1f > 0x1a`, ctrl+`\` (0x1c), ctrl+`]` (0x1d), ctrl+`^` (0x1e) and
ctrl+`_` (0x1f) all fall past every branch to `pk:222` and arrive as raw insertable control characters with
`key.ctrl === false`. `\x00` is the mirror-image bug: it *is* `<= '\x1a'`, so `pk:180` computes
`String.fromCharCode(0 + 97 - 1)` = `` ` ``.

`\x08` vs `\x7f`: `pk:158-162` names `0x08` **backspace** and `pk:163-168` names `0x7f` **delete** (the TODO
at `pk:164` says the split exists only to avoid an Ink breaking change). So on any normal terminal the
physical Backspace key raises `key.delete`, and `key.backspace` fires only for ctrl+h.

### 1.6 Alt/meta letter chords (ESC-prefix form)

All ten upstream chords behave identically and correctly:

| fed | useInput received | class |
|---|---|---|
| `\x1bd` alt+d | `input="d" flags=[meta]` | **reachable** |
| `\x1bp` meta+p | `input="p" flags=[meta]` | **reachable** |
| `\x1bt` meta+t | `input="t" flags=[meta]` | **reachable** |
| `\x1bo` meta+o | `input="o" flags=[meta]` | **reachable** |
| `\x1bw` meta+w | `input="w" flags=[meta]` | **reachable** |
| `\x1bb` alt+b | `input="b" flags=[meta]` | **reachable** |
| `\x1bf` alt+f | `input="f" flags=[meta]` | **reachable** |
| `\x1by` alt+y | `input="y" flags=[meta]` | **reachable** |
| `\x1bv` alt+v | `input="v" flags=[meta]` | **reachable** |
| `\x1bm` meta+m | `input="m" flags=[meta]` | **reachable** |
| `\x1b\x7f` alt+backspace | `input="" flags=[delete,meta]` | **reachable** (`pk:163-167` sets `meta` from the ESC prefix) |

`metaKeyCodeRe` (`pk:3`, applied at `pk:196-200`) sets `meta` and leaves `name` empty, so `ui:67` takes the
sequence and `ui:73-74` strips the ESC — the letter survives. The branch also sets `key.shift` for
ESC+uppercase (`pk:199`), so alt+shift+D is distinguishable from alt+d.

Residual ambiguity (inherent to the ESC-prefix encoding, not to Ink): alt+d is byte-identical to Escape
then `d` when both land in the same read chunk. Since Ink has no escape timeout, the disambiguation window
is the pty read boundary and nothing else.

### 1.7 CSI-u chords (kitty / iTerm2 protocol)

| fed | useInput received | class |
|---|---|---|
| `\x1b[98;6u` ctrl+shift+b | `input="[98;6u" flags=[-]` | **misparsed** — insertable text |
| `\x1b[107;9u` super+k (cmd+k) | `input="[107;9u" flags=[-]` | **misparsed** — insertable text |
| `\x1b[112;9u` super+p | `input="[112;9u" flags=[-]` | **misparsed** — insertable text |

`fnKeyRe` (`pk:4`) can only terminate a numeric CSI with `[~^$]` — `u` is not in that class — and its
letter alternative `(?:1;)?(\d+)?([a-zA-Z])` cannot consume `98;6` before the letter. So every CSI-u
sequence falls through to `pk:222`. **Ink 5 has no CSI-u support at all.**

Silver lining, and it is a real one: the body of the sequence survives verbatim in `input` (only the
leading ESC is removed, `ui:73-74`). A keymap can recover CSI-u itself by matching `input` against
`/^\[(\d+)(?:;(\d+))?u$/` — **no raw tap required**.

### 1.8 Mouse and focus

| fed | useInput received | class |
|---|---|---|
| `\x1b[<64;10;10M` SGR wheel-up | `input="[<64;10;10M" flags=[-]` | **misparsed** — insertable text, body intact |
| `\x1b[<65;10;10M` SGR wheel-down | `input="[<65;10;10M" flags=[-]` | **misparsed** — same |
| `\x1b[<0;10;10M` SGR left-press | `input="[<0;10;10M" flags=[-]` | **misparsed** — same |
| `\x1b[<0;10;10m` SGR left-release | `input="[<0;10;10m" flags=[-]` | **misparsed** — same |
| `\x1b[M\x20\x2a\x2a` X10 report | `input="[M **" flags=[-]` | **misparsed** — insertable text |
| `\x1b[I` focus-in | `input="[I" flags=[-]` | **misparsed** — insertable text |
| `\x1b[O` focus-out | `input="[O" flags=[-]` | **misparsed** — insertable text |

SGR mouse never matches `fnKeyRe` because `<` follows the `[`. Focus events *do* match (`code:"[I"` /
`code:"[O"` in the raw column) but `keyName` (`pk:5-85`) has no entry for them, so `name` is `undefined`
and `ui:68` leaves the text in place.

**X10 caveat, load-bearing.** `App.handleSetRawMode` calls `stdin.setEncoding('utf8')` (`app:114`). Our X10
probe deliberately used ASCII-safe coordinate bytes (`0x20 0x2a 0x2a`). Real X10 coordinates are
`32 + position` and exceed 127 past column/row 95, where UTF-8 decoding will mangle them — and Ink offers
no way to get a `Buffer`. Whether a raw `stdin.on("data")` tap can still recover those bytes after Ink has
set utf8 encoding on the shared stream is **not determined**. SGR mouse (`?1006h`) has no such hazard — it
is all ASCII digits — which makes SGR the only safe mouse encoding for F2.

### 1.9 Bracketed paste

| fed (one write) | useInput received | class |
|---|---|---|
| `\x1b[200~hello\nworld\x1b[201~` | **exactly one call**: `input="[200~hello\nworld\x1b[201~" flags=[-]` | **misparsed** — markers leak through |

One `useInput` call for the whole paste. The markers are **not** stripped, and the stripping is asymmetric:
the *opening* marker lost its ESC (to `ui:73-74`, which removes one leading ESC from the whole chunk) but
kept `[200~`, while the *closing* marker retains its ESC intact. Ink also never enables `?2004h` at all
(§2), so bracketed paste only appears if something else turned it on.

### 1.10 Timing and chunking

| case | result | class |
|---|---|---|
| bare `\x1b` then 500 ms silence | one call, **immediate** (same millisecond as the raw tap): `input="" flags=[escape,meta]` | **reachable** |
| torn CSI: `\x1b`, then `[5~` 50 ms later | **two** calls — `flags=[escape,meta]`, then `input="[5~" flags=[-]` | **misparsed** (as pageup) |
| `abc` as one 3-byte write | **one** call, `input="abc" flags=[-]` | **reachable** |

Escape is delivered with **no delay and no timer**: the escape event was logged before the second half of
the torn sequence was even written, 50 ms later. There is no escape-timeout code anywhere in Ink —
`app:132-139` dispatches every chunk synchronously. So an application can never distinguish "Escape
pressed" from "start of an escape sequence torn across a read boundary"; it sees only the chunk boundary
the pty gave it.

Note `key.meta` is `true` for a bare Escape — `ui:65` deliberately ORs `keypress.name === 'escape'` into
`meta`. Any F2 rule of the form "meta + X" must exclude `key.escape`.

`abc` in one write is one call with a 3-character `input` — the documented paste behaviour, and it means an
F2 keymap must treat multi-character `input` as text, never as a key.

---

## 2. Terminal modes Ink enables on its own

Grepped over **every byte the child wrote to the pty** across the whole run (2,201 bytes), cross-checked
against a static grep of all of `harness/node_modules/ink/build/`:

| mode | Ink emits it? |
|---|---|
| `?2004h/l` bracketed paste | **no** (0 occurrences; the string does not appear anywhere in the build) |
| `?1000h` / `?1002h` / `?1003h` mouse tracking | **no** (same) |
| `?1006h` SGR mouse / `?1015h` urxvt mouse | **no** (same) |
| `?1004h` focus reporting | **no** (same) |
| `?1049h` alternate screen | **no** |
| `?25l` cursor hide | **yes** (×2 — `cliCursor.hide` at `app:92`) |
| `?25h` cursor show | **yes** (×3 — `cliCursor.show` at `app:95`, plus exit-path restores) |

Ink manages exactly one piece of terminal state: cursor visibility. **Everything else F2 wants — mouse,
focus reporting, bracketed paste — F2 must enable and disable itself**, including restoring it on unmount,
on suspend (ctrl+z / SIGTSTP), and on crash.

---

## 3. Does a raw stdin tap coexist with Ink's handler?

**Yes, cleanly, and it runs first.** Measured, not inferred:

- Across all 60 fed sequences, **every** one produced exactly **one** raw-tap event and exactly **one**
  `useInput` event. Zero drops on either side, zero duplicates, in two independent runs.
- The raw tap always saw the **exact bytes fed**, un-decoded and un-stripped — including the ESC that
  `ui:73-74` removes and the key identity that `useInput` discards.
- Append order in the shared log is **raw tap first, `useInput` second**, in all 60 groups (same
  millisecond or 1 ms apart). A tap can therefore inspect bytes ahead of Ink's dispatch.
- The tap was registered ~50 ms **after** mount, i.e. after Ink had already called `stdin.setRawMode(true)`
  and attached its `'readable'` listener (`app:117-121`). Mixing a `'data'` listener with Ink's
  `'readable'` + `read()` loop starved neither side.

Two limits, both structural:

1. **The tap is observational only — it cannot suppress.** `App.handleReadable` re-emits every chunk on
   `internal_eventEmitter` (`app:136-137`), and `useInput` offers no veto (`ui:82-87` special-cases only
   ctrl+C). So if F2 handles a mouse report in a raw tap, `useInput` **will still fire** with the leaked
   `"[<64;10;10M"` text and the composer must drop it. Any raw-tap design needs an explicit
   already-consumed filter on the `useInput` side.
2. **Encoding is shared and already forced to utf8** (`app:114`) — see the X10 caveat in §1.8.

Because unrecognised escape sequences reach `useInput` with their body fully intact (only one leading ESC
removed), a raw tap is **not actually required** for CSI-u, SGR mouse, focus events, or bracketed paste:
the same parsing can be done on `input` inside the single `useInput` handler, which sidesteps limit 1
entirely. The raw tap's only unique capability is seeing bytes Ink's `input` rewrite destroys — in
practice the leading ESC, the discarded key identity (§1.1/§1.2), and potentially non-UTF-8 bytes.

---

## 4. Consequences for F2

Mapping each upstream binding family from `06-keys-themes.md` §1.6–§1.9 onto what Ink can actually deliver.

**Reachable as shipped — bind directly on `key`:**

| family | upstream bindings | signature |
|---|---|---|
| pageup / pagedown | `Scroll` `scroll:pageUp` / `scroll:pageDown` | `key.pageUp` / `key.pageDown` |
| shift+tab | `chat:cycleMode`, `tabs:previous` | `key.tab && key.shift` |
| arrows, ctrl+arrows, shift+arrows | `app:diffFileListUp/Down`, `selection:extend*` | arrow boolean + `key.ctrl` / `key.shift` |
| alt/meta letters | `alt+d/b/f/y` (composer), `meta+p/t/o/w/m` (`chat:modelPicker`, `thinkingToggle`, `fastMode`, `workflowKeywordToggle`) | `key.meta && !key.escape && input === "<letter>"` |
| alt+backspace | composer delete-word-back | `key.delete && key.meta` |
| ctrl+letter, `a`–`z` | the whole readline set (`ctrl+a/b/e/f/k/n/p/u/w/y`, `ctrl+r`, `ctrl+t`, `ctrl+o`, `ctrl+g`, `ctrl+s`, `ctrl+l`, the `ctrl+x` chords) | `key.ctrl && input === "<letter>"` |
| enter, escape | `chat:submit`, `chat:cancel` | `key.return` / `key.escape` |

**Aliased — deliverable but ambiguous; F2 must accept the collision or parse the bytes itself:**

| family | collision |
|---|---|
| `home` / `end` (`scroll:top`, `scroll:bottom` in `Transcript`) | **home ≡ end ≡ insert ≡ F1–F12** — all arrive as `input:""` with all fourteen booleans false. Cannot be told apart at all. |
| `ctrl+home` / `ctrl+end` (`Scroll`) | **ctrl+home ≡ ctrl+end**, both `input:"" flags=[ctrl]` |
| `shift+home` / `shift+end` (`selection:extendLineStart` / `extendLineEnd`) | **shift+home ≡ shift+end**, both `input:"" flags=[shift]` |
| Delete key vs Backspace key | `\x1b[3~` and `\x7f` **both** raise `key.delete`; `key.backspace` fires only for ctrl+h (`\x08`) |
| alt+arrow vs cmd/super+arrow (`meta+up`/`meta+down` → `app:diffFileListUp/Down`) | both raise `key.meta` (`pk:215` masks with `10`). Harmless for this binding — upstream maps both to the same action — but F2 can never separate Option from Command on an arrow. |

There is **no fix available inside `useInput`** for the home/end/insert class: the bytes differ but the
delivered event does not. F2 must read the sequence before Ink flattens it — i.e. a raw tap (§3), with the
suppression caveat — or accept that home, end, insert and the function keys are one undifferentiated key.
This is the single biggest constraint the probe found.

**Misparsed — delivered, but as insertable text or with wrong attribution; F2 must special-case them:**

| family | what to match | note |
|---|---|---|
| `ctrl+_` / `ctrl+-` → `chat:undo` | `input === "\x1f"` (and `\x1c`/`\x1d`/`\x1e` for ctrl+`\`/`]`/`^`) | `key.ctrl` is **false** (`pk:178`). Confirms the known dead branch at `editor.ts:242` — the fix is to match the raw control character, not `key.ctrl`. |
| `ctrl+shift+b` → `app:toggleBrief` | `input === "[98;6u"` — **only** where the terminal speaks CSI-u | On a terminal without CSI-u, ctrl+shift+b is byte-identical to ctrl+b and **undeliverable in principle**. |
| `cmd+k` → `chat:clearScreen` | `input === "[107;9u"` under CSI-u | Same caveat; most terminals never send cmd+k to the application at all. |
| shift+enter (ESC-CR from `/terminal-setup`) | `input === "\r" && !key.return` | Distinct signature, verified; nothing else produces it. |
| shift+enter / ctrl+enter (CSI-u form) | `/^\[13;(\d+)u$/` on `input` | |
| ctrl+j newline | `input === "\n"` | already how our composer works |
| ctrl+h (composer delete-token) | `key.backspace`, not `key.ctrl` | and the real Backspace key is `key.delete` |
| ctrl+space | ``input === "`" && key.ctrl`` | collides with a genuine ctrl+backtick |

**Requires F2 to own terminal state (Ink enables none of it — §2):**

| family | what F2 must do |
|---|---|
| `wheelup` / `wheeldown` → `scroll:lineUp` / `scroll:lineDown` | emit `?1006h` + `?1000h` on mount and `?1006l` / `?1000l` on unmount **and** on suspend/crash; then match `/^\[<(\d+);(\d+);(\d+)([Mm])$/` on `input`. Use **SGR only** — X10 coordinates break under Ink's forced utf8 encoding (§1.8). |
| focus in / out | emit `?1004h`; match `input === "[I"` / `"[O"`. Not in the upstream binding table, but needed for any pause-on-blur behaviour. |
| bracketed paste | emit `?2004h`; strip the markers manually — they arrive **unstripped** and asymmetrically (opening marker without its ESC, closing marker with it), in a single `useInput` call. |

**Also load-bearing for the F2 design, independent of any one binding:**

- One read chunk = one `useInput` call, with **no escape timeout**. A keymap cannot use "ESC then nothing
  for N ms" to disambiguate; it gets whatever the pty read boundary gave it. Torn sequences produce a
  spurious `escape` event followed by junk text, and the composer's insert path must tolerate that.
- `key.meta` is `true` for a bare Escape (`ui:65`). Every meta rule needs `&& !key.escape`.
- `input.length > 1` means paste or chunk, never a key.
- `useInput` never exposes `keypress.name`, `keypress.code` or the original sequence. A declarative keymap
  keyed on names (`"home"`, `"ctrl+end"`) must therefore be backed either by its own parser over `input` or
  by a raw tap — the 14 booleans alone cannot express the upstream table.

---

## 5. Not determined

- Whether a raw `stdin.on("data")` tap can recover non-UTF-8 bytes (X10 mouse coordinates past column 95)
  after Ink sets `stdin.setEncoding('utf8')` at `app:114`. Our tap received strings throughout.
- Whether an app that registers `useFocus` focusables changes the delivered `tab` / `shift+tab` events
  (`app:152-158` runs first but does not suppress the `useInput` dispatch). Not exercised — the probe app
  had no focusables.
- Behaviour on Windows/ConPTY, and under terminfo other than `xterm-256color`. Only darwin +
  `xterm-256color` was measured.
- Whether Ink's `useStdin().stdin` can be consumed *instead of* `useInput` (bypassing the flattening
  entirely) without breaking Ink's own ctrl+C and focus handling. Not probed; it is the obvious alternative
  to a side-channel raw tap and should be settled before F2 commits to an architecture.
