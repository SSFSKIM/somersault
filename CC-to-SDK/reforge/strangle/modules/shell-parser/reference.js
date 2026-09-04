// PARITY LAYER (§2.5 `reference`) — the whole of upstream's bash parser chunk
// (2.1.251, `chunk-fgwne0fb.js`: 62,907 bytes, 107 top-level declarations at
// 99 % declaration density, seven exports, one import).
//
// The campaign's THIRD S-CHUNK (§2.2) and, by two orders of magnitude, its
// largest ownership: the first was 3.4 KB of tool description, the second 165
// bytes of shutdown latch. This one is a complete hand-written recursive-descent
// tokenizer and parser for bash, emitting tree-sitter-shaped nodes, and nothing
// of upstream's bytes survives in the replacement.
//
// ## WHAT THIS MODULE IS
//
// Upstream's chunk is a self-contained function from a command STRING to a node
// TREE. It has no clock it reads for anything but a deadline, no filesystem, no
// `process`, and exactly one effect: a telemetry call on the abort path, which
// stays a port (`parseOrAbort`'s second parameter) because it is the one edge
// that leaves the module.
//
// The tree it builds imitates tree-sitter's bash grammar closely enough to be a
// drop-in for it — `type`, `text`, `startIndex`, `endIndex`, `children`, and the
// telemetry event is still called `tengu_tree_sitter_parse_abort` — but nothing
// of tree-sitter is here. It is a two-thousand-line hand-rolled parser with its
// own tokenizer, its own heredoc machinery, its own quote-state tracking, and
// its own UTF-8 byte-offset table.
//
// ## WHY THE OFFSETS ARE BYTES, AND WHY THAT IS THE HARD PART
//
// Every offset this parser emits is a UTF-8 BYTE offset, over a string
// JavaScript stores as UTF-16 code units. tree-sitter's C API is byte-addressed,
// so a parser pretending to be tree-sitter has to be too — and the consumers
// downstream slice the original command with those offsets to decide what a
// command DOES.
//
// The module therefore tracks two cursors at once, and the whole scanner exists
// to keep them in step:
//
//   * `scan.pos`  — the UTF-16 index, what `String.prototype` methods take;
//   * `scan.byte` — the UTF-8 byte offset, what every node records.
//
// `advance` moves both, adding 1, 2, 3 or 4 bytes depending on the code point
// (and consuming the low surrogate when it takes the 4-byte arm). For random
// access — seeking to a heredoc body, slicing a node's text out of a non-ASCII
// command — `byteOffsetOf` builds the same mapping eagerly as a `Uint32Array`
// and binary-searches it. Two mechanisms, one answer, and they must agree: a
// parser that is right about every node type and wrong about one offset hands
// the safety chain a correct tree pointing at the wrong bytes.
//
// ## WHAT GRADES IT
//
// Two things, and the second is the one that matters here.
//
// The DIFFERENTIAL surface: every Bash call in the recorded corpus parses
// through this module, on both engines, and a divergence in the argv or env-var
// extraction changes the permission decision the transcript records. That is
// what the gate's per-export sabotage reddens.
//
// The CONTRACT TEST, `strangle/parser-parity.test.ts`: the corpus's Bash
// commands are `ls`, `cat`, `git status` and a pipe, while the domain is every
// string a model can put in a `command` field. So the test evaluates the PINNED
// CHUNK'S OWN BYTES and compares the two trees node for node — type, byte range,
// text, children, to any depth — over fourteen partitions of that domain
// (quoting, heredocs, brace expansion, arithmetic, process and command
// substitution, pipelines and redirections, `${…}` expansions, compound
// statements, test commands, multi-byte input, junk, corpus shapes, and a
// seeded fuzz partition). Each partition declares the direction a wrong parser
// would fail it in, and the test proves the comparator catches exactly that.
//
// ## READING THIS FILE
//
// It is a faithful transliteration, not a redesign. Upstream's control flow,
// evaluation order and recovery shapes are reproduced exactly, because they ARE
// the specification — including the places where the recovery looks arbitrary,
// and the two or three arms that are structurally unreachable. Where upstream
// does something that reads like a mistake, the comment says so and the code
// keeps doing it. What changed is that everything has a name.
//
// The parser is a chain of mutually recursive functions over two mutable
// records, in this order:
//
//   1. the SCANNER and the TOKENIZER — `newScanner` … `nextToken`;
//   2. the PARSER CORE — node construction, the position mark, the statement
//      level (`parseStatements`, `parseAndOrList`, `parsePipeline`,
//      `parseCommandUnit`);
//   3. the SIMPLE COMMAND and assignments;
//   4. REDIRECTIONS and HEREDOCS;
//   5. WORDS, strings and the `$` forms;
//   6. the inside of `${…}` and backticks;
//   7. the keyword-led COMPOUND STATEMENTS;
//   8. the TEST-EXPRESSION grammar of `[ … ]` and `[[ … ]]`;
//   9. ARITHMETIC, and the module's public API.

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE SCANNER AND THE TOKENIZER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The handle `getParser` hands out (upstream `Re`).
 *
 * `parseProgram` is declared further down this module as a function declaration, so
 * hoisting has already bound it by the time this initialiser runs.
 */
const PARSER_HANDLE = { parse: parseProgram };

/**
 * Returns the parser handle (upstream `ZE`).
 *
 * The indirection exists to mirror tree-sitter's API shape, where a caller acquires a
 * parser object and then calls `.parse(source)` on it.
 */
function getParser() {
  return PARSER_HANDLE;
}

/**
 * The one-character parameter names bash expands without needing braces: `$?` (exit
 * status), `$$` (pid), `$@` and `$*` (the argument list), `$#` (argument count),
 * `$-` (option flags), `$!` (last background pid) and `$_` (last argument).
 * Upstream `H`.
 */
const SPECIAL_VARIABLE_NAMES = new Set(["?", "$", "@", "*", "#", "-", "!", "_"]);

/**
 * Builtins whose operands are variable assignments rather than ordinary arguments, so
 * that `export FOO=bar` parses `FOO=bar` as an assignment and not as a word.
 * Upstream `Ae`.
 */
const DECLARATION_COMMANDS = new Set([
  "export",
  "declare",
  "typeset",
  "readonly",
  "local",
]);

/**
 * The reserved words of the shell grammar. A word from this set appearing where a
 * command name is expected introduces or closes a compound statement instead of
 * naming a program. Upstream `z_n`.
 */
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "while",
  "until",
  "for",
  "in",
  "do",
  "done",
  "case",
  "esac",
  "function",
  "select",
]);

/**
 * Creates a scanner over one command string (upstream `De`).
 *
 * The scanner carries TWO positions over the same text, and the reason is worth
 * stating once because it recurs on every node this parser emits. The parser
 * imitates tree-sitter, and tree-sitter reports positions as offsets into the UTF-8
 * encoding of the source. JavaScript, meanwhile, indexes strings by UTF-16 code
 * unit. So:
 *
 *   - `pos` is the UTF-16 index. It is what actually reads characters out of `src`,
 *     and it is what `len` is measured in.
 *   - `byte` is the offset the same position would have if `src` were UTF-8 encoded.
 *     It is what goes into every token's `start`/`end` and every node's
 *     `startIndex`/`endIndex`. Consumers never see `pos`.
 *
 * For pure ASCII the two advance in lockstep. Above U+007F they diverge: a code point
 * below U+0800 costs two bytes against one UTF-16 unit, the rest of the basic
 * multilingual plane costs three against one, and anything above it costs four bytes
 * against the two units of a surrogate pair.
 *
 * They stay consistent because exactly one function moves them: `advance`. Code that
 * needs the byte offset of some arbitrary index without walking there goes through
 * `byteOffsetOf` instead, which builds the whole mapping once.
 *
 * `heredocs` is the queue of heredoc redirections whose bodies have been announced
 * (`<<EOF`) but not yet consumed; `byteTable` is `byteOffsetOf`'s memo, left null
 * until something asks for it.
 */
function newScanner(src) {
  return {
    src,
    len: src.length,
    pos: 0,
    byte: 0,
    heredocs: [],
    byteTable: null,
  };
}

/**
 * Consumes exactly one code point, moving both cursors (upstream `n`). This is the
 * only place in the module where either offset changes.
 *
 * The four arms are the UTF-8 encoded length of the code point that begins at `pos`:
 * one byte below U+0080, two below U+0800, four for a code point written as a
 * surrogate pair, and three for the rest of the basic multilingual plane. The
 * surrogate arm is also the only one that steps `pos` twice, because a pair occupies
 * two UTF-16 units; it trusts the pair to be well formed and does not check that a
 * low surrogate actually follows. An unpaired low surrogate falls into the final arm
 * and is charged three bytes, which is what an encoder emitting U+FFFD in its place
 * would cost.
 */
function advance(scan) {
  const code = scan.src.charCodeAt(scan.pos);
  scan.pos++;
  if (code < 128) {
    scan.byte++;
  } else if (code < 2048) {
    scan.byte += 2;
  } else if (code >= 55296 && code <= 56319) {
    scan.byte += 4;
    scan.pos++;
  } else {
    scan.byte += 3;
  }
}

/**
 * The character `offset` UTF-16 units ahead of the cursor, or the empty string past
 * the end of the input (upstream `c`). Does not move the cursor.
 *
 * Returning "" rather than undefined is load-bearing: every predicate below compares
 * with `===` against single-character literals, and `isDelimiter("")` deliberately
 * answers true so that end of input closes a word the same way a space does.
 */
function peek(scan, offset = 0) {
  return scan.pos + offset < scan.len ? scan.src[scan.pos + offset] : "";
}

/**
 * The byte offset of an arbitrary UTF-16 index (upstream `we`), for the callers that
 * jump around the source rather than walking it.
 *
 * `advance` computes this incrementally for the cursor; this builds the same mapping
 * eagerly for random access. The first call fills a `Uint32Array` of `len + 1`
 * entries with the running byte offset of every index — the extra final entry is the
 * byte length of the whole string, so an index of `len` also has an answer — then
 * caches it on the scanner, making every later call a single array read.
 *
 * The per-character arms are the same UTF-8 lengths `advance` uses. For a surrogate
 * pair the low half is given the offset two bytes into the four-byte sequence, so an
 * index landing between the halves still yields a monotonically increasing answer
 * rather than a hole.
 */
function byteOffsetOf(scan, charIndex) {
  if (scan.byteTable) return scan.byteTable[charIndex];
  const table = new Uint32Array(scan.len + 1);
  let byteOffset = 0;
  let index = 0;
  while (index < scan.len) {
    table[index] = byteOffset;
    const code = scan.src.charCodeAt(index);
    if (code < 128) {
      byteOffset++;
      index++;
    } else if (code < 2048) {
      byteOffset += 2;
      index++;
    } else if (code >= 55296 && code <= 56319) {
      table[index + 1] = byteOffset + 2;
      byteOffset += 4;
      index += 2;
    } else {
      byteOffset += 3;
      index++;
    }
  }
  table[scan.len] = byteOffset;
  scan.byteTable = table;
  return table[charIndex];
}

/**
 * Whether `ch` may appear inside an unquoted word (upstream `_e`).
 *
 * This is deliberately far wider than a shell identifier: a bare word is anything the
 * shell would hand to a command as one argument, so it includes path punctuation
 * (`/`, `.`, `-`, `~`), glob characters (`*`, `?`, `[`, `]`), and `=`, `+`, `:`, `@`,
 * `%`, `,`, `^`, `!`. The final arm accepts every character at or above U+0080, which
 * makes all non-ASCII text word text. The empty string is not a word character, so
 * end of input ends a word.
 */
function isWordChar(ch) {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    (ch >= "0" && ch <= "9") ||
    ch === "_" ||
    ch === "/" ||
    ch === "." ||
    ch === "-" ||
    ch === "+" ||
    ch === ":" ||
    ch === "@" ||
    ch === "%" ||
    ch === "," ||
    ch === "~" ||
    ch === "^" ||
    ch === "?" ||
    ch === "*" ||
    ch === "!" ||
    ch === "=" ||
    ch === "[" ||
    ch === "]" ||
    ch >= "\x80"
  );
}

/**
 * Whether `ch` can begin an unquoted word (upstream `$e`): any word character, plus a
 * backslash, which escapes whatever follows it into the word.
 */
function isWordStart(ch) {
  return isWordChar(ch) || ch === "\\";
}

/**
 * Whether `ch` terminates an unquoted word (upstream `ne`): end of input, blank space,
 * a line ending, or one of the shell metacharacters that starts a new token.
 */
function isDelimiter(ch) {
  return (
    ch === "" ||
    ch === " " ||
    ch === "\t" ||
    ch === "\n" ||
    ch === "\r" ||
    ch === ";" ||
    ch === "&" ||
    ch === "|" ||
    ch === "(" ||
    ch === ")" ||
    ch === "<" ||
    ch === ">"
  );
}

/**
 * `isDelimiter` minus the opening parenthesis (upstream `Se`), for the contexts where
 * `(` continues the current construct instead of ending it — an array literal such as
 * `x=(a b)`, or the `(` of a process substitution.
 */
function isDelimiterExceptParen(ch) {
  return isDelimiter(ch) && ch !== "(";
}

/** Whether `ch` can start a variable name (upstream `R`): a letter or underscore. */
function isNameStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

/** Whether `ch` can continue a variable name (upstream `M`): a name start or a digit. */
function isNameChar(ch) {
  return isNameStart(ch) || (ch >= "0" && ch <= "9");
}

/** Whether `ch` is a decimal digit (upstream `O`). */
function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

/** Whether `ch` is a hexadecimal digit (upstream `Ce`). */
function isHexDigit(ch) {
  return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

/**
 * Whether `ch` is a digit of an arithmetic literal written in an explicit base
 * (upstream `Be`). Bash's `base#number` form draws its digits from 0-9, then a-z, then
 * A-Z, then `@` and `_`, which is exactly a name character or `@`.
 */
function isBaseDigit(ch) {
  return isNameChar(ch) || ch === "@";
}

/**
 * Whether `ch` may appear in an unquoted heredoc delimiter (upstream `Me`), as in the
 * `EOF` of `<<EOF`. Everything is allowed except end of input, blank space, a newline,
 * the metacharacters that would end the redirection word, and the three quoting
 * characters — a quoted delimiter is handled by the quote rules instead.
 */
function isHeredocDelimiterChar(ch) {
  return (
    ch !== "" &&
    ch !== " " &&
    ch !== "\t" &&
    ch !== "\n" &&
    ch !== "<" &&
    ch !== ">" &&
    ch !== "|" &&
    ch !== "&" &&
    ch !== ";" &&
    ch !== "(" &&
    ch !== ")" &&
    ch !== "'" &&
    ch !== '"' &&
    ch !== "`" &&
    ch !== "\\"
  );
}

/**
 * Skips inter-token whitespace (upstream `m`): spaces, tabs, carriage returns, and a
 * backslash-newline pair, which is a line continuation and therefore whitespace too.
 *
 * A backslash NOT followed by a newline stops the skip, because there it begins a word
 * by escaping the next character.
 */
function skipBlanks(scan) {
  while (scan.pos < scan.len) {
    const ch = scan.src[scan.pos];
    if (ch === " " || ch === "\t" || ch === "\r") {
      advance(scan);
    } else if (ch === "\\") {
      if (scan.src[scan.pos + 1] === "\n") {
        advance(scan);
        advance(scan);
      } else {
        break;
      }
    } else {
      break;
    }
  }
}

/**
 * The same skip as `skipBlanks` but inside a heredoc (upstream `We`), where a carriage
 * return is body text rather than whitespace and so must not be swallowed.
 */
function skipHeredocBlanks(scan) {
  while (scan.pos < scan.len) {
    const ch = scan.src[scan.pos];
    if (ch === " " || ch === "\t") {
      advance(scan);
    } else if (ch === "\\" && scan.src[scan.pos + 1] === "\n") {
      advance(scan);
      advance(scan);
    } else {
      break;
    }
  }
}

/**
 * Reads and consumes the next token (upstream `T`).
 *
 * There is no pushback: the scanner is the whole of the tokenizer's state, so a caller
 * that needs to look ahead saves a `mark` and `reset`s to it. Leading blanks are
 * skipped before anything else, which is why `start` is the byte offset of the token's
 * first real character and not of the whitespace before it.
 *
 * `mode` is either "arg" or "cmd". "cmd" says the cursor sits where a command name
 * could begin, and it is the only position at which `[[`, `[`, `{`, `}` and `!` are
 * reserved words; in "arg" mode (the default) they fall through to the word rule at
 * the bottom and become ordinary text.
 *
 * The ladder below is ORDERED, longest match first: `&&` is tested before `&`, and
 * `;;&` before `;;` before `;&`. It is a sequence of tests rather than a table
 * precisely so that the order is visible, and reordering it changes the language.
 */
function nextToken(scan, mode = "arg") {
  skipBlanks(scan);
  const startByte = scan.byte;
  if (scan.pos >= scan.len) {
    return { type: "EOF", value: "", start: startByte, end: startByte };
  }
  const ch = scan.src[scan.pos];
  const next = peek(scan, 1);
  const after = peek(scan, 2);
  if (ch === "\n") {
    advance(scan);
    return { type: "NEWLINE", value: "\n", start: startByte, end: scan.byte };
  }
  if (ch === "#") {
    // A `#` opens a comment only when what precedes it is nothing, a blank, or a
    // metacharacter; anywhere else it is ordinary word text, which is what keeps
    // `foo#bar` one word. The set does not include the carriage return that
    // `skipBlanks` will have just consumed, so `"\r#b"` scans as two words rather than
    // a comment. Failing this test falls through to the rest of the ladder.
    const prev = scan.pos > 0 ? scan.src[scan.pos - 1] : "";
    if (prev === "" || " \t\n;&|<>()`".includes(prev)) {
      const commentStart = scan.pos;
      while (scan.pos < scan.len && scan.src[scan.pos] !== "\n") advance(scan);
      return {
        type: "COMMENT",
        value: scan.src.slice(commentStart, scan.pos),
        start: startByte,
        end: scan.byte,
      };
    }
  }
  if (ch === "&" && next === "&") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: "&&", start: startByte, end: scan.byte };
  }
  if (ch === "|" && next === "|") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: "||", start: startByte, end: scan.byte };
  }
  if (ch === "|" && next === "&") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: "|&", start: startByte, end: scan.byte };
  }
  if (ch === ";" && next === ";" && after === "&") {
    advance(scan);
    advance(scan);
    advance(scan);
    return { type: "OP", value: ";;&", start: startByte, end: scan.byte };
  }
  if (ch === ";" && next === ";") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: ";;", start: startByte, end: scan.byte };
  }
  if (ch === ";" && next === "&") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: ";&", start: startByte, end: scan.byte };
  }
  if (ch === ">" && next === ">") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: ">>", start: startByte, end: scan.byte };
  }
  if (ch === ">" && next === "&" && after === "-") {
    advance(scan);
    advance(scan);
    advance(scan);
    return { type: "OP", value: ">&-", start: startByte, end: scan.byte };
  }
  if (ch === ">" && next === "&") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: ">&", start: startByte, end: scan.byte };
  }
  if (ch === ">" && next === "|") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: ">|", start: startByte, end: scan.byte };
  }
  if (ch === "&" && next === ">" && after === ">") {
    advance(scan);
    advance(scan);
    advance(scan);
    return { type: "OP", value: "&>>", start: startByte, end: scan.byte };
  }
  if (ch === "&" && next === ">") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: "&>", start: startByte, end: scan.byte };
  }
  if (ch === "<" && next === "<" && after === "<") {
    advance(scan);
    advance(scan);
    advance(scan);
    return { type: "OP", value: "<<<", start: startByte, end: scan.byte };
  }
  if (ch === "<" && next === "<" && after === "-") {
    advance(scan);
    advance(scan);
    advance(scan);
    return { type: "OP", value: "<<-", start: startByte, end: scan.byte };
  }
  if (ch === "<" && next === "<") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: "<<", start: startByte, end: scan.byte };
  }
  if (ch === "<" && next === "&" && after === "-") {
    advance(scan);
    advance(scan);
    advance(scan);
    return { type: "OP", value: "<&-", start: startByte, end: scan.byte };
  }
  if (ch === "<" && next === "&") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: "<&", start: startByte, end: scan.byte };
  }
  if (ch === "<" && next === "(") {
    advance(scan);
    advance(scan);
    return { type: "LT_PAREN", value: "<(", start: startByte, end: scan.byte };
  }
  if (ch === ">" && next === "(") {
    advance(scan);
    advance(scan);
    return { type: "GT_PAREN", value: ">(", start: startByte, end: scan.byte };
  }
  if (ch === "(" && next === "(") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: "((", start: startByte, end: scan.byte };
  }
  if (ch === ")" && next === ")") {
    advance(scan);
    advance(scan);
    return { type: "OP", value: "))", start: startByte, end: scan.byte };
  }
  if (ch === "|" || ch === "&" || ch === ";" || ch === ">" || ch === "<") {
    advance(scan);
    return { type: "OP", value: ch, start: startByte, end: scan.byte };
  }
  if (ch === "(" || ch === ")") {
    advance(scan);
    return { type: "OP", value: ch, start: startByte, end: scan.byte };
  }
  if (mode === "cmd") {
    // `[[` is the test command only when a blank, a newline, end of input or `(`
    // follows it; `[[x]` is a glob. `[` alone is the `test` builtin, `{` opens a group
    // only when separated from what follows, and `!` negates only when a blank follows.
    if (
      ch === "[" &&
      next === "[" &&
      (after === " " ||
        after === "\t" ||
        after === "\n" ||
        after === "" ||
        after === "(")
    ) {
      advance(scan);
      advance(scan);
      return { type: "OP", value: "[[", start: startByte, end: scan.byte };
    }
    if (ch === "[") {
      advance(scan);
      return { type: "OP", value: "[", start: startByte, end: scan.byte };
    }
    if (ch === "{" && (next === " " || next === "\t" || next === "\n")) {
      advance(scan);
      return { type: "OP", value: "{", start: startByte, end: scan.byte };
    }
    if (ch === "}") {
      advance(scan);
      return { type: "OP", value: "}", start: startByte, end: scan.byte };
    }
    if (ch === "!" && (next === " " || next === "\t")) {
      advance(scan);
      return { type: "OP", value: "!", start: startByte, end: scan.byte };
    }
  }
  if (ch === '"') {
    // Only the opening quote is a token; the parser reads the contents itself, because
    // a double-quoted string can contain expansions that are nodes in their own right.
    advance(scan);
    return { type: "DQUOTE", value: '"', start: startByte, end: scan.byte };
  }
  if (ch === "'") {
    // A single-quoted string has no interior structure at all — not even backslash
    // escapes — so the whole literal, quotes included, becomes one token here.
    const quoteStart = scan.pos;
    advance(scan);
    while (scan.pos < scan.len && scan.src[scan.pos] !== "'") advance(scan);
    if (scan.pos < scan.len) advance(scan);
    return {
      type: "SQUOTE",
      value: scan.src.slice(quoteStart, scan.pos),
      start: startByte,
      end: scan.byte,
    };
  }
  if (ch === "$") {
    if (next === "(" && after === "(") {
      advance(scan);
      advance(scan);
      advance(scan);
      return {
        type: "DOLLAR_DPAREN",
        value: "$((",
        start: startByte,
        end: scan.byte,
      };
    }
    if (next === "(") {
      advance(scan);
      advance(scan);
      return {
        type: "DOLLAR_PAREN",
        value: "$(",
        start: startByte,
        end: scan.byte,
      };
    }
    if (next === "{") {
      advance(scan);
      advance(scan);
      return {
        type: "DOLLAR_BRACE",
        value: "${",
        start: startByte,
        end: scan.byte,
      };
    }
    if (next === "'") {
      // `$'...'` is the ANSI-C quoting form. Unlike a plain single-quoted string it
      // does honour backslash escapes, so a backslash consumes the character after it
      // and a `\'` cannot close the literal.
      const quoteStart = scan.pos;
      advance(scan);
      advance(scan);
      while (scan.pos < scan.len && scan.src[scan.pos] !== "'") {
        if (scan.src[scan.pos] === "\\" && scan.pos + 1 < scan.len) advance(scan);
        advance(scan);
      }
      if (scan.pos < scan.len) advance(scan);
      return {
        type: "ANSI_C",
        value: scan.src.slice(quoteStart, scan.pos),
        start: startByte,
        end: scan.byte,
      };
    }
    advance(scan);
    return { type: "DOLLAR", value: "$", start: startByte, end: scan.byte };
  }
  if (ch === "`") {
    advance(scan);
    return { type: "BACKTICK", value: "`", start: startByte, end: scan.byte };
  }
  if (isDigit(ch)) {
    // A run of digits sitting immediately before `<` or `>` is a file descriptor, as in
    // `2>err`. It has to be cut off here, because the word rule below would otherwise
    // glue the digits to whatever follows. The lookahead uses a plain index and only
    // commits — by advancing the real cursor — once the redirection is confirmed;
    // otherwise control falls through and the digits are scanned as an ordinary word.
    let lookahead = scan.pos;
    while (lookahead < scan.len && isDigit(scan.src[lookahead])) lookahead++;
    const following = lookahead < scan.len ? scan.src[lookahead] : "";
    if (following === ">" || following === "<") {
      const digitsStart = scan.pos;
      while (scan.pos < lookahead) advance(scan);
      return {
        type: "WORD",
        value: scan.src.slice(digitsStart, scan.pos),
        start: startByte,
        end: scan.byte,
      };
    }
  }
  if (isWordStart(ch) || ch === "{" || ch === "}") {
    // The bare-word rule. Braces count as word text here even though `isWordChar`
    // rejects them, so that brace expansion (`{a,b}`) scans as one word; in "cmd" mode
    // the rules above have already taken the group-opening forms. `#` is admitted
    // inside the run for the same reason `foo#bar` is one word.
    const wordStart = scan.pos;
    while (scan.pos < scan.len) {
      const current = scan.src[scan.pos];
      if (current === "\\") {
        if (scan.pos + 1 >= scan.len) break;
        // Upstream splits the escaped-newline case out and then does the same thing in
        // both arms: consume the backslash and the character it escapes. Kept as it is,
        // because this is a transliteration.
        if (scan.src[scan.pos + 1] === "\n") {
          advance(scan);
          advance(scan);
          continue;
        }
        advance(scan);
        advance(scan);
        continue;
      }
      if (
        !isWordChar(current) &&
        current !== "{" &&
        current !== "}" &&
        current !== "#"
      ) {
        break;
      }
      advance(scan);
    }
    // The loop can consume nothing — a trailing backslash at end of input breaks out
    // immediately — in which case the single-character fallback below takes over.
    if (scan.pos > wordStart) {
      const text = scan.src.slice(wordStart, scan.pos);
      if (/^-?\d+$/.test(text)) {
        return { type: "NUMBER", value: text, start: startByte, end: scan.byte };
      }
      return { type: "WORD", value: text, start: startByte, end: scan.byte };
    }
  }
  // Nothing above matched, so emit the single character as a word. This arm is what
  // guarantees the tokenizer always makes progress and never loops on unknown input.
  advance(scan);
  return { type: "WORD", value: ch, start: startByte, end: scan.byte };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE PARSER CORE — nodes, positions, and the statement level
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The radix that packs the scanner's two cursors into one number, and — the same
 * value, on purpose — the largest source this parser will look at.
 *
 * `mark` returns `byte * POSITION_RADIX + pos` so a caller can save and restore a
 * position with one local instead of two. That only works while both cursors stay
 * below the radix, and `parseProgram` guarantees it by refusing outright any input
 * whose UTF-8 length reaches 2^26 bytes: a string that long cannot have a UTF-16
 * index above that either. Upstream writes the literal `67108864` at both sites.
 */
const POSITION_RADIX = 67108864;

/**
 * The node budget. Every node construction charges one, and exceeding it aborts
 * the parse — which is a real bound rather than a formality, because the recovery
 * paths in this grammar can build nodes faster than they consume input.
 */
const MAX_NODES = 50000;

/**
 * The wall-clock budget a caller gets when it does not name one, in milliseconds.
 * Checked every 128th node rather than every node, so the clock read is amortised.
 */
const DEFAULT_BUDGET_MS = 50;

/**
 * Parse a whole command string into a `program` node. Upstream `ze`; this is the function
 * behind `PARSER_HANDLE.parse`.
 *
 * There are three distinct ways this returns something other than a tree:
 *  - the input is too large: if the source needs `POSITION_RADIX` bytes or more it cannot be
 *    addressed by the packed positions `mark` produces, so nothing is parsed at all and the
 *    result is `null`;
 *  - the parse aborts: `chargeNode` throws once the node budget or the time budget is spent,
 *    which sets `aborted` and yields `null`;
 *  - the source contains a construct bash and zsh disagree about (`zshBraceDiff`, set deep in
 *    word parsing). That is not a parse failure — the tree is fine — but the caller must not
 *    trust it, so the whole program is wrapped in an `ERROR` node spanning the same range.
 *
 * Any other exception is also swallowed into `null`.
 *
 * @param {string} command
 * @param {number} [budgetMs] wall-clock budget; defaults to `DEFAULT_BUDGET_MS`
 * @returns {object | null}
 */
function parseProgram(command, budgetMs) {
  const scan = newScanner(command);
  const srcBytes = utf8Length(command);
  if (srcBytes >= POSITION_RADIX) return null;
  const p = {
    scan: scan,
    src: command,
    srcBytes: srcBytes,
    isAscii: srcBytes === command.length,
    nodeCount: 0,
    deadline: performance.now() + (budgetMs ?? DEFAULT_BUDGET_MS),
    aborted: false,
    inBacktick: 0,
    inDquote: 0,
    stopToken: null,
    zshBraceDiff: false,
  };
  try {
    const program = parseRoot(p);
    if (p.aborted) return null;
    if (p.zshBraceDiff)
      return node(p, "ERROR", program.startIndex, program.endIndex, [program]);
    return program;
  } catch {
    return null;
  }
}

