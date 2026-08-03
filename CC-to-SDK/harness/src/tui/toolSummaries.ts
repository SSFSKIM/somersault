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
import { foldToolOutput, withoutTrailingBlanks, type ResultProjection } from "./outputFold.js";
import { callSidecar, countTextLines, patchLineCounts, readVariant, type NormalizedToolResult } from "./toolResult.js";
import { formatDuration, formatFileSize, plural } from "./format.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import type { ToolEvent } from "./transcriptModel.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
/** A row with a bold count inside it is a SEGMENT list — never a `**` literal and never a raw-SGR string: these
 *  rows are not dim, so ordinary segments carry both attributes correctly (the raw-SGR writer exists only because
 *  a bold span nested in a DIM run cannot survive Ink/chalk — F3 Task 1). */
const row = (...segments: Segment[]): RenderLine => ({ text: segments.map((s) => s.text).join(""), segments });
const bold = (text: string): Segment => ({ text, bold: true });
const plain = (text: string): Segment => ({ text });
const dim = (text: string): RenderLine => ({ text, dim: true });
const errored = (text: string): RenderLine => ({ text, color: resolveThemeColor(themeTokens().error) });
/** Upstream's `Bg` component, which resolves `app:toggleTranscript` through the keymap. F1 already hard-codes the
 *  same literal in `foldToolOutput`/the group row, so it stays one constant here rather than two spellings. */
const EXPAND_HINT = "(ctrl+o to expand)";
/** Upstream `p2` (L420173), reached wherever a typed row still frames RAW output: Bash stdout and stderr, the
 *  Grep/Glob verbose match dump, the WebFetch verbose body, a TaskOutput agent result. Same three-row compact
 *  fold and same unbounded `detail-all` the generic body uses — it IS the generic body, borrowed. The dim
 *  overflow marker keeps its own styling; only the content rows take an error colour. */
