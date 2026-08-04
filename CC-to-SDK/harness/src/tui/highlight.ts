// tui/src/highlight.ts — zero-dep syntax highlighter for fenced code (spec Decision Log: no 1MB dep
// for a LOW row). Manual single-pass lexer: strings and comments are consumed ATOMICALLY, whichever is
// encountered first scanning left-to-right, so a keyword inside a string or a `//`/`#` inside a string is
// never re-tokenized — the outermost construct always wins, and no pass overlaps another. Keywords/
// numbers are only applied within the plain runs left between those atomic spans; leading whitespace
// is just the start of the first plain run, so it always survives intact.
import type { Segment } from "./render.js";

// F4 Task 3 — the scope colors are upstream's hljs map `DhH` (pack §1.10, bundle L420495), which is built
// from CHALK CONSTANTS and is therefore theme-INDEPENDENT: `keyword: vt.blue`, `string: vt.red`,
// `number: vt.green`, `comment: vt.green` — all FLAT, `DhH` dims nothing. Upstream paints fenced code those
// four colors in every theme it ships, daltonized ones included, and its code colors do not repaint on a
// theme switch. Fidelity wins over our house theme-token pattern; the two costs (no /theme live repaint for
// fenced code; red/green present under the daltonized themes) are recorded divergences in the parity doc,
// not accidents. These are bare ANSI names, which `resolveThemeColor` passes through unchanged, so Ink
// accepts them as-is. This module imports NO theme: it is theme-independent all the way down.
const KEYWORD = "blue", STRING = "red", NUMBER_COLOR = "green", COMMENT = "green";

const KW: Record<string, RegExp> = {
  ts: /\b(const|let|var|function|return|if|else|for|while|class|interface|type|import|export|from|new|await|async|try|catch|throw|extends|implements|readonly|public|private|switch|case|default|break|continue|typeof|instanceof|in|of|null|undefined|true|false|this)\b/g,
  py: /\b(def|return|if|elif|else|for|while|class|import|from|as|with|try|except|raise|lambda|pass|break|continue|and|or|not|in|is|None|True|False|self|yield|async|await|global)\b/g,
  sh: /\b(if|then|else|elif|fi|for|do|done|while|case|esac|function|echo|exit|return|local|export|set)\b/g,
};
const LANG: Record<string, RegExp> = { ts: KW.ts, js: KW.ts, tsx: KW.ts, jsx: KW.ts, json: /\b(true|false|null)\b/g, py: KW.py, python: KW.py, sh: KW.sh, bash: KW.sh, zsh: KW.sh };
/** Comment marker per lang, checked only OUTSIDE a string (json has no comment syntax). */
const COMMENT_MARK: Record<string, string> = { ts: "//", js: "//", tsx: "//", jsx: "//", py: "#", python: "#", sh: "#", bash: "#", zsh: "#" };
const NUMBER = /\b\d+(?:\.\d+)?\b/g;
const QUOTES = new Set(["\"", "'", "`"]);

/** Keyword/number pass over ONE plain run (already known to hold no strings/comments): collect
 *  {start,end,style} spans from both regexes, sort, drop any span overlapping an already-accepted one
 *  (first — i.e. leftmost — wins, so keywords and numbers never double-style the same characters), then
 *  fill the gaps between accepted spans with plain segments. */
function styleWords(text: string, kwRe: RegExp): Segment[] {
  const spans: { start: number; end: number; seg: Partial<Segment> }[] = [];
  kwRe.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = kwRe.exec(text)); ) spans.push({ start: m.index, end: m.index + m[0].length, seg: { color: KEYWORD } });
  NUMBER.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = NUMBER.exec(text)); ) spans.push({ start: m.index, end: m.index + m[0].length, seg: { color: NUMBER_COLOR } });
  spans.sort((a, b) => a.start - b.start);
  const accepted: typeof spans = [];
  for (const s of spans) if (!accepted.length || s.start >= accepted[accepted.length - 1].end) accepted.push(s);
  const out: Segment[] = []; let last = 0;
  for (const s of accepted) {
    if (s.start > last) out.push({ text: text.slice(last, s.start) });
    out.push({ text: text.slice(s.start, s.end), ...s.seg });
    last = s.end;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** One fenced-code line → styled segments. A lang outside `LANG` returns the whole line PLAIN, which is
 *  hljs's own answer for `plaintext` (it leaves the body unscoped). Both callers — markdown's `codeRuns`
 *  and toolSummaries' `previewRows` — already gate on `KNOWN_LANGS`, so this arm is only the total-function
 *  guard; the dim `inactive` fallback it replaced was dead code, and dropping it is what lets this module
 *  drop its `theme.js` import. */
export function highlightCode(line: string, lang: string): Segment[] {
  const kwRe = LANG[lang];
  if (!kwRe) return [{ text: line }];
  const marker = COMMENT_MARK[lang];
  const out: Segment[] = [];
  let plainStart = 0;
  for (let i = 0; i < line.length; ) {
    if (marker && line.startsWith(marker, i)) {
      out.push(...styleWords(line.slice(plainStart, i), kwRe));
      out.push({ text: line.slice(i), color: COMMENT });
      return out;
    }
    if (QUOTES.has(line[i])) {
      out.push(...styleWords(line.slice(plainStart, i), kwRe));
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) j += line[j] === "\\" ? 2 : 1;
      j = Math.min(j + 1, line.length);
      out.push({ text: line.slice(i, j), color: STRING });
      plainStart = i = j;
      continue;
    }
    i++;
  }
  out.push(...styleWords(line.slice(plainStart), kwRe));
  return out;
}

