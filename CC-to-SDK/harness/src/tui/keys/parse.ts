// tui/keys/parse.ts — our own byte-level keypress parser: one raw stdin chunk in, a list of `InputEvent`s out.
// Pure functions, no React, no Ink. It exists because P86 measured that Ink's `useInput` projects every key
// onto a fixed 14-boolean record and discards `keypress.name`, collapsing home ≡ end ≡ insert ≡ F1–F12 into
// one indistinguishable event (§1.1), alt+arrow ≡ super+arrow (§1.2), and leaking CSI-u / SGR mouse / focus /
// bracketed-paste bytes into the composer as insertable text (§1.7–§1.9). Every byte string handled below is a
// row of that live matrix. Four names deliberately depart from Ink's parse-keypress toward upstream Claude
// Code's naming (§4): \x00 is ctrl+space (not ctrl+backtick), \x08 is ctrl+h (not "backspace"), \x7f is
// backspace (not "delete"), and ESC-CR is shift+enter.
//
// One chunk = one call. Ink has no escape timeout and neither do we (§1.10): a trailing lone ESC is `escape`,
// and a sequence torn across a read boundary parses as whatever each half looks like on its own.
import type { InputEvent, KeyEvent } from "./types.js";

interface Mods { ctrl?: boolean; alt?: boolean; shift?: boolean; super?: boolean }

const key = (name: string, raw: string, m: Mods = {}): KeyEvent =>
  ({ kind: "key", name, ctrl: !!m.ctrl, alt: !!m.alt, shift: !!m.shift, super: !!m.super, raw });
const ignored = (reason: "mouse" | "focus" | "unknown-sequence", raw: string): InputEvent => ({ kind: "ignored", reason, raw });

/** xterm's `1;N` modifier param: N-1 is a bitfield. */
const decodeMods = (param?: string): Mods => {
  const bits = (param ? Number(param) : 1) - 1;
  if (!Number.isFinite(bits) || bits < 0) return {};
  return { shift: !!(bits & 1), alt: !!(bits & 2), ctrl: !!(bits & 4), super: !!(bits & 8) };
};

/** Printable = anything a terminal would insert. 0x80+ is included so that a UTF-8 codepoint read under a
 *  latin1 stdin encoding (the P86 §1.8 fix for lossless bytes) survives as one text run instead of splitting. */
const isPrintable = (code: number): boolean => code >= 0x20 && code !== 0x7f;

/** A literal character as a key: name is the lowercased char, uppercase implies shift. */
const printableKey = (ch: string, raw: string, m: Mods = {}): KeyEvent => {
  const lower = ch.toLowerCase();
  return key(lower, raw, { ...m, shift: !!m.shift || lower !== ch });
};

const CTRL_PUNCT: Record<number, string> = { 0x1c: "\\", 0x1d: "]", 0x1e: "^", 0x1f: "_" };
const TILDE: Record<string, string> = {
  "1": "home", "7": "home", "4": "end", "8": "end", "2": "insert", "3": "delete", "5": "pageup", "6": "pagedown",
  "11": "f1", "12": "f2", "13": "f3", "14": "f4", "15": "f5",
  "17": "f6", "18": "f7", "19": "f8", "20": "f9", "21": "f10", "23": "f11", "24": "f12",
};
const CSI_LETTER: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" };
const SS3: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", P: "f1", Q: "f2", R: "f3", S: "f4" };
/** CSI-u codepoints that name a key rather than insert a character. */
const CSIU_NAMED: Record<number, string> = { 9: "tab", 13: "enter", 27: "escape", 32: "space", 127: "backspace" };

