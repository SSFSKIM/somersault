// PARITY LAYER (§2.5 `reference`) — the hook output's stderr tail (upstream
// `Xpt`, 2.1.251, chunk-fy12d89p @3015457, 96 bytes).
//
// THE ONLY GENUINELY PURE, MULTI-CALLER, ANCHORABLE MEMBER OF THE HELPER BELT,
// and that sentence is the whole of C10.6's Stage 1 finding compressed. The
// executor design pass scoped Stage 1 as "the ~13.9 KB pure belt, ~34 helpers".
// `research/tools/extract-hook-helpers.ts` derives the belt instead of reading
// it, and the constraint turns out not to be purity: 84 of the 151 functions
// the executors reach carry NO STRING LITERAL AT ALL, and only four of the 43
// pure ones carry a literal occurring in exactly one bundle file. Of those four,
// three have a single caller and fold into that caller's future module. This is
// the one that does not.
//
// WHAT IT DOES, and why both executors need it. When a command hook exits
// non-zero AND wrote something to stderr, the hook's stdout is republished with
// the stderr text appended under a header; otherwise the stdout is returned
// unchanged. It is called by `Qxt` (the streaming executor) and by `AE` (the
// awaiting one) — the two consumers design §2 says must never share a core.
// This is what "shared pure helpers" means concretely: 96 bytes both sides
// compute the same way, and the reason the architecture is two consumers rather
// than one core is everything AROUND it, not this.
//
// THREE CONDITIONS, AND EACH ONE IS A DECISION. The exit code is compared
// against zero rather than tested for truthiness, so a hook that exits with a
// code the runner reports as `undefined` still takes the append arm — which is
// the arm a `!exitCode` rewrite would silently drop. The stderr is TRIMMED
// FIRST and the trimmed value is what gates the append AND what is appended, so
// whitespace-only stderr is indistinguishable from none. And the two conditions
// are joined by `&&`, so a successful hook that wrote to stderr appends nothing:
// stderr is diagnostic here, not output.
//
// THE BLANK LINE IS TWO NEWLINES, not one, and it is inside the template rather
// than in a join — which is why the anchor for this splice is the prose after
// it rather than the prose before.

/**
 * @param stdout   the hook's stdout, already read
 * @param exitCode the process exit code
 * @param stderr   the hook's stderr, untrimmed
 * @returns the stdout, with the stderr tail appended when the hook failed loudly
 */
export function hookStderrTail(stdout, exitCode, stderr) {
  const trimmed = stderr.trim();
  return exitCode !== 0 && trimmed ? `${stdout}\n\nHook exited ${exitCode} with stderr:\n${trimmed}` : stdout;
}
