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
import { modeColor } from "../../src/tui/modeTable.js";
import { ComposerWithFooter } from "./helpers/composerFooter.js";
import { TurnSpinner } from "../../src/tui/TurnSpinner.js";
import { IDLE_METER, type SpinnerMeter } from "../../src/tui/liveTurn.js";
import type { PermissionDecision } from "../../src/index.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");   // ShortcutsOverlay.test.tsx's own idiom

const tok = (name: "success" | "warning" | "error" | "permission" | "inactive" | "planMode" | "autoAccept") => resolveThemeColor(themeTokens()[name]);

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
// F6 T7/T8: this block pins the GENERIC body reached THROUGH the switchboard, so its request must name a tool
// the switchboard leaves generic. `Edit` used to be one; it is not any more — every file tool that derives a
// path (and Edit with a `file_path` does) now routes to `FilePermission`. An MCP tool is the durable choice:
// `permissionKind`'s registry claims no MCP name. T8 replaced the pre-F6 body these tests were written
// against with `GenericPermission` (`Gal` L506118), which is why every expectation below moved — the frame is
// the `Ed` rule and `Tool use` now, the option list is a real `Select`, and "don't ask again" writes a
// localSettings rule instead of the old in-memory `allow_always`. The body's own suite is
// `small-permissions.test.tsx`; what stays here is the switchboard-level contract.
const req = { toolName: "mcp__notes__append", input: { note: "f.ts" }, toolUseID: "t", signal: new AbortController().signal };

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
  // The F6 `Select` dims its index column, so the digit and its label are separated by an SGR reset in the
  // raw frame — every expectation on a row reads the STRIPPED frame.
  it("renders the generic body's `Tool use` frame from toolName+input alone (no SDK title)", () => {
    const { lastFrame } = render(<PermissionDialog req={req} onDecision={() => {}} />);
    const f = (lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    expect(f).toContain("Tool use");
    expect(f).toContain("mcp__notes__append");
    expect(f).toContain("f.ts");                          // the full target shown
    expect(f).toContain("1. Yes");
    expect(f).toContain("don't ask again");
    expect(f).toContain("No");
    expect(f).not.toContain("Allow Claude to use");       // the pre-F6 reconstruction is gone (T8)
  });
  it("attribution rides the TITLE now (DG21), not a line above the box", () => {
    const attributed = { ...req, subagentType: "code-reviewer" };
    const f = render(<PermissionDialog req={attributed} onDecision={() => {}} />).lastFrame() ?? "";
    expect(f).toContain("from the code-reviewer agent");
    expect(f).not.toContain("Subagent (code-reviewer) asks:");
  });
  it("number keys 1/2/3 and the legacy letters still answer through the switchboard", async () => {
    const got: PermissionDecision[] = [];
    const { stdin } = render(<PermissionDialog req={req} cwd="/repo" onDecision={(d) => got.push(d)} />);
    await new Promise((r) => setTimeout(r, 20)); // let the provider subscribe (passive effect) before non-idempotent keys
    stdin.write("1"); await waitFor(() => got.length === 1);
    stdin.write("2"); await waitFor(() => got.length === 2);
    stdin.write("3"); await waitFor(() => got.length === 3);
    stdin.write("a"); await waitFor(() => got.length === 4);   // legacy shortcuts still work
    // Row 2 is `gtm`'s whole-tool localSettings rule now — the old in-memory `allow_always` is dead (T8).
    expect(got).toEqual([
      { kind: "allow_once" },
      { kind: "allow_with_updates", updatedPermissions: [{ type: "addRules", rules: [{ toolName: "mcp__notes__append" }], behavior: "allow", destination: "localSettings" }] },
      { kind: "deny" },
      { kind: "allow_once" },
    ]);
  });
  it("bare y accepts and bare n rejects (KB1, F0 acceptance 7)", async () => {
    // …on the GENERIC body (the Bash body has its own y/n test in bash-permission.test.tsx).
    const decisions: PermissionDecision[] = [];
    const bashReq = req;
    const a = render(<PermissionDialog req={bashReq} onDecision={(d) => decisions.push(d)} />);
    await new Promise((r) => setTimeout(r, 20)); // let the provider subscribe (passive effect) before non-idempotent keys
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
// WAVE C TASK 2 (EP-C1b) — THE `<ChatStatusBar>` BLOCK THAT STOOD HERE RETIRED WITH THE COMPONENT. Its
// nine cases did not vanish; they went one of three ways, and every one of them is named so this reads as a
// migration rather than a deletion:
//   · mode chip, cycle parenthetical, bg count → `test/tui/footer.test.tsx`, in upstream's own shapes
//     (`⏸ manual mode on`, `(shift+tab to cycle)`, `← for agents` — the last is what `⚙ N bg` became);
//   · the `model` / `think` segments → they have NO upstream footer counterpart and left the always-on row
//     with the bar (spec EP-C1, the owner-decision list). `/status` and `/model` still report both;
//   · `ctx N%`, `⚠ auto-compact soon` and `usageWarn` → the SAME decision, but they come BACK as queued
//     notifications (upstream's `token-warning`, annex §C1.6) in Wave C Task 14, which owns their removal
//     suite. `ctxColor` died with the chip and its two cases go there with it — deliberately not re-pinned
//     here against a component that no longer exists.

// The SessionPicker and ModelPicker blocks that stood here retired with F6 T11: both pickers were rebuilt on
// the `Select` primitive and grew surfaces these four-line smoke tests could not describe (search, preview,
// rename; the default-vs-session split, the ten-row window and its overflow counter). They are covered in
// full by `session-picker.test.tsx` and `model-picker.test.tsx` — moved deliberately, not dropped.

// The TaskPanel block that stood here retired with F6 T13, for the same reason the SessionPicker and
// ModelPicker ones did above: the panel was rebuilt to upstream's anatomy (a counts header, ✔/◼/◻ with
// strikethrough/bold/dim attributes, owner + blocker + activity decorations, a height-derived window) and a
// three-glyph smoke test cannot describe it. `task-panel.test.tsx` covers it in full — moved, not dropped.

describe("modeColor", () => {
  // WAVE C TASK 2: `modeColor` moved from `ChatStatusBar.tsx` to `modeTable.ts` and its mapping is now
  // upstream's `gGl` table (annex §C4.c) rather than our invented one. TWO entries moved with it: `default`
  // was `success` and is `inactive` (upstream paints the home chip grey, not green), `auto` was `permission`
  // and is `warning`. `plan`, which the old function had no entry for at all, is `planMode`.
  it("maps each permission mode to upstream's own §2.2 token, resolved for Ink", () => {
    expect(modeColor("default")).toBe(tok("inactive"));
    expect(modeColor("plan")).toBe(tok("planMode"));
    expect(modeColor("acceptEdits")).toBe(tok("autoAccept"));
    expect(modeColor("auto")).toBe(tok("warning"));
    expect(modeColor("bypassPermissions")).toBe(tok("error"));
  });
});

describe("TurnSpinner", () => {
  // NB: startedAt is a real epoch stamp in production, so these fakes use one too. They previously
  // passed startedAt={0}, which is exactly the unset value the guard below now treats as "just
  // started" — written that way they were asserting the buggy contract.
  //
  // WAVE C TASK 6 rewrote the tail. `esc to interrupt` left it (canon's `C0p` parenthetical has no such
  // segment; the offer is a footer hint again), the token count became an eased estimate off the meter's
  // character target, and every segment sits behind a width gate plus a 16 s quiet threshold — which is
  // why the first case below now asserts that a short quiet turn says NOTHING after the gerund.
  const meter = (over: Partial<SpinnerMeter> = {}): SpinnerMeter => ({ ...IDLE_METER, ...over });

  it("shows the asterisk glyph and the verb, and stays quiet for the first sixteen seconds", () => {
    const { lastFrame } = render(<TurnSpinner startedAt={1000} verb="Cogitating" now={() => 4000} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("Cogitating…");
    expect(f).not.toContain("3s");
    expect(f).not.toContain("(");
    // one of the asterisk-pulse frames must be present
    expect(/[·✢✳✶✻✽]/.test(f)).toBe(true);
  });
  it("opens the parenthetical once the turn has run past the quiet threshold", () => {
    const f = render(<TurnSpinner startedAt={1000} verb="Cogitating" now={() => 21000} />).lastFrame() ?? "";
    expect(f).toContain("(20s)");
  });
  it("carries the phase and the arrow the moment the wire says the model is thinking", () => {
    const f = render(<TurnSpinner startedAt={1000} verb="Cogitating" now={() => 4000}
      meter={meter({ mode: "thinking", isThinking: true, lastBurst: { startedAt: 4000 } })} />).lastFrame() ?? "";
    expect(f).toContain("(3s · thinking)");
  });
  it("eases the token estimate up to the meter's character target instead of stepping to it", async () => {
    // The count starts at zero and walks: upstream animates `responseLength` toward the real figure and
    // divides by four, so the first painted frame of a 4000-char message reads no tokens at all.
    const { lastFrame } = render(<TurnSpinner startedAt={1000} verb="Cogitating" meter={meter({ mode: "responding", chars: 4000 })} />);
    expect(lastFrame() ?? "").not.toContain("tokens");
    await waitFor(() => (lastFrame() ?? "").includes("tokens"));
    const f = stripAnsi(lastFrame() ?? "");
    expect(f).toMatch(/↓ \d+ tokens/);                       // the arrow rides the token segment
    const shown = Number(/↓ (\d+) tokens/.exec(f)![1]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(1000);                        // still climbing toward 4000/4
  });
  it("re-picks the gerund on a phase transition and holds it inside one phase", () => {
    const picks = ["Baking", "Herding", "Noodling"]; let i = 0;
    const pick = () => picks[Math.min(i++, picks.length - 1)]!;
    const spinner = (m: SpinnerMeter) => <TurnSpinner startedAt={1000} now={() => 4000} pick={pick} meter={m} />;
    const { lastFrame, rerender } = render(spinner(meter()));
    expect(lastFrame() ?? "").toContain("Baking…");
    rerender(spinner(meter({ mode: "thinking", isThinking: true, lastBurst: { startedAt: 4000 } })));
    expect(lastFrame() ?? "").toContain("Herding…");         // none → thinking re-picks
    rerender(spinner(meter({ mode: "thinking", isThinking: true, lastBurst: { startedAt: 3000 } })));
    expect(lastFrame() ?? "").toContain("Herding…");          // still thinking → held
  });
  // Regression, found ONLY in the real binary (pty acceptance, w3.9): useChat sets busy and the start
  // stamp in two setState calls that do not commit together, so the first painted frame of a turn has
  // busy=true and startedAt=0. Unguarded, `now() - 0` is ms since 1970 and the tail read
  // "(29758130m 59s · esc to interrupt)" for one frame before settling to 0s.
  it("treats an unset (0) start stamp as just-started instead of measuring from the epoch", () => {
    const f = render(<TurnSpinner startedAt={0} verb="Cogitating" now={() => 1.7845e12}
      meter={{ ...IDLE_METER, mode: "responding", isThinking: true, lastBurst: { startedAt: 1.7845e12 } }} />).lastFrame() ?? "";
    expect(f).toContain("0s");
    expect(f).not.toMatch(/\d{4,}[mdh]/);    // no "29758130m" / "20655d" — the epoch-elapsed signatures
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
    const { stdin, lastFrame } = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    // Snapshot AFTER the mount has settled, not before it: since F5 t7 a first mount also seeds the durable
    // state's prompt history off disk, which is a legitimate mount-time write. What this test is about is that
    // the SUSPEND changes nothing, so the baseline has to be the post-mount state.
    const beforeSuspend = structuredClone(editorStateRef.current);
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
    // `assertCallback` may be async: since the F5 real-TTY fix the external-edit chord DEFERS its editor by
    // one Ink paint window (EDITOR_PAINT_MS) so the in-flight row reaches the terminal before the sync editor
    // freezes the loop — so the two editExternal cases below have to wait for the edit, not read a counter.
    const exercise = async (trigger: (stdin: { write(input: string): void }) => void | Promise<void>, props: Record<string, unknown> = {}, assertCallback: () => void | Promise<void> = () => {}, initialState = makeYankedState()) => {
      const editorStateRef = { current: initialState } as React.MutableRefObject<EditorState>;
      const view = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} {...props as any} />);
      await new Promise((r) => setTimeout(r, 20));
      expect(editorStateRef.current.yankSite).not.toBeNull();
      await trigger(view.stdin);
      await waitFor(() => editorStateRef.current.yankSite === null);
      expect(editorStateRef.current.killRun).toBe(false);
      expect(editorStateRef.current.lines).toEqual(initialState.lines);
      await assertCallback();
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
    await exercise((stdin) => stdin.write("\x07"), { editExternal: () => { externalEdits++; return null; } }, () => waitFor(() => externalEdits === 1));

    let chordEdits = 0;
    await exercise(async (stdin) => { stdin.write("\x18"); await new Promise((r) => setTimeout(r, 20)); stdin.write("\x05"); }, { editExternal: () => { chordEdits++; return null; } }, () => waitFor(() => chordEdits === 1));

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
    const suspended = render(<ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    const beforeSuspend = structuredClone(editorStateRef.current);   // post-seed baseline, see above
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
  // WAVE C TASK 2: the Ctrl-D arm's row moved off the composer and onto the footer (`Wci`'s first early
  // return), so these three render the composer WITH the footer the app puts under it. Every assertion is
  // unchanged; only the tree they read is — see `helpers/composerFooter.tsx`.
  it("Ctrl-D on an empty composer needs two presses (KB3): first arms a hint and does not exit, second within the window exits; with text it does nothing", async () => {
    let exits = 0;
    const { stdin, lastFrame } = render(<ComposerWithFooter onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onExit={() => { exits++; }} />);
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
    const { stdin, lastFrame } = render(<ComposerWithFooter onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onExit={() => { exits++; }} exitArmMs={10000} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x04"); await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));
    stdin.write("x"); await waitFor(() => (lastFrame() ?? "").includes("x"));
    // WAVE C TASK 2: the arm's row is the footer's now, and the composer reports it up from an effect — so
    // it clears one flush after the keystroke rather than in the same render. Same assertion, waited for.
    await waitFor(() => !(lastFrame() ?? "").includes("Press Ctrl-D again to exit"));
    stdin.write("\x04");                                      // Ctrl-D is a no-op while text makes exit impossible
    await new Promise((r) => setTimeout(r, 30));
    expect(exits).toBe(0);
    stdin.write("\x15");                                      // the upstream arm survives; emptying restores an executable second press
    await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));
    stdin.write("\x04"); await waitFor(() => exits === 1);
  });
  it("Ctrl-D's arm expires after exitArmMs — a press after the window re-arms instead of exiting", async () => {
    let exits = 0;
    const { stdin, lastFrame } = render(<ComposerWithFooter onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} onExit={() => { exits++; }} exitArmMs={40} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x04");
    await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));
    await new Promise((r) => setTimeout(r, 60));          // let the arm expire
    stdin.write("\x04");
    await waitFor(() => (lastFrame() ?? "").includes("Press Ctrl-D again to exit"));   // re-armed, not exited
    expect(exits).toBe(0);
  });
  it("shows the placeholder when empty and hides it once you type", async () => {
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    // F5 task 8: the placeholder is CM47's ladder now, not one literal — a fresh composer (nothing
    // submitted, no messages, nothing queued) lands on rule 4's `Try "…"` suggestion.
    // The first char is inverted and the rest dim, so the two halves are separated by SGR in the raw frame.
    expect(lastFrame() ?? "").toContain("\x1b[7mT\x1b[27m");
    expect(lastFrame() ?? "").toContain("ry \"");
    // WAVE C TASK 2: the `⏎ send` / `Esc rewind · ? help` half of this case retired with the composer's hint
    // stack — upstream's home footer has neither row, and what replaced them (`⏸ manual mode on ·
    // ? for shortcuts`, and its collapse to the chip alone while typing) is pinned in `footer.test.tsx`.
    // What is LEFT here is the half this component still owns: the placeholder ladder.
    stdin.write("hi");
    await waitFor(() => (lastFrame() ?? "").includes("hi"));
    expect(lastFrame() ?? "").not.toContain("ry \"");                  // placeholder gone once typing (rule 1)
  });
  it("hides the Esc-clear hint on the first busy render and does not resurrect after idle", async () => {
    const view = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy={false} />);
    await new Promise((r) => setTimeout(r, 20));
    view.stdin.write("draft"); await waitFor(() => (view.lastFrame() ?? "").includes("draft"));
    view.stdin.write("\x1b"); await waitFor(() => (view.lastFrame() ?? "").includes("Esc again to clear"));
    // WAVE C TASK 2: the arm's feedback is a QUEUE entry now (upstream's `escape-again-to-clear`), so its
    // removal lands in an effect rather than in the same synchronous render. `waitFor` and not a bare
    // `expect` for that reason alone — the assertion itself is the same one, and the frame after the flush
    // is what the user sees. The `does not resurrect` half below is unchanged and is what still catches a
    // hint that comes back.
    view.rerender(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy />);
    await waitFor(() => !(view.lastFrame() ?? "").includes("Esc again to clear"));
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
  it("shows the bash-mode indicator on a leading '!'", async () => {
    // WAVE C TASK 2: the indicator is upstream's own footer literal now (`! for shell mode`, L493959) in
    // `bashBorder`, drawn by `<Footer>` as one of `Wci`'s four early-return states — so this renders the
    // composed pair and asserts the string upstream prints, not the invented
    // `! bash mode — runs locally in cwd (Enter to run)` row that used to sit under the frame.
    //   THE `#` MEMORY HALF IS GONE WITH ITS ROW, and that is a scheduled removal, not a regression: memory
    // mode is a ccx extra with no upstream counterpart at 2.1.220, the Wave C spec removes it outright, and
    // Task 14 owns the removal (`src/tui/memory.ts` is on that task's delete list). There is no upstream
    // footer state to migrate the row into, so until then the `remember`-coloured frame is its indicator —
    // which `composer-frame.test.tsx` pins directly.
    const bash = render(<ComposerWithFooter onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} />);
    await new Promise((r) => setTimeout(r, 20));
    bash.stdin.write("!");
    await waitFor(() => (bash.lastFrame() ?? "").includes("! for shell mode"));
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
  // MIGRATED in F5 t10 from "renders a command's argumentHint in the palette row". Upstream's suggestion row
  // (`VJa`, bundle L432406) carries only `displayText` and `description` — the argument evidence it shows
  // there is `(arguments: …)` from `argNames`, a field `CommandEntry` does not have. `argumentHint` reaches
  // the user through CM37 instead: the inline dim hint after a completed `/name ` (L490757 model, L396283
  // render), which is where upstream puts it and the moment it is actually useful.
  it("ChatComposer renders a command's argumentHint inline once the command is completed (CM37), not in the palette row", async () => {
    const CAT = [{ name: "review", description: "review code", argumentHint: "<pr>", source: "catalog" }] as any;
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />);
    await new Promise((r) => setTimeout(r, 10));        // let useInput subscribe
    stdin.write("/");
    await new Promise((r) => setTimeout(r, 10));        // open + catalog injection
    expect(lastFrame()).toContain("/review");
    expect(lastFrame()).not.toContain("<pr>");
    stdin.write("\t");                                   // accept → the buffer becomes `/review `
    await new Promise((r) => setTimeout(r, 10));
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
    // The editor runs one paint window after the chord now (F5 real-TTY fix: the in-flight row has to reach
    // the terminal before the SYNC editor freezes the loop), so every arm here waits for it instead of
    // assuming it already ran.
    await waitFor(() => edits.length === 1);
    expect(edits).toEqual(["hi"]);
    stdin.write("\r");
    await waitFor(() => submitted.length === 1);
    expect(submitted).toEqual(["from-editor"]);
    stdin.write("\x07");                                     // Ctrl-G — no chord needed
    await waitFor(() => edits.length === 2);
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
    // WAVE C TASK 2: `Esc clear` was hint row 2, the persistent line that retired with the hint stack (there
    // is no upstream row like it). The behaviour it stood for — a non-empty draft makes Escape a CLEAR arm
    // rather than a rewind arm — is unchanged and is what the next two lines prove, through the arm's own
    // feedback, which is now a queue entry in the overlay above the frame.
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
