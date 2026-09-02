// What a suite's stdout SAYS, in one place — shared by the aggregate runner
// (`m2/all.ts`) and by the gate phase that spawns it (`strangle/gate.ts`).
//
// WHY THIS IS A MODULE AND NOT TWO REGEXES. Both layers relay a child process's
// output, and each had its own idea of which lines mattered. The aggregate kept
// the LAST SIX matching lines per suite, which is the tail of a 59-line verdict
// block — so a corpus scenario that failed anywhere but in the last five was
// never named, and the gate, reading only what the aggregate printed, could not
// name it either. The gate's own reason filter had the mirror defect: the
// proxy's positional-serve line is neither a verdict (it carries one space after
// `FAIL`, not two) nor matched by the prose the filter looked for, so the single
// most common cause of a red equivalence phase was the one cause the log never
// showed.
//
// "A phase that can fail has to say what failed" is only true if every layer
// between the failure and the log agrees on what a failure LOOKS like. That
// agreement is this file.
import { POSITIONAL_SERVE_MARKER } from "../src/proxy.js";

/**
 * A per-item VERDICT: `  PASS  <tag>` / `  FAIL  <tag>`, two spaces after the
 * word. Every runner in this harness prints its verdict block in that shape,
 * and the two-space rule is what separates a verdict from prose that merely
 * begins with `FAIL` (the proxy's `FAIL A: …` diagnostic, for one).
 */
export const VERDICT_RE = /^\s*(PASS|FAIL)\s{2}\S/;

/** …and the failing half of it. */
export const isFailVerdict = (line: string): boolean => /^\s*FAIL\s{2}\S/.test(line);

/**
 * A REASON: a line that explains a failure rather than declaring one.
 *
 * The positional-serve marker is imported from the module that WRITES it rather
 * than copied, so a reword there cannot silently un-match here. Everything else
 * is the vocabulary the differ, the replay proxy and the runners use for a
 * divergence.
 */
export const REASON_RE = new RegExp(
  // A NON-ZERO difference count only: the runners print "0 difference(s)" on
  // every healthy surface, and a filter that matched those would bury the real
  // reasons under them.
  ["diverge", "mismatch", "differs", "[1-9]\\d* difference\\(s\\)", "unexpected", "matched no cassette", "no cassette", "timed out", "LEAK", POSITIONAL_SERVE_MARKER].join("|"),
  "i",
);

/**
 * The suites that do NOT print a per-item verdict block.
 *
 * Two of the five state their result as prose (`store shape identical: PASS`,
 * `event-type sequence: identical`), so a verdict-only relay would show nothing
 * for them on a green run — which is a different way of losing information than
 * the tail window, in the opposite direction. This is the legacy broad filter,
 * kept as a bounded TAIL for exactly that trailer.
 */
const SUMMARY_RE = /PASS|FAIL|ALL |identical|difference|LEAK/;

export interface RelayedOutput {
  /** every verdict line, in order — not a tail */
  verdicts: string[];
  /** the failing subset, which is what a red run has to name */
  fails: string[];
  /** the explanatory lines, capped so a pathological run cannot flood the log */
  reasons: string[];
  /** the trailer, for suites whose result is prose rather than a verdict block */
  summary: string[];
}

/**
 * Split a child's stdout into the four things a caller relays.
 *
 * The limits bound only REASONS and SUMMARY. Verdicts are never truncated: the
 * whole point is that a failure outside a tail window still gets named.
 */
export function relayOutput(stdout: string, reasonLimit = 12, summaryLimit = 6): RelayedOutput {
  const lines = stdout.split("\n");
  const verdicts = lines.filter((l) => VERDICT_RE.test(l));
  const seen = new Set(verdicts);
  return {
    verdicts,
    fails: verdicts.filter(isFailVerdict),
    reasons: lines.filter((l) => !VERDICT_RE.test(l) && REASON_RE.test(l)).slice(0, reasonLimit),
    summary: lines.filter((l) => l.trim().length > 0 && !seen.has(l) && SUMMARY_RE.test(l)).slice(-summaryLimit),
  };
}
