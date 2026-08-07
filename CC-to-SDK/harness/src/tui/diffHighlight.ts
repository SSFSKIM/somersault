// tui/src/diffHighlight.ts — EP-R5 part 1 (W-R5): real highlight.js behind upstream's THREE diff scope
// maps. This is NOT `highlight.ts`. That module is a zero-dep clone of the markdown FENCED-CODE map `DhH`
// (L420495) — four chalk constants, theme-independent by a recorded decision — and it stays exactly as it
// is. The DIFF body is a different renderer with a different palette: `t2p` (L419465–419503) picks one of
// three scope maps and hands it to `i2p` (L419592), which runs hljs proper and walks the token tree.
//
// Everything below is transcribed from `~/claude-code-bundle/2.1.220/cli.pretty.js`:
//   `cd(r,g,b)`  L419438 — an RGB colour, `a: 255`
//   `Z3(n)`      L419441 — a PALETTE-INDEX colour, `{r: n, g: 0, b: 0, a: 0}`; `z$p` L419459 emits it as a
//                          bare `\x1b[38;5;n m`, i.e. the terminal's own palette entry, never an RGB triple
//   `K$p`        L419855 — 24 scopes, Monokai Extended (the dark palette)
//   `Y$p`        L419855 — 24 scopes, GitHub (the light palette); entirely different values, same keys
//   `jmH`        L419855 — 12 scopes, the 256-colour fallback
//   `GmH`        L419855 — the 17 declaration keywords that re-scope `keyword` → `_storage`
//   `X$p`        L419856 — five bare filenames → a language
//   `qmH`        L419571 — the scope → colour lookup, including the GmH irregularity and the dotted fallback
//   `o2p`        L419578 — the token-tree walk, and its scope INHERITANCE into unscoped children
//   `n2p`        L419530 — filename → language
//   `sre`/`rHn`  L419378 / L419369 — the lazily-built hljs singleton every one of those goes through
import { basename, extname } from "node:path";
import { createRequire } from "node:module";
import type { Segment } from "./render.js";
import { currentTheme, isLightTheme, type ThemeId } from "./theme.js";

/** `cd` L419438, rendered into the ONE colour encoding this harness's renderer takes. `diffRender.ts` —
 *  the module Tasks 10–12 wire this into — resolves every colour to hex AT PRODUCTION time
 *  (`resolveThemeColor(tokens.text)`), and `Line`'s `ink()` is idempotent on hex, so a hex string feeds
 *  straight through as a `Segment.color`. The bundle's literal triples are kept verbatim in the call sites
 *  below so the maps can be diffed against L419855 line-for-line. */
