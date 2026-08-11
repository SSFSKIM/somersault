// tui/dialogs/fileOptions.ts — the FILE permission dialog's pure half (F6 T7): the per-tool descriptor
// (title / subtitle / question / body), the containment and `.claude`-folder tests the option list branches
// on, the four session-row wordings, and what each row MEANS. No React, no Ink; every filesystem question is
// asked through an injected `FileFs` so the whole module is testable without a disk.
//
// Transcribed from 2.1.220's:
//   `UMy`  L228435-467 — the per-tool descriptor table (Edit · Write · NotebookEdit · everything else)
//   `zrn`  L228468-476 — the wrapper that adds `filePath`/`operationType`/`symlinkTarget`
//   `DCs`  L228484-494 — the sed-as-edit descriptor (its preview lives in sedEdit.ts, `sedEditPreview`)
//   `tal`  L505624-654 — the option list: Yes · the `.claude` row · ONE session row · No
//   `vem`  L505840-854 — what each row returns
//   `Aid`  L228419-427 / `$f` — the symlink target, writes only
//   `z7`/`u1` L371374/L371379 — "is this path inside a working directory", `/private` collapse and all
//   `m9b`/`h9b` L505616/L505622 — the project- and home-`.claude` tests
//   `iHr`  L371709-724 + `p1t` L228676 — the permission updates a session grant carries
//
// THE ONE PLACE THIS DIALOG DIFFERS FROM UPSTREAM'S DATA FLOW, and it is the whole point of probe 78:
// upstream RECOMPUTES the session grant locally (`iHr`), because it is the engine. We are a client, and the
// engine hands us the very same object in `suggestions` — file WRITES suggest `{type:"setMode",
// mode:"acceptEdits", destination:"session"}`, out-of-cwd READS suggest a directory-glob `addRules`. So the
// echo is primary and `iHr` is the FALLBACK for a consult the engine said nothing about. `iHr` is ported
// anyway (`constructedUpdates`) because "the engine always suggests" is not a promise anyone made us.

import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { SelectOption } from "../select/Select.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";
import { noRow, yesRow, type FeedbackMode } from "./optionRows.js";
import { sedEditPreview, type SedEdit } from "./sedEdit.js";

/** `fl` L100719 — the tool every `.claude`-folder rule is keyed to. */
const EDIT = "Edit";
/** `$ro`/`Bro` L100719, the two literal rule contents the `.claude` row grants. */
export const PROJECT_CLAUDE_RULE = "/.claude/**", GLOBAL_CLAUDE_RULE = "~/.claude/**";
/** L505631. */
export const CLAUDE_FOLDER_LABEL = "Yes, and allow Claude to edit its own settings for this session";
/** L505641 — what an unnamed directory is called. */
export const THIS_DIRECTORY = "this directory";

export type FileOperation = "read" | "write";

/** Every disk question this module (and the dialog above it) asks, as one injected object. `readFile`
 *  returns `undefined` for "not there / unreadable" — the same shape `sedEditPreview` already takes. */
export interface FileFs {
  readFile(path: string): string | undefined;
  isDirectory(path: string): boolean;
  /** `$f`: `realpathSync(p)` when it differs from `p`, else undefined. Upstream compares the WHOLE chain,
   *  not just the leaf, which is why a `/tmp/…` path on macOS legitimately reports one. */
  realPath(path: string): string | undefined;
}

// ── containment (`z7` / `u1` L371374-371389) ─────────────────────────────────────────────────────────

/** `u1`'s two rewrites, with `caseFold:!1` (which is what `z7` passes). macOS mounts `/var` and `/tmp` as
 *  symlinks into `/private`, so the same directory arrives spelled two ways and a naive `relative()` calls
 *  one of them "outside" the other. */
const collapsePrivate = (p: string): string => p.replace(/^\/private\/var\//, "/var/").replace(/^\/private\/tmp(\/|$)/, "/tmp$1");
/** `_Ce` L36514 — a `..` SEGMENT anywhere, not a `..` prefix. */
const hasDotDot = (p: string): boolean => /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p);

