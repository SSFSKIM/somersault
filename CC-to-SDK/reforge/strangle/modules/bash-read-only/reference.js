// PARITY LAYER — C13b's pinned Bash read-only classifier.
//
// Upstream `_8e` @969966-972888 in chunk-fy12d89p.js decides whether a Bash
// call can skip the permission broker. This module owns that function and its
// transitive pure closure. It deliberately imports C13a's parser, C13b's
// command classifier, and the separately owned flag/effect tables instead of
// reproducing any of those units.
import { posix, win32 } from "node:path";
import {
  commandArgv,
  findCommandNode,
  getParser,
} from "../shell-parser/reference.js";
import { createCommandClassifier } from "../command-classifier/reference.js";
import { createBashSafetyTables } from "../bash-safety-tables/reference.js";

const MAX_COMMAND_LENGTH = 10_000;
const COMMAND_SUBSTITUTION_OUTPUT = "__CMDSUB_OUTPUT__";
const TRACKED_VARIABLE_OUTPUT = "__TRACKED_VAR__";

/** @typedef {{type:string,text:string,startIndex:number,endIndex:number,children:(ShellNode|null)[]}} ShellNode */
/** @typedef {{command:string,[key:string]:unknown}} BashInput */
/** @typedef {false|"bare-indicators"|"gitdir-redirect-plantable"|"gitdir-file-oversized"} GitCwdRisk */
/**
 * @typedef {object} ReadOnlyPorts
 * @property {() => ReadonlySet<string>|null} getSpawnEnvironmentKeys
 * @property {() => GitCwdRisk} inspectGitWorkingDirectory
 * @property {() => boolean} isSandboxingEnabled
 * @property {() => string} getCurrentWorkingDirectory
 * @property {() => string} getOriginalWorkingDirectory
 * @property {() => string} getPlatform
 * @property {() => string} getHomeDirectory
 * @property {() => boolean} isSubprocessEnvironmentScrubbingEnabled
 */

const SPLIT_CONTAINER_TYPES = new Set(["program", "list", "pipeline"]);
const SHELL_OPERATORS = new Set(["&&", "||", "|", ";", "&", "|&", "\n"]);

/** Upstream Ua — split a compound command while retaining each executable leaf. */
function splitSubcommands(command) {
  if (!command) return [];
  if (command.length > MAX_COMMAND_LENGTH) return [command];
  const root = getParser().parse(command);
  if (!root) return [command];
  const parts = [];
  const visit = (node) => {
    if (SHELL_OPERATORS.has(node.type) || node.type === "comment") return;
    if (node.type === "redirected_statement") {
      for (const child of node.children) {
        if (!child.type.endsWith("_redirect")) visit(child);
      }
      return;
    }
    if (SPLIT_CONTAINER_TYPES.has(node.type)) {
      for (const child of node.children) {
        visit(child);
      }
      return;
    }
    parts.push(node.text);
  };
  const program = root.type === "ERROR" && root.children[0]?.type === "program"
    ? root.children[0]
    : root;
  visit(program);
  return parts;
}

/** Upstream ru — parse one command string and return C13a's positional argv prefix. */
function commandArgvFromString(command) {
  if (!command || command.length > MAX_COMMAND_LENGTH) return [];
  const root = getParser().parse(command);
  if (!root) return [];
  const commandNode = findCommandNode(root, null);
  return commandNode ? commandArgv(commandNode) : [];
}

