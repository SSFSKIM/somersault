// tui/src/spinner.ts — pure spinner vocabulary + formatters + the whole parenthetical anatomy for the
// live-turn indicator. CC fidelity: the asterisk-pulse frames (components/Spinner/utils.ts
// getDefaultCharacters, darwin variant) animated out-and-back, and the 186 random thinking verbs verbatim
// from `$ta` (bundle L406847). No React/Ink — the view layer is TurnSpinner.tsx.
//
// WAVE C TASK 6 rewrote the tail. It used to read `(3s · 142 tokens · esc to interrupt)`; canon's `C0p`
// (bundle L407892, assembled L407982) reads `({elapsed} · {↓|↑} {N} tokens · {phase})` and carries no
// interrupt offer at all — that affordance is a footer hint-list member upstream (`footerModel`'s
// `interrupt` rung), and Footer.tsx stopped filtering it out in the same change. Four things moved with it:
//   1. the token figure is an EASED ESTIMATE of `streamedChars / 4` (D-C6), not the per-message usage
//      counter — upstream's own mechanism, reconciled to the real usage figure by `LiveTurn.meter()`;
//   2. every segment is behind a WIDTH GATE, and behind a 16 s quiet threshold when nothing else is
//      happening, so a short quiet turn shows a bare `✻ Baking…` and nothing else;
//   3. the phase ladder (`thinking` → … → `almost done thinking`, `running tool for {t}`) joins as the
//      last segment; and
//   4. the elapsed segment is `format.ts`'s `formatDuration`, hour and day rollover included.
//
// ON THE ELAPSED FORMATTER, because this file's header is where the error started. The pre-Wave-C comment
// here asserted that upstream spells the spinner's clock `1m05s`; it does not, and every later reader
// (Task 6's own port, the Wave C grounding note, the spec's EP-C4 text) inherited the claim without going
// back to the bundle. What the bundle says: `C0p` computes `he = ra(R)` (L407947), and `ra` is the export
// map's `formatDuration` (L107029 → L107033) — SPACED and UNPADDED, `1m 5s` for 65 s and `1h 2m 3s` for
// 3723 s. `ra` is also what the two tool rungs below call, so the whole tail speaks one dialect. The
// `1m05s` spelling IS real — it is `$st`/`formatBarElapsed` (L107079) — but its call sites are the agent
// progress row (L430339), the workflow stats line (L430517) and the teammate/model rows (L480289), none of
// which is this. EP-C4's end-of-turn duration row is `ra` too. Nothing in ccx needs `$st`, so no port of it
// lives here; if a surface ever does, port it then and name its call site.
import stringWidth from "string-width";
import { formatCompactNumber, formatDuration } from "./format.js";

/** The darwin asterisk-pulse base chars; the live cycle pulses out then back (CC: [...chars, ...reversed]). */
export const SPINNER_BASE = ["·", "✢", "✳", "✶", "✻", "✽"] as const;
export const SPINNER_FRAMES: readonly string[] = [...SPINNER_BASE, ...[...SPINNER_BASE].reverse()];

/** Frame for an animation tick (wraps; negative-safe). */
export function glyphFrame(tick: number): string {
  const n = SPINNER_FRAMES.length;
  return SPINNER_FRAMES[(((tick % n) + n) % n)];
}

