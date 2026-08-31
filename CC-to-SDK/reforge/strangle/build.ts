// Manifest-driven strangler build: materialize a runnable copy of the PINNED
// extraction, excise each manifest target from whichever chunk owns it, and
// delegate it into `globalThis.__reforge`.
//
//   npx tsx strangle/build.ts [--sabotage <name>|all]
//
// Anchoring rules (measured in M2a, re-confirmed by the 2.1.241 → 2.1.251 bump):
//  - anchors are TRUE-SUBSTRING-unique across the WHOLE graph ("grep -c" counts
//    lines and lies on these effectively-one-line chunks — count substrings).
//    A row whose target carries no graph-unique literal may declare a
//    `coLiteral` and be unique among the chunks holding both — see
//    strangle/anchor.ts for why that is a literal and never a chunk name
//  - closure identifiers a target captures are RE-DERIVED from the matched body,
//    never hardcoded. This is what makes a version catch-up mechanical: across
//    the bump all three method bodies were byte-identical modulo minified names
//    (the write tool's freshness suffix went `hui` → `q6t`, glob's truncation
//    notice `yzv` → `APn`), so nothing but the derivation had to run again.
//
// Span-finding is an AST walk (strangle/ast.ts), not a name search plus a
// balanced-brace scan: the manifest declares the target SHAPE and the excision
// is exactly that node's span. See ast.ts for why.
//
// Packaging note: the pre-2.1.248 payload was one CJS blob, so the prelude was
// injected as source inside its `(function(exports, require, …) {` opening. The
// graph is ESM now, so each owning chunk instead gets an `import` of the
// reforge-owned module placed after its banner — imports hoist, so the module
// initializes before the chunk body that delegates into it. The banner must
// still stay byte-first (prepending disables the bundle silently), and the build
// boot-checks either way.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BUN, BUNFS, ENGINE_VERSION } from "../src/pin.js";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { resolveAnchor } from "./anchor.js";
import { assertSignature, chunkAst, excise } from "./ast.js";
import { spliceFootprint, type FootprintFile } from "./footprint.js";
import { deriveCaptures, SPLICES } from "./manifest.js";
import { bootCheck, BUILD_DIR, materializeGraph, STRANGLED_DIR, textModules } from "./prepare.js";
import { assertCaptureInventory } from "./scope.js";

// ---- CLI --------------------------------------------------------------------
const args = process.argv.slice(2);
const sabotageIdx = args.indexOf("--sabotage");
let sabotageTarget: string | null = null; // null = faithful build
if (sabotageIdx >= 0) {
  // Require an explicit value: a missing or flag-shaped one silently meaning
  // "all" is the same ambiguity that made a bad --scenario silently run the
  // whole corpus.
  const v = args[sabotageIdx + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`ABORT: --sabotage requires a value: all, ${SPLICES.map((sp) => sp.name).join(", ")}`);
    process.exit(2);
  }
  sabotageTarget = v;
  if (sabotageTarget !== "all" && !SPLICES.some((sp) => sp.name === sabotageTarget)) {
    console.error(`ABORT: unknown splice '${sabotageTarget}'. Known: all, ${SPLICES.map((sp) => sp.name).join(", ")}`);
    process.exit(2);
  }
}

// ---- helpers ----------------------------------------------------------------
/** Place a statement after the leading banner//comment block, never before it. */
function injectAfterBanner(src: string, statement: string): string {
  let i = 0;
  for (;;) {
    const nl = src.indexOf("\n", i);
    if (nl < 0) throw new Error("no code line found after banner");
    const line = src.slice(i, nl).trim();
    if (line !== "" && !line.startsWith("//")) break;
    i = nl + 1;
  }
  return src.slice(0, i) + statement + "\n" + src.slice(i);
}

/**
 * Undo prepare.ts's specifier rewrite before hashing a span (§5): the
 * materialized copy carries THIS machine's absolute paths where the bundle
 * carries `/$bunfs/root/`. A footprint has to change when upstream changes and
 * only then, so it is taken over the upstream bytes.
 */
const upstreamBytes = (s: string) => s.replaceAll(`${STRANGLED_DIR}/`, BUNFS);

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

// ---- build ------------------------------------------------------------------
const { files, specifiers } = materializeGraph(STRANGLED_DIR);
console.log(`graph: ${files} files rewritten, ${specifiers.toLocaleString()} specifiers → ${STRANGLED_DIR}`);

const sources = new Map<string, string>();
for (const path of textModules(STRANGLED_DIR)) sources.set(path, readFileSync(path, "utf8"));

const preludesFor = new Map<string, string[]>();
const editsFor = new Map<string, Edit[]>();
const footprints: FootprintFile["splices"] = [];

