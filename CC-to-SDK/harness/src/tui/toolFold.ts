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
// `fullscreen` canon 2.1.234 widens the fold three ways — every non-read shell call (canon's bash-tool list is
// BOTH `Bash` and `PowerShell`, 169942) joins the run under its own `bashCount`, the task-board tools plus
// ToolSearch are absorbed with no counter at all, and each absorbed shell command is recorded for the git
// scraper. WebFetch/WebSearch stay standalone in BOTH: that is canon's real policy.
// TS Task 4 closes the loop: each absorbed shell RESULT is scraped for git operations (`gitOps.ts`, canon `odS`
// 236993–237019) and `foldClauses` takes the same `fullscreen` input, growing the git clauses and the
// "ran N shell commands" clause at canon's own positions in the chain. The remaining unspoken clauses —
// REPL, agent, edit, scratchpad, frame, other-tool, memory — are still unreachable counters in this model.
import { displayPath } from "./paths.js";
// `ra` moved to `format.ts` in F3 Task 5 so the fold row and the typed result rows share ONE port (R4.9 still
// calls it with no options here; only the Bash timeout suffix passes `hideTrailingZeros`).
import { formatDuration } from "./format.js";
// TS Task 4: the `vFr` recognition table lives in its own module — this one already carries two command parsers.
import { recognizeGitOps, type GitBranchOp, type GitCommitKind, type GitCommitOp, type GitPrAction, type GitPrOp, type GitPushOp } from "./gitOps.js";
import type { ToolEvent } from "./transcriptModel.js";
// bl7 T-HOOKBLOCK Task 2: `HookRunEntry` is Task 1's completed-pair output (`hookPairs.ts`), threaded in as
// `segmentRuns`'s `options.hookRuns` and resolved into each flushed run's `hookInfos` below (spec D12).
import type { HookRunEntry } from "./hookPairs.js";

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

/** Canon's bash-tool list `ipe = [_i, js]` (2.1.234:169942), resolved at 82177 (`_i = "Bash"`) and 82198
 *  (`js = "PowerShell"`). It is the `c` of `isBash: !l && c` (236816), so BOTH names take the bash kind when
 *  their command is not read-ish — and it is that KIND, not this name set, that decides whether the command is
 *  recorded for the git scraper (`absorb`'s bash branch). */
const BASH_TOOL_NAMES = new Set(["Bash", "PowerShell"]);
/** Canon does NOT reuse the bash word sets for PowerShell: `js`'s own `isSearchOrReadCommand` (346743–346746)
 *  runs `oJS` over cmdlet sets `tJS`/`rJS`/`nJS` (346735) and returns no `isList` at all. */
const PS_SEARCH = new Set(["select-string", "get-childitem", "findstr", "where.exe"]);
const PS_READ = new Set(["get-content", "get-item", "test-path", "resolve-path", "get-process", "get-service", "get-childitem", "get-location", "get-filehash", "get-acl", "format-hex"]);
const PS_IGNORED = new Set(["write-output", "write-host"]);
/** `xw` (344447): lowercase, strip a `.exe/.cmd/.bat/.com` suffix when the word carries no path separator
 *  (`W7S`, 344917), then resolve the 87-entry alias table `zMe` (230900). Only the 15 aliases whose target lands
 *  in one of the three sets above can change an outcome, so those are what we carry — every other alias resolves
 *  to a cmdlet none of the sets holds, which is what an unknown bare word does anyway. `where.exe` in `PS_SEARCH`
 *  is dead in canon too: `xw` strips the `.exe` before the lookup, so that entry can never match. */
const PS_ALIASES = new Map([
  ["ls", "get-childitem"], ["dir", "get-childitem"], ["gci", "get-childitem"], ["cat", "get-content"],
  ["type", "get-content"], ["gc", "get-content"], ["pwd", "get-location"], ["gl", "get-location"],
  ["gi", "get-item"], ["ps", "get-process"], ["gps", "get-process"], ["echo", "write-output"],
  ["write", "write-output"], ["gsv", "get-service"], ["sls", "select-string"],
]);
const psHeadWord = (word: string): string => {
  const lower = word.toLowerCase(), stripped = lower.includes("\\") || lower.includes("/") ? lower : lower.replace(/\.(exe|cmd|bat|com)$/, "");
  return PS_ALIASES.get(stripped) ?? stripped;
};
/** Port of `oJS` (346523–346550). Deliberately NOT the Bash path: canon splits on bare `;`/`|` with no quote,
 *  subshell or heredoc awareness (no tree-sitter here), then applies `Kr_`'s own shape — head word of every
 *  statement, ignored words skipped, ANY word outside the two sets poisons the WHOLE command, and a command of
 *  only ignored words decides nothing. `isList` is structurally absent (`a = s.isList ?? !1` at 236815), so
 *  `Get-ChildItem` — which sits in both cmdlet sets — reports search+read and never the list kind `ls` takes
 *  under Bash. */
