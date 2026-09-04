// §3.3 — snapshot the SHELL PARSER chunk from the pinned bundle.
//
//   npx tsx research/tools/extract-shell-parser.ts [--check]
//
// WHY A FIXTURE. The subject is a whole-chunk row: 62,907 bytes of hand-written
// recursive-descent bash tokenizer and parser, offered for whole-file
// replacement rather than for a splice of one function. A row like that carries
// a population claim in every field it states — how many declarations the file
// holds, how many of them construct at module init, which of its exports the
// rest of the graph actually reads and how often. Every population this campaign
// has carried as a hand-written number has been wrong at least once: the hook
// events, the control-protocol arms, the prompt sections, the helper belt, the
// moat-tool belt, the shutdown latch's importers. The fix was the same fix every
// time, and it is this: derive the population from the artifact, commit it under
// the pin, and let `--check` fail when it moves.
//
// So every number below is EXACT rather than a floor. The bundle is pinned, so
// an importer appearing or a declaration count shifting is a pin event that has
// to be read, not absorbed. Nothing here is a floor, and that is itself a
// finding: the scout's reader count was offered AS a floor — "4 named
// importers, until measured" — and measuring it is what turns it into a number
// `--check` can defend.
//
// NOTHING IS FOUND BY NAME. The chunk's own file name is content-addressed and
// churns per pin exactly as its minified bindings do (`hui`→`q6t`, `yzv`→`APn`
// inside a single bump), so neither is written down. The chunk is located by the
// conjunction of two SHAPES at its top level — a `new Set` of the bash reserved
// words, and an exported `Symbol(...)` declarator — and each of its seven
// exports is then derived by what it IS and reported under a ROLE:
//
//   getParser             a zero-parameter function whose whole body returns a
//                         module-scope object literal with the single property
//                         `parse` — the memoized parser handle.
//   shellKeywords         the `new Set` whose elements carry the bash reserved
//                         words. String literals are what every anchor in this
//                         campaign already bets on; identifiers are not.
//   parseCommandWithEnv   the async function returning an object literal whose
//                         keys are exactly `rootNode`, `envVars`, `commandNode`
//                         and `originalCommand`.
//   parseAborted          the declarator initialized with `Symbol(...)` — the
//                         sentinel a caller compares against rather than calls.
//   parseOrAbort          the async function that calls the chunk's ONE imported
//                         binding; the telemetry event name is then read off the
//                         call rather than assumed.
//   findCommandNode       the self-recursive walker that returns its own first
//                         parameter when that node's type is a member of the
//                         module-scope command-node set.
//   commandArgv           the function that reads the word-token set (the one
//                         carrying `raw_string`) — the argv extractor.
//
// The derivation then CLOSES: the seven bindings found by shape must be exactly
// the seven names in the export clause, or the tool throws. That is the check
// that keeps six good derivations and one lucky one from passing as seven.
//
// WHAT A LITERAL GREP WOULD HAVE ANSWERED INSTEAD. The scout commissioning this
// row put the reader population at "4 named importers" and called it a floor
// until measured. Measured, it is exactly four — but the four are not four
// readers, and the difference is the whole reason this section exists:
//
//   * 294 further modules carry a BARE side-effect import of the same file for
//     bun's evaluation ordering. `grep -l` counts them; nothing reads through
//     them. Both halves are recorded, because the two numbers answer different
//     questions and only one of them is "who reads the parser".
//   * One of the four named importers reads NOTHING. It is a re-export barrel:
//     it imports five roles and forwards them under their pre-minification
//     public names, and its own consumer reaches it through a DYNAMIC import.
//     A tool that counted only static named imports would report that consumer
//     as a non-reader while it calls the parser once per turn.
//
// So the reader population is measured on both paths — the direct named imports,
// and the barrel's aliases as they are destructured out of `await import(...)`
// inside their enclosing function scope. The barrel's aliases are also kept as
// CORROBORATION and never as derivation: the bundle re-exports five of these
// seven roles under names a human chose, and those names agree with the shapes
// derived above without having been used to find them.
//
// CALL SITES ARE NOT THE WHOLE READ. Three of the seven roles are not functions
// — a Set, a Symbol sentinel and a memoized handle — so a call count alone
// reports zero for a role that is read on every parse. Each importer therefore
// carries both its call sites and its value REFERENCES, and re-exports are
// counted as neither: forwarding a binding is not reading it.
//
// CONSTRUCTING DECLARATORS ARE CLAIMED, NOT COUNTED. `strangle/chunk.ts` refuses
// a whole-file replacement over any top-level declarator whose initializer is
// not inert, because replacing the file drops whatever the initializer did —
// unless the row DECLARES it as `moduleState` that the owned module re-declares
// with the same one-per-process identity. This chunk has nine such declarators:
// eight `new Set` literals and one `Symbol`. The fixture lists each with the
// construct kind the build's audit will name, so the row's declaration can be
// written against a measurement instead of against a reading of the file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { ENGINE_VERSION } from "../../src/pin.js";
import { anchorFor, bundle, gramBound, occurrences, MIN_ANCHOR } from "./anchor-enum.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `shell-parser-${version}.json`);

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The bundler's own specifier prefix — how one chunk names another. */
const BUNFS = "/$bunfs/root/";

/**
 * The whole-chunk row's anchor, as the manifest states it — verified here rather
 * than trusted. `resolveAnchor` requires a true substring that occurs exactly
 * once across the graph; this tool re-counts it and refuses to write a fixture
 * that would let a stale anchor look measured.
 */
const ROW_ANCHOR = "backtick_escape_unsupported";

/**
 * The bash reserved words this chunk's keyword set must carry, as a KERNEL
 * rather than as the full list.
 *
 * A full list would make the fixture assert upstream's exact vocabulary and
 * redden on a pin that adds one — which is a change worth seeing in the recorded
 * `members`, not a reason for the derivation to stop finding the set. The kernel
 * is the subset no bash keyword set can omit, and it separates this declarator
 * from the chunk's seven other `new Set`s (assignment-prefix words, node types,
 * substitution types) without naming any of them.
 */
