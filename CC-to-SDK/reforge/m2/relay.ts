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
 * What a FALLBACK line says, and the reason it is a constant: the line is
 * written by one layer and has to be relayed by the next, so it is part of the
 * vocabulary `REASON_RE` matches rather than prose that dies at the first hop.
 */
export const RELAY_FALLBACK_MARKER = "no verdict or reason line";

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
  ["diverge", "mismatch", "differs", "[1-9]\\d* difference\\(s\\)", "unexpected", "matched no cassette", "no cassette", "timed out", "LEAK", POSITIONAL_SERVE_MARKER, RELAY_FALLBACK_MARKER].join("|"),
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

/** The shape of the `spawnSync` result every caller of this module holds. */
export interface RelayableChild {
  stdout?: string | null;
  stderr?: string | null;
  error?: { message?: string } | null;
}

/**
 * A child's stdout AND stderr, in that order.
 *
 * Every relay in this harness read `stdout` alone, and a runner that dies BEFORE
 * its verdict block — a module-load exception on the instrumented graph, a spawn
 * that never ran — writes its whole cause to `stderr`. The relay then found
 * nothing, and the phase reported a red TAG with no cause under it: the same
 * defect the header above describes, surviving on the sibling path because that
 * path's failure had never been read either.
 */
export const combinedOutput = (r: RelayableChild): string => `${r.stdout ?? ""}${r.stderr ?? ""}`;

/**
 * ONE line, when there is nothing else to say.
 *
 * A single line rather than three, because it has to survive the next hop: the
 * layers above filter line by line, and a marked one-liner relays where a
 * multi-line block would be cut apart. It carries `RELAY_FALLBACK_MARKER`, so
 * `REASON_RE` matches it and every layer above relays it unchanged.
 */
export function relayFallback(combined: string, error?: { message?: string } | null, limit = 3): string {
  const tail = combined.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).slice(-limit);
  const err = error?.message ? ` [process error: ${error.message}]` : "";
  return `${RELAY_FALLBACK_MARKER} — last ${tail.length} line(s) of the child's combined stdout+stderr: ${tail.join(" | ") || "<no output at all>"}${err}`;
}

/**
 * Every line a caller should print under a FAILED child, in order — and never
 * an empty list, which is the whole point. A failure the vocabulary does not
 * recognise still gets a cause printed under it rather than a bare tag.
 */
export function relayFailure(r: RelayableChild): string[] {
  const combined = combinedOutput(r);
  const { fails, reasons } = relayOutput(combined);
  const lines = [...fails, ...reasons].map((l) => l.trim());
  return lines.length > 0 ? lines : [relayFallback(combined, r.error)];
}
