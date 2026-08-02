import React from "react";
import { Writable } from "node:stream";
import { render as renderInk } from "ink";
import { render } from "ink-testing-library";
import wrapAnsi from "wrap-ansi";
import { describe, expect, it } from "vitest";
import { displayPath, foldToolOutput, osc8FileLink, renderToolEvent, RenderItemView, TOOL_RESULT_GUTTER } from "../../src/tui/toolRenderer.js";
import { normalizeToolResult } from "../../src/tui/toolResult.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

async function rawInk(element: React.ReactElement): Promise<string> {
  let output = "";
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, callback) { output += Buffer.from(chunk).toString("utf8"); callback(); } }), { isTTY: true, columns: 100, rows: 40, getColorDepth: () => 24, hasColors: (_count?: number) => true });
  const app = renderInk(element, { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  app.unmount();
  return output;
}
const plain = (output: string) => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b]8;;[^\x07]*\x07/g, "");
const sgr = (output: string) => output.match(/\x1b\[[0-9;]*m/g) ?? [];

const options = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 20, projection: "compact" as const, now: 0, verbose: false };
const read = { id: "read-1", name: "Read", input: { file_path: "/work/src/app.ts" }, callSequence: 1, route: "top-level" as const, result: { content: "a\nb\nc\nd", isError: false, resultSequence: 2 } };
const normalized = { tool: "Read", status: "success" as const, source: "fallback" as const, rawContent: "a\nb\nc\nd", flatText: "a\nb\nc\nd", summary: "Read 4 lines", output: "a\nb\nc\nd", outputLines: ["a", "b", "c", "d"] };

