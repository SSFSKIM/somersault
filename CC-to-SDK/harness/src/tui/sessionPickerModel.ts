// tui/src/sessionPickerModel.ts — the /resume picker's literals, filter and row projections (F6 T11),
// transcribed from 2.1.220's `moi` (L476394-476628) with its row helpers `mKt` (L17882), `EGa`/`SGa`
// (L476386/L476390) and `Nqr` (L107122). No React and no I/O of its own; `previewItems` (wave2 T8) reaches
// the SHARED transcript projection, which is where the preview pane's rows now come from.
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
import { projectCompact, projectPending, type ProjectionContext, type RenderItem } from "./toolRenderer.js";

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
/** `fGa`'s loading state (L476141). `PREVIEW_EMPTY` has no upstream twin — upstream's pane renders the real
 *  transcript component, which draws its own nothing; ours has to say why the pane is blank. */
export const PREVIEW_LOADING = "Loading session…";
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

/** How many of a previewed transcript's rows the pane shows. Upstream renders the WHOLE transcript through
 *  the real message renderer and lets the terminal scroll; ours is a fixed tail because the pane is a summary
 *  the cursor sits on, not a second transcript view (the pager and `/resume` itself both exist for that). */
export const PREVIEW_ROWS = 12;

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
    return Array.isArray(c) && c.some((b: any) => b?.type === "text" && typeof b.text === "string" && b.text.trim().length > 0);
  }
  return false;
}
/** `messageCount` as `dGa`'s footer prints it (L476179). Upstream stamps it at index time (`fqs`, L369062);
 *  we have the rows in hand, so we run the same predicate over them. */
export const previewMessageCount = (messages: readonly unknown[]): number =>
  messages.reduce<number>((n, m) => n + (isPreviewMessage(m) ? 1 : 0), 0);

// ── The pane itself (wave2 T8, s2qa4-13/14) ─────────────────────────────────────────────────────────────
// It used to be a hand-rolled excerpt: one trimmed line per countable message, taken straight off
// `message.content`. That is a SECOND renderer, and it drew what the store literally holds — so a slash
// command previewed as `<command-name>/cost</command-name>` and its reply as `<local-command-stdout>…`, tags
// and all, while a tool turn either vanished or arrived as raw text. Stripping the envelopes there would have
// been a third spelling of a routing table `species.ts` already owns.
//
// So the pane stops rendering and starts PROJECTING: `replayDocument` into the retained document, then the
// same projection the live transcript runs over it, which is what brings the species router, the tool folds,
// the `⎿` gutters and the prompt band with it. The pane is now a strict superset of what the count admits —
// tool traffic draws here and counts nowhere, exactly as upstream arranges it.
//
// IN-PANE AND TAIL-ANCHORED (D-W9, a recorded divergence). Upstream's preview REPLACES the picker with the
// real transcript screen; ours keeps the pane inside the picker frame, so it shows the last `PREVIEW_ROWS`
// rows of the projection with `moreAbove` counting what that cut. The full-screen takeover is backlog.

/** The pane's own column budget: the picker frame's `paddingX={1}` on each side. Wrapping must be computed
 *  for the PANE — a projection sized to the terminal would wrap a band wider than the box it sits in. */
export const previewWidth = (columns: number): number => Math.max(20, Math.floor(columns) - 2);
/** How far back a preview reads. `replayDocument` + `projectCompact` walk every row they are given, and this
 *  runs on a keystroke against a session that may hold thousands; the tail window bounds that cost at the only
 *  place it can be bounded honestly, because the `hidden` count below is computed from the projection we
 *  actually built and never claims to know about rows we never read. When the window DID cut, the pane says
 *  so — `windowTruncated` turns the indicator's count into a floor rather than a flat number it knows is
 *  short (review M2). */
export const PREVIEW_MESSAGE_WINDOW = 200;

/** The picker's `ProjectionContext`. Three of its fields are INERT here and deliberately so:
 *   · `now` — the only clock reader here is the ACTIVE fold row's blink phase, and nothing in this pane can
 *     be active: `previewItems` passes an EMPTY live set, so every row it draws has already completed.
 *     Pinned at 0 so the pane is a pure function of its messages.
 *   · `expandHint: ""` — the empty string is the resolver's "that chord is unbound" answer (keys/hints.ts),
 *     which is the truth here: ctrl+o opens nothing from a picker pane, and offering it would be the same
 *     dishonesty a stale chord is. Absent would print the `(ctrl+o to expand)` fallback instead.
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
export interface PreviewTail { items: readonly RenderItem[]; hidden: number }
/** The last `limit` ROWS of a projection, cut on item boundaries, plus the number of rows that cut dropped.
 *  The final item always survives even if it alone overflows the budget — a pane that renders nothing is
 *  worse than one that renders a row too many, and the alternative (slicing a gutter block's body) would put
 *  a second, silent truncation under the one the count reports. */
export function previewTail(items: readonly RenderItem[], limit = PREVIEW_ROWS): PreviewTail {
  let start = items.length, rows = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const height = itemRows(items[i]!);
    if (rows > 0 && rows + height > limit) break;
    rows += height; start = i;
  }
  return { items: items.slice(start), hidden: items.slice(0, start).reduce((n, item) => n + itemRows(item), 0) };
}

/** `previewTail` plus whether the message window (not the row budget) had already cut the input. The two
 *  truncations compose: `hidden` counts rows the budget dropped from a projection that may itself have been
 *  built over only the last `PREVIEW_MESSAGE_WINDOW` messages, so with `windowTruncated` set the number is a
 *  FLOOR and the indicator says so (`↑ 188+ more above`). */
export interface PreviewPane extends PreviewTail { windowTruncated: boolean }
/** A previewed session's persisted messages → the rows the pane draws, and what the row budget cut above
 *  them. `width` is the PANE's (see `previewWidth`); `limit` exists for tests and for a caller with a
 *  different budget. */
export function previewItems(messages: readonly unknown[], opts: { width: number; id?: string; cwd?: string; limit?: number }): PreviewPane {
  const windowTruncated = messages.length > PREVIEW_MESSAGE_WINDOW;
  const window = windowTruncated ? messages.slice(-PREVIEW_MESSAGE_WINDOW) : messages;
  const document = replayDocument(window, { width: opts.width, frame: false, ...(opts.id === undefined ? {} : { id: opts.id }) });
  const context = previewProjection(opts.width, opts.cwd === undefined ? {} : { cwd: opts.cwd });
  // BOTH regions, exactly as the live transcript composes them (useChat: Static + the dynamic tail). The
  // compact projection withholds the trailing fold run while it is still growable, so a session whose last
  // act was a tool call would otherwise preview with that call missing. `liveIds` is EMPTY rather than
  // absent: nothing is running in a transcript read off disk, and an empty set is what keeps a dangling
  // `tool_use` from drawing a blinking row for work no process is doing.
  const projected = [...projectCompact(document, context), ...projectPending(document, context, new Set())];
  return { ...previewTail(projected, opts.limit ?? PREVIEW_ROWS), windowTruncated };
}
