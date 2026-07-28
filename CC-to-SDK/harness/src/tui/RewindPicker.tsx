// tui/src/RewindPicker.tsx — the Esc-Esc rewind picker (spec C5 §1): stage 1 lists user-prompt
// anchors newest-first; selecting one runs a lazy dryRun and opens stage 2 with CC's three restore
// choices. Two anchors per row (probe 68c): uuid drives file restore, prevUuid drives conversation
// restore; a null prevUuid (first prompt / first-after-compact) disables the conversation rows.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";
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
  useInput((input, key) => {
    if (!sel) {
      if (key.escape) { onClose(); return; }
      if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
      else if (key.downArrow) setIdx((i) => Math.min(anchors.length - 1, i + 1));
      else if (key.return && anchors[idx]) setSel(anchors[idx]);
      return;
    }
    if (key.escape) { setSel(null); setDry(null); return; }          // back to the list, not out
    if (input === "1" && codeOk && convOk) onConfirm(sel, "both");
    else if (input === "2" && convOk) onConfirm(sel, "conversation");
    else if (input === "3" && codeOk) onConfirm(sel, "code");
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
