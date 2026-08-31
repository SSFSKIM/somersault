// Lexical scope analysis over an excised span — the INDEPENDENT capture
// inventory, and the declaration resolver behind the footprint's closure
// surface.
//
// Why this exists (campaign spec W0 fix, lens 1). Two mechanism holes shared one
// root cause: nothing in the build derived what a spliced body actually takes
// from its enclosing scope. The manifest's `captures` were the only inventory,
// and an inventory that only checks itself cannot be INCOMPLETE-detected —
// deleting a row's captures made the build quieter, not louder. And the
// footprint hashed only the excised span, so a change to a captured declaration
// living OUTSIDE that span (a constant's value, a helper's body) left the hash
// unchanged, silently violating §5's staleness contract.
//
// Both are answered by the same analysis: walk the excised subtree with a real
// scope chain, and every identifier that resolves to no binding inside it is a
// free variable — a value the body takes from the graph. That set is derived
// from the AST alone, so it is independent of what the manifest claims, and each
// free name can then be resolved UPWARD through the chunk's scopes to the
// declaration whose bytes the footprint must cover.
//
// Scoping fidelity, stated honestly: `let`/`const`/`class` bind at their block,
// `var` and function declarations hoist to the nearest function scope, function
// and class expressions bind their own name, catch clauses bind their parameter,
// and parameter destructuring binds every element. TDZ is not modelled (it
// cannot change WHICH binding a name resolves to, only whether reading it
// throws). What is deliberately NOT treated as a reference: member names
// (`a.b`), non-computed property and class-member names, binding-element
// property names, and `break`/`continue`/label names.
import ts from "typescript";

/**
 * Names an excised body may reference without capturing anything from the
 * graph. Explicit rather than heuristic: an unknown identifier must be reported
 * free so the operator classifies it deliberately, and the cost of that
 * strictness is one line here when a body legitimately reaches a global we have
 * not met before.
 *
 * Scoped to what a bun-compiled ESM engine chunk can actually see: the ES
 * intrinsics, the WHATWG/web globals bun exposes, and node's globals.
 */
export const AMBIENT_GLOBALS: ReadonlySet<string> = new Set([
  // language + ES intrinsics
  "globalThis", "undefined", "NaN", "Infinity", "arguments", "eval",
  "Object", "Function", "Boolean", "Symbol", "Array", "Number", "BigInt", "String", "Math", "Date", "RegExp",
  "JSON", "Promise", "Proxy", "Reflect", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry",
  "Error", "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError",
  "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "Intl",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent", "escape", "unescape",
  // WHATWG / web platform globals bun ships
  "console", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal",
  "Event", "EventTarget", "CustomEvent", "MessageChannel", "MessagePort", "Blob", "File", "FormData",
  "Headers", "Request", "Response", "fetch", "WebSocket", "Worker", "BroadcastChannel",
  "ReadableStream", "WritableStream", "TransformStream", "CompressionStream", "DecompressionStream",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate",
  "queueMicrotask", "structuredClone", "reportError", "performance", "crypto", "atob", "btoa",
  // node globals
  "process", "Buffer", "global", "require", "module", "exports", "__dirname", "__filename",
  "URLPattern", "navigator", "Bun",
]);

// ---- binding collection ------------------------------------------------------

function bindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    bindingNames(el.name, into);
  }
}

function isFunctionLike(n: ts.Node): n is ts.SignatureDeclaration & { body?: ts.Node } {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  );
}

