// tui/test/markdown-integration.test.tsx — F4 Task 5: the markdown walker reaches the transcript.
// Three seams are pinned here: `renderMessage`'s options bag (width now, platform/showThinking threaded for
// Tasks 8/9), `projectMessageEntry` forwarding the projection's knobs into it, and THE ANCHORED CACHE KEY,
// which stops being `revision × theme` the moment those knobs reach the renderer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { marked } from "marked";
import { renderMessage, type RenderLine } from "../../src/tui/render.js";
import { projectCompact, projectDetail, projectionDeps, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { setTheme } from "../../src/tui/theme.js";

const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
const prose = (text: string, id = `t-${text.slice(0, 8)}`) =>
  ({ type: "assistant", message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
const lineTexts = (items: readonly RenderItem[]) => items.filter((i) => i.kind === "line").map((i) => (i as { line: RenderLine }).line.text);
const asst = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });

// A table is the one block whose rendering is a function of the terminal width (the box engine fits its
// columns to it), so it is what makes width plumbing OBSERVABLE end to end.
const TABLE = "| name | value |\n| --- | --- |\n| alphabeticalcolumnvalue | oneoneoneoneoneoneone |\n";

describe("F4 Task 5 — renderMessage options bag", () => {
  it("threads `width` into the markdown walker", () => {
    const wide = renderMessage(asst(TABLE), { width: 100 }).map((l) => l.text);
    const narrow = renderMessage(asst(TABLE), { width: 40 }).map((l) => l.text);
    expect(wide).not.toEqual(narrow);
    expect(wide[0]!.length).toBeGreaterThan(narrow[0]!.length);
    expect(renderMessage(asst(TABLE))).toEqual(renderMessage(asst(TABLE), { width: 80 }));   // the default
  });
  it("accepts the FULL bag — platform/showThinking are threaded now, consumed in Tasks 8/9", () => {
    const lines = renderMessage(asst(TABLE), { width: 40, platform: "linux", showThinking: false });
    expect(lines.map((l) => l.text)).toEqual(renderMessage(asst(TABLE), { width: 40 }).map((l) => l.text));
  });
});

describe("F4 Task 5 — projectMessageEntry forwards the projection's knobs", () => {
  afterEach(() => { vi.restoreAllMocks(); setTheme("auto"); });
  it("puts `columns` on screen: the same document renders a narrower table at a narrower terminal", () => {
    const doc = built(prose(TABLE));
    const wide = lineTexts(projectCompact(doc, context));
    const narrow = lineTexts(projectCompact(doc, { ...context, columns: 40 }));
    expect(wide[0]).toContain("┌"); expect(narrow[0]).toContain("┌");
    expect(wide[0]!.length).toBeGreaterThan(narrow[0]!.length);
  });
});

// ── THE CACHE KEY (plan-review finding 2) ────────────────────────────────────────────────────────────────
// Before this task the anchored stream was memoized on `revision × theme` alone, on the premise that
// `projectMessageEntry` voided its options. Threading columns/projection/verbose falsifies that premise: two
// projections of ONE unmutated document at ONE revision would otherwise serve each other's items.
describe("F4 Task 5 — the anchored cache key is revision × theme × columns × projection × verbose", () => {
  afterEach(() => { vi.restoreAllMocks(); setTheme("auto"); });

  it("re-projects when only `columns` changes — the cached first projection is NOT served", () => {
    const doc = built(prose(TABLE));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    const wide = lineTexts(projectCompact(doc, context));
    const narrow = lineTexts(projectCompact(doc, { ...context, columns: 40 }));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(narrow).not.toEqual(wide);
    expect(lineTexts(projectCompact(doc, context))).toEqual(wide);          // and back again, still honest
  });

  it("is INDEPENDENT OF CALL ORDER across projections of one unmutated document", () => {
    const doc = built(prose(TABLE));
    const compactFirst = { compact: lineTexts(projectCompact(doc, context)), detail: lineTexts(projectDetail(doc, { ...context, projection: "detail-all" })) };
    const other = built(prose(TABLE));                                       // a pristine document, opposite order
    const detailFirst = { detail: lineTexts(projectDetail(other, { ...context, projection: "detail-all" })), compact: lineTexts(projectCompact(other, context)) };
    expect(detailFirst.compact).toEqual(compactFirst.compact);
    expect(detailFirst.detail).toEqual(compactFirst.detail);
  });

  it("still cache-hits when document, theme, columns, projection and verbose all hold still", () => {
    setTheme("light");
    const doc = built(prose("use `x` now"));
    const before = lineTexts(projectCompact(doc, context));
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    expect(lineTexts(projectCompact(doc, context))).toEqual(before);
    expect(lineTexts(projectCompact(doc, context))).toEqual(before);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("BOUNDS the per-document key set: a width evicted by a long resize drag rebuilds", () => {
    const doc = built(prose(TABLE));
    projectCompact(doc, { ...context, columns: 60 });
    for (let c = 61; c < 101; c++) projectCompact(doc, { ...context, columns: c });   // a drag across 40 widths
    const spy = vi.spyOn(projectionDeps, "buildAnchored");
    projectCompact(doc, { ...context, columns: 60 });
    expect(spy).toHaveBeenCalledTimes(1);                                  // evicted, not retained forever
    projectCompact(doc, { ...context, columns: 60 });
    expect(spy).toHaveBeenCalledTimes(1);                                  // …and the fresh entry is live
  });
});

// ── Performance guard: the markdown LRU (task brief step "LRU proof") ────────────────────────────────────
// `marked.lexer` is reached as a property of the imported `marked` singleton at call time, so a plain
// `vi.spyOn` is the whole seam — markdown.ts needs no test-only export.
describe("F4 Task 5 — lexer LRU proof", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("lexes each distinct text ONCE across 200 renders at varying widths", () => {
    const tag = `lru-${Math.random().toString(36).slice(2)}`;
    const texts = [`# heading ${tag}`, `- item ${tag}\n- second`, `use \`code ${tag}\` here`];
    const spy = vi.spyOn(marked, "lexer");
    for (let i = 0; i < 200; i++) renderMessage(asst(texts[i % texts.length]!), { width: 60 + (i % 40) });
    expect(spy).toHaveBeenCalledTimes(texts.length);
  });
});
