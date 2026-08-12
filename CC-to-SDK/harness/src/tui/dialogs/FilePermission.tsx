// tui/dialogs/FilePermission.tsx — the FILE permission dialog (F6 T7), the highest-traffic body in the
// product: every Edit, Write, NotebookEdit, Read, Glob and Grep consult lands here, and so does a Bash
// command that parses as an in-place `sed` (T4's router). Transcribed from 2.1.220's `Cem` (L505875-914):
// the `Ed` frame with `innerPaddingX: 0`, the symlink warning in the `warning` role, the descriptor's own
// body, the `Tem` question, the `tal` option list inside a `Select`, and the shared `ConsultFooter` (T4).
//
// Everything pure lives in `fileOptions.ts`; this file is the wiring, and it repeats `BashPermission.tsx`'s
// key contract verbatim (digits to the Select · `y`/`n` deregistered while a text row has the cursor ·
// Enter/Escape to the inner `SelectDecision` scope · the legacy letters on `onUnhandledKey`, mapped by the
// shared `dialogKeys.ts`). THE SELECT
// MOUNTS INSIDE THIS COMPONENT, not beside it: the registry ranks scopes by MOUNT ORDER, so a sibling mount
// would put `Confirmation` above `SelectDecision` and silently invert Enter and Escape.
//
// ONE THING THIS DIALOG HAS THAT BASH DOES NOT — `confirm:cycleMode`. `tal` writes the live `chat:cycleMode`
// chord INTO two of its four session-row labels (L505626), so the label is only truthful if the chord it
// names actually does that. Upstream binds it in `Confirmation` (L505895) and we now do too (bindings.ts);
// with T5's active-gating the composer's `Chat` scope is off the stack while a dialog owns the keyboard, so
// nothing competes for it.
//
// Recorded, not built: the IDE arm of the title (`Opened changes in <IDE>`, L505914 — a claude.ai/editor
// surface); `showingDiffInIDE`'s `Save file to continue…` row; upstream's `hintNode` feedback hint; the
// remote-workspace arms of `UMy` (three of Write's four titles); and `decisionReason` — the file dialog is
// the ONE consent surface upstream does not print it on (`Cem` has no `yN` call), so neither do we.
import React, { useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import { homedir } from "node:os";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DialogFrame } from "./DialogFrame.js";
import { ConsultFooter } from "./ConsultFooter.js";
import { Select } from "../select/Select.js";
import { legacyKeyDecision } from "./dialogKeys.js";
import { Line } from "../Line.js";
import { renderDiff } from "../diffRender.js";
import { resolvePatch } from "../diffSource.js";
import { KNOWN_LANGS, highlightCode } from "../highlight.js";
import { collapseOnFocusChange, escapeFeedbackMode, isAmendableRow, toggleFeedbackMode, NO_FEEDBACK, type FeedbackMode } from "./optionRows.js";
import { bodyWindow, MoreRow, paintedRows } from "./rowBudget.js";
import { useBindingLookup, useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import { formatBindingLower } from "../keys/hints.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "../theme.js";
import { DASHED_BORDER } from "../boxStyles.js";
import type { RenderLine } from "../render.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";
import type { SedEdit } from "./sedEdit.js";
import {
  claudeFolderScope, fileDecision, fileDescriptor, fileOptions, isInWorkingDirectory, searchDirectory,
  sedDescriptor, symlinkWarning, THIS_DIRECTORY, type FileContent, type FileDescriptor, type FileFs, type FileQuestion,
} from "./fileOptions.js";

/** The real disk, behind `fileOptions`'s injected shape. Every call is defensive: a dialog must render for a
 *  path that does not exist (a Write CREATE is exactly that) and for one it may not stat. */
export const nodeFileFs: FileFs = {
  readFile: (path) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } },
  isDirectory: (path) => { try { return lstatSync(path).isDirectory(); } catch { return false; } },
  realPath: (path) => { try { const real = realpathSync(path); return real === path ? undefined : real; } catch { return undefined; } },
};

/** The slice of a `PermissionRequest` this body reads. Structural, so a parked decision satisfies it as-is. */
export interface FilePermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  subagentType?: string;
  suggestions?: PermissionUpdateLike[];
}

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);
const extensionOf = (path: string): string => { const name = basename(path), dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""; };

