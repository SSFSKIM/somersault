// test/tui/thinking.test.tsx — F4 Task 9: the thinking species.
//
// Upstream renders a `thinking` block in the ordinary transcript as NOTHING. `Gha`'s guard (bundle
// L429455–429457, the `case "thinking"`) is `if (!isTranscriptMode && !verbose) return null` — so the
// always-visible dim lines F1 shipped were the single largest behavioural divergence in the transcript,
// and this suite is the pin that kills them. When the guard DOES pass, `zAr` (L422947–422969) paints a
// `minWidth: 2` gutter box holding `<Text aria-label="thinking:" dimColor italic>∴</Text>` (L422963, `q3r`
// = U+2234) beside a column whose content is `<Markdown dimColor>{thinking.trim()}</Markdown>` (L422969,
// the `Y40 = isTranscriptMode || verbose` branch — which is the ONLY reachable branch, because the guard
// above already returned null when both are false).
//
// The streaming placeholder is a DIFFERENT component and a DIFFERENT glyph: `e8o` (L422457–422471) is a
// bare `<Text dimColor italic>` of `"✻ "` (U+273B, aria-hidden) + `"Thinking…"` (U+2026, not three dots).
// Our live region painted `✦ Thinking` (U+2726, no ellipsis) — wrong glyph, wrong text, not italic.
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { renderMessage, THINKING_PLACEHOLDER, type RenderLine } from "../../src/tui/render.js";
import { renderMarkdown } from "../../src/tui/markdown.js";
import { Line } from "../../src/tui/Line.js";
import { LiveTurn } from "../../src/tui/liveTurn.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { projectCompact, projectDetail, type RenderItem } from "../../src/tui/toolRenderer.js";
import { setTheme } from "../../src/tui/theme.js";

