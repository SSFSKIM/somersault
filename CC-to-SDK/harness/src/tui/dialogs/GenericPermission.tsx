// tui/dialogs/GenericPermission.tsx — the fallback permission dialog (F6 T8), and with it the F6 kind
// registry is complete: every route out of `permissionKind` now lands on a real body, and the pre-F6
// reconstruction (`Allow Claude to use <tool>?` over a hand-rolled numbered list) is gone.
//
// Transcribed from 2.1.220's `Gal` (L506118-260): the `Ed` frame titled "Tool use", a one-line body reading
// `<userFacingName>(<rendered tool-use message>)` with a dim ` (MCP)` marker when the tool is an MCP one, the
// description clipped to THREE LINES under it (`Ktt`), the consent reason (`yN`) and `zTe`'s question / list /
// shared `ConsultFooter` (T4). Everything pure lives in `smallDialogOptions.ts`.
//
// Two divergences, both recorded for T15:
//   · upstream decides "is this MCP" by asking the tool for its display name and testing
//     `endsWith(" (MCP)")` (`Ej` L228287) — a registry lookup no client can make. Ours is the wire name's
//     `mcp__` prefix. It also STRIPS that suffix off the displayed name; we have no display name to strip,
//     so the wire name is what the body prints;
//   · `renderedToolUseMessage` is a per-tool renderer inside the engine, so the body reconstructs it from the
//     first argument (`renderedToolUse`) — the pre-F6 body's own reconstruction, carried over.
//
// Recorded, not built: the auto-mode row (`UDr` L506124 + `KMn`/`YMn`, a claude.ai entitlement) and `TDn`'s
// engine-internal terms, which is why the don't-ask-again row here is unconditional.
import React, { useRef, useState } from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./DialogFrame.js";
import { ConsultFooter } from "./ConsultFooter.js";
import { Select } from "../select/Select.js";
import { consentReasonLine } from "./consentReason.js";
import { legacyKeyDecision } from "./dialogKeys.js";
import { clipLines, genericDecision, genericOptions, isMcpToolName, renderedToolUse } from "./smallDialogOptions.js";
import { collapseOnFocusChange, escapeFeedbackMode, isAmendableRow, toggleFeedbackMode, NO_FEEDBACK, type FeedbackMode } from "./optionRows.js";
import { bodyWindow, MoreRow, paintedRows } from "./rowBudget.js";
import { useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";

/** `Gal`'s `Ktt(description, 3)` (L506224). */
const DESCRIPTION_LINES = 3;

export interface GenericPermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  description?: string;
  subagentType?: string;
  suggestions?: PermissionUpdateLike[];
  decisionReason?: string;
}

/** The rows this dialog spends before the tool-use line prints — the frame's `marginTop`, rule and title; the
 *  body block's two padding rows; the clipped description's own painted rows; the consent reason; the
 *  question; one row per option; the footer's margin and hint row. The same derivation, and the same recorded
 *  approximation, as `fileChromeRows` (FSW T13b review I2). */
export function genericChromeRows({ descriptionRows, reason, options }: { descriptionRows: number; reason: boolean; options: number }): number {
  return 1 + 1 + 1 + 2 + descriptionRows + (reason ? 1 : 0) + 1 + options + 2;
}
/** The dim ` (MCP)` marker survives the wrap: it is appended to the wrapped SOURCE so it is measured like any
 *  other text, and re-styled on whichever row it landed on. */
const MCP_SUFFIX = " (MCP)";

