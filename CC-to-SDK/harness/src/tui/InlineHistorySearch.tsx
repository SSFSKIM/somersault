// tui/src/InlineHistorySearch.tsx — CM58's stateful half: the hook the composer mounts and the one dim row
// it paints. The walk itself, the two literals and the buffer transforms are pure and live in
// historySearchInline.ts; read that file's header first — it carries the bundle transcription and the four
// recorded divergences.
//
// WHY A HOOK INSIDE THE COMPOSER RATHER THAN AN OVERLAY. Upstream's `r9f` is a hook called from the composer
// (bundle L495279) and its search field renders in the composer's own hint-row region (`xWf` at L493785,
// inside the same early-return chain as `Pasting…` and `paste again to expand`). Nothing about it is a
// surface of its own: the buffer being rewritten under the user IS the search result. So `inputOwnerRef`
// stays `"composer"`, and the only thing that changes while a search is live is which scope is innermost.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { bufferText, type EditorState } from "./editor.js";
import { hydrateEntry, readHistory } from "./promptHistory.js";
import type { HistoryScope } from "./historySearch.js";
import { findInlineMatch, installMatch, restoreDraft, NO_MATCH_PROMPT, SEARCH_PROMPT, type SearchDraft, type SearchEntry } from "./historySearchInline.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";

/** THE inline walk's scope, fixed. Upstream's inline corpus is `kBs()` (bundle L317456), which streams the
 *  whole prompt log with no project or session filter — `everywhere` is the only scope it has, and `r9f`'s
 *  action memo (L489750) registers four actions with `historySearch:cycleScope` deliberately not among them
 *  (only the picker registers it, L492190). So this is a constant, not state: see divergence 2 in
 *  historySearchInline.ts for the corpus difference that remains. */
const SEARCH_SCOPE: HistoryScope = "everywhere";

export interface InlineSearch {
  searching: boolean;
  query: string;
  failed: boolean;
  /** Read by the composer's key path BEFORE anything else, for the same reason `stateRef` exists there: the
   *  keymap dispatches from a passive-effect listener, so two keys arriving in one stdin chunk see a scope
   *  flag that is one render stale. This ref is never stale. */
  searchingRef: React.MutableRefObject<boolean>;
  open(): void;
  next(): void;
  accept(): void;
  cancel(): void;
  execute(): void;
  /** The search field. Returns true when the event was consumed — which, while a search is live, is always:
   *  divergence 3 (one input, not two) means every key that is not a bound action belongs to the query or is
   *  swallowed, and none of them may reach the editor. */
  handleKey(e: KeyEvent | TextEvent): boolean;
}

