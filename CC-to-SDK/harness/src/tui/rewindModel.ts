// tui/src/rewindModel.ts — the pure half of the rewind picker (F6 T10): every literal, every geometry rule
// and every projection upstream's `Q4f` (bundle L487055-194) and its three helpers compute, with no React in
// sight. `RewindPicker.tsx` is then only wiring + `Select`.
//
// Two mappings run through the whole file, and they are the reason this is a transcription with seams rather
// than a copy:
//
//  1. UPSTREAM'S `p` IS `A1()` — "is file checkpointing on for this session" — read synchronously from config
//     and used to gate the row's second line, the row height, and whether the confirmation panel offers code
//     at all. We have no such flag: the only thing that can tell us whether a code restore is possible is the
//     dry run itself (`RewindDryRun.canRewind`, host.ts:548 normalising probe 68d's throw-vs-return split).
//     So `p` is TRUE here by construction — we always attempt the dry run — and a session with checkpointing
//     off degrades per row into the `⚠ No code restore` warning upstream shows for an individual row whose
//     stats are missing. Recorded divergence: upstream renders a 2-row row and no warning at all in that
//     case; we render the 3-row row with the warning on every row.
//  2. UPSTREAM'S `N`/`diffStatsForRestore` IS A DIFF, NOT A DRY RUN — it is `Ycr(fileHistory, uuid)`, which
//     answers `undefined` when there is no checkpoint for that message and a `{filesChanged, insertions,
//     deletions}` otherwise. `RewindDryRun` carries the same three fields behind a `canRewind` boolean, so
//     `canRewind:false` IS upstream's `undefined` and the mapping is `dry?.canRewind ? dry : undefined`.
//     `diffStatsOf` below is that one line, written once so the picker cannot spell it two ways.
import { basename } from "node:path";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import type { RewindDryRun, RewindScope } from "../session/chatSession.js";
import { NO_CONTENT, TAG_BASH_INPUT, TAG_COMMAND_ARGS, TAG_COMMAND_NAME, tagInner } from "./species.js";
import { truncateLabel } from "./select/selectModel.js";

/** How many anchors get a dry run when the picker opens — the newest N, walked newest-first, each row
 *  updating as its result lands; scrolling past them extends the window by another N (see
 *  `RewindPicker`'s summary driver).
 *
 *  TEN, NOT TWENTY, and the number is the outcome of the task's step-0 measurement rather than a guess. What
 *  a dry run costs is three hops: the client→host UDS round trip, the host→engine SDK control request, and
 *  the git work the engine's checkpoint diff does. Two of the three are measurable without an API key and
 *  were measured (10 sequential calls each, real `HostServer` + real `RemoteChatSession`): the UDS round trip
 *  is 0.05 ms at the median, and a `git diff --numstat` over a 400-file tree is 17.7 ms (27.4 ms over this
 *  repo's own, much larger, working tree). Both are far under the 150 ms the plan set as the threshold.
 *  The third hop is the one that cannot be measured keyless — and it is also the one already MEASURED LIVE,
 *  in this codebase, by C5 T3: `client/remote.ts`'s `REWIND_TIMEOUT_MS` exists because that round trip
 *  "regularly exceeds 10s on a loaded machine" over `ccx attach`. A window of 20 would therefore queue up to
 *  twenty multi-second engine calls behind an interactive picker. Ten still covers roughly two screens of a
 *  3-row row ahead of the cursor and extends lazily, so nothing is lost but the queue depth. */
export const REWIND_SUMMARY_WINDOW = 10;

