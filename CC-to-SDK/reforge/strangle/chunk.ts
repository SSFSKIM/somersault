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
//   5. an export declared as a constant also has its VALUE derived from the
//      pinned bytes and compared against the owned module's live export. For a
//      constant no scenario renders, the pinned bytes are the whole of the parity
//      claim — stronger than a differential red, which can only speak about what
//      a scenario happened to exercise.
//
//      SAID PRECISELY, because the enforcement is not where the sentence above
//      makes it sound (W2 boundary review). For the constants owned today there
//      is no shape that identifies WHICH minified binding is the tool name except
//      its value — `var ti="Glob"` — so the NAME derivation is anchored on the
//      value too. An upstream value change therefore fails in the derivation
//      ("could not derive"), before the comparison is ever reached; what the
//      comparison catches is the other direction, an owned module edited away
//      from the pinned value. Both are loud and both grade against upstream, but
//      only one of them is a comparison, and a reader deciding whether a new row
//      needs a `value` should know which. Where a constant IS identifiable
//      without its value — a prompt anchored on its opening sentence, as the
//      `variable-declarator` splice shape does — the comparison is what fires,
//      and it reports the first differing character.
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
import type { ChunkReplacement, ChunkStateSpec, DerivedCapture } from "./manifest.js";

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
  /** the declared module state, with each binding resolved this build (rule 2b) */
  state: { as: string; binding: string; construct: string; reproducedBy: string; why: string }[];
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
 *
 * ## Rule 2b — MODULE STATE, declared (C16b / W13b)
 *
 * The refusal above reads "replacing the file whole would DROP it", and for the
 * first owned chunk that was the whole story: its constructions were the ones a
 * replacement would silently lose. The second owned chunk is the other case, and
 * it is not an exception to the rule so much as the rule's other half. Its
 * entire content is two constructions — a latch object and a promise built with
 * an empty executor so it can never settle — and the replacement does not drop
 * them: it RE-DECLARES them, at module scope, with the same one-per-process
 * identity ESM gives upstream's.
 *
 * That distinction cannot be inferred from the AST, so the row DECLARES it and
 * this checks the declaration:
 *
 *   * every constructing declarator must be claimed by a `moduleState` entry
 *     whose derivation resolves to that same binding, so a construction the row
 *     did not think about still fails;
 *   * the entry names the CONSTRUCT it expects, so an upstream `new Foo` that
 *     becomes `new Bar(io())` is a mismatch rather than a silent pass;
 *   * every entry must match something, so an exemption that has stopped
 *     applying fails as loudly as a missing one. A carve-out nothing exercises
 *     is a carve-out nobody re-reads.
 *
 * What it deliberately does NOT try to do is prove the owned module reproduces
 * the semantics. Nothing static can. That claim is `why`, printed every build,
 * and it is graded where the campaign grades every other parity claim: a
 * contract test against upstream's own bytes, plus per-export sabotage.
 */
function auditTopLevel(sf: ts.SourceFile, name: string, state: ReadonlyMap<string, ChunkStateSpec>): void {
  const claimed = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const effect = d.initializer && inertInitializer(d.initializer);
        if (!effect) continue;
        const binding = d.name.getText(sf);
        const declared = state.get(binding);
        if (declared !== undefined && declared.construct === effect.kind) {
          claimed.add(declared.as);
          continue;
        }
        throw new Error(
          `${name}: top-level declarator '${binding}' initializes with a ${effect.kind} at offset ${effect.at} — ` +
            `that runs when the chunk is evaluated, and replacing the file whole would drop it.` +
            (declared === undefined
              ? ` Declare it as \`moduleState\` if the owned module re-declares it with the same identity, or fall back to S-method splices (§2.2).`
              : ` The row declares '${declared.as}' as a ${declared.construct}, which is not what upstream has here.`),
        );
      }
      continue;
    }
    if (ts.isImportDeclaration(s) || ts.isFunctionDeclaration(s) || ts.isExportDeclaration(s)) continue;
    // A CLASS DECLARATION, but only the inert kind. Defining a class evaluates
    // its STATIC field initializers and runs its static blocks; instance field
    // initializers run per `new`, not here. So a class with neither is a binding
    // like any other declaration and a replacement that re-declares it drops
    // nothing — while one with a static initializer runs code at module
    // evaluation and is exactly what this audit exists to refuse.
    if (ts.isClassDeclaration(s)) {
      const eager = s.members.find(
        (m) => ts.isClassStaticBlockDeclaration(m) || (ts.canHaveModifiers(m) && (ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword)),
      );
      if (eager === undefined) continue;
      throw new Error(
        `${name}: top-level class '${s.name?.text ?? "<anonymous>"}' has a static member or static block at offset ${eager.getStart(sf)} — ` +
          `that runs when the chunk is evaluated, and replacing the file whole would drop it. ` +
          `Fall back to S-method splices of the individual functions (§2.2).`,
      );
    }
    throw new Error(
      `${name}: top-level ${ts.SyntaxKind[s.kind]} at offset ${s.getStart(sf)} — the chunk has side effects beyond declarations, ` +
        `so replacing the file whole would drop behaviour. Fall back to S-method splices of the individual functions (§2.2).`,
    );
  }
  for (const spec of state.values()) {
    if (claimed.has(spec.as)) continue;
    throw new Error(
      `${name}: moduleState '${spec.as}' matched no constructing top-level declarator — the carve-out is stale. ` +
        `Either upstream stopped constructing it (drop the entry) or the derivation now resolves elsewhere (re-derive it).`,
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
  // The state declarations are resolved BEFORE the audit, from upstream's own
  // bytes, so the audit compares bindings rather than the row's prose.
  const state = new Map<string, ChunkStateSpec>();
  for (const spec of row.moduleState ?? []) {
    const binding = spec.derive(source); // throws when the shape moved
    if (state.has(binding)) throw new Error(`${row.name}: two moduleState entries derived the same binding '${binding}'`);
    state.set(binding, spec);
  }
  auditTopLevel(sf, row.name, state);

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
    state: [...state].map(([binding, spec]) => ({ as: spec.as, binding, construct: spec.construct, reproducedBy: spec.reproducedBy, why: spec.why })),
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
 *
 * Which direction this actually catches depends on the row's derivations, and
 * for today's two it is the OWNED side: their name derivations are anchored on
 * the value (nothing else identifies which minified binding is the tool name), so
 * upstream moving the value throws in `derive` before reaching this comparison.
 * See rule 5 in the header for why that is inherent rather than a gap.
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
