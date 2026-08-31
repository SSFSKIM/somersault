// §3.3 — snapshot the feature-gate DEFAULTS table from the pinned bundle.
//
//   npx tsx research/tools/extract-gate-defaults.ts [--check]
//
// WHY A FIXTURE. `reforge/research/2026-08-31-gate-blob-resolution.md` proved
// there is no per-gate default table anywhere in the engine: the resolver
// short-circuits to `{ value: <the caller's second argument>, source:"disabled" }`
// whenever the kill-switches are on, which under reforge's environment is
// always. So the effective gate configuration IS the set of second arguments at
// the call sites — several hundred literals scattered through the graph, baked
// per build, and able to change silently across a pin bump.
//
// This tool materialises that set into an `ENGINE_VERSION`-keyed fixture. Two
// jobs: it is the review artifact at a pin bump (regenerate, read the diff), and
// it is the engine-ts deliverable — engine-ts implements gates as this constant
// table plus a stub resolver.
//
// `--check` regenerates in memory and fails if the committed fixture differs,
// so a bump cannot land with a stale table.
//
// HOW THE EXTRACTION IS DERIVED (not hardcoded). The resolver alias is minified
// and chunk-local, so nothing here looks for the name `I`. Instead:
//   1. find every function whose whole body is `return <f>(a, b).value` — the
//      alias shape the research identified (cli.pretty.js:310385). Two exist in
//      2.1.251, in different chunks.
//   2. resolve those definitions through the ESM export/import graph to the
//      LOCAL binding each consuming chunk calls them by.
//   3. collect `<local>("tengu_…", <literal>)` call sites via the AST, so an
//      argument that merely looks literal (a telemetry object with computed
//      values) cannot be mistaken for a default.
// Anything shaped like a gate read whose callee is NOT a resolved alias is
// recorded in `unresolved` rather than dropped — the residue is reviewable
// instead of invisible.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `gate-defaults-${version}.json`);

const GATE_PREFIX = "tengu_";

interface ChunkFacts {
  file: string;
  text: string;
  sf: ts.SourceFile;
  /** local name -> { fromChunk, exportedName } */
  imports: Map<string, { from: string; name: string }>;
  /** exported name -> local name */
  exports: Map<string, string>;
  /** local names defined here as `function F(a,b){return g(a,b).value}` */
  localResolvers: Set<string>;
  /**
   * Top-level `var X = "tengu_…"` bindings. Several call sites name their gate
   * through a const rather than inline — `I(yIt, !1)` where
   * `var yIt = "tengu_luminous_whistle"` — and a literals-only scan misses
   * exactly those. It missed the one gate the campaign spec names by hand,
   * which is how the gap was noticed.
   */
  gateConsts: Map<string, string>;
}

/**
 * Recognise a resolver alias by SHAPE, in two forms, both `function F(a, b)`
 * with a single `return`:
 *
 *   - PRIMITIVE:  `return <expr>.getFeatureValueWithSource(a, b)`  — the client
 *     method itself, wrapped (`$m` in the research's rendering).
 *   - FORWARDING: `return <g>(a, b).value`                          — the
 *     one-line `.value` unwrapper the call sites actually use (`I`).
 *
 * The forwarding form accepts ANY callee, which makes the rule transitive
 * without a second pass: a wrapper around a wrapper still matches. That is
 * deliberate — the minified names churn per release, so a rule that pinned the
 * inner callee would need re-anchoring at every bump.
 */
function isResolverAlias(fn: ts.FunctionDeclaration): boolean {
  if (fn.parameters.length !== 2) return false;
  const [p0, p1] = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
  if (p0 === null || p1 === null) return false;
  const body = fn.body;
  if (!body || body.statements.length !== 1) return false;
  const stmt = body.statements[0];
  if (!ts.isReturnStatement(stmt) || !stmt.expression) return false;
  const forwards = (call: ts.Expression): boolean => {
    if (!ts.isCallExpression(call) || call.arguments.length !== 2) return false;
    const [a0, a1] = call.arguments;
    return ts.isIdentifier(a0) && a0.text === p0 && ts.isIdentifier(a1) && a1.text === p1;
  };
  const expr = stmt.expression;
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && /^getFeatureValue/.test(expr.expression.name.text)) {
    return forwards(expr);
  }
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "value") return forwards(expr.expression);
  return false;
}

