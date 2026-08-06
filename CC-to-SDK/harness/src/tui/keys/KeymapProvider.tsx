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
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStdin, useStdout } from "ink";
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
  /** Wave R task 3: raw terminal REPLIES, forwarded verbatim. A DSR cursor report (`\x1b[<row>;<col>R`, the
   *  reflow oracle's answer) parses to `ignored("unknown-sequence")` — correctly, `CSI_LETTER` has no `R` — and
   *  `dispatch` then drops it, so nothing in the tree could read a terminal's answer at all. The forward exists
   *  because this provider owns the ONE raw-stdin reader: a second consumer would race it and lose keystrokes
   *  intermittently. Mouse and focus reports are `ignored` too and deliberately do NOT come through here. */
  onUnknownSequence?: (raw: string) => void;
  /** Test seam for the DECSET 2004 writes below. Real runs take `useStdout()`; ink-testing-library's stdout
   *  stub has no `isTTY`, so without this a keyless test cannot observe the mode toggles at all (and the real
   *  writes would otherwise pollute `lastFrame()`, since that stub's `write` IS the frame buffer). */
  stdout?: { isTTY?: boolean; write: (data: string) => unknown };
}

/** Chord inter-key timeout (spec KB22). */
const CHORD_MS = 1000;
const PASTE_START = "\x1b[200~", PASTE_END = "\x1b[201~";
/** DECSET 2004 — bracketed paste. Upstream names the mode `ev.BRACKETED_PASTE` (bundle L177069) and writes the
 *  enable the moment it takes raw mode (L177900), which is what makes a terminal wrap pasted text in
 *  `\x1b[200~ … \x1b[201~` at all. Without this write nothing downstream of it exists: the provider's paste
 *  assembly, the `paste: true` tag and the chip are all reachable only from marked input (t3 review, Critical). */
const PASTE_MODE_ON = "\x1b[?2004h", PASTE_MODE_OFF = "\x1b[?2004l";
/** Cap on a paste held across chunks: past this we flush rather than grow unboundedly on a stuck stream. */
const PASTE_CAP = 1 << 20;

/** Hand fd 0 to a CHILD PROCESS for the duration of `fn`, then take it back. See `useSuspendInput`. */
export type SuspendInput = <T>(fn: () => Promise<T>) => Promise<T>;

interface KeymapValue { reg: Registry; table: CompiledTable; suspendInput: SuspendInput; pasting: boolean }
const KeymapCtx = createContext<KeymapValue | null>(null);

/** True when a chunk ends INSIDE a bracketed paste (the provider asks for the markers itself — see
 *  `PASTE_MODE_ON`). Parsing it now would hand the tail to the keypress path — `\r` included — which is
 *  exactly the enter-mid-paste that paste protection exists to prevent. */
const pasteOpen = (s: string): boolean => {
  const start = s.lastIndexOf(PASTE_START);
  return start !== -1 && s.indexOf(PASTE_END, start) === -1;
};
/** Text arrives as latin1-decoded BYTES (see the encoding note above); the composer wants characters. Key
 *  events are ASCII-named and unaffected. */
const decodeText = (text: string): string => Buffer.from(text, "latin1").toString("utf8");

/** How many bytes the UTF-8 sequence introduced by `b` occupies; 0 if `b` is not a lead byte. 0xC0/0xC1 and
 *  0xF5+ never appear in valid UTF-8, so they are not leads and nothing is ever held for them. */
const utf8Len = (b: number): number => (b >= 0xf0 && b <= 0xf4 ? 4 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xc2 && b <= 0xdf ? 2 : 0);
/** Index at which an INCOMPLETE trailing UTF-8 sequence begins, or -1 when the chunk ends on a character
 *  boundary. Read under latin1 each byte is its own char, and a lone high byte is `isPrintable` — so a chunk
 *  torn mid-character used to end as a one-byte run, which the parser names a KeyEvent (`printableKey`), and
 *  only TextEvents are re-decoded above: `é` split C3|A9 reached the editor as two mojibake keystrokes (final
 *  review). The parser cannot see this — it is handed one chunk and one chunk is all it may reason about — so
 *  the fix lives here, where the STREAM is. At most 3 bytes are ever behind a lead byte, which bounds the walk
 *  and therefore the carry. */
