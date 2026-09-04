// THE SHELL-PARSER PARTITION CORPUS — the input side of C13a's oracle.
//
// `strangle/modules/shell-parser/` is the campaign's largest single ownership:
// 62,907 bytes of hand-written recursive-descent bash parsing, reimplemented
// behind the same seven-export surface. Its differential surface is real — every
// Bash call in the recorded corpus parses through it, and the safety chain and
// the permission classifier consume its nodes — but that surface is narrow in a
// way that matters. Read as an artifact, the corpus's Bash commands are `ls`,
// `cat`, `echo`, `git status`, a pipe or two: simple commands with simple
// arguments. The DOMAIN is every string a model can put in a `command` field.
//
// So this file is the other half of §2.4's bargain, and it is organised as a
// PARTITION of that domain rather than as a list of interesting cases. Each
// partition names one construct family, says what it is for, and — the part that
// makes it evidence rather than decoration — declares its RED DIRECTION: the
// specific way a wrong owned parser would fail this partition and no other.
// `strangle/parser-parity.test.ts` enforces both halves: every case is compared
// against the pinned chunk's own bytes, and every partition's red direction is
// applied to a deliberately corrupted owned tree, which must be caught.
//
// ## Why partitions and not a fuzzer alone
//
// There is a generated partition below (`fuzz-token-soup`, seeded and recorded),
// and it earns its place: random token juxtaposition finds recovery paths no
// human writes down. But a fuzzer over a grammar this large is a coverage
// lottery — it will never reliably produce `${v/#pat/rep}`, a `<<-` heredoc
// whose delimiter is quoted, or an arithmetic ternary nested in a subscript. The
// named partitions are what make those reachable on purpose; the fuzzer is what
// finds the ones nobody thought of. Both are compared the same way.
//
// ## Non-vacuity (§3.1)
//
// An EMPTY partition fails the test. A partition is a claim that a region of the
// domain is graded, and a claim over nothing is the canonical false green.

/** One region of the input domain, with the reason a wrong parser fails it. */
export interface Partition {
  /** stable id, used in the test's output and in the attestation's exclusion reasons */
  name: string;
  /** what region of the domain this covers, and why it is its own partition */
  why: string;
  /**
   * The RED DIRECTION. Applied by the test to a deliberately corrupted copy of
   * the owned tree for this partition's first case: the comparator must report a
   * difference, and the difference must be the one named here. A partition whose
   * control passes silently is a partition that would not have noticed a wrong
   * parser either.
   */
  control: "type" | "byteRange" | "childCount" | "text" | "childOrder";
  /** the seed, when `cases` was generated rather than written */
  seed?: number;
  cases: string[];
}

/**
 * A deterministic 32-bit PRNG. Written out rather than imported because the
 * generated partition's inputs have to be reproducible from the recorded seed
 * alone, on any machine and any Node version — `Math.random` is not, and a
 * generated corpus nobody can regenerate is a corpus nobody can review.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The fragment bag the generated partition draws from. Deliberately weighted
 * towards the characters that CHANGE parser state — quotes, `$`, backticks,
 * braces, redirection operators — rather than towards plausible commands: the
 * point of the generated partition is the recovery paths, and those are reached
 * by juxtaposition, not by well-formed input.
 */
const FRAGMENTS = [
  "echo", "ls", "cat", "git", "-l", "--flag", "file.txt", "a", "b", "x1",
  "|", "||", "&&", "&", ";", ";;", ";&", "\n", "  ", "\t",
  "(", ")", "((", "))", "{", "}", "[", "]", "[[", "]]",
  ">", ">>", "<", "<<", "<<-", "<<<", ">&", "<&", "&>", ">|", "2>", "&1",
  "'", '"', "`", "\\", "\\n", "$", "${", "$(", "$((", "$'",
  "$x", "${x}", "${x:-d}", "${x##p}", "${x/a/b}", "$(cmd)", "`cmd`", "$((1+2))",
  "if", "then", "else", "elif", "fi", "while", "until", "do", "done",
  "for", "in", "case", "esac", "select", "function", "!",
  "export", "local", "declare", "unset", "readonly",
  "=", "+=", "==", "!=", "=~", "-eq", "-f", "-z",
  "*", "?", "~", "#", "%", "^", ",", ":", "..", "@",
  "é", "日本", "🙂", "\u00a0",
];