function readChunk(file: string, text: string): ChunkFacts {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const imports = new Map<string, { from: string; name: string }>();
  const exports = new Map<string, string>();
  const localResolvers = new Set<string>();
  const gateConsts = new Map<string, string>();
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
    if (ts.isFunctionDeclaration(stmt) && stmt.name && isResolverAlias(stmt)) localResolvers.add(stmt.name.text);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && ts.isStringLiteral(d.initializer) && d.initializer.text.startsWith(GATE_PREFIX)) {
          gateConsts.set(d.name.text, d.initializer.text);
        }
      }
    }
  }
  return { file, text, sf, imports, exports, localResolvers, gateConsts };
}

/**
 * Resolve local bindings that reach a resolver alias, following re-exports.
 * Fixed-point: a chunk may re-export an alias it imported, so one pass is not
 * enough and a hardcoded depth would be a guess.
 */
function resolveAliases(chunks: Map<string, ChunkFacts>): Map<string, Set<string>> {
  // chunk -> exported names known to be resolvers
  const resolverExports = new Map<string, Set<string>>();
  const add = (file: string, name: string) => {
    const set = resolverExports.get(file) ?? new Set<string>();
    if (set.has(name)) return false;
    set.add(name);
    resolverExports.set(file, set);
    return true;
  };
  for (const c of chunks.values()) {
    for (const [exported, local] of c.exports) if (c.localResolvers.has(local)) add(c.file, exported);
  }
  /** Is this chunk's local binding a resolver — defined here, or imported from one? */
  const localIsResolver = (c: ChunkFacts, local: string): boolean => {
    if (c.localResolvers.has(local)) return true;
    const imp = c.imports.get(local);
    return imp !== undefined && (resolverExports.get(imp.from)?.has(imp.name) ?? false);
  };

  // A chunk may RE-EXPORT an alias it imported, so one pass is not enough and a
  // fixed depth would be a guess. Iterate to a fixed point.
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of chunks.values()) {
      for (const [exported, local] of c.exports) {
        if (localIsResolver(c, local) && add(c.file, exported)) changed = true;
      }
    }
  }

  const localCallable = new Map<string, Set<string>>();
  for (const c of chunks.values()) {
    const set = new Set<string>(c.localResolvers);
    for (const local of c.imports.keys()) if (localIsResolver(c, local)) set.add(local);
    if (set.size > 0) localCallable.set(c.file, set);
  }
  return localCallable;
}

type Literal = boolean | number | string | null | Record<string, unknown> | unknown[];

/** A default is only a default if it is a pure literal — otherwise it is a computed argument. */
function literalOf(node: ts.Expression): { ok: true; value: Literal } | { ok: false } {
  if (ts.isStringLiteral(node)) return { ok: true, value: node.text };
  if (ts.isNumericLiteral(node)) return { ok: true, value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  // Minifiers emit `!0` / `!1` for true / false.
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    if (node.operand.kind === ts.SyntaxKind.NumericLiteral) return { ok: true, value: (node.operand as ts.NumericLiteral).text === "0" };
    return { ok: false };
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return { ok: true, value: -Number(node.operand.text) };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: unknown[] = [];
    for (const el of node.elements) {
      const v = literalOf(el);
      if (!v.ok) return { ok: false };
      out.push(v.value);
    }
    return { ok: true, value: out };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) return { ok: false };
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (key === null) return { ok: false };
      const v = literalOf(prop.initializer);
      if (!v.ok) return { ok: false };
      out[key] = v.value;
    }
    return { ok: true, value: out };
  }
  return { ok: false };
}

const shapeOf = (v: Literal): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v;

