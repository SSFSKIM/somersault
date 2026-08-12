// tui/src/PermissionDialog.tsx — the permission KIND SWITCHBOARD (F6 T6-T8), and as of T8 nothing else: the
// pre-F6 generic body that used to live under it is gone, because every route out of `permissionKind` now
// lands on a real dialog of its own.
//
// `permissionKind(toolName, input, cwd)` is upstream's own routing question (`Ksn` L279164 — see
// dialogs/permissionKind.ts), asked once here, and `xll` (L506264, the census's §1 table) is the registry it
// answers into. The six arms:
//
//   bash     → BashPermission   (T6, `dZf` L505224)      · file → FilePermission  (T7, `Cem` L505875)
//   webfetch → FetchPermission  (T8, `ull` L506735)      · skill → SkillPermission (T8, `oll` L506582)
//   monitor  → MonitorPermission(T8, `Ral` L506006)      · generic → GenericPermission (T8, `Gal` L506118)
//
// The KEY CONTRACT is now written once per body and identical across all six (see BashPermission.tsx's
// header for why each half is where it is): digits reach the embedded `Select`; `y`/`n` are the dialog's
// `Confirmation` scope, deregistered while a text row has the cursor; Enter and Escape belong to the
// `SelectDecision` scope the Select pushes from INSIDE the body; and the legacy `a`/`A`/`d`/`D` letters ride
// `Select`'s `onUnhandledKey` (dialogs/dialogKeys.ts). Nothing here binds a key of its own.
import React from "react";
import type { PermissionDecision } from "../index.js";
import type { PermissionUpdateLike } from "../permissions/types.js";
import { permissionKind } from "./dialogs/permissionKind.js";
import { BashPermission } from "./dialogs/BashPermission.js";
import { FilePermission } from "./dialogs/FilePermission.js";
import { FetchPermission } from "./dialogs/FetchPermission.js";
import { SkillPermission } from "./dialogs/SkillPermission.js";
import { MonitorPermission } from "./dialogs/MonitorPermission.js";
import { GenericPermission } from "./dialogs/GenericPermission.js";

export interface PermissionDialogRequest {
  toolName: string; input: Record<string, unknown>;
  title?: string; description?: string; subagentType?: string;
  suggestions?: PermissionUpdateLike[]; decisionReason?: string;
}

/** The switchboard. `cwd` is the SESSION's working directory, which the routing needs (a Glob/Grep/Read
 *  consult titles itself with it) and which the Bash, Skill and generic bodies name in a row label — see
 *  permissionKind.ts. `directories` is the session's WHOLE working set (cwd + every `/add-dir` grant, off
 *  `listDirs()`); only the file body reads it, for upstream's in-working-directory test (`z7`). Absent means
 *  "cwd alone", which is right for a caller that has no directory list to give. */
export function PermissionDialog({ req, onDecision, cwd, directories, columns, maxRows }: { req: PermissionDialogRequest; onDecision: (d: PermissionDecision) => void; cwd?: string; directories?: readonly string[];
  /** The pane width, threaded from the renderer's own resize state rather than read off `process.stdout` in
   *  each body — the three bodies with a row budget WRAP at it, so a width that disagrees with the frame's is
   *  a budget spent in rows nobody paints. Absent, each body falls back to `process.stdout.columns ?? 80`. */
  columns?: number;
  /** FSW T13b — a HARD CEILING on the rows the dialog may compose into, present only where the renderer has
   *  one (the fullscreen dock band; the main screen has none and passes nothing). It reaches the three bodies
   *  whose content is UNBOUNDED: the file body's diff or file content, the bash body's command, and the
   *  generic body's rendered input. The other three (webfetch, skill, monitor) are fixed-shape summaries a
   *  line or two long, and are left alone. */
  maxRows?: number }) {
  const { kind, filePath, sedEdit } = permissionKind(req.toolName, req.input, cwd);
  switch (kind) {
    case "bash": return <BashPermission req={req} onDecision={onDecision} cwd={cwd} columns={columns} maxRows={maxRows} />;
    case "file": return <FilePermission req={req} onDecision={onDecision} cwd={cwd} directories={directories} filePath={filePath} sedEdit={sedEdit} columns={columns} maxRows={maxRows} />;
    case "webfetch": return <FetchPermission req={req} onDecision={onDecision} />;
    case "skill": return <SkillPermission req={req} onDecision={onDecision} cwd={cwd} />;
    case "monitor": return <MonitorPermission req={req} onDecision={onDecision} />;
    case "generic": return <GenericPermission req={req} onDecision={onDecision} cwd={cwd} columns={columns} maxRows={maxRows} />;
  }
}
