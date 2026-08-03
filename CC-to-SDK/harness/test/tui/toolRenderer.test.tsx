import React from "react";
import { Writable } from "node:stream";
import { render as renderInk } from "ink";
import { render } from "ink-testing-library";
import wrapAnsi from "wrap-ansi";
import { afterEach, describe, expect, it, vi } from "vitest";
import { displayPath, foldToolOutput, GROUP_HINT_GUTTER, osc8FileLink, projectCompact, projectDetail, projectionDeps, projectPending, renderToolEvent, RenderItemView, TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
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
  it("clips a generic error by PHYSICAL lines, so one unbroken long line stays whole and unmarked", () => {
    const long = "e".repeat(500);
    const body = bodyOf(renderToolEvent(read, { ...normalized, status: "error", output: long, outputLines: [long] }, { ...options, columns: 20 }));
    expect(body).toHaveLength(1); expect(body[0]!.text).toBe(long);
  });
  it("drops trailing blank result lines before folding and emits no block at all for an all-blank result", () => {
    expect(bodyOf(renderToolEvent(read, { ...normalized, output: "out\n\n  ", outputLines: ["out", "", "  "] }, options)).map((line) => line.text)).toEqual(["out"]);
    expect(bodyOf(renderToolEvent(read, { ...normalized, status: "error", output: "boom\n  ", outputLines: ["boom", "  "] }, options)).map((line) => line.text)).toEqual(["boom"]);
    expect(renderToolEvent(read, { ...normalized, output: "\n  ", outputLines: ["", "  "] }, options).map((item) => item.kind)).toEqual(["line"]);
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
    expect(bodyOf(renderToolEvent(read, { ...normalized, output: "abc        ", outputLines: ["abc        "] }, options)).map((line) => line.text)).toEqual(["abc"]);
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
  ({ type: "assistant", message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body", isError = false) =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } }) as Record<string, unknown>;
const prose = (text: string, id = `t-${text.slice(0, 6)}`) =>
  ({ type: "assistant", message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
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
    // clause text staying dim-uncoloured is unchanged and still open: the live-confirmation note records the
    // settled row as grey `#949494`, which is a DIFFERENT grey from the active row's `#999999` and needs its
    // own settled golden before it can be adopted.
    expect(line.segments).toEqual([
      { text: "  " },
      { text: "Read ", dim: true }, { text: "1", dim: true, bold: true }, { text: " file", dim: true },
      { text: " ", dim: true }, { text: "(ctrl+o to expand)", dim: true, color: resolveThemeColor(themeTokens().inactive) },
    ]);
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
    // — which is why the leader is two segments — and the active clause run is DIM, not bright. What we
    // deliberately do not copy is the golden's plain " file…", upstream's own `\x1b[22m` artifact.
    const grey = resolveThemeColor(themeTokens().inactive);
    expect(line.segments).toEqual([
      { text: "⏺", dim: true, color: grey }, { text: " ", dim: true },
      { text: "Reading ", dim: true }, { text: "1", dim: true, bold: true }, { text: " file", dim: true },
      { text: "…", dim: true }, { text: " ", dim: true }, { text: "(ctrl+o to expand)", dim: true, color: grey },
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
// blink frame. The stream depends on the document AND the live theme, so the key is `revision()` × `themeGeneration()`.
describe("F1 anchored-stream memoization", () => {
  afterEach(() => { vi.restoreAllMocks(); setTheme("auto"); });

  it("builds the anchored stream once per revision while the blink repaints on a moving clock", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    // Two consecutive frames of the same 600 ms blink: `now` moves, the document does not.
    expect(lineTexts(projectPending(doc, context))).toEqual(["⏺ Reading 1 file… (ctrl+o to expand)"]);
    expect(lineTexts(projectPending(doc, { ...context, now: 600 }))).toEqual(["  Reading 1 file… (ctrl+o to expand)"]);
    expect(spy).toHaveBeenCalledTimes(1);
    // Every other projection of the same document shares the one cache entry — including the detail (ctrl+o)
    // and compact reads, whose columns/verbose/projection knobs never reach this stage.
    projectCompact(doc, context); projectDetail(doc, { ...context, projection: "detail-all", columns: 40 });
    expect(spy).toHaveBeenCalledTimes(1);
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
    expect(before).not.toContain("› upgraded note"); expect(after).toContain("› upgraded note");
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

  it("still cache-hits when neither the document nor the theme moved", () => {
    setTheme("light");
    const doc = built(prose("use `x` now"));
    const before = lineTexts(projectCompact(doc, context));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    expect(lineTexts(projectCompact(doc, context))).toEqual(before);
    expect(spy).toHaveBeenCalledTimes(0);
  });
});
