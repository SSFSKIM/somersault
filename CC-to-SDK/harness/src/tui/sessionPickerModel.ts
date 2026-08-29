// tui/src/sessionPickerModel.ts — the /resume picker's literals, filter and row projections (F6 T11),
// transcribed from 2.1.220's `moi` (L476394-476628) with its row helpers `mKt` (L17882), `EGa`/`SGa`
// (L476386/L476390) and `Nqr` (L107122). No React and no I/O of its own.
//
// T-RESUME T2: the IN-PANE preview (`previewItems`/`previewTail`/`PREVIEW_ROWS`/`PREVIEW_MESSAGE_WINDOW`/
// `previewWidth`) is GONE. Canon never had a pane inside the picker's own frame (`yvc`, L583551) — Space/
// Ctrl+V swap the whole picker element for a separate full-screen view, which is what `transcriptItems`
// below (T1) now feeds exclusively. `SessionPicker.tsx` no longer has a "preview stage that stays inside
// its own frame" at all; see `ResumeTranscriptView.tsx`.
//
// WHAT IS HERE VERSUS WHAT UPSTREAM HAS. Upstream's picker filters over four fields (title, git branch, tag,
// PR) and groups forked sessions into an expandable tree (`Vgb`/`bGa`). Our session store carries neither the
// PR/worktree metadata nor a fork lineage, and tree-select groups are a stated non-goal, so the filter is the
// reachable subset: TITLE plus SESSION ID.
//
// THE SCOPE TOGGLES (Wave S T10). Two of upstream's three are BUILT here, because `listSessions` has a real
// option behind each: Ctrl-A drops the `cwd` filter (all projects), Ctrl-W flips `includeWorktrees` (all
// worktrees of this repo). The third, Ctrl-B (all branches), is a PERMANENT RECORDED DIVERGENCE (CTRL-B-1):
// `listSessions` has no branch axis, and the only branch datum we hold is the `gitBranch` a row happens to
// carry — which cannot widen a query it never narrowed. It is left unbound (bindings.ts nulls `ctrl+b` in the
// SessionPicker context) rather than faked with a client-side filter that would silently shrink the list.

import { homedir } from "node:os";
import { formatRelativeTime } from "./format.js";
import { replayDocument } from "./replay.js";
import { projectDetail, projectPending, type ProjectionContext, type RenderItem } from "./toolRenderer.js";
import { wrapItemsToWidth } from "./wrapItems.js";

/** Structurally what `listSessions()` hands the REPL (`SDKSessionInfo`), narrowed to what a row reads. */
export interface SessionRow {
  sessionId: string; summary?: string; firstPrompt?: string; customTitle?: string;
  lastModified?: number; gitBranch?: string;
}

/** `mKt` (L17882) reduced to the fields our store has: custom title, then the auto summary, then the first
 *  prompt, then the id's short form. `fallback` is upstream's `t` parameter — it sits AHEAD of the id, which
 *  is what makes the rename placeholder read `Enter new session name` for an untitled session rather than a
 *  hex prefix. */
export function sessionTitle(s: SessionRow, fallback?: string): string {
  const first = (s.firstPrompt ?? "").split("\n")[0]!.trim();
  return (s.customTitle || s.summary || first || fallback || s.sessionId.slice(0, 8) || "").trim();
}

/** `SGa`/`Nqr` (L476390/L107122) in the subset we can answer: when it was last touched, then the branch it
 *  ended on. Upstream also prints the file size or message count and the project path; `listSessions` gives us
 *  neither a count nor (reliably) a size, and the path is the cwd we already filtered by. */
export function sessionMeta(s: SessionRow, now: Date = new Date()): string {
  const parts: string[] = [];
  if (s.lastModified) parts.push(formatRelativeTime(new Date(s.lastModified), now));
  if (s.gitBranch) parts.push(s.gitBranch);
  return parts.join(" · ");
}

/** `Qe` (L476454-462): a plain case-insensitive substring test, applied to the fields we have. The ID is in
 *  the haystack because it is the one thing a user can copy out of a log and paste back in. */
export function filterSessions<T extends SessionRow>(sessions: readonly T[], query: string, titleOf: (s: T) => string = (s) => sessionTitle(s)): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sessions];
  return sessions.filter((s) => titleOf(s).toLowerCase().includes(q) || s.sessionId.toLowerCase().includes(q));
}

