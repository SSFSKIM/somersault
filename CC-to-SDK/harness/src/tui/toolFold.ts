// tui/src/toolFold.ts — F1 Task 5b: the PURE model behind 2.1.220's default folded transcript row. Upstream's
// default view does not render one `⏺ Read(a.ts)` per call — it collapses each CONTIGUOUS run of read/search/list/MCP
// calls into a single dim summary (`  Read 2 files (ctrl+o to expand)`); our committed per-call render is upstream's
// ctrl+o verbose form. Three pieces, no React and no I/O so both can be pinned by plain unit tests:
//   1. `classifyToolEvent` — upstream `VFt` (L301895) reduced to the reachable subset, with Bash routed through a port
//      of `Kr_` (L306129) over a port of the tree-sitter statement split `OE` (L359726).
//   2. `segmentRuns` — upstream `PMd` (L302172): one open accumulator, flushed by prose/standalone tools, never by
//      errors, thinking or system chatter; neutral items are buffered and replayed AFTER the group they interrupted.
//   3. `foldClauses` — upstream `Ima`'s clause chain (L427976): the sentence, with the bold count spans kept as
//      RANGES rather than markup so Task 5c owns every styling decision.
// `ds()` is fixed false (R2.1), so the fullscreen-only clauses — shell commands, git ops, agents, edits, REPL — are
// unreachable here and deliberately absent (R1.6, R1.7, R2.2).
import { displayPath } from "./toolRenderer.js";
import type { ToolEvent } from "./transcriptModel.js";

/** Upstream `jr_`/`Wr_`/`qr_`/`Vr_` verbatim (L306395). `Vr_` decides nothing: a command of only ignored words is
 *  not a read at all, so `Bash("echo hi")` renders standalone. */
const BASH_SEARCH = new Set(["find", "grep", "rg", "ag", "ack", "locate", "which", "whereis"]);
const BASH_READ = new Set(["cat", "head", "tail", "less", "more", "wc", "stat", "file", "strings", "jq", "awk", "cut", "sort", "uniq", "tr"]);
const BASH_LIST = new Set(["ls", "tree", "du"]);
const BASH_IGNORED = new Set(["echo", "printf", "true", "false", ":"]);
/** `Tke` (L360129) — upstream refuses to parse past this and treats the whole command as one statement. */
const PARSE_LIMIT = 10000;
/** `wMd` (L302645) — command-hint truncation, ellipsis INCLUDED (upstream slices at `wMd - 1`). */
const HINT_LIMIT = 300;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const stringField = (input: unknown, key: string): string | undefined => { const v = isRecord(input) ? input[key] : undefined; return typeof v === "string" ? v : undefined; };

/** Heredoc delimiter after a `<<`/`<<-` operator at `i`: the raw source to keep in the statement text plus the
 *  UNQUOTED terminator word, since `<<'EOF'`, `<<"EOF"` and `<<\EOF` all terminate on a bare `EOF`. `undefined` when
 *  no word follows (a bare `<<` is then left as ordinary text). */
