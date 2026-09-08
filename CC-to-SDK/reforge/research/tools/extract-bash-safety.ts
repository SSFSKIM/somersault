// C13b / W10b — derive the Bash command-safety population from the pinned graph.
//
//   npx tsx research/tools/extract-bash-safety.ts [--check]
//
// The W10 scout names two coarse byte ranges. They are a map, not an ownership
// proof: one range ends in the middle of a multi-declarator statement and both
// contain declarations whose callers live outside this leaf. This fixture makes
// the denominator mechanical. It records the exact enclosing statement spans,
// every top-level declaration in them, the six approved anchored roots, and the
// eleven owned flag/effect tables. C13b's README record adjudicates declarations
// that are not in an owned root's closure; this tool ensures none can disappear
// from that adjudication unnoticed on a pin bump.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";
import { freeIdentifiers } from "../../strangle/scope.js";
import { BASH_DECISION_ROOTS } from "../../strangle/bash-compound-safety-capture-specs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", `bash-safety-${ENGINE_VERSION}.json`);
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const byteAt = (source: string, at: number): number => Buffer.byteLength(source.slice(0, at), "utf8");

interface ModuleFile {
  file: string;
  source: string;
  sf: ts.SourceFile;
}

function graph(): ModuleFile[] {
  return readdirSync(BUNDLE_MODULES)
    .filter((file) => file.endsWith(".js"))
    .sort()
    .map((file) => {
      const source = readFileSync(join(BUNDLE_MODULES, file), "utf8");
      return { file, source, sf: ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS) };
    });
}

function uniqueCarrier(modules: ModuleFile[], literals: readonly string[]): ModuleFile {
  const hits = modules.filter((m) => literals.every((literal) => m.source.includes(literal)));
  if (hits.length !== 1) throw new Error(`expected one module carrying ${literals.join(" + ")}, found ${hits.map((h) => h.file).join(", ") || "none"}`);
  return hits[0];
}

function uniqueAnchor(modules: ModuleFile[], anchor: string): { module: ModuleFile; offset: number } {
  const hits: { module: ModuleFile; offset: number }[] = [];
  for (const module of modules) {
    let from = 0;
    for (;;) {
      const offset = module.source.indexOf(anchor, from);
      if (offset < 0) break;
      hits.push({ module, offset });
      from = offset + Math.max(1, anchor.length);
    }
  }
  if (hits.length !== 1) throw new Error(`anchor ${JSON.stringify(anchor)} occurs ${hits.length} times graph-wide`);
  return hits[0];
}

function uniqueAnchorIn(module: ModuleFile, anchor: string): { module: ModuleFile; offset: number } {
  const first = module.source.indexOf(anchor);
  if (first < 0 || module.source.indexOf(anchor, first + Math.max(1, anchor.length)) >= 0) {
    throw new Error(`anchor ${JSON.stringify(anchor)} is not unique in ${module.file}`);
  }
  return { module, offset: first };
}

function topLevelStatementAt(module: ModuleFile, offset: number): ts.Statement {
  const hit = module.sf.statements.find((statement) => statement.getStart(module.sf) <= offset && offset < statement.end);
  if (!hit) throw new Error(`${module.file}: no top-level statement contains offset ${offset}`);
  return hit;
}

function enclosingFunction(module: ModuleFile, offset: number): ts.FunctionDeclaration {
  let deepest: ts.Node = module.sf;
  const visit = (node: ts.Node): void => {
    if (node.getStart(module.sf) <= offset && node.end >= offset) {
      deepest = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(module.sf);
  for (let node: ts.Node | undefined = deepest; node; node = node.parent) {
    if (ts.isFunctionDeclaration(node) && node.name) return node;
  }
  throw new Error(`${module.file}: anchor at ${offset} is not inside a named top-level function`);
}

function declaratorNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : declaratorNames(element.name)));
}

function statementKind(statement: ts.Statement): string {
  if (ts.isVariableStatement(statement)) return "VariableStatement";
  if (ts.isExpressionStatement(statement)) return "ExpressionStatement";
  return ts.SyntaxKind[statement.kind];
}

