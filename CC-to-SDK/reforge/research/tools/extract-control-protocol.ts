// §3.3 — snapshot the HEADLESS CONTROL-REQUEST DISPATCH from the pinned bundle,
// and the subtype surface the installed SDK can put on the wire.
//
//   npx tsx research/tools/extract-control-protocol.ts [--check]
//
// WHY A FIXTURE. W5 enumerated "the hook events that exist" by judgment twice and
// was wrong twice; the registry fixture ended that by reading the population off
// the artifact. The control protocol has the same shape of question and the same
// trap: the wave's own scout counted "55 arms" and "~39 sendable subtypes" by
// hand, and a wave that budgets from a hand count cannot report an honest
// negative — a subtype nobody thought of is not merely uncovered, it is
// invisible. So the population under test is derived here, twice over, from two
// artifacts that share no machinery:
//
//   1. the ENGINE's dispatch chain — every arm of the `if/else if` ladder over
//      `<frame>.request.subtype` that the headless streaming loop runs, with the
//      named functions each arm delegates to, the validation sentences it can
//      answer with, and whether it responds through the success or the error
//      envelope. This is what CAN be dispatched.
//   2. the SDK's SENDABLE set — every `subtype` the installed
//      `@anthropic-ai/claude-agent-sdk` can construct into a `control_request`.
//      This is what a host-driven session can ASK for. It is a different package
//      by a different build, so it confirms the chain independently.
//
// The interesting rows are the ones where the two disagree: an arm with no
// sender is reachable only by a raw driver (which is why `m2/raw-protocol.ts`
// exists), and a sendable subtype with no arm would be a wrapper promising
// something this engine does not implement.
//
// HOW THE CHAIN IS FOUND (not hardcoded). Every binding here is minified and
// churns at any bump, so nothing looks for a name:
//
//   1. shape — the longest `if / else if` chain in the bundle whose every
//      condition tests `<expr>.subtype === "<literal>"` (or a disjunction of
//      such tests). At this size nothing else in the graph is shaped like it.
//   2. confirmation A, from the same artifact but a different place: the chain
//      must sit inside a guard that tested `<expr>.type === "control_request"`.
//      A subtype ladder that is not the control dispatcher fails this.
//   3. confirmation B, from a DIFFERENT artifact: the chain must carry an arm
//      for most of what the SDK can send.
//
// A NOTE ON THE ENCLOSING FUNCTION, because the scout got it wrong and the wrong
// version is the intuitive one. The chain does not live in `runHeadless`. It
// lives in the async generator `runHeadless` drives (`for await (… of ky(…))`),
// which the bundle re-exports as `_runHeadlessStreamingForTesting`. That name
// says "test entry point" and it is not one: it is the production streaming
// loop, exported so tests can drive it. The fixture records both bindings so the
// next reader does not have to re-derive the relationship.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(TOOL_DIR, "..", "fixtures");
export const fixturePath = (version: string) => join(FIXTURE_DIR, `control-protocol-${version}.json`);

const SDK_DIR = join(TOOL_DIR, "..", "..", "node_modules", "@anthropic-ai", "claude-agent-sdk");

/**
 * The smallest ladder this tool will accept as the dispatcher. Far above any
 * incidental two-or-three-arm subtype test, and well below the observed count so
 * a pin that retires a dozen subtypes still resolves rather than throwing.
 */
const MIN_ARMS = 25;
/**
 * How much of the SDK's sendable set the chain must serve to be confirmed. Not
 * 100%: the two artifacts version independently, and a wrapper that learns a
 * subtype before the engine ships it is a real (and interesting) state, not a
 * reason to refuse the extraction.
 */
const MIN_CONFIRMATION = 0.8;

