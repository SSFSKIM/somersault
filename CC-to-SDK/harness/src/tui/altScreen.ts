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
/** canon `Usr` L177070 (DECRST 2004), written by `Uho` (L180343) one byte ahead of `nV`. UNCONDITIONAL, for
 *  the same reason `MOUSE_OFF` is: `KeymapProvider` turns bracketed paste ON (`keys/KeymapProvider.tsx:326`)
 *  and off only in an effect cleanup (`:352`) — which is exactly the work a throwing unmount skips. Leaked,
 *  every later paste into the user's own shell arrives wrapped in a literal `200~…201~`. */
export const PASTE_OFF = "\x1b[?2004l";
/** canon L180654's leave sequence, which resets SGR before handing the terminal to a child. */
export const SGR_RESET = "\x1b[0m";

/** canon `ocy` L177175 — the terminals whose keyboard protocol we upgrade, verbatim and in canon's order. */
export const KITTY_TERMINALS: readonly string[] =
  ["iTerm.app", "kitty", "WezTerm", "ghostty", "tmux", "windows-terminal", "WarpTerminal"];

/** canon `oeh()` L22139-22210 (`Z.terminal`) — the ORDERED subset of its reads that can name one of the
 *  seven above. `TERM_PROGRAM` alone is not that answer: kitty does not set it at all, and ghostty sets it
 *  only sometimes, so a gate fed the raw variable could never upgrade the terminal the feature is named
 *  after. Canon's order is load-bearing and kept — `TERM` decides ghostty and kitty BEFORE `TERM_PROGRAM`
 *  gets a say, and the bare env facts (`TMUX`, `KITTY_WINDOW_ID`, `WT_SESSION`) only speak when it is
 *  absent. The IDE/editor arms above them in canon are omitted: none of them names one of the seven.
 *  `markdownInline.ts:23,37` reads the same facts for its own gates, but as per-capability booleans over
 *  raw env rather than a name, so there is nothing there to extract. */
export function resolveTerminalName(env: NodeJS.ProcessEnv): string | undefined {
  if (env.TERM === "xterm-ghostty") return "ghostty";
  if (env.TERM?.includes("kitty")) return "kitty";
  if (env.TERM_PROGRAM) return env.TERM_PROGRAM;
  if (env.TMUX) return "tmux";
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.WT_SESSION) return "windows-terminal";
  return undefined;
}

/** canon `Ybe()` L177094 gated on `icy()` L177092: push a kitty keyboard-protocol level and ask for
 *  modifyOtherKeys=2, but only where both are understood. Everywhere else the empty string — an unrecognised
 *  `\x1b[>1u` on a terminal that does not consume it is echoed at the user as literal text. */
export function kittyUpgrade(termProgram: string | undefined): string {
  return KITTY_TERMINALS.includes(termProgram ?? "") ? "\x1b[<u\x1b[>1u\x1b[>4;2m" : "";
}

/** canon L366419-366421, with our binary's name and without canon's dim, and NOTHING ELSE — those two are
 *  the whole divergence. The leading newline is canon's: after rmcup the cursor is restored to its pre-smcup
 *  position, so without it the hint prints flush against the command line that launched us. Ours stays plain
 *  because the pointer is the last thing the user sees and may well be scraped out of a redirected log.
 *  Printed AFTER rmcup, onto the MAIN screen — the single legitimate write on the far side of §A6. */
export function resumePointer(sessionId: string): string {
  return `\nResume this session with:\nccx --resume ${sessionId}\n`;
}

