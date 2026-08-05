// tui/dialogs/MonitorPermission.tsx — the Monitor permission dialog (F6 T8). Transcribed from 2.1.220's
// `Ral` (L506006-093): the `Ed` frame titled `cA` = "Monitor" (L158976 — resolved from the constant, not
// guessed), a body that is one of three arms depending on what the monitor actually watches, the dim
// description under it, the consent reason (`yN`) and `zTe`'s question / list / `esc cancel` footer.
//
// The three body arms are checked in `Ral`'s own order — MCP poll, then WebSocket, then the raw command — and
// the payload reader that feeds them is `hid` (smallDialogOptions.ts). The arms are why this dialog exists at
// all: `Monitor(mcp:{server,tool})` renders as a sentence about polling rather than as a JSON blob.
//
// This is the ONLY one of T8's four dialogs that cannot type a permission rule of its own, and therefore the
// only one whose don't-ask-again row echoes `suggestions` verbatim — the live surface of the suggestion-first
// policy in this task (see smallDialogOptions.ts's header). No suggestions means Yes/No and nothing else.
//
// Recorded, not built: `Ral`'s `toolType` (L506071 — "tool" for the MCP/WS arms, "command" for a raw one).
// It is handed to `yN`, whose only headlessly-reachable arm is `safetyCheck`/`other`, and that arm does not
// interpolate it (`mDr` L500565-567); every arm that does is a typed decision reason the wire never forwards.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./DialogFrame.js";
import { Select } from "../select/Select.js";
import { consentReasonLine } from "./consentReason.js";
import { legacyKeyDecision } from "./dialogKeys.js";
import { monitorDecision, monitorOptions, monitorPayload, subprotocolList, type MonitorPayload } from "./smallDialogOptions.js";
import { escapeFeedbackMode, toggleFeedbackMode, NO_FEEDBACK, type FeedbackMode } from "./optionRows.js";
import { useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";

export interface MonitorPermissionRequest {
  input: Record<string, unknown>;
  description?: string;
  subagentType?: string;
  suggestions?: PermissionUpdateLike[];
  decisionReason?: string;
}

/** L506056-062, arm for arm. The bold spans are real here — a body is a `Text` tree, unlike a
 *  `SelectOption.label`, which is a string and loses them. */
function MonitorBody({ payload }: { payload: MonitorPayload }) {
  if (payload.mcp) return <Text>Poll <Text bold>{payload.mcp.server}/{payload.mcp.tool}</Text> every {payload.intervalMs / 1000}s</Text>;
  if (payload.ws) {
    const protocols = payload.ws.protocols;
    return (
      <>
        <Text>Open WebSocket <Text bold>{payload.ws.url}</Text></Text>
        {protocols && protocols.length > 0 ? <Text>subprotocols: <Text bold>{subprotocolList(protocols)}</Text></Text> : null}
      </>
    );
  }
  return <Text>{payload.command ?? ""}</Text>;
}

export function MonitorPermission({ req, onDecision }: {
  req: MonitorPermissionRequest;
  onDecision: (d: PermissionDecision) => void;
}) {
  const payload = monitorPayload(req.input);
  const suggestions = req.suggestions ?? [];
  const [feedback, setFeedback] = useState<FeedbackMode>(NO_FEEDBACK);
  const options = monitorOptions({ suggestions, feedback });
  const [focus, setFocus] = useState<string>(options[0]!.value);
  const inputFocused = options.find((o) => o.value === focus)?.type === "input";
  const reason = consentReasonLine(req.decisionReason);

  useKeyScope("Confirmation");
  useKeyActions(inputFocused ? {} : {
    "confirm:yes": () => onDecision({ kind: "allow_once" }),
    "confirm:no": () => onDecision({ kind: "deny" }),
  });

  return (
    <DialogFrame title="Monitor" subagentType={req.subagentType}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <MonitorBody payload={payload} />
        {payload.description ?? req.description ? <Text dimColor>{payload.description ?? req.description}</Text> : null}
      </Box>
      <Box flexDirection="column">
        {reason ? <Text>{reason}</Text> : null}
        <Text>Do you want to proceed?</Text>
        <Select
          options={options} inlineDescriptions context="SelectDecision"
          onChange={(value, text) => onDecision(monitorDecision(value, { text, suggestions }))}
          onCancel={() => { const next = escapeFeedbackMode(feedback); if (next) setFeedback(next); else onDecision({ kind: "deny" }); }}
          onFocus={setFocus}
          onInputModeToggle={(value) => { if (value === "no") setFeedback(toggleFeedbackMode(feedback, value)); }}
          onUnhandledKey={(e) => { const d = legacyKeyDecision(e); if (d) onDecision(d); }}
        />
      </Box>
      <Box marginTop={1}><Text dimColor>esc cancel</Text></Box>
    </DialogFrame>
  );
}
