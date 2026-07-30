# Static transcript rendering — Claude Code 2.1.220 vs. `cc-harness` TUI

Scope: everything in the transcript that is **not** a tool call. Reference is
`~/claude-code-bundle/2.1.220/cli.pretty.js` (579,698 lines). Our side is
`/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/src/tui/`.

All line numbers below are `cli.pretty.js` line numbers unless prefixed with a filename.

**Headline correction to a standing premise.** The bundle does **not** use `remark`/`unified` for
message markdown. It uses **`marked`**: the renderer is a switch over marked token types
(`f2`, line **420590**), driven by `$_.lexer(...)` (line **420587**). Greps for `mdast`,
`remarkGfm`, `micromark`, `fromMarkdown`, `"thematicBreak"`, `"listItem"`, `"inlineCode"` return
**zero hits**. `unified` exists in the bundle (line 156401 region) but is not on the message path.
Everything in §2 below is read off the `marked` token switch.

---

## Q1 — Assistant and user message identity

### 1.1 The assistant bullet glyph is platform-dependent

```js
Za = Pt() === "macos" ? "⏺" : "●";
```
— line **41484**. So the assistant bullet is **`⏺` (U+23FA, BLACK CIRCLE FOR RECORD) on macOS** and
`●` (U+25CF) everywhere else. The symbol table at line 41482 defines both.

### 1.2 Assistant text message

`VAr` (line **422714**), default branch at lines **422857–422864**:

```js
pre = ka.jsx(BT, { fromLeftEdge: !0, minWidth: 2,
        children: ka.jsx(h, { "aria-label": "claude:", color: "text", children: Za }) });
rca = ka.jsx(I, { flexDirection: "column", children: ka.jsx(km, { children: T6 }) });
v_H = ka.jsxs(I, { alignItems: "flex-start", flexDirection: "row",
        marginTop: C_, width: "100%", children: [pre, rca] });
```

- Gutter: a fixed **`minWidth: 2`** box holding the bullet. Colour is the theme token
  **`"text"`** — the ordinary foreground, **not an accent**. `aria-label: "claude:"`.
- Body: a sibling flex column, so **every continuation line aligns at column 2**. The indent is
  a layout property, not injected spaces.
- `marginTop: 1` when `addMargin`, i.e. a blank line above the message.
- `shouldShowDot` gates the bullet: consecutive text blocks in one assistant turn only get one.

### 1.3 The user's own prompt echo

`Mqo` (line **426136**) wraps `xqo` (line **426026**):

```js
aSH = _En.jsx(I, { flexDirection: "column", marginTop: mEn,
                   backgroundColor: hEn, paddingRight: gEn, children: yfa });
```
with `hEn = "userMessageBackground"` and `gEn = 1` (line 426170).

Theme values for `userMessageBackground` (line **156475** onward): `rgb(240,240,240)` light,
`rgb(55,55,55)` dark, plus `ansi:white` / `ansi:blackBright` for the ANSI themes.

The gutter inside `xqo` (line **426066**):

```js
Bvr = gf.jsx(I, { flexShrink: 0, children: f4t?.selectionHighlight === "off"
  ? gf.jsx(h, { children: "  " })
  : gf.jsxs(h, { "aria-label": ..., color: f4t?.selectionHighlight === "on" ? "suggestion" : "subtle",
                 children: [Ge.pointer, " "] }) });
```

`Ge.pointer = "❯"` (line 104968). So the prompt echo is **`❯ ` in the `subtle` colour**, and
the whole prompt block sits on a **grey background band** that runs to the right edge minus 1.
Body text is `color: "text"` (`h4t`, line **426099**), with per-character rainbow colouring for
matched ranges when `cit()` is on.

### 1.4 Long user prompts

`Mqo` lines **426146–426166**: over `tWp = 1e4` characters, the prompt becomes
`{head: text.slice(0, 2500), hiddenLines: N, tail: text.slice(-2500)}` and renders as
head → a **titled horizontal rule** → tail. The rule's title (`dEn`, line **426084**):

```js
qjp = `(${rSH} ${rSH === 1 ? "line" : "lines"} hidden)`;
nSH = gf.jsx(Sg, { title: qjp, titleAlign: "start", color: "subtle", padding: Wjp });
```

Constants `tWp = 1e4, Rqo = 2500, rWp = 2500` at line **426181**.

### 1.5 Queued messages

`wqo` (line **426002**) provides a context `{ isQueued: true, isFirst, paddingWidth: 4,
selectionHighlight }` and wraps the children in `paddingX: 2` (`$jp = 2`, line 426023). In brief
layout the body colour flips to `"subtle"` (`Cqo = eSH ? "subtle" : "text"`, line 426032). So a
queued message is the same block, **indented two columns**, dimmed in brief mode.

### 1.6 Interrupted messages

Constants at line **108575**:
```js
Tq = "[Request interrupted by user]", Wk = "[Request interrupted by user for tool use]"
```
`ERe` (line 426473) maps both to `<BP/>`; `BP` (line **422234**) is `<Cr height={1}><zWo/></Cr>`;
`zWo` (line **422222**) emits, dim:

```
Interrupted · What should Claude do instead?
```

`Cr` (line **406884**) is the `⎿` connector wrapper — a left-edge column containing
`"  " + "⎿ \xA0"` dim (line **406895**), then the content. That is a **5-column** gutter
(2 spaces, `⎿`, space, NBSP).

### 1.7 Our side

| | ours |
|---|---|
| assistant bullet | `render.ts:23` — `gutter: { text: "● ", color: ACCENT }`, `ACCENT = "#d97757"` (`theme.ts:26`). Always `●`, always accent-orange. |
| continuation indent | `render.ts:14-17` `indentLine(l, "  ")` — literal two spaces prepended to text + first segment. Same visual width. |
| user echo | `render.ts:106` — `{ text: "› " + line, dim: true }` per line. No background band, no `❯`. |
| queued | not rendered distinctly (no queued-message path in `render.ts`). |
| interrupted | not rendered (no handling of the `[Request interrupted…]` sentinel in `render.ts`). |
| long prompt | no truncation. |

---

## Q2 — Markdown

Entry point `_Ar` (line **420587**) / component `km` → `Oaa` (line **421134**). `Oaa` splits
top-level tokens three ways (lines 421147–421153):

- `type === "table"` → the `TWo` component (a real box-drawing table),
- `type === "blockquote"` → the `Naa` component (a bordered block),
- everything else → concatenated through `f2` into one ANSI string, rendered in a `wc`
  (wrapping `<Text>`), with `dimColor` / `italic` passed through.

The whole thing is a `<Box flexDirection="column" gap={1}>` (line **421157**) — **blocks are
separated by one blank line**.

