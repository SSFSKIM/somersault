// §3.3 — snapshot the PROCESS LIFECYCLE surface from the pinned bundle.
//
//   npx tsx research/tools/extract-process-lifecycle.ts [--check]
//
// WHY A FIXTURE. C16b's whole claim is a population: "the shutdown latch is 780
// bytes with ten importers and three exports, plus a coordinator of 44 members".
// Every prior wave that carried a population as a hand-written number was wrong
// about it — the hook events, the control-protocol arms, the prompt sections,
// the helper belt, the moat-tool belt: five for five. The number that started
// this child is already one of those. The scout wrote "10 importers"; a literal
// `grep -l` over the graph says 313, because 303 chunks carry a BARE
// side-effect import of the same file for bun's evaluation ordering. Both
// numbers are true of different questions, and only one of them is the question
// "who reads the latch". A fixture is how the difference stops being a matter of
// which command someone happened to run.
//
// So this tool derives the whole surface from the artifact and commits it under
// the pin. `--check` regenerates in memory and fails on any difference, which
// makes every count here EXACT rather than a floor: the bundle is pinned, so an
// importer appearing or disappearing is a pin event and must be read, not
// absorbed.
//
// NOTHING IS FOUND BY NAME. Every binding this file reports is minified and
// churns per pin (`hui`→`q6t`, `yzv`→`APn` inside a single bump), so each is
// located by SHAPE and reported under a ROLE:
//
//   the latch chunk      the one text module whose top level is exactly: a class
//                        with the single field `committed = false`, an instance
//                        of it, a reader of that field, a setter of that field,
//                        a promise constructed with an empty executor (so it can
//                        never settle), a reader of that promise, and one local
//                        export clause. That shape occurs once in 1,802 modules.
//   the coordinator      the one class in the graph declaring BOTH a
//                        `claimShutdown` and a `releaseShutdownClaim` method.
//                        Method names survive this bundler's minifier, which is
//                        the same bet every anchor in the campaign already makes.
//   the facade           the free functions in the coordinator's own chunk whose
//                        entire body forwards to one of its members through a
//                        single accessor call — `function X(){ acc().member() }`.
//                        Derived, not listed: the accessor is whichever callee
//                        every such body shares.
//   the signal handlers  every `process.on("SIG…", handler)` in the graph whose
//                        handler body carries upstream's own `shutdown_signal`
//                        telemetry literal.
//
// EXCISABILITY IS MEASURED HERE, NOT ASSERTED IN PROSE. For each signal handler
// the tool records its free identifiers and, of those, the ones its body ASSIGNS
// to. A splice forwards captures by value, so a body that writes back to a
// captured binding cannot be delegated — that is a mechanical property of the
// transform, and recording it as a measurement is what keeps the OPEN verdict in
// C16b's ledger row from being someone's recollection.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { ENGINE_VERSION } from "../../src/pin.js";
import { freeIdentifiers } from "../../strangle/scope.js";
import { anchorFor, bundle } from "./anchor-enum.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `process-lifecycle-${version}.json`);

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The bundler's own specifier prefix — how one chunk names another. */
const BUNFS = "/$bunfs/root/";

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
 * How many times `m` CALLS the binding `local`, with the shadowing question
 * answered rather than assumed.
 *
 * The one collision in this graph is real and would have been invisible: the
 * headless-dispatch chunk declares its own `function pm` while importing the
 * latch's reader and setter — a different `pm` entirely. It does not import the
 * latch's `pm`, so no count here is wrong, but a pin that made it do so would
 * silently blend two bindings into one number. So a local declaration of the
 * same name THROWS instead of being counted around.
 */
function callSites(m: Module, local: string): number {
  for (const s of m.sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === local) {
      throw new Error(`${m.file}: declares its own '${local}' while importing one — the call count would blend two bindings`);
    }
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === local) {
          throw new Error(`${m.file}: declares its own '${local}' while importing one — the call count would blend two bindings`);
        }
      }
    }
  }
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === local) n++;
    ts.forEachChild(node, visit);
  };
  visit(m.sf);
  return n;
}