/** The 186 CC thinking verbs, verbatim from `$ta` (L406847) — count included. */
export const SPINNER_VERBS: readonly string[] = [
  "Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking", "Beaming",
  "Beboppin'", "Befuddling", "Billowing", "Blanching", "Bloviating", "Boogieing",
  "Boondoggling", "Booping", "Bootstrapping", "Brewing", "Bunning", "Burrowing",
  "Calculating", "Canoodling", "Caramelizing", "Cascading", "Catapulting", "Cerebrating",
  "Channeling", "Channelling", "Choreographing", "Churning", "Clauding", "Coalescing",
  "Cogitating", "Combobulating", "Composing", "Computing", "Concocting", "Considering",
  "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing",
  "Cultivating", "Deciphering", "Deliberating", "Determining", "Dilly-dallying", "Discombobulating",
  "Doing", "Doodling", "Drizzling", "Ebbing", "Effecting", "Elucidating",
  "Embellishing", "Enchanting", "Envisioning", "Fermenting", "Fiddle-faddling",
  "Finagling", "Flambéing", "Flibbertigibbeting", "Flowing", "Flummoxing", "Fluttering",
  "Forging", "Forming", "Frolicking", "Frosting", "Gallivanting", "Galloping",
  "Garnishing", "Generating", "Gesticulating", "Germinating", "Gitifying", "Grooving",
  "Gusting", "Harmonizing", "Hashing", "Hatching", "Herding", "Honking",
  "Hullaballooing", "Hyperspacing", "Ideating", "Imagining", "Improvising", "Incubating",
  "Inferring", "Infusing", "Ionizing", "Jitterbugging", "Julienning", "Kneading",
  "Leavening", "Levitating", "Lollygagging", "Manifesting", "Marinating", "Meandering",
  "Metamorphosing", "Misting", "Moonwalking", "Moseying", "Mulling", "Mustering",
  "Musing", "Nebulizing", "Nesting", "Newspapering", "Noodling", "Nucleating",
  "Orbiting", "Orchestrating", "Osmosing", "Perambulating", "Percolating", "Perusing",
  "Philosophising", "Photosynthesizing", "Pollinating", "Pondering", "Pontificating", "Pouncing",
  "Precipitating", "Prestidigitating", "Processing", "Proofing", "Propagating", "Puttering",
  "Puzzling", "Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating",
  "Roosting", "Ruminating", "Sautéing", "Scampering", "Schlepping", "Scurrying",
  "Seasoning", "Shenaniganing", "Shimmying", "Simmering", "Skedaddling", "Sketching",
  "Slithering", "Smooshing", "Sock-hopping", "Spelunking", "Spinning", "Sprouting",
  "Stewing", "Sublimating", "Swirling", "Swooping", "Symbioting", "Synthesizing",
  "Tempering", "Thinking", "Thundering", "Tinkering", "Tomfoolering", "Topsy-turvying",
  "Transfiguring", "Transmuting", "Twisting", "Undulating", "Unfurling", "Unravelling",
  "Vibing", "Waddling", "Wandering", "Warping", "Whatchamacalliting", "Whirlpooling",
  "Whirring", "Whisking", "Wibbling", "Working", "Wrangling", "Zesting",
  "Zigzagging",
];

/** Pick a verb from a [0,1) random value (default Math.random; injectable for tests). */
export function pickVerb(rand: number = Math.random()): string {
  const i = Math.min(SPINNER_VERBS.length - 1, Math.max(0, Math.floor(rand * SPINNER_VERBS.length)));
  return SPINNER_VERBS[i];
}

// ── The token estimate (spec decision D-C6) ──────────────────────────────────────────────────────────
// The figure in the tail is NOT the usage counter. Upstream animates a character count toward the real
// streamed length and divides by four (`te`/`de`, L407919–407947): the number climbs smoothly through a
// burst instead of stepping once per `message_delta`, which is the only moment real usage arrives (probe
// (c)). `LiveTurn.meter().chars` is the target; this is the easing, lifted step for step.

/** Upstream's animation step: the count advances once per 50 ms of animation time. */
export const EASE_STEP_MS = 50;

/** Advance the animated character count `steps` frames toward `target`. Three rates, upstream's: a gap
 *  under 70 chars crawls at +3 (so the last few characters are visibly typed), a gap under 200 closes at
 *  15% (min 8), and anything larger sprints at +50. Monotone — a target that shrinks (a new message with
 *  fewer characters than the last) leaves the count where it is rather than counting backwards. */
