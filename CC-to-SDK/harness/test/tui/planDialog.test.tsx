// test/tui/planDialog.test.tsx — the `Ready to code?` plan-approval dialog (F6 T9), rebuilt from 2.1.220's
// `Gnl` (L500755-501140) / `sYf` (L500696-714) / `lYf` (L500721-738).
//
// The pre-F6 body (three hand-rolled numbered lines, a `y` shortcut, a mode-switched feedback line, ↑/↓
// scrolling the plan) is gone; what it is replaced by is a `DialogFrame` over the markdown plan plus a
// SEPARATE top-bordered box holding the prompt, an embedded `Select` and the ctrl+g row. Every literal
// asserted below is transcribed, not invented.
//
// ONE UPSTREAM QUIRK IS LOAD-BEARING FOR THESE ASSERTIONS: the Select is mounted without
// `inlineDescriptions`, so `RLe`'s `showLabel` is false (L397111 `showLabel:_gt`, `_gt = inlineDescriptions
// ?? !1` at L397019) and the keep-planning row NEVER PRINTS ITS LABEL — the placeholder is what the row
// reads as. "No, keep planning" is therefore the option's value-side name only; "Tell Claude what to change"
// is the string on screen.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { PlanDialog } from "../../src/tui/PlanDialog.js";

/** SGR-stripped, the same helper the sibling dialog tests use: the Select wraps the index and the label in
 *  separate colour runs, so `1. Yes, auto-accept edits` is only contiguous once the escapes are gone. */
const frame = (f: () => string | undefined) => (f() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const PLAN = "# Build it\n\n- step one\n- step two";
const REQ = { input: { plan: PLAN } };
/** An editor that always succeeds, so the ctrl+g seam never touches a real `$EDITOR`. */
const fakeEditor = (text: string) => `${text}\n- step three`;
/** ctrl+g / shift+tab as the terminal actually sends them. */
const CTRL_G = "\x07", SHIFT_TAB = "\x1b[Z";

/** Every mount pins an editor name so the ctrl+g row is deterministic across machines (a bare `ccx` in CI has
 *  neither VISUAL nor EDITOR, and upstream hides the row entirely in that case), and a terminal height, because
 *  the plan region is sized off it — `process.stdout.rows` under vitest is whatever the runner's tty says. */
const mount = (props: Record<string, unknown> = {}) =>
  render(<PlanDialog req={REQ} onDecision={() => {}} editorName="vim" editor={fakeEditor} rows={40} {...props} />);

describe("<PlanDialog> — the frame (`Gnl` L501091-136)", () => {
  it("renders the Ready to code? frame, the plan as markdown, the prompt and the reachable option list", async () => {
    const { lastFrame } = mount();
    await waitFor(() => frame(lastFrame).includes("Build it"));
    const f = frame(lastFrame);
    expect(f).toContain("Ready to code?");                                    // `Ed` title, L501112
    expect(f).toContain("Here is Claude's plan:");                            // L501103
    expect(f).toContain("Build it");                                          // markdown heading, through F4's renderer
    expect(f).toContain("step one");
    expect(f).toContain("step two");
    expect(f).toContain("Claude has written up a plan and is ready to execute. Would you like to proceed?");   // L501121
    expect(f).toContain("1. Yes, auto-accept edits");                         // `sYf` L500709
    expect(f).toContain("2. Yes, manually approve edits");                    // `sYf` L500710
    expect(f).toContain("Tell Claude what to change");                        // the input row's placeholder IS its visible text
    expect(f).toContain("ctrl+g to edit in vim");                             // `$e` bare form, L501126
    expect(f).not.toContain("Plan saved!");                                   // only after a save
  });

  it("prints the consent reason under the plan when the engine supplied one, and nothing when it did not", async () => {
    const a = mount({ req: { input: { plan: PLAN }, decisionReason: "Hook check requires confirmation." } });
    await waitFor(() => frame(a.lastFrame).includes("Build it"));
    expect(frame(a.lastFrame)).toContain("Hook check requires confirmation.");
    const b = mount();
    await waitFor(() => frame(b.lastFrame).includes("Build it"));
    expect(frame(b.lastFrame)).not.toContain("requires confirmation");
  });

  it("attributes a subagent through the shared DialogFrame header (DG21), not a line of its own", async () => {
    const { lastFrame } = mount({ req: { input: { plan: PLAN }, subagentType: "Explore" } });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    expect(frame(lastFrame)).toContain("from the Explore agent");
    expect(frame(lastFrame)).not.toContain("Subagent (Explore) asks:");       // the pre-F6 line is retired
  });

  it("clips a plan taller than the computed region and SAYS how many lines it withheld", async () => {
    const longPlan = Array.from({ length: 60 }, (_, i) => `- line ${i}`).join("\n");
    const { lastFrame } = mount({ req: { input: { plan: longPlan } }, rows: 24 });
    await waitFor(() => frame(lastFrame).includes("line 0"));
    const f = frame(lastFrame);
    expect(f).toContain("line 0");                                            // the region starts at the TOP (`stickyScroll:!1`)
    expect(f).not.toContain("line 59");
    expect(f).toMatch(/\+\d+ more lines/);
    expect(f).toContain("1. Yes, auto-accept edits");                         // the option box is never clipped away
  });
});

describe("<PlanDialog> — the effects (`lYf` L500721-738)", () => {
  it("option 1 approves with acceptEdits TRUE and carries no updatedPermissions (one channel, T3 review)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("1");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: true });
  });

  it("option 2 approves with acceptEdits FALSE", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("2");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: false });
  });

  // The reversed F2-task-8 pin. Upstream's dialog is Select-driven, Enter is `select:accept`, and the focused
  // row on mount is row 1 — so Enter approves with auto-accept edits. See the note in PlanDialog.tsx.
  it("Enter ACCEPTS THE FOCUSED ROW (the F2 t8 `Enter approves nothing` pin, deliberately reversed)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("\r");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: true });
  });

  it("Enter after moving the cursor accepts THAT row, not the first one", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("\x1b[B"); await tick();                                      // ↓ → row 2
    stdin.write("\r");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: false });
  });

  it("the keep-planning row rejects with the typed feedback", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("3"); await tick();                                           // a digit on an EMPTY input row only moves the cursor (L396768-785)
    expect(decisions).toEqual([]);
    stdin.write("check the config first");
    await waitFor(() => frame(lastFrame).includes("check the config first"));
    stdin.write("\r");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_reject", feedback: "check the config first" });
  });

  // `lYf`'s `if (!s && !a) return null` (L500734) and `gWt`'s `if (!eYf && !rdi) return` (L500975) both guard
  // the "no" arm on EMPTY-and-no-images — but neither is the path an empty submit takes: `RLe` sends an empty
  // submit to `onCancel` (L397113-118), which upstream wires to `xnl` → `gge({behavior:"deny"})` (L500995).
  // Empty Enter is therefore a plain reject, exactly like Esc, and NOT a dialog that stays open.
  it("submitting the keep-planning row EMPTY rejects with no feedback (upstream's `xnl`, the same as Esc)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("\x1b[B"); await tick(); stdin.write("\x1b[B"); await tick(); // ↓↓ → the input row
    stdin.write("\r");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_reject" });
    expect(decisions[0]).not.toHaveProperty("feedback");
  });

  it("Esc rejects with no feedback", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("\x1b");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_reject" });
  });

  it("y and n are plain TEXT in the keep-planning row (no Confirmation shortcut survives the migration)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("3"); await tick();
    stdin.write("y"); await tick();
    stdin.write("n"); await waitFor(() => frame(lastFrame).includes("yn"));
    expect(decisions).toEqual([]);
    stdin.write("\r");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_reject", feedback: "yn" });
  });
});

