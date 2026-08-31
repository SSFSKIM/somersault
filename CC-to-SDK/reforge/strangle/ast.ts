// AST-span excision — the span-finder behind the splice transform.
//
// The locator is still the true-substring-unique STRING LITERAL anchor: literals
// survive minification and version churn, and that bet has now paid across ten
// versions and a bundler rewrite. What changed (campaign spec C1 / §2.1) is how
// the anchor's *owning node* is found. The old builder searched backwards for a
// hardcoded method name and then scanned for balanced braces — a heuristic that
// only knows one syntactic shape and truncates silently on the others. Here the
// owning chunk is parsed once, the anchor's position is resolved to its deepest
// node, and we climb parents until we reach the shape the manifest declares.
// The excised span is then exactly that node's span: exact where a brace scan
// approximates.
//
// Measured: the TypeScript parser reads the 4.0 MB engine chunk in ~0.5 s with
// zero parse diagnostics, so parsing is cheap enough to do per build.
import ts from "typescript";
import type { TargetShape } from "./manifest.js";

const asts = new Map<string, ts.SourceFile>();

/** Parse (and cache) one chunk. A chunk that does not parse cleanly is not a seam. */
export function chunkAst(path: string, text: string): ts.SourceFile {
  const cached = asts.get(path);
  if (cached) return cached;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const diagnostics = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    throw new Error(`${path}: ${diagnostics.length} parse diagnostic(s) — cannot excise from a chunk that does not parse`);
  }
  asts.set(path, sf);
  return sf;
}

export interface Excision {
  shape: TargetShape;
  /** what the node is called, for the build log and the footprint ledger */
  label: string;
  start: number;
  end: number;
  original: string;
  /**
   * Arguments the SHAPE contributes ahead of the manifest's captures: the
   * original parameter names for the callable shapes (plus `this` for a class
   * method, whose body is written against the receiver), and the switch
   * subject for a case clause. Derived from the AST, never from the manifest.
   */
  shapeArgs: string[];
  /** the delegation that replaces the span */
  render(fn: string, args: string[]): string;
}

/** The deepest node whose span contains `pos`. */
function deepestAt(sf: ts.SourceFile, pos: number): ts.Node {
  let node: ts.Node = sf;
  for (;;) {
    const child = ts.forEachChild(node, (c) => (c.getStart(sf) <= pos && pos < c.getEnd() ? c : undefined));
    if (!child) return node;
    node = child;
  }
}

function matchesShape(n: ts.Node, shape: TargetShape): boolean {
  switch (shape) {
    // A method in an object literal — the shape the three original splices use
    // (the tool-result formatter family hangs off per-tool object literals).
    case "sibling-method":
      return ts.isMethodDeclaration(n) && ts.isObjectLiteralExpression(n.parent);
    case "class-method":
      return ts.isMethodDeclaration(n) && ts.isClassLike(n.parent);
    case "free-function":
      return ts.isFunctionDeclaration(n);
    case "switch-case":
      return ts.isCaseClause(n);
  }
}

const has = (n: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);

/** The original parameter list, verbatim — defaults and all still evaluate. */
function paramText(sf: ts.SourceFile, params: ts.NodeArray<ts.ParameterDeclaration>): string {
  return params.length === 0 ? "" : sf.text.slice(params.pos, params.end);
}

/**
 * The argument expressions to forward. Identifiers forward as themselves; an
 * object binding pattern is re-assembled into the equivalent object literal
 * (`({a:x,b:y})` for `{a:x,b:y}`), which is how the original three splices have
 * always been wired. NOTE what that means and does not: the delegated module
 * sees exactly the properties the original body named — a rest element carries
 * the remainder, but a default value or a nested pattern would change what the
 * callee observes, so those fail the build instead of being approximated.
 */
function paramArgs(label: string, params: ts.NodeArray<ts.ParameterDeclaration>): string[] {
  return params.map((p, i) => {
    const spread = p.dotDotDotToken ? "..." : "";
    if (ts.isIdentifier(p.name)) return `${spread}${p.name.text}`;
    const where = `${label}: parameter #${i}`;
    if (!ts.isObjectBindingPattern(p.name)) throw new Error(`${where} is an array pattern — delegation needs an explicit adapter`);
    const fields = p.name.elements.map((el) => {
      if (el.initializer) throw new Error(`${where} destructures with a default — delegation needs an explicit adapter`);
      if (!ts.isIdentifier(el.name)) throw new Error(`${where} nests a binding pattern — delegation needs an explicit adapter`);
      if (el.dotDotDotToken) return `...${el.name.text}`;
      return el.propertyName ? `${el.propertyName.getText()}:${el.name.text}` : el.name.text;
    });
    return `${spread}{${fields.join(",")}}`;
  });
}

function methodName(n: ts.MethodDeclaration): string {
  if (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name)) return n.name.text;
  if (ts.isStringLiteral(n.name)) return JSON.stringify(n.name.text);
  throw new Error(`unsupported method name kind ${ts.SyntaxKind[n.name.kind]}`);
}

/** The last statement, looking through wrapping blocks. */
function lastStatement(statements: readonly ts.Statement[]): ts.Statement | undefined {
  const last = statements[statements.length - 1];
  if (last && ts.isBlock(last)) return lastStatement(last.statements);
  return last;
}