function region(module: ModuleFile, start: number, end: number, scout: { start: number; end: number }) {
  const statements = module.sf.statements.filter((statement) => statement.getStart(module.sf) >= start && statement.end <= end);
  const declarations: Record<string, unknown>[] = [];
  let functions = 0;
  let classes = 0;
  let variableStatements = 0;
  let variableDeclarators = 0;
  let imports = 0;
  let expressions = 0;
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions++;
      declarations.push(span(module, statement.name.text, "function", statement));
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      classes++;
      declarations.push(span(module, statement.name.text, "class", statement));
    } else if (ts.isVariableStatement(statement)) {
      variableStatements++;
      for (const declaration of statement.declarationList.declarations) {
        variableDeclarators++;
        for (const name of declaratorNames(declaration.name)) declarations.push(span(module, name, "variable", declaration));
      }
    } else if (ts.isImportDeclaration(statement)) {
      imports++;
      declarations.push(span(module, `<import:${statement.getStart(module.sf)}>`, "import", statement));
    } else if (ts.isExpressionStatement(statement)) {
      expressions++;
      declarations.push(span(module, `<expression:${statement.getStart(module.sf)}>`, "expression", statement));
    } else {
      declarations.push(span(module, `<${statementKind(statement)}:${statement.getStart(module.sf)}>`, statementKind(statement), statement));
    }
  }
  return {
    file: module.file,
    fileSha256: sha256(module.source),
    scoutRange: scout,
    exactStatementRange: { start, end, bytes: byteAt(module.source, end) - byteAt(module.source, start) },
    counts: { statements: statements.length, functions, classes, variableStatements, variableDeclarators, imports, expressions, declarations: declarations.length },
    declarations,
  };
}

function span(module: ModuleFile, name: string, kind: string, node: ts.Node) {
  const start = node.getStart(module.sf);
  const end = node.end;
  const text = module.source.slice(start, end);
  return { name, kind, start, end, byteStart: byteAt(module.source, start), byteEnd: byteAt(module.source, end), sha256: sha256(text) };
}

function objectKeys(object: ts.ObjectLiteralExpression): string[] {
  return object.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) return ["..."];
    const name = property.name;
    if (!name) return [];
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return [name.text];
    return [name.getText()];
  });
}

function variableDeclarators(module: ModuleFile): ts.VariableDeclaration[] {
  return module.sf.statements.flatMap((statement) =>
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
  );
}

function namedTopLevelDeclarations(module: ModuleFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  for (const statement of module.sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) out.set(statement.name.text, statement);
    else if (ts.isClassDeclaration(statement) && statement.name) out.set(statement.name.text, statement);
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) out.set(declaration.name.text, declaration);
      }
    }
  }
  return out;
}

function transitiveDeclarations(module: ModuleFile, seeds: readonly string[]) {
  const declarations = namedTopLevelDeclarations(module);
  const seen = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    const declaration = declarations.get(name);
    if (!declaration) continue;
    seen.add(name);
    for (const dependency of freeIdentifiers(declaration)) {
      if (declarations.has(dependency) && !seen.has(dependency)) queue.push(dependency);
    }
  }
  return [...seen].map((name) => ({
    file: module.file,
    ...span(module, name, "table-dependency", declarations.get(name)!),
  }));
}

function exclusionGroup(module: ModuleFile, role: string, names: readonly string[], reason: string) {
  const declarations = namedTopLevelDeclarations(module);
  const rows = names.map((name) => {
    const declaration = declarations.get(name);
    if (!declaration) throw new Error(`${module.file}: exclusion ${role} lost declaration ${name}`);
    return span(module, name, "excluded", declaration);
  });
  return {
    role,
    file: module.file,
    start: Math.min(...rows.map((row) => row.start)),
    end: Math.max(...rows.map((row) => row.end)),
    names: rows.map((row) => row.name),
    reason,
  };
}

function tableBy(module: ModuleFile, role: string, predicate: (init: ts.Expression, text: string) => boolean) {
  const hits = variableDeclarators(module).filter((declaration) => {
    const init = declaration.initializer;
    return init !== undefined && predicate(init, init.getText(module.sf));
  });
  if (hits.length !== 1) throw new Error(`${module.file}: table role ${role} matched ${hits.length} declarators`);
  const declaration = hits[0];
  if (!ts.isIdentifier(declaration.name)) throw new Error(`${role}: expected an identifier binding`);
  const init = declaration.initializer!;
  return {
    role,
    file: module.file,
    binding: declaration.name.text,
    ...span(module, declaration.name.text, "table", declaration),
    valueSha256: sha256(init.getText(module.sf)),
    valueBytes: byteAt(module.source, init.end) - byteAt(module.source, init.getStart(module.sf)),
    keys: ts.isObjectLiteralExpression(init) ? objectKeys(init) : [],
  };
}

