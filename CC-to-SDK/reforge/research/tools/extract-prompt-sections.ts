// §3.3 — snapshot the SYSTEM-PROMPT SECTION INVENTORY from the pinned bundle.
//
//   npx tsx research/tools/extract-prompt-sections.ts [--check]
//
// WHY A FIXTURE. This is the third population in the campaign that was being
// carried as a hand-written number. W5 counted hook events by judgment twice and
// was wrong twice; W7's scout hand-counted control-protocol arms and was wrong by
// three. Both were fixed the same way — read the enumeration off the artifact —
// and both fixtures are gate phases now. The prompt sections have been quoted as
// "`OS()`'s ~20 prose sections" since W3, in the campaign spec, in this
// repository's README and in the W3/W4 scout. The real count at this pin is 27
// dynamic section records plus a six-element static head, assembled by a
// five-element return array in which exactly ONE element follows the dynamic
// set (C10.5's review corrected "a two-element tail"). The interesting facts
// about them — which are gated, which are single
// string constants, which reach into another chunk — are exactly the facts a
// wave has to know before it can say what it owns and what it does not.
//
// So the population comes from the bundle, ordered as upstream orders it, with
// every named producer resolved to its defining chunk and byte span. A pin bump
// that adds, drops, reorders or re-points a section reddens `--check` instead of
// quietly narrowing whatever the next wave claims.
//
// HOW THE BUILDER IS FOUND (not hardcoded). Every binding here is minified and
// churns at any bump, so nothing looks for a name. Two AST passes:
//
//   1. THE SECTION-RECORD CONSTRUCTOR, by shape. A top-level two-parameter
//      function whose whole body is `return { name: <p0>, compute: <p1>, … }`.
//      The property names survive minification because the resolver reads them,
//      and graph-wide exactly one function is shaped like that.
//   2. THE BULK CALLER, by usage. The one top-level function that calls that
//      constructor `MIN_SECTIONS` or more times with two arguments.
//
// The naive version of pass 2 — "a function with many two-argument calls to one
// callee" — is NOT unique: the attachment-list builder in the same chunk has 46
// such calls and outranks the real one. Requiring the callee to be a pure record
// constructor carrying a `compute` property is what collapses the candidates to
// one. Recorded because a near-miss that outranks the target is the failure mode
// a shape-based extractor actually has.
//
// CONFIRMATION, from two places that are not pass 1 or pass 2:
//
//   A. the CONSUMER side. Upstream splices a boundary sentinel into the returned
//      array, and the already-owned block partitioner (`system-prompt-blocks`)
//      finds it with `findIndex`. So the candidate's return array must contain a
//      binding that resolves to the string the SDK publishes as
//      `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`. A list of strings that is not the system
//      prompt array cannot pass that.
//   B. the CALLER side. Every call site assigns the awaited result to a property
//      literally named `defaultSystemPrompt` — a name the minifier preserves
//      because it crosses a destructuring boundary.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `prompt-sections-${version}.json`);

/**
 * The smallest section list this tool will accept as the builder. Far above any
 * incidental pair of record constructions, and well below the observed 27 so a
 * pin that retires a third of the sections still resolves rather than throwing.
 */
const MIN_SECTIONS = 10;
/** The string the SDK publishes as `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`; confirmation A. */
const BOUNDARY_SENTINEL = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
/** The property every call site assigns the result to; confirmation B. */
const CALLER_PROPERTY = "defaultSystemPrompt";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface ChunkFacts {
  file: string;
  text: string;
  sf: ts.SourceFile;
  /** local name -> { from chunk basename, exported name } */
  imports: Map<string, { from: string; name: string }>;
  /** exported name -> local name */
  exports: Map<string, string>;
  /** local name -> the top-level declaration node that defines it */
  defines: Map<string, ts.Node>;
}

function readChunk(file: string, text: string): ChunkFacts {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const imports = new Map<string, { from: string; name: string }>();
  const exports = new Map<string, string>();
  const defines = new Map<string, ts.Node>();
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
    if (ts.isFunctionDeclaration(stmt) && stmt.name) defines.set(stmt.name.text, stmt);
    if (ts.isClassDeclaration(stmt) && stmt.name) defines.set(stmt.name.text, stmt);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) defines.set(d.name.text, d);
    }
  }
  return { file, text, sf, imports, exports, defines };
}