interface ChunkFacts {
  file: string;
  text: string;
  sf: ts.SourceFile;
  /** local name -> { from chunk, exported name } */
  imports: Map<string, { from: string; name: string }>;
  /** exported name -> local name */
  exports: Map<string, string>;
  /** local name -> the top-level node that defines it */
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
    else if (ts.isClassDeclaration(stmt) && stmt.name) defines.set(stmt.name.text, stmt);
    else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) defines.set(d.name.text, d);
    }
  }
  return { file, text, sf, imports, exports, defines };
}

/** `X.subtype === "lit"`, or a `||` disjunction of those. Returns the literals, or null. */
function subtypeTest(expr: ts.Expression): string[] | null {
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const l = subtypeTest(expr.left);
    const r = subtypeTest(expr.right);
    return l && r ? [...l, ...r] : null;
  }
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isPropertyAccessExpression(expr.left) &&
    expr.left.name.text === "subtype" &&
    ts.isStringLiteral(expr.right)
  ) {
    return [expr.right.text];
  }
  return null;
}

/** `X.type === "control_request"`, the guard the chain must sit under. */
function isControlRequestGuard(expr: ts.Expression): boolean {
  return (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isPropertyAccessExpression(expr.left) &&
    expr.left.name.text === "type" &&
    ts.isStringLiteral(expr.right) &&
    expr.right.text === "control_request"
  );
}

interface Candidate {
  chunk: string;
  head: ts.IfStatement;
  arms: { node: ts.IfStatement; subtypes: string[] }[];
  terminalElse: ts.Statement | null;
}

/** Every `if/else if` ladder over `.subtype`, longest first. */
function findChains(c: ChunkFacts): Candidate[] {
  const out: Candidate[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isIfStatement(n)) {
      // only start at the HEAD of a chain: a node that is not itself an `else if`
      const isElseIf = n.parent && ts.isIfStatement(n.parent) && n.parent.elseStatement === n;
      if (!isElseIf) {
        const arms: { node: ts.IfStatement; subtypes: string[] }[] = [];
        let cur: ts.Statement | undefined = n;
        while (cur && ts.isIfStatement(cur)) {
          const st = subtypeTest(cur.expression);
          if (st === null) break;
          arms.push({ node: cur, subtypes: st });
          cur = cur.elseStatement;
        }
        if (arms.length >= MIN_ARMS) out.push({ chunk: c.file, head: n, arms, terminalElse: cur ?? null });
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(c.sf);
  return out;
}

/**
 * Every function-like the chain is nested in, innermost first. The whole chain
 * is recorded rather than just the nearest one, because the nearest one is
 * anonymous and the answer readers actually want — "which exported entry point
 * runs this?" — is two levels up.
 */
function enclosingFunctions(sf: ts.SourceFile, node: ts.Node): { binding: string | null; kind: string; bytes: number }[] {
  const out: { binding: string | null; kind: string; bytes: number }[] = [];
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) {
      const named = ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);
      let binding: string | null = named && (n as ts.FunctionDeclaration).name ? (n as ts.FunctionDeclaration).name!.getText(sf) : null;
      if (binding === null) {
        // an arrow/anonymous function assigned to a declarator carries that name
        const p = n.parent;
        if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) binding = p.name.text;
      }
      out.push({ binding, kind: ts.SyntaxKind[n.kind], bytes: n.getEnd() - n.getStart(sf) });
    }
    n = n.parent;
  }
  return out;
}

/** The names a chunk re-exports a local binding under — how a minified seam gets a readable name. */
function exportedAs(c: ChunkFacts, local: string): string[] {
  return [...c.exports].filter(([, l]) => l === local).map(([e]) => e).sort();
}

/** Is `node` (transitively) inside an `if (X.type === "control_request")` then-branch? */
function underControlRequestGuard(node: ts.Node): boolean {
  let n: ts.Node | undefined = node;
  while (n) {
    const p: ts.Node | undefined = n.parent;
    if (p && ts.isIfStatement(p) && p.thenStatement === n && isControlRequestGuard(p.expression)) return true;
    n = p;
  }
  return false;
}