/** `u1(path, dir, {caseFold:false})`: is `path` at or under `dir`? */
export function isUnder(path: string, dir: string, cwd: string): boolean {
  const a = collapsePrivate(resolve(cwd, path)), b = collapsePrivate(resolve(cwd, dir));
  const rel = relative(b, a);
  if (rel === "") return true;
  if (hasDotDot(rel)) return false;
  return !isAbsolute(rel);
}

/** `z7(filePath, toolPermissionContext)` L371374, narrowed to the one shape a client can know: the SESSION's
 *  working directories. Upstream's `Ete`/`TBo` fan each configured directory into its symlink variants; the
 *  `/private` collapse in `isUnder` covers the only variant this harness can produce, so the fan-out is
 *  recorded rather than built. Empty list = nothing is in-directory, which is upstream's `every` over an
 *  empty candidate set inverted — deliberately NOT "everything is in-directory". */
export const isInWorkingDirectory = (filePath: string, directories: readonly string[], cwd: string): boolean =>
  directories.some((dir) => isUnder(filePath, dir, cwd));

/** `UK` L36504: the directory a path NAMES — itself when it is one, its parent otherwise. The out-of-directory
 *  session rows are titled with this. */
export const searchDirectory = (filePath: string, cwd: string, fs: FileFs): string => {
  const abs = resolve(cwd, filePath);
  return fs.isDirectory(abs) ? abs : dirname(abs);
};

// ── the `.claude` folder (`m9b` L505616 / `h9b` L505622) ─────────────────────────────────────────────

/** `Ny` L371074 — upstream's case fold, including the two characters whose lowercase is not their own. */
const fold = (s: string): string => s.toLowerCase().replace(/ı/g, "i").replace(/ſ/g, "s");
/** Both tests are `startsWith(dir + sep)`, so the `.claude` DIRECTORY ITSELF is not "inside" it — only its
 *  contents are. Faithful; a consult on the directory node is a consult on a directory, not on a setting. */
const insideFolder = (path: string, folder: string): boolean => {
  const n = fold(path), o = fold(folder);
  return n.startsWith(o + sep) || n.startsWith(`${o}/`);
};

export type ClaudeScope = "claude-folder" | "global-claude-folder";
/** `m9b` first, `h9b` second — `tal` L505630 tests them in that order and picks `global-claude-folder` only
 *  when the HOME one matched (its ternary reads `d ? global : project`, and `d` is `h9b`). */
export function claudeFolderScope(filePath: string, cwd: string, home: string): ClaudeScope | null {
  const abs = resolve(cwd, filePath);
  if (insideFolder(abs, resolve(home, ".claude"))) return "global-claude-folder";
  if (insideFolder(abs, resolve(cwd, ".claude"))) return "claude-folder";
  return null;
}

// ── the symlink warning (`Aid` L228419 + `Cem`'s node, L505896) ──────────────────────────────────────

/** `Aid`: READS never warn (nothing is being modified), and a path that realpaths to itself is not a link. */
export function symlinkTarget(filePath: string, operationType: FileOperation, cwd: string, fs: FileFs): string | undefined {
  if (operationType === "read") return undefined;
  return fs.realPath(resolve(cwd, filePath));
}

/** L505896, both arms. The escape test is upstream's own `relative(cwd, target).startsWith("..")` — a plain
 *  prefix test, not `hasDotDot`, so it is written out rather than routed through `isUnder`. */
export const symlinkWarning = (target: string, cwd: string): string =>
  relative(cwd, target).startsWith("..")
    ? `This will modify ${target} (outside working directory) via a symlink`
    : `Symlink target: ${target}`;

// ── the descriptor (`UMy` L228435-467, `zrn` L228468, `DCs` L228484) ─────────────────────────────────

export interface FileEdit { old_string: string; new_string: string; replace_all: boolean }
export type NotebookEditMode = "insert" | "delete" | "replace";

