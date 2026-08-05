// tui/keys/selectKeys.ts — the `Select` context in one hook (F2 task 8). Five list overlays push the same
// context and want the same eight actions — SessionPicker, ModelPicker, ThemeDialog, OutputStylePicker,
// BgTasksPanel — and only "what does moving / accepting / cancelling MEAN here" differs, so that is all a
// caller supplies. Writing it once is what makes KB14 (j/k, ctrl+n/ctrl+p) and KB15 (pageup/pagedown/home/end)
// arrive in all five at the same time instead of in whichever two hand-rolled them.
//
// The scope is pushed from HERE, which is still "the component pushes its own scope": the hook runs inside the
// component's render, so its registration carries that component's mount order (registry.ts — order IS mount
// order), and a conditionally-rendered overlay is innermost exactly while it is on screen.
import { useKeyActions, useKeyScope } from "./KeymapProvider.js";

/** Rows a pageUp/pageDown moves when a list renders every row it has — which all five do today. A component
 *  that windows its list passes its visible-row count instead. */
export const PAGE_ROWS = 10;

export function useSelectKeys({ count, index, page = PAGE_ROWS, wrap = false, inputFocused = false, onMove, onAccept, onCancel }: {
  count: number;
  index: number;
  page?: number;
  /** Wrap next-from-last to the first row and previous-from-first to the last, as upstream's option map does
   *  (`nz_`, L396859/L396875). Off by default: the five F2 overlays shipped clamping and their tests pin it;
   *  the F6 `Select` primitive opts in, which is what upstream's own dialogs do. Pages/first/last still clamp. */
  wrap?: boolean;
  /** The focused row is a `type:"input"` row. Upstream builds its Select action map inside `if (!m)` where `m`
   *  is exactly this (L396672-396701), so next/previous/accept are NOT REGISTERED while a text row has the
   *  cursor — the keys fall through to the component, which types them. Only cancel survives (L396702). */
  inputFocused?: boolean;
  /** Called with an ALREADY-CLAMPED (or wrapped) row index; never called at all on an empty list. */
  onMove: (next: number) => void;
  onAccept: () => void;
  onCancel: () => void;
}): void {
  const last = Math.max(0, count - 1);
  const to = (i: number) => { if (count > 0) onMove(Math.max(0, Math.min(last, i))); };
  const step = (i: number) => { if (count > 0) onMove(wrap ? (i + count) % count : Math.max(0, Math.min(last, i))); };
  useKeyScope("Select");
  useKeyActions(inputFocused ? { "select:cancel": () => onCancel() } : {
    "select:previous": () => step(index - 1), "select:next": () => step(index + 1),
    "select:pageUp": () => to(index - page), "select:pageDown": () => to(index + page),
    "select:first": () => to(0), "select:last": () => to(last),
    // accept/cancel still fire on an empty list: cancel must always close, and every caller guards its own
    // "is there a row here" question (an empty picker's Enter has always been a no-op, not an error).
    "select:accept": () => onAccept(), "select:cancel": () => onCancel(),
  });
}
