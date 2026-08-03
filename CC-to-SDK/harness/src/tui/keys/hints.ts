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
import { bindingsFor, compileBindings } from "./resolver.js";

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
  const key = keys.find((k) => !k.includes(" ")) ?? keys[0];             // plain beats chord, the resolver's own rule
  if (key === undefined) return undefined;
  const chord = formatBindingLower(key, platform);
  if (chord === "") return undefined;
  return `(${tmux && chord === "ctrl+b" ? TMUX_BACKGROUND_CHORD : chord} to ${BACKGROUND_HINT_ACTION})`;
}

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

/** One row of the `?` shortcut grid. Either a LITERAL key column (editor keys the table does not own — the
 *  readline set, the `!`/`#`/`@`/`/` prefixes) or an `action` resolved against the live table. `show` widens a
 *  row to an alias pair; `suffix` carries the press-count decorations (`Ctrl-C ×2`); `repeat` prints the key
 *  twice for the double-press rows (`Esc Esc`) so a rebinding moves both halves. */
export interface ShortcutRow { key?: string; action?: string; show?: number; suffix?: string; repeat?: number; label: string }

/** The grid, in upstream's own rough order: editing, then the chat verbs, then the app globals, then the
 *  prefixes. Every row whose key lives in the binding table names its ACTION; only keys owned by `editor.ts`
 *  (which has no table entry, by design — it is the fallback) stay literal. */
export const SHORTCUT_ROWS: readonly ShortcutRow[] = [
  { key: "⏎", label: "send" },
  { key: "\\⏎ / Ctrl-J", label: "newline" },
  { key: "↑↓", label: "history" },
  { key: "Ctrl-A/E/K/U/W", label: "line start/end · kill to end/start · kill word" },
  { key: "Ctrl-Y / Alt-Y", label: "yank / yank-pop killed text" },
  { key: "Alt-←→ / Alt-b/f", label: "move by word" },
  { action: "chat:clearInput", label: "clear input" },
  { key: "Ctrl-_", label: "undo edit" },
  { key: "Ctrl-S", label: "stash / restore input" },
  { action: "chat:externalEditor", show: 2, label: "edit in $EDITOR" },
  { action: "chat:cycleMode", label: "mode ladder" },
  { action: "chat:cancel", label: "interrupt (while running)" },
  { action: "chat:cancel", repeat: 2, label: "clear input · rewind when empty" },
  { action: "app:toggleTodos", label: "todo panel" },
  { action: "app:toggleTranscript", label: "transcript pager" },
  { action: "history:search", label: "search prompt history" },
  { action: "task:background", label: "background" },
  { action: "chat:killAgents", label: "stop background agents (×2)" },
  { action: "app:interrupt", suffix: " ×2", label: "exit" },
  { action: "app:exit", suffix: " ×2", label: "exit" },
  { key: "Ctrl-Z", label: "suspend to shell (fg resumes)" },
  { key: "!", label: "bash" },
  { key: "#", label: "memory" },
  { key: "@", label: "files" },
  { key: "/", label: "commands" },
  { key: "?", label: "this help" },
];

/** The table with no user layer on top. Two readers: a component rendered with no `<KeymapProvider>` above it
 *  (a bare test render — the defaults are the truthful answer there), and the honesty audit, which asks what the
 *  SHIPPED keymap advertises rather than what one test tree happens to have mounted. */
export const DEFAULT_TABLE = compileBindings(DEFAULT_BINDINGS);
export const defaultLookup = (action: string): string[] => bindingsFor(DEFAULT_TABLE, action);

/** Resolve the grid against a live lookup (`useBindingLookup()` in a component, the default table elsewhere).
 *  Windows drops the Ctrl-Z row: `suspendProcess` is a no-op there, so advertising it would be a false promise. */
export function shortcutRows(lookup: (action: string) => readonly string[], platform: NodeJS.Platform = process.platform): [string, string][] {
  const rows: [string, string][] = [];
  for (const row of SHORTCUT_ROWS) {
    if (platform === "win32" && row.key === "Ctrl-Z") continue;
    let key: string;
    if (row.key !== undefined) key = row.key;
    else {
      const bound = formatBindings(lookup(row.action!), row.show ?? 1);
      // A repeat row prints the key twice — but never "(unbound) (unbound)", which says the same thing worse.
      key = row.repeat && bound !== UNBOUND ? Array(row.repeat).fill(bound).join(" ") : bound;
    }
    rows.push([key + (row.suffix ?? ""), row.label]);
  }
  return rows;
}
