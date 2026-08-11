// tui/src/footerModel.ts — Wave C Task 2 (EP-C1b): everything the footer row DECIDES, with no React in it.
// `Footer.tsx` is then a transcription of the shapes this file returns; the crowd-out rule and the agents
// flash are unit-testable without an Ink render, which is the only way the 2500 ms window can be pinned
// without a real clock (plan constraint 15).
//
// Canon: annex §C1.3 (`ctl`, L493890 — the hint list and its push order), §C1.4 (`E6e`, L493228 — the three
// `← for agents` shapes and `Lci = 2500`), §C1.5 (`oVf`/`Wci`, L494599/L493714 — the collapse rule).

import { isHomeMode } from "./modeTable.js";

/** One styled run inside a hint. A hint is a LIST of these rather than a string because two of upstream's
 *  carry a coloured count inside an otherwise dim sentence (`← 3 agents`, `← 2 done`) — the colour is on the
 *  number alone, and one string could not express that. `dim` is `$Rr`'s own default for uncoloured text. */
export interface HintSpan { text: string; color?: "warning" | "success"; dim?: boolean }
/** One member of `G2`. `key` is upstream's own React key, kept because it is the stable name a test can
 *  assert on when the visible text is theme- or count-dependent. */
export interface HintSegment { key: string; spans: HintSpan[] }

/** The plain text of a hint — what `wrap="truncate"` measures and what a test reads out of a frame. */
export function hintText(hint: HintSegment): string { return hint.spans.map((s) => s.text).join(""); }

/** `Qt`/`nfy` (L183913): the separator is exactly space-U+00B7-space and is always `dimColor`. */
export const HINT_JOINER = " · ";

/** `zqf = Dtl || Mtl` where `Dtl = q1b || Ltl` (annex §C1.5, L494599). Three inputs, one OR — and the third
 *  is the mechanism behind qa6-03: merely CONFIGURING a statusLine hides `? for shortcuts`, because upstream
 *  folds it into the same flag rather than special-casing it.
 *
 *  RECORDED DIVERGENCE: upstream's `q1b` is `te.length > 0` — the RAW buffer length. ccx's draft signal
 *  arrives through the composer's `onInputActivity`, which is upstream's other predicate,
 *  `value.trim().length > 0` (L547796). The pair disagrees on exactly one draft — one made only of spaces —
 *  and reusing the existing seam is worth more than a second signal that differs from it by a `trim()`. */
export function suppressHint({ draftNonEmpty, searching, statusLineConfigured }: { draftNonEmpty: boolean; searching: boolean; statusLineConfigured: boolean }): boolean {
  return draftNonEmpty || searching || statusLineConfigured;
}

/** `Lci` (L493295) — how long the awaiting/done flash lives. */
export const AGENTS_FLASH_MS = 2500;

/** `Et(n, "agent")` — upstream's pluraliser, in the one shape this file needs it. */
export function pluralize(n: number, word: string): string { return `${n === 1 ? word : `${word}s`}`; }
/** `n > 99 ? "99+" : n` (L493252, L493215). */
const countText = (n: number): string => (n > 99 ? "99+" : String(n));

export interface AgentsState {
  /** How many background agents exist at all. Zero means the affordance does not render (see below). */
  count: number;
  /** A flash: `{count}` agents went into "needs input" at `since`. */
  awaiting?: { count: number; since: number };
  /** A flash: `{count}` agents finished at `since`. */
  done?: { count: number; since: number };
}

/** `E6e` (L493228) — the three shapes, chosen by which flash is still inside its 2500 ms window. A PURE
 *  function of an injected `now`: it owns no timer, so a caller that wants the flash to expire on its own
 *  has to repaint (upstream's component holds that timer; see the mount note in `Footer.tsx`).
 *
 *  `done` outranks `awaiting` when both are live: finishing is the newer news and upstream posts it second.
 *
 *  RECORDED DIVERGENCE (plan constraint 12), the one that decides the `null`: upstream renders the idle
 *  `← for agents` unconditionally, and ccx gates it on `count > 0`.
 *    THE REASON CHANGED IN WAVE C TASK 4 AND THE GATE DID NOT. It used to be an honesty gate — ccx bound `←`
 *  to nothing, so an unconditional string would have advertised a chord that did nothing. The gesture is live
 *  now (ChatComposer's `leftAgentsArmRef`: `←` `←` on an empty composer opens the background pane, annex
 *  §C7.8), so the string is backed at every count. What keeps the gate is what it says: this affordance
 *  replaced the old `⚙ N bg` chip and reads as a STATUS — `← for agents` with no agents is an offer to look at
 *  an empty room. Upstream can afford it because its `←` detaches to a persistent agents VIEW; ours opens a
 *  pane whose whole content is the list. Deliberate, and one term to remove if that ever stops being true. */
