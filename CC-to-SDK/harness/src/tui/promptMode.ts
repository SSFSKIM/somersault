// tui/promptMode.ts — the composer's input MODE and its one-character prefix vocabulary. A LEAF: this module
// has no imports at all, runtime or type, and nothing may be added to it that does. That is its whole job.
//
// It exists because the three prefix helpers used to live in `promptHistory.ts`, which imports `node:fs`,
// `node:crypto` (via `pasteCache`) and `node:os`/`node:path` (via `fleet/paths`). `editorHistory.ts` needed
// exactly one of them — a `startsWith("!")` test — and importing it dragged that whole filesystem graph into
// the runtime closure of a reducer whose header promises "no React/Ink/fs" (t7 review, I2).
//
// TRACED after the move, and the claim is checkable by eye: `editor.ts` imports `completions`, `pasteChips`,
// `editorHistory` and this file; `completions` (F5 t10) imports `editor`, `fileComplete`, `commandComplete`,
// `completionTriggers`, `editorHistory` and this file; `editorHistory` imports `pasteChips` and this file;
// `pasteChips` imports `editor`; `fileComplete`/`commandComplete` are pure ranking and `completionTriggers`
// (F5 t9) imports nothing at all. Not one of them reaches a `node:` builtin. The filesystem enters only at
// `ChatComposer`, which is where the side effects belong.
//
// Bundle provenance (2.1.220): `hon` L236123 · `mP` L236131 · `LV` L236136 — the mode ⇄ prefix trio the
// submit site (L548774) and every reader (L489529/L489691) go through.
//
// WAVE C TASK 14 COLLAPSED THIS FILE FROM THREE MODES TO TWO. `#` (memory) was ccx's own third mode, recorded
// as CM65; the spec's owner-decision section removed it, because upstream's composer resolver at 2.1.220 (and
// 2.1.222) answers `prompt | bash` and nothing else. That removal also took the file's SECOND derivation with
// it: `modeOfDisplay` (`mP`) existed only because our three-valued read and upstream's two-valued one were
// genuinely different answers to the same question, and a two-valued union makes them the same answer under
// two spellings (plan-review #23). One reading survives — `composerMode` — and the two sites that need
// upstream's own word for the non-bash case (`useChat`'s queue entry, `editorHistory.historyEntryIsBash`)
// spell the rename at their own call, where the wire format that demands it is visible.

/** The composer's two input modes — upstream's `prompt | bash` under this port's own names (`normal` is its
 *  `prompt`). Declared HERE rather than in editor.ts so that a module which only needs to name a mode does not
 *  have to import the reducer; `editor.ts` re-exports it, so every existing
 *  `import type { InputMode } from "./editor.js"` keeps working. */
export type InputMode = "bash" | "normal";

/** THE derivation, and now the only one — upstream's `mP` (L236131) with `normal` where it says `prompt`.
 *  Everything derives from the DISPLAY, which is the only thing that survives a round trip through
 *  `history.jsonl`: before this was shared (t7 review, M1) the submit path and the disk seed each read the
 *  buffer their own way, and the same prompt carried a different `mode` in-session than it did after a reseed.
 *
 *  The prefix is upstream's `hon`/`mP` `!` and only `!`. */
export function composerMode(display: string): InputMode { return display.startsWith("!") ? "bash" : "normal"; }

/** `hon` (L236123). The submit site's `display` builder: bash prompts persist with their `!`. */
export function displayForMode(text: string, mode: "prompt" | "bash"): string { return mode === "bash" ? `!${text}` : text; }

/** `LV` (L236136). Strips ONE `!` and only from a bash display, so a prompt that legitimately begins `!!`
 *  keeps its second bang when it comes back. */
export function stripModePrefix(display: string): string { return composerMode(display) === "bash" ? display.slice(1) : display; }
