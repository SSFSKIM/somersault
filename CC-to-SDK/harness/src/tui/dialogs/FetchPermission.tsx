// tui/dialogs/FetchPermission.tsx — the WebFetch permission dialog (F6 T8). Transcribed from 2.1.220's
// `ull` (L506735-816): the `Ed` frame titled "Fetch", the rendered tool-use line in its own padded block with
// a dim description under it, the consent reason (`yN`), the fetch-specific question, and the `jr` option
// list. Everything pure lives in `smallDialogOptions.ts`.
//
// THIS IS THE ONE PERMISSION BODY WITH NO FEEDBACK ROW AND NO FOOTER, and the two facts are the same fact:
// upstream builds its No from a PLAIN label carrying `(esc)` in its own text (L506767-770) and mounts the
// bare `jr` rather than `zTe`, so there is no `feedbackConfig` to toggle into a text row and no `esc cancel`
// hint line — the row says it. Every other F6 body gets both. Consequently `y`/`n` are registered
// unconditionally here: no row can ever be typing.
//
// Recorded, not built: `qtm`'s first three terms (`showAlwaysAllow`, the non-approvable safety-check arm,
// `isAskCappedByOrg` — all engine-internal, see smallDialogOptions.ts); upstream's `chrome` metadata arm,
// which belongs to the browser-MCP dialog rather than this one.
import React from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./DialogFrame.js";
import { Select } from "../select/Select.js";
import { consentReasonLine } from "./consentReason.js";
import { legacyKeyDecision } from "./dialogKeys.js";
import { fetchDecision, fetchHostname, fetchOptions, renderedToolUse } from "./smallDialogOptions.js";
import { useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";

/** The slice of a `PermissionRequest` this body reads. Structural, so a parked decision satisfies it as-is. */
export interface FetchPermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  description?: string;
  subagentType?: string;
  suggestions?: PermissionUpdateLike[];
  decisionReason?: string;
}

export function FetchPermission({ req, onDecision }: {
  req: FetchPermissionRequest;
  onDecision: (d: PermissionDecision) => void;
}) {
  const hostname = fetchHostname(req.input);
  const options = fetchOptions({ hostname });
  const reason = consentReasonLine(req.decisionReason);

  useKeyScope("Confirmation");
  useKeyActions({
    "confirm:yes": () => onDecision({ kind: "allow_once" }),
    "confirm:no": () => onDecision({ kind: "deny" }),
  });

  return (
    <DialogFrame title="Fetch" subagentType={req.subagentType}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{renderedToolUse(req.input)}</Text>
        {req.description ? <Text dimColor>{req.description}</Text> : null}
      </Box>
      <Box flexDirection="column">
        {reason ? <Text>{reason}</Text> : null}
        <Text>Do you want to allow Claude to fetch this content?</Text>
        <Select
          options={options} inlineDescriptions context="SelectDecision"
          onChange={(value) => onDecision(fetchDecision(value, { toolName: req.toolName, hostname }))}
          onCancel={() => onDecision({ kind: "deny" })}
          onUnhandledKey={(e) => { const d = legacyKeyDecision(e); if (d) onDecision(d); }}
        />
      </Box>
    </DialogFrame>
  );
}