function classifyPowerShellCommand(command: string): { isSearch: boolean; isRead: boolean; isList: boolean } {
  const none = { isSearch: false, isRead: false, isList: false };
  let isSearch = false, isRead = false, sawDeciding = false;
  for (const statement of command.trim().split(/\s*[;|]\s*/)) {
    const head = statement.trim().split(/\s+/)[0];
    if (head === undefined || head === "") continue;
    const word = psHeadWord(head);
    if (PS_IGNORED.has(word)) continue;
    sawDeciding = true;
    const search = PS_SEARCH.has(word), read = PS_READ.has(word);
    if (!search && !read) return none;
    if (search) isSearch = true; if (read) isRead = true;
  }
  return sawDeciding ? { isSearch, isRead, isList: false } : none;
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
  if (!BASH_TOOL_NAMES.has(event.name)) return { collapsible: false };
  // Classic freeze: only Bash ever reached the read-ish arm in the 2.1.220 port this renderer is frozen at, so
  // PowerShell stays standalone there. Canon's classic collapses a read-ish PowerShell too (`isCollapsible: s`,
  // 2.1.220:301912) — widening it is this wave's fullscreen business alone, the same recorded divergence shape
  // as `SILENT_POPS_OUT` above.
  if (!fullscreen && event.name !== "Bash") return { collapsible: false };
  const commandText = stringField(event.input, "command") ?? "";
  const { isSearch, isRead, isList } = event.name === "PowerShell" ? classifyPowerShellCommand(commandText) : classifyBashCommand(commandText);
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
 *  (upstream `PMd` L302267), which rides to Task 4's italic hint variant and is clamped at render.
 *  `thinkingBody`/`thinkingKey` (bl6 T-CLUSTER) are the RETENTION half, and ride WHENEVER the atom is
 *  thought-bearing — independent of `thoughtForMs`/`thinkingSummary`'s live-clock gate, since a replayed or
 *  attached entry never has a clock entry but must still retain its body for a later expansion to render.
 *  `thinkingKey` is `` `${identity ?? "anon"}:${messageSequence}` ``: two thinking frames can share one
 *  `message.id` (P82), so identity alone cannot key them apart. */
/** `sequence` on a non-tool atom is the caller's OWN back-pointer (the projection keys it to the array index it
 *  replays from) and means nothing on the transcript's sequence line. `messageSequence` is the real one, carried
 *  separately and optionally so the pop-out window test can see a thought or a breaker land between a silent
 *  call and its error result; an atom that omits it simply cannot close that window. */
/** `openAdvisor` (round review F1): this breaker is an UNRESOLVED advisor consult row — the one other
 *  "still growing, don't publish yet" shape besides a collapsible tool run, and the only one a breaker atom
 *  can carry (an advisor consult can never mint a `ToolEvent`, so it has no `tool` atom of its own to be
 *  withheld through). See `trailingRunCut`'s use of it below. */
export type FoldAtom = { kind: "tool"; event: ToolEvent } | { kind: "breaker"; sequence: number; messageSequence?: number; openAdvisor?: true } | { kind: "neutral"; sequence: number; messageSequence?: number; thoughtForMs?: number; thinkingSummary?: string; thinkingBody?: string; thinkingKey?: string };
/** One absorbed thinking block's retained shape (bl6 T-CLUSTER): `key` disambiguates same-`message.id` frames
 *  (`FoldAtom.thinkingKey`), `messageSequence` is its transcript position (for later interleave-by-sequence
 *  rendering), `body` is the raw `.trim()`ed — NOT whitespace-collapsed — thinking text. */
export type AbsorbedThinking = { key: string; messageSequence: number; body: string };
/** One resolved hook run attributed either to a cluster (PreToolUse only) or to a bl8 T-QY standalone
 *  `{kind:"hooks"}` item (every other event): `name` is the wire's `hook_name` verbatim (Task 3 renders it
 *  as-is; ccx cannot recover canon's definition-derived command text from the wire — D5, recorded
 *  divergence), `durationMs` its own started→response arrival delta (`HookRunEntry.durationMs`, spec D2).
 *  `id` is the entry's own `HookRunEntry.id` (the wire `hook_id`), carried through unconditionally — Task 3's
 *  stable row identity (plan-review F2, bl8 Task 1). `exitCode`/`stderr` are copied off the entry the same
 *  spread-only-when-defined way `HookRunEntry` copies them off the wire frame. Order matches
 *  `options.hookRuns` encounter order (arrival/afterSequence order per Task 1's invariant) — never re-sorted
 *  here (reviewer note: the invariant holds, don't defend it). */
export type HookInfo = { name: string; durationMs: number; id: string; exitCode?: number; stderr?: string };
/** `bashCount` is OPTIONAL and present only on a fullscreen run that absorbed a non-read Bash call (canon emits the
 *  pair the same way — `if ((e.bashCount ?? 0) > 0)`, 2.1.234:237035). Absent therefore means "classic", which is
 *  what keeps every existing counts literal valid and the classic clause chain unable to see the new counter.
 *  It stays GROSS.
 *  `gitOpBashCount` is the OTHER half of that pair (canon emits both together, 237035–237036): a parallel tally of
 *  how many absorbed shell RESULTS yielded a recognised git operation. It is never ratcheted and never subtracted
 *  from `bashCount` here — `foldClauses` does `max(0, ratchet(bashCount) - gitOpBashCount)` at clause time, which
 *  is the only ordering that lets the shell clause legitimately fall to zero mid-turn (518466–518467).
 *  The four op arrays are append-only with no dedup, exactly as canon's are (addendum §B.5); the push clause
 *  dedups at render. */
/** `hookCount`/`hookTotalMs` (bl7 T-HOOKBLOCK Task 2, spec D12) are the resolved PreToolUse hook attribution
 *  for this run — present only when the run absorbed at least one hook entry, the same spread-when-non-empty
 *  style as `bashCount`/`absorbedThinking`. `hookTotalMs` is a per-pair SUM (canon's `Uu` merge takes
 *  `Math.max` of a batch's wall-clock durations instead — D8 — but ccx has only per-pair arrival deltas and no
 *  merge step here, so summing is the only number this shape can produce; recorded overstatement, spec §2.4). */
export type GroupCounts = {
  readCount: number; searchCount: number; listCount: number; mcpCallCount: number; mcpServerNames: readonly string[];
  thoughtForMs?: number; bashCount?: number; gitOpBashCount?: number;
  commits?: readonly GitCommitOp[]; pushes?: readonly GitPushOp[]; branches?: readonly GitBranchOp[]; prs?: readonly GitPrOp[];
  hookCount?: number; hookTotalMs?: number;
};
/** `bashCommands` (tool-use id → command string) is the git scraper's INPUT, recorded here and consumed by T4;
 *  fullscreen-only, and omitted entirely when the run absorbed no BASH-KIND call (a read-ish shell call is not
 *  one — canon 237152 records inside its `isBash` branch alone). */
/** `newestInFlightId` is TS Task 11's elapsed-ticker ANCHOR: the last member absorbed that has no result yet.
 *  Canon finds the same call by walking the cluster's messages backwards for the first one holding an in-flight
 *  tool_use (2.1.234:518532–518543); our atoms are already in transcript order, so the last one absorbed open IS
 *  that call. It is a strict refinement of `open` (present exactly when `open` is true) and carries no time of
 *  its own — this model stays clock-free, and the member's start is stamped by `foldPendingState`. A silently
 *  absorbed member can hold it, exactly as canon's scan sees every `tool_use` in the cluster and not just the
 *  counted ones. */
/** `anchorId`/`anchorSequence` are ONE fact in two forms: the run's EARLIEST-ISSUED call — smallest
 *  `callSequence`, ties (same-entry `tool_use` blocks) broken by absorption order — and that call's id.
 *  It is deliberately not `memberIds[0]`. `memberIds` is ACCUMULATION order, and the anchored stream that
 *  feeds this module orders an OPEN call by its `callSequence` but a SETTLED one by its `resultSequence`,
 *  so a run of overlapping calls whose later-started member finishes first REORDERS as its members settle.
 *  Everything display state is keyed on downstream — the expansion set, the counter watermark — must survive
 *  that, and only call order does: `callSequence` is stamped once and never moves. */
/** `absorbedThinking` (bl6 T-CLUSTER) is present only when non-empty — the same style as `thoughtForMs`/
 *  `latestThinkingSummary` above — and holds every thinking block this run absorbed, in absorption order,
 *  for a later expansion to interleave with the member rows by `messageSequence`. */
export interface FoldGroup { counts: GroupCounts; hint?: string; memberIds: readonly string[]; anchorId: string; anchorSequence: number; open: boolean; newestInFlightId?: string; latestThinkingSummary?: string; bashCommands?: ReadonlyMap<string, string>; absorbedThinking?: readonly AbsorbedThinking[]; hookInfos?: readonly HookInfo[] }
/** `poppedOnError` marks the one standalone tool this module emits for a reason of its own rather than because
 *  the policy called it non-collapsible: an errored `popsOutOnError` call, pushed out so the failure is never
 *  swallowed (see `segmentRuns`). The renderer needs the distinction because two of those names are also
 *  SUPPRESSED, and a suppressed call's ordinary projection is nothing at all — which would make "emitted
 *  standalone so it is seen" mean "emitted standalone and invisible". */
/** bl8 T-QY Task 2: the standalone sibling of `{kind:"group"}`, for a hook entry cluster absorption never
 *  claims — every non-PreToolUse event, plus a PreToolUse entry outside every run's causal window. `label`
 *  is the entries' shared `hook_event` (canon's row-header label; same-position same-label entries coalesce
 *  into ONE item — Global Constraints — so `label` is never ambiguous within one item). Produced ONLY by
 *  `weaveStandaloneHooks` (pass 2), never by `flush` (pass 1) — see that function's doc comment for why a
 *  per-flush drain is forbidden. */
export type FoldItem = { kind: "group"; group: FoldGroup } | { kind: "tool"; event: ToolEvent; poppedOnError?: true } | { kind: "passthrough"; sequence: number } | { kind: "hooks"; label: string; entries: readonly HookInfo[] };

/** Upstream `rRo` (L302645): the per-contribution ceiling on a thought. Upstream measures a message GAP,
 *  so a conversation resumed hours later would otherwise book the whole wait as thinking; we measure one
 *  block's own arrival span, but the clamp is kept — a turn parked on a permission decision mid-thinking
 *  is the same failure mode. */
const THOUGHT_CAP_MS = 600000;

interface RunState {
  readFilePaths: Set<string>; readOperationCount: number; searchCount: number; listCount: number;
  mcpCallCount: number; mcpServerNames: string[]; memberIds: string[]; anchorId: string; anchorSequence: number; open: boolean; newestInFlight?: string; hint?: string;
  /** The largest `resultSequence` among this run's SETTLED members so far, ACROSS every tool — used only as
   *  `resolveRunHooks`'s run-wide fallback bound for a MALFORMED hook name (no recognisable tool suffix, spec
   *  D12's fail-open case), never for a well-formed `"PreToolUse:<Tool>"` entry (see `resultSequenceByTool`
   *  below for that). `undefined` until the run's first member settles. */
  lastResultSequence?: number;
  /** Spec D12's unified per-entry attribution rule (bl7 fix wave 4, superseding waves 2–3's run-wide cap):
   *  an entry naming tool `T` is bounded by `capForTool(R, T)` — UNBOUNDED while `T` has an open member
   *  (`openToolNames`), otherwise the max `resultSequence` over `T`'s SETTLED members alone
   *  (`resultSequenceByTool`). Scoping the cap to the entry's own tool (rather than the run as a whole, wave
   *  3 H1's `open`-gated `lastResultSequence`) is what fixes the regression re-review found: a settled tool's
   *  own hook window must close at that tool's own last result even while a DIFFERENT tool's member is still
   *  open in the same run (`toolFold.test.ts`'s wave-4 J1 cell) — the old rule disabled the cap for the WHOLE
   *  run the moment any member was open, letting an unrelated tool's settled result-sequence bound get skipped
   *  entirely. */
  openToolNames: Set<string>;
  /** Companion to `openToolNames` — see its doc comment. Every tool name here is guaranteed either open (in
   *  `openToolNames`) or represented here (or both, if the run holds more than one member of that tool with
   *  one settled and one still open); `resolveRunHooks` checks `openToolNames` first, exactly per
   *  `capForTool`'s UNBOUNDED-first rule above. */
  resultSequenceByTool: Map<string, number>;
  /** Spec D12 tool-identity invariant (fix wave 3 H2): every tool name absorbed into this run, visible or
   *  silent — `resolveRunHooks`'s guard against attributing a hook to a run holding no member of that hook's
   *  own tool. A run's membership alone never proves which tool a hook belongs to; only a matching name does. */
  memberToolNames: Set<string>;
  thoughtForMs: number; latestThinkingSummary?: string; absorbedThinking: AbsorbedThinking[];
  bashCount: number; bashCommands: Map<string, string>;
  gitOpBashCount: number; commits: GitCommitOp[]; pushes: GitPushOp[]; branches: GitBranchOp[]; prs: GitPrOp[];
  /** Members that earned a counter. A run of nothing but silently-absorbed calls has every counter at zero and
   *  emits NO group (see `flush`), so this is the one thing that decides whether the run is sayable at all. */
  visibleMembers: number;
}
const newRun = (): RunState => ({ readFilePaths: new Set(), readOperationCount: 0, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [], memberIds: [], anchorId: "", anchorSequence: 0, open: false, openToolNames: new Set(), resultSequenceByTool: new Map(), memberToolNames: new Set(), thoughtForMs: 0, absorbedThinking: [], bashCount: 0, bashCommands: new Map(), gitOpBashCount: 0, commits: [], pushes: [], branches: [], prs: [], visibleMembers: 0 });

/** Canon reads its scrape text off `message.toolUseResult` — a single per-MESSAGE `{ stdout, stderr }` object,
 *  joined as `(stdout ?? "") + "\n" + (stderr ?? "")` (236996–236998). Our equivalent is the P94 structured
 *  sidecar, which `transcriptModel` attaches at CALL scope only when the association is unambiguous; anything
 *  else falls back to the flat `tool_result` content, which for a shell call is that same combined text. That
 *  fallback is also what makes canon's latent double-scrape (addendum §B.2 — two `tool_result` blocks in one
 *  message matched against ONE combined output) structurally unreachable here: a batched message never yields a
 *  call-scoped sidecar, so every call is scraped against its own output exactly once (spec §3.1 departure two). */
function resultOutput(result: NonNullable<ToolEvent["result"]>): string {
  const value = result.sidecar?.scope === "call" ? result.sidecar.value : undefined;
  if (isRecord(value)) {
    const stdout = typeof value.stdout === "string" ? value.stdout : "", stderr = typeof value.stderr === "string" ? value.stderr : "";
    if (stdout !== "" || stderr !== "") return stdout + "\n" + stderr;
  }
  const content = result.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : "")).join("\n");
  return "";
}
/** Canon `odS` (236993–237019) minus the per-message loop our atoms make unnecessary. Everything it does with the
 *  recognised ops is here: append to four un-deduplicated arrays, and bump `gitOpBashCount` ONCE for the whole
 *  result however many of the four it yielded (237016–237017). No exit code is consulted, so an errored shell
 *  result whose output still shows a commit line reports the commit — canon's rule, verbatim.
 *  Only a bash-kind result ever reaches here (see `absorb`), so every scrape is preceded by its own `bashCount`
 *  bump and the tally can never outrun the gross count. What survives is canon's own hole and only that: a
 *  bash-kind command that merely MENTIONS a git op over an output that happens to carry the matching shape
 *  (addendum §B.3). Canon answers it by flooring the clause at zero and so do we. */
