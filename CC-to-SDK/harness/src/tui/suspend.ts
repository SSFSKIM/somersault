// tui/src/suspend.ts — Ctrl-Z: hand the terminal back to the shell. Ink holds stdin in raw mode, which
// disables the terminal's own job control (no SIGTSTP is ever generated), so suspension must be explicit:
// leave raw mode, stop this process; when `fg` delivers SIGCONT, re-enter raw mode and repaint.
//
// WHY this shape — the reasoning is invisible from the code below, so it's recorded here:
//
// Upstream's own handleSuspend (~/claude-code-bundle/2.1.220/cli.pretty.js:177985) lives INSIDE their
// patched Ink, so it can drain Ink's internal raw-mode ref count directly:
// `while (rawModeEnabledCount > 0) handleSetRawMode(false)`. We are outside Ink and can't see that count.
// `useStdin().setRawMode` (node_modules/ink/build/components/App.js:104-131, `handleSetRawMode`) is a
// REFERENCE COUNT, not a switch: disabling only calls the real `stdin.setRawMode(false)` once the count
// reaches 0 (line 126: `if (--this.rawModeEnabledCount === 0)`). Whoever holds a count would therefore have
// to be drained to zero, and no caller can know how many that is: before F2 task 6 it was ChatApp's own
// `useInput` PLUS whatever occupied the composer slot (>=2, so one decrement was a silent no-op); since
// task 6 the root of the count is KeymapProvider's single subscription, but every dialog still running its
// own `useInput` (and, after tasks 7/8, whatever raw-mode holder replaces them) adds one more the moment it
// mounts. A ctrl+z arriving with a dialog up would hit exactly the old >=2 case again. So this module keeps
// bypassing Ink's count entirely and toggles the real tty object directly (the `stdin` field `useStdin()`
// also exposes, separate from its `setRawMode` function) — Ink's internal bookkeeping is left untouched and
// self-consistent: it still believes raw mode is on the whole time, and it genuinely is on again before Ink
// ever reads more input.
//
// Repaint has the same shape of problem: a `useState` counter that nothing in the render tree reads
// produces byte-identical output, and Ink only writes when output actually changed
// (node_modules/ink/build/ink.js:132, `if (!hasStaticOutput && output !== this.lastOutput)`). Ink's public
// `useStdout().write("")` forces a replay by doing `log.clear()`, an external empty write, then
// `log(lastOutput)`. Its first operation has a stale terminal-relative line count after the shell printed.
// chatMain's permanent ResumeSafeStdout owns that synchronous transaction and suppresses only that first
// terminal write; Ink still resets and rebuilds its private bookkeeping through the forwarded replay.
import { restoreTtyNonblock } from "./externalEditor.js";

export interface SuspendDeps {
  stdin: { setRawMode?: (v: boolean) => void };
  /** O_NONBLOCK repair for the resumed tty — see `restoreTtyNonblock`. Injectable; defaults to the real one. */
  restoreTty?: () => void;
  stdout?: { isTTY?: boolean; write: (data: string) => unknown };
  repaint: () => void;
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: string) => void;
  once?: (signal: string, handler: () => void) => void;
  removeListener?: (signal: string, handler: () => void) => void;
  /** FSW T14, AMENDMENT 3 — `AltScreenGuard.handoff`. Ctrl-Z is a terminal handoff like every other, except
   *  that its two halves are separated by a round trip through the shell's job control, so there is no
   *  `run()` for `aroundSubprocess` to wrap: this calls the leave and holds the returned re-enter until
   *  SIGCONT. Without it a fullscreen suspend left the smcup standing and the shell drew its prompt onto OUR
   *  alternate screen — a screen that then vanished, prompt and all, on `fg`.
   *    ABSENT ON A CLASSIC LAUNCH, and inert rather than absent on a main-screen one: the guard hands back a
   *  no-op unless it is armed, which only the fullscreen renderer does (altScreen.ts). */
  handoff?: () => () => void;
}

export function suspendProcess(deps: SuspendDeps): void {
  if ((deps.platform ?? process.platform) === "win32") return;
  const kill = deps.kill ?? ((pid, signal) => { process.kill(pid, signal as NodeJS.Signals); });
  const once = deps.once ?? ((signal, handler) => { process.once(signal as NodeJS.Signals, handler); });
  const removeListener = deps.removeListener ?? ((signal, handler) => { process.removeListener(signal as NodeJS.Signals, handler); });
  const cursor = (visible: boolean) => { if (deps.stdout?.isTTY) deps.stdout.write(visible ? "\x1b[?25h" : "\x1b[?25l"); };
  // DECSET 2004 (bracketed paste, owned by KeymapProvider since f5 t3) must come back on resume: bash's
  // readline and zsh's zle write ?2004l before executing `fg`, so without this a Ctrl-Z round trip leaves
  // pastes unmarked for the rest of the session (t3 re-review follow-up — upstream shares this hole, its
  // handleSuspend L177985 pairs cursor/focus/mouse but never lho/Usr). Disable on the way out too: a shell
  // that does not manage the mode itself must not see paste markers at its own prompt.
  const paste = (on: boolean) => { if (deps.stdout?.isTTY) deps.stdout.write(on ? "\x1b[?2004h" : "\x1b[?2004l"); };
  // Same class of damage as the external editor's (F5 real-TTY fix): while we were stopped the shell owned
  // the tty, and `fg` can hand the shared open file description back in BLOCKING mode. Our libuv tty watchers
  // re-arm the moment we resume, and a blocking `read()` on fd 0 parks the main thread forever. Repair first,
  // before raw mode and the repaint touch the terminal. Failure-silent by construction.
  const restoreTty = deps.restoreTty ?? restoreTtyNonblock;
  // The alt screen's half of the round trip. `back` is set the moment we leave and is the ONLY thing that puts
  // the screen back, so both exits from here — SIGCONT and the delivery-failure rollback — call it. Ordering on
  // the way back: raw mode first (the tty has to be ours again before we write to it), then smcup, and only
  // then the repaint — a frame painted before the screen is retaken lands on the user's shell.
  let back: (() => void) | undefined;
  const onResume = () => { restoreTty(); deps.stdin.setRawMode?.(true); back?.(); cursor(false); paste(true); deps.repaint(); };
  let listenerAttempted = false;
  try {
    deps.stdin.setRawMode?.(false);
    cursor(true);
    paste(false);
    // …and rmcup LAST of the leave, after the modes it does not own are already down — the guard's own leave
    // writes mouse-off, rmcup, an SGR reset and a cursor show, in canon's order (altScreen.ts `handoff`).
    back = deps.handoff?.();
    // once-before-kill is load-bearing: a fast `fg` (SIGCONT delivered right back) must not race a listener
    // that hasn't attached yet, so the listener goes up BEFORE the signal that could trigger it.
    listenerAttempted = true;
    once("SIGCONT", onResume);
    kill(0, "SIGTSTP");   // whole process group (matches upstream) — child processes suspend with us, like real job control
  } catch (error) {
    if (listenerAttempted) removeListener("SIGCONT", onResume);
    back?.();             // …and the screen we already gave up comes back: nothing was suspended after all
    deps.stdin.setRawMode?.(true);
    cursor(false);
    paste(true);
    throw error;
  }
}
