// tui/src/suspend.ts — Ctrl-Z: hand the terminal back to the shell. Ink holds stdin in raw mode, which
// disables the terminal's own job control (no SIGTSTP is ever generated), so suspension must be explicit:
// leave raw mode, stop this process; when `fg` delivers SIGCONT, re-enter raw mode and repaint.
export function suspendProcess(setRawMode: (v: boolean) => void, onResume: () => void): void {
  setRawMode(false);
  process.once("SIGCONT", () => { setRawMode(true); onResume(); });
  process.kill(process.pid, "SIGTSTP");
}