function scrapeGitOps(run: RunState, command: string, result: NonNullable<ToolEvent["result"]>): void {
  const output = resultOutput(result);
  if (output === "") return;
  const ops = recognizeGitOps(command, output);
  if (ops.commit) run.commits.push(ops.commit);
  if (ops.push) run.pushes.push(ops.push);
  if (ops.branch) run.branches.push(ops.branch);
  if (ops.pr) run.prs.push(ops.pr);
  if (ops.commit || ops.push || ops.branch || ops.pr) run.gitOpBashCount++;
}

/** Upstream `PMd`'s accumulator branch chain (L302194–302256) for the reachable kinds, plus canon 2.1.234's
 *  fullscreen branches (`iNp` 237140–237160). The `readCount` quirk lives in `emit`, not here: paths and operations
 *  are counted separately and only ONE of them survives (R1.5). */
function absorb(run: RunState, event: ToolEvent, kind: "read" | "search" | "list" | "mcp" | "bash" | "silent", options: { cwd: string; home: string; fullscreen?: boolean }): void {
  // STRICTLY smaller, so a tie keeps the member absorbed first — which is what makes the anchor immune to the
  // pop-out below (see `segmentRuns`'s invariant note).
  if (run.memberIds.length === 0 || event.callSequence < run.anchorSequence) { run.anchorSequence = event.callSequence; run.anchorId = event.id; }
  run.memberIds.push(event.id);
  // H2, spec D12: also BEFORE the silent early return — a silently-absorbed member (e.g. TodoWrite) is a real
  // tool identity this run can legitimately claim a hook for, even though it earns no counter of its own.
  run.memberToolNames.add(event.name);
  // BEFORE the silent early return, on the same line of reasoning `open` is: canon's in-flight scan reads the
  // cluster's whole tool-use id set (`DBr(e)`, 518464), which a silently absorbed member joins.
  if (event.result === undefined) { run.open = true; run.newestInFlight = event.id; run.openToolNames.add(event.name); }
  // Tracked for BOTH visible and silent members (before the silent early return below), since a
  // silently-absorbed member's own result frame is just as causally binding on `resolveRunHooks`'s cap —
  // both the run-wide fallback (`lastResultSequence`) and the per-tool one (`resultSequenceByTool`).
  else {
    run.lastResultSequence = run.lastResultSequence === undefined ? event.result.resultSequence : Math.max(run.lastResultSequence, event.result.resultSequence);
    const priorForTool = run.resultSequenceByTool.get(event.name);
    run.resultSequenceByTool.set(event.name, priorForTool === undefined ? event.result.resultSequence : Math.max(priorForTool, event.result.resultSequence));
  }
  const command = stringField(event.input, "command");
  // The silently-absorbed branch (237140–237146): the message joins `o.messages` and its id joins `o.toolUseIds`,
  // so it is a member and can be the anchor, but it touches no counter and no display hint.
  if (kind === "silent") return;
  run.visibleMembers++;
  if (kind === "bash") {
    run.bashCount++;
    // Canon's hint here goes through the unread `gQo`/`Ika`/`Aka` formatters (addendum §D); the collapsed `$ …`
    // line the list/read branches already use is our stand-in until those are ported.
    if (command !== undefined) run.hint = commandHint(command);
    // `bashCommands` — and therefore the whole scrape — lives INSIDE this branch, exactly where canon puts it
    // (237152–237160, gated `Ns() && u.isBash`; the map itself is allocated fullscreen-only by `Rka()`, 237023).
    // The gate is the CLASSIFICATION, never the tool name: a read-ish shell call keeps its read/search/list
    // counter and is never handed to the recognizer. That distinction is load-bearing rather than tidy, because
    // the recognizer matches `git <sub>` ANYWHERE in the command and not just at its head — so scraping a
    // `grep -A2 "git push" ci.log` over a log holding a `… -> ref` line would report a push nobody ran AND burn a
    // `gitOpBashCount` that then subtracts a real "ran 1 shell command" clause out of the sentence.
    if (command) {
      run.bashCommands.set(event.id, command);
      // Canon runs `odS` at the moment the RESULT is absorbed (237212), not at cluster close — which is what puts
      // "committed abc123f" in the live header mid-turn. Our atoms carry call and result together, so absorbing a
      // settled call IS that moment; a call still in flight is simply scraped on the pass after its result lands.
      if (event.result !== undefined) scrapeGitOps(run, command, event.result);
    }
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
/** Spec D12 (plan review H1, the round's headline catch): resolves which of the caller's completed PreToolUse
 *  hook entries belong to a run being flushed, AT FLUSH TIME — never a cursor swept against atom STREAM
 *  positions. Settled tool atoms are ordered by `resultSequence` (see the `anchorId` doc comment above), so the
 *  NORMAL wire order — `tool_use` at sequence 10, a hook pair stamped `afterSequence: 10`, `tool_result` at
 *  sequence 11 — places the hook BEFORE the settled atom in that ordering; a sweep walking atoms in stream
 *  order would pass the hook while the run is still empty and drop it. Instead, membership is a CALL-TIME
 *  window: an entry belongs iff `anchorSequence <= entry.afterSequence < boundary`, where `anchorSequence` is
 *  the run's earliest member `callSequence` (`RunState.anchorSequence`, already tracked by `absorb` — see its
 *  first line) and `boundary` is the sequence of whatever flushed the run (a breaker's real transcript
 *  position, or another atom's `callSequence`; `Infinity` for the trailing/final flush, so a still-open run at
 *  end-of-stream still absorbs). An entry in a pre-run or between-run gap matches no run's window and is
 *  silently dropped — canon routes those to its standalone renderer, out of scope (spec §2.6). No early-exit on
 *  `hookRuns`'s documented afterSequence ordering (Task 1's invariant): this scan doesn't need it and the
 *  reviewer note says not to lean on sortedness beyond what the model requires.
 *  Ports canon's own accumulation, 2.1.251 offsets: the segmenter arm at @162916448 —
 *  `else if(u.messages.length>0&&jar(x)) u.hookCount+=x.hookCount, u.hookTotalMs+=x.totalDurationMs??x
 *  .hookInfos.reduce((U,B)=>U+(B.durationMs??0),0), u.hookInfos.push(...x.hookInfos)` — gated by the predicate
 *  `jar` at @162906900: `function jar(e){return e.type==="system"&&e.subtype==="stop_hook_summary"&&e
 *  .hookLabel==="PreToolUse"}`. Canon absorbs a whole `stop_hook_summary` MESSAGE per match; ccx has no such
 *  message (the wire has no `tool_use_id` either — spec D2), so this function is the call-time equivalent
 *  built over per-pair `HookRunEntry`s instead — hence `anchorSequence <= afterSequence < boundary` in place
 *  of `u.messages.length>0`.
 *
 *  `consumed` (round review F2, the overlapping-window catch): `segmentRuns` does NOT walk atoms in raw call
 *  order — the anchored stream orders a settled atom by `resultSequence`, so a run of overlapping calls whose
 *  later-started member finishes first REORDERS as its members settle (see the `anchorId` doc comment above).
 *  Windowing purely on `[anchorSequence, boundary)` therefore lets two DIFFERENT runs' windows overlap — an
 *  early-settling run's `[2,4)` and a still-open trailing run's `[1,∞)` both cover `afterSequence: 3` — and
 *  the same hook entry would be attributed to both. `consumed` is the caller's running set of entries an
 *  EARLIER flush already claimed; skipping them here makes attribution first-come by flush order (which
 *  follows settle order), so the run whose window closes first wins any entry inside an overlap. `matched`
 *  hands the caller exactly the entries this call counted, so the caller can add them to that set — this
 *  function stays a pure read, never mutating `consumed` itself (a non-mutating probe call, e.g. the
 *  `hooksAbsorbed` check below, must not claim what it only peeked at).
 *
 *  UNIFIED per-entry attribution rule (bl7 fix wave 4, spec D12; supersedes the run-wide cap of waves 2–3):
 *  an entry named `"PreToolUse:<Tool>"` may be claimed by this run iff (1) the run holds at least one member
 *  of tool `<Tool>` (`memberToolNames`, fix wave 3 H2's tool-identity invariant — a run's membership alone
 *  never proves which tool a hook belongs to, only a matching name does) AND (2) `anchorSequence <=
 *  entry.afterSequence < min(boundary, capForTool(run, Tool))`. `capForTool` is UNBOUNDED (`Infinity`) if the
 *  run has an OPEN member of that tool (`RunState.openToolNames`) — an open member's own `PreToolUse` pair
 *  can arrive at any point up to its own not-yet-known result, so no bound is safe yet — and otherwise the
 *  max `resultSequence` over that tool's SETTLED members alone (`RunState.resultSequenceByTool`): a
 *  `PreToolUse:T` pair for a member always arrives BEFORE that member's own `tool_result` frame (the wire
 *  never emits a hook response after the result it gates), so an entry stamped at or after tool `T`'s own
 *  last settled result is causally IMPOSSIBLE for `T`, no matter what a DIFFERENT tool in the same run is
 *  doing. This is the fix for wave 3 H1's regression (`toolFold.test.ts` wave-4 cell, finding J1): scoping
 *  the cap to the entry's OWN tool rather than disabling it for the whole run whenever ANY member is open
 *  means a settled tool's window still closes correctly even while a sibling of a DIFFERENT tool remains
 *  open in the same run — wave 3's `run.open`-gated `undefined` cap let an open sibling of tool A blow open
 *  the window for an already-closed tool B's hook, misattributing it away from the later run that actually
 *  owned it. Normal single-tool order is unaffected either way: a call's own hook stamps at
 *  `afterSequence === callSequence`, strictly before that same call's `resultSequence`
 *  (`toolFold.test.ts` cells (a)/(c)/(j)); a fully-settled run with only one tool degenerates to the same
 *  `min(boundary, resultSequence)` cap wave 2's G1 introduced (cell (i)); an entirely-open run reduces to no
 *  cap at all (cell (k)).
 *
 *  A name with no `":"`, or an empty tool suffix, is an unrecognised shape and fails OPEN (fix wave 3 H2):
 *  it matches unconditionally rather than silently dropping a hook a working guard would have kept, bounded
 *  instead by the run's WIDE bounds (`RunState.open`/`lastResultSequence`, unscoped by tool — there is no
 *  tool to scope by) exactly as before this wave.
 *
 *  `consumed` (round review F2, the overlapping-window catch): `segmentRuns` does NOT walk atoms in raw call
 *  order — the anchored stream orders a settled atom by `resultSequence` (see the `anchorId` doc comment
 *  above), so a run of overlapping calls whose later-started member finishes first REORDERS ahead of the
 *  earlier one. Windowing purely on `[anchorSequence, boundary)` therefore lets two DIFFERENT runs' windows
 *  overlap, and the same hook entry would be attributed to both. `consumed` is the caller's running set of
 *  entries an EARLIER flush already claimed; skipping them here makes attribution first-come by flush order.
 *  `matched` hands the caller exactly the entries this call counted, so the caller can add them to that set —
 *  this function stays a pure read, never mutating `consumed` itself (a non-mutating probe call, e.g. the
 *  `hooksAbsorbed` check below, must not claim what it only peeked at). */
/** `HookRunEntry` → `HookInfo`, spread-only-when-defined — the one place either sink (cluster absorption
 *  below, or `weaveStandaloneHooks`'s standalone items) turns a wire entry into the shape Task 3 renders. */
const hookInfoOf = (entry: HookRunEntry): HookInfo => ({
  name: entry.name, durationMs: entry.durationMs, id: entry.id,
  ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}), ...(entry.stderr !== undefined ? { stderr: entry.stderr } : {}),
});

