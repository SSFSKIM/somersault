import React from "react";
import { Writable } from "node:stream";
import { render as renderInk } from "ink";
import { render } from "ink-testing-library";
import wrapAnsi from "wrap-ansi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampHintText, displayPath, foldToolOutput, GROUP_HINT_GUTTER, osc8FileLink, projectCompact, projectDetail, projectionDeps, projectPending, renderToolEvent, RenderItemView, TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
import { FoldPendingState } from "../../src/tui/foldPendingState.js";
import type { RenderLine } from "../../src/tui/render.js";
import { normalizeToolResult } from "../../src/tui/toolResult.js";
import { resolveThemeColor, setTheme, THEMES, themeTokens } from "../../src/tui/theme.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";

async function rawInk(element: React.ReactElement, columns = 100): Promise<string> {
  let output = "";
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, callback) { output += Buffer.from(chunk).toString("utf8"); callback(); } }), { isTTY: true, columns, rows: 40, getColorDepth: () => 24, hasColors: (_count?: number) => true });
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

const bodyOf = (items: readonly RenderItem[]): readonly RenderLine[] => items.flatMap((item) => (item.kind === "gutter-block" ? item.body : []));
// F3 Task 5 (LT1): a completed `Read` now renders its TYPED row (`Read 4 lines`) as its body — upstream dumps
// file content nowhere. The cases below that pin the GENERIC raw-output body (multi-row gutter geometry,
// trailing-blank trimming) therefore drive an UNKNOWN tool, which is the one route that still folds raw output;
// the Read fixture keeps pinning the header and, now, the typed row itself.
const generic = { ...read, id: "gen-1", name: "FutureTool" };
const genericNormalized = { ...normalized, tool: "FutureTool", summary: "FutureTool" };

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
    expect(items[1]).toMatchObject({ kind: "gutter-block", gutter: TOOL_RESULT_GUTTER, body: [{ text: "Read 4 lines" }] });
    const rawItems = renderToolEvent(generic, genericNormalized, options);
    expect(rawItems[1]).toMatchObject({ kind: "gutter-block", gutter: TOOL_RESULT_GUTTER, body: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }] });
    const view = render(<>{rawItems.map((item) => <RenderItemView key={item.id} item={item} />)}</>);
    expect((view.lastFrame()!.match(/⎿/g) ?? [])).toHaveLength(1); expect(view.lastFrame()).toContain(TOOL_RESULT_GUTTER);
  });
  it("places the one gutter in a five-column sibling before its body", async () => {
    const items = renderToolEvent(generic, genericNormalized, { ...options, columns: 100 });
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
  it("clips a generic error by PHYSICAL lines, so one unbroken long line stays whole and unmarked", () => {
    const long = "e".repeat(500);
    const body = bodyOf(renderToolEvent(read, { ...normalized, status: "error", output: long, outputLines: [long] }, { ...options, columns: 20 }));
    expect(body).toHaveLength(1); expect(body[0]!.text).toBe(long);
  });
  it("drops trailing blank result lines before folding and emits no block at all for an all-blank result", () => {
    expect(bodyOf(renderToolEvent(generic, { ...genericNormalized, output: "out\n\n  ", outputLines: ["out", "", "  "] }, options)).map((line) => line.text)).toEqual(["out"]);
    expect(bodyOf(renderToolEvent(generic, { ...genericNormalized, status: "error", output: "boom\n  ", outputLines: ["boom", "  "] }, options)).map((line) => line.text)).toEqual(["boom"]);
    expect(renderToolEvent(generic, { ...genericNormalized, output: "\n  ", outputLines: ["", "  "] }, options).map((item) => item.kind)).toEqual(["line"]);
  });
  it("renders interruption and rejection dim rather than error-coloured, and clips a rejection to one row", () => {
    expect(bodyOf(renderToolEvent(read, { ...normalized, status: "interrupted", output: "Interrupted", outputLines: ["Interrupted"] }, options))).toEqual([{ text: "Interrupted · What should Claude do instead?", dim: true }]);
    expect(bodyOf(renderToolEvent(read, { ...normalized, status: "rejected", output: "Tool use rejected\ntrailing detail", outputLines: ["Tool use rejected", "trailing detail"] }, options))).toEqual([{ text: "Tool use rejected", dim: true }]);
  });
  it("still marks overflow when SGR-heavy source exceeds the bound in bytes but not in visual rows", () => {
    const heavy = "\u001b[31m".repeat(200) + "x";                       // > 120-char bound at width 10, one visual row
    const rows = foldToolOutput([heavy], 20, { projection: "compact", compactRows: 3, revealOneExtraWithoutMarker: true });
    expect(rows.at(-1)!.text).toMatch(/^… \+\d+ lines \(ctrl\+o to expand\)$/);
  });
  it("links only file-tool paths: Grep keeps its pattern and gets no OSC-8 target", () => {
    const grep = { id: "grep-1", name: "Grep", input: { pattern: "TODO", path: "src" }, callSequence: 1, route: "top-level" as const, result: { content: "hit", isError: false, resultSequence: 2 } };
    const header = renderToolEvent(grep, { ...normalized, tool: "Grep", summary: "Grep" }, options)[0]!;
    expect(header).toMatchObject({ kind: "line", line: { segments: expect.arrayContaining([expect.objectContaining({ text: "TODO" })]) } });
    expect((header as { line: { text: string } }).line.text).not.toContain("\x1b]8;;");
  });
  it("trims the padding on the last nonblank line so it cannot wrap into a phantom row", () => {
    expect(bodyOf(renderToolEvent(generic, { ...genericNormalized, output: "abc        ", outputLines: ["abc        "] }, options)).map((line) => line.text)).toEqual(["abc"]);
  });
  it("labels a proven sed -i row Update with a display path, and Edit rows Create/Update", () => {
    const sed = { id: "b1", name: "Bash", input: { command: "sed -i '' 's/a/b/' /work/src/app.ts" }, callSequence: 1, route: "top-level" as const, result: { content: "", isError: false, resultSequence: 2 } };
    expect(renderToolEvent(sed, { ...normalized, tool: "Bash", summary: "Bash" }, options)[0]).toMatchObject({ kind: "line", line: { segments: expect.arrayContaining([expect.objectContaining({ text: "Update", bold: true }), expect.objectContaining({ text: "src/app.ts" })]) } });
    const create = { ...sed, id: "e1", name: "Edit", input: { file_path: "/work/a.ts", old_string: "", new_string: "x" } };
    expect(renderToolEvent(create, { ...normalized, tool: "Edit", summary: "Edit" }, options)[0]).toMatchObject({ kind: "line", line: { segments: expect.arrayContaining([expect.objectContaining({ text: "Create", bold: true })]) } });
    const update = { ...create, input: { file_path: "/work/a.ts", old_string: "y", new_string: "x" } };
    expect(renderToolEvent(update, { ...normalized, tool: "Edit", summary: "Edit" }, options)[0]).toMatchObject({ kind: "line", line: { segments: expect.arrayContaining([expect.objectContaining({ text: "Update", bold: true })]) } });
  });
  it("collapses Agent description whitespace and drops the parens when description or prompt is missing", () => {
    const agent = { id: "a1", name: "Agent", input: { description: "do\n  the   thing", prompt: "p" }, callSequence: 1, route: "top-level" as const };
    expect((renderToolEvent(agent, normalizeToolResult(agent), options)[0] as { line: { text: string } }).line.text).toBe("⏺ Agent(do the thing)");
    const bare = { ...agent, id: "a2", input: { description: "d only" } };
    expect((renderToolEvent(bare, normalizeToolResult(bare), options)[0] as { line: { text: string } }).line.text).toBe("⏺ Agent");
  });
  it("truncates a long header to one terminal row instead of wrapping (LT10)", async () => {
    const long = { ...read, input: { file_path: "/work/" + "a".repeat(300) + ".ts" } };
    const rows = plain(await rawInk(<RenderItemView item={renderToolEvent(long, normalized, { ...options, columns: 40 })[0]!} />, 40)).split("\n").filter((row) => row.trim() !== "");
    expect(rows).toHaveLength(1);
  });
  it("retains a resolved target and cwd-first label in BEL-terminated OSC-8 from the actual tool header", async () => {
    const relativeRead = { ...read, input: { file_path: "src/app.ts" } };
    const header = renderToolEvent(relativeRead, normalized, { ...options, columns: 100 })[0]!;
    expect(await rawInk(<RenderItemView item={header} />)).toContain("\x1b]8;;file:///work/src/app.ts\x07src/app.ts\x1b]8;;\x07");
  });
});

