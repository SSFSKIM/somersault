// tui/src/RewindPicker.tsx — the Esc-Esc rewind picker, rebuilt in F6 T10 onto upstream's own anatomy
// (`Q4f`, bundle L487055-194) and onto the `Select` primitive. Everything pure — the literals, the window
// geometry, the row projections, the option table, the explanation lines — lives in `rewindModel.ts`; this
// file is the two panels, their keys, and the windowed dry-run driver.
//
// THREE THINGS THAT CHANGED SHAPE, and why:
//
//  · THE LIST RUNS OLDEST-FIRST NOW, with the synthetic `(current)` row LAST and the cursor starting on it
//    (`k(T.length - 1)`, L487056). The C5 build rendered newest-first, which put `(current)` — a row that
//    means "now" — either at the top or nowhere. Reading downwards is reading forwards in time, ↑ from the
//    cursor is the most recent prompt, and the `↑ N more above` / `↓ N more below` counters mean what they
//    say. `rewindAnchorsFrom` still hands us newest-first (that is what the dry-run window walks); the
//    reversal is a display decision and lives here.
//  · THE ROW SUMMARY IS COMPUTED BEFORE SELECTION, not lazily on Enter. Upstream computes every row's diff
//    from an in-memory `fileHistory` in one effect (L487173-188); ours costs a UDS round trip and an engine
//    call each (see `REWIND_SUMMARY_WINDOW` for the measurement), so the walk is windowed, sequential, and
//    newest-first, with each row lighting up as its result lands and the window extending when the cursor
//    reaches the end of what has been computed.
//  · THE KEYS ARE `Select`'S.
//
// TWO UPSTREAM SURFACES ARE DELIBERATELY ABSENT, both recorded for the T15 ledger rather than reconstructed:
//   · the LEADING `/resume <id> (previous session)` row (L487056's `H`/`a`, rendered at L487192). It exists
//     only when the caller passes `parentSessionId` + `onResumePreviousSession` — a forked-session lineage
//     our `RewindOps` has no concept of at all (`rewindAnchors` reads one transcript and knows nothing about
//     what it was forked from). Faking it would put a row on screen that cannot resume anything.
//   · the `Restored the code, but skipped N files…` arm (L487142). `rewind()` returns `Promise<void>` and
//     `RewindDryRun` has no `skippedLinks` field, so the count that sentence is about does not exist on our
//     wire. See `rewindFailureHeading` for the three arms that ARE reachable. The picker still pushes `MessageSelector`, but only for the jump aliases it
//    retargets onto `select:first`/`select:last` and for the `escape` that must work in the empty state
//    where no list is mounted (bindings.ts's block carries the full argument). Every other key — ↑/↓, j/k,
//    ctrl+n/ctrl+p, PageUp/PageDown, Home/End, Enter, Esc — is the shared list's, which is the point of
//    there being a shared list. The scope-stage `1`/`2`/`3` are gone as a hand-rolled fallback and are back
//    as `Select`'s own digit selection, which is what upstream's confirmation panel has always had.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";
import { useKeyActions, useKeyScope } from "./keys/KeymapProvider.js";
import { Select, type SelectOption } from "./select/Select.js";
import type { SelectView } from "./select/selectModel.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";
import { formatRelativeTime } from "./format.js";
import {
  anchorLabel, canRestoreCode, clipRowText, codeExplanation, confirmPrompt, conversationExplanation,
  CURRENT_LABEL, CURRENT_ROW, defaultRestoreOption, EMPTY_MESSAGE, moreAbove, moreBelow, NO_CODE_CHANGES,
  NO_CODE_RESTORE, RESTORE_LABELS, restoreOptions, REWIND_EMPTY, REWIND_FOOTER, REWIND_FOOTER_EMPTY,
  REWIND_MANUAL_WARNING, REWIND_PROMPT, REWIND_ROW_HEIGHT, REWIND_ROW_PADDING_RIGHT, REWIND_SUMMARY_WINDOW,
  REWIND_TITLE, rewindVisibleRows, rowSummary, type RestoreOption,
} from "./rewindModel.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

/** `g3` (L184138-184158): `+A` and `-B` in the word-diff roles, a single space between them when both are
 *  present, and NOTHING AT ALL when both are zero. The minus is an ASCII hyphen in the bundle, not U+2212. */
function DiffBadge({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <Text>
      {added > 0 ? <Text color={role("diffAddedWord")}>+{added}</Text> : null}
      {added > 0 && removed > 0 ? " " : null}
      {removed > 0 ? <Text color={role("diffRemovedWord")}>-{removed}</Text> : null}
    </Text>
  );
}

/** `kXa` (L487289-348) — one line, whatever the prompt is. `(current)` and `((empty message))` are italic;
 *  a bash prompt wears a `bashBorder` `!`; a slash command prints as it was typed. */