export type FileContent =
  | { kind: "file-edit-diff"; filePath: string; edits: FileEdit[] }
  | { kind: "file-write-diff"; filePath: string; content: string; fileExists: boolean; oldContent: string }
  | { kind: "notebook-edit-diff"; notebookPath: string; cellId?: string; newSource: string; cellType?: string; editMode: NotebookEditMode; oldSource: string; notebookRead: boolean }
  | { kind: "tool-use-line"; text: string }
  | { kind: "no-changes"; message: string };

export type FileQuestion = { kind: "plain"; text: string } | { kind: "file-action"; verbPhrase: string; fileName: string };

export interface FileDescriptor {
  title: string;
  subtitle?: string;
  question: FileQuestion;
  content: FileContent;
  filePath: string;
  operationType: FileOperation;
  symlinkTarget?: string;
}

/** `qrn` L228385's six tools, split by `isReadOnly`. Glob/Grep/Read take `UMy`'s FINAL return (L228464) —
 *  the plain `Read file` / "Do you want to proceed?" / tool-use-line body — because they never reach one of
 *  the three typed arms above it. */
const READ_ONLY = new Set(["Read", "Glob", "Grep"]);
export const isReadOnlyTool = (toolName: string): boolean => READ_ONLY.has(toolName);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
/** `MCs(path, false)` L228433. */
const fileName = (path: string): string => basename(path) || path;
/** `Eid(path, false)` L228430 — a PLAIN `relative`, not `displayPath`: upstream shows `../x/y.ts` for a
 *  path outside the cwd here rather than the `~`-shortened display form the transcript uses. */
const subtitleOf = (path: string, cwd: string): string => relative(cwd, path);

/** An approximation of `Z3t(toolName, input, {verbose:true})`, which is upstream's whole tool-use-message
 *  renderer and is not in scope here. Upstream's own catch-arm falls back to the bare `filePath`, so the
 *  shape (`Name(argument)`) is what matters; the argument is the tool's salient field, then the path. */
export function toolUseLine(toolName: string, input: Record<string, unknown>, filePath: string): string {
  const argument = toolName === "Glob" || toolName === "Grep"
    ? str(input.pattern) ?? str(input.path) ?? filePath
    : str(input.file_path) ?? str(input.path) ?? filePath;
  return `${toolName}(${argument})`;
}

/** `UMy` L228435-467 + `zrn`'s three additions. Synchronous where upstream is async: every read goes through
 *  the injected `fs`, and the dialog renders once rather than suspending. */
export function fileDescriptor(args: {
  toolName: string; input: Record<string, unknown>; filePath: string; cwd: string; fs: FileFs;
}): FileDescriptor {
  const { toolName, input, filePath, cwd, fs } = args;
  const operationType: FileOperation = isReadOnlyTool(toolName) ? "read" : "write";
  const link = symlinkTarget(filePath, operationType, cwd, fs);
  const common = { filePath, operationType, ...(link === undefined ? {} : { symlinkTarget: link }) };

  if (toolName === "Edit") {                                                              // L228438-441
    const edits: FileEdit[] = [{ old_string: str(input.old_string) ?? "", new_string: str(input.new_string) ?? "", replace_all: input.replace_all === true }];
    return { ...common, title: "Edit file", subtitle: subtitleOf(filePath, cwd),
      question: { kind: "file-action", verbPhrase: "make this edit to", fileName: fileName(filePath) },
      content: { kind: "file-edit-diff", filePath, edits } };
  }
  if (toolName === "Write") {                                                             // L228442-459
    // L228452-458, the LOCAL arm (the three `remoteWorkspace` arms are a claude.ai surface): the file is read,
    // and whether the read SUCCEEDED is what picks the title. A read that throws leaves `fileExists` false,
    // which is exactly upstream's try/catch.
    const read = fs.readFile(resolve(cwd, filePath));
    const fileExists = read !== undefined;
    return { ...common, title: fileExists ? "Overwrite file" : "Create file", subtitle: subtitleOf(filePath, cwd),
      question: { kind: "file-action", verbPhrase: fileExists ? "overwrite" : "create", fileName: fileName(filePath) },
      content: { kind: "file-write-diff", filePath, content: str(input.content) ?? "", fileExists, oldContent: read ?? "" } };
  }
  if (toolName === "NotebookEdit") {                                                      // L228460-463
    const editMode: NotebookEditMode = input.edit_mode === "insert" ? "insert" : input.edit_mode === "delete" ? "delete" : "replace";
    const cellId = str(input.cell_id);
    return { ...common, title: "Edit notebook", subtitle: undefined,
      question: { kind: "file-action", fileName: fileName(filePath),
        verbPhrase: editMode === "insert" ? "insert this cell into" : editMode === "delete" ? "delete this cell from" : "make this edit to" },
      content: { kind: "notebook-edit-diff", notebookPath: filePath, cellId, newSource: str(input.new_source) ?? "",
        cellType: str(input.cell_type), editMode, ...notebookCellSource(filePath, cellId, cwd, fs) } };
  }
  // L228464 — Glob · Grep · Read, and any other file-family tool that reaches here.
  return { ...common, title: `${operationType === "read" ? "Read" : "Edit"} file`, subtitle: undefined,
    question: { kind: "plain", text: "Do you want to proceed?" },
    content: { kind: "tool-use-line", text: toolUseLine(toolName, input, filePath) } };
}

