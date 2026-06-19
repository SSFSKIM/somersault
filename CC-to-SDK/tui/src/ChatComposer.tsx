// tui/src/ChatComposer.tsx — the chat REPL's multiline input: a thin Ink view over the pure editor reducer.
// Owns the one side effect (the @-mention filesystem walk). The shared console <Composer> is left untouched.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { readdirSync } from "node:fs";
import { applyKey, initialEditorState, setMentionFiles, type EditorState } from "./editor.js";
import { collectFiles, type DirEnt } from "./fileComplete.js";

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

export function ChatComposer({ onSubmit, cwd }: { onSubmit: (text: string) => void; cwd: string }) {
  const [state, setState] = useState<EditorState>(() => initialEditorState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const disposed = useRef(false);
  useEffect(() => () => { disposed.current = true; }, []);

  // Read stateRef.current (NOT the closure `state`): Ink re-registers this handler in a passive effect that
  // flushes after commit, so a closure read lags one render and would submit stale text. The ref updates every render.
  useInput((input, key) => { const r = applyKey(stateRef.current, input, key); if (r.submit != null) onSubmit(r.submit); setState(r.state); });

  // A just-opened mention has empty files → walk cwd once and feed the results in.
  const needWalk = state.mention != null && state.mention.files.length === 0;
  useEffect(() => {
    if (!needWalk) return;
    const files = collectFiles(cwd, realReaddir);
    if (!disposed.current) setState((s) => setMentionFiles(s, files));
  }, [needWalk, cwd]);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={1}><Text>{"› "}</Text><Box flexDirection="column">{renderBuffer(state)}</Box></Box>
      {state.mention ? <MentionPopup state={state} /> : null}
    </Box>
  );
}
