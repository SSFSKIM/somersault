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

/** The composer's three input modes. Declared HERE rather than in editor.ts so that a module which only
 *  needs to name a mode does not have to import the reducer; `editor.ts` re-exports it, so every existing
 *  `import type { InputMode } from "./editor.js"` keeps working. `memory` (`#`) is ours — recorded as CM65,
 *  upstream 2.1.220 has no `#` composer mode — which is exactly why the two-valued `mP` below cannot be the
 *  only derivation we own. */
export type InputMode = "bash" | "memory" | "normal";

/** THE derivation. One function, three callers that used to disagree (t7 review, M1): the submit path wrote
 *  `inputMode(state)` (three-valued, so a `#` prompt recorded `"memory"`) while the disk seed wrote a
 *  two-valued `bash | normal`, and the same prompt therefore carried a different `mode` in-session than it
 *  did after a reseed. Everything now derives from the DISPLAY, which is the only thing that survives a
 *  round trip through the file.
 *
 *  Prefixes are upstream's `hon`/`mP` for `!`; `#` is the ccx memory mode. */
export function composerMode(display: string): InputMode {
  if (display.startsWith("!")) return "bash";
  if (display.startsWith("#")) return "memory";
  return "normal";
}

/** `hon` (L236123). The submit site's `display` builder: bash prompts persist with their `!`. */
export function displayForMode(text: string, mode: "prompt" | "bash"): string { return mode === "bash" ? `!${text}` : text; }

/** `mP` (L236131). Upstream's TWO-valued read — it has no memory mode, so `#` is an ordinary prompt to it.
 *  Expressed as a projection of `composerMode` rather than a second `startsWith`, so the filter that history
 *  navigation runs (bundle L489547) and the mode the composer lands in can never disagree. */
export function modeOfDisplay(display: string): "prompt" | "bash" { return composerMode(display) === "bash" ? "bash" : "prompt"; }

/** `LV` (L236136). Strips ONE `!` and only from a bash display, so a prompt that legitimately begins `!!`
 *  keeps its second bang when it comes back. */
export function stripModePrefix(display: string): string { return modeOfDisplay(display) === "bash" ? display.slice(1) : display; }