export function easeChars(animated: number, target: number, steps: number): number {
  let n = animated;
  for (let i = 0; i < steps; i++) {
    const gap = target - n;
    if (gap <= 0) break;
    n = Math.min(n + (gap < 70 ? 3 : gap < 200 ? Math.max(8, Math.ceil(gap * 0.15)) : 50), target);
  }
  return n;
}

/** `Math.round(te / 4)` (L407947) — four characters to the token, which is the estimate upstream shows. */
export const estimateTokens = (animatedChars: number): number => Math.round(animatedChars / 4);

// ── Mode, phase, and the thinking ladder ─────────────────────────────────────────────────────────────

/** Upstream's stream mode (`onSetStreamMode`, L374662–374703). `stream_mode` frames are stripped from the
 *  SDK stream (L557805 `continue`), so ccx derives it from the same wire events upstream's handler reads. */
export type SpinnerMode = "requesting" | "responding" | "thinking" | "tool-input" | "tool-use";

/** `I0p` (L408033): a width-2 box holding `↓` while output is arriving and `↑` while a request is in
 *  flight; nothing at all for any other mode. */
export function modeArrow(mode?: SpinnerMode): string {
  switch (mode) {
    case "tool-input": case "tool-use": case "responding": case "thinking": return "↓";
    case "requesting": return "↑";
    default: return "";
  }
}

/** `GtH` (L407874) with its four thresholds verbatim. */
export function thinkingWord(ms: number): string {
  if (ms >= 45000) return "almost done thinking";
  if (ms >= 30000) return "thinking some more";
  if (ms >= 20000) return "thinking more";
  if (ms >= 10000) return "still thinking";
  return "thinking";
}

export type SpinnerPhase =
  | { kind: "tool-running"; toolMs: number }
  | { kind: "tool-done"; toolMs: number }
  | { kind: "thinking"; thinkingMs: number }
  | { kind: "thought-for"; thoughtMs: number }
  | { kind: "none" };

/** `x` in `q0p` (L408127–408146): `"thinking"` while the burst runs, then the burst's duration for a short
 *  window, then nothing. */
export type ThinkingStatus = "thinking" | number | null;

/** Upstream's `N` table (L407959) verbatim. The effort suffix rides the thinking rung only. */
export function phaseLabel(phase: SpinnerPhase, effortSuffix = ""): string | null {
  switch (phase.kind) {
    case "tool-running": return `running tool for ${formatDuration(phase.toolMs)}`;
    case "tool-done": return `ran tool for ${formatDuration(phase.toolMs)}`;
    case "thinking": return `${thinkingWord(phase.thinkingMs)}${effortSuffix}`;
    case "thought-for": return `thought for ${Math.max(1, Math.round(phase.thoughtMs / 1000))}s`;
    case "none": return null;
  }
}

export interface PhaseState { toolWindowStart: number | null; toolWindowEnd: number | null; thinkingBurstStart: number | null; wasThinking: boolean }
export interface PhaseInput {
  now: number; isThinking: boolean; hasActiveTools: boolean; thinkingStatus: ThinkingStatus;
  /** Upstream gates the two tool rungs on `tengu_shining_fractals` (L407892's `showToolCallTimer`), a
   *  feature flag whose call-site default is FALSE — so a stock 2.1.220 never prints `running tool for 4s`.
   *  RECORDED DIVERGENCE (constraint 12): ccx passes `true` from TurnSpinner, because the Wave C spec's
   *  EP-C4 decision lists both tool rungs as shipped copy. The flag stays an input so the machine itself
   *  is a faithful port and the divergence is one boolean at one call site. */
  showToolTimer: boolean;
}

export const initPhaseState = (): PhaseState => ({ toolWindowStart: null, toolWindowEnd: null, thinkingBurstStart: null, wasThinking: false });