/** `g` (L487056) — `p ? 3 : 2`, with `p` true by construction (mapping 1 above). */
export const REWIND_ROW_HEIGHT = 3;
/** The floor upstream keeps (`Math.max(2, …)`, L487056) — two rows is the least that still reads as a list. */
export const REWIND_MIN_ROWS = 2;
/** What the PANE must keep free before a single row is drawn — re-derived in Wave S t4 from `RewindPicker`'s
 *  own frame, and corrected in t4's fix round, which found that derivation subtracted from the wrong thing.
 *
 *  THIS IS 12 AND UPSTREAM'S IS ALSO 12, AND THE MATCH IS A COINCIDENCE — do not "simplify" it back to
 *  "upstream's inlined constant", which is what the pre-t4 comment claimed and what t4 correctly refuted.
 *  Upstream inlines 12 at L487056 but applies it to a row count IT HAS ALREADY HALVED under `ds()`, its
 *  split-view predicate; we have no split view, so importing that 12 measured nothing of ours — it produced
 *  9 visible rows at a geometry where upstream's own frame shows 2. Ours is 9 + 1 + 1 + 1, each term counted
 *  below against our own tree, and nothing but arithmetic accident makes the totals agree.
 *
 *  THE DIALOG DOES NOT OWN THE PANE. `rows` here is the WHOLE terminal height, and `ChatApp` draws
 *  `ChatStatusBar` one line below the picker, unconditionally (ChatApp.tsx:606). A budget counted from
 *  `RewindFrame` alone — t4's nine — therefore composes into a frame that REACHES the pane; measured on the
 *  real `ChatApp`, at two of every three heights at the bottom of the list and at every height once the
 *  checking row is up.
 *
 *  AND REACHING THE PANE IS NOT ONE CLIPPED LINE. Ink 5.2.1 (`ink.js:121`) branches on
 *  `outputHeight >= this.options.stdout.rows` and writes `clearTerminal + fullStaticOutput + output`: a
 *  full-terminal wipe plus a re-dump of the whole accumulated static transcript, ON EVERY RENDER — which for
 *  a list means on every cursor move. The threshold is `>=`, so "exactly fits the pane" already trips it.
 *
 *  9 + 1 + 1 + 1, each term measured:
 *   · 9 — the DIALOG'S OWN chrome, against `RewindFrame` + the list body (`RewindPicker.tsx:99-107, 239-259`):
 *       1-2  the `borderStyle="round"` box's top and bottom rules
 *       3    the bold `Rewind` title
 *       4    the children box's `marginTop={1}` blank
 *       5    `REWIND_PROMPT`
 *       6    `↑ N more above`
 *       7    `↓ N more below`
 *       8    the footer box's `marginTop={1}` blank
 *       9    the footer itself
 *   · +1 — `ChatStatusBar`, the row the dialog is always composed above.
 *   · +1 — the `>=` above: the pane must end up STRICTLY taller than the frame, not equal to it. This is the
 *     only genuine headroom in the budget; the status-bar row never was any (an earlier comment counted it
 *     as slack, which is how the overflow got through).
 *   · +1 — `REWIND_CHECKING` (`RewindPicker.tsx:258`), the tenth conditional row (see below).
 *
 *  Composed, the tallest reachable frame is `3·visible + 11 + wrap` (mid-list, both indicators drawn,
 *  checking row up) against a `visible` of `floor((rows − 12 − wrap) / 3)`, i.e. at most `rows − 1` — and
 *  exactly `rows − 1` whenever `(rows − 12 − wrap) % 3 == 0`. There is no spare row here: all four terms are
 *  load-bearing. Pinned directly, on the composed `ChatApp` frame rather than on this arithmetic, by
 *  rewind-picker.test.tsx's "never renders a frame that reaches the pane" matrix. Below `12 + wrap + 6` rows
 *  the `REWIND_MIN_ROWS` floor outvotes this budget and the frame overflows whatever it says — a deliberate
 *  readability floor, and the reason that matrix skips the short corner (18 rows wide, 19 from 37 to 60
 *  columns, 21 at 36 and below).
 *
 *  TWO CONDITIONAL GROUPS ARE RESERVED ANYWAY, both deliberate:
 *   · ROWS 6 AND 7 — neither indicator is drawn at its own end of the list. They toggle as a consequence of
 *     SCROLLING, which is the very act this budget governs: a budget that dropped them would grow the window
 *     at the top of the list and shrink it again on the first step down, resizing the list under the cursor
 *     mid-scroll. A constant budget costs at most one row of slack at the ends and is the only one that holds
 *     still.
 *   · `REWIND_CHECKING` — t4 reserved nothing for it, on the reasoning that a permanent row is too high a
 *     price for a transient wait that "cannot resize the window under a moving cursor". The trade was real;
 *     the price was not. With the status bar counted, the frame plus the checking row is at or above the pane
 *     at EVERY height, and the cost is the clear-terminal path above rather than one clipped line. Nor is the
 *     wait a frozen screen: the `Select` STAYS MOUNTED and its keys stay live while the row shows (the list
 *     and the row render together, `RewindPicker.tsx:244-258`), so the cursor does keep moving under it — and
 *     every one of those keystrokes would fire the wipe.
 *
 *  THIS CONSTANT IS THE HEIGHT HALF ONLY — it counts ONE row per chrome line, which is what a line costs at
 *  a comfortable width. Two of those lines are literals long enough to WRAP at a narrow one, and each wrapped
 *  line eats the single row of slack above. `rewindWrapRows` below counts them from the actual width and
 *  `rewindVisibleRows` adds the two together; the constant stays width-free so the terms above keep meaning
 *  what they say. Upstream's own budget models no wrap either, and that is not an argument for ours not to:
 *  upstream's number matches upstream's composed frame, and the whole finding of Wave S t4 was that a number
 *  whose derivation does not describe OUR frame measures nothing of ours. */