function loadChunks(): Map<string, ChunkFacts> {
  const out = new Map<string, ChunkFacts>();
  for (const f of readdirSync(BUNDLE_MODULES)) {
    if (!f.startsWith("chunk-") || !f.endsWith(".js")) continue;
    out.set(f, readChunk(f, readFileSync(join(BUNDLE_MODULES, f), "utf8")));
  }
  return out;
}

// ---------------------------------------------------------------------------
// pass 1 — the section-record constructor, by shape
// ---------------------------------------------------------------------------

/**
 * `function f(a, b) { return { name: a, compute: b, … } }` — nothing else, and
 * both parameters used exactly where the property names say.
 */
function recordConstructorShape(fn: ts.FunctionDeclaration): string[] | null {
  if (fn.parameters.length !== 2) return null;
  const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
  if (params.some((p) => p === null)) return null;
  const body = fn.body;
  if (!body || body.statements.length !== 1) return null;
  const ret = body.statements[0];
  if (!ts.isReturnStatement(ret) || !ret.expression || !ts.isObjectLiteralExpression(ret.expression)) return null;
  const props = new Map<string, ts.Expression>();
  for (const p of ret.expression.properties) {
    if (!ts.isPropertyAssignment(p)) return null;
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (key === null) return null;
    props.set(key, p.initializer);
  }
  const nameInit = props.get("name");
  const computeInit = props.get("compute");
  if (!nameInit || !computeInit) return null;
  if (!ts.isIdentifier(nameInit) || nameInit.text !== params[0]) return null;
  if (!ts.isIdentifier(computeInit) || computeInit.text !== params[1]) return null;
  return [...props.keys()];
}

// ---------------------------------------------------------------------------
// pass 2 — the bulk caller, by usage
// ---------------------------------------------------------------------------

/** Every `<local>(a, b)` call inside `node`, as nodes. */
function twoArgCalls(node: ts.Node, local: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === local && n.arguments.length === 2) {
      out.push(n);
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
}

// ---------------------------------------------------------------------------
// resolution — a producer name -> where it is defined
// ---------------------------------------------------------------------------

interface Resolved {
  symbol: string;
  chunk: string | null;
  start: number | null;
  end: number | null;
  bytes: number | null;
  sha256: string | null;
  /** `function` | `variable` | `class`, or null when the name did not resolve */
  declKind: string | null;
}

function resolve(chunks: Map<string, ChunkFacts>, from: ChunkFacts, symbol: string): Resolved {
  const miss: Resolved = { symbol, chunk: null, start: null, end: null, bytes: null, sha256: null, declKind: null };
  // Neither imported nor defined at the top level of the owning chunk: it is a
  // LOCAL of the builder (upstream binds the resolved section list to one before
  // spreading it). Saying so is different from failing to resolve it, and the
  // fixture's unresolved count only means something if the two are separated.
  if (!from.imports.has(symbol) && !from.defines.has(symbol)) return { ...miss, declKind: "local" };
  let owner: ChunkFacts | undefined = from;
  let local = symbol;
  const imported = from.imports.get(symbol);
  if (imported) {
    owner = chunks.get(imported.from);
    if (!owner) return miss;
    local = owner.exports.get(imported.name) ?? imported.name;
  }
  const decl = owner.defines.get(local);
  if (!decl) return miss;
  const start = decl.getStart(owner.sf);
  const end = decl.getEnd();
  const text = owner.text.slice(start, end);
  const declKind = ts.isFunctionDeclaration(decl) ? "function" : ts.isClassDeclaration(decl) ? "class" : "variable";
  return { symbol, chunk: owner.file, start, end, bytes: end - start, sha256: sha256(text), declKind };
}

/**
 * What an expression PRODUCES, named as far as the syntax allows.
 *
 * A thunk is one of four shapes at this pin, and the distinction is the whole
 * point of the inventory: a call to a named builder is a splice candidate, a
 * bare identifier is a string constant (a `variable-declarator` target or, more
 * usefully, a `primitive` capture), a conditional is a gate around one of those,
 * and anything else is inline expression code with nothing to excise.
 */
