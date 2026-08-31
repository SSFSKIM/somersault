// tui/dialogs/keyhints.ts — the action→description registry every dialog frame's auto keyhint bar reads
// (T-MENU task 1). Transcribed from canon `Ye` (bundle L568825): action name → short hint description, and
// `Z`'s own cap (`Pe = 4`, L568834) and dedup-by-DESCRIPTION rule (two actions that read the same to a user —
// `tabs:next`/`tabs:previous` both "switch tab" — print once, L568912-568913).
//
// Canon's `Z` walks a live focus-node tree collecting per-component {action, hint} entries up to a boundary;
// we have no such tree, so the caller names the "reachable" scope(s) explicitly (`DialogFrame`'s `hintScope`)
// and the entries come from THAT scope's own default bindings (`bindings.ts`) instead of DOM ancestry. Only
// actions our tables actually bind get a description here — a canon action we never register (its diff-panel
// or REPL-tab family) would be a hint for a key nobody could ever press.
import { DEFAULT_BINDINGS } from "../keys/bindings.js";
import { useBindingLookup, type BindingLookup } from "../keys/KeymapProvider.js";
import { formatBinding } from "../keys/hints.js";
import { preferredKey } from "../keys/resolver.js";
import type { KeyContextName } from "../keys/types.js";

/** Canon `Ye`, L568825 — verbatim descriptions, for exactly the actions our own scopes register. */
export const KEY_HINT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "confirm:yes": "confirm",
  "confirm:no": "cancel",
  "confirm:previous": "navigate",
  "confirm:next": "navigate",
  "confirm:cycleMode": "cycle mode",
  "confirm:toggleExplanation": "explanation",
  "select:next": "navigate",
  "select:previous": "navigate",
  "select:pageUp": "page up",
  "select:pageDown": "page down",
  "select:first": "first",
  "select:last": "last",
  "select:accept": "select",
  "select:cancel": "cancel",
  "tabs:next": "switch tab",
  "tabs:previous": "switch tab",
};

/** Canon `Pe`, L568834 — the bar never shows more than this many hints. */
export const MAX_HINTS = 4;

/** One entry the caller injects ahead of a scope's own derived entries (canon `me` L568954-568960: the frame
 *  hardcodes its own `{action:"confirm:no", hint:"cancel"}` in front of whatever the body contributes, rather
 *  than pulling all of `Confirmation`'s bindings in — that would drag in `confirm:yes`/`confirm:previous`/…
 *  none of which the frame itself makes reachable). */
export interface KeyHintEntry { action: string; scope: KeyContextName }

/** `DialogFrame`'s own contribution when it claims a `Confirmation` scope for `onCancel` (see that module). */
export const CANCEL_HINT_ENTRY: readonly KeyHintEntry[] = [{ action: "confirm:no", scope: "Confirmation" }];

/** The distinct actions one context's default bindings name, in table declaration order — `null` (an explicit
 *  unbind) dropped, a repeated action (two keys naming the same one) collapsed to its first occurrence. */
function actionsForScope(scope: KeyContextName): string[] {
  const ctx = DEFAULT_BINDINGS.find((c) => c.context === scope);
  if (!ctx) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const action of Object.values(ctx.bindings)) {
    if (!action || seen.has(action)) continue;
    seen.add(action);
    out.push(action);
  }
  return out;
}

/** `${key} ${description}` for one action, or null when either half is missing: no registry entry, or no live
 *  binding left in `scope` (rebound away) — canon's own two skip arms (L568907-568916). */
function hintText(action: string, scope: KeyContextName, lookup: BindingLookup): string | null {
  const description = KEY_HINT_DESCRIPTIONS[action];
  if (!description) return null;
  const key = preferredKey(lookup(action, { contexts: [scope] }));
  if (key === undefined) return null;
  return `${formatBinding(key)} ${description}`;
}

/** Up to `MAX_HINTS` hint strings: `extra` first (verbatim, in order — a frame's own hardcoded entries), then
 *  each named scope's own derived actions, in scope + binding-table order. Deduped by DESCRIPTION throughout,
 *  so `extra` can shadow a scope's own entry for the same description (an onCancel's "cancel" beats a scope
 *  that happens to bind its own `confirm:no`). `scopes` absent (no caller opt-in) answers the empty bar. */
export function useKeyHints(
  scopes: KeyContextName | readonly KeyContextName[] | undefined,
  extra?: readonly KeyHintEntry[],
  max = MAX_HINTS,
): string[] {
  const lookup = useBindingLookup();
  const seenDescriptions = new Set<string>();
  const out: string[] = [];
  const consider = (action: string, scope: KeyContextName) => {
    if (out.length >= max) return;
    const description = KEY_HINT_DESCRIPTIONS[action];
    if (!description || seenDescriptions.has(description)) return;
    const text = hintText(action, scope, lookup);
    if (text === null) return;
    seenDescriptions.add(description);
    out.push(text);
  };
  for (const entry of extra ?? []) consider(entry.action, entry.scope);
  if (scopes !== undefined) {
    for (const scope of Array.isArray(scopes) ? scopes : [scopes]) {
      for (const action of actionsForScope(scope)) consider(action, scope);
    }
  }
  return out;
}
