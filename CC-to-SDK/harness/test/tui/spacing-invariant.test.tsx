// test/tui/spacing-invariant.test.tsx — T-SPACE Task 1 (spec §2.2/D6/D7/D11, research-spacing.md): canon
// puts exactly one blank row above every top-level RENDERED transcript block (`addMargin`/`gm`,
// cli.pretty.js:18761-18768), unconditionally, with no document-start suppression. Our item model had no
// margin concept and no producer emitted a stand-in blank — this file pins the fix: a `kind:"line"` item
// with empty text, prepended at CONCAT time ahead of every non-empty push, keyed off the pushed unit's own
// first item so the id is durable and pairwise-distinct for free (ids are already globally unique).
//
// GATED ON CONTRIBUTION, NOT ON RAW ANCHORS (D11): `buildAnchoredEntries` retains empty carriers for
// content that gets filtered (a `tool_use`-only message), absorbed (thinking under compact), or coalesced
// away (a suppressed tool folded silently into its run) — those must NOT grow a phantom separator with
// nothing under it.
import { describe, expect, it } from "vitest";
import { welcomeBanner } from "../../src/tui/banner.js";
import { projectCompact, projectDetail, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";

const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body", isError = false) =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } }) as Record<string, unknown>;
const prose = (text: string, id = `t-${text.slice(0, 6)}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
const multiBlock = (texts: readonly string[], id = "multi-1") =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: texts.map((text) => ({ type: "text", text })) } }) as Record<string, unknown>;
const thinkingOnly = (thinking: string, id = "think-1") =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "thinking", thinking, signature: "sig" }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };

// A path tool's header argument is an OSC-8 hyperlink (`toolRenderer.tsx`'s `osc8FileLink`); the escape
// bytes are irrelevant to spacing and pinned elsewhere, so strip them here (same idiom as fold-expand.test.tsx).
const unlink = (text: string) => text.replace(/\x1b]8;;[^\x07]*\x07/g, "");
const lineTexts = (items: readonly RenderItem[]) => items.filter((i): i is RenderItem & { kind: "line" } => i.kind === "line").map((i) => unlink(i.line.text));
const separators = (items: readonly RenderItem[]) => items.filter((i) => i.id.startsWith("sep:"));
const nonSeparators = (items: readonly RenderItem[]) => items.filter((i) => !i.id.startsWith("sep:"));

describe("T-SPACE Task 1: one blank row above every top-level rendered block", () => {
  it("compact: a separator precedes intro text, the folded tool group, and the closing text — nothing else", () => {
    const doc = built(prose("intro"), call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("bash-1", "Bash", { command: "ls" }), result("bash-1"), prose("outro"));
    const items = projectCompact(doc, context);
    expect(lineTexts(items)).toEqual([
      "", "intro",
      "", "  Read 1 file, listed 1 directory (ctrl+o to expand)",
      "", "outro",
    ]);
    expect(separators(items)).toHaveLength(3);
  });

  it("detail-all: the SAME document, ungrouped — a separator precedes each standalone tool row too, and header→body stays 0-gap", () => {
    const doc = built(prose("intro"), call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("bash-1", "Bash", { command: "ls" }), result("bash-1"), prose("outro"));
    const items = projectDetail(doc, { ...context, expandHint: "", projection: "detail-all" });
    const ids = items.map((i) => i.id);
    // Zero gap between a tool header and its own `⎿` body: no `sep:` id sits between them.
    const headerIndex = ids.indexOf("tool:read-1:3:header");
    expect(ids[headerIndex + 1]).toBe("tool:read-1:3:body");
    // Exactly one separator ahead of EVERY top-level unit: intro, read-1's standalone row, bash-1's
    // standalone row, outro — four, no more, no fewer.
    expect(separators(items)).toHaveLength(4);
    expect(ids).toEqual([
      "sep:sdk:message:t-intro:block:0:0:gap", "sdk:message:t-intro:block:0:0",
      "sep:tool:read-1:3:header:gap", "tool:read-1:3:header", "tool:read-1:3:body",
      "sep:tool:bash-1:5:header:gap", "tool:bash-1:5:header", "tool:bash-1:5:body",
      "sep:sdk:message:t-outro:block:0:0:gap", "sdk:message:t-outro:block:0:0",
    ]);
  });

  it("a separator is chrome, never a row of the block it sits above: no ownerKey, clickable, foldAnchor, or bg", () => {
    const doc = built(prose("a"), call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("b"));
    const items = projectCompact(doc, context);
    for (const sep of separators(items)) {
      expect(sep.kind).toBe("line");
      expect(sep.ownerKey).toBeUndefined();
      expect(sep.clickable).toBeUndefined();
      expect(sep.foldAnchor).toBeUndefined();
      if (sep.kind === "line") expect(sep.line.bg).toBeUndefined();
    }
  });

  it("the very first rendered unit in the whole document still gets its separator — no document-start suppression (canon's addMargin ignores index)", () => {
    const items = projectCompact(built(prose("only")), context);
    expect(lineTexts(items)).toEqual(["", "only"]);
  });
});

describe("T-SPACE Task 1: empty carriers get NO separator (D11 — gated on contribution, not raw anchors)", () => {
  it("a message whose only content was a filtered tool_use is invisible — its OWN anchor contributes no separator (the tool's row comes from elsewhere)", () => {
    const doc = built(call("ts-1", "ToolSearch", { query: "select:Read" }), result("ts-1", "{}"), prose("done"));
    const items = projectCompact(doc, context);
    // ToolSearch is a suppressed tool under compact (absorbed silently into its run, spec §1.2) — the whole
    // exchange projects to nothing, so "done" is the ONLY rendered block and gets exactly one separator.
    expect(lineTexts(items)).toEqual(["", "done"]);
    expect(separators(items)).toHaveLength(1);
  });

  it("absorbed thinking under compact projects to nothing on its own — no phantom separator ahead of it", () => {
    const doc = built(thinkingOnly("pondering"), call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
    const items = projectCompact(doc, context);
    expect(lineTexts(items)).toEqual(["", "  Read 1 file (ctrl+o to expand)", "", "done"]);
    expect(separators(items)).toHaveLength(2);
  });

  it("no double or phantom gaps: separator count always equals the count of non-empty top-level pushes", () => {
    const doc = built(
      thinkingOnly("t1"), call("ts-1", "ToolSearch", { query: "x" }), result("ts-1", "{}"),
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
    const items = projectCompact(doc, context);
    // Only two things ever became visible: the folded read-1 row and "done".
    expect(nonSeparators(items).filter((i) => i.kind === "line")).toHaveLength(2);
    expect(separators(items)).toHaveLength(2);
  });
});

describe("T-SPACE Task 1: projectMessageEntry's per-content-block loop (shouldShowDot resolution)", () => {
  // Ambiguity resolution (controller): canon emits one message per retained content block, each with its
  // own margin — so consecutive retained blocks of ONE message get one separator each, same as between
  // anchors. Verified against R3 §1.5: no table row contradicts a uniform "1 blank per block boundary".
  it("a second (and later) retained content block of one message gets its own separator; the first does not (the anchor-level separator already covers it)", () => {
    const doc = built(multiBlock(["first block", "second block"]), prose("after"));
    const items = projectCompact(doc, context);
    expect(lineTexts(items)).toEqual(["", "first block", "", "second block", "", "after"]);
    // Three separators total: one above the whole multi-block entry, one BETWEEN its two blocks, one above "after".
    expect(separators(items)).toHaveLength(3);
  });

  it("markdown's own intra-block paragraph gap stays exactly one row and does not stack with the new separator", () => {
    const items = projectCompact(built(prose("para one\n\npara two")), context);
    const texts = lineTexts(items);
    // [separator, "para one", <one blank continuation row>, "para two"] — never two blank rows in a row.
    expect(texts).toHaveLength(4);
    expect(texts[0]).toBe("");
    expect(texts[1]).toBe("para one");
    expect(texts[2]!.trim()).toBe("");
    expect(texts[3]!.trim().endsWith("para two")).toBe(true);
  });
});

describe("T-SPACE Task 1: [BUG] fix — expandedMemberItems' member arm gets the leading blank thinkingRowItems already had", () => {
  const expandCtx = { ...context, fullscreen: true, expandHint: "" };

  it("every member row carries its own unconditional leading blank (canon LC, cli.pretty.js:193259) — exactly one blank between members, none doubled before the first", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("todo-1", "TodoWrite", { todos: [] }), result("todo-1", "ok"), prose("done"));
    const items = projectCompact(doc, { ...expandCtx, expandedFolds: new Set(["read-1"]) });
    expect(lineTexts(items)).toEqual([
      "", "⏺ Read(a.ts)",
      "", "⏺ TodoWrite([])",
      "", "done",
    ]);
    // The collapsed group row's own top-level separator is SKIPPED when expanded — canon's `uI` verbose
    // branch destructures its own `addMargin` prop and never reads it (cli.pretty.js:193379/193415-193426),
    // so the outer wrapper contributes no margin of its own; only the per-member margin applies. Doubling
    // it here would put two blank rows ahead of the cluster's first member, which canon never shows.
    expect(separators(items)).toHaveLength(1); // just the one ahead of "done"
  });

  it("hook rows keep 0-gap absorption after the last member (canon: no marginTop, butts against the last row)", () => {
    const doc = built(call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("done"));
    const callSequence = doc.toolEvents()[0]!.callSequence;
    const hookRuns = [{ id: "h1", name: "PreToolUse:Read", durationMs: 200, afterSequence: callSequence, event: "PreToolUse" }];
    const items = projectCompact(doc, { ...expandCtx, hookRuns, expandedFolds: new Set(["read-1"]) });
    const texts = lineTexts(items);
    const memberBodyIndex = texts.findIndex((t) => t.includes("Read("));
    expect(texts[memberBodyIndex + 1]).toBe("  ⎿  Ran 1 PreToolUse hook (0.2s)"); // no blank between them
  });
});

describe("T-SPACE Task 1: the banner→prompt seam composes to 2 (banner's own trailing blank + the leading separator)", () => {
  it("banner.ts's own trailing blank is untouched by this task, and the transcript's first anchor still gets its own leading separator — combined, the seam is 2 blank rows", () => {
    const bannerLines = welcomeBanner({ cwd: "/x" }).map((l) => l.text);
    expect(bannerLines.at(-1)).toBe(""); // banner.ts:187's own trailing blank, pre-existing
    const items = projectCompact(built(prose("hi")), context);
    const transcriptLines = lineTexts(items);
    expect(transcriptLines[0]).toBe(""); // this task's new leading separator
    // Count the blank run STRADDLING the seam: trailing blanks off the banner plus leading blanks off the
    // transcript — not a scan from the array's tail, which would start inside "hi" and find nothing.
    let trailing = 0;
    for (let i = bannerLines.length - 1; i >= 0 && bannerLines[i]!.trim() === ""; i--) trailing++;
    let leading = 0;
    for (let i = 0; i < transcriptLines.length && transcriptLines[i]!.trim() === ""; i++) leading++;
    expect(trailing + leading).toBe(2);
  });
});

describe("T-SPACE Task 1: separator id durability and uniqueness", () => {
  it("every separator id is pairwise-distinct across a projection with multiple anchors, groups, and multi-block messages", () => {
    const doc = built(
      multiBlock(["a", "b"]), call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
      call("bash-1", "Bash", { command: "ls" }), result("bash-1"), prose("done"));
    const items = projectCompact(doc, context);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(separators(items).length).toBeGreaterThan(1);
  });

  it("separator ids for already-published regions are byte-identical after the document grows (Static commit → reprojection)", () => {
    const doc = built(prose("one"), call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"), prose("two"));
    const before = projectCompact(doc, context).map((i) => i.id);
    expect(before.some((id) => id.startsWith("sep:"))).toBe(true);

    doc.appendSdk("host", call("bash-1", "Bash", { command: "ls" }));
    doc.appendSdk("host", result("bash-1"));
    doc.appendSdk("host", prose("three"));
    const after = projectCompact(doc, context).map((i) => i.id);

    expect(after.slice(0, before.length)).toEqual(before); // the earlier region's ids, separators included, are unchanged
    expect(new Set(after).size).toBe(after.length); // and the grown projection stays pairwise-distinct
  });
});
