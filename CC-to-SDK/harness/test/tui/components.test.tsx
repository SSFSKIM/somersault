import { describe, it, expect } from "vitest";
import React from "react";
// F2 task 6: ChatApp/ChatComposer read stdin through <KeymapProvider> now, not `useInput` — rendered bare
// they have no input path at all, so every render here goes through the provider wrapper.
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { Box, Text } from "ink";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { applyKey, initialEditorState, type EditorState } from "../../src/tui/editor.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transcript } from "../../src/tui/Transcript.js";
import { TOOL_RESULT_GUTTER, type RenderItem } from "../../src/tui/toolRenderer.js";
import { PermissionDialog } from "../../src/tui/PermissionDialog.js";
import { ChatStatusBar, modeColor, ctxColor } from "../../src/tui/ChatStatusBar.js";
import { SessionPicker } from "../../src/tui/SessionPicker.js";
import { ModelPicker } from "../../src/tui/ModelPicker.js";
import { TaskPanel } from "../../src/tui/TaskPanel.js";
import { TurnSpinner } from "../../src/tui/TurnSpinner.js";
import type { PermissionDecision } from "../../src/index.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

const tok = (name: "success" | "warning" | "error" | "permission") => resolveThemeColor(themeTokens()[name]);

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const req = { toolName: "Edit", input: { file_path: "f.ts" }, toolUseID: "t", signal: new AbortController().signal };

