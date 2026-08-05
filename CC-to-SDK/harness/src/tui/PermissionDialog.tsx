// tui/src/PermissionDialog.tsx — the permission KIND SWITCHBOARD (F6 T6), and the generic body every kind
// that has no dialog of its own still falls back to.
//
// `permissionKind(toolName, input, cwd)` is upstream's own routing question (`Ksn` L279164 — see
// dialogs/permissionKind.ts), asked once here. Task 6 landed the `bash` arm and Task 7 the `file` one — which
// is the biggest of the three by traffic: six tools (Edit · Write · NotebookEdit · Read · Glob · Grep) plus a
// Bash command that parses as an in-place `sed`, whose descriptor rides the route as `sedEdit`.
// `webfetch`/`skill`/`monitor`/`generic` keep the pre-F6 body below UNTOUCHED, key contract and all, until
// task 8 replaces them.
//
// ── the generic body (pre-F6, unchanged) ──────────────────────────────────────────────────────────────
// CC-style approval gate: a numbered, arrow-selectable menu
// (Yes / Yes-don't-ask-again / No) over the tool + its full target. ↑/↓ + Enter, 1/2/3, Esc = No,
// y = accept once, n = reject (KB1); the legacy a/A/d shortcuts still work. UI hints are absent
// headlessly, so the prompt is reconstructed from toolName + input. Shared by the chat REPL (ChatApp)
// and the daemon console (App).
//
// F2 Task 8: no `useInput`. The dialog pushes the `Confirmation` context, so ↑/↓/Enter/Esc and the bare y/n
// are the table's four actions; the numbered rows and the legacy a/A/d/D letters are bound in no context and
// arrive on the keymap FALLBACK. `Confirmation` deliberately leaves the root globals live (a decision dialog
// is not an overlay — Ctrl-C/O/T/R/B still work over it), which is why nothing is unbound here but ctrl+d.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import type { PermissionDecision } from "../index.js";
import type { PermissionUpdateLike } from "../permissions/types.js";
import { ACCENT } from "./theme.js";
import { permissionKind } from "./dialogs/permissionKind.js";
import { BashPermission } from "./dialogs/BashPermission.js";
import { FilePermission } from "./dialogs/FilePermission.js";

/** The salient target of a tool: the Bash command, the file path, else the first arg. */
function target(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Bash") return String(input.command ?? "");
  if (toolName === "Edit" || toolName === "Write" || toolName === "Read") return String(input.file_path ?? input.path ?? "");
  const v = Object.values(input ?? {})[0];
  return v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
}
const clip = (s: string, n = 140): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

interface Opt { key: string; label: string; decision: PermissionDecision }

export interface PermissionDialogRequest {
  toolName: string; input: Record<string, unknown>;
  title?: string; description?: string; subagentType?: string;
  suggestions?: PermissionUpdateLike[]; decisionReason?: string;
}

/** The switchboard. `cwd` is the SESSION's working directory, which the routing needs (a Glob/Grep/Read
 *  consult titles itself with it) and the Bash body's suggestion summary names — see permissionKind.ts.
 *  `directories` is the session's WHOLE working set (cwd + every `/add-dir` grant, off `listDirs()`); only
 *  the file body reads it, for upstream's in-working-directory test (`z7`). Absent means "cwd alone", which
 *  is right for a caller that has no directory list to give. */
export function PermissionDialog({ req, onDecision, cwd, directories }: { req: PermissionDialogRequest; onDecision: (d: PermissionDecision) => void; cwd?: string; directories?: readonly string[] }) {
  const { kind, filePath, sedEdit } = permissionKind(req.toolName, req.input, cwd);
  if (kind === "bash") return <BashPermission req={req} onDecision={onDecision} cwd={cwd} />;
  if (kind === "file") return <FilePermission req={req} onDecision={onDecision} cwd={cwd} directories={directories} filePath={filePath} sedEdit={sedEdit} />;
  return <GenericPermission req={req} onDecision={onDecision} />;
}

/** Exported for its own test: since T7 the switchboard sends every file tool and every Bash command (plain or
 *  sed-shaped) to a dialog of its own, so several of this body's branches — the `$ ` command prefix above all
 *  — are no longer reachable THROUGH the switchboard even though the body still renders them for the kinds
 *  task 8 has yet to claim. */
export function GenericPermission({ req, onDecision }: { req: PermissionDialogRequest; onDecision: (d: PermissionDecision) => void }) {
  const opts: Opt[] = [
    { key: "1", label: "Yes", decision: { kind: "allow_once" } },
    { key: "2", label: `Yes, and don't ask again for ${req.toolName} this session`, decision: { kind: "allow_always" } },
    { key: "3", label: "No, and tell Claude what to do differently (esc)", decision: { kind: "deny" } },
  ];
  const [idx, setIdx] = useState(0);
  useKeyScope("Confirmation");
  useKeyActions({
    "confirm:previous": () => setIdx((i) => Math.max(0, i - 1)),
    "confirm:next": () => setIdx((i) => Math.min(opts.length - 1, i + 1)),
    // Enter and a bare `y` are ONE action in the table but two different answers here: Enter takes the
    // HIGHLIGHTED row (↓↓⏎ must still be able to deny), while `y` is the shortcut that means yes wherever the
    // cursor is. The handler is handed the event precisely so it can tell them apart.
    "confirm:yes": (e) => onDecision(e.name === "enter" ? opts[idx].decision : { kind: "allow_once" }),
    "confirm:no": () => onDecision({ kind: "deny" }),               // escape and a bare `n` both mean deny
  });
  useKeyFallback((e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    if (key.ctrl || key.meta) return;                               // ctrl+y / alt+n are not decisions
    const n = opts.findIndex((o) => o.key === input);
    if (n >= 0) { onDecision(opts[n].decision); return; }
    if (input === "a") onDecision({ kind: "allow_once" });           // legacy shortcuts
    else if (input === "A") onDecision({ kind: "allow_always" });
    else if (input === "d" || input === "D") onDecision({ kind: "deny" });
  });
  const tgt = clip(target(req.toolName, req.input));
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      {req.subagentType ? <Text dimColor>Subagent ({req.subagentType}) asks:</Text> : null}
      <Text bold>Allow Claude to use <Text color={ACCENT}>{req.toolName}</Text>?</Text>
      {tgt ? <Text dimColor>{"  "}{req.toolName === "Bash" ? "$ " : ""}{tgt}</Text> : null}
      <Text> </Text>
      {opts.map((o, i) => (
        <Text key={o.key} color={i === idx ? ACCENT : undefined}>{i === idx ? "❯ " : "  "}{o.key}. {o.label}</Text>
      ))}
    </Box>
  );
}