// ---------------------------------------------------------------------------
// the latch chunk
// ---------------------------------------------------------------------------

export interface LatchFacts {
  chunk: string;
  /** the whole file, banner included — what an S-chunk replacement replaces */
  bytes: number;
  bannerBytes: number;
  codeBytes: number;
  sha256: string;
  /** minified names, reported under the role each was derived by */
  roles: {
    latchClass: string;
    latchInstance: string;
    hangPromise: string;
    isShuttingDown: string;
    commitShutdown: string;
    hang: string;
  };
  /** the export clause, in the order the chunk lists it */
  exportOrder: string[];
  /** top-level statement kinds, in order — the S-chunk cleanliness claim, measured */
  topLevel: string[];
  /**
   * The declarators whose initializers CONSTRUCT. `strangle/chunk.ts` refuses a
   * whole-file replacement over any of them by default, because replacing the
   * file drops whatever the construction did; this chunk's entire content IS
   * those two constructions, so the manifest row declares them and the build
   * checks the declaration against this same shape.
   */
  constructingDeclarators: { name: string; construct: string }[];
  /** the shortest unique untainted window, by anchor-enum's mechanical rule */
  anchor: { literal: string; files: number; occurrences: number; candidates: number } | null;
}

function latchFacts(): { facts: LatchFacts; module: Module; specifier: string } {
  const found: { m: Module; facts: LatchFacts }[] = [];

  for (const m of modules()) {
    const st = m.sf.statements;
    const cls = st.find(
      (s): s is ts.ClassDeclaration =>
        ts.isClassDeclaration(s) &&
        s.members.length === 1 &&
        ts.isPropertyDeclaration(s.members[0]) &&
        ts.isIdentifier(s.members[0].name!) &&
        (s.members[0].name as ts.Identifier).text === "committed" &&
        (s.members[0] as ts.PropertyDeclaration).initializer?.getText(m.sf) === "!1",
    );
    if (!cls?.name) continue;

    // the instance: `var e = new <cls>`
    let instance: string | null = null;
    let hangPromise: string | null = null;
    for (const s of st) {
      if (!ts.isVariableStatement(s)) continue;
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isNewExpression(d.initializer)) continue;
        const ctor = d.initializer.expression;
        if (ts.isIdentifier(ctor) && ctor.text === cls.name.text) instance = d.name.text;
        // the never-settling promise: `new Promise(()=>{})` — an executor that
        // neither resolves nor rejects, which is the whole of `hang()`
        if (
          ts.isIdentifier(ctor) &&
          ctor.text === "Promise" &&
          d.initializer.arguments?.length === 1 &&
          ts.isArrowFunction(d.initializer.arguments[0]) &&
          (d.initializer.arguments[0] as ts.ArrowFunction).parameters.length === 0 &&
          ts.isBlock((d.initializer.arguments[0] as ts.ArrowFunction).body) &&
          ((d.initializer.arguments[0] as ts.ArrowFunction).body as ts.Block).statements.length === 0
        ) {
          hangPromise = d.name.text;
        }
      }
    }
    if (instance === null || hangPromise === null) continue;

    // the three functions, each derived by what its single statement DOES
    let reader: string | null = null;
    let committer: string | null = null;
    let hang: string | null = null;
    for (const s of st) {
      if (!ts.isFunctionDeclaration(s) || !s.name || s.parameters.length !== 0 || !s.body || s.body.statements.length !== 1) continue;
      const only = s.body.statements[0];
      if (ts.isReturnStatement(only) && only.expression) {
        const e = only.expression;
        if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === instance && e.name.text === "committed") reader = s.name.text;
        if (ts.isIdentifier(e) && e.text === hangPromise) hang = s.name.text;
      }
      if (ts.isExpressionStatement(only) && ts.isBinaryExpression(only.expression) && only.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const lhs = only.expression.left;
        if (
          ts.isPropertyAccessExpression(lhs) &&
          ts.isIdentifier(lhs.expression) &&
          lhs.expression.text === instance &&
          lhs.name.text === "committed" &&
          only.expression.right.getText(m.sf) === "!0"
        ) {
          committer = s.name.text;
        }
      }
    }
    if (reader === null || committer === null || hang === null) continue;

    const clause = st.filter(ts.isExportDeclaration);
    if (clause.length !== 1 || !clause[0].exportClause || !ts.isNamedExports(clause[0].exportClause)) continue;
    const exportOrder = clause[0].exportClause.elements.map((el) => el.name.text);

    const bannerBytes = st.length > 0 ? st[0].getStart(m.sf) : 0;
    const constructing: { name: string; construct: string }[] = [];
    for (const s of st) {
      if (!ts.isVariableStatement(s)) continue;
      for (const d of s.declarationList.declarations) {
        if (d.initializer && ts.isNewExpression(d.initializer) && ts.isIdentifier(d.name)) {
          constructing.push({ name: d.name.text, construct: ts.SyntaxKind[d.initializer.kind] });
        }
      }
    }

    // The anchor names the CHUNK, so it is enumerated over the whole source
    // file. `SourceFile.getStart()` skips leading trivia, which is exactly the
    // banner — and the banner is byte-identical in every chunk of the graph, so
    // an anchor taken from it would name all 1,802.
    const measured = anchorFor(m.sf, m.sf, m.text);

    found.push({
      m,
      facts: {
        chunk: m.file,
        bytes: m.text.length,
        bannerBytes,
        codeBytes: m.text.length - bannerBytes,
        sha256: sha256(m.text),
        roles: { latchClass: cls.name.text, latchInstance: instance, hangPromise, isShuttingDown: reader, commitShutdown: committer, hang },
        exportOrder,
        topLevel: st.map(statementKind),
        constructingDeclarators: constructing,
        anchor: measured.anchor ? { ...measured.anchor, candidates: measured.candidates } : null,
      },
    });
  }

  if (found.length !== 1) {
    throw new Error(`the shutdown latch is not unique by shape: ${found.length} module(s) match (${found.map((f) => f.m.file).join(", ") || "none"})`);
  }
  return { facts: found[0].facts, module: found[0].m, specifier: `${BUNFS}${found[0].m.file}` };
}

