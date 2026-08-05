// tui/dialogs/permissionKind.ts — which permission dialog a tool call belongs to. Pure: no React, no fs,
// no theme. Transcribed from 2.1.220's `Ksn` (L279164-279246), which asks three questions in this order:
//
//   1. is there a per-tool dialog registered for it?  `DPs`/`w8y` (L279160/L279380) — WebFetch, the browser
//      MCP tools, AskUserQuestion, enter/exit plan mode, Skill, PowerShell, Monitor, the workflow tool;
//   2. is it a FILE tool?  `qrn` (L228385) — and can a path be derived from the input, `Vrn` (L228408)?
//      No path means no diff to show, so upstream falls through to the generic dialog;
//   3. is it Bash?  then a command that parses as an in-place sed is re-routed to the FILE dialog with a
//      simulated diff (`c1t`, see sedEdit.ts); everything else is the Bash dialog.
//
// Everything unclaimed — MCP tools included — is generic. Of the registry, only the three kinds this
// harness builds dialogs for survive as their own kind; the rest (browser, plan mode, PowerShell, the
// workflow tool) fall to `generic`, which is the honest answer for a dialog we do not ship.

import { parseSedEdit, type SedEdit } from "./sedEdit.js";

export type PermissionKind = "bash" | "file" | "webfetch" | "skill" | "monitor" | "generic";

export interface PermissionKindResult {
  kind: PermissionKind;
  /** Present on every `file` route — the path the dialog titles itself with. */
  filePath?: string;
  /** Present only on the Bash-that-is-really-an-edit route. */
  sedEdit?: SedEdit;
}

/** `qrn` L228385-228396. Six tools, not the four that "file dialog" suggests: Glob and Grep are in the set
 *  too, and upstream's descriptor builder gives them the plain `Read file` / "Do you want to proceed?"
 *  body at L228464 rather than a diff. */
const FILE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "Glob", "Grep", "Read"]);

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** `Vrn` L228408-228418 over each tool's own `getPath`. `null` = "no path could be derived", which is the
 *  condition that sends Edit/Write/NotebookEdit to the generic dialog. The three search/read tools have a
 *  cwd fallback baked into their `getPath` (L220178 Glob · L220299 Grep · L307642 Read), so they never
 *  return null — that asymmetry is upstream's, not ours. */
export function derivePath(toolName: string, input: Record<string, unknown>, cwd: string = process.cwd()): string | null {
  switch (toolName) {
    case "Edit":
    case "Write":
      return str(input.file_path);
    case "NotebookEdit":
      return str(input.notebook_path);
    case "Read":
      return str(input.file_path) ?? cwd;
    case "Grep":
      return str(input.path) ?? cwd;
    case "Glob":
      return globSearchDir(str(input.pattern)) ?? str(input.path) ?? cwd;
    default:
      return null;
  }
}

/** `eTs` L220016-220022: a glob only yields a search dir when the PATTERN IS ABSOLUTE — a relative pattern
 *  returns null and the deriver falls back to `path`, then cwd. The base dir is the leading run of
 *  segments that carry no glob metacharacter. */
function globSearchDir(pattern: string | null): string | null {
  if (pattern === null || !pattern.startsWith("/")) return null;
  const base: string[] = [];
  for (const segment of pattern.split("/").slice(1)) {
    if (/[*?[\]{}]/.test(segment)) break;
    base.push(segment);
  }
  return base.length === 0 ? "/" : `/${base.join("/")}`;
}

export function permissionKind(toolName: string, input: Record<string, unknown>): PermissionKindResult {
  // 1 — the registry (`w8y` L279380), narrowed to the dialogs this harness ships.
  if (toolName === "WebFetch") return { kind: "webfetch" };
  if (toolName === "Skill") return { kind: "skill" };
  if (toolName === "Monitor") return { kind: "monitor" };

  // 2 — the file family, but only when a path comes out of it.
  if (FILE_TOOLS.has(toolName)) {
    const filePath = derivePath(toolName, input);
    return filePath === null ? { kind: "generic" } : { kind: "file", filePath };
  }

  // 3 — Bash, and the sed that is secretly an edit (L279225-279232).
  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    const sedEdit = parseSedEdit(command);
    return sedEdit === null ? { kind: "bash" } : { kind: "file", filePath: sedEdit.filePath, sedEdit };
  }

  return { kind: "generic" };
}
