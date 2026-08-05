// tui/keys/types.ts — the vocabulary the F2 keymap is written in. `InputEvent` is what our own byte-level
// parser (parse.ts) produces and what normalize/resolver/provider consume; it deliberately carries the key
// identity Ink's `useInput` throws away (P86 §1.1: home ≡ end ≡ insert ≡ F1–F12 through Ink).
export type KeyContextName = "Global" | "Chat" | "Autocomplete" | "Confirmation" | "Help" | "Transcript"
  | "HistorySearch" | "Task" | "ThemePicker" | "Settings" | "Tabs" | "Attachments" | "Footer"
  | "MessageSelector" | "DiffDialog" | "DiffPanel" | "ModelPicker" | "Select" | "SelectDecision" | "Plugin" | "Scroll";

/** A single key press. `name` is the canon: a literal lowercase character for letters/digits/punctuation, or
 *  one of `enter escape tab space backspace delete up down left right home end pageup pagedown insert f1..f12`.
 *  `alt` fuses alt and meta (upstream does not distinguish them); `super` is the xterm bit-8 modifier. */
export interface KeyEvent { kind: "key"; name: string; ctrl: boolean; alt: boolean; shift: boolean; super: boolean; raw: string }
/** Insertable text: a multi-character printable run in one chunk, or a bracketed-paste payload. `paste` marks
 *  the second case — the provider assembles bracketed pastes across chunks (parse.ts sees one chunk and cannot
 *  know), and the composer's chip path keys off this PROVENANCE, never off size: a 900-character run someone
 *  typed stays literal where the same bytes pasted collapse to `[Pasted text #N]` (F5 task 3). */
export interface TextEvent { kind: "text"; text: string; raw: string; paste?: true }
/** Consumed and deliberately dropped — must never reach the composer as text (P86 §1.8). */
export interface IgnoredEvent { kind: "ignored"; reason: "mouse" | "focus" | "unknown-sequence"; raw: string }
export type InputEvent = KeyEvent | TextEvent | IgnoredEvent;
