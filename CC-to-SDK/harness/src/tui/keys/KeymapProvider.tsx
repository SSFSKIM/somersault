// tui/keys/KeymapProvider.tsx — the root input owner (F2 task 5): the ONE component that reads raw stdin
// bytes, and the place the pure engine (parse → resolve → chord machine) meets React/Ink.
//
// WHY it owns the bytes instead of using `useInput` (P86/P86b, measured — the recipe below is normative):
//  * Ink's `useInput` projects every key onto a fixed 14-boolean record and throws `keypress.name` away, so
//    home ≡ end ≡ insert ≡ F1–F12 are indistinguishable and half the binding table is inexpressible.
//  * Raw mode is still taken through `useStdin().setRawMode(true)`, NEVER `process.stdin` directly: Ink must
//    keep owning termios restore and the stdin unref, or the process cannot exit cleanly.
//  * `stdin.setEncoding?.("latin1")` — optional-call because ink-testing-library's stub has a no-op/absent
//    one. Not utf8 (Ink's own `handleSetRawMode` sets utf8, which mangles high bytes into U+FFFD before we
//    ever see them — we set latin1 AFTER, and effects run parent-last so ours is the surviving call), and
//    not null (that silently falls back to utf8). Bytes arrive lossless; text is re-decoded below.
//  * The render must pass `exitOnCtrlC: false` (chatMain does) — otherwise Ink exits under our ctrl+c action.
//
// Registration discipline (the F0 lesson): scopes, handlers and fallbacks are written into ref-held registry
// entries DURING RENDER, not in effects. Input subscriptions are passive — a key can arrive after a newer
// render has painted but before its effects flush — so anything a handler reads must already be current.
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStdin } from "ink";
import { parseBytes } from "./parse.js";
import type { InputEvent, KeyContextName, KeyEvent, TextEvent } from "./types.js";
import { DEFAULT_BINDINGS, type ContextBindings } from "./bindings.js";
import { bindingFor, bindingsFor, compileBindings, resolveKey, type CompiledTable } from "./resolver.js";
import { defaultLookup } from "./hints.js";
import type { KeySpec } from "./normalize.js";
import { activeContexts, createRegistry, fallbackHandler, handlerFor, nextSeq, suspendHandler, swallowContexts,
  type ActionEntry, type ActionHandler, type FallbackEntry, type Registry, type ScopeEntry, type SuspendEntry, type SwallowEntry } from "./registry.js";

export interface KeymapDeps {
  now?: () => number; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout;
  userLayers?: readonly ContextBindings[];            // task 9 feeds live ~/.claude/keybindings.json here
  suspend?: () => void;                               // ctrl+z pre-table hook; `useKeySuspend` outranks it
}

/** Chord inter-key timeout (spec KB22). */
const CHORD_MS = 1000;
const PASTE_START = "\x1b[200~", PASTE_END = "\x1b[201~";
/** Cap on a paste held across chunks: past this we flush rather than grow unboundedly on a stuck stream. */
const PASTE_CAP = 1 << 20;

interface KeymapValue { reg: Registry; table: CompiledTable }
const KeymapCtx = createContext<KeymapValue | null>(null);

/** True when a chunk ends INSIDE a bracketed paste (only possible if some other party enabled `?2004h`; F2
 *  never does). Parsing it now would hand the tail to the keypress path — `\r` included — which is exactly
 *  the enter-mid-paste that paste protection exists to prevent. */
const pasteOpen = (s: string): boolean => {
  const start = s.lastIndexOf(PASTE_START);
  return start !== -1 && s.indexOf(PASTE_END, start) === -1;
};
/** Text arrives as latin1-decoded BYTES (see the encoding note above); the composer wants characters. Key
 *  events are ASCII-named and unaffected. */
const decodeText = (text: string): string => Buffer.from(text, "latin1").toString("utf8");