for (const sp of SPLICES) {
  // Uniqueness is a whole-GRAPH property, not a per-file one: a second match in
  // another chunk would make "which node did we excise?" a coin flip. A row that
  // declares a `coLiteral` narrows the scope to the chunks carrying both, and
  // still has to be unique inside it (strangle/anchor.ts).
  const { path, source: src } = resolveAnchor(sources, sp, (p) => relative(STRANGLED_DIR, p));
  const sf = chunkAst(path, src);
  const cut = excise(sf, src.indexOf(sp.anchor), sp.target);
  // Belt and braces: the span the AST chose must be the one the anchor named.
  if (!cut.original.includes(sp.anchor)) throw new Error(`${sp.name}: excised span does not contain the anchor`);
  // …and it must be the node the operator verified, not a same-shaped neighbour.
  assertSignature(sp.name, cut, sp.signature);

  const captures = deriveCaptures(sp, cut.original);
  // The manifest is not its own witness: the body's free variables are derived
  // from the AST and must match the declared captures exactly, either way.
  assertCaptureInventory(sp.name, cut.node, captures.map((c) => c.identifier));

  // `owned` captures have had their §2.4 retrofit: the module implements them,
  // so the graph's binding is footprinted but not forwarded.
  const forwarded = captures.filter((c) => !c.owned);
  const replacement = cut.render(sp.fn, [...cut.shapeArgs, ...forwarded.map((c) => c.identifier)]);
  editsFor.set(path, [...(editsFor.get(path) ?? []), { start: cut.start, end: cut.end, replacement }]);

  footprints.push({
    name: sp.name,
    shape: sp.target,
    fn: sp.fn,
    node: cut.label,
    anchor: sp.anchor,
    signature: cut.signature,
    coverage: sp.coverage,
    ...spliceFootprint({
      name: sp.name,
      chunk: relative(STRANGLED_DIR, path),
      sf,
      cut,
      captures,
      resolveModule: (specifier) => {
        const text = sources.get(specifier);
        if (text === undefined) return null;
        return { name: relative(STRANGLED_DIR, specifier), sf: chunkAst(specifier, text) };
      },
      upstream: upstreamBytes,
    }),
  });

  const sabotaged = sabotageTarget === "all" || sabotageTarget === sp.name;
  const moduleFile = join(REFORGE_ROOT, "strangle", "modules", `${sp.name}${sabotaged ? ".sabotage" : ""}.js`);
  readFileSync(moduleFile); // fail loudly here rather than at boot
  preludesFor.set(path, [...(preludesFor.get(path) ?? []), moduleFile]);
  console.log(
    `spliced ${sp.name} [${sp.target}] ${cut.label} in ${relative(STRANGLED_DIR, path)}: ` +
      `${cut.original.length} chars -> ${replacement.length}-char delegation` +
      `${captures.length > 0 ? ` (derived: ${captures.map((c) => `${c.as}=${c.identifier}${c.owned ? "*" : ""}`).join(", ")})` : " (no free variables)"}` +
      `${sabotaged ? " [SABOTAGE]" : ""}`,
  );
}

// Apply every excision in one pass per file, back to front, so earlier spans
// keep the offsets the AST reported for them. Two splices whose spans overlap
// (one target nested inside another) would silently corrupt each other, so that
// is refused rather than ordered around.
for (const [path, edits] of editsFor) {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].end > ordered[i - 1].start) {
      throw new Error(`${relative(STRANGLED_DIR, path)}: two splices claim overlapping spans — split the targets`);
    }
  }
  let src = sources.get(path)!;
  for (const e of ordered) src = src.slice(0, e.start) + e.replacement + src.slice(e.end);
  sources.set(path, src);
}

for (const [path, modules] of preludesFor) {
  const statement = modules.map((m) => `import ${JSON.stringify(m)};`).join("");
  writeFileSync(path, injectAfterBanner(sources.get(path)!, statement));
}

// The upstream-footprint ledger (§5): what each owned row replaces — the target
// span AND its closure surface — content hashed, so a pin bump can stale the
// rows whose upstream actually moved. See strangle/footprint.ts for why the
// captures' declaration spans are part of the record and not an extra.
const footprintFile = join(BUILD_DIR, "footprints.json");
const file: FootprintFile = {
  engineVersion: ENGINE_VERSION,
  variant: sabotageTarget ?? "faithful",
  // Spans are offsets into the MATERIALIZED chunk (prepare.ts rewrites
  // /$bunfs/root/ specifiers, which shifts offsets); every `sha256` is over the
  // upstream bytes, so it moves only when upstream does.
  spanBasis: "materialized-chunk",
  hashBasis: "upstream-bytes",
  splices: footprints,
};
writeFileSync(footprintFile, JSON.stringify(file, null, 2) + "\n");

bootCheck([BUN, join(STRANGLED_DIR, "cli"), "--version"], "engine-strangled");
console.log(
  `strangled build written: ${STRANGLED_DIR} (${SPLICES.length} splices across ${preludesFor.size} chunk(s), ` +
    `variant: ${sabotageTarget ?? "faithful"}); footprints → ${relative(REFORGE_ROOT, footprintFile)}`,
);