const cd = (r: number, g: number, b: number) => `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
/** `Z3` L419441. A palette INDEX, not a colour: kept in theme.ts's TH2 `ansi256(n)` grammar rather than
 *  resolved to hex, because resolving would throw away the whole point of `jmH`. `resolveThemeColor` turns
 *  it into an SGR index at the `Line` boundary; flattening it here would hand chalk an RGB triple and let
 *  it re-quantise to some *other* palette entry, which is exactly the fidelity `jmH` exists to keep. */
const Z3 = (n: number) => `ansi256(${n})`;

/** `K$p` L419855 — 24 scopes, Monokai Extended. */
const MONOKAI = new Map<string, string>([["keyword", cd(249, 38, 114)], ["_storage", cd(102, 217, 239)], ["built_in", cd(166, 226, 46)], ["type", cd(166, 226, 46)], ["literal", cd(190, 132, 255)], ["number", cd(190, 132, 255)], ["string", cd(230, 219, 116)], ["title", cd(166, 226, 46)], ["title.function", cd(166, 226, 46)], ["title.class", cd(166, 226, 46)], ["title.class.inherited", cd(166, 226, 46)], ["params", cd(253, 151, 31)], ["comment", cd(117, 113, 94)], ["meta", cd(117, 113, 94)], ["attr", cd(166, 226, 46)], ["attribute", cd(166, 226, 46)], ["variable", cd(255, 255, 255)], ["variable.language", cd(255, 255, 255)], ["property", cd(255, 255, 255)], ["operator", cd(249, 38, 114)], ["punctuation", cd(248, 248, 242)], ["symbol", cd(190, 132, 255)], ["regexp", cd(230, 219, 116)], ["subst", cd(248, 248, 242)]]);
/** `Y$p` L419855 — 24 scopes, GitHub. Same keys as `K$p`, not one shared value. */
const GITHUB = new Map<string, string>([["keyword", cd(167, 29, 93)], ["_storage", cd(167, 29, 93)], ["built_in", cd(0, 134, 179)], ["type", cd(0, 134, 179)], ["literal", cd(0, 134, 179)], ["number", cd(0, 134, 179)], ["string", cd(24, 54, 145)], ["title", cd(121, 93, 163)], ["title.function", cd(121, 93, 163)], ["title.class", cd(0, 0, 0)], ["title.class.inherited", cd(0, 0, 0)], ["params", cd(0, 134, 179)], ["comment", cd(150, 152, 150)], ["meta", cd(150, 152, 150)], ["attr", cd(0, 134, 179)], ["attribute", cd(0, 134, 179)], ["variable", cd(0, 134, 179)], ["variable.language", cd(0, 134, 179)], ["property", cd(0, 134, 179)], ["operator", cd(167, 29, 93)], ["punctuation", cd(51, 51, 51)], ["symbol", cd(0, 134, 179)], ["regexp", cd(24, 54, 145)], ["subst", cd(51, 51, 51)]]);
/** `jmH` L419855 — TWELVE scopes, not 24. The spec's "24-scope map" describes `K$p`/`Y$p`; the 256-colour
 *  fallback deliberately carries half of them, and the twelve it omits (`literal` aside — it HAS that one)
 *  fall through to the row foreground. Transcribed as-is: the missing cells are upstream's design, and
 *  inventing indices for them would be a divergence dressed as completeness. */
const ANSI256 = new Map<string, string>([["keyword", Z3(13)], ["_storage", Z3(14)], ["built_in", Z3(14)], ["type", Z3(14)], ["literal", Z3(12)], ["number", Z3(12)], ["string", Z3(10)], ["title", Z3(11)], ["title.function", Z3(11)], ["title.class", Z3(11)], ["comment", Z3(8)], ["meta", Z3(8)]]);

export type DiffPalette = "dark" | "light" | "ansi256";
const SCOPES: Record<DiffPalette, ReadonlyMap<string, string>> = { dark: MONOKAI, light: GITHUB, ansi256: ANSI256 };

/** `t2p`'s `foreground` term (L419493/419497/419502): the colour upstream forces onto every UNSCOPED span.
 *  Exported as data rather than applied here — see `highlightDiffLine` for why the segments come out
 *  unstyled instead. The `ansi256` cell is `t2p`'s DARK arm (`r ? Z3(7) : Z3(0)`); our `DiffPalette`
 *  collapses light/dark into one ANSI entry, so the light-terminal `Z3(0)` has nowhere to live. */
export const DIFF_FOREGROUND: Record<DiffPalette, string> = { dark: cd(248, 248, 242), light: cd(51, 51, 51), ansi256: Z3(7) };

/** `GmH` L419855. hljs emits `const`/`function`/`class`/… with scope `keyword`, the same as `return` or
 *  `if`; upstream re-scopes exactly these seventeen to `_storage` so declarations read differently from
 *  control flow. It is the one irregular arm of the scope lookup. */
const STORAGE_KEYWORDS = new Set(["const", "let", "var", "function", "class", "type", "interface", "enum", "namespace", "module", "def", "fn", "func", "struct", "trait", "impl"]);
/** `X$p` L419856 — five bare filenames, probed on the basename AND on its stem. */
const FILENAME_LANGS = new Map<string, string>([["Dockerfile", "dockerfile"], ["Makefile", "makefile"], ["Rakefile", "ruby"], ["Gemfile", "ruby"], ["CMakeLists", "cmake"]]);

/** `Wi(e, t)` L15182 — everything before the first occurrence, or the whole string. */
const before = (value: string, sep: string) => { const at = value.indexOf(sep); return at === -1 ? value : value.slice(0, at); };

// ── The hljs singleton ─────────────────────────────────────────────────────────────────────────────────
// A LAZY, memoized `require` of the FULL package — upstream's `rHn` (L419369) shape exactly (`if (eaa)
// return eaa; … eaa = t`), and for the same reason. Three facts decided this:
//   1. the diff path's language set is NOT a curated subset. `sre` (L419378) resolves a name through `ITs`
//      (L222529) against `aur`+`lur` (L222493) and then registers it out of the lazy loader registry `H$p`
//      (L418473) — the SAME registry the markdown path's `supportsLanguage` uses. 192 canonical names +
//      191 aliases, i.e. F4's `UPSTREAM_LANGS(383)`. `highlight.js@11.11.1` (the bundle's own version,
//      `DmH` L418956) pre-registers exactly those 192, so the full package IS the upstream set, for free.
//   2. `highlight.js/lib/core` costs 2 ms against the full package's ~60 ms, but buys that back only by
//      hand-porting `lur`'s 191 aliases and `Ntd`'s sub-language dependency graph — duplicated data with
//      its own drift risk, to save time we can simply defer instead.
//   3. deferring is free here: the REPL dynamic-imports its TUI, and this module is reached from the diff
//      renderer, which is reached from `toolRenderer` — i.e. at TUI MOUNT. A top-level `import` would put
//      those 60 ms on every session's startup path including sessions that never render a diff. Behind the
//      singleton they land once, on the first highlighted diff row.
// `createRequire` rather than `await import(...)` because `highlightDiffLine` is synchronous by contract.
const nodeRequire = createRequire(import.meta.url);
let cached: typeof import("highlight.js").default | undefined;
function hljs(): typeof import("highlight.js").default {
  return (cached ??= nodeRequire("highlight.js") as typeof import("highlight.js").default);
}

