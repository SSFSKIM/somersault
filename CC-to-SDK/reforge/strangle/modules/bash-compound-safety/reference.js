// PARITY LAYER — C13b's anchored Bash pipe/compound/mode safety unit
// (Claude Code 2.1.251, chunk-fy12d89p.js).
//
// C13b's five foundational/aggregate runtime splice roots are KTe (owned by
// command-classifier), _8e (owned by bash-read-only), and this module's three
// aggregate roots. Twenty-five child command-decision declarations are separate
// same-module splices beneath them:
//
//   $ct  checkBashPermission                         1003463–1004739
//   jrn  checkBashPermissionCore                     1004739–1011392
//   XNt  permissionCheckFailureDecision              987955–988249
//
// Four scout-listed anchored declarations fold beneath jrn rather than adding
// runtime splices:
//   w8e  parse-or-use-root entry                      975286–975472
//   mrn  compound refusal and pipe decomposition      975472–976002
//   drn  ordered per-subcommand permission aggregate  972888–975177
//   hrn  per-command permission-mode handling         976096–976443
//
// jrn is a separate anchored splice: $ct can receive it through its direct
// `checkCore` capture without trying to forward jrn's transitive state. jrn's
// cross-chunk pure admission helper bQn @chunk-9e2ns8ty.js 163205–175587 and
// the lower w8e/mrn/drn/hrn chain fold under jrn. Ua @900715–901124, ru
// @901637–901761, Db @942645–943599 and Ah @979561–980849 are unanchorable
// pure helpers folded at those owned callers.
//
// Explicit exclusions: C1's destructive-telemetry classifiers Ob
// @892694–892739, Aee @893122–893677 and OP @897288–897685 have no $ct/jrn
// caller; jz @2098641–2099121 likewise serves EOn recursion, UI suggestions
// and executor telemetry rather than this decision root. Their bytes remain
// upstream and no implementation claim is made here.
//
// The C13a parser and C13b command classifier/data tables are already owned and
// imported as the substrate. No parser/classifier/table bytes are duplicated.
//
// State leaves the closure only through named `effects`: permission-context and
// sandbox-setting reads; the session-environment-key write; telemetry; current
// cwd/platform/home/spawn-environment reads; rule-store matching; filesystem
// path/removal checks; and cwd/git validation. The optional model classifier is
// an original $ct parameter, not an invented port. Parser, formatter, command
// classification, command/mode detection, aggregation, and suggestions remain
// owned pure code.
import {
  PARSE_ABORTED,
  SHELL_KEYWORDS,
  commandArgv as parserCommandArgv,
  findCommandNode,
  getParser,
  parseOrAbort,
} from "../shell-parser/reference.js";
import { permissionMessage } from "../shared/permission-message.js";
import { findSafetyCheckReason } from "../shared/safety-check-reason.js";
import { createCommandClassifier } from "../command-classifier/reference.js";
import { isSedReadOnly } from "../bash-read-only/reference.js";
import {
  FILE_ARGUMENT_SAFETY,
  FILE_EFFECT_KINDS,
  FILE_EFFECT_PHRASES,
  createFileArgumentExtractors,
} from "../bash-safety-tables/reference.js";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import * as nodePath from "node:path";
export { PARSE_ABORTED, isSedReadOnly, permissionMessage };
export const BASH_TOOL_NAME = "Bash";
const READ_TOOL_NAME = "Read";
import {
  basename as pathBasename,
  dirname as pathDirname,
  isAbsolute as isAbsolutePath,
  normalize as normalizePath,
  posix as posixPath,
  resolve as resolvePath,
  sep as pathSeparator,
} from "node:path";

// This is deliberately separate from the parser chunk's equal-valued cap. The
// C13a seam notes establish that upstream owns two declarations that may drift
// independently.
const MAX_COMMAND_LENGTH = 10_000;

const SPLIT_CONTAINER_TYPES = new Set(["program", "list", "pipeline"]);
const SPLIT_OPERATOR_TYPES = new Set(["&&", "||", "|", ";", "&", "|&", "\n"]);
const ACCEPT_EDITS_COMMANDS = ["mkdir", "touch", "rm", "rmdir", "mv", "cp", "sed"];
const CIRCUIT_BREAKERS = {
  dangerousRemoval: { bypassImmune: true, classifierRouted: true },
  backgroundOperator: { bypassImmune: false, classifierRouted: true },
  suspiciousWindowsPath: { bypassImmune: false, classifierRouted: true },
  isolatePeerMachines: { bypassImmune: true, classifierRouted: false },
  restrictedMode: { bypassImmune: true, classifierRouted: false },
};

/** Pinned _Tt over the owned circuit-breaker metadata. */
export function isClassifierRoutedSafetyCheck(reason) {
  return (
    reason.circuitBreaker !== undefined &&
    CIRCUIT_BREAKERS[reason.circuitBreaker]?.classifierRouted === true
  );
}

// The environment prefixes Ah may remove. This is upstream's exact local
// allowlist at the pin; an unknown assignment is a command name, not a prefix.
const PREFIX_ENVIRONMENT_NAMES = new Set([
  "GOEXPERIMENT",
  "GOOS",
  "GOARCH",
  "CGO_ENABLED",
  "GO111MODULE",
  "RUST_BACKTRACE",
  "RUST_LOG",
  "NODE_ENV",
  "PYTHONUNBUFFERED",
  "PYTHONDONTWRITEBYTECODE",
  "PYTEST_DISABLE_PLUGIN_AUTOLOAD",
  "PYTEST_DEBUG",
  "ANTHROPIC_API_KEY",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_TIME",
  "CHARSET",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "TZ",
  "LS_COLORS",
  "LSCOLORS",
  "GREP_COLOR",
  "GREP_COLORS",
  "GCC_COLORS",
  "TIME_STYLE",
  "BLOCK_SIZE",
  "BLOCKSIZE",
  "COLUMNS",
  "LINES",
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "CI",
  "DEBIAN_FRONTEND",
  "GIT_TERMINAL_PROMPT",
]);

/** Walk every node in source order. */
function walk(node, visit) {
  visit(node);
  for (const child of node.children) {
    if (child) walk(child, visit);
  }
}

/**
 * Upstream Ua. Split a shell string at syntax-level list and pipeline nodes.
 * Redirections are omitted, comments are ignored, and a root ERROR wrapping a
 * recovered program is deliberately traversed rather than rejected.
 */
export function splitSubcommands(command) {
  if (!command) return [];
  if (command.length > MAX_COMMAND_LENGTH) return [command];
  const root = getParser().parse(command);
  if (!root) return [command];

  const parts = [];
  const collect = (node) => {
    if (SPLIT_OPERATOR_TYPES.has(node.type) || node.type === "comment") return;
    if (node.type === "redirected_statement") {
      for (const child of node.children) {
        if (!child.type.endsWith("_redirect")) {
          collect(child);
        }
      }
      return;
    }
    if (SPLIT_CONTAINER_TYPES.has(node.type)) {
      for (const child of node.children) {
        collect(child);
      }
      return;
    }
    parts.push(node.text);
  };

  const recovered =
    root.type === "ERROR" && root.children[0]?.type === "program"
      ? root.children[0]
      : root;
  collect(recovered);
  return parts;
}

/** Upstream ru. The parser contract intentionally returns only a safe prefix. */
export function commandArgv(command) {
  if (!command || command.length > MAX_COMMAND_LENGTH) return [];
  const root = getParser().parse(command);
  if (!root) return [];
  const commandNode = findCommandNode(root, null);
  return commandNode ? parserCommandArgv(commandNode) : [];
}

function collectPipePositions(root) {
  const positions = [];
  walk(root, (node) => {
    if (node.type !== "pipeline") return;
    for (const child of node.children) {
      if (child.type === "|" || child.type === "|&") {
        positions.push([child.startIndex, child.endIndex]);
      }
    }
  });
  return positions.sort((left, right) => left[0] - right[0]);
}

// O9e recognises only `>` and `>>` here. Other redirect operators are handled
// by the broader safety analysis, outside these four owned declarations.
function collectPipeOutputRedirections(root) {
  const redirections = [];
  walk(root, (node) => {
    if (node.type !== "file_redirect") return;
    const children = node.children;
    const operatorAt = children.findIndex(
      (child) => child.type === ">" || child.type === ">>",
    );
    const operator = children[operatorAt];
    const target = operatorAt >= 0 ? children[operatorAt + 1] : undefined;
    if (operator && target) {
      redirections.push({
        startIndex: node.startIndex,
        endIndex: target.endIndex,
        target: target.text,
        operator: operator.type,
      });
    }
  });
  return redirections;
}

function compoundStructure(root, command) {
  let hasSubshell = false;
  let hasCommandGroup = false;
  const controlFlow = new Set([
    "if_statement",
    "while_statement",
    "for_statement",
    "c_style_for_statement",
    "case_statement",
    "function_definition",
    "do_group",
    "elif_clause",
    "else_clause",
  ]);
  const inspect = (node) => {
    for (const child of node.children) {
      if (!child) continue;
      if (child.type === "list") {
        for (const item of child.children) {
          if (!item) continue;
          if (item.type === "&&" || item.type === "||") continue;
          if (
            item.type === "list" ||
            item.type === "redirected_statement" ||
            item.type === "pipeline" ||
            item.type === "negated_command" ||
            controlFlow.has(item.type)
          ) {
            inspect({ ...node, children: [item] });
          } else if (item.type === "subshell") {
            hasSubshell = true;
          } else if (item.type === "compound_statement") {
            hasCommandGroup = true;
          }
        }
      } else if (child.type === "pipeline") {
        inspect(child);
      } else if (child.type === "subshell") {
        hasSubshell = true;
      } else if (child.type === "compound_statement") {
        hasCommandGroup = true;
      } else if (
        child.type === "command" ||
        child.type === "declaration_command" ||
        child.type === "variable_assignment"
      ) {
        continue;
      } else if (child.type === "redirected_statement") {
        let traversed = false;
        for (const item of child.children) {
          if (!item || item.type === "file_redirect") continue;
          traversed = true;
          inspect({ ...child, children: [item] });
        }
        if (!traversed) continue;
      } else if (child.type === "negated_command") {
        inspect(child);
      } else if (controlFlow.has(child.type)) {
        inspect(child);
      } else if (child.children.length > 0) {
        inspect(child);
      }
    }
  };
  inspect(root);
  return { hasSubshell, hasCommandGroup };
}

/**
 * Pure projection of upstream O9e/n_e used by w8e and mrn. It intentionally
 * exposes the same four methods, but computes only fields these callers read.
 */
export function createCommandAnalysis(command, suppliedRoot) {
  if (!command || command.length > MAX_COMMAND_LENGTH) return null;
  let root = suppliedRoot;
  if (!root) {
    try {
      root = getParser().parse(command);
    } catch {
      return null;
    }
  }
  if (!root) return null;

  const bytes = Buffer.from(command, "utf8");
  const pipePositions = collectPipePositions(root);
  const outputRedirections = collectPipeOutputRedirections(root);
  const treeSitterAnalysis = {
    compoundStructure: compoundStructure(root, command),
  };

  return {
    toString() {
      return command;
    },
    getPipeSegments() {
      if (pipePositions.length === 0) return [command];
      const segments = [];
      let start = 0;
      for (const [operatorStart, operatorEnd] of pipePositions) {
        const segment = bytes.subarray(start, operatorStart).toString("utf8").trim();
        if (segment) segments.push(segment);
        start = operatorEnd;
      }
      const tail = bytes.subarray(start).toString("utf8").trim();
      if (tail) segments.push(tail);
      return segments;
    },
    withoutOutputRedirections() {
      if (outputRedirections.length === 0) return command;
      let remaining = bytes;
      for (const redirection of [...outputRedirections].sort(
        (left, right) => right.startIndex - left.startIndex,
      )) {
        remaining = Buffer.concat([
          remaining.subarray(0, redirection.startIndex),
          remaining.subarray(redirection.endIndex),
        ]);
      }
      return remaining
        .toString("utf8")
        .replace(/[ \t]+/g, " ")
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .trim();
    },
    getOutputRedirections() {
      return outputRedirections.map(({ target, operator }) => ({ target, operator }));
    },
    getTreeSitterAnalysis() {
      return treeSitterAnalysis;
    },
  };
}

/**
 * The shape permissionMessage needs. It is pure and intentionally conservative:
 * only concrete output targets are reported; quoted `>` text is not syntax.
 */
export function splitOutputRedirections(command) {
  const analysis = createCommandAnalysis(command);
  if (!analysis) {
    return { commandWithoutRedirections: command, redirections: [] };
  }
  return {
    commandWithoutRedirections: analysis.withoutOutputRedirections(),
    redirections: analysis.getOutputRedirections(),
  };
}

function escapePermissionRuleContent(content) {
  return content
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function renderPermissionRuleValue(ruleValue) {
  if (!ruleValue.ruleContent) return ruleValue.toolName;
  return `${ruleValue.toolName}(${escapePermissionRuleContent(ruleValue.ruleContent)})`;
}

function renderPermissionRuleSource(source) {
  switch (source) {
    case "userSettings": return "user settings";
    case "projectSettings": return "shared project settings";
    case "localSettings": return "project local settings";
    case "flagSettings": return "command line arguments";
    case "policySettings": return "enterprise managed settings";
    case "cliArg": return "CLI argument";
    case "command": return "command configuration";
    case "session": return "current session";
    case "toolsNarrowing": return "CLI tool narrowing";
    case "mcpServerPolicy": return "MCP server policy";
    default: return undefined;
  }
}

const PERMISSION_MODE_TITLES = {
  default: "Manual",
  plan: "Plan",
  acceptEdits: "Accept edits",
  bypassPermissions: "Bypass Permissions",
  dontAsk: "Don't Ask",
  auto: "Auto",
};

export function bashPermissionMessage(toolName, reason) {
  return permissionMessage(
    toolName,
    reason,
    renderPermissionRuleValue,
    renderPermissionRuleSource,
    splitOutputRedirections,
    (mode) => PERMISSION_MODE_TITLES[mode] ?? PERMISSION_MODE_TITLES.default,
  );
}

function shellPermissionMessage(reason) {
  return bashPermissionMessage(BASH_TOOL_NAME, reason);
}

function isBypassImmuneSafetyCheck(reason) {
  return (
    reason.circuitBreaker !== undefined &&
    CIRCUIT_BREAKERS[reason.circuitBreaker]?.bypassImmune === true
  );
}

/**
 * Upstream drn. Map.set is intentionally used directly: duplicate normalized
 * subcommands keep the first key position and the last decision value.
 */
export async function aggregateSubcommandPermissions(
  input,
  normalizedSubcommands,
  originalSubcommands,
  {
    checkPermission,
    classifiers,
    commandAnalyses = /** @type {Array<{text: string}> | undefined} */ (undefined),
    effects,
  },
) {
  const reasons = new Map();

  for (let index = 0; index < normalizedSubcommands.length; index++) {
    const normalized = normalizedSubcommands[index].trim();
    if (!normalized) {
      const original = originalSubcommands[index];
      const decision = await checkPermission({ ...input, command: original });
      reasons.set(
        original,
        decision.behavior === "passthrough"
          ? {
              behavior: "allow",
              updatedInput: { ...input, command: original },
              decisionReason: {
                type: "other",
                reason: "Bare output redirection with no command; path layer approved",
              },
            }
          : decision,
      );
      continue;
    }

    reasons.set(
      normalized,
      await checkPermission({ ...input, command: normalized }),
    );
  }

  const denied = [...reasons.entries()].find(
    ([, decision]) => decision.behavior === "deny",
  );
  if (denied) {
    const [command, decision] = denied;
    return {
      behavior: "deny",
      message:
        decision.behavior === "deny"
          ? decision.message
          : `Permission denied for: ${command}`,
      decisionReason: { type: "subcommandResults", reasons },
    };
  }

  const directoryChanges = normalizedSubcommands.filter((command) =>
    classifiers.isNormalizedCdCommand(command.trim()),
  );
  if (directoryChanges.length > 1) {
    for (const decision of reasons.values()) {
      if (
        decision.behavior === "ask" &&
        findSafetyCheckReason(
          decision.decisionReason,
          isBypassImmuneSafetyCheck,
        )
      ) {
        return decision;
      }
    }
    const reason = {
      type: "other",
      reason: "Multiple directory changes in one command require approval for clarity",
      bashMissKind: "multi-cd",
    };
    return {
      behavior: "ask",
      decisionReason: reason,
      message: shellPermissionMessage(reason),
    };
  }

  let hasDirectoryChange;
  let hasGit;
  if (commandAnalyses) {
    hasDirectoryChange = commandAnalyses.some((analysis) =>
      classifiers.isNormalizedCdCommand(analysis.text),
    );
    hasGit = commandAnalyses.some((analysis) =>
      classifiers.isNormalizedGitCommand(analysis.text),
    );
  } else {
    hasDirectoryChange = false;
    hasGit = false;
    for (const command of normalizedSubcommands) {
      for (const subcommand of splitSubcommands(command)) {
        const normalized = subcommand.trim();
        if (classifiers.isNormalizedCdCommand(normalized)) {
          hasDirectoryChange = true;
        }
        if (classifiers.isNormalizedGitCommand(normalized)) hasGit = true;
      }
    }
  }

  if (
    hasGit &&
    (commandAnalyses
      ? effects.hasUnsafeGitStructureFromAnalysis(
          commandAnalyses,
          effects.currentWorkingDirectory(),
        )
      : effects.hasUnsafeGitStructureFromCommand(input.command))
  ) {
    const reason = {
      type: "other",
      reason:
        "This command creates git repository structure files (HEAD/objects/refs/hooks) and then runs git, which can execute hooks/fsmonitor from the created files.",
      bashMissKind: "cd-git-compound",
    };
    return {
      behavior: "ask",
      decisionReason: reason,
      message: shellPermissionMessage(reason),
    };
  }

  if (hasDirectoryChange && hasGit) {
    const commands = [];
    for (const command of normalizedSubcommands) {
      for (const subcommand of splitSubcommands(command)) {
        commands.push(subcommand.trim());
      }
    }
    if (!(await effects.isCdGitSequenceSafe(commands))) {
      const reason = {
        type: "other",
        reason:
          "This command changes directory before running git, which can execute untrusted hooks from the target directory. Approve only if you trust it.",
        bashMissKind: "cd-git-compound",
      };
      return {
        behavior: "ask",
        decisionReason: reason,
        message: shellPermissionMessage(reason),
      };
    }
  }

  if ([...reasons.values()].every((decision) => decision.behavior === "allow")) {
    return {
      behavior: "allow",
      updatedInput: input,
      decisionReason: { type: "subcommandResults", reasons },
    };
  }

  const suggestions = [];
  for (const decision of reasons.values()) {
    if (
      decision.behavior !== "allow" &&
      "suggestions" in decision &&
      decision.suggestions
    ) {
      suggestions.push(...decision.suggestions);
    }
  }
  const decisionReason = { type: "subcommandResults", reasons };
  return {
    behavior: "ask",
    message: shellPermissionMessage(decisionReason),
    decisionReason,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/** Upstream mrn. */
export async function checkParsedPipeSafety(input, analysis, dependencies) {
  const treeAnalysis = analysis.getTreeSitterAnalysis();
  const hasUnsafeCompound = treeAnalysis
    ? treeAnalysis.compoundStructure.hasSubshell ||
      treeAnalysis.compoundStructure.hasCommandGroup
    : splitSubcommands(input.command).length > 1;

  if (hasUnsafeCompound) {
    const reason = {
      type: "other",
      reason: "This command uses shell operators that require approval for safety",
      bashMissKind: "shell-operators",
    };
    return {
      behavior: "ask",
      message: shellPermissionMessage(reason),
      decisionReason: reason,
    };
  }

  const pipeSegments = analysis.getPipeSegments();
  if (pipeSegments.length <= 1) {
    return { behavior: "passthrough", message: "No pipes found in command" };
  }

  const normalized = await Promise.all(
    pipeSegments.map(async (segment) => {
      if (!segment.includes(">")) return segment;
      return createCommandAnalysis(segment)?.withoutOutputRedirections() ?? segment;
    }),
  );
  return aggregateSubcommandPermissions(
    input,
    normalized,
    pipeSegments,
    dependencies,
  );
}

/** Upstream w8e; the C13a sentinel is imported, never re-minted. */
export async function checkPipeSafety(
  input,
  {
    checkPermission,
    classifiers,
    parsedRoot,
    commandAnalyses,
    effects,
  },
) {
  const analysis =
    parsedRoot && parsedRoot !== PARSE_ABORTED
      ? createCommandAnalysis(input.command, parsedRoot)
      : createCommandAnalysis(input.command);
  if (!analysis) {
    return { behavior: "passthrough", message: "Failed to parse command" };
  }
  return checkParsedPipeSafety(input, analysis, {
    checkPermission,
    classifiers,
    commandAnalyses,
    effects,
  });
}

function withoutCommentLines(command) {
  const lines = command
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));
  return lines.length === 0 ? command : lines.join("\n");
}

function unquoteFirstToken(command) {
  const match = command.match(/^([^\s]+)([\s\S]*)$/);
  if (!match) return command;
  const token = match[1];
  let quote = null;
  let trailingEscape = false;
  let unquoted = "";

  for (let index = 0; index < token.length; index++) {
    const character = token[index];
    trailingEscape = false;
    if (quote === "'") {
      if (character === "'") quote = null;
      else unquoted += character;
    } else if (quote === '"') {
      if (character === "\\") {
        const next = token[index + 1];
        if (["$", "`", '"', "\\"].includes(next)) {
          unquoted += next;
          index++;
        } else if (next === undefined) {
          trailingEscape = true;
        } else {
          unquoted += character;
        }
      } else if (character === '"') quote = null;
      else unquoted += character;
    } else if (character === "\\") {
      const next = token[index + 1];
      if (next === undefined) trailingEscape = true;
      else {
        unquoted += next;
        index++;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else {
      unquoted += character;
    }
  }

  return quote !== null || trailingEscape ? command : unquoted + match[2];
}

const PREFIX_PATTERNS = [
  /^timeout[ \t]+(?:(?:--(?:foreground|preserve-status|verbose)|--(?:kill-after|signal)=[A-Za-z0-9_.+-]+|--(?:kill-after|signal)[ \t]+[A-Za-z0-9_.+-]+|-v|-[ks][ \t]+[A-Za-z0-9_.+-]+|-[ks][A-Za-z0-9_.+-]+)[ \t]+)*(?:--[ \t]+)?\d+(?:\.\d+)?[smhd]?[ \t]+/,
  /^time[ \t]+(?:--[ \t]+)?/,
  /^nice(?:[ \t]+-n[ \t]+-?\d+|[ \t]+-\d+)?[ \t]+(?:--[ \t]+)?/,
  /^stdbuf(?:[ \t]+-[ioe][LN0-9]+)+[ \t]+(?:--[ \t]+)?/,
  /^nohup[ \t]+(?:--[ \t]+)?/,
  /^command(?:[ \t]+-p+)*(?:[ \t]+--)?[ \t]+(?!-)/,
  /^builtin(?:[ \t]+--)?[ \t]+(?!-)/,
  /^noglob[ \t]+(?!-)/,
];
const ENVIRONMENT_PREFIX =
  /^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z0-9_./:-]+)[ \t]+/;

/** Upstream Ah. */
export function normalizeCommandPrefix(command) {
  let current = command;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = withoutCommentLines(current);
    const assignment = current.match(ENVIRONMENT_PREFIX);
    if (assignment && PREFIX_ENVIRONMENT_NAMES.has(assignment[1])) {
      current = current.replace(ENVIRONMENT_PREFIX, "");
    }
  }

  current = unquoteFirstToken(withoutCommentLines(current));
  previous = "";
  while (current !== previous) {
    previous = current;
    for (const pattern of PREFIX_PATTERNS) {
      current = current.replace(pattern, "");
    }
    if (current !== previous) {
      current = unquoteFirstToken(withoutCommentLines(current));
    }
  }
  return current.trim();
}

