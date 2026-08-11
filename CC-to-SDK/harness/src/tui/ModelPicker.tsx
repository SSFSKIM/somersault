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
  /** WAVE C TASK 13 (t13 review finding 3): the catalog row's own target id (`opus` → `claude-opus-5`).
   *  Read by `withDefaultRowDescription` alone — see `ModelRow.resolvedModel` for why it outranks our
   *  alias table. */
  resolvedModel?: string;
  /** WAVE C TASK 11 (EP-C6): the catalog's own two effort fields (`sdk.d.ts` ModelInfo). They come off
   *  `capabilities().models` — the SAME source the picker's rows already come from, which is why the effort
   *  row needs no second capability lookup and why "does this model support effort" is answered per ROW
   *  rather than once per session.
   *
   *  WAVE 2 TASK 5 (s2qa4-06) SETTLED WHAT ABSENCE MEANS, and it is the opposite of what this comment used
   *  to say. Probe 103 dumped the live catalog: every model's row carries `supportsEffort: true` PLUS
   *  `supportedEffortLevels` except haiku, whose row omits both fields entirely. So the catalog states
   *  support positively and says nothing when there is none — absence is ABSENT support, not unknown
   *  support, and the gate below is `=== true`. (A catalog too old to carry the field at all therefore
   *  renders every row locked. That is the honest reading of a catalog that never claims the axis, and it
   *  is not reachable on any SDK this harness supports.) */
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
  /** WAVE C TASK 11 (EP-C6), the effort row's three props. `effort` is the level the picker OPENS on (the
   *  session's live one; useChat owns it), `defaultEffort` is what the `(default)` clause compares against,
   *  and `onEffortChange` is the COMMIT — it fires at most once per picker, on the way out.
   *
   *  WAVE 2 TASK 5 (s2qa4-05) — THE PICKER IS A TRANSACTION, and the old "stepping applies live" reading was
   *  wrong about upstream, not merely different from it. `zAe` seeds the level into LOCAL state once at
   *  mount (L440938); `lOH` (L441052) — the ←/→ handler — writes `$PH` (that local value) and `IAI(!0)` (a
   *  dirty flag) and NEVER the app-state setter; and the single commit is `nvn` (L441077), reached from the
   *  Select's `onChange` (Enter) or the `s` chord and GUARDED on that dirty flag. Esc is a no-op by
   *  construction: no path outside those two writes anything. §C6.3's footer says only "←/→ to adjust"
   *  because the dialog's own Enter carries the effort out WITH the model, not because a step is the whole
   *  gesture. The fleet found ccx's live-apply as s2qa4-05 (stepped level survived Esc; `/status` reported
   *  a level the user cancelled). */
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

  // W2 T5: THE STAGED LEVEL — `zAe`'s own `useState(effort)` (L440938). Seeded from the prop ONCE, at mount,
  // and never re-seeded: from here on the picker owns the value on screen and the parent owns the session's,
  // and they are deliberately allowed to differ until the commit reconciles them. (This is also why the
  // parent's `effort` prop is read nowhere below except as this seed and as the "is there an axis at all"
  // gate on the row.)
  //   Ref-backed for the reason `focusRef` is: `→→` can arrive in ONE stdin chunk and dispatch twice with no
  // render between them, so the second step must compute off what the first staged. That is exactly the job
  // the old `effortRef` prop-bridge did, which is why it is gone — this ref subsumes it, and without the
  // bridge's weakness of being overwritten by a prop the parent may not have changed.
  const [staged, setStaged, stagedRef] = useRefState<EffortLevel | undefined>(effort);
  // `IAI` (L441052). The commit is guarded on it and not on `staged !== effort` for a reason upstream's own
  // guard has: a step out and back (→ then ←) lands on the level the picker opened with, and re-firing the
  // op for it would re-post the decaying hint and re-hit the wire for a no-op edit.
  const dirtyRef = useRef(false);

  const commit = (m: ModelInfo, saveDefault: boolean, confirmed: boolean) => {
    // The write goes FIRST, so a caller that unmounts the picker inside `onPick` (every caller does) cannot
    // race it. It is the picker's own job and not useChat's for one reason: `s` never reaches useChat as a
    // key at all, so "which of the two sentences is true" has to be decided here anyway.
    // BEST-EFFORT, like every other prefs writer (ChatApp's `app:toggleTodos`): KeymapProvider does not catch
    // what an action handler throws, so an unwritable prefs dir would take the whole REPL down on Enter.
    if (saveDefault) { try { savePrefs({ model: m.value }); } catch { /* prefs are best-effort */ } }
    // W2 T5: `nvn`'s dirty-guarded write (L441077). THIS is the whole commit surface of the effort
    // transaction, and it sits here rather than in each key handler because all THREE paths that can end the
    // picker with a pick funnel through `commit`: the Select's Enter and the `s` chord (both via `choose`)
    // and the T12 switch-confirm's accept. A declined confirm returns to the list without passing here, so
    // the staged level and the dirty flag survive it — the pick was refused, not the edit.
    // Before `onPick`, which unmounts us: the effort belongs to the same gesture as the model, and a parent
    // that tears the picker down inside `onPick` must not be able to strand it.
    const staged = stagedRef.current;
    if (dirtyRef.current && onEffortChange && staged) { dirtyRef.current = false; onEffortChange(staged); }
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
  // W2 T5 (s2qa4-06): POLARITY. Support is stated positively by the live catalog or it is not there at all
  // (probe 103 — see `supportsEffort` above), so `undefined` means locked, exactly as haiku's row means it.
  const effortSupported = (row: ModelInfo | undefined): boolean => row?.supportsEffort === true;
  const stepBy = (delta: 1 | -1): void => {
    // Three ways to be inert, all of them "there is nothing here to adjust": no parent listening (nothing to
    // commit TO, so staging would be a control that lies), the confirm screen has replaced the list (same
    // reason `s` is inert behind it), or the focused model has no effort axis at all.
    const from = stagedRef.current;
    if (!onEffortChange || !from || confirmRef.current) return;
    const row = rowOf(focusRef.current);
    if (!effortSupported(row)) return;
    setStaged(stepEffort(row?.supportedEffortLevels ?? EFFORT_LEVELS, from, delta));
    dirtyRef.current = true;
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
        // W2 T5: the row draws the STAGED level, which is the only place a step is visible until the commit.
        // Gated on the PROP, not the staged value — "did the caller give us an axis at all" is a fact about
        // the session (`ccx attach` never learns a launch level) and cannot change while we are mounted.
        <EffortRow level={staged ?? effort} isDefault={(staged ?? effort) === defaultEffort}
          supported={effortSupported(rowOf(focus))}
          {...(() => { const n = modelLabel(rowOf(focus)); return n ? { modelName: n } : {}; })()} />
      ) : null}
      <Text dimColor>{MODEL_FOOTER}</Text>
    </DialogFrame>
  );
}
