// PINNED-BYTE DIFFERENTIAL CONTRACT — C13b's anchored pipe/compound/mode unit.
//
//   npx tsx strangle/bash-compound-safety-parity.test.ts
//
// The aggregate roots, child decision roots, and production folds are
// found from stable anchors and evaluated from Claude Code 2.1.251's own
// bytes; cross-chunk bQn is anchored and graded separately. Unanchorable helpers
// are reached from those bodies' captured identifiers; no minified name is an
// owned interface. Full decisions preserve Map insertion order.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  basename,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
} from "node:path";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { PARTITIONS } from "./parser-corpus.js";
import {
  AGGREGATE_CASES,
  DANGEROUS_SAFETY_REASON,
  DUPLICATE_REMOVAL_SCHEDULE,
  EFFECT_STATE,
  HELPER_CASES,
  MODE_CASES,
  PIPE_CASES,
  ROOT_CASES,
  SAFETY_REGRESSION_CASES,
  SEMANTIC_RECORDS,
} from "./bash-compound-safety-corpus.js";
import { createCommandClassifier } from "./modules/command-classifier/reference.js";
import { resolveAnchor } from "./anchor.js";
import { BASH_DECISION_ROOTS } from "./bash-compound-safety-capture-specs.js";
import { assertSignature, chunkAst, selectExcision, type Excision } from "./ast.js";
import {
  PARSE_ABORTED,
  SHELL_KEYWORDS,
  commandArgv as parserCommandArgv,
  findCommandNode,
  getParser,
} from "./modules/shell-parser/reference.js";
import { permissionMessage } from "./modules/shared/permission-message.js";
import { findSafetyCheckReason } from "./modules/shared/safety-check-reason.js";
import {
  aggregateSubcommandPermissions,
  checkBashDangerousRemoval,
  checkBashPermission,
  checkBashPermissionCore,
  permissionCheckFailureDecision,
  checkModeCommand,
  checkParsedPipeSafety,
  checkPipeSafety,
  commandArgv,
  createCommandAnalysis,
  normalizeCommandPrefix,
  peelCommandPrefixes,
  splitOutputRedirections,
  splitSubcommands,
  validateCommandSemantics,
} from "./modules/bash-compound-safety/reference.js";

if (ENGINE_VERSION !== "2.1.251") {
  throw new Error(`C13b contract is pinned to 2.1.251, got ${ENGINE_VERSION}`);
}

const MODULES = new Map<string, string>();
for (const file of readdirSync(BUNDLE_MODULES)) {
  if (file.endsWith(".js")) {
    const path = join(BUNDLE_MODULES, file);
    MODULES.set(path, readFileSync(path, "utf8"));
  }
}

const TARGETS = {
  checkBashPermission: {
    anchor: "this agent's Bash use is clamped to a fixed set of command forms (per-spawn bashCommandClamp)",
    params: 3,
  },
  checkBashPermissionCore: {
    anchor: "tengu_bash_ast_too_complex",
    params: 3,
  },
  permissionCheckFailureDecision: {
    anchor: "permission check crashed and this agent carries a per-spawn bashCommandClamp",
    coLiteral: "This command uses shell operators that require approval for safety",
    params: 2,
  },
  checkPipeSafety: { anchor: "Failed to parse command", params: 6 },
  checkParsedPipeSafety: {
    anchor: "This command uses shell operators that require approval for safety",
    params: 6,
  },
  aggregateSubcommandPermissions: {
    anchor: "Bare output redirection with no command; path layer approved",
    params: 7,
  },
  checkModeCommand: { anchor: "Base command not found", params: 2 },
} as const;

type TargetName = keyof typeof TARGETS;
type AnyFn = (...args: any[]) => any;
type Decision = { behavior: string; [key: string]: any };

let checks = 0;
let controls = 0;
const failures: string[] = [];

function stable(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item) => {
      if (item instanceof Map) return { __map: [...item.entries()] };
      if (item === undefined) return "__undefined";
      if (typeof item === "symbol") return `__symbol:${item.description ?? ""}`;
      return item;
    }) ?? "__undefined"
  );
}

function eq(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = stable(actual);
  const b = stable(expected);
  if (a === b) return;
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  failures.push(
    `${label}: differs at offset ${at}\n` +
      `  actual:   ${JSON.stringify(a.slice(Math.max(0, at - 50), at + 100))}\n` +
      `  expected: ${JSON.stringify(b.slice(Math.max(0, at - 50), at + 100))}`,
  );
}

function mustDiffer(label: string, positive: unknown, negative: unknown): void {
  controls++;
  if (stable(positive) !== stable(negative)) return;
  failures.push(`CONTROL ${label}: positive and named negative control compare equal`);
}

function mustMatch(source: string, pattern: RegExp, group: number, label: string): string {
  const match = source.match(pattern);
  if (!match?.[group]) throw new Error(`${label}: ${pattern} did not match the pinned bytes`);
  return match[group];
}

const cuts = new Map<TargetName, { path: string; source: string; cut: Excision }>();
for (const [name, spec] of Object.entries(TARGETS) as [
  TargetName,
  (typeof TARGETS)[TargetName],
][]) {
  const resolved = resolveAnchor(
    MODULES,
    { name, anchor: spec.anchor, coLiteral: "coLiteral" in spec ? spec.coLiteral : undefined },
    basename,
  );
  const sourceFile = chunkAst(resolved.path, resolved.source);
  const cut = selectExcision(name, sourceFile, resolved.offsets, "free-function", {
    params: spec.params,
    ancestry: ["SourceFile"],
  });
  assertSignature(name, cut, { params: spec.params, ancestry: ["SourceFile"] });
  cuts.set(name, { ...resolved, cut });
}

const targetPaths = new Set([...cuts.values()].map(({ path }) => path));
eq("seven anchors resolve to one chunk", [...targetPaths].map((path) => basename(path)), ["chunk-fy12d89p.js"]);
const targetPath = [...targetPaths][0]!;
const targetSource = MODULES.get(targetPath)!;
eq(
  "owning chunk is the pinned 2.1.251 bytes",
  createHash("sha256").update(targetSource).digest("hex"),
  "00d439a04b0746609faa44fef08f2d4c433965b5568a89275e0c28d17d836f8b",
);

const sourceFile = chunkAst(targetPath, targetSource);
function functionSource(name: string): string {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement.getText(sourceFile);
    }
  }
  throw new Error(`derived helper '${name}' is not a top-level function`);
}

function initializerSource(name: string): string {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer
      ) {
        return declaration.initializer.getText(sourceFile);
      }
    }
  }
  throw new Error(`derived helper constant '${name}' has no initializer`);
}

function functionBody(node: ts.Node): ts.Block {
  if (ts.isFunctionDeclaration(node) && node.body) return node.body;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isBlock(node.body)
  ) {
    return node.body;
  }
  throw new Error(`expected a block-bodied function, got ${ts.SyntaxKind[node.kind]}`);
}

function canonicalBody(
  statements: readonly ts.Statement[],
  source: ts.SourceFile,
): string {
  const factory = ts.factory;
  const ensureBlock = (statement: ts.Statement): ts.Block =>
    ts.isBlock(statement) ? statement : factory.createBlock([statement], true);
  const braceLoops: ts.TransformerFactory<ts.Node> = (context) => {
    const visit: ts.Visitor = (node) => {
      const visited = ts.visitEachChild(node, visit, context);
      if (ts.isForStatement(visited)) {
        return factory.updateForStatement(
          visited,
          visited.initializer,
          visited.condition,
          visited.incrementor,
          ensureBlock(visited.statement),
        );
      }
      if (ts.isForInStatement(visited)) {
        return factory.updateForInStatement(
          visited,
          visited.initializer,
          visited.expression,
          ensureBlock(visited.statement),
        );
      }
      if (ts.isForOfStatement(visited)) {
        return factory.updateForOfStatement(
          visited,
          visited.awaitModifier,
          visited.initializer,
          visited.expression,
          ensureBlock(visited.statement),
        );
      }
      if (ts.isWhileStatement(visited)) {
        return factory.updateWhileStatement(
          visited,
          visited.expression,
          ensureBlock(visited.statement),
        );
      }
      if (ts.isDoStatement(visited)) {
        return factory.updateDoStatement(
          visited,
          ensureBlock(visited.statement),
          visited.expression,
        );
      }
      return visited;
    };
    return (node) => ts.visitNode(node, visit) as ts.Node;
  };
  const wrapper = factory.createFunctionDeclaration(
    undefined,
    undefined,
    "canonical",
    undefined,
    [],
    undefined,
    factory.createBlock([...statements], true),
  );
  const transformed = ts.transform(wrapper, [braceLoops]).transformed[0];
  const shape = (node: ts.Node): unknown => {
    let value: string | undefined;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      value = node.text;
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isNumericLiteral(node) ||
      ts.isBigIntLiteral(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      value = node.text;
    }
    const children: unknown[] = [];
    ts.forEachChild(node, (child) => {
      children.push(shape(child));
    });
    return value === undefined
      ? [node.kind, children]
      : [node.kind, value, children];
  };
  return JSON.stringify(shape(transformed));
}

const ownedAggregatePath = new URL(
  "./modules/bash-compound-safety/reference.js",
  import.meta.url,
);
const ownedAggregateSource = readFileSync(ownedAggregatePath, "utf8");
const ownedAggregateAst = chunkAst(
  ownedAggregatePath.pathname,
  ownedAggregateSource,
);
for (const root of Object.values(BASH_DECISION_ROOTS)) {
  const resolved = resolveAnchor(
    MODULES,
    { name: root.name, anchor: root.anchor },
    basename,
  );
  const pinnedAst = chunkAst(resolved.path, resolved.source);
  const signature = {
    params: root.params,
    ancestry: ["SourceFile"],
    ...(root.target === "arrow-initializer"
      ? { declarator: root.binding === "j8e" ? 1 : 0 }
      : {}),
  };
  const cut = selectExcision(
    root.name,
    pinnedAst,
    resolved.offsets,
    root.target,
    signature,
  );
  assertSignature(root.name, cut, signature);
  const owned = ownedAggregateAst.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === root.adapter,
  );
  if (!owned || !ts.isFunctionDeclaration(owned) || !owned.body) {
    throw new Error(`owned decision root '${root.adapter}' is missing`);
  }
  const pinned = functionBody(cut.node);
  const preludeStatements = root.binding === "j8e" ? 3 : 1;
  const pinnedCanonical = canonicalBody(pinned.statements, pinnedAst);
  const ownedCanonical = canonicalBody(
    owned.body.statements.slice(preludeStatements),
    ownedAggregateAst,
  );
  eq(`${root.name} owned body matches pinned AST`, ownedCanonical, pinnedCanonical);
  mustDiffer(
    `${root.name} body comparator rejects a dropped-node mutant`,
    pinnedCanonical,
    pinnedCanonical.slice(0, -1),
  );
}

function evaluateFunction(
  source: string,
  label: string,
  bindings: Record<string, unknown>,
): AnyFn {
  const names = Object.keys(bindings);
  // The input is the local checksum-pinned extraction, as in the existing
  // reforge differential contracts. Lower syntax only: Node 22 cannot parse
  // the pinned helper's `using` declaration inside Function(), while the
  // TypeScript runner can lower that declaration without changing its body.
  let executable = source;
  if (/\b(?:await\s+)?using\s/.test(source)) {
    const lowered = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    });
    const errors = (lowered.diagnostics ?? []).filter(
      ({ category }) => category === ts.DiagnosticCategory.Error,
    );
    if (errors.length > 0) {
      throw new Error(
        `${label}: pinned declaration syntax lowering failed: ${errors
          .map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
          )
          .join("; ")}`,
      );
    }
    executable = lowered.outputText;
  }
  // eslint-disable-next-line no-new-func
  return Function(...names, `${executable}\nreturn ${label};`)(
    ...names.map((name) => bindings[name]),
  ) as AnyFn;
}

function evaluateValue(
  source: string,
  bindings: Record<string, unknown> = {},
): unknown {
  const names = Object.keys(bindings);
  // eslint-disable-next-line no-new-func
  return Function(...names, `return (${source});`)(
    ...names.map((name) => bindings[name]),
  );
}

function evaluateScoped(
  source: string,
  label: string,
  bindings: Record<string, unknown>,
): AnyFn {
  const scope = new Proxy(bindings, {
    has: () => true,
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (typeof key === "string" && Object.hasOwn(target, key)) return target[key];
      if (typeof key === "string" && key in globalThis) {
        return (globalThis as Record<string, unknown>)[key];
      }
      throw new Error(`unbound pinned-byte oracle capture '${String(key)}'`);
    },
  });
  // `with` is test-only lexical binding for a pinned declaration whose many
  // earlier branches are deliberately made unreachable by the case fixture.
  // eslint-disable-next-line no-new-func
  return Function("__scope", `with (__scope) { ${source}\nreturn ${label}; }`)(
    scope,
  ) as AnyFn;
}

const targetText = (name: TargetName): string => cuts.get(name)!.cut.original;
const targetLabel = (name: TargetName): string => cuts.get(name)!.cut.label;

const displaySpanName = mustMatch(
  targetText("checkBashPermission"),
  /the span \$\{([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\.span\)\} matches none/,
  1,
  "root display-span helper",
);
const displaySpanPath = [...MODULES.keys()].find(
  (path) => basename(path) === "chunk-ynzt0fm1.js",
);
if (!displaySpanPath) throw new Error("JSON serialization helper chunk is missing");
const displaySpanSourceFile = chunkAst(
  displaySpanPath,
  MODULES.get(displaySpanPath)!,
);
let displaySpanSource: string | undefined;
for (const statement of displaySpanSourceFile.statements) {
  if (
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === displaySpanName
  ) {
    displaySpanSource = statement.getText(displaySpanSourceFile);
    break;
  }
}
if (!displaySpanSource) {
  throw new Error(`derived display-span helper '${displaySpanName}' is missing`);
}
const pinnedDisplaySpan = evaluateFunction(
  displaySpanSource,
  displaySpanName,
  {
    Jd: () => ({ [Symbol.dispose]() {} }),
  },
);

// Direct captures from the anchored callers, then the argv/peeler pair reached
// through the aggregate's derived command-hazard helper.
const splitName = mustMatch(
  targetText("checkParsedPipeSafety"),
  /:([A-Za-z_$][\w$]*)\([^)]*\.command\)\.length>1/,
  1,
  "subcommand splitter",
);
const normalizeName = mustMatch(
  targetText("checkModeCommand"),
  /let [\w$]+=([A-Za-z_$][\w$]*)\([\w$]+\),\[[\w$]+\]=/,
  1,
  "prefix normalizer",
);
const hazardCaptures = targetText("aggregateSubcommandPermissions").match(
  /\?([A-Za-z_$][\w$]*)\([^,]+,([A-Za-z_$][\w$]*)\(\)\):([A-Za-z_$][\w$]*)\([^)]*\.command\)/,
);
if (!hazardCaptures) throw new Error("aggregate hazard captures did not match");
const [, analysisHazardName, cwdName, commandHazardName] = hazardCaptures;
const commandHazardSource = functionSource(commandHazardName);
const peelArgvCaptures = commandHazardSource.match(
  /=([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\([\w$]+\)\)\[0\]/,
);
if (!peelArgvCaptures) throw new Error("argv peeler captures did not match");
const [, peelName, argvName] = peelArgvCaptures;

function buildUpstreamSplit(): AnyFn {
  const source = functionSource(splitName);
  const cap = mustMatch(source, /\.length>([A-Za-z_$][\w$]*)/, 1, "split cap");
  const parser = mustMatch(
    source,
    /let [\w$]+=([A-Za-z_$][\w$]*)\(\)\.parse/,
    1,
    "split parser",
  );
  const sets = [
    ...source.matchAll(/([A-Za-z_$][\w$]*)\.has\([\w$]+\.type\)/g),
  ].map((match) => match[1]);
  if (sets.length !== 2) throw new Error(`splitter expected two sets, got ${sets.length}`);
  return evaluateFunction(source, splitName, {
    [cap]: evaluateValue(initializerSource(cap)),
    [parser]: getParser,
    [sets[0]]: evaluateValue(initializerSource(sets[0])),
    [sets[1]]: evaluateValue(initializerSource(sets[1])),
  });
}

function buildUpstreamArgv(): AnyFn {
  const source = functionSource(argvName);
  const cap = mustMatch(source, /\.length>([A-Za-z_$][\w$]*)/, 1, "argv cap");
  const parser = mustMatch(
    source,
    /let [\w$]+=([A-Za-z_$][\w$]*)\(\)\.parse/,
    1,
    "argv parser",
  );
  const finder = mustMatch(
    source,
    /let [\w$]+=([A-Za-z_$][\w$]*)\([\w$]+,null\)/,
    1,
    "command finder",
  );
  const extractor = mustMatch(
    source,
    /return ([A-Za-z_$][\w$]*)\([\w$]+\)}/,
    1,
    "argv extractor",
  );
  return evaluateFunction(source, argvName, {
    [cap]: evaluateValue(initializerSource(cap)),
    [parser]: getParser,
    [finder]: findCommandNode,
    [extractor]: parserCommandArgv,
  });
}