// ---------------------------------------------------------------------------
// the importers
// ---------------------------------------------------------------------------

export interface ImporterFacts {
  chunk: string;
  /** which ROLES this chunk imports, and the local name each landed under */
  imports: { role: string; local: string }[];
  /** call sites per role, in this chunk */
  callSites: Record<string, number>;
}

function importerFacts(latch: LatchFacts, specifier: string): { named: ImporterFacts[]; bare: string[]; totals: Record<string, number> } {
  const roleOf = new Map<string, string>([
    [latch.roles.isShuttingDown, "isShuttingDown"],
    [latch.roles.commitShutdown, "commitShutdown"],
    [latch.roles.hang, "hang"],
  ]);
  const named: ImporterFacts[] = [];
  const bare: string[] = [];
  const totals: Record<string, number> = { isShuttingDown: 0, commitShutdown: 0, hang: 0 };

  for (const m of modules()) {
    if (m.file === latch.chunk) continue;
    let sawNamed = false;
    let sawBare = false;
    const entry: ImporterFacts = { chunk: m.file, imports: [], callSites: {} };
    for (const imp of importsOf(m)) {
      if (imp.specifier !== specifier) continue;
      if (imp.bindings.size === 0) {
        sawBare = true;
        continue;
      }
      sawNamed = true;
      for (const [imported, local] of imp.bindings) {
        const role = roleOf.get(imported);
        if (role === undefined) throw new Error(`${m.file}: imports '${imported}' from the latch, which is not one of its three derived roles`);
        const n = callSites(m, local);
        entry.imports.push({ role, local });
        entry.callSites[role] = n;
        totals[role] += n;
      }
    }
    if (sawNamed) {
      entry.imports.sort((a, b) => a.role.localeCompare(b.role));
      named.push(entry);
    } else if (sawBare) {
      bare.push(m.file);
    }
  }
  named.sort((a, b) => a.chunk.localeCompare(b.chunk));
  bare.sort();
  return { named, bare, totals };
}