const RESERVED_KERNEL = ["if", "then", "else", "fi", "while", "do", "done", "case", "esac"];

/** The four keys the env-carrying parse entry point returns, as a set — order is recorded, not required. */
const ENV_PARSE_KEYS = ["rootNode", "envVars", "commandNode", "originalCommand"];

/** The role names, in the order a reader of the fixture meets them. */
const ROLE_ORDER = [
  "getParser",
  "shellKeywords",
  "parseCommandWithEnv",
  "parseAborted",
  "parseOrAbort",
  "findCommandNode",
  "commandArgv",
] as const;
type Role = (typeof ROLE_ORDER)[number];

/**
 * A statement's kind, named the way a reader of the fixture expects.
 * `ts.SyntaxKind[…]` reverse-maps `VariableStatement` to its alias
 * `FirstStatement`, which is true and useless in a committed artifact.
 */
const statementKind = (s: ts.Statement): string =>
  ts.isVariableStatement(s) ? "VariableStatement" : ts.isExpressionStatement(s) ? "ExpressionStatement" : ts.SyntaxKind[s.kind];

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------

interface Module {
  file: string;
  text: string;
  sf: ts.SourceFile;
}

let MODULES: Module[] | null = null;
function modules(): Module[] {
  if (MODULES === null) {
    MODULES = bundle().map(({ file, text }) => ({
      file,
      text,
      sf: ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS),
    }));
  }
  return MODULES;
}

/** Every import declaration of `m`, as `{ specifier, bindings }` — bare imports bind nothing. */
function importsOf(m: Module): { specifier: string; bindings: Map<string, string> }[] {
  const out: { specifier: string; bindings: Map<string, string> }[] = [];
  for (const s of m.sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const bindings = new Map<string, string>();
    const c = s.importClause;
    if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) {
      for (const el of c.namedBindings.elements) bindings.set((el.propertyName ?? el.name).text, el.name.text);
    }
    out.push({ specifier: s.moduleSpecifier.text, bindings });
  }
  return out;
}

/**
 * Does `m` declare its own top-level `local`? A module that both imports a name
 * and declares it would blend two bindings into one count, and the blend is
 * invisible in the number that comes out.
 *
 * The hazard is live at this chunk and is dodged by exactly one fact. The
 * largest reader in the graph declares its own `function z_n` while importing
 * six of this chunk's seven roles — and the keyword set, which upstream also
 * calls `z_n`, is the one role it does NOT import. So nothing here is wrong at
 * this pin, and a pin that made it import the seventh would throw rather than
 * quietly report a keyword-set reader with forty call sites.
 */
function declaresOwn(m: Module, local: string): boolean {
  for (const s of m.sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === local) return true;
    if (ts.isClassDeclaration(s) && s.name?.text === local) return true;
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === local) return true;
      }
    }
  }
  return false;
}

/** How many times `scope` CALLS `local` as a bare identifier callee. */
function callSitesIn(scope: ts.Node, local: string): number {
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === local) n++;
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return n;
}

/**
 * How many times `scope` READS `local` as a value.
 *
 * Property NAMES (`x.local`), object-literal keys and the specifier positions of
 * import and export clauses are excluded: none of them is a read of the binding.
 * The export-specifier exclusion is the load-bearing one — a barrel that
 * forwards a binding under a public alias would otherwise be counted as its
 * busiest reader while calling nothing at all.
 */
function referencesIn(scope: ts.Node, local: string): number {
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === local) {
      const p = node.parent;
      const isName =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node) ||
        (ts.isBindingElement(p) && p.propertyName === node) ||
        ts.isImportSpecifier(p) ||
        ts.isExportSpecifier(p);
      if (!isName) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return n;
}

/** The nearest enclosing named declaration — who holds the binding this measurement is scoped to. */
function enclosingName(n: ts.Node): string {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  }
  return "<top level>";
}

/** The nearest enclosing function-like body — the scope a `let` destructuring is visible in. */
function enclosingScope(n: ts.Node, sf: ts.SourceFile): ts.Node {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)) return p;
  }
  return sf;
}

// ---------------------------------------------------------------------------
// the chunk, by shape
// ---------------------------------------------------------------------------

/** A top-level declarator, flattened out of its `var` list. */
interface Declarator {
  name: string;
  node: ts.VariableDeclaration;
}

const declaratorsOf = (sf: ts.SourceFile): Declarator[] => {
  const out: Declarator[] = [];
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push({ name: d.name.text, node: d });
  }
  return out;
};

const functionsOf = (sf: ts.SourceFile): ts.FunctionDeclaration[] =>
  sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name !== undefined);

/** `new Set([...string literals])` declarators, with the elements they carry. */
function setDeclarators(sf: ts.SourceFile): { name: string; node: ts.VariableDeclaration; members: string[] }[] {
  const out: { name: string; node: ts.VariableDeclaration; members: string[] }[] = [];
  for (const d of declaratorsOf(sf)) {
    const init = d.node.initializer;
    if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "Set") continue;
    const arg = init.arguments?.[0];
    if (arg === undefined || !ts.isArrayLiteralExpression(arg)) continue;
    if (!arg.elements.every(ts.isStringLiteral)) continue;
    out.push({ name: d.name, node: d.node, members: arg.elements.map((e) => (e as ts.StringLiteral).text) });
  }
  return out;
}

/** Declarators initialized with `Symbol(<description>)`. */
function symbolDeclarators(sf: ts.SourceFile): { name: string; node: ts.VariableDeclaration; description: string }[] {
  const out: { name: string; node: ts.VariableDeclaration; description: string }[] = [];
  for (const d of declaratorsOf(sf)) {
    const init = d.node.initializer;
    if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "Symbol") continue;
    const arg = init.arguments[0];
    out.push({ name: d.name, node: d.node, description: arg !== undefined && ts.isStringLiteral(arg) ? arg.text : "<computed>" });
  }
  return out;
}

