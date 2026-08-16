// tui/keys/hints.ts — the one place a canonical binding becomes a string a HUMAN reads (F2 task 10). Pure: no
// React, no Ink, no I/O. `keys/normalize.ts` owns the machine-facing canon (`"ctrl+x ctrl+k"`, lowercase, one
// spelling per key); this file owns the reader-facing one (`"Ctrl-X Ctrl-K"`), and the shortcut grid's row model.
//
// Why this exists at all: before task 10 every hint was a literal typed next to the handler that implemented it,
// so a rebinding — or an unbind — left the string lying, and F0's honesty audit had to be a test that compares
// hand-copied literals. Now the string is DERIVED from the live table, which makes the audit structural: there
// is no second copy to drift from. The rule the whole file follows: an action with no live binding prints
// `(unbound)`, never a stale literal — being told a key is gone is the honest outcome of unbinding it.
//
// The display grammar matches what the overlay printed by hand before this file existed (`Ctrl-X Ctrl-E`,
// `⇧Tab`, `Esc`), so the DEFAULT keymap renders byte-identical strings to the ones the honesty audit's proofs
// were written against — the derivation is proven by producing exactly the corpus it replaced.

import { DEFAULT_BINDINGS } from "./bindings.js";
import { bindingsFor, compileBindings, preferredKey } from "./resolver.js";
import type { KeyContextName } from "./types.js";

/** How a hint NARROWS the question it asks a binding lookup, and the two narrowings are different questions.
 *  `live` is "what would fire HERE, right now" — the active scopes, which is what a hint rendered INSIDE its
 *  own surface must ask (`KeymapProvider`'s header). `contexts` names the scopes explicitly, which is what a
 *  hint rendered OUTSIDE the surface it describes must ask: the shortcut grid's `when scrolled` row is a
 *  promise about the `Scroll` context, made from a screen where `Scroll` is not live, so neither the live set
 *  nor the whole table answers it honestly. Absent: every context in the table, in table order. */
export interface BindingLookupOpts { live?: boolean; contexts?: readonly KeyContextName[] }
/** What every derived hint resolves through — `useBindingLookup()` in a component, `defaultLookup` elsewhere. */
export type HintLookup = (action: string, opts?: BindingLookupOpts) => readonly string[];

/** What a hint prints for an action nothing binds. Deliberately not "" — a blank key column reads as a render
 *  bug, and the whole point of deriving is to SHOW the user that their unbind took effect. */
export const UNBOUND = "(unbound)";

/** Multi-character key names → their display form. Anything not here falls through to "capitalize", which is
 *  right for the f-keys (`f1` → `F1`) and for any name a terminal sends that we have not met. */
const NAMES: Record<string, string> = Object.assign(Object.create(null), {
  escape: "Esc", enter: "⏎", tab: "Tab", space: "Space", backspace: "⌫", delete: "Del", insert: "Ins",
  up: "↑", down: "↓", left: "←", right: "→", pageup: "PgUp", pagedown: "PgDn", home: "Home", end: "End",
  capslock: "CapsLock",
});
/** `super` is upstream's own name for the cmd/win bit; print the one the reader's keyboard has. */
const SUPER = process.platform === "darwin" ? "Cmd-" : "Super-";

/** One canonical member (`"ctrl+shift+b"`) → `"Ctrl-⇧B"`. Modifier order follows `specKey`'s canon so two
 *  spellings of one key can never print two different hints. */
function formatMember(member: string): string {
  const tokens = member.split("+");
  // A trailing empty token is the literal `+` key (`ctrl++` splits to ["ctrl","",""]); rebuild it rather than
  // printing nothing. Everything before the name is a modifier, in canonical order.
  let name = tokens.pop() ?? "";
  if (name === "" && tokens.length > 0) { name = "+"; tokens.pop(); }
  const mods = new Set(tokens);
  const shown = NAMES[name] ?? (name.length === 1 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1));
  return `${mods.has("ctrl") ? "Ctrl-" : ""}${mods.has("alt") ? "Alt-" : ""}${mods.has("shift") ? "⇧" : ""}${mods.has("super") ? SUPER : ""}${shown}`;
}