// ---------------------------------------------------------------------------
// the coordinator, and the free-function facade over it
// ---------------------------------------------------------------------------

export interface MemberFacts {
  name: string;
  kind: "property" | "method" | "getter" | "setter" | "constructor";
  bytes: number;
  async: boolean;
  static: boolean;
  private: boolean;
}

export interface FacadeFacts {
  binding: string;
  member: string;
  bytes: number;
  /** chunks that import this facade function, and how often each calls it */
  importers: { chunk: string; local: string; callSites: number }[];
  callSites: number;
}

export interface CoordinatorFacts {
  chunk: string;
  binding: string;
  start: number;
  end: number;
  bytes: number;
  sha256: string;
  members: MemberFacts[];
  counts: { members: number; properties: number; methods: number; async: number; private: number };
  /** the accessor every facade function funnels through */
  accessor: string;
  facade: FacadeFacts[];
  /** members the facade does NOT expose — reachable only from inside the class */
  unexposedMembers: string[];
}

function coordinatorFacts(): CoordinatorFacts {
  const CLAIM = "claimShutdown";
  const RELEASE = "releaseShutdownClaim";
  const hits: { m: Module; cls: ts.ClassDeclaration }[] = [];
  for (const m of modules()) {
    const visit = (n: ts.Node): void => {
      if (ts.isClassDeclaration(n) && n.name) {
        const names = n.members.map((mm) => (mm.name && ts.isIdentifier(mm.name) ? mm.name.text : ""));
        if (names.includes(CLAIM) && names.includes(RELEASE)) hits.push({ m, cls: n });
      }
      ts.forEachChild(n, visit);
    };
    visit(m.sf);
  }
  if (hits.length !== 1) {
    throw new Error(`the shutdown coordinator is not unique by shape: ${hits.length} class(es) declare both ${CLAIM} and ${RELEASE}`);
  }
  const { m, cls } = hits[0];
  const start = cls.getStart(m.sf);
  const end = cls.getEnd();

  const members: MemberFacts[] = cls.members.map((mm) => {
    const mods = ts.canHaveModifiers(mm) ? ts.getModifiers(mm) ?? [] : [];
    const kind: MemberFacts["kind"] = ts.isPropertyDeclaration(mm)
      ? "property"
      : ts.isMethodDeclaration(mm)
        ? "method"
        : ts.isGetAccessorDeclaration(mm)
          ? "getter"
          : ts.isSetAccessorDeclaration(mm)
            ? "setter"
            : "constructor";
    return {
      name: mm.name && (ts.isIdentifier(mm.name) || ts.isPrivateIdentifier(mm.name)) ? mm.name.text : "<computed>",
      kind,
      bytes: mm.getEnd() - mm.getStart(m.sf),
      async: mods.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword),
      static: mods.some((x) => x.kind === ts.SyntaxKind.StaticKeyword),
      private: mm.name !== undefined && ts.isPrivateIdentifier(mm.name),
    };
  });
  const memberNames = new Set(members.map((x) => x.name));

  // The facade: a top-level `function X(...){ [return] acc().member(...) }` in
  // the coordinator's own chunk. The accessor is derived as the callee every
  // such body shares, so nothing here names it.
  const candidates: { binding: string; member: string; accessor: string; node: ts.FunctionDeclaration }[] = [];
  for (const s of m.sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name || !s.body || s.body.statements.length !== 1) continue;
    const only = s.body.statements[0];
    const expr = ts.isReturnStatement(only) ? only.expression : ts.isExpressionStatement(only) ? only.expression : undefined;
    if (!expr || !ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) continue;
    const recv = expr.expression.expression;
    const member = expr.expression.name.text;
    if (!ts.isCallExpression(recv) || !ts.isIdentifier(recv.expression) || recv.arguments.length !== 0) continue;
    if (!memberNames.has(member)) continue;
    candidates.push({ binding: s.name.text, member, accessor: recv.expression.text, node: s });
  }
  const accessors = [...new Set(candidates.map((c) => c.accessor))];
  if (accessors.length !== 1) {
    throw new Error(`the coordinator facade funnels through ${accessors.length} accessors (${accessors.join(", ")}) — expected exactly one`);
  }

  const facade: FacadeFacts[] = candidates
    .map((c) => {
      const importers: { chunk: string; local: string; callSites: number }[] = [];
      for (const other of modules()) {
        if (other.file === m.file) continue;
        for (const imp of importsOf(other)) {
          if (imp.specifier !== `${BUNFS}${m.file}`) continue;
          const local = imp.bindings.get(c.binding);
          if (local === undefined) continue;
          importers.push({ chunk: other.file, local, callSites: callSites(other, local) });
        }
      }
      importers.sort((a, b) => a.chunk.localeCompare(b.chunk));
      return {
        binding: c.binding,
        member: c.member,
        bytes: c.node.getEnd() - c.node.getStart(m.sf),
        importers,
        callSites: importers.reduce((a, b) => a + b.callSites, 0),
      };
    })
    .sort((a, b) => a.member.localeCompare(b.member));

  const exposed = new Set(facade.map((f) => f.member));
  return {
    chunk: m.file,
    binding: cls.name!.text,
    start,
    end,
    bytes: end - start,
    sha256: sha256(m.text.slice(start, end)),
    members,
    counts: {
      members: members.length,
      properties: members.filter((x) => x.kind === "property").length,
      methods: members.filter((x) => x.kind === "method").length,
      async: members.filter((x) => x.async).length,
      private: members.filter((x) => x.private).length,
    },
    accessor: accessors[0],
    facade,
    unexposedMembers: members.filter((x) => x.kind !== "property" && !exposed.has(x.name)).map((x) => x.name).sort(),
  };
}