export const REWIND_CHROME_ROWS = 12;

/** The dialog's horizontal cost: `borderStyle="round"`'s two rules plus `paddingX={1}`'s two columns
 *  (`RewindFrame`, RewindPicker.tsx:101). Everything inside the frame therefore wraps at `columns − 4`. */
export const REWIND_FRAME_INSET = 4;
/** Ink's `wrap` mode verbatim: `node_modules/ink/build/wrap-text.js` calls
 *  `wrapAnsi(text, maxWidth, { trim: false, hard: true })`, i.e. WORD wrap with a hard break only for a token
 *  that cannot fit at all. `Math.ceil(width / inner)` is a DIFFERENT function and disagrees with the renderer
 *  at most widths — the 57-column prompt over an inner 32 is three rendered lines, not two. */
const wrapLines = (text: string, width: number): number =>
  wrapAnsi(text, Math.max(1, width), { trim: false, hard: true }).split("\n").length;

/** The EXTRA rows the two wrappable chrome literals cost at `columns`, over the one apiece
 *  `REWIND_CHROME_ROWS` already counts. Zero at a comfortable width, which is why the height-only budget
 *  looked complete and was not: measured on the composed `ChatApp` frame, the tallest state reached the pane
 *  at one height in three across 44-60 columns and at EVERY height at 36 — the clear-terminal path above, on
 *  every cursor move, for anyone in a split pane.
 *
 *  Three bands, each verified against a rendered frame by rewind-picker.test.tsx's wrap block rather than
 *  against this arithmetic: 0 at 61 columns and up (both literals fit); 1 from 37 to 60, where `REWIND_PROMPT`
 *  (57 columns) takes a second line; 3 at 36 and below, where the prompt takes a third AND `REWIND_FOOTER`
 *  (33 columns) takes a second. The band edges are word-wrap's, not division's — 37 is where an inner 33
 *  exactly fits the footer and lets the prompt's second line hold `conversation to the point before…`.
 *
 *  THE LIST ROWS ARE DELIBERATELY NOT HERE. `AnchorLine` clips to `columns − REWIND_ROW_PADDING_RIGHT`, six
 *  columns inside the inner width (four even for the bash form, which prefixes `! `), so no anchor row can
 *  wrap however long its prompt is — the clip, not this budget, is what holds it to one line. `SummaryLine`
 *  is data — a wide-enough `N files changed +i -d` could wrap at 36 columns — and a budget cannot model data;
 *  that residual belongs to the row renderer, not to this. */
export function rewindWrapRows(columns: number): number {
  const inner = columns - REWIND_FRAME_INSET;
  return wrapLines(REWIND_PROMPT, inner) - 1 + wrapLines(REWIND_FOOTER, inner) - 1;
}

/** `_` (L487056): `Math.max(2, Math.floor((rows - chrome) / rowHeight))`, with OUR chrome — the constant above
 *  plus the width's wrap cost.
 *
 *  `columns` IS OPTIONAL AND SECOND. Optional because omitting it is the honest height-only budget every
 *  existing caller had, so no call site silently changes meaning; second because `rows, columns` is how every
 *  other geometry-taking surface in this tree spells the pair (`RewindPicker`, `Select`, `HelpDialog`), and
 *  because `rowHeight` — upstream's `g`, kept for the shape of the formula — has never been passed by anyone.
 *  A caller that has the width should always pass it: `RewindPicker` already holds both. */
export function rewindVisibleRows(rows: number, columns?: number, rowHeight: number = REWIND_ROW_HEIGHT): number {
  const chrome = REWIND_CHROME_ROWS + (columns === undefined ? 0 : rewindWrapRows(columns));
  return Math.max(REWIND_MIN_ROWS, Math.floor((rows - chrome) / rowHeight));
}

