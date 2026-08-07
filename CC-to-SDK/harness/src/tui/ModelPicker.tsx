// tui/src/ModelPicker.tsx — the /model modal (F6 T11), rebuilt on the `Select` primitive and on upstream's
// own anatomy (`zAe`, bundle L440917-441174). The literals and the window arithmetic live in
// `modelPickerModel.ts`; this file is the header block, the list, the overflow counter and the ONE key that
// is not Select's.
//
// THE SPLIT THIS PICKER EXISTS TO EXPRESS (DG46): Enter and `s` pick the same model and mean different
// things. Enter applies it AND writes it as the default for new sessions (upstream `fva` L441117 calls
// `onSetDefault` then `onSelect`; the write itself is `Dcn` L315170, `userSettings.model`). `s` applies it
// for this session ONLY (`modelPicker:thisSessionOnly` L441070 → `nvn` alone, no `onSetDefault`). The row
// `s` acts on is the FOCUSED one, not the current value — upstream tracks it through the Select's `onFocus`
// (`vrf`, L441045) exactly as we do here.
//
// OUR ONE RECORDED DIVERGENCE (T15): the default lands in the ccx prefs file (`prefs.ts`), not in
// `~/.claude/settings.json`. Same promise to the user, different file — and the one the harness owns.
import React from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./dialogs/DialogFrame.js";
import { useKeyActions, useKeyScope } from "./keys/KeymapProvider.js";
import { useRefState } from "./keys/refState.js";
import { Select } from "./select/Select.js";
import { formatOverflowCount } from "./format.js";
import { savePrefs as realSavePrefs, type CcxPrefs } from "./prefs.js";
import {
  MODEL_FOOTER, MODEL_SUBTITLE, MODEL_TITLE, MODEL_UNIT, modelLabel, modelName, modelOverflowCount,
  modelVisibleCount, sessionOnlyLine,
} from "./modelPickerModel.js";


export interface ModelInfo { value: string; displayName?: string; description?: string }

export function ModelPicker({ models, current, sessionModel, onPick, onCancel, savePrefs = realSavePrefs, rows, columns }: {
  models: ModelInfo[];
  /** The row that reads as the model in force — `success` + a trailing tick, and where the cursor opens
   *  (upstream's `initial`/`defaultValue` + `defaultFocusValue`, L441127). */
  current?: string;
  /** Set while a `s` pick is in force, which is the ONLY thing that renders the third header line. */
  sessionModel?: string;
  /** `saveDefault` is the Enter/`s` split. The prefs write has already happened when it is true — the caller
   *  gets it so the confirmation notice can say which of the two sentences applies. */
  onPick: (m: ModelInfo, opts: { saveDefault: boolean }) => void;
  onCancel: () => void;
  savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void;
  rows?: number; columns?: number;
}) {
  // Ref-backed (keys/refState.ts): `s` and the ↓ that moved onto its row can arrive in ONE stdin chunk and
  // dispatch with no render guaranteed in between, so the `s` handler must read the focus the Select last
  // REPORTED, not the one its own render closed over.
  const [, setFocus, focusRef] = useRefState<string>(current ?? models[0]?.value ?? "");
  const visible = modelVisibleCount(models.length);
  // The window `Select` LAST RENDERED — it clamps `visible` again by terminal height (`clampVisible`), so on a
  // short pane the ten-row cap is not what is on screen and the counter must not quote it. State, not a ref:
  // the counter is rendered output and has to repaint when the window moves. `onViewChange` fires from an
  // effect, after a paint (Select.tsx's own contract note), so setting state from it is safe.
  const [view, setView] = React.useState<{ start: number; end: number } | undefined>(undefined);
  const overflow = modelOverflowCount(models.length, view);

  const choose = (value: string, saveDefault: boolean) => {
    const m = models.find((o) => o.value === value);
    if (!m) return;
    // The write goes FIRST, so a caller that unmounts the picker inside `onPick` (every caller does) cannot
    // race it. It is the picker's own job and not useChat's for one reason: `s` never reaches useChat as a
    // key at all, so "which of the two sentences is true" has to be decided here anyway.
    // BEST-EFFORT, like every other prefs writer (ChatApp's `app:toggleTodos`): KeymapProvider does not catch
    // what an action handler throws, so an unwritable prefs dir would take the whole REPL down on Enter.
    if (saveDefault) { try { savePrefs({ model: m.value }); } catch { /* prefs are best-effort */ } }
    onPick(m, { saveDefault });
  };

  // Pushed OUTSIDE the Select (this component mounts first, the Select is inner and keeps every key it
  // binds). `s` is bound in no other context, so it resolves here — and `Select` never sees it.
  useKeyScope("ModelPicker");
  useKeyActions({ "modelPicker:thisSessionOnly": () => choose(focusRef.current, false) });

  return (
    <DialogFrame
      title={MODEL_TITLE} titleColor="remember" color="permission"
      subtitle={
        <Box flexDirection="column">
          <Text dimColor>{MODEL_SUBTITLE}</Text>
          {sessionModel ? <Text dimColor>{sessionOnlyLine(modelName(models, sessionModel))}</Text> : null}
        </Box>
      }
    >
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Select
          options={models.map((m) => ({ value: m.value, label: modelLabel(m), ...(m.description ? { description: m.description } : {}) }))}
          visibleOptionCount={visible} defaultValue={current} defaultFocusValue={current}
          {...(rows !== undefined ? { rows } : {})} {...(columns !== undefined ? { columns } : {})}
          onFocus={setFocus}
          onViewChange={(v) => setView({ start: v.start, end: v.end })}
          onChange={(value) => choose(value, true)}
          onCancel={onCancel}
        />
        {/* `hva` L441132: the counter is the CALLER's row, indented three columns, and it counts the rows the
            window left off — the RENDERED one (W-S11), not upstream's fixed cap. `Select` prints nothing of
            the kind itself; it only reports what it drew. */}
        {overflow > 0 ? <Box paddingLeft={3}><Text dimColor>{formatOverflowCount(overflow, MODEL_UNIT)}</Text></Box> : null}
      </Box>
      <Text dimColor>{MODEL_FOOTER}</Text>
    </DialogFrame>
  );
}