/** `fal`'s cell lookup (L505730-505757): a numeric `cell_id` INDEXES the cell list, anything else matches a
 *  cell's `id`. `notebookRead` is upstream's `!zDr` gate — a notebook we could not read renders the new
 *  source alone rather than a diff against an empty string. */
export function notebookCellSource(notebookPath: string, cellId: string | undefined, cwd: string, fs: FileFs): { oldSource: string; notebookRead: boolean } {
  const raw = fs.readFile(resolve(cwd, notebookPath));
  if (raw === undefined) return { oldSource: "", notebookRead: false };
  let cells: unknown;
  try { cells = (JSON.parse(raw) as { cells?: unknown }).cells; } catch { return { oldSource: "", notebookRead: false }; }
  if (!Array.isArray(cells)) return { oldSource: "", notebookRead: false };
  if (cellId === undefined) return { oldSource: "", notebookRead: true };
  const index = /^\d+$/.test(cellId) ? Number(cellId) : undefined;
  const cell = (index !== undefined ? cells[index] : cells.find((c) => typeof c === "object" && c !== null && (c as { id?: unknown }).id === cellId)) as { source?: unknown } | undefined;
  if (cell === undefined || cell === null) return { oldSource: "", notebookRead: true };
  const source = cell.source;
  return { oldSource: Array.isArray(source) ? source.join("") : str(source) ?? "", notebookRead: true };
}

/** `DCs` L228484-494's reachable half — the Bash-command-that-is-really-an-edit. Title, subtitle and question
 *  are Edit's, always: a sed is an edit no matter what the parse found. The `no-changes` arm is where its two
 *  messages ("Pattern did not match any content" / "File does not exist") surface. */
export function sedDescriptor(sed: SedEdit, cwd: string, fs: FileFs): FileDescriptor {
  const preview = sedEditPreview(sed, { readFile: fs.readFile, cwd });
  const link = symlinkTarget(preview.filePath, "write", cwd, fs);
  return {
    title: "Edit file", subtitle: subtitleOf(preview.filePath, cwd),
    question: { kind: "file-action", verbPhrase: "make this edit to", fileName: fileName(preview.filePath) },
    content: preview.edits.length > 0
      ? { kind: "file-edit-diff", filePath: preview.filePath, edits: preview.edits }
      : { kind: "no-changes", message: preview.message ?? "" },
    filePath: preview.filePath, operationType: "write", ...(link === undefined ? {} : { symlinkTarget: link }),
  };
}

// ── the option list (`tal` L505624-654) ──────────────────────────────────────────────────────────────

