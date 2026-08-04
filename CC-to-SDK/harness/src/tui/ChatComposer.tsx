// tui/src/ChatComposer.tsx — the chat REPL's multiline input: a thin Ink view over the pure editor reducer.
// Owns the one side effect (the @-mention filesystem walk). The shared console <Composer> is left untouched.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { readdirSync } from "node:fs";
import { applyKey, initialEditorState, setMentionFiles, setCommandCatalog, inputMode, replaceBufferFromOutside, clearToHistory, endKillAndYank, type EditorState } from "./editor.js";
import { PASTE_LIMIT } from "./pasteChips.js";
import { storePaste as storePasteToDisk } from "./pasteCache.js";
import { collectFiles, type DirEnt } from "./fileComplete.js";
import type { CommandEntry } from "./commandComplete.js";
import { editExternalAsync as realEditExternal } from "./externalEditor.js";
import { ComposerFrame, ComposerEditorInFlight, PlaceholderCursor, PromptGlyph, borderTokenFor, newlineHint } from "./composerFrame.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { useBindingLookup, useKeyActions, useKeyFallback, useKeyScope, usePasting, useSuspendInput, type SuspendInput } from "./keys/KeymapProvider.js";
import { formatBindings } from "./keys/hints.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";

// F1 Task 2 role map: the bash-mode composer takes `bashBorder`, the memory-mode composer `remember`.
// Read per render so a mid-session /theme change repaints the border and its hint on the next frame.
// F5 Task 2 moved the BORDER's own read into composerFrame.tsx — same grammar, same per-render discipline,
// one token wider (`promptBorder` is now a real colour instead of Ink's default). This stays for the two
// mode-hint rows below the frame, which are the only other consumers left here.
const role = (name: "bashBorder" | "remember") => resolveThemeColor(themeTokens()[name]);

/** CM5's placeholder text. Still a literal — F5 Task 8 replaces it with upstream's rotating generator;
 *  only the RENDER (first char inverted, rest dim) is this task's business. */
const PLACEHOLDER = "Ask Claude anything…";
const DEFAULT_COLUMNS = 80;
/** CM25, bundle L493764: `Pasting…` — one ellipsis CHARACTER, not three dots, dim, below the frame. */
const PASTING_TEXT = "Pasting…";
/** CM24, bundle L493772: the dim row that advertises paste-again-to-expand. Exported because the pin in
 *  test/tui/paste-expand.test.tsx has to assert the literal, and a second copy of it there would drift. */
export const PASTE_EXPAND_HINT = "paste again to expand";
/** `k0`'s 8000 ms (L495759). The hint's whole life; the EXPAND itself has no deadline (pasteChips.ts). */
const PASTE_HINT_MS = 8000;

const realReaddir = (dir: string): DirEnt[] => {
  try { return readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, isDir: d.isDirectory() })); }
  catch { return []; }
};

function renderBuffer(state: EditorState): React.ReactNode {
  const { lines, cursor } = state;
  return lines.map((line, r) => {
    if (r !== cursor.row) return <Text key={r}>{line.length ? line : " "}</Text>;
    const before = line.slice(0, cursor.col), at = line[cursor.col] ?? " ", after = line.slice(cursor.col + 1);
    // Box flexDirection="row" keeps before/cursor/after on one line; nested <Text inverse> inside <Text> breaks layout
    // in Ink 5.x on re-render, causing chars after the first to bleed onto the border.
    return <Box key={r} flexDirection="row"><Text>{before}</Text><Text inverse>{at}</Text><Text>{after}</Text></Box>;
  });
}

const COMMAND_ROWS = 8;                            // visible rows; the selection scrolls through the full list

/** The event a real ctrl+l produces — see the `chat:clearInput` registration for why the action re-enters the
 *  key path on this rather than on whatever key the user bound to it. */
const CTRL_L: KeyEvent = { kind: "key", name: "l", ctrl: true, alt: false, shift: false, super: false, raw: "\x0c" };

export type InputOwner = "composer" | "shortcuts" | "transcript" | "overlay" | "decision";

