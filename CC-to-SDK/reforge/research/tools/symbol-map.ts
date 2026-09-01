// The minified→semantic SYMBOL MAP — the name the engine ships about itself.
//
//   npx tsx research/tools/symbol-map.ts [--check] [--chunk <name>] [--find <regex>]
//
// WHY THIS EXISTS. The bundler minifies every binding inside a chunk, but it
// does NOT minify the names a chunk re-exports under: hundreds of chunks in the
// graph are barrels that do
//
//     import{Tye}from"/$bunfs/root/chunk-fy12d89p.js";
//     export{Tye as executePreToolHooks};
//
// so the engine carries a partial symbol table for itself. The W5–W7 scout found
// it (`research/2026-09-01-w5-w7-anchor-scout.md` §0) and measured 832 names for
// the engine chunk alone. That changes scouting economics for every remaining
// wave — targets become *looked up* rather than hunted by literal — and it is a
// §5 staleness signal nothing else sees: a semantic name that appears, vanishes
// or moves to a different minified binding is upstream telling us a subsystem
// moved, with the export inventory and every anchor byte-identical.
//
// So it is generated, committed keyed to `ENGINE_VERSION`, and `--check`ed by the
// gate's build-free determinism block.
//
// WHAT COUNTS AS A NAME (derived, not curated). A mapping is recorded when a
// chunk exports a binding under an ALIAS that differs from the binding it names,
// and the binding resolves — directly or through a chain of barrels — to an
// export of another chunk. Both ESM spellings are read: the local form
// (`import{X}…; export{X as name}`) and the direct re-export
// (`export{X as name}from"…"`). The alias is kept only when it is NOT itself
// minified (see `isSemantic`) — a barrel that renames `a` to `b` says nothing
// about intent, and counting those would drown the signal in noise.
//
// WHAT IT IS NOT. It is not a splice mechanism and nothing in the build reads
// it: an anchor is still a string literal, because a re-exported name is exactly
// the kind of thing a bundler is free to stop emitting. The map is for humans
// scouting targets and for the bump ritual reading a diff.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const symbolMapPath = (version: string) => join(FIXTURE_DIR, `symbol-map-${version}.json`);

/**
 * Is this alias a SOURCE-LEVEL name rather than another minified one?
 *
 * The minifier's output is short and vowel-poor (`Tye`, `b3e`, `q6t`, `$U`);
 * source names are longer and word-shaped. The rule is deliberately crude and
 * deliberately one-sided: five characters or more, starting with a letter, and
 * carrying either a camelCase hump, an underscore, or three consecutive
 * lower-case letters. It will refuse a genuinely short source name (`fs`, `log`)
 * — a name the map then lacks — rather than admit minified noise, because the
 * map's value is entirely in its signal-to-noise ratio when a human reads a
 * bump diff.
 */
export function isSemantic(name: string): boolean {
  if (name.length < 5 || !/^[A-Za-z]/.test(name)) return false;
  return /[a-z][A-Z]/.test(name) || name.includes("_") || /[a-z]{3}/.test(name);
}

interface ChunkFacts {
  file: string;
  /** local binding -> where it came from */
  imports: Map<string, { from: string; name: string }>;
  /** exported name -> the local binding it names (local export clause) */
  localExports: Map<string, string>;
  /** exported name -> {from, name}: `export{a as b}from"…"` */
  reExports: Map<string, { from: string; name: string }>;
  /** names this chunk declares at top level */
  declared: Set<string>;
}

