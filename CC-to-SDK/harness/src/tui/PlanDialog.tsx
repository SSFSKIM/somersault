// tui/src/PlanDialog.tsx — `Ready to code?`, the ExitPlanMode approval dialog (F6 T9). Rebuilt from
// 2.1.220's `Gnl` (L500755-501140) with its option builder `sYf` (L500696-714), its outcome map `lYf`
// (L500721-738) and its key handler `tYf` (L501036-060). The pre-F6 body — three hand-rolled numbered lines,
// a `y` shortcut, a mode-switched feedback line and ↑/↓ scrolling the plan — is gone entirely.
//
// THE SHAPE IS TWO SIBLINGS, not one box (L501133-137):
//   · a region holding the `Ed` frame titled "Ready to code?" in the `planMode` role, whose body is
//     "Here is Claude's plan:" → the plan through F4's markdown renderer → the consent line;
//   · BELOW it, a SEPARATE top-bordered `planMode` box carrying the prompt, the `Select` and the ctrl+g row.
// The second box is what upstream measures (`Q7f`/`W5(...)`, L500845) to size the first; nothing paints
// between them, so the two rules read as one dialog with the plan scrolling inside it.
//
// WHERE IT MOUNTS is Task 5's and unchanged: the modal slot, composer-replacing — the one `layout:"modal"`
// entry in `ypi` (L507338) — with typing-suppression covering it.
//
// ── Four deliberate divergences, all recorded for T15 ─────────────────────────────────────────────────
//  1. NO SCROLL CONTAINER, AND AN INVENTED READING PATH. Upstream wraps the plan in `a4` (L434893), a
//     fork-only Ink `ink-box` with `overflowY:"scroll"` and an imperative handle driven by the APP's scroll
//     region — mouse wheel and the global pager, never a key of the dialog's own (`tYf` binds ctrl+g and
//     shift+tab, nothing else). Stock Ink 5 has no such box. So the region CLIPS at the same computed height,
//     SAYS what it withheld, and — because a plan you cannot finish reading is not an approval gate —
//     **ctrl+u / ctrl+d scroll it by half a window**. THOSE TWO KEYS ARE OURS, NOT UPSTREAM'S: they are the
//     pager's own halves (`Transcript`'s `scroll:halfPageUp`/`halfPageDown`, reused rather than reinvented),
//     newly bound in the `SelectDecision` context. The pre-F6 dialog scrolled with ↑/↓; those belong to the
//     Select now, which is why the binding had to move rather than survive.
//  2. NO IMAGE PASTE. Upstream's Select takes `onImagePaste`/`pastedContents` (L501122) and an image-only
//     "no" submit is a legal reject carrying `contentBlocks` (`lYf` L500736). Our `Select` has no image
//     surface (Select.tsx's own recorded divergence), so the images clause of `lYf`'s guard is transcribed
//     here and not built: for us `hasImages` is always false.
//  3. THE APPROVE FEEDBACK REACHES CCX, NEVER THE MODEL. Upstream's shift+tab approves carrying the typed
//     text as `acceptFeedback`, and that field HAS a destination: `handleUserAllow` hands it to `buildAllow`
//     (L272001/272008), which puts it on the permission result, and the tool-result builder then pushes it
//     into the tool_result CONTENT as a second `{type:"text"}` block (L298586-589) — so the model reads the
//     user's sentence in the very message that tells it the plan was approved. None of that is reachable
//     from a `canUseTool`: the SDK's `PermissionResult` allow arm is exactly `{behavior, updatedInput?,
//     updatedPermissions?, toolUseID?, decisionClassification?}` (sdk.d.ts L2113-2119) — no message field —
//     and the tool result is assembled inside the engine, where a client has no hook. The three near-misses
//     were checked and rejected: `updatedInput.plan` is NOT a spare channel (ExitPlanMode WRITES that string
//     to the plan file, L229930, and echoes it under "## Approved Plan:", L230000, so appended feedback
//     would corrupt the saved plan and read to the model as plan content); an extra `updatedInput` key is
//     read by nothing (L229928 takes `plan` alone); and a follow-up user message is a QUEUED TURN
//     (session.ts's `enqueueTurn`) that would land only after the model had executed the entire plan.
//     SO THE TEXT TRAVELS AS FAR AS CCX'S OWN DECISION AND STOPS. `plan_approve` carries `feedback`, and
//     exactly one consumer reads it: the app-server's `decision/resolved` fan-out, which broadcasts the whole
//     outcome to every subscriber of the thread (server.ts:278). The HOST path drops it — `decision_settled`
//     carries `outcome.kind` alone (host.ts:701), and the gate deliberately does not put it on the allow arm
//     because there is no arm to put it on — so on `ccx` and `ccx attach` the sentence is parsed and then
//     discarded. KNOWN GAP: nothing surfaces it on the REPL path. An approved-plan transcript row carrying
//     the text is the piece that would complete this, and it is deliberately not built. The row's
//     description stays trimmed to `SHIFT_TAB_HINT` below rather than restored to upstream's "shift+tab to
//     approve with this feedback": that wording promises the MODEL will read it, and advertising a channel
//     that drops the user's sentence is the one thing F0's honesty rule forbids — and the one thing this
//     wave has already had to retract once (W-T22).
//  4. THE OPTION LIST IS THE REACHABLE SUBSET (DG30, partial). `sYf`'s clear-context family and the
//     Ultraplan row gate on host state a client cannot see — a remote-session flag, a context-usage
//     percentage — and each of them ends in a `{behavior:"deny"}` plus an app-state hand-off (L500960-969)
//     rather than a tool answer. Recorded, not built. The bypass/auto one-of arms ARE built (Wave T t10):
//     upstream's single `gI()` has no ccx equivalent, but its two halves do — see `PlanAvailability`.
//
// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────
// Nothing here reads stdin. The `Select` pushes `SelectDecision` from INSIDE the dialog and owns the list
// (↑/↓/j/k, ctrl+n/p, digits, Enter, Esc and the text of the keep-planning row); this component pushes
// `Confirmation` around it for the two chords upstream binds on the dialog itself, and registers NOTHING
// else — `y`/`n` resolve to Confirmation actions with no handler and fall through to the Select, which is
// how they became plain letters inside the keep-planning row without any key-sniffing.
//
// ENTER NOW APPROVES THE FOCUSED ROW, reversing the F2-task-8 pin that made it dead. That pin protected a
// user mid-sentence when the plan arrives: Enter to send would have approved. Three things retired the
// hazard — the dialog is modal and composer-replacing (T5), typing-suppression holds the dialog back while
// a draft is live, and the draft is preserved across the dialog. What is left is a Select-driven list where
// Enter has a visible target, which is upstream's own contract and the same one every other F6 dialog got.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { homedir } from "node:os";
import { Box, Text } from "ink";
import { DialogFrame } from "./dialogs/DialogFrame.js";
import { consentReasonLine } from "./dialogs/consentReason.js";
import { Select, TICK, type SelectOption } from "./select/Select.js";
import { useKeyActions, useKeyScope, useSuspendInput } from "./keys/KeymapProvider.js";
import { useRefState } from "./keys/refState.js";
import { editExternal, editorDisplayName } from "./externalEditor.js";
import { renderMarkdown } from "./markdown.js";
// `SM`'s fork-only border, shared with the file dialog's write body since t17 — see boxStyles.ts.
import { DASHED_BORDER } from "./boxStyles.js";
// The transcript's line renderer, reused verbatim: renderMarkdown's RenderLine carries bold/italic/segments
// (not just `{text, dim?, color?}`), and one renderer keeps the dialog's styling from drifting from the
// transcript's. `gutter` is never set on markdown output, so the shared branch is simply inert here.
import { Line } from "./Transcript.js";
// `wd()` (L36791-36799), already extracted as this repo's one display-path rule — the same function upstream
// calls on the plan file path in the ctrl+g footer (`wd(fWt)`, L501126), so the footer needs no rule of its own.
import { displayPath } from "./paths.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";
import { isAutoSupportedModel } from "../config/autoModel.js";
import type { DecisionOutcome, PlanGrantMode } from "../permissions/types.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