const isLexical = (flags: ts.NodeFlags) => (flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0;

function importNames(d: ts.ImportDeclaration, into: Set<string>): void {
  const c = d.importClause;
  if (!c) return;
  if (c.name) into.add(c.name.text);
  if (!c.namedBindings) return;
  if (ts.isNamespaceImport(c.namedBindings)) into.add(c.namedBindings.name.text);
  else for (const s of c.namedBindings.elements) into.add(s.name.text);
}

/** `var` + function declarations, hoisted to the nearest FUNCTION scope. */
function hoistVars(body: ts.Node, into: Set<string>): void {
  const visit = (n: ts.Node): void => {
    if (isFunctionLike(n)) {
      if (ts.isFunctionDeclaration(n) && n.name) into.add(n.name.text);
      return; // a nested function's own vars belong to its own scope
    }
    if (ts.isClassLike(n)) return;
    if (ts.isVariableDeclarationList(n) && !isLexical(n.flags)) {
      for (const d of n.declarations) bindingNames(d.name, into);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
}

/** `let`/`const`/`class`/`function`/`import` declared directly in this block. */
function hoistLexical(statements: readonly ts.Statement[], into: Set<string>): void {
  for (const s of statements) {
    if (ts.isVariableStatement(s) && isLexical(s.declarationList.flags)) {
      for (const d of s.declarationList.declarations) bindingNames(d.name, into);
    } else if ((ts.isClassDeclaration(s) || ts.isFunctionDeclaration(s)) && s.name) {
      into.add(s.name.text);
    } else if (ts.isImportDeclaration(s)) {
      importNames(s, into);
    }
  }
}

// ---- the walk ----------------------------------------------------------------

interface Scope {
  parent: Scope | null;
  names: Set<string>;
}

const bound = (scope: Scope | null, name: string): boolean => {
  for (let s = scope; s; s = s.parent) if (s.names.has(name)) return true;
  return false;
};

/**
 * Every identifier the subtree rooted at `root` reads but does not itself
 * declare, minus {@link AMBIENT_GLOBALS}. Insertion-ordered by first reference.
 *
 * A function-shaped root binds its own parameters and its own name, so the
 * delegation's parameters never appear here; a case clause has no parameters,
 * so everything it touches does.
 */
export function freeIdentifiers(root: ts.Node): string[] {
  const free = new Map<string, true>();

  const reference = (name: ts.Identifier, scope: Scope): void => {
    if (!bound(scope, name.text) && !AMBIENT_GLOBALS.has(name.text)) free.set(name.text, true);
  };

  const visit = (n: ts.Node, scope: Scope): void => {
    // --- scope-forming nodes ---
    if (isFunctionLike(n)) {
      const inner: Scope = { parent: scope, names: new Set() };
      if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name) inner.names.add(n.name.text);
      for (const p of n.parameters) bindingNames(p.name, inner.names);
      // A method/accessor's own name is a property, not a binding — but a
      // COMPUTED one is an expression evaluated in the OUTER scope.
      const named = ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
      if (named && ts.isComputedPropertyName(n.name)) visit(n.name.expression, scope);
      // Defaults and computed keys inside the parameter list see the parameters.
      for (const p of n.parameters) visitPatternExtras(p.name, inner);
      for (const p of n.parameters) if (p.initializer) visit(p.initializer, inner);
      if (n.body) {
        hoistVars(n.body, inner.names);
        if (ts.isBlock(n.body)) {
          hoistLexical(n.body.statements, inner.names);
          for (const s of n.body.statements) visit(s, inner);
        } else {
          visit(n.body, inner);
        }
      }
      return;
    }

    if (ts.isClassLike(n)) {
      const inner: Scope = { parent: scope, names: new Set() };
      if (n.name) inner.names.add(n.name.text);
      if (n.heritageClauses) for (const h of n.heritageClauses) visit(h, scope);
      for (const m of n.members) visit(m, inner);
      return;
    }

    if (ts.isBlock(n) || ts.isModuleBlock(n)) {
      const inner: Scope = { parent: scope, names: new Set() };
      hoistLexical(n.statements, inner.names);
      for (const s of n.statements) visit(s, inner);
      return;
    }

    if (ts.isCaseClause(n) || ts.isDefaultClause(n)) {
      if (ts.isCaseClause(n)) visit(n.expression, scope);
      const inner: Scope = { parent: scope, names: new Set() };
      hoistLexical(n.statements, inner.names);
      for (const s of n.statements) visit(s, inner);
      return;
    }

    if (ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n)) {
      const inner: Scope = { parent: scope, names: new Set() };
      const init = n.initializer;
      if (init && ts.isVariableDeclarationList(init)) {
        for (const d of init.declarations) bindingNames(d.name, inner.names);
        for (const d of init.declarations) {
          visitPatternExtras(d.name, inner);
          if (d.initializer) visit(d.initializer, inner);
        }
      } else if (init) {
        visit(init, inner);
      }
      if (ts.isForStatement(n)) {
        if (n.condition) visit(n.condition, inner);
        if (n.incrementor) visit(n.incrementor, inner);
      } else {
        visit(n.expression, inner);
      }
      visit(n.statement, inner);
      return;
    }

    if (ts.isCatchClause(n)) {
      const inner: Scope = { parent: scope, names: new Set() };
      if (n.variableDeclaration) {
        bindingNames(n.variableDeclaration.name, inner.names);
        visitPatternExtras(n.variableDeclaration.name, inner);
      }
      visit(n.block, inner);
      return;
    }

    // --- declarations: the NAME binds, the initializer reads ---
    if (ts.isVariableDeclaration(n)) {
      bindingNames(n.name, scope.names); // hoisted already; idempotent
      visitPatternExtras(n.name, scope);
      if (n.initializer) visit(n.initializer, scope);
      return;
    }

    // --- non-reference identifier positions ---
    if (ts.isPropertyAccessExpression(n)) {
      visit(n.expression, scope); // `.name` is a member, never a binding
      return;
    }
    if (ts.isPropertyAssignment(n)) {
      if (ts.isComputedPropertyName(n.name)) visit(n.name.expression, scope);
      visit(n.initializer, scope);
      return;
    }
    if (ts.isPropertyDeclaration(n)) {
      if (ts.isComputedPropertyName(n.name)) visit(n.name.expression, scope);
      if (n.initializer) visit(n.initializer, scope);
      return;
    }
    if (ts.isBreakStatement(n) || ts.isContinueStatement(n)) return; // the label is not a binding
    if (ts.isLabeledStatement(n)) {
      visit(n.statement, scope);
      return;
    }
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isMetaProperty(n)) return;

    if (ts.isIdentifier(n)) {
      reference(n, scope);
      return;
    }

    ts.forEachChild(n, (c) => visit(c, scope));
  };

  /** Computed keys and defaults inside a binding pattern read the surrounding scope. */
  function visitPatternExtras(name: ts.BindingName, scope: Scope): void {
    if (ts.isIdentifier(name)) return;
    for (const el of name.elements) {
      if (ts.isOmittedExpression(el)) continue;
      if (el.propertyName && ts.isComputedPropertyName(el.propertyName)) visit(el.propertyName.expression, scope);
      if (el.initializer) visit(el.initializer, scope);
      visitPatternExtras(el.name, scope);
    }
  }

  visit(root, { parent: null, names: new Set() });
  return [...free.keys()];
}