// ---------------------------------------------------------------------------
// the signal handlers
// ---------------------------------------------------------------------------

export interface HandlerFacts {
  signal: string;
  chunk: string;
  /**
   * How the handler was HANDED to `process.on`. The distinction is the whole
   * splice question: an `identifier` names a declarator whose initializer is a
   * span the S-method can replace, an `inline-arrow` is an argument expression
   * with no declaration to stand in for it and therefore no target shape at all.
   */
  registration: "identifier" | "inline-arrow";
  /** the declarator the handler arrow initializes, when there is one */
  binding: string | null;
  /** the enclosing named declaration — which function or method registers it */
  registeredIn: string;
  bytes: number;
  sha256: string;
  /** which declarator of its `let`/`var` list — part of a splice's signature */
  declaratorIndex: number | null;
  /** the status the handler hands the shutdown facade or coordinator, read off the call */
  exitCode: number | null;
  /** does this handler call the latch's commit function? (derived, not assumed) */
  commitsLatch: boolean;
  /** does it touch the lifecycle surface at all — latch, shutdown facade or the telemetry */
  touchesLifecycle: boolean;
  /** property reads that gate the body before it does anything — the suppression check */
  guardedBy: string[];
  freeIdentifiers: string[];
  /**
   * Free identifiers the body ASSIGNS to. A splice forwards captures BY VALUE,
   * so any non-empty list here is a mechanical refusal: the delegated body could
   * read the binding but never write it back, and the write is the behaviour.
   */
  assignedFreeIdentifiers: string[];
  excisable: boolean;
  /** why not, when not — a measured refusal rather than a remembered one */
  notExcisableBecause: string | null;
}

/**
 * EVERY shutdown signal handler in the graph, found by registration rather than
 * by chunk.
 *
 * The first cut of this function scoped itself to "the chunk that imports the
 * latch and mentions `shutdown_signal`" and threw, because there are TWO
 * families and the scout only names one. The headless dispatcher installs a
 * SIGINT/SIGTERM pair as named arrow declarators; the coordinator's own
 * `install` registers a SIGINT/SIGTERM/SIGHUP set as inline arguments, each
 * guarded by the print-mode marker the headless dispatcher sets immediately
 * after registering its own. So in a headless run the second family is
 * registered and inert, and only a fixture that enumerates both can say so.
 */
