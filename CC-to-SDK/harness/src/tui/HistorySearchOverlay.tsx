// tui/src/HistorySearchOverlay.tsx — the full-screen prompt-history PICKER (`qGf`, bundle L492153), with
// semantics matched key for key: Esc/Tab ACCEPT into the composer, Enter EXECUTES, Ctrl-C cancels, Ctrl-R
// next match, Ctrl-S cycles scope session→project→everywhere with initial "everywhere". Data loading is
// injected (`load`), cached per scope for the overlay's life — the upstream picker caches per scope in a ref
// (`u.current`, L492159) the same way.
//
// HOW IT IS REACHED (F5 task 12). Upstream renders this only in FULLSCREEN layout (`if (yie() && mr)`,
// L496209) and gives classic layout the inline reverse-i-search instead (`r9f` — see
// historySearchInline.ts). Our REPL is permanently classic, so ctrl+r is the inline search and this picker
// opens on the `/history` command: a recorded ccx addition, because upstream needs no command for a surface
// its own layout hands it. Both are recorded in Task 13.
//
// F2 Task 7: the overlay stopped calling `useInput`. It pushes the `HistorySearch` context, whose six bundle
// keys are ACTIONS below; everything the table leaves unbound — the search field's own text, backspace, and
// the ↑/↓ that walk the result list — arrives on the keymap FALLBACK instead, which is where a text input
// belongs (the composer's editor is wired the same way). The four root globals the context unbinds
// (ctrl+o/t/b/d) never get here at all: the resolver stops at the null.
//
// F5 Task 12 added CM59, the PREVIEW PANE (`renderPreview`, L492219): a round, dim-bordered box of up to six
// content lines of the selected prompt plus a `… +N lines` tail, beside the list at ≥100 columns and below it
// otherwise. Its geometry is `previewLayout`/`previewLines`/`moreLabel` in historySearch.ts, transcribed there.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import { ageLabel, moreLabel, nextScope, previewLayout, previewLines, rankHistory, PREVIEW_LINES, type HistEntry, type HistoryScope } from "./historySearch.js";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { ACCENT } from "./theme.js";

const ROWS_SHOWN = 8;
const DEFAULT_COLUMNS = 80;

/** `renderPreview`'s box (bundle L492223): `borderStyle:"round"`, `borderDimColor`, `paddingX:1`, and a fixed
 *  `height: aci + 2` so the pane does not jump as the selection moves between a one-line and a ten-line
 *  prompt. Every content row is dim, the `bM` tail included. */
function Preview({ text, width }: { text: string; width: number }): React.ReactElement {
  const { lines, more } = previewLines(text, width);
  const tail = moreLabel(more);
  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} height={PREVIEW_LINES + 2}>
      {lines.map((l, i) => <Text key={i} dimColor>{l}</Text>)}
      {tail ? <Text dimColor>{tail}</Text> : null}
    </Box>
  );
}

export function HistorySearchOverlay({ load, onAccept, onExecute, onCancel, columns }: { load: (scope: HistoryScope) => Promise<HistEntry[]>; onAccept: (e: HistEntry) => void; onExecute: (e: HistEntry) => void; onCancel: () => void; columns?: () => number }) {
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
    "historySearch:accept": () => { if (items[sel]) onAccept(items[sel]); else onCancel(); },
    "historySearch:execute": () => { if (items[sel]) onExecute(items[sel]); else onCancel(); },
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
  const cols = Math.max(20, Math.floor(columns?.() ?? DEFAULT_COLUMNS));
  const { sideBySide, textWidth, previewWidth } = previewLayout(cols);
  const list = (
    <Box flexDirection="column">
      {entries === null
        ? <Text dimColor>Loading…</Text>
        : visible.length === 0
        ? <Text dimColor>{query ? "No matching prompts" : "No history yet"}</Text>
        : visible.map((e, i) => {
            const first = e.text.split("\n")[0];
            return <Text key={start + i} inverse={start + i === sel}>{ageLabel(e.ts).padStart(4)} {first.length > textWidth ? first.slice(0, textWidth - 1) + "…" : first}</Text>;
          })}
    </Box>
  );
  // `previewPosition: f ? "right" : "bottom"` (L492218). Nothing to preview with an empty result set, and
  // upstream draws no pane in that state either — its `renderPreview` is called per ITEM.
  const preview = items[sel] ? <Preview text={items[sel].text} width={previewWidth} /> : null;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Search prompts <Text color={ACCENT}>· {scope}</Text></Text>
      <Box flexDirection="row"><Text>{"› "}</Text><Text>{query}</Text><Text inverse>{" "}</Text></Box>
      {sideBySide
        ? <Box flexDirection="row" gap={1}>{list}{preview}</Box>
        : <Box flexDirection="column">{list}{preview}</Box>}
      <Text dimColor>⏎ run · Tab/Esc edit · Ctrl-R next · Ctrl-S scope · Ctrl-C close</Text>
    </Box>
  );
}