function unescapeNodeText(node) {
  switch (node.type) {
    case "raw_string":
      return node.text.slice(1, -1);
    case "string":
      return node.text.slice(1, -1).replace(/\\([$`"\\\n])/g, (_match, char) =>
        char === "\n" ? "" : char);
    case "word":
      return node.text.replace(/\\([\s\S])/g, (_match, char) =>
        char === "\n" ? "" : char);
    default:
      return node.text;
  }
}

const DYNAMIC_NODE_TYPES = new Set([
  "command_substitution",
  "process_substitution",
  "expansion",
  "simple_expansion",
  "arithmetic_expansion",
]);
const DYNAMIC_STRING_TYPES = new Set(["ansi_c_string", "translated_string"]);
const REDIRECT_TOKENS = new Set([
  "<", ">", ">>", "<<", "<<-", "<<<", "<&", ">&", "&>", "&>>", ">|",
  ">&-", "<&-", "file_descriptor", "heredoc_start", "heredoc_body",
  "heredoc_content", "heredoc_end",
]);
const STATIC_ARGUMENT_TYPES = new Set(["word", "string", "raw_string", "number"]);
const UNESCAPED_SHELL_OPERATOR = /(?:^|[^\\])(?:\\\\)*[;|&<>]/;
const UNESCAPED_DOLLAR = /(?:^|[^\\])(?:\\\\)*\$/;

function containsStructuralError(node) {
  return node.type === "ERROR" || node.children.some(containsStructuralError);
}
function containsDynamicNode(node) {
  return DYNAMIC_NODE_TYPES.has(node.type) || node.children.some(containsDynamicNode);
}
function containsDynamicString(node) {
  return DYNAMIC_STRING_TYPES.has(node.type) || node.children.some(containsDynamicString);
}
function hasAmbiguousRedirect(node) {
  if (node.type.endsWith("_redirect")) {
    const values = node.children.filter((child) => !REDIRECT_TOKENS.has(child.type));
    const closesFd = node.children.some((child) => child.type === ">&-" || child.type === "<&-");
    const negativeFd = !closesFd &&
      node.children.some((child) => child.type === ">&" || child.type === "<&") &&
      values.some((child) => unescapeNodeText(child).startsWith("-"));
    const expectedValues = node.type === "heredoc_redirect" || closesFd || negativeFd ? 0 : 1;
    if (values.length > expectedValues) return true;
  }
  return node.children.some(hasAmbiguousRedirect);
}
function hasUnsafeHeredoc(node) {
  if (node.type === "heredoc_redirect") {
    const start = node.children.find((child) => child.type === "heredoc_start")?.text ?? "";
    const quoted = start.length >= 2 &&
      ((start.startsWith("'") && start.endsWith("'")) ||
        (start.startsWith('"') && start.endsWith('"')));
    if (!quoted || start.includes("\\")) return true;
  }
  return node.children.some(hasUnsafeHeredoc);
}
function isStaticArgumentNode(node, rejectQuotes = false) {
  if (node.type === "concatenation") {
    return node.children.every((child) => isStaticArgumentNode(child, rejectQuotes));
  }
  if (node.type === "word") {
    if (UNESCAPED_DOLLAR_OR_BACKTICK.test(node.text)) return false;
    if (UNESCAPED_SHELL_OPERATOR.test(node.text) || UNESCAPED_DOLLAR.test(node.text)) return false;
    if (rejectQuotes && UNESCAPED_QUOTE.test(node.text)) return false;
    return true;
  }
  if (node.type === "string" || node.type === "raw_string") {
    const quote = node.type === "raw_string" ? "'" : '"';
    return node.text.length >= 2 && node.text.startsWith(quote) && node.text.endsWith(quote);
  }
  return STATIC_ARGUMENT_TYPES.has(node.type);
}

const CONTROL_OR_LONE_SURROGATE = /[\x00-\x08\x0B-\x1F\x7F]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const UNSAFE_BACKSLASH = /\\[ \t]|(?:^|[^ \t\\])(?:\\\\)*\\\n|[ \t](?:\\\\)+\\\n/;
const UNESCAPED_DOLLAR_OR_BACKTICK = /(?:^|[^\\])(?:\\\\)*[`$]/;
const UNESCAPED_QUOTE = /(?:^|[^\\])(?:\\\\)*['"]/;
const ZSH_DYNAMIC_DIRECTORY = /~\[/;
const ZSH_EQUALS_EXPANSION = /(?:^|[\s;&|])=[a-zA-Z_]/;
const ZSH_NUMERIC_RANGE = /<\d*-\d*>/;

function containsUnsafeLexeme(command) {
  return CONTROL_OR_LONE_SURROGATE.test(command) ||
    LONE_SURROGATE.test(command) ||
    UNSAFE_BACKSLASH.test(command) ||
    ZSH_DYNAMIC_DIRECTORY.test(command) ||
    ZSH_EQUALS_EXPANSION.test(command) ||
    ZSH_NUMERIC_RANGE.test(command);
}

function hasUnsafeSourceSyntax(command) {
  let quote = null;
  let braceOpen = false;
  let braceRange = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = null;
           continue;
    }
    if (quote === '"') {
      if (char === "\\" && index + 1 < command.length && '$`"\\'.includes(command[index + 1])) {
        index++;
        continue;
      }
      if (char === "`") return true;
      if (char === "$" && /[A-Za-z0-9_{(@*#?$!-]/.test(command[index + 1] ?? "")) return true;
      if (char === '"') quote = null;
      continue;
    }
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "`") return true;
    if (char === "$" && (command[index + 1] === "'" || command[index + 1] === '"')) return true;
    if (char === "$" && /[A-Za-z0-9_{(@*#?$!-]/.test(command[index + 1] ?? "")) return true;
    if (char === "=" && command[index + 1] === "(") return true;
    if (char === "*" || char === "?" || char === "[") return true;
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\n") return false;
    if (char === " " || char === "\t") {
      braceOpen = false;
      braceRange = false;
      continue;
    }
    if (char === "{") {
      braceOpen = true;
      continue;
    }
    if (braceOpen && (char === "," || (char === "." && command[index + 1] === "."))) {
      braceRange = true;
      continue;
    }
    if (char === "}" && braceOpen && braceRange) return true;
  }
  return quote !== null;
}

function isStructurallyUnsafe(command) {
  if (!command || command.length > MAX_COMMAND_LENGTH) return true;
  if (containsUnsafeLexeme(command) || hasUnsafeSourceSyntax(command)) return true;
  const root = getParser().parse(command);
  if (!root || containsStructuralError(root)) return true;
  const topLevel = root.children.filter((child) => child.type !== "comment");
  if (
    topLevel.length !== 1 ||
    (topLevel[0].type !== "command" && !(
      topLevel[0].type === "redirected_statement" &&
      topLevel[0].children.some((child) => child.type === "command")
    ))
  ) return true;
  if (
    containsDynamicNode(root) ||
    containsDynamicString(root) ||
    hasAmbiguousRedirect(root) ||
    hasUnsafeHeredoc(root)
  ) return true;
  const commandNode = findCommandNode(root, null);
  if (!commandNode) return true;
  for (const child of commandNode.children) {
    if (child.type === "command_name" || child.type === "variable_assignment") continue;
    if (child.type.endsWith("_redirect")) continue;
    if (!isStaticArgumentNode(child, /\s/.test(child.text))) return true;
  }
  return false;
}

function analyzeRedirections(command) {
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
  let dangerous = false;
  let reason;
  const visit = (node) => {
    if (node.type === "file_redirect") {
      let operator = null;
      let duplicatesFd = false;
      let targetNode = null;
      let valueCount = 0;
      for (const child of node.children) {
        if (child.type === ">" || child.type === "&>" || child.type === ">|") operator = ">";
        else if (child.type === ">>" || child.type === "&>>" || child.type === ">>|") operator = ">>";
        else if (child.type === ">&") {
          operator = ">";
          duplicatesFd = true;
        } else if (child.type === "<&") {
          const values = node.children.filter((candidate) =>
            candidate !== child && candidate.type !== "file_descriptor");
          if (values.length > 1 || values.some((candidate) => unescapeNodeText(candidate).startsWith("-"))) {
            dangerous = true;
            if (reason !== "network_device") reason = "shell_expansion";
          }
          return;
        } else if (child.type === ">&-" || child.type === "<&-") {
          if (node.children.filter((candidate) =>
            candidate !== child && candidate.type !== "file_descriptor").length > 0) {
            dangerous = true;
            if (reason !== "network_device") reason = "shell_expansion";
          }
          return;
        } else if (child.type === "<") {
          const values = node.children.filter((candidate) =>
            candidate !== child && candidate.type !== "file_descriptor");
          if (values.length > 1) {
            dangerous = true;
            if (reason !== "network_device") reason = "shell_expansion";
            return;
          }
          const value = values[0];
          if (value && /^\/dev\/(tcp|udp)\//.test(unescapeNodeText(value))) {
            dangerous = true;
            reason = "network_device";
          }
          return;
        } else if (child.type !== "file_descriptor") {
          targetNode = child;
          valueCount++;
        }
      }
      if (!operator || !targetNode) return;
      if (valueCount > 1) {
        dangerous = true;
        if (reason !== "network_device") reason = "shell_expansion";
        return;
      }
      if (duplicatesFd && unescapeNodeText(targetNode).startsWith("-")) {
        dangerous = true;
        if (reason !== "network_device") reason = "shell_expansion";
        return;
      }
      if (targetNode.type === "number" && targetNode.children.length === 0 && duplicatesFd) return;
      const staticTarget =
        (targetNode.type === "word" && targetNode.children.length === 0) ||
        (targetNode.type === "number" && targetNode.children.length === 0) ||
        targetNode.type === "raw_string" ||
        (targetNode.type === "string" &&
          !targetNode.children.some((piece) => piece.type !== "string_content" && piece.type !== '"'));
      if (!staticTarget) {
        dangerous = true;
        if (reason !== "network_device") reason = "shell_expansion";
        return;
      }
      const target = unescapeNodeText(targetNode);
      if (/^~|[*?[]/.test(target) || target.startsWith("!") || target.startsWith("=")) {
        dangerous = true;
        if (reason !== "network_device") reason = "shell_expansion";
        return;
      }
      if (duplicatesFd && !/^[A-Za-z0-9./_-]+$/.test(target)) {
        dangerous = true;
        if (reason !== "network_device") reason = "shell_expansion";
        return;
      }
      if (/^\/dev\/(tcp|udp)\//.test(target)) {
        dangerous = true;
        reason = "network_device";
        return;
      }
      redirections.push({ target, operator });
      return;
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  const commandParts = [];
  const retainCommands = (node) => {
    if (node.type === "comment") return;
    if (node.type === "redirected_statement") {
      for (const child of node.children) {
        if (!child.type.endsWith("_redirect")) retainCommands(child);
      }
      return;
    }
    if (SPLIT_CONTAINER_TYPES.has(node.type)) {
      for (const child of node.children) {
        retainCommands(child);
      }
      return;
    }
    commandParts.push(node.text);
  };
  retainCommands(root.type === "ERROR" && root.children[0]?.type === "program"
    ? root.children[0]
    : root);
  return {
    commandWithoutRedirections: commandParts.length > 0 ? commandParts.join(" ") : command,
    redirections,
    hasDangerousRedirection: dangerous,
    dangerousRedirectionReason: reason,
  };
}

function containsShellExpansion(value) {
  return value.includes(COMMAND_SUBSTITUTION_OUTPUT) ||
    value.includes(TRACKED_VARIABLE_OUTPUT);
}

function combinedShortFlagsAreAllowed(flags, allowed) {
  for (const flag of flags) {
    if (flag.startsWith("-") && !flag.startsWith("--") && flag.length > 2) {
      for (let index = 1; index < flag.length; index++) {
        if (!allowed.includes(`-${flag[index]}`)) return false;
      }
    } else if (!allowed.includes(flag)) return false;
  }
  return true;
}

function isPrintExpression(expression) {
  return Boolean(expression) && /^(?:\d+|\d+,\d+)?p$/.test(expression);
}

function isPrintingSed(command, scripts) {
  const argv = commandArgvFromString(command);
  if (argv[0] !== "sed") return false;
  const flags = argv.slice(1).filter((arg) => arg.startsWith("-") && arg !== "--");
  if (!combinedShortFlagsAreAllowed(flags, [
    "-n", "--quiet", "--silent", "-E", "--regexp-extended", "-r",
    "-z", "--zero-terminated", "--posix",
  ])) return false;
  let quiet = false;
  for (const flag of flags) {
    if (flag === "-n" || flag === "--quiet" || flag === "--silent") {
      quiet = true;
      break;
    }
    if (flag.startsWith("-") && !flag.startsWith("--") && flag.includes("n")) {
      quiet = true;
      break;
    }
  }
  if (!quiet || scripts.length === 0) return false;
  for (const script of scripts) {
    for (const expression of script.split(";")) {
      if (!isPrintExpression(expression.trim())) return false;
    }
  }
  return true;
}

function isSubstitutionSed(command, scripts, hasAmbiguousExpressions, options) {
  const allowFileWrites = options?.allowFileWrites ?? false;
  if (!allowFileWrites && hasAmbiguousExpressions) return false;
  const argv = commandArgvFromString(command);
  if (argv[0] !== "sed") return false;
  const flags = argv.slice(1).filter((arg) => arg.startsWith("-") && arg !== "--");
  const allowed = ["-E", "--regexp-extended", "-r", "--posix"];
  if (allowFileWrites) allowed.push("-i", "--in-place");
  if (!combinedShortFlagsAreAllowed(flags, allowed) || scripts.length !== 1) return false;
  const script = scripts[0].trim();
  if (!script.startsWith("s")) return false;
  const match = script.match(/^s\/(.*?)$/);
  if (!match) return false;
  const body = match[1];
  let delimiterCount = 0;
  let lastDelimiter = -1;
  let index = 0;
  while (index < body.length) {
    if (body[index] === "\\") {
      index += 2;
      continue;
    }
    if (body[index] === "/") {
      delimiterCount++;
      lastDelimiter = index;
    }
    index++;
  }
  if (delimiterCount !== 2) return false;
  const flagsAfter = body.slice(lastDelimiter + 1);
  return /^[gpimIM]*[1-9]?[gpimIM]*$/.test(flagsAfter);
}

function sedHasAmbiguousExpressions(command) {
  const argv = commandArgvFromString(command);
  if (argv[0] !== "sed") return false;
  const args = argv.slice(1);
  let operands = 0;
  let explicitExpression = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if ((arg === "-e" || arg === "--expression") && index + 1 < args.length) {
      explicitExpression = true;
      index++;
      continue;
    }
    if (arg.startsWith("--expression=") || arg.startsWith("-e=")) {
      explicitExpression = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    operands++;
    if (explicitExpression || operands > 1) return true;
  }
  return false;
}

const MULTIPLE_IN_PLACE_FLAGS = "__SED_MULTIPLE_I_FLAGS__";
function inPlaceSedScript(command) {
  const argv = commandArgvFromString(command);
  if (argv[0] !== "sed") return null;
  const args = argv.slice(1);
  const positions = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "-i" || /^-[Er]+i$/.test(args[index])) positions.push(index);
  }
  if (positions.length === 0) return null;
  if (positions.length > 1) return MULTIPLE_IN_PLACE_FLAGS;
  const position = positions[0];
  const next = args[position + 1];
  if (next === undefined || next === "" || next.startsWith(".") || next.startsWith("-")) return null;
  for (let index = position + 2; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-e" || arg === "--expression") return args[index + 1] ?? null;
    if (arg.startsWith("--expression=")) return arg.slice(13);
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return null;
}

function extractSedScripts(command) {
  const scripts = [];
  const argv = commandArgvFromString(command);
  if (argv[0] !== "sed") return scripts;
  const args = argv.slice(1);
  if (args.some((arg) => /^-e[wWe]/.test(arg) || /^-w[eE]/.test(arg))) {
    throw Error("Dangerous flag combination detected");
  }
  if (args.length === 0) throw Error("No sed arguments");
  try {
    let explicitExpression = false;
    let consumedImplicitScript = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (typeof arg !== "string") continue;
      if ((arg === "-e" || arg === "--expression") && index + 1 < args.length) {
        explicitExpression = true;
        const script = args[index + 1];
        if (typeof script === "string") {
          scripts.push(script);
          index++;
        }
        continue;
      }
      if (arg.startsWith("--expression=")) {
        explicitExpression = true;
        scripts.push(arg.slice(13));
        continue;
      }
      if (arg.startsWith("-e=")) {
        explicitExpression = true;
        scripts.push(arg.slice(3));
        continue;
      }
      if (arg.startsWith("-")) continue;
      if (!explicitExpression && !consumedImplicitScript) {
        scripts.push(arg);
        consumedImplicitScript = true;
        continue;
      }
      break;
    }
  } catch (error) {
    throw Error(`Failed to parse sed command: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
  return scripts;
}

function sedScriptIsDangerous(script) {
  const text = script.trim();
  if (!text) return false;
  if (/[^\x01-\x7F]/.test(text)) return true;
  if (text.includes("{") || text.includes("}")) return true;
  if (text.includes("\n") || text.includes("\r")) return true;
  const comment = text.indexOf("#");
  if (comment !== -1 && !(comment > 0 && text[comment - 1] === "s")) return true;
  if (/^!/.test(text) || /[/\d$]!/.test(text)) return true;
  if (/\d\s*~\s*\d|,\s*~\s*\d|\$\s*~\s*\d/.test(text)) return true;
  if (/^,/.test(text) || /,\s*[+-]/.test(text)) return true;
  if (/s\\/.test(text) || /\\[|#%@]/.test(text)) return true;
  if (/\\\/.*[wW]/.test(text) || /\/[^/]*\s+[wWeE]/.test(text)) return true;
  if (/^s\//.test(text) && !/^s\/[^/]*\/[^/]*\/[^/]*$/.test(text)) return true;
  if (/^s./.test(text) && /[wWeE]$/.test(text) && !/^s([^\\\n]).*?\1.*?\1[^wWeE]*$/.test(text)) return true;
  if (
    /^[wW]\s*\S+/.test(text) || /^\d+\s*[wW]\s*\S+/.test(text) ||
    /^\$\s*[wW]\s*\S+/.test(text) || /^\/[^/]*\/[IMim]*\s*[wW]\s*\S+/.test(text) ||
    /^\d+,\d+\s*[wW]\s*\S+/.test(text) || /^\d+,\$\s*[wW]\s*\S+/.test(text) ||
    /^\/[^/]*\/[IMim]*,\/[^/]*\/[IMim]*\s*[wW]\s*\S+/.test(text)
  ) return true;
  if (
    /^e/.test(text) || /^\d+\s*e/.test(text) || /^\$\s*e/.test(text) ||
    /^\/[^/]*\/[IMim]*\s*e/.test(text) || /^\d+,\d+\s*e/.test(text) ||
    /^\d+,\$\s*e/.test(text) || /^\/[^/]*\/[IMim]*,\/[^/]*\/[IMim]*\s*e/.test(text)
  ) return true;
  const substitution = text.match(/s([^\\\n]).*?\1.*?\1(.*?)$/);
  if (substitution) {
    const flags = substitution[2] || "";
    if (flags.includes("w") || flags.includes("W") || flags.includes("e") || flags.includes("E")) return true;
  }
  if (text.match(/y([^\\\n])/) && /[wWeE]/.test(text)) return true;
  return false;
}

/** Upstream cL — safe-table callback; exported because Bnn captures it directly. */
export function isSedReadOnly(command, options) {
  const allowFileWrites = options?.allowFileWrites ?? false;
  if (isStructurallyUnsafe(command) || containsShellExpansion(command)) return false;
  let scripts;
  try {
    scripts = extractSedScripts(command);
  } catch {
    return false;
  }
  const ambiguous = sedHasAmbiguousExpressions(command);
  const printing = isPrintingSed(command, scripts);
  const substitution = isSubstitutionSed(command, scripts, ambiguous,
    allowFileWrites ? { allowFileWrites: true } : undefined);
  if (!printing && !substitution) return false;
  for (const script of scripts) {
    if (substitution && script.includes(";")) return false;
    if (sedScriptIsDangerous(script)) return false;
  }
  const inPlaceScript = inPlaceSedScript(command);
  if (inPlaceScript !== null) {
    if (inPlaceScript === MULTIPLE_IN_PLACE_FLAGS || sedScriptIsDangerous(inPlaceScript)) return false;
    const script = inPlaceScript.trimStart();
    if (/^[sy][^a-zA-Z0-9]/.test(script)) return false;
    if (/^[\\$:={]/.test(script)) return false;
    if (/^\d+[ \t]*[,!~=aAcCdDegGhHiIlnNpPqQrRsStTwWxyz]/.test(script)) return false;
    if (/^[aAcCdDgGhHiIlnNpPqQtTwWxz=]([\s\\;]|$)/.test(script)) return false;
    if (/^[rR]([\s\\;/]|\.{1,2}\/|$)/.test(script)) return false;
    if (/^\/(?:[^/\\]|\\.)*\/[IMim]*[ \t]*([aAcCdDgGhHiIlnNpPqQtTwWxz=]([\s\\;]|$)|[rR]([\s\\;/]|\.{1,2}\/|$)|[sy][^a-zA-Z0-9]|[,!~])/.test(script)) return false;
    const relative = script.replace(/^(\.{1,2}\/)+/, "");
    if (script.includes(";") || script.includes("[") || script.includes("\\") || relative.includes("..")) return false;
  }
  return true;
}

function stdbufCommandIndex(argv) {
  let index = 1;
  while (index < argv.length) {
    const arg = argv[index];
    if (/^-[ioe]$/.test(arg) && argv[index + 1]) index += 2;
    else if (/^-[ioe]./.test(arg)) index++;
    else if (/^--(input|output|error)=/.test(arg)) index++;
    else if (arg.startsWith("-")) return -1;
    else break;
  }
  return index > 1 && index < argv.length ? index : -1;
}
function envCommandIndex(argv) {
  let index = 1;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg.includes("=") && !arg.startsWith("-")) index++;
    else if (arg === "-i" || arg === "-0" || arg === "-v") index++;
    else if (arg === "-u" && argv[index + 1]) index += 2;
    else if (arg.startsWith("-")) return -1;
    else break;
  }
  return index < argv.length ? index : -1;
}
const TIMEOUT_SIGNAL = /^[A-Za-z0-9_.+-]+$/;
function timeoutCommandIndex(argv) {
  let index = 1;
  while (index < argv.length) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--foreground" || arg === "--preserve-status" || arg === "--verbose") index++;
    else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) index++;
    else if ((arg === "--kill-after" || arg === "--signal") && next && TIMEOUT_SIGNAL.test(next)) index += 2;
    else if (arg === "--") {
      index++;
      break;
    } else if (arg.startsWith("--")) return -1;
    else if (arg === "-v") index++;
    else if ((arg === "-k" || arg === "-s") && next && TIMEOUT_SIGNAL.test(next)) index += 2;
    else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) index++;
    else if (arg.startsWith("-")) return -1;
    else break;
  }
  return index;
}

/** Upstream Db — peel argv wrappers without guessing across malformed flags. */
function peelArgvWrappers(argv) {
  let result = argv;
  while (true) {
    const basename = result[0]?.replace(/^.*[\\/]/, "");
    const wrapper = ["time", "nohup", "timeout", "nice", "stdbuf", "env", "command"].includes(basename)
      ? basename
      : result[0];
    if (wrapper === "time" || wrapper === "nohup") {
      result = result.slice(result[1] === "--" ? 2 : 1);
    } else if (wrapper === "timeout") {
      const index = timeoutCommandIndex(result);
      if (index < 0 || !result[index] || !/^\d+(?:\.\d+)?[smhd]?$/.test(result[index])) return result;
      result = result.slice(index + 1);
    } else if (wrapper === "nice") {
      if (result[1] === "-n" && result[2] && /^-?\d+$/.test(result[2])) {
        result = result.slice(result[3] === "--" ? 4 : 3);
      } else if (result[1] && /^-\d+$/.test(result[1])) {
        result = result.slice(result[2] === "--" ? 3 : 2);
      } else result = result.slice(result[1] === "--" ? 2 : 1);
    } else if (wrapper === "stdbuf") {
      const index = stdbufCommandIndex(result);
      if (index < 0) return result;
      result = result.slice(index);
    } else if (wrapper === "env") {
      const index = envCommandIndex(result);
      if (index < 0) return result;
      result = result.slice(index);
    } else if (wrapper === "command") {
      let index = 1;
      while (result[index] !== undefined && /^-p+$/.test(result[index])) index++;
      if (result[index] === "--") index++;
      if (index >= result.length || result[index].startsWith("-")) return result;
      result = result.slice(index);
    } else if (result[0] === "builtin") {
      const index = result[1] === "--" ? 2 : 1;
      if (index >= result.length) return result;
      result = result.slice(index);
    } else if (result[0] === "noglob") {
      if (result.length <= 1) return result;
      result = result.slice(1);
    } else return result;
  }
}

const ALLOWLISTED_ENVIRONMENT = new Set([
  "GOEXPERIMENT", "GOOS", "GOARCH", "CGO_ENABLED", "GO111MODULE",
  "RUST_BACKTRACE", "RUST_LOG", "NODE_ENV", "PYTHONUNBUFFERED",
  "PYTHONDONTWRITEBYTECODE", "PYTEST_DISABLE_PLUGIN_AUTOLOAD", "PYTEST_DEBUG",
  "ANTHROPIC_API_KEY", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_TIME",
  "CHARSET", "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR", "TZ",
  "LS_COLORS", "LSCOLORS", "GREP_COLOR", "GREP_COLORS", "GCC_COLORS",
  "TIME_STYLE", "BLOCK_SIZE", "BLOCKSIZE", "COLUMNS", "LINES", "CLICOLOR",
  "CLICOLOR_FORCE", "CI", "DEBIAN_FRONTEND", "GIT_TERMINAL_PROMPT",
]);
function isAllowlistedEnvironmentVariable(name) {
  return ALLOWLISTED_ENVIRONMENT.has(name) || false;
}
function stripCommentLines(command) {
  const lines = command.split("\n").filter((line) => !line.trim().startsWith("#"));
  return lines.length === 0 ? command : lines.join("\n");
}

/** Upstream Ah — normalize textual wrappers before looking for cd or git. */
function normalizeCommandPrefix(command) {
  const wrapperPatterns = [
    /^timeout[ \t]+(?:(?:--(?:foreground|preserve-status|verbose)|--(?:kill-after|signal)=[A-Za-z0-9_.+-]+|--(?:kill-after|signal)[ \t]+[A-Za-z0-9_.+-]+|-v|-[ks][ \t]+[A-Za-z0-9_.+-]+|-[ks][A-Za-z0-9_.+-]+)[ \t]+)*(?:--[ \t]+)?\d+(?:\.\d+)?[smhd]?[ \t]+/,
    /^time[ \t]+(?:--[ \t]+)?/,
    /^nice(?:[ \t]+-n[ \t]+-?\d+|[ \t]+-\d+)?[ \t]+(?:--[ \t]+)?/,
    /^stdbuf(?:[ \t]+-[ioe][LN0-9]+)+[ \t]+(?:--[ \t]+)?/,
    /^nohup[ \t]+(?:--[ \t]+)?/,
    /^command(?:[ \t]+-p+)*(?:[ \t]+--)?[ \t]+(?!-)/,
    /^builtin(?:[ \t]+--)?[ \t]+(?!-)/,
    /^noglob[ \t]+(?!-)/,
  ];
  const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z0-9_./:-]+)[ \t]+/;
  let result = command;
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = stripCommentLines(result);
    const match = result.match(assignment);
    if (match && isAllowlistedEnvironmentVariable(match[1])) result = result.replace(assignment, "");
  }
  function unquoteFirstToken(value) {
    const match = value.match(/^([^\s]+)([\s\S]*)$/);
    if (!match) return value;
    const token = match[1];
    let quote = null;
    let danglingEscape = false;
    let unquoted = "";
    for (let index = 0; index < token.length; index++) {
      const char = token[index];
      danglingEscape = false;
      if (quote === "'") {
        if (char === "'") quote = null;
        else unquoted += char;
      } else if (quote === '"') {
        if (char === "\\") {
          const next = token[index + 1];
          if (next === "$" || next === "`" || next === '"' || next === "\\") {
            unquoted += next;
            index++;
          } else if (next === undefined) danglingEscape = true;
          else unquoted += char;
        } else if (char === '"') quote = null;
        else unquoted += char;
      } else if (char === "\\") {
        const next = token[index + 1];
        if (next === undefined) danglingEscape = true;
        else {
          unquoted += next;
          index++;
        }
      } else if (char === '"' || char === "'") quote = char;
      else unquoted += char;
    }
    return quote !== null || danglingEscape ? value : unquoted + match[2];
  }
  result = unquoteFirstToken(stripCommentLines(result));
  previous = "";
  while (result !== previous) {
    previous = result;
    for (const pattern of wrapperPatterns) {
      result = result.replace(pattern, "");
    }
    if (result !== previous) result = unquoteFirstToken(stripCommentLines(result));
  }
  return result.trim();
}
function isGitCommand(command) {
  if (command.startsWith("git ") || command === "git") return true;
  const argv = commandArgvFromString(normalizeCommandPrefix(command));
  return argv[0] === "git" || (argv[0] === "xargs" && argv.includes("git"));
}
function isCdCommand(command) {
  const name = commandArgvFromString(normalizeCommandPrefix(command))[0];
  return name === "cd" || name === "pushd" || name === "popd" || name === "chdir";
}

const GIT_INTERNAL_PATHS = [/^head$/, /^objects(?:\/|$)/, /^refs(?:\/|$)/, /^hooks(?:\/|$)/];
function isGitInternalPath(path) {
  let normalized = posix.normalize(path.replace(/\/+/g, "/"));
  normalized = normalized.replace(/^\.?\//, "").toLowerCase()
    .replace(/ı/g, "i").replace(/ſ/g, "s");
  return GIT_INTERNAL_PATHS.some((pattern) => pattern.test(normalized));
}
const CREATE_COMMAND_EXCLUSIONS = new Set(["rm", "rmdir", "sed"]);
function createdPaths(command, fileEffectKinds, fileArgumentExtractors) {
  const argv = peelArgvWrappers(commandArgvFromString(command));
  if (argv.length === 0) return [];
  const name = argv[0]?.replace(/[\\'"]/g, "");
  if (!name || !Object.hasOwn(fileEffectKinds, name)) return [];
  const effect = fileEffectKinds[name];
  if ((effect !== "write" && effect !== "create") || CREATE_COMMAND_EXCLUSIONS.has(name)) return [];
  const extract = fileArgumentExtractors[name];
  return extract ? extract(argv.slice(1)) : [];
}
function createsGitInternalPath(command, fileEffectKinds, fileArgumentExtractors) {
  for (const part of splitSubcommands(command)) {
    const trimmed = part.trim();
    const paths = createdPaths(trimmed, fileEffectKinds, fileArgumentExtractors);
    const name = peelArgvWrappers(commandArgvFromString(trimmed))[0]?.replace(/[\\'"]/g, "");
    const copies = name === "cp" || name === "mv";
    const destination = paths.at(-1);
    const destinationIsAncestor = destination !== undefined &&
      (destination === "." || destination === "./" || destination === "" ||
        /^(?:\.\.\/)*\.\.\/?$/.test(destination));
    for (const path of paths) {
      if (isGitInternalPath(path)) return true;
      if (copies && destinationIsAncestor && path !== destination) {
        const basename = path.replace(/\/+$/, "").split("/").pop() ?? "";
        if (isGitInternalPath(basename)) return true;
      }
    }
  }
  for (const { target } of analyzeRedirections(command).redirections) {
    if (isGitInternalPath(target)) return true;
  }
  return false;
}

const READ_REDIRECT_OPERATORS = new Set(["<", "<<", "<&", "<<<"]);
const COMMAND_PREFIX = /^(?:(?:command(?:[ \t]+-p+)*|builtin)(?:[ \t]+--)?|noglob)[ \t]+(?!-)/;
function stripCommandPrefix(command) {
  let result = command;
  while (COMMAND_PREFIX.test(result)) result = result.replace(COMMAND_PREFIX, "");
  return result;
}
function peelCommandBuiltins(argv) {
  let result = argv.slice();
  while (true) {
    if (result[0] === "command") {
      let index = 1;
      while (result[index] !== undefined && /^-p+$/.test(result[index])) index++;
      if (result[index] === "--") index++;
      if (index >= result.length || result[index].startsWith("-")) return result;
      result = result.slice(index);
    } else if (result[0] === "builtin") {
      const index = result[1] === "--" ? 2 : 1;
      if (index >= result.length) return result;
      result = result.slice(index);
    } else if (result[0] === "noglob") {
      if (result.length <= 1) return result;
      result = result.slice(1);
    } else return result;
  }
}

const WINDOWS_FLAG_ASSIGNMENT = /^--?[A-Za-z0-9][\w-]*=/;
const WINDOWS_NT_PATH_IN_COMMAND = /(?:^|[^A-Za-z0-9_])[\\/]\?\?(?:[\\/]|$)/;
const WINDOWS_NT_PATH = /^[\\/]\?\?[\\/]/;
function normalizeWindowsPath(path) {
  return win32 ? win32.normalize(path) : path;
}
function isNtPath(path) {
  return WINDOWS_NT_PATH.test(path) ||
    (path.includes("??") && WINDOWS_NT_PATH.test(normalizeWindowsPath(path)));
}
function isWindowsAbsoluteOrDevicePath(path) {
  return /^[\\/]{2}/.test(path) || isNtPath(path);
}
function containsWindowsUncPath(text, getPlatform, argumentMode = false) {
  if (getPlatform() !== "windows") return false;
  if (argumentMode && isWindowsAbsoluteOrDevicePath(text)) return true;
  if (argumentMode && /^-[A-Za-z0-9]/.test(text)) {
    const suffix = text.replace(/^(?:-[A-Za-z0-9]+)+/, "");
    if (suffix.length > 0 && containsWindowsUncPath(suffix, getPlatform, true)) return true;
  }
  if (argumentMode && WINDOWS_FLAG_ASSIGNMENT.test(text)) {
    let suffix = text;
    while (WINDOWS_FLAG_ASSIGNMENT.test(suffix)) suffix = suffix.slice(suffix.indexOf("=") + 1);
    if (suffix.length > 0 && containsWindowsUncPath(suffix, getPlatform, true)) return true;
  }
  if (/\\\\[^ \t\r\n\f\v\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i.test(text)) return true;
  if (WINDOWS_NT_PATH_IN_COMMAND.test(text)) return true;
  if (/(?<!:)\/\/[^ \t\r\n\f\v\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i.test(text)) return true;
  if ((argumentMode
    ? /(?<![:\w])\/\\{1,}[^ \t\r\n\f\v\\/]+[\\/]/
    : /\/\\{2,}[^ \t\r\n\f\v\\/]/).test(text)) return true;
  if ((argumentMode
    ? /(?<![:\w])\\{1,}\/[^ \t\r\n\f\v\\/]+[\\/]/
    : /\\{2,}\/[^ \t\r\n\f\v\\/]/).test(text)) return true;
  if (/@SSL@\d+/i.test(text) || /@\d+@SSL/i.test(text)) return true;
  if (/DavWWWRoot/i.test(text)) return true;
  if (/^\\\\(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\\/]/.test(text) ||
      /^\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\\/]/.test(text)) return true;
  if (/^\\\\(\[[\da-fA-F:]+\])[\\/]/.test(text) || /^\/\/(\[[\da-fA-F:]+\])[\\/]/.test(text)) return true;
  return false;
}

const FLAG_TOKEN = /^-[a-zA-Z0-9_-]/;
function isFlagToken(value) {
  return value.startsWith("-") && value.length > 1 && FLAG_TOKEN.test(value);
}
function startsWithShellExpansion(value) {
  return value.startsWith(COMMAND_SUBSTITUTION_OUTPUT) || value.startsWith(TRACKED_VARIABLE_OUTPUT);
}
function flagValueMatches(value, kind) {
  switch (kind) {
    case "none": return false;
    case "number": return /^\d+$/.test(value);
    case "string": return true;
    case "char": return value.length === 1;
    case "{}": return value === "{}";
    case "EOF": return value === "EOF";
    default: return false;
  }
}

/** Upstream ELe — validate all flags and positional values against one table row. */
function safeArguments(argv, start, rule, options) {
  let index = start;
  while (index < argv.length) {
    let arg = argv[index];
    if (!arg) {
      index++;
      continue;
    }
    if (
      options?.xargsTargetCommands && options.commandName === "xargs" &&
      (!arg.startsWith("-") || arg === "--")
    ) {
      if (arg === "--" && index + 1 < argv.length) {
        index++;
        arg = argv[index];
      }
      if (arg && options.xargsTargetCommands.includes(arg)) break;
      return false;
    }
    if (arg === "--") {
      if (rule.respectsDoubleDash !== false) {
        index++;
        break;
      }
      index++;
      continue;
    }
    if (isFlagToken(arg)) {
      const inline = arg.includes("=");
      const [flag, ...rest] = arg.split("=");
      const inlineValue = rest.join("=");
      if (!flag) return false;
      const kind = rule.safeFlags[flag];
      if (!kind) {
        if (options?.commandName === "git" && /^-\d+$/.test(flag)) {
          index++;
          continue;
        }
        if (
          ["grep", "egrep", "fgrep", "rg"].includes(options?.commandName) &&
          flag.startsWith("-") && !flag.startsWith("--") && flag.length > 2
        ) {
          const shortFlag = flag.substring(0, 2);
          const attached = flag.substring(2);
          if (rule.safeFlags[shortFlag] && /^\d+$/.test(attached)) {
            const attachedKind = rule.safeFlags[shortFlag];
            if ((attachedKind === "number" || attachedKind === "string") &&
                flagValueMatches(attached, attachedKind)) {
              index++;
              continue;
            }
            return false;
          }
        }
        if (flag.startsWith("-") && !flag.startsWith("--") && flag.length > 2) {
          for (let position = 1; position < flag.length; position++) {
            const shortFlag = `-${flag[position]}`;
            const shortKind = rule.safeFlags[shortFlag];
            if (!shortKind || shortKind !== "none") return false;
          }
          index++;
          continue;
        }
        return false;
      }
      if (kind === "none") {
        if (inline) return false;
        index++;
      } else {
        let value;
        if (inline) {
          value = inlineValue;
          index++;
        } else {
          if (index + 1 >= argv.length || (argv[index + 1] && isFlagToken(argv[index + 1]))) return false;
          value = argv[index + 1] || "";
          index += 2;
        }
        if (startsWithShellExpansion(value)) return false;
        if (kind === "string" && value.startsWith("-")) {
          if (!(flag === "--sort" && options?.commandName === "git" && /^-[a-zA-Z]/.test(value))) return false;
        }
        if (!flagValueMatches(value, kind)) return false;
      }
    } else {
      if (containsShellExpansion(arg)) return false;
      index++;
    }
  }
  return true;
}

const XARGS_TARGET_COMMANDS = ["echo", "printf", "wc", "grep", "egrep", "fgrep", "head", "tail"];
const DOCKER_CONNECTION_FLAGS = [
  "-H", "-c", "-r", "--host", "--context", "--config", "--tlscacert",
  "--tlscert", "--tlskey", "--url", "--connection", "--identity", "--remote",
  "--module", "--out",
];
const DOCKER_CONNECTION_SHORT_FLAGS = new Set(
  DOCKER_CONNECTION_FLAGS.filter((flag) => flag.length === 2).map((flag) => flag[1]),
);
function dockerArgumentsAreDangerous(args) {
  return args.some((arg) => {
    if (DOCKER_CONNECTION_FLAGS.some((flag) =>
      arg === flag || arg.startsWith(`${flag}=`) ||
      (flag.length === 2 && arg.length > 2 && arg.startsWith(flag)))) return true;
    const combined = arg.match(/^-([A-Za-z]+)/)?.[1];
    if (combined !== undefined && combined.length >= 2) {
      for (const flag of combined) {
        if (DOCKER_CONNECTION_SHORT_FLAGS.has(flag)) return true;
      }
    }
    return false;
  });
}

function safeCommandTableForPlatform(table, getPlatform) {
  if (getPlatform() !== "windows") return table;
  const { xargs: _xargs, ...withoutXargs } = table;
  return withoutXargs;
}
function matchesSafeCommandTable(command, table, getPlatform) {
  const argv = commandArgvFromString(command);
  if (argv.length === 0) return false;
  let rule;
  let commandLength = 0;
  const available = safeCommandTableForPlatform(table, getPlatform);
  for (const [key, candidate] of Object.entries(available)) {
    const prefix = key.split(" ");
    if (argv.length < prefix.length) continue;
    let matches = true;
    for (let index = 0; index < prefix.length; index++) {
      if (argv[index] !== prefix[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      rule = candidate;
      commandLength = prefix.length;
      break;
    }
  }
  if (!rule) return false;
  if (argv[0] === "git" && argv[1] === "ls-remote") {
    if (argv.some((arg) =>
      arg === "-o" || arg === "--server-option" || arg.startsWith("--server-option="))) return false;
    let afterDoubleDash = false;
    for (let index = 2; index < argv.length; index++) {
      const arg = argv[index];
      if (!arg) continue;
      if (!afterDoubleDash && arg === "--") {
        afterDoubleDash = true;
        continue;
      }
      if (afterDoubleDash || arg === "-" || !arg.startsWith("-")) return false;
    }
  }
  for (let index = commandLength; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.includes("$")) return false;
    if (arg.includes("{") && (arg.includes(",") || arg.includes(".."))) return false;
  }
  if (!safeArguments(argv, commandLength, rule, {
    commandName: argv[0],
    rawCommand: command,
    xargsTargetCommands: argv[0] === "xargs" ? XARGS_TARGET_COMMANDS : undefined,
  })) return false;
  if (rule.regex && !rule.regex.test(command)) return false;
  if (!rule.regex && /`/.test(command)) return false;
  if (!rule.regex && ["rg", "grep", "egrep", "fgrep"].includes(argv[0]) && /[\n\r]/.test(command)) return false;
  if (rule.additionalCommandIsDangerousCallback &&
      rule.additionalCommandIsDangerousCallback(command, argv.slice(commandLength))) return false;
  return true;
}

const OPTIONAL_MULTIWORD_COMMANDS = ["docker ps", "docker images"];
const SIMPLE_COMMAND_NAMES = [
  ...OPTIONAL_MULTIWORD_COMMANDS,
  "cal", "uptime", "cat", "head", "tail", "wc", "stat", "strings", "hexdump",
  "od", "nl", "id", "uname", "free", "df", "du", "locale", "groups", "nproc",
  "basename", "dirname", "realpath", "cut", "paste", "tr", "column", "tac",
  "rev", "fold", "expand", "unexpand", "fmt", "comm", "cmp", "numfmt",
  "readlink", "diff", "true", "false", "sleep", "which", "type", "expr",
  "seq", "tsort", "pr",
];
const SIMPLE_COMMAND_NAME_SET = new Set(SIMPLE_COMMAND_NAMES);
const MULTIWORD_SIMPLE_COMMANDS = SIMPLE_COMMAND_NAMES.filter((name) => name.includes(" "));
const UNSAFE_FIND_ACTIONS = new Set([
  "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0",
  "-fls", "-fprintf", "-files0-from",
]);
const FIND_FLAGS_WITH_VALUES = new Set([
  "-name", "-iname", "-path", "-ipath", "-lname", "-ilname", "-regex", "-iregex",
  "-wholename", "-iwholename", "-samefile", "-newer", "-anewer", "-cnewer",
  "-mnewer", "-perm", "-user", "-group", "-uid", "-gid", "-size", "-type",
  "-xtype", "-fstype", "-inum", "-links", "-used", "-context", "-amin", "-cmin",
  "-mmin", "-atime", "-ctime", "-mtime", "-mindepth", "-maxdepth", "-printf",
  "-regextype", "-D", "-f", "-flags", "-Bnewer", "-Btime", "-Bmin",
  "-files0-from", "-xattrname",
]);
const FIND_NEWER_FLAG = /^-newer[aBcm][aBcmt]$/;
const NO_ARGUMENT_COMMANDS = new Set(["pwd", "whoami", "alias"]);
const PRINTF_LENGTH_MODIFIERS = "[lLhqjzZt]*";
const PRINTF_CHARACTER_WRITES = new RegExp(`%[^%a-zA-Z]*${PRINTF_LENGTH_MODIFIERS}\\\\[0-7xX]`);
const PRINTF_NUMERIC_FORMATS = new RegExp(`%[-+ 0#']*[0-9.*]*${PRINTF_LENGTH_MODIFIERS}[diouxXeEfFgGaAn]`);
const EXACT_SAFE_ARGV = [
  ["claude", "-h"], ["claude", "--help"], ["node", "-v"],
  ["node", "--version"], ["python", "--version"], ["python3", "--version"],
  ["ip", "addr"],
];
const TEST_NUMERIC_OPERATORS = new Set(["-eq", "-ne", "-lt", "-le", "-gt", "-ge"]);
const SHELL_INTEGER = /^-?(0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[0-9]+)$/;

function classifySimpleArgv(argv) {
  if (argv.length === 0) return false;
  const name = argv[0];
  if (NO_ARGUMENT_COMMANDS.has(name)) return argv.length === 1;
  for (const exact of EXACT_SAFE_ARGV) {
    if (argv.length === exact.length && argv.every((arg, index) => arg === exact[index])) return true;
  }
  if (SIMPLE_COMMAND_NAME_SET.has(name)) return true;
  for (const candidate of MULTIWORD_SIMPLE_COMMANDS) {
    const prefix = candidate.split(" ");
    if (argv.length >= prefix.length && prefix.every((arg, index) => argv[index] === arg)) {
      if (prefix[0] === "docker" &&
          (dockerArgumentsAreDangerous(argv) || argv.slice(prefix.length).some(containsShellExpansion))) return false;
      return true;
    }
  }
  if (name === "echo") return true;
  const numeric = /^[-+]?(0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)$/;
  if (name === "printf") {
    if (argv[1]?.startsWith("-") && argv[1] !== "--") return false;
    const formatIndex = argv[1] === "--" ? 2 : 1;
    const format = argv[formatIndex] ?? "";
    if (containsShellExpansion(format) || format.includes("$")) return false;
    const unescapedPercents = format.replace(/%%/g, "");
    if (PRINTF_CHARACTER_WRITES.test(unescapedPercents) || /\\[uU]/.test(unescapedPercents)) return false;
    if (PRINTF_NUMERIC_FORMATS.test(unescapedPercents) || /%[^%a-zA-Z]*\*/.test(unescapedPercents)) {
      for (let index = formatIndex + 1; index < argv.length; index++) {
        const arg = argv[index];
        if (arg.includes("[") || arg.includes("`") || arg.includes("$(") ||
            containsShellExpansion(arg) || !numeric.test(arg)) return false;
      }
    }
    return true;
  }
  if (name === "[[") {
    for (let index = 1; index < argv.length; index++) {
      const arg = argv[index];
      const next = argv[index + 1];
      if ((arg === "-v" || arg === "-R" || arg === "-t") && next !== undefined &&
          (next.includes("[") || containsShellExpansion(next))) return false;
      if (arg === "-t" && next !== undefined && !SHELL_INTEGER.test(next)) return false;
      if (TEST_NUMERIC_OPERATORS.has(arg)) {
        for (const operand of [argv[index - 1], argv[index + 1]]) {
          if (operand !== undefined && (operand.includes("[") || !SHELL_INTEGER.test(operand))) return false;
        }
      }
    }
    return true;
  }
  if (name === "ls") return true;
  if (name === "cd") return argv.length <= 2;
  if (name === "find") {
    for (let index = 1; index < argv.length; index++) {
      const arg = argv[index];
      if (UNSAFE_FIND_ACTIONS.has(arg)) return false;
      if (FIND_FLAGS_WITH_VALUES.has(arg) || FIND_NEWER_FLAG.test(arg)) {
        index++;
        continue;
      }
      if (containsShellExpansion(arg)) return false;
    }
    return true;
  }
  if (name === "history") return argv.length === 1 || (argv.length === 2 && /^\d+$/.test(argv[1]));
  if (name === "arch") return argv.length === 1 || (argv.length === 2 && (argv[1] === "-h" || argv[1] === "--help"));
  if (name === "ifconfig") return argv.length === 1 || (argv.length === 2 && /^[a-zA-Z]/.test(argv[1]));
  return null;
}

function literalCommandPattern(name) {
  return new RegExp("^" + name + "(?:\\s|$)[^<>()$`|{}&;\\n\\r]*$");
}
const LITERAL_COMMAND_PATTERNS = [
  ...SIMPLE_COMMAND_NAMES.map(literalCommandPattern),
  /^echo(?:\s+(?:'[^']*'|"[^"$<>\n\r]*"|[^|;&`$(){}><#\\!"'\s]+))*(?:\s+2>&1)?\s*$/,
  /^claude -h$/, /^claude --help$/,
  /^uniq(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?|-[fsw]\s+\d+))*(?:\s|$)\s*$/,
  /^pwd$/, /^whoami$/, /^node -v$/, /^node --version$/, /^python --version$/,
  /^python3 --version$/, /^history(?:\s+\d+)?\s*$/, /^alias$/,
  /^arch(?:\s+(?:--help|-h))?\s*$/, /^ip addr$/,
  /^ifconfig(?:\s+[a-zA-Z][a-zA-Z0-9_-]*)?\s*$/,
  /^jq(?!.*(?:\s['"]?-[a-zA-Z]*[fL]|--from-file|--rawfile|--slurpfile|--run-tests|--library-path|\benv\b|\$ENV\b|\binclude\b|\bimport\b))(?:\s+(?:-[a-zA-Z]+|--[a-zA-Z-]+(?:=\S+)?))*(?:\s+'[^'`]*'|\s+"[^"`]*"|\s+[^-\s'"][^\s]*)+\s*$/,
  /^cd(?:\s+(?:'[^']*'|"[^"]*"|[^\s;|&`$(){}><#\\]+))?$/,
  /^ls(?:\s+[^<>()$`|{}&;\n\r]*)?$/,
  /^find(?:\s+(?:\\[()]|(?!-delete\b|-exec\b|-execdir\b|-ok\b|-okdir\b|-fprint0?\b|-fls\b|-fprintf\b|-files0-from\b)[^<>()$`|{}&;\n\r\s]|\s)+)?$/,
];

function shellExpansionKind(command) {
  let singleQuoted = false;
  let doubleQuoted = false;
  let backtick = false;
  let escaped = false;
  let hasGlob = false;
  let bracket = false;
  let commandPosition = true;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      commandPosition = false;
      continue;
    }
    if (char === "\\" && !singleQuoted) {
      if (command[index + 1] === "\n") {
        index++;
        continue;
      }
      escaped = true;
      continue;
    }
    if (backtick) {
      if (char === "`") {
        backtick = false;
        commandPosition = false;
      }
      continue;
    }
    if (char === "`" && !singleQuoted) {
      backtick = true;
      commandPosition = false;
      continue;
    }
    if (char === "#" && commandPosition && !singleQuoted && !doubleQuoted) {
      while (index < command.length && command[index] !== "\n") index++;
      commandPosition = true;
      continue;
    }
    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      commandPosition = false;
      continue;
    }
    if (char === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      commandPosition = false;
      continue;
    }
    if (singleQuoted) continue;
    if (char === "$") {
      const next = command[index + 1];
      if (next && /[A-Za-z_@*#?!$0-9-]/.test(next)) return "variable";
    }
    if (doubleQuoted) continue;
    if ([" ", "\t", "\n", "|", "&", ";", "(", ")", "<", ">"].includes(char)) {
      bracket = false;
      commandPosition = true;
      continue;
    }
    commandPosition = false;
    if (char === "?" || char === "*") {
      hasGlob = true;
      continue;
    }
    if (char === "[") {
      bracket = true;
      continue;
    }
    if (char === "]" && bracket) hasGlob = true;
  }
  return hasGlob ? "glob" : false;
}
const GLOB_SAFE_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "stat", "grep", "egrep", "fgrep",
  "diff", "du", "df", "echo", "strings", "hexdump", "od", "nl", "cut",
  "column", "tr", "tac", "rev", "cmp", "basename", "dirname", "realpath",
  "readlink", "sha256sum", "sha1sum", "md5sum", "cd",
]);
function isReadOnlyCommandText(command, safeTable, getPlatform) {
  let text = command.trim();
  if (text.endsWith(" 2>&1")) text = text.slice(0, -5).trim();
  if (containsWindowsUncPath(text, getPlatform)) return false;
  if (shellExpansionKind(text) === "variable") return false;
  if (matchesSafeCommandTable(text, safeTable, getPlatform)) return true;
  for (const pattern of LITERAL_COMMAND_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (text.startsWith("find")) {
      const unquoted = text.replace(/['"\\]/g, "");
      if (/-delete\b|-exec\b|-execdir\b|-ok\b|-okdir\b|-fprint0?\b|-fls\b|-fprintf\b|-files0-from\b/.test(unquoted)) return false;
    }
    if (text.includes("git") && /\s-c[\s=]/.test(text)) return false;
    if (text.includes("git") && /\s--exec-path[\s=]/.test(text)) return false;
    if (text.includes("git") && /\s--config-env[\s=]/.test(text)) return false;
    return true;
  }
  return false;
}

function containsSubshell(node) {
  if (node.type === "subshell" || node.type === "compound_statement") return true;
  for (const child of node.children) {
    if (child && containsSubshell(child)) return true;
  }
  return false;
}
const BACKGROUND_CONTAINERS = new Set(["program", "list", "pipeline", "redirected_statement"]);
function containsBackgroundOperator(node) {
  if (!BACKGROUND_CONTAINERS.has(node.type)) return false;
  for (const child of node.children) {
    if (!child) continue;
    if (child.type === "&" || containsBackgroundOperator(child)) return true;
  }
  return false;
}

/**
 * Bind the pure classifier to the runtime reads `_8e` performed through graph
 * captures. The returned function has the pinned public call shape.
 *
 * @param {ReadOnlyPorts} runtime
 * @returns {(input:BashInput, hasCd:boolean) =>
 *   {behavior:"allow",updatedInput:BashInput} |
 *   {behavior:"ask"|"passthrough",message:string}}
 */
export function createReadOnlyClassifier(runtime) {
  const classifyCommand = createCommandClassifier(
    runtime.isSubprocessEnvironmentScrubbingEnabled,
  );
  const {
    pL: fileArgumentExtractors,
    DP: fileEffectKinds,
    Bnn: safeCommandTable,
  } = createBashSafetyTables({
    homeDirectory: runtime.getHomeDirectory,
    isSedReadOnly,
  });

  return function classifyReadOnly(input, hasCd) {
    const { command } = input;
    if (command.length > MAX_COMMAND_LENGTH) {
      return { behavior: "passthrough", message: "Command too long for read-only analysis" };
    }
    const tree = getParser().parse(command);
    const analysis = tree
      ? classifyCommand(command, tree)
      : { kind: "simple", commands: [], bareAssignmentNames: [] };
    if (analysis.kind === "too-complex") {
      return {
        behavior: "passthrough",
        message: `Not a simple read-only command: ${analysis.reason}`,
      };
    }
    if (tree && containsSubshell(tree)) {
      return { behavior: "passthrough", message: "Not a simple read-only command: contains a subshell" };
    }
    if (tree && containsBackgroundOperator(tree)) {
      return {
        behavior: "passthrough",
        message: "Not a simple read-only command: `&` defers execution past approval-time checks",
      };
    }
    const spawnEnvironmentKeys = runtime.getSpawnEnvironmentKeys();
    if (analysis.bareAssignmentNames.some((name) =>
      !isAllowlistedEnvironmentVariable(name) &&
      (spawnEnvironmentKeys === null || spawnEnvironmentKeys.has(name)))) {
      return {
        behavior: "passthrough",
        message: "Bare assignment to a non-allowlisted environment variable can alter behavior of subsequent commands",
      };
    }
    const wholeCommandExpansion = shellExpansionKind(command);
    if (wholeCommandExpansion === "variable") {
      return { behavior: "passthrough", message: "Command contains unquoted variable expansion" };
    }
    if (containsWindowsUncPath(command, runtime.getPlatform)) {
      return {
        behavior: "ask",
        message: "Command contains Windows UNC path that could be vulnerable to WebDAV attacks",
      };
    }
    const hasGit = analysis.commands.some((entry) => isGitCommand(entry.text));
    if ((hasCd || analysis.commands.some((entry) => isCdCommand(entry.text))) && hasGit) {
      return {
        behavior: "passthrough",
        message: "Compound commands with cd and git require permission checks for enhanced security",
      };
    }
    const gitCwdRisk = hasGit && runtime.inspectGitWorkingDirectory();
    if (gitCwdRisk) {
      return {
        behavior: "passthrough",
        message: gitCwdRisk === "bare-indicators"
          ? "The current directory has bare-repo indicators (HEAD/objects/refs outside a .git/ directory). Git may treat it as a git dir and run config/hooks from here, so git commands need approval."
          : "The .git file or symlink here redirects to a location Claude cannot verify is safe (it may have been planted by an untrusted archive). Git commands need approval.",
      };
    }
    if (hasGit && createsGitInternalPath(command, fileEffectKinds, fileArgumentExtractors)) {
      return {
        behavior: "passthrough",
        message: "Compound commands that create git internal files and run git require permission checks for enhanced security",
      };
    }
    if (
      hasGit && runtime.isSandboxingEnabled() &&
      runtime.getCurrentWorkingDirectory() !== runtime.getOriginalWorkingDirectory()
    ) {
      return {
        behavior: "passthrough",
        message: "Git commands outside the original working directory require permission checks when sandbox is enabled",
      };
    }
    if (analysis.commands.length > 0 && analysis.commands.every((entry) => {
      if (entry.redirects.some((redirect) =>
        !READ_REDIRECT_OPERATORS.has(redirect.op) &&
        redirect.target !== "/dev/null" &&
        !(redirect.op === ">&" && /^\d+$/.test(redirect.target)))) return false;
      if (entry.redirects.some((redirect) => /^\/dev\/(tcp|udp)\//.test(redirect.target))) return false;
      if (entry.redirects.some((redirect) =>
        redirect.op === "<" && containsWindowsUncPath(redirect.target, runtime.getPlatform, true))) return false;
      if (runtime.getPlatform() === "windows" && entry.redirects.some((redirect) =>
        redirect.op === "<" && /(?<![:\w])[\\/]{2,}[^ \t\r\n\f\v\\/]/.test(redirect.target))) return false;
      if (entry.envVars.some((assignment) => !isAllowlistedEnvironmentVariable(assignment.name))) return false;
      if (entry.argv.some((arg) => containsWindowsUncPath(arg, runtime.getPlatform, true))) return false;
      if (runtime.getPlatform() === "windows" && entry.argv.some((arg) =>
        /(?<![:\w])[\\/]{2,}[^ \t\r\n\f\v\\/]/.test(arg))) return false;
      const argv = peelCommandBuiltins(entry.argv);
      if (
        shellExpansionKind(entry.text) === "glob" ||
        (wholeCommandExpansion === "glob" && entry.argv.some((arg) => /[*?]|\[.*\]/.test(arg)))
      ) return GLOB_SAFE_COMMANDS.has(argv[0] ?? "");
      const simple = classifySimpleArgv(argv);
      if (simple !== null) return simple;
      return isReadOnlyCommandText(stripCommandPrefix(entry.text), safeCommandTable, runtime.getPlatform);
    })) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "passthrough",
      message: "Command is not read-only, requires further permission checks",
    };
  };
}
