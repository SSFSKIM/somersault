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
import type { IgnoredEvent, InputEvent, KeyEvent, MouseInputEvent } from "./types.js";

interface Mods { ctrl?: boolean; alt?: boolean; shift?: boolean; super?: boolean }

const key = (name: string, raw: string, m: Mods = {}): KeyEvent =>
  ({ kind: "key", name, ctrl: !!m.ctrl, alt: !!m.alt, shift: !!m.shift, super: !!m.super, raw });
const ignored = (reason: IgnoredEvent["reason"], raw: string): IgnoredEvent => ({ kind: "ignored", reason, raw });

/** xterm's `1;N` modifier param: N-1 is a bitfield. */
const decodeMods = (param?: string): Mods => {
  const bits = (param ? Number(param) : 1) - 1;
  if (!Number.isFinite(bits) || bits < 0) return {};
  return { shift: !!(bits & 1), alt: !!(bits & 2), ctrl: !!(bits & 4), super: !!(bits & 8) };
};

/** Printable = anything a terminal would insert. 0x80+ is included so that a UTF-8 codepoint read under a
 *  latin1 stdin encoding (the P86 §1.8 fix for lossless bytes) survives as one text run instead of splitting. */
const isPrintable = (code: number): boolean => code >= 0x20 && code !== 0x7f;

/** A literal character as a key: name is the lowercased char, uppercase implies shift. A lone space is named
 *  `space`, not `" "` — \x00 (ctrl+space) and CSI-u 32 already spell it that way, and six upstream bindings are
 *  written `space`, so the one physical key must not carry two names. Spaces inside a text run stay literal. */
const printableKey = (ch: string, raw: string, m: Mods = {}): KeyEvent => {
  if (ch === " ") return key("space", raw, m);
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

/** ESC-introduced *string* sequences (payload up to a terminator, never a key press). Without these, a terminal
 *  reply like an OSC 8 hyperlink or a DCS DECRQM answer parses as alt+] / alt+p followed by its payload as text. */
const STRING_INTRODUCER: Record<string, "osc" | "st-only"> = { "]": "osc", P: "st-only", _: "st-only", "^": "st-only" };
const ST = "\x1b\\";
const PASTE_END = "\x1b[201~";
const CSI_RE = /^\x1b\[([\d;]*)([A-Za-z~])/;
const SGR_MOUSE_RE = /^\x1b\[<([\d;]*)([Mm])/;

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
  if (next in STRING_INTRODUCER) return parseStringSeq(s, i, out);
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
    if (!m) return skipCsi(rest, out);
    out.push(sgrWheel(m[1], m[2], m[0]) ?? sgrClick(m[1], m[2], m[0]) ?? ignored("mouse", m[0])); return m[0].length;
  }
  if (rest[2] === "M") { const raw = rest.slice(0, 6); out.push(ignored("mouse", raw)); return raw.length; }  // X10: 3 payload bytes
  const m = CSI_RE.exec(rest);
  if (!m) return skipCsi(rest, out);
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
    // The upper bound keeps `fromCodePoint` from throwing on a garbage/oversized param — this parser never throws.
    if (parts[0] === "" || !Number.isInteger(code) || code > 0x10ffff) { out.push(ignored("unknown-sequence", raw)); return raw.length; }
    const mods = decodeMods(parts[1]);
    const named = CSIU_NAMED[code];
    out.push(named ? key(named, raw, mods) : printableKey(String.fromCodePoint(code), raw, mods));
    return raw.length;
  }
  if (final === "Z") { out.push(key("tab", raw, { ...decodeMods(parts[1]), shift: true })); return raw.length; }
  if (final === "I" || final === "O") { out.push(ignored("focus", raw)); return raw.length; }
  const name = CSI_LETTER[final];
  if (!name) { out.push(ignored("unknown-sequence", raw)); return raw.length; }
  out.push(key(name, raw, decodeMods(parts[1])));
  return raw.length;
}

/** THE TWO MOUSE REPORTS THAT ARE KEYS — canon `RUu`, L169140. A wheel tick is the one pointer gesture with no
 *  pointer in it: there is nothing to hit, nothing to drag, and the user means "move the page". So it becomes a
 *  real `KeyEvent` and travels the ordinary binding table (`Scroll`/`Transcript` bind it to their line pair),
 *  while every other mouse report stays `ignored("mouse")` exactly as before.
 *    Canon's mask is `button & 67` — bit 6 plus the two low bits — compared against 64/65. That is what strips
 *  the modifier bits (ctrl 16, meta 8, shift 4) and the motion flag (32) while keeping the horizontal pair
 *  (66/67) OUT: those are wheel-left/right, which no surface here scrolls. `m` is a button RELEASE and a wheel
 *  tick has none, so only `M` can be one.
 *    COL/ROW ARE DROPPED, and that is the divergence worth naming: canon dispatches a wheel to the scrollable
 *  UNDER THE CURSOR and only then to the focused element (L181210). We have one scrollable per surface and no
 *  hit-testing to do, so the position is information nothing downstream could use. */