function resolveRunHooks(anchorSequence: number, boundary: number, hookRuns: readonly HookRunEntry[] | undefined,
    run: { readonly memberToolNames: ReadonlySet<string>; readonly openToolNames: ReadonlySet<string>; readonly resultSequenceByTool: ReadonlyMap<string, number>; readonly open: boolean; readonly lastResultSequence?: number },
    consumed?: ReadonlySet<HookRunEntry>): { infos: HookInfo[]; totalMs: number; matched: HookRunEntry[] } {
  if (hookRuns === undefined || hookRuns.length === 0) return { infos: [], totalMs: 0, matched: [] };
  const infos: HookInfo[] = [], matched: HookRunEntry[] = [];
  let totalMs = 0;
  for (const entry of hookRuns) {
    if (entry.event !== "PreToolUse") continue;   // bl8 spec D1: cluster absorption stays PreToolUse-only; other events render standalone (a later task)
    if (entry.afterSequence < anchorSequence || consumed?.has(entry)) continue;
    const colon = entry.name.indexOf(":"), toolName = colon === -1 ? "" : entry.name.slice(colon + 1);
    let cap: number;
    if (toolName === "") {
      // Malformed shape: no tool to scope by, so fall back to the run's own WIDE bounds (fail-open, fix wave 3 H2).
      cap = run.open ? boundary : Math.min(boundary, run.lastResultSequence ?? boundary);
    } else {
      if (!run.memberToolNames.has(toolName)) continue;
      // `memberToolNames.has(toolName)` guarantees `toolName` is in `openToolNames` or `resultSequenceByTool`
      // (or both) — every absorbed member of a tool lands in exactly one of those two on absorption.
      const capForTool = run.openToolNames.has(toolName) ? Infinity : run.resultSequenceByTool.get(toolName)!;
      cap = Math.min(boundary, capForTool);
    }
    if (entry.afterSequence >= cap) continue;
    infos.push(hookInfoOf(entry));
    matched.push(entry);
    totalMs += entry.durationMs;
  }
  return { infos, totalMs, matched };
}

/** Upstream `ke_` (L302122–302156) copies both thinking fields onto the collapsed message, and BOTH only
 *  when they are populated (`if (e.thoughtForMs > 0)`, `if (e.latestThinkingSummary !== void 0)`) — which
 *  is what keeps `foldClauses` from emitting a `Thought for 0s` clause on an ordinary run.
 *  `hooks` is `resolveRunHooks`'s output for THIS flush's boundary (spec D12) — resolved by the caller, not
 *  recomputed here, so `emit` stays a pure projection of both its arguments with no boundary of its own. */
const emit = (run: RunState, hooks: { infos: readonly HookInfo[]; totalMs: number }): FoldGroup => ({
  counts: {
    readCount: run.readFilePaths.size > 0 ? run.readFilePaths.size : run.readOperationCount, searchCount: run.searchCount, listCount: run.listCount,
    mcpCallCount: run.mcpCallCount, mcpServerNames: run.mcpServerNames, ...(run.thoughtForMs > 0 ? { thoughtForMs: run.thoughtForMs } : {}),
    // `idS`'s fullscreen block (237034–237045) verbatim: the pair rides on `bashCount > 0` (so a run that ran no
    // shell command carries neither), and each op array is emitted only when it has something in it.
    ...(run.bashCount > 0 ? { bashCount: run.bashCount, gitOpBashCount: run.gitOpBashCount } : {}),
    ...(run.commits.length > 0 ? { commits: run.commits } : {}), ...(run.pushes.length > 0 ? { pushes: run.pushes } : {}),
    ...(run.branches.length > 0 ? { branches: run.branches } : {}), ...(run.prs.length > 0 ? { prs: run.prs } : {}),
    ...(hooks.infos.length > 0 ? { hookCount: hooks.infos.length, hookTotalMs: hooks.totalMs } : {}),
  },
  ...(run.hint === undefined ? {} : { hint: run.hint }), memberIds: run.memberIds, anchorId: run.anchorId, anchorSequence: run.anchorSequence, open: run.open,
  ...(run.newestInFlight === undefined ? {} : { newestInFlightId: run.newestInFlight }),
  ...(run.latestThinkingSummary === undefined ? {} : { latestThinkingSummary: run.latestThinkingSummary }),
  ...(run.absorbedThinking.length === 0 ? {} : { absorbedThinking: run.absorbedThinking }),
  ...(run.bashCommands.size === 0 ? {} : { bashCommands: run.bashCommands }),
  ...(hooks.infos.length === 0 ? {} : { hookInfos: hooks.infos }),
});