/** `Gnl` L501121. */
export const PLAN_PROMPT = "Claude has written up a plan and is ready to execute. Would you like to proceed?";
/** `Gnl` L501103. */
export const PLAN_BODY_TITLE = "Here is Claude's plan:";
/** `Ed`'s title, L501112. */
export const PLAN_TITLE = "Ready to code?";
/** L501126. Prefixed on screen by `vo({status:"success"})`'s tick (`Ge.tick`, L393878) — the same glyph the
 *  Select's current-value marker uses, which is why it is imported rather than re-typed. */
export const PLAN_SAVED = "Plan saved!";
/** `Jc(I$b, yDr ? 5000 : null, x$b)` L500810: the flash clears itself after five seconds. */
export const SAVED_FLASH_MS = 5000;
/** Divergence 3 above. Upstream: "shift+tab to approve with this feedback" (`sYf` L500713). */
export const SHIFT_TAB_HINT = "shift+tab to approve";
/** Divergence 1 above: the invented reading path, named in the clip marker so it is never a secret key. */
export const SCROLL_HINT = "ctrl+u/ctrl+d scroll";
/** The EMPTY-PLAN dialog (`Gnl` L501048-079) — a different frame, not an empty body. */
export const EMPTY_PLAN_TITLE = "Exit plan mode?";
export const EMPTY_PLAN_BODY = "Claude wants to exit plan mode";
export const EMPTY_PLAN_OPTIONS: readonly SelectOption[] = Object.freeze([
  { label: "Yes", value: "yes" }, { label: "No", value: "no" },
]);

