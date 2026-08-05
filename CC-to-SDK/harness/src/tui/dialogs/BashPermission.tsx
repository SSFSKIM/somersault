// tui/dialogs/BashPermission.tsx — the Bash permission dialog (F6 T6), the first real body on the F6
// substrate. Transcribed from 2.1.220's `dZf` (L505224-287): the `Ed` frame titled "Bash command", the
// command in its own padded block with a dim description under it, the consent reason (`yN`), the
// destructive-table warning in the `warning` role, the question line, the `$Qf` option list inside a
// `Select`, and the shared `ConsultFooter` (T4).
//
// Everything pure lives in `bashOptions.ts`; this file is the wiring, and the wiring is the key contract:
//
//   · digits reach the embedded `Select` (it binds them in no context and reads them off the fallback);
//   · `y`/`n` are the `Confirmation` scope's two actions — REGISTERED ONLY while no text row has the cursor.
//     Deregistering is not a nicety: the binding still resolves, and an action with no handler falls through
//     to the fallback, which inside a Select is the Select's own — so the same `n` denies on a pick-one row
//     and types on a feedback row, with no key-sniffing anywhere;
//   · Enter and Escape belong to `SelectDecision`, which outranks `Confirmation` (the Select mounts inside
//     us, and the registry ranks by mount order). Enter therefore takes the HIGHLIGHTED row, exactly as
//     upstream's list does, and Escape arrives as the Select's `onCancel`;
//   · the legacy `a`/`A`/`d`/`D` letters ride `Select`'s `onUnhandledKey`, which is silent while a text row
//     is focused. They cannot use a fallback of our own: `fallbackHandler` hands the keyboard to exactly one
//     handler and that handler has to be the Select's. The mapping itself lives in `dialogKeys.ts`, shared
//     by all six bodies (T8).
//
// Recorded, not built: the title's `(unsandboxed)` variant (`Oo.isSandboxingEnabled()`, L505259 — this
// harness never sandboxes); the explain affordance (DG4, T7's job); the
// auto-mode row (`UDr` L504815, its row L504872 — a claude.ai entitlement); and upstream's `onFocus`-driven
// feedback hint node. The footer hints came in with T4 (`tab amend` now, `ctrl+e` when T7 passes `explain`).
import React, { useState } from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./DialogFrame.js";
import { ConsultFooter } from "./ConsultFooter.js";
import { Select } from "../select/Select.js";
import { consentReasonLine } from "./consentReason.js";
import { legacyKeyDecision } from "./dialogKeys.js";
import { destructiveWarning } from "./destructive.js";
import { bashDecision, bashOptions } from "./bashOptions.js";
import { escapeFeedbackMode, toggleFeedbackMode, NO_FEEDBACK, type FeedbackMode } from "./optionRows.js";
import { useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import { resolveThemeColor, themeTokens } from "../theme.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";

/** The slice of a `PermissionRequest` this body reads. Structural, so a parked decision (which carries more)
 *  satisfies it as-is. */
export interface BashPermissionRequest {
  input: Record<string, unknown>;
  description?: string;
  subagentType?: string;
  suggestions?: PermissionUpdateLike[];
  decisionReason?: string;
}

export function BashPermission({ req, onDecision, cwd = process.cwd() }: {
  req: BashPermissionRequest;
  onDecision: (d: PermissionDecision) => void;
  /** The SESSION's working directory (see permissionKind.ts) — the suggestions-summary row names it. */
  cwd?: string;
}) {
  const command = typeof req.input.command === "string" ? req.input.command : "";
  const suggestions = req.suggestions ?? [];
  // Upstream keeps `yesInputMode`/`noInputMode` as a pair; only the `no` half is reachable here (the SDK's
  // allow arm has no message field — T3), so Tab on Yes is dropped rather than toggling a mode whose row
  // would never render as text and whose Esc would then eat a keypress doing nothing visible.
  const [feedback, setFeedback] = useState<FeedbackMode>(NO_FEEDBACK);
  const options = bashOptions({ command, suggestions, feedback, cwd });
  const [focus, setFocus] = useState<string>(options[0]!.value);
  const inputFocused = options.find((o) => o.value === focus)?.type === "input";

  const warning = destructiveWarning(command);
  const reason = consentReasonLine(req.decisionReason);

  useKeyScope("Confirmation");
  useKeyActions(inputFocused ? {} : {
    "confirm:yes": () => onDecision({ kind: "allow_once" }),
    "confirm:no": () => onDecision({ kind: "deny" }),
  });

  return (
    <DialogFrame title="Bash command" subagentType={req.subagentType}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{command}</Text>
        {req.description ? <Text dimColor>{req.description}</Text> : null}
      </Box>
      <Box flexDirection="column">
        {reason ? <Text>{reason}</Text> : null}
        {warning ? <Box marginBottom={1}><Text color={resolveThemeColor(themeTokens().warning)}>{warning}</Text></Box> : null}
        <Text>Do you want to proceed?</Text>
        <Select
          options={options} inlineDescriptions context="SelectDecision"
          onChange={(value, text) => onDecision(bashDecision(value, { text, suggestions }))}
          // Esc has two jobs and they are ordered (optionRows.ts): leave a half-typed feedback row first,
          // cancel the whole dialog second.
          onCancel={() => { const next = escapeFeedbackMode(feedback); if (next) setFeedback(next); else onDecision({ kind: "deny" }); }}
          onFocus={setFocus}
          onInputModeToggle={(value) => { if (value === "no") setFeedback(toggleFeedbackMode(feedback, value)); }}
          onUnhandledKey={(e) => { const d = legacyKeyDecision(e); if (d) onDecision(d); }}
        />
      </Box>
      <ConsultFooter inputMode={inputFocused} />
    </DialogFrame>
  );
}