function incompleteTail(s: string): number {
  for (let i = s.length - 1, back = 0; i >= 0 && back < 3; i--, back++) {
    const c = s.charCodeAt(i);
    if (c >= 0x80 && c <= 0xbf) continue;                 // a continuation byte: its lead is further back
    const need = utf8Len(c);
    if (need === 0) return -1;                            // ASCII or garbage: whatever trails is complete as-is
    return s.length - i < need ? i : -1;
  }
  return -1;
}

/** Index at which a chunk-trailing PROPER PREFIX of the OPEN marker begins, or -1. The sibling of
 *  `incompleteTail` for the other thing a read boundary can cut in half, and the same reasoning puts it here:
 *  the parser is handed one chunk and one chunk is all it may reason about, so only the STREAM can re-join
 *  `\x1b[20` | `0~payload`. Left torn, the front half parsed as an unknown CSI (discarded) and the payload
 *  then parsed as ORDINARY input — an embedded `\r` became `enter` and submitted half a paste, which is the
 *  exact accident paste protection exists to prevent (F5 final review, P1). `pasteOpen` cannot see it either:
 *  there is no `\x1b[200~` in the chunk to find.
 *
 *  The END marker needs no equivalent: a chunk that CLOSES a paste is one whose paste is still open, so the
 *  whole buffer is already held by `pasteOpen` and the two halves meet there (the overflow latch, which is
 *  the one path that does NOT hold, carries `overflowTailRef` for precisely this).
 *
 *  LENGTH 2 IS THE FLOOR, deliberately: a lone trailing `\x1b` is also a proper prefix, but it is far more
 *  often the Escape KEY, and holding it would make Escape do nothing until the user pressed something else.
 *  This file has no escape timeout by design (parse.ts §1.10) and is not growing one for a 1-in-6 split
 *  point; a marker torn after exactly one byte therefore still misparses, and the Escape key still answers
 *  on the read that carries it. */
function pasteStartTail(s: string): number {
  for (let n = Math.min(PASTE_START.length - 1, s.length); n >= 2; n--) if (s.endsWith(PASTE_START.slice(0, n))) return s.length - n;
  return -1;
}

