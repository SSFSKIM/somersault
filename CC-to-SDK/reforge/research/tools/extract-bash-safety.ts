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

function topLevelStatementAt(module: ModuleFile, offset: number): ts.Statement {
  const hit = module.sf.statements.find((statement) => statement.getStart(module.sf) <= offset && statement.end >= offset);
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
    binding: declaration.name.text,
    ...span(module, declaration.name.text, "table", declaration),
    valueSha256: sha256(init.getText(module.sf)),
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
  ["classifyCommand", "Parser aborted (timeout, resource limit, or over-length)"],
  ["classifyReadOnly", "Command too long for read-only analysis"],
  ["aggregateSubcommands", "Bare output redirection with no command; path layer approved"],
  ["parsePipeCommand", "Failed to parse command"],
  ["rejectCompoundOperators", "This command uses shell operators that require approval for safety"],
  ["decideModeSpecificCommand", "Base command not found"],
] as const;
const roots = rootSpecs.map(([role, anchor]) => {
  const hit = uniqueAnchor(modules, anchor);
  const fn = enclosingFunction(hit.module, hit.offset);
  return { role, anchor, file: hit.module.file, anchorOffset: hit.offset, binding: fn.name!.text, params: fn.parameters.length, ...span(hit.module, fn.name!.text, "function", fn) };
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

const fixture = {
  engineVersion: ENGINE_VERSION,
  generatedBy: "research/tools/extract-bash-safety.ts",
  regions: [
    region(engine, engineStart, engineEnd, { start: 890_302, end: 1_015_200 }),
    region(classifier, classifierStart, classifierEnd, { start: 108_945, end: 162_000 }),
  ],
  roots,
  tables,
};
const rendered = JSON.stringify(fixture, null, 2) + "\n";

if (process.argv.includes("--check")) {
  if (!existsSync(FIXTURE)) throw new Error(`missing ${basename(FIXTURE)}; run without --check`);
  const committed = readFileSync(FIXTURE, "utf8");
  if (committed !== rendered) throw new Error(`${basename(FIXTURE)} differs from pinned ${ENGINE_VERSION}; regenerate and review the population`);
  console.log(`PASS — bash-safety fixture matches ${ENGINE_VERSION}: ${roots.length} roots, ${tables.length} tables, ${fixture.regions.map((r) => `${r.counts.declarations} declarations in ${r.file}`).join(" + ")}`);
} else {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, rendered);
  console.log(`wrote ${FIXTURE}`);
}