const context = { cwd: "/work", home: "/home/me", platform: "linux" as NodeJS.Platform, columns: 80, now: 0 };
const thinker = (thinking: string, id = "m1") =>
  ({ type: "assistant", message: { id, content: [{ type: "thinking", thinking, signature: "sig" }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
const lines = (items: readonly RenderItem[]) => items.filter((i) => i.kind === "line").map((i) => (i as { line: RenderLine }).line);
const texts = (items: readonly RenderItem[]) => lines(items).map((l) => l.text);
const asst = (content: unknown[]) => ({ type: "assistant", message: { content } });
const se = (event: unknown) => ({ type: "stream_event", event }) as any;

describe("F4 Task 9 — thinking is hidden by default", () => {
  it("renders NOTHING for a thinking block when the options bag is omitted (`showThinking` defaults to false)", () => {
    expect(renderMessage(asst([{ type: "thinking", thinking: "hmm" }]))).toEqual([]);
    expect(renderMessage(asst([{ type: "thinking", thinking: "hmm" }]), { width: 40, platform: "linux" })).toEqual([]);
  });
  it("renders NOTHING for a thinking block at `showThinking: false`, while the sibling text still draws", () => {
    const out = renderMessage(asst([{ type: "thinking", thinking: "**pondering**" }, { type: "text", text: "done" }]), { platform: "linux", showThinking: false });
    expect(out.map((l) => l.text)).toEqual(["done"]);
  });
  it("renders NOTHING for a redacted_thinking block by default", () => {
    expect(renderMessage(asst([{ type: "redacted_thinking", data: "AAAA" }]))).toEqual([]);
  });
});

describe("F4 Task 9 — the `∴` detail form (zAr, L422947/L422963/L422969)", () => {
  it("puts a dim+italic `∴ ` gutter on the first line and indents the continuation under the content", () => {
    const out = renderMessage(asst([{ type: "thinking", thinking: "first line\n\nsecond line" }]), { showThinking: true, width: 60 });
    expect(out[0]!.gutter).toEqual({ text: "∴ ", dim: true, italic: true });   // `minWidth: 2` box → two columns
    expect(out.slice(1).every((l) => l.gutter === undefined)).toBe(true);      // ONE gutter per block, not per line
    expect(out.at(-1)!.text).toBe("  second line");                            // aligned under the CONTENT, not the glyph
  });
  it("runs the content through `renderMarkdown(text, { dim: true })` — a `**bold**` arrives as a dim+bold SEGMENT", () => {
    const out = renderMessage(asst([{ type: "thinking", thinking: "weighing **both** options" }]), { showThinking: true, width: 60 });
    expect(out).toHaveLength(1);
    expect(out[0]!.segments).toEqual(renderMarkdown("weighing **both** options", { dim: true, width: 60 })[0]!.segments);
    expect(out[0]!.segments).toContainEqual({ text: "both", dim: true, bold: true });
    expect(out[0]!.italic).toBeUndefined();                                     // the GUTTER is italic; the content is not
  });
  it("trims the thinking text and renders nothing at all for a blank one (`nI(thinking)` → null, L422953)", () => {
    expect(renderMessage(asst([{ type: "thinking", thinking: "   \n\n  " }]), { showThinking: true })).toEqual([]);
    expect(renderMessage(asst([{ type: "thinking", thinking: "\n  padded  \n" }]), { showThinking: true })[0]!.text).toBe("padded");
  });
  it("renders a redacted_thinking block as the `✻ Thinking…` placeholder (`Gha` L429450 reuses `e8o`)", () => {
    expect(renderMessage(asst([{ type: "redacted_thinking", data: "AAAA" }]), { showThinking: true })).toEqual([THINKING_PLACEHOLDER]);
  });
});

describe("F4 Task 9 — the frame-level dim pin (plan-review finding 11)", () => {
  // RenderLine-level assertions alone once blessed a shape `Line.tsx` renders UNDIMMED. The only honest
  // proof that the detail form reaches the terminal dim is the bytes Ink emits.
  it("emits `\\x1b[2m` for a detail-projected thinking block containing `**bold**`", () => {
    const out = renderMessage(asst([{ type: "thinking", thinking: "weighing **both** options" }]), { showThinking: true, width: 60 });
    const { lastFrame } = render(<Line l={out[0]!} />);
    expect(lastFrame()).toContain("\x1b[2m");
    expect(lastFrame()).toContain("∴");
    expect(lastFrame()).toContain("weighing");
  });
});

// ── THE CACHE-ORDER PINS (plan-review finding 2's second half) ───────────────────────────────────────────
// Task 5 widened the anchored cache key to `revision × theme × columns × projection × verbose × platform`
// precisely so two projections of ONE unmutated document at ONE revision cannot serve each other's items.
// Until this task compact and detail differed only by width, so the widened key was only provable with a
// contrived width split. NOW they differ by CONTENT — thinking itself — at identical width, which is the
// real product situation (ctrl+o reprojects the same document the transcript just drew). Each order gets
// its own pristine document, because the cache is per-document; comparing the two is what makes it a pin
// on order-independence rather than on one order's output.
describe("F4 Task 9 — thinking survives the anchored cache in BOTH projection orders", () => {
  afterEach(() => { vi.restoreAllMocks(); setTheme("auto"); });

  it("compact-then-detail: absent from compact, present in detail (detail-all, verbose)", () => {
    const doc = built(thinker("weighing the options"));
    const compact = texts(projectCompact(doc, context));
    const detail = texts(projectDetail(doc, { ...context, projection: "detail-all" }));
    expect(compact.join("\n")).not.toContain("weighing the options");
    expect(detail.join("\n")).toContain("weighing the options");
  });

  it("detail-then-compact over a pristine document gives the SAME two answers", () => {
    const doc = built(thinker("weighing the options"));
    const detail = texts(projectDetail(doc, { ...context, projection: "detail-all" }));
    const compact = texts(projectCompact(doc, context));
    expect(detail.join("\n")).toContain("weighing the options");
    expect(compact.join("\n")).not.toContain("weighing the options");
    // …and re-asking for detail after compact still answers detail, i.e. the compact run did not poison it.
    expect(texts(projectDetail(doc, { ...context, projection: "detail-all" }))).toEqual(detail);
  });

  // The SHARPEST key pin: `detail-collapsed` carries `verbose: false`, so compact and it differ in the knob
  // key by `projection` ALONE. Drop that one field from `knobKey` and these two orders cross-contaminate.
  it("holds for `detail-collapsed`, which differs from compact by `projection` alone", () => {
    const a = built(thinker("weighing the options"));
    const compactFirst = { compact: texts(projectCompact(a, context)), detail: texts(projectDetail(a, { ...context, projection: "detail-collapsed" })) };
    const b = built(thinker("weighing the options"));
    const detailFirst = { detail: texts(projectDetail(b, { ...context, projection: "detail-collapsed" })), compact: texts(projectCompact(b, context)) };
    expect(compactFirst.compact.join("\n")).not.toContain("weighing the options");
    expect(compactFirst.detail.join("\n")).toContain("weighing the options");
    expect(detailFirst.compact).toEqual(compactFirst.compact);
    expect(detailFirst.detail).toEqual(compactFirst.detail);
  });

  it("shows the `∴` gutter through the real ctrl+o projection, not just through renderMessage", () => {
    const doc = built(thinker("weighing **both** options"));
    const detail = lines(projectDetail(doc, { ...context, projection: "detail-all" }));
    const row = detail.find((l) => l.gutter?.text === "∴ ");
    expect(row).toBeDefined();
    expect(row!.gutter).toEqual({ text: "∴ ", dim: true, italic: true });
    expect(row!.segments).toContainEqual({ text: "both", dim: true, bold: true });
  });
});

describe("F4 Task 9 — the `✻ Thinking…` streaming placeholder (e8o, L422457–422462)", () => {
  it("is dim + italic, U+273B, and ends in a U+2026 ellipsis", () => {
    expect(THINKING_PLACEHOLDER).toEqual({ text: "✻ Thinking…", dim: true, italic: true });
    expect(THINKING_PLACEHOLDER.text.codePointAt(0)).toBe(0x273b);              // NOT U+2726 `✦`
    expect(THINKING_PLACEHOLDER.text.endsWith("…")).toBe(true);            // one ellipsis char, not "..."
  });
  it("is what LiveTurn paints once a later block collapses the streaming thinking", () => {
    const lt = new LiveTurn({ platform: "linux" });
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } }));
    lt.ingest(se({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }));
    expect(lt.snapshot()).toContainEqual(THINKING_PLACEHOLDER);
    expect(lt.snapshot().map((l) => l.text)).not.toContain("✦ Thinking");
  });
});

