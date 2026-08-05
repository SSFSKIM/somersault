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
import React, { useState } from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { useKeyFallback } from "../keys/KeymapProvider.js";
import { useSelectKeys } from "../keys/selectKeys.js";
import { toKeyFlags } from "../keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "../keys/types.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "../theme.js";
import {
  clampVisible, digitTarget, isTwoColumn, labelColumnWidth, perOptionRows, truncateLabel, viewAfterFocus,
  windowBounds, VISIBLE_OPTION_COUNT, type SelectView,
} from "./selectModel.js";

/** `EJi` (L104958-104962): whether the terminal gets the unicode figure set or the ASCII fallback. Frozen at
 *  module load, like upstream's own `Ge`. `arrowUp`/`arrowDown` live in the shared base table (L104968) and
 *  are the same glyph either way; only `pointer` and `tick` have a fallback. */
const UNICODE = process.platform !== "win32"
  ? process.env.TERM !== "linux"
  : Boolean(process.env.WT_SESSION) || Boolean(process.env.TERMINUS_SUBLIME) || process.env.ConEmuTask === "{cmd::Cmder}"
    || process.env.TERM_PROGRAM === "Terminus-Sublime" || process.env.TERM_PROGRAM === "vscode"
    || ["xterm-256color", "alacritty", "rxvt-unicode", "rxvt-unicode-256color"].includes(process.env.TERM ?? "")
    || process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
export const POINTER = UNICODE ? "❯" : ">";
export const ARROW_UP = "↑", ARROW_DOWN = "↓";
export const TICK = UNICODE ? "✔" : "√";

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
  rows?: number; columns?: number;
  focusColor?: ThemeTokenName;
}

/** L397122-397124: the first literal occurrence of `highlightText` inside the label goes bold (`sK_`). */
function labelNode(label: string, highlight?: string): React.ReactNode {
  if (!highlight || !label.includes(highlight)) return label;
  const at = label.indexOf(highlight);
  return <>{label.slice(0, at)}<Text bold>{highlight}</Text>{label.slice(at + highlight.length)}</>;
}

/** The minimal text state an input row needs: characters plus a block cursor. Deliberately NOT the composer's
 *  editor — no paste chips and no image paste inside a Select (upstream's `RLe` has both; recorded divergence). */
function InputText({ text, cursor, placeholder }: { text: string; cursor: number; placeholder?: string }) {
  if (text.length === 0) return <Text><Text inverse> </Text>{placeholder ? <Text color={role("inactive")}>{placeholder}</Text> : null}</Text>;
  const at = cursor >= text.length ? " " : text[cursor]!;
  return <Text>{text.slice(0, cursor)}<Text inverse>{at}</Text>{text.slice(cursor + 1)}</Text>;
}