// The popup's own two keys are `Autocomplete` context bindings (`tab` → accept, `escape` → dismiss), so this
// footer derives them like every other table-owned hint rather than restating the defaults. The strings are
// handed down as props: this is a leaf render helper, and one lookup in the composer serves both popups.
function CommandPopup({ state, acceptKey, dismissKey }: { state: EditorState; acceptKey: string; dismissKey: string }) {
  const c = state.command!;
  if (c.items.length === 0) return <Box paddingX={1}><Text dimColor>/{c.query} — no matches</Text></Box>;
  const start = Math.max(0, Math.min(c.index - 3, Math.max(0, c.items.length - COMMAND_ROWS)));
  const visible = c.items.slice(start, start + COMMAND_ROWS);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((e, i) => (
        <Box key={e.name} flexDirection="row">
          <Text inverse={start + i === c.index}>/{e.name}</Text>
          {e.argumentHint ? <Text dimColor>{" " + e.argumentHint}</Text> : null}
          {e.description ? <Text dimColor>{"  " + e.description.split("\n")[0].slice(0, 48)}</Text> : null}
        </Box>
      ))}
      {/* Without this the window is indistinguishable from a complete list — the catalog runs to ~105 entries. */}
      {c.items.length > COMMAND_ROWS
        ? <Text dimColor>{`↑/↓ ${c.index + 1}/${c.items.length} · ${acceptKey} completes · ${dismissKey} closes`}</Text>
        : null}
    </Box>
  );
}

function MentionPopup({ state }: { state: EditorState }) {
  const m = state.mention!;
  if (m.items.length === 0) return <Box paddingX={1}><Text dimColor>@{m.query} — no matches</Text></Box>;
  const start = Math.max(0, Math.min(m.index - 3, Math.max(0, m.items.length - 8)));
  const visible = m.items.slice(start, start + 8);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((c, i) => <Text key={c.path} inverse={start + i === m.index}>{c.path}</Text>)}
    </Box>
  );
}

/** An injected editor may be sync (the pre-F5 DI shape, still used by several tests) or async (what the
 *  real one is now). Both are normalized through `Promise.resolve` at the one call site. */
export type ComposerEditExternal = (text: string) => string | null | Promise<string | null>;