/** Upstream `PMd` (L302172–302284). `atoms` must already be in transcript order. A group is emitted at the position
 *  of its FIRST member; anything neutral that interrupted the run is replayed straight after it, exactly like
 *  upstream's deferred buffer `i` (L302273–302277). An error is not a boundary and not a counter adjustment (R5.2)
 *  — with ONE fullscreen exception, canon's `popsOutOnError` path (2.1.234:237198–237210), handled below. */
export function segmentRuns(atoms: readonly FoldAtom[], options: { cwd: string; home: string; fullscreen?: boolean; hookRuns?: readonly HookRunEntry[] }): readonly FoldItem[] {
  const out: FoldItem[] = []; let run = newRun(), deferred: FoldItem[] = [];
  // Round review F2: ONE claim set for the whole call, shared by every `resolveRunHooks` call site below —
  // see that function's `consumed` doc. Only `flush`'s real emission adds to it; the `hooksAbsorbed` probe
  // inside the pop-out branch reads it but must stay non-mutating (it is a "what if" check, not a commit).
  const hookClaims = new Set<HookRunEntry>();
  // bl8 T-QY Task 2: one emitted-group's worth of placement info per `flush` that actually pushes a group —
  // `weaveStandaloneHooks` (pass 2, below) walks this AFTER pass 1 finishes, never during it (see that
  // function's doc comment for why a per-flush drain is forbidden).
  const slots: HookSlot[] = [];
  // The PENDING-THOUGHT buffer (F3 Task 3; `bodies` added bl6 T-CLUSTER). Upstream pushes the thinking
  // message straight into the open accumulator, so the thought belongs to the run being accumulated and is
  // lost at its next flush. Our groups are tool runs and cannot exist without a member, so a thought that
  // arrives with no run open is HELD for the one that starts next — and dropped by any flush before it,
  // exactly as upstream loses it. `bodies` rides the SAME buffer but on its own gate (`thinkingBody !==
  // undefined`, not `ms > 0`): a replayed/attached leading thought never has a clock entry and would
  // otherwise never reach `pending` at all, leaving a resumed cluster's retained thinking permanently empty.
  let pending: { ms: number; summary?: string; bodies: AbsorbedThinking[] } | undefined;
  const applyThought = (ms: number, summary: string | undefined) => {
    run.thoughtForMs += ms;
    if (summary !== undefined) run.latestThinkingSummary = summary;
  };
  // `boundary` is the CALL-TIME position that closes this run's hook-attribution window (spec D12,
  // `resolveRunHooks` above) — the flushing atom's own sequence, or `Infinity` for the trailing/final flush.
  // Every call site below passes the boundary its own atom or the stream's end actually represents; `flush`
  // never guesses one, so a caller that forgets is a type error, not a silently wrong window.
  const flush = (boundary: number) => {
    pending = undefined;
    // A run whose every member was absorbed silently has every counter at zero. With NO hooks canon returns
    // `null` for it too (`GU` @177045120 is false on every disjunct, bl8 research-silentrun-hooks.md Part
    // 2.1(a)) — emitting no item here is exact PARITY, not a divergence, and any buffered thought is dropped
    // with it exactly as a thought held for a run that never opens is dropped today. But canon's `BM` clause
    // (@177052130) fires on `hookTotalMs>0` ALONE, with no counter of its own required, and renders
    // `Ran N PreToolUse hooks (X.Xs)` as the row's sole clause — a real, visible line the OLD
    // `run.visibleMembers > 0` gate dropped entirely (the pre-bl8 divergence, since fixed here: research
    // Part 3's "one-condition change to flush's gate"). D5 (spec) closes that gap: `hooks` is resolved
    // BEFORE the visibility test, so a silent-only run that absorbed a hook still emits its group.
    // The GROUP is conditional; the RESET never is. A pop-out can empty `memberIds` before the flush, and the
    // early return this used to take left the accumulator's thought behind to be spoken by the NEXT run.
    if (run.memberIds.length > 0) {
      // Spec D12's unified per-entry rule (fix wave 4): `resolveRunHooks` itself derives each entry's cap
      // from ITS OWN tool's open/settled state on `run` — see that function's doc comment. Resolved BEFORE
      // the emit-gate test below (D5) — `hooks.infos.length` is one of the gate's two disjuncts.
      const hooks = resolveRunHooks(run.anchorSequence, boundary, options.hookRuns, run, hookClaims);
      if (run.visibleMembers > 0 || hooks.infos.length > 0) {
        for (const m of hooks.matched) hookClaims.add(m);   // the one real emission point — claims win by flush order
        // bl8 T-QY Task 2 pass 1: record this group's placement slot for `weaveStandaloneHooks` (pass 2)
        // below — its position in `out` BEFORE the push, its anchor, and the boundary THIS flush closed on.
        slots.push({ index: out.length, anchor: run.anchorSequence, boundary });
        out.push({ kind: "group", group: emit(run, hooks) });
      }
    }
    out.push(...deferred); deferred = []; run = newRun();
  };
  // Canon decides between "relocate the errored call out of the cluster" and "leave it inside, just close the
  // run" on `o.messages.at(-1)` — whether any other message was absorbed between the call's own message and the
  // arrival of its error result (237199–237210). Our atoms carry BOTH endpoints, so that is a WINDOW test and
  // translates exactly: relocate only when no other atom's call sequence or result sequence falls strictly
  // inside the open window `(callSequence, resultSequence)`. A sibling call issued before the error (canon's
  // `Pka` returns that sibling's ids, none of which errored), a sibling RESULT absorbed before it (`Pka` returns
  // `[]` for a user message, 236929) and a thought all land in `o.messages` first and all refuse the relocation;
  // anything issued or thought AFTER the error result does not, and canon relocates. Asking instead whether the
  // NEXT atom would join the run answers a different question and diverges on three of the four orderings —
  // spec §3.1, Revision Notes round 5. Strictly-inside has ONE exception, the lower endpoint (round 6, below).
  const windowIsClear = (event: ToolEvent, self: number): boolean => {
    const from = event.callSequence, to = event.result!.resultSequence;   // only ever called for an errored call
    const inside = (sequence: number) => sequence > from && sequence < to;
    for (let other = 0; other < atoms.length; other++) {
      if (other === self) continue;
      const candidate = atoms[other]!;
      if (candidate.kind === "tool") {
        // The one endpoint that is NOT exclusive. Same-entry tool_use blocks share one `callSequence` only for
        // disk-sourced entries — `transcriptModel.ts` :186 stamps a single sequence across an entry's blocks —
        // so such a sibling sits exactly ON the lower edge and a strictly-inside scan is blind to it. (The live
        // engine emits one frame per content block with DISTINCT `callSequence`s; `apiMessageId` is that
        // source's real "same assistant message" key — see the `ToolEvent` doc comment, `transcriptModel.ts`
        // :32-35.) Canon sees the whole batch through `f.every((g) => m.has(g))` (237200), but `m` is built from
        // the ARRIVING result message alone (237199) — canon's "every sibling errored" means "in THIS message".
        // Ours means "errored at any point": a sibling sharing `callSequence` blocks relocation unless it too
        // errored, no matter which entry carried that error. They part only when same-entry siblings error
        // across DIFFERENT entries — canon keeps the call inside the cluster, we relocate it out — reachable
        // only for disk-sourced multi-block entries, and the effect is membership-only. Recorded divergence:
        // spec §3.1, Revision Notes round 7. Strict-inside stays for every other atom, deliberately.
        if (candidate.event.callSequence === from && candidate.event.result?.isError !== true) return false;
        if (inside(candidate.event.callSequence)) return false;
        if (candidate.event.result !== undefined && inside(candidate.event.result.resultSequence)) return false;
        continue;
      }
      if (candidate.messageSequence !== undefined && inside(candidate.messageSequence)) return false;
    }
    return true;
  };
  // Re-review G2 (spec D12 causal invariant): a DIFFERENT question from `windowIsClear` above, asked only at
  // the hook-widening site below. `windowIsClear`'s strictly-inside test is right for MEMBERSHIP — a sibling
  // whose own call/result never lands inside `(from, to)` did not interfere with this call's relocation — but
  // it is blind to a sibling that SPANS the window entirely (issued before `from`, still open past `to`):
  // neither of ITS endpoints is strictly inside either, yet a PreToolUse pair for THAT sibling can arrive
  // anywhere across its own open span, including exactly on `from` — the same position a call's OWN hook
  // stamps at (`afterSequence === callSequence`).
  // Fix wave 4 (finding J2, scoped by the unified rule): the check is TOOL-AWARE, considering only siblings
  // of `event`'s OWN tool `Tc`. A cross-tool spanning sibling is no longer disqualifying — `resolveRunHooks`'s
  // per-tool `capForTool` (see its doc comment) already refuses to let ANY run claim a `PreToolUse:Tc` entry
  // without a member of tool `Tc`, so a foreign-tool spanning sibling can never absorb it regardless of how
  // far the boundary widens; only a SAME-tool spanning sibling can still be causally confused for `event`
  // itself, since both would satisfy `capForTool`'s tool-name check identically.
  const hasSpanningSibling = (event: ToolEvent, self: number): boolean => {
    const from = event.callSequence, to = event.result!.resultSequence;
    for (let other = 0; other < atoms.length; other++) {
      if (other === self) continue;
      const candidate = atoms[other]!;
      if (candidate.kind === "tool" && candidate.event.name === event.name && candidate.event.result !== undefined &&
          candidate.event.callSequence < from && candidate.event.result.resultSequence >= to) return true;
    }
    return false;
  };
  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index]!;
    if (atom.kind === "tool") {
      const fold = classifyToolEvent(atom.event, options);
      if (fold.collapsible) {
        if (pending !== undefined) { applyThought(pending.ms, pending.summary); run.absorbedThinking.push(...pending.bodies); pending = undefined; }
        absorb(run, atom.event, fold.kind, options);
        // An error result for a `popsOutOnError` tool ALWAYS ends the run (every branch of 237198–237210 flushes
        // and pushes the message); only the relocation is conditional. The spec's own invariant — a pop-out must
        // never shift the run's ANCHOR, because we stream and cannot unpublish a published row — survives the
        // move to earliest-`callSequence` anchoring (E1) and is now an argument rather than a coincidence.
        // We only ever pop the LAST member, so the question is whether the last-absorbed member can be the
        // earliest-issued one. Absorption order is the anchored stream's order, which is `resultSequence` for a
        // settled atom; the popped call E is settled (it has an error result), so every other member M was
        // absorbed at a smaller sequence than E's `Er`. If E were also the earliest ISSUED, `Ec < Mc` — and
        // `Mc` (open M) or `Mc < Mr` (settled M) then falls strictly inside `(Ec, Er)`, which is exactly what
        // `windowIsClear` refuses, so the pop never happens. The one remaining shape is `Mc === Ec`
        // (same-entry blocks): `windowIsClear` refuses that too unless M errored as well, and a tie keeps the
        // member absorbed FIRST as anchor (`absorb` compares strictly), so M holds it and E's departure is
        // invisible. The old argument — `memberIds[0]` moves only in a one-member run — no longer covers the
        // anchor and would have been the wrong claim under the new key.
        if (fold.kind === "silent" && fold.popsOutOnError && (atom.event.result?.isError ?? false)) {
          // AND an errored silent call is never swallowed — UNCONDITIONALLY (spec §3.1, round 6). Canon's
          // `n.push(c)` (237210) sits OUTSIDE the if/else, so the error row is emitted on all three branches:
          // relocated, stayed inside a cluster that renders, or stayed in a run that emits no group at all.
          // Relocation therefore decides only MEMBERSHIP — a call that stayed keeps its place in `memberIds`
          // (`memberIds[0]` included), a call that relocated leaves it. Scoping the row to the relocated/
          // suppressed cases (round 5) left the commonest ordering holed: a failed board write inside a cluster
          // with other members, where the summary says "Read 1 file" and the failure appears nowhere.
          // Obligation this hands Task 8: expanded rendering iterates `memberIds`, so a member already emitted
          // standalone must be SKIPPED there or the failure renders twice. Canon has no such problem — it keeps
          // the `tool_use` in the cluster and pushes the `tool_result` standalone, two halves of one call; our
          // atoms carry both halves together and cannot be split that way.
          // bl7 T-HOOKBLOCK Task 3, canon @162916xxx verbatim: `if(!(u.hookCount>0||(u.relevantMemories
          // ?.length??0)>0)&&B.length>0&&…)` — a run that absorbed a PreToolUse hook (or, in canon,
          // `relevantMemories`; unreachable here, spec §4) never relocates its errored member out, even when
          // `windowIsClear` would otherwise allow it. Resolved against the SAME boundary the flush just below
          // closes on — which is NOT flatly "this call's own `callSequence`" (round review F3): a `PreToolUse`
          // pair for THIS call is stamped `afterSequence === callSequence` (`hookPairs.ts`'s response-arrival
          // rule, `toolFold.ts` D12 doc above), sitting exactly on that boundary's exclusive edge, so a flat
          // `callSequence` boundary excludes the closing call's own hook from BOTH this guard and the group's
          // emitted `hookInfos` — even though canon's own raw-message-stream segmenter has already counted it
          // by the time it evaluates this same pop-out condition (the hook message always precedes the result
          // in the wire order). The fix widens the boundary to this call's `resultSequence` ONLY when
          // `safeToWiden` holds (re-review G2 narrowed this from `windowIsClear` alone): a clear window means
          // no other atom's call/result sequence lies strictly inside `(callSequence, resultSequence)`, and no
          // spanning sibling means no OTHER call's own open span straddles it either, so widening can only
          // pull in `C`'s OWN hook, never
          // a foreign one. When the window is not clear, relocation is refused regardless, so the boundary stays
          // at `callSequence` and no new misattribution risk opens up. `consumed: hookClaims` (F2) keeps this a
          // pure peek at what earlier flushes haven't already claimed — it reads the shared set but never
          // writes it (see `resolveRunHooks`'s doc); only `flush`'s own resolution below claims for real.
          // Re-review G2: `ownWindowClear` alone answers the MEMBERSHIP question (does relocation proceed?)
          // and is deliberately left untouched by a spanning sibling — that sibling interfered with nothing
          // strictly inside this call's own window, so relocation is not suppressed by it. Widening is a
          // NARROWER question (`safeToWiden`, above), refused whenever a spanning sibling exists even though
          // membership itself stays clear (`hasSpanningSibling`'s doc comment).
          const ownWindowClear = windowIsClear(atom.event, index);
          const safeToWiden = ownWindowClear && !hasSpanningSibling(atom.event, index);
          const hookBoundary = safeToWiden ? atom.event.result!.resultSequence : atom.event.callSequence;
          // Spec D12's unified per-entry rule applies here too: `resolveRunHooks` derives the failing call's
          // OWN tool cap from `run` directly (this run has already absorbed the failing call itself, per-tool
          // settled/open state and all — see that function's doc comment).
          const hooksAbsorbed = resolveRunHooks(run.anchorSequence, hookBoundary, options.hookRuns, run, hookClaims).infos.length > 0;
          if (!hooksAbsorbed && ownWindowClear) run.memberIds.pop();
          // Boundary = the SAME `hookBoundary` the guard above just resolved against (spec D12): the flush
          // happens because this call's result just settled, and sharing the boundary is what keeps the
          // group's own emitted `hookInfos` in sync with the guard that decided whether to relocate it.
          flush(hookBoundary);
          // TAGGED, because "standalone" is not self-evidently visible: TaskCreate/TaskUpdate are also on the
          // renderer's suppressed list and project to no items, so the tag is what lets `toolRenderer` give this
          // one its generic header row instead of the nothing every other call by those names gets.
          // bl8 F2 fix: a POINT slot (`anchor === boundary`) at this push's own governing sequence — the same
          // `hookBoundary` the guard above just resolved against — so `weaveStandaloneHooks`'s `positionOf`
          // can see this standalone row too, not just emitted groups (see `HookSlot`'s doc comment).
          slots.push({ index: out.length, anchor: hookBoundary, boundary: hookBoundary });
          out.push({ kind: "tool", event: atom.event, poppedOnError: true });
        }
        continue;
      }
      // A non-collapsible call closes the run at ITS OWN call-time position — the point a call this policy
      // will never absorb enters the stream (spec D12; never the call's `resultSequence`, which the call-time
      // model deliberately never reasons from).
      flush(atom.event.callSequence);
      // bl8 F2 fix: same point-slot reasoning as the pop-out push above — a standalone non-collapsible tool
      // (Edit/Write, or any call this policy never groups) is otherwise invisible to `positionOf`, so a hook
      // stamped before it falls through to `out.length` (the very end) instead of its real position.
      slots.push({ index: out.length, anchor: atom.event.callSequence, boundary: atom.event.callSequence });
      out.push({ kind: "tool", event: atom.event }); continue;
    }
    if (atom.kind === "neutral") {
      const ms = atom.thoughtForMs === undefined ? 0 : Math.min(atom.thoughtForMs, THOUGHT_CAP_MS);
      // The retained BODY rides on its own gate — `thinkingBody !== undefined` — not on `ms > 0`: a
      // replayed/attached atom never has a clock but must still be retained (bl6 T-CLUSTER, spec §3.2(1)(i)).
      const body: AbsorbedThinking | undefined = atom.thinkingBody === undefined ? undefined
        : { key: atom.thinkingKey ?? "anon", messageSequence: atom.messageSequence ?? atom.sequence, body: atom.thinkingBody };
      // Already open ⇒ the thought (and any body) is this run's now; nothing open ⇒ hold both, summing
      // consecutive thoughts the way upstream's `o.thoughtForMs +=` does, with the LATEST summary winning.
      if (run.memberIds.length > 0) {
        if (ms > 0) applyThought(ms, atom.thinkingSummary);
        if (body !== undefined) run.absorbedThinking.push(body);
      } else if (ms > 0 || body !== undefined) {
        pending = {
          ms: (pending?.ms ?? 0) + ms,
          ...((atom.thinkingSummary ?? pending?.summary) === undefined ? {} : { summary: atom.thinkingSummary ?? pending?.summary }),
          bodies: body === undefined ? (pending?.bodies ?? []) : [...(pending?.bodies ?? []), body],
        };
      }
      // bl8 F2 fix: a point slot ONLY when this passthrough actually reaches `out` — one deferred into an
      // already-open run replays right after that run's own group and stays implicitly bound to ITS slot
      // (F2 verdict's scope note: no distinct real sequence of its own in `FoldItem` today).
      if (run.memberIds.length > 0) { deferred.push({ kind: "passthrough", sequence: atom.sequence }); continue; }
      slots.push({ index: out.length, anchor: atom.messageSequence ?? atom.sequence, boundary: atom.messageSequence ?? atom.sequence });
      out.push({ kind: "passthrough", sequence: atom.sequence }); continue;
    }
    // A breaker's `messageSequence` is its REAL transcript position (`sequence` is only the caller's own
    // back-pointer, see the `FoldAtom` doc comment) — the boundary a hook-attribution window closes on.
    flush(atom.messageSequence ?? atom.sequence);
    // bl8 F2 fix: same point-slot reasoning — a breaker's own passthrough push must be visible to `positionOf`.
    slots.push({ index: out.length, anchor: atom.messageSequence ?? atom.sequence, boundary: atom.messageSequence ?? atom.sequence });
    out.push({ kind: "passthrough", sequence: atom.sequence });
  }
  // The trailing flush: no further atom bounds the run, so its hook window stays open to `Infinity` — the one
  // case spec D12 calls out by name, and exactly what lets test order (b) (an OPEN run at end-of-stream) still
  // absorb an entry stamped at its anchor's own `callSequence`.
  flush(Infinity);
  // bl8 T-QY Task 2 pass 2, run ONCE after pass 1 has fully settled every cluster claim (plan-review F1) —
  // see `weaveStandaloneHooks`'s doc comment for why this cannot run per-flush.
  return weaveStandaloneHooks(out, slots, options.hookRuns, hookClaims);
}

