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

**Follow-up P86b** (§6, and the source of every "settled by P86b" note below) —
`probes/probes/86b-ink-rawstdin-matrix.py` + `86b-ink-rawstdin-child.tsx`, run the same way:

```
python3 /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/86b-ink-rawstdin-matrix.py
```

**Reproducibility.** Two consecutive full runs produced **byte-identical** reports. A third run with
`--term vt100` was also byte-identical, confirming Ink's input decoding is terminfo-independent (it is a
hardcoded table in `parse-keypress.js`, never a terminfo lookup).

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

`App.handleInput` (`app:152-158`) *also* consumes `tab` / `shift+tab` for focus traversal when
`isFocusEnabled && focusables.length > 0`. **Settled by P86b (config D):** with two live `useFocus`
focusables in the tree — focus demonstrably moving, `[two:focused]` appearing in the rendered frames —
`useInput` still received `input:"" flags=[tab]` and `input:"" flags=[shift,tab]`, byte-identical to the
no-focusables case. Focus traversal and `useInput` dispatch both happen; neither suppresses the other.

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

**X10 caveat, load-bearing — and now settled.** `App.handleSetRawMode` calls `stdin.setEncoding('utf8')`
(`app:114`). Our X10 row above deliberately used ASCII-safe coordinate bytes (`0x20 0x2a 0x2a`); real X10
coordinates are `32 + position` and exceed 127 past column/row 95. **P86b fed the real thing**
(`\x1b[M\x20\xc8\xc8`) and measured three outcomes:

| stream encoding | bytes the listener got | recoverable? |
|---|---|---|
| Ink's forced utf8 | `1b 5b 4d 20 ef bf bd` — the two `0xc8` bytes collapsed into one U+FFFD | **no**, irrecoverably lost |
| `stdin.setEncoding("latin1")` after `setRawMode` | `1b 5b 4d 20 c8 c8` — verbatim | **yes**, losslessly |
| never engaging Ink's `setRawMode` at all (config E) | `1b 5b 4d 20 c8 c8` as a real `Buffer` | **yes**, losslessly |

Note `stdin.setEncoding(null)` does **not** work — Node's `new StringDecoder(null)` defaults to utf8, so
the decoder stays in place. `latin1` is the fix: a 1:1 byte↔codepoint map, from which `Buffer.from(s,
"latin1")` reconstructs the exact bytes. SGR mouse (`?1006h`) is still preferable — it is all ASCII digits
and needs none of this — but X10 is no longer a hard blocker.

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

**Read §4.1 first if you are choosing the architecture.** Everything from here to §4.1 describes what F2
gets *if it keeps a `useInput` root* — which the P86b follow-up now argues against. It is still the
accurate account of that option, and of why the alternative is worth its costs.

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
delivered event does not. F2 must read the sequence before Ink flattens it, or accept that home, end,
insert and the function keys are one undifferentiated key. This is the single biggest constraint the probe
found, and it is what makes the §4.1 verdict a verdict rather than a preference — a raw-stdin root
dissolves this whole table, and no arrangement of `useInput` handlers can.

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

### 4.1 Verdict: what F2's input layer should be

**A root raw-stdin consumer with no `useInput` anywhere in our tree is viable, and it is the right
architecture for F2.** P86b proved it end to end (§6): the bytes arrive verbatim, chunking is 1:1 with
writes, rendering is unaffected, and Ink cleans the terminal up afterwards. It dissolves every *aliased*
row in §4 at a stroke — home, end, insert, ctrl+home, ctrl+end, shift+home, shift+end and the function keys
are all trivially distinguishable once F2 sees the bytes — and it removes the "raw tap cannot suppress"
problem from §3, because there is no second consumer to suppress.

The recommended shape, which is exactly P86b config C (measured working, clean exit, terminal restored):

```
render(<App/>, { exitOnCtrlC: false })          // REQUIRED — see (c) in §6
const { stdin, setRawMode } = useStdin()
setRawMode(true)                                 // via the context, so Ink owns termios restore
stdin.setEncoding("latin1")                      // lossless bytes; undoes Ink's forced utf8
stdin.on("data", chunk => dispatch(Buffer.from(chunk, "latin1")))
```