export function KeymapProvider({ children, deps }: { children: React.ReactNode; deps?: KeymapDeps }): React.ReactElement {
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const regRef = useRef<Registry>(); if (!regRef.current) regRef.current = createRegistry();
  const reg = regRef.current;
  const depsRef = useRef(deps); depsRef.current = deps;
  const userLayers = deps?.userLayers;
  // Compile once per layers change, never per keypress.
  const table = useMemo(() => compileBindings([...DEFAULT_BINDINGS, ...(userLayers ?? [])]), [userLayers]);
  const tableRef = useRef(table); tableRef.current = table;

  const pendingRef = useRef<KeySpec[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pasteRef = useRef("");

  const clearChord = () => {
    if (timerRef.current !== null) { (depsRef.current?.clearTimeout ?? clearTimeout)(timerRef.current); timerRef.current = null; }
    pendingRef.current = [];
  };
  const armChord = (pending: KeySpec[]) => {
    clearChord();
    pendingRef.current = pending;
    timerRef.current = (depsRef.current?.setTimeout ?? setTimeout)(() => { timerRef.current = null; pendingRef.current = []; }, CHORD_MS);
  };

  const dispatch = (ev: InputEvent) => {
    if (ev.kind === "ignored") return;                                  // mouse/focus/garbage: consumed, never inserted
    // ctrl+z is handled ABOVE the table, like upstream's raw input loop: it must suspend even while Help
    // swallows everything and even mid-chord (F0 contract).
    if (ev.kind === "key" && ev.ctrl && ev.name === "z") { (suspendHandler(reg) ?? depsRef.current?.suspend)?.(); return; }
    const swallowed = swallowContexts(reg);
    if (ev.kind === "text") {
      // Text is keypresses: it breaks a pending chord like any non-extension key would. Without this,
      // `ctrl+x`, a fast-typed word, then `ctrl+k` within the window would fire chat:killAgents.
      clearChord();
      if (swallowed) return;
      fallbackHandler(reg)?.({ ...ev, text: decodeText(ev.text) });
      return;
    }
    const hadPending = pendingRef.current.length > 0;
    const res = resolveKey(ev, swallowed ?? activeContexts(reg), tableRef.current, pendingRef.current);
    if (res.type === "chord-started") { armChord(res.pending); return; }
    clearChord();                                                        // every other outcome ends the chord
    if (res.type === "unbound" || res.type === "chord-cancelled") return;               // consumed
    if (res.type === "match") { const h = handlerFor(reg, res.action); if (h) { h(ev); return; } }   // else: fall through
    if (res.type === "no-match" && hadPending) return;                   // the key that broke a chord is dropped
    if (swallowed) return;
    fallbackHandler(reg)?.(ev);
  };

  const consume = (chunk: string) => {
    const data = pasteRef.current + chunk;
    pasteRef.current = "";
    if (data.length <= PASTE_CAP && pasteOpen(data)) { pasteRef.current = data; return; }
    for (const ev of parseBytes(data)) dispatch(ev);
  };
  // The `data` listener is attached once; everything it reaches goes through this ref so it always runs the
  // current render's closure without re-subscribing (and without ever missing a keystroke in between).
  const consumeRef = useRef(consume); consumeRef.current = consume;
  // Detach happens in a PASSIVE cleanup, which React flushes a tick after the tree is gone — so liveness is
  // tracked in a layout effect, whose cleanup runs synchronously during the unmount commit. Without it a key
  // arriving in that window would dispatch into components that no longer exist.
  const aliveRef = useRef(true);
  useLayoutEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  // Deliberately PASSIVE, not layout: React runs passive effects child-first, so our latin1 lands AFTER any
  // Ink `handleSetRawMode` that forced utf8. A layout effect here would run first and lose the encoding to the
  // next child. As of task 8 nothing under src/tui subscribes to Ink's input at all, so Ink re-sets utf8 only
  // for the provider's OWN setRawMode below — our flip is last, and it now survives every dialog mount for the
  // life of the process. The transitional window where a dialog could reset the encoding under us is closed.
  useEffect(() => {
    if (!isRawModeSupported) return;
    setRawMode(true);
    // Gate the latin1 flip on a registered consumer existing (children register during render, so by the time
    // this parent-last passive effect runs, the registry is truthful). It is what kept the flip from handing
    // raw bytes to a still-unmigrated `useInput` component — mojibake for every non-ASCII character typed at
    // launch (t5 review, Important). The migration is finished, so in the real tree this is always true; it
    // stays because a bare <KeymapProvider> with no consumers (a test harness, a future embed) must not touch
    // an encoding nobody is decoding.
    const migrated = reg.scopes.size + reg.actions.size + reg.fallbacks.size > 0;
    if (migrated) stdin.setEncoding?.("latin1");
    const onData = (data: string | Buffer) => {
      if (!aliveRef.current) return;
      consumeRef.current(typeof data === "string" ? data : data.toString("latin1"));
    };
    // Ordering note (task 6, measured; RESOLVED in task 8): Ink reads stdin on "readable"
    // (ink/build/components/App.js `handleReadable`) and fans out from there, and a stream emits "readable"
    // before "data" — so while any `useInput` consumer was still live, that component saw a byte, closed
    // itself and re-rendered the tree BEFORE this listener ran. Two temporary guards absorbed the window
    // (ChatApp's settled-gate ref, ChatComposer's `mounted`); both are deleted, because Ink now reads the
    // stream and dispatches to zero subscribers and nothing can re-render the tree ahead of us.
    stdin.on("data", onData);
    return () => {
      stdin.removeListener("data", onData);
      // A paste still in flight is DROPPED: this cleanup runs while the tree is mid-teardown, so dispatching
      // here would either reach half-unmounted components or nobody. Dropping is the honest option.
      pasteRef.current = "";
      clearChord();
      setRawMode(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ reg, table }), [reg, table]);
  return <KeymapCtx.Provider value={value}>{children}</KeymapCtx.Provider>;
}

/** Registration is a render-time side effect on a ref-held entry; the effect exists only to unregister. Every
 *  hook below follows this shape, so a value a handler reads is current the instant the render that produced
 *  it returns — before Ink has painted, and long before effects flush. (Safe because Ink renders through the
 *  synchronous, always-committing path: there is no concurrent render whose entry would leak unmounted.) */
function useRegistration<T extends { seq: number }>(set: Set<T> | undefined, make: () => T, update: (entry: T) => void): void {
  const ref = useRef<T>(); if (!ref.current) ref.current = make();
  update(ref.current);
  if (set) set.add(ref.current);
  useEffect(() => () => { set?.delete(ref.current!); }, [set]);
}

/** Push a context onto the stack while this component is mounted. `active:false` keeps the registration but
 *  takes it out of resolution (a scope that comes and goes with a popup); `preemptive` lifts it above every
 *  ordinary scope regardless of mount order. Without a provider above, this is a no-op. */
export function useKeyScope(name: KeyContextName, opts?: { active?: boolean; preemptive?: boolean }): void {
  const ctx = useContext(KeymapCtx);
  useRegistration<ScopeEntry>(ctx?.reg.scopes, () => ({ seq: nextSeq(), name, active: true, preemptive: false }),
    (e) => { e.name = name; e.active = opts?.active ?? true; e.preemptive = opts?.preemptive ?? false; });
}

/** Handlers for matched actions. Innermost registration wins per action; an action nobody registers falls
 *  through to the fallback rather than dying. A key of the form `"family:*"` catches every action in that
 *  family and receives the matched name as its second argument — the open-ended `command:<name>` form (K6)
 *  is the one user of it, because the ACTION comes from the user's file and cannot be enumerated here. */
export function useKeyActions(handlers: Record<string, ActionHandler>): void {
  const ctx = useContext(KeymapCtx);
  useRegistration<ActionEntry>(ctx?.reg.actions, () => ({ seq: nextSeq(), handlers }), (e) => { e.handlers = handlers; });
}

/** Everything the table did not consume — unmatched keys and all insertable text. Innermost only. */
export function useKeyFallback(handler: (e: KeyEvent | TextEvent) => void): void {
  const ctx = useContext(KeymapCtx);
  useRegistration<FallbackEntry>(ctx?.reg.fallbacks, () => ({ seq: nextSeq(), handler }), (e) => { e.handler = handler; });
}

/** The ctrl+z (SIGTSTP) handler, registered where Ink's `useStdin`/`useStdout` and the app's own suspend
 *  seams are reachable — ChatApp. Pre-table like the raw loop upstream: it fires under Help's swallow and
 *  mid-chord alike. Innermost registration wins; with none, `KeymapDeps.suspend` still applies. */
export function useKeySuspend(handler: () => void): void {
  const ctx = useContext(KeymapCtx);
  useRegistration<SuspendEntry>(ctx?.reg.suspends, () => ({ seq: nextSeq(), handler }), (e) => { e.handler = handler; });
}

/** Help semantics: while active, only this component's own context resolves — every other scope, `Global`
 *  included, and all text is dropped. ctrl+z still suspends (it is handled above the table). */
export function useSwallowKeys(active: boolean): void {
  const ctx = useContext(KeymapCtx);
  useRegistration<SwallowEntry>(ctx?.reg.swallows, () => ({ seq: nextSeq(), active }), (e) => { e.active = active; });
}

/** What every user-visible key hint reads from (task 10): `lookup(action)` returns the canonical keys bound to
 *  it RIGHT NOW, so a hint prints the user's own keymap instead of a hardcoded guess, and prints nothing at all
 *  for an action they unbound. One hook, not one per hint, so a component can resolve a whole row list without
 *  calling hooks in a loop.
 *
 *  Ordering: live scopes first (an action bound in two contexts hints the key that would actually fire HERE),
 *  then the rest of the table — so a hint rendered outside its own scope still resolves. `{ live: true }` drops
 *  that second half: it is how a hint stays honest about OWNERSHIP (the status bar must not advertise the
 *  composer's mode key while a dialog owns the keyboard — F0's "a status hint is only honest relative to its
 *  focused owner").
 *
 *  With no provider above (a component rendered bare), the DEFAULT table answers "what is bound" — the truthful
 *  answer for a tree with no user layer, where printing "(unbound)" for every key would be a worse lie. But
 *  `{ live: true }` asks a DIFFERENT question — "what would fire HERE, right now" — and a tree with no provider
 *  has no input path at all, so the honest answer to that one is nothing. This branch used to be written as a
 *  ONE-parameter lambda typed as the two-parameter `BindingLookup`, which silently dropped `opts` and answered
 *  the live question with the defaults: a hint for a key nobody could deliver (t10 review, Important). */
export type BindingLookup = (action: string, opts?: { live?: boolean }) => string[];

export function useBindingLookup(): BindingLookup {
  const ctx = useContext(KeymapCtx);
  if (!ctx) return (action, opts) => (opts?.live ? [] : defaultLookup(action));
  const live = activeContexts(ctx.reg);
  const rest = ([...ctx.table.contexts.keys()] as KeyContextName[]).filter((c) => !live.includes(c));
  return (action, opts) => bindingsFor(ctx.table, action, opts?.live ? live : [...live, ...rest]);
}

/** The single display key for `action` (e.g. `"shift+tab"`), or null. Sugar over `useBindingLookup` for the
 *  call sites that want exactly one key; the plain-key-beats-chord rule lives in the resolver. */
export function useBinding(action: string): string | null {
  const ctx = useContext(KeymapCtx);
  if (!ctx) return null;
  const live = activeContexts(ctx.reg);
  const rest = ([...ctx.table.contexts.keys()] as KeyContextName[]).filter((c) => !live.includes(c));
  return bindingFor(ctx.table, action, [...live, ...rest]);
}
