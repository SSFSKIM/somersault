// tui/src/terminalEscapes.ts — F8 Task 1: PURE builders for every escape ccx writes to the terminal
// outside Ink's frame. No writes, no lifecycle, no signals — and that emptiness is the design, not an
// omission. Writing stays with the modules that own their output path (terminalTitle keeps its `write`
// dep; desktopNotify takes its own), and SIGHUP/SIGTERM/SIGINT stay with `cli/main.ts:424`'s single
// handler, which drains `createChatTeardown` — whose third step is already `clearTitle()`. A second
// handler here would double-register against an owner built to be singular (see altScreen.ts's
// `signalsOwned` flag) and would drop SIGHUP.
//
// Canon (2.1.236): `tI` assembles OSC (L188457), `Fq` wraps for a multiplexer (L188461), `s$n`
// sanitizes notification text (L202519), codes come from `wC` (L188790).
//
// THE TERMINATOR IS A PARAMETER, NOT A SNIFF. Canon's `tI` picks ST when the terminal is kitty. Ours
// cannot decide that internally, because the one existing caller — the terminal title — keeps BEL on
// every terminal INCLUDING kitty (terminalTitle.ts's recorded Wave C skip). A builder that sniffed
// would force a caller either to change title bytes or to bypass the seam. So callers state their
// terminator and `notifyTerminator()` supplies canon's rule for the ones that want it.

const ESC = "\x1b", OSC_INTRO = "\x1b]", ST = "\x1b\\";
/** `FK` (L129061) — the BEL terminator, and also the whole `terminal_bell` notification. */
export const BELL = "\x07";

/** `wC` (L188790), the four codes this harness emits. TAB_STATUS (21337) is deferred — spec § 5. */
export const OSC_TITLE = 0, OSC_ITERM2 = 9, OSC_KITTY = 99, OSC_GHOSTTY = 777;

/** `Onr.PROGRESS` (L188791) — the iTerm2 `OSC 9` sub-code the progress bar rides, distinct from the plain
 *  notification (`Onr.NOTIFY = 0`) that also uses `OSC_ITERM2`. `Dnr` (L188791), verbatim: canon's four
 *  progress states. CH34 wires only CLEAR/INDETERMINATE (`progressBar.ts`'s driver) — SET/ERROR are built
 *  here for fidelity (canon has them) and reached by nothing, per the brief's explicit "wire nothing" call. */
export const ITERM2_PROGRESS = 4;
export const PROGRESS_STATE = { CLEAR: 0, SET: 1, ERROR: 2, INDETERMINATE: 3 } as const;

/** canon's `tI(wC.ITERM2, Onr.PROGRESS, state, value)` (L202541-202563) — the progress bar's OSC 9;4 form.
 *  CLEAR and INDETERMINATE pass an EMPTY value (`value` defaults to `""`), and `osc`'s `join(";")` still
 *  renders that as a trailing `;` before the terminator: `9;4;0;` / `9;4;3;`, never `9;4;0` / `9;4;3` —
 *  `Koi` (L188791) hardcodes the same trailing `;`. SET/ERROR carry a percent; canon clamps it to 0-100
 *  before this builder ever sees it (L202547), which is the caller's job (there is no live caller). */
export function progressOsc(terminator: OscTerminator, state: number, value: number | "" = ""): string {
  return osc(terminator, OSC_ITERM2, ITERM2_PROGRESS, state, value);
}

/** canon `Koi` (L188791) — the pre-built teardown CLEAR, written at BOTH of canon's teardown sites (`dsi()`
 *  L202468, the remote-attach detach cleanup L553531) and by nothing else. Two asymmetries from the hook
 *  path's `tI`-built emissions, both canon's own and both deliberate here: ALWAYS BEL, even on kitty (where
 *  `tI` would pick ST) — and ALWAYS UNWRAPPED, never `Fq`/`passthrough`-wrapped even inside tmux/screen. It
 *  is a debt to the terminal on the way out, not a feature: gated on CAPABILITY at every call site, never on
 *  `terminalProgressBarEnabled`. */