/** Which of upstream's one-of arms this SESSION can actually offer (`sYf`'s `isBypassPermissionsModeAvailable`
 *  / `isAutoModeAvailable` params, L500695). ccx has no single `gI()`, so the two sources are named
 *  separately: auto is `isAutoSupportedModel(model)` (autoModel.ts's live-verified set — the mode is
 *  MODEL-gated and falls back to `default` in silence off it), bypass is the launch-time
 *  `allowDangerouslySkipPermissions`, which resolveOptions.ts:67 sets iff the session launched in
 *  `bypassPermissions`. Both default to FALSE where the client cannot know: an attach client has no model
 *  until its first turn ends (useChat.ts's `applyMode` note), and guessing there would offer a grant the
 *  engine may refuse. */
export interface PlanAvailability { autoAvailable: boolean; bypassAvailable: boolean }

/** `sYf` L500705-714: the clear-context family and the Ultraplan row are DG30's unbuilt arms, but the
 *  one-of in the middle is exactly upstream's — bypass first, then auto, then the plain accept-edits arm,
 *  and never two of them. The keep-planning row is an `RLe` text row with NO `allowEmptySubmitToCancel` —
 *  that omission is what makes an empty Enter behave like Esc (see `cancel` below), and it is upstream's,
 *  not ours. A FUNCTION rather than a frozen const since Wave T t10: the label the human reads and the
 *  mode the approval grants are one decision, and freezing the label froze the grant to the narrowest
 *  one upstream has (qa3-17). */
export function planOptions({ autoAvailable, bypassAvailable }: PlanAvailability): SelectOption[] {
  return [
    bypassAvailable
      ? { label: "Yes, and bypass permissions", value: "yes-accept-edits-keep-context" }
      : autoAvailable
      ? { label: "Yes, and use auto mode", value: "yes-resume-auto-mode" }
      : { label: "Yes, auto-accept edits", value: "yes-accept-edits-keep-context" },
    { label: "Yes, manually approve edits", value: "yes-default-keep-context" },
    { type: "input", label: "No, keep planning", value: "no", placeholder: "Tell Claude what to change", description: SHIFT_TAB_HINT },
  ];
}

/** `lYf` L500727-731, transcribed: the option value plus the same availability decides the granted mode.
 *  Note the auto row's own fallback — `yes-resume-auto-mode` WITHOUT `gI()` grants `default`, not auto
 *  (L500728) — which is why this reads availability again instead of trusting the value alone. */
export function planGrant(value: string, { autoAvailable, bypassAvailable }: PlanAvailability): PlanGrantMode {
  if (value === "yes-resume-auto-mode") return autoAvailable ? "auto" : "default";
  if (value === "yes-accept-edits-keep-context") return bypassAvailable ? "bypassPermissions" : "acceptEdits";
  return "default";
}

// ── How tall the plan region gets ─────────────────────────────────────────────────────────────────────
// `zCk = Math.max(1, VCk.rows - tvt - 4)` (L500881) in the branch where there is no app scroll region:
// the whole terminal, minus the MEASURED height of the option box, minus four rows of slack. We cannot
// measure — Ink 5 exposes no layout handle — but we BUILD that box, so its height is arithmetic rather
// than a guess, and the two constants below are that arithmetic written out.
/** Rows the option box occupies: its top rule, the prompt, the Select's `marginTop`, one row per option plus
 *  one more for each option that carries a description, and (when an editor is configured) the ctrl+g row's
 *  margin and the row itself. DERIVED from the list, so adding one of DG30's unbuilt arms cannot silently
 *  desynchronise the height from what is on screen — which is also why `options` is a PARAMETER and not a
 *  second `planOptions()` call: the caller must feed the very array it renders, or the region is sized for
 *  a list nobody sees. */