// ── F1 Task 5c: the DEFAULT view's collapsed group row over Task 5b's fold model ────────────────────────
// Upstream's default transcript renders one dim summary per contiguous read/search/list/MCP run — our
// committed per-call `⏺ Read(a.ts)` row is upstream's ctrl+o VERBOSE form, so it stays byte-identical in
// both detail projections and only `projectCompact`/`projectPending` fold.
const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body", isError = false) =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } }) as Record<string, unknown>;
const prose = (text: string, id = `t-${text.slice(0, 6)}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
const lineTexts = (items: readonly RenderItem[]) => items.filter((i) => i.kind === "line").map((i) => (i as { line: RenderLine }).line.text);
const groupRows = (items: readonly RenderItem[]) => items.filter((i) => i.id.startsWith("group:"));

describe("F1 collapsed group rows (R3.4–R3.8, R4.1–R4.8, R5.2)", () => {
  it("collapses one settled read into a single dim row with a bold count, no bullet and no result body", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/src/app.ts" }), result("read-1", "export const app = 1;"), prose("done"));
    const items = projectCompact(doc, context), rows = groupRows(items);
    expect(rows).toHaveLength(1);
    const line = (rows[0] as { line: RenderLine }).line;
    expect(line.text).toBe("  Read 1 file (ctrl+o to expand)");
    // The expand hint is ONE component (`Bg`) rendered on both the active and the settled row (R3.6), so its
    // dim `inactive` colour — measured on the tracked golden's active row — is the same on both. The settled
    // CLAUSE run carries that colour too: the settled-state probe pinned 2026-08-03 shows upstream painting
    // the settled row `#999999` under the tracked capture environment, the same grey as the active row (the
    // `#949494` first recorded in the live-confirmation note was that probe environment's ambient-palette
    // variant). The leader box stays two bare spaces — no glyph, no dim, no colour (R3.4).
    // F3 TASK 2 (plan 2026-08-04-tui-clone-f3, spec Decision Log 2026-08-04): the clause run is no longer
    // styled segments but ONE pre-styled string of upstream's exact bytes — colour, dim, a real
    // `\x1b[1m…\x1b[22m` count, and NO dim re-open after it (upstream's own dim loss). `line.text` is
    // unchanged: it is the SGR-stripped sentence.
    const grey = resolveThemeColor(themeTokens().inactive);
    expect(line.segments).toEqual([
      { text: "  " },
      { text: "\x1b[38;2;153;153;153m\x1b[2mRead \x1b[1m1\x1b[22m file\x1b[22m\x1b[39m", preStyled: true },
      { text: " ", dim: true }, { text: "(ctrl+o to expand)", dim: true, color: grey },
    ]);
    expect(grey).toBe("#999999");                                                // the bytes above are that colour
    expect(items.some((i) => i.kind === "gutter-block")).toBe(false);            // R3.7: the ⎿ hint line is ACTIVE-only
    expect(JSON.stringify(items)).not.toContain("export const app = 1;");        // the result body belongs to ctrl+o
    expect(rows[0]!.id).toBe("group:read-1:row");
  });

  it("collapses a contiguous run of two reads into ONE row that counts distinct file paths", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"), prose("done"));
    expect(lineTexts(groupRows(projectCompact(doc, context)))).toEqual(["  Read 2 files (ctrl+o to expand)"]);
  });

  it("flushes the run at a standalone tool: the fold row publishes BEFORE the Bash row it broke on", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("bash-1", "Bash", { command: "echo hi" }), result("bash-1", "hi"), prose("done"));
    const texts = lineTexts(projectCompact(doc, context));
    expect(texts).toContain("  Read 1 file (ctrl+o to expand)");
    expect(texts).toContain("⏺ Bash(echo hi)");
    expect(texts.indexOf("  Read 1 file (ctrl+o to expand)")).toBeLessThan(texts.indexOf("⏺ Bash(echo hi)"));
  });

  it("splits a run at real assistant prose into two independent fold rows", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("mid", "t-mid"),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"), prose("end", "t-end"));
    expect(lineTexts(groupRows(projectCompact(doc, context)))).toEqual(["  Read 1 file (ctrl+o to expand)", "  Read 1 file (ctrl+o to expand)"]);
    expect(groupRows(projectCompact(doc, context)).map((i) => i.id)).toEqual(["group:read-1:row", "group:read-2:row"]);
  });

  it("never folds either detail projection: both keep today's per-call header plus gutter block", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/src/app.ts" }), result("read-1", "one\ntwo"), prose("done"));
    for (const projection of ["detail-all", "detail-collapsed"] as const) {
      const items = projectDetail(doc, { ...context, projection });
      expect(items.filter((i) => i.id.startsWith("group:"))).toEqual([]);
      expect(items.some((i) => i.kind === "line" && (i as { line: RenderLine }).line.text.startsWith("⏺ Read("))).toBe(true);
      expect(items.some((i) => i.kind === "gutter-block")).toBe(true);
    }
  });

  it("holds a still-growable trailing run out of the projection entirely (append-only Static discipline)", () => {
    const settled = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"));
    expect(groupRows(projectCompact(settled, context))).toEqual([]);              // nothing has closed the run yet
    const closed = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
    expect(groupRows(projectCompact(closed, context))).toHaveLength(1);
  });

  it("gives an errored read exactly the settled row a successful one gets (R5.2: no glyph, colour or count change)", () => {
    const ok = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1", "fine", false), prose("done"));
    const bad = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1", "ENOENT", true), prose("done"));
    expect(groupRows(projectCompact(bad, context))).toEqual(groupRows(projectCompact(ok, context)));
    expect(JSON.stringify(groupRows(projectCompact(bad, context)))).not.toContain(resolveThemeColor(themeTokens().error));
  });

  it("renders ONE blinking active group row for open collapsible calls, with the ⎿ hint below it", () => {
    const doc = built(call("read-1", "Read", { file_path: "src/app.ts" }));
    const items = projectPending(doc, context);
    expect(items).toHaveLength(2);
    const line = (items[0] as { line: RenderLine }).line;
    expect(items[0]!.id).toBe("group:read-1:pending-row");
    expect(line.text).toBe("⏺ Reading 1 file… (ctrl+o to expand)");
    // Task 7 corrections, both measured on the tracked 2.1.220 golden (see groupRowLine's header): the
    // leader GLYPH and the expand hint are dim AND `inactive` (#999999), with only the glyph cell coloured
    // — which is why the leader is two segments — and the active clause run is DIM, not bright. F3 TASK 2
    // (plan 2026-08-04-tui-clone-f3) adds the last piece: the run — the trailing `…` included, since the
    // golden's ellipsis rides the broken-dim tail — is ONE pre-styled string carrying the golden's plain
    // " file…" verbatim, which is what buys the genuinely bold count.
    const grey = resolveThemeColor(themeTokens().inactive);
    expect(line.segments).toEqual([
      { text: "⏺", dim: true, color: grey }, { text: " ", dim: true },
      { text: "\x1b[2mReading \x1b[1m1\x1b[22m file…\x1b[22m", preStyled: true },
      { text: " ", dim: true }, { text: "(ctrl+o to expand)", dim: true, color: grey },
    ]);
    // The golden paints `  ⎿  src/app.ts` as ONE dim #999999 run — connector included, which is why the
    // gutter cells carry their own style here rather than staying plain text.
    expect(items[1]).toEqual({ kind: "gutter-block", id: "group:read-1:pending-hint", gutter: GROUP_HINT_GUTTER, gutterStyle: { color: grey, dim: true }, body: [{ text: "src/app.ts", dim: true, color: grey }] });
    // R4.1: a single glyph BLINKING on a 600 ms period — glyph for one half, a bare 2-column gap for the other.
    const off = projectPending(doc, { ...context, now: 600 });
    expect((off[0] as { line: RenderLine }).line.text).toBe("  Reading 1 file… (ctrl+o to expand)");   // the glyph, not the box, blinks away
    expect((projectPending(doc, { ...context, now: 1200 })[0] as { line: RenderLine }).line.text).toBe(line.text);
    expect((projectPending(doc, { ...context, platform: "linux" })[0] as { line: RenderLine }).line.text.startsWith("● ")).toBe(true);
  });

  it("keeps a NON-collapsible open call on its own per-call pending row, and folds two open reads into one row", () => {
    const bash = built(call("bash-1", "Bash", { command: "echo hi" }));
    expect(lineTexts(projectPending(bash, context))).toEqual(["⏺ Bash(echo hi)"]);
    const reads = built(call("read-1", "Read", { file_path: "/work/a.ts" }), call("read-2", "Read", { file_path: "/work/b.ts" }));
    const items = projectPending(reads, context);
    expect(items[0]!.id).toBe("group:read-1,read-2:pending-row");
    expect((items[0] as { line: RenderLine }).line.text).toBe("⏺ Reading 2 files… (ctrl+o to expand)");
    expect(projectPending(reads, context, new Set(["read-2"]))[0]!.id).toBe("group:read-2:pending-row");
  });

  it("matches the Task 6 golden masks for an open single-read group in a real Ink frame", () => {
    const doc = built(call("read-1", "Read", { file_path: "src/app.ts" }));
    const items = projectPending(doc, context);
    // The masks are read off the plain frame: the bold count and the dim runs put SGR bytes INSIDE the clause.
    const frame = plain(render(<>{items.map((item) => <RenderItemView key={item.id} item={item} />)}</>).lastFrame()!);
    expect(frame).toMatch(/Read(?:ing)? \d+ file/);
    expect(frame).toMatch(/⎿.*src\/app\.ts/);
  });

  it("paints a genuinely BOLD count inside the dim run, with upstream's plain post-count tail (F3 Task 2)", () => {
    // These assertions read RAW frame bytes, which are Ink's NORMALIZED re-emit of what the writer produced
    // (F3 Task 1: no-op codes dropped, missing closers appended) — so they pin the rendered ATTRIBUTE story,
    // never byte-identity with `composeFoldRun`'s output. That identity is sgr-foldrow.test.ts's job.
    const raw = (items: readonly RenderItem[]) => render(<>{items.map((item) => <RenderItemView key={item.id} item={item} />)}</>).lastFrame()!;
    const activeFrame = raw(projectPending(built(call("read-1", "Read", { file_path: "src/app.ts" })), context));
    // The golden's per-cell story for `⏺ Reading 1 file…`: glyph dim+grey, " Reading " dim, "1" dim+bold,
    // " file…" PLAIN. Ink drops the run's own `\x1b[2m` as a no-op — the leader already opened dim.
    expect(activeFrame).toContain("\x1b[38;2;153;153;153m\x1b[2m⏺\x1b[39m Reading \x1b[1m1\x1b[22m file…");
    // The dim is NOT re-opened after the count. Regex, not a literal: under a re-open sabotage Ink
    // NORMALIZES `\x1b[22m\x1b[2m` to a bare `\x1b[2m` (review finding — the literal form was unmatchable
    // and the guard vacuous), so match any dim-open between the count's closer and the tail.
    expect(activeFrame).not.toMatch(/1(?:\x1b\[22m)?\x1b\[2m file/);
    const settled = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
    // Settled keeps the grey through the tail — `\x1b[22m` clears faint, not colour — exactly as upstream's
    // outer `<Text color dimColor>` does.
    expect(raw(groupRows(projectCompact(settled, context)))).toContain("\x1b[38;2;153;153;153m\x1b[2mRead \x1b[1m1\x1b[22m file");
  });
});