const modules = graph();
const engine = uniqueCarrier(modules, ["Command too long for read-only analysis", "This command uses shell operators that require approval for safety", "Base command not found"]);
const classifier = uniqueCarrier(modules, ["Contains lone surrogate", "Parser did not consume trailing input", "Heredoc body was not scanned by the parser"]);

// The scout offsets are pinned observations, and one ends in the middle of a
// multi-declarator statement. Snap each endpoint to the containing top-level
// AST statement rather than inventing a semantic end marker from an incidental
// table entry. Root/table anchors below are the semantic drift guards; these
// numbers define only which coarse scout population is being accounted for.
const ENGINE_SCOUT = { start: 890_302, end: 1_015_200 };
const CLASSIFIER_SCOUT = { start: 108_945, end: 162_000 };
const engineStart = topLevelStatementAt(engine, ENGINE_SCOUT.start).getStart(engine.sf);
const engineEnd = topLevelStatementAt(engine, ENGINE_SCOUT.end - 1).end;
const classifierStart = topLevelStatementAt(classifier, CLASSIFIER_SCOUT.start).getStart(classifier.sf);
const classifierEnd = topLevelStatementAt(classifier, CLASSIFIER_SCOUT.end - 1).end;

const rootSpecs = [
  ["classifyCommand", "Parser aborted (timeout, resource limit, or over-length)", "splice"],
  ["classifyReadOnly", "Command too long for read-only analysis", "splice"],
  ["checkBashPermissions", "this agent's Bash use is clamped to a fixed set of command forms", "splice", "graph"],
  ["clampCrashFailClosed", "permission check crashed and this agent carries a per-spawn bashCommandClamp", "splice", "engine"],
  ["decideModeSpecificCommand", "Base command not found", "fold"],
  ["decideBashPermissions", "tengu_bash_ast_too_complex", "splice"],
  ["aggregateSubcommands", "Bare output redirection with no command; path layer approved", "fold"],
  ["parsePipeCommand", "Failed to parse command", "fold"],
  ["rejectCompoundOperators", "This command uses shell operators that require approval for safety", "fold"],
  ["validateCommandSemantics", "Newline followed by # inside a redirect target can hide arguments from path validation", "fold"],
] as const;
const roots = rootSpecs.map(([role, anchor, wiring, scope = "graph"]) => {
  const hit = scope === "engine" ? uniqueAnchorIn(engine, anchor) : uniqueAnchor(modules, anchor);
  const fn = enclosingFunction(hit.module, hit.offset);
  return { role, wiring, scope, anchor, file: hit.module.file, anchorOffset: hit.offset, binding: fn.name!.text, params: fn.parameters.length, ...span(hit.module, fn.name!.text, "function", fn) };
});

const decisionRoots = Object.values(BASH_DECISION_ROOTS).map((spec) => {
  const hit = uniqueAnchorIn(engine, spec.anchor);
  const declaration = namedTopLevelDeclarations(engine).get(spec.binding);
  if (!declaration) {
    throw new Error(`${engine.file}: decision root ${spec.binding} is missing`);
  }
  const target = spec.target === "arrow-initializer"
    ? (declaration as ts.VariableDeclaration).initializer
    : declaration;
  if (!target || !target.getText(engine.sf).includes(spec.anchor)) {
    throw new Error(`${spec.name}: anchor did not resolve inside ${spec.binding}`);
  }
  const parameters = ts.isFunctionDeclaration(target) ||
      ts.isFunctionExpression(target) ||
      ts.isArrowFunction(target)
    ? target.parameters.length
    : -1;
  if (parameters !== spec.params) {
    throw new Error(`${spec.name}: expected ${spec.params} parameters, got ${parameters}`);
  }
  return {
    role: spec.name,
    wiring: "splice",
    scope: "graph",
    anchor: spec.anchor,
    file: hit.module.file,
    anchorOffset: hit.offset,
    binding: spec.binding,
    params: spec.params,
    ...span(engine, spec.binding, spec.target, target),
  };
});

