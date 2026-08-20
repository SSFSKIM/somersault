// tui/select/Select.tsx — the `Select` primitive (F6 T1): the one list surface every F6 dialog embeds, so
// that `j`/`k`, `ctrl+n`/`ctrl+p`, PageUp/PageDown, Home/End, the digit shortcuts and the ❯/↑/↓ gutter are
// written ONCE and arrive everywhere at the same time. Transcribed from 2.1.220's `ZJs` (L397019) with its
// row wrapper `eg`/`Fae` (L396317/L396446), gutter `uJs` (L396391), two-column row `eQs` (L397260), input row
// `RLe` (L396465) and key handler `DJs` (L396669). Pure geometry lives in `selectModel.ts`.
//
// Keys are the F2 machinery, never `useInput`. Two paths, exactly as upstream:
//   · the `Select` context's eight actions, via `useSelectKeys`;
//   · a `useKeyFallback` for everything the table does not consume — the digits (bound in no context) and,
//     while a `type:"input"` row has the cursor, the typing itself. That second case is not a shortcut: with
//     an input row focused upstream does not REGISTER select:next/previous/accept at all (L396672-396701), so
//     `j`/`k`/`enter` resolve to an action with no handler and fall through to us — which is how the same key
//     is navigation on one row and a letter on the next. Only `up`/`down`/`ctrl+p`/`ctrl+n` still move
//     (L396727-396748); PageUp/PageDown/Home/End deliberately do nothing there (upstream returns first).
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { useKeyFallback } from "../keys/KeymapProvider.js";
import { useSelectKeys } from "../keys/selectKeys.js";
import { useRefState } from "../keys/refState.js";
import { toKeyFlags } from "../keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "../keys/types.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "../theme.js";
import { unicodeSupported, TICK } from "../figures.js";
import {
  clampVisible, digitTarget, isTwoColumn, labelColumnWidth, perOptionRows, truncateLabel, viewAfterFocus,
  windowBounds, VISIBLE_OPTION_COUNT, type SelectView,
} from "./selectModel.js";

/** `EJi` (L104958-104962): whether the terminal gets the unicode figure set or the ASCII fallback. Frozen at
 *  module load, like upstream's own `Ge`. `arrowUp`/`arrowDown` live in the shared base table (L104968) and
 *  are the same glyph either way; only `pointer` and `tick` have a fallback — `tick` is `figures.ts`'s `TICK`
 *  (F8 T8 review finding A: the same product-wide glyph `banner.ts`/`TaskPanel.tsx`/`MultiSelect.tsx` draw,
 *  re-exported here rather than recomputed so this file cannot drift from theirs), `pointer` is local since
 *  no other surface needs it. */
const UNICODE = unicodeSupported();
export const POINTER = UNICODE ? "❯" : ">";
export const ARROW_UP = "↑", ARROW_DOWN = "↓";
export { TICK };

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

export interface SelectOption {
  value: string; label: string; description?: string; disabled?: boolean;
  /** An `RLe` text row (L396465) rather than a pick-one row. */
  type?: "input";
  placeholder?: string; initialValue?: string;
  /** Render `<label><separator>` in front of the text (L396471 `yJs`). Separator defaults to `", "` (L396606). */
  showLabelWithValue?: boolean; labelValueSeparator?: string;
  /** Submitting an EMPTY input row normally cancels the whole Select; with this flag it submits instead, and
   *  the caller decides what empty means (L397115-397118 — the name reads backwards, the bundle does not). */
  allowEmptySubmitToCancel?: boolean;
  /** `false` keeps the description at full brightness (L397241 `dimDescription !== !1`). */
  dimDescription?: boolean;
  /** F6 T10: the row BODY, rendered by the caller. Upstream has no such hook because upstream's list-shaped
   *  surfaces that need a rich row are not `ZJs` at all — the rewind picker maps its own rows (L487190-193).
   *  Ours are, because one list primitive is the point, so the escape hatch lives here: a row that needs more
   *  than a string (two lines, per-span colour — the rewind row's prompt line plus its `<file> +A -R` badge)
   *  supplies a node and `label` degrades to the measurement/fallback string. `focused` is passed rather than
   *  read from a context because the caller colours ITS OWN spans by it, and the pointer gutter alone is not
   *  the whole focus affordance upstream draws. Node rows opt out of `highlightText` (the caller owns its
   *  spans) — everything else about the row, gutter and index column included, is unchanged. */
  node?: (focused: boolean) => React.ReactNode;
}