/**
 * Length of a JavaScript string in UTF-8 bytes. Upstream `qe`.
 *
 * Every node position in this parser is a byte offset, so the byte length of the source is
 * needed up front. A high surrogate is counted as 4 bytes and its low surrogate is skipped,
 * so a surrogate pair contributes 4 bytes once.
 *
 * @param {string} text
 * @returns {number}
 */
function utf8Length(text) {
  let total = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 128) total++;
    else if (code < 2048) total += 2;
    else if (code >= 55296 && code <= 56319) {
      total += 4;
      index++;
    } else total += 3;
  }
  return total;
}

/**
 * Charge one node against the parse budgets, throwing to unwind the whole parse when either is
 * exhausted. Upstream `Ke`.
 *
 * Two budgets: a hard cap of `MAX_NODES` nodes, checked on every node, and the wall-clock
 * deadline, checked only every 128th node because `performance.now()` is far more expensive
 * than the counter increment. Both set `aborted` before throwing so `parseProgram` can tell an
 * abort from any other exception. The thrown message is never inspected.
 *
 * @param {object} p parser context
 */
function chargeNode(p) {
  p.nodeCount++;
  if (p.nodeCount > MAX_NODES) {
    p.aborted = true;
    throw new Error("budget");
  }
  if ((p.nodeCount & 127) === 0 && performance.now() > p.deadline) {
    p.aborted = true;
    throw new Error("timeout");
  }
}

/**
 * Build a syntax node. Upstream `u`.
 *
 * Every node in the tree is created here, which is why the budget is charged here too — and it
 * is charged before the text is sliced, so an over-budget parse does no further work.
 *
 * `start` and `end` are UTF-8 byte offsets, not string indices; `text` is the source text they
 * span. The five keys and their order are part of the contract with downstream consumers.
 *
 * @param {object} p parser context
 * @param {string} type
 * @param {number} start byte offset
 * @param {number} end byte offset
 * @param {object[]} children
 * @returns {object}
 */
function node(p, type, start, end, children) {
  chargeNode(p);
  return {
    type: type,
    text: sliceBytes(p, start, end),
    startIndex: start,
    endIndex: end,
    children: children,
  };
}

/**
 * Recover the source text spanned by a UTF-8 byte range. Upstream `F`.
 *
 * When the source is pure ASCII a byte offset and a UTF-16 index are the same number, so this
 * is a plain `slice`. Otherwise the scanner's `byteTable` (character index -> byte offset, a
 * non-decreasing array built lazily by `byteOffsetOf`) is binary-searched twice, once per
 * endpoint, for the lowest character index whose byte offset is not below the target.
 *
 * @param {object} p parser context
 * @param {number} startByte
 * @param {number} endByte
 * @returns {string}
 */
function sliceBytes(p, startByte, endByte) {
  if (p.isAscii) return p.src.slice(startByte, endByte);
  const scan = p.scan;
  if (!scan.byteTable) byteOffsetOf(scan, 0);
  const byteTable = scan.byteTable;
  let low = 0;
  let high = p.src.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (byteTable[mid] < startByte) low = mid + 1;
    else high = mid;
  }
  const startCharIndex = low;
  low = startCharIndex;
  high = p.src.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (byteTable[mid] < endByte) low = mid + 1;
    else high = mid;
  }
  return p.src.slice(startCharIndex, low);
}

/**
 * Build a childless node covering exactly one token. Upstream `g`.
 *
 * @param {object} p parser context
 * @param {string} type
 * @param {object} token
 * @returns {object}
 */
function tokenNode(p, type, token) {
  return node(p, type, token.start, token.end, []);
}

/**
 * Parse the top level of the source into a `program` node. Upstream `Fe`.
 *
 * Two phases. First, leading blank lines are skipped so the program's start byte is the first
 * byte of real content rather than byte 0. Then statements are read until the source is
 * exhausted; comments become nodes of their own, blank lines are ignored, and anything
 * `parseStatements` refuses to consume becomes a one-token `ERROR` node so that the loop always
 * makes progress. A stray `;;` after at least one statement is tolerated silently — it is a
 * `case` terminator that leaked out of its `case`.
 *
 * An empty program (no statements at all) is given a zero-width span at the content start;
 * otherwise the program ends at the last byte of the source, including any trailing whitespace.
 *
 * @param {object} p parser context
 * @returns {object}
 */
function parseRoot(p) {
  const statements = [];
  skipBlanks(p.scan);
  while (true) {
    const saved = mark(p.scan);
    if (nextToken(p.scan, "cmd").type === "NEWLINE") {
      skipBlanks(p.scan);
      continue;
    }
    reset(p.scan, saved);
    break;
  }
  const startByte = p.scan.byte;
  while (p.scan.pos < p.scan.len) {
    const saved = mark(p.scan);
    const tok = nextToken(p.scan, "cmd");
    if (tok.type === "EOF") break;
    if (tok.type === "NEWLINE") continue;
    if (tok.type === "COMMENT") {
      statements.push(tokenNode(p, "comment", tok));
      continue;
    }
    reset(p.scan, saved);
    const parsed = parseStatements(p, null);
    for (const statement of parsed) {
      statements.push(statement);
    }
    if (parsed.length === 0) {
      const stuck = nextToken(p.scan, "cmd");
      if (stuck.type === "EOF") break;
      if (stuck.type === "OP" && stuck.value === ";;" && statements.length > 0)
        continue;
      statements.push(node(p, "ERROR", stuck.start, stuck.end, []));
    }
  }
  const endByte = statements.length > 0 ? p.srcBytes : startByte;
  return node(p, "program", startByte, endByte, statements);
}

/**
 * Capture the scanner's current position as a single number. Upstream `w`.
 *
 * The scanner carries two cursors that must move together: `byte`, the UTF-8 offset every node
 * records, and `pos`, the UTF-16 index it actually reads with. Backtracking has to restore both
 * or the two drift apart, so they are packed into one value as `byte * POSITION_RADIX + pos`.
 * That lets every speculative read in this parser save and restore its position with a single
 * local instead of a pair. The packing is lossless because `parseProgram` refuses any source of
 * `POSITION_RADIX` bytes or more, which bounds `pos` below the radix as well.
 *
 * @param {object} scan
 * @returns {number} packed position, to be handed to `reset`
 */
function mark(scan) {
  return scan.byte * POSITION_RADIX + scan.pos;
}

/**
 * Restore a position captured by `mark`, unpacking both cursors. Upstream `v`.
 *
 * @param {object} scan
 * @param {number} packed
 */
function reset(scan, packed) {
  const byte = Math.floor(packed / POSITION_RADIX);
  scan.pos = packed - byte * POSITION_RADIX;
  scan.byte = byte;
}

/**
 * Parse a run of statements and the separators between them. Upstream `D`.
 *
 * This is the body of every construct that holds a statement list: the top level, `( … )`,
 * `{ … }`, `then`/`do` bodies, and so on. It returns a flat array in which the separator tokens
 * (`;` and `&`) appear as their own nodes between the statements they separate — the caller
 * splices that array straight into its own children.
 *
 * The loop stops without consuming anything at: end of input; `stopValue` if the caller named
 * one; any of the closing operators that end an enclosing construct; a backtick while inside a
 * backtick substitution; and any of the keywords that begin the next clause of an enclosing
 * compound statement (`then`, `else`, `done`, …). In every one of those cases the lookahead is
 * rewound so the caller sees the token itself.
 *
 * After each statement the trailing separator is examined. A `;` or `&` is always emitted as a
 * node; the token past it is then peeked at (and rewound) purely to decide nothing else here —
 * both outcomes continue the loop — because the interesting work is that the peek is discarded
 * either way. A newline instead of a separator triggers heredoc body collection, since a
 * heredoc's body starts on the line after the line that named it.
 *
 * @param {object} p parser context
 * @param {string | null} stopValue operator value that ends the list, or null
 * @returns {object[]}
 */
function parseStatements(p, stopValue) {
  const statements = [];
  while (true) {
    skipBlanks(p.scan);
    const saved = mark(p.scan);
    const tok = nextToken(p.scan, "cmd");
    if (tok.type === "EOF") {
      reset(p.scan, saved);
      break;
    }
    if (tok.type === "NEWLINE") {
      if (p.scan.heredocs.length > 0) collectHeredocBodies(p);
      continue;
    }
    if (tok.type === "COMMENT") {
      statements.push(tokenNode(p, "comment", tok));
      continue;
    }
    if (stopValue && tok.type === "OP" && tok.value === stopValue) {
      reset(p.scan, saved);
      break;
    }
    if (
      tok.type === "OP" &&
      (tok.value === ")" ||
        tok.value === "}" ||
        tok.value === ";;" ||
        tok.value === ";&" ||
        tok.value === ";;&" ||
        tok.value === "))" ||
        tok.value === "]]" ||
        tok.value === "]")
    ) {
      reset(p.scan, saved);
      break;
    }
    if (tok.type === "BACKTICK" && p.inBacktick > 0) {
      reset(p.scan, saved);
      break;
    }
    if (
      tok.type === "WORD" &&
      (tok.value === "then" ||
        tok.value === "elif" ||
        tok.value === "else" ||
        tok.value === "fi" ||
        tok.value === "do" ||
        tok.value === "done" ||
        tok.value === "esac")
    ) {
      reset(p.scan, saved);
      break;
    }
    reset(p.scan, saved);
    const statement = parseAndOrList(p);
    if (!statement) break;
    statements.push(statement);
    skipBlanks(p.scan);
    const savedBeforeSeparator = mark(p.scan);
    const separator = nextToken(p.scan, "cmd");
    if (
      separator.type === "OP" &&
      (separator.value === ";" || separator.value === "&")
    ) {
      const savedBeforeLookahead = mark(p.scan);
      const lookahead = nextToken(p.scan, "cmd");
      reset(p.scan, savedBeforeLookahead);
      statements.push(tokenNode(p, separator.value, separator));
      if (
        lookahead.type === "EOF" ||
        (lookahead.type === "OP" &&
          (lookahead.value === ")" ||
            lookahead.value === "}" ||
            lookahead.value === ";;" ||
            lookahead.value === ";&" ||
            lookahead.value === ";;&")) ||
        (lookahead.type === "WORD" &&
          (lookahead.value === "then" ||
            lookahead.value === "elif" ||
            lookahead.value === "else" ||
            lookahead.value === "fi" ||
            lookahead.value === "do" ||
            lookahead.value === "done" ||
            lookahead.value === "esac"))
      )
        continue;
    } else if (separator.type === "NEWLINE") {
      if (p.scan.heredocs.length > 0) collectHeredocBodies(p);
      continue;
    } else reset(p.scan, savedBeforeSeparator);
  }
  return statements;
}

/**
 * Parse one statement: a pipeline, then any `&&` / `||` continuations. Upstream `ke`.
 *
 * The result is left-associative — `a && b || c` becomes `list(list(a, &&, b), ||, c)` — which
 * matches bash, where the two operators have equal precedence.
 *
 * The non-obvious part is the rebalancing when the right-hand operand comes back as a
 * `redirected_statement`. A redirection binds to the whole list, not to the last command:
 * `a && b > f` must group as `(a && b) > f`. But `parsePipeline` has already attached the `> f`
 * to `b` and handed back `redirected_statement(b, > f)`. So the redirected statement is taken
 * apart: its first child is the real operand and goes into the `list` node, and the remaining
 * children (the redirections) are re-wrapped around that list. The list's span ends at the
 * operand and the outer node's span ends at the last redirection.
 *
 * If the right-hand side is missing entirely the operator is not dropped — the partial input is
 * preserved as an `ERROR` node holding both the left side and the dangling operator.
 *
 * @param {object} p parser context
 * @returns {object | null}
 */
function parseAndOrList(p) {
  let left = parsePipeline(p);
  if (!left) return null;
  while (true) {
    const saved = mark(p.scan);
    const tok = nextToken(p.scan, "cmd");
    if (tok.type === "OP" && (tok.value === "&&" || tok.value === "||")) {
      const operatorNode = tokenNode(p, tok.value, tok);
      skipNewlines(p);
      const right = parsePipeline(p);
      if (!right) {
        left = node(p, "ERROR", left.startIndex, operatorNode.endIndex, [
          left,
          operatorNode,
        ]);
        break;
      }
      if (right.type === "redirected_statement" && right.children.length >= 2) {
        const operand = right.children[0];
        const redirections = right.children.slice(1);
        const listNode = node(p, "list", left.startIndex, operand.endIndex, [
          left,
          operatorNode,
          operand,
        ]);
        const lastRedirection = redirections.at(-1);
        left = node(
          p,
          "redirected_statement",
          listNode.startIndex,
          lastRedirection.endIndex,
          [listNode, ...redirections],
        );
      } else
        left = node(p, "list", left.startIndex, right.endIndex, [
          left,
          operatorNode,
          right,
        ]);
    } else {
      reset(p.scan, saved);
      break;
    }
  }
  return left;
}

/**
 * Consume any run of newline tokens. Upstream `q`.
 *
 * Used after `&&`, `||` and `|`, where bash allows the right-hand operand to start on a later
 * line. The first non-newline token is rewound.
 *
 * @param {object} p parser context
 */
function skipNewlines(p) {
  while (true) {
    const saved = mark(p.scan);
    if (nextToken(p.scan, "cmd").type !== "NEWLINE") {
      reset(p.scan, saved);
      break;
    }
  }
}

/**
 * Parse a pipeline: command units joined by `|` or `|&`. Upstream `he`.
 *
 * The children array holds the units and the operator nodes interleaved, in source order. A
 * pipeline of one unit is not wrapped — the unit is returned as-is — so `pipeline` nodes only
 * ever appear where there is a real pipe.
 *
 * The redirection rebalancing is the same one `parseAndOrList` performs and is explained there:
 * `a | b > f` must group as `(a | b) > f`, so the right operand's redirections are lifted off,
 * the pipeline is built around the bare operand, and the redirections are re-wrapped around the
 * pipeline. The difference here is that a pipeline is n-ary, so the accumulated parts are
 * collapsed into that single re-wrapped node and the loop continues from it — any further `|`
 * pipes into the redirected result.
 *
 * A trailing `|` with nothing after it keeps the operator node and stops.
 *
 * @param {object} p parser context
 * @returns {object | null}
 */
function parsePipeline(p) {
  let first = parseCommandUnit(p);
  if (!first) return null;
  const parts = [first];
  while (true) {
    const saved = mark(p.scan);
    const tok = nextToken(p.scan, "cmd");
    if (tok.type === "OP" && (tok.value === "|" || tok.value === "|&")) {
      const operatorNode = tokenNode(p, tok.value, tok);
      skipNewlines(p);
      const right = parseCommandUnit(p);
      if (!right) {
        parts.push(operatorNode);
        break;
      }
      if (
        right.type === "redirected_statement" &&
        right.children.length >= 2 &&
        parts.length >= 1
      ) {
        const operand = right.children[0];
        const redirections = right.children.slice(1);
        const pipelineChildren = [...parts, operatorNode, operand];
        const pipelineNode = node(
          p,
          "pipeline",
          pipelineChildren[0].startIndex,
          operand.endIndex,
          pipelineChildren,
        );
        const lastRedirection = redirections.at(-1);
        const wrapped = node(
          p,
          "redirected_statement",
          pipelineNode.startIndex,
          lastRedirection.endIndex,
          [pipelineNode, ...redirections],
        );
        parts.length = 0;
        parts.push(wrapped);
        first = wrapped;
        continue;
      }
      parts.push(operatorNode, right);
    } else {
      reset(p.scan, saved);
      break;
    }
  }
  if (parts.length === 1) return parts[0];
  const lastPart = parts.at(-1);
  return node(p, "pipeline", parts[0].startIndex, lastPart.endIndex, parts);
}

/**
 * Parse one command unit — the thing a pipe connects. Upstream `U`.
 *
 * This is the dispatcher. In order: `!` negation, `( … )` subshell, `(( … ))` arithmetic,
 * `{ … }` group, `[` / `[[` test, then the keyword-led compound statements (`if`, `while`,
 * `until`, `for`, `select`, `case`, `function`), then declaration commands (`export`,
 * `declare`, …) and `unset`, and finally a plain simple command.
 *
 * Most arms end in `attachRedirects`, which consumes any redirections that follow the unit and
 * wraps it in a `redirected_statement`. The `(( … ))` arm does not, and `function` handles its
 * own. The compound-statement arms pass the third argument so here-strings are accepted too.
 *
 * The keyword arms are guarded by `isDelimiter(peek(p.scan))`: the keyword token has been
 * consumed, so the next character must be a delimiter for it to have been a keyword rather than
 * the prefix of a longer word such as `iffy`.
 *
 * @param {object} p parser context
 * @returns {object | null}
 */
