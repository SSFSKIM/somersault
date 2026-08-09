// tui/keys/editorAdapter.ts — the one place a canonical `KeyEvent`/`TextEvent` (keys/types.ts) is projected
// back onto the legacy `(input, KeyFlags)` pair `editor.applyKey` reads. F2 task 6: the composer stopped
// calling `useInput`, so the reducer no longer receives Ink's shape from Ink — it receives OUR shape,
// re-projected here. The reducer itself is untouched (it is pure, snapshot-tested, and shared).
//
// Two mappings are load-bearing and would silently kill a live editor key if "simplified":
//  * `ctrl+_` → `input: "\x1f"` with NO flags. The undo branch (editor.ts:278) matches the bare C0 byte,
//    because that is exactly what a terminal sends and what Ink handed over. `{input:"_",key:{ctrl:true}}`
//    would fall into the ctrl switch's default and undo would quietly stop working.
//  * `ctrl+j` → `input: "\n"` with NO flags: the reducer inserts it (newline), and the ctrl switch has no
//    "j" case, so carrying the ctrl flag would eat the keystroke instead.
// `alt` becomes `meta`: the reducer's word-movement/yank-pop branch is written in Ink's vocabulary, which
// fuses the two (keys/types.ts says the same about the event side).
import type { KeyFlags } from "../editor.js";
import type { KeyEvent, TextEvent } from "./types.js";

/** Named keys → the reducer's boolean. Names with no editor meaning (pageup/insert/f1…) are absent on purpose:
 *  they arrive as an empty `input` with no flag set, which `applyKeyInner` returns unchanged.
 *
 *  WAVE C t3: `home`/`end` USED to be in that absent set, and that was the whole bug — upstream handles both
 *  inside its text-input key switch (annex §C7.5, bundle L395798) and binds them in no keymap table, so a port
 *  that dropped them here had no other route to the reducer and the two keys did nothing at all. They map onto
 *  `KeyFlags.home`/`.end`, which exist for this projection alone (Ink never delivered either — keys/types.ts
 *  §1.1 — so there is no ink flag to borrow). ctrl+home/ctrl+end are projected the same way and declined by
 *  the reducer, which is upstream's own `if (Pe.ctrl) return`. */
const NAMED: Record<string, keyof KeyFlags> = Object.assign(Object.create(null), {
  enter: "return", escape: "escape", tab: "tab", backspace: "backspace", delete: "delete",
  up: "upArrow", down: "downArrow", left: "leftArrow", right: "rightArrow",
  home: "home", end: "end",
});
/** Raw C0 bytes the reducer matches on directly, flags and all stripped (see the header). Null-prototype like
 *  the t2 spec tables: `e.name in RAW` must never see Object.prototype. */
const RAW: Record<string, string> = Object.assign(Object.create(null), { "_": "\x1f", j: "\n" });

export function toKeyFlags(e: KeyEvent | TextEvent): { input: string; key: KeyFlags } {
  // `paste` is the one piece of event identity that survives this projection. Everything else about a text
  // event is already in `input`, but provenance is not recoverable from the characters — and it is the whole
  // basis of the chip decision (editor.ts `KeyFlags.paste`), so dropping it here would silently chip a
  // fast-typed run and never chip a real paste.
  if (e.kind === "text") return { input: e.text, key: e.paste ? { paste: true } : {} };
  if (e.ctrl && !e.alt && !e.super && e.name in RAW) return { input: RAW[e.name], key: {} };
  const key: KeyFlags = {};
  if (e.ctrl) key.ctrl = true;
  if (e.alt) key.meta = true;
  if (e.shift) key.shift = true;
  const named = NAMED[e.name];
  if (named) { key[named] = true; return { input: "", key }; }
  if (e.name === "space") return { input: " ", key };
  // A literal character: the parser lowercased it and recorded the shift, so re-case it here — the reducer
  // inserts `input` verbatim.
  if (e.name.length === 1) return { input: e.shift ? e.name.toUpperCase() : e.name, key };
  return { input: "", key };                                  // pageup/pagedown/insert/f1–f12: a no-op edit
}