export function KeymapProvider({ children, deps }: { children: React.ReactNode; deps?: KeymapDeps }): React.ReactElement {
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
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
  /** The tail bytes a read boundary cut in half — a character (≤3, `incompleteTail`) or the front of a paste
   *  OPEN marker (≤5, `pasteStartTail`) — and the "this paste ran past the cap, discard until its end marker"
   *  latch. Both are stream state, both are dropped at teardown exactly like the paste buffer. */
  const carryRef = useRef("");
  const overflowRef = useRef(false);
  // While the latch is set: the last PASTE_END.length-1 bytes of every discarded chunk (and of the chunk that
  // ENTERED overflow, whose emitted prefix can end with the marker's front half). Without it, an end marker
  // split across two reads is invisible to indexOf and the latch never releases — total keyboard death, since
  // the latch sits above even the ctrl+z pre-table hook (final-fix re-review).
  const overflowTailRef = useRef("");
  // F5 task 3: the composer's dim `Pasting…` row (bundle L493764) is the user-visible face of `pasteRef` holding
  // an unterminated paste. The ref is the truth (it is written from the stdin listener, where a render is a tick
  // away); the state exists only to repaint, and `pastingRef` keeps that setState down to the two edges.
  const [pasting, setPasting] = useState(false);
  const pastingRef = useRef(false);

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
    // mouse/focus/garbage: consumed, never inserted. An unknown SEQUENCE is also how a terminal REPLY arrives
    // (the oracle's DSR cursor report), so it is forwarded raw on the way out — see `onUnknownSequence`.
    if (ev.kind === "ignored") { if (ev.reason === "unknown-sequence") depsRef.current?.onUnknownSequence?.(ev.raw); return; }
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

  // Parse and dispatch one already-assembled run of bytes, TAGGING bracketed-paste payloads as they go.
  //
  // parse.ts already collapses `\x1b[200~ … \x1b[201~` into one text event (`parsePaste`), but it cannot say
  // where that text CAME FROM, and provenance is the entire basis of the chip decision downstream (a
  // hand-typed 900-character run must stay literal). It also cannot ever learn: the markers arrive torn across
  // reads, and the overflow latch below hands it a capped prefix with no end marker at all. Both of those are
  // STREAM facts, and the stream is this file's — so the split happens here and parse.ts stays pure.
  // Everything outside a paste still goes through the parser untouched, and the common no-paste chunk costs
  // exactly one `indexOf`.
  const emit = (data: string) => {
    let i = 0;
    while (i < data.length) {
      const start = data.indexOf(PASTE_START, i);
      if (start === -1) break;
      if (start > i) for (const ev of parseBytes(data.slice(i, start))) dispatch(ev);
      const from = start + PASTE_START.length;
      const end = data.indexOf(PASTE_END, from);
      const consumed = end === -1 ? data.length : end + PASTE_END.length;      // unterminated = the overflow prefix
      const text = data.slice(from, end === -1 ? data.length : end);
      if (text.length > 0) dispatch({ kind: "text", text, raw: data.slice(start, consumed), paste: true });
      i = consumed;
    }
    if (i < data.length) for (const ev of parseBytes(data.slice(i))) dispatch(ev);
  };

  const consumeInner = (chunk: string) => {
    // Mid-overflow: every byte still belongs to a paste whose payload was already capped and emitted. DISCARD
    // it — parsing it would hand an embedded `\r` to the keypress path and submit the composer mid-paste,
    // which is the accident paste protection exists to prevent. Only the end marker is looked for, and only
    // what FOLLOWS it in that chunk resumes normal parsing (final review).
    if (overflowRef.current) {
      // Search the retained tail + this chunk so a marker split across reads is re-joined. On a miss, keep
      // the new tail; retained bytes preceding a found marker were already emitted into the capped prefix
      // (or discarded), so only what FOLLOWS the marker resumes parsing.
      const scan = overflowTailRef.current + chunk;
      const end = scan.indexOf(PASTE_END);
      if (end === -1) { overflowTailRef.current = scan.slice(-(PASTE_END.length - 1)); return; }
      overflowRef.current = false; overflowTailRef.current = "";
      chunk = scan.slice(end + PASTE_END.length);
      if (chunk === "") return;
    }
    // At most ONE of these two holds anything: an open paste returns before a carry can be taken, and a carry
    // is only ever taken from a chunk that was not held as a paste.
    const data = pasteRef.current + carryRef.current + chunk;
    pasteRef.current = ""; carryRef.current = "";
    if (pasteOpen(data)) {
      if (data.length <= PASTE_CAP) { pasteRef.current = data; return; }
      overflowRef.current = true;   // …and fall through to emit the capped prefix, with today's truncation
      // Seed the tail from THIS data too: the prefix about to be parsed can end with the marker's front
      // half. A full PASTE_END cannot be in this tail (pasteOpen would have been false), so no false release.
      overflowTailRef.current = data.slice(-(PASTE_END.length - 1));
    }
    // Hold back a torn trailing character — or a torn OPEN marker — for the next chunk, but never while
    // overflowing, where the tail is about to be discarded anyway and prepending it to the post-marker
    // remainder would corrupt it. The two are mutually exclusive in practice (every prefix of `\x1b[200~`
    // ends in an ASCII byte, on which `incompleteTail` answers -1), so asking the second only when the first
    // declines costs nothing. Either way the hold is bounded — 3 bytes there, 5 here — and a held prefix that
    // the next chunk does NOT complete is simply re-fed as ordinary bytes, parsing as whatever it is.
    const torn = overflowRef.current ? -1 : incompleteTail(data);
    const cut = torn === -1 && !overflowRef.current ? pasteStartTail(data) : torn;
    if (cut === -1) { emit(data); return; }
    carryRef.current = data.slice(cut);
    emit(data.slice(0, cut));
  };
  // One place to reconcile `pasting` with the buffer, AFTER the chunk is fully handled — `consumeInner` returns
  // from five different points and every one of them can have opened or closed a paste.
  const consume = (chunk: string) => {
    consumeInner(chunk);
    // The overflow latch counts as OPEN: its bytes still belong to a paste that is still arriving (they are
    // being discarded, but the user is mid-gesture), and reporting idle there flickered `Pasting…` off for
    // every chunk after the cap and back on at nothing (t3 review, Minor).
    const open = pasteRef.current !== "" || overflowRef.current;
    if (open !== pastingRef.current) { pastingRef.current = open; setPasting(open); }
  };
  // The `data` listener is attached once; everything it reaches goes through this ref so it always runs the
  // current render's closure without re-subscribing (and without ever missing a keystroke in between).
  const consumeRef = useRef(consume); consumeRef.current = consume;
  // Detach happens in a PASSIVE cleanup, which React flushes a tick after the tree is gone — so liveness is
  // tracked in a layout effect, whose cleanup runs synchronously during the unmount commit. Without it a key
  // arriving in that window would dispatch into components that no longer exist.
  const aliveRef = useRef(true);
  useLayoutEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  // Ink's `handleSetRawMode` (node_modules/ink/build/components/App.js:114) sets utf8 on EVERY call, enable or
  // disable — so any raw-mode toggle after mount clobbers our latin1 flip and has to re-apply it. Same gate as
  // the mount effect: a provider with no registered consumer must not touch an encoding nobody is decoding.
  const applyEncoding = () => { if (reg.scopes.size + reg.actions.size + reg.fallbacks.size > 0) stdin.setEncoding?.("latin1"); };

  // DECSET 2004 on/off. Gated on `isTTY`, the same gate `suspend.ts` and `useChat`'s clearScreen use for their
  // own out-of-band escape writes: a pipe or a test stub must not receive terminal mode bytes. Every caller is
  // already inside an `isRawModeSupported` branch, so the enable and the disable stay paired.
  const stdoutRef = useRef(stdout); stdoutRef.current = stdout;
  const bracketedPaste = (on: boolean) => {
    const out = depsRef.current?.stdout ?? stdoutRef.current;
    if (out?.isTTY) out.write(on ? PASTE_MODE_ON : PASTE_MODE_OFF);
  };

  // suspendInput (t2 review, Important). An external editor spawned with stdio "inherit" shares fd 0 with us,
  // and our `data` listener keeps the stream FLOWING — so the harness races the child for its keystrokes and a
  // stolen `\r` reaches submitTurn mid-edit. Upstream never has this problem: its external edit is still
  // spawnSync (L317767/L317708), and blocking the event loop IS its terminal handoff. Ours awaits, so the
  // handoff has to be explicit:
  //   (a) `setRawMode(false)` through Ink's own function, per this file's raw-mode rule. It is a REFERENCE
  //       COUNT (see suspend.ts's header for the full reasoning), but the provider's own enable/disable pair is
  //       symmetric, so the count returns to exactly where it was — unlike ctrl+z, which must drain an unknown
  //       count and therefore bypasses Ink entirely.
  //   (b) `stdin.pause()` — a paused stream emits no "data" and libuv stops reading fd 0, so the child owns
  //       the tty for real rather than merely being raced less often.
  //   (c) the flag below, which DROPS anything that still reaches us. Bytes arriving here during the flight were
  //       stolen from the child; dropping them is the honest option (the same call the teardown path makes for
  //       a paste in flight), and it is the part a keyless test can observe.
  // Re-entrant calls just run `fn`: the terminal is already handed over, and a nested restore would take it back
  // while the outer edit is still running.
  const suspendedRef = useRef(false);
  const suspendInput = useMemo<SuspendInput>(() => async (fn) => {
    if (suspendedRef.current) return fn();
    suspendedRef.current = true;
    // (d) hand back DECSET 2004 too. The child owns the tty next and sets whatever modes it wants; leaving our
    // enable standing would have the terminal wrap ITS pastes in markers it never asked for. Symmetric with the
    // mount effect, and re-enabled in the `finally` beside raw mode and the encoding (t3 review).
    if (isRawModeSupported) { bracketedPaste(false); setRawMode(false); }
    stdin.pause?.();
    try { return await fn(); }
    finally {
      stdin.resume?.();
      if (isRawModeSupported) { setRawMode(true); bracketedPaste(true); }
      applyEncoding();
      suspendedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin, setRawMode, isRawModeSupported]);

  // Deliberately PASSIVE, not layout: React runs passive effects child-first, so our latin1 lands AFTER any
  // Ink `handleSetRawMode` that forced utf8. A layout effect here would run first and lose the encoding to the
  // next child. As of task 8 nothing under src/tui subscribes to Ink's input at all, so Ink re-sets utf8 only
  // for the provider's OWN setRawMode below — our flip is last, and it now survives every dialog mount for the
  // life of the process. The transitional window where a dialog could reset the encoding under us is closed.
  useEffect(() => {
    if (!isRawModeSupported) return;
    setRawMode(true);
    // Ask the terminal to bracket pastes. Ungated by the registered-consumer check that guards the encoding:
    // the mode costs nothing when nobody reads it, and gating it would risk an enable/disable pair that
    // disagreed about whether a consumer existed.
    bracketedPaste(true);
    // Gate the latin1 flip on a registered consumer existing (children register during render, so by the time
    // this parent-last passive effect runs, the registry is truthful). It is what kept the flip from handing
    // raw bytes to a still-unmigrated `useInput` component — mojibake for every non-ASCII character typed at
    // launch (t5 review, Important). The migration is finished, so in the real tree this is always true; it
    // stays because a bare <KeymapProvider> with no consumers (a test harness, a future embed) must not touch
    // an encoding nobody is decoding.
    applyEncoding();
    const onData = (data: string | Buffer) => {
      if (!aliveRef.current || suspendedRef.current) return;         // suspended: these bytes belong to the child
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
      // here would either reach half-unmounted components or nobody. Dropping is the honest option. The held
      // half-character goes the same way (it was never a complete character), and so does the overflow latch.
      pasteRef.current = ""; carryRef.current = ""; overflowRef.current = false; overflowTailRef.current = "";
      clearChord();
      bracketedPaste(false);                                     // leave the terminal as we found it
      setRawMode(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ reg, table, suspendInput, pasting }), [reg, table, suspendInput, pasting]);
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

/** Everything the table did not consume — unmatched keys and all insertable text. Innermost LIVE one only.
 *
 *  `active:false` mirrors `useKeyScope`'s own option and means exactly what it means there: the entry is not
 *  in resolution at all, so the next fallback out is the innermost one. F6 t5 added it for the composer, the
 *  one component that stays MOUNTED while another surface owns the keyboard: a permission/question dialog now
 *  renders inline ABOVE a still-visible composer, and without this the composer's fallback would swallow every
 *  digit, letter and unbound key the dialog reads (plan-review finding 1). Deactivating beats unmounting here
 *  because the draft, the popup state and the history walk all have to survive the dialog. */
export function useKeyFallback(handler: (e: KeyEvent | TextEvent) => void, opts?: { active?: boolean }): void {
  const ctx = useContext(KeymapCtx);
  useRegistration<FallbackEntry>(ctx?.reg.fallbacks, () => ({ seq: nextSeq(), handler, active: true }),
    (e) => { e.handler = handler; e.active = opts?.active ?? true; });
}

/** The ctrl+z (SIGTSTP) handler, registered where Ink's `useStdin`/`useStdout` and the app's own suspend
 *  seams are reachable — ChatApp. Pre-table like the raw loop upstream: it fires under Help's swallow and
 *  mid-chord alike. Innermost registration wins; with none, `KeymapDeps.suspend` still applies. */
export function useKeySuspend(handler: () => void): void {
  const ctx = useContext(KeymapCtx);
  useRegistration<SuspendEntry>(ctx?.reg.suspends, () => ({ seq: nextSeq(), handler }), (e) => { e.handler = handler; });
}

/** The terminal handoff for anything that gives fd 0 to a child process (today: the composer's external
 *  editor). `suspendInput(fn)` releases raw mode, stops reading stdin, awaits `fn`, and restores all of it in a
 *  `finally` — so a throw or a rejection can never leave the harness deaf. Null with no provider above: a tree
 *  with no input path has nothing to hand over, and the caller runs `fn` as-is. */
export function useSuspendInput(): SuspendInput | null {
  return useContext(KeymapCtx)?.suspendInput ?? null;
}

/** True while a bracketed paste is still ARRIVING — the provider is holding an `\x1b[200~` run whose end marker
 *  has not landed yet. The composer paints upstream's dim `Pasting…` row off it (bundle L493764). A paste that
 *  fits in one chunk never sets it, which is correct: there was no interval to report. False with no provider
 *  above (no input path, so nothing can be arriving). */
export function usePasting(): boolean {
  return useContext(KeymapCtx)?.pasting ?? false;
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