function parseCommandUnit(p) {
  skipBlanks(p.scan);
  const start = mark(p.scan);
  const tok = nextToken(p.scan, "cmd");
  if (tok.type === "EOF") {
    reset(p.scan, start);
    return null;
  }
  if (tok.type === "OP" && tok.value === "!") {
    const bangNode = tokenNode(p, "!", tok);
    const operand = parseCommandUnit(p);
    if (!operand)
      return node(
        p,
        "negated_command",
        bangNode.startIndex,
        bangNode.endIndex,
        [bangNode],
      );
    if (
      operand.type === "redirected_statement" &&
      operand.children.length >= 2
    ) {
      const inner = operand.children[0];
      const redirections = operand.children.slice(1);
      const negatedNode = node(
        p,
        "negated_command",
        bangNode.startIndex,
        inner.endIndex,
        [bangNode, inner],
      );
      const lastRedirection = redirections.at(-1);
      return node(
        p,
        "redirected_statement",
        negatedNode.startIndex,
        lastRedirection.endIndex,
        [negatedNode, ...redirections],
      );
    }
    return node(p, "negated_command", bangNode.startIndex, operand.endIndex, [
      bangNode,
      operand,
    ]);
  }
  if (tok.type === "OP" && tok.value === "(") {
    const openNode = tokenNode(p, "(", tok);
    const body = parseStatements(p, ")");
    const closeTok = nextToken(p.scan, "cmd");
    const closeNode =
      closeTok.type === "OP" && closeTok.value === ")"
        ? tokenNode(p, ")", closeTok)
        : node(p, ")", openNode.endIndex, openNode.endIndex, []);
    const subshellNode = node(
      p,
      "subshell",
      openNode.startIndex,
      closeNode.endIndex,
      [openNode, ...body, closeNode],
    );
    return attachRedirects(p, subshellNode);
  }
  if (tok.type === "OP" && tok.value === "((") {
    const openNode = tokenNode(p, "((", tok);
    const expressions = parseArithmeticList(p, "))", "var");
    const closeTok = nextToken(p.scan, "cmd");
    const closeNode =
      closeTok.value === "))"
        ? tokenNode(p, "))", closeTok)
        : node(p, "))", openNode.endIndex, openNode.endIndex, []);
    return node(
      p,
      "compound_statement",
      openNode.startIndex,
      closeNode.endIndex,
      [openNode, ...expressions, closeNode],
    );
  }
  if (tok.type === "OP" && tok.value === "{") {
    const openNode = tokenNode(p, "{", tok);
    const body = parseStatements(p, "}");
    const closeTok = nextToken(p.scan, "cmd");
    const closeNode =
      closeTok.type === "OP" && closeTok.value === "}"
        ? tokenNode(p, "}", closeTok)
        : node(p, "}", openNode.endIndex, openNode.endIndex, []);
    const groupNode = node(
      p,
      "compound_statement",
      openNode.startIndex,
      closeNode.endIndex,
      [openNode, ...body, closeNode],
    );
    return attachRedirects(p, groupNode);
  }
  if (tok.type === "OP" && (tok.value === "[" || tok.value === "[[")) {
    const openNode = tokenNode(p, tok.value, tok);
    const closeValue = tok.value === "[" ? "]" : "]]";
    const afterOpen = mark(p.scan);
    let testExpr = parseTestExpression(p, closeValue);
    skipBlanks(p.scan);
    if (tok.value === "[" && peek(p.scan) !== "]") {
      // Single-bracket `[` is an ordinary command, so redirections still apply inside it:
      // `[ a > b ]` writes to the file `b` rather than comparing `a` with `b`.
      // `parseTestExpression` stops at the `>` without consuming it, so failing to land on the
      // closing `]` is the signal that this is that case. Back up to just after the `[` and
      // re-parse the same text as a command unit, with `stopToken` set to `]` so the re-parse
      // knows where to stop. The retry is only believed if it produced a
      // `redirected_statement`; otherwise the scanner is rewound again and the original
      // test-expression reading is redone from scratch. `stopToken` is saved and restored
      // because this function is re-entered recursively and the outer value must survive.
      reset(p.scan, afterOpen);
      const savedStopToken = p.stopToken;
      p.stopToken = "]";
      const retry = parseCommandUnit(p);
      p.stopToken = savedStopToken;
      if (retry && retry.type === "redirected_statement") testExpr = retry;
      else {
        reset(p.scan, afterOpen);
        testExpr = parseTestExpression(p, closeValue);
      }
      skipBlanks(p.scan);
    }
    const savedBeforeClose = mark(p.scan);
    const closeTok = nextToken(p.scan, "arg");
    let closeNode;
    if (
      closeTok.value === closeValue &&
      (closeValue === "]]"
        ? isDelimiterExceptParen(peek(p.scan))
        : isDelimiter(peek(p.scan)))
    )
      closeNode = tokenNode(p, closeValue, closeTok);
    else {
      reset(p.scan, savedBeforeClose);
      closeNode = node(p, closeValue, openNode.endIndex, openNode.endIndex, []);
    }
    const children = testExpr
      ? [openNode, testExpr, closeNode]
      : [openNode, closeNode];
    return attachRedirects(
      p,
      node(
        p,
        "test_command",
        openNode.startIndex,
        closeNode.endIndex,
        children,
      ),
    );
  }
  if (tok.type === "WORD" && isDelimiter(peek(p.scan))) {
    if (tok.value === "if") return attachRedirects(p, parseIf(p, tok), true);
    if (tok.value === "while" || tok.value === "until")
      return attachRedirects(p, parseWhile(p, tok), true);
    if (tok.value === "for") return attachRedirects(p, parseFor(p, tok), true);
    if (tok.value === "select")
      return attachRedirects(p, parseFor(p, tok), true);
    if (tok.value === "case")
      return attachRedirects(p, parseCase(p, tok), true);
    if (tok.value === "function") return parseFunctionKeyword(p, tok);
    if (DECLARATION_COMMANDS.has(tok.value))
      return attachRedirects(p, parseDeclarationCommand(p, tok));
    if (tok.value === "unset" || tok.value === "unsetenv") {
      // `unset` has its own argument grammar, but `unset () { … }` is a legal function
      // definition named `unset`. Peek past the word for `(` immediately followed by `)`; if
      // that is what follows, fall through to the simple-command path, which handles function
      // definitions. Either way the scanner is rewound first.
      const savedAfterWord = mark(p.scan);
      skipBlanks(p.scan);
      let isFunctionDefinition = false;
      if (peek(p.scan) === "(") {
        nextToken(p.scan, "cmd");
        skipBlanks(p.scan);
        isFunctionDefinition = peek(p.scan) === ")";
      }
      reset(p.scan, savedAfterWord);
      if (!isFunctionDefinition)
        return attachRedirects(p, parseUnsetCommand(p, tok));
    }
  }
  reset(p.scan, start);
  return parseSimpleCommand(p);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE SIMPLE COMMAND, ITS ASSIGNMENTS AND ITS REDIRECTION ATTACHMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse a simple command: the ordinary `NAME=value cmd arg arg >out` shape, plus the two
 * degenerate forms that have no command word at all (a bare assignment, a bare redirection).
 * Upstream `Ue`.
 *
 * Four phases, in order:
 *   1. eat the leading run of assignments and redirections that may precede a command word;
 *   2. look one token ahead to decide whether a command word follows at all — if not, the run
 *      collected in phase 1 IS the whole node, and its shape depends on what the run contained;
 *   3. speculatively probe for `name ( )`, which makes this a function definition, not a command;
 *   4. consume arguments and trailing redirections until a terminator.
 *
 * Returns null when there is nothing here to parse.
 */
function parseSimpleCommand(p) {
  const startByte = p.scan.byte;
  const assignments = [];
  const leadingRedirects = [];

  // Phase 1: the leading run of `NAME=value` assignments and `>file` redirections.
  while (true) {
    skipBlanks(p.scan);
    const assignment = parseVariableAssignment(p);
    if (assignment) {
      assignments.push(assignment);
      continue;
    }
    const redirect = parseRedirect(p);
    if (redirect) {
      leadingRedirects.push(redirect);
      continue;
    }
    break;
  }

  // Phase 2: is there a command word after the run? Peek one token and put it back either way.
  // A terminator, a comment, a backtick, an operator that is not a group opener, or a reserved
  // word (except `in`, which is an ordinary word here) all mean "no command follows".
  skipBlanks(p.scan);
  const beforeLookahead = mark(p.scan);
  const lookahead = nextToken(p.scan, "cmd");
  if (
    lookahead.type === "EOF" ||
    lookahead.type === "NEWLINE" ||
    lookahead.type === "COMMENT" ||
    lookahead.type === "BACKTICK" ||
    (lookahead.type === "OP" &&
      lookahead.value !== "{" &&
      lookahead.value !== "[" &&
      lookahead.value !== "[[") ||
    (lookahead.type === "WORD" &&
      SHELL_KEYWORDS.has(lookahead.value) &&
      lookahead.value !== "in")
  ) {
    reset(p.scan, beforeLookahead);
    // Four shapes for what phase 1 collected, in this order of preference.
    if (assignments.length === 1 && leadingRedirects.length === 0) {
      return assignments[0];
    }
    if (leadingRedirects.length > 0 && assignments.length === 0) {
      const last = leadingRedirects.at(-1);
      return node(
        p,
        "redirected_statement",
        leadingRedirects[0].startIndex,
        last.endIndex,
        leadingRedirects,
      );
    }
    if (assignments.length > 1 && leadingRedirects.length === 0) {
      const last = assignments.at(-1);
      return node(
        p,
        "variable_assignments",
        assignments[0].startIndex,
        last.endIndex,
        assignments,
      );
    }
    if (assignments.length > 0 || leadingRedirects.length > 0) {
      const parts = [...assignments, ...leadingRedirects];
      const last = parts.at(-1);
      return node(p, "command", startByte, last.endIndex, parts);
    }
    return null;
  }
  reset(p.scan, beforeLookahead);

  // Phase 3: the function-definition probe. `name ( )` followed by a body is a definition rather
  // than a command. This is entirely speculative — the word is read, the parentheses are read,
  // and every read is rewound: first the inner probe back to `beforeParenProbe`, then the whole
  // phase back to `beforeCommandWord` on the way out. Only the success path returns without
  // rewinding.
  const beforeCommandWord = mark(p.scan);
  const firstWord = parseWord(p, "cmd");
  if (firstWord && firstWord.type === "word") {
    skipBlanks(p.scan);
    let looksLikeFunction = false;
    if (peek(p.scan) === "(") {
      const beforeParenProbe = mark(p.scan);
      nextToken(p.scan, "cmd");
      skipBlanks(p.scan);
      looksLikeFunction = peek(p.scan) === ")";
      reset(p.scan, beforeParenProbe);
    }
    if (looksLikeFunction) {
      const openToken = nextToken(p.scan, "cmd");
      skipBlanks(p.scan);
      const closeToken = nextToken(p.scan, "cmd");
      const openParen = tokenNode(p, "(", openToken);
      const closeParen = tokenNode(p, ")", closeToken);
      skipBlanks(p.scan);
      skipNewlines(p);
      const body = parseCommandUnit(p);
      if (body) {
        let bodyParts = [body];
        // `f() { ... } >log` parses as a redirected_statement wrapping the braces. The definition
        // node wants the brace group and the redirections as siblings, so unwrap that one case.
        if (
          body.type === "redirected_statement" &&
          body.children.length >= 2 &&
          body.children[0].type === "compound_statement"
        ) {
          bodyParts = body.children;
        }
        const lastBodyPart = bodyParts.at(-1);
        return node(
          p,
          "function_definition",
          firstWord.startIndex,
          lastBodyPart.endIndex,
          [firstWord, openParen, closeParen, ...bodyParts],
        );
      }
    }
  }
  reset(p.scan, beforeCommandWord);

  // Phase 4: the real command word, then arguments and redirections until a terminator.
  const commandWord = parseWord(p, "cmd");
  if (!commandWord) {
    if (assignments.length === 1) {
      return assignments[0];
    }
    return null;
  }
  const commandName = node(
    p,
    "command_name",
    commandWord.startIndex,
    commandWord.endIndex,
    [commandWord],
  );
  // Three buckets, because the three kinds of redirection attach to different places:
  // herestrings sit inline among the arguments, file redirections wrap the finished command in a
  // redirected_statement, and a heredoc needs its body scanned later (see the handoff below).
  const args = [];
  const fileRedirects = [];
  let heredocRedirect = null;
  while (true) {
    skipBlanks(p.scan);
    const redirect = parseRedirect(p, true);
    if (redirect) {
      if (redirect.type === "heredoc_redirect") {
        heredocRedirect = redirect;
      } else if (redirect.type === "herestring_redirect") {
        args.push(redirect);
      } else {
        fileRedirects.push(redirect);
      }
      continue;
    }
    if (fileRedirects.length > 0) {
      break;
    }
    if (p.stopToken === "]" && peek(p.scan) === "]") {
      break;
    }
    // Peek for a terminator; rewind whether or not one is found, since parseWord below must see
    // the same position and the terminator itself belongs to the caller.
    const beforeTerminatorProbe = mark(p.scan);
    const terminator = nextToken(p.scan, "arg");
    if (
      terminator.type === "EOF" ||
      terminator.type === "NEWLINE" ||
      terminator.type === "COMMENT" ||
      (terminator.type === "OP" &&
        (terminator.value === "|" ||
          terminator.value === "|&" ||
          terminator.value === "&&" ||
          terminator.value === "||" ||
          terminator.value === ";" ||
          terminator.value === ";;" ||
          terminator.value === ";&" ||
          terminator.value === ";;&" ||
          terminator.value === "&" ||
          terminator.value === ")" ||
          terminator.value === "}" ||
          terminator.value === "))"))
    ) {
      reset(p.scan, beforeTerminatorProbe);
      break;
    }
    reset(p.scan, beforeTerminatorProbe);
    const arg = parseWord(p, "arg");
    if (!arg) {
      // Not a word, but a `(` still starts a subshell that can appear in argument position.
      if (peek(p.scan) === "(") {
        const openToken = nextToken(p.scan, "cmd");
        const openParen = tokenNode(p, "(", openToken);
        const statements = parseStatements(p, ")");
        const beforeCloseProbe = mark(p.scan);
        const closeToken = nextToken(p.scan, "cmd");
        let closeParen;
        if (closeToken.type === "OP" && closeToken.value === ")") {
          closeParen = tokenNode(p, ")", closeToken);
        } else {
          // Unterminated: rewind and synthesise a zero-width `)` so the tree still has one.
          reset(p.scan, beforeCloseProbe);
          closeParen = node(p, ")", openParen.endIndex, openParen.endIndex, []);
        }
        args.push(
          node(p, "subshell", openParen.startIndex, closeParen.endIndex, [
            openParen,
            ...statements,
            closeParen,
          ]),
        );
        continue;
      }
      break;
    }
    // A bare `=` is not a legal argument.
    if (arg.type === "word" && arg.text === "=") {
      args.push(node(p, "ERROR", arg.startIndex, arg.endIndex, [arg]));
      continue;
    }
    // A word butted straight up against a `(` — `foo(bar)` — is an error, not an argument: it is
    // a function-definition opener that phase 3's probe already rejected, because the probe only
    // accepts an empty `( )`. The byte-offset equality is what enforces "no space between".
    if (
      (arg.type === "word" || arg.type === "concatenation") &&
      peek(p.scan) === "(" &&
      p.scan.byte === arg.endIndex
    ) {
      args.push(node(p, "ERROR", arg.startIndex, arg.endIndex, [arg]));
      continue;
    }
    args.push(arg);
  }

  const commandChildren = [
    ...assignments,
    ...leadingRedirects,
    commandName,
    ...args,
  ];
  // commandChildren always holds at least commandName, so the fallback never fires; kept verbatim.
  const endByte =
    commandChildren.length > 0
      ? commandChildren.at(-1).endIndex
      : commandName.endIndex;
  const commandStart = commandChildren[0].startIndex;
  const command = node(p, "command", commandStart, endByte, commandChildren);

  // The heredoc handoff. A heredoc's body does not live where the `<<WORD` operator was written:
  // it starts after the newline that ends this command line, and runs to the terminator line.
  // So the redirect node was built earlier with only its operator and delimiter children, and its
  // extent is finished here — collectHeredocBodies scans past the newline and fills in the
  // pending record's offsets, and only then can the body and end nodes be attached and the
  // redirect's endIndex and text be rewritten. This is the one place a node is mutated after
  // construction.
  if (heredocRedirect) {
    collectHeredocBodies(p);
    const record = p.scan.heredocs.shift();
    if (record && heredocRedirect.children.length >= 2) {
      const bodyNode = node(
        p,
        "heredoc_body",
        record.bodyStart,
        record.bodyEnd,
        record.quoted
          ? []
          : parseHeredocBody(p, record.bodyStart, record.bodyEnd),
      );
      const endNode = node(
        p,
        "heredoc_end",
        record.endStart,
        record.endEnd,
        [],
      );
      heredocRedirect.children.push(bodyNode, endNode);
      heredocRedirect.endIndex = record.endEnd;
      heredocRedirect.text = sliceBytes(
        p,
        heredocRedirect.startIndex,
        record.endEnd,
      );
    }
    const trailingRedirects = [
      ...leadingRedirects,
      heredocRedirect,
      ...fileRedirects,
    ];
    const redirectedStart =
      leadingRedirects.length > 0
        ? Math.min(command.startIndex, leadingRedirects[0].startIndex)
        : command.startIndex;
    return node(
      p,
      "redirected_statement",
      redirectedStart,
      heredocRedirect.endIndex,
      [command, ...trailingRedirects],
    );
  }

  if (fileRedirects.length > 0) {
    const last = fileRedirects.at(-1);
    return node(p, "redirected_statement", command.startIndex, last.endIndex, [
      command,
      ...fileRedirects,
    ]);
  }
  return command;
}

/**
 * Consume any redirections that trail an already-parsed statement and, if there were any, wrap it
 * in a redirected_statement. Upstream `W`.
 *
 * Herestrings (`<<<`) are only accepted when the caller asks for them; otherwise the scanner is
 * rewound so the herestring is left for whoever comes next.
 */
function attachRedirects(p, statement, allowHerestring = false) {
  const redirects = [];
  while (true) {
    skipBlanks(p.scan);
    const beforeRedirect = mark(p.scan);
    const redirect = parseRedirect(p);
    if (!redirect) {
      break;
    }
    if (redirect.type === "herestring_redirect" && !allowHerestring) {
      reset(p.scan, beforeRedirect);
      break;
    }
    redirects.push(redirect);
  }
  if (redirects.length === 0) {
    return statement;
  }
  const last = redirects.at(-1);
  return node(p, "redirected_statement", statement.startIndex, last.endIndex, [
    statement,
    ...redirects,
  ]);
}

/**
 * Parse a variable assignment: `name=value`, `name+=value`, or `name[subscript]=value`.
 * Upstream `Ne`.
 *
 * Speculative: the position is saved on entry, and anything that turns out not to be an
 * assignment (no name, or a name not followed by `=` / `+=`) rewinds and returns null. Note that
 * `name==` is rejected, because `==` is a comparison operator rather than an assignment.
 */
function parseVariableAssignment(p) {
  const saved = mark(p.scan);
  skipBlanks(p.scan);
  const nameStart = p.scan.byte;
  if (!isNameStart(peek(p.scan))) {
    reset(p.scan, saved);
    return null;
  }
  while (isNameChar(peek(p.scan))) {
    advance(p.scan);
  }
  const nameEnd = p.scan.byte;
  let targetEnd = nameEnd;
  // `name[...]=`: walk the brackets by depth rather than parsing them. The contents are handled
  // later by subscriptIndexNode; here we only need to know where the closing bracket is.
  if (peek(p.scan) === "[") {
    advance(p.scan);
    let depth = 1;
    while (p.scan.pos < p.scan.len && depth > 0) {
      const ch = peek(p.scan);
      if (ch === "[") {
        depth++;
      } else if (ch === "]") {
        depth--;
      }
      advance(p.scan);
    }
    targetEnd = p.scan.byte;
  }

  const opChar = peek(p.scan);
  const nextChar = peek(p.scan, 1);
  let operator;
  if (opChar === "=" && nextChar !== "=") {
    operator = "=";
  } else if (opChar === "+" && nextChar === "=") {
    operator = "+=";
  } else {
    reset(p.scan, saved);
    return null;
  }

  const nameNode = node(p, "variable_name", nameStart, nameEnd, []);
  let target = nameNode;
  if (targetEnd > nameEnd) {
    const openBracket = node(p, "[", nameEnd, nameEnd + 1, []);
    const indexNode = subscriptIndexNode(p, nameEnd + 1, targetEnd - 1);
    const closeBracket = node(p, "]", targetEnd - 1, targetEnd, []);
    target = node(p, "subscript", nameStart, targetEnd, [
      nameNode,
      openBracket,
      indexNode,
      closeBracket,
    ]);
  }

  const opStart = p.scan.byte;
  advance(p.scan);
  if (operator === "+=") {
    advance(p.scan);
  }
  const opEnd = p.scan.byte;
  const operatorNode = node(p, operator, opStart, opEnd, []);

  let value = null;
  if (peek(p.scan) === "(") {
    // Array literal: `name=(a b c)`.
    const openToken = nextToken(p.scan, "cmd");
    const openParen = tokenNode(p, "(", openToken);
    const elements = [openParen];
    while (true) {
      skipBlanks(p.scan);
      if (peek(p.scan) === ")") {
        break;
      }
      const element = parseWord(p, "arg");
      if (!element) {
        break;
      }
      elements.push(element);
    }
    const closeToken = nextToken(p.scan, "cmd");
    const closeParen =
      closeToken.value === ")"
        ? tokenNode(p, ")", closeToken)
        : node(p, ")", openParen.endIndex, openParen.endIndex, []);
    elements.push(closeParen);
    value = node(
      p,
      "array",
      openParen.startIndex,
      closeParen.endIndex,
      elements,
    );
  } else {
    // A scalar value, but only if something other than a word terminator follows the operator.
    // `name=` with nothing after it is a legal assignment to the empty string, and gets no value
    // child at all.
    const ch = peek(p.scan);
    if (
      ch &&
      ch !== " " &&
      ch !== "\t" &&
      ch !== "\n" &&
      ch !== ";" &&
      ch !== "&" &&
      ch !== "|" &&
      ch !== ")" &&
      ch !== "}"
    ) {
      value = parseWord(p, "arg");
    }
  }

  const children = value
    ? [target, operatorNode, value]
    : [target, operatorNode];
  const endByte = value ? value.endIndex : opEnd;
  return node(p, "variable_assignment", nameStart, endByte, children);
}

/**
 * Parse what sits between the brackets of an array subscript, `a[HERE]`. Upstream `je`.
 *
 * Three cases: the whole-array selectors `@` and `*`, an arithmetic expression in `(( ))` form,
 * and otherwise a plain arithmetic expression running up to the `]`.
 */
function parseSubscriptContent(p) {
  skipBlanks(p.scan);
  const ch = peek(p.scan);
  if ((ch === "@" || ch === "*") && peek(p.scan, 1) === "]") {
    const start = p.scan.byte;
    advance(p.scan);
    return node(p, "word", start, p.scan.byte, []);
  }
  if (ch === "(" && peek(p.scan, 1) === "(") {
    const start = p.scan.byte;
    advance(p.scan);
    advance(p.scan);
    const openNode = node(p, "((", start, p.scan.byte, []);
    const expression = parseArithmetic(p, "))", "var");
    skipBlanks(p.scan);
    let closeNode;
    if (peek(p.scan) === ")" && peek(p.scan, 1) === ")") {
      const closeStart = p.scan.byte;
      advance(p.scan);
      advance(p.scan);
      closeNode = node(p, "))", closeStart, p.scan.byte, []);
    } else {
      // Unterminated: a zero-width `))` keeps the node shape uniform.
      closeNode = node(p, "))", p.scan.byte, p.scan.byte, []);
    }
    const children = expression
      ? [openNode, expression, closeNode]
      : [openNode, closeNode];
    return node(
      p,
      "compound_statement",
      openNode.startIndex,
      closeNode.endIndex,
      children,
    );
  }
  return parseArithmetic(p, "]", "word");
}

/**
 * Build the node for the already-delimited text of a subscript, given its byte range.
 * Upstream `He`.
 *
 * The text is classified rather than parsed: a run of digits is a number, `$name` and `$?`-style
 * one-character specials become simple_expansion nodes, and anything else is left as a word.
 */
function subscriptIndexNode(p, startByte, endByte) {
  const text = sliceBytes(p, startByte, endByte);
  if (/^\d+$/.test(text)) {
    return node(p, "number", startByte, endByte, []);
  }
  if (/^\$([a-zA-Z_]\w*)$/.exec(text)) {
    const dollarNode = node(p, "$", startByte, startByte + 1, []);
    const nameNode = node(p, "variable_name", startByte + 1, endByte, []);
    return node(p, "simple_expansion", startByte, endByte, [
      dollarNode,
      nameNode,
    ]);
  }
  if (
    text.length === 2 &&
    text[0] === "$" &&
    SPECIAL_VARIABLE_NAMES.has(text[1])
  ) {
    const dollarNode = node(p, "$", startByte, startByte + 1, []);
    const nameNode = node(
      p,
      "special_variable_name",
      startByte + 1,
      endByte,
      [],
    );
    return node(p, "simple_expansion", startByte, endByte, [
      dollarNode,
      nameNode,
    ]);
  }
  return node(p, "word", startByte, endByte, []);
}

/**
 * Pure lookahead: could a redirection take whatever is at the cursor as its target word?
 * Upstream `xe`. Consumes nothing.
 *
 * False for end of input, a newline, and the operators that end a word. `<` and `>` only qualify
 * when they open a process substitution `<(`/`>(`. A run of digits followed by `<` or `>` is a
 * file descriptor belonging to the NEXT redirection, not a target for this one.
 */
function redirectTargetAhead(p) {
  const ch = peek(p.scan);
  if (ch === "" || ch === "\n") {
    return false;
  }
  if (ch === "|" || ch === "&" || ch === ";" || ch === "(" || ch === ")") {
    return false;
  }
  if (ch === "<" || ch === ">") {
    return peek(p.scan, 1) === "(";
  }
  if (isDigit(ch)) {
    let idx = p.scan.pos;
    while (idx < p.scan.len && isDigit(p.scan.src[idx])) {
      idx++;
    }
    const after = idx < p.scan.len ? p.scan.src[idx] : "";
    if (after === ">" || after === "<") {
      return false;
    }
  }
  if (ch === "}") {
    return false;
  }
  if (p.stopToken === "]" && ch === "]") {
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. REDIRECTIONS AND HEREDOCS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse one redirection, upstream `j`.
 *
 * A redirection has three parts and they are recognised strictly in order: an
 * optional file descriptor, the operator, then whatever that operator wants
 * after it. Both descriptor forms below look ahead WITHOUT consuming until they
 * have seen a `<` or `>`, because a leading digit run or `{name}` is only a
 * descriptor when a redirection operator follows it; otherwise it is an ordinary
 * word belonging to the command.
 *
 * `allowMultipleTargets` (upstream `L`) is honoured only by the plain
 * file-redirect arm at the bottom, which will otherwise stop after one target.
 *
 * Returns null when what follows is not a redirection, having first rewound the
 * scanner to exactly where it was on entry.
 */
function parseRedirect(p, allowMultipleTargets = false) {
  const saved = mark(p.scan);
  skipBlanks(p.scan);
  let fdNode = null;
  // Descriptor form one: a run of digits pressed against `<` or `>`, as in `2>`.
  if (isDigit(peek(p.scan))) {
    const fdStartByte = p.scan.byte;
    let probe = p.scan.pos;
    while (probe < p.scan.len && isDigit(p.scan.src[probe])) {
      probe++;
    }
    const after = probe < p.scan.len ? p.scan.src[probe] : "";
    if (after === ">" || after === "<") {
      while (p.scan.pos < probe) {
        advance(p.scan);
      }
      fdNode = node(p, "file_descriptor", fdStartByte, p.scan.byte, []);
    }
  }
  // Descriptor form two: `{name}` or `{name[subscript]}`, bash's "allocate a
  // free descriptor and store its number in this variable" syntax, as in
  // `{fd}>file`.
  if (fdNode === null && peek(p.scan) === "{") {
    let probe = p.scan.pos + 1;
    if (probe < p.scan.len && /[A-Za-z_]/.test(p.scan.src[probe])) {
      while (probe < p.scan.len && /[A-Za-z0-9_]/.test(p.scan.src[probe])) {
        probe++;
      }
      if (p.scan.src[probe] === "[") {
        // Walk to the `]` that matches this `[`. Quote state has to be tracked
        // because a `]` inside quotes does not close the subscript.
        let depth = 0;
        let inSingle = false;
        let inDouble = false;
        while (probe < p.scan.len) {
          const ch = p.scan.src[probe];
          if (inSingle) {
            if (ch === "'") inSingle = false;
          } else if (inDouble) {
            if (ch === "\\" && probe + 1 < p.scan.len) probe++;
            else if (ch === '"') inDouble = false;
          } else if (ch === "\\" && probe + 1 < p.scan.len) probe++;
          else if (ch === "'") inSingle = true;
          else if (ch === '"') inDouble = true;
          else if (ch === "[") depth++;
          else if (ch === "]") {
            depth--;
            if (depth === 0) {
              probe++;
              break;
            }
          } else if (ch === "\\" && p.scan.src[probe + 1] === "\n") {
            // Unreachable in practice: the bare-backslash arm above already
            // claims every backslash that has any character after it. Preserved
            // as upstream wrote it.
            probe += 2;
            continue;
          } else if (ch === "\n") {
            break;
          }
          probe++;
        }
      }
      if (p.scan.src[probe] === "}") {
        const afterBrace = probe + 1 < p.scan.len ? p.scan.src[probe + 1] : "";
        if (afterBrace === ">" || afterBrace === "<") {
          const nameStartByte = p.scan.byte;
          while (p.scan.pos <= probe) {
            advance(p.scan);
          }
          fdNode = node(p, "variable_name", nameStartByte, p.scan.byte, []);
        }
      }
    }
  }
  const tok = nextToken(p.scan, "arg");
  if (tok.type !== "OP") {
    reset(p.scan, saved);
    return null;
  }
  const op = tok.value;
  // `<<< word` — a here-string. The word IS the input, so unlike a heredoc there
  // is nothing pending and nothing to collect at the next newline.
  if (op === "<<<") {
    const opNode = tokenNode(p, "<<<", tok);
    skipBlanks(p.scan);
    const word = parseWord(p, "arg");
    const endByte = word ? word.endIndex : opNode.endIndex;
    const parts = word ? [opNode, word] : [opNode];
    return node(
      p,
      "herestring_redirect",
      fdNode ? fdNode.startIndex : opNode.startIndex,
      endByte,
      fdNode ? [fdNode, ...parts] : parts,
    );
  }
  // `<< DELIM` and `<<- DELIM`. Only the delimiter is read here. A heredoc BODY
  // does not begin until after the next newline, so this arm records a pending
  // heredoc on the scanner and leaves the body offsets at zero for
  // `collectHeredocBodies` to fill in when the statement parser reaches that
  // newline. `<<-` additionally means leading tabs are stripped from body lines
  // and from the terminator line.
  if (op === "<<" || op === "<<-") {
    const opNode = tokenNode(p, op, tok);
    skipHeredocBlanks(p.scan);
    const delimStartByte = p.scan.byte;
    let quoted = false;
    let delim = "";
    const first = peek(p.scan);
    if (first === "'" || first === '"') {
      // Quoted delimiter: take everything up to the closing quote and drop the
      // quotes themselves. Quoting the delimiter is also what tells the shell
      // not to expand the body, which is what `quoted` records.
      quoted = true;
      advance(p.scan);
      while (p.scan.pos < p.scan.len && peek(p.scan) !== first) {
        delim += peek(p.scan);
        advance(p.scan);
      }
      if (p.scan.pos < p.scan.len) advance(p.scan);
    } else if (first === "\\") {
      // `\DELIM`: the backslash quotes only the character right after it, but
      // the rest of the name still belongs to the delimiter. Escaping any part
      // of it suppresses expansion of the body, same as quoting.
      quoted = true;
      advance(p.scan);
      if (p.scan.pos < p.scan.len && peek(p.scan) !== "\n") {
        delim += peek(p.scan);
        advance(p.scan);
      }
      while (p.scan.pos < p.scan.len && isNameChar(peek(p.scan))) {
        delim += peek(p.scan);
        advance(p.scan);
      }
    } else {
      // Bare delimiter: run to the first blank, newline, `<` or backslash.
      while (p.scan.pos < p.scan.len && isHeredocDelimiterChar(peek(p.scan))) {
        delim += peek(p.scan);
        advance(p.scan);
      }
    }
    const delimEndByte = p.scan.byte;
    /*
     * Three delimiter shapes this parser refuses to guess about. Each sets
     * `p.aborted` before throwing: the throw unwinds all the way to
     * `parseProgram`'s catch, and the flag is how that catch distinguishes "we
     * gave up deliberately on input we cannot represent" from "something else
     * went wrong in here".
     *
     * Refusal one: a double-quoted delimiter holding a backtick, `$`,
     * backslash or newline. The quotes make those literal in real bash, but the
     * delimiter text collected above has already lost the quoting, so matching
     * it against body lines later would be guesswork.
     */
    if (first === '"' && /[`$\\\n]/.test(delim)) {
      p.aborted = true;
      throw Error("heredoc delimiter contains substitution/escape chars");
    }
    /*
     * Refusal two: the delimiter scan stopped on a character that is neither
     * whitespace nor one of the operators that can legitimately follow a
     * delimiter. That means the delimiter word really continues past what was
     * scanned, so the recorded delimiter would be a prefix of the true one.
     */
    if (p.scan.pos < p.scan.len) {
      const ch = peek(p.scan);
      if (
        ch !== " " &&
        ch !== "\t" &&
        ch !== "\n" &&
        ch !== "<" &&
        ch !== ">" &&
        ch !== "|" &&
        ch !== "&" &&
        ch !== ";" &&
        ch !== "(" &&
        ch !== ")"
      ) {
        p.aborted = true;
        throw Error("heredoc delimiter word continues past scanned segment");
      }
    }
    /*
     * Refusal three: a surrogate code unit in the delimiter. The loops above
     * append ONE UTF-16 code unit per step while `advance` moves a whole code
     * point, so an astral character leaves only its high surrogate in `delim`.
     * Both the later `startsWith` match and the character-count walk over the
     * terminator would then be wrong.
     */
    if (/[\uD800-\uDFFF]/.test(delim)) {
      p.aborted = true;
      throw Error("heredoc delimiter contains astral/surrogate code unit");
    }
    const startNode = node(p, "heredoc_start", delimStartByte, delimEndByte, []);
    p.scan.heredocs.push({
      delim: delim,
      stripTabs: op === "<<-",
      quoted: quoted,
      bodyStart: 0,
      bodyEnd: 0,
      endStart: 0,
      endEnd: 0,
    });
    const children = fdNode
      ? [fdNode, opNode, startNode]
      : [opNode, startNode];
    const startByte = fdNode ? fdNode.startIndex : opNode.startIndex;
    /*
     * Everything left on THIS line still belongs to the command that owns the
     * heredoc — `cat <<EOF > out | wc -l` is legal — because the body only
     * starts at the newline. The ordinary statement parser cannot be handed the
     * remainder, so this loop consumes it here and hangs each piece off the
     * heredoc_redirect node: further redirections, a pipeline, an `&&`/`||`
     * continuation, plain words, or an ERROR span covering text that makes no
     * sense in this position.
     */
    while (true) {
      skipBlanks(p.scan);
      const ch = peek(p.scan);
      if (ch === "\n" || ch === "" || p.scan.pos >= p.scan.len) break;
      if (ch === ">" || ch === "<" || isDigit(ch)) {
        const beforeRedirect = mark(p.scan);
        const nested = parseRedirect(p);
        if (nested && nested.type === "file_redirect") {
          children.push(nested);
          continue;
        }
        // Not a redirection after all (or a nested heredoc, which this loop does
        // not take). Rewind and fall through to the tests below, which re-examine
        // the same character.
        reset(p.scan, beforeRedirect);
      }
      if (ch === "|" && peek(p.scan, 1) !== "|") {
        const pipeStartByte = p.scan.byte;
        advance(p.scan);
        skipBlanks(p.scan);
        const units = [];
        while (true) {
          const unit = parseCommandUnit(p);
          if (!unit) break;
          units.push(unit);
          skipBlanks(p.scan);
          if (peek(p.scan) === "|" && peek(p.scan, 1) !== "|") {
            const barStartByte = p.scan.byte;
            advance(p.scan);
            units.push(node(p, "|", barStartByte, p.scan.byte, []));
            skipBlanks(p.scan);
            continue;
          }
          break;
        }
        if (units.length > 0) {
          const last = units.at(-1);
          children.push(
            node(p, "pipeline", units[0].startIndex, last.endIndex, units),
          );
        } else {
          children.push(node(p, "ERROR", pipeStartByte, p.scan.byte, []));
        }
        continue;
      }
      if (
        (ch === "&" && peek(p.scan, 1) === "&") ||
        (ch === "|" && peek(p.scan, 1) === "|")
      ) {
        const opStartByte = p.scan.byte;
        advance(p.scan);
        advance(p.scan);
        skipBlanks(p.scan);
        const rhs = parseCommandUnit(p);
        if (rhs) children.push(rhs);
        else children.push(node(p, "ERROR", opStartByte, p.scan.byte, []));
        continue;
      }
      // A background `&`, a separator `;`, or a paren: all of these would end
      // the command, which cannot be represented from inside the redirection.
      // Swallow the rest of the line as one error span.
      if (ch === "&" || ch === ";" || ch === "(" || ch === ")") {
        const errStartByte = p.scan.byte;
        while (p.scan.pos < p.scan.len && peek(p.scan) !== "\n") {
          advance(p.scan);
        }
        children.push(node(p, "ERROR", errStartByte, p.scan.byte, []));
        break;
      }
      const word = parseWord(p, "arg");
      if (word) {
        children.push(word);
        continue;
      }
      // Nothing recognised and no progress possible: take the rest of the line
      // as an error span, if there is any of it left.
      const tailStartByte = p.scan.byte;
      while (p.scan.pos < p.scan.len && peek(p.scan) !== "\n") {
        advance(p.scan);
      }
      if (p.scan.byte > tailStartByte) {
        children.push(node(p, "ERROR", tailStartByte, p.scan.byte, []));
      }
      break;
    }
    return node(p, "heredoc_redirect", startByte, p.scan.byte, children);
  }
  // `<&-` / `>&-` close a descriptor and in bash take no target. A target is
  // still accepted if one is genuinely ahead, and the scanner is rewound when it
  // turns out not to be.
  if (op === "<&-" || op === ">&-") {
    const opNode = tokenNode(p, op, tok);
    const children = [];
    if (fdNode) children.push(fdNode);
    children.push(opNode);
    skipBlanks(p.scan);
    const beforeTarget = mark(p.scan);
    const target = redirectTargetAhead(p) ? parseWord(p, "arg") : null;
    if (target) children.push(target);
    else reset(p.scan, beforeTarget);
    const startByte = fdNode ? fdNode.startIndex : opNode.startIndex;
    const endByte = target ? target.endIndex : opNode.endIndex;
    return node(p, "file_redirect", startByte, endByte, children);
  }
  // The ordinary file redirections. Each takes a target, which may itself be a
  // process substitution (`> >(tee log)`).
  if (
    op === ">" ||
    op === ">>" ||
    op === ">&" ||
    op === ">|" ||
    op === "&>" ||
    op === "&>>" ||
    op === "<" ||
    op === "<&"
  ) {
    const opNode = tokenNode(p, op, tok);
    const children = [];
    if (fdNode) children.push(fdNode);
    children.push(opNode);
    let endByte = opNode.endIndex;
    let targetCount = 0;
    while (true) {
      skipBlanks(p.scan);
      if (!redirectTargetAhead(p)) break;
      if (!allowMultipleTargets && targetCount >= 1) break;
      const ch = peek(p.scan);
      const next = peek(p.scan, 1);
      let target = null;
      if ((ch === "<" || ch === ">") && next === "(") {
        target = parseProcessSubstitution(p);
      } else {
        target = parseWord(p, "arg");
      }
      if (!target) break;
      children.push(target);
      endByte = target.endIndex;
      targetCount++;
    }
    const startByte = fdNode ? fdNode.startIndex : opNode.startIndex;
    return node(p, "file_redirect", startByte, endByte, children);
  }
  // An operator, but not one that redirects. Give the scanner back untouched.
  reset(p.scan, saved);
  return null;
}

/**
 * Parse `<(list)` or `>(list)`, upstream `se`.
 *
 * A process substitution runs the command list in a subshell and substitutes the
 * name of a pipe, so the body is a full statement list parsed with `)` as its
 * stop token. Returns null when the two-character opener is not present, without
 * consuming anything.
 *
 * When the closing `)` is missing, a zero-width `)` node is still emitted at the
 * current position so the node always has its three-part shape.
 */
function parseProcessSubstitution(p) {
  const direction = peek(p.scan);
  if ((direction !== "<" && direction !== ">") || peek(p.scan, 1) !== "(") {
    return null;
  }
  const startByte = p.scan.byte;
  advance(p.scan);
  advance(p.scan);
  const openNode = node(p, direction + "(", startByte, p.scan.byte, []);
  const body = parseStatements(p, ")");
  skipBlanks(p.scan);
  let closeNode;
  if (peek(p.scan) === ")") {
    const closeStartByte = p.scan.byte;
    advance(p.scan);
    closeNode = node(p, ")", closeStartByte, p.scan.byte, []);
  } else {
    closeNode = node(p, ")", p.scan.byte, p.scan.byte, []);
  }
  return node(p, "process_substitution", startByte, closeNode.endIndex, [
    openNode,
    ...body,
    closeNode,
  ]);
}

/**
 * Fill in the bodies of the heredocs pending on the scanner, upstream `le`.
 *
 * This is what runs at the newline that `parseRedirect` stopped short of. It
 * first consumes the remainder of the current line and the newline itself, then
 * for each pending record walks forward line by line until it finds one whose
 * content equals the delimiter, writing the four offset fields
 * (`bodyStart`, `bodyEnd`, `endStart`, `endEnd`) into the record IN PLACE. The
 * caller holds the same object, which is how the offsets get back to the node
 * that needs them.
 *
 * Note that finding a terminator RETURNS from the whole function rather than
 * continuing to the next pending record: a second heredoc on the same line is
 * only reached on a later call. The loop over `heredocs` therefore only ever
 * advances past a record whose terminator was never found, i.e. at end of input,
 * where the body is closed off empty at the current position.
 *
 * Both `throw`s here are ambiguity refusals of the same kind as the delimiter
 * refusals in `parseRedirect`: `p.aborted` is set first so `parseProgram`'s catch
 * can tell a deliberate give-up from an unexpected failure.
 */
function collectHeredocBodies(p) {
  while (p.scan.pos < p.scan.len && p.scan.src[p.scan.pos] !== "\n") {
    advance(p.scan);
  }
  if (p.scan.pos < p.scan.len) advance(p.scan);
  for (const record of p.scan.heredocs) {
    record.bodyStart = p.scan.byte;
    const delimLength = record.delim.length;
    // `<<-` strips leading tabs from every line before comparing, so a delimiter
    // that itself starts with a tab could never be matched as written — there is
    // no way to tell which tabs were stripped and which were part of the name.
    if (record.stripTabs && record.delim.startsWith("\t")) {
      p.aborted = true;
      throw Error("ambiguous heredoc terminator (<<- tab-prefixed delim)");
    }
    while (p.scan.pos < p.scan.len) {
      const lineStartIndex = p.scan.pos;
      const lineStartByte = p.scan.byte;
      let probe = lineStartIndex;
      if (record.stripTabs) {
        while (probe < p.scan.len && p.scan.src[probe] === "\t") {
          probe++;
        }
      }
      if (p.scan.src.startsWith(record.delim, probe)) {
        const afterDelim = probe + delimLength;
        const following =
          afterDelim < p.scan.len ? p.scan.src[afterDelim] : "";
        // The delimiter only terminates when it is the whole line.
        if (following === "" || following === "\n" || following === "\r") {
          record.bodyEnd = lineStartByte;
          while (p.scan.pos < probe) {
            advance(p.scan);
          }
          record.endStart = p.scan.byte;
          // One `advance` per UTF-16 unit of the delimiter. That is only correct
          // because the delimiter was proven surrogate-free when it was scanned.
          for (let k = 0; k < delimLength; k++) {
            advance(p.scan);
          }
          record.endEnd = p.scan.byte;
          if (p.scan.pos < p.scan.len && p.scan.src[p.scan.pos] === "\n") {
            advance(p.scan);
          }
          return;
        }
        // The line starts with the delimiter but carries trailing text. If that
        // text contains a closer of an enclosing construct — `)`, a backtick, or
        // `}` — then whether the heredoc ends here or the construct does is not
        // decidable from this side, so refuse rather than guess.
        let scanIdx = afterDelim;
        while (scanIdx < p.scan.len) {
          const ch = p.scan.src[scanIdx];
          if (ch === "\n") break;
          if (ch === ")" || ch === "`" || ch === "}") {
            p.aborted = true;
            throw Error("ambiguous heredoc terminator (shell_eof_token)");
          }
          scanIdx++;
        }
      }
      // Not the terminator: skip this whole line and try the next one.
      while (p.scan.pos < p.scan.len && p.scan.src[p.scan.pos] !== "\n") {
        advance(p.scan);
      }
      if (p.scan.pos < p.scan.len) advance(p.scan);
    }
    // Input ran out with no terminator: the body ends where the input does and
    // the terminator is recorded as an empty span there.
    record.bodyEnd = p.scan.byte;
    record.endStart = p.scan.byte;
    record.endEnd = p.scan.byte;
  }
}