export interface AltScreenGuard {
  /** Take the alternate screen. Idempotent; ARMS the guard — everything below is inert until it is called. */
  enter(): void;
  /** Hand the main screen back: mouse off, unmount, rmcup, cursor. Idempotent, never throws. */
  exit(): void;
  /** FSW T15 — HAND THE MAIN SCREEN BACK AND KEEP RENDERING. `/tui default` leaves the alternate screen under
   *  a session that is not ending: the same React tree paints its next frame onto the main screen, so this is
   *  `exit()` minus the two things that belong to an exit — canon `zuy`'s unmount limb (there is nothing to
   *  unmount; the tree is the point) and `PASTE_OFF` (the keymap provider still owns bracketed paste and will
   *  not re-arm it until it remounts). Disarms, so a later `enter()` takes the screen again and the exit
   *  teardown owes nothing for a screen we no longer hold.
   *    NOT `createChatTeardown`. That is latched once per process by design — it is the EXIT's order — and a
   *  mode flip is not an exit; routing a flip through it would spend the latch and leave the real exit silent. */
  leave(): void;
  /** Install the crash-safety handlers. Returns the disposer that removes exactly what it added. */
  installSignalSafety(): () => void;
  /** True between `enter()` and `exit()` — including across a subprocess handoff, which the guard owns. */
  active(): boolean;
  /** Run a child that wants the real terminal ($EDITOR, `!bash`, the `v` dump) with the main screen handed
   *  back for its duration, and take the alt screen again afterwards — canon L180653-180662. */
  aroundSubprocess<T>(run: () => T): T;
  /** THE SAME HANDOFF, OPENED UP — leave now, and get back the call that returns. `aroundSubprocess` cannot
   *  serve ctrl+z (FSW T14, amendment 3): a suspend's two halves are separated by a SIGTSTP/SIGCONT round trip
   *  through the shell, so there is no `run()` to wrap and no stack to keep. The bytes and their order are the
   *  wrapper's own — that function is written in terms of this one — and the returned call is idempotent-safe
   *  to drop: an unarmed guard hands back a no-op, exactly as `aroundSubprocess` runs the child in place. */
  handoff(): () => void;
}