/** Langs highlightCode actually knows — i.e. what this harness can COLOUR. `markdown.ts` uses it to decide
 *  highlighted vs. plain body, and `toolSummaries.ts` to decide whether to call `highlightCode` at all.
 *  It is deliberately NOT the label test; see `UPSTREAM_LANGS`. */
export const KNOWN_LANGS = new Set(Object.keys(LANG));

/** What upstream's `supportsLanguage` (`NhH` L420486 → `sre` L419379 → `ITs` L222529) would answer, and the
 *  ONLY thing `markdown.ts` may use to decide the dim language LABEL. `sre` resolves against hljs's whole
 *  registry, so a language we cannot colour (rust, go, java, css, sql, yaml, …) still gets NO label upstream —
 *  binding the label to `KNOWN_LANGS` labelled ~180 languages upstream leaves bare, which is the divergence
 *  the F4 fix round closed.
 *  Extracted MECHANICALLY from `~/claude-code-bundle/2.1.220/cli.pretty.js`, two lines, no hand-typing:
 *    · the 192 language NAMES are the keys of the lazy loader registry `H$p` at **L418473** (`name: () => …`),
 *      which is key-for-key the display-name map `aur` on L222493 that `ITs` probes first;
 *    · the 191 ALIASES are the keys of the alias map `lur`, also on **L222493** (`alias: "canonical"`), which
 *      `ITs` probes second — this is where `ts`/`js`/`py`/`sh`/`zsh`/`md`/`yml` live, so omitting it would
 *      have labelled the languages we DO highlight.
 *  383 entries after the union. Lookups must pass a LOWERCASED string: `sre` L419379 opens with
 *  `e.toLowerCase()`, which is why ```Python and ```TS resolve at all. */
export const UPSTREAM_LANGS = new Set((
  "1c abnf accesslog actionscript ada angelscript apache applescript arcade arduino armasm asciidoc aspectj autohotkey autoit avrasm awk axapta bash "
  + "basic bnf brainfuck c cal capnproto ceylon clean clojure clojure-repl cmake coffeescript coq cos cpp crmsh crystal csharp csp css d dart delphi diff "
  + "django dns dockerfile dos dsconfig dts dust ebnf elixir elm erb erlang erlang-repl excel fix flix fortran fsharp gams gauss gcode gherkin glsl gml "
  + "go golo gradle graphql groovy haml handlebars haskell haxe hsp http hy inform7 ini irpf90 isbl java javascript jboss-cli json julia julia-repl "
  + "kotlin lasso latex ldif leaf less lisp livecodeserver livescript llvm lsl lua makefile markdown mathematica matlab maxima mel mercury mipsasm mizar "
  + "mojolicious monkey moonscript n1ql nestedtext nginx nim nix node-repl nsis objectivec ocaml openscad oxygene parser3 perl pf pgsql php php-template "
  + "plaintext pony powershell processing profile prolog properties protobuf puppet purebasic python python-repl q qml r reasonml rib roboconf routeros "
  + "rsl ruby ruleslanguage rust sas scala scheme scilab scss shell smali smalltalk sml sqf sql stan stata step21 stylus subunit swift taggerscript tap "
  + "tcl thrift tp twig typescript vala vbnet vbscript vbscript-html verilog vhdl vim wasm wren x86asm xl xml xquery yaml zephir as asc apacheconf "
  + "osascript ino arm adoc ahk x++ sh zsh bf h capnp icl dcl clj edn cmake.in coffee cson iced cls cc c++ h++ hpp hh hxx cxx crm pcmk cr cs c# dpr dfm "
  + "pas pascal patch jinja bind zone docker bat cmd dst ex exs erl xlsx xls f90 f95 fs f# gms gss nc feature golang gql hbs html.hbs html.handlebars "
  + "htmlbars hs hx https hylang i7 toml jsp js jsx mjs cjs wildfly-cli jsonc jldoctest kt kts ls lassoscript tex pluto mk mak make md mkdown mkd mma wl "
  + "m moo mips moon nt nginxconf nixos mm objc obj-c obj-c++ objective-c++ ml scad pl pm pf.conf postgres postgresql text txt pwsh ps ps1 pde proto pp "
  + "pb pbi py gyp ipython pycon k kdb qt re graph instances mikrotik rb gemspec podspec thor irb rs scm sci console shellsession st stanfuncs do ado p21 "
  + "step stp styl tk craftcms ts tsx mts cts vb vbs v sv svh tao html xhtml rss atom xjb xsd xsl plist wsf svg xpath xq xqm yml zep mysql oracle "
  + "freepascal lazarus lpr lfm php3 php4 php5 php6 php7 php8").split(" "));