// ── F1 Task 5c follow-up: absorbed bookkeeping calls + the unclosed group's visibility ──────────────────
// Two adjudicated 5c concerns. (1) A tool WE suppress (ToolSearch/TaskCreate/TaskUpdate) used to flush the
// run, leaving two summary rows with an invisible seam between them; it must join the group silently
// instead. (2) A run whose members have all settled but that no breaker has closed yet used to render
// nowhere at all — the active row had left the transient region and the settled row had not published.
describe("F1 5c fixes: silent absorption and the unclosed trailing group", () => {
  const search = (id: string, query: string) => call(id, "ToolSearch", { query });
  it("absorbs a suppressed bookkeeping call into the run instead of breaking it in two", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      search("ts-1", "select:Read"), result("ts-1", "{}"),
      call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"), prose("done"));
    const rows = groupRows(projectCompact(doc, context));
    expect(lineTexts(rows)).toEqual(["  Read 2 files (ctrl+o to expand)"]);          // ONE row, no seam
    expect(rows.map((i) => i.id)).toEqual(["group:read-1,read-2:row"]);              // and the absorbed call earns no counter
  });

  it("absorbs a suppressed call silently in the transient region too", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      search("ts-1", "select:Read"), call("read-2", "Read", { file_path: "/work/b.ts" }));
    const rows = groupRows(projectPending(doc, context));
    expect(lineTexts(rows)).toEqual(["⏺ Reading 2 files… (ctrl+o to expand)"]);
  });

  it("renders a settled-but-unclosed run in the DYNAMIC region, in its settled form, under a distinct id", () => {
    const open = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"));
    expect(groupRows(projectCompact(open, context))).toEqual([]);                    // nothing has closed the run
    const dynamic = projectPending(open, context);
    expect(lineTexts(dynamic)).toEqual(["  Read 1 file (ctrl+o to expand)"]);        // settled geometry: two-space leader, no `…`
    expect(dynamic[0]!.id).toBe("group:read-1:unclosed-row");                        // distinct from the published `:row`
    expect(dynamic.some((i) => i.kind === "gutter-block")).toBe(false);              // R3.7: the ⎿ hint stays ACTIVE-only
  });

  it("switches the dynamic row from active to settled the moment its last member completes", () => {
    const running = built(call("read-1", "Read", { file_path: "/work/a.ts" }), call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-1"));
    const live = projectPending(running, context);                                  // one member settled, one still running
    expect(lineTexts(live)).toEqual(["⏺ Reading 2 files… (ctrl+o to expand)"]);     // the run counts BOTH, not just the open one
    expect(live.filter((i) => i.kind === "gutter-block")).toHaveLength(1);          // R3.7: the ⎿ hint, active-only
    const settled = built(call("read-1", "Read", { file_path: "/work/a.ts" }), call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-1"), result("read-2"));
    const done = projectPending(settled, context);
    expect(lineTexts(done)).toEqual(["  Read 2 files (ctrl+o to expand)"]);
    expect(done.filter((i) => i.kind === "gutter-block")).toEqual([]);
  });

  it("hands the row to Static exactly once when a breaker closes the run, and drops the dynamic copy", () => {
    const open = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"));
    const dynamic = groupRows(projectPending(open, context))[0] as { line: RenderLine };
    for (const breaker of [prose("done"), { type: "user", uuid: "u-next", message: { content: [{ type: "text", text: "next" }] } } as Record<string, unknown>]) {
      const closed = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), breaker);
      const published = groupRows(projectCompact(closed, context));
      expect(published).toHaveLength(1);
      expect(published[0]!.id).toBe("group:read-1:row");
      expect((published[0] as { line: RenderLine }).line).toEqual(dynamic.line);     // same row, byte for byte — only the id differs
      expect(projectPending(closed, context)).toEqual([]);                            // the dynamic copy is gone the same render
    }
  });

  it("never shows a run twice: a published group is dropped from the dynamic stream even while a later call runs", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("mid"),
      call("read-2", "Read", { file_path: "/work/b.ts" }));
    expect(lineTexts(groupRows(projectCompact(doc, context)))).toEqual(["  Read 1 file (ctrl+o to expand)"]);
    expect(lineTexts(groupRows(projectPending(doc, context)))).toEqual(["⏺ Reading 1 file… (ctrl+o to expand)"]);
  });

  it("keeps a standalone tool and a non-collapsible open call out of each other's way", () => {
    const doc = built(call("bash-1", "Bash", { command: "npm test" }), result("bash-1", "ok"), prose("mid"),
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), call("bash-2", "Bash", { command: "npm run build" }));
    expect(lineTexts(projectPending(doc, context))).toEqual(["  Read 1 file (ctrl+o to expand)", "⏺ Bash(npm run build)"]);
  });
});

// ── The blink path's memoized anchored stream ───────────────────────────────────────────────────────────
// `useChat` re-projects the transient region every 600 ms while a tool is open, and `projectPending` folds the
// WHOLE anchored stream — so an unmemoized build re-renders every retained message (markdown included) per
// blink frame. The stream depends on the document, the live theme and (since F4 Task 5) the render knobs the
// message adapter forwards, so the key is `revision() × themeGeneration() × columns × projection × verbose`;
// markdown-integration.test.tsx pins the three new components, this file the original two.
describe("F1 anchored-stream memoization", () => {
  afterEach(() => { vi.restoreAllMocks(); setTheme("auto"); });

  it("builds the anchored stream once per revision while the blink repaints on a moving clock", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    // Two consecutive frames of the same 600 ms blink: `now` moves, the document does not.
    expect(lineTexts(projectPending(doc, context))).toEqual(["⏺ Reading 1 file… (ctrl+o to expand)"]);
    expect(lineTexts(projectPending(doc, { ...context, now: 600 }))).toEqual(["  Reading 1 file… (ctrl+o to expand)"]);
    expect(spy).toHaveBeenCalledTimes(1);
    // A projection at the SAME knobs shares that entry — `projectPending` and `projectCompact` are both
    // compact/non-verbose, so the blink and the published read never rebuild for each other. F4 Task 5:
    // columns/projection/verbose ARE part of the key now (`projectMessageEntry` forwards them into
    // `renderMessage`), so a detail read at another width is a different entry, by design.
    projectCompact(doc, context);
    expect(spy).toHaveBeenCalledTimes(1);
    projectDetail(doc, { ...context, projection: "detail-all", columns: 40 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("rebuilds when a retained append changes the document, and the projection follows", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    expect(lineTexts(projectPending(doc, context))).toEqual(["⏺ Reading 1 file… (ctrl+o to expand)"]);
    doc.appendSdk("host", result("read-1"));
    expect(lineTexts(projectPending(doc, context))).toEqual(["  Read 1 file (ctrl+o to expand)"]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("rebuilds on an in-place sidecar upgrade — the mutation no entry COUNT can see", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }));
    doc.appendSdk("disk", result("read-1"));                                  // the disk copy: no structured sidecar
    const before = lineTexts(projectCompact(doc, context));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    expect(lineTexts(projectCompact(doc, context))).toEqual(before);
    expect(spy).toHaveBeenCalledTimes(0);
    // The host's live copy of the SAME uuid: deduplicated (appendSdk returns false) yet it REPLACES the retained
    // payload in place, so the entry count is untouched while what projection must render changed.
    const richer = { type: "user", uuid: "u-read-1", tool_use_result: { file: { numLines: 1 } },
      message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "body" }, { type: "text", text: "upgraded note" }] } } as Record<string, unknown>;
    const entries = doc.entries().length, revision = doc.revision();
    expect(doc.appendSdk("host", richer)).toBe(false);
    expect(doc.entries().length).toBe(entries); expect(doc.revision()).toBe(revision + 1);
    const after = lineTexts(projectCompact(doc, context));
    expect(spy).toHaveBeenCalledTimes(1);
    // F4 Task 8: the user text now arrives as the `userEchoLines` band, so the row is padded — match on the
    // row's leading content rather than on an exact element.
    expect(before.some((t) => t.startsWith("❯ upgraded note"))).toBe(false);
    expect(after.some((t) => t.startsWith("❯ upgraded note"))).toBe(true);
  });

  // The stream is NOT a pure function of the document: `renderMessage` → markdown/highlight read the LIVE
  // global theme per call (that is what makes a /theme switch color the very next paint). A `setTheme()`
  // touches no document, so `revision()` alone would serve the old theme's colors from cache.
  it("rebuilds when setTheme() repaints under an untouched document", () => {
    const doc = built(prose("use `x` now"));
    const codeColors = () => projectCompact(doc, context).filter((i) => i.kind === "line")
      .flatMap((i) => (i as { line: RenderLine }).line.segments ?? []).flatMap((s) => (s.color === undefined ? [] : [s.color]));
    setTheme("dark");
    const dark = codeColors();
    expect(dark).toEqual([resolveThemeColor(THEMES.dark.suggestion)]);
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    setTheme("light");
    expect(codeColors()).toEqual([resolveThemeColor(THEMES.light.suggestion)]);   // inline code follows the new theme
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // F4 Task 10b fix round. The stream RENDERS the expand hint (every group row, fold marker and search
  // sentence carries the chord), so a rebind that touches no document must not be served the old sentence
  // out of cache — the stale-hint dishonesty F2 exists to end. Both of Task 10b's rebind tests install the
  // keymap layer BEFORE the first frame, so neither ever creates the stale entry this one creates on purpose.
  it("keys on the expand hint: a mid-session rebind re-projects an UNTOUCHED document", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
    const first = groupRows(projectCompact(doc, { ...context, expandHint: "(ctrl+o to expand)" }));
    expect((first[0] as { line: RenderLine }).line.text).toBe("  Read 1 file (ctrl+o to expand)");
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    // Same document, same revision, same theme, same width — only the live keymap moved.
    const after = groupRows(projectCompact(doc, { ...context, expandHint: "(ctrl+t to expand)" }));
    expect((after[0] as { line: RenderLine }).line.text).toBe("  Read 1 file (ctrl+t to expand)");
    expect(spy).toHaveBeenCalledTimes(1);
    // …and an UNBIND drops the clause on that same untouched document.
    expect((groupRows(projectCompact(doc, { ...context, expandHint: "" }))[0] as { line: RenderLine }).line.text).toBe("  Read 1 file");
  });

  // F4 final review, finding 4. ABSENT and EMPTY are two DIFFERENT renders of the hint slot — absent means
  // "nothing threaded", and the producers print `EXPAND_HINT_FALLBACK`; empty means the chord is UNBOUND and
  // nothing may be printed. A key that folded both into `""` served the cached fallback sentence to the
  // projection that had just asked for silence, i.e. cached the dead-chord dishonesty.
  // Driven through a folded `bash-output` sentinel, which is a MESSAGE-entry projection and therefore the
  // thing this cache actually holds — the group row above is refolded on every call and would pass the pin
  // with the key collapsed, proving nothing.
  it("distinguishes an ABSENT expand hint from an explicitly UNBOUND one in the cache key", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
    const doc = built({ type: "user", message: { content: [{ type: "text", text: `<bash-stdout>${body}</bash-stdout>` }] } } as Record<string, unknown>);
    const marker = (options: Parameters<typeof projectCompact>[1]) => lineTexts(projectCompact(doc, options)).find((t) => t.includes("+37 lines"));
    const { expandHint: _drop, ...absent } = { ...context, expandHint: undefined as string | undefined };
    expect(marker(absent)).toBe("     … +37 lines (ctrl+o to expand)");        // absent ⇒ EXPAND_HINT_FALLBACK
    // Same document, same revision, same theme, same width — only the hint went from absent to UNBOUND.
    expect(marker({ ...context, expandHint: "" })).toBe("     … +37 lines");
    // …and back, which is the direction that proves neither state overwrote the other's cache entry.
    expect(marker(absent)).toBe("     … +37 lines (ctrl+o to expand)");
  });

  it("still cache-hits when neither the document nor the theme moved", () => {
    setTheme("light");
    const doc = built(prose("use `x` now"));
    const before = lineTexts(projectCompact(doc, context));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    expect(lineTexts(projectCompact(doc, context))).toEqual(before);
    expect(spy).toHaveBeenCalledTimes(0);
  });
});

