# F4 constants pack — verbatim bundle extracts for transcript rendering

Source: `~/claude-code-bundle/2.1.220/cli.pretty.js` (579,698 lines). Every quote below is
**verbatim** from that file at the stated line numbers, read with `sed -n '<a>,<b>p'`.
This file exists so implementers cite it instead of re-opening the bundle.

Companion: [`02-transcript.md`](02-transcript.md) — the narrative census. Where this pack
disagrees with it, the disagreement is marked **⚠ CENSUS CONTRADICTION** and both readings are
stated. **No contradictions were silently reconciled.**

Escaping note: the bundle is pretty-printed but still uses `\uXXXX` / `\xXX` escapes inside string
literals. Quotes preserve those escapes exactly; the glyph is named in the interpretation line.

Shared helpers referenced throughout (each read directly):

| helper | line | body |
|---|---|---|
| `Ci(e)` | 76620 | `return Bun.stripANSI(e)` — strip ANSI |
| `Ut(e)` | 106884 | `return Bun.stringWidth(e, cRg)` with `cRg = { ambiguousIsNarrow: !0 }` (106888) — visible width |
| `nI(e)` | 107213 | strips memory-tag markup, else identity |
| `au(e, t, r = 0)` | 15190 | counts occurrences of `t` in `e` from index `r` |
| `Et(e, t, r = t + "s")` | 15084 | `return e === 1 ? t : r` — pluralize |
| `p3(e, t, r = "wrap")` | 174933 | width-aware wrap |
| `JB(e, t, r)` | 106890 | the underlying wrap primitive |

---

## 1. Markdown node switch (`f2`)

`f2` is the marked-token → ANSI-string renderer. Signature and destructure, lines **420590–420592**:

```js
420590    function f2(e, t, r = {}) {
420591      let { listDepth: n = 0, orderedListNumber: o = null, parent: i = null, highlight: s = null, glueProse: a = !1, screenReader: l = !1 } = r, c = r.linkCap ?? mI();
420592      switch (e.type) {
```

`t` is the theme name, `n` is list depth, `o` is the ordered-list number, `i` is the parent token,
`s` is the highlighter, `c` is the hyperlink capability.

### 1.1 `aW` — the newline constant

Line **420866–420867** (a template literal that spans the line break):

```js
420866    var pHn, dBp, aW = `
420867  `, pBp, $hH, Aaa, gAr, fBp = (e) => Array.from(e).filter((t) => {
```

**`aW === "\n"`** — a single newline. Every "trailing newline count" below is a count of `aW`.

### 1.2 `heading` — style per depth, TWO trailing newlines

Lines **420613–420616**:

```js
420613        case "heading": {
420614          let u = (e.tokens ?? []).map((p) => f2(p, t, { listDepth: 0, orderedListNumber: null, parent: null, highlight: s, glueProse: !1, linkCap: c })).join("");
420615          return (e.depth === 1 ? vt.bold.italic.underline : vt.bold)(yAr(u)) + aW + aW;
420616        }
```

Depth 1 → `vt.bold.italic.underline`; **every other depth** (2, 3, 4, 5, 6) → `vt.bold`. There is no
per-depth gradation beyond the depth-1 special case. Trailing newline count is **exactly two**
(`aW + aW`), i.e. the heading is followed by one blank line inside the glued string — on top of the
`gap: 1` that `Oaa` puts between blocks (§2.4).

⚠ **CENSUS CONTRADICTION (line cite only).** Census §2.1 cites `420613–420616` for heading — correct.
No semantic disagreement.

### 1.3 `hr` — the literal

Lines **420617–420618**:

```js
420617        case "hr":
420618          return "---";
```

Three ASCII hyphens, no styling, **no trailing newline**. Not a box-drawing rule.

### 1.4 `list` and `list_item` — the indent expression

Lines **420646–420654**:

```js
420646        case "list":
420647          return e.items.map((u, d) => f2(u, t, { listDepth: n, orderedListNumber: e.ordered ? e.start + d : null, parent: e, highlight: s, glueProse: !1, linkCap: c, screenReader: l })).join("");
420648        case "list_item":
420649          return (e.tokens ?? []).map((u) => {
420650            let d = f2(u, t, { listDepth: n + 1, orderedListNumber: o, parent: e, highlight: s, glueProse: !1, linkCap: c, screenReader: l });
420651            if (u.type === "code" || u.type === "blockquote" || u.type === "hr" || u.type === "table")
420652              return d;
420653            return `${"  ".repeat(n)}${d}`;
420654          }).join("");
```

The indent expression is **`"  ".repeat(n)`** where `n` is the list_item's *own* incoming
`listDepth` — children are rendered at `n + 1` but the prefix uses `n`. So a top-level item
(`n === 0`) gets **zero** indent; the marker itself is the only left decoration. `code`,
`blockquote`, `hr` and `table` children are exempt from the indent.

Ordered numbering seed: `e.ordered ? e.start + d : null` — honours the markdown `start` attribute.

⚠ **CENSUS CONTRADICTION (line cite).** Census §2.1 cites `420651–420657` for `list_item`; the actual
range is **420648–420654**. The mechanic the census describes is correct.

### 1.5 `text` inside a list item — markers and the task checkbox

Lines **420661–420668**:

```js
420661        case "text":
420662          if (i?.type === "link")
420663            return e.text;
420664          if (i?.type === "list_item") {
420665            let u = e.tokens ? yAr(e.tokens.map((m) => f2(m, t, { listDepth: n, orderedListNumber: o, parent: e, highlight: s, glueProse: !0, linkCap: c })).join("")) : uBp(vaa(Taa(e.text, t, c), t, c, i)), d = o === null ? "-" : `${JhH(n, o)}.`, p = i.tokens?.[0] === e, f = i.task && p ? `[${i.checked ? "x" : " "}] ` : "";
420666            return `${d} ${f}${u}${aW}`;
420667          }
420668          return a ? uBp(vaa(Taa(e.text, t, c), t, c, i)) : vaa(Taa(e.text, t, c), t, c, i);
```

- Unordered marker: the literal **`"-"`** (`d = o === null ? "-" : ...`). Not a bullet glyph.
- Ordered marker: **`` `${JhH(n, o)}.` ``** — the depth-numbered token plus a period.
- Assembly: **`` `${marker} ${checkbox}${content}\n` ``** — exactly one space after the marker.
- Task checkbox literal: **`` `[${i.checked ? "x" : " "}] ` ``** — i.e. `"[x] "` or `"[ ] "` (note
  the trailing space is inside the template). It is emitted **only on the first token of the
  list_item** (`p = i.tokens?.[0] === e`).

⚠ **CENSUS CONTRADICTION (line cite).** Census §2.1 cites `420672` for both the marker and the task
list; the actual line is **420665** (assembly at 420666).

### 1.6 Depth numbering — `JhH`, `KhH`, `XhH`, `YhH` VERBATIM

`KhH` — base-26 letters, lines **420810–420815**:

```js
420810    function KhH(e) {
420811      let t = "";
420812      while (e > 0)
420813        e--, t = String.fromCharCode(97 + e % 26) + t, e = Math.floor(e / 26);
420814      return t;
420815    }
```

Bijective base-26 lowercase (`1→a`, `26→z`, `27→aa`). The `e--` before the modulo is what makes it
bijective rather than plain base-26.

`XhH` — roman numerals, lines **420816–420822**:

```js
420816    function XhH(e) {
420817      let t = "";
420818      for (let [r, n] of YhH)
420819        while (e >= r)
420820          t += n, e -= r;
420821      return t;
420822    }
```

`YhH` — the roman value table, line **420892**:

```js
420892      YhH = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
```

Standard subtractive table, **lowercase**, greedy descending.

`JhH` — the depth dispatcher, lines **420826–420838**:

```js
420826    function JhH(e, t) {
420827      switch (e) {
420828        case 0:
420829        case 1:
420830          return t.toString();
420831        case 2:
420832          return KhH(t);
420833        case 3:
420834          return XhH(t);
420835        default:
420836          return t.toString();
420837      }
420838    }
```

`e` is `listDepth`, `t` is the number. Depth 0 and 1 → arabic; depth 2 → letters; depth 3 → roman;
**depth 4 and deeper → arabic again** (the `default`). Census §2.1 states this correctly.

Related: `uBp` (line **420823–420825**) hard-spaces numeric-looking runs so marked doesn't re-lex them:

```js
420823    function uBp(e) {
420824      return e.replace(/ (\d{1,9}[.)])(?!\w)/g, "\xA0$1");
420825    }
```

### 1.7 `del` / strikethrough — `dHn` terminal allowlist VERBATIM

The `del` case, lines **420609–420612**:

```js
420609        case "del": {
420610          let u = (e.tokens ?? []).map((d) => f2(d, t, { listDepth: 0, orderedListNumber: null, parent: i, highlight: s, glueProse: a, linkCap: c })).join("");
420611          return dHn() && vt.level > 0 ? vt.strikethrough(u) : `~~${u}~~`;
420612        }
```

`dHn`, lines **420498–420509**:

```js
420498    function dHn() {
420499      if (Z.CLAUDE_CODE_FORCE_STRIKETHROUGH)
420500        return !0;
420501      let e = Z.TERM;
420502      if (Z.TERM_PROGRAM === "Apple_Terminal" || e === "linux")
420503        return !1;
420504      return UhH.has(Z.TERM_PROGRAM ?? "") || jG.isGhostty() || jG.isMintty() || jG.isJetBrainsIdeTerminal() || Z.LC_TERMINAL === "iTerm2" || !!e?.includes("kitty") || !!e?.includes("alacritty") || !!e?.startsWith("foot") || !!Z.KITTY_WINDOW_ID || !!Z.ALACRITTY_LOG || !!Z.KONSOLE_VERSION || !!Z.WT_SESSION || !!Z.ZED_TERM || parseInt(Z.VTE_VERSION ?? "", 10) >= 4400;
420505    }
420506    var UhH, Saa = b(() => {
420507      Ar();
420508      fqe();
420509      UhH = new Set(["iTerm.app", "vscode", "WezTerm", "WarpTerminal", "Hyper", "Tabby", "rio", "contour", "alacritty"]);
420510    });
```

The `TERM_PROGRAM` allowlist set (`UhH`, line 420509) is exactly:
`iTerm.app`, `vscode`, `WezTerm`, `WarpTerminal`, `Hyper`, `Tabby`, `rio`, `contour`, `alacritty`.

⚠ **CENSUS CONTRADICTION (three omissions).**
1. Census cites `dHn` at **420493**; the definition is at **420498** (420493 is inside the
   `hAr` module init that defines the hljs scope map).
2. Census omits the `CLAUDE_CODE_FORCE_STRIKETHROUGH` env override, which short-circuits **before**
   the Apple_Terminal / `linux` exclusion — so those two can be forced on.
3. Census omits the second half of the render condition: **`dHn() && vt.level > 0`**. Even on an
   allowlisted terminal, strikethrough falls back to literal `~~u~~` when chalk's colour level is 0
   (no-colour / piped output).

### 1.8 `codespan` — theme token

Lines **420603–420604**:

```js
420603        case "codespan":
420604          return to("permission", t)(e.text);
```

The theme token is **`permission`**. Its light-theme value (line 156475) is
`permission: "rgb(87,105,247)"`. Other themes: `"ansi:blue"` (light-ansi), `"ansi:blueBright"`
(dark-ansi), `"rgb(51,102,255)"` (light-daltonized), `"rgb(177,185,249)"` (dark).

### 1.9 `image` — all three forms VERBATIM

Lines **420619–420624**:

```js
420619        case "image": {
420620          if (!e.text && !e.title)
420621            return e.href;
420622          let u = e.text ? `${e.text} ` : "", d = e.title ? ` "${e.title}"` : "";
420623          return `${u}(${e.href}${d})`;
420624        }
```

Three reachable forms:
1. no alt **and** no title → the bare `href`.
2. alt, no title → `` `${alt} (${href})` `` (note: `u` carries its own trailing space).
3. title present → `` `${alt-or-empty}(${href} "${title}")` `` — when alt is empty this collapses to
   `` `(${href} "${title}")` `` with **no leading space**.

Never an OSC-8 hyperlink; never a `⧉` marker. (Image *attachments* in user turns are a different
renderer, `a4t` at 425247, outside this section.)

### 1.10 Other cases, for completeness

```js
420593        case "blockquote": {            → §3
420597        case "code": {                  → §5
420605        case "em":                      vt.italic(...)
420607        case "strong":                  vt.bold(...)
420625        case "link": {                  (unchanged from census §2.2)
420655        case "paragraph":               yAr(children) + aW          (ONE newline)
420657        case "space":                   return aW;
420659        case "br":                      return aW;
420669        case "table": {                 → §4.7
420698        case "escape":                  return e.text;
420700        case "html":                    return e.text;
420702        case "def":                     return "";
420705      return e.raw;                     (fallthrough for unknown types)
```

⚠ **CENSUS CONTRADICTION (hljs scope map, minor).** Census §Q3 reproduces `DhH` (line **420495**) as
"verbatim" but **drops one entry**: `quote: vt.reset`, which sits between `link: vt.underline` and
`addition: vt.green`. The bundle line is:

```js
420495      DhH = new Map(Object.entries({ keyword: vt.blue, built_in: vt.cyan, type: vt.cyan.dim, literal: vt.blue, number: vt.green, regexp: vt.red, string: vt.red, subst: vt.reset, symbol: vt.reset, class: vt.blue, function: vt.yellow, title: vt.reset, "title.function": vt.yellow, "title.class": vt.blue, params: vt.reset, comment: vt.green, doctag: vt.green, meta: vt.grey, "meta-keyword": vt.reset, "meta-string": vt.reset, "meta.keyword": vt.reset, "meta.string": vt.reset, section: vt.reset, tag: vt.grey, name: vt.blue, attr: vt.cyan, attribute: vt.reset, variable: vt.reset, bullet: vt.reset, code: vt.reset, emphasis: vt.italic, strong: vt.bold, link: vt.underline, quote: vt.reset, addition: vt.green, deletion: vt.red }));
```

That is **35** entries, not 34.

---

## 2. Fast path + token cache

### 2.1 `WBp` — the 500-char probe

Lines **421105–421120**:

```js
421105    function WBp(e, t = !0) {
421106      if (!hgH.test(e.length > 500 ? e.slice(0, 500) : e))
421107        return [{ type: "paragraph", raw: e, text: e, tokens: [{ type: "text", raw: e, text: e }] }];
421108      if (!t)
421109        return $_.lexer(e);
421110      let r = iLl(e), n = N3t.get(r);
421111      if (n)
421112        return N3t.delete(r), N3t.set(r, n), n;
421113      let o = $_.lexer(e);
421114      if (N3t.size >= mgH) {
421115        let i = N3t.keys().next().value;
421116        if (i !== void 0)
421117          N3t.delete(i);
421118      }
421119      return N3t.set(r, o), o;
421120    }
```

- The **500** is a literal inline on line 421106, not a named constant. Only the **first 500
  characters** are probed; a document whose only markdown appears after char 500 is misclassified as
  plain prose and rendered as one paragraph token.
- `t` is `!skipTokenCache`. When false the lexer runs uncached (used by the streaming path).
- The LRU is a plain `Map` (`N3t`, initialised line 421280) with delete-then-set for recency and
  `keys().next().value` for eviction.

### 2.2 `hgH` — the fast-path regex VERBATIM

Line **421280** (tail of the module-init assignment):

