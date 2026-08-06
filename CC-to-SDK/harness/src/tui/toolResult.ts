// tui/src/toolResult.ts — F1 per-call normalizer: one retained ToolEvent (complete tool input + flat result
// content + optionally a UNIQUELY associated `tool_use_result` sidecar) → one renderable shape.
// Structured-first per call, deterministic fallback per call (P94, SDK 0.3.220): a recognized sidecar shape wins;
// otherwise we derive from the complete input plus the flat result text. Sidecar presence is per CALL — never
// infer it per tool or per session. Shape guards are deliberately narrow: an unrecognized or forwarded sidecar
// falls back and stays retained raw rather than being narrowed into a shape it does not have.
import type { ToolEvent } from "./transcriptModel.js";
import { INTERRUPT_CANCELLED } from "./species.js";

export type ToolStatus = "running" | "success" | "error" | "interrupted" | "rejected" | "suppressed";
export interface NormalizedToolResult {
  tool: string; status: ToolStatus; source: "pending" | "structured" | "fallback";
  rawContent: unknown; flatText: string; summary: string; output: string; outputLines: readonly string[]; structured?: Record<string, unknown>;
}

/** Upstream's invisible bookkeeping/deferred-lookup tools: retained in full as source, projected as nothing. */
const SUPPRESSED = new Set(["TaskCreate", "TaskUpdate", "ToolSearch"]);
/** The one home of that list, exported so the fold's atom builder can ask the same question the normalizer
 *  answers with `status: "suppressed"` — a call that renders no row must not be able to break a fold run. */
export const isSuppressedTool = (name: string): boolean => SUPPRESSED.has(name);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const lineCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;   // sidecars are unknown-typed: -1 or 1.5 must fall back, not summarize

/** Rendering-only conversion, NOT a reduction of the source: a string is preserved verbatim; recognized
 *  `{type:"text", text}` blocks join in source order with `\n`. Any other block is left alone — `rawContent`
 *  keeps it, and F1 simply shows no generic textual detail for it until a later scope owns that shape. */
export function flatText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b): b is Record<string, unknown> => isRecord(b) && b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n");
}
/** Upstream `bbn` (L424186): the newline-delimited lines of a written/returned body, minus the trailing
 *  newline's phantom row. Exported whole (not just its length) because F3 Task 6's Write preview must show
 *  EXACTLY the rows the `Wrote {N} lines` count promises — one split, so the two can never disagree. */
export const textLines = (text: string): readonly string[] => (text.length === 0 ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n"));
export const countTextLines = (text: string): number => textLines(text).length;
const countLines = (n: number): string => `${n} line${n === 1 ? "" : "s"}`;

// Narrow recognizers for the exact 0.3.220 sidecar shapes; each returns the sidecar itself so it is retained whole.
/** F3 Task 5 widens Read from "the text shape" to upstream `dbH`'s SIX result types (L424415–424438). Each arm
 *  demands exactly the fields its row spells out, so a sidecar that merely CLAIMS `type:"image"` without a numeric
 *  `originalSize` still falls back to the flat line count rather than rendering `Read image (undefined)`. The
 *  untyped arm is last and deliberate: P94's census recorded the shape but not the discriminant's value (our own
 *  fixture carries `type:"read"`), so a valid `file.numLines` is text-shaped whatever the tag says. */
const byteSize = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const readShape = (v: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(v) || !isRecord(v.file)) return undefined;
  const file = v.file;
  switch (v.type) {
    case "image": case "pdf": return byteSize(file.originalSize) ? v : undefined;
    case "parts": return lineCount(file.count) && byteSize(file.originalSize) ? v : undefined;
    case "notebook": return Array.isArray(file.cells) ? v : undefined;
    case "file_unchanged": return typeof file.filePath === "string" ? v : undefined;
    default: return lineCount(file.numLines) ? v : undefined;
  }
};
/** The recognized Read row, projected off the retained sidecar — the ONE place the six-way discrimination lives, so
 *  `toolSummaries` never re-guesses a shape the normalizer already accepted or rejected. */
export type ReadVariant =
  | { kind: "text"; numLines: number }
  | { kind: "image" | "pdf"; size: number }
  | { kind: "parts"; count: number; size: number }
  | { kind: "notebook"; cells: number }
  | { kind: "file_unchanged"; seeded: boolean; filePath: string };