const TIMEOUT_OPTION_VALUE = /^[A-Za-z0-9_.+-]+$/;
function timeoutOperandIndex(argv) {
  let index = 1;
  while (index < argv.length) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (["--foreground", "--preserve-status", "--verbose"].includes(argument)) {
      index++;
    } else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(argument)) {
      index++;
    } else if (
      (argument === "--kill-after" || argument === "--signal") &&
      next &&
      TIMEOUT_OPTION_VALUE.test(next)
    ) {
      index += 2;
    } else if (argument === "--") {
      index++;
      break;
    } else if (argument.startsWith("--")) {
      return -1;
    } else if (argument === "-v") {
      index++;
    } else if (
      (argument === "-k" || argument === "-s") &&
      next &&
      TIMEOUT_OPTION_VALUE.test(next)
    ) {
      index += 2;
    } else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(argument)) {
      index++;
    } else if (argument.startsWith("-")) {
      return -1;
    } else {
      break;
    }
  }
  return index;
}

function stdbufOperandIndex(argv) {
  let index = 1;
  while (index < argv.length) {
    const argument = argv[index];
    if (/^-[ioe]$/.test(argument) && argv[index + 1]) index += 2;
    else if (/^-[ioe]./.test(argument)) index++;
    else if (/^--(input|output|error)=/.test(argument)) index++;
    else if (argument.startsWith("-")) return -1;
    else break;
  }
  return index > 1 && index < argv.length ? index : -1;
}

function envOperandIndex(argv) {
  let index = 1;
  while (index < argv.length) {
    const argument = argv[index];
    if (argument.includes("=") && !argument.startsWith("-")) index++;
    else if (["-i", "-0", "-v"].includes(argument)) index++;
    else if (argument === "-u" && argv[index + 1]) index += 2;
    else if (argument.startsWith("-")) return -1;
    else break;
  }
  return index < argv.length ? index : -1;
}

/** Upstream Db. Returns a slice and never mutates its input. */
export function peelCommandPrefixes(argv) {
  let remaining = argv;
  while (true) {
    const basename = remaining[0]?.replace(/^.*[\\/]/, "");
    const command = ["time", "nohup", "timeout", "nice", "stdbuf", "env", "command"].includes(
      basename,
    )
      ? basename
      : remaining[0];

    if (command === "time" || command === "nohup") {
      remaining = remaining.slice(remaining[1] === "--" ? 2 : 1);
    } else if (command === "timeout") {
      const operand = timeoutOperandIndex(remaining);
      if (
        operand < 0 ||
        !remaining[operand] ||
        !/^\d+(?:\.\d+)?[smhd]?$/.test(remaining[operand])
      ) {
        return remaining;
      }
      remaining = remaining.slice(operand + 1);
    } else if (command === "nice") {
      if (remaining[1] === "-n" && remaining[2] && /^-?\d+$/.test(remaining[2])) {
        remaining = remaining.slice(remaining[3] === "--" ? 4 : 3);
      } else if (remaining[1] && /^-\d+$/.test(remaining[1])) {
        remaining = remaining.slice(remaining[2] === "--" ? 3 : 2);
      } else {
        remaining = remaining.slice(remaining[1] === "--" ? 2 : 1);
      }
    } else if (command === "stdbuf") {
      const operand = stdbufOperandIndex(remaining);
      if (operand < 0) return remaining;
      remaining = remaining.slice(operand);
    } else if (command === "env") {
      const operand = envOperandIndex(remaining);
      if (operand < 0) return remaining;
      remaining = remaining.slice(operand);
    } else if (command === "command") {
      let operand = 1;
      while (remaining[operand] !== undefined && /^-p+$/.test(remaining[operand])) {
        operand++;
      }
      if (remaining[operand] === "--") operand++;
      if (operand >= remaining.length || remaining[operand].startsWith("-")) {
        return remaining;
      }
      remaining = remaining.slice(operand);
    } else if (remaining[0] === "builtin") {
      const operand = remaining[1] === "--" ? 2 : 1;
      if (operand >= remaining.length) return remaining;
      remaining = remaining.slice(operand);
    } else if (remaining[0] === "noglob") {
      if (remaining.length <= 1) return remaining;
      remaining = remaining.slice(1);
    } else {
      return remaining;
    }
  }
}

/** Upstream hrn. */
export function checkModeCommand(command, permissionContext) {
  const normalized = normalizeCommandPrefix(command);
  const [baseCommand] = normalized.split(/\s+/);
  if (!baseCommand) {
    return { behavior: "passthrough", message: "Base command not found" };
  }
  if (
    permissionContext.mode === "acceptEdits" &&
    ACCEPT_EDITS_COMMANDS.includes(baseCommand)
  ) {
    return {
      behavior: "allow",
      updatedInput: { command },
      decisionReason: { type: "mode", mode: "acceptEdits" },
    };
  }
  return {
    behavior: "passthrough",
    message: `No mode-specific handling for '${baseCommand}' in ${permissionContext.mode} mode`,
  };
}

export function checkModeCommands(input, permissionContext) {
  if (permissionContext.mode === "bypassPermissions") {
    return {
      behavior: "passthrough",
      message: "Bypass mode is handled in main permission flow",
    };
  }
  if (permissionContext.mode === "dontAsk") {
    return {
      behavior: "passthrough",
      message: "DontAsk mode is handled in main permission flow",
    };
  }
  let allowed = false;
  for (const command of splitSubcommands(input.command)) {
    const decision = checkModeCommand(command, permissionContext);
    if (decision.behavior === "ask" || decision.behavior === "deny") {
      return decision;
    }
    if (decision.behavior === "passthrough") {
      return {
        behavior: "passthrough",
        message: "No mode-specific validation required",
      };
    }
    allowed = true;
  }
  if (allowed) {
    return {
      behavior: "allow",
      updatedInput: input,
      decisionReason: { type: "mode", mode: permissionContext.mode },
    };
  }
  return {
    behavior: "passthrough",
    message: "No mode-specific validation required",
  };
}

export const CLAMP_FAILURE_REASON =
  "bashCommandClamp fail-closed: permission check crashed";

/**
 * Upstream XNt. A permission-check exception is fail-closed only when this
 * agent carries a command clamp; without one the outer permission layer owns
 * the failure policy and this helper returns undefined.
 */
export function permissionCheckFailureDecision(toolName, context, effects) {
  const clamps = effects.readPermissionContext(context).bashCommandClamps;
  if (clamps !== undefined && clamps.length > 0) {
    return {
      behavior: "deny",
      message:
        `The ${toolName} permission check crashed and this agent carries a ` +
        "per-spawn bashCommandClamp; denying rather than running an unverified command.",
      decisionReason: { type: "other", reason: CLAMP_FAILURE_REASON },
    };
  }
  return undefined;
}

const COMMAND_SUBSTITUTION_VALUE = "__CMDSUB_OUTPUT__";
const UNKNOWN_TRACKED_VALUE = "__TRACKED_VAR__";
const STDBUF_SEPARATE_OPTION = /^-[ioe]$/;
const STDBUF_ATTACHED_OPTION = /^-[ioe]./;
const STDBUF_LONG_OPTION = /^--(input|output|error)=/;
const ARRAY_OPERAND_FLAGS = {
  test: new Set(["-v", "-R", "-t"]),
  "[": new Set(["-v", "-R", "-t"]),
  "[[": new Set(["-v", "-R", "-t"]),
  printf: new Set(["-v"]),
  read: new Set(["-a"]),
  unset: new Set(["-v"]),
  wait: new Set(["-p"]),
};
const ARITHMETIC_COMPARISON_OPERATORS = new Set([
  "-eq",
  "-ne",
  "-lt",
  "-le",
  "-gt",
  "-ge",
]);
const INTEGER_LITERAL = /^-?(0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[0-9]+)$/;
const READ_OR_UNSET = new Set(["read", "unset"]);
const TYPESET_COMMANDS = new Set([
  "declare",
  "typeset",
  "local",
  "export",
  "readonly",
  "private",
  "float",
  "integer",
]);
const ASSIGNMENT_COMMANDS = new Set([
  "declare",
  "typeset",
  "local",
  "export",
  "readonly",
  "print",
  "getopts",
  "set",
  "zparseopts",
  "zformat",
  "zstyle",
  "autoload",
  "shift",
  "exit",
  "return",
  "break",
  "continue",
  "bye",
  "logout",
  "vared",
  "private",
  "getln",
  "zregexparse",
  "float",
  "integer",
]);
const SAFE_SET_O_OPTIONS = new Set([
  "pipefail",
  "errexit",
  "nounset",
  "xtrace",
  "noglob",
  "noclobber",
  "verbose",
  "monitor",
  "notify",
  "vi",
  "emacs",
  "errtrace",
  "functrace",
  "hashall",
  "physical",
  "ignoreeof",
]);
const SAFE_SET_SHORT_OPTIONS = new Set([
  "e",
  "u",
  "x",
  "f",
  "C",
  "v",
  "m",
  "b",
  "E",
  "T",
  "h",
  "P",
  "n",
]);
const READ_STRING_OPTIONS = new Set(["-p", "-d", "-n", "-N", "-t", "-u", "-i"]);
const READ_NUMERIC_OPTIONS = new Set(["-t", "-n", "-N"]);
const DECIMAL_NUMBER = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/;
const SUBSCRIPTED_NAME = /^[A-Za-z_][A-Za-z0-9_]*\[/;
const PROC_ENVIRON = /\/proc\/.*\/environ/;
const NEWLINE_COMMENT = /\n\s*#/;
const ZSH_SECURITY_BUILTINS = new Set([
  "zmodload",
  "emulate",
  "sysopen",
  "sysread",
  "syswrite",
  "sysseek",
  "zpty",
  "ztcp",
  "zsocket",
  "zf_rm",
  "zf_mv",
  "zf_ln",
  "zf_chmod",
  "zf_chown",
  "zf_mkdir",
  "zf_rmdir",
  "zf_chgrp",
  "repeat",
  "foreach",
  "zcompile",
  "setopt",
  "unsetopt",
  "disable",
  "shopt",
  "autoload",
  "functions",
]);
const FIND_ACTIONS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
  "-files0-from",
]);
const FIND_OPTIONS_WITH_VALUES = new Set([
  "-name",
  "-iname",
  "-path",
  "-ipath",
  "-lname",
  "-ilname",
  "-regex",
  "-iregex",
  "-wholename",
  "-iwholename",
  "-samefile",
  "-newer",
  "-anewer",
  "-cnewer",
  "-mnewer",
  "-perm",
  "-user",
  "-group",
  "-uid",
  "-gid",
  "-size",
  "-type",
  "-xtype",
  "-fstype",
  "-inum",
  "-links",
  "-used",
  "-context",
  "-amin",
  "-cmin",
  "-mmin",
  "-atime",
  "-ctime",
  "-mtime",
  "-mindepth",
  "-maxdepth",
  "-printf",
  "-regextype",
  "-D",
  "-f",
  "-flags",
  "-Bnewer",
  "-Btime",
  "-Bmin",
  "-files0-from",
  "-xattrname",
]);
const FIND_NEWER_OPTION = /^-newer[aBcm][aBcmt]$/;
const EVALUATING_BUILTINS = new Set([
  "eval",
  "source",
  ".",
  "exec",
  "nocorrect",
  "fc",
  "coproc",
  "trap",
  "enable",
  "mapfile",
  "readarray",
  "hash",
  "bind",
  "complete",
  "compgen",
  "alias",
  "let",
]);
const AWK_COMMANDS = new Set(["awk", "gawk", "mawk", "nawk"]);
const AWK_OPTION_WITH_VALUE = /^(?:-[FvW]$|--(?:fie|a$|as))/;
const COMMAND_WRAPPERS = new Set([
  "watch",
  "ionice",
  "chrt",
  "setsid",
  "taskset",
  "strace",
  "ltrace",
  "script",
  "flock",
  "unshare",
  "nsenter",
]);
export function hasUnknownTrackedValue(value) {
  return (
    value.includes(COMMAND_SUBSTITUTION_VALUE) ||
    value.includes(UNKNOWN_TRACKED_VALUE)
  );
}

function displayTrackedValue(value) {
  return value
    .replaceAll(COMMAND_SUBSTITUTION_VALUE, "$(…)")
    .replaceAll(UNKNOWN_TRACKED_VALUE, "${…}");
}