/**
 * Re-scan a finished heredoc body for expansions, upstream `Qe`.
 *
 * By the time this runs the body has already been walked past, so it works on a
 * SAVE / SEEK / RESTORE contract: mark the current scanner position, jump the
 * scanner back to the body's byte offset with `seekToByte`, scan forward to
 * `bodyEndByte` reusing the ordinary `$`/backtick machinery, then restore the
 * saved position so the caller's parse continues exactly where it left off. The
 * whole function is therefore invisible to the scanner from outside. It is only
 * called for unquoted heredocs, since a quoted delimiter means no expansion.
 *
 * The returned children alternate expansion and literal `heredoc_content` spans.
 * Literal text BEFORE the first expansion is deliberately not emitted: the gap
 * span is only pushed once `sawExpansion` is set, so a body with no expansions
 * at all yields an empty list.
 */
function parseHeredocBody(p, bodyStartByte, bodyEndByte) {
  const saved = mark(p.scan);
  seekToByte(p, bodyStartByte);
  const parts = [];
  let literalStart = p.scan.byte;
  let sawExpansion = false;
  while (p.scan.byte < bodyEndByte) {
    const ch = peek(p.scan);
    if (ch === "\\") {
      const next = peek(p.scan, 1);
      // Inside an unquoted heredoc only `$`, a backtick and a backslash can be
      // backslash-escaped; every other backslash is an ordinary character.
      if (next === "$" || next === "`" || next === "\\") {
        advance(p.scan);
        advance(p.scan);
        continue;
      }
      advance(p.scan);
      continue;
    }
    if (ch === "$" || ch === "`") {
      // `$'...'` is ANSI-C quoting, not an expansion; step over the `$` only.
      if (ch === "$" && peek(p.scan, 1) === "'") {
        advance(p.scan);
        continue;
      }
      const expansionStartByte = p.scan.byte;
      const expansion = parseDollar(p);
      if (
        expansion &&
        (expansion.type === "simple_expansion" ||
          expansion.type === "expansion" ||
          expansion.type === "command_substitution" ||
          expansion.type === "arithmetic_expansion")
      ) {
        if (sawExpansion && expansionStartByte > literalStart) {
          parts.push(
            node(p, "heredoc_content", literalStart, expansionStartByte, []),
          );
        }
        parts.push(expansion);
        literalStart = p.scan.byte;
        sawExpansion = true;
      }
      continue;
    }
    advance(p.scan);
  }
  if (sawExpansion) {
    parts.push(node(p, "heredoc_content", literalStart, bodyEndByte, []));
  }
  reset(p.scan, saved);
  return parts;
}

/**
 * Move the scanner to a byte offset, upstream `Xe`.
 *
 * Everything the parser records is a UTF-8 byte offset, but the scanner walks
 * UTF-16 code units, so jumping to a remembered byte offset means recovering the
 * matching character index. `byteTable` maps character index to byte offset and
 * is monotonically increasing, so a binary search for the first entry not less
 * than the target gives that index. This is the seek half of the save/seek/
 * restore contract described on `parseHeredocBody`, and its only caller.
 */
function seekToByte(p, targetByte) {
  if (!p.scan.byteTable) byteOffsetOf(p.scan, 0);
  const table = p.scan.byteTable;
  let lo = 0;
  let hi = p.src.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (table[mid] < targetByte) lo = mid + 1;
    else hi = mid;
  }
  p.scan.pos = lo;
  p.scan.byte = targetByte;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. WORDS, STRINGS AND THE DOLLAR FORMS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse one shell WORD. Upstream `C`.
 *
 * A word in bash is not a single lexical token. `pre"$x"post` is three adjacent pieces glued
 * together with no separator between them, and the shell treats the result as one argument.
 * This is the loop that collects those pieces: bare runs of ordinary characters, single- and
 * double-quoted strings, `$`-expansions of every shape, backtick command substitutions,
 * `{a..z}` brace ranges, `{a,b}` brace groups, and `<(...)` / `>(...)` process substitutions.
 * It stops at the first character that cannot continue a word: a blank, a newline, or one of
 * the operator characters `| & ; ( )`.
 *
 * The return convention is load-bearing for every caller. A word built from exactly ONE piece
 * is returned as that piece, unwrapped; only two or more pieces are wrapped in a
 * `concatenation` node. So `"x"` alone yields a bare `string` node, while `a"x"` yields a
 * `concatenation` whose children are a `word` and a `string`. Returns null if nothing at all
 * was consumed.
 *
 * `mode` is passed by callers as "cmd" or "arg" but this function ignores it; the distinction
 * only matters to the tokeniser, which parseWord calls with an explicit mode of its own.
 */
function parseWord(p, mode) {
  skipBlanks(p.scan);
  const parts = [];
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (
      ch === " " ||
      ch === "\t" ||
      ch === "\n" ||
      ch === "\r" ||
      ch === "" ||
      ch === "|" ||
      ch === "&" ||
      ch === ";" ||
      ch === "(" ||
      ch === ")"
    ) {
      break;
    }
    // `<` and `>` normally end the word because they start a redirect, but `<(` and `>(`
    // are process substitution, which is part of the word.
    if (ch === "<" || ch === ">") {
      if (peek(p.scan, 1) === "(") {
        const processSubstitution = parseProcessSubstitution(p);
        if (processSubstitution) {
          parts.push(processSubstitution);
        }
        continue;
      }
      break;
    }
    if (ch === '"') {
      parts.push(parseDoubleQuoted(p));
      continue;
    }
    // Single quotes have no internal structure, so the tokeniser can swallow the whole
    // literal in one go and it becomes a single leaf node.
    if (ch === "'") {
      const token = nextToken(p.scan, "arg");
      parts.push(tokenNode(p, "raw_string", token));
      continue;
    }
    if (ch === "$") {
      const afterDollar = peek(p.scan, 1);
      if (afterDollar === "'") {
        const token = nextToken(p.scan, "arg");
        parts.push(tokenNode(p, "ansi_c_string", token));
        continue;
      }
      // `$"..."` is a locale-translated string. The `$` becomes its own leaf and the rest is
      // parsed as an ordinary double-quoted string, so the two are adjacent concatenated
      // pieces rather than one node. The token is built from the byte offset BEFORE the
      // advance, so it spans exactly the one `$` byte.
      if (afterDollar === '"') {
        const dollarToken = {
          type: "DOLLAR",
          value: "$",
          start: p.scan.byte,
          end: p.scan.byte + 1,
        };
        advance(p.scan);
        parts.push(tokenNode(p, "$", dollarToken));
        parts.push(parseDoubleQuoted(p));
        continue;
      }
      // `$` immediately before a backtick: emit the `$` alone and let the next turn of the
      // loop take the backtick through its own branch.
      if (afterDollar === "`") {
        const dollarToken = {
          type: "DOLLAR",
          value: "$",
          start: p.scan.byte,
          end: p.scan.byte + 1,
        };
        advance(p.scan);
        parts.push(tokenNode(p, "$", dollarToken));
        continue;
      }
      const expansion = parseDollar(p);
      if (expansion) {
        parts.push(expansion);
      }
      continue;
    }
    // Inside an enclosing backtick substitution a backtick closes it rather than opening a
    // nested one, so the word has to end here and let the outer parser see the closer.
    if (ch === "`") {
      if (p.inBacktick > 0) {
        break;
      }
      const backtick = parseBacktick(p);
      if (backtick) {
        parts.push(backtick);
      }
      continue;
    }
    if (ch === "{") {
      const braceRange = parseBraceRange(p);
      if (braceRange) {
        parts.push(braceRange);
        continue;
      }
      // Not a range. If the brace is immediately followed by something that could end a
      // command, this is the `{` of a brace group used as a compound statement (`{ cmd; }`)
      // and not part of a word, so emit it as a lone `word` leaf and stop treating it
      // structurally.
      const afterBrace = peek(p.scan, 1);
      if (
        afterBrace === ";" ||
        afterBrace === "|" ||
        afterBrace === "&" ||
        afterBrace === "\n" ||
        afterBrace === "" ||
        afterBrace === ")" ||
        afterBrace === " " ||
        afterBrace === "\t"
      ) {
        const braceStart = p.scan.byte;
        advance(p.scan);
        parts.push(node(p, "word", braceStart, p.scan.byte, []));
        continue;
      }
      const braceGroupWords = parseBraceGroupWords(p);
      if (braceGroupWords) {
        for (const braceGroupWord of braceGroupWords) {
          parts.push(braceGroupWord);
        }
        continue;
      }
      // Deliberate fall-through: if none of the three brace readings applied, control drops
      // into the checks below and ultimately into parseBareWord.
    }
    // A closing brace or a bracket that reached here is not structure, just a literal
    // character; each becomes its own one-character `word` leaf.
    if (ch === "}") {
      const braceStart = p.scan.byte;
      advance(p.scan);
      parts.push(node(p, "word", braceStart, p.scan.byte, []));
      continue;
    }
    if (ch === "[" || ch === "]") {
      const bracketStart = p.scan.byte;
      advance(p.scan);
      parts.push(node(p, "word", bracketStart, p.scan.byte, []));
      continue;
    }
    const bare = parseBareWord(p);
    if (!bare) {
      break;
    }
    // Bash writes integers in an explicit base as `base#digits`, for example `16#ff` or
    // `2#1010`. When the digits are supplied by an expansion the bare run stops at the `$`,
    // leaving a word that is exactly a base prefix (`16#`, `-16#`, `0x10#`) with an expansion
    // right behind it. Re-read the expansion and wrap prefix plus expansion in one `number`
    // node so the tree matches what a whole-literal `16#ff` would have produced. Note the
    // node spans from the prefix's start to the expansion's end but has only the expansion
    // as a child; the prefix text survives only in the node's own text.
    if (
      bare.type === "word" &&
      /^-?(0x)?[0-9]+#$/.test(bare.text) &&
      peek(p.scan) === "$" &&
      (peek(p.scan, 1) === "{" || peek(p.scan, 1) === "(")
    ) {
      const expansion = parseDollar(p);
      if (expansion) {
        parts.push(node(p, "number", bare.startIndex, expansion.endIndex, [expansion]));
        continue;
      }
    }
    parts.push(bare);
  }
  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  const first = parts[0];
  const last = parts.at(-1);
  return node(p, "concatenation", first.startIndex, last.endIndex, parts);
}

/**
 * Consume a run of ordinary, unquoted, unexpanded characters. Upstream `Ve`.
 *
 * This is the "plain text" piece of a word: everything up to the next character that has a
 * meaning of its own. A backslash escapes the following character and both are consumed as
 * part of the run, EXCEPT a backslash at end of input or a backslash-newline (line
 * continuation), either of which ends the run.
 *
 * The resulting leaf is typed `number` when the whole run is an optionally signed decimal
 * integer, and `word` otherwise.
 */
function parseBareWord(p) {
  const startByte = p.scan.byte;
  const startPos = p.scan.pos;
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (ch === "\\") {
      if (p.scan.pos + 1 >= p.scan.len) {
        break;
      }
      if (p.scan.src[p.scan.pos + 1] === "\n") {
        break;
      }
      advance(p.scan);
      advance(p.scan);
      continue;
    }
    if (
      ch === " " ||
      ch === "\t" ||
      ch === "\n" ||
      ch === "\r" ||
      ch === "" ||
      ch === "|" ||
      ch === "&" ||
      ch === ";" ||
      ch === "(" ||
      ch === ")" ||
      ch === "<" ||
      ch === ">" ||
      ch === '"' ||
      ch === "'" ||
      ch === "$" ||
      ch === "`" ||
      ch === "{" ||
      ch === "}" ||
      ch === "[" ||
      ch === "]"
    ) {
      break;
    }
    advance(p.scan);
  }
  // Nothing consumed: the caller must not loop forever on a character this function refuses.
  if (p.scan.byte === startByte) {
    return null;
  }
  const text = p.src.slice(startPos, p.scan.pos);
  const type = /^-?\d+$/.test(text) ? "number" : "word";
  return node(p, type, startByte, p.scan.byte, []);
}

/**
 * Parse a brace RANGE, `{a..z}` or `{1..10}`. Upstream `Ye`.
 *
 * Speculative: the scanner position is saved on entry and restored on every rejection, so a
 * failed attempt leaves the cursor exactly where it started and the caller can try a
 * different reading of the same `{`.
 *
 * Two rules decide whether the endpoints form a real range. Both must be numeric or both
 * non-numeric; a mixture like `{1..z}` is not a range. And if they are non-numeric they must
 * each be exactly one character, because bash only counts through single letters.
 *
 * The node keeps all five pieces as children — the open brace, the low bound, the `..`, the
 * high bound, the close brace — so the exact text can be reconstructed.
 */
function parseBraceRange(p) {
  const saved = mark(p.scan);
  if (peek(p.scan) !== "{") {
    return null;
  }
  const openStart = p.scan.byte;
  advance(p.scan);
  const openEnd = p.scan.byte;
  const lowStart = p.scan.byte;
  while (isDigit(peek(p.scan)) || isNameStart(peek(p.scan))) {
    advance(p.scan);
  }
  const lowEnd = p.scan.byte;
  if (lowEnd === lowStart || peek(p.scan) !== "." || peek(p.scan, 1) !== ".") {
    reset(p.scan, saved);
    return null;
  }
  const dotsStart = p.scan.byte;
  advance(p.scan);
  advance(p.scan);
  const dotsEnd = p.scan.byte;
  const highStart = p.scan.byte;
  while (isDigit(peek(p.scan)) || isNameStart(peek(p.scan))) {
    advance(p.scan);
  }
  const highEnd = p.scan.byte;
  if (highEnd === highStart || peek(p.scan) !== "}") {
    reset(p.scan, saved);
    return null;
  }
  const closeStart = p.scan.byte;
  advance(p.scan);
  const closeEnd = p.scan.byte;
  const lowText = sliceBytes(p, lowStart, lowEnd);
  const highText = sliceBytes(p, highStart, highEnd);
  const lowIsNumeric = /^\d+$/.test(lowText);
  const highIsNumeric = /^\d+$/.test(highText);
  if (lowIsNumeric !== highIsNumeric) {
    reset(p.scan, saved);
    return null;
  }
  if (!lowIsNumeric && (lowText.length !== 1 || highText.length !== 1)) {
    reset(p.scan, saved);
    return null;
  }
  const lowType = lowIsNumeric ? "number" : "word";
  const highType = highIsNumeric ? "number" : "word";
  return node(p, "brace_expression", openStart, closeEnd, [
    node(p, "{", openStart, openEnd, []),
    node(p, lowType, lowStart, lowEnd, []),
    node(p, "..", dotsStart, dotsEnd, []),
    node(p, highType, highStart, highEnd, []),
    node(p, "}", closeStart, closeEnd, []),
  ]);
}

/**
 * Split a brace group such as `{a,b}` into flat leaves. Upstream `Ze`.
 *
 * Returns an ARRAY of nodes, not a single node, because the caller splices them straight into
 * the word's list of pieces; there is no wrapper node for a brace group.
 *
 * The split is coarse on purpose. The braces themselves and any `[` or `]` become their own
 * one-character `word` leaves, and everything between two such characters becomes one leaf.
 * Commas are NOT separators here, so `{a,b}` yields three leaves: `{`, `a,b`, `}`. A
 * backslash inside a run escapes the next character, so an escaped delimiter stays in the run.
 *
 * The inner run loop ends the whole scan if it consumed nothing, which happens when the run
 * begins on a character the loop refuses. Returns null only when the cursor is not on a `{`.
 */
function parseBraceGroupWords(p) {
  if (peek(p.scan) !== "{") {
    return null;
  }
  const openStart = p.scan.byte;
  advance(p.scan);
  const openEnd = p.scan.byte;
  const words = [node(p, "word", openStart, openEnd, [])];
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (
      ch === "}" ||
      ch === "\n" ||
      ch === ";" ||
      ch === "|" ||
      ch === "&" ||
      ch === " " ||
      ch === "\t" ||
      ch === "<" ||
      ch === ">" ||
      ch === "(" ||
      ch === ")"
    ) {
      break;
    }
    if (ch === "[" || ch === "]") {
      const bracketStart = p.scan.byte;
      advance(p.scan);
      words.push(node(p, "word", bracketStart, p.scan.byte, []));
      continue;
    }
    const runStart = p.scan.byte;
    while (p.scan.pos < p.scan.len) {
      const runCh = peek(p.scan);
      if (runCh === "\\" && p.scan.pos + 1 < p.scan.len) {
        advance(p.scan);
        advance(p.scan);
        continue;
      }
      if (
        runCh === "}" ||
        runCh === "\n" ||
        runCh === ";" ||
        runCh === "|" ||
        runCh === "&" ||
        runCh === " " ||
        runCh === "\t" ||
        runCh === "<" ||
        runCh === ">" ||
        runCh === "(" ||
        runCh === ")" ||
        runCh === "[" ||
        runCh === "]"
      ) {
        break;
      }
      advance(p.scan);
    }
    const runEnd = p.scan.byte;
    if (runEnd > runStart) {
      const runText = sliceBytes(p, runStart, runEnd);
      const runType = /^-?\d+$/.test(runText) ? "number" : "word";
      words.push(node(p, runType, runStart, runEnd, []));
    } else {
      break;
    }
  }
  if (peek(p.scan) === "}") {
    const closeStart = p.scan.byte;
    advance(p.scan);
    words.push(node(p, "word", closeStart, p.scan.byte, []));
  }
  return words;
}

/**
 * Parse a double-quoted string. Upstream `z`.
 *
 * Inside double quotes most characters are literal, but expansions, backtick command
 * substitutions and newlines still have structure. The result is a `string` node whose
 * children alternate between `string_content` leaves (the literal runs) and the structured
 * pieces, bracketed by two `"` leaves.
 *
 * `inDquote` is a DEPTH, not a flag, because a `$(...)` inside the quotes can contain another
 * quoted string; it is incremented here and decremented on the way out. Other code reads it
 * to decide whether a construct is being seen inside quotes.
 *
 * The literal run is tracked as a pair of cursors — a byte offset for node positions and a
 * character index for slicing the source — and `flush` turns whatever has accumulated into a
 * `string_content` node at each interruption. `flush` deliberately DROPS a run that is
 * nothing but spaces and tabs, so `"$a  $b"` produces two expansions with no content node
 * between them.
 *
 * If input runs out before the closing quote, a zero-width `"` node is synthesised at the
 * current position so the node shape is the same either way.
 */
function parseDoubleQuoted(p) {
  const openStart = p.scan.byte;
  advance(p.scan);
  p.inDquote++;
  const openEnd = p.scan.byte;
  const children = [node(p, '"', openStart, openEnd, [])];
  let literalStartByte = p.scan.byte;
  let literalStartPos = p.scan.pos;
  const flush = () => {
    if (p.scan.byte > literalStartByte) {
      const text = p.src.slice(literalStartPos, p.scan.pos);
      if (!/^[ \t]+$/.test(text)) {
        children.push(node(p, "string_content", literalStartByte, p.scan.byte, []));
      }
    }
  };
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (ch === '"') {
      break;
    }
    // An escape stays inside the literal run; both characters are consumed without
    // interrupting it.
    if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
      advance(p.scan);
      advance(p.scan);
      continue;
    }
    // A newline is literal too, but it ends the run so each line becomes its own
    // `string_content` node.
    if (ch === "\n") {
      flush();
      advance(p.scan);
      literalStartByte = p.scan.byte;
      literalStartPos = p.scan.pos;
      continue;
    }
    if (ch === "$") {
      const afterDollar = peek(p.scan, 1);
      // Only these follow-on characters make the `$` an expansion inside quotes.
      if (
        afterDollar === "(" ||
        afterDollar === "{" ||
        isNameStart(afterDollar) ||
        SPECIAL_VARIABLE_NAMES.has(afterDollar) ||
        isDigit(afterDollar)
      ) {
        flush();
        const expansion = parseDollar(p);
        if (expansion) {
          children.push(expansion);
        }
        literalStartByte = p.scan.byte;
        literalStartPos = p.scan.pos;
        continue;
      }
      // A `$` that expands nothing is still emitted as its own `$` leaf rather than being
      // folded into the literal run — unless it is the last character before the closing
      // quote or before end of input, in which case control falls through to the plain
      // advance at the bottom of the loop and it stays literal.
      if (afterDollar !== '"' && afterDollar !== "") {
        flush();
        const dollarStart = p.scan.byte;
        advance(p.scan);
        children.push(node(p, "$", dollarStart, p.scan.byte, []));
        literalStartByte = p.scan.byte;
        literalStartPos = p.scan.pos;
        continue;
      }
    }
    if (ch === "`") {
      flush();
      const backtick = parseBacktick(p);
      if (backtick) {
        children.push(backtick);
      }
      literalStartByte = p.scan.byte;
      literalStartPos = p.scan.pos;
      continue;
    }
    advance(p.scan);
  }
  flush();
  let closeNode;
  if (peek(p.scan) === '"') {
    const closeStart = p.scan.byte;
    advance(p.scan);
    closeNode = node(p, '"', closeStart, p.scan.byte, []);
  } else {
    closeNode = node(p, '"', p.scan.byte, p.scan.byte, []);
  }
  children.push(closeNode);
  p.inDquote--;
  return node(p, "string", openStart, closeNode.endIndex, children);
}

/**
 * Parse every `$…` form. Upstream `K`.
 *
 * The cursor is on the `$`; the character AFTER it selects the arm:
 *
 *   `$((`  arithmetic expansion
 *   `$[`   the old, deprecated arithmetic form
 *   `$(`   command substitution
 *   `${`   parameter expansion with operators
 *   else   a simple expansion — `$name`, `$1`, `$?`, `$_`, `$'…'` — or a bare `$`
 *
 * Each of the four bracketed arms produces a node typed for the construct when it closed
 * properly, and `ERROR` when it did not, with the same children either way. When the closer
 * is missing the `$(` and `${` arms take a RECOVERY path that rescans the unparsed remainder
 * with a nesting counter, skipping over quotes, backticks and nested substitutions, to find
 * where the construct would have ended and swallow that span into one ERROR node. The two
 * recovery scanners look alike but differ in detail and are written out separately.
 *
 * Never returns null: if nothing matches, the lone `$` node is returned.
 */