function buildUpstreamNormalize(): AnyFn {
  const source = functionSource(normalizeName);
  const stripComments = mustMatch(
    source,
    /o=([A-Za-z_$][\w$]*)\(o\)/,
    1,
    "comment stripper",
  );
  const allowedEnv = mustMatch(
    source,
    /if\(([A-Za-z_$][\w$]*)\.has\([\w$]+\)\)/,
    1,
    "environment allowlist",
  );
  return evaluateFunction(source, normalizeName, {
    [stripComments]: evaluateFunction(
      functionSource(stripComments),
      stripComments,
      {},
    ),
    [allowedEnv]: evaluateValue(initializerSource(allowedEnv)),
  });
}

function buildUpstreamPeel(): AnyFn {
  const source = functionSource(peelName);
  const timeoutArgs = mustMatch(
    source,
    /o==="timeout"\)\{let [\w$]+=([A-Za-z_$][\w$]*)\([\w$]+\)/,
    1,
    "timeout argv parser",
  );
  const stdbufArgs = mustMatch(
    source,
    /o==="stdbuf"\)\{let [\w$]+=([A-Za-z_$][\w$]*)\([\w$]+\)/,
    1,
    "stdbuf argv parser",
  );
  const envArgs = mustMatch(
    source,
    /o==="env"\)\{let [\w$]+=([A-Za-z_$][\w$]*)\([\w$]+\)/,
    1,
    "env argv parser",
  );
  const timeoutSource = functionSource(timeoutArgs);
  const timeoutValue = mustMatch(
    timeoutSource,
    /&&([A-Za-z_$][\w$]*)\.test\(/,
    1,
    "timeout value syntax",
  );
  return evaluateFunction(source, peelName, {
    [timeoutArgs]: evaluateFunction(timeoutSource, timeoutArgs, {
      [timeoutValue]: evaluateValue(initializerSource(timeoutValue)),
    }),
    [stdbufArgs]: evaluateFunction(functionSource(stdbufArgs), stdbufArgs, {}),
    [envArgs]: evaluateFunction(functionSource(envArgs), envArgs, {}),
  });
}

const upstreamSplit = buildUpstreamSplit();
const upstreamArgv = buildUpstreamArgv();
const upstreamNormalize = buildUpstreamNormalize();
const upstreamPeel = buildUpstreamPeel();

interface SidePlan {
  decide(command: string, call: number): Decision;
  unsafeGit?: boolean;
  safeCdGit?: boolean;
}
interface Side {
  trace: string[];
  checkPermission(input: Record<string, unknown>): Promise<Decision>;
  hasUnsafeGitStructure(command: string, analyses: unknown): boolean;
  isCdGitSequenceSafe(commands: string[]): Promise<boolean>;
}

const unreachable = (label: string) => () => {
  throw new Error(`${label} was not supposed to run`);
};

function shellMessage(tool: string, reason: unknown): string {
  return permissionMessage(
    tool,
    reason,
    unreachable("rule-value renderer"),
    unreachable("rule-source renderer"),
    splitOutputRedirections,
    unreachable("mode-title renderer"),
  );
}

function clampMismatchMessage(
  command: string,
  group: readonly string[],
  span = command.trim(),
): string {
  return (
    `Permission to use Bash with command ${command.trim()} has been denied: ` +
    "this agent's Bash use is clamped to a fixed set of command forms " +
    "(per-spawn bashCommandClamp), and " +
    `the span ${JSON.stringify(span)} matches none of them. ` +
    `Allowed forms: ${group.join(", ")}`
  );
}

function bypassImmuneSafety(reason: { circuitBreaker?: string }): boolean {
  return (
    reason.circuitBreaker === "dangerousRemoval" ||
    reason.circuitBreaker === "isolatePeerMachines"
  );
}

function makeSide(plan: SidePlan): Side {
  const trace: string[] = [];
  let calls = 0;
  return {
    trace,
    async checkPermission(input) {
      const command = String(input.command);
      trace.push(`permission:${command}`);
      return structuredClone(plan.decide(command, calls++));
    },
    hasUnsafeGitStructure(command, analyses) {
      trace.push(
        `git-structure:${analyses === undefined ? "command" : "analysis"}:${command}`,
      );
      return plan.unsafeGit ?? false;
    },
    async isCdGitSequenceSafe(commands) {
      trace.push(`cd-git:${commands.join("|")}`);
      return plan.safeCdGit ?? false;
    },
  };
}

const classifiers = {
  isNormalizedCdCommand(command: string): boolean {
    const base = peelCommandPrefixes(commandArgv(command))[0]?.replace(
      /^.*[\\/]/,
      "",
    );
    return ["cd", "chdir", "pushd", "popd"].includes(base ?? "");
  },
  isNormalizedGitCommand(command: string): boolean {
    return (
      peelCommandPrefixes(commandArgv(command))[0]?.replace(/^.*[\\/]/, "") ===
      "git"
    );
  },
};

function buildUpstreamAggregate(
  side: Side,
  findSafety: AnyFn = findSafetyCheckReason,
  overrides: Record<string, unknown> = {},
): AnyFn {
  const source = targetText("aggregateSubcommandPermissions");
  const message = mustMatch(
    source,
    /message:([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.name,/,
    1,
    "aggregate message",
  );
  const tool = mustMatch(
    source,
    /message:[A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\.name,/,
    1,
    "aggregate tool",
  );
  const safety = mustMatch(
    source,
    /&&([A-Za-z_$][\w$]*)\([\w$]+\.decisionReason,([A-Za-z_$][\w$]*)\)/,
    1,
    "nested safety finder",
  );
  const safetyPredicate = mustMatch(
    source,
    /&&[A-Za-z_$][\w$]*\([\w$]+\.decisionReason,([A-Za-z_$][\w$]*)\)/,
    1,
    "bypass-immune predicate",
  );
  return evaluateFunction(source, targetLabel("aggregateSubcommandPermissions"), {
    [splitName]: upstreamSplit,
    [message]: shellMessage,
    [tool]: { name: "Bash" },
    [safety]: findSafety,
    [safetyPredicate]: bypassImmuneSafety,
    [analysisHazardName]: (analyses: unknown) =>
      side.hasUnsafeGitStructure("<analysis>", analyses),
    [cwdName]: () => "/pinned/cwd",
    [commandHazardName]: (command: string) =>
      side.hasUnsafeGitStructure(command, undefined),
    ...overrides,
  });
}

function buildUpstreamParsed(
  side: Side,
  findSafety: AnyFn = findSafetyCheckReason,
): AnyFn {
  const source = targetText("checkParsedPipeSafety");
  const message = mustMatch(
    source,
    /message:([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.name,/,
    1,
    "parsed message",
  );
  const tool = mustMatch(
    source,
    /message:[A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\.name,/,
    1,
    "parsed tool",
  );
  const strip = mustMatch(
    source,
    /\.map\(\([\w$]+\)=>([A-Za-z_$][\w$]*)\([\w$]+\)\)/,
    1,
    "redirection stripper",
  );
  const aggregate = mustMatch(
    source,
    /return ([A-Za-z_$][\w$]*)\([^;]+\)}/,
    1,
    "aggregate caller",
  );
  return evaluateFunction(source, targetLabel("checkParsedPipeSafety"), {
    [splitName]: upstreamSplit,
    [message]: shellMessage,
    [tool]: { name: "Bash" },
    [strip]: async (command: string) =>
      splitOutputRedirections(command).commandWithoutRedirections,
    [aggregate]: buildUpstreamAggregate(side, findSafety),
  });
}

function buildUpstreamPipe(
  side: Side,
  findSafety: AnyFn = findSafetyCheckReason,
): AnyFn {
  const source = targetText("checkPipeSafety");
  const sentinel = mustMatch(
    source,
    /!==([A-Za-z_$][\w$]*)\?/,
    1,
    "parse sentinel",
  );
  const fromRoot = mustMatch(
    source,
    /\?([A-Za-z_$][\w$]*)\([^,]+,[^)]+\):await/,
    1,
    "analysis from root",
  );
  const parser = mustMatch(
    source,
    /:await ([A-Za-z_$][\w$]*)\.parse/,
    1,
    "analysis parser",
  );
  const parsed = mustMatch(
    source,
    /return ([A-Za-z_$][\w$]*)\([^;]+\)}/,
    1,
    "parsed checker",
  );
  return evaluateFunction(source, targetLabel("checkPipeSafety"), {
    [sentinel]: PARSE_ABORTED,
    [fromRoot]: createCommandAnalysis,
    [parser]: { parse: async (command: string) => createCommandAnalysis(command) },
    [parsed]: buildUpstreamParsed(side, findSafety),
  });
}

function buildUpstreamMode(): AnyFn {
  const source = targetText("checkModeCommand");
  const allow = mustMatch(
    source,
    /&&([A-Za-z_$][\w$]*)\([\w$]+\)\)/,
    1,
    "accept-edits predicate",
  );
  const allowSource = functionSource(allow);
  const allowlist = mustMatch(
    allowSource,
    /return ([A-Za-z_$][\w$]*)\.includes/,
    1,
    "accept-edits allowlist",
  );
  return evaluateFunction(source, targetLabel("checkModeCommand"), {
    [normalizeName]: upstreamNormalize,
    [allow]: evaluateFunction(allowSource, allow, {
      [allowlist]: evaluateValue(initializerSource(allowlist)),
    }),
  });
}

async function comparePipe(
  label: string,
  command: string,
  plan: SidePlan,
  options: { root?: unknown; analyses?: unknown } = {},
): Promise<Decision> {
  const input = { command, description: `case:${label}` };
  const upstreamSide = makeSide(plan);
  const ownedSide = makeSide(plan);
  const upstream = await buildUpstreamPipe(upstreamSide)(
    input,
    upstreamSide.checkPermission,
    classifiers,
    options.root,
    options.analyses,
    upstreamSide.isCdGitSequenceSafe,
  );
  const owned = await checkPipeSafety(input, {
    checkPermission: ownedSide.checkPermission,
    classifiers,
    parsedRoot: options.root,
    commandAnalyses: options.analyses,
    effects: {
      currentWorkingDirectory: () => EFFECT_STATE.cwd,
      hasUnsafeGitStructureFromAnalysis: (analyses: unknown) =>
        ownedSide.hasUnsafeGitStructure("<analysis>", analyses),
      hasUnsafeGitStructureFromCommand: (command: string) =>
        ownedSide.hasUnsafeGitStructure(command, undefined),
      isCdGitSequenceSafe: ownedSide.isCdGitSequenceSafe,
    },
  });
  eq(`${label} decision`, owned, upstream);
  eq(`${label} ordered effect trace`, ownedSide.trace, upstreamSide.trace);
  return owned;
}

function sharedPipeCase(tag: string) {
  const fixture = PIPE_CASES.find((candidate) => candidate.tag === tag);
  if (!fixture) throw new Error(`unknown shared pipe case ${tag}`);
  return fixture;
}

function sharedPipePlan(tag: string): SidePlan {
  const fixture = sharedPipeCase(tag);
  return {
    decide(_command, call) {
      return structuredClone(
        fixture.decisions[call] ?? {
          behavior: "deny",
          message: `shared case ${tag}: permission effect should be unreachable`,
        },
      ) as Decision;
    },
  };
}

// bQn is the one pure admission helper outside the engine chunk. It is folded
// under jrn, so its own pinned declaration is evaluated too rather than inferred
// from jrn's later behavior.
const semanticsResolved = resolveAnchor(
  MODULES,
  {
    name: "validateCommandSemantics",
    anchor: "Empty command name \\u2014 argv[0] may not reflect what bash runs",
  },
  basename,
);
const semanticsFile = chunkAst(semanticsResolved.path, semanticsResolved.source);
const semanticsCut = selectExcision(
  "validateCommandSemantics",
  semanticsFile,
  semanticsResolved.offsets,
  "free-function",
  { params: 1, ancestry: ["SourceFile"] },
);
assertSignature("validateCommandSemantics", semanticsCut, {
  params: 1,
  ancestry: ["SourceFile"],
});
function semanticsFunction(name: string): string {
  for (const statement of semanticsFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement.getText(semanticsFile);
    }
  }
  throw new Error(`semantics helper '${name}' was not found`);
}
function semanticsInitializer(name: string): string {
  for (const statement of semanticsFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer
      ) {
        return declaration.initializer.getText(semanticsFile);
      }
    }
  }
  throw new Error(`semantics constant '${name}' was not found`);
}
const semanticsConstants = [
  "Me",
  "z",
  "ka",
  "Ea",
  "Ra",
  "i_n",
  "mKe",
  "TLe",
  "s_n",
  "Ao",
  "eyt",
  "a_n",
  "l_n",
  "rt",
  "To",
  "Io",
  "qa",
  "Qn",
  "Ht",
  "cWt",
  "o_n",
  "J_t",
  "Q_t",
  "fKe",
  "uWt",
  "Ya",
  "Z_t",
];
const semanticsBindings: Record<string, unknown> = {};
for (const name of semanticsConstants) {
  semanticsBindings[name] = evaluateValue(semanticsInitializer(name));
}
semanticsBindings.Qa = evaluateFunction(semanticsFunction("Qa"), "Qa", {
  Me: semanticsBindings.Me,
  z: semanticsBindings.z,
});
semanticsBindings.Gt = evaluateFunction(semanticsFunction("Gt"), "Gt", {
  Me: semanticsBindings.Me,
  z: semanticsBindings.z,
});
semanticsBindings.Xo = evaluateFunction(semanticsFunction("Xo"), "Xo", {});
semanticsBindings.Td = (record: Record<string, unknown>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined;
semanticsBindings.z_n = SHELL_KEYWORDS;
const upstreamSemantics = evaluateFunction(
  semanticsCut.original,
  semanticsCut.label,
  semanticsBindings,
);

console.log(`bash compound safety parity vs pinned bytes @ ${ENGINE_VERSION}`);

const semanticRecords = SEMANTIC_RECORDS;
for (const record of semanticRecords) {
  eq(
    `validateCommandSemantics ${record.text}`,
    validateCommandSemantics([record]),
    upstreamSemantics([record]),
  );
}
const safeSemantics = validateCommandSemantics([semanticRecords[0]]);
const unsafeSemantics = validateCommandSemantics([semanticRecords[4]]);
mustDiffer("bQn safe command versus jq system()", safeSemantics, unsafeSemantics);

// The hand cases name the failures. The full C13a partition then supplies the
// breadth: every simple result produced by the separately-graded owned KTe is
// fed to both bQn implementations.
const classifyForSemantics = createCommandClassifier(() => false);
let semanticCorpusChecks = 0;
for (const partition of PARTITIONS) {
  for (const command of partition.cases) {
    const root = getParser().parse(command);
    if (!root) continue;
    const classified = classifyForSemantics(
      command,
      root as Parameters<typeof classifyForSemantics>[1],
    );
    if (classified.kind !== "simple") continue;
    eq(
      `validateCommandSemantics corpus/${partition.name}/${semanticCorpusChecks}`,
      validateCommandSemantics(classified.commands),
      upstreamSemantics(classified.commands),
    );
    semanticCorpusChecks++;
  }
}
if (semanticCorpusChecks < 450) {
  failures.push(
    `SEMANTICS CORPUS FLOOR: expected at least 450 simple classifier cases, ran ${semanticCorpusChecks}`,
  );
}

for (const command of HELPER_CASES.split) {
  eq(
    `splitSubcommands ${JSON.stringify(command)}`,
    splitSubcommands(command),
    upstreamSplit(command),
  );
}
for (const command of HELPER_CASES.argv) {
  eq(`commandArgv ${JSON.stringify(command.slice(0, 40))}`, commandArgv(command), upstreamArgv(command));
}
for (const command of HELPER_CASES.normalize) {
  eq(
    `normalizeCommandPrefix ${JSON.stringify(command)}`,
    normalizeCommandPrefix(command),
    upstreamNormalize(command),
  );
}
const inheritedShellPrefix = HELPER_CASES.normalize.find((command) =>
  command.startsWith("SHELL="),
)!;
eq(
  "normalizeCommandPrefix keeps non-cW SHELL assignment",
  normalizeCommandPrefix(inheritedShellPrefix),
  upstreamNormalize(inheritedShellPrefix),
);
mustDiffer(
  "Ah cW allowlist versus inherited-environment mutant",
  normalizeCommandPrefix(inheritedShellPrefix),
  "echo ok",
);

for (const argv of HELPER_CASES.peel) {
  eq(
    `peelCommandPrefixes ${JSON.stringify(argv)}`,
    peelCommandPrefixes(argv),
    upstreamPeel(argv),
  );
}

// Every shared pipe row is graded against the pinned entry, including rows
// whose dedicated assertions below exist only to name a stronger contract.
for (const fixture of PIPE_CASES) {
  const root =
    fixture.root === "parsed"
      ? getParser().parse(fixture.command)
      : fixture.root === "sentinel"
        ? PARSE_ABORTED
        : undefined;
  await comparePipe(
    `shared pipe corpus/${fixture.tag}`,
    fixture.command,
    sharedPipePlan(fixture.tag),
    { root },
  );
}

// PIPE + REDIRECT: output redirection is removed before the first permission
// check and from the ordered Map key.
const pipeRedirect = await comparePipe(
  "pipe redirect",
  sharedPipeCase("pipe-redirect").command,
  sharedPipePlan("pipe-redirect"),
);
eq("pipe redirect ordered subcommandResults", pipeRedirect.decisionReason, {
  type: "subcommandResults",
  reasons: new Map([
    ["echo alpha", { behavior: "allow", updatedInput: { command: "echo alpha" } }],
    [
      "grep alpha",
      {
        behavior: "ask",
        message: "grep asks",
        suggestions: [{ type: "addRules", rules: ["grep"] }],
      },
    ],
  ]),
});
eq("pipe redirect suggestions", pipeRedirect.suggestions, [
  { type: "addRules", rules: ["grep"] },
]);
const noPipe = await comparePipe(
  "pipe negative: no operator",
  sharedPipeCase("no-pipe").command,
  sharedPipePlan("no-pipe"),
);
eq("no-pipe fallback", noPipe, {
  behavior: "passthrough",
  message: "No pipes found in command",
});
mustDiffer("pipe operator changes the decision", pipeRedirect, noPipe);

// Bare redirect: a passthrough from the path layer is upgraded to allow while
// retaining the original segment as the Map key.
const bareRedirect = await comparePipe(
  "bare redirect",
  sharedPipeCase("bare-redirect").command,
  sharedPipePlan("bare-redirect"),
);
eq("bare redirect original key and upgrade", bareRedirect.decisionReason, {
  type: "subcommandResults",
  reasons: new Map([
    [
      "> out",
      {
        behavior: "allow",
        updatedInput: { command: "> out", description: "case:bare redirect" },
        decisionReason: {
          type: "other",
          reason: "Bare output redirection with no command; path layer approved",
        },
      },
    ],
    ["cat", { behavior: "allow", updatedInput: { command: "cat" } }],
  ]),
});
const quotedRedirect = await comparePipe(
  "redirect negative: quoted operator",
  sharedPipeCase("quoted-redirect").command,
  sharedPipePlan("quoted-redirect"),
);
eq("quoted redirect remains text", [...quotedRedirect.decisionReason.reasons.keys()], [
  "echo '>'",
  "cat",
]);
mustDiffer("redirection syntax differs from quoted text", bareRedirect, quotedRedirect);

// SUBSHELL: compound safety wins before permission effects. Quoted parens are
// the negative control and proceed as an ordinary pipe.
const subshell = await comparePipe(
  "subshell",
  sharedPipeCase("subshell").command,
  sharedPipePlan("subshell"),
);
eq("subshell shell-operator decision", subshell, {
  behavior: "ask",
  message: "This command uses shell operators that require approval for safety",
  decisionReason: {
    type: "other",
    reason: "This command uses shell operators that require approval for safety",
    bashMissKind: "shell-operators",
  },
});
const quotedSubshell = await comparePipe(
  "subshell negative: quoted parens",
  sharedPipeCase("quoted-subshell").command,
  sharedPipePlan("quoted-subshell"),
);
eq("quoted parens reach both parts", [...quotedSubshell.decisionReason.reasons.keys()], [
  "echo '(alpha)'",
  "cat",
]);
mustDiffer("real and quoted subshells diverge", subshell, quotedSubshell);

// DRN'S LIVE-BUT-DARK Fy CALLER: a bypass-immune safety check from either cd
// is returned intact. Blinding Fy changes the exact outcome to the generic
// multi-cd ask; a non-bypass-immune check is the named input control.
const dangerousSafety = DANGEROUS_SAFETY_REASON;
const multiCdPlan: SidePlan = {
  decide: (command) =>
    command === AGGREGATE_CASES.multiCd.normalized[0]
      ? { behavior: "ask", message: "inner safety", decisionReason: dangerousSafety }
      : { behavior: "allow", updatedInput: { command } },
};
const multiCdSide = makeSide(multiCdPlan);
let drnFyCalls = 0;
const upstreamMultiCd = await buildUpstreamAggregate(
  multiCdSide,
  (reason: unknown, accept: AnyFn) => {
    drnFyCalls++;
    return findSafetyCheckReason(reason, accept);
  },
)(
  AGGREGATE_CASES.multiCd.input,
  AGGREGATE_CASES.multiCd.normalized,
  AGGREGATE_CASES.multiCd.original,
  multiCdSide.checkPermission,
  classifiers,
  undefined,
  multiCdSide.isCdGitSequenceSafe,
);
const ownedMultiCdSide = makeSide(multiCdPlan);
const ownedMultiCd = await aggregateSubcommandPermissions(
  AGGREGATE_CASES.multiCd.input,
  AGGREGATE_CASES.multiCd.normalized,
  AGGREGATE_CASES.multiCd.original,
  {
    checkPermission: ownedMultiCdSide.checkPermission,
    classifiers,
    effects: {
      currentWorkingDirectory: () => EFFECT_STATE.cwd,
      hasUnsafeGitStructureFromAnalysis: (analyses: unknown) =>
        ownedMultiCdSide.hasUnsafeGitStructure("<analysis>", analyses),
      hasUnsafeGitStructureFromCommand: (command: string) =>
        ownedMultiCdSide.hasUnsafeGitStructure(command, undefined),
      isCdGitSequenceSafe: ownedMultiCdSide.isCdGitSequenceSafe,
    },
  },
);
eq("drn multi-cd Fy full decision", ownedMultiCd, upstreamMultiCd);
eq("drn multi-cd directly invokes Fy", drnFyCalls, 1);
eq("drn multi-cd preserves bypass-immune inner result", ownedMultiCd, {
  behavior: "ask",
  message: "inner safety",
  decisionReason: dangerousSafety,
});
const blindMultiCdSide = makeSide(multiCdPlan);
const drnFyBlindMutant = await buildUpstreamAggregate(blindMultiCdSide, () => undefined)(
  AGGREGATE_CASES.multiCd.input,
  AGGREGATE_CASES.multiCd.normalized,
  AGGREGATE_CASES.multiCd.original,
  blindMultiCdSide.checkPermission,
  classifiers,
  undefined,
  blindMultiCdSide.isCdGitSequenceSafe,
);
eq("drn Fy-blind mutant outcome", drnFyBlindMutant, {
  behavior: "ask",
  decisionReason: {
    type: "other",
    reason: "Multiple directory changes in one command require approval for clarity",
    bashMissKind: "multi-cd",
  },
  message: "Multiple directory changes in one command require approval for clarity",
});
mustDiffer("drn multi-cd Fy-blind mutant", upstreamMultiCd, drnFyBlindMutant);
// A strings-only production-shape candidate reaches the same drn/Fy edge
// through the real parser and every preceding compound check. The first `cd`
// would short-circuit the shell command if it were ever executed, but this
// contract never spawns it: the names are inert parser input only.
const inertFyCommand =
  "cd __c13b_missing_a__ && rm -rf __c13b_missing_target__/* | " +
  "cd __c13b_missing_b__";
const inertFyRoot = getParser().parse(inertFyCommand);
const inertFyAnalysis = createCommandAnalysis(inertFyCommand, inertFyRoot);
if (!inertFyRoot || !inertFyAnalysis) {
  throw new Error("inert drn/Fy parser fixture did not produce an analysis");
}
eq("inert drn/Fy parser root", (inertFyRoot as any).type, "program");
eq("inert drn/Fy pipe structure", inertFyAnalysis.getPipeSegments(), [
  "cd __c13b_missing_a__ && rm -rf __c13b_missing_target__/*",
  "cd __c13b_missing_b__",
]);
const pinnedDangerousRemovalDecision = evaluateScoped(
  functionSource("Bw"),
  "Bw",
  {},
);
const dangerousRemovalPorts = {
  pL: {
    rm: (args: string[]) => args.filter((argument) => !argument.startsWith("-")),
  },
  Qo: (_filesystem: unknown, path: string) => ({ resolvedPath: path }),
  le: () => ({}),
  te: (values: string[]) => [...new Set(values)],
  TT: () => [],
  Rm: (path: string) => path,
  uL: isAbsolute,
  r8e: resolve,
  Enn: normalize,
  Bw: pinnedDangerousRemovalDecision,
  Cnn: sep,
  kze: () => false,
  Qa: () => false,
  Bn: () => false,
  pwe: () => false,
  nf: () => false,
  Q: (values: unknown[], accept: (value: unknown) => boolean) =>
    values.filter(accept).length,
};
const dangerousRemovalArgs = ["-rf", "__c13b_missing_target__/*"];
const pinnedInertRemoval = evaluateScoped(
  functionSource("dL"),
  "dL",
  dangerousRemovalPorts,
)("rm", dangerousRemovalArgs, EFFECT_STATE.cwd, { mode: "default" }, true);
const ownedInertRemoval = checkBashDangerousRemoval(
  "rm",
  dangerousRemovalArgs,
  EFFECT_STATE.cwd,
  { mode: "default" },
  true,
  {
    pathArgumentExtractors: dangerousRemovalPorts.pL,
    resolvePathPolicy: dangerousRemovalPorts.Qo,
    filesystem: dangerousRemovalPorts.le,
    uniqueValues: dangerousRemovalPorts.te,
    allowedDirectories: dangerousRemovalPorts.TT,
    expandHomePath: dangerousRemovalPorts.Rm,
    isAbsolutePath: dangerousRemovalPorts.uL,
    resolvePath: dangerousRemovalPorts.r8e,
    normalizePath: dangerousRemovalPorts.Enn,
    dangerousRemovalDecision: dangerousRemovalPorts.Bw,
    pathSeparator: dangerousRemovalPorts.Cnn,
    hasUnsafeGlobRoot: dangerousRemovalPorts.kze,
    hasUnknownTrackedValue: dangerousRemovalPorts.Qa,
    hasBlockedPathShape: dangerousRemovalPorts.Bn,
    isCriticalPath: dangerousRemovalPorts.pwe,
    pathContains: dangerousRemovalPorts.nf,
    countMatching: dangerousRemovalPorts.Q,
  },
);
eq("inert relative-glob dL full decision", ownedInertRemoval, pinnedInertRemoval);
eq(
  "inert relative-glob dL emits dangerousRemoval",
  ownedInertRemoval.decisionReason?.circuitBreaker,
  "dangerousRemoval",
);
let inertPermissionCalls = 0;
const inertSafetyDecision = ownedInertRemoval;
const inertFyPlan: SidePlan = {
  decide(command) {
    inertPermissionCalls++;
    return command.includes("rm -rf ")
      ? inertSafetyDecision
      : { behavior: "allow", updatedInput: { command } };
  },
};
const inertFyDecision = await comparePipe(
  "inert production-shape drn/Fy",
  inertFyCommand,
  inertFyPlan,
  { root: inertFyRoot, analyses: inertFyAnalysis },
);
eq("inert drn/Fy passes preceding checks to both pipe segments", inertPermissionCalls, 4);
eq("inert drn/Fy preserves model-visible dangerous-removal reason", inertFyDecision, inertSafetyDecision);
const inertBlindSide = makeSide({
  decide(command) {
    return command.includes("rm -rf ")
      ? inertSafetyDecision
      : { behavior: "allow", updatedInput: { command } };
  },
});
const inertFyBlind = await buildUpstreamPipe(inertBlindSide, () => undefined)(
  { command: inertFyCommand, description: "case:inert drn/Fy blind" },
  inertBlindSide.checkPermission,
  classifiers,
  inertFyRoot,
  inertFyAnalysis,
  inertBlindSide.isCdGitSequenceSafe,
);
eq("inert drn/Fy blinded decision", inertFyBlind, drnFyBlindMutant);
mustDiffer("inert drn/Fy versus blinded edge", inertFyDecision, inertFyBlind);

const ordinaryCd = await comparePipe(
  "two-cd negative: ordinary asks",
  sharedPipeCase("two-cd-ordinary").command,
  sharedPipePlan("two-cd-ordinary"),
);
eq("ordinary safety check does not bypass multi-cd", ordinaryCd, drnFyBlindMutant);
mustDiffer("bypass-immune and ordinary safety checks diverge", upstreamMultiCd, ordinaryCd);

const oneCd = await comparePipe(
  "two-cd negative: one cd",
  sharedPipeCase("one-cd").command,
  sharedPipePlan("one-cd"),
);
eq("one-cd remains aggregate allow", [...oneCd.decisionReason.reasons.keys()], [
  "cd one",
  "pwd",
]);
mustDiffer("one cd does not trigger multi-cd", upstreamMultiCd, oneCd);

// DRN DUPLICATE Map semantics: last value wins without moving the first key.
const duplicateLastAllow = await comparePipe(
  "drn duplicate last allow",
  sharedPipeCase("duplicate-last-allow").command,
  sharedPipePlan("duplicate-last-allow"),
);
eq("drn duplicate overwrite", duplicateLastAllow.decisionReason, {
  type: "subcommandResults",
  reasons: new Map([
    ["printf x", { behavior: "allow", updatedInput: { command: "printf x" } }],
  ]),
});
const distinctFirstDeny = await comparePipe(
  "drn duplicate negative: distinct keys",
  sharedPipeCase("distinct-first-deny").command,
  sharedPipePlan("distinct-first-deny"),
);
eq("distinct keys preserve first deny", distinctFirstDeny, {
  behavior: "deny",
  message: "first deny",
  decisionReason: {
    type: "subcommandResults",
    reasons: new Map([
      ["printf x", { behavior: "deny", message: "first deny" }],
      ["printf y", { behavior: "allow" }],
    ]),
  },
});
mustDiffer("duplicate and distinct Map keys", duplicateLastAllow, distinctFirstDeny);

// JRN'S LIVE-BUT-DARK Fy CALLER. Drive the separately anchored pinned
// function to the duplicate merge with the minimum syntax (`echo x; echo x`)
// and permission/config state derived from its guards.
const permissionChainSource = targetText("checkBashPermissionCore");
const permissionChainLabel = targetLabel("checkBashPermissionCore");

function runPermissionChainDuplicate(
  blindFy: boolean,
  subcommand = "echo x",
): Promise<Decision> {
  const analyses = [
    { text: subcommand, argv: subcommand.split(" "), redirects: [] },
    { text: subcommand, argv: subcommand.split(" "), redirects: [] },
  ];
  const preliminary = [
    { behavior: "ask", message: "pre one" },
    { behavior: "ask", message: "pre two" },
  ];
  const merged = [
    {
      behavior: "ask",
      message: "ordinary duplicate",
      decisionReason: { type: "other", reason: "ordinary duplicate" },
      suggestions: [],
    },
    {
      behavior: "ask",
      message: "safety duplicate",
      decisionReason: dangerousSafety,
      suggestions: [],
    },
  ];
  let preliminaryAt = 0;
  let mergedAt = 0;
  const bindings: Record<string, unknown> = {
    he: () => ({}),
    x9e: () => undefined,
    pEe: async () => ({}),
    KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
    bQn: () => ({ ok: true }),
    A8e: () => null,
    aQ: () => ({ behavior: "passthrough", message: "base" }),
    w8e: async () => ({ behavior: "passthrough", message: "No pipes found" }),
    $ct: unreachable("recursive permission entry"),
    Lb: () => false,
    LP: () => false,
    $rn: async () => false,
    ee: () => "/pinned/cwd",
    D: () => "macos",
    LC: (value: unknown) => value,
    Drn: () => ({ subcommands: [subcommand, subcommand], astCommandsByIdx: analyses }),
    tQ: () => false,
    iW: () => false,
    j8e: () => preliminary[preliminaryAt++],
    I8: () => ({ behavior: "passthrough", message: "path layer" }),
    r_e: () => false,
    Q: (values: Decision[], accept: (value: Decision) => boolean) =>
      values.filter(accept).length,
    C8e: async () => merged[mergedAt++],
    Fy: blindFy ? () => undefined : findSafetyCheckReason,
    yKe: (updates: any[] | undefined) =>
      updates?.flatMap((update) => update.type === "addRules" ? update.rules : []) ?? [],
    eo: (value: unknown) => stable(value),
    w3e: () => [{
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: `${subcommand} *` }],
      behavior: "allow",
      destination: "localSettings",
    }],
    brn: 5,
    ql: shellMessage,
    yi: { name: "Bash" },
    Ze: Error,
  };
  return evaluateScoped(permissionChainSource, permissionChainLabel, bindings)(
    { command: `${subcommand}; ${subcommand}` },
    {
      sessionEnvVars: new Map(),
      forRemoteExecution: false,
      abortController: { signal: { aborted: false } },
      options: { isNonInteractiveSession: true },
    },
    undefined,
  );
}

