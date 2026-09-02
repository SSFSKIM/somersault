// PARITY LAYER (§2.5 `reference`) — the stderr tail on a hook-output VALIDATION
// ERROR (upstream `Xpt`, 2.1.251, chunk-fy12d89p @3015457, 96 bytes).
//
// A PURE, MULTI-CALLER, ANCHORABLE MEMBER OF THE BELT. This comment used to say
// "the belt's ONE", and C10.6's boundary review showed the measurement behind
// that word was wrong: it counted string literals of twelve characters or more,
// not anchors. Re-derived by `strangle/anchor.ts`'s own rule,
// `research/tools/extract-hook-helpers.ts` finds 125 of the 151 declarations
// anchorable and 31 of the 40 pure ones — and the fix round took three more
// (`hook-output-sync`, `hook-output-async`, `hook-invocation-text`). The design
// pass's "~13.9 KB pure belt, ~34 helpers" is still wrong in the other
// direction, and the doctrine the wave drew still stands: purity decides worth,
// anchorability decides takeability, and a single-caller pure helper folds into
// its caller's future module.
//
// WHAT IT ACTUALLY FORMATS, and the name it is filed under here is the second
// try. Its first argument is NOT the hook's stdout. Both call sites pass the
// VALIDATION ERROR that `xPe(stdout)` produced — the message explaining why the
// hook's stdout was not a legal hook-output document — and both are guarded on
// `status !== 2`. So the function's job is: when a hook wrote something that did
// not validate, and it ALSO failed loudly, put the two complaints in one string.
//
// The two consumers use the result differently, which is design §2's "two
// consumers, never one core" at its smallest scale. The streaming executor puts
// it in the `stderr` field of an error record it yields; the awaiting one makes
// it the MESSAGE OF A THROWN ERROR. Same 96 bytes, one shared meaning, two
// entirely different fates — and no core in between.
//
// THREE CONDITIONS, AND EACH ONE IS A DECISION.
//
//   the exit code is compared against zero rather than tested for truthiness,
//       so a runner that reports no code at all still takes the append arm —
//       the arm a `!exitCode` rewrite silently drops.
//   the stderr is TRIMMED FIRST, and the trimmed value both gates the append
//       and IS the appended text, so whitespace-only stderr is indistinguishable
//       from none.
//   the two are joined by AND, so a hook that emitted invalid JSON but exited
//       zero gets the bare validation error. Stderr is corroboration here, not
//       output.
//
// The blank line is two newlines inside the template rather than a join, which
// is why this splice anchors on the prose after it rather than before.

/**
 * @param validationError why the hook's stdout was not a legal hook-output document
 * @param exitCode        the hook process's exit code
 * @param stderr          the hook's stderr, untrimmed
 * @returns the validation error, with the stderr appended when the hook also failed
 */
export function hookStderrTail(validationError, exitCode, stderr) {
  const trimmed = stderr.trim();
  return exitCode !== 0 && trimmed
    ? `${validationError}\n\nHook exited ${exitCode} with stderr:\n${trimmed}`
    : validationError;
}