const PASTE_END = "\x1b[201~";
const CSI_RE = /^\x1b\[([\d;]*)([A-Za-z~])/;
const SGR_MOUSE_RE = /^\x1b\[<[\d;]*[Mm]/;

/** Parse one raw stdin chunk. Never throws; anything unrecognised is consumed as `ignored`, never inserted. */
export function parseBytes(chunk: string): InputEvent[] {
  const out: InputEvent[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "\x1b") { i += parseEscape(chunk, i, out); continue; }
    const code = chunk.charCodeAt(i);
    if (!isPrintable(code)) { out.push(parseControl(chunk[i], code)); i += 1; continue; }
    let j = i + 1;
    while (j < chunk.length && isPrintable(chunk.charCodeAt(j))) j += 1;
    const run = chunk.slice(i, j);
    out.push(run.length === 1 ? printableKey(run, run) : { kind: "text", text: run, raw: run });
    i = j;
  }
  return out;
}

/** C0 controls + DEL. 0x1b never arrives here — the caller routes ESC to `parseEscape` first. */
function parseControl(ch: string, code: number): KeyEvent {
  if (code === 0x00) return key("space", ch, { ctrl: true });          // upstream naming; Ink says ctrl+backtick
  if (code === 0x09) return key("tab", ch);
  if (code === 0x0d) return key("enter", ch);
  if (code === 0x7f) return key("backspace", ch);                      // upstream naming; Ink says "delete"
  if (code in CTRL_PUNCT) return key(CTRL_PUNCT[code], ch, { ctrl: true });  // 0x1c–0x1f: Ink drops these entirely
  return key(String.fromCharCode(code + 96), ch, { ctrl: true });      // 0x01–0x1a → ctrl+a..ctrl+z (incl. \n = ctrl+j)
}

/** Handles one ESC-introduced sequence starting at `i`. Returns how many chars it consumed. */
function parseEscape(s: string, i: number, out: InputEvent[]): number {
  const next = s[i + 1];
  // Lone ESC at the end of a chunk, or ESC ESC: each ESC is its own `escape`, so an Esc-Esc chord that lands
  // in one chunk still reads as two presses.
  if (next === undefined || next === "\x1b") { out.push(key("escape", s.slice(i, i + 1))); return 1; }
  if (next === "[") return parseCsi(s, i, out);
  if (next === "O") return parseSs3(s, i, out);
  if (next === "\r") { out.push(key("enter", s.slice(i, i + 2), { shift: true })); return 2; }   // /terminal-setup's shift+enter
  if (next === "\x7f") { out.push(key("backspace", s.slice(i, i + 2), { alt: true })); return 2; }
  if (isPrintable(s.charCodeAt(i + 1))) { out.push(printableKey(next, s.slice(i, i + 2), { alt: true })); return 2; }
  out.push(key("escape", s.slice(i, i + 1)));   // ESC + a control byte: escape, then re-parse the byte itself
  return 1;
}

function parseCsi(s: string, i: number, out: InputEvent[]): number {
  const rest = s.slice(i);
  if (rest[2] === "<") {                                    // SGR mouse (?1006h) — the only mouse encoding we ask for
    const m = SGR_MOUSE_RE.exec(rest);
    if (!m) { out.push(ignored("unknown-sequence", rest)); return rest.length; }
    out.push(ignored("mouse", m[0])); return m[0].length;
  }
  if (rest[2] === "M") { const raw = rest.slice(0, 6); out.push(ignored("mouse", raw)); return raw.length; }  // X10: 3 payload bytes
  const m = CSI_RE.exec(rest);
  if (!m) { out.push(ignored("unknown-sequence", rest)); return rest.length; }   // truncated at the chunk boundary
  const [raw, params, final] = m;
  const parts = params.split(";");
  if (final === "~") {
    // Paste markers first: a literal tilde-table lookup would call 200/201 unknown and leak the payload.
    if (params === "200") return parsePaste(s, i, raw.length, out);
    const name = TILDE[parts[0]];
    if (!name) { out.push(ignored("unknown-sequence", raw)); return raw.length; }
    out.push(key(name, raw, decodeMods(parts[1])));
    return raw.length;
  }
  if (final === "u") {                                      // kitty/iTerm2 CSI-u; Ink 5 has no support at all
    const code = Number(parts[0]);
    if (parts[0] === "" || !Number.isFinite(code)) { out.push(ignored("unknown-sequence", raw)); return raw.length; }
    const mods = decodeMods(parts[1]);
    const named = CSIU_NAMED[code];
    out.push(named ? key(named, raw, mods) : printableKey(String.fromCharCode(code), raw, mods));
    return raw.length;
  }
  if (final === "Z") { out.push(key("tab", raw, { ...decodeMods(parts[1]), shift: true })); return raw.length; }
  if (final === "I" || final === "O") { out.push(ignored("focus", raw)); return raw.length; }
  const name = CSI_LETTER[final];
  if (!name) { out.push(ignored("unknown-sequence", raw)); return raw.length; }
  out.push(key(name, raw, decodeMods(parts[1])));
  return raw.length;
}

/** `\x1b[200~ … \x1b[201~` → one text event, markers stripped. An unterminated paste takes the rest of the
 *  chunk as payload (a paste torn across reads is better delivered late than dropped). */
function parsePaste(s: string, i: number, headLen: number, out: InputEvent[]): number {
  const start = i + headLen;
  const end = s.indexOf(PASTE_END, start);
  const payload = end === -1 ? s.slice(start) : s.slice(start, end);
  const consumed = (end === -1 ? s.length : end + PASTE_END.length) - i;
  if (payload.length > 0) out.push({ kind: "text", text: payload, raw: s.slice(i, i + consumed) });
  return consumed;
}

function parseSs3(s: string, i: number, out: InputEvent[]): number {
  const ch = s[i + 2];
  if (ch === undefined) { out.push(printableKey("O", s.slice(i, i + 2), { alt: true })); return 2; }  // torn: ESC O ≡ alt+O
  const raw = s.slice(i, i + 3);
  const name = SS3[ch];
  if (!name) { out.push(ignored("unknown-sequence", raw)); return raw.length; }
  out.push(key(name, raw));
  return raw.length;
}