// ---- the capture-inventory contract ------------------------------------------

/** The root binding a derived capture identifier names (`a.platform` → `a`). */
export const captureRoot = (identifier: string) => identifier.split(".")[0];

/**
 * The manifest's `captures` must be EXACTLY the excised body's free variables —
 * neither a subset nor a superset (campaign spec W0 fix, lens 1).
 *
 * Before this check the manifest was its own only witness: the build derived
 * the captures the manifest declared and verified those, so DELETING a row's
 * captures made the build quieter rather than louder. An omitted capture is not
 * caught by the corpus either when the identifier it forgot is only read on a
 * branch the scenarios never take — text-delta's telemetry helpers sit on the
 * type-mismatch arm, which a healthy stream never reaches.
 *
 * Superset detection matters equally: a phantom capture means the manifest is
 * describing a body that is no longer there, and its `derive` regex is matching
 * something incidental.
 *
 * `captures: []` is therefore a positive claim — "this body has no free
 * variables, verified" — not an omission.
 */
export function assertCaptureInventory(name: string, node: ts.Node, declared: readonly string[]): string[] {
  const free = freeIdentifiers(node);
  const roots = new Set(declared.map(captureRoot));
  const missing = free.filter((f) => !roots.has(f));
  const phantom = [...roots].filter((d) => !free.includes(d));
  if (missing.length === 0 && phantom.length === 0) return free;
  const lines = [`${name}: the manifest's capture inventory does not match the excised body's free variables.`];
  if (missing.length > 0) {
    lines.push(`  UNDECLARED (the body reads them, the manifest does not list them): ${missing.join(", ")}`);
    lines.push(`    -> the delegation would reference bindings it was never passed. Declare each with a derivation and a §2.4 class.`);
  }
  if (phantom.length > 0) {
    lines.push(`  PHANTOM (declared, but the body does not read them): ${phantom.join(", ")}`);
    lines.push(`    -> the derivation matched something incidental, or the upstream body moved. Re-verify the target.`);
  }
  lines.push(`  free variables found: ${free.length > 0 ? free.join(", ") : "(none)"}`);
  throw new Error(lines.join("\n"));
}

// ---- declaration resolution --------------------------------------------------

export interface Declaration {
  /** the span of the declaring node, in the chunk the excision came from */
  start: number;
  end: number;
  /**
   * The declaring node itself. Carried so a caller can KEEP WALKING from a
   * declaration it resolved — which is what the footprint's transitive closure
   * does (campaign spec W1 fix): an owned pure helper's own callees are part of
   * the behaviour the owned module replaced, so their declarations have to be
   * resolvable, not merely hashable.
   */
  node: ts.Node;
  /** what kind of declaration it is, for the footprint's readability */
  kind: "variable" | "function" | "class" | "parameter" | "import" | "catch";
  /** set when the binding is an import — the specifier the declaration lives behind */
  moduleSpecifier?: string;
  /** the imported name (which may differ from the local one via `as`) */
  importedName?: string;
}

/**
 * Walk UPWARD from `from` looking for the declaration of `name`. Returns the
 * innermost declaring node's span — which is what §5's staleness contract has to
 * hash, because that is where a captured value's bytes actually live.
 */