/** Upstream ships TWO display grammars, and this is the OTHER one: `Hp_.default` with `keyCase:"lower"`
 *  (bundle 231308541) — modifiers lowercase joined with `+`, chord members joined with a space, and a short
 *  lower-case name table where the title-case one prints words. `BackgroundHint` renders its chord through it,
 *  so the hint reads `(ctrl+b to run in background)` where the shortcuts grid would print `Ctrl-B`. The
 *  modifier ORDER stays our canonical one (`specKey`: ctrl·alt·shift·super) rather than upstream's
 *  ctrl·shift·alt·super — a difference only a multi-modifier rebind can show, and one spelling per key is
 *  worth more here than reproducing a second ordering. */
const LOWER_NAMES: Record<string, string> = Object.assign(Object.create(null), {
  enter: "enter", escape: "esc", tab: "tab", space: "space", backspace: "backspace", delete: "delete",
  up: "↑", down: "↓", left: "←", right: "→", pageup: "pgup", pagedown: "pgdn", home: "home", end: "end",
});
function formatMemberLower(member: string, platform: NodeJS.Platform): string {
  const tokens = member.split("+");
  let name = tokens.pop() ?? "";
  if (name === "" && tokens.length > 0) { name = "+"; tokens.pop(); }
  const mods = new Set(tokens), macos = platform === "darwin";
  const out: string[] = [];
  if (mods.has("ctrl")) out.push("ctrl");
  if (mods.has("alt")) out.push(macos ? "opt" : "alt");
  if (mods.has("shift")) out.push("shift");
  if (mods.has("super")) out.push(macos ? "cmd" : "super");
  out.push(LOWER_NAMES[name] ?? name);                                   // `charCase:"preserve"` — a single letter stays as typed
  return out.join("+");
}
/** The lower-case display form of one canonical binding. `""` for absent, NOT `(unbound)`: the one caller
 *  renders no row at all rather than a parenthetical announcing its own emptiness. */
export function formatBindingLower(key: string | null | undefined, platform: NodeJS.Platform = process.platform): string {
  if (!key) return "";
  return key.trim().split(/\s+/).map((member) => formatMemberLower(member, platform)).join(" ");
}

/** LT20, upstream `BackgroundHint` (bundle 240646037): a dim `(ctrl+b to run in background)` under a running
 *  foreground Bash. `$e({parens:true})` composes exactly `("(", chord, " to ", action, ")")`, and the tmux
 *  branch is `Z.terminal==="tmux" && chord==="ctrl+b" ? "ctrl+b ctrl+b (twice)" : chord` — so a REBOUND chord
 *  is never doubled (tmux's own prefix is ctrl+b; nothing else collides with it). `undefined` when the action
 *  is unbound: upstream returns `null` there, and `(unbound)` inside this sentence would read as a key name. */
export const BACKGROUND_HINT_ACTION = "run in background";
export const TMUX_BACKGROUND_CHORD = "ctrl+b ctrl+b (twice)";
export function backgroundHintText(keys: readonly string[], tmux: boolean, platform: NodeJS.Platform = process.platform): string | undefined {
  const key = preferredKey(keys);
  if (key === undefined) return undefined;
  const chord = formatBindingLower(key, platform);
  if (chord === "") return undefined;
  return `(${tmux && chord === "ctrl+b" ? TMUX_BACKGROUND_CHORD : chord} to ${BACKGROUND_HINT_ACTION})`;
}

/** F4 Task 10b, upstream `Bg` (L421333) — the OTHER derived hint, and the one the whole transcript leans on:
 *  `pA("app:toggleTranscript", "Global", "ctrl+o")` resolves the chord, then `$e({action:"expand", parens:!0,
 *  format:{keyCase:"lower"}})` composes `("(", chord, " to ", action, ")")` (L183875). Every
 *  `(ctrl+o to expand)` on screen — the output fold's overflow marker, the collapsed tool-group row, the
 *  Grep/Glob `Found N files` sentence, the compact-summary boundary, the truncated-API-error offer — is that
 *  one component, so all of them move together when the user rebinds.
 *
 *  THE THREE-STATE CONTRACT, which is upstream's and not an invention (`pA`, L183751–183758):
 *   · the action resolves        → the composed sentence with the user's chord;
 *   · the action is UNBOUND      → `pA` returns `""`, `$e` returns `null` → **no clause at all**. E2: being
 *                                  shown nothing is honest, being shown a dead chord is not;
 *   · no keymap in scope at all  → `pA` returns its literal FALLBACK. That is `EXPAND_HINT_FALLBACK` below,
 *                                  and it is what every projection that was never threaded a hint keeps
 *                                  printing — the same string those surfaces hardcoded before this task. */
