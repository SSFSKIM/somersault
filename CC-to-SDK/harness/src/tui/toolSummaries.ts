// tui/src/toolSummaries.ts — F3 Task 5 (LT1): the TYPED result row. Upstream's `Mya` registry (L430977–431001)
// gives most tools their own `renderToolResultMessage`, and almost every one of them is a single typed sentence
// — `Read 340 lines`, `Added 2 lines, removed 3 lines`, `Found 3 files (ctrl+o to expand)` — NOT a dump of what
// the tool returned. F1 shipped the generic raw-output body for every tool; this module is the per-tool layer
// above it, and `toolRenderer.resultBody` consults it first.
//
// THREE RULES, in force everywhere below.
//   1. SIDECAR-FIRST PER CALL, HONEST FALLBACK PER CALL (P94). A recognized, uniquely associated sidecar wins;
//      otherwise we derive from the complete retained input plus the flat result text. Sidecar presence is per
//      CALL — 132 of 148 census Reads had none — so every row that can be derived without one is.
//   2. NEVER FABRICATE A NUMBER. Where neither a sidecar nor an honest derivation exists (WebFetch byte counts,
//      WebSearch durations, a Glob with no filename list, an Edit with no patch), this returns `undefined` and
//      the caller keeps the generic body. A plausible-looking wrong number is worse than raw output.
//   3. ROUTING. The typed row is the per-call result body in BOTH projections. Collapsible tools (Read, Grep,
//      Glob, search/read/list Bash, MCP) render no per-call row in the compact projection at all — the fold row
//      owns them (F1 Task 5b/5c) — so their typed rows surface in the DETAIL projections, which are upstream's
//      ctrl+o verbose form (render contract R6.3). That is why nothing here branches on "collapsible": the fold
//      has already decided. The raw-output fold survives only where upstream itself shows raw output — Bash
//      stdout (`p2`), the verbose extras (Grep/Glob raw matches, the WebFetch body), and unknown tools.
//
// Status routing: this is consulted for `success` only. `running`/`interrupted`/`rejected` are exact upstream
// surfaces the renderer paints before it ever gets here, and `error` keeps F1's `formatGenericError` projection
// (upstream's per-tool error renderers — `File not found`, `Error editing file` — are a separate census row and
// are NOT part of this task's table).
import type { RenderLine, Segment } from "./render.js";
import type { ProjectionOptions } from "./toolRenderer.js";     // type-only: erased, so there is no import cycle
import { foldToolOutput, foldWithTruncation, withoutTrailingBlanks, type ResultProjection } from "./outputFold.js";
import { resolveExpandHint } from "./keys/hints.js";
import { callSidecar, readVariant, textLines, type NormalizedToolResult } from "./toolResult.js";
import { DIFF_BODY_INSET, diffHeader, renderDiff } from "./diffRender.js";
import { resolvePatch } from "./diffSource.js";
import { formatDuration, formatFileSize, plural } from "./format.js";
import { highlightBlock } from "./highlight.js";
import { detectLanguage } from "./hljsRuntime.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import type { ToolEvent } from "./transcriptModel.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
/** `str` with the length guard dropped: an EXPLICIT `""` is a value the wire actually carried, not an absent
 *  field. Only `writeRows` needs the distinction (F3 final review) — everywhere else an empty string and a
 *  missing one are equally unusable, which is why `str` stays the default reader. */
const anyStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
/** A row with a bold count inside it is a SEGMENT list — never a `**` literal and never a raw-SGR string: these
 *  rows are not dim, so ordinary segments carry both attributes correctly (the raw-SGR writer exists only because
 *  a bold span nested in a DIM run cannot survive Ink/chalk — F3 Task 1). */
const row = (...segments: Segment[]): RenderLine => ({ text: segments.map((s) => s.text).join(""), segments });
const bold = (text: string): Segment => ({ text, bold: true });
const plain = (text: string): Segment => ({ text });
const dim = (text: string): RenderLine => ({ text, dim: true });
const errored = (text: string): RenderLine => ({ text, color: resolveThemeColor(themeTokens().error) });
/** Upstream's `Bg` component (L421333), which resolves `app:toggleTranscript` through the keymap. F4 Task 10b
 *  makes that real: the sentence is threaded on `ProjectionOptions` from the LIVE table, and every site below
 *  reads it through `expandHintOf` so a rebind moves all of them at once. An UNBOUND chord yields `""`, and
 *  each site then drops its clause entirely — `$e` returns `null` there, and a dead chord is worse than none. */
