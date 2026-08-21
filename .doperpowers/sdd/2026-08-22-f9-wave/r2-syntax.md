# R2 — Syntax-highlighting coverage (research, read-only)

Canon: `/Users/new/claude-code-bundle/2.1.236/cli.pretty.js` (735,247 lines / 35.3 MB).
ccx: `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness`.
Every canon claim below carries a line cite, read with `sed -n`.

---

## Headline

**ccx does not need a new dependency, a new library, or a language-set decision to close this gap.**
`highlight.js@11.11.1` — canon's own exact version — is already a production dependency of `cc-harness`
(`package.json`), is already lazily loaded behind a memoised singleton, and is already driving a full
383-name/alias language pipeline. It just isn't wired to the *markdown fenced-code* renderer, which still
runs a hand-written 10-language regex lexer.

The gap is a wiring job of one module (`src/tui/highlight.ts`), not a procurement decision.

---

## 1) ccx today

### 1a. Two independent highlighters, not one pipeline

| | markdown fenced code | diff bodies |
|---|---|---|
| module | `src/tui/highlight.ts` (120 LoC) | `src/tui/diffHighlight.ts` (210 LoC) |
| engine | hand-written single-pass regex lexer, zero-dep | **real `highlight.js@11.11.1`**, full package |
| languages it can COLOUR | **10** (`KNOWN_LANGS`) | **383** (hljs's whole registry + 12 extra aliases) |
| scopes it can emit | 4 (`keyword`/`string`/`number`/`comment`) | 24 (Monokai/GitHub) or 12 (ansi256) |
| callers | `markdown.ts::codeRuns` L96–106; `toolSummaries.ts::previewRows` L128–137 | `diffRender.ts` L241, L270, L321 |

They are genuinely separate concerns *by palette* — the diff body uses upstream's three RGB scope maps
(`Mmh`/`Lmh`/`Xiw`, canon L522472), the fenced block uses flat chalk constants (`jsw`, canon L523111) — but
they are **not** separate concerns by engine. Only history separates them: `highlight.ts` was written under an
F4 "no 1 MB dep for a LOW row" decision (its own header comment), and `diffHighlight.ts` overturned that
decision in Wave R without going back to revise the earlier module.

### 1b. `highlight.ts` mechanics

- `LANG` (L26) maps exactly 10 fence tags to 3 keyword regexes:
  `ts js tsx jsx` → the TS keyword set, `py python` → the Python set, `sh bash zsh` → the shell set,
  `json` → `true|false|null`. `KNOWN_LANGS = new Set(Object.keys(LANG))` (L100) is therefore **10 entries**.
- Colours are 4 bare ANSI names, hardcoded at L21: `KEYWORD="blue"`, `STRING="red"`, `NUMBER_COLOR="green"`,
  `COMMENT="green"`. The module imports no theme and is theme-independent by an explicit recorded decision.
- Tokenisation is per LINE (`markdown.ts` L101 splits on `\n` and calls `highlightCode` per line). Strings
  and comments are consumed atomically left-to-right; keywords/numbers are matched only in the plain runs
  between them.
- **Unregistered language → the whole line comes back plain** (`highlight.ts` L74: `if (!kwRe) return [{text: line}]`).
- There is no `hljs`-class → ANSI mapping at all in this module: it never produces hljs scopes, so nothing
  maps. The 4 colours are emitted directly as `Segment.color`.

### 1c. The label vs. body split is already correct

`markdown.ts` L96–100 implements canon's label polarity faithfully and uses **two different sets**:

- the dim raw-lang label is decided by `UPSTREAM_LANGS` (`highlight.ts` L112–128) — a 383-entry set;
- highlighted-vs-plain body is decided by `KNOWN_LANGS` — 10 entries.

I diffed `UPSTREAM_LANGS` against 2.1.236's `fnr` ∪ `mnr` (canon L184294) programmatically:
**383 vs 383, zero difference in either direction.** The label path is at exact parity with .236.

### 1d. `diffHighlight.ts` already solves every hard sub-problem

- lazy memoised `createRequire("highlight.js")` singleton with a total failure arm (L88–95);
- alias→canonical resolution by inverting `listLanguages()` over definition identity (L104–116) — no copied table;
- `EXTRA_ALIASES` (L101) covering the 12 names canon's `mnr` carries that hljs 11.11.1 does not
  (`mysql oracle freepascal lazarus lpr lfm php3…php8`) — I re-verified this is **exactly** the 12-name
  delta against the installed package;
- `detectLanguage()` (L124): canon's filename map (`Hmh`, L522473) + extension → canonical id;
- `walk()` (L156): the hljs `_emitter.rootNode` tree walk with parent-scope inheritance into unscoped children;
- an `isTokenTree` shape guard and a "segments must rejoin to the input exactly" invariant.

A fenced-code port reuses all of it. The only new pieces are a different scope map and a different
tree→style projection.

---

## 2) Canon 2.1.236

### 2a. Library and version

`highlight.js`, vendored inline. `qiw = "11.11.1"` at **L521621**, exposed as `e.versionString` at **L522023**.
**Identical to the version ccx already pins.** (Latest on npm is 11.12.0 — `npm view` confirmed; canon and ccx
are both one minor behind, together.)

### 2b. The registry — new architecture in .236

.236 replaced .220's eager `sre`/`rHn` singleton with a class `rbp` (**L184290–184399**) fronting a
lazy-loader registry `Omh` (**L522045–522048**):

```
Omh = { loadCore() {…}, resolveId: hEa, loaders: amh, subLanguageDeps: tbp }
```

- **`amh` (L521138) — 192 loader thunks**, one per canonical language, each `() => <commonjs module>`.
  I counted them mechanically: **192**, and the key set is identical to `fnr`'s.
- **`fnr` (L184294) — 192 canonical names → display names.**
- **`mnr` (L184294) — 191 aliases → canonical.** Includes the 12 hljs-11.11.1 doesn't ship
  (`mysql`, `oracle`, `freepascal`, `lazarus`, `lpr`, `lfm`, `php3`–`php8`).
- **`tbp` (L184294) — `subLanguageDeps`, 32 entries** (e.g. `typescript: [css, graphql, xml]`,
  `pgsql: [bash, java, json, lua, perl, php, python, r, ruby, scheme, tcl, xml]`).
- **`pEa` (L184292) — one non-hljs grammar, `cedar`**, defined inline by `fsS` (L184291) with alias
  `cedarpolicy` (`ebp`, L184292), registered eagerly in `core()` (L184310–184312).

**Count: 192 canonical + 191 aliases = 383, plus `cedar`/`cedarpolicy` = 385 resolvable names.**
`cedar` is *not* in `fnr`/`mnr` (verified), so `resolveId` returns null for it; `ensureLanguage` then falls
through to `hljs.getLanguage(n)` (L184340–184348), which finds it because `core()` registered it.

### 2c. Lazy or bundled?

**Both.** All 192 grammars are *bundled* in `cli.js` (the grammar block L519749–L521138 is **1.15 MB** of the
35.3 MB pretty file), but each is *initialised* only on first use:

`ensureLanguage(e, t)` (L184320–184350):
1. `core(t)` — build/return the singleton, registering `cedar` + any plugin grammars;
2. `t.resolveId(name.toLowerCase())` → `hEa` (L184420): `fnr` hit → itself; `mnr` hit → its canonical; else null;
3. if resolved and not yet loaded: `r.registerLanguage(o, gsS(t.loaders[o]()))`, add to `loaded`, then
   **recursively `ensureLanguage` every entry in `subLanguageDeps[o]`** (L184335);
4. failures memoised in `this.failed` so a broken grammar is tried once (L184330);
5. if unresolved: `getLanguage(name)` for runtime/plugin grammars, and if found, walk the grammar's own
   `subLanguage`/`contains`/`starts`/`variants` tree (`ysS`, L184400) to ensure its deps once
   (`runtimeDepsEnsured`, a `WeakSet`).

### 2d. Plugin-contributed grammars — entirely new, entirely unbuilt in ccx

Plugin manifests may declare `syntaxHighlighting.hljsLanguages` (schema `Xv_`, **L45699**), capped at
**`wIu = 16`** per plugin (L45687). Each entry is `{ id, remote, integrity }` where `remote` matches
`npm:<pkg>[@ver]` or `github:<owner>/<repo>@<ref>#<path>.js` and `integrity` is an SRI hash (L45699).
`addPluginLanguage` (L184362) rejects reserved ids, lower-cases and filters aliases against
`msS = /^[a-z0-9][a-z0-9_+#.-]{0,63}$/`, caps aliases at **`hsS = 16`** (L184411), forces
`disableAutodetect = true`, and validates by round-tripping `highlight("")` (L184381–184390).
`clearPluginLanguages` bumps a `generation` counter that React components read to invalidate memos
(`Tmt.pluginGrammarGeneration`, L184352; consumed at L527172).
Plugin hljs languages are trust-gated: `hljsLanguages: !0` in `kEb` and `!1` in `AEb` (L103080).

### 2e. Theming — fenced code

`jsw` (**L523111**) is a `Map` of **36 hljs scopes → chalk constants**, theme-independent (bare chalk, no
theme token). Grouped by style:

| chalk | scopes |
|---|---|
| `blue` | `keyword` `literal` `class` `title.class` `name` |
| `cyan` | `built_in` `attr` |
| `cyan.dim` | `type` |
| `green` | `number` `comment` `doctag` `addition` |
| `red` | `regexp` `string` `deletion` |
| `yellow` | `function` `title.function` |
| `grey` | `meta` `tag` |
| `italic` | `emphasis` |
| `bold` | `strong` |
| `underline` | `link` |
| `reset` (no style) | `subst` `symbol` `title` `params` `meta-keyword` `meta-string` `meta.keyword` `meta.string` `section` `attribute` `variable` `bullet` `code` `quote` |

Scope lookup `zsw` (**L523068**): strip a leading `hljs-`, look up; on miss, trim after the **last** `.` and
retry, repeatedly; if no dot remains, return undefined (→ unstyled). Note this is a **suffix-trimming loop**,
not ccx's single `before(scope, ".")` prefix fallback in `diffHighlight.ts::scopeColor` — for two-dot scopes
like `title.class.inherited` canon tries `title.class` *then* `title`, while ccx tries `title` only.

Tree walk `Ghh` (**L523075**): `children.map(Ghh).join("")`, then apply the node's own
`scope ?? kind` style to the whole joined string. Chalk nesting makes this equivalent to
"nearest scoped ancestor wins per character" — the same semantics as `diffHighlight.ts::walk`'s inheritance
parameter, so that walk is reusable, but it must be widened from `{color}` to a full `Partial<Segment>`
(canon needs `dim`, `italic`, `bold`, `underline` too).

The public surface is `Gsw = { highlight: qsw, supportsLanguage: Wsw }` (**L523112**);
`Wsw(e) { return uxe(e) !== null }` (L523102), and `uxe = Tmt.ensureLanguage(e, Omh)` (L522037).
**`supportsLanguage` is not a pure predicate — it lazily registers the grammar as a side effect.**

### 2f. Theming — diff bodies (unchanged from .220)

`Mmh` (Monokai, 24 scopes), `Lmh` (GitHub, 24 scopes), `Xiw` (ansi256, 12 scopes), `Jiw` (16 `_storage`
keywords), `Hmh` (5 filename→language) — all at **L522472–522473**. I diffed these against
`diffHighlight.ts`'s `MONOKAI`/`GITHUB`/`ANSI256`/`STORAGE_KEYWORDS`/`FILENAME_LANGS` transcriptions:
**value-for-value identical.** ccx's diff highlighter is still accurate against .236.

### 2g. Language inference

**Fenced code: fence info string only.** `c3`'s `code` case (**L523230**):

```js
let p = e.lang ?? "", f = p.match(/^[\w.+#-]+/)?.[0] ?? "",
    m = s && p && s.supportsLanguage(p) ? p : s && f && s.supportsLanguage(f) ? f : "plaintext",
    h = p && !s?.supportsLanguage(p) ? rr.dim(p) + jU : "";
if (!s) return h + e.text + jU;
return h + s.highlight(e.text, { language: m }) + jU;
```

No filename, no content sniffing, no length cap. `ccx/markdown.ts` L96–106 mirrors this exactly — **including**
the label polarity and the full-then-prefix resolution order. Two divergences worth naming:

1. **Canon highlights the WHOLE BLOCK in one call** (`s.highlight(e.text, …)`). ccx highlights **line by
   line**. With a real grammar this matters: block comments, multi-line template literals, heredocs and
   JSX spanning lines only colour correctly when the parser sees the whole block.
2. **`plaintext` is a real registered grammar** in canon (it's in `fnr`), so the fallback goes *through* hljs
   and comes back unscoped. ccx short-circuits to plain. Same output, no action needed.

**Elsewhere:** `hnr` (L184424) does extension → display-name for telemetry; the generic highlighted-code
component `aBl` (**L527166**) falls back to **`"markdown"`**, not plaintext, for an unsupported language
(L527177–527180) and logs `Language not supported while highlighting code, falling back to markdown`.
Diff bodies infer from the file path (`Hmh` + extension), which ccx already ports.

### 2h. The global off switch

`syntaxHighlightingDisabled` is a real user setting: read at L523928, L616371, L617012 (each memoising
`waw = wgh.syntaxHighlightingDisabled ? null : rce()`), stored at L545631/L545655, documented at L648853
(`` `syntaxHighlightingDisabled`: Disable diff highlighting ``). There is also an env override
`CLAUDE_CODE_SYNTAX_HIGHLIGHT` via `dtn()` (**L522478**) that gates the *diff* highlighter
(`Xmh`/`Zmh`/`_Nl`, L522480–522488). ccx ships neither — an existing recorded divergence, still accurate.

---

## 3) Options for ccx

Measured on this machine, `highlight.js@11.11.1` already installed at
`harness/node_modules/highlight.js` (9.1 MB on disk; npm `dist.unpackedSize` for 11.12.0 is 5,503,982 bytes /
1,569 files). `lib/languages/` holds 192 `.js` grammars (384 files incl. `.js.js` duplicates).
`hljs.listLanguages()` returns **192**, matching canon's `fnr` exactly.

Load timings (node, warm FS cache, 3 runs each):

| load shape | cost |
|---|---|
| `require("highlight.js")` (all 192) | **42 / 43 / 63 ms** |
| `require("highlight.js/lib/core")` | **1.75 / 1.77 / 1.83 ms** |
| core + 30 hand-picked languages | **17.5 ms** total (≈ 0.5 ms/lang after core) |
| one `registerLanguage` after core | ≈ 1.2 ms |
| first `hljs.highlight()` call | 5.6 ms |

### Option A — full `highlight.js` registration (what ccx already does for diffs)

**Bundle/install cost: zero incremental.** `highlight.js` is already a `dependencies` entry; the package is
already on disk; `files: ["dist","schema"]` means it is a runtime dep, not vendored, so `cc-harness`'s own
tarball does not grow at all. The only cost is the ~42–63 ms first-require.

**Startup cost: already being paid, conditionally.** `diffHighlight.ts` defers the require behind a
singleton reached from `toolRenderer` → `diffRender`, i.e. at first *highlighted diff row*, not at REPL
startup. If `highlight.ts` reuses that same singleton, a session that renders a fenced code block pays the
42–63 ms once instead of never — and a session that renders a diff pays nothing new.

**Verdict: the default.** ESM-friendly (ccx already uses `createRequire` for the sync contract), zero new
deps, and it is the only option that reaches 383 languages.

### Option B — canon's exact shape: `lib/core` + per-language lazy loaders

Canon does not `require` the index. It loads core (1.8 ms) and registers one grammar per language actually
seen, plus its `subLanguageDeps`. For ccx this is reproducible: `highlight.js/lib/languages/<canonical>.js`
exists for all 192 names, and `lib/index.js` is literally 192 `registerLanguage` lines — a 192-entry
`Record<string, () => unknown>` of dynamic imports replicates `amh` faithfully.

**Gain:** typical session cost drops from 42–63 ms to ~2 ms + ~1.2 ms × (languages seen + their deps) — for
a TS/bash/JSON session, roughly **5–8 ms instead of 50 ms**.

**Cost:** the alias table has to be ported by hand, because `lib/core` registers **no aliases**. ccx currently
gets all 179 working aliases free by inverting `listLanguages()` over definition identity — that trick
requires the full index. Canon's `mnr` (191 rows) would have to be transcribed, and `tbp` (32 rows) with it.
`diffHighlight.ts`'s own header (its point 2) already weighed and rejected this for exactly this reason.

**Verdict: a defensible follow-up, not a prerequisite.** It buys ~45 ms off one lazy path in exchange for
223 rows of copied, drift-prone data. Worth it only if TUI mount latency is measured to be a problem.

### Option C — curated subset expanded to the top N

Costs ~17 ms for 30 languages and still leaves 350+ names plain. It reintroduces exactly the judgement call
("which N?") that produced the current 10, and it needs the same alias table Option B needs to make `ts`,
`py`, `yml`, `rb`, `rs` resolve. **Strictly dominated by A and B.** Do not.

### Option D — `lowlight`

`lowlight@3.3.0`: 59,626 bytes unpacked, deps `highlight.js@~11.11.0` + `@types/hast` + `devlop`. It converts
hljs output to a **hast tree** — a shape ccx would have to re-walk into `Segment[]` anyway, since ccx already
walks `_emitter.rootNode` directly. Pure added indirection plus two transitive deps, against ccx's
dependency-light convention. **Reject.**

### Recommendation

Rewrite `src/tui/highlight.ts` on top of the `diffHighlight.ts` hljs singleton (Option A), exporting the
existing `walk`/`canonicalLanguage`/loader machinery from a shared module. Concretely:

1. Extract the singleton + `canonicalLanguage` + `EXTRA_ALIASES` + `walk` from `diffHighlight.ts` into a
   shared `hljsRuntime.ts`; widen `walk`'s output from `{color}` to `Partial<Segment>`.
2. Port canon's `jsw` (36 scopes, L523111) as a `Record<string, Partial<Segment>>` — the 11 distinct styles
   map cleanly onto `Segment`: `cyan.dim` → `{color:"cyan", dim:true}`, `italic`/`bold`/`underline` → the
   boolean flags, `reset` → `{}`.
3. Port `zsw`'s **suffix-trimming** loop (L523068), not a single prefix cut.
4. Highlight the **whole block** and split the result, not line by line.
5. Replace `KNOWN_LANGS` with a real `supportsLanguage` over the singleton, collapsing `KNOWN_LANGS` and
   `UPSTREAM_LANGS` into one set — which also fixes the label path's 2-name `cedar` delta if `cedar` is
   ported.
6. Point `toolSummaries.ts::previewRows` at `detectLanguage()` instead of its raw-extension `extensionOf`,
   which gets it the filename map and 191 aliases for free.

Keep `highlight.js` pinned at **11.11.1** (canon's exact version), not `^11.11.1` — it already is.

---

## 4) The delta that matters, and the parity-doc premises this reading contradicts

### 4a. Language delta

ccx colours **10** fence tags: `ts js tsx jsx json py python sh bash zsh` — three keyword regexes between them.
Canon colours **385**. The 373 canon colours and ccx does not is the whole of `fnr` ∪ `mnr` ∪ `{cedar,
cedarpolicy}` minus those 10.

Sorted by likelihood of appearing in an agent transcript, the ones that actually cost a reader:

- **top tier** — `rust`/`rs`, `go`/`golang`, `java`, `c`, `cpp`/`c++`/`cc`/`h`/`hpp`, `csharp`/`cs`/`c#`,
  `ruby`/`rb`, `php`, `swift`, `kotlin`/`kt`, `sql`, `yaml`/`yml`, `xml`/`html`/`svg`, `css`, `scss`, `less`,
  `markdown`/`md`, `diff`/`patch`, `dockerfile`/`docker`, `makefile`/`mk`, `ini`/`toml`, `graphql`/`gql`,
  `lua`, `perl`/`pl`, `r`, `scala`, `shell`/`console`/`shellsession`, `powershell`/`ps1`/`pwsh`,
  `protobuf`/`proto`, `nix`, `elixir`/`ex`, `haskell`/`hs`, `dart`, `objectivec`/`objc`, `vim`, `properties`,
  `nginx`, `apache`, `http`, `dos`/`bat`/`cmd`, `groovy`, `gradle`, `cmake`;
- **note also** — `shell` vs `bash` are *different* grammars in canon; ccx maps `sh|bash|zsh` to one regex.
  `console`/`shellsession` (prompt-and-output transcripts, common in READMEs) resolve to `shell`, which ccx
  has no notion of at all.

Because ccx already gets the **label** right for all 383, the visible symptom today is precise and slightly
odd: ` ```rust ` correctly draws no dim label — canon's signal for "I know this language" — and then renders
the body flat grey. The label promises highlighting the body doesn't deliver.

### 4b. Parity-doc premises this reading contradicts

**Contradicted — three rows, same fact.** `docs/parity/tui-ux.md` lines **197**, **1223** and **1938** all
score *"Syntax-highlighted diff bodies"* as ❌ / *"we render diff bodies plain"* / *"bounded by the same
10-language highlighter"*. All three are **stale**. `src/tui/diffHighlight.ts` ships real `highlight.js` with
all three of canon's scope maps, and `src/tui/diffRender.ts` calls `highlightDiffLine` at L241 and L270 with a
language resolved at L321. This is not a hidden regression — the doc's own staleness flag (lines 17–25) says
Wave R was never scored into the file, and this is one of those unscored Wave R rows. It should read ✅.

**Contradicted — dependency claim.** Line **928** describes ccx as having *"a zero-dependency syntax
highlighter (`tui/highlight.ts` — a manual regex lexer)"*. True of that module in isolation, but the harness
has taken a `highlight.js` dependency since Wave R; the sentence now misleads on the only question that
matters here (whether closing the gap costs a dependency — it does not).

**Contradicted — the "1 MB dep" framing.** `src/tui/highlight.ts`'s header justifies the hand lexer with
*"no 1MB dep for a LOW row"*. That trade was already overturned by `diffHighlight.ts`, in the same product,
for a comparable row. The comment should not be treated as a live constraint on F9.

**Under-described, not wrong.** `highlight.ts`'s header calls canon's fenced-code map `DhH` *"built from
CHALK CONSTANTS … `keyword: blue`, `string: red`, `number: green`, `comment: green`"*. That is 4 of **36**
entries. I read 2.1.220 L420495 to check whether the map grew: it did not — .220's `DhH` is the same 36-scope
map as .236's `jsw`. So the port was always a 4-of-36 subset, chosen to match what the hand lexer could emit.
Anyone reading that comment as "canon only paints four scopes" is being misled; the real map is §2e above.

**Confirmed still accurate.** The `syntaxHighlightingDisabled` divergence note in `markdown.ts` (the mode is
unreachable in ccx) — canon L523928/L545631/L648853 confirm the setting is real and ccx does not ship it.
The label-polarity port, the `UPSTREAM_LANGS` 383-entry set, and every value in the three diff scope maps all
verify clean against 2.1.236.

**New in .236, unscored anywhere.** (i) `cedar`/`cedarpolicy` — canon's one non-hljs built-in grammar,
making it 385 resolvable names, so ` ```cedar ` draws a dim label in ccx and none in canon. (ii) The whole
plugin `syntaxHighlighting.hljsLanguages` capability (§2d) — remote npm/github grammars with SRI integrity,
16 per plugin, 16 aliases each, generation-counter invalidation. Neither exists in ccx.
