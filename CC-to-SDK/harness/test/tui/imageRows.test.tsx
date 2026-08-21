// tui/test/imageRows.test.tsx — F9 T-IMAGE Task 1 (I4): image content blocks must project as visible rows on
// every transcript surface. Canon (2.1.236, cites verified via `sed -n 'N,Mp'`, never `grep -o`): a user
// image block renders `[Image #N]` (1-based, L528790) or bare `[Image]` unnumbered; a tool-result image
// block renders bare `[Image]` (L522876); a Bash call whose result carries `isImage:true` short-circuits to
// `[Image data detected and sent to Claude]` (L526971/L528081) — that last one is already wired in
// `toolSummaries.ts`'s `bashRows`, and the cell here locks it through the FULL projection stack rather than
// the unit function, per r3-resume-view.md's premise correction: this is a species-router defect, not a
// resume-preview quirk, so it must hold on `projectCompact` exactly as it holds on the bare summary line.
import { describe, it, expect } from "vitest";
import { renderMessage } from "../../src/tui/render.js";
import { flatText, normalizeToolResult } from "../../src/tui/toolResult.js";
import { projectCompact, type ProjectionOptions } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";

const LINUX = { platform: "linux" as NodeJS.Platform };
const context: ProjectionOptions = { cwd: "/work", home: "/home/me", platform: "darwin", columns: 100, projection: "compact", now: 0, verbose: false };
const user = (content: unknown[]) => ({ type: "user", parent_tool_use_id: null, message: { role: "user", content } }) as Record<string, unknown>;
const IMAGE_BLOCK = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
const texts = (doc: TranscriptDocument) => projectCompact(doc, context).flatMap((i) => (i.kind === "line" ? [i.line.text] : i.kind === "gutter-block" ? i.body.map((l) => l.text) : []));

describe("(a) a user image block projects [Image #N], numbered per message", () => {
  it("text + one image → the image row is [Image #1]", () => {
    const lines = renderMessage(user([{ type: "text", text: "look at this" }, IMAGE_BLOCK]), LINUX);
    expect(lines.some((l) => l.text === "[Image #1]")).toBe(true);
  });
  it("two images in one message → #1 then #2, in source order", () => {
    const lines = renderMessage(user([IMAGE_BLOCK, IMAGE_BLOCK]), LINUX);
    expect(lines.map((l) => l.text)).toEqual(["[Image #1]", "[Image #2]"]);
  });
  // The FULL projection stack: `projectMessageEntry` calls `renderMessage` once PER BLOCK (so a naive
  // per-call counter inside `renderMessage` would always see array length 1 and print #1 twice). The
  // ordinal has to survive that per-block wrapping.
  it("survives projectMessageEntry's per-block wrapping — the species router, not just the pure renderer", () => {
    const doc = built(user([{ type: "text", text: "two shots" }, IMAGE_BLOCK, IMAGE_BLOCK]));
    expect(texts(doc)).toEqual(expect.arrayContaining(["[Image #1]", "[Image #2]"]));
  });
});

describe("(b) an image-only message is a non-empty projection (the resume empty-state fix)", () => {
  it("a message with only an image block still projects a visible row", () => {
    const lines = renderMessage(user([IMAGE_BLOCK]), LINUX);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.text).toBe("[Image #1]");
  });
  it("through the document/projectCompact path too — count and pane must agree", () => {
    const doc = built(user([IMAGE_BLOCK]));
    expect(texts(doc).length).toBeGreaterThan(0);
  });
});

describe("(c) a tool-result image block projects bare [Image]", () => {
  it("flatText renders a content-array image block as the literal [Image]", () => {
    expect(flatText([IMAGE_BLOCK])).toBe("[Image]");
  });
  it("text alongside an image block still joins in source order", () => {
    expect(flatText([{ type: "text", text: "here" }, IMAGE_BLOCK])).toBe("here\n[Image]");
  });
  it("an unrecognized tool's result (MCP-shaped) surfaces [Image] through normalizeToolResult's outputLines", () => {
    const event = { id: "mcp-1", name: "SomeMcpTool", input: {}, callSequence: 1, route: "top-level" as const, result: { content: [IMAGE_BLOCK], isError: false, resultSequence: 2 } };
    const normalized = normalizeToolResult(event);
    expect(normalized.outputLines).toEqual(["[Image]"]);
  });
});

describe("(d) an image-producing Bash call's live row is the detected-and-sent sentence", () => {
  // Locks `toolSummaries.ts`'s existing `bashRows` isImage short-circuit through the FULL projection
  // (`projectCompact`, over a document built the same way a live session's `TranscriptDocument` is), not
  // just the bare summary-line unit test in toolSummaries.test.ts — the cross-surface guarantee this task
  // is standing up applies here too: a Bash screenshot call must read identically live and on replay.
  it("a completed Bash call with isImage:true renders the detected-and-sent row, not raw output", () => {
    const call = { type: "assistant", parent_tool_use_id: null, message: { id: "m-bash-1", content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "screencap" } }] } };
    const result = { type: "user", uuid: "u-bash-1", message: { content: [{ type: "tool_result", tool_use_id: "bash-1", content: "binary" }] }, tool_use_result: { stdout: "binary", stderr: "", interrupted: false, noOutputExpected: false, isImage: true } };
    const doc = built(call, result);
    expect(texts(doc)).toEqual(expect.arrayContaining(["[Image data detected and sent to Claude]"]));
    expect(texts(doc).join("\n")).not.toContain("binary");
  });
});