const tables = [
  tableBy(engine, "fdFlags", (init) => ts.isObjectLiteralExpression(init) && objectKeys(init).includes("--search-path") && objectKeys(init).includes("--no-require-git")),
  tableBy(engine, "grepFlags", (init) => ts.isObjectLiteralExpression(init) && objectKeys(init).includes("--binary-files") && objectKeys(init).includes("--dereference-recursive")),
  tableBy(engine, "commandAllowlist", (init, text) => ts.isObjectLiteralExpression(init) && text.includes("additionalCommandIsDangerousCallback") && text.includes("xargs:{safeFlags:")),
  tableBy(engine, "commandAllowlistExtension", (init, text) => ts.isObjectLiteralExpression(init) && text.includes("aki:{safeFlags:") && text.startsWith("{...")),
  tableBy(engine, "wrapperValueFlags", (init, text) => ts.isObjectLiteralExpression(init) && text.includes('sudo:new Set(["-u","-g"') && text.includes("unshare:new Set")),
  tableBy(engine, "wrapperCommandFlags", (init, text) => ts.isObjectLiteralExpression(init) && text.includes('flock:new Set(["-c","--command"])')),
  tableBy(engine, "wrapperValidators", (init, text) => ts.isObjectLiteralExpression(init) && text.includes("taskset:") && text.includes("flock:()=>!0")),
  tableBy(engine, "pathArgumentExtractors", (init, text) => ts.isObjectLiteralExpression(init) && text.includes("cd:(") && text.includes("sha256sum") && text.includes("git:(")),
  tableBy(engine, "pathEffectDescriptions", (init, text) => ts.isObjectLiteralExpression(init) && text.includes('cd:"change directories to"') && text.includes('md5sum:"compute MD5')),
  tableBy(engine, "pathEffectKinds", (init, text) => ts.isObjectLiteralExpression(init) && text.includes('cd:"read"') && text.includes('mkdir:"create"') && text.includes('rm:"write"')),
  tableBy(engine, "pathFlagValidators", (init, text) => ts.isObjectLiteralExpression(init) && text.includes("mv:(") && text.includes("cp:(") && text.includes("r<=1")),
];

const tableInitializers = tables.map((table) =>
  variableDeclarators(engine).find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === table.binding,
  )!,
);
const engineDeclarations = namedTopLevelDeclarations(engine);
const classifierDeclarations = namedTopLevelDeclarations(classifier);
const engineTableSeeds = tableInitializers.flatMap((declaration) =>
  freeIdentifiers(declaration.initializer!).filter((name) => engineDeclarations.has(name)),
);
const classifierTableSeeds = tableInitializers.flatMap((declaration) =>
  freeIdentifiers(declaration.initializer!).filter((name) => classifierDeclarations.has(name)),
);
const rawTableDependencyClosure = [
  ...transitiveDeclarations(engine, engineTableSeeds),
  ...transitiveDeclarations(classifier, classifierTableSeeds),
].filter(
  (dependency, index, all) =>
    !tables.some(
      (table) => table.file === dependency.file && table.binding === dependency.name,
    ) &&
    all.findIndex(
      (candidate) =>
        candidate.file === dependency.file && candidate.name === dependency.name,
    ) === index,
);

const tableDependencyOwners = new Map<string, Set<string>>();
for (let index = 0; index < tables.length; index++) {
  const table = tables[index];
  const declaration = tableInitializers[index];
  for (const module of [engine, classifier]) {
    const declarations = namedTopLevelDeclarations(module);
    const seeds = freeIdentifiers(declaration.initializer!).filter((name) =>
      declarations.has(name),
    );
    for (const dependency of transitiveDeclarations(module, seeds)) {
      const key = `${dependency.file}\0${dependency.name}`;
      const owners = tableDependencyOwners.get(key) ?? new Set<string>();
      owners.add(table.role);
      tableDependencyOwners.set(key, owners);
    }
  }
}
const tableDependencyClosure = rawTableDependencyClosure.map((dependency) => ({
  ...dependency,
  owners: [...(tableDependencyOwners.get(
    `${dependency.file}\0${dependency.name}`,
  ) ?? [])].sort(),
}));

const prefixHelperModule = modules.find(
  (module) => module.file === "chunk-04aem4bh.js",
)!;
const prefixHelper = namedTopLevelDeclarations(prefixHelperModule).get("St");
if (!prefixHelper) throw new Error("cross-module table helper St is missing");
const externalTableDependencies = [
  {
    binding: "vnn",
    from: "node:os",
    imported: "homedir",
    kind: "effectful-port",
    reason:
      "pL.cd reads the host home directory only when bare cd has no positional target; the owned table factory keeps that state read injected.",
  },
  {
    binding: "St",
    from: prefixHelperModule.file,
    imported: "St",
    kind: "table-dependency",
    reason:
      "Bnn's hostname-style callback uses this pure prefix-before-delimiter helper; callback parity evaluates the exact pinned helper path.",
    ...span(prefixHelperModule, "St", "table-dependency", prefixHelper),
  },
];