export function readVariant(normalized: NormalizedToolResult): ReadVariant | undefined {
  const value = normalized.tool === "Read" ? normalized.structured : undefined;
  if (value === undefined || !isRecord(value.file)) return undefined;
  const file = value.file;
  switch (value.type) {
    case "image": case "pdf": return { kind: value.type, size: file.originalSize as number };
    case "parts": return { kind: "parts", count: file.count as number, size: file.originalSize as number };
    case "notebook": return { kind: "notebook", cells: (file.cells as unknown[]).length };
    case "file_unchanged": return { kind: "file_unchanged", seeded: value.source === "seeded", filePath: file.filePath as string };
    default: return { kind: "text", numLines: file.numLines as number };
  }
}
/** The uniquely associated call sidecar, UNNARROWED. F1's `structured` is reserved for the five shapes P94
 *  actually observed and verified (Read/Write/Edit/Bash/Agent) — `source: "structured"` means "a recognized
 *  shape", and widening it to "an object arrived" would quietly devalue that discriminant. F3's typed rows also
 *  cover tools P94's local-coding corpus never selected (Grep, Glob, WebFetch, WebSearch, Skill, TaskStop, the
 *  worktree pair, TaskOutput), whose result props are read off the 2.1.220 bundle rather than off live evidence.
 *  Those rows reach their source through here and guard it FIELD BY FIELD at the template that spells it out, so
 *  an unverified shape can only ever cost that one row (it falls back to raw output), never mislabel a number. */
export function callSidecar(event: ToolEvent): Record<string, unknown> | undefined {
  const sidecar = event.result?.sidecar;
  const value = sidecar?.scope === "call" ? sidecar.value : undefined;
  return isRecord(value) ? value : undefined;
}

/** LT14, the WIRE discriminator (P80 § A frame 1, `vld` in the bundle). `query.interrupt()` mid-tool-call
 *  emits the rejected `tool_result` as a user frame carrying this literal as a TOP-LEVEL `tool_use_result`
 *  STRING — and transcriptModel's association rule is value-agnostic, so it lands on the call as a
 *  `scope:"call"` sidecar exactly like a structured one would. That field, NOT any text in the result body, is
 *  what says "interrupted": the `[Request interrupted by user…]` sentinel rides a SEPARATE user frame (which
 *  toolRenderer suppresses), and this frame's own content is empty. */
export const USER_REJECTED_TOOL_USE = "User rejected tool use";

/** Upstream `NHH`/`FHH` (L423879–423884): the diff summary counts per-line `+`/`-` prefixes summed across hunks —
 *  NOT hunk `newLines`/`oldLines`, which include the context rows. Any hunk that is not `{lines: string[]}`
 *  rejects the WHOLE patch: half a count would read as a real number on screen. */
export function patchLineCounts(structured: Record<string, unknown> | undefined): { added: number; removed: number } | undefined {
  const hunks = structured?.structuredPatch;
  if (!Array.isArray(hunks)) return undefined;
  let added = 0, removed = 0;
  for (const hunk of hunks) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) return undefined;
    for (const line of hunk.lines) {
      if (typeof line !== "string") return undefined;
      if (line.startsWith("+")) added++; else if (line.startsWith("-")) removed++;
    }
  }
  return { added, removed };
}
/** Exported for `diffSource.ts`: the diff BODY must recognize exactly the sidecars this normalizer recognizes,
 *  or a row could carry absolute line numbers under a header that showed no diff summary at all. These two are
 *  the whole gate — `patchLineCounts` runs strictly AFTER one of them accepts, never in their place. */
export const writeShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && typeof v.filePath === "string" && typeof v.content === "string" && Array.isArray(v.structuredPatch) ? v : undefined);
export const editShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && typeof v.filePath === "string" && typeof v.oldString === "string" && typeof v.newString === "string" && Array.isArray(v.structuredPatch) ? v : undefined);
const bashShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && typeof v.stdout === "string" && typeof v.stderr === "string" && typeof v.interrupted === "boolean" && typeof v.noOutputExpected === "boolean" && typeof v.isImage === "boolean" && (v.returnCodeInterpretation === undefined || typeof v.returnCodeInterpretation === "string") ? v : undefined);
const agentShape = (v: unknown): Record<string, unknown> | undefined => (isRecord(v) && typeof v.agentId === "string" ? v : undefined);