export const EXPAND_HINT_ACTION = "expand";
/** `bn`'s `fallback: "ctrl+o"` (L422267/429646/421333), already composed through `$e`'s parens form. */
export const EXPAND_HINT_FALLBACK = "(ctrl+o to expand)";
/** The detail projections' sibling offer. NOT keymap-derived here: upstream's ctrl+e surface is the pager's
 *  own control (`TranscriptPager`), which F1 renders from its own literal, so deriving only this half would
 *  put two different truths on one row. Recorded, not ported. */
export const SHOW_ALL_HINT = "(ctrl+e to show all)";
/** TWO-STATE HERE, THREE-STATE AT THE BOUNDARY — deliberate, and this is the reasoning rather than a claim of
 *  a verbatim port. `pA` (L183751) computes THREE outcomes from `ugo`'s (L183087) two-valued miss:
 *  `undefined` (no entry anywhere names the action — `reason:"action_not_found"`, or no keymap context at
 *  all) → the literal fallback; `null` (entries exist but every chord is shadowed by a later layer) → `""`;
 *  otherwise the chord. This function sees only `bindingsFor`'s `string[]`, which is empty for BOTH misses,
 *  and answers `""` — the shadowed answer.
 *  That cannot diverge for our one caller. `ugo`'s `undefined` needs the action to be absent from the WHOLE
 *  binding list, and `useBindingLookup()` compiles `[...DEFAULT_BINDINGS, ...userLayers]`, where
 *  `DEFAULT_BINDINGS` binds `ctrl+o` → `app:toggleTranscript` unconditionally (bindings.ts:26) — a user layer
 *  can only rebind that chord away, which is exactly `ugo`'s `null`. The third state is not lost, either: it
 *  is carried one level up, as the ABSENCE of `ProjectionOptions.expandHint`, where `resolveExpandHint`
 *  supplies `EXPAND_HINT_FALLBACK` — the "no keymap in scope" arm, which is the only way `undefined` can
 *  reach a caller of ours. A three-state signature here would add an unreachable branch and an
 *  `action_not_found` distinction whose only upstream consumer is a telemetry `reason` field. */
export function expandHintText(keys: readonly string[], platform: NodeJS.Platform = process.platform, description: string = EXPAND_HINT_ACTION): string {
  const key = preferredKey(keys);
  if (key === undefined) return "";
  const chord = formatBindingLower(key, platform);
  return chord === "" ? "" : `(${chord} to ${description})`;
}
/** `$e`'s `parens` prop is the ONLY difference between its two output forms (L183875 vs L183883), so the bare
 *  clause is the parens form minus its wrapper. One site needs it: `Vha`'s backgrounded-agent row (429646)
 *  nests the chord hint inside a LARGER parenthesised list (`(↓ to manage · ctrl+o to expand)`), where a
 *  second pair of parens would be wrong. Empty in, empty out — an unbound chord still contributes nothing. */
/** ABSENT → `pA`'s literal fallback; anything else (including `""`, the unbound answer) is the caller's truth.
 *  It lives here rather than on `ProjectionOptions` so `toolSummaries.ts` can reach it without a value import
 *  from `toolRenderer.tsx`, which imports IT back (the existing type-only import is what keeps that acyclic). */
export const resolveExpandHint = (hint: string | undefined): string => hint ?? EXPAND_HINT_FALLBACK;
export const hintWithoutParens = (hint: string): string => (hint.startsWith("(") && hint.endsWith(")") ? hint.slice(1, -1) : hint);

/** A canonical binding (a chord is space-separated) → its display string. `null`/absent → `(unbound)`. */
export function formatBinding(key: string | null | undefined): string {
  if (!key) return UNBOUND;
  return key.trim().split(/\s+/).map(formatMember).join(" ");
}

/** Up to `max` of an action's bindings, joined — how a row advertises an alias pair (`Ctrl-X Ctrl-E / Ctrl-G`)
 *  without printing all four spellings of one action. */
export function formatBindings(keys: readonly string[], max = 1): string {
  if (keys.length === 0) return UNBOUND;
  return keys.slice(0, max).map(formatBinding).join(" / ");
}