const statePortGroup = exclusionGroup(
  engine,
  "environment-snapshot-state",
  "inn P9e ann C8 A8 x9e R8 oW".split(" "),
  "Host-scoped mutable environment state stays behind C13b's named ports and belongs to C13d's shell snapshot ownership.",
);

const exclusions = [
  exclusionGroup(engine, "destructive-telemetry-and-ui", "Htn T9e f9n Ob jtn Wtn ztn Vhe Gtn Aee _9e S9e qtn Ktn Vtn Zj Ytn Xtn Qtn OP Yhe v9e Xhe Jtn Ztn enn tnn b9e".split(" "),
    "No command-admission caller: f9n is interactive warning UI; Ob/Aee/OP feed execution telemetry and PowerShell. Defer to their owning waves."),
  exclusionGroup(engine, "interactive-suggestions", ["m9n", "g9n"],
    "Only interactive rule-suggestion consumers read these helpers."),
  exclusionGroup(engine, "bash-tool-alias", ["N8e"],
    "A tool-object matcher alias, not command-admission behavior; its tool caller remains a later leaf."),
  exclusionGroup(engine, "monitor-tool-helper", ["h9n"],
    "Shared Monitor/tool failure rendering; C13b deliberately admits adjacent XNt's clamp fail-closed decision but not this renderer."),
  exclusionGroup(engine, "sandbox-server-helper", ["Grn", "_9n"],
    "Excluded-command plumbing for server/sandbox paths, outside the local command-admission leaf."),
  exclusionGroup(engine, "powershell-destructive-classifier", ["qrn", "sQe", "y9n", "Eye"],
    "PowerShell-specific classifier data and helpers belong to C13f."),
  exclusionGroup(engine, "next-permission-region", ["csn", "iQe", "Y8"],
    "Tool-catalog/config declarations beyond the C5 boundary; Y8 is included only because the coarse endpoint overlaps its first byte."),
  exclusionGroup(engine, "argv-ui-telemetry-consumer", ["jz"],
    "Reads beyond argv[0], but only EOn recursion, interactive X9n suggestions, and tht/LG telemetry call it; no $ct/jrn admission caller."),
];

const regions = [
  region(engine, engineStart, engineEnd, ENGINE_SCOUT),
  region(classifier, classifierStart, classifierEnd, CLASSIFIER_SCOUT),
  region(
    classifier,
    classifierEnd,
    roots.find((root) => root.role === "validateCommandSemantics")!.end,
    {
      start: CLASSIFIER_SCOUT.end,
      end: roots.find((root) => root.role === "validateCommandSemantics")!.end,
    },
  ),
];
const allRoots = [...roots, ...decisionRoots];
const keyOf = (file: string, name: string): string => `${file}\0${name}`;
const rootByKey = new Map(
  allRoots
    .filter((root) => root.wiring === "splice")
    .map((root) => [keyOf(root.file, root.binding), root]),
);
const explicitFoldOwners = new Map<string, string[]>([
  [keyOf(engine.file, "Ua"), ["bash-permission-entry", "bash-permission-core", "bash-git-structure-command"]],
  [keyOf(engine.file, "ru"), ["bash-git-structure-command"]],
  [keyOf(engine.file, "Ah"), ["bash-ast-path-command", "bash-text-path-command"]],
  [keyOf(engine.file, "Db"), ["bash-permission-core", "bash-direct-command"]],
  [keyOf(engine.file, "H9e"), ["bash-direct-command"]],
  [keyOf(engine.file, "T8e"), ["bash-direct-command"]],
]);
for (const root of allRoots.filter((candidate) => candidate.wiring === "fold")) {
  explicitFoldOwners.set(
    keyOf(root.file, root.binding),
    root.binding === "hrn"
      ? ["bash-direct-command"]
      : ["bash-permission-core"],
  );
}
const tableByKey = new Map(
  tables.map((table) => [keyOf(table.file, table.binding), table]),
);
const tableDependencyByKey = new Map(
  tableDependencyClosure.map((dependency) => [
    keyOf(dependency.file, dependency.name),
    dependency,
  ]),
);
const portNames = new Set([
  ...statePortGroup.names,
  "bv",
  "eQ",
  "g8e",
  "irn",
  "mL",
  "m_e",
  "oW",
  "srn",
  "zw",
]);
const portKeys = new Set(
  [...portNames]
    .filter((name) => namedTopLevelDeclarations(engine).has(name))
    .map((name) => keyOf(engine.file, name)),
);
const exclusionByKey = new Map<string, { role: string; reason: string }>();
for (const group of exclusions) {
  for (const name of group.names) {
    exclusionByKey.set(keyOf(group.file, name), {
      role: group.role,
      reason: group.reason,
    });
  }
}