// ── The list ───────────────────────────────────────────────────────────────────────────────────────────
/** The synthetic trailing row's option value. Upstream mints a `randomUUID` for it (`E`, L487056) and tests
 *  `uuid === E`; a constant reads the same way and cannot collide with a real message uuid. */
export const CURRENT_ROW = "\0rewind:current";

export const REWIND_TITLE = "Rewind";
/** L487190's `p` branch. The non-checkpointing branch ("Restore and fork the conversation to the point
 *  before…") is unreachable under mapping 1 and is recorded, not ported. */
export const REWIND_PROMPT = "Restore the code and/or conversation to the point before…";
export const REWIND_EMPTY = "Nothing to rewind to yet.";
/** `nr`'s `inputGuide` for this dialog (L487190), composed through `$e`/`Qt` as `<chord> to <action>` joined
 *  by ` · `. The enter half is dropped with the list itself when there is nothing to rewind to (`!u && R`). */
export const REWIND_FOOTER = "enter to continue · esc to cancel";
export const REWIND_FOOTER_EMPTY = "esc to cancel";
/** A RECORDED ADDITION, not a transcription. Upstream's `oe` awaits `Ycr` — an in-memory `fileHistory`
 *  lookup — before it opens the confirmation panel, and an await that cheap needs no visible state, so the
 *  bundle has no literal for it. Ours awaits a UDS round trip and an engine call (see
 *  `REWIND_SUMMARY_WINDOW`), which is long enough that a list sitting silently after Enter reads as a dead
 *  key. The wording is the pre-F6 picker's own, kept rather than invented twice over. */
export const REWIND_CHECKING = "checking file changes…";
export const moreAbove = (n: number): string => `↑ ${n} more above`;
export const moreBelow = (n: number): string => `↓ ${n} more below`;

/** `kXa`'s `isCurrent` branch (L487294). */
export const CURRENT_LABEL = "(current)";
/** `aM(...)?.trim() || "(no prompt)"` (L487303). */
export const NO_PROMPT = "(no prompt)";
/** `dHr`'s answer, rendered italic (L487307). */
export const EMPTY_MESSAGE = "((empty message))";

/** `dLl` (L17847) — ANY balanced lowercase tag pair, opening tag attributes included. */
const ANY_TAG_PAIR = /<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\n?/g;
/** `vB_` (L376141) and `xoo` (L107283), the two strippers `dHr` runs before asking whether anything is left. */
const ANALYSIS_TAGS = /<(commit_analysis|context|function_analysis|pr_analysis)>[\s\S]*?<\/\1>\n?/g;
const MEMORY_TAGS = /<\/?cc-memory\b[^>]*>/g;

/** `e2r` (L17827): strip every tag pair, and fall back to the ORIGINAL when that leaves nothing — which is
 *  precisely what makes the `((empty message))` branch below reachable. */
const stripTags = (text: string): string => text.replace(ANY_TAG_PAIR, "").trim() || text;
/** `dHr` (L374375) over `Y7e` (L374378). */
const isEmptyText = (text: string): boolean =>
  text.replace(ANALYSIS_TAGS, "").replace(MEMORY_TAGS, "").replace(/^\n+/, "").trim() === "" || text.trim() === NO_CONTENT;

// The synthetic `(current)` row is NOT a case here: upstream's `isCurrent` is a PROP on `kXa`, checked before
// the message is looked at at all (L487291), so it is the caller's flag and not something a text can be.
export type AnchorLabel =
  | { kind: "empty" }                         // `((empty message))`
  | { kind: "bash"; command: string }         // `!` + the command
  | { kind: "command"; text: string }         // `/name args`
  | { kind: "skill"; name: string }           // `Skill(name)`
  | { kind: "text"; text: string };           // the ordinary prompt line

/** `kXa` (L487289-348) minus its React. Order is upstream's, and it matters: emptiness is tested on the
 *  TAG-STRIPPED text, but the bash/command sniffing runs on that same stripped text afterwards. */