const bodyRows = (text: string, options: ProjectionOptions, color?: string): readonly RenderLine[] => {
  const lines = withoutTrailingBlanks(text.split("\n"));
  const folded = foldToolOutput(lines, options.columns, { projection: options.projection, compactRows: 3, revealOneExtraWithoutMarker: true });
  return color === undefined ? folded : folded.map((line) => (line.dim === true ? line : { ...line, color }));
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
/** `Added {N} line|lines, removed {M} line|lines`. Three details that are NOT the obvious ones: a clause is
 *  emitted only when its count is positive, the separator is the literal `", "`, and the removed clause's
 *  capitalization is POSITIONAL (`gXe === 0 ? "R" : "r"`) so it reads `Removed 3 lines` standing alone. The
 *  pluralization here is `> 1`, not the ordinary pluralizer — a difference with no visible effect at these
 *  counts, kept because a future zero-add/zero-remove path would diverge. */
function diffSummaryRow(added: number, removed: number): RenderLine | undefined {
  const segments: Segment[] = [];
  if (added > 0) segments.push(plain("Added "), bold(String(added)), plain(` ${added > 1 ? "lines" : "line"}`));
  if (added > 0 && removed > 0) segments.push(plain(", "));
  if (removed > 0) segments.push(plain(`${added === 0 ? "R" : "r"}emoved `), bold(String(removed)), plain(` ${removed > 1 ? "lines" : "line"}`));
  return segments.length === 0 ? undefined : row(...segments);
}
/** No recognized patch ⇒ NO row. Counting `old_string`/`new_string` whole would be a derivation, but not an
 *  honest one: upstream diffs the file (`rte`) and reports changed lines, so a 3-line edit that touches one line
 *  would read `Added 3 lines, removed 3 lines` here. The real diff is F4's; until then the generic body stands. */
const editRows = (normalized: NormalizedToolResult): readonly RenderLine[] | undefined => {
  const counts = patchLineCounts(normalized.structured);
  const summary = counts === undefined ? undefined : diffSummaryRow(counts.added, counts.removed);
  return summary === undefined ? undefined : [summary];
};
function writeRows(event: ToolEvent, normalized: NormalizedToolResult): readonly RenderLine[] | undefined {
  const structured = normalized.structured;
  if (structured?.type === "update") return editRows(normalized);
  // `create`: recognized sidecar content first, the complete retained input second (P94 decision 5). Upstream's
  // default create row is the highlighted 10-line preview — F3 Task 6 adds it on top of this count; its
  // condensed-style (` to {relativePath}`), scratchpad (`… (ctrl+o to expand)`) and plan-mode (`/plan to
  // preview`) variants need style/scratchpad/plan state this clone does not model, and are recorded as skipped.
  const written = str(structured?.content) ?? str(isRecord(event.input) ? event.input.content : undefined);
  const lines = written === undefined ? normalized.outputLines.length : countTextLines(written);
  return [row(plain("Wrote "), bold(String(lines)), plain(` ${plural(lines, "line")}`))];
}

// ── Grep / Glob (upstream `$Wo` L421481, `ola` L421541) ────────────────────────────────────────────────
/** `Found {N} {label}[ across {M} {label2}]` + the expand hint when N > 0. The pluralization is the unusual one:
 *  the label is stored PLURAL and its trailing `s` is stripped at exactly 1 (`count === 0 || count > 1`), so zero
 *  reads `Found 0 files`. Upstream bolds `{count}` TOGETHER WITH the space after it. */
function foundRow(n: number, label: string, projection: ResultProjection, secondary?: { n: number; label: string }): RenderLine {
  const segments: Segment[] = [plain("Found "), bold(`${n} `), plain(n === 0 || n > 1 ? label : label.slice(0, -1))];
  if (secondary !== undefined) segments.push(plain(" across "), bold(`${secondary.n} `), plain(secondary.n === 0 || secondary.n > 1 ? secondary.label : secondary.label.slice(0, -1)));
  // Upstream always emits the separating space and lets the hint be `false` at zero; a trailing space is invisible
  // and would only show up as a phantom column in width math, so the space rides with the hint here.
  // COMPACT-ONLY (t5 review): only `$Wo`'s non-verbose branch (L421528) appends `Bg` — the verbose form
  // (L421505) has no hint, and `Bg` itself returns null in transcript contexts. Our detail projections ARE
  // that verbose/transcript form, so the hint would land exactly where upstream never shows it.
  if (n > 0 && projection === "compact") segments.push(plain(` ${EXPAND_HINT}`));
  return row(...segments);
}
function searchRows(event: ToolEvent, options: ProjectionOptions): readonly RenderLine[] | undefined {
  const s = callSidecar(event);
  if (s === undefined) return undefined;                                     // no honest count source ⇒ keep the raw matches
  const mode = s.mode, files = count(s.numFiles) ?? (Array.isArray(s.filenames) ? s.filenames.length : undefined);
  const head = mode === "content" ? (count(s.numLines) === undefined ? undefined : foundRow(count(s.numLines)!, "lines", options.projection))
    : mode === "count" ? (count(s.numMatches) === undefined || files === undefined ? undefined : foundRow(count(s.numMatches)!, "matches", options.projection, { n: files, label: "files" }))
      : files === undefined ? undefined : foundRow(files, "files", options.projection);
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
 *  empty-output line, the timeout suffix. `isImage` short-circuits everything — including the timeout. */
function bashRows(input: Record<string, unknown>, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderLine[] | undefined {
  const s = normalized.structured;
  if (s?.isImage === true) return [dim("[Image data detected and sent to Claude]")];
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
  return rows.length === 0 ? undefined : rows;
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
function taskStopRows(event: ToolEvent, options: ProjectionOptions): readonly RenderLine[] | undefined {
  const command = str(callSidecar(event)?.command);
  if (command === undefined) return undefined;
  // Upstream `X3p` (L421884) clips only when NOT verbose — the ctrl+o form shows the whole command (t5 review).
  const lines = command.split("\n");
  const clipped = options.verbose ? command : (lines.length > TASKSTOP_LINES ? lines.slice(0, TASKSTOP_LINES).join("\n") : command).slice(0, TASKSTOP_WIDTH).trim();
  const rows = clipped.split("\n");
  return rows.map((text, i) => (i === rows.length - 1 ? row(plain(`${text}${clipped !== command ? "…" : ""} · stopped`)) : row(plain(text))));
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
 *  with a synthesized core shape, which is why it reuses `bashRows` here rather than re-implementing it. */
function taskOutputRows(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderLine[] | undefined {
  const s = callSidecar(event);
  if (s === undefined) return undefined;
  const task = isRecord(s.task) ? s.task : undefined;
  if (task === undefined) return [dim("No task output available")];
  const status = s.retrieval_status, description = str(task.description) ?? "", verbose = options.projection === "detail-all";
  if (task.task_type === "local_bash") {
    const synthesized = { ...normalized, structured: { stdout: str(task.output) ?? "", stderr: "", isImage: false, noOutputExpected: false, ...(str(task.error) === undefined ? {} : { returnCodeInterpretation: task.error }) } };
    return bashRows({}, synthesized, options);
  }
  if (task.task_type === "local_agent") {
    if (status === "success") {
      const result = str(task.result);
      if (!verbose) return [dim(`Read output ${EXPAND_HINT}`)];
      const lines = result === undefined ? 0 : result.split("\n").length;     // upstream `au(result,"\n") + 1`
      const head = row(plain(`${description} (${lines} lines)`));
      return result === undefined ? [head] : [head, ...bodyRows(result, options)];
    }
    if (status === "timeout" || status === "not_ready" || task.status === "running") return [dim("Task is still running…")];
    return [dim("Task not ready")];
  }
  // `remote_agent` and every other task type share upstream's trailing branch, NBSP indent included.
  const head = row(plain(`  ${description} [${str(task.status) ?? ""}]`));
  const output = str(task.output);
  if (output === undefined) return [head];
  return verbose ? [head, ...bodyRows(output, options)] : [head, dim(`     ${EXPAND_HINT}`)];
}

/** `undefined` means "no typed row — use the existing body path". The caller has already handled `running`,
 *  `interrupted` and `rejected`; `error` and `suppressed` deliberately fall through to it too. */
export function summaryLines(event: ToolEvent, normalized: NormalizedToolResult, options: ProjectionOptions): readonly RenderLine[] | undefined {
  if (normalized.status !== "success") return undefined;
  const input = isRecord(event.input) ? event.input : {};
  switch (normalized.tool) {
    case "Read": return readRows(normalized);
    case "Edit": return editRows(normalized);
    case "Write": return writeRows(event, normalized);
    case "Grep": case "Glob": return searchRows(event, options);
    case "Bash": return bashRows(input, normalized, options);
    case "WebFetch": return webFetchRows(event, options);
    case "WebSearch": return webSearchRows(event);
    case "Skill": return skillRows(event);
    case "TaskStop": return taskStopRows(event, options);
    case "EnterPlanMode": return planModeRows(options);
    case "EnterWorktree": case "ExitWorktree": return worktreeRows(event);
    case "TaskOutput": return taskOutputRows(event, normalized, options);
    default: return undefined;                                               // unknown tools keep the generic row (P94 decision 9)
  }
}
