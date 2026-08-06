// tui/dialogs/SkillPermission.tsx — the Skill permission dialog (F6 T8). Transcribed from 2.1.220's `oll`
// (L506582-710): the `Ed` frame titled `Use skill "<name>"?`, the standing caution line, the skill's own
// description in a padded dim block, the consent reason (`yN`), then `zTe` — which is where the question
// line, the option list and the shared `ConsultFooter` (T4) all come from (L505939-505952).
//
// The list is the one shape in the F6 family that is NOT mutually exclusive: `Ptm` (a non-empty name) and
// `Otm` (a space inside it) are independent tests and `oll` pushes both rows, so `Skill(git commit)` offers
// three yes-rows — see smallDialogOptions.ts. The key contract is BashPermission.tsx's, verbatim, and THE
// SELECT MOUNTS INSIDE THIS COMPONENT: the registry ranks scopes by mount order, so a sibling mount would
// put `Confirmation` above `SelectDecision` and silently invert Enter and Escape (T6 review).
//
// Recorded, not built: `_id`'s `metadata.command.name`/`.description` fallbacks (L228357 — engine-internal,
// never on the wire), so the name comes off `input.skill` alone and the description off the SDK's own
// `description` field; and the `feedbackConfig:{type:"accept"}` on the Yes row, unreachable per T3.
import React, { useRef, useState } from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./DialogFrame.js";
import { ConsultFooter } from "./ConsultFooter.js";
import { Select } from "../select/Select.js";
import { consentReasonLine } from "./consentReason.js";
import { legacyKeyDecision } from "./dialogKeys.js";
import { skillDecision, skillOf, skillOptions } from "./smallDialogOptions.js";
import { collapseOnFocusChange, escapeFeedbackMode, isAmendableRow, toggleFeedbackMode, NO_FEEDBACK, type FeedbackMode } from "./optionRows.js";
import { useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";

export interface SkillPermissionRequest {
  input: Record<string, unknown>;
  description?: string;
  subagentType?: string;
  suggestions?: PermissionUpdateLike[];
  decisionReason?: string;
}

export function SkillPermission({ req, onDecision, cwd = process.cwd() }: {
  req: SkillPermissionRequest;
  onDecision: (d: PermissionDecision) => void;
  /** The SESSION's working directory (see permissionKind.ts) — both don't-ask-again rows name it. */
  cwd?: string;
}) {
  const skill = skillOf(req.input);
  const [feedback, setFeedback] = useState<FeedbackMode>(NO_FEEDBACK);
  // Mirrored off `Select`'s `onInputChange` (t5), and a REF for the same-chunk reason GenericPermission spells
  // out: `x` then `up` in one chunk must not read the field as still empty.
  const feedbackText = useRef("");
  const options = skillOptions({ skill, cwd, feedback });
  const [focus, setFocus] = useState<string>(options[0]!.value);
  const inputFocused = options.find((o) => o.value === focus)?.type === "input";
  const reason = consentReasonLine(req.decisionReason);

  useKeyScope("Confirmation");
  useKeyActions(inputFocused ? {} : {
    "confirm:yes": () => onDecision({ kind: "allow_once" }),
    "confirm:no": () => onDecision({ kind: "deny" }),
  });

  return (
    <DialogFrame title={`Use skill "${skill}"?`} subagentType={req.subagentType}>
      <Text>Claude may use instructions, code, or files from this Skill.</Text>
      {req.description ? <Box flexDirection="column" paddingX={2} paddingY={1}><Text dimColor>{req.description}</Text></Box> : null}
      <Box flexDirection="column">
        {reason ? <Text>{reason}</Text> : null}
        <Text>Do you want to proceed?</Text>
        <Select
          options={options} inlineDescriptions context="SelectDecision"
          onChange={(value, text) => onDecision(skillDecision(value, { skill, text }))}
          onCancel={() => { const next = escapeFeedbackMode(feedback); if (next) setFeedback(next); else onDecision({ kind: "deny" }); }}
          // Leaving an EMPTY feedback row puts the plain row back (L505162-169); one holding text stays open.
          onFocus={(value) => { setFocus(value); setFeedback((m) => collapseOnFocusChange(m, value, feedbackText.current.trim() === "")); }}
          onInputChange={(value, text) => { if (value === "no") feedbackText.current = text; }}
          onInputModeToggle={(value) => { if (isAmendableRow(value)) setFeedback(toggleFeedbackMode(feedback, value)); }}
          onUnhandledKey={(e) => { const d = legacyKeyDecision(e); if (d) onDecision(d); }}
        />
      </Box>
      <ConsultFooter amendable={isAmendableRow(focus)} inputMode={inputFocused} />
    </DialogFrame>
  );
}