const jrnHealthy = await runPermissionChainDuplicate(false);
eq("jrn duplicate tie-break selects safety result", jrnHealthy.decisionReason, {
  type: "subcommandResults",
  reasons: new Map([
    [
      "echo x",
      {
        behavior: "ask",
        message: "safety duplicate",
        decisionReason: dangerousSafety,
        suggestions: [],
      },
    ],
  ]),
});
const jrnFyBlindMutant = await runPermissionChainDuplicate(true);
eq("jrn Fy-blind mutant keeps first equal-severity result", jrnFyBlindMutant.decisionReason, {
  type: "subcommandResults",
  reasons: new Map([
    [
      "echo x",
      {
        behavior: "ask",
        message: "ordinary duplicate",
        decisionReason: { type: "other", reason: "ordinary duplicate" },
        suggestions: [],
      },
    ],
  ]),
});
mustDiffer("jrn duplicate tie-break Fy-blind mutant", jrnHealthy, jrnFyBlindMutant);

// The owned jrn is driven through the same tie-break with real folded control
// flow. The only scheduled variation is the path-policy effect: identical
// `rm x` occurrences first produce two preliminary asks, then an ordinary and
// a safety-check ask at the final decision pass. The required j8e/C8e ports
// expose exactly those four decisions to Fy's equal-severity tie-break.
{
  const subcommand = AGGREGATE_CASES.duplicateCore.subcommand;
  const analyses = [
    {
      text: subcommand,
      argv: ["rm", "x"],
      envVars: [],
      redirects: [],
      hasUnquotedGlob: false,
    },
    {
      text: subcommand,
      argv: ["rm", "x"],
      envVars: [],
      redirects: [],
      hasUnquotedGlob: false,
    },
  ];
  let removals = 0;
  const removalSchedule = DUPLICATE_REMOVAL_SCHEDULE;
  const permissionContext = { mode: "default" };
  const effects = {
    readPermissionContext: () => permissionContext,
    replaceSessionEnvironmentKeys: () => undefined,
    emitTelemetry: () => undefined,
    isSubprocessEnvironmentScrubbingEnabled: () => false,
    currentWorkingDirectory: () => "/pinned/cwd",
    platform: () => "macos",
    homeDirectory: () => "/pinned/home",
    spawnEnvironmentKeys: () => new Set<string>(),
    matchRules: () => ({ deny: [], ask: [], allow: [] }),
    validatePath: () => ({ behavior: "allow" }),
    checkDangerousRemoval: () => ({ behavior: "passthrough" }),
    checkSandboxAutoAllow: () => null,
    checkExactPermission: () => ({ behavior: "passthrough", message: "base" }),
    checkPathSafety: () => ({ behavior: "passthrough", message: "path layer" }),
    checkDirectCommand: () => removalSchedule[removals++],
    checkSubcommandPermission: async () => removalSchedule[removals++ + 2],
    isSandboxingEnabled: () => false,
    isAutoAllowBashIfSandboxedEnabled: () => false,
    isSandboxEligible: () => false,
    isRestrictedContext: () => false,
    hasUnsafeGitStructureFromAnalysis: () => false,
    hasUnsafeGitStructureFromCommand: () => false,
    isCdGitSequenceSafe: async () => false,
  };
  const owned = await checkBashPermissionCore(
    { command: `${subcommand}; ${subcommand}` },
    {
      sessionEnvVars: new Map(),
      forRemoteExecution: false,
      abortController: { signal: { aborted: false } },
      options: { isNonInteractiveSession: true },
    },
    undefined,
    {
      effects,
      classifyCommand: () => ({
        kind: "simple",
        commands: analyses,
        bareAssignmentNames: [],
      }),
      classifyReadOnly: () => ({ behavior: "passthrough" }),
      isNormalizedCdCommand: () => false,
      isNormalizedGitCommand: () => false,
      permissionSuggestions: () => [],
    },
  );
  const upstream = await runPermissionChainDuplicate(false, subcommand);
  eq("owned jrn duplicate tie-break full decision", owned, upstream);
  eq("owned jrn reaches four scheduled direct decisions", removals, 4);
  eq("owned jrn duplicate safety winner", owned.decisionReason.reasons, new Map([
    [
      subcommand,
      {
        behavior: "ask",
        message: "safety duplicate",
        decisionReason: dangerousSafety,
        suggestions: [],
      },
    ],
  ]));
}