export interface SelectProps {
  options: SelectOption[];
  /** `inputText` is present only for a `type:"input"` row. Upstream passes the value alone and streams the
   *  text back through a per-option `onChange` (L396607); one callback carrying both is our shape. */
  onChange: (value: string, inputText?: string) => void;
  onCancel: () => void;
  /** Hides the index column AND disables digit selection — upstream folds both into one switch by turning
   *  `hideIndexes` into `disableSelection: "numeric"` (L397066). */
  hideIndexes?: boolean;
  visibleOptionCount?: number;
  inlineDescriptions?: boolean;
  highlightText?: string;
  /** The row that reads as the CURRENT value: `success` plus a trailing tick (`du.value`, L397020/L396371). */
  defaultValue?: string;
  defaultFocusValue?: string;
  onInputModeToggle?: (value: string) => void;
  /** Enter on an input row whose text is EMPTY, when the row has no `allowEmptySubmitToCancel` (wave 2 t2,
   *  s2qa3-10). Upstream has no such hook — its feedback rows carry the flag, so an empty Enter is an answer
   *  there and never reaches this branch at all. ccx declines that answer (optionRows.ts records why), which
   *  left the empty Enter falling through to `onCancel` — and a caller whose Esc means something of its own
   *  then had Enter silently performing it. The five consult bodies spend Esc on leaving input mode, so QA's
   *  Tab-then-Enter folded the field shut under them and read as a reverted amendment. Absent, the fall-through
   *  to `onCancel` stands, which is exactly upstream's behaviour for every list that never asked. The ROW is
   *  handed over, not just its value: a caller with two feedback ends has to know which one submitted empty. */
  onEmptySubmit?: (row: SelectOption) => void;
  /** An input row's text, reported on every mutation of it (wave T t5). Upstream needs no such prop — its
   *  rows carry a per-option `onChange` (L396607) and the host owns the text — but ours keeps it privately in
   *  `inputs` and publishes it only on submit, which leaves a caller unable to answer "is this field empty".
   *  The permission dialogs must answer exactly that, once per focus move (`collapseOnFocusChange`), so this
   *  is the hook that makes the text observable. Fired from `write()`, the single path every mutation takes,
   *  so a mirror kept off it cannot drift; never fired for a row's `initialValue`, which the caller already
   *  supplied. */
  onInputChange?: (value: string, text: string) => void;
  /** The focused row, reported on MOUNT and on every change (`jr`'s own `onFocus`, L505286; the reporting is
   *  `m5o` L396843-845). Upstream drives a hint node off it; the F6 dialogs drive their key gating off it,
   *  because "is a text row focused" is the difference between `y` meaning yes and `y` being a letter, and
   *  only this component knows the answer. The mount fire is required, not a nicety: a list whose FIRST row
   *  is a text row would otherwise leave a caller's letter shortcuts live over a text field. */
  onFocus?: (value: string) => void;
  /** Keys the list itself did not consume: everything except a digit shortcut, and NOTHING at all while a
   *  text row has the cursor (there, every key is typing). It is how an embedding dialog keeps letter
   *  shortcuts of its own — the legacy a/A/d/D of the permission dialogs — without stealing the fallback
   *  from the list: `fallbackHandler` hands the keyboard to exactly ONE handler, and inside a Select that
   *  handler has to be the Select's. */
  onUnhandledKey?: (e: KeyEvent | TextEvent) => void;
  /** The scroll WINDOW, reported on mount and whenever it moves — the sibling of `onFocus`, and for the same
   *  reason: the window lives in this component's reducer (`viewAfterFocus`, with upstream's scroll-one-row-
   *  early hysteresis) and a caller that recomputed it would drift. F6 T10's rewind picker renders upstream's
   *  `↑ N more above` / `↓ N more below` counters (L487190/193) OUTSIDE the list, and those counts are
   *  `start` and `count - end`. Reported after a paint, so a handler may setState freely. */
  onViewChange?: (view: SelectView) => void;
  /** Terminal rows ONE option occupies — the height of a `node` row's box, so a two-line body can never push
   *  the list taller than the window it was sized for (upstream's own rewind row is `height: p ? 3 : 2`,
   *  L487192). It deliberately does NOT feed `clampVisible`: a caller tall enough to need this also computes
   *  its own `visibleOptionCount` from its own chrome budget (`rewindVisibleRows`), and threading the height
   *  into the clamp as well produced an arithmetic no caller could reach and no test could pin (t10 review). */
  rowHeight?: 1 | 2 | 3;
  rows?: number; columns?: number;
  focusColor?: ThemeTokenName;
  /** Which key context this list pushes. `"Select"` (the default) is the OVERLAY flavour — its bindings unbind
   *  the six root globals, which is right for a picker the USER opened. A list that is answering the MODEL is a
   *  DECISION surface and must keep them (Ctrl-C's exit hint, Ctrl-O's pager…), so it passes
   *  `"SelectDecision"`. Added in the F6 T2 review after the multiSelect migration killed five root globals
   *  over a parked question; bindings.ts's `SelectDecision` block carries the full argument, and every F6
   *  dialog that answers the model (QuestionDialog today, the permission/plan dialogs in tasks 5-9) sets it. */
  context?: "Select" | "SelectDecision";
}

