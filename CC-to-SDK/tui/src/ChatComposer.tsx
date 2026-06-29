// tui/src/ChatComposer.tsx — the chat REPL's multiline input: a thin Ink view over the pure editor reducer.
// Owns the one side effect (the @-mention filesystem walk). The shared console <Composer> is left untouched.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { readdirSync } from "node:fs";
import { applyKey, initialEditorState, setMentionFiles, setCommandCatalog, inputMode, type EditorState } from "./editor.js";
import { collectFiles, type DirEnt } from "./fileComplete.js";
import type { CommandEntry } from "./commandComplete.js";

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

function CommandPopup({ state }: { state: EditorState }) {
  const c = state.command!;
  if (c.items.length === 0) return <Box paddingX={1}><Text dimColor>/{c.query} — no matches</Text></Box>;
  const start = Math.max(0, Math.min(c.index - 3, Math.max(0, c.items.length - 8)));
  const visible = c.items.slice(start, start + 8);
  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((e, i) => (
        <Box key={e.name} flexDirection="row">
          <Text inverse={start + i === c.index}>/{e.name}</Text>
          {e.argumentHint ? <Text dimColor>{" " + e.argumentHint}</Text> : null}
          {e.description ? <Text dimColor>{"  " + e.description.split("\n")[0].slice(0, 48)}</Text> : null}
        </Box>
      ))}
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

export function ChatComposer({ onSubmit, cwd, commandCatalog }: { onSubmit: (text: string) => void; cwd: string; commandCatalog: CommandEntry[] }) {
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

  // First time a command popup opens with an empty catalog, feed in the live catalog (mirrors the mention walk).
  const needCatalog = state.command != null && state.command.catalog.length === 0 && commandCatalog.length > 0;
  useEffect(() => {
    if (!needCatalog) return;
    if (!disposed.current) setState((s) => setCommandCatalog(s, commandCatalog));
  }, [needCatalog, commandCatalog]);

  const mode = inputMode(state);
  const border = mode === "bash" ? "magenta" : mode === "memory" ? "blue" : undefined;
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={border} paddingX={1}><Text>{"› "}</Text><Box flexDirection="column">{renderBuffer(state)}</Box></Box>
      {mode === "bash" ? <Box paddingX={1}><Text color="magenta" dimColor>! bash mode — runs locally in cwd (Enter to run)</Text></Box> : null}
      {mode === "memory" ? <Box paddingX={1}><Text color="blue" dimColor># memory — appends a note to CLAUDE.md (Enter to save)</Text></Box> : null}
      {state.mention ? <MentionPopup state={state} /> : null}
      {state.command ? <CommandPopup state={state} /> : null}
    </Box>
  );
}
