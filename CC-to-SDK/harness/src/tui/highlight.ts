// tui/src/highlight.ts — zero-dep syntax highlighter for fenced code (spec Decision Log: no 1MB dep
// for a LOW row). Manual single-pass lexer: strings and comments are consumed ATOMICALLY, whichever is
// encountered first scanning left-to-right, so a keyword inside a string or a `//`/`#` inside a string is
// never re-tokenized — the outermost construct always wins, and no pass overlaps another. Keywords/
// numbers are only applied within the plain runs left between those atomic spans; leading whitespace
// is just the start of the first plain run, so it always survives intact.
import type { Segment } from "./render.js";
import { resolveThemeColor, themeTokens } from "./theme.js";

// F4 Task 3 — the scope colors are upstream's hljs map `DhH` (pack §1.10, bundle L420495), which is built
// from CHALK CONSTANTS and is therefore theme-INDEPENDENT: `keyword: vt.blue`, `string: vt.red`,
// `number: vt.green`, `comment: vt.green`. Upstream paints fenced code those four colors in every theme it
// ships, daltonized ones included, and its code colors do not repaint on a theme switch. Fidelity wins over
// our house theme-token pattern; the two costs (no /theme live repaint for fenced code; red/green present
// under the daltonized themes) are recorded divergences in the parity doc, not accidents. These are bare
// ANSI names, which `resolveThemeColor` passes through unchanged, so Ink accepts them as-is.
const KEYWORD = "blue", STRING = "red", NUMBER_COLOR = "green", COMMENT = "green";
// The ONE remaining theme-token role: `highlightCode`'s own unknown-language fallback, which has no upstream
// counterpart (upstream resolves an unknown fence to hljs "plaintext" instead). Read per call so a
// mid-session setTheme() repaints the very next pass.
const role = (name: "inactive") => resolveThemeColor(themeTokens()[name]);

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

/** One fenced-code line → styled segments. Unknown lang → the whole line as a single dim `inactive`
 *  segment (no highlighting dependency worth pulling in for a language we don't recognize). */
export function highlightCode(line: string, lang: string): Segment[] {
  const kwRe = LANG[lang];
  if (!kwRe) return [{ text: line, color: role("inactive"), dim: true }];
  const marker = COMMENT_MARK[lang];
  const out: Segment[] = [];
  let plainStart = 0;
  for (let i = 0; i < line.length; ) {
    if (marker && line.startsWith(marker, i)) {
      out.push(...styleWords(line.slice(plainStart, i), kwRe));
      out.push({ text: line.slice(i), color: COMMENT, dim: true });
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

/** Langs highlightCode actually knows (markdown.ts uses this to decide segment-styled vs. plain-dim). */
export const KNOWN_LANGS = new Set(Object.keys(LANG));
