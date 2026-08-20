// tui/src/terminalTitle.ts — Wave C Task 8 (EP-C4a): the terminal tab/window title. Annex §C4.a, upstream's
// `Mv` (bundle L148174), `CVe` (L182826) and `vhl` (L547550), lifted out of React so the whole behaviour —
// the escape, the animation, the precedence and the kill switch — is one testable object the mount site
// merely drives.
//
// THE ESCAPE. Upstream never writes a literal `\x1b]0;` anywhere; `Mv` assembles it from `Oas = "\x1B]"`,
// the OSC code `Bb.SET_TITLE_AND_ICON = 0` (L148427), the joiner `Ilt = ";"` and the terminator `M5 = "\x07"`.
// So the bytes are `\x1b]0;<title>\x07` — OSC 0, which sets the icon name AND the window title, BEL-terminated.
// Never OSC 2, and NOT wrapped in the tmux/screen DCS passthrough (`R$`, L148178): inside tmux it propagates
// only if tmux itself forwards it. The write goes straight to stdout (`cse`'s value is Ink's `writeRaw`,
// L181297) — it must bypass the renderer, or Ink would treat it as frame content.
//
// THE PREFIX. `vhl` composes `` `${prefix} ${title}` `` — prefix, ONE U+0020, title — with `phi = "✳"`
// (U+2733 EIGHT SPOKED ASTERISK) at idle and `dhi = ["⠂", "⠐"]` (braille dots-2 / dots-5) alternating every
// `abm = 960` ms while a turn is in flight. `CVe`'s effect deps are `[composedString, writer]`, so it re-emits
// on every CHANGE of that string and on nothing else — which is why this object tracks the last thing it
// wrote and drops a repeat. At turn end only the PREFIX reverts: the title persists for the rest of the
// session (upstream never puts the fallback back), and is cleared to empty at exit (`a0u`, L148428).
//
// TWO RECORDED SKIPS (spec EP-C4, decided before implementation):
//  · `terminalTitleFromRename` (the setting at sdk.d.ts:6307 / bundle L42035, "whether /rename updates the
//    terminal tab title"). ccx has no settings surface for it and a rename here always wins over the engine's
//    ai-title, unconditionally — upstream's `mo` rung is gated on the setting, ours is not.
//  · The kitty ST-terminator variant (`Das = "\x1B\\"`, chosen by `o0u() === "kitty"`). BEL everywhere: every
//    terminal that honours OSC 0 at all honours the BEL form, and ccx does not sniff `TERM`.
//
// ONE MORE DELIBERATE DIVERGENCE (authorized by D-C9 — ccx keeps its own identity strings — and recorded
// here per W-S11, the record-divergences rule): the literal fallback is `ccx`, not upstream's `"Claude Code"`
// — this is a different program and the tab must say so. The rung above it is `--name` (upstream's `mk`, the
// `--agent` type) rather than an agent type, because that is the launch-time identity ccx actually has.
//
// THE SIGTERM FOLLOW-UP THIS FILE USED TO CARRY IS DONE, and was already done when it was written down.
// `cli/main.ts:424` registers one handler each for SIGHUP/SIGTERM/SIGINT and drains `createChatTeardown`,
// whose third step is `clearTitle()` (chatMain.tsx:866). Nothing about titles needs a signal handler, and
// adding one would double-register against an owner deliberately built to be singular.
//
// The animation timer is injected (plan constraint 15) and the frame index resets to 0 at the start of every
// busy stretch. Upstream's `IxL` comes from a process-wide animation counter, so its first busy frame is
// whatever the counter happened to be on; a per-turn reset is deterministic and observationally identical
// (the two frames differ only in which braille dot is lit).

import { osc, OSC_TITLE } from "./terminalEscapes.js";

/** `phi` (L549523) — U+2733, the idle prefix. */
export const TERMINAL_TITLE_IDLE_PREFIX = "✳";
/** `dhi` (L549523) — U+2802 / U+2810, alternated while a turn is in flight. */
export const TERMINAL_TITLE_BUSY_FRAMES = ["⠂", "⠐"] as const;
/** `abm` (L549863) — the frame flip interval, ms. */
export const TERMINAL_TITLE_FRAME_MS = 960;
/** `a0u` (L148428) — OSC 0 with an empty payload; clears the title on exit. */
export const TERMINAL_TITLE_CLEAR = osc("bel", OSC_TITLE, "");
/** ccx's literal, standing in for upstream's `"Claude Code"` (L547730). */
export const TERMINAL_TITLE_FALLBACK = "ccx";

