// SABOTAGE LAYER (§2.5).
//
// THE TWIN IS THE INVERTED ONE, deliberately, and the choice is the doctrine
// rather than a preference. The obvious twin — `!exitCode` for `exitCode !== 0`,
// or the stderr left untrimmed — is a plausible wrong implementation and is
// almost invisible: it differs only on a hook that FAILED with stderr, and it
// differs by producing LESS. A twin that can only be seen on the rarer input
// fails in the quiet direction, which is the shape C9 was corrected for when
// five of its twins were measured inert.
//
// So this one drops both conditions and appends unconditionally. It is still a
// mistake a wave could make — the guard reads like a special case of the
// formatting — and it changes the output of EVERY command hook rather than of
// the failing ones, which is what makes the darkness verdict, if it comes to
// one, a measurement rather than a shrug.
export function hookStderrTail(stdout, exitCode, stderr) {
  return `${stdout}\n\nHook exited ${exitCode} with stderr:\n${stderr.trim()}`;
}