// Parse entry: valid supplied roots and the imported sentinel both match; an
// over-length command is the named parse-failure control.
const rootCommand = sharedPipeCase("supplied-root").command;
const root = getParser().parse(rootCommand);
if (!root) throw new Error("root fixture failed to parse");
const validParse = await comparePipe(
  "supplied root",
  rootCommand,
  sharedPipePlan("supplied-root"),
  { root },
);
await comparePipe(
  "parse sentinel fallback",
  rootCommand,
  sharedPipePlan("sentinel-root"),
  { root: PARSE_ABORTED },
);
const parseFailure = await comparePipe(
  "parse negative: over length",
  sharedPipeCase("over-length").command,
  sharedPipePlan("over-length"),
);
eq("over-length parse fallback", parseFailure, {
  behavior: "passthrough",
  message: "Failed to parse command",
});
mustDiffer("valid and failed parse", validParse, parseFailure);

// pnn stops at variable assignments; nested command substitutions are opaque segments.
{
  const fixture = sharedPipeCase("nested-subshell-in-assignment");
  const root = getParser().parse(fixture.command);
  if (!root) throw new Error("nested assignment fixture failed to parse");
  const pinnedCompound = evaluateScoped(functionSource("pnn"), "pnn", {})(
    root,
    fixture.command,
  );
  const pinnedAnalysis = {
    getTreeSitterAnalysis: () => ({ compoundStructure: pinnedCompound }),
    getPipeSegments: () => [fixture.command],
  };
  const plan = sharedPipePlan("nested-subshell-in-assignment");
  const upstreamSide = makeSide(plan);
  const ownedSide = makeSide(plan);
  const input = { command: fixture.command };
  const expected = await buildUpstreamParsed(upstreamSide)(
    input,
    upstreamSide.checkPermission,
    classifiers,
    pinnedAnalysis,
    undefined,
    upstreamSide.isCdGitSequenceSafe,
  );
  const analysis = createCommandAnalysis(fixture.command, root);
  if (!analysis) throw new Error("owned nested assignment analysis missing");
  const owned = await checkParsedPipeSafety(input, analysis, {
    checkPermission: ownedSide.checkPermission,
    classifiers,
    effects: {
      currentWorkingDirectory: () => EFFECT_STATE.cwd,
      hasUnsafeGitStructureFromAnalysis: () => false,
      hasUnsafeGitStructureFromCommand: () => false,
      isCdGitSequenceSafe: ownedSide.isCdGitSequenceSafe,
    },
  });
  eq("pnn assignment boundary full decision", owned, expected);
  eq("pnn assignment boundary has no nested subshell", analysis.getTreeSitterAnalysis()?.compoundStructure.hasSubshell, false);
  mustDiffer("pnn assignment boundary versus recursive-walk mutant", owned, {
    behavior: "ask",
    decisionReason: { type: "other", bashMissKind: "shell-operators" },
  });
}

// Direct middle entries prove each owned anchor is independently callable.
{
  const plan: SidePlan = {
    decide: (command) => ({
      behavior: "ask",
      message: `${command} asks`,
      suggestions: [command],
    }),
  };
  const upstreamSide = makeSide(plan);
  const ownedSide = makeSide(plan);
  const input = AGGREGATE_CASES.direct.input;
  const upstream = await buildUpstreamAggregate(upstreamSide)(
    input,
    AGGREGATE_CASES.direct.normalized,
    AGGREGATE_CASES.direct.original,
    upstreamSide.checkPermission,
    classifiers,
    undefined,
    upstreamSide.isCdGitSequenceSafe,
  );
  const owned = await aggregateSubcommandPermissions(
    input,
    AGGREGATE_CASES.direct.normalized,
    AGGREGATE_CASES.direct.original,
    {
      checkPermission: ownedSide.checkPermission,
      classifiers,
      effects: {
        currentWorkingDirectory: () => EFFECT_STATE.cwd,
      hasUnsafeGitStructureFromAnalysis: (analyses: unknown) =>
          ownedSide.hasUnsafeGitStructure("<analysis>", analyses),
        hasUnsafeGitStructureFromCommand: (command: string) =>
          ownedSide.hasUnsafeGitStructure(command, undefined),
        isCdGitSequenceSafe: ownedSide.isCdGitSequenceSafe,
      },
    },
  );
  eq("direct aggregate decision", owned, upstream);
  eq("direct aggregate trace", ownedSide.trace, upstreamSide.trace);
}
for (const fixture of AGGREGATE_CASES.preValidator) {
  const plan: SidePlan = {
    decide(_command, call) {
      return structuredClone(
        fixture.decisions[call] ?? {
          behavior: "deny",
          message: `shared aggregate ${fixture.tag}: permission effect should be unreachable`,
        },
      ) as Decision;
    },
  };
  const upstreamSide = makeSide(plan);
  const ownedSide = makeSide(plan);
  const upstream = await buildUpstreamAggregate(upstreamSide)(
    fixture.input,
    fixture.normalized,
    fixture.original,
    upstreamSide.checkPermission,
    classifiers,
    undefined,
    upstreamSide.isCdGitSequenceSafe,
  );
  const owned = await aggregateSubcommandPermissions(
    fixture.input,
    fixture.normalized,
    fixture.original,
    {
      checkPermission: ownedSide.checkPermission,
      classifiers,
      effects: {
        currentWorkingDirectory: () => EFFECT_STATE.cwd,
        hasUnsafeGitStructureFromAnalysis: (analyses: unknown) =>
          ownedSide.hasUnsafeGitStructure("<analysis>", analyses),
        hasUnsafeGitStructureFromCommand: (command: string) =>
          ownedSide.hasUnsafeGitStructure(command, undefined),
        isCdGitSequenceSafe: ownedSide.isCdGitSequenceSafe,
      },
    },
  );
  eq(`shared aggregate ${fixture.tag} decision`, owned, upstream);
  eq(`shared aggregate ${fixture.tag} trace`, ownedSide.trace, upstreamSide.trace);
}
{
  const command = "echo direct | cat";
  const analysis = createCommandAnalysis(command);
  if (!analysis) throw new Error("direct parsed fixture failed");
  const plan: SidePlan = {
    decide: (part) => ({ behavior: "allow", updatedInput: { command: part } }),
  };
  const upstreamSide = makeSide(plan);
  const ownedSide = makeSide(plan);
  const input = { command };
  const upstream = await buildUpstreamParsed(upstreamSide)(
    input,
    upstreamSide.checkPermission,
    classifiers,
    analysis,
    undefined,
    upstreamSide.isCdGitSequenceSafe,
  );
  const owned = await checkParsedPipeSafety(input, analysis, {
    checkPermission: ownedSide.checkPermission,
    classifiers,
    effects: {
      currentWorkingDirectory: () => EFFECT_STATE.cwd,
      hasUnsafeGitStructureFromAnalysis: (analyses: unknown) =>
        ownedSide.hasUnsafeGitStructure("<analysis>", analyses),
      hasUnsafeGitStructureFromCommand: (command: string) =>
        ownedSide.hasUnsafeGitStructure(command, undefined),
      isCdGitSequenceSafe: ownedSide.isCdGitSequenceSafe,
    },
  });
  eq("direct parsed decision", owned, upstream);
  eq("direct parsed trace", ownedSide.trace, upstreamSide.trace);
}

