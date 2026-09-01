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

/**
 * The structural fingerprint of an excision target — the guard that stops the
 * nearest-enclosing-shape walk from silently selecting the wrong node (campaign
 * spec W0 fix, lens 1).
 *
 * The walk climbs from the anchor to the NEAREST node of the declared shape, so
 * an anchor that drifts into a same-shaped nested helper resolves to the inner
 * node and the build proceeds happily — a wrong-but-plausible splice. The
 * manifest therefore records what the operator VERIFIED at splice time, and the
 * build refuses a target that no longer matches.
 *
 * Shape of the signature, and why this one. It is built from exactly two facts,
 * both chosen for surviving minification churn:
 *
 *  - `params` — the selected callable's arity. Free of names and offsets.
 *  - `ancestry` — the SYNTAX KINDS of the enclosing shape-forming nodes,
 *    innermost first, up to the chunk top. Also free of names and offsets: a
 *    release that renames every binding leaves it untouched, and code motion
 *    within the same enclosing structure does not move it either.
 *
 * The two alternatives were rejected on that criterion. An enclosing NAME is
 * minified and churns per release (`hui` → `q6t` was exactly this campaign's
 * founding observation). A depth-from-chunk-top or an absolute AST path churns
 * with any insertion anywhere above the target — it would fire on nearly every
 * bump for reasons unrelated to the target.
 *
 * What it catches is precisely the defect: descending into a nested callable
 * necessarily prepends at least one function-like kind to `ancestry`, and a
 * same-shaped sibling of different arity moves `params`. What it deliberately
 * does not attempt is proving the target is semantically the same function —
 * that is the footprint hash's job (§5).
 */
export interface TargetSignature {
  /** parameter count of the selected callable (0 for a switch case) */
  params: number;
  /** enclosing shape-forming syntax kinds, innermost first, ending at SourceFile */
  ancestry: string[];
  /**
   * The target declarator's index in its `var`/`let`/`const` statement, for the
   * shapes whose target hangs off one (C5x, unit 2/4).
   *
   * DISAMBIGUATION ONLY, and recorded only by a row that needs it: the
   * permission pair `kye`/`von` are both 7-parameter arrows declared in one
   * three-declarator statement and both stamp `decideLocation:"pre-ask"`, so
   * `params` + `ancestry` tie and no literal separates them. Their positions in
   * the declaration list do not.
   *
   * A row that does not record one is not claiming a position, and comparison
   * skips it — so this never forces an index onto the shapes that never needed
   * one. When it IS recorded, an upstream edit to the declaration list makes the
   * build refuse rather than select a different sibling.
   */
  declarator?: number;
  /**
   * Set when the target is a generator — the delegation is `yield*` rather than
   * `return`, so this is not decoration: an upstream function that becomes (or
   * stops being) a generator needs a different delegation AND a differently
   * shaped owned module, and nothing else in the signature would notice.
   * Minification-stable, like the other two.
   */
  generator?: true;
}

export interface Excision {
  shape: TargetShape;
  /** what the node is called, for the build log and the footprint ledger */
  label: string;
  /** the selected AST node itself — the root of the capture inventory and the signature */
  node: ts.Node;
  /** the structural fingerprint the manifest row must agree with */
  signature: TargetSignature;
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
    // An arrow that IS a declarator's initializer. Deliberately not "any arrow":
    // the excision has to leave the declarator, its siblings and the statement's
    // `var` keyword exactly where they are, and only an initializer position
    // makes that a straight span replacement.
    case "arrow-initializer":
      return ts.isArrowFunction(n) && ts.isVariableDeclaration(n.parent) && n.parent.initializer === n;
    // A declarator whose initializer is a VALUE — the shape prompt text is
    // written in. Kept distinct from `arrow-initializer` rather than merged: the
    // delegation is an expression evaluated once at module init, not a callable
    // the graph invokes, so the two have different failure modes and deserve
    // different declarations.
    case "variable-declarator":
      return ts.isVariableDeclaration(n) && n.initializer !== undefined;
  }
}

