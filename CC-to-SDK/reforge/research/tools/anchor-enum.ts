// THE ANCHOR RULE, MECHANICALLY — shared by every tool that has to ask "can this
// declaration be taken by anchor?" and by no two of them differently.
//
// It was written inside `extract-hook-helpers.ts` for W7.6a's belt fixture,
// after that wave's first answer ("84 of 151 carry no string literal, so the
// belt is not takeable by anchor") turned out to have measured string literals
// rather than anchors and to have been wrong by a factor of six. The lesson the
// campaign recorded from that — a claim about a mechanism has to be measured by
// that mechanism's own definition — only holds if the definition has ONE
// implementation, so W8a lifted it here rather than copying it.
//
// What `strangle/anchor.ts` calls an anchor: a true substring of the chunk that
// occurs exactly once across the graph and bets on no minified identifier.
// Nothing about prose. The derivation is that rule:
//
//   1. TAINT every identifier the minifier may rename (`isStableName` keeps
//      property names, keys, method names and everything inside a literal).
//   2. Candidates are the MAXIMAL UNTAINTED RUNS of at least `MIN_ANCHOR`
//      characters.
//   3. A run occurring more than once graph-wide contains no unique substring at
//      all and is discarded; a unique run is narrowed by two pointers to its
//      SHORTEST unique window.
//   4. The winner is counted EXACTLY, so the reported numbers are measured even
//      though the search that found them was index-accelerated.
//
// `null` means the enumeration found no unique untainted run, with the number of
// candidates it considered — "unanchorable" as a measurement with a denominator.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { BUNDLE_MODULES } from "../../src/pin.js";
import { AMBIENT_GLOBALS } from "../../strangle/scope.js";

// ---- bundle-wide measurements ----------------------------------------------

/**
 * THE GRAPH'S TEXT MODULES — the exact population a splice's anchor is resolved
 * against, and not a near-neighbour of it.
 *
 * `strangle/prepare.ts` materializes `f === "cli" || f.endsWith(".js")`,
 * RECURSIVELY, and `resolveAnchor` then requires true-substring uniqueness
 * across everything it materialized. This reader used to take a flat
 * `.js`/`.mjs`/`.cjs` listing of the top level, which is 1,800 files and misses
 * two: the extensionless `cli`, and one nested module under
 * `src/plugins/functionHooks/hooks-worker/`. So the tool was answering "unique
 * among 1,800" for a question that is asked of 1,802 — a population gap in the
 * safe direction (a missed file can only make an anchor look MORE unique than
 * it is), but a gap, and one that two documents had already disagreed about.
 *
 * Measured at this pin: 1,802 modules, 34,375,923 characters.
 */
let GRAPH_TEXT: { file: string; text: string }[] | null = null;
export const bundle = (): { file: string; text: string }[] => {
  if (GRAPH_TEXT === null) {
    GRAPH_TEXT = readdirSync(BUNDLE_MODULES, { recursive: true, encoding: "utf8" })
      .filter((f) => f === "cli" || f.endsWith(".js"))
      .filter((f) => statSync(join(BUNDLE_MODULES, f)).isFile())
      .sort()
      .map((f) => ({ file: f, text: readFileSync(join(BUNDLE_MODULES, f), "utf8") }));
  }
  return GRAPH_TEXT;
};

/**
 * The whole graph as ONE string, plus an 8-gram occurrence index over it.
 *
 * WHY AN INDEX. Anchorability is now measured by ENUMERATION — every untainted
 * span of every declaration, counted graph-wide — which is thousands of
 * substring queries where the old literal scan made a few dozen. A full scan of
 * 34 MB costs about 10 ms, so the enumeration would cost minutes.
 *
 * The index is a saturating count of every 8-character window, bucketed by a
 * rolling hash. It is used in ONE direction only: a needle whose rarest 8-gram
 * bucket holds exactly one entry occurs at most once in the graph, because hash
 * collisions can only ADD to a bucket, never remove. So `bucket === 1` proves
 * uniqueness outright and anything else falls through to an exact count. The
 * approximation can therefore cost time, never correctness.
 *
 * The separator is eight spaces: it cannot forge a match inside a needle taken
 * from a declaration (those never contain an eight-space run in minified
 * source) and it keeps cross-file windows from being counted as real ones.
 */
