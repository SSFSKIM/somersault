// tui/src/AddDirDialog.tsx — the `/add-dir` two-phase overlay (Wave 3 task 3). Entry phase (opened with no
// arg): a single-line path prompt, validated on Enter via the injected `onValidate` (which round-trips
// through the session's listDirs(), so it must be async). Confirm phase (opened straight away with a
// PRE-validated `prefill` from `/add-dir <path>`, or reached from the entry phase once validation returns
// "ok"): CC's three-option grant menu. Callback props only — no session access here, mirroring every other
// dialog in this package (RewindPicker/ModelPicker/BgTasksPanel): useChat owns the session calls, this
// component owns only the keys and the two-phase state.
//
// F2 Task 8: no `useInput`. The CONFIRM phase pushes the `Confirmation` context (↑/↓/Enter/Esc, plus the
// table's bare y/n). The ENTRY phase does NOT: a directory path is free text, and `y`/`n`/`enter`/`escape`
// are all bound in that context, so the scope is gated `active: phase === "confirm"` and the path input flows
// through the keymap FALLBACK instead. One exception has to stay reachable in both phases — when
// PermissionsDialog embeds this component, ITS `Settings` scope also binds escape, so `confirm:no` still
// fires during entry; the handler branches on the phase rather than assuming it.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import { useRefState } from "./keys/refState.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
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
  // Ref-backed: one stdin chunk parses into several events with no render in between, so a typed path must
  // accumulate against the live buffer and Enter must validate what was actually typed (keys/refState.ts).
  const [text, setText, textRef] = useRefState("");
  const [error, setError] = useState<RenderLine[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [idx, setIdx] = useState(0);

  const submitPath = () => {
    setValidating(true); setError(null);
    onValidate(textRef.current)
      .then((v) => {
        setValidating(false);
        if (v.kind === "ok") { setAbs(v.abs); setIdx(0); setPhase("confirm"); }
        else setError(formatAddDirVerdict(v));
      })
      .catch((e) => { setValidating(false); setError([{ text: `✗ ${(e as Error).message}`, color: "red" }]); });
  };
  const pick = () => {
    if (idx === 0) onConfirm(abs, false);
    else if (idx === 1) onConfirm(abs, true);
    else onCancel(abs);                                            // "No" behaves exactly like Esc
  };
  useKeyScope("Confirmation", { active: phase === "confirm" });
  useKeyActions({
    "confirm:previous": () => setIdx((i) => Math.max(0, i - 1)),
    "confirm:next": () => setIdx((i) => Math.min(OPTIONS.length - 1, i + 1)),
    "confirm:yes": () => { if (phase === "confirm") pick(); },
    // Reachable in BOTH phases (see the header): embedded, the enclosing Settings scope binds escape too.
    "confirm:no": () => { if (phase === "confirm") onCancel(abs); else if (!validating) onCancel(); },
  });
  useKeyFallback((e: KeyEvent | TextEvent) => {
    if (phase !== "entry") return;                                 // the confirm phase is all table actions
    if (validating) return;                                        // ignore keys mid-validate (no double-submit)
    const { input, key } = toKeyFlags(e);
    if (key.escape) { onCancel(); return; }
    if (key.return) { submitPath(); return; }
    if (key.backspace || key.delete) { setText(textRef.current.slice(0, -1)); return; }
    if (input && input >= " " && !key.ctrl && !key.meta) setText(textRef.current + input);
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
