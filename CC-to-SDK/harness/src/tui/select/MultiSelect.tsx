// tui/select/MultiSelect.tsx — the `MultiSelect` primitive (F6 T2), `Select`'s check-box sibling: the same
// windowed list, but every row is a `[ ]`/`[✔]` toggle and the list ends in a bold submit row. Transcribed
// from 2.1.220's `V3` (L397431) → `mQs` (L397448, the renderer) → `tQs` (L397306, the state + key handler),
// over the SAME row chrome `Select` uses (`eg`/`Fae` L396317/L396446, gutter `uJs` L396391, input row `RLe`
// L396465). Pure geometry is shared with `Select` through `selectModel.ts` — this file forks no window math.
//
// Three places where `tQs` is genuinely a DIFFERENT handler from `Select`'s `DJs`, and why the keymap wiring
// below is not just `useSelectKeys`:
//   1. THE SUBMIT ROW IS NOT AN OPTION. Movement wraps inside the option ring (`nz_`, L396859/L396875), and
//      the submit row is reachable only by stepping DOWN off the last option (L397367-397377) and left by
//      stepping UP off it (L397378-397384). So `previous` from the first row lands on the LAST OPTION, never
//      on the submit row, and `next` from the submit row is a dead end — neither of which a single wrapping
//      ring of `options.length + 1` can express.
//   2. `space` AND `enter` share one branch (L397393-397409): submit-row focused → submit; no `submitButtonText` at
//      all → enter submits (space still toggles); otherwise toggle the focused row.
//   3. A digit TOGGLES at the 1-based absolute index (L397410-397416) instead of picking, and `tQs` binds no
//      home/end at all — so `select:first`/`select:last` are deliberately left unregistered and fall through.
//
// Keys are the F2 machinery, never `useInput`, and follow `Select`'s two paths exactly: the `Select` context's
// actions via `useKeyActions`, plus a `useKeyFallback` for what the table does not name — the digits, `space`,
// `tab`, and (while a `type:"input"` row has the cursor) the typing itself. That last case is upstream's own
// gate: with an input row focused `tQs` returns early for every key outside
// {up, down, escape, tab, return, ctrl+n, ctrl+p, ctrl+return} (L397348-397351), which is what leaves `j`,
// `k`, a digit and a space as literal characters on that row and navigation everywhere else.
import React from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyFallback, useKeyScope } from "../keys/KeymapProvider.js";
import { toKeyFlags } from "../keys/editorAdapter.js";
import { useRefState } from "../keys/refState.js";
import type { KeyEvent, TextEvent } from "../keys/types.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "../theme.js";
import { ARROW_DOWN, ARROW_UP, InputText, POINTER, TICK, type SelectOption } from "./Select.js";
import { clampVisible, digitTarget, perOptionRows, viewAfterFocus, windowBounds, VISIBLE_OPTION_COUNT, type SelectView } from "./selectModel.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

export interface MultiSelectProps {
  options: SelectOption[];
  /** CONTROLLED: the caller owns the selection and mutates it from `onToggle`. `tQs` keeps it in an array
   *  (L397307) purely to preserve pick ORDER — a `Set` iterates in insertion order and does the same. */
  values: ReadonlySet<string>;
  onToggle: (value: string) => void;
  /** The submit row was activated. The caller reads its own `values` — upstream hands them over (`l(d)`,
   *  L397399) only because its state lives inside the hook; ours does not. */
  onSubmit: () => void;
  onCancel: () => void;
  /** "Submit" on the last question, "Next" otherwise — the CALLER decides (L504153). An empty string is
   *  upstream's `!Fbr`: no submit row at all, and `enter` submits directly (L397402-397405). */
  submitButtonText: string;
  /** Streams a `type:"input"` row's text back out (upstream's per-option `onChange`, L397331-397332). */
  onInputChange?: (value: string, text: string) => void;
  visibleOptionCount?: number;
  rows?: number;
  focusColor?: ThemeTokenName;
  /** See `SelectProps.context`: `"Select"` is the overlay flavour (root globals unbound), `"SelectDecision"`
   *  the decision flavour that keeps them. A list answering the MODEL must pass the latter. */
  context?: "Select" | "SelectDecision";
}