function exciseMethod(sf: ts.SourceFile, n: ts.MethodDeclaration, shape: TargetShape): Excision {
  const name = methodName(n);
  if (n.asteriskToken) throw new Error(`${name}: generator methods need a yield-preserving delegation`);
  const params = paramText(sf, n.parameters);
  // A class method's body is written against its receiver, so `this` crosses as
  // the delegation's first argument. (Private FIELDS are unreachable from
  // outside the class body — a class method that touches `this.#x` needs a
  // declared accessor adapter, not this transform.)
  const shapeArgs = [...(shape === "class-method" ? ["this"] : []), ...paramArgs(name, n.parameters)];
  const prefix =
    (has(n, ts.SyntaxKind.StaticKeyword) ? "static " : "") + (has(n, ts.SyntaxKind.AsyncKeyword) ? "async " : "");
  return {
    shape,
    label: name,
    start: n.getStart(sf),
    end: n.getEnd(),
    original: sf.text.slice(n.getStart(sf), n.getEnd()),
    shapeArgs,
    render: (fn, args) => `${prefix}${name}(${params}){return globalThis.__reforge.${fn}(${args.join(",")})}`,
  };
}

function exciseFunction(sf: ts.SourceFile, n: ts.FunctionDeclaration): Excision {
  const name = n.name?.text;
  if (!name) throw new Error("free-function target has no name — cannot re-declare the binding");
  if (n.asteriskToken) throw new Error(`${name}: generator functions need a yield-preserving delegation`);
  const params = paramText(sf, n.parameters);
  const prefix = has(n, ts.SyntaxKind.AsyncKeyword) ? "async " : "";
  return {
    shape: "free-function",
    label: name,
    start: n.getStart(sf),
    end: n.getEnd(),
    original: sf.text.slice(n.getStart(sf), n.getEnd()),
    shapeArgs: paramArgs(name, n.parameters),
    render: (fn, args) => `${prefix}function ${name}(${params}){return globalThis.__reforge.${fn}(${args.join(",")})}`,
  };
}

/** Does this subtree read `this` outside a nested `function`/class of its own? */
function readsThis(n: ts.Node): boolean {
  let found = false;
  const visit = (m: ts.Node) => {
    if (found) return;
    if (m.kind === ts.SyntaxKind.ThisKeyword) found = true;
    // arrow functions inherit `this`; function expressions and classes rebind it
    else if (!ts.isFunctionDeclaration(m) && !ts.isFunctionExpression(m) && !ts.isClassLike(m)) ts.forEachChild(m, visit);
  };
  ts.forEachChild(n, visit);
  return found;
}

function exciseCase(sf: ts.SourceFile, n: ts.CaseClause): Excision {
  const test = sf.text.slice(n.expression.getStart(sf), n.expression.getEnd());
  const label = `case ${test}`;
  if (n.statements.length === 0) throw new Error(`${label}: empty clause (fall-through) has nothing to excise`);
  // Delegation is statement-level, so the clause must LEAVE the switch the way
  // we can reproduce: an unlabelled `break`, or a `return` whose value the
  // delegation forwards. Anything else (fall-through into the next clause,
  // `continue`, a labelled break) changes the enclosing control flow and needs
  // its own transform rather than a silent approximation.
  const last = lastStatement(n.statements);
  const exit =
    last && ts.isBreakStatement(last) && !last.label
      ? "break"
      : last && ts.isReturnStatement(last)
        ? "return"
        : undefined;
  if (!exit) throw new Error(`${label}: clause does not end in an unlabelled break or a return — needs an explicit adapter`);
  // A clause inside a method is written against the receiver, so `this` crosses
  // as the first argument when the clause actually reads it. Everything else a
  // clause takes from its scope is a manifest-declared capture: a case has no
  // parameter list of its own, and the switch's discriminant is rarely the
  // value the body wants.
  const shapeArgs = readsThis(n) ? ["this"] : [];
  return {
    shape: "switch-case",
    label,
    start: n.getStart(sf),
    end: n.getEnd(),
    original: sf.text.slice(n.getStart(sf), n.getEnd()),
    shapeArgs,
    render: (fn, args) =>
      exit === "break"
        ? `case ${test}:{globalThis.__reforge.${fn}(${args.join(",")});break}`
        : `case ${test}:{return globalThis.__reforge.${fn}(${args.join(",")})}`,
  };
}

/**
 * Resolve an anchor position to the span of its enclosing node of `shape`. The
 * walk takes the NEAREST enclosing node of that shape, so an anchor sitting
 * inside a nested callable excises the nested one — pick an anchor inside the
 * body you mean, and let the build's anchor-containment assert plus the gate's
 * solo sabotage catch it when you did not.
 */
export function excise(sf: ts.SourceFile, anchorIdx: number, shape: TargetShape): Excision {
  let node: ts.Node | undefined = deepestAt(sf, anchorIdx);
  for (; node; node = node.parent) {
    if (!matchesShape(node, shape)) continue;
    if (shape === "switch-case") return exciseCase(sf, node as ts.CaseClause);
    if (shape === "free-function") return exciseFunction(sf, node as ts.FunctionDeclaration);
    return exciseMethod(sf, node as ts.MethodDeclaration, shape);
  }
  throw new Error(`no enclosing ${shape} node above the anchor — re-check the target shape`);
}