/** The chunk's ONE export clause, as `{ local, exported }` in declaration order. */
function exportClause(m: Module): { local: string; exported: string }[] {
  const clauses = m.sf.statements.filter(ts.isExportDeclaration);
  if (clauses.length !== 1) throw new Error(`${m.file}: ${clauses.length} export declarations — expected exactly one clause`);
  const clause = clauses[0].exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) throw new Error(`${m.file}: the export declaration is not a named-exports clause`);
  return clause.elements.map((el) => ({ local: (el.propertyName ?? el.name).text, exported: el.name.text }));
}

/**
 * THE CHUNK, located by the conjunction of two top-level shapes and not by its
 * content-addressed file name: a `new Set` carrying the bash reserved words, and
 * an exported `Symbol(...)` declarator. Either alone is a weaker claim than the
 * pair — a graph this size can hold a second keyword table, and it holds many
 * symbols — and the pair occurs once in 1,802 modules.
 */
function locateChunk(): Module {
  const hits: Module[] = [];
  for (const m of modules()) {
    const sets = setDeclarators(m.sf);
    if (!sets.some((s) => RESERVED_KERNEL.every((w) => s.members.includes(w)))) continue;
    const symbols = symbolDeclarators(m.sf);
    if (symbols.length === 0) continue;
    const exported = new Set(m.sf.statements.filter(ts.isExportDeclaration).flatMap((e) =>
      e.exportClause && ts.isNamedExports(e.exportClause) ? e.exportClause.elements.map((el) => (el.propertyName ?? el.name).text) : [],
    ));
    if (!symbols.some((s) => exported.has(s.name))) continue;
    hits.push(m);
  }
  if (hits.length !== 1) {
    throw new Error(
      `the shell parser chunk is not unique by shape: ${hits.length} module(s) declare both a bash reserved-word Set and an exported Symbol ` +
        `(${hits.map((h) => h.file).join(", ") || "none"})`,
    );
  }
  return hits[0];
}

// ---------------------------------------------------------------------------
// the seven roles
// ---------------------------------------------------------------------------

export interface RoleFacts {
  role: Role;
  /** the minified name this role is exported under at this pin */
  binding: string;
  /** how the export clause spells it — identical here, recorded because an alias would be a real change */
  exportedAs: string;
  kind: "function" | "declarator";
  /** the byte span of the declaration a replacement has to reproduce */
  bytes: number;
  async: boolean;
  parameters: number;
  /** the measured evidence the shape derivation stood on */
  detail: Record<string, string | number | boolean | string[]>;
  /** the public name(s) the graph re-exports this role under — corroboration, never derivation */
  reexportedAs: string[];
}

/** The one thing the role table needs from the chunk before the roles are derived: its single import. */
export interface ImportFacts {
  declarations: number;
  specifier: string;
  imported: string;
  local: string;
  callSites: number;
  references: number;
}

function importFacts(m: Module): ImportFacts {
  const decls = m.sf.statements.filter(ts.isImportDeclaration);
  if (decls.length !== 1) {
    throw new Error(
      `${m.file}: ${decls.length} import declarations — the whole-chunk row's premise is that this parser has exactly ONE inbound edge, ` +
        `and a replacement that reproduces one import while upstream has ${decls.length} would be silently short a dependency`,
    );
  }
  const [only] = decls;
  if (!ts.isStringLiteral(only.moduleSpecifier)) throw new Error(`${m.file}: the import specifier is not a string literal`);
  const clause = only.importClause;
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.namedBindings.elements.length !== 1) {
    throw new Error(`${m.file}: the single import is not a one-binding named import — re-read it before trusting any count over it`);
  }
  const el = clause.namedBindings.elements[0];
  const local = el.name.text;
  return {
    declarations: decls.length,
    specifier: only.moduleSpecifier.text,
    imported: (el.propertyName ?? el.name).text,
    local,
    callSites: callSitesIn(m.sf, local),
    references: referencesIn(m.sf, local),
  };
}