function handlerFacts(latch: LatchFacts, latchSpecifier: string): { handlers: HandlerFacts[]; skipped: { chunk: string; signal: string; handlerKind: string }[] } {
  const MARKER = "shutdown_signal";
  const out: HandlerFacts[] = [];
  /**
   * Registrations the walk found but could not describe — the DENOMINATOR.
   * "Six handlers touch the lifecycle" is only a measurement if the population
   * it was drawn from is stated, including the members it could not read.
   */
  const skipped: { chunk: string; signal: string; handlerKind: string }[] = [];

  for (const m of modules()) {
    if (!/process\.on\("SIG/.test(m.text)) continue;

    // Locals this chunk imported — the shutdown facade among them, so an exit
    // status can be read off the call instead of guessed from its position.
    const imported = new Set<string>();
    for (const imp of importsOf(m)) for (const [, local] of imp.bindings) imported.add(local);
    const commitLocal = importsOf(m)
      .filter((i) => i.specifier === latchSpecifier)
      .map((i) => i.bindings.get(latch.roles.commitShutdown))
      .find((x): x is string => x !== undefined);

    /** the nearest enclosing NAMED declaration, so a reader knows who registers this */
    const enclosing = (n: ts.Node): string => {
      for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
        if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
        if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
      }
      return "<top level>";
    };

    const describe = (
      body: ts.ArrowFunction | ts.FunctionExpression,
      registration: HandlerFacts["registration"],
      at: ts.Node,
      signal: string,
    ): HandlerFacts => {
      const text = m.text.slice(body.getStart(m.sf), body.getEnd());
      const free = freeIdentifiers(body);
      const assigned = new Set<string>();
      const guards = new Set<string>();
      let exitCode: number | null = null;
      let commitsLatch = false;
      const scan = (x: ts.Node): void => {
        if (
          ts.isBinaryExpression(x) &&
          x.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          x.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
          ts.isIdentifier(x.left) &&
          free.includes(x.left.text)
        ) {
          assigned.add(x.left.text);
        }
        if (ts.isIfStatement(x)) {
          const read = (e: ts.Node): void => {
            if (ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword) guards.add(`this.${e.name.text}`);
            if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && imported.has(e.expression.text)) guards.add(`${e.expression.text}()`);
            if (ts.isIdentifier(e) && free.includes(e.text) && ts.isIfStatement(e.parent)) guards.add(e.text);
            ts.forEachChild(e, read);
          };
          read(x.expression);
        }
        if (ts.isCallExpression(x) && ts.isIdentifier(x.expression)) {
          if (x.expression.text === commitLocal) commitsLatch = true;
          if (imported.has(x.expression.text) && x.arguments.length === 1 && ts.isNumericLiteral(x.arguments[0])) {
            exitCode = Number((x.arguments[0] as ts.NumericLiteral).text);
          }
        }
        // the coordinator registers its own handlers, so the status is on `this`
        if (
          ts.isCallExpression(x) &&
          ts.isPropertyAccessExpression(x.expression) &&
          x.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
          x.arguments.length === 1 &&
          ts.isNumericLiteral(x.arguments[0])
        ) {
          exitCode = Number((x.arguments[0] as ts.NumericLiteral).text);
        }
        ts.forEachChild(x, scan);
      };
      scan(body);

      const isArrowInitializer =
        ts.isArrowFunction(body) && ts.isVariableDeclaration(body.parent) && body.parent.initializer === body && ts.isIdentifier(body.parent.name);
      const list = isArrowInitializer ? (body.parent as ts.VariableDeclaration).parent : undefined;
      const notExcisable =
        registration === "inline-arrow"
          ? "handed to process.on as an argument expression: there is no declaration to replace, so no target shape fits (a `variable-declarator` needs a declarator and an `arrow-initializer` needs to BE one)"
          : assigned.size > 0
            ? `the body assigns to the captured binding(s) ${[...assigned].sort().join(", ")}; a splice forwards captures BY VALUE, so the delegated body could read them and never write them back`
            : null;

      return {
        signal,
        chunk: m.file,
        registration,
        binding: isArrowInitializer ? (body.parent as ts.VariableDeclaration).name.getText(m.sf) : null,
        registeredIn: enclosing(at),
        bytes: body.getEnd() - body.getStart(m.sf),
        sha256: sha256(text),
        declaratorIndex: list !== undefined && ts.isVariableDeclarationList(list) ? list.declarations.indexOf(body.parent as ts.VariableDeclaration) : null,
        exitCode,
        commitsLatch,
        /**
         * Does this handler touch the lifecycle surface C16b owns at all? The
         * population is every signal registration in the graph — a
         * `SIGCONT`/`SIGWINCH` handler is in it and answers no, which is what
         * makes the yes-set a measurement rather than a selection.
         */
        touchesLifecycle: commitsLatch || exitCode !== null || text.includes(MARKER),
        guardedBy: [...guards].sort(),
        freeIdentifiers: [...free].sort(),
        assignedFreeIdentifiers: [...assigned].sort(),
        excisable: notExcisable === null,
        notExcisableBecause: notExcisable,
      };
    };

    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "process" &&
        n.expression.name.text === "on" &&
        n.arguments.length === 2 &&
        ts.isStringLiteral(n.arguments[0])
      ) {
        const handler = n.arguments[1];
        const signal = (n.arguments[0] as ts.StringLiteral).text;
        if (!signal.startsWith("SIG")) return;
        if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
          out.push(describe(handler, "inline-arrow", n, signal));
        } else if (ts.isIdentifier(handler)) {
          // resolve the declarator in this chunk and describe ITS initializer
          const target = handler.text;
          let found: ts.ArrowFunction | ts.FunctionExpression | null = null;
          const seek = (x: ts.Node): void => {
            if (
              ts.isVariableDeclaration(x) &&
              ts.isIdentifier(x.name) &&
              x.name.text === target &&
              x.initializer &&
              (ts.isArrowFunction(x.initializer) || ts.isFunctionExpression(x.initializer))
            ) {
              found = x.initializer;
            }
            ts.forEachChild(x, seek);
          };
          seek(m.sf);
          if (found !== null) out.push(describe(found, "identifier", n, signal));
          else skipped.push({ chunk: m.file, signal, handlerKind: "identifier with no arrow/function declarator in this chunk" });
        } else {
          skipped.push({ chunk: m.file, signal, handlerKind: ts.SyntaxKind[handler.kind] });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(m.sf);
  }

  if (!out.some((h) => h.commitsLatch)) throw new Error(`no signal handler in the graph commits the latch — the ${MARKER} surface moved`);
  out.sort((a, b) => a.chunk.localeCompare(b.chunk) || a.signal.localeCompare(b.signal) || a.bytes - b.bytes);
  skipped.sort((a, b) => a.chunk.localeCompare(b.chunk) || a.signal.localeCompare(b.signal));
  return { handlers: out, skipped };
}

