// tui/src/ChatComposer.tsx — the chat REPL's multiline input: a thin Ink view over the pure editor reducer.
// Owns the one side effect (the @-mention filesystem walk). The shared console <Composer> is left untouched.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { readdirSync } from "node:fs";
import { applyKey, initialEditorState, setMentionFiles, setCommandCatalog, inputMode, replaceBufferFromOutside, clearToHistory, endKillAndYank, type EditorState } from "./editor.js";
import { collectFiles, type DirEnt } from "./fileComplete.js";
import type { CommandEntry } from "./commandComplete.js";
import { editExternal as realEditExternal } from "./externalEditor.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";

// F1 Task 2 role map: the bash-mode composer takes `bashBorder`, the memory-mode composer `remember`.
// Read per render so a mid-session /theme change repaints the border and its hint on the next frame.
const role = (name: "bashBorder" | "remember") => resolveThemeColor(themeTokens()[name]);

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

export type InputOwner = "composer" | "shortcuts" | "transcript" | "overlay" | "decision";

function CommandPopup({ state }: { state: EditorState }) {
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
        ? <Text dimColor>{`↑/↓ ${c.index + 1}/${c.items.length} · Tab completes · Esc closes`}</Text>
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

export function ChatComposer({ onSubmit, cwd, commandCatalog, onExit, onCycleMode, onInterrupt, onHelp, onDraftStart, inputOwnerRef, editorStateRef, consumedPrefillTokenRef, prefill, onPrefillApplied, editExternal, onKillAgents, yankHintMs = 5000, busy, escClearMs = 800, exitArmMs = 800 }: { onSubmit: (text: string) => void; cwd: string; commandCatalog: CommandEntry[]; onExit?: () => void; onCycleMode?: () => void; onInterrupt?: () => void; onHelp?: () => void; onDraftStart?: () => void; inputOwnerRef?: React.MutableRefObject<InputOwner>; editorStateRef?: React.MutableRefObject<EditorState>; consumedPrefillTokenRef?: React.MutableRefObject<number>; prefill?: { text: string; token: number; mode?: "replace" | "prepend" } | null; onPrefillApplied?: () => void; editExternal?: (text: string) => string | null; onKillAgents?: () => void; yankHintMs?: number; busy?: boolean; escClearMs?: number; exitArmMs?: number }) {
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
  useEffect(() => () => { disposed.current = true; if (yankTimer.current) clearTimeout(yankTimer.current); }, []);
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
  const onPrefillAppliedRef = useRef(onPrefillApplied); onPrefillAppliedRef.current = onPrefillApplied;
  const yankHintMsRef = useRef(yankHintMs); yankHintMsRef.current = yankHintMs;
  const escClearMsRef = useRef(escClearMs); escClearMsRef.current = escClearMs;
  const exitArmMsRef = useRef(exitArmMs); exitArmMsRef.current = exitArmMs;
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
  // Read stateRef.current (NOT the closure `state`): the provider dispatches from a listener attached in a
  // passive effect that flushes after commit, so a closure read lags one render and would submit stale text.
  // The ref updates every render.
  const handleKey = (e: KeyEvent | TextEvent) => {
    if (inputOwnerRef && inputOwnerRef.current !== "composer") return;
    const { input, key } = toKeyFlags(e);
    const s = stateRef.current;
    if (!key.escape && clearArm.current) disarmClear();
    // KB3: EOF needs two presses. Unlike the Esc-Esc clearArm below, NO other keystroke disarms this one —
    // that asymmetry is deliberate, not an oversight: upstream's Pee (cli.pretty.js:183445) clears its
    // armed state ONLY on timeout or on the second press; reading an intervening key never resets it. Since
    // upstream wins on fidelity questions, this stays un-disarmed on other input even though it reads as
    // inconsistent with the Esc arm right below.
    if (key.ctrl && input === "d" && s.lines.length === 1 && s.lines[0] === "") {   // KB3: EOF needs two presses
      endInterceptedEditorAction(s);
      if (dArm.current && Date.now() - dArm.current < exitArmMsRef.current) { onExitRef.current?.(); return; }
      dArm.current = Date.now(); setDArmed(true);
      if (dTimer.current) clearTimeout(dTimer.current);
      dTimer.current = setTimeout(() => { dArm.current = 0; setDArmed(false); }, exitArmMsRef.current);
      return;
    }
    // '?' on a genuinely empty composer (no buffer text, no open '/' or '@' popup) opens the shortcuts
    // overlay; typed anywhere else it must fall through to applyKey and insert a literal '?'.
    if (input === "?" && !s.command && !s.mention && s.lines.length === 1 && s.lines[0] === "") { endInterceptedEditorAction(s); onHelpRef.current?.(); return; }
    // Shift+Tab cycles the permission ladder (CC chat:cycleMode). Bare Tab belongs to the autocomplete
    // popups alone (CC's Autocomplete context) — with no popup open it does nothing.
    if (key.tab && key.shift) { endInterceptedEditorAction(s); onCycleModeRef.current?.(); return; }
    // Esc is global ONLY when no autocomplete popup is open; with a popup, applyKey owns it (closes the
    // popup). This single owner prevents the ChatApp+composer double-handling. CC's Esc-Esc semantics
    // (CM15): busy Esc always interrupts (buffer untouched); idle Esc with text arms a local double-press
    // clear (pushing the buffer to history on the second press); idle Esc on an EMPTY buffer is forwarded
    // to onInterrupt so ChatApp's rewind-picker arm — the picker is structurally unreachable while text
    // is present, since only the empty branch ever reaches onInterrupt outside the busy case.
    if (!s.command && !s.mention) {
      if (key.escape) {
        if (busyRef.current) { endInterceptedEditorAction(s); disarmClear(); onInterruptRef.current?.(); return; }                  // running turn: Esc is interrupt; buffer untouched
        if (!(s.lines.length === 1 && s.lines[0] === "")) {                // idle + text: CC's double-press clear (CM15)
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
        endInterceptedEditorAction(s); onInterruptRef.current?.(); return;                                           // idle + empty: ChatApp owns rewind arming
      }
    }
    if (clearArm.current) disarmClear();
    const r = applyKey(s, input, key);
    if (key.ctrl && input === "u" && r.killed && r.killed.text.length >= 3) {
      setYankHint(true);
      if (yankTimer.current) clearTimeout(yankTimer.current);
      yankTimer.current = setTimeout(() => setYankHint(false), yankHintMsRef.current);
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
    "chat:cancel": handleKey, "chat:clearInput": handleKey, "chat:cycleMode": handleKey, "app:exit": handleKey,
    "autocomplete:dismiss": handleKey, "autocomplete:accept": handleKey,
    "chat:killAgents": () => { if (interceptChord()) onKillAgentsRef.current?.(); },
    "chat:externalEditor": () => {
      const ended = interceptChord();
      if (!ended) return;
      const edited = (editExternalRef.current ?? realEditExternal)(ended.lines.join("\n"));
      // Clear any open mention/command popup too — it was filtered against the pre-edit buffer and would
      // otherwise show stale items against the freshly-applied text.
      if (edited !== null && !disposed.current) {
        if (ended.lines.length === 1 && ended.lines[0] === "" && edited.length > 0) onDraftStartRef.current?.();
        commitState(replaceBufferFromOutside(ended, edited));
      }
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
  const border = mode === "bash" ? role("bashBorder") : mode === "memory" ? role("remember") : undefined;
  // The editor owns these affordances: derive them from this render's state so the first draft/popup
  // frame cannot inherit an out-of-date parent status-bar hint through a passive effect.
  const showFooter = mode === "normal" && !state.mention && !state.command;
  const keyboardHint = busy ? "Esc interrupt" : isEmptyNow ? "Esc rewind · ? help" : "Esc clear";
  const clearVisible = clearArmed && clearArm.current !== 0 && !busy;
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={border} paddingX={1}>
        <Text>{"› "}</Text>
        {isEmptyNow
          ? <Box flexDirection="row"><Text inverse>{" "}</Text><Text dimColor>Ask Claude anything…</Text></Box>
          : <Box flexDirection="column">{renderBuffer(state)}</Box>}
      </Box>
      {mode === "bash" ? <Box paddingX={1}><Text color={role("bashBorder")} dimColor>! bash mode — runs locally in cwd (Enter to run)</Text></Box> : null}
      {mode === "memory" ? <Box paddingX={1}><Text color={role("remember")} dimColor># memory — appends a note to CLAUDE.md (Enter to save)</Text></Box> : null}
      {yankHint ? <Box paddingX={1}><Text dimColor>Ctrl+Y to paste deleted text</Text></Box> : null}
      {clearVisible ? <Box paddingX={1}><Text dimColor>Esc again to clear</Text></Box> : null}
      {dArmed && isEmptyNow ? <Box paddingX={1}><Text dimColor>Press Ctrl-D again to exit</Text></Box> : null}
      {showFooter ? <Box paddingX={1}><Text dimColor>{isEmptyNow ? "⏎ send · \\⏎ newline · @ files · / commands · ! bash · ⇧Tab mode · ? help" : "⏎ send · \\⏎ newline · @ files · / commands · ! bash · ⇧Tab mode"}</Text></Box> : null}
      {showFooter ? <Box paddingX={1}><Text dimColor>{keyboardHint}</Text></Box> : null}
      {state.mention ? <MentionPopup state={state} /> : null}
      {state.command ? <CommandPopup state={state} /> : null}
    </Box>
  );
}
