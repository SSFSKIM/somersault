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
// The fullscreen predicate (`ds()` in 2.1.220, `Ns()` in 2.1.234) is no longer fixed false: it arrives as an
// explicit `fullscreen` INPUT on `classifyToolEvent`/`segmentRuns`, so this module ports both policies at once and
// stays clock- and environment-free. Absent (or false) is the frozen classic policy, byte for byte. Under
// `fullscreen` canon 2.1.234 widens the fold three ways — every non-read Bash call joins the run under its own
// `bashCount`, the task-board tools plus ToolSearch are absorbed with no counter at all, and each absorbed Bash
// command is recorded for the git scraper. WebFetch/WebSearch stay standalone in BOTH: that is canon's real policy.
// The clause chain has not caught up yet — `foldClauses` still builds only the classic sentence, so the new counts
// are carried and not yet spoken (the shell/git clauses, the REPL/agent/edit/memory clauses and their fixed order
// are a later task in this wave).
import { displayPath } from "./paths.js";
// `ra` moved to `format.ts` in F3 Task 5 so the fold row and the typed result rows share ONE port (R4.9 still
// calls it with no options here; only the Bash timeout suffix passes `hideTrailingZeros`).
import { formatDuration } from "./format.js";
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

/** Characters a delimiter word may stop on (upstream L141331–141332) and the two char classes its scan uses:
 *  `iVg` (L140471) for a bare word and `_Ie` (L140459) for the tail of a `<<\EOF`. */
const DELIMITER_END = new Set([" ", "\t", "\n", "<", ">", "|", "&", ";", "(", ")"]);
const isDelimiterChar = (ch: string): boolean => !DELIMITER_END.has(ch) && ch !== "'" && ch !== '"' && ch !== "`" && ch !== "\\";
/** Heredoc delimiter after a `<<`/`<<-` operator at `i`: the raw source to keep in the statement text plus the
 *  terminator word, since `<<'EOF'`, `<<"EOF"` and `<<\EOF` all terminate on a bare `EOF`. Upstream is NOT bash here
 *  and does no quote removal: its hand-written lexer (L141306–141337, the real `SF()` parser — 2.1.220 ships no
 *  tree-sitter) picks the scan mode from the FIRST character and takes quoted content VERBATIM, then REFUSES the
 *  whole parse (`aborted`) rather than interpret anything harder — a double-quoted delimiter holding `` ` ``, `$`,
 *  `\` or a newline (L141326), an astral code unit, or a word that stopped on a character it cannot end on
 *  (`<<E"OF"`). `"abort"` reports that refusal; `undefined` means no word followed (a bare `<<` stays ordinary
 *  text). */
