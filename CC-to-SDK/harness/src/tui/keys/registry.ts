// tui/keys/registry.ts — who is listening, and in what order (F2 task 5, split out of KeymapProvider so the
// ordering rules are readable and testable on their own). Pure: no React, no Ink, no timers.
//
// ORDER IS MOUNT ORDER. Every registration is stamped with a monotonic sequence number the first time its hook
// renders, so "innermost" means "mounted most recently" — React mounts children after parents, and an overlay
// that appears later therefore outranks the composer beneath it without anyone having to declare a priority.
// Sets (not arrays) hold the entries because a hook registers during RENDER and deletes on unmount: add is
// idempotent, so a re-render never duplicates and never has to diff.
import type { KeyContextName, KeyEvent, MouseInputEvent, TextEvent } from "./types.js";

export interface ScopeEntry { seq: number; name: KeyContextName; active: boolean; preemptive: boolean }
/** Handlers take the matched ACTION as a second argument, which only a family handler (below) reads. */
export type ActionHandler = (e: KeyEvent, action: string) => void;
export interface ActionEntry { seq: number; handlers: Record<string, ActionHandler> }
/** `active:false` is the fallback's half of the scope option above, and it means the same thing: the entry
 *  stays registered but is INVISIBLE to resolution. It exists for the one component that stays mounted while
 *  something else owns the keyboard — the composer, still drawn below an inline decision dialog (F6 t5). */
export interface FallbackEntry { seq: number; handler: (e: KeyEvent | TextEvent) => void; active: boolean }
export interface SwallowEntry { seq: number; active: boolean }
export interface SuspendEntry { seq: number; handler: () => void }
/** F9 T-MOUSE task 7 — the selection-lifetime pre-table hook (Ctrl+C copy/clear, "any other key clears"),
 *  registered by ChatApp (the `ViewportHitmap` selection state's owner) exactly like `SuspendEntry` above and
 *  for the identical reason: it has to run BEFORE the table resolves the key, not after. The handler answers
 *  whether the event was fully CONSUMED (`true` — Ctrl+C while a selection is live, which must never also run
 *  `app:interrupt`); `false` means dispatch continues exactly as it would have, whatever side effect (clearing
 *  the highlight) the handler already applied. */
export interface SelectionKeyEntry { seq: number; handler: (e: KeyEvent | TextEvent) => boolean }
/** The mouse slot (task 7). A button report has no action to match and no fallback to fall through to, so this
 *  ONE entry is the whole delivery path — hence a sink rather than a handler table. `active` is the fallback's
 *  option and means the same thing here (registered, invisible to resolution), for the same owner-stays-mounted
 *  reason. */
export interface MouseEntry { seq: number; handler: (e: MouseInputEvent) => void; active: boolean }

export interface Registry {
  scopes: Set<ScopeEntry>; actions: Set<ActionEntry>; fallbacks: Set<FallbackEntry>; swallows: Set<SwallowEntry>;
  suspends: Set<SuspendEntry>; mouseSinks: Set<MouseEntry>; selectionKeys: Set<SelectionKeyEntry>;
}

export const createRegistry = (): Registry =>
  ({ scopes: new Set(), actions: new Set(), fallbacks: new Set(), swallows: new Set(), suspends: new Set(),
    mouseSinks: new Set(), selectionKeys: new Set() });

let seqCounter = 0;
/** Stamped once per hook instance (in a ref initializer), never re-stamped on re-render. */
export const nextSeq = (): number => ++seqCounter;

const newestFirst = <T extends { seq: number }>(entries: Iterable<T>): T[] => [...entries].sort((a, b) => b.seq - a.seq);
const liveScopes = (reg: Registry): ScopeEntry[] => newestFirst(reg.scopes).filter((s) => s.active);

/** The ordered context stack the resolver walks: preemptive scopes first (newest first), then ordinary scopes
 *  (newest first), then `Global` — which is always last and never has to be pushed by anyone. Duplicates are
 *  collapsed to their highest-priority occurrence, so two components sharing one context is harmless. */
