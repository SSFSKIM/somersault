// §3.3 — snapshot the HOOK DISPATCHER REGISTRY from the pinned bundle.
//
//   npx tsx research/tools/extract-hook-registry.ts [--check]
//
// WHY A FIXTURE. W5's hook wave twice enumerated "the events that exist" by
// judgment — first from a stale `coverage.md` line ("8 of 30"), then from a
// hand-picked list of "events a tool-using turn could plausibly reach". Both
// enumerations were wrong, and both were wrong in the same way: the population
// under test was chosen by the tester rather than read off the artifact, so an
// event nobody thought of could not be measured as absent. The C8 boundary
// review found three more live events (PostCompact, TaskCreated, Notification)
// simply by reading the registry.
//
// The registry IS the enumeration of record. Upstream keeps one object literal
// mapping every hook event name to the function that dispatches it, and the
// executor looks its dispatcher up there. Nothing that is not in it can fire;
// everything in it is a candidate. So this tool materialises it into an
// `ENGINE_VERSION`-keyed fixture, and `w5/probe-hook-events.ts` derives its
// watched list from the fixture rather than from a literal in its own source.
// Same move as the gate-defaults fixture: derive the enumeration from the
// artifact, not from judgment.
//
// `--check` regenerates in memory and fails if the committed fixture differs, so
// a pin bump that adds, drops or re-points an event cannot land silently.
//
// HOW THE REGISTRY IS FOUND (not hardcoded). The binding is minified (`zCr` in
// 2.1.251) and would churn at any bump, so nothing here looks for that name.
// Instead the registry is recognised by SHAPE and then CONFIRMED against a
// second, independent signal in the same bundle:
//
//   1. shape — a top-level `var X = { K1: f1, K2: f2, … }` whose every property
//      is an identifier key with a bare identifier initializer, with at least
//      `MIN_EVENTS` of them. A dispatcher table is the only thing in the graph
//      shaped like that at this size.
//   2. confirmation — the dispatchers STAMP their own event name into the hook
//      input record (`hook_event_name:"PreToolUse"`). Collecting those literals
//      bundle-wide gives an enumeration derived from a completely different
//      place in the code, and the candidate must cover most of it. A table of
//      the right shape that is not the hook registry cannot pass that test.
//
// Then each dispatcher is resolved through the ESM export/import graph to the
// chunk that DEFINES it, and its call sites are counted bundle-wide — which is
// what turns "the registry says this event exists" into "and here is where it
// could fire", the question the probe's phases are built from.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `hook-registry-${version}.json`);

/**
 * The smallest table this tool will accept as the registry. Well below the
 * observed 33 so a pin that retires a handful of events still resolves, and far
 * above anything else in the graph shaped like a bare identifier map.
 */
const MIN_EVENTS = 20;
/**
 * How much of the independently derived `hook_event_name:"…"` set the candidate
 * must cover to be confirmed. Not 100%: a dispatcher may stamp an event name the
 * registry reaches through a shared function, and a stray literal in prose would
 * otherwise veto the whole extraction.
 */
const MIN_CONFIRMATION = 0.7;

interface ChunkFacts {
  file: string;
  text: string;
  sf: ts.SourceFile;
  /** local name -> { from chunk, exported name } */
  imports: Map<string, { from: string; name: string }>;
  /** exported name -> local name */
  exports: Map<string, string>;
  /** local names this chunk DEFINES (function decls and top-level var bindings) */
  defines: Set<string>;
}

function readChunk(file: string, text: string): ChunkFacts {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const imports = new Map<string, { from: string; name: string }>();
  const exports = new Map<string, string>();
  const defines = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const from = basename(stmt.moduleSpecifier.text);
      const bindings = stmt.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
      }
      continue;
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) exports.set(el.name.text, (el.propertyName ?? el.name).text);
      continue;
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) defines.add(stmt.name.text);
    if (ts.isClassDeclaration(stmt) && stmt.name) defines.add(stmt.name.text);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) defines.add(d.name.text);
    }
  }
  return { file, text, sf, imports, exports, defines };
}