// ANCHORED ROOT ($ct): an over-length command under a non-empty clamp is
// unverifiable and denied before jrn. The trace proves both the parser abort
// and clamp-denial telemetry are observable effects, in order.
{
  const source = targetText("checkBashPermission");
  const readContext = mustMatch(
    source,
    /let [\w$]+=([A-Za-z_$][\w$]*)\([\w$]+\)\.bashCommandClamps/,
    1,
    "root context reader",
  );
  const clampCheck = mustMatch(
    source,
    /let [\w$]+=await ([A-Za-z_$][\w$]*)\([\w$]+,[\w$]+\)/,
    1,
    "root clamp checker",
  );
  const telemetry = mustMatch(
    source,
    /return ([A-Za-z_$][\w$]*)\("tengu_bash_command_clamp_denied"/,
    1,
    "root telemetry",
  );
  const tool = mustMatch(source, /\$\{([A-Za-z_$][\w$]*)\.name}/, 1, "root tool");
  const reason = mustMatch(
    source,
    /decisionReason:\{type:"other",reason:([A-Za-z_$][\w$]*)}/,
    1,
    "root clamp reason",
  );
  const upstreamTrace: string[] = [];
  const ownedTrace: string[] = [];
  const permissionContext = ROOT_CASES.clampedOverLength.permissionContext;
  const rootBindings: Record<string, unknown> = {
    [readContext]: () => permissionContext,
    [clampCheck]: async (input: { command: string }, groups: unknown[]) => {
      upstreamTrace.push(`tengu_tree_sitter_parse_abort:${input.command.length}`);
      return { span: input.command.trim(), group: groups[0], kind: "unverifiable" };
    },
    [telemetry]: (event: string, data: { groupCount?: number }) => {
      upstreamTrace.push(`${event}:${data.groupCount ?? ""}`);
    },
    [tool]: { name: "Bash" },
    [reason]: "bashCommandClamp: no clamp rule matches this command",
  };
  const rootOracle = evaluateScoped(source, targetLabel("checkBashPermission"), rootBindings);
  const input = ROOT_CASES.clampedOverLength.input;
  const upstream = await rootOracle(input, {}, undefined);
  const owned = await checkBashPermission(input, {}, undefined, {
    effects: {
      readPermissionContext: () => permissionContext,
      emitTelemetry(event: string, data: { cmdLength?: number; groupCount?: number }) {
        ownedTrace.push(
          `${event}:${data.cmdLength ?? data.groupCount ?? ""}`,
        );
      },
    },
  });
  eq("$ct over-length clamp full decision", owned, upstream);
  eq("$ct over-length clamp effect order", ownedTrace, upstreamTrace);
  eq("$ct over-length clamp reason", owned.decisionReason, {
    type: "other",
    reason: "bashCommandClamp: no clamp rule matches this command",
  });
  mustDiffer("$ct clamp denial versus unclamped failure helper", owned, undefined);
}

// The other $ct arm is reached through the folded jrn rather than a stub on the
// owned side: a read-only `echo` is allowed by core, then the root turns a real
// background operator into a non-classifier-approvable safety ask.
{
  const source = targetText("checkBashPermission");
  const readContext = mustMatch(
    source,
    /let [\w$]+=([A-Za-z_$][\w$]*)\([\w$]+\)\.bashCommandClamps/,
    1,
    "background root context",
  );
  const core = mustMatch(
    source,
    /let [\w$]+=await ([A-Za-z_$][\w$]*)\([\w$]+,[\w$]+,[\w$]+\)/,
    1,
    "background root core",
  );
  const decorate = mustMatch(
    source,
    /return ([A-Za-z_$][\w$]*)\([\w$]+,[\w$]+,[A-Za-z_$][\w$]*\([\w$]+\)\)/,
    1,
    "background root decorator",
  );
  const parser = mustMatch(
    source,
    /let [\w$]+=await ([A-Za-z_$][\w$]*)\([\w$]+\.command\)/,
    1,
    "background root parser",
  );
  const sentinel = mustMatch(source, /!==([A-Za-z_$][\w$]*)&&/, 1, "background root sentinel");
  const unsafeTree = mustMatch(source, /&&!([A-Za-z_$][\w$]*)\([\w$]+\)\)/, 1, "background tree check");
  const message = mustMatch(source, /message:([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\.name,/, 1, "background message");
  const tool = mustMatch(source, /message:[A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\.name,/, 1, "background tool");
  const autoAllow = mustMatch(source, /\.reason===([A-Za-z_$][\w$]*)\)/, 1, "sandbox auto-allow reason");
  const permissionContext = ROOT_CASES.background.permissionContext;
  const upstream = await evaluateScoped(source, targetLabel("checkBashPermission"), {
    [readContext]: () => permissionContext,
    [core]: async (input: unknown) => ({
      behavior: "allow",
      updatedInput: input,
      decisionReason: { type: "subcommandResults", reasons: new Map() },
    }),
    [decorate]: (decision: unknown) => decision,
    [parser]: async (command: string) => getParser().parse(command),
    [sentinel]: PARSE_ABORTED,
    [unsafeTree]: evaluateFunction(functionSource(unsafeTree), unsafeTree, {}),
    [message]: shellMessage,
    [tool]: { name: "Bash" },
    [autoAllow]: "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)",
  })(ROOT_CASES.background.input, {}, undefined);
  const effects = {
    readPermissionContext: () => permissionContext,
    replaceSessionEnvironmentKeys: () => undefined,
    emitTelemetry: () => undefined,
    isSubprocessEnvironmentScrubbingEnabled: () => false,
    currentWorkingDirectory: () => "/pinned/cwd",
    platform: () => "macos",
    homeDirectory: () => "/pinned/home",
    spawnEnvironmentKeys: () => new Set<string>(),
    matchRules: () => ({ deny: [], ask: [], allow: [] }),
    validatePath: () => ({ behavior: "allow" }),
    checkDirectCommand: (input: unknown) => ({
      behavior: "allow",
      updatedInput: input,
      decisionReason: { type: "other", reason: "Read-only command is allowed" },
    }),
    checkSubcommandPermission: async () => ({ behavior: "passthrough" }),
    isSandboxingEnabled: () => false,
    isAutoAllowBashIfSandboxedEnabled: () => false,
    isSandboxEligible: () => false,
    isRestrictedContext: () => false,
    hasUnsafeGitStructureFromAnalysis: () => false,
    hasUnsafeGitStructureFromCommand: () => false,
    isCdGitSequenceSafe: async () => false,
  };
  const owned = await checkBashPermission(
    ROOT_CASES.background.input,
    {
      sessionEnvVars: new Map(),
      forRemoteExecution: false,
      abortController: { signal: { aborted: false } },
      options: { isNonInteractiveSession: true },
    },
    undefined,
    {
      effects: {
        ...effects,
        decorateDecision: (decision: unknown) => decision,
      },
      checkCore: async (input: unknown) => ({
        behavior: "allow",
        updatedInput: input,
        decisionReason: { type: "subcommandResults", reasons: new Map() },
      }),
    },  );
  eq("$ct background operator full decision", owned, upstream);
  eq("$ct background operator circuit breaker", owned.decisionReason, {
    type: "safetyCheck",
    reason:
      "This command uses the `&` background operator, which defers execution past approval-time safety checks. Approve only if you trust it.",
    classifierApprovable: false,
    circuitBreaker: "backgroundOperator",
  });
  mustDiffer("$ct background operator versus plain allow", owned, {
    behavior: "allow",
  });
}

// FAIL-CLOSED ROOT (XNt): only an active clamp changes a permission-check
// crash into a denial. The no-clamp case is its named negative control.
{
  const source = targetText("permissionCheckFailureDecision");
  const readContext = mustMatch(
    source,
    /let [\w$]+=([A-Za-z_$][\w$]*)\([\w$]+\)\.bashCommandClamps/,
    1,
    "failure-decision context reader",
  );
  const reason = mustMatch(
    source,
    /reason:([A-Za-z_$][\w$]*)/,
    1,
    "failure-decision reason",
  );
  const pinnedReason = "bashCommandClamp fail-closed: permission check crashed";
  const upstreamEnabled = evaluateFunction(
    source,
    targetLabel("permissionCheckFailureDecision"),
    { [readContext]: () => ROOT_CASES.failureWithClamp.permissionContext, [reason]: pinnedReason },
  );
  const upstreamDisabled = evaluateFunction(
    source,
    targetLabel("permissionCheckFailureDecision"),
    { [readContext]: () => ROOT_CASES.failureWithoutClamp.permissionContext, [reason]: pinnedReason },
  );
  const upstreamAbsent = evaluateFunction(
    source,
    targetLabel("permissionCheckFailureDecision"),
    { [readContext]: () => ROOT_CASES.failureWithoutClampProperty.permissionContext, [reason]: pinnedReason },
  );
  const readEnabled = () => ROOT_CASES.failureWithClamp.permissionContext;
  const readDisabled = () => ROOT_CASES.failureWithoutClamp.permissionContext;
  const readAbsent = () => ROOT_CASES.failureWithoutClampProperty.permissionContext;
  const enabled = permissionCheckFailureDecision(
    ROOT_CASES.failureWithClamp.toolName,
    {},
    { readPermissionContext: readEnabled },
  );
  const disabled = permissionCheckFailureDecision(
    ROOT_CASES.failureWithoutClamp.toolName,
    {},
    { readPermissionContext: readDisabled },
  );
  const absent = permissionCheckFailureDecision(
    ROOT_CASES.failureWithoutClampProperty.toolName,
    {},
    { readPermissionContext: readAbsent },
  );
  eq("XNt active-clamp full decision", enabled, upstreamEnabled("Bash", {}));
  eq("XNt no-clamp full decision", disabled, upstreamDisabled("Bash", {}));
  eq("XNt absent-clamp-property full decision", absent, upstreamAbsent("Bash", {}));
  eq("XNt active-clamp literal", enabled, {
    behavior: "deny",
    message:
      "The Bash permission check crashed and this agent carries a per-spawn bashCommandClamp; denying rather than running an unverified command.",
    decisionReason: { type: "other", reason: pinnedReason },
  });
  eq("XNt no-clamp literal", disabled, undefined);
  eq("XNt absent-clamp-property literal", absent, undefined);
  mustDiffer("XNt active clamp versus no clamp", enabled, disabled);
}

// MODE: allowlisted commands survive prefixes only in acceptEdits.
const upstreamMode = buildUpstreamMode();
for (const { tag, command, context } of MODE_CASES) {
  eq(tag, checkModeCommand(command, context), upstreamMode(command, context));
}
const modeAllow = checkModeCommand("LANG=C timeout 2 nohup mkdir work", {
  mode: "acceptEdits",
});
const modeDefault = checkModeCommand("LANG=C timeout 2 nohup mkdir work", {
  mode: "default",
});
eq("mode allow keeps original command", modeAllow, {
  behavior: "allow",
  updatedInput: { command: "LANG=C timeout 2 nohup mkdir work" },
  decisionReason: { type: "mode", mode: "acceptEdits" },
});
eq("mode empty fallback", checkModeCommand("", { mode: "acceptEdits" }), {
  behavior: "passthrough",
  message: "Base command not found",
});
mustDiffer("acceptEdits allowlist is mode-specific", modeAllow, modeDefault);

// Independent-review regressions. Every command and state value comes from the
// shared corpus above; pinned declarations provide the expected full decision.
function scopedValue(source: string, bindings: Record<string, unknown>): unknown {
  const scope = new Proxy(bindings, {
    has: () => true,
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (typeof key === "string" && Object.hasOwn(target, key)) return target[key];
      if (typeof key === "string" && key in globalThis) {
        return (globalThis as Record<string, unknown>)[key];
      }
      throw new Error(`unbound pinned-byte oracle capture '${String(key)}'`);
    },
  });
  // eslint-disable-next-line no-new-func
  return Function("__scope", `with (__scope) { return (${source}); }`)(scope);
}

function regressionContext(
  permissionContext: Record<string, unknown>,
  forRemoteExecution = false,
) {
  return {
    sessionEnvVars: new Map(),
    forRemoteExecution,
    abortController: { signal: { aborted: false } },
    options: { isNonInteractiveSession: true },
    permissionContext,
  };
}

function regressionEffects(
  permissionContext: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    readPermissionContext: () => permissionContext,
    replaceSessionEnvironmentKeys: () => undefined,
    emitTelemetry: () => undefined,
    isSubprocessEnvironmentScrubbingEnabled: () => false,
    currentWorkingDirectory: () => EFFECT_STATE.cwd,
    platform: () => EFFECT_STATE.platform,
    homeDirectory: () => EFFECT_STATE.homeDirectory,
    spawnEnvironmentKeys: () => new Set<string>(),
    matchRules: () => ({ deny: [], ask: [], allow: [] }),
    validatePath: () => ({ behavior: "allow" }),
    isSandboxingEnabled: () => false,
    isAutoAllowBashIfSandboxedEnabled: () => false,
    isSandboxEligible: () => false,
    isRestrictedContext: () => false,
    hasUnsafeGitStructureFromAnalysis: () => false,
    hasUnsafeGitStructureFromCommand: () => false,
    isCdGitSequenceSafe: async () => false,
    isCdGitAstSequenceSafe: async () => false,
    checkTooComplexSafety: async () => null,
    checkTooComplexSandbox: () => null,
    checkInvalidSemanticsRules: () => null,
    checkSandboxAutoAllow: () => null,
    checkExactPermission: () => ({ behavior: "passthrough", message: "base" }),
    checkPathSafety: () => ({ behavior: "passthrough", message: "path" }),
    checkDirectCommand: () => ({ behavior: "passthrough", message: "direct" }),
    checkSubcommandPermission: async () => ({
      behavior: "passthrough",
      message: "final",
    }),
    allowedDirectories: () => [],
    resolvePathPolicy: (_filesystem: unknown, path: string) => ({
      resolvedPath: path,
    }),
    filesystem: () => ({}),
    resolveLeadingDirectoryChange: () => null,
    decorateDecision: (decision: unknown) => decision,
    ...overrides,
  };
}

function pinnedCore(
  input: Record<string, unknown>,
  context: Record<string, unknown>,
  overrides: Record<string, unknown>,
  classifier?: AnyFn,
): Promise<Decision> {
  const bindings: Record<string, unknown> = {
    he: (value: any) => value.permissionContext ?? {},
    x9e: () => undefined,
    pEe: async () => ({}),
    KTe: () => ({ kind: "simple", commands: [], bareAssignmentNames: [] }),
    Urn: async () => null,
    xrn: () => null,
    s: () => undefined,
    yQn: () => 3,
    ql: shellMessage,
    yi: { name: "Bash" },
    bQn: () => ({ ok: true }),
    Hrn: () => null,
    A8e: () => null,
    aQ: () => ({ behavior: "passthrough", message: "base" }),
    w8e: async () => ({ behavior: "passthrough", message: "No pipes found" }),
    $ct: unreachable("recursive permission entry"),
    Lb: (command: string) => /^(?:cd|chdir|pushd|popd)(?:\s|$)/.test(command),
    LP: (command: string) => /^(?:git)(?:\s|$)/.test(command),
    $rn: async () => false,
    ee: () => EFFECT_STATE.cwd,
    I8: () => ({ behavior: "passthrough", message: "path layer" }),
    fL: () => false,
    D: () => EFFECT_STATE.platform,
    LC: (value: unknown) => value,
    Drn: (texts: string[], analyses: unknown[]) => ({
      subcommands: texts,
      astCommandsByIdx: analyses,
    }),
    te: (values: unknown[]) => [...new Set(values)],
    TT: () => [],
    Qo: (_fs: unknown, value: string) => ({ resolvedPath: value }),
    le: () => ({}),
    FP: (value: unknown) => value,
    yr: (value: unknown) => value,
    Srn: "/",
    Db: peelCommandPrefixes,
    Qa: () => false,
    lW: (value: string) => value.startsWith("/"),
    F8e: (cwd: string, value: string) => `${cwd}/${value}`,
    dL: () => ({ behavior: "passthrough" }),
    Lrn: () => false,
    Frn: () => null,
    Nrn: async () => false,
    tQ: () => false,
    iW: () => false,
    j8e: () => ({ behavior: "passthrough", message: "direct" }),
    r_e: () => false,
    o_e: () => ({ behavior: "passthrough" }),
    Q: (values: unknown[], accept: (value: unknown) => boolean) =>
      values.filter(accept).length,
    Ze: Error,
    C8e: async () => ({ behavior: "passthrough", message: "final" }),
    Fy: findSafetyCheckReason,
    yKe: (updates: any[] | undefined) =>
      updates?.flatMap((update) => update.type === "addRules" ? update.rules : []) ?? [],
    eo: (value: unknown) => stable(value),
    w3e: () => [],
    brn: 5,
    ...overrides,
  };
  return evaluateScoped(permissionChainSource, permissionChainLabel, bindings)(
    input,
    context,
    classifier,
  );
}

// H9e must precede T8e: acceptEdits permits sed file writes, never sed's e command.
{
  const fixture = SAFETY_REGRESSION_CASES.sedExecuteInAcceptEdits;
  const pinnedSedSafety = evaluateScoped(functionSource("H9e"), "H9e", {
    Ua: () => [fixture.input.command],
    e8e: () => "sed e id",
    o_e: () => ({ behavior: "passthrough" }),
    cL: () => false,
  });
  const pinnedDirect = scopedValue(initializerSource("j8e"), {
    aQ: () => ({ behavior: "passthrough", message: "base" }),
    zw: () => ({ matchingDenyRules: [], matchingAskRules: [], matchingAllowRules: [] }),
    yi: { name: "Bash", isReadOnly: () => false },
    ql: shellMessage,
    I8: () => ({ behavior: "passthrough" }),
    H9e: pinnedSedSafety,
    T8e: unreachable("mode check after sed safety"),
    oW: () => new Set(),
    vrn: () => false,
    Ww: () => false,
    w3e: () => [],
    ee: () => EFFECT_STATE.cwd,
  }) as AnyFn;
  const expected = pinnedDirect(
    fixture.input,
    fixture.permissionContext,
    false,
    { argv: ["sed", "e id", "file"], redirects: [] },
    EFFECT_STATE.cwd,
    [],
  );
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkDirectCommand: pinnedDirect,
      }),
      classifyCommand: () => ({
        kind: "simple",
        commands: [{ text: fixture.input.command, argv: ["sed", "e id", "file"], envVars: [], redirects: [] }],
        bareAssignmentNames: [],
      }),
      classifyReadOnly: () => ({ behavior: "passthrough" }),
    },
  );
  eq("review sed execute full decision", owned, expected);
  eq("review sed execute remains safety ask", owned.decisionReason?.bashMissKind, "sed-dangerous");
}

