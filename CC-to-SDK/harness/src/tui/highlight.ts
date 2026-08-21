// tui/src/highlight.ts — F9 T-SYNTAX Task 2: fenced-code highlighting on the real `highlight.js` singleton
// Task 1 extracted to `hljsRuntime.ts`, replacing the zero-dep four-colour lexer this module used to be.
// That lexer covered ten hand-picked languages against a spec Decision Log entry ("no 1MB dep for a LOW
// row") that this wave overturns: `hljsRuntime.ts` proved the dependency is ALREADY PAID — `diffHighlight.ts`
// (EP-R5) requires it for the diff body, so a second consumer here costs nothing but the lazy singleton's
// first hit. What upstream trades that cost for is real: 383 languages instead of ten, real grammars instead
// of a keyword/string/comment/number sketch, and colour that survives a block comment or a template literal
// spanning multiple lines — none of which a line-at-a-time regex lexer can do AT ALL, because it has no
// memory across lines.
//
// The scope→style table below is canon's `jsw` (bundle L523111), the fenced-code palette — a DIFFERENT map
// from `diffHighlight.ts`'s three (`K$p`/`Y$p`/`jmH`), which paint the DIFF body, not fenced markdown. Two
// things this table can express that the diff maps cannot: non-colour style axes (`emphasis`→italic,
// `strong`→bold, `link`→underline — markdown's own inline scopes, reachable because ```markdown fences
// exist), and a `{}` "reset row" of scopes hljs emits internally that must carry NO style of their own,
// spec §T-SYNTAX/S2's transcription of `jsw` verbatim.
import type { Segment } from "./render.js";
import { canonicalLanguage, loadHljs, walkEmitter, isTokenTree, type StyledRun } from "./hljsRuntime.js";

// ── the 36-scope canon table (`jsw` L523111) ────────────────────────────────────────────────────────────
/** Exported so the unit test can pin the map WHOLESALE (`Object.keys(SCOPE_STYLES).sort()` against the
 *  spec's full 36-name list) — the same "a subset port fails here" discipline `diffHighlight.ts`'s
 *  `DIFF_SCOPES` fixture uses for its own three maps, applied to this one. */
export const SCOPE_STYLES: Record<string, Partial<Segment>> = {
  // blue
  keyword: { color: "blue" }, literal: { color: "blue" }, class: { color: "blue" }, "title.class": { color: "blue" }, name: { color: "blue" },
  // cyan
  built_in: { color: "cyan" }, attr: { color: "cyan" },
  // cyan, dimmed
  type: { color: "cyan", dim: true },
  // green
  number: { color: "green" }, comment: { color: "green" }, doctag: { color: "green" }, addition: { color: "green" },
  // red
  regexp: { color: "red" }, string: { color: "red" }, deletion: { color: "red" },
  // yellow
  function: { color: "yellow" }, "title.function": { color: "yellow" },
  // grey
  meta: { color: "grey" }, tag: { color: "grey" },
  // one style axis each, no colour
  emphasis: { italic: true },
  strong: { bold: true },
  link: { underline: true },
  // the RESET ROW: scopes hljs emits that carry no style of their own AT ALL — `fenceResolver` below reads
  // an empty entry here as an instruction to clear whatever an ancestor painted, not to leave it alone.
  subst: {}, symbol: {}, title: {}, params: {}, "meta-keyword": {}, "meta-string": {}, "meta.keyword": {}, "meta.string": {},
  section: {}, attribute: {}, variable: {}, bullet: {}, code: {}, quote: {},
};

/** `zsw` L523068 — the suffix-trimming lookup. Strip a leading `hljs-` (the pre-11 class-name convention a
 *  few grammars still emit), then: exact lookup; on miss, trim everything after the LAST `.` and retry;
 *  when no dot is left, the scope is unstyled. This is why `title.class.inherited` finds `title.class`
 *  (one trim) rather than falling all the way to the unstyled bare `title` (two trims) — the loop stops at
 *  the FIRST hit, and `title.class` is its own entry. A single prefix cut (trimming everything after the
 *  FIRST dot) would skip straight past it. */
export function scopeStyle(scope: string): Partial<Segment> | undefined {
  let s = scope.startsWith("hljs-") ? scope.slice(5) : scope;
  for (;;) {
    if (Object.prototype.hasOwnProperty.call(SCOPE_STYLES, s)) return SCOPE_STYLES[s];
    const dot = s.lastIndexOf(".");
    if (dot === -1) return undefined;
    s = s.slice(0, dot);
  }
}

