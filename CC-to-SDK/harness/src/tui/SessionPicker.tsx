// tui/src/SessionPicker.tsx — the /resume modal (F6 T11), rebuilt on the `Select` primitive and on
// upstream's own anatomy (`moi`, bundle L476394-476628, with its preview pane `fGa` L476095). The literals,
// the filter and the row projections live in `sessionPickerModel.ts`; this file is the three stages, their
// keys, and the preview fetch.
//
// THREE STAGES, one component: `list` (search bar + the Select), `preview` (Space — the tail of the
// highlighted session's transcript), `rename` (Ctrl-R — a text field over `renameSession`). Upstream is the
// same shape (`te`), including the detail that preview and rename REPLACE the list rather than sitting
// beside it.
//
// TWO THINGS DIVERGE FROM UPSTREAM, both deliberate and both recorded for T15:
//  · SEARCH IS MODELESS. Upstream has a `search` mode that DISABLES the list while you type (`isDisabled: te
//    === "search"`, L476611) and re-enters `list` on ctrl+n. Ours filters live with the cursor still on the
//    list, which is why the printable characters arrive through the Select's `onUnhandledKey` (movement and
//    accept stay Select's, exactly as upstream's `!Xe.defaultPrevented` guard arranges at L476572).
//  · `hideIndexes` IS ON, so the list has no number column and no digit shortcuts. Upstream's list is a
//    different component (a tree-select, `bGa`), and it keeps its numbers; ours is the shared `Select`, whose
//    digit selection would fight the type-to-search field this task adds — a session id is mostly digits.
//    Digits belong to the search box here.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { useRefState } from "./keys/refState.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { InputText, Select } from "./select/Select.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";
import type { SessionInfo } from "./useChat.js";
import { RenderItemView } from "./toolRenderer.js";
import { moreAbove } from "./select/overflow.js";
import {
  filterSessions, NARROWED_SCOPE, noConversations, noSessionsMatch, PREVIEW_EMPTY, PREVIEW_FOOTER,
  PREVIEW_LOADING, previewItems, previewMessageCount, previewMeta, previewWidth, REFRESHING, RENAME_FOOTER,
  RENAME_TITLE, renamePlaceholder, RESUME_FOOTER, resumeFooter, resumeHeader, resumeVisibleRows,
  SEARCH_PLACEHOLDER, SEARCH_PREFIX, sessionMeta, sessionTitle, type ResumeScope,
} from "./sessionPickerModel.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

type Stage = "list" | "preview" | "rename";

/** `zu` (L184012) as the resume picker asks for it (`color:"suggestion"`, L476609): a coloured rule, then a
 *  padded column. Local rather than shared for the same reason `RewindFrame` is — the shared `DialogFrame`
 *  renders a plain-string title, and this header carries a dim `(3 of 47)` clause inside the same line. */
function PickerFrame({ header, footer, children }: { header: React.ReactNode; footer: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={role("suggestion")}
         borderLeft={false} borderRight={false} borderBottom={false} marginTop={1}>
      <Box flexDirection="column" paddingX={1}>
        {header}
        {children}
        <Box marginTop={1}><Text dimColor>{footer}</Text></Box>
      </Box>
    </Box>
  );
}