function producersOf(expr: ts.Expression): { kind: string; names: string[] } {
  const names: string[] = [];
  let kind = "inline";
  const collect = (n: ts.Expression): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      names.push(n.expression.text);
      return;
    }
    if (ts.isIdentifier(n)) {
      names.push(n.text);
      return;
    }
    if (ts.isConditionalExpression(n)) {
      collect(n.whenTrue);
      collect(n.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.BarBarToken || n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
      collect(n.left);
      collect(n.right);
      return;
    }
    if (ts.isParenthesizedExpression(n)) {
      collect(n.expression);
      return;
    }
    // `...gate() ? [X] : []` — the shape upstream uses for every optional
    // element of the return array, including the boundary sentinel. Without
    // this the sentinel is invisible and confirmation A cannot pass.
    if (ts.isArrayLiteralExpression(n)) {
      for (const el of n.elements) collect(ts.isSpreadElement(el) ? el.expression : el);
      return;
    }
  };
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) kind = "call";
  else if (ts.isIdentifier(expr)) kind = "constant";
  else if (ts.isConditionalExpression(expr)) kind = "gated";
  else if (ts.isBinaryExpression(expr)) kind = "gated";
  collect(expr);
  // `null` is a literal, not a producer, and it is how upstream says "suppressed"
  return { kind, names: names.filter((n) => n !== "null" && n !== "undefined") };
}

// ---------------------------------------------------------------------------

export interface SectionRow {
  order: number;
  /** the record's name argument, as SOURCE — four of them are template literals */
  name: string;
  nameKind: "literal" | "template" | "identifier" | "expression";
  /** whether the record itself sits behind a spread conditional in the array */
  conditional: boolean;
  /** what the thunk produces */
  produces: { kind: string; names: string[] };
  resolved: Resolved[];
}

export interface ReturnElementRow {
  order: number;
  kind: string;
  source: string;
  produces: { kind: string; names: string[] };
  resolved: Resolved[];
}

export interface PromptSectionFixture {
  engineVersion: string;
  generatedBy: string;
  builder: { chunk: string; binding: string; start: number; end: number; bytes: number; sha256: string; params: number };
  recordConstructor: { chunk: string; binding: string; properties: string[] };
  confirmation: {
    boundarySentinelFoundIn: string | null;
    boundaryBinding: string | null;
    callerPropertySites: { chunk: string; count: number }[];
  };
  counts: { sections: number; returnElements: number; namedProducers: number; localProducers: number; unresolvedProducers: number };
  sections: SectionRow[];
  returnElements: ReturnElementRow[];
}

