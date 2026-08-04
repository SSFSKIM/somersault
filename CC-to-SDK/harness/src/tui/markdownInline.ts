// tui/src/markdownInline.ts — the INLINE half of the F4 markdown engine: a recursive walker over
// `marked` inline tokens that emits our `Segment[]` instead of upstream's glued ANSI string
// (spec Decision Log "F4 design settlements"). Style flows DOWN by spreading, so nesting composes:
// `**bold *both***` yields one segment carrying bold AND italic — the old regex renderer could not
// express that at all.
import type { Token, Tokens } from "marked";
import type { Segment } from "./render.js";
import { resolveThemeColor, themeTokens } from "./theme.js";

export interface InlineStyle { bold?: boolean; italic?: boolean; strikethrough?: boolean; color?: string; dim?: boolean }

/** Port of the bundle's `dHn` (constants pack §1.7, L420498) terminal-capability gate for `del`.
 *  Task 3 fills in the TERM_PROGRAM allowlist + the `vt.level > 0` half; until then strikethrough is
 *  unconditionally supported so the `del` case takes its styled branch. */
export function strikethroughSupported(env: NodeJS.ProcessEnv = process.env): boolean { void env; return true; }

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
      case "del":
        if (strikethroughSupported()) out.push(...inlineSegments(t.tokens ?? [], { ...style, strikethrough: true }));
        else out.push({ ...style, text: `~~${inlineSegments(t.tokens ?? [], {}).map((s) => s.text).join("")}~~` });
        break;
      case "codespan": out.push({ ...style, text: (t as Tokens.Codespan).text, color: codeColor() }); break;
      case "escape": case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inlineSegments(tt.tokens, style));
        else out.push({ ...style, text: tt.text });
        break;
      }
      // `link`/`image`/`html` land in Task 3; until then they pass through as their raw source, which is
      // the bundle's own fallthrough for unknown token types (`return e.raw`, pack §1.10 L420705).
      default: out.push({ ...style, text: (t as { raw?: string }).raw ?? "" });
    }
  }
  return out;
}