/** One row of the shortcut grid, in BOTH of its renderings.
 *
 *  The KEY-COLUMN half (`key`/`action`/`show`/`suffix`/`repeat` + `label`) is what `shortcutRows` produces and
 *  what `test/tui/honesty.test.tsx` audits: either a LITERAL key column (editor keys the table does not own —
 *  the readline set, the `!`/`#`/`@`/`/` prefixes) or an `action` resolved against the live table. `show`
 *  widens a row to an alias pair; `suffix` carries the press-count decorations (`Ctrl-C ×2`); `repeat` prints
 *  the key twice for the double-press rows (`Esc Esc`) so a rebinding moves both halves.
 *
 *  The GRID half (`col` + `cell`/`phrase`/`connector`/`prefix`/`chordSuffix`/`ladder`) is F6 T14: what the
 *  three-column grid PRINTS, in upstream's own sentence grammar (`ctrl + t to toggle tasks`). Two renderings,
 *  ONE entry — which is the whole reason they live on the same object. hints.ts already carries upstream's two
 *  display grammars (`formatBinding` title-case, `formatBindingLower` + `AW`'s ` + ` modSep for the sentences);
 *  this is the same split one level up, at the row. A row can therefore never advertise a chord in the grid
 *  that the audit corpus does not carry: both are `SHORTCUT_ROWS.map(…)`, one-to-one, pinned by
 *  `test/tui/shortcuts-grid.test.tsx`. */
export interface ShortcutRow {
  key?: string; action?: string; show?: number; suffix?: string; repeat?: number; label: string;
  /** Which of the three columns this cell sits in (`Y6t`'s three `flexDirection:"column"` boxes, L459475-634). */
  col: 0 | 1 | 2;
  /** A cell upstream writes as a LITERAL (`! for shell mode`), or one of ours whose key `editor.ts` owns and
   *  the table therefore cannot resolve (`ctrl + _ to undo`). Wins over `phrase`. */
  cell?: string;
  /** The derived form: `<prefix><chord><chordSuffix> <connector> <phrase>` — `$e`'s bare composition
   *  (L183883) with `AW = {keyCase:"lower", modSep:" + "}` (L459648). `connector` defaults to `to`
   *  (`ctrl + t to toggle tasks`); `for` is upstream's other one (`ctrl + o for verbose output`). */
  phrase?: string; connector?: "to" | "for"; prefix?: string; chordSuffix?: string;
  /** The newline ladder cell (`Z_a`, L433223). Its text is terminal-state-dependent and lives in
   *  `composerFrame.tsx` (`newlineHint`), which imports Ink — so the caller supplies the string and this pure
   *  module never reaches for it. */
  ladder?: true;
  /** THIS ROW EXISTS IN THE ALTERNATE-SCREEN RENDERER ONLY, and is absent everywhere else — the same shape as
   *  the Windows rule below, one axis over. It is what lets the grid advertise a key that is a printable
   *  letter in the other renderer: the honesty contract is "no string may advertise a chord that is not live",
   *  and a row the classic grid never prints cannot break it there. The CELL still has to carry whatever
   *  narrows the key inside this renderer (`v` is the scrollback's, not the composer's), because the reader is
   *  looking at one grid and cannot see the gate. */
  fullscreen?: true;
  /** THE CONTEXTS THIS ROW'S PROMISE IS ABOUT, when it is about some rather than all of them. A row whose
   *  label narrows the key to a surface (`when scrolled`) is claiming the action fires THERE, and the grid
   *  prints it from a screen where that surface is not focused — so the unrestricted lookup, which answers
   *  from every context in the table, can key the row with a chord that context never sees (a user layer
   *  binding the action inside the ctrl+O pager is enough). Naming the contexts makes the row resolve the
   *  question it is actually asking. Absent — the ordinary case — is the whole table, unchanged. */
  contexts?: readonly KeyContextName[];
}

