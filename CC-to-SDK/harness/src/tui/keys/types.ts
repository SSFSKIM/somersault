// tui/keys/types.ts — the vocabulary the F2 keymap is written in. `InputEvent` is what our own byte-level
// parser (parse.ts) produces and what normalize/resolver/provider consume; it deliberately carries the key
// identity Ink's `useInput` throws away (P86 §1.1: home ≡ end ≡ insert ≡ F1–F12 through Ink).
export type KeyContextName = "Global" | "Chat" | "Autocomplete" | "Confirmation" | "Help" | "Transcript"
  | "HistorySearch" | "Task" | "ThemePicker" | "Settings" | "Tabs" | "Attachments" | "Footer"
  | "MessageSelector" | "DiffDialog" | "DiffPanel" | "ModelPicker" | "Select" | "SelectDecision"
  | "SessionPicker" | "Plugin" | "Scroll" | "EffortDialog";

/** A single key press. `name` is the canon: a literal lowercase character for letters/digits/punctuation, or
 *  one of `enter escape tab space backspace delete up down left right home end pageup pagedown insert f1..f12`.
 *  `alt` fuses alt and meta (upstream does not distinguish them); `super` is the xterm bit-8 modifier. */
export interface KeyEvent { kind: "key"; name: string; ctrl: boolean; alt: boolean; shift: boolean; super: boolean; raw: string }
/** Insertable text: a multi-character printable run in one chunk, or a bracketed-paste payload. `paste` marks
 *  the second case — the provider assembles bracketed pastes across chunks (parse.ts sees one chunk and cannot
 *  know), and the composer's chip path keys off this PROVENANCE, never off size: a 900-character run someone
 *  typed stays literal where the same bytes pasted collapse to `[Pasted text #N]` (F5 task 3). */
export interface TextEvent { kind: "text"; text: string; raw: string; paste?: true }
/** A button/pointer report from an SGR (?1006) mouse report, under whatever tracking `altScreen.ts` arms
 *  (`MouseMode` — "off"/"scroll"/"full"; the dispatch gate in `KeymapProvider.tsx` enforces the mode, this type
 *  is shape-only). `col`/`row` are the terminal's own 1-based cell coordinates, passed through undisturbed and
 *  kept 1-based end to end (spec v2 decision — never converted to 0-based anywhere downstream); they are the
 *  entire content of a click, which is why it cannot be a `KeyEvent` the way a wheel tick is (a tick means
 *  "move the page" and has no target; a click IS its target).
 *    A DISCRIMINATED UNION ON `action`, widened by F9 T-MOUSE task 2 to carry motion/drag once `altScreen.ts`
 *  arms `?1002`/`?1003` (the "full" default): `press`/`release`/`drag` carry `button` (the low two bits: 0
 *  left, 1 middle, 2 right — a drag is "this button is held while the pointer moves"); `motion` is bare pointer
 *  travel with no button down at all and carries NO `button` field — there is nothing to name, and a consumer
 *  that defaulted a missing button to 0 would read every hover as a phantom left-click. The anonymous "no
 *  button" code that is NEITHER a press/release NOR motion (bit 32 unset, low bits 3) never reaches here —
 *  parse.ts drops it, same as before.
 *    THE NAME IS `MouseInputEvent`, NOT `MouseEvent`, ON PURPOSE: tsconfig sets no `lib` override, so the DOM's
 *  global `MouseEvent` is in scope and a consumer that forgot the import would silently bind THAT and typecheck
 *  clean, all the way to a runtime shape mismatch.
 *    T-LINKOPEN Task 3 — `isWindowActivation`, OPTIONAL AND ONLY EVER TRUE. `KeymapProvider`'s dispatch is the
 *  one place that sees every parsed `InputEvent` in true stream order, so it alone can answer "was the event
 *  immediately before THIS press a terminal focus-in report" (canon's own `pressIsWindowActivation`,
 *  research-links.md §3c) — and it stamps that answer onto a `press` event alone (a release pairs with the
 *  press that recorded it, via the CALLER's own tap anchor, never with this field). Absent rather than `false`
 *  on every ordinary press: `keys-provider.test.tsx`'s own `toEqual` pins the exact shape a press carries when
 *  nothing preceded it, and an unconditional `false` would fail that pin for a case the field was never meant
 *  to touch. */
export type MouseInputEvent =
  | { kind: "mouse"; action: "press" | "release" | "drag"; button: 0 | 1 | 2;
      col: number; row: number; ctrl: boolean; alt: boolean; shift: boolean; raw: string; isWindowActivation?: true }
  | { kind: "mouse"; action: "motion";
      col: number; row: number; ctrl: boolean; alt: boolean; shift: boolean; raw: string };
/** Consumed and deliberately dropped — must never reach the composer as text (P86 §1.8). */
export interface IgnoredEvent { kind: "ignored"; reason: "mouse" | "focus" | "unknown-sequence"; raw: string }
export type InputEvent = KeyEvent | TextEvent | MouseInputEvent | IgnoredEvent;
