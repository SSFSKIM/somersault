// tui/src/hljsRuntime.ts — F9 T-SYNTAX Task 1. The hljs machinery EP-R5 built for the diff pipeline
// (`diffHighlight.ts`), extracted so a second consumer — the fenced-code map Task 2 wires in — can share
// it instead of re-solving the same five sub-problems: the lazy memoised singleton with a total-failure
// arm, alias→canonical resolution, the bare-filename map, and the `_emitter.rootNode` tree walk. Every
// comment below that cites a bundle line number is transcribed verbatim from `diffHighlight.ts`, which is
// where the archaeology against `~/claude-code-bundle/2.1.220/cli.pretty.js` originally happened; nothing
// here is a new reading of the bundle, only a relocation of an existing one.
//
// One divergence from the moved code's own convention: every "not found" return here is `null`, not
// `undefined`. `diffHighlight.ts` used `undefined` throughout (and keeps doing so at its own boundary —
// its exported `detectLanguage` still answers `undefined`, unedited call sites depend on it); `null` is
// this module's own choice, made because it is a wider surface now serving MULTIPLE tree→style projections
// (the diff maps today, the fenced-code map next), and `Partial<Segment>`'s optional fields already
// overload `undefined` to mean "field not set" — a second, unrelated meaning of `undefined` at the same
// module boundary invites exactly the kind of bug this extraction exists to avoid.
import { basename, extname } from "node:path";
import { createRequire } from "node:module";
import type { Segment } from "./render.js";

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
//   3. deferring is free here: the REPL dynamic-imports its TUI, and the diff renderer that reaches this
//      module is reached from `toolRenderer` — i.e. at TUI MOUNT. A top-level `import` would put those
//      60 ms on every session's startup path including sessions that never render a diff. Behind the
//      singleton they land once, on the first highlighted diff row (or fenced code block).
// `createRequire` rather than `await import(...)` because every caller of `loadHljs()` is synchronous by
// contract. The load itself is TOTAL: a missing or corrupt `highlight.js` resolves to `null` (memoized, so
// a broken install is not re-required once per call) and every caller then takes the same degraded arm a
// rejected language takes. This module sits on the PAINT path — throwing where a caller degrades would
// turn one bad dependency into a dead frame instead of a dull one.
export type HljsApi = typeof import("highlight.js").default;
const nodeRequire = createRequire(import.meta.url);
const realLoad = (): HljsApi => nodeRequire("highlight.js") as HljsApi;
let load = realLoad, cached: HljsApi | undefined, loadFailed = false;
/** `sre`/`rHn` (L419378/L419369). Memoised singleton with a total-failure arm — `null`, not a throw. */
export function loadHljs(): HljsApi | null {
  if (cached !== undefined) return cached;
  if (loadFailed) return null;
  try { cached = load(); } catch { loadFailed = true; return null; }
  return cached;
}
/** The loader seam (house style: `reflowOracle.ts`'s `resetReflowProbingForTest`). Swapping the loader has
 *  to drop BOTH memos built off the old one — the singleton and the alias inversion. No argument restores
 *  the real `require`. */
export function setHljsLoaderForTest(next?: () => HljsApi): void { load = next ?? realLoad; cached = undefined; loadFailed = false; canonicalByDefinition = undefined; }

/** hljs's alias table IS `lur` (L222493) — that map was extracted from this very package — so upstream's
 *  `ITs` alias→canonical resolution is available without copying 191 rows: `getLanguage` returns the SAME
 *  definition object for an alias and for its canonical name, so one identity map over `listLanguages()`
 *  inverts the whole table. Built once, on first use. */
let canonicalByDefinition: Map<unknown, string> | undefined;
/** …with TWELVE exceptions. `lur` (L222493) is a SUPERSET of the alias table `highlight.js@11.11.1` ships:
 *  these twelve rows resolve upstream and return `undefined` from `getLanguage` here, so a `.php5` or a
 *  `.mysql` diff would come out unhighlighted while the SAME name gets a language label on the fenced-code
 *  path (F4's `UPSTREAM_LANGS` already carries all twelve). Mapped to the canonical grammar `lur` points
 *  each at, so the two paths agree. */
export const EXTRA_ALIASES = new Map<string, string>([["mysql", "sql"], ["oracle", "sql"], ["freepascal", "delphi"], ["lazarus", "delphi"], ["lpr", "delphi"], ["lfm", "delphi"], ["php3", "php"], ["php4", "php"], ["php5", "php"], ["php6", "php"], ["php7", "php"], ["php8", "php"]]);
/** `ITs` L222529. Alias or canonical name → the canonical name hljs itself would register it under, or
 *  `null` when hljs (with the `EXTRA_ALIASES` supplement) doesn't know the name at all. */