function resolveDefinition(chunks: Map<string, ChunkFacts>, chunk: string, local: string): { chunk: string; name: string; node: ts.Node } | null {
  let cur = chunks.get(chunk);
  let name = local;
  for (let hops = 0; cur && hops < 32; hops++) {
    const d = cur.defines.get(name);
    if (d) return { chunk: cur.file, name, node: d };
    const imp = cur.imports.get(name);
    if (!imp) return null;
    const next = chunks.get(imp.from);
    if (!next) return null;
    name = next.exports.get(imp.name) ?? imp.name;
    cur = next;
  }
  return null;
}

/** Identifiers CALLED directly inside a subtree (callee position only, not references). */
function calledIdentifiers(root: ts.Node): Set<string> {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) out.add(n.expression.text);
    ts.forEachChild(n, walk);
  };
  walk(root);
  return out;
}

/** `import("…/chunk-X.js")` specifiers inside a subtree. */
function dynamicImports(root: ts.Node): string[] {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0])) {
      out.add(basename(n.arguments[0].text));
    }
    ts.forEachChild(n, walk);
  };
  walk(root);
  return [...out].sort();
}

/** Does this subtree contain a bare `continue` / `break` that leaves it? */
function hasJump(root: ts.Node, kind: ts.SyntaxKind.ContinueStatement | ts.SyntaxKind.BreakStatement): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    // a jump inside a nested loop/switch belongs to that construct, not to ours
    if (n !== root && (ts.isForOfStatement(n) || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isSwitchStatement(n))) return;
    if (n.kind === kind) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(root);
  return found;
}

/**
 * The sentences an arm can answer a host with. Derived by finding the arm's
 * one-argument-plus-message calls whose second argument is a string literal or a
 * template head — which is what the error responder's call shape is. Recorded as
 * evidence for the anchors a later wave will splice on, and as the surface a
 * subtype driver's invalid cases must be able to provoke.
 */
function stringLiteralArgs(root: ts.Node): string[] {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      for (const a of n.arguments) {
        if (ts.isStringLiteral(a) && a.text.length > 12) out.add(a.text);
        if (ts.isTemplateExpression(a) && a.head.text.length > 12) out.add(a.head.text + "${…}");
        if (ts.isNoSubstitutionTemplateLiteral(a) && a.text.length > 12) out.add(a.text);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(root);
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// The SDK side — what a host-driven session can put on the wire.
// ---------------------------------------------------------------------------

/**
 * Subtypes the installed SDK can construct into a `control_request`. Three
 * shapes, all recognised structurally:
 *   a) `{type:"control_request", request:{subtype:"X", …}}`
 *   b) `something.request({subtype:"X", …})`
 *   c) `let r = {subtype:"X", …}; … .request(r)`  (initialize takes this path)
 */
function sdkSendableSubtypes(): { version: string; subtypes: string[] } {
  const pkg = JSON.parse(readFileSync(join(SDK_DIR, "package.json"), "utf8")) as { version: string };
  const file = join(SDK_DIR, "sdk.mjs");
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);

  const subtypeOf = (o: ts.ObjectLiteralExpression): string | null => {
    for (const p of o.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "subtype" && ts.isStringLiteral(p.initializer)) return p.initializer.text;
    }
    return null;
  };

  // The nearest enclosing function-like, which is the scope a minified local
  // belongs to. Rule (c) below is keyed on it: `n` is reused all over a
  // 300 KB bundle, so a file-wide "was any `n` ever handed to .request()?" test
  // admits an unrelated object (measured: it admitted `mirror_error`, which is a
  // `type:"system"` message this SDK never sends as a control_request).
  const scopeOf = (n: ts.Node): ts.Node => {
    let s: ts.Node | undefined = n;
    while (s && !ts.isFunctionDeclaration(s) && !ts.isFunctionExpression(s) && !ts.isArrowFunction(s) && !ts.isMethodDeclaration(s) && !ts.isSourceFile(s)) s = s.parent;
    return s ?? sf;
  };

  // pass 1: identifiers passed to a `.request(…)` call, keyed by their scope
  const requestedIdentifiers = new Set<string>();
  const walk1 = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "request") {
      for (const a of n.arguments) if (ts.isIdentifier(a)) requestedIdentifiers.add(`${scopeOf(n).getStart(sf)}#${a.text}`);
    }
    ts.forEachChild(n, walk1);
  };
  walk1(sf);

  const out = new Set<string>();
  const walk2 = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      const st = subtypeOf(n);
      if (st !== null) {
        const p = n.parent;
        // (a) the `request:` value of a control_request frame
        if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "request") {
          const frame = p.parent;
          if (ts.isObjectLiteralExpression(frame)) {
            for (const q of frame.properties) {
              if (ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && q.name.text === "type" && ts.isStringLiteral(q.initializer) && q.initializer.text === "control_request") {
                out.add(st);
              }
            }
          }
        }
        // (b) the argument of a `.request(…)` call
        if (p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "request") out.add(st);
        // (c) the initializer of a declarator later handed to `.request(…)`
        if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && requestedIdentifiers.has(`${scopeOf(p).getStart(sf)}#${p.name.text}`)) out.add(st);
      }
    }
    ts.forEachChild(n, walk2);
  };
  walk2(sf);
  return { version: pkg.version, subtypes: [...out].sort() };
}

