// tui/src/RewindPicker.tsx — the Esc-Esc rewind picker (spec C5 §1): stage 1 lists user-prompt
// anchors newest-first; selecting one runs a lazy dryRun and opens stage 2 with CC's three restore
// choices. Two anchors per row (probe 68c): uuid drives file restore, prevUuid drives conversation
// restore; a null prevUuid (first prompt / first-after-compact) disables the conversation rows.
//
// F2 Task 7: the picker stopped calling `useInput`. It pushes the `MessageSelector` context, so stage 1's
// navigation is that context's action set — which is wider than the ↑/↓/Enter/Esc this component used to
// read: KB14 adds j/k, ctrl+n/ctrl+p, and shift/ctrl/alt+↑↓ plus shift+k/shift+j as jumps to the first/last
// anchor. Stage 2's 1/2/3 stay in the component's own FALLBACK: they are digits, bound in no context, and
// they mean nothing outside the scope stage. Every action arm below no-ops in the stage it does not belong
// to, so one context can serve both stages without the scope going stale between them.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { ACCENT } from "./theme.js";
import { trunc } from "./render.js";

export function RewindPicker({ anchors, onDryRun, onConfirm, onClose }: {
  anchors: RewindAnchor[];
  onDryRun: (uuid: string) => Promise<RewindDryRun>;
  onConfirm: (anchor: RewindAnchor, scope: RewindScope) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<RewindAnchor | null>(null);
  const [dry, setDry] = useState<RewindDryRun | null>(null);
  const seq = useRef(0);                       // stale-dryRun guard: only the latest selection's result lands
  useEffect(() => {
    if (!sel) return;
    const my = ++seq.current;
    setDry(null);
    onDryRun(sel.uuid).then((d) => { if (seq.current === my) setDry(d); })
      .catch((e) => { if (seq.current === my) setDry({ canRewind: false, error: (e as Error).message }); });
  }, [sel]);   // eslint-disable-line react-hooks/exhaustive-deps

  const codeOk = !!dry?.canRewind;                                  // gated until the dryRun lands
  const convOk = sel?.prevUuid != null;
  // `anchors.length - 1` IS the last selectable anchor: stage 1 renders the list it was handed and every row
  // in it opens the scope stage, so KB14's "jump to the last selectable" needs no separate predicate.
  const inList = (f: () => void) => { if (!sel) f(); };
  useKeyScope("MessageSelector");
  useKeyActions({
    "messageSelector:up": () => inList(() => setIdx((i) => Math.max(0, i - 1))),
    "messageSelector:down": () => inList(() => setIdx((i) => Math.min(anchors.length - 1, i + 1))),
    "messageSelector:top": () => inList(() => setIdx(0)),
    "messageSelector:bottom": () => inList(() => setIdx(Math.max(0, anchors.length - 1))),
    "messageSelector:select": () => inList(() => { if (anchors[idx]) setSel(anchors[idx]); }),
    // Escape is two different keys depending on the stage: out of the picker from the list, back TO the list
    // from the scope stage (never straight out — that would lose the selection silently).
    "messageSelector:dismiss": () => { if (sel) { setSel(null); setDry(null); } else onClose(); },
  });
  useKeyFallback((e: KeyEvent | TextEvent) => {
    if (!sel || e.kind !== "key") return;
    if (e.name === "1" && codeOk && convOk) onConfirm(sel, "both");
    else if (e.name === "2" && convOk) onConfirm(sel, "conversation");
    else if (e.name === "3" && codeOk) onConfirm(sel, "code");
  });

  if (!sel) return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Rewind to a previous message  <Text dimColor>(↑/↓ · Enter · Esc)</Text></Text>
      {anchors.map((a, i) => <Text key={a.uuid} inverse={i === idx}>{`› ${trunc(a.text, 70)}`}</Text>)}
    </Box>
  );
  const summary = dry === null ? "checking file changes…"
    : dry.canRewind ? ((dry.filesChanged?.length ?? 0) === 0 ? "no file changes"
      : `${dry.filesChanged!.length} file${dry.filesChanged!.length === 1 ? "" : "s"} changed (+${dry.insertions ?? 0} −${dry.deletions ?? 0})`)
    : (dry.error ?? "file rewind unavailable");
  const line = (n: string, label: string, ok: boolean, why: string) =>
    ok ? <Text>{n}. {label}</Text> : <Text dimColor>{n}. {label}  ({why})</Text>;
  const codeWhy = dry === null ? "checking…" : dry.error ?? "file rewind unavailable";
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Rewind to: <Text color={ACCENT}>{trunc(sel.text, 60)}</Text></Text>
      <Text dimColor>{summary}</Text>
      <Text> </Text>
      {line("1", "Restore conversation and code", codeOk && convOk, convOk ? codeWhy : "nothing before this prompt")}
      {line("2", "Restore conversation only", convOk, "nothing before this prompt")}
      {line("3", "Restore code only", codeOk, codeWhy)}
      <Text dimColor>1/2/3 · esc back</Text>
    </Box>
  );
}