export function activeContexts(reg: Registry): KeyContextName[] {
  const live = liveScopes(reg);
  const out: KeyContextName[] = [];
  for (const s of live) if (s.preemptive) out.push(s.name);
  for (const s of live) if (!s.preemptive) out.push(s.name);
  out.push("Global");
  return out.filter((name, i) => out.indexOf(name) === i);
}

/** Non-null when some mounted component is swallowing input (Help): the ONLY contexts that still resolve are
 *  the swallower's own. It is identified as the innermost live scope rather than by matching hooks to their
 *  component — by construction the swallower IS the innermost scope owner (a modal mounts last, and nothing
 *  mounts inside it), which also makes the rule independent of hook call order within that component. A
 *  swallower that pushes no scope at all swallows everything, `Global` included: that is the intended
 *  Help semantics, not an accident. */
export function swallowContexts(reg: Registry): KeyContextName[] | null {
  const swallowing = newestFirst(reg.swallows).some((s) => s.active);
  if (!swallowing) return null;
  const inner = liveScopes(reg)[0];
  return inner ? [inner.name] : [];
}

/** The innermost live handler for a matched action, or undefined — which is NOT an error: an action nobody
 *  handles yet falls through to the fallback so a half-migrated tree has no dead keys.
 *
 *  A handler may also register for a whole FAMILY by name (`"command:*"`), which is how the open-ended
 *  `command:<name>` form works: the user names the slash command, so no component can enumerate the handlers
 *  ahead of time. Exact beats family within one entry; an inner entry's family beats an outer entry's exact,
 *  because "innermost wins" is the rule everything else here follows. */
export function handlerFor(reg: Registry, action: string): ((e: KeyEvent) => void) | undefined {
  const colon = action.indexOf(":");
  const family = colon > 0 ? `${action.slice(0, colon + 1)}*` : null;
  for (const entry of newestFirst(reg.actions)) {
    const h = entry.handlers[action];
    if (h) return (e) => h(e, action);
    const f = family ? entry.handlers[family] : undefined;
    if (f) return (e) => f(e, action);
  }
  return undefined;
}

/** The innermost LIVE fallback — the composer's editor in the real tree, "component code below the table"
 *  upstream. Inactive entries are skipped rather than shadowing, which is what makes a still-mounted composer
 *  yield the keyboard to a dialog drawn above it. */
export function fallbackHandler(reg: Registry): ((e: KeyEvent | TextEvent) => void) | undefined {
  return newestFirst(reg.fallbacks).find((f) => f.active)?.handler;
}

/** The innermost LIVE mouse sink, or undefined — which is the ordinary case, not an error: for as long as
 *  nothing in the tree wants clicks, a button report is consumed and dropped exactly as it was before the slot
 *  existed. Same shape as `fallbackHandler` above, and for the same reason: inactive entries are skipped rather
 *  than shadowing, so a still-mounted owner can yield the mouse to whatever is drawn over it. */
export function mouseHandler(reg: Registry): ((e: MouseInputEvent) => void) | undefined {
  return newestFirst(reg.mouseSinks).find((m) => m.active)?.handler;
}

/** The innermost registered ctrl+z handler (task 6: ChatApp, which is where Ink's `useStdin`/`useStdout` and
 *  the `suspend`/`resumeOutput` seams live — suspendProcess needs the REAL tty object, not a value the
 *  provider could construct). Undefined falls back to `KeymapDeps.suspend`. */
export function suspendHandler(reg: Registry): (() => void) | undefined {
  return newestFirst(reg.suspends)[0]?.handler;
}

/** The innermost registered selection-lifetime handler (F9 T-MOUSE task 7: ChatApp). Undefined — no
 *  selection surface mounted, or no track built on this registry at all — means every key resolves exactly
 *  as it did before this track, the same "absent is a no-op" shape as `suspendHandler`. */
export function selectionKeyHandler(reg: Registry): ((e: KeyEvent | TextEvent) => boolean) | undefined {
  return newestFirst(reg.selectionKeys)[0]?.handler;
}