function parseDollar(p) {
  const afterDollar = peek(p.scan, 1);
  const startByte = p.scan.byte;

  // `$(( expr ))` — arithmetic.
  if (afterDollar === "(" && peek(p.scan, 2) === "(") {
    advance(p.scan);
    advance(p.scan);
    advance(p.scan);
    const openNode = node(p, "$((", startByte, p.scan.byte, []);
    const bodyStart = mark(p.scan);
    const expressions = parseArithmeticList(p, "))", "var");
    skipBlanks(p.scan);
    let closeNode;
    let isError = false;
    // The expression parser stopped somewhere other than the closer, so rewind to where the
    // body began and skip forward to the real `))`, then report the whole thing as an error.
    if (peek(p.scan) !== ")" || peek(p.scan, 1) !== ")") {
      skipToArithmeticClose(p, bodyStart, "))");
      isError = true;
    }
    if (peek(p.scan) === ")" && peek(p.scan, 1) === ")") {
      const closeStart = p.scan.byte;
      advance(p.scan);
      advance(p.scan);
      closeNode = node(p, "))", closeStart, p.scan.byte, []);
    } else {
      closeNode = node(p, "))", p.scan.byte, p.scan.byte, []);
    }
    return node(
      p,
      isError ? "ERROR" : "arithmetic_expansion",
      startByte,
      closeNode.endIndex,
      [openNode, ...expressions, closeNode],
    );
  }

  // `$[ expr ]` — the obsolete arithmetic spelling, handled identically to `$(( ))`.
  if (afterDollar === "[") {
    advance(p.scan);
    advance(p.scan);
    const openNode = node(p, "$[", startByte, p.scan.byte, []);
    const bodyStart = mark(p.scan);
    const expressions = parseArithmeticList(p, "]", "var");
    skipBlanks(p.scan);
    let closeNode;
    let isError = false;
    if (peek(p.scan) !== "]") {
      skipToArithmeticClose(p, bodyStart, "]");
      isError = true;
    }
    if (peek(p.scan) === "]") {
      const closeStart = p.scan.byte;
      advance(p.scan);
      closeNode = node(p, "]", closeStart, p.scan.byte, []);
    } else {
      closeNode = node(p, "]", p.scan.byte, p.scan.byte, []);
    }
    return node(
      p,
      isError ? "ERROR" : "arithmetic_expansion",
      startByte,
      closeNode.endIndex,
      [openNode, ...expressions, closeNode],
    );
  }

  // `$( commands )` — command substitution.
  if (afterDollar === "(") {
    advance(p.scan);
    advance(p.scan);
    const openNode = node(p, "$(", startByte, p.scan.byte, []);
    // The body is a fresh command context: quoting outside does not carry inside, so the
    // double-quote depth is zeroed for the duration and restored afterwards.
    const savedDquote = p.inDquote;
    p.inDquote = 0;
    let statements = parseStatements(p, ")");
    p.inDquote = savedDquote;
    skipBlanks(p.scan);
    let closeNode;
    let isError = false;
    if (peek(p.scan) === ")") {
      const closeStart = p.scan.byte;
      advance(p.scan);
      closeNode = node(p, ")", closeStart, p.scan.byte, []);
    } else {
      // RECOVERY. The statement parser gave up before the `)`. Rescan from here counting
      // parentheses — starting at 1 for the `(` already consumed — and skipping anything
      // where a `)` would not be structural: escapes, quoted spans, backtick spans, `$$`,
      // and `$'…'`. Everything skipped becomes one ERROR child.
      isError = true;
      const errorStart = p.scan.byte;
      let depth = 1;
      while (p.scan.pos < p.scan.len) {
        const ch = peek(p.scan);
        if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
          advance(p.scan);
          advance(p.scan);
          continue;
        }
        if (ch === '"' || ch === "'") {
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== ch) {
            // Backslash escapes only apply inside double quotes.
            if (ch === '"' && peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (p.scan.pos < p.scan.len) {
            advance(p.scan);
          }
          continue;
        }
        if (ch === "`") {
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
            if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (p.scan.pos < p.scan.len) {
            advance(p.scan);
          }
          continue;
        }
        // `$$` is the process id, not the start of anything; step over both characters so a
        // following `(` or `'` is not misread.
        if (ch === "$" && peek(p.scan, 1) === "$") {
          advance(p.scan);
          advance(p.scan);
          continue;
        }
        if (ch === "$" && peek(p.scan, 1) === "'") {
          advance(p.scan);
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
            if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (p.scan.pos < p.scan.len) {
            advance(p.scan);
          }
          continue;
        }
        if (ch === "(") {
          depth++;
        } else if (ch === ")") {
          depth--;
          if (depth === 0) {
            break;
          }
        }
        advance(p.scan);
      }
      statements.push(node(p, "ERROR", errorStart, p.scan.byte, []));
      if (peek(p.scan) === ")") {
        const closeStart = p.scan.byte;
        advance(p.scan);
        closeNode = node(p, ")", closeStart, p.scan.byte, []);
      } else {
        closeNode = node(p, "ERROR", p.scan.byte, p.scan.byte, []);
      }
    }
    // `$(> file)` and friends parse as a statement that is nothing but a redirect. Unwrap
    // that single wrapper so the substitution's child is the redirect itself.
    if (
      !isError &&
      statements.length === 1 &&
      statements[0].type === "redirected_statement" &&
      statements[0].children.length === 1 &&
      statements[0].children[0].type === "file_redirect"
    ) {
      statements = statements[0].children;
    }
    return node(
      p,
      isError ? "ERROR" : "command_substitution",
      startByte,
      closeNode.endIndex,
      [openNode, ...statements, closeNode],
    );
  }

  // `${ … }` — parameter expansion.
  if (afterDollar === "{") {
    advance(p.scan);
    advance(p.scan);
    const openNode = node(p, "${", startByte, p.scan.byte, []);
    const bodyNodes = parseExpansionBody(p);
    let closeNode;
    let isError = false;
    // A `${` body may be written across lines; blank lines before the closer are skipped.
    while (peek(p.scan) === "\n") {
      advance(p.scan);
    }
    if (peek(p.scan) === "}") {
      const closeStart = p.scan.byte;
      advance(p.scan);
      closeNode = node(p, "}", closeStart, p.scan.byte, []);
    } else {
      // RECOVERY, the brace variant. Same idea as the `$(` recovery — rescan with a counter
      // and swallow the span into an ERROR node — but the counter tracks `${` openers rather
      // than parentheses, and this scanner additionally steps over a whole nested `$( … )`
      // with a parenthesis counter of its own so that a `}` inside it is not mistaken for
      // this expansion's closer.
      isError = true;
      const errorStart = p.scan.byte;
      let braceDepth = 1;
      while (p.scan.pos < p.scan.len) {
        const ch = peek(p.scan);
        if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
          advance(p.scan);
          advance(p.scan);
          continue;
        }
        if (ch === '"' || ch === "'") {
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== ch) {
            if (ch === '"' && peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (p.scan.pos < p.scan.len) {
            advance(p.scan);
          }
          continue;
        }
        if (ch === "$" && peek(p.scan, 1) === "(") {
          let parenDepth = 1;
          advance(p.scan);
          advance(p.scan);
          // Note the shape of this inner loop: each branch only steps over the FIRST
          // character of a pair, and the unconditional advance at the bottom finishes the
          // job. That is also what closes the quote and backtick spans here, which is why
          // they lack the explicit closing advance the outer scanners have.
          while (p.scan.pos < p.scan.len && parenDepth > 0) {
            const innerCh = peek(p.scan);
            if (innerCh === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            } else if (innerCh === "$" && peek(p.scan, 1) === "$") {
              advance(p.scan);
            } else if (innerCh === "$" && peek(p.scan, 1) === "'") {
              advance(p.scan);
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
                if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (innerCh === '"' || innerCh === "'") {
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== innerCh) {
                if (innerCh === '"' && peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (innerCh === "`") {
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
                if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (innerCh === "(") {
              parenDepth++;
            } else if (innerCh === ")") {
              parenDepth--;
            }
            advance(p.scan);
          }
          continue;
        }
        if (ch === "`") {
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
            if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (p.scan.pos < p.scan.len) {
            advance(p.scan);
          }
          continue;
        }
        if (ch === "$" && peek(p.scan, 1) === "$") {
          advance(p.scan);
          advance(p.scan);
          continue;
        }
        if (ch === "$" && peek(p.scan, 1) === "'") {
          advance(p.scan);
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
            if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (p.scan.pos < p.scan.len) {
            advance(p.scan);
          }
          continue;
        }
        if (ch === "$" && peek(p.scan, 1) === "{") {
          braceDepth++;
          advance(p.scan);
        } else if (ch === "}") {
          braceDepth--;
          if (braceDepth === 0) {
            break;
          }
        }
        advance(p.scan);
      }
      // The ERROR node is built before the closing-brace node but appended after it, which
      // is the order the node budget sees them in.
      const errorNode = node(p, "ERROR", errorStart, p.scan.byte, []);
      if (peek(p.scan) === "}") {
        const closeStart = p.scan.byte;
        advance(p.scan);
        closeNode = node(p, "}", closeStart, p.scan.byte, []);
      } else {
        closeNode = node(p, "ERROR", p.scan.byte, p.scan.byte, []);
      }
      bodyNodes.push(errorNode);
    }
    // A single quote inside `${…}` that is itself inside double quotes is not a quote at all
    // in bash, and this parser has no way to represent that, so the expansion is failed out.
    if (
      !isError &&
      p.inDquote > 0 &&
      sliceBytes(p, openNode.endIndex, closeNode.startIndex).includes("'")
    ) {
      isError = true;
    }
    // `zshBraceDiff` is set by the expansion-body parser (not here) when the body uses a
    // construct that bash and zsh would read differently. It is read at this point so the
    // expansion itself becomes an ERROR, and it is read again at the top level, where it
    // turns the whole program into an ERROR.
    return node(
      p,
      isError || p.zshBraceDiff ? "ERROR" : "expansion",
      startByte,
      closeNode.endIndex,
      [openNode, ...bodyNodes, closeNode],
    );
  }

  // Nothing bracketed follows, so consume just the `$` and look at what is behind it.
  advance(p.scan);
  const dollarEnd = p.scan.byte;
  const dollarNode = node(p, "$", startByte, dollarEnd, []);
  const nameCh = peek(p.scan);

  // `$_` is the special "last argument" parameter, but only when the underscore is not the
  // start of an ordinary name like `$_foo`.
  if (nameCh === "_" && !isNameChar(peek(p.scan, 1))) {
    const nameStart = p.scan.byte;
    advance(p.scan);
    const nameNode = node(p, "special_variable_name", nameStart, p.scan.byte, []);
    return node(p, "simple_expansion", startByte, p.scan.byte, [dollarNode, nameNode]);
  }
  if (isNameStart(nameCh)) {
    const nameStart = p.scan.byte;
    while (isNameChar(peek(p.scan))) {
      advance(p.scan);
    }
    const nameNode = node(p, "variable_name", nameStart, p.scan.byte, []);
    return node(p, "simple_expansion", startByte, p.scan.byte, [dollarNode, nameNode]);
  }
  // A positional parameter is one digit only: `$12` is `$1` followed by a literal `2`.
  if (isDigit(nameCh)) {
    const nameStart = p.scan.byte;
    advance(p.scan);
    const nameNode = node(p, "variable_name", nameStart, p.scan.byte, []);
    return node(p, "simple_expansion", startByte, p.scan.byte, [dollarNode, nameNode]);
  }
  if (SPECIAL_VARIABLE_NAMES.has(nameCh)) {
    const nameStart = p.scan.byte;
    advance(p.scan);
    const nameNode = node(p, "special_variable_name", nameStart, p.scan.byte, []);
    return node(p, "simple_expansion", startByte, p.scan.byte, [dollarNode, nameNode]);
  }
  // `$'…'`, the C-style escape string. parseWord never gets here because it recognises `$'`
  // itself, but the arithmetic and expansion-operand parsers call parseDollar directly, so
  // the form has to be handled here too: swallow the literal, honouring backslash escapes,
  // and report the whole thing including the `$` as one leaf.
  if (nameCh === "'") {
    advance(p.scan);
    while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
      if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
        advance(p.scan);
      }
      advance(p.scan);
    }
    if (peek(p.scan) === "'") {
      advance(p.scan);
    }
    return node(p, "ansi_c_string", startByte, p.scan.byte, []);
  }
  // A `$` that expands nothing: the lone `$` leaf, already built above.
  return dollarNode;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. THE INSIDE OF ${…} AND BACKTICKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The inside of `${ ... }` — everything after the opening `${` and before the closing `}`.
 * Upstream `Ge`.
 *
 * Returns a flat array of child nodes for the caller (`parseDollar`) to sandwich between its
 * `${` and `}` tokens. This function never consumes the closing brace itself.
 *
 * A parameter expansion body is laid out in this order, and the code follows it top to bottom:
 *   1. an optional `#` length prefix — `${#name}` is "length of name";
 *   2. an optional `!`, `=` or `~` prefix — `!` is bash indirection (`${!ref}` expands the
 *      variable whose name is in `ref`), `=` and `~` are zsh flags;
 *   3. the parameter itself: a name, a positional digit run (`${12}`), or one of the special
 *      one-character names (`$?`, `$@`, ...);
 *   4. an optional `[subscript]` for array elements;
 *   5. an operator and whatever operand that operator takes.
 */
function parseExpansionBody(p) {
  const parts = [];
  skipBlanks(p.scan);
  {
    // Two whole-body forms are recognised here and produce no children at all: `${#!}`, and
    // `${!#}` together with its `${!##}` / `${!# }` spellings. Both are consumed silently so
    // the caller still sees a well-formed `${` ... `}` pair with an empty middle.
    const first = peek(p.scan);
    const second = peek(p.scan, 1);
    if (first === "#" && second === "!" && peek(p.scan, 2) === "}") {
      advance(p.scan);
      advance(p.scan);
      return parts;
    }
    if (first === "!" && second === "#") {
      let ahead = 2;
      if (peek(p.scan, ahead) === "#") {
        ahead++;
      }
      if (peek(p.scan, ahead) === " ") {
        ahead++;
      }
      if (peek(p.scan, ahead) === "}") {
        // `ahead` is the offset of the `}`, so consuming exactly that many code points parks
        // the cursor on the closing brace.
        while (ahead-- > 0) {
          advance(p.scan);
        }
        return parts;
      }
    }
  }
  if (peek(p.scan) === "#") {
    const start = p.scan.byte;
    advance(p.scan);
    parts.push(node(p, "#", start, p.scan.byte, []));
  }
  const prefix = peek(p.scan);
  if (
    (prefix === "!" || prefix === "=" || prefix === "~") &&
    (isNameStart(peek(p.scan, 1)) || isDigit(peek(p.scan, 1)))
  ) {
    const start = p.scan.byte;
    advance(p.scan);
    parts.push(node(p, prefix, start, p.scan.byte, []));
  }
  skipBlanks(p.scan);
  if (isNameStart(peek(p.scan))) {
    const start = p.scan.byte;
    while (isNameChar(peek(p.scan))) {
      advance(p.scan);
    }
    parts.push(node(p, "variable_name", start, p.scan.byte, []));
  } else if (isDigit(peek(p.scan))) {
    const start = p.scan.byte;
    while (isDigit(peek(p.scan))) {
      advance(p.scan);
    }
    parts.push(node(p, "variable_name", start, p.scan.byte, []));
  } else if (SPECIAL_VARIABLE_NAMES.has(peek(p.scan))) {
    const start = p.scan.byte;
    advance(p.scan);
    parts.push(node(p, "special_variable_name", start, p.scan.byte, []));
  }
  if (peek(p.scan) === "[") {
    // `${name[expr]}`. The name node pushed just above is pulled back out and becomes the
    // first child of a `subscript` node that takes its place in `parts`. If no name was
    // pushed (the parameter was missing or unrecognised) the brackets are scanned but the
    // subscript node is dropped.
    const target = parts.at(-1);
    const openStart = p.scan.byte;
    advance(p.scan);
    const openBracket = node(p, "[", openStart, p.scan.byte, []);
    const index = parseSubscriptContent(p);
    skipBlanks(p.scan);
    const closeStart = p.scan.byte;
    if (peek(p.scan) === "]") {
      advance(p.scan);
    }
    const closeBracket = node(p, "]", closeStart, p.scan.byte, []);
    if (target) {
      const children = index
        ? [target, openBracket, index, closeBracket]
        : [target, openBracket, closeBracket];
      parts[parts.length - 1] = node(
        p,
        "subscript",
        target.startIndex,
        p.scan.byte,
        children,
      );
    }
  }
  skipBlanks(p.scan);
  const sigil = peek(p.scan);
  if ((sigil === "*" || sigil === "@") && peek(p.scan, 1) === "}") {
    const start = p.scan.byte;
    advance(p.scan);
    parts.push(node(p, sigil, start, p.scan.byte, []));
    return parts;
  }
  if (sigil === "@" && isNameStart(peek(p.scan, 1))) {
    // The bash transformation operators, `${name@Q}`, `${name@U}` and so on. The `@` becomes
    // a node; the transformation letters that follow are consumed but not recorded.
    const start = p.scan.byte;
    advance(p.scan);
    parts.push(node(p, "@", start, p.scan.byte, []));
    while (isNameChar(peek(p.scan))) {
      advance(p.scan);
    }
    return parts;
  }
  const op = peek(p.scan);
  if (op === ":") {
    const next = peek(p.scan, 1);
    if (next === "}") {
      advance(p.scan);
      return parts;
    }
    if (next !== "-" && next !== "=" && next !== "?" && next !== "+") {
      // The substring form, `${v:offset}` and `${v:offset:length}`. It has to be recognised
      // here, ahead of the operator ladder below, because its `:` is a separator and not an
      // operator: were the ladder to see it first it would read `${v:1:2}` as the `:`
      // operator applied to the operand `1:2`. Each half is a full arithmetic expression,
      // except that a leading minus followed by digits is lifted out as a plain number —
      // bash needs `${v: -1}` to mean "one from the end", not a subtraction.
      advance(p.scan);
      skipBlanks(p.scan);
      const offsetChar = peek(p.scan);
      let offset;
      if (offsetChar === "-" && isDigit(peek(p.scan, 1))) {
        const start = p.scan.byte;
        advance(p.scan);
        while (isDigit(peek(p.scan))) {
          advance(p.scan);
        }
        offset = node(p, "number", start, p.scan.byte, []);
      } else {
        offset = parseArithmetic(p, ":}", "var");
      }
      if (offset) {
        parts.push(offset);
      }
      skipBlanks(p.scan);
      if (peek(p.scan) === ":") {
        advance(p.scan);
        skipBlanks(p.scan);
        const lengthChar = peek(p.scan);
        let length;
        if (lengthChar === "-" && isDigit(peek(p.scan, 1))) {
          const start = p.scan.byte;
          advance(p.scan);
          while (isDigit(peek(p.scan))) {
            advance(p.scan);
          }
          length = node(p, "number", start, p.scan.byte, []);
        } else {
          length = parseArithmetic(p, "}", "var");
        }
        if (length) {
          parts.push(length);
        }
      }
      return parts;
    }
  }
  if (
    op === ":" ||
    op === "#" ||
    op === "%" ||
    op === "/" ||
    op === "^" ||
    op === "," ||
    op === "-" ||
    op === "=" ||
    op === "?" ||
    op === "+"
  ) {
    // The operator ladder. The operator is one or two characters: `:` pairs with one of
    // `-=?+` (default / assign-default / error / alternate), and `#`, `%`, `/`, `^` and `,`
    // may double (`##` longest-prefix strip, `%%` longest-suffix strip, `//` replace-all,
    // `^^` uppercase-all, `,,` lowercase-all). Anything else is the single character.
    const operatorStart = p.scan.byte;
    const next = peek(p.scan, 1);
    let operator = op;
    if (
      op === ":" &&
      (next === "-" || next === "=" || next === "?" || next === "+")
    ) {
      advance(p.scan);
      advance(p.scan);
      operator = op + next;
    } else if (
      (op === "#" || op === "%" || op === "/" || op === "^" || op === ",") &&
      next === op
    ) {
      advance(p.scan);
      advance(p.scan);
      operator = op + op;
    } else {
      advance(p.scan);
    }
    parts.push(node(p, operator, operatorStart, p.scan.byte, []));
    // True for every operator whose operand is a shell pattern rather than a word. By the
    // time this is read, the `/` family and the `#`/`%` family have already been routed to
    // their own arms, so in practice it only decides the case-conversion operators.
    const wantsPatternOperand =
      operator === "#" ||
      operator === "##" ||
      operator === "%" ||
      operator === "%%" ||
      operator === "/" ||
      operator === "//" ||
      operator === "^" ||
      operator === "^^" ||
      operator === "," ||
      operator === ",,";
    if (operator === "/" || operator === "//") {
      // `${v/pattern/replacement}`. An optional `#` or `%` right after the slash anchors the
      // pattern to the start or the end of the value.
      const anchor = peek(p.scan);
      if (anchor === "#" || anchor === "%") {
        const start = p.scan.byte;
        advance(p.scan);
        parts.push(node(p, anchor, start, p.scan.byte, []));
      }
      if (peek(p.scan) === '"') {
        parts.push(parseDoubleQuoted(p));
        const pattern = parseExpansionOperand(p, "regex", true);
        if (pattern) {
          parts.push(pattern);
        }
      } else {
        const pattern = parseExpansionOperand(p, "regex", true);
        if (pattern) {
          parts.push(pattern);
        }
      }
      if (peek(p.scan) === "/") {
        const slashStart = p.scan.byte;
        advance(p.scan);
        parts.push(node(p, "/", slashStart, p.scan.byte, []));
        const replacement = parseExpansionOperand(p, "replword", false);
        if (replacement) {
          // A replacement that came back as exactly "a command substitution followed by one
          // more piece" is spliced apart, so the command substitution sits directly under the
          // expansion where consumers can find it.
          if (
            replacement.type === "concatenation" &&
            replacement.children.length === 2 &&
            replacement.children[0].type === "command_substitution"
          ) {
            parts.push(replacement.children[0]);
            parts.push(replacement.children[1]);
          } else {
            parts.push(replacement);
          }
        }
      }
    } else if (
      operator === "#" ||
      operator === "##" ||
      operator === "%" ||
      operator === "%%"
    ) {
      for (const part of parsePatternOperand(p)) {
        parts.push(part);
      }
    } else {
      const operand = parseExpansionOperand(
        p,
        wantsPatternOperand ? "regex" : "word",
        false,
      );
      if (operand) {
        parts.push(operand);
      }
    }
  }
  return parts;
}

/**
 * The operand that follows an expansion operator. Upstream `J`.
 *
 * This is three unrelated parsers behind one name, chosen by `kind`:
 *
 *   - "word" — the operand of `:-`, `:=`, `:?`, `:+` and friends. If it opens with `(` it is
 *     a parenthesised array such as `${v:-(a b c)}` and is scanned as a bracketed list of
 *     whitespace-separated words; otherwise control falls through to the default arm below.
 *   - "regex" — the pattern half of `${v/pattern/repl}` and the operand of the
 *     case-conversion operators. This produces at most ONE flat `regex` node: the scan only
 *     needs to know where the operand ends, so it tracks quoting and nesting well enough to
 *     step over `${...}`, `$(...)`, backticks and quoted runs without stopping on a `}` or
 *     `/` that lives inside them, and records nothing about what it stepped over.
 *   - anything else (in practice "replword", the replacement half of `${v/pat/repl}`) — a
 *     concatenation loop shaped like `parseWord`'s: literal runs become `word` nodes and are
 *     interleaved with real nodes for the expansions, quoted strings and substitutions found
 *     along the way.
 *
 * `stopAtSlash` ends the "regex" and default scans at an unquoted `/`; it is set while
 * reading the pattern half of a replacement, where the next `/` is the separator.
 */
function parseExpansionOperand(p, kind, stopAtSlash) {
  const start = p.scan.byte;
  if (kind === "word" && peek(p.scan) === "(") {
    advance(p.scan);
    const children = [node(p, "(", start, p.scan.byte, [])];
    while (p.scan.pos < p.scan.len) {
      skipBlanks(p.scan);
      const ch = peek(p.scan);
      if (ch === ")" || ch === "}" || ch === "\n" || ch === "") {
        break;
      }
      const wordStart = p.scan.byte;
      while (p.scan.pos < p.scan.len) {
        const inner = peek(p.scan);
        if (
          inner === ")" ||
          inner === "}" ||
          inner === " " ||
          inner === "\t" ||
          inner === "\n" ||
          inner === ""
        ) {
          break;
        }
        if (inner === "\\" && p.scan.pos + 1 < p.scan.len) {
          advance(p.scan);
          advance(p.scan);
          continue;
        }
        if (inner === "$" && peek(p.scan, 1) === "$") {
          advance(p.scan);
          advance(p.scan);
          continue;
        }
        if (inner === "$" && peek(p.scan, 1) === "'") {
          advance(p.scan);
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
            if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (peek(p.scan) === "'") {
            advance(p.scan);
          }
          continue;
        }
        if (inner === "$" && peek(p.scan, 1) === "(") {
          p.zshBraceDiff = true;
        }
        if (inner === '"' || inner === "'") {
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== inner) {
            if (
              inner === '"' &&
              peek(p.scan) === "\\" &&
              p.scan.pos + 1 < p.scan.len
            ) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (peek(p.scan) === inner) {
            advance(p.scan);
          }
          continue;
        }
        if (inner === "`") {
          p.zshBraceDiff = true;
          advance(p.scan);
          while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
            if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            }
            advance(p.scan);
          }
          if (peek(p.scan) === "`") {
            advance(p.scan);
          }
          continue;
        }
        if (inner === "{") {
          p.zshBraceDiff = true;
        }
        advance(p.scan);
      }
      // No progress means the inner loop stopped on something it cannot consume; leaving the
      // outer loop is what keeps this from spinning.
      if (p.scan.byte > wordStart) {
        children.push(node(p, "word", wordStart, p.scan.byte, []));
      } else {
        break;
      }
    }
    if (peek(p.scan) === ")") {
      const closeStart = p.scan.byte;
      advance(p.scan);
      children.push(node(p, ")", closeStart, p.scan.byte, []));
    }
    while (peek(p.scan) === "\n") {
      advance(p.scan);
    }
    return node(p, "array", start, p.scan.byte, children);
  }
  if (kind === "regex") {
    while (p.scan.pos < p.scan.len) {
      const ch = peek(p.scan);
      if (ch === "{") {
        p.zshBraceDiff = true;
      }
      if (ch === "}") {
        break;
      }
      if (stopAtSlash && ch === "/") {
        break;
      }
      if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
        advance(p.scan);
        advance(p.scan);
        continue;
      }
      if (ch === '"' || ch === "'") {
        // Note the asymmetry with the other quote scans in this file: here a backslash is
        // honoured inside single quotes too, where the shell would treat it as a literal.
        advance(p.scan);
        while (p.scan.pos < p.scan.len && peek(p.scan) !== ch) {
          if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
            advance(p.scan);
          }
          advance(p.scan);
        }
        if (peek(p.scan) === ch) {
          advance(p.scan);
        }
        continue;
      }
      if (ch === "`") {
        p.zshBraceDiff = true;
        advance(p.scan);
        while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
          if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
            advance(p.scan);
          }
          advance(p.scan);
        }
        if (peek(p.scan) === "`") {
          advance(p.scan);
        }
        continue;
      }
      if (ch === "$") {
        const after = peek(p.scan, 1);
        if (after === "{") {
          // Step over a nested `${ ... }`, counting braces so the operand does not end on the
          // inner closing brace. Every arm here falls through to the single `advance` at the
          // bottom of the loop, so an arm that consumes two characters advances once itself.
          let depth = 0;
          advance(p.scan);
          advance(p.scan);
          depth++;
          while (p.scan.pos < p.scan.len && depth > 0) {
            const inner = peek(p.scan);
            if (inner === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            } else if (inner === "$" && peek(p.scan, 1) === "$") {
              advance(p.scan);
            } else if (inner === "$" && peek(p.scan, 1) === "'") {
              advance(p.scan);
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
                if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (inner === '"' || inner === "'") {
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== inner) {
                if (
                  inner === '"' &&
                  peek(p.scan) === "\\" &&
                  p.scan.pos + 1 < p.scan.len
                ) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (inner === "`") {
              p.zshBraceDiff = true;
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
                if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (inner === "$" && peek(p.scan, 1) === "{") {
              depth++;
              advance(p.scan);
            } else if (inner === "$" && peek(p.scan, 1) === "(") {
              p.zshBraceDiff = true;
            } else if (inner === "{") {
              p.zshBraceDiff = true;
            } else if (inner === "}") {
              depth--;
            }
            advance(p.scan);
          }
          continue;
        }
        if (after === "(") {
          // Step over a nested `$( ... )`, counting parentheses. Unlike the brace scan above
          // this one does not flag a backtick as a zsh difference, and it does not track
          // braces at all.
          p.zshBraceDiff = true;
          let depth = 0;
          advance(p.scan);
          advance(p.scan);
          depth++;
          while (p.scan.pos < p.scan.len && depth > 0) {
            const inner = peek(p.scan);
            if (inner === "\\" && p.scan.pos + 1 < p.scan.len) {
              advance(p.scan);
            } else if (inner === "$" && peek(p.scan, 1) === "$") {
              advance(p.scan);
            } else if (inner === "$" && peek(p.scan, 1) === "'") {
              advance(p.scan);
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
                if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (inner === '"' || inner === "'") {
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== inner) {
                if (
                  inner === '"' &&
                  peek(p.scan) === "\\" &&
                  p.scan.pos + 1 < p.scan.len
                ) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (inner === "`") {
              advance(p.scan);
              while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
                if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                  advance(p.scan);
                }
                advance(p.scan);
              }
            } else if (inner === "(") {
              depth++;
            } else if (inner === ")") {
              depth--;
            }
            advance(p.scan);
          }
          continue;
        }
      }
      advance(p.scan);
    }
    const end = p.scan.byte;
    if (end === start) {
      return null;
    }
    return node(p, "regex", start, end, []);
  }
  const parts = [];
  let segmentStart = p.scan.byte;
  // Closes off the literal run that has accumulated since the last node was pushed. Called
  // before every node the loop emits, and once more at the end.
  const flush = () => {
    if (p.scan.byte > segmentStart) {
      parts.push(node(p, "word", segmentStart, p.scan.byte, []));
    }
  };
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (ch === "}") {
      break;
    }
    if (ch === "{") {
      p.zshBraceDiff = true;
    }
    if (stopAtSlash && ch === "/") {
      break;
    }
    if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
      advance(p.scan);
      advance(p.scan);
      continue;
    }
    const next = peek(p.scan, 1);
    if (ch === "$") {
      if (next === "{" || next === "(" || next === "[") {
        flush();
        const expansion = parseDollar(p);
        if (expansion) {
          parts.push(expansion);
        }
        segmentStart = p.scan.byte;
        continue;
      }
      if (next === "'") {
        flush();
        const stringStart = p.scan.byte;
        advance(p.scan);
        advance(p.scan);
        while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
          if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
            advance(p.scan);
          }
          advance(p.scan);
        }
        if (peek(p.scan) === "'") {
          advance(p.scan);
        }
        parts.push(node(p, "ansi_c_string", stringStart, p.scan.byte, []));
        segmentStart = p.scan.byte;
        continue;
      }
      if (isNameStart(next) || isDigit(next) || SPECIAL_VARIABLE_NAMES.has(next)) {
        flush();
        const expansion = parseDollar(p);
        if (expansion) {
          parts.push(expansion);
        }
        segmentStart = p.scan.byte;
        continue;
      }
    }
    if (ch === '"') {
      flush();
      parts.push(parseDoubleQuoted(p));
      segmentStart = p.scan.byte;
      continue;
    }
    if (ch === "'") {
      flush();
      const stringStart = p.scan.byte;
      advance(p.scan);
      while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
        advance(p.scan);
      }
      if (peek(p.scan) === "'") {
        advance(p.scan);
      }
      parts.push(node(p, "raw_string", stringStart, p.scan.byte, []));
      segmentStart = p.scan.byte;
      continue;
    }
    if ((ch === "<" || ch === ">") && next === "(") {
      p.zshBraceDiff = true;
      flush();
      const substitution = parseProcessSubstitution(p);
      if (substitution) {
        parts.push(substitution);
      }
      segmentStart = p.scan.byte;
      continue;
    }
    if (ch === "`") {
      flush();
      const substitution = parseBacktick(p);
      if (substitution) {
        parts.push(substitution);
      }
      segmentStart = p.scan.byte;
      continue;
    }
    advance(p.scan);
  }
  flush();
  // A leading run of pure blanks is dropped, but only when something else follows it: an
  // operand that is nothing but spaces stays as it is.
  if (
    parts.length > 1 &&
    parts[0].type === "word" &&
    /^[ \t]+$/.test(parts[0].text)
  ) {
    parts.shift();
  }
  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  const last = parts.at(-1);
  return node(p, "concatenation", parts[0].startIndex, last.endIndex, parts);
}

/**
 * The operand of the prefix- and suffix-stripping operators `#`, `##`, `%` and `%%`.
 * Upstream `Je`.
 *
 * Unlike `parseExpansionOperand` this returns an ARRAY of nodes rather than one node, and its
 * literal runs are typed `regex` rather than `word`, because what follows these operators is a
 * shell pattern. Double-quoted strings, single-quoted strings and `$'...'` become their own
 * nodes; backticks, `$$`, `${...}` and `$(...)` are stepped over and stay inside the
 * surrounding `regex` run.
 */
