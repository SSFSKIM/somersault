// tui/src/ModelSwitchConfirm.tsx — the cache-invalidation confirm a mid-conversation model switch has to
// pass (Wave S T12, EP-S8; upstream's copy at L447014-447039, its gate `XMo` L315221 lives in
// `modelConfirmModel.ts`).
//
// IT IS A STAGE OF THE PICKER, NOT A NEW OVERLAY. Upstream's is a confirm SCREEN that replaces the model
// list, and `ModelPicker` swaps to this component in place of its `Select` for the same three reasons:
//   · the gate has to run BEFORE the picker's "set as default" prefs write (W-S9), which happens inside the
//     picker — a confirm mounted by `useChat` at `pickModel` would only ever be reached after that write;
//   · both routes into the picker (the `/model` command and `/config`'s Model row) then get the confirm with
//     no special-casing, because neither of them mounts anything new;
//   · declining returns to the LIST with the picker's own focus and window intact, which is what "No, go
//     back" says — an overlay would have had to re-open the picker to mean the same thing.
// It is consequently NOT in `ChatApp`'s `paneOwned` disjunction: that set is the surfaces whose HEIGHT
// DERIVES FROM `rows` (Task 4-6), and this is a fixed five-row dialog. `ModelPicker` is already in it, which
// is the correct answer for the pane while this stage is up anyway.
import React from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./dialogs/DialogFrame.js";
import { Select } from "./select/Select.js";
import { CONFIRM_CANCEL, CONFIRM_SUBTITLE, CONFIRM_TITLE, confirmAccept, confirmBody } from "./modelConfirmModel.js";

export function ModelSwitchConfirm({ target, onAccept, onCancel }: {
  /** The target model's DISPLAY name — it is what both the body sentence and the accept row say. */
  target: string;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    // `warning`, not the picker's `permission`: this is the pause-family frame (DialogFrame's own header
    // comment names `warning` as the role the pause/limit dialogs take).
    <DialogFrame title={CONFIRM_TITLE} color="warning" titleColor="warning" subtitle={CONFIRM_SUBTITLE}>
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {confirmBody(target).map((l, i) => (
          <Text key={i}>{(l.segments ?? [{ text: l.text }]).map((s, j) => <Text key={j} bold={s.bold}>{s.text}</Text>)}</Text>
        ))}
      </Box>
      {/* Accept first and focused — upstream lists `Yes, switch to …` above `No, go back` and opens on it.
          Escape reaches `Select`'s own cancel (no `Confirmation` scope is pushed here, exactly as in
          `bypassConsent.tsx`), so Escape and the cancel ROW are one path: back to the list, nothing written,
          nothing stamped. */}
      <Select
        options={[{ value: "confirm", label: confirmAccept(target) }, { value: "cancel", label: CONFIRM_CANCEL }]}
        defaultFocusValue="confirm"
        onChange={(v) => (v === "confirm" ? onAccept() : onCancel())}
        onCancel={onCancel}
      />
    </DialogFrame>
  );
}