function readChunk(file: string, text: string): ChunkFacts {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const facts: ChunkFacts = {
    file,
    imports: new Map(),
    localExports: new Map(),
    reExports: new Map(),
    declared: new Set(),
  };
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const from = basename(stmt.moduleSpecifier.text);
      const bindings = stmt.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) facts.imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
      }
      continue;
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const spec = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? basename(stmt.moduleSpecifier.text) : null;
      for (const el of stmt.exportClause.elements) {
        const source = (el.propertyName ?? el.name).text;
        if (spec === null) facts.localExports.set(el.name.text, source);
        else facts.reExports.set(el.name.text, { from: spec, name: source });
      }
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) facts.declared.add(stmt.name.text);
    else if (ts.isClassDeclaration(stmt) && stmt.name) facts.declared.add(stmt.name.text);
    else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) facts.declared.add(d.name.text);
    }
  }
  return facts;
}

export interface SymbolMap {
  engineVersion: string;
  generatedBy: string;
  counts: { chunks: number; namingChunks: number; mappedChunks: number; names: number; conflicts: number };
  /** target chunk -> minified export name -> semantic name */
  chunks: Record<string, Record<string, string>>;
  /** one minified binding named two different ways — recorded, never silently picked */
  conflicts: { chunk: string; name: string; names: string[] }[];
}

/**
 * Follow a (chunk, exportedName) pair to the chunk that DECLARES it, through any
 * number of barrels. Returns null when the chain leaves the graph or loops — a
 * name whose origin cannot be established is dropped rather than attributed to
 * the last barrel that touched it.
 */