/** hljs's alias table IS `lur` (L222493) — that map was extracted from this very package — so upstream's
 *  `ITs` alias→canonical resolution is available without copying 191 rows: `getLanguage` returns the SAME
 *  definition object for an alias and for its canonical name, so one identity map over `listLanguages()`
 *  inverts the whole table. Built once, on first use. */
let canonicalByDefinition: Map<unknown, string> | undefined;
function canonicalLanguage(name: string): string | undefined {
  const api = hljs(), lower = name.toLowerCase(), definition = api.getLanguage(lower);
  if (!definition) return undefined;
  if (canonicalByDefinition === undefined) {
    canonicalByDefinition = new Map();
    for (const registered of api.listLanguages()) { const d = api.getLanguage(registered); if (d && !canonicalByDefinition.has(d)) canonicalByDefinition.set(d, registered); }
  }
  return canonicalByDefinition.get(definition) ?? lower;
}

/** `n2p` L419530, minus its third arm. Upstream also sniffs CONTENT — a `#!` shebang, a `<?php`/`<?xml`
 *  prologue — but only when it has the file body in hand; a diff row is not the file, and the signature
 *  Tasks 10–12 were planned against takes a path alone. Filename map first (probed on the basename and on
 *  its stem, so `CMakeLists.txt` resolves as cmake rather than as its `.txt`), then the extension. */
export function detectLanguage(filePath: string): string | undefined {
  const base = basename(filePath), named = FILENAME_LANGS.get(base) ?? FILENAME_LANGS.get(before(base, "."));
  if (named !== undefined) { const resolved = canonicalLanguage(named); if (resolved !== undefined) return resolved; }
  const ext = extname(filePath).slice(1);
  return ext === "" ? undefined : canonicalLanguage(ext);
}

/** Which of the three maps is live. Upstream selects by THEME NAME (`t2p` L419465 branches on
 *  `theme.includes("ansi")`) and treats colour depth separately: `e2p` L419442 reports `color256` when
 *  chalk's level is under 3, and `z$p` L419459 then DOWN-QUANTISES the Monokai/GitHub RGB at emit time. We
 *  ship no ANSI theme (theme.ts leaves both out of scope by an F1 decision), so that route would leave
 *  `jmH` ported and permanently unreachable. Binding it to COLORTERM instead is the brief's substitute and
 *  a recorded divergence: on a 256-colour terminal we paint the terminal's own palette where upstream
 *  paints a quantised Monokai. Both deps are injected so the unit tests never probe a real terminal. */
export function selectPalette(deps?: { env?: NodeJS.ProcessEnv; theme?: string }): DiffPalette {
  const colorterm = (deps?.env ?? process.env).COLORTERM?.toLowerCase() ?? "";
  if (colorterm !== "truecolor" && colorterm !== "24bit") return "ansi256";
  return isLightTheme((deps?.theme ?? currentTheme()) as ThemeId) ? "light" : "dark";
}