/** `m0p` (L407796) — the window bookkeeping, called once per frame BEFORE `phaseFor`. */
export function advancePhase(state: PhaseState, input: PhaseInput): PhaseState {
  let { toolWindowStart: start, toolWindowEnd: end, thinkingBurstStart: burst } = state;
  if (input.hasActiveTools) { if (start === null || end !== null) start = input.now; end = null; }
  else if (start !== null && end === null) end = input.now;
  if (!input.hasActiveTools && input.thinkingStatus !== null) { start = null; end = null; }
  if (input.isThinking) { if (!state.wasThinking) burst = input.now; } else burst = null;
  return { toolWindowStart: start, toolWindowEnd: end, thinkingBurstStart: burst, wasThinking: input.isThinking };
}

/** `h0p` (L407813) — the state plus this frame's inputs, read out as the rung to print. Both tool rungs
 *  need a two-second window before they say anything, so a fast tool never flickers a timer. */
export function phaseFor(state: PhaseState, input: PhaseInput): SpinnerPhase {
  if (input.showToolTimer && input.hasActiveTools && state.toolWindowStart !== null) {
    const ms = input.now - state.toolWindowStart;
    if (ms >= 2000) return { kind: "tool-running", toolMs: ms };
  }
  if (input.showToolTimer && !input.hasActiveTools && input.thinkingStatus === null && state.toolWindowStart !== null && state.toolWindowEnd !== null) {
    const ms = state.toolWindowEnd - state.toolWindowStart;
    if (ms >= 2000) return { kind: "tool-done", toolMs: ms };
  }
  if (input.thinkingStatus === "thinking" && !input.hasActiveTools)
    return { kind: "thinking", thinkingMs: state.thinkingBurstStart !== null ? input.now - state.thinkingBurstStart : 0 };
  if (typeof input.thinkingStatus === "number") return { kind: "thought-for", thoughtMs: input.thinkingStatus };
  return { kind: "none" };
}

/** The last thinking burst on the wire, as `LiveTurn` measures it. */
export interface ThinkingBurst { startedAt: number; endedAt?: number; ms?: number }

/** Upstream keeps `x` on two `setTimeout`s (L408129–408141): leaving the thinking mode schedules the
 *  `thought for Ns` readout for `max(0, 2000 - burstLength)` ms later — so a burst shorter than two
 *  seconds still reads `thinking` for the full two — and clears it two seconds after that. Ported as a
 *  PURE function of the burst and the clock instead: the spinner already repaints every frame, so the same
 *  window falls out of arithmetic with no timers to leak (constraint 15). */
export function thinkingStatusOf(burst: ThinkingBurst | undefined, isThinking: boolean, now: number): ThinkingStatus {
  if (isThinking) return "thinking";
  if (burst?.endedAt === undefined) return null;
  const appearsAt = Math.max(burst.endedAt, burst.startedAt + 2000);
  return now >= appearsAt && now < appearsAt + 2000 ? (burst.ms ?? 0) : null;
}

/** The mid-turn gerund rotation QA-6 saw. Upstream re-picks the store's `defaultVerb` on every
 *  `resetOverrides()` (L407338), which its engine calls BETWEEN PHASES; ccx has no such store, so the
 *  phase transition itself is the seam. Pure so the pick is injectable. */
export function rotateVerb(current: string, previousKind: SpinnerPhase["kind"], kind: SpinnerPhase["kind"], pick: () => string): string {
  return kind === previousKind ? current : pick();
}

// ── The parenthetical ────────────────────────────────────────────────────────────────────────────────

/** `xtH` (L408075): below this, a turn with no phase and no tokens says nothing at all. */
export const QUIET_MS = 16000;
const NO_PHASE: SpinnerPhase = { kind: "none" };
const JOINER = " · ";
const JOINER_W = stringWidth(JOINER);          // `ItH`
const THINKING_W = stringWidth("thinking");    // `v0p`
const dw = (s: string) => stringWidth(s);      // `Ut`

