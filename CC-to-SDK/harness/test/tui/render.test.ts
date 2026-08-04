import { describe, it, expect } from "vitest";
import { renderMessage, trunc, toolTarget } from "../../src/tui/render.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact } from "../../src/tui/toolRenderer.js";
import { READ_CALL, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";
import { ACCENT } from "../../src/tui/theme.js";

const asst = (content: unknown[]) => ({ type: "assistant", message: { content } });
const BULLET = { text: "● ", color: ACCENT };

describe("renderMessage", () => {
  it("renders assistant text with the ● bullet gutter + indented continuation", () => {
    expect(renderMessage(asst([{ type: "text", text: "hello\nworld" }]))).toEqual([
      { text: "hello", gutter: BULLET }, { text: "  world" },
    ]);
  });
  it("renders thinking dimmed", () => {
    expect(renderMessage(asst([{ type: "thinking", thinking: "hmm" }]))).toEqual([{ text: "hmm", dim: true }]);
  });
  // F1 Task 4: renderMessage is the NON-TOOL adapter. Every tool row — call header and result body alike —
  // goes through renderToolEvent instead, so no hand-rolled `⎿` gutter survives outside TOOL_RESULT_GUTTER.
  it("emits nothing for a tool_use block — the shared tool renderer owns that row", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Read", input: { file_path: "x.ts" } }]))).toEqual([]);
    expect(renderMessage(asst([{ type: "tool_use", name: "Edit", input: { file_path: "f.ts", old_string: "a", new_string: "b" } }]))).toEqual([]);
  });
  it("emits nothing for a tool_result block, and carries no ⎿ connector anywhere", () => {
    const ok = { type: "user", message: { content: [{ type: "tool_result", content: "line1\nline2" }] } };
    const bad = { type: "user", message: { content: [{ type: "tool_result", content: "boom", is_error: true }] } };
    expect(renderMessage(ok)).toEqual([]);
    expect(renderMessage(bad)).toEqual([]);
  });
  it("ignores result/system messages", () => {
    expect(renderMessage({ type: "result", result: "ok" })).toEqual([]);
  });
});

describe("one tool grammar across live and replay", () => {
  it("returns equal final RenderItem[] for the same fixture from a host document and a replayed one", () => {
    const projectionOptions = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
    // The closing prose is load-bearing since Task 5c: a fold run nothing has closed yet is still growable, so
    // the compact projection deliberately withholds its summary row (Static is append-only).
    const closed = { type: "assistant", message: { id: "assistant-done", content: [{ type: "text", text: "done" }] } };
    const host = new TranscriptDocument();
    host.appendSdk("host", READ_CALL); host.appendSdk("host", READ_RESULT_WITH_SIDECAR); host.appendSdk("host", closed);
    const disk = replayDocument([READ_CALL, READ_RESULT_WITH_SIDECAR, closed], { id: "session-1" });
    // The replay's own display dividers are local rows that shift every later resultSequence by one, so the
    // id's sequence component is normalized away; everything else must match byte for byte.
    const toolRows = (items: readonly { kind: string; id: string }[]) =>
      items.filter((i) => !i.id.startsWith("local:replay:")).map((i) => ({ ...i, id: i.id.replace(/^tool:([^:]+):\d+:/, "tool:$1:") }));
    expect(toolRows(projectCompact(host, projectionOptions))).toEqual(toolRows(projectCompact(disk, projectionOptions)));
  });
});

describe("toolTarget", () => {
  it("Edit/Write/Read → the file path", () => {
    expect(toolTarget("Edit", { file_path: "f.ts" })).toBe("f.ts");
    expect(toolTarget("Read", { file_path: "x.ts" })).toBe("x.ts");
    expect(toolTarget("Write", { path: "y.ts" })).toBe("y.ts");
  });
  it("Bash → the command", () => { expect(toolTarget("Bash", { command: "echo hi" })).toBe("echo hi"); });
  it("unknown tool → its first arg", () => { expect(toolTarget("Grep", { pattern: "foo" })).toBe("foo"); });
});
describe("trunc", () => { it("truncates with an ellipsis", () => { expect(trunc("abcdef", 4)).toBe("abc…"); }); });

// F4 Task 7 RETIRED `toolDiffLines` (and with it the 24-row cap these tests pinned): the diff header is
// `diffRender.diffHeader`, the body is `diffRender.renderDiff`, and both are pinned in `diffRender.test.ts`
// against the bundle constants rather than against F1's hand-rolled hunk. Nothing production called it.

describe("renderMessage (markdown wiring)", () => {
  it("renders assistant text as markdown (whole-line bold) and leaves thinking plain", () => {
    const lines = renderMessage({ type: "assistant", message: { content: [
      { type: "text", text: "**hi**" },
      { type: "thinking", thinking: "**not parsed**" },
    ] } });
    expect(lines).toContainEqual({ text: "hi", bold: true, gutter: BULLET }); // text → markdown + ● bullet
    expect(lines).toContainEqual({ text: "**not parsed**", dim: true });      // thinking → raw dim (NOT parsed, no bullet)
  });
});

describe("renderMessage (replay additions)", () => {
  it("renders a user-text prompt as a dim '› ' line", () => {
    const m = { type: "user", message: { role: "user", content: [{ type: "text", text: "fix the parser" }] } };
    expect(renderMessage(m)).toEqual([{ text: "› fix the parser", dim: true }]);
  });
});