/** Quote-aware enough to split a SIMPLE command, and deliberately fail-closed everywhere else: upstream parses a
 *  real shell AST and demands exactly one command node, so any unquoted metacharacter (a pipe, `&&`, `;`, a
 *  redirection, a subshell, an expansion, a newline) rejects the whole input here. Rejecting only ever costs us the
 *  sed swap — it can never mis-attribute a redirection target or a second operand as "the edited file". */
const UNQUOTED_META = /[|&;<>()$`\\\n\r]/;
/** The same fail-closed rule applied to the OTHER half of expansion: upstream's AST only accepts
 *  `command_name`/`word`/`string`/`raw_string`/`number`/`concatenation`, so a pathname or brace expansion is a node
 *  type it never sees and the whole swap is rejected. An UNQUOTED `*?[]{}` (or a token-initial `~`) means the shell
 *  decides what "the file" is at run time, and one operand can become many — quoted, the same bytes are a literal. */
const UNQUOTED_EXPANSION = /[*?[\]{}]/;
function simpleCommandTokens(command: string): string[] | undefined {
  const tokens: string[] = []; let token = "", open = false, fresh = true, i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === " " || ch === "\t") { if (open) { tokens.push(token); token = ""; open = false; fresh = true; } i++; continue; }
    open = true;
    if (ch === "'") { const end = command.indexOf("'", i + 1); if (end === -1) return undefined; token += command.slice(i + 1, end); i = end + 1; fresh = false; continue; }
    if (ch === '"') {
      for (i++; ; i++) {
        if (i >= command.length) return undefined;
        const inner = command[i];
        if (inner === '"') { i++; break; }
        if (inner === "$" || inner === "`") return undefined;               // still shell expansion inside double quotes
        if (inner === "\\" && i + 1 < command.length) {
          // POSIX double quotes: backslash escapes only $ ` " \ — before anything else it is a literal character,
          // so "foo\q" names foo\q (a Windows-ish path survives) while "fo\$o" names fo$o.
          const next = command[i + 1]!;
          if (next === "$" || next === "`" || next === '"' || next === "\\") { token += next; i++; } else token += inner;
          continue;
        }
        token += inner;
      }
      fresh = false; continue;
    }
    if (UNQUOTED_META.test(ch) || UNQUOTED_EXPANSION.test(ch) || (ch === "~" && fresh)) return undefined;
    token += ch; i++; fresh = false;
  }
  if (open) tokens.push(token);
  return tokens;
}
/** Upstream `c1t`: the header swaps to a file path ONLY for a proven single-file in-place substitute — one simple
 *  `sed`, in-place, at most one script and it must parse as `s/pattern/replacement/flags` with sed's own flag set,
 *  and exactly one remaining operand. A second file, a redirection, a pipe, an unknown flag or a non-substitute
 *  script all keep the clipped command, because none of them edit exactly one named file. */
export function sedInPlaceTarget(command: string, platform: string = process.platform): string | undefined {
  const tokens = simpleCommandTokens(command);
  if (!tokens || tokens[0] !== "sed") return undefined;
  const rest = tokens.slice(1);
  let inPlace = false, script: string | undefined, file: string | undefined;
  for (let i = 0; i < rest.length; ) {
    const token = rest[i];
    if (token === "-i" || token === "--in-place") {                          // an optional suffix argument: empty, or a real ".bak"
      inPlace = true; i++; const suffix = rest[i];
      if (suffix !== undefined && !suffix.startsWith("-") && (suffix === "" || suffix.startsWith("."))) i++;
      continue;
    }
    if (token.startsWith("-i")) { inPlace = true; i++; continue; }           // the attached `-i.bak` form
    if (token === "-E" || token === "-r" || token === "--regexp-extended") { i++; continue; }
    if (token === "-e" || token === "--expression") { if (script !== undefined || rest[i + 1] === undefined) return undefined; script = rest[i + 1]; i += 2; continue; }
    if (token.startsWith("--expression=")) { if (script !== undefined) return undefined; script = token.slice(13); i++; continue; }
    if (token.startsWith("-")) return undefined;
    if (script === undefined) script = token; else if (file === undefined) file = token; else return undefined;
    i++;
  }
  if (!inPlace || !script || !file || !script.startsWith("s/")) return undefined;
  const fields = ["", "", ""]; let field = 0;                                // pattern / replacement / flags, exactly three delimiters
  for (let i = 2; i < script.length; i++) {
    const ch = script[i];
    if (ch === "\\" && i + 1 < script.length) { fields[field] += ch + script[i + 1]; i++; continue; }
    if (ch === "/") { if (field === 2) return undefined; field++; continue; }
    fields[field] += ch;
  }
  if (field !== 2 || !/^[gpimIM1-9]*$/.test(fields[2])) return undefined;
  // Upstream `Kk` runs only on Windows: a `//server/share` or `\\server\share` target is a NETWORK path there,
  // and the swap must not present a network write as "the edited file". On POSIX the same bytes are a legal
  // local path and upstream accepts them.
  if (platform === "win32" && (/^[\\/]{2}/.test(file) || /\\\\[^ \t\r\n\f\v\\/]+/.test(file) || /(?<!:)\/\/[^ \t\r\n\f\v\\/]+/.test(file))) return undefined;
  return file;
}

