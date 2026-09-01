// S-CHUNK — whole-chunk ownership (campaign spec §2.2).
//
// The S-method excises one node out of a chunk and leaves the rest of the file
// upstream's. S-chunk does the other thing: the chunk FILE is replaced by a
// reforge-authored module that exports the same surface. Nothing of upstream's
// bytes survives in it, which is why §2.2 prices it as "the whole export
// surface" rather than "one function".
//
// ## What the build re-derives, and what it refuses
//
// §2.2's binding rule is that export names are minified and churn per version, so
// "the build derives them from the original chunk's export statement each build;
// perturbing a derived name must fail the build loudly". That is the same bet the
// S-method's capture derivations make, applied one level out, and it is enforced
// the same way — by SHAPE, from the pinned bytes, never from a constant:
//
//   1. the chunk is located by a true-substring-unique literal anchor, exactly
//      like a splice (strangle/anchor.ts). Never by chunk NAME: chunk names are
//      content-addressed and churn per pin.
//   2. its top-level statements are audited. Only imports, `var`/`let`/`const`
//      declarations, function declarations and ONE local named export clause are
//      allowed. Any other top-level statement is a SIDE EFFECT, and a chunk with
//      side effects is not clean for whole-file replacement — the build refuses
//      it rather than silently dropping whatever it did.
//   3. every export name is re-derived from the chunk body by shape, and the
//      derived set must EQUAL the export clause's set. A missing derivation and
//      an unclaimed export are both failures: the first means the shape moved,
//      the second means the replacement would drop an export thirteen chunks
//      import.
//   4. every import BINDING is re-derived the same way, and that set must equal
//      the chunk's actual import bindings. The specifier and the imported name
//      then come from the AST, so the replacement imports the ports from the same
//      chunks upstream did.
//   5. an export declared as a constant also has its VALUE derived and compared
//      against the owned module's, at build time, against the pinned bytes. For a
//      constant that no scenario renders this is the whole of the parity claim —
//      and it is strictly stronger than a differential red would be, because it
//      compares against upstream rather than against whatever a scenario happened
//      to exercise.
//
// ## Sabotage is per EXPORT
//
// §2.2 asks for "behavioral coverage + sabotage evidence for every retained
// export, not just the headline function". One twin per chunk cannot deliver
// that: it would pass as long as ANY export is live. So the replacement is wired
// export by export — `--sabotage <row>:<export>` takes exactly that binding from
// the module's `sabotage.js` and leaves every other one on `reference.js`.
//
// An export the corpus genuinely cannot observe (upstream's REPL tool name is
// one: the REPL is unreachable headlessly) declares `darkReason` instead of
// coverage. That is an adjudication, recorded in the manifest and surfaced by the
// gate — not an omission, and not something the machinery will let a row have by
// accident.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import type { Excision } from "./ast.js";
import { chunkAst } from "./ast.js";
import { resolveAnchor } from "./anchor.js";
import { spliceFootprint, type SpliceFootprint } from "./footprint.js";
import type { ChunkReplacement, DerivedCapture } from "./manifest.js";

/** One derived export: the minified name, the owned binding it is bound to. */
export interface PlannedExport {
  as: string;
  /** the minified identifier upstream exports it under, derived this build */
  name: string;
  /** the owned binding in the module that implements it */
  owned: string;
  coverage: string[];
  darkReason?: string;
}

/** One derived import binding: the minified local name and where it comes from. */
export interface PlannedImport {
  as: string;
  name: string;
  specifier: string;
  importedName: string;
}

export interface ChunkPlan {
  row: ChunkReplacement;
  /** absolute path of the chunk in the materialized graph */
  path: string;
  /** the chunk's name relative to the graph root */
  chunk: string;
  /** the original materialized source, before replacement */
  source: string;
  exports: PlannedExport[];
  imports: PlannedImport[];
  /** every export name, in the order the original export clause listed them */
  exportOrder: string[];
  /**
   * Render the replacement file. `sabotaged` names the EXPORTS (`as` handles)
   * whose owned binding is taken from the module's sabotage layer.
   */
  render(modulesRoot: string, sabotaged: ReadonlySet<string>): string;
  /** the §5 footprint: the whole original chunk, plus its import declarations */
  footprint(upstream: (text: string) => string, resolveModule: (spec: string) => { name: string; sf: ts.SourceFile } | null): SpliceFootprint;
}