/** Which declarator of its `var`/`let`/`const` statement this declaration is. */
function declaratorIndex(d: ts.VariableDeclaration): number {
  const list = d.parent;
  return ts.isVariableDeclarationList(list) ? list.declarations.indexOf(d) : 0;
}

const has = (n: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);

/** The node kinds `ancestry` keeps — the ones that give a target its structural place. */
const SHAPE_FORMING = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.SourceFile,
]);

/** @see TargetSignature */
export function signatureOf(node: ts.Node, params: number, extra: Partial<TargetSignature> = {}): TargetSignature {
  const ancestry: string[] = [];
  for (let n = node.parent; n; n = n.parent) {
    if (SHAPE_FORMING.has(n.kind)) ancestry.push(ts.SyntaxKind[n.kind]);
  }
  return { params, ancestry, ...extra };
}

export const sameSignature = (a: TargetSignature, b: TargetSignature) =>
  a.params === b.params &&
  a.ancestry.length === b.ancestry.length &&
  a.ancestry.every((k, i) => k === b.ancestry[i]) &&
  a.generator === b.generator &&
  // see `declarator`: an unrecorded index is not a claim, so it is not compared.
  (a.declarator === undefined || b.declarator === undefined || a.declarator === b.declarator);

export const formatSignature = (s: TargetSignature) =>
  `params=${s.params} ancestry=${s.ancestry.join("<")}${s.generator ? " generator" : ""}` +
  `${s.declarator === undefined ? "" : ` declarator=#${s.declarator}`}`;

/**
 * The target-identity guard. A mismatch is never auto-healed: re-verify which
 * node the anchor now lives in and update the manifest row deliberately.
 */
export function assertSignature(name: string, cut: Excision, expected: TargetSignature): void {
  if (sameSignature(cut.signature, expected)) return;
  throw new Error(
    `${name}: the anchor no longer resolves to the verified target.\n` +
      `  manifest signature: ${formatSignature(expected)}\n` +
      `  resolved  ${cut.shape} '${cut.label}': ${formatSignature(cut.signature)}\n` +
      `  Re-verify by hand WHICH node the anchor sits in (an anchor that drifted into a nested\n` +
      `  same-shaped helper resolves to the inner node), then update the row's signature on purpose.`,
  );
}

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
 * the remainder, but a NESTED pattern would change what the callee observes, so
 * that fails the build instead of being approximated.
 *
 * A COMPUTED property name is the same class of hazard and is refused for the
 * same reason (campaign spec W0 fix, lens 1): re-assembling `{[k()]:v}` into an
 * object literal puts `k()` in the delegation as well, so the key expression
 * runs TWICE — once binding the parameter, once building the forwarded object.
 * Reproducing it faithfully means hoisting the key to a temporary, which is an
 * adapter, not a mechanical re-assembly.
 *
 * A DEFAULT on a (non-nested) binding element is forwarded, not refused (C4 /
 * W1: the Grep result formatter's first parameter is
 * `{mode:e="files_with_matches", …}`, and refusing it would have blocked a
 * target on the proven shape). The reasoning the earlier refusal missed: the
 * delegation reproduces the ORIGINAL parameter list verbatim (`paramText`), so
 * the default is applied exactly once, in the adapter, before the bound name is
 * forwarded. The owned module is written against the same bound values the
 * original body used, so it observes precisely what the excised body observed —
 * the forwarded object differs from the CALLER's object, which is the point of a
 * default, not a divergence. A default inside a nested pattern is still refused,
 * because the nested pattern is.
 */
