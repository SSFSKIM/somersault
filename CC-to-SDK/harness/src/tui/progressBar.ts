// tui/src/progressBar.ts — T-CH34: the OSC 9;4 terminal progress bar, canon 2.1.236.
//
// TWO INDEPENDENT GATES (research report §2), and this file owns exactly one of them. `progressBarCapability`
// is canon's `Wnr()` (L199046) — a TERM_PROGRAM+version sniff of the EMULATOR, resolved once at boot because
// TERM_PROGRAM does not change mid-session (same resolved-once treatment `terminalTitle.ts`'s `reducedMotion`
// dep gets). The OTHER gate, the user-facing `terminalProgressBarEnabled` setting, is NOT read here — it is
// `useChat`'s state (the `reduceMotion` precedent), threaded into `update()`'s `enabled` field on every call
// so a `/config` toggle takes effect on the very next turn-lifecycle change, exactly as `desktopNotify`'s
// `settings()` is read at call time and never captured.
//
// DELIBERATE OMISSION FROM `Wnr()`: canon's `vE()?.progressReporting` rung (a remote-attach client's own
// capability answer overriding the local sniff) has no ccx equivalent — there is no attacher-caps surface —
// so it is dropped rather than approximated (research report §2, "drop this rung"). Also omitted: the
// `!process.stdout.isTTY` rung. Every other writer in this file's neighborhood (`terminalTitle.ts`,
// `desktopNotify.ts`) gates the TTY check at the WRITE wrapper (`chatMain.tsx`'s `if (process.stdout.isTTY)
// process.stdout.write(...)`), not inside the pure gate function — so this one matches that split rather than
// duplicating the check.
import { notifyTerminator, passthrough, progressOsc, PROGRESS_STATE } from "./terminalEscapes.js";

/** Loosely parses the first MAJOR[.MINOR[.PATCH]] out of `raw` (canon's `L0p.coerce`) and compares
 *  component-wise against `min` (canon's `Fz`, semver gte). A string with no digit at all — `!t` in
 *  canon — fails the gate, matching `Wnr()`'s `if (!t) return !1`. */
function versionAtLeast(raw: string | undefined, min: readonly [number, number, number]): boolean {
  const m = raw?.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return false;
  const v: [number, number, number] = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
}

/** canon's `Wnr()` (L199046-199062), minus the two rungs noted above (remote-attach caps, TTY). Windows
 *  Terminal is checked FIRST and wins outright even though it supports OSC 9;4 — canon suppresses it on
 *  purpose (`V.WT_SESSION → !1`), and that check has to run before ConEmu's OR-chain or a machine carrying
 *  both markers (unlikely, but the ORDER is what canon's own `if`-chain encodes) would answer wrong. */
export function progressBarCapability(env: NodeJS.ProcessEnv): boolean {
  if (env.WT_SESSION) return false;
  if (env.ConEmuANSI || env.ConEmuPID || env.ConEmuTask) return true;
  if (env.TERM_PROGRAM === "ghostty") return versionAtLeast(env.TERM_PROGRAM_VERSION, [1, 2, 0]);
  if (env.TERM_PROGRAM === "iTerm.app") return versionAtLeast(env.TERM_PROGRAM_VERSION, [3, 6, 6]);
  return false;
}

export interface ProgressBarDeps {
  /** The renderer's write path (canon's `$be`/`TerminalWriteProvider`) — bypasses Ink like `terminalTitle`'s
   *  `write`, because an OSC write is not frame content. */
  write(s: string): void;
  /** `progressBarCapability(process.env)`, resolved ONCE by the caller — mirrors `termProgram` on
   *  `AltScreenDeps` and `reducedMotion` on `TerminalTitleDeps`: the emulator does not change mid-session. */
  capability: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface ProgressBar {
  /** canon's driver effect (`m6h`, L558744) plus its change-dedupe (`Lt.current === Ht`, L563441-563445):
   *  recompute the state from the current setting + turn-busy signal, and emit only when it CHANGES from the
   *  last one this object wrote — no per-frame spam while a turn just sits in "active". `active` stands in
   *  for canon's `isLoading || hasToolsInProgress`; ccx tracks no in-flight-tool set of its own (research
   *  report §4c: "state.busy alone is the honest signal", recorded omission rather than an invented source). */
  update(input: { enabled: boolean; active: boolean }): void;
  /** canon's unmount effect (`() => ut(null)`, L563446) — an UNCONDITIONAL CLEAR that bypasses the dedupe
   *  above on purpose: canon calls this on every unmount regardless of what the ref already held. */
  clear(): void;
}

export function createProgressBar(deps: ProgressBarDeps): ProgressBar {
  const env = deps.env ?? process.env;
  let last: number | undefined;
  const write = (state: number): void => {
    if (!deps.capability) return;
    deps.write(passthrough(progressOsc(notifyTerminator(env), state), env));
  };
  return {
    update({ enabled, active }): void {
      // canon's `m6h`: `!enabled -> null` (CLEAR), `t||r -> "indeterminate"`, else "completed" (CLEAR). ccx
      // has one boolean signal (`active`) where canon has two (`isLoading || hasToolsInProgress`) — see the
      // recorded omission above.
      const state = enabled && active ? PROGRESS_STATE.INDETERMINATE : PROGRESS_STATE.CLEAR;
      if (state === last) return;                        // the dedupe: canon's `Lt.current === Ht) return`
      last = state;
      write(state);
    },
    clear(): void {
      last = PROGRESS_STATE.CLEAR;
      write(PROGRESS_STATE.CLEAR);
    },
  };
}
