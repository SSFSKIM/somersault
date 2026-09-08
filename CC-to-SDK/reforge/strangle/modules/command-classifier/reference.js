// PARITY LAYER (§2.5 `reference`) — the pinned command classifier core.
//
// Upstream `KTe` @112426-114161 in Claude Code 2.1.251 classifies one bash
// command and its C13a parse result. This isolated unit owns exactly KTe's
// transitive pure closure in chunk-9e2ns8ty.js: 86 declarations, of which 78
// begin inside the scout range @108945-162000 and eight lie just beyond it.
// The subprocess-environment scrub gate (`bu`) is the one non-pure imported
// dependency and remains an injected port. Native `homedir` stays native.
//
// PARSE_ABORTED IS IDENTITY, NOT A VALUE. It is imported from C13a's owned
// parser; this module must never construct a same-description replacement.
// Callers likewise pass the tree returned by C13a's parseOrAbort. KTe does not
// import C13a's commandArgv at this pin: its `commands[].argv` is a richer
// abstract evaluation that tracks substitutions and shell-variable state. The
// local static-word reader below serves only that tracking walk; it does not
// replace commandArgv's positional-prefix contract.
//
// The declarations remain inside a factory so the scrub gate is captured once
// without mutable module-global state. The returned classifier is synchronous.
import { homedir } from "node:os";
import { PARSE_ABORTED } from "../shell-parser/reference.js";

/**
 * @typedef {object} ShellNode
 * @property {string} type
 * @property {string} text
 * @property {number} startIndex UTF-8 byte offset, not a UTF-16 index
 * @property {number} endIndex UTF-8 byte offset, not a UTF-16 index
 * @property {(ShellNode | null)[]} children
 */

/** @typedef {{name: string, value: string}} EnvironmentAssignment */
/** @typedef {{op: string, target: string, fd?: number}} Redirect */
/**
 * @typedef {object} ClassifiedCommand
 * @property {string[]} argv
 * @property {EnvironmentAssignment[]} envVars
 * @property {Redirect[]} redirects
 * @property {string} text
 * @property {boolean} hasUnquotedGlob
 */
/** @typedef {{kind: "simple", commands: ClassifiedCommand[], bareAssignmentNames: string[]}} SimpleResult */
/** @typedef {{kind: "too-complex", reason: string, differential?: boolean, nodeType?: string}} TooComplexResult */
/** @typedef {SimpleResult | TooComplexResult} ClassifierResult */

/**
 * Bind the classifier to the external subprocess-environment scrub gate.
 * Upstream consults this gate while deciding whether loops and expansion-led
 * command names are statically modelable.
 *
 * @param {() => boolean} isSubprocessEnvironmentScrubbingEnabled
 * @returns {(command: string, parsed: ShellNode | symbol | null) => ClassifierResult}
 */