```js
421280      F3t = C(ot(), 1), HM = C(ue(), 1), OWo = C(_e(), 1), N3t = new Map, hgH = /[#*`|[>\-_~]|\n\n|(?:^|\n) {0,3}\d+\. |https?:\/\/|www\./;
```

Isolated:

```js
hgH = /[#*`|[>\-_~]|\n\n|(?:^|\n) {0,3}\d+\. |https?:\/\/|www\./
```

Note the character class contains an **unescaped `[`** and the escaped `\-` and `_` and `~`. There
is no `!` (so a bare image `![a](b)` is caught by the `[`), and no `~~~` special case beyond the
plain `~`.

⚠ **CENSUS CONTRADICTION (line cite).** Census §Q2 cites `hgH` at **421281**; it is on **421280**.
421281 is `KBp` (the fence regex, below).

### 2.3 `mgH` — LRU size, and the streaming constants

Line **421269**:

```js
421269    var F3t, HM, OWo, mgH = 500, N3t, hgH, bHn = 4096, KBp, VBp = 1536, CX = b(() => {
```

**`mgH = 500`** entries. Also on this line: `bHn = 4096` and `VBp = 1536` (streaming chunk
thresholds). And the fence regex, line **421281**:

```js
421281      KBp = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm;
```

Handles both backtick and tilde fences, 3-or-more, up to 3 leading spaces.

---

## 3. Blockquote

### 3.1 Nested path — inside `f2`

Lines **420593–420596**:

```js
420593        case "blockquote": {
420594          let u = (e.tokens ?? []).map((p) => f2(p, t, { listDepth: 0, orderedListNumber: null, parent: null, highlight: s, glueProse: !1, linkCap: c, screenReader: l })).join(""), d = vt.dim(fGl);
420595          return u.split(aW).map((p) => Ci(p).trim() ? `${d} ${vt.italic(p)}` : p).join(aW);
420596        }
```

Prefix is **`vt.dim(fGl)` + one space**, applied per line, and **only to lines whose ANSI-stripped
content is non-blank** — blank lines inside the quote get **no rail**. Content is `vt.italic`.

`fGl` is defined in the symbol table, line **41482**:

```js
41482    var Za, qGe = "∙", aGl = "⌕", i5 = "✻", q3r = "∴", lGl = "◌", $Q = "↑", WK = "↓", V3r = "↳", L8 = "←", cGl = "→", K9n = "⏎", vCe = "↯", uGl = "○", z3r = "◐", ePi = "●", dGl = "◉", pGl = "◈", K3r = "✦", Y3r = "◎", X3r = "⏸", tPi = "↻", rPi = "←", UO = "⑂", xw = "◇", AD = "◆", nPi = "※", Soe = "⚠", Ib = "⧉", J3r = "♪", fGl = "▎", iPi = "█", qK = "─", Q3r, Z3r = "\xB7✔︎\xB7", e4r = "\xD7", S0t = "▸", t4r = "⠿", mxh, jA, mGl = "–", vD, zl = b(() => {
```

**`fGl = "▎"`** — U+258E LEFT ONE QUARTER BLOCK, `▎`.

### 3.2 Top-level path — the `Naa` component

Border props, line **421180**:

```js
421180        DWo = HM.jsx(I, { borderStyle: "quote", borderTop: !1, borderBottom: !1, borderRight: !1, borderDimColor: !0, paddingLeft: 1, children: HM.jsx(wc, { dimColor: BBp, children: jBp }) }), GBp[11] = BBp, GBp[12] = jBp, GBp[13] = DWo;
```

Content assembly, line **421174**:

```js
421174        fgH = vt.italic($Bp.tokens.map(DWo).join("").replace(/^\n+/, "").trimEnd());
```

Note: leading newlines stripped, trailing whitespace trimmed, whole thing italicised — the italic is
applied to the **assembled string**, not per line as in the nested path.

⚠ **CENSUS CONTRADICTION (line cite).** Census §2.1 cites `421181–421195`; the props are on
**421180** and the content assembly on **421174**.

### 3.3 The `quote` border style

Line **179535**:

```js
179535      BBu = C(UBu(), 1), luy = { dashed: { top: "╌", left: "╎", right: "╎", bottom: "╌", topLeft: " ", topRight: " ", bottomLeft: " ", bottomRight: " " }, quote: { top: " ", left: "▎", right: " ", bottom: " ", topLeft: " ", topRight: " ", bottomLeft: " ", bottomRight: " " } };
```

Isolated:

```js
quote: { top: " ", left: "▎", right: " ", bottom: " ",
         topLeft: " ", topRight: " ", bottomLeft: " ", bottomRight: " " }
```

Same `▎` glyph as the nested path; everything else is a space. Combined with
`borderTop/Bottom/Right: false` and `paddingLeft: 1`, the rendered decoration is exactly
**`▎` + one space** per line, dim.

---

## 4. Tables

Entry: `TWo` (memo wrapper, **421082**) → `IBp` (layout engine, **420907**) → either an ANSI string
in a `wc`, or `kaa` (the vertical/record fallback, **421019**).

### 4.1 The constants line

Line **421072**:

```js
421072    var vWo, O3t, Laa, vBp = 4, _Hn = 3, ngH = 4, TBp = 200, wBp = "\x1B[1m", CBp = "\x1B[22m", TWo, xBp = b(() => {
```

| const | value | role |
|---|---|---|
| `vBp` | `4` | terminal-width margin subtracted before fitting, and the overflow check |
| `_Hn` | `3` | **minimum column width**, in all three fitting modes |
| `ngH` | `4` | max wrapped lines per cell before falling back to vertical |
| `TBp` | `200` | row cap |
| `wBp` / `CBp` | `"\x1B[1m"` / `"\x1B[22m"` | raw SGR bold on/off, used by `kaa` only |

### 4.2 Row cap and the overflow string

Cap, line **420908**:

```js
420908      let s = Math.max(0, e.rows.length - TBp), a = s > 0 ? e.rows.slice(0, TBp) : e.rows, l = new Map;
```

`AWo`, lines **420897–420899** VERBATIM:

```js
420897    function AWo(e) {
420898      return `… ${e.toLocaleString()} more ${Et(e, "row")} not shown`;
420899    }
```

Rendered: `… 1,234 more rows not shown` (leading U+2026 HORIZONTAL ELLIPSIS, thousands-separated via
`toLocaleString()`, singular `row` when `e === 1`). Appended as a **separate line** after the bottom
border (line 421015) in the box layout, and after a `─` rule in the vertical layout (421050–421058).

### 4.3 The three-way width fitting

Lines **420926–420960**:

```js
420926      function d(M) {
420927        let W = u(M).split(/\s+/).filter((q) => q.length > 0);
420928        if (W.length === 0)
420929          return _Hn;
420930        return Math.max(...W.map((q) => Ut(q)), _Hn);
420931      }
420932      function p(M) {
420933        return Math.max(Ut(u(M)), _Hn);
420934      }
420935      let f = e.header.map((M, B) => {
420936        let W = d(M.tokens);
420937        for (let q of a)
420938          W = Math.max(W, d(q[B]?.tokens));
420939        return W;
420940      }), m = e.header.map((M, B) => {
420941        let W = p(M.tokens);
420942        for (let q of a)
420943          W = Math.max(W, p(q[B]?.tokens));
420944        return W;
420945      }), g = e.header.length, y = 1 + g * 3, _ = Math.max(t - y - vBp, g * _Hn), E = f.reduce((M, B) => M + B, 0), A = m.reduce((M, B) => M + B, 0), H = !1, T;
420946      if (A <= _)
420947        T = m;
420948      else if (E <= _) {
420949        let M = _ - E, B = m.map((q, U) => q - f[U]), W = B.reduce((q, U) => q + U, 0);
420950        T = f.map((q, U) => {
420951          if (W === 0)
420952            return q;
420953          let j = Math.floor(B[U] / W * M);
420954          return q + j;
420955        });
420956      } else {
420957        H = !0;
420958        let M = _ / E;
420959        T = f.map((B) => Math.max(Math.floor(B * M), _Hn));
420960      }
```

Reading it:

- `d(cell)` = **longest-word width** of the cell, floored at `_Hn = 3`.
- `p(cell)` = **full natural width** of the cell, floored at `_Hn = 3`.
- `f[]` = per-column longest-word minimum; `m[]` = per-column natural width.
- `y = 1 + g * 3` is the **chrome budget**: one leading `│`, then per column ` ` + content + ` ` + `│`.
- `_` = available content width = `max(terminalWidth - chrome - 4, columns * 3)`.
- **Mode 1** (`A <= _`): natural widths fit → use them, no wrapping (`H = false`).
- **Mode 2** (`E <= _`): longest-word minima fit → distribute the slack `_ - E` proportionally to
  each column's `natural - minimum` deficit, floored (`Math.floor`), so the table can end up
  narrower than `_` by up to `g - 1` columns' worth of rounding.
- **Mode 3** (neither fits): `H = true` (**hard wrap**), scale every minimum by `_ / E` and floor,
  never below `_Hn = 3`.

⚠ **CENSUS CONTRADICTION (line cite).** Census §2.3 cites `420950–420968`; the fitting block is
**420926–420960**. Census also omits the `y = 1 + g*3` chrome budget and the `g * _Hn` floor on `_`.

### 4.4 Grid characters VERBATIM

Lines **420993–420998**:

```js
420993      function D(M) {
420994        let [B, W, q, U] = { top: ["┌", "─", "┬", "┐"], middle: ["├", "─", "┼", "┤"], bottom: ["└", "─", "┴", "┘"] }[M], j = B;
420995        return T.forEach((G, z) => {
420996          j += W.repeat(G + 2), j += z < T.length - 1 ? q : U;
420997        }), j;
420998      }
```

| row | left | fill | join | right |
|---|---|---|---|---|
| `top` | `┌` `┌` | `─` `─` | `┬` `┬` | `┐` `┐` |
| `middle` | `├` `├` | `─` `─` | `┼` `┼` | `┤` `┤` |
| `bottom` | `└` `└` | `─` `─` | `┴` `┴` | `┘` `┘` |

Fill repeat is **`width + 2`** (the one-space cell padding on each side).

Cell separator, line **420984** and **420987**:

```js
420984          let z = "│";
...
420987            z += " " + bWo(oe, Ut(oe), ce, se) + " │";
```

`│` = `│`. Each cell is `" " + padded + " " + "│"`.

⚠ **CENSUS CONTRADICTION (line cite).** Census §2.3 cites grid characters at `420999`; they are on
**420994** (separator on 420984/420987).

### 4.5 Row assembly and header centering

Lines **421001–421005**:

```js
421001      let P = [];
421002      P.push(D("top")), P.push(...R(e.header, !0)), P.push(D("middle")), a.forEach((M, B) => {
421003        if (P.push(...R(M, !1)), B < a.length - 1)
421004          P.push(D("middle"));
421005      }), P.push(D("bottom"));
```

Header is `R(e.header, !0)` — the second argument forces centering. A `middle` rule is emitted after
the header **and between every consecutive pair of data rows** (but not after the last).

The `R` renderer, lines **420978–420992**:

```js
420978      function R(M, B) {
420979        let W = M.map((G, z) => {
420980          let V = c(G.tokens), K = T[z];
420981          return P3t(V, K, { hard: H });
420982        }), q = Math.max(...W.map((G) => G.length), 1), U = W.map((G) => Math.floor((q - G.length) / 2)), j = [];
420983        for (let G = 0;G < q; G++) {
420984          let z = "│";
420985          for (let V = 0;V < M.length; V++) {
420986            let K = W[V], Y = U[V], re = G - Y, oe = re >= 0 && re < K.length ? K[re] : "", ce = T[V], se = B ? "center" : e.align?.[V] ?? "left";
420987            z += " " + bWo(oe, Ut(oe), ce, se) + " │";
420988          }
420989          j.push(z);
420990        }
420991        return j;
420992      }
```

Note `U` — multi-line cells are **vertically centred** within the row's line count
(`Math.floor((rowLines - cellLines) / 2)` blank lines above).

Per-column alignment: `se = B ? "center" : e.align?.[V] ?? "left"` — header always `center`, body
takes the markdown `align`, defaulting to `left`.

### 4.6 `bWo` — the per-column align/pad function VERBATIM

Lines **420839–420848**:

```js
420839    function bWo(e, t, r, n) {
420840      let o = Math.max(0, r - t);
420841      if (n === "center") {
420842        let i = Math.floor(o / 2);
420843        return " ".repeat(i) + e + Pm(" ", o - i);
420844      }
420845      if (n === "right")
420846        return " ".repeat(o) + e;
420847      return e + " ".repeat(o);
420848    }
```

`e` = the (possibly ANSI-coloured) text, `t` = its visible width, `r` = target column width, `n` =
align. Centering biases **left** (`floor` on the left pad, remainder on the right).

### 4.7 Vertical/record fallback — trigger conditions

Wrapped-line trigger, lines **420961–420974**:

```js
420961      function w() {
420962        let M = 1;
420963        for (let B = 0;B < e.header.length; B++) {
420964          let W = c(e.header[B].tokens), q = P3t(W, T[B], { hard: H });
420965          M = Math.max(M, q.length);
420966        }
420967        for (let B of a)
420968          for (let W = 0;W < B.length; W++) {
420969            let q = c(B[W]?.tokens), U = P3t(q, T[W], { hard: H });
420970            M = Math.max(M, U.length);
420971          }
420972        return M;
420973      }
420974      let L = w() > ngH;
```

Trigger 1: **any** header or body cell wraps to more than `ngH = 4` lines.

Width trigger, lines **420999–421013**:

```js
420999      if (L)
421000        return x();
...
421006      let N = 0;
421007      for (let M of P) {
421008        let B = Ut(Ci(M));
421009        if (B > N)
421010          N = B;
421011      }
421012      if (N > t - vBp)
421013        return x();
```

Trigger 2: the **widest assembled row** (ANSI stripped, visible width) exceeds
`terminalWidth - vBp` = `terminalWidth - 4`. Note this is checked **after** the box is fully
assembled, so a table can be built and then thrown away.

The fallback payload, lines **420975–420977**:

```js
420975      function x() {
420976        return { kind: "vertical", headers: e.header.map((M) => u(M.tokens)), rows: a.map((M) => M.map((B) => c(B.tokens))), truncatedCount: s };
420977      }
```

Note: headers go through `u` (ANSI-stripped) but body cells through `c` (ANSI retained).

### 4.8 `kaa` — the record layout rule string

Lines **421022–421058**:

```js
421022        D3t = [];
421023        let PU0 = Math.min(mHn - 1, 40), ZhH = "─".repeat(PU0);
421024        EBp.forEach((OU0) => {
421025          let Iaa = [];
421026          if (OU0.forEach((NU0, FU0) => {
421027            let SWo = bBp[FU0] || "", egH = NU0.trimEnd().replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
421028            if (!SWo && !egH)
421029              return;
421030            let UU0 = SWo ? mHn - Ut(SWo) - 3 : mHn - 1, $U0 = mHn - 2 - 1, xaa = P3t(egH, Math.max(UU0, 10)), BU0 = xaa[0] || "", gHn;
421031            if (xaa.length <= 1)
421032              gHn = xaa;
421033            else {
421034              let GU0 = xaa.slice(1).map(ogH).join(" "), jU0 = P3t(GU0, $U0);
421035              gHn = [BU0, ...jU0];
421036            }
421037            Iaa.push(SWo ? `${wBp}${SWo}:${CBp} ${gHn[0] || ""}` : gHn[0] || "");
421038            for (let ABp = 1;ABp < gHn.length; ABp++) {
421039              let tgH = gHn[ABp];
421040              if (!tgH.trim())
421041                continue;
421042              Iaa.push(`${tgH}`);
421043            }
421044          }), Iaa.length === 0)
421045            return;
421046          if (D3t.length > 0)
421047            D3t.push(ZhH);
421048          D3t.push(...Iaa);
421049        });
421050        if (hHn > 0) {
421051          if (D3t.length > 0)
421052            D3t.push(ZhH);
421053          let yHn;
421054          if (SBp[5] !== hHn)
421055            yHn = AWo(hHn), SBp[5] = hHn, SBp[6] = yHn;
421056          else
421057            yHn = SBp[6];
421058          D3t.push(yHn);
421059        }
```

The rule string: **`"─".repeat(Math.min(terminalWidth - 1, 40))`** — `─` repeated, capped at 40.
Emitted **between records**, not after the last.

Per-field line: **`` `${"\x1B[1m"}${header}:${"\x1B[22m"} ${value}` ``** — the header label is
bolded with **raw SGR escapes**, then a colon, then a space, then the first wrapped line. A field
with an empty header emits the bare value with no label. Continuation lines carry **no indent**
(line 421042 is `` `${tgH}` `` — pass-through).

Field wrap widths: first line at `max(terminalWidth - Ut(header) - 3, 10)`; continuation lines
re-joined and re-wrapped at `terminalWidth - 3`.

⚠ **CENSUS CONTRADICTION (omission).** Census §2.3 describes `kaa` as rendering "each row as
`header: value` lines" and gives the rule; it **does not mention** that the header label is bolded
with raw `\x1B[1m` / `\x1B[22m` SGR pairs (constants `wBp` / `CBp`, line 421072), nor that
continuation lines are re-flowed rather than kept as wrapped.

### 4.9 Nested-table pipe form — `f2`'s own `table` case

Lines **420669–420697** VERBATIM:

```js
420669        case "table": {
420670          let d = function(g) {
420671            return yAr(g?.map((y) => f2(y, t, { listDepth: 0, orderedListNumber: null, parent: null, highlight: s, glueProse: !1, linkCap: c })).join("") ?? "");
420672          }, p = function(g) {
420673            return Ci(d(g));
420674          }, u = e;
420675          if (l)
420676            return Caa(u.header.map((g) => p(g.tokens)), u.rows.map((g) => g.map((y) => p(y.tokens)))) + aW + aW;
420677          let f = u.header.map((g, y) => {
420678            let _ = Ut(p(g.tokens));
420679            for (let E of u.rows) {
420680              let A = Ut(p(E[y]?.tokens));
420681              _ = Math.max(_, A);
420682            }
420683            return Math.max(_, 3);
420684          }), m = "| ";
420685          return u.header.forEach((g, y) => {
420686            let _ = d(g.tokens), E = p(g.tokens), A = f[y], H = u.align?.[y];
420687            m += bWo(_, Ut(E), A, H) + " | ";
420688          }), m = m.trimEnd() + aW, m += "|", f.forEach((g) => {
420689            let y = "-".repeat(g + 2);
420690            m += y + "|";
420691          }), m += aW, u.rows.forEach((g) => {
420692            m += "| ", g.forEach((y, _) => {
420693              let E = d(y.tokens), A = p(y.tokens), H = f[_], T = u.align?.[_];
420694              m += bWo(E, Ut(A), H, T) + " | ";
420695            }), m = m.trimEnd() + aW;
420696          }), m + aW;
420697        }
```

Reachable only for tables **nested inside another block** (top-level tables are split out by `Oaa`,
line 421149). Facts:
- Prefix `"| "`, cell suffix `" | "`, each row `trimEnd()`ed then `+ aW`. `trimEnd()` removes only the
  **trailing SPACE** of that last `" | "`, so the **closing `|` stays** — rows read `| a | b |`.
- Separator: `"|"` then `"-".repeat(width + 2) + "|"` per column — ASCII hyphens, no colons, so
  **alignment is not encoded** in the separator even though `bWo` honours `align` in the cells.
- Minimum column width here is the literal **`3`** (line 420683), not `_Hn`.
- The header row uses `u.align?.[y]` — **no forced centering**, unlike the box renderer.
- No row cap, no width fitting, no terminal-width awareness at all.
- Screen-reader mode (`l`) short-circuits to `Caa` (line 420849) + two newlines.

⚠ **PACK SELF-CORRECTION (2026-08-04, F4 Task 4 review).** The first bullet above originally read "the
**trailing `|` is trimmed off every row** — rows read `| a | b` with no closing pipe". That is wrong, and
the two cited lines say so: L420687 appends `bWo(...) + " | "` per cell, so the row ends `…b | ` — and
L420688's `m = m.trimEnd()` strips only the trailing SPACE, leaving `…b |`. Every row therefore keeps its
closing pipe. The bullet has been rewritten to the correct reading; the shipped `nestedTableRuns` in
`src/tui/markdown.ts` already followed the lines rather than this sentence, and its pin
(`test/tui/mdTable.test.ts`, "a NESTED table keeps `f2`'s plain pipe form") asserts `| 1   | 2   |`.

---

## 5. Code blocks

`f2`'s `code` case, lines **420597–420602** VERBATIM:

```js
420597        case "code": {
420598          let u = e.lang ?? "", d = u.match(/^[\w.+#-]+/)?.[0] ?? "", p = s && u && s.supportsLanguage(u) ? u : s && d && s.supportsLanguage(d) ? d : "plaintext", f = u && !s?.supportsLanguage(u) ? vt.dim(u) + aW : "";
420599          if (!s)
420600            return f + e.text + aW;
420601          return f + s.highlight(e.text, { language: p }) + aW;
420602        }
```

Determined facts, restated against the exact expressions:

- **Fence-language regex: `/^[\w.+#-]+/`** applied to `e.lang`, taking match `[0]`. The prefix `d`
  is the fallback when the whole `lang` string is unrecognised — so ` ```ts title=foo ` resolves `ts`.
- **Language resolution order**: full `lang` → prefix `d` → `"plaintext"`. All three arms require a
  live highlighter `s`.
- **Label polarity**: `f = u && !s?.supportsLanguage(u) ? vt.dim(u) + aW : ""`. The label is emitted
  **exactly when `lang` is non-empty AND the highlighter does not recognise the full `lang` string**.
  A recognised language gets **no label**. Note the condition tests `u` (the full string), **not**
  `d` (the prefix) — so ` ```ts title=foo ` produces a **dim label reading `ts title=foo`** while
  still highlighting as `ts`. The label is `vt.dim(lang) + "\n"`, i.e. its own line above the block.
- **`aW`'s value here**: `aW === "\n"` (§1.1). So the block ends with **one** trailing newline, and
  the label contributes one leading newline.
- **No indentation.** The returned string is `label + body + "\n"` — nothing is prepended to the
  body's lines. Emission is into `Oaa`'s glued prose string (line 421154), flush-left.
- **No border, no line numbers, no length cap, no horizontal truncation** anywhere in this case.
- When there is no highlighter at all (`!s`, line 420599 — the `syntaxHighlightingDisabled` path,
  421123–421124), the raw `e.text` is emitted, and `f` is `""` because `s?.supportsLanguage` is
  `undefined` → `!undefined` is `true`… **wait**: `f` is computed on line 420598 as
  `u && !s?.supportsLanguage(u)`, and with `s === null` that is `u && !undefined` = `u && true` =
  truthy whenever `lang` is non-empty. So **with highlighting disabled, every fenced block with a
  language gets a dim label line**. This is a live behaviour the census does not mention.

⚠ **CENSUS CONTRADICTION (two).**
1. Census §Q3 says the label appears "only when the language is *not* recognised". True for the
   highlighter-enabled path, but **false when `syntaxHighlightingDisabled` is set** — then the label
   appears for *every* language-tagged fence, because `s?.supportsLanguage(u)` short-circuits to
   `undefined`.
2. Census's quoted snippet is accurate, but it renumbers the case as `420598–420603`; the actual
   range is **420597–420602**.

---

## 6. Diff pipeline

Layering: `fbn` (header + body, **423885**) → `K3e` (hunk list, **420118**) → `lre` (one hunk) →
`fWo` (**419879**) → `H2p` (**419987**) → optionally `lhH` (word diff, **419947**).

### 6.1 `fbn` — header JSX VERBATIM

Lines **423885–423902**:

```js
423885    function fbn(N90) {
423886      let r_t = r9p.c(25), { filePath: J6p, structuredPatch: I8o, firstLine: Q6p, fileContent: Z6p, style: DHH, verbose: e9p, previewHint: Eua, collapsed: F90 } = N90, { columns: U90 } = Br(), gXe = I8o.reduce(NHH, 0), cvr = I8o.reduce(FHH, 0), Sua;
423887      if (r_t[0] !== gXe)
423888        Sua = gXe > 0 ? CS.jsxs(CS.Fragment, { children: ["Added ", CS.jsx(h, { bold: !0, children: gXe }), " ", gXe > 1 ? "lines" : "line"] }) : null, r_t[0] = gXe, r_t[1] = Sua;
423889      else
423890        Sua = r_t[1];
423891      const t9p = gXe > 0 && cvr > 0 ? ", " : null;
423892      let Aua;
423893      if (r_t[2] !== gXe || r_t[3] !== cvr)
423894        Aua = cvr > 0 ? CS.jsxs(CS.Fragment, { children: [gXe === 0 ? "R" : "r", "emoved ", CS.jsx(h, { bold: !0, children: cvr }), " ", cvr > 1 ? "lines" : "line"] }) : null, r_t[2] = gXe, r_t[3] = cvr, r_t[4] = Aua;
423895      else
423896        Aua = r_t[4];
423897      let PHH;
423898      if (r_t[5] !== Sua || r_t[6] !== t9p || r_t[7] !== Aua)
423899        PHH = CS.jsxs(h, { children: [Sua, t9p, Aua] }), r_t[5] = Sua, r_t[6] = t9p, r_t[7] = Aua, r_t[8] = PHH;
423900      else
423901        PHH = r_t[8];
423902      let uvr = PHH;
```

**Positional capitalization** is the split literal on line 423894:
`` gXe === 0 ? "R" : "r" `` followed by the constant `` "emoved " ``. The word "removed" is
assembled from two JSX children — the first character is chosen by whether the added-count is zero.
So:

| additions | removals | rendered |
|---|---|---|
| 3 | 0 | `Added 3 lines` |
| 0 | 1 | `Removed 1 line` |
| 3 | 1 | `Added 3 lines, removed 1 line` |
| 1 | 1 | `Added 1 line, removed 1 line` |
| 0 | 0 | *(empty Text)* |

Both counts are **bold** (`<Text bold>{n}</Text>`); the surrounding words are not. The separator is
the literal `", "` and is `null` unless **both** counts are non-zero.

Counters, lines **423876–423884**:

```js
423876    function NHH(W90, q90) {
...
423880      return j90.startsWith("-");
423881    }
423882    function FHH(W90, q90) {
423883      return W90 + pr(q90.lines, $HH);
423884    }
```

### 6.2 Body width expression

Line **423932**:

```js
423932      const pbn = U90 - 12;
```

where `U90` is `columns` from `Br()` (destructured on 423886). Passed as `width` to `K3e` on 423935.

⚠ **CENSUS CONTRADICTION (line cite).** Census §4.1 cites the body-width expression at **423958**;
line 423958 is `return await Cua(n, t, r);` inside `i9p` — an unrelated file-read helper. The
expression is on **423932**.

### 6.3 `previewHint` / `condensed` / `collapsed` branches

Lines **423903–423926** VERBATIM:

```js
423903      if (Eua) {
423904        if (DHH !== "condensed" && !e9p) {
423905          let yXe;
423906          if (r_t[9] !== Eua)
423907            yXe = CS.jsx(Cr, { children: CS.jsx(h, { dimColor: !0, children: Eua }) }), r_t[9] = Eua, r_t[10] = yXe;
423908          else
423909            yXe = r_t[10];
423910          return yXe;
423911        }
423912      } else if (DHH === "condensed" && !e9p)
423913        return uvr;
423914      else if (F90 && !e9p && gXe + cvr > 0) {
423915        let yXe;
423916        if (r_t[11] === X)
423917          yXe = CS.jsx(Bg, {}), r_t[11] = yXe;
423918        else
423919          yXe = r_t[11];
423920        let pbn;
423921        if (r_t[12] !== uvr)
423922          pbn = CS.jsx(Cr, { children: CS.jsxs(h, { children: [uvr, " ", yXe] }) }), r_t[12] = uvr, r_t[13] = pbn;
423923        else
423924          pbn = r_t[13];
423925        return pbn;
423926      }
```

Three exclusive early returns, in order:

1. **`previewHint` set** and style is not `"condensed"` and not `verbose` → the entire body is
   replaced by `<Cr><Text dimColor>{previewHint}</Text></Cr>`. Because this is the *outer* `if`,
   `previewHint` being truthy also **disables the collapsed and condensed branches entirely** — if
   `previewHint` is set but style *is* condensed (or verbose is on), execution falls straight through
   to the full render.
2. **`style === "condensed"`** and not verbose → return the bare header `uvr` (no `Cr`, no body).
   *(The census does not mention this branch at all.)*
3. **`collapsed`** and not verbose **and `additions + removals > 0`** → `<Cr>{header} {<Bg/>}</Cr>`.
   Note the extra `gXe + cvr > 0` guard: a zero-change patch never collapses.

`Bg`, lines **421333–421348** VERBATIM:

```js
421333    function Bg() {
421334      let AgH = $aa.c(3), x$0 = EHn.useContext(NWo), k$0 = EHn.useContext(q3e), r3p = pA("app:toggleTranscript", "Global", "ctrl+o");
421335      if (x$0 || k$0)
421336        return null;
421337      let vgH;
421338      if (AgH[0] === X)
421339        vgH = { keyCase: "lower" }, AgH[0] = vgH;
421340      else
421341        vgH = AgH[0];
421342      let TgH;
421343      if (AgH[1] !== r3p)
421344        TgH = U3t.jsx(h, { dimColor: !0, children: U3t.jsx($e, { chord: r3p, action: "expand", parens: !0, format: vgH }) }), AgH[1] = r3p, AgH[2] = TgH;
421345      else
421346        TgH = AgH[2];
421347      return TgH;
421348    }
```

The hint is **not a literal string** — it is a keybinding lookup (`pA("app:toggleTranscript",
"Global", "ctrl+o")`) rendered with `action: "expand"` and `parens: true`, lower-cased. With default
bindings it reads `(ctrl+o to expand)`. It renders **`null`** inside two contexts (`NWo`, `q3e` —
already-expanded surfaces).

### 6.4 The `aHr` call site — and what `aHr` is

Line **424069** VERBATIM (`VHH`, the Edit/Write tool-result renderer):

```js
424065    function VHH({ filePath: e = "", structuredPatch: t, originalFile: r }, n, { style: o, verbose: i }) {
424066      if (!e)
424067        return null;
424068      let s = e.startsWith(__());
424069      return m2.jsx(fbn, { filePath: e, structuredPatch: t, firstLine: r ? gp(r) : null, fileContent: r || void 0, style: o, verbose: i, previewHint: s ? "/plan to preview" : void 0, collapsed: !s && aHr(e) });
```

A second, identical call site at **424363**. Both compute:
- `previewHint = filePath.startsWith(__()) ? "/plan to preview" : undefined`
- `collapsed = !that && aHr(filePath)`

`aHr` is exported as **`isScratchpadDisplayPath`** (export map, line 371073) and defined at
**371190–371193**:

```js
371190    function aHr(e) {
371191      let t = map(e);
371192      return t !== null && t.comparePath.startsWith(t.prefix) && !Cst(t.comparePath, t.prefix, ABo);
371193    }
```

**This resolves a census "not determined".** Census §4.7 says "A collapsed diff is chosen by
`aHr(filePath)` — a per-path predicate, not a size threshold that I traced." It is a
**scratchpad-path predicate**: diffs to files inside the scratchpad directory start collapsed
(unless they are the `__()`-prefixed plan-preview paths, which get the `previewHint` instead).
Size never enters into it.

### 6.5 `K3e` — hunk separator VERBATIM

Lines **420118–420120**:

```js
420118    function K3e({ hunks: e, dim: t, width: r, filePath: n, firstLine: o, fileContent: i }) {
420119      return TOe(e.map((s) => aHn.jsx(I, { flexDirection: "column", children: aHn.jsx(lre, { patch: s, dim: t, width: r, filePath: n, firstLine: o, fileContent: i }) }, s.newStart)), (s) => aHn.jsx(BT, { fromLeftEdge: !0, children: aHn.jsx(h, { dimColor: !0, children: "..." }) }, `ellipsis-${s}`));
420120    }
```

The separator is the literal **`"..."`** (three ASCII periods, not U+2026), `dimColor`, inside a
`BT fromLeftEdge` box. `TOe` interposes it between elements. Hunk React keys are `s.newStart`.
**No `@@ -a,b +c,d @@` header anywhere.** Census §4.2 is confirmed exactly.

### 6.6 `chH` — line numbering VERBATIM, including the remove-run rewind

Lines **420004–420029**:

```js
420004    function chH(e, t) {
420005      let r = t, n = [], o = [...e];
420006      while (o.length > 0) {
420007        let i = o.shift(), { code: s, type: a, originalCode: l, wordDiff: c, matchedLine: u } = i, d = { code: s, type: a, i: r, originalCode: l, wordDiff: c, matchedLine: u };
420008        switch (a) {
420009          case "nochange":
420010            r++, n.push(d);
420011            break;
420012          case "add":
420013            r++, n.push(d);
420014            break;
420015          case "remove": {
420016            n.push(d);
420017            let p = 0;
420018            while (o[0]?.type === "remove") {
420019              r++;
420020              let f = o.shift(), { code: m, type: g, originalCode: y, wordDiff: _, matchedLine: E } = f, A = { code: m, type: g, i: r, originalCode: y, wordDiff: _, matchedLine: E };
420021              n.push(A), p++;
420022            }
420023            r -= p;
420024            break;
420025          }
420026        }
420027      }
420028      return n;
420029    }
```

Mechanics:
- `t` is the seed — `H2p` passes `patch.oldStart` (line 419882 → 419988). Numbers are **absolute
  file line numbers**.
- `nochange` and `add` each consume one number.
- `remove` pushes at the current `r` **without incrementing**, then drains the rest of the remove
  run incrementing as it goes, counting `p` extra removes, then **`r -= p`** — rewinding the counter
  back to the first remove's number + 1. So a paired remove-block/add-block renders with the
  **same line numbers on both sides**.
- Note the asymmetry: the *first* remove in a run never advances `r` at all, and the rewind subtracts
  only the *subsequent* removes. Net effect after an N-remove run: `r` advanced by exactly 0.

⚠ **CENSUS CONTRADICTION (line cite).** Census §4.3 cites `chH` at **420005**; the function opens at
**420004** (420005 is its first statement). Semantics as described in the census are correct.

### 6.7 `H2p` — band, gutter, wrap VERBATIM

Lines **419987–420003**:

```js
419987    function H2p(e, t, r, n, o) {
419988      let i = Math.max(1, Math.floor(r)), s = ihH(e), a = shH(s), l = chH(a, t), c = Math.max(...l.map(({ i: d }) => d), 0), u = Math.max(c.toString().length + 1, 0);
419989      return l.flatMap((d) => {
419990        let { type: p, code: f, i: m, wordDiff: g, matchedLine: y } = d;
419991        if (g && y) {
419992          let T = lhH(d, i, u, n, o);
419993          if (T !== null)
419994            return T;
419995        }
419996        let _ = 2, E = Math.max(1, i - u - 1 - _);
419997        return p3(f, E, "wrap").split(`
419998  `).map((T, w) => {
419999          let k = `${p}-${m}-${w}`, L = w === 0 ? m : void 0, x = (L !== void 0 ? L.toString().padStart(u) : " ".repeat(u)) + " ", R = p === "add" ? "+" : p === "remove" ? "-" : " ", D = x.length + 1 + Ut(T), P = Math.max(0, i - D), N = p === "add" ? n ? "diffAddedDimmed" : "diffAdded" : p === "remove" ? n ? "diffRemovedDimmed" : "diffRemoved" : void 0;
420000          return are.jsxs(I, { flexDirection: "row", children: [are.jsx(BT, { fromLeftEdge: !0, children: are.jsxs(h, { color: o ? "text" : void 0, backgroundColor: N, dimColor: n || p === "nochange", children: [x, R] }) }), are.jsxs(h, { color: o ? "text" : void 0, backgroundColor: N, dimColor: n, children: [T, " ".repeat(P)] })] }, k);
420001        });
420002      });
420003    }
```

Parameters: `e` = lines, `t` = `oldStart` seed, `r` = width, `n` = `dim`, `o` = a theme flag
(forces `color: "text"` on both spans when set).

- **Gutter width expression** (line 419988): `u = Math.max(maxLineNumber.toString().length + 1, 0)`
  — the widest number's digit count **plus one**. `c` is `Math.max(...allNumbers, 0)`.
- **Wrap width arithmetic** (line 419996): `_ = 2` then `E = Math.max(1, i - u - 1 - _)`, i.e.
  **`width - gutter - 3`**, floored at 1. Content is wrapped with `p3(f, E, "wrap")`.
- **Layout**: `x = <number padStart(u)> + " "`, then a single marker char `R` (`"+"` / `"-"` / `" "`),
  then the content. Continuation lines (`w > 0`) get `" ".repeat(u) + " "` — a **blank number gutter**
  — and repeat the same marker and band.
- **Right fill**: `D = x.length + 1 + Ut(T)` and `P = Math.max(0, i - D)` → `" ".repeat(P)` trails
  the content, so the background band runs to the full width `i`.
- **`dimColor` conditions — and they differ between the two spans**:
  - gutter+marker span: `dimColor: n || p === "nochange"` — dimmed when the whole diff is dim
    **or** the line is context.
  - content span: `dimColor: n` — dimmed **only** when the whole diff is dim. Context-line *content*
    is **not** dimmed; only its gutter is.
- Background tokens: `diffAdded` / `diffAddedDimmed` / `diffRemoved` / `diffRemovedDimmed`, and
  `void 0` (no background) for `nochange`.

⚠ **CENSUS CONTRADICTION (two).**
1. **Line cites are ~100 lines off.** Census §4.3/§4.4 cite `H2p` at **419887** and quote its body as
   "lines 419894–419898", with the gutter width at "419888". `H2p` is at **419987**; the gutter width
   is on **419988**; the quoted body is **419996–420001**. Line 419887 is inside `fWo`.
2. **The `dimColor` claim is wrong in one direction.** Census §4.4 says "Context (`nochange`) lines
   get **no background** and `dimColor: true`." No background is correct. But `dimColor: true` holds
   only for the **gutter/marker span**; the content span uses `dimColor: n` (the whole-diff dim flag),
   so an undimmed diff renders context-line *text* at normal intensity with only the number column
   dimmed.

`ihH` — the prefix parser, lines **419897–419905**:

```js
419897    function ihH(e) {
419898      return e.map((t) => {
419899        if (t.startsWith("+"))
419900          return { code: t.slice(1), i: 0, type: "add", originalCode: t.slice(1) };
419901        if (t.startsWith("-"))
419902          return { code: t.slice(1), i: 0, type: "remove", originalCode: t.slice(1) };
419903        return { code: t.slice(1), i: 0, type: "nochange", originalCode: t.slice(1) };
419904      });
419905    }
```

Note the fallthrough also does `t.slice(1)` — a context line's leading space is consumed.

### 6.8 `shH` — remove/add pairing VERBATIM

Lines **419906–419943**:

```js
419906    function shH(e) {
419907      let t = [], r = 0;
419908      while (r < e.length) {
419909        let n = e[r];
419910        if (!n) {
419911          r++;
419912          continue;
419913        }
419914        if (n.type === "remove") {
419915          let o = [n], i = r + 1;
419916          while (i < e.length && e[i]?.type === "remove") {
419917            let a = e[i];
419918            if (a)
419919              o.push(a);
419920            i++;
419921          }
419922          let s = [];
419923          while (i < e.length && e[i]?.type === "add") {
419924            let a = e[i];
419925            if (a)
419926              s.push(a);
419927            i++;
419928          }
419929          if (o.length > 0 && s.length > 0) {
419930            let a = Math.min(o.length, s.length);
419931            for (let l = 0;l < a; l++) {
419932              let c = o[l], u = s[l];
419933              if (c && u)
419934                c.wordDiff = !0, u.wordDiff = !0, c.matchedLine = u, u.matchedLine = c;
419935            }
419936            t.push(...o.filter(Boolean)), t.push(...s.filter(Boolean)), r = i;
419937          } else
419938            t.push(n), r++;
419939        } else
419940          t.push(n), r++;
419941      }
419942      return t;
419943    }
```

Pairs the *k*-th remove with the *k*-th add of the immediately following add-run, for
`k < min(removeRun, addRun)`. Surplus lines on either side stay unpaired (whole-line banding).

### 6.9 `lhH` — word diff VERBATIM, and the 40% bail

Lines **419944–419986**:

```js
419944    function ahH(e, t) {
419945      return _vs(e, t, { ignoreCase: !1 });
419946    }
419947    function lhH(e, t, r, n, o) {
419948      let { type: i, i: s, wordDiff: a, matchedLine: l, originalCode: c } = e;
419949      if (!a || !l)
419950        return null;
419951      let u = i === "remove" ? c : l.originalCode, d = i === "remove" ? l.originalCode : c, p = ahH(u, d), f = u.length + d.length;
419952      if (p.filter((w) => w.added || w.removed).reduce((w, k) => w + k.value.length, 0) / f > ohH || n)
419953        return null;
419954      let y = i === "add" ? "+" : "-", _ = y.length, E = Math.max(1, t - r - 1 - _), A = [], H = [], T = 0;
419955      if (p.forEach((w, k) => {
419956        let L = !1, x;
419957        if (i === "add") {
419958          if (w.added)
419959            L = !0, x = "diffAddedWord";
419960          else if (!w.removed)
419961            L = !0;
419962        } else if (i === "remove") {
419963          if (w.removed)
419964            L = !0, x = "diffRemovedWord";
419965          else if (!w.added)
419966            L = !0;
419967        }
419968        if (!L)
419969          return;
419970        p3(w.value, E, "wrap").split(`
419971  `).forEach((P, N) => {
419972          if (!P)
419973            return;
419974          if (N > 0 || T + Ut(P) > E) {
419975            if (H.length > 0)
419976              A.push({ content: [...H], contentWidth: T }), H = [], T = 0;
419977          }
419978          H.push(are.jsx(h, { backgroundColor: x, children: P }, `part-${k}-${N}`)), T += Ut(P);
419979        });
419980      }), H.length > 0)
419981        A.push({ content: H, contentWidth: T });
419982      return A.map(({ content: w, contentWidth: k }, L) => {
419983        let x = `${i}-${s}-${L}`, R = i === "add" ? n ? "diffAddedDimmed" : "diffAdded" : n ? "diffRemovedDimmed" : "diffRemoved", D = L === 0 ? s : void 0, P = (D !== void 0 ? D.toString().padStart(r) : " ".repeat(r)) + " ", N = P.length + _ + k, M = Math.max(0, t - N);
419984        return are.jsxs(I, { flexDirection: "row", children: [are.jsx(BT, { fromLeftEdge: !0, children: are.jsxs(h, { color: o ? "text" : void 0, backgroundColor: R, dimColor: n, children: [P, y] }) }), are.jsxs(h, { color: o ? "text" : void 0, backgroundColor: R, dimColor: n, children: [w, " ".repeat(M)] })] }, x);
419985      });
419986    }
```

The bail constant, line **420030**:

```js
420030    var b2p, are, E2p, ohH = 0.4, S2p = b(() => {
```

**`ohH = 0.4`.** The bail condition (line 419952) is:

```
sum(len of added-or-removed parts) / (len(oldLine) + len(newLine)) > 0.4   ||   dim
```

Note the denominator is the **sum of both lines' lengths**, so a full rewrite scores ~1.0 and a
half-changed line scores ~0.5. Returning `null` falls back to whole-line banding in `H2p`.

Also note the **wrap width differs from `H2p`**: here `_ = y.length` = 1, so
`E = Math.max(1, t - r - 1 - 1)` = **`width - gutter - 2`**, one column wider than `H2p`'s
`width - gutter - 3`. Word-diffed lines therefore wrap at a different column than plain ones.

⚠ **CENSUS CONTRADICTION (omission).** Census §4.4 states diff content wraps at "`width - gutter - 3`"
without qualification. That is `H2p`'s figure; the word-diff path (`lhH`) uses `width - gutter - 2`.

### 6.10 `_vs` — what diff library call this is

Line **217279–217281**:

```js
217279    function _vs(e, t, r) {
217280      return WQu.diff(e, t, r);
217281    }
```

`WQu` is an instance of the class defined at **217284–217289** (tokenizer at 217290+):

```js
217282    var cEo = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}", d0y, GQu, p0y, jQu, WQu, qQu = b(() => {
217283      d0y = new RegExp(`[${cEo}]+|\\s+|[^${cEo}]`, "ug");
217284      GQu = class GQu extends Eze {
217285        equals(e, t, r) {
217286          if (r.ignoreCase)
217287            e = e.toLowerCase(), t = t.toLowerCase();
217288          return e.trim() === t.trim();
217289        }
217290        tokenize(e, t = {}) {
```

**Yes — this is jsdiff's `diffWords`.** The evidence is decisive: `Eze` is jsdiff's `Diff` base
class, `GQu` is its `wordDiff` subclass (the `equals` override that trims before comparing and
honours `ignoreCase` is jsdiff's word-diff `equals` verbatim), the token regex `d0y` is jsdiff's
`extendedWordChars`-based word tokenizer, and the surrounding module also contains jsdiff's
`removeEmpty`/whitespace-fixup helpers (`BQu`, 217246; `xOt`/`jcr`, 217232/217238). The
`intlSegmenter` option branch (217292–217296) is jsdiff's `diffWords` Intl.Segmenter support. So
`ahH(u, d)` is `diffWords(oldLine, newLine, { ignoreCase: false })` and returns jsdiff change
objects with `{ value, added, removed }` — exactly what lines 419952 and 419958–419966 consume.

### 6.11 `i9p` — the `r = 3` context default and its call site

Lines **423953–423962**:

```js
423953    async function i9p(e, t, r = 3) {
423954      let n = await mbn(e);
423955      if (n === null)
423956        return null;
423957      try {
423958        return await Cua(n, t, r);
423959      } finally {
423960        await n.close();
423961      }
423962    }
```

The **only** call site, line **424124** (inside `_9p`, 424122):

```js
424122    async function _9p(e, t, r, n) {
424123      try {
424124        let o = await i9p(e, t, zcr);
424125        if (o === null || o.truncated || o.content === "") {
424126          let { patch: l } = ptn({ filePath: e, fileContents: t, oldString: t, newString: r });
424127          return { patch: l, firstLine: null, fileContent: void 0 };
424128        }
424129        let i = Mdt(o.content, t) || t, s = Qcr(t, i, r), { patch: a } = ptn({ filePath: e, fileContents: o.content, oldString: i, newString: s, replaceAll: n });
424130        return { patch: hEo(a, o.lineOffset - 1), firstLine: o.lineOffset === 1 ? gp(o.content) : null, fileContent: o.content };
```

`zcr` is defined at line **217814**:

```js
217814    var zcr = 3, mEo = 5000, mZu = "<<:AMPERSAND_TOKEN:>>", hZu = "<<:DOLLAR_TOKEN:>>", g$e = b(() => {
```

**`zcr = 3`.** So the call site *does* pass a context argument, and its value is also 3.

What `r` actually means — `BHH`, lines **424033–424051**:

```js
424033    async function BHH(e, t, r, n, o, i) {
424034      let s = Math.min(r, n_t), { bytesRead: a } = await e.read(t, 0, s, r - s), l = r, c = 0;
424035      for (let E = a - 1;E >= 0 && c <= o; E--) {
424036        if (t[E] === k8o) {
424037          if (c++, c > o)
424038            break;
424039        }
424040        l--;
424041      }
424042      let u = r - l, d = i - wua(t, a - u, a) + 1, p = r + n, { bytesRead: f } = await e.read(t, 0, n_t, p), m = p;
424043      c = 0;
424044      for (let E = 0;E < f; E++)
424045        if (m++, t[E] === k8o) {
424046          if (c++, c >= o + 1)
424047            break;
424048        }
424049      let g = m - l, y = g <= t.length ? t : Buffer.allocUnsafe(g), { bytesRead: _ } = await e.read(y, 0, g, l);
424050      return { content: s9p(y, _), lineOffset: d, truncated: !1 };
424051    }
```

`o` (= `r` = 3) is the count of newlines (`k8o = 10`) to walk **backwards** from the match start and
**forwards** from the match end. It is unambiguously a **context-line count**: `i9p` reads a window
of the file containing the matched old-string plus 3 lines of context on each side, and `_9p` builds
the structured patch from that window (offsetting line numbers by `o.lineOffset - 1`, line 424130).

⚠ **CENSUS CONTRADICTION (two).**
1. **Line cite is wrong.** Census §4.6 cites `i9p(e, t, r = 3)` at **419971**. Line 419971 is
   `.forEach((P, N) => {` inside `lhH`. `i9p` is at **423953**.
2. **The "inference" marker can be removed, with a caveat.** Census §4.6 flags the 3-line context as
   an inference because it read a default parameter, not a call site. A call site exists (424124) and
   passes `zcr = 3` explicitly. But note: this is the **preview/optimistic** diff path (`_9p`), the
   one used before the edit is applied. The `structuredPatch` on the *result* is built by `ptn(...)`
   from the read window, so 3 lines of context is what actually reaches the renderer on this path.

---

## 7. Identity

### 7.1 `Za` — and what `Pt()` returns

Line **41482–41486** (the symbol table; `Za` is declared on 41482 and assigned on 41484):

```js
41482    var Za, qGe = "∙", aGl = "⌕", i5 = "✻", q3r = "∴", ... fGl = "▎", ... zl = b(() => {
41483      Ei();
41484      Za = Pt() === "macos" ? "⏺" : "●";
41485      Q3r = ["\xB7|\xB7", "\xB7/\xB7", "\xB7—\xB7", "\xB7\\\xB7"], mxh = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
41486      jA = { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯" }, vD = { branch: "├", last: "└", pipe: "│", teeDown: "┬", teeUp: "┴" };
```

`⏺` = ⏺ (BLACK CIRCLE FOR RECORD); `●` = ● (BLACK CIRCLE).

`Pt`, lines **18008–18021**:

```js
18008    var t2r, jCi, WCi, GCi, Pt, lrt, bLl, bYm, ELl, Ei = b(() => {
18009      Hl();
18010      We();
18011      ji();
18012      kr();
18013      _Ll();
18014      t2r = require("fs/promises"), jCi = require("os"), WCi = ["macos", "wsl"];
18015      Pt = Vr(() => {
18016        try {
18017          return "macos";
18018        } catch (e) {
18019          return Ce(e), "unknown";
18020        }
18021      });
```

⚠ **CENSUS CONTRADICTION — this is the significant one in §7.**

Census §"Marked inferences" says: *"`⏺` vs `●`: I read the ternary `Pt() === "macos"` at 41484 but
did not verify `Pt()`'s return values against the platform table."*

Verified now: **`Pt()` is a memoized function whose body is `try { return "macos" } catch { return
"unknown" }`.** There is no platform detection left in it — the `try` block contains a single
unconditional `return "macos"`. (`WCi = ["macos", "wsl"]` on line 18014 is the *type* enumeration, not
a dispatch.) The `catch` is unreachable.

Consequence: **in this bundle, `Za` is unconditionally `"⏺"` (⏺).** The `Pt() === "macos"`
ternary at 41484 is dead — it evaluates true at module-init on every machine that runs *this*
artifact. The `●` (●) branch is not reachable from this build.

Practical reading for a clone: this is a **per-platform build artifact**. The darwin bundle has the
platform check constant-folded to `"macos"`; other platform bundles presumably fold it to something
else. So "⏺ on macOS, ● elsewhere" is a correct description of the *product*, but **anyone reading
this bundle to determine runtime behaviour should treat `Za` as the constant `⏺`.**

### 7.2 `VAr` default branch VERBATIM

Lines **422848–422864**:

```js
422848          const C_ = tca ? 1 : 0;
422849          let pre;
422850          if (w6[24] !== x5p)
422851            pre = x5p && ka.jsx(BT, { fromLeftEdge: !0, minWidth: 2, children: ka.jsx(h, { "aria-label": "claude:", color: "text", children: Za }) }), w6[24] = x5p, w6[25] = pre;
422852          else
422853            pre = w6[25];
422854          let rca;
422855          if (w6[26] !== T6)
422856            rca = ka.jsx(I, { flexDirection: "column", children: ka.jsx(km, { children: T6 }) }), w6[26] = T6, w6[27] = rca;
422857          else
422858            rca = w6[27];
422859          let v_H;
422860          if (w6[28] !== C_ || w6[29] !== pre || w6[30] !== rca)
422861            v_H = ka.jsxs(I, { alignItems: "flex-start", flexDirection: "row", marginTop: C_, width: "100%", children: [pre, rca] }), w6[28] = C_, w6[29] = pre, w6[30] = rca, w6[31] = v_H;
422862          else
422863            v_H = w6[31];
422864          return v_H;
```

- `tca` = `addMargin`, `x5p` = `shouldShowDot`, `T6` = the text.
- Gutter: `<BT fromLeftEdge minWidth={2}><Text aria-label="claude:" color="text">{Za}</Text></BT>`,
  gated on `shouldShowDot` (the `&&` short-circuits to `false`, rendering nothing).
- Body: `<Box flexDirection="column"><Markdown>{text}</Markdown></Box>` — a sibling column, so
  the two-column indent is a **layout** property.
- Row: `alignItems: "flex-start"`, `flexDirection: "row"`, `marginTop: addMargin ? 1 : 0`,
  `width: "100%"`.

⚠ **CENSUS CONTRADICTION (line cite only).** Census §1.2 cites `422857–422864`; the branch is
**422848–422864**. Its JSX transcription is accurate.

### 7.3 `xqo` — pointer / colour code VERBATIM

The normal-layout gutter, lines **426067–426071**:

```js
426067      let jjp = 3 + (f4t?.paddingWidth ?? 0), Bvr;
426068      if (vXe[19] !== f4t?.selectionHighlight)
426069        Bvr = gf.jsx(I, { flexShrink: 0, children: f4t?.selectionHighlight === "off" ? gf.jsx(h, { children: "  " }) : gf.jsxs(h, { "aria-label": f4t?.selectionHighlight === "on" ? "selected:" : "you:", color: f4t?.selectionHighlight === "on" ? "suggestion" : "subtle", children: [Ge.pointer, " "] }) }), vXe[19] = f4t?.selectionHighlight, vXe[20] = Bvr;
426070      else
426071        Bvr = vXe[20];
```

Three states:
- `selectionHighlight === "off"` → two literal spaces, no glyph, no colour.
- `selectionHighlight === "on"` → `aria-label="selected:"`, `color: "suggestion"`, `[Ge.pointer, " "]`.
- otherwise (undefined) → `aria-label="you:"`, `color: "subtle"`, `[Ge.pointer, " "]`.

`jjp = 3 + paddingWidth` is the indent handed to the hidden-lines rule (line 426074) — 3 in a normal
message, 7 in a queued one (`paddingWidth` = 4, §7.6).

Body text, lines **426092–426119** (`h4t`) — plain `color: "text"` unless `cit()` is on, in which
case matched ranges get per-character rainbow colours:

```js
426097          let iSH = cit() ? vGr(m4t) : [];
426098          if (iSH.length === 0) {
426099            Vjp = gf.jsx(h, { color: "text", children: m4t });
426100            break bb0;
426101          }
...
426106            for (let Iqo = uEn.start;Iqo < uEn.end; Iqo++)
426107              gfa.push(gf.jsx(h, { color: A7(Iqo - uEn.start), children: m4t[Iqo] }, `rb-${Iqo}`));
```

⚠ **CENSUS CONTRADICTION (line cite).** Census §1.3 cites the gutter at **426066**; it is on
**426069** (426066 closes the brief-layout branch).

### 7.4 `Ge.pointer`

Line **104968** (the `Hru` unicode symbol set, inside a single very long `var` line):

```js
Hru = { tick: "✔", info: "ℹ", warning: "⚠", cross: "✘", squareSmall: "◻", squareSmallFilled: "◼", circle: "◯", circleFilled: "◉", circleDotted: "◌", circleDouble: "◎", circleCircle: "ⓞ", circleCross: "ⓧ", circlePipe: "Ⓘ", radioOn: "◉", radioOff: "◯", checkboxOn: "☒", checkboxOff: "☐", checkboxCircleOn: "ⓧ", checkboxCircleOff: "Ⓘ", pointer: "❯", triangleUpOutline: "△", ... }
```

and the ASCII fallback set `Lkg` on the same line:

```js
Lkg = { tick: "√", info: "i", warning: "‼", cross: "\xD7", ..., pointer: ">", ... }
```

with the selection at the end of line 104968:

```js
Rkg = { ..._ru, ...Hru }, Mkg = { ..._ru, ...Lkg }, Dkg = EJi(), Pkg = Dkg ? Rkg : Mkg, Ge = Pkg, JPA = Object.entries(Hru);
```

**`Ge.pointer = "❯"` = `❯`** on unicode-capable terminals; **`">"`** on the ASCII fallback
(`EJi()` false — see 104960–104962, a win32/TERM check). `Ge.pointerSmall = "›"` = `›` (from
`_ru`, same line), used by `Ivr` in §9.8.

⚠ Census §1.3 states `Ge.pointer = "❯"` flatly; the ASCII-fallback `">"` exists and is selected by
`EJi()`.

### 7.5 `Mqo` — band props and the 10k fold

Band props, line **426170** and **426178**:

```js
426170      const mEn = zV0 ? 1 : 0, hEn = fEn ? void 0 : "userMessageBackground", gEn = fEn ? 0 : 1, yEn = fEn ? YV0 : void 0;
...
426178        aSH = _En.jsx(I, { flexDirection: "column", marginTop: mEn, backgroundColor: hEn, paddingRight: gEn, children: yfa }), pEn[18] = mEn, pEn[19] = hEn, pEn[20] = gEn, pEn[21] = yfa, pEn[22] = aSH;
```

- `zV0` = `addMargin` → `marginTop: 1 | 0`.
- `fEn` = brief layout. In **normal** layout: `backgroundColor: "userMessageBackground"`,
  `paddingRight: 1`, `timestamp: undefined`. In **brief** layout: **no background**,
  `paddingRight: 0`, timestamp passed through.

Brief-layout gate, line **426139**:

```js
426139        sSH = Eue() && (XV0 || Ke("tengu_kairos_brief", !1)) && Yjp && !Kjp && !Xjp, pEn[0] = Yjp, pEn[1] = Kjp, pEn[2] = Xjp, pEn[3] = sSH;
```

where `XV0 = Z.CLAUDE_CODE_BRIEF` (426137). Requires: `Eue()` **and** (env var **or** the
`tengu_kairos_brief` gate) **and** `isBriefOnly` **and** not transcript mode **and** not viewing an
agent task.

The 10k fold, lines **426143–426167**:

```js
426143      bb0: {
426144        if (TXe.length <= tWp) {
426145          Jjp = TXe;
426146          break bb0;
426147        }
426148        let mEn;
426149        if (pEn[4] !== TXe)
426150          mEn = TXe.slice(0, Rqo), pEn[4] = TXe, pEn[5] = mEn;
426151        else
426152          mEn = pEn[5];
426153        let Qjp = mEn, hEn, gEn, Lqo;
426154        if (pEn[6] !== TXe)
426155          Lqo = TXe.slice(-rWp), hEn = au(TXe, `
426156  `, Rqo), gEn = au(Lqo, `
426157  `), pEn[6] = TXe, pEn[7] = hEn, pEn[8] = gEn, pEn[9] = Lqo;
426158        else
426159          hEn = pEn[7], gEn = pEn[8], Lqo = pEn[9];
426160        let Zjp = hEn - gEn, yEn;
426161        if (pEn[10] !== Qjp || pEn[11] !== Zjp || pEn[12] !== Lqo)
426162          yEn = { head: Qjp, hiddenLines: Zjp, tail: Lqo }, pEn[10] = Qjp, pEn[11] = Zjp, pEn[12] = Lqo, pEn[13] = yEn;
426163        else
426164          yEn = pEn[13];
426165        Jjp = yEn;
426166      }
426167      let eWp = Jjp;
```

Constants, line **426183**:

```js
426183    var _fa, _En, nWp, tWp = 1e4, Rqo = 2500, rWp = 2500, oWp = b(() => {
```

**`tWp = 1e4`** (fold threshold), **`Rqo = 2500`** (head slice), **`rWp = 2500`** (tail slice).

`hiddenLines` is computed as `au(text, "\n", 2500) - au(tail, "\n")` — the number of newlines from
char 2500 onward, minus those in the tail. (`au` counts occurrences from an offset, line 15190.)

⚠ **CENSUS CONTRADICTION (line cite).** Census §1.4 cites the fold constants at **426181**; they are
on **426183**.

### 7.6 The titled rule — `dEn`

Lines **426084–426091** VERBATIM:

```js
426084    function dEn(RV0) {
426085      let MV0 = kqo.c(3), { hiddenLines: rSH, indent: Wjp } = RV0, qjp = `(${rSH} ${rSH === 1 ? "line" : "lines"} hidden)`, nSH;
426086      if (MV0[0] !== Wjp || MV0[1] !== qjp)
426087        nSH = gf.jsx(Sg, { title: qjp, titleAlign: "start", color: "subtle", padding: Wjp }), MV0[0] = Wjp, MV0[1] = qjp, MV0[2] = nSH;
426088      else
426089        nSH = MV0[2];
426090      return nSH;
426091    }
```

Title string: **`` `(${n} ${n === 1 ? "line" : "lines"} hidden)` ``** → `(4021 lines hidden)`.
`titleAlign: "start"`, `color: "subtle"`, `padding` = the caller's indent (`2` in brief layout,
line 426057; `3 + paddingWidth` in normal layout, line 426074).

### 7.7 Queued messages — `wqo`

Lines **426002–426022** VERBATIM:

```js
426002    function wqo(EV0) {
426003      let Fjp = Gjp.c(10), { isFirst: Djp, useBriefLayout: SV0, selectionHighlight: Pjp, children: Ojp } = EV0, sfa = SV0 ? 0 : $jp;
426004      const Njp = sfa * 2;
426005      let QEH;
426006      if (Fjp[0] !== Djp || Fjp[1] !== Pjp || Fjp[2] !== Njp)
426007        QEH = { isQueued: !0, isFirst: Djp, paddingWidth: Njp, selectionHighlight: Pjp }, Fjp[0] = Djp, Fjp[1] = Pjp, Fjp[2] = Njp, Fjp[3] = QEH;
426008      else
426009        QEH = Fjp[3];
426010      let Ujp = QEH, afa;
426011      if (Fjp[4] !== Ojp || Fjp[5] !== sfa)
426012        afa = sEn.jsx(I, { paddingX: sfa, children: Ojp }), Fjp[4] = Ojp, Fjp[5] = sfa, Fjp[6] = afa;
426013      else
426014        afa = Fjp[6];
426015      let ZEH;
426016      if (Fjp[7] !== afa || Fjp[8] !== Ujp)
426017        ZEH = sEn.jsx(vqo.Provider, { value: Ujp, children: afa }), Fjp[7] = afa, Fjp[8] = Ujp, Fjp[9] = ZEH;
426018      else
426019        ZEH = Fjp[9];
426020      return ZEH;
426021    }
426022    var Bjp, aEn, sEn, Gjp, vqo, $jp = 2, lfa = b(() => {
```

**`$jp = 2`** (line 426022). So `paddingX` is **2 in normal layout, 0 in brief layout**, and the
context's `paddingWidth` is `paddingX * 2` = **4** normal, **0** brief.

The `"subtle"` colour flip, line **426034**:

```js
426034        let ufa = Bvr, Cqo = eSH ? "subtle" : "text", dfa = f4t?.selectionHighlight === "on", T_t;
```

This line is **inside the brief-layout branch of `xqo`** (which opens at 426028 `if (LV0) {`). So the
dim-when-queued behaviour applies **only in brief layout**; in normal layout a queued message uses
`h4t` (line 426074 → 426099), which is unconditionally `color: "text"`. Census §1.5 says exactly
this — confirmed.

The brief-layout label, lines **426039–426042**:

```js
426039        const cEn = dfa ? "suggestion" : eSH ? "subtle" : "briefLabelYou";
426040        let pfa;
426041        if (vXe[4] !== cEn)
426042          pfa = gf.jsx(h, { color: cEn, children: "You" }), vXe[4] = cEn, vXe[5] = pfa;
```

Literal label **`"You"`**, colour `suggestion` (selected) / `subtle` (queued) / `briefLabelYou`
(`rgb(37,99,235)` light, `"ansi:blue"` light-ansi, `"ansi:blueBright"` dark-ansi).

### 7.8 Interrupted — `zWo` and `BP` VERBATIM

Lines **422222–422241**:

```js
422222    function zWo() {
422223      let t30 = V4p.c(1), UyH;
422224      if (t30[0] === X)
422225        UyH = oRe.jsxs(oRe.Fragment, { children: [oRe.jsx(h, { dimColor: !0, children: "Interrupted " }), oRe.jsx(h, { dimColor: !0, children: "\xB7 What should Claude do instead?" })] }), t30[0] = UyH;
422226      else
422227        UyH = t30[0];
422228      return UyH;
422229    }
422230    var oRe, V4p, z4p = b(() => {
422231      ct();
422232      oRe = C(ue(), 1), V4p = C(_e(), 1);
422233    });
422234    function BP() {
422235      let s30 = K4p.c(1), $yH;
422236      if (s30[0] === X)
422237        $yH = $Hn.jsx(Cr, { height: 1, children: $Hn.jsx(zWo, {}) }), s30[0] = $yH;
422238      else
422239        $yH = s30[0];
422240      return $yH;
422241    }
```

Two separate dim `Text` nodes: **`"Interrupted "`** (note the trailing space) and
**`"\xB7 What should Claude do instead?"`** (leading `·` U+00B7 MIDDLE DOT). Concatenated:
`Interrupted · What should Claude do instead?`. `BP` wraps it in `<Cr height={1}>`.

The sentinels that route here, line **108575**:

```js
108575    var Tq = "[Request interrupted by user]", Wk = "[Request interrupted by user for tool use]", F7 = "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.", wq = "API Error: Request was aborted.", Utr = "Operation stopped by hook", Vou, zou = ` hook feedback:
```

### 7.9 `Cr` — the connector string VERBATIM

Lines **406888–406900**:

```js
406888    function Cr(Oy0) {
406889      let zta = Qta.c(11), { children: Wta, height: qta, screenReaderLabel: Vta } = Oy0;
406890      if (Myn.useContext(BEr))
406891        return Wta;
406892      const gCp = Vta === void 0;
406893      let Kta;
406894      if (zta[0] !== Vta || zta[1] !== gCp)
406895        Kta = bX.jsx(BT, { fromLeftEdge: !0, flexShrink: 0, children: bX.jsxs(h, { "aria-hidden": gCp, "aria-label": Vta, dimColor: !0, children: ["  ", "⎿ \xA0"] }) }), zta[0] = Vta, zta[1] = gCp, zta[2] = Kta;
406896      else
406897        Kta = zta[2];
406898      let Yta;
406899      if (zta[3] !== Wta)
406900        Yta = bX.jsx(I, { flexShrink: 1, flexGrow: 1, children: Wta }), zta[3] = Wta, zta[4] = Yta;
```

The gutter children are the two literals **`"  "`** and **`"⎿ \xA0"`**:
two spaces, then `⎿` (U+23BF), then a space, then NBSP (U+00A0). **Five columns total.**
`dimColor: true`. Note line 406890: inside the `BEr` context `Cr` renders its children **bare**, with
no gutter at all.

---

## 8. Thinking

### 8.1 `e8o` — the streaming placeholder VERBATIM

Lines **422457–422471**:

```js
422457    function e8o($30) {
422458      let KyH = d5p.c(3), { addMargin: zyH } = $30;
422459      const u5p = (zyH === void 0 ? !1 : zyH) ? 1 : 0;
422460      let YyH;
422461      if (KyH[0] === X)
422462        YyH = Wyt.jsxs(h, { dimColor: !0, italic: !0, children: [Wyt.jsx(h, { "aria-hidden": !0, children: "✻ " }), "Thinking…"] }), KyH[0] = YyH;
422463      else
422464        YyH = KyH[0];
422465      let XyH;
422466      if (KyH[1] !== u5p)
422467        XyH = Wyt.jsx(I, { marginTop: u5p, children: YyH }), KyH[1] = u5p, KyH[2] = XyH;
422468      else
422469        XyH = KyH[2];
422470      return XyH;
422471    }
```

Literals: **`"✻ "`** (✻ + one space, `aria-hidden`) and **`"Thinking…"`** (`Thinking…`,
U+2026 not three periods). Whole thing `dimColor` + `italic`. No gutter box — it is a bare `Text`.

Symbol table entry, line **41482**: `i5 = "✻"` — U+273B SIX PETALLED BLACK AND WHITE FLORETTE.
Note `e8o` inlines the escape rather than referencing `i5`.

Also used verbatim for `redacted_thinking` (line 429450, §8.2).

### 8.2 `Gha` — the thinking guard VERBATIM

Lines **429445–429464**:

```js
429445        case "redacted_thinking": {
429446          if (!V_t && !gre)
429447            return null;
429448          let I6;
429449          if (O4t[30] !== gz)
429450            I6 = Xp.jsx(e8o, { addMargin: gz }), O4t[30] = gz, O4t[31] = I6;
429451          else
429452            I6 = O4t[31];
429453          return I6;
429454        }
429455        case "thinking": {
429456          if (!V_t && !gre)
429457            return null;
429458          let I6;
429459          if (O4t[32] !== gz || O4t[33] !== V_t || O4t[34] !== W1 || O4t[35] !== gre)
429460            I6 = Xp.jsx(zAr, { addMargin: gz, param: W1, isTranscriptMode: V_t, verbose: gre }), O4t[32] = gz, O4t[33] = V_t, O4t[34] = W1, O4t[35] = gre, O4t[36] = I6;
429461          else
429462            I6 = O4t[36];
429463          return I6;
429464        }
```

`V_t` = `isTranscriptMode`, `gre` = `verbose`. **`if (!isTranscriptMode && !verbose) return null`** —
in the ordinary transcript, both `thinking` and `redacted_thinking` render **nothing**.

⚠ **CENSUS CONTRADICTION (line cite).** Census §5.2 cites the `case "thinking"` guard at **429447**;
429447 is the `return null` of the **`redacted_thinking`** case. The `thinking` case opens at
**429455** and its guard is on **429456–429457**. (The census's §5.1 cite of "line 429444" for
redacted_thinking is also off by one — the case opens at 429445.)

### 8.3 `zAr` — gutter + content VERBATIM

Lines **422947–422969** (the interesting part):

```js
422947    function zAr(z40) {
422948      let cca = G5p.c(27), { param: K40, addMargin: I_H, isTranscriptMode: O5p, verbose: N5p } = z40, { thinking: F5p } = K40, U5p = I_H === void 0 ? !1 : I_H, uca, dca, $5p, pca, fca, mca, hca, gca, yca, u8o;
422949      if (cca[0] !== U5p || cca[1] !== O5p || cca[2] !== F5p || cca[3] !== N5p) {
422950        $5p = ta;
422951        bb0: {
422952          let B5p = nI(F5p);
422953          if (!B5p) {
422954            $5p = null;
422955            break bb0;
422956          }
422957          let Y40 = O5p || N5p;
422958          dca = I;
422959          hca = "row";
422960          gca = U5p ? 1 : 0;
422961          yca = "100%";
422962          if (cca[14] === X)
422963            u8o = sle.jsx(I, { minWidth: 2, children: sle.jsx(h, { "aria-label": "thinking:", dimColor: !0, italic: !0, children: q3r }) }), cca[14] = u8o;
422964          else
422965            u8o = cca[14];
422966          uca = I;
422967          pca = "column";
422968          fca = 1;
422969          mca = Y40 ? sle.jsx(km, { dimColor: !0, children: B5p.trim() }) : sle.jsx(h, { dimColor: !0, italic: !0, children: B5p.trim().replace(/\s+/g, " ") });
422970        }
```

- **Gutter** (422963): `<Box minWidth={2}><Text aria-label="thinking:" dimColor italic>{q3r}</Text></Box>`.
  `q3r = "∴"` (symbol table, line 41482) = **`∴`** THEREFORE. A *different* glyph from the
  streaming placeholder's `✻`.
- **Content** (422969): `Y40 = isTranscriptMode || verbose`.
  - `Y40` true → `<Markdown dimColor>{thinking.trim()}</Markdown>` — through the markdown renderer.
  - `Y40` false → `<Text dimColor italic>{thinking.trim().replace(/\s+/g, " ")}</Text>` — whitespace
    flattened to a single line.
- Body box (422966–422968, assembled 422978): `flexDirection: "column"`, `flexGrow: 1`.
- Outer row (422983): `flexDirection: "row"`, `marginTop: addMargin ? 1 : 0`, `width: "100%"`.
- Empty thinking (`!nI(thinking)`) → `null` (422953–422955).

⚠ **CENSUS CONTRADICTION (line cite).** Census §5.3 cites "422961–422965"; the gutter is on
**422963** and the content branch on **422969**.

### 8.4 The turn summary — "Thought for X" VERBATIM

Lines **427975–427999**:

```js
427975      let Ae = [];
427976      function we(Fe, ge, Oe) {
427977        let Be = Ae.length === 0;
427978        if (!Be)
427979          Ae.push(Bs.jsx(h, { children: ", " }, `comma-${Fe}`));
427980        Ae.push(Bs.jsxs(h, { children: [Be ? ge[0].toUpperCase() + ge.slice(1) : ge, Oe != null && Bs.jsxs(Bs.Fragment, { children: [" ", Oe] })] }, Fe));
427981      }
427982      if (ce) {
427983        let Fe = s ? "Thinking" : "Thought", ge;
427984        if (s && ds()) {
427985          let Oe = 0;
427986          for (let Be = g.length - 1;Be >= 0; Be--) {
427987            let Pe = g[Be];
427988            if (Pe?.type === "assistant" && Pe.message.content[0]?.type === "thinking") {
427989              let ze = Date.parse(Pe.timestamp);
427990              if (Number.isFinite(ze))
427991                Oe = ze;
427992              break;
427993            }
427994          }
427995          ge = Bs.jsx(q8p, { baseMs: oe, lastThinkingAtMs: Oe });
427996        } else
427997          ge = Bs.jsx(h, { bold: !0, children: ra(Math.max(1000, oe)) });
427998        Ae.push(Bs.jsxs(h, { children: [Fe, " for ", ge] }, "thought"));
427999      }
```

- `s` is the live/in-progress flag: **`"Thinking"`** live, **`"Thought"`** settled.
- Live + `ds()` → `<q8p baseMs={oe} lastThinkingAtMs={Oe} />`, a ticking component seeded from the
  most recent assistant message whose **first** content block is `thinking`.
- Otherwise → `<Text bold>{ra(Math.max(1000, oe))}</Text>` — **the 1000 ms floor**. Any turn that
  thought for under a second reports `1s`, never `0s` or `0.4s`.
- Assembly literal: `[label, " for ", value]` → `Thought for 12s`.
- Note this clause is pushed to `Ae` **directly**, bypassing the `we()` helper — so it never gets a
  leading comma and never gets sentence-case treatment (it is already capitalised). Subsequent
  clauses added via `we()` see `Ae.length !== 0` and prepend `", "`.

### 8.5 What `ra()` formats VERBATIM

Lines **107033–107057**:

```js
107033    function ra(e, t) {
107034      if (e < 60000) {
107035        if (e === 0)
107036          return "0s";
107037        if (e < 1)
107038          return `${(e / 1000).toFixed(1)}s`;
107039        return `${Math.floor(e / 1000).toString()}s`;
107040      }
107041      let r = Math.floor(e / 86400000), n = Math.floor(e % 86400000 / 3600000), o = Math.floor(e % 3600000 / 60000), i = Math.round(e % 60000 / 1000);
107042      if (i === 60)
107043        i = 0, o++;
107044      if (o === 60)
107045        o = 0, n++;
107046      if (n === 24)
107047        n = 0, r++;
107048      let s = t?.hideTrailingZeros;
107049      if (t?.mostSignificantOnly) {
107050        if (r > 0)
107051          return `${r}d`;
107052        if (n > 0)
107053          return `${n}h`;
107054        if (o > 0)
107055          return `${o}m`;
107056        return `${i}s`;
107057      }
```

**`ra` takes milliseconds** and returns a human duration string. Under 60 s it is
`` `${Math.floor(ms / 1000)}s` `` — **floored whole seconds**, so 1999 ms renders `1s`. Combined with
the `Math.max(1000, oe)` floor at 427997, the minimum displayed value is exactly `1s`. The `e < 1`
branch (one-decimal seconds) is unreachable from the turn summary because of that floor. At or above
60 s it decomposes into d/h/m/s with carry normalisation; the turn summary passes no options object,
so neither `mostSignificantOnly` nor `hideTrailingZeros` applies.

---

## 9. Species — exact strings

### 9.1 Sentinel tag constants, line 17765 VERBATIM

```js
17765    var BN = "command-name", bT = "command-message", nCt = "command-args", J$r = "bash-input", oCt = "bash-stdout", Aye = "bash-stderr", PCi = "bash-exit-code", LC = "local-command-stdout", hB = "local-command-stderr", bGe = "local-command-caveat", rLl, vye = "tick", iCt = "forked-skill-launch", Iy = "task-notification", $9 = "task-id", sCt = "tool-use-id", nLl = "task-type", Q$r = "output-file", gD = "status", wk = "summary", nrt = "Background command ", ZBn = 'Agent "', OCi = "worktree", NCi = "worktreePath", FCi = "worktreeBranch", lKt = "remote-review", cKt = "remote-review-progress", B9 = "teammate-message", aCt = "channel", Tye = '<channel source="', ort = "cross-session-message", irt = "agent-message", EGe = "fork-boilerplate", lCt = "Your directive: ", roe, COe, Om = b(() => {
17766      rLl = ["bash-input", "bash-stdout", "bash-stderr", "bash-exit-code", "local-command-stdout", "local-command-stderr", "local-command-caveat"], roe = ["help", "-h", "--help"], COe = ["list", "show", "display", "current", "view", "get", "check", "describe", "print", "version", "about", "status", "?"];
```

All of them, as a table:

| ident | value |
|---|---|
| `BN` | `"command-name"` |
| `bT` | `"command-message"` |
| `nCt` | `"command-args"` |
| `J$r` | `"bash-input"` |
| `oCt` | `"bash-stdout"` |
| `Aye` | `"bash-stderr"` |
| `PCi` | `"bash-exit-code"` |
| `LC` | `"local-command-stdout"` |
| `hB` | `"local-command-stderr"` |
| `bGe` | `"local-command-caveat"` |
| `vye` | `"tick"` |
| `iCt` | `"forked-skill-launch"` |
| `Iy` | `"task-notification"` |
| `$9` | `"task-id"` |
| `sCt` | `"tool-use-id"` |
| `nLl` | `"task-type"` |
| `Q$r` | `"output-file"` |
| `gD` | `"status"` |
| `wk` | `"summary"` |
| `nrt` | `"Background command "` (trailing space) |
| `ZBn` | `'Agent "'` (trailing quote char) |
| `OCi` | `"worktree"` |
| `NCi` | `"worktreePath"` |
| `FCi` | `"worktreeBranch"` |
| `lKt` | `"remote-review"` |
| `cKt` | `"remote-review-progress"` |
| `B9` | `"teammate-message"` |
| `aCt` | `"channel"` |
| `Tye` | `'<channel source="'` — **already includes the opening angle bracket and attribute** |
| `ort` | `"cross-session-message"` |
| `irt` | `"agent-message"` |
| `EGe` | `"fork-boilerplate"` |
| `lCt` | `"Your directive: "` (trailing space) |

Plus the grouped list on 17766: `rLl = ["bash-input", "bash-stdout", "bash-stderr",
"bash-exit-code", "local-command-stdout", "local-command-stderr", "local-command-caveat"]`.

Note most tags are stored **without** angle brackets; call sites build them
(`` `<${bT}>` ``, line 426489). `Tye` is the exception.

### 9.2 `ERe` — the full routing switch, every branch

Lines **426424–426532**. Fourteen exits, in evaluation order:

| # | line | condition (verbatim) | result |
|---|---|---|---|
| 1 | 426426 | `typeof yf.text !== "string" \|\| !yf.text \|\| yf.text.trim() === BC` | `null` |
| 2 | 426428 | `if (Ofa)` — `planContent` prop present | `<p4t addMargin planContent/>` |
| 3 | 426436 | `if (mc() && kvr(yf.text))` | `<cqo addMargin param verbose isTranscriptMode/>` |
| 4 | 426444 | `yf.text.startsWith(Tye) \|\| yf.text.startsWith(R7) && yf.text.startsWith(Tye, yf.text.indexOf("\n") + 1)` | `<UserChannelMessage addMargin param/>` (lazy import) |
| 5 | 426453 | `if (al(yf.text, vye))` — the `tick` tag | **`null`** |
| 6 | 426455 | `` yf.text.includes(`<${bGe}>`) `` — `<local-command-caveat>` | **`null`** |
| 7 | 426457 | `yf.text.startsWith("<bash-stdout") \|\| yf.text.startsWith("<bash-stderr")` | `<pqo content verbose/>` |
| 8 | 426465 | `yf.text.startsWith("<local-command-stdout") \|\| yf.text.startsWith("<local-command-stderr")` | `<Sqo content/>` |
| 9 | 426473 | `yf.text === Tq \|\| yf.text === Wk` | `<BP/>` |
| 10 | 426481 | `yf.text.includes("<bash-input>")` | `<T3t addMargin param/>` |
| 11 | 426489 | `` yf.text.includes(`<${bT}>`) `` — `<command-message>` | `<fqo addMargin param/>` |
| 12 | 426497 | `yf.text.includes("<user-memory-input>")` | `<Aqo addMargin text/>` |
| 13 | 426505 | `` yf.text.includes(`<${Iy}`) `` — `<task-notification` | `<Rvr addMargin param/>` |
| 14 | 426513 | `yf.text.includes("<mcp-resource-update") \|\| yf.text.includes("<mcp-polling-update")` | `<Pqo addMargin param/>` |
| 15 | 426521 | `yf.text.includes("<fork-boilerplate>")` | `<UserForkBoilerplateMessage addMargin param/>` (lazy import) |
| — | 426529+ | fallthrough | `<Mqo addMargin param isTranscriptMode timestamp/>` (the prompt echo) |

Note the **startsWith vs includes asymmetry**: bash-stdout/stderr and local-command-stdout/stderr use
`startsWith` (so they must open the message), while bash-input, command-message, user-memory-input,
task-notification, mcp-*, and fork-boilerplate use `includes` (they can appear anywhere).

Verbatim for the two `null` returns and the interrupt, lines **426453–426480**:

```js
426453      if (al(yf.text, vye))
426454        return null;
426455      if (yf.text.includes(`<${bGe}>`))
426456        return null;
426457      if (yf.text.startsWith("<bash-stdout") || yf.text.startsWith("<bash-stderr")) {
...
426473      if (yf.text === Tq || yf.text === Wk) {
426474        let eE;
426475        if (IAe[16] === X)
426476          eE = Yx.jsx(BP, {}), IAe[16] = eE;
426477        else
426478          eE = IAe[16];
426479        return eE;
426480      }
```

⚠ **CENSUS CONTRADICTION (undercount).** Census §6.3 tabulates **ten** sentinel routes. There are
**fifteen** exits before the fallthrough. The census omits: the empty/`BC` guard (1), `planContent`
(2), the `mc() && kvr` branch (3), the `<channel source="` branch (4), and the `tick` → `null`
branch (5). Also, `BC` is defined at line **104957** as `"(no content)"` — a user text of exactly
that string renders nothing.

### 9.3 The MCP resource-update form VERBATIM

Lines **426194–426196**:

```js
426194    function fSH(HEn, oz0) {
426195      return LX.jsx(I, { children: LX.jsxs(h, { children: [LX.jsx(h, { "aria-label": "update:", color: "success", children: tPi }), " ", LX.jsxs(h, { dimColor: !0, children: [HEn.server, ":"] }), " ", LX.jsx(h, { color: "suggestion", children: HEn.kind === "resource" ? lWp(HEn.target) : HEn.target }), HEn.reason && LX.jsxs(h, { dimColor: !0, children: [" \xB7 ", HEn.reason] })] }) }, oz0);
426196    }
```

`tPi = "↻"` (symbol table, 41482) = **↻** CLOCKWISE OPEN CIRCLE ARROW.

Rendered: `↻ <server>: <target> · <reason>` where
- `↻` — `color: "success"`, `aria-label="update:"`
- `<server>:` — `dimColor`
- `<target>` — **`color: "suggestion"`** (resources pass through `lWp()` first)
- ` · <reason>` — `dimColor`, only when a reason is present

The parser, lines **426197–426200**:

```js
426197    function Dqo(e) {
426198      let t = [], r = /<mcp-resource-update\s+server="([^"]+)"\s+uri="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/g, n;
426199      while ((n = r.exec(e)) !== null)
426200        t.push({ kind: "resource", server: n[1] ?? "", target: n[2] ?? "", reason: n[3] });
```

⚠ **CENSUS CONTRADICTION (two).** Census §6.3 cites this at line **426182** (it is **426195**) and
omits that the target is rendered in the **`suggestion`** colour, not plain.

### 9.4 `XWo` — compact boundary, both shapes with EXACT strings

**Shape A — with `summarizeMetadata`**, lines **422253–422281**:

```js
422253      let BHn = ByH, OAr = Wla.summarizeMetadata;
422254      if (OAr) {
422255        let KWo;
422256        if (e4e[2] === X)
422257          KWo = Gm.jsx(I, { minWidth: 2, children: Gm.jsx(h, { "aria-hidden": !0, color: "text", children: Za }) }), e4e[2] = KWo;
422258        else
422259          KWo = e4e[2];
422260        let NAr;
422261        if (e4e[3] === X)
422262          NAr = Gm.jsx(h, { bold: !0, children: "Summarized conversation" }), e4e[3] = NAr;
422263        else
422264          NAr = e4e[3];
422265        let Gyt;
422266        if (e4e[4] !== iRe || e4e[5] !== OAr)
422267          Gyt = !iRe && Gm.jsx(Cr, { children: Gm.jsxs(I, { flexDirection: "column", children: [Gm.jsxs(h, { dimColor: !0, children: ["Summarized ", OAr.messagesSummarized, " messages", " ", OAr.direction === "up_to" ? "up to this point" : "from this point"] }), OAr.userContext && Gm.jsxs(h, { dimColor: !0, children: ["Context: ", "“", OAr.userContext, "”"] }), Gm.jsx(h, { dimColor: !0, children: Gm.jsx(bn, { action: "app:toggleTranscript", context: "Global", fallback: "ctrl+o", description: "expand history", parens: !0 }) })] }) }), e4e[4] = iRe, e4e[5] = OAr, e4e[6] = Gyt;
422268        else
422269          Gyt = e4e[6];
422270        let jyt;
422271        if (e4e[7] !== iRe || e4e[8] !== BHn)
422272          jyt = iRe && Gm.jsx(Cr, { children: Gm.jsx(h, { children: BHn }) }), e4e[7] = iRe, e4e[8] = BHn, e4e[9] = jyt;
422273        else
422274          jyt = e4e[9];
422275        let YWo;
422276        if (e4e[10] !== Gyt || e4e[11] !== jyt)
422277          YWo = Gm.jsx(I, { flexDirection: "column", marginTop: 1, children: Gm.jsxs(I, { flexDirection: "row", children: [KWo, Gm.jsxs(I, { flexDirection: "column", children: [NAr, Gyt, jyt] })] }) }), e4e[10] = Gyt, e4e[11] = jyt, e4e[12] = YWo;
```

Exact strings:
- Bullet: `Za` (⏺), `color: "text"`, `aria-hidden`, `minWidth: 2` box.
- Title: **`"Summarized conversation"`**, bold.
- Body (only when **not** in transcript mode), inside `Cr`:
  - `["Summarized ", n, " messages", " ", direction === "up_to" ? "up to this point" : "from this point"]`
    → `Summarized 42 messages up to this point`, dim.
  - `["Context: ", "“", userContext, "”"]` → `Context: “…”` with **curly quotes**
    (U+201C / U+201D), dim, only when `userContext` is set.
  - chord hint with **`description: "expand history"`** → `(ctrl+o to expand history)`, dim.
- In transcript mode instead: `<Cr>{summaryText}</Cr>`.

**Shape B — without metadata**, lines **422282–422305**:

```js
422282      let KWo;
422283      if (e4e[13] === X)
422284        KWo = Gm.jsx(I, { minWidth: 2, children: Gm.jsx(h, { "aria-hidden": !0, color: "text", children: Za }) }), e4e[13] = KWo;
422285      else
422286        KWo = e4e[13];
422287      let NAr;
422288      if (e4e[14] !== iRe)
422289        NAr = !iRe && Gm.jsxs(h, { dimColor: !0, children: [" ", Gm.jsx(bn, { action: "app:toggleTranscript", context: "Global", fallback: "ctrl+o", description: "expand", parens: !0 })] }), e4e[14] = iRe, e4e[15] = NAr;
422290      else
422291        NAr = e4e[15];
422292      let Gyt;
422293      if (e4e[16] !== NAr)
422294        Gyt = Gm.jsxs(I, { flexDirection: "row", children: [KWo, Gm.jsx(I, { flexDirection: "column", children: Gm.jsxs(h, { bold: !0, children: ["Compact summary", NAr] }) })] }), e4e[16] = NAr, e4e[17] = Gyt;
422295      else
422296        Gyt = e4e[17];
422297      let jyt;
422298      if (e4e[18] !== iRe || e4e[19] !== BHn)
422299        jyt = iRe && Gm.jsx(Cr, { children: Gm.jsx(h, { children: BHn }) }), e4e[18] = iRe, e4e[19] = BHn, e4e[20] = jyt;
422300      else
422301        jyt = e4e[20];
422302      let YWo;
422303      if (e4e[21] !== Gyt || e4e[22] !== jyt)
422304        YWo = Gm.jsxs(I, { flexDirection: "column", marginTop: 1, children: [Gyt, jyt] }), e4e[21] = Gyt, e4e[22] = jyt, e4e[23] = YWo;
```

Exact strings:
- Title: **`"Compact summary"`** — bold, and the chord hint is a **child of the same bold Text**
  (`children: ["Compact summary", NAr]`), preceded by a literal space, with `dimColor` on the hint
  itself.
- Hint `description` here is **`"expand"`**, not `"expand history"` → `(ctrl+o to expand)`.
- Transcript-mode body: `<Cr>{summaryText}</Cr>`.
- Outer: `flexDirection: "column"`, `marginTop: 1` in both shapes.

⚠ **CENSUS CONTRADICTION.** Census §6.4 renders both hints as "`(ctrl+o to expand)`". The
metadata shape uses `description: "expand history"` → **`(ctrl+o to expand history)`**. Both hints
are keybinding lookups (`bn`), not literals; the shown text depends on the user's
`app:toggleTranscript` binding.

### 9.5 `Sha` — the generic system renderer VERBATIM

Lines **428608–428637**:

```js
428608    function Sha(kX0) {
428609      let aVo = N_t.c(17), { content: uqp, addMargin: LX0, dot: dqp, color: zEn, dimColor: KEn } = kX0, { columns: RX0 } = Br();
428610      const pqp = LX0 ? 1 : 0;
428611      let Xma;
428612      if (aVo[0] !== zEn || aVo[1] !== KEn || aVo[2] !== dqp)
428613        Xma = dqp && uo.jsx(I, { minWidth: 2, children: uo.jsx(h, { "aria-hidden": !0, color: zEn, dimColor: KEn, children: Za }) }), aVo[0] = zEn, aVo[1] = KEn, aVo[2] = dqp, aVo[3] = Xma;
428614      else
428615        Xma = aVo[3];
428616      const fqp = RX0 - 10;
428617      let Jma;
428618      if (aVo[4] !== uqp)
428619        Jma = uqp.trim(), aVo[4] = uqp, aVo[5] = Jma;
428620      else
428621        Jma = aVo[5];
428622      let Qma;
428623      if (aVo[6] !== zEn || aVo[7] !== KEn || aVo[8] !== Jma)
428624        Qma = uo.jsx(h, { color: zEn, dimColor: KEn, wrap: "wrap", children: Jma }), aVo[6] = zEn, aVo[7] = KEn, aVo[8] = Jma, aVo[9] = Qma;
428625      else
428626        Qma = aVo[9];
428627      let Zma;
428628      if (aVo[10] !== fqp || aVo[11] !== Qma)
428629        Zma = uo.jsx(I, { flexDirection: "column", width: fqp, children: Qma }), aVo[10] = fqp, aVo[11] = Qma, aVo[12] = Zma;
428630      else
428631        Zma = aVo[12];
428632      let YAH;
428633      if (aVo[13] !== pqp || aVo[14] !== Xma || aVo[15] !== Zma)
428634        YAH = uo.jsxs(I, { flexDirection: "row", marginTop: pqp, width: "100%", children: [Xma, Zma] }), aVo[13] = pqp, aVo[14] = Xma, aVo[15] = Zma, aVo[16] = YAH;
```

The **width-10 expression** is line **428616**: `const fqp = RX0 - 10;` where `RX0` is `columns` from
`Br()` (428609). The body box is `width: columns - 10`, not the outer row (which is `width: "100%"`).

Content is **`content.trim()` in a plain `<Text wrap="wrap">`** — **not** through the markdown
renderer. The dot is optional (`dqp && ...`) and shares the caller's colour and `dimColor`.

The caller that supplies its props, lines **428509–428515** (`dVo`'s fallthrough):

```js
428509      let Uma = Eh.content;
428510      if (typeof Uma !== "string")
428511        return null;
428512      const sb = Eh.level !== "info", n4 = Eh.level === "warning" ? "warning" : Eh.level === "notice" ? "inactive" : void 0, j1 = Eh.level === "info";
428513      let dW;
428514      if (g2[51] !== mU || g2[52] !== Uma || g2[53] !== sb || g2[54] !== n4 || g2[55] !== j1)
428515        dW = uo.jsx(I, { flexDirection: "row", width: "100%", children: uo.jsx(Sha, { content: Uma, addMargin: mU, dot: sb, color: n4, dimColor: j1 }) }), g2[51] = mU, g2[52] = Uma, g2[53] = sb, g2[54] = n4, g2[55] = j1, g2[56] = dW;
```

Level → presentation mapping:

| `level` | `dot` | `color` | `dimColor` |
|---|---|---|---|
| `"info"` | `false` | `undefined` | `true` |
| `"warning"` | `true` | `"warning"` | `false` |
| `"notice"` | `true` | `"inactive"` | `false` |
| anything else | `true` | `undefined` | `false` |

### 9.6 `dVo` — every subtype and its one-line treatment

Lines **428358–428518**. In evaluation order:

| line | subtype | treatment |
|---|---|---|
| 428359 | `turn_duration` | `<Aha message addMargin/>` — duration + budget + hidden-count footer |
| 428367 | `memory_saved` | `<vha message addMargin verbose={verbose \|\| !!isTranscriptMode}/>` |
| 428376 | `away_summary` | `<z3t content addMargin/>` |
| 428384 | `agents_killed` | `⏺` in **`color: "error"`** (`minWidth: 2` box) + dim `"All background agents stopped"` |
| 428398 | `thinking` | **`return null`** |
| 428400 | `model_refusal_no_fallback` | **`return null`** |
| 428402 | `model_refusal_fallback` | gated on **`lq()`**; `⏺` `color: "warning"` `aria-label="warning:"` + `<C4t color="warning" bold>{content}</C4t>`, then a dim second line `"  ⎿  "` + `"Tip: You can configure model switch behavior in /config"` |
| 428426 | `model_fallback` | `⏺` `color: "warning"` + `<Text color="warning" bold={trigger === "model_not_found" \|\| trigger === "permission_denied"} wrap="wrap">{content}</Text>` |
| 428446 | `bridge_status` | `<wha message addMargin/>` |
| 428454 | `scheduled_task_fire` | no dot; dim `[i5, " "]` (`✻ `) + `content`, all dim |
| 428473 | `permission_retry` | dim `[i5, " "]` (`✻ `) + `"Allowed "` (plain) + `<Text bold>{commands.join(", ")}</Text>` |
| 428497 | *(general gate)* | `if (subtype !== "stop_hook_summary" && !verbose && level === "info") return null` |
| 428499 | `api_error` | **`return null`** |
| 428501 | `stop_hook_summary` | `<Eha message addMargin verbose isTranscriptMode/>` |
| 428509 | *(fallthrough)* | `<Sha>` per §9.5; `null` if `content` is not a string |

Verbatim for the two glyph branches, lines **428457–428458** and **428476–428477**:

```js
428457        if (g2[31] === X)
428458          n4 = uo.jsxs(h, { "aria-hidden": !0, children: [i5, " "] }), g2[31] = n4;
...
428476      if (g2[37] === X)
428477        n4 = uo.jsxs(h, { "aria-hidden": !0, dimColor: !0, children: [i5, " "] }), j1 = uo.jsx(h, { children: "Allowed " }), g2[37] = n4, g2[38] = j1;
```

Note `scheduled_task_fire`'s glyph Text is **not** itself `dimColor` (its parent at 428463 is);
`permission_retry`'s **is**.

And the `model_refusal_fallback` tip line, 428415–428416:

```js
428415      if (g2[17] === X)
428416        dW = uo.jsxs(h, { dimColor: !0, children: [uo.jsx(h, { "aria-hidden": !0, children: "  ⎿  " }), "Tip: You can configure model switch behavior in /config"] }), g2[17] = dW;
```

The gutter literal here is **`"  ⎿  "`** — two spaces, `⎿`, **two** spaces. That is a
**hand-rolled 5-column gutter, not `Cr`** (which is `"  "` + `"⎿ \xA0"` — space + NBSP). Same
visible width, different bytes.

⚠ **CENSUS CONTRADICTION (three).**
1. Census §6.5 lists `api_error` among "dedicated branches (428446–428501)". It is **`return null`**
   (line 428499–428500).
2. Census omits the **general info-suppression gate** at line 428497: any subtype other than
   `stop_hook_summary` with `level === "info"` returns `null` unless `verbose` is on. This is a
   blanket suppression rule, not a per-subtype one, and it sits *after* nine subtype branches (so it
   does not affect them) but *before* the generic fallthrough.
3. Census cites `agents_killed` at 428388 and `thinking`/`model_refusal_no_fallback` at 428397/428399;
   the actual guard lines are **428384**, **428398** and **428400**.

The hook-summary renderer `Eha` (428520) — the `"Ran N <label> hooks"` line, lines **428529–428538**:

```js
428529      if (f4e.hookLabel) {
428530        let WEn;
428531        if (hle[2] === X)
428532          WEn = uo.jsx(h, { "aria-hidden": !0, children: "  ⎿  " }), hle[2] = WEn;
...
428535        const qEn = I4t === 1 ? "hook" : "hooks";
428536        let x4t;
428537        if (hle[3] !== I4t || hle[4] !== f4e.hookLabel || hle[5] !== qEn)
428538          x4t = uo.jsxs(h, { dimColor: !0, children: [WEn, "Ran ", I4t, " ", f4e.hookLabel, " ", qEn, ""] }), hle[3] = I4t, hle[4] = f4e.hookLabel, hle[5] = qEn, hle[6] = x4t;
```

Assembly: `"  ⎿  " + "Ran " + count + " " + hookLabel + " " + ("hook"|"hooks") + ""` — all dim.
Per-hook detail lines (`m4e.map(HvH)`) render **only in transcript mode** (line 428543).
Early return at 428527–428528 when there are no errors, no additional context, no prevented
continuation and no `hookLabel`.

### 9.7 `VAr` error sentinels — the branches and the constant DEFINITIONS

Guards before the switch, lines **422714–422725**:

```js
422714    function VAr(D40) {
422715      let w6 = YHn.c(32), { param: P40, addMargin: tca, shouldShowDot: x5p, verbose: k5p, onOpenRateLimitOptions: L5p } = D40, { text: T6 } = P40;
422716      if (dHr(T6))
422717        return null;
422718      if (Dcs(T6)) {
422719        let C_;
422720        if (w6[0] !== L5p || w6[1] !== T6)
422721          C_ = ka.jsx(l8o, { text: T6, onOpenRateLimitOptions: L5p }), w6[0] = L5p, w6[1] = T6, w6[2] = C_;
422722        else
422723          C_ = w6[2];
422724        return C_;
422725      }
```

The switch, lines **422726–422825** (quoted in full above in fragments; the branch list):

| line | `case` | rendering |
|---|---|---|
| 422727 | `die` | `return null` |
| 422729 | `XG` | `<Cr height={1}><Text color="error">{"Context limit reached · "}{DISABLE_COMPACT ? "/clear to continue" : "/compact or /clear to continue"}{warning ? ` · ${warning}` : ""}</Text></Cr>` |
| 422742 | `PYr` | `<Cr height={1}><Text color="error">Credit balance too low · Add funds: https://platform.claude.com/settings/billing</Text></Cr>` |
| 422750 | `lir` | `<aca/>` (a dedicated login component) |
| 422758 | `cir` | `<Cr height={1}><Text color="error">{cir}</Text></Cr>` — echoes the sentinel |
| 422766 | `Apo` \| `Spo` \| `vpo` | `<Cr><Text color="error">{T6}</Text></Cr>` — echoes the sentinel, **no `height`** |
| 422776 | `uir` | `<Cr height={1}><Text color="error">{uir}</Text></Cr>` |
| 422784 | `ect` | `<Cr height={1}><Text color="error">{ect}{API_TIMEOUT_MS && [" ", "(API_TIMEOUT_MS=", val, "ms, try increasing it)"]}</Text></Cr>` |
| 422792 | `Qlt` | `<Cr><Box column gap={1}><Text color="error">We are experiencing high demand for Opus 4.</Text><Text>To continue immediately, use /model to switch to {nm(wT())} and continue coding.</Text></Box></Cr>` |
| 422805 | `Zlt` | same, with **`We are experiencing high demand for Fable 5.`** |
| 422818 | `wq` | `<BP/>` |
| 422827 | *default*, `T6.startsWith(\`${XG} · \`)` | `<Cr><Text color="error">{T6}{" · /clear to start fresh"}{warning ? ` · ${warning}` : ""}</Text></Cr>` |
| 422840 | *default*, `JG(T6)` | `<lca text verbose addMargin/>` |
| 422848 | *default*, else | the ordinary assistant message (§7.2) |

**Constant definitions.** All the string sentinels live on **line 157931** (one `var` statement):

```js
157931    var kE = "API Error", qRu = "AWS credentials expired or invalid", VRu = "AWS authentication failed", zRu = "Google Cloud credentials expired or invalid", KRu = "Google Cloud authentication failed", XG = "Prompt is too long", ZZg = 0.8, tey, rey, PYr = "Credit balance is too low", lir = "Not logged in \xB7 Please run /login", cir = "Invalid API key \xB7 Fix external API key", Spo = "Your ANTHROPIC_API_KEY belongs to a disabled organization \xB7 Unset the environment variable to use your subscription instead", Apo = "Your ANTHROPIC_API_KEY belongs to a disabled organization \xB7 Update or unset the environment variable", ney = "...", oey = "...", iey = "...", sey = "...", uir = "OAuth token revoked \xB7 Please run /login", aey = "Login expired \xB7 Please run /login", BRu = "Authentication error \xB7 This may be a temporary network issue, please try again", vpo = "Authentication error \xB7 The gateway could not authenticate with its upstream provider — contact your gateway administrator", ley = "...", jcs = "https://status.claude.com", MYr = "Repeated 529 Overloaded errors", Qlt = "Opus is experiencing high load, please use /model to switch to Sonnet", Zlt = "Fable is experiencing high load, please use /model to switch to Sonnet", cey = "Server is temporarily limiting requests (not your usage limit)", ect = "Request timed out", uey = "...", mey = "cannot be used as an advisor when the request model is", eMu, M$ = b(() => {
```

Full literals for the requested identifiers:

| ident | line | **literal** |
|---|---|---|
| `XG` | 157931 | `"Prompt is too long"` |
| `PYr` | 157931 | `"Credit balance is too low"` |
| `ect` | 157931 | `"Request timed out"` |
| `Qlt` | 157931 | `"Opus is experiencing high load, please use /model to switch to Sonnet"` |
| `Zlt` | 157931 | `"Fable is experiencing high load, please use /model to switch to Sonnet"` |
| `wq` | 108575 | `"API Error: Request was aborted."` |
| `kE` | 157931 | `"API Error"` |
| `lir` | 157931 | `"Not logged in \xB7 Please run /login"` |
| `cir` | 157931 | `"Invalid API key \xB7 Fix external API key"` |
| `uir` | 157931 | `"OAuth token revoked \xB7 Please run /login"` |
| `Apo` | 157931 | `"Your ANTHROPIC_API_KEY belongs to a disabled organization \xB7 Update or unset the environment variable"` |
| `Spo` | 157931 | `"Your ANTHROPIC_API_KEY belongs to a disabled organization \xB7 Unset the environment variable to use your subscription instead"` |
| `vpo` | 157931 | `"Authentication error \xB7 The gateway could not authenticate with its upstream provider — contact your gateway administrator"` |
| `die` | 104957 | `"No response requested."` |
| `BC` | 104957 | `"(no content)"` |

**`Dcs` is a function, not a string.** Lines **156524–156526**:

```js
156524    function Dcs(e) {
156525      return LZg.some((t) => e.startsWith(t));
156526    }
```

`LZg` is the concatenation of four prefix lists:

```js
LZg = [...zBr, ...YBr, ...XBr, ...KBr]

zBr = ["You've hit your", "You've reached your", "You're out of usage credits", "Your org is out of usage \xB7 add funds to continue", "Your org is out of usage \xB7 contact your admin", "Your seat type doesn't include usage credits", "Your seat type doesn't include usage", "Your usage allocation has been disabled by your admin", "Your group's usage limit is set to $0", "Fable 5 requires usage credits", "You're out of extra usage", "Your seat type doesn't include extra usage"]
YBr = ["You've used", "You're close to"]
XBr = ["You're now using usage credits", "You're now using your usage allocation", "Now using your usage allocation", "Now using usage credits", "You're now using extra usage", "Now using extra usage"]
KBr = ["This service is disabled for your org"]
```

Twenty-one prefixes. `Dcs(text)` is true when the assistant text **starts with** any of them, and
routes to `l8o` (the rate-limit / upgrade-nudge component).

**The two other predicates.** `dHr`, lines **374375–374377**:

```js
374375    function dHr(e) {
374376      return Y7e(e).trim() === "" || e.trim() === BC;
374377    }
```

`JG`, lines **157167–157169**:

```js
157167    function JG(e) {
157168      return e.startsWith(kE) || e.startsWith(`Please run /login \xB7 ${kE}`) || e.startsWith(qRu) || e.startsWith(VRu) || e.startsWith(zRu) || e.startsWith(KRu);
157169    }
```

`JG` routes to `lca` (422868), which applies a **1000-character truncation** — lines 422870–422875:

```js
422868    function lca(N40) {
422869      let zyt = YHn.c(23), { text: T_H, verbose: R5p, addMargin: F40 } = N40, { columns: U40 } = Br(), $40 = cGo();
422870      const M5p = T_H === kE ? `${kE}: Please wait a moment and try again.` : T_H;
422871      let w_H, W3t;
422872      if (zyt[0] !== M5p || zyt[1] !== R5p) {
422873        let D5p = M5p.trim();
422874        W3t = !R5p && D5p.length > c8o;
422875        w_H = W3t ? D5p.slice(0, c8o) + "…" : D5p;
```

with `c8o = 1000`, line **422927**:

```js
422927    var qAr, ka, YHn, c8o = 1000, P5p = b(() => {
```

So a bare `"API Error"` becomes **`"API Error: Please wait a moment and try again."`**, and any
API-error text longer than 1000 characters is sliced to 1000 plus `…` unless `verbose`.

⚠ **CENSUS CONTRADICTION (three).**
1. Census §6.6 lists **seven** sentinel rows. The switch has **eleven** `case` labels (counting
   `Apo`/`Spo`/`vpo` as one fallthrough group) plus two default-branch predicates and the two
   pre-switch guards. Missing from the census: `die` → `null`, `lir`, `cir`, `uir`, the
   `Apo`/`Spo`/`vpo` group, the `dHr` empty-text guard, and the entire `JG`/`lca` path with its
   1000-char cap and the `"API Error"` → `"API Error: Please wait a moment and try again."` rewrite.
2. Census calls `Dcs` a set of "rate-limit texts". It is a **predicate over 21 prefix strings**
   (156524), not a text.
3. Census says "**All** of these are wrapped in `Cr` (the `⎿` gutter) with `height: 1`." Not all:
   `Apo`/`Spo`/`vpo` (422771), `Qlt` (422800), `Zlt` (422813) and the `${XG} · ` default (422835)
   use `Cr` **without** `height`, and `lir` → `<aca/>` and `wq` → `<BP/>` are not directly wrapped by
   `VAr` at all.

### 9.8 Teammate components — `Cvr`, `Ivr`, `xvr` VERBATIM

`Cvr` — live teammate message, lines **425444–425476**:

```js
425444    function Cvr(aq0) {
425445      let Xbn = Lvr.c(14), { displayName: WGp, inkColor: qGp, content: tpa, summary: rpa } = aq0, aEH;
425446      if (Xbn[0] === X)
425447        aEH = Wc.jsx(h, { "aria-hidden": !0, children: Ge.pointer }), Xbn[0] = aEH;
425448      else
425449        aEH = Xbn[0];
425450      let npa;
425451      if (Xbn[1] !== WGp || Xbn[2] !== qGp)
425452        npa = Wc.jsxs(h, { color: qGp, children: ["@ ", WGp, aEH] }), Xbn[1] = WGp, Xbn[2] = qGp, Xbn[3] = npa;
425453      else
425454        npa = Xbn[3];
425455      let opa;
425456      if (Xbn[4] !== rpa)
425457        opa = rpa && Wc.jsxs(h, { children: [" ", rpa] }), Xbn[4] = rpa, Xbn[5] = opa;
425458      else
425459        opa = Xbn[5];
425460      let ipa;
425461      if (Xbn[6] !== npa || Xbn[7] !== opa)
425462        ipa = Wc.jsxs(I, { children: [npa, opa] }), Xbn[6] = npa, Xbn[7] = opa, Xbn[8] = ipa;
425463      else
425464        ipa = Xbn[8];
425465      let spa;
425466      if (Xbn[9] !== tpa)
425467        spa = tpa && Wc.jsx(I, { paddingLeft: 2, children: Wc.jsx(km, { stripPromptTags: !1, children: tpa }) }), Xbn[9] = tpa, Xbn[10] = spa;
425468      else
425469        spa = Xbn[10];
425470      let lEH;
425471      if (Xbn[11] !== ipa || Xbn[12] !== spa)
425472        lEH = Wc.jsxs(I, { flexDirection: "column", marginTop: 1, children: [ipa, spa] }), Xbn[11] = ipa, Xbn[12] = spa, Xbn[13] = lEH;
425473      else
425474        lEH = Xbn[13];
425475      return lEH;
425476    }
```

Exact strings: header children are **`["@ ", displayName, <Text aria-hidden>{Ge.pointer}</Text>]`**
— literal `"@ "` (at-sign + space), the name, then `❯` with **no separating space**. The whole header
Text carries `color: inkColor`, so the `❯` inherits it. Optional summary is `[" ", summary]` in
default colour. Content goes through `km` (markdown) with **`stripPromptTags: false`** at
`paddingLeft: 2`. Outer `marginTop: 1`.

`Ivr` — collapsed, lines **425477–425495**:

```js
425477    function Ivr(lq0) {
425478      let zGp = Lvr.c(5), { displayName: VGp, count: cEH } = lq0, uEH;
425479      if (zGp[0] === X)
425480        uEH = Wc.jsxs(h, { "aria-hidden": !0, children: [Ge.pointerSmall, " "] }), zGp[0] = uEH;
425481      else
425482        uEH = zGp[0];
425483      const KGp = cEH === 1 ? "Message" : `${cEH} messages`;
425484      let dEH;
425485      if (zGp[1] === X)
425486        dEH = Wc.jsx(Bg, {}), zGp[1] = dEH;
425487      else
425488        dEH = zGp[1];
425489      let pEH;
425490      if (zGp[2] !== VGp || zGp[3] !== KGp)
425491        pEH = Wc.jsx(I, { marginTop: 1, children: Wc.jsxs(h, { dimColor: !0, children: [uEH, KGp, " from @", VGp, " ", dEH] }) }), zGp[2] = VGp, zGp[3] = KGp, zGp[4] = pEH;
425492      else
425493        pEH = zGp[4];
425494      return pEH;
425495    }
```

Exact assembly: `[<"› ">, ("Message" | "N messages"), " from @", displayName, " ", <Bg/>]`, all
`dimColor`. `Ge.pointerSmall = "›"` = `›`.

⚠ **CENSUS CONTRADICTION.** Census §6.7 gives the collapsed form as
"`› N messages from @<name> (ctrl+o to expand)`". For **count === 1** the literal is
**`"Message"`** (singular, capitalised, with no number) → `› Message from @name (ctrl+o to expand)`.

`xvr` — lifecycle, lines **425496–425520**:

```js
425496    function xvr(cq0) {
425497      let lqo = Lvr.c(15), { displayName: YGp, inkColor: XGp, idleReason: wvr, failureReason: apa } = cq0, JGp = wvr === "failed" ? "error" : wvr === "interrupted" ? "warning" : "success", QGp = wvr === "failed" ? "failed" : wvr === "interrupted" ? "was interrupted" : "finished", fEH;
425498      if (lqo[0] !== apa || lqo[1] !== wvr)
425499        fEH = wvr === "failed" && apa ? gp(apa).slice(0, snn) : void 0, lqo[0] = apa, lqo[1] = wvr, lqo[2] = fEH;
...
425503      if (lqo[3] !== JGp)
425504        cpa = Wc.jsx(h, { "aria-hidden": !0, color: JGp, children: Za }), lqo[3] = JGp, lqo[4] = cpa;
...
425508      if (lqo[5] !== YGp || lqo[6] !== XGp)
425509        upa = Wc.jsxs(h, { color: XGp, bold: !0, children: ["@", YGp] }), lqo[5] = YGp, lqo[6] = XGp, lqo[7] = upa;
...
425513      if (lqo[8] !== lpa)
425514        dpa = lpa && Wc.jsxs(h, { dimColor: !0, children: [": ", lpa] }), lqo[8] = lpa, lqo[9] = dpa;
...
425518      if (lqo[10] !== QGp || lqo[11] !== cpa || lqo[12] !== upa || lqo[13] !== dpa)
425519        mEH = Wc.jsx(I, { marginTop: 1, children: Wc.jsxs(h, { children: [cpa, " ", "Teammate", " ", upa, " ", QGp, dpa] }) }), lqo[10] = QGp, lqo[11] = cpa, lqo[12] = upa, lqo[13] = dpa, lqo[14] = mEH;
```

Exact assembly: `[⏺, " ", "Teammate", " ", <Text color={inkColor} bold>{"@" + name}</Text>, " ",
verb, optional <Text dim>{": " + reason}</Text>]`.

| `idleReason` | bullet colour | verb |
|---|---|---|
| `"failed"` | `"error"` | `"failed"` |
| `"interrupted"` | `"warning"` | `"was interrupted"` |
| anything else | `"success"` | `"finished"` |

The `: <reason>` suffix appears **only** when `idleReason === "failed"` and a `failureReason` exists;
it is first-lined (`gp`) then sliced to `snn`. Note the `@name` is **bold** here (it is not in `Cvr`).

### 9.9 The eight `*_FOR_SUBAGENTS_ONLY` tokens, line 156475

Extracted verbatim from the light theme block:

```js
red_FOR_SUBAGENTS_ONLY: "rgb(220,38,38)"
blue_FOR_SUBAGENTS_ONLY: "rgb(106,155,204)"
green_FOR_SUBAGENTS_ONLY: "rgb(22,163,74)"
yellow_FOR_SUBAGENTS_ONLY: "rgb(202,138,4)"
purple_FOR_SUBAGENTS_ONLY: "rgb(130,125,189)"
orange_FOR_SUBAGENTS_ONLY: "rgb(217,119,87)"
pink_FOR_SUBAGENTS_ONLY: "rgb(196,102,134)"
cyan_FOR_SUBAGENTS_ONLY: "rgb(8,145,178)"
```

Census §6.7 lists these eight values correctly. The other theme blocks on the same line, in file
order, are:

| theme block (order on line 156475) | red | blue | green | yellow | purple | orange | pink | cyan |
|---|---|---|---|---|---|---|---|---|
| 1st (light) | `rgb(220,38,38)` | `rgb(106,155,204)` | `rgb(22,163,74)` | `rgb(202,138,4)` | `rgb(130,125,189)` | `rgb(217,119,87)` | `rgb(196,102,134)` | `rgb(8,145,178)` |
| 2nd (light-ansi) | `ansi:red` | `ansi:blue` | `ansi:green` | `ansi:yellow` | `ansi:magenta` | `ansi:redBright` | `ansi:magentaBright` | `ansi:cyan` |
| 3rd (dark-ansi) | `ansi:redBright` | `ansi:blueBright` | `ansi:greenBright` | `ansi:yellowBright` | `ansi:magentaBright` | `ansi:redBright` | `ansi:magentaBright` | `ansi:cyanBright` |
| 4th (daltonized) | `rgb(204,0,0)` | `rgb(0,102,204)` | `rgb(0,204,0)` | `rgb(255,204,0)` | `rgb(128,0,128)` | `rgb(255,128,0)` | `rgb(255,102,178)` | `rgb(0,178,178)` |

Note `orange` and `red` collide in the ANSI themes (both `ansi:redBright` in dark-ansi), and `pink`
and `purple` collide (`ansi:magentaBright`) — so the eight-colour agent palette degrades to six
distinguishable colours on ANSI terminals.

Related tokens on the same line, for reference:

```js
permission: "rgb(87,105,247)"
diffAdded: "rgb(105,219,124)"        diffAddedDimmed: "rgb(199,225,203)"     diffAddedWord: "rgb(47,157,68)"
diffRemoved: "rgb(255,168,180)"      diffRemovedDimmed: "rgb(253,210,216)"   diffRemovedWord: "rgb(209,69,75)"
briefLabelYou: "rgb(37,99,235)"
userMessageBackground: "rgb(240, 240, 240)"
```

All six `userMessageBackground` values in file order:
`rgb(240, 240, 240)`, `ansi:white`, `ansi:blackBright`, `rgb(220, 220, 220)`, `rgb(55, 55, 55)`,
`rgb(55, 55, 55)`. Census §1.3's "rgb(240,240,240) light, rgb(55,55,55) dark, plus ansi:white /
ansi:blackBright" is confirmed (note the rgb values here carry spaces after the commas, unlike the
diff tokens).

---

## 10. Census-inference checks

### 10(a) Is there a third call site of `zAr`?

**No.** `grep -n "zAr" cli.pretty.js` returns exactly three lines:

```
422947:  function zAr(z40) {
427938:          return Bs.jsx(I, { marginTop: 1, children: Bs.jsx(zAr, { param: Oe, addMargin: !1, isTranscriptMode: !0, verbose: !0 }) }, ge.uuid);
429460:          I6 = Xp.jsx(zAr, { addMargin: gz, param: W1, isTranscriptMode: V_t, verbose: gre }), O4t[32] = gz, O4t[33] = V_t, O4t[34] = W1, O4t[35] = gre, O4t[36] = I6;
```

One definition, **two** call sites — 427938 and 429460, exactly the pair the census found.

**The census's inference upgrades to a proof.** At 427938 both flags are hard-coded `!0`. At 429460
the flags are `V_t` / `gre`, but the enclosing `case "thinking":` guard (line 429456) is
`if (!V_t && !gre) return null` — so reaching the `zAr` call requires at least one of them true.
Inside `zAr`, the collapsed branch is selected by `Y40 = O5p || N5p` being **false** (line 422957,
422969), which is exactly `!isTranscriptMode && !verbose`. That condition is unreachable from both
call sites.

Conclusion: **the single-line collapsed thinking form (`B5p.trim().replace(/\s+/g, " ")`, line
422969) is provably dead code in 2.1.220.** The census's hedge ("I did not exhaustively prove there
is no third caller") can be dropped.

### 10(b) `i9p(e, t, r = 3)` — does a call site pass a context arg?

**Yes.** See §6.11 for the full extraction. Summary:

- `i9p` is at **423953**, not 419971 (census cite is wrong).
- Exactly one call site: **424124**, `await i9p(e, t, zcr)`.
- `zcr = 3`, defined at **217814**.
- The parameter is a genuine context-line count: `BHH` (424033) uses it to walk `o` newlines
  backwards from the match and `o + 1` newlines forwards, producing the file window from which the
  structured patch is built (`_9p`, 424122–424130).

So "diff context = 3" is confirmed by a call site, not just a default parameter — but note the path:
this is the **optimistic/preview** patch builder used by `_9p`. It is the mechanism the census
guessed at, with the value it guessed, reached by a different route than the census described.

### 10(c) Does `Pt() === "macos"` hold?

**In this bundle, unconditionally yes — the check is not a check.** See §7.1 for the full quote.
`Pt` (line 18015) is `Vr(() => { try { return "macos" } catch (e) { return Ce(e), "unknown" } })` —
a memoized thunk whose body is a bare `return "macos"`. The `catch` is unreachable; there is no
`process.platform` read, no `os` call, no lookup against `WCi = ["macos", "wsl"]` (line 18014, which
is the type enumeration only).

Therefore `Za = Pt() === "macos" ? "⏺" : "●"` (line 41484) resolves to **`"⏺"` (⏺)**
at module-init on every run of this artifact, and every other `Pt()` call site in the bundle likewise
takes its macOS branch.

**Implementation guidance:** the platform ternary is a *source-level* construct that this build
constant-folded. A clone that wants product fidelity should keep the ⏺/● distinction keyed to the
host platform; a clone that wants to reproduce *this binary's* observable behaviour should hard-code
⏺. The two are only distinguishable off-macOS, where this bundle would not be the artifact in use.

---

## Appendix — census line-cite corrections, consolidated

Every line number in `02-transcript.md` that this pack found to be off. Semantics are unaffected
unless noted in the body above.

| census cite | actual | subject |
|---|---|---|
| 420493 | **420498** | `dHn()` strikethrough allowlist |
| 420651–420657 | **420648–420654** | `list_item` indent |
| 420672 | **420665–420666** | list marker + task checkbox |
| 420999 | **420994** | table grid characters |
| 421006 | **421002** | header force-centre call |
| 420950–420968 | **420926–420960** | three-way width fitting |
| 420990 | **420975** | `x()` vertical fallback |
| 421181–421195 | **421174 / 421180** | `Naa` content + border props |
| 421157 | **421161** | `Oaa` `gap: 1` |
| 421281 | **421280** | `hgH` regex (421281 is `KBp`) |
| 419887 | **419987** | `H2p` |
| 419888 | **419988** | diff gutter width |
| 419894–419898 | **419996–420001** | diff band/wrap body |
| 419971 | **423953** | `i9p(e, t, r = 3)` |
| 420005 | **420004** | `chH` |
| 423958 | **423932** | diff body width `columns - 12` |
| 423918 | **423922** | collapsed-diff return |
| 422857–422864 | **422848–422864** | `VAr` default branch |
| 426066 | **426069** | `xqo` pointer gutter |
| 426181 | **426183** | `tWp` / `Rqo` / `rWp` |
| 426182 | **426195** | MCP resource-update JSX |
| 422961–422965 | **422963 / 422969** | `zAr` gutter + content |
| 429447 | **429456** | `case "thinking"` guard (429447 is `redacted_thinking`) |
| 429444 | **429445** | `case "redacted_thinking"` |
| 428388 | **428384** | `agents_killed` |
| 428397 / 428399 | **428398 / 428400** | `thinking` / `model_refusal_no_fallback` → null |
| 420598–420603 | **420597–420602** | `f2` code case |