function AnchorLine({ anchor, focused, columns, current = false }: {
  anchor?: RewindAnchor; focused: boolean; columns: number; current?: boolean;
}) {
  const color = focused ? role("suggestion") : undefined;
  if (current) return <Text italic color={color}>{CURRENT_LABEL}</Text>;
  const label = anchorLabel(anchor?.text ?? "");
  const width = Math.max(1, columns - REWIND_ROW_PADDING_RIGHT);
  if (label.kind === "empty") return <Text italic color={color}>{EMPTY_MESSAGE}</Text>;
  if (label.kind === "bash") return <Text><Text color={role("bashBorder")}>!</Text><Text color={color}> {clipRowText(label.command, width)}</Text></Text>;
  if (label.kind === "skill") return <Text color={color}>Skill({label.name})</Text>;
  if (label.kind === "command") return <Text color={color}>{clipRowText(label.text, width)}</Text>;
  return <Text color={color}>{clipRowText(label.text, width)}</Text>;
}

/** The row's second line (L487192). `dry === undefined` means the dry run has not landed and the line is
 *  BLANK — upstream's `ge in Se` gate, and the reason a row is three terminal rows tall whether or not it
 *  has a summary yet: the height must not change under the cursor as results arrive. */
function SummaryLine({ dry, focused }: { dry: RewindDryRun | null | undefined; focused: boolean }) {
  if (dry === undefined) return <Text> </Text>;
  const summary = rowSummary(dry);
  if (summary.kind === "unavailable") return <Text dimColor color={role("warning")}>{NO_CODE_RESTORE}</Text>;
  if (summary.kind === "none") return <Text dimColor={!focused} color={role("inactive")}>{NO_CODE_CHANGES}</Text>;
  return (
    <Text dimColor={!focused} color={role("inactive")}>
      {summary.text}<DiffBadge added={summary.insertions} removed={summary.deletions} />
    </Text>
  );
}

/** `nr` (L184045-184120) reduced to what this dialog uses: the bold title in its colour, the body, and the
 *  dim italic input guide. Local rather than shared — `nr` is a much larger component (exit-hint state, a
 *  measured header, a nested terminal-size context) and nothing else in the tree needs it yet. */
function RewindFrame({ footer, children }: { footer?: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={role("suggestion")} paddingX={1}>
      <Text bold color={role("suggestion")}>{REWIND_TITLE}</Text>
      <Box flexDirection="column" marginTop={1}>{children}</Box>
      {footer ? <Box marginTop={1}><Text dimColor italic>{footer}</Text></Box> : null}
    </Box>
  );
}

/** The windowed dry-run driver. Walks `anchors` (newest-first) sequentially up to `limit`, publishing each
 *  result as it lands; `ensure(index)` raises the limit by another window when the cursor reaches the end of
 *  what has been computed. Sequential, not `Promise.all`: each call is a UDS round trip plus an engine call,
 *  and twenty of those in flight at once against one host is a stampede, not a speed-up. */
function useRewindSummaries(anchors: readonly RewindAnchor[], onDryRun: (uuid: string) => Promise<RewindDryRun>) {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, RewindDryRun | null>>(new Map());
  const [limit, setLimit] = useState(REWIND_SUMMARY_WINDOW);
  const alive = useRef(true);
  const cursor = useRef(0);               // how far the walk has got, in newest-first index space
  const walking = useRef(false);          // a live walk picks up a raised limit itself, so it must not restart
  const limitRef = useRef(limit); limitRef.current = limit;
  const anchorsRef = useRef(anchors); anchorsRef.current = anchors;
  const dryRunRef = useRef(onDryRun); dryRunRef.current = onDryRun;

  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (walking.current) return;
    walking.current = true;
    void (async () => {
      while (alive.current && cursor.current < Math.min(limitRef.current, anchorsRef.current.length)) {
        const anchor = anchorsRef.current[cursor.current]!;
        // A THROW IS A RESULT, not a hole: `null` is upstream's "computed, no stats", which is what renders
        // the `⚠ No code restore` warning. A hole would leave the row blank forever.
        const dry = await dryRunRef.current(anchor.uuid).catch((): RewindDryRun => ({ canRewind: false }));
        if (!alive.current) return;
        cursor.current++;
        setSummaries((m) => new Map(m).set(anchor.uuid, dry.canRewind ? dry : null));
      }
      walking.current = false;
    })();
  }, [limit]);

  return {
    summaries,
    /** `index` is newest-first. Extends the window when the cursor lands on (or past) its last computed row. */
    ensure: (index: number) => { if (index >= limitRef.current - 1) setLimit((l) => (index >= l - 1 ? index + 1 + REWIND_SUMMARY_WINDOW : l)); },
  };
}

