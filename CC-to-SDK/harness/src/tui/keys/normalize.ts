// tui/keys/normalize.ts — the one place that decides what a written key spec ("ctrl+shift+p", "ctrl+x ctrl+k")
// means. Pure: no React, no Ink, no I/O. Binding tables, user keybindings.json overrides and hint strings all
// pass through here, so a spec and a parsed `KeyEvent` can be compared by exact equality instead of by a pile of
// per-call-site special cases.
//
// The canon is the task-1 parser's output (parse.ts), not the keyboard: names are lowercase, an uppercase letter
// arrives as its lowercase name plus `shift`, the space key is always named `space` (never `" "`), alt and meta
// are already one bit, and ctrl+- / ctrl+_ are the same byte (\x1f). Specs are normalized onto that canon here so
// that `eventMatches` can stay a strict five-field comparison.
import type { KeyEvent } from "./types.js";

export interface KeySpec { name: string; ctrl: boolean; alt: boolean; shift: boolean; super: boolean }

type ModName = "ctrl" | "alt" | "shift" | "super";
/** Modifier words. `meta`/`opt`/`option` fold into `alt` (the parser does not distinguish them); `cmd`/`command`/
 *  `win` fold into `super` (the xterm bit-8 modifier), which stays spellable as itself. */
const MODIFIERS: Record<string, ModName> = Object.assign(Object.create(null), {
  ctrl: "ctrl", control: "ctrl",
  alt: "alt", meta: "alt", opt: "alt", option: "alt",
  shift: "shift",
  super: "super", cmd: "super", command: "super", win: "super",
});
/** Name spellings that are not already the parser's name. Anything else passes through as written (lowercased) —
 *  tables legitimately name keys the parser never emits, e.g. the reserved `capslock`. Null-prototype (like
 *  MODIFIERS) so `constructor+p` / `__proto__` cannot resolve through Object.prototype into a bogus spec. */
const NAMES: Record<string, string> = Object.assign(Object.create(null), {
  esc: "escape", return: "enter", del: "delete", "↑": "up", "↓": "down", "←": "left", "→": "right",
});

/** Split a spec on `+`, treating a `+` that opens a token as the literal plus key (`ctrl++` → ctrl and `+`).
 *  A trailing separator therefore yields an empty final token, which the caller rejects as garbage. */
function splitSpec(spec: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of spec) {
    if (ch === "+" && buf !== "") { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
}

/** `"ctrl+shift+p"` → a spec, or null on garbage: empty, containing whitespace (that is the chord separator), or
 *  naming a modifier we do not know. Every token but the last is a modifier; the last is the key name. */
export function parseKeySpec(spec: string): KeySpec | null {
  const trimmed = spec.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  const tokens = splitSpec(trimmed);
  const raw = tokens.pop()!;
  if (raw === "") return null;
  const out: KeySpec = { name: "", ctrl: false, alt: false, shift: false, super: false };
  for (const t of tokens) {
    const mod = MODIFIERS[t.toLowerCase()];
    if (!mod) return null;
    out[mod] = true;
  }
  // A single uppercase letter is shorthand for shift+<letter>, matching how the parser reports one: `ctrl+B` and
  // `ctrl+shift+b` are the same key. Longer names are just case-insensitive (`ESC` is not shift+escape).
  if (raw.length > 1 && raw.includes("+")) return null;   // a leading `+` glued to a name ("+p") is no keyboard key
  if (raw.length === 1 && raw >= "A" && raw <= "Z") { out.name = raw.toLowerCase(); out.shift = true; }
  else { const lower = raw.toLowerCase(); out.name = NAMES[lower] ?? lower; }
  // ctrl+- / ctrl+_ / their shift+ spellings are all one byte (\x1f), which the parser reports as ctrl+`_` with
  // shift FALSE — canonicalize all four so upstream's undo aliases fire instead of being silently dead.
  if (out.ctrl && (out.name === "-" || out.name === "_")) { out.name = "_"; out.shift = false; }
  return out;
}

/** A whitespace-separated chord: `"ctrl+x ctrl+k"` → two specs. Null if empty or if any member is garbage. */
export function parseChordSpec(spec: string): KeySpec[] | null {
  const parts = spec.trim().split(/\s+/).filter((p) => p !== "");
  if (parts.length === 0) return null;
  const out: KeySpec[] = [];
  for (const p of parts) { const k = parseKeySpec(p); if (!k) return null; out.push(k); }
  return out;
}

/** The canonical string: modifiers in a fixed order so that any spelling of one key produces one string. Used as
 *  a Map key and for dedup; `formatKeySpec` is the same string because the canon is already readable. */
export function specKey(s: KeySpec): string {
  return `${s.ctrl ? "ctrl+" : ""}${s.alt ? "alt+" : ""}${s.shift ? "shift+" : ""}${s.super ? "super+" : ""}${s.name}`;
}

/** Strict: the name and all four modifiers must agree. A `g` binding must NOT fire on shift+g. */
export function eventMatches(e: KeyEvent, s: KeySpec): boolean {
  return e.name === s.name && e.ctrl === s.ctrl && e.alt === s.alt && e.shift === s.shift && e.super === s.super;
}

/** Display form for hints and the shortcuts overlay. */
export function formatKeySpec(s: KeySpec): string { return specKey(s); }
export function formatChord(c: KeySpec[]): string { return c.map(formatKeySpec).join(" "); }