// Orn checks each classified command before A8e returns sandbox allowance.
{
  const fixture = SAFETY_REGRESSION_CASES.sandboxSubcommandDeny;
  const rule = { toolName: "Bash", ruleContent: fixture.deniedSubcommand };
  const analyses = [
    { text: "echo ok", argv: ["echo", "ok"], envVars: [], redirects: [] },
    { text: fixture.deniedSubcommand, argv: ["touch", "file"], envVars: [], redirects: [] },
  ];
  const pinnedOrn = evaluateScoped(functionSource("Orn"), "Orn", {
    zw: (input: any) => ({
      matchingDenyRules: input.command === fixture.deniedSubcommand ? [rule] : [],
      matchingAskRules: [],
    }),
    yi: { name: "Bash" },
    ql: shellMessage,
    JNe: "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)",
  });
  const expected = evaluateScoped(functionSource("A8e"), "A8e", {
    pt: { isSandboxingEnabled: () => true, isAutoAllowBashIfSandboxedEnabled: () => true },
    bv: () => true,
    Q8e: () => false,
    Orn: pinnedOrn,
    oW: () => new Set(),
    Ww: () => true,
    Db: peelCommandPrefixes,
    dL: () => ({ behavior: "passthrough" }),
    ee: () => EFFECT_STATE.cwd,
  })(fixture.input, fixture.permissionContext, analyses, []);
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkSandboxAutoAllow: () => expected,
        isSandboxingEnabled: () => true,
        isAutoAllowBashIfSandboxedEnabled: () => true,
        isSandboxEligible: () => true,
        matchRules: (input: any) => ({
          deny: input.command === fixture.deniedSubcommand ? [rule] : [],
          ask: [],
          allow: [],
        }),
      }),
      classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      classifyReadOnly: () => ({ behavior: "passthrough" }),
    },
  );
  eq("review sandbox subcommand deny full decision", owned, expected);
}

function pinnedTooComplexDecision(
  fixture: typeof SAFETY_REGRESSION_CASES.sandboxTooComplexJq |
    typeof SAFETY_REGRESSION_CASES.asyncTooComplexSafety |
    typeof SAFETY_REGRESSION_CASES.remoteTooComplex,
  remote: boolean,
  sandbox: AnyFn,
) {
  return pinnedCore(
    fixture.input,
    regressionContext(fixture.permissionContext, remote),
    {
      KTe: () => ({ kind: "too-complex", nodeType: fixture.nodeType, reason: fixture.reason }),
      Urn: async () => null,
      xrn: sandbox,
    },
  );
}

// xrn excludes jq rather than treating an otherwise tame expansion as sandbox-safe.
{
  const fixture = SAFETY_REGRESSION_CASES.sandboxTooComplexJq;
  const pinnedSandbox = evaluateScoped(functionSource("xrn"), "xrn", {
    pt: { isSandboxingEnabled: () => true, isAutoAllowBashIfSandboxedEnabled: () => true },
    bv: () => true,
    Q8e: () => false,
    rW: () => [fixture.input.command],
    zw: () => ({ matchingDenyRules: [], matchingAskRules: [] }),
    Irn: (words: string[]) => words,
    Db: peelCommandPrefixes,
    XTe: () => false,
    SQn: () => false,
    R8e: new Set(),
    Mrn: new Set(),
    mKe: new Set(),
    uWt: new Set(),
    o_n: new Set(),
    J_t: new Set(),
    Q_t: /$a/,
    a_n: new Set(),
    l_n: new Set(),
    yi: { name: "Bash" },
    ql: shellMessage,
    JNe: "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)",
  });
  const expected = await pinnedTooComplexDecision(fixture, false, pinnedSandbox);
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkTooComplexSafety: async () => null,
        isSandboxingEnabled: () => true,
        isAutoAllowBashIfSandboxedEnabled: () => true,
        isSandboxEligible: () => true,
      }),
      classifyCommand: () => ({ kind: "too-complex", nodeType: fixture.nodeType, reason: fixture.reason }),
    },
  );
  eq("review jq complex sandbox full decision", owned, expected);
  eq("review jq complex sandbox remains ask", owned.behavior, "ask");
}

// Local sandbox settings do not authorize remote execution.
{
  const fixture = SAFETY_REGRESSION_CASES.remoteTooComplex;
  const expected = await pinnedTooComplexDecision(
    fixture,
    true,
    unreachable("remote xrn sandbox fallback"),
  );
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext, true),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkTooComplexSafety: async () => null,
        isSandboxingEnabled: () => true,
        isAutoAllowBashIfSandboxedEnabled: () => true,
        isSandboxEligible: () => true,
      }),
      classifyCommand: () => ({ kind: "too-complex", nodeType: fixture.nodeType, reason: fixture.reason }),
    },
  );
  eq("review remote complex full decision", owned, expected);
}

// Urn is asynchronous and null means continue, not return a Promise as a decision.
{
  const fixture = SAFETY_REGRESSION_CASES.asyncTooComplexSafety;
  let awaited = false;
  const expected = await pinnedTooComplexDecision(fixture, false, () => null);
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkTooComplexSafety: async () => {
          await Promise.resolve();
          awaited = true;
          return null;
        },
      }),
      classifyCommand: () => ({ kind: "too-complex", nodeType: fixture.nodeType, reason: fixture.reason }),
    },
  );
  eq("review async safety full decision", owned, expected);
  eq("review async safety port awaited", awaited, true);
}

// Bare assignments remain independently unsafe even with an AST command record.
{
  const fixture = SAFETY_REGRESSION_CASES.inheritedUnsafeAssignment;
  const suggestedRule = {
    type: "addRules",
    rules: [{ toolName: "Bash", ruleContent: `${fixture.subcommand} *` }],
    behavior: "allow",
    destination: "localSettings",
  };
  const expected = (scopedValue(initializerSource("j8e"), {
    aQ: () => ({ behavior: "passthrough", message: "base" }),
    zw: () => ({ matchingDenyRules: [], matchingAskRules: [], matchingAllowRules: [] }),
    yi: { name: "Bash", isReadOnly: () => true },
    ql: shellMessage,
    I8: () => ({ behavior: "passthrough" }),
    H9e: () => ({ behavior: "passthrough" }),
    T8e: () => ({ behavior: "passthrough" }),
    oW: () => new Set([fixture.assignment]),
    vrn: () => false,
    Ww: () => false,
    w3e: () => [suggestedRule],
    ee: () => EFFECT_STATE.cwd,
  }) as AnyFn)(
    { command: fixture.subcommand },
    fixture.permissionContext,
    false,
    { argv: ["git", "diff"], redirects: [], envVars: [] },
    EFFECT_STATE.cwd,
    [fixture.assignment],
  );
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        spawnEnvironmentKeys: () => new Set([fixture.assignment]),
        checkPathSafety: () => ({ behavior: "passthrough" }),
        checkDirectCommand: () => expected,
        checkSubcommandPermission: async () => expected,
      }),
      classifyCommand: () => ({
        kind: "simple",
        commands: [{ text: fixture.subcommand, argv: ["git", "diff"], envVars: [], redirects: [] }],
        bareAssignmentNames: [fixture.assignment],
      }),
      classifyReadOnly: () => ({ behavior: "allow" }),
    },
  );
  eq("review inherited assignment full decision", owned, expected);
  eq("review inherited assignment not auto-allowed", owned.behavior, "passthrough");
}

// Prn delegates raw spans to exact matching; quoted whitespace stays literal.
{
  const fixture = SAFETY_REGRESSION_CASES.clampQuotedWhitespace;
  const command = fixture.input.command;
  const pinnedClamp = evaluateScoped(functionSource("Prn"), "Prn", {
    pEe: async () => ({}),
    w3: PARSE_ABORTED,
    KTe: () => ({ kind: "simple", commands: [{ text: command }], bareAssignmentNames: [] }),
    rW: () => [command],
    te: (values: string[]) => [...new Set(values)],
    Ur: (rule: string) => ({ toolName: "Bash", ruleContent: /^Bash\((.*)\)$/.exec(rule)?.[1] }),
    yi: { name: "Bash" },
    aW: (input: any, rules: Map<string, unknown>, kind: string) =>
      [...rules.keys()].filter((content) =>
        kind === "exact"
          ? content === input.command
          : content.endsWith(":*") && input.command.startsWith(content.slice(0, -2)),
      ),
  });
  const upstream = await evaluateScoped(targetText("checkBashPermission"), targetLabel("checkBashPermission"), {
    he: () => fixture.permissionContext,
    Prn: pinnedClamp,
    s: () => undefined,
    yi: { name: "Bash" },
    b: pinnedDisplaySpan,
    QNe: "bashCommandClamp: no clamp rule matches this command",
    jrn: unreachable("clamp mismatch core"),
  })(fixture.input, {}, undefined);
  const owned = await checkBashPermission(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    { effects: regressionEffects(fixture.permissionContext) },
  );
  eq("review clamp quoted whitespace full decision", owned, upstream);
  eq("review clamp quoted whitespace denied", owned.behavior, "deny");
}

// The multi-cd branch preserves dL's bypass-immune removal result.
{
  const fixture = SAFETY_REGRESSION_CASES.multiCdDangerousRemoval;
  const analyses = [
    { text: fixture.subcommands[0], argv: ["cd", "one"], envVars: [], redirects: [] },
    { text: fixture.subcommands[1], argv: ["cd", "two"], envVars: [], redirects: [] },
    { text: fixture.subcommands[2], argv: ["rm", "-rf", "/"], envVars: [], redirects: [] },
  ];
  const expected = await pinnedCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    {
      KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      Drn: () => ({ subcommands: [...fixture.subcommands], astCommandsByIdx: analyses }),
      dL: (name: string) => name === "rm"
        ? { behavior: "ask", message: "dangerous removal", decisionReason: DANGEROUS_SAFETY_REASON }
        : { behavior: "passthrough" },
    },
  );
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkDangerousRemoval: (command: string) => command === "rm"
          ? { behavior: "ask", message: "dangerous removal", decisionReason: DANGEROUS_SAFETY_REASON }
          : { behavior: "passthrough" },
      }),
      classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      classifyReadOnly: () => ({ behavior: "passthrough" }),
    },
  );
  eq("review multi-cd removal full decision", owned, expected);
  eq("review multi-cd removal safety reason", owned.decisionReason, DANGEROUS_SAFETY_REASON);
}

// yKe flattens addRules updates before the aggregate wraps the unique rules.
{
  const fixture = SAFETY_REGRESSION_CASES.nestedRuleSuggestions;
  const analyses = fixture.subcommands.map((text) => ({ text, argv: text.split(" "), envVars: [], redirects: [] }));
  const decisions = fixture.subcommands.map((command) => ({
    behavior: "passthrough",
    message: `${command} asks`,
    suggestions: [{
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: command }],
      behavior: "allow",
      destination: "localSettings",
    }],
  }));
  let pinnedAt = 0;
  const expected = await pinnedCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    {
      KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      Drn: () => ({ subcommands: [...fixture.subcommands], astCommandsByIdx: analyses }),
      j8e: () => ({ behavior: "passthrough", message: "preliminary" }),
      C8e: async () => decisions[pinnedAt++],
    },
  );
  let ownedAt = 0;
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkDirectCommand: () => ({ behavior: "passthrough", message: "preliminary" }),
        checkPathSafety: () => ({ behavior: "passthrough", message: "path" }),
        checkSubcommandPermission: () => decisions[ownedAt++],
      }),
      classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      classifyReadOnly: () => ({ behavior: "passthrough" }),
    },
  );
  eq("review flattened suggestion full decision", owned, expected);
  eq("review flattened suggestion rule shape", owned.suggestions?.[0]?.rules, [
    { toolName: "Bash", ruleContent: fixture.subcommands[0] },
    { toolName: "Bash", ruleContent: fixture.subcommands[1] },
  ]);
}

// An explicit update can normalize to no rules. jrn falls back only for asks.
{
  const fixture = SAFETY_REGRESSION_CASES.emptyRuleSuggestions;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  for (const behavior of fixture.decisionBehaviors) {
    const finalDecision = {
      behavior,
      message: "controlled final decision",
      suggestions: fixture.suggestions,
    };
    const expected = await pinnedCore(
      fixture.input,
      regressionContext(fixture.permissionContext),
      {
        KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
        j8e: () => ({ behavior: "passthrough", message: "preliminary" }),
        C8e: async () => finalDecision,
        w3e: (command: string) => [{
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: `${command} *` }],
          behavior: "allow",
          destination: "localSettings",
        }],
      },
    );
    const owned = await checkBashPermissionCore(
      fixture.input,
      regressionContext(fixture.permissionContext),
      undefined,
      {
        effects: regressionEffects(fixture.permissionContext, {
          checkDirectCommand: () => ({ behavior: "passthrough", message: "preliminary" }),
          checkSubcommandPermission: async () => finalDecision,
        }),
        classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      },
    );
    eq(`empty normalized suggestions ${behavior} full decision`, owned, expected);
    eq(
      `empty normalized suggestions ${behavior} fallback rules`,
      owned.suggestions?.[0]?.rules,
      behavior === "ask"
        ? fixture.subcommands.map((command) => ({ toolName: "Bash", ruleContent: `${command} *` }))
        : undefined,
    );
    if (behavior === "ask") {
      mustDiffer("empty normalized rules versus nullish-only fallback mutant", expected.suggestions, undefined);
    }
  }
}

// Rule keys depend on semantic content, never on object property order.
{
  const fixture = SAFETY_REGRESSION_CASES.reorderedRuleSuggestions;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  const ruleChunkPath = [...MODULES.keys()].find((path) => basename(path) === "chunk-fk13r7sg.js");
  if (!ruleChunkPath) throw new Error("pinned rule serialization chunk missing");
  const ruleAst = chunkAst(ruleChunkPath, MODULES.get(ruleChunkPath)!);
  const ruleFunction = (name: string) => {
    const declaration = ruleAst.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    );
    if (!declaration) throw new Error(`pinned rule helper ${name} missing`);
    return declaration.getText(ruleAst);
  };
  const pinnedEscape = evaluateScoped(ruleFunction("c"), "c", {});
  const pinnedSerialize = evaluateScoped(ruleFunction("eo"), "eo", { c: pinnedEscape });
  const decisions = fixture.rules.map((rule) => ({
    behavior: "passthrough",
    message: "controlled final decision",
    suggestions: [{
      type: "addRules", rules: [rule], behavior: "allow", destination: "localSettings",
    }],
  }));
  const runPinned = async (serialize: AnyFn) => {
    let index = 0;
    return pinnedCore(fixture.input, regressionContext(fixture.permissionContext), {
      KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      j8e: () => ({ behavior: "passthrough", message: "preliminary" }),
      C8e: async () => decisions[index++],
      eo: serialize,
    });
  };
  const expected = await runPinned(pinnedSerialize);
  const mutant = await runPinned((rule: unknown) => JSON.stringify(rule));
  let index = 0;
  const owned = await checkBashPermissionCore(
    fixture.input, regressionContext(fixture.permissionContext), undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkDirectCommand: () => ({ behavior: "passthrough", message: "preliminary" }),
        checkSubcommandPermission: async () => decisions[index++],
      }),
      classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
    },
  );
  eq("semantic rule deduplication full decision", owned, expected);
  eq("semantic rule deduplication keeps last value", owned.suggestions?.[0]?.rules, [fixture.rules[1]]);
  mustDiffer("semantic rule serializer versus JSON-property-order mutant", expected, mutant);
}

