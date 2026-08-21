// test/tui/fullscreen-prlink.test.tsx — T-PRLINK's visual half. sgr-foldrow.test.ts and toolRenderer.test.tsx
// prove the BYTES are right (composeFoldRun's escape shape, and the stripSgr leak plugged at the
// RenderLine.text boundary); this proves the label actually PAINTS through Ink's real render pipeline once it
// reaches the alt-screen frame — the same OSC-8-aware-clip fix `fullscreen-osc8.test.tsx` documents for a
// file-tool header (Ink's `overflowY`-only clip, string-width's OSC-8 awareness vs slice-ansi's blindness to
// it) applies equally to the group row's `preStyled` clause run, since it too is just a `<Text>` inside the
// same bounded frame. That file's `visible()`/`settle()` pattern is reused verbatim.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { projectCompact, RenderItemView, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { tick } from "./keysTestUtil.js";

const visible = (frame: string | undefined) => (frame ?? "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b]8;;[^\x07]*\x07/g, "");
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body", isError = false) =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } }) as Record<string, unknown>;
const prose = (text: string, id = `t-${text.slice(0, 6)}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
const built = (...messages: Record<string, unknown>[]) => { const doc = new TranscriptDocument(); for (const m of messages) doc.appendSdk("host", m); return doc; };
// `fullscreen: true` is what widens `foldClauses`' policy to reach the PR clause at all (toolFold.ts's
// fullscreen-only branch); `expandHint: ""` blanks the unrelated `(ctrl+o to expand)` chip so the frame's
// text is just the clause sentence.
const FS = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0, fullscreen: true, expandHint: "" };

/** A real `gh pr create` Bash call, scraped by `recognizeGitOps` into a `GitPrOp` with a url, through the
 *  whole fold pipeline to the one collapsed-cluster `RenderItem` it produces. */
const prClauseItem = (): RenderItem => {
  const doc = built(call("bash-1", "Bash", { command: "gh pr create --fill" }), result("bash-1", "https://github.com/o/r/pull/12\n"), prose("done"));
  return projectCompact(doc, FS).find((item) => item.id.startsWith("group:"))!;
};

describe("fullscreen clip boxes pass the PR clause's OSC-8 hyperlink through intact", () => {
  it("the collapsed cluster row's linked `#12` keeps its label, its `PR ` prefix, and its escapes inside the bounded frame", async () => {
    const r = render(
      <FullscreenFrame rows={24} regionChildren={<RenderItemView item={prClauseItem()} />} dock={<Text>dock</Text>} />,
    );
    await settle();
    const frame = r.lastFrame() ?? "";
    expect(visible(frame)).toContain("Created PR #12");                                            // the label the user reads
    expect(frame).toContain("\x1b]8;;https://github.com/o/r/pull/12\x07#12\x1b]8;;\x07");           // the link itself, untruncated
    r.unmount();
  });
});
