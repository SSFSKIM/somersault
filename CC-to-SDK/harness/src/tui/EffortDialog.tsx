// tui/src/EffortDialog.tsx — WAVE C TASK 11 (EP-C6): the standalone `/effort` dialog. Annex §C6.4
// (`L447278`): `←/→` step the index, `return` confirms, `escape` cancels, and the footer is the memoized
// `w` string transcribed verbatim in `EFFORT_DIALOG_FOOTER`.
//
// THE ONE BEHAVIOURAL DIFFERENCE FROM THE PICKER'S ROW, and it is upstream's own: this dialog STAGES. Its
// footer says "Enter to confirm", so ←/→ move a local index and nothing reaches the session until Enter;
// Esc leaves the session at the level it already had. The `/model` picker's copy of the same row says only
// "←/→ to adjust" and applies live, because there the effort axis is a side control on a dialog whose Enter
// already means something else (pick this model). Two annex sections, two contracts, one row component.
//
// UNSOURCED (flagged in the task-11 report, not a divergence from a quote): the annex transcribes §C6.4's
// FOOTER only — upstream's surrounding chrome for this dialog was never captured. The frame, the title and
// the subtitle below are therefore ccx's, built on the house `DialogFrame` every other dialog in this tree
// uses rather than invented from scratch.
import React from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./dialogs/DialogFrame.js";
import { useKeyActions, useKeyScope } from "./keys/KeymapProvider.js";
import { useRefState } from "./keys/refState.js";
import { EffortRow } from "./EffortRow.js";
import { EFFORT_DIALOG_FOOTER, EFFORT_LEVELS, stepEffort, type EffortLevel } from "./modelPickerModel.js";

export const EFFORT_TITLE = "Set effort level";
// T-EFFORT: was "…This session only." — false the moment persistence shipped (useChat.ts's `applyEffort` is
// the one choke point EVERY level-setting surface funnels through, this dialog's Enter included, and it
// persists low|medium|high|xhigh unconditionally). `max` is the one level that still stays session-only —
// named here rather than let the subtitle overclaim in the other direction.
export const EFFORT_SUBTITLE = "How much reasoning effort Claude spends on each turn. Saved as your default for new sessions (except max).";

export function EffortDialog({ level, levels = EFFORT_LEVELS, defaultEffort, modelName, supported = true, onConfirm, onCancel }: {
  /** The level in force when the dialog opened — the staging cursor's starting point. */
  level: EffortLevel;
  /** The live model's supported list, straight off the catalog row (`supportedEffortLevels`). Stepping wraps
   *  modulo THIS, so a model without `max` can never stage one. */
  levels?: readonly EffortLevel[];
  /** What `(default)` means here: ccx's harness-wide launch default, not a per-model one (see useChat). */
  defaultEffort?: EffortLevel;
  modelName?: string;
  supported?: boolean;
  onConfirm: (level: EffortLevel) => void;
  onCancel: () => void;
}) {
  // Ref-backed for the reason every dialog in this tree is: `→→` can arrive in ONE stdin chunk and dispatch
  // twice with no render in between, so the second step must read what the first one set, not the value its
  // own render closed over.
  const [staged, setStaged, stagedRef] = useRefState<EffortLevel>(level);

  useKeyScope("EffortDialog");
  useKeyActions({
    // Inert on the unsupported arm: there is no list to step and nothing to confirm, so the only key that
    // does anything is Esc — which is exactly what the row on screen says.
    "modelPicker:decreaseEffort": () => { if (supported) setStaged(stepEffort(levels, stagedRef.current, -1)); },
    "modelPicker:increaseEffort": () => { if (supported) setStaged(stepEffort(levels, stagedRef.current, 1)); },
    "select:accept": () => { if (supported) onConfirm(stagedRef.current); },
    "select:cancel": () => { onCancel(); },
  });

  return (
    <DialogFrame title={EFFORT_TITLE} titleColor="remember" color="permission" subtitle={EFFORT_SUBTITLE}>
      <Box flexDirection="column" marginTop={1}>
        <EffortRow level={staged} isDefault={staged === defaultEffort} supported={supported} {...(modelName !== undefined ? { modelName } : {})} />
      </Box>
      <Text dimColor>{EFFORT_DIALOG_FOOTER}</Text>
    </DialogFrame>
  );
}