export function canonicalLanguage(name: string): string | null {
  const api = loadHljs();
  if (api === null) return null;
  const lower = name.toLowerCase(), resolved = EXTRA_ALIASES.get(lower) ?? lower, definition = api.getLanguage(resolved);
  if (!definition) return null;
  if (canonicalByDefinition === undefined) {
    canonicalByDefinition = new Map();
    for (const registered of api.listLanguages()) { const d = api.getLanguage(registered); if (d && !canonicalByDefinition.has(d)) canonicalByDefinition.set(d, registered); }
  }
  return canonicalByDefinition.get(definition) ?? resolved;
}

/** `X$p` L419856 — five bare filenames, probed on the basename AND on its stem. */
export const FILENAME_LANGS = new Map<string, string>([["Dockerfile", "dockerfile"], ["Makefile", "makefile"], ["Rakefile", "ruby"], ["Gemfile", "ruby"], ["CMakeLists", "cmake"]]);
/** `n2p` L419530, minus its third arm. Upstream also sniffs CONTENT — a `#!` shebang, a `<?php`/`<?xml`
 *  prologue — but only when it has the file body in hand; a diff row is not the file, and the signature
 *  both current callers take is a path alone. Filename map first (probed on the basename and on its stem,
 *  so `CMakeLists.txt` resolves as cmake rather than as its `.txt`), then the extension. */
export function detectLanguage(filePath: string): string | null {
  const base = basename(filePath), named = FILENAME_LANGS.get(base) ?? FILENAME_LANGS.get(before(base, "."));
  if (named !== undefined) { const resolved = canonicalLanguage(named); if (resolved !== null) return resolved; }
  const ext = extname(filePath).slice(1);
  return ext === "" ? null : canonicalLanguage(ext);
}

/** The hljs token tree. `scope` is 11.x; `kind` is the pre-11 name upstream still reads, kept because a
 *  grammar can still emit either. */
export interface TokenNode { scope?: string; kind?: string; children: (TokenNode | string)[]; }
export const isTokenTree = (emitter: unknown): emitter is { rootNode: TokenNode } => {
  if (typeof emitter !== "object" || emitter === null || !("rootNode" in emitter)) return false;
  const root = (emitter as { rootNode: unknown }).rootNode;
  return typeof root === "object" && root !== null && "children" in root;
};

/** A leaf of the walk: the literal text plus whatever style fields the resolver (and its ancestors) gave
 *  it. `Partial<Segment>` rather than a bare colour, per the plan-review fix this task exists to apply —
 *  the fenced-code map needs `bold`/`italic`/… alongside `color`, and the diff maps need only `color`, so
 *  the walk carries the union and lets each caller's resolver populate the subset it uses. */
export type StyledRun = { text: string } & Partial<Segment>;

/** `o2p` L419578, widened from a single colour lookup to an arbitrary RESOLVER callback so one walker
 *  serves both the diff maps (text-sensitive: a `keyword` node re-scopes on its own literal text — see
 *  `diffHighlight.ts`'s `STORAGE_KEYWORDS` check) and the fenced-code map Task 2 wires in.
 *
 *  `resolve(scope, text)` is called once per node — at the node's OWN scope (`node.scope ?? node.kind`,
 *  never falling back to an ancestor's), with `text` the concatenation of that node's own direct string
 *  children (empty for a purely structural node). Its result is merged OVER `inherited` field-by-field
 *  (the node's own fields win; fields it doesn't set fall through to the ancestor's), and that merge is
 *  what both descends to the node's children as their `inherited` AND what stamps its own string children.
 *  This is `o2p`'s INHERITANCE — a child with no scope of its own keeps its parent's styling — generalised
 *  from a single colour to arbitrary style fields, so a `strong` ancestor's `bold` survives into a nested
 *  `emphasis` child's `italic` instead of one full replacing the other. */
export function walkEmitter(node: TokenNode, resolve: (scope: string | undefined, text: string) => Partial<Segment>, inherited: Partial<Segment> = {}): StyledRun[] {
  const scope = node.scope ?? node.kind;
  const ownText = node.children.filter((child): child is string => typeof child === "string").join("");
  const merged: Partial<Segment> = { ...inherited, ...resolve(scope, ownText) };
  const runs: StyledRun[] = [];
  for (const child of node.children) {
    if (typeof child === "string") runs.push({ text: child, ...merged });
    else runs.push(...walkEmitter(child, resolve, merged));
  }
  return runs;
}
