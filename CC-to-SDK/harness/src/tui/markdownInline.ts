// tui/src/markdownInline.ts — the INLINE half of the F4 markdown engine: a recursive walker over
// `marked` inline tokens that emits our `Segment[]` instead of upstream's glued ANSI string
// (spec Decision Log "F4 design settlements"). Style flows DOWN by spreading, so nesting composes:
// `**bold *both***` yields one segment carrying bold AND italic — the old regex renderer could not
// express that at all.
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Token, Tokens } from "marked";
import type { Segment } from "./render.js";
import { currentTheme, isLightTheme, resolveThemeColor, themeTokens } from "./theme.js";

export interface InlineStyle { bold?: boolean; italic?: boolean; strikethrough?: boolean; color?: string; dim?: boolean }

// ── terminal-capability gates ───────────────────────────────────────────────────────────────────────
// Both take an optional `env` (house DI shape) so a test can pin the matrix without touching the process;
// the walker itself calls them bare, i.e. against the real `process.env`, per render.

/** `UhH` (pack §1.7, L420509) — dHn's TERM_PROGRAM allowlist, verbatim. */
const STRIKE_TERMS = new Set(["iTerm.app", "vscode", "WezTerm", "WarpTerminal", "Hyper", "Tabby", "rio", "contour", "alacritty"]);
const isGhostty = (e: NodeJS.ProcessEnv) => e.TERM === "xterm-ghostty" || e.TERM_PROGRAM === "ghostty";                 // L148101
const isMintty = (e: NodeJS.ProcessEnv) => e.TERM_PROGRAM === "mintty" || (process.platform === "win32" && !!e.MSYSTEM); // L148104

/** `dHn` (pack §1.7, L420498–420509) VERBATIM in order: the force override short-circuits BEFORE the
 *  Apple_Terminal / `TERM=linux` exclusion, so those two can be forced back on.
 *  DIVERGENCE: upstream's render condition is `dHn() && vt.level > 0` — the second half is chalk's colour
 *  level, which does not exist at our layer (we emit style DATA and Ink decides colour at paint time), so
 *  only `dHn` is ported. Recorded in the parity doc. */
export function strikethroughSupported(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CLAUDE_CODE_FORCE_STRIKETHROUGH) return true;
  const term = env.TERM;
  if (env.TERM_PROGRAM === "Apple_Terminal" || term === "linux") return false;
  return STRIKE_TERMS.has(env.TERM_PROGRAM ?? "") || isGhostty(env) || isMintty(env) || env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
    || env.LC_TERMINAL === "iTerm2" || !!term?.includes("kitty") || !!term?.includes("alacritty") || !!term?.startsWith("foot")
    || !!env.KITTY_WINDOW_ID || !!env.ALACRITTY_LOG || !!env.KONSOLE_VERSION || !!env.WT_SESSION || !!env.ZED_TERM
    || parseInt(env.VTE_VERSION ?? "", 10) >= 4400;
}

/** `X3u` (bundle L181855) — mI's hyperlink-capable TERM_PROGRAM/LC_TERMINAL allowlist. */
const HYPERLINK_TERMS = new Set(["ghostty", "Hyper", "kitty", "alacritty", "iTerm.app", "iTerm2"]);

/** `mI` (bundle L181827) — the `supports-hyperlinks`-shaped gate, with `hgs`'s FORCE_HYPERLINK rule
 *  (L181771: any value forces ON except a non-empty one parsing to 0) hoisted to the front.
 *  DIVERGENCE: upstream also consults the npm `supports-hyperlink` probe of the real `process.stdout`
 *  (TTY + colour level + CI). That is a side channel a pure line producer must not read — every branch
 *  here is env-only, so the same env yields the same lines in a test, a pipe and a terminal. */
export function hyperlinksSupported(env: NodeJS.ProcessEnv = process.env): boolean {
  const force = env.FORCE_HYPERLINK;
  if (force !== undefined) return !(force.length > 0 && parseInt(force, 10) === 0);
  const prog = env.TERM_PROGRAM;
  if (prog && HYPERLINK_TERMS.has(prog)) return true;
  if (env.TERMINAL_EMULATOR === "JetBrains-JediTerm") return true;
  if (env.WT_SESSION && prog !== "tmux" && !env.TMUX) return true;
  if (prog === "tmux") {
    const [maj, min] = (env.TERM_PROGRAM_VERSION ?? "").split(".");
    const M = parseInt(maj ?? "", 10), m = parseInt(min ?? "", 10);
    if (M > 3 || (M === 3 && m >= 4)) return true;
  }
  if (env.LC_TERMINAL && HYPERLINK_TERMS.has(env.LC_TERMINAL)) return true;
  return !!env.TERM?.includes("kitty");
}

// ── links ───────────────────────────────────────────────────────────────────────────────────────────
const OSC8 = "\x1b]8;;", BEL = "\x07";                  // `vgp` / `Tgp` (bundle L393106)

/** `WhH` (L420727) — a `/C:/…` path from a Windows file URL loses its leading slash. */
const stripDriveSlash = (p: string) => (/^\/[A-Za-z]:(?=[\\/]|$)/.test(p) && isAbsolute(p.slice(1)) ? p.slice(1) : p);

/** `jhH` (L420707) — a `file:` href is normalised to an ABSOLUTE `file://` href (localhost authority
 *  dropped, percent-decoded, relative paths resolved against cwd, `#`/`?` tail preserved). */