/** Upstream `p2` (L420173), reached wherever a typed row still frames RAW output: Bash stdout and stderr, the
 *  Grep/Glob verbose match dump, the WebFetch verbose body, a TaskOutput agent result. Same three-row compact
 *  fold and same unbounded `detail-all` the generic body uses — it IS the generic body, borrowed. The dim
 *  overflow marker keeps its own styling; only the content rows take an error colour. */
const bodyRows = (text: string, options: ProjectionOptions, color?: string): readonly RenderLine[] => {
  const lines = withoutTrailingBlanks(text.split("\n"));
  const folded = foldToolOutput(lines, options.columns, { projection: options.projection, compactRows: 3, revealOneExtraWithoutMarker: true, expandHint: options.expandHint });
  return color === undefined ? folded : folded.map((line) => (line.dim === true ? line : { ...line, color }));
};
/** T-CLICKGATE Task 1 fix wave: whether `text` would STILL show a truncation marker if it were folded under
 *  the COMPACT projection — same "as-if-compact" contract `toolRenderer.resultBody` uses for its own generic
 *  fold (canon's `isItemClickable` reads the raw content, not the projection actually being painted), so an
 *  item re-projected to `detail-all` (nothing hidden there — that fold is unbounded) does not lose the bit
 *  the moment it is expanded. Only `bashRows` below calls this: it is the one typed producer whose fold is
 *  LIVE under every projection (Grep's raw match dump, the WebFetch body and TaskOutput's agent result are
 *  gated behind the real `detail-all` — see the inventory note on `summaryLines` — so compact never shows a
 *  partial body for those and there is nothing for this predicate to answer). */
const wouldFoldUnderCompact = (text: string, columns: number): boolean => {
  const lines = withoutTrailingBlanks(text.split("\n"));
  return lines.length > 0 && foldWithTruncation(lines, columns, { projection: "compact", compactRows: 3, revealOneExtraWithoutMarker: true }).hidden > 0;
};

// ── Read (upstream `dbH`, L424415–424438) ──────────────────────────────────────────────────────────────
/** Every arm bolds the NUMBER only, and the pluralization is upstream's explicit `=== 1` ternary (the notebook
 *  arm has no singular at all — `Read 1 cells` is what 2.1.220 paints, and it is reproduced, not corrected). */
function readRows(normalized: NormalizedToolResult): readonly RenderLine[] {
  const variant = readVariant(normalized);
  switch (variant?.kind) {
    case "image": return [row(plain(`Read image (${formatFileSize(variant.size)})`))];
    case "pdf": return [row(plain(`Read PDF (${formatFileSize(variant.size)})`))];
    case "parts": return [row(plain("Read "), bold(String(variant.count)), plain(` ${variant.count === 1 ? "page" : "pages"} (${formatFileSize(variant.size)})`))];
    case "notebook": return variant.cells < 1 ? [errored("No cells found in notebook")] : [row(plain("Read "), bold(String(variant.cells)), plain(" cells"))];
    case "file_unchanged": return [dim(variant.seeded ? `Already in context (${basename(variant.filePath)})` : "Unchanged since last read")];
    default: {
      // The flat-only fallback P94 decision 3 mandates: the returned text's own line count. It is the number the
      // reader can verify against what arrived, which is exactly why it is honest without a sidecar.
      const numLines = variant?.kind === "text" ? variant.numLines : normalized.outputLines.length;
      return [row(plain("Read "), bold(String(numLines)), plain(` ${plural(numLines, "line")}`))];
    }
  }
}
const basename = (path: string): string => path.split(/[\\/]/).filter((part) => part !== "").at(-1) ?? path;