describe("F4 Task 9 — TR33 regression pin: the `Thought for Ns` mechanism is untouched", () => {
  // F3 Task 3 built the duration off LiveTurn's local-arrival clock and hands it to the projection as
  // `thoughtMs`. Hiding the thinking BODY must not touch that: the summary is a group-row clause, not a
  // thinking line. (The mechanism's own tests live in liveTurn.test.ts / toolRenderer.test.tsx; this is the
  // cross-task pin that Task 9 did not regress them.)
  const call = (id: string, messageId: string, thinking: string) =>
    ({ type: "assistant", message: { id: messageId, content: [{ type: "thinking", thinking, signature: "sig" }, { type: "tool_use", id, name: "Read", input: { file_path: "/work/a.ts" } }] } }) as Record<string, unknown>;
  const result = (id: string) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } }) as Record<string, unknown>;
  const prose = (text: string) => ({ type: "assistant", message: { id: `t-${text}`, content: [{ type: "text", text }] } }) as Record<string, unknown>;

  it("still renders `Thought for Ns` on the group that follows the thinking message", () => {
    // The breaker (`prose`) is what lets the compact projection PUBLISH the run; the map is keyed by the
    // projection's sdk-message identity (`message:<id>`), the same key F3's own tests use.
    const doc = built(call("read-1", "m1", "Checking the config"), result("read-1"), prose("done"));
    const thoughtMs = new Map([["message:m1", 4200]]);
    const compact = texts(projectCompact(doc, { ...context, thoughtMs }));
    expect(compact.join("\n")).toContain("Thought for 4s");
    expect(compact.join("\n")).not.toContain("Checking the config");   // the BODY is still hidden
  });

  it("LiveTurn still sums the thinking durations it observes", () => {
    let t = 0;
    const lt = new LiveTurn({ now: () => t, platform: "linux" });
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    t = 3000;
    lt.ingest(se({ type: "content_block_stop", index: 0 }));
    expect(lt.thinkingDurations(t).get("m1")).toBe(3000);
  });
});