/** One emitted group's placement, recorded by `flush` (pass 1) for `weaveStandaloneHooks` (pass 2) to weave
 *  leftover hook entries around: `index` is the group's own position in `out` (BEFORE pass 2 inserts
 *  anything), `anchor` its `anchorSequence`, `boundary` the flush boundary that closed its causal window
 *  (the same value `resolveRunHooks` capped against — NOT the tighter per-tool cap that may have excluded an
 *  entry from the group itself; a `hookClaims`-rejected entry can still fall inside `[anchor, boundary)` and
 *  park right after the group it was rejected by, spec D12's "park-after-cluster" rule). */
export type HookSlot = { index: number; anchor: number; boundary: number };

/** bl8 T-QY Task 2 pass 2 (plan-review F1 — a per-flush drain is FORBIDDEN): weaves every hook entry pass 1
 *  left unclaimed into `out`, by the canon placement rule — BEFORE the FIRST group `g` (in `out`'s own
 *  order) with `entry.afterSequence < g.anchor` (canon's empty-run straight-to-output); else AFTER the LAST
 *  group `g` with `g.anchor <= entry.afterSequence < g.boundary` (canon's park-after-cluster); else at the
 *  END. `slots` is already in `out`-position order (pass 1 pushes it in the same order it pushes groups), so
 *  a forward scan finds "first" and "last" correctly without re-sorting.
 *
 *  WHY NOT per-flush: `segmentRuns` walks the ANCHORED stream, not raw call order, so a run of overlapping
 *  calls whose later-started member finishes first is FLUSHED before an earlier-started, still-open sibling
 *  run (see `resolveRunHooks`'s `consumed` doc, and the bl7 F1 regression cell below). Converting a
 *  rejected entry to standalone AT THE REJECTING run's own flush would be a PERMANENT decision the moment it
 *  happens — but the very next flush (an overlapping run whose window causally contains the same entry, per
 *  `resolveRunHooks`'s per-tool cap) may be the run that actually owns it. Waiting until every flush has run
 *  (this function's ONE call site, after the trailing flush) is what lets `hookClaims` settle first and
 *  leaves only the TRULY unclaimed entries to weave.
 *
 *  Same-position same-label entries coalesce into ONE item (Global Constraints), entries in arrival order —
 *  `hookRuns` is walked once, in its own encounter order (Task 1's invariant), so two labels destined for the
 *  same position keep first-seen-label-first order and each label's own entries stay in their own arrival
 *  order regardless of how they interleave with a DIFFERENT label at the same position.
 *
 *  Every entry this function places — claimed or not — joins `hookClaims` (the one consumption ledger, D1/D2,
 *  bl7 F2's rule): an entry a cluster never claims and this function never reaches (impossible, since it
 *  processes every entry not already in `hookClaims`) would otherwise have no sink at all.
 *
 *  Splice-free by construction: a single forward pass over `[0, out.length]` emits any hooks item whose
 *  position equals the current index BEFORE `out[index]` itself (position `out.length` therefore emits
 *  after the loop's last real element, i.e. at the end) — never mutates `out` or shifts its later indices
 *  mid-walk. */