// ── Edit / Write (upstream `fbn` L423885 and `lbH` L424341) ────────────────────────────────────────────
/** THE HEADER LIVES IN `diffRender.ts` NOW (F4 Task 7). `fbn` builds the header and the body in one component
 *  off ONE pair of counts, so two implementations of the sentence could drift from the diff sitting under it;
 *  this is an import, not a copy.
 *  THE BODY IS THE DIFF. F3 left this a header-only stopgap ("The real diff is F4's") because counting
 *  `old_string`/`new_string` whole is a derivation but not an honest one. Task 6's `resolvePatch` supplies the
 *  honest one — a recognized `structuredPatch` first, a locally computed and disk-anchored diff second — so the
 *  flat-only Edit that used to render NOTHING now renders a header and a visibly-approximate body.
 *  BOTH PROJECTIONS render the body. That is a bundle reading, not a convenience: `fbn`'s three early returns
 *  (previewHint L423903, `style === "condensed"` L423912, `collapsed` L423914) are the ONLY ways a diff renders
 *  without its hunks, and the live transcript's message renderer (L453729) passes no `style` prop at all, so the
 *  default path is the fall-through at L423935/423940 — `<Cr><Box column>{header}{<K3e hunks/>}</Box></Cr>`.
 *  The condensed style appears only on compacted-history and cloud-detail surfaces (L429726, L430886, L479698).
 *  `previewHint` (plan-mode paths) and `collapsed` (`aHr` = isScratchpadDisplayPath) are upstream states our wire
 *  does not carry — recorded unreachable in the parity doc, not built.
 *  Width is upstream's own body expression, `columns - 12` (L423932), which is also what leaves room for the
 *  five-column `⎿` gutter this body renders behind. */
function editRows(event: ToolEvent, options: ProjectionOptions): readonly RenderLine[] | undefined {
  const patch = resolvePatch({ input: isRecord(event.input) ? event.input : {}, sidecar: callSidecar(event) });
  if (patch === undefined) return undefined;
  // The header gates the whole row, exactly as it did in F3: a recognized patch with no `+`/`-` line at all
  // renders no sentence, and a body under no header would be a diff the rest of the clone calls unrecognized.
  const header = diffHeader(patch.added, patch.removed);
  if (header === undefined) return undefined;
  return [header, ...renderDiff(patch, options.columns - DIFF_BODY_INSET)];
}
/** Upstream `jme` (L423783) with `C8o = 10` (L423857): the create row's default (non-condensed, non-scratchpad,
 *  non-plan) form is a syntax-highlighted preview of the written content's first ten lines, then `bM({count:
 *  total - 10})`. Census 01 (L60–62) records that `bM` call WITHOUT `expandable` — so this is the one marker in
 *  the census that is the BARE `… +{N} lines`, with no `(ctrl+o to expand)` suffix. The census records no verbose
 *  variant of `jme` either (the three branches above it are the only `verbose` tests), so the cap holds in the
 *  detail projections too; that is the census's silence, not a verified expansion.
 *  Highlighting is keyed off `detectLanguage` — the filename map (Dockerfile/Makefile/…) plus the extension,
 *  both resolved through the real hljs registry (F9 T2), not the ten-language lexer's hand extension list. An
 *  extension `detectLanguage` cannot resolve renders PLAIN — the `lang !== null` gate below is what keeps it
 *  plain rather than dim. Dimming a whole file because it is `.md` would say "less important" about the only
 *  content on screen.
 *  Highlighted WHOLE, not per shown line (F9 T2): a comment opened before line 10 and closed after it would
 *  otherwise show a wrongly-plain tail, so `written`'s FULL text goes through `highlightBlock` once and the
 *  preview slices the already-highlighted lines — the same whole-block discipline `markdown.ts` uses. */
