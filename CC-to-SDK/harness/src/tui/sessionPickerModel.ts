// tui/src/sessionPickerModel.ts — the /resume picker's literals, filter and row projections (F6 T11),
// transcribed from 2.1.220's `moi` (L476394-476628) with its row helpers `mKt` (L17882), `EGa`/`SGa`
// (L476386/L476390) and `Nqr` (L107122). Pure: no React, no Ink, no I/O.
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

import { formatRelativeTime } from "./format.js";

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

/** L476609's two empty states. Upstream's second one has a project-scoped variant
 *  (`No conversations found in this project.`) chosen by the Ctrl-A toggle we do not ship. */
export const noSessionsMatch = (query: string): string => `No sessions match "${query}".`;
export const NO_CONVERSATIONS = "No conversations found.";

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
 *  a USER row that is not `isMeta` and carries non-blank text or an image/document block, or an ASSISTANT row
 *  carrying at least one non-blank text block. Everything else — tool-result-only user rows, tool-use-only and
 *  thinking-only assistant rows, and every `attachment`/`system`/`progress` entry — is not a message.
 *
 *  ONE PREDICATE, TWO CONSUMERS. `previewMessageCount` (the pane's `N messages` line) and `previewLines` (the
 *  pane itself) both gate on this. They disagreed before — the count was the raw row count — so the number and
 *  the rows under it contradicted each other in both directions (qa4-07 ii). Keep them on this function.
 *  Note a slash command contributes 2 upstream (the `<command-name>` message and its `<local-command-stdout>`
 *  reply are both ordinary non-meta user rows); ours inherits that arithmetic unchanged. */
export function isPreviewMessage(m: unknown): boolean {
  const r = m as any;
  if (r?.type === "user") {
    if (r.isMeta) return false;
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

export interface PreviewLine { role: "user" | "assistant"; text: string }
/** First text block of a persisted row, however its content is shaped. */
function rowText(m: any): string {
  const c = m?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((b: any) => b?.type === "text").map((b: any) => String(b.text ?? "")).join("\n");
  return "";
}
/** A countable row with nothing printable in it — an image- or document-only user turn. Upstream's pane draws
 *  the attachment through the real message renderer; ours is one line per message, so it says what is there
 *  rather than dropping a row the count admitted. */
export const PREVIEW_ATTACHMENT = "[attachment]";
/** The tail of a transcript as one line per message, newest LAST (reading order). */
export function previewLines(messages: readonly unknown[], limit = PREVIEW_ROWS): PreviewLine[] {
  const out: PreviewLine[] = [];
  for (const m of messages) {
    if (!isPreviewMessage(m)) continue;
    const text = rowText(m).split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? PREVIEW_ATTACHMENT;
    out.push({ role: (m as any).type, text });
  }
  return out.slice(-limit);
}
