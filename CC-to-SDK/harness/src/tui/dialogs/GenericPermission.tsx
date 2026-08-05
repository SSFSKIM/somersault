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
import { collapseOnFocusChange, escapeFeedbackMode, toggleFeedbackMode, NO_FEEDBACK, type FeedbackMode } from "./optionRows.js";
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

export function GenericPermission({ req, onDecision, cwd = process.cwd() }: {
  req: GenericPermissionRequest;
  onDecision: (d: PermissionDecision) => void;
  /** The SESSION's working directory (see permissionKind.ts) — the don't-ask-again row names it. */
  cwd?: string;
}) {
  const [feedback, setFeedback] = useState<FeedbackMode>(NO_FEEDBACK);
  // What the feedback row currently holds, mirrored off `Select`'s `onInputChange` (t5). A REF, not state:
  // one stdin chunk parses into several events with no render between them, so a same-chunk `x` + `up` read
  // off a render closure would still see the empty field and collapse a row that just got its first letter.
  const feedbackText = useRef("");
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

  return (
    <DialogFrame title="Tool use" subagentType={req.subagentType}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{req.toolName}{rendered ? `(${rendered})` : ""}{isMcpToolName(req.toolName) ? <Text dimColor> (MCP)</Text> : ""}</Text>
        {req.description ? <Text dimColor>{clipLines(req.description, DESCRIPTION_LINES)}</Text> : null}
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
          onInputChange={(value, text) => { if (value === "no") feedbackText.current = text; }}
          onInputModeToggle={(value) => { if (value === "no") setFeedback(toggleFeedbackMode(feedback, value)); }}
          onUnhandledKey={(e) => { const d = legacyKeyDecision(e); if (d) onDecision(d); }}
        />
      </Box>
      <ConsultFooter inputMode={inputFocused} />
    </DialogFrame>
  );
}
