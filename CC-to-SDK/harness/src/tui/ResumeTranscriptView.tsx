// tui/src/ResumeTranscriptView.tsx — the full-screen `/resume` transcript takeover (T-RESUME T2, D-W9).
// Canon's `yvc` (bundle L583551): the picker's preview stage does not open a pane INSIDE the picker's own
// frame — it replaces the picker element wholesale with this separate component (`SessionPicker.tsx`'s
// `stage === "preview"` arm returns this in the picker's own place, before `PickerFrame`). No frame, no
// header/title row (ccx's old bold title had no canon twin), no alt-screen, no explicit height: this is a
// plain flex column mounted in the SAME slot the picker occupied, sized by whatever the dock chain already
// gives it — `rows`/`columns` are advisory inputs to the WINDOW arithmetic below, never a box height.
//
// Rendering runs the REAL transcript substrate (`transcriptItems`, sessionPickerModel.ts T1) — replayDocument
// + the detail-all projection + wrapItemsToWidth — tail-anchored to canon's own cap (L563246-563388), not the
// old in-pane preview's much smaller excerpt (deleted this task).
//
// KEYS. `y`/`n` resolve here through the SAME "SessionPicker" key context `SessionPicker.tsx` already pushes
// preemptively (bindings.ts: `y → confirm:yes`, `n → confirm:no`, reusing the action names the `Confirmation`
// context already carries rather than minting new ones — `useKeyActions` registers by ACTION NAME, which is
// context-agnostic, so this component needs no scope of its own to answer them). Enter and Escape are
// DELIBERATELY NOT handled here: Enter has no binding in the SessionPicker table (adding one would steal it
// from the list stage's inner `Select`, which needs the bare key for `select:accept` — SessionPicker.tsx's
// own raw key fallback answers it instead, calling the same resume path this component's `y` calls), and
// Escape is already answered everywhere in this picker by `sessionPicker:dismiss` (SessionPicker.tsx).
import React from "react";
import { Box, Text } from "ink";
import { useKeyActions } from "./keys/KeymapProvider.js";
import { RenderItemView } from "./toolRenderer.js";
import type { SessionInfo } from "./useChat.js";
import {
  PREVIEW_EMPTY, PREVIEW_FOOTER, PREVIEW_LOADING, PREVIEW_LOADING_HINT, previewMessageCount, previewMeta,
  transcriptItems, type PreviewLoad,
} from "./sessionPickerModel.js";

/** Canon's own render cap (`te`, L563246): a flat 200 collapsed items in classic mode (older rows land in
 *  terminal scrollback, exactly as canon's own do), narrowed to whatever the fullscreen seam actually has
 *  (`rows`, the caller's `overlayRows()`) when the view is mounted inside it. Exported so the caller (and
 *  tests) can compute the SAME number without re-deriving the arithmetic. */
const RESUME_VIEW_CAP = 200;
export const resumeViewBudget = (fullscreen: boolean, rows: number): number =>
  fullscreen ? Math.min(RESUME_VIEW_CAP, rows) : RESUME_VIEW_CAP;

export function ResumeTranscriptView({ session, load, columns, rows, fullscreen, onResume, onExit }: {
  /** The highlighted row: `previewMeta`'s `<relative> · N messages[ · branch]` and `transcriptItems`'s
   *  `id`/`cwd` (a widened row's own directory, not this process's — same reasoning as the old pane). */
  session: SessionInfo;
  load: PreviewLoad;
  /** The SLOT's geometry, not a box size: `columns` is the projection's wrap width (no frame padding to
   *  subtract now — canon's view starts flush at the left edge, `Transcript.tsx`'s own convention), `rows`
   *  feeds `resumeViewBudget` only when `fullscreen` is true. */
  columns: number;
  rows: number;
  fullscreen: boolean;
  /** Enter/`y` — resumes with THE LOADED PAYLOAD (canon `onSelect(Ccs ?? Gwt)`, L583586-583588), never a
   *  second read: a no-op unless `load.state === "loaded"` (nothing to resume with otherwise). */
  onResume: (messages: unknown[]) => void;
  /** Esc/`n` — back to the intact list. */
  onExit: () => void;
}) {
  useKeyActions({
    "confirm:yes": () => { if (load.state === "loaded") onResume(load.messages); },
    "confirm:no": onExit,
  });

  // Loading (canon L583604-583606): a BARE padded column, no frame chrome at all — not even the footer's
  // border. This is the one arm that does not compose the items-plus-footer layout below.
  if (load.state === "loading") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>{PREVIEW_LOADING}</Text>
        <Text dimColor>{PREVIEW_LOADING_HINT}</Text>
      </Box>
    );
  }

  const budget = resumeViewBudget(fullscreen, rows);
  const messages = load.state === "loaded" ? load.messages : [];
  const { items } = transcriptItems(messages, {
    width: columns, id: session.sessionId, budget, ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
  });
  // The footer's own count, `isPreviewMessage`'s predicate exactly as the old pane ran it — never
  // `messages.length`, which counts tool traffic the count excludes (qa4-07 ii, unchanged by this task).
  const count = load.state === "loaded" ? previewMessageCount(load.messages) : 0;

  return (
    <Box flexDirection="column">
      {/* `failed` is the ONLY arm that prints failure copy; a `loaded`-but-empty session (items.length === 0)
          renders nothing above the footer — canon has no such string (spec R-1, L583628). */}
      {load.state === "failed"
        ? <Text dimColor>{PREVIEW_EMPTY}</Text>
        : items.map((item) => <RenderItemView key={item.id} item={item} />)}
      {/* The footer (canon `gvc`, L583622): flexShrink:0, a single TOP border only, dim, paddingLeft:2. Row 1
          is the meta line, plain; row 2 is the key hints, dim — `PREVIEW_FOOTER` verbatim (canon L583618). */}
      <Box flexShrink={0} flexDirection="column" borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderTopDimColor paddingLeft={2}>
        <Text>{previewMeta(session, count)}</Text>
        <Text dimColor>{PREVIEW_FOOTER}</Text>
      </Box>
    </Box>
  );
}