export function optionBoxRows(options: readonly SelectOption[], hasEditor: boolean): number {
  return 1 + 1 + 1 + options.length + options.filter((o) => o.description).length + (hasEditor ? 2 : 0);
}
/** Rows the frame spends on chrome before a single plan line prints: the frame's `marginTop`, its rule, its
 *  title, the body's `marginTop`, "Here is Claude's plan:", `SM`'s TWO dashed rules around the plan, the
 *  `marginBottom` under them, and the consent line when there is one — plus upstream's own four rows of slack.
 *  The CLIP MARKER is deliberately not in here: it costs a row only when something is actually hidden, which
 *  `planWindow` decides. The two rules are counted rather than absorbed into the slack: they are painted
 *  unconditionally, so a plan sized against a budget that ignored them overflows the terminal by exactly two. */
export function planRegionRows(rows: number, options: readonly SelectOption[], hasEditor: boolean, hasReason: boolean): number {
  const chrome = 1 + 1 + 1 + 1 + 1 + 2 + 1 + (hasReason ? 1 : 0) + 4;
  return Math.max(3, rows - optionBoxRows(options, hasEditor) - chrome);
}
/** How many plan lines actually print. A plan that FITS gets the whole region; one that does not gives a row
 *  back to the marker — so a plan of exactly `region + 1` lines is not clipped for the sake of a marker row
 *  announcing the single line the marker itself displaced. */
export function planWindow(region: number, lineCount: number): number {
  return lineCount > region ? Math.max(1, region - 1) : region;
}

export interface PlanDialogRequest {
  input: Record<string, unknown>;
  subagentType?: string;
  decisionReason?: string;
}