const WRITE_PREVIEW_LINES = 10;
function previewRows(written: string, filePath: string | undefined): readonly RenderLine[] {
  const lines = textLines(written);
  const lang = filePath === undefined ? null : detectLanguage(filePath);
  const highlighted = lang !== null ? highlightBlock(written, lang) : undefined;
  const shown = lines.slice(0, WRITE_PREVIEW_LINES).map((line, index): RenderLine => {
    // A BLANK line is emitted WITHOUT segments (F3 final review). `Line.tsx` renders a segmented row as one
    // `<Text>` per segment and Ink collapses an empty one, so `[{text:""}]` painted nothing at all and a
    // preview of `a\n\nb` came back two rows — no longer the file. Only the segment-LESS branch reaches
    // `l.text || " "`, which is what holds the empty row open, so a blank line must take it.
    if (line === "") return { text: "" };
    const segments = highlighted?.[index] ?? [];
    return row(...(segments.length > 0 ? segments : [plain(line)]));           // an empty line highlights to nothing
  });
  const hidden = lines.length - WRITE_PREVIEW_LINES;
  return hidden > 0 ? [...shown, dim(`… +${hidden} ${plural(hidden, "line")}`)] : shown;
}
function writeRows(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderLine[] | undefined {
  const structured = normalized.structured;
  if (structured?.type === "update") return editRows(event, options);
  // `create`: recognized sidecar content first, the complete retained input second (P94 decision 5). Upstream's
  // default create row is the preview ALONE (census 01#58–62; controller review of t6 dropped the stacked
  // `Wrote N lines` header — upstream reserves that row for the condensed/scratchpad styles this clone does not
  // model, and inventing a stacked form fails the fidelity brief). The count row survives ONLY as the honest
  // no-content fallback, where there is nothing to preview. The condensed (` to {relativePath}`), scratchpad
  // (`… (ctrl+o to expand)`) and plan-mode (`/plan to preview`) variants stay recorded as skipped.
  const input = isRecord(event.input) ? event.input : {};
  // `anyStr`, not `str` (F3 final review): an EXPLICIT `content: ""` is a KNOWN source — the file has zero
  // lines — and `str`'s length guard used to collapse it to "absent", dropping the create through to the
  // count fallback, which then counted the flat result text ("Created") and reported `Wrote 1 line` for an
  // empty file. Preview-alone semantics give a zero-line file zero preview rows, so the create renders its
  // header and NO body; the count row survives only where the content field is genuinely MISSING and there
  // is therefore nothing to preview.
  const written = anyStr(structured?.content) ?? anyStr(input.content);
  if (written === undefined) {
    const lines = normalized.outputLines.length;
    return [row(plain("Wrote "), bold(String(lines)), plain(` ${plural(lines, "line")}`))];
  }
  return [...previewRows(written, str(structured?.filePath) ?? str(input.file_path))];
}

// ── Grep / Glob (upstream `$Wo` L421481, `ola` L421541) ────────────────────────────────────────────────
/** `Found {N} {label}[ across {M} {label2}]` + the expand hint when N > 0. The pluralization is the unusual one:
 *  the label is stored PLURAL and its trailing `s` is stripped at exactly 1 (`count === 0 || count > 1`), so zero
 *  reads `Found 0 files`. Upstream bolds `{count}` TOGETHER WITH the space after it. */
function foundRow(n: number, label: string, options: ProjectionOptions, secondary?: { n: number; label: string }): RenderLine {
  const segments: Segment[] = [plain("Found "), bold(`${n} `), plain(n === 0 || n > 1 ? label : label.slice(0, -1))];
  if (secondary !== undefined) segments.push(plain(" across "), bold(`${secondary.n} `), plain(secondary.n === 0 || secondary.n > 1 ? secondary.label : secondary.label.slice(0, -1)));
  // Upstream always emits the separating space and lets the hint be `false` at zero; a trailing space is invisible
  // and would only show up as a phantom column in width math, so the space rides with the hint here.
  // COMPACT-ONLY (t5 review): only `$Wo`'s non-verbose branch (L421528) appends `Bg` — the verbose form
  // (L421505) has no hint, and `Bg` itself returns null in transcript contexts. Our detail projections ARE
  // that verbose/transcript form, so the hint would land exactly where upstream never shows it.
  const hint = resolveExpandHint(options.expandHint);
  if (n > 0 && options.projection === "compact" && hint !== "") segments.push(plain(` ${hint}`));
  return row(...segments);
}
function searchRows(event: ToolEvent, options: ProjectionOptions): readonly RenderLine[] | undefined {
  const s = callSidecar(event);
  if (s === undefined) return undefined;                                     // no honest count source ⇒ keep the raw matches
  const mode = s.mode, files = count(s.numFiles) ?? (Array.isArray(s.filenames) ? s.filenames.length : undefined);
  const head = mode === "content" ? (count(s.numLines) === undefined ? undefined : foundRow(count(s.numLines)!, "lines", options))
    : mode === "count" ? (count(s.numMatches) === undefined || files === undefined ? undefined : foundRow(count(s.numMatches)!, "matches", options, { n: files, label: "files" }))
      : files === undefined ? undefined : foundRow(files, "files", options);
  if (head === undefined) return undefined;
  // Census 01#144: the VERBOSE form keeps the same sentence and appends the raw matches indented under it. Our
  // gutter block already supplies that five-column indent, so the rows simply follow the sentence.
  const content = str(s.content) ?? (Array.isArray(s.filenames) ? s.filenames.filter((f): f is string => typeof f === "string").join("\n") : undefined);
  if (options.projection !== "detail-all" || content === undefined) return [head];
  return [head, ...bodyRows(content, options)];
}

// ── Bash (upstream `r4e`, L423453–423500) ──────────────────────────────────────────────────────────────
const SANDBOX_VIOLATIONS = /<sandbox_violations>[\s\S]*?<\/sandbox_violations>/g;
/** Upstream `T6p` verbatim: the trailer is captured off the END of the cleaned stderr and rendered as its own
 *  dim row, so a cwd reset never reads as part of the command's error output. */
const CWD_RESET = /(?:^|\n)(Shell cwd was reset to .+)$/;
/** The composite body, assembled in upstream's order: stdout, stderr, the cwd-reset trailer, the single
 *  empty-output line, the timeout suffix. `isImage` short-circuits everything — including the timeout.
 *
 *  `clickable` (T-CLICKGATE Task 1 fix wave): Bash is the one typed row whose fold is genuinely LIVE under
 *  every projection — `bodyRows` above folds stdout/stderr at whatever `options.projection` actually is, so a
 *  long compact-rendered command already shows a real `… +N lines` marker today. `wouldFoldUnderCompact`
 *  answers the SAME question `resultBody`'s generic fold does for its own truncation bit: would a COMPACT
 *  render hide rows, regardless of what is actually being painted right now. */
function bashRows(input: Record<string, unknown>, normalized: NormalizedToolResult, options: ProjectionOptions): { lines: readonly RenderLine[]; clickable: boolean } | undefined {
  const s = normalized.structured;
  if (s?.isImage === true) return { lines: [dim("[Image data detected and sent to Claude]")], clickable: false };
  // Flat-only fallback: the result content IS the combined output, and none of the sidecar's discriminants
  // (background id, expected-silence, return-code interpretation) exist — so the only honest empty-output line
  // for a blank result is `(No output)`.
  const stdout = s === undefined ? normalized.flatText : typeof s.stdout === "string" ? s.stdout : "";
  const rawStderr = s !== undefined && typeof s.stderr === "string" ? s.stderr : "";
  // Upstream `w6p` (L423441) returns stderr UNTOUCHED when no <sandbox_violations> block matched; the trim
  // rides the removal only (t5 review). A whitespace-only untouched stderr still paints nothing — bodyRows'
  // trailing-blank trim owns that — so the visible difference is confined to interior framing.
  const withoutViolations = new RegExp(SANDBOX_VIOLATIONS.source).test(rawStderr) ? rawStderr.replace(SANDBOX_VIOLATIONS, "").trim() : rawStderr;
  const reset = CWD_RESET.exec(withoutViolations)?.[1];
  const stderr = reset === undefined ? withoutViolations : withoutViolations.replace(CWD_RESET, "").trim();
  // Upstream tests `stdout === ""` because ITS stdout is the real stream; ours can be the flat result text, and
  // a result of pure whitespace folds to no rows at all (`withoutTrailingBlanks`). So emptiness is decided on
  // what would actually be PAINTED — which agrees with upstream on every non-blank output and stops a
  // whitespace-only result from rendering an empty body where upstream renders `(No output)`.
  const out = stdout === "" ? [] : bodyRows(stdout, options);
  const err = stderr === "" ? [] : bodyRows(stderr, options, resolveThemeColor(themeTokens().error));
  const rows: RenderLine[] = [...out, ...err];
  if (reset !== undefined) rows.push(dim(reset));
  if (out.length === 0 && err.length === 0 && reset === undefined)
    rows.push(dim(str(s?.backgroundTaskId) !== undefined ? "Running in the background (↓ to manage)" : str(s?.returnCodeInterpretation) ?? (s?.noOutputExpected === true ? "Done" : "(No output)")));
  // `eRe` (L416953) formats the input's timeout with `ra(ms, {hideTrailingZeros})`. The census records only the
  // rendered literal `(timeout 2m)` (01#109); the `ra` attribution is read off `eRe` itself and is unverified
  // against a live capture, which is why nothing else depends on it.
  const timeout = input.timeout;
  if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0) rows.push(dim(`(timeout ${formatDuration(timeout, { hideTrailingZeros: true })})`));
  if (rows.length === 0) return undefined;
  const clickable = wouldFoldUnderCompact(stdout, options.columns) || wouldFoldUnderCompact(stderr, options.columns);
  return { lines: rows, clickable };
}