function reachableFrom(
  module: ModuleFile,
  seed: string,
  stops: ReadonlySet<string>,
): Set<string> {
  const declarations = namedTopLevelDeclarations(module);
  const reached = new Set<string>();
  const queue = [seed];
  while (queue.length > 0) {
    const name = queue.shift()!;
    const declaration = declarations.get(name);
    if (!declaration) continue;
    for (const dependency of freeIdentifiers(declaration)) {
      if (!declarations.has(dependency) || reached.has(dependency)) continue;
      reached.add(dependency);
      if (!stops.has(keyOf(module.file, dependency))) queue.push(dependency);
    }
  }
  return reached;
}

const structuralStops = new Set([
  ...rootByKey.keys(),
  ...explicitFoldOwners.keys(),
  ...tableByKey.keys(),
  ...tableDependencyByKey.keys(),
  ...portKeys,
  ...exclusionByKey.keys(),
]);
const closureOwners = new Map<string, Set<string>>();
for (const root of allRoots) {
  const reached = reachableFrom(
    root.file === engine.file ? engine : classifier,
    root.binding,
    structuralStops,
  );
  for (const name of reached) {
    const key = keyOf(root.file, name);
    if (structuralStops.has(key)) continue;
    const owners = closureOwners.get(key) ?? new Set<string>();
    owners.add(root.role);
    closureOwners.set(key, owners);
  }
}

for (const [name, owners] of [
  ["SQn", ["bash-too-complex-sandbox"]],
  ["dde", ["bash-nested-dangerous-removal"]],
] as const) {
  const key = keyOf(classifier.file, name);
  const current = closureOwners.get(key) ?? new Set<string>();
  for (const owner of owners) current.add(owner);
  closureOwners.set(key, current);
}

// A pure helper inside the promised regions must be folded into owned code.
// Merely forwarding it would recreate the original false ownership boundary.
for (const spec of Object.values(BASH_DECISION_ROOTS)) {
  const target = namedTopLevelDeclarations(engine).get(spec.binding)!;
  const original = spec.target === "arrow-initializer"
    ? (target as ts.VariableDeclaration).initializer!.getText(engine.sf)
    : target.getText(engine.sf);
  for (const capture of spec.captures) {
    const identifier = capture.derive(original);
    const inPromisedRegion = regions.some(
      (entry) =>
        entry.file === engine.file &&
        entry.declarations.some((declaration) => declaration.name === identifier),
    ) || regions.some(
      (entry) =>
        entry.file === classifier.file &&
        entry.declarations.some((declaration) => declaration.name === identifier),
    );
    if (
      inPromisedRegion &&
      capture.kind === "pure-helper" &&
      capture.owned !== true
    ) {
      throw new Error(
        `${spec.name}.${capture.as}: in-region pure helper '${identifier}' is still graph-forwarded`,
      );
    }
  }
}

