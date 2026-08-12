// tui/altScreen.ts — THE ALT SCREEN'S LIFECYCLE, AND THE ONE GUARANTEE THAT OUTLIVES THE PROCESS.
//
// Everything else in this wave can fail and cost the user a bad frame. This module failing costs them their
// TERMINAL: a process that dies inside the alternate screen with mouse tracking armed leaves a shell that
// echoes `[<35;40;7M` at every twitch of the pointer, on a screen whose scrollback is gone, with no cursor.
// That is the only damage this codebase can do outside its own process, so the shape here is defensive by
// construction: every byte is written with a synchronous `writeSync` (a queued async write on stdout does
// not survive `process.exit`), the teardown is idempotent because a crash path can race the graceful one,
// and NOTHING IS EVER PAINTED AFTER RMCUP — the one ordering rule of spec §A6.
//
// CANON, byte for byte (2.1.220 `cli.pretty.js`; `uA(…)` prefixes `\x1b[`, `mY(n)`/`Kbe(n)` are `?n h`/`?n l`):
//   · enter        `pVe()`  L177097 = `uho + h1 + fI + Ybe()` — smcup+clear (1049) · erase-all · home · upgrade
//   · exit         `nj()`   L177100 = `mUe + S2u + nVe`       — pop kitty stack · rmcup · modifyOtherKeys reset
//   · upgrade      `Ybe()`  L177094 = `mUe + vNu + TNu` when `icy()`, gated on `ocy` (the seven, L177175)
//   · mouse off    `Gpe`    L177070 = 1006l 1003l 1002l 1000l, SGR first
//   · cursor show  `nV`     L177070 = DECTCEM set, written by the terminal-mode restore `Uho` (L180343)
//   · crash order  `zuy`    L181494-181509: mouse off UNCONDITIONALLY FIRST → try unmount → hand-written
//                            rmcup on throw → drain → `Uho()`, every one of them `writeSync`
//   · handoff      L180653-180662: canon's asymmetric leave/return around a subprocess
//   · pointer      L366419: canon's two-line resume hint, `claude --resume <id>`
//
// The guard is CONSTRUCTED on every launch and ARMED only by a call to `enter()`, which under this wave only
// the fullscreen renderer makes (T9). Unarmed, every method is inert — a classic launch must not emit so
// much as an rmcup for a screen it never took.

/** canon `pVe()` L177097, without the terminal-conditional tail — `enter()` appends `kittyUpgrade`. */
export const ENTER_ALT = "\x1b[?1049h\x1b[2J\x1b[H";
/** canon `nj()` L177100. Pop the kitty keyboard stack, rmcup, reset modifyOtherKeys. */
export const EXIT_ALT = "\x1b[<u\x1b[?1049l\x1b[>4m";
/** canon `Gpe` L177070. Unconditional and FIRST on every teardown: it is the byte sequence whose absence
 *  is still visible to the user ten minutes later, in a shell that is not ours. */
export const MOUSE_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";
/** canon `nV` L177070 (DECTCEM). The last thing out, as in `Uho` L180343. */
export const CURSOR_SHOW = "\x1b[?25h";

/** canon `ocy` L177175 — the terminals whose keyboard protocol we upgrade, verbatim and in canon's order. */
export const KITTY_TERMINALS: readonly string[] =
  ["iTerm.app", "kitty", "WezTerm", "ghostty", "tmux", "windows-terminal", "WarpTerminal"];

/** canon `Ybe()` L177094 gated on `icy()` L177092: push a kitty keyboard-protocol level and ask for
 *  modifyOtherKeys=2, but only where both are understood. Everywhere else the empty string — an unrecognised
 *  `\x1b[>1u` on a terminal that does not consume it is echoed at the user as literal text. */
export function kittyUpgrade(termProgram: string | undefined): string {
  return KITTY_TERMINALS.includes(termProgram ?? "") ? "\x1b[<u\x1b[>1u\x1b[>4;2m" : "";
}

/** canon L366419-366421, with our binary's name and without canon's dim: the pointer is the last thing the
 *  user sees and may well be scraped out of a redirected log. Printed AFTER rmcup, onto the MAIN screen —
 *  the single legitimate write on the far side of the ordering rule. */
export function resumePointer(sessionId: string): string {
  return `Resume this session with:\nccx --resume ${sessionId}\n`;
}

export interface AltScreenGuard {
  /** Take the alternate screen. Idempotent; ARMS the guard — everything below is inert until it is called. */
  enter(): void;
  /** Hand the main screen back: mouse off, unmount, rmcup, cursor. Idempotent, never throws. */
  exit(): void;
  /** Install the crash-safety handlers. Returns the disposer that removes exactly what it added. */
  installSignalSafety(): () => void;
  /** True between `enter()` and `exit()` — including across a subprocess handoff, which the guard owns. */
  active(): boolean;
  /** Run a child that wants the real terminal ($EDITOR, `!bash`, the `v` dump) with the main screen handed
   *  back for its duration, and take the alt screen again afterwards — canon L180653-180662. */
  aroundSubprocess<T>(run: () => T): T;
}