/** LT12: the Bash header argument, read ONLY from the complete retained input so compact and detailed projections
 *  share one source and nothing smuggles a display header through `summary`. A recognized single-file in-place
 *  `sed -i` reports the file it edits rather than its script; anything else is the trimmed command, clipped
 *  (non-verbose only) to two physical lines and 160 characters including the literal final `…`. */
export function bashArgument(input: unknown, verbose: boolean): string {
  const command = isRecord(input) && typeof input.command === "string" ? input.command : "";
  if (!command) return "";
  const trimmed = command.trim();
  const edited = sedInPlaceTarget(trimmed);
  if (edited) return edited;
  if (verbose) return trimmed;
  const lines = trimmed.split("\n");
  const clipped = lines.length > 2 ? `${lines.slice(0, 2).join("\n")}…` : trimmed;
  return clipped.length > 160 ? `${clipped.slice(0, 159)}…` : clipped;
}

/** LT15: one readable line out of a generic tool failure. Purely a PROJECTION — `rawContent` (and `flatText`)
 *  keep the faithful source, so nothing here loses evidence. The `<tool_use_error>` envelope the SDK actually wraps
 *  tool failures in is unwrapped FIRST (otherwise every real failure reads as `Error: <tool_use_error>…`);
 *  sandbox-violation ranges and the `<error>` wrapper are upstream framing, not content; a non-verbose
 *  `InputValidationError` ANYWHERE in the message (upstream uses `includes`, not a prefix test — the envelope and
 *  its own framing routinely push it off the front) is the harness's own malformed-call signal and reads as such;
 *  an existing `Error: `/`Cancelled: ` prefix is left exactly as the tool wrote it. */