export function GenericPermission({ req, onDecision, cwd = process.cwd(), columns = process.stdout.columns ?? 80, maxRows }: {
  req: GenericPermissionRequest;
  onDecision: (d: PermissionDecision) => void;
  /** The SESSION's working directory (see permissionKind.ts) — the don't-ask-again row names it. */
  cwd?: string;
  /** The pane width — what the tool-use line is WRAPPED at before it is windowed (T13b review I2). */
  columns?: number;
  /** A HARD CEILING on the rows this dialog may compose into (the fullscreen dock band's budget). Absent —
   *  every classic mount — the body prints whole and nothing below runs. */
  maxRows?: number;
}) {
  const [feedback, setFeedback] = useState<FeedbackMode>(NO_FEEDBACK);
  // What the feedback row currently holds, mirrored off `Select`'s `onInputChange` (t5). A REF, not state:
  // one stdin chunk parses into several events with no render between them, so a same-chunk `x` + `up` read
  // off a render closure would still see the empty field and collapse a row that just got its first letter.
  const feedbackText = useRef("");
  // Wave 2 t2 (s2qa3-10): an empty Enter on the open feedback row answers nothing (t3's rule, unchanged) but
  // now SAYS so instead of folding the row shut. It is an answer to ONE keystroke, so it is retired as STATE
  // by the two keys that make it stale — typing into the field, and toggling input mode (review I-1: the
  // display gate below only hides it, so a nudge that outlived its Esc came back the next time the row was
  // Tabbed open, warning about an Enter nobody pressed). Every route back into a nudged row runs through that
  // toggle: a nudged row is by definition EMPTY, and an empty row collapses when the cursor leaves it (t5),
  // so returning to it costs a Tab. Shown only while the AMENDABLE row is still the focused input, which is
  // what keeps the nudge off a different text row (BashPermission's editable-prefix row is one, and there an
  // empty Enter genuinely IS an answer: it carries the flag this row declines).
  const [nudge, setNudge] = useState(false);
  const options = genericOptions({ userFacingName: req.toolName, cwd, feedback });
  const [focus, setFocus] = useState<string>(options[0]!.value);
  const inputFocused = options.find((o) => o.value === focus)?.type === "input";
  const rendered = renderedToolUse(req.input);
  const reason = consentReasonLine(req.decisionReason);

  useKeyScope("Confirmation");
  useKeyActions(inputFocused ? {} : {
    "confirm:yes": () => onDecision({ kind: "allow_once" }),
    "confirm:no": () => onDecision({ kind: "deny" }),
  });

  // The row budget. `columns − 6` is this block's width (the frame's `innerPaddingX: 1` plus `paddingX: 2`),
  // and the tool-use line is the unbounded thing here: a rendered MCP input can be a paragraph.
  const bodyWidth = columns - 6;
  const description = req.description ? clipLines(req.description, DESCRIPTION_LINES) : undefined;
  const head = `${req.toolName}${rendered ? `(${rendered})` : ""}${isMcpToolName(req.toolName) ? MCP_SUFFIX : ""}`;
  const headRows = maxRows === undefined ? [] : paintedRows(head, bodyWidth);
  const { keep, hidden } = bodyWindow(headRows.length, maxRows === undefined ? undefined
    : Math.max(0, maxRows - genericChromeRows({ descriptionRows: description ? paintedRows(description, bodyWidth).length : 0, reason: Boolean(reason), options: options.length })));
  return (
    <DialogFrame title="Tool use" subagentType={req.subagentType}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {maxRows === undefined
          ? <Text>{req.toolName}{rendered ? `(${rendered})` : ""}{isMcpToolName(req.toolName) ? <Text dimColor>{MCP_SUFFIX}</Text> : ""}</Text>
          : headRows.slice(0, keep).map((text, index) => (text.endsWith(MCP_SUFFIX)
            ? <Text key={index}>{text.slice(0, -MCP_SUFFIX.length)}<Text dimColor>{MCP_SUFFIX}</Text></Text>
            : <Text key={index}>{text}</Text>))}
        {hidden > 0 ? <MoreRow hidden={hidden} /> : null}
        {description ? <Text dimColor>{description}</Text> : null}
      </Box>
      <Box flexDirection="column">
        {reason ? <Text>{reason}</Text> : null}
        <Text>Do you want to proceed?</Text>
        <Select
          options={options} inlineDescriptions context="SelectDecision"
          onChange={(value, text) => onDecision(genericDecision(value, { toolName: req.toolName, text }))}
          onCancel={() => { const next = escapeFeedbackMode(feedback); if (next) setFeedback(next); else onDecision({ kind: "deny" }); }}
          // Leaving an EMPTY feedback row puts the plain row back (L505162-169); one holding text stays open.
          onFocus={(value) => { setFocus(value); setFeedback((m) => collapseOnFocusChange(m, value, feedbackText.current.trim() === "")); }}
          onInputChange={(value, text) => { setNudge(false); if (value === "no") feedbackText.current = text; }}
          onEmptySubmit={() => setNudge(true)}
          onInputModeToggle={(value) => { setNudge(false); if (isAmendableRow(value)) setFeedback(toggleFeedbackMode(feedback, value)); }}
          onUnhandledKey={(e) => { const d = legacyKeyDecision(e); if (d) onDecision(d); }}
        />
      </Box>
      <ConsultFooter amendable={isAmendableRow(focus)} inputMode={inputFocused} nudge={nudge && inputFocused && isAmendableRow(focus)} />
    </DialogFrame>
  );
}
