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
// reaches 0 (line 126: `if (--this.rawModeEnabledCount === 0)`). ChatApp's own `useInput` AND whatever
// occupies the composer slot (ChatComposer/PermissionDialog/…) each hold a count, so it is always >=2 while
// interactive — calling the CONTEXT `setRawMode` here would be a silent no-op: the real tty never leaves
// raw mode and the shell's own job control stays disabled underneath us. So this module bypasses Ink's
// count entirely and toggles the real tty object directly (the `stdin` field `useStdin()` also exposes,
// separate from its `setRawMode` function) — Ink's internal bookkeeping is left untouched and
// self-consistent: it still believes raw mode is on the whole time, and it genuinely is on again before Ink
// ever reads more input.
//
// Repaint has the same shape of problem: a `useState` counter that nothing in the render tree reads
// produces byte-identical output, and Ink only writes when output actually changed
// (node_modules/ink/build/ink.js:132, `if (!hasStaticOutput && output !== this.lastOutput)`). Calling
// `useStdout().write("")` instead routes through Ink's own `writeToStdout` (ink.js:141-155), which does
// `this.log.clear()` — log-update.js's `clear()` resets its internal `previousOutput` to `""` — then
// `stdout.write(data)`, then `this.log(this.lastOutput)`. Because `clear()` reset `previousOutput`, that
// final `log(lastOutput)` is NOT swallowed by log-update's own equality gate, so this is a genuine forced
// repaint of the last real frame, not a no-op.
export interface SuspendDeps {
  stdin: { setRawMode?: (v: boolean) => void };
  repaint: () => void;
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: string) => void;
  once?: (signal: string, handler: () => void) => void;
  removeListener?: (signal: string, handler: () => void) => void;
}

export function suspendProcess(deps: SuspendDeps): void {
  if ((deps.platform ?? process.platform) === "win32") return;
  const kill = deps.kill ?? ((pid, signal) => { process.kill(pid, signal as NodeJS.Signals); });
  const once = deps.once ?? ((signal, handler) => { process.once(signal as NodeJS.Signals, handler); });
  const removeListener = deps.removeListener ?? ((signal, handler) => { process.removeListener(signal as NodeJS.Signals, handler); });
  const onResume = () => { deps.stdin.setRawMode?.(true); deps.repaint(); };
  let listenerAttempted = false;
  try {
    deps.stdin.setRawMode?.(false);
    // once-before-kill is load-bearing: a fast `fg` (SIGCONT delivered right back) must not race a listener
    // that hasn't attached yet, so the listener goes up BEFORE the signal that could trigger it.
    listenerAttempted = true;
    once("SIGCONT", onResume);
    kill(0, "SIGTSTP");   // whole process group (matches upstream) — child processes suspend with us, like real job control
  } catch (error) {
    if (listenerAttempted) removeListener("SIGCONT", onResume);
    deps.stdin.setRawMode?.(true);
    throw error;
  }
}
