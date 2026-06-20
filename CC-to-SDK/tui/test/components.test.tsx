import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatComposer } from "../src/ChatComposer.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transcript } from "../src/Transcript.js";
import { PermissionDialog } from "../src/PermissionDialog.js";
import { ChatStatusBar, modeColor } from "../src/ChatStatusBar.js";
import { SessionPicker } from "../src/SessionPicker.js";
import { TaskPanel } from "../src/TaskPanel.js";
import type { PermissionDecision } from "cc-harness";

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const req = { toolName: "Edit", input: { file_path: "f.ts" }, toolUseID: "t", signal: new AbortController().signal };

describe("<Transcript>", () => {
  it("renders committed and streaming lines", () => {
    const { lastFrame } = render(<Transcript lines={[{ text: "committed" }]} streaming={[{ text: "live" }]} />);
    expect(lastFrame()).toContain("committed");
    expect(lastFrame()).toContain("live");
  });
  it("Transcript renders bold and italic RenderLine fields", () => {
    const { lastFrame } = render(<Transcript lines={[{ text: "B", bold: true }, { text: "I", italic: true }]} streaming={[]} />);
    expect(lastFrame()).toContain("B");
    expect(lastFrame()).toContain("I");
  });
});
describe("<PermissionDialog>", () => {
  it("reconstructs the prompt from toolName+input (no SDK title)", () => {
    const { lastFrame } = render(<PermissionDialog req={req} onDecision={() => {}} />);
    expect(lastFrame()).toContain("Edit");
    expect(lastFrame()).toContain("[a] allow once");
  });
  it("maps a/A/d to allow_once/allow_always/deny", async () => {
    const got: PermissionDecision[] = [];
    const { stdin } = render(<PermissionDialog req={req} onDecision={(d) => got.push(d)} />);
    await new Promise((r) => setTimeout(r, 20)); // let useInput subscribe (passive effect) before non-idempotent keys
    stdin.write("a"); await waitFor(() => got.length === 1);
    stdin.write("A"); await waitFor(() => got.length === 2);
    stdin.write("d"); await waitFor(() => got.length === 3);
    expect(got).toEqual([{ kind: "allow_once" }, { kind: "allow_always" }, { kind: "deny" }]);
  });
});
describe("<ChatStatusBar>", () => {
  it("shows the mode and ctx%", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} ctxPct={42} hasPending={false} />);
    expect(lastFrame()).toContain("default");
    expect(lastFrame()).toContain("42%");
  });
  it("shows the model and a live streaming indicator while busy", () => {
    const { lastFrame } = render(<ChatStatusBar model="claude-sonnet-4-6" mode="default" busy={true} ctxPct={34} hasPending={false} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("claude-sonnet-4-6");
    expect(f).toContain("⟳ streaming");
    expect(f).toContain("ctx 34%");
  });
  it("hides the streaming indicator and model segment when idle/absent", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} ctxPct={10} hasPending={false} />);
    const f = lastFrame() ?? "";
    expect(f).not.toContain("streaming");
    expect(f).not.toContain("model ");
  });
  it("shows a subagent-running indicator", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={true} ctxPct={10} hasPending={false} subagentActive={true} />);
    expect(lastFrame() ?? "").toContain("⚙ subagent running");
  });
  it("hides the subagent indicator when inactive", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={true} ctxPct={10} hasPending={false} subagentActive={false} />);
    expect(lastFrame() ?? "").not.toContain("subagent running");
  });
  it("shows the thinking level", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} hasPending={false} thinkLevel="high" />);
    expect(lastFrame()).toContain("think");
    expect(lastFrame()).toContain("high");
  });
});
describe("SessionPicker", () => {
  const sessions = [
    { sessionId: "aaaaaaaa1111", summary: "first session", lastModified: 1 },
    { sessionId: "bbbbbbbb2222", summary: "second session", lastModified: 2 },
  ];
  it("↓ then Enter picks the second session", async () => {
    let picked: any;
    const { stdin, lastFrame } = render(<SessionPicker sessions={sessions} onPick={(s) => { picked = s; }} onCancel={() => {}} />);
    await waitFor(() => (lastFrame() ?? "").includes("resume a session"));
    await new Promise((r) => setTimeout(r, 20)); // let useInput subscribe (passive effect)
    stdin.write("\x1b[B");                                                    // down arrow
    // wait until bbbbbbbb is highlighted (inverse) — proves selection moved to index 1
    await waitFor(() => (lastFrame() ?? "").match(/\x1b\[7m[^\x1b]*bbbbbbbb/) !== null);
    await new Promise((r) => setTimeout(r, 20)); // let useInput re-register with updated idx closure
    stdin.write("\r");                                                        // enter
    await waitFor(() => picked !== undefined);
    expect(picked.sessionId).toBe("bbbbbbbb2222");
  });
  it("Esc cancels", async () => {
    let cancelled = false;
    const { stdin, lastFrame } = render(<SessionPicker sessions={sessions} onPick={() => {}} onCancel={() => { cancelled = true; }} />);
    await waitFor(() => (lastFrame() ?? "").includes("resume a session"));
    await new Promise((r) => setTimeout(r, 20)); // let useInput subscribe (passive effect)
    stdin.write("\x1b");                                                      // escape
    await waitFor(() => cancelled);
    expect(cancelled).toBe(true);
  });
  it("shows 'no sessions' when empty", () => {
    const { lastFrame } = render(<SessionPicker sessions={[]} onPick={() => {}} onCancel={() => {}} />);
    expect(lastFrame() ?? "").toContain("no sessions");
  });
});

describe("TaskPanel", () => {
  it("renders a glyph per status and the subject", () => {
    const { lastFrame } = render(<TaskPanel tasks={[
      { id: "1", subject: "build the parser", status: "in_progress" },
      { id: "2", subject: "write tests", status: "pending" },
      { id: "3", subject: "ship it", status: "completed" },
    ]} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("▶ build the parser");
    expect(f).toContain("☐ write tests");
    expect(f).toContain("☑ ship it");
    expect(f).toContain("Tasks");
  });
  it("renders nothing when empty", () => {
    const { lastFrame } = render(<TaskPanel tasks={[]} />);
    expect((lastFrame() ?? "").trim()).toBe("");
  });
});

describe("modeColor", () => {
  it("maps each permission mode to a color", () => {
    expect(modeColor("default")).toBe("green");
    expect(modeColor("acceptEdits")).toBe("yellow");
    expect(modeColor("auto")).toBe("cyan");
    expect(modeColor("bypassPermissions")).toBe("red");
  });
});

describe("ChatComposer", () => {
  it("submits on Enter and inserts a newline on \\+Enter", async () => {
    const got: string[] = [];
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={(t) => got.push(t)} cwd={tmpdir()} />);
    await new Promise((r) => setTimeout(r, 20));                  // let useInput subscribe before keys
    // ink timing discipline: await a re-render between dependent keystrokes so each useInput call sees the
    // updated reducer state (a non-functional setState reads a render-time closure; see plan Global Constraints).
    stdin.write("a"); await waitFor(() => (lastFrame() ?? "").includes("a"));
    stdin.write("\\"); await waitFor(() => (lastFrame() ?? "").includes("\\"));   // line now "a\"
    stdin.write("\r"); await new Promise((r) => setTimeout(r, 20));              // `\`+Enter → continuation (2 lines)
    stdin.write("b"); await waitFor(() => (lastFrame() ?? "").includes("b"));
    stdin.write("\r");                                                          // submit "a\nb"
    await waitFor(() => got.length === 1);
    expect(got[0]).toBe("a\nb");
  });
  it("opens the @-popup listing files from the fixture cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-comp-"));
    writeFileSync(join(dir, "alpha.ts"), "x");
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={dir} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("@");
    await waitFor(() => (lastFrame() ?? "").includes("alpha.ts"));
    expect(lastFrame() ?? "").toContain("alpha.ts");
  });
  it("renders a multi-character single-line buffer contiguously (no border bleed)", async () => {
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("hello");
    await waitFor(() => (lastFrame() ?? "").includes("hello"));
    expect(lastFrame() ?? "").toContain("hello");
  });
});
