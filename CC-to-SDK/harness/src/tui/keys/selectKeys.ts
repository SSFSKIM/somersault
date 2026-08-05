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

export function useSelectKeys({ count, index, page = PAGE_ROWS, wrap = false, inputFocused = false, context = "Select", onMove, onAccept, onCancel }: {
  count: number;
  /** The focused row. A GETTER when the caller keeps its focus ref-backed (`Select` does): one stdin chunk
   *  dispatches several events with no render between them, so a plain number would make both movement keys
   *  of a `jj` chunk step off the SAME pre-chunk row. Callers whose focus cannot move twice per chunk pass
   *  the number. */
  index: number | (() => number);
  page?: number;
  /** Which context to push. `"Select"` (the default) is the OVERLAY flavour — it unbinds the six root globals;
   *  `"SelectDecision"` is the same eight actions without that suppression, for a list that is answering the
   *  model rather than a picker the user opened (bindings.ts spells the distinction out). */
  context?: "Select" | "SelectDecision";
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
  const at = () => (typeof index === "function" ? index() : index);
  const to = (i: number) => { if (count > 0) onMove(Math.max(0, Math.min(last, i))); };
  const step = (i: number) => { if (count > 0) onMove(wrap ? (i + count) % count : Math.max(0, Math.min(last, i))); };
  useKeyScope(context);
  useKeyActions(inputFocused ? { "select:cancel": () => onCancel() } : {
    "select:previous": () => step(at() - 1), "select:next": () => step(at() + 1),
    "select:pageUp": () => to(at() - page), "select:pageDown": () => to(at() + page),
    "select:first": () => to(0), "select:last": () => to(last),
    // accept/cancel still fire on an empty list: cancel must always close, and every caller guards its own
    // "is there a row here" question (an empty picker's Enter has always been a no-op, not an error).
    "select:accept": () => onAccept(), "select:cancel": () => onCancel(),
  });
}