function paramArgs(label: string, params: ts.NodeArray<ts.ParameterDeclaration>): string[] {
  return params.map((p, i) => {
    const spread = p.dotDotDotToken ? "..." : "";
    if (ts.isIdentifier(p.name)) return `${spread}${p.name.text}`;
    const where = `${label}: parameter #${i}`;
    if (!ts.isObjectBindingPattern(p.name)) throw new Error(`${where} is an array pattern — delegation needs an explicit adapter`);
    const fields = p.name.elements.map((el) => {
      if (!ts.isIdentifier(el.name)) throw new Error(`${where} nests a binding pattern — delegation needs an explicit adapter`);
      if (el.propertyName && ts.isComputedPropertyName(el.propertyName)) {
        throw new Error(
          `${where} destructures a COMPUTED property name — forwarding it would evaluate the key expression a second time; delegation needs an explicit adapter`,
        );
      }
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
    node: n,
    signature: signatureOf(n, n.parameters.length),
    start: n.getStart(sf),
    end: n.getEnd(),
    original: sf.text.slice(n.getStart(sf), n.getEnd()),
    shapeArgs,
    render: (fn, args) => `${prefix}${name}(${params}){return globalThis.__reforge.${fn}(${args.join(",")})}`,
  };
}

/**
 * A free function, including the GENERATOR form (campaign spec C5x, unit 1).
 *
 * All eight of the engine's hook dispatchers are `async function*`, so W5 has no
 * target at all without this. A generator cannot delegate by `return`: the
 * caller drives it with `next`/`throw`/`return`, and a returned promise would
 * hand back a value where an async iterator is expected. `yield*` is the exact
 * transform — it iterates the delegate, forwards every `next` argument,
 * `throw()` and `return()` into it, and EVALUATES to the delegate's own return
 * value, which `return yield* …` then makes the outer generator's return value.
 * So the three things a generator's contract is made of — the yielded sequence,
 * the completion value, and two-way signalling — all cross the seam unchanged.
 *
 * The owned module must therefore itself be a generator function; a plain async
 * function returning an array would type-check nowhere and would break the first
 * caller that reads results as they arrive. `generator` is recorded in the
 * signature so an upstream target that stops being one fails the identity guard
 * rather than being spliced with the wrong delegation.
 */
function exciseFunction(sf: ts.SourceFile, n: ts.FunctionDeclaration): Excision {
  const name = n.name?.text;
  if (!name) throw new Error("free-function target has no name — cannot re-declare the binding");
  const generator = n.asteriskToken !== undefined;
  const params = paramText(sf, n.parameters);
  const prefix = has(n, ts.SyntaxKind.AsyncKeyword) ? "async " : "";
  return {
    shape: "free-function",
    label: name,
    node: n,
    signature: signatureOf(n, n.parameters.length, generator ? { generator: true } : {}),
    start: n.getStart(sf),
    end: n.getEnd(),
    original: sf.text.slice(n.getStart(sf), n.getEnd()),
    shapeArgs: paramArgs(name, n.parameters),
    render: (fn, args) =>
      generator
        ? `${prefix}function*${name}(${params}){return yield*globalThis.__reforge.${fn}(${args.join(",")})}`
        : `${prefix}function ${name}(${params}){return globalThis.__reforge.${fn}(${args.join(",")})}`,
  };
}

/**
 * An arrow function that initializes one declarator (campaign spec C5x, unit 2).
 *
 * The permission chain's entry points are written this way —
 * `Dd=async(…)=>{…},kye=async(…)=>{…},von=async(…)=>{…}` is ONE `var` statement
 * with three declarators — so W6 has no target without it. The excised span is
 * the ARROW, never the declarator and never the statement: the neighbours in the
 * list, the commas between them and the `var` keyword all belong to bindings
 * this row is not claiming, and taking them would silently rewrite two other
 * functions.
 *
 * Two things an arrow inherits from its enclosing scope make a body unmovable,
 * and both are refused rather than approximated. `this` is lexical, so a body
 * that reads it would see the owned module's `this` instead of the chunk's.
 * `arguments` is the same hazard and is invisible to the capture inventory,
 * which treats it as an ambient global — a function declaration binds its own,
 * so this is the one shape where that assumption is wrong.
 */
function exciseArrow(sf: ts.SourceFile, n: ts.ArrowFunction): Excision {
  const decl = n.parent as ts.VariableDeclaration;
  if (!ts.isIdentifier(decl.name)) throw new Error("arrow-initializer target is bound by a destructuring pattern — nothing to name the delegation after");
  const name = decl.name.text;
  if (readsThis(n)) throw new Error(`${name}: the arrow's body reads \`this\`, which it inherits lexically — the delegated body would see a different one`);
  if (/(?<![\w$])arguments(?![\w$])/.test(sf.text.slice(n.getStart(sf), n.getEnd()))) {
    throw new Error(`${name}: the arrow's body reads \`arguments\`, which it inherits from the enclosing function — delegation needs an explicit adapter`);
  }
  const params = paramText(sf, n.parameters);
  const prefix = has(n, ts.SyntaxKind.AsyncKeyword) ? "async " : "";
  return {
    shape: "arrow-initializer",
    label: name,
    node: n,
    signature: signatureOf(n, n.parameters.length, { declarator: declaratorIndex(decl) }),
    start: n.getStart(sf),
    end: n.getEnd(),
    original: sf.text.slice(n.getStart(sf), n.getEnd()),
    shapeArgs: paramArgs(name, n.parameters),
    render: (fn, args) => `${prefix}(${params})=>globalThis.__reforge.${fn}(${args.join(",")})`,
  };
}

/**
 * The VALUE of a purely literal expression, or null when it is not one.
 *
 * The `variable-declarator` shape exists for prompt text, and a prompt's value
 * IS its behaviour — the one class of upstream change that moves no anchor, no
 * target hash and no capture hash. So the build compares the owned module's
 * output against upstream's own bytes, which is the same argument chunk.ts's
 * rule 5 makes for a constant export, and strictly stronger than a differential:
 * it holds for a constant no scenario renders.
 *
 * "Literal" is deliberately narrow — strings, template literals whose
 * substitutions are themselves literal (upstream's minifier emits exactly that,
 * a constant fold), and their concatenations. Anything else returns null and the
 * build says it could not check rather than evaluating engine code to find out.
 */
export function literalStringValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const inner = literalStringValue(span.expression);
      if (inner === null) return null;
      out += inner + span.literal.text;
    }
    return out;
  }
  if (ts.isParenthesizedExpression(node)) return literalStringValue(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalStringValue(node.left);
    const right = literalStringValue(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/**
 * Grade a `variable-declarator` splice's VALUE against the pinned chunk's own
 * bytes — the build-time enforcement the shape exists for, extracted here so it
 * has fixture controls of its own (campaign spec C5x fix, finding 1).
 *
 * It lived inline in build.ts, which meant the one property the shape adds over
 * every other target — that a prompt whose wording moves while its name stays
 * put is caught — was asserted by nothing. `literalStringValue` had a control;
 * the comparison built on it did not, so a regression that widened the
 * not-a-literal path or inverted the equality would have gone green.
 *
 * ## The not-a-literal path REFUSES rather than downgrades
 *
 * The old code annotated a non-literal initializer `[value NOT literal — graded
 * differentially only]` and continued. That is a silent downgrade of the shape's
 * whole enforcement property, and it is the shape a widening regression would
 * hide behind: the row keeps building, the log line changes, nothing fails.
 *
 * So a non-literal initializer is a BUILD FAILURE unless the row adjudicates it
 * in writing, the same bargain `darkReason` strikes for a chunk export the
 * corpus cannot observe (chunk.ts): an ungraded value may exist, but only as a
 * reviewed carve-out recorded in the manifest and printed every build — never as
 * an accident. The reason has to name what grades the value instead, because
 * "graded differentially only" is a claim about the corpus, and the corpus is
 * exactly what cannot see a constant it never renders.
 *
 * `readOwned` is called only on the literal path, so an adjudicated row does not
 * import its module to prove a comparison it is not making.
 */
export async function gradeDeclaratorValue(args: {
  name: string;
  /** the excised initializer node */
  node: ts.Node;
  /** the row's written carve-out, when its initializer is not a plain literal */
  ungraded?: string;
  /** the owned module's live value for this row */
  readOwned: () => Promise<unknown>;
}): Promise<string> {
  const { name, node, ungraded, readOwned } = args;
  const upstream = literalStringValue(node);
  if (upstream === null) {
    if (ungraded === undefined) {
      throw new Error(
        `${name}: the variable-declarator initializer is NOT a plain literal, so its value cannot be compared against ` +
          `the pinned chunk's bytes — and that comparison is the only thing in the mechanism that can see a constant whose ` +
          `VALUE moves while its name stays put (no anchor, no target hash and no capture hash move with it).\n` +
          `  Either narrow the target to a literal-valued declarator, or adjudicate it in writing: set 'valueUngraded' on ` +
          `the manifest row, naming what grades the value instead. Silently downgrading to "differential only" is refused — ` +
          `the corpus cannot see a constant no scenario renders.`,
      );
    }
    return `value NOT literal — UNGRADED, adjudicated: ${ungraded}`;
  }
  const owned = await readOwned();
  if (owned !== upstream) {
    const at = typeof owned === "string" ? [...upstream].findIndex((c, i) => owned[i] !== c) : -1;
    throw new Error(
      `${name}: the owned value is not the pinned chunk's.\n` +
        `  upstream: ${upstream.length} chars, owned: ${typeof owned === "string" ? `${owned.length} chars` : typeof owned}\n` +
        (at >= 0
          ? `  first difference at ${at}: upstream ${JSON.stringify(upstream.slice(at, at + 60))} vs owned ${JSON.stringify(String(owned).slice(at, at + 60))}\n`
          : "") +
        `  A constant whose VALUE moves while its name stays put moves no anchor and no footprint hash; this comparison is what sees it.`,
    );
  }
  return `value verified: ${upstream.length} chars`;
}

/**
 * A top-level constant's INITIALIZER (campaign spec C5x, unit 3).
 *
 * The engine's prompt text is not in functions — it is in `var` initializers:
 * the compaction summarization prompt, the identity lines, the reporting-outcome
 * section. Every one of them is a constant whose VALUE is the behaviour, which
 * is the class of change nothing else in the mechanism can see (a prompt whose
 * wording moves while its name stays put moves no anchor, no target hash and no
 * capture hash). Owning the initializer converts each into an equality-asserted
 * primitive AND makes it customizable, which under this campaign's strategy is
 * the same act.
 *
 * The excised span is the initializer alone, so the declarator, its siblings and
 * the `var` keyword are untouched — same rule as the arrow shape, and for the
 * same reason. The delegation is an EXPRESSION: `globalThis.__reforge.fn(…)`,
 * evaluated once when the chunk body runs. That is safe because the reforge
 * module is injected as an `import`, and ESM evaluates a module's dependencies
 * before its own body — the same ordering every other splice already relies on.
 *
 * A function-like initializer is refused rather than accepted: an arrow belongs
 * to `arrow-initializer`, whose delegation is a callable the graph invokes per
 * call rather than a value computed once.
 */
function exciseVariable(sf: ts.SourceFile, decl: ts.VariableDeclaration): Excision {
  if (!ts.isIdentifier(decl.name)) throw new Error("variable-declarator target is bound by a destructuring pattern — nothing to name the delegation after");
  const name = decl.name.text;
  const init = decl.initializer!;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init)) {
    throw new Error(
      `${name}: the initializer is a ${ts.SyntaxKind[init.kind]} — a value delegation would evaluate it once at module init. ` +
        `Use the arrow-initializer shape (or a class/function target), not variable-declarator.`,
    );
  }
  return {
    shape: "variable-declarator",
    label: name,
    node: init,
    signature: signatureOf(init, 0, { declarator: declaratorIndex(decl) }),
    start: init.getStart(sf),
    end: init.getEnd(),
    original: sf.text.slice(init.getStart(sf), init.getEnd()),
    shapeArgs: [],
    render: (fn, args) => `globalThis.__reforge.${fn}(${args.join(",")})`,
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
    node: n,
    signature: signatureOf(n, 0),
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
 * inside a nested callable resolves to the nested one. That is not left to the
 * gate to notice: every excision carries a {@link TargetSignature}, and the
 * build checks it against the one the manifest row recorded at splice time
 * ({@link assertSignature}).
 */
/**
 * Which of several same-anchored nodes the row means (campaign spec C5x, unit 4).
 *
 * The anchor rule was "true-substring-unique", full stop, and for one occurrence
 * that is still exactly what happens: excise it and let {@link assertSignature}
 * speak if it drifted. But a chunk can carry the same literal in two nodes for
 * reasons that are not drift — a shared prompt preamble, a decision value the
 * caller and the callee both stamp — and `coLiteral` scopes to a chunk, so it
 * cannot separate siblings inside one.
 *
 * The signature already knows how to tell same-shaped nodes apart; it just never
 * got to CHOOSE, only to verify after the fact. Here it chooses. Two properties
 * keep that from weakening the doctrine:
 *
 *  - a row must DECLARE `siblings: n` to enter this path at all (anchor.ts), so
 *    an anchor that silently stops being unique after a bump still fails loudly
 *    rather than being auto-selected;
 *  - a signature that matches two candidates is a TIE, and a tie throws. Picking
 *    the first would be exactly the coin flip the uniqueness rule exists to
 *    forbid.
 *
 * A candidate the transform cannot excise at all (wrong enclosing shape, a
 * refused parameter pattern) is not a match, but its reason is carried into the
 * failure — "no candidate matched" is unactionable if one of them was the target
 * and merely unexcisable.
 */
export function selectExcision(
  name: string,
  sf: ts.SourceFile,
  offsets: readonly number[],
  shape: TargetShape,
  expected: TargetSignature,
): Excision {
  if (offsets.length === 0) throw new Error(`${name}: no anchor offset to excise from`);
  if (offsets.length === 1) return excise(sf, offsets[0], shape);

  const candidates = offsets.map((offset) => {
    try {
      return { offset, cut: excise(sf, offset, shape) };
    } catch (e) {
      return { offset, why: (e as Error).message.split("\n")[0] };
    }
  });
  const matches = candidates.filter((c) => c.cut && sameSignature(c.cut.signature, expected));
  if (matches.length === 1) return matches[0].cut!;

  const listed = candidates
    .map((c) => `    @${c.offset} ${c.cut ? `${c.cut.shape} '${c.cut.label}': ${formatSignature(c.cut.signature)}` : `not excisable — ${c.why}`}`)
    .join("\n");
  throw new Error(
    matches.length === 0
      ? `${name}: none of the ${candidates.length} same-anchored candidates matches the verified signature.\n` +
        `  manifest signature: ${formatSignature(expected)}\n${listed}\n` +
        `  Re-verify which node the anchor names now, then update the row deliberately.`
      : `${name}: the anchor and the signature TIE across ${matches.length} candidates — selection would be a coin flip.\n` +
        `  manifest signature: ${formatSignature(expected)}\n${listed}\n` +
        `  Separate them with a structural fact the signature carries, or find a literal only the target has.`,
  );
}

export function excise(sf: ts.SourceFile, anchorIdx: number, shape: TargetShape): Excision {
  let node: ts.Node | undefined = deepestAt(sf, anchorIdx);
  for (; node; node = node.parent) {
    if (!matchesShape(node, shape)) continue;
    if (shape === "switch-case") return exciseCase(sf, node as ts.CaseClause);
    if (shape === "free-function") return exciseFunction(sf, node as ts.FunctionDeclaration);
    if (shape === "arrow-initializer") return exciseArrow(sf, node as ts.ArrowFunction);
    if (shape === "variable-declarator") return exciseVariable(sf, node as ts.VariableDeclaration);
    return exciseMethod(sf, node as ts.MethodDeclaration, shape);
  }
  throw new Error(`no enclosing ${shape} node above the anchor — re-check the target shape`);
}