export function Select({
  options, onChange, onCancel, hideIndexes = false, visibleOptionCount = VISIBLE_OPTION_COUNT,
  inlineDescriptions = false, highlightText, defaultValue, defaultFocusValue, onInputModeToggle,
  rows = process.stdout.rows ?? 24, columns = process.stdout.columns ?? 80, focusColor = "suggestion",
}: SelectProps) {
  const count = options.length;
  const twoColumn = isTwoColumn(options, inlineDescriptions);
  const visible = clampVisible(visibleOptionCount, rows, perOptionRows(twoColumn));
  const textOf = (o: SelectOption, map: Record<string, string>) => map[o.value] ?? o.initialValue ?? "";

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [value, setValue] = useState<string | undefined>(defaultValue);
  const [view, setView] = useState<SelectView>(() => {
    const at = Math.max(0, options.findIndex((o) => o.value === defaultFocusValue));
    return { focus: at, ...windowBounds(count, at, visible) };
  });
  const [cursor, setCursor] = useState(() => {
    const at = Math.max(0, options.findIndex((o) => o.value === defaultFocusValue));
    return options[at]?.type === "input" ? (options[at]!.initialValue ?? "").length : 0;
  });

  // The window is derived defensively rather than through an effect: `options`/`rows` can change under a live
  // Select (a filtered picker is exactly that), and a stale window would render rows that no longer exist.
  const focus = Math.max(0, Math.min(view.focus, count - 1));
  const win: SelectView = (view.focus === focus && view.end - view.start === Math.min(visible, count))
    ? view : { focus, ...windowBounds(count, focus, visible, view) };
  const current = options[win.focus];
  const inputFocused = current?.type === "input";

  const moveTo = (target: number) => {
    const next = viewAfterFocus(win, count, visible, target);
    setView(next);
    const landed = options[next.focus];
    setCursor(landed?.type === "input" ? textOf(landed, inputs).length : 0);
  };
  const accept = () => {                                   // L396693-396700: never a disabled row
    if (!current || current.disabled === true) return;
    setValue(current.value); onChange(current.value);
  };
  /** L397113-397118 / L397229-397232: empty submits cancel unless the option opts out. */
  const submitInput = (o: SelectOption) => {
    const text = textOf(o, inputs);
    if (text.trim() || o.allowEmptySubmitToCancel) onChange(o.value, text); else onCancel();
  };
  /** L396768-396785: a digit on a normal row picks it; on an input row it submits when the row already holds
   *  text (or may submit empty) and otherwise just moves the cursor into it. */
  const chooseByDigit = (index: number) => {
    const o = options[index]!;
    if (o.type !== "input") { onChange(o.value); return; }
    const text = textOf(o, inputs);
    if (text.trim() || o.allowEmptySubmitToCancel) { onChange(o.value, text); return; }
    moveTo(index);
  };

  useSelectKeys({ count, index: win.focus, page: visible, wrap: true, inputFocused, onMove: moveTo, onAccept: accept, onCancel });

  useKeyFallback((e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    // Tab is checked ahead of everything, on ANY row, not just an input one (L396712-396715).
    if (e.kind === "key" && e.name === "tab" && !e.ctrl && !e.alt) { if (current) onInputModeToggle?.(current.value); return; }
    if (inputFocused && current) {
      const text = textOf(current, inputs);
      const write = (next: string, at: number) => { setInputs((m) => ({ ...m, [current.value]: next })); setCursor(Math.max(0, Math.min(next.length, at))); };
      if (e.kind === "key") {
        if (e.name === "down" || (e.ctrl && e.name === "n")) { moveTo((win.focus + 1) % count); return; }
        if (e.name === "up" || (e.ctrl && e.name === "p")) { moveTo((win.focus - 1 + count) % count); return; }
        if (e.name === "enter") { submitInput(current); return; }
        if (e.name === "left") { setCursor(Math.max(0, cursor - 1)); return; }
        if (e.name === "right") { setCursor(Math.min(text.length, cursor + 1)); return; }
        if (e.name === "home") { setCursor(0); return; }
        if (e.name === "end") { setCursor(text.length); return; }
        if (e.name === "backspace") { if (cursor > 0) write(text.slice(0, cursor - 1) + text.slice(cursor), cursor - 1); return; }
        if (e.name === "delete") { if (cursor < text.length) write(text.slice(0, cursor) + text.slice(cursor + 1), cursor); return; }
      }
      if (input && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(input)) write(text.slice(0, cursor) + input + text.slice(cursor), cursor + input.length);
      return;
    }
    // Digits reach us because they are bound in no context; `hideIndexes` is the one switch that kills them.
    if (!hideIndexes && e.kind === "key" && !key.ctrl && !key.meta && /^[0-9]$/.test(input)) {
      const at = digitTarget(options, input);
      if (at >= 0) chooseByDigit(at);                      // a miss (disabled / "0" / past the end) is a DEAD key
    }
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
          const text = textOf(o, inputs);
          const withLabel = inlineDescriptions || o.showLabelWithValue === true;   // `yJs` (L396471)
          const separator = o.labelValueSeparator ?? ", ";
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
                      ? <><Text color={role(focusColor)}>{o.label}{separator}</Text><InputText text={text} cursor={cursor} placeholder={o.placeholder} /></>
                      : <Text>{o.label}{text ? separator : null}{text || null}</Text>
                    : focused
                      ? <InputText text={text} cursor={cursor} placeholder={o.placeholder || o.label} />
                      : <Text color={text ? undefined : role("inactive")}>{text || o.placeholder || o.label}</Text>}
                </Box>
                {isCurrent ? <Text color={role("success")}>{TICK}</Text> : null}
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
                {isCurrent ? <Text> <Text color={role("success")}>{TICK}</Text></Text> : null}
                {pad > 0 ? <Text>{" ".repeat(pad)}</Text> : null}
              </Box>
              <Box flexGrow={1} marginLeft={2}>
                <Text wrap="wrap" dimColor={descDim} color={color}>{o.description || " "}</Text>
              </Box>
            </Box>
          );
        }

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
            {isCurrent ? <Text color={role("success")}>{TICK}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
