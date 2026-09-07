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
  function hasUnknownTrackedValue(e) {
    return (
      e.includes(COMMAND_SUBSTITUTION_VALUE) ||
      e.includes(UNKNOWN_TRACKED_VALUE)
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
    const skipIgnorableTopLevelBytes = (from, to) => {
      let cursor = from;
      while (cursor < to) {
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
  function containsExpansionErrorNode(e) {
    if (e.type === "ERROR" && e.text.startsWith("${")) return !0;
    for (let t of e.children) if (t && containsExpansionErrorNode(t)) return !0;
    return !1;
  }

  // upstream Ca @ 114284-114432
  function analyzeCommandTree(e) {
    let t = detectAdjacentStatementAmbiguity(e);
    if (t) return t;
    let r = [],
      o = new Map(),
      u = [],
      d = analyzeNode(e, r, o, u);
    if (d) return d;
    return { kind: "simple", commands: r, bareAssignmentNames: u };
  }

  // upstream Da @ 114432-114599
  function isSameLogicalLine(e, t, r) {
    return !Buffer.from(e.text, "utf8")
      .subarray(t.endIndex - e.startIndex, r.startIndex - e.startIndex)
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
  function detectAdjacentStatementAmbiguity(e) {
    let t = null;
    for (let r of e.children) {
      if (!r) continue;
      if (STATEMENT_NODE_TYPES.has(r.type)) {
        if (t !== null) {
          let u = r;
          while (CONTAINER_NODE_TYPES.has(u.type)) {
            let d = u.children.find((S) => S != null);
            if (!d) break;
            u = d;
          }
          if (
            ADJACENT_KEYWORD_STATEMENT_TYPES.has(u.type) &&
            isSameLogicalLine(e, t, u)
          )
            return {
              kind: "too-complex",
              reason:
                "statement directly follows another statement on the same line \u2014 bash reads the text as one command (`!` and shell keywords are plain words after an assignment), not two statements",
              differential: !0,
            };
        }
        t = r;
      } else t = null;
      let o = detectAdjacentStatementAmbiguity(r);
      if (o) return o;
    }
    return null;
  }

  // upstream ge @ 115493-125462
  function analyzeNode(e, t, r, o) {
    if (e.type === "command") {
      let u = analyzeSimpleCommand(e, [], t, r, o);
      if (u.kind !== "simple") return u;
      return (t.push(...u.commands), null);
    }
    if (e.type === "redirected_statement")
      return analyzeRedirectedStatement(e, t, r, o);
    if (e.type === "comment") return null;
    if (CONTAINER_NODE_TYPES.has(e.type)) {
      let u = e.type === "pipeline",
        d = t.length,
        S = !1;
      if (!u) {
        for (let k of e.children)
          if (k && (k.type === "||" || k.type === "&")) {
            S = !0;
            break;
          }
      }
      let _ = S ? new Map(r) : null,
        x = u ? new Map(r) : r,
        P = null;
      for (let k of e.children) {
        if (!k) continue;
        if (SHELL_OPERATOR_TYPES.has(k.type)) {
          if (
            k.type === "||" ||
            k.type === "|" ||
            k.type === "|&" ||
            k.type === "&"
          )
            if (k.type === "||") {
              P ??= new Set();
              for (let M of r.keys()) P.add(M);
              let T = _ ?? r;
              x = new Map(T);
              for (let [M, C] of r)
                if (T.get(M) !== C) x.set(M, UNKNOWN_TRACKED_VALUE);
              for (let M of T.keys())
                if (!r.has(M)) x.set(M, UNKNOWN_TRACKED_VALUE);
            } else x = new Map(_ ?? r);
          else if (P !== null) {
            for (let T of P) r.set(T, UNKNOWN_TRACKED_VALUE);
            ((P = null), (x = r));
          }
          continue;
        }
        let A = analyzeNode(k, t, x, o);
        if (A) return A;
      }
      if (P !== null) for (let k of P) r.set(k, UNKNOWN_TRACKED_VALUE);
      if (u) {
        if ((mergeTrackedVariables(r, x), t.length === d))
          appendNoopCommand(t, e);
      }
      return null;
    }
    if (e.type === "negated_command") {
      let u = t.length;
      for (let d of e.children) {
        if (!d) continue;
        if (d.type === "!") continue;
        let S = analyzeNode(d, t, r, o);
        if (S) return S;
      }
      if (t.length === u) appendNoopCommand(t, e);
      return null;
    }
    if (e.type === "declaration_command") {
      let u = t.length,
        d = new Map(r),
        S = !1,
        _ = !1,
        x = [],
        P = -1;
      for (let k of e.children) {
        if (!k) continue;
        let A = k.startIndex === P;
        switch (((P = k.endIndex), k.type)) {
          case "export":
          case "local":
          case "readonly":
          case "declare":
          case "typeset":
            x.push(k.text);
            break;
          case "word":
          case "number":
          case "raw_string":
          case "string":
          case "concatenation": {
            if (A)
              return {
                kind: "too-complex",
                reason: `${x[0] ?? "declaration"} operand is split across adjacent quoted segments \u2014 the shell joins them into one word the analyzer cannot verify`,
                nodeType: "declaration_command",
              };
            let T = evaluateArgument(k, t, d, o);
            if (typeof T !== "string") return T;
            if (/^[+-].*m/.test(T))
              return {
                kind: "too-complex",
                reason: `${x[0]} flag ${T} \u2014 zsh -m/+m pattern-assigns every matching variable; cannot statically model target set`,
                nodeType: "declaration_command",
              };
            if (
              (x[0] === "declare" || x[0] === "typeset" || x[0] === "local") &&
              /^[+-].*[niaAEF]/.test(T)
            )
              return {
                kind: "too-complex",
                reason: `declare flag ${T} changes assignment semantics (nameref/integer/float/array)`,
                nodeType: "declaration_command",
              };
            if (
              x[0] === "declare" ||
              x[0] === "typeset" ||
              x[0] === "local" ||
              x[0] === "readonly"
            ) {
              if (/^[+-].*f/.test(T)) S = !0;
              if (/^[+-].*[uU]/.test(T)) _ = !0;
              if (S && _)
                return {
                  kind: "too-complex",
                  reason: `${x[0]} with both -f and -u/-U flags \u2014 zsh marks a function for autoload (synonym of 'autoload'), creating a function from file contents at call time`,
                  nodeType: "declaration_command",
                };
            }
            if (
              (x[0] === "export" || x[0] === "readonly") &&
              /^[+-].*[iEF]/.test(T)
            )
              return {
                kind: "too-complex",
                reason: `${x[0]} flag ${T} \u2014 zsh bin_typeset accepts -i/-E/-F and arithmetically evaluates the RHS`,
                nodeType: "declaration_command",
              };
            if (/^[+-].*T/.test(T))
              return {
                kind: "too-complex",
                reason: `${x[0]} -T creates a user-defined zsh tied pair \u2014 tracked literals for its operands are unreliable`,
                nodeType: "declaration_command",
              };
            if (
              (x[0] === "declare" ||
                x[0] === "typeset" ||
                x[0] === "local" ||
                x[0] === "export") &&
              T[0] !== "-" &&
              /^[^=]*\[/.test(T)
            )
              return {
                kind: "too-complex",
                reason: `${x[0]} positional '${T}' contains array subscript \u2014 zsh/bash evaluate $(cmd) in subscripts`,
                nodeType: "declaration_command",
              };
            if (T[0] !== "-") {
              let M = T.indexOf("=");
              if (M > 0) {
                let C = T.slice(0, M);
                if (/^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(C)) {
                  let N = C.endsWith("+"),
                    F = N ? C.slice(0, -1) : C;
                  (updateTrackedVariable(
                    r,
                    { name: F, value: T.slice(M + 1), isAppend: N },
                    u > 0,
                  ),
                    o.push(F));
                }
              }
            }
            x.push(T);
            break;
          }
          case "variable_assignment": {
            let T = evaluateVariableAssignment(k, t, d, o);
            if ("kind" in T) return T;
            (updateTrackedVariable(r, T, u > 0),
              o.push(T.name),
              x.push(`${T.name}=${T.value}`));
            break;
          }
          case "variable_name": {
            let T = k.text;
            if (
              (x[0] === "declare" ||
                x[0] === "typeset" ||
                x[0] === "local" ||
                x[0] === "export") &&
              T[0] !== "-" &&
              /^[^=]*\[/.test(T)
            )
              return {
                kind: "too-complex",
                reason: `${x[0]} positional '${T}' contains array subscript \u2014 backslash-escaped form de-escapes to [$(cmd)] at runtime`,
                nodeType: "declaration_command",
              };
            x.push(T);
            break;
          }
          default:
            return tooComplexForNode(k);
        }
      }
      return (
        t.push({
          argv: x,
          envVars: [],
          redirects: [],
          text: e.text,
          hasUnquotedGlob: hasUnquotedGlob(e.text),
        }),
        null
      );
    }
    if (e.type === "variable_assignment") {
      let u = t.length,
        d = evaluateVariableAssignment(e, t, r, o);
      if ("kind" in d) return d;
      if (affectsCommandExecution(d.name))
        return {
          kind: "too-complex",
          reason: `${d.name} assignment alters command lookup/execution for subsequent commands`,
          nodeType: "variable_assignment",
        };
      if (assignmentRequiresArithmeticEvaluation(d.name, d.value))
        return {
          kind: "too-complex",
          reason: `${d.name} has integer attribute \u2014 assignment arith-evals RHS, which can execute subscript command substitution or abort/diverge at runtime`,
          nodeType: "variable_assignment",
        };
      if (
        (updateTrackedVariable(r, d, u > 0),
        o.push(d.name),
        t.length === u && containsArithmeticExpansion(e))
      )
        appendNoopCommand(t, e);
      return null;
    }
    if (e.type === "for_statement") {
      if (subprocessEnvironmentScrubbingEnabled()) return tooComplexForNode(e);
      let u = null,
        d = null,
        S = t.length,
        _ = !1;
      for (let k of e.children) {
        if (!k) continue;
        if (k.type === "variable_name") u = k.text;
        else if (k.type === "do_group") d = k;
        else if (k.type === "select")
          return {
            kind: "too-complex",
            reason:
              "select statement reads stdin into $REPLY; cannot statically model",
            nodeType: "for_statement",
          };
        else if (k.type === "for" || k.type === "in" || k.type === ";")
          continue;
        else if (k.type === "command_substitution") {
          let A = analyzeCommandSubstitution(k, t, r, o);
          if (A) return A;
        } else {
          let A = evaluateArgument(k, t, r, o);
          if (typeof A !== "string") return A;
          if (containsArithmeticExpansion(k)) _ = !0;
        }
      }
      if (u === null || d === null) return tooComplexForNode(e);
      if (
        u === "PS4" ||
        u === "IFS" ||
        affectsCommandExecution(u) ||
        INTEGER_ATTRIBUTE_VARIABLES.has(u) ||
        INHERITED_SHELL_VARIABLES.has(u) ||
        VOLATILE_SHELL_VARIABLES.has(u)
      )
        return {
          kind: "too-complex",
          reason: `${u} as loop variable bypasses assignment validation`,
          nodeType: "for_statement",
        };
      let x = r.get(u);
      if (x !== void 0 && !hasUnknownTrackedValue(x))
        return {
          kind: "too-complex",
          reason: `for-loop variable '${u}' would overwrite tracked literal ${JSON.stringify(x.slice(0, 40))}; post-loop value cannot be statically determined`,
          nodeType: "for_statement",
        };
      (r.delete(u), o.push(u));
      let P = new Map(r);
      (invalidateVariablesModifiedByNode(P, d), P.delete(u));
      for (let k of d.children) {
        if (!k) continue;
        if (k.type === "do" || k.type === "done" || k.type === ";") continue;
        let A = analyzeNode(k, t, P, o);
        if (A) return A;
      }
      if ((mergeTrackedVariables(r, P), _ && t.length === S))
        appendNoopCommand(t, e);
      return null;
    }
    if (e.type === "if_statement" || e.type === "while_statement") {
      if (
        e.type === "while_statement" &&
        subprocessEnvironmentScrubbingEnabled()
      )
        return tooComplexForNode(e);
      let u = null,
        d = null;
      if (e.type === "while_statement")
        ((u = new Set(r.keys())),
          (d = new Map(r)),
          invalidateVariablesModifiedByNode(r, e));
      let S = !1;
      for (let _ of e.children) {
        if (!_) continue;
        if (
          _.type === "if" ||
          _.type === "fi" ||
          _.type === "else" ||
          _.type === "elif" ||
          _.type === "while" ||
          _.type === "until" ||
          _.type === ";"
        )
          continue;
        if (_.type === "then") {
          S = !0;
          continue;
        }
        if (_.type === "do_group") {
          let A = new Map(r);
          invalidateVariablesModifiedByNode(A, _);
          for (let T of _.children) {
            if (!T) continue;
            if (T.type === "do" || T.type === "done" || T.type === ";")
              continue;
            let M = analyzeNode(T, t, A, o);
            if (M) return M;
          }
          mergeTrackedVariables(r, A);
          continue;
        }
        if (_.type === "elif_clause" || _.type === "else_clause") {
          let A = new Map(r);
          for (let T of _.children) {
            if (!T) continue;
            if (
              T.type === "elif" ||
              T.type === "else" ||
              T.type === "then" ||
              T.type === ";"
            )
              continue;
            let M = analyzeNode(T, t, A, o);
            if (M) return M;
          }
          mergeTrackedVariables(r, A);
          continue;
        }
        let x = new Map(r),
          P = t.length,
          k = analyzeNode(_, t, x, o);
        if (k) return k;
        if (!S) {
          for (let [A, T] of x) {
            let M = (d ?? r).get(A);
            if (M !== void 0 && !hasUnknownTrackedValue(M) && T !== M)
              return {
                kind: "too-complex",
                reason: `'${A}' was tracked as literal '${M}' but condition may modify it (||/pipeline/unset/&&-short-circuit) \u2014 cannot prove downstream value`,
                nodeType: e.type,
              };
            r.set(A, T);
          }
          for (let A of r.keys())
            if (!x.has(A)) {
              let T = (d ?? r).get(A);
              if (T !== void 0 && !hasUnknownTrackedValue(T))
                return {
                  kind: "too-complex",
                  reason: `'${A}' was tracked as literal '${T}' but condition may unset it (&&-short-circuit) \u2014 cannot prove downstream value`,
                  nodeType: e.type,
                };
              r.set(A, UNKNOWN_TRACKED_VALUE);
            }
          for (let A = P; A < t.length; A++) {
            let T = t[A];
            if (T?.argv[0] === "read") {
              for (let C of T.argv.slice(1))
                if (!C.startsWith("-") && /^[A-Za-z_][A-Za-z0-9_]*$/.test(C)) {
                  let N = r.get(C);
                  if (N !== void 0 && !hasUnknownTrackedValue(N))
                    return {
                      kind: "too-complex",
                      reason: `'read ${C}' in condition may not execute (||/pipeline/subshell); cannot prove it overwrites tracked literal '${N}'`,
                      nodeType: e.type,
                    };
                  r.set(C, UNKNOWN_TRACKED_VALUE);
                }
              let M = r.get("REPLY");
              if (M !== void 0 && !hasUnknownTrackedValue(M))
                return {
                  kind: "too-complex",
                  reason: `'read' in condition may write stdin to REPLY; cannot prove it overwrites tracked literal '${M}'`,
                  nodeType: e.type,
                };
              r.set("REPLY", UNKNOWN_TRACKED_VALUE);
            }
          }
        } else mergeTrackedVariables(r, x);
      }
      if (u !== null) {
        for (let _ of [...r.keys()]) if (!u.has(_)) r.delete(_);
      }
      return null;
    }
    if (e.type === "subshell") {
      let u = new Map(r),
        d = t.length,
        S = !1;
      for (let _ of e.children) {
        if (!_) continue;
        if (_.type === "(" || _.type === ")") continue;
        if (_.type !== "comment") S = !0;
        let x = analyzeNode(_, t, u, o);
        if (x) return x;
      }
      if (S && t.length === d) appendNoopCommand(t, e);
      return null;
    }
    if (e.type === "test_command") {
      let u = e.children.some((_) => _?.type === "[["),
        d = validateTestNodeCoverage(e, u);
      if (d) return d;
      let S = ["[["];
      for (let _ of e.children) {
        if (!_) continue;
        if (
          _.type === "[[" ||
          _.type === "]]" ||
          _.type === "[" ||
          _.type === "]"
        ) {
          if (_.text === "")
            return {
              kind: "too-complex",
              reason: "test_command early-close (quote in operator position)",
              differential: !0,
            };
          continue;
        }
        let x = analyzeTestOperand(_, S, t, r, o, u);
        if (x) return x;
      }
      return (
        t.push({
          argv: S,
          envVars: [],
          redirects: [],
          text: e.text,
          hasUnquotedGlob: hasUnquotedGlob(e.text),
        }),
        null
      );
    }
    if (e.type === "unset_command") {
      let u = [],
        d = !1,
        S = !1,
        _ = !1;
      for (let x of e.children) {
        if (!x) continue;
        switch (x.type) {
          case "unset":
            (u.push(x.text), (_ = x.text === "unsetenv"));
            break;
          case "variable_name":
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(x.text))
              return tooComplexForNode(x);
            if ((u.push(x.text), (S = !0), d || _)) {
              let P = r.get(x.text);
              if (P !== void 0 && hasUnknownTrackedValue(P))
                return {
                  kind: "too-complex",
                  reason: `'${x.text}' no longer has a statically known value at this unset \u2014 cannot verify what the command leaves behind`,
                  nodeType: "unset_command",
                };
              break;
            }
            if (isSensitiveShellVariable(x.text))
              return {
                kind: "too-complex",
                reason: `'unset' targets shell variable ${x.text} (exec-influencing / integer-attr / IFS / PS4)`,
                nodeType: "unset_command",
              };
            r.set(x.text, "");
            break;
          case "word": {
            let P = evaluateArgument(x, t, r, o);
            if (typeof P !== "string") return P;
            if (P.startsWith("-")) {
              if (S) return tooComplexForNode(x);
              if (P !== "-f" && P !== "-v") return tooComplexForNode(x);
              if (P === "-f") d = !0;
              u.push(P);
              break;
            }
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(P))
              return tooComplexForNode(x);
            if ((u.push(P), (S = !0), d || _)) {
              let k = r.get(P);
              if (k !== void 0 && hasUnknownTrackedValue(k))
                return {
                  kind: "too-complex",
                  reason: `'${P}' no longer has a statically known value at this unset \u2014 cannot verify what the command leaves behind`,
                  nodeType: "unset_command",
                };
              break;
            }
            if (isSensitiveShellVariable(P))
              return {
                kind: "too-complex",
                reason: `'unset' targets shell variable ${P} (exec-influencing / integer-attr / IFS / PS4)`,
                nodeType: "unset_command",
              };
            r.set(P, "");
            break;
          }
          default:
            return tooComplexForNode(x);
        }
      }
      return (
        t.push({
          argv: u,
          envVars: [],
          redirects: [],
          text: e.text,
          hasUnquotedGlob: hasUnquotedGlob(e.text),
        }),
        null
      );
    }
    return tooComplexForNode(e);
  }

  // upstream Lo @ 125466-125566
  const TEST_EXPRESSION_NODE_TYPES = new Set([
    "unary_expression",
    "binary_expression",
    "negated_expression",
    "parenthesized_expression",
  ]);

  // upstream Ro @ 125567-125804
  function containsOnlyTestGapWhitespace(e, t) {
    let r = 0;
    while (r < e.length) {
      let o = e[r];
      if (o === " " || o === "\t") {
        r++;
        continue;
      }
      if (
        o === "\\" &&
        e[r + 1] ===
          `
`
      ) {
        r += 2;
        continue;
      }
      if (
        t &&
        o ===
          `
`
      ) {
        r++;
        continue;
      }
      if (t && o === "#") {
        r++;
        while (
          r < e.length &&
          e[r] !==
            `
`
        )
          r++;
        continue;
      }
      return !1;
    }
    return !0;
  }

  // upstream Fo @ 125804-126632
  function validateTestNodeCoverage(e, t) {
    let r = Buffer.from(e.text, "utf8"),
      o = e.startIndex;
    for (let u of e.children) {
      if (!u) continue;
      if (u.endIndex > e.endIndex || u.startIndex < e.startIndex)
        return {
          kind: "too-complex",
          reason:
            "Test command child extends past the node span \u2014 gap byte accounting is untrustworthy",
        };
      if (u.startIndex > o) {
        let d = r
          .subarray(o - e.startIndex, u.startIndex - e.startIndex)
          .toString("utf8");
        if (!containsOnlyTestGapWhitespace(d, t))
          return {
            kind: "too-complex",
            reason:
              "Test command has unparsed bytes between children \u2014 parser dropped content that shell will see",
          };
      }
      if (
        ((o = Math.max(o, u.endIndex)), TEST_EXPRESSION_NODE_TYPES.has(u.type))
      ) {
        let d = validateTestNodeCoverage(u, t);
        if (d) return d;
      }
    }
    if (o < e.endIndex) {
      let u = r.subarray(o - e.startIndex).toString("utf8");
      if (!containsOnlyTestGapWhitespace(u, t))
        return {
          kind: "too-complex",
          reason:
            "Test command has unparsed bytes after its last child \u2014 parser dropped content that shell will see",
        };
    }
    return null;
  }

  // upstream Na @ 126632-126976
  function hasZshEqualsProcessSubstitution(e) {
    let t = !1,
      r = !1,
      o = !1,
      u = 0,
      d;
    for (let S = 0; S < e.length; S++) {
      let _ = e[S];
      if (!t && _ === "\\") {
        S++;
        continue;
      }
      if (!r && _ === "'") {
        t = !t;
        continue;
      }
      if (!t && _ === '"') {
        r = !r;
        continue;
      }
      if (!t && !r) {
        if (_ === "=" && e[S + 1] === "(" && (o || S === 0 || d === "|"))
          return !0;
        if (_ === "(") u++;
        else if (_ === ")") u = Math.max(0, u - 1);
        else if (u === 0 && (_ === "|" || _ === "&") && d === _) o = !0;
        d = _;
      }
    }
    return !1;
  }

  // upstream On @ 126976-127247
  function hasStandaloneDoubleBracket(e) {
    let t = e.replace(
        /\[(?::[a-zA-Z]+:|=[A-Za-z0-9-]*=|\.[A-Za-z0-9-]*\.|[!^]?)\]\](?!\])/g,
        "\x00",
      ),
      r = /[A-Za-z0-9_]/,
      o = t.indexOf("]]");
    while (o !== -1) {
      let u = o > 0 ? t[o - 1] : "",
        d = o + 2 < t.length ? t[o + 2] : "";
      if (!(r.test(u) && r.test(d))) return !0;
      o = t.indexOf("]]", o + 1);
    }
    return !1;
  }

  // upstream Wo @ 127247-130695
  function analyzeTestOperand(e, t, r, o, u, d) {
    if (TEST_EXPRESSION_NODE_TYPES.has(e.type)) {
      for (let S = 0; S < e.children.length; S++) {
        let _ = e.children[S];
        if (!_) continue;
        if (
          (_.type === "simple_expansion" || _.type === "expansion") &&
          (e.children[S + 1]?.text.startsWith("[") ||
            /^:[a-zA-Z&]/.test(e.children[S + 1]?.text ?? "") ||
            (_.children.some((P) => P?.type === "special_variable_name") &&
              /^\w*(\[|:[a-zA-Z&])/.test(e.children[S + 1]?.text ?? "")))
        )
          return {
            kind: "too-complex",
            reason:
              "zsh $name[expr] / $name:mod in [[ ]] operand \u2014 recursive eval",
            differential: !0,
          };
        let x = analyzeTestOperand(_, t, r, o, u, d);
        if (x) return x;
      }
      return null;
    }
    switch (e.type) {
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
        if (e.text === "")
          return {
            kind: "too-complex",
            reason:
              "Test command has a synthesized zero-width token \u2014 parser diverged from shell",
            differential: !0,
          };
        return (t.push(e.text), null);
      case "regex":
      case "extglob_pattern":
        if (/\$[({[\w#?!*@$'"+~^=-]|`|[<>]\(/.test(e.text))
          return {
            kind: "too-complex",
            reason: `[[ ]] ${e.type} contains expansion / command / process substitution`,
            differential: !0,
          };
        if (e.text.startsWith("=("))
          return {
            kind: "too-complex",
            reason: `[[ ]] ${e.type === "extglob_pattern" ? "pattern" : e.type} contains zsh =(CMD) process substitution`,
            differential: !0,
          };
        if (e.type === "regex" && hasZshEqualsProcessSubstitution(e.text))
          return {
            kind: "too-complex",
            reason: `[[ ]] ${e.type} contains zsh =(CMD) process substitution`,
            differential: !0,
          };
        if (e.type === "extglob_pattern") {
          let S = e.text,
            _ = 0;
          while (_ < S.length) {
            if (S[_] === "\\" && _ + 1 < S.length) {
              _ += 2;
              continue;
            }
            if (S[_] === "&")
              return {
                kind: "too-complex",
                reason:
                  "[[ ]] pattern contains unquoted & (zsh splits the word at & at any depth)",
                differential: !0,
              };
            _++;
          }
        }
        if (e.type === "regex") {
          let S = e.text,
            _ = 0,
            x = 0;
          while (x < S.length) {
            let P = S[x];
            if (P === "\\" && x + 1 < S.length) {
              x += 2;
              continue;
            }
            if (_ === 0 && P === "|" && S[x + 1] === P)
              return {
                kind: "too-complex",
                reason:
                  "[[ ]] regex contains glued || (zsh splits it as a cond operator)",
                differential: !0,
              };
            if (P === "&")
              return {
                kind: "too-complex",
                reason:
                  "[[ ]] regex contains unquoted & (zsh splits the word at & at any depth)",
                differential: !0,
              };
            if (P === '"' || P === "'") {
              let k = P;
              x++;
              while (x < S.length && S[x] !== k) {
                if (k === '"' && S[x] === "\\" && x + 1 < S.length) x++;
                x++;
              }
              if (x < S.length) x++;
              continue;
            }
            if (P === "(") _++;
            else if (P === ")") {
              if ((_--, _ < 0))
                return {
                  kind: "too-complex",
                  reason:
                    "[[ ]] regex has unbalanced parentheses (parser desync)",
                  differential: !0,
                };
            }
            x++;
          }
          if (_ !== 0)
            return {
              kind: "too-complex",
              reason: "[[ ]] regex has unbalanced parentheses (parser desync)",
              differential: !0,
            };
        }
        if (e.text.includes("&&"))
          return {
            kind: "too-complex",
            reason:
              "[[ ]] pattern leaf contains `&&` \u2014 shell cond-lexer divergence (zsh splits the word there)",
            differential: !0,
          };
        if (hasStandaloneDoubleBracket(e.text))
          return {
            kind: "too-complex",
            reason:
              "[[ ]] pattern leaf contains a potential standalone `]]` closer \u2014 shell cond-lexer divergence (zsh may close the conditional early)",
            differential: !0,
          };
        return (t.push(e.text), null);
      case "test_rhs_missing":
        return {
          kind: "too-complex",
          reason:
            "Test command comparison is missing its right-hand side \u2014 parser dropped consumed bytes",
        };
      default: {
        let S = evaluateArgument(e, r, o, u);
        if (typeof S !== "string") {
          if (d && S.kind === "too-complex") {
            let { nodeType: _, ...x } = S;
            return { ...x, differential: !0 };
          }
          return S;
        }
        if (
          (d &&
            (hasStandaloneDoubleBracket(S) ||
              hasStandaloneDoubleBracket(e.text))) ||
          /]].*[;\n&|<>]/s.test(S)
        )
          return {
            kind: "too-complex",
            reason: d
              ? "[[ ]] quoted operand contains `]]` closer or `]]`+separator bytes \u2014 possible parser quote-state desync"
              : "test command quoted operand contains `]]`+separator bytes \u2014 possible parser quote-state desync",
            differential: !0,
          };
        return (t.push(S), null);
      }
    }
  }

  // upstream Uo @ 130695-130950
  function findUnsupportedRedirectedChild(e) {
    let t = null;
    for (let r of e.children) {
      if (
        !r ||
        r.type === "!" ||
        r.type === "comment" ||
        SHELL_OPERATOR_TYPES.has(r.type)
      )
        continue;
      t = r;
    }
    if (!t) return null;
    if (t.type === "list" || t.type === "negated_command")
      return findUnsupportedRedirectedChild(t);
    if (
      !COMMAND_WRAPPER_NODE_TYPES.has(t.type) &&
      !REDIRECT_AUXILIARY_NODE_TYPES.has(t.type)
    )
      return t;
    return null;
  }

  // upstream Wa @ 130950-132066
  function analyzeRedirectedStatement(e, t, r, o) {
    let u = [],
      d = null,
      S = [],
      _ = [];
    for (let k of e.children) {
      if (!k) continue;
      if (k.type === "file_redirect") S.push(k);
      else if (k.type === "heredoc_redirect") _.push(k);
      else if (COMMAND_WRAPPER_NODE_TYPES.has(k.type)) {
        if (k.type === "list" || k.type === "negated_command") {
          let A = findUnsupportedRedirectedChild(k);
          if (A) return tooComplexForNode(A);
        }
        d = k;
      } else return tooComplexForNode(k);
    }
    if (!d) {
      for (let k of S) {
        let A = analyzeFileRedirect(k, t, r, o);
        if ("kind" in A) return A;
        u.push(A);
      }
      for (let k of _) {
        let A = analyzeHeredocRedirect(k);
        if (A) return A;
      }
      return (
        t.push({
          argv: [],
          envVars: [],
          redirects: u,
          text: e.text,
          hasUnquotedGlob: hasUnquotedGlob(e.text),
        }),
        null
      );
    }
    let x = t.length,
      P;
    if (d.type === "list") {
      let k = d.children;
      if (k.length === 3 && k[0] && k[1]?.type === "&&" && k[2]) {
        let A = analyzeNode(k[0], t, r, o);
        if (A) return A;
        P = new Map(r);
        let T = analyzeNode(k[2], t, r, o);
        if (T) return T;
      } else {
        let A = analyzeNode(d, t, r, o);
        if (A) return A;
        P = r;
      }
    } else if (CONTAINER_NODE_TYPES.has(d.type)) {
      let k = analyzeNode(d, t, r, o);
      if (k) return k;
      P = r;
    } else {
      P = new Map(r);
      let k = analyzeNode(d, t, r, o);
      if (k) return k;
    }
    for (let k of S) {
      let A = analyzeFileRedirect(k, t, P, o);
      if ("kind" in A) return A;
      u.push(A);
    }
    for (let k of _) {
      let A = analyzeHeredocRedirect(k);
      if (A) return A;
    }
    if (u.length > 0)
      if (t.length > x) {
        let k = t.at(-1);
        if (k) k.redirects.push(...u);
      } else
        t.push({
          argv: [],
          envVars: [],
          redirects: u,
          text: e.text,
          hasUnquotedGlob: hasUnquotedGlob(e.text),
        });
    return null;
  }

  // upstream zo @ 132066-133539
  function validateRedirectShape(e) {
    {
      let o = e.startIndex;
      for (let u of e.children) {
        if (!u) continue;
        if (u.startIndex > o) {
          let d = Buffer.from(e.text, "utf8")
            .subarray(o - e.startIndex, u.startIndex - e.startIndex)
            .toString("utf8");
          if (!/^(?:[ \t]|\\\n)*$/.test(d))
            return {
              kind: "too-complex",
              reason:
                "Redirect has unparsed bytes between children \u2014 parser dropped content that shell will see",
            };
        }
        o = u.endIndex;
      }
      if (o < e.endIndex) {
        let u = Buffer.from(e.text, "utf8")
          .subarray(o - e.startIndex)
          .toString("utf8");
        if (!/^(?:[ \t]|\\\n)*$/.test(u))
          return {
            kind: "too-complex",
            reason:
              "Redirect has unparsed trailing bytes \u2014 parser dropped content that shell will see",
          };
      }
    }
    let t = null,
      r = 0;
    for (let o of e.children) {
      if (!o) continue;
      if (o.type === "variable_name")
        return {
          kind: "too-complex",
          reason: `Redirect uses ${o.text} fd-variable assignment \u2014 modifies shell variable as side effect`,
        };
      if (o.type === "file_descriptor") continue;
      if (o.type === ">&-" || o.type === "<&-") {
        t = o.type;
        continue;
      }
      if (o.type in REDIRECT_OPERATOR_MAP) {
        t = o.type;
        continue;
      }
      if ((t === ">&" || t === "<&") && o.text.startsWith("-"))
        return {
          kind: "too-complex",
          reason:
            "Redirect target after >& or <& starts with - \u2014 bash treats the dash as close-fd and passes the rest to the command as a hidden argument",
        };
      if (t === ">&-" || t === "<&-")
        return {
          kind: "too-complex",
          reason:
            "Close-fd redirect is followed by a word \u2014 bash passes it to the command as a hidden argument",
        };
      (r++, (t = null));
    }
    if (r > 1)
      return {
        kind: "too-complex",
        reason:
          "Redirect has multiple targets \u2014 post-redirect args swallowed",
      };
    return null;
  }

  // upstream Bo @ 133539-133677
  function findInvalidRedirect(e) {
    if (e.type === "file_redirect") {
      let t = validateRedirectShape(e);
      if (t) return t;
    }
    for (let t of e.children)
      if (t) {
        let r = findInvalidRedirect(t);
        if (r) return r;
      }
    return null;
  }

  // upstream Gn @ 133677-136400
  function analyzeFileRedirect(e, t, r, o) {
    let u = null,
      d = null,
      S;
    {
      let _ = validateRedirectShape(e);
      if (_) return _;
    }
    for (let _ of e.children) {
      if (!_) continue;
      if (_.type === "file_descriptor") S = Number(_.text);
      else if (_.type === "variable_name")
        return {
          kind: "too-complex",
          reason: `Redirect uses ${_.text} fd-variable assignment \u2014 modifies shell variable as side effect`,
        };
      else if (_.type in REDIRECT_OPERATOR_MAP)
        u = REDIRECT_OPERATOR_MAP[_.type] ?? null;
      else if (_.type === ">&-" || _.type === "<&-") {
        if (e.children.some((x) => x !== _ && x?.type !== "file_descriptor"))
          return {
            kind: "too-complex",
            reason:
              "Close-fd redirect is followed by a word \u2014 bash passes it to the command as a hidden argument",
          };
        return tooComplexForNode(_);
      } else if (d !== null)
        return {
          kind: "too-complex",
          reason:
            "Redirect has multiple targets \u2014 post-redirect args swallowed",
        };
      else if ((u === ">&" || u === "<&") && _.text.startsWith("-"))
        return {
          kind: "too-complex",
          reason:
            "Redirect target after >& or <& starts with - \u2014 bash treats the dash as close-fd and passes the rest to the command as a hidden argument",
        };
      else if (_.type === "word" || _.type === "number") {
        if (_.children.length > 0) return tooComplexForNode(_);
        if (BRACE_EXPANSION_PATTERN.test(_.text)) return tooComplexForNode(_);
        if (ESCAPED_BRACE_CLOSE_PATTERN.test(_.text))
          return tooComplexForNode(_);
        if (ESCAPED_BRACE_OPEN_PATTERN.test(_.text))
          return tooComplexForNode(_);
        if (/(?:^|[^\\])(?:\\\\)*[`$]/.test(_.text))
          return tooComplexForNode(_);
        d = _.text.replace(/\\([\s\S])/g, (x, P) =>
          P ===
          `
`
            ? ""
            : P,
        );
      } else if (_.type === "raw_string") d = stripQuotes(_.text);
      else if (_.type === "string") {
        let x = evaluateDoubleQuotedString(_, t, r, o);
        if (typeof x !== "string") return x;
        d = x;
      } else if (_.type === "concatenation") {
        let x = evaluateArgument(_, t, r, o);
        if (typeof x !== "string") return x;
        if (/(?:^|[^\\])(?:\\\\)*[`$]/.test(_.text))
          return {
            kind: "too-complex",
            reason:
              "Redirect target concatenation contains $/` \u2014 unanalyzable gap or substitution",
            nodeType: "concatenation",
          };
        d = x;
      } else return tooComplexForNode(_);
    }
    if (!u || d === null)
      return { kind: "too-complex", reason: "Unrecognized redirect shape" };
    if (hasUnknownTrackedValue(d))
      return {
        kind: "too-complex",
        reason:
          "Redirect target contains $(cmd) output \u2014 path is runtime-determined",
        nodeType: e.type,
      };
    if (
      d.includes(`
`)
    )
      return {
        kind: "too-complex",
        reason:
          "Redirect target contains newline \u2014 potential path traversal",
        nodeType: e.type,
      };
    if (d.startsWith("!"))
      return {
        kind: "too-complex",
        reason:
          "Redirect target starts with ! \u2014 zsh clobber or history expansion",
        nodeType: e.type,
      };
    if (d.startsWith("="))
      return {
        kind: "too-complex",
        reason:
          "Redirect target starts with = \u2014 zsh expands to PATH binary",
        nodeType: e.type,
      };
    if ((u === ">&" || u === "<&") && d.startsWith("-"))
      return {
        kind: "too-complex",
        reason:
          "Redirect target after >& or <& starts with - \u2014 bash treats the dash as close-fd and passes the rest to the command as a hidden argument",
      };
    if (u === ">&" && !/^[A-Za-z0-9./_-]+$/.test(d))
      return {
        kind: "too-complex",
        reason:
          "bash `>&` applies a second word-expansion pass to its target \u2014 path cannot be statically validated",
        nodeType: e.type,
      };
    return { op: u, target: d, fd: S };
  }

  // upstream Yn @ 136400-137861
  function analyzeHeredocRedirect(e) {
    let t = null,
      r = null,
      o = !1;
    for (let d of e.children) {
      if (!d) continue;
      if (d.type === "heredoc_start") t = d.text;
      else if (d.type === "heredoc_body") r = d;
      else if (d.type === "<<-") o = !0;
      else if (
        d.type === "<<" ||
        d.type === "heredoc_end" ||
        d.type === "file_descriptor"
      );
      else return tooComplexForNode(d);
    }
    if (r === null)
      return {
        kind: "too-complex",
        reason: "Heredoc body was not scanned by the parser",
        nodeType: "heredoc_redirect",
      };
    if (!(
      t !== null &&
      ((t.startsWith("'") && t.endsWith("'")) ||
        (t.startsWith('"') && t.endsWith('"')) ||
        t.startsWith("\\"))
    ))
      return {
        kind: "too-complex",
        reason: "Heredoc with unquoted delimiter undergoes shell expansion",
        nodeType: "heredoc_redirect",
        differential: !0,
      };
    if (
      t !== null &&
      (t.startsWith("'") || t.startsWith('"')) &&
      t.slice(1, -1).includes("\\")
    )
      return {
        kind: "too-complex",
        reason: "Quoted heredoc delimiter contains backslash",
        nodeType: "heredoc_redirect",
      };
    if (r)
      for (let d of r.children) {
        if (!d) continue;
        if (d.type !== "heredoc_content") return tooComplexForNode(d);
      }
    if (t !== null && r !== null) {
      let d = t.startsWith("\\") ? t.slice(1) : t.slice(1, -1);
      if (d.length > 0) {
        if (o && d.startsWith("\t"))
          return {
            kind: "too-complex",
            reason: "Heredoc uses <<- with a tab-prefixed delimiter",
            nodeType: "heredoc_redirect",
          };
        for (let S of r.text.split(`
`)) {
          let _ = o ? S.replace(/^\t+/, "") : S;
          if (!_.startsWith(d)) continue;
          let x = _.slice(d.length);
          if (/[)`}]/.test(x))
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
  function analyzeHerestringRedirect(e, t, r, o) {
    for (let u of e.children) {
      if (!u) continue;
      if (u.type === "<<<") continue;
      let d = evaluateArgument(u, t, r, o);
      if (typeof d !== "string") return d;
      if (HEREDOC_COMMENT_LINE_PATTERN.test(d)) return tooComplexForNode(u);
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
  function trackCommandSideEffects(e, t, r, o) {
    let u = [],
      d = [],
      S = (A, T = !0) => {
        let M = A.match(/^[A-Za-z_][A-Za-z0-9_]*/);
        if (M) {
          if ((u.push(M[0]), T)) d.push(M[0]);
        }
      },
      _ = e,
      x = !1,
      P;
    for (;;) {
      let A = _[0];
      if (A === void 0) break;
      if (COMMAND_PREFIX_WRAPPERS.has(A)) {
        if (
          (P === "builtin" || P === "command") &&
          A !== "builtin" &&
          A !== "command"
        ) {
          if (A === "noglob" && !x)
            return {
              kind: "too-complex",
              reason: `'${P} noglob' runs the wrapped command on zsh (for 'command', under POSIX_BUILTINS) but not bash \u2014 cannot statically model whether it executes`,
              nodeType: "command",
            };
          x = !0;
        }
        let T = 1;
        while (T < _.length && /^-[-pvV]*$/.test(_[T])) {
          if (/[vV]/.test(_[T])) x = !0;
          T++;
        }
        ((_ = _.slice(T)), (P = A));
      } else if (A === "!") {
        if (P === "builtin" || P === "command") x = !0;
        ((_ = _.slice(1)), (P = void 0));
      } else if (/^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.test(A))
        (S(A), (_ = _.slice(1)), (P = void 0));
      else break;
    }
    let k = _[0];
    if (k === void 0) for (let A of t) S(A.name);
    else if (DECLARATION_COMMAND_NAMES.has(k)) {
      let A = !1;
      for (let T = 1; T < _.length; T++) {
        let M = _[T];
        if (!A && M === "--") {
          A = !0;
          continue;
        }
        if (!A && /^[+-].*m/.test(M))
          return {
            kind: "too-complex",
            reason: `'${k} ${M}' (wrapped form) \u2014 zsh -m/+m pattern-assigns every matching variable; cannot statically model target set`,
            nodeType: "command",
          };
        if (!A && M.startsWith("-")) continue;
        if (M.includes("=")) S(M);
      }
    } else if (k === "read") {
      let A = 1,
        T = !1,
        M = !1;
      while (A < _.length) {
        let C = _[A];
        if (!T && C === "--") {
          ((T = !0), A++);
          continue;
        }
        if (!T && C.startsWith("-")) {
          if (READ_OPTIONS_WITH_OPERANDS.has(C)) {
            A += 2;
            continue;
          }
          let N = !1;
          for (let F = 1; F < C.length; F++) {
            let Y = C[F];
            if (Y === "a" || Y === "A") {
              let Z = F < C.length - 1 ? C.slice(F + 1) : _[A + 1];
              if (Z) (S(Z), (M = !0));
              N = F === C.length - 1;
              break;
            }
            if (READ_OPTIONS_WITH_OPERANDS.has("-" + Y)) {
              N = F === C.length - 1;
              break;
            }
          }
          A += N ? 2 : 1;
          continue;
        }
        (S(C), (M = !0), A++);
      }
      if (!M) u.push("REPLY");
    } else if (k === "printf")
      for (let A = 1; A < _.length; A++) {
        let T = _[A];
        if (T === "--" || !T.startsWith("-")) break;
        if (T === "-v") {
          if (_[A + 1]) S(_[A + 1]);
          A++;
          continue;
        }
        if (T.startsWith("-v")) S(T.slice(2));
      }
    else if (k === "getopts") {
      let A = _[1] === "--" ? 1 : 0;
      if (_[2 + A]) S(_[2 + A]);
      (u.push("OPTARG"), r.set("OPTIND", UNKNOWN_TRACKED_VALUE));
    } else if (k === "wait")
      for (let A = 1; A < _.length; A++) {
        let T = _[A];
        if (T === "--" || !T.startsWith("-")) break;
        for (let M = 1; M < T.length; M++)
          if (T[M] === "p") {
            if (M < T.length - 1) S(T.slice(M + 1));
            else if (_[A + 1]) (S(_[A + 1]), A++);
            break;
          }
      }
    else if (!x && (k === "unset" || k === "unsetenv")) {
      let A = !1,
        T = !1;
      for (let M = 1; M < _.length; M++) {
        let C = _[M];
        if (C.startsWith("-")) {
          if (T)
            return {
              kind: "too-complex",
              reason: `'unset \u2026 ${C}' (wrapped form) \u2014 flag after name; getopt stops at first non-option`,
              nodeType: "command",
            };
          if (C !== "-f" && C !== "-v")
            return {
              kind: "too-complex",
              reason: `'unset ${C}' (wrapped form) \u2014 flag other than -f/-v (zsh -m pattern-unset, bash -n nameref) cannot be statically modelled`,
              nodeType: "command",
            };
          if (C === "-f") A = !0;
          continue;
        }
        if (((T = !0), !/^[A-Za-z_][A-Za-z0-9_]*$/.test(C)))
          return {
            kind: "too-complex",
            reason: `'unset ${C}' (wrapped form) \u2014 non-identifier operand may pathname-expand; cannot statically know which var is unset`,
            nodeType: "command",
          };
        if (A || k === "unsetenv") {
          let N = r.get(C);
          if (N !== void 0 && hasUnknownTrackedValue(N))
            return {
              kind: "too-complex",
              reason: `'${C}' no longer has a statically known value at this unset (wrapped form) \u2014 cannot verify what the command leaves behind`,
              nodeType: "command",
            };
          continue;
        }
        if (isSensitiveShellVariable(C))
          return {
            kind: "too-complex",
            reason: `'unset' targets shell variable ${C} (exec-influencing / integer-attr / IFS / PS4)`,
            nodeType: "command",
          };
        r.set(C, "");
      }
    } else if (k === "print")
      for (let A = 1; A < _.length; A++) {
        let T = _[A];
        if (T === "--" || T === "-" || !T.startsWith("-")) break;
        let M = !1;
        for (let C = 1; C < T.length; C++) {
          let N = T[C];
          if (N === "v") {
            let F = C < T.length - 1 ? T.slice(C + 1) : _[A + 1];
            if (F) S(F);
            M = C === T.length - 1;
            break;
          }
          if (ZSH_PRINT_OPTIONS_WITH_OPERANDS.has("-" + N)) {
            M = C === T.length - 1;
            break;
          }
        }
        if (M) A++;
      }
    else if (k === "set")
      for (let A = 1; A < _.length; A++) {
        let T = _[A];
        if (T === "--" || !/^[-+]/.test(T)) break;
        let M = T.indexOf("A", 1);
        if (M === -1) {
          if (T.endsWith("o")) A++;
          continue;
        }
        if (M < T.length - 1) S(T.slice(M + 1));
        else if (_[A + 1]) S(_[A + 1]);
        break;
      }
    else if (k === "mapfile" || k === "readarray") {
      let A = !1;
      for (let T = 1; T < _.length; T++) {
        let M = _[T];
        if (M.startsWith("-")) {
          if (/^-[dnOsuCc]$/.test(M)) T++;
          continue;
        }
        (S(M), (A = !0));
      }
      if (!A) u.push("MAPFILE");
    } else if (
      !x &&
      (k === "cd" || k === "chdir" || k === "pushd" || k === "popd")
    ) {
      let A = !1;
      if (k === "pushd" || k === "popd")
        for (let T = 1; T < _.length; T++) {
          let M = _[T];
          if (M === "--") break;
          if (/^-[a-zA-Z]*n[a-zA-Z]*$/.test(M)) {
            A = !0;
            break;
          }
          if (k === "popd" && (/^\+0*[1-9]/.test(M) || /^-0+$/.test(M))) {
            A = !0;
            break;
          }
        }
      if (!A)
        (r.set("PWD", UNKNOWN_TRACKED_VALUE),
          r.set("OLDPWD", UNKNOWN_TRACKED_VALUE));
      if (k === "pushd" || k === "popd")
        (r.set("DIRSTACK", UNKNOWN_TRACKED_VALUE),
          r.set("dirstack", UNKNOWN_TRACKED_VALUE));
    }
    if (k !== void 0 && t.length > 0 && ENV_PREFIX_COMMITTING_BUILTINS.has(k))
      for (let A of t) S(A.name);
    for (let A of u) {
      if (isSensitiveShellVariable(A))
        return {
          kind: "too-complex",
          reason: `'${k ?? t[0]?.name}' writes shell variable ${A} (exec-influencing / integer-attr / IFS) \u2014 value cannot be statically verified`,
          nodeType: "command",
        };
      r.set(A, UNKNOWN_TRACKED_VALUE);
    }
    return (o.push(...d), null);
  }

  // upstream za @ 142814-144788
  function analyzeSimpleCommand(e, t, r, o, u) {
    let d = [],
      S = [],
      _ = [...t];
    for (let A of e.children) {
      if (!A) continue;
      switch (A.type) {
        case "variable_assignment": {
          if (S.length > 0) {
            let M = findEnvPrefixDependency(A, new Set(S.map((C) => C.name)));
            if (M !== null)
              return {
                kind: "too-complex",
                reason: `Env-prefix value references \`$${M}\` assigned by an earlier env-prefix in the same command \u2014 runtime sees the earlier assignment, static analysis does not`,
                nodeType: "variable_assignment",
              };
          }
          let T = evaluateVariableAssignment(A, r, o, u);
          if ("kind" in T) return T;
          if (assignmentRequiresArithmeticEvaluation(T.name, T.value))
            return {
              kind: "too-complex",
              reason: `${T.name} has integer attribute \u2014 env-prefix arith-evals value, which can execute subscript command substitution or abort/diverge at runtime`,
              nodeType: "variable_assignment",
            };
          S.push({ name: T.name, value: T.value });
          break;
        }
        case "command_name": {
          let T = A.children[0] ?? A;
          if (subprocessEnvironmentScrubbingEnabled()) {
            if (T.type === "simple_expansion" || T.type === "expansion")
              return tooComplexForNode(T);
            if (
              (T.type === "string" || T.type === "concatenation") &&
              containsParameterExpansion(T)
            )
              return tooComplexForNode(T);
          }
          let M = evaluateArgument(T, r, o, u);
          if (typeof M !== "string") return M;
          d.push(M);
          break;
        }
        case "word":
        case "number":
        case "raw_string":
        case "string":
        case "concatenation":
        case "arithmetic_expansion": {
          let T = evaluateArgument(A, r, o, u);
          if (typeof T !== "string") return T;
          if (/^--?[\nA-Za-z0-9_]/.test(T) && hasUnknownTrackedValue(T))
            return {
              kind: "too-complex",
              reason:
                "Argument starting with `-` contains runtime-determined content",
              nodeType: A.type,
            };
          d.push(T);
          break;
        }
        case "simple_expansion": {
          let T = evaluateVariableExpansion(A, o, !1);
          if (typeof T !== "string") return T;
          d.push(T);
          break;
        }
        case "file_redirect": {
          let T = analyzeFileRedirect(A, r, o, u);
          if ("kind" in T) return T;
          _.push(T);
          break;
        }
        case "herestring_redirect": {
          let T = analyzeHerestringRedirect(A, r, o, u);
          if (T) return T;
          break;
        }
        default:
          return tooComplexForNode(A);
      }
    }
    {
      let A = trackCommandSideEffects(d, S, o, u);
      if (A) return A;
    }
    let x = (A, T) =>
        A === "" ||
        /["'\\ \t\n$`;|&<>(){}#]/.test(A) ||
        (T === 0 && A.includes("="))
          ? `'${A.replaceAll("'", "'\\''")}'`
          : A,
      P =
        /\$[A-Za-z_]/.test(e.text) ||
        e.text.includes(`
`)
          ? [
              ...S.map((A) => `${A.name}=${x(A.value)}`),
              ...d.map((A, T) => x(A, T)),
            ].join(" ")
          : e.text,
      k = hasUnquotedGlob(e.text);
    return {
      kind: "simple",
      commands: [
        { argv: d, envVars: S, redirects: _, text: P, hasUnquotedGlob: k },
      ],
      bareAssignmentNames: [],
    };
  }

  // upstream nr @ 144788-145034
  function analyzeCommandSubstitution(e, t, r, o) {
    let u = new Map(r),
      d = t.length,
      S = !1;
    for (let _ of e.children) {
      if (!_) continue;
      if (_.type === "$(" || _.type === "`" || _.type === ")") continue;
      if (_.type !== "comment") S = !0;
      let x = analyzeNode(_, t, u, o);
      if (x) return x;
    }
    if (S && t.length === d) appendNoopCommand(t, e);
    return null;
  }

  // upstream Ie @ 145034-147538
  function evaluateArgument(e, t, r, o) {
    if (!e) return { kind: "too-complex", reason: "Null argument node" };
    switch (e.type) {
      case "word": {
        if (BRACE_EXPANSION_PATTERN.test(e.text))
          return {
            kind: "too-complex",
            reason: "Word contains brace expansion syntax",
            nodeType: "word",
            differential: !0,
          };
        if (
          ESCAPED_BRACE_CLOSE_PATTERN.test(e.text) ||
          ESCAPED_BRACE_OPEN_PATTERN.test(e.text)
        )
          return {
            kind: "too-complex",
            reason: "Brace body contains backslash-escaped brace",
            nodeType: "word",
            differential: !0,
          };
        if (UNESCAPED_EXPANSION_SIGIL_PATTERN.test(e.text))
          return {
            kind: "too-complex",
            reason:
              "Word contains unescaped ` or $ \u2014 parser missed expansion",
            nodeType: "word",
            differential: !0,
          };
        if (UNESCAPED_QUOTE_PATTERN.test(e.text))
          return {
            kind: "too-complex",
            reason:
              "Word contains unescaped quote \u2014 parser absorbed quote into brace-body word",
            nodeType: "word",
          };
        return e.text.replace(/\\(.)/g, "$1");
      }
      case "number":
        if (e.children.length > 0)
          return {
            kind: "too-complex",
            reason:
              "Number node contains expansion (NN# arithmetic base syntax)",
            nodeType: e.children[0]?.type,
          };
        return e.text;
      case "raw_string":
        return stripQuotes(e.text);
      case "string":
        return evaluateDoubleQuotedString(e, t, r, o);
      case "concatenation": {
        if (BRACE_EXPANSION_PATTERN.test(e.text))
          return {
            kind: "too-complex",
            reason: "Brace expansion",
            nodeType: "concatenation",
            differential: !0,
          };
        if (
          ESCAPED_BRACE_CLOSE_PATTERN.test(e.text) ||
          ESCAPED_BRACE_OPEN_PATTERN.test(e.text)
        )
          return {
            kind: "too-complex",
            reason: "Brace body contains backslash-escaped brace",
            nodeType: "concatenation",
            differential: !0,
          };
        let u = "",
          d = !1,
          S = e.startIndex;
        for (let _ = 0; _ < e.children.length; _++) {
          let x = e.children[_];
          if (!x) continue;
          if (x.startIndex > S)
            return {
              kind: "too-complex",
              reason:
                "Concatenation has unparsed bytes between children \u2014 parser dropped content that shell will see",
              nodeType: "concatenation",
            };
          if (((S = x.endIndex), x.type === "word" && x.text.includes("{")))
            d = !0;
          if (
            (x.type === "simple_expansion" || x.type === "expansion") &&
            (e.children[_ + 1]?.text.startsWith("[") ||
              /^:[a-zA-Z&]/.test(e.children[_ + 1]?.text ?? ""))
          )
            return {
              kind: "too-complex",
              reason:
                "zsh $name[expr] / $name:mod in bare concatenation \u2014 recursive eval",
              nodeType: "concatenation",
              differential: !0,
            };
          let P = evaluateArgument(x, t, r, o);
          if (typeof P !== "string") return P;
          u += P;
        }
        if (d && (u.includes(",") || u.includes("..")))
          return {
            kind: "too-complex",
            reason:
              "Brace expansion (unquoted `{` in concatenation with `,`/`..`)",
            nodeType: "concatenation",
          };
        if (ZSH_DYNAMIC_DIRECTORY_PATTERN.test(u))
          return {
            kind: "too-complex",
            reason: "zsh ~[ dynamic directory syntax (post-collapse)",
            nodeType: "concatenation",
            differential: !0,
          };
        if (ZSH_EQUALS_EXPANSION_PATTERN.test(u))
          return {
            kind: "too-complex",
            reason: "zsh =cmd expansion (post-collapse)",
            nodeType: "concatenation",
            differential: !0,
          };
        return u;
      }
      case "arithmetic_expansion": {
        let u = validateArithmeticExpansion(e);
        if (u) return u;
        return UNKNOWN_TRACKED_VALUE;
      }
      case "simple_expansion":
        return evaluateVariableExpansion(e, r, !1);
      default:
        return tooComplexForNode(e);
    }
  }

  // upstream Yo @ 147538-149853
  function evaluateDoubleQuotedString(e, t, r, o) {
    let u = "",
      d = -1,
      S = !1,
      _ = !1,
      x = !1;
    for (let P of e.children) {
      if (!P) continue;
      if (d !== -1 && P.startIndex > d) {
        let k = Buffer.from(e.text, "utf8")
          .subarray(d - e.startIndex, P.startIndex - e.startIndex)
          .toString("utf8");
        if (k.includes("`"))
          return {
            kind: "too-complex",
            reason:
              "Unanalyzable backtick body in double-quoted string gap \u2014 shell-evaluated value unknown",
            nodeType: "string",
            differential: !0,
          };
        if (k.length > 0) ((u += k), (_ = !0));
      }
      switch (((d = P.endIndex), P.type)) {
        case '"':
          d = P.endIndex;
          break;
        case "string_content":
          ((u += P.text.replace(/\\\n/g, "").replace(/\\([$`"\\])/g, "$1")),
            (_ = !0));
          break;
        case DOLLAR_SIGN: {
          let k = e.children[e.children.indexOf(P) + 1];
          if (k?.type === "string_content") {
            if (k.text.startsWith("["))
              return {
                kind: "too-complex",
                reason:
                  "Legacy $[...] arithmetic inside double-quotes \u2014 recursive subscript eval",
                nodeType: "string",
                differential: !0,
              };
            if (/^[+^=~]/.test(k.text))
              return {
                kind: "too-complex",
                reason:
                  "zsh $+/$^/$=/$~ prefix-flag expansion \u2014 value defeats downstream content checks",
                nodeType: "string",
                differential: !0,
              };
          }
          ((u += DOLLAR_SIGN), (_ = !0));
          break;
        }
        case "command_substitution": {
          let k = extractStaticCatHeredoc(P);
          if (k === "DANGEROUS") return tooComplexForNode(P);
          if (k !== null) {
            let T = k.replace(/\n+$/, "");
            if (
              T.includes(`
`)
            ) {
              if (/^--?[A-Za-z0-9]/.test(u + T))
                return {
                  kind: "too-complex",
                  reason:
                    "cat-heredoc body would make the argument start with option syntax",
                  nodeType: "command_substitution",
                };
              ((u +=
                `
` + COMMAND_SUBSTITUTION_VALUE),
                (_ = !0));
              break;
            }
            ((u += T), (_ = !0));
            break;
          }
          let A = analyzeCommandSubstitution(P, t, r, o);
          if (A) return A;
          ((u += COMMAND_SUBSTITUTION_VALUE), (S = !0));
          break;
        }
        case "simple_expansion": {
          let k = evaluateVariableExpansion(P, r, !0);
          if (typeof k !== "string") return k;
          {
            let A = e.children[e.children.indexOf(P) + 1],
              T = P.children.some((M) => M?.type === "special_variable_name");
            if (
              A?.type === "string_content" &&
              (A.text.startsWith("[") ||
                /^:[a-zA-Z&]/.test(A.text) ||
                (T && /^\w*(\[|:[a-zA-Z&])/.test(A.text)))
            )
              return {
                kind: "too-complex",
                reason:
                  'zsh "$name[expr]" / "$name:mod" inside double-quotes \u2014 recursive eval',
                nodeType: "string",
                differential: !0,
              };
          }
          if (hasUnknownTrackedValue(k)) S = !0;
          else if (k !== "") _ = !0;
          else x = !0;
          u += k;
          break;
        }
        case "arithmetic_expansion": {
          let k = validateArithmeticExpansion(P);
          if (k) return k;
          ((u += UNKNOWN_TRACKED_VALUE), (S = !0));
          break;
        }
        default:
          return tooComplexForNode(P);
      }
    }
    if (S) {
      if (
        [
          ...u
            .replaceAll(COMMAND_SUBSTITUTION_VALUE, "")
            .replaceAll(UNKNOWN_TRACKED_VALUE, ""),
        ].length <= 1
      )
        return tooComplexForNode(e);
    }
    if (!_ && !S && !x && e.text.length > 2) {
      let P = e.text.slice(1, -1);
      if (P.includes("`") || P.includes("$("))
        return {
          kind: "too-complex",
          reason:
            "Delimiters-only string node contains unparsed command substitution",
          nodeType: "string",
          differential: !0,
        };
      return P;
    }
    return u;
  }

  // upstream Ba @ 149857-149973
  const STATIC_ARITHMETIC_TOKEN_PATTERN =
    /^(?:[0-9]+|0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[-+*/%^&|~!<>=?:(),]+|<<|>>|\*\*|&&|\|\||[<>=!]=|\$\(\(|\)\))$/;

  // upstream rr @ 149974-150403
  function validateArithmeticExpansion(e) {
    for (let t of e.children) {
      if (!t) continue;
      if (t.children.length === 0) {
        if (!STATIC_ARITHMETIC_TOKEN_PATTERN.test(t.text))
          return {
            kind: "too-complex",
            reason: `Arithmetic expansion references variable or non-literal: ${t.text}`,
            nodeType: "arithmetic_expansion",
          };
        continue;
      }
      switch (t.type) {
        case "binary_expression":
        case "unary_expression":
        case "ternary_expression":
        case "parenthesized_expression": {
          let r = validateArithmeticExpansion(t);
          if (r) return r;
          break;
        }
        default:
          return tooComplexForNode(t);
      }
    }
    return null;
  }

  // upstream nt @ 150403-150507
  function appendNoopCommand(e, t) {
    e.push({
      argv: ["true"],
      envVars: [],
      redirects: [],
      text: t.text,
      hasUnquotedGlob: hasUnquotedGlob(t.text),
    });
  }

  // upstream qn @ 150507-150620
  function containsArithmeticExpansion(e) {
    if (e.type === "arithmetic_expansion") return !0;
    for (let t of e.children)
      if (t && containsArithmeticExpansion(t)) return !0;
    return !1;
  }

  // upstream Ga @ 150620-151298
  function extractStaticCatHeredoc(e) {
    let t = null;
    for (let u of e.children) {
      if (!u) continue;
      if (u.type === "$(" || u.type === ")") continue;
      if (u.type === "redirected_statement" && t === null) t = u;
      else return null;
    }
    if (!t) return null;
    let r = !1,
      o = null;
    for (let u of t.children) {
      if (!u) continue;
      if (u.type === "command") {
        let d = u.children.filter((_) => _);
        if (d.length !== 1) return null;
        let S = d[0];
        if (S?.type !== "command_name" || S.text !== "cat") return null;
        r = !0;
      } else if (u.type === "heredoc_redirect") {
        if (analyzeHeredocRedirect(u) !== null) return null;
        for (let d of u.children) {
          if (d?.type === "<<-") return null;
          if (d?.type === "heredoc_body") o = d.text;
        }
      } else return null;
    }
    if (!r || o === null) return null;
    if (PROC_ENVIRON_PATTERN.test(o)) return "DANGEROUS";
    if (findDangerousAwkFeature(o) !== !1) return "DANGEROUS";
    return o;
  }

  // upstream Zn @ 151298-152879
  function evaluateVariableAssignment(e, t, r, o) {
    let u = null,
      d = "",
      S = !1;
    for (let _ of e.children) {
      if (!_) continue;
      if (_.type === "variable_name") u = _.text;
      else if (_.type === "=" || _.type === "+=") {
        S = _.type === "+=";
        continue;
      } else if (_.type === "command_substitution") {
        let x = analyzeCommandSubstitution(_, t, r, o);
        if (x) return x;
        d = COMMAND_SUBSTITUTION_VALUE;
      } else if (_.type === "simple_expansion") {
        let x = evaluateVariableExpansion(_, r, !0);
        if (typeof x !== "string") return x;
        d = x;
      } else {
        let x = evaluateArgument(_, t, r, o);
        if (typeof x !== "string") return x;
        d = x;
      }
    }
    if (u === null)
      return {
        kind: "too-complex",
        reason: "Variable assignment without name",
        nodeType: "variable_assignment",
      };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(u))
      return {
        kind: "too-complex",
        reason: `Invalid variable name (bash treats as command): ${u}`,
        nodeType: "variable_assignment",
      };
    if (u === "IFS")
      return {
        kind: "too-complex",
        reason:
          "IFS assignment changes word-splitting \u2014 cannot model statically",
        nodeType: "variable_assignment",
      };
    if (u === "PS4" || u === "PROMPT4") {
      if (S)
        return {
          kind: "too-complex",
          reason:
            "PS4 += cannot be statically verified \u2014 combine into a single PS4= assignment",
          nodeType: "variable_assignment",
        };
      if (hasUnknownTrackedValue(d))
        return {
          kind: "too-complex",
          reason:
            "PS4 value derived from cmdsub/variable \u2014 runtime unknowable",
          nodeType: "variable_assignment",
        };
      if (
        !/^[A-Za-z0-9 _+:./=[\]-]*$/.test(
          d.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, ""),
        )
      )
        return {
          kind: "too-complex",
          reason:
            "PS4 value outside safe charset \u2014 only ${VAR} refs and [A-Za-z0-9 _+:.=/[]-] allowed",
          nodeType: "variable_assignment",
        };
    }
    if (d.includes("~"))
      return {
        kind: "too-complex",
        reason:
          "Tilde in assignment value \u2014 bash may expand at assignment time",
        nodeType: "variable_assignment",
      };
    return { name: u, value: d, isAppend: S };
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
  function evaluateVariableExpansion(e, t, r) {
    let o = null,
      u = !1;
    for (let S of e.children) {
      if (S?.type === "variable_name") {
        o = S.text;
        break;
      }
      if (S?.type === "special_variable_name") {
        ((o = S.text), (u = !0));
        break;
      }
    }
    if (o === null) return tooComplexForNode(e);
    let d = t.get(o);
    if (d !== void 0) {
      if (VOLATILE_SHELL_VARIABLES.has(o))
        return r && INHERITED_SHELL_VARIABLES.has(o) && o !== "BASHPID"
          ? UNKNOWN_TRACKED_VALUE
          : tooComplexForNode(e);
      if (hasUnknownTrackedValue(d)) {
        if (!r) return tooComplexForNode(e);
        return d;
      }
      if (!r) {
        if (d === "") return tooComplexForNode(e);
        if (UNSAFE_UNQUOTED_VALUE_PATTERN.test(d)) return tooComplexForNode(e);
      }
      return d;
    }
    if (o === "HOME") {
      let S = homedir();
      if (!r && (S === "" || UNSAFE_UNQUOTED_VALUE_PATTERN.test(S)))
        return tooComplexForNode(e);
      return S;
    }
    if (r) {
      if (INHERITED_SHELL_VARIABLES.has(o)) return UNKNOWN_TRACKED_VALUE;
      if (u && (SAFE_SPECIAL_PARAMETERS.has(o) || /^[0-9]+$/.test(o)))
        return UNKNOWN_TRACKED_VALUE;
    }
    return tooComplexForNode(e);
  }

  // upstream Nn @ 153961-153986
  function invalidateVariablesModifiedByNode(e, t) {
    invalidateModifiedVariables(t, e);
  }

  // upstream Po @ 153986-154513
  function invalidateUnsetTargets(e, t) {
    let r = () => {
      for (let o of t.keys()) t.set(o, UNKNOWN_TRACKED_VALUE);
    };
    for (let o of e) {
      if (o?.type === "unset" && o.text === "unsetenv") return;
      if (
        !o ||
        o.type === "unset" ||
        o.type === "file_redirect" ||
        o.type === "heredoc_redirect" ||
        o.type === "herestring_redirect"
      )
        continue;
      if (o.type === "variable_name") {
        t.set(o.text.replace(/\\/g, ""), UNKNOWN_TRACKED_VALUE);
        continue;
      }
      if (o.type === "word") {
        if (o.text.startsWith("-")) {
          if (o.text === "--" || /^-[fvn]+$/.test(o.text)) continue;
          r();
          continue;
        }
        if (/^\\?[A-Za-z_][A-Za-z0-9_]*$/.test(o.text)) {
          t.set(o.text.replace(/^\\/, ""), UNKNOWN_TRACKED_VALUE);
          continue;
        }
      }
      r();
    }
  }

  // upstream Xn @ 154513-154952
  function extractStaticWord(e) {
    if (!e) return null;
    switch (e.type) {
      case "word":
      case "number":
        return e.text.replace(/\\(.)/g, "$1");
      case "raw_string":
        return e.text.slice(1, -1);
      case "string": {
        let t = e.children.filter((r) => r && r.type !== '"');
        if (t.length === 0) return "";
        if (t.length === 1 && t[0]?.type === "string_content") return t[0].text;
        return null;
      }
      case "concatenation": {
        let t = "";
        for (let r of e.children) {
          let o = extractStaticWord(r);
          if (o === null) return null;
          t += o;
        }
        return t;
      }
      default:
        return null;
    }
  }

  // upstream kt @ 154952-157656
  function invalidateModifiedVariables(e, t) {
    if (
      e.type === "function_definition" ||
      e.type === "subshell" ||
      e.type === "command_substitution" ||
      e.type === "process_substitution"
    )
      return;
    if (e.type === "pipeline") {
      let r = null;
      for (let o of e.children)
        if (o && !SHELL_OPERATOR_TYPES.has(o.type)) r = o;
      if (r) invalidateModifiedVariables(r, t);
      return;
    }
    if (e.type === "list" || e.type === "program") {
      let r = e.children;
      for (let o = 0; o < r.length; o++) {
        let u = r[o];
        if (!u || SHELL_OPERATOR_TYPES.has(u.type)) continue;
        let d = o + 1;
        while (d < r.length && !r[d]) d++;
        if (r[d]?.type === "&") continue;
        invalidateModifiedVariables(u, t);
      }
      return;
    }
    if (e.type === "variable_assignment") {
      for (let r of e.children)
        if (r?.type === "variable_name") {
          t.set(r.text, UNKNOWN_TRACKED_VALUE);
          break;
        }
    }
    if (e.type === "for_statement") {
      for (let r of e.children)
        if (r?.type === "variable_name") {
          t.set(r.text, UNKNOWN_TRACKED_VALUE);
          break;
        }
    }
    if (e.type === "unset_command") invalidateUnsetTargets(e.children, t);
    if (e.type === "command") {
      let r,
        o,
        u = [],
        d = [],
        S = !1;
      for (let C of e.children) {
        if (!C) continue;
        if (C.type === "command_name")
          ((o = C),
            (r = extractStaticWord(C.children[0] ?? C) ?? void 0),
            (S = !0));
        else if (
          !S ||
          C.type === "file_redirect" ||
          C.type === "herestring_redirect" ||
          C.type === "heredoc_redirect"
        );
        else (u.push(extractStaticWord(C) ?? ""), d.push(C));
      }
      let _ = !1,
        x;
      while (r !== void 0 && (COMMAND_PREFIX_WRAPPERS.has(r) || r === "!")) {
        if (
          (x === "builtin" || x === "command") &&
          r !== "builtin" &&
          r !== "command" &&
          r !== "noglob"
        )
          _ = !0;
        let C = r === "!" ? void 0 : r;
        while (u.length > 0) {
          let N = u[0];
          if (/^-[-pvV]*$/.test(N)) {
            if (/[vV]/.test(N)) _ = !0;
            (u.shift(), d.shift());
          } else if (/^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.test(N)) {
            let F = N.match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];
            (t.set(F, UNKNOWN_TRACKED_VALUE),
              u.shift(),
              d.shift(),
              (C = void 0));
          } else break;
        }
        ((x = C), (r = u.shift()), d.shift());
      }
      let P = u,
        k = (C) => {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(C))
            t.set(C, UNKNOWN_TRACKED_VALUE);
        };
      if (r === "read") {
        t.set("REPLY", UNKNOWN_TRACKED_VALUE);
        let C = 0,
          N = !1;
        while (C < P.length) {
          let F = P[C];
          if (!N && F === "--") {
            ((N = !0), C++);
            continue;
          }
          if (!N && F.startsWith("-")) {
            if (READ_OPTIONS_WITH_OPERANDS.has(F)) {
              C += 2;
              continue;
            }
            let Y = !1;
            for (let Z = 1; Z < F.length; Z++) {
              let de = F[Z];
              if (de === "a" || de === "A") {
                (k(Z < F.length - 1 ? F.slice(Z + 1) : (P[C + 1] ?? "")),
                  (Y = Z === F.length - 1));
                break;
              }
              if (READ_OPTIONS_WITH_OPERANDS.has("-" + de)) {
                Y = Z === F.length - 1;
                break;
              }
            }
            C += Y ? 2 : 1;
            continue;
          }
          (k(F), C++);
        }
      } else if (r === "mapfile" || r === "readarray") {
        t.set("MAPFILE", UNKNOWN_TRACKED_VALUE);
        for (let C = 0; C < P.length; C++) {
          let N = P[C];
          if (N.startsWith("-")) {
            if (/^-[dnOsuCc]$/.test(N)) C++;
            continue;
          }
          k(N);
        }
      } else if (r === "unset" && !_) invalidateUnsetTargets(d, t);
      let A = o?.children[0],
        T = A?.type === "word" ? A.text.replace(/\\(.)/g, "$1") : void 0,
        M =
          T !== void 0 &&
          !ENV_PREFIX_COMMITTING_BUILTINS.has(T) &&
          !COMMAND_PREFIX_WRAPPERS.has(T) &&
          !DECLARATION_COMMAND_NAMES.has(T);
      for (let C of e.children)
        if (C && (C.type !== "variable_assignment" || !M))
          invalidateModifiedVariables(C, t);
      return;
    }
    if (e.type === "declaration_command") {
      for (let r of e.children)
        if (
          r?.type === "string" ||
          r?.type === "raw_string" ||
          r?.type === "word" ||
          r?.type === "number" ||
          r?.type === "concatenation" ||
          r?.type === "variable_name"
        ) {
          let o = r.text.replace(/['"\\]/g, ""),
            u = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/.exec(o);
          if (u) t.set(u[1], UNKNOWN_TRACKED_VALUE);
          else {
            let d = o.indexOf("=");
            if (d > 0 && o.lastIndexOf("$", d - 1) !== -1)
              for (let S of [...t.keys()]) t.set(S, UNKNOWN_TRACKED_VALUE);
          }
        }
    }
    for (let r of e.children) if (r) invalidateModifiedVariables(r, t);
  }

  // upstream xt @ 157656-157784
  function mergeTrackedVariables(e, t) {
    for (let [r, o] of t) {
      let u = e.get(r);
      if (u !== void 0 && u !== o) e.set(r, UNKNOWN_TRACKED_VALUE);
    }
    for (let r of e.keys()) if (!t.has(r)) e.set(r, UNKNOWN_TRACKED_VALUE);
  }

  // upstream Ln @ 157784-158027
  function updateTrackedVariable(e, t, r = !1) {
    if (r) {
      e.set(t.name, UNKNOWN_TRACKED_VALUE);
      return;
    }
    if (t.isAppend && !e.has(t.name)) return;
    let o = e.get(t.name);
    if (
      o !== void 0 &&
      o !== t.value &&
      !t.isAppend &&
      !hasUnknownTrackedValue(t.value)
    ) {
      e.set(t.name, UNKNOWN_TRACKED_VALUE);
      return;
    }
    let u = t.isAppend ? (o ?? "") + t.value : t.value;
    e.set(t.name, u);
  }

  // upstream qo @ 158027-158063
  function stripQuotes(e) {
    return e.slice(1, -1);
  }

  // upstream Ko @ 158063-158207
  function containsParameterExpansion(e) {
    for (let t of e.children) {
      if (!t) continue;
      if (t.type === "simple_expansion" || t.type === "expansion") return !0;
      if (containsParameterExpansion(t)) return !0;
    }
    return !1;
  }

  // upstream Ha @ 158207-158371
  function tildeVariableName(e) {
    if (e === "~" || e.startsWith("~/")) return "HOME";
    if (e === "~+" || e.startsWith("~+/")) return "PWD";
    if (e === "~-" || e.startsWith("~-/")) return "OLDPWD";
    return null;
  }

  // upstream Zo @ 158371-158654
  function findEnvPrefixDependency(e, t) {
    let r = e.type === "variable_assignment";
    for (let o of e.children) {
      if (!o) continue;
      if (o.type === "variable_name") {
        if (r) continue;
        if (t.has(o.text)) return o.text;
      }
      if (o.type === "word") {
        let d = tildeVariableName(o.text);
        if (d !== null && t.has(d)) return d;
      }
      let u = findEnvPrefixDependency(o, t);
      if (u !== null) return u;
    }
    return null;
  }

  // upstream B @ 158654-158856
  function tooComplexForNode(e) {
    return {
      kind: "too-complex",
      reason:
        e.type === "ERROR"
          ? "Parse error"
          : DYNAMIC_SHELL_NODE_TYPES.has(e.type)
            ? `Contains ${e.type}`
            : `Contains shell syntax (${e.type}) that cannot be statically analyzed`,
      nodeType: e.type,
    };
  }

  // upstream Xo @ 159950-160701
  function findDangerousAwkFeature(e) {
    if (/(?<![A-Za-z_])system[\s\\]*\(/.test(e))
      return "awk program contains system() which executes arbitrary commands";
    if (
      /(?:^|[^|])\|&?[^/|%";#{}]*"/.test(e) ||
      /(?:^|[^|])\|&?[\s\\]*getline\b/.test(e)
    )
      return 'awk program contains a command pipe (| "cmd" or | getline) which executes arbitrary commands';
    if (
      /@[\s\\]*(?:load|include)\b|@[\s\\]*\w+(?:::\w+)?(?:\[[^\]]*\])*[\s\\]*\(/.test(
        e,
      )
    )
      return "awk program contains @load/@include or an @indirect call which can execute arbitrary code";
    if (/(?<![A-Za-z_])extension[\s\\]*\(/.test(e))
      return "awk program contains extension() which loads arbitrary native code (legacy gawk)";
    if (/"\/inet[46]?\//.test(e))
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
  function assignmentRequiresArithmeticEvaluation(e, t) {
    if (!INTEGER_ATTRIBUTE_VARIABLES.has(e)) return !1;
    if (
      t.includes("[") ||
      t.includes("`") ||
      /\$\(/.test(t) ||
      hasUnknownTrackedValue(t)
    )
      return !0;
    if (!/^(0|[1-9][0-9]{0,17})$/.test(t)) return !0;
    return !1;
  }

  // upstream Jn @ 162773-162899
  function affectsCommandExecution(e) {
    let t = e.toLowerCase();
    return (
      EXECUTION_INFLUENCING_ZSH_VARIABLES.has(t) ||
      t.startsWith("ld_") ||
      t.startsWith("dyld_") ||
      t.startsWith("bash_func_")
    );
  }

  // upstream XTe @ 162899-162976
  function isSensitiveShellVariable(e) {
    return (
      affectsCommandExecution(e) ||
      e === "IFS" ||
      e === "PS4" ||
      e === "PROMPT4" ||
      INTEGER_ATTRIBUTE_VARIABLES.has(e)
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