// ── The web tools (upstream `Z3p` L421900, `r4p` L421935) ──────────────────────────────────────────────
function webFetchRows(event: ToolEvent, options: ProjectionOptions): readonly RenderLine[] | undefined {
  const s = callSidecar(event);
  const bytes = typeof s?.bytes === "number" && Number.isFinite(s.bytes) && s.bytes >= 0 ? s.bytes : undefined;
  const codeText = str(s?.codeText), code = typeof s?.code === "number" ? String(s.code) : str(s?.code);
  if (bytes === undefined || code === undefined || codeText === undefined) return undefined;   // no honest byte/status source
  const head = row(plain("Received "), bold(formatFileSize(bytes)), plain(` (${code} ${codeText})`));
  const body = str(s?.result);
  return options.projection === "detail-all" && body !== undefined ? [head, ...bodyRows(body, options)] : [head];
}
/** WebSearch formats its own duration — `Math.round(s)+"s"` at ≥1 s, else `Math.round(s*1000)+"ms"` — and does
 *  NOT go through `ra`. `hyH` counts the non-string entries of `results` (the strings are the queries). */
function webSearchRows(event: ToolEvent): readonly RenderLine[] | undefined {
  const s = callSidecar(event);
  const seconds = typeof s?.durationSeconds === "number" && Number.isFinite(s.durationSeconds) && s.durationSeconds >= 0 ? s.durationSeconds : undefined;
  const searches = count(s?.searchCount) ?? (Array.isArray(s?.results) ? s.results.filter((r) => r != null && typeof r !== "string").length : undefined);
  if (seconds === undefined || searches === undefined) return undefined;
  const duration = seconds >= 1 ? `${Math.round(seconds)}s` : `${Math.round(seconds * 1000)}ms`;
  return [row(plain(`Did ${searches} search${searches !== 1 ? "es" : ""} in ${duration}`))];
}