/** L476609's header. Upstream shows the `(n of m)` clause only in list mode AND only once the filtered list
 *  is longer than the window — `te === "list" && lt.length > ut` — so a list that fits on screen prints the
 *  bare title. `n` is the 1-based cursor position (`ne`), `m` the FILTERED length (`lt.length`). */
export const RESUME_TITLE = "Resume session";
export const resumeHeader = (position: number, total: number, windowed: boolean): string =>
  (windowed ? `${RESUME_TITLE} (${position} of ${total})` : RESUME_TITLE);
/** L476609, appended dim while a reload is in flight (upstream's `isLoading`). */
export const REFRESHING = " · Refreshing…";

/** `AL`'s prefix `aGl` (L41482, U+2315) and its default placeholder (L435311). */
export const SEARCH_PREFIX = "⌕";
export const SEARCH_PLACEHOLDER = "Search…";

/** L476609's empty states. The second one is SCOPE-AWARE upstream and is here too now that Ctrl-A exists
 *  (t10 review, note 6): while the list is narrowed to this project the wording says so, and widening to all
 *  projects drops the qualifier — because at that point an empty list really does mean there is nothing
 *  anywhere. Upstream hangs a `Ctrl+A → show all projects` hint off the narrowed one; ours is already in the
 *  footer (`resumeFooter`), which is where every other chord in this picker is advertised. */
export const noSessionsMatch = (query: string): string => `No sessions match "${query}".`;
export const NO_CONVERSATIONS = "No conversations found.";
export const NO_CONVERSATIONS_IN_PROJECT = "No conversations found in this project.";
export const noConversations = (scope: ResumeScope): string =>
  scope.allProjects ? NO_CONVERSATIONS : NO_CONVERSATIONS_IN_PROJECT;

/** L476609's rename stage. The placeholder is `mKt(Ft, "Enter new session name")` — the session's CURRENT
 *  title when it has one, the literal only when it does not. */
export const RENAME_TITLE = "Rename session:";
export const RENAME_FALLBACK = "Enter new session name";
export const renamePlaceholder = (s: SessionRow): string => sessionTitle(s, RENAME_FALLBACK);

/** The three footers (L476627), reduced to the reachable clauses. Upstream's list footer leads with the
 *  Ctrl-A/Ctrl-B/Ctrl-W scope toggles (two of them reachable — `resumeFooter` below) and ends with the tree's
 *  expand/collapse hint (no tree here); what remains is verbatim, mixed case included — upstream prints
 *  `space`/`enter`/`esc` in lower case through `$e` but formats the chords `{modCase:"title",
 *  charCase:"upper"}` and writes `Type to search` as plain text. */
export const RESUME_FOOTER = "space to preview · Ctrl+R to rename · Type to search · esc to cancel";

/** L476627's two-state toggle labels. Each names the state the chord moves you TO — that is upstream's
 *  convention, and inverting it is the obvious way to get this wrong. */
export const WIDEN_ALL_PROJECTS = "show all projects";
export const WIDEN_CURRENT_REPO = "only show current repo";
export const WIDEN_ALL_WORKTREES = "show all worktrees";
export const WIDEN_CURRENT_WORKTREE = "only show current worktree";
/** Which way each axis is currently pointing. Upstream STARTS NARROWED on both (`u`/`L` begin false), which
 *  is why the opening footer offers to widen; our loader has to say `includeWorktrees: false` explicitly to
 *  match, since the SDK's own default is to include them. */
export interface ResumeScope { allProjects: boolean; allWorktrees: boolean }
export const NARROWED_SCOPE: ResumeScope = { allProjects: false, allWorktrees: false };

/** The widen clauses, in upstream's order. `hasWorktree` is upstream's `R` gate (L476627): the chord is
 *  offered only when `git worktree list --porcelain` enumerated more than one checkout (worktrees.ts).
 *  Ctrl-B is absent on purpose — see the header (CTRL-B-1). */