function roleFacts(m: Module, imp: ImportFacts): RoleFacts[] {
  const sf = m.sf;
  const decls = declaratorsOf(sf);
  const fns = functionsOf(sf);
  const sets = setDeclarators(sf);
  const bytesOf = (n: ts.Node) => n.getEnd() - n.getStart(sf);
  const isAsync = (f: ts.FunctionDeclaration) => (ts.getModifiers(f) ?? []).some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);

  const one = <T>(what: string, xs: T[], render: (x: T) => string): T => {
    if (xs.length !== 1) throw new Error(`${m.file}: ${what} is not unique by shape — ${xs.length} match(es) (${xs.map(render).join(", ") || "none"})`);
    return xs[0];
  };

  // --- getParser: `function f(){ return <declarator whose initializer is {parse: …}> }`
  const parserHandles = decls.filter((d) => {
    const init = d.node.initializer;
    return (
      init !== undefined &&
      ts.isObjectLiteralExpression(init) &&
      init.properties.length === 1 &&
      ts.isPropertyAssignment(init.properties[0]) &&
      init.properties[0].name !== undefined &&
      ts.isIdentifier(init.properties[0].name!) &&
      (init.properties[0].name as ts.Identifier).text === "parse"
    );
  });
  const handle = one("the memoized parser handle", parserHandles, (d) => d.name);
  const handleImpl = ((init) => {
    const value = (init as ts.ObjectLiteralExpression).properties[0] as ts.PropertyAssignment;
    return ts.isIdentifier(value.initializer) ? value.initializer.text : value.initializer.getText(sf);
  })(handle.node.initializer!);
  const getters = fns.filter((f) => {
    if (f.parameters.length !== 0 || !f.body || f.body.statements.length !== 1) return false;
    const only = f.body.statements[0];
    return ts.isReturnStatement(only) && only.expression !== undefined && ts.isIdentifier(only.expression) && only.expression.text === handle.name;
  });
  const getParser = one("the parser accessor", getters, (f) => f.name!.text);

  // --- shellKeywords: the `new Set` carrying the reserved-word kernel
  const keywordSets = sets.filter((s) => RESERVED_KERNEL.every((w) => s.members.includes(w)));
  const shellKeywords = one("the bash keyword set", keywordSets, (s) => s.name);

  // --- parseCommandWithEnv: the async function returning the four-key object
  const envParsers = fns.filter((f) => {
    if (!isAsync(f) || !f.body) return false;
    let hit = false;
    const visit = (n: ts.Node): void => {
      if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
        const keys = n.expression.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : "<computed>"));
        if (keys.length === ENV_PARSE_KEYS.length && ENV_PARSE_KEYS.every((k) => keys.includes(k))) hit = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(f.body);
    return hit;
  });
  const parseCommandWithEnv = one("the env-carrying parse entry point", envParsers, (f) => f.name!.text);
  const envKeyOrder = (() => {
    let order: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
        const keys = n.expression.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : "<computed>"));
        if (keys.length === ENV_PARSE_KEYS.length && ENV_PARSE_KEYS.every((k) => keys.includes(k))) order = keys;
      }
      ts.forEachChild(n, visit);
    };
    visit(parseCommandWithEnv.body!);
    return order;
  })();

  // --- parseAborted: the one `Symbol(...)` declarator
  const parseAborted = one("the parse-aborted sentinel", symbolDeclarators(sf), (s) => s.name);

  // --- parseOrAbort: the async function that calls the chunk's single import
  const telemetryCallers = fns.filter((f) => isAsync(f) && f.body !== undefined && callSitesIn(f.body, imp.local) > 0);
  const parseOrAbort = one("the aborting parse entry point", telemetryCallers, (f) => f.name!.text);
  const telemetryEvents = new Set<string>();
  let telemetryCalls = 0;
  {
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === imp.local) {
        telemetryCalls++;
        const arg = n.arguments[0];
        telemetryEvents.add(arg !== undefined && ts.isStringLiteral(arg) ? arg.text : "<computed>");
      }
      ts.forEachChild(n, visit);
    };
    visit(parseOrAbort.body!);
  }
  if (telemetryEvents.size !== 1) {
    throw new Error(`${m.file}: the aborting parse entry point reports ${telemetryEvents.size} distinct telemetry events (${[...telemetryEvents].join(", ")}) — expected one`);
  }

  // --- findCommandNode: the self-recursive walker over the command-node set
  const commandSets = sets.filter((s) => s.members.includes("command"));
  const commandSet = one("the command-node type set", commandSets, (s) => s.name);
  const walkers = fns.filter((f) => {
    if (!f.body || f.parameters.length === 0) return false;
    const self = f.name!.text;
    const first = f.parameters[0].name;
    if (!ts.isIdentifier(first)) return false;
    let recurses = false;
    let readsSet = false;
    let returnsSubject = false;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === self) recurses = true;
      if (ts.isIdentifier(n) && n.text === commandSet.name && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) readsSet = true;
      if (ts.isReturnStatement(n) && n.expression && ts.isIdentifier(n.expression) && n.expression.text === first.text) returnsSubject = true;
      ts.forEachChild(n, visit);
    };
    visit(f.body);
    return recurses && readsSet && returnsSubject;
  });
  const findCommandNode = one("the command-node walker", walkers, (f) => f.name!.text);

  // --- commandArgv: the function that reads the word-token set
  const wordSets = sets.filter((s) => s.members.includes("raw_string"));
  const wordSet = one("the word-token type set", wordSets, (s) => s.name);
  const argvExtractors = fns.filter((f) => f.body !== undefined && referencesIn(f.body, wordSet.name) > 0);
  const commandArgv = one("the argv extractor", argvExtractors, (f) => f.name!.text);

  // --- the export clause has to be exactly these seven, or a derivation is lucky
  const derived: { role: Role; binding: string; node: ts.Node; kind: RoleFacts["kind"]; async: boolean; parameters: number; detail: RoleFacts["detail"] }[] = [
    {
      role: "getParser",
      binding: getParser.name!.text,
      node: getParser,
      kind: "function",
      async: isAsync(getParser),
      parameters: 0,
      detail: { returnsDeclarator: handle.name, properties: ["parse"], parseImplementation: handleImpl },
    },
    {
      role: "shellKeywords",
      binding: shellKeywords.name,
      node: shellKeywords.node,
      kind: "declarator",
      async: false,
      parameters: 0,
      detail: { members: shellKeywords.members, memberCount: shellKeywords.members.length },
    },
    {
      role: "parseCommandWithEnv",
      binding: parseCommandWithEnv.name!.text,
      node: parseCommandWithEnv,
      kind: "function",
      async: true,
      parameters: parseCommandWithEnv.parameters.length,
      detail: { returnKeys: envKeyOrder },
    },
    {
      role: "parseAborted",
      binding: parseAborted.name,
      node: parseAborted.node,
      kind: "declarator",
      async: false,
      parameters: 0,
      detail: { symbolDescription: parseAborted.description },
    },
    {
      role: "parseOrAbort",
      binding: parseOrAbort.name!.text,
      node: parseOrAbort,
      kind: "function",
      async: true,
      parameters: parseOrAbort.parameters.length,
      detail: { telemetryEvent: [...telemetryEvents][0], telemetryCalls, viaImport: imp.local },
    },
    {
      role: "findCommandNode",
      binding: findCommandNode.name!.text,
      node: findCommandNode,
      kind: "function",
      async: false,
      parameters: findCommandNode.parameters.length,
      detail: { commandNodeTypes: commandSet.members, viaSet: commandSet.name },
    },
    {
      role: "commandArgv",
      binding: commandArgv.name!.text,
      node: commandArgv,
      kind: "function",
      async: false,
      parameters: commandArgv.parameters.length,
      detail: { wordTokenTypes: wordSet.members, viaSet: wordSet.name },
    },
  ];

  const clause = exportClause(m);
  const exportedLocals = new Set(clause.map((e) => e.local));
  const derivedNames = new Set(derived.map((d) => d.binding));
  if (derivedNames.size !== derived.length) throw new Error(`${m.file}: two roles derived to the same binding (${[...derivedNames].join(", ")})`);
  const unexported = derived.filter((d) => !exportedLocals.has(d.binding));
  const underived = clause.filter((e) => !derivedNames.has(e.local));
  if (unexported.length > 0 || underived.length > 0) {
    throw new Error(
      `${m.file}: the seven derived roles are not the export clause. ` +
        `Derived but not exported: ${unexported.map((d) => `${d.role}=${d.binding}`).join(", ") || "none"}. ` +
        `Exported but underived: ${underived.map((e) => e.exported).join(", ") || "none"}.`,
    );
  }

  const aliases = reexportAliases(m, derived.map((d) => d.binding));
  return derived.map((d) => ({
    role: d.role,
    binding: d.binding,
    exportedAs: clause.find((e) => e.local === d.binding)!.exported,
    kind: d.kind,
    bytes: bytesOf(d.node),
    async: d.async,
    parameters: d.parameters,
    detail: d.detail,
    reexportedAs: (aliases.get(d.binding) ?? []).sort(),
  }));
}