export function createCommandClassifier(
  isSubprocessEnvironmentScrubbingEnabled,
) {
  const subprocessEnvironmentScrubbingEnabled =
    isSubprocessEnvironmentScrubbingEnabled;

  // upstream er @ 108979-109043
  const CONTAINER_NODE_TYPES = new Set([
    "program",
    "list",
    "pipeline",
    "redirected_statement",
  ]);

  // upstream Yt @ 109044-109088
  const SHELL_OPERATOR_TYPES = new Set([
    "&&",
    "||",
    "|",
    ";",
    "&",
    "|&",
    `
`,
  ]);

  // upstream Co @ 109089-109186
  const COMMAND_WRAPPER_NODE_TYPES = new Set([
    "command",
    "pipeline",
    "list",
    "negated_command",
    "declaration_command",
    "unset_command",
  ]);

  // upstream xa @ 109187-109238
  const REDIRECT_AUXILIARY_NODE_TYPES = new Set([
    "test_command",
    "redirected_statement",
  ]);

  // upstream Me @ 109239-109261
  const COMMAND_SUBSTITUTION_VALUE = "__CMDSUB_OUTPUT__";

  // upstream z @ 109262-109281
  const UNKNOWN_TRACKED_VALUE = "__TRACKED_VAR__";

  // upstream Qa @ 109282-109334
  function hasUnknownTrackedValue(trackedValue) {
    return (
      trackedValue.includes(COMMAND_SUBSTITUTION_VALUE) ||
      trackedValue.includes(UNKNOWN_TRACKED_VALUE)
    );
  }

  // upstream ko @ 109471-109486
  const UNSAFE_UNQUOTED_VALUE_PATTERN = /[ \t\n*?[]/;

  // upstream Fn @ 109545-109730
  const INHERITED_SHELL_VARIABLES = new Set([
    "HOME",
    "PWD",
    "OLDPWD",
    "USER",
    "LOGNAME",
    "SHELL",
    "PATH",
    "HOSTNAME",
    "UID",
    "EUID",
    "PPID",
    "RANDOM",
    "SECONDS",
    "LINENO",
    "TMPDIR",
    "BASH_VERSION",
    "BASHPID",
    "SHLVL",
    "HISTFILE",
    "IFS",
  ]);

  // upstream Pa @ 109731-109768
  const SAFE_SPECIAL_PARAMETERS = new Set(["?", "$", "!", "#", "0", "-"]);

  // upstream $o @ 109769-110108
  const DYNAMIC_SHELL_NODE_TYPES = new Set([
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
  ]);

  // upstream Wn @ 110217-110311
  const REDIRECT_OPERATOR_MAP = {
    ">": ">",
    ">>": ">>",
    "<": "<",
    ">&": ">&",
    "<&": "<&",
    ">|": ">|",
    "&>": "&>",
    "&>>": "&>>",
    "<<<": "<<<",
  };

  // upstream jn @ 110312-110341
  const BRACE_EXPANSION_PATTERN = /\{[^\s]*(,|\.\.)[^\s]*\}/;

  // upstream Un @ 110342-110357
  const ESCAPED_BRACE_CLOSE_PATTERN = /\{[^{]*\\}/;

  // upstream zn @ 110358-110374
  const ESCAPED_BRACE_OPEN_PATTERN = /\{[^}]*\\\{/;

  // upstream Qhn @ 110375-110405
  const CONTROL_CHARACTER_PATTERN = /[\x00-\x08\x0B-\x1F\x7F]/;

  // upstream Zhn @ 110406-110482
  const LONE_SURROGATE_PATTERN =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  // upstream Ta @ 110483-110551
  const UNICODE_WHITESPACE_PATTERN =
    /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/;

  // upstream e_n @ 110552-110612
  const ESCAPED_WHITESPACE_PATTERN =
    /\\[ \t]|(?:^|[^ \t\\])(?:\\\\)*\\\n|[ \t](?:\\\\)+\\\n/;

  // upstream t_n @ 110613-110643
  const UNESCAPED_EXPANSION_SIGIL_PATTERN = /(?:^|[^\\])(?:\\\\)*[`$]/;

  // upstream n_n @ 110644-110674
  const UNESCAPED_QUOTE_PATTERN = /(?:^|[^\\])(?:\\\\)*['"]/;

  // upstream aWt @ 110675-110684
  const ZSH_DYNAMIC_DIRECTORY_PATTERN = /~\[/;

  // upstream lWt @ 110685-110714
  const ZSH_EQUALS_EXPANSION_PATTERN = /(?:^|[\s;&|])=[a-zA-Z_]/;

  // upstream r_n @ 110715-110730
  const ZSH_NUMERIC_RANGE_GLOB_PATTERN = /<\d*-\d*>/;

  // upstream Ma @ 110731-110747
  const BRACE_WITH_QUOTE_PATTERN = /\{[^}]*['"]/;

  // upstream Ve @ 110748-111397
  /** Return whether `*`, `?` or `[` occurs outside shell quoting/comments. */
  function hasUnquotedGlob(source) {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBackticks = false;
    let canStartComment = true;
    let index = 0;
    while (index < source.length) {
      const character = source[index];
      if (inBackticks) {
        if (
          character === "\\" &&
          (source[index + 1] === "`" ||
            source[index + 1] === "\\" ||
            source[index + 1] === "$")
        )
          index += 2;
        else {
          if (character === "`") inBackticks = false;
          index++;
        }
      } else if (inSingleQuote) {
        if (character === "'") inSingleQuote = false;
        index++;
      } else if (inDoubleQuote) {
        if (
          character === "\\" &&
          (source[index + 1] === '"' ||
            source[index + 1] === "\\" ||
            source[index + 1] === "`")
        )
          index += 2;
        else if (character === "`") {
          inBackticks = true;
          index++;
        } else {
          if (character === '"') inDoubleQuote = false;
          index++;
        }
      } else if (character === "\\" && index + 1 < source.length) {
        if (source[index + 1] !== "\n") canStartComment = false;
        index += 2;
      } else if (character === "#" && canStartComment) {
        while (index < source.length && source[index] !== "\n") index++;
        canStartComment = true;
      } else if (character === "`") {
        inBackticks = true;
        canStartComment = false;
        index++;
      } else {
        if (character === "*" || character === "?" || character === "[")
          return true;
        if (character === "'") inSingleQuote = true;
        else if (character === '"') inDoubleQuote = true;
        canStartComment =
          character === " " ||
          character === "\t" ||
          character === "\n" ||
          character === ";" ||
          character === "|" ||
          character === "&" ||
          character === "(" ||
          character === ")" ||
          character === "<" ||
          character === ">";
        index++;
      }
    }
    return false;
  }

  // upstream Ia @ 111397-112211
  /**
   * Replace opening braces inside quotes and backticks with spaces. Comment
   * bytes remain unchanged so KTe's brace-with-quote guard matches upstream.
   */
  function maskProtectedOpeningBraces(source) {
    if (!source.includes("{")) return source;
    const masked = [];
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBackticks = false;
    let canStartComment = true;
    let index = 0;
    while (index < source.length) {
      const character = source[index];
      if (inBackticks) {
        if (
          character === "\\" &&
          (source[index + 1] === "`" ||
            source[index + 1] === "\\" ||
            source[index + 1] === "$")
        ) {
          masked.push(character, source[index + 1]);
          index += 2;
        } else {
          if (character === "`") inBackticks = false;
          masked.push(character === "{" ? " " : character);
          index++;
        }
      } else if (inSingleQuote) {
        if (character === "'") inSingleQuote = false;
        masked.push(character === "{" ? " " : character);
        index++;
      } else if (inDoubleQuote) {
        if (
          character === "\\" &&
          (source[index + 1] === '"' ||
            source[index + 1] === "\\" ||
            source[index + 1] === "`")
        ) {
          masked.push(character, source[index + 1]);
          index += 2;
        } else if (character === "`") {
          inBackticks = true;
          masked.push(character);
          index++;
        } else {
          if (character === '"') inDoubleQuote = false;
          masked.push(character === "{" ? " " : character);
          index++;
        }
      } else if (character === "\\" && index + 1 < source.length) {
        masked.push(character, source[index + 1]);
        if (source[index + 1] !== "\n") canStartComment = false;
        index += 2;
      } else if (character === "#" && canStartComment) {
        while (index < source.length && source[index] !== "\n") {
          masked.push(source[index]);
          index++;
        }
        canStartComment = true;
      } else if (character === "`") {
        inBackticks = true;
        canStartComment = false;
        masked.push(character);
        index++;
      } else {
        if (character === "'") inSingleQuote = true;
        else if (character === '"') inDoubleQuote = true;
        canStartComment =
          character === " " ||
          character === "\t" ||
          character === "\n" ||
          character === ";" ||
          character === "|" ||
          character === "&" ||
          character === "(" ||
          character === ")" ||
          character === "<" ||
          character === ">";
        masked.push(character);
        index++;
      }
    }
    return masked.join("");
  }

  // upstream Eo @ 112215-112241
  const DOLLAR_SIGN = String.fromCharCode(36);

  // upstream KTe @ 112426-114161
  /**
   * Classify one command from the source text and C13a parse result.
   *
   * The order is observable: byte-level bash/zsh ambiguities win before the
   * parser-abort sentinel, source-coverage gaps win before AST analysis, and an
   * expansion-shaped ERROR node rewrites the final nodeType only at the end.
   */
  function classifyCommand(command, parsed) {
    if (LONE_SURROGATE_PATTERN.test(command))
      return {
        kind: "too-complex",
        reason: "Contains lone surrogate",
        differential: true,
      };
    if (CONTROL_CHARACTER_PATTERN.test(command))
      return {
        kind: "too-complex",
        reason: "Contains control characters",
        differential: true,
      };
    if (UNICODE_WHITESPACE_PATTERN.test(command))
      return {
        kind: "too-complex",
        reason: "Contains Unicode whitespace",
        differential: true,
      };
    if (ESCAPED_WHITESPACE_PATTERN.test(command))
      return {
        kind: "too-complex",
        reason: "Contains backslash-escaped whitespace",
        differential: true,
      };
    if (ZSH_DYNAMIC_DIRECTORY_PATTERN.test(command))
      return {
        kind: "too-complex",
        reason: "Contains zsh ~[ dynamic directory syntax",
        differential: true,
      };
    if (ZSH_EQUALS_EXPANSION_PATTERN.test(command))
      return {
        kind: "too-complex",
        reason: "Contains zsh =cmd equals expansion",
        differential: true,
      };
    if (ZSH_NUMERIC_RANGE_GLOB_PATTERN.test(command))
      return {
        kind: "too-complex",
        reason: "Contains zsh <N-M> numeric-range glob",
        differential: true,
      };
    if (BRACE_WITH_QUOTE_PATTERN.test(maskProtectedOpeningBraces(command)))
      return {
        kind: "too-complex",
        reason: "Contains brace with quote character (expansion obfuscation)",
        differential: true,
      };
    if (command.trim() === "")
      return { kind: "simple", commands: [], bareAssignmentNames: [] };
    if (parsed === PARSE_ABORTED)
      return {
        kind: "too-complex",
        reason: "Parser aborted (timeout, resource limit, or over-length)",
        nodeType: "PARSE_ABORT",
      };

    const commandBytes = Buffer.from(command, "utf8");
    const isIgnorableTopLevelByte = (byte) =>
      byte === 32 ||
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      byte === 59 ||
      byte === 38;
    const skipIgnorableTopLevelBytes = (from, limit) => {
      let cursor = from;
      while (cursor < limit) {
        const byte = commandBytes[cursor];
        if (isIgnorableTopLevelByte(byte)) cursor++;
        else if (
          byte === 92 &&
          (commandBytes[cursor + 1] === 10 ||
            (commandBytes[cursor + 1] === 13 &&
              commandBytes[cursor + 2] === 10))
        )
          cursor += commandBytes[cursor + 1] === 13 ? 3 : 2;
        else break;
      }
      return cursor;
    };
    const topLevelRanges = parsed.children
      .filter((child) => child !== null)
      .map((child) => [child.startIndex, child.endIndex])
      .sort((left, right) => left[0] - right[0]);
    let consumedThrough = 0;
    for (const [startIndex, endIndex] of topLevelRanges) {
      if (skipIgnorableTopLevelBytes(consumedThrough, startIndex) < startIndex)
        return {
          kind: "too-complex",
          reason: "Parser skipped input between top-level statements",
        };
      if (endIndex > consumedThrough) consumedThrough = endIndex;
    }
    if (
      skipIgnorableTopLevelBytes(consumedThrough, commandBytes.length) <
      commandBytes.length
    )
      return {
        kind: "too-complex",
        reason: "Parser did not consume trailing input",
      };

    const redirectFailure = findInvalidRedirect(parsed);
    if (redirectFailure) return redirectFailure;

    const result = analyzeCommandTree(parsed);
    if (
      result.kind === "too-complex" &&
      result.nodeType !== "ERROR" &&
      containsExpansionErrorNode(parsed)
    )
      return { ...result, nodeType: "ERROR" };
    return result;
  }

  // upstream Oo @ 114161-114284
  function containsExpansionErrorNode(node) {
    if (node.type === "ERROR" && node.text.startsWith("${")) return !0;
    for (let child of node.children) {
      if (child && containsExpansionErrorNode(child)) return !0;
    }
    return !1;
  }

  // upstream Ca @ 114284-114432
  function analyzeCommandTree(root) {
    let ambiguity = detectAdjacentStatementAmbiguity(root);
    if (ambiguity) return ambiguity;
    let commands = [],
      trackedVariables = new Map(),
      bareAssignmentNames = [],
      failure = analyzeNode(
        root,
        commands,
        trackedVariables,
        bareAssignmentNames,
      );
    if (failure) return failure;
    return {
      kind: "simple",
      commands: commands,
      bareAssignmentNames: bareAssignmentNames,
    };
  }

  // upstream Da @ 114432-114599
  function isSameLogicalLine(container, leftNode, rightNode) {
    return !Buffer.from(container.text, "utf8")
      .subarray(
        leftNode.endIndex - container.startIndex,
        rightNode.startIndex - container.startIndex,
      )
      .toString("utf8")
      .replace(/\\\r?\n/g, "").includes(`
`);
  }

  // upstream $a @ 114603-114911
  const STATEMENT_NODE_TYPES = new Set([
    "command",
    "variable_assignment",
    "variable_assignments",
    "list",
    "pipeline",
    "redirected_statement",
    "negated_command",
    "declaration_command",
    "unset_command",
    "test_command",
    "subshell",
    "compound_statement",
    "if_statement",
    "while_statement",
    "for_statement",
    "case_statement",
    "function_definition",
    "ERROR",
  ]);

  // upstream Oa @ 114912-114992
  const ADJACENT_KEYWORD_STATEMENT_TYPES = new Set([
    "negated_command",
    "if_statement",
    "while_statement",
    "for_statement",
  ]);

  // upstream No @ 114993-115493
  function detectAdjacentStatementAmbiguity(node) {
    let previousStatement = null;
    for (let child of node.children) {
      if (!child) continue;
      if (STATEMENT_NODE_TYPES.has(child.type)) {
        if (previousStatement !== null) {
          let currentStatement = child;
          while (CONTAINER_NODE_TYPES.has(currentStatement.type)) {
            let firstChild = currentStatement.children.find(
              (candidate) => candidate != null,
            );
            if (!firstChild) break;
            currentStatement = firstChild;
          }
          if (
            ADJACENT_KEYWORD_STATEMENT_TYPES.has(currentStatement.type) &&
            isSameLogicalLine(node, previousStatement, currentStatement)
          )
            return {
              kind: "too-complex",
              reason:
                "statement directly follows another statement on the same line \u2014 bash reads the text as one command (`!` and shell keywords are plain words after an assignment), not two statements",
              differential: !0,
            };
        }
        previousStatement = child;
      } else previousStatement = null;
      let ambiguity = detectAdjacentStatementAmbiguity(child);
      if (ambiguity) return ambiguity;
    }
    return null;
  }

  // upstream ge @ 115493-125462
  function analyzeNode(node, commands, trackedVariables, bareAssignmentNames) {
    if (node.type === "command") {
      let result = analyzeSimpleCommand(
        node,
        [],
        commands,
        trackedVariables,
        bareAssignmentNames,
      );
      if (result.kind !== "simple") return result;
      return (commands.push(...result.commands), null);
    }
    if (node.type === "redirected_statement")
      return analyzeRedirectedStatement(
        node,
        commands,
        trackedVariables,
        bareAssignmentNames,
      );
    if (node.type === "comment") return null;
    if (CONTAINER_NODE_TYPES.has(node.type)) {
      let isPipeline = node.type === "pipeline",
        commandCountBefore = commands.length,
        hasBranchingOperator = !1;
      if (!isPipeline) {
        for (let child of node.children) {
          if (child && (child.type === "||" || child.type === "&")) {
            hasBranchingOperator = !0;
            break;
          }
        }
      }
      let baselineVariables = hasBranchingOperator
          ? new Map(trackedVariables)
          : null,
        activeVariables = isPipeline
          ? new Map(trackedVariables)
          : trackedVariables,
        pendingOrVariables = null;
      for (let child of node.children) {
        if (!child) continue;
        if (SHELL_OPERATOR_TYPES.has(child.type)) {
          if (
            child.type === "||" ||
            child.type === "|" ||
            child.type === "|&" ||
            child.type === "&"
          )
            if (child.type === "||") {
              pendingOrVariables ??= new Set();
              for (let variableName of trackedVariables.keys()) {
                pendingOrVariables.add(variableName);
              }
              let branchBaseVariables = baselineVariables ?? trackedVariables;
              activeVariables = new Map(branchBaseVariables);
              for (let [variableName, trackedValue] of trackedVariables) {
                if (branchBaseVariables.get(variableName) !== trackedValue)
                  activeVariables.set(variableName, UNKNOWN_TRACKED_VALUE);
              }
              for (let variableName of branchBaseVariables.keys()) {
                if (!trackedVariables.has(variableName))
                  activeVariables.set(variableName, UNKNOWN_TRACKED_VALUE);
              }
            } else
              activeVariables = new Map(baselineVariables ?? trackedVariables);
          else if (pendingOrVariables !== null) {
            for (let variableName of pendingOrVariables) {
              trackedVariables.set(variableName, UNKNOWN_TRACKED_VALUE);
            }
            ((pendingOrVariables = null), (activeVariables = trackedVariables));
          }
          continue;
        }
        let failure = analyzeNode(
          child,
          commands,
          activeVariables,
          bareAssignmentNames,
        );
        if (failure) return failure;
      }
      if (pendingOrVariables !== null)
        for (let variableName of pendingOrVariables) {
          trackedVariables.set(variableName, UNKNOWN_TRACKED_VALUE);
        }
      if (isPipeline) {
        if (
          (mergeTrackedVariables(trackedVariables, activeVariables),
          commands.length === commandCountBefore)
        )
          appendNoopCommand(commands, node);
      }
      return null;
    }
    if (node.type === "negated_command") {
      let commandCountBefore = commands.length;
      for (let child of node.children) {
        if (!child) continue;
        if (child.type === "!") continue;
        let failure = analyzeNode(
          child,
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
        if (failure) return failure;
      }
      if (commands.length === commandCountBefore)
        appendNoopCommand(commands, node);
      return null;
    }
    if (node.type === "declaration_command") {
      let commandCountBefore = commands.length,
        argumentVariables = new Map(trackedVariables),
        hasFunctionFlag = !1,
        hasAutoloadFlag = !1,
        argv = [],
        previousEndIndex = -1;
      for (let child of node.children) {
        if (!child) continue;
        let isAdjacent = child.startIndex === previousEndIndex;
        switch (((previousEndIndex = child.endIndex), child.type)) {
          case "export":
          case "local":
          case "readonly":
          case "declare":
          case "typeset":
            argv.push(child.text);
            break;
          case "word":
          case "number":
          case "raw_string":
          case "string":
          case "concatenation": {
            if (isAdjacent)
              return {
                kind: "too-complex",
                reason: `${argv[0] ?? "declaration"} operand is split across adjacent quoted segments \u2014 the shell joins them into one word the analyzer cannot verify`,
                nodeType: "declaration_command",
              };
            let argument = evaluateArgument(
              child,
              commands,
              argumentVariables,
              bareAssignmentNames,
            );
            if (typeof argument !== "string") return argument;
            if (/^[+-].*m/.test(argument))
              return {
                kind: "too-complex",
                reason: `${argv[0]} flag ${argument} \u2014 zsh -m/+m pattern-assigns every matching variable; cannot statically model target set`,
                nodeType: "declaration_command",
              };
            if (
              (argv[0] === "declare" ||
                argv[0] === "typeset" ||
                argv[0] === "local") &&
              /^[+-].*[niaAEF]/.test(argument)
            )
              return {
                kind: "too-complex",
                reason: `declare flag ${argument} changes assignment semantics (nameref/integer/float/array)`,
                nodeType: "declaration_command",
              };
            if (
              argv[0] === "declare" ||
              argv[0] === "typeset" ||
              argv[0] === "local" ||
              argv[0] === "readonly"
            ) {
              if (/^[+-].*f/.test(argument)) hasFunctionFlag = !0;
              if (/^[+-].*[uU]/.test(argument)) hasAutoloadFlag = !0;
              if (hasFunctionFlag && hasAutoloadFlag)
                return {
                  kind: "too-complex",
                  reason: `${argv[0]} with both -f and -u/-U flags \u2014 zsh marks a function for autoload (synonym of 'autoload'), creating a function from file contents at call time`,
                  nodeType: "declaration_command",
                };
            }
            if (
              (argv[0] === "export" || argv[0] === "readonly") &&
              /^[+-].*[iEF]/.test(argument)
            )
              return {
                kind: "too-complex",
                reason: `${argv[0]} flag ${argument} \u2014 zsh bin_typeset accepts -i/-E/-F and arithmetically evaluates the RHS`,
                nodeType: "declaration_command",
              };
            if (/^[+-].*T/.test(argument))
              return {
                kind: "too-complex",
                reason: `${argv[0]} -T creates a user-defined zsh tied pair \u2014 tracked literals for its operands are unreliable`,
                nodeType: "declaration_command",
              };
            if (
              (argv[0] === "declare" ||
                argv[0] === "typeset" ||
                argv[0] === "local" ||
                argv[0] === "export") &&
              argument[0] !== "-" &&
              /^[^=]*\[/.test(argument)
            )
              return {
                kind: "too-complex",
                reason: `${argv[0]} positional '${argument}' contains array subscript \u2014 zsh/bash evaluate $(cmd) in subscripts`,
                nodeType: "declaration_command",
              };
            if (argument[0] !== "-") {
              let equalsIndex = argument.indexOf("=");
              if (equalsIndex > 0) {
                let assignmentTarget = argument.slice(0, equalsIndex);
                if (/^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(assignmentTarget)) {
                  let isAppend = assignmentTarget.endsWith("+"),
                    variableName = isAppend
                      ? assignmentTarget.slice(0, -1)
                      : assignmentTarget;
                  (updateTrackedVariable(
                    trackedVariables,
                    {
                      name: variableName,
                      value: argument.slice(equalsIndex + 1),
                      isAppend: isAppend,
                    },
                    commandCountBefore > 0,
                  ),
                    bareAssignmentNames.push(variableName));
                }
              }
            }
            argv.push(argument);
            break;
          }
          case "variable_assignment": {
            let assignment = evaluateVariableAssignment(
              child,
              commands,
              argumentVariables,
              bareAssignmentNames,
            );
            if ("kind" in assignment) return assignment;
            (updateTrackedVariable(
              trackedVariables,
              assignment,
              commandCountBefore > 0,
            ),
              bareAssignmentNames.push(assignment.name),
              argv.push(`${assignment.name}=${assignment.value}`));
            break;
          }
          case "variable_name": {
            let variableName = child.text;
            if (
              (argv[0] === "declare" ||
                argv[0] === "typeset" ||
                argv[0] === "local" ||
                argv[0] === "export") &&
              variableName[0] !== "-" &&
              /^[^=]*\[/.test(variableName)
            )
              return {
                kind: "too-complex",
                reason: `${argv[0]} positional '${variableName}' contains array subscript \u2014 backslash-escaped form de-escapes to [$(cmd)] at runtime`,
                nodeType: "declaration_command",
              };
            argv.push(variableName);
            break;
          }
          default:
            return tooComplexForNode(child);
        }
      }
      return (
        commands.push({
          argv: argv,
          envVars: [],
          redirects: [],
          text: node.text,
          hasUnquotedGlob: hasUnquotedGlob(node.text),
        }),
        null
      );
    }
    if (node.type === "variable_assignment") {
      let commandCountBefore = commands.length,
        assignment = evaluateVariableAssignment(
          node,
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
      if ("kind" in assignment) return assignment;
      if (affectsCommandExecution(assignment.name))
        return {
          kind: "too-complex",
          reason: `${assignment.name} assignment alters command lookup/execution for subsequent commands`,
          nodeType: "variable_assignment",
        };
      if (
        assignmentRequiresArithmeticEvaluation(
          assignment.name,
          assignment.value,
        )
      )
        return {
          kind: "too-complex",
          reason: `${assignment.name} has integer attribute \u2014 assignment arith-evals RHS, which can execute subscript command substitution or abort/diverge at runtime`,
          nodeType: "variable_assignment",
        };
      if (
        (updateTrackedVariable(
          trackedVariables,
          assignment,
          commandCountBefore > 0,
        ),
        bareAssignmentNames.push(assignment.name),
        commands.length === commandCountBefore &&
          containsArithmeticExpansion(node))
      )
        appendNoopCommand(commands, node);
      return null;
    }
    if (node.type === "for_statement") {
      if (subprocessEnvironmentScrubbingEnabled())
        return tooComplexForNode(node);
      let loopVariable = null,
        body = null,
        commandCountBefore = commands.length,
        hasArithmeticExpansion = !1;
      for (let child of node.children) {
        if (!child) continue;
        if (child.type === "variable_name") loopVariable = child.text;
        else if (child.type === "do_group") body = child;
        else if (child.type === "select")
          return {
            kind: "too-complex",
            reason:
              "select statement reads stdin into $REPLY; cannot statically model",
            nodeType: "for_statement",
          };
        else if (
          child.type === "for" ||
          child.type === "in" ||
          child.type === ";"
        )
          continue;
        else if (child.type === "command_substitution") {
          let failure = analyzeCommandSubstitution(
            child,
            commands,
            trackedVariables,
            bareAssignmentNames,
          );
          if (failure) return failure;
        } else {
          let argument = evaluateArgument(
            child,
            commands,
            trackedVariables,
            bareAssignmentNames,
          );
          if (typeof argument !== "string") return argument;
          if (containsArithmeticExpansion(child)) hasArithmeticExpansion = !0;
        }
      }
      if (loopVariable === null || body === null)
        return tooComplexForNode(node);
      if (
        loopVariable === "PS4" ||
        loopVariable === "IFS" ||
        affectsCommandExecution(loopVariable) ||
        INTEGER_ATTRIBUTE_VARIABLES.has(loopVariable) ||
        INHERITED_SHELL_VARIABLES.has(loopVariable) ||
        VOLATILE_SHELL_VARIABLES.has(loopVariable)
      )
        return {
          kind: "too-complex",
          reason: `${loopVariable} as loop variable bypasses assignment validation`,
          nodeType: "for_statement",
        };
      let previousValue = trackedVariables.get(loopVariable);
      if (previousValue !== void 0 && !hasUnknownTrackedValue(previousValue))
        return {
          kind: "too-complex",
          reason: `for-loop variable '${loopVariable}' would overwrite tracked literal ${JSON.stringify(previousValue.slice(0, 40))}; post-loop value cannot be statically determined`,
          nodeType: "for_statement",
        };
      (trackedVariables.delete(loopVariable),
        bareAssignmentNames.push(loopVariable));
      let bodyVariables = new Map(trackedVariables);
      (invalidateVariablesModifiedByNode(bodyVariables, body),
        bodyVariables.delete(loopVariable));
      for (let bodyChild of body.children) {
        if (!bodyChild) continue;
        if (
          bodyChild.type === "do" ||
          bodyChild.type === "done" ||
          bodyChild.type === ";"
        )
          continue;
        let failure = analyzeNode(
          bodyChild,
          commands,
          bodyVariables,
          bareAssignmentNames,
        );
        if (failure) return failure;
      }
      if (
        (mergeTrackedVariables(trackedVariables, bodyVariables),
        hasArithmeticExpansion && commands.length === commandCountBefore)
      )
        appendNoopCommand(commands, node);
      return null;
    }
    if (node.type === "if_statement" || node.type === "while_statement") {
      if (
        node.type === "while_statement" &&
        subprocessEnvironmentScrubbingEnabled()
      )
        return tooComplexForNode(node);
      let preLoopNames = null,
        preLoopVariables = null;
      if (node.type === "while_statement")
        ((preLoopNames = new Set(trackedVariables.keys())),
          (preLoopVariables = new Map(trackedVariables)),
          invalidateVariablesModifiedByNode(trackedVariables, node));
      let hasSeenThen = !1;
      for (let child of node.children) {
        if (!child) continue;
        if (
          child.type === "if" ||
          child.type === "fi" ||
          child.type === "else" ||
          child.type === "elif" ||
          child.type === "while" ||
          child.type === "until" ||
          child.type === ";"
        )
          continue;
        if (child.type === "then") {
          hasSeenThen = !0;
          continue;
        }
        if (child.type === "do_group") {
          let branchVariables = new Map(trackedVariables);
          invalidateVariablesModifiedByNode(branchVariables, child);
          for (let branchChild of child.children) {
            if (!branchChild) continue;
            if (
              branchChild.type === "do" ||
              branchChild.type === "done" ||
              branchChild.type === ";"
            )
              continue;
            let failure = analyzeNode(
              branchChild,
              commands,
              branchVariables,
              bareAssignmentNames,
            );
            if (failure) return failure;
          }
          mergeTrackedVariables(trackedVariables, branchVariables);
          continue;
        }
        if (child.type === "elif_clause" || child.type === "else_clause") {
          let branchVariables = new Map(trackedVariables);
          for (let branchChild of child.children) {
            if (!branchChild) continue;
            if (
              branchChild.type === "elif" ||
              branchChild.type === "else" ||
              branchChild.type === "then" ||
              branchChild.type === ";"
            )
              continue;
            let failure = analyzeNode(
              branchChild,
              commands,
              branchVariables,
              bareAssignmentNames,
            );
            if (failure) return failure;
          }
          mergeTrackedVariables(trackedVariables, branchVariables);
          continue;
        }
        let childVariables = new Map(trackedVariables),
          commandStart = commands.length,
          failure = analyzeNode(
            child,
            commands,
            childVariables,
            bareAssignmentNames,
          );
        if (failure) return failure;
        if (!hasSeenThen) {
          for (let [variableName, trackedValue] of childVariables) {
            let previousValue = (preLoopVariables ?? trackedVariables).get(
              variableName,
            );
            if (
              previousValue !== void 0 &&
              !hasUnknownTrackedValue(previousValue) &&
              trackedValue !== previousValue
            )
              return {
                kind: "too-complex",
                reason: `'${variableName}' was tracked as literal '${previousValue}' but condition may modify it (||/pipeline/unset/&&-short-circuit) \u2014 cannot prove downstream value`,
                nodeType: node.type,
              };
            trackedVariables.set(variableName, trackedValue);
          }
          for (let variableName of trackedVariables.keys()) {
            if (!childVariables.has(variableName)) {
              let previousValue = (preLoopVariables ?? trackedVariables).get(
                variableName,
              );
              if (
                previousValue !== void 0 &&
                !hasUnknownTrackedValue(previousValue)
              )
                return {
                  kind: "too-complex",
                  reason: `'${variableName}' was tracked as literal '${previousValue}' but condition may unset it (&&-short-circuit) \u2014 cannot prove downstream value`,
                  nodeType: node.type,
                };
              trackedVariables.set(variableName, UNKNOWN_TRACKED_VALUE);
            }
          }
          for (
            let commandIndex = commandStart;
            commandIndex < commands.length;
            commandIndex++
          ) {
            let command = commands[commandIndex];
            if (command?.argv[0] === "read") {
              for (let operand of command.argv.slice(1)) {
                if (
                  !operand.startsWith("-") &&
                  /^[A-Za-z_][A-Za-z0-9_]*$/.test(operand)
                ) {
                  let previousValue = trackedVariables.get(operand);
                  if (
                    previousValue !== void 0 &&
                    !hasUnknownTrackedValue(previousValue)
                  )
                    return {
                      kind: "too-complex",
                      reason: `'read ${operand}' in condition may not execute (||/pipeline/subshell); cannot prove it overwrites tracked literal '${previousValue}'`,
                      nodeType: node.type,
                    };
                  trackedVariables.set(operand, UNKNOWN_TRACKED_VALUE);
                }
              }
              let replyValue = trackedVariables.get("REPLY");
              if (replyValue !== void 0 && !hasUnknownTrackedValue(replyValue))
                return {
                  kind: "too-complex",
                  reason: `'read' in condition may write stdin to REPLY; cannot prove it overwrites tracked literal '${replyValue}'`,
                  nodeType: node.type,
                };
              trackedVariables.set("REPLY", UNKNOWN_TRACKED_VALUE);
            }
          }
        } else mergeTrackedVariables(trackedVariables, childVariables);
      }
      if (preLoopNames !== null) {
        for (let variableName of [...trackedVariables.keys()]) {
          if (!preLoopNames.has(variableName))
            trackedVariables.delete(variableName);
        }
      }
      return null;
    }
    if (node.type === "subshell") {
      let subshellVariables = new Map(trackedVariables),
        commandCountBefore = commands.length,
        hasContent = !1;
      for (let child of node.children) {
        if (!child) continue;
        if (child.type === "(" || child.type === ")") continue;
        if (child.type !== "comment") hasContent = !0;
        let failure = analyzeNode(
          child,
          commands,
          subshellVariables,
          bareAssignmentNames,
        );
        if (failure) return failure;
      }
      if (hasContent && commands.length === commandCountBefore)
        appendNoopCommand(commands, node);
      return null;
    }
    if (node.type === "test_command") {
      let isDoubleBracket = node.children.some(
          (candidate) => candidate?.type === "[[",
        ),
        coverageFailure = validateTestNodeCoverage(node, isDoubleBracket);
      if (coverageFailure) return coverageFailure;
      let argv = ["[["];
      for (let child of node.children) {
        if (!child) continue;
        if (
          child.type === "[[" ||
          child.type === "]]" ||
          child.type === "[" ||
          child.type === "]"
        ) {
          if (child.text === "")
            return {
              kind: "too-complex",
              reason: "test_command early-close (quote in operator position)",
              differential: !0,
            };
          continue;
        }
        let operandFailure = analyzeTestOperand(
          child,
          argv,
          commands,
          trackedVariables,
          bareAssignmentNames,
          isDoubleBracket,
        );
        if (operandFailure) return operandFailure;
      }
      return (
        commands.push({
          argv: argv,
          envVars: [],
          redirects: [],
          text: node.text,
          hasUnquotedGlob: hasUnquotedGlob(node.text),
        }),
        null
      );
    }
    if (node.type === "unset_command") {
      let argv = [],
        unsetsFunctions = !1,
        hasTarget = !1,
        isUnsetenv = !1;
      for (let child of node.children) {
        if (!child) continue;
        switch (child.type) {
          case "unset":
            (argv.push(child.text), (isUnsetenv = child.text === "unsetenv"));
            break;
          case "variable_name":
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(child.text))
              return tooComplexForNode(child);
            if (
              (argv.push(child.text),
              (hasTarget = !0),
              unsetsFunctions || isUnsetenv)
            ) {
              let existingValue = trackedVariables.get(child.text);
              if (
                existingValue !== void 0 &&
                hasUnknownTrackedValue(existingValue)
              )
                return {
                  kind: "too-complex",
                  reason: `'${child.text}' no longer has a statically known value at this unset \u2014 cannot verify what the command leaves behind`,
                  nodeType: "unset_command",
                };
              break;
            }
            if (isSensitiveShellVariable(child.text))
              return {
                kind: "too-complex",
                reason: `'unset' targets shell variable ${child.text} (exec-influencing / integer-attr / IFS / PS4)`,
                nodeType: "unset_command",
              };
            trackedVariables.set(child.text, "");
            break;
          case "word": {
            let argument = evaluateArgument(
              child,
              commands,
              trackedVariables,
              bareAssignmentNames,
            );
            if (typeof argument !== "string") return argument;
            if (argument.startsWith("-")) {
              if (hasTarget) return tooComplexForNode(child);
              if (argument !== "-f" && argument !== "-v")
                return tooComplexForNode(child);
              if (argument === "-f") unsetsFunctions = !0;
              argv.push(argument);
              break;
            }
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(argument))
              return tooComplexForNode(child);
            if (
              (argv.push(argument),
              (hasTarget = !0),
              unsetsFunctions || isUnsetenv)
            ) {
              let existingValue = trackedVariables.get(argument);
              if (
                existingValue !== void 0 &&
                hasUnknownTrackedValue(existingValue)
              )
                return {
                  kind: "too-complex",
                  reason: `'${argument}' no longer has a statically known value at this unset \u2014 cannot verify what the command leaves behind`,
                  nodeType: "unset_command",
                };
              break;
            }
            if (isSensitiveShellVariable(argument))
              return {
                kind: "too-complex",
                reason: `'unset' targets shell variable ${argument} (exec-influencing / integer-attr / IFS / PS4)`,
                nodeType: "unset_command",
              };
            trackedVariables.set(argument, "");
            break;
          }
          default:
            return tooComplexForNode(child);
        }
      }
      return (
        commands.push({
          argv: argv,
          envVars: [],
          redirects: [],
          text: node.text,
          hasUnquotedGlob: hasUnquotedGlob(node.text),
        }),
        null
      );
    }
    return tooComplexForNode(node);
  }

  // upstream Lo @ 125466-125566
  const TEST_EXPRESSION_NODE_TYPES = new Set([
    "unary_expression",
    "binary_expression",
    "negated_expression",
    "parenthesized_expression",
  ]);

  // upstream Ro @ 125567-125804
  function containsOnlyTestGapWhitespace(gapText, isDoubleBracket) {
    let index = 0;
    while (index < gapText.length) {
      let character = gapText[index];
      if (character === " " || character === "\t") {
        index++;
        continue;
      }
      if (
        character === "\\" &&
        gapText[index + 1] ===
          `
`
      ) {
        index += 2;
        continue;
      }
      if (
        isDoubleBracket &&
        character ===
          `
`
      ) {
        index++;
        continue;
      }
      if (isDoubleBracket && character === "#") {
        index++;
        while (
          index < gapText.length &&
          gapText[index] !==
            `
`
        )
          index++;
        continue;
      }
      return !1;
    }
    return !0;
  }

  // upstream Fo @ 125804-126632
  function validateTestNodeCoverage(node, isDoubleBracket) {
    let nodeBytes = Buffer.from(node.text, "utf8"),
      coveredEnd = node.startIndex;
    for (let child of node.children) {
      if (!child) continue;
      if (child.endIndex > node.endIndex || child.startIndex < node.startIndex)
        return {
          kind: "too-complex",
          reason:
            "Test command child extends past the node span \u2014 gap byte accounting is untrustworthy",
        };
      if (child.startIndex > coveredEnd) {
        let gapText = nodeBytes
          .subarray(
            coveredEnd - node.startIndex,
            child.startIndex - node.startIndex,
          )
          .toString("utf8");
        if (!containsOnlyTestGapWhitespace(gapText, isDoubleBracket))
          return {
            kind: "too-complex",
            reason:
              "Test command has unparsed bytes between children \u2014 parser dropped content that shell will see",
          };
      }
      if (
        ((coveredEnd = Math.max(coveredEnd, child.endIndex)),
        TEST_EXPRESSION_NODE_TYPES.has(child.type))
      ) {
        let coverageError = validateTestNodeCoverage(child, isDoubleBracket);
        if (coverageError) return coverageError;
      }
    }
    if (coveredEnd < node.endIndex) {
      let trailingGap = nodeBytes
        .subarray(coveredEnd - node.startIndex)
        .toString("utf8");
      if (!containsOnlyTestGapWhitespace(trailingGap, isDoubleBracket))
        return {
          kind: "too-complex",
          reason:
            "Test command has unparsed bytes after its last child \u2014 parser dropped content that shell will see",
        };
    }
    return null;
  }

  // upstream Na @ 126632-126976
  function hasZshEqualsProcessSubstitution(text) {
    let inSingleQuote = !1,
      inDoubleQuote = !1,
      sawListOperator = !1,
      parenDepth = 0,
      previousCharacter;
    for (let index = 0; index < text.length; index++) {
      let character = text[index];
      if (!inSingleQuote && character === "\\") {
        index++;
        continue;
      }
      if (!inDoubleQuote && character === "'") {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (!inSingleQuote && character === '"') {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }
      if (!inSingleQuote && !inDoubleQuote) {
        if (
          character === "=" &&
          text[index + 1] === "(" &&
          (sawListOperator || index === 0 || previousCharacter === "|")
        )
          return !0;
        if (character === "(") parenDepth++;
        else if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
        else if (
          parenDepth === 0 &&
          (character === "|" || character === "&") &&
          previousCharacter === character
        )
          sawListOperator = !0;
        previousCharacter = character;
      }
    }
    return !1;
  }

  // upstream On @ 126976-127247
  function hasStandaloneDoubleBracket(text) {
    let sanitizedText = text.replace(
        /\[(?::[a-zA-Z]+:|=[A-Za-z0-9-]*=|\.[A-Za-z0-9-]*\.|[!^]?)\]\](?!\])/g,
        "\x00",
      ),
      wordCharacterPattern = /[A-Za-z0-9_]/,
      closingIndex = sanitizedText.indexOf("]]");
    while (closingIndex !== -1) {
      let previousCharacter =
          closingIndex > 0 ? sanitizedText[closingIndex - 1] : "",
        nextCharacter =
          closingIndex + 2 < sanitizedText.length
            ? sanitizedText[closingIndex + 2]
            : "";
      if (!(
        wordCharacterPattern.test(previousCharacter) &&
        wordCharacterPattern.test(nextCharacter)
      ))
        return !0;
      closingIndex = sanitizedText.indexOf("]]", closingIndex + 1);
    }
    return !1;
  }

  // upstream Wo @ 127247-130695
  function analyzeTestOperand(
    node,
    testTokens,
    commands,
    trackedVariables,
    bareAssignmentNames,
    isDoubleBracket,
  ) {
    if (TEST_EXPRESSION_NODE_TYPES.has(node.type)) {
      for (
        let childIndex = 0;
        childIndex < node.children.length;
        childIndex++
      ) {
        let child = node.children[childIndex];
        if (!child) continue;
        if (
          (child.type === "simple_expansion" || child.type === "expansion") &&
          (node.children[childIndex + 1]?.text.startsWith("[") ||
            /^:[a-zA-Z&]/.test(node.children[childIndex + 1]?.text ?? "") ||
            (child.children.some(
              (candidateChild) =>
                candidateChild?.type === "special_variable_name",
            ) &&
              /^\w*(\[|:[a-zA-Z&])/.test(
                node.children[childIndex + 1]?.text ?? "",
              )))
        )
          return {
            kind: "too-complex",
            reason:
              "zsh $name[expr] / $name:mod in [[ ]] operand \u2014 recursive eval",
            differential: !0,
          };
        let operandError = analyzeTestOperand(
          child,
          testTokens,
          commands,
          trackedVariables,
          bareAssignmentNames,
          isDoubleBracket,
        );
        if (operandError) return operandError;
      }
      return null;
    }
    switch (node.type) {
      case "test_operator":
      case "!":
      case "(":
      case ")":
      case "&&":
      case "||":
      case "==":
      case "=":
      case "!=":
      case "<":
      case ">":
      case "=~":
        if (node.text === "")
          return {
            kind: "too-complex",
            reason:
              "Test command has a synthesized zero-width token \u2014 parser diverged from shell",
            differential: !0,
          };
        return (testTokens.push(node.text), null);
      case "regex":
      case "extglob_pattern":
        if (/\$[({[\w#?!*@$'"+~^=-]|`|[<>]\(/.test(node.text))
          return {
            kind: "too-complex",
            reason: `[[ ]] ${node.type} contains expansion / command / process substitution`,
            differential: !0,
          };
        if (node.text.startsWith("=("))
          return {
            kind: "too-complex",
            reason: `[[ ]] ${node.type === "extglob_pattern" ? "pattern" : node.type} contains zsh =(CMD) process substitution`,
            differential: !0,
          };
        if (node.type === "regex" && hasZshEqualsProcessSubstitution(node.text))
          return {
            kind: "too-complex",
            reason: `[[ ]] ${node.type} contains zsh =(CMD) process substitution`,
            differential: !0,
          };
        if (node.type === "extglob_pattern") {
          let patternText = node.text,
            index = 0;
          while (index < patternText.length) {
            if (patternText[index] === "\\" && index + 1 < patternText.length) {
              index += 2;
              continue;
            }
            if (patternText[index] === "&")
              return {
                kind: "too-complex",
                reason:
                  "[[ ]] pattern contains unquoted & (zsh splits the word at & at any depth)",
                differential: !0,
              };
            index++;
          }
        }
        if (node.type === "regex") {
          let regexText = node.text,
            parenDepth = 0,
            index = 0;
          while (index < regexText.length) {
            let character = regexText[index];
            if (character === "\\" && index + 1 < regexText.length) {
              index += 2;
              continue;
            }
            if (
              parenDepth === 0 &&
              character === "|" &&
              regexText[index + 1] === character
            )
              return {
                kind: "too-complex",
                reason:
                  "[[ ]] regex contains glued || (zsh splits it as a cond operator)",
                differential: !0,
              };
            if (character === "&")
              return {
                kind: "too-complex",
                reason:
                  "[[ ]] regex contains unquoted & (zsh splits the word at & at any depth)",
                differential: !0,
              };
            if (character === '"' || character === "'") {
              let quoteCharacter = character;
              index++;
              while (
                index < regexText.length &&
                regexText[index] !== quoteCharacter
              ) {
                if (
                  quoteCharacter === '"' &&
                  regexText[index] === "\\" &&
                  index + 1 < regexText.length
                )
                  index++;
                index++;
              }
              if (index < regexText.length) index++;
              continue;
            }
            if (character === "(") parenDepth++;
            else if (character === ")") {
              if ((parenDepth--, parenDepth < 0))
                return {
                  kind: "too-complex",
                  reason:
                    "[[ ]] regex has unbalanced parentheses (parser desync)",
                  differential: !0,
                };
            }
            index++;
          }
          if (parenDepth !== 0)
            return {
              kind: "too-complex",
              reason: "[[ ]] regex has unbalanced parentheses (parser desync)",
              differential: !0,
            };
        }
        if (node.text.includes("&&"))
          return {
            kind: "too-complex",
            reason:
              "[[ ]] pattern leaf contains `&&` \u2014 shell cond-lexer divergence (zsh splits the word there)",
            differential: !0,
          };
        if (hasStandaloneDoubleBracket(node.text))
          return {
            kind: "too-complex",
            reason:
              "[[ ]] pattern leaf contains a potential standalone `]]` closer \u2014 shell cond-lexer divergence (zsh may close the conditional early)",
            differential: !0,
          };
        return (testTokens.push(node.text), null);
      case "test_rhs_missing":
        return {
          kind: "too-complex",
          reason:
            "Test command comparison is missing its right-hand side \u2014 parser dropped consumed bytes",
        };
      default: {
        let value = evaluateArgument(
          node,
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
        if (typeof value !== "string") {
          if (isDoubleBracket && value.kind === "too-complex") {
            let { nodeType: ignoredNodeType, ...errorDetails } = value;
            return { ...errorDetails, differential: !0 };
          }
          return value;
        }
        if (
          (isDoubleBracket &&
            (hasStandaloneDoubleBracket(value) ||
              hasStandaloneDoubleBracket(node.text))) ||
          /]].*[;\n&|<>]/s.test(value)
        )
          return {
            kind: "too-complex",
            reason: isDoubleBracket
              ? "[[ ]] quoted operand contains `]]` closer or `]]`+separator bytes \u2014 possible parser quote-state desync"
              : "test command quoted operand contains `]]`+separator bytes \u2014 possible parser quote-state desync",
            differential: !0,
          };
        return (testTokens.push(value), null);
      }
    }
  }

  // upstream Uo @ 130695-130950
  function findUnsupportedRedirectedChild(node) {
    let candidate = null;
    for (let child of node.children) {
      if (
        !child ||
        child.type === "!" ||
        child.type === "comment" ||
        SHELL_OPERATOR_TYPES.has(child.type)
      )
        continue;
      candidate = child;
    }
    if (!candidate) return null;
    if (candidate.type === "list" || candidate.type === "negated_command")
      return findUnsupportedRedirectedChild(candidate);
    if (
      !COMMAND_WRAPPER_NODE_TYPES.has(candidate.type) &&
      !REDIRECT_AUXILIARY_NODE_TYPES.has(candidate.type)
    )
      return candidate;
    return null;
  }

  // upstream Wa @ 130950-132066
  function analyzeRedirectedStatement(
    node,
    commands,
    trackedVariables,
    bareAssignmentNames,
  ) {
    let redirects = [],
      statement = null,
      fileRedirects = [],
      heredocRedirects = [];
    for (let child of node.children) {
      if (!child) continue;
      if (child.type === "file_redirect") fileRedirects.push(child);
      else if (child.type === "heredoc_redirect") heredocRedirects.push(child);
      else if (COMMAND_WRAPPER_NODE_TYPES.has(child.type)) {
        if (child.type === "list" || child.type === "negated_command") {
          let unsupportedChild = findUnsupportedRedirectedChild(child);
          if (unsupportedChild) return tooComplexForNode(unsupportedChild);
        }
        statement = child;
      } else return tooComplexForNode(child);
    }
    if (!statement) {
      for (let fileRedirect of fileRedirects) {
        let redirectResult = analyzeFileRedirect(
          fileRedirect,
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
        if ("kind" in redirectResult) return redirectResult;
        redirects.push(redirectResult);
      }
      for (let heredocRedirect of heredocRedirects) {
        let heredocError = analyzeHeredocRedirect(heredocRedirect);
        if (heredocError) return heredocError;
      }
      return (
        commands.push({
          argv: [],
          envVars: [],
          redirects: redirects,
          text: node.text,
          hasUnquotedGlob: hasUnquotedGlob(node.text),
        }),
        null
      );
    }
    let initialCommandCount = commands.length,
      redirectVariables;
    if (statement.type === "list") {
      let children = statement.children;
      if (
        children.length === 3 &&
        children[0] &&
        children[1]?.type === "&&" &&
        children[2]
      ) {
        let leftError = analyzeNode(
          children[0],
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
        if (leftError) return leftError;
        redirectVariables = new Map(trackedVariables);
        let rightError = analyzeNode(
          children[2],
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
        if (rightError) return rightError;
      } else {
        let analysisError = analyzeNode(
          statement,
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
        if (analysisError) return analysisError;
        redirectVariables = trackedVariables;
      }
    } else if (CONTAINER_NODE_TYPES.has(statement.type)) {
      let analysisError = analyzeNode(
        statement,
        commands,
        trackedVariables,
        bareAssignmentNames,
      );
      if (analysisError) return analysisError;
      redirectVariables = trackedVariables;
    } else {
      redirectVariables = new Map(trackedVariables);
      let analysisError = analyzeNode(
        statement,
        commands,
        trackedVariables,
        bareAssignmentNames,
      );
      if (analysisError) return analysisError;
    }
    for (let fileRedirect of fileRedirects) {
      let redirectResult = analyzeFileRedirect(
        fileRedirect,
        commands,
        redirectVariables,
        bareAssignmentNames,
      );
      if ("kind" in redirectResult) return redirectResult;
      redirects.push(redirectResult);
    }
    for (let heredocRedirect of heredocRedirects) {
      let heredocError = analyzeHeredocRedirect(heredocRedirect);
      if (heredocError) return heredocError;
    }
    if (redirects.length > 0)
      if (commands.length > initialCommandCount) {
        let lastCommand = commands.at(-1);
        if (lastCommand) lastCommand.redirects.push(...redirects);
      } else
        commands.push({
          argv: [],
          envVars: [],
          redirects: redirects,
          text: node.text,
          hasUnquotedGlob: hasUnquotedGlob(node.text),
        });
    return null;
  }

  // upstream zo @ 132066-133539
  function validateRedirectShape(node) {
    {
      let coveredEnd = node.startIndex;
      for (let child of node.children) {
        if (!child) continue;
        if (child.startIndex > coveredEnd) {
          let gapText = Buffer.from(node.text, "utf8")
            .subarray(
              coveredEnd - node.startIndex,
              child.startIndex - node.startIndex,
            )
            .toString("utf8");
          if (!/^(?:[ \t]|\\\n)*$/.test(gapText))
            return {
              kind: "too-complex",
              reason:
                "Redirect has unparsed bytes between children \u2014 parser dropped content that shell will see",
            };
        }
        coveredEnd = child.endIndex;
      }
      if (coveredEnd < node.endIndex) {
        let trailingGap = Buffer.from(node.text, "utf8")
          .subarray(coveredEnd - node.startIndex)
          .toString("utf8");
        if (!/^(?:[ \t]|\\\n)*$/.test(trailingGap))
          return {
            kind: "too-complex",
            reason:
              "Redirect has unparsed trailing bytes \u2014 parser dropped content that shell will see",
          };
      }
    }
    let operator = null,
      targetCount = 0;
    for (let child of node.children) {
      if (!child) continue;
      if (child.type === "variable_name")
        return {
          kind: "too-complex",
          reason: `Redirect uses ${child.text} fd-variable assignment \u2014 modifies shell variable as side effect`,
        };
      if (child.type === "file_descriptor") continue;
      if (child.type === ">&-" || child.type === "<&-") {
        operator = child.type;
        continue;
      }
      if (child.type in REDIRECT_OPERATOR_MAP) {
        operator = child.type;
        continue;
      }
      if (
        (operator === ">&" || operator === "<&") &&
        child.text.startsWith("-")
      )
        return {
          kind: "too-complex",
          reason:
            "Redirect target after >& or <& starts with - \u2014 bash treats the dash as close-fd and passes the rest to the command as a hidden argument",
        };
      if (operator === ">&-" || operator === "<&-")
        return {
          kind: "too-complex",
          reason:
            "Close-fd redirect is followed by a word \u2014 bash passes it to the command as a hidden argument",
        };
      (targetCount++, (operator = null));
    }
    if (targetCount > 1)
      return {
        kind: "too-complex",
        reason:
          "Redirect has multiple targets \u2014 post-redirect args swallowed",
      };
    return null;
  }

  // upstream Bo @ 133539-133677
  function findInvalidRedirect(node) {
    if (node.type === "file_redirect") {
      let shapeError = validateRedirectShape(node);
      if (shapeError) return shapeError;
    }
    for (let child of node.children) {
      if (child) {
        let nestedError = findInvalidRedirect(child);
        if (nestedError) return nestedError;
      }
    }
    return null;
  }

  // upstream Gn @ 133677-136400
  function analyzeFileRedirect(
    node,
    commands,
    trackedVariables,
    bareAssignmentNames,
  ) {
    let operator = null,
      target = null,
      fileDescriptor;
    {
      let shapeError = validateRedirectShape(node);
      if (shapeError) return shapeError;
    }
    for (let child of node.children) {
      if (!child) continue;
      if (child.type === "file_descriptor") fileDescriptor = Number(child.text);
      else if (child.type === "variable_name")
        return {
          kind: "too-complex",
          reason: `Redirect uses ${child.text} fd-variable assignment \u2014 modifies shell variable as side effect`,
        };
      else if (child.type in REDIRECT_OPERATOR_MAP)
        operator = REDIRECT_OPERATOR_MAP[child.type] ?? null;
      else if (child.type === ">&-" || child.type === "<&-") {
        if (
          node.children.some(
            (sibling) =>
              sibling !== child && sibling?.type !== "file_descriptor",
          )
        )
          return {
            kind: "too-complex",
            reason:
              "Close-fd redirect is followed by a word \u2014 bash passes it to the command as a hidden argument",
          };
        return tooComplexForNode(child);
      } else if (target !== null)
        return {
          kind: "too-complex",
          reason:
            "Redirect has multiple targets \u2014 post-redirect args swallowed",
        };
      else if (
        (operator === ">&" || operator === "<&") &&
        child.text.startsWith("-")
      )
        return {
          kind: "too-complex",
          reason:
            "Redirect target after >& or <& starts with - \u2014 bash treats the dash as close-fd and passes the rest to the command as a hidden argument",
        };
      else if (child.type === "word" || child.type === "number") {
        if (child.children.length > 0) return tooComplexForNode(child);
        if (BRACE_EXPANSION_PATTERN.test(child.text))
          return tooComplexForNode(child);
        if (ESCAPED_BRACE_CLOSE_PATTERN.test(child.text))
          return tooComplexForNode(child);
        if (ESCAPED_BRACE_OPEN_PATTERN.test(child.text))
          return tooComplexForNode(child);
        if (/(?:^|[^\\])(?:\\\\)*[`$]/.test(child.text))
          return tooComplexForNode(child);
        target = child.text.replace(/\\([\s\S])/g, (match, escapedCharacter) =>
          escapedCharacter ===
          `
`
            ? ""
            : escapedCharacter,
        );
      } else if (child.type === "raw_string") target = stripQuotes(child.text);
      else if (child.type === "string") {
        let evaluatedTarget = evaluateDoubleQuotedString(
          child,
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
        if (typeof evaluatedTarget !== "string") return evaluatedTarget;
        target = evaluatedTarget;
      } else if (child.type === "concatenation") {
        let evaluatedTarget = evaluateArgument(
          child,
          commands,
          trackedVariables,
          bareAssignmentNames,
        );
        if (typeof evaluatedTarget !== "string") return evaluatedTarget;
        if (/(?:^|[^\\])(?:\\\\)*[`$]/.test(child.text))
          return {
            kind: "too-complex",
            reason:
              "Redirect target concatenation contains $/` \u2014 unanalyzable gap or substitution",
            nodeType: "concatenation",
          };
        target = evaluatedTarget;
      } else return tooComplexForNode(child);
    }
    if (!operator || target === null)
      return { kind: "too-complex", reason: "Unrecognized redirect shape" };
    if (hasUnknownTrackedValue(target))
      return {
        kind: "too-complex",
        reason:
          "Redirect target contains $(cmd) output \u2014 path is runtime-determined",
        nodeType: node.type,
      };
    if (
      target.includes(`
`)
    )
      return {
        kind: "too-complex",
        reason:
          "Redirect target contains newline \u2014 potential path traversal",
        nodeType: node.type,
      };
    if (target.startsWith("!"))
      return {
        kind: "too-complex",
        reason:
          "Redirect target starts with ! \u2014 zsh clobber or history expansion",
        nodeType: node.type,
      };
    if (target.startsWith("="))
      return {
        kind: "too-complex",
        reason:
          "Redirect target starts with = \u2014 zsh expands to PATH binary",
        nodeType: node.type,
      };
    if ((operator === ">&" || operator === "<&") && target.startsWith("-"))
      return {
        kind: "too-complex",
        reason:
          "Redirect target after >& or <& starts with - \u2014 bash treats the dash as close-fd and passes the rest to the command as a hidden argument",
      };
    if (operator === ">&" && !/^[A-Za-z0-9./_-]+$/.test(target))
      return {
        kind: "too-complex",
        reason:
          "bash `>&` applies a second word-expansion pass to its target \u2014 path cannot be statically validated",
        nodeType: node.type,
      };
    return { op: operator, target: target, fd: fileDescriptor };
  }

  // upstream Yn @ 136400-137861
  function analyzeHeredocRedirect(node) {
    let rawDelimiter = null,
      body = null,
      stripTabs = !1;
    for (let child of node.children) {
      if (!child) continue;
      if (child.type === "heredoc_start") rawDelimiter = child.text;
      else if (child.type === "heredoc_body") body = child;
      else if (child.type === "<<-") stripTabs = !0;
      else if (
        child.type === "<<" ||
        child.type === "heredoc_end" ||
        child.type === "file_descriptor"
      );
      else return tooComplexForNode(child);
    }
    if (body === null)
      return {
        kind: "too-complex",
        reason: "Heredoc body was not scanned by the parser",
        nodeType: "heredoc_redirect",
      };
    if (!(
      rawDelimiter !== null &&
      ((rawDelimiter.startsWith("'") && rawDelimiter.endsWith("'")) ||
        (rawDelimiter.startsWith('"') && rawDelimiter.endsWith('"')) ||
        rawDelimiter.startsWith("\\"))
    ))
      return {
        kind: "too-complex",
        reason: "Heredoc with unquoted delimiter undergoes shell expansion",
        nodeType: "heredoc_redirect",
        differential: !0,
      };
    if (
      rawDelimiter !== null &&
      (rawDelimiter.startsWith("'") || rawDelimiter.startsWith('"')) &&
      rawDelimiter.slice(1, -1).includes("\\")
    )
      return {
        kind: "too-complex",
        reason: "Quoted heredoc delimiter contains backslash",
        nodeType: "heredoc_redirect",
      };
    if (body)
      for (let bodyChild of body.children) {
        if (!bodyChild) continue;
        if (bodyChild.type !== "heredoc_content")
          return tooComplexForNode(bodyChild);
      }
    if (rawDelimiter !== null && body !== null) {
      let delimiter = rawDelimiter.startsWith("\\")
        ? rawDelimiter.slice(1)
        : rawDelimiter.slice(1, -1);
      if (delimiter.length > 0) {
        if (stripTabs && delimiter.startsWith("\t"))
          return {
            kind: "too-complex",
            reason: "Heredoc uses <<- with a tab-prefixed delimiter",
            nodeType: "heredoc_redirect",
          };
        for (let line of body.text.split(`
`)) {
          let normalizedLine = stripTabs ? line.replace(/^\t+/, "") : line;
          if (!normalizedLine.startsWith(delimiter)) continue;
          let suffix = normalizedLine.slice(delimiter.length);
          if (/[)`}]/.test(suffix))
            return {
              kind: "too-complex",
              reason:
                "Heredoc body line starts with the delimiter and contains a shell metacharacter bash may treat as a terminator",
              nodeType: "heredoc_redirect",
            };
        }
      }
    }
    return null;
  }

  // upstream ja @ 137861-138037
  function analyzeHerestringRedirect(
    node,
    commands,
    trackedVariables,
    bareAssignmentNames,
  ) {
    for (let child of node.children) {
      if (!child) continue;
      if (child.type === "<<<") continue;
      let value = evaluateArgument(
        child,
        commands,
        trackedVariables,
        bareAssignmentNames,
      );
      if (typeof value !== "string") return value;
      if (HEREDOC_COMMENT_LINE_PATTERN.test(value))
        return tooComplexForNode(child);
    }
    return null;
  }

  // upstream Vn @ 138041-138102
  const COMMAND_PREFIX_WRAPPERS = new Set([
    "command",
    "builtin",
    "noglob",
    "nocorrect",
    "time",
  ]);

  // upstream Go @ 138103-138164
  const DECLARATION_COMMAND_NAMES = new Set([
    "declare",
    "typeset",
    "local",
    "export",
    "readonly",
  ]);

  // upstream Ho @ 138165-138267
  const ENV_PREFIX_COMMITTING_BUILTINS = new Set([
    ":",
    "break",
    "continue",
    "return",
    "exit",
    "shift",
    "times",
    "set",
    "export",
    "readonly",
    "unset",
  ]);

  // upstream Ua @ 138268-142814
  function trackCommandSideEffects(
    argv,
    envVars,
    trackedVariables,
    bareAssignmentNames,
  ) {
    let writtenVariableNames = [],
      detectedBareAssignments = [],
      recordVariableWrite = (targetText, recordBareAssignment = !0) => {
        let targetMatch = targetText.match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if (targetMatch) {
          if ((writtenVariableNames.push(targetMatch[0]), recordBareAssignment))
            detectedBareAssignments.push(targetMatch[0]);
        }
      },
      remainingArgv = argv,
      wrapperAltersExecution = !1,
      previousWrapper;
    while (true) {
      let leadingToken = remainingArgv[0];
      if (leadingToken === void 0) break;
      if (COMMAND_PREFIX_WRAPPERS.has(leadingToken)) {
        if (
          (previousWrapper === "builtin" || previousWrapper === "command") &&
          leadingToken !== "builtin" &&
          leadingToken !== "command"
        ) {
          if (leadingToken === "noglob" && !wrapperAltersExecution)
            return {
              kind: "too-complex",
              reason: `'${previousWrapper} noglob' runs the wrapped command on zsh (for 'command', under POSIX_BUILTINS) but not bash \u2014 cannot statically model whether it executes`,
              nodeType: "command",
            };
          wrapperAltersExecution = !0;
        }
        let wrapperArgCount = 1;
        while (
          wrapperArgCount < remainingArgv.length &&
          /^-[-pvV]*$/.test(remainingArgv[wrapperArgCount])
        ) {
          if (/[vV]/.test(remainingArgv[wrapperArgCount]))
            wrapperAltersExecution = !0;
          wrapperArgCount++;
        }
        ((remainingArgv = remainingArgv.slice(wrapperArgCount)),
          (previousWrapper = leadingToken));
      } else if (leadingToken === "!") {
        if (previousWrapper === "builtin" || previousWrapper === "command")
          wrapperAltersExecution = !0;
        ((remainingArgv = remainingArgv.slice(1)), (previousWrapper = void 0));
      } else if (/^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.test(leadingToken))
        (recordVariableWrite(leadingToken),
          (remainingArgv = remainingArgv.slice(1)),
          (previousWrapper = void 0));
      else break;
    }
    let commandName = remainingArgv[0];
    if (commandName === void 0)
      for (let bareEnvVar of envVars) {
        recordVariableWrite(bareEnvVar.name);
      }
    else if (DECLARATION_COMMAND_NAMES.has(commandName)) {
      let declarationEndOfOptions = !1;
      for (
        let declarationArgIndex = 1;
        declarationArgIndex < remainingArgv.length;
        declarationArgIndex++
      ) {
        let declarationArg = remainingArgv[declarationArgIndex];
        if (!declarationEndOfOptions && declarationArg === "--") {
          declarationEndOfOptions = !0;
          continue;
        }
        if (!declarationEndOfOptions && /^[+-].*m/.test(declarationArg))
          return {
            kind: "too-complex",
            reason: `'${commandName} ${declarationArg}' (wrapped form) \u2014 zsh -m/+m pattern-assigns every matching variable; cannot statically model target set`,
            nodeType: "command",
          };
        if (!declarationEndOfOptions && declarationArg.startsWith("-"))
          continue;
        if (declarationArg.includes("=")) recordVariableWrite(declarationArg);
      }
    } else if (commandName === "read") {
      let readArgIndex = 1,
        readEndOfOptions = !1,
        readHasTarget = !1;
      while (readArgIndex < remainingArgv.length) {
        let readArg = remainingArgv[readArgIndex];
        if (!readEndOfOptions && readArg === "--") {
          ((readEndOfOptions = !0), readArgIndex++);
          continue;
        }
        if (!readEndOfOptions && readArg.startsWith("-")) {
          if (READ_OPTIONS_WITH_OPERANDS.has(readArg)) {
            readArgIndex += 2;
            continue;
          }
          let readConsumesOperand = !1;
          for (
            let readOptionIndex = 1;
            readOptionIndex < readArg.length;
            readOptionIndex++
          ) {
            let readOption = readArg[readOptionIndex];
            if (readOption === "a" || readOption === "A") {
              let readTarget =
                readOptionIndex < readArg.length - 1
                  ? readArg.slice(readOptionIndex + 1)
                  : remainingArgv[readArgIndex + 1];
              if (readTarget)
                (recordVariableWrite(readTarget), (readHasTarget = !0));
              readConsumesOperand = readOptionIndex === readArg.length - 1;
              break;
            }
            if (READ_OPTIONS_WITH_OPERANDS.has("-" + readOption)) {
              readConsumesOperand = readOptionIndex === readArg.length - 1;
              break;
            }
          }
          readArgIndex += readConsumesOperand ? 2 : 1;
          continue;
        }
        (recordVariableWrite(readArg), (readHasTarget = !0), readArgIndex++);
      }
      if (!readHasTarget) writtenVariableNames.push("REPLY");
    } else if (commandName === "printf")
      for (
        let printfArgIndex = 1;
        printfArgIndex < remainingArgv.length;
        printfArgIndex++
      ) {
        let printfOption = remainingArgv[printfArgIndex];
        if (printfOption === "--" || !printfOption.startsWith("-")) break;
        if (printfOption === "-v") {
          if (remainingArgv[printfArgIndex + 1])
            recordVariableWrite(remainingArgv[printfArgIndex + 1]);
          printfArgIndex++;
          continue;
        }
        if (printfOption.startsWith("-v"))
          recordVariableWrite(printfOption.slice(2));
      }
    else if (commandName === "getopts") {
      let getoptsOffset = remainingArgv[1] === "--" ? 1 : 0;
      if (remainingArgv[2 + getoptsOffset])
        recordVariableWrite(remainingArgv[2 + getoptsOffset]);
      (writtenVariableNames.push("OPTARG"),
        trackedVariables.set("OPTIND", UNKNOWN_TRACKED_VALUE));
    } else if (commandName === "wait")
      for (
        let waitArgIndex = 1;
        waitArgIndex < remainingArgv.length;
        waitArgIndex++
      ) {
        let waitOption = remainingArgv[waitArgIndex];
        if (waitOption === "--" || !waitOption.startsWith("-")) break;
        for (
          let waitOptionIndex = 1;
          waitOptionIndex < waitOption.length;
          waitOptionIndex++
        )
          if (waitOption[waitOptionIndex] === "p") {
            if (waitOptionIndex < waitOption.length - 1)
              recordVariableWrite(waitOption.slice(waitOptionIndex + 1));
            else if (remainingArgv[waitArgIndex + 1])
              (recordVariableWrite(remainingArgv[waitArgIndex + 1]),
                waitArgIndex++);
            break;
          }
      }
    else if (
      !wrapperAltersExecution &&
      (commandName === "unset" || commandName === "unsetenv")
    ) {
      let unsetFunctionMode = !1,
        unsetOperandSeen = !1;
      for (
        let unsetArgIndex = 1;
        unsetArgIndex < remainingArgv.length;
        unsetArgIndex++
      ) {
        let unsetArg = remainingArgv[unsetArgIndex];
        if (unsetArg.startsWith("-")) {
          if (unsetOperandSeen)
            return {
              kind: "too-complex",
              reason: `'unset \u2026 ${unsetArg}' (wrapped form) \u2014 flag after name; getopt stops at first non-option`,
              nodeType: "command",
            };
          if (unsetArg !== "-f" && unsetArg !== "-v")
            return {
              kind: "too-complex",
              reason: `'unset ${unsetArg}' (wrapped form) \u2014 flag other than -f/-v (zsh -m pattern-unset, bash -n nameref) cannot be statically modelled`,
              nodeType: "command",
            };
          if (unsetArg === "-f") unsetFunctionMode = !0;
          continue;
        }
        if (
          ((unsetOperandSeen = !0), !/^[A-Za-z_][A-Za-z0-9_]*$/.test(unsetArg))
        )
          return {
            kind: "too-complex",
            reason: `'unset ${unsetArg}' (wrapped form) \u2014 non-identifier operand may pathname-expand; cannot statically know which var is unset`,
            nodeType: "command",
          };
        if (unsetFunctionMode || commandName === "unsetenv") {
          let unsetTrackedValue = trackedVariables.get(unsetArg);
          if (
            unsetTrackedValue !== void 0 &&
            hasUnknownTrackedValue(unsetTrackedValue)
          )
            return {
              kind: "too-complex",
              reason: `'${unsetArg}' no longer has a statically known value at this unset (wrapped form) \u2014 cannot verify what the command leaves behind`,
              nodeType: "command",
            };
          continue;
        }
        if (isSensitiveShellVariable(unsetArg))
          return {
            kind: "too-complex",
            reason: `'unset' targets shell variable ${unsetArg} (exec-influencing / integer-attr / IFS / PS4)`,
            nodeType: "command",
          };
        trackedVariables.set(unsetArg, "");
      }
    } else if (commandName === "print")
      for (
        let printArgIndex = 1;
        printArgIndex < remainingArgv.length;
        printArgIndex++
      ) {
        let printOption = remainingArgv[printArgIndex];
        if (
          printOption === "--" ||
          printOption === "-" ||
          !printOption.startsWith("-")
        )
          break;
        let printConsumesOperand = !1;
        for (
          let printOptionIndex = 1;
          printOptionIndex < printOption.length;
          printOptionIndex++
        ) {
          let printOptionChar = printOption[printOptionIndex];
          if (printOptionChar === "v") {
            let printTarget =
              printOptionIndex < printOption.length - 1
                ? printOption.slice(printOptionIndex + 1)
                : remainingArgv[printArgIndex + 1];
            if (printTarget) recordVariableWrite(printTarget);
            printConsumesOperand = printOptionIndex === printOption.length - 1;
            break;
          }
          if (ZSH_PRINT_OPTIONS_WITH_OPERANDS.has("-" + printOptionChar)) {
            printConsumesOperand = printOptionIndex === printOption.length - 1;
            break;
          }
        }
        if (printConsumesOperand) printArgIndex++;
      }
    else if (commandName === "set")
      for (
        let setArgIndex = 1;
        setArgIndex < remainingArgv.length;
        setArgIndex++
      ) {
        let setOption = remainingArgv[setArgIndex];
        if (setOption === "--" || !/^[-+]/.test(setOption)) break;
        let setArrayOptionIndex = setOption.indexOf("A", 1);
        if (setArrayOptionIndex === -1) {
          if (setOption.endsWith("o")) setArgIndex++;
          continue;
        }
        if (setArrayOptionIndex < setOption.length - 1)
          recordVariableWrite(setOption.slice(setArrayOptionIndex + 1));
        else if (remainingArgv[setArgIndex + 1])
          recordVariableWrite(remainingArgv[setArgIndex + 1]);
        break;
      }
    else if (commandName === "mapfile" || commandName === "readarray") {
      let mapfileHasTarget = !1;
      for (
        let mapfileArgIndex = 1;
        mapfileArgIndex < remainingArgv.length;
        mapfileArgIndex++
      ) {
        let mapfileArg = remainingArgv[mapfileArgIndex];
        if (mapfileArg.startsWith("-")) {
          if (/^-[dnOsuCc]$/.test(mapfileArg)) mapfileArgIndex++;
          continue;
        }
        (recordVariableWrite(mapfileArg), (mapfileHasTarget = !0));
      }
      if (!mapfileHasTarget) writtenVariableNames.push("MAPFILE");
    } else if (
      !wrapperAltersExecution &&
      (commandName === "cd" ||
        commandName === "chdir" ||
        commandName === "pushd" ||
        commandName === "popd")
    ) {
      let directoryUnchanged = !1;
      if (commandName === "pushd" || commandName === "popd")
        for (
          let directoryArgIndex = 1;
          directoryArgIndex < remainingArgv.length;
          directoryArgIndex++
        ) {
          let directoryArg = remainingArgv[directoryArgIndex];
          if (directoryArg === "--") break;
          if (/^-[a-zA-Z]*n[a-zA-Z]*$/.test(directoryArg)) {
            directoryUnchanged = !0;
            break;
          }
          if (
            commandName === "popd" &&
            (/^\+0*[1-9]/.test(directoryArg) || /^-0+$/.test(directoryArg))
          ) {
            directoryUnchanged = !0;
            break;
          }
        }
      if (!directoryUnchanged)
        (trackedVariables.set("PWD", UNKNOWN_TRACKED_VALUE),
          trackedVariables.set("OLDPWD", UNKNOWN_TRACKED_VALUE));
      if (commandName === "pushd" || commandName === "popd")
        (trackedVariables.set("DIRSTACK", UNKNOWN_TRACKED_VALUE),
          trackedVariables.set("dirstack", UNKNOWN_TRACKED_VALUE));
    }
    if (
      commandName !== void 0 &&
      envVars.length > 0 &&
      ENV_PREFIX_COMMITTING_BUILTINS.has(commandName)
    )
      for (let committingEnvVar of envVars) {
        recordVariableWrite(committingEnvVar.name);
      }
    for (let writtenName of writtenVariableNames) {
      if (isSensitiveShellVariable(writtenName))
        return {
          kind: "too-complex",
          reason: `'${commandName ?? envVars[0]?.name}' writes shell variable ${writtenName} (exec-influencing / integer-attr / IFS) \u2014 value cannot be statically verified`,
          nodeType: "command",
        };
      trackedVariables.set(writtenName, UNKNOWN_TRACKED_VALUE);
    }
    return (bareAssignmentNames.push(...detectedBareAssignments), null);
  }

  // upstream za @ 142814-144788
  function analyzeSimpleCommand(
    commandNode,
    initialRedirects,
    commands,
    trackedVariables,
    bareAssignmentNames,
  ) {
    let argv = [],
      envVars = [],
      redirects = [...initialRedirects];
    for (let child of commandNode.children) {
      if (!child) continue;
      switch (child.type) {
        case "variable_assignment": {
          if (envVars.length > 0) {
            let prefixDependency = findEnvPrefixDependency(
              child,
              new Set(envVars.map((priorEnvVar) => priorEnvVar.name)),
            );
            if (prefixDependency !== null)
              return {
                kind: "too-complex",
                reason: `Env-prefix value references \`$${prefixDependency}\` assigned by an earlier env-prefix in the same command \u2014 runtime sees the earlier assignment, static analysis does not`,
                nodeType: "variable_assignment",
              };
          }
          let assignment = evaluateVariableAssignment(
            child,
            commands,
            trackedVariables,
            bareAssignmentNames,
          );
          if ("kind" in assignment) return assignment;
          if (
            assignmentRequiresArithmeticEvaluation(
              assignment.name,
              assignment.value,
            )
          )
            return {
              kind: "too-complex",
              reason: `${assignment.name} has integer attribute \u2014 env-prefix arith-evals value, which can execute subscript command substitution or abort/diverge at runtime`,
              nodeType: "variable_assignment",
            };
          envVars.push({ name: assignment.name, value: assignment.value });
          break;
        }
        case "command_name": {
          let commandNameNode = child.children[0] ?? child;
          if (subprocessEnvironmentScrubbingEnabled()) {
            if (
              commandNameNode.type === "simple_expansion" ||
              commandNameNode.type === "expansion"
            )
              return tooComplexForNode(commandNameNode);
            if (
              (commandNameNode.type === "string" ||
                commandNameNode.type === "concatenation") &&
              containsParameterExpansion(commandNameNode)
            )
              return tooComplexForNode(commandNameNode);
          }
          let commandName = evaluateArgument(
            commandNameNode,
            commands,
            trackedVariables,
            bareAssignmentNames,
          );
          if (typeof commandName !== "string") return commandName;
          argv.push(commandName);
          break;
        }
        case "word":
        case "number":
        case "raw_string":
        case "string":
        case "concatenation":
        case "arithmetic_expansion": {
          let argumentValue = evaluateArgument(
            child,
            commands,
            trackedVariables,
            bareAssignmentNames,
          );
          if (typeof argumentValue !== "string") return argumentValue;
          if (
            /^--?[\nA-Za-z0-9_]/.test(argumentValue) &&
            hasUnknownTrackedValue(argumentValue)
          )
            return {
              kind: "too-complex",
              reason:
                "Argument starting with `-` contains runtime-determined content",
              nodeType: child.type,
            };
          argv.push(argumentValue);
          break;
        }
        case "simple_expansion": {
          let expansionValue = evaluateVariableExpansion(
            child,
            trackedVariables,
            !1,
          );
          if (typeof expansionValue !== "string") return expansionValue;
          argv.push(expansionValue);
          break;
        }
        case "file_redirect": {
          let redirect = analyzeFileRedirect(
            child,
            commands,
            trackedVariables,
            bareAssignmentNames,
          );
          if ("kind" in redirect) return redirect;
          redirects.push(redirect);
          break;
        }
        case "herestring_redirect": {
          let herestringError = analyzeHerestringRedirect(
            child,
            commands,
            trackedVariables,
            bareAssignmentNames,
          );
          if (herestringError) return herestringError;
          break;
        }
        default:
          return tooComplexForNode(child);
      }
    }
    {
      let sideEffectError = trackCommandSideEffects(
        argv,
        envVars,
        trackedVariables,
        bareAssignmentNames,
      );
      if (sideEffectError) return sideEffectError;
    }
    let quoteShellArgument = (value, argumentIndex) =>
        value === "" ||
        /["'\\ \t\n$`;|&<>(){}#]/.test(value) ||
        (argumentIndex === 0 && value.includes("="))
          ? `'${value.replaceAll("'", "'\\''")}'`
          : value,
      commandText =
        /\$[A-Za-z_]/.test(commandNode.text) ||
        commandNode.text.includes(`
`)
          ? [
              ...envVars.map(
                (serializedEnvVar) =>
                  `${serializedEnvVar.name}=${quoteShellArgument(serializedEnvVar.value)}`,
              ),
              ...argv.map((serializedArg, serializationIndex) =>
                quoteShellArgument(serializedArg, serializationIndex),
              ),
            ].join(" ")
          : commandNode.text,
      containsUnquotedGlob = hasUnquotedGlob(commandNode.text);
    return {
      kind: "simple",
      commands: [
        {
          argv: argv,
          envVars: envVars,
          redirects: redirects,
          text: commandText,
          hasUnquotedGlob: containsUnquotedGlob,
        },
      ],
      bareAssignmentNames: [],
    };
  }

  // upstream nr @ 144788-145034
  function analyzeCommandSubstitution(
    substitutionNode,
    commands,
    trackedVariables,
    modifiedVariables,
  ) {
    let substitutionVariables = new Map(trackedVariables),
      initialCommandCount = commands.length,
      hasContent = !1;
    for (let child of substitutionNode.children) {
      if (!child) continue;
      if (child.type === "$(" || child.type === "`" || child.type === ")")
        continue;
      if (child.type !== "comment") hasContent = !0;
      let analysisFailure = analyzeNode(
        child,
        commands,
        substitutionVariables,
        modifiedVariables,
      );
      if (analysisFailure) return analysisFailure;
    }
    if (hasContent && commands.length === initialCommandCount)
      appendNoopCommand(commands, substitutionNode);
    return null;
  }

  // upstream Ie @ 145034-147538
  function evaluateArgument(
    argumentNode,
    commands,
    trackedVariables,
    modifiedVariables,
  ) {
    if (!argumentNode)
      return { kind: "too-complex", reason: "Null argument node" };
    switch (argumentNode.type) {
      case "word": {
        if (BRACE_EXPANSION_PATTERN.test(argumentNode.text))
          return {
            kind: "too-complex",
            reason: "Word contains brace expansion syntax",
            nodeType: "word",
            differential: !0,
          };
        if (
          ESCAPED_BRACE_CLOSE_PATTERN.test(argumentNode.text) ||
          ESCAPED_BRACE_OPEN_PATTERN.test(argumentNode.text)
        )
          return {
            kind: "too-complex",
            reason: "Brace body contains backslash-escaped brace",
            nodeType: "word",
            differential: !0,
          };
        if (UNESCAPED_EXPANSION_SIGIL_PATTERN.test(argumentNode.text))
          return {
            kind: "too-complex",
            reason:
              "Word contains unescaped ` or $ \u2014 parser missed expansion",
            nodeType: "word",
            differential: !0,
          };
        if (UNESCAPED_QUOTE_PATTERN.test(argumentNode.text))
          return {
            kind: "too-complex",
            reason:
              "Word contains unescaped quote \u2014 parser absorbed quote into brace-body word",
            nodeType: "word",
          };
        return argumentNode.text.replace(/\\(.)/g, "$1");
      }
      case "number":
        if (argumentNode.children.length > 0)
          return {
            kind: "too-complex",
            reason:
              "Number node contains expansion (NN# arithmetic base syntax)",
            nodeType: argumentNode.children[0]?.type,
          };
        return argumentNode.text;
      case "raw_string":
        return stripQuotes(argumentNode.text);
      case "string":
        return evaluateDoubleQuotedString(
          argumentNode,
          commands,
          trackedVariables,
          modifiedVariables,
        );
      case "concatenation": {
        if (BRACE_EXPANSION_PATTERN.test(argumentNode.text))
          return {
            kind: "too-complex",
            reason: "Brace expansion",
            nodeType: "concatenation",
            differential: !0,
          };
        if (
          ESCAPED_BRACE_CLOSE_PATTERN.test(argumentNode.text) ||
          ESCAPED_BRACE_OPEN_PATTERN.test(argumentNode.text)
        )
          return {
            kind: "too-complex",
            reason: "Brace body contains backslash-escaped brace",
            nodeType: "concatenation",
            differential: !0,
          };
        let value = "",
          hasUnquotedBrace = !1,
          previousEndIndex = argumentNode.startIndex;
        for (
          let childIndex = 0;
          childIndex < argumentNode.children.length;
          childIndex++
        ) {
          let child = argumentNode.children[childIndex];
          if (!child) continue;
          if (child.startIndex > previousEndIndex)
            return {
              kind: "too-complex",
              reason:
                "Concatenation has unparsed bytes between children \u2014 parser dropped content that shell will see",
              nodeType: "concatenation",
            };
          if (
            ((previousEndIndex = child.endIndex),
            child.type === "word" && child.text.includes("{"))
          )
            hasUnquotedBrace = !0;
          if (
            (child.type === "simple_expansion" || child.type === "expansion") &&
            (argumentNode.children[childIndex + 1]?.text.startsWith("[") ||
              /^:[a-zA-Z&]/.test(
                argumentNode.children[childIndex + 1]?.text ?? "",
              ))
          )
            return {
              kind: "too-complex",
              reason:
                "zsh $name[expr] / $name:mod in bare concatenation \u2014 recursive eval",
              nodeType: "concatenation",
              differential: !0,
            };
          let childValue = evaluateArgument(
            child,
            commands,
            trackedVariables,
            modifiedVariables,
          );
          if (typeof childValue !== "string") return childValue;
          value += childValue;
        }
        if (hasUnquotedBrace && (value.includes(",") || value.includes("..")))
          return {
            kind: "too-complex",
            reason:
              "Brace expansion (unquoted `{` in concatenation with `,`/`..`)",
            nodeType: "concatenation",
          };
        if (ZSH_DYNAMIC_DIRECTORY_PATTERN.test(value))
          return {
            kind: "too-complex",
            reason: "zsh ~[ dynamic directory syntax (post-collapse)",
            nodeType: "concatenation",
            differential: !0,
          };
        if (ZSH_EQUALS_EXPANSION_PATTERN.test(value))
          return {
            kind: "too-complex",
            reason: "zsh =cmd expansion (post-collapse)",
            nodeType: "concatenation",
            differential: !0,
          };
        return value;
      }
      case "arithmetic_expansion": {
        let validationError = validateArithmeticExpansion(argumentNode);
        if (validationError) return validationError;
        return UNKNOWN_TRACKED_VALUE;
      }
      case "simple_expansion":
        return evaluateVariableExpansion(argumentNode, trackedVariables, !1);
      default:
        return tooComplexForNode(argumentNode);
    }
  }

  // upstream Yo @ 147538-149853
  function evaluateDoubleQuotedString(
    stringNode,
    commands,
    trackedVariables,
    modifiedVariables,
  ) {
    let value = "",
      previousEndIndex = -1,
      hasUnknownValue = !1,
      hasLiteralContent = !1,
      hasEmptyExpansion = !1;
    for (let child of stringNode.children) {
      if (!child) continue;
      if (previousEndIndex !== -1 && child.startIndex > previousEndIndex) {
        let gapText = Buffer.from(stringNode.text, "utf8")
          .subarray(
            previousEndIndex - stringNode.startIndex,
            child.startIndex - stringNode.startIndex,
          )
          .toString("utf8");
        if (gapText.includes("`"))
          return {
            kind: "too-complex",
            reason:
              "Unanalyzable backtick body in double-quoted string gap \u2014 shell-evaluated value unknown",
            nodeType: "string",
            differential: !0,
          };
        if (gapText.length > 0) ((value += gapText), (hasLiteralContent = !0));
      }
      switch (((previousEndIndex = child.endIndex), child.type)) {
        case '"':
          previousEndIndex = child.endIndex;
          break;
        case "string_content":
          ((value += child.text
            .replace(/\\\n/g, "")
            .replace(/\\([$`"\\])/g, "$1")),
            (hasLiteralContent = !0));
          break;
        case DOLLAR_SIGN: {
          let nextChild =
            stringNode.children[stringNode.children.indexOf(child) + 1];
          if (nextChild?.type === "string_content") {
            if (nextChild.text.startsWith("["))
              return {
                kind: "too-complex",
                reason:
                  "Legacy $[...] arithmetic inside double-quotes \u2014 recursive subscript eval",
                nodeType: "string",
                differential: !0,
              };
            if (/^[+^=~]/.test(nextChild.text))
              return {
                kind: "too-complex",
                reason:
                  "zsh $+/$^/$=/$~ prefix-flag expansion \u2014 value defeats downstream content checks",
                nodeType: "string",
                differential: !0,
              };
          }
          ((value += DOLLAR_SIGN), (hasLiteralContent = !0));
          break;
        }
        case "command_substitution": {
          let heredocBody = extractStaticCatHeredoc(child);
          if (heredocBody === "DANGEROUS") return tooComplexForNode(child);
          if (heredocBody !== null) {
            let trimmedBody = heredocBody.replace(/\n+$/, "");
            if (
              trimmedBody.includes(`
`)
            ) {
              if (/^--?[A-Za-z0-9]/.test(value + trimmedBody))
                return {
                  kind: "too-complex",
                  reason:
                    "cat-heredoc body would make the argument start with option syntax",
                  nodeType: "command_substitution",
                };
              ((value +=
                `
` + COMMAND_SUBSTITUTION_VALUE),
                (hasLiteralContent = !0));
              break;
            }
            ((value += trimmedBody), (hasLiteralContent = !0));
            break;
          }
          let analysisFailure = analyzeCommandSubstitution(
            child,
            commands,
            trackedVariables,
            modifiedVariables,
          );
          if (analysisFailure) return analysisFailure;
          ((value += COMMAND_SUBSTITUTION_VALUE), (hasUnknownValue = !0));
          break;
        }
        case "simple_expansion": {
          let expandedValue = evaluateVariableExpansion(
            child,
            trackedVariables,
            !0,
          );
          if (typeof expandedValue !== "string") return expandedValue;
          {
            let nextChild =
                stringNode.children[stringNode.children.indexOf(child) + 1],
              hasSpecialParameter = child.children.some(
                (expansionChild) =>
                  expansionChild?.type === "special_variable_name",
              );
            if (
              nextChild?.type === "string_content" &&
              (nextChild.text.startsWith("[") ||
                /^:[a-zA-Z&]/.test(nextChild.text) ||
                (hasSpecialParameter &&
                  /^\w*(\[|:[a-zA-Z&])/.test(nextChild.text)))
            )
              return {
                kind: "too-complex",
                reason:
                  'zsh "$name[expr]" / "$name:mod" inside double-quotes \u2014 recursive eval',
                nodeType: "string",
                differential: !0,
              };
          }
          if (hasUnknownTrackedValue(expandedValue)) hasUnknownValue = !0;
          else if (expandedValue !== "") hasLiteralContent = !0;
          else hasEmptyExpansion = !0;
          value += expandedValue;
          break;
        }
        case "arithmetic_expansion": {
          let validationError = validateArithmeticExpansion(child);
          if (validationError) return validationError;
          ((value += UNKNOWN_TRACKED_VALUE), (hasUnknownValue = !0));
          break;
        }
        default:
          return tooComplexForNode(child);
      }
    }
    if (hasUnknownValue) {
      if (
        [
          ...value
            .replaceAll(COMMAND_SUBSTITUTION_VALUE, "")
            .replaceAll(UNKNOWN_TRACKED_VALUE, ""),
        ].length <= 1
      )
        return tooComplexForNode(stringNode);
    }
    if (
      !hasLiteralContent &&
      !hasUnknownValue &&
      !hasEmptyExpansion &&
      stringNode.text.length > 2
    ) {
      let rawContents = stringNode.text.slice(1, -1);
      if (rawContents.includes("`") || rawContents.includes("$("))
        return {
          kind: "too-complex",
          reason:
            "Delimiters-only string node contains unparsed command substitution",
          nodeType: "string",
          differential: !0,
        };
      return rawContents;
    }
    return value;
  }

  // upstream Ba @ 149857-149973
  const STATIC_ARITHMETIC_TOKEN_PATTERN =
    /^(?:[0-9]+|0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[-+*/%^&|~!<>=?:(),]+|<<|>>|\*\*|&&|\|\||[<>=!]=|\$\(\(|\)\))$/;

  // upstream rr @ 149974-150403
  function validateArithmeticExpansion(arithmeticNode) {
    for (let child of arithmeticNode.children) {
      if (!child) continue;
      if (child.children.length === 0) {
        if (!STATIC_ARITHMETIC_TOKEN_PATTERN.test(child.text))
          return {
            kind: "too-complex",
            reason: `Arithmetic expansion references variable or non-literal: ${child.text}`,
            nodeType: "arithmetic_expansion",
          };
        continue;
      }
      switch (child.type) {
        case "binary_expression":
        case "unary_expression":
        case "ternary_expression":
        case "parenthesized_expression": {
          let validationError = validateArithmeticExpansion(child);
          if (validationError) return validationError;
          break;
        }
        default:
          return tooComplexForNode(child);
      }
    }
    return null;
  }

  // upstream nt @ 150403-150507
  function appendNoopCommand(commands, node) {
    commands.push({
      argv: ["true"],
      envVars: [],
      redirects: [],
      text: node.text,
      hasUnquotedGlob: hasUnquotedGlob(node.text),
    });
  }

  // upstream qn @ 150507-150620
  function containsArithmeticExpansion(node) {
    if (node.type === "arithmetic_expansion") return !0;
    for (let child of node.children) {
      if (child && containsArithmeticExpansion(child)) return !0;
    }
    return !1;
  }

  // upstream Ga @ 150620-151298
  function extractStaticCatHeredoc(substitutionNode) {
    let redirectedStatement = null;
    for (let child of substitutionNode.children) {
      if (!child) continue;
      if (child.type === "$(" || child.type === ")") continue;
      if (child.type === "redirected_statement" && redirectedStatement === null)
        redirectedStatement = child;
      else return null;
    }
    if (!redirectedStatement) return null;
    let hasCatCommand = !1,
      heredocBody = null;
    for (let child of redirectedStatement.children) {
      if (!child) continue;
      if (child.type === "command") {
        let commandChildren = child.children.filter(
          (commandChild) => commandChild,
        );
        if (commandChildren.length !== 1) return null;
        let commandName = commandChildren[0];
        if (commandName?.type !== "command_name" || commandName.text !== "cat")
          return null;
        hasCatCommand = !0;
      } else if (child.type === "heredoc_redirect") {
        if (analyzeHeredocRedirect(child) !== null) return null;
        for (let heredocChild of child.children) {
          if (heredocChild?.type === "<<-") return null;
          if (heredocChild?.type === "heredoc_body")
            heredocBody = heredocChild.text;
        }
      } else return null;
    }
    if (!hasCatCommand || heredocBody === null) return null;
    if (PROC_ENVIRON_PATTERN.test(heredocBody)) return "DANGEROUS";
    if (findDangerousAwkFeature(heredocBody) !== !1) return "DANGEROUS";
    return heredocBody;
  }

  // upstream Zn @ 151298-152879
  function evaluateVariableAssignment(
    assignmentNode,
    commands,
    trackedVariables,
    modifiedVariables,
  ) {
    let variableName = null,
      value = "",
      isAppend = !1;
    for (let child of assignmentNode.children) {
      if (!child) continue;
      if (child.type === "variable_name") variableName = child.text;
      else if (child.type === "=" || child.type === "+=") {
        isAppend = child.type === "+=";
        continue;
      } else if (child.type === "command_substitution") {
        let analysisFailure = analyzeCommandSubstitution(
          child,
          commands,
          trackedVariables,
          modifiedVariables,
        );
        if (analysisFailure) return analysisFailure;
        value = COMMAND_SUBSTITUTION_VALUE;
      } else if (child.type === "simple_expansion") {
        let expandedValue = evaluateVariableExpansion(
          child,
          trackedVariables,
          !0,
        );
        if (typeof expandedValue !== "string") return expandedValue;
        value = expandedValue;
      } else {
        let argumentValue = evaluateArgument(
          child,
          commands,
          trackedVariables,
          modifiedVariables,
        );
        if (typeof argumentValue !== "string") return argumentValue;
        value = argumentValue;
      }
    }
    if (variableName === null)
      return {
        kind: "too-complex",
        reason: "Variable assignment without name",
        nodeType: "variable_assignment",
      };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName))
      return {
        kind: "too-complex",
        reason: `Invalid variable name (bash treats as command): ${variableName}`,
        nodeType: "variable_assignment",
      };
    if (variableName === "IFS")
      return {
        kind: "too-complex",
        reason:
          "IFS assignment changes word-splitting \u2014 cannot model statically",
        nodeType: "variable_assignment",
      };
    if (variableName === "PS4" || variableName === "PROMPT4") {
      if (isAppend)
        return {
          kind: "too-complex",
          reason:
            "PS4 += cannot be statically verified \u2014 combine into a single PS4= assignment",
          nodeType: "variable_assignment",
        };
      if (hasUnknownTrackedValue(value))
        return {
          kind: "too-complex",
          reason:
            "PS4 value derived from cmdsub/variable \u2014 runtime unknowable",
          nodeType: "variable_assignment",
        };
      if (
        !/^[A-Za-z0-9 _+:./=[\]-]*$/.test(
          value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, ""),
        )
      )
        return {
          kind: "too-complex",
          reason:
            "PS4 value outside safe charset \u2014 only ${VAR} refs and [A-Za-z0-9 _+:.=/[]-] allowed",
          nodeType: "variable_assignment",
        };
    }
    if (value.includes("~"))
      return {
        kind: "too-complex",
        reason:
          "Tilde in assignment value \u2014 bash may expand at assignment time",
        nodeType: "variable_assignment",
      };
    return { name: variableName, value: value, isAppend: isAppend };
  }

  // upstream Vo @ 152883-153424
  const VOLATILE_SHELL_VARIABLES = new Set([
    "_",
    "RANDOM",
    "SECONDS",
    "LINENO",
    "BASH_COMMAND",
    "FUNCNAME",
    "EPOCHSECONDS",
    "EPOCHREALTIME",
    "SRANDOM",
    "BASHPID",
    "HISTCMD",
    "ERRNO",
    "REPLY",
    "reply",
    "PIPESTATUS",
    "pipestatus",
    "BASH_SOURCE",
    "DIRSTACK",
    "GROUPS",
    "BASH_ARGV",
    "BASH_ARGC",
    "BASH_SUBSHELL",
    "BASH_LINENO",
    "BASH_REMATCH",
    "MATCH",
    "match",
    "MBEGIN",
    "MEND",
    "mbegin",
    "mend",
    "OPTARG",
    "OPTIND",
    "argv",
    "FIGNORE",
    "fignore",
    "PSVAR",
    "psvar",
    "WATCH",
    "watch",
    "HISTCHARS",
    "histchars",
    "PS1",
    "PROMPT",
    "prompt",
    "PS2",
    "PROMPT2",
    "PS3",
    "PROMPT3",
    "PS4",
    "PROMPT4",
    "RPS1",
    "RPROMPT",
    "RPS2",
    "RPROMPT2",
  ]);

  // upstream Vt @ 153425-153961
  function evaluateVariableExpansion(
    expansionNode,
    trackedVariables,
    isQuoted,
  ) {
    let variableName = null,
      isSpecialParameter = !1;
    for (let child of expansionNode.children) {
      if (child?.type === "variable_name") {
        variableName = child.text;
        break;
      }
      if (child?.type === "special_variable_name") {
        ((variableName = child.text), (isSpecialParameter = !0));
        break;
      }
    }
    if (variableName === null) return tooComplexForNode(expansionNode);
    let trackedValue = trackedVariables.get(variableName);
    if (trackedValue !== void 0) {
      if (VOLATILE_SHELL_VARIABLES.has(variableName))
        return isQuoted &&
          INHERITED_SHELL_VARIABLES.has(variableName) &&
          variableName !== "BASHPID"
          ? UNKNOWN_TRACKED_VALUE
          : tooComplexForNode(expansionNode);
      if (hasUnknownTrackedValue(trackedValue)) {
        if (!isQuoted) return tooComplexForNode(expansionNode);
        return trackedValue;
      }
      if (!isQuoted) {
        if (trackedValue === "") return tooComplexForNode(expansionNode);
        if (UNSAFE_UNQUOTED_VALUE_PATTERN.test(trackedValue))
          return tooComplexForNode(expansionNode);
      }
      return trackedValue;
    }
    if (variableName === "HOME") {
      let homeDirectory = homedir();
      if (
        !isQuoted &&
        (homeDirectory === "" ||
          UNSAFE_UNQUOTED_VALUE_PATTERN.test(homeDirectory))
      )
        return tooComplexForNode(expansionNode);
      return homeDirectory;
    }
    if (isQuoted) {
      if (INHERITED_SHELL_VARIABLES.has(variableName))
        return UNKNOWN_TRACKED_VALUE;
      if (
        isSpecialParameter &&
        (SAFE_SPECIAL_PARAMETERS.has(variableName) ||
          /^[0-9]+$/.test(variableName))
      )
        return UNKNOWN_TRACKED_VALUE;
    }
    return tooComplexForNode(expansionNode);
  }

  // upstream Nn @ 153961-153986
  function invalidateVariablesModifiedByNode(trackedVariables, node) {
    invalidateModifiedVariables(node, trackedVariables);
  }

  // upstream Po @ 153986-154513
  function invalidateUnsetTargets(nodes, trackedVariables) {
    let invalidateAll = () => {
      for (let variableName of trackedVariables.keys()) {
        trackedVariables.set(variableName, UNKNOWN_TRACKED_VALUE);
      }
    };
    for (let target of nodes) {
      if (target?.type === "unset" && target.text === "unsetenv") return;
      if (
        !target ||
        target.type === "unset" ||
        target.type === "file_redirect" ||
        target.type === "heredoc_redirect" ||
        target.type === "herestring_redirect"
      )
        continue;
      if (target.type === "variable_name") {
        trackedVariables.set(
          target.text.replace(/\\/g, ""),
          UNKNOWN_TRACKED_VALUE,
        );
        continue;
      }
      if (target.type === "word") {
        if (target.text.startsWith("-")) {
          if (target.text === "--" || /^-[fvn]+$/.test(target.text)) continue;
          invalidateAll();
          continue;
        }
        if (/^\\?[A-Za-z_][A-Za-z0-9_]*$/.test(target.text)) {
          trackedVariables.set(
            target.text.replace(/^\\/, ""),
            UNKNOWN_TRACKED_VALUE,
          );
          continue;
        }
      }
      invalidateAll();
    }
  }

  // upstream Xn @ 154513-154952
  function extractStaticWord(node) {
    if (!node) return null;
    switch (node.type) {
      case "word":
      case "number":
        return node.text.replace(/\\(.)/g, "$1");
      case "raw_string":
        return node.text.slice(1, -1);
      case "string": {
        let contentNodes = node.children.filter(
          (contentChild) => contentChild && contentChild.type !== '"',
        );
        if (contentNodes.length === 0) return "";
        if (
          contentNodes.length === 1 &&
          contentNodes[0]?.type === "string_content"
        )
          return contentNodes[0].text;
        return null;
      }
      case "concatenation": {
        let result = "";
        for (let concatChild of node.children) {
          let part = extractStaticWord(concatChild);
          if (part === null) return null;
          result += part;
        }
        return result;
      }
      default:
        return null;
    }
  }

  // upstream kt @ 154952-157656
  function invalidateModifiedVariables(node, trackedVariables) {
    if (
      node.type === "function_definition" ||
      node.type === "subshell" ||
      node.type === "command_substitution" ||
      node.type === "process_substitution"
    )
      return;
    if (node.type === "pipeline") {
      let lastCommand = null;
      for (let pipelineChild of node.children) {
        if (pipelineChild && !SHELL_OPERATOR_TYPES.has(pipelineChild.type))
          lastCommand = pipelineChild;
      }
      if (lastCommand)
        invalidateModifiedVariables(lastCommand, trackedVariables);
      return;
    }
    if (node.type === "list" || node.type === "program") {
      let children = node.children;
      for (let listIndex = 0; listIndex < children.length; listIndex++) {
        let listChild = children[listIndex];
        if (!listChild || SHELL_OPERATOR_TYPES.has(listChild.type)) continue;
        let nextIndex = listIndex + 1;
        while (nextIndex < children.length && !children[nextIndex]) nextIndex++;
        if (children[nextIndex]?.type === "&") continue;
        invalidateModifiedVariables(listChild, trackedVariables);
      }
      return;
    }
    if (node.type === "variable_assignment") {
      for (let assignmentChild of node.children) {
        if (assignmentChild?.type === "variable_name") {
          trackedVariables.set(assignmentChild.text, UNKNOWN_TRACKED_VALUE);
          break;
        }
      }
    }
    if (node.type === "for_statement") {
      for (let loopChild of node.children) {
        if (loopChild?.type === "variable_name") {
          trackedVariables.set(loopChild.text, UNKNOWN_TRACKED_VALUE);
          break;
        }
      }
    }
    if (node.type === "unset_command")
      invalidateUnsetTargets(node.children, trackedVariables);
    if (node.type === "command") {
      let commandName,
        commandNameNode,
        argumentTexts = [],
        argumentNodes = [],
        foundCommandName = !1;
      for (let commandPart of node.children) {
        if (!commandPart) continue;
        if (commandPart.type === "command_name")
          ((commandNameNode = commandPart),
            (commandName =
              extractStaticWord(commandPart.children[0] ?? commandPart) ??
              void 0),
            (foundCommandName = !0));
        else if (
          !foundCommandName ||
          commandPart.type === "file_redirect" ||
          commandPart.type === "herestring_redirect" ||
          commandPart.type === "heredoc_redirect"
        );
        else
          (argumentTexts.push(extractStaticWord(commandPart) ?? ""),
            argumentNodes.push(commandPart));
      }
      let skipCommandEffects = !1,
        previousWrapper;
      while (
        commandName !== void 0 &&
        (COMMAND_PREFIX_WRAPPERS.has(commandName) || commandName === "!")
      ) {
        if (
          (previousWrapper === "builtin" || previousWrapper === "command") &&
          commandName !== "builtin" &&
          commandName !== "command" &&
          commandName !== "noglob"
        )
          skipCommandEffects = !0;
        let currentWrapper = commandName === "!" ? void 0 : commandName;
        while (argumentTexts.length > 0) {
          let wrapperArgument = argumentTexts[0];
          if (/^-[-pvV]*$/.test(wrapperArgument)) {
            if (/[vV]/.test(wrapperArgument)) skipCommandEffects = !0;
            (argumentTexts.shift(), argumentNodes.shift());
          } else if (/^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.test(wrapperArgument)) {
            let assignmentName = wrapperArgument.match(
              /^[A-Za-z_][A-Za-z0-9_]*/,
            )[0];
            (trackedVariables.set(assignmentName, UNKNOWN_TRACKED_VALUE),
              argumentTexts.shift(),
              argumentNodes.shift(),
              (currentWrapper = void 0));
          } else break;
        }
        ((previousWrapper = currentWrapper),
          (commandName = argumentTexts.shift()),
          argumentNodes.shift());
      }
      let remainingArguments = argumentTexts,
        invalidateVariable = (targetName) => {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(targetName))
            trackedVariables.set(targetName, UNKNOWN_TRACKED_VALUE);
        };
      if (commandName === "read") {
        trackedVariables.set("REPLY", UNKNOWN_TRACKED_VALUE);
        let readIndex = 0,
          optionsEnded = !1;
        while (readIndex < remainingArguments.length) {
          let readArgument = remainingArguments[readIndex];
          if (!optionsEnded && readArgument === "--") {
            ((optionsEnded = !0), readIndex++);
            continue;
          }
          if (!optionsEnded && readArgument.startsWith("-")) {
            if (READ_OPTIONS_WITH_OPERANDS.has(readArgument)) {
              readIndex += 2;
              continue;
            }
            let consumesNext = !1;
            for (
              let optionIndex = 1;
              optionIndex < readArgument.length;
              optionIndex++
            ) {
              let option = readArgument[optionIndex];
              if (option === "a" || option === "A") {
                (invalidateVariable(
                  optionIndex < readArgument.length - 1
                    ? readArgument.slice(optionIndex + 1)
                    : (remainingArguments[readIndex + 1] ?? ""),
                ),
                  (consumesNext = optionIndex === readArgument.length - 1));
                break;
              }
              if (READ_OPTIONS_WITH_OPERANDS.has("-" + option)) {
                consumesNext = optionIndex === readArgument.length - 1;
                break;
              }
            }
            readIndex += consumesNext ? 2 : 1;
            continue;
          }
          (invalidateVariable(readArgument), readIndex++);
        }
      } else if (commandName === "mapfile" || commandName === "readarray") {
        trackedVariables.set("MAPFILE", UNKNOWN_TRACKED_VALUE);
        for (
          let mapfileIndex = 0;
          mapfileIndex < remainingArguments.length;
          mapfileIndex++
        ) {
          let mapfileArgument = remainingArguments[mapfileIndex];
          if (mapfileArgument.startsWith("-")) {
            if (/^-[dnOsuCc]$/.test(mapfileArgument)) mapfileIndex++;
            continue;
          }
          invalidateVariable(mapfileArgument);
        }
      } else if (commandName === "unset" && !skipCommandEffects)
        invalidateUnsetTargets(argumentNodes, trackedVariables);
      let commandWord = commandNameNode?.children[0],
        originalCommandName =
          commandWord?.type === "word"
            ? commandWord.text.replace(/\\(.)/g, "$1")
            : void 0,
        assignmentsAreTemporary =
          originalCommandName !== void 0 &&
          !ENV_PREFIX_COMMITTING_BUILTINS.has(originalCommandName) &&
          !COMMAND_PREFIX_WRAPPERS.has(originalCommandName) &&
          !DECLARATION_COMMAND_NAMES.has(originalCommandName);
      for (let commandChild of node.children) {
        if (
          commandChild &&
          (commandChild.type !== "variable_assignment" ||
            !assignmentsAreTemporary)
        )
          invalidateModifiedVariables(commandChild, trackedVariables);
      }
      return;
    }
    if (node.type === "declaration_command") {
      for (let declarationChild of node.children) {
        if (
          declarationChild?.type === "string" ||
          declarationChild?.type === "raw_string" ||
          declarationChild?.type === "word" ||
          declarationChild?.type === "number" ||
          declarationChild?.type === "concatenation" ||
          declarationChild?.type === "variable_name"
        ) {
          let text = declarationChild.text.replace(/['"\\]/g, ""),
            assignmentMatch = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/.exec(text);
          if (assignmentMatch)
            trackedVariables.set(assignmentMatch[1], UNKNOWN_TRACKED_VALUE);
          else {
            let equalsIndex = text.indexOf("=");
            if (
              equalsIndex > 0 &&
              text.lastIndexOf("$", equalsIndex - 1) !== -1
            )
              for (let variableName of [...trackedVariables.keys()]) {
                trackedVariables.set(variableName, UNKNOWN_TRACKED_VALUE);
              }
          }
        }
      }
    }
    for (let descendant of node.children) {
      if (descendant) invalidateModifiedVariables(descendant, trackedVariables);
    }
  }

  // upstream xt @ 157656-157784
  function mergeTrackedVariables(trackedVariables, branchVariables) {
    for (let [branchName, branchValue] of branchVariables) {
      let currentValue = trackedVariables.get(branchName);
      if (currentValue !== void 0 && currentValue !== branchValue)
        trackedVariables.set(branchName, UNKNOWN_TRACKED_VALUE);
    }
    for (let trackedName of trackedVariables.keys()) {
      if (!branchVariables.has(trackedName))
        trackedVariables.set(trackedName, UNKNOWN_TRACKED_VALUE);
    }
  }

  // upstream Ln @ 157784-158027
  function updateTrackedVariable(
    trackedVariables,
    assignment,
    forceUnknown = !1,
  ) {
    if (forceUnknown) {
      trackedVariables.set(assignment.name, UNKNOWN_TRACKED_VALUE);
      return;
    }
    if (assignment.isAppend && !trackedVariables.has(assignment.name)) return;
    let currentValue = trackedVariables.get(assignment.name);
    if (
      currentValue !== void 0 &&
      currentValue !== assignment.value &&
      !assignment.isAppend &&
      !hasUnknownTrackedValue(assignment.value)
    ) {
      trackedVariables.set(assignment.name, UNKNOWN_TRACKED_VALUE);
      return;
    }
    let nextValue = assignment.isAppend
      ? (currentValue ?? "") + assignment.value
      : assignment.value;
    trackedVariables.set(assignment.name, nextValue);
  }

  // upstream qo @ 158027-158063
  function stripQuotes(text) {
    return text.slice(1, -1);
  }

  // upstream Ko @ 158063-158207
  function containsParameterExpansion(node) {
    for (let child of node.children) {
      if (!child) continue;
      if (child.type === "simple_expansion" || child.type === "expansion")
        return !0;
      if (containsParameterExpansion(child)) return !0;
    }
    return !1;
  }

  // upstream Ha @ 158207-158371
  function tildeVariableName(text) {
    if (text === "~" || text.startsWith("~/")) return "HOME";
    if (text === "~+" || text.startsWith("~+/")) return "PWD";
    if (text === "~-" || text.startsWith("~-/")) return "OLDPWD";
    return null;
  }

  // upstream Zo @ 158371-158654
  function findEnvPrefixDependency(node, variableNames) {
    let isAssignment = node.type === "variable_assignment";
    for (let child of node.children) {
      if (!child) continue;
      if (child.type === "variable_name") {
        if (isAssignment) continue;
        if (variableNames.has(child.text)) return child.text;
      }
      if (child.type === "word") {
        let tildeName = tildeVariableName(child.text);
        if (tildeName !== null && variableNames.has(tildeName))
          return tildeName;
      }
      let dependency = findEnvPrefixDependency(child, variableNames);
      if (dependency !== null) return dependency;
    }
    return null;
  }

  // upstream B @ 158654-158856
  function tooComplexForNode(node) {
    return {
      kind: "too-complex",
      reason:
        node.type === "ERROR"
          ? "Parse error"
          : DYNAMIC_SHELL_NODE_TYPES.has(node.type)
            ? `Contains ${node.type}`
            : `Contains shell syntax (${node.type}) that cannot be statically analyzed`,
      nodeType: node.type,
    };
  }

  // upstream Xo @ 159950-160701
  function findDangerousAwkFeature(program) {
    if (/(?<![A-Za-z_])system[\s\\]*\(/.test(program))
      return "awk program contains system() which executes arbitrary commands";
    if (
      /(?:^|[^|])\|&?[^/|%";#{}]*"/.test(program) ||
      /(?:^|[^|])\|&?[\s\\]*getline\b/.test(program)
    )
      return 'awk program contains a command pipe (| "cmd" or | getline) which executes arbitrary commands';
    if (
      /@[\s\\]*(?:load|include)\b|@[\s\\]*\w+(?:::\w+)?(?:\[[^\]]*\])*[\s\\]*\(/.test(
        program,
      )
    )
      return "awk program contains @load/@include or an @indirect call which can execute arbitrary code";
    if (/(?<![A-Za-z_])extension[\s\\]*\(/.test(program))
      return "awk program contains extension() which loads arbitrary native code (legacy gawk)";
    if (/"\/inet[46]?\//.test(program))
      return "awk program opens a gawk /inet/ network socket which can exfiltrate data";
    return !1;
  }

  // upstream Va @ 161846-162226
  const EXECUTION_INFLUENCING_ZSH_VARIABLES = new Set([
    "path",
    "home",
    "tmpprefix",
    "bash_env",
    "env",
    "cdpath",
    "globignore",
    "shell",
    "fpath",
    "bash_loadables_path",
    "module_path",
    "manpath",
    "mailpath",
    "readnullcmd",
    "nullcmd",
    "histfile",
    "zdotdir",
    "functions",
    "commands",
    "aliases",
    "galiases",
    "saliases",
    "lang",
    "language",
    "lc_all",
    "lc_ctype",
    "lc_collate",
    "lc_messages",
    "lc_numeric",
    "lc_time",
    "histchars",
    "textdomain",
    "textdomaindir",
  ]);

  // upstream or @ 162227-162609
  const INTEGER_ATTRIBUTE_VARIABLES = new Set([
    "RANDOM",
    "SECONDS",
    "LINENO",
    "OPTIND",
    "MAILCHECK",
    "HISTCMD",
    "SRANDOM",
    "EPOCHSECONDS",
    "EPOCHREALTIME",
    "COLUMNS",
    "LINES",
    "SHLVL",
    "ERRNO",
    "TMOUT",
    "HISTSIZE",
    "SAVEHIST",
    "TRY_BLOCK_ERROR",
    "TRY_BLOCK_INTERRUPT",
    "KEYTIMEOUT",
    "LISTMAX",
    "LOGCHECK",
    "PERIOD",
    "FUNCNEST",
    "UID",
    "EUID",
    "GID",
    "EGID",
    "ZLE_RPROMPT_INDENT",
    "MBEGIN",
    "MEND",
    "PPID",
    "ARGC",
    "ZSH_SUBSHELL",
    "TTYIDLE",
    "status",
  ]);

  // upstream Jo @ 162610-162773
  function assignmentRequiresArithmeticEvaluation(name, value) {
    if (!INTEGER_ATTRIBUTE_VARIABLES.has(name)) return !1;
    if (
      value.includes("[") ||
      value.includes("`") ||
      /\$\(/.test(value) ||
      hasUnknownTrackedValue(value)
    )
      return !0;
    if (!/^(0|[1-9][0-9]{0,17})$/.test(value)) return !0;
    return !1;
  }

  // upstream Jn @ 162773-162899
  function affectsCommandExecution(name) {
    let lowerName = name.toLowerCase();
    return (
      EXECUTION_INFLUENCING_ZSH_VARIABLES.has(lowerName) ||
      lowerName.startsWith("ld_") ||
      lowerName.startsWith("dyld_") ||
      lowerName.startsWith("bash_func_")
    );
  }

  // upstream XTe @ 162899-162976
  function isSensitiveShellVariable(name) {
    return (
      affectsCommandExecution(name) ||
      name === "IFS" ||
      name === "PS4" ||
      name === "PROMPT4" ||
      INTEGER_ATTRIBUTE_VARIABLES.has(name)
    );
  }

  // upstream rt @ 162980-163028
  const READ_OPTIONS_WITH_OPERANDS = new Set([
    "-p",
    "-d",
    "-n",
    "-N",
    "-t",
    "-u",
    "-i",
  ]);

  // upstream Ka @ 163129-163167
  const ZSH_PRINT_OPTIONS_WITH_OPERANDS = new Set([
    "-f",
    "-C",
    "-x",
    "-X",
    "-u",
  ]);

  // upstream Qn @ 163168-163192
  const PROC_ENVIRON_PATTERN = /\/proc\/.*\/environ/;

  // upstream Ht @ 163193-163204
  const HEREDOC_COMMENT_LINE_PATTERN = /\n\s*#/;

  return classifyCommand;
}