describe("<PlanDialog> — shift+tab (`tYf` L501054-060)", () => {
  it("approves with auto-accept edits from a pick row", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("\x1b[B"); await tick();                                      // even with row 2 focused
    stdin.write(SHIFT_TAB);
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: true });
  });

  it("still approves WHILE the keep-planning row is being typed into (the row's description names it)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("3"); await tick();
    stdin.write("looks fine"); await waitFor(() => frame(lastFrame).includes("looks fine"));
    stdin.write(SHIFT_TAB);
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: true });
  });
});

describe("<PlanDialog> — ctrl+g (DG34, `tYf` L501036-053 + `Anl` L500757)", () => {
  it("round-trips the LIVE plan through the injected editor, replaces it, and flashes `Plan saved!`", async () => {
    const seen: string[] = [];
    const { stdin, lastFrame } = mount({ editor: (t: string) => { seen.push(t); return `${t}\n- step three`; } });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write(CTRL_G);
    await waitFor(() => frame(lastFrame).includes("step three"));
    expect(seen).toEqual([PLAN]);                                             // the editor was handed the live plan
    expect(frame(lastFrame)).toContain("Plan saved!");
  });

  it("the edited text is what an approve CONSUMES (`gWt` reads `currentPlan`, L500936)", async () => {
    const decisions: any[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write(CTRL_G);
    await waitFor(() => frame(lastFrame).includes("step three"));
    stdin.write("1");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: true, plan: `${PLAN}\n- step three` });
  });

  it("an approve with NO edit carries no plan override at all (`u = planEditedLocally ? {plan} : {}`)", async () => {
    const decisions: any[] = [];
    const { stdin, lastFrame } = mount({ onDecision: (o: unknown) => decisions.push(o) });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("1");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).not.toHaveProperty("plan");
  });

  it("a second ctrl+g edits the ALREADY-EDITED text, not the original request input", async () => {
    const seen: string[] = [];
    const { stdin, lastFrame } = mount({ editor: (t: string) => { seen.push(t); return `${t}!`; } });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write(CTRL_G); await waitFor(() => seen.length === 1);
    stdin.write(CTRL_G); await waitFor(() => seen.length === 2);
    expect(seen[1]).toBe(`${PLAN}!`);
  });

  it("an editor that failed (null) or changed nothing leaves the plan alone and never claims a save", async () => {
    const a = mount({ editor: () => null });
    await waitFor(() => frame(a.lastFrame).includes("Build it"));
    a.stdin.write(CTRL_G); await tick(); await tick();
    expect(frame(a.lastFrame)).not.toContain("Plan saved!");

    const b = mount({ editor: (t: string) => t });
    await waitFor(() => frame(b.lastFrame).includes("Build it"));
    b.stdin.write(CTRL_G); await tick(); await tick();
    expect(frame(b.lastFrame)).not.toContain("Plan saved!");
  });

  it("the editor call is SYNCHRONOUS — the F5 real-TTY law (spawnSync paint-then-block, never an await)", async () => {
    const editor = vi.fn((t: string) => `${t}!`);
    const { stdin, lastFrame } = mount({ editor });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write(CTRL_G);
    // No tick, no await: if the seam were promise-based the call would not have happened yet.
    expect(editor).toHaveBeenCalledTimes(1);
    expect(editor.mock.results[0]!.type).toBe("return");
    expect(editor.mock.results[0]!.value).not.toBeInstanceOf(Promise);
  });

  it("the ctrl+g row is hidden entirely when no editor is configured (upstream's `q$b &&`, L501126)", async () => {
    const { lastFrame } = mount({ editorName: null });
    await waitFor(() => frame(lastFrame).includes("Build it"));
    expect(frame(lastFrame)).not.toContain("ctrl+g");
  });
});