function sgrWheel(params: string, final: string, raw: string): KeyEvent | null {
  if (final !== "M") return null;
  const button = Number(params.split(";")[0]);
  if (!Number.isInteger(button)) return null;
  const wheel = button & 67;
  if (wheel !== 64 && wheel !== 65) return null;
  return key(wheel === 64 ? "wheelup" : "wheeldown", raw,
    { ctrl: !!(button & 16), alt: !!(button & 8), shift: !!(button & 4) });
}

/** THE MOUSE REPORTS THAT ARE NEITHER KEYS NOR NOISE (spec §3.2). A button press/release keeps its position and
 *  becomes its own `InputEvent` variant, because unlike a wheel tick the position is the whole gesture: there is
 *  nothing to bind, only somewhere to hit. Three tests, in this order:
 *    `& 64` — NOT a wheel. This term is what makes the two decoders order-independent; drop it and 64/65/66
 *  alias onto low bits 0/1/2, so every wheel tick would also read as a left/middle/right press.
 *    `& 32` — NOT motion. We arm ?1000 only, which reports no motion at all, so this is defence against a
 *  terminal (or a multiplexer, or a user's own `?1002h`) that sends drags anyway: a drag is not a click, and
 *  v1 has no hover or selection engine to give it to.
 *    `& 3 !== 3` — a real button. 3 is the anonymous "button released / none" code of the pre-SGR encodings,
 *  which some terminals still send for a release even under 1006; without a button there is nothing to pair
 *  against a press, so it is dropped rather than guessed at.
 *  Modifier bits are canon's, shared with the wheel above (shift 4, meta 8 → our alt, ctrl 16). Both coordinates
 *  must be present and integral — `Number("")` is 0, not NaN, so an empty param would otherwise decode as a
 *  confident click at column 0 (a cell the terminal cannot address; it counts from 1). */
function sgrClick(params: string, final: string, raw: string): MouseInputEvent | null {
  const parts = params.split(";");
  if (parts.length !== 3 || parts.some(p => p === "")) return null;
  const [button, col, row] = parts.map(Number);
  if (!Number.isInteger(button) || !Number.isInteger(col) || !Number.isInteger(row)) return null;
  if ((button & 64) !== 0 || (button & 32) !== 0 || (button & 3) === 3) return null;
  return { kind: "mouse", action: final === "M" ? "press" : "release", button: (button & 3) as 0 | 1 | 2,
    col, row, ctrl: !!(button & 16), alt: !!(button & 8), shift: !!(button & 4), raw };
}

/** A CSI we don't recognise, consumed to its ECMA-48 boundary and no further: parameter bytes 0x30–0x3f, then
 *  intermediates 0x20–0x2f, then exactly one final byte 0x40–0x7e. Consuming the whole remaining chunk instead
 *  would let one unsolicited terminal reply (a `\x1b[?1;2c` DA answer, a `\x1b[?2004;1$y` mode report) swallow
 *  every keystroke that happened to arrive in the same read. Only a sequence with no final byte in this chunk is
 *  a real truncation; a byte outside both ranges ends it early so that byte still gets parsed on its own. */
function skipCsi(rest: string, out: InputEvent[]): number {
  let j = 2;
  while (j < rest.length) {
    const c = rest.charCodeAt(j);
    if (c >= 0x40 && c <= 0x7e) break;        // final byte: part of the sequence
    if (c < 0x20 || c > 0x3f) { j -= 1; break; }   // neither param nor intermediate: sequence ends before it
    j += 1;
  }
  const raw = rest.slice(0, Math.min(j + 1, rest.length));
  out.push(ignored("unknown-sequence", raw));
  return raw.length;
}

/** OSC / DCS / APC / PM: a payload string running to a terminator — ST (`\x1b\\`) for all four, and BEL for OSC
 *  as well. Consumed whole, so an `\x1b]8;;url\x07` hyperlink reply cannot reach the composer as alt+] plus its
 *  payload as insertable text. No terminator in this chunk means the payload is still arriving: take the rest. */
function parseStringSeq(s: string, i: number, out: InputEvent[]): number {
  const st = s.indexOf(ST, i + 2);
  const bel = STRING_INTRODUCER[s[i + 1]] === "osc" ? s.indexOf("\x07", i + 2) : -1;
  const end = st === -1 ? bel : bel === -1 ? st : Math.min(st, bel);
  const consumed = end === -1 ? s.length - i : end - i + (s[end] === "\x07" ? 1 : ST.length);
  out.push(ignored("unknown-sequence", s.slice(i, i + consumed)));
  return consumed;
}

/** `\x1b[200~ … \x1b[201~` → one text event, markers stripped. An unterminated paste takes the rest of the
 *  chunk as payload (a paste torn across reads is better delivered late than dropped).
 *
 *  NOT the live copy since F5 task 3: KeymapProvider's `emit()` cuts complete bracketed pastes out of the
 *  stream BEFORE `parseBytes` is called (only it can tag provenance and re-join markers torn across reads), so
 *  what still reaches here is the hand-fed / torn case — a test that calls the parser directly, or a chunk the
 *  provider handed over with its markers already consumed. Keep the two in step. */
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
