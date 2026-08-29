// test/tui/advisor-row.test.tsx — bl7 T-ADVISOR Task 2: the two render arms `render.ts:206-236` gains
// (in-flight `server_tool_use`/"advisor" row, `advisor_tool_result`'s five result shapes) plus
// `advisorState.ts`'s resolution pass. Canon source: research-advisor.md §A2/§A3 (the `bm`/`eGt`/`uur`/`tGt`
// transcription); spec 2026-08-30-bl7-hookblock-advisor-design.md §3.2/§3.3, D10, D15, D17.
//
// Every render.ts cell below calls `renderMessage` directly with an explicit `RenderMessageOptions.advisor`
// bag — the exact seam `projectMessageEntry` (toolRenderer.tsx) feeds in production — so these pin the
// render CONTRACT independent of the projection wiring. `advisorResolution` cells are pure unit calls.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderMessage } from "../../src/tui/render.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";
import { EXPAND_HINT_FALLBACK } from "../../src/tui/keys/hints.js";
import { advisorResolution, type AdvisorEntry } from "../../src/tui/advisorState.js";
import { projectCompact, projectDetail, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";

const asst = (content: unknown[]) => ({ type: "assistant", parent_tool_use_id: null, message: { content } });
const success = resolveThemeColor(themeTokens().success);
const error = resolveThemeColor(themeTokens().error);
const warning = resolveThemeColor(themeTokens().warning);
const HINT = EXPAND_HINT_FALLBACK; // "(ctrl+o to expand)" — the no-keymap-in-scope fallback `resolveExpandHint` returns when `expandHint` is absent.

// Review finding precedent (banner.test.ts): pin the expected TICK literal by fixing TERM, never by calling
// TICK() in the assertion — asserting a value via the function that produces it is tautological.
beforeEach(() => vi.stubEnv("TERM", "xterm-256color"));
afterEach(() => vi.unstubAllEnvs());
const TICK = "✔";

const inFlight = (over: Record<string, unknown> = {}) => ({ type: "server_tool_use", id: "srv1", name: "advisor", input: {}, ...over });
const resultOf = (content: Record<string, unknown>) => ({ type: "advisor_tool_result", tool_use_id: "srv1", content });
const noopAdvisor = { resolvedIds: new Set<string>(), erroredIds: new Set<string>(), expanded: false, clickHintSuppressed: false };

describe("render.ts — advisor in-flight row (server_tool_use)", () => {
  // (1) unresolved: dim glyph (no color), bold "Advising", dim " using {model}" only when model is known.
  it("unresolved, no model: dim glyph, bold Advising, no model clause", () => {
    expect(renderMessage(asst([inFlight()]), { platform: "darwin", advisor: noopAdvisor })).toEqual([
      { text: "Advising", gutter: { text: "⏺ ", dim: true }, segments: [{ text: "Advising", bold: true }] },
    ]);
  });
  it("unresolved, model known (D15): dim glyph, bold Advising, dim ' using {model}'", () => {
    const advisor = { ...noopAdvisor, model: "Opus 4.8" };
    expect(renderMessage(asst([inFlight()]), { platform: "darwin", advisor })).toEqual([
      { text: "Advising using Opus 4.8", gutter: { text: "⏺ ", dim: true },
        segments: [{ text: "Advising", bold: true }, { text: " using Opus 4.8", dim: true }] },
    ]);
  });
  // (2) resolved → solid success glyph; errored → solid error glyph.
  it("resolved (not errored): solid success-colour glyph, undimmed", () => {
    const advisor = { ...noopAdvisor, resolvedIds: new Set(["srv1"]) };
    expect(renderMessage(asst([inFlight()]), { platform: "darwin", advisor })[0]!.gutter).toEqual({ text: "⏺ ", dim: false, color: success });
  });
  it("resolved AND errored: solid error-colour glyph, undimmed", () => {
    const advisor = { ...noopAdvisor, resolvedIds: new Set(["srv1"]), erroredIds: new Set(["srv1"]) };
    expect(renderMessage(asst([inFlight()]), { platform: "darwin", advisor })[0]!.gutter).toEqual({ text: "⏺ ", dim: false, color: error });
  });
  it("platform selects the bullet: ● off darwin", () => {
    expect(renderMessage(asst([inFlight()]), { platform: "linux", advisor: noopAdvisor })[0]!.gutter!.text).toBe("● ");
  });
  it("a server_tool_use whose name is not 'advisor' renders nothing (benign divergence, A1 detail 3)", () => {
    expect(renderMessage(asst([inFlight({ name: "web_search" })]), { platform: "darwin", advisor: noopAdvisor })).toEqual([]);
  });
});

describe("render.ts — advisor result rows (advisor_tool_result)", () => {
  // (3) advisor_result collapsed: the exact ✔ sentence WITH trailing space + hint when not suppressed;
  // hint absent (but the trailing space stays) when clickHintSuppressed.
  it("advisor_result collapsed, hint shown: ✔ sentence (trailing space) + hint, all dim", () => {
    const block = resultOf({ type: "advisor_result", text: "ignored while collapsed", stop_reason: "end_turn" });
    expect(renderMessage(asst([block]), { advisor: noopAdvisor })).toEqual([
      { text: `${TICK} Advisor has reviewed the conversation and will apply the feedback ${HINT}`, dim: true },
    ]);
  });
  it("advisor_result collapsed, clickHintSuppressed: sentence only, hint dropped", () => {
    const block = resultOf({ type: "advisor_result", text: "ignored while collapsed", stop_reason: "end_turn" });
    const advisor = { ...noopAdvisor, clickHintSuppressed: true };
    expect(renderMessage(asst([block]), { advisor })).toEqual([
      { text: `${TICK} Advisor has reviewed the conversation and will apply the feedback `, dim: true },
    ]);
  });
  // (4) expanded: content.text VERBATIM, one plain dim Text — NOT markdown, no truncation (D10).
  it("advisor_result expanded: content.text verbatim, dim, no gutter/indent", () => {
    const block = resultOf({ type: "advisor_result", text: "line one\nline two", stop_reason: "end_turn" });
    const advisor = { ...noopAdvisor, expanded: true };
    expect(renderMessage(asst([block]), { advisor })).toEqual([{ text: "line one\nline two", dim: true }]);
  });
  it("D10 pin: a markdown-sensitive fixture renders LITERALLY, never through renderMarkdown", () => {
    const fixture = "**not bold** _not italic_";
    const block = resultOf({ type: "advisor_result", text: fixture, stop_reason: "end_turn" });
    const advisor = { ...noopAdvisor, expanded: true };
    expect(renderMessage(asst([block]), { advisor })).toEqual([{ text: fixture, dim: true }]);
  });
  // (5) declined (stop_reason==="refusal"): warning line; reason = the same `text` field.
  it("declined with reason, collapsed: warning line + hint (hint dim, line warning-coloured)", () => {
    const block = resultOf({ type: "advisor_result", text: "not this time", stop_reason: "refusal" });
    expect(renderMessage(asst([block]), { advisor: noopAdvisor })).toEqual([
      { text: `Advisor declined to advise on this request ${HINT}`,
        segments: [{ text: "Advisor declined to advise on this request", color: warning }, { text: ` ${HINT}`, dim: true }] },
    ]);
  });
  // Task 3 carry-forward (Task 2 review minor): canon's `Hn = Yn!==void 0&&!Fr ? r(U,{children:[" ",
  // e(Gc,{})]}) : null` wraps the hint in a fragment whose LEADING SPACE is emitted whenever a reason
  // exists and the row is collapsed — independent of whether `Gc()` (the hint itself) returns null. So
  // `clickHintSuppressed` must drop only the hint TEXT, never the trailing space it would have introduced.
  it("declined with reason, collapsed, hint SUPPRESSED: warning line keeps the trailing space, hint text dropped", () => {
    const block = resultOf({ type: "advisor_result", text: "not this time", stop_reason: "refusal" });
    const advisor = { ...noopAdvisor, clickHintSuppressed: true };
    expect(renderMessage(asst([block]), { advisor })).toEqual([
      { text: "Advisor declined to advise on this request ", color: warning },
    ]);
  });
  it("declined with reason, expanded: warning line (hint dropped) THEN a separate dim reason row", () => {
    const block = resultOf({ type: "advisor_result", text: "not this time", stop_reason: "refusal" });
    const advisor = { ...noopAdvisor, expanded: true };
    expect(renderMessage(asst([block]), { advisor })).toEqual([
      { text: "Advisor declined to advise on this request", color: warning },
      { text: "not this time", dim: true },
    ]);
  });
  it("declined without reason: no hint ever, collapsed and expanded are IDENTICAL", () => {
    const block = resultOf({ type: "advisor_result", stop_reason: "refusal" });
    const collapsed = renderMessage(asst([block]), { advisor: noopAdvisor });
    const expanded = renderMessage(asst([block]), { advisor: { ...noopAdvisor, expanded: true } });
    expect(collapsed).toEqual([{ text: "Advisor declined to advise on this request", color: warning }]);
    expect(expanded).toEqual(collapsed);
  });
  // (6) advisor_tool_result_error: error colour, `error_code` interpolated, identical expanded — never clickable.
  it("advisor_tool_result_error: 'Advisor unavailable ({code})', error colour, identical expanded", () => {
    const block = resultOf({ type: "advisor_tool_result_error", error_code: "overloaded" });
    const collapsed = renderMessage(asst([block]), { advisor: noopAdvisor });
    const expanded = renderMessage(asst([block]), { advisor: { ...noopAdvisor, expanded: true } });
    expect(collapsed).toEqual([{ text: "Advisor unavailable (overloaded)", color: error }]);
    expect(expanded).toEqual(collapsed);
  });
  // (7) advisor_redacted_result: the ✔ sentence with NO trailing space and NO hint, ever.
  it("advisor_redacted_result: ✔ sentence, no trailing space, no hint, identical expanded", () => {
    const block = resultOf({ type: "advisor_redacted_result", encrypted_content: "x", stop_reason: null });
    const collapsed = renderMessage(asst([block]), { advisor: noopAdvisor });
    const expanded = renderMessage(asst([block]), { advisor: { ...noopAdvisor, expanded: true } });
    expect(collapsed).toEqual([{ text: `${TICK} Advisor has reviewed the conversation and will apply the feedback`, dim: true }]);
    expect(expanded).toEqual(collapsed);
  });
  it("unknown content.type renders nothing", () => {
    const block = resultOf({ type: "something_new" });
    expect(renderMessage(asst([block]), { advisor: noopAdvisor })).toEqual([]);
  });
  it("no advisor context threaded at all falls back to the honest 'nothing known yet' reading", () => {
    const block = resultOf({ type: "advisor_result", text: "x", stop_reason: "end_turn" });
    expect(renderMessage(asst([block]))).toEqual([{ text: `${TICK} Advisor has reviewed the conversation and will apply the feedback ${HINT}`, dim: true }]);
  });
});

// F4 fix wave (round review): `alreadyExpandedByProjection` (toolRenderer.tsx:848) must read the same
// "any detail projection" predicate as its two same-file precedents (`showThinking`, the compact-summary
// chip's `transcriptMode`) — `projection !== "compact"`, not `projection === "detail-all"` alone. Drives
// the predicate through the FULL projection stack (projectCompact/projectDetail), not renderMessage
// directly, since the bug lives in the caller that derives `expanded`/`clickable` from `options.projection`,
// not in render.ts itself. Table: compact (collapsed, clickable) / detail-all (expanded, not clickable) /
// detail-collapsed (same as detail-all — the regression this finding fixes).
describe("toolRenderer projection — advisor result row across compact/detail-all/detail-collapsed (F4)", () => {
  const ctx = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
  const BODY = "full verbatim advisor body";
  const advisorResultDoc = (): TranscriptDocument => {
    const doc = new TranscriptDocument();
    doc.appendSdk("host", {
      type: "assistant", parent_tool_use_id: null,
      message: { content: [{ type: "advisor_tool_result", tool_use_id: "srv1", content: { type: "advisor_result", text: BODY, stop_reason: "end_turn" } }] },
    } as Record<string, unknown>);
    return doc;
  };
  const linesOf = (items: readonly RenderItem[]): readonly string[] => items.flatMap((i) => (i.kind === "line" ? [i.line.text] : []));
  const isClickable = (items: readonly RenderItem[]): boolean => items.some((i) => i.kind === "line" && i.clickable === true);

  it("compact: collapsed one-liner (no verbatim body), clickable", () => {
    const items = projectCompact(advisorResultDoc(), ctx);
    expect(linesOf(items).some((t) => t.startsWith(`${TICK} Advisor has reviewed`))).toBe(true);
    expect(linesOf(items).some((t) => t.includes(BODY))).toBe(false);
    expect(isClickable(items)).toBe(true);
  });

  it("detail-all: expanded verbatim body, not clickable", () => {
    const items = projectDetail(advisorResultDoc(), { ...ctx, projection: "detail-all" });
    expect(linesOf(items)).toContain(BODY);
    expect(isClickable(items)).toBe(false);
  });

  it("detail-collapsed (the F4 fix): expanded verbatim body, not clickable — same as detail-all, NOT compact", () => {
    const items = projectDetail(advisorResultDoc(), { ...ctx, projection: "detail-collapsed" });
    expect(linesOf(items)).toContain(BODY);
    expect(isClickable(items)).toBe(false);
  });
});

// (8) advisorResolution — canon `eGt`/`uur`/`tGt`. D17: "latest" is the ACTUAL retained tail, never a
// filtered "last assistant message".
describe("advisorState — advisorResolution", () => {
  const asstEntry = (id: string, content: unknown[]): AdvisorEntry => ({ message: { type: "assistant", message: { id, content } } });
  const userEntry = (): AdvisorEntry => ({ message: { type: "user", message: { content: [] } } });
  const consult = (id: string) => ({ type: "server_tool_use", id, name: "advisor", input: {} });

  it("an advisor_tool_result resolves its server_tool_use by tool_use_id (no error)", () => {
    const entries = [asstEntry("m1", [consult("X")]), asstEntry("m2", [{ type: "advisor_tool_result", tool_use_id: "X", content: { type: "advisor_result", text: "ok", stop_reason: "end_turn" } }])];
    expect(advisorResolution(entries)).toEqual({ resolved: new Set(["X"]), errored: new Set() });
  });
  it("a decline (stop_reason refusal) errors the resolved id too", () => {
    const entries = [asstEntry("m1", [consult("E")]), asstEntry("m2", [{ type: "advisor_tool_result", tool_use_id: "E", content: { type: "advisor_result", text: "no", stop_reason: "refusal" } }])];
    expect(advisorResolution(entries)).toEqual({ resolved: new Set(["E"]), errored: new Set(["E"]) });
  });
  it("an advisor_tool_result_error errors the resolved id too", () => {
    const entries = [asstEntry("m1", [consult("F")]), asstEntry("m2", [{ type: "advisor_tool_result", tool_use_id: "F", content: { type: "advisor_tool_result_error", error_code: "overloaded" } }])];
    expect(advisorResolution(entries)).toEqual({ resolved: new Set(["F"]), errored: new Set(["F"]) });
  });
  it("D17 non-latest force-error: an unresolved consult in a NON-tail assistant message goes red", () => {
    const entries = [asstEntry("m1", [consult("B")]), asstEntry("m2", [{ type: "text", text: "done" }])]; // m2 is the tail and doesn't touch B
    expect(advisorResolution(entries)).toEqual({ resolved: new Set(["B"]), errored: new Set(["B"]) });
  });
  it("D17: an unresolved consult in the ACTUAL tail assistant message is left spinning (not forced)", () => {
    const entries = [asstEntry("m1", [{ type: "text", text: "hi" }]), asstEntry("m2", [consult("G")])]; // m2 IS the tail
    expect(advisorResolution(entries)).toEqual({ resolved: new Set(), errored: new Set() });
  });
  it("D17 user-tail: a trailing USER frame forces EVERY unresolved consult red, however many messages back", () => {
    const entries = [asstEntry("m1", [consult("C")]), userEntry()];
    expect(advisorResolution(entries)).toEqual({ resolved: new Set(["C"]), errored: new Set(["C"]) });
  });
  it("missing-id order: an assistant entry with no message id still force-resolves correctly against a REAL tail id", () => {
    const noId: AdvisorEntry = { message: { type: "assistant", message: { content: [consult("D")] } } }; // message.id absent entirely
    const entries = [noId, asstEntry("m2", [{ type: "text", text: "done" }])];
    expect(advisorResolution(entries)).toEqual({ resolved: new Set(["D"]), errored: new Set(["D"]) });
  });
  it("must not mint a ToolEvent-shaped record — the return is only the two id sets", () => {
    const entries = [asstEntry("m1", [consult("Z")])];
    const result = advisorResolution(entries);
    expect(Object.keys(result).sort()).toEqual(["errored", "resolved"]);
  });
});
