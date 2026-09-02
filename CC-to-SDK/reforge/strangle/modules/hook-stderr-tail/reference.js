// PARITY LAYER (§2.5 `reference`) — the stderr tail on a hook-output VALIDATION
// ERROR (upstream `Xpt`, 2.1.251, chunk-fy12d89p @3015457, 96 bytes).
//
// THE BELT'S ONE GENUINELY PURE, MULTI-CALLER, ANCHORABLE MEMBER, and that
// sentence is C10.6's Stage 1 finding compressed. The executor design pass
// scoped Stage 1 as "the ~13.9 KB pure belt, ~34 helpers".
// `research/tools/extract-hook-helpers.ts` derives the belt instead of reading
// it, and the constraint turns out not to be purity: 84 of the 151 functions
// the executors reach carry NO STRING LITERAL AT ALL, and only four of the 43
// pure ones carry a literal occurring in exactly one bundle file. Three of those
// four have a single caller and fold into that caller's future module. This is
// the one that does not.
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
