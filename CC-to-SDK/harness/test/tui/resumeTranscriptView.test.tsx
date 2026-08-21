// tui/test/resumeTranscriptView.test.tsx — the full-screen `/resume` transcript takeover's OWN render tests
// (T-RESUME T2, D-W9). `session-picker.test.tsx` owns the whole-picker integration (the two triggers, the
// `y`/`n`/Enter/Esc confirm cycle, the loaded-payload resume) — this file is the component's render shape in
// isolation: no frame chrome, the tagged `PreviewLoad`'s three arms, and the footer verbatim (canon
// `yvc`, bundle L583551).
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { ResumeTranscriptView } from "../../src/tui/ResumeTranscriptView.js";
import { PREVIEW_EMPTY, PREVIEW_FOOTER, PREVIEW_LOADING, PREVIEW_LOADING_HINT, type PreviewLoad } from "../../src/tui/sessionPickerModel.js";
import type { SessionInfo } from "../../src/tui/useChat.js";

const frame = (f: () => string | undefined) => f() ?? "";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const flat = (s: string) => plain(s).replace(/\s*\n\s*/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const NOW = 1_700_000_000_000;
const SESSION: SessionInfo = { sessionId: "1111aaaa-0001", summary: "refactor the parser", lastModified: NOW };
const noop = () => {};

function mountView(load: PreviewLoad, opts: { fullscreen?: boolean; rows?: number; onResume?: (m: unknown[]) => void; onExit?: () => void } = {}) {
  return render(
    <ResumeTranscriptView
      session={SESSION} load={load}
      columns={100} rows={opts.rows ?? 40} fullscreen={opts.fullscreen ?? false}
      onResume={opts.onResume ?? noop} onExit={opts.onExit ?? noop}
    />,
  );
}

describe("ResumeTranscriptView — the takeover has no frame (canon L584057-584059/L583628)", () => {
  it("no round-corner PickerFrame chars and no bold title — canon's view has no header at all", async () => {
    const msgs = [{ type: "user", message: { content: "what does this do?" } }];
    const r = mountView({ state: "loaded", messages: msgs });
    await waitFor(() => flat(frame(r.lastFrame)).includes("what does this do?"));
    const raw = frame(r.lastFrame);
    // No round border corners anywhere — the OLD `PickerFrame` was `borderStyle="round"`; this component
    // never opens one.
    expect(raw).not.toMatch(/[╭╮╰╯]/);
    // No bold SGR run wraps the session's title/summary the way the old header did.
    expect(raw).not.toMatch(/\x1b\[1m[^\x1b]*refactor the parser/);
    expect(flat(raw)).not.toContain("Resume session");
  });

  it("the footer is exactly two rows under a single top border — meta plain, hints dim (canon `gvc`, L583614-583622)", async () => {
    const msgs = [{ type: "user", message: { content: "hi" } }];
    const r = mountView({ state: "loaded", messages: msgs });
    await waitFor(() => flat(frame(r.lastFrame)).includes(PREVIEW_FOOTER));
    const lines = plain(frame(r.lastFrame)).split("\n");
    // Exactly one horizontal-rule line (the footer's top border) — Ink's "single" border style draws it with
    // "─"; no vertical "│" appears anywhere (left/right/bottom are all off).
    const ruleLines = lines.filter((l) => /^─+$/.test(l.trim()));
    expect(ruleLines).toHaveLength(1);
    expect(plain(frame(r.lastFrame))).not.toContain("│");
    // The line immediately after the rule is the meta (row 1, plain); the one after that is the hints (row 2).
    const ruleIndex = lines.findIndex((l) => /^─+$/.test(l.trim()));
    expect(lines[ruleIndex + 1]!.trim()).toContain("message");             // previewMeta's "<relative> · N messages"
    expect(lines[ruleIndex + 2]!.trim()).toBe(PREVIEW_FOOTER);
  });
});

describe("ResumeTranscriptView — the tagged PreviewLoad's three arms (spec R-1)", () => {
  it("`failed` renders the failure copy; `loaded([])` renders the footer only (no failure copy)", async () => {
    const failed = mountView({ state: "failed", error: "boom" });
    await waitFor(() => flat(frame(failed.lastFrame)).includes(PREVIEW_EMPTY));
    expect(flat(frame(failed.lastFrame))).toContain(PREVIEW_FOOTER);

    const empty = mountView({ state: "loaded", messages: [] });
    await waitFor(() => flat(frame(empty.lastFrame)).includes(PREVIEW_FOOTER));
    expect(flat(frame(empty.lastFrame))).not.toContain(PREVIEW_EMPTY);      // canon has no empty-state string
  });

  it("`loading` renders `Loading session…` + a dim `esc to cancel` hint with NO border chars at all", async () => {
    const r = mountView({ state: "loading" });
    await waitFor(() => flat(frame(r.lastFrame)).includes(PREVIEW_LOADING));
    const raw = frame(r.lastFrame);
    expect(flat(raw)).toContain(PREVIEW_LOADING_HINT);
    expect(flat(raw)).not.toContain(PREVIEW_FOOTER);                       // no footer chrome while loading
    expect(plain(raw)).not.toMatch(/[─│╭╮╰╯]/);                            // no frame at all, not even the footer's rule
  });
});

describe("ResumeTranscriptView — detail-all rendering and the fullscreen budget", () => {
  it("renders an expanded tool turn (detail-all), not a collapsed fold summary", async () => {
    // A trailing assistant turn CLOSES the tool-call group — without one, `projectPending`'s own "still
    // growing" hint line (`group:…:unclosed-row`, unrelated to fold state) renders alongside the expanded
    // body, exactly as it does for the live transcript this projection is shared with.
    const msgs = [
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/tmp/notes.ts" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "alpha\nbeta" }] } },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "it resumes" }] } },
    ];
    const r = mountView({ state: "loaded", messages: msgs });
    await waitFor(() => flat(frame(r.lastFrame)).includes("it resumes"));
    expect(flat(frame(r.lastFrame))).toContain("Read(");
    expect(flat(frame(r.lastFrame))).not.toContain("Read 1 file");         // the compact fold's summary — never drawn here
  });

  it("in fullscreen mode the budget is capped by `rows` (min(200, rows)) — a session past it still fits", async () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: `reply number ${i}` }] } }));
    const r = mountView({ state: "loaded", messages: long }, { fullscreen: true, rows: 10 });
    await waitFor(() => flat(frame(r.lastFrame)).includes("reply number 59"));
    // The tail is anchored on the true last message; the fullscreen cap keeps this from ever reading past a
    // small budget's worth of rows (proof by absence — the very first reply cannot possibly still be on screen).
    expect(flat(frame(r.lastFrame))).not.toContain("reply number 0 ");
  });
});