const TOOL_USE_ERROR = /<tool_use_error(?:\s[^>]*)?>([\s\S]*?)<\/tool_use_error>/i;
/** Upstream `L3t`, verbatim: remove any SGR sequence carrying underline-ON parameter 4 (underline-OFF 24 stays). */
const stripUnderlineSgr = (text: string): string => text.replace(/\u001b\[([0-9]+;)*4(;[0-9]+)*m|\u001b\[4(;[0-9]+)*m|\u001b\[([0-9]+;)*4m/g, "");
export function formatGenericError(content: unknown, verbose: boolean): string {
  if (typeof content !== "string") return "Tool execution failed";
  const envelope = TOOL_USE_ERROR.exec(content);                             // a MATCHED-but-empty envelope is not a no-match: falling back to
  const stripped = (envelope ? envelope[1]! : content).replace(/<sandbox_violations>[\s\S]*?<\/sandbox_violations>/g, "").replace(/<\/?error>/g, "").trim();
  if (!stripped) return "Tool execution failed";
  if (!verbose && stripped.includes("InputValidationError: ")) return "Invalid tool parameters";
  return stripped.startsWith("Error: ") || stripped.startsWith("Cancelled: ") ? stripped : `Error: ${stripped}`;
}

/** `options.verbose` is the renderer's expansion switch (Task 3), and the ONLY thing it changes here is the
 *  generic-error projection. Retention stays verbose-independent: the normalizer never truncates its own
 *  source, so collapsing stays a projection choice. */
export function normalizeToolResult(event: ToolEvent, options?: { verbose?: boolean }): NormalizedToolResult {
  const tool = event.name;
  // FIRST, ahead of the open-call check and every shape guard: the suppressed tools. They stay complete source
  // records (`flatText`/`rawContent` are faithful) and only their PROJECTION is empty — the one deliberate
  // exception to deriving `outputLines` from `flatText`. An OPEN suppressed call is `suppressed`, not `running`.
  if (SUPPRESSED.has(tool)) return { tool, status: "suppressed", source: event.result ? "fallback" : "pending", rawContent: event.result?.content, flatText: flatText(event.result?.content ?? ""), summary: tool, output: "", outputLines: [] };
  // The sole open-call shape (used by projectPending): it must never fabricate structured or flat result data.
  if (!event.result) return { tool, status: "running", source: "pending", rawContent: undefined, flatText: "", summary: tool, output: "", outputLines: [] };

  const { content, isError, sidecar } = event.result;
  const value = sidecar?.scope === "call" ? sidecar.value : undefined;       // only a uniquely associated sidecar is usable
  const flat = flatText(content), outputLines = textLines(flat), trimmed = flat.trim();
  const input = isRecord(event.input) ? event.input : {};
  // The wire field FIRST: it is the engine's own annotation, while the flat-text tests below are shapes a
  // tool happened to write. (`Interrupted` stays: a Bash killed by its own timeout reports it that way, with
  // no `tool_use_result` at all.)
  // `INTERRUPT_CANCELLED` is the one flat-text test the ENGINE writes rather than a tool: `CLo` (L298302)
  // makes it the whole content of a cancelled call's `tool_result`, and upstream's `HVo` (L429119) reads it
  // with `startsWith` — a prefix, because `Mpt` (L373032) may append a statsig-gated suffix — then paints
  // `BP`, which is the row `status: "interrupted"` already renders here. Prefix and not `includes`: a tool
  // that merely quotes the sentence inside a genuine failure is still a failure.
  let status: ToolStatus = value === USER_REJECTED_TOOL_USE ? "interrupted"
    : trimmed === "Interrupted" || trimmed.startsWith(INTERRUPT_CANCELLED) ? "interrupted" : trimmed === "Tool use rejected" ? "rejected" : isError ? "error" : "success";
  let structured: Record<string, unknown> | undefined;
  let summary = tool;                                                        // generic default; unknown tools keep exactly this
  if (tool === "Read") {
    structured = readShape(value);
    // `summary` stays the TEXT row only (F1's one-line debug/label string); the five non-text variants are rows
    // with sizes and page counts in them, and `toolSummaries.summaryLines` — not this string — is what renders them.
    const numLines = structured !== undefined && lineCount((structured.file as Record<string, unknown>).numLines) ? (structured.file as Record<string, unknown>).numLines as number : outputLines.length;
    summary = `Read ${countLines(numLines)}`;
  } else if (tool === "Write") {
    structured = writeShape(value);
    const written = structured ? String(structured.content) : typeof input.content === "string" ? input.content : undefined;
    summary = `Wrote ${countLines(written === undefined ? outputLines.length : textLines(written).length)}`;
  } else if (tool === "Edit") {
    structured = editShape(value);                                           // absolute hunk positions retained for F4; F1 emits no diff
  } else if (tool === "Bash") {
    structured = bashShape(value);
    if (structured?.interrupted === true) status = "interrupted";            // `returnCodeInterpretation` is retained as source, never read as an exit code
  } else if (tool === "Agent") {
    structured = agentShape(value);                                          // F3 owns totals; F1 stays generic
  }
  // A plain `error` is the one status whose PROJECTION is normalized: `interrupted` and `rejected` are their own
  // exact surfaces and pass through untouched, and `rawContent`/`flatText` stay faithful in every case.
  // Upstream additionally runs its underline stripper (`L3t`) over the displayed error text — underline-ON SGR
  // sequences would stack on the semantic error styling — while underline-OFF (24) survives, exactly as it does there.
  const failure = status === "error" ? stripUnderlineSgr(formatGenericError(content, options?.verbose === true)) : undefined;
  return { tool, status, source: structured ? "structured" : "fallback", rawContent: content, flatText: flat, summary, output: failure ?? outputLines.join("\n"), outputLines: failure === undefined ? outputLines : textLines(failure), ...(structured ? { structured } : {}) };
}
