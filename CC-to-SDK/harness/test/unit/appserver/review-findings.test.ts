import { describe, it, expect } from "vitest";
import { harvestFindings } from "../../../src/appserver/reviewFindings.js";

const frame = (content: unknown) => ({ type: "assistant", message: { content } });
const call = (input: unknown) => ({ type: "tool_use", name: "ReportFindings", id: "toolu_1", input });
const one = (file: string) => ({ file, summary: "s", failure_scenario: "f" });

describe("harvestFindings", () => {
  it("harvests the findings array out of the tool_use INPUT", () => {
    const got = harvestFindings(frame([call({
      level: "high",
      findings: [{ file: "a.ts", line: 3, summary: "off-by-one", failure_scenario: "lastN(x,2) returns 3", category: "correctness" }],
    })]));
    expect(got?.findings).toHaveLength(1);
    expect(got?.findings[0]).toMatchObject({ file: "a.ts", line: 3, category: "correctness" });
    expect(got?.level).toBe("high");
  });
  it("returns undefined for a frame with no ReportFindings call", () => {
    expect(harvestFindings(frame([{ type: "text", text: "hi" }]))).toBeUndefined();
    expect(harvestFindings(frame([{ type: "tool_use", name: "Bash", id: "t", input: {} }]))).toBeUndefined();
    expect(harvestFindings({ type: "result" })).toBeUndefined();
  });
  it("treats an EMPTY findings array as a real report, not as absence", () => {
    const got = harvestFindings(frame([call({ findings: [] })]));
    expect(got).toBeDefined();
    expect(got?.findings).toEqual([]);
  });
  it("does NOT fabricate a report from a call whose `findings` is absent or not an array", () => {
    // `findings` is REQUIRED in the SDK's own schema, so a call without it is a non-conforming payload,
    // not "a reviewer who found nothing". Returning `{findings: []}` would be an authoritative all-clear
    // nobody asserted; returning nothing falls through to Task 6's loud `unstructured: true` + prose.
    expect(harvestFindings(frame([call({ level: "high" })]))).toBeUndefined();
    expect(harvestFindings(frame([call({ findings: null })]))).toBeUndefined();
    expect(harvestFindings(frame([call({ findings: { file: "a.ts" } })]))).toBeUndefined();
    expect(harvestFindings(frame([call(undefined)]))).toBeUndefined();
  });
  it("does NOT report a PRESENT but all-malformed findings array — it is not a clean review", () => {
    // The absent-key case above and this one are the SAME non-conforming payload wearing two disguises, and
    // the second is the worse of the two: `reported` used to be set before any entry was validated, so a
    // reviewer that called ReportFindings with three entries and got every required field wrong published
    // `{findings: [], unstructured: false}` — an authoritative "reviewed, nothing found" asserted while the
    // model was actively trying to report defects. Nothing was read here, so nothing is what it reports.
    expect(harvestFindings(frame([call({ findings: [{ line: 4 }] })]))).toBeUndefined();
    expect(harvestFindings(frame([call({ findings: [{ line: 4 }, { file: "a.ts" }, "nope", null] })]))).toBeUndefined();
    expect(harvestFindings(frame([call({ level: "high", findings: [{ summary: "s" }] })]))).toBeUndefined();
  });
  it("keeps an EMPTY array a real report — the one shape that legitimately carries no entries", () => {
    // The three-way distinction's first leg, restated next to the case above because they differ by one
    // element: `[]` is the reviewer saying it looked and found nothing, which the prompt asks for by name.
    expect(harvestFindings(frame([call({ findings: [] })]))?.findings).toEqual([]);
    expect(harvestFindings(frame([call({ level: "none", findings: [] })]))?.level).toBe("none");
  });
  it("does not let an unreadable block cancel a SIBLING's real findings", () => {
    // The third leg, and the reason the suppression is scoped to "nothing was read at all": a block that
    // yielded findings is a report, whatever a neighbouring block got wrong.
    const got = harvestFindings(frame([call({ findings: [{ line: 4 }] }), call({ findings: [one("a.ts")] })]));
    expect(got?.findings.map((x) => x.file)).toEqual(["a.ts"]);
  });
  it("suppresses a bare empty report standing next to an unreadable one", () => {
    // Two blocks, one saying "nothing to report" and one that tried to report something we could not read:
    // publishing the first as the verdict would be the same all-clear by a longer route, so the whole frame
    // falls through to the unstructured fallback, where the prose survives.
    expect(harvestFindings(frame([call({ findings: [] }), call({ findings: [{ line: 4 }] })]))).toBeUndefined();
    expect(harvestFindings(frame([call({ findings: [{ line: 4 }] }), call({ findings: [] })]))).toBeUndefined();
  });
  it("harvests EVERY ReportFindings block in the frame, not just the first", () => {
    // Models do emit several tool_use blocks in one assistant message; `routeTodo` loops for this reason.
    const got = harvestFindings(frame([
      call({ level: "medium", findings: [one("a.ts")] }),
      { type: "text", text: "and also" },
      call({ level: "high", findings: [one("b.ts"), one("c.ts")] }),
    ]));
    expect(got?.findings.map((x) => x.file)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(got?.level).toBe("high");                 // last non-empty level wins
  });
  it("keeps a well-formed block's findings whichever side of a malformed block it lands on", () => {
    const after = harvestFindings(frame([call({ level: "high" }), call({ findings: [one("a.ts")] })]));
    expect(after?.findings.map((x) => x.file)).toEqual(["a.ts"]);
    const before = harvestFindings(frame([call({ findings: [one("a.ts")] }), call({ level: "high" })]));
    expect(before?.findings.map((x) => x.file)).toEqual(["a.ts"]);
    expect(before?.level).toBeUndefined();           // the malformed block contributes nothing at all
  });
  it("drops malformed findings instead of rejecting the whole report", () => {
    const got = harvestFindings(frame([call({ findings: [
      { file: "a.ts", summary: "ok", failure_scenario: "s" },
      { line: 4 },                                   // no file/summary/failure_scenario
    ] })]));
    expect(got?.findings).toHaveLength(1);
  });
  it("drops a non-positive `line` — the SDK documents it as 1-indexed", () => {
    const got = harvestFindings(frame([call({ findings: [
      { ...one("a.ts"), line: 0 }, { ...one("b.ts"), line: -4 }, { ...one("c.ts"), line: 7 },
    ] })]));
    expect(got?.findings.map((x) => x.line)).toEqual([undefined, undefined, 7]);
  });
  it("harvests a SUBAGENT's report too — this function holds no opinion about nesting", () => {
    // D-M4-7. A reviewing agent may dispatch subagents, and `ReportFindings` is written for exactly that
    // shape; a finding from a subagent of the review is still a finding about the review's subject. The
    // sibling route for TodoWrite (`router.ts:213`) DROPS nested frames, and copying that reflex here
    // would silently discard the findings of any review that fanned out. Nesting policy belongs to the
    // wiring (Task 6), not to this pure read, so this stays blind to the field on purpose.
    const nested = { type: "assistant", parent_tool_use_id: "toolu_parent", message: { content: [call({
      findings: [{ file: "b.ts", summary: "leak", failure_scenario: "close() never runs on the error path" }],
    })] } };
    expect(harvestFindings(nested)?.findings).toHaveLength(1);
  });
});