/**
 * The public names the graph re-exports these bindings under.
 *
 * CORROBORATION, NOT DERIVATION. Export aliases survive this bundler's minifier
 * the same way property names do, so a barrel that writes `export{X as
 * parseCommand}` is upstream telling us what `X` was called before minification.
 * Reading it AFTER the shapes are derived is a free second opinion; reading it
 * first would be the naming shortcut this whole tool exists to avoid.
 */
function reexportAliases(chunk: Module, bindings: string[]): Map<string, string[]> {
  const wanted = new Set(bindings);
  const out = new Map<string, string[]>();
  const specifier = `${BUNFS}${chunk.file}`;
  for (const m of modules()) {
    if (m.file === chunk.file) continue;
    const imported = new Set<string>();
    for (const imp of importsOf(m)) {
      if (imp.specifier !== specifier) continue;
      for (const [name, local] of imp.bindings) if (wanted.has(name)) imported.add(local);
    }
    if (imported.size === 0) continue;
    for (const s of m.sf.statements) {
      if (!ts.isExportDeclaration(s) || !s.exportClause || !ts.isNamedExports(s.exportClause)) continue;
      for (const el of s.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text;
        if (!imported.has(local)) continue;
        const list = out.get(local) ?? [];
        if (!list.includes(el.name.text)) list.push(el.name.text);
        out.set(local, list);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// the chunk's own facts
// ---------------------------------------------------------------------------

export interface ParserFacts {
  chunk: string;
  /** the whole file, banner included — what a whole-chunk replacement replaces */
  bytes: number;
  bannerBytes: number;
  codeBytes: number;
  sha256: string;
  /** top-level statement kinds, in order — the whole-chunk cleanliness claim, measured */
  topLevel: string[];
  /** the export clause, in the order the chunk lists it */
  exportOrder: string[];
  counts: { statements: number; declarations: number; functions: number; declarators: number; imports: number; exports: number };
  /**
   * Bytes carried by top-level declarations, and their share of the code.
   *
   * The denominator is CODE bytes, not file bytes: the banner is byte-identical
   * in every chunk of the graph and counting it would make every chunk look
   * sparser than it is. The numerator sums function-declaration statements and
   * variable DECLARATORS, so the `var` keywords, the commas between declarators
   * and the statement terminators fall outside — which is why the density is
   * just under 1 for a file that is nothing but declarations.
   */
  declarationBytes: number;
  declarationDensity: number;
  /**
   * The declarators whose initializers are not INERT by the rule
   * `strangle/chunk.ts` applies at build time. Each has to be claimed by a
   * `moduleState` entry on the manifest row, or the build refuses the whole-file
   * replacement — replacing the file drops whatever the initializer did.
   */
  constructingDeclarators: { name: string; construct: string; bytes: number }[];
}

/**
 * Is this initializer INERT — evaluable at module init with no effect a
 * whole-file replacement would drop?
 *
 * This mirrors `inertInitializer` in `strangle/chunk.ts`, which is module-
 * private and owns the authoritative copy. The copy here is a read-only census
 * whose only job is to give the manifest row a complete list to declare; if the
 * two ever disagreed, the build's audit is what throws, so a divergence surfaces
 * as a refused splice rather than as a fixture nobody rechecked.
 */
function constructKind(n: ts.Node): string | null {
  if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return null; // the body is not evaluated at init
  if (
    ts.isCallExpression(n) ||
    ts.isNewExpression(n) ||
    ts.isAwaitExpression(n) ||
    ts.isYieldExpression(n) ||
    ts.isTaggedTemplateExpression(n) ||
    ts.isClassExpression(n) ||
    ts.isDeleteExpression(n) ||
    ts.isPostfixUnaryExpression(n) ||
    (ts.isPrefixUnaryExpression(n) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) ||
    (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
  ) {
    return ts.SyntaxKind[n.kind];
  }
  let found: string | null = null;
  ts.forEachChild(n, (c) => {
    found ??= constructKind(c);
  });
  return found;
}

function parserFacts(m: Module): ParserFacts {
  const st = m.sf.statements;
  const bannerBytes = st.length > 0 ? st[0].getStart(m.sf) : 0;
  const fns = functionsOf(m.sf);
  const decls = declaratorsOf(m.sf);
  const declarationBytes =
    fns.reduce((a, f) => a + (f.getEnd() - f.getStart(m.sf)), 0) + decls.reduce((a, d) => a + (d.node.getEnd() - d.node.getStart(m.sf)), 0);
  const codeBytes = m.text.length - bannerBytes;
  const constructing = decls
    .map((d) => ({ name: d.name, construct: d.node.initializer ? constructKind(d.node.initializer) : null, bytes: d.node.getEnd() - d.node.getStart(m.sf) }))
    .filter((x): x is { name: string; construct: string; bytes: number } => x.construct !== null);

  return {
    chunk: m.file,
    bytes: m.text.length,
    bannerBytes,
    codeBytes,
    sha256: sha256(m.text),
    topLevel: st.map(statementKind),
    exportOrder: exportClause(m).map((e) => e.exported),
    counts: {
      statements: st.length,
      declarations: fns.length + decls.length,
      functions: fns.length,
      declarators: decls.length,
      imports: st.filter(ts.isImportDeclaration).length,
      exports: st.filter(ts.isExportDeclaration).length,
    },
    declarationBytes,
    declarationDensity: Number((declarationBytes / codeBytes).toFixed(4)),
    constructingDeclarators: constructing,
  };
}

// ---------------------------------------------------------------------------
// the importers — both halves
// ---------------------------------------------------------------------------

export interface ImporterFacts {
  chunk: string;
  bytes: number;
  /** which ROLES this chunk imports, and the local name each landed under */
  imports: { role: Role; local: string }[];
  /** call sites per role, in this chunk */
  callSites: Partial<Record<Role, number>>;
  /** value reads per role — the measure that means anything for a Set or a Symbol */
  references: Partial<Record<Role, number>>;
  /** roles this chunk forwards rather than reads, and under what public name */
  reexports: { role: Role; as: string }[];
}

/**
 * A reader that a static named-import scan cannot see: the barrel's alias,
 * destructured out of `await import(...)` and called inside one function.
 */
export interface DynamicReaderFacts {
  chunk: string;
  /** the re-export barrel it goes through */
  via: string;
  alias: string;
  role: Role;
  /** the local the alias landed under — a one-letter minified name, hence the scope */
  local: string;
  /** the enclosing declaration the binding is visible in; the call count is scoped to it */
  scope: string;
  callSites: number;
}

export interface ReexportFacts {
  /** named importers that forward roles instead of reading them */
  barrels: { chunk: string; aliases: { role: Role; as: string }[]; staticNamedImporters: string[]; dynamicImporters: string[] }[];
  dynamicReaders: DynamicReaderFacts[];
  /** dynamic imports of a barrel the walk found but could not read — the denominator */
  skipped: { chunk: string; via: string; shape: string }[];
  callSiteTotals: Partial<Record<Role, number>>;
}

function importerFacts(chunk: Module, roles: RoleFacts[]): {
  named: ImporterFacts[];
  bare: string[];
  callSiteTotals: Record<Role, number>;
  referenceTotals: Record<Role, number>;
  readersPerRole: Record<Role, number>;
} {
  const roleOf = new Map<string, Role>(roles.map((r) => [r.binding, r.role]));
  const specifier = `${BUNFS}${chunk.file}`;
  const named: ImporterFacts[] = [];
  const bare: string[] = [];
  const zero = () => Object.fromEntries(ROLE_ORDER.map((r) => [r, 0])) as Record<Role, number>;
  const callSiteTotals = zero();
  const referenceTotals = zero();
  const readersPerRole = zero();

  for (const m of modules()) {
    if (m.file === chunk.file) continue;
    let sawNamed = false;
    let sawBare = false;
    const entry: ImporterFacts = { chunk: m.file, bytes: m.text.length, imports: [], callSites: {}, references: {}, reexports: [] };
    for (const imp of importsOf(m)) {
      if (imp.specifier !== specifier) continue;
      if (imp.bindings.size === 0) {
        sawBare = true;
        continue;
      }
      sawNamed = true;
      for (const [imported, local] of imp.bindings) {
        const role = roleOf.get(imported);
        if (role === undefined) throw new Error(`${m.file}: imports '${imported}' from the parser chunk, which is not one of its seven derived roles`);
        if (declaresOwn(m, local)) {
          throw new Error(`${m.file}: declares its own '${local}' while importing one — every count over it would blend two bindings`);
        }
        const calls = callSitesIn(m.sf, local);
        const refs = referencesIn(m.sf, local);
        entry.imports.push({ role, local });
        entry.callSites[role] = calls;
        entry.references[role] = refs;
        callSiteTotals[role] += calls;
        referenceTotals[role] += refs;
        readersPerRole[role]++;
      }
    }
    if (sawNamed) {
      const localOf = new Map(entry.imports.map((i) => [i.local, i.role]));
      for (const s of m.sf.statements) {
        if (!ts.isExportDeclaration(s) || !s.exportClause || !ts.isNamedExports(s.exportClause)) continue;
        for (const el of s.exportClause.elements) {
          const role = localOf.get((el.propertyName ?? el.name).text);
          if (role !== undefined) entry.reexports.push({ role, as: el.name.text });
        }
      }
      entry.imports.sort((a, b) => a.role.localeCompare(b.role));
      entry.reexports.sort((a, b) => a.role.localeCompare(b.role));
      named.push(entry);
    } else if (sawBare) {
      bare.push(m.file);
    }
  }
  named.sort((a, b) => a.chunk.localeCompare(b.chunk));
  bare.sort();
  return { named, bare, callSiteTotals, referenceTotals, readersPerRole };
}

/**
 * THE INDIRECT HALF: who reaches a role through a re-export barrel.
 *
 * A barrel is a named importer whose whole contribution is to forward. Its own
 * consumers are invisible to a scan of imports of the parser chunk, and at this
 * pin the only one reaches it through `await import(...)` — so the role it calls
 * would be reported as unread by anything that counted static edges alone.
 *
 * The measurement is scoped deliberately. A destructured alias lands in a
 * one-letter minified local inside one function body; counting that local across
 * a four-megabyte module would count every unrelated `t` in it. So the call
 * count is taken over the enclosing function, which is exactly where a `let`
 * destructuring is visible. Dynamic imports whose result is used in a shape this
 * walk cannot read are recorded as skipped rather than dropped, so the population
 * keeps its denominator.
 */
function reexportFacts(named: ImporterFacts[]): ReexportFacts {
  const barrels = named.filter((n) => n.reexports.length > 0);
  const dynamicReaders: DynamicReaderFacts[] = [];
  const skipped: { chunk: string; via: string; shape: string }[] = [];
  const callSiteTotals: Partial<Record<Role, number>> = {};
  const out: ReexportFacts["barrels"] = [];

  for (const barrel of barrels) {
    const specifier = `${BUNFS}${barrel.chunk}`;
    const roleOfAlias = new Map(barrel.reexports.map((r) => [r.as, r.role]));
    const staticNamed: string[] = [];
    const dynamic = new Set<string>();

    for (const m of modules()) {
      if (m.file === barrel.chunk) continue;
      for (const imp of importsOf(m)) {
        if (imp.specifier === specifier && imp.bindings.size > 0) staticNamed.push(m.file);
      }
      if (!m.text.includes(specifier)) continue;
      const visit = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          n.expression.kind === ts.SyntaxKind.ImportKeyword &&
          n.arguments.length >= 1 &&
          ts.isStringLiteral(n.arguments[0]) &&
          (n.arguments[0] as ts.StringLiteral).text === specifier
        ) {
          dynamic.add(m.file);
          // `let {alias: local} = await import(spec)` — the destructuring form
          const awaited = ts.isAwaitExpression(n.parent) ? n.parent : null;
          const declared = awaited !== null && ts.isVariableDeclaration(awaited.parent) && awaited.parent.initializer === awaited ? awaited.parent : null;
          if (declared !== null && ts.isObjectBindingPattern(declared.name)) {
            const scopeNode = enclosingScope(declared, m.sf);
            for (const el of declared.name.elements) {
              const alias = (el.propertyName ?? el.name).getText(m.sf);
              const role = roleOfAlias.get(alias);
              if (role === undefined || !ts.isIdentifier(el.name)) continue;
              const local = el.name.text;
              const calls = callSitesIn(scopeNode, local);
              dynamicReaders.push({ chunk: m.file, via: barrel.chunk, alias, role, local, scope: enclosingName(declared), callSites: calls });
              callSiteTotals[role] = (callSiteTotals[role] ?? 0) + calls;
            }
          } else if (awaited !== null && ts.isPropertyAccessExpression(awaited.parent)) {
            // `(await import(spec)).alias(...)` — the direct-read form
            const alias = awaited.parent.name.text;
            const role = roleOfAlias.get(alias);
            if (role !== undefined) {
              const calls = ts.isCallExpression(awaited.parent.parent) && awaited.parent.parent.expression === awaited.parent ? 1 : 0;
              dynamicReaders.push({ chunk: m.file, via: barrel.chunk, alias, role, local: `<namespace>.${alias}`, scope: enclosingName(awaited), callSites: calls });
              callSiteTotals[role] = (callSiteTotals[role] ?? 0) + calls;
            }
          } else {
            skipped.push({
              chunk: m.file,
              via: barrel.chunk,
              shape: awaited === null ? `import() not awaited in place (parent ${ts.SyntaxKind[n.parent.kind]})` : `awaited into a ${ts.SyntaxKind[awaited.parent.kind]}`,
            });
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(m.sf);
    }
    out.push({
      chunk: barrel.chunk,
      aliases: barrel.reexports,
      staticNamedImporters: [...new Set(staticNamed)].sort(),
      dynamicImporters: [...dynamic].sort(),
    });
  }

  dynamicReaders.sort((a, b) => a.chunk.localeCompare(b.chunk) || a.alias.localeCompare(b.alias));
  skipped.sort((a, b) => a.chunk.localeCompare(b.chunk) || a.via.localeCompare(b.via));
  return { barrels: out, dynamicReaders, skipped, callSiteTotals };
}

// ---------------------------------------------------------------------------
// the anchor
// ---------------------------------------------------------------------------

export interface AnchorFacts {
  /** the literal the whole-chunk row anchors on */
  literal: string;
  occurrences: number;
  files: number;
  unique: boolean;
  /** every other literal in this chunk that is also 1-of-1 graph-wide */
  otherUniqueLiterals: string[];
  counts: { otherUniqueLiterals: number; literalsConsidered: number };
  /**
   * What `anchor-enum.ts` picks when the doctrine's own rule runs over the whole
   * chunk, and how many untainted runs it had to choose from. It is shorter than
   * the row's literal and just as unique; the row prefers the literal because a
   * human reading the manifest can tell what it names. Recording both is what
   * makes that a choice rather than an oversight.
   */
  shortestUntainted: { literal: string; occurrences: number; files: number; candidates: number } | null;
}

function anchorFacts(m: Module): AnchorFacts {
  const files = bundle().filter((b) => b.text.includes(ROW_ANCHOR)).length;
  const count = occurrences(ROW_ANCHOR, 8);
  if (count !== 1 || files !== 1) {
    throw new Error(
      `the whole-chunk row's anchor ${JSON.stringify(ROW_ANCHOR)} occurs ${count} time(s) in ${files} file(s) — ` +
        `an anchor that is not 1-of-1 does not resolve, and a row carrying it would splice the wrong bytes or none`,
    );
  }

  // The population the anchor was chosen FROM: every literal in the chunk long
  // enough to be an anchor at all, counted graph-wide.
  const literals = new Set<string>();
  const visit = (n: ts.Node): void => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.length >= MIN_ANCHOR) literals.add(n.text);
    ts.forEachChild(n, visit);
  };
  visit(m.sf);
  const unique = [...literals].filter((l) => (gramBound(l) === 1 || occurrences(l) === 1) && l !== ROW_ANCHOR).sort();

  const measured = anchorFor(m.sf, m.sf, m.text);
  return {
    literal: ROW_ANCHOR,
    occurrences: count,
    files,
    unique: true,
    otherUniqueLiterals: unique,
    counts: { otherUniqueLiterals: unique.length, literalsConsidered: literals.size },
    shortestUntainted: measured.anchor ? { ...measured.anchor, candidates: measured.candidates } : null,
  };
}

// ---------------------------------------------------------------------------
// the fixture
// ---------------------------------------------------------------------------

export interface ShellParserFixture {
  engineVersion: string;
  generatedBy: string;
  parser: ParserFacts;
  roles: RoleFacts[];
  import: ImportFacts;
  importers: {
    /** chunks with a NAMED import of the parser — the ones that could read it */
    named: ImporterFacts[];
    /** chunks with only a BARE side-effect import — evaluation order, not a read */
    bareCount: number;
    counts: { named: number; bare: number; graphModules: number };
    callSiteTotals: Record<Role, number>;
    referenceTotals: Record<Role, number>;
    /** how many named importers import each role */
    readersPerRole: Record<Role, number>;
    /** the readers a static scan cannot see */
    reexport: ReexportFacts;
  };
  anchor: AnchorFacts;
}

export function extract(): ShellParserFixture {
  const chunk = locateChunk();
  const imp = importFacts(chunk);
  const roles = roleFacts(chunk, imp);
  const importers = importerFacts(chunk, roles);
  return {
    engineVersion: ENGINE_VERSION,
    generatedBy: "research/tools/extract-shell-parser.ts",
    parser: parserFacts(chunk),
    roles,
    import: imp,
    importers: {
      named: importers.named,
      bareCount: importers.bare.length,
      counts: { named: importers.named.length, bare: importers.bare.length, graphModules: modules().length },
      callSiteTotals: importers.callSiteTotals,
      referenceTotals: importers.referenceTotals,
      readersPerRole: importers.readersPerRole,
      reexport: reexportFacts(importers.named),
    },
    anchor: anchorFacts(chunk),
  };
}

/** The whole committed fixture, for callers that need the spans. */
export function readFixture(version = ENGINE_VERSION): ShellParserFixture {
  return JSON.parse(readFileSync(fixturePath(version), "utf8")) as ShellParserFixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const text = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  console.log(
    `  parser: ${fx.parser.chunk} ${fx.parser.bytes} B (${fx.parser.codeBytes} B of code), ` +
      `${fx.parser.counts.statements} top-level statements = ${fx.parser.counts.declarations} declarations ` +
      `(${fx.parser.counts.functions} functions, ${fx.parser.counts.declarators} declarators), density ${fx.parser.declarationDensity}`,
  );
  console.log(
    `  constructing declarators: ${fx.parser.constructingDeclarators.length} to claim as moduleState ` +
      `(${fx.parser.constructingDeclarators.map((c) => `${c.name}:${c.construct}`).join(", ")})`,
  );
  console.log(`  import: ${fx.import.local} from ${fx.import.specifier}, called ${fx.import.callSites}x`);
  for (const r of fx.roles) {
    console.log(
      `    ${r.role.padEnd(20)} ${r.binding.padEnd(5)} ${String(r.bytes).padStart(5)} B  ${r.kind}${r.async ? " async" : ""}` +
        `${r.reexportedAs.length > 0 ? `  re-exported as ${r.reexportedAs.join(", ")}` : ""}`,
    );
  }
  console.log(
    `  importers: ${fx.importers.counts.named} named, ${fx.importers.counts.bare} bare (of ${fx.importers.counts.graphModules} modules)`,
  );
  console.log(`    call sites  ${ROLE_ORDER.map((r) => `${r}=${fx.importers.callSiteTotals[r]}`).join(" ")}`);
  console.log(`    references  ${ROLE_ORDER.map((r) => `${r}=${fx.importers.referenceTotals[r]}`).join(" ")}`);
  console.log(`    readers     ${ROLE_ORDER.map((r) => `${r}=${fx.importers.readersPerRole[r]}`).join(" ")}`);
  for (const n of fx.importers.named) {
    console.log(
      `    ${n.chunk} ${String(n.bytes).padStart(8)} B: ${n.imports.map((i) => `${i.role}=${n.callSites[i.role]}c/${n.references[i.role]}r`).join(" ")}` +
        `${n.reexports.length > 0 ? `  [forwards ${n.reexports.map((r) => r.as).join(", ")}]` : ""}`,
    );
  }
  for (const d of fx.importers.reexport.dynamicReaders) {
    console.log(`    ${d.chunk} reaches ${d.role} as ${d.alias} through ${d.via} in ${d.scope}(): ${d.callSites} call site(s)`);
  }
  if (fx.importers.reexport.skipped.length > 0) {
    console.log(`    ${fx.importers.reexport.skipped.length} dynamic import(s) of a barrel in a shape this walk could not read`);
  }
  console.log(
    `  anchor: ${JSON.stringify(fx.anchor.literal)} x${fx.anchor.occurrences} in ${fx.anchor.files} file(s) — UNIQUE; ` +
      `${fx.anchor.counts.otherUniqueLiterals} other 1-of-1 literal(s) of ${fx.anchor.counts.literalsConsidered} considered` +
      `${fx.anchor.shortestUntainted ? `; shortest untainted window ${JSON.stringify(fx.anchor.shortestUntainted.literal)}` : ""}`,
  );

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== text) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-shell-parser.ts`);
      process.exit(1);
    }
    console.log("PASS — committed fixture matches the pinned bundle");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