// ---------------------------------------------------------------------------
// the fixture
// ---------------------------------------------------------------------------

export interface ProcessLifecycleFixture {
  engineVersion: string;
  generatedBy: string;
  latch: LatchFacts;
  importers: {
    /** chunks with a NAMED import of the latch — the ones that read it */
    named: ImporterFacts[];
    /** chunks with only a BARE side-effect import — evaluation order, not a read */
    bareCount: number;
    counts: { named: number; bare: number; graphModules: number };
    callSiteTotals: Record<string, number>;
    /** how many named importers read each role */
    readersPerRole: Record<string, number>;
  };
  coordinator: CoordinatorFacts;
  signalHandlers: {
    /** every `process.on("SIG…", …)` in the graph the walk could read */
    handlers: HandlerFacts[];
    /** …and the ones it could not, so the population has a denominator */
    skipped: { chunk: string; signal: string; handlerKind: string }[];
    counts: { registrations: number; described: number; skipped: number; touchingLifecycle: number; excisable: number };
  };
}

export function extract(): ProcessLifecycleFixture {
  const { facts: latch, specifier } = latchFacts();
  const importers = importerFacts(latch, specifier);
  const readersPerRole: Record<string, number> = { isShuttingDown: 0, commitShutdown: 0, hang: 0 };
  for (const i of importers.named) for (const im of i.imports) readersPerRole[im.role]++;
  return {
    engineVersion: ENGINE_VERSION,
    generatedBy: "research/tools/extract-process-lifecycle.ts",
    latch,
    importers: {
      named: importers.named,
      bareCount: importers.bare.length,
      counts: { named: importers.named.length, bare: importers.bare.length, graphModules: modules().length },
      callSiteTotals: importers.totals,
      readersPerRole,
    },
    coordinator: coordinatorFacts(),
    signalHandlers: (() => {
      const { handlers, skipped } = handlerFacts(latch, specifier);
      const lifecycle = handlers.filter((h) => h.touchesLifecycle);
      return {
        handlers,
        skipped,
        counts: {
          registrations: handlers.length + skipped.length,
          described: handlers.length,
          skipped: skipped.length,
          touchingLifecycle: lifecycle.length,
          excisable: lifecycle.filter((h) => h.excisable).length,
        },
      };
    })(),
  };
}