/** The leading comment block, verbatim — `// @bun` must stay byte-first (prepare.ts). */
function bannerOf(src: string): string {
  let i = 0;
  for (;;) {
    const nl = src.indexOf("\n", i);
    if (nl < 0) throw new Error("chunk has no code line after its banner");
    const line = src.slice(i, nl).trim();
    if (line !== "" && !line.startsWith("//")) return src.slice(0, i);
    i = nl + 1;
  }
}

/** The one local named export clause, and the names it lists in order. */
function exportClause(sf: ts.SourceFile, name: string): string[] {
  const clauses = sf.statements.filter(ts.isExportDeclaration);
  if (clauses.length !== 1) {
    throw new Error(`${name}: expected exactly one export clause, found ${clauses.length} — whole-chunk replacement cannot guess the surface`);
  }
  const clause = clauses[0];
  if (clause.moduleSpecifier) throw new Error(`${name}: the chunk RE-EXPORTS from another module; the replacement would have to reproduce that edge`);
  if (!clause.exportClause || !ts.isNamedExports(clause.exportClause)) throw new Error(`${name}: export * is not a surface the replacement can enumerate`);
  return clause.exportClause.elements.map((el) => {
    if (el.propertyName) throw new Error(`${name}: export '${el.name.text}' is aliased from '${el.propertyName.text}' — declare the alias deliberately`);
    return el.name.text;
  });
}

/**
 * Is this initializer INERT — evaluable at module init with no effect the
 * replacement would drop (campaign spec C5x, unit 9)?
 *
 * The statement-kind check below is necessary and was not sufficient: a
 * top-level `var x = effectfulCall()` is a `VariableStatement`, and the chunk
 * replacement drops the call along with the file. It was bounded in practice
 * only by the accident that the one owned chunk has none — which is the shape of
 * bound the W2 boundary review flagged, and not one to keep.
 *
 * ALLOWED, because evaluating them can be reproduced by the replacement's own
 * declaration: literals of every kind, template literals, identifiers and member
 * reads (an imported binding is exactly how `${yt}` reaches a prompt string),
 * arrays and objects of allowed things, operators over them, and function or
 * arrow expressions — whose BODIES are not entered, because they do not run at
 * init.
 *
 * REFUSED: anything that calls, constructs, awaits, yields, assigns, mutates or
 * tags — and a class expression, whose static blocks and field initializers DO
 * run at definition. The refusal names the construct and the offset, because the
 * answer to it is a judgement (fall back to S-method splices), not a retry.
 */
function inertInitializer(n: ts.Node): { kind: string; at: number } | null {
  if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return null; // body is not evaluated here
  if (
    ts.isCallExpression(n) ||
    ts.isNewExpression(n) ||
    ts.isAwaitExpression(n) ||
    ts.isYieldExpression(n) ||
    ts.isTaggedTemplateExpression(n) ||
    ts.isClassExpression(n) ||
    ts.isDeleteExpression(n) ||
    ts.isPostfixUnaryExpression(n) ||
    (ts.isPrefixUnaryExpression(n) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) ||
    (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
  ) {
    return { kind: ts.SyntaxKind[n.kind], at: n.pos };
  }
  let found: { kind: string; at: number } | null = null;
  ts.forEachChild(n, (c) => {
    found ??= inertInitializer(c);
  });
  return found;
}

/**
 * Rule 2: a chunk with top-level side effects is not clean for whole-file
 * replacement. Refusing is the point — the scout's "zero side effects" reading is
 * a claim about the pinned bytes, and this is what re-checks it every build.
 */
function auditTopLevel(sf: ts.SourceFile, name: string): void {
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const effect = d.initializer && inertInitializer(d.initializer);
        if (!effect) continue;
        throw new Error(
          `${name}: top-level declarator '${d.name.getText(sf)}' initializes with a ${effect.kind} at offset ${effect.at} — ` +
            `that runs when the chunk is evaluated, and replacing the file whole would drop it. ` +
            `Fall back to S-method splices of the individual functions (§2.2).`,
        );
      }
      continue;
    }
    if (ts.isImportDeclaration(s) || ts.isFunctionDeclaration(s) || ts.isExportDeclaration(s)) continue;
    throw new Error(
      `${name}: top-level ${ts.SyntaxKind[s.kind]} at offset ${s.getStart(sf)} — the chunk has side effects beyond declarations, ` +
        `so replacing the file whole would drop behaviour. Fall back to S-method splices of the individual functions (§2.2).`,
    );
  }
}