export const PROGRESS_TEARDOWN_CLEAR = osc("bel", OSC_ITERM2, ITERM2_PROGRESS, PROGRESS_STATE.CLEAR, "");

export type OscTerminator = "bel" | "st";

/** canon's `tI` (L188457): `ESC ] parts.join(";") <terminator>`. */
export function osc(terminator: OscTerminator, ...parts: (string | number)[]): string {
  return OSC_INTRO + parts.join(";") + (terminator === "st" ? ST : BELL);
}

/** Whether the process is running inside a terminal multiplexer `passthrough` needs to wrap for. The
 *  single predicate `passthrough` and desktopNotify's mux-fallback bell must agree on (F8 review Finding
 *  C): before this export they were two separately-maintained checks that could drift, and one pair
 *  already had — `TMUX=""` is `!== undefined` but not truthy, so the old bell check fired for a case
 *  `passthrough` never wraps. Truthy, not `!== undefined`, matching what `passthrough` below has always
 *  tested. */
export function isMuxed(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TMUX) || Boolean(env.STY);
}

/** canon's `Fq` (L188461): the DCS passthrough a multiplexer needs to forward an escape to the real
 *  emulator. Note what canon does NOT wrap: zellij is a recognised mux in `eUr` but has no arm in `Fq`,
 *  so it passes through bare — transcribed, not corrected. */
export function passthrough(seq: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isMuxed(env)) return seq;
  if (env.TMUX) return `${ESC}Ptmux;${seq.replaceAll(ESC, ESC + ESC)}${ST}`;
  // KNOWN CANON BUG, TRANSCRIBED NOT CORRECTED (F8 review Finding F — same call as the zellij note
  // above): GNU screen's string machine already passes a single ESC through verbatim, so doubling it
  // here corrupts the sequence inside screen. Canon doubles for both tmux and screen regardless.
  // `desktopNotify.test.ts` now pins this exact doubled-ESC byte in three more places — do not "fix" it
  // here without also correcting canon; that would just make ccx and canon disagree on the wire.
  return `${ESC}P${seq.replaceAll(ESC, ESC + ESC)}${ST}`;
}

/** canon's `cTp() === "kitty"` test, read straight off the environment — NOT off
 *  `altScreen.resolveTerminalName`, and deliberately not in its precedence. That function consults
 *  `TERM_PROGRAM` before its kitty markers, so the two disagree only when a non-kitty `TERM_PROGRAM` sits
 *  beside a kitty marker; there this one answers ST, which every terminal that honours OSC at all accepts.
 *  Reading the env here rather than importing is what keeps this module a leaf (no imports). */
export function notifyTerminator(env: NodeJS.ProcessEnv = process.env): OscTerminator {
  const kitty = env.TERM?.includes("kitty") === true || env.TERM_PROGRAM === "kitty" || env.KITTY_WINDOW_ID !== undefined;
  return kitty ? "st" : "bel";
}

/** canon's `s$n` (L202519): every C0 byte, DEL, and every C1 byte becomes a SPACE — length-preserving,
 *  because the point is to neutralise a byte that would terminate or reopen the sequence carrying it,
 *  not to tidy the text.
 *
 *  THIS IS NOT `terminalTitle.ts`'s SANITIZER AND MUST NEVER BE MERGED WITH IT. That one strips CSI
 *  sequences, DELETES C0/DEL, leaves C1 alone, and trims. Both are faithful to their own canon call
 *  site; one helper cannot be both. `test/tui/terminalEscapes.test.ts` and the title's own test pin the
 *  difference in opposite directions on purpose. */
export function sanitizeNotificationText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 32 || (c >= 127 && c <= 159) ? " " : s[i];
  }
  return out;
}