describe("<Transcript>", () => {
  // F1 Task 4: every Transcript consumer speaks RenderItem now — including Task 2's raw-color boundary,
  // which still has to resolve a TH2 color no matter which region the item lands in.
  it("renders immutable, pending, and streaming transcript regions through the RenderItem interface", () => {
    const staticItems: RenderItem[] = [
      { kind: "line", id: "committed", line: { text: "committed" } },
      { kind: "line", id: "colored", line: { text: "", gutter: { text: ">", color: "ansi:red" }, segments: [{ text: "segment", color: "ansi:blue" }] } },
      { kind: "line", id: "line-color", line: { text: "line", color: "ansi:green" } },
      { kind: "line", id: "bold", line: { text: "B", bold: true } },
      { kind: "line", id: "italic", line: { text: "I", italic: true } },
    ];
    const pendingItems: RenderItem[] = [{ kind: "line", id: "pending", line: { text: "pending" } }];
    const view = render(<Transcript staticItems={staticItems} pendingItems={pendingItems} streaming={[{ text: "live" }]} />);
    for (const text of ["committed", "pending", "live", "B", "I"]) expect(view.lastFrame()).toContain(text);
    const raw = view.stdout.frames.at(-1)!; expect(raw).toContain("\x1b[31m"); expect(raw).toContain("\x1b[34m"); expect(raw).toContain("\x1b[32m");
  });
  it("renders a tool result body under exactly one shared gutter, never a hand-typed connector", () => {
    const items: RenderItem[] = [{ kind: "gutter-block", id: "b", gutter: TOOL_RESULT_GUTTER, body: [{ text: "first" }, { text: "second" }] }];
    const view = render(<Transcript staticItems={items} pendingItems={[]} streaming={[]} />);
    const frame = view.lastFrame() ?? "";
    expect(frame).toContain("first"); expect(frame).toContain("second");
    expect(frame.split("⎿")).toHaveLength(2);      // one connector for a two-row body
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
  it("attribution: subagentType renders 'Subagent (code-reviewer) asks:'", () => {
    const attributed = { ...req, subagentType: "code-reviewer" };
    const f = render(<PermissionDialog req={attributed} onDecision={() => {}} />).lastFrame() ?? "";
    expect(f).toContain("Subagent (code-reviewer) asks:");
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
  it("bare y accepts and bare n rejects (KB1, F0 acceptance 7)", async () => {
    const decisions: PermissionDecision[] = [];
    const bashReq = { toolName: "Bash", input: { command: "ls" }, toolUseID: "t", signal: new AbortController().signal };
    const a = render(<PermissionDialog req={bashReq} onDecision={(d) => decisions.push(d)} />);
    await new Promise((r) => setTimeout(r, 20)); // let useInput subscribe (passive effect) before non-idempotent keys
    a.stdin.write("y");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "allow_once" });
    const b = render(<PermissionDialog req={bashReq} onDecision={(d) => decisions.push(d)} />);
    await new Promise((r) => setTimeout(r, 20));
    b.stdin.write("n");
    await waitFor(() => decisions.length === 2);
    expect(decisions[1]).toEqual({ kind: "deny" });
  });
  it("never treats modified y/n chords as permission decisions", async () => {
    const decisions: PermissionDecision[] = [];
    const view = render(<PermissionDialog req={req} onDecision={(d) => decisions.push(d)} />);
    await new Promise((r) => setTimeout(r, 20));
    for (const input of ["\x19", "\x0e", "\x1by", "\x1bn"]) { // Ctrl-Y, Ctrl-N, Alt-Y, Alt-N
      view.stdin.write(input);
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(decisions).toEqual([]);
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
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} ctxPct={42} />);
    expect(lastFrame()).toContain("default");
    expect(lastFrame()).toContain("42%");
  });
  it("shows the model and a live streaming indicator while busy", () => {
    const { lastFrame } = render(<ChatStatusBar model="claude-sonnet-4-6" mode="default" busy={true} ctxPct={34} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("claude-sonnet-4-6");
    expect(f).toContain("⟳ streaming");
    expect(f).toContain("ctx 34%");
  });
  it("hides the streaming indicator and model segment when idle/absent", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} ctxPct={10} />);
    const f = lastFrame() ?? "";
    expect(f).not.toContain("streaming");
    expect(f).not.toContain("model ");
  });
  it("warns about auto-compact once context is near the window", () => {
    const f = render(<ChatStatusBar mode="default" busy={false} ctxPct={85} />).lastFrame() ?? "";
    expect(f).toContain("85%");
    expect(f).toContain("auto-compact soon");
    const lo = render(<ChatStatusBar mode="default" busy={false} ctxPct={20} />).lastFrame() ?? "";
    expect(lo).not.toContain("auto-compact");
  });
  it("shows the thinking level", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} thinkLevel="high" />);
    expect(lastFrame()).toContain("think");
    expect(lastFrame()).toContain("high");
  });
  it("shows the bg-task count when bgCount is set", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} bgCount={2} />);
    expect(lastFrame()).toContain("⚙ 2 bg");
  });
  it("hides the bg-task count when bgCount is 0/undefined", () => {
    const zero = render(<ChatStatusBar mode="default" busy={false} bgCount={0} />).lastFrame() ?? "";
    expect(zero).not.toContain("bg");
    const absent = render(<ChatStatusBar mode="default" busy={false} />).lastFrame() ?? "";
    expect(absent).not.toContain("bg");
  });
  it("renders status metadata without editor-owned keyboard affordances", () => {
    const f = render(<ChatStatusBar mode="default" busy={true} ctxPct={42} />).lastFrame() ?? "";
    expect(f).toContain("mode");
    expect(f).toContain("⟳ streaming");
    expect(f).not.toContain("Esc interrupt");
    expect(f).not.toContain("Esc rewind");
    expect(f).not.toContain("Esc clear");
    expect(f).not.toContain("? help");
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
  it("maps each permission mode to its §2.2 semantic token, resolved for Ink", () => {
    expect(modeColor("default")).toBe(tok("success"));
    expect(modeColor("acceptEdits")).toBe(tok("warning"));
    expect(modeColor("auto")).toBe(tok("permission"));
    expect(modeColor("bypassPermissions")).toBe(tok("error"));
  });
});

describe("ctxColor", () => {
  it("escalates unstyled → `warning` → `error` as context fills", () => {
    expect(ctxColor(20)).toBeUndefined();
    expect(ctxColor(60)).toBe(tok("warning"));
    expect(ctxColor(85)).toBe(tok("error"));
  });
});