/** What `markdown.ts`'s label polarity and `toolSummaries.ts`'s highlight gate both ask: does the singleton
 *  know this tag at all (canonical name OR alias OR one of `hljsRuntime.ts`'s twelve `EXTRA_ALIASES`)? This
 *  is the ONE set — `KNOWN_LANGS` (ten hand-picked languages) and `UPSTREAM_LANGS` (a 383-entry string
 *  transcribed by hand from the bundle) both collapse into it, because the real registry answers both
 *  questions identically now that we highlight with it instead of a hand-rolled subset. */
export function supportsLanguage(tag: string): boolean {
  return canonicalLanguage(tag) !== null;
}

const STYLE_KEYS = ["color", "dim", "bold", "italic", "strikethrough", "underline", "bg"] as const;

/** The `walkEmitter` resolver for the fenced-code map — the fence-side counterpart of `diffHighlight.ts`'s
 *  `diffResolver`, but shaped differently because THIS palette has more than one style axis. A node with no
 *  scope of its own returns `{}` (no keys), which `walkEmitter`'s field-by-field merge reads as "change
 *  nothing" — Task 1's inheritance rule, and how a `strong` ancestor's `bold` survives past a nested
 *  `emphasis` child instead of one style fully replacing the other (both axes are independent, and neither
 *  entry mentions the other's key). A scoped node whose table entry NAMES fields (`{color:"blue"}`) sets only
 *  those, same reason. A scoped node landing on the RESET ROW (`scopeStyle` answers `{}`) is different: those
 *  scopes are canon's deliberate "nothing here, and don't let anything through either" markers — `subst`
 *  inside a red `string` must not read red — so every style key is set EXPLICITLY to `undefined`, which is
 *  what makes the merge CLEAR the inherited value instead of leaving it (the same shadowing
 *  `hljsRuntime.ts`'s own doc comment describes for `{color: undefined}`, generalised to every key at once). */
function fenceResolver(scope: string | undefined, _text: string): Partial<Segment> {
  if (scope === undefined || scope === "") return {};
  const style = scopeStyle(scope);
  if (style === undefined) return {};
  if (Object.keys(style).length === 0) {
    const cleared: Partial<Segment> = {};
    for (const key of STYLE_KEYS) cleared[key] = undefined;
    return cleared;
  }
  return style;
}

/** The total-function fallback every failure arm below shares: one segment per line, unstyled, the exact
 *  text back — hljs's own answer for `plaintext`, and this module's answer for "cannot highlight this". */
const plainLines = (code: string): Segment[][] => code.split("\n").map((text) => [{ text }]);

/** A `StyledRun`'s text may itself contain literal `\n`s — a block comment or a multi-line string is ONE
 *  leaf in hljs's tree, so `walkEmitter` hands it back as one run whose text spans several source lines.
 *  Splitting every run on `\n` and starting a fresh line array at each boundary is what turns the flat
 *  stream back into per-line rows while keeping a comment green (or a string red) on every line it crosses
 *  — the whole-block proof spec §T-SYNTAX/S2 calls for. An empty piece (two adjacent newlines, or a split
 *  landing exactly on a boundary) contributes no segment, matching `highlightCode`'s old "a blank line
 *  highlights to nothing" contract that `toolSummaries.ts` already depends on. */
function splitRunsByLine(runs: readonly StyledRun[]): Segment[][] {
  const lines: Segment[][] = [[]];
  for (const run of runs) {
    const { text, ...style } = run;
    const parts = text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part !== "") lines[lines.length - 1]!.push({ text: part, ...style });
    });
  }
  return lines;
}

/** `o2p` applied to a WHOLE fence body (canon L523230) rather than one row at a time — the fix the diff path
 *  never needed (a diff row IS one line by construction) but fenced code does: a language tag hljs cannot
 *  even parse correctly is unknown to it, an unregistered tag has no grammar, and a JSON/JS/TS parse of code
 *  containing a genuine syntax error still highlights via `ignoreIllegals: true` (upstream's own choice —
 *  the alternative is a red wall where a typo sits). Every failure arm — unresolved tag, a missing/broken
 *  hljs install, a grammar that throws, an emitter shape hljs's own internals didn't produce — takes the
 *  same plain-lines answer a diff row's failure arm takes, for the same PAINT-PATH reason `hljsRuntime.ts`
 *  gives `loadHljs`: this sits where a thrown exception would blank a whole rendered frame, not just dull
 *  one row of it. */
export function highlightBlock(code: string, lang: string): Segment[][] {
  const canonical = canonicalLanguage(lang);
  if (canonical === null) return plainLines(code);
  const api = loadHljs();
  if (api === null) return plainLines(code);
  let result;
  try {
    result = api.highlight(code, { language: canonical, ignoreIllegals: true });
  } catch {
    return plainLines(code);
  }
  if (!isTokenTree(result._emitter)) return plainLines(code);
  return splitRunsByLine(walkEmitter(result._emitter.rootNode, fenceResolver));
}
