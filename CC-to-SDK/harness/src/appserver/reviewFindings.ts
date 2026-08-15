// appserver/reviewFindings.ts — read a review's findings off the frame stream.
//
// THE PAYLOAD IS THE TOOL CALL'S INPUT, NOT ITS RESULT. `ReportFindings` is a native SDK tool whose
// declared input IS the findings array (sdk-tools.d.ts:771-814); the result is a receipt
// ("3 findings reported."). Probe 109 verified the whole path live: default headless session, plain
// instruction, payload on `tool_use.input`, clean tool_result, `success` turn. So harvesting is a READ of
// a frame the app server already routes — not a second engine loop and not structured-output plumbing.
//
// AN EMPTY ARRAY IS A REPORT. `{findings: []}` means the reviewer looked and found nothing, which is a
// different fact from "the reviewer never reported" (Task 6's unstructured fallback) — conflating them is
// how a review turns into a silent all-clear.
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
  if (typeof r.line === "number" && Number.isFinite(r.line)) f.line = r.line;
  if (str(r.short_summary)) f.short_summary = String(r.short_summary);
  if (str(r.category)) f.category = String(r.category);
  if (r.verdict === "CONFIRMED" || r.verdict === "PLAUSIBLE") f.verdict = r.verdict;
  if (r.outcome === "fixed" || r.outcome === "skipped" || r.outcome === "no_change_needed") f.outcome = r.outcome;
  return f;
}

export function harvestFindings(frame: unknown): { findings: ReviewFinding[]; level?: string } | undefined {
  const f = frame as { type?: unknown; message?: { content?: unknown } } | null;
  if (!f || f.type !== "assistant" || !Array.isArray(f.message?.content)) return undefined;
  for (const block of f.message.content as Array<Record<string, unknown>>) {
    if (block?.type !== "tool_use" || block.name !== "ReportFindings") continue;
    const input = block.input as { findings?: unknown; level?: unknown } | undefined;
    const raw = Array.isArray(input?.findings) ? input.findings : [];
    return {
      findings: raw.map(toFinding).filter((x): x is ReviewFinding => x !== undefined),
      ...(str(input?.level) ? { level: String(input?.level) } : {}),
    };
  }
  return undefined;
}