export function ChatComposer({ onSubmit, cwd, commandCatalog, onExit, onCycleMode, onInterrupt, onHelp, onDraftStart, inputOwnerRef, editorStateRef, consumedPrefillTokenRef, prefill, onPrefillApplied, editExternal, suspendInput, onKillAgents, yankHintMs = 5000, pasteHintMs = PASTE_HINT_MS, storePaste = storePasteToDisk, busy, escClearMs = 800, exitArmMs = 800, columns, rows, label }: { onSubmit: (text: string) => void; cwd: string; commandCatalog: CommandEntry[]; onExit?: () => void; onCycleMode?: () => void; onInterrupt?: () => void; onHelp?: () => void; onDraftStart?: () => void; inputOwnerRef?: React.MutableRefObject<InputOwner>; editorStateRef?: React.MutableRefObject<EditorState>; consumedPrefillTokenRef?: React.MutableRefObject<number>; prefill?: { text: string; token: number; mode?: "replace" | "prepend" } | null; onPrefillApplied?: () => void; editExternal?: ComposerEditExternal;
  /** Overrides the KeymapProvider's own terminal handoff (`useSuspendInput`) — the ordering pin injects a fake
   *  one. Absent AND with no provider above, the editor simply runs without a handoff. */
  suspendInput?: SuspendInput; onKillAgents?: () => void; yankHintMs?: number; busy?: boolean; escClearMs?: number; exitArmMs?: number;
  /** How long `paste again to expand` stays up (`k0`'s 8000 ms). The gesture it advertises outlives it —
   *  see `expandRepeatedPaste`. Injectable for the same reason `yankHintMs` is: so a test can watch the
   *  window close in real time instead of faking the clock under Ink. */
  pasteHintMs?: number;
  /** CM26's disk write, THE side effect of a chip being minted. It lives here rather than in `ingestPaste`
   *  because that reducer is pure and is called from `applyKey`, which several tests drive thousands of
   *  times; the composer is the one place that knows a real user really pasted. Injectable so a component
   *  test can watch the call without a filesystem — the DEFAULT is the real writer, deliberately, so that a
   *  future mount site cannot silently ship with the cache turned off. Tests that render this component and
   *  paste MUST therefore either inject or pin `CCX_FLEET_ROOT` (test/tui/paste-expand.test.tsx does both). */
  storePaste?: (content: string) => void;
  /** The terminal's width, read per render (a function, not a number, so a resize is visible without a
   *  new prop identity). ChatApp threads its own `deps.columns ?? stdout.columns ?? 80` source through. */
  columns?: () => number;
  /** The terminal's HEIGHT, read the same per-render way and for one consumer: the paste-chip threshold
   *  (`max(0, min(rows - 10, 2))`, F5 task 3), which upstream reads off the live terminal so that a short
   *  window collapses a paste the tall one would have inlined. */
  rows?: () => number;
  /** The `History n/total` text painted into the top rule (upstream `AVf`, L494870). A slot this task:
   *  F5 Task 7 wires the live history position into it. Nothing is painted while it is undefined. */
  label?: string }) {
  const [state, setState] = useState<EditorState>(() => {
    const saved = editorStateRef?.current ?? initialEditorState();
    const normalized = saved.mention || saved.command ? { ...saved, mention: null, command: null } : saved;
    if (editorStateRef) editorStateRef.current = normalized;
    return normalized;
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const commitState = (next: EditorState | ((current: EditorState) => EditorState)) => {
    const resolved = typeof next === "function" ? next(stateRef.current) : next;
    stateRef.current = resolved;
    if (editorStateRef) editorStateRef.current = resolved;
    setState(resolved);
    return resolved;
  };
  const endInterceptedEditorAction = (editor: EditorState) => {
    const ended = endKillAndYank(editor);
    if (ended !== editor) commitState(ended);
    return ended;
  };
  const disposed = useRef(false);
  const [yankHint, setYankHint] = useState(false);
  const yankTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // CM24's hint (`Rpk`/`Yg`/`lh` in the bundle). Its own state + timer, the yank hint's shape exactly.
  const [pasteHint, setPasteHint] = useState(false);
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { disposed.current = true; if (yankTimer.current) clearTimeout(yankTimer.current); if (pasteTimer.current) clearTimeout(pasteTimer.current); }, []);
  // F2 task 8 removed the `mounted` one-flush guard that used to sit here. Its whole job was the readable-
  // before-data window: Ink reads stdin on "readable" and the keymap listens for "data" (emitted second), so
  // an unmigrated dialog could handle a key by unmounting itself and remounting this composer BEFORE our
  // listener ran, and our registration — written during render — would already be live for that same byte.
  // Nothing under src/tui subscribes to Ink's input any more, so Ink now reads the stream and dispatches to
  // zero subscribers: no component can re-render the tree ahead of us within one chunk, and the window it
  // guarded no longer exists. `inputOwnerRef` below is unaffected — it answers a different question (which
  // surface is visible) and still covers the passive flush AFTER this composer unmounts.
  // busy is read through a ref in handleKey below (busyRef.current, never the closure `busy`) — same reason
  // as stateRef: the keymap dispatches from a passive-effect listener, so a closure read lags one render.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onSubmitRef = useRef(onSubmit); onSubmitRef.current = onSubmit;
  const onExitRef = useRef(onExit); onExitRef.current = onExit;
  const onCycleModeRef = useRef(onCycleMode); onCycleModeRef.current = onCycleMode;
  const onInterruptRef = useRef(onInterrupt); onInterruptRef.current = onInterrupt;
  const onHelpRef = useRef(onHelp); onHelpRef.current = onHelp;
  const onDraftStartRef = useRef(onDraftStart); onDraftStartRef.current = onDraftStart;
  const onKillAgentsRef = useRef(onKillAgents); onKillAgentsRef.current = onKillAgents;
  const editExternalRef = useRef(editExternal); editExternalRef.current = editExternal;
  const providerSuspend = useSuspendInput();
  const suspendInputRef = useRef<SuspendInput | null>(null); suspendInputRef.current = suspendInput ?? providerSuspend;
  const onPrefillAppliedRef = useRef(onPrefillApplied); onPrefillAppliedRef.current = onPrefillApplied;
  const yankHintMsRef = useRef(yankHintMs); yankHintMsRef.current = yankHintMs;
  const pasteHintMsRef = useRef(pasteHintMs); pasteHintMsRef.current = pasteHintMs;
  const storePasteRef = useRef(storePaste); storePasteRef.current = storePaste;
  const escClearMsRef = useRef(escClearMs); escClearMsRef.current = escClearMs;
  const exitArmMsRef = useRef(exitArmMs); exitArmMsRef.current = exitArmMs;
  // Read through a ref for the same reason as stateRef/busyRef: `handleKey` runs from the keymap's passive-
  // effect listener, so a closure read of `rows` lags a render — and after a resize the stale value is exactly
  // the one that decides wrong.
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const [clearArmed, setClearArmed] = useState(false);
  const clearArm = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarmClear = () => { clearArm.current = 0; setClearArmed(false); if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; } };
  // Invalidate the ref/timer during the first busy render so the old hint cannot paint for one frame while
  // the passive cleanup effect is still pending. This mutates only refs during render; state cleanup stays in the effect.
  if (busy && (clearArm.current || clearTimer.current)) {
    clearArm.current = 0;
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
  }
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);
  useEffect(() => { if (busy) disarmClear(); }, [busy]);
  // KB3: Ctrl-D on an empty composer needs two presses (mirrors the Esc-Esc clear arm above) — a first
  // press within exitArmMs just hints, a second exits; letting the arm expire re-arms rather than exiting.
  // exitArmMs default is 800, not a round 2000: upstream's double-press helper (Pee, cli.pretty.js:183445)
  // defaults its window to `fpy = 800` when the caller passes no override, and the Ctrl-D exit chord's
  // caller (cli.pretty.js:183476) is exactly that two-arg no-override call — so 800ms is the SAME constant
  // this file already uses for the Esc-Esc clear arm above (escClearMs), not a coincidence.
  const [dArmed, setDArmed] = useState(false);
  // CM8: true from the moment the external-edit chord fires until the editor's promise settles. The ref is
  // the one the key path reads (the action fires from a passive-effect listener, so the state is one
  // render stale there — the same reason `stateRef`/`busyRef` exist above); the state drives the render.
  const [editorInFlight, setEditorInFlight] = useState(false);
  const editorInFlightRef = useRef(false);
  const dArm = useRef(0);
  const dTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (dTimer.current) clearTimeout(dTimer.current); }, []);
  const isEmptyNow = state.lines.length === 1 && state.lines[0] === "";

  // Rewind's edit-and-resend: a NEW prefill token replaces the buffer wholesale; a re-render with the same
  // token is a no-op. The ChatApp-owned consumed token ref survives every composer replacement, preventing
  // a stale parent prefill from reapplying after the durable editor state has been edited or submitted.
  // onPrefillApplied still clears the parent field, but correctness never depends on that passive render.
  // "prepend" mode (Task 3, CM49 — interrupt() rescuing a queue) MERGES above whatever the user was
  // mid-typing instead of clobbering it; every other prefill (rewind, history-accept — both modeless =
  // replace) keeps the wholesale-replace behavior above.
  const localPrefillTokenRef = useRef(0);
  const lastPrefill = consumedPrefillTokenRef ?? localPrefillTokenRef;
  useEffect(() => {
    if (!prefill || prefill.token === lastPrefill.current) return;
    lastPrefill.current = prefill.token;
    const currentDraft = stateRef.current.lines.join("\n");
    const nextText = prefill.mode === "prepend" && currentDraft.length > 0 ? prefill.text + "\n" + currentDraft : prefill.text;
    if (currentDraft.length === 0 && nextText.length > 0) onDraftStartRef.current?.();
    commitState((s) => {
      const draft = s.lines.join("\n");
      const text = prefill.mode === "prepend" && draft.length > 0 ? prefill.text + "\n" + draft : prefill.text;
      return replaceBufferFromOutside(s, text);
    });
    onPrefillAppliedRef.current?.();
  }, [prefill]);

  // F2 task 6: the composer is the Chat context's owner and the keymap's FALLBACK — everything the table
  // did not bind lands in `handleKey` below, which is the old `useInput` body verbatim minus the two
  // bespoke chords (the resolver's chord machine owns ctrl+x … now) and minus the ctrl+z guard (the
  // provider consumes ctrl+z pre-table, so it can no longer reach the editor at all). The Chat-context
  // actions route to the SAME function: their bodies were already branches of it, and re-entering through
  // it keeps every arm-cleanup and popup check on one path instead of two that can drift.
  //
  // Autocomplete is pushed AFTER Chat so it outranks it (mount order = registration order) — without it,
  // Chat's `escape → chat:cancel` would steal the popup's own dismissal. It is belt-and-braces rather than
  // load-bearing: `handleKey` re-checks the live popup state from the ref, which is what keeps two keys
  // arriving in ONE chunk (no render in between, so the scope flag is one render stale) correct.
  useKeyScope("Chat");
  useKeyScope("Autocomplete", { active: !!(state.command || state.mention) });
  const bindings = useBindingLookup();                 // the footer ladder below reads its chords from here
  const pasting = usePasting();                        // CM25: a bracketed paste still arriving (provider-owned)
  // Read stateRef.current (NOT the closure `state`): the provider dispatches from a listener attached in a
  // passive effect that flushes after commit, so a closure read lags one render and would submit stale text.
  // The ref updates every render.
  const isEmptyBuffer = (s: EditorState) => s.lines.length === 1 && s.lines[0] === "";
  // KB3: EOF needs two presses. Unlike the Esc-Esc clearArm, NO other keystroke disarms this one —
  // that asymmetry is deliberate, not an oversight: upstream's Pee (cli.pretty.js:183445) clears its
  // armed state ONLY on timeout or on the second press; reading an intervening key never resets it. Since
  // upstream wins on fidelity questions, this stays un-disarmed on other input even though it reads as
  // inconsistent with the Esc arm below.
  const exitArm = () => {
    if (inputOwnerRef && inputOwnerRef.current !== "composer") return;
    const s = stateRef.current;
    endInterceptedEditorAction(s);
    if (dArm.current && Date.now() - dArm.current < exitArmMsRef.current) { onExitRef.current?.(); return; }
    dArm.current = Date.now(); setDArmed(true);
    if (dTimer.current) clearTimeout(dTimer.current);
    dTimer.current = setTimeout(() => { dArm.current = 0; setDArmed(false); }, exitArmMsRef.current);
  };
  // CC's Esc-Esc semantics (CM15): busy always interrupts (buffer untouched); idle with text arms a local
  // double-press clear (pushing the buffer to history on the second press); idle on an EMPTY buffer is
  // forwarded to onInterrupt so ChatApp's rewind-picker arm gets it — the picker is structurally unreachable
  // while text is present, since only the empty branch ever reaches onInterrupt outside the busy case.
  const cancel = () => {
    if (inputOwnerRef && inputOwnerRef.current !== "composer") return;
    const s = stateRef.current;
    if (busyRef.current) { endInterceptedEditorAction(s); disarmClear(); onInterruptRef.current?.(); return; }   // running turn: interrupt; buffer untouched
    if (!isEmptyBuffer(s)) {                                            // idle + text: CC's double-press clear (CM15)
      if (clearArm.current && Date.now() - clearArm.current < escClearMsRef.current) {
        const ended = endInterceptedEditorAction(s);
        clearArm.current = 0; setClearArmed(false);
        if (clearTimer.current) clearTimeout(clearTimer.current);
        commitState(clearToHistory(ended)); return;
      }
      endInterceptedEditorAction(s);
      clearArm.current = Date.now(); setClearArmed(true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => { clearArm.current = 0; setClearArmed(false); }, escClearMsRef.current);
      return;
    }
    endInterceptedEditorAction(s); onInterruptRef.current?.();          // idle + empty: ChatApp owns rewind arming
  };
  const handleKey = (e: KeyEvent | TextEvent) => {
    if (inputOwnerRef && inputOwnerRef.current !== "composer") return;
    const { input, key } = toKeyFlags(e);
    const s = stateRef.current;
    if (!key.escape && clearArm.current) disarmClear();
    // '?' on a genuinely empty composer (no buffer text, no open '/' or '@' popup) opens the shortcuts
    // overlay; typed anywhere else it must fall through to applyKey and insert a literal '?'. This one stays
    // physical on purpose: `?` is a CHARACTER, bound by no context, and `help:show` — the action a user can
    // put on a key of their own — is ChatApp's registration, not this branch (final review).
    if (input === "?" && !s.command && !s.mention && isEmptyBuffer(s)) { endInterceptedEditorAction(s); onHelpRef.current?.(); return; }
    // NONE of the four table actions this component owns is re-derived from the key here any more. Three of
    // them still were after t10 (`chat:cancel` / `chat:clearInput` / `app:exit`), which quietly made them
    // physical: a user who moved `chat:cancel` to `alt+c` got a footer and an arm hint that both said Alt-C,
    // and a key that did nothing when pressed. Each has its own registration below now, firing on whatever the
    // table resolved — `cancel()` and `exitArm()` above are the same state machines, lifted out of this body
    // unchanged. Bare Tab still belongs to the autocomplete popups alone (CC's Autocomplete context).
    //
    // Escape survives HERE for exactly one route: `autocomplete:dismiss`. That scope is one render stale when
    // a popup closed and Escape arrives in the SAME stdin chunk, and this live re-read of the popup state is
    // what keeps that case correct (the scope ordering above is belt-and-braces). With no popup live, an
    // Escape that resolved as the popup's dismissal is the cancel.
    if (!s.command && !s.mention && key.escape) { cancel(); return; }
    if (clearArm.current) disarmClear();
    // `rows` is passed positionally after `now`, so `now` is given explicitly here — same value the default
    // would have produced. A paste-tagged event is the only consumer (editor.ts's `KeyFlags.paste` arm).
    const r = applyKey(s, input, key, Date.now(), rowsRef.current?.());
    if (key.ctrl && input === "u" && r.killed && r.killed.text.length >= 3) {
      setYankHint(true);
      if (yankTimer.current) clearTimeout(yankTimer.current);
      yankTimer.current = setTimeout(() => setYankHint(false), yankHintMsRef.current);
    }
    // CM24/CM26, `k0`'s tail (bundle L495753-L495762). A minted chip is cached unconditionally — that is
    // CM26's whole contract, and task 7 needs the payload of chips the hint never advertised — but only a
    // chip at or under `lgr` raises the hint, because only one at or under `lgr` can actually be expanded
    // (`bDo`'s cap). An over-cap chip is transcribed to leave any hint already on screen ALONE: upstream's
    // `if (Cn.length <= lgr)` guards the whole `Yg(!0)` + reschedule block, and nothing else touches it.
    if (r.paste?.kind === "chip") {
      storePasteRef.current(r.paste.content);
      if (r.paste.content.length <= PASTE_LIMIT) {
        setPasteHint(true);
        if (pasteTimer.current) clearTimeout(pasteTimer.current);              // a fresh chip restarts the window
        pasteTimer.current = setTimeout(() => { setPasteHint(false); pasteTimer.current = null; }, pasteHintMsRef.current);
      }
    } else if (r.paste?.kind === "expand") {
      setPasteHint(false);                                                     // `kne`'s `Yg(!1)` + `lh.current()`
      if (pasteTimer.current) { clearTimeout(pasteTimer.current); pasteTimer.current = null; }
    }
    if (s.lines.length === 1 && s.lines[0] === "" && !(r.state.lines.length === 1 && r.state.lines[0] === "")) onDraftStartRef.current?.();
    if (r.submit != null) onSubmitRef.current(r.submit); commitState(r.state);
  };
  useKeyFallback(handleKey);
  // Ctrl-X Ctrl-K (CC chat:killAgents) and Ctrl-G / Ctrl-X Ctrl-E (chat:externalEditor) are the two keys
  // whose GATE moved into the resolver: the chord machine decides whether ctrl+k is the editor's
  // kill-to-end or the agent kill, so these handlers only fire when the chord already completed. Each still
  // ends a kill/yank run and drops an armed Esc-clear, which the swallowed ctrl+x prefix used to do.
  const interceptChord = (): EditorState | null => {
    if (inputOwnerRef && inputOwnerRef.current !== "composer") return null;
    const s = stateRef.current;
    if (clearArm.current) disarmClear();
    return endInterceptedEditorAction(s);
  };
  useKeyActions({
    // A popup owns its own dismissal; with none live this IS the cancel (see `cancel()` and the note in
    // `handleKey`). The event is only consulted for that one question, never for which action fired.
    "chat:cancel": (e) => { if (stateRef.current.command || stateRef.current.mention) { handleKey(e); return; } cancel(); },
    // The ONE action here whose operation lives in the editor reducer (editor.ts's `clearInput`, reachable
    // only through `applyKey`'s ctrl+l case). So it re-enters `handleKey` on the event ctrl+l would have
    // produced rather than on the key that fired: under the default binding that IS the event, byte for byte,
    // and a rebound key now reaches the same branch with the same kill-run and arm bookkeeping instead of
    // being handed to the reducer as a chord it has never heard of.
    "chat:clearInput": () => handleKey(CTRL_L),
    // The action means EXIT, and this key only means exit on an empty composer (KB3). With text there is no
    // exit to run: under the default binding the key is the editor's own ctrl+d (delete-forward), so the
    // event goes back to `handleKey` and the reducer decides — a rebound key lands there too and, being
    // unknown to it, does nothing, which is the truth. `disarmClear` is `handleKey`'s own preamble, kept for
    // the one branch that now bypasses it.
    "app:exit": (e) => {
      if (!isEmptyBuffer(stateRef.current)) { handleKey(e); return; }
      // Ownership FIRST (final-fix re-review): a non-owning composer must not disarm its Esc-clear or
      // setState at all — reachable only via a user rebind of app:exit to a key no overlay context nulls.
      if (inputOwnerRef && inputOwnerRef.current !== "composer") return;
      if (clearArm.current) disarmClear();
      exitArm();
    },
    // Fires on the RESOLVED action, not on a re-read of the key's flags — so `alt+m` in a user's
    // keybindings.json cycles the ladder exactly as shift+tab does, which is what makes the derived hint
    // beside it true. `interceptChord()` is the same owner-guard + kill-run/arm cleanup `handleKey` ran.
    "chat:cycleMode": () => { if (interceptChord()) onCycleModeRef.current?.(); },
    "autocomplete:dismiss": handleKey, "autocomplete:accept": handleKey,
    "chat:killAgents": () => { if (interceptChord()) onKillAgentsRef.current?.(); },
    // K6 (F2 task 10): `"ctrl+k": "command:clear"` in the user's keybindings.json runs `/clear` exactly as if
    // it had been typed here — same submit seam, so local commands, catalog commands and the unknown-name
    // notice all behave identically to typing them. The buffer is deliberately left alone: the key ran a
    // command, it did not send what the user was drafting. Registered as the `command:` FAMILY because the
    // name comes from the user's file; without it the resolver consumed the key and nothing ran it.
    "command:*": (_e, action) => { if (interceptChord()) onSubmitRef.current("/" + action.slice("command:".length)); },
    // CM8: the edit is AWAITED now, not blocked on. `editExternalAsync` yields between spawning the editor
    // and its exit, which is the only reason the `Save and close editor to continue...` row can paint at
    // all — the old spawnSync stopped the event loop for the whole edit, so Ink never got a frame.
    // `Promise.resolve` normalizes an injected SYNC editor (the DI shape several tests still use) onto the
    // same path. `editorInFlight` is what the render below swaps the whole composer out for.
    "chat:externalEditor": () => {
      const ended = interceptChord();
      if (!ended || editorInFlightRef.current) return;               // a second chord mid-edit is a no-op
      editorInFlightRef.current = true; setEditorInFlight(true);
      const done = (edited: string | null) => {
        if (disposed.current) return;
        editorInFlightRef.current = false; setEditorInFlight(false);
        // Clear any open mention/command popup too — it was filtered against the pre-edit buffer and would
        // otherwise show stale items against the freshly-applied text.
        if (edited === null) return;                                 // editor errored / exited non-zero: keep the buffer
        if (ended.lines.length === 1 && ended.lines[0] === "" && edited.length > 0) onDraftStartRef.current?.();
        commitState(replaceBufferFromOutside(ended, edited));
      };
      // …and the whole flight runs INSIDE the keymap's terminal handoff (t2 review, Important): the child is
      // spawned with stdio "inherit", so while it runs, fd 0 belongs to it and not to us. Without the handoff
      // our still-flowing `data` listener raced the editor for its keystrokes and a stolen `\r` submitted the
      // turn mid-edit. `suspendInput` restores raw mode in a `finally`, so both arms below are covered.
      const run = () => Promise.resolve((editExternalRef.current ?? realEditExternal)(ended.lines.join("\n")));
      const suspend = suspendInputRef.current;
      // A rejection is the same outcome as a null: the buffer stands and the in-flight row must lift, or
      // the composer is stuck showing "Save and close editor…" with no editor to save.
      (suspend ? suspend(run) : run()).then(done, () => done(null));
    },
  });

  // A just-opened mention has empty files → walk cwd once and feed the results in.
  const needWalk = state.mention != null && state.mention.files.length === 0;
  useEffect(() => {
    if (!needWalk) return;
    const files = collectFiles(cwd, realReaddir);
    if (!disposed.current) commitState((s) => setMentionFiles(s, files));
  }, [needWalk, cwd]);

  // First time a command popup opens with an empty catalog, feed in the live catalog (mirrors the mention walk).
  const needCatalog = state.command != null && state.command.catalog.length === 0 && commandCatalog.length > 0;
  useEffect(() => {
    if (!needCatalog) return;
    if (!disposed.current) commitState((s) => setCommandCatalog(s, commandCatalog));
  }, [needCatalog, commandCatalog]);

  const mode = inputMode(state);
  const borderToken = borderTokenFor(mode);
  const cols = Math.max(1, Math.floor(columns?.() ?? DEFAULT_COLUMNS));
  // The editor owns these affordances: derive them from this render's state so the first draft/popup
  // frame cannot inherit an out-of-date parent status-bar hint through a passive effect.
  const showFooter = mode === "normal" && !state.mention && !state.command;
  // F2 task 10: every chord this component prints comes from the LIVE table, not from literals typed here —
  // rebind chat:cycleMode and the rung follows it; unbind it and the rung says `(unbound)` instead of promising
  // a key that no longer works. That covers the footer ladder, the Esc hint, both double-press arms and the
  // autocomplete popup's footer (t10 review, Minor: the last three were still literals, and the derivation
  // guard in keys-acceptance.test.tsx now greps for every one of these strings). The rest of the ladder is
  // editor-owned (`⏎`, `\⏎`, the `@`/`/`/`!` prefixes, `?`), which no context binds, so it stays literal.
  const cycleKey = formatBindings(bindings("chat:cycleMode"));
  const escKey = formatBindings(bindings("chat:cancel"));
  const exitKey = formatBindings(bindings("app:exit"));                 // the KB3 double-press arm below
  const acceptKey = formatBindings(bindings("autocomplete:accept")), dismissKey = formatBindings(bindings("autocomplete:dismiss"));
  const keyboardHint = busy ? `${escKey} interrupt` : isEmptyNow ? `${escKey} rewind · ? help` : `${escKey} clear`;
  // CM20: the ladder replaces the invented `\⏎ newline` rung — same slot, upstream's three strings. Read
  // per render off THIS render's editor state, so the rung shortens on the very frame `\`+Return lands.
  // Upstream renders `Z_a()` in the `?` help list (L459545) rather than in a composer footer; our footer
  // is a compressed invention that already carried a newline rung, so the ladder lands there — one hint,
  // not two. (editor.ts's `markBackslashReturnUsed` note already points at "the composer's newline hint".)
  const newlineRung = newlineHint(state.hasUsedBackslashReturn);
  const clearVisible = clearArmed && clearArm.current !== 0 && !busy;
  // CM8's early return, upstream's own shape (L496236): while the editor holds the terminal the composer
  // is JUST the framed literal — no glyph, no input, and none of the hint rows below, because upstream
  // returns before it builds any of them. Placed after every hook so the hook order is unconditional.
  if (editorInFlight) return <ComposerEditorInFlight columns={cols} borderToken={borderToken} />;
  return (
    <Box flexDirection="column">
      <ComposerFrame columns={cols} borderToken={borderToken} label={label}>
        <PromptGlyph mode={mode} busy={busy} />
        {isEmptyNow
          ? <PlaceholderCursor text={PLACEHOLDER} />
          : <Box flexDirection="column">{renderBuffer(state)}</Box>}
      </ComposerFrame>
      {mode === "bash" ? <Box paddingX={1}><Text color={role("bashBorder")} dimColor>! bash mode — runs locally in cwd (Enter to run)</Text></Box> : null}
      {mode === "memory" ? <Box paddingX={1}><Text color={role("remember")} dimColor># memory — appends a note to CLAUDE.md (Enter to save)</Text></Box> : null}
      {pasting ? <Box paddingX={1}><Text dimColor>{PASTING_TEXT}</Text></Box> : null}
      {pasteHint ? <Box paddingX={1}><Text dimColor>{PASTE_EXPAND_HINT}</Text></Box> : null}
      {yankHint ? <Box paddingX={1}><Text dimColor>Ctrl+Y to paste deleted text</Text></Box> : null}
      {clearVisible ? <Box paddingX={1}><Text dimColor>{`${escKey} again to clear`}</Text></Box> : null}
      {dArmed && isEmptyNow ? <Box paddingX={1}><Text dimColor>{`Press ${exitKey} again to exit`}</Text></Box> : null}
      {showFooter ? <Box paddingX={1}><Text dimColor>{`⏎ send · ${newlineRung} · @ files · / commands · ! bash · ${cycleKey} mode${isEmptyNow ? " · ? help" : ""}`}</Text></Box> : null}
      {showFooter ? <Box paddingX={1}><Text dimColor>{keyboardHint}</Text></Box> : null}
      {state.mention ? <MentionPopup state={state} /> : null}
      {state.command ? <CommandPopup state={state} acceptKey={acceptKey} dismissKey={dismissKey} /> : null}
    </Box>
  );
}