Fast path (`WBp`, line **421105** + regex `hgH` at line **421281**):
```js
hgH = /[#*`|[>\-_~]|\n\n|(?:^|\n) {0,3}\d+\. |https?:\/\/|www\./
```
If the first 500 chars match none of that, the text is emitted as a single paragraph token
without lexing. Lexer results are LRU-cached, `mgH = 500` entries (line 421269).

### 2.1 Node-by-node (all from `f2`, lines 420590–420711)

| marked token | rendering | line |
|---|---|---|
| `heading` | depth 1 → `vt.bold.italic.underline`; depth ≥2 → `vt.bold`. `#` markers stripped (tokens are content). Followed by **two** newlines. | 420613–420616 |
| `paragraph` | content + one newline | 420661 |
| `space`, `br` | one newline | 420663, 420665 |
| `hr` | the literal string `"---"` | 420617 |
| `blockquote` (nested, via `f2`) | prefix each non-blank line with `vt.dim("▎")` + space, content `vt.italic`. `fGl = "▎"` (▎) at line 41482. | 420594–420596 |
| `blockquote` (top level, via `Naa`) | `borderStyle:"quote", borderTop:false, borderBottom:false, borderRight:false, borderDimColor:true, paddingLeft:1`, content italic. The `quote` border style is `{ left: "▎", everything else " " }` (line **179535**). So: a dim `▎` rail down the left, one space of padding. | 421181–421195 |
| `list` | iterates items; `orderedListNumber: ordered ? start + index : null` | 420649 |
| `list_item` | each child indented by `"  ".repeat(listDepth)`, **except** `code` / `blockquote` / `hr` / `table` children which are not indented | 420651–420657 |
| `text` inside a list item | marker is `"-"` when unordered — a **literal hyphen**, not a bullet glyph. Ordered marker is `JhH(depth, n) + "."` | 420672 |
| ordered numbering by depth | `JhH` (line **420826**): depth 0/1 → `1.`; depth 2 → `a.` (`KhH`, line 420810, base-26 letters); depth 3 → `i.` (`XhH`, line 420816, roman via table `YhH` at 420893); deeper → arabic | 420826–420838 |
| task list | `i.task && isFirstToken ? `[${i.checked ? "x" : " "}] ` : ""` — rendered as literal **`[x] ` / `[ ] `**, no checkbox glyph | 420672 |
| `strong` | `vt.bold` | 420609 |
| `em` | `vt.italic` | 420606 |
| `del` | `vt.strikethrough(u)` when the terminal supports it (`dHn()`, line **420493**: allowlist of TERM_PROGRAM + ghostty/mintty/JetBrains/kitty/alacritty/foot/Konsole/WT/Zed/VTE≥4400; Apple_Terminal and `linux` explicitly excluded), else literal `~~u~~` | 420610–420612 |
| `codespan` | `to("permission", theme)(text)` — the theme's **`permission`** colour, `rgb(87,105,247)` (indigo) in the light theme (line 156475) | 420604 |
| `image` | no alt and no title → the bare href. Otherwise `` `${alt} (${href}${title})` `` | 420619–420624 |
| `link` | see 2.2 | 420626–420648 |
| `escape`, `html` | raw text passed through | 420700, 420702 |
| `def` | empty string | 420704 |
| unknown | `e.raw` | 420706 |

### 2.2 Links and the `ink-link` host component

Two separate mechanisms.

**(a) Inside markdown**, `f2`'s `link` case calls `ZF(url, text, opts)` (line **393098**):

```js
if (!(... supportsHyperlinks ...)) {
  if (t !== void 0 && !o) return `${t} (${e})`;
  return e;
}
let u = (isLightTheme ? vt.blue : vt.blueBright)(t ?? e);
return `${vgp}${e}${Tgp}${u}${vgp}${Tgp}`;   // vgp = "\x1B]8;;", Tgp = "\x07"
```

So: **OSC-8 hyperlink** wrapping **blue / blueBright** link text when the terminal supports it;
plain `text (url)` when it does not. `file:` URLs are normalised to absolute `file://` hrefs first
(`jhH`, line 420713). `mailto:` collapses to the bare address (line 420633). `Ib = "⧉"` (⧉)
is the "external link" affordance glyph, and `yAr` (line **420511**) post-processes the assembled
ANSI to de-duplicate `(url)` suffixes and ⧉ markers around OSC-8 runs.

**(b) `ink-link` is the Ink fork's host component.** Node creation (line **175010**) gives it
**no yoga node** — it is a pure inline styling wrapper, like `ink-virtual-text`. Text collection
(line **174538**):

```js
else if (i.nodeName === "ink-link") { let s = i.attributes.href; Gmo(i, o, s || r, n); }
```
i.e. it propagates `href` down as a `hyperlink` field on each text run (line 174535). The renderer
stores `hyperlink` per terminal **cell** (lines 176272, 178281–178285) and emits
`bor(url)` on entering / `dMt` on leaving a hyperlink run. `bor` (line **148387**) emits
`OSC 8 ; id=<hash of url> ; <url> ST`, so multi-cell links coalesce into one hyperlink in the
terminal. Public wrapper is `Ro` (line **181857**): `{children, url, fallback, assumeSupport}`,
falling back to plain text when `mI()` says the terminal has no hyperlink support.

Used in the transcript by the image-attachment renderer (§6.2).

### 2.3 Tables

Top-level tables go to `TWo` (line **421082**) → `IBp` (line **420907**) → `kaa` (line 421019).

- Row cap `TBp = 200` (line 421072); overflow appends `AWo(n)`:
  `` `… ${n.toLocaleString()} more ${Et(n,"row")} not shown` `` (line **420897**).
- Column widths are fitted three ways (lines 420950–420968): natural widths if they fit; else
  distribute slack over the longest-word minima; else hard-scale, minimum `_Hn = 3` per column.
- Grid characters (line **420999**):
  `top ["┌","─","┬","┐"]`, `middle ["├","─","┼","┤"]`, `bottom ["└","─","┴","┘"]`, cell separator `│`.
- A `middle` rule is emitted **between every pair of data rows**, not just under the header.
- Header cells are force-centred (`R(header, true)`, line 421006); body cells honour the markdown
  `align` (`bWo`, line **420839**: left / center / right padding).
- **Fallback to a vertical/record layout** (`x()`, line 420990) when any cell needs more than
  `ngH = 4` wrapped lines, or when the assembled table is wider than `terminalWidth - vBp` (4).
  `kaa` then renders each row as `header: value` lines separated by a
  `"─".repeat(min(width-1, 40))` rule (line 421019–421040).
- `f2`'s own `table` case (line 420679, used for *nested* tables) is a plain pipe table:
  `| a | b |`, a `|---|---|` separator built from `"-".repeat(w+2)`, then rows.
- Screen-reader mode (`Caa`, line **420849**) linearises to `"header: value. header: value."` sentences.