export interface AltScreenDeps {
  /** Synchronous, unbuffered, fd 1. Async writes do not survive the `process.exit` these paths end in. */
  writeSync(s: string): void;
  /** `TERM_PROGRAM`, for the upgrade gate. */
  termProgram?: string;
  /** canon `zuy`'s `e.unmount()` (L181502): give the renderer its chance to come down before we hand-write
   *  the escape. It is allowed to throw — that is the case this module exists for. */
  unmount?: () => void;
}

/** Exit codes for the signals the guard owns, by the shell convention (128 + signal number). */
const SIGNAL_EXIT: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

export function createAltScreenGuard(deps: AltScreenDeps): AltScreenGuard {
  const enterSeq = ENTER_ALT + kittyUpgrade(deps.termProgram);
  let armed = false;
  const write = (s: string) => { try { deps.writeSync(s); } catch { /* the fd is gone; nothing left to save */ } };
  const takeScreen = () => { write(enterSeq); armed = true; };
  // canon `zuy` L181494-181509, minus the pieces that belong to canon's patched Ink. The ORDER is the whole
  // content of this function: mouse off before anything that can throw, then the renderer's own teardown,
  // then the escape we write ourselves whether or not that teardown survived.
  const handBack = () => {
    write(MOUSE_OFF);
    try { deps.unmount?.(); } catch { /* L181503: the hand-written rmcup below IS canon's fallback */ }
    write(EXIT_ALT);
    write(CURSOR_SHOW);
  };
  return {
    enter() { if (!armed) takeScreen(); },
    exit() { if (!armed) return; armed = false; handBack(); },
    active() { return armed; },
    aroundSubprocess<T>(run: () => T): T {
      if (!armed) return run();
      // `armed` deliberately stays true across the handoff (canon keeps `altScreenActive` set through
      // `prepareTerminalForHandoff`): a signal that lands while the child owns the terminal must still find
      // a guard willing to write mouse-off and rmcup, and a redundant rmcup on the main screen costs nothing.
      write(MOUSE_OFF);
      write(EXIT_ALT);
      try { return run(); } finally { write(enterSeq); }
    },
    installSignalSafety() {
      const off: Array<() => void> = [];
      const onSignal = (sig: string) => () => { if (armed) { armed = false; handBack(); } process.exit(SIGNAL_EXIT[sig] ?? 1); };
      // SIGINT IS NEW TO CCX. The REPL's ctrl+c is raw-mode bytes, not a signal (keys/bindings.ts:42), so
      // nothing in the process has ever handled one — an external `kill -INT` took Node's default exit and
      // left the alt screen up. Registering it converts that into a clean teardown at the same exit code.
      const int = onSignal("SIGINT");
      process.on("SIGINT", int); off.push(() => process.off("SIGINT", int));
      // SIGTERM/SIGHUP ARE SOMEBODY ELSE'S when a foreground launch is running: `cli/main.ts:405` owns them
      // and finalizes the host, and drains this guard's cleanup through its `beforeExit` array first. We take
      // them only where nobody has — `ccx attach`, which has no host to stop and today no handler at all, so
      // a TERM there terminates by default and takes the terminal with it.
      for (const sig of ["SIGTERM", "SIGHUP"] as const) {
        if (process.listenerCount(sig) > 0) continue;
        const h = onSignal(sig);
        process.on(sig, h); off.push(() => process.off(sig, h));
      }
      // The last-resort net, and the only cover for an uncaught throw: no `finally` runs on that path, but
      // Node emits `exit` on its way down. Synchronous work only — which is all this is.
      const onExit = () => { if (armed) { armed = false; handBack(); } };
      process.on("exit", onExit); off.push(() => process.off("exit", onExit));
      return () => { for (const undo of off.splice(0)) undo(); };
    },
  };
}

/** THE ONE TEARDOWN every REPL exit funnels through — `/exit`, the double-ctrl-C arm and `ccx attach`'s
 *  onDetach all settle Ink's `waitUntilExit()`, whose `finally` is this call (m5).
 *
 *  Order is the contract: rmcup, THEN the pointer. The pointer is not a paint into the alt screen, it is the
 *  first line of the main screen we just handed back — which is why it is also the deliberate divergence
 *  from canon (spec §A6): canon prints its hint on the graceful path only, and a user who quit with a
 *  double ctrl+c wants the id just as much. Silent for a classic launch, which never armed the guard. */
export function exitAltScreen(guard: AltScreenGuard, sessionId: string | undefined, write: (s: string) => void): void {
  const wasActive = guard.active();
  guard.exit();
  if (wasActive && sessionId) write(resumePointer(sessionId));
}