export function anchorLabel(text: string): AnchorLabel {
  const body = stripTags(text.trim() || NO_PROMPT);
  if (isEmptyText(body)) return { kind: "empty" };
  if (body.includes(`<${TAG_BASH_INPUT}>`)) {
    const command = tagInner(body, TAG_BASH_INPUT);
    if (command) return { kind: "bash", command };
  }
  if (body.includes(`<${TAG_COMMAND_NAME}>`)) {
    const name = tagInner(body, TAG_COMMAND_NAME);
    if (name) {
      // `skill-format` is an ATTRIBUTE-bearing sibling tag (`al(bAt,"skill-format") === "true"`, L487326).
      if (tagInner(body, "skill-format") === "true") return { kind: "skill", name };
      const args = tagInner(body, TAG_COMMAND_ARGS);
      return { kind: "command", text: `/${name}${args ? ` ${args}` : ""}` };
    }
  }
  return { kind: "text", text: body };
}

/** `oa(text, width, true)` (L106993, the single-line flag on) — the same clip `DialogFrame` uses for an
 *  attribution name, and the reason a row is ONE line however many the prompt has: a multi-line prompt is cut
 *  at its first newline and gets the ellipsis for what it lost, unless that first line plus the ellipsis
 *  would already overflow, in which case the ordinary grapheme clip runs instead. The rewind row calls it
 *  with `columns - paddingRight` where `paddingRight` is 10 (L487192). */
export const REWIND_ROW_PADDING_RIGHT = 10;
export function clipRowText(text: string, width: number): string {
  const nl = text.indexOf("\n");
  if (nl === -1) return truncateLabel(text, width);
  const head = text.slice(0, nl);
  return stringWidth(head) + 1 > width ? truncateLabel(head, width) : `${head}…`;
}

/** The row's SECOND line (L487192). `undefined` = the dry run has not landed yet and the line is BLANK
 *  (upstream's `ge in Se` gate — a row with no entry renders nothing, not a placeholder). */
export type RowSummary =
  | { kind: "unavailable" }                                                  // `⚠ No code restore`
  | { kind: "none" }                                                         // `No code changes`
  | { kind: "files"; text: string; insertions: number; deletions: number };  // `<basename> ` / `N files changed ` + badge

export function rowSummary(dry: RewindDryRun | null): RowSummary {
  const stats = diffStatsOf(dry);
  if (!stats) return { kind: "unavailable" };
  const files = stats.filesChanged ?? [];
  if (files.length === 0) return { kind: "none" };
  const text = files.length === 1 && files[0] ? `${basename(files[0])} ` : `${files.length} files changed `;
  return { kind: "files", text, insertions: stats.insertions ?? 0, deletions: stats.deletions ?? 0 };
}

/** Mapping 2: the dry run seen as upstream's `diffStatsForRestore`. */
export function diffStatsOf(dry: RewindDryRun | null | undefined): RewindDryRun | undefined {
  return dry?.canRewind ? dry : undefined;
}
/** `Re` (L487189): code restore is offered only when the diff stats exist AND name at least one file — a
 *  checkpoint that changed nothing has nothing to restore. */
export function canRestoreCode(dry: RewindDryRun | null | undefined): boolean {
  const stats = diffStatsOf(dry);
  return !!stats?.filesChanged && stats.filesChanged.length > 0;
}

// ── The confirmation panel ─────────────────────────────────────────────────────────────────────────────
export const CONFIRM_HEAD = "Confirm you want to restore";
export const CONFIRM_CONVERSATION = "the conversation ";
export const CONFIRM_TAIL = "to the point before you sent this message:";
/** `Ge.warning` + the sentence at L487190, shown only while a code restore is on the table. */
export const REWIND_MANUAL_WARNING = "⚠ Rewinding does not affect files edited manually or via bash.";
export const NO_CODE_RESTORE = "⚠ No code restore";
export const NO_CODE_CHANGES = "No code changes";

/** L487190: the head reads "…restore the conversation to the point before…" when there are no diff stats at
 *  all, and drops that clause when there are. Upstream keys this on `N` — the stats — NOT on whether code
 *  restore is possible, so a checkpoint with zero changed files drops the clause while offering conversation
 *  only. Transcribed as written. */
export const confirmPrompt = (dry: RewindDryRun | null | undefined): string =>
  `${CONFIRM_HEAD} ${diffStatsOf(dry) ? "" : CONFIRM_CONVERSATION}${CONFIRM_TAIL}`;

export type RestoreOption = RewindScope | "nevermind";

export const RESTORE_LABELS: Record<RestoreOption, string> = {
  both: "Restore code and conversation",
  conversation: "Restore conversation",
  code: "Restore code",
  nevermind: "Never mind",
};