const GRAM = 8;
const HASH_BITS = 26;
const HASH_BASE = 131;
let CORPUS: string | null = null;
let GRAMS: Uint8Array | null = null;
function corpus(): string {
  if (CORPUS === null) CORPUS = bundle().map((m) => m.text).join(" ".repeat(GRAM));
  return CORPUS;
}
function grams(): Uint8Array {
  if (GRAMS !== null) return GRAMS;
  const text = corpus();
  const counts = new Uint8Array(1 << HASH_BITS);
  const mask = (1 << HASH_BITS) - 1;
  let pow = 1;
  for (let i = 0; i < GRAM - 1; i++) pow = Math.imul(pow, HASH_BASE);
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    if (i >= GRAM) h = (h - Math.imul(text.charCodeAt(i - GRAM), pow)) | 0;
    h = (Math.imul(h, HASH_BASE) + text.charCodeAt(i)) | 0;
    if (i >= GRAM - 1) {
      const at = (h >>> 0) & mask;
      if (counts[at] < 255) counts[at]++;
    }
  }
  GRAMS = counts;
  return counts;
}

/** The rarest 8-gram bucket in `needle` — an UPPER BOUND on its occurrence count. */
export function gramBound(needle: string): number {
  const counts = grams();
  const mask = (1 << HASH_BITS) - 1;
  let pow = 1;
  for (let i = 0; i < GRAM - 1; i++) pow = Math.imul(pow, HASH_BASE);
  let h = 0;
  let best = 255;
  for (let i = 0; i < needle.length; i++) {
    if (i >= GRAM) h = (h - Math.imul(needle.charCodeAt(i - GRAM), pow)) | 0;
    h = (Math.imul(h, HASH_BASE) + needle.charCodeAt(i)) | 0;
    if (i >= GRAM - 1) best = Math.min(best, counts[(h >>> 0) & mask]);
  }
  return best;
}

let exactCounts = 0;
/** How many EXACT graph-wide scans the enumeration has spent — the denominator a fixture records. */
export const exactScans = (): number => exactCounts;
/**
 * Zero the work counter. The counter is module-level, so a tool that extracts
 * twice in one process would otherwise commit the SUM of both runs and its
 * fixture would depend on how many times it was called.
 */
export const resetExactScans = (): void => {
  exactCounts = 0;
};
/** Graph-wide occurrences of `needle`, stopping at `cap`. */
export function occurrences(needle: string, cap = 2): number {
  exactCounts++;
  const text = corpus();
  let n = 0;
  let at = 0;
  for (;;) {
    const i = text.indexOf(needle, at);
    if (i < 0) return n;
    n++;
    if (n >= cap) return n;
    at = i + 1;
  }
}

/** Does `needle` occur exactly once across the graph? */
export const isUnique = (needle: string): boolean => (needle.length >= GRAM && gramBound(needle) === 1) || occurrences(needle) === 1;


/**
 * ANCHORABILITY, MEASURED BY THE DOCTRINE'S OWN RULE.
 *
 * `strangle/anchor.ts` says what an anchor is: a TRUE SUBSTRING of the chunk
 * that occurs exactly once across the graph, chosen so that it does not bet on a
 * minified letter — `hui`→`q6t` and `yzv`→`APn` in a single pin bump is the
 * lesson. It says nothing about prose, and nothing about string literals. Rows
 * in this manifest are anchored on `].filter(Boolean)}`-shaped fragments,
 * property-name pairs and `?.` chains as readily as on sentences.
 *
 * The first version of this tool measured something else and reported it under
 * this name: it collected STRING LITERALS of at least twelve characters and
 * called a helper unanchorable when it had none. That is how "84 of 151 carry no
 * string literal at all" became "the belt is not takeable by anchor" — a claim
 * about a scan, restated as a claim about the mechanism. Six of the largest
 * supposedly-unanchorable helpers turn out to carry a one-occurrence anchor
 * apiece.
 *
 * So the derivation is now the rule itself:
 *
 *   1. TAINT every identifier the minifier is free to rename — every
 *      `Identifier` in a binding or value position that is not an ambient
 *      global. Property NAMES, object-literal KEYS, destructuring property
 *      names, class field and method names and everything inside a string or a
 *      regex are untainted: this bundler preserves them, which is the same bet
 *      the campaign's existing string-literal anchors already make, and it is a
 *      bet that fails LOUDLY — `resolveAnchor` throws when an anchor stops
 *      resolving, it does not silently excise the wrong node.
 *   2. The candidate spans are the MAXIMAL UNTAINTED RUNS of the declaration's
 *      own text, of at least `MIN_ANCHOR` characters. There is no twelve-char
 *      floor and no prose requirement.
 *   3. A run that occurs more than once graph-wide contains no unique substring
 *      at all — every substring occurs at least as often — so it is discarded
 *      with one count. A unique run is then narrowed by two pointers to the
 *      SHORTEST unique window inside it, which is well defined because
 *      uniqueness is monotone in both directions: if `[i, j)` is unique so is
 *      `[i, j+1)`, and the minimal end for `i` never decreases as `i` grows.
 *   4. The shortest window over all runs is the helper's anchor; the exact
 *      occurrence and FILE counts are then measured on it, not inferred.
 *
 * `null` means the enumeration found no unique untainted run — and the entry
 * records how many candidates it considered, so "unanchorable" is a measurement
 * with a denominator rather than a shrug.
 */
