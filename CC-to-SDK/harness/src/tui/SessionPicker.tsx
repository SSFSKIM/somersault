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
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { InputText, Select } from "./select/Select.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";
import type { SessionInfo } from "./useChat.js";
import {
  filterSessions, NO_CONVERSATIONS, noSessionsMatch, PREVIEW_EMPTY, PREVIEW_FOOTER, PREVIEW_LOADING,
  previewLines, previewMeta, REFRESHING, RENAME_FOOTER, RENAME_TITLE, renamePlaceholder, RESUME_FOOTER,
  resumeHeader, resumeVisibleRows, SEARCH_PLACEHOLDER, SEARCH_PREFIX, sessionMeta, sessionTitle,
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

export function SessionPicker({ sessions, onPick, onCancel, loadMessages, renameSession, refreshing = false, rows, columns }: {
  sessions: SessionInfo[];
  onPick: (s: SessionInfo) => void;
  onCancel: () => void;
  /** The preview fetch (`getSessionMessages`). Absent → Space is inert, which is what an unwired caller
   *  should get rather than a pane that can never fill. */
  loadMessages?: (id: string) => Promise<unknown[]>;
  /** `renameSession`. Absent → Ctrl-R is inert, same reasoning. */
  renameSession?: (id: string, title: string) => Promise<void>;
  /** Upstream's `isLoading` — the dim `· Refreshing…` clause on the header. */
  refreshing?: boolean;
  rows?: number; columns?: number;
}) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>("list");
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  // A rename is written to disk immediately; the LIST is a snapshot the caller loaded before that happened,
  // so the new title is overlaid here. Upstream instead re-reads every log (`onLogsChanged`, L476517) — a
  // second full directory scan for one string we already know.
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [renameText, setRenameText] = useState("");
  const [renameCursor, setRenameCursor] = useState(0);
  // `lines: null` is "still loading". No session id is kept beside it: which session the pane is about is
  // `focused`, and the token below is what makes a late arrival for another row a no-op.
  const [preview, setPreview] = useState<{ lines: ReturnType<typeof previewLines> | null; count: number }>({ lines: null, count: 0 });
  const mounted = useRef(true);
  const previewToken = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  const titleOf = (s: SessionInfo) => renames[s.sessionId] ?? sessionTitle(s);
  const filtered = filterSessions(sessions, query, titleOf);
  const focused = filtered.find((s) => s.sessionId === focusId) ?? filtered[0];
  const visible = resumeVisibleRows(rows ?? process.stdout.rows ?? 24);

  /** Escape in the list: clear a live filter first, close only when there is nothing to clear. Upstream
   *  splits these across its two modes — Esc is `clear` in search mode (L476627) and `cancel` in list mode —
   *  and a modeless search has to fold them onto one key. */
  const escapeList = () => { if (query) setQuery(""); else onCancel(); };
  const backToList = () => { previewToken.current++; setStage("list"); };
  const openPreview = () => {
    if (!focused || !loadMessages) return;
    const id = focused.sessionId, token = ++previewToken.current;
    setPreview({ lines: null, count: 0 });
    setStage("preview");
    void loadMessages(id).then((msgs) => {
      if (!mounted.current || previewToken.current !== token) return;
      setPreview({ lines: previewLines(msgs), count: msgs.length });
    }, () => { if (mounted.current && previewToken.current === token) setPreview({ lines: [], count: 0 }); });
  };
  const startRename = () => {
    if (!focused || !renameSession) return;
    setRenameText(""); setRenameCursor(0); setStage("rename");
  };
  const commitRename = () => {
    const target = focused, title = renameText.trim();
    if (!target || !renameSession || !title) { backToList(); return; }
    setRenames((m) => ({ ...m, [target.sessionId]: title }));
    void renameSession(target.sessionId, title).catch(() => {});
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
    "sessionPicker:dismiss": () => { if (stage !== "list") backToList(); else escapeList(); },
  });

  /** Everything the table did not consume, from BOTH fallbacks: the Select's `onUnhandledKey` while the list
   *  is up (the Select owns the innermost fallback there), and this component's own in the two stages where
   *  no Select is mounted. */
  const handleKey = (e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    if (stage === "preview") {
      if (e.kind === "key" && e.name === "enter" && focused) onPick(focused);
      return;
    }
    if (stage === "rename") {
      const write = (next: string, at: number) => { setRenameText(next); setRenameCursor(Math.max(0, Math.min(next.length, at))); };
      if (e.kind === "key") {
        if (e.name === "enter") { commitRename(); return; }
        if (e.name === "left") { setRenameCursor(Math.max(0, renameCursor - 1)); return; }
        if (e.name === "right") { setRenameCursor(Math.min(renameText.length, renameCursor + 1)); return; }
        if (e.name === "home") { setRenameCursor(0); return; }
        if (e.name === "end") { setRenameCursor(renameText.length); return; }
        if (e.name === "backspace") { if (renameCursor > 0) write(renameText.slice(0, renameCursor - 1) + renameText.slice(renameCursor), renameCursor - 1); return; }
        if (e.name === "delete") { if (renameCursor < renameText.length) write(renameText.slice(0, renameCursor) + renameText.slice(renameCursor + 1), renameCursor); return; }
      }
      if (input && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(input)) write(renameText.slice(0, renameCursor) + input + renameText.slice(renameCursor), renameCursor + input.length);
      return;
    }
    // list: type to search (L476572-573 — a printable the list did not consume seeds the query).
    if (e.kind === "key" && e.name === "backspace") { setQuery((q) => q.slice(0, -1)); return; }
    if (input && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(input)) setQuery((q) => q + input);
  };
  useKeyFallback(handleKey);

  if (stage === "preview") {
    const target = focused;
    return (
      <PickerFrame footer={PREVIEW_FOOTER} header={<Text bold color={role("suggestion")}>{target ? titleOf(target) : ""}</Text>}>
        {preview.lines === null
          ? <Text dimColor>{PREVIEW_LOADING}</Text>
          : (
            <Box flexDirection="column">
              {preview.lines.length === 0 ? <Text dimColor>{PREVIEW_EMPTY}</Text> : null}
              {preview.lines.map((l, i) => (
                <Text key={i} wrap="truncate-end">
                  {l.role === "user" ? <Text color={role("suggestion")}>{"> "}</Text> : <Text dimColor>{"  "}</Text>}
                  <Text dimColor={l.role !== "user"}>{l.text}</Text>
                </Text>
              ))}
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
      {refreshing ? <Text dimColor>{REFRESHING}</Text> : null}
    </Text>
  );
  return (
    <PickerFrame footer={RESUME_FOOTER} header={header}>
      {/* `AL` (L435311): the prefix, then the query or its placeholder, in a rounded box of its own. */}
      <Box borderStyle="round" borderDimColor paddingX={1}>
        <Text dimColor={!query}>{SEARCH_PREFIX} </Text>
        <InputText text={query} cursor={query.length} placeholder={SEARCH_PLACEHOLDER} />
      </Box>
      {sessions.length === 0
        ? <Box paddingLeft={1}><Text dimColor>{NO_CONVERSATIONS}</Text></Box>
        : filtered.length === 0
          ? <Box paddingLeft={1}><Text dimColor>{noSessionsMatch(query)}</Text></Box>
          : null}
      <Select
        options={filtered.map((s) => ({ value: s.sessionId, label: titleOf(s), ...(sessionMeta(s) ? { description: sessionMeta(s) } : {}) }))}
        hideIndexes visibleOptionCount={visible}
        {...(rows !== undefined ? { rows } : {})} {...(columns !== undefined ? { columns } : {})}
        {...(focused ? { defaultFocusValue: focused.sessionId } : {})}
        onFocus={setFocusId}
        onChange={(value) => { const s = filtered.find((x) => x.sessionId === value); if (s) onPick(s); }}
        // Required by SelectProps, and unreachable: the preemptive scope above answers escape first. It is
        // wired to the SAME function that handler routes to, so if the scope ever stops being preemptive
        // the behaviour is unchanged.
        onCancel={escapeList}
        onUnhandledKey={handleKey}
      />
    </PickerFrame>
  );
}