export function useInlineHistorySearch(opts: {
  stateRef: React.MutableRefObject<EditorState>;
  commitState: (next: EditorState | ((s: EditorState) => EditorState)) => EditorState;
  /** The SESSION's cwd and id, and the env every history path reads — the composer's own three, threaded so
   *  a test can point the whole feature at a temp fleet root (see ChatComposer's `historyEnv`). */
  projectRef: React.MutableRefObject<string>;
  sessionIdRef: React.MutableRefObject<string | undefined>;
  envRef: React.MutableRefObject<NodeJS.ProcessEnv>;
  /** Run the buffer as if Enter had been pressed. Deliberately NOT a re-implementation of `G` (L489707):
   *  routing back through the composer's own submit keeps chip expansion, the history append and the queue
   *  rules identical to typing the prompt by hand, instead of a second submit path that can drift. */
  submitBuffer: () => void;
  /** Called on open, so CM56's `search history` hint comes down the moment its chord is used — upstream's
   *  `dismissSearchHint` (`z`, bundle L489630). */
  onOpen?: () => void;
  /** The composer's own `onDraftStart`, fired when a match lands in a buffer that was EMPTY. Every other
   *  route that fills an empty buffer from outside already reports it (the prefill effect, the queue drain),
   *  and ChatApp's Esc-Esc rewind arm is the reader: without this, arming rewind and then recalling a prompt
   *  left "Press Esc again to rewind" on screen under a composer that no longer has an empty buffer to
   *  rewind from. */
  onDraftStart?: () => void;
}): InlineSearch {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const searchingRef = useRef(false);
  const queryRef = useRef(""); queryRef.current = query;
  const draft = useRef<SearchDraft | null>(null);
  const entries = useRef<SearchEntry[]>([]);
  /** The scanned corpus, cached for the search's life — the picker's own `u.current` (bundle L492159). */
  const cache = useRef<SearchEntry[] | null>(null);
  /** Where the walk stopped, and the displays it has already shown (`R.current`, L489665). */
  const from = useRef(0);
  const seen = useRef<Set<string>>(new Set());
  const disposed = useRef(false);
  useEffect(() => () => { disposed.current = true; }, []);

  const load = (): SearchEntry[] => {
    if (cache.current) return cache.current;
    const env = opts.envRef.current;
    // `project`/`sessionId` are passed for completeness and are inert at `everywhere` scope — `readHistory`
    // applies neither filter there. They are what would make any other scope answerable, and nothing here
    // asks for one (see `SEARCH_SCOPE`).
    const rows = readHistory({ scope: SEARCH_SCOPE, project: opts.projectRef.current, sessionId: opts.sessionIdRef.current }, env);
    const out = rows.map((r) => hydrateEntry(r, env));
    cache.current = out;
    return out;
  };

  /** `M` (L489646). `keep` is upstream's `Y`: false restarts the walk from the newest entry with a clean
   *  dedup Set (a query change), true continues it (ctrl+r). */
  const scan = (keep: boolean, q: string) => {
    if (!q) {                                            // L489648: an emptied query puts the parked draft back
      from.current = 0; seen.current = new Set(); setFailed(false);
      if (draft.current) opts.commitState((s) => restoreDraft(s, draft.current!));
      return;
    }
    if (!keep) { from.current = 0; seen.current = new Set(); }
    const m = findInlineMatch(entries.current, from.current, q, seen.current);
    if (!m) { setFailed(true); return; }                 // L489670: `m(!0)` — the buffer keeps the last match
    seen.current.add(m.entry.display);
    from.current = m.index + 1;
    setFailed(false);
    const wasEmpty = bufferText(opts.stateRef.current).length === 0;
    opts.commitState((s) => installMatch(s, m.entry, m.offset, q));
    if (wasEmpty && bufferText(opts.stateRef.current).length > 0) opts.onDraftStart?.();
  };

  // Upstream's own effect (L493421): every query change re-runs the walk from the top.
  useEffect(() => {
    if (!searching || disposed.current) return;
    entries.current = load();
    scan(false, query);
  }, [query, searching]);   // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { searchingRef.current = false; setSearching(false); setQuery(""); setFailed(false); draft.current = null; from.current = 0; seen.current = new Set(); };

  const api: InlineSearch = {
    searching, query, failed, searchingRef,
    // `B` (L489683). Upstream's registration is `isActive: !a`, so a ctrl+r while already searching is not a
    // re-open — it is `historySearch:next`, which the HistorySearch context resolves instead.
    open() {
      if (searchingRef.current) return;
      const s = opts.stateRef.current;
      draft.current = { display: bufferText(s), cursor: s.cursor, pastedContents: s.pastedContents };
      cache.current = null;                              // a fresh search re-reads: the log grew since the last one
      setQuery(""); setFailed(false);
      from.current = 0; seen.current = new Set();
      searchingRef.current = true; setSearching(true);
      opts.onOpen?.();
    },
    // `W` (L489686): `M(!0)` — same query, same dedup Set, so the walk steps to the next OLDER distinct match.
    next() { if (searchingRef.current) scan(true, queryRef.current); },
    // `U` (L489692): keep whatever is in the buffer and leave. With no match ever found the buffer still holds
    // the parked draft, which is upstream's outcome too (it never called its setter).
    accept() { if (searchingRef.current) close(); },
    // `j` (L489704).
    cancel() {
      if (!searchingRef.current) return;
      const parked = draft.current;
      if (parked) opts.commitState((s) => restoreDraft(s, parked));
      close();
    },
    // `G` (L489707). Both arms reduce to "submit what is in the buffer": an empty query means the parked
    // draft is still there (the effect above restored it), and a live match means the match is. See
    // `submitBuffer` for why this is a re-entry rather than its own submit.
    execute() { if (!searchingRef.current) return; close(); opts.submitBuffer(); },
    handleKey(e) {
      if (!searchingRef.current) return false;
      const { input, key } = toKeyFlags(e);
      // RECORDED DIVERGENCE (5): forward-DELETE is treated as a backspace here, so it shortens the query and
      // cancels on an empty one. Upstream's `V` (L489725) tests `Y.key === "backspace"` only, and its query
      // field is a real one-line input where Delete means delete-forward. We have no caret inside the query
      // (the row paints a block at its end), so there is nothing forward to delete — and this is the same
      // pairing the picker's own field has always used (`key.backspace || key.delete`,
      // HistorySearchOverlay.tsx), so the two search surfaces stay consistent with each other.
      if (key.backspace || key.delete) {
        // `V` (L489725): a backspace on an already-empty query is the cancel, not a no-op.
        if (queryRef.current.length === 0) { api.cancel(); return true; }
        setQuery((q) => q.slice(0, -1));
        return true;
      }
      if (input && input >= " " && !key.ctrl && !key.meta) { setQuery((q) => q + input); return true; }
      return true;                                       // divergence 3: nothing else may reach the editor
    },
  };
  return api;
}

/** `xWf` (bundle L493443): a ROW of `<Text dimColor>{label}</Text>` and the query, gap 1 — and NOTHING else.
 *  Its input is a real cursor-showing text field upstream; ours paints the inverse block the overlay's field
 *  already uses. There is deliberately no scope chip: the inline corpus has one scope and no key to change
 *  it, so a chip would advertise a control that does not exist (the picker, which does cycle, keeps its own
 *  `Search prompts · {scope}` title at L492211). */
export function InlineSearchRow({ query, failed }: { query: string; failed: boolean }): React.ReactElement {
  return (
    <Box paddingX={1} flexDirection="row">
      <Text dimColor>{failed ? NO_MATCH_PROMPT : SEARCH_PROMPT}</Text>
      <Text dimColor>{" " + query}</Text>
      <Text inverse>{" "}</Text>
    </Box>
  );
}