export const MIN_ANCHOR = 8;

/** Identifiers this bundler does not rename, so an anchor may span them. */
function isStableName(n: ts.Identifier): boolean {
  if (AMBIENT_GLOBALS.has(n.text)) return true;
  const p = n.parent;
  if (p === undefined) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === n) return true;
  if (ts.isQualifiedName(p) && p.right === n) return true;
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if (ts.isPropertyDeclaration(p) && p.name === n) return true;
  if (ts.isMethodDeclaration(p) && p.name === n) return true;
  if ((ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === n) return true;
  if (ts.isBindingElement(p) && p.propertyName === n) return true;
  if (ts.isEnumMember(p) && p.name === n) return true;
  // A shorthand `{a}` is deliberately NOT stable: renaming `a` rewrites it to
  // `{a: b}`, so the key moves with the binding.
  return false;
}

/** The maximal runs of `decl`'s text that carry no renameable identifier. */
export function untaintedRuns(decl: ts.Node, sf: ts.SourceFile, text: string): string[] {
  const from = decl.getStart(sf);
  const to = decl.getEnd();
  const cuts: [number, number][] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPrivateIdentifier(n)) cuts.push([n.getStart(sf), n.getEnd()]);
    else if (ts.isIdentifier(n) && !isStableName(n)) cuts.push([n.getStart(sf), n.getEnd()]);
    ts.forEachChild(n, visit);
  };
  visit(decl);
  cuts.sort((a, b) => a[0] - b[0]);
  const runs: string[] = [];
  let at = from;
  for (const [a, b] of cuts) {
    if (a > at) runs.push(text.slice(at, a));
    at = Math.max(at, b);
  }
  if (to > at) runs.push(text.slice(at, to));
  return runs.filter((r) => r.length >= MIN_ANCHOR);
}

export interface AnchorMeasurement {
  literal: string;
  /** graph FILES carrying it — 1 by construction, kept because the fixture is read by humans */
  files: number;
  occurrences: number;
}

/**
 * The shortest unique untainted window in `decl`, and how many runs were tried.
 *
 * THE SEARCH IS DRIVEN BY THE INDEX, and the reason is a measured one: the exact
 * form of this loop — two pointers over every window of every run, each window
 * settled by a graph-wide scan — did not finish in two minutes. The index makes
 * the same search essentially free, and it does so without weakening the answer:
 *
 *   * `gramBound(w) === 1` PROVES `w` is unique (collisions only add to a
 *     bucket), so every window this returns is a real anchor.
 *   * `gramBound` is monotone in both directions — growing a window adds 8-grams
 *     and can only lower the minimum; shrinking from the left can only raise it
 *     — so a two-pointer finds, for each start, the shortest window the index
 *     can certify, in one pass and with no scans at all.
 *   * The winner is then counted EXACTLY, once, which is where `files` and
 *     `occurrences` come from. So the fixture's numbers are measured even though
 *     the search that found them was approximate.
 *
 * What the approximation can cost is a character or two of length: a window the
 * index cannot certify may still be unique. That is why a helper the index finds
 * nothing for is not written off — every run is then counted exactly, and only a
 * run that genuinely occurs more than once is discarded (no substring of it can
 * be unique, since every substring occurs at least as often).
 */
export function anchorFor(decl: ts.Node, sf: ts.SourceFile, text: string): { anchor: AnchorMeasurement | null; candidates: number } {
  const runs = untaintedRuns(decl, sf, text);
  let best: string | null = null;
  for (const run of runs) {
    let j = MIN_ANCHOR;
    for (let i = 0; i + MIN_ANCHOR <= run.length; i++) {
      if (j < i + MIN_ANCHOR) j = i + MIN_ANCHOR;
      while (j <= run.length && gramBound(run.slice(i, j)) !== 1) j++;
      if (j > run.length) break;
      if (best === null || j - i < best.length) best = run.slice(i, j);
    }
  }
  // The index certified nothing. Fall back to exact counts, one per run: a run
  // that occurs more than once contains no unique substring at all, and a run
  // that occurs exactly once IS an anchor even though no 8-gram of it is rare.
  if (best === null) {
    for (const run of runs) {
      if (occurrences(run) !== 1) continue;
      if (best === null || run.length < best.length) best = run;
    }
  }
  if (best === null) return { anchor: null, candidates: runs.length };
  const files = bundle().filter((b) => b.text.includes(best!)).length;
  return { anchor: { literal: best, files, occurrences: occurrences(best, 8) }, candidates: runs.length };}
