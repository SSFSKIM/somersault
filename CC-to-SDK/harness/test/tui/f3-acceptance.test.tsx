// test/tui/f3-acceptance.test.tsx — F3 acceptance #1, the one clause the wave's task tests left unpinned.
//
// Acceptance #1 (spec § F3, as amended 2026-08-04) has three parts. Two were already pinned by Tasks 2–4 and
// are NOT re-written here — they are named in the wave's close-out report:
//   · the fold itself (a contiguous read run becomes ONE row)  → toolRenderer.test.tsx "collapses a contiguous run"
//   · the genuinely bold count inside the dim run (byte shape)  → sgr-foldrow.test.ts (writer) +
//     toolRenderer.test.tsx "paints a genuinely BOLD count inside the dim run" (Ink-normalized frame)
// The third — **NO per-row elapsed and NO group elapsed suffix** — had no executable pin anywhere: it lived
// only as a prose comment on `toolRenderer.tsx`'s group-row builder. It is a real contract, and a deliberately
// UNREACHABLE upstream behaviour: upstream computes the `· Ns` suffix's anchor only inside `if (s && ds())`
// (R4.10), i.e. fullscreen-only, so a default-view row that grew one would be a fabrication, not parity.
// P84/P85 settled the same way for the bash progress suffix (R4.11).
//
// These assertions are exact-equality on row text on purpose: any appended suffix — ` · 3s`, ` (3s)`, `12.4s` —
// fails them, which is what makes the guard bite.
import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { projectCompact, projectDetail, projectPending, RenderItemView, type RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";

const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
const call = (id: string, name: string, input: unknown) =>
  ({ type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body") =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } }) as Record<string, unknown>;
const prose = (text: string) => ({ type: "assistant", message: { id: `t-${text}`, content: [{ type: "text", text }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
const lineTexts = (items: readonly RenderItem[]) => items.filter((i) => i.kind === "line").map((i) => (i as { line: RenderLine }).line.text);

// Three consecutive reads, then prose to close the run — the acceptance's own fixture.
const THREE_READS = [
  call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1", "one\ntwo"),
  call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2", "one\ntwo"),
  call("read-3", "Read", { file_path: "/work/c.ts" }), result("read-3", "one\ntwo"),
];
// Anything that reads as a duration appended to a row: `· 3s`, `(1m 12s)`, ` 12.4s`, `340ms`.
const ELAPSED = /(?:·\s*)?\d+(?:\.\d+)?\s*(?:ms|s\b|m\s+\d+s)/;

describe("F3 acceptance #1 — three consecutive reads collapse to one row, with no elapsed anywhere", () => {
  it("renders exactly `  Read 3 files (ctrl+o to expand)` and nothing else — no group elapsed suffix", () => {
    const items = projectCompact(built(...THREE_READS, prose("done")), context);
    const rows = items.filter((i) => i.id.startsWith("group:"));
    expect(lineTexts(rows)).toEqual(["  Read 3 files (ctrl+o to expand)"]);
    // A wall clock far past the run cannot grow a suffix: `now` is only the blink phase, never a duration.
    const late = projectCompact(built(...THREE_READS, prose("done")), { ...context, now: 987_654 });
    expect(lineTexts(late.filter((i) => i.id.startsWith("group:")))).toEqual(["  Read 3 files (ctrl+o to expand)"]);
    expect(lineTexts(rows)[0]).not.toMatch(ELAPSED);
  });

  it("keeps the count genuinely BOLD inside the dim run at N=3, with upstream's plain post-count tail", () => {
    const rows = projectCompact(built(...THREE_READS, prose("done")), context).filter((i) => i.id.startsWith("group:"));
    const frame = render(<>{rows.map((item) => <RenderItemView key={item.id} item={item} />)}</>).lastFrame()!;
    expect(frame).toContain("\x1b[38;2;153;153;153m\x1b[2mRead \x1b[1m3\x1b[22m files");   // grey+dim run, real \x1b[1m count
    expect(frame).not.toMatch(/3(?:\x1b\[22m)?\x1b\[2m files/);                            // and no dim re-open after it
  });

  it("gives the still-open run the active row with no elapsed either", () => {
    const open = built(call("read-1", "Read", { file_path: "/work/a.ts" }), call("read-2", "Read", { file_path: "/work/b.ts" }), call("read-3", "Read", { file_path: "/work/c.ts" }));
    const row = lineTexts(projectPending(open, { ...context, now: 987_654 }).filter((i) => i.id.startsWith("group:")))[0]!;
    expect(row).toBe("⏺ Reading 3 files… (ctrl+o to expand)");
    expect(row).not.toMatch(ELAPSED);
  });

  it("gives the ctrl+o per-call rows no elapsed either — the suffix is fullscreen-only upstream (R4.10)", () => {
    const detail = projectDetail(built(...THREE_READS, prose("done")), { ...context, projection: "detail-all", now: 987_654 });
    const headers = lineTexts(detail).filter((t) => t.includes("Read(")).map((t) => t.replace(/\x1b]8;;[^\x07]*\x07/g, ""));
    expect(headers).toEqual(["⏺ Read(a.ts)", "⏺ Read(b.ts)", "⏺ Read(c.ts)"]);
    for (const header of headers) expect(header).not.toMatch(ELAPSED);
  });
});