function heredocDelimiter(command: string, i: number): { raw: string; delimiter: string; next: number } | "abort" | undefined {
  let j = i, raw = "", delimiter = "";
  while (j < command.length && (command[j] === " " || command[j] === "\t")) { raw += command[j]!; j++; }
  const first = command[j];
  if (first === "'" || first === '"') {
    raw += first; j++;
    while (j < command.length && command[j] !== first) { delimiter += command[j]!; raw += command[j]!; j++; }
    if (j < command.length) { raw += first; j++; }
    if (first === '"' && /[`$\\\n]/.test(delimiter)) return "abort";
  } else if (first === "\\") {
    // `<<\EOF`: the backslash quotes exactly one character, then only word characters continue the delimiter.
    raw += first; j++;
    if (j < command.length && command[j] !== "\n") { delimiter += command[j]!; raw += command[j]!; j++; }
    while (j < command.length && /[A-Za-z0-9_]/.test(command[j]!)) { delimiter += command[j]!; raw += command[j]!; j++; }
  } else while (j < command.length && isDelimiterChar(command[j]!)) { delimiter += command[j]!; raw += command[j]!; j++; }
  if (/[\uD800-\uDFFF]/.test(delimiter)) return "abort";
  if (j < command.length && !DELIMITER_END.has(command[j]!)) return "abort";
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
 *  A TRAILING redirection never reaches that list: `OE` keeps only the non-`*_redirect` children of a
 *  `redirected_statement` (L359737–359741), so `cat a 2>&1` is the single statement `cat a` upstream and the `&`/`|`
 *  buried in a redirect operator must be glued to the current statement rather than split on (see the branch below).
 *  A LEADING redirection is the opposite and is deliberately kept: upstream's parser puts it INSIDE the `command`
 *  node (`[...assignments, ...redirects, name, ...args]`, L141080), which `OE` pushes whole, so `2>/dev/null rg x`
 *  is one statement whose head word is `2>/dev/null` and the command classifies as nothing at all.
 *  A parse upstream refuses (see `heredocDelimiter`) returns null from `parse()`, and `OE` then yields the WHOLE
 *  command as a single statement (L359731–359733) — so only its very first word decides the classification.
 *  Heredocs are the one place a raw depth-zero newline is NOT a separator: by that same drop (L359737–359741)
 *  the whole `heredoc_redirect` — body and terminator —
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
      if (word === "abort") return [command];
      if (word !== undefined) { heredocs.push({ delimiter: word.delimiter, stripTabs }); buf += operator + word.raw; i = word.next; continue; }
    }
    if (ch === "\n" || ch === ";") {
      flush(); i++;
      if (ch === "\n") for (const heredoc of heredocs.splice(0)) i = skipHeredocBody(command, i, heredoc.delimiter, heredoc.stripTabs);
      continue;
    }
    // Redirect glue before the separator branches: `OE` drops every `*_redirect` child whole (L359737–359741), so an
    // `&`/`|` that is part of a redirection OPERATOR — `2>&1`, `<&3`, `>|out` (follows a `>`/`<`) or `&>`/`&>>`
    // (precedes a `>`) — never separates statements. The real `&& || | |&` and a background `&` still do.
    if ((ch === "&" || ch === "|") && (/[<>]$/.test(buf) || (ch === "&" && command[i + 1] === ">"))) { buf += ch; i++; continue; }
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

export type FoldClass =
  | { collapsible: false }
  | { collapsible: true; kind: "read" | "search" | "list" | "mcp" | "bash" }
  | { collapsible: true; kind: "silent"; popsOutOnError: boolean };
/** How the caller's renderer identity reaches the pure policy. Canon threads its own `Ns()` fullscreen predicate
 *  INTO `Krr` (2.1.234:236816); we take it as an argument instead so this module stays environment-free and the
 *  classic renderer's policy is frozen by construction — omitted (or false) is byte-identically what shipped. */
export interface FoldPolicy { fullscreen?: boolean }

/** Canon `Joi` (2.1.234:236734) — the five task-board tools, absorbed with no counter and `popsOutOnError: true`.
 *  `iE` ("ToolSearch", 2.1.234:236807) joins them under fullscreen with `popsOutOnError: false`. Canon absorbs
 *  `Joi` UNCONDITIONALLY; we gate both on fullscreen because the classic renderer is frozen at its 2.1.220
 *  behavior for this wave (a recorded divergence, spec §2). */
const SILENT_POPS_OUT = new Set(["TodoWrite", "TaskCreate", "TaskGet", "TaskUpdate", "TaskList"]);

/** Upstream `VFt` (L301895–301913) restricted to what the default view can reach, plus canon 2.1.234's
 *  fullscreen-only widenings (`Krr`, 236807–236816). First match wins; the `kind` collapses `VFt`'s independent
 *  flags in `PMd`'s branch order (list, then search, then read — L302223–302238), which is what decides the counter
 *  a multi-kind Bash command lands in. Everything without an `isSearchOrReadCommand` implementation — Edit, Write,
 *  NotebookEdit, Agent, Task, WebFetch, WebSearch, anything unknown — falls out at case 6 and stands alone (R1.1);
 *  the web tools are canon's real policy there, not an oversight.
 *  Under `fullscreen`, two arms open. The silent arm sits AFTER the always-collapsible natives (none of its names
 *  collide, so the order is documentation, not a fix) and BEFORE Bash. The bash arm is last, and deliberately so:
 *  canon computes `isBash: !l && c` (236816) with `l = isSearch||isRead||isList`, so a read-ish command keeps its
 *  read/search/list counter and only a genuinely-not-read Bash becomes `"bash"`. A command with no `command` field
 *  at all is still bash-kind — 237153 bumps `bashCount` before it destructures the input. */
export function classifyToolEvent(event: Pick<ToolEvent, "name" | "input">, opts?: FoldPolicy): FoldClass {
  if (event.name.startsWith("mcp__")) return { collapsible: true, kind: "mcp" };
  if (event.name === "Glob" || event.name === "Grep") return { collapsible: true, kind: "search" };
  if (event.name === "Read") return { collapsible: true, kind: "read" };
  const fullscreen = opts?.fullscreen ?? false;
  if (fullscreen && (SILENT_POPS_OUT.has(event.name) || event.name === "ToolSearch"))
    return { collapsible: true, kind: "silent", popsOutOnError: SILENT_POPS_OUT.has(event.name) };
  if (event.name !== "Bash") return { collapsible: false };
  const { isSearch, isRead, isList } = classifyBashCommand(stringField(event.input, "command") ?? "");
  if (isList) return { collapsible: true, kind: "list" };
  if (isSearch) return { collapsible: true, kind: "search" };
  if (isRead) return { collapsible: true, kind: "read" };
  return fullscreen ? { collapsible: true, kind: "bash" } : { collapsible: false };
}

/** Upstream `KFs` (L301889–301894): `"$ "` + each line whitespace-collapsed, blank lines dropped, truncated so the
 *  ellipsis lands INSIDE the 300-char budget. */
const commandHint = (command: string): string => {
  const text = "$ " + command.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line !== "").join("\n");
  return text.length > HINT_LIMIT ? text.slice(0, HINT_LIMIT - 1) + "…" : text;
};

/** A `neutral` atom carries the F3 thinking clock: `thoughtForMs` is the LOCALLY CLOCKED duration of the
 *  thinking blocks of the assistant message this atom stands for (P82 — the wire has no timestamps, and a
 *  replayed message therefore carries none), `thinkingSummary` its whole text whitespace-collapsed
 *  (upstream `PMd` L302267), which rides to Task 4's italic hint variant and is clamped at render. */
export type FoldAtom = { kind: "tool"; event: ToolEvent } | { kind: "breaker"; sequence: number } | { kind: "neutral"; sequence: number; thoughtForMs?: number; thinkingSummary?: string };
/** `bashCount` is OPTIONAL and present only on a fullscreen run that absorbed a non-read Bash call (canon emits the
 *  pair the same way — `if ((e.bashCount ?? 0) > 0)`, 2.1.234:237035). Absent therefore means "classic", which is
 *  what keeps every existing counts literal valid and the classic clause chain unable to see the new counter.
 *  It stays GROSS: T4's `gitOpBashCount` is a parallel tally the RENDERER subtracts after the watermark ratchet
 *  (518466–518467), never a transfer out of this number — see spec §3.1's mechanism correction. */
export type GroupCounts = { readCount: number; searchCount: number; listCount: number; mcpCallCount: number; mcpServerNames: readonly string[]; thoughtForMs?: number; bashCount?: number };
/** `bashCommands` (tool-use id → command string) is the git scraper's INPUT, recorded here and consumed by T4;
 *  fullscreen-only, and omitted entirely when the run absorbed no Bash call. */
export interface FoldGroup { counts: GroupCounts; hint?: string; memberIds: readonly string[]; anchorSequence: number; open: boolean; latestThinkingSummary?: string; bashCommands?: ReadonlyMap<string, string> }
export type FoldItem = { kind: "group"; group: FoldGroup } | { kind: "tool"; event: ToolEvent } | { kind: "passthrough"; sequence: number };

/** Upstream `rRo` (L302645): the per-contribution ceiling on a thought. Upstream measures a message GAP,
 *  so a conversation resumed hours later would otherwise book the whole wait as thinking; we measure one
 *  block's own arrival span, but the clamp is kept — a turn parked on a permission decision mid-thinking
 *  is the same failure mode. */
const THOUGHT_CAP_MS = 600000;

interface RunState {
  readFilePaths: Set<string>; readOperationCount: number; searchCount: number; listCount: number;
  mcpCallCount: number; mcpServerNames: string[]; memberIds: string[]; anchorSequence: number; open: boolean; hint?: string;
  thoughtForMs: number; latestThinkingSummary?: string;
  bashCount: number; bashCommands: Map<string, string>;
  /** Members that earned a counter. A run of nothing but silently-absorbed calls has every counter at zero and
   *  emits NO group (see `flush`), so this is the one thing that decides whether the run is sayable at all. */
  visibleMembers: number;
}
const newRun = (): RunState => ({ readFilePaths: new Set(), readOperationCount: 0, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [], memberIds: [], anchorSequence: 0, open: false, thoughtForMs: 0, bashCount: 0, bashCommands: new Map(), visibleMembers: 0 });

/** Upstream `PMd`'s accumulator branch chain (L302194–302256) for the reachable kinds, plus canon 2.1.234's
 *  fullscreen branches (`iNp` 237140–237160). The `readCount` quirk lives in `emit`, not here: paths and operations
 *  are counted separately and only ONE of them survives (R1.5). */
function absorb(run: RunState, event: ToolEvent, kind: "read" | "search" | "list" | "mcp" | "bash" | "silent", options: { cwd: string; home: string; fullscreen?: boolean }): void {
  if (run.memberIds.length === 0) run.anchorSequence = event.callSequence;
  run.memberIds.push(event.id);
  if (event.result === undefined) run.open = true;
  const command = stringField(event.input, "command");
  // Canon 237152 records `bashCommands` only in its `isBash` branch; we record every Bash command, read-ish ones
  // included, so T4's scraper sees the whole shell history of the run. The superset is inert in practice — any
  // `git`/`gh` head word poisons the read classification outright, so a read-ish command can never BE a git op —
  // and it costs one map entry per absorbed `cat`/`ls`. Fullscreen-gated because canon allocates the map in
  // `Rka()` only under `Ns()` (237023): a classic run must carry no `bashCommands` field at all.
  if (options.fullscreen === true && event.name === "Bash" && command) run.bashCommands.set(event.id, command);
  // The silently-absorbed branch (237140–237146): the message joins `o.messages` and its id joins `o.toolUseIds`,
  // so it is a member and can be the anchor, but it touches no counter and no display hint.
  if (kind === "silent") return;
  run.visibleMembers++;
  if (kind === "bash") {
    run.bashCount++;
    // Canon's hint here goes through the unread `gQo`/`Ika`/`Aka` formatters (addendum §D); the collapsed `$ …`
    // line the list/read branches already use is our stand-in until those are ported.
    if (command !== undefined) run.hint = commandHint(command);
    return;
  }
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
/** Upstream `ke_` (L302122–302156) copies both thinking fields onto the collapsed message, and BOTH only
 *  when they are populated (`if (e.thoughtForMs > 0)`, `if (e.latestThinkingSummary !== void 0)`) — which
 *  is what keeps `foldClauses` from emitting a `Thought for 0s` clause on an ordinary run. */
const emit = (run: RunState): FoldGroup => ({
  counts: {
    readCount: run.readFilePaths.size > 0 ? run.readFilePaths.size : run.readOperationCount, searchCount: run.searchCount, listCount: run.listCount,
    mcpCallCount: run.mcpCallCount, mcpServerNames: run.mcpServerNames, ...(run.thoughtForMs > 0 ? { thoughtForMs: run.thoughtForMs } : {}),
    ...(run.bashCount > 0 ? { bashCount: run.bashCount } : {}),
  },
  ...(run.hint === undefined ? {} : { hint: run.hint }), memberIds: run.memberIds, anchorSequence: run.anchorSequence, open: run.open,
  ...(run.latestThinkingSummary === undefined ? {} : { latestThinkingSummary: run.latestThinkingSummary }),
  ...(run.bashCommands.size === 0 ? {} : { bashCommands: run.bashCommands }),
});

/** Upstream `PMd` (L302172–302284). `atoms` must already be in transcript order. A group is emitted at the position
 *  of its FIRST member; anything neutral that interrupted the run is replayed straight after it, exactly like
 *  upstream's deferred buffer `i` (L302273–302277). An error is not a boundary and not a counter adjustment (R5.2)
 *  — with ONE fullscreen exception, canon's `popsOutOnError` path (2.1.234:237198–237210), handled below. */
export function segmentRuns(atoms: readonly FoldAtom[], options: { cwd: string; home: string; fullscreen?: boolean }): readonly FoldItem[] {
  const out: FoldItem[] = []; let run = newRun(), deferred: FoldItem[] = [];
  // The PENDING-THOUGHT buffer (F3 Task 3). Upstream pushes the thinking message straight into the open
  // accumulator, so the thought belongs to the run being accumulated and is lost at its next flush. Our
  // groups are tool runs and cannot exist without a member, so a thought that arrives with no run open is
  // HELD for the one that starts next — and dropped by any flush before it, exactly as upstream loses it.
  let pending: { ms: number; summary?: string } | undefined;
  const applyThought = (ms: number, summary: string | undefined) => {
    run.thoughtForMs += ms;
    if (summary !== undefined) run.latestThinkingSummary = summary;
  };
  const flush = () => {
    pending = undefined;
    if (run.memberIds.length === 0) return;
    // A run whose every member was absorbed silently has every counter at zero, and canon renders it as a
    // zero-height row it still reports clickable (518513, 549764). We emit NO item for it — a DELIBERATE
    // divergence (spec §3.1): an invisible clickable region means nothing in an item-based projection, and
    // dropping it is exactly what today's suppressed-tool handling already does. Any buffered thought goes
    // with it, the same way a thought held for a run that never opens is dropped today.
    if (run.visibleMembers > 0) out.push({ kind: "group", group: emit(run) });
    out.push(...deferred); deferred = []; run = newRun();
  };
  // Canon decides between "relocate the errored call out of the cluster" and "leave it inside, just close the
  // run" on `o.messages.at(-1)` — whether any other message was absorbed between the call and the arrival of its
  // error result (237199–237210). Our atoms are calls carrying their own results, so the equivalent question is
  // whether the NEXT atom would have joined this run: a batched sibling call (canon's real case — parallel
  // tool_use puts the sibling's message after ours) or a thinking/neutral message both land in `o.messages`
  // ahead of the result and both block the relocation.
  const joinsRun = (next: FoldAtom | undefined): boolean =>
    next !== undefined && (next.kind === "neutral" || (next.kind === "tool" && classifyToolEvent(next.event, options).collapsible));
  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index]!;
    if (atom.kind === "tool") {
      const fold = classifyToolEvent(atom.event, options);
      if (fold.collapsible) {
        if (pending !== undefined) { applyThought(pending.ms, pending.summary); pending = undefined; }
        absorb(run, atom.event, fold.kind, options);
        // An error result for a `popsOutOnError` tool ALWAYS ends the run (every branch of 237198–237210 flushes
        // and pushes the message); only the relocation is conditional. The spec's own invariant — a pop-out must
        // never shift `memberIds[0]` of an already-formed run, because we stream and cannot unpublish a published
        // row — is preserved by construction: we only ever pop the LAST member, and that can be `memberIds[0]`
        // only in a one-member run, which is silent-only and therefore emitted no group to shift.
        if (fold.kind === "silent" && fold.popsOutOnError && (atom.event.result?.isError ?? false)) {
          if (!joinsRun(atoms[index + 1])) { run.memberIds.pop(); flush(); out.push({ kind: "tool", event: atom.event }); }
          else flush();
        }
        continue;
      }
      flush(); out.push({ kind: "tool", event: atom.event }); continue;
    }
    if (atom.kind === "neutral") {
      const ms = atom.thoughtForMs === undefined ? 0 : Math.min(atom.thoughtForMs, THOUGHT_CAP_MS);
      // Already open ⇒ the thought is this run's now; nothing open ⇒ hold it, summing consecutive thoughts
      // the way upstream's `o.thoughtForMs +=` does, with the LATEST summary winning.
      if (ms > 0 && run.memberIds.length > 0) applyThought(ms, atom.thinkingSummary);
      else if (ms > 0) pending = { ms: (pending?.ms ?? 0) + ms, ...((atom.thinkingSummary ?? pending?.summary) === undefined ? {} : { summary: atom.thinkingSummary ?? pending?.summary }) };
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
