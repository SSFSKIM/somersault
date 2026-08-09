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
import React, { useRef } from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./dialogs/DialogFrame.js";
import { useKeyActions, useKeyScope } from "./keys/KeymapProvider.js";
import { useRefState } from "./keys/refState.js";
import { Select } from "./select/Select.js";
import { formatOverflowCount } from "./format.js";
import { ModelSwitchConfirm } from "./ModelSwitchConfirm.js";
import { needsModelConfirm } from "./modelConfirmModel.js";
import { savePrefs as realSavePrefs, type CcxPrefs } from "./prefs.js";
import { EffortRow } from "./EffortRow.js";
import {
  EFFORT_LEVELS, MODEL_FOOTER, MODEL_SUBTITLE, MODEL_TITLE, MODEL_UNIT, modelLabel, modelName,
  modelOverflowCount, modelVisibleCount, sessionOnlyLine, stepEffort, withDefaultRowDescription, type EffortLevel,
} from "./modelPickerModel.js";


export interface ModelInfo {
  value: string; displayName?: string; description?: string;
  /** WAVE C TASK 11 (EP-C6): the catalog's own two effort fields (`sdk.d.ts` ModelInfo). They come off
   *  `capabilities().models` — the SAME source the picker's rows already come from, which is why the effort
   *  row needs no second capability lookup and why "does this model support effort" is answered per ROW
   *  rather than once per session. Absent on a catalog that predates them, which reads as "unknown": the
   *  supported arm renders and the full five-level list is what stepping wraps through. */
  supportsEffort?: boolean;
  supportedEffortLevels?: EffortLevel[];
}