describe("F1 shared tool renderer", () => {
  it("uses the exact OSC-8 bytes and cwd-first/home-second path display", () => {
    expect(osc8FileLink("/tmp/a b.ts", "src/a b.ts")).toBe("\x1b]8;;file:///tmp/a%20b.ts\x07src/a b.ts\x1b]8;;\x07");
    expect(displayPath("/work/src/app.ts", "/work", "/home/me")).toBe("src/app.ts"); expect(displayPath("/home/me/.x", "/work", "/home/me")).toBe("~/.x");
    expect(displayPath("/Users/me/project/src/app.ts", "/Users/me/project", "/Users/me")).toBe("src/app.ts");
  });
  it("uses macOS bullet, bold name-only segments, parens, and one sibling gutter", () => {
    const items = renderToolEvent(read, normalized, options); const header = items[0]!;
    expect(header).toMatchObject({ kind: "line", line: { segments: [{ text: "⏺ " }, { text: "Read", bold: true }, { text: "(" }, { text: expect.stringContaining("src/app.ts") }, { text: ")" }] } });
    expect(renderToolEvent(read, normalized, { ...options, platform: "linux" })[0]).toMatchObject({ kind: "line", line: { segments: expect.arrayContaining([expect.objectContaining({ text: "● " })]) } });
    const block = items[1]!; expect(block).toMatchObject({ kind: "gutter-block", gutter: TOOL_RESULT_GUTTER, body: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }] });
    const view = render(<>{items.map((item) => <RenderItemView key={item.id} item={item} />)}</>);
    expect((view.lastFrame()!.match(/⎿/g) ?? [])).toHaveLength(1); expect(view.lastFrame()).toContain(TOOL_RESULT_GUTTER);
  });
  it("places the one gutter in a five-column sibling before its body", async () => {
    const items = renderToolEvent(read, normalized, { ...options, columns: 100 });
    const row = plain(await rawInk(<>{items.map((item) => <RenderItemView key={item.id} item={item} />)}</>)).split("\n").find((line) => line.includes(TOOL_RESULT_GUTTER))!;
    const bodyStart = row.indexOf("a"), gutterColumn = row.slice(0, bodyStart);
    expect(gutterColumn.startsWith(TOOL_RESULT_GUTTER)).toBe(true); expect((gutterColumn.match(/⎿/g) ?? [])).toHaveLength(1);
    // Six columns hold the gutter plus one body cell on one row; five cannot, and the break loses no character —
    // so the gutter is exactly five columns wide. (An `toEqual([gutterColumn, "x"])` form would only hold for a
    // plain-space gutter: the trailing NBSP is deliberately not a break opportunity.)
    expect(wrapAnsi(`${gutterColumn}x`, 6, { hard: true, trim: false }).split("\n")).toEqual([`${gutterColumn}x`]);
    const tight = wrapAnsi(`${gutterColumn}x`, 5, { hard: true, trim: false }).split("\n");
    expect(tight).toHaveLength(2); expect(tight.join("")).toBe(`${gutterColumn}x`); expect(row.slice(bodyStart)).toBe("a");
  });
  it("ends the gutter constant in a non-breaking space, asserted by code point", () => {
    expect([...TOOL_RESULT_GUTTER].map((c) => c.codePointAt(0))).toEqual([0x20, 0x20, 0x23bf, 0x20, 0xa0]);
  });
  it("emits distinct resolved success and error SGR colors from actual item views", async () => {
    const success = await rawInk(<RenderItemView item={renderToolEvent(read, normalized, options)[0]!} />);
    const error = await rawInk(<RenderItemView item={renderToolEvent(read, { ...normalized, status: "error" }, options)[0]!} />);
    expect(sgr(success).length).toBeGreaterThan(0); expect(sgr(error).length).toBeGreaterThan(0); expect(sgr(success)).not.toEqual(sgr(error)); expect(plain(success)).toBe(plain(error));
  });
  const standardFold = { projection: "compact" as const, compactRows: 3, revealOneExtraWithoutMarker: true };
  it("wraps at max(columns-10,10), uses the four-row exception, and gives projection-specific overflow", () => {
    expect(foldToolOutput(["1", "2", "3", "4"], 20, standardFold).map((x) => x.text)).toEqual(["1", "2", "3", "4"]);
    expect(foldToolOutput(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`), 20, standardFold).at(-1)?.text).toBe("… +37 lines (ctrl+o to expand)");
    expect(foldToolOutput(["abcdefghijk"], 20, standardFold).map((x) => x.text)).toEqual(["abcdefghij", "k"]);
    expect(foldToolOutput(["1", "2", "3", "4", "5"], 20, { ...standardFold, projection: "detail-collapsed" }).at(-1)?.text).toBe("… +2 lines (ctrl+e to show all)");
  });
  it("slices at exact columns without word wrapping and trims every emitted row", () => {
    expect(foldToolOutput(["hello world"], 20, standardFold).map((x) => x.text)).toEqual(["hello worl", "d"]);
    expect(foldToolOutput(["aaaaaaaa  bbbb"], 20, standardFold).map((x) => x.text)).toEqual(["aaaaaaaa", "bbbb"]);
    expect(foldToolOutput(["ab   ", "", "cd"], 20, standardFold).map((x) => x.text)).toEqual(["ab", "", "cd"]);
  });
  it("bounds compact folding work and estimates the hidden count beyond the bound", () => {
    const huge = "x".repeat(1_000_000), folded = foldToolOutput([huge], 20, standardFold);
    expect(folded).toHaveLength(4);                                            // three shown rows + one marker, never 100 000 wrapped rows
    expect(folded.at(-1)?.text).toBe(`… +${Math.ceil(1_000_000 / 10) - 3} lines (ctrl+o to expand)`);
    expect(folded.slice(0, 3).map((x) => x.text)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(10)]);
    expect(foldToolOutput(["y".repeat(5000)], 20, { ...standardFold, projection: "detail-all" })).toHaveLength(500);
  });
  it("uses LT15's ten-row error clip without the normal four-row exception", () => {
    const errors = Array.from({ length: 11 }, (_, i) => `error ${i + 1}`);
    expect(foldToolOutput(errors, 100, { projection: "compact", compactRows: 10, revealOneExtraWithoutMarker: false }).map((line) => line.text)).toEqual([...errors.slice(0, 10), "… +1 line (ctrl+o to expand)"]);
  });
  it("renders 600ms pending blink and exact interruption, rejection, and suppression surfaces without checks or crosses", () => {
    const open = { ...read, result: undefined }; const running = renderToolEvent(open, normalizeToolResult(open), options);
    const toggled = renderToolEvent({ ...read, result: undefined }, { ...normalized, status: "running" }, { ...options, now: 600 });
    // Status colour and the running dim live on the SEGMENTS, never on the line: `Transcript.Line`
    // ignores `l.color`/`l.dim`/`l.bold`/`l.italic` entirely whenever `l.segments` is present, so a
    // line-level colour on a segmented header would render as plain text.
    expect(running).not.toEqual(toggled);
    expect(running[0]).toMatchObject({ kind: "line", line: { segments: expect.arrayContaining([expect.objectContaining({ text: "⏺ ", dim: true })]) } });
    expect(renderToolEvent(read, normalized, options)[0]).toMatchObject({ kind: "line", line: { segments: expect.arrayContaining([expect.objectContaining({ color: resolveThemeColor(themeTokens().success) })]) } });
    expect(renderToolEvent(read, { ...normalized, status: "error" }, options)[0]).toMatchObject({ kind: "line", line: { segments: expect.arrayContaining([expect.objectContaining({ color: resolveThemeColor(themeTokens().error) })]) } });
    const longError = renderToolEvent(read, { ...normalized, status: "error", output: Array.from({ length: 11 }, (_, i) => `error ${i + 1}`).join("\n"), outputLines: Array.from({ length: 11 }, (_, i) => `error ${i + 1}`) }, { ...options, columns: 100 });
    expect(longError[1]).toMatchObject({ kind: "gutter-block", body: [...Array.from({ length: 10 }, (_, i) => ({ text: `error ${i + 1}` })), { text: "… +1 line (ctrl+o to expand)", dim: true }] });
    expect(renderToolEvent(read, { ...normalized, status: "interrupted", output: "Interrupted", outputLines: ["Interrupted"] }, options).flatMap((x) => x.kind === "gutter-block" ? x.body : [x.line]).map((x) => x.text).join("\n")).toContain("Interrupted · What should Claude do instead?");
    expect(renderToolEvent(read, { ...normalized, status: "rejected", output: "Tool use rejected", outputLines: ["Tool use rejected"] }, options).flatMap((x) => x.kind === "gutter-block" ? x.body : [x.line]).map((x) => x.text).join("\n")).toContain("Tool use rejected");
    // Drive suppression through the real normalizer, not a hand-set status: this is the only assertion
    // that proves anything ever ASSIGNS "suppressed" (LT13), rather than that the renderer honours it.
    const suppressed = { ...read, name: "TaskCreate" };
    expect(normalizeToolResult(suppressed)).toMatchObject({ tool: "TaskCreate", status: "suppressed" });
    expect(renderToolEvent(suppressed, normalizeToolResult(suppressed), options)).toEqual([]);
    for (const name of ["TaskUpdate", "ToolSearch"]) {
      const evt = { ...read, name };
      expect(renderToolEvent(evt, normalizeToolResult(evt), options)).toEqual([]);
    }
    expect(render(<RenderItemView item={renderToolEvent(read, normalized, options)[0]!} />).lastFrame()).not.toMatch(/[✓✗]/);
  });
  it("retains a resolved target and cwd-first label in BEL-terminated OSC-8 from the actual tool header", async () => {
    const relativeRead = { ...read, input: { file_path: "src/app.ts" } };
    const header = renderToolEvent(relativeRead, normalized, { ...options, columns: 100 })[0]!;
    expect(await rawInk(<RenderItemView item={header} />)).toContain("\x1b]8;;file:///work/src/app.ts\x07src/app.ts\x1b]8;;\x07");
  });
});
