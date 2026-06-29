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
import { ModelPicker } from "../src/ModelPicker.js";
import { TaskPanel } from "../src/TaskPanel.js";
import { TurnSpinner } from "../src/TurnSpinner.js";
import { Detail } from "../src/Detail.js";
import { Pool } from "../src/Pool.js";
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
  it("reconstructs a CC-style numbered prompt from toolName+input (no SDK title)", () => {
    const { lastFrame } = render(<PermissionDialog req={req} onDecision={() => {}} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("Allow Claude to use");
    expect(f).toContain("Edit");
    expect(f).toContain("f.ts");                          // the full target shown
    expect(f).toContain("1. Yes");
    expect(f).toContain("don't ask again");
    expect(f).toContain("No, and tell Claude");
  });
  it("shows the full Bash command with a $ prefix", () => {
    const bashReq = { toolName: "Bash", input: { command: "rm -rf build && make" }, toolUseID: "t", signal: new AbortController().signal };
    const f = render(<PermissionDialog req={bashReq} onDecision={() => {}} />).lastFrame() ?? "";
    expect(f).toContain("$ rm -rf build && make");
  });
  it("number keys 1/2/3 and legacy a/A/d both map to allow_once/allow_always/deny", async () => {
    const got: PermissionDecision[] = [];
    const { stdin } = render(<PermissionDialog req={req} onDecision={(d) => got.push(d)} />);
    await new Promise((r) => setTimeout(r, 20)); // let useInput subscribe (passive effect) before non-idempotent keys
    stdin.write("1"); await waitFor(() => got.length === 1);
    stdin.write("2"); await waitFor(() => got.length === 2);
    stdin.write("3"); await waitFor(() => got.length === 3);
    stdin.write("a"); await waitFor(() => got.length === 4);   // legacy shortcuts still work
    expect(got).toEqual([{ kind: "allow_once" }, { kind: "allow_always" }, { kind: "deny" }, { kind: "allow_once" }]);
  });
  it("↓ then Enter selects 'No' (deny); Esc denies directly", async () => {
    const got: PermissionDecision[] = [];
    const a = render(<PermissionDialog req={req} onDecision={(d) => got.push(d)} />);
    await new Promise((r) => setTimeout(r, 20));
    a.stdin.write("\x1b[B"); a.stdin.write("\x1b[B");          // ↓↓ to option 3
    await new Promise((r) => setTimeout(r, 20));
    a.stdin.write("\r"); await waitFor(() => got.length === 1);
    expect(got[0]).toEqual({ kind: "deny" });
    const b = render(<PermissionDialog req={req} onDecision={(d) => got.push(d)} />);
    await new Promise((r) => setTimeout(r, 20));
    b.stdin.write("\x1b"); await waitFor(() => got.length === 2);   // Esc = deny
    expect(got[1]).toEqual({ kind: "deny" });
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

describe("ModelPicker", () => {
  it("renders models and shows the header", () => {
    const models = [{ value: "claude-opus-4-8", displayName: "Opus 4.8", description: "best" }, { value: "sonnet", displayName: "Sonnet" }];
    const { lastFrame } = render(<ModelPicker models={models} onPick={() => {}} onCancel={() => {}} />);
    expect(lastFrame()).toContain("Opus 4.8");
    expect(lastFrame()).toContain("Sonnet");
    expect(lastFrame()).toContain("switch model");
  });
  it("ModelPicker renders models and selects on Enter", async () => {
    const picked: string[] = [];
    const models = [{ value: "claude-opus-4-8", displayName: "Opus 4.8", description: "best" }, { value: "sonnet", displayName: "Sonnet" }];
    const { lastFrame, stdin } = render(<ModelPicker models={models} onPick={(m) => picked.push(m.value)} onCancel={() => {}} />);
    expect(lastFrame()).toContain("Opus 4.8");
    expect(lastFrame()).toContain("Sonnet");
    await new Promise((r) => setTimeout(r, 20));  // let useInput subscribe before keys
    stdin.write("\x1b[B");                        // ↓ to the 2nd model
    await waitFor(() => (lastFrame() ?? "").match(/\x1b\[7m[^\x1b]*Sonnet/) !== null);
    await new Promise((r) => setTimeout(r, 20)); // let useInput re-register with updated idx closure
    stdin.write("\r");                              // Enter
    await waitFor(() => picked.length > 0);
    expect(picked).toEqual(["sonnet"]);
  });
  it("Esc cancels the model picker", async () => {
    let cancelled = false;
    const models = [{ value: "claude-opus-4-8", displayName: "Opus 4.8" }];
    const { stdin, lastFrame } = render(<ModelPicker models={models} onPick={() => {}} onCancel={() => { cancelled = true; }} />);
    await waitFor(() => (lastFrame() ?? "").includes("switch model"));
    await new Promise((r) => setTimeout(r, 0));
    stdin.write("\x1b");
    await waitFor(() => cancelled);
    expect(cancelled).toBe(true);
  });
  it("shows 'no models' when empty", () => {
    const { lastFrame } = render(<ModelPicker models={[]} onPick={() => {}} onCancel={() => {}} />);
    expect(lastFrame() ?? "").toContain("no models");
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

describe("TurnSpinner", () => {
  it("shows the asterisk glyph, the verb, and the esc-to-interrupt status", () => {
    const { lastFrame } = render(<TurnSpinner startedAt={0} verb="Cogitating" now={() => 3000} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("Cogitating…");
    expect(f).toContain("3s");
    expect(f).toContain("esc to interrupt");
    // one of the asterisk-pulse frames must be present
    expect(/[·✢✳✶✻✽]/.test(f)).toBe(true);
  });
  it("shows the live token count once > 0", () => {
    const f = render(<TurnSpinner startedAt={0} verb="Cogitating" tokens={142} now={() => 3000} />).lastFrame() ?? "";
    expect(f).toContain("142 tokens");
  });
});

describe("Detail", () => {
  it("Detail renders the live-state line (mode · ctx · tokens · age · proactive)", () => {
    const row = { id: "sess-1", status: "idle", model: "opus", permissionMode: "acceptEdits", ctxPercent: 42, tokens: 1234, createdAt: 0, proactive: "running" } as any;
    const { lastFrame } = render(<Detail row={row} stream={[]} now={() => 65000} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("acceptEdits");
    expect(f).toContain("42%");
    expect(f).toContain("1234 tok");
    expect(f).toContain("1m");          // 65000ms → 65s → "1m"
    expect(f).toContain("running");
  });
  it("Detail falls back gracefully for a sparse row", () => {
    const row = { id: "s", status: "idle", createdAt: 0 } as any;
    const { lastFrame } = render(<Detail row={row} stream={[]} now={() => 0} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("mode default");
    expect(f).toContain("ctx -");
    expect(f).toContain("idle");
  });
});

describe("Pool", () => {
  it("Pool appends a proactive glyph for a running session", () => {
    const rows = [{ id: "sess-run", status: "idle", model: "opus", ctxPercent: 5, proactive: "running" }] as any;
    const { lastFrame } = render(<Pool rows={rows} selectedIndex={0} />);
    expect(lastFrame()).toContain("▶");        // status is idle (·) → the ▶ is the proactive marker
  });
  it("Pool appends the paused glyph for a paused session", () => {
    const rows = [{ id: "sess-pause", status: "idle", model: "opus", ctxPercent: 5, proactive: "paused" }] as any;
    const { lastFrame } = render(<Pool rows={rows} selectedIndex={0} />);
    expect(lastFrame()).toContain("⏸");        // status is idle (·) → the ⏸ is the proactive marker
    expect(lastFrame()).not.toContain("▶");
  });
  it("Pool shows no proactive glyph for an idle (non-proactive) session", () => {
    const rows = [{ id: "sess-idle", status: "idle", model: "opus", ctxPercent: 5 }] as any;
    const { lastFrame } = render(<Pool rows={rows} selectedIndex={0} />);
    expect(lastFrame()).not.toContain("▶");
    expect(lastFrame()).not.toContain("⏸");
  });
});

describe("ChatComposer", () => {
  it("submits on Enter and inserts a newline on \\+Enter", async () => {
    const got: string[] = [];
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={(t) => got.push(t)} cwd={tmpdir()} commandCatalog={[]} />);
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
  it("Ctrl-D on an empty buffer calls onExit; with text it does not", async () => {
    let exits = 0;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onExit={() => { exits++; }} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x04");                                  // Ctrl-D on empty → exit
    await waitFor(() => exits === 1);
    stdin.write("x"); await waitFor(() => (lastFrame() ?? "").includes("x"));
    stdin.write("\x04");                                  // Ctrl-D with text → no exit
    await new Promise((r) => setTimeout(r, 30));
    expect(exits).toBe(1);
  });
  it("shows the placeholder + footer hint when empty, and hides them once you type", async () => {
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame() ?? "").toContain("Ask Claude anything…");
    expect(lastFrame() ?? "").toContain("⏎ send");
    stdin.write("hi");
    await waitFor(() => (lastFrame() ?? "").includes("hi"));
    expect(lastFrame() ?? "").not.toContain("Ask Claude anything…");   // placeholder gone once typing
  });
  it("shows the bash-mode indicator on a leading '!' and the memory-mode on '#'", async () => {
    const bash = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    bash.stdin.write("!");
    await waitFor(() => (bash.lastFrame() ?? "").includes("bash mode"));
    expect(bash.lastFrame() ?? "").toContain("runs locally");

    const mem = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    mem.stdin.write("#");
    await waitFor(() => (mem.lastFrame() ?? "").includes("memory"));
    expect(mem.lastFrame() ?? "").toContain("CLAUDE.md");
  });
  it("opens the @-popup listing files from the fixture cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-comp-"));
    writeFileSync(join(dir, "alpha.ts"), "x");
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={dir} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("@");
    await waitFor(() => (lastFrame() ?? "").includes("alpha.ts"));
    expect(lastFrame() ?? "").toContain("alpha.ts");
  });
  it("renders a multi-character single-line buffer contiguously (no border bleed)", async () => {
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("hello");
    await waitFor(() => (lastFrame() ?? "").includes("hello"));
    expect(lastFrame() ?? "").toContain("hello");
  });
  it("ChatComposer shows the command palette on '/' and filters as you type", async () => {
    const CAT = [{ name: "brainstorming", description: "plan", source: "catalog" }, { name: "review", description: "review code", source: "catalog" }] as any;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />);
    await new Promise((r) => setTimeout(r, 10));        // let useInput subscribe (passive effect)
    stdin.write("/");
    await new Promise((r) => setTimeout(r, 10));        // open + catalog-injection effect
    expect(lastFrame()).toContain("/brainstorming");
    expect(lastFrame()).toContain("/review");
    stdin.write("rev");
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()).toContain("/review");
    expect(lastFrame()).not.toContain("/brainstorming");
  });
  it("ChatComposer renders a command's argumentHint in the palette row", async () => {
    const CAT = [{ name: "review", description: "review code", argumentHint: "<pr>", source: "catalog" }] as any;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />);
    await new Promise((r) => setTimeout(r, 10));        // let useInput subscribe
    stdin.write("/");
    await new Promise((r) => setTimeout(r, 10));        // open + catalog injection
    expect(lastFrame()).toContain("/review");
    expect(lastFrame()).toContain("<pr>");
    await new Promise((r) => setTimeout(r, 0));
  });
});