function fileHref(href: string): string {
  if (!/^file:/i.test(href)) return href;
  let rest = href.slice(5);
  if (rest.startsWith("//")) { rest = rest.slice(2); if (rest === "localhost") rest = "/"; else if (rest.startsWith("localhost/")) rest = rest.slice(9); }
  const q = rest.search(/[#?]/), tail = q === -1 ? "" : rest.slice(q);
  let p = q === -1 ? rest : rest.slice(0, q);
  if (p === "") return href;
  try { p = decodeURIComponent(p); } catch { /* upstream swallows a malformed escape and keeps the raw path */ }
  p = stripDriveSlash(p);
  return pathToFileURL(isAbsolute(p) ? p : resolve(process.cwd(), p)).href + tail;
}

/** `ZF` (bundle L393098). `o` is "the text IS the url" (upstream strips ANSI from it first; ours is
 *  already plain). Supported → OSC-8 open + text + OSC-8 close; unsupported → `text (url)`, or the bare
 *  url when they are the same — and NOTE that branch returns UNCOLOURED text, which is why the caller
 *  only attaches the link colour on the supported path. */
function osc8(href: string, text: string, supported: boolean): string {
  const same = text === href || href === `http://${text}` || href === `https://${text}`;
  if (!supported) return same ? href : `${text} (${href})`;
  return `${OSC8}${href}${BEL}${text}${OSC8}${BEL}`;
}

/** ZF's `(isLightTheme ? vt.blue : vt.blueBright)` — chalk constants, so these are bare ANSI names that
 *  `resolveThemeColor` passes straight through to Ink. Read per call so /theme repaints the next render. */
const linkColor = () => (isLightTheme(currentTheme()) ? "blue" : "blueBright");

/** `codespan` takes the theme's `permission` token (pack §1.8, L420603–420604) — read per call so a
 *  mid-session setTheme() repaints the next render. (`permission` and `suggestion` are byte-identical
 *  in all four shipped themes, so this is a fidelity-of-source change, not a visible one.) */
const codeColor = () => resolveThemeColor(themeTokens().permission);

/** marked inline tokens → segments, accumulating `style` down the tree. `text` tokens may themselves
 *  carry nested tokens (entity escapes, or the inline body of a list item's text token). */
export function inlineSegments(tokens: Token[], style: InlineStyle): Segment[] {
  const out: Segment[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "strong": out.push(...inlineSegments(t.tokens ?? [], { ...style, bold: true })); break;
      case "em": out.push(...inlineSegments(t.tokens ?? [], { ...style, italic: true })); break;
      case "link": {
        // `case "link"` (bundle L420625–420640). Two upstream branches are UNREACHABLE for us and are
        // deliberately not ported: the `Oro(href)` arm (L420631–420639) and every `⧉` (`Ib`) mechanic that
        // hangs off it. `Oro` is `AIg.test(href)` (L100700) = `^https://(claude\.ai|claude-ai\.staging\.ant\.dev)
        // /code/(artifact|frame)/<id>/?$` — a Claude ARTIFACT/frame url; `oPi` (L41476) is what prepends `⧉ `.
        // The only other ⧉ path is `if (!m && c && g && E)`, whose `E` requires a ⧉ ALREADY inside the link
        // text. So on our hrefs no reachable path emits ⧉, and `yAr`'s post-pass (L420511) is likewise a ⧉
        // de-duplicator that `continue`s out when no ⧉ is present — nothing for us to port.
        const lk = t as Tokens.Link;
        const suffix = lk.title ? ` ("${lk.title}")` : "";                     // L420626
        if (lk.href.startsWith("mailto:")) {                                   // L420627–420630
          const addr = lk.href.replace(/^mailto:/, "");
          out.push({ ...style, text: (lk.text && lk.text !== addr ? `${lk.text} (${addr})` : addr) + suffix });
          break;
        }
        const supported = hyperlinksSupported();
        const href = supported ? fileHref(lk.href) : lk.href;                  // `d = c ? jhH(href) : href`
        const inner = inlineSegments(lk.tokens ?? [], {}).map((s) => s.text).join("");
        out.push({ ...style, ...(supported && { color: linkColor() }), text: osc8(href, inner && inner !== lk.href ? inner : lk.href, supported) + suffix });
        break;
      }
      case "image": {                                                          // pack §1.9, L420619–420624
        const im = t as Tokens.Image;
        if (!im.text && !im.title) { out.push({ ...style, text: im.href }); break; }
        const alt = im.text ? `${im.text} ` : "", title = im.title ? ` "${im.title}"` : "";
        out.push({ ...style, text: `${alt}(${im.href}${title})` });            // alt carries its own trailing space
        break;
      }
      case "del":
        if (strikethroughSupported()) out.push(...inlineSegments(t.tokens ?? [], { ...style, strikethrough: true }));
        else out.push({ ...style, text: `~~${inlineSegments(t.tokens ?? [], {}).map((s) => s.text).join("")}~~` });
        break;
      case "codespan": out.push({ ...style, text: (t as Tokens.Codespan).text, color: codeColor() }); break;
      // A LOOSE task list nests marked 18's `checkbox` token inside the item's PARAGRAPH, i.e. right here;
      // the block walker already synthesizes the one `[x] `/`[ ] ` literal from `item.task`/`item.checked`
      // (pack §1.5 L420665), so emitting the token's raw on top of it would box the line twice.
      case "checkbox": break;
      case "escape": case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inlineSegments(tt.tokens, style));
        else out.push({ ...style, text: tt.text });
        break;
      }
      // `html` and anything else pass through as their raw source — the bundle's own fallthrough for
      // unknown token types (`return e.raw`, pack §1.10 L420705).
      default: out.push({ ...style, text: (t as { raw?: string }).raw ?? "" });
    }
  }
  return out;
}