/**
 * Every binding an import clause introduces, with where it came from — plus the
 * specifiers in DECLARATION order, which the replacement has to preserve.
 */
function importBindings(sf: ts.SourceFile): {
  bindings: Map<string, { specifier: string; importedName: string }>;
  specifiers: string[];
} {
  const out = new Map<string, { specifier: string; importedName: string }>();
  const specifiers: string[] = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s)) continue;
    if (!ts.isStringLiteral(s.moduleSpecifier)) continue;
    const specifier = s.moduleSpecifier.text;
    if (!specifiers.includes(specifier)) specifiers.push(specifier);
    const c = s.importClause;
    if (!c) continue; // a bare side-effect import binds nothing
    if (c.name) out.set(c.name.text, { specifier, importedName: "default" });
    if (!c.namedBindings) continue;
    if (ts.isNamespaceImport(c.namedBindings)) out.set(c.namedBindings.name.text, { specifier, importedName: "*" });
    else for (const el of c.namedBindings.elements) out.set(el.name.text, { specifier, importedName: (el.propertyName ?? el.name).text });
  }
  return { bindings: out, specifiers };
}

const setEq = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Derive, cross-check and plan one chunk replacement against the materialized graph. */
export function planChunkReplacement(
  sources: ReadonlyMap<string, string>,
  row: ChunkReplacement,
  label: (path: string) => string,
): ChunkPlan {
  const { path, source } = resolveAnchor(sources, row, label);
  const chunk = label(path);
  const sf = chunkAst(path, source);
  auditTopLevel(sf, row.name);

  const exportOrder = exportClause(sf, row.name);
  const exports: PlannedExport[] = row.exports.map((e) => {
    const name = e.derive(source); // throws when the shape moved
    if (!exportOrder.includes(name)) {
      throw new Error(`${row.name}: export '${e.as}' derived '${name}', which the chunk's export clause does not list (${exportOrder.join(", ")})`);
    }
    if (e.coverage.length === 0 && e.darkReason === undefined) {
      throw new Error(`${row.name}: export '${e.as}' declares no covering scenario and no darkReason — an ungated export must be adjudicated, not left silent (§2.2)`);
    }
    return { as: e.as, name, owned: e.owned, coverage: e.coverage, darkReason: e.darkReason };
  });
  const derivedExports = exports.map((e) => e.name);
  if (new Set(derivedExports).size !== derivedExports.length) throw new Error(`${row.name}: two manifest exports derived the same identifier (${derivedExports.join(", ")})`);
  if (!setEq(derivedExports, exportOrder)) {
    const unclaimed = exportOrder.filter((n) => !derivedExports.includes(n));
    throw new Error(
      `${row.name}: the manifest does not claim the chunk's whole export surface.\n` +
        `  exported: ${exportOrder.join(", ")}\n  claimed:  ${derivedExports.join(", ")}\n` +
        (unclaimed.length > 0 ? `  UNCLAIMED: ${unclaimed.join(", ")} — the replacement would drop bindings other chunks import.` : ""),
    );
  }

  const { bindings, specifiers: specifierOrder } = importBindings(sf);
  const imports: PlannedImport[] = row.imports.map((i) => {
    const name = i.derive(source);
    const from = bindings.get(name);
    if (!from) {
      throw new Error(`${row.name}: import '${i.as}' derived '${name}', which is not an import binding of ${chunk} (${[...bindings.keys()].join(", ") || "none"})`);
    }
    return { as: i.as, name, specifier: from.specifier, importedName: from.importedName };
  });
  const derivedImports = imports.map((i) => i.name);
  if (!setEq(derivedImports, [...bindings.keys()])) {
    const unclaimed = [...bindings.keys()].filter((n) => !derivedImports.includes(n));
    throw new Error(
      `${row.name}: the manifest does not classify every import binding.\n` +
        `  imported: ${[...bindings.keys()].join(", ")}\n  claimed:  ${derivedImports.join(", ")}\n` +
        (unclaimed.length > 0 ? `  UNCLASSIFIED: ${unclaimed.join(", ")} — each is a §2.4 capture and a ledger edge.` : ""),
    );
  }

  const byName = new Map(exports.map((e) => [e.as, e]));
  const portName = (as: string): string => {
    const found = imports.find((i) => i.as === as);
    if (!found) throw new Error(`${row.name}: the replacement asks for port '${as}', which the manifest does not declare`);
    return found.name;
  };
  const banner = bannerOf(source);

  return {
    row,
    path,
    chunk,
    source,
    exports,
    imports,
    exportOrder,
    render(modulesRoot, sabotaged) {
      // Graph imports first, grouped by specifier and emitted in the order the
      // ORIGINAL chunk declared them, not in manifest order: ESM evaluates a
      // module's dependencies in source order, so reordering them here would
      // reorder initialization across a 1,657-chunk graph for no reason at all.
      const bySpecifier = new Map<string, string[]>();
      for (const spec of specifierOrder) bySpecifier.set(spec, []);
      for (const i of imports) {
        const clause = i.importedName === i.name ? i.name : `${i.importedName} as ${i.name}`;
        bySpecifier.get(i.specifier)!.push(clause);
      }
      const lines = [...bySpecifier].map(([spec, names]) => `import{${names.join(",")}}from${JSON.stringify(spec)};`);

      // Owned imports: each export's binding, from the reference or sabotage
      // layer, plus whatever helpers the row's prologue needs.
      const owned = new Map<string, Set<string>>();
      const need = (from: string, name: string) => {
        const file = `${modulesRoot}/${from}`;
        owned.set(file, (owned.get(file) ?? new Set()).add(name));
      };
      for (const e of exports) {
        need(`${row.module}/${sabotaged.has(e.as) ? "sabotage" : "reference"}.js`, e.owned);
      }
      for (const h of row.helpers ?? []) for (const n of h.names) need(h.from, n);
      for (const [file, names] of owned) lines.push(`import{${[...names].join(",")}}from${JSON.stringify(file)};`);

      if (row.prologue) lines.push(row.prologue(portName));
      for (const name of exportOrder) {
        const e = exports.find((x) => x.name === name)!;
        const spec = row.exports.find((x) => x.as === e.as)!;
        lines.push(spec.declare(e.name, e.owned, portName));
      }
      lines.push(`export{${exportOrder.join(",")}};`);
      return banner + lines.join("\n") + "\n";
    },
    footprint(upstream, resolveModule) {
      // The target span is the WHOLE original chunk: that is what the owned
      // module replaced, so that is what §5 has to stale on. The captures are the
      // import bindings — recorded on both sides (the import site here, the
      // declaration in the exporting chunk), exactly as a splice's are.
      const cut = {
        shape: "free-function",
        label: "<whole chunk>",
        node: sf,
        signature: { params: 0, ancestry: [] },
        start: 0,
        end: source.length,
        original: source,
        shapeArgs: [],
        render: () => "",
      } as unknown as Excision;
      const captures: DerivedCapture[] = row.imports.map((i, n) => ({
        as: i.as,
        kind: i.kind,
        owned: false,
        identifier: imports[n].name,
      }));
      return spliceFootprint({ name: row.name, chunk, sf, cut, captures, resolveModule, upstream });
    },
  };
}

