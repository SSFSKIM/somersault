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
import { ModelSwitchConfirm } from "./ModelSwitchConfirm.js";
import { needsModelConfirm } from "./modelConfirmModel.js";
import { savePrefs as realSavePrefs, type CcxPrefs } from "./prefs.js";
import {
  MODEL_FOOTER, MODEL_SUBTITLE, MODEL_TITLE, MODEL_UNIT, modelLabel, modelName, modelOverflowCount,
  modelVisibleCount, sessionOnlyLine,
} from "./modelPickerModel.js";


export interface ModelInfo { value: string; displayName?: string; description?: string }

export function ModelPicker({ models, current, sessionModel, outputTokens = 0, ackedAt, onPick, onCancel, savePrefs = realSavePrefs, rows, columns }: {
  models: ModelInfo[];
  /** The row that reads as the model in force — `success` + a trailing tick, and where the cursor opens
   *  (upstream's `initial`/`defaultValue` + `defaultFocusValue`, L441127). */
  current?: string;
  /** Set while a `s` pick is in force, which is the ONLY thing that renders the third header line. */
  sessionModel?: string;
  /** WAVE S T12 — the two inputs of the cache-warning gate (`needsModelConfirm`). `outputTokens` is the
   *  session's CUMULATIVE output count (`totalOutputTokens(session.usage())`, fetched by `openModelPicker`)
   *  and `ackedAt` is the count at which this warning was last accepted. Both come in as props because
   *  neither can live here: the picker unmounts on every pick, so an ack it owned would forget itself
   *  immediately. `useChat` owns the ack and threads it back in (see `pickModel`). */
  outputTokens?: number;
  ackedAt?: number;
  /** `saveDefault` is the Enter/`s` split. The prefs write has already happened when it is true — the caller
   *  gets it so the confirmation notice can say which of the two sentences applies. `confirmed` is set only
   *  when this pick passed the T12 switch confirm, and it is what tells `useChat` to stamp the ack — a pick
   *  that never saw the dialog must not suppress the NEXT one. */
  onPick: (m: ModelInfo, opts: { saveDefault: boolean; confirmed?: boolean }) => void;
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

  // WAVE S T12: the pending pick while the switch confirm is up. Ref-backed for the same reason the focus
  // is — `s` and Enter can arrive in one chunk, and the `s` handler has to see the stage the earlier key put
  // us in, not the one its render closed over.
  const [confirm, setConfirm, confirmRef] = useRefState<{ m: ModelInfo; saveDefault: boolean } | null>(null);

  const commit = (m: ModelInfo, saveDefault: boolean, confirmed: boolean) => {
    // The write goes FIRST, so a caller that unmounts the picker inside `onPick` (every caller does) cannot
    // race it. It is the picker's own job and not useChat's for one reason: `s` never reaches useChat as a
    // key at all, so "which of the two sentences is true" has to be decided here anyway.
    // BEST-EFFORT, like every other prefs writer (ChatApp's `app:toggleTodos`): KeymapProvider does not catch
    // what an action handler throws, so an unwritable prefs dir would take the whole REPL down on Enter.
    if (saveDefault) { try { savePrefs({ model: m.value }); } catch { /* prefs are best-effort */ } }
    onPick(m, { saveDefault, ...(confirmed ? { confirmed: true } : {}) });
  };

  const choose = (value: string, saveDefault: boolean) => {
    const m = models.find((o) => o.value === value);
    if (!m) return;
    // WAVE S T12 (W-S9), THE ORDERING THAT IS THE WHOLE POINT: the gate runs BEFORE the prefs write above,
    // not in `useChat.pickModel`. `commit`'s write still goes first RELATIVE TO `onPick` — it just now goes
    // after the confirm. Gated at `pickModel` instead, a decline would leave the default model already
    // written to prefs, i.e. the switch the user refused would silently become their default for every new
    // session. Declining from here writes nothing, picks nothing and stamps nothing, so the same switch
    // asks again.
    if (needsModelConfirm({ next: m.value, current, sessionModel, outputTokens, ackedAt })) { setConfirm({ m, saveDefault }); return; }
    commit(m, saveDefault, false);
  };

  // Pushed OUTSIDE the Select (this component mounts first, the Select is inner and keeps every key it
  // binds). `s` is bound in no other context, so it resolves here — and `Select` never sees it.
  useKeyScope("ModelPicker");
  // Inert behind the confirm: the list is not on screen, so there is no focused row for `s` to mean, and a
  // second pick queued behind an unanswered warning is exactly what the warning is there to prevent.
  useKeyActions({ "modelPicker:thisSessionOnly": () => { if (confirmRef.current) return; choose(focusRef.current, false); } });

  // The confirm REPLACES the list, as upstream's own confirm screen does — and returning to the list on a
  // decline is what "No, go back" means, so the picker stays mounted with its focus and window intact.
  if (confirm) {
    return (
      <ModelSwitchConfirm
        target={confirm.m.displayName ?? confirm.m.value}
        onAccept={() => { setConfirm(null); commit(confirm.m, confirm.saveDefault, true); }}
        onCancel={() => setConfirm(null)}
      />
    );
  }

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