// Classifier cancellation preserves the pinned error identity and empty message.
{
  const fixture = SAFETY_REGRESSION_CASES.classifierAbort;
  const errorPath = [...MODULES.keys()].find((path) => basename(path) === "chunk-qr1avfxy.js");
  if (!errorPath) throw new Error("pinned error chunk missing");
  const errorAst = chunkAst(errorPath, MODULES.get(errorPath)!);
  const declaration = errorAst.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === "Ze",
  );
  if (!declaration) throw new Error("pinned classifier abort error missing");
  const pinnedAbortError = evaluateScoped(declaration.getText(errorAst), "Ze", {});
  const analyses = [{
    text: fixture.input.command, argv: fixture.input.command.split(" "), envVars: [], redirects: [],
  }];
  const errorShape = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return undefined;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { name: error.name, message: error.message };
    }
  };
  const expectedContext = regressionContext(fixture.permissionContext);
  const expected = await errorShape(() => pinnedCore(
    fixture.input, expectedContext,
    {
      KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      Ze: pinnedAbortError,
    },
    async () => { expectedContext.abortController.signal.aborted = true; return null; },
  ));
  const context = regressionContext(fixture.permissionContext);
  const owned = await errorShape(() => checkBashPermissionCore(
    fixture.input, context,
    async () => { context.abortController.signal.aborted = true; return null; },
    {
      effects: regressionEffects(fixture.permissionContext),
      classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
    },
  ));
  eq("classifier abort error matches pinned name/message", owned, expected);
  eq("classifier abort preserves exact error shape", owned, fixture.expectedError);
  mustDiffer("classifier abort versus generic-error mutant", expected, {
    name: "Error", message: "Bash permission classifier aborted",
  });
}

// Unsafe assignments must remain part of whole-command suggestions.
{
  const fixture = SAFETY_REGRESSION_CASES.assignmentSuggestions;
  const common = {
    rQ: evaluateValue(initializerSource("rQ")),
    cW: evaluateValue(initializerSource("cW")),
    oQ: evaluateValue(initializerSource("oQ")),
    St: (text: string, delimiter: string) => text.split(delimiter)[0],
  };
  const pinnedPrefix = evaluateScoped(functionSource("KNt"), "KNt", common);
  const pinnedHeredoc = evaluateScoped(functionSource("krn"), "krn", { ...common, KNt: pinnedPrefix });
  const update = (toolName: string, ruleContent: string) => [{
    type: "addRules", rules: [{ toolName, ruleContent }],
    behavior: "allow", destination: "localSettings",
  }];
  const pinnedSuggestions = evaluateScoped(functionSource("w3e"), "w3e", {
    krn: pinnedHeredoc,
    KNt: pinnedPrefix,
    wr: (command: string) => command.split("\n")[0],
    yi: { name: "Bash" },
    ayt: update,
    lyt: (tool: string, content: string) => update(tool, `${content} *`),
  });
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: ["custom", "alpha"], envVars: [], redirects: [],
  }));
  const finalDecision = { behavior: "ask", message: "controlled final decision", suggestions: [] };
  const expected = await pinnedCore(fixture.input, regressionContext(fixture.permissionContext), {
    KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
    j8e: () => ({ behavior: "passthrough", message: "preliminary" }),
    C8e: async () => finalDecision,
    w3e: pinnedSuggestions,
  });
  const owned = await checkBashPermissionCore(fixture.input, regressionContext(fixture.permissionContext), undefined, {
    effects: regressionEffects(fixture.permissionContext, {
      checkDirectCommand: () => ({ behavior: "passthrough", message: "preliminary" }),
      checkSubcommandPermission: async () => finalDecision,
    }),
    classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
  });
  eq("assignment suggestions full decision", owned, expected);
  eq("assignment suggestions preserve unsafe assignment", owned.suggestions?.[0]?.rules, [
    { toolName: "Bash", ruleContent: fixture.subcommands[0] },
    { toolName: "Bash", ruleContent: "custom alpha *" },
  ]);
  mustDiffer("unsafe assignment suggestion versus strip-all mutant", expected.suggestions?.[0]?.rules, [
    { toolName: "Bash", ruleContent: "custom alpha *" },
  ]);
}

// Drn tests the matched cwd spelling, not the unnormalized Windows spelling.
{
  const fixture = SAFETY_REGRESSION_CASES.windowsSyntheticCd;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  const pinnedDecompose = evaluateScoped(functionSource("Drn"), "Drn", {
    M8e: evaluateScoped(functionSource("M8e"), "M8e", {}),
    Qa: (value: string) => value.includes("__TRACKED_VAR__") || value.includes("__CMDSUB_OUTPUT__"),
  });
  const directDecision = { behavior: "passthrough", message: "direct" };
  const finalDecision = { behavior: "passthrough", message: "final" };
  const expectedTrace: string[] = [];
  const expected = await pinnedCore(fixture.input, regressionContext(fixture.permissionContext), {
    KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
    ee: () => fixture.cwd,
    D: () => fixture.platform,
    LC: () => "/c/foo",
    Drn: pinnedDecompose,
    j8e: (input: { command: string }) => { expectedTrace.push(input.command); return directDecision; },
    C8e: async () => finalDecision,
  });
  const trace: string[] = [];
  const owned = await checkBashPermissionCore(fixture.input, regressionContext(fixture.permissionContext), undefined, {
    effects: regressionEffects(fixture.permissionContext, {
      currentWorkingDirectory: () => fixture.cwd,
      platform: () => fixture.platform,
      checkDirectCommand: (input: { command: string }) => { trace.push(input.command); return directDecision; },
      checkSubcommandPermission: async () => finalDecision,
    }),
    classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
  });
  eq("Windows synthetic cwd full decision", owned, expected);
  eq("Windows synthetic cwd direct-command trace", trace, expectedTrace);
  eq("Windows synthetic cwd omits normalized cd", trace, [fixture.subcommands[1]]);
  mustDiffer("Windows normalized cwd versus raw-spelling-only mutant", expectedTrace, fixture.subcommands);
}

// The folded pipe aggregate supplies cwd to its analysis-based Git hazard port.
{
  const fixture = SAFETY_REGRESSION_CASES.aggregateAnalysisCwd;
  const analyses = fixture.subcommands.map((text) => ({
    text, argv: text.split(" "), envVars: [], redirects: [],
  }));
  const side = makeSide({ decide: (command) => ({ behavior: "allow", updatedInput: { command } }) });
  const expectedTrace: unknown[] = [];
  const expected = await buildUpstreamAggregate(side, findSafetyCheckReason, {
    [cwdName]: () => fixture.cwd,
    [analysisHazardName]: (records: unknown, cwd: string) => {
      expectedTrace.push({ records, cwd });
      return cwd === fixture.cwd;
    },
  })(fixture.input, fixture.subcommands, fixture.subcommands, side.checkPermission, classifiers, analyses, side.isCdGitSequenceSafe);
  const trace: unknown[] = [];
  const owned = await aggregateSubcommandPermissions(
    fixture.input, fixture.subcommands, fixture.subcommands,
    {
      checkPermission: async ({ command }: { command: string }) => ({ behavior: "allow", updatedInput: { command } }),
      classifiers,
      commandAnalyses: analyses,
      effects: {
        currentWorkingDirectory: () => fixture.cwd,
        hasUnsafeGitStructureFromAnalysis: (records: unknown, cwd: string) => {
          trace.push({ records, cwd });
          return cwd === fixture.cwd;
        },
        hasUnsafeGitStructureFromCommand: () => false,
        isCdGitSequenceSafe: async () => false,
      },
    },
  );
  eq("aggregate analysis hazard cwd full decision", owned, expected);
  eq("aggregate analysis hazard cwd trace", trace, expectedTrace);
  eq("aggregate analysis hazard receives cwd", trace, [{ records: analyses, cwd: fixture.cwd }]);
  mustDiffer("aggregate cwd forwarding versus missing-argument mutant", expected.behavior, "allow");
}

// jrn wraps $rn with the current cwd before giving it to the owned pipe fold.
{
  const fixture = SAFETY_REGRESSION_CASES.pipeCdGitCwd;
  const analyses = fixture.subcommands.map((text) => ({
    text,
    argv: text.split(" "),
    envVars: [],
    redirects: [],
  }));
  const permissionDecision = (command: string) => ({
    behavior: "allow",
    updatedInput: { command },
  });
  const aggregateAllow = {
    behavior: "allow",
    updatedInput: fixture.input,
    decisionReason: {
      type: "subcommandResults",
      reasons: new Map(
        fixture.subcommands.map((command) => [
          command,
          permissionDecision(command),
        ]),
      ),
    },
  };
  const expectedTrace: unknown[] = [];
  const expected = await pinnedCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    {
      pEe: async () => getParser().parse(fixture.input.command),
      KTe: () => ({
        kind: "simple",
        commands: analyses,
        bareAssignmentNames: [],
      }),
      w8e: async (
        _input: unknown,
        _checkPermission: unknown,
        _classifiers: unknown,
        _root: unknown,
        _analyses: unknown,
        isSafe: (commands: readonly string[]) => Promise<boolean>,
      ) => {
        await isSafe(fixture.subcommands);
        return aggregateAllow;
      },
      $rn: async (commands: readonly string[], cwd: string) => {
        expectedTrace.push({ commands, cwd });
        return cwd === fixture.cwd;
      },
      ee: () => fixture.cwd,
      I8: () => ({ behavior: "passthrough", message: "path" }),
    },
  );
  const trace: unknown[] = [];
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        currentWorkingDirectory: () => fixture.cwd,
        checkPathSafety: () => ({ behavior: "passthrough", message: "path" }),
        isCdGitSequenceSafe: async (
          commands: readonly string[],
          cwd: string,
        ) => {
          trace.push({ commands, cwd });
          return cwd === fixture.cwd;
        },
      }),
      checkPermission: async ({ command }: { command: string }) =>
        permissionDecision(command),
      classifyCommand: () => ({
        kind: "simple",
        commands: analyses,
        bareAssignmentNames: [],
      }),
    },
  );
  eq("jrn pipe cwd wrapper full decision", owned, expected);
  eq("jrn pipe cwd wrapper trace", trace, expectedTrace);
  eq("jrn pipe wrapper supplies current cwd", trace, [
    { commands: fixture.subcommands, cwd: fixture.cwd },
  ]);
  mustDiffer("jrn pipe cwd wrapper versus omitted-cwd mutant", trace, [
    { commands: fixture.subcommands, cwd: undefined },
  ]);
}

// A proven leading cd is omitted from path validation at the resolved cwd.
{
  const fixture = SAFETY_REGRESSION_CASES.resolvedLeadingCd;
  const analyses = [
    { text: fixture.subcommands[0], argv: ["cd", "sub"], envVars: [], redirects: [] },
    { text: fixture.subcommands[1], argv: ["cat", "file"], envVars: [], redirects: [] },
  ];
  const pinnedPaths: unknown[][] = [];
  const expected = await pinnedCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    {
      KTe: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      Drn: () => ({ subcommands: [...fixture.subcommands], astCommandsByIdx: analyses }),
      Lrn: () => true,
      Frn: () => fixture.resolvedCwd,
      j8e: () => ({ behavior: "passthrough", message: "preliminary" }),
      I8: (_input: unknown, _cwd: unknown, _context: unknown, _hasCd: unknown, _redirects: unknown, records: unknown[]) => {
        pinnedPaths.push(records);
        return { behavior: "passthrough", message: "path" };
      },
      C8e: async (input: any) => ({ behavior: "allow", updatedInput: input }),
    },
  );
  const ownedPaths: unknown[][] = [];
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    undefined,
    {
      effects: regressionEffects(fixture.permissionContext, {
        resolveLeadingDirectoryChange: () => fixture.resolvedCwd,
        checkDirectCommand: () => ({ behavior: "passthrough", message: "preliminary" }),
        checkPathSafety: (_input: unknown, _cwd: unknown, _context: unknown, _hasCd: unknown, _redirects: unknown, records: unknown[]) => {
          ownedPaths.push(records);
          return { behavior: "passthrough", message: "path" };
        },
        checkSubcommandPermission: (input: any) => ({ behavior: "allow", updatedInput: input }),
      }),
      classifyCommand: () => ({ kind: "simple", commands: analyses, bareAssignmentNames: [] }),
      classifyReadOnly: () => ({ behavior: "passthrough" }),
    },
  );
  eq("review resolved-cd full decision", owned, expected);
  eq("review resolved-cd path records", ownedPaths, pinnedPaths);
  eq("review resolved-cd excludes leading analysis", ownedPaths, [[analyses[1]]]);
}

// C8e uses wrn for classifier prefixes, producing a wildcard rule.
{
  const fixture = SAFETY_REGRESSION_CASES.classifierPrefix;
  const prefixSuggestion = [{
    type: "addRules",
    rules: [{ toolName: "Bash", ruleContent: `${fixture.prefix} *` }],
    behavior: "allow",
    destination: "localSettings",
  }];
  const pinnedFinal = evaluateScoped(functionSource("C8e"), "C8e", {
    aQ: () => ({ behavior: "passthrough", message: "base" }),
    j8e: () => ({ behavior: "passthrough", message: "direct" }),
    wrn: () => prefixSuggestion,
    w3e: unreachable("whole-command suggestion after classifier prefix"),
  });
  const expected = await pinnedFinal(
    fixture.input,
    fixture.permissionContext,
    { commandPrefix: fixture.prefix },
    false,
    undefined,
    EFFECT_STATE.cwd,
    [],
  );
  const owned = await checkBashPermissionCore(
    fixture.input,
    regressionContext(fixture.permissionContext),
    async () => ({ commandPrefix: fixture.prefix }),
    {
      effects: regressionEffects(fixture.permissionContext, {
        checkDirectCommand: () => ({ behavior: "passthrough", message: "direct" }),
        checkSubcommandPermission: pinnedFinal,
        checkPathSafety: () => ({ behavior: "passthrough", message: "path" }),
      }),
      classifyCommand: () => ({
        kind: "simple",
        commands: [{ text: fixture.input.command, argv: ["custom", "something"], envVars: [], redirects: [] }],
        bareAssignmentNames: [],
      }),
      classifyReadOnly: () => ({ behavior: "passthrough" }),
    },
  );
  eq("review classifier prefix full decision", owned, expected);
  eq("review classifier prefix wildcard", owned.suggestions, prefixSuggestion);
}