export function agentsAffordance(agents: AgentsState, now: number = 0): HintSegment | null {
  const live = (f: { since: number } | undefined): boolean => f !== undefined && now - f.since < AGENTS_FLASH_MS;
  const arrow: HintSpan = { text: "←", dim: true };                 // `L8` (L41482)
  if (live(agents.done)) {
    const n = agents.done!.count;
    return { key: "fg-agents", spans: [arrow, { text: " ", dim: true }, { text: countText(n), color: "success" }, { text: " done", dim: true }] };
  }
  if (live(agents.awaiting)) {
    const n = agents.awaiting!.count;
    return { key: "fg-agents", spans: [arrow, { text: " ", dim: true }, { text: countText(n), color: "warning" }, { text: ` ${pluralize(n, "agent")}`, dim: true }] };
  }
  if (agents.count > 0) return { key: "fg-agents", spans: [arrow, { text: " for agents", dim: true }] };
  return null;
}

export interface HintListState {
  /** `n8f = !suppressHint` — see `suppressHint` above. */
  showHint: boolean;
  /** `DMr`. Kills the agents affordance on its own, WITHOUT killing the rest (annex §C1.5). */
  isInputEmpty: boolean;
  mode: string;
  /** `isLoading`. Turns hint 2 into `{esc} to interrupt`. */
  busy: boolean;
  /** The chord for `chat:cancel`, already lower-cased by `formatBindingLower`. `""` when unbound, which
   *  drops the clause entirely — `$e`'s own three-state contract (`keys/hints.ts`). */
  interruptChord: string;
  agents: AgentsState;
  now: number;
}

/** `G2`, in upstream's own push order (L494053–L494159), over the subset ccx has a producer for.
 *
 *  WHAT IS NOT HERE, and why — each is an upstream push with no ccx counterpart, not an omission:
 *   1. `esc-return` (`return to team lead`) — ccx has no in-process teammate view.
 *   2b. `toggle-tasks` (`ctrl+t to show tasks`) — the footer is mounted by `ChatApp`, which does not hand it
 *       the todo panel's open state; the chord is already advertised by the `?` grid. A `todosOpen` prop
 *       would add it here unchanged.
 *   5–8. feedback drafts, voice, selection-copy, manage-tasks, view-memories — no such features.
 *
 *  THE CROWD-OUT RULE (item 3) IS READ LITERALLY, which is the point of the brief: `? for shortcuts` needs
 *  `G2.length === 0` — so ANY earlier hint kills it — and `!(ttl && HRn)`, so a non-default mode kills it
 *  too. The remaining conjuncts (`TZe`, `Yjt`, `Zjt`, `ERn`, `Vjt`, `zDe`) are a PR badge, footer links, a
 *  task chip, the detach affordance and the dense-mode flag; ccx renders none of them, so each is a
 *  false-constant and is not modelled. Note what the rule does NOT crowd out: `fg-agents` is pushed AFTER
 *  the shortcuts hint, so the two coexist — which is what makes §C4.c's canonical home footer
 *  `⏸ manual mode on · ? for shortcuts · ← for agents` reachable at all. */
export function buildHintList(s: HintListState): HintSegment[] {
  const out: HintSegment[] = [];
  // 2. `qOb`/`F8f` (L494174): `esc` becomes an interrupt offer while a turn is running.
  if (s.showHint && s.busy && s.interruptChord !== "") out.push({ key: "interrupt", spans: [{ text: `${s.interruptChord} to interrupt`, dim: true }] });
  // 3. `shortcuts-hint` (L494091), with the literal reading of its guard.
  if (s.showHint && out.length === 0 && isHomeMode(s.mode)) out.push({ key: "shortcuts-hint", spans: [{ text: "? for shortcuts", dim: true }] });
  // 4. `fg-agents` — gated on `isInputEmpty` ALONE (`ERn`/`T8f` each require `DMr`, L494069/L494077), not on
  //    `showHint`: a configured statusLine hides the hints and leaves this one standing, which is upstream's.
  if (s.isInputEmpty) { const a = agentsAffordance(s.agents, s.now); if (a) out.push(a); }
  return out;
}