### 2.4 Streaming markdown

`CX` region, lines 421200–421269. The renderer keeps `{chunks, frozenSource, stablePrefix,
openFence}`; when a fenced block is open at the streaming boundary, the open fence is **re-prepended
to the tail** so the partial code still highlights (line 421263). `tailWrap: "wrap-stream"` for the
in-flight tail. Chunking threshold `bHn = 4096`, `VBp = 1536` (line 421269).

### 2.5 Our side

`markdown.ts` is a line-oriented regex renderer. Divergences, per rule:

| ours | file:line |
|---|---|
| headers → `bold`, inline markers stripped; **no depth distinction**, **no trailing blank line** | `markdown.ts:51` |
| unordered bullet → `"• "` (upstream: `-`) | `markdown.ts:53` |
| ordered → `` `${n}. ` `` verbatim from source; **no depth-based a./i. numbering**, no `start` offset | `markdown.ts:54` |
| **no nesting at all** — `BULLET`/`NUMBERED` are anchored `^`, so an indented list item falls through to the plain path with its leading spaces intact and no marker substitution | `markdown.ts:8-9,53-54` |
| **no task lists** | — |
| blockquote → `"│ " + text`, `dim: true`; not italic; `│` (U+2502) not `▎` (U+258E) | `markdown.ts:52` |
| **no `hr`** — a `---` line falls through `plainLine` to `inlineLine("", "---")` and renders literally | `markdown.ts:55` |
| **no links** — `[text](url)` is emitted verbatim; no OSC-8, no colour | — |
| **no images** | — |
| **no strikethrough** | `markdown.ts:14` |
| inline code → `color: "cyan"` (upstream: `permission` = indigo `rgb(87,105,247)`) | `markdown.ts:30` |
| inline regex is single-level, `[^*]+` / `[^_]+` — **cannot nest** (`**bold with *italic*` fails), and `_`/`*` inside words will false-positive | `markdown.ts:14` |
| tables → column-padded plain text, `│` separators, a single `─` rule under the header only; no box border, no alignment, no width fitting, no row cap, no vertical fallback | `markdown.ts:71-81` |
| **no block separation** — upstream's `gap: 1` between blocks is absent | — |

---

## Q3 — Code blocks

`f2`'s `code` case, lines **420598–420603**:

```js
case "code": {
  let u = e.lang ?? "",
      d = u.match(/^[\w.+#-]+/)?.[0] ?? "",
      p = s && u && s.supportsLanguage(u) ? u : s && d && s.supportsLanguage(d) ? d : "plaintext",
      f = u && !s?.supportsLanguage(u) ? vt.dim(u) + aW : "";
  if (!s) return f + e.text + aW;
  return f + s.highlight(e.text, { language: p }) + aW;
}
```

Determined facts:

- **No border.** No box, no rule, no vertical rail.
- **No indentation.** The code is emitted flush-left into the same glued string as the surrounding
  prose. (Block separation comes from the `gap: 1` on `Oaa`'s column.)
- **No line numbers.**
- **Language label: only when the language is *not* recognised.** `f` is non-empty exactly when
  `lang` is present and `supportsLanguage(lang)` is false, and it renders as a **dim line
  containing the raw language string** above the block. A recognised language gets **no label**.
- Language resolution tries the full `lang` string, then its leading `[\w.+#-]+` prefix
  (so ```` ```ts title=foo ```` still resolves `ts`), then falls back to `"plaintext"`.
- Wrapping: the block is inside a `wc` wrapping `<Text>`. There is **no horizontal truncation and
  no per-line clipping** in this path — long lines soft-wrap at the terminal width.
- **No length cap.** Neither `f2` nor `Oaa` truncates a code block. (The 10k cap in §1.4 is on
  *user* messages only.)

Syntax highlighting (`OhH`, line **420468**) runs the vendored highlight.js
(`modules/hljsBundle.generated.min.js`, 985 KB) and maps hljs scopes to chalk styles through
`DhH` (line **420494**), verbatim:

```js
keyword: vt.blue, built_in: vt.cyan, type: vt.cyan.dim, literal: vt.blue,
number: vt.green, regexp: vt.red, string: vt.red, subst: vt.reset, symbol: vt.reset,
class: vt.blue, function: vt.yellow, title: vt.reset, "title.function": vt.yellow,
"title.class": vt.blue, params: vt.reset, comment: vt.green, doctag: vt.green,
meta: vt.grey, "meta-keyword": vt.reset, "meta-string": vt.reset, "meta.keyword": vt.reset,
"meta.string": vt.reset, section: vt.reset, tag: vt.grey, name: vt.blue, attr: vt.cyan,
attribute: vt.reset, variable: vt.reset, bullet: vt.reset, code: vt.reset,
emphasis: vt.italic, strong: vt.bold, link: vt.underline, addition: vt.green, deletion: vt.red
```

Scope lookup walks dotted scopes outward (`PhH`, line 420448 region: strips `.suffix` until a hit).
`highlight()` is called with `ignoreIllegals: true`. Highlighting can be turned off globally
(`syntaxHighlightingDisabled`, line **421123**).

### Our side

`markdown.ts:91-96`:
```ts
if ((m = raw.match(FENCE))) { ...; inFence = !inFence; fenceLang = inFence ? m[1] : undefined; continue; }
if (inFence) {
  if (fenceLang && KNOWN_LANGS.has(fenceLang)) out.push({ text: "  " + raw, segments: [{ text: "  " }, ...highlightCode(raw, fenceLang)] });
  else out.push({ text: "  " + raw, dim: true });
}
```

- We **indent every code line by 2 spaces**; upstream does not indent at all.
- We **never show a language label**; upstream shows one exactly for unrecognised languages —
  our polarity is not just missing, it is the opposite of upstream's (we *hide* the language we
  don't know, upstream *shows* it).
- Unknown language → whole block dim; upstream → plaintext, undimmed, with a dim label line.
- `FENCE = /^```(\w+)?/` — matches only backtick fences, and `\w+` rejects `c++`, `objective-c`,
  `ts title=x`. Tilde fences (`~~~`) are not handled. Upstream's tokenizer handles both and its
  language regex is `[\w.+#-]+`.
- Highlighting is 4 token classes over 10 language aliases (`highlight.ts:14`), against
  highlight.js's full grammar set. Colours also differ: ours is keyword→cyan, number→yellow,
  string→green, comment→dim; upstream is keyword→blue, number→green, string→red, comment→green.
- No length cap on either side, so parity there.

---

## Q4 — Diffs

Three layers. `fbn` (header + body, line **423886**) → `K3e` (hunk list, line **420118**) →
`lre` (one hunk, line 420071) → either the highlighted path (`R2p`, line 420043) or the plain
path (`fWo` → `H2p`, line **419879** / **419887**).

### 4.1 Header

`fbn`, lines 423888–423898:

```js
Sua = gXe > 0 ? <>{"Added "}<Text bold>{gXe}</Text>{" "}{gXe > 1 ? "lines" : "line"}</> : null;
t9p = gXe > 0 && cvr > 0 ? ", " : null;
Aua = cvr > 0 ? <>{gXe === 0 ? "R" : "r"}{"emoved "}<Text bold>{cvr}</Text>{" "}{cvr > 1 ? "lines" : "line"}</> : null;
```

So the header is one line, counts bold: `Added 3 lines, removed 1 line`, or `Removed 2 lines`
when there are no additions (note the capital-R switch). Counts come from
`NHH`/`FHH` (lines 419876–419881) counting `+`/`-` prefixed strings across all hunks.

- `previewHint` (`"/plan to preview"`, line 424069) replaces the whole body when set and the style
  isn't `condensed`.
- `collapsed` → header + `<Bg/>` only, where `Bg` (line **421333**) renders the dim
  `(ctrl+o to expand)` chord hint.
- Body width is `columns - 12` (line 423958).

### 4.2 Hunk separation — no `@@` headers

`K3e` (line **420118**):

```js
return TOe(e.map(s => <Box column><lre patch={s} .../></Box>),
           s => <BT fromLeftEdge><Text dimColor>{"..."}</Text></BT>);
```

Hunks are interspersed with a **dim `...` line**. There is **no `@@ -a,b +c,d @@` header anywhere**
in the rendering path.

### 4.3 Line numbering — absolute, not relative

`H2p` (line **419887**) numbers via `chH` (line **420005**), seeded with `patch.oldStart`:

```js
function chH(e, t) {
  let r = t, ...
  case "nochange": r++, n.push(d); break;
  case "add":      r++, n.push(d); break;
  case "remove": {
    n.push(d); let p = 0;
    while (o[0]?.type === "remove") { r++; ...; n.push(A); p++; }
    r -= p;            // rewind: the following adds restart at the first remove's number
    break;
  }
}
```

So numbers are **absolute file line numbers** (seeded from `structuredPatch[].oldStart`), and a
run of removals borrows numbers and then rewinds, so a paired remove-block and add-block show the
**same numbers**. Gutter width `u = max(maxLineNumber).toString().length + 1` (line 419888).

### 4.4 Line styling — background bands, not foreground colour

`H2p`, lines 419894–419898:

```js
let _ = 2, E = Math.max(1, i - u - 1 - _);
return p3(f, E, "wrap").split("\n").map((T, w) => {
  let x = (w === 0 ? m.toString().padStart(u) : " ".repeat(u)) + " ",
      R = p === "add" ? "+" : p === "remove" ? "-" : " ",
      N = p === "add"    ? (n ? "diffAddedDimmed"   : "diffAdded")
        : p === "remove" ? (n ? "diffRemovedDimmed" : "diffRemoved") : void 0,
      P = Math.max(0, i - D);   // D = gutter + marker + visible width
  return <Box row>
    <BT fromLeftEdge><Text color={o?"text":undefined} backgroundColor={N} dimColor={n||p==="nochange"}>{x}{R}</Text></BT>
    <Text color={o?"text":undefined} backgroundColor={N} dimColor={n}>{T}{" ".repeat(P)}</Text>
  </Box>;
});
```

- Add/remove lines are **full-width background bands** — the row is right-padded with
  `" ".repeat(P)` so the colour runs to the edge of the diff box.
- Theme tokens (line **156475**, light theme): `diffAdded rgb(105,219,124)`,
  `diffRemoved rgb(255,168,180)`, `diffAddedDimmed rgb(199,225,203)`,
  `diffRemovedDimmed rgb(253,210,216)`, `diffAddedWord rgb(47,157,68)`,
  `diffRemovedWord rgb(209,69,75)`.
- Context (`nochange`) lines get **no background** and `dimColor: true`.
- Layout is `<number padded to u> <+|-|space><content>`.
- Content **wraps** (`p3(f, E, "wrap")`) at `width - gutter - 3`; continuation lines get a blank
  number gutter and repeat the band. **No horizontal truncation.**

### 4.5 Word-level intra-line diff

`shH` (line **419906**) pairs each remove with the add at the same offset within a
remove-run/add-run pair, setting `wordDiff` + `matchedLine`. `lhH` (line **419947**) then diffs the
two lines word-wise (`_vs(..., {ignoreCase:false})`) and paints changed words with the
`diffAddedWord` / `diffRemovedWord` backgrounds — **but bails out** (`return null`, falling back
to whole-line banding) when the changed fraction exceeds `ohH = 0.4` (line 420031) or when the
diff is being rendered dimmed.

### 4.6 Context line count

Not set by the renderer. `structuredPatch` arrives pre-built by the Edit/Write tools
(`kdt({filePath, oldContent, newContent, convertTabs:true})`, line 219950); the default context
parameter appears as `r = 3` in `i9p(e, t, r = 3)` (line 419971). Marked as **inference** — I read
the default argument, not a call site that passes it.

### 4.7 Truncation

There is **no line-count truncation** in `fbn`/`K3e`/`H2p`. The only elisions are:
the `...` between hunks, `collapsed` (header only + `(ctrl+o to expand)`), and the
`previewHint` substitution. A collapsed diff is chosen by `aHr(filePath)` (line 424069) —
a per-path predicate, not a size threshold that I traced.

### 4.8 Multi-file edits

`fbn` renders **one file**: it takes a single `filePath` + that file's `structuredPatch`.
Multi-file rendering is per-tool-call, i.e. each Edit/Write tool result renders its own
header + hunks. The turn-level roll-up is a *summary*, not a diff:
`"editing/edited N files"` with an aggregate `<g3 added={B} removed={W}/>` badge
(line **428000**), where the badge is
`<Text color="diffAddedWord" bold>+{n}</Text>` (line **184144**).

### 4.9 Our side

`render.ts:52-78` (`toolDiffLines`):

| aspect | ours |
|---|---|
| header | `` `${name} ${path}` `` with a `● ` gutter (`render.ts:54`). No add/remove counts. |
| numbering | `num(i) = String(i+1).padStart(3)` — **1-based within the `old_string`/`new_string` snippet**, not file-absolute. Documented honestly in `tui-ux.md:264`. |
| hunk separation | single hunk only; no `...` separator. |
| styling | **foreground** colour (`color: tokens.diffRemove` / `diffAdd`, `render.ts:68-69`), theme values `green`/`red` or `blue`/`yellow` (`theme.ts:10-14`). No background bands, no full-width fill. |
| markers | `` `${num} - ${text}` `` / `` `${num} + ${text}` `` — note the **extra space** after the marker; upstream is `<num> <marker><text>` with no gap. |
| context | `CTX = 3` dim numbered lines each side (`render.ts:66-70`) — matches upstream's default 3 by coincidence of value, not mechanism. |
| word diff | absent. |
| wrapping | absent — lines are emitted whole and left to Ink's default; no width budget, no continuation gutter. |
| truncation | `cap = 24` body lines then `` `  … ${n} more lines` `` dim (`render.ts:76-77`) — upstream has no such cap. |
| multi-file | one tool call = one block; same shape as upstream. |
| input | derived from `old_string`/`new_string`/`content` in the **tool_use input** (`render.ts:56-57`), never from a `structuredPatch`. |

---

## Q5 — Thinking blocks

### 5.1 Streaming placeholder

`e8o` (line **422457**):

```js
YyH = Wyt.jsxs(h, { dimColor: !0, italic: !0,
        children: [Wyt.jsx(h, { "aria-hidden": !0, children: "✻ " }), "Thinking…"] });
```

**`✻ Thinking…`**, dim + italic, `✻` = U+273B (`i5` in the symbol table, line 41482). Also used
verbatim for `redacted_thinking` blocks (line **429444**).

### 5.2 The thinking text itself is hidden by default

Dispatcher `Gha`, line **429447**:

```js
case "thinking": {
  if (!V_t && !gre) return null;      // V_t = isTranscriptMode, gre = verbose
  ... <zAr param={W1} isTranscriptMode={V_t} verbose={gre} />
}
```

So in the ordinary transcript, thinking content renders **nothing**. It appears only in
ctrl+o transcript mode or under `--verbose`. This is the single largest behavioural difference
from our implementation.

### 5.3 When it does render

`zAr` (line **422947**), lines 422961–422965:

```js
u8o = <Box minWidth={2}><Text aria-label="thinking:" dimColor italic>{q3r}</Text></Box>;
mca = Y40 ? <km dimColor>{B5p.trim()}</km>
          : <Text dimColor italic>{B5p.trim().replace(/\s+/g, " ")}</Text>;
```

- Gutter glyph `q3r = "∴"` — **`∴`** (THEREFORE), dim + italic, in a `minWidth: 2` box.
  Note this is a *different* glyph from the `✻` used by the streaming placeholder.
- Expanded (transcript/verbose): the thinking text is rendered **through the markdown renderer**
  (`km`), dimmed.
- Collapsed variant (whitespace flattened to a single line, dim italic) exists in the code but is
  unreachable through `Gha` because of the guard above; it is reachable from the transcript-mode
  caller at line **427938**, which passes `isTranscriptMode: true, verbose: true`. So in 2.1.220
  the single-line form appears to be **dead code**. Marked as **inference** — I found only two
  call sites (427938, 429460), both of which force the expanded branch.

### 5.4 Duration display

`"Thinking for X" / "Thought for X"` in the turn-group summary, line **427983**:

```js
let Fe = s ? "Thinking" : "Thought", ge;
...
ge = <Text bold>{ra(Math.max(1000, oe))}</Text>;      // idle case
ge = <q8p baseMs={oe} lastThinkingAtMs={Oe} />;       // live ticking case
Ae.push(<Text>{Fe}{" for "}{ge}</Text>);
```

So: **a duration, not a token count.** Live, it ticks (`q8p`); settled, it is a bold formatted
duration floored at 1000 ms. It is one clause in a comma-joined turn summary alongside
`edited N files +a -b`, `made N scratchpad edits`, `committed <sha>`.

### 5.5 Our side

- `render.ts:98` — every thinking line rendered dim, **always visible**, no glyph, no gutter,
  no markdown, no collapse.
- `liveTurn.ts:134-136` — `✦ Thinking` (U+2726, `K3r` in upstream's table — upstream never uses it
  for thinking) when collapsed, raw dim lines when open. `collapseThinking` (`liveTurn.ts:19,76`)
  collapses on the next block.
- No duration, no `∴` gutter, no `✻ Thinking…` placeholder string, no hidden-by-default rule.

---

## Q6 — Everything else

### 6.1 Todo lists (`TodoWrite`)

**Upstream renders nothing in the transcript.** The tool declares (line **284494**):

```js
userFacingName() { return ""; },
renderToolUseMessage() { return null; },
```

and `call()` writes into app state (`todos[agentId]`). A separate component `col` (line **502904**)
maps that state to task-panel items and itself returns `null`:

```js
function ool(e) {                                    // line 502885
  return e.map(t => ({ id: `todo:${...}`, kind: "todo",
    label: NZe(t.status === "in_progress" ? t.activeForm : t.content),
    startedAt: t.status === "pending" ? void 0 : 0,
    doneAt: t.status === "completed" ? 0 : void 0 }));
}
```

The items go to a **task panel** (toggled by `tengu_toggle_todos` / `todo_toggle_panel`,
line **499015**), which is chrome, not transcript. Note `in_progress` items use the todo's
`activeForm` string, not `content`.

Ours: `taskList.ts` / `TaskPanel.tsx` exist; nothing in `render.ts` emits todo lines. **Not a gap
for transcript parity** — but worth confirming our panel uses `activeForm` for in-progress rows.

### 6.2 Image attachments

`a4t` (line **425247**):

```js
Bda = qbn ? `[Image #${qbn}]` : "[Image]";
ZbH = Uda && mI() ? <Ro url={pathToFileURL(Uda).href}><Text>{Bda}</Text></Ro>
                  : <Text>{Bda}</Text>;
Gda = $da ? <Text dimColor>{" "}{$da}</Text> : null;
```

So: **`[Image #3]`**, OSC-8-hyperlinked to the stored file when the terminal supports it, followed
by a dim image description if one has been generated. Rendered inside a `Cr` (the `⎿` connector)
unless it begins a user turn.

MCP image results render as the literal `[Image]` (line 420886 region, `uHn`).

Ours: no image handling anywhere in `render.ts` / `replay.ts`.

### 6.3 File / bash / command attachments in user messages

`ERe` (line **426424**) routes a dozen sentinel-tagged user texts to dedicated renderers before
falling through to the plain prompt echo:

| sentinel | component | line |
|---|---|---|
| `<bash-stdout` / `<bash-stderr` | `pqo` | 426455 |
| `<local-command-stdout` / `<local-command-stderr` | `Sqo` | 426466 |
| `<bash-input>` | `T3t` | 426484 |
| `<command-message>` (`bT`) | `fqo` | 426492 |
| `<user-memory-input>` | `Aqo` | 426500 |
| `<task-notification` (`Iy`) | `Rvr` | 426508 |
| `<mcp-resource-update` / `<mcp-polling-update` | `Pqo` | 426516 |
| `<fork-boilerplate>` | `UserForkBoilerplateMessage` | 426524 |
| `<local-command-caveat>` (`bGe`) | **returns `null`** — never shown | 426452 |
| `[Request interrupted…]` | `BP` | 426473 |

Tag constants at line **17765**. MCP resource updates render as
`↻ <server>: <target> · <reason>` with a `success`-coloured `↻` (line **426182**).

Ours: `sessions/rows.ts` classifies `command_echo` / `caveat` / `command_output` for replay
(`replay.ts:22,37`) but the live path (`render.ts:106`) renders **all** user text blocks as
`› …` including bash/command/memory sentinels.

### 6.4 Compact / context boundary

`XWo` (line **422247**). Two shapes:

**Without metadata** (lines 422287–422297) — `⏺` bullet in `color:"text"` +
bold **`Compact summary`** + a dim `(ctrl+o to expand)` chord hint, and in transcript mode the
full summary text inside a `⎿` block.

**With `summarizeMetadata`** (lines 422256–422274) — `⏺` + bold **`Summarized conversation`**,
then a `⎿` block:
```
Summarized {N} messages {direction === "up_to" ? "up to this point" : "from this point"}
Context: “{userContext}”
(ctrl+o to expand)
```

Ours: `useChat.ts:177` — `notice("─── context compacted ───")` on a
`system`/`compact_boundary` frame; `replay.ts:38` — `divider("context compacted earlier")`.
Divergent glyph, wording, and structure; no message count, no summary body, no expand affordance.

### 6.5 System messages

Generic renderer `Sha` (line **428607**):

```js
Xma = dqp && <Box minWidth={2}><Text aria-hidden color={zEn} dimColor={KEn}>{Za}</Text></Box>;
const fqp = RX0 - 10;
Qma = <Text color={zEn} dimColor={KEn} wrap="wrap">{uqp.trim()}</Text>;
YAH = <Box row marginTop={pqp} width="100%">{Xma}<Box column width={fqp}>{Qma}</Box></Box>;
```

`⏺ <content>` in a caller-chosen colour, wrapped at **terminal width − 10**, **plain text, not
markdown**. The dot is optional.

`dVo` (line **428358**) dispatches by `subtype`. Determined subtypes and their treatment:

| subtype | rendering | line |
|---|---|---|
| `turn_duration` | `Aha` — duration + budget + `N messages hidden (/focus to show)` footer; suppressed entirely when `showTurnDuration` is off and there is no budget/hidden count | 428650 |
| `memory_saved` | `vha` | 428370 |
| `away_summary` | `z3t` | 428379 |
| `agents_killed` | `⏺`(error colour) + dim `All background agents stopped` | 428388 |
| `thinking` | `null` | 428397 |
| `model_refusal_no_fallback` | `null` | 428399 |
| `model_refusal_fallback` | `⏺`(warning) + bold warning content + `⎿  Tip: You can configure model switch behavior in /config` | 428406–428416 |
| `model_fallback` | `⏺`(warning) + warning content, bold when trigger is `model_not_found` / `permission_denied` | 428427 |
| `bridge_status` / `scheduled_task_fire` / `permission_retry` / `api_error` / `stop_hook_summary` | dedicated branches | 428446–428501 |

Hook feedback lines use the `⎿` gutter directly, e.g.
`⎿  Ran 3 PreToolUse hooks (120ms)` then `     ⎿ <command> (40ms)` (lines **427942**, **428343–428349**).

Ours: `useChat.ts:177,193` handles `compact_boundary` and reads `subtype` for a few task
notices; the rest are unhandled. `render.ts:111` returns `[]` for anything that is not
`assistant` or `user`.

### 6.6 Error messages in an assistant text block

`VAr` special-cases a fixed set of sentinel texts before the normal path (lines 422726–422820):

| sentinel | rendering |
|---|---|
| `XG` (context limit) | error: `Context limit reached · /compact or /clear to continue[ · <warning>]` |
| `PYr` | error: `Credit balance too low · Add funds: https://platform.claude.com/settings/billing` |
| `ect` | error: content + ` (API_TIMEOUT_MS=…ms, try increasing it)` when that env var is set |
| `Qlt` / `Zlt` | error: `We are experiencing high demand for Opus 4.` / `… Fable 5.` + a `/model` suggestion |
| `wq` = `"API Error: Request was aborted."` | `<BP/>` — the `⎿ Interrupted · …` line |
| starts with `${XG} · ` | error: content + ` · /clear to start fresh` |
| rate-limit texts (`Dcs`) | `l8o` — error/warning colour + an upgrade/overage nudge line |

All of these are wrapped in `Cr` (the `⎿` gutter) with `height: 1`.

Ours: none. `render.ts:82-89` (`resultLines`) is the only error surface, keyed on
`tool_result.is_error`, rendering `  ⎿ ✗ <line>` red, capped at 12 lines, each truncated to 100
chars. Upstream never truncates result lines this way in the text path.

### 6.7 Sub-agent / teammate attribution

Three components in the `uqo` module (line 425444 onward):

- `Cvr` (line **425444**) — a live teammate message:
  `@ <displayName>❯` in the teammate's assigned ink colour (`Ge.pointer` = `❯`), an optional
  summary on the same line, then the content rendered through `km` with `paddingLeft: 2`.
- `Ivr` (line **425477**) — collapsed: dim `› N messages from @<name> (ctrl+o to expand)`
  (`Ge.pointerSmall` = `›`).
- `xvr` (line **425495**) — lifecycle: `⏺ Teammate @<name> finished` / `failed` /
  `was interrupted`, bullet coloured `success` / `error` / `warning`, plus `: <reason>` dim.

Per-agent colours are the `*_FOR_SUBAGENTS_ONLY` theme tokens (line **156475**):
`red rgb(220,38,38)`, `blue rgb(106,155,204)`, `green rgb(22,163,74)`, `yellow rgb(202,138,4)`,
`purple rgb(130,125,189)`, `orange rgb(217,119,87)`, `pink rgb(196,102,134)`,
`cyan rgb(8,145,178)`.

Also a "viewing agent" chrome line: `Viewing @<agentName> · <esc to return>` (line **502945**).

Ours: `replay.ts:42-46` indents + dims messages carrying `parent_tool_use_id` and strips the
gutter. No name, no colour, no `@`, no lifecycle line. `tui-ux.md:366` scores dialog attribution
🟡; transcript attribution is not scored.

### 6.8 Session-resume dividers

**Not determined.** I searched for `Resumed`, `Resuming`, `Continued from`, `Previous session`,
`conversation history`, and `Continuing` and found no transcript-divider renderer. The closest
hits are log strings and prompt text, not UI. Two readings are possible — either resume replays
the messages with no divider at all, or the divider lives behind a string I did not guess. I am
not going to fill this in.

Ours: `replay.ts:18,33,49` — `─── resumed: <label> · N turns · HH:MM ───` and
`─── resumed here · live ───`, plus `… N earlier messages elided`.

### 6.9 Message timestamps

`Mqo` passes `timestamp` through and `xqo` renders `MHn(timestamp)` dim next to a `You` label —
**only in "brief layout"** (`useBriefLayout`, gated on `CLAUDE_CODE_BRIEF` or the
`tengu_kairos_brief` flag, line **426139**). In the normal layout the timestamp is dropped.
`tui-ux.md:280` says "off by default in CC" — confirmed, with the brief-mode caveat.

---

## Gap table

Effort: S ≈ under half a day, M ≈ 1–2 days, L ≈ 3+ days or a dependency decision.

| # | Upstream behaviour | Our behaviour | Class | Effort | Needs probe? |
|---|---|---|---|---|---|
| 1 | Assistant bullet is `⏺` (U+23FA) on macOS, `●` elsewhere (41484) | always `●` (`render.ts:23`) | divergent | S | no |
| 2 | Bullet colour is the plain `text` token (422857) | `ACCENT` `#d97757` (`render.ts:23`, `theme.ts:26`) | divergent | S | no |
| 3 | User prompt echo is `❯ ` in `subtle` on a `userMessageBackground` band with `paddingRight:1` (426066, 426170) | `› ` dim, no band (`render.ts:106`) | divergent | M | no |
| 4 | User prompts > 10k chars fold to head/`(N lines hidden)` rule/tail (426146) | no truncation | missing | S | no |
| 5 | Queued messages indent 2 cols, dim in brief mode (426002) | not rendered | missing | S | needs probe — does the SDK surface a queued-message state to the host? |
| 6 | `[Request interrupted by user]` → `⎿ Interrupted · What should Claude do instead?` (422222) | not rendered | missing | S | no |
| 7 | Markdown is `marked`-based with the full token set | line-oriented regex (`markdown.ts`) | divergent | L | no |
| 8 | Heading depth 1 → bold+italic+underline, ≥2 → bold; blank line after (420613) | all bold, no trailing blank (`markdown.ts:51`) | partial | S | no |
| 9 | Unordered list marker is `-` (420672) | `• ` (`markdown.ts:53`) | divergent | S | no |
| 10 | Nested lists indent `2×depth`; ordered numbering `1.`/`a.`/`i.` by depth (420651, 420826) | no nesting, arabic only (`markdown.ts:54`) | missing | M | no |
| 11 | Task lists → literal `[x] ` / `[ ] ` (420672) | not handled | missing | S | no |
| 12 | Blockquote: `▎` dim rail via a `quote` border + italic content (421181, 179535) | `│ ` prefix, dim, not italic (`markdown.ts:52`) | divergent | S | no |
| 13 | `hr` → literal `"---"` (420617) | falls through as prose (`markdown.ts:55`) | partial | S | no |
| 14 | Links: OSC-8 hyperlink, blue/blueBright text, `text (url)` fallback (393098) | markdown emitted verbatim | missing | M | no |
| 15 | Images: `alt (href "title")`, or bare href (420619) | not handled | missing | S | no |
| 16 | `del` → strikethrough on capable terminals, `~~x~~` otherwise (420610, 420493) | not handled | missing | S | no |
| 17 | Inline code coloured `permission` `rgb(87,105,247)` (420604) | `cyan` (`markdown.ts:30`) | divergent | S | no |
| 18 | Inline emphasis nests (marked inline lexer) | single-level regex, `[^*]+`/`[^_]+` (`markdown.ts:14`) | partial | M | no |
| 19 | Tables: `┌┬┐/├┼┤/└┴┘` box, centred header, per-column alignment + width fitting, `middle` rule between rows, 200-row cap with `… N more rows not shown`, vertical fallback (420907, 421019) | padded text, `│` separators, one `─` under the header (`markdown.ts:71`) | partial | L | no |
| 20 | Top-level blocks separated by `gap: 1` (421157) | no block separation | missing | S | no |
| 21 | Streaming re-opens an unterminated fence for the tail (421263) | live streaming has no fence-awareness (`liveTurn.ts`) | missing | M | no |
| 22 | Code blocks: no border, no indent, no line numbers (420598) | 2-space indent (`markdown.ts:93-94`) | divergent | S | no |
| 23 | Language label shown **only for unrecognised** languages, dim, above the block (420601) | never shown | divergent | S | no |
| 24 | Unknown language → plaintext, not dimmed (420601) | whole block dim (`markdown.ts:94`) | divergent | S | no |
| 25 | Fence regex `[\w.+#-]+` on `lang`, prefix fallback, tilde fences (420599, 420564) | `` /^```(\w+)?/ `` only (`markdown.ts:11`) | partial | S | no |
| 26 | highlight.js full grammar set, 30-scope colour map (420468, 420494) | 4 classes, 10 aliases, different colours (`highlight.ts`) | partial | L | no — decision, not evidence |
| 27 | Diff header `Added N lines, removed M lines` with bold counts (423888) | `Name path` with `● ` (`render.ts:54`) | missing | S | no |
| 28 | Hunks separated by a dim `...` (420118); no `@@` headers | single hunk | partial | M | needs probe — does the SDK deliver `structuredPatch` on the Edit/Write result? |
| 29 | Line numbers are absolute file lines from `oldStart`, with remove-run rewind (420005) | 1-based within the snippet (`render.ts:65`) | divergent | M | needs probe — same as #28; without `structuredPatch`/`originalFile` this is unreachable |
| 30 | Add/remove rendered as full-width **background** bands using `diffAdded`/`diffRemoved` (419898) | foreground colour only (`render.ts:68-69`) | divergent | S | no |
| 31 | Word-level intra-line diff with `diffAddedWord`/`diffRemovedWord`, bailing above 40% change (419947, 420031) | absent | missing | M | no |
| 32 | Diff lines wrap at `width - gutter - 3` with a blank continuation gutter (419894) | no width budget (`render.ts:67-70`) | missing | M | no |
| 33 | No line cap on diffs; only collapse + `(ctrl+o to expand)` (423918) | hard `cap = 24` + `… N more lines` (`render.ts:76`) | divergent | S | no |
| 34 | Thinking content **hidden** unless transcript mode or `--verbose` (429448) | always shown (`render.ts:98`) | divergent | S | no |
| 35 | Streaming placeholder `✻ Thinking…` dim+italic (422462) | `✦ Thinking` when collapsed (`liveTurn.ts:135`) | divergent | S | no |
| 36 | Expanded thinking uses a `∴` dim-italic gutter and renders through the markdown renderer (422961) | raw dim lines, no gutter, no markdown (`render.ts:98`) | partial | S | no |
| 37 | `Thinking for X` / `Thought for X` duration in the turn summary, live-ticking (427983) | absent | missing | M | needs probe — is a per-thinking-block timestamp/duration available from the SDK stream? |
| 38 | TodoWrite renders **nothing** in the transcript; todos go to a task panel using `activeForm` for in-progress (284494, 502885) | nothing in `render.ts`; panel exists | not applicable | — | no |
| 39 | Image attachments → `[Image #N]`, OSC-8-linked to the stored file, dim description (425247) | not handled | missing | M | needs probe — does the SDK expose stored image paths / descriptions to the host? |
| 40 | Ten sentinel-tagged user texts route to dedicated renderers; `<local-command-caveat>` is dropped (426424) | all user text → `› …` (`render.ts:106`); only replay classifies some (`replay.ts:22`) | partial | M | no |
| 41 | Compact boundary → `⏺ Compact summary (ctrl+o to expand)` or `⏺ Summarized conversation` + `⎿ Summarized N messages up to this point` + `Context: “…”` (422247) | `─── context compacted ───` (`useChat.ts:177`) | divergent | S | needs probe — does `compact_boundary` carry `compact_metadata` with a message count? |
| 42 | ~12 `system` subtypes with distinct glyph/colour/wording; generic form is `⏺ <content>` wrapped at `columns-10`, plain text (428358, 428607) | most unhandled (`render.ts:111`) | partial | M | no |
| 43 | Assistant-text error sentinels (context limit, credit balance, timeout, high demand, aborted) each get bespoke text inside `⎿` (422726) | none | missing | M | needs probe — does the SDK pass these sentinel strings through as assistant text? |
| 44 | Teammate attribution: `@ <name>❯` in a per-agent colour, `› N messages from @<name>`, `⏺ Teammate @<name> finished` (425444) | indent + dim only (`replay.ts:42`) | partial | M | needs probe — does the SDK expose a subagent name/colour per nested message, beyond `parent_tool_use_id`? |
| 45 | Session-resume divider — **not determined** | `─── resumed: … ───` (`replay.ts:18`) | not determined | — | no |
| 46 | Timestamps only in brief layout (426139) | none | not applicable | — | no |
| 47 | `⎿` gutter is `"  ⎿ \xA0"` = 5 columns (406895) | `"  ⎿ "` = 4 columns (`render.ts:87-88`) | divergent | S | no |
| 48 | Tool-result text is not line-truncated in the text path | 12 lines × 100 chars (`render.ts:86-88`) | divergent | S | no |

**Counts:** 48 rows — **missing 15**, **partial 12**, **divergent 17**, **not applicable 3**,
**not determined 1**. **Needs a probe: 9** (rows 5, 28, 29, 37, 39, 41, 43, 44 — eight rows, with
28/29 sharing one probe, so seven distinct probes).

### The seven probes, stated precisely

1. **`structuredPatch` reachability** (rows 28, 29, 32). Does the Claude Agent SDK's user
   message for an Edit/Write tool result carry `toolUseResult` with `structuredPatch`,
   `originalFile`, and `oldStart`? If not, absolute line numbers, real hunks, and the `...`
   separator are all out of reach and rows 28/29/32 collapse to "not applicable".
2. **Queued-message state** (row 5).
3. **Thinking timing** (row 37). Is there a per-block timestamp on the thinking stream events?
4. **Stored image paths / descriptions** (row 39).
5. **`compact_boundary` metadata** (row 41). Does `compact_metadata` include a summarised-message
   count and direction?
6. **Error sentinel passthrough** (row 43). Do context-limit / credit / abort conditions arrive as
   assistant text blocks with those exact strings, or as SDK error objects?
7. **Subagent identity** (row 44). Is there a name or type on nested messages beyond
   `parent_tool_use_id`?

---

## Corrections to `docs/parity/tui-ux.md` §2

| current claim | correction |
|---|---|
| `User prompt echo · 🟡 · "CC uses \`>\`"` (line 255) | CC uses **`❯ `** (U+276F) in the `subtle` colour on a `userMessageBackground` band. Not `>`. |
| `Assistant message identity (● bullet, accent) · ✅` (line 256) | Bullet is `⏺` on macOS and its colour is `text`, **not** an accent. Two divergences under a ✅. |
| `Thinking blocks (stream + collapse) · ✅ · "CC ✻/token count"` (line 257) | CC shows a **duration**, not a token count; the streaming glyph is `✻` but the content gutter is `∴`; and the content is **hidden by default**. |
| `Markdown: headers/lists/quote/fenced · ✅` (line 260) | No links, no images, no strikethrough, no `hr`, no task lists, no nested lists, no depth-varying heading style, no block separation. This is not a ✅. |
| `Markdown: tables · ✅` (line 262) | Upstream draws a box table with alignment, width fitting, a row cap and a vertical fallback. Ours is padded text. |
| `Edit/Write diff · ✅` (line 264) | Honest about hunk-relative numbering, but silent on: no add/remove counts header, foreground instead of background bands, no word diff, no wrapping, and a 24-line cap upstream does not have. |
| `Compact boundary marker · ✅` (line 267) | Upstream renders a bulleted `Compact summary` with a message count and an expand affordance, not a rule. |

---

## Confidence and gaps

**High confidence** (read directly, quoted above, line-cited): the markdown token switch and every
node type; the table renderer including its fallback; the code-block rule and the hljs scope map;
the whole diff pipeline (numbering, banding, wrapping, word diff, hunk separator, header); the
thinking components and the hidden-by-default guard; the assistant/user identity components and
their theme tokens; the `⎿` connector; interrupt, compact-summary, image, teammate, and generic
system-message renderers; `ink-link` and the OSC-8 emission path.

**Marked inferences, with the fragment they rest on:**

- Diff context = 3 lines. Read off the default parameter `i9p(e, t, r = 3)` at line 419971, not
  off a call site.
- The single-line collapsed thinking form is dead code. Both call sites I found (427938, 429460)
  force the expanded branch; I did not exhaustively prove there is no third caller.
- `⏺` vs `●`: I read the ternary `Pt() === "macos"` at 41484 but did not verify `Pt()`'s return
  values against the platform table.

**Not determined, and deliberately left blank:**

- Session-resume dividers (§6.8). No renderer found under six different search strings.
- The predicate `aHr(filePath)` that decides whether a diff starts collapsed (§4.7). I traced the
  call site, not the function.
- Whether `Oaa`'s glued-string path imposes any upper bound on very long assistant text. I found
  no truncation, but I did not read `wc`'s implementation, so "unbounded" is an absence-of-evidence
  claim rather than a positive one.
- The exact `previewHint` trigger condition (`s ?` at line 424069).

**Scope boundary honoured:** tool-call rows, tool-result bodies, permission dialogs, and the
task/todo panel are outside this brief. They are mentioned only where they collide with transcript
rendering (the `⎿` connector, the TodoWrite null-render, and the tool-result truncation in
`render.ts:82-89`).