// ── THE BUDGET INVERSION (FSW T13b) ───────────────────────────────────────────────────────────────────
// This dialog is dock-pinned in the fullscreen renderer and the dock is a CAPPED band, so a body taller than
// the band does not scroll — it pushes the question, the option list and the `esc cancel` row off the bottom
// of the frame, where nothing can reach them. Under a budget the chrome is therefore reserved and the BODY is
// what gives way: it windows to whatever is left and names the rows it withheld, in a marker that rides
// INSIDE the window (put after the content, the marker would be the first row the clip took). Absent budget —
// every classic mount, and every existing test — nothing here runs and the whole body prints as it always did.
//   THE BUDGET IS PAID IN PAINTED ROWS (review C1). Every arm hands its body a WIDTH as well as a budget and
// pre-wraps to it — `renderDiff` always did, which is the only reason the diff arms were honest, and
// `rowBudget.paintedRows` is that same wrap for the arms that print raw text.
/** Rows this dialog spends before a single body line prints: the frame's `marginTop`, its rule, its title, the
 *  subtitle when there is one, the symlink warning and its margin, the question, one row per option, and the
 *  footer's margin plus its hint row. Derived from what is actually rendered below, not from a constant, so
 *  an option arm added later cannot silently desynchronise the reservation from the list on screen.
 *  APPROXIMATE IN ONE DIRECTION, recorded: a question or an option label that WRAPS at a narrow width costs a
 *  row this count does not know about, and the frame clips it. */
export function fileChromeRows({ subtitle, warning, options }: { subtitle: boolean; warning: boolean; options: number }): number {
  return 1 + 1 + 1 + (subtitle ? 1 : 0) + (warning ? 2 : 0) + 1 + options + 2;
}
/** Re-exported where it was first written, because it is this dialog's contract as much as the shared
 *  module's — the window and the wrap now live in `rowBudget.tsx`, which the bash and generic bodies read too. */
export { bodyWindow } from "./rowBudget.js";
/** `EM` — a syntax-highlighted block of the whole file, NOT the transcript's ten-line preview: this is the
 *  content the human is being asked to approve, so nothing is elided — up to the row budget, which elides the
 *  tail and says so. Unknown extensions render plain (the `known` gate `toolSummaries.previewRows` uses, for
 *  its reason: dimming a `.md` file says "less important" about the only content on screen).
 *    UNDER A BUDGET THE LINES ARE WRAPPED TO `width` FIRST (review C1), so a row of the window is a row of the
 *  frame and the marker's count is truthful. Unbudgeted the block is handed to Ink whole and Ink does the
 *  wrap, exactly as it always did — the classic mount is untouched, including the highlighter's view of a
 *  line as one unbroken string. */
function CodeBlock({ code, filePath, width, budget }: { code: string; filePath: string; width: number; budget?: number }) {
  const lang = extensionOf(filePath), known = KNOWN_LANGS.has(lang);
  const all = budget === undefined ? code.split("\n") : paintedRows(code, width);
  const { keep, hidden } = bodyWindow(all.length, budget);
  return (
    <Box flexDirection="column">
      {all.slice(0, keep).map((text, index) => {
        const segments = known ? highlightCode(text, lang) : [];
        return <Line key={index} l={segments.length > 0 ? { text, segments } : { text }} />;
      })}
      {hidden > 0 ? <MoreRow hidden={hidden} /> : null}
    </Box>
  );
}

const DiffRows = ({ rows, budget }: { rows: readonly RenderLine[]; budget?: number }) => {
  const { keep, hidden } = bodyWindow(rows.length, budget);
  return (
    <Box flexDirection="column">
      {rows.slice(0, keep).map((l, index) => <Line key={index} l={l} />)}
      {hidden > 0 ? <MoreRow hidden={hidden} /> : null}
    </Box>
  );
};

/** `wem` L505860-881, arm by arm. The two diff arms go through F4's OWN pipeline — `resolvePatch` (the patch
 *  ladder) then `renderDiff` (the numbered gutter, the banded rows, the word diff) — so a diff in this dialog
 *  and the same diff in the transcript are the same glyphs by construction, not by a second implementation.
 *  ONE DIVERGENCE, recorded: upstream reads the FILE and applies the edits (`BZf` L505556), so its Edit diff
 *  carries surrounding context lines; ours diffs `old_string` against `new_string`, which is rung 2 of the
 *  ladder and shows the changed span alone. The line NUMBERS are still real whenever the snippet anchors on
 *  disk exactly once, and visibly approximate (`~`) when it does not — that ladder is the whole point. */