export function weaveStandaloneHooks(out: readonly FoldItem[], slots: readonly HookSlot[],
    hookRuns: readonly HookRunEntry[] | undefined, hookClaims: Set<HookRunEntry>): readonly FoldItem[] {
  if (hookRuns === undefined || hookRuns.length === 0) return out;
  const leftovers = hookRuns.filter((entry) => !hookClaims.has(entry));
  if (leftovers.length === 0) return out;
  const positionOf = (afterSequence: number): number => {
    for (const slot of slots) if (afterSequence < slot.anchor) return slot.index;
    let after = -1;
    for (const slot of slots) if (slot.anchor <= afterSequence && afterSequence < slot.boundary) after = slot.index;
    return after === -1 ? out.length : after + 1;
  };
  // position → (label → its coalesced entries), both maps insertion-ordered so emission replays arrival order.
  const byPosition = new Map<number, Map<string, HookInfo[]>>();
  for (const entry of leftovers) {
    hookClaims.add(entry);
    const position = positionOf(entry.afterSequence);
    let byLabel = byPosition.get(position);
    if (byLabel === undefined) { byLabel = new Map(); byPosition.set(position, byLabel); }
    let infos = byLabel.get(entry.event);
    if (infos === undefined) { infos = []; byLabel.set(entry.event, infos); }
    infos.push(hookInfoOf(entry));
  }
  const result: FoldItem[] = [];
  for (let index = 0; index <= out.length; index++) {
    const byLabel = byPosition.get(index);
    if (byLabel !== undefined) for (const [label, entries] of byLabel) result.push({ kind: "hooks", label, entries });
    if (index < out.length) result.push(out[index]!);
  }
  return result;
}

/** bl8 F1 fix: detail mode's OWN standalone-hook weave. `projectDetail` (both variants) always takes
 *  `projectAll`'s UNGROUPED else-branch — `anchored.flatMap`, which never runs `foldAnchored`/`segmentRuns`/
 *  `weaveStandaloneHooks` above, so every `hookRuns` entry was silently dropped in that mode, header row and
 *  all (finding F1). `weaveStandaloneHooks`/`HookSlot` are tied to the `FoldItem` model `segmentRuns` builds
 *  and are not directly reusable here — there are no groups to bound against in the ungrouped stream — so
 *  this is a SIBLING function keyed on each anchor's own `sequence` directly: one point-slot comparison per
 *  anchor instead of a `HookSlot` window lookup. No claim tracking: cluster absorption (`resolveRunHooks`) is
 *  PreToolUse-only and only ever runs inside `segmentRuns`, which this path never reaches — every `hookRuns`
 *  entry reaching here is unclaimed by construction, PreToolUse included (canon's transcript-mode rule,
 *  matched for free: detail/ctrl+O is exactly where the richest hook detail belongs).
 *
 *  Returns POSITIONS in `sequences`' own index space (`0..sequences.length` inclusive, `sequences.length`
 *  meaning "after everything") — a pure grouping/positioning step, no rendering; the caller interleaves each
 *  `{position, label, entries}` with its own item stream (`toolRenderer.tsx`'s `weaveStandaloneHooksFlat`,
 *  which turns `label`/`entries` into rows via the shared `hooksItemRows`). Same-position/same-label
 *  coalescing mirrors `weaveStandaloneHooks` exactly, `hookRuns` walked once in its own encounter order. */
export function positionStandaloneHooksFlat(sequences: readonly number[], hookRuns: readonly HookRunEntry[] | undefined):
    readonly { position: number; label: string; entries: readonly HookInfo[] }[] {
  if (hookRuns === undefined || hookRuns.length === 0) return [];
  const byPosition = new Map<number, Map<string, HookInfo[]>>();
  for (const entry of hookRuns) {
    let position = sequences.length;
    for (let i = 0; i < sequences.length; i++) if (entry.afterSequence < sequences[i]!) { position = i; break; }
    let byLabel = byPosition.get(position);
    if (byLabel === undefined) { byLabel = new Map(); byPosition.set(position, byLabel); }
    let infos = byLabel.get(entry.event);
    if (infos === undefined) { infos = []; byLabel.set(entry.event, infos); }
    infos.push(hookInfoOf(entry));
  }
  const result: { position: number; label: string; entries: readonly HookInfo[] }[] = [];
  for (const position of [...byPosition.keys()].sort((a, b) => a - b))
    for (const [label, entries] of byPosition.get(position)!) result.push({ position, label, entries });
  return result;
}