Going through `useStdin().setRawMode` rather than `process.stdin.setRawMode` directly is the deliberate
choice: it keeps Ink's termios lifecycle (`app:104-131`), which P86b config E showed is **not** applied to
raw mode Ink did not set. The cost is that Ink's `App.handleReadable` stays attached — harmless with no
`useInput` hooks, but it is why `exitOnCtrlC: false` is mandatory rather than optional.

What F2 then owns, none of which Ink provides: its own key-name parser over the raw bytes (the whole
upstream table becomes expressible), its own ctrl+C policy, and the terminal modes from §2 (mouse, focus,
bracketed paste) including their restore on unmount, suspend and crash.

One consequence worth stating plainly: **the entire "aliased" and "misparsed" taxonomy in §4 is a
`useInput` artifact, not a terminal or Ink-wide limit.** It describes the cost of the architecture F2 is
being advised to abandon. Keep §1 as the record of why.

---

## 5. Settled (was "not determined")

Every item P86 could not settle has now been settled by the P86b follow-up, except one that is
structurally out of reach on this machine.

| P86 open question | settled answer | evidence |
|---|---|---|
| Can a raw listener recover non-UTF-8 bytes after Ink forces utf8? | **Yes, via `setEncoding("latin1")`** (or by never engaging Ink's `setRawMode`, which leaves real `Buffer`s). `setEncoding(null)` does *not* work. | §1.8 table, P86b configs C and E |
| Does `useFocus` change the `tab`/`shift+tab` events `useInput` receives? | **No.** With focus demonstrably moving between two focusables, the events were byte-identical to the no-focusables case. | §1.3, P86b config D |
| Does terminfo other than `xterm-256color` change anything? | **No.** A full `--term vt100` rerun was byte-identical. Ink's decoding is a hardcoded table, never a terminfo lookup. | preamble |
| Can `useStdin().stdin` be consumed instead of `useInput`? | **Yes** — verbatim bytes, 1:1 chunking, rendering unaffected, terminal restored. This is now F2's recommended architecture. | §4.1, §6 |
| Windows / ConPTY behaviour | **Still not determined**, and not settleable here: it requires a Windows host. `pty.fork` does not exist on Windows and ConPTY's input translation is a different code path from the POSIX pty measured throughout. |  |

---

## 6. P86b — the raw-stdin consumer, measured


Five child configurations, same pty method, same environment. Config C is the one F2 should copy.

| # | configuration | outcome |
|---|---|---|
| A | `useStdin().setRawMode(true)` + own `data` listener, `exitOnCtrlC: true` | works; **Ink still exits on ctrl+C** |
| B | same, `exitOnCtrlC: false` | works; survives ctrl+C |
| C | same as B + `stdin.setEncoding("latin1")` | works; **byte-perfect including non-UTF-8**; clean exit; terminal restored |
| D | two `useFocus` focusables + a `useInput` logger | focus moves; `useInput` events unchanged |
| E | `process.stdin.setRawMode(true)` directly, Ink's `setRawMode` never called, `exitOnCtrlC: true` | real `Buffer`s, byte-perfect; **no ctrl+C exit**; **termios NOT restored**; **process does not exit after unmount** |

### (a) Do bytes arrive verbatim?

**Yes — verbatim, with nothing consumed or stripped.** All fourteen ASCII test sequences arrived on the
`data` listener with byte-for-byte identical hex to what was written, ESC included. The single leading-ESC
strip P86 documented is a **`useInput`-layer effect only** (`ui:73-74`); it does not exist at the stream.
`\x1b[H` arrives as `1b 5b 48`, not as `""`. `\x1b[200~ab\x1b[201~` arrives with both markers fully intact.
`\x1f` arrives as `1f`.

The one exception is encoding, not consumption: under Ink's forced utf8 the high bytes of an X10 mouse
report are destroyed (§1.8). `setEncoding("latin1")` (config C) or bypassing Ink's `setRawMode` (config E)
both give byte-perfect delivery.

### (b) Do chunk boundaries match writes?

**Yes, exactly 1:1.** Every write produced exactly one `data` event, in every row of every configuration —
no coalescing, no splitting. Lengths matched too, except where the utf8 decoder rewrote high bytes
(config B's X10 row: still one event, seven bytes instead of six). This matches
§1.10's finding from the `useInput` side and confirms the boundary is the pty read, not anything Ink does.

### (c) Does Ink still exit on ctrl+C with zero `useInput` hooks?

**Yes — and this is the one real trap.** Config A registered no `useInput` anywhere, and feeding `\x03`
still terminated the app. The reason: calling the *context's* `setRawMode` is what attaches Ink's own
`'readable'` listener (`app:117-121`), and that listener runs `App.handleInput`, whose ctrl+C branch
(`app:143-145`) is independent of `useInput` entirely.

- `exitOnCtrlC: false` **does** stop it (config B survived).
- Config E, which never calls the context's `setRawMode`, also never exits on ctrl+C — **even with
  `exitOnCtrlC: true`** — confirming the exit is attached to Ink's listener, not to the render option.

So F2 must pass `exitOnCtrlC: false` explicitly. It is not optional, and forgetting it means ctrl+C kills
the app instead of interrupting a turn.

Method note: an early run reported a false negative here. The high-byte X10 feed had been placed *before*
the ctrl+C feed, and the lone `0xc8` left an incomplete sequence in Node's utf8 decoder which flushed as
U+FFFD prepended to the next chunk — so Ink saw `"�\x03"`, its `input === '\x03'` test failed, and the
app did not exit. Reordering the two feeds produced the correct result. The ordering is now load-bearing
and commented as such in the driver.

### (d) Does rendering still work?

**Yes, unaffected.** The counter incremented once per chunk and repainted every time — 16 to 18 render
frames per run, visible in the pty output as successive `P86B READY mode=raw events=N` lines. No
focus-manager interference: config D showed the focus manager working normally *and* `useInput` receiving
tab/shift+tab unchanged, so the two coexist rather than competing.

### (e) What happens to raw mode on unmount?

Measured as `tcgetattr` on the pty master at three points — before spawn, while the app was live, and after
the child had exited. `lflags` before and after should match if the terminal was restored.

| configuration | before | while live | after exit |
|---|---|---|---|
| A / B / C / D (`useStdin().setRawMode`) | `ICANON\|ECHO\|ISIG\|IEXTEN` | `(none)` — raw genuinely engaged | `ICANON\|ECHO\|ISIG\|IEXTEN` — **fully restored** |
| E (direct `process.stdin.setRawMode`) | `ICANON\|ECHO\|ISIG\|IEXTEN` | `(none)` | **`(none)` — NOT restored** |

So Ink restores termios it set (`app:94-99` → `app:126-130`), and does **not** restore raw mode it did not
set. In config E the child deliberately skipped restoring it too, which is what makes the measurement
meaningful: `App.componentWillUnmount` calls `handleSetRawMode(false)`, but that decrements
`rawModeEnabledCount` from 0 to −1, so the `--count === 0` guard at `app:126` is false and
`stdin.setRawMode(false)` is never reached. A direct consumer inherits full responsibility for the
terminal — on unmount, on SIGINT/SIGTERM, on suspend, and on an uncaught exception.

Config E surfaced a second cost, unprompted: **the process did not exit after unmount.** Having called
`stdin.resume()` and attached a `data` listener ourselves, stdin stayed referenced and kept the event loop
alive indefinitely; the driver had to SIGKILL it. A direct consumer must `pause()`/`unref()` stdin in its
teardown. Configs A–D all exited cleanly on their own, because Ink's `setRawMode(false)` path calls
`stdin.unref()` (`app:129`).

Together, (c) and (e) are why §4.1 recommends going *through* `useStdin().setRawMode` rather than around
it: the context path costs one mandatory render option, and the direct path costs the entire terminal
lifecycle.