// ---------------------------------------------------------------------------

export interface ControlProtocolFixture {
  engineVersion: string;
  generatedBy: string;
  chain: {
    chunk: string;
    /**
     * Every function the ladder is nested in, innermost first, each with the
     * names its chunk re-exports it under. Recorded in full because the obvious
     * answer is wrong: the dispatcher is not in `runHeadless`, it is in the
     * anonymous frame handler inside the async generator `runHeadless` iterates
     * — and that generator is re-exported under a name ending in `ForTesting`
     * while being the production streaming loop.
     */
    enclosing: { binding: string | null; kind: string; bytes: number; exportedAs: string[] }[];
    offset: number;
    bytes: number;
    /** the `else` the ladder falls off, verbatim — the unsupported-subtype answer */
    terminalElse: string | null;
  };
  sdk: { package: string; version: string; sendable: string[] };
  counts: {
    arms: number;
    subtypes: number;
    sendable: number;
    /** sendable subtypes this engine has an arm for */
    servedSendable: number;
    /** arms no installed-SDK call site can reach — raw-driver-only territory */
    armsWithoutSender: number;
    confirmationRatio: number;
  };
  arms: {
    subtypes: string[];
    bytes: number;
    /** does the arm answer through the success envelope / the error envelope? */
    respondsSuccess: boolean;
    respondsError: boolean;
    /** leaves the dispatch loop's iteration / terminates it */
    usesContinue: boolean;
    usesBreak: boolean;
    /** chunks the arm pulls in at call time */
    dynamicImports: string[];
    /** the named functions the arm delegates to, resolved to where they are defined */
    delegates: { local: string; chunk: string; name: string; bytes: number }[];
    /** literal sentences the arm can put on the wire — anchor and driver evidence */
    messages: string[];
    /** can the installed SDK ask for this arm at all? */
    sendable: boolean;
  }[];
}