export interface GateFixture {
  engineVersion: string;
  generatedBy: string;
  resolverAliases: { chunk: string; name: string }[];
  counts: {
    callSites: number;
    distinctGates: number;
    chunks: number;
    /** call sites naming their gate with an INLINE string literal — the measurement comparable to the research census */
    inlineSites: number;
    /** call sites naming their gate through a top-level `var X = "tengu_…"` const */
    viaConstSites: number;
    defaultShapes: Record<string, number>;
  };
  /** gate name -> its compiled-in default, plus how many call sites agree on it */
  gates: Record<string, { default: Literal; sites: number }>;
  /** gates whose call sites do NOT agree on one default — reviewed by hand, never averaged */
  conflicts: Record<string, Literal[]>;
  /**
   * Gate reads whose second argument is COMPUTED rather than literal, so no
   * constant default exists to snapshot. Kept as a first-class section, not
   * dropped: engine-ts cannot serve these from the constant table, and a bump
   * that turns a literal default into a computed one (or back) is exactly the
   * kind of change the fixture diff exists to surface.
   */
  computedDefaults: Record<string, { sites: number; chunks: string[] }>;
  /**
   * `tengu_*` two-argument calls whose callee did not resolve to a gate
   * resolver. Overwhelmingly telemetry (`logEvent`/`logEventAsync` take the same
   * `tengu_*` literals), kept as a reviewable residue rather than silently
   * discarded — a resolver whose shape changed upstream would surface here.
   */
  unresolved: { chunk: string; callee: string; gate: string; reason: string }[];
  /**
   * §3.3's "override inventory, regenerated per pin bump": environment variables
   * read inside a function that also reads a gate. These are the surviving
   * per-gate env overrides an operator's shell could otherwise steer.
   */
  perGateEnvOverrides: { gate: string; env: string[]; chunk: string }[];
}


/**
 * §3.3's per-gate ENV OVERRIDE inventory, regenerated per pin bump.
 *
 * Detected by IDIOM, not by proximity. The shape the research documented
 * (cli.pretty.js:497713) is:
 *
 *     let e = a.CLAUDE_CODE_LUMINOUS_WHISTLE;
 *     if (e !== void 0) return e;          // …then the blob, then the default
 *     …
 *     return I("tengu_luminous_whistle", !1);
 *
 * so an override is a variable initialised from an ALL-CAPS environment
 * property whose value is short-circuit-returned when defined, inside a
 * function that also reads a gate. A first attempt simply collected every
 * env-shaped property read anywhere in the enclosing function; on the 4 MB
 * chunk that produced ~100 entries of pure noise, because the enclosing
 * function is often enormous and touches unrelated knobs. Matching the idiom
 * instead is what makes the inventory a fact rather than a co-occurrence.
 */
function recordEnvOverride(
  call: ts.Node,
  gate: string,
  chunk: string,
  into: Map<string, { gate: string; env: Set<string>; chunk: string }>,
): void {
  let owner: ts.Node | undefined = call;
  while (owner && !ts.isFunctionDeclaration(owner) && !ts.isFunctionExpression(owner) && !ts.isArrowFunction(owner) && !ts.isMethodDeclaration(owner)) {
    owner = owner.parent;
  }
  if (!owner) return;

  // local name -> env var it was initialised from
  const fromEnv = new Map<string, string>();
  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isPropertyAccessExpression(n.initializer)) {
      const prop = n.initializer.name.text;
      if (/^_?[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(prop)) fromEnv.set(n.name.text, prop);
    }
    ts.forEachChild(n, collect);
  };
  collect(owner);
  if (fromEnv.size === 0) return;

  const isUndefinedCheck = (e: ts.Expression): string | null => {
    if (!ts.isBinaryExpression(e)) return null;
    const op = e.operatorToken.kind;
    if (op !== ts.SyntaxKind.ExclamationEqualsEqualsToken && op !== ts.SyntaxKind.ExclamationEqualsToken) return null;
    const isUndef = (x: ts.Expression) =>
      (ts.isVoidExpression(x) && ts.isNumericLiteral(x.expression)) || (ts.isIdentifier(x) && x.text === "undefined");
    if (ts.isIdentifier(e.left) && isUndef(e.right)) return e.left.text;
    if (ts.isIdentifier(e.right) && isUndef(e.left)) return e.right.text;
    return null;
  };

  const found = new Set<string>();
  const scan = (n: ts.Node): void => {
    if (ts.isIfStatement(n)) {
      const name = isUndefinedCheck(n.expression);
      const env = name === null ? undefined : fromEnv.get(name);
      if (env) {
        // the then-branch must hand that value straight back
        const returnsIt = (st: ts.Statement): boolean => {
          if (ts.isReturnStatement(st)) return !!st.expression && ts.isIdentifier(st.expression) && st.expression.text === name;
          if (ts.isBlock(st)) return st.statements.some(returnsIt);
          return false;
        };
        if (returnsIt(n.thenStatement)) found.add(env);
      }
    }
    ts.forEachChild(n, scan);
  };
  scan(owner);
  if (found.size === 0) return;
  const entry = into.get(gate) ?? { gate, env: new Set<string>(), chunk };
  for (const e of found) entry.env.add(e);
  into.set(gate, entry);
}