/**
 * Rule 5: an export the manifest declares constant must carry the value the
 * pinned chunk gives it. Run against the owned module's live export, so the two
 * cannot drift while the name stays put.
 */
export async function assertOwnedValues(plan: ChunkPlan, modulesRoot: string): Promise<string[]> {
  const checked: string[] = [];
  const mod = (await import(`${modulesRoot}/${plan.row.module}/reference.js`)) as Record<string, unknown>;
  for (const spec of plan.row.exports) {
    if (!spec.value) continue;
    const upstreamValue = spec.value(plan.source);
    const ownedValue = mod[spec.owned];
    if (ownedValue !== upstreamValue) {
      throw new Error(
        `${plan.row.name}: export '${spec.as}' — the owned '${spec.owned}' is ${JSON.stringify(ownedValue)} but the pinned chunk declares ${JSON.stringify(upstreamValue)}.\n` +
          `  A constant whose VALUE moves while its name stays put moves no anchor and no footprint hash; this comparison is what sees it.`,
      );
    }
    checked.push(`${spec.as}=${JSON.stringify(upstreamValue)}`);
  }
  return checked;
}

/** Read a chunk out of the pinned bundle rather than the graph — used by perturb.ts. */
export const readChunk = (path: string) => readFileSync(path, "utf8");
export const chunkLabel = (root: string) => (p: string) => relative(root, p);
