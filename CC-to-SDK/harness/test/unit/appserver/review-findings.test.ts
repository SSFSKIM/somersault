import { describe, it, expect } from "vitest";
import { harvestFindings } from "../../../src/appserver/reviewFindings.js";

const frame = (content: unknown) => ({ type: "assistant", message: { content } });
const call = (input: unknown) => ({ type: "tool_use", name: "ReportFindings", id: "toolu_1", input });

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
  it("drops malformed findings instead of rejecting the whole report", () => {
    const got = harvestFindings(frame([call({ findings: [
      { file: "a.ts", summary: "ok", failure_scenario: "s" },
      { line: 4 },                                   // no file/summary/failure_scenario
    ] })]));
    expect(got?.findings).toHaveLength(1);
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