/** `Y` (L487069-072). Upstream builds `[both, conversation, code]` when code restore is possible and
 *  `[conversation]` when it is not; the summarize pair between there and `Never mind` is DG41 and out of
 *  scope. The picker used to pass a SECOND gate here — a null `prevUuid` (the first prompt, or the first
 *  after a compaction boundary) has no row to resume AT, so a conversation restore was impossible. W-S8
 *  removed that degradation at its source: the host now CLEARS the conversation where it cannot fork it
 *  (host.ts's `clearing` branch), so the picker passes `conversation: true` for every anchor. The parameter
 *  stays, because it is the shape of the question and other callers may still answer `false`; so does the
 *  rule it encodes — an impossible option is expressed by ABSENCE, the way upstream expresses its own,
 *  rather than as a disabled row with a reason. */
export function restoreOptions({ code, conversation }: { code: boolean; conversation: boolean }): RestoreOption[] {
  return [
    ...(code && conversation ? (["both"] as const) : []),
    ...(conversation ? (["conversation"] as const) : []),
    ...(code ? (["code"] as const) : []),
    "nevermind",
  ];
}
/** `defaultFocusValue: Re ? "both" : "conversation"` (L487190), with the same `conversation:false` tail
 *  `restoreOptions` keeps: focus must land on an option that EXISTS, whatever the caller says is possible. */
export function defaultRestoreOption({ code, conversation }: { code: boolean; conversation: boolean }): RestoreOption {
  return code && conversation ? "both" : conversation ? "conversation" : code ? "code" : "nevermind";
}

/** `J4f` (L487195-208) — the FIRST explanation line, one per option. The two summarize arms are DG41. */
export function conversationExplanation(option: RestoreOption): string {
  return option === "both" || option === "conversation" ? "The conversation will be forked." : "The conversation will be unchanged.";
}

/** `xXa` (L487232-288) — the SECOND explanation line, shown only while the focused option restores code and
 *  code restore is possible; otherwise `Z4f` (L487222) prints "The code will be unchanged." */
export const CODE_UNCHANGED = "The code will be unchanged.";
export const CODE_NOT_CHANGED = "The code has not changed (nothing will be restored).";

/** `xXa`'s file clause: one basename, `a and b`, or `first and N other files`. */
export function fileSummary(files: readonly string[]): string {
  const a = basename(files[0] ?? "");
  if (files.length === 1) return a;
  if (files.length === 2) return `${a} and ${basename(files[1] ?? "")}`;
  return `${a} and ${files.length - 1} other files`;
}

export type CodeExplanation =
  | { kind: "unchanged"; text: string }                                              // one dim line, no badge
  | { kind: "restore"; files: string; insertions: number; deletions: number };       // `The code will be restored <badge> in <files>.`

export function codeExplanation(option: RestoreOption, dry: RewindDryRun | null | undefined): CodeExplanation {
  const stats = diffStatsOf(dry);
  const restores = (option === "both" || option === "code") && canRestoreCode(dry);
  if (!restores) return { kind: "unchanged", text: CODE_UNCHANGED };
  const files = stats?.filesChanged ?? [];
  if (files.length === 0 || !files[0]) return { kind: "unchanged", text: CODE_NOT_CHANGED };
  return { kind: "restore", files: fileSummary(files), insertions: stats?.insertions ?? 0, deletions: stats?.deletions ?? 0 };
}

// ── Failure ────────────────────────────────────────────────────────────────────────────────────────────
/** `ce`'s error arms (L487142-154). Upstream runs the code and conversation restores as two independent
 *  try/catch blocks and reports which of the two threw; our `RewindOps.rewind` is ONE call that either
 *  completes both halves of the chosen scope or throws once (host.ts:564-592), so the arm is chosen by the
 *  option that was picked. The `Restored the code, but skipped N files…` arm (L487142) has no channel to
 *  reach us at all — `rewind()` returns `Promise<void>` and `RewindDryRun` has no `skippedLinks` — and is
 *  recorded UNREACHABLE for the T15 ledger rather than reconstructed. */
export function rewindFailureHeading(scope: RewindScope): string {
  return scope === "both" ? "Failed to restore the conversation and code:"
    : scope === "code" ? "Failed to restore the code:"
      : "Failed to restore the conversation:";
}

