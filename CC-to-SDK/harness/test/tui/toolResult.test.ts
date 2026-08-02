import { describe, expect, it } from "vitest";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { normalizeToolResult } from "../../src/tui/toolResult.js";
import { BASH_CALL, BASH_RESULT_WITH_SIDECAR, EDIT_CALL, EDIT_RESULT_WITH_SIDECAR, READ_CALL, READ_RESULT_FLAT, READ_RESULT_WITH_SIDECAR, WRITE_CALL, WRITE_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";

function eventForPair(call: Record<string, unknown>, result: Record<string, unknown>) { const doc = new TranscriptDocument(); doc.appendSdk("host", call); doc.appendSdk("host", result); return doc.toolEvents()[0]!; }
const eventFor = (result: Record<string, unknown>) => eventForPair(READ_CALL, result);
describe("F1 structured-first results", () => {
  it("normalizes an open call through the same production path used by projectPending", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL);
    expect(normalizeToolResult(doc.toolEvents()[0]!)).toEqual({ tool: "Read", status: "running", source: "pending", rawContent: undefined, flatText: "", summary: "Read", output: "", outputLines: [] });
  });
  it("uses a uniquely associated recognized sidecar", () => expect(normalizeToolResult(eventFor(READ_RESULT_WITH_SIDECAR))).toMatchObject({ tool: "Read", source: "structured", summary: "Read 41 lines" }));
  it("uses complete input and flat output when the sidecar is absent", () => expect(normalizeToolResult(eventFor(READ_RESULT_FLAT))).toMatchObject({ tool: "Read", source: "fallback", summary: "Read 3 lines", outputLines: ["one", "two", "three"] }));
  it("falls back when a present Read sidecar fails its narrow shape guard", () => {
    const malformed = { ...READ_RESULT_WITH_SIDECAR, tool_use_result: { type: "read", file: { numLines: "41" } } };
    expect(normalizeToolResult(eventFor(malformed))).toMatchObject({ source: "fallback", summary: "Read 1 line", rawContent: "export const app = 1;\n" });
  });
  it("falls back on a finite but impossible Read line count instead of summarizing it", () => {
    for (const numLines of [-1, 1.5]) {
      const malformed = { ...READ_RESULT_WITH_SIDECAR, tool_use_result: { type: "read", file: { numLines } } };
      expect(normalizeToolResult(eventFor(malformed))).toMatchObject({ source: "fallback", summary: "Read 1 line" });
    }
  });
  it("recognizes the exact Write sidecar and keeps input-content fallback available", () => {
    expect(normalizeToolResult(eventForPair(WRITE_CALL, WRITE_RESULT_WITH_SIDECAR))).toMatchObject({ tool: "Write", source: "structured", summary: "Wrote 3 lines" });
    expect(normalizeToolResult(eventForPair(WRITE_CALL, { ...WRITE_RESULT_WITH_SIDECAR, tool_use_result: undefined }))).toMatchObject({ tool: "Write", source: "fallback", summary: "Wrote 3 lines" });
  });
  it("retains Edit structuredPatch positions without rendering an F4 diff", () => {
    expect(normalizeToolResult(eventForPair(EDIT_CALL, EDIT_RESULT_WITH_SIDECAR))).toMatchObject({ tool: "Edit", source: "structured", structured: { structuredPatch: [{ oldStart: 7, newStart: 7 }] } });
  });
  it("recognizes Bash stdout and interruption fields per call", () => {
    expect(normalizeToolResult(eventForPair(BASH_CALL, BASH_RESULT_WITH_SIDECAR))).toMatchObject({ tool: "Bash", source: "structured", status: "success", outputLines: ["ok"], structured: { returnCodeInterpretation: "fixture-status" } });
    const interrupted = { ...BASH_RESULT_WITH_SIDECAR, tool_use_result: { ...BASH_RESULT_WITH_SIDECAR.tool_use_result, interrupted: true } };
    expect(normalizeToolResult(eventForPair(BASH_CALL, interrupted))).toMatchObject({ source: "structured", status: "interrupted" });
  });
  it("keeps an unknown rejected tool generic and source-faithful", () => expect(normalizeToolResult({ id: "future-1", name: "FutureTool", input: { subject: "kept" }, callSequence: 1, route: "top-level", result: { content: "Tool use rejected", isError: true, resultSequence: 2 } })).toMatchObject({ tool: "FutureTool", status: "rejected", source: "fallback", rawContent: "Tool use rejected", flatText: "Tool use rejected", summary: "FutureTool", output: "Tool use rejected", outputLines: ["Tool use rejected"] }));
  it("retains non-string flat source while rendering its recognized text blocks", () => {
    const blocks = [{ type: "text", text: "first" }, { type: "text", text: "second" }];
    expect(normalizeToolResult({ id: "agent-1", name: "Agent", input: {}, callSequence: 1, route: "top-level", result: { content: blocks, isError: false, resultSequence: 2 } })).toMatchObject({ rawContent: blocks, flatText: "first\nsecond", outputLines: ["first", "second"] });
  });
});
