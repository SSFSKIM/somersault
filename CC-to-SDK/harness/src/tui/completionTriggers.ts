// tui/src/completionTriggers.ts — where the composer's two autocomplete popups decide they are OPEN, and over
// which span of text. The F5 plan's second pre-allocated editor.ts split: editor.ts owns the buffer, this file
// owns the question "is the caret in a `/command` or an `@mention` right now, and what is the token?".
//
// PURE, and deliberately import-free — not one `node:` specifier, not even a sibling module. It is called from
// inside the editor reducer's closure, which a lint test pins fs-free (the `promptMode.ts` precedent), and a
// trigger scanner has no business reaching anything anyway: it is three regexes and a set.

/** `tRb` (bundle L490128): `new Set([...Izo, "resume", "plugin", "plugins", "marketplace"])`, with
 *  `Izo = new Set(["add-dir", "cd"])` (L432347). These six are exactly the commands that own their OWN
 *  argument completer upstream — `add-dir`/`cd` complete directories off the args (L490707) and `resume`
 *  completes session titles (L490721) — so suppressing the command trigger is how the argument completer gets
 *  the popup instead of fighting the command list for it. It suppresses the TRIGGER, never the item list:
 *  `/resume` typed out still submits and still runs. */
export const COMMAND_DENYLIST: ReadonlySet<string> = new Set(["add-dir", "cd", "resume", "plugin", "plugins", "marketplace"]);

/** `Pli`'s opening arm (bundle L489936–L489940), verbatim apart from the boundary: upstream splits the leading
 *  command name on `" "` because its input is one flat line, ours splits on any whitespace because our buffer
 *  can hold a newline where upstream's cannot. */
export function denylistedCommand(buffer: string): boolean {
  if (!buffer.startsWith("/")) return false;
  return COMMAND_DENYLIST.has(buffer.slice(1).split(/\s/)[0]);
}

/** OURS, not upstream's `Pli`: the buffer-leading `/` that opens our one command popup. `Pli`'s regex CANNOT
 *  match a leading slash (it demands a whitespace/CJK character in front of it), and its `startsWith("/")` arm
 *  is only the denylist guard returning null. Upstream reaches the leading-slash command LIST through a
 *  different branch entirely — `YRr(mt) && kt > 0` at L490747, keyed on the whole input rather than on `Pli` —
 *  and that branch is what this arm transcribes, including its `cursor > 0` — and including the fact that
 *  the input it reads is the WHOLE buffer. `scanCommand` is handed one ROW at a time, so the arm additionally
 *  demands `text === buffer`: upstream's `YRr` feeds the whole input to `KJa`, whose class rejects `\n`, so a
 *  multiline buffer can never reach the leading-slash list. Without that check `["/model", "foo"]` with the
 *  caret arrowed back to row 0 opened the head popup, and Enter submitted `/model` and destroyed `foo` —
 *  the head accept replaces the whole buffer by construction (t9 review, I1). */
const COMMAND_HEAD = /^\/(\S*)$/;
/** `Pli`'s trigger (bundle L489941) and the token class it extends with (L489943). */
const COMMAND_TRIGGER = /[\s。、？！]\/([a-zA-Z0-9._:-]*)$/;
const COMMAND_TOKEN = /^[a-zA-Z0-9._:-]*/;
/** `ARb` (bundle L491153) — full path characters, or a quoted `@"my file.ts"` (possibly still unclosed). */
const MENTION_TRIGGER = /(^|[\s。、？！])@([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|"[^"]*"?)$/u;
/** `D9f` (L491153) and `bZe`'s quoted tail (L490473) — how each token is extended PAST the cursor. */
const MENTION_TOKEN = /^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+/u;
const MENTION_QUOTED_TAIL = /^[^"]*"?/;
/** `KJa` (L489968), inverted: the leading name is a plain command token. Gates CM38's empty message. */
export const isCommandToken = (s: string): boolean => !/[^a-zA-Z0-9.:\-_]/.test(s);

/** `start` is the index of the `/` or `@` itself; `end` is one PAST the token's last character, which may sit
 *  past the cursor — both upstream scanners extend the token forward (`Pli`'s `a`, `bZe`'s `D9f` tail), and
 *  accepting a suggestion replaces this whole span, so a mid-text completion leaves the rest of the line
 *  alone. `head` distinguishes our retained leading-slash arm from `Pli`'s mid-text one; the two accept
 *  differently (see editor.ts's `acceptCommand`). */
export interface CommandTrigger { start: number; end: number; query: string; head: boolean }
export interface MentionTrigger { start: number; end: number; query: string; quoted: boolean }

/** Scan `text` for a command trigger with the caret at `cursor`. `buffer` is the WHOLE input the denylist
 *  guard reads (upstream's `e`); it defaults to `text` for the single-line case and for direct testing. */
export function scanCommand(text: string, cursor: number, buffer: string = text): CommandTrigger | null {
  if (denylistedCommand(buffer)) return null;
  const head = COMMAND_HEAD.exec(text);
  if (head && cursor > 0 && text === buffer) return { start: 0, end: text.length, query: head[1], head: true };
  const m = COMMAND_TRIGGER.exec(text.slice(0, cursor));
  if (!m || m.index === undefined) return null;
  const start = m.index + 1;                                 // upstream's `o`: the `/`, one past the boundary char
  // `Pli`'s `a` — the token measured from the FULL text, so it runs past the caret. (Its follow-up guard
  // `if (t > o + 1 + a.length) return null` is unreachable: the `$`-anchored match above makes the
  // before-cursor capture a prefix of `a`, so the caret is always inside the token. Transcribed as this note.)
  const query = COMMAND_TOKEN.exec(text.slice(start + 1))![0];
  // `zJa` (L489952) opens with `if (!e) return null` — upstream suggests nothing for a bare mid-text `/`, and
  // that guard is the whole reason a prose " / " does not fling the entire command catalog open.
  if (!query) return null;
  return { start, end: start + 1 + query.length, query, head: false };
}

/** Scan `text` for an `@`-mention trigger with the caret at `cursor`. */
export function scanMention(text: string, cursor: number): MentionTrigger | null {
  const m = MENTION_TRIGGER.exec(text.slice(0, cursor));
  if (!m || m.index === undefined) return null;
  const start = m.index + m[1].length;                       // past the boundary char (or 0 for `^`): the `@`
  const raw = m[2];
  const after = text.slice(cursor);
  if (raw.startsWith("\"")) {
    const whole = raw + (MENTION_QUOTED_TAIL.exec(after)?.[0] ?? "");
    return { start, end: start + 1 + whole.length, query: whole.slice(1).replace(/"$/, ""), quoted: true };
  }
  const whole = raw + (MENTION_TOKEN.exec(after)?.[0] ?? "");
  return { start, end: start + 1 + whole.length, query: whole, quoted: false };
}

/** `oQa` (bundle L490424) as the two file accepts call it (L490938 and L491021): `isComplete` adds the
 *  trailing space, and the quoted `@"…"` form is picked by `if (i || o)` (L490426) — EITHER argument, where
 *  `o` is `needsQuotes` (`kt.displayText.includes(" ")`, the only way a path with a space survives the round
 *  trip back through `ARb`) and `i` is `isQuoted`, the flag the SCANNER set because the user opened a quote.
 *  Both accept sites pass both. Honouring only `needsQuotes` meant `@"src` + Tab on `src/app.ts` inserted a
 *  bare `@src/app.ts ` and silently dropped the quote the user had typed (t9 review, M3). */
export function mentionInsertion(path: string, quoted = false): string {
  return quoted || path.includes(" ") ? `@"${path}" ` : `@${path} `;
}