// F3 Task 3: the thinking clock reaches the group row. The durations are LIVE-ONLY state (P82: the wire
// carries no timestamps and the disk transcript none at all), so they travel as a projection-time map
// keyed by the sdk message identity — deliberately OUTSIDE the anchored cache, which is keyed by document
// revision × theme and would otherwise serve a stale clause for a whole blink epoch.
describe("F3 thought clause on the collapsed group row", () => {
  afterEach(() => { vi.restoreAllMocks(); setTheme("auto"); });
  /** The ubiquitous live shape: ONE assistant message whose first block is the thinking that preceded the
   *  call it carries (upstream `Ae_` reads exactly that first block). */
  const thinkingCall = (id: string, input: unknown, messageId: string, thinking: string) =>
    ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "thinking", thinking, signature: "sig" }, { type: "tool_use", id, name: "Read", input }] } }) as Record<string, unknown>;
  const thoughtMs = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it("renders `Thought for Ns` FIRST on the group that follows the thinking message", () => {
    const doc = built(thinkingCall("read-1", { file_path: "/work/a.ts" }, "m1", "Checking the config"), result("read-1"), prose("done"));
    const rows = groupRows(projectCompact(doc, { ...context, thoughtMs: thoughtMs({ "message:m1": 3200 }) }));
    expect((rows[0] as { line: RenderLine }).line.text).toBe("  Thought for 3s, read 1 file (ctrl+o to expand)");
  });

  it("renders NO clause for the same document with no map entry — the replay/disk-bootstrap rule, for free", () => {
    const doc = built(thinkingCall("read-1", { file_path: "/work/a.ts" }, "m1", "Checking the config"), result("read-1"), prose("done"));
    expect((groupRows(projectCompact(doc, context))[0] as { line: RenderLine }).line.text).toBe("  Read 1 file (ctrl+o to expand)");
    const other = { ...context, thoughtMs: thoughtMs({ "message:someone-else": 9000 }) };
    expect((groupRows(projectCompact(doc, other))[0] as { line: RenderLine }).line.text).toBe("  Read 1 file (ctrl+o to expand)");
  });

  it("never enters the anchored cache: the SAME document at the SAME revision follows a moving duration", () => {
    const doc = built(thinkingCall("read-1", { file_path: "/work/a.ts" }, "m1", "Checking the config"));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    const at = (ms: number) => lineTexts(projectPending(doc, { ...context, thoughtMs: thoughtMs({ "message:m1": ms }) }));
    expect(at(3200)).toEqual(["⏺ Thinking for 3s, reading 1 file… (ctrl+o to expand)"]);
    expect(at(9000)).toEqual(["⏺ Thinking for 9s, reading 1 file… (ctrl+o to expand)"]);
    expect(spy).toHaveBeenCalledTimes(1);                    // the stream itself was still built once
  });

  it("requires the FIRST content block to be non-blank thinking (upstream `Ae_`)", () => {
    const trailing = { type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/work/a.ts" } }, { type: "thinking", thinking: "after" }] } } as Record<string, unknown>;
    const blank = thinkingCall("read-2", { file_path: "/work/b.ts" }, "m2", "   \n ");
    const doc = built(trailing, result("read-1"), blank, result("read-2"), prose("done"));
    const rows = groupRows(projectCompact(doc, { ...context, thoughtMs: thoughtMs({ "message:m1": 3200, "message:m2": 4000 }) }));
    expect((rows[0] as { line: RenderLine }).line.text).toBe("  Read 2 files (ctrl+o to expand)");
  });
  it("spends one message's duration ONCE, however many frames that message arrived as", () => {
    // P82: the engine emits one assistant frame per content block and they SHARE a `message.id`, while
    // LiveTurn already sums every thinking block of that id — so two thinking frames of one message must
    // not book the same total twice.
    const thinkingFrame = (uuid: string, thinking: string) =>
      ({ type: "assistant", parent_tool_use_id: null, uuid, message: { id: "m1", content: [{ type: "thinking", thinking, signature: "sig" }] } }) as Record<string, unknown>;
    const doc = built(thinkingFrame("f1", "first"), thinkingFrame("f2", "second"),
      call("read-1", "Read", { file_path: "/work/a.ts" }, "m1"), result("read-1"), prose("done"));
    const rows = groupRows(projectCompact(doc, { ...context, thoughtMs: thoughtMs({ "message:m1": 3200 }) }));
    expect((rows[0] as { line: RenderLine }).line.text).toBe("  Thought for 3s, read 1 file (ctrl+o to expand)");
  });
});