// ── The remaining census rows ──────────────────────────────────────────────────────────────────────────
/** Upstream `Qt` joins its children with a DIM ` · ` while the clauses themselves stay ordinary. */
function dotJoined(parts: readonly string[]): RenderLine {
  const segments: Segment[] = [];
  for (const part of parts) { if (segments.length) segments.push({ text: " · ", dim: true }); segments.push(plain(part)); }
  return row(...segments);
}
function skillRows(event: ToolEvent): readonly RenderLine[] | undefined {
  const s = callSidecar(event);
  if (s === undefined) return undefined;
  if (s.status === "forked") return [dotJoined([s.background === true ? "Running in the background" : "Done"])];
  const parts = ["Successfully loaded skill"];
  if (Array.isArray(s.allowedTools) && s.allowedTools.length > 0) parts.push(`${s.allowedTools.length} ${plural(s.allowedTools.length, "tool")} allowed`);
  const model = str(s.model);
  if (model !== undefined) parts.push(model);
  return [dotJoined(parts)];
}
/** Upstream `pyH` (L421872): at most two physical lines, then a hard 160-character clip, then a trim — and the
 *  `…` is added by the CALLER only when that clip actually removed something. */
const TASKSTOP_LINES = 2, TASKSTOP_WIDTH = 160;
/** `clickable` (bl4 fix-wave finding 2, P2): computed AS-IF COMPACT, exactly like `bashRows`' own predicate —
 *  independent of `options.verbose` — because the clip that hides text here is the SAME real, live truncation
 *  a clicked-open header must be able to reveal (`options.verbose ? command : compactClip` below shows the
 *  whole command under `detail-all`, ctrl+o's own unbounded form), not a fixed-shape sentence with nothing
 *  behind it. The doc comment on `summaryLines` below is corrected to match: TaskStop is NOT one of the
 *  fixed-shape, never-clip producers it used to list.
 */
