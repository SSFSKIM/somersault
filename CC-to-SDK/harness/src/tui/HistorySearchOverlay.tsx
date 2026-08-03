// tui/src/HistorySearchOverlay.tsx — the Ctrl-R incremental prompt-history search (bundle
// HistorySearch context, semantics matched key for key: Esc/Tab ACCEPT into the composer, Enter
// EXECUTES, Ctrl-C cancels, Ctrl-R next match, Ctrl-S cycles scope session→project→everywhere with
// initial "everywhere"). Data loading is injected (`load`), cached per scope for the overlay's life —
// the upstream picker caches per scope in a ref the same way.
//
// F2 Task 7: the overlay stopped calling `useInput`. It pushes the `HistorySearch` context, whose six bundle
// keys are ACTIONS below; everything the table leaves unbound — the search field's own text, backspace, and
// the ↑/↓ that walk the result list — arrives on the keymap FALLBACK instead, which is where a text input
// belongs (the composer's editor is wired the same way). The four root globals the context unbinds
// (ctrl+o/t/b/d) never get here at all: the resolver stops at the null.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import { rankHistory, nextScope, ageLabel, type HistEntry, type HistoryScope } from "./historySearch.js";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { ACCENT } from "./theme.js";

const ROWS_SHOWN = 8;

export function HistorySearchOverlay({ load, onAccept, onExecute, onCancel }: { load: (scope: HistoryScope) => Promise<HistEntry[]>; onAccept: (text: string) => void; onExecute: (text: string) => void; onCancel: () => void }) {
  const [scope, setScope] = useState<HistoryScope>("everywhere");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<HistEntry[] | null>(null);    // null = loading
  const [idx, setIdx] = useState(0);
  const cache = useRef<Partial<Record<HistoryScope, HistEntry[]>>>({});
  const disposed = useRef(false);
  useEffect(() => () => { disposed.current = true; }, []);
  useEffect(() => {
    const hit = cache.current[scope];
    if (hit) { setEntries(hit); setIdx(0); return; }
    setEntries(null);
    let cancelled = false;
    void load(scope)
      .then((es) => { if (!cancelled && !disposed.current) { cache.current[scope] = es; setEntries(es); setIdx(0); } })
      .catch(() => { if (!cancelled && !disposed.current) { cache.current[scope] = []; setEntries([]); } });
    return () => { cancelled = true; };
  }, [scope]);   // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => rankHistory(entries ?? [], query), [entries, query]);
  const sel = Math.min(idx, Math.max(0, items.length - 1));
  useKeyScope("HistorySearch");
  useKeyActions({
    "historySearch:cancel": () => onCancel(),
    "historySearch:cycleScope": () => setScope((s) => nextScope(s)),
    "historySearch:next": () => { if (items.length) setIdx((sel + 1) % items.length); },
    "historySearch:accept": () => { if (items[sel]) onAccept(items[sel].text); else onCancel(); },
    "historySearch:execute": () => { if (items[sel]) onExecute(items[sel].text); else onCancel(); },
  });
  // The search field. `toKeyFlags` re-projects one canonical event onto the (input, flags) pair this body was
  // already written against, so a multi-character run (one TextEvent, already UTF-8 re-decoded) and a single
  // printable (a KeyEvent named by that character) both land as `input`. The `input >= " "` guard is what the
  // old `!key.ctrl` check did: the adapter deliberately hands ctrl+_ and ctrl+j over as bare C0 bytes with no
  // flags (its own header explains why), and a control byte must never be typed into the query.
  useKeyFallback((e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    if (key.upArrow) { setIdx(Math.max(0, sel - 1)); return; }
    if (key.downArrow) { setIdx(Math.min(Math.max(0, items.length - 1), sel + 1)); return; }
    if (key.backspace || key.delete) { setQuery((q) => q.slice(0, -1)); setIdx(0); return; }
    if (input && input >= " " && !key.ctrl && !key.meta) { setQuery((q) => q + input); setIdx(0); }
  });
  const start = Math.max(0, Math.min(sel - 3, Math.max(0, items.length - ROWS_SHOWN)));
  const visible = items.slice(start, start + ROWS_SHOWN);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Search prompts <Text color={ACCENT}>· {scope}</Text></Text>
      <Box flexDirection="row"><Text>{"› "}</Text><Text>{query}</Text><Text inverse>{" "}</Text></Box>
      {entries === null
        ? <Text dimColor>Loading…</Text>
        : visible.length === 0
        ? <Text dimColor>{query ? "No matching prompts" : "No history yet"}</Text>
        : visible.map((e, i) => {
            const first = e.text.split("\n")[0];
            return <Text key={start + i} inverse={start + i === sel}>{ageLabel(e.ts).padStart(4)} {first.length > 70 ? first.slice(0, 69) + "…" : first}</Text>;
          })}
      <Text dimColor>⏎ run · Tab/Esc edit · Ctrl-R next · Ctrl-S scope · Ctrl-C close</Text>
    </Box>
  );
}