function origin(
  chunks: Map<string, ChunkFacts>,
  from: string,
  name: string,
): { chunk: string; name: string } | null {
  const seen = new Set<string>();
  let cur = { chunk: from, name };
  for (;;) {
    const key = `${cur.chunk}#${cur.name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const facts = chunks.get(cur.chunk);
    if (!facts) return null;
    const re = facts.reExports.get(cur.name);
    if (re) {
      cur = { chunk: re.from, name: re.name };
      continue;
    }
    const local = facts.localExports.get(cur.name);
    if (local === undefined) return null;
    if (facts.declared.has(local)) return { chunk: cur.chunk, name: local };
    const imported = facts.imports.get(local);
    if (!imported) return null;
    cur = { chunk: imported.from, name: imported.name };
  }
}

export function buildSymbolMap(): SymbolMap {
  const files = readdirSync(BUNDLE_MODULES).filter((f) => f.endsWith(".js"));
  const chunks = new Map<string, ChunkFacts>();
  for (const f of files) chunks.set(f, readChunk(f, readFileSync(join(BUNDLE_MODULES, f), "utf8")));

  // target chunk -> minified name -> the semantic names claimed for it
  const map = new Map<string, Map<string, Set<string>>>();
  const namingChunks = new Set<string>();

  const record = (target: { chunk: string; name: string }, semantic: string, namer: string) => {
    if (target.name === semantic) return; // the chunk declares it under that name already
    if (!isSemantic(semantic)) return;
    namingChunks.add(namer);
    const byChunk = map.get(target.chunk) ?? new Map<string, Set<string>>();
    map.set(target.chunk, byChunk);
    byChunk.set(target.name, (byChunk.get(target.name) ?? new Set()).add(semantic));
  };

  for (const [file, facts] of chunks) {
    for (const [exported, local] of facts.localExports) {
      if (exported === local) continue;
      const imported = facts.imports.get(local);
      // A chunk that renames its OWN declaration is naming itself.
      if (!imported) {
        if (facts.declared.has(local)) record({ chunk: file, name: local }, exported, file);
        continue;
      }
      const target = origin(chunks, imported.from, imported.name);
      if (target) record(target, exported, file);
    }
    for (const [exported, source] of facts.reExports) {
      if (exported === source.name) continue;
      const target = origin(chunks, source.from, source.name);
      if (target) record(target, exported, file);
    }
  }

  const out: Record<string, Record<string, string>> = {};
  const conflicts: SymbolMap["conflicts"] = [];
  let names = 0;
  for (const [chunk, byName] of [...map].sort(([a], [b]) => a.localeCompare(b))) {
    const entries: Record<string, string> = {};
    for (const [min, semantics] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
      const list = [...semantics].sort();
      if (list.length > 1) conflicts.push({ chunk, name: min, names: list });
      entries[min] = list[0];
      names++;
    }
    out[chunk] = entries;
  }

  return {
    engineVersion: ENGINE_VERSION,
    generatedBy: "research/tools/symbol-map.ts",
    counts: {
      chunks: chunks.size,
      namingChunks: namingChunks.size,
      mappedChunks: Object.keys(out).length,
      names,
      conflicts: conflicts.length,
    },
    chunks: out,
    conflicts: conflicts.sort((a, b) => (a.chunk + a.name).localeCompare(b.chunk + b.name)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes("--check");
  const map = buildSymbolMap();
  const out = symbolMapPath(map.engineVersion);
  const text = JSON.stringify(map, null, 2) + "\n";

  // Query modes — the reason a scout reads this file at all.
  const chunkIdx = argv.indexOf("--chunk");
  if (chunkIdx >= 0) {
    const want = argv[chunkIdx + 1] ?? "";
    const entries = map.chunks[want] ?? map.chunks[`chunk-${want}.js`] ?? {};
    for (const [min, semantic] of Object.entries(entries)) console.log(`  ${min.padEnd(8)} ${semantic}`);
    console.log(`${Object.keys(entries).length} name(s) for ${want}`);
    process.exit(0);
  }
  const findIdx = argv.indexOf("--find");
  if (findIdx >= 0) {
    const re = new RegExp(argv[findIdx + 1] ?? ".", "i");
    for (const [chunk, entries] of Object.entries(map.chunks)) {
      for (const [min, semantic] of Object.entries(entries)) if (re.test(semantic)) console.log(`  ${chunk} ${min.padEnd(8)} ${semantic}`);
    }
    process.exit(0);
  }

  console.log(`pin: ${map.engineVersion}`);
  console.log(`  chunks scanned: ${map.counts.chunks}  chunks that NAME something: ${map.counts.namingChunks}`);
  console.log(`  chunks named: ${map.counts.mappedChunks}  names: ${map.counts.names}  conflicts: ${map.counts.conflicts}`);
  const engine = Object.keys(map.chunks["chunk-fy12d89p.js"] ?? {}).length;
  console.log(`  engine chunk (chunk-fy12d89p.js): ${engine} names`);

  // PLAUSIBILITY, against the independent measurement that motivated the tool.
  // The W5–W7 scout counted 832 names for the engine chunk by a different
  // method (harvesting `export{<min> as <semantic>}` whose binding was imported
  // from the engine chunk — one hop, no barrel chains). This walk follows chains
  // and filters non-semantic aliases, so exact agreement is not expected; a
  // large shortfall is the dangerous direction, because a map with holes reads
  // as "upstream removed a name" at the next bump.
  const SCOUT_ENGINE_NAMES = 832;
  const drift = (engine - SCOUT_ENGINE_NAMES) / SCOUT_ENGINE_NAMES;
  const plausible = drift >= -0.1 && drift <= 0.5;
  console.log(
    `  plausibility: ${engine} engine-chunk names vs the scout's independent count of ${SCOUT_ENGINE_NAMES} ` +
      `(${(drift * 100).toFixed(1)}%) — ${plausible ? "OK" : "OUT OF RANGE"}`,
  );
  if (!plausible) {
    console.error("FAIL — the harvested name count diverges from the scout's independent measurement; do not trust this map");
    process.exit(1);
  }

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed symbol map at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== text) {
      console.error(
        `FAIL — the committed symbol map is stale: the pinned bundle names its own symbols differently than the fixture records.\n` +
          `  A name that appeared, vanished or moved to another binding is a §5 staleness signal — regenerate and READ the diff:\n` +
          `    npx tsx research/tools/symbol-map.ts`,
      );
      process.exit(1);
    }
    console.log("PASS — committed symbol map matches the pinned bundle");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