function taskStopRows(event: ToolEvent, options: ProjectionOptions): { lines: readonly RenderLine[]; clickable: boolean } | undefined {
  const command = str(callSidecar(event)?.command);
  if (command === undefined) return undefined;
  const lines = command.split("\n");
  const compactClip = (lines.length > TASKSTOP_LINES ? lines.slice(0, TASKSTOP_LINES).join("\n") : command).slice(0, TASKSTOP_WIDTH).trim();
  // Upstream `X3p` (L421884) clips only when NOT verbose — the ctrl+o form shows the whole command (t5 review).
  const clipped = options.verbose ? command : compactClip;
  const rows = clipped.split("\n");
  return { lines: rows.map((text, i) => (i === rows.length - 1 ? row(plain(`${text}${clipped !== command ? "…" : ""} · stopped`)) : row(plain(text)))), clickable: compactClip !== command };
}
function worktreeRows(event: ToolEvent): readonly RenderLine[] | undefined {
  const s = callSidecar(event);
  if (s === undefined) return undefined;
  const branch = str(s.worktreeBranch);
  if (event.name === "EnterWorktree") {
    const head = branch === undefined ? row(plain("Switched to worktree")) : row(plain("Switched to worktree on branch "), bold(branch));
    const path = str(s.worktreePath);
    return path === undefined ? [head] : [head, dim(path)];
  }
  const action = s.action === "keep" ? "Kept worktree" : "Removed worktree";
  const head = branch === undefined ? row(plain(action)) : row(plain(`${action} (branch `), bold(branch), plain(")"));
  const cwd = str(s.originalCwd);
  return cwd === undefined ? [head] : [head, dim(`Returned to ${cwd}`)];
}
/** Census 01#216. Upstream renders this OUTSIDE the `⎿` gutter as its own bulleted block; we have one body
 *  channel per call, so the bullet rides inside it — the literals, the plan colour and the indent are exact. */
function planModeRows(options: ProjectionOptions): readonly RenderLine[] {
  const glyph: Segment = { text: options.platform === "darwin" ? "⏺" : "●", color: resolveThemeColor(themeTokens().planMode) };
  return [row(glyph, plain(" Entered plan mode")), dim("  Claude is now exploring and designing an implementation approach.")];
}
/** Census 01#196–208 (`wKp`, L430721). The `local_bash` arm is literally routed back through the Bash renderer
 *  with a synthesized core shape, which is why it reuses `bashRows` here rather than re-implementing it — and
 *  inherits its `clickable` for free. The `local_agent` and `remote_agent`/other arms below are NOT truncating
 *  producers (T-CLICKGATE Task 1 fix-wave inventory): their `bodyRows` call only ever runs when the projection
 *  ACTUALLY being painted is `detail-all` (`verbose`), and `foldToolOutput` never hides a row under
 *  `detail-all` — it is the one unbounded projection — so there is no compact-hidden state for them to expose.
 *  Compact shows a fixed one-line hint instead of a partial body; that is a binary include/exclude switch on
 *  the real projection, not a fold with a marker, and is already communicated by the hint text itself. */