// ── F3 Task 4: the pending region's two time-dependent behaviors ────────────────────────────────────────
// Both live in `FoldPendingState` (its own unit tests own the state machine); these pin the SEAM — that the
// projection consults it, only for the dynamic forms, and renders the italic variant the way R4.7 step 5
// describes. The counters ratchet (R3.2) because our counts genuinely drop mid-run: R1.5 counts distinct
// `file_path`s OR bare read operations and only one survives, so a `Read` landing after two `Bash("cat …")`
// reads takes the count from 2 back to 1.
describe("F3 latch-to-max and the throttled hint (R3.2, R4.7)", () => {
  const cat = (id: string, file: string) => call(id, "Bash", { command: `cat ${file}` });
  const at = (state: FoldPendingState, now = 0) => ({ ...context, pending: state, now });
  /** The live shape again (see the Task 3 block): ONE assistant message whose first block is the thinking
   *  that preceded the read it carries — the only route by which a group acquires `latestThinkingSummary`. */
  const thinkingCallRead = (id: string, file: string, messageId: string, thinking: string) =>
    ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "thinking", thinking, signature: "sig" }, { type: "tool_use", id, name: "Read", input: { file_path: file } }] } }) as Record<string, unknown>;

  it("never lets the live row's read count drop when R1.5's quirk recounts the run", () => {
    const state = new FoldPendingState({ now: () => 0 });
    const doc = built(cat("b1", "a.ts"));
    expect(lineTexts(projectPending(doc, at(state)))).toEqual(["⏺ Reading 1 file… (ctrl+o to expand)"]);
    doc.appendSdk("host", result("b1")); doc.appendSdk("host", cat("b2", "b.ts"));
    expect(lineTexts(projectPending(doc, at(state)))).toEqual(["⏺ Reading 2 files… (ctrl+o to expand)"]);
    doc.appendSdk("host", result("b2")); doc.appendSdk("host", call("read-1", "Read", { file_path: "/work/c.ts" }));
    // The would-be count is 1 now (one distinct file_path beats two operations) — the latch holds 2.
    expect(lineTexts(projectPending(doc, at(state)))).toEqual(["⏺ Reading 2 files… (ctrl+o to expand)"]);
    expect(lineTexts(projectPending(doc, context))).toEqual(["⏺ Reading 1 file… (ctrl+o to expand)"]);   // control: no state, the drop is real
  });

  it("keys the latch on the run's ANCHOR, so a second run starts from its own zero", () => {
    const state = new FoldPendingState({ now: () => 0 });
    const first = built(cat("b1", "a.ts"), result("b1"), cat("b2", "b.ts"), result("b2"));
    expect(lineTexts(projectPending(first, at(state)))).toEqual(["  Read 2 files (ctrl+o to expand)"]);   // unclosed form: latched too
    const second = built(cat("b1", "a.ts"), result("b1"), cat("b2", "b.ts"), result("b2"), prose("done"), call("read-9", "Read", { file_path: "/work/z.ts" }));
    expect(lineTexts(projectPending(second, at(state)))).toContain("⏺ Reading 1 file… (ctrl+o to expand)");
  });

  it("publishes the LATCHED maximum — the on-screen row never downgrades when the run settles (t4 review)", () => {
    // Upstream's ratchet assignment is unconditional across renders of the mounted row (`Ima` L427896),
    // so settling keeps the max; only a fresh mount (replay) recomputes. `peek` reads the same maximum
    // without writing, so sweeping history cannot create latch entries.
    const state = new FoldPendingState({ now: () => 0 });
    const doc = built(cat("b1", "a.ts"), result("b1"), cat("b2", "b.ts"), result("b2"));
    expect(lineTexts(projectPending(doc, at(state)))).toEqual(["  Read 2 files (ctrl+o to expand)"]);
    doc.appendSdk("host", call("read-1", "Read", { file_path: "/work/c.ts" })); doc.appendSdk("host", result("read-1")); doc.appendSdk("host", prose("done"));
    expect(lineTexts(groupRows(projectCompact(doc, at(state))))).toEqual(["  Read 2 files (ctrl+o to expand)"]);
    // A replay with NO latch state (fresh mount) recomputes honestly — and gains no state from the sweep.
    const fresh = new FoldPendingState({ now: () => 0 });
    expect(lineTexts(groupRows(projectCompact(doc, at(fresh))))).toEqual(["  Read 1 file (ctrl+o to expand)"]);
    expect(lineTexts(groupRows(projectCompact(doc, at(fresh))))).toEqual(["  Read 1 file (ctrl+o to expand)"]);
  });

  it("holds the ⎿ hint for 700 ms after each accepted change (R4.7 step 4)", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    const doc = built(cat("b1", "a.ts"));
    const hint = () => bodyOf(projectPending(doc, at(state, clock.now))).map((l) => l.text);
    expect(hint()).toEqual(["$ cat a.ts"]);
    doc.appendSdk("host", result("b1")); doc.appendSdk("host", cat("b2", "b.ts"));
    clock.now = 300; expect(hint()).toEqual(["$ cat a.ts"]);      // flapped inside the window
    clock.now = 699; expect(hint()).toEqual(["$ cat a.ts"]);
    clock.now = 700; expect(hint()).toEqual(["$ cat b.ts"]);
    expect(bodyOf(projectPending(doc, context)).map((l) => l.text)).toEqual(["$ cat b.ts"]);   // control: undebounced
  });

  it("renders a fresh thinking summary italic in the hint slot, then hands the slot back (R4.7 step 5)", () => {
    const clock = { now: 0 };
    const state = new FoldPendingState({ now: () => clock.now });
    const doc = built(thinkingCallRead("read-1", "/work/a.ts", "m1", "weighing\n  the   options"));
    const ctx = () => ({ ...at(state, clock.now), thoughtMs: new Map([["message:m1", 3200]]) });
    const grey = resolveThemeColor(themeTokens().inactive);
    const items = projectPending(doc, ctx());
    expect(items[1]).toEqual({
      kind: "gutter-block", id: "group:read-1:pending-hint", gutter: GROUP_HINT_GUTTER, gutterStyle: { color: grey, dim: true },
      body: [{ text: "weighing the options", dim: true, color: grey, italic: true }],
    });
    clock.now = 2999;
    expect(bodyOf(projectPending(doc, ctx())).map((l) => l.text)).toEqual(["weighing the options"]);
    clock.now = 3000;
    expect(bodyOf(projectPending(doc, ctx()))).toEqual([{ text: "a.ts", dim: true, color: grey }]);   // the ordinary hint, no italic
  });

  it("clamps a long summary to PAH = 10 rendered lines at `columns − 5`, with a trailing ellipsis", () => {
    const long = Array.from({ length: 40 }, (_, i) => `sentence number ${i}`).join(" ");
    const state = new FoldPendingState({ now: () => 0 });
    const doc = built(thinkingCallRead("read-1", "/work/a.ts", "m1", long));
    const body = bodyOf(projectPending(doc, { ...at(state), columns: 25, thoughtMs: new Map([["message:m1", 3200]]) }));
    expect(body).toHaveLength(1);
    expect(body[0]!.text.endsWith("…")).toBe(true);
    expect(body[0]!.text.startsWith("sentence number 0 sentence number 1")).toBe(true);
    expect(wrapAnsi(body[0]!.text, 20, { trim: false, hard: true }).split("\n")).toHaveLength(10);
    // Short enough to fit is left exactly as it is — upstream `OAH` returns the input untouched below the clamp.
    expect(clampHintText("short enough", 20, 10)).toBe("short enough");
    expect(clampHintText(long, 0, 10)).toBe(long);            // a degenerate width clamps nothing (`t < 1`)
  });
});