/** Upstream's `Ht = mo ?? dl ?? mk ?? Ql ?? "Claude Code"` (L547730), with ccx's rungs. A blank rung counts
 *  as absent: an empty `/rename` must not blank the tab, it must fall through to the next thing we know. */
export function resolveTerminalTitle(parts: { renameTitle?: string; aiTitle?: string; name?: string }): string {
  for (const rung of [parts.renameTitle, parts.aiTitle, parts.name]) if (rung && rung.trim()) return rung.trim();
  return TERMINAL_TITLE_FALLBACK;
}

export interface TerminalTitleDeps {
  /** Direct stdout, bypassing Ink (upstream writes through the ink instance's `writeRaw`). */
  write(s: string): void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  env?: NodeJS.ProcessEnv;
  /** F8 T6 — the STARTUP value of `motion.ts`'s `reducedMotion()`. This object is long-lived, not a rendered
   *  component, so it is resolved once at construction; a mid-session toggle reaches it on the next relaunch
   *  (recorded asymmetry, task report), unlike the three rendered consumers that read the resolver live. */
  reducedMotion?: boolean;
}

export interface TerminalTitle {
  /** The resolved title text (see `resolveTerminalTitle`); `undefined` applies the literal fallback. */
  setTitle(title: string | undefined): void;
  /** A turn is in flight: swaps the prefix for the braille animation. Idempotent. */
  setBusy(busy: boolean): void;
  /** Exit: stop animating and blank the title. Safe to call twice. */
  clear(): void;
}

/** Upstream strips ANSI out of the title before emitting it (`Ci(e)` = Bun.stripANSI, inside `CVe`). Control
 *  bytes go too, and for a sharper reason than tidiness: a BEL or an ESC inside the payload would terminate
 *  or reopen the very sequence carrying it. */
const sanitize = (s: string): string => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f]/g, "").trim();

export function createTerminalTitle(deps: TerminalTitleDeps): TerminalTitle {
  const env = deps.env ?? process.env;
  // `G` (L547561): the kill switch makes the writer a no-op — no titles, no animation timer, and no exit
  // clear either (upstream guards `writeSync(1, a0u)` on the same variable, L181506).
  const disabled = !!env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE;
  const arm = deps.setInterval ?? ((fn: () => void, ms: number): unknown => { const h = setInterval(fn, ms); h.unref?.(); return h; });
  const disarm = deps.clearInterval ?? ((h: unknown): void => { clearInterval(h as ReturnType<typeof setInterval>); });

  let title = TERMINAL_TITLE_FALLBACK, busy = false, frame = 0;
  let handle: unknown, last: string | undefined;

  const emit = (): void => {
    const prefix = busy && deps.reducedMotion !== true ? TERMINAL_TITLE_BUSY_FRAMES[frame % TERMINAL_TITLE_BUSY_FRAMES.length] : TERMINAL_TITLE_IDLE_PREFIX;
    const composed = `${prefix} ${title}`;
    if (composed === last) return;                          // `CVe`'s effect deps: re-emit on CHANGE only
    last = composed;
    deps.write(osc("bel", OSC_TITLE, composed));
  };
  const stop = (): void => { if (handle !== undefined) { disarm(handle); handle = undefined; } };

  return {
    setTitle(next): void {
      if (disabled) return;
      const text = next === undefined ? "" : sanitize(next);
      title = text || TERMINAL_TITLE_FALLBACK;
      emit();
    },
    setBusy(next): void {
      if (disabled || next === busy) return;
      busy = next;
      // F8 T6: under reduced motion the busy prefix holds at the IDLE glyph and no timer is armed at all —
      // `emit()` already resolves to the idle prefix above, so there is nothing for a timer to advance.
      if (next && deps.reducedMotion !== true) { frame = 0; emit(); handle = arm(() => { frame++; emit(); }, TERMINAL_TITLE_FRAME_MS); }
      else { stop(); emit(); }                              // only the PREFIX reverts; `title` is untouched
    },
    clear(): void {
      if (disabled) return;
      stop(); busy = false;
      if (last === "") return;                              // already cleared — one write, not two
      last = "";
      deps.write(TERMINAL_TITLE_CLEAR);
    },
  };
}