export function extract(version = ENGINE_VERSION): PromptSectionFixture {
  const chunks = loadChunks();

  // ---- pass 1: the record constructor --------------------------------------
  const ctors: { chunk: ChunkFacts; binding: string; properties: string[] }[] = [];
  for (const c of chunks.values()) {
    for (const stmt of c.sf.statements) {
      if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
      const props = recordConstructorShape(stmt);
      if (props) ctors.push({ chunk: c, binding: stmt.name.text, properties: props });
    }
  }
  if (ctors.length !== 1) {
    throw new Error(
      `section-record constructor: expected exactly one function shaped ` +
        `\`(a,b) => ({name:a, compute:b, …})\`, found ${ctors.length}` +
        (ctors.length > 1 ? ` (${ctors.map((c) => `${c.binding}@${c.chunk.file}`).join(", ")})` : ""),
    );
  }
  const ctor = ctors[0];

  // ---- pass 2: the bulk caller ---------------------------------------------
  const candidates: { chunk: ChunkFacts; fn: ts.FunctionDeclaration; calls: ts.CallExpression[] }[] = [];
  for (const c of chunks.values()) {
    // which local name does THIS chunk know the constructor by?
    const locals = new Set<string>();
    if (c.file === ctor.chunk.file) locals.add(ctor.binding);
    for (const [local, imp] of c.imports) {
      if (imp.from !== ctor.chunk.file) continue;
      if ((ctor.chunk.exports.get(imp.name) ?? imp.name) === ctor.binding) locals.add(local);
    }
    if (locals.size === 0) continue;
    for (const stmt of c.sf.statements) {
      if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
      const calls = [...locals].flatMap((l) => twoArgCalls(stmt, l));
      if (calls.length >= MIN_SECTIONS) candidates.push({ chunk: c, fn: stmt, calls });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `prompt-section builder: expected exactly one function with >= ${MIN_SECTIONS} two-argument ` +
        `calls to ${ctor.binding}, found ${candidates.length}` +
        (candidates.length > 1 ? ` (${candidates.map((c) => `${c.fn.name!.text}@${c.chunk.file}`).join(", ")})` : ""),
    );
  }
  const { chunk: owner, fn: builder, calls } = candidates[0];
  const bStart = builder.getStart(owner.sf);
  const bEnd = builder.getEnd();

  // ---- the sections, in source order ---------------------------------------
  calls.sort((a, b) => a.getStart(owner.sf) - b.getStart(owner.sf));
  const sections: SectionRow[] = calls.map((call, order) => {
    const nameArg = call.arguments[0];
    const nameKind = ts.isStringLiteral(nameArg)
      ? "literal"
      : ts.isTemplateExpression(nameArg) || ts.isNoSubstitutionTemplateLiteral(nameArg)
        ? "template"
        : ts.isIdentifier(nameArg)
          ? "identifier"
          : "expression";
    const thunk = call.arguments[1];
    const thunkBody = ts.isArrowFunction(thunk) && !ts.isBlock(thunk.body) ? thunk.body : thunk;
    const produces = producersOf(thunkBody as ts.Expression);
    // a record inside `...cond ? [ … ] : [ … ]` is conditional on the ARRAY level
    let conditional = false;
    for (let n: ts.Node | undefined = call.parent; n && n !== builder; n = n.parent) {
      if (ts.isConditionalExpression(n) || ts.isSpreadElement(n)) conditional = true;
    }
    return {
      order,
      name: nameArg.getText(owner.sf),
      nameKind: nameKind as SectionRow["nameKind"],
      conditional,
      produces,
      resolved: produces.names.map((n) => resolve(chunks, owner, n)),
    };
  });

  // ---- the return array, in source order -----------------------------------
  // The head builders, the boundary sentinel, the resolved sections and the tail
  // all live here; recording the array rather than classifying it keeps the
  // fixture a reading of upstream rather than an interpretation of it.
  let returnArray: ts.ArrayLiteralExpression | null = null;
  const findReturn = (n: ts.Node): void => {
    if (returnArray) return;
    if (ts.isReturnStatement(n) && n.expression && ts.isArrayLiteralExpression(n.expression) && n.parent === builder.body) {
      returnArray = n.expression;
      return;
    }
    if (ts.isReturnStatement(n) && n.expression && ts.isCallExpression(n.expression)) {
      // `return [ … ].filter(…)`
      const target = n.expression.expression;
      if (ts.isPropertyAccessExpression(target) && ts.isArrayLiteralExpression(target.expression) && n.parent === builder.body) {
        returnArray = target.expression;
        return;
      }
    }
    ts.forEachChild(n, findReturn);
  };
  findReturn(builder.body!);
  if (returnArray === null) throw new Error(`prompt-section builder ${builder.name!.text}: no top-level array return found`);

  const returnElements: ReturnElementRow[] = (returnArray as ts.ArrayLiteralExpression).elements.map((el, order) => {
    const inner = ts.isSpreadElement(el) ? el.expression : el;
    const produces = producersOf(inner);
    return {
      order,
      kind: ts.isSpreadElement(el) ? "spread" : ts.isCallExpression(el) ? "call" : ts.isIdentifier(el) ? "identifier" : "expression",
      source: el.getText(owner.sf).slice(0, 200),
      produces,
      resolved: produces.names.map((n) => resolve(chunks, owner, n)),
    };
  });

  // ---- confirmation A: the boundary sentinel -------------------------------
  let boundarySentinelFoundIn: string | null = null;
  let boundaryBinding: string | null = null;
  for (const row of returnElements) {
    for (const r of row.resolved) {
      if (r.chunk === null || r.declKind !== "variable") continue;
      const text = chunks.get(r.chunk)!.text.slice(r.start!, r.end!);
      if (text.includes(BOUNDARY_SENTINEL)) {
        boundarySentinelFoundIn = r.chunk;
        boundaryBinding = r.symbol;
      }
    }
  }
  if (boundarySentinelFoundIn === null) {
    throw new Error(
      `confirmation A failed: the return array of ${builder.name!.text} references no binding resolving to ` +
        `${BOUNDARY_SENTINEL}. Either the sentinel moved or this is not the system-prompt builder.`,
    );
  }

  // ---- confirmation B: the caller-side property ----------------------------
  const callerPropertySites: { chunk: string; count: number }[] = [];
  const builderName = builder.name!.text;
  for (const c of chunks.values()) {
    const locals = new Set<string>();
    if (c.file === owner.file) locals.add(builderName);
    for (const [local, imp] of c.imports) {
      if (imp.from !== owner.file) continue;
      if ((owner.exports.get(imp.name) ?? imp.name) === builderName) locals.add(local);
    }
    if (locals.size === 0) continue;
    // The result is never assigned to the property DIRECTLY — upstream binds it
    // to a local first (`let x = await OS(…)`, then `{defaultSystemPrompt: x}`),
    // so the confirmation has to follow one hop. Collecting the bindings first
    // and then the property assignments keeps this a syntactic fact rather than
    // a name coincidence: a chunk that merely mentions the property name and
    // separately imports the builder does not pass.
    const bound = new Set<string>();
    const isBuilderCall = (e: ts.Expression): boolean => {
      const inner = ts.isAwaitExpression(e) ? e.expression : e;
      return ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && locals.has(inner.expression.text);
    };
    const collectBindings = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isBuilderCall(n.initializer)) bound.add(n.name.text);
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left) &&
        isBuilderCall(n.right)
      ) {
        bound.add(n.left.text);
      }
      ts.forEachChild(n, collectBindings);
    };
    collectBindings(c.sf);
    let count = 0;
    const walk = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === CALLER_PROPERTY) {
        const init = n.initializer;
        if (isBuilderCall(init) || (ts.isIdentifier(init) && bound.has(init.text))) count++;
      }
      ts.forEachChild(n, walk);
    };
    walk(c.sf);
    if (count > 0) callerPropertySites.push({ chunk: c.file, count });
  }
  if (callerPropertySites.length === 0) {
    throw new Error(
      `confirmation B failed: no call site assigns ${builderName}(…) to a property named '${CALLER_PROPERTY}'. ` +
        `The shape passes but the caller contract does not — refusing to write a fixture on shape alone.`,
    );
  }

  const allResolved = [...sections.flatMap((s) => s.resolved), ...returnElements.flatMap((r) => r.resolved)];
  return {
    engineVersion: version,
    generatedBy: "research/tools/extract-prompt-sections.ts",
    builder: {
      chunk: owner.file,
      binding: builderName,
      start: bStart,
      end: bEnd,
      bytes: bEnd - bStart,
      sha256: sha256(owner.text.slice(bStart, bEnd)),
      params: builder.parameters.length,
    },
    recordConstructor: { chunk: ctor.chunk.file, binding: ctor.binding, properties: ctor.properties },
    confirmation: { boundarySentinelFoundIn, boundaryBinding, callerPropertySites },
    counts: {
      sections: sections.length,
      returnElements: returnElements.length,
      namedProducers: allResolved.length,
      localProducers: allResolved.filter((r) => r.declKind === "local").length,
      unresolvedProducers: allResolved.filter((r) => r.chunk === null && r.declKind !== "local").length,
    },
    sections,
    returnElements,
  };
}