/** `qmH` L419571. Three arms in order: no scope → the row foreground; a `keyword` whose TEXT is a `GmH`
 *  declaration keyword → `_storage`; otherwise the scope, else its prefix before the first `.`, else the
 *  row foreground. `undefined` stands in for "the row foreground" — see `highlightDiffLine`. */
function scopeColor(scope: string | undefined, text: string, scopes: ReadonlyMap<string, string>): string | undefined {
  if (scope === undefined || scope === "") return undefined;
  if (scope === "keyword" && STORAGE_KEYWORDS.has(text.trim())) return scopes.get("_storage");
  return scopes.get(scope) ?? scopes.get(before(scope, "."));
}

/** The hljs token tree. `scope` is 11.x; `kind` is the pre-11 name upstream still reads, kept because
 *  `o2p` reads both and a grammar can still emit either. */
interface TokenNode { scope?: string; kind?: string; children: (TokenNode | string)[]; }
const isTokenTree = (emitter: unknown): emitter is { rootNode: TokenNode } => {
  if (typeof emitter !== "object" || emitter === null || !("rootNode" in emitter)) return false;
  const root = (emitter as { rootNode: unknown }).rootNode;
  return typeof root === "object" && root !== null && "children" in root;
};

/** `o2p` L419578. Note the INHERITANCE: a child node with no scope of its own is painted with its
 *  PARENT's scope, which is how the inside of a template literal or a sub-language block keeps its
 *  surrounding colour instead of dropping to the foreground. */
function walk(node: TokenNode, inherited: string | undefined, scopes: ReadonlyMap<string, string>, out: Segment[]): void {
  const scope = node.scope ?? node.kind ?? inherited;
  for (const child of node.children) {
    if (typeof child === "string") { const color = scopeColor(scope, child, scopes); out.push(color === undefined ? { text: child } : { text: child, color }); }
    else walk(child, scope, scopes, out);
  }
}

/** ONE diff row → styled segments. `i2p` L419592, with two deliberate departures, both so the result drops
 *  into `diffRender`'s existing row builder unchanged:
 *   1. UNSCOPED text comes back with NO `color`. Upstream stamps the palette's own `foreground` on it, but
 *      our diff rows already force a foreground of their own (`diffRender`'s `banded()` sets
 *      `resolveThemeColor(tokens.text)` on every span), so stamping a second one here would just fight it.
 *      `DIFF_FOREGROUND` is exported for a caller that wants upstream's exact value.
 *   2. NO trailing newline. `i2p` highlights `line + "\n"` — several grammars need the line end to close a
 *      comment or a preprocessor directive, so we append it too — but it then rides into upstream's
 *      `<Text>`; here the caller has already budgeted the row's width, so the newline is stripped back off
 *      the last segment. The invariant the tests pin is that the segments rejoin to the INPUT exactly.
 *  Every failure arm — no language, a language hljs rejects, a throw, an emitter whose shape moved — is
 *  upstream's own single unstyled span. */
export function highlightDiffLine(code: string, lang: string | undefined, palette: DiffPalette): Segment[] {
  const plain: Segment[] = [{ text: code }];
  if (lang === undefined || lang === "") return plain;
  let result;
  // `getLanguage` first: upstream only ever reaches `i2p` with an `sre`-resolved name, so an unregistered
  // one is OUR arm, not its. hljs answers it by `console.error`-ing and returning an unhighlighted result —
  // a log line straight into a live TUI frame — so the membership test has to come before the call. The
  // try/catch behind it stays as the total-function guard for a grammar that throws mid-parse.
  try { if (!hljs().getLanguage(lang)) return plain; result = hljs().highlight(code + "\n", { language: lang, ignoreIllegals: true }); } catch { return plain; }
  if (!isTokenTree(result._emitter)) return plain;
  const out: Segment[] = [];
  walk(result._emitter.rootNode, undefined, SCOPES[palette], out);
  const last = out[out.length - 1];
  if (last !== undefined && last.text.endsWith("\n")) {
    if (last.text === "\n") out.pop();
    else out[out.length - 1] = { ...last, text: last.text.slice(0, -1) };
  }
  return out.length === 0 ? plain : out;
}