function parsePatternOperand(p) {
  const parts = [];
  let segmentStart = p.scan.byte;
  const flush = () => {
    if (p.scan.byte > segmentStart) {
      parts.push(node(p, "regex", segmentStart, p.scan.byte, []));
    }
  };
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (ch === "}") {
      break;
    }
    if (ch === "{") {
      p.zshBraceDiff = true;
    }
    if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
      advance(p.scan);
      advance(p.scan);
      continue;
    }
    if (ch === '"') {
      flush();
      parts.push(parseDoubleQuoted(p));
      segmentStart = p.scan.byte;
      continue;
    }
    if (ch === "'") {
      flush();
      const rawStart = p.scan.byte;
      advance(p.scan);
      while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
        advance(p.scan);
      }
      if (peek(p.scan) === "'") {
        advance(p.scan);
      }
      parts.push(node(p, "raw_string", rawStart, p.scan.byte, []));
      segmentStart = p.scan.byte;
      continue;
    }
    if (ch === "`") {
      p.zshBraceDiff = true;
      advance(p.scan);
      while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
        if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
          advance(p.scan);
        }
        advance(p.scan);
      }
      if (peek(p.scan) === "`") {
        advance(p.scan);
      }
      continue;
    }
    if (ch === "$") {
      const after = peek(p.scan, 1);
      if (after === "$") {
        advance(p.scan);
        advance(p.scan);
        continue;
      }
      if (after === "'") {
        flush();
        const ansiStart = p.scan.byte;
        advance(p.scan);
        advance(p.scan);
        while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
          if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
            advance(p.scan);
          }
          advance(p.scan);
        }
        if (peek(p.scan) === "'") {
          advance(p.scan);
        }
        parts.push(node(p, "ansi_c_string", ansiStart, p.scan.byte, []));
        segmentStart = p.scan.byte;
        continue;
      }
      if (after === "{") {
        // Same brace-counting step-over as in the "regex" arm of `parseExpansionOperand`,
        // except that the depth starts at one here instead of being incremented from zero.
        let depth = 1;
        advance(p.scan);
        advance(p.scan);
        while (p.scan.pos < p.scan.len && depth > 0) {
          const inner = peek(p.scan);
          if (inner === "\\" && p.scan.pos + 1 < p.scan.len) {
            advance(p.scan);
          } else if (inner === "$" && peek(p.scan, 1) === "$") {
            advance(p.scan);
          } else if (inner === "$" && peek(p.scan, 1) === "'") {
            advance(p.scan);
            advance(p.scan);
            while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
              if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                advance(p.scan);
              }
              advance(p.scan);
            }
          } else if (inner === '"' || inner === "'") {
            advance(p.scan);
            while (p.scan.pos < p.scan.len && peek(p.scan) !== inner) {
              if (
                inner === '"' &&
                peek(p.scan) === "\\" &&
                p.scan.pos + 1 < p.scan.len
              ) {
                advance(p.scan);
              }
              advance(p.scan);
            }
          } else if (inner === "`") {
            p.zshBraceDiff = true;
            advance(p.scan);
            while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
              if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                advance(p.scan);
              }
              advance(p.scan);
            }
          } else if (inner === "$" && peek(p.scan, 1) === "{") {
            depth++;
            advance(p.scan);
          } else if (inner === "$" && peek(p.scan, 1) === "(") {
            p.zshBraceDiff = true;
          } else if (inner === "{") {
            p.zshBraceDiff = true;
          } else if (inner === "}") {
            depth--;
          }
          advance(p.scan);
        }
        continue;
      }
      if (after === "(") {
        p.zshBraceDiff = true;
        let depth = 1;
        advance(p.scan);
        advance(p.scan);
        while (p.scan.pos < p.scan.len && depth > 0) {
          const inner = peek(p.scan);
          if (inner === "\\" && p.scan.pos + 1 < p.scan.len) {
            advance(p.scan);
          } else if (inner === "$" && peek(p.scan, 1) === "$") {
            advance(p.scan);
          } else if (inner === "$" && peek(p.scan, 1) === "'") {
            advance(p.scan);
            advance(p.scan);
            while (p.scan.pos < p.scan.len && peek(p.scan) !== "'") {
              if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                advance(p.scan);
              }
              advance(p.scan);
            }
          } else if (inner === '"' || inner === "'") {
            advance(p.scan);
            while (p.scan.pos < p.scan.len && peek(p.scan) !== inner) {
              if (
                inner === '"' &&
                peek(p.scan) === "\\" &&
                p.scan.pos + 1 < p.scan.len
              ) {
                advance(p.scan);
              }
              advance(p.scan);
            }
          } else if (inner === "`") {
            advance(p.scan);
            while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
              if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
                advance(p.scan);
              }
              advance(p.scan);
            }
          } else if (inner === "(") {
            depth++;
          } else if (inner === ")") {
            depth--;
          }
          advance(p.scan);
        }
        continue;
      }
    }
    advance(p.scan);
  }
  flush();
  return parts;
}

/**
 * A backtick command substitution, `` `cmd` ``. Upstream `ie`.
 *
 * The cursor is on the opening backtick when this is called, and the returned node is a
 * `command_substitution` whose first and last children are the two backtick tokens. Null is
 * returned when the body turned out to be empty — the backticks have still been consumed.
 *
 * Backticks are awkward because, unlike `$( ... )`, they do not nest and their body is not a
 * plain slice of source: inside them `\``, `\$` and `\\` are escapes that the shell strips
 * before parsing. This function is built in three stages to cope with that.
 *
 * Stage one is a PRE-SCAN over the raw source, walking forward to the closing backtick while
 * treating any backslash as covering the character after it. It records two things: where the
 * closing backtick is, and whether any of the three meaningful escapes appeared. If one did,
 * the body would have to be unescaped before it could be parsed, which this parser does not
 * do, so it gives up immediately and returns a `command_substitution` holding a single
 * `backtick_escape_unsupported` node covering the whole body.
 *
 * Stage two parses the body as a sequence of statements, with `inBacktick` raised (so the
 * inner parsers know to treat a backtick as a terminator), `inDquote` cleared (a backtick body
 * is not inside the enclosing double quotes), and the pending heredoc stack swapped for an
 * empty one, since a heredoc opened inside the body cannot draw its content from lines
 * outside it. All three are restored afterwards.
 *
 * Stage three checks that the statement parse finished exactly where the pre-scan said the
 * closing backtick was. If it did not, the body parser has run past the end of the
 * substitution — it consumed a backtick that the pre-scan considered the terminator, or
 * stopped short of it — and everything it produced is untrustworthy. In that case the whole
 * body is discarded, the cursor is rewound and driven to the pre-scan's position, and the
 * children are replaced by a single `backtick_body_overrun` node spanning the body.
 */
function parseBacktick(p) {
  const openStart = p.scan.byte;
  advance(p.scan);
  const openNode = node(p, "`", openStart, p.scan.byte, []);
  let closeIndex = p.scan.pos;
  {
    let hasUnsupportedEscape = false;
    while (closeIndex < p.scan.len) {
      const ch = p.scan.src[closeIndex];
      if (ch === "\\") {
        const escaped = p.scan.src[closeIndex + 1];
        if (escaped === "`" || escaped === "$" || escaped === "\\") {
          hasUnsupportedEscape = true;
        }
        closeIndex += 2;
        continue;
      }
      if (ch === "`") {
        break;
      }
      closeIndex++;
    }
    if (hasUnsupportedEscape) {
      const bodyStart = p.scan.byte;
      while (p.scan.pos < closeIndex) {
        advance(p.scan);
      }
      const bodyNode = node(
        p,
        "backtick_escape_unsupported",
        bodyStart,
        p.scan.byte,
        [],
      );
      let closeNode;
      if (peek(p.scan) === "`") {
        const closeStart = p.scan.byte;
        advance(p.scan);
        closeNode = node(p, "`", closeStart, p.scan.byte, []);
      } else {
        closeNode = node(p, "`", p.scan.byte, p.scan.byte, []);
      }
      return node(p, "command_substitution", openStart, closeNode.endIndex, [
        openNode,
        bodyNode,
        closeNode,
      ]);
    }
  }
  p.inBacktick++;
  const savedInDquote = p.inDquote;
  p.inDquote = 0;
  const bodyMark = mark(p.scan);
  const savedHeredocs = p.scan.heredocs;
  p.scan.heredocs = [];
  const bodyParts = [];
  while (true) {
    skipBlanks(p.scan);
    if (peek(p.scan) === "`" || peek(p.scan) === "") {
      break;
    }
    // Peek one token to see whether anything worth parsing is left; the mark lets the token
    // be handed back to the statement parser untouched.
    const tokenMark = mark(p.scan);
    const tok = nextToken(p.scan, "cmd");
    if (tok.type === "EOF" || tok.type === "BACKTICK") {
      reset(p.scan, tokenMark);
      break;
    }
    if (tok.type === "NEWLINE") {
      continue;
    }
    reset(p.scan, tokenMark);
    const statement = parseAndOrList(p);
    if (!statement) {
      break;
    }
    bodyParts.push(statement);
    skipBlanks(p.scan);
    if (peek(p.scan) === "`") {
      break;
    }
    const separatorMark = mark(p.scan);
    const separator = nextToken(p.scan, "cmd");
    if (
      separator.type === "OP" &&
      (separator.value === ";" || separator.value === "&")
    ) {
      bodyParts.push(tokenNode(p, separator.value, separator));
    } else if (separator.type !== "NEWLINE") {
      reset(p.scan, separatorMark);
    }
  }
  p.scan.heredocs = savedHeredocs;
  p.inBacktick--;
  p.inDquote = savedInDquote;
  if (p.scan.pos !== closeIndex) {
    reset(p.scan, bodyMark);
    while (p.scan.pos < closeIndex) {
      advance(p.scan);
    }
    bodyParts.length = 0;
    bodyParts.push(
      node(p, "backtick_body_overrun", openNode.endIndex, p.scan.byte, []),
    );
  }
  let closeNode;
  if (peek(p.scan) === "`") {
    const closeStart = p.scan.byte;
    advance(p.scan);
    closeNode = node(p, "`", closeStart, p.scan.byte, []);
  } else {
    closeNode = node(p, "`", p.scan.byte, p.scan.byte, []);
  }
  if (bodyParts.length === 0) {
    return null;
  }
  return node(p, "command_substitution", openStart, closeNode.endIndex, [
    openNode,
    ...bodyParts,
    closeNode,
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. THE KEYWORD-LED COMPOUND STATEMENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `if COND; then BODY; [elif COND; then BODY;]* [else BODY;] fi` — upstream `Pe`.
 *
 * The `elif`/`else` tail is a speculative loop: each turn marks the scanner, pulls one
 * token, and rewinds when the token is neither keyword so that the closing `fi` lookup
 * starts from the right place. `elif` builds a nested `elif_clause` holding its own
 * condition and body; `else` builds an `else_clause`.
 *
 * `then` and `fi` are appended through `expectKeyword`, which appends NOTHING when the
 * keyword is missing (see its own note). That is why the end offset is read off
 * `children.at(-1)` rather than a fixed slot: the child list is variable-length by design.
 */
function parseIf(p, keywordToken) {
  const ifWord = tokenNode(p, "if", keywordToken);
  const children = [ifWord];
  const condition = parseStatements(p, null);
  children.push(...condition);
  expectKeyword(p, "then", children);
  const body = parseStatements(p, null);
  children.push(...body);
  while (true) {
    const saved = mark(p.scan);
    const tok = nextToken(p.scan, "cmd");
    if (tok.type === "WORD" && tok.value === "elif") {
      const elifWord = tokenNode(p, "elif", tok);
      const elifCondition = parseStatements(p, null);
      const elifChildren = [elifWord, ...elifCondition];
      expectKeyword(p, "then", elifChildren);
      const elifBody = parseStatements(p, null);
      elifChildren.push(...elifBody);
      const lastElifChild = elifChildren.at(-1);
      children.push(
        node(
          p,
          "elif_clause",
          elifWord.startIndex,
          lastElifChild.endIndex,
          elifChildren,
        ),
      );
    } else if (tok.type === "WORD" && tok.value === "else") {
      const elseWord = tokenNode(p, "else", tok);
      const elseBody = parseStatements(p, null);
      const lastElseChild = elseBody.length > 0 ? elseBody.at(-1) : elseWord;
      children.push(
        node(p, "else_clause", elseWord.startIndex, lastElseChild.endIndex, [
          elseWord,
          ...elseBody,
        ]),
      );
    } else {
      reset(p.scan, saved);
      break;
    }
  }
  expectKeyword(p, "fi", children);
  const lastChild = children.at(-1);
  return node(
    p,
    "if_statement",
    ifWord.startIndex,
    lastChild.endIndex,
    children,
  );
}

/**
 * `while COND; do BODY; done` and `until COND; do BODY; done` — upstream `en`.
 *
 * Both spellings produce a `while_statement`; the leading keyword node carries its own
 * text, so the node type does not need to distinguish them. The `do … done` block is
 * optional here only because `parseDoGroup` returns null on a malformed loop.
 */
function parseWhile(p, keywordToken) {
  const keyword = tokenNode(p, keywordToken.value, keywordToken);
  const children = [keyword];
  const condition = parseStatements(p, null);
  children.push(...condition);
  const doGroup = parseDoGroup(p);
  if (doGroup) {
    children.push(doGroup);
  }
  const lastChild = children.at(-1);
  return node(
    p,
    "while_statement",
    keyword.startIndex,
    lastChild.endIndex,
    children,
  );
}

/**
 * Three different loops behind one entry point — upstream `me`.
 *
 * 1. `for ((init; test; step))` — the C-style arithmetic loop, handled first and returning
 *    a `c_style_for_statement`. Only `for` can take this form, never `select`.
 * 2. `for NAME in WORDS; do … done`
 * 3. `select NAME in WORDS; do … done` — bash's interactive menu loop, same grammar.
 *
 * The C-style arm runs a fixed three-slot loop (init, test, step). Each slot is an
 * arithmetic list stopping at `;` for the first two and at `))` for the last, and after
 * the first two slots the `;` itself is consumed as its own child node. After the header
 * the loop body may be either a `do … done` group or a brace-delimited compound statement,
 * which is why the brace arm is spelled out inline instead of reusing `parseDoGroup`.
 *
 * In arms 2 and 3 the loop variable must be a plain shell name: a name-start character
 * followed only by name characters. Anything else becomes an `ERROR` node covering the
 * same span, so the rest of the loop still parses.
 */
function parseFor(p, keywordToken) {
  const keyword = tokenNode(p, keywordToken.value, keywordToken);
  skipBlanks(p.scan);
  if (
    keywordToken.value === "for" &&
    peek(p.scan) === "(" &&
    peek(p.scan, 1) === "("
  ) {
    const openByte = p.scan.byte;
    advance(p.scan);
    advance(p.scan);
    const openNode = node(p, "((", openByte, p.scan.byte, []);
    const children = [keyword, openNode];
    for (let slot = 0; slot < 3; slot++) {
      skipBlanks(p.scan);
      const expressions = parseArithmeticList(
        p,
        slot < 2 ? ";" : "))",
        "assign",
      );
      children.push(...expressions);
      if (slot < 2) {
        if (peek(p.scan) === ";") {
          const semicolonByte = p.scan.byte;
          advance(p.scan);
          children.push(node(p, ";", semicolonByte, p.scan.byte, []));
        }
      }
    }
    skipBlanks(p.scan);
    if (peek(p.scan) === ")" && peek(p.scan, 1) === ")") {
      const closeByte = p.scan.byte;
      advance(p.scan);
      advance(p.scan);
      children.push(node(p, "))", closeByte, p.scan.byte, []));
    }
    const savedAfterHeader = mark(p.scan);
    const separator = nextToken(p.scan, "cmd");
    if (separator.type === "OP" && separator.value === ";") {
      children.push(tokenNode(p, ";", separator));
    } else if (separator.type !== "NEWLINE") {
      reset(p.scan, savedAfterHeader);
    }
    const doGroup = parseDoGroup(p);
    if (doGroup) {
      children.push(doGroup);
    } else {
      skipNewlines(p);
      skipBlanks(p.scan);
      if (peek(p.scan) === "{") {
        const openBraceByte = p.scan.byte;
        advance(p.scan);
        const openBrace = node(p, "{", openBraceByte, p.scan.byte, []);
        const body = parseStatements(p, "}");
        let closeBrace;
        if (peek(p.scan) === "}") {
          const closeBraceByte = p.scan.byte;
          advance(p.scan);
          closeBrace = node(p, "}", closeBraceByte, p.scan.byte, []);
        } else {
          closeBrace = node(p, "}", p.scan.byte, p.scan.byte, []);
        }
        children.push(
          node(
            p,
            "compound_statement",
            openBrace.startIndex,
            closeBrace.endIndex,
            [openBrace, ...body, closeBrace],
          ),
        );
      }
    }
    const lastCStyleChild = children.at(-1);
    return node(
      p,
      "c_style_for_statement",
      keyword.startIndex,
      lastCStyleChild.endIndex,
      children,
    );
  }
  const children = [keyword];
  const nameToken = nextToken(p.scan, "arg");
  if (
    nameToken.type === "WORD" &&
    isNameStart(nameToken.value[0] ?? "") &&
    [...nameToken.value].every(isNameChar)
  ) {
    children.push(
      node(p, "variable_name", nameToken.start, nameToken.end, []),
    );
  } else {
    children.push(node(p, "ERROR", nameToken.start, nameToken.end, []));
  }
  skipBlanks(p.scan);
  const savedBeforeIn = mark(p.scan);
  const inToken = nextToken(p.scan, "arg");
  if (inToken.type === "WORD" && inToken.value === "in") {
    children.push(tokenNode(p, "in", inToken));
    while (true) {
      skipBlanks(p.scan);
      const ch = peek(p.scan);
      if (ch === ";" || ch === "\n" || ch === "") {
        break;
      }
      const word = parseWord(p, "arg");
      if (!word) {
        break;
      }
      children.push(word);
    }
  } else {
    reset(p.scan, savedBeforeIn);
  }
  const savedBeforeSeparator = mark(p.scan);
  const separator = nextToken(p.scan, "cmd");
  if (separator.type === "OP" && separator.value === ";") {
    children.push(tokenNode(p, ";", separator));
  } else if (separator.type !== "NEWLINE") {
    reset(p.scan, savedBeforeSeparator);
  }
  const doGroup = parseDoGroup(p);
  if (doGroup) {
    children.push(doGroup);
  }
  const lastChild = children.at(-1);
  return node(
    p,
    "for_statement",
    keyword.startIndex,
    lastChild.endIndex,
    children,
  );
}

/**
 * The `do … done` body shared by `for`, `select`, `while` and `until` — upstream `ae`.
 *
 * Returns null, leaving the scanner exactly where it found it, when the next token is not
 * `do`; that lets the callers fall through to whatever else they accept.
 */
function parseDoGroup(p) {
  skipNewlines(p);
  const saved = mark(p.scan);
  const tok = nextToken(p.scan, "cmd");
  if (tok.type !== "WORD" || tok.value !== "do") {
    reset(p.scan, saved);
    return null;
  }
  const doWord = tokenNode(p, "do", tok);
  const body = parseStatements(p, null);
  const children = [doWord, ...body];
  expectKeyword(p, "done", children);
  const lastChild = children.at(-1);
  return node(
    p,
    "do_group",
    doWord.startIndex,
    lastChild.endIndex,
    children,
  );
}

/**
 * `case WORD in PATTERN) BODY;; … esac` — upstream `nn`.
 *
 * The item loop ends on `esac` (consumed and appended), on end of input, or as soon as
 * `parseCaseItem` declines to produce an item. That last exit is what stops the loop when
 * malformed input leaves nothing further to consume.
 */
function parseCase(p, keywordToken) {
  const caseWord = tokenNode(p, "case", keywordToken);
  const children = [caseWord];
  skipBlanks(p.scan);
  const subject = parseWord(p, "arg");
  if (subject) {
    children.push(subject);
  }
  skipBlanks(p.scan);
  expectKeyword(p, "in", children);
  skipNewlines(p);
  while (true) {
    skipBlanks(p.scan);
    skipNewlines(p);
    const saved = mark(p.scan);
    const tok = nextToken(p.scan, "arg");
    if (tok.type === "WORD" && tok.value === "esac") {
      children.push(tokenNode(p, "esac", tok));
      break;
    }
    if (tok.type === "EOF") {
      break;
    }
    reset(p.scan, saved);
    const item = parseCaseItem(p);
    if (!item) {
      break;
    }
    children.push(item);
  }
  const lastChild = children.at(-1);
  return node(
    p,
    "case_statement",
    caseWord.startIndex,
    lastChild.endIndex,
    children,
  );
}

/**
 * One `[(] PATTERN [| PATTERN]* ) BODY [;;|;&|;;&]` arm of a `case` — upstream `tn`.
 *
 * Alternatives are separated by `|`, and a backslash-newline may appear on either side of
 * that separator (before it after blanks, or immediately after it), so both spots are
 * unwrapped explicitly.
 *
 * The first alternative keeps whatever pieces `parseCasePattern` returned as separate
 * children; a LATER alternative that came back as several pieces is instead folded into
 * one `concatenation` node, and any `extglob_pattern` piece inside it is rewritten to a
 * plain `word` first.
 *
 * The final pass is a fix-up over the already-built child array, not part of the walk: when
 * the arm had no body at all, an `extglob_pattern` child whose text is a bare flag-like run
 * (a `-`, `+`, `?`, `*`, `@` or `!` followed by a letter, and containing no real glob
 * metacharacter) is downgraded in place to a `word`. That is how `case x in -f) ;; esac`
 * keeps `-f` as an ordinary word rather than mistaking it for an extglob.
 */
function parseCaseItem(p) {
  skipBlanks(p.scan);
  const startByte = p.scan.byte;
  const children = [];
  if (peek(p.scan) === "(") {
    const openByte = p.scan.byte;
    advance(p.scan);
    children.push(node(p, "(", openByte, p.scan.byte, []));
  }
  let isFirstAlternative = true;
  while (true) {
    skipBlanks(p.scan);
    const ch = peek(p.scan);
    if (ch === ")" || ch === "") {
      break;
    }
    const parts = parseCasePattern(p);
    if (parts.length === 0) {
      break;
    }
    if (!isFirstAlternative && parts.length > 1) {
      const flattened = parts.map((part) =>
        part.type === "extglob_pattern"
          ? node(p, "word", part.startIndex, part.endIndex, [])
          : part,
      );
      const first = flattened[0];
      const last = flattened.at(-1);
      children.push(
        node(p, "concatenation", first.startIndex, last.endIndex, flattened),
      );
    } else {
      children.push(...parts);
    }
    isFirstAlternative = false;
    skipBlanks(p.scan);
    if (peek(p.scan) === "\\" && peek(p.scan, 1) === "\n") {
      advance(p.scan);
      advance(p.scan);
      skipBlanks(p.scan);
    }
    if (peek(p.scan) === "|") {
      const barByte = p.scan.byte;
      advance(p.scan);
      children.push(node(p, "|", barByte, p.scan.byte, []));
      if (peek(p.scan) === "\\" && peek(p.scan, 1) === "\n") {
        advance(p.scan);
        advance(p.scan);
      }
    } else {
      break;
    }
  }
  if (peek(p.scan) === ")") {
    const closeByte = p.scan.byte;
    advance(p.scan);
    children.push(node(p, ")", closeByte, p.scan.byte, []));
  }
  const body = parseStatements(p, null);
  children.push(...body);
  const savedBeforeTerminator = mark(p.scan);
  const terminator = nextToken(p.scan, "cmd");
  if (
    terminator.type === "OP" &&
    (terminator.value === ";;" ||
      terminator.value === ";&" ||
      terminator.value === ";;&")
  ) {
    children.push(tokenNode(p, terminator.value, terminator));
  } else {
    reset(p.scan, savedBeforeTerminator);
  }
  if (children.length === 0) {
    return null;
  }
  if (body.length === 0) {
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child.type !== "extglob_pattern") {
        continue;
      }
      const text = sliceBytes(p, child.startIndex, child.endIndex);
      if (/^[-+?*@!][a-zA-Z]/.test(text) && !/[*?(]/.test(text)) {
        children[index] = node(
          p,
          "word",
          child.startIndex,
          child.endIndex,
          [],
        );
      }
    }
  }
  const lastChild = children.at(-1);
  return node(p, "case_item", startByte, lastChild.endIndex, children);
}

/**
 * One alternative of a `case` pattern — upstream `sn`.
 *
 * The function scans FIRST and classifies afterwards. The walk consumes escapes, skips over
 * quoted runs, tracks nested parentheses (so that an extglob group such as `@(a|b)` swallows
 * its own `|` and `)` instead of ending the alternative), and stops at the first top-level
 * `)`, `|`, blank or newline. While walking it records three facts: whether a quote was
 * seen, whether a `$` was seen, and whether a `[` was seen.
 *
 * Classification then uses those three flags plus a regex for the extglob opener
 * (`?(`, `*(`, `+(`, `@(` or `!(`). Two of the three outcomes REWIND the scanner to where
 * the walk started and re-parse the same text through a different function:
 *
 * - quoted and not an extglob: rewind, re-scan through `parseQuotedCasePattern`, which
 *   splits the alternative into literal and quoted pieces.
 * - not an extglob but containing `$` or `[`: rewind and let the general word parser handle
 *   the expansion or subscript, returning its single node.
 * - otherwise: emit one node spanning the whole run, typed `extglob_pattern` if it opened an
 *   extglob group, contained `*` or `?`, or looks flag-like, and `word` if not.
 *
 * A walk that consumed no bytes returns an empty array, which is the caller's signal to stop.
 */
function parseCasePattern(p) {
  skipBlanks(p.scan);
  const saved = mark(p.scan);
  const startByte = p.scan.byte;
  const startPos = p.scan.pos;
  let parenDepth = 0;
  let sawDollar = false;
  let sawBracket = false;
  let sawQuote = false;
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
      advance(p.scan);
      advance(p.scan);
      continue;
    }
    if (ch === '"' || ch === "'") {
      sawQuote = true;
      advance(p.scan);
      while (p.scan.pos < p.scan.len && peek(p.scan) !== ch) {
        if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
          advance(p.scan);
        }
        advance(p.scan);
      }
      if (peek(p.scan) === ch) {
        advance(p.scan);
      }
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      advance(p.scan);
      continue;
    }
    if (parenDepth > 0) {
      if (ch === ")") {
        parenDepth--;
        advance(p.scan);
        continue;
      }
      if (ch === "\n") {
        break;
      }
      advance(p.scan);
      continue;
    }
    if (ch === ")" || ch === "|" || ch === " " || ch === "\t" || ch === "\n") {
      break;
    }
    if (ch === "$") {
      sawDollar = true;
    }
    if (ch === "[") {
      sawBracket = true;
    }
    advance(p.scan);
  }
  if (p.scan.byte === startByte) {
    return [];
  }
  const scanned = p.src.slice(startPos, p.scan.pos);
  const hasExtglobOpen = /[*?+@!]\(/.test(scanned);
  if (sawQuote && !hasExtglobOpen) {
    reset(p.scan, saved);
    return parseQuotedCasePattern(p);
  }
  if (!hasExtglobOpen && (sawDollar || sawBracket)) {
    reset(p.scan, saved);
    const word = parseWord(p, "arg");
    return word ? [word] : [];
  }
  const patternType =
    hasExtglobOpen || /[*?]/.test(scanned) || /^[-+?*@!][a-zA-Z]/.test(scanned)
      ? "extglob_pattern"
      : "word";
  return [node(p, patternType, startByte, p.scan.byte, [])];
}

/**
 * Re-scan of a `case` alternative that was found to contain a quote — upstream `rn`.
 *
 * Walks the same run again, but this time cuts it into pieces: each maximal unquoted stretch
 * is flushed as one node (typed `extglob_pattern` when it contains `*` or `?`, otherwise
 * `word`), a double-quoted stretch is delegated to the double-quote parser so its expansions
 * become real children, and a single-quoted stretch becomes a `raw_string` token node. The
 * pending-literal offsets are reset after each quoted piece so the next flush starts there.
 */
function parseQuotedCasePattern(p) {
  const parts = [];
  let segmentStartByte = p.scan.byte;
  let segmentStartPos = p.scan.pos;
  const flushLiteral = () => {
    if (p.scan.pos > segmentStartPos) {
      const text = p.src.slice(segmentStartPos, p.scan.pos);
      const partType = /[*?]/.test(text) ? "extglob_pattern" : "word";
      parts.push(node(p, partType, segmentStartByte, p.scan.byte, []));
    }
  };
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
      advance(p.scan);
      advance(p.scan);
      continue;
    }
    if (ch === '"') {
      flushLiteral();
      parts.push(parseDoubleQuoted(p));
      segmentStartByte = p.scan.byte;
      segmentStartPos = p.scan.pos;
      continue;
    }
    if (ch === "'") {
      flushLiteral();
      const tok = nextToken(p.scan, "arg");
      parts.push(tokenNode(p, "raw_string", tok));
      segmentStartByte = p.scan.byte;
      segmentStartPos = p.scan.pos;
      continue;
    }
    if (ch === ")" || ch === "|" || ch === " " || ch === "\t" || ch === "\n") {
      break;
    }
    advance(p.scan);
  }
  flushLiteral();
  return parts;
}

/**
 * `function NAME [()] BODY` — upstream `on`.
 *
 * The optional empty parameter list is accepted for the bash spelling `function f() { … }`.
 * Upstream reads its `(` through the tokeniser but its `)` straight off the scanner; the two
 * routes yield the same single-character node, so the asymmetry is cosmetic.
 *
 * When the body came back as a `redirected_statement` wrapping a brace group, the wrapper is
 * FLATTENED — its children are spliced directly into the function definition — so that
 * `function f() { … } > out` keeps the redirection as a sibling of the body rather than
 * burying the body one level deeper.
 */