/** The whole committed fixture, for callers that need the spans. */
export function readFixture(version = ENGINE_VERSION): PromptSectionFixture {
  return JSON.parse(readFileSync(fixturePath(version), "utf8")) as PromptSectionFixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const text = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  console.log(`  builder: ${fx.builder.binding}@${fx.builder.chunk} ${fx.builder.bytes} B, ${fx.builder.params} params`);
  console.log(`  record constructor: ${fx.recordConstructor.binding}@${fx.recordConstructor.chunk} {${fx.recordConstructor.properties.join(",")}}`);
  console.log(
    `  sections: ${fx.counts.sections}   return elements: ${fx.counts.returnElements}   ` +
      `named producers: ${fx.counts.namedProducers} (${fx.counts.localProducers} local, ${fx.counts.unresolvedProducers} unresolved)`,
  );
  console.log(`  confirmation A: boundary sentinel via ${fx.confirmation.boundaryBinding}@${fx.confirmation.boundarySentinelFoundIn}`);
  console.log(
    `  confirmation B: '${CALLER_PROPERTY}' call sites — ${fx.confirmation.callerPropertySites.map((s) => `${s.chunk}x${s.count}`).join(", ")}`,
  );

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== text) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-prompt-sections.ts`);
      process.exit(1);
    }
    console.log("PASS — committed fixture matches the pinned bundle");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