function FileBody({ content, columns, fs, cwd, budget }: { content: FileContent; columns: number; fs: FileFs; cwd: string; budget?: number }) {
  // Synthetic inputs are memoized because `resolvePatch` caches on the input OBJECT's identity (a WeakMap):
  // a fresh literal every render would re-run jsdiff and a synchronous `readFileSync` on every keystroke.
  //
  // The path is RESOLVED against the session cwd before it goes in. `resolvePatch`'s rung 2 uses `file_path`
  // as the anchor to read, and the tool's own input may be relative — while the session's cwd is not
  // necessarily this process's (a daemon session runs in its own worktree). Handing the raw field over would
  // read the wrong file, or none, and silently degrade a perfectly anchorable diff to `~`-numbering.
  const patch = useMemo(() => {
    if (content.kind === "file-edit-diff") {
      const edit = content.edits[0];
      if (edit === undefined) return undefined;
      return resolvePatch({ input: { file_path: resolve(cwd, content.filePath), old_string: edit.old_string, new_string: edit.new_string }, readFile: fs.readFile });
    }
    if (content.kind === "file-write-diff" && content.fileExists) {
      return resolvePatch({ input: { file_path: resolve(cwd, content.filePath), old_string: content.oldContent, new_string: content.content }, readFile: fs.readFile });
    }
    if (content.kind === "notebook-edit-diff" && content.notebookRead && content.editMode === "replace") {
      return resolvePatch({ input: { file_path: resolve(cwd, content.notebookPath), old_string: content.oldSource, new_string: content.newSource }, readFile: fs.readFile });
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, fs, cwd]);

  switch (content.kind) {
    case "file-edit-diff":
      // `Qsl` L505548: `SM paddingX: 0`, width = the full column budget. RECORDED GAP: that `SM` is the same
      // dashed-rule box the write arm below now paints, and this arm does not yet paint it — t17 scoped
      // itself to `ial`. `test/tui/file-permission.test.tsx` pins the absence, so closing it is a visible edit.
      return patch === undefined ? null : <DiffRows rows={renderDiff(patch, columns)} budget={budget} />;
    case "file-write-diff":
      // `ial` L505666-696: `SM paddingX: 1` (call site L505692), width `columns - 2`; a file that does not exist yet has no diff
      // to show, so its CONTENT is the body — and an empty one says so rather than rendering a blank block.
      //
      // `SM` (L424994-425003) is the DASHED-RULE box, and `ial` wraps its WHOLE body in it — the overwrite
      // diff and the create code block alike, which is why the box is out here and not around one arm. It is
      // what tells a reader where the proposed content starts and stops: the create arm has no `+`/`-` gutter
      // and no line numbers (`EM` at its default `startLine:1` renders no gutter, L423766-769) to do that job.
      // The numbered variant belongs to `lre` (L420073), the overwrite arm's row renderer, and is F4's already.
      // ONE FIELD IS NOT TRANSCRIBED, the same gap PlanDialog's plan body records: `SM` drops the style
      // entirely under a screen reader (`const hGp = Ea() ? void 0 : "dashed"`, L424996, `Ea()` being Ink's
      // `isScreenReaderEnabled` context, L182559), so upstream paints NO border there. We paint
      // unconditionally — stock Ink 5 has no such context and this repo has no screen-reader surface to read
      // it off, the same class of gap DialogFrame.tsx records for `srPrefix`.
      {
        // T13b: the two dashed rules are this arm's own chrome and cost two of the budget's rows — so the
        // content is windowed against `budget − 2`, and a budget with no room for the box at all drops the
        // box rather than the content it exists to delimit.
        const boxed = budget === undefined || budget >= 3;
        const inner = budget === undefined ? undefined : Math.max(0, budget - (boxed ? 2 : 0));
        // `paddingX: 1` on either variant of the box, and the dashed rule has no verticals, so the content
        // gets `columns − 2` — the width the diff has always been rendered at, now also the width the create
        // arm's code block is WRAPPED at before it is windowed.
        const rows = patch !== undefined
          ? <DiffRows rows={renderDiff(patch, columns - 2)} budget={inner} />
          : <CodeBlock code={content.content || "(No content)"} filePath={content.filePath} width={columns - 2} budget={inner} />;
        return boxed
          ? (
            <Box flexDirection="column" borderStyle={DASHED_BORDER} borderColor={role("subtle")}
              borderLeft={false} borderRight={false} overflow="hidden" paddingX={1}>{rows}</Box>
          )
          : <Box flexDirection="column" paddingX={1}>{rows}</Box>;
      }
    case "notebook-edit-diff": {
      // `fal` L505779-505816: a bold path, a dim mode line, then the cell — the OLD source for a delete, the
      // NEW source for an insert, and a diff of the two for a replace (falling back to the new source when
      // the notebook could not be read). Markdown cells highlight as markdown regardless of the `.ipynb`.
      const label = content.editMode === "insert" ? "Insert new cell" : content.editMode === "delete" ? "Delete cell" : "Replace cell contents";
      const cellPath = content.cellType === "markdown" ? "cell.md" : content.notebookPath;
      // T13b: the path row, the mode row and the margin under them are this arm's chrome (three rows).
      // THE CELL'S WIDTH IS `columns − 4`, not `columns − 2` (review C1): the outer `paddingX: 1` and the
      // inner `paddingLeft: 2` both bite. Rendered at `columns − 2` every diff row was two columns too wide
      // for the box that holds it, so Ink wrapped EVERY one of them — the arm cost twice the rows it counted.
      const cell = budget === undefined ? undefined : Math.max(0, budget - 3);
      const cellWidth = columns - 4;
      return (
        <Box flexDirection="column" paddingX={1}>
          <Box flexDirection="column" paddingBottom={1}>
            <Text bold>{content.notebookPath}</Text>
            <Text dimColor>{label} for cell {content.cellId}{content.cellType ? ` (${content.cellType})` : ""}</Text>
          </Box>
          <Box paddingLeft={2}>
            {content.editMode === "delete" ? <CodeBlock code={content.oldSource} filePath={cellPath} width={cellWidth} budget={cell} />
              : patch !== undefined ? <DiffRows rows={renderDiff(patch, cellWidth)} budget={cell} />
                : <CodeBlock code={content.newSource || "(No content)"} filePath={cellPath} width={cellWidth} budget={cell} />}
          </Box>
        </Box>
      );
    }
    case "tool-use-line": {
      // One row of text between two of padding. Under a budget with no room for all three the padding is what
      // goes — it is the only part of this arm that carries nothing. "One row" is a NARROW-PANE ASSUMPTION and
      // review C1's lesson says not to make it: a long Glob pattern at a narrow width is two rows, so under a
      // budget the line is wrapped and windowed like every other body.
      const padded = budget === undefined || budget >= 3;
      const rows = budget === undefined ? [content.text] : paintedRows(content.text, columns - 4);
      const { keep, hidden } = bodyWindow(rows.length, budget === undefined ? undefined : Math.max(0, budget - (padded ? 2 : 0)));
      return (
        <Box flexDirection="column" paddingX={2} {...(padded ? { paddingY: 1 } : {})}>
          {rows.slice(0, keep).map((text, index) => <Text key={index}>{text}</Text>)}
          {hidden > 0 ? <MoreRow hidden={hidden} /> : null}
        </Box>
      );
    }
    case "no-changes":
      return <Box paddingX={1}><Text dimColor>{content.message}</Text></Box>;
  }
}

/** `Tem` L505855-859. The bold half is the BASENAME, never the path the subtitle already printed in full. */
const Question = ({ q }: { q: FileQuestion }) => (q.kind === "plain"
  ? <Text>{q.text}</Text>
  : <Text>Do you want to {q.verbPhrase} <Text bold>{q.fileName}</Text>?</Text>);

export function FilePermission({ req, onDecision, filePath, sedEdit, cwd = process.cwd(), home = homedir(), directories, fs = nodeFileFs, columns = process.stdout.columns ?? 80, maxRows }: {
  req: FilePermissionRequest;
  onDecision: (d: PermissionDecision) => void;
  /** `Vrn`'s derived path (permissionKind.ts). Required for every route except the sed one, which carries
   *  its own inside the descriptor. */
  filePath?: string;
  /** T4's router: a Bash command that is really an in-place edit. */
  sedEdit?: SedEdit;
  /** The SESSION's working directory — see permissionKind.ts. Every path here resolves against it. */
  cwd?: string;
  home?: string;
  /** `z7`'s candidate set: the session's working directories. The cwd alone is the ordinary answer; a session
   *  with `--add-dir` grants would pass more. */
  directories?: readonly string[];
  fs?: FileFs;
  columns?: number;
  /** A HARD CEILING on the rows this dialog may compose into — the fullscreen dock band's budget (T13b).
   *  Absent means "as tall as it likes", which is every classic mount: the body prints whole. */
  maxRows?: number;
}) {
  const descriptor: FileDescriptor = useMemo(
    () => (sedEdit ? sedDescriptor(sedEdit, cwd, fs) : fileDescriptor({ toolName: req.toolName, input: req.input, filePath: filePath ?? cwd, cwd, fs })),
    [sedEdit, req.toolName, req.input, filePath, cwd, fs],
  );
  const dirs = directories ?? [cwd];
  const target = descriptor.filePath;
  const inDirectory = isInWorkingDirectory(target, dirs, cwd);
  const claudeScope = claudeFolderScope(target, cwd, home);
  const searchDir = searchDirectory(target, cwd, fs);
  const directoryName = basename(searchDir) || THIS_DIRECTORY;

  // `iP("chat:cycleMode", "Chat", "shift+tab")` L505626 — the label names a chord, so it must name the LIVE
  // one. Non-live lookup on purpose: `Chat` is off the scope stack while this dialog owns the keyboard, and
  // the question the label asks is "what is this bound to", not "what would fire here".
  const lookup = useBindingLookup();
  const cycleKeys = lookup("chat:cycleMode");
  const cycleModeChord = formatBindingLower(cycleKeys.find((k) => !k.includes(" ")) ?? cycleKeys[0]);

  const [feedback, setFeedback] = useState<FeedbackMode>(NO_FEEDBACK);
  // Mirrored off `Select`'s `onInputChange` (t5), and a REF for the same-chunk reason GenericPermission spells
  // out: `x` then `up` in one chunk must not read the field as still empty.
  const feedbackText = useRef("");
  // Wave 2 t2 (s2qa3-10): an empty Enter on the open feedback row answers nothing (t3's rule, unchanged) but
  // now SAYS so instead of folding the row shut. See GenericPermission.tsx for the full note.
  const [nudge, setNudge] = useState(false);
  const options = fileOptions({ operationType: descriptor.operationType, inDirectory, directoryName, cycleModeChord, claudeScope, feedback });
  const [focus, setFocus] = useState<string>(options[0]!.value);
  const inputFocused = options.find((o) => o.value === focus)?.type === "input";

  const decide = (value: string, text?: string) => onDecision(fileDecision(value, {
    text, suggestions: req.suggestions, claudeScope, operationType: descriptor.operationType, inDirectory, searchDir,
  }));

  useKeyScope("Confirmation");
  useKeyActions({
    ...(inputFocused ? {} : { "confirm:yes": () => decide("yes"), "confirm:no": () => decide("no") }),
    // `Cem` L505895/L505903: shift+tab takes the accept-session row DIRECTLY — the `.claude` row and the
    // session row are both `option.type === "accept-session"` upstream, so whichever of the two is showing is
    // the one it picks. Registered unconditionally, exactly as upstream does: it is a chord, never a letter,
    // so it cannot be typing even on a text row.
    "confirm:cycleMode": () => { const row = options.find((o) => o.value.startsWith("yes-")); if (row) decide(row.value); },
  });

  const warning = descriptor.symlinkTarget === undefined ? undefined : symlinkWarning(descriptor.symlinkTarget, cwd);
  // The inversion, computed once against the very list and warning this render paints.
  const bodyBudget = maxRows === undefined
    ? undefined
    : Math.max(0, maxRows - fileChromeRows({ subtitle: descriptor.subtitle !== undefined, warning: warning !== undefined, options: options.length }));
  return (
    <DialogFrame title={descriptor.title} subtitle={descriptor.subtitle} subagentType={req.subagentType} innerPaddingX={0}>
      {warning ? <Box paddingX={1} marginBottom={1}><Text color={role("warning")}>{warning}</Text></Box> : null}
      <FileBody content={descriptor.content} columns={columns} fs={fs} cwd={cwd} budget={bodyBudget} />
      <Box flexDirection="column" paddingX={1}>
        <Question q={descriptor.question} />
        <Select
          options={options} inlineDescriptions context="SelectDecision" columns={columns}
          onChange={(value, text) => decide(value, text)}
          onCancel={() => { const next = escapeFeedbackMode(feedback); if (next) setFeedback(next); else onDecision({ kind: "deny" }); }}
          // Leaving an EMPTY feedback row puts the plain row back (L505162-169); one holding text stays open.
          onFocus={(value) => { setFocus(value); setFeedback((m) => collapseOnFocusChange(m, value, feedbackText.current.trim() === "")); }}
          onInputChange={(value, text) => { setNudge(false); if (value === "no") feedbackText.current = text; }}
          onEmptySubmit={() => setNudge(true)}
          onInputModeToggle={(value) => { setNudge(false); if (isAmendableRow(value)) setFeedback(toggleFeedbackMode(feedback, value)); }}
          onUnhandledKey={(e) => { const d = legacyKeyDecision(e); if (d) onDecision(d); }}
        />
      </Box>
      <Box paddingX={1}><ConsultFooter amendable={isAmendableRow(focus)} inputMode={inputFocused} nudge={nudge && inputFocused && isAmendableRow(focus)} /></Box>
    </DialogFrame>
  );
}
