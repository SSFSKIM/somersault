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
import type { RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";
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
/** The `12` inlined at L487056 (`Math.floor((m - 12) / g)`): what the frame, prompt, indicators and footer
 *  cost before a single row is drawn. Upstream also declares it as `y = 12` and then never reads that. */
export const REWIND_CHROME_ROWS = 12;

/** `_` (L487056): `Math.max(2, Math.floor((rows - 12) / rowHeight))`. Upstream halves `rows` first when
 *  `ds()` (its "is the transcript in split view" predicate) — we have no split view, so that branch is
 *  recorded and not ported. */
export function rewindVisibleRows(rows: number, rowHeight: number = REWIND_ROW_HEIGHT): number {
  return Math.max(2, Math.floor((rows - REWIND_CHROME_ROWS) / rowHeight));
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

/** `Y` (L487069-072) — WITH our second gate. Upstream builds `[both, conversation, code]` when code restore
 *  is possible and `[conversation]` when it is not; the summarize pair between there and `Never mind` is
 *  DG41 and out of scope. Our `RewindAnchor` carries a second capability upstream's message does not: a null
 *  `prevUuid` (the first prompt, or the first after a compaction boundary) means there is no row to resume
 *  AT, so a conversation restore is impossible (probe 68c, chatSession.ts:48-51). It is expressed the way
 *  upstream expresses its own impossible option — by ABSENCE — rather than as a disabled row with a reason,
 *  because a list whose shape says what is possible needs no second vocabulary for it. */
export function restoreOptions({ code, conversation }: { code: boolean; conversation: boolean }): RestoreOption[] {
  return [
    ...(code && conversation ? (["both"] as const) : []),
    ...(conversation ? (["conversation"] as const) : []),
    ...(code ? (["code"] as const) : []),
    "nevermind",
  ];
}
/** `defaultFocusValue: Re ? "both" : "conversation"` (L487190), degraded through the prevUuid gate above:
 *  with no conversation anchor, `both` does not exist and neither does `conversation`. */
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

/** The anchors a summary window covers, newest-first — `anchors` arrives newest-first from
 *  `rewindAnchorsFrom`, and the picker DISPLAYS it reversed (see `RewindPicker`), so "newest first" is a
 *  statement about the dry-run order, not about the screen. */
export const summaryOrder = (anchors: readonly RewindAnchor[], limit: number): RewindAnchor[] => anchors.slice(0, Math.max(0, limit));