/** THE MERGED ENTRY SET (F6 T14, DG62/DG63). Upstream's `Y6t` entries FIRST, in upstream's own three-column
 *  order, for the subset whose bindings or features exist in ccx; then our extra honest rows, appended to the
 *  column whose subject they share (prefixes · composer/turn keys · app+session chords). Deleting an
 *  implemented row to match upstream exactly would regress the F2 honesty contract, so nothing is dropped.
 *
 *  What upstream has and this does NOT, each because the feature does not exist here:
 *   · `/btw for side question`  — no such feature (command-coverage.md lists `btw` out of scope);
 *   · `ctrl + v to paste images` — images are a non-goal for this wave;
 *   · `alt + o to toggle fast mode` — no fast mode (upstream gates it on `Sl() && QN()` anyway, L459592).
 *  What upstream gates and we resolve statically: `ctrl+z` is `Tho()` (false only for `CLAUDE_CODE_SESSION_KIND
 *  === "bg"`, L177619) — ours is the platform gate `shortcutRows`/`shortcutGrid` already apply, since
 *  `suspendProcess` is the no-op on Windows. `/keybindings to customize` is `cEe()`, a release flag upstream;
 *  ours is unconditional because the command IS implemented (commands.ts + useChat's `keybindings` arm).
 *
 *  Every row whose key lives in the binding table names its ACTION; only keys owned by `editor.ts` (which has
 *  no table entry, by design — it is the fallback) stay literal. */
export const SHORTCUT_ROWS: readonly ShortcutRow[] = [
  // ── column 0: the prefixes (`Y6t`'s first column, `width: 24` under `fixedWidth`) ──────────────────────
  { key: "!", label: "bash", col: 0, cell: "! for shell mode" },
  { key: "/", label: "commands", col: 0, cell: "/ for commands" },
  { key: "@", label: "files", col: 0, cell: "@ for file paths" },
  // WAVE C TASK 14: `# for memory` stood here. The mode it advertised was a ccx extra with no upstream
  // counterpart at 2.1.220, and the spec's owner-decision section removed it — so the cell had to go too,
  // or this grid would promise a key that now types an ordinary `#` into the prompt. That is the honesty
  // contract running the other way: it forbids dropping an IMPLEMENTED row, not keeping a dead one.
  { key: "?", label: "this help", col: 0, cell: "? for this help" },
  // ── column 1: the composer and the running turn (`width: 35`) ──────────────────────────────────────────
  // Upstream's cell is the LITERAL `double tap esc to clear input`; ours resolves the chord, so an `escape`
  // rebind moves it. The audit label stays the fuller truth (ours also rewinds on an empty buffer).
  { action: "chat:cancel", repeat: 2, label: "clear input · rewind when empty", col: 1, prefix: "double tap ", phrase: "clear input" },
  { action: "chat:cycleMode", label: "mode ladder", col: 1, phrase: "auto-accept edits" },
  { action: "app:toggleTranscript", label: "transcript pager", col: 1, connector: "for", phrase: "verbose output" },
  // FSW T14 review (M5). Canon advertises this one on its transcript screen — `v to open in ${editor}`
  // (L547303) — and ccx's jump pill carries that wording while it is up. The pill is not enough on its own: a
  // user who never scrolls never sees it, and never learns the escape exists. The row is FULLSCREEN-ONLY
  // because `scroll:dumpTranscript` is registered by the viewport for exactly as long as the pill is
  // (FullscreenViewport), and in the classic renderer `v` is a letter and nothing else. `$EDITOR` is the
  // spelling this grid already uses for the composer's own external-editor row; `when scrolled` is the gate,
  // stated because the reader of a grid cannot see it.
  //   FSW BACKLOG 2 made it an ACTION row like every other table-owned key. It shipped with a literal `v` in
  // both renderings, which is the one thing this file exists to prevent: `scroll:dumpTranscript` is rebindable
  // (keys-user-bindings.test.ts drives `alt+v`), so the literal was a promise the table could already break.
  //   FSW BACKLOG FIX F2 pinned it to `Scroll`. `when scrolled` is a promise about ONE context, and the
  // unrestricted lookup answered from all of them — so an unbind here plus a bind in the pager printed the
  // pager's chord under this label, which is the same lie the literal was.
  { action: "scroll:dumpTranscript", contexts: ["Scroll"], label: "open transcript in $EDITOR (while scrolled)", col: 1, phrase: "open in $EDITOR when scrolled", fullscreen: true },
  { action: "app:toggleTodos", label: "todo panel", col: 1, phrase: "toggle tasks" },
  { key: "\\⏎ / Ctrl-J", label: "newline", col: 1, ladder: true },
  { key: "⏎", label: "send", col: 1, cell: "⏎ to send" },
  { key: "↑↓", label: "history", col: 1, cell: "↑↓ for prompt history" },
  { key: "Ctrl-A/E/K/U/W", label: "line start/end · kill to end/start · kill word", col: 1, cell: "ctrl + a/e/k/u/w for line edits" },
  { key: "Ctrl-Y / Alt-Y", label: "yank / yank-pop killed text", col: 1, cell: "ctrl + y / alt + y to yank text" },
  { key: "Alt-←→ / Alt-b/f", label: "move by word", col: 1, cell: "alt + ←/→ to move by word" },
  { action: "chat:clearInput", label: "clear input", col: 1, phrase: "clear input" },
  { action: "chat:cancel", label: "interrupt (while running)", col: 1, phrase: "interrupt" },
  { action: "history:search", label: "search prompt history", col: 1, phrase: "search history" },
  // ── column 2: the app and the session (no fixed width — upstream's third column has none) ──────────────
  { key: "Ctrl-_", label: "undo edit", col: 2, cell: "ctrl + _ to undo" },
  { key: "Ctrl-Z", label: "suspend to shell (fg resumes)", col: 2, cell: "ctrl + z to suspend" },
  { action: "chat:modelPicker", label: "switch model", col: 2, phrase: "switch model" },
  { key: "Ctrl-S", label: "stash / restore input", col: 2, cell: "ctrl + s to stash prompt" },
  { action: "chat:externalEditor", show: 2, label: "edit in $EDITOR", col: 2, phrase: "edit in $EDITOR" },
  { key: "/keybindings", label: "customize keybindings", col: 2, cell: "/keybindings to customize" },
  { action: "task:background", label: "background", col: 2, phrase: BACKGROUND_HINT_ACTION },
  { action: "chat:killAgents", label: "stop background agents (×2)", col: 2, phrase: "stop agents" },
  { action: "app:interrupt", suffix: " ×2", label: "exit", col: 2, chordSuffix: " twice", phrase: "exit" },
  { action: "app:exit", suffix: " ×2", label: "exit", col: 2, chordSuffix: " twice", phrase: "exit" },
];