// Prn uses the pinned aW matcher for wildcard and xargs-prefix clamp rules.
{
  const policyPath = [...MODULES.keys()].find(
    (path) => basename(path) === "chunk-9e2ns8ty.js",
  );
  if (!policyPath) throw new Error("permission-policy chunk is missing");
  const policyText = MODULES.get(policyPath)!;
  const policyAst = chunkAst(policyPath, policyText);
  const policyFunction = (name: string) => {
    for (const statement of policyAst.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return statement.getText(policyAst);
      }
    }
    throw new Error(`pinned policy helper '${name}' is missing`);
  };
  const pinnedPrefixPattern = evaluateScoped(
    policyFunction("bKe"),
    "bKe",
    {},
  );
  const pinnedHasWildcard = evaluateScoped(
    policyFunction("ur"),
    "ur",
    {},
  );
  const pinnedEndsWildcard = evaluateScoped(
    policyFunction("CQn"),
    "CQn",
    {},
  );
  const pinnedGlob = evaluateScoped(policyFunction("o6"), "o6", {
    yl: new RegExp("\0ESCAPED_STAR\0", "g"),
    wl: new RegExp("\0ESCAPED_BACKSLASH\0", "g"),
    bl: /\/(?:\*\*\/)+/g,
    _l: new RegExp("\0GLOBSTAR\0", "g"),
  });
  const pinnedPattern = evaluateScoped(policyFunction("syt"), "syt", {
    bKe: pinnedPrefixPattern,
    ur: pinnedHasWildcard,
  });
  const pinnedWildcard = evaluateScoped(functionSource("NP"), "NP", {
    o6: pinnedGlob,
  });
  const pinnedDecodeRedirect = evaluateScoped(
    functionSource("eW"),
    "eW",
    {},
  );
  const pinnedSee = evaluateScoped(functionSource("See"), "See", {
    SS: 10_000,
    ZE: () => getParser(),
    eW: pinnedDecodeRedirect,
    Jhe: evaluateValue(initializerSource("Jhe")),
  });
  const pinnedMatcher = evaluateScoped(functionSource("aW"), "aW", {
    See: pinnedSee,
    Ah: normalizeCommandPrefix,
    ru: commandArgv,
    Rrn: unreachable("strip-all-env matcher branch"),
    iQ: unreachable("strip-all-env text branch"),
    Ua: splitSubcommands,
    sQ: pinnedPattern,
    NP: pinnedWildcard,
    CQn: pinnedEndsWildcard,
  });

  const rulePath = [...MODULES.keys()].find(
    (path) => basename(path) === "chunk-fk13r7sg.js",
  );
  if (!rulePath) throw new Error("permission-rule chunk is missing");
  const ruleText = MODULES.get(rulePath)!;
  const ruleAst = chunkAst(rulePath, ruleText);
  const ruleFunction = (name: string) => {
    for (const statement of ruleAst.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return statement.getText(ruleAst);
      }
    }
    throw new Error(`pinned rule helper '${name}' is missing`);
  };
  const pinnedFirstDelimiter = evaluateScoped(ruleFunction("l"), "l", {});
  const pinnedLastDelimiter = evaluateScoped(ruleFunction("u"), "u", {});
  const pinnedDecodeRule = evaluateScoped(ruleFunction("a"), "a", {});
  const pinnedParseRule = evaluateScoped(ruleFunction("Ur"), "Ur", {
    l: pinnedFirstDelimiter,
    u: pinnedLastDelimiter,
    a: pinnedDecodeRule,
    Vd: (name: string) => name,
  });

  const runClampAdmission = async (
    fixture:
      | typeof SAFETY_REGRESSION_CASES.clampWildcard
      | typeof SAFETY_REGRESSION_CASES.clampPrefixThroughXargs
      | typeof SAFETY_REGRESSION_CASES.clampStarOnly
      | typeof SAFETY_REGRESSION_CASES.clampDisplayDoubleQuote
      | typeof SAFETY_REGRESSION_CASES.clampDisplayBackslash
      | typeof SAFETY_REGRESSION_CASES.clampDisplayControlCharacters
      | typeof SAFETY_REGRESSION_CASES.clampEscapedLiteral
      | typeof SAFETY_REGRESSION_CASES.clampNestedRedirectAssignment,
  ) => {
    const command = fixture.input.command;
    const pinnedClamp = evaluateScoped(functionSource("Prn"), "Prn", {
      pEe: async () => getParser().parse(command),
      w3: PARSE_ABORTED,
      KTe: (text: string, root: any) =>
        createCommandClassifier(() => false)(text, root),
      rW: () => [command],
      te: (values: string[]) => [...new Set(values)],
      Ur: pinnedParseRule,
      yi: { name: "Bash" },
      aW: pinnedMatcher,
    });
    const allowed = {
      behavior: "allow",
      updatedInput: fixture.input,
      decisionReason: { type: "other", reason: "pinned core allow" },
    };
    const upstream = await evaluateScoped(
      targetText("checkBashPermission"),
      targetLabel("checkBashPermission"),
      {
        he: () => fixture.permissionContext,
        Prn: pinnedClamp,
        s: () => undefined,
        yi: { name: "Bash" },
        b: pinnedDisplaySpan,
        QNe: "bashCommandClamp: no clamp rule matches this command",
        jrn: async () => allowed,
        D8e: (decision: unknown) => decision,
        JNe: "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)",
        pEe: unreachable("background parse for plain clamp command"),
        w3: PARSE_ABORTED,
        eQe: unreachable("background tree check for plain clamp command"),
        ql: shellMessage,
      },
    )(fixture.input, {}, undefined);
    const owned = await checkBashPermission(
      fixture.input,
      {},
      undefined,
      {
        effects: {
          readPermissionContext: () => fixture.permissionContext,
          emitTelemetry: () => undefined,
          isSubprocessEnvironmentScrubbingEnabled: () => false,
          decorateDecision: (decision: unknown) => decision,
        },
        checkCore: async () => allowed,
      },
    );
    return { owned, upstream };
  };

  const wildcard = await runClampAdmission(
    SAFETY_REGRESSION_CASES.clampWildcard,
  );
  eq("review clamp wildcard full decision", wildcard.owned, wildcard.upstream);
  eq("review clamp wildcard admitted", wildcard.owned.behavior, "allow");
  mustDiffer("Prn wildcard versus literal-only clamp mutant", wildcard.owned, {
    behavior: "deny",
  });

  const prefix = await runClampAdmission(
    SAFETY_REGRESSION_CASES.clampPrefixThroughXargs,
  );
  eq("review clamp xargs-prefix full decision", prefix.owned, prefix.upstream);
  eq("review clamp xargs-prefix admitted", prefix.owned.behavior, "allow");
  mustDiffer("Prn xargs-prefix versus direct-prefix-only mutant", prefix.owned, {
    behavior: "deny",
  });


  const star = await runClampAdmission(
    SAFETY_REGRESSION_CASES.clampStarOnly,
  );
  eq("review Bash star-only full decision", star.owned, star.upstream);
  eq("review Bash star-only denied", star.owned.behavior, "deny");
  const simpleMessage = clampMismatchMessage(
    SAFETY_REGRESSION_CASES.clampStarOnly.input.command,
    SAFETY_REGRESSION_CASES.clampStarOnly.permissionContext.bashCommandClamps[0],
  );
  eq("review simple span pinned full denial message", star.upstream.message, simpleMessage);
  eq("review simple span owned full denial message", star.owned.message, simpleMessage);
  mustDiffer("Prn Bash-star parser versus match-all mutant", star.owned, {
    behavior: "allow",
  });

  for (const [tag, fixture] of [
    ["double quote", SAFETY_REGRESSION_CASES.clampDisplayDoubleQuote],
    ["backslash", SAFETY_REGRESSION_CASES.clampDisplayBackslash],
    ["control characters", SAFETY_REGRESSION_CASES.clampDisplayControlCharacters],
  ] as const) {
    const result = await runClampAdmission(fixture);
    const message = clampMismatchMessage(
      fixture.input.command,
      fixture.permissionContext.bashCommandClamps[0],
    );
    eq(`review ${tag} span full decision`, result.owned, result.upstream);
    eq(`review ${tag} span pinned full denial message`, result.upstream.message, message);
    eq(`review ${tag} span owned full denial message`, result.owned.message, message);
  }

  const escaped = await runClampAdmission(
    SAFETY_REGRESSION_CASES.clampEscapedLiteral,
  );
  eq("review escaped clamp full decision", escaped.owned, escaped.upstream);
  eq("review escaped clamp admitted", escaped.owned.behavior, "allow");
  mustDiffer("Prn escaped-content decoder versus raw-content mutant", escaped.owned, {
    behavior: "deny",
  });


  const nestedRedirect = await runClampAdmission(
    SAFETY_REGRESSION_CASES.clampNestedRedirectAssignment,
  );
  eq("review nested redirect assignment clamp full decision", nestedRedirect.owned, nestedRedirect.upstream);
  eq("review nested redirect assignment false rule denied", nestedRedirect.owned.behavior, "deny");
  mustDiffer("Prn See projection versus recursive-redirection mutant", nestedRedirect.owned, {
    behavior: "allow",
  });
}

// jrn tracks candidate working directories across cd operations and forwards
// the resulting uncertainty bit to dL. The old constant-true fallback cannot
// distinguish these shared cases.
{
  const runCandidateTrace = async (
    fixture:
      | typeof SAFETY_REGRESSION_CASES.multiCdCandidateSafe
      | typeof SAFETY_REGRESSION_CASES.multiCdCandidateUnsafe,
  ) => {
    const analyses = fixture.subcommands.map((text) => ({
      text,
      argv: text.split(" "),
      envVars: [],
      redirects: [],
    }));
    const upstreamTrace: boolean[] = [];
    const expected = await pinnedCore(
      fixture.input,
      regressionContext(fixture.permissionContext),
      {
        KTe: () => ({
          kind: "simple",
          commands: analyses,
          bareAssignmentNames: [],
        }),
        Drn: () => ({
          subcommands: [...fixture.subcommands],
          astCommandsByIdx: analyses,
        }),
        dL: (
          _command: string,
          _args: string[],
          _cwd: string,
          _permissionContext: unknown,
          unsafeCwd: boolean,
        ) => {
          upstreamTrace.push(unsafeCwd);
          return { behavior: "passthrough" };
        },
      },
    );
    const ownedTrace: boolean[] = [];
    const owned = await checkBashPermissionCore(
      fixture.input,
      regressionContext(fixture.permissionContext),
      undefined,
      {
        effects: regressionEffects(fixture.permissionContext, {
          checkDangerousRemoval: (
            _command: string,
            _args: string[],
            _cwd: string,
            _permissionContext: unknown,
            unsafeCwd: boolean,
          ) => {
            ownedTrace.push(unsafeCwd);
            return { behavior: "passthrough" };
          },
        }),
        classifyCommand: () => ({
          kind: "simple",
          commands: analyses,
          bareAssignmentNames: [],
        }),
      },
    );
    eq(`review ${fixture.input.command} full decision`, owned, expected);
    eq(`review ${fixture.input.command} dL trace`, ownedTrace, upstreamTrace);
    eq(
      `review ${fixture.input.command} unsafe cwd bit`,
      ownedTrace,
      [fixture.expectedUnsafeCwd],
    );
    return ownedTrace;
  };

  const safeTrace = await runCandidateTrace(
    SAFETY_REGRESSION_CASES.multiCdCandidateSafe,
  );
  const unsafeTrace = await runCandidateTrace(
    SAFETY_REGRESSION_CASES.multiCdCandidateUnsafe,
  );
  mustDiffer(
    "jrn candidate-cwd tracking versus constant unsafe-cwd mutant",
    safeTrace,
    unsafeTrace,
  );
}

// r_e and o_e are owned folds inside jrn, separate from j8e's H9e check.
// Evaluate their pinned transitive closure so redirect-borne expansion asks,
// while a static redirect remains eligible for the aggregate allow.
{
  const dynamicRedirectNodes = evaluateValue(initializerSource("Qhe"));
  const quotedDynamicNodes = evaluateValue(initializerSource("nnn"));
  const redirectSyntaxNodes = evaluateValue(initializerSource("C9e"));
  const staticRedirectNodes = evaluateValue(initializerSource("rnn"));
  const pinnedParseError = evaluateScoped(functionSource("nW"), "nW", {});
  const pinnedContainsDynamic = evaluateScoped(
    functionSource("Zhe"),
    "Zhe",
    { Qhe: dynamicRedirectNodes },
  );
  const pinnedContainsQuotedDynamic = evaluateScoped(
    functionSource("eye"),
    "eye",
    { nnn: quotedDynamicNodes },
  );
  const pinnedRedirectStructure = evaluateScoped(
    functionSource("tye"),
    "tye",
    {
      C9e: redirectSyntaxNodes,
      eW: unreachable("descriptor target decoder"),
    },
  );
  const pinnedHeredocStructure = evaluateScoped(
    functionSource("nye"),
    "nye",
    {},
  );
  const pinnedStaticRedirectPart = evaluateScoped(
    functionSource("rye"),
    "rye",
    {
      t_n: /(?:^|[^\\])(?:\\\\)*[`$]/,
      onn: /(?:^|[^\\])(?:\\\\)*[;|&<>]/,
      snn: /(?:^|[^\\])(?:\\\\)*\$/,
      n_n: /(?:^|[^\\])(?:\\\\)*['"]/,
      rnn: staticRedirectNodes,
    },
  );
  const pinnedRedirectText = evaluateScoped(
    functionSource("R9e"),
    "R9e",
    {},
  );
  const pinnedRedirectAnalysis = evaluateScoped(
    functionSource("A9e"),
    "A9e",
    {
      SS: 10_000,
      tW: () => false,
      ZE: () => getParser(),
      nW: pinnedParseError,
      tye: pinnedRedirectStructure,
      nye: pinnedHeredocStructure,
      Zhe: pinnedContainsDynamic,
      eye: pinnedContainsQuotedDynamic,
      R9e: pinnedRedirectText,
      C9e: redirectSyntaxNodes,
      rye: pinnedStaticRedirectPart,
      Qhe: dynamicRedirectNodes,
    },
  );
  const pinnedRedirectTokenLength = evaluateScoped(
    functionSource("$9e"),
    "$9e",
    {},
  );
  const pinnedStripRedirect = evaluateScoped(
    functionSource("Tnn"),
    "Tnn",
    { $9e: pinnedRedirectTokenLength },
  );
  const pinnedNormalizeSed = evaluateScoped(
    functionSource("lL"),
    "lL",
    { Tnn: pinnedStripRedirect, Ah: normalizeCommandPrefix },
  );
  const pinnedSedStart = evaluateScoped(
    functionSource("wnn"),
    "wnn",
    {
      SS: 10_000,
      tW: () => false,
      ZE: () => getParser(),
      nW: pinnedParseError,
      wV: findCommandNode,
      lL: pinnedNormalizeSed,
    },
  );
  const pinnedSedText = evaluateScoped(
    functionSource("e8e"),
    "e8e",
    {
      wnn: pinnedSedStart,
      Ah: normalizeCommandPrefix,
      lL: pinnedNormalizeSed,
    },
  );
  const pinnedIsSed = evaluateScoped(
    functionSource("r_e"),
    "r_e",
    { e8e: pinnedSedText },
  );
  const pinnedRedirectSedRisk = evaluateScoped(
    functionSource("o_e"),
    "o_e",
    {
      r_e: pinnedIsSed,
      SS: 10_000,
      tW: () => false,
      A9e: pinnedRedirectAnalysis,
    },
  );

  const runSedRedirect = async (
    fixture:
      | typeof SAFETY_REGRESSION_CASES.sedRedirectRisk
      | typeof SAFETY_REGRESSION_CASES.sedRedirectSafe,
  ) => {
    const analysis = {
      text: fixture.subcommand,
      argv: ["sed", "s/a/b/", "file"],
      envVars: [],
      redirects: [],
    };
    const directAllow = (input: unknown) => ({
      behavior: "allow",
      updatedInput: input,
      decisionReason: { type: "other", reason: "controlled non-rule allow" },
    });
    const expected = await pinnedCore(
      fixture.input,
      regressionContext(fixture.permissionContext),
      {
        KTe: () => ({
          kind: "simple",
          commands: [analysis],
          bareAssignmentNames: [],
        }),
        Drn: () => ({
          subcommands: [fixture.subcommand],
          astCommandsByIdx: [analysis],
        }),
        j8e: directAllow,
        I8: () => ({ behavior: "passthrough", message: "path" }),
        r_e: pinnedIsSed,
        o_e: pinnedRedirectSedRisk,
      },
    );
    const owned = await checkBashPermissionCore(
      fixture.input,
      regressionContext(fixture.permissionContext),
      undefined,
      {
        effects: regressionEffects(fixture.permissionContext, {
          checkDirectCommand: directAllow,
          checkPathSafety: () => ({
            behavior: "passthrough",
            message: "path",
          }),
        }),
        classifyCommand: () => ({
          kind: "simple",
          commands: [analysis],
          bareAssignmentNames: [],
        }),
      },
    );
    return { owned, expected };
  };

  const risky = await runSedRedirect(
    SAFETY_REGRESSION_CASES.sedRedirectRisk,
  );
  eq("review redirect-sed risk full decision", risky.owned, risky.expected);
  eq("review redirect-sed risk asks", risky.owned.decisionReason?.bashMissKind, "sed-dangerous");
  mustDiffer("redirect-sed risk versus branch-omission mutant", risky.owned, {
    behavior: "allow",
  });

  const safe = await runSedRedirect(
    SAFETY_REGRESSION_CASES.sedRedirectSafe,
  );
  eq("review static redirect-sed full decision", safe.owned, safe.expected);
  eq("review static redirect-sed remains allowed", safe.owned.behavior, "allow");
  mustDiffer("static redirect-sed versus always-ask mutant", safe.owned, {
    behavior: "ask",
  });
}

if (checks < 64) {
  failures.push(`NON-VACUOUS FLOOR: expected at least 64 checks, ran ${checks}`);
}
if (controls !== 57) {
  failures.push(`CONTROL FLOOR: expected 57 named controls, ran ${controls}`);
}

if (failures.length > 0) {
  console.error(
    `bash compound safety parity: FAIL (${failures.length} failure(s), ${checks} checks, ${controls} controls)`,
  );
  for (const failure of failures) console.error(`\n${failure}`);
  process.exit(1);
}

console.log(
  `bash compound safety parity: PASS (${checks} checks, ${controls} named controls)`,
);
console.log(
  `owned anchors: ${[...cuts.entries()]
    .map(([name, { cut }]) => `${name}=${cut.start}-${cut.end}`)
    .join(", ")}`,
);
console.log(
  `folded declarations: validateCommandSemantics=${semanticsCut.start}-${semanticsCut.end}, ` +
    `${splitName}, ${argvName}, ${normalizeName}, ${peelName}`,
);