// ── F3 Task 7: the Agent unit (LT16 progress rows, LT17 the honest `Done (…)` row) ───────────────────────
// The ladder itself is `agentProgress.test.ts`'s; these pin what reaches the screen — that an open Agent
// shows `Initializing…` then its last three inner rows plus the hidden-count marker, that EVERY terminal row
// upstream `Vha` paints is a `⎿` GUTTER row, and that the nested rows the compact unit folds away are exactly
// what ctrl+o expands to.
//
// bundle `Vha` 429640, direct read — census 01#153 CORRECTED: the Done row is `Rr height:1` (the same `⎿`
// gutter component every tool result uses) wrapping the synthetic assistant message with `shouldShowDot:!1`,
// i.e. the bullet is explicitly SUPPRESSED. The `  (ctrl+o to expand)` hint is a SIBLING dim line after that
// block (`!i&&h dimColor ["  ",Ug]`), not a segment on the row. Same for the two launch rows.
describe("F3 Task 7: Agent progress and the Done row", () => {
  const agent = (id = "agent-1", description = "review the diff") =>
    ({ type: "assistant", parent_tool_use_id: null, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Agent", input: { description, prompt: "do it" } }] } }) as Record<string, unknown>;
  const childCall = (id: string, file: string, parent = "agent-1") =>
    ({ type: "assistant", parent_tool_use_id: parent, message: { id: `mc-${id}`, content: [{ type: "tool_use", id, name: "Read", input: { file_path: file } }] } }) as Record<string, unknown>;
  const childResult = (id: string, parent = "agent-1") =>
    ({ type: "user", uuid: `uc-${id}`, parent_tool_use_id: parent, message: { content: [{ type: "tool_result", tool_use_id: id, content: "one\ntwo", is_error: false }] } }) as Record<string, unknown>;
  const agentResult = (sidecar?: unknown, id = "agent-1") =>
    ({ type: "user", uuid: `ur-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content: "the report", is_error: false }] }, ...(sidecar === undefined ? {} : { tool_use_result: sidecar }) }) as Record<string, unknown>;
  const COMPLETED = { agentId: "a1", agentType: "reviewer", status: "completed", totalToolUseCount: 3, totalTokens: 24100, totalDurationMs: 72000 };
  const ASYNC = { agentId: "a1", isAsync: true, outputFile: "/tmp/o", canReadOutputFile: true, status: "async_launched" };
  const children = (n: number) => Array.from({ length: n }, (_, i) => [childCall(`c-${i}`, `/work/f${i}.ts`), childResult(`c-${i}`)]).flat();
  // A file-tool header carries its OSC-8 target; the rows here are about NESTING, so compare the labels.
  const rowTexts = (items: readonly RenderItem[]) => lineTexts(items).map((t) => t.replace(/\x1b]8;;[^\x07]*\x07/g, ""));

  it("shows dim `Initializing…` while the agent has produced no inner call yet", () => {
    const items = projectPending(built(agent()), context);
    expect(lineTexts(items)).toEqual(["⏺ Agent(review the diff)"]);
    expect(items[1]).toMatchObject({ kind: "gutter-block", gutter: TOOL_RESULT_GUTTER, body: [{ text: "Initializing…", dim: true }] });
  });

  it("shows the last THREE inner rows plus the hidden-count marker (upstream zVp = 3)", () => {
    const items = projectPending(built(agent(), ...children(5)), context);
    expect(rowTexts(items)).toEqual([
      "⏺ Agent(review the diff)",
      "  ⏺ Read(f2.ts)", "  ⏺ Read(f3.ts)", "  ⏺ Read(f4.ts)",
      "  … +2 tool uses (ctrl+o to expand)",
    ]);
    const marker = items.at(-1) as { line: RenderLine };
    expect(marker.line).toEqual({ text: "  … +2 tool uses (ctrl+o to expand)", dim: true });
    expect(items.every((i) => i.kind === "line")).toBe(true);                    // condensed: no inner result bodies
    // Exactly three or fewer inner calls earn no marker at all.
    expect(rowTexts(projectPending(built(agent(), ...children(3)), context))).toHaveLength(4);
  });

  it("renders completion as a `⎿` GUTTER row with the bullet suppressed, plus a sibling dim hint line", () => {
    const doc = built(agent(), ...children(3), agentResult(COMPLETED), prose("summary"));
    const items = projectCompact(doc, context);
    // bundle Vha 429652, shouldShowDot:false — census 01#153 corrected: no `⏺` on the Done row.
    expect(lineTexts(items)).not.toContain("⏺ Done (3 tool uses · 24.1k tokens · 1m 12s)  (ctrl+o to expand)");
    const done = items.find((i) => i.kind === "gutter-block" && i.body.some((l) => l.text.startsWith("Done (")))!;
    expect(done).toMatchObject({ kind: "gutter-block", gutter: TOOL_RESULT_GUTTER, body: [{ text: "Done (3 tool uses · 24.1k tokens · 1m 12s)" }] });
    expect(bodyOf(items).map((l) => l.text)).toEqual(["Done (3 tool uses · 24.1k tokens · 1m 12s)"]);   // the agent's own report is not dumped
    // The hint is its OWN row after the block (`!i&&h dimColor ["  ",Ug]`), two leading spaces, no bullet.
    expect(items[items.indexOf(done) + 1]).toMatchObject({ kind: "line", line: { text: "  (ctrl+o to expand)", dim: true } });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);             // ids stay unique through `reid`
  });

  it("falls to task_notification totals when the sidecar is a parallel dispatch's `async_launched`", () => {
    const doc = built(agent(), ...children(2), agentResult(ASYNC), prose("summary"));
    const meta = new Map([["agent-1", { notify: { total_tokens: 4195, tool_uses: 2, duration_ms: 4484 } }]]);
    expect(bodyOf(projectCompact(doc, { ...context, agentMeta: meta })).map((l) => l.text)).toContain("Done (2 tool uses · 4.2k tokens · 4s)");
    // With no notification yet, an async launch says exactly that — it is NOT done, and a derived
    // `Done (0 tool uses)` would be a lie (census 429615). Gutter row, no bullet (bundle Vha 429646).
    const launched = projectCompact(doc, context);
    expect(bodyOf(launched).map((l) => l.text)).toEqual(["Backgrounded agent (↓ to manage · ctrl+o to expand)"]);
    expect(lineTexts(launched).some((t) => t.includes("Backgrounded"))).toBe(false);
  });

  it("renders a `remote_launched` cloud dispatch as its own gutter row with the dim task id and url", () => {
    const remote = { agentId: "a1", status: "remote_launched", taskId: "task_42", sessionUrl: "https://cloud/x" };
    const items = projectCompact(built(agent(), agentResult(remote), prose("summary")), context);
    const row = bodyOf(items)[0]!;                                               // bundle Vha 429641
    expect(row.text).toBe("Cloud agent launched · task_42 · https://cloud/x");
    expect(row.segments).toEqual([{ text: "Cloud agent launched " }, { text: "· task_42 · https://cloud/x", dim: true }]);
  });

  it("derives the row from the children and the dispatch→result clock, with NO token clause", () => {
    const doc = built(agent(), ...children(2), agentResult(), prose("summary"));
    const meta = new Map([["agent-1", { dispatchedAt: 1000, resultAt: 35000 }]]);
    expect(bodyOf(projectCompact(doc, { ...context, agentMeta: meta, now: 999999 })).map((l) => l.text)).toContain("Done (2 tool uses · 34s)");
  });

  it("never fabricates `Done (0 tool uses)`: an unrecognised terminal shape with no children renders no typed row", () => {
    // `Vha` returns null for every status it does not recognise (bundle 429649, `if(e.status!=="completed")
    // return null`), and the derived rung has nothing to count — so this falls through to the generic body.
    const doc = built(agent(), agentResult(), prose("summary"));
    const items = projectCompact(doc, context);
    expect([...lineTexts(items), ...bodyOf(items).map((l) => l.text)].some((t) => t.includes("Done ("))).toBe(false);
    expect(bodyOf(items).map((l) => l.text)).toEqual(["the report"]);
    const unknown = built(agent(), agentResult({ agentId: "a1", status: "teammate_spawned" }), prose("summary"));
    expect(bodyOf(projectCompact(unknown, context)).map((l) => l.text).some((t) => t.includes("Done ("))).toBe(false);
  });

  it("expands to the nested rows in the detail projections, and drops the hint there (`Bg` is null in transcript mode)", () => {
    const doc = built(agent(), ...children(2), agentResult(COMPLETED), prose("summary"));
    const detail = projectDetail(doc, { ...context, projection: "detail-collapsed" });
    expect(rowTexts(detail)).toEqual(["⏺ Agent(review the diff)", "  ⏺ Read(f0.ts)", "  ⏺ Read(f1.ts)", "summary"]);
    expect(bodyOf(detail).map((l) => l.text)).toEqual(["Done (3 tool uses · 24.1k tokens · 1m 12s)", "Read 2 lines", "Read 2 lines"]);
    expect(rowTexts(detail).some((t) => t.includes("ctrl+o to expand"))).toBe(false);
    expect(rowTexts(projectCompact(doc, context))).not.toContain("  ⏺ Read(f0.ts)");
    expect(new Set(detail.map((i) => i.id)).size).toBe(detail.length);
  });
});

// ── F3 Task 8: same-message agent batches (LT3) ─────────────────────────────────────────────────────────
// Upstream Mechanism A (`bdf` 452545 → `Xha` 429745): ≥2 tool_use blocks sharing ONE assistant message AND
// one tool name collapse into a single unit — an animated header plus one condensed row per agent, with the
// members' `tool_result` frames absorbed. The publication rule is the load-bearing half: Static is
// append-only, so the unit publishes ONLY once every member has a result; until then the WHOLE batch lives
// in the pending region and its members are inert to Static, exactly like the trailing fold run.
describe("F3 Task 8: same-message agent batches", () => {
  const agents = (specs: readonly { id: string; description?: string; input?: Record<string, unknown> }[]) =>
    ({ type: "assistant", parent_tool_use_id: null, message: { id: `m-${specs.map((s) => s.id).join("-")}`, content: specs.map((s) => ({ type: "tool_use", id: s.id, name: "Agent", input: { description: s.description ?? `do ${s.id}`, prompt: "p", ...s.input } })) } }) as Record<string, unknown>;
  const settle = (id: string, sidecar?: unknown, isError = false) =>
    ({ type: "user", uuid: `ur-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content: "the report", is_error: isError }] }, ...(sidecar === undefined ? {} : { tool_use_result: sidecar }) }) as Record<string, unknown>;
  const childOf = (parent: string, id: string, file: string) =>
    ({ type: "assistant", parent_tool_use_id: parent, message: { id: `mc-${id}`, content: [{ type: "tool_use", id, name: "Read", input: { file_path: file } }] } }) as Record<string, unknown>;
  const COMPLETED = { agentId: "a1", status: "completed", totalToolUseCount: 3, totalTokens: 24100, totalDurationMs: 72000 };
  const ASYNC = { agentId: "a1", isAsync: true, status: "async_launched" };
  const pair = () => agents([{ id: "ag-1", description: "review the diff" }, { id: "ag-2", description: "write the tests" }]);

  it("collapses two running same-message Agents into ONE active unit, with no individual Agent rows", () => {
    const items = projectPending(built(pair(), childOf("ag-1", "c-1", "/work/a.ts")), context);
    expect(lineTexts(items)).toEqual([
      "⏺ Running 2 agents… (ctrl+o to expand)",
      "   ├ review the diff · 1 tool use", "   │ ⎿  Read",
      "   └ write the tests · 0 tool uses", "     ⎿  Initializing…",
    ]);
    expect(lineTexts(items).some((t) => t.startsWith("⏺ Agent("))).toBe(false);   // Task 7's standalone row is gone
    expect(items[0]!.id).toBe("agents:ag-1,ag-2:pending-header");
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    // R4.1's blink, the `ile` model: the leader GLYPH alone blinks on the 600 ms period while unresolved.
    expect(lineTexts(projectPending(built(pair()), { ...context, now: 600 }))[0]).toBe("  Running 2 agents… (ctrl+o to expand)");
    expect(lineTexts(projectPending(built(pair()), { ...context, platform: "linux" }))[0]!.startsWith("● ")).toBe(true);
  });

  it("forms ONE unit when the parallel dispatch arrives SPLIT across frames — one API id, two uuids (t8 review)", () => {
    // The live-wire shape P82/P83 make normal: one frame per content block, so two same-message Agent
    // dispatches land as two frames with distinct uuids sharing one `message.id`. Retention keeps both
    // (identity prefers uuid); the batch key must be the API id or the unit never assembles live.
    const frameA = { type: "assistant", parent_tool_use_id: null, uuid: "fa-1", message: { id: "m-split", content: [{ type: "tool_use", id: "ag-1", name: "Agent", input: { description: "review the diff", prompt: "p" } }] } } as Record<string, unknown>;
    const frameB = { type: "assistant", parent_tool_use_id: null, uuid: "fb-2", message: { id: "m-split", content: [{ type: "tool_use", id: "ag-2", name: "Agent", input: { description: "write the tests", prompt: "p" } }] } } as Record<string, unknown>;
    const items = projectPending(built(frameA, frameB), context);
    expect(lineTexts(items)[0]).toBe("⏺ Running 2 agents… (ctrl+o to expand)");
    expect(items[0]!.id).toBe("agents:ag-1,ag-2:pending-header");
    expect(lineTexts(items).some((t) => t.startsWith("⏺ Agent("))).toBe(false);
  });

  it("publishes NOTHING while one member is still open — no partial unit, no duplicate", () => {
    const doc = built(pair(), settle("ag-1", COMPLETED));
    expect(projectCompact(doc, context).filter((i) => i.id.startsWith("agents:"))).toEqual([]);
    const pending = lineTexts(projectPending(doc, context));
    expect(pending[0]).toBe("⏺ Running 2 agents… (ctrl+o to expand)");            // one unit, still active
    expect(pending.filter((t) => t.includes("Running 2 agents"))).toHaveLength(1);
    expect(pending).toContain("   ├ review the diff · 3 tool uses · 24.1k tokens");
    expect(pending).toContain("   │ ⎿  Done");
    expect(pending).toContain("     ⎿  Initializing…");
    // The absorbed member `tool_result` renders nothing of its own, in either region.
    expect([...pending, ...lineTexts(projectCompact(doc, context))].some((t) => t.includes("the report"))).toBe(false);
  });

  it("publishes `2 agents finished` exactly once when the last member resolves, and drops the pending copy", () => {
    const doc = built(pair(), settle("ag-1", COMPLETED), settle("ag-2", COMPLETED), prose("summary"));
    const published = projectCompact(doc, context).filter((i) => i.id.startsWith("agents:"));
    expect(lineTexts(published)).toEqual([
      "⏺ 2 agents finished (ctrl+o to expand)",
      "   ├ review the diff · 3 tool uses · 24.1k tokens", "   │ ⎿  Done",
      "   └ write the tests · 3 tool uses · 24.1k tokens", "     ⎿  Done",
    ]);
    expect(published[0]!.id).toBe("agents:ag-1,ag-2:header");                     // membership-derived, no sequence
    expect(projectPending(doc, context)).toEqual([]);
    // The unit anchors at the LAST member result, so it publishes after anything that landed between them.
    const interleaved = built(pair(), settle("ag-1", COMPLETED), prose("mid"), settle("ag-2", COMPLETED), prose("end"));
    const texts = lineTexts(projectCompact(interleaved, context));
    expect(texts.indexOf("mid")).toBeLessThan(texts.indexOf("⏺ 2 agents finished (ctrl+o to expand)"));
  });

  it("paints the header glyph in the error colour when any absorbed result is an error", () => {
    const bad = built(pair(), settle("ag-1", COMPLETED, true), settle("ag-2", COMPLETED), prose("done"));
    const ok = built(pair(), settle("ag-1", COMPLETED), settle("ag-2", COMPLETED), prose("done"));
    const glyph = (doc: TranscriptDocument) => ((projectCompact(doc, context).find((i) => i.id.endsWith(":header")) as { line: RenderLine }).line.segments ?? [])[0];
    expect(glyph(bad)).toEqual({ text: "⏺", color: resolveThemeColor(themeTokens().error) });
    expect(glyph(ok)).toEqual({ text: "⏺", color: resolveThemeColor(themeTokens().success) });
  });

  it("qualifies the noun only when every member shares one non-default subagent_type", () => {
    const typed = built(agents([{ id: "ag-1", input: { subagent_type: "reviewer" } }, { id: "ag-2", input: { subagent_type: "reviewer" } }]));
    expect(lineTexts(projectPending(typed, context))[0]).toBe("⏺ Running 2 reviewer agents… (ctrl+o to expand)");
    const mixed = built(agents([{ id: "ag-1", input: { subagent_type: "reviewer" } }, { id: "ag-2", input: { subagent_type: "writer" } }]));
    expect(lineTexts(projectPending(mixed, context))[0]).toBe("⏺ Running 2 agents… (ctrl+o to expand)");
    // hideType=false: the per-agent row leads with the TYPE and parenthesizes the description (`jla` 422185).
    expect(lineTexts(projectPending(mixed, context))[1]).toBe("   ├ reviewer (do ag-1) · 0 tool uses");
  });

  it("renders an all-async resolved batch as the background-launch form, with no ctrl+o hint", () => {
    const doc = built(pair(), settle("ag-1", ASYNC), settle("ag-2", ASYNC), prose("done"));
    expect(lineTexts(projectCompact(doc, context).filter((i) => i.id.startsWith("agents:")))).toEqual([
      "⏺ 2 background agents launched (↓ to manage)",
      "   ├ review the diff", "   └ write the tests",           // `jla`: no totals clause and no ⎿ row once async+resolved
    ]);
  });

  it("UNGROUPS in the verbose projection — that is what the batch's ctrl+o expands to", () => {
    // `bdf`'s very first statement is `if (r) return { messages: e }` (452545): verbose never groups. The
    // gate is therefore `!verbose`, NOT the fold run's `compact && !verbose` — the collapsed detail view
    // keeps the batch, and only the fully verbose one hands each member back to Task 7's standalone unit.
    const doc = built(pair(), settle("ag-1", COMPLETED), settle("ag-2", COMPLETED), prose("summary"));
    const all = projectDetail(doc, { ...context, projection: "detail-all" });
    expect(all.some((i) => i.id.startsWith("agents:"))).toBe(false);
    expect(lineTexts(all)).toContain("⏺ Agent(review the diff)");
    expect(lineTexts(all)).toContain("⏺ Agent(write the tests)");
    const collapsed = projectDetail(doc, { ...context, projection: "detail-collapsed" });
    expect(lineTexts(collapsed)[0]).toBe("⏺ 2 agents finished");                  // grouped, and `Bg` is null here
  });

  it("leaves a SINGLE Agent in a message on Task 7's standalone path, untouched", () => {
    const one = { type: "assistant", parent_tool_use_id: null, message: { id: "m-solo", content: [{ type: "tool_use", id: "solo", name: "Agent", input: { description: "review the diff", prompt: "p" } }] } } as Record<string, unknown>;
    const doc = built(one, settle("solo", COMPLETED), prose("summary"));
    const items = projectCompact(doc, context);
    expect(items.some((i) => i.id.startsWith("agents:"))).toBe(false);
    expect(lineTexts(items)).toContain("⏺ Agent(review the diff)");
    expect(bodyOf(items).map((l) => l.text)).toEqual(["Done (3 tool uses · 24.1k tokens · 1m 12s)"]);
  });

  it("never batches an Agent with a differently-named tool that shared its assistant message", () => {
    const mixedMessage = { type: "assistant", parent_tool_use_id: null, message: { id: "m-mixed", content: [
      { type: "tool_use", id: "ag-1", name: "Agent", input: { description: "review the diff", prompt: "p" } },
      { type: "tool_use", id: "bash-1", name: "Bash", input: { command: "npm test" } },
    ] } } as Record<string, unknown>;
    const items = projectPending(built(mixedMessage), context);
    expect(items.some((i) => i.id.startsWith("agents:"))).toBe(false);
    expect(lineTexts(items)).toContain("⏺ Agent(review the diff)");
    expect(lineTexts(items)).toContain("⏺ Bash(npm test)");
  });

  it("leaves two same-message calls of any OTHER tool exactly as they were", () => {
    // The membership test is `isAgentTool`, not "≥2 of one name" — upstream groups only tools declaring
    // `renderGroupedToolUse`. Two same-message Reads must still reach Mechanism B's fold row, and two
    // same-message Bash calls must still be two ordinary standalone rows.
    const reads = { type: "assistant", parent_tool_use_id: null, message: { id: "m-reads", content: [
      { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/work/a.ts" } },
      { type: "tool_use", id: "read-2", name: "Read", input: { file_path: "/work/b.ts" } },
    ] } } as Record<string, unknown>;
    const doc = built(reads, result("read-1"), result("read-2"), prose("done"));
    expect(doc.toolEvents().every((e) => e.callSequence === 1)).toBe(true);        // genuinely one message
    expect(lineTexts(groupRows(projectCompact(doc, context)))).toEqual(["  Read 2 files (ctrl+o to expand)"]);
    const bashes = { type: "assistant", parent_tool_use_id: null, message: { id: "m-bash", content: [
      { type: "tool_use", id: "b-1", name: "Bash", input: { command: "npm test" } },
      { type: "tool_use", id: "b-2", name: "Bash", input: { command: "npm run build" } },
    ] } } as Record<string, unknown>;
    const items = projectPending(built(bashes), context);
    expect(items.some((i) => i.id.startsWith("agents:"))).toBe(false);
    expect(lineTexts(items)).toEqual(["⏺ Bash(npm test)", "⏺ Bash(npm run build)"]);
  });

  it("keeps a live-turn filter honest: a disk-bootstrapped dangling batch does not blink", () => {
    const doc = built(pair());
    expect(projectPending(doc, context, new Set(["ag-1"]))).not.toEqual([]);
    expect(projectPending(doc, context, new Set(["someone-else"]))).toEqual([]);
  });
});

// ── F3 Task 9 (LT20 / LT14): the wire truths ──────────────────────────────────────────────────────────────
// Two fidelity fixes the probe round settled, both keyed off wire facts rather than off text on screen.
describe("F3 Task 9 — the Bash background hint (LT20)", () => {
  const openBash = (id = "bash-1") => ({ id, name: "Bash", input: { command: "npm test" }, callSequence: 1, route: "top-level" as const });
  const running = (event: { name: string }) => normalizeToolResult(event as never);
  const started = (id: string, taskType: string) => new Map([[id, { taskType, startedAt: 10 }]]);
  const hint = "(ctrl+b to run in background)";

  it("renders NO hint before the call's own task_started arrives — backgrounding cannot work yet (P84)", () => {
    const event = openBash();
    const items = renderToolEvent(event, running(event), { ...options, bashHint: hint });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "line" });
  });

  it("renders the dim hint at a five-column indent once task_started says local_bash", () => {
    const event = openBash();
    const items = renderToolEvent(event, running(event), { ...options, bashHint: hint, agentMeta: started("bash-1", "local_bash") });
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({ kind: "line", id: "bash-1:background-hint", line: { text: "     (ctrl+b to run in background)", dim: true } });
  });

  it("takes its text from the caller's LIVE keymap derivation, and renders nothing when the action is unbound", () => {
    const event = openBash(), meta = started("bash-1", "local_bash");
    expect(renderToolEvent(event, running(event), { ...options, bashHint: "(ctrl+k to run in background)", agentMeta: meta })[1])
      .toMatchObject({ line: { text: "     (ctrl+k to run in background)" } });
    expect(renderToolEvent(event, running(event), { ...options, bashHint: "(ctrl+b ctrl+b (twice) to run in background)", agentMeta: meta })[1])
      .toMatchObject({ line: { text: "     (ctrl+b ctrl+b (twice) to run in background)" } });
    expect(renderToolEvent(event, running(event), { ...options, agentMeta: meta })).toHaveLength(1);
  });

  it("never hints a call that is ALREADY backgrounded — run_in_background:true short-circuits (t9 review)", () => {
    // Upstream's `in_` returns early on run_in_background (bundle 306279–306284), so its hint loop is
    // unreachable for an explicit background call — while task_started still fires local_bash for it.
    const event = { ...openBash(), input: { command: "npm test", run_in_background: true } };
    expect(renderToolEvent(event, running(event), { ...options, bashHint: hint, agentMeta: started("bash-1", "local_bash") })).toHaveLength(1);
  });

  it("is a BASH surface: an Agent's task_started never grows one, and neither does a local_agent task type", () => {
    const agent = { id: "agent-1", name: "Agent", input: { description: "explore", prompt: "go" }, callSequence: 1, route: "top-level" as const };
    const agentItems = renderToolEvent(agent, normalizeToolResult(agent as never), { ...options, bashHint: hint, agentMeta: started("agent-1", "local_agent") });
    expect(agentItems.filter((item) => item.kind === "line" && item.line.text.includes("run in background"))).toEqual([]);
    const event = openBash();
    expect(renderToolEvent(event, running(event), { ...options, bashHint: hint, agentMeta: started("bash-1", "local_agent") })).toHaveLength(1);
  });

  it("is gone the moment the call completes, and never appears in the detail projections", () => {
    const done = { ...openBash(), result: { content: "ok", isError: false, resultSequence: 2 } };
    expect(renderToolEvent(done, normalizeToolResult(done), { ...options, bashHint: hint, agentMeta: started("bash-1", "local_bash") })
      .filter((item) => item.kind === "line" && item.line.text.includes("run in background"))).toEqual([]);
    const event = openBash();
    expect(renderToolEvent(event, running(event), { ...options, projection: "detail-all", verbose: true, bashHint: hint, agentMeta: started("bash-1", "local_bash") })).toHaveLength(1);
  });

  it("reaches the screen through projectPending, under the open row it belongs to", () => {
    const doc = new TranscriptDocument();
    doc.appendSdk("host", { type: "assistant", parent_tool_use_id: null, uuid: "a1", message: { id: "m1", content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "npm test" } }] } });
    const items = projectPending(doc, { cwd: "/work", home: "/home/me", platform: "darwin", columns: 100, now: 0, bashHint: hint, agentMeta: started("bash-1", "local_bash") });
    expect(items.map((item) => (item.kind === "line" ? item.line.text : ""))).toEqual(["⏺ Bash(npm test)", "     (ctrl+b to run in background)"]);
  });
});

describe("F3 Task 9 — the interrupt sentinel user frame (LT14)", () => {
  const readPair = (n: number) => [
    { type: "assistant", parent_tool_use_id: null, uuid: `a${n}`, message: { id: `m${n}`, content: [{ type: "tool_use", id: `r${n}`, name: "Read", input: { file_path: `/work/f${n}.ts` } }] } },
    { type: "user", uuid: `u${n}`, message: { content: [{ type: "tool_result", tool_use_id: `r${n}`, content: "x" }] } },
  ];
  // P80 § A frame 2, verbatim in shape: no subtype, no marker field — the bracketed text is the ONLY signal.
  const SENTINEL = { type: "user", uuid: "sentinel", parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] } };
  const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };

  it("projects NO items: its surface is the tool row's own Interrupted prompt, not a second ❯ row", () => {
    const doc = new TranscriptDocument();
    doc.appendSdk("host", SENTINEL);
    expect(projectCompact(doc, context)).toEqual([]);
    doc.appendSdk("host", { type: "user", uuid: "real", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use] and then some" }] } });
    expect(projectCompact(doc, context).length).toBeGreaterThan(0);   // only a frame whose SOLE text IS the sentinel is suppressed
  });

  // Wave T Task 9: the CANCELLED tool_result (`F7`, L108575 → `HVo` L429119) rides the TOOL row, and a real
  // Esc during a tool call puts BOTH it and the `Wk` user frame on the wire. F3's suppression of that frame is
  // exactly what keeps the count at one — so this pins the pair, not either half alone.
  it("paints the Interrupted row exactly once for a cancelled tool call plus its suppressed sentinel frame", () => {
    const doc = new TranscriptDocument();
    doc.appendSdk("host", { type: "assistant", parent_tool_use_id: null, uuid: "ac", message: { id: "mc", content: [{ type: "tool_use", id: "bc", name: "Bash", input: { command: "sleep 90" } }] } });
    doc.appendSdk("host", { type: "user", uuid: "uc", message: { content: [{ type: "tool_result", tool_use_id: "bc", content: "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.", is_error: true }] } });
    doc.appendSdk("host", SENTINEL);
    const text = projectCompact(doc, context).flatMap((item) => (item.kind === "gutter-block" ? item.body : [item.line])).map((line) => line.text).join("\n");
    expect(text.split("Interrupted · What should Claude do instead?")).toHaveLength(2);   // split into 2 ⇒ exactly one occurrence
    expect(text).not.toContain("STOP what you are doing");                                // the engine's instruction text never reaches the transcript
  });

  it("still BREAKS the fold run, so a read run either side of it renders as two group rows", () => {
    const doc = new TranscriptDocument();
    for (const frame of [...readPair(1), ...readPair(2), SENTINEL, ...readPair(3), ...readPair(4)]) doc.appendSdk("host", frame);
    doc.appendSdk("host", { type: "assistant", parent_tool_use_id: null, uuid: "a9", message: { id: "m9", content: [{ type: "text", text: "done" }] } });   // closes the trailing run
    const groups = projectCompact(doc, context).filter((item) => item.id.startsWith("group:"));
    expect(groups).toHaveLength(2);
    expect(groups.map((item) => (item.kind === "line" ? item.line.text : ""))).toEqual(["  Read 2 files (ctrl+o to expand)", "  Read 2 files (ctrl+o to expand)"]);
  });
});

// ── F3 FINAL controller review (external codex reviewer, finding F3) ───────────────────────────────────
// The Write create preview is the ONE typed row whose job is to reproduce a file verbatim, so a row it drops
// is a row the reader will look for in the file and not find. `previewRows` used to emit an empty line as a
// SEGMENTED `{text:"", segments:[{text:""}]}`, and `Line`'s segmented branch renders one `<Text>` per segment
// — an empty one paints nothing, and the blank row vanished. The un-segmented branch's `l.text || " "` is
// what holds the row open, so this pins the RENDERED frame, not just the RenderLine.
describe("F3 final review: blank lines survive a Write preview", () => {
  const write = {
    id: "write-1", name: "Write", route: "top-level" as const, callSequence: 1,
    input: { file_path: "/work/a.txt", content: "a\n\nb" },
    result: { content: "Created", isError: false, resultSequence: 2 },
  };
  const items = () => renderToolEvent(write, normalizeToolResult(write), { ...options, columns: 40 });

  it("emits the blank row WITHOUT segments, so it takes Line's `text || ' '` branch", () => {
    const body = bodyOf(items());
    expect(body.map((line) => line.text)).toEqual(["a", "", "b"]);
    expect(body[1]).toEqual({ text: "" });                       // no `segments: [{text: ""}]` — that is what Ink collapses
  });

  it("paints three rows with the middle one blank", async () => {
    const painted = plain(await rawInk(<>{items().map((item) => <RenderItemView key={item.id} item={item} />)}</>, 40)).split("\n");
    const start = painted.findIndex((line) => line.includes(TOOL_RESULT_GUTTER));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(painted.slice(start, start + 3).map((line) => line.replace(TOOL_RESULT_GUTTER, "").trim())).toEqual(["a", "", "b"]);
  });
});