/** The table with no user layer on top. Two readers: a component rendered with no `<KeymapProvider>` above it
 *  (a bare test render — the defaults are the truthful answer there), and the honesty audit, which asks what the
 *  SHIPPED keymap advertises rather than what one test tree happens to have mounted. */
export const DEFAULT_TABLE = compileBindings(DEFAULT_BINDINGS);
export const defaultLookup: HintLookup = (action, opts) => bindingsFor(DEFAULT_TABLE, action, opts?.contexts);

/** The two gates every rendering of the entry set applies, in one place so the audit corpus and the printed
 *  grid cannot disagree about which rows exist. Windows drops the Ctrl-Z row (`suspendProcess` is a no-op
 *  there, so advertising it would be a false promise); the classic renderer drops the `fullscreen` rows. */
const rowHidden = (row: ShortcutRow, platform: NodeJS.Platform, fullscreen: boolean): boolean =>
  (platform === "win32" && row.key === "Ctrl-Z") || (row.fullscreen === true && !fullscreen);

/** One row's KEY-COLUMN rendering. The one copy of that grammar, so every set of rows drawn from the entry
 *  set — the classic corpus, the fullscreen-only one — keys its rows identically. */
function rowEntry(row: ShortcutRow, lookup: HintLookup): [string, string] {
  let key: string;
  if (row.key !== undefined) key = row.key;
  else {
    const bound = formatBindings(lookup(row.action!, { contexts: row.contexts }), row.show ?? 1);
    // A repeat row prints the key twice — but never "(unbound) (unbound)", which says the same thing worse.
    key = row.repeat && bound !== UNBOUND ? Array(row.repeat).fill(bound).join(" ") : bound;
  }
  return [key + (row.suffix ?? ""), row.label];
}

/** Resolve the grid against a live lookup (`useBindingLookup()` in a component, the default table elsewhere). */
export function shortcutRows(lookup: HintLookup, platform: NodeJS.Platform = process.platform, fullscreen = false): [string, string][] {
  const rows: [string, string][] = [];
  for (const row of SHORTCUT_ROWS) {
    if (rowHidden(row, platform, fullscreen)) continue;
    rows.push(rowEntry(row, lookup));
  }
  return rows;
}