export function RewindPicker({ anchors, onDryRun, onConfirm, onClose, rows = process.stdout.rows ?? 24, columns = process.stdout.columns ?? 80 }: {
  anchors: RewindAnchor[];
  onDryRun: (uuid: string) => Promise<RewindDryRun>;
  onConfirm: (anchor: RewindAnchor, scope: RewindScope) => void;
  onClose: () => void;
  rows?: number; columns?: number;
}) {
  const [selected, setSelected] = useState<RewindAnchor | null>(null);
  const [focusedOption, setFocusedOption] = useState<RestoreOption>("both");
  // The list's cursor OUTLIVES the list. Upstream's `w` is parent state (L487056) and the confirmation panel
  // renders beside it rather than instead of it, so Escape lands the cursor back where it was; ours swaps the
  // whole panel, which unmounts the `Select` and would otherwise re-open on `(current)` every time — a
  // cancelled confirmation that silently throws away which message you were on.
  const [listFocus, setListFocus] = useState<string>(CURRENT_ROW);
  const [view, setView] = useState<SelectView>({ focus: 0, start: 0, end: 0 });
  const { summaries, ensure } = useRewindSummaries(anchors, onDryRun);

  // Display order: oldest-first, `(current)` last (L487056's `T`).
  const ordered = useMemo(() => [...anchors].reverse(), [anchors]);
  const newestIndexOf = (displayIndex: number) => anchors.length - 1 - displayIndex;

  // The scope stage's escape goes BACK to the list, never straight out — losing a selection silently is the
  // one thing this two-stage dialog must not do. The empty state has no `Select` at all, so this is the
  // handler that answers escape there (bindings.ts keeps `escape` on this context for exactly that case).
  useKeyScope("MessageSelector");
  useKeyActions({ "messageSelector:dismiss": () => { if (selected) setSelected(null); else onClose(); } });

  const dryOf = (a: RewindAnchor | null): RewindDryRun | null | undefined => (a ? summaries.get(a.uuid) : undefined);

  if (!selected) {
    const options: SelectOption[] = ordered.map((a) => ({
      value: a.uuid,
      label: a.text,
      node: (focused) => (
        <>
          <AnchorLine anchor={a} focused={focused} columns={columns} />
          <SummaryLine dry={summaries.get(a.uuid)} focused={focused} />
        </>
      ),
    }));
    options.push({ value: CURRENT_ROW, label: CURRENT_LABEL, node: (focused) => <AnchorLine focused={focused} columns={columns} current /> });
    const total = options.length;
    return (
      <RewindFrame footer={anchors.length ? REWIND_FOOTER : REWIND_FOOTER_EMPTY}>
        {anchors.length === 0 ? <Text dimColor>{REWIND_EMPTY}</Text> : (
          <>
            <Text>{REWIND_PROMPT}</Text>
            {view.start > 0 ? <Box paddingLeft={1}><Text dimColor>{moreAbove(view.start)}</Text></Box> : null}
            <Select
              options={options} hideIndexes rowHeight={REWIND_ROW_HEIGHT} visibleOptionCount={rewindVisibleRows(rows)}
              rows={rows} columns={columns} defaultFocusValue={listFocus} focusColor="permission"
              onFocus={setListFocus}
              onViewChange={(v) => { setView(v); if (v.focus < ordered.length) ensure(newestIndexOf(v.focus)); }}
              onChange={(value) => {
                // The synthetic row selects nothing — upstream reaches `!e.includes(we)` and closes (L487091).
                const anchor = ordered.find((a) => a.uuid === value);
                if (!anchor) { onClose(); return; }
                setSelected(anchor);
                setFocusedOption(defaultRestoreOption({ code: canRestoreCode(summaries.get(anchor.uuid)), conversation: anchor.prevUuid != null }));
              }}
              onCancel={onClose}
            />
            {view.end < total ? <Box paddingLeft={1}><Text dimColor>{moreBelow(total - view.end)}</Text></Box> : null}
          </>
        )}
      </RewindFrame>
    );
  }

  const dry = dryOf(selected);
  const code = canRestoreCode(dry), conversation = selected.prevUuid != null;
  const options = restoreOptions({ code, conversation });
  const explainCode = codeExplanation(focusedOption, dry);
  const when = selected.timestamp ? formatRelativeTime(new Date(selected.timestamp)) : undefined;
  return (
    <RewindFrame>
      <Text>{confirmPrompt(dry)}</Text>
      <Box flexDirection="column" paddingLeft={1} borderStyle="single" borderRight={false} borderTop={false} borderBottom={false} borderLeft borderLeftDimColor>
        <AnchorLine anchor={selected} focused={false} columns={columns} />
        {when ? <Text dimColor>({when})</Text> : null}
      </Box>
      <Box flexDirection="column">
        <Text dimColor>{conversationExplanation(focusedOption)}</Text>
        {explainCode.kind === "unchanged"
          ? <Text dimColor>{explainCode.text}</Text>
          : <Text dimColor>The code will be restored <DiffBadge added={explainCode.insertions} removed={explainCode.deletions} /> in {explainCode.files}.</Text>}
      </Box>
      <Select
        options={options.map((o) => ({ value: o, label: RESTORE_LABELS[o] }))}
        defaultFocusValue={defaultRestoreOption({ code, conversation })}
        rows={rows} columns={columns}
        onFocus={(value) => setFocusedOption(value as RestoreOption)}
        onChange={(value) => { if (value === "nevermind") setSelected(null); else onConfirm(selected, value as RewindScope); }}
        onCancel={() => setSelected(null)}
      />
      {code ? <Box marginBottom={1}><Text dimColor>{REWIND_MANUAL_WARNING}</Text></Box> : null}
    </RewindFrame>
  );
}