export function PlanDialog({ req, onDecision, editor = editExternal, editorName, rows, suspendInput, model, bypassAvailable = false }: {
  req: PlanDialogRequest;
  onDecision: (o: DecisionOutcome) => void;
  /** The model the ENGINE is running, for the auto arm's gate. `undefined` — an attach client before its
   *  first turn end (useChat.ts:1450-1453) — is "unknown", which means NOT available: falling back to
   *  upstream's neither-available arm offers a narrower grant than the session might allow, and that is
   *  the honest direction to be wrong in. */
  model?: string;
  /** The launch-time `allowDangerouslySkipPermissions` (resolveOptions.ts:67). */
  bypassAvailable?: boolean;
  /** The keymap's terminal handoff, injectable for the same reason ChatComposer injects it: the ORDER of
   *  release → spawn → restore is the contract, and only a stub can watch it. Defaults to the provider's. */
  suspendInput?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** DG34's seam, injected so a test never touches a real `$EDITOR`. It MUST be synchronous: the F5 real-TTY
   *  lesson (externalEditor.ts's `restoreTtyNonblock` header) is that an awaited editor deadlocks the process
   *  deterministically, because the child restores the SHARED open file description to blocking mode while our
   *  event loop is still alive. `editExternal` is spawnSync — paint, then block — and that blocking IS the
   *  handoff. Returns null when the editor failed or was cancelled; the plan is then left alone. */
  editor?: (text: string) => string | null;
  /** `Ox(qV())`. `undefined` resolves it from the environment; `null` says "no editor", which hides the
   *  ctrl+g row exactly as upstream's `q$b &&` does. */
  editorName?: string | null;
  /** Terminal height, for the region math above. Read live from stdout by default, like `Select` does. */
  rows?: number;
}) {
  const term = rows ?? process.stdout.rows ?? 24;
  // `dk`/`h$b` (L500755-761): the plan is STATE with a ref beside it, because `Anl` writes both — the ref is
  // what a decision arriving later in the SAME stdin chunk reads, since the render closure still holds the
  // pre-edit text. Seeded from the request; edited only by ctrl+g.
  const [plan, setPlan, planRef] = useRefState<string>(String((req.input as { plan?: unknown }).plan ?? ""));
  // `Y7f` (L500806): has the human edited it here? It is the whole condition on the plan override an approve
  // carries (`u = planEditedLocally ? {plan: currentPlan} : {}`, L500722) — an untouched plan sends nothing.
  const [edited, setEdited, editedRef] = useRefState(false);
  const [saved, setSaved] = useRefState(false);                                  // `yDr`, the `Plan saved!` flash
  const [scrollTop, setScrollTop] = useState(0);                                 // divergence 1: our reading path
  // `U7f`/`eYf` (L500936): the keep-planning row's text, held HERE because `Inl` builds every outcome — the
  // approve arms included — with `acceptFeedback: eYf || undefined`, whatever row is being submitted. A plain
  // ref, not `useRefState`: nothing renders it, and the Select owns the text it paints. `onInputChange` (the
  // Select's t5 hook) is what makes the value observable without the Select having to hand it to an approve.
  const feedbackRef = useRef("");
  const name = editorName === undefined ? editorDisplayName() : editorName;
  /** `fWt` (L501126): the absolute path the CLI already wrote the plan to, shortened by upstream's own `wd()`.
   *  Probe 97 A2 — the input keys are exactly `["plan","planFilePath"]` and gate.ts forwards `input` verbatim,
   *  so this needs no plumbing; absent leaves the footer as the bare chord. */
  const planPath = typeof (req.input as { planFilePath?: unknown }).planFilePath === "string"
    ? displayPath((req.input as { planFilePath: string }).planFilePath, process.cwd(), homedir()) : undefined;
  const reason = consentReasonLine(req.decisionReason);
  const providerSuspend = useSuspendInput();           // unconditional: the prop only OVERRIDES it
  const suspend = suspendInput ?? providerSuspend;
  // `DZe` (L500763): a missing or whitespace-only plan is a DIFFERENT DIALOG, not an empty body — see the
  // `Exit plan mode?` branch below.
  const emptyPlan = plan.trim() === "";

  // ONE options array per render, fed to BOTH the geometry and the Select — a second `planOptions()` call
  // with different arguments would size the region for a list the frame does not contain. (No memo: the
  // Select has always received a fresh array each render, `[...PLAN_OPTIONS]`, and owns its own state.)
  const avail: PlanAvailability = { autoAvailable: isAutoSupportedModel(model), bypassAvailable };
  const options = planOptions(avail);

  const lines = useMemo(() => renderMarkdown(plan), [plan]);
  const region = planRegionRows(term, options, name !== null, reason !== undefined);
  const window = planWindow(region, lines.length);
  const maxTop = Math.max(0, lines.length - window);
  // Derived, not stored, for the reason `Select`'s own window is: a ctrl+g edit can shorten the plan under a
  // scrolled view, and a stored offset would then point past the end.
  const top = Math.min(scrollTop, maxTop);
  const below = Math.max(0, lines.length - (top + window));

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [saved]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** `lYf`'s allow arms (L500727-731), collapsed onto ONE channel. T3 widened `plan_approve` with an
   *  optional `updatedPermissions`, and upstream does send `Bnl(mode)` = `[{type:"setMode", …}]` beside the
   *  mode — but both appliers (host.ts's applyPlanUpgrade, appserver/planUpgrade.ts) act on the mode FIELD,
   *  so emitting the rule too would upgrade twice. The mode is the channel; no setMode rides along.
   *  Wave T t10 turned that field from a boolean into the granted mode itself: a boolean could only carry
   *  the narrowest of upstream's three arms, so the dialog printed that arm's label whatever the session
   *  could actually grant (qa3-17).
   *  `feedback` is divergence 3's reachable half: upstream's `acceptFeedback`, carried on OUR decision (the
   *  app-server's `decision/resolved` fan-out hands the whole outcome to subscribed clients; the host path
   *  drops it, so the REPL surfaces nothing) and deliberately not on the SDK's allow arm, which has no field
   *  for it. Trimmed and omitted when empty, exactly as `oMn = eYf || void 0` (L500936). */
  const approve = (mode: PlanGrantMode) => {
    const feedback = feedbackRef.current.trim();
    onDecision({ kind: "plan_approve", mode, ...(feedback ? { feedback } : {}), ...(editedRef.current ? { plan: planRef.current } : {}) });
  };

  const pick = (value: string, text?: string) => {
    if (value === "no") {
      // `lYf` L500734 / `gWt` L500975: the "no" arm needs SOMETHING to say — `if (!trimmedFeedback &&
      // !hasImages) return`. An empty submit never gets here (the Select routes it to `cancel`), and images
      // are divergence 2, so the guard reduces to a trim that cannot fail. Kept as the honest floor.
      const feedback = (text ?? "").trim();
      if (feedback) onDecision({ kind: "plan_reject", feedback });
      return;
    }
    approve(planGrant(value, avail));
  };
  /** `xnl` (L500995) — the Select's `onCancel`, which upstream answers with a bare `{behavior:"deny"}`. TWO
   *  keys land here and both mean the same thing: Esc, and Enter on an EMPTY keep-planning row (`RLe` sends
   *  an empty submit to onCancel unless the option sets `allowEmptySubmitToCancel`, L397113-118, and this
   *  option deliberately does not — nor does this body supply the `onEmptySubmit` the five consult dialogs
   *  use, because here the empty Enter IS a decision and upstream's is the same one). The gate reports a
   *  feedback-less reject as "User rejected the plan." and issues the model no instruction of its own
   *  (gate.ts, wave 2 t2). */
  const cancel = () => onDecision({ kind: "plan_reject" });

  /** `tYf` L501051: adopt the editor's text only when it came back non-null AND actually changed
   *  (`sdi.content !== null && sdi.content !== dk` → `knl(), Anl(...), K7f(!0)`). */
  const applyEdit = (next: string | null) => {
    if (next === null || next === planRef.current) return;
    setPlan(next); setEdited(true); setSaved(true); setScrollTop(0);
  };

  useKeyScope("Confirmation");
  useKeyActions({
    // `tYf` L501047: shift+tab approves from ANY row — including while the keep-planning row is being typed
    // into, which is what its description advertises. The value it submits is FIXED (`gWt(k6e ?
    // "yes-accept-edits" : "yes-accept-edits-keep-context")`), NOT the focused row's: so with the auto arm on
    // screen this chord still grants accept-edits (or bypass, where that arm is the one being offered).
    // Transcribed, not reasoned to — it reads like an upstream inconsistency and is upstream's all the same.
    "confirm:cycleMode": () => approve(planGrant("yes-accept-edits-keep-context", avail)),
    // `tYf` L501036-052, the no-plan-file branch (`Rte(dk)`): round-trip the LIVE plan through $EDITOR.
    //
    // THE WHOLE FLIGHT RUNS INSIDE THE KEYMAP'S TERMINAL HANDOFF, exactly as ChatComposer's own
    // `chat:externalEditor` does (ChatComposer.tsx's `suspendInput` note): the child is spawned with stdio
    // "inherit", so while it runs fd 0 belongs to it. Without the handoff our still-flowing `data` listener
    // races the editor for its keystrokes — a stolen `\r` would reach the Select and APPROVE THE PLAN — and
    // DECSET 2004 would still be on, so a paste into $EDITOR lands in the plan text wrapped in bracketed-paste
    // markers. `suspendInput` releases raw mode, pauses stdin and disables ?2004 BEFORE calling `fn`, and
    // restores all three in a `finally`.
    //
    // The seam stays SYNCHRONOUS where it matters: an async function body runs to its first `await`, and
    // `suspendInput`'s is `return await fn()` — so `editor` is still invoked in the same tick as the keypress,
    // which is the F5 spawnSync paint-then-block law. Only the RESULT is handled a microtask later.
    // Deliberately WITHOUT the composer's `EDITOR_PAINT_MS` deferral (recorded divergence): that timer exists
    // to flush a "Save and close editor…" row this dialog does not paint, and deferring the spawn would break
    // the same-tick law the test pins.
    "confirm:editExternal": () => {
      const run = () => Promise.resolve(editor(planRef.current));
      (suspend ? suspend(run) : run()).then(applyEdit, () => applyEdit(null));
    },
    // Divergence 1's reading path. Half a window per press, the pager's own halves.
    "scroll:halfPageUp": () => setScrollTop((t) => Math.max(0, Math.min(t, maxTop) - Math.max(1, Math.floor(window / 2)))),
    "scroll:halfPageDown": () => setScrollTop((t) => Math.min(maxTop, Math.min(t, maxTop) + Math.max(1, Math.floor(window / 2)))),
  });

  // `DZe` (L500763-500779 + L501048-501079): no plan to show, so there is nothing to approve EDITS about —
  // upstream swaps the whole dialog for a two-row yes/no over `Ed title="Exit plan mode?"`. Its Yes sends
  // `permissionUpdates: [{type:"setMode", mode:"default", …}]` (L501008), i.e. the manual-approve arm, which is
  // `mode:"default"` on our one channel; its No and its cancel are both a bare `{behavior:"deny"}` — which
  // we emit as plan_reject, not deny (t9 re-review): the wire behavior is identical (both reach the gate's
  // plan-family deny copy), but a bare deny would land this ExitPlanMode in the Recently-denied ledger
  // (permissionsModel no-ops on plan_reject) and read "denied" instead of "sent back" in the cross-client
  // notice — the plan family stays plan_reject throughout.
  if (emptyPlan) {
    return (
      <DialogFrame title={EMPTY_PLAN_TITLE} color="planMode" subagentType={req.subagentType}>
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text>{EMPTY_PLAN_BODY}</Text>
          <Box marginTop={1}>
            <Select options={[...EMPTY_PLAN_OPTIONS]} context="SelectDecision"
              onChange={(value) => { if (value === "yes") approve("default"); else onDecision({ kind: "plan_reject" }); }}
              onCancel={() => onDecision({ kind: "plan_reject" })} />
          </Box>
        </Box>
      </DialogFrame>
    );
  }

  return (
    <Box flexDirection="column">
      <DialogFrame title={PLAN_TITLE} color="planMode" innerPaddingX={0} subagentType={req.subagentType}>
        <Box flexDirection="column" marginTop={1}>
          <Box paddingX={1} flexDirection="column"><Text>{PLAN_BODY_TITLE}</Text></Box>
          {/* `EDr` (L501096) wraps the plan in `SM` (L424994-425003): dashed rules top and bottom, left and
              right edges off, in the `subtle` role, `paddingX:1` and `marginBottom:1`. The two rules are what
              separate the plan from the title above it and the consent line below without a second frame.
              ONE FIELD IS NOT TRANSCRIBED: `SM` drops the style entirely under a screen reader (`const hGp =
              Ea() ? void 0 : "dashed"`, L424996, `Ea()` being Ink's `isScreenReaderEnabled` context,
              L182559 over the provider at L181297), so upstream paints NO border there. We paint
              unconditionally — stock Ink 5 has no such context and this repo has no screen-reader surface to
              read it off, the same class of gap DialogFrame.tsx records for `srPrefix`. */}
          <Box flexDirection="column" borderStyle={DASHED_BORDER} borderColor={role("subtle")}
            borderLeft={false} borderRight={false} overflow="hidden" paddingX={1} marginBottom={1}>
            {lines.slice(top, top + window).map((l, i) => <Line key={top + i} l={l} />)}
            {/* One marker row, kept whether or not there is anything BELOW, so scrolling never reflows the
                region's height under the reader's eyes. */}
            {lines.length > window
              ? <Text dimColor>… {below > 0 ? `+${below} more lines` : `${top} lines above`} ({SCROLL_HINT})</Text>
              : null}
          </Box>
          {reason ? <Box flexDirection="column" paddingX={1}><Text>{reason}</Text></Box> : null}
        </Box>
      </DialogFrame>
      {/* `Nnl` L501133: the option box, bordered on its TOP EDGE ONLY in the same `planMode` role. */}
      <Box flexDirection="column" borderStyle="round" borderColor={role("planMode")}
        borderLeft={false} borderRight={false} borderBottom={false} paddingX={1} flexShrink={0}>
        <Text dimColor>{PLAN_PROMPT}</Text>
        <Box marginTop={1}>
          <Select options={options} onChange={pick} onCancel={cancel} context="SelectDecision"
            onInputChange={(_v, text) => { feedbackRef.current = text; }} />
        </Box>
        {name !== null
          ? (
            <Box marginTop={1}>
              <Text>
                {/* `Onl` L501126: `[<chord>, fWt && ` · ${wd(fWt)}`]` inside ONE dimmed span. Our chord wording
                    stays `ctrl+g to edit in {name}` (upstream's is `edit in {name}`); re-spelling hints is a
                    later wave's, and only the path is this task's. */}
                <Text dimColor>ctrl+g to edit in {name}{planPath ? ` · ${planPath}` : ""}</Text>
                {saved ? <><Text dimColor>{" · "}</Text><Text color={role("success")}>{TICK} {PLAN_SAVED}</Text></> : null}
              </Text>
            </Box>
          )
          : null}
      </Box>
    </Box>
  );
}
