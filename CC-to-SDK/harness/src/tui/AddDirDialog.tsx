// tui/src/AddDirDialog.tsx — the `/add-dir` two-phase overlay (Wave 3 task 3). Entry phase (opened with no
// arg): a single-line path prompt, validated on Enter via the injected `onValidate` (which round-trips
// through the session's listDirs(), so it must be async). Confirm phase (opened straight away with a
// PRE-validated `prefill` from `/add-dir <path>`, or reached from the entry phase once validation returns
// "ok"): CC's three-option grant menu. Callback props only — no session access here, mirroring every other
// dialog in this package (RewindPicker/ModelPicker/BgTasksPanel): useChat owns the session calls, this
// component owns only the keys and the two-phase state.
//
// F2 Task 8 (+ t8 review, Important 1): no `useInput`. This dialog pushes ONE context — `Select` — and pushes it
// in BOTH phases, unconditionally while it is mounted, because the scope's null bindings ARE this overlay's gate:
// ChatApp's deleted `gatedRef` classified `/add-dir` as an "overlay" owner (its `inputOwnerRef` still does), so
// ctrl+c/o/t/r/b never reached either phase, and a scope gated off during entry revived all six over a half-typed
// path — Ctrl-R or Ctrl-B there renders history search or the bg panel ABOVE the addDir arm, unmounting this
// component and discarding what was typed. `Select` is the natural context: the confirm phase is literally a
// three-row list. The entry phase is covered because every one of Select's actions is ROUTED BY PHASE (see
// `route` below) — during entry they all land in the physical `onEntryKey`, so `j`/`k` (and, when
// PermissionsDialog embeds this component, the `space` and `/` its `Settings` scope binds) are typed into the
// path instead of navigating. Free text the table never matched arrives at the keymap FALLBACK, routed the
// same way. F2 final review changed only the other half: the confirm phase's handlers now perform their own
// operation instead of re-reading the physical key, so a rebound key actually moves the menu (P2).
//
// Enter/Escape therefore mean the phase's own thing (validate/submit vs. pick/cancel), and the bare y/n of the
// `Confirmation` context are gone with it — deliberately: the confirm phase's footer only ever advertised
// "Enter to add · Esc to cancel", and an approval menu should not carry unadvertised keys.
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
  // The ENTRY phase is a text prompt, so it keeps the physical body: `j`, `k` and space are characters in a
  // path, and they arrive as Select actions (and, embedded under PermissionsDialog, as Settings ones) — only
  // the event can say what they are. Both routes land here, actions and fallback alike (see the header).
  const onEntryKey = (e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    if (validating) return;                                        // ignore keys mid-validate (no double-submit)
    if (key.escape) { onCancel(); return; }
    if (key.return) { submitPath(); return; }
    if (key.backspace || key.delete) { setText(textRef.current.slice(0, -1)); return; }
    if (input && input >= " " && !key.ctrl && !key.meta) setText(textRef.current + input);
  };
  /** The CONFIRM phase is a three-row list and nothing else, so its actions perform their own operation —
   *  a `"x": "select:next"` in the user's file has to move the cursor, not resolve into a body that then
   *  re-checks for `j` (final review, P2). Embedded under PermissionsDialog the Settings context adds `space`
   *  to select:accept, so space takes the highlighted row here too; standalone, Select never binds it. */
  const route = (op: () => void) => (e: KeyEvent | TextEvent) => {
    if (phase === "entry") { onEntryKey(e); return; }
    op();
  };
  // Jumps never had a `toKeyFlags` projection to re-read (home/end/pageup/pagedown all flatten to an empty
  // input) — on a three-row list a page IS the list. Inert during entry, like every other confirm-phase op.
  const jump = (to: number) => () => { if (phase === "confirm") setIdx(Math.max(0, Math.min(OPTIONS.length - 1, to))); };
  useKeyScope("Select");
  useKeyActions({
    "select:previous": route(() => setIdx((i) => Math.max(0, i - 1))),
    "select:next": route(() => setIdx((i) => Math.min(OPTIONS.length - 1, i + 1))),
    "select:accept": route(pick),
    "select:cancel": route(() => onCancel(abs)),                   // "No" and Esc are the same outcome
    "select:first": jump(0), "select:pageUp": jump(0),
    "select:last": jump(OPTIONS.length - 1), "select:pageDown": jump(OPTIONS.length - 1),
  });
  // Confirm-phase keys the table does not name mean nothing here; entry-phase ones are the typed path.
  useKeyFallback(route(() => {}));

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