/** Just the rows the ALTERNATE-SCREEN renderer adds — selected by the `fullscreen` FLAG, which is the property
 *  that defines them, rather than by subtracting the classic corpus from the fullscreen one BY KEY STRING.
 *  That difference was silently lossy: two rows may resolve to the same key column (a rebind is enough), and
 *  the fullscreen one then vanished from the audit corpus (`honesty.test.tsx`) while still printing on screen —
 *  a row losing its proof by accident, which is the exact failure the corpus exists to make impossible. */
export function fullscreenOnlyRows(lookup: HintLookup, platform: NodeJS.Platform = process.platform): [string, string][] {
  const rows: [string, string][] = [];
  for (const row of SHORTCUT_ROWS) {
    if (row.fullscreen !== true || rowHidden(row, platform, true)) continue;
    rows.push(rowEntry(row, lookup));
  }
  return rows;
}

// ── F6 T14: the same rows, in upstream's THREE-COLUMN sentence grammar (`Y6t`, L459475-634) ──────────────
/** `uei` (L459472) verbatim: `e.replaceAll("+", " + ")` — which is all `AW`'s `modSep: " + "` (L459648)
 *  amounts to once `formatBindingLower` has produced the lower-case chord. Blind, like upstream's: a rebind
 *  onto the literal `+` key would print `ctrl +  + `, and reproducing that is cheaper than a second grammar. */
export const withModSep = (chord: string): string => chord.replaceAll("+", " + ");

/** Upstream's `fixedWidth` column widths: `AYH ? 24 : void 0` (L459487) and `AYH ? 35 : void 0` (L459515).
 *  The third column has none — it takes whatever its longest cell needs (L459623). */
export const GRID_COLUMN_WIDTHS: readonly (number | undefined)[] = [24, 35, undefined];

export interface ShortcutGridOptions {
  platform?: NodeJS.Platform;
  /** `Z_a()`'s answer (composerFrame.tsx's `newlineHint`) — supplied rather than imported, so this module
   *  stays free of React/Ink. The caller has no `hasUsedBackslashReturn` to give it: that lives on the live
   *  EditorState, and the grid renders with no composer mounted, so the ladder shows its LONG rung here even
   *  after the short one has taken over below the composer. Recorded divergence (T15). */
  newline: string;
  /** The grid is being rendered by the ALTERNATE-SCREEN tree, so the `fullscreen` rows are live and print.
   *  Defaults false — a bare render, and the classic renderer, get the classic set. */
  fullscreen?: boolean;
}

/** One cell, or `null` for a row that must not print. The null arm is `$e`'s own three-state contract
 *  (hints.ts's `expandHintText` header): an action with no live binding contributes NO CLAUSE — upstream
 *  returns `null` there and renders nothing. `shortcutRows`' `(unbound)` is the KEY COLUMN's answer, and it
 *  stays what it is: a key column reading `(unbound)` tells the user their unbind took effect, whereas a
 *  sentence reading `(unbound) to switch model` would just be broken English. */
function gridCell(row: ShortcutRow, lookup: HintLookup, platform: NodeJS.Platform, newline: string): string | null {
  if (row.ladder) return newline;
  if (row.cell !== undefined) return row.cell;
  const key = preferredKey(lookup(row.action!, { contexts: row.contexts }));
  if (key === undefined) return null;
  const chord = withModSep(formatBindingLower(key, platform));
  if (chord === "") return null;
  return `${row.prefix ?? ""}${chord}${row.chordSuffix ?? ""} ${row.connector ?? "to"} ${row.phrase}`;
}

/** The grid as THREE columns of composed sentences, resolved against a live lookup. Same two gates as
 *  `shortcutRows` — `rowHidden` is the one copy of them. */
export function shortcutGrid(lookup: HintLookup, { platform = process.platform, newline, fullscreen = false }: ShortcutGridOptions): string[][] {
  const cols: string[][] = [[], [], []];
  for (const row of SHORTCUT_ROWS) {
    if (rowHidden(row, platform, fullscreen)) continue;
    const cell = gridCell(row, lookup, platform, newline);
    if (cell !== null) cols[row.col]!.push(cell);
  }
  return cols;
}
