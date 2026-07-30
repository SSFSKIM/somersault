// tui/src/ChatComposer.tsx — the chat REPL's multiline input: a thin Ink view over the pure editor reducer.
// Owns the one side effect (the @-mention filesystem walk). The shared console <Composer> is left untouched.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { readdirSync } from "node:fs";
import { applyKey, initialEditorState, setMentionFiles, setCommandCatalog, inputMode, withBufferText, type EditorState } from "./editor.js";
import { collectFiles, type DirEnt } from "./fileComplete.js";
import type { CommandEntry } from "./commandComplete.js";
import { editExternal as realEditExternal } from "./externalEditor.js";

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

export function ChatComposer({ onSubmit, cwd, commandCatalog, onExit, onCycleMode, onInterrupt, onHelp, prefill, onPrefillApplied, editExternal }: { onSubmit: (text: string) => void; cwd: string; commandCatalog: CommandEntry[]; onExit?: () => void; onCycleMode?: () => void; onInterrupt?: () => void; onHelp?: () => void; prefill?: { text: string; token: number } | null; onPrefillApplied?: () => void; editExternal?: (text: string) => string | null }) {
  const [state, setState] = useState<EditorState>(() => initialEditorState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const disposed = useRef(false);
  useEffect(() => () => { disposed.current = true; }, []);
  const editExt = editExternal ?? realEditExternal;
  const ctrlX = useRef(0);

  // Rewind's edit-and-resend: a NEW prefill (token bump) replaces the buffer wholesale; a re-render with the
  // same token (or none) is a no-op — this must fire exactly once per rewind, not on every parent re-render.
  // `lastPrefill` alone used to be the ONLY guard, but it lives in THIS component and resets to 0 every
  // time the composer unmounts — which happens whenever any popup arm (shortcuts overlay, rewind picker,
  // bg-tasks panel, model/session picker, any decision dialog) takes over. `composerPrefill` was never
  // cleared after being consumed, so a remount re-armed the ref while the parent state still held the
  // already-applied prefill, and the effect re-applied a stale rewound prompt into a freshly-typed buffer.
  // `onPrefillApplied` moves the "already applied" knowledge up to useChat (which survives remounts): it
  // clears `composerPrefill` to null the moment this fires, so no later remount can ever see a non-null
  // prefill to re-apply — the ref here is now just a same-mount double-invoke guard, not the real dedup.
  const lastPrefill = useRef(0);
  useEffect(() => {
    if (!prefill || prefill.token === lastPrefill.current) return;
    lastPrefill.current = prefill.token;
    setState((s) => withBufferText(s, prefill.text));
    onPrefillApplied?.();
  }, [prefill]);

  // Read stateRef.current (NOT the closure `state`): Ink re-registers this handler in a passive effect that
  // flushes after commit, so a closure read lags one render and would submit stale text. The ref updates every render.
  useInput((input, key) => {
    const s = stateRef.current;
    if (key.ctrl && input === "d" && s.lines.length === 1 && s.lines[0] === "") { onExit?.(); return; }   // Ctrl-D on empty = EOF exit
    // '?' on a genuinely empty composer (no buffer text, no open '/' or '@' popup) opens the shortcuts
    // overlay; typed anywhere else it must fall through to applyKey and insert a literal '?'.
    if (input === "?" && !s.command && !s.mention && s.lines.length === 1 && s.lines[0] === "") { onHelp?.(); return; }
    // Shift+Tab cycles the permission ladder (CC chat:cycleMode). Bare Tab belongs to the autocomplete
    // popups alone (CC's Autocomplete context) — with no popup open it does nothing.
    if (key.tab && key.shift) { onCycleMode?.(); return; }
    // Ctrl-X Ctrl-E chord (2s window) or Ctrl-G: round-trip the buffer through $EDITOR. Ctrl-E alone
    // must stay line-end, so the chord prefix gates it.
    if (key.ctrl && input === "x") { ctrlX.current = Date.now(); return; }
    if (key.ctrl && (input === "g" || (input === "e" && Date.now() - ctrlX.current < 2000))) {
      ctrlX.current = 0;
      const edited = editExt(s.lines.join("\n"));
      if (edited !== null && !disposed.current) setState((st) => withBufferText(st, edited));
      return;
    }
    ctrlX.current = 0;                                       // any other key breaks the chord
    // Esc is global ONLY when no autocomplete popup is open; with a popup, applyKey owns it (closes the
    // popup). This single owner prevents the ChatApp+composer double-handling.
    if (!s.command && !s.mention) {
      if (key.escape) { onInterrupt?.(); return; }
    }
    const r = applyKey(s, input, key); if (r.submit != null) onSubmit(r.submit); setState(r.state);
  });

  // A just-opened mention has empty files → walk cwd once and feed the results in.
  const needWalk = state.mention != null && state.mention.files.length === 0;
  useEffect(() => {
    if (!needWalk) return;
    const files = collectFiles(cwd, realReaddir);
    if (!disposed.current) setState((s) => setMentionFiles(s, files));
  }, [needWalk, cwd]);

  // First time a command popup opens with an empty catalog, feed in the live catalog (mirrors the mention walk).
  const needCatalog = state.command != null && state.command.catalog.length === 0 && commandCatalog.length > 0;
  useEffect(() => {
    if (!needCatalog) return;
    if (!disposed.current) setState((s) => setCommandCatalog(s, commandCatalog));
  }, [needCatalog, commandCatalog]);

  const mode = inputMode(state);
  const border = mode === "bash" ? "magenta" : mode === "memory" ? "blue" : undefined;
  const isEmpty = state.lines.length === 1 && state.lines[0] === "";
  const showFooter = mode === "normal" && !state.mention && !state.command;
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={border} paddingX={1}>
        <Text>{"› "}</Text>
        {isEmpty
          ? <Box flexDirection="row"><Text inverse>{" "}</Text><Text dimColor>Ask Claude anything…</Text></Box>
          : <Box flexDirection="column">{renderBuffer(state)}</Box>}
      </Box>
      {mode === "bash" ? <Box paddingX={1}><Text color="magenta" dimColor>! bash mode — runs locally in cwd (Enter to run)</Text></Box> : null}
      {mode === "memory" ? <Box paddingX={1}><Text color="blue" dimColor># memory — appends a note to CLAUDE.md (Enter to save)</Text></Box> : null}
      {showFooter ? <Box paddingX={1}><Text dimColor>⏎ send · \⏎ newline · @ files · / commands · ! bash · ⇧Tab mode</Text></Box> : null}
      {state.mention ? <MentionPopup state={state} /> : null}
      {state.command ? <CommandPopup state={state} /> : null}
    </Box>
  );
}