/** The whole committed fixture, for callers that need the spans. */
export function readFixture(version = ENGINE_VERSION): ProcessLifecycleFixture {
  return JSON.parse(readFileSync(fixturePath(version), "utf8")) as ProcessLifecycleFixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const text = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  console.log(
    `  latch: ${fx.latch.chunk} ${fx.latch.bytes} B (${fx.latch.codeBytes} B of code), exports ${fx.latch.exportOrder.join(", ")} ` +
      `= ${fx.latch.roles.isShuttingDown}/${fx.latch.roles.commitShutdown}/${fx.latch.roles.hang}`,
  );
  console.log(`  anchor: ${JSON.stringify(fx.latch.anchor?.literal)} x${fx.latch.anchor?.occurrences} in ${fx.latch.anchor?.files} file(s)`);
  console.log(
    `  importers: ${fx.importers.counts.named} named, ${fx.importers.counts.bare} bare (of ${fx.importers.counts.graphModules} modules); ` +
      `call sites ${Object.entries(fx.importers.callSiteTotals).map(([k, v]) => `${k}=${v}`).join(" ")}`,
  );
  console.log(
    `  coordinator: ${fx.coordinator.binding}@${fx.coordinator.chunk} ${fx.coordinator.bytes} B, ` +
      `${fx.coordinator.counts.members} members (${fx.coordinator.counts.methods} methods, ${fx.coordinator.counts.private} private), ` +
      `${fx.coordinator.facade.length} exposed through ${fx.coordinator.accessor}()`,
  );
  const lifecycle = fx.signalHandlers.handlers.filter((h) => h.touchesLifecycle);
  console.log(
    `  signal handlers: ${fx.signalHandlers.counts.registrations} registrations graph-wide ` +
      `(${fx.signalHandlers.counts.described} read, ${fx.signalHandlers.counts.skipped} not), ` +
      `${fx.signalHandlers.counts.touchingLifecycle} touching the lifecycle surface, ${fx.signalHandlers.counts.excisable} excisable`,
  );
  for (const h of lifecycle) {
    console.log(
      `    ${h.signal.padEnd(7)} ${(h.binding ?? "<inline>").padEnd(10)} ${h.chunk} in ${h.registeredIn}(): ${h.bytes} B, exit ${h.exitCode}` +
        `${h.commitsLatch ? ", COMMITS the latch" : ""} — ${h.excisable ? "EXCISABLE" : `not excisable: ${h.notExcisableBecause}`}`,
    );
  }

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== text) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-process-lifecycle.ts`);
      process.exit(1);
    }
    console.log("PASS — committed fixture matches the pinned bundle");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