export function widenHints(scope: ResumeScope, hasWorktree: boolean): { chord: string; action: string }[] {
  return [
    { chord: "Ctrl+A", action: scope.allProjects ? WIDEN_CURRENT_REPO : WIDEN_ALL_PROJECTS },
    ...(hasWorktree ? [{ chord: "Ctrl+W", action: scope.allWorktrees ? WIDEN_CURRENT_WORKTREE : WIDEN_ALL_WORKTREES }] : []),
  ];
}
/** The list footer with the widen clauses in front of it, upstream's order (L476627). Callers that cannot
 *  actually re-query — no reload seam — print the bare `RESUME_FOOTER`, which is upstream's `d` gate. */
export const resumeFooter = (scope: ResumeScope, hasWorktree: boolean): string =>
  [...widenHints(scope, hasWorktree).map((h) => `${h.chord} to ${h.action}`), RESUME_FOOTER].join(" · ");

/** The outcome line `/resume` prints when it is CANCELLED — Esc from the list, never a successful pick and
 *  never the `--resume` CLI path (`A` at L476806, `display: "system"`). */
export const RESUME_CANCELLED = "Resume cancelled";
export const RENAME_FOOTER = "enter to save · esc to cancel";
export const PREVIEW_FOOTER = "enter to resume · esc to cancel";
/** `fGa`'s loading state (L476141, canon L583604-583606): `Loading session…` plus a dim `esc to cancel`
 *  hint, rendered with NO frame chrome at all (a bare padded column — `ResumeTranscriptView.tsx`).
 *  `PREVIEW_EMPTY` RETIRED to the `failed` arm (T-RESUME T2, spec R-1): a `loaded`-but-empty session now
 *  renders nothing above the footer (canon has no such string), so the only state left that needs one is a
 *  read that genuinely failed — "(no messages)" is what ccx says when it could not read the transcript at
 *  all, which has no canon twin either way (canon's own read cannot reject the way a store lookup can). */
export const PREVIEW_LOADING = "Loading session…";
export const PREVIEW_LOADING_HINT = "esc to cancel";
export const PREVIEW_EMPTY = "(no messages)";

/** Upstream `ut` (L476596): the available height minus the picker's own chrome, divided by the rows ONE
 *  option occupies. Upstream's chrome is `8 (+1) + 2` over 3-row expanded options; ours is the rule, the
 *  header, the three-row search box, the footer and their margins — ten — over the two rows `Select` budgets
 *  for a described (two-column) option. Never below 1: a one-row list still has to render. */
export const RESUME_CHROME_ROWS = 10;
export const resumeVisibleRows = (rows: number): number => Math.max(1, Math.floor((rows - RESUME_CHROME_ROWS) / 2));
/** `dGa` L476179: `<relative> · <N> messages[ · <branch>]`. */
export function previewMeta(s: SessionRow, count: number, now: Date = new Date()): string {
  const when = s.lastModified ? formatRelativeTime(new Date(s.lastModified), now) : "";
  return `${when ? `${when} · ` : ""}${count} ${count === 1 ? "message" : "messages"}${s.gitBranch ? ` · ${s.gitBranch}` : ""}`;
}

/** Upstream's countable-message predicate, `$$_` + `B$_` (L369021/L369035) as `Pqs` (L369043) applies them:
 *  a USER row carrying non-blank text or an image/document block, or an ASSISTANT row carrying at least one
 *  non-blank text block. Everything else — tool-result-only user rows, tool-use-only and thinking-only
 *  assistant rows, and every `attachment`/`system`/`progress` entry — is not a message.
 *
 *  UPSTREAM'S THIRD CLAUSE IS ABSENT ON PURPOSE. `$$_` also excludes a user row flagged `isMeta`, and this
 *  function carried that test until probe 107 (`probes/probes/107-getsessionmessages-ismeta.ts`) measured what
 *  our one input actually delivers: `getSessionMessages` DROPS the meta row entirely and projects every
 *  surviving row onto a fixed shape (`message,parent_agent_id,parent_tool_use_id,session_id,timestamp,type,
 *  uuid`), so no `isMeta` field reaches this predicate on any transcript — reproduced against two real CLI
 *  sessions holding 53 and 14 such rows, zero of which came back. A test that cannot fire is not a safeguard,
 *  it is a claim about the reader that nobody re-checks; the reader's own behaviour is the safeguard. Do not
 *  re-add it without a probe showing the reader started carrying the field.
 *
 *  THE COUNT'S ONE PREDICATE — and, since wave2 T8, its ONLY consumer. The pane below no longer answers "is
 *  this a message?" at all: it draws the whole projected transcript, tool traffic included, exactly as
 *  upstream's pane does (it renders the real transcript component and counts separately, through `Pqs`). What
 *  qa4-07 ii actually cost us was a count computed from the RAW row length, so the number contradicted the
 *  rows under it; the fix is that this function is the only thing that may produce that number.
 *  Note a slash command contributes 2 upstream (the `<command-name>` message and its `<local-command-stdout>`
 *  reply are both ordinary non-meta user rows); ours inherits that arithmetic unchanged. */