export function extract(modulesDir = BUNDLE_MODULES, version = ENGINE_VERSION): ControlProtocolFixture {
  const files = readdirSync(modulesDir).filter((f) => f.endsWith(".js"));
  const chunks = new Map<string, ChunkFacts>();
  for (const f of files) chunks.set(f, readChunk(f, readFileSync(join(modulesDir, f), "utf8")));

  const sdk = sdkSendableSubtypes();
  const sendable = new Set(sdk.subtypes);

  // ---- 1. shape ------------------------------------------------------------
  const candidates: Candidate[] = [];
  for (const c of chunks.values()) candidates.push(...findChains(c));
  // ---- 2. confirmation A: under a control_request guard --------------------
  const guarded = candidates.filter((c) => underControlRequestGuard(c.head));
  // ---- 3. confirmation B: serves most of what the SDK can send -------------
  const scored = guarded
    .map((c) => {
      const subtypes = new Set(c.arms.flatMap((a) => a.subtypes));
      const served = [...sendable].filter((s) => subtypes.has(s)).length;
      return { c, subtypes, ratio: sendable.size === 0 ? 0 : served / sendable.size, served };
    })
    .filter((s) => s.ratio >= MIN_CONFIRMATION)
    .sort((a, b) => b.c.arms.length - a.c.arms.length);

  if (scored.length === 0) {
    throw new Error(
      `no control-request dispatch chain found: ${candidates.length} subtype ladder(s) of >=${MIN_ARMS} arms, ${guarded.length} under a ` +
        `\`type==="control_request"\` guard, none serving >=${MIN_CONFIRMATION * 100}% of the ${sendable.size} subtypes the installed SDK ` +
        `(${sdk.version}) can send. The dispatcher's shape changed upstream — re-derive before trusting anything downstream.`,
    );
  }
  const best = scored[0];
  const chunk = chunks.get(best.c.chunk)!;
  const enclosing = enclosingFunctions(chunk.sf, best.c.head).map((e) => ({ ...e, exportedAs: e.binding ? exportedAs(chunk, e.binding) : [] }));

  // ---- 4. per-arm facts ----------------------------------------------------
  const responders = responderLocals(chunks, best.c.chunk, chunk.sf, best.c.head);
  const arms: ControlProtocolFixture["arms"] = best.c.arms.map((a) => {
    const body = a.node.thenStatement;
    const delegates: { local: string; chunk: string; name: string; bytes: number }[] = [];
    for (const local of [...calledIdentifiers(body)].sort()) {
      const def = resolveDefinition(chunks, best.c.chunk, local);
      if (!def) continue; // a loop-local helper, not a named seam
      const dc = chunks.get(def.chunk)!;
      delegates.push({ local, chunk: def.chunk, name: def.name, bytes: def.node.getEnd() - def.node.getStart(dc.sf) });
    }
    return {
      subtypes: a.subtypes,
      bytes: body.getEnd() - body.getStart(chunk.sf),
      // the envelopes are loop-locals wrapping the two constructors W6 owns, so
      // they never resolve as delegates; `responders` recovers them by shape.
      respondsSuccess: responders.success !== null && calledIdentifiers(body).has(responders.success),
      respondsError: responders.error !== null && calledIdentifiers(body).has(responders.error),
      usesContinue: hasJump(body, ts.SyntaxKind.ContinueStatement),
      usesBreak: hasJump(body, ts.SyntaxKind.BreakStatement),
      dynamicImports: dynamicImports(body),
      delegates: delegates.sort((x, y) => y.bytes - x.bytes || x.name.localeCompare(y.name)),
      messages: stringLiteralArgs(body),
      sendable: a.subtypes.some((s) => sendable.has(s)),
    };
  });

  const subtypes = [...best.subtypes].sort();
  return {
    engineVersion: version,
    generatedBy: "research/tools/extract-control-protocol.ts",
    chain: {
      chunk: best.c.chunk,
      enclosing,
      offset: best.c.head.getStart(chunk.sf),
      bytes: best.c.head.getEnd() - best.c.head.getStart(chunk.sf),
      terminalElse: best.c.terminalElse ? best.c.terminalElse.getText(chunk.sf) : null,
    },
    sdk: { package: "@anthropic-ai/claude-agent-sdk", version: sdk.version, sendable: sdk.subtypes },
    counts: {
      arms: best.c.arms.length,
      subtypes: subtypes.length,
      sendable: sdk.subtypes.length,
      servedSendable: best.served,
      armsWithoutSender: arms.filter((a) => !a.sendable).length,
      confirmationRatio: Number(best.ratio.toFixed(4)),
    },
    arms,
  };
}