export interface AltScreenDeps {
  /** Synchronous, unbuffered, fd 1. Async writes do not survive the `process.exit` these paths end in. */
  writeSync(s: string): void;
  /** The terminal's name for the upgrade gate — `resolveTerminalName(process.env)`, not a raw variable. */
  termProgram?: string;
  /** canon `zuy`'s `e.unmount()` (L181502): give the renderer its chance to come down before we hand-write
   *  the escape. It is allowed to throw — that is the case this module exists for. */
  unmount?: () => void;
  /** THE CALLER OWNS SIGINT/SIGTERM/SIGHUP AND WILL DRAIN THIS GUARD'S TEARDOWN BEFORE IT EXITS. Declared,
   *  not sniffed: `process.listenerCount(sig) > 0` answers "is a listener attached", and what the guard
   *  needs to know is whether anyone will run its cleanup — a launch that owned the signal but never
   *  registered a teardown would pass the sniff and get no cleanup at all. Only the caller knows both
   *  halves, because it is the caller that registers the handler (`cli/main.ts:424`) and holds the
   *  `beforeExit` array that handler drains. False/absent — `ccx attach`, which has no host to stop and no
   *  handler of its own — and the guard takes all three itself. */
  signalsOwned?: boolean;
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
  // `renderer: false` is the `process.on("exit")` limb, which must not run React (see `installSignalSafety`).
  const handBack = (renderer = true) => {
    write(MOUSE_OFF);
    if (renderer) try { deps.unmount?.(); } catch { /* L181503: the hand-written rmcup below IS canon's fallback */ }
    write(EXIT_ALT);
    write(PASTE_OFF);
    write(CURSOR_SHOW);
  };
  // THE SUBPROCESS HANDOFF, AS TWO HALVES. `armed` deliberately stays true across it (canon keeps
  // `altScreenActive` set through `prepareTerminalForHandoff`): a signal that lands while somebody else owns
  // the terminal must still find a guard willing to write mouse-off and rmcup, and a redundant rmcup on the
  // main screen costs nothing. That matters more for ctrl+z than for a child process — a STOPPED process can
  // be killed outright, and the `exit` limb is then the only thing left to speak for the terminal.
  // THE BYTES OF GIVING THE SCREEN BACK WITHOUT ENDING ANYTHING — shared by the subprocess handoff and by
  // T15's mode flip, which are the same act with different futures (one comes back, one does not).
  const leaveScreen = (): void => {
    write(MOUSE_OFF);
    write(EXIT_ALT);
    // …and whoever takes the terminal gets a cursor they can see. Ink's log-update hides one on every render
    // (`ink/build/log-update.js:9`) and only shows it again in `done()`, which no handoff runs, so `$EDITOR` /
    // `!bash` / the `v` dump — and the SHELL PROMPT a ctrl+z returns to — would arrive with DECTCEM still
    // reset. Canon's leave is explicit about the same pair, in this order: `\x1B[0m\x1B[?25h` (L180654).
    write(SGR_RESET);
    write(CURSOR_SHOW);
  };
  const handoff = (): (() => void) => {
    if (!armed) return () => {};
    leaveScreen();
    return () => { write(enterSeq); };
  };
  return {
    enter() { if (!armed) takeScreen(); },
    exit() { if (!armed) return; armed = false; handBack(); },
    leave() { if (!armed) return; armed = false; leaveScreen(); },
    active() { return armed; },
    handoff,
    aroundSubprocess<T>(run: () => T): T {
      const back = handoff();
      try { return run(); } finally { back(); }
    },
    installSignalSafety() {
      const off: Array<() => void> = [];
      const onSignal = (sig: string) => () => { if (armed) { armed = false; handBack(); } process.exit(SIGNAL_EXIT[sig] ?? 1); };
      // ALL THREE ARE SOMEBODY ELSE'S when a foreground launch is running: `cli/main.ts:424` owns them, and
      // its handler finalizes the host — which this module cannot see — after draining the REPL's teardown
      // out of `beforeExit`. So the guard takes them only where nobody has: `ccx attach`, which has no host
      // to stop and no handler at all, and where a TERM would otherwise terminate by default and take the
      // terminal with it. SIGINT IS NEW TO CCX EITHER WAY — the REPL's ctrl+c is raw-mode bytes, not a
      // signal (`keys/bindings.ts:42`), so nothing in the process has ever handled one and an external
      // `kill -INT` took Node's default exit with the alt screen still up.
      if (!deps.signalsOwned) for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        const h = onSignal(sig);
        process.on(sig, h); off.push(() => process.off(sig, h));
      }
      // The last-resort net, and the only cover for an uncaught throw: no `finally` runs on that path, but
      // Node emits `exit` on its way down. Synchronous `writeSync` is the only legal work there, so this is
      // the one limb that does NOT attempt the renderer's unmount: Ink's `unmount()` runs `onRender`,
      // `log.done()` and React unmount effects through `stdout.write`, and while that stream is synchronous
      // on a POSIX tty, an exit handler is no place to depend on it. The bytes are the guarantee.
      const onExit = () => { if (armed) { armed = false; handBack(/* renderer */ false); } };
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

/** Everything `runChatClient` owes the terminal on the way out, as data. Each member is one obligation the
 *  REPL took on above the React tree, in the order it has to be discharged. */
export interface ChatTeardownDeps {
  /** Drop the SIGWINCH listener… */
  offResizeListener(): void;
  /** …and the resize machinery behind it, whose settle window WRITES when it fires. */
  stopResize(): void;
  /** `a0u` (L148428) — hand the terminal back with an empty title. An OSC write, so: before rmcup. */
  clearTitle(): void;
  /** Where the cursor is parked between frames, or 0 (see `resizeRepaint.parkSequence`). */
  parkedColumn(): number;
  /** The guard's signal-handler disposer. Writes nothing; runs last so the handlers stay live until then. */
  stopSignalSafety(): void;
  guard: AltScreenGuard;
  /** Read late: the adapter's id is a live getter that tracks clears, rewinds and resumes. */
  sessionId(): string | undefined;
  /** The main screen, tty-gated. The unpark and the resume pointer both go here. */
  write(s: string): void;
}

/** THE WHOLE EXIT, IN ONE LATCHED ORDER — and the reason it is a function rather than a `finally` block.
 *
 *  A REPL exit arrives by one of two routes and they used to run different code. The graceful route settles
 *  Ink's `waitUntilExit()` and lands on `runChatClient`'s `finally`; the SIGNAL route never reaches it,
 *  because `cli/main.ts`'s handler ends in `process.exit` — so the guard's `exit()` alone was pushed into
 *  `beforeExit`. That was the bug (T6 review F1): `exit()`'s unmount limb RESOLVES `waitUntilExit()`, so the
 *  `finally` ran anyway one microtask later — after rmcup, on the user's own shell screen, where the
 *  unpark's `\x1b[2K` erases a line of it and the title reset paints an OSC into a terminal we had already
 *  given back. Both routes now call this, the second call is inert, and the ordering rule holds on both.
 *
 *  ORDER IS THE CONTENT: every line above `exitAltScreen` still paints, and rmcup is the point past which
 *  nothing may (spec §A6). The resume pointer that follows it is not a paint into the alt screen — it is the
 *  first line of the main screen we just handed back. */
export function createChatTeardown(deps: ChatTeardownDeps): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    deps.offResizeListener();
    deps.stopResize();
    deps.clearTitle();
    // Unpark before the shell gets the terminal back, or its prompt draws from column 117 on a row of our
    // spaces. Still on the near side of rmcup: it is an erase of OUR row, not of the screen underneath.
    if (deps.parkedColumn() > 0) deps.write("\x1b[2K\x1b[G");
    deps.stopSignalSafety();
    exitAltScreen(deps.guard, deps.sessionId(), deps.write);
  };
}