/** A `var X = {K: f, …}` candidate: identifier keys, bare identifier values, nothing else. */
function identifierMap(init: ts.Expression): Map<string, string> | null {
  if (!ts.isObjectLiteralExpression(init)) return null;
  const out = new Map<string, string>();
  for (const prop of init.properties) {
    if (!ts.isPropertyAssignment(prop)) return null;
    if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) return null;
    if (!ts.isIdentifier(prop.initializer)) return null;
    out.set(prop.name.text, prop.initializer.text);
  }
  return out;
}

/**
 * Every event name a dispatcher stamps into its record, bundle-wide. The
 * independent signal the registry candidate is confirmed against — a plain text
 * scan, because the point is that it shares no machinery with the AST search.
 */
function stampedEventNames(chunks: Map<string, ChunkFacts>): Set<string> {
  const out = new Set<string>();
  for (const c of chunks.values()) {
    for (const m of c.text.matchAll(/hook_event_name:"([A-Za-z]+)"/g)) out.add(m[1]);
  }
  return out;
}

/**
 * Resolve `chunk`'s local binding `local` to the chunk that DEFINES it,
 * following re-export chains. Returns null if the chain leaves the bundle.
 */
function resolveDefinition(chunks: Map<string, ChunkFacts>, chunk: string, local: string): { chunk: string; name: string } | null {
  let cur = chunks.get(chunk);
  let name = local;
  for (let hops = 0; cur && hops < 32; hops++) {
    if (cur.defines.has(name)) return { chunk: cur.file, name };
    const imp = cur.imports.get(name);
    if (!imp) return null;
    const next = chunks.get(imp.from);
    if (!next) return null;
    // the exporting chunk's local binding for that exported name
    name = next.exports.get(imp.name) ?? imp.name;
    cur = next;
  }
  return null;
}

/** Count `f(...)` call sites for a callee identifier inside one subtree. */
function countCalls(root: ts.Node, callee: string): number {
  let n = 0;
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee) n++;
    ts.forEachChild(node, walk);
  };
  walk(root);
  return n;
}

/**
 * Dynamic-import call sites: `let {exportedName: local} = await import("…/chunk-X.js")`.
 *
 * A static-import-only sweep is not merely incomplete here, it is WRONG about a
 * specific event: the app's `shutdown()` reaches SessionEnd this way and nothing
 * else does, so the static count says two callers where there are three. That
 * miss is what let the wave describe SessionEnd's ordinary-teardown fire as
 * unexplained.
 *
 * Counted inside the ENCLOSING FUNCTION only. The binding is function-scoped and
 * the minifier reuses short names freely, so a chunk-wide count of the local
 * would fold in unrelated calls.
 */