const population = regions.flatMap((entry) =>
  entry.declarations.map((declaration) => ({
    file: entry.file,
    ...declaration,
  })),
);
const dispositions = population.map((declaration) => {
  const key = keyOf(declaration.file, declaration.name);
  const root = rootByKey.get(key);
  const foldOwners = explicitFoldOwners.get(key);
  const table = tableByKey.get(key);
  const dependency = tableDependencyByKey.get(key);
  const port = portKeys.has(key);
  const exclusion = exclusionByKey.get(key);
  const primary = [
    root && "root",
    foldOwners && "fold",
    table && "table",
    dependency && !root && !foldOwners && !table && "tableDependency",
    port && "port",
    exclusion && "exclude",
  ].filter(Boolean) as string[];
  if (primary.length > 1) {
    throw new Error(
      `${declaration.file}:${declaration.name} has overlapping dispositions: ${primary.join(", ")}`,
    );
  }
  if (root) {
    return {
      ...declaration,
      disposition: "root",
      owners: [root.role],
      reason: `anchored ${root.wiring} target with a production graph caller`,
    };
  }
  if (foldOwners) {
    return {
      ...declaration,
      disposition: "fold",
      owners: foldOwners,
      reason:
        "owned implementation is called from the listed production owner(s); the original declaration is not called after those owners are replaced",
    };
  }
  if (table) {
    return {
      ...declaration,
      disposition: "table",
      owners: [table.role],
      reason: "asserted declarator; downstream graph reads receive the owned replacement",
    };
  }
  if (dependency && !root && !foldOwners && !table) {
    return {
      ...declaration,
      disposition: "tableDependency",
      owners: dependency.owners,
      reason:
        "transitively reached by an asserted table initializer and covered by table structure/callback parity",
    };
  }
  if (port) {
    return {
      ...declaration,
      disposition: "port",
      owners: ["external-state"],
      reason:
        "narrow rule, sandbox, filesystem, cwd, or environment state remains injected; no local command-decision body is delegated here",
    };
  }
  if (exclusion) {
    return {
      ...declaration,
      disposition: "exclude",
      owners: [exclusion.role],
      reason: exclusion.reason,
    };
  }
  const owners = closureOwners.get(key);
  if (owners && owners.size > 0) {
    return {
      ...declaration,
      disposition: "ownedClosure",
      owners: [...owners].sort(),
      reason:
        "pure or data dependency folded into a listed production owner; its graph declaration is not a decision port",
    };
  }
  return {
    ...declaration,
    disposition: "exclude",
    owners: ["outside-admission-call-closure"],
    reason:
      "no AST call/dependency path from an admitted root or table reaches this declaration before an explicit port or exclusion boundary",
  };
});
const dispositionKeys = dispositions.map((row) => keyOf(row.file, row.name));
if (new Set(dispositionKeys).size !== population.length) {
  throw new Error("Bash safety disposition contains a duplicate declaration key");
}
if (dispositions.length !== population.length) {
  throw new Error(
    `Bash safety disposition covers ${dispositions.length}/${population.length} declarations`,
  );
}
const dispositionBytes = dispositions.reduce(
  (sum, row) => sum + (row.byteEnd - row.byteStart),
  0,
);
const dispositionCounts = Object.fromEntries(
  [...new Set(dispositions.map((row) => row.disposition))]
    .sort()
    .map((kind) => [
      kind,
      dispositions.filter((row) => row.disposition === kind).length,
    ]),
);

const tableFootprint = {
  declaratorBytes: tables.reduce(
    (sum, table) => sum + (table.byteEnd - table.byteStart),
    0,
  ),
  initializerBytes: tables.reduce((sum, table) => sum + table.valueBytes, 0),
};

const fixture = {
  engineVersion: ENGINE_VERSION,
  generatedBy: "research/tools/extract-bash-safety.ts",
  regions,
  roots: allRoots,
  tables,
  tableFootprint,
  tableDependencyClosure,
  externalTableDependencies,
  dispositions: {
    counts: dispositionCounts,
    declarations: dispositions.length,
    bytes: dispositionBytes,
    rows: dispositions,
  },
  exclusions,
  deliberateDarkAdmissions: [
    { binding: "oro", reason: "one occurrence (its declaration) and no consumer; owned because the approved table population names it, graded only by pinned-byte table parity" },
  ],
};
const rendered = JSON.stringify(fixture, null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (!existsSync(FIXTURE)) throw new Error(`missing ${basename(FIXTURE)}; run without --check`);
  const committed = readFileSync(FIXTURE, "utf8");
  if (committed !== rendered) throw new Error(`${basename(FIXTURE)} differs from pinned ${ENGINE_VERSION}; regenerate and review the population`);
  console.log(
    `PASS — bash-safety fixture matches ${ENGINE_VERSION}: ${allRoots.length} roots, ${tables.length} tables, ` +
      `${dispositions.length} dispositions (${JSON.stringify(dispositionCounts)}), ` +
      fixture.regions.map((r) => `${r.counts.declarations} declarations in ${r.file}`).join(" + "),
  );
} else {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, rendered);
  console.log(`wrote ${FIXTURE}`);
}