export function MultiSelect({
  options, values, onToggle, onSubmit, onCancel, submitButtonText, onInputChange,
  visibleOptionCount = VISIBLE_OPTION_COUNT, rows = process.stdout.rows ?? 24, focusColor = "suggestion",
  context = "Select",
}: MultiSelectProps) {
  const count = options.length;
  const hasSubmit = submitButtonText.length > 0;
  // L397455: `Nbr(visibleOptionCount, hasAnyDescription ? "compact-vertical" : "compact")` — the row-height
  // question here is only "does any option carry a description", not `Select`'s two-column test.
  const visible = clampVisible(visibleOptionCount, rows, perOptionRows(options.some((o) => !!o.description)));

  // Ref-backed throughout (keys/refState.ts): one stdin chunk dispatches several events with NO render in
  // between, so a handler that read its render closure would toggle from a stale selection or type into a
  // stale buffer. `Select` predates this file and reads render state; the bug class is real either way.
  const [, setInputs, inputsRef] = useRefState<Record<string, string>>(
    Object.fromEntries(options.filter((o) => o.type === "input" && o.initialValue).map((o) => [o.value, o.initialValue!])),
  );
  const [view, setView, viewRef] = useRefState<SelectView>({ focus: 0, ...windowBounds(count, 0, visible) });
  const [cursor, setCursor, cursorRef] = useRefState(0);
  const [submitFocused, setSubmitFocused, submitFocusedRef] = useRefState(false);

  const textOf = (o: SelectOption) => inputsRef.current[o.value] ?? o.initialValue ?? "";
  /** The window is derived defensively rather than through an effect — `options`/`rows` can change under a
   *  live list, and a stale window would render rows that no longer exist (same reasoning as `Select`). */
  const normalize = (v: SelectView): SelectView => {
    const f = Math.max(0, Math.min(v.focus, count - 1));
    return v.focus === f && v.end - v.start === Math.min(visible, count) ? v : { focus: f, ...windowBounds(count, f, visible, v) };
  };
  const win = normalize(view);
  const focused = submitFocused ? undefined : options[win.focus];
  const inputFocused = focused?.type === "input";

  const moveTo = (target: number) => {
    if (count === 0) return;
    const next = viewAfterFocus(normalize(viewRef.current), count, visible, target);
    setView(next);
    const landed = options[next.focus];
    setCursor(landed?.type === "input" ? textOf(landed).length : 0);
  };
  /** L397367-397377 (down/ctrl+n/j) — the submit row is a dead end without `onDownFromLastItem`, which no
   *  F6 caller passes. */
  const focusNext = () => {
    if (submitFocusedRef.current || count === 0) return;
    const at = normalize(viewRef.current).focus;
    if (hasSubmit && at === count - 1) { setSubmitFocused(true); return; }
    moveTo((at + 1) % count);
  };
  /** L397378-397384 (up/ctrl+p/k): off the submit row lands back on the LAST option; inside the ring it wraps. */
  const focusPrev = () => {
    if (count === 0) return;
    if (submitFocusedRef.current) { setSubmitFocused(false); moveTo(count - 1); return; }
    moveTo((normalize(viewRef.current).focus - 1 + count) % count);
  };
  /** L397385-397392: `tQs` pages the OPTION focus without ever consulting `isSubmitFocused` — faithful. */
  const pageBy = (delta: number) => { if (count > 0) moveTo(Math.max(0, Math.min(count - 1, normalize(viewRef.current).focus + delta * visible))); };
  const toggle = (value: string) => { if (options.find((o) => o.value === value)?.disabled !== true) onToggle(value); };   // L397319-397322
  /** The shared `return`/`space` branch (L397393-397409). `isEnter` is the one thing that separates them. */
  const acceptOrToggle = (isEnter: boolean) => {
    if (submitFocusedRef.current && hasSubmit) { onSubmit(); return; }
    if (isEnter && !hasSubmit) { onSubmit(); return; }
    const o = options[normalize(viewRef.current).focus];
    if (o) toggle(o.value);
  };

  useKeyScope(context);
  // With an input row focused upstream's handler returns before it can reach next/previous/accept, so those
  // actions must not be REGISTERED either — that is what turns `j`/`k`/`enter` back into text (Select.tsx's
  // header spells the mechanism out). Only cancel survives (L397417-397418).
  useKeyActions(inputFocused ? { "select:cancel": () => onCancel() } : {
    "select:previous": focusPrev, "select:next": focusNext,
    "select:pageUp": () => pageBy(-1), "select:pageDown": () => pageBy(1),
    "select:accept": () => acceptOrToggle(true), "select:cancel": () => onCancel(),
  });

  useKeyFallback((e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    // Tab is checked ahead of everything and on ANY row, input rows included (L397353-397366); both branches
    // are exactly `focusNext`/`focusPrev`, submit-row transitions and all.
    if (e.kind === "key" && e.name === "tab" && !e.ctrl && !e.alt) { if (e.shift) focusPrev(); else focusNext(); return; }
    const current = submitFocusedRef.current ? undefined : options[normalize(viewRef.current).focus];
    if (current?.type === "input") {
      const text = textOf(current);
      const at = cursorRef.current;
      const write = (next: string, to: number) => {
        setInputs({ ...inputsRef.current, [current.value]: next });
        setCursor(Math.max(0, Math.min(next.length, to)));
        onInputChange?.(current.value, next);
        // L397333-397339: typing into an input row SELECTS it and emptying it deselects. Gated on the
        // transition (not on `values` alone) so a second keystroke in the same chunk cannot toggle it back.
        if (!text && next && !values.has(current.value)) onToggle(current.value);
        else if (text && !next && values.has(current.value)) onToggle(current.value);
      };
      if (e.kind === "key") {
        if (e.name === "down" || (e.ctrl && e.name === "n")) { focusNext(); return; }
        if (e.name === "up" || (e.ctrl && e.name === "p")) { focusPrev(); return; }
        if (e.name === "enter") { if (e.ctrl) onSubmit(); else acceptOrToggle(true); return; }   // L397394-397397
        if (e.name === "left") { setCursor(Math.max(0, at - 1)); return; }
        if (e.name === "right") { setCursor(Math.min(text.length, at + 1)); return; }
        if (e.name === "home") { setCursor(0); return; }
        if (e.name === "end") { setCursor(text.length); return; }
        if (e.name === "backspace") { if (at > 0) write(text.slice(0, at - 1) + text.slice(at), at - 1); return; }
        if (e.name === "delete") { if (at < text.length) write(text.slice(0, at) + text.slice(at + 1), at); return; }
      }
      if (input && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(input)) write(text.slice(0, at) + input + text.slice(at), at + input.length);
      return;
    }
    if (input === " " && !key.ctrl && !key.meta) { acceptOrToggle(false); return; }
    // Digits are bound in no context, so they arrive here. `digitTarget` already answers -1 for a disabled
    // row, which matches upstream: the index resolves, `toggleValue` declines, and the key is dead.
    if (e.kind === "key" && !key.ctrl && !key.meta && /^[0-9]$/.test(input)) {
      const target = digitTarget(options, input);
      if (target >= 0) toggle(options[target]!.value);
    }
  });

  const indexWidth = String(count).length;                     // `EK_` (L397470)

  return (
    <Box flexDirection="column">
      {options.slice(win.start, win.end).map((o, i) => {
        const at = win.start + i;
        const isFocused = !submitFocused && at === win.focus;
        const selected = values.has(o.value);
        const showDown = win.end < count && at === win.end - 1, showUp = win.start > 0 && at === win.start;
        // `uJs` (L396391-396438) through `Fae`, which passes no `disabled` — so the blank-gutter branch is
        // dead here exactly as it is for `Select`.
        const gutter = isFocused ? <Text color={role(focusColor)}>{POINTER}</Text>
          : showDown ? <Text dimColor>{ARROW_DOWN}</Text>
            : showUp ? <Text dimColor>{ARROW_UP}</Text> : <Text> </Text>;
        const box = <Text color={selected ? role("success") : undefined}>{`[${selected ? TICK() : " "}]`}</Text>;

        if (o.type === "input") {                              // L397488: `RLe` with the box as its child
          const text = textOf(o);
          const withLabel = o.showLabelWithValue === true;      // `yJs` (L396471)
          const separator = o.labelValueSeparator ?? ", ";
          return (
            <Box key={o.value} flexDirection="column" flexShrink={0}>
              <Box flexDirection="row" gap={1}>
                <Box flexShrink={0}>{gutter}</Box>
                <Box flexDirection="row" flexShrink={0}>
                  {/* `RLe` pads the number to `maxIndexWidth + 2` (L396593) where V3 hands it `EK_`; the plain
                      rows below pad to `EK_` and pick up their spacing from the row's own gap instead. */}
                  <Box flexShrink={0}><Text dimColor>{`${at + 1}.`.padEnd(indexWidth + 2)}</Text></Box>
                  <Text color={selected ? role("success") : undefined}>{`[${selected ? TICK() : " "}] `}</Text>
                  {withLabel
                    ? isFocused
                      ? <><Text color={role(focusColor)}>{o.label}{separator}</Text><InputText text={text} cursor={cursor} placeholder={o.placeholder} /></>
                      : <Text>{o.label}{text ? separator : null}{text || null}</Text>
                    : isFocused
                      ? <InputText text={text} cursor={cursor} placeholder={o.placeholder || o.label} />
                      : <Text color={text ? undefined : role("inactive")}>{text || o.placeholder || o.label}</Text>}
                </Box>
              </Box>
              {o.description
                ? <Box paddingLeft={indexWidth + 4}><Text dimColor={o.dimDescription !== false} color={isFocused ? role(focusColor) : undefined}>{o.description}</Text></Box>
                : null}
            </Box>
          );
        }

        return (                                               // L397490, inside `Fae`'s gap-1 row
          <Box key={o.value} flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Box flexShrink={0}>{gutter}</Box>
              <Text dimColor>{`${at + 1}.`.padEnd(indexWidth)}</Text>
              {box}
              <Text color={isFocused ? role(focusColor) : undefined}>{o.label}</Text>
            </Box>
            {/* `eg`'s own description slot (L396382): its OWN line, indented 2, in `inactive` — not dimmed. */}
            {o.description ? <Box paddingLeft={2}><Text color={role("inactive")}>{o.description}</Text></Box> : null}
          </Box>
        );
      })}
      {hasSubmit ? (
        // L397502. The third gutter state upstream has here is a MOUSE hover (a dim pointer); we have no mouse.
        <Box flexDirection="row" marginTop={0} gap={1}>
          {submitFocused ? <Text color={role(focusColor)}>{POINTER}</Text> : <Text> </Text>}
          <Box marginLeft={3}><Text color={submitFocused ? role(focusColor) : undefined} bold>{submitButtonText}</Text></Box>
        </Box>
      ) : null}
    </Box>
  );
}
