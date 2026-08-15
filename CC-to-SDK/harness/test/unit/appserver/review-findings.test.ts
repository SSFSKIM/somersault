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