export function SessionPicker({ sessions, onPick, onCancel, loadMessages, renameSession, reload, hasWorktree = false, refreshing = false, rows, columns }: {
  sessions: SessionInfo[];
  onPick: (s: SessionInfo) => void;
  onCancel: () => void;
  /** Re-run `listSessions` under a widened scope (Wave S T10). Absent → neither widen chord is offered, which
   *  is upstream's own gate: Ctrl+A appears only when an `onToggleAllProjects` callback exists (`d`, L476627). */
  reload?: (scope: ResumeScope) => Promise<SessionInfo[]>;
  /** Upstream's `R` gate — `git worktree list --porcelain` found more than one checkout. Detected by the
   *  caller (useChat) so the picker never waits on a child process to open. */
  hasWorktree?: boolean;
  /** The preview fetch (`getSessionMessages`). Absent → Space is inert, which is what an unwired caller
   *  should get rather than a pane that can never fill. `dir` is the HIGHLIGHTED ROW's own directory: once
   *  Ctrl+A widens the list past this project, reading through the caller's launch cwd previews an empty
   *  pane for every foreign row (external review, finding 2). */
  loadMessages?: (id: string, dir?: string) => Promise<unknown[]>;
  /** `renameSession`. Absent → Ctrl-R is inert, same reasoning; `dir` as above — a widened row must be
   *  renamed in the project that holds it, not in the one the REPL was launched from. */
  renameSession?: (id: string, title: string, dir?: string) => Promise<void>;
  /** Upstream's `isLoading` — the dim `· Refreshing…` clause on the header. */
  refreshing?: boolean;
  rows?: number; columns?: number;
}) {
  // Ref-backed (keys/refState.ts), the same law `MultiSelect` states: one stdin chunk dispatches several
  // events with no render guaranteed in between, so a handler that read the query — or the rename buffer —
  // from its render closure would act on the state as it was BEFORE the earlier keys of that chunk. A pasted
  // `"flaky\r"` must resume the post-filter row, and a pasted `"parser v2\r"` must save that title rather
  // than the empty buffer it started from.
  const [query, setQuery, queryRef] = useRefState("");
  const [stage, setStage] = useState<Stage>("list");
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  // A rename is written to disk immediately; the LIST is a snapshot the caller loaded before that happened,
  // so the new title is overlaid here. Upstream instead re-reads every log (`onLogsChanged`, L476517) — a
  // second full directory scan for one string we already know.
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [renameText, setRenameText, renameTextRef] = useRefState("");
  const [renameCursor, setRenameCursor, renameCursorRef] = useRefState(0);
  // `messages: null` is "still loading". No session id is kept beside it: which session the pane is about is
  // `focused`, and the token below is what makes a late arrival for another row a no-op. The RAW rows are
  // held, not the projected ones, so a resize re-projects at the new pane width instead of redrawing a
  // transcript wrapped for the terminal it was fetched at.
  const [preview, setPreview] = useState<{ messages: readonly unknown[] | null; count: number }>({ messages: null, count: 0 });
  // Wave S T10. The scope is the PICKER's, not the caller's: only this component knows which chords have been
  // pressed, and the caller's `sessions` prop is just the narrowed set it opened with. `widened` holds what the
  // last re-query returned (null = "nobody has widened anything yet, use the prop").
  const [scope, setScope, scopeRef] = useRefState<ResumeScope>(NARROWED_SCOPE);
  const [widened, setWidened] = useState<SessionInfo[] | null>(null);
  const [reloading, setReloading] = useState(false);
  const mounted = useRef(true);
  const previewToken = useRef(0);
  const reloadToken = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  const titleOf = (s: SessionInfo) => renames[s.sessionId] ?? sessionTitle(s);
  const rowsOf = () => widened ?? sessions;
  const filtered = filterSessions(rowsOf(), query, titleOf);
  /** The list as of the LATEST dispatched key — what an accept in the same chunk as a query keystroke must
   *  resolve its row against. Identical to `filtered` at render time; only handlers need the getter. */
  const liveFiltered = () => filterSessions(rowsOf(), queryRef.current, titleOf);
  const focused = filtered.find((s) => s.sessionId === focusId) ?? filtered[0];
  const liveFocused = () => { const f = liveFiltered(); return f.find((s) => s.sessionId === focusId) ?? f[0]; };
  const visible = resumeVisibleRows(rows ?? process.stdout.rows ?? 24);

  /** Escape in the list: clear a live filter first, close only when there is nothing to clear. Upstream
   *  splits these across its two modes — Esc is `clear` in search mode (L476627) and `cancel` in list mode —
   *  and a modeless search has to fold them onto one key. */
  const escapeList = () => { if (queryRef.current) setQuery(""); else onCancel(); };
  const backToList = () => { previewToken.current++; setStage("list"); };
  const openPreview = () => {
    const target = liveFocused();
    if (!target || !loadMessages) return;
    const id = target.sessionId, token = ++previewToken.current;
    setPreview({ messages: null, count: 0 });
    setStage("preview");
    void loadMessages(id, target.cwd).then((msgs) => {
      if (!mounted.current || previewToken.current !== token) return;
      // The `N messages` line is `isPreviewMessage`'s alone (sessionPickerModel.ts) — `msgs.length` counted
      // tool traffic as conversation (qa4-07 ii). The ROWS below come from the shared projection, which draws
      // that tool traffic; the two numbers are deliberately different things and only one is advertised.
      setPreview({ messages: msgs, count: previewMessageCount(msgs) });
    }, () => { if (mounted.current && previewToken.current === token) setPreview({ messages: [], count: 0 }); });
  };
  /** A widen chord: flip one axis, then re-query through the caller's loader. Tokened like the preview fetch —
   *  Ctrl+A Ctrl+A in one chunk fires two queries, and only the last one may land. */
  const widen = (patch: Partial<ResumeScope>) => {
    if (!reload) return;
    const next = { ...scopeRef.current, ...patch };
    setScope(next);
    const token = ++reloadToken.current;
    setReloading(true);
    void reload(next).then((rows) => {
      if (!mounted.current || reloadToken.current !== token) return;
      setWidened(rows); setReloading(false);
    }, () => { if (mounted.current && reloadToken.current === token) setReloading(false); });
  };
  const startRename = () => {
    if (!liveFocused() || !renameSession) return;
    setRenameText(""); setRenameCursor(0); setStage("rename");
  };
  const commitRename = () => {
    const target = liveFocused(), title = renameTextRef.current.trim();
    if (!target || !renameSession || !title) { backToList(); return; }
    setRenames((m) => ({ ...m, [target.sessionId]: title }));
    void renameSession(target.sessionId, title, target.cwd).catch(() => {});
    backToList();
  };

  // PREEMPTIVE, and it has to be. Scope precedence is MOUNT ORDER (registry.ts), so the `Select` this picker
  // renders is the INNER scope — and `Select` explicitly unbinds `ctrl+r`, which resolves as CONSUMED. An
  // ordinary scope here would therefore have its rename key eaten by its own child. `preemptive` is the
  // mechanism the registry already has for exactly this: the surface that OWNS the overlay outranks the
  // widget it embeds.
  //
  // What that costs, stated plainly: `activeContexts` puts preemptive scopes AHEAD of everything, so the
  // three keys bound here win at EVERY stage — `escape` included, in the list stage too, where the inner
  // Select's `select:cancel` therefore never resolves. That is behaviour-neutral only because
  // `sessionPicker:dismiss` routes the list stage into `escapeList`, which is the same function the
  // Select's own `onCancel` calls. Keep the two pointing at one function or they will drift.
  useKeyScope("SessionPicker", { preemptive: true });
  useKeyActions({
    // Registered PER STAGE. With no handler a matched action falls through to the fallback below (the
    // resolver treats a matched-but-unhandled action as unconsumed) — which is how `space` types a space
    // instead of opening a preview: in the rename field, and in the list once a query is being typed.
    // Upstream needs no such gate because its search is a MODE that disables the list; ours is modeless,
    // so a multi-word query would otherwise be unreachable. Space still previews from an empty query,
    // which is the state the footer advertises it in. Recorded divergence (T15).
    ...(stage === "list" && query === "" ? { "sessionPicker:preview": openPreview } : {}),
    ...(stage === "list" ? { "sessionPicker:rename": startRename } : {}),
    // The widen chords, gated exactly as upstream gates their hints (L476627): Ctrl+A on the reload seam
    // existing (`d`), Ctrl+W on that AND a detected worktree (`R`). Unregistered, they fall through to the
    // fallback, which drops every ctrl key — so an ungated repo sees a dead chord, not a stray search char.
    ...(stage === "list" && reload ? { "sessionPicker:allProjects": () => widen({ allProjects: !scopeRef.current.allProjects }) } : {}),
    ...(stage === "list" && reload && hasWorktree ? { "sessionPicker:allWorktrees": () => widen({ allWorktrees: !scopeRef.current.allWorktrees }) } : {}),
    "sessionPicker:dismiss": () => { if (stage !== "list") backToList(); else escapeList(); },
  });

  /** Everything the table did not consume, from BOTH fallbacks: the Select's `onUnhandledKey` while the list
   *  is up (the Select owns the innermost fallback there), and this component's own in the two stages where
   *  no Select is mounted. */
  const handleKey = (e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    if (stage === "preview") {
      const target = liveFocused();
      if (e.kind === "key" && e.name === "enter" && target) onPick(target);
      return;
    }
    if (stage === "rename") {
      const text = renameTextRef.current, at = renameCursorRef.current;
      const write = (next: string, to: number) => { setRenameText(next); setRenameCursor(Math.max(0, Math.min(next.length, to))); };
      if (e.kind === "key") {
        if (e.name === "enter") { commitRename(); return; }
        if (e.name === "left") { setRenameCursor(Math.max(0, at - 1)); return; }
        if (e.name === "right") { setRenameCursor(Math.min(text.length, at + 1)); return; }
        if (e.name === "home") { setRenameCursor(0); return; }
        if (e.name === "end") { setRenameCursor(text.length); return; }
        if (e.name === "backspace") { if (at > 0) write(text.slice(0, at - 1) + text.slice(at), at - 1); return; }
        if (e.name === "delete") { if (at < text.length) write(text.slice(0, at) + text.slice(at + 1), at); return; }
      }
      if (input && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(input)) write(text.slice(0, at) + input + text.slice(at), at + input.length);
      return;
    }
    // list: type to search (L476572-573 — a printable the list did not consume seeds the query).
    if (e.kind === "key" && e.name === "backspace") { setQuery(queryRef.current.slice(0, -1)); return; }
    if (input && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(input)) setQuery(queryRef.current + input);
  };
  useKeyFallback(handleKey);

  if (stage === "preview") {
    const target = focused;
    // Projected at RENDER time, off the retained rows: the pane width is a prop, so a resize while the pane
    // is open re-wraps the transcript for the box it is actually in. `focused` supplies the previewed
    // session's own directory (a widened row belongs to another project) and its id, which is what keys the
    // replay document's local entries.
    const pane = preview.messages === null ? null
      : previewItems(preview.messages, { width: previewWidth(columns ?? process.stdout.columns ?? 80), ...(target?.sessionId === undefined ? {} : { id: target.sessionId }), ...(target?.cwd === undefined ? {} : { cwd: target.cwd }) });
    return (
      <PickerFrame footer={PREVIEW_FOOTER} header={<Text bold color={role("suggestion")}>{target ? titleOf(target) : ""}</Text>}>
        {pane === null
          ? <Text dimColor>{PREVIEW_LOADING}</Text>
          : (
            <Box flexDirection="column">
              {pane.items.length === 0 ? <Text dimColor>{PREVIEW_EMPTY}</Text> : null}
              {/* The cut is at the TOP — the pane is tail-anchored — so the counted indicator sits above the
                  rows and points the way the missing ones went (`moreAbove`, the package's one spelling).
                  It reads `N+` when the message window cut the input first: the row count is then a floor. */}
              {pane.hidden > 0 ? <Text dimColor>{moreAbove(pane.hidden, pane.windowTruncated)}</Text> : null}
              {pane.items.map((item) => <RenderItemView key={item.id} item={item} />)}
              {/* `dGa` L476179, under the same top rule upstream puts it under. */}
              {target ? <Box marginTop={1}><Text>{previewMeta(target, preview.count)}</Text></Box> : null}
            </Box>
          )}
      </PickerFrame>
    );
  }

  if (stage === "rename" && focused) {
    return (
      <PickerFrame footer={RENAME_FOOTER} header={<Text bold>{RENAME_TITLE}</Text>}>
        <Box paddingTop={1}>
          <InputText text={renameText} cursor={renameCursor} placeholder={renamePlaceholder(focused)} />
        </Box>
      </PickerFrame>
    );
  }

  const position = Math.max(0, filtered.findIndex((s) => s.sessionId === focused?.sessionId)) + 1;
  const header = (
    <Text bold color={role("suggestion")}>
      {resumeHeader(position, filtered.length, filtered.length > visible)}
      {refreshing || reloading ? <Text dimColor>{REFRESHING}</Text> : null}
    </Text>
  );
  return (
    <PickerFrame footer={reload ? resumeFooter(scope, hasWorktree) : RESUME_FOOTER} header={header}>
      {/* `AL` (L435311): the prefix, then the query or its placeholder, in a rounded box of its own. */}
      <Box borderStyle="round" borderDimColor paddingX={1}>
        <Text dimColor={!query}>{SEARCH_PREFIX} </Text>
        <InputText text={query} cursor={query.length} placeholder={SEARCH_PLACEHOLDER} />
      </Box>
      {rowsOf().length === 0
        ? <Box paddingLeft={1}><Text dimColor>{noConversations(scope)}</Text></Box>
        : filtered.length === 0
          ? <Box paddingLeft={1}><Text dimColor>{noSessionsMatch(query)}</Text></Box>
          : null}
      <Select
        options={filtered.map((s) => ({ value: s.sessionId, label: titleOf(s), ...(sessionMeta(s) ? { description: sessionMeta(s) } : {}) }))}
        hideIndexes visibleOptionCount={visible}
        {...(rows !== undefined ? { rows } : {})} {...(columns !== undefined ? { columns } : {})}
        {...(focused ? { defaultFocusValue: focused.sessionId } : {})}
        onFocus={setFocusId}
        onChange={(value) => { const s = liveFiltered().find((x) => x.sessionId === value); if (s) onPick(s); }}
        // Required by SelectProps, and unreachable: the preemptive scope above answers escape first. It is
        // wired to the SAME function that handler routes to, so if the scope ever stops being preemptive
        // the behaviour is unchanged.
        onCancel={escapeList}
        onUnhandledKey={handleKey}
      />
    </PickerFrame>
  );
}