describe("TurnSpinner", () => {
  // NB: startedAt is a real epoch stamp in production, so these fakes use one too. They previously
  // passed startedAt={0}, which is exactly the unset value the guard below now treats as "just
  // started" — written that way they were asserting the buggy contract.
  it("shows the asterisk glyph, the verb, and the esc-to-interrupt status", () => {
    const { lastFrame } = render(<TurnSpinner startedAt={1000} verb="Cogitating" now={() => 4000} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("Cogitating…");
    expect(f).toContain("3s");
    expect(f).toContain("esc to interrupt");
    // one of the asterisk-pulse frames must be present
    expect(/[·✢✳✶✻✽]/.test(f)).toBe(true);
  });
  it("shows the live token count once > 0", () => {
    const f = render(<TurnSpinner startedAt={1000} verb="Cogitating" tokens={142} now={() => 4000} />).lastFrame() ?? "";
    expect(f).toContain("142 tokens");
  });
  // Regression, found ONLY in the real binary (pty acceptance, w3.9): useChat sets busy and the start
  // stamp in two setState calls that do not commit together, so the first painted frame of a turn has
  // busy=true and startedAt=0. Unguarded, `now() - 0` is ms since 1970 and the tail read
  // "(29758130m 59s · esc to interrupt)" for one frame before settling to 0s.
  it("treats an unset (0) start stamp as just-started instead of measuring from the epoch", () => {
    const f = render(<TurnSpinner startedAt={0} verb="Cogitating" now={() => 1.7845e12} />).lastFrame() ?? "";
    expect(f).toContain("0s");
    expect(f).not.toMatch(/\d{4,}m/);        // no "29758130m" — the epoch-elapsed signature
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
  it("routes ⇧Tab→onCycleMode and Esc→onInterrupt when no popup is open; bare Tab does not cycle", async () => {
    let cycles = 0, interrupts = 0;
    const { stdin } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onCycleMode={() => cycles++} onInterrupt={() => interrupts++} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\t");   await new Promise((r) => setTimeout(r, 20));   // bare Tab: no popup → no-op
    expect(cycles).toBe(0);
    stdin.write("\x1b[Z"); await waitFor(() => cycles === 1);           // Shift+Tab (backtab) cycles
    stdin.write("\x1b"); await waitFor(() => interrupts === 1);
    expect([cycles, interrupts]).toEqual([1, 1]);
  });
  it("makes Ctrl-Z invisible to editor metadata so yank-pop remains executable after suspension", async () => {
    const ctrl = { ctrl: true };
    let state = initialEditorState();
    for (const char of "one") state = applyKey(state, char, {}).state;
    state = applyKey(state, "u", ctrl).state;
    for (const char of "two") state = applyKey(state, char, {}).state;
    state = applyKey(state, "u", ctrl).state;
    state = applyKey(state, "y", ctrl).state;
    const editorStateRef = { current: state } as React.MutableRefObject<EditorState>;
    const beforeSuspend = structuredClone(state);
    const { stdin, lastFrame } = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame() ?? "").toContain("two");
    stdin.write("\x1a");
    await new Promise((r) => setTimeout(r, 20));
    expect(editorStateRef.current).toEqual(beforeSuspend);
    stdin.write("\x1by");
    await waitFor(() => (lastFrame() ?? "").includes("one"));
  });

  it("keeps an armed local clear untouched by Ctrl-Z", async () => {
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} escClearMs={10000} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("draft"); await waitFor(() => (lastFrame() ?? "").includes("draft"));
    stdin.write("\x1b"); await waitFor(() => (lastFrame() ?? "").includes("Esc again to clear"));
    stdin.write("\x1a");
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame() ?? "").toContain("Esc again to clear");
    expect(lastFrame() ?? "").toContain("draft");
  });

  it("ends pending yank-pop for every composer-owned non-kill intercept but leaves Ctrl-Z exact", async () => {
    const ctrl = { ctrl: true };
    const makeYankedState = () => {
      let editor = initialEditorState();
      for (const char of "one") editor = applyKey(editor, char, {}).state;
      editor = applyKey(editor, "u", ctrl).state;
      for (const char of "two") editor = applyKey(editor, char, {}).state;
      editor = applyKey(editor, "u", ctrl).state;
      return applyKey(editor, "y", ctrl).state;
    };
    const makeEmptyPendingState = () => ({ ...makeYankedState(), lines: [""], cursor: { row: 0, col: 0 } });
    const exercise = async (trigger: (stdin: { write(input: string): void }) => void | Promise<void>, props: Record<string, unknown> = {}, assertCallback: () => void = () => {}, initialState = makeYankedState()) => {
      const editorStateRef = { current: initialState } as React.MutableRefObject<EditorState>;
      const view = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} {...props as any} />);
      await new Promise((r) => setTimeout(r, 20));
      expect(editorStateRef.current.yankSite).not.toBeNull();
      await trigger(view.stdin);
      await waitFor(() => editorStateRef.current.yankSite === null);
      expect(editorStateRef.current.killRun).toBe(false);
      expect(editorStateRef.current.lines).toEqual(initialState.lines);
      assertCallback();
      view.stdin.write("\x1by");
      await new Promise((r) => setTimeout(r, 20));
      expect(editorStateRef.current.lines).toEqual(initialState.lines);
      view.unmount();
    };

    await exercise((stdin) => stdin.write("\x1b"));

    let modeCycles = 0;
    await exercise((stdin) => stdin.write("\x1b[Z"), { onCycleMode: () => modeCycles++ }, () => expect(modeCycles).toBe(1));

    // F2 task 6: a BARE Ctrl-X is no longer a composer-owned intercept. The resolver's chord machine
    // consumes it as a pending prefix (the bespoke 2 s timestamp ref it used to set is deleted), so it
    // reaches neither the editor nor the kill/yank bookkeeping — the run now ends when the chord COMPLETES,
    // which is what the two chord cases below assert. What must still hold of the prefix alone: it inserts
    // nothing and changes no buffer.
    {
      const editorStateRef = { current: makeYankedState() } as React.MutableRefObject<EditorState>;
      const view = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
      await new Promise((r) => setTimeout(r, 20));
      view.stdin.write("\x18");
      await new Promise((r) => setTimeout(r, 20));
      expect(editorStateRef.current.lines).toEqual(makeYankedState().lines);
      expect(editorStateRef.current.yankSite).not.toBeNull();   // the swallowed prefix must not end the yank run
      view.unmount();
    }

    let externalEdits = 0;
    await exercise((stdin) => stdin.write("\x07"), { editExternal: () => { externalEdits++; return null; } }, () => expect(externalEdits).toBe(1));

    let chordEdits = 0;
    await exercise(async (stdin) => { stdin.write("\x18"); await new Promise((r) => setTimeout(r, 20)); stdin.write("\x05"); }, { editExternal: () => { chordEdits++; return null; } }, () => expect(chordEdits).toBe(1));

    let killedAgents = 0;
    await exercise(async (stdin) => { stdin.write("\x18"); await new Promise((r) => setTimeout(r, 20)); stdin.write("\x0b"); }, { onKillAgents: () => killedAgents++ }, () => expect(killedAgents).toBe(1));

    let interrupts = 0;
    await exercise((stdin) => stdin.write("\x1b"), { busy: true, onInterrupt: () => interrupts++ }, () => expect(interrupts).toBe(1));

    let emptyInterrupts = 0;
    await exercise((stdin) => stdin.write("\x1b"), { onInterrupt: () => emptyInterrupts++ }, () => expect(emptyInterrupts).toBe(1), makeEmptyPendingState());

    let helps = 0;
    await exercise((stdin) => stdin.write("?"), { onHelp: () => helps++ }, () => expect(helps).toBe(1), makeEmptyPendingState());

    let exits = 0;
    await exercise(async (stdin) => { stdin.write("\x04"); await new Promise((r) => setTimeout(r, 20)); stdin.write("\x04"); }, { onExit: () => exits++ }, () => expect(exits).toBe(1), makeEmptyPendingState());

    const editorStateRef = { current: makeYankedState() } as React.MutableRefObject<EditorState>;
    const beforeSuspend = structuredClone(editorStateRef.current);
    const suspended = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    suspended.stdin.write("\x1a");
    await new Promise((r) => setTimeout(r, 20));
    expect(editorStateRef.current).toEqual(beforeSuspend);
    suspended.stdin.write("\x1by");
    await waitFor(() => editorStateRef.current.lines.join("\n") === "one");
    suspended.unmount();
  });

  it("with a / popup open, Tab/Esc are consumed by the popup (NO global cycle/interrupt — fixes the double-handler)", async () => {
    let cycles = 0, interrupts = 0;
    const a = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onCycleMode={() => cycles++} onInterrupt={() => interrupts++} />);
    await new Promise((r) => setTimeout(r, 20));
    a.stdin.write("/"); await waitFor(() => (a.lastFrame() ?? "").includes("/"));   // command popup open
    a.stdin.write("\x1b"); await new Promise((r) => setTimeout(r, 30));             // Esc → closes popup, not interrupt
    expect(interrupts).toBe(0);
    const b = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onCycleMode={() => cycles++} onInterrupt={() => interrupts++} />);
    await new Promise((r) => setTimeout(r, 20));
    b.stdin.write("/"); await waitFor(() => (b.lastFrame() ?? "").includes("/"));
    b.stdin.write("\t"); await new Promise((r) => setTimeout(r, 30));               // Tab → completes, not cycle
    expect(cycles).toBe(0);
  });
  it("Ctrl-D on an empty composer needs two presses (KB3): first arms a hint and does not exit, second within the window exits; with text it does nothing", async () => {
    let exits = 0;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onExit={() => { exits++; }} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x04");                                  // first Ctrl-D on empty → arms, does not exit
    await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));
    expect(exits).toBe(0);
    stdin.write("\x04");                                  // second Ctrl-D within the window → exits
    await waitFor(() => exits === 1);
    stdin.write("x"); await waitFor(() => (lastFrame() ?? "").includes("x"));
    stdin.write("\x04");                                  // Ctrl-D with text → no-op (not an empty composer)
    await new Promise((r) => setTimeout(r, 30));
    expect(exits).toBe(1);
  });
  it("Ctrl-D stays armed across an intervening key but only advertises an executable exit", async () => {
    let exits = 0;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onExit={() => { exits++; }} exitArmMs={10000} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x04"); await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));
    stdin.write("x"); await waitFor(() => (lastFrame() ?? "").includes("x"));
    expect(lastFrame() ?? "").not.toContain("Press Ctrl-D again to exit");
    stdin.write("\x04");                                      // Ctrl-D is a no-op while text makes exit impossible
    await new Promise((r) => setTimeout(r, 30));
    expect(exits).toBe(0);
    stdin.write("\x15");                                      // the upstream arm survives; emptying restores an executable second press
    await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));
    stdin.write("\x04"); await waitFor(() => exits === 1);
  });
  it("Ctrl-D's arm expires after exitArmMs — a press after the window re-arms instead of exiting", async () => {
    let exits = 0;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onExit={() => { exits++; }} exitArmMs={40} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x04");
    await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));
    await new Promise((r) => setTimeout(r, 60));          // let the arm expire
    stdin.write("\x04");
    await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));   // re-armed, not exited
    expect(exits).toBe(0);
  });
  it("shows the placeholder + footer hint when empty, and hides them once you type", async () => {
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame() ?? "").toContain("sk Claude anything…");
    expect(lastFrame() ?? "").toContain("⏎ send");
    expect(lastFrame() ?? "").toContain("Esc rewind · ? help");
    stdin.write("hi");
    await waitFor(() => (lastFrame() ?? "").includes("hi"));
    expect(lastFrame() ?? "").not.toContain("sk Claude anything…");   // placeholder gone once typing
    expect(lastFrame() ?? "").not.toContain("? help");                 // '?' inserts in a non-empty draft
  });
  it("hides the Esc-clear hint on the first busy render and does not resurrect after idle", async () => {
    const view = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy={false} />);
    await new Promise((r) => setTimeout(r, 20));
    view.stdin.write("draft"); await waitFor(() => (view.lastFrame() ?? "").includes("draft"));
    view.stdin.write("\x1b"); await waitFor(() => (view.lastFrame() ?? "").includes("Esc again to clear"));
    view.rerender(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy />);
    expect(view.lastFrame() ?? "").not.toContain("Esc again to clear");
    view.rerender(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy={false} />);
    expect(view.lastFrame() ?? "").not.toContain("Esc again to clear");
    view.stdin.write("\x1b"); await waitFor(() => (view.lastFrame() ?? "").includes("Esc again to clear"));
    expect(view.lastFrame() ?? "").toContain("draft");
  });

  it("clears an Esc-clear arm when busy starts and before early-return chords", async () => {
    const busyView = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy={false} />);
    await new Promise((r) => setTimeout(r, 20));
    busyView.stdin.write("draft"); await waitFor(() => (busyView.lastFrame() ?? "").includes("draft"));
    busyView.stdin.write("\x1b"); await waitFor(() => (busyView.lastFrame() ?? "").includes("Esc again to clear"));
    busyView.rerender(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy />);
    await waitFor(() => !(busyView.lastFrame() ?? "").includes("Esc again to clear"));

    for (const chord of ["\x1b[Z", "\x18\x07"]) {
      const view = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} onCycleMode={() => {}} editExternal={() => null} />);
      await new Promise((r) => setTimeout(r, 20));
      view.stdin.write("draft"); await waitFor(() => (view.lastFrame() ?? "").includes("draft"));
      view.stdin.write("\x1b"); await waitFor(() => (view.lastFrame() ?? "").includes("Esc again to clear"));
      if (chord === "\x1b[Z") view.stdin.write(chord); else { view.stdin.write("\x18"); view.stdin.write("\x07"); }
      // The external-editor chord now runs inside the keymap's `suspendInput` (t2 review): for as long as the
      // editor holds the terminal the provider reads NOTHING, so a key written in the same synchronous breath as
      // the chord is dropped rather than raced. This fake editor settles on the next microtask; wait for it.
      await new Promise((r) => setTimeout(r, 0));
      view.stdin.write("\x1b"); await waitFor(() => (view.lastFrame() ?? "").includes("Esc again to clear"));
      expect(view.lastFrame() ?? "").toContain("draft");
      view.stdin.write("\x1b"); await waitFor(() => !(view.lastFrame() ?? "").includes("draft"));
    }
  });
  it("uses callback props from the latest render immediately after rerender", async () => {
    let oldSubmit = 0, currentSubmit = 0, oldInterrupt = 0, currentInterrupt = 0;
    const view = render(<ChatComposer onSubmit={() => { oldSubmit++; }} onInterrupt={() => { oldInterrupt++; }} cwd="/" commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    view.stdin.write("draft"); await waitFor(() => (view.lastFrame() ?? "").includes("draft"));
    view.rerender(<ChatComposer onSubmit={() => { currentSubmit++; }} onInterrupt={() => { currentInterrupt++; }} cwd="/" commandCatalog={[]} />);
    view.stdin.write("\r");
    await waitFor(() => currentSubmit === 1);
    expect(oldSubmit).toBe(0);
    view.stdin.write("\x1b");
    await waitFor(() => currentInterrupt === 1);
    expect(oldInterrupt).toBe(0);
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

describe("Wave-1 keymap wiring", () => {
  it("Shift+Tab cycles mode; bare Tab does not (no popup open)", async () => {
    let cycles = 0;
    const { stdin } = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} onCycleMode={() => { cycles++; }} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 20));
    expect(cycles).toBe(0);
    stdin.write("\x1b[Z");                                   // shift+tab (backtab)
    await new Promise((r) => setTimeout(r, 20));
    expect(cycles).toBe(1);
  });
  it("Ctrl-X Ctrl-E routes the buffer through the injected external editor; Ctrl-G does too", async () => {
    const edits: string[] = [];
    const fakeEdit = (t: string) => { edits.push(t); return "from-editor"; };
    const submitted: string[] = [];
    const { stdin } = render(<ChatComposer onSubmit={(t) => submitted.push(t)} cwd="/" commandCatalog={[]} editExternal={fakeEdit} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("hi");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x18");                                     // Ctrl-X
    stdin.write("\x05");                                     // Ctrl-E (within the chord window)
    await new Promise((r) => setTimeout(r, 20));
    expect(edits).toEqual(["hi"]);
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toEqual(["from-editor"]);
    stdin.write("\x07");                                     // Ctrl-G — no chord needed
    await new Promise((r) => setTimeout(r, 20));
    expect(edits).toEqual(["hi", ""]);
  });
  it("a nonempty external-editor replacement notifies the parent draft owner exactly once; an empty replacement does not", async () => {
    let starts = 0;
    const edited = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} onDraftStart={() => { starts++; }} editExternal={() => "from-editor"} />);
    await new Promise((r) => setTimeout(r, 20));
    edited.stdin.write("\x07");                                // Ctrl-G opens the external editor from an empty composer
    await waitFor(() => (edited.lastFrame() ?? "").includes("from-editor"));
    expect(starts).toBe(1);

    let emptyStarts = 0;
    const empty = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} onDraftStart={() => { emptyStarts++; }} editExternal={() => ""} />);
    await new Promise((r) => setTimeout(r, 20));
    empty.stdin.write("\x07");
    await new Promise((r) => setTimeout(r, 20));
    expect(emptyStarts).toBe(0);
  });

  it("external-editor text synchronously removes the parent's rewind arm before its first draft frame", async () => {
    function RewindHarness() {
      const [rewindArmed, setRewindArmed] = React.useState(false);
      return <Box flexDirection="column">
        <ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} onInterrupt={() => setRewindArmed(true)} onDraftStart={() => setRewindArmed(false)} editExternal={() => "from-editor"} />
        {rewindArmed ? <Text>Press Esc again to rewind</Text> : null}
      </Box>;
    }
    const { stdin, lastFrame } = render(<RewindHarness />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x1b");
    await waitFor(() => (lastFrame() ?? "").includes("Press Esc again to rewind"));
    stdin.write("\x07");
    await waitFor(() => (lastFrame() ?? "").includes("from-editor"));
    expect(lastFrame() ?? "").not.toContain("Press Esc again to rewind");
    expect(lastFrame() ?? "").toContain("Esc clear");
    stdin.write("\x1b");
    await waitFor(() => (lastFrame() ?? "").includes("Esc again to clear"));
  });

  it("chord completes but editExternal returns null → the ORIGINAL buffer is preserved (not cleared)", async () => {
    const submitted: string[] = [];
    const { stdin } = render(<ChatComposer onSubmit={(t) => submitted.push(t)} cwd="/" commandCatalog={[]} editExternal={() => null} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("keep me");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x18");                                     // Ctrl-X
    stdin.write("\x05");                                     // Ctrl-E (within the chord window) — editExternal() returns null
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");                                        // submit
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toEqual(["keep me"]);
  });
  it("Ctrl-E alone (no recent Ctrl-X) is still line-end, not the editor", async () => {
    const edits: string[] = [];
    const { stdin } = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} editExternal={(t) => { edits.push(t); return null; }} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x05");
    await new Promise((r) => setTimeout(r, 20));
    expect(edits).toEqual([]);
  });

  it("Ctrl-X Ctrl-K fires onKillAgents; bare Ctrl-K still kills to end of line", async () => {
    let killed = 0;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={[]} onKillAgents={() => { killed++; }} />);
    await new Promise((r) => setTimeout(r, 20));                // useInput subscribes in a passive effect
    stdin.write("abcd");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x18");                                        // Ctrl-X arms the chord
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x0b");                                        // Ctrl-K within the window → killAgents, NOT kill-to-end
    await new Promise((r) => setTimeout(r, 20));
    expect(killed).toBe(1);
    expect(lastFrame()).toContain("abcd");                      // buffer untouched by the chorded Ctrl-K
    stdin.write("\x01");                                        // Ctrl-A → line start
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x0b");                                        // bare Ctrl-K (no chord) → kill to end
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()).not.toContain("abcd");
    expect(killed).toBe(1);                                     // the bare Ctrl-K did not also fire onKillAgents
  });
});
