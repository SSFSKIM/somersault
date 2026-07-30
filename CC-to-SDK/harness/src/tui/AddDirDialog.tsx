// tui/src/AddDirDialog.tsx — the `/add-dir` two-phase overlay (Wave 3 task 3). Entry phase (opened with no
// arg): a single-line path prompt, validated on Enter via the injected `onValidate` (which round-trips
// through the session's listDirs(), so it must be async). Confirm phase (opened straight away with a
// PRE-validated `prefill` from `/add-dir <path>`, or reached from the entry phase once validation returns
// "ok"): CC's three-option grant menu. Callback props only — no session access here, mirroring every other
// dialog in this package (RewindPicker/ModelPicker/BgTasksPanel): useChat owns the session calls, this
// component owns only the keys and the two-phase state.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { formatAddDirVerdict, type AddDirVerdict } from "./addDir.js";
import type { RenderLine } from "./render.js";
import { Line } from "./Transcript.js";
import { ACCENT } from "./theme.js";

const OPTIONS = ["Yes, for this session", "Yes, and remember this directory", "No"] as const;
const TITLE = "Add directory to workspace";
const FOOTER = "Enter to add · Esc to cancel";

export function AddDirDialog({ prefill, onValidate, onConfirm, onCancel }: {
  prefill?: string;
  onValidate: (raw: string) => Promise<AddDirVerdict>;
  onConfirm: (abs: string, remember: boolean) => void;
  onCancel: (abs?: string) => void;
}) {
  const [phase, setPhase] = useState<"entry" | "confirm">(prefill ? "confirm" : "entry");
  const [abs, setAbs] = useState(prefill ?? "");
  const [text, setText] = useState("");
  const [error, setError] = useState<RenderLine[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [idx, setIdx] = useState(0);

  useInput((input, key) => {
    if (phase === "entry") {
      if (validating) return;                                     // ignore keys mid-validate (no double-submit)
      if (key.escape) { onCancel(); return; }
      if (key.return) {
        setValidating(true); setError(null);
        onValidate(text)
          .then((v) => {
            setValidating(false);
            if (v.kind === "ok") { setAbs(v.abs); setIdx(0); setPhase("confirm"); }
            else setError(formatAddDirVerdict(v));
          })
          .catch((e) => { setValidating(false); setError([{ text: `✗ ${(e as Error).message}`, color: "red" }]); });
        return;
      }
      if (key.backspace || key.delete) { setText((t) => t.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) setText((t) => t + input);
      return;
    }
    // confirm phase
    if (key.escape) { onCancel(abs); return; }
    if (key.upArrow) { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIdx((i) => Math.min(OPTIONS.length - 1, i + 1)); return; }
    if (key.return) {
      if (idx === 0) onConfirm(abs, false);
      else if (idx === 1) onConfirm(abs, true);
      else onCancel(abs);                                          // "No" behaves exactly like Esc
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>{TITLE}</Text>
      {phase === "entry" ? (
        <>
          <Text>Enter the path to the directory:</Text>
          <Box flexDirection="row">
            {text.length ? <Text>{text}</Text> : <Text dimColor>Directory path…</Text>}
            <Text inverse>{" "}</Text>
          </Box>
          {error ? <Box flexDirection="column">{error.map((l, i) => <Line key={i} l={l} />)}</Box> : null}
        </>
      ) : (
        <>
          <Text bold>{abs}</Text>
          <Text dimColor>Claude Code will be able to read files in this directory and make edits when auto-accept edits is on.</Text>
          <Text> </Text>
          {OPTIONS.map((label, i) => (
            <Text key={label} color={i === idx ? ACCENT : undefined}>{i === idx ? "❯ " : "  "}{label}</Text>
          ))}
        </>
      )}
      <Text dimColor>{FOOTER}</Text>
    </Box>
  );
}