export function isPreviewMessage(m: unknown): boolean {
  const r = m as any;
  if (r?.type === "user") {
    const c = r.message?.content;
    if (!c) return false;
    if (typeof c === "string") return c.trim().length > 0;
    return Array.isArray(c) && c.some((b: any) => b?.type === "text" || b?.type === "image" || b?.type === "document");
  }
  if (r?.type === "assistant") {
    const c = r.message?.content;
    // bl7 T-ADVISOR Task 4 (spec §3.5, A7): `advisor_tool_result` earns a real row of its own (Task 2's
    // render arms), so it counts toward the footer exactly as ordinary text does — not the tool_use/
    // tool_result/thinking-only shapes above, which the picker's own view never draws a message for.
    return Array.isArray(c) && c.some((b: any) => (b?.type === "text" && typeof b.text === "string" && b.text.trim().length > 0) || b?.type === "advisor_tool_result");
  }
  return false;
}
/** `messageCount` as `dGa`'s footer prints it (L476179). Upstream stamps it at index time (`fqs`, L369062);
 *  we have the rows in hand, so we run the same predicate over them. */
export const previewMessageCount = (messages: readonly unknown[]): number =>
  messages.reduce<number>((n, m) => n + (isPreviewMessage(m) ? 1 : 0), 0);

/** The picker's `ProjectionContext`, shared by the (now sole) full-screen preview and by whatever else in
 *  this file ever needs one. Three of its fields are INERT here and deliberately so:
 *   · `now` — the only clock reader here is the ACTIVE fold row's blink phase, and nothing this projection
 *     draws can be active: `transcriptItems` below passes an EMPTY live set, so every row it draws has
 *     already completed. Pinned at 0 so the projection is a pure function of its messages.
 *   · `expandHint: ""` — the empty string is the resolver's "that chord is unbound" answer (keys/hints.ts),
 *     which is the truth here: ctrl+o opens nothing from this view (there is no fold to expand — detail-all
 *     is already fully expanded), and offering it would be the same dishonesty a stale chord is. Absent
 *     would print the `(ctrl+o to expand)` fallback instead.
 *   · `pending`/`thoughtMs`/`agentMeta`/`bashHint` — all omitted: they are the LIVE turn's state (ratcheted
 *     counters, the locally-clocked thinking durations, the backgroundable-shell hint), and none of it exists
 *     for a session being read off disk.
 *  `cwd` is the PREVIEWED SESSION's directory, not this process's — it is what `displayPath` shortens tool
 *  arguments against, and a widened row belongs to another project (the same reasoning that makes the picker
 *  load and rename through the row's own `cwd`). */
export function previewProjection(width: number, env: { cwd?: string; home?: string; platform?: NodeJS.Platform } = {}): ProjectionContext {
  return { cwd: env.cwd ?? process.cwd(), home: env.home ?? homedir(), platform: env.platform ?? process.platform, columns: width, now: 0, expandHint: "" };
}

/** How many terminal rows one projected item occupies: a line is one, a gutter block is its body. */
const itemRows = (item: RenderItem): number => (item.kind === "line" ? 1 : Math.max(1, item.body.length));

