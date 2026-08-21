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
//   `GmH`        L419855 — the 16 declaration keywords that re-scope `keyword` → `_storage`
//   `X$p`        L419856 — five bare filenames → a language
//   `qmH`        L419571 — the scope → colour lookup, including the GmH irregularity and the dotted fallback
//   `o2p`        L419578 — the token-tree walk, and its scope INHERITANCE into unscoped children
//   `n2p`        L419530 — filename → language
//   `sre`/`rHn`  L419378 / L419369 — the lazily-built hljs singleton every one of those goes through
//
// F9 T-SYNTAX Task 1 moved the singleton, the alias inversion, EXTRA_ALIASES, the filename map, and the
// o2p walk out to hljsRuntime.ts, so a second tree-to-style projection (the fenced-code map) can share
// them instead of re-solving the same five sub-problems. What stays HERE is diff-specific: the three
// scope-to-colour maps, GmH's text-sensitive re-scoping, and the thin adapters that keep every one of
// this module's exported shapes — detectLanguage's `undefined` (not the runtime's `null`), `Segment`, not
// `Partial<Segment>` — exactly as every existing caller and test/unit/diff-highlight.test.ts already
// expect.
import type { Segment } from "./render.js";
import { currentTheme, isLightTheme, type ThemeId } from "./theme.js";
import { loadHljs, detectLanguage as detectLanguageCanonical, walkEmitter, isTokenTree } from "./hljsRuntime.js";

export { FILENAME_LANGS, setHljsLoaderForTest } from "./hljsRuntime.js";

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
/** Exported so `test/unit/diff-highlight.test.ts` can assert the three maps WHOLESALE against a fixture of
 *  the transcription. Reaching every cell through a real hljs sample is impossible (several scopes no
 *  grammar in the sample set emits), so an unpinned cell would otherwise be free to rot silently. */
export const DIFF_SCOPES: Record<DiffPalette, ReadonlyMap<string, string>> = { dark: MONOKAI, light: GITHUB, ansi256: ANSI256 };

/** `t2p`'s `foreground` term (L419493/419497/419502): the colour upstream forces onto every UNSCOPED span.
 *  Exported as data rather than applied here — see `highlightDiffLine` for why the segments come out
 *  unstyled instead. The `ansi256` cell is `t2p`'s DARK arm (`r ? Z3(7) : Z3(0)`); our `DiffPalette`
 *  collapses light/dark into one ANSI entry, so the light-terminal `Z3(0)` has nowhere to live. */
export const DIFF_FOREGROUND: Record<DiffPalette, string> = { dark: cd(248, 248, 242), light: cd(51, 51, 51), ansi256: Z3(7) };

/** `GmH` L419855. hljs emits `const`/`function`/`class`/… with scope `keyword`, the same as `return` or
 *  `if`; upstream re-scopes exactly these sixteen to `_storage` so declarations read differently from
 *  control flow. It is the one irregular arm of the scope lookup. */
export const STORAGE_KEYWORDS = new Set(["const", "let", "var", "function", "class", "type", "interface", "enum", "namespace", "module", "def", "fn", "func", "struct", "trait", "impl"]);

/** `Wi(e, t)` L15182 — everything before the first occurrence, or the whole string. Kept local rather than
 *  imported from `hljsRuntime.ts`: it is a one-line transcription helper, not a table, and both modules
 *  reach for it over unrelated data (there the filename stem, here the scope's dotted prefix). */
const before = (value: string, sep: string) => { const at = value.indexOf(sep); return at === -1 ? value : value.slice(0, at); };

/** `n2p` L419530. Delegates to `hljsRuntime.ts`'s `detectLanguage`, converting its `null` ("not found")
 *  to the `undefined` every existing caller of THIS module's `detectLanguage` already depends on. */
export function detectLanguage(filePath: string): string | undefined {
  return detectLanguageCanonical(filePath) ?? undefined;
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

/** The `walkEmitter` resolver for the diff palette. Two things make this more than a bare `scopeColor`
 *  wrapper:
 *   1. a node with NO scope of its own must return `{}` (no `color` key at all) rather than
 *      `{ color: undefined }`, so `walkEmitter`'s field-by-field merge lets the nearest scoped ancestor's
 *      colour fall through UNCHANGED — this is `o2p`'s inheritance-into-unscoped-children.
 *   2. a node WITH its own scope must always set the `color` key, even when `scopeColor` answers
 *      `undefined` for it — that is upstream's SHADOWING, not inheritance: once a node's own scope has
 *      been consulted, its (possibly colourless) answer replaces whatever an ancestor supplied, the way
 *      `subst` nested inside a coloured `string` still comes out uncoloured on the `ansi256` palette,
 *      which carries no `subst` cell. Returning `{ color: undefined }` here — not omitting the key — is
 *      what makes `walkEmitter`'s merge clear the inherited colour instead of keeping it. */
function diffResolver(scopes: ReadonlyMap<string, string>): (scope: string | undefined, text: string) => Partial<Segment> {
  return (scope, text) => (scope === undefined || scope === "" ? {} : { color: scopeColor(scope, text, scopes) });
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
  // one is OUR arm, not its. hljs answers it by `console.error`-ing AND THEN throwing — the try/catch below
  // would swallow the throw, but the log line is already on stdout, straight into a live TUI frame — so the
  // membership test has to come before the call. The try/catch behind it stays as the total-function guard
  // for a grammar that throws mid-parse.
  try { const api = loadHljs(); if (api === null || !api.getLanguage(lang)) return plain; result = api.highlight(code + "\n", { language: lang, ignoreIllegals: true }); } catch { return plain; }
  if (!isTokenTree(result._emitter)) return plain;
  const out: Segment[] = walkEmitter(result._emitter.rootNode, diffResolver(DIFF_SCOPES[palette]));
  const last = out[out.length - 1];
  if (last !== undefined && last.text.endsWith("\n")) {
    if (last.text === "\n") out.pop();
    else out[out.length - 1] = { ...last, text: last.text.slice(0, -1) };
  }
  return out.length === 0 ? plain : out;
}