/**
 * The success/error responders are declarators in the dispatch loop's own scope
 * (they close over the outbound queue), so they never resolve through the import
 * graph and never appear as an arm's delegate. They are recovered by shape —
 * `X = function(u, T){ <queue>.enqueue(<ctor>(u.request_id, T)) }` — and then
 * SEPARATED by reading the constructor each one wraps: the one whose body stamps
 * `subtype:"success"` is the success leg, `subtype:"error"` the error leg. That
 * is the distinction the arms are classified on, and taking it from the
 * constructor's own bytes rather than from declaration order means a reordering
 * upstream cannot silently swap the two columns of this fixture.
 */
function responderLocals(chunks: Map<string, ChunkFacts>, chunkName: string, sf: ts.SourceFile, head: ts.Node): { success: string | null; error: string | null } {
  // The responders are declared in the GENERATOR's scope, not the frame
  // handler's, so the search widens outward through every enclosing function
  // until it finds them rather than stopping at the nearest one.
  const scopes: ts.Node[] = [];
  for (let n: ts.Node | undefined = head; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) scopes.push(n);
  }
  const out: { success: string | null; error: string | null } = { success: null, error: null };
  const walk = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isFunctionExpression(n.initializer) || ts.isArrowFunction(n.initializer))) {
      const m = n.initializer.getText(sf).match(/enqueue\(([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\.request_id/);
      if (m) {
        const def = resolveDefinition(chunks, chunkName, m[1]);
        if (def) {
          const body = chunks.get(def.chunk)!.text.slice(def.node.getStart(chunks.get(def.chunk)!.sf), def.node.getEnd());
          if (body.includes('subtype:"success"')) out.success = n.name.text;
          else if (body.includes('subtype:"error"')) out.error = n.name.text;
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  for (const s of scopes) {
    walk(s);
    if (out.success !== null && out.error !== null) break;
  }
  return out;
}

/** The subtype inventory a driver or a verdict table enumerates over. */
export function readFixture(version = ENGINE_VERSION): ControlProtocolFixture {
  return JSON.parse(readFileSync(fixturePath(version), "utf8")) as ControlProtocolFixture;
}

/** Every subtype the pinned engine has an arm for, sorted. */
export function dispatchSubtypes(version = ENGINE_VERSION): string[] {
  return [...new Set(readFixture(version).arms.flatMap((a) => a.subtypes))].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const text = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  const where = fx.chain.enclosing.map((e) => `${e.binding ?? "<anon>"}${e.exportedAs.length ? `(${e.exportedAs.join("/")})` : ""}`).join(" < ");
  console.log(`  chain: ${fx.chain.chunk} offset ${fx.chain.offset}, ${fx.chain.bytes}B over ${fx.counts.arms} arms / ${fx.counts.subtypes} subtypes`);
  console.log(`  inside: ${where}`);
  console.log(`  sdk ${fx.sdk.version}: ${fx.counts.sendable} sendable, ${fx.counts.servedSendable} served by an arm (${(fx.counts.confirmationRatio * 100).toFixed(1)}%)`);
  console.log(`  arms no installed SDK can reach: ${fx.counts.armsWithoutSender}`);
  const orphanSenders = fx.sdk.sendable.filter((s) => !fx.arms.some((a) => a.subtypes.includes(s)));
  if (orphanSenders.length > 0) console.log(`  SENDABLE WITH NO ARM: ${orphanSenders.join(", ")}`);

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== text) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-control-protocol.ts`);
      process.exit(1);
    }
    console.log("PASS — committed fixture matches the pinned bundle and the installed SDK");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
