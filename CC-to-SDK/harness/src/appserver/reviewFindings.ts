// appserver/reviewFindings.ts — read a review's findings off the frame stream.
//
// THE PAYLOAD IS THE TOOL CALL'S INPUT, NOT ITS RESULT. `ReportFindings` is a native SDK tool whose
// declared input IS the findings array (sdk-tools.d.ts:771-814); the result is a receipt
// ("3 findings reported."). Probe 109 verified the whole path live: default headless session, plain
// instruction, payload on `tool_use.input`, clean tool_result, `success` turn. So harvesting is a READ of
// a frame the app server already routes — not a second engine loop and not structured-output plumbing.
//
// AN EMPTY ARRAY IS A REPORT — AN ABSENT ONE IS NOT. `{findings: []}` means the reviewer looked and found
// nothing, which is a different fact from "the reviewer never reported" (Task 6's unstructured fallback);
// conflating them is how a review turns into a silent all-clear. So a block whose `findings` is missing or
// not an array is SKIPPED, never read as an empty report: `findings` is required in the SDK's own schema,
// so such a call is a non-conforming payload, and the honest name for what it tells us is nothing. The
// errors are asymmetric — falling through to `unstructured: true` plus prose is loud and recoverable, an
// invented `findings: []` is an authoritative all-clear no reviewer asserted. `routeTodo`
// (`router.ts:216-218`) skips its malformed payload the same way, and for the same reason.
//
// EVERY BLOCK IN THE FRAME COUNTS. Models emit several `tool_use` blocks in one assistant message, so this
// accumulates across all of them (last block naming a `level` wins) rather than returning on the first —
// again `routeTodo`'s shape. A skipped block therefore never costs a well-formed sibling its findings.
//
// MALFORMED ENTRIES ARE DROPPED, NOT FATAL. The model authors this payload; one bad entry must not cost
// the whole report. The three required fields are the SDK's own.

export type ReviewFinding = {
  file: string;
  summary: string;
  failure_scenario: string;
  line?: number;
  short_summary?: string;
  category?: string;
  verdict?: "CONFIRMED" | "PLAUSIBLE";
  outcome?: "fixed" | "skipped" | "no_change_needed";
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function toFinding(raw: unknown): ReviewFinding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const file = str(r.file), summary = str(r.summary), failure = str(r.failure_scenario);
  if (!file || !summary || !failure) return undefined;   // the SDK's three required fields
  const f: ReviewFinding = { file, summary, failure_scenario: failure };
  if (typeof r.line === "number" && Number.isFinite(r.line) && r.line > 0) f.line = r.line; // 1-indexed, per the SDK
  const short = str(r.short_summary); if (short) f.short_summary = short;
  const category = str(r.category); if (category) f.category = category;
  if (r.verdict === "CONFIRMED" || r.verdict === "PLAUSIBLE") f.verdict = r.verdict;
  if (r.outcome === "fixed" || r.outcome === "skipped" || r.outcome === "no_change_needed") f.outcome = r.outcome;
  return f;
}

export function harvestFindings(frame: unknown): { findings: ReviewFinding[]; level?: string } | undefined {
  const f = frame as { type?: unknown; message?: { content?: unknown } } | null;
  if (!f || f.type !== "assistant" || !Array.isArray(f.message?.content)) return undefined;
  const findings: ReviewFinding[] = []; let level: string | undefined; let reported = false;
  for (const block of f.message.content as Array<Record<string, unknown>>) {
    if (block?.type !== "tool_use" || block.name !== "ReportFindings") continue;
    const input = block.input as { findings?: unknown; level?: unknown } | undefined;
    if (!Array.isArray(input?.findings)) continue;   // non-conforming payload — skip it, keep looking
    reported = true;
    for (const raw of input.findings) { const one = toFinding(raw); if (one) findings.push(one); }
    const lvl = str(input.level); if (lvl) level = lvl;                 // last block that names one wins
  }
  return reported ? { findings, ...(level ? { level } : {}) } : undefined;
}
