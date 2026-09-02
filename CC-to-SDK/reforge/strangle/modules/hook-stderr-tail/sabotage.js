// SABOTAGE LAYER (§2.5).
//
// The twin is the rewrite a wave would most plausibly ship: `!exitCode` instead
// of `exitCode !== 0`, and the untrimmed stderr appended. Both are "cleanups"
// that read as equivalent and are not — the first changes the arm taken when a
// runner reports no code, the second changes the bytes appended whenever a hook
// ends its diagnostic with a newline, which is every hook that uses `echo`.
export function hookStderrTail(stdout, exitCode, stderr) {
  return !exitCode && stderr ? `${stdout}\n\nHook exited ${exitCode} with stderr:\n${stderr}` : stdout;
}
