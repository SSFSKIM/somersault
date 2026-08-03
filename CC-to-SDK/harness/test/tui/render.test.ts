import { describe, it, expect } from "vitest";
import { renderMessage, trunc, toolTarget } from "../../src/tui/render.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact } from "../../src/tui/toolRenderer.js";
import { READ_CALL, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";
import { ACCENT, resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

// F1 Task 2: diff bodies read §2.2's diffAdded/diffRemoved and failed tool_results read `error`, each
// resolved through resolveThemeColor at projection time (render.ts does the same, per-call).
const ADDED = () => resolveThemeColor(themeTokens().diffAdded);
const REMOVED = () => resolveThemeColor(themeTokens().diffRemoved);

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

import { toolDiffLines } from "../../src/tui/render.js";
describe("toolDiffLines", () => {
  it("renders a single-line Edit as a numbered - / + hunk with a ● header (head stays index 0)", () => {
    expect(toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" })).toEqual([
      { text: "Edit f.ts", gutter: { text: "● " } },
      { text: "  1 - a", color: REMOVED() }, { text: "  1 + b", color: ADDED() },
    ]);
  });
  it("renders a multi-line Edit hunk: dim numbered context (≤3 lines each side) around numbered - / + change rows", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb\nc\nd\ne", new_string: "a\nb\nX\nd\ne" });
    expect(out[0]).toEqual({ text: "Edit f.ts", gutter: { text: "● " } });
    expect(out.slice(1)).toEqual([
      { text: "  1  a", dim: true },
      { text: "  2  b", dim: true },
      { text: "  3 - c", color: REMOVED() },
      { text: "  3 + X", color: ADDED() },
      { text: "  4  d", dim: true },
      { text: "  5  e", dim: true },
    ]);
  });
  it("produces no negative-length ranges when old_string === new_string (identical → context only, no change rows)", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb\nc\nd\ne", new_string: "a\nb\nc\nd\ne" });
    // EXACT rows, not just "no red/green + all dim": those negative assertions also hold for a regression
    // that duplicates or mis-numbers context rows (e.g. an unbounded suffix scan), so they pinned nothing.
    expect(out).toEqual([
      { text: "Edit f.ts", gutter: { text: "● " } },
      { text: "  3  c", dim: true }, { text: "  4  d", dim: true }, { text: "  5  e", dim: true },
    ]);
  });
  it("produces no negative-length ranges when new_string is a strict prefix of old_string (trailing removal only)", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb\nc", new_string: "a\nb" });
    expect(out[0]).toEqual({ text: "Edit f.ts", gutter: { text: "● " } });
    expect(out.slice(1)).toEqual([
      { text: "  1  a", dim: true },
      { text: "  2  b", dim: true },
      { text: "  3 - c", color: REMOVED() },
    ]);
  });
  it("produces no negative-length ranges when old_string is a strict prefix of new_string (trailing addition only)", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb", new_string: "a\nb\nc" });
    expect(out[0]).toEqual({ text: "Edit f.ts", gutter: { text: "● " } });
    expect(out.slice(1)).toEqual([
      { text: "  1  a", dim: true },
      { text: "  2  b", dim: true },
      { text: "  3 + c", color: ADDED() },
    ]);
  });
  it("keeps the all-+ behavior for Write (content only, no old_string)", () => {
    expect(toolDiffLines("Write", { file_path: "f.ts", content: "a\nb" })).toEqual([
      { text: "Write f.ts", gutter: { text: "● " } },
      { text: "  + a", color: ADDED() }, { text: "  + b", color: ADDED() },
    ]);
  });
  it("renders a removal-only Edit (old_string, no new_string) as an all-red body, never an empty one", () => {
    expect(toolDiffLines("Edit", { file_path: "f.ts", old_string: "a\nb" })).toEqual([
      { text: "Edit f.ts", gutter: { text: "● " } },
      { text: "  - a", color: REMOVED() }, { text: "  - b", color: REMOVED() },
    ]);
  });
  it("caps long diffs and notes the remainder (Write, all-+ body)", () => {
    const new_string = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
    const out = toolDiffLines("Write", { file_path: "big.ts", content: new_string }, 24);
    expect(out[0]).toEqual({ text: "Write big.ts", gutter: { text: "● " } });
    expect(out.filter((l) => l.text.startsWith("  +")).length).toBe(24);
    expect(out.at(-1)).toEqual({ text: "  … 16 more lines", dim: true });
  });
  it("caps a 40-line hunk body (all-changed, no shared prefix/suffix) and notes the correct remainder", () => {
    // No shared prefix or suffix at all → pure hunk body = 20 red - rows + 20 green + rows = 40 lines.
    const oldLines = Array.from({ length: 20 }, (_, i) => `old${i}`);
    const newLines = Array.from({ length: 20 }, (_, i) => `new${i}`);
    const out = toolDiffLines("Edit", { file_path: "big.ts", old_string: oldLines.join("\n"), new_string: newLines.join("\n") }, 24);
    expect(out[0]).toEqual({ text: "Edit big.ts", gutter: { text: "● " } });
    expect(out.filter((l) => l.color === REMOVED()).length + out.filter((l) => l.color === ADDED()).length).toBe(24); // capped at 24
    expect(out.at(-1)).toEqual({ text: "  … 16 more lines", dim: true }); // 40 body lines − cap 24 = 16
  });
});

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
  it("still caps a multi-line Write hunk in toolDiffLines, which is now called directly rather than through renderMessage", () => {
    const content = Array.from({ length: 30 }, (_, i) => `L${i}`).join("\n");
    const out = toolDiffLines("Write", { file_path: "b.ts", content });
    expect(out[0]).toEqual({ text: "Write b.ts", gutter: { text: "● " } });
    expect(out.at(-1)).toEqual({ text: "  … 6 more lines", dim: true });   // 30 added − cap 24 = 6
  });
});