function generatedCases(seed: number, count: number): string[] {
  const rand = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = 1 + Math.floor(rand() * 9);
    let s = "";
    for (let k = 0; k < n; k++) {
      s += FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)];
      if (rand() < 0.55) s += " ";
    }
    out.push(s);
  }
  return out;
}

/**
 * The nesting shells the second generator wraps a core in. Each is a `[before,
 * after]` pair, and they are applied outside-in, so a five-deep draw produces a
 * construct nested five levels — which is where a recursive-descent parser keeps
 * its state bugs, because each layer saves and restores something (quote depth,
 * backtick depth, the heredoc stack, the arithmetic closer, `stopToken`).
 *
 * Some shells are deliberately UNBALANCED (`$(` with no closer). A generator that
 * only ever produced well-formed nesting would never reach the recovery scanners,
 * and the recovery scanners are the part of this grammar with the least corpus
 * coverage and the most room for a reimplementation to drift.
 */
const SHELLS: [string, string][] = [
  ['"', '"'], ["'", "'"], ["$'", "'"], ["`", "`"],
  ["$(", ")"], ["${", "}"], ["$((", "))"], ["$[", "]"],
  ["(", ")"], ["{ ", "; }"], ["[[ ", " ]]"], ["[ ", " ]"],
  ["<(", ")"], [">(", ")"], ["${x:-", "}"], ["${x/", "/r}"],
  ["if ", "; then :; fi"], ["while ", "; do :; done"], ["case x in ", ") :;; esac"],
  ["$(", ""], ["${", ""], ["`", ""], ['"', ""], ["(", ""],
];

const CORES = [
  "echo hi", "ls -la", "a|b", "a&&b", "x=1", "$v", "${v}", "$((1+2))", "*.txt",
  "a b c", "", " ", "日本 🙂", "a=1 b=2 cmd", "cmd <in >out", "!", ";;", "\\",
];

function nestedCases(seed: number, count: number): string[] {
  const rand = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = CORES[Math.floor(rand() * CORES.length)];
    const depth = 1 + Math.floor(rand() * 5);
    for (let k = 0; k < depth; k++) {
      const [before, after] = SHELLS[Math.floor(rand() * SHELLS.length)];
      s = before + s + after;
    }
    if (rand() < 0.3) s = `echo ${s}`;
    if (rand() < 0.2) s = `${s} | grep x`;
    out.push(s);
  }
  return out;
}

/**
 * The `Oe` length cap is 10,000 characters, and it guards TWO exported entry
 * points with two different answers: `parseCommandWithEnv` returns `null` and
 * `parseOrAbort` returns the abort sentinel after emitting telemetry. The
 * boundary is `> cap`, so the three interesting lengths are cap-1, cap and cap+1
 * — built here rather than written as literals so the pin's own constant is what
 * decides, and a cap that moves upstream moves these with it.
 */
export const LENGTH_CAP_CASES = (cap: number): { label: string; command: string }[] => [
  { label: "cap-1", command: `echo ${"a".repeat(cap - 1 - 5)}` },
  { label: "cap", command: `echo ${"a".repeat(cap - 5)}` },
  { label: "cap+1", command: `echo ${"a".repeat(cap + 1 - 5)}` },
];