function parseFunctionKeyword(p, keywordToken) {
  const functionWord = tokenNode(p, "function", keywordToken);
  skipBlanks(p.scan);
  const nameToken = nextToken(p.scan, "arg");
  const nameNode = node(p, "word", nameToken.start, nameToken.end, []);
  const children = [functionWord, nameNode];
  skipBlanks(p.scan);
  if (peek(p.scan) === "(" && peek(p.scan, 1) === ")") {
    const openToken = nextToken(p.scan, "cmd");
    children.push(tokenNode(p, "(", openToken));
    const closeByte = p.scan.byte;
    advance(p.scan);
    children.push(node(p, ")", closeByte, p.scan.byte, []));
  }
  skipBlanks(p.scan);
  skipNewlines(p);
  const bodyUnit = parseCommandUnit(p);
  if (bodyUnit) {
    if (
      bodyUnit.type === "redirected_statement" &&
      bodyUnit.children.length >= 2 &&
      bodyUnit.children[0].type === "compound_statement"
    ) {
      children.push(...bodyUnit.children);
    } else {
      children.push(bodyUnit);
    }
  }
  const lastChild = children.at(-1);
  return node(
    p,
    "function_definition",
    functionWord.startIndex,
    lastChild.endIndex,
    children,
  );
}

/**
 * `export` / `declare` / `typeset` / `readonly` / `local` — upstream `Ln`.
 *
 * Shares its shape with `parseUnsetCommand`: run one loop that collects the command's own
 * children (assignments and words) into one array and any redirections into a SEPARATE
 * array, build the command node from the first array alone, and then — only if a redirection
 * was seen — wrap that node in a `redirected_statement` whose end offset is the larger of
 * the command's end and the last redirection's end, since a redirection may sit either side
 * of the arguments.
 *
 * A bare argument is classified three ways: anything starting with `-` is an option `word`;
 * anything else starting with a name character is a `variable_name` (so `declare x` marks
 * `x` as a variable even without a value); everything else is a plain `word`.
 */
function parseDeclarationCommand(p, keywordToken) {
  const keyword = tokenNode(p, keywordToken.value, keywordToken);
  const children = [keyword];
  const redirects = [];
  while (true) {
    skipBlanks(p.scan);
    const redirect = parseRedirect(p);
    if (redirect) {
      redirects.push(redirect);
      continue;
    }
    const ch = peek(p.scan);
    if (
      ch === "" ||
      ch === "\n" ||
      ch === ";" ||
      ch === "&" ||
      ch === "|" ||
      ch === ")" ||
      ch === "<" ||
      ch === ">"
    ) {
      break;
    }
    const assignment = parseVariableAssignment(p);
    if (assignment) {
      children.push(assignment);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "$") {
      const word = parseWord(p, "arg");
      if (word) {
        children.push(word);
        continue;
      }
      break;
    }
    const saved = mark(p.scan);
    const tok = nextToken(p.scan, "arg");
    if (tok.type === "WORD" || tok.type === "NUMBER") {
      if (tok.value.startsWith("-")) {
        children.push(tokenNode(p, "word", tok));
      } else if (isNameStart(tok.value[0] ?? "")) {
        children.push(node(p, "variable_name", tok.start, tok.end, []));
      } else {
        children.push(tokenNode(p, "word", tok));
      }
    } else {
      reset(p.scan, saved);
      break;
    }
  }
  const lastChild = children.at(-1);
  const command = node(
    p,
    "declaration_command",
    keyword.startIndex,
    lastChild.endIndex,
    children,
  );
  if (redirects.length === 0) {
    return command;
  }
  const lastRedirect = redirects.at(-1);
  const endIndex = Math.max(command.endIndex, lastRedirect.endIndex);
  return node(p, "redirected_statement", keyword.startIndex, endIndex, [
    command,
    ...redirects,
  ]);
}

/**
 * `unset [-fv] NAME…` — upstream `cn`.
 *
 * Same two-array shape as `parseDeclarationCommand` above. Two differences: arguments go
 * through the general word parser rather than the tokeniser, and a bare `(` terminates the
 * loop after recording a one-byte `variable_name` at the current position — a stand-in for
 * the malformed name, emitted so the node still has an argument.
 */
function parseUnsetCommand(p, keywordToken) {
  const keyword = tokenNode(p, "unset", keywordToken);
  const children = [keyword];
  const redirects = [];
  while (true) {
    skipBlanks(p.scan);
    const redirect = parseRedirect(p);
    if (redirect) {
      redirects.push(redirect);
      continue;
    }
    const ch = peek(p.scan);
    if (ch === "(") {
      children.push(
        node(p, "variable_name", p.scan.byte, p.scan.byte + 1, []),
      );
      break;
    }
    if (
      ch === "" ||
      ch === "\n" ||
      ch === ";" ||
      ch === "&" ||
      ch === "|" ||
      ch === ")" ||
      ch === "<" ||
      ch === ">"
    ) {
      break;
    }
    const word = parseWord(p, "arg");
    if (!word) {
      break;
    }
    if (word.type === "word") {
      if (word.text.startsWith("-")) {
        children.push(word);
      } else {
        children.push(
          node(p, "variable_name", word.startIndex, word.endIndex, []),
        );
      }
    } else {
      children.push(word);
    }
  }
  const lastChild = children.at(-1);
  const command = node(
    p,
    "unset_command",
    keyword.startIndex,
    lastChild.endIndex,
    children,
  );
  if (redirects.length === 0) {
    return command;
  }
  const lastRedirect = redirects.at(-1);
  const endIndex = Math.max(command.endIndex, lastRedirect.endIndex);
  return node(p, "redirected_statement", keyword.startIndex, endIndex, [
    command,
    ...redirects,
  ]);
}

/**
 * Consume a required keyword, or recover by pretending it was never required — upstream `X`.
 *
 * This is the whole error-recovery strategy for every construct in this region. Newlines
 * before the keyword are skipped; the scanner position is then marked and one token pulled.
 * If it is the expected keyword, a node for it is appended to `out`. If it is not, the
 * scanner is REWOUND to the mark and NOTHING is appended — the statement is simply short a
 * child, and the next parser up sees the unconsumed token.
 *
 * Because a construct can therefore be missing any of its keyword children, no caller may
 * assume a fixed child count: they all read the end offset off `children.at(-1)`.
 */
function expectKeyword(p, keyword, out) {
  skipNewlines(p);
  const saved = mark(p.scan);
  const tok = nextToken(p.scan, "cmd");
  if (tok.type === "WORD" && tok.value === keyword) {
    out.push(tokenNode(p, keyword, tok));
  } else {
    reset(p.scan, saved);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. THE TEST-EXPRESSION GRAMMAR OF [ … ] AND [[ … ]]
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Region 8 - the test-expression grammar: everything between `[ ... ]` and
// `[[ ... ]]`.
//
// Every function here takes a `closer` argument that is either the string "]"
// or the string "]]". It is not cosmetic bookkeeping about which bracket has to
// show up at the end: bash gives `[[ ... ]]` a strictly richer grammar than the
// old `[ ... ]` builtin, and `closer` is how this parser knows which grammar it
// is in. Only inside `[[ ]]` are `&&` and `||` operators (inside `[ ]` they end
// the whole command), only there are `<` and `>` comparisons (inside `[ ]` they
// are redirections), only there may an expression span newlines and carry `#`
// comments, and only there do `==`, `!=` and `=~` take a pattern or a regex on
// the right instead of an ordinary word. Each function below therefore guards
// its `[[ ]]`-only behaviour with `closer === "]]"`; that is the single reason,
// and it is not repeated at each site.
// ---------------------------------------------------------------------------

/**
 * Entry point for the contents of a test bracket. Upstream `ve`.
 *
 * The grammar is a plain precedence cascade - `||` binds loosest, then `&&`,
 * then grouping, then unary and binary operators - so the entry point is just
 * the loosest level.
 */
function parseTestExpression(p, closer) {
  return parseTestOr(p, closer);
}

/**
 * The `||` level of the cascade. Upstream `de`.
 *
 * Left-associative: each successful `||` folds the accumulated tree so far into
 * the left child of a new binary_expression. The mark taken before looking at
 * the operator is what lets a trailing `||` with nothing usable after it be
 * handed back to the caller untouched rather than consumed - the scanner is
 * rewound to just before the `||` and the loop ends.
 */
function parseTestOr(p, closer) {
  let left = parseTestAnd(p, closer);
  if (!left) return null;
  while (true) {
    skipBlanks(p.scan);
    const beforeOperator = mark(p.scan);
    if (closer === "]]" && peek(p.scan) === "|" && peek(p.scan, 1) === "|") {
      const operatorStart = p.scan.byte;
      advance(p.scan);
      advance(p.scan);
      const operator = node(p, "||", operatorStart, p.scan.byte, []);
      skipTestSpace(p, closer);
      const right = parseTestAnd(p, closer);
      if (!right) {
        reset(p.scan, beforeOperator);
        break;
      }
      left = node(p, "binary_expression", left.startIndex, right.endIndex, [
        left,
        operator,
        right,
      ]);
    } else {
      break;
    }
  }
  return left;
}

/**
 * The `&&` level of the cascade. Upstream `ye`.
 *
 * Structurally identical to parseTestOr one level down, with the same rewind on
 * a dangling operator.
 */
function parseTestAnd(p, closer) {
  let left = parseTestGroup(p, closer);
  if (!left) return null;
  while (true) {
    skipBlanks(p.scan);
    const beforeOperator = mark(p.scan);
    if (closer === "]]" && peek(p.scan) === "&" && peek(p.scan, 1) === "&") {
      const operatorStart = p.scan.byte;
      advance(p.scan);
      advance(p.scan);
      const operator = node(p, "&&", operatorStart, p.scan.byte, []);
      skipTestSpace(p, closer);
      const right = parseTestGroup(p, closer);
      if (!right) {
        reset(p.scan, beforeOperator);
        break;
      }
      left = node(p, "binary_expression", left.startIndex, right.endIndex, [
        left,
        operator,
        right,
      ]);
    } else {
      break;
    }
  }
  return left;
}

/**
 * Skip whitespace between the pieces of a test expression. Upstream `re`.
 *
 * Always skips blanks. Additionally, inside `[[ ]]` only, a test expression may
 * be broken across raw newlines and may carry `#` comments, so those are
 * consumed too; the loop alternates because a comment ends at a newline and a
 * newline may be followed by more indentation or another comment.
 */
function skipTestSpace(p, closer) {
  skipBlanks(p.scan);
  if (closer === "]]") {
    while (true) {
      const ch = peek(p.scan);
      if (ch === "\n") {
        advance(p.scan);
        skipBlanks(p.scan);
      } else if (ch === "#") {
        while (peek(p.scan) && peek(p.scan) !== "\n") {
          advance(p.scan);
        }
      } else {
        break;
      }
    }
  }
}

/**
 * A parenthesised sub-expression, or a fall-through to the operator ladder.
 * Upstream `ge`.
 *
 * The closing paren is always represented in the tree even when the input never
 * supplied one: an empty `)` node is synthesised at the current position so the
 * parenthesized_expression still has a well-formed shape and an end offset.
 */
function parseTestGroup(p, closer) {
  skipTestSpace(p, closer);
  if (peek(p.scan) === "(") {
    const openStart = p.scan.byte;
    advance(p.scan);
    const open = node(p, "(", openStart, p.scan.byte, []);
    const body = parseTestOr(p, closer);
    skipBlanks(p.scan);
    let close;
    if (peek(p.scan) === ")") {
      const closeStart = p.scan.byte;
      advance(p.scan);
      close = node(p, ")", closeStart, p.scan.byte, []);
    } else {
      close = node(p, ")", p.scan.byte, p.scan.byte, []);
    }
    const children = body ? [open, body, close] : [open, close];
    return node(
      p,
      "parenthesized_expression",
      open.startIndex,
      close.endIndex,
      children,
    );
  }
  return parseTestBinary(p, closer);
}

/**
 * Prefix `!`, a parenthesised group, a unary file/string test such as `-f` or
 * `-z`, or an ordinary operand. Upstream `Ee`.
 *
 * Three details carry weight:
 *
 * - `!` is only negation when what follows is a blank, a newline, end of input,
 *   or `(`. Otherwise it is an ordinary character of a word (`!=` reaches here
 *   as a word, for instance) and is left alone.
 * - `-f` is only a unary operator when the whole run of name characters is
 *   followed by a boundary. `-foo` is a word, not the operator `-foo`, so the
 *   scanner is rewound and the text is re-read as an operand.
 * - When a unary operator has no operand after it, the text that was skipped
 *   decides the outcome. If it was nothing but blanks and backslash-newline
 *   line continuations, the operator alone is the whole expression (that is
 *   `[[ -f ]]`, where `-f` is being tested as a string). If anything else was
 *   skipped, something was there and could not be parsed, so an explicit
 *   test_rhs_missing node records the gap.
 */
function parseTestUnary(p, closer) {
  skipTestSpace(p, closer);
  const ch = peek(p.scan);
  const isBoundary = (candidate) =>
    candidate === " " ||
    candidate === "\t" ||
    candidate === "\n" ||
    candidate === "";
  if (ch === "!" && (isBoundary(peek(p.scan, 1)) || peek(p.scan, 1) === "(")) {
    const bangStart = p.scan.byte;
    advance(p.scan);
    const bang = node(p, "!", bangStart, p.scan.byte, []);
    const operand = parseTestUnary(p, closer);
    if (!operand) return bang;
    return node(p, "unary_expression", bang.startIndex, operand.endIndex, [
      bang,
      operand,
    ]);
  }
  if (ch === "(") {
    const openStart = p.scan.byte;
    advance(p.scan);
    const open = node(p, "(", openStart, p.scan.byte, []);
    const body = parseTestOr(p, closer);
    skipBlanks(p.scan);
    let close;
    if (peek(p.scan) === ")") {
      const closeStart = p.scan.byte;
      advance(p.scan);
      close = node(p, ")", closeStart, p.scan.byte, []);
    } else {
      close = node(p, ")", p.scan.byte, p.scan.byte, []);
    }
    const children = body ? [open, body, close] : [open, close];
    return node(
      p,
      "parenthesized_expression",
      open.startIndex,
      close.endIndex,
      children,
    );
  }
  if (ch === "-" && isNameStart(peek(p.scan, 1))) {
    const beforeOperator = mark(p.scan);
    const operatorStart = p.scan.byte;
    advance(p.scan);
    while (isNameChar(peek(p.scan))) {
      advance(p.scan);
    }
    if (!isBoundary(peek(p.scan))) {
      reset(p.scan, beforeOperator);
      return parseTestOperand(p, closer);
    }
    const operator = node(p, "test_operator", operatorStart, p.scan.byte, []);
    const afterOperator = p.scan.pos;
    skipBlanks(p.scan);
    const operand = parseTestOperand(p, closer);
    if (!operand) {
      const skipped = p.src.slice(afterOperator, p.scan.pos);
      if (!/^(?:[ \t]|\\\n)*$/.test(skipped)) {
        const missing = node(
          p,
          "test_rhs_missing",
          operator.endIndex,
          p.scan.byte,
          [],
        );
        return node(p, "unary_expression", operator.startIndex, p.scan.byte, [
          operator,
          missing,
        ]);
      }
      return operator;
    }
    return node(p, "unary_expression", operator.startIndex, operand.endIndex, [
      operator,
      operand,
    ]);
  }
  return parseTestOperand(p, closer);
}

/**
 * Build the node for "there was a left operand and an operator, and then
 * nothing usable". Upstream `P`.
 *
 * The gap itself becomes a zero-or-more-width test_rhs_missing child spanning
 * from the end of the operator to wherever the scanner now stands, so a
 * consumer can point at the position where the right-hand side should have
 * been.
 */
function binaryWithMissingRhs(p, left, operator) {
  const missing = node(
    p,
    "test_rhs_missing",
    operator.endIndex,
    p.scan.byte,
    [],
  );
  return node(p, "binary_expression", left.startIndex, p.scan.byte, [
    left,
    operator,
    missing,
  ]);
}

/**
 * The operator ladder: an operand, optionally an infix operator, optionally a
 * right-hand side. Upstream `ln`.
 *
 * The ladder recognises `==`, `!=`, `=~`, a bare `=`, `<` and `>` (the last two
 * only inside `[[ ]]`, since inside `[ ]` they are redirections), and the
 * dashed word operators such as `-eq` and `-nt`. When none of them matches, the
 * left operand alone is the expression.
 *
 * What the right-hand side is parsed as depends on the operator, and only
 * inside `[[ ]]`:
 *
 * - after `=~` it is a regular expression, which has its own lexical rules and
 *   is not subject to word splitting or globbing;
 * - after `=` it is also scanned as a regex-shaped run, but with `|` treated as
 *   a terminator;
 * - after `==` or `!=` it is a glob pattern, which may be several adjacent
 *   pieces (literal text, quoted strings, expansions) and so yields a list of
 *   children rather than one;
 * - otherwise it is an ordinary word.
 */
function parseTestBinary(p, closer) {
  skipBlanks(p.scan);
  const left = parseTestUnary(p, closer);
  if (!left) return null;
  skipBlanks(p.scan);
  const ch = peek(p.scan);
  const next = peek(p.scan, 1);
  let operator = null;
  const operatorStart = p.scan.byte;
  if (ch === "=" && next === "=") {
    advance(p.scan);
    advance(p.scan);
    operator = node(p, "==", operatorStart, p.scan.byte, []);
  } else if (ch === "!" && next === "=") {
    advance(p.scan);
    advance(p.scan);
    operator = node(p, "!=", operatorStart, p.scan.byte, []);
  } else if (ch === "=" && next === "~") {
    advance(p.scan);
    advance(p.scan);
    operator = node(p, "=~", operatorStart, p.scan.byte, []);
  } else if (ch === "=" && next !== "=") {
    advance(p.scan);
    operator = node(p, "=", operatorStart, p.scan.byte, []);
  } else if (closer === "]]" && ch === "<" && next !== "<") {
    advance(p.scan);
    operator = node(p, "<", operatorStart, p.scan.byte, []);
  } else if (closer === "]]" && ch === ">" && next !== ">") {
    advance(p.scan);
    operator = node(p, ">", operatorStart, p.scan.byte, []);
  } else if (ch === "-" && isNameStart(next)) {
    advance(p.scan);
    while (isNameChar(peek(p.scan))) {
      advance(p.scan);
    }
    operator = node(p, "test_operator", operatorStart, p.scan.byte, []);
  }
  if (!operator) return left;
  skipBlanks(p.scan);
  if (closer === "]]") {
    const operatorType = operator.type;
    if (operatorType === "=~") {
      skipBlanks(p.scan);
      const quote = peek(p.scan);
      let right = null;
      if (quote === '"' || quote === "'") {
        // A quoted right-hand side after `=~` is ambiguous. In `[[ $x =~ "a b" ]]`
        // the quoted string is the entire regex and the quoting is meaningful
        // (it makes the contents literal). In `[[ $x =~ "a"b+ ]]` the quote is
        // only the first piece of a longer regex. Parse it as a quoted string
        // first, then look at what comes next: if the only thing between the
        // closing quote and the end of the expression is blanks, the quote was
        // the whole operand and the parsed string is kept. Otherwise the
        // scanner is rewound and the whole run is rescanned as one regex.
        const beforeQuote = mark(p.scan);
        const quoted =
          quote === '"'
            ? parseDoubleQuoted(p)
            : tokenNode(p, "raw_string", nextToken(p.scan, "arg"));
        const afterQuote = p.scan.pos;
        // Walk past the blanks that follow the closing quote...
        let firstIndex = afterQuote;
        while (
          firstIndex < p.scan.len &&
          (p.src[firstIndex] === " " || p.src[firstIndex] === "\t")
        ) {
          firstIndex++;
        }
        const firstChar = p.src[firstIndex] ?? "";
        // ...then, starting just after that character, past any run of
        // backslash-newline line continuations, so that a two-character
        // terminator split across a line break - `]` backslash newline `]` -
        // is still recognised as `]]`. Both the bare-newline and the CRLF
        // spelling of a continuation count.
        let secondIndex = firstIndex + 1;
        while (p.src[secondIndex] === "\\") {
          if (p.src[secondIndex + 1] === "\n") {
            secondIndex += 2;
          } else if (
            p.src[secondIndex + 1] === "\r" &&
            p.src[secondIndex + 2] === "\n"
          ) {
            secondIndex += 3;
          } else {
            break;
          }
        }
        const secondChar = p.src[secondIndex] ?? "";
        // The quote was the whole operand if what follows it ends the
        // expression: the closing `]]`, a `&&` or `||` connective, a newline,
        // or end of input. The `firstIndex > afterQuote` guards require that at
        // least one blank separated the quote from `]]` or `||`, because
        // `"a"]]` with no space is one longer regex, not a terminated operand.
        if (
          (firstChar === "]" && secondChar === "]" && firstIndex > afterQuote) ||
          (firstChar === "&" && secondChar === "&") ||
          (firstChar === "|" && secondChar === "|" && firstIndex > afterQuote) ||
          firstChar === "\n" ||
          firstChar === ""
        ) {
          right = quoted;
        } else {
          reset(p.scan, beforeQuote);
        }
      }
      if (!right) right = parseTestRegex(p, true);
      if (!right) return binaryWithMissingRhs(p, left, operator);
      return node(p, "binary_expression", left.startIndex, right.endIndex, [
        left,
        operator,
        right,
      ]);
    }
    if (operatorType === "=") {
      const right = parseTestRegex(p, false);
      if (!right) return binaryWithMissingRhs(p, left, operator);
      return node(p, "binary_expression", left.startIndex, right.endIndex, [
        left,
        operator,
        right,
      ]);
    }
    if (operatorType === "==" || operatorType === "!=") {
      const patternWords = parseTestPatternWords(p);
      if (patternWords.length === 0) {
        return binaryWithMissingRhs(p, left, operator);
      }
      const last = patternWords.at(-1);
      return node(p, "binary_expression", left.startIndex, last.endIndex, [
        left,
        operator,
        ...patternWords,
      ]);
    }
  }
  const right = parseTestOperand(p, closer);
  if (!right) return binaryWithMissingRhs(p, left, operator);
  return node(p, "binary_expression", left.startIndex, right.endIndex, [
    left,
    operator,
    right,
  ]);
}

/**
 * Scan one regular expression operand as a single flat `regex` node. Upstream
 * `Ie`.
 *
 * A regex on the right of `=~` is not a shell word: it is taken almost
 * verbatim, so this only tracks enough structure to know where it ends. It
 * counts parenthesis nesting (a regex group may legitimately contain a space or
 * a newline), steps over backslash escapes as a unit, and steps over quoted
 * spans and backtick spans wholesale.
 *
 * At nesting depth zero the operand ends at a blank, at `&`, at `)`, and - only
 * when `allowPipe` is false - at `|`. `allowPipe` is true for `=~`, where `|`
 * is regex alternation, and false for `=`, where it would be a pipe.
 *
 * Emptiness is judged by byte offset rather than by an explicit flag: if the
 * scanner did not move, there was no operand.
 */
function parseTestRegex(p, allowPipe) {
  skipBlanks(p.scan);
  const start = p.scan.byte;
  let depth = 0;
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
      advance(p.scan);
      advance(p.scan);
      continue;
    }
    if (ch === "\n") {
      if (depth === 0) break;
      advance(p.scan);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      advance(p.scan);
      while (p.scan.pos < p.scan.len && peek(p.scan) !== quote) {
        if (
          quote === '"' &&
          peek(p.scan) === "\\" &&
          p.scan.pos + 1 < p.scan.len
        ) {
          advance(p.scan);
        }
        advance(p.scan);
      }
      if (p.scan.pos < p.scan.len) advance(p.scan);
      continue;
    }
    if (ch === "`") {
      advance(p.scan);
      while (p.scan.pos < p.scan.len && peek(p.scan) !== "`") {
        if (peek(p.scan) === "\\" && p.scan.pos + 1 < p.scan.len) {
          advance(p.scan);
        }
        advance(p.scan);
      }
      if (p.scan.pos < p.scan.len) advance(p.scan);
      continue;
    }
    if (depth === 0) {
      if (ch === " " || ch === "\t") break;
      if (ch === "&" || (!allowPipe && ch === "|")) break;
      if (ch === ")") break;
    }
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    advance(p.scan);
  }
  if (p.scan.byte === start) return null;
  return node(p, "regex", start, p.scan.byte, []);
}

/**
 * Scan the glob pattern on the right of `==` or `!=` as a list of adjacent
 * pieces. Upstream `an`.
 *
 * Unlike a regex, a pattern is still subject to expansion, so the pieces that
 * expand - `$'...'`, `$"..."`, `$(...)`, `${...}`, `$name`, double-quoted
 * strings, single-quoted strings, backticks, and process substitutions - are
 * parsed by their own parsers and pushed as their own nodes. The plain text
 * between them accumulates and is flushed by `flushLiteral` whenever one of
 * those pieces starts and once more at the end. A run of plain text that is
 * entirely digits is tagged `number`, everything else `extglob_pattern`, which
 * is what lets `[[ $x == 42 ]]` and `[[ $x == a* ]]` be told apart downstream.
 *
 * `segmentStartByte` and `segmentStartPos` track the start of the current run
 * of plain text in both coordinate systems at once; they are reset after every
 * flushed piece.
 *
 * Parenthesis depth is tracked because extglob constructs such as `@(a|b)` may
 * contain the very characters that would otherwise end the pattern.
 */
function parseTestPatternWords(p) {
  skipBlanks(p.scan);
  const words = [];
  let segmentStartByte = p.scan.byte;
  let segmentStartPos = p.scan.pos;
  let depth = 0;
  const flushLiteral = () => {
    if (p.scan.pos > segmentStartPos) {
      const text = p.src.slice(segmentStartPos, p.scan.pos);
      const type = /^\d+$/.test(text) ? "number" : "extglob_pattern";
      words.push(node(p, type, segmentStartByte, p.scan.byte, []));
    }
  };
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (ch === "\\" && p.scan.pos + 1 < p.scan.len) {
      advance(p.scan);
      advance(p.scan);
      continue;
    }
    if (ch === "\n") {
      if (depth === 0) break;
      advance(p.scan);
      continue;
    }
    if (depth === 0) {
      if (ch === "&" || ch === "|") break;
      if (ch === " " || ch === "\t") {
        // A blank inside a pattern does not automatically end it: bash lets a
        // pattern be written with embedded blanks so long as the expression has
        // not finished. Look past the whole run of blanks and line
        // continuations to the first real character; if that character starts
        // the end of the expression - `]]`, `&&`, `||`, a comment, or a newline
        // - the pattern stops here. Otherwise the blank is part of the pattern
        // and is consumed.
        //
        // This deliberately differs from the lookahead after a quoted `=~`
        // operand above: that one walks only blanks (not continuations) in its
        // first phase, is bounded by the scanner length, does not treat `#` as
        // a terminator, and requires a separating blank before `]]` or `||`.
        // The two are not interchangeable.
        let firstIndex = p.scan.pos;
        while (true) {
          const scanned = p.scan.src[firstIndex];
          if (scanned === " " || scanned === "\t") {
            firstIndex++;
          } else if (scanned === "\\" && p.scan.src[firstIndex + 1] === "\n") {
            firstIndex += 2;
          } else if (
            scanned === "\\" &&
            p.scan.src[firstIndex + 1] === "\r" &&
            p.scan.src[firstIndex + 2] === "\n"
          ) {
            firstIndex += 3;
          } else {
            break;
          }
        }
        const firstChar = p.scan.src[firstIndex] ?? "";
        let secondIndex = firstIndex + 1;
        while (p.scan.src[secondIndex] === "\\") {
          if (p.scan.src[secondIndex + 1] === "\n") {
            secondIndex += 2;
          } else if (
            p.scan.src[secondIndex + 1] === "\r" &&
            p.scan.src[secondIndex + 2] === "\n"
          ) {
            secondIndex += 3;
          } else {
            break;
          }
        }
        const secondChar = p.scan.src[secondIndex] ?? "";
        if (
          (firstChar === "]" && secondChar === "]") ||
          (firstChar === "&" && secondChar === "&") ||
          (firstChar === "|" && secondChar === "|") ||
          firstChar === "#" ||
          firstChar === "\n"
        ) {
          break;
        }
        advance(p.scan);
        continue;
      }
    }
    if (ch === "$") {
      const after = peek(p.scan, 1);
      if (after === "'") {
        flushLiteral();
        const token = nextToken(p.scan, "arg");
        words.push(tokenNode(p, "ansi_c_string", token));
        segmentStartByte = p.scan.byte;
        segmentStartPos = p.scan.pos;
        continue;
      }
      if (after === '"') {
        flushLiteral();
        // `$"..."` is a locale-translated string. The `$` becomes its own node
        // and the rest is an ordinary double-quoted string, so the token for
        // the `$` is synthesised by hand before the scanner moves past it.
        const dollarToken = {
          type: "DOLLAR",
          value: "$",
          start: p.scan.byte,
          end: p.scan.byte + 1,
        };
        advance(p.scan);
        words.push(tokenNode(p, "$", dollarToken));
        words.push(parseDoubleQuoted(p));
        segmentStartByte = p.scan.byte;
        segmentStartPos = p.scan.pos;
        continue;
      }
      if (
        after === "(" ||
        after === "{" ||
        isNameStart(after) ||
        SPECIAL_VARIABLE_NAMES.has(after)
      ) {
        flushLiteral();
        const expansion = parseDollar(p);
        if (expansion) words.push(expansion);
        segmentStartByte = p.scan.byte;
        segmentStartPos = p.scan.pos;
        continue;
      }
    }
    if (ch === '"') {
      flushLiteral();
      words.push(parseDoubleQuoted(p));
      segmentStartByte = p.scan.byte;
      segmentStartPos = p.scan.pos;
      continue;
    }
    if (ch === "'") {
      flushLiteral();
      const token = nextToken(p.scan, "arg");
      words.push(tokenNode(p, "raw_string", token));
      segmentStartByte = p.scan.byte;
      segmentStartPos = p.scan.pos;
      continue;
    }
    if (ch === "`") {
      flushLiteral();
      const backtick = parseBacktick(p);
      if (backtick) words.push(backtick);
      segmentStartByte = p.scan.byte;
      segmentStartPos = p.scan.pos;
      continue;
    }
    if ((ch === "<" || ch === ">") && peek(p.scan, 1) === "(") {
      flushLiteral();
      const substitution = parseProcessSubstitution(p);
      if (substitution) words.push(substitution);
      segmentStartByte = p.scan.byte;
      segmentStartPos = p.scan.pos;
      continue;
    }
    if (ch === ")" && depth === 0) break;
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    advance(p.scan);
  }
  flushLiteral();
  return words;
}