export interface SessionRowArgs {
  operationType: FileOperation;
  /** `z7`'s answer. */
  inDirectory: boolean;
  /** `basename(UK(filePath)) || "this directory"` — read only by the two out-of-directory arms. */
  directoryName: string;
  /** The LIVE-RESOLVED `chat:cycleMode` chord (`iP("chat:cycleMode","Chat","shift+tab")`, L505626), already
   *  in its lower-case display form. `""` = unbound, and the parenthetical is then dropped entirely rather
   *  than printing `()` — hints.ts's three-state contract, applied to a label. */
  cycleModeChord: string;
}

/** `tal`'s four session-row wordings, L505636-505650. Upstream BOLDS the directory name and the chord (they
 *  are JSX `<Text bold>` nodes); `SelectOption.label` is a string, so the bold is dropped — the same recorded
 *  divergence `bashOptions.ts` carries for `zMn`/`J5b`. */
export function sessionRowLabel({ operationType, inDirectory, directoryName, cycleModeChord }: SessionRowArgs): string {
  const chord = cycleModeChord === "" ? "" : ` (${cycleModeChord})`;
  if (inDirectory) return operationType === "read" ? "Yes, during this session" : `Yes, allow all edits during this session${chord}`;
  return operationType === "read"
    ? `Yes, allow reading from ${directoryName}/ during this session`
    : `Yes, allow all edits in ${directoryName}/ during this session${chord}`;
}

export interface FileOptionsArgs extends SessionRowArgs {
  /** `m9b`/`h9b`'s answer, or null. */
  claudeScope: ClaudeScope | null;
  /** Only the `no` half is honoured, for the reason `bashOptions.ts` states: the SDK's allow arm has no
   *  message field, so allow-side feedback is unreachable (T3 req 3). */
  feedback?: FeedbackMode;
}

/** `tal` L505624-654. Yes · exactly ONE middle row · No — and the middle row is never absent, which is the
 *  structural difference from `bashOptions`: the Bash list's "don't ask again" arms are gated on the engine
 *  having suggested something, this one is not (upstream computes its own grant, and so can we). */
export function fileOptions(a: FileOptionsArgs): SelectOption[] {
  const options: SelectOption[] = [yesRow(false)];
  if (a.claudeScope !== null && a.operationType !== "read") options.push({ label: CLAUDE_FOLDER_LABEL, value: "yes-claude-folder" });
  else options.push({ label: sessionRowLabel(a), value: "yes-session" });
  options.push(noRow(a.feedback?.no ?? false));
  return options;
}

// ── what a row means (`vem` L505840-854, over `iHr` L371709 / `p1t` L228676) ─────────────────────────

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** `pGn(e, {escapeGlobs:true})` L41840 — the rule grammar's escapes, so a directory with a `(` or a `*` in
 *  its name becomes a rule that matches that directory rather than a pattern. */
export function escapeRuleContent(s: string): string {
  let r = s.replaceAll("\\", "\\\\").replace(/[[\]()|+^$]/g, (c) => `\\${c}`).replaceAll("*", "\\*");
  if (r.startsWith("!") || r.startsWith("#")) r = `\\${r}`;
  return r.replace(/\s+$/, (ws) => [...ws].map((c) => `\\${c}`).join(""));
}

/** `p1t` L228676. The leading-slash doubling on an absolute path is UPSTREAM'S, not a bug of ours: probe 78
 *  observed exactly `{"toolName":"Read","ruleContent":"//<dir>/**"}` on the live wire, so reproducing it is
 *  what makes a constructed rule match the same paths an engine-suggested one does. */
export function readDirectoryRule(dir: string, destination = "session"): PermissionUpdateLike | undefined {
  if (dir === "/") return undefined;
  const escaped = escapeRuleContent(dir);
  return { type: "addRules", rules: [{ toolName: "Read", ruleContent: isAbsolute(dir) ? `/${escaped}/**` : `${escaped}/**` }], behavior: "allow", destination };
}

