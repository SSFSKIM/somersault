import { describe, expect, it } from "vitest";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { normalizeToolResult } from "../../src/tui/toolResult.js";
import { bashArgument, formatGenericError, sedInPlaceTarget } from "../../src/tui/toolResult.js";
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
  it("uses the edited path for recognized sed -i and clips ordinary nonverbose Bash", () => {
    expect(bashArgument({ command: "sed -i '' 's/old/new/' src/app.ts" }, false)).toBe("src/app.ts");
    expect(bashArgument({ command: " first\nsecond\nthird " }, false)).toBe("first\nsecond…");
    expect(bashArgument({ command: "x".repeat(200) }, false)).toHaveLength(160); expect(bashArgument({ command: "x".repeat(200) }, false)).toMatch(/…$/);
    expect(bashArgument({ command: " first\nsecond\nthird " }, true)).toBe("first\nsecond\nthird");
    expect(bashArgument({ command: "sed -i.bak 's/a/b/g' f.txt" }, false)).toBe("f.txt");
    expect(bashArgument({ command: "sed -E -i '' -e 's/a(b)/\\1/' f.txt" }, false)).toBe("f.txt");
    expect(bashArgument({ not_command: true }, false)).toBe("");
    expect(bashArgument({ command: "sed -i 's/a/b/' '*.ts'" }, false)).toBe("*.ts");   // quoted: a literal file name, not a glob
    expect(bashArgument({ command: 'sed -i \'\' \'s/a/b/\' "foo\\q"' }, false)).toBe("foo\\q");   // POSIX double quotes keep a backslash before ordinary chars
    expect(bashArgument({ command: 'sed -i \'\' \'s/a/b/\' "fo\\$o"' }, false)).toBe("fo$o");     // …but consume it before the four specials
    expect(bashArgument({ command: 'sed -i \'\' \'s/a/b/\' "a\\\\b"' }, false)).toBe("a\\b");
  });
  it("falls back to the clipped command for every unproven sed shape", () => {
    for (const command of ["sed -i 's/x/y/' a.txt b.txt", "sed -i 's/x/y/' a.txt > log", "sed -i 's/x/y/' a.txt | cat", "sed -n -i 's/x/y/' a.txt", "sed -i 'd' f.txt", "sed -i 's/x/y/' a.txt && echo done", "sed 's/x/y/' f.txt", "sed -i 's/x/y/'", "sed -i -e 's/a/b/' -e 's/c/d/' f.txt",
      "sed -i 's/a/b/' *.ts", "sed -i 's/a/b/' a?.ts", "sed -i 's/a/b/' [ab].ts", "sed -i 's/a/b/' {a,b}.ts", "sed -i 's/a/b/' ~/f.ts"])
      expect(bashArgument({ command }, false)).toBe(command);
  });
  it("rejects a Windows network-path sed target on win32 but accepts it on darwin", () => {
    const command = "sed -i 's/a/b/' //server/share/f";
    expect(sedInPlaceTarget(command, "win32")).toBeUndefined();
    expect(sedInPlaceTarget(command, "darwin")).toBe("//server/share/f");
    expect(sedInPlaceTarget("sed -i 's/a/b/' f.txt", "win32")).toBe("f.txt");
  });
  it("strips underline SGR from the error projection while rawContent keeps it", () => {
    const content = "\u001b[4mboom\u001b[24m failed";
    const event = { id: "u1", name: "FutureTool", input: {}, callSequence: 1, route: "top-level" as const, result: { content, isError: true, resultSequence: 2 } };
    const result = normalizeToolResult(event);
    expect(result.output).toBe("Error: boom\u001b[24m failed");   // only the underline-ON sequence goes; 24 (off) survives, exactly as upstream L3t leaves it
    expect(result.rawContent).toBe(content);
  });
  it("normalizes LT15 generic errors without losing their raw source", () => {
    expect(formatGenericError({ message: "not text" }, false)).toBe("Tool execution failed");
    expect(formatGenericError("<error><sandbox_violations>denied</sandbox_violations>boom</error>", false)).toBe("Error: boom");
    expect(formatGenericError("InputValidationError: malformed", false)).toBe("Invalid tool parameters");
    expect(formatGenericError("InputValidationError: malformed", true)).toBe("Error: InputValidationError: malformed");
    expect(formatGenericError("Error: retained", false)).toBe("Error: retained"); expect(formatGenericError("Cancelled: retained", false)).toBe("Cancelled: retained");
  });
  it("unwraps the tool_use_error envelope the SDK actually sends and matches InputValidationError anywhere", () => {
    expect(formatGenericError("<tool_use_error>InputValidationError: bad schema</tool_use_error>", false)).toBe("Invalid tool parameters");
    expect(formatGenericError("<tool_use_error>InputValidationError: bad schema</tool_use_error>", true)).toBe("Error: InputValidationError: bad schema");
    expect(formatGenericError("<tool_use_error>Cancelled: by user</tool_use_error>", false)).toBe("Cancelled: by user");
    expect(formatGenericError("<tool_use_error>Error: boom</tool_use_error>", false)).toBe("Error: boom");
    expect(formatGenericError("<tool_use_error><sandbox_violations>denied</sandbox_violations>boom</tool_use_error>", false)).toBe("Error: boom");
    expect(formatGenericError("prefix InputValidationError: mid-string", false)).toBe("Invalid tool parameters");
    expect(formatGenericError("<tool_use_error></tool_use_error>", false)).toBe("Tool execution failed");   // matched-but-empty is NOT a no-match
  });

  // ── F3 Task 9 (LT14): the WIRE discriminator, exactly as P80 recorded it ───────────────────────────────
  // `query.interrupt()` mid-tool-call emits the rejected `tool_result` as a user frame carrying a TOP-LEVEL
  // `tool_use_result:"User rejected tool use"` STRING (report 13 § A frame 1). transcriptModel's sidecar rule
  // is value-agnostic, so that string lands on the call as `event.result.sidecar` with scope "call" — which is
  // the only place classification may read it. The sentinel TEXT never rides this frame; it arrives as its own
  // separate user frame (rendered by toolRenderer), so matching content text here would classify nothing.
  it("classifies the interrupt off the wire field, not off any sentinel text in the result", () => {
    const rejected = { type: "user", uuid: "user-bash-interrupt", message: { content: [{ type: "tool_result", tool_use_id: "bash-1", content: "", is_error: true }] }, tool_use_result: "User rejected tool use" };
    const event = eventForPair(BASH_CALL, rejected);
    expect(event.result?.sidecar).toEqual({ scope: "call", value: "User rejected tool use" });
    const normalized = normalizeToolResult(event);
    expect(normalized.status).toBe("interrupted");
    expect(normalized.source).toBe("fallback");        // a STRING sidecar is not a recognized Bash shape
    expect(normalized.rawContent).toBe("");            // the source stays faithful; the row is a prompt, not a copy
  });
  it("does not read a message-scope or unrelated sidecar string as an interrupt", () => {
    const flat = { type: "user", uuid: "user-bash-ok", message: { content: [{ type: "tool_result", tool_use_id: "bash-1", content: "boom", is_error: true }] }, tool_use_result: "User approved tool use" };
    expect(normalizeToolResult(eventForPair(BASH_CALL, flat)).status).toBe("error");
  });
  it("keeps the Bash sidecar `Interrupted` flat-text path the wire field does not cover", () => {
    const event = { id: "b9", name: "Bash", input: { command: "sleep 9" }, callSequence: 1, route: "top-level" as const, result: { content: "Interrupted", isError: true, resultSequence: 2 } };
    expect(normalizeToolResult(event).status).toBe("interrupted");
  });
});