/**
 * Read one ordinary operand of a test expression. Upstream `ee`.
 *
 * The only job beyond delegating to the general word parser is refusing to
 * swallow the bracket that closes the expression. Inside `[ ]` a lone `]` ends
 * the command, but only if what follows it is itself a delimiter - `]x` is a
 * word. Inside `[[ ]]` the same applies to `]]`, except that a `(` after it
 * does not count as a delimiter, which is why the paren-excluding test is used
 * there.
 */
function parseTestOperand(p, closer) {
  skipBlanks(p.scan);
  if (
    closer === "]" &&
    peek(p.scan) === "]" &&
    isDelimiter(peek(p.scan, 1) ?? "")
  ) {
    return null;
  }
  if (
    closer === "]]" &&
    peek(p.scan) === "]" &&
    peek(p.scan, 1) === "]" &&
    isDelimiterExceptParen(peek(p.scan, 2) ?? "")
  ) {
    return null;
  }
  return parseWord(p, "arg");
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. ARITHMETIC EXPRESSIONS, AND THE MODULE'S PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Operator precedence inside arithmetic expressions (`$(( … ))`, `(( … ))`,
 * array subscripts). Upstream `un`.
 *
 * A larger number binds tighter. Assignment sits at the bottom, so `a = b || c`
 * groups as `a = (b || c)`. There is deliberately no entry for `,` or for the
 * ternary `?:` — the comma list is handled by parseArithmeticList and the
 * ternary by parseTernary, both of which sit outside this table and around it.
 */
const ARITHMETIC_PRECEDENCE = {
  "=": 2,
  "+=": 2,
  "-=": 2,
  "*=": 2,
  "/=": 2,
  "%=": 2,
  "<<=": 2,
  ">>=": 2,
  "&=": 2,
  "^=": 2,
  "|=": 2,
  "||": 4,
  "&&": 5,
  "|": 6,
  "^": 7,
  "&": 8,
  "==": 9,
  "!=": 9,
  "<": 10,
  ">": 10,
  "<=": 10,
  ">=": 10,
  "<<": 11,
  ">>": 11,
  "+": 12,
  "-": 12,
  "*": 13,
  "/": 13,
  "%": 13,
  "**": 14,
};

/**
 * The arithmetic operators that group to the right. Upstream `fn`.
 *
 * Every assignment form, plus exponentiation. parseArithmeticBinary consults
 * this set to decide whether the right-hand operand is allowed to swallow
 * another operator of the same precedence, which is what makes `a = b = c` mean
 * `a = (b = c)` and `2 ** 3 ** 2` mean `2 ** (3 ** 2)`.
 */
const RIGHT_ASSOCIATIVE_OPERATORS = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "<<=",
  ">>=",
  "&=",
  "^=",
  "|=",
  "**",
]);

/**
 * Error recovery for a malformed arithmetic body: rewind to `savedMark`, then
 * run the cursor forward until it sits ON the character that closes the
 * expression. Upstream `Te`.
 *
 * A caller that failed to parse a `$(( … ))` or `[ … ]` body uses this to find
 * where that body ends, so the remainder of the command can still be parsed.
 * For the bracket closers it counts nesting depth, so an inner `(a)` or `[i]`
 * does not look like the end; for every other closer it asks atArithmeticClose.
 * If the input runs out first the cursor simply stops at the end.
 */
function skipToArithmeticClose(p, savedMark, closer) {
  reset(p.scan, savedMark);
  let depth = 0;
  while (p.scan.pos < p.scan.len) {
    const ch = peek(p.scan);
    if (closer === "))" || closer === ")") {
      if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        if (depth === 0) {
          if (closer === ")" || peek(p.scan, 1) === ")") return;
        } else {
          depth--;
        }
      }
    } else if (closer === "]") {
      if (ch === "[") {
        depth++;
      } else if (ch === "]") {
        if (depth === 0) return;
        depth--;
      }
    } else if (atArithmeticClose(p, closer)) {
      return;
    }
    advance(p.scan);
  }
}

/**
 * Parse one arithmetic expression. Upstream `te`.
 *
 * `closer` names the character or characters that end the expression; see
 * atArithmeticClose for the accepted values. `mode` decides what a bare
 * identifier means: "var" makes it a `variable_name`, "word" makes it a `word`,
 * and "assign" additionally lets `name = …` become a `variable_assignment`.
 *
 * The whole arithmetic grammar is a chain of parsers, loosest binding first:
 * ternary, then binary (precedence climbing), then unary, then postfix, then
 * primary. This is the entry point at the top of that chain.
 */
function parseArithmetic(p, closer, mode = "var") {
  return parseTernary(p, closer, mode);
}

/**
 * Parse a comma-separated series of arithmetic expressions, such as the three
 * clauses of a C-style `for (( … ; … ; … ))`. Upstream `V`.
 *
 * A clause is allowed to be empty, as in `for ((;;))`, so an expression that
 * comes back null is simply not collected rather than ending the series. The
 * loop continues only on a comma that is not itself acting as the closer.
 */
function parseArithmeticList(p, closer, mode = "var") {
  const items = [];
  while (true) {
    const item = parseTernary(p, closer, mode);
    if (item) items.push(item);
    skipBlanks(p.scan);
    if (peek(p.scan) === "," && !atArithmeticClose(p, closer)) {
      advance(p.scan);
      continue;
    }
    break;
  }
  return items;
}

/**
 * Parse `condition ? consequent : alternate`. Upstream `Y`.
 *
 * The condition is a binary expression; if no `?` follows, that expression is
 * the whole result and this layer is invisible. The consequent is parsed with
 * ":" as its closer so it stops at the colon. The alternate recurses into
 * parseTernary with the ORIGINAL closer, which is what makes nested ternaries
 * group to the right.
 *
 * Both the `?` and the `:` become nodes of their own so the tree can be printed
 * back verbatim. When the `:` is missing — a malformed expression — an empty
 * `:` node is synthesised at the cursor rather than failing, so the surrounding
 * command still parses.
 */
function parseTernary(p, closer, mode) {
  const condition = parseArithmeticBinary(p, closer, 0, mode);
  if (!condition) return null;
  skipBlanks(p.scan);
  if (peek(p.scan) === "?") {
    const questionByte = p.scan.byte;
    advance(p.scan);
    const questionNode = node(p, "?", questionByte, p.scan.byte, []);
    const consequent = parseArithmeticBinary(p, ":", 0, mode);
    skipBlanks(p.scan);
    let colonNode;
    if (peek(p.scan) === ":") {
      const colonByte = p.scan.byte;
      advance(p.scan);
      colonNode = node(p, ":", colonByte, p.scan.byte, []);
    } else {
      colonNode = node(p, ":", p.scan.byte, p.scan.byte, []);
    }
    const alternate = parseTernary(p, closer, mode);
    const endNode = alternate ?? colonNode;
    const children = [condition, questionNode];
    if (consequent) children.push(consequent);
    children.push(colonNode);
    if (alternate) children.push(alternate);
    return node(
      p,
      "ternary_expression",
      condition.startIndex,
      endNode.endIndex,
      children,
    );
  }
  return condition;
}

/**
 * Identify the arithmetic operator sitting at the cursor, without consuming it.
 * Upstream `dn`. Returns `[operator, charactersConsumed]`, or null when what is
 * at the cursor is not an operator.
 *
 * The ladder is ordered longest form first, so a short operator never wins over
 * the longer one it is a prefix of: `<<=` is tried before `<<`, which is tried
 * before `<`. The last arms are the reason the order matters most — plain `+`
 * matches only when the following character is not another `+`, and likewise
 * for `-`, so that `++` and `--` are left alone for the unary and postfix
 * parsers instead of being read as two consecutive additions. Do not reorder.
 */
function readArithmeticOperator(p) {
  const ch = peek(p.scan);
  const next = peek(p.scan, 1);
  const third = peek(p.scan, 2);
  if (ch === "<" && next === "<" && third === "=") return ["<<=", 3];
  if (ch === ">" && next === ">" && third === "=") return [">>=", 3];
  if (ch === "*" && next === "*") return ["**", 2];
  if (ch === "<" && next === "<") return ["<<", 2];
  if (ch === ">" && next === ">") return [">>", 2];
  if (ch === "=" && next === "=") return ["==", 2];
  if (ch === "!" && next === "=") return ["!=", 2];
  if (ch === "<" && next === "=") return ["<=", 2];
  if (ch === ">" && next === "=") return [">=", 2];
  if (ch === "&" && next === "&") return ["&&", 2];
  if (ch === "|" && next === "|") return ["||", 2];
  if (ch === "+" && next === "=") return ["+=", 2];
  if (ch === "-" && next === "=") return ["-=", 2];
  if (ch === "*" && next === "=") return ["*=", 2];
  if (ch === "/" && next === "=") return ["/=", 2];
  if (ch === "%" && next === "=") return ["%=", 2];
  if (ch === "&" && next === "=") return ["&=", 2];
  if (ch === "^" && next === "=") return ["^=", 2];
  if (ch === "|" && next === "=") return ["|=", 2];
  if (ch === "+" && next !== "+") return ["+", 1];
  if (ch === "-" && next !== "-") return ["-", 1];
  if (ch === "*") return ["*", 1];
  if (ch === "/") return ["/", 1];
  if (ch === "%") return ["%", 1];
  if (ch === "<") return ["<", 1];
  if (ch === ">") return [">", 1];
  if (ch === "&") return ["&", 1];
  if (ch === "|") return ["|", 1];
  if (ch === "^") return ["^", 1];
  if (ch === "=") return ["=", 1];
  return null;
}

/**
 * Parse a chain of binary operators by precedence climbing. Upstream `ue`.
 *
 * `minPrecedence` is the loosest operator this call is willing to absorb.
 * Parse one operand, then keep consuming `operator operand` pairs as long as
 * the operator binds at least that tightly, folding each pair into the
 * accumulated left-hand side — which is what produces left association for the
 * ordinary operators.
 *
 * The loop stops on the closer, on a comma (that belongs to the enclosing
 * list), on anything that is not an operator, on an operator too loose for this
 * call, and on a missing right-hand operand.
 */
function parseArithmeticBinary(p, closer, minPrecedence, mode) {
  let left = parseArithmeticUnary(p, closer, mode);
  if (!left) return null;
  while (true) {
    skipBlanks(p.scan);
    if (atArithmeticClose(p, closer)) break;
    if (peek(p.scan) === ",") break;
    const operatorRead = readArithmeticOperator(p);
    if (!operatorRead) break;
    const [operator, consumed] = operatorRead;
    const precedence = ARITHMETIC_PRECEDENCE[operator];
    if (precedence === undefined || precedence < minPrecedence) break;
    const operatorByte = p.scan.byte;
    for (let k = 0; k < consumed; k++) {
      advance(p.scan);
    }
    const operatorNode = node(p, operator, operatorByte, p.scan.byte, []);
    // A right-associative operator recurses at its OWN precedence, so another
    // operator of equal precedence is pulled into the right operand; every
    // other operator recurses one level tighter, so an equal-precedence
    // operator is left behind for this loop to fold on the next pass.
    const nextMinPrecedence = RIGHT_ASSOCIATIVE_OPERATORS.has(operator)
      ? precedence
      : precedence + 1;
    const right = parseArithmeticBinary(p, closer, nextMinPrecedence, mode);
    if (!right) break;
    left = node(p, "binary_expression", left.startIndex, right.endIndex, [
      left,
      operatorNode,
      right,
    ]);
  }
  return left;
}

/**
 * Parse the prefix operators. Upstream `fe`.
 *
 * Handles `++x` and `--x` first, then the single-character prefixes `-`, `+`,
 * `!` and `~`. Each prefix becomes a node of its own and the operand is parsed
 * by recursing, so `!-x` nests. If the operand is missing the operator node is
 * returned on its own rather than failing, keeping a truncated expression
 * parseable.
 *
 * The one special case: outside "var" mode a `-` immediately followed by a
 * digit is read as part of a single negative `number` literal instead of as
 * negation, because in those contexts the text is a word or an assignment
 * value where `-1` is one token. Note this path takes decimal digits only, so
 * it does not pick up the `0x` or `base#` forms that parseArithmeticPrimary
 * recognises.
 */
function parseArithmeticUnary(p, closer, mode) {
  skipBlanks(p.scan);
  if (atArithmeticClose(p, closer)) return null;
  const ch = peek(p.scan);
  const next = peek(p.scan, 1);
  if ((ch === "+" && next === "+") || (ch === "-" && next === "-")) {
    const startByte = p.scan.byte;
    advance(p.scan);
    advance(p.scan);
    const operatorNode = node(p, ch + next, startByte, p.scan.byte, []);
    const operand = parseArithmeticUnary(p, closer, mode);
    if (!operand) return operatorNode;
    return node(
      p,
      "unary_expression",
      operatorNode.startIndex,
      operand.endIndex,
      [operatorNode, operand],
    );
  }
  if (ch === "-" || ch === "+" || ch === "!" || ch === "~") {
    if (mode !== "var" && ch === "-" && isDigit(next)) {
      const numberStartByte = p.scan.byte;
      advance(p.scan);
      while (isDigit(peek(p.scan))) {
        advance(p.scan);
      }
      return node(p, "number", numberStartByte, p.scan.byte, []);
    }
    const startByte = p.scan.byte;
    advance(p.scan);
    const operatorNode = node(p, ch, startByte, p.scan.byte, []);
    const operand = parseArithmeticUnary(p, closer, mode);
    if (!operand) return operatorNode;
    return node(
      p,
      "unary_expression",
      operatorNode.startIndex,
      operand.endIndex,
      [operatorNode, operand],
    );
  }
  return parseArithmeticPostfix(p, closer, mode);
}

/**
 * Parse a primary expression and the optional trailing `++` or `--`.
 * Upstream `bn`.
 *
 * No blanks are skipped between the operand and the operator, so the `++` must
 * touch the operand: `i++` is a postfix expression, `i ++` is not.
 */
function parseArithmeticPostfix(p, closer, mode) {
  const operand = parseArithmeticPrimary(p, closer, mode);
  if (!operand) return null;
  const ch = peek(p.scan);
  const next = peek(p.scan, 1);
  if ((ch === "+" && next === "+") || (ch === "-" && next === "-")) {
    const startByte = p.scan.byte;
    advance(p.scan);
    advance(p.scan);
    const operatorNode = node(p, ch + next, startByte, p.scan.byte, []);
    return node(
      p,
      "postfix_expression",
      operand.startIndex,
      operatorNode.endIndex,
      [operand, operatorNode],
    );
  }
  return operand;
}

/**
 * Parse the smallest self-contained pieces of an arithmetic expression.
 * Upstream `pn`. One of: a parenthesised sub-expression, a double-quoted
 * string, a `$`-expansion, a numeric literal, or an identifier — where an
 * identifier may turn out to be an assignment or an array subscript. Anything
 * else yields null, which unwinds the whole chain and tells the caller the
 * expression ended here.
 */
function parseArithmeticPrimary(p, closer, mode) {
  skipBlanks(p.scan);
  if (atArithmeticClose(p, closer)) return null;
  const ch = peek(p.scan);
  if (ch === "(") {
    const openByte = p.scan.byte;
    advance(p.scan);
    const openNode = node(p, "(", openByte, p.scan.byte, []);
    const items = parseArithmeticList(p, ")", mode);
    skipBlanks(p.scan);
    let closeNode;
    if (peek(p.scan) === ")") {
      const closeByte = p.scan.byte;
      advance(p.scan);
      closeNode = node(p, ")", closeByte, p.scan.byte, []);
    } else {
      // Unterminated: synthesise an empty `)` at the cursor so the node still
      // has the shape consumers expect.
      closeNode = node(p, ")", p.scan.byte, p.scan.byte, []);
    }
    return node(
      p,
      "parenthesized_expression",
      openNode.startIndex,
      closeNode.endIndex,
      [openNode, ...items, closeNode],
    );
  }
  if (ch === '"') return parseDoubleQuoted(p);
  if (ch === "$") return parseDollar(p);
  if (isDigit(ch)) {
    const startByte = p.scan.byte;
    while (isDigit(peek(p.scan))) {
      advance(p.scan);
    }
    // Exactly one digit was taken and it was `0`, now followed by x or X: a hex
    // literal, so take hex digits too.
    if (
      p.scan.byte - startByte === 1 &&
      ch === "0" &&
      (peek(p.scan) === "x" || peek(p.scan) === "X")
    ) {
      advance(p.scan);
      while (isHexDigit(peek(p.scan))) {
        advance(p.scan);
      }
    } else if (peek(p.scan) === "#") {
      // bash's explicit-radix form, `base#digits`, e.g. `2#1011`.
      advance(p.scan);
      while (isBaseDigit(peek(p.scan))) {
        advance(p.scan);
      }
    }
    return node(p, "number", startByte, p.scan.byte, []);
  }
  if (isNameStart(ch)) {
    const nameStartByte = p.scan.byte;
    while (isNameChar(peek(p.scan))) {
      advance(p.scan);
    }
    // Read before any blanks are skipped, so it is the character that actually
    // abuts the name. The subscript test below uses this, which is why `a [i]`
    // is not a subscript.
    const charAfterName = peek(p.scan);
    if (mode === "assign") {
      skipBlanks(p.scan);
      const eqChar = peek(p.scan);
      const charAfterEq = peek(p.scan, 1);
      // A single `=`, not `==`: this is an assignment, not a comparison.
      if (eqChar === "=" && charAfterEq !== "=") {
        const nameNode = node(
          p,
          "variable_name",
          nameStartByte,
          p.scan.byte,
          [],
        );
        const equalsByte = p.scan.byte;
        advance(p.scan);
        const equalsNode = node(p, "=", equalsByte, p.scan.byte, []);
        const value = parseTernary(p, closer, mode);
        const end = value ? value.endIndex : equalsNode.endIndex;
        return node(
          p,
          "variable_assignment",
          nameStartByte,
          end,
          value ? [nameNode, equalsNode, value] : [nameNode, equalsNode],
        );
      }
    }
    if (charAfterName === "[") {
      const nameNode = node(p, "variable_name", nameStartByte, p.scan.byte, []);
      const openByte = p.scan.byte;
      advance(p.scan);
      const openNode = node(p, "[", openByte, p.scan.byte, []);
      // The index is an arithmetic expression; when it is not one it may still
      // be a `$`-expansion, so fall back to that.
      const index = parseTernary(p, "]", "var") ?? parseDollar(p);
      skipBlanks(p.scan);
      let closeNode;
      if (peek(p.scan) === "]") {
        const closeByte = p.scan.byte;
        advance(p.scan);
        closeNode = node(p, "]", closeByte, p.scan.byte, []);
      } else {
        closeNode = node(p, "]", p.scan.byte, p.scan.byte, []);
      }
      const children = index
        ? [nameNode, openNode, index, closeNode]
        : [nameNode, openNode, closeNode];
      return node(p, "subscript", nameStartByte, closeNode.endIndex, children);
    }
    return node(
      p,
      mode === "var" ? "variable_name" : "word",
      nameStartByte,
      p.scan.byte,
      [],
    );
  }
  return null;
}

/**
 * Is the cursor sitting on the end of the current arithmetic expression?
 * Upstream `Z`.
 *
 * `closer` is the terminator the caller is parsing towards, and each value maps
 * to the character or characters that end the expression: "))" needs two
 * closing parens in a row, ")" one, and ";", ":", "]" and "}" their own
 * character. ":}" accepts either, for the `${var:-…}` style expansions where
 * the operand may end at a colon or at the closing brace.
 *
 * Every other value — including undefined — falls through to the last line,
 * which treats end of input and a newline as the terminator.
 */
function atArithmeticClose(p, closer) {
  const ch = peek(p.scan);
  if (closer === "))") return ch === ")" && peek(p.scan, 1) === ")";
  if (closer === ")") return ch === ")";
  if (closer === ";") return ch === ";";
  if (closer === ":") return ch === ":";
  if (closer === "]") return ch === "]";
  if (closer === "}") return ch === "}";
  if (closer === ":}") return ch === ":" || ch === "}";
  return ch === "" || ch === "\n";
}

/** Commands longer than this are refused outright rather than parsed. Upstream `Oe`. */
const MAX_COMMAND_LENGTH = 10000;

/**
 * The builtins that introduce declarations. Upstream `hn`. Used by commandArgv
 * to decide whether a `declaration_command` node has a name it recognises.
 */
const DECLARATION_KEYWORDS = new Set([
  "export",
  "declare",
  "typeset",
  "readonly",
  "local",
  "unset",
  "unsetenv",
]);

/**
 * Node types whose text is a literal argument, so it can be unescaped and taken
 * at face value. Upstream `xn`.
 */
const LITERAL_ARGUMENT_TYPES = new Set(["word", "string", "raw_string", "number"]);

/**
 * Node types whose value is only known at run time. Upstream `be`. Their
 * presence is what stops commandArgv from claiming to know the argv.
 */
const SUBSTITUTION_TYPES = new Set([
  "command_substitution",
  "process_substitution",
]);

/** The node types that ARE a command. Upstream `pe`. */
const COMMAND_NODE_TYPES = new Set(["command", "declaration_command"]);

/**
 * Parse a command and return its tree together with the leading `VAR=value`
 * assignments and the command node itself, or null if it cannot be parsed.
 * Upstream `e9t`.
 *
 * Declared async although nothing inside it awaits: callers await the result,
 * so the signature has to stay a promise.
 */
async function parseCommandWithEnv(command) {
  if (!command || command.length > MAX_COMMAND_LENGTH) return null;
  try {
    const rootNode = getParser().parse(command);
    if (!rootNode) return null;
    const commandNode = findCommandNode(rootNode, null);
    const envVars = envAssignments(commandNode);
    return { rootNode, envVars, commandNode, originalCommand: command };
  } catch {
    return null;
  }
}

/**
 * The sentinel parseOrAbort returns instead of a tree when it gives up.
 * Upstream `w3`.
 *
 * Its IDENTITY is the contract: every consumer tests for it with `===`, never
 * by description or by type. That is why the module constructs it exactly once,
 * here at module scope, and why it must never be recreated per call.
 */
const PARSE_ABORTED = Symbol("parse-aborted");

/**
 * Parse a command, or report the abort and return PARSE_ABORTED. Upstream
 * `pEe`.
 *
 * `recordParseAbort` is the telemetry port, passed in rather than imported so
 * this module has no effects of its own; it is the only effectful call anywhere
 * in the module. There are three distinct causes, each reported separately:
 * the command exceeds MAX_COMMAND_LENGTH, the parser returned null, or the
 * parser threw. Only the throw is flagged `panic: true` — the other two are
 * expected refusals, a panic is a bug.
 *
 * An empty command is not an abort; it returns null without telemetry.
 *
 * Declared async although nothing inside it awaits, for the same reason as
 * parseCommandWithEnv: callers await it.
 */
async function parseOrAbort(command, recordParseAbort) {
  if (!command) return null;
  if (command.length > MAX_COMMAND_LENGTH) {
    recordParseAbort("tengu_tree_sitter_parse_abort", {
      cmdLength: command.length,
      panic: false,
    });
    return PARSE_ABORTED;
  }
  try {
    const rootNode = getParser().parse(command);
    if (rootNode === null) {
      recordParseAbort("tengu_tree_sitter_parse_abort", {
        cmdLength: command.length,
        panic: false,
      });
      return PARSE_ABORTED;
    }
    return rootNode;
  } catch {
    recordParseAbort("tengu_tree_sitter_parse_abort", {
      cmdLength: command.length,
      panic: true,
    });
    return PARSE_ABORTED;
  }
}

/**
 * Find the node that represents the command being run, starting from anywhere
 * in the tree. Upstream `wV`. `parent` is the node this one was reached
 * through, or null at the root.
 *
 * Four cases before the generic descent:
 * a node that already is a command is the answer; a `variable_assignment` looks
 * sideways at its parent for the first command that begins after it, which is
 * how `FOO=bar ls` finds `ls`; a `pipeline` searches its members in order, so
 * the FIRST stage wins; and a `redirected_statement` takes the command it wraps
 * directly. Everything else is searched child by child, first match wins.
 */
function findCommandNode(current, parent) {
  const { type, children } = current;
  if (COMMAND_NODE_TYPES.has(type)) return current;
  if (type === "variable_assignment" && parent)
    return (
      parent.children.find(
        (sibling) =>
          COMMAND_NODE_TYPES.has(sibling.type) &&
          sibling.startIndex > current.startIndex,
      ) ?? null
    );
  if (type === "pipeline") {
    for (const child of children) {
      const found = findCommandNode(child, current);
      if (found) return found;
    }
    return null;
  }
  if (type === "redirected_statement")
    return children.find((child) => COMMAND_NODE_TYPES.has(child.type)) ?? null;
  for (const child of children) {
    const found = findCommandNode(child, current);
    if (found) return found;
  }
  return null;
}

/**
 * Collect the `VAR=value` assignments that prefix a command, as raw text.
 * Upstream `mn`.
 *
 * Only the ones BEFORE the command name count as environment for it, so the
 * walk stops at the first node that is the command name or a word.
 */
function envAssignments(commandNode) {
  if (!commandNode || commandNode.type !== "command") return [];
  const assignments = [];
  for (const child of commandNode.children) {
    if (child.type === "variable_assignment") {
      assignments.push(child.text);
    } else if (child.type === "command_name" || child.type === "word") {
      break;
    }
  }
  return assignments;
}

/**
 * Extract the argument vector of a command: the program name followed by its
 * literal arguments. Upstream `fEe`.
 *
 * A `declaration_command` is answered with just its keyword, when that keyword
 * is one this module knows.
 *
 * Otherwise the children are walked in order. Leading assignments are skipped —
 * they are environment, not argv. The first `command_name`, or the first `word`
 * if there is no command_name, is the program.
 *
 * Two rules about concatenations, which are what a node like `foo"bar"$(x)`
 * parses to, are subtle and deliberate:
 *
 * 1. A concatenation whose pieces are all literal is joined from its unescaped
 *    pieces. A concatenation that CONTAINS a substitution has no knowable
 *    value, so as the program name it is kept as its raw source text — an
 *    honest "this is what was written" rather than a wrong literal.
 * 2. In argument position that same concatenation instead STOPS the walk, and
 *    so does a bare substitution argument. Everything from there on depends on
 *    run-time output, so no further argument can be reported truthfully. The
 *    result is a PREFIX of the real argv, never a wrong one.
 */
function commandArgv(commandNode) {
  if (commandNode.type === "declaration_command") {
    const keyword = commandNode.children[0];
    return keyword && DECLARATION_KEYWORDS.has(keyword.text)
      ? [keyword.text]
      : [];
  }
  const argv = [];
  let sawCommandName = false;
  for (const child of commandNode.children) {
    if (child.type === "variable_assignment") continue;
    if (
      child.type === "command_name" ||
      (!sawCommandName && child.type === "word")
    ) {
      sawCommandName = true;
      // A command_name wraps the actual word; a bare word is already it.
      const head = child.children[0] ?? child;
      if (head.type === "concatenation")
        argv.push(
          head.children.some((piece) => SUBSTITUTION_TYPES.has(piece.type))
            ? head.text
            : head.children.map(unescapeArgumentText).join(""),
        );
      else argv.push(unescapeArgumentText(head));
      continue;
    }
    if (LITERAL_ARGUMENT_TYPES.has(child.type)) {
      argv.push(unescapeArgumentText(child));
    } else if (child.type === "concatenation") {
      if (child.children.some((piece) => SUBSTITUTION_TYPES.has(piece.type)))
        break;
      argv.push(child.children.map(unescapeArgumentText).join(""));
    } else if (SUBSTITUTION_TYPES.has(child.type)) {
      break;
    }
  }
  return argv;
}

/**
 * Turn one argument node's source text into the string the shell would pass.
 * Upstream `oe`.
 *
 * An unquoted word only needs its backslash escapes dropped: `a\ b` is `a b`.
 * Anything else is quoted, so only the quotes come off.
 */
function unescapeArgumentText(argNode) {
  if (argNode.type === "word") return argNode.text.replace(/\\(.)/g, "$1");
  return stripSurroundingQuotes(argNode.text);
}

/**
 * Remove one matching pair of surrounding quotes. Upstream `vn`.
 *
 * Both ends must be the same quote character, and the text must be at least two
 * characters long so that a lone `"` is not stripped into nothing.
 */
function stripSurroundingQuotes(text) {
  return text.length >= 2 &&
    ((text[0] === '"' && text.at(-1) === '"') ||
      (text[0] === "'" && text.at(-1) === "'"))
    ? text.slice(1, -1)
    : text;
}

// ─── the seven exports, in the order upstream's export clause lists them ─────
export { getParser, SHELL_KEYWORDS, parseCommandWithEnv, PARSE_ABORTED, parseOrAbort, findCommandNode, commandArgv };
