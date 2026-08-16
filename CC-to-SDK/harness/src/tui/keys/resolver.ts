// tui/keys/resolver.ts — the resolver and the chord machine (F2 task 4). Pure: no React, no Ink, no timers. The
// CALLER (task 5) owns the pending-chord array and its 1 s inter-key timeout; `resolveKey` is a function of
// (event, ordered active contexts, compiled table, pending) → `Resolution`, so the whole precedence model is
// testable without a terminal.
//
// The model is upstream's (06 §1.5), stated once here because every call site downstream depends on it:
//  * PRECEDENCE IS POSITIONAL. The active-context array is ordered outward-in (a dialog's context sits at a lower
//    index than Chat's, and Global is always last). The first context that binds the key AT ALL consumes it: an
//    action returns `match`, a `null` returns `unbound` and STOPS the search — that is how a user unbinds a
//    default without the next context inheriting it.
//  * CHORDS ARE GENERIC. A binding key is a whitespace-separated sequence ("ctrl+x ctrl+k"); any binding that is a
//    strict extension of what has been typed arms the pending prefix (upstream `Q4u`). While a chord pends, only
//    extensions and `escape` are considered — any other key is dropped (`no-match`) and the caller clears pending.
//
// One rule the two above leave open, settled here: exact-vs-prefix is resolved WITHIN each context as the array is
// walked, exact first. So a single-key binding in a higher context beats a lower context's chord head (the array
// says the dialog wins), while a chord head in a higher context still arms over a lower context's plain binding of
// the same key (same reason, other direction). Both directions are pinned by tests.
import type { KeyContextName, KeyEvent } from "./types.js";
import type { ContextBindings } from "./bindings.js";
import { VALID_CONTEXTS } from "./bindings.js";
import { parseChordSpec, specKey, type KeySpec } from "./normalize.js";

/** One context's compiled bindings: canonical chord string → action (or null = explicitly unbound), plus the set of
 *  strict prefixes of its multi-key chords, so "does anything here extend what has been typed?" is a Set hit. */
interface CompiledContext { keys: Map<string, string | null>; prefixes: Set<string> }
/** Opaque to callers — build it with `compileBindings`, read it with `resolveKey` / `bindingFor`. */
export interface CompiledTable { contexts: Map<KeyContextName, CompiledContext> }

export type Resolution =
  | { type: "match"; action: string; context: KeyContextName }
  | { type: "unbound" }
  | { type: "chord-started"; pending: KeySpec[] }
  | { type: "chord-cancelled" }
  | { type: "no-match" };

const KNOWN_CONTEXTS = new Set<string>(VALID_CONTEXTS);

/** Merge layers into per-context lookup tables. Later layers overwrite earlier ones WITHIN a context (that is how
 *  the user's keybindings.json lands on top of the defaults in task 9), compared on the canonical chord string so a
 *  re-spelling ("ctrl+B" over "ctrl+shift+b") overwrites instead of shadowing.
 *  Tolerant by design: an unknown context or an unparseable key spec is SKIPPED, never thrown — task 9 owns
 *  validation and user-facing reporting, and a resolver that throws would take the whole REPL down over a typo. */
export function compileBindings(layers: readonly ContextBindings[]): CompiledTable {
  const contexts = new Map<KeyContextName, CompiledContext>();
  for (const layer of layers) {
    if (!KNOWN_CONTEXTS.has(layer.context)) continue;
    let c = contexts.get(layer.context);
    if (!c) { c = { keys: new Map(), prefixes: new Set() }; contexts.set(layer.context, c); }
    for (const [spec, action] of Object.entries(layer.bindings)) {
      const chord = parseChordSpec(spec);
      if (!chord) continue;
      c.keys.set(chord.map(specKey).join(" "), action);
    }
  }
  // Prefixes are derived once the key set is final (a later layer can only add keys or change an action, never
  // remove a key). A null-bound chord does NOT arm its prefix: merge can never delete an entry, so if the null
  // armed, a user who unbinds `ctrl+x ctrl+k` could never free plain `ctrl+x` — the head would eat the next
  // keypress forever. Cross-context shadowing doesn't need the null to arm either: the pending path still checks
  // exact completions per context, so a chord unbound ABOVE a live lower one resolves `unbound` as required.
  for (const c of contexts.values()) {
    for (const [key, action] of c.keys) {
      if (action === null) continue;
      const parts = key.split(" ");
      for (let i = 1; i < parts.length; i++) c.prefixes.add(parts.slice(0, i).join(" "));
    }
  }
  return { contexts };
}