export function resolveDeclaration(sf: ts.SourceFile, from: ts.Node, name: string): Declaration | null {
  for (let node: ts.Node | undefined = from; node; node = node.parent) {
    const found = declaredIn(node, name, sf);
    if (found) return found;
  }
  return null;
}

const spanOf = (sf: ts.SourceFile) => (n: ts.Node, kind: Declaration["kind"], extra?: Partial<Declaration>): Declaration => ({
  start: n.getStart(sf),
  end: n.getEnd(),
  node: n,
  kind,
  ...extra,
});

/** Does this node's own scope declare `name`? If so, where. */
function declaredIn(node: ts.Node, name: string, sf: ts.SourceFile): Declaration | null {
  const span = spanOf(sf);
  const declares = (b: ts.BindingName): boolean => {
    const names = new Set<string>();
    bindingNames(b, names);
    return names.has(name);
  };

  if (isFunctionLike(node)) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name?.text === name) {
      return span(node, "function");
    }
    for (const p of node.parameters) if (declares(p.name)) return span(p, "parameter");
    return node.body && ts.isBlock(node.body) ? scanStatements(node.body.statements, name, sf, true) : null;
  }
  if (ts.isClassLike(node)) return node.name?.text === name ? span(node, "class") : null;
  if (ts.isCatchClause(node)) {
    const v = node.variableDeclaration;
    return v && declares(v.name) ? span(v, "catch") : null;
  }
  if (ts.isSourceFile(node)) return scanStatements(node.statements, name, sf, true);
  if (ts.isBlock(node) || ts.isModuleBlock(node)) return scanStatements(node.statements, name, sf, false);
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return scanStatements(node.statements, name, sf, false);
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const init = node.initializer;
    if (init && ts.isVariableDeclarationList(init)) {
      for (const d of init.declarations) if (declares(d.name)) return span(d, "variable");
    }
    return null;
  }
  return null;
}

/**
 * Statements of one scope. `deep` also walks nested blocks for `var` and
 * function declarations (they hoist to the function or module scope); shallow
 * stops at this block's own `let`/`const`/`class`.
 */
function scanStatements(
  statements: readonly ts.Statement[],
  name: string,
  sf: ts.SourceFile,
  deep: boolean,
): Declaration | null {
  const span = spanOf(sf);
  let hit: Declaration | null = null;
  const consider = (s: ts.Node): void => {
    if (hit) return;
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const names = new Set<string>();
        bindingNames(d.name, names);
        if (names.has(name)) hit = span(d, "variable");
      }
    } else if (ts.isFunctionDeclaration(s) && s.name?.text === name) {
      hit = span(s, "function");
    } else if (ts.isClassDeclaration(s) && s.name?.text === name) {
      hit = span(s, "class");
    } else if (ts.isImportDeclaration(s)) {
      const local = importSpecifierFor(s, name);
      if (local) {
        hit = span(local.node, "import", {
          moduleSpecifier: ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : undefined,
          importedName: local.imported,
        });
      }
    }
  };
  for (const s of statements) {
    consider(s);
    if (hit) return hit;
    if (deep) {
      // var/function declarations hoist out of nested blocks, loops and try/catch
      const descend = (n: ts.Node): void => {
        if (hit || isFunctionLike(n) || ts.isClassLike(n)) return;
        if (ts.isVariableStatement(n) && !isLexical(n.declarationList.flags)) consider(n);
        ts.forEachChild(n, descend);
      };
      ts.forEachChild(s, descend);
      if (hit) return hit;
    }
  }
  return hit;
}

function importSpecifierFor(d: ts.ImportDeclaration, name: string): { node: ts.Node; imported: string } | null {
  const c = d.importClause;
  if (!c) return null;
  if (c.name?.text === name) return { node: c.name, imported: "default" };
  if (!c.namedBindings) return null;
  if (ts.isNamespaceImport(c.namedBindings)) {
    return c.namedBindings.name.text === name ? { node: c.namedBindings, imported: "*" } : null;
  }
  for (const s of c.namedBindings.elements) {
    if (s.name.text === name) return { node: s, imported: (s.propertyName ?? s.name).text };
  }
  return null;
}

/**
 * Find where an exporting chunk declares `name` — the far side of an imported
 * capture. Only the top level is searched: that is the only scope an ES module
 * can export from.
 */
export function resolveExport(sf: ts.SourceFile, name: string): Declaration | null {
  // `export { w, c }` re-points a local name; follow the alias first.
  let local = name;
  for (const s of sf.statements) {
    if (!ts.isExportDeclaration(s) || !s.exportClause || !ts.isNamedExports(s.exportClause)) continue;
    for (const el of s.exportClause.elements) {
      if (el.name.text === name) local = (el.propertyName ?? el.name).text;
    }
  }
  return scanStatements(sf.statements, local, sf, true);
}