/** L397122-397124: the first literal occurrence of `highlightText` inside the label goes bold (`sK_`). */
function labelNode(label: string, highlight?: string): React.ReactNode {
  if (!highlight || !label.includes(highlight)) return label;
  const at = label.indexOf(highlight);
  return <>{label.slice(0, at)}<Text bold>{highlight}</Text>{label.slice(at + highlight.length)}</>;
}

/** The minimal text state an input row needs: characters plus a block cursor. Deliberately NOT the composer's
 *  editor — no paste chips and no image paste inside a Select (upstream's `RLe` has both; recorded divergence).
 *  Exported for `MultiSelect`, whose input row is the same `RLe` with a check-box in front of it (F6 T2). */
export function InputText({ text, cursor, placeholder }: { text: string; cursor: number; placeholder?: string }) {
  if (text.length === 0) return <Text><Text inverse> </Text>{placeholder ? <Text color={role("inactive")}>{placeholder}</Text> : null}</Text>;
  const at = cursor >= text.length ? " " : text[cursor]!;
  return <Text>{text.slice(0, cursor)}<Text inverse>{at}</Text>{text.slice(cursor + 1)}</Text>;
}

export function Select({
  options, onChange, onCancel, hideIndexes = false, visibleOptionCount = VISIBLE_OPTION_COUNT,
  inlineDescriptions = false, highlightText, defaultValue, defaultFocusValue, onInputModeToggle, onEmptySubmit, onInputChange, onFocus, onUnhandledKey,
  onViewChange, rowHeight,
  rows = process.stdout.rows ?? 24, columns = process.stdout.columns ?? 80, focusColor = "suggestion",
  context = "Select",
}: SelectProps) {
  const count = options.length;
  const twoColumn = isTwoColumn(options, inlineDescriptions);
  const visible = clampVisible(visibleOptionCount, rows, perOptionRows(twoColumn));

  // Ref-backed throughout (keys/refState.ts), for the reason MultiSelect spells out: ONE stdin chunk parses
  // into several events and the provider dispatches them with NO render in between, so a handler that read
  // its render closure would act on pre-chunk state — a same-chunk `j`+Enter would accept the row the cursor
  // just LEFT, which in a permission dialog is an approval of the wrong thing (codex review, F6 close).
  // Renders still come off the state half; only the read paths inside handlers changed.
  const [, setInputs, inputsRef] = useRefState<Record<string, string>>({});
  const [value, setValue] = useState<string | undefined>(defaultValue);
  const [view, setView, viewRef] = useRefState<SelectView>((() => {
    const at = Math.max(0, options.findIndex((o) => o.value === defaultFocusValue));
    return { focus: at, ...windowBounds(count, at, visible) };
  })());
  const [cursor, setCursor, cursorRef] = useRefState((() => {
    const at = Math.max(0, options.findIndex((o) => o.value === defaultFocusValue));
    return options[at]?.type === "input" ? (options[at]!.initialValue ?? "").length : 0;
  })());

  const textOf = (o: SelectOption) => inputsRef.current[o.value] ?? o.initialValue ?? "";
  // The window is derived defensively rather than through an effect: `options`/`rows` can change under a live
  // Select (a filtered picker is exactly that), and a stale window would render rows that no longer exist.
  const normalize = (v: SelectView): SelectView => {
    const f = Math.max(0, Math.min(v.focus, count - 1));
    return v.focus === f && v.end - v.start === Math.min(visible, count) ? v : { focus: f, ...windowBounds(count, f, visible, v) };
  };
  const win = normalize(view);
  /** The window as of the LATEST dispatched key, not the latest render — every handler below reads it. */
  const liveWin = () => normalize(viewRef.current);
  const current = options[win.focus];
  const inputFocused = current?.type === "input";

  // `m5o` L396843-845 reports the focused VALUE from an effect keyed on it (`focusedValue ?? options[0].value`),
  // so upstream announces the INITIAL row on mount and not only on a move. We do both, and the ref is what
  // makes the pair idempotent — whoever gets there first reports, the other is a no-op. The synchronous call
  // in `moveTo` is not redundant: a caller that GATES KEYS on focus (the F6 dialogs, where `y` is a decision
  // on a pick-one row and a letter on a text row) must not be one flush behind the cursor.
  const reportedRef = useRef<string>();
  const reportFocus = (value: string | undefined) => {
    if (value === undefined || reportedRef.current === value) return;
    reportedRef.current = value;
    onFocus?.(value);
  };
  useEffect(() => { reportFocus(current?.value); });
  // Same idempotence trick as the focus report, on the pair that identifies a window. Not folded into the
  // effect above: focus and window move independently (a page jump can leave the focused VALUE alone when the
  // list is shorter than a page, and `options` changing can move the window with no focus change at all).
  const viewKeyRef = useRef<string>();
  useEffect(() => {
    const key = `${win.start}:${win.end}:${win.focus}`;
    if (viewKeyRef.current === key) return;
    viewKeyRef.current = key;
    onViewChange?.(win);
  });

  const moveTo = (target: number) => {
    const next = viewAfterFocus(liveWin(), count, visible, target);
    setView(next);
    const landed = options[next.focus];
    setCursor(landed?.type === "input" ? textOf(landed).length : 0);
    reportFocus(landed?.value);
  };
  const accept = () => {                                   // L396693-396700: never a disabled row
    const row = options[liveWin().focus];
    if (!row || row.disabled === true) return;
    setValue(row.value); onChange(row.value);
  };
  /** L397113-397118 / L397229-397232: empty submits cancel unless the option opts out — or unless the caller
   *  claimed the empty submit for itself (`onEmptySubmit`, wave 2 t2). The digit path below deliberately does
   *  NOT route there: L396772-782 already gives an empty digit-hit its own non-answer (focus the row). */
  const submitInput = (o: SelectOption) => {
    const text = textOf(o);
    if (text.trim() || o.allowEmptySubmitToCancel) onChange(o.value, text);
    else if (onEmptySubmit) onEmptySubmit(o);
    else onCancel();
  };
  /** L396768-396785: a digit on a normal row picks it; on an input row it submits when the row already holds
   *  text (or may submit empty) and otherwise just moves the cursor into it. */
  const chooseByDigit = (index: number) => {
    const o = options[index]!;
    if (o.type !== "input") { onChange(o.value); return; }
    const text = textOf(o);
    if (text.trim() || o.allowEmptySubmitToCancel) { onChange(o.value, text); return; }
    moveTo(index);
  };

  // `index` is a GETTER, not `win.focus`: two movement keys in one chunk would otherwise both step off the
  // same pre-chunk row (`jj` landing on row 2, not row 3).
  useSelectKeys({ count, index: () => liveWin().focus, page: visible, wrap: true, inputFocused, context, onMove: moveTo, onAccept: accept, onCancel });

  useKeyFallback((e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    const at = liveWin().focus, row = options[at];
    // Tab is checked ahead of everything, on ANY row, not just an input one (L396712-396715).
    if (e.kind === "key" && e.name === "tab" && !e.ctrl && !e.alt) { if (row) onInputModeToggle?.(row.value); return; }
    if (row?.type === "input") {
      const text = textOf(row), pos = cursorRef.current;
      const write = (next: string, to: number) => { setInputs({ ...inputsRef.current, [row.value]: next }); setCursor(Math.max(0, Math.min(next.length, to))); onInputChange?.(row.value, next); };
      if (e.kind === "key") {
        if (e.name === "down" || (e.ctrl && e.name === "n")) { moveTo((at + 1) % count); return; }
        if (e.name === "up" || (e.ctrl && e.name === "p")) { moveTo((at - 1 + count) % count); return; }
        if (e.name === "enter") { submitInput(row); return; }
        if (e.name === "left") { setCursor(Math.max(0, pos - 1)); return; }
        if (e.name === "right") { setCursor(Math.min(text.length, pos + 1)); return; }
        if (e.name === "home") { setCursor(0); return; }
        if (e.name === "end") { setCursor(text.length); return; }
        if (e.name === "backspace") { if (pos > 0) write(text.slice(0, pos - 1) + text.slice(pos), pos - 1); return; }
        if (e.name === "delete") { if (pos < text.length) write(text.slice(0, pos) + text.slice(pos + 1), pos); return; }
      }
      if (input && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(input)) write(text.slice(0, pos) + input + text.slice(pos), pos + input.length);
      return;
    }
    // Digits reach us because they are bound in no context; `hideIndexes` is the one switch that kills them.
    if (!hideIndexes && e.kind === "key" && !key.ctrl && !key.meta && /^[0-9]$/.test(input)) {
      const at = digitTarget(options, input);
      if (at >= 0) chooseByDigit(at);                      // a miss (disabled / "0" / past the end) is a DEAD key
      return;
    }
    onUnhandledKey?.(e);
  });

  const indexWidth = hideIndexes ? 0 : String(count).length;   // `EBt` (L397167)
  const indexPad = indexWidth + 2;                             // `padEnd(EBt + 2)` (L397241)
  const labelGutter = hideIndexes ? 0 : indexPad;              // `SBt` (L397174)
  const labelColumn = twoColumn ? labelColumnWidth(options, { columns, indexPad: labelGutter, currentValue: value }) : 0;

  return (
    <Box flexDirection="column">
      {options.slice(win.start, win.end).map((o, i) => {
        const at = win.start + i;
        const focused = at === win.focus, isCurrent = value === o.value, disabled = o.disabled === true;
        const showDown = win.end < count && at === win.end - 1, showUp = win.start > 0 && at === win.start;
        const color = disabled ? undefined : isCurrent ? role("success") : focused ? role(focusColor) : undefined;
        const descDim = disabled || o.dimDescription !== false;
        // `uJs` (L396391-396438) / `eQs`'s inline copy (L397278). The `disabled → blank` first branch of `uJs`
        // is dead for every compact caller (`Fae` passes no `disabled`), so it is deliberately not reproduced.
        const gutter = focused ? <Text color={role(focusColor)}>{POINTER}</Text>
          : showDown ? <Text dimColor>{ARROW_DOWN}</Text>
            : showUp ? <Text dimColor>{ARROW_UP}</Text> : <Text> </Text>;
        const index = <Text dimColor>{`${at + 1}.`.padEnd(indexPad)}</Text>;

        if (o.type === "input") {
          const text = textOf(o);
          const withLabel = inlineDescriptions || o.showLabelWithValue === true;   // `yJs` (L396471)
          const separator = o.labelValueSeparator ?? ", ";
          // wave T t8 (qa3-06, A16). Upstream prints `<label><separator>` unconditionally on a focused labelled
          // row (L396606) and can afford to: its text input inverts the placeholder's FIRST CHARACTER, so the
          // caret costs no column and the row reads `No, say something`. `InputText` draws an inverse-video
          // SPACE ahead of the placeholder instead (the only shape available without owning the placeholder's
          // characters), which lands a second space after the separator. Trimming the separator's trailing
          // whitespace while the field is focused AND empty restores upstream's exact rendered width; a row
          // holding text prints the separator verbatim, `", "` and the Bash prefix row's `": "` alike.
          const focusedSeparator = text === "" ? separator.replace(/\s+$/, "") : separator;
          return (
            <Box key={o.value} flexDirection="column" flexShrink={0}>
              <Box flexDirection="row" gap={1}>
                <Box flexShrink={0}>{gutter}</Box>
                <Box flexDirection="row" flexShrink={0}>
                  {/* `RLe` renders the number unconditionally — with `hideIndexes` it becomes a bare `1.`,
                      because only `maxIndexWidth` is zeroed (L397142 + L396593-396596). Faithful, quirk and all. */}
                  <Box flexShrink={0}><Text dimColor>{`${at + 1}.`.padEnd(indexWidth + 2)}</Text></Box>
                  {withLabel
                    ? focused
                      ? <><Text color={role(focusColor)}>{o.label}{focusedSeparator}</Text><InputText text={text} cursor={cursor} placeholder={o.placeholder} /></>
                      : <Text>{o.label}{text ? separator : null}{text || null}</Text>
                    : focused
                      ? <InputText text={text} cursor={cursor} placeholder={o.placeholder || o.label} />
                      : <Text color={text ? undefined : role("inactive")}>{text || o.placeholder || o.label}</Text>}
                </Box>
                {isCurrent ? <Text color={role("success")}>{TICK()}</Text> : null}
              </Box>
              {o.description
                ? <Box paddingLeft={indexWidth + 4}><Text dimColor={o.dimDescription !== false} color={color}>{o.description}</Text></Box>
                : null}
            </Box>
          );
        }

        if (twoColumn) {                                     // L397195-397210
          const extra = isCurrent ? 2 : 0;
          const shown = truncateLabel(o.label, labelColumn - 2 - labelGutter - extra);
          const pad = labelColumn - (2 + labelGutter + stringWidth(shown) + extra);
          return (
            <Box key={o.value} flexDirection="row" flexShrink={0}>
              <Box flexShrink={0}>{gutter}</Box>
              <Box flexDirection="row" flexShrink={0}>
                <Text> </Text>
                <Text dimColor={disabled} color={color}>{!hideIndexes ? index : null}{labelNode(shown, highlightText)}</Text>
                {isCurrent ? <Text> <Text color={role("success")}>{TICK()}</Text></Text> : null}
                {pad > 0 ? <Text>{" ".repeat(pad)}</Text> : null}
              </Box>
              <Box flexGrow={1} marginLeft={2}>
                <Text wrap="wrap" dimColor={descDim} color={color}>{o.description || " "}</Text>
              </Box>
            </Box>
          );
        }

        // A caller-rendered body (see `node`). The row is a fixed-height column so a two-line body cannot
        // spill past the window the visible-count was computed for — upstream's own rewind row is exactly
        // this shape (`height: p ? 3 : 2, overflow:"hidden"`, L487192).
        if (o.node) return (
          <Box key={o.value} flexDirection="row" gap={1} flexShrink={0} {...(rowHeight ? { height: rowHeight, overflow: "hidden" as const } : {})}>
            <Box flexShrink={0}>{gutter}</Box>
            {!hideIndexes ? <Box flexShrink={0}>{index}</Box> : null}
            <Box flexDirection="column" flexShrink={1}>{o.node(focused)}</Box>
          </Box>
        );

        return (                                             // L397241, inside `Fae`'s gap-1 row
          <Box key={o.value} flexDirection="row" gap={1}>
            <Box flexShrink={0}>{gutter}</Box>
            <Box flexDirection="row" flexShrink={0}>
              {!hideIndexes ? index : null}
              <Text dimColor={disabled} color={color}>
                {labelNode(o.label, highlightText)}
                {inlineDescriptions && o.description ? <Text dimColor={descDim}> {o.description}</Text> : null}
              </Text>
            </Box>
            {!inlineDescriptions && o.description
              // upstream asks for `wrap-trim` here (L397241); stock Ink 5 has no such mode, so `wrap` it is.
              ? <Box flexShrink={99} marginLeft={2}><Text wrap="wrap" dimColor={descDim} color={color}>{o.description}</Text></Box>
              : null}
            {isCurrent ? <Text color={role("success")}>{TICK()}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