// ── The full-screen view's window (T-RESUME T1/T2, D-W9) ───────────────────────────────────────────────
// This is canon's OWN cap, for the full-screen view Space/Ctrl+V opens (`yvc` L583551): the picker is
// replaced wholesale, not embedded (there is no more in-frame pane to fall back to — T2 deleted it), and
// canon's arithmetic (L563246-563388) forces the DETAIL-ALL projection (verbose, every tool body expanded)
// rather than a compact fold.
//
// Canon has no scrollbar, no `↑ N more above` line and no in-view scroll in this view (spec non-goals) — so
// the return type carries no hidden/truncated count at all: there is nothing for a caller to announce.
//
// WRAP FIRST, WINDOW SECOND (the wrapItems.ts / FSW T17 lesson, reused rather than re-derived a third time).
// A raw `RenderItem`'s `kind: "line"` always measures ONE row regardless of whether its text actually fits
// `width` — `itemRows` below is honest only once every item has already been cut into the rows it PAINTS.
// Tail-anchoring on the unwrapped stream would let one very long line push the window past what the caller's
// `budget` rows can actually hold — exactly the bug class FSW T17 found in the pager. So `wrapItemsToWidth`
// runs BEFORE the tail cut, not after.
export interface TranscriptWindow { items: readonly RenderItem[] }
/** A previewed session's persisted messages → canon's full-screen tail window. `budget` is rows, supplied by
 *  the caller (classic mode: 200 flat; fullscreen: `min(200, overlayRows())` — that arithmetic is the VIEW's,
 *  not this pure function's, so it is a plain number here). The raw message window is `2×budget` (canon's own
 *  ratio): wide enough that a budget's worth of collapsed-canon-sized items almost never starves for raw rows
 *  to project, without reading a whole multi-thousand-row session on every keystroke. */
export function transcriptItems(messages: readonly unknown[], opts: { width: number; id?: string; cwd?: string; budget: number }): TranscriptWindow {
  const rawWindow = 2 * opts.budget;
  const window = messages.length > rawWindow ? messages.slice(-rawWindow) : messages;
  const document = replayDocument(window, { width: opts.width, frame: false, ...(opts.id === undefined ? {} : { id: opts.id }) });
  const context = previewProjection(opts.width, opts.cwd === undefined ? {} : { cwd: opts.cwd });
  // Detail-all, forced by canon's own arithmetic (L563347/L563371: verbose + show-all). BOTH regions ride
  // along, exactly as the live transcript composes them (useChat: Static + the dynamic tail): `projectDetail`
  // alone withholds a still-growable trailing fold run, so a resumed session interrupted mid-tool-call would
  // preview with that call silently missing without the pending region alongside it. `liveIds` is EMPTY:
  // nothing is running in a transcript read off disk.
  const projected = [
    ...projectDetail(document, { ...context, projection: "detail-all" }),
    ...projectPending(document, context, new Set()),
  ];
  const painted = wrapItemsToWidth(projected, opts.width);
  // A backward walk over PAINTED rows (not logical items): the final item always survives even if it alone
  // overflows the budget — a window that renders nothing is worse than one that renders nothing at all.
  // Final-review finding 6: "survives" no longer meant "renders whole" — `rows > 0` guarded every check
  // below it, so the FIRST item this loop ever looks at (the final one, `rows` still 0) was admitted
  // unconditionally regardless of its own height, and a single huge `gutter-block` could blow the budget
  // by however many rows its body carried. A `"line"` item can never trip this (`itemRows` gives it
  // height 1, so it only reaches here when `opts.budget` is itself 0); a `"gutter-block"` whose OWN body
  // is taller than the budget is sliced to its own tail rows instead of admitted whole — tail-anchored,
  // same as the window itself.
  let start = painted.length, rows = 0;
  for (let i = painted.length - 1; i >= 0; i--) {
    const item = painted[i]!;
    const height = itemRows(item);
    if (rows > 0 && rows + height > opts.budget) break;
    if (rows === 0 && height > opts.budget && item.kind === "gutter-block") {
      return { items: [{ ...item, body: item.body.slice(-opts.budget) }] };
    }
    rows += height; start = i;
  }
  return { items: painted.slice(start) };
}

/** The tagged shape a preview load is now in (T-RESUME T1, spec R-1). `loading`/`failed` have no upstream
 *  twin here — canon's own `Loading session…` state and its confirm-context error copy are exactly this
 *  split, just undocumented as a type in the bundle. The producer (`useChat.ts`'s `previewSession`) resolves
 *  to `loaded`/`failed` only — `loading` is the CONSUMER's own local state before that promise settles, which
 *  is why it has no payload here. A `loaded` session confirms with THESE messages (canon's `onSelect(Ccs ??
 *  Gwt)`) — never a second, later read that could reject after a successful preview. */
export type PreviewLoad =
  | { state: "loading" }
  | { state: "loaded"; messages: unknown[] }
  | { state: "failed"; error: string };
