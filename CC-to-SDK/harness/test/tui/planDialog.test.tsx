// test/tui/planDialog.test.tsx — the ExitPlanMode approval dialog (Goal B Task 9): markdown-rendered plan
// window, CC's three choices (auto-accept / manual-approve / keep-planning), a reject feedback line (Esc
// or "3" both open it — neither fabricates an answer), and ↑/↓ scroll for plans longer than the window.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { PlanDialog } from "../../src/tui/PlanDialog.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const REQ = { input: { plan: "# Build it\n\n- step one\n- step two" } };

describe("<PlanDialog>", () => {
  it("renders the plan body (markdown-rendered) and the three CC choices", async () => {
    const { lastFrame } = render(<PlanDialog req={REQ} onDecision={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Build it"));
    const f = frame(lastFrame);
    expect(f).toContain("Claude has finished planning.");
    expect(f).toContain("Build it");
    expect(f).toContain("step one");
    expect(f).toContain("step two");
    expect(f).toContain("1. Yes, and auto-accept edits");
    expect(f).toContain("2. Yes, and manually approve edits");
    expect(f).toContain("3. No, keep planning (esc)");
  });

  it("1 fires plan_approve acceptEdits:true; 2 fires plan_approve acceptEdits:false", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = render(<PlanDialog req={REQ} onDecision={(o) => decisions.push(o)} />);
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("1");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: true });

    const decisions2: unknown[] = [];
    const r2 = render(<PlanDialog req={REQ} onDecision={(o) => decisions2.push(o)} />);
    await waitFor(() => frame(r2.lastFrame).includes("Build it"));
    r2.stdin.write("2");
    await waitFor(() => decisions2.length === 1);
    expect(decisions2[0]).toEqual({ kind: "plan_approve", acceptEdits: false });
  });

  it("3 opens the feedback line; enter sends plan_reject with the typed feedback", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = render(<PlanDialog req={REQ} onDecision={(o) => decisions.push(o)} />);
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("3");
    await waitFor(() => frame(lastFrame).includes("What should Claude do differently?"));
    stdin.write("check the config first");
    await waitFor(() => frame(lastFrame).includes("check the config first"));
    stdin.write("\r");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_reject", feedback: "check the config first" });
  });

  it("esc opens the feedback line too (esc = keep planning, CC shape); enter on EMPTY feedback sends plan_reject with no feedback (the gate supplies the default copy)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = render(<PlanDialog req={REQ} onDecision={(o) => decisions.push(o)} />);
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("What should Claude do differently?"));
    stdin.write("\r");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_reject" });
    expect(decisions[0]).not.toHaveProperty("feedback");
  });

  it("↑/↓ scroll a long plan (first visible line changes; the choices stay put)", async () => {
    const longPlan = Array.from({ length: 20 }, (_, i) => `- line ${i}`).join("\n");
    const req = { input: { plan: longPlan } };
    const { stdin, lastFrame } = render(<PlanDialog req={req} onDecision={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("line 0"));
    expect(frame(lastFrame)).not.toContain("line 19");
    stdin.write("\x1b[B"); // ↓
    await waitFor(() => !frame(lastFrame).includes("line 0"));
    expect(frame(lastFrame)).toContain("line 1");
    const f = frame(lastFrame);
    expect(f).toContain("1. Yes, and auto-accept edits");
    expect(f).toContain("2. Yes, and manually approve edits");
    expect(f).toContain("3. No, keep planning (esc)");
  });
});