function taskOutputRows(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): { lines: readonly RenderLine[]; clickable: boolean } | undefined {
  const s = callSidecar(event);
  if (s === undefined) return undefined;
  const task = isRecord(s.task) ? s.task : undefined;
  if (task === undefined) return { lines: [dim("No task output available")], clickable: false };
  const status = s.retrieval_status, description = str(task.description) ?? "", verbose = options.projection === "detail-all";
  if (task.task_type === "local_bash") {
    const synthesized = { ...normalized, structured: { stdout: str(task.output) ?? "", stderr: "", isImage: false, noOutputExpected: false, ...(str(task.error) === undefined ? {} : { returnCodeInterpretation: task.error }) } };
    return bashRows({}, synthesized, options);
  }
  if (task.task_type === "local_agent") {
    if (status === "success") {
      const result = str(task.result);
      if (!verbose) { const hint = resolveExpandHint(options.expandHint); return { lines: [dim(hint === "" ? "Read output" : `Read output ${hint}`)], clickable: false }; }
      const lines = result === undefined ? 0 : result.split("\n").length;     // upstream `au(result,"\n") + 1`
      const head = row(plain(`${description} (${lines} lines)`));
      return { lines: result === undefined ? [head] : [head, ...bodyRows(result, options)], clickable: false };
    }
    if (status === "timeout" || status === "not_ready" || task.status === "running") return { lines: [dim("Task is still running…")], clickable: false };
    return { lines: [dim("Task not ready")], clickable: false };
  }
  // `remote_agent` and every other task type share upstream's trailing branch, NBSP indent included.
  const head = row(plain(`  ${description} [${str(task.status) ?? ""}]`));
  const output = str(task.output);
  if (output === undefined) return { lines: [head], clickable: false };
  if (verbose) return { lines: [head, ...bodyRows(output, options)], clickable: false };
  const hint = resolveExpandHint(options.expandHint);
  return { lines: hint === "" ? [head] : [head, dim(`     ${hint}`)], clickable: false };
}

/** `undefined` means "no typed row — use the existing body path". The caller has already handled `running`,
 *  `interrupted` and `rejected`; `error` and `suppressed` deliberately fall through to it too.
 *
 *  `clickable` (T-CLICKGATE Task 1 fix wave, corrected by the bl4 fix-wave finding 2) is `false` for every
 *  builder here except `bashRows` and `taskStopRows` — the inventory: `readRows`/`editRows`/`writeRows`/
 *  `planModeRows` never call a fold at all (`Read N lines` etc. is the whole row); `searchRows`/`webFetchRows`/
 *  `taskOutputRows`'s `local_agent`/`remote_agent` arms gate their raw-body dump behind the REAL `detail-all`
 *  projection, where `foldToolOutput` is unbounded and never hides a row — compact shows no body for these at
 *  all (a one-line hint instead), so neither projection ever produces a compact-hidden state;
 *  `webSearchRows`/`skillRows`/`worktreeRows` are fixed-shape sentences with no fold in them anywhere.
 *  `bashRows` (and `taskOutputRows`'s `local_bash` arm, which reuses it) folds stdout/stderr, and
 *  `taskStopRows` clips its command to two lines/160 chars, BOTH under the projection ACTUALLY being
 *  rendered — so both are typed producers that can show a real, live truncation marker in compact, and both
 *  need the as-if-compact predicate threaded up to the mint site in `toolRenderer.resultBody`. (Finding 2:
 *  `taskStopRows` used to be wrapped in `notClickable` below despite clipping exactly like `bashRows` does —
 *  the old doc paragraph here listed it among the fixed-shape sentences in error.) */
export function summaryLines(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): { lines: readonly RenderLine[]; clickable: boolean } | undefined {
  if (normalized.status !== "success") return undefined;
  const input = isRecord(event.input) ? event.input : {};
  const notClickable = (lines: readonly RenderLine[] | undefined): { lines: readonly RenderLine[]; clickable: boolean } | undefined =>
    lines === undefined ? undefined : { lines, clickable: false };
  switch (normalized.tool) {
    case "Read": return { lines: readRows(normalized), clickable: false };
    case "Edit": return notClickable(editRows(event, options));
    case "Write": return notClickable(writeRows(event, normalized, options));
    case "Grep": case "Glob": return notClickable(searchRows(event, options));
    case "Bash": return bashRows(input, normalized, options);
    case "WebFetch": return notClickable(webFetchRows(event, options));
    case "WebSearch": return notClickable(webSearchRows(event));
    case "Skill": return notClickable(skillRows(event));
    case "TaskStop": return taskStopRows(event, options);
    case "EnterPlanMode": return { lines: planModeRows(options), clickable: false };
    case "EnterWorktree": case "ExitWorktree": return notClickable(worktreeRows(event));
    case "TaskOutput": return taskOutputRows(event, normalized, options);
    default: return undefined;                                               // unknown tools keep the generic row (P94 decision 9)
  }
}