function awkProgramHazard(program) {
  if (/(?<![A-Za-z_])system[\s\\]*\(/.test(program)) {
    return "awk program contains system() which executes arbitrary commands";
  }
  if (
    /(?:^|[^|])\|&?[^/|%\";#{}]*\"/.test(program) ||
    /(?:^|[^|])\|&?[\s\\]*getline\b/.test(program)
  ) {
    return 'awk program contains a command pipe (| "cmd" or | getline) which executes arbitrary commands';
  }
  if (
    /@[\s\\]*(?:load|include)\b|@[\s\\]*\w+(?:::\w+)?(?:\[[^\]]*\])*[\s\\]*\(/.test(
      program,
    )
  ) {
    return "awk program contains @load/@include or an @indirect call which can execute arbitrary code";
  }
  if (/(?<![A-Za-z_])extension[\s\\]*\(/.test(program)) {
    return "awk program contains extension() which loads arbitrary native code (legacy gawk)";
  }
  if (/\"\/inet[46]?\//.test(program)) {
    return "awk program opens a gawk /inet/ network socket which can exfiltrate data";
  }
  return false;
}

/**
 * Upstream bQn @ chunk-9e2ns8ty 163205–175587. This is the admission check
 * between KTe's structural classifier and every later permission decision.
 */
export function validateCommandSemantics(commands) {
  let delayedNewlineFailure = null;

  for (const command of commands) {
    let argv = command.argv;
    let throughXargs = false;

    while (true) {
      const basename = argv[0]?.replace(/^.*[\\/]/, "");
      const wrapper = [
        "time",
        "nohup",
        "timeout",
        "nice",
        "stdbuf",
        "env",
        "command",
        "xargs",
      ].includes(basename)
        ? basename
        : argv[0];

      if (wrapper === "time" || wrapper === "nohup") {
        argv = argv.slice(1);
      } else if (wrapper === "timeout") {
        let index = 1;
        while (index < argv.length) {
          const argument = argv[index];
          if (["--foreground", "--preserve-status", "--verbose"].includes(argument)) {
            index++;
          } else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(argument)) {
            index++;
          } else if (
            (argument === "--kill-after" || argument === "--signal") &&
            argv[index + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(argv[index + 1])
          ) {
            index += 2;
          } else if (argument.startsWith("--")) {
            return {
              ok: false,
              reason: `timeout with ${argument} flag cannot be statically analyzed`,
            };
          } else if (argument === "-v") {
            index++;
          } else if (
            (argument === "-k" || argument === "-s") &&
            argv[index + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(argv[index + 1])
          ) {
            index += 2;
          } else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(argument)) {
            index++;
          } else if (argument.startsWith("-")) {
            return {
              ok: false,
              reason: `timeout with ${argument} flag cannot be statically analyzed`,
            };
          } else break;
        }
        if (argv[index] && /^\d+(?:\.\d+)?[smhd]?$/.test(argv[index])) {
          argv = argv.slice(index + 1);
        } else if (argv[index]) {
          return {
            ok: false,
            reason: `timeout duration '${argv[index]}' cannot be statically analyzed`,
          };
        } else break;
      } else if (wrapper === "nice") {
        if (argv[1] === "-n" && argv[2] && /^-?\d+$/.test(argv[2])) {
          argv = argv.slice(3);
        } else if (argv[1] && /^-\d+$/.test(argv[1])) {
          argv = argv.slice(2);
        } else if (
          argv[1] &&
          (/[$(`]/.test(argv[1]) || hasUnknownTrackedValue(argv[1]))
        ) {
          return {
            ok: false,
            reason: `nice argument '${argv[1]}' contains expansion — cannot statically determine wrapped command`,
          };
        } else argv = argv.slice(1);
      } else if (wrapper === "env") {
        let index = 1;
        while (index < argv.length) {
          const argument = argv[index];
          if (argument.includes("=") && !argument.startsWith("-")) index++;
          else if (["-i", "-0", "-v"].includes(argument)) index++;
          else if (argument === "-u" && argv[index + 1]) index += 2;
          else if (argument.startsWith("-")) {
            return {
              ok: false,
              reason: `env with ${argument} flag cannot be statically analyzed`,
            };
          } else break;
        }
        if (index < argv.length) argv = argv.slice(index);
        else break;
      } else if (wrapper === "stdbuf") {
        let index = 1;
        while (index < argv.length) {
          const argument = argv[index];
          if (STDBUF_SEPARATE_OPTION.test(argument) && argv[index + 1]) index += 2;
          else if (STDBUF_ATTACHED_OPTION.test(argument)) index++;
          else if (STDBUF_LONG_OPTION.test(argument)) index++;
          else if (argument.startsWith("-")) {
            return {
              ok: false,
              reason: `stdbuf with ${argument} flag cannot be statically analyzed`,
            };
          } else break;
        }
        if (index > 1 && index < argv.length) argv = argv.slice(index);
        else break;
      } else if (wrapper === "command") {
        let index = 1;
        let inspectionOnly = false;
        while (
          index < argv.length &&
          argv[index].startsWith("-") &&
          argv[index] !== "--"
        ) {
          const argument = argv[index];
          if (!/^-[pvV]+$/.test(argument)) {
            return {
              ok: false,
              reason: `command with ${argument} flag cannot be statically analyzed`,
            };
          }
          if (argument.includes("v") || argument.includes("V")) inspectionOnly = true;
          index++;
        }
        if (argv[index] === "--") index++;
        if (inspectionOnly || index >= argv.length) break;
        argv = argv.slice(index);
      } else if (argv[0] === "builtin" || argv[0] === "noglob") {
        const index = argv[0] === "builtin" && argv[1] === "--" ? 2 : 1;
        if (index < argv.length) argv = argv.slice(index);
        else break;
      } else if (wrapper === "xargs") {
        if (argv.length >= 2 && !argv[1].startsWith("-")) {
          argv = argv.slice(1);
          throughXargs = true;
        } else break;
      } else break;
    }

    const name = argv[0];
    if (name === undefined) continue;
    if (name === "") {
      return {
        ok: false,
        reason: "Empty command name — argv[0] may not reflect what bash runs",
      };
    }
    if (name.includes(COMMAND_SUBSTITUTION_VALUE) || name.includes(UNKNOWN_TRACKED_VALUE)) {
      return {
        ok: false,
        reason: "Command name is runtime-determined (placeholder argv[0])",
      };
    }
    if (name.startsWith("-") || name.startsWith("|") || name.startsWith("&")) {
      return { ok: false, reason: "Command appears to be an incomplete fragment" };
    }

    const operandFlags = Object.hasOwn(ARRAY_OPERAND_FLAGS, name)
      ? ARRAY_OPERAND_FLAGS[name]
      : undefined;
    const isTest = name === "test" || name === "[" || name === "[[";
    if (operandFlags !== undefined) {
      for (let index = 1; index < argv.length; index++) {
        const argument = argv[index];
        const operand = argv[index + 1];
        if (
          operandFlags.has(argument) &&
          operand !== undefined &&
          (operand.includes("[") || hasUnknownTrackedValue(operand))
        ) {
          return {
            ok: false,
            reason: `'${name} ${argument}' operand contains array subscript or runtime-determined value — bash evaluates $(cmd) in subscripts`,
          };
        }
        if (isTest) {
          if (
            argument === "-t" &&
            operand !== undefined &&
            !INTEGER_LITERAL.test(operand)
          ) {
            return {
              ok: false,
              reason: `'${name} -t' operand is non-numeric — zsh arith-evals identifiers (may run $(cmd))`,
            };
          }
          continue;
        }
        if (
          argument.length > 2 &&
          argument[0] === "-" &&
          argument[1] !== "-" &&
          !argument.includes("[")
        ) {
          for (const flag of operandFlags) {
            if (
              flag.length === 2 &&
              argument.includes(flag[1]) &&
              operand !== undefined &&
              (operand.includes("[") || hasUnknownTrackedValue(operand))
            ) {
              return {
                ok: false,
                reason: `'${name} ${flag}' (combined in '${argument}') operand contains array subscript — bash evaluates $(cmd) in subscripts`,
              };
            }
          }
        }
        if (argument.length > 2 && argument[0] === "-" && name !== "read") {
          for (const flag of operandFlags) {
            if (flag.length !== 2) continue;
            const at = argument.indexOf(flag[1], 1);
            if (at === -1 || at === argument.length - 1) continue;
            const fused = argument.slice(at + 1);
            if (
              /[A-Za-z_][A-Za-z0-9_]*\[/.test(fused) ||
              hasUnknownTrackedValue(fused)
            ) {
              return {
                ok: false,
                reason: `'${name} ${flag}' (fused in '${argument}') operand contains array subscript — bash evaluates $(cmd) in subscripts`,
              };
            }
          }
        }
      }
    }

    if (isTest) {
      for (let index = 2; index < argv.length; index++) {
        if (!ARITHMETIC_COMPARISON_OPERATORS.has(argv[index])) continue;
        for (const operand of [argv[index - 1], argv[index + 1]]) {
          if (operand === undefined) continue;
          if (operand.includes("[") || !INTEGER_LITERAL.test(operand)) {
            return {
              ok: false,
              reason: `'${name} ... ${argv[index]} ...' operand is non-numeric — \`[[\` arithmetically evaluates identifiers/subscripts (may run $(cmd))`,
            };
          }
        }
      }
    }

    if (READ_OR_UNSET.has(name)) {
      let pending = false;
      for (let index = 1; index < argv.length; index++) {
        const argument = argv[index];
        if (pending !== false) {
          const kind = pending;
          pending = false;
          if (kind === "numeric" && !DECIMAL_NUMBER.test(argument)) {
            return {
              ok: false,
              reason: `'read ${argv[index - 1]}' operand '${argument}' is non-numeric — zsh arith-evals subscripts/expressions (may run $(cmd))`,
            };
          }
          if (
            kind === "prompt" &&
            (SUBSCRIPTED_NAME.test(argument) ||
              (argument[0] === "-" && /[A-Za-z_][A-Za-z0-9_]*\[/.test(argument)) ||
              argument.includes(COMMAND_SUBSTITUTION_VALUE))
          ) {
            return {
              ok: false,
              reason: `'read ${argv[index - 1]}' operand '${argument}' is a subscripted NAME, dash-prefixed with a subscript, or runtime-determined — zsh -p takes no operand; may arith-eval the subscript and run $(cmd)`,
            };
          }
          continue;
        }
        if (argument[0] === "-") {
          if (name === "read") {
            if (READ_NUMERIC_OPTIONS.has(argument)) pending = "numeric";
            else if (argument === "-p") pending = "prompt";
            else if (READ_STRING_OPTIONS.has(argument)) pending = "string";
            else if (argument.length > 2) {
              for (let offset = 1; offset < argument.length; offset++) {
                const flag = `-${argument[offset]}`;
                const numeric = READ_NUMERIC_OPTIONS.has(flag);
                if (numeric || READ_STRING_OPTIONS.has(flag)) {
                  if (offset === argument.length - 1) {
                    pending = numeric
                      ? "numeric"
                      : flag === "-p"
                        ? "prompt"
                        : "string";
                  } else if (
                    numeric &&
                    !DECIMAL_NUMBER.test(argument.slice(offset + 1))
                  ) {
                    return {
                      ok: false,
                      reason: `'read ${flag}' (fused in '${argument}') operand is non-numeric — zsh arith-evals subscripts/expressions (may run $(cmd))`,
                    };
                  } else if (flag === "-p") {
                    const fused = argument.slice(offset + 1);
                    if (
                      /[A-Za-z_][A-Za-z0-9_]*\[/.test(fused) ||
                      fused.includes(COMMAND_SUBSTITUTION_VALUE)
                    ) {
                      return {
                        ok: false,
                        reason: `'read -p' fused remainder '${fused}' contains a subscripted identifier or cmdsub — on zsh (-p is no-arg) this may reach matheval via a following option and run $(cmd)`,
                      };
                    }
                  }
                  break;
                }
              }
            }
          }
          continue;
        }
        if (argument.includes("[") || hasUnknownTrackedValue(argument)) {
          return {
            ok: false,
            reason: `'${name}' positional NAME '${argument}' contains array subscript or runtime-determined value — bash evaluates $(cmd) in subscripts`,
          };
        }
      }
    }

    if (ASSIGNMENT_COMMANDS.has(name)) {
      const declaration = ["declare", "typeset", "local"].includes(name);
      const assigns = declaration || name === "export" || name === "readonly";
      const functionFlags = declaration || name === "readonly";
      let sawFunction = false;
      let sawAutoload = false;
      for (let index = 1; index < argv.length; index++) {
        const argument = argv[index];
        if (declaration && /^[+-].*[niaAEF]/.test(argument)) {
          return {
            ok: false,
            reason: `'${name}' with -n/-i/-a/-A/-E/-F flag (reached as plain command via wrapper/quote) changes assignment eval semantics`,
          };
        }
        if (functionFlags) {
          if (/^[+-].*f/.test(argument)) sawFunction = true;
          if (/^[+-].*[uU]/.test(argument)) sawAutoload = true;
          if (sawFunction && sawAutoload) {
            return {
              ok: false,
              reason: `'${name}' with both -f and -u/-U flags (reached as plain command via wrapper/quote) — zsh marks a function for autoload (synonym of 'autoload')`,
            };
          }
        }
        if (TYPESET_COMMANDS.has(name) && /^[+-].*[iEF]/.test(argument)) {
          return {
            ok: false,
            reason: `'${name}' with -i/-E/-F flag (reached as plain command via wrapper/quote) — zsh bin_typeset mathevals the RHS`,
          };
        }
        if ((assigns || name === "private") && /^[+-].*m/.test(argument)) {
          return {
            ok: false,
            reason: `'${name}' with -m/+m flag (reached as plain command via wrapper/quote) — zsh pattern-assigns every matching variable`,
          };
        }
        if (TYPESET_COMMANDS.has(name) && /^[+-].*T/.test(argument)) {
          return {
            ok: false,
            reason: `'${name} -T' creates a user-defined zsh tied pair — tracked literals for its operands are unreliable`,
          };
        }
        const subscriptExpansion = argument.includes("[") && /[$`]/.test(argument);
        if (subscriptExpansion || hasUnknownTrackedValue(argument)) {
          return {
            ok: false,
            reason: subscriptExpansion
              ? `'${name}' operand '${displayTrackedValue(argument)}' contains array subscript with expansion — shell arith-evals $(cmd) in subscripts`
              : `'${name}' operand '${displayTrackedValue(argument)}' is runtime-determined and may carry an array subscript — shell arith-evals $(cmd) in subscripts`,
          };
        }
        if ((name === "float" || name === "integer") && !/^[+-]/.test(argument)) {
          return {
            ok: false,
            reason: `zsh '${name}' operand — implicit typeset -E/-i arithmetically evaluates the (existing or assigned) value`,
          };
        }
      }
    }

    if (name === "printf") {
      for (let index = 1; index < argv.length; index++) {
        const argument = argv[index];
        const subscriptExpansion = argument.includes("[") && /[$`]/.test(argument);
        if (subscriptExpansion || hasUnknownTrackedValue(argument)) {
          return {
            ok: false,
            reason: subscriptExpansion
              ? `printf operand '${displayTrackedValue(argument)}' contains array subscript with expansion — zsh arith-evals %d/%i operands (may run $(cmd))`
              : `printf operand '${displayTrackedValue(argument)}' is runtime-determined and may carry an array subscript — zsh arith-evals %d/%i operands (may run $(cmd))`,
          };
        }
      }
    }

    if (name === "set") {
      for (let index = 1; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--") break;
        if (!/^[-+]/.test(argument)) continue;
        for (let offset = 1; offset < argument.length; offset++) {
          const option = argument[offset];
          if (option === "o") {
            const value =
              offset < argument.length - 1
                ? argument.slice(offset + 1)
                : argv[index + 1];
            if (
              value !== undefined &&
              value !== "" &&
              !SAFE_SET_O_OPTIONS.has(value.toLowerCase().replace(/[_-]/g, ""))
            ) {
              return {
                ok: false,
                reason: `'set -o/+o ${value}' changes shell parsing/globbing state — can enable globsubst/extendedglob and defeat static analysis`,
              };
            }
            if (offset === argument.length - 1) index++;
            break;
          }
          if (option === "A") break;
          if (!SAFE_SET_SHORT_OPTIONS.has(option)) {
            return {
              ok: false,
              reason: `'set ${argument[0]}${option}' changes shell option state (allexport/keyword/…) — defeats static env-var analysis; see SET_O_SAFE_LETTERS`,
            };
          }
        }
      }
    }

    if (name === "print" && argv.some((argument) => /^[+-].*P/.test(argument))) {
      for (let index = 1; index < argv.length; index++) {
        if (/\$\(|`/.test(argv[index]) || hasUnknownTrackedValue(argv[index])) {
          return {
            ok: false,
            reason: "'print -P' operand contains command substitution — zsh prompt expansion evaluates $(cmd)",
          };
        }
      }
    }
    if (name === "jobs") {
      for (let index = 1; index < argv.length; index++) {
        if (/^[+-].*x/.test(argv[index])) {
          return {
            ok: false,
            reason: "'jobs -x' executes its argument as a command — cannot be statically analyzed",
          };
        }
      }
    }
    if (SHELL_KEYWORDS.has(name)) {
      return {
        ok: false,
        reason: `Shell keyword '${name}' as command name — tree-sitter mis-parse`,
      };
    }

    if (throughXargs) {
      if (name === "find" || name === "jq") {
        return {
          ok: false,
          reason: `${name} through xargs — stdin-appended arguments cannot be statically analyzed`,
        };
      }
      if (AWK_COMMANDS.has(name)) {
        let staticProgram = false;
        for (let index = 1; index < argv.length; index++) {
          const argument = argv[index];
          if (argument === "--") {
            staticProgram = index + 1 < argv.length;
            break;
          }
          if (argument === "-" || !argument.startsWith("-")) {
            staticProgram = true;
            break;
          }
          if (!argument.includes("=") && AWK_OPTION_WITH_VALUE.test(argument)) index++;
        }
        if (!staticProgram) {
          return {
            ok: false,
            reason: `${name} through xargs with no static program — stdin-supplied program text cannot be statically analyzed`,
          };
        }
      }
    }

    if (name === "jq") {
      for (const argument of argv) {
        if (/\bsystem\s*\(/.test(argument)) {
          return {
            ok: false,
            reason: "jq command contains system() function which executes arbitrary commands",
          };
        }
        if (/\b(?:include|import)\b/.test(argument)) {
          return {
            ok: false,
            reason:
              'jq command contains include/import — modules can load arbitrary .jq files via {search:"."} and call env or other builtins',
          };
        }
      }
      if (
        argv.some((argument) =>
          /^(?:-[A-Za-z]*[fL]|--(?:from-file|rawfile|slurpfile|library-path)(?:$|=))/.test(
            argument,
          ),
        )
      ) {
        return {
          ok: false,
          reason:
            "jq command contains dangerous flags that could execute code or read arbitrary files",
        };
      }
    }

    if (AWK_COMMANDS.has(name)) {
      if (command.hasUnquotedGlob) {
        return {
          ok: false,
          reason:
            "awk command contains unquoted glob characters — could glob-expand to a planted program or flag before awk runs",
        };
      }
      for (const argument of argv) {
        const hazard = awkProgramHazard(argument);
        if (hazard !== false) return { ok: false, reason: hazard };
        if (hasUnknownTrackedValue(argument)) {
          return {
            ok: false,
            reason:
              "awk argument is runtime-determined — substituted text becomes awk code and cannot be statically analyzed",
          };
        }
      }
      if (
        argv.some(
          (argument) =>
            /^-[bcCghIkMnNOPrsStV]*[fEileDW]/.test(argument) ||
            /^--(?:fil|e|i|lo|s|de)/.test(argument),
        )
      ) {
        return {
          ok: false,
          reason:
            "awk command uses flags that read the program from a file, load extensions, or supply program fragments — cannot be statically analyzed",
        };
      }
    }

    if (name === "find") {
      if (command.hasUnquotedGlob) {
        return {
          ok: false,
          reason:
            "find contains unquoted glob characters — could glob-expand to a dangerous action before find runs",
        };
      }
      for (let index = 1; index < argv.length; index++) {
        const argument = argv[index];
        if (FIND_ACTIONS.has(argument)) {
          return {
            ok: false,
            reason: `find with '${argument}' executes commands or modifies files — cannot be auto-allowed by a Bash(find:*) prefix rule`,
          };
        }
        if (
          FIND_OPTIONS_WITH_VALUES.has(argument) ||
          FIND_NEWER_OPTION.test(argument)
        ) {
          index++;
          continue;
        }
        if (hasUnknownTrackedValue(argument)) {
          return {
            ok: false,
            reason:
              "find argument is runtime-determined — could resolve to a dangerous action",
          };
        }
        if (/[[\]*?]/.test(argument)) {
          return {
            ok: false,
            reason: `find argument '${argument}' contains glob characters — could glob-expand to a dangerous action`,
          };
        }
      }
    }

    if (ZSH_SECURITY_BUILTINS.has(name)) {
      return { ok: false, reason: `Zsh builtin '${name}' can bypass security checks` };
    }
    if (EVALUATING_BUILTINS.has(name)) {
      if (name === "fc" && !argv.slice(1).some((argument) => /^[+-].*[es]/.test(argument))) {
        // safe form
      } else if (
        name === "compgen" &&
        !argv.slice(1).some((argument) => /^[+-].*[CFW]/.test(argument))
      ) {
        // safe form
      } else {
        return { ok: false, reason: `'${name}' evaluates arguments as shell code` };
      }
    }
    if (COMMAND_WRAPPERS.has(name) && argv.length > 1) {
      return {
        ok: false,
        reason: `'${name}' runs its argument as a command — cannot be statically analyzed`,
      };
    }

    for (const argument of command.argv) {
      if (argument.includes("/proc/") && PROC_ENVIRON.test(argument)) {
        return { ok: false, reason: "Accesses /proc/*/environ which may expose secrets" };
      }
    }
    for (const redirect of command.redirects) {
      if (redirect.target.includes("/proc/") && PROC_ENVIRON.test(redirect.target)) {
        return { ok: false, reason: "Accesses /proc/*/environ which may expose secrets" };
      }
    }
    for (const argument of command.argv) {
      if (argument.includes("\n") && NEWLINE_COMMENT.test(argument)) {
        delayedNewlineFailure ??= {
          ok: false,
          kind: "newline-hash",
          reason:
            "Newline followed by # inside a quoted argument can hide arguments from path validation",
        };
      }
    }
    for (const assignment of command.envVars) {
      if (assignment.value.includes("\n") && NEWLINE_COMMENT.test(assignment.value)) {
        delayedNewlineFailure ??= {
          ok: false,
          kind: "newline-hash",
          reason:
            "Newline followed by # inside an env var value can hide arguments from path validation",
        };
      }
    }
    for (const redirect of command.redirects) {
      if (redirect.target.includes("\n") && NEWLINE_COMMENT.test(redirect.target)) {
        delayedNewlineFailure ??= {
          ok: false,
          kind: "newline-hash",
          reason:
            "Newline followed by # inside a redirect target can hide arguments from path validation",
        };
      }
    }
  }

  return delayedNewlineFailure ?? { ok: true };
}

export const CLAMP_REJECTION_REASON =
  "bashCommandClamp: no clamp rule matches this command";
export const SANDBOX_AUTO_ALLOW_REASON =
  "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)";

const ESCAPED_STAR = "\0ESCAPED_STAR\0";
const ESCAPED_BACKSLASH = "\0ESCAPED_BACKSLASH\0";
const ESCAPED_GLOBSTAR = "\0GLOBSTAR\0";

function hasUnescapedWildcard(pattern) {
  if (pattern.endsWith(":*")) return false;
  for (let index = 0; index < pattern.length; index++) {
    if (pattern[index] !== "*") continue;
    let escapes = 0;
    for (let before = index - 1; before >= 0 && pattern[before] === "\\"; before--) {
      escapes++;
    }
    if (escapes % 2 === 0) return true;
  }
  return false;
}

function endsWithUnescapedWildcard(pattern) {
  const trimmed = pattern.trimEnd();
  if (!trimmed.endsWith("*")) return false;
  let escapes = 0;
  for (
    let before = trimmed.length - 2;
    before >= 0 && trimmed[before] === "\\";
    before--
  ) {
    escapes++;
  }
  return escapes % 2 === 0;
}

function matchPermissionWildcard(pattern, command) {
  const normalizedPattern = pattern.trim().replace(/[ \t]+/g, " ");
  const normalizedCommand = command.replace(/[ \t]+/g, " ");
  let escaped = "";
  for (let index = 0; index < normalizedPattern.length; index++) {
    const character = normalizedPattern[index];
    if (character === "\\" && index + 1 < normalizedPattern.length) {
      const next = normalizedPattern[index + 1];
      if (next === "*") {
        escaped += ESCAPED_STAR;
        index++;
        continue;
      }
      if (next === "\\") {
        escaped += ESCAPED_BACKSLASH;
        index++;
        continue;
      }
    }
    escaped += character;
  }
  const globstarDirectories = /\/(?:\*\*\/)+/g;
  let expression = escaped
    .replace(/[.+?^${}()|[\]\\'\"]/g, "\\$&")
    .replace(globstarDirectories, ESCAPED_GLOBSTAR)
    .replaceAll("*", ".*")
    .replaceAll(ESCAPED_GLOBSTAR, "/(?:.*/)?")
    .replaceAll(ESCAPED_STAR, "\\*")
    .replaceAll(ESCAPED_BACKSLASH, "\\\\");
  const wildcardCount = (escaped.match(/\*/g) ?? []).length;
  if (expression.endsWith(" .*") && wildcardCount === 1) {
    expression = `${expression.slice(0, -3)}( .*)?`;
  }
  return new RegExp(`^${expression}$`, "s").test(normalizedCommand);
}

function parseClampPattern(content) {
  const prefix = content.match(/^(.+):\*$/)?.[1];
  if (prefix !== undefined) return { type: "prefix", prefix };
  if (hasUnescapedWildcard(content)) {
    return { type: "wildcard", pattern: content };
  }
  return { type: "exact", command: content };
}

function projectCommandWithoutRedirections(command) {
  if (!command || command.length > MAX_COMMAND_LENGTH) return command;
  const root = getParser().parse(command);
  if (!root) return command;
  const parts = [];
  const collect = (node) => {
    if (node.type === "comment") return;
    if (node.type === "redirected_statement") {
      for (const child of node.children) {
        if (!child.type.endsWith("_redirect")) {
          collect(child);
        }
      }
      return;
    }
    if (SPLIT_CONTAINER_TYPES.has(node.type)) {
      for (const child of node.children) {
        collect(child);
      }
      return;
    }
    parts.push(node.text);
  };
  const recovered =
    root.type === "ERROR" && root.children[0]?.type === "program"
      ? root.children[0]
      : root;
  collect(recovered);
  return parts.length > 0 ? parts.join(" ") : command;
}

function clampCandidates(span, phase) {
  const command = span.trim();
  const withoutRedirections = projectCommandWithoutRedirections(command);
  const bases = phase === "exact"
    ? [command, withoutRedirections]
    : [withoutRedirections];
  return bases.flatMap((candidate) => {
    const normalized = normalizeCommandPrefix(candidate);
    return normalized !== candidate ? [candidate, normalized] : [candidate];
  });
}

function clampContentMatches(span, content, phase) {
  const pattern = parseClampPattern(content);
  for (const candidate of clampCandidates(span, phase)) {
    if (pattern.type === "exact" && pattern.command === candidate) return true;
    if (pattern.type === "prefix") {
      const prefix = pattern.prefix.replace(/[ \t]+/g, " ");
      const normalized = candidate.replace(/[ \t]+/g, " ");
      if (phase === "exact" && prefix === normalized) return true;
      if (phase === "prefix" && splitSubcommands(candidate).length <= 1) {
        if (normalized === prefix || normalized.startsWith(`${prefix} `)) return true;
        const throughXargs = `xargs ${prefix}`;
        if (
          normalized === throughXargs ||
          normalized.startsWith(`${throughXargs} `)
        ) {
          return true;
        }
      }
    }
    if (
      pattern.type === "wildcard" &&
      phase === "prefix" &&
      splitSubcommands(candidate).length <= 1
    ) {
      if (matchPermissionWildcard(pattern.pattern, candidate)) return true;
      if (
        endsWithUnescapedWildcard(pattern.pattern) &&
        matchPermissionWildcard(`xargs ${pattern.pattern}`, candidate)
      ) {
        return true;
      }
    }
  }
  return false;
}

function unescapedDelimiter(value, delimiter, fromEnd = false) {
  let index = fromEnd ? value.length - 1 : 0;
  const step = fromEnd ? -1 : 1;
  while (index >= 0 && index < value.length) {
    if (value[index] === delimiter) {
      let escapes = 0;
      for (let before = index - 1; before >= 0 && value[before] === "\\"; before--) {
        escapes++;
      }
      if (escapes % 2 === 0) return index;
    }
    index += step;
  }
  return -1;
}

function parseClampRule(rule) {
  const open = unescapedDelimiter(rule, "(");
  if (open === -1) return { toolName: rule };
  const close = unescapedDelimiter(rule, ")", true);
  if (close === -1 || close <= open || close !== rule.length - 1) {
    return { toolName: rule };
  }
  const toolName = rule.slice(0, open);
  const encoded = rule.slice(open + 1, close);
  if (!toolName || encoded === "" || encoded === "*") return { toolName };
  return {
    toolName,
    ruleContent: encoded
      .replaceAll("\\(", "(")
      .replaceAll("\\)", ")")
      .replaceAll("\\\\", "\\"),
  };
}

function matchesClampRule(span, group) {
  return group.some((rule) => {
    const parsed = parseClampRule(rule);
    if (parsed.toolName !== BASH_TOOL_NAME || parsed.ruleContent === undefined) {
      return false;
    }
    return (
      clampContentMatches(span, parsed.ruleContent, "exact") ||
      clampContentMatches(span, parsed.ruleContent, "prefix")
    );
  });
}


export function splitClampCommands(command) {
  if (!command || command.length > MAX_COMMAND_LENGTH) return null;
  const root = getParser().parse(command);
  if (!root) return null;
  const commands = [];
  let valid = true;
  const collect = (node) => {
    if (!valid) return;
    if (SPLIT_OPERATOR_TYPES.has(node.type) || node.type === "comment") return;
    if (node.type === "redirected_statement") {
      for (const child of node.children) {
        if (!child.type.endsWith("_redirect")) collect(child);
      }
      return;
    }
    if (SPLIT_CONTAINER_TYPES.has(node.type)) {
      for (const child of node.children) {
        collect(child);
      }
      return;
    }
    if (node.type === "negated_command") {
      for (const child of node.children) {
        if (child.type !== "!") {
          collect(child);
        }
      }
      return;
    }
    if (node.type === "command" || node.type === "variable_assignment") {
      commands.push(node.text);
      return;
    }
    valid = false;
  };
  collect(root);
  return valid ? commands : null;
}

async function findClampMismatch(input, groups, effects) {
  if (groups.length === 0) return null;
  const fallback = {
    span: input.command.trim(),
    group: groups[0] ?? [],
    kind: "unverifiable",
  };
  const root = await parseOrAbort(input.command, effects.emitTelemetry);
  if (root === PARSE_ABORTED) return fallback;

  const classify = createCommandClassifier(
    effects.isSubprocessEnvironmentScrubbingEnabled ?? (() => false),
  );
  const classification = root
    ? classify(input.command, root)
    : { kind: "simple", commands: [], bareAssignmentNames: [] };
  if (classification.kind === "too-complex") return fallback;

  const splitCommands = splitClampCommands(input.command);
  if (splitCommands === null || splitCommands.length === 0) return fallback;
  const spans = [
    ...new Set([
      ...splitCommands,
      ...classification.commands.map((command) => command.text),
    ]),
  ];
  for (const group of groups) {
    for (const span of spans) {
      if (!matchesClampRule(span, group)) {
        return { span, group, kind: "unmatched" };
      }
    }
  }
  return null;
}

function displaySpan(span) {
  return JSON.stringify(span);
}

function treeContainsUnsafeBackgroundOperator(root) {
  for (const child of root.children) {
    if (!child) continue;
    if (child.type === "ERROR") return true;
    if (child.type === "&") {
      if (root.type !== "binary_expression") return true;
      continue;
    }
    if (treeContainsUnsafeBackgroundOperator(child)) return true;
  }
  return false;
}

const SUGGESTION_WRAPPER_COMMANDS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "csh",
  "tcsh",
  "ksh",
  "dash",
  "cmd",
  "powershell",
  "pwsh",
  "env",
  "xargs",
  "command",
  "builtin",
  "noglob",
  "nice",
  "stdbuf",
  "nohup",
  "timeout",
  "time",
  "watch",
  "ionice",
  "chrt",
  "setsid",
  "taskset",
  "strace",
  "ltrace",
  "script",
  "flock",
  "unshare",
  "nsenter",
  "sudo",
  "doas",
  "pkexec",
  "su",
  "runuser",
]);

function suggestion(ruleContent, prefix = false) {
  return [
    {
      type: "addRules",
      rules: [
        {
          toolName: BASH_TOOL_NAME,
          ruleContent: prefix ? `${ruleContent} *` : ruleContent,
        },
      ],
      behavior: "allow",
      destination: "localSettings",
    },
  ];
}

// Pinned cW: suggestion prefix inference does not strip session-only variables.
const SUGGESTION_ENVIRONMENT_NAMES = new Set([
  "GOEXPERIMENT",
  "GOOS",
  "GOARCH",
  "CGO_ENABLED",
  "GO111MODULE",
  "RUST_BACKTRACE",
  "RUST_LOG",
  "NODE_ENV",
  "PYTHONUNBUFFERED",
  "PYTHONDONTWRITEBYTECODE",
  "PYTEST_DISABLE_PLUGIN_AUTOLOAD",
  "PYTEST_DEBUG",
  "ANTHROPIC_API_KEY",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_TIME",
  "CHARSET",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "TZ",
  "LS_COLORS",
  "LSCOLORS",
  "GREP_COLOR",
  "GREP_COLORS",
  "GCC_COLORS",
  "TIME_STYLE",
  "BLOCK_SIZE",
  "BLOCKSIZE",
  "COLUMNS",
  "LINES",
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "CI",
  "DEBIAN_FRONTEND",
  "GIT_TERMINAL_PROMPT"
]);

function staticSuggestionPrefix(command) {
  const words = command.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (/^[A-Za-z_]\w*=/.test(words[index] ?? "")) {
    const name = words[index].split("=", 1)[0];
    if (!SUGGESTION_ENVIRONMENT_NAMES.has(name)) return null;
    index++;
  }
  const remaining = words.slice(index);
  if (remaining.length < 2) return null;
  if (SUGGESTION_WRAPPER_COMMANDS.has(remaining[0]?.split("/").pop())) {
    return null;
  }
  const argument = remaining[1];
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(argument)
    ? remaining.slice(0, 2).join(" ")
    : null;
}

function heredocSuggestionPrefix(command) {
  if (!command.includes("<<")) return null;
  const at = command.indexOf("<<");
  if (at <= 0) return null;
  const before = command.slice(0, at).trim();
  if (!before) return null;
  const prefix = staticSuggestionPrefix(before);
  if (prefix) return prefix;
  const argv = before.split(/\s+/).filter(Boolean);
  let index = 0;
  while (/^[A-Za-z_]\w*=/.test(argv[index] ?? "")) {
    const name = argv[index].split("=", 1)[0];
    if (!SUGGESTION_ENVIRONMENT_NAMES.has(name)) return null;
    index++;
  }
  if (index >= argv.length) return null;
  if (SUGGESTION_WRAPPER_COMMANDS.has(argv[index].split("/").pop())) return null;
  return argv.slice(index, index + 2).join(" ") || null;
}

export function permissionSuggestions(command) {
  const heredocPrefix = heredocSuggestionPrefix(command);
  if (heredocPrefix) return suggestion(heredocPrefix, true);
  if (command.includes("\n")) {
    const firstLine = command.slice(0, command.indexOf("\n")).trim();
    if (firstLine) return suggestion(firstLine, true);
  }
  const prefix = staticSuggestionPrefix(command);
  return prefix ? suggestion(prefix, true) : suggestion(command);
}

export const READ_ONLY_ALLOW_REASON = "Read-only command is allowed";
export const SANDBOX_BLOCKED_COMMANDS = new Set([
  "time", "nohup", "timeout", "nice", "stdbuf", "env", "command",
  "builtin", "noglob",
]);
export const SANDBOX_DYNAMIC_COMMANDS = new Set([
  "printf", "test", "read", "wait", "unset", ...ASSIGNMENT_COMMANDS,
]);
export const SANDBOX_UNSUPPORTED_COMMANDS = new Set([
  "awk", "gawk", "mawk", "nawk",
]);
export const FIND_VALUE_OPTIONS = new Set([
  "-name", "-iname", "-path", "-ipath", "-lname", "-ilname", "-regex",
  "-iregex", "-wholename", "-iwholename", "-samefile", "-newer",
  "-anewer", "-cnewer", "-mnewer", "-perm", "-user", "-group", "-uid",
  "-gid", "-size", "-type", "-xtype", "-fstype", "-inum", "-links",
  "-used", "-context", "-amin", "-cmin", "-mmin", "-atime", "-ctime",
  "-mtime", "-mindepth", "-maxdepth", "-printf", "-regextype", "-D", "-f",
  "-flags", "-Bnewer", "-Btime", "-Bmin", "-files0-from", "-xattrname",
]);
export const FIND_QUOTED_VALUE_OPTION = /^-newer[aBcm][aBcmt]$/;
export const READ_REDIRECT_OPERATORS = new Set(["<", "<<", "<<<", "<&"]);
export const GIT_RISK_EXCLUDED_COMMANDS = new Set(["rm", "rmdir", "sed"]);
export {
  ARITHMETIC_COMPARISON_OPERATORS,
  FIND_ACTIONS,
  SAFE_SET_O_OPTIONS,
  SAFE_SET_SHORT_OPTIONS,
};

const DANGEROUS_ENVIRONMENT_NAMES = new Set([
  "path", "home", "tmpprefix", "bash_env", "env", "cdpath", "globignore",
  "shell", "fpath", "bash_loadables_path", "module_path", "manpath",
  "mailpath", "readnullcmd", "nullcmd", "histfile", "zdotdir", "functions",
  "commands", "aliases", "galiases", "saliases", "lang", "language",
  "lc_all", "lc_ctype", "lc_collate", "lc_messages", "lc_numeric",
  "lc_time", "histchars", "textdomain", "textdomaindir",
]);
const DANGEROUS_SHELL_VARIABLES = new Set([
  "RANDOM", "SECONDS", "LINENO", "OPTIND", "MAILCHECK", "HISTCMD",
  "SRANDOM", "EPOCHSECONDS", "EPOCHREALTIME", "COLUMNS", "LINES", "SHLVL",
  "ERRNO", "TMOUT", "HISTSIZE", "SAVEHIST", "TRY_BLOCK_ERROR",
  "TRY_BLOCK_INTERRUPT", "KEYTIMEOUT", "LISTMAX", "LOGCHECK", "PERIOD",
  "FUNCNEST", "UID", "EUID", "GID", "EGID", "ZLE_RPROMPT_INDENT",
  "MBEGIN", "MEND", "PPID", "ARGC", "ZSH_SUBSHELL", "TTYIDLE", "status",
]);
const SANDBOX_ALWAYS_EXCLUDED = new Set([
  "eval", "source", ".", "exec", "nocorrect", "fc", "coproc", "trap",
  "enable", "mapfile", "readarray", "hash", "bind", "complete", "compgen",
  "alias", "let",
]);
const SANDBOX_ZSH_EXCLUDED = new Set([
  "zmodload", "emulate", "sysopen", "sysread", "syswrite", "sysseek",
  "zpty", "ztcp", "zsocket", "zf_rm", "zf_mv", "zf_ln", "zf_chmod",
  "zf_chown", "zf_mkdir", "zf_rmdir", "zf_chgrp", "repeat", "foreach",
  "zcompile", "setopt", "unsetopt", "disable", "shopt", "autoload",
  "functions",
]);
const SANDBOX_WRAPPER_EXCLUDED = new Set([
  "watch", "ionice", "chrt", "setsid", "taskset", "strace", "ltrace",
  "script", "flock", "unshare", "nsenter",
]);
const DANGEROUS_REMOVAL_COMMAND =
  /^(?:[A-Za-z_][A-Za-z0-9_]*\+?=[^\s]*\s+)*\\?(?:[^\s=]*\/)?(rm|rmdir)(?:\s|$)/;
const POSSIBLY_EMPTY_REMOVAL_TARGET =
  /^"?\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)"?\/(?:\*|\$|\/|["']|$)/;
const GIT_INTERNAL_PATHS = [
  /^head$/,
  /^objects(?:\/|$)/,
  /^refs(?:\/|$)/,
  /^hooks(?:\/|$)/,
];
const ownedPathArgumentExtractors = createFileArgumentExtractors(() => homedir());
const OWNED_PATH_COMMANDS = Object.keys(FILE_EFFECT_KINDS);

export function isSafeEnvironmentVariable(name) {
  return PREFIX_ENVIRONMENT_NAMES.has(name) || false;
}

export function isDangerousEnvironmentVariable(name) {
  const normalized = name.toLowerCase();
  return (
    DANGEROUS_ENVIRONMENT_NAMES.has(normalized) ||
    normalized.startsWith("ld_") ||
    normalized.startsWith("dyld_") ||
    normalized.startsWith("bash_func_") ||
    name === "IFS" ||
    name === "PS4" ||
    name === "PROMPT4" ||
    DANGEROUS_SHELL_VARIABLES.has(name)
  );
}

export function isSandboxExcludedCommand(command) {
  const basename = command.replace(/^.*[\\/]/, "");
  return (
    SANDBOX_ALWAYS_EXCLUDED.has(command) ||
    SANDBOX_ZSH_EXCLUDED.has(command) ||
    SANDBOX_WRAPPER_EXCLUDED.has(command) ||
    SANDBOX_WRAPPER_EXCLUDED.has(basename) ||
    basename === "rm" ||
    basename === "rmdir"
  );
}

export function stripEnvironmentAssignments(words) {
  let index = 0;
  while (index < words.length) {
    const assignment = words[index].match(
      /^([A-Za-z_][A-Za-z0-9_]*)\+?=(.*)$/,
    );
    if (assignment === null) break;
    if (isDangerousEnvironmentVariable(assignment[1])) return null;
    if(/["'`$\\(){}|;&<>*?[\]]/.test(assignment[2])) return null;
    index++;
  }
  return index === 0 ? words : words.slice(index);
}

export function dangerousRemovalDecision(command, message, suffix) {
  return {
    behavior: "ask",
    message,
    decisionReason: {
      type: "safetyCheck",
      reason: `Dangerous ${command} operation ${suffix}`,
      classifierApprovable: false,
      circuitBreaker: "dangerousRemoval",
    },
    suggestions: [],
  };
}

export function findDangerousRemovalExpansion(command) {
  if (!command.includes("$") || !/\brm(?:dir)?\b/.test(command)) return null;
  for (const part of splitSubcommands(command)) {
    let text = part
      .replace(/\\\r?\n/g, " ")
      .replace(/`[^`]*`/g, " ")
      .trimStart();
    while (text.startsWith("(") || text.startsWith("{")) {
      text = text.slice(1).trimStart();
    }
    for (let previous = ""; previous !== text;) {
      previous = text;
      text = text
        .replace(/\$\([^()]*\)/g, " ")
        .replace(/(?<!\$)\([^()]*\)/g, " ");
    }
    text = text.replace(/(?<![<>&])&(?![<>&])/g, ";");
    for (const segment of text.split(/[;|\n\r]|&&/)) {
      const candidate = segment.trimStart();
      const match = candidate.match(DANGEROUS_REMOVAL_COMMAND);
      if (match === null) continue;
      const removal = match[1] === "rmdir" ? "rmdir" : "rm";
      const words = candidate.slice(match[0].length).split(/\s+/);
      for (let index = 0; index < words.length; index++) {
        const word = words[index].replace(/[)\]}]+$/, "");
        if (word === "" || word.startsWith("-") || word.startsWith("'")) {
          continue;
        }
        if (/^[\d&]*[<>]/.test(word)) {
          if (/^(?:[0-9]+|&)?(?:>>?[|&]?|<<?<?|<>)$/.test(word)) index++;
          continue;
        }
        if (POSSIBLY_EMPTY_REMOVAL_TARGET.test(word)) {
          return { command: removal, target: word };
        }
      }
    }
  }
  return null;
}

export function isPathLike(path) {
  return (
    isAbsolutePath(path) ||
    path.startsWith("./") ||
    path.startsWith("../") ||
    path === "." ||
    path === ".."
  );
}

export function isSafeWindowsPath(path, cwd) {
  let remaining = path;
  let depth;
  let absolute = /^[A-Za-z]:[\\/]/.exec(path);
  if (absolute) {
    remaining = path.slice(absolute[0].length);
    depth = 0;
  } else if (/^[\\/]/.test(path) || path.includes("\\")) {
    return false;
  } else {
    if (/^[\\/]{2}/.test(cwd)) return false;
    depth = 0;
    for (const part of cwd.replace(/^[A-Za-z]:/, "").split(/[\\/]/)) {
      if (part === "" || part === ".") continue;
      depth += part === ".." ? -1 : 1;
    }
  }
  const relative = !absolute;
  let climbed = false;
  for (const part of remaining.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (depth === 0) return false;
      depth--;
      climbed = true;
      continue;
    }
    if (relative && climbed) return false;
    if (part.includes(":") || /[ .]$/.test(part)) return false;
    depth++;
  }
  return true;
}

function decodeRedirectNode(node) {
  switch (node.type) {
    case "raw_string":
      return node.text.slice(1, -1);
    case "string":
      return node.text
        .slice(1, -1)
        .replace(/\\([$`"\\\n])/g, (_match, value) => value === "\n" ? "" : value);
    case "word":
      return node.text.replace(
        /\\([\s\S])/g,
        (_match, value) => value === "\n" ? "" : value,
      );
    default:
      return node.text;
  }
}

const WINDOWS_OPTION_ASSIGNMENT = /^--?[A-Za-z0-9][\w-]*=/;
const WINDOWS_QUESTION_NAMESPACE_ANYWHERE =
  /(?:^|[^A-Za-z0-9_])[\\/]\?\?(?:[\\/]|$)/;
const WINDOWS_QUESTION_NAMESPACE_PREFIX = /^[\\/]\?\?[\\/]/;

function hostPlatformName() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return process.platform;
}

function hasWindowsQuestionNamespace(value) {
  return (
    WINDOWS_QUESTION_NAMESPACE_PREFIX.test(value) ||
    (value.includes("??") &&
      WINDOWS_QUESTION_NAMESPACE_PREFIX.test(nodePath.win32.normalize(value)))
  );
}

function hasWindowsNetworkPrefix(value) {
  return /^[\\/]{2}/.test(value) || hasWindowsQuestionNamespace(value);
}

/** Pinned Bn: network/device namespace shape, independent of host platform. */
export function hasBlockedPathShape(value) {
  return hasWindowsNetworkPrefix(value);
}

/** Pinned S_: the complete platform-gated Windows UNC-path grammar. */
export function isWindowsUncPath(
  value,
  scanEmbedded = false,
  platform = hostPlatformName(),
) {
  if (platform !== "windows") return false;
  if (scanEmbedded && hasBlockedPathShape(value)) return true;
  if (scanEmbedded && /^-[A-Za-z0-9]/.test(value)) {
    const remainder = value.replace(/^(?:-[A-Za-z0-9]+)+/, "");
    if (remainder.length > 0 && isWindowsUncPath(remainder, true, platform)) {
      return true;
    }
  }
  if (scanEmbedded && WINDOWS_OPTION_ASSIGNMENT.test(value)) {
    let remainder = value;
    while (WINDOWS_OPTION_ASSIGNMENT.test(remainder)) {
      remainder = remainder.slice(remainder.indexOf("=") + 1);
    }
    if (remainder.length > 0 && isWindowsUncPath(remainder, true, platform)) {
      return true;
    }
  }
  if (/\\\\[^ \t\r\n\f\v\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i.test(value)) {
    return true;
  }
  if (WINDOWS_QUESTION_NAMESPACE_ANYWHERE.test(value)) return true;
  if (/(?<!:)\/\/[^ \t\r\n\f\v\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i.test(value)) {
    return true;
  }
  if (
    (scanEmbedded
      ? /(?<![:\w])\/\\{1,}[^ \t\r\n\f\v\\/]+[\\/]/
      : /\/\\{2,}[^ \t\r\n\f\v\\/]/
    ).test(value)
  ) {
    return true;
  }
  if (
    (scanEmbedded
      ? /(?<![:\w])\\{1,}\/[^ \t\r\n\f\v\\/]+[\\/]/
      : /\\{2,}\/[^ \t\r\n\f\v\\/]/
    ).test(value)
  ) {
    return true;
  }
  if (/@SSL@\d+/i.test(value) || /@\d+@SSL/i.test(value)) return true;
  if (/DavWWWRoot/i.test(value)) return true;
  if (
    /^\\\\(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\\/]/.test(value) ||
    /^\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\\/]/.test(value)
  ) {
    return true;
  }
  if (
    /^\\\\(\[[\da-fA-F:]+\])[\\/]/.test(value) ||
    /^\/\/(\[[\da-fA-F:]+\])[\\/]/.test(value)
  ) {
    return true;
  }
  return false;
}

/** Pinned DU: return the first shell-glob byte, or -1 for static text. */
export function shellExpansionIndex(value) {
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "*" || character === "?") return index;
    if (character === "[" && value.indexOf("]", index + 1) !== -1) {
      return index;
    }
  }
  return -1;
}

export function analyzeAstRedirections(
  redirects,
  platform = hostPlatformName(),
) {
  const redirections = [];
  const denyCheckOutputRedirections = [];
  let hasDangerousRedirection = false;
  let dangerousRedirectionReason;
  for (const redirect of redirects) {
    if (/^\/dev\/(tcp|udp)\//.test(redirect.target)) {
      hasDangerousRedirection = true;
      dangerousRedirectionReason = "network_device";
      continue;
    }
    if (
      isWindowsUncPath(
        redirect.target.replace(/\\/g, "/"),
        true,
        platform,
      )
    ) {
      hasDangerousRedirection = true;
      if (dangerousRedirectionReason !== "network_device") {
        dangerousRedirectionReason = "unc_path";
      }
      continue;
    }
    if (
      [">", ">|", "&>", ">>", "&>>", ">&"].includes(redirect.op) &&
      (redirect.target.startsWith("~") ||
        shellExpansionIndex(redirect.target) !== -1)
    ) {
      hasDangerousRedirection = true;
      if (
        dangerousRedirectionReason !== "network_device" &&
        dangerousRedirectionReason !== "unc_path"
      ) {
        dangerousRedirectionReason = "shell_expansion";
      }
      denyCheckOutputRedirections.push({
        target: redirect.target,
        operator: redirect.op === ">>" || redirect.op === "&>>" ? ">>" : ">",
      });
      continue;
    }
    switch (redirect.op) {
      case ">": case ">|": case "&>":
        redirections.push({ target: redirect.target, operator: ">" });
        break;
      case ">>": case "&>>":
        redirections.push({ target: redirect.target, operator: ">>" });
        break;
      case ">&":
        if (!/^\d+$/.test(redirect.target)) {
          redirections.push({ target: redirect.target, operator: ">" });
        }
        break;
      default:
        break;
    }
  }
  return {
    redirections,
    hasDangerousRedirection,
    dangerousRedirectionReason,
    denyCheckOutputRedirections,
  };
}

export function analyzeOutputRedirections(command) {
  const fallback = {
    commandWithoutRedirections: command,
    redirections: [],
    hasDangerousRedirection: false,
    dangerousRedirectionReason: undefined,
  };
  if (!command || command.length > MAX_COMMAND_LENGTH) return fallback;
  const root = getParser().parse(command);
  if (!root) return fallback;
  const redirections = [];
  let hasDangerousRedirection = false;
  let dangerousRedirectionReason;
  const visitRedirects = (node) => {
    if (node.type === "file_redirect") {
      let operator = null;
      let target = null;
      let descriptor = false;
      let parts = 0;
      for (const child of node.children) {
        if ([">", "&>", ">|"].includes(child.type)) operator = ">";
        else if ([">>", "&>>", ">>|"].includes(child.type)) operator = ">>";
        else if (child.type === ">&") {
          operator = ">";
          descriptor = true;
        } else if (child.type === "<&") {
          const values = node.children.filter(
            (candidate) => candidate !== child && candidate.type !== "file_descriptor",
          );
          if (
            values.length > 1 ||
            values.some((candidate) => decodeRedirectNode(candidate).startsWith("-"))
          ) {
            hasDangerousRedirection = true;
            if (dangerousRedirectionReason !== "network_device") {
              dangerousRedirectionReason = "shell_expansion";
            }
          }
          return;
        } else if (child.type === ">&-" || child.type === "<&-") {
          if (
            node.children.filter(
              (candidate) => candidate !== child && candidate.type !== "file_descriptor",
            ).length > 0
          ) {
            hasDangerousRedirection = true;
            if (dangerousRedirectionReason !== "network_device") {
              dangerousRedirectionReason = "shell_expansion";
            }
          }
          return;
        } else if (child.type === "<") {
          const values = node.children.filter(
            (candidate) => candidate !== child && candidate.type !== "file_descriptor",
          );
          if (values.length > 1) {
            hasDangerousRedirection = true;
            if (dangerousRedirectionReason !== "network_device") {
              dangerousRedirectionReason = "shell_expansion";
            }
            return;
          }
          const value = values[0];
          if (value && /^\/dev\/(tcp|udp)\//.test(decodeRedirectNode(value))) {
            hasDangerousRedirection = true;
            dangerousRedirectionReason = "network_device";
          }
          return;
        } else if (child.type !== "file_descriptor") {
          target = child;
          parts++;
        }
      }
      if (!operator || !target) return;
      if (parts > 1) {
        hasDangerousRedirection = true;
        if (dangerousRedirectionReason !== "network_device") {
          dangerousRedirectionReason = "shell_expansion";
        }
        return;
      }
      if (descriptor && decodeRedirectNode(target).startsWith("-")) {
        hasDangerousRedirection = true;
        if (dangerousRedirectionReason !== "network_device") {
          dangerousRedirectionReason = "shell_expansion";
        }
        return;
      }
      if (target.type === "number" && target.children.length === 0 && descriptor) {
        return;
      }
      const staticTarget =
        (target.type === "word" && target.children.length === 0) ||
        (target.type === "number" && target.children.length === 0) ||
        target.type === "raw_string" ||
        (target.type === "string" &&
          !target.children.some(
            (child) => child.type !== "string_content" && child.type !== '"',
          ));
      if (!staticTarget) {
        hasDangerousRedirection = true;
        if (dangerousRedirectionReason !== "network_device") {
          dangerousRedirectionReason = "shell_expansion";
        }
        return;
      }
      const text = decodeRedirectNode(target);
      if (/^~|[*?[]/.test(text) || text.startsWith("!") || text.startsWith("=")) {
        hasDangerousRedirection = true;
        if (dangerousRedirectionReason !== "network_device") {
          dangerousRedirectionReason = "shell_expansion";
        }
        return;
      }
      if (descriptor && !/^[A-Za-z0-9./_-]+$/.test(text)) {
        hasDangerousRedirection = true;
        if (dangerousRedirectionReason !== "network_device") {
          dangerousRedirectionReason = "shell_expansion";
        }
        return;
      }
      if (/^\/dev\/(tcp|udp)\//.test(text)) {
        hasDangerousRedirection = true;
        dangerousRedirectionReason = "network_device";
        return;
      }
      redirections.push({ target: text, operator });
      return;
    }
    for (const child of node.children) {
      visitRedirects(child);
    }
  };
  visitRedirects(root);
  const commands = [];
  const visitCommands = (node) => {
    if (node.type === "comment") return;
    if (node.type === "redirected_statement") {
      for (const child of node.children) {
        if (!child.type.endsWith("_redirect")) visitCommands(child);
      }
      return;
    }
    if (SPLIT_CONTAINER_TYPES.has(node.type)) {
      for (const child of node.children) {
        visitCommands(child);
      }
      return;
    }
    commands.push(node.text);
  };
  visitCommands(
    root.type === "ERROR" && root.children[0]?.type === "program"
      ? root.children[0]
      : root,
  );
  return {
    commandWithoutRedirections: commands.length > 0 ? commands.join(" ") : command,
    redirections,
    hasDangerousRedirection,
    dangerousRedirectionReason,
  };
}

export function hasUnsafeEnvironmentAssignment(input, analysis) {
  if (analysis) {
    return analysis.envVars.some(({ name }) => !isSafeEnvironmentVariable(name));
  }
  const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/;
  const complete =
    /^[A-Za-z_][A-Za-z0-9_]*\+?=(?:"[^"$`\\]*"|'[^']*'|[A-Za-z0-9_./:+-]*)[ \t]+/;
  let command = input.command;
  while (true) {
    const match = command.match(assignment);
    if (!match) return false;
    if (!isSafeEnvironmentVariable(match[1])) return true;
    const prefix = command.match(complete);
    if (!prefix) return true;
    command = command.slice(prefix[0].length);
  }
}

export function basenameCommand(command) {
  if (!command) return command;
  const basename = command.replace(/^.*[\\/]/, "");
  return basename === "rm" || basename === "rmdir" ? basename : command;
}

export function classifierPrefixSuggestion(prefix) {
  return suggestion(prefix, true);
}

export async function classifyCommandText(command) {
  if (command === "") {
    return { kind: "simple", commands: [], bareAssignmentNames: [] };
  }
  const root = await parseOrAbort(command, () => undefined);
  return root === null
    ? { kind: "simple", commands: [], bareAssignmentNames: [] }
    : createCommandClassifier(() => false)(command, root);
}

export function pathArgumentsFromCommand(command) {
  const argv = peelCommandPrefixes(commandArgv(command));
  if (argv.length === 0) return [];
  const name = argv[0]?.replace(/[\\'\"]/g, "");
  if (!name || !Object.hasOwn(FILE_EFFECT_KINDS, name)) return [];
  const effect = FILE_EFFECT_KINDS[name];
  if (!(["write", "create"].includes(effect)) || ["rm", "rmdir", "sed"].includes(name)) {
    return [];
  }
  const extract = ownedPathArgumentExtractors[name];
  return extract ? extract(argv.slice(1)) : [];
}

export function createsGitInternalPath(path) {
  let normalized = posixPath.normalize(path.replace(/\/+/g, "/"));
  normalized = normalized
    .replace(/^\.?\//, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ſ/g, "s");
  return GIT_INTERNAL_PATHS.some((pattern) => pattern.test(normalized));
}

export function pathCommands() {
  return OWNED_PATH_COMMANDS;
}

// Decision roots copied from the pinned C13b admission region.
// Free graph values cross only through each root's explicit `ports` object.

export function decorateBashAskDecision(e, t, r, ports) { const { isAutoOrActivePlanMode: Tyt, findSafetyCheckReason: Fy, isClassifierRoutedSafetyCheck: _Tt, splitSubcommands: Ua, matchRules: zw } = ports; if (e.behavior !== "ask" || e.matchedAskRule !== void 0 || !Tyt(r))
    return e; if (Fy(e.decisionReason, _Tt) === void 0)
    return e; let u = new Set([t.command]); for (let d of Ua(t.command)) {
    u.add(d);
} if (e.decisionReason?.type === "subcommandResults")
    for (let d of e.decisionReason.reasons.keys()) {
        u.add(d);
    } for (let d of u) {
    let { matchingAskRules: _ } = zw({ ...t, command: d }, r, "prefix"), C = _[0];
    if (C !== void 0)
        return { ...e, matchedAskRule: C };
} return e; }

export async function checkBashTooComplexRules(e, t, r, ports) {
    const { checkPrefixAndExactRules: J8e, splitSubcommands: Ua, matchRules: zw, bashTool: yi, findDangerousRemovalExpansion: i_e, emitTelemetry: s, dangerousRemovalDecision: Bw, parseAborted: w3, checkNestedDangerousRemoval: Brn, currentWorkingDirectory: ee } = ports;
    let o = J8e(e, t);
    if (o?.behavior === "deny")
        return o;
    for (let _ of Ua(e.command)) {
        let C = zw({ ...e, command: _ }, t, "prefix").matchingDenyRules[0];
        if (C !== void 0)
            return { behavior: "deny", message: `Permission to use ${yi.name} with command ${e.command} has been denied.`, decisionReason: { type: "rule", rule: C } };
    }
    let u = i_e(e.command);
    if (u !== null) {
        s("tengu_bash_dangerous_rm_too_complex", {});
        let { command: _, target: C } = u;
        return Bw(_, `Dangerous ${_} operation detected: '${C}'

This target is a shell variable expansion that points at the filesystem ` + "root (or a top-level directory) when the variable is unset or empty \u2014 " + "e.g. `rm -rf $UNSET/*` becomes `rm -rf /*`. This requires explicit approval and cannot be auto-allowed by permission rules.", `on possibly-empty variable path: ${C}`);
    }
    if (r && r !== w3) {
        let _ = await Brn(r, ee(), t);
        if (_ !== null)
            return s("tengu_bash_dangerous_rm_too_complex", {}), _;
    }
    if (o === null || o.behavior !== "allow")
        return o;
    return (o.decisionReason?.type === "rule" ? o.decisionReason.rule.ruleValue.ruleContent : void 0) === e.command.trim() ? o : null;
}

export function checkBashTooComplexSandbox(e, t, r, ports) { const { sandbox: pt, isSandboxEligible: bv, isSandboxAutoAllowSuspended: Q8e, splitClampCommands: rW, matchRules: zw, bashTool: yi, stripEnvironmentAssignments: Irn, peelCommandPrefixes: Db, isDangerousEnvironmentVariable: XTe, isSandboxExcludedCommand: SQn, sandboxBlockedCommands: R8e, sandboxDynamicCommands: Mrn, arithmeticComparisonOperators: mKe, sandboxUnsupportedCommands: uWt, findActions: o_n, findValueOptionPattern: J_t, findQuotedValuePattern: Q_t, safeSetLongOptions: a_n, safeSetShortOptions: l_n, permissionMessage: ql, sandboxAutoAllowReason: JNe } = ports; if (!pt.isSandboxingEnabled() || !pt.isAutoAllowBashIfSandboxedEnabled() || !bv(e) || Q8e(t))
    return null; if (r === void 0 || r === "PARSE_ABORT" || r === "ERROR")
    return null; if (/(?<!<)<<(?!<)/.test(e.command))
    return null; if (/\$\{[\s|]/.test(e.command.replace(/['"\\]/g, "")))
    return null; if (/\$\{![A-Za-z_0-9]/.test(e.command.replace(/['"\\]/g, "")))
    return null; if (/\/proc\/.*\/environ/.test(e.command.replace(/['"\\]/g, "")))
    return null; let o = rW(e.command); if (o === null || o.length === 0)
    return null; let u; for (let d of o) {
    let { matchingDenyRules: _, matchingAskRules: C } = zw({ ...e, command: d }, t, "prefix");
    if (_[0] !== void 0)
        return { behavior: "deny", message: `Permission to use ${yi.name} with command ${e.command.trim()} has been denied.`, decisionReason: { type: "rule", rule: _[0] } };
    u ??= C[0];
} for (let d of o) {
    let _ = d.trim().split(/\s+/).filter(Boolean), C = Irn(_);
    if (C === null)
        return null;
    if (C.length === 0)
        continue;
    let A = Db(C), x = C.slice(0, C.length - A.length);
    if (x.some((W) => /["'`$\\(){}|;&<>*?[\]]/.test(W)))
        return null;
    if (x.some((W) => { let z = W.match(/^([A-Za-z_]\w*)\+?=/); return z !== null && XTe(z[1]); }))
        return null;
    let M = A.map((W) => W.replace(/['"\\]/g, ""));
    if (M.some((W) => { let z = W.match(/^([A-Za-z_]\w*)\+?=/); return z !== null && XTe(z[1]); }))
        return null;
    let F = A.some((W, z) => { if (z === 0)
        return !1; if (W.includes("$'") && !/^'[^']*\$'$/.test(W) || W.includes('$"') && !/^"[^"]*\$"$/.test(W))
        return !0; let me = M[z]; return me.includes("`") || /\$\((?!\()/.test(me) || /\$[^(\s]/.test(me) && me.includes("-") || /\$\{[^}]*:?[+=]/.test(me) || /\{[^\s]*(,|\.\.)/.test(W) || (me.match(/\{/g) ?? []).length !== (me.match(/\}/g) ?? []).length; }), U = M.some((W, z) => z > 0 && W.includes("$")), B = A[0];
    if (B === void 0 || !/^[A-Za-z0-9._/~+][A-Za-z0-9._/~+-]*$/.test(B) || SQn(B) || R8e.has(B) || R8e.has(B.replace(/^.*[\\/]/, "")) || Mrn.has(B) && (F || M.some((W) => W.includes("[") && /[$`]/.test(W))) || B === "test" && (F || M.some((W) => W === "-t" || mKe.has(W))) || B === "jq" || uWt.has(B) || B === "find" && (F || (() => { for (let W = 1; W < M.length; W++) {
        let z = M[W];
        if (o_n.has(z))
            return !0;
        if (J_t.has(A[W]) || Q_t.test(A[W])) {
            let me = M[W + 1];
            if (me !== void 0 && (!me.includes("$") || /^["'].*["']$/.test(A[W + 1]) && /^\$\{?[A-Za-z_]\w*\}?$/.test(me))) {
                W++;
                continue;
            }
        }
        if (z.includes("$") || /[[\]*?]/.test(z))
            return !0;
    } return !1; })()) || B === "jobs" && (F || U || M.some((W) => /^-[^-]*x/.test(W))) || B === "set" && (F || (() => { for (let W = 1; W < M.length; W++) {
        let z = M[W];
        if (z === "--")
            return !1;
        if (z.includes("$"))
            return !0;
        if (!/^[-+]/.test(z))
            continue;
        for (let me = 1; me < z.length; me++) {
            let fe = z[me];
            if (fe === "o") {
                let pe = me < z.length - 1 ? z.slice(me + 1) : M[W + 1];
                if (pe !== void 0 && pe !== "" && !a_n.has(pe.toLowerCase().replace(/[_-]/g, "")))
                    return !0;
                break;
            }
            if (fe === "A")
                break;
            if (!l_n.has(fe))
                return !0;
        }
    } return !1; })()))
        return null;
} if (u)
    return { behavior: "ask", message: ql(yi.name), decisionReason: { type: "rule", rule: u } }; return { behavior: "allow", updatedInput: e, decisionReason: { type: "other", reason: JNe } }; }

export function checkBashInvalidSemanticsRules(e, t, r, ports) { const { checkPrefixAndExactRules: J8e, matchRules: zw, bashTool: yi } = ports; let o = J8e(e, t); if (o?.behavior === "deny")
    return o; for (let u of r) {
    let d = zw({ ...e, command: u.text }, t, "prefix", { astCommand: u }).matchingDenyRules[0];
    if (d !== void 0)
        return { behavior: "deny", message: `Permission to use ${yi.name} with command ${e.command} has been denied.`, decisionReason: { type: "rule", rule: d } };
} if (o?.behavior === "allow") {
    if ((o.decisionReason?.type === "rule" ? o.decisionReason.rule.ruleValue.ruleContent : void 0) === e.command.trim())
        return o;
} if (o?.behavior === "ask")
    return o; return null; }

export function checkBashSandboxAutoAllow(e, t, r, o, ports) { const { sandbox: pt, isSandboxEligible: bv, isSandboxAutoAllowSuspended: Q8e, checkSandboxRules: Orn, spawnEnvironmentKeys: oW, isSafeEnvironmentVariable: Ww, peelCommandPrefixes: Db, checkDangerousRemoval: dL, currentWorkingDirectory: ee } = ports; if (!pt.isSandboxingEnabled() || !pt.isAutoAllowBashIfSandboxedEnabled() || !bv(e) || Q8e(t))
    return null; let u = Orn(e, t, r); if (u.behavior === "passthrough")
    return null; let d = oW(), _ = o.some((M) => !Ww(M) && (d === null || d.has(M))) || r.some((M) => M.envVars.some((F) => !Ww(F.name)) || M.argv.some((F) => { if (!F.includes("=") || F.startsWith("-"))
    return !1; let U = F.indexOf("="), B = F[U - 1] === "+" ? F.slice(0, U - 1) : F.slice(0, U); return !Ww(B); })), C = r.some((M) => M.redirects.some((F) => /^\/dev\/(tcp|udp)\//.test(F.target))); if (_ || C)
    return null; let A = !1, x = !1; for (let M of r) {
    let [F, ...U] = Db(M.argv), B = F?.replace(/^.*[\\/]/, "");
    if (B === "cd" || B === "pushd" || B === "popd" || B === "chdir") {
        A = !0;
        continue;
    }
    if (B !== "rm" && B !== "rmdir")
        continue;
    if (x = !0, dL(B, U, ee(), t).behavior !== "passthrough")
        return null;
} if (A && x)
    return null; return u; }

export function checkBashExactPermission(e, t, ports) { const { matchRules: zw, bashTool: yi, permissionMessage: ql, permissionSuggestions: w3e } = ports; let r = e.command.trim(), { matchingDenyRules: o, matchingAskRules: u, matchingAllowRules: d } = zw(e, t, "exact"); if (o[0] !== void 0)
    return { behavior: "deny", message: `Permission to use ${yi.name} with command ${r} has been denied.`, decisionReason: { type: "rule", rule: o[0] } }; if (u[0] !== void 0)
    return { behavior: "ask", message: ql(yi.name), decisionReason: { type: "rule", rule: u[0] } }; if (d[0] !== void 0)
    return { behavior: "allow", updatedInput: e, decisionReason: { type: "rule", rule: d[0] } }; let _ = { type: "other", reason: "This command requires approval", bashMissKind: "no-rule-match" }; return { behavior: "passthrough", message: ql(yi.name, _), decisionReason: _, suggestions: w3e(r) }; }

export async function checkBashCdGitSequence(e, t, ports) { const { directoryIdentity: m_e, countMatching: Q, isNormalizedCdCommand: Lb, parseCdTarget: z8e, checkSameDirectoryCd: V8e } = ports; let r = await m_e(t); if (r === null)
    return !1; if (Q(e, (d) => Lb(d.trim())) > 1)
    return !1; let u = !1; for (let d of e) {
    let _ = d.trim();
    if (!Lb(_))
        continue;
    u = !0;
    let C = z8e(_);
    if (C === null)
        return !1;
    if (!await V8e(C, t, r))
        return !1;
} return u; }

export function checkBashPathSafety(e, t, r, o, u, d, ports) { const { analyzeAstRedirections: Fnn, analyzeOutputRedirections: See, expandHomePath: Rm, resolvePath: r8e, isAbsolutePath: uL, resolvePathVariants: ao, matchPathRule: fa, checkSuspiciousPath: oY, checkOutputRedirections: Lnn, checkAstPathCommand: Dnn, splitSubcommands: Ua, checkTextPathCommand: Onn } = ports; if (!d && />>\s*>\s*\(|>\s*>\s*\(|<\s*\(/.test(e.command))
    return { behavior: "ask", message: "Process substitution (>(...) or <(...)) can execute arbitrary commands and requires manual approval", decisionReason: { type: "other", reason: "Process substitution requires manual approval", bashMissKind: "process-substitution" } }; let _ = u ? Fnn(u) : void 0, { redirections: C, hasDangerousRedirection: A, dangerousRedirectionReason: x } = _ ?? See(e.command); if (A) {
    let W;
    if (_ !== void 0) {
        let me = [..._.denyCheckOutputRedirections, ...C];
        for (let fe of me) {
            let pe = [], ge = Rm(fe.target);
            if (ge !== fe.target)
                pe.push({ path: ge, cwdIndependent: !0 });
            if (!fe.target.startsWith("~"))
                pe.push({ path: r8e(t, fe.target), cwdIndependent: uL(fe.target) });
            for (let Ce of pe) {
                let Oe = ao(Ce.path);
                for (let Ee of Oe) {
                    let Pe = fa(Ee, r, "edit", "deny");
                    if (Pe !== null) {
                        if (Ce.cwdIndependent || !o)
                            return { behavior: "deny", message: `Output redirection to '${Ee}' was blocked by a deny rule.`, decisionReason: { type: "rule", rule: Pe } };
                    }
                }
                if (W === void 0 || W.decisionReason?.type === "safetyCheck" && W.decisionReason.classifierApprovable) {
                    let Ee = oY(Ce.path, Oe);
                    if (!Ee.safe && (W === void 0 || !Ee.classifierApprovable))
                        W = { behavior: "ask", message: Ee.message, decisionReason: { type: "safetyCheck", reason: Ee.message, ...r.restricted ? { classifierApprovable: !1, circuitBreaker: "restrictedMode" } : { classifierApprovable: Ee.classifierApprovable, circuitBreaker: Ee.circuitBreaker } } };
                }
            }
        }
    }
    if (W !== void 0)
        return W;
    let z = x === "network_device" ? "Redirect involving /dev/tcp or /dev/udp opens a network connection" : x === "unc_path" ? "Redirect target is a Windows UNC path \u2014 opening it triggers an SMB connection" : "Shell expansion syntax in paths requires manual approval";
    return { behavior: "ask", message: z, decisionReason: { type: "other", reason: z, bashMissKind: x === "network_device" || x === "unc_path" ? "net-redirect" : "shell-expansion" } };
} let M; function F(W) { if (W.behavior === "deny")
    return W; if (W.behavior === "ask") {
    if (W.bashAllowRuleOverridable) {
        M ??= W;
        return;
    }
    return W;
} return; } let U = Lnn(C, t, r, o), B = F(U); if (B)
    return B; if (d)
    for (let W of d) {
        let z = F(Dnn(W, t, r, o));
        if (z)
            return z;
    }
else {
    let W = Ua(e.command);
    for (let z of W) {
        let me = F(Onn(z, t, r, o));
        if (me)
            return me;
    }
} if (M)
    return M; return { behavior: "passthrough", message: "All path commands validated successfully" }; }

export function checkBashDangerousRemoval(e, t, r, o, u, ports) {
    const { pathArgumentExtractors: pL, resolvePathPolicy: Qo, filesystem: le, uniqueValues: te, allowedDirectories: TT, expandHomePath: Rm, isAbsolutePath: uL, resolvePath: r8e, normalizePath: Enn, dangerousRemovalDecision: Bw, pathSeparator: Cnn, hasUnsafeGlobRoot: kze, hasUnknownTrackedValue: Qa, hasBlockedPathShape: Bn, isCriticalPath: pwe, pathContains: nf, countMatching: Q } = ports;
    let d = pL[e], _ = d(t), { resolvedPath: C } = Qo(le(), r), A = C === r ? [r] : [r, C], x = te([...A, ...o ? TT(o) : []].flatMap((M) => { let { resolvedPath: F } = Qo(le(), M); return F === M ? [M] : [M, F]; }));
    for (let M of _) {
        let F = Rm(M), U = uL(F) ? F : r8e(r, F), B = U;
        for (let me = ""; me !== B;) {
            me = B;
            let fe = B.replace(/([\\/]\*+)+[\\/]*$/, "") || "/";
            if (fe !== B)
                B = /[\\/]/.test(fe) ? Enn(fe) : fe;
        }
        let W = B !== U;
        if (u && W && !uL(F) && /[\\/]\*$/.test(U))
            return Bw(e, `Dangerous ${e} operation detected: '${U}'

This command changes directories before the removal, so the relative glob target cannot be statically resolved. This requires explicit approval and cannot be auto-allowed by permission rules.`, `on statically-unresolvable target: ${U}`);
        let z = B;
        if (!uL(F)) {
            let me = /[\\/]$/.test(r) ? r : r + Cnn;
            if (B.startsWith(me))
                z = B.slice(me.length);
            else if (B === r)
                z = "";
        }
        if (W && (kze(F) || Qa(U) || F.startsWith("~") || Bn(F) || !uL(F) && /(^|[\\/])\.\.([\\/]|$)/.test(F) && /[\\/]\*$/.test(U) || e === "rmdir" && /[\\/]\*$/.test(U) && t.some((me) => /^--p/.test(me) || /^-[a-z]*p/.test(me)) || !uL(F) && /\*[\\/]+$/.test(F) && /[\\/]\*$/.test(U)))
            return Bw(e, `Dangerous ${e} operation detected: '${U}'

This command's removal target cannot be statically resolved to a directory. This requires explicit approval and cannot be auto-allowed by permission rules.`, `on statically-unresolvable target: ${U}`);
        if (!W || !/[*?[]/.test(z)) {
            let me = [B];
            if (B !== U) {
                let { resolvedPath: fe } = Qo(le(), B);
                if (fe !== B)
                    me.push(fe);
            }
            for (let fe of me) {
                if (pwe(fe))
                    return Bw(e, `Dangerous ${e} operation detected: '${U}'

This command would remove a critical system directory. This requires explicit approval and cannot be auto-allowed by permission rules.`, `on critical path: ${U}`);
                if ((W ? x : A).some((ge) => nf(ge, fe)))
                    return Bw(e, `Dangerous ${e} operation detected: '${U}'

This command would remove a workspace directory (the working directory, an additional working directory, or one of their parent directories). This requires explicit approval and cannot be auto-allowed by permission rules.`, `on working directory or its ancestor: ${U}`);
            }
        }
        if (W && /[\\/]\*$/.test(U)) {
            let me = Q(U.split(/[\\/]+/), (pe) => pe && pe !== ".") - Q(B.split(/[\\/]+/), (pe) => pe && pe !== "."), fe = Q(z.split(/[\\/]+/), (pe) => /[*?[]/.test(pe));
            if (me + fe > 1)
                return Bw(e, `Dangerous ${e} operation detected: '${U}'

This command's glob pattern traverses directories that cannot be statically enumerated. This requires explicit approval and cannot be auto-allowed by permission rules.`, `on statically-unresolvable target: ${U}`);
        }
    }
    return { behavior: "passthrough", message: `No dangerous removals detected for ${e} command` };
}

export function resolveBashLeadingDirectoryChange(e, t, r, ports) { const { hasUnknownTrackedValue: Qa, isPathLike: K8e, isAbsolutePath: lW, platform: D, isSafeWindowsPath: X8e, checkPathPolicy: Omt, isPathAllowed: Xy } = ports; if (!e)
    return null; if (e.envVars.length > 0 || e.redirects.length > 0)
    return null; if (e.argv.length !== 2 || e.argv[0] !== "cd")
    return null; let o = e.argv[1]; if (Qa(o))
    return null; if (o.startsWith("-"))
    return null; if (!K8e(o))
    return null; if (!lW(o) && o.split(/[\\/]/).includes(".."))
    return null; if (D() === "windows" && !X8e(o, t))
    return null; if (/[*?[\]]/.test(o))
    return null; let { allowed: u, resolvedPath: d } = Omt(o, t, r, "read"); if (!u)
    return null; if (!Xy(d, r, [d]))
    return null; return d; }

export async function checkBashCdGitAstSequence(e, t, r, ports) { const { directoryIdentity: m_e, countMatching: Q, isNormalizedCdCommand: Lb, hasUnknownTrackedValue: Qa, platform: D, parseCdTarget: z8e, checkSameDirectoryCd: V8e } = ports; let o = await m_e(r); if (o === null)
    return !1; if (Q(t, (_) => Lb(_)) > 1)
    return !1; let d = !1; for (let _ = 0; _ < t.length; _++) {
    if (!Lb(t[_]))
        continue;
    d = !0;
    let C = e[_];
    if (!C)
        return !1;
    if (C.envVars.length > 0 || C.redirects.length > 0)
        return !1;
    if (C.argv.length !== 2 || C.argv[0] !== "cd")
        return !1;
    if (Qa(C.argv[1]))
        return !1;
    let A = D() === "windows" ? z8e(t[_]) : C.argv[1];
    if (A === null)
        return !1;
    if (!await V8e(A, r, o))
        return !1;
} return d; }

export function hasUnsafeBashGitStructureFromAnalysis(e, t, ports) { const { readRedirectOperators: orn, hasUnknownTrackedValue: Qa, hasUnsafePath: eQ, peelCommandPrefixes: Db, pathEffectKinds: DP, gitRiskExcludedCommands: f8e, pathArgumentExtractors: pL, hasUnsafeMkdirPath: srn, expandHomePath: Rm, filesystem: le, realpath: ex, resolvePath: u_e, resolveExistingPath: g8e, isPathAncestor: irn, shellExpansionIndex: DU, basename: a8e, hasSymlinkTraversalRisk: mL } = ports; for (let r of e) {
    if (!r)
        continue;
    for (let A of r.redirects) {
        if (orn.has(A.op))
            continue;
        if (Qa(A.target))
            return !0;
        if (eQ(A.target, t))
            return !0;
    }
    let o = Db(r.argv), u = o[0];
    if (u !== void 0 && Qa(u))
        return !0;
    if (!u || !Object.hasOwn(DP, u))
        continue;
    let d = DP[u];
    if (d !== "write" && d !== "create" || f8e.has(u))
        continue;
    let _ = pL[u](o.slice(1)), C = u === "mkdir" && o.slice(1).some((A) => /^-[^-]*p/.test(A) || A.startsWith("--p") && "--parents".startsWith(A));
    for (let A of _) {
        if (Qa(A))
            return !0;
        if (C ? srn(A, t) : eQ(A, t))
            return !0;
    }
    if ((u === "cp" || u === "mv") && _.length >= 1) {
        let A = o.slice(1), x = A.some((U) => { if (/^-[^-]*t/.test(U))
            return !0; let B = U.indexOf("="), W = B >= 0 ? U.slice(0, B) : U; return W.startsWith("--t") && "--target-directory".startsWith(W); }), M = A.some((U) => /^-[^-]*T/.test(U) || U.startsWith("--n") && "--no-target-directory".startsWith(U)), F = !1;
        if (!x && _.length >= 2) {
            let U = _.at(-1), B = [U];
            if (U.startsWith("~")) {
                let W = Rm(U);
                if (W.startsWith("~"))
                    F = !0;
                else
                    B.push(W);
            }
            if (!F) {
                let W = le(), z = (ex(W, t) ?? t).normalize("NFC");
                for (let me of B) {
                    let fe = u_e(t, me), pe = g8e(W, fe).normalize("NFC");
                    if (irn(pe, z)) {
                        F = !0;
                        break;
                    }
                }
            }
        }
        if (x || F) {
            let U = x ? _ : _.slice(0, -1);
            if (M)
                return !0;
            for (let B of U) {
                if (DU(B) !== -1 || Qa(B))
                    return !0;
                let W = a8e(B);
                if (W === "." || W === "..")
                    return !0;
                if (B.startsWith("~")) {
                    let z = Rm(B);
                    if (z.startsWith("~"))
                        return !0;
                    if (mL(a8e(z), t) || mL(W, t))
                        return !0;
                }
                else if (mL(W, t))
                    return !0;
            }
        }
    }
} return !1; }

export function hasUnsafeBashGitStructureFromCommand(e, ports) { const { splitSubcommands: Ua, pathArgumentsFromCommand: rrn, peelCommandPrefixes: Db, commandArgv: ru, createsGitInternalPath: c_e, analyzeOutputRedirections: See } = ports; let t = Ua(e); for (let o of t) {
    let u = o.trim(), d = rrn(u), C = Db(ru(u))[0]?.replace(/[\\'"]/g, ""), A = C === "cp" || C === "mv", x = d.at(-1), M = x !== void 0 && (x === "." || x === "./" || x === "" || /^(?:\.\.\/)*\.\.\/?$/.test(x));
    for (let F of d) {
        if (c_e(F))
            return !0;
        if (A && M && F !== x) {
            let U = F.replace(/\/+$/, "").split("/").pop() ?? "";
            if (c_e(U))
                return !0;
        }
    }
} let { redirections: r } = See(e); for (let { target: o } of r) {
    if (c_e(o))
        return !0;
} return !1; }

export function checkBashDirectCommand(e, t, r, o, u, d, ports) { const { currentWorkingDirectory: ee, checkExactPermission: aQ, matchRules: zw, bashTool: yi, permissionMessage: ql, checkPathSafety: I8, checkSedSafety: H9e, checkModeCommands: T8e, spawnEnvironmentKeys: oW, hasUnsafeEnvironmentAssignment: vrn, isSafeEnvironmentVariable: Ww, readOnlyAllowReason: yTt, permissionSuggestions: w3e } = ports; if (u === undefined) u = ee(); if (d === undefined) d = []; let _ = e.command.trim(), C = aQ(e, t); if (C.behavior === "deny" || C.behavior === "ask")
    return C; let { matchingDenyRules: A, matchingAskRules: x, matchingAllowRules: M } = zw(e, t, "prefix", { skipCompoundCheck: o !== void 0, astCommand: o }); if (A[0] !== void 0)
    return { behavior: "deny", message: `Permission to use ${yi.name} with command ${_} has been denied.`, decisionReason: { type: "rule", rule: A[0] } }; if (x[0] !== void 0)
    return { behavior: "ask", message: ql(yi.name), decisionReason: { type: "rule", rule: x[0] } }; let F = I8(e, u, t, r, o?.redirects, o ? [o] : void 0); if (F.behavior === "deny" || F.behavior === "ask" && !F.bashAllowRuleOverridable)
    return F; if (C.behavior === "allow")
    return C; if (M[0] !== void 0)
    return { behavior: "allow", updatedInput: e, decisionReason: { type: "rule", rule: M[0] } }; if (F.behavior === "ask")
    return F; let U = H9e(e, t); if (U.behavior !== "passthrough")
    return U; let B = T8e(e, t); if (B.behavior !== "passthrough")
    return B; let W = oW(); if (yi.isReadOnly(e) && !vrn(e, o) && !d.some((me) => !Ww(me) && (W === null || W.has(me))))
    return { behavior: "allow", updatedInput: e, decisionReason: { type: "other", reason: yTt } }; let z = { type: "other", reason: "This command requires approval", bashMissKind: "no-rule-match" }; return { behavior: "passthrough", message: ql(yi.name, z), decisionReason: z, suggestions: w3e(_) }; }

export async function checkBashSubcommandPermission(e, t, r, o, u, d, _ = [], ports) { const { checkExactPermission: aQ, checkDirectCommand: j8e, classifierPrefixSuggestion: wrn, permissionSuggestions: w3e } = ports; let C = aQ(e, t); if (C.behavior === "deny" || C.behavior === "ask")
    return C; let A = j8e(e, t, o, u, d, _); if (A.behavior === "deny" || A.behavior === "ask")
    return A; if (A.behavior === "allow")
    return A; let x = r?.commandPrefix ? wrn(r.commandPrefix) : w3e(e.command); return { ...A, suggestions: x }; }

export function checkBashPrefixAndExactRules(e, t, ports) { const { matchRules: zw, bashTool: yi, checkExactPermission: aQ, permissionMessage: ql } = ports; let { matchingDenyRules: r, matchingAskRules: o } = zw(e, t, "prefix"); if (r[0] !== void 0)
    return { behavior: "deny", message: `Permission to use ${yi.name} with command ${e.command} has been denied.`, decisionReason: { type: "rule", rule: r[0] } }; let u = aQ(e, t); if (u.behavior === "deny")
    return u; if (o[0] !== void 0)
    return { behavior: "ask", message: ql(yi.name), decisionReason: { type: "rule", rule: o[0] } }; if (u.behavior !== "passthrough")
    return u; return null; }

export async function checkNestedDangerousRemoval(e, t, r, ports) {
    const { dangerousRemovalDecision: Bw, hasNormalizedCdCommand: fL, splitSubcommands: Ua, findDangerousRemovalExpansion: i_e, classifyCommandText: dde, peelCommandPrefixes: Db, basenameCommand: x8, checkDangerousRemoval: dL } = ports;
    let o = [], u = (_) => { let C = _.text, A = (_.type === "expansion" || _.type === "ERROR") && /^\$\{[ \t\n|]/.test(C); if (_.type === "command_substitution" || _.type === "process_substitution" || A) {
        let M = C.startsWith("$(") || C.startsWith("<(") || C.startsWith(">(") || C.startsWith("${") ? 2 : C.startsWith("`") ? 1 : 0, F = C.endsWith(")") || C.endsWith("`") || C.endsWith("}") ? C.length - 1 : C.length, U = C.slice(M, F).trim();
        if (A)
            U = U.replace(/^\|/, "").replace(/;$/, "").trim();
        o.push(U);
    } for (let x of _.children) {
        if (x)
            u(x);
    } };
    if (u(e), o.length > 64) {
        if (/\brm(?:dir)?\b/.test(e.text))
            return Bw("rm", `This command contains ${o.length} command substitutions \u2014 too many to analyze for catastrophic removals. This requires explicit approval.`, `\u2014 too many command substitutions to analyze (${o.length})`);
        return null;
    }
    let d = fL(e.text) || o.some((_) => fL(_));
    for (let _ of [e.text, ...o]) {
        let C;
        try {
            C = Ua(_);
        }
        catch {
            C = [_];
        }
        for (let A of C) {
            let x = A.trim();
            if (x.startsWith("{") && /;?\s*\}$/.test(x) || x.startsWith("(") && x.endsWith(")"))
                x = x.slice(1).replace(/;?\s*[)}]$/, "").trim();
            let M = i_e(x);
            if (M !== null)
                return Bw(M.command, `Dangerous ${M.command} operation detected inside command substitution: '${M.target}'

This target is a shell variable expansion that points at the filesystem root (or a top-level directory) when the variable is unset or empty. This requires explicit approval and cannot be auto-allowed by permission rules.`, `on possibly-empty variable path inside command substitution: ${M.target}`);
            let F = x.replace(/`[^`]*`/g, "__CMDSUB__");
            for (let W = "", z = 0; W !== F && z < 16; z++) {
                W = F, F = F.replace(/\$\([^()]*\)/g, "__CMDSUB__");
            }
            let U = F !== x, B = await dde(F);
            if (B.kind === "simple")
                for (let W of B.commands) {
                    let z = Db(W.argv), me = x8(z[0]);
                    if (me !== "rm" && me !== "rmdir")
                        continue;
                    let fe = z.slice(1), pe = dL(me, fe, t, r, d);
                    if (pe.behavior === "ask")
                        return pe;
                    if (U && fe.some((ge) => /.__CMDSUB__\/?\*?$/.test(ge))) {
                        let ge = fe.map((Oe) => Oe.replace(/(.)__CMDSUB__\/?\*?$/, "$1")), Ce = dL(me, ge, t, r, d);
                        if (Ce.behavior === "ask")
                            return Ce;
                    }
                }
        }
    }
    return null;
}

export function checkSandboxRules(e, t, r, ports) { const { matchRules: zw, bashTool: yi, permissionMessage: ql, sandboxAutoAllowReason: JNe } = ports; let o = e.command.trim(), { matchingDenyRules: u, matchingAskRules: d } = zw(e, t, "prefix", { astCommand: r.length === 1 ? r[0] : void 0 }); if (u[0] !== void 0)
    return { behavior: "deny", message: `Permission to use ${yi.name} with command ${o} has been denied.`, decisionReason: { type: "rule", rule: u[0] } }; if (r.length > 1) {
    let _;
    for (let C of r) {
        let A = zw({ command: C.text }, t, "prefix", { astCommand: C });
        if (A.matchingDenyRules[0] !== void 0)
            return { behavior: "deny", message: `Permission to use ${yi.name} with command ${o} has been denied.`, decisionReason: { type: "rule", rule: A.matchingDenyRules[0] } };
        _ ??= A.matchingAskRules[0];
    }
    if (_)
        return { behavior: "ask", message: ql(yi.name), decisionReason: { type: "rule", rule: _ } };
} if (d[0] !== void 0)
    return { behavior: "ask", message: ql(yi.name), decisionReason: { type: "rule", rule: d[0] } }; return { behavior: "allow", updatedInput: e, decisionReason: { type: "other", reason: JNe } }; }

export function parseCdTarget(e, ports) { const { platform: D } = ports; let t = e.trim(); if (!t.startsWith("cd "))
    return null; let r = t.slice(3).trim(); if (r.length === 0)
    return null; let o = r[0]; if (o === '"' || o === "'") {
    if (r.length < 2 || r.at(-1) !== o)
        return null;
    let u = r.slice(1, -1);
    if (u.includes(o))
        return null;
    if (o === '"' && u.includes("\\") && D() !== "windows")
        return null;
    if (/[\x00-\x1f\x7f]/.test(u))
        return null;
    return u;
} if (/\s/.test(r))
    return null; if (/['"]/.test(r))
    return null; if (r.includes("\\"))
    return null; if (/[<>|&;(){}]/.test(r))
    return null; return r; }

export async function checkSameDirectoryCd(e, t, r, ports) { const { isPathLike: K8e, platform: D, isUncPath: S_, isSafeWindowsPath: X8e, isAbsolutePath: lW, resolvePath: F8e, directoryIdentity: m_e } = ports; if (e.startsWith("-"))
    return !1; if (!K8e(e))
    return !1; if (e.includes("$") || e.includes("`") || /[*?[]/.test(e) || D() !== "windows" && e.includes("\\") || D() === "windows" && e.includes("%"))
    return !1; if (S_(e) || D() === "windows" && /^[\\/]{2}/.test(e))
    return !1; if (D() === "windows" && !X8e(e, t))
    return !1; {
    let d = lW(e), _ = !1;
    for (let C of e.split(/[\\/]/)) {
        if (C === "" || C === ".")
            continue;
        if (C === "..") {
            if (!d || _)
                return !1;
            continue;
        }
        _ = !0;
    }
} let o = lW(e) ? e : F8e(t, e), u = await m_e(o); if (u === null)
    return !1; return u === r; }

export function checkOutputRedirections(e, t, r, o, ports) { const { checkPathPolicy: Omt, allowedDirectories: TT, formatAllowedDirectories: Rpn, dirname: qN } = ports; if (o && e.some((u) => u.target !== "/dev/null"))
    return { behavior: "ask", message: "Commands that change directories and write via output redirection require explicit approval to ensure paths are evaluated correctly. For security, Claude Code cannot automatically determine the final working directory when 'cd' is used in compound commands.", decisionReason: { type: "other", reason: "Compound command contains cd with output redirection - manual approval required to prevent path resolution bypass", bashMissKind: "cd-compound-redirect" } }; for (let { target: u } of e) {
    if (u === "/dev/null")
        continue;
    let { allowed: d, resolvedPath: _, decisionReason: C } = Omt(u, t, r, "create");
    if (!d) {
        let A = Array.from(TT(r)), x = Rpn(A), M = C?.type === "other" || C?.type === "safetyCheck" ? C.reason : C?.type === "rule" ? `Output redirection to '${_}' was blocked by a deny rule.` : `Output redirection to '${_}' was blocked. For security, Claude Code may only write to files in the allowed working directories for this session: ${x}.`;
        if (C?.type === "rule")
            return { behavior: "deny", message: M, decisionReason: C };
        return { behavior: "ask", message: M, blockedPath: _, decisionReason: C, suggestions: [{ type: "addDirectories", directories: [qN(_)], destination: "session" }] };
    }
} return { behavior: "passthrough", message: "No unsafe redirections found" }; }

export function checkAstPathCommand(e, t, r, o, ports) { const { peelCommandPrefixes: Db, basenameCommand: x8, pathCommands: s8e, isSedReadOnly: cL, normalizeCommandPrefix: Ah, createPathCommandChecker: i8e } = ports; let u = Db(e.argv); if (u.length === 0)
    return { behavior: "passthrough", message: "Empty command - no paths to validate" }; let [d, ..._] = u, C = x8(d); if (!C || !s8e.includes(C))
    return { behavior: "passthrough", message: `Command '${C}' is not a path-restricted command` }; let A = C === "sed" && cL(Ah(e.text)) ? "read" : void 0; return i8e(C, A)(_, t, r, o); }

export function checkTextPathCommand(e, t, r, o, ports) { const { normalizeCommandPrefix: Ah, commandArgv: Inn, basenameCommand: x8, pathCommands: s8e, isSedReadOnly: cL, createPathCommandChecker: i8e } = ports; let u = Ah(e), d = Inn(u); if (d.length === 0)
    return { behavior: "passthrough", message: "Empty command - no paths to validate" }; let [_, ...C] = d, A = x8(_); if (!A || !s8e.includes(A))
    return { behavior: "passthrough", message: `Command '${A}' is not a path-restricted command` }; let x = A === "sed" && cL(u) ? "read" : void 0; return i8e(A, x)(C, t, r, o); }

export function createPathCommandChecker(e, t, ports) { const { checkPathCommand: Mnn, checkDangerousRemoval: dL, pathEffectKinds: DP, dirname: qN, directoryRuleSuggestion: YTe } = ports; return (r, o, u, d) => { let _ = Mnn(e, r, o, u, d, t); if (_.behavior === "deny")
    return _; if (e === "rm" || e === "rmdir") {
    let C = dL(e, r, o, u, d);
    if (C.behavior !== "passthrough")
        return C;
} if (_.behavior === "passthrough")
    return _; if (_.behavior === "ask") {
    let C = t ?? DP[e], A = [];
    if (_.blockedPath)
        if (C === "read") {
            let M = qN(_.blockedPath), F = YTe(M, "session");
            if (F)
                A.push(F);
        }
        else
            A.push({ type: "addDirectories", directories: [qN(_.blockedPath)], destination: "session" });
    let x = u.mode === "plan" && (u.prePlanMode === "auto" || u.prePlanMode === "bypassPermissions" || u.prePlanMode === "acceptEdits" || u.prePlanMode === "dontAsk");
    if ((C === "write" || C === "create") && (u.mode === "default" || u.mode === "plan") && !x)
        A.push({ type: "setMode", mode: "acceptEdits", destination: "session" });
    _.suggestions = A;
} return _; }; }

export function checkPathCommand(e, t, r, o, u, d, ports) { const { pathArgumentExtractors: pL, pathEffectKinds: DP, hasUnknownTrackedValue: Qa, pathFlagValidators: xnn, checkPathPolicy: Omt, allowedDirectories: TT, formatAllowedDirectories: Rpn, pathEffectDescriptions: Pnn } = ports; let _ = pL[e], C = _(t), A = d ?? DP[e]; if (A !== "read" && C.some((F) => Qa(F)))
    return { behavior: "ask", message: `${e} target contains command-substitution or untracked-variable output \u2014 the path is runtime-determined and cannot be validated`, decisionReason: { type: "other", reason: `${e} path argument is runtime-determined`, bashMissKind: "shell-expansion" } }; let x = xnn[e]; if (x && !x(t)) {
    if (e === "cd")
        return { behavior: "ask", message: `cd with two or more directory arguments requires manual approval. zsh's "cd OLD NEW" form substitutes OLD\u2192NEW in $PWD, producing a target path that cannot be statically validated.`, decisionReason: { type: "other", reason: "cd with two or more directory arguments", bashMissKind: "cd-multi-positional" } };
    return { behavior: "ask", message: `${e} with flags requires manual approval to ensure path safety. For security, Claude Code cannot automatically validate ${e} commands that use flags, as some flags like --target-directory=PATH can bypass path validation.`, decisionReason: { type: "other", reason: `${e} command with flags requires manual approval`, bashMissKind: "flag-validation" } };
} if (u && A !== "read")
    return { behavior: "ask", message: "Commands that change directories and perform write operations require explicit approval to ensure paths are evaluated correctly. For security, Claude Code cannot automatically determine the final working directory when 'cd' is used in compound commands.", decisionReason: { type: "other", reason: "Compound command contains cd with write operation - manual approval required to prevent path resolution bypass", bashMissKind: "cd-compound-write" } }; let M; for (let F of C) {
    let { allowed: U, resolvedPath: B, decisionReason: W, isInWorkingDir: z } = Omt(F, r, o, A);
    if (!U) {
        let me = Array.from(TT(o)), fe = Rpn(me), pe = W?.type === "other" || W?.type === "safetyCheck" ? W.reason : `${e} in '${B}' was blocked. For security, Claude Code may only ${Pnn[e]} the allowed working directories for this session: ${fe}.`;
        if (W?.type === "rule")
            return { behavior: "deny", message: pe, decisionReason: W };
        let ge = z === !0 && W === void 0, Ce = { behavior: "ask", message: pe, blockedPath: B, decisionReason: W, bashAllowRuleOverridable: ge };
        if (ge) {
            M ??= Ce;
            continue;
        }
        return Ce;
    }
} if (M)
    return M; return { behavior: "passthrough", message: `Path validation passed for ${e} command` }; }


function exactRuleDecision(input, permissionContext, runtime) {
  return (runtime.decisions ?? runtime.effects).checkExactPermission(input, permissionContext);
}

function isNormalizedGitCommand(command) {
  if (command.startsWith("git ") || command === "git") return true;
  const argv = commandArgv(normalizeCommandPrefix(command));
  if (argv[0] === "git") return true;
  return argv[0] === "xargs" && argv.includes("git");
}

export function isNormalizedCdCommand(command) {
  const name = commandArgv(normalizeCommandPrefix(command))[0];
  return ["cd", "pushd", "popd", "chdir"].includes(name);
}

export function hasNormalizedCdCommand(command) {
  return splitSubcommands(command).some((part) =>
    isNormalizedCdCommand(part.trim()),
  );
}

function isSafeCdSequence(command) {
  return (
    !command.includes("||") &&
    !command.includes(";") &&
    !command.includes("\n") &&
    !command.replaceAll("&&", "").includes("&")
  );
}

function normalizeWindowsPath(path) {
  if (path.startsWith("\\")) return path.replaceAll("\\", "/");
  const drive = path.match(/^([A-Za-z]):[/\\]/);
  if (drive) {
    return `/${drive[1].toLowerCase()}${path.slice(2).replaceAll("\\", "/")}`;
  }
  return path.replaceAll("\\", "/");
}

export function countMatching(values, predicate) {
  let count = 0;
  for (const value of values) {
    count += +!!predicate(value);
  }
  return count;
}

export function uniqueValues(values) {
  return [...new Set(values)];
}

function caseFoldPath(path) {
  return path.toLowerCase().replaceAll("ı", "i").replaceAll("ſ", "s");
}

function normalizePolicyPath(value, platform = hostPlatformName()) {
  if (typeof value !== "string") {
    throw new TypeError(`Path must be a string, received ${typeof value}`);
  }
  if (value.includes("\0")) throw new Error("Path contains null bytes");
  const trimmed = value.trim();
  let path = trimmed;
  if (trimmed === "") path = process.cwd();
  else if (trimmed === "~") path = homedir();
  else if (trimmed.startsWith("~/")) path = nodePath.join(homedir(), trimmed.slice(2));
  else if (platform === "windows" && /^\/[a-z]\//i.test(trimmed)) {
    path = trimmed.replace(/^\/([a-z])\//i, (_match, drive) => `${drive.toUpperCase()}:\\`);
  }
  const normalized = nodePath.isAbsolute(path)
    ? nodePath.normalize(path)
    : nodePath.resolve(process.cwd(), path);
  return normalized.normalize("NFC");
}

function hasParentTraversal(path) {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path);
}

/** Pinned nf, with node:path/homedir as direct external dependencies. */
export function pathContains(
  candidate,
  boundary,
  { caseFold, skipPrivateAlias = false, uncShapeParity = false } = {
    caseFold: true,
  },
) {
  const normalizedCandidate = normalizePolicyPath(candidate);
  const normalizedBoundary = normalizePolicyPath(boundary);
  if (
    uncShapeParity &&
    (hasBlockedPathShape(normalizedCandidate) !==
      hasBlockedPathShape(normalizedBoundary) ||
      hasBlockedPathShape(candidate) !== hasBlockedPathShape(boundary))
  ) {
    return false;
  }
  const privateVar = caseFold ? /^\/private\/var\//i : /^\/private\/var\//;
  const privateTmp = caseFold
    ? /^\/private\/tmp(\/|$)/i
    : /^\/private\/tmp(\/|$)/;
  const alias = (path) =>
    skipPrivateAlias
      ? path
      : path.replace(privateVar, "/var/").replace(privateTmp, "/tmp$1");
  const inner = alias(normalizedCandidate);
  const outer = alias(normalizedBoundary);
  const relative = nodePath.relative(
    caseFold ? caseFoldPath(outer) : outer,
    caseFold ? caseFoldPath(inner) : inner,
  );
  if (relative === "") return true;
  if (hasParentTraversal(relative)) return false;
  return !nodePath.isAbsolute(relative);
}

/** Pinned kze: a glob root becomes unsafe after a concrete path segment. */
export function hasUnsafeGlobRoot(path, platform = hostPlatformName()) {
  const parts = path.split(platform === "windows" ? /[\\/]/ : "/");
  let sawConcrete = false;
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (sawConcrete) return true;
    } else {
      sawConcrete = true;
    }
  }
  return false;
}

const canonicalHomeDirectoryByHome = new Map();

function canonicalHomeDirectory(homeDirectory) {
  const cached = canonicalHomeDirectoryByHome.get(homeDirectory);
  if (cached !== undefined) return cached;
  let canonical;
  try {
    canonical = realpathSync(homeDirectory)
      .replace(/[\\/]+/g, "/")
      .replace(/\/$/, "");
  } catch {
    canonical = homeDirectory.replace(/[\\/]+/g, "/").replace(/\/$/, "");
  }
  canonicalHomeDirectoryByHome.set(homeDirectory, canonical);
  return canonical;
}

/** Pinned pwe over direct host/platform/filesystem dependencies. */
export function isCriticalPath(path, options = {}) {
  const slashed = path.replace(/[\\/]+/g, "/");
  if (slashed === "*" || slashed.endsWith("/*")) return true;
  const platform = options.platform ?? hostPlatformName();
  const alias = (value) =>
    platform === "macos"
      ? value.replace(/^\/private\/(etc|var|tmp|home)(\/|$)/i, "/$1$2")
      : value;
  const aliased = alias(slashed);
  const normalized = aliased === "/" ? aliased : aliased.replace(/\/$/, "");
  if (normalized === "/") return true;
  if (/^[A-Za-z]:\/?$/.test(normalized)) return true;
  const homeDirectory = options.homeDirectory ?? homedir();
  const home = alias(homeDirectory.replace(/[\\/]+/g, "/")).replace(/\/$/, "");
  if (caseFoldPath(normalized) === caseFoldPath(home)) return true;
  const canonical =
    options.canonicalHomeDirectory ?? canonicalHomeDirectory(homeDirectory);
  if (canonical !== home && caseFoldPath(normalized) === caseFoldPath(canonical)) {
    return true;
  }
  if (pathDirname(normalized) === "/") return true;
  if (/^[A-Za-z]:\/[^/]+$/.test(normalized)) return true;
  return false;
}

/** Pinned Rpn: bounded rendering of allowed directories. */
export function formatAllowedDirectories(directories) {
  const limit = 5;
  if (directories.length <= limit) {
    return directories.map((directory) => `'${directory}'`).join(", ");
  }
  return `${directories
    .slice(0, limit)
    .map((directory) => `'${directory}'`)
    .join(", ")}, and ${directories.length - limit} more`;
}

function escapeRulePattern(value, { escapeGlobs = false } = {}) {
  let escaped = value
    .replaceAll("\\", "\\\\")
    .replace(/[[\]()|+^$]/g, (character) => `\\${character}`);
  if (escapeGlobs) escaped = escaped.replaceAll("*", "\\*");
  if (escaped.startsWith("!") || escaped.startsWith("#")) {
    escaped = `\\${escaped}`;
  }
  return escaped.replace(/\s+$/, (spaces) =>
    Array.from(spaces, (space) => `\\${space}`).join(""),
  );
}

/** Pinned YTe: one allow-rule suggestion rooted at a directory. */
export function directoryRuleSuggestion(
  directory,
  destination = "session",
  platform = hostPlatformName(),
) {
  const normalized =
    platform === "windows" ? normalizeWindowsPath(directory) : directory;
  if (normalized === "/") return undefined;
  const escaped = escapeRulePattern(normalized, { escapeGlobs: true });
  const ruleContent = nodePath.isAbsolute(normalized)
    ? `/${escaped}/**`
    : escaped.startsWith("\\")
      ? `./${escaped}/**`
      : `${escaped}/**`;
  return {
    type: "addRules",
    rules: [{ toolName: READ_TOOL_NAME, ruleContent }],
    behavior: "allow",
    destination,
  };
}

function checkPathSafety(
  input,
  cwd,
  permissionContext,
  hasCd,
  redirects,
  commandAnalyses,
  runtime,
) {
  return (runtime.decisions ?? runtime.effects).checkPathSafety(
    input,
    cwd,
    permissionContext,
    hasCd,
    redirects,
    commandAnalyses,
  );
}

function sandboxAutoAllow(
  input,
  permissionContext,
  commandAnalyses,
  bareAssignmentNames,
  runtime,
) {
  return (runtime.decisions ?? runtime.effects).checkSandboxAutoAllow(
    input,
    permissionContext,
    commandAnalyses,
    bareAssignmentNames,
  );
}

const CLASSIFIER_NODE_TYPES = [
  "command_substitution",
  "process_substitution",
  "expansion",
  "simple_expansion",
  "brace_expression",
  "subshell",
  "compound_statement",
  "for_statement",
  "while_statement",
  "until_statement",
  "if_statement",
  "case_statement",
  "function_definition",
  "test_command",
  "ansi_c_string",
  "translated_string",
  "herestring_redirect",
  "heredoc_redirect",
];

function classifierNodeTypeId(nodeType) {
  if (!nodeType) return -2;
  if (nodeType === "ERROR") return -1;
  const index = CLASSIFIER_NODE_TYPES.indexOf(nodeType);
  return index >= 0 ? index + 1 : 0;
}

function sandboxTooComplexDecision(
  input,
  permissionContext,
  nodeType,
  runtime,
) {
  return (runtime.decisions ?? runtime.effects).checkTooComplexSandbox(
    input,
    permissionContext,
    nodeType,
  );
}

const DIFFERENTIAL_CONTROL = /[\x00-\x08\x0B-\x1F\x7F]/;
const DIFFERENTIAL_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const DIFFERENTIAL_ESCAPED_WHITESPACE =
  /\\[ \t]|(?:^|[^ \t\\])(?:\\\\)*\\\n|[ \t](?:\\\\)+\\\n/;
const DIFFERENTIAL_DYNAMIC_DIRECTORY = /~\[/;
const DIFFERENTIAL_EQUALS_COMMAND = /(?:^|[\s;&|])=[a-zA-Z_]/;
const DIFFERENTIAL_PROCESS_REDIRECT = /<\d*-\d*>/;
const REDIRECT_DYNAMIC_NODES = new Set([
  "command_substitution",
  "process_substitution",
  "expansion",
  "simple_expansion",
  "arithmetic_expansion",
]);
const REDIRECT_QUOTED_DYNAMIC_NODES = new Set([
  "ansi_c_string",
  "translated_string",
]);
const REDIRECT_STATIC_NODE_TYPES = new Set([
  "word",
  "string",
  "raw_string",
  "number",
]);
const REDIRECT_SYNTAX_NODE_TYPES = new Set([
  "<",
  ">",
  ">>",
  "<<",
  "<<-",
  "<<<",
  "<&",
  ">&",
  "&>",
  "&>>",
  ">|",
  ">&-",
  "<&-",
  "file_descriptor",
  "heredoc_start",
  "heredoc_body",
  "heredoc_content",
  "heredoc_end",
]);
const UNESCAPED_OPERATOR = /(?:^|[^\\])(?:\\\\)*[;|&<>]/;
const UNESCAPED_DOLLAR = /(?:^|[^\\])(?:\\\\)*\$/;
const UNESCAPED_DYNAMIC_TEXT = /(?:^|[^\\])(?:\\\\)*[`$]/;
const UNESCAPED_QUOTE = /(?:^|[^\\])(?:\\\\)*['"]/;

function hasDifferentialTokens(command) {
  return (
    DIFFERENTIAL_CONTROL.test(command) ||
    DIFFERENTIAL_SURROGATE.test(command) ||
    DIFFERENTIAL_ESCAPED_WHITESPACE.test(command) ||
    DIFFERENTIAL_DYNAMIC_DIRECTORY.test(command) ||
    DIFFERENTIAL_EQUALS_COMMAND.test(command) ||
    DIFFERENTIAL_PROCESS_REDIRECT.test(command)
  );
}

function hasParseError(node) {
  if (node.type === "ERROR") return true;
  return node.children.some((child) => hasParseError(child));
}

function stripLeadingRedirectToken(command) {
  let index = 0;
  while (index < command.length) {
    const character = command[index];
    if (character === " " || character === "\t") break;
    if (character === "\\" && index + 1 < command.length) {
      index += 2;
      continue;
    }
    if (character === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) return null;
      index = end + 1;
      continue;
    }
    if (character === '"') {
      index++;
      while (true) {
        if (index >= command.length) return null;
        if (command[index] === "\\" && index + 1 < command.length) {
          index += 2;
          continue;
        }
        if (command[index] === '"') break;
        index++;
      }
      index++;
      continue;
    }
    index++;
  }
  return index;
}

function stripLeadingRedirections(command) {
  let remaining = command;
  while (true) {
    if (remaining.startsWith("<<<") && remaining[3] !== "<" && remaining[3] !== "(") {
      const afterOperator = remaining.slice(3);
      const operand = /^[ \t]/.test(afterOperator)
        ? afterOperator.trimStart()
        : afterOperator;
      if (!operand) return remaining;
      const length = stripLeadingRedirectToken(operand);
      if (length === null) return remaining;
      remaining = operand.slice(length).trimStart();
      continue;
    }
    const operator = /^(?:\d*|&)(?:>>(?!\()|>\|(?!\()|>&(?!\()|<&(?!\()|<>(?!\()|>(?![>|&(])|<(?![<>&(]))/.exec(
      remaining,
    );
    if (!operator) return remaining;
    const afterOperator = remaining.slice(operator[0].length);
    const operand = /^[ \t]/.test(afterOperator)
      ? afterOperator.trimStart()
      : afterOperator;
    if (!operand) return remaining;
    const length = stripLeadingRedirectToken(operand);
    if (length === null) return remaining;
    remaining = operand.slice(length).trimStart();
  }
}

function normalizeSedStart(command) {
  let normalized = command.trim();
  while (true) {
    const stripped = stripLeadingRedirections(
      normalizeCommandPrefix(normalized),
    );
    if (stripped === normalized) return normalized;
    normalized = stripped;
  }
}

function sedCommandText(command) {
  const fallback = () => {
    const normalized = normalizeSedStart(command);
    return normalized.split(/\s+/)[0] === "sed" ? normalized : null;
  };
  if (command.length > MAX_COMMAND_LENGTH || hasDifferentialTokens(command)) {
    return fallback();
  }
  const root = getParser().parse(command);
  if (!root || hasParseError(root)) return fallback();
  const children = root.children.filter((child) => child.type !== "comment");
  if (
    children.length !== 1 ||
    (children[0].type !== "command" &&
      !(
        children[0].type === "redirected_statement" &&
        children[0].children.some((child) => child.type === "command")
      ))
  ) {
    return fallback();
  }
  const commandNode = findCommandNode(root, null);
  if (!commandNode) return null;
  const nameNode = commandNode.children.find(
    (child) => child.type === "command_name",
  );
  if (!nameNode) return null;
  const suffix = Buffer.from(command, "utf8")
    .subarray(nameNode.startIndex)
    .toString("utf8");
  const normalized = normalizeSedStart(suffix);
  return normalized.split(/\s+/)[0] === "sed" ? normalized : null;
}

function isSedCommand(command) {
  return sedCommandText(command) !== null;
}

function containsRedirectDynamicNode(node) {
  if (REDIRECT_DYNAMIC_NODES.has(node.type)) return true;
  return node.children.some((child) => containsRedirectDynamicNode(child));
}

function containsRedirectQuotedDynamicNode(node) {
  if (REDIRECT_QUOTED_DYNAMIC_NODES.has(node.type)) return true;
  return node.children.some((child) =>
    containsRedirectQuotedDynamicNode(child),
  );
}

function redirectStructureUnsafe(node) {
  if (node.type.endsWith("_redirect")) {
    const operands = node.children.filter(
      (child) => !REDIRECT_SYNTAX_NODE_TYPES.has(child.type),
    );
    const closesDescriptor = node.children.some(
      (child) => child.type === ">&-" || child.type === "<&-",
    );
    const negativeDescriptor =
      !closesDescriptor &&
      node.children.some(
        (child) => child.type === ">&" || child.type === "<&",
      ) &&
      operands.some((child) => child.text.startsWith("-"));
    const expected =
      node.type === "heredoc_redirect" || closesDescriptor || negativeDescriptor
        ? 0
        : 1;
    if (operands.length > expected) return true;
  }
  return node.children.some((child) => redirectStructureUnsafe(child));
}

function heredocStructureUnsafe(node) {
  if (node.type === "heredoc_redirect") {
    const start = node.children.find(
      (child) => child.type === "heredoc_start",
    )?.text ?? "";
    if (
      !(
        start.length >= 2 &&
        ((start.startsWith("'") && start.endsWith("'")) ||
          (start.startsWith('"') && start.endsWith('"')))
      ) ||
      start.includes("\\")
    ) {
      return true;
    }
  }
  return node.children.some((child) => heredocStructureUnsafe(child));
}

function staticRedirectPart(node, rejectQuotes = false) {
  if (node.type === "concatenation") {
    return node.children.every((child) =>
      staticRedirectPart(child, rejectQuotes),
    );
  }
  if (node.type === "word") {
    if (UNESCAPED_DYNAMIC_TEXT.test(node.text)) return false;
    if (UNESCAPED_OPERATOR.test(node.text) || UNESCAPED_DOLLAR.test(node.text)) {
      return false;
    }
    if (rejectQuotes && UNESCAPED_QUOTE.test(node.text)) return false;
    return true;
  }
  if (node.type === "string" || node.type === "raw_string") {
    const quote = node.type === "raw_string" ? "'" : '"';
    return (
      node.text.length >= 2 &&
      node.text.startsWith(quote) &&
      node.text.endsWith(quote)
    );
  }
  return REDIRECT_STATIC_NODE_TYPES.has(node.type);
}

function redirectTextHasExpansion(text) {
  let quote = null;
  let sawBrace = false;
  let sawBraceExpansion = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote === "'") {
      if (character === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (
        character === "\\" &&
        index + 1 < text.length &&
        '$`"\\'.includes(text[index + 1])
      ) {
        index++;
        continue;
      }
      if (character === "`") return true;
      if (
        character === "$" &&
        /[A-Za-z0-9_{(@*#?$!-]/.test(text[index + 1] ?? "")
      ) {
        return true;
      }
      if (character === '"') quote = null;
      continue;
    }
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === "`") return true;
    if (character === "$" && ["'", '"'].includes(text[index + 1])) {
      return true;
    }
    if (
      character === "$" &&
      /[A-Za-z0-9_{(@*#?$!-]/.test(text[index + 1] ?? "")
    ) {
      return true;
    }
    if (character === "=" && text[index + 1] === "(") return true;
    if (character === "*" || character === "?" || character === "[") {
      return true;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\n") return false;
    if (character === " " || character === "\t") {
      sawBrace = false;
      sawBraceExpansion = false;
      continue;
    }
    if (character === "{") {
      sawBrace = true;
      continue;
    }
    if (
      sawBrace &&
      (character === "," ||
        (character === "." && text[index + 1] === "."))
    ) {
      sawBraceExpansion = true;
      continue;
    }
    if (character === "}" && sawBrace && sawBraceExpansion) return true;
  }
  return quote !== null;
}

function redirectNodeUnsafe(node) {
  return (
    redirectStructureUnsafe(node) ||
    heredocStructureUnsafe(node) ||
    containsRedirectDynamicNode(node) ||
    containsRedirectQuotedDynamicNode(node) ||
    (node.type !== "heredoc_redirect" &&
      redirectTextHasExpansion(node.text)) ||
    (node.type !== "heredoc_redirect" &&
      !node.children.every(
        (child) =>
          REDIRECT_SYNTAX_NODE_TYPES.has(child.type) ||
          staticRedirectPart(child, /\s/.test(child.text)),
      )) ||
    (node.type !== "heredoc_redirect" &&
      node.children.some(
        (child) => child.type === "word" && child.text.startsWith("="),
      ))
  );
}

function redirectBearingCommand(node) {
  if (REDIRECT_DYNAMIC_NODES.has(node.type)) return undefined;
  if (node.type === "command") return node;
  let found;
  for (const child of node.children) {
    if (child.type.endsWith("_redirect")) continue;
    const command = redirectBearingCommand(child);
    if (command) found = command;
  }
  return found;
}

function commandCarriesSedRedirectRisk(node, shouldCheck) {
  if (REDIRECT_DYNAMIC_NODES.has(node.type)) return false;
  if (node.type === "redirected_statement") {
    const command =
      node.children.find((child) => child.type === "command") ??
      redirectBearingCommand(node);
    const relevant = command ? shouldCheck(command.text) : true;
    for (const child of node.children) {
      if (child.type.endsWith("_redirect")) {
        if (relevant && redirectNodeUnsafe(child)) return true;
      } else if (commandCarriesSedRedirectRisk(child, shouldCheck)) {
        return true;
      }
    }
    return false;
  }
  if (node.type === "command") {
    const relevant = shouldCheck(node.text);
    for (const child of node.children) {
      if (child.type.endsWith("_redirect")) {
        if (relevant && redirectNodeUnsafe(child)) return true;
      } else if (commandCarriesSedRedirectRisk(child, shouldCheck)) {
        return true;
      }
    }
    return false;
  }
  if (node.type.endsWith("_redirect")) return redirectNodeUnsafe(node);
  return node.children.some((child) =>
    commandCarriesSedRedirectRisk(child, shouldCheck),
  );
}

function checkRedirectSedRisk(input, _permissionContext, allowedRuleCommands) {
  const shouldCheck = (command) =>
    isSedCommand(command) && !allowedRuleCommands?.has(command.trim());
  if (
    input.command.length > MAX_COMMAND_LENGTH ||
    hasDifferentialTokens(input.command)
  ) {
    return {
      behavior: "ask",
      message: "sed command requires approval (contains potentially dangerous operations)",
      decisionReason: {
        type: "other",
        reason:
          "sed command could not be statically validated (command is over-length or contains characters bash and the analyzer tokenize differently)",
        bashMissKind: "sed-dangerous",
      },
    };
  }
  const root = getParser().parse(input.command);
  if (
    !root ||
    hasParseError(root) ||
    commandCarriesSedRedirectRisk(root, shouldCheck)
  ) {
    return {
      behavior: "ask",
      message: "sed command requires approval (contains potentially dangerous operations)",
      decisionReason: {
        type: "other",
        reason:
          "sed command carries redirect-borne content that cannot be statically validated (swallowed arguments, unanalyzable heredoc, or expansion in a redirect target)",
        bashMissKind: "sed-dangerous",
      },
    };
  }
  return {
    behavior: "passthrough",
    message: "No redirect-borne sed risk detected",
  };
}


export function checkSedSafety(input, permissionContext) {
  let redirectDecision;
  for (const command of splitSubcommands(input.command)) {
    const sed = sedCommandText(command);
    if (sed === null) continue;
    redirectDecision ??= checkRedirectSedRisk(input, permissionContext);
    if (redirectDecision.behavior === "ask") return redirectDecision;
    if (
      !isSedReadOnly(sed, {
        allowFileWrites: permissionContext.mode === "acceptEdits",
      })
    ) {
      return {
        behavior: "ask",
        message:
          "sed command requires approval (contains potentially dangerous operations)",
        decisionReason: {
          type: "other",
          reason:
            "sed command contains operations that require explicit approval (e.g., write commands, execute commands)",
          bashMissKind: "sed-dangerous",
        },
      };
    }
  }
  return {
    behavior: "passthrough",
    message: "No dangerous sed operations detected",
  };
}

function directCommandDecision(
  input,
  permissionContext,
  hasCd,
  commandAnalysis,
  cwd,
  bareAssignmentNames,
  runtime,
) {
  return (runtime.decisions ?? runtime.effects).checkDirectCommand(
    input,
    permissionContext,
    hasCd,
    commandAnalysis,
    cwd,
    bareAssignmentNames,
  );
}

async function finalSubcommandDecision(
  input,
  permissionContext,
  classifierPrefix,
  hasCd,
  commandAnalysis,
  cwd,
  bareAssignmentNames,
  runtime,
) {
  return await (runtime.decisions ?? runtime.effects).checkSubcommandPermission(
    input,
    permissionContext,
    classifierPrefix,
    hasCd,
    commandAnalysis,
    cwd,
    bareAssignmentNames,
  );
}

function serializeRule(rule) {
  if (!rule.ruleContent) return rule.toolName;
  const content = rule.ruleContent
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
  return `${rule.toolName}(${content})`;
}

export class ClassifierAbortError extends Error {
  constructor(message) {
    super(message);
    this.name = "AbortError";
  }
}

export const PATH_SEPARATOR = pathSeparator;
export const SUGGESTION_LIMIT = 5;

function normalizePermissionSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.flatMap((update) =>
    update?.type === "addRules" && Array.isArray(update.rules)
      ? update.rules
      : [],
  );
}

function decomposeCommands(texts, analyses, cwd, normalizedCwd) {
  const subcommands = [];
  const astCommandsByIdx = [];
  for (let index = 0; index < texts.length; index++) {
    const text = texts[index];
    const analysis = analyses?.[index];
    const syntheticCwd =
      ((text === `cd ${cwd}` && !/[\s\\$`'"*?[\]{}<>|&;()]/.test(cwd)) ||
        (text === `cd ${normalizedCwd}` && !/[\s\\$`'"*?[\]{}<>|&;()]/.test(normalizedCwd))) &&
      analysis !== undefined &&
      analysis.argv.length === 2 &&
      analysis.argv[0] === "cd" &&
      analysis.envVars.length === 0 &&
      analysis.redirects.length === 0 &&
      !/[*?[\]]/.test(analysis.argv[1]) &&
      !hasUnknownTrackedValue(analysis.argv[1]);
    if (syntheticCwd) continue;
    subcommands.push(text);
    astCommandsByIdx.push(analysis);
  }
  return { subcommands, astCommandsByIdx };
}

function mergeDuplicateSubcommandResults(commands, decisions) {
  const severity = { deny: 3, ask: 2, passthrough: 1, allow: 0 };
  const merged = new Map();
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    const decision = decisions[index];
    const previous = merged.get(command);
    const nextSeverity = severity[decision.behavior];
    const previousSeverity = previous ? severity[previous.behavior] : -1;
    if (
      !previous ||
      nextSeverity > previousSeverity ||
      (nextSeverity === previousSeverity &&
        findSafetyCheckReason(decision.decisionReason) !== undefined &&
        findSafetyCheckReason(previous.decisionReason) === undefined)
    ) {
      merged.set(command, decision);
    }
  }
  return merged;
}

async function tooComplexRuleDecision(input, permissionContext, root, runtime) {
  return await (runtime.decisions ?? runtime.effects).checkTooComplexSafety(
    input,
    permissionContext,
    root,
  );
}

function invalidSemanticsRuleDecision(
  input,
  permissionContext,
  commandAnalyses,
  runtime,
) {
  return (runtime.decisions ?? runtime.effects).checkInvalidSemanticsRules(
    input,
    permissionContext,
    commandAnalyses,
  );
}

/** Upstream jrn, with only settings/session/filesystem/classifier effects ported. */
export async function checkBashPermissionCore(
  input,
  context,
  modelClassifier,
  runtime,
) {
  const effects = runtime.effects;
  const decisions = runtime.decisions ?? effects;
  let permissionContext = effects.readPermissionContext(context);
  const sessionEnvironment = context.sessionEnvVars;
  effects.replaceSessionEnvironmentKeys(
    sessionEnvironment && typeof sessionEnvironment.keys === "function"
      ? sessionEnvironment.keys()
      : [],
  );

  const root = await parseOrAbort(input.command, effects.emitTelemetry);
  const classify =
    runtime.classifyCommand ??
    createCommandClassifier(
      effects.isSubprocessEnvironmentScrubbingEnabled ?? (() => false),
    );
  const classified = root
    ? classify(input.command, root)
    : { kind: "simple", commands: [], bareAssignmentNames: [] };

  if (classified.kind === "too-complex") {
    const protectedDecision = await tooComplexRuleDecision(
      input,
      permissionContext,
      root,
      runtime,
    );
    if (protectedDecision !== null) return protectedDecision;
    const sandboxDecision = context.forRemoteExecution === true
      ? null
      : sandboxTooComplexDecision(
          input,
          permissionContext,
          classified.nodeType,
          runtime,
        );
    if (sandboxDecision !== null && sandboxDecision !== undefined) {
      return sandboxDecision;
    }
    const reason = {
      type: "other",
      reason: classified.reason,
      bashMissKind: "too-complex",
    };
    effects.emitTelemetry("tengu_bash_ast_too_complex", {
      nodeTypeId: classifierNodeTypeId(classified.nodeType),
    });
    return {
      behavior: "ask",
      decisionReason: reason,
      message: shellPermissionMessage(reason),
      suggestions: [],
    };
  }

  const commandAnalyses = classified.commands;
  const semantics = validateCommandSemantics(commandAnalyses);
  if (!semantics.ok) {
    const protectedDecision = invalidSemanticsRuleDecision(
      input,
      permissionContext,
      commandAnalyses,
      runtime,
    );
    if (protectedDecision !== null) return protectedDecision;
    if (semantics.kind === "newline-hash" && context.forRemoteExecution !== true) {
      const sandboxDecision = sandboxAutoAllow(
        input,
        permissionContext,
        commandAnalyses,
        classified.bareAssignmentNames,
        runtime,
      );
      if (sandboxDecision) return sandboxDecision;
    }
    const reason = {
      type: "other",
      reason: semantics.reason,
      bashMissKind: "semantics",
    };
    return {
      behavior: "ask",
      decisionReason: reason,
      message: shellPermissionMessage(reason),
      suggestions: [],
    };
  }

  const texts = commandAnalyses.map(({ text }) => text);
  const redirects = commandAnalyses.flatMap(({ redirects }) => redirects);
  const sandboxDecision =
    context.forRemoteExecution === true
      ? null
      : sandboxAutoAllow(
          input,
          permissionContext,
          commandAnalyses,
          classified.bareAssignmentNames,
          runtime,
        );
  if (sandboxDecision) return sandboxDecision;

  const exact = exactRuleDecision(input, permissionContext, runtime);
  if (exact.behavior === "deny") return exact;

  const checkPermissionPort = runtime.checkPermission;
  const pipeDecision = await checkPipeSafety(input, {
    checkPermission: (subcommand) =>
      checkPermissionPort(subcommand, context, modelClassifier),
    classifiers: {
      isNormalizedCdCommand: isNormalizedCdCommand,
      isNormalizedGitCommand: isNormalizedGitCommand,
    },
    parsedRoot: root,
    commandAnalyses,
    effects: {
      currentWorkingDirectory: effects.currentWorkingDirectory,
      hasUnsafeGitStructureFromAnalysis:
        decisions.hasUnsafeGitStructureFromAnalysis,
      hasUnsafeGitStructureFromCommand:
        decisions.hasUnsafeGitStructureFromCommand,
      isCdGitSequenceSafe: (commands) =>
        decisions.isCdGitSequenceSafe(
          commands,
          effects.currentWorkingDirectory(),
        ),
    },
  });
  if (pipeDecision.behavior !== "passthrough") {
    if (pipeDecision.behavior === "allow") {
      permissionContext = effects.readPermissionContext(context);
      const path = checkPathSafety(
        input,
        effects.currentWorkingDirectory(),
        permissionContext,
        hasNormalizedCdCommand(input.command),
        redirects,
        commandAnalyses,
        runtime,
      );
      if (
        path.behavior === "deny" ||
        (path.behavior === "ask" && !path.bashAllowRuleOverridable)
      ) {
        return path;
      }
    }
    return pipeDecision;
  }

  const cwd = effects.currentWorkingDirectory();
  const normalizedCwd = effects.platform() === "windows"
    ? normalizeWindowsPath(cwd)
    : cwd;
  const { subcommands, astCommandsByIdx } = decomposeCommands(
    texts,
    commandAnalyses,
    cwd,
    normalizedCwd,
  );
  const cdCommands = subcommands.filter(isNormalizedCdCommand);
  if (cdCommands.length > 1) {
    const allowed = uniqueValues(
      [cwd, ...effects.allowedDirectories(effects.readPermissionContext(context))]
        .flatMap((path) => {
          const { resolvedPath } = effects.resolvePathPolicy(
            effects.filesystem(),
            path,
          );
          return resolvedPath === path ? [path] : [path, resolvedPath];
        })
        .map((path) => normalizePath(path)),
    ).map((path) => ({
      exact: caseFoldPath(path),
      prefix: caseFoldPath(
        /[\\/]$/.test(path) ? path : path + pathSeparator,
      ),
    }));
    const isAllowedPath = (path) => {
      const folded = caseFoldPath(normalizePath(path));
      return allowed.some(
        ({ exact, prefix }) => folded === exact || folded.startsWith(prefix),
      );
    };
    let sequenceIsSafe = !/[;|\n&]/.test(input.command.replaceAll("&&", ""));
    const { resolvedPath: resolvedCwd } = effects.resolvePathPolicy(
      effects.filesystem(),
      cwd,
    );
    let candidateDirectories = uniqueValues([
      normalizePath(cwd),
      normalizePath(resolvedCwd),
    ]);
    const directoryStack = [];
    for (const analysis of commandAnalyses) {
      const [rawName, ...args] = peelCommandPrefixes(analysis.argv);
      const name = rawName?.replace(/^.*[\\/]/, "");
      if (["cd", "chdir", "pushd", "popd"].includes(name)) {
        if (name === "popd") {
          if (args.length === 0 && directoryStack.length > 0) {
            candidateDirectories = directoryStack.pop();
          } else {
            sequenceIsSafe = false;
          }
        } else {
          const positionals = args.filter(
            (argument) =>
              argument !== "--" &&
              (argument === "-" || !argument.startsWith("-")),
          );
          const target = positionals.length === 1 ? positionals[0] : undefined;
          let targetIsSafe = false;
          const nextCandidates = [];
          if (
            target !== undefined &&
            target !== "-" &&
            !/^[+-]\d+$/.test(target) &&
            !target.startsWith("~") &&
            !/[*?[]/.test(target) &&
            !hasUnknownTrackedValue(target) &&
            !/(^|[\\/])\.\.([\\/]|$)/.test(target)
          ) {
            targetIsSafe = true;
            for (const candidate of candidateDirectories) {
              const next = isAbsolutePath(target)
                ? normalizePath(target)
                : resolvePath(candidate, target);
              const { resolvedPath } = effects.resolvePathPolicy(
                effects.filesystem(),
                next,
              );
              if (!isAllowedPath(next) || !isAllowedPath(resolvedPath)) {
                targetIsSafe = false;
                break;
              }
              nextCandidates.push(normalizePath(next), normalizePath(resolvedPath));
            }
          }
          sequenceIsSafe &&= targetIsSafe;
          if (targetIsSafe) {
            if (name === "pushd") directoryStack.push(candidateDirectories);
            candidateDirectories = uniqueValues(nextCandidates);
          }
        }
        continue;
      }
      if (name !== "rm" && name !== "rmdir") continue;
      const removal = decisions.checkDangerousRemoval(
        name,
        args,
        cwd,
        effects.readPermissionContext(context),
        !sequenceIsSafe,
      );
      if (removal.behavior !== "passthrough") return removal;
    }
    const reason = {
      type: "other",
      reason: "Multiple directory changes in one command require approval for clarity",
      bashMissKind: "multi-cd",
    };
    return {
      behavior: "ask",
      decisionReason: reason,
      message: shellPermissionMessage(reason),
    };
  }
  const hasCd = cdCommands.length > 0;
  let effectiveCwd = cwd;
  let pathHasCd = hasCd;
  let firstCdProven = false;
  if (
    context.forRemoteExecution !== true &&
    hasCd &&
    subcommands.length > 1 &&
    subcommands.length === texts.length &&
    isNormalizedCdCommand(subcommands[0]) &&
    isSafeCdSequence(input.command)
  ) {
    const resolved = decisions.resolveLeadingDirectoryChange(
      astCommandsByIdx[0],
      cwd,
      permissionContext,
    );
    if (resolved !== null && resolved !== undefined) {
      effectiveCwd = resolved;
      pathHasCd = false;
      firstCdProven = true;
    }
  }

  let cdGitDecision;
  if (
    hasCd &&
    subcommands.some((command) => isNormalizedGitCommand(command.trim())) &&
    !(await decisions.isCdGitAstSequenceSafe(
      astCommandsByIdx,
      subcommands,
      cwd,
    ))
  ) {
    const reason = {
      type: "other",
      reason:
        "This command changes directory before running git, which can execute untrusted hooks from the target directory. Approve only if you trust it.",
      bashMissKind: "cd-git-compound",
    };
    cdGitDecision = {
      behavior: "ask",
      decisionReason: reason,
      message: shellPermissionMessage(reason),
    };
  }
  let gitStructureDecision;
  if (
    subcommands.some((command) => isNormalizedGitCommand(command.trim())) &&
    (decisions.hasUnsafeGitStructureFromAnalysis(
      astCommandsByIdx,
      effectiveCwd,
    ) || decisions.hasUnsafeGitStructureFromCommand(input.command))
  ) {
    const reason = {
      type: "other",
      reason:
        "This command creates git repository structure files (HEAD/objects/refs/hooks) and then runs git, which can execute hooks/fsmonitor from the created files.",
      bashMissKind: "cd-git-compound",
    };
    gitStructureDecision = {
      behavior: "ask",
      decisionReason: reason,
      message: shellPermissionMessage(reason),
    };
  }

  permissionContext = effects.readPermissionContext(context);
  const preliminary = subcommands.map((command, index) =>
    directCommandDecision(
      { command },
      permissionContext,
      pathHasCd,
      astCommandsByIdx[index],
      firstCdProven && index === 0 ? cwd : effectiveCwd,
      classified.bareAssignmentNames,
      runtime,
    ),
  );
  if (preliminary.some(({ behavior }) => behavior === "deny")) {
    return {
      behavior: "deny",
      message: `Permission to use Bash with command ${input.command} has been denied.`,
      decisionReason: {
        type: "subcommandResults",
        reasons: new Map(
          preliminary.map((decision, index) => [subcommands[index], decision]),
        ),
      },
    };
  }

  const pathDecision = checkPathSafety(
    input,
    effectiveCwd,
    permissionContext,
    pathHasCd,
    redirects,
    astCommandsByIdx.slice(firstCdProven ? 1 : 0).filter(Boolean),
    runtime,
  );
  if (pathDecision.behavior === "deny") return pathDecision;
  if (
    pathDecision.behavior === "ask" &&
    pathDecision.decisionReason?.type === "safetyCheck" &&
    pathDecision.decisionReason.classifierApprovable === false
  ) {
    return pathDecision;
  }
  if (cdGitDecision) return cdGitDecision;
  if (gitStructureDecision) return gitStructureDecision;

  const sedIndices = subcommands
    .map((command, index) => [command, index])
    .filter(([command]) => isSedCommand(command))
    .map(([, index]) => index);
  if (sedIndices.length > 0) {
    const allSedCommandsAllowedByRule = sedIndices.every((index) => {
      const decision = preliminary[index];
      return (
        decision?.behavior === "allow" &&
        decision.decisionReason?.type === "rule"
      );
    });
    const hasNonAllow = preliminary.some(
      (decision) => decision.behavior !== "allow",
    );
    const hasBlockingPathAsk =
      pathDecision.behavior === "ask" &&
      !pathDecision.bashAllowRuleOverridable;
    if (
      !allSedCommandsAllowedByRule &&
      !hasNonAllow &&
      !hasBlockingPathAsk &&
      exact.behavior !== "allow"
    ) {
      const allowedRuleCommands = new Set(
        sedIndices
          .filter((index) => {
            const decision = preliminary[index];
            return (
              decision?.behavior === "allow" &&
              decision.decisionReason?.type === "rule"
            );
          })
          .map((index) => subcommands[index].trim()),
      );
      const redirectSedRisk = checkRedirectSedRisk(
        input,
        permissionContext,
        allowedRuleCommands,
      );
      if (redirectSedRisk.behavior === "ask") return redirectSedRisk;
    }
  }

  const firstAsk = preliminary.find(({ behavior }) => behavior === "ask");
  const nonAllowCount = preliminary.filter(
    ({ behavior }) => behavior !== "allow",
  ).length;
  if (
    pathDecision.behavior === "ask" &&
    firstAsk === undefined &&
    !pathDecision.bashAllowRuleOverridable
  ) {
    return pathDecision;
  }
  if (firstAsk !== undefined && nonAllowCount === 1) return firstAsk;
  if (exact.behavior === "allow") return exact;
  if (preliminary.every(({ behavior }) => behavior === "allow")) {
    return {
      behavior: "allow",
      updatedInput: input,
      decisionReason: {
        type: "subcommandResults",
        reasons: new Map(
          preliminary.map((decision, index) => [subcommands[index], decision]),
        ),
      },
    };
  }

  let classifierResult = null;
  if (modelClassifier) {
    classifierResult = await modelClassifier(
      input.command,
      context.abortController.signal,
      context.options.isNonInteractiveSession,
    );
    if (context.abortController.signal.aborted) {
      throw new ClassifierAbortError();
    }
  }
  permissionContext = effects.readPermissionContext(context);
  if (subcommands.length === 1) {
    return finalSubcommandDecision(
      { command: subcommands[0] },
      permissionContext,
      classifierResult,
      pathHasCd,
      astCommandsByIdx[0],
      effectiveCwd,
      classified.bareAssignmentNames,
      runtime,
    );
  }

  const classifierPrefixes = classifierResult?.subcommandPrefixes;
  const finalDecisions = [];
  for (let index = 0; index < subcommands.length; index++) {
    const command = subcommands[index];
    const classifierPrefix = classifierPrefixes
      ? classifierPrefixes.get(command)
      : undefined;
    finalDecisions.push(
      await finalSubcommandDecision(
        { ...input, command },
        permissionContext,
        classifierPrefix,
        pathHasCd,
        astCommandsByIdx[index],
        firstCdProven && index === 0 ? cwd : effectiveCwd,
        classified.bareAssignmentNames,
        runtime,
      ),
    );
  }

  const reasons = mergeDuplicateSubcommandResults(
    subcommands,
    finalDecisions,
  );
  if (finalDecisions.every(({ behavior }) => behavior === "allow")) {
    return {
      behavior: "allow",
      updatedInput: input,
      decisionReason: { type: "subcommandResults", reasons },
    };
  }

  const suggestedRules = new Map();
  for (let index = 0; index < finalDecisions.length; index++) {
    const decision = finalDecisions[index];
    if (decision.behavior !== "ask" && decision.behavior !== "passthrough") {
      continue;
    }
    const rules = normalizePermissionSuggestions(decision.suggestions);
    for (const rule of rules) {
      suggestedRules.set(serializeRule(rule), rule);
    }
    if (
      decision.behavior === "ask" &&
      rules.length === 0 &&
      decision.decisionReason?.type !== "rule"
    ) {
      for (const rule of normalizePermissionSuggestions(
        permissionSuggestions(subcommands[index]),
      )) {
        suggestedRules.set(serializeRule(rule), rule);
      }
    }
  }
  const capped = [...suggestedRules.values()].slice(0, SUGGESTION_LIMIT);
  const suggestions = capped.length > 0
    ? [
        {
          type: "addRules",
          rules: capped,
          behavior: "allow",
          destination: "localSettings",
        },
      ]
    : undefined;
  const decisionReason = { type: "subcommandResults", reasons };
  return {
    behavior: firstAsk !== undefined ? "ask" : "passthrough",
    message: shellPermissionMessage(decisionReason),
    decisionReason,
    suggestions,
  };
}

/** Upstream $ct, the anchored root that owns jrn and the lower safety closure. */
export async function checkBashPermission(
  input,
  context,
  modelClassifier,
  runtime,
) {
  const { effects } = runtime;
  const permissionContext = effects.readPermissionContext(context);
  const clamps = permissionContext.bashCommandClamps;
  if (clamps !== undefined && clamps.length > 0) {
    const mismatch = await findClampMismatch(input, clamps, effects);
    if (mismatch !== null) {
      effects.emitTelemetry("tengu_bash_command_clamp_denied", {
        groupCount: clamps.length,
      });
      return {
        behavior: "deny",
        message:
          `Permission to use Bash with command ${input.command.trim()} has been denied: ` +
          "this agent's Bash use is clamped to a fixed set of command forms " +
          "(per-spawn bashCommandClamp), and " +
          (mismatch.kind === "unverifiable"
            ? "the command has structure the clamp cannot verify " +
              "(substitution, control flow, or an undecomposable compound) — " +
              "no clamp rule can admit it. Issue plain commands matching the clamped forms."
            : `the span ${displaySpan(mismatch.span)} matches none of them. ` +
              `Allowed forms: ${mismatch.group.join(", ")}`),
        decisionReason: { type: "other", reason: CLAMP_REJECTION_REASON },
      };
    }
  }

  let decision = await runtime.checkCore(input, context, modelClassifier);
  if (decision.behavior !== "allow" || !input.command.includes("&")) {
    return (runtime.decisions ?? effects).decorateDecision(
      decision,
      input,
      effects.readPermissionContext(context),
    );
  }
  if (
    decision.decisionReason?.type === "other" &&
    decision.decisionReason.reason === SANDBOX_AUTO_ALLOW_REASON
  ) {
    return decision;
  }

  const root = await parseOrAbort(input.command, effects.emitTelemetry);
  if (
    root &&
    root !== PARSE_ABORTED &&
    !treeContainsUnsafeBackgroundOperator(root)
  ) {
    return decision;
  }

  const reason = {
    type: "safetyCheck",
    reason:
      "This command uses the `&` background operator, which defers execution past approval-time safety checks. Approve only if you trust it.",
    classifierApprovable: false,
    circuitBreaker: "backgroundOperator",
  };
  decision = {
    behavior: "ask",
    decisionReason: reason,
    message: shellPermissionMessage(reason),
  };
  return (runtime.decisions ?? effects).decorateDecision(
    decision,
    input,
    effects.readPermissionContext(context),
  );
}
