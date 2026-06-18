import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Detail } from "../src/Detail.js";
import type { SessionRow } from "cc-harness";

const row: SessionRow = { id: "sess-abc", status: "idle", model: "opus", createdAt: 0 };

describe("<Detail>", () => {
  it("shows the selected session header + a placeholder when no stream", () => {
    const { lastFrame } = render(<Detail row={row} stream={[]} />);
    expect(lastFrame()).toContain("sess-abc");
    expect(lastFrame()).toContain("no output yet");
  });
  it("renders accumulated stream lines (text + tool markers)", () => {
    const stream = [{ type: "assistant", message: { content: [{ type: "text", text: "answer" }, { type: "tool_use", name: "Grep", input: { q: "x" } }] } }];
    const { lastFrame } = render(<Detail row={row} stream={stream} />);
    expect(lastFrame()).toContain("answer");
    expect(lastFrame()).toContain("⚙ Grep(");
  });
  it("shows 'no session selected' when row is undefined", () => {
    const { lastFrame } = render(<Detail stream={[]} />);
    expect(lastFrame()).toContain("no session selected");
  });
});