function dynamicImportSites(c: ChunkFacts): { fromChunk: string; exported: string; local: string; scope: ts.Node }[] {
  const out: { fromChunk: string; exported: string; local: string; scope: ts.Node }[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const init = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (
        ts.isCallExpression(init) &&
        init.expression.kind === ts.SyntaxKind.ImportKeyword &&
        init.arguments.length === 1 &&
        ts.isStringLiteral(init.arguments[0])
      ) {
        const fromChunk = basename(init.arguments[0].text);
        let scope: ts.Node = node;
        while (scope.parent && !ts.isFunctionDeclaration(scope) && !ts.isFunctionExpression(scope) && !ts.isArrowFunction(scope) && !ts.isMethodDeclaration(scope)) {
          scope = scope.parent;
        }
        for (const el of node.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const exported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
          out.push({ fromChunk, exported, local: el.name.text, scope });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(c.sf);
  return out;
}

export interface HookRegistryFixture {
  engineVersion: string;
  generatedBy: string;
  registry: {
    chunk: string;
    /** the minified binding the table is declared as — recorded, never searched for */
    binding: string;
    /** byte offset of the declaration in its chunk, for hand-verification */
    offset: number;
  };
  counts: {
    events: number;
    /** distinct dispatcher functions — fewer than events, because some are shared */
    dispatchers: number;
    /** event names stamped into hook-input records bundle-wide */
    stampedEventNames: number;
    /** how much of that stamped set the registry covers */
    confirmationRatio: number;
  };
  /** dispatcher -> the events it serves, for the shared ones */
  sharedDispatchers: Record<string, string[]>;
  events: {
    event: string;
    dispatcher: string;
    /** the chunk that defines the dispatcher, or null if the chain left the bundle */
    definedIn: string | null;
    /** every chunk that calls it, with how many times, and how the binding got there */
    callSites: { chunk: string; calls: number; via: "static" | "dynamic" }[];
    /** total call sites bundle-wide */
    calls: number;
  }[];
}

export function extract(modulesDir = BUNDLE_MODULES, version = ENGINE_VERSION): HookRegistryFixture {
  const files = readdirSync(modulesDir).filter((f) => f.endsWith(".js"));
  const chunks = new Map<string, ChunkFacts>();
  for (const f of files) chunks.set(f, readChunk(f, readFileSync(join(modulesDir, f), "utf8")));

  const stamped = stampedEventNames(chunks);

  // ---- 1. find the table by shape, 2. confirm it against the stamped names --
  let best: { chunk: string; binding: string; offset: number; map: Map<string, string>; covered: number } | null = null;
  for (const c of chunks.values()) {
    for (const stmt of c.sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const map = identifierMap(d.initializer);
        if (!map || map.size < MIN_EVENTS) continue;
        const covered = [...stamped].filter((e) => map.has(e)).length;
        if (covered / stamped.size < MIN_CONFIRMATION) continue;
        if (best === null || map.size > best.map.size) {
          best = { chunk: c.file, binding: d.name.text, offset: d.getStart(c.sf), map, covered };
        }
      }
    }
  }
  if (best === null) {
    throw new Error(
      `no hook registry found: no top-level identifier map of >=${MIN_EVENTS} entries covers >=${MIN_CONFIRMATION * 100}% of ` +
        `the ${stamped.size} event names stamped into hook-input records. The table's shape changed upstream — re-derive before trusting anything downstream.`,
    );
  }

  // ---- 3. resolve each dispatcher and count its call sites -----------------
  const shared = new Map<string, string[]>();
  for (const [event, fn] of best.map) shared.set(fn, [...(shared.get(fn) ?? []), event]);

  // Pre-resolve every chunk's local bindings ONCE — the resolution is the
  // expensive half and it does not depend on which event is being counted.
  const staticLocals = new Map<string, Map<string, string>>(); // chunk -> local -> "defChunk#defName"
  const dynamicLocals = new Map<string, { key: string; local: string; scope: ts.Node }[]>();
  for (const c of chunks.values()) {
    const m = new Map<string, string>();
    for (const [local] of c.imports) {
      const r = resolveDefinition(chunks, c.file, local);
      if (r) m.set(local, `${r.chunk}#${r.name}`);
    }
    staticLocals.set(c.file, m);
    const dyn: { key: string; local: string; scope: ts.Node }[] = [];
    for (const site of dynamicImportSites(c)) {
      const target = chunks.get(site.fromChunk);
      if (!target) continue;
      const r = resolveDefinition(chunks, site.fromChunk, target.exports.get(site.exported) ?? site.exported);
      if (r) dyn.push({ key: `${r.chunk}#${r.name}`, local: site.local, scope: site.scope });
    }
    if (dyn.length > 0) dynamicLocals.set(c.file, dyn);
  }

  const events: HookRegistryFixture["events"] = [];
  for (const [event, fn] of [...best.map].sort((a, b) => a[0].localeCompare(b[0]))) {
    const def = resolveDefinition(chunks, best.chunk, fn);
    const key = def ? `${def.chunk}#${def.name}` : null;
    const callSites: { chunk: string; calls: number; via: "static" | "dynamic" }[] = [];
    for (const c of chunks.values()) {
      if (key === null || !def) continue;
      // which local binding, if any, does THIS chunk know the dispatcher by?
      const locals = new Set<string>();
      if (c.file === def.chunk) locals.add(def.name);
      for (const [local, k] of staticLocals.get(c.file) ?? []) if (k === key) locals.add(local);
      let calls = 0;
      for (const l of locals) calls += countCalls(c.sf, l);
      // the registry declaration itself is a reference, not a call, so it never counts
      if (calls > 0) callSites.push({ chunk: c.file, calls, via: "static" });
      let dynamic = 0;
      for (const site of dynamicLocals.get(c.file) ?? []) if (site.key === key) dynamic += countCalls(site.scope, site.local);
      if (dynamic > 0) callSites.push({ chunk: c.file, calls: dynamic, via: "dynamic" });
    }
    callSites.sort((a, b) => b.calls - a.calls || a.chunk.localeCompare(b.chunk));
    events.push({
      event,
      dispatcher: fn,
      definedIn: def?.chunk ?? null,
      callSites,
      calls: callSites.reduce((n, s) => n + s.calls, 0),
    });
  }

  return {
    engineVersion: version,
    generatedBy: "research/tools/extract-hook-registry.ts",
    registry: { chunk: best.chunk, binding: best.binding, offset: best.offset },
    counts: {
      events: best.map.size,
      dispatchers: shared.size,
      stampedEventNames: stamped.size,
      confirmationRatio: Number((best.covered / stamped.size).toFixed(4)),
    },
    sharedDispatchers: Object.fromEntries(
      [...shared].filter(([, evs]) => evs.length > 1).map(([fn, evs]) => [fn, evs.sort()]),
    ),
    events,
  };
}

/** The watched list the probe drives — every event the registry knows, sorted. */
export function registryEvents(version = ENGINE_VERSION): string[] {
  const fx = JSON.parse(readFileSync(fixturePath(version), "utf8")) as HookRegistryFixture;
  return fx.events.map((e) => e.event);
}

/** The whole committed fixture, for callers that need call sites as well as names. */
export function readFixture(version = ENGINE_VERSION): HookRegistryFixture {
  return JSON.parse(readFileSync(fixturePath(version), "utf8")) as HookRegistryFixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const text = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  console.log(`  registry: ${fx.registry.binding}@${fx.registry.chunk} offset ${fx.registry.offset}`);
  console.log(
    `  events: ${fx.counts.events}  dispatchers: ${fx.counts.dispatchers}  ` +
      `shared: ${Object.entries(fx.sharedDispatchers).map(([f, e]) => `${f}=${e.join("/")}`).join(", ") || "none"}`,
  );
  console.log(
    `  confirmation: covers ${(fx.counts.confirmationRatio * 100).toFixed(1)}% of the ${fx.counts.stampedEventNames} ` +
      `event names stamped into hook-input records bundle-wide`,
  );
  const unresolved = fx.events.filter((e) => e.definedIn === null);
  if (unresolved.length > 0) console.log(`  UNRESOLVED dispatchers: ${unresolved.map((e) => `${e.event}=${e.dispatcher}`).join(", ")}`);
  const uncalled = fx.events.filter((e) => e.calls === 0);
  console.log(`  dispatchers with no call site at all: ${uncalled.length}${uncalled.length > 0 ? ` (${uncalled.map((e) => e.event).join(", ")})` : ""}`);

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== text) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-hook-registry.ts`);
      process.exit(1);
    }
    console.log("PASS — committed fixture matches the pinned bundle");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