export function extract(modulesDir = BUNDLE_MODULES, version = ENGINE_VERSION): GateFixture {
  const files = readdirSync(modulesDir).filter((f) => f.endsWith(".js"));
  const chunks = new Map<string, ChunkFacts>();
  for (const f of files) {
    const text = readFileSync(join(modulesDir, f), "utf8");
    // Only chunks that mention a gate literal or define/route an alias can matter.
    if (!text.includes(GATE_PREFIX) && !text.includes(").value}")) continue;
    chunks.set(f, readChunk(f, text));
  }
  const callable = resolveAliases(chunks);

  const gates: Record<string, { default: Literal; sites: number }> = {};
  const seen: Record<string, Set<string>> = {};
  const conflicts: Record<string, Literal[]> = {};
  const unresolved: GateFixture["unresolved"] = [];
  const computedDefaults: GateFixture["computedDefaults"] = {};
  const defaultShapes: Record<string, number> = {};
  const envOverrides = new Map<string, { gate: string; env: Set<string>; chunk: string }>();
  let callSites = 0;
  let inlineSites = 0;
  let viaConstSites = 0;
  let touchedChunks = 0;

  for (const c of chunks.values()) {
    const locals = callable.get(c.file) ?? new Set<string>();
    let hitThisChunk = false;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.arguments.length === 2 && ts.isIdentifier(node.expression)) {
        const a0 = node.arguments[0];
        const gate = ts.isStringLiteral(a0) && a0.text.startsWith(GATE_PREFIX)
          ? a0.text
          : ts.isIdentifier(a0)
            ? c.gateConsts.get(a0.text) ?? null
            : null;
        if (gate !== null) {
          const inline = ts.isStringLiteral(a0);
          const callee = node.expression.text;
          if (!locals.has(callee)) {
            unresolved.push({ chunk: c.file, callee, gate, reason: "callee is not a resolved resolver alias" });
          } else {
            const lit = literalOf(node.arguments[1]);
            if (!lit.ok) {
              callSites++;
              if (inline) inlineSites++; else viaConstSites++;
              hitThisChunk = true;
              const prev = computedDefaults[gate] ?? { sites: 0, chunks: [] };
              computedDefaults[gate] = { sites: prev.sites + 1, chunks: prev.chunks.includes(c.file) ? prev.chunks : [...prev.chunks, c.file].sort() };
              (seen[gate] ??= new Set()).add("<computed>");
            } else {
              callSites++;
              if (inline) inlineSites++; else viaConstSites++;
              hitThisChunk = true;
              const key = JSON.stringify(lit.value);
              (seen[gate] ??= new Set()).add(key);
              gates[gate] = { default: lit.value, sites: (gates[gate]?.sites ?? 0) + 1 };
              defaultShapes[shapeOf(lit.value)] = (defaultShapes[shapeOf(lit.value)] ?? 0) + 1;
              recordEnvOverride(node, gate, c.file, envOverrides);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(c.sf);
    if (hitThisChunk) touchedChunks++;
  }

  for (const [gate, values] of Object.entries(seen)) {
    const literals = [...values].filter((v) => v !== "<computed>");
    if (literals.length > 1) conflicts[gate] = literals.map((v) => JSON.parse(v) as Literal);
  }

  const resolverAliases: { chunk: string; name: string }[] = [];
  for (const c of chunks.values()) for (const name of c.localResolvers) resolverAliases.push({ chunk: c.file, name });

  return {
    engineVersion: version,
    generatedBy: "research/tools/extract-gate-defaults.ts",
    resolverAliases: resolverAliases.sort((a, b) => a.chunk.localeCompare(b.chunk)),
    counts: {
      callSites,
      distinctGates: new Set([...Object.keys(gates), ...Object.keys(computedDefaults)]).size,
      chunks: touchedChunks,
      inlineSites,
      viaConstSites,
      defaultShapes: { ...defaultShapes, computed: Object.values(computedDefaults).reduce((n, c) => n + c.sites, 0) },
    },
    gates: Object.fromEntries(Object.entries(gates).sort(([a], [b]) => a.localeCompare(b))),
    conflicts,
    computedDefaults: Object.fromEntries(Object.entries(computedDefaults).sort(([a], [b]) => a.localeCompare(b))),
    unresolved: unresolved.sort((a, b) => (a.gate + a.chunk).localeCompare(b.gate + b.chunk)),
    perGateEnvOverrides: [...envOverrides.values()]
      .map((e) => ({ gate: e.gate, env: [...e.env].sort(), chunk: e.chunk }))
      .sort((a, b) => a.gate.localeCompare(b.gate)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const text = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  console.log(`  resolver aliases: ${fx.resolverAliases.map((r) => `${r.name}@${r.chunk}`).join(", ")}`);
  console.log(`  call sites: ${fx.counts.callSites}  distinct gates: ${fx.counts.distinctGates}  chunks: ${fx.counts.chunks}`);
  console.log(`  default shapes: ${Object.entries(fx.counts.defaultShapes).map(([k, v]) => `${v}×${k}`).join(", ")}`);
  console.log(`  conflicting gates: ${Object.keys(fx.conflicts).length}  unresolved gate-shaped calls: ${fx.unresolved.length}`);
  console.log(`  per-gate env overrides: ${fx.perGateEnvOverrides.length}`);

  // PLAUSIBILITY, against a comparable measurement rather than a headline.
  //
  // The research censused the pretty rendering with a text grep for one alias
  // and inline literals only: 431 sites. The comparable number here is
  // `inlineSites` — an AST walk over the same population. `viaConstSites` and
  // the extra resolver families ($m, R4t) are sites the grep could not see, so
  // comparing the TOTAL against 431 would fail for the wrong reason.
  //
  // Being FEWER than the census is the dangerous direction: it means the
  // extractor lost call sites, and a defaults table with holes is worse than no
  // table. Being somewhat more is expected and itemised above.
  const CENSUS_INLINE_SITES = 431;
  const drift = (fx.counts.inlineSites - CENSUS_INLINE_SITES) / CENSUS_INLINE_SITES;
  const plausible = drift >= -0.05 && drift <= 0.15;
  console.log(
    `  plausibility: ${fx.counts.inlineSites} inline sites vs the research census of ${CENSUS_INLINE_SITES} ` +
      `(${(drift * 100).toFixed(1)}%) — ${plausible ? "OK" : "OUT OF RANGE"}; +${fx.counts.viaConstSites} named through a const`,
  );
  if (!plausible) {
    console.error("FAIL — inline call-site count diverges from the independently measured census; do not trust this fixture");
    process.exit(1);
  }

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    const committed = readFileSync(out, "utf8");
    if (committed !== text) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-gate-defaults.ts`);
      process.exit(1);
    }
    console.log(`PASS — committed fixture matches the pinned bundle`);
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
