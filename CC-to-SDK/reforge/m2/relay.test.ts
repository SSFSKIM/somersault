// The gate's own claim about itself: "a phase that can fail has to say what
// failed." This is the control on that claim.
//
// The failure it exists for was structural rather than a typo, and it had two
// independent halves. The aggregate runner relayed the LAST SIX matching lines
// of each suite; a corpus verdict block is 59 lines, so a scenario failing
// anywhere but at the end was dropped before the gate ever saw it — and the
// gate, whose only view of a suite is the aggregate's output, then reported a
// red phase that named nothing. Separately, the replay proxy's positional-serve
// diagnostic — by a distance the commonest cause of a red equivalence phase —
// is neither a verdict (one space after `FAIL`, not two) nor matched by the
// prose the gate's reason filter looked for, so the explanation was absent even
// when a name was present.
//
// Both halves are invisible on a green run, which is why they survived a full
// gate. So the checks below assert the RED direction, and each carries the
// control that the previous shape would have missed it.
//
// Run: npx tsx m2/relay.test.ts
import { REASON_RE, VERDICT_RE, relayOutput } from "./relay.js";
import { fallbackVerdict } from "../src/proxy.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

/** A corpus runner's stdout, with one deliberately failing scenario at a chosen index. */
function corpusTranscript(size: number, failAt: number): string {
  const tags = Array.from({ length: size }, (_, i) => `scenario-${String(i).padStart(2, "0")}`);
  const body = tags.map((t, i) => `\n━━━ ${t} — a title ━━━\n  replaying offline: A=engine-real, B=engine-strangled ...\n    request surface: identical\n${i === failAt ? "    substance: FAIL [B] — expected OK\n" : ""}`);
  const verdicts = tags.map((t, i) => `  ${i === failAt ? "FAIL" : "PASS"}  ${t}`);
  return [...body, "\n=== M1 corpus verdicts ===", ...verdicts, "", failAt >= 0 ? "FAILURES — on the identical-code pair these are harness defects" : "ALL PASS"].join("\n");
}

/** What the aggregate runner prints for one suite, given that suite's stdout. */
const aggregateRelay = (stdout: string): string => {
  const { verdicts, reasons } = relayOutput(stdout);
  return [...verdicts, ...reasons].map((l) => `  ${l.trim()}`).join("\n");
};

// ---------------------------------------------------------------------------
// 1. A failure EARLY in a long verdict block survives both relay hops.
// ---------------------------------------------------------------------------
{
  const stdout = corpusTranscript(59, 1);
  const hop1 = relayOutput(stdout);
  check("the failing scenario is named by the aggregate's relay", hop1.fails.some((f) => f.includes("scenario-01")));
  check("every verdict is relayed, not a tail", hop1.verdicts.length === 59, `${hop1.verdicts.length} of 59`);
  // …and the composition, which is where the defect actually lived: the gate
  // reads the aggregate's PRINTED output, so a window in either hop hides the
  // name.
  const hop2 = relayOutput(aggregateRelay(stdout));
  check("…and survives the gate's second relay over that output", hop2.fails.some((f) => f.includes("scenario-01")));

  // THE CONTROL: the retired shape would have missed it. Without this the two
  // checks above could pass under any window wide enough for a 59-line block.
  const retired = stdout.split("\n").filter((l) => /PASS|FAIL|ALL|identical|difference|LEAK/.test(l)).slice(-6);
  check("control — the retired last-six window did NOT name it", !retired.some((l) => l.includes("FAIL  scenario-01")));

  const green = relayOutput(corpusTranscript(59, -1));
  check("a green suite produces no failing verdict", green.fails.length === 0 && green.verdicts.length === 59);
}

// ---------------------------------------------------------------------------
// 2. The proxy's positional-serve line is a REASON, and it is the real line.
// ---------------------------------------------------------------------------
{
  // Captured from the writer rather than retyped, so a reword there is caught
  // here instead of silently un-matching.
  const captured: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => void captured.push(args.map(String).join(" "));
  try {
    fallbackVerdict("engine-strangled", "A", 1);
    fallbackVerdict("engine-extracted", "B", 2);
  } finally {
    console.log = realLog;
  }
  check("the proxy printed both diagnostics", captured.length === 2, `${captured.length}`);
  check("the fatal positional-serve line is recognized as a reason", captured.every((l) => REASON_RE.test(l)));
  check("…and is NOT mistaken for a per-item verdict", captured.every((l) => !VERDICT_RE.test(l)));
  // THE CONTROL: the retired reason filter did not match it, which is why a red
  // equivalence phase used to explain nothing.
  const retiredReason = /diverge|mismatch|differs|unexpected|no cassette|timed out/i;
  check("control — the retired reason filter missed it", captured.every((l) => !retiredReason.test(l)));

  // End to end: a suite whose only diagnostic is the positional serve still
  // reaches the gate with that line attached.
  const stdout = `${corpusTranscript(59, 7)}\n${captured[0]}`;
  const hop2 = relayOutput(aggregateRelay(stdout));
  check("the positional-serve reason reaches the gate through the aggregate",
    hop2.reasons.some((l) => l.includes("served POSITIONALLY")) && hop2.fails.some((f) => f.includes("scenario-07")));
}

// ---------------------------------------------------------------------------
// 3. Negative controls on what a verdict IS — the two-space rule.
// ---------------------------------------------------------------------------
{
  check("a verdict needs two spaces", VERDICT_RE.test("  PASS  tag") && !VERDICT_RE.test("  PASS tag"));
  check("prose beginning with FAIL is not a verdict", !VERDICT_RE.test("    FAIL A: 1 request(s) served POSITIONALLY"));
  check("an empty stdout relays nothing rather than throwing", relayOutput("").verdicts.length === 0);
  // Reasons are capped; verdicts are not. A pathological run must not flood the
  // log, but it must never lose a name.
  // A ZERO difference count is not a reason. Every healthy surface prints one,
  // so a filter that matched them would bury the real explanation under noise.
  check("a zero difference count is not relayed as a reason",
    relayOutput("  [transcripts 0, events 0, requests 0 difference(s) — not graded]").reasons.length === 0);
  check("…while a non-zero one is", relayOutput("  request surface: 3 difference(s)").reasons.length === 1);
  const flood = Array.from({ length: 200 }, (_, i) => `    scenario-${i} diverged`).join("\n");
  check("reasons are capped", relayOutput(flood).reasons.length === 12);
  check("…while verdicts are not", relayOutput(corpusTranscript(200, 3)).verdicts.length === 200);

  // A suite that states its result as PROSE — two of the five do — must still
  // relay something on a green run. A verdict-only relay showed nothing for
  // them, which is the same information loss as the tail window pointing the
  // other way.
  const prose = ["=== verdicts ===", "  store shape identical:              PASS", "  both cross-resumes transcript-equal: PASS", "", "ALL PASS — the store format is interchangeable"].join("\n");
  const relayed = relayOutput(prose);
  check("a prose-only suite relays its trailer", relayed.verdicts.length === 0 && relayed.summary.length === 3);
  check("…and the trailer never duplicates a verdict line",
    relayOutput(corpusTranscript(59, -1)).summary.every((l) => !VERDICT_RE.test(l)));
}

console.log(`=== gate relay: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(failures.length === 0 ? "PASS — every failing verdict is named and the proxy's reason reaches the gate" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
