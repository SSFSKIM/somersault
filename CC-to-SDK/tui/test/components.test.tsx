import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Detail } from "../src/Detail.js";
import { Pool } from "../src/Pool.js";
import { StatusBar } from "../src/StatusBar.js";
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

describe("<Pool>", () => {
  const rows: SessionRow[] = [
    { id: "sess-aaaaaaaa", status: "idle", model: "opus", ctxPercent: 12, createdAt: 0 },
    { id: "sess-bbbbbbbb", status: "busy", model: "sonnet", createdAt: 0 },
  ];
  it("lists sessions with id, model and ctx%", () => {
    const { lastFrame } = render(<Pool rows={rows} selectedIndex={0} />);
    expect(lastFrame()).toContain("sess-aaa");
    expect(lastFrame()).toContain("opus");
    expect(lastFrame()).toContain("12%");
    expect(lastFrame()).toContain("Sessions (2)");
  });
  it("shows a placeholder when the pool is empty", () => {
    const { lastFrame } = render(<Pool rows={[]} selectedIndex={0} />);
    expect(lastFrame()).toContain("no live sessions");
  });
});

describe("<StatusBar>", () => {
  it("reflects daemon-up and list-mode key hints", () => {
    const { lastFrame } = render(<StatusBar daemonUp={true} focus="list" status="ready" />);
    expect(lastFrame()).toContain("daemon up");
    expect(lastFrame()).toContain("ready");
    expect(lastFrame()).toContain("q quit");
  });
  it("reflects daemon-down and input-mode hints", () => {
    const { lastFrame } = render(<StatusBar daemonUp={false} focus="input" />);
    expect(lastFrame()).toContain("daemon down");
    expect(lastFrame()).toContain("esc cancel");
  });
});

import { Composer } from "../src/Composer.js";
import { ConfirmDialog } from "../src/ConfirmDialog.js";

const tickInput = () => new Promise((r) => setTimeout(r, 10));

describe("<Composer>", () => {
  it("submits typed text on Enter and clears", async () => {
    const got: string[] = [];
    const { stdin, lastFrame } = render(<Composer onSubmit={(t) => got.push(t)} />);
    await tickInput(); // let TextInput subscribe before writing
    stdin.write("hi there");
    await tickInput();
    expect(lastFrame()).toContain("hi there");
    stdin.write("\r"); // Enter
    await tickInput();
    expect(got).toEqual(["hi there"]);
  });
});

describe("<ConfirmDialog>", () => {
  it("calls onConfirm on 'y'", async () => {
    let confirmed = false, cancelled = false;
    const { stdin, lastFrame } = render(<ConfirmDialog message="Stop session X?" onConfirm={() => (confirmed = true)} onCancel={() => (cancelled = true)} />);
    await tickInput(); // let useInput subscribe before writing
    expect(lastFrame()).toContain("Stop session X?");
    expect(lastFrame()).toContain("(y/n)");
    stdin.write("y");
    await tickInput();
    expect(confirmed).toBe(true);
    expect(cancelled).toBe(false);
  });
  it("calls onCancel on 'n'", async () => {
    let cancelled = false;
    const { stdin } = render(<ConfirmDialog message="m" onConfirm={() => {}} onCancel={() => (cancelled = true)} />);
    await tickInput(); // let useInput subscribe before writing
    stdin.write("n");
    await tickInput();
    expect(cancelled).toBe(true);
  });
});