/** One clause of the summary sentence. `boldRanges` are half-open `[start, end)` offsets into `text` — the count
 *  spans upstream wraps in `<Text bold>` (§3.4). `linkRanges` is the T-PRLINK addition: a THIRD, independent
 *  channel of half-open offsets carrying an OSC-8 target, `[start, end, href]`. It rides beside `boldRanges`
 *  rather than replacing it — every span canon links is ALSO bold (`U9e` 531112) — and stays `undefined` (not
 *  `[]`) when nothing in the clause carries a url, so a consumer can tell "no link" from "an allocated empty
 *  array" without walking it. `plainRanges` is the review-round fix to §1.4's table: a FOURTH channel, spans
 *  that must NOT carry the clause's ambient dim even though they are neither bold nor linked — today only the
 *  linked PR clause's `PR ` prefix uses it (canon 531105/531122: `PR` renders plain — not bold, not dim — right
 *  next to the bold+linked `#N`). Task 5c joins the clauses with the literal `", "`. */
export type FoldClause = {
  text: string;
  boldRanges: readonly [number, number][];
  linkRanges?: readonly [number, number, string][];
  plainRanges?: readonly [number, number][];
};
type ClausePart = string | { bold: string; href?: string } | { plain: string };
/** Upstream's `we` helper (L427976–427981): the verb is capitalized only when it opens the sentence, and the object
 *  is always preceded by a single space. A part with both `bold` and `href` opens the SAME span on both channels
 *  (T-PRLINK) — canon never links a span it doesn't also bold. A `{ plain }` part opens a span on the FOURTH
 *  channel only — text that is neither bold nor linked but must still escape the clause's ambient dim. */
function clause(verb: string, first: boolean, parts: readonly ClausePart[]): FoldClause {
  let text = first ? verb[0]!.toUpperCase() + verb.slice(1) : verb;
  const boldRanges: [number, number][] = [];
  const linkRanges: [number, number, string][] = [];
  const plainRanges: [number, number][] = [];
  for (const part of parts) {
    if (typeof part === "string") { text += part; continue; }
    if ("plain" in part) { const start = text.length; text += part.plain; plainRanges.push([start, text.length]); continue; }
    const start = text.length; text += part.bold; const end = text.length;
    boldRanges.push([start, end]);
    if (part.href !== undefined) linkRanges.push([start, end, part.href]);
  }
  return {
    text, boldRanges,
    ...(linkRanges.length > 0 ? { linkRanges } : {}),
    ...(plainRanges.length > 0 ? { plainRanges } : {}),
  };
}
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Canon `ECe` @155015278 verbatim — the hook block's OWN duration formatter, one-decimal seconds always
 *  (`0.4s`, never `400ms`/`4m`), deliberately never `formatDuration`'s general unit ladder (spec §2.5). Shared
 *  by both collapsed forms below and by the expanded per-hook lines (a later task's `expandedMemberItems`). */
export const hookSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
/** The literal text canon paints in TWO positions with the SAME words (@177052130 collapsed-row form 2,
 *  @177046924 the expanded block's own header) — count NOT bold in either. The bold-count SENTENCE form
 *  (collapsed row, hooks are the only clause) does not use this string: it builds its own `clause()` spans
 *  instead (see `hookSentenceClause`), but says the same words. */
export const hookHeaderText = (count: number, totalMs: number): string => `Ran ${count} PreToolUse ${plural(count, "hook", "hooks")} (${hookSeconds(totalMs)})`;
/** Spec §2.5 form 1: when a run's hooks are the ONLY thing it has to say, the hook clause takes over the
 *  WHOLE sentence rather than joining `foldClauses`' chain as one more entry — canon's hook block is
 *  either/or with the ordinary clause chain, never a member of it (there is no fixed "position" for it among
 *  search/read/list/mcp — @177052130/@177053233 branch on "any other clause at all", not on order). `first`
 *  is always `true`: this form only exists precisely when nothing else opened the sentence. */
export function hookSentenceClause(count: number, totalMs: number): FoldClause {
  return clause("ran", true, [" ", { bold: String(count) }, " PreToolUse ", plural(count, "hook", "hooks"), " (", hookSeconds(totalMs), ")"]);
}

/** Canon buckets `commits` by kind in this FIXED order with these labels (518575–518581) — note none of the git
 *  verbs has a present-participle form, so an active run says "Committed abc123f", not "Committing". */
const COMMIT_KINDS: readonly GitCommitKind[] = ["committed", "amended", "cherry-picked"];
const COMMIT_VERB: Record<GitCommitKind, string> = { committed: "committed", amended: "amended commit", "cherry-picked": "cherry-picked" };
/** 518593 — ten actions, ten verbs. */
const PR_VERB: Record<GitPrAction, string> = {
  created: "created", edited: "edited", merged: "merged", commented: "commented on", closed: "closed",
  reopened: "reopened", ready: "marked ready", draft: "marked draft", "auto-merge-enabled": "enabled auto-merge on",
  "auto-merge-disabled": "disabled auto-merge on",
};

/** Upstream `Ima`'s clause chain (L427982–428039) — canon 2.1.234's `ZIl` (518545–518635) — restricted to the
 *  clauses either renderer can actually produce. Classic (no `opts`, or `fullscreen: false`) builds exactly what it
 *  shipped: the thought clause, then search, read, list, mcp; the edited / scratchpad / frame / agent / other-tool /
 *  REPL / memory clauses stay unreachable (R1.6, R1.7, R2.2). Under `fullscreen` two blocks open, at canon's own
 *  positions in the chain: the four git parts sit where the edit parts would end (after "thought", before
 *  "searched for"), and the shell-command clause sits after the MCP clause, immediately before the memory parts.
 *  The thought clause is pushed DIRECTLY upstream, so it is always first and always capitalized. */
export function foldClauses(counts: GroupCounts, active: boolean, opts?: FoldPolicy): readonly FoldClause[] {
  const out: FoldClause[] = [], fullscreen = opts?.fullscreen ?? false;
  if (counts.thoughtForMs !== undefined && counts.thoughtForMs > 0)
    out.push(clause(active ? "thinking" : "thought", true, [" for ", { bold: formatDuration(Math.max(1000, counts.thoughtForMs)) }]));
  if (fullscreen) {
    // One clause per non-empty kind bucket, shas joined by ", " inside a single bold span (518578–518580).
    for (const kind of COMMIT_KINDS) {
      const shas = (counts.commits ?? []).filter((commit) => commit.kind === kind).map((commit) => commit.sha);
      if (shas.length > 0) out.push(clause(COMMIT_VERB[kind], out.length === 0, [" ", { bold: shas.join(", ") }]));
    }
    // ONE clause for every push, with the branch names deduplicated — canon's `fo()` at 518584 is the only dedup
    // anywhere in this pipeline (addendum §B.5).
    const branches = [...new Set((counts.pushes ?? []).map((push) => push.branch))];
    if (branches.length > 0) out.push(clause("pushed to", out.length === 0, [" ", { bold: branches.join(", ") }]));
    for (const op of counts.branches ?? [])
      out.push(clause(op.action === "merged" ? "merged" : "rebased onto", out.length === 0, [" ", { bold: op.ref }]));
    // T-PRLINK / 2.1.236 `N3l` 531624–531626 delegating to `U9e` 531080–531126, itself wrapping the GENERIC
    // link component `Mi` 204156–204172: canon paints the visible characters `PR #N` in BOTH arms — a
    // scraped url only adds styling and a target, it never drops the `PR ` prefix (the OLDER 2.1.234-era
    // reading this comment used to cite, "a PR with a url renders as the bare `#N` link", is superseded; see
    // r5-toolstream-research.md §1.4). `U9e`'s own no-op side-effect stub `sYi` (531059–531061) confirms the
    // hyperlink is produced declaratively by `Mi`, not registered as a side effect. The literal `PR ` prefix
    // sits OUTSIDE the bold+link span in both arms; only the `#N` tail is bold, and only it links.
    // Review-round fix (§1.4's table): in the LINKED arm the `PR ` prefix is `PR plain (not bold, not dim)`
    // in canon (531105/531122) — a `{ plain }` part, not a bare string, so `composeFoldRun` can lift it out
    // of the clause's ambient dim. The unlinked (no-url) arm is table row 3, "whole string bold" — unchanged.
    for (const pr of counts.prs ?? [])
      out.push(pr.url === undefined
        ? clause(PR_VERB[pr.action], out.length === 0, [" ", { bold: `PR #${pr.number}` }])
        : clause(PR_VERB[pr.action], out.length === 0, [" ", { plain: "PR " }, { bold: `#${pr.number}`, href: pr.url }]));
  }
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
  if (fullscreen) {
    // THE no-double-count rule, and the one line of this task that is easy to get wrong. `bashCount` arrives GROSS
    // and already watermark-ratcheted by `foldPendingState.latch`; `gitOpBashCount` arrives raw and is subtracted
    // HERE, after that ratchet — canon 518467 verbatim, `le = Ns() ? Math.max(0, P.current - Z) : 0`. Subtracting
    // at accumulation instead would latch the clause at its pre-git value forever, because the ratchet never falls.
    const shell = Math.max(0, (counts.bashCount ?? 0) - (counts.gitOpBashCount ?? 0));
    if (shell > 0) out.push(clause(active ? "running" : "ran", out.length === 0, [" ", { bold: String(shell) }, " shell ", plural(shell, "command", "commands")]));
  }
  return out;
}