export const PARTITIONS: Partition[] = [
  {
    name: "simple-commands",
    why:
      "the shape the recorded corpus actually contains — a command name, flags, path-ish arguments — held here so the partition table has a control group. " +
      "If this one ever reddens, nothing below it is worth reading: the differential surface would already have caught it.",
    control: "type",
    cases: [
      "ls",
      "ls -la",
      "ls -la /tmp",
      "echo hello",
      "echo hello world",
      "git status",
      "git commit -m message",
      "cat file.txt",
      "npm run build",
      "node --version",
      "true",
      "/usr/bin/env",
      "./script.sh arg1 arg2",
      "../relative/path",
      "cmd -abc -d=e --long-flag --long=value",
      "cmd +opt",
      "cmd 'single' \"double\" bare",
      "",
      " ",
      "   \t  ",
      "\n",
      "\n\n",
      "# just a comment",
      "ls # trailing comment",
      "ls#nocomment",
    ],
  },

  {
    name: "quoting",
    why:
      "the four quoting mechanisms bash has, and their nestings. Single quotes are inert; double quotes still expand; ANSI-C `$'…'` re-escapes; a backslash escapes one character " +
      "and, at end of line, splices lines. Every one of them changes which bytes are a word and which are structure, so a parser that gets one wrong mis-splits argv — " +
      "and argv is what the permission classifier matches rules against.",
    control: "childCount",
    cases: [
      "echo 'single quoted'",
      'echo "double quoted"',
      "echo $'ansi\\nc'",
      "echo $'tab\\there'",
      "echo \\escaped",
      "echo a\\ b",
      "echo 'it'\\''s'",
      "echo \"it's\"",
      "echo 'say \"hi\"'",
      "echo \"say 'hi'\"",
      "echo \"nested $(echo 'inner')\"",
      "echo \"nested `echo 'inner'`\"",
      "echo 'unterminated",
      'echo "unterminated',
      "echo $'unterminated",
      "echo \\",
      "echo a\\\nb",
      "echo \"line\\\ncontinued\"",
      "echo ''",
      'echo ""',
      "echo $''",
      "echo \"\"''\"\"",
      "echo pre'mid'post",
      'echo pre"mid"post',
      "echo a'b'\"c\"$'d'e",
      "echo \"$var\"",
      "echo \"${var}\"",
      "echo \"a $var b\"",
      "echo \"a$@b\"",
      "echo \"\\$notavar\"",
      "echo \"\\\\\"",
      "echo '\\'",
      "VAR='has space' cmd",
      'VAR="has $sub" cmd',
    ],
  },

  {
    name: "heredocs",
    why:
      "the one construct whose text extends past the line the redirection is written on, which makes it the only place the parser scans forward out of band and then rewrites a node it has already built. " +
      "Quoted delimiters suppress expansion (so the body is one opaque span); unquoted ones do not (so the body is re-scanned for substitutions); `<<-` strips leading tabs from both the body and the terminator; " +
      "and three delimiter shapes are REFUSED outright with an abort rather than guessed at.",
    control: "byteRange",
    cases: [
      "cat <<EOF\nbody\nEOF",
      "cat <<'EOF'\nbody $notexpanded\nEOF",
      'cat <<"EOF"\nbody\nEOF',
      "cat <<\\EOF\nbody\nEOF",
      "cat <<-EOF\n\tbody\n\tEOF",
      "cat <<-'EOF'\n\tbody\n\tEOF",
      "cat <<EOF\n$var and $(cmd) and `bt`\nEOF",
      "cat <<EOF\n\\$escaped \\\\ \\`\nEOF",
      "cat <<EOF\nunterminated body",
      "cat <<EOF",
      "cat <<EOF\nEOF",
      "cat <<EOF\n\nEOF",
      "cat <<EOF > out.txt\nbody\nEOF",
      "cat <<EOF | grep x\nbody\nEOF",
      "cat <<EOF && echo done\nbody\nEOF",
      "cat <<A <<B\nfirst\nA\nsecond\nB",
      "cat <<EOF; echo after\nbody\nEOF",
      "cat <<EOF\nEOFX\nEOF",
      "cat <<EOF\n  EOF\nEOF",
      "cat <<EOF\nbody\nEOF extra",
      "cat <<END_OF_FILE\nbody\nEND_OF_FILE",
      "cat <<'E$F'\nbody\nE$F",
      'cat <<"E$F"\nbody\nE$F',
      "cat <<-\tEOF\nbody\nEOF",
      "cat <<EOF)\nbody\nEOF",
      "cmd <<<'here string'",
      "cmd <<<$var",
      "cmd <<<\"$(inner)\"",
      "cmd 3<<EOF\nbody\nEOF",
    ],
  },

  {
    name: "brace-expansion",
    why:
      "`{a..z}` ranges and `{a,b,c}` lists look like the compound-statement `{ … }` and like a `${…}` expansion, and the parser separates the three by lookahead alone. " +
      "Getting it wrong turns a word into a statement, which changes the shape of the whole command rather than one node.",
    control: "type",
    cases: [
      "echo {a..z}",
      "echo {1..10}",
      "echo {01..10}",
      "echo {a..b}c",
      "echo pre{1..3}post",
      "echo {a,b,c}",
      "echo {a,b}{c,d}",
      "echo {}",
      "echo {a}",
      "echo {a..}",
      "echo {..b}",
      "echo {ab..cd}",
      "echo {1..a}",
      "echo {a..1}",
      "echo file{1..3}.txt",
      "{ echo grouped; }",
      "{ echo a; echo b; }",
      "{echo notgrouped}",
      "echo {a b}",
      "echo }",
      "echo {",
      "echo a{b",
      "mkdir -p {src,test}/{unit,e2e}",
      "echo ${x}",
      "echo {$x}",
    ],
  },

  {
    name: "arithmetic",
    why:
      "`$(( … ))`, `$[ … ]`, `(( … ))` and the C-style `for` header share one precedence-climbing expression parser with thirty operators, right-associative assignment, a ternary, " +
      "pre/post increment, hex and base-N literals, and array subscripts. It is the densest grammar in the chunk and the one furthest from anything the corpus renders.",
    control: "childOrder",
    cases: [
      "echo $((1+2))",
      "echo $(( 1 + 2 ))",
      "echo $((1+2*3))",
      "echo $(((1+2)*3))",
      "echo $((2**3**2))",
      "echo $((a=1))",
      "echo $((a+=1))",
      "echo $((a<<=2))",
      "echo $((a?b:c))",
      "echo $((a?b:c?d:e))",
      "echo $((++a))",
      "echo $((a++))",
      "echo $((--a))",
      "echo $((a--))",
      "echo $((-a))",
      "echo $((!a))",
      "echo $((~a))",
      "echo $((0x1f))",
      "echo $((0X1F))",
      "echo $((16#ff))",
      "echo $((2#1010))",
      "echo $((a[0]))",
      "echo $((a[i+1]))",
      "echo $((a,b,c))",
      "echo $((a&&b||c))",
      "echo $((a==b))",
      "echo $((a!=b))",
      "echo $((a<=b))",
      "echo $((a>=b))",
      "echo $((a%b))",
      "echo $((a^b))",
      "echo $(($x))",
      "echo $((${x}))",
      "echo $((\"str\"))",
      "echo $((unterminated",
      "echo $((1+))",
      "echo $[1+2]",
      "echo $[unterminated",
      "((i=0))",
      "((i++))",
      "for ((i=0;i<10;i++)); do echo $i; done",
      "for ((;;)); do break; done",
      "for ((i=0,j=1;i<j;i++,j--)); do echo; done",
      "for ((i=0;i<3;i++)) { echo $i; }",
    ],
  },

  {
    name: "process-substitution",
    why:
      "`<( … )` and `>( … )` open a nested statement list inside what is otherwise a word position, and they are the one construct that is legal both as a redirection target and as a bare argument. " +
      "A parser that treats them as words loses the inner command entirely — which is exactly the kind of loss a safety chain must not have, since the inner command is what runs.",
    control: "childCount",
    cases: [
      "diff <(sort a) <(sort b)",
      "cmd >(tee log)",
      "cmd <(inner) arg",
      "cmd arg <(inner)",
      "cmd < <(inner)",
      "cmd > >(inner)",
      "diff <(cmd1 | cmd2) <(cmd3)",
      "cmd <(nested <(deeper))",
      "cmd <(unterminated",
      "cmd <()",
      "cmd <(;)",
      "echo \"$(cat <(echo x))\"",
      "cmd 2> >(logger)",
    ],
  },

  {
    name: "command-substitution",
    why:
      "`$( … )` and backticks, nested. The two forms take DIFFERENT paths — backticks pre-scan for escapes they refuse to model and can bail out to a `backtick_body_overrun` node, " +
      "`$( … )` recovers from a missing closer with its own nesting scanner. Both are the primary way one command hides inside another, so both are load-bearing for anything that reads argv.",
    control: "text",
    cases: [
      "echo $(ls)",
      "echo $(ls -la)",
      "echo `ls`",
      "echo $(echo $(echo deep))",
      "echo `echo \\`echo deep\\``",
      "echo $(echo `echo mixed`)",
      "echo `echo $(echo mixed)`",
      "echo \"$(ls)\"",
      "echo \"`ls`\"",
      "echo '$(not expanded)'",
      "echo '`not expanded`'",
      "echo $(unterminated",
      "echo `unterminated",
      "echo $()",
      "echo ``",
      "echo $(a; b)",
      "echo $(a | b)",
      "echo $(a && b)",
      "echo $(cat <<EOF\nbody\nEOF\n)",
      "echo $(echo \"quoted )\")",
      "echo $(echo 'quoted )')",
      "echo $(echo \\))",
      "echo $($$)",
      "echo $(echo $'ansi')",
      "VAR=$(cmd) other",
      "echo $(cmd > file)",
      "echo `cmd > file`",
    ],
  },

  {
    name: "pipelines-lists-redirections",
    why:
      "the statement level: `|`, `|&`, `&&`, `||`, `;`, `&`, subshells, brace groups, negation, and the twelve redirection operators with and without file descriptors. " +
      "This is where the rebalancing rule lives — a redirection on the right of a pipe belongs to the WHOLE pipeline, not to its last member — and getting it backwards changes which command a redirection applies to.",
    control: "childOrder",
    cases: [
      "a | b",
      "a | b | c",
      "a |& b",
      "a && b",
      "a || b",
      "a && b || c",
      "a; b",
      "a; b; c",
      "a &",
      "a & b",
      "a; ",
      "; a",
      "a |",
      "a &&",
      "! a",
      "! a | b",
      "! ! a",
      "(a)",
      "(a; b)",
      "(a) | b",
      "{ a; }",
      "{ a; } | b",
      "a > out",
      "a >> out",
      "a < in",
      "a 2> err",
      "a 2>&1",
      "a >&2",
      "a &> both",
      "a &>> both",
      "a >| clobber",
      "a <& 3",
      "a <&-",
      "a >&-",
      "a {fd}> out",
      "a {fd}< in",
      "a {arr[0]}> out",
      "a > out 2> err",
      "a > out < in",
      "a | b > out",
      "a > out | b",
      "(a) > out",
      "{ a; } > out",
      "a 3>&1 1>&2 2>&3",
      "a > <(cmd)",
      "a 1>",
      "a >",
      "a > > b",
      "cmd | while read x; do echo $x; done",
    ],
  },

  {
    name: "expansions",
    why:
      "`${…}` in all of its forms: the length prefix, the indirection prefixes, subscripts, the substring form, the twelve suffix operators and the pattern or replacement each takes. " +
      "This is the largest single function in the chunk and the one whose operand grammar changes per operator — `${v/a/b}`'s left operand is a pattern, `${v:-d}`'s is a word, and they parse differently.",
    control: "childCount",
    cases: [
      "echo $x",
      "echo ${x}",
      "echo $_",
      "echo $1",
      "echo $@",
      "echo $*",
      "echo $#",
      "echo $?",
      "echo $$",
      "echo $!",
      "echo $-",
      "echo ${#x}",
      "echo ${#}",
      "echo ${!x}",
      "echo ${!x@}",
      "echo ${!x[@]}",
      "echo ${x:-default}",
      "echo ${x:=default}",
      "echo ${x:?message}",
      "echo ${x:+alt}",
      "echo ${x-default}",
      "echo ${x=default}",
      "echo ${x?message}",
      "echo ${x+alt}",
      "echo ${x#prefix}",
      "echo ${x##prefix}",
      "echo ${x%suffix}",
      "echo ${x%%suffix}",
      "echo ${x/a/b}",
      "echo ${x//a/b}",
      "echo ${x/#a/b}",
      "echo ${x/%a/b}",
      "echo ${x/a}",
      "echo ${x^}",
      "echo ${x^^}",
      "echo ${x,}",
      "echo ${x,,}",
      "echo ${x:1}",
      "echo ${x:1:2}",
      "echo ${x: -1}",
      "echo ${x:1:-1}",
      "echo ${x[0]}",
      "echo ${x[@]}",
      "echo ${x[*]}",
      "echo ${x[i+1]}",
      "echo ${x[$i]}",
      "echo ${#x[@]}",
      "echo ${x:-$(cmd)}",
      "echo ${x:-`cmd`}",
      "echo ${x:-\"quoted default\"}",
      "echo ${x/$a/$b}",
      "echo ${x/\"a\"/b}",
      "echo ${x:-${y:-z}}",
      "echo ${unterminated",
      "echo ${}",
      "echo ${!}",
      "echo ${#!}",
      "echo \"${x:-d}\"",
      "echo \"${x/'a'/b}\"",
      "echo ${x@Q}",
      "echo ${@}",
    ],
  },

  {
    name: "compound-statements",
    why:
      "`if`/`while`/`until`/`for`/`select`/`case`/`function` and the declaration commands. Every one of them recovers from a missing keyword by omitting a child rather than failing, " +
      "so the shape of a half-written compound statement is itself part of the contract — and a model's `command` field very often contains one.",
    control: "childCount",
    cases: [
      "if true; then echo y; fi",
      "if true; then echo y; else echo n; fi",
      "if a; then b; elif c; then d; else e; fi",
      "if true\nthen\necho y\nfi",
      "if true; then echo y",
      "if; then; fi",
      "while true; do echo; done",
      "until false; do echo; done",
      "while read line; do echo $line; done < file",
      "for i in 1 2 3; do echo $i; done",
      "for i in $(seq 3); do echo $i; done",
      "for i in *.txt; do echo; done",
      "for i; do echo; done",
      "for 1bad in x; do echo; done",
      "select opt in a b; do echo; done",
      "case $x in a) echo a;; b) echo b;; esac",
      "case $x in a|b) echo;; *) echo;; esac",
      "case $x in (a) echo;; esac",
      "case $x in a) echo;& b) echo;;& esac",
      "case $x in 'quoted') echo;; esac",
      "case $x in \"q\"*) echo;; esac",
      "case $x in *.txt) echo;; esac",
      "case $x in ?(a|b)) echo;; esac",
      "case $x in esac",
      "case $x in a) ;; esac",
      "f() { echo; }",
      "f () { echo; }",
      "function f { echo; }",
      "function f() { echo; }",
      "function f { echo; } > out",
      "f() ( echo )",
      "f() { echo; } | b",
      "export A=1",
      "export A=1 B=2",
      "export -f name",
      "export A",
      "local x=1",
      "declare -a arr",
      "declare -A map",
      "readonly X=1",
      "typeset -i n",
      "unset x",
      "unset -v x y",
      "unset x[0]",
      "unset()",
      "A=1 B=2 cmd",
      "arr=(a b c)",
      "arr=()",
      "arr+=(d)",
      "arr[0]=x",
      "arr[i+1]=x",
      "A=",
      "A=$'x'",
      "A+=1",
    ],
  },

  {
    name: "test-commands",
    why:
      "`[ … ]` and `[[ … ]]` are a second, separate expression grammar — `&&`, `||`, `<`, `>`, `=~` and pattern matching are operators only inside the double form, " +
      "and the `=~` right-hand side is scanned as a regex rather than parsed as a word. It is also the construct that most often decides what a command DOES, which is why the safety chain reads it.",
    control: "type",
    cases: [
      "[ -f file ]",
      "[ -z \"$x\" ]",
      "[ a = b ]",
      "[ a != b ]",
      "[ 1 -eq 2 ]",
      "[ ! -f file ]",
      "[ -f a -a -f b ]",
      "[ \\( a = b \\) ]",
      "[ ]",
      "[ a ]",
      "[[ -f file ]]",
      "[[ a == b ]]",
      "[[ a != b ]]",
      "[[ a =~ ^x.*$ ]]",
      "[[ a =~ \"quoted\" ]]",
      "[[ $x =~ [0-9]+ ]]",
      "[[ a == b* ]]",
      "[[ a == \"b\"* ]]",
      "[[ a && b ]]",
      "[[ a || b ]]",
      "[[ ( a && b ) || c ]]",
      "[[ ! a ]]",
      "[[ a < b ]]",
      "[[ a > b ]]",
      "[[ -n $x && -z $y ]]",
      "[[ a =~ b ]] && echo yes",
      "[[ a\n&& b ]]",
      "[[ a # comment\n&& b ]]",
      "[[ ]]",
      "[[ -f ]]",
      "[[ a = ]]",
      "if [[ -d dir ]]; then echo; fi",
      "if [ -d dir ]; then echo; fi",
      "test -f file",
    ],
  },

  {
    name: "utf8-offsets",
    why:
      "every offset the parser emits is a UTF-8 BYTE offset over a UTF-16 string, maintained by two independent mechanisms: an incremental counter in the scanner and a lazily built table for random access. " +
      "They must agree. Two-byte, three-byte and four-byte (surrogate-pair) code points each take a different arm, and the whole-string ASCII fast path in the text slicer takes a fourth. " +
      "A parser that is right about structure and wrong about offsets hands the safety chain correct nodes pointing at the wrong bytes.",
    control: "byteRange",
    cases: [
      "echo é",
      "echo café",
      "echo 日本語",
      "echo 🙂",
      "echo 🙂🙂🙂",
      "echo a🙂b",
      "echo 'é'",
      'echo "日本"',
      "echo é | grep é",
      "echo ${é}",
      "echo $(echo 🙂)",
      "é=1 cmd",
      "cat <<EOF\n日本\nEOF",
      "echo \u00a0nbsp",
      "echo a\u0301combining",
      "[[ 🙂 == 🙂 ]]",
      "echo $((1+1)) 日本",
      "echo 日本 > 出力",
      "echo 🙂 'é' \"日\" $'x'",
    ],
  },

  {
    name: "recovery-and-junk",
    why:
      "input that is not a shell command at all. A model's `command` field can contain anything, and the parser's contract is to produce a tree rather than to throw — every unterminated construct, " +
      "stray closer and impossible juxtaposition has a defined recovery shape. This partition exists because those shapes are behaviour, not accidents, and the reimplementation has to reproduce them.",
    control: "type",
    cases: [
      ")",
      "}",
      "]]",
      ";;",
      ";;;",
      "&&",
      "||",
      "|",
      "<",
      ">",
      "((",
      "))",
      "$",
      "${",
      "$(",
      "`",
      "'",
      '"',
      "\\",
      "then",
      "fi",
      "done",
      "esac",
      "do",
      "else",
      "elif",
      "in",
      "echo )",
      "echo }",
      "echo ]",
      "echo (",
      "a=",
      "=b",
      "a==b",
      "echo =",
      "echo a=",
      "cmd(",
      "cmd()",
      "()",
      "( ",
      "{ ",
      "if",
      "case",
      "for",
      "while",
      "function",
      "select",
      "echo a\u0000b",
      "\u0000",
      "\r\n",
      "a\rb",
      "echo\ttab",
    ],
  },

  {
    name: "corpus-shapes",
    why:
      "commands of the shape the RECORDED corpus issues, held as their own partition so the differential surface and the contract test can be compared. " +
      "Every one of these parses through the owned module on every replay of its scenario, which makes this the partition where a red here and a red in the gate mean the same thing.",
    control: "text",
    cases: [
      "echo hello",
      "pwd",
      "ls -la",
      "cat README.md",
      "git status --short",
      "git log --oneline -5",
      "echo $HOME",
      "echo \"$PWD\"",
      "mkdir -p a/b/c",
      "touch file.txt",
      "rm -f file.txt",
      "grep -rn pattern .",
      "find . -name '*.ts'",
      "wc -l file",
      "head -20 file",
      "sleep 1",
      "cd /tmp && ls",
      "echo one; echo two",
      "ls | head",
      "cat file | grep x | wc -l",
      "npm test 2>&1",
      "printf '%s\\n' a b",
      "date +%Y",
      "test -f file && echo yes",
      "for f in *.txt; do echo $f; done",
    ],
  },

  {
    name: "fuzz-token-soup",
    why:
      "generated by juxtaposing shell fragments at random, seeded so the population is reproducible from this file alone. The named partitions above reach the constructs someone thought of; " +
      "this one reaches the ones nobody did — in particular the recovery paths that only open when two constructs meet in an order no well-formed command produces.",
    control: "type",
    seed: 0x5e11c0de,
    cases: generatedCases(0x5e11c0de, 900),
  },

  {
    name: "fuzz-nested",
    why:
      "the other half of the generated population, and a different generator: token soup is shallow by construction — it juxtaposes fragments — while the deepest bugs in a recursive-descent parser live where a construct " +
      "contains ITSELF or contains a different construct that contains it. This one wraps a random core in a random stack of nesting shells (quotes, substitutions, expansions, subshells, test brackets, arithmetic), " +
      "up to five deep, so the recursion carries state — quote depth, backtick depth, the heredoc stack, the arithmetic closer — across layers that a flat generator never reaches.",
    control: "childCount",
    seed: 0x0deeb0d1,
    cases: nestedCases(0x0deeb0d1, 500),
  },
];