export function ModelPicker({ models, current, sessionModel, activeModel, outputTokens = 0, ackedAt, effort, defaultEffort, onEffortChange, onPick, onCancel, savePrefs = realSavePrefs, rows, columns }: {
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
  /** The RESOLVED model actually in force (`useChat`'s `model`). The gate's third comparison rung, for the
   *  case `current` cannot cover: `current` is a catalog ROW, and a session pinned to an explicit id that no
   *  row carries matches nothing, which without this would leave the warning permanently off (upstream's own
   *  `YMo(r ?? t)` → `ZN()` configured-model fallback). */
  activeModel?: string;
  /** `saveDefault` is the Enter/`s` split. The prefs write has already happened when it is true — the caller
   *  gets it so the confirmation notice can say which of the two sentences applies. `confirmed` is set only
   *  when this pick passed the T12 switch confirm, and it is what tells `useChat` to stamp the ack — a pick
   *  that never saw the dialog must not suppress the NEXT one. */
  /** WAVE C TASK 11 (EP-C6), the effort row's three props. `effort` is the SESSION's live level (useChat
   *  owns it — the row reflects state, it does not hold it), `defaultEffort` is what the `(default)` clause
   *  compares against, and `onEffortChange` fires on every ←/→ step.
   *
   *  STEPPING APPLIES LIVE, unlike the standalone dialog's staged Enter (EffortDialog.tsx says why): §C6.3's
   *  row carries only "←/→ to adjust" — it has no confirm of its own, and this dialog's Enter already means
   *  "pick this model". So a step is the whole gesture, and the hint that decays ten seconds later is the
   *  feedback for it. */
  effort?: EffortLevel;
  defaultEffort?: EffortLevel;
  onEffortChange?: (level: EffortLevel) => void;
  onPick: (m: ModelInfo, opts: { saveDefault: boolean; confirmed?: boolean }) => void;
  onCancel: () => void;
  savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void;
  rows?: number; columns?: number;
}) {
  // Ref-backed (keys/refState.ts): `s` and the ↓ that moved onto its row can arrive in ONE stdin chunk and
  // dispatch with no render guaranteed in between, so the `s` handler must read the focus the Select last
  // REPORTED, not the one its own render closed over.
  // WAVE C TASK 11 reads the STATE half too (it was discarded before): the effort row is rendered output and
  // has to repaint when the cursor moves onto a model with a different effort capability. The ref half stays
  // what the key handlers read — see the chunk note above.
  const [focus, setFocus, focusRef] = useRefState<string>(current ?? models[0]?.value ?? "");
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
    if (needsModelConfirm({ next: m.value, current, sessionModel, fallbackModel: activeModel, outputTokens, ackedAt })) { setConfirm({ m, saveDefault }); return; }
    commit(m, saveDefault, false);
  };

  // Pushed OUTSIDE the Select (this component mounts first, the Select is inner and keeps every key it
  // binds). `s` is bound in no other context, so it resolves here — and `Select` never sees it.
  useKeyScope("ModelPicker");
  // WAVE C TASK 11: which model the effort row is ABOUT is the FOCUSED row, not `current` — the picker is a
  // window onto the model you are considering, and upstream reads `tvn`/`nva` off the same highlighted entry
  // its `s` key acts on. Read through the focus REF and not the rendered row for the reason the `s` handler
  // does: `↓→` can arrive in one stdin chunk with no render between the two dispatches.
  const rowOf = (value: string): ModelInfo | undefined => models.find((m) => m.value === value);
  // The level the NEXT step computes from. The parent owns `effort`, but `→→` can arrive in one stdin chunk
  // and dispatch twice with no render between them — off the prop alone the second press would recompute
  // from the same pre-chunk level and the pair would net ONE step. Reassigned from the prop on every render,
  // so a parent that declines to apply a step (or applies a different level) still wins at the next paint;
  // this only bridges the gap inside a chunk. Same reason `focusRef` exists two lines up.
  const effortRef = useRef<EffortLevel | undefined>(effort);
  effortRef.current = effort;
  const effortSupported = (row: ModelInfo | undefined): boolean => row?.supportsEffort !== false;
  const stepBy = (delta: 1 | -1): void => {
    // Three ways to be inert, all of them "there is nothing here to adjust": no parent listening, the
    // confirm screen has replaced the list (same reason `s` is inert behind it), or the focused model has no
    // effort axis at all.
    const from = effortRef.current;
    if (!onEffortChange || !from || confirmRef.current) return;
    const row = rowOf(focusRef.current);
    if (!effortSupported(row)) return;
    const next = stepEffort(row?.supportedEffortLevels ?? EFFORT_LEVELS, from, delta);
    effortRef.current = next;
    onEffortChange(next);
  };
  // Inert behind the confirm: the list is not on screen, so there is no focused row for `s` to mean, and a
  // second pick queued behind an unanswered warning is exactly what the warning is there to prevent.
  useKeyActions({
    "modelPicker:thisSessionOnly": () => { if (confirmRef.current) return; choose(focusRef.current, false); },
    "modelPicker:decreaseEffort": () => { stepBy(-1); },
    "modelPicker:increaseEffort": () => { stepBy(1); },
  });

  // The confirm REPLACES the list, as upstream's own confirm screen does, and a decline returns to it —
  // which is what "No, go back" means. NB the list REMOUNTS on that return: `Select` is unmounted while the
  // confirm is up, so it comes back on `defaultFocusValue={current}` and the cursor sits on the model in
  // force, not on the row that was just declined. That is upstream's behavior too (its confirm is a separate
  // screen over a freshly mounted list), so it is recorded here rather than worked around.
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
        {/* §C8.6 (W-C T13): the catalog's `default` row arrives describing the SDK's default, which is not
            ccx's — rewritten on the way in, so every caller of this picker gets the honest sentence. */}
        <Select
          options={withDefaultRowDescription(models).map((m) => ({ value: m.value, label: modelLabel(m), ...(m.description ? { description: m.description } : {}) }))}
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
      {/* `yva` L441142 — WAVE C TASK 11 (EP-C6). Sits BETWEEN the list and the footer, gated on the caller
          having an effort axis to show at all: `ccx attach` never learns a launch level, and a parent that
          passes none gets the picker exactly as it was before this task. */}
      {effort ? (
        <EffortRow level={effort} isDefault={effort === defaultEffort}
          supported={effortSupported(rowOf(focus))}
          {...(() => { const n = modelLabel(rowOf(focus)); return n ? { modelName: n } : {}; })()} />
      ) : null}
      <Text dimColor>{MODEL_FOOTER}</Text>
    </DialogFrame>
  );
}