export interface SpinnerTail {
  /** Wall-clock ms since the turn started (upstream nets out paused time; ccx never pauses). */
  elapsedMs: number;
  /** The EASED estimate, already `round(chars / 4)` — see `estimateTokens`. */
  tokens?: number;
  mode?: SpinnerMode;
  phase?: SpinnerPhase;
  /** Terminal width. */
  columns?: number;
  /** Display width of the gerund row to the left of the parenthetical (`Ut(message)`). */
  messageWidth?: number;
  verbose?: boolean;
  /** `spinnerSuffix` — an unconditional leading segment; nothing in ccx sets one yet. */
  suffix?: string;
  effortSuffix?: string;
}

/** `C0p`'s `_r`/`Wr` (L407971–407982), as a string. Segments appear left to right — suffix, elapsed,
 *  arrowed token count, phase — and each is gated on the room left after the ones before it, which is why
 *  QA-6 watched the tail materialise a piece at a time as a turn warmed up.
 *
 *  Returns `""` when every gate is shut; the caller renders no tail at all rather than empty parens.
 *
 *  RECORDED DIVERGENCE (constraint 12): upstream paints the thinking rung in a pulsing shimmer colour
 *  (`fr`/`Rt`, L407969) while everything else is dim. ccx renders the whole tail dim — the shimmer is a
 *  per-frame RGB interpolation this port has no equivalent of, and a static colour would read as a state
 *  change that never resolves. Upstream's `lr` case (phase-only, thinking, nothing else visible) also
 *  moves the parens INSIDE the coloured span; since both spellings produce the same characters, it shows
 *  up here only as the `(thinking)` output it is named for. */
export function spinnerStatus(tail: SpinnerTail): string {
  const { elapsedMs, tokens = 0, mode, phase = NO_PHASE, columns = 80, messageWidth = 0, verbose = false, suffix = "", effortSuffix = "" } = tail;
  let label = phaseLabel(phase, effortSuffix);
  const hasPhase = label !== null;
  const elapsed = formatDuration(elapsedMs);   // `he = ra(R)` (L407947) — no options, so no trailing-zero elision
  const arrow = modeArrow(mode);
  const count = formatCompactNumber(tokens);
  // `gt`: the quiet gate. Something must be worth saying — a phase, a token count, verbose mode, or a turn
  // that has already run long enough that silence would read as a hang.
  const loud = verbose || hasPhase || tokens > 0 || elapsedMs > QUIET_MS;
  const room = columns - (messageWidth + 2) - 5;                                     // `Lt`
  let phaseW = label === null ? 0 : dw(label);
  let showPhase = hasPhase && room > phaseW;                                         // `At`
  // L407974: a thinking rung that does not fit degrades to the bare word before it is dropped, so a narrow
  // terminal still says the turn is thinking rather than going silent mid-ladder.
  if (!showPhase && hasPhase && phase.kind === "thinking" && (effortSuffix !== "" || thinkingWord(phase.thinkingMs) !== "thinking") && room > THINKING_W) {
    label = "thinking"; phaseW = THINKING_W; showPhase = true;
  }
  const phaseCost = showPhase ? phaseW + JOINER_W : 0;                               // `Ft`
  const showElapsed = loud && room > phaseCost + dw(elapsed);                        // `Dt`
  const spent = phaseCost + (showElapsed ? dw(elapsed) + JOINER_W : 0);              // `mt`
  const showTokens = loud && tokens > 0 && room > spent + dw(`↓ ${count} tokens`);   // `gr` (measured with ↓, as upstream does)
  const parts = [
    ...(suffix ? [suffix] : []),
    ...(showElapsed ? [elapsed] : []),
    ...(showTokens ? [`${arrow ? `${arrow} ` : ""}${count} tokens`] : []),
    ...(showPhase && label !== null ? [label] : []),
  ];
  return parts.length === 0 ? "" : `(${parts.join(JOINER)})`;
}