/** `iHr` L371709-724, with upstream's `s` term pinned TRUE. `s` is `(mode === "default" || mode === "plan")
 *  && !elevatedPrePlanMode` — the permission MODE, which a client cannot read off the consult. Every mode in
 *  which this dialog is reachable at all is a mode in which `s` holds (acceptEdits and bypassPermissions do
 *  not ask), so pinning it is the honest simplification rather than a guess. Only ever consulted when the
 *  engine suggested NOTHING — see the module header. */
export function constructedUpdates(args: { operationType: FileOperation; inDirectory: boolean; searchDir: string }): PermissionUpdateLike[] {
  const { operationType, inDirectory, searchDir } = args;
  const outside = !inDirectory;
  if (operationType === "read" && outside) {
    const rule = readDirectoryRule(searchDir);
    return rule === undefined ? [] : [rule];
  }
  const updates: PermissionUpdateLike[] = [{ type: "setMode", mode: "acceptEdits", destination: "session" }];
  if (operationType === "write" && outside) updates.push({ type: "addDirectories", directories: [searchDir], destination: "session" });
  return updates;
}

/** THE VARIANT PICK (probe 78/81, req 8). An out-of-cwd Read arrives with TWO suggestions that are the same
 *  grant spelled two ways — the raw directory and its `/private`-resolved twin (macOS resolves `/tmp` and
 *  `/var` through symlinks). Sending both would grant a path the human was never shown; probe 78 returned
 *  `suggestions[0]` ALONE and the next consult was suppressed, so the first is both the narrower and the
 *  PROVEN choice. It is a selection, never a reshape: the object that survives is echoed byte-for-byte.
 *  Grouping is by KIND rather than by position, because a write can legitimately suggest two DIFFERENT
 *  things at once (`iHr` returns `setMode` + `addDirectories`), and taking `[0]` flat would drop the second. */
export function pickSuggestions(suggestions: readonly PermissionUpdateLike[]): PermissionUpdateLike[] {
  const seen = new Set<string>(), out: PermissionUpdateLike[] = [];
  for (const u of suggestions) {
    const type = asString(u.type);
    const key = type === "addRules"
      ? `addRules|${asArray(u.rules).map((r) => asString((r as Record<string, unknown>)?.toolName)).join(",")}|${asString(u.behavior)}|${asString(u.destination)}`
      : type === "addDirectories" ? `addDirectories|${asString(u.destination)}` : JSON.stringify(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

export interface FileDecisionContext {
  text?: string;
  suggestions?: readonly PermissionUpdateLike[];
  claudeScope: ClaudeScope | null;
  operationType: FileOperation;
  inDirectory: boolean;
  searchDir: string;
}

/** `vem` L505840-854. `accept-once` upstream carries `updatedInput: t.input` — the input UNCHANGED, since
 *  this dialog has no edit affordance; ours omits it for `bashDecision`'s reason (`allow_once.updatedInput`
 *  is a FULL REPLACEMENT on the SDK side, so an unchanged copy buys nothing and risks everything). */
export function fileDecision(value: string, ctx: FileDecisionContext): PermissionDecision {
  const text = (ctx.text ?? "").trim();
  switch (value) {
    case "yes-claude-folder": {
      const ruleContent = ctx.claudeScope === "global-claude-folder" ? GLOBAL_CLAUDE_RULE : PROJECT_CLAUDE_RULE;
      return { kind: "allow_with_updates", updatedPermissions: [{ type: "addRules", rules: [{ toolName: EDIT, ruleContent }], behavior: "allow", destination: "session" }] };
    }
    case "yes-session": {
      const suggested = pickSuggestions(ctx.suggestions ?? []);
      const updates = suggested.length > 0 ? suggested : constructedUpdates(ctx);
      return updates.length > 0 ? { kind: "allow_with_updates", updatedPermissions: updates } : { kind: "allow_once" };
    }
    case "no":
      return text ? { kind: "deny", feedback: text } : { kind: "deny" };
    default:
      return { kind: "allow_once" };
  }
}