const eventSpec = (e: KeyEvent): KeySpec => ({ name: e.name, ctrl: e.ctrl, alt: e.alt, shift: e.shift, super: e.super });
const hit = (c: CompiledContext, key: string, context: KeyContextName): Resolution | null => {
  if (!c.keys.has(key)) return null;
  const action = c.keys.get(key)!;
  return action === null ? { type: "unbound" } : { type: "match", action, context };
};

/** Resolve one key press. `pending` is what the caller has accumulated from previous `chord-started` results (empty
 *  when no chord is in flight); the caller applies the returned state — extending `pending` on `chord-started` and
 *  clearing it on every other outcome. Unknown names in `activeContexts` are skipped harmlessly. */
export function resolveKey(e: KeyEvent, activeContexts: readonly KeyContextName[], table: CompiledTable, pending: KeySpec[]): Resolution {
  const spec = eventSpec(e);
  const key = specKey(spec);
  // While a chord pends, ONLY this machine runs: a context's own binding for the bare key never fires (that is
  // upstream's `Q4u` behaviour, and it is why Chat's plain `escape` does not cancel-the-turn mid-chord).
  if (pending.length > 0) {
    const candidate = [...pending.map(specKey), key].join(" ");
    for (const context of activeContexts) {
      const c = table.contexts.get(context);
      if (!c) continue;
      const exact = hit(c, candidate, context);
      if (exact) return exact;
      if (c.prefixes.has(candidate)) return { type: "chord-started", pending: [...pending, spec] };
    }
    return e.name === "escape" ? { type: "chord-cancelled" } : { type: "no-match" };
  }
  for (const context of activeContexts) {
    const c = table.contexts.get(context);
    if (!c) continue;
    const exact = hit(c, key, context);
    if (exact) return exact;
    if (c.prefixes.has(key)) return { type: "chord-started", pending: [spec] };
  }
  return { type: "no-match" };
}

/** EVERY canonical key bound to `action`, in context order then declaration order, deduped — the raw material
 *  every hint string is built from (task 10). Searches `contexts` in the order given (so a hint can ask "what
 *  does this do HERE first"), else every compiled context in table order. Null-bound (explicitly unbound)
 *  entries are never reported: an unbind is the absence of a binding, not a binding to nothing. */
export function bindingsFor(table: CompiledTable, action: string, contexts?: readonly KeyContextName[]): string[] {
  const order = contexts ?? [...table.contexts.keys()];
  const out: string[] = [];
  for (const context of order) {
    const c = table.contexts.get(context);
    if (!c) continue;
    // Keys are stored canonical (specKey at compile time), so `key` IS the display string — no re-parse.
    for (const [key, bound] of c.keys) if (bound === action && !out.includes(key)) out.push(key);
  }
  return out;
}

/** THE ONE KEY a single-key hint should print, out of a list `bindingsFor` produced: the first plain key, else
 *  the first chord. A single key beats a chord because printing "ctrl+x ctrl+e" when "ctrl+g" exists is noise.
 *  Exported because the rule outlives the table: a hint that resolved through a LOOKUP (a live `BindingLookup`,
 *  which already knows which contexts to ask) still has to pick the same one, and a second spelling of
 *  `find(k => !k.includes(" "))` is a rule that can drift. `undefined` for an unbound action. */
export const preferredKey = (keys: readonly string[]): string | undefined => keys.find((k) => !k.includes(" ")) ?? keys[0];

/** `preferredKey` over the table directly. Null when the action is unbound — which the caller must render as
 *  unbound rather than falling back to a literal (that is the whole point). */
export function bindingFor(table: CompiledTable, action: string, contexts?: readonly KeyContextName[]): string | null {
  return preferredKey(bindingsFor(table, action, contexts)) ?? null;
}