function heredocDelimiter(command: string, i: number): { raw: string; delimiter: string; next: number } | undefined {
  let j = i, raw = "", delimiter = "";
  while (j < command.length && (command[j] === " " || command[j] === "\t")) { raw += command[j]!; j++; }
  while (j < command.length) {
    const ch = command[j]!;
    if (ch === "'" || ch === '"') {
      raw += ch; j++;
      while (j < command.length && command[j] !== ch) { delimiter += command[j]!; raw += command[j]!; j++; }
      if (j < command.length) { raw += ch; j++; }
      continue;
    }
    if (/[\s;&|<>()`]/.test(ch)) break;
    if (ch === "\\" && j + 1 < command.length) { raw += ch + command[j + 1]!; delimiter += command[j + 1]!; j += 2; continue; }
    delimiter += ch; raw += ch; j++;
  }
  return delimiter === "" ? undefined : { raw, delimiter, next: j };
}
/** Consume one heredoc body from `i` (a line start): every line up to and INCLUDING the terminator line, which
 *  `<<-` may indent with tabs. An unterminated body eats the rest of the command. */
function skipHeredocBody(command: string, i: number, delimiter: string, stripTabs: boolean): number {
  let j = i;
  while (j < command.length) {
    const nl = command.indexOf("\n", j), end = nl === -1 ? command.length : nl;
    const line = command.slice(j, end), candidate = stripTabs ? line.replace(/^\t+/, "") : line;
    j = nl === -1 ? end : nl + 1;
    if (candidate === delimiter) break;
  }
  return j;
}

/** Port of upstream `OE` (L359726) without a bash grammar. `OE` walks the tree-sitter parse, descends through
 *  `program`/`list`/`pipeline`, drops the operator tokens `&& || | ; & |&` + newline and comments, and pushes every
 *  other node's text whole — so a subshell, an `if`, a `for` all arrive as ONE statement whose head word is `(ls;`
 *  / `if` / `for` and therefore poisons the command. Splitting on those same operators at depth zero, with quotes,
 *  `$( )`, backticks and braces opaque, reproduces that list for every command whose classification can differ.
 *  Heredocs are the one place a raw depth-zero newline is NOT a separator: `OE` keeps only the non-`*_redirect`
 *  children of a `redirected_statement` (L359737–359741), so the whole `heredoc_redirect` — body and terminator —
 *  never becomes a statement and `cat <<EOF … EOF` classifies as plain `cat`. We reproduce that by queueing every
 *  `<<`/`<<-` delimiter seen on a line (bash order) and skipping their bodies when that line ends. `<<<` is a
 *  herestring, not a redirect of this shape, and stays ordinary text. */
function splitStatements(command: string): string[] {
  if (!command) return [];
  if (command.length > PARSE_LIMIT) return [command];
  const out: string[] = []; const heredocs: { delimiter: string; stripTabs: boolean }[] = [];
  let buf = "", quote: string | undefined, depth = 0, i = 0;
  const flush = () => { const statement = buf.trim(); if (statement !== "") out.push(statement); buf = ""; };
  while (i < command.length) {
    const ch = command[i]!;
    if (quote !== undefined) {
      if (ch === "\\" && quote !== "'" && i + 1 < command.length) { buf += ch + command[i + 1]!; i += 2; continue; }
      buf += ch; if (ch === quote) quote = undefined; i++; continue;
    }
    if (ch === "\\" && i + 1 < command.length) { buf += ch + command[i + 1]!; i += 2; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; buf += ch; i++; continue; }
    if (ch === "(" || ch === "{") { depth++; buf += ch; i++; continue; }
    if (ch === ")" || ch === "}") { if (depth > 0) depth--; buf += ch; i++; continue; }
    if (depth > 0) { buf += ch; i++; continue; }
    if (ch === "#" && (buf === "" || /\s$/.test(buf))) { while (i < command.length && command[i] !== "\n") i++; continue; }
    if (ch === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      const stripTabs = command[i + 2] === "-", operator = stripTabs ? "<<-" : "<<", word = heredocDelimiter(command, i + operator.length);
      if (word !== undefined) { heredocs.push({ delimiter: word.delimiter, stripTabs }); buf += operator + word.raw; i = word.next; continue; }
    }
    if (ch === "\n" || ch === ";") {
      flush(); i++;
      if (ch === "\n") for (const heredoc of heredocs.splice(0)) i = skipHeredocBody(command, i, heredoc.delimiter, heredoc.stripTabs);
      continue;
    }
    if (ch === "&" || ch === "|") { flush(); i += command[i + 1] === ch || (ch === "|" && command[i + 1] === "&") ? 2 : 1; continue; }
    buf += ch; i++;
  }
  flush(); return out;
}

/** Port of upstream `Kr_` (L306129–306152) verbatim: head word of every statement, ignored words skipped, ANY word
 *  outside the three sets returns all-false for the WHOLE command, and a command of only ignored words is all-false
 *  too (`i` never set). Several flags can be true at once — `ls | wc -l` is both list and read. */
function classifyBashCommand(command: string): { isSearch: boolean; isRead: boolean; isList: boolean } {
  const none = { isSearch: false, isRead: false, isList: false }, statements = splitStatements(command);
  if (statements.length === 0) return none;
  let isSearch = false, isRead = false, isList = false, sawDeciding = false;
  for (const statement of statements) {
    const head = statement.trim().split(/\s+/)[0];
    if (head === undefined || head === "" || BASH_IGNORED.has(head)) continue;
    sawDeciding = true;
    const search = BASH_SEARCH.has(head), read = BASH_READ.has(head), list = BASH_LIST.has(head);
    if (!search && !read && !list) return none;
    if (search) isSearch = true; if (read) isRead = true; if (list) isList = true;
  }
  return sawDeciding ? { isSearch, isRead, isList } : none;
}

export type FoldClass = { collapsible: false } | { collapsible: true; kind: "read" | "search" | "list" | "mcp" };

/** Upstream `VFt` (L301895–301913) restricted to what the default view can reach. First match wins; the `kind`
 *  collapses `VFt`'s independent flags in `PMd`'s branch order (list, then search, then read — L302223–302238), which
 *  is what decides the counter a multi-kind Bash command lands in. Everything without an `isSearchOrReadCommand`
 *  implementation — Edit, Write, NotebookEdit, Agent, Task, anything unknown — falls out at case 6 and stands alone
 *  (R1.1). Non-read Bash needs `ds()`, which is false (R1.3/R2.1), so it stands alone too. */
export function classifyToolEvent(event: Pick<ToolEvent, "name" | "input">): FoldClass {
  if (event.name.startsWith("mcp__")) return { collapsible: true, kind: "mcp" };
  if (event.name === "Glob" || event.name === "Grep") return { collapsible: true, kind: "search" };
  if (event.name === "Read") return { collapsible: true, kind: "read" };
  if (event.name !== "Bash") return { collapsible: false };
  const { isSearch, isRead, isList } = classifyBashCommand(stringField(event.input, "command") ?? "");
  if (isList) return { collapsible: true, kind: "list" };
  if (isSearch) return { collapsible: true, kind: "search" };
  return isRead ? { collapsible: true, kind: "read" } : { collapsible: false };
}

/** Upstream `KFs` (L301889–301894): `"$ "` + each line whitespace-collapsed, blank lines dropped, truncated so the
 *  ellipsis lands INSIDE the 300-char budget. */
const commandHint = (command: string): string => {
  const text = "$ " + command.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line !== "").join("\n");
  return text.length > HINT_LIMIT ? text.slice(0, HINT_LIMIT - 1) + "…" : text;
};
/** Upstream `ra` (L107033–107039) with no options — the only duration formatter the fold row uses (R4.9). */
function formatDuration(ms: number): string {
  if (ms < 60000) return ms === 0 ? "0s" : ms < 1 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 1000)}s`;
  let days = Math.floor(ms / 86400000), hours = Math.floor((ms % 86400000) / 3600000), minutes = Math.floor((ms % 3600000) / 60000), seconds = Math.round((ms % 60000) / 1000);
  if (seconds === 60) { seconds = 0; minutes++; }
  if (minutes === 60) { minutes = 0; hours++; }
  if (hours === 24) { hours = 0; days++; }
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export type FoldAtom = { kind: "tool"; event: ToolEvent } | { kind: "breaker"; sequence: number } | { kind: "neutral"; sequence: number };
export type GroupCounts = { readCount: number; searchCount: number; listCount: number; mcpCallCount: number; mcpServerNames: readonly string[]; thoughtForMs?: number };
export interface FoldGroup { counts: GroupCounts; hint?: string; memberIds: readonly string[]; anchorSequence: number; open: boolean }
export type FoldItem = { kind: "group"; group: FoldGroup } | { kind: "tool"; event: ToolEvent } | { kind: "passthrough"; sequence: number };

interface RunState {
  readFilePaths: Set<string>; readOperationCount: number; searchCount: number; listCount: number;
  mcpCallCount: number; mcpServerNames: string[]; memberIds: string[]; anchorSequence: number; open: boolean; hint?: string;
}
const newRun = (): RunState => ({ readFilePaths: new Set(), readOperationCount: 0, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [], memberIds: [], anchorSequence: 0, open: false });

/** Upstream `PMd`'s accumulator branch chain (L302194–302256) for the reachable kinds. The `readCount` quirk lives in
 *  `emit`, not here: paths and operations are counted separately and only ONE of them survives (R1.5). */
function absorb(run: RunState, event: ToolEvent, kind: "read" | "search" | "list" | "mcp", options: { cwd: string; home: string }): void {
  if (run.memberIds.length === 0) run.anchorSequence = event.callSequence;
  run.memberIds.push(event.id);
  if (event.result === undefined) run.open = true;
  const command = stringField(event.input, "command");
  if (kind === "mcp") {
    run.mcpCallCount++;
    const server = event.name.split("__")[1];
    if (server !== undefined && server !== "" && !run.mcpServerNames.includes(server)) run.mcpServerNames.push(server);
    const query = stringField(event.input, "query"); if (query !== undefined) run.hint = `"${query}"`;
    return;
  }
  if (kind === "list") { run.listCount++; if (command !== undefined) run.hint = commandHint(command); return; }
  if (kind === "search") {
    run.searchCount++;
    const pattern = stringField(event.input, "pattern");
    if (pattern !== undefined) run.hint = `"${pattern}"`; else if (command !== undefined) run.hint = commandHint(command);
    return;
  }
  // read: only `input.file_path` is harvested as a path (R1.4), so a `Bash("cat x")` read is an OPERATION.
  const path = stringField(event.input, "file_path");
  if (path !== undefined) { run.readFilePaths.add(path); run.hint = displayPath(path, options.cwd, options.home); return; }
  run.readOperationCount++; if (command !== undefined) run.hint = commandHint(command);
}
const emit = (run: RunState): FoldGroup => ({
  counts: { readCount: run.readFilePaths.size > 0 ? run.readFilePaths.size : run.readOperationCount, searchCount: run.searchCount, listCount: run.listCount, mcpCallCount: run.mcpCallCount, mcpServerNames: run.mcpServerNames },
  ...(run.hint === undefined ? {} : { hint: run.hint }), memberIds: run.memberIds, anchorSequence: run.anchorSequence, open: run.open,
});

/** Upstream `PMd` (L302172–302284). `atoms` must already be in transcript order. A group is emitted at the position
 *  of its FIRST member; anything neutral that interrupted the run is replayed straight after it, exactly like
 *  upstream's deferred buffer `i` (L302273–302277). Errors are not a boundary and not a counter adjustment (R5.2). */
export function segmentRuns(atoms: readonly FoldAtom[], options: { cwd: string; home: string }): readonly FoldItem[] {
  const out: FoldItem[] = []; let run = newRun(), deferred: FoldItem[] = [];
  const flush = () => {
    if (run.memberIds.length === 0) return;
    out.push({ kind: "group", group: emit(run) }); out.push(...deferred); deferred = []; run = newRun();
  };
  for (const atom of atoms) {
    if (atom.kind === "tool") {
      const fold = classifyToolEvent(atom.event);
      if (fold.collapsible) { absorb(run, atom.event, fold.kind, options); continue; }
      flush(); out.push({ kind: "tool", event: atom.event }); continue;
    }
    if (atom.kind === "neutral") {
      (run.memberIds.length > 0 ? deferred : out).push({ kind: "passthrough", sequence: atom.sequence }); continue;
    }
    flush(); out.push({ kind: "passthrough", sequence: atom.sequence });
  }
  flush(); return out;
}

/** One clause of the summary sentence. `boldRanges` are half-open `[start, end)` offsets into `text` — the count
 *  spans upstream wraps in `<Text bold>` (§3.4). Task 5c joins the clauses with the literal `", "`. */
export type FoldClause = { text: string; boldRanges: readonly [number, number][] };
type ClausePart = string | { bold: string };
/** Upstream's `we` helper (L427976–427981): the verb is capitalized only when it opens the sentence, and the object
 *  is always preceded by a single space. */
function clause(verb: string, first: boolean, parts: readonly ClausePart[]): FoldClause {
  let text = first ? verb[0]!.toUpperCase() + verb.slice(1) : verb;
  const boldRanges: [number, number][] = [];
  for (const part of parts) {
    if (typeof part === "string") { text += part; continue; }
    const start = text.length; text += part.bold; boldRanges.push([start, text.length]);
  }
  return { text, boldRanges };
}
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Upstream `Ima`'s clause chain (L427982–428039), restricted to the clauses a default (`ds()` false) transcript can
 *  actually produce: the thought clause, then search, read, list, mcp. The edited / scratchpad / git / frame / agent /
 *  other / shell-command / REPL / memory clauses are all either fullscreen-only or unreachable (R1.6, R1.7, R2.2) and
 *  are deliberately not built here. The thought clause is pushed DIRECTLY upstream, so it is always first and always
 *  capitalized. */
export function foldClauses(counts: GroupCounts, active: boolean): readonly FoldClause[] {
  const out: FoldClause[] = [];
  if (counts.thoughtForMs !== undefined && counts.thoughtForMs > 0)
    out.push(clause(active ? "thinking" : "thought", true, [" for ", { bold: formatDuration(Math.max(1000, counts.thoughtForMs)) }]));
  if (counts.searchCount > 0)
    out.push(clause(active ? "searching for" : "searched for", out.length === 0, [" ", { bold: String(counts.searchCount) }, " ", plural(counts.searchCount, "pattern", "patterns")]));
  if (counts.readCount > 0)
    out.push(clause(active ? "reading" : "read", out.length === 0, [" ", { bold: String(counts.readCount) }, " ", plural(counts.readCount, "file", "files")]));
  if (counts.listCount > 0)
    out.push(clause(active ? "listing" : "listed", out.length === 0, [" ", { bold: String(counts.listCount) }, " ", plural(counts.listCount, "directory", "directories")]));
  if (counts.mcpCallCount > 0) {
    const label = counts.mcpServerNames.map((name) => name.replace(/^claude\.ai /, "")).join(", ") || "MCP";
    const times: ClausePart[] = counts.mcpCallCount > 1 ? [" ", { bold: String(counts.mcpCallCount) }, " times"] : [];
    out.push(clause(active ? "calling" : "called", out.length === 0, [" ", label, ...times]));
  }
  return out;
}
