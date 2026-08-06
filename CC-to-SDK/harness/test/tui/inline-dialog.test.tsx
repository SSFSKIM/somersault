// test/tui/inline-dialog.test.tsx — F6 Task 5 (DG27) as CORRECTED by the t5 review against the bundle.
//
// THE PREMISE THAT DIED HERE. This file's first version pinned "dialog and composer on screen together",
// which the plan's original requirement 1 asked for. The bundle says otherwise: `KVf` renders the prompt input
// only under `… && on !== "visible" && …` (L549494), and `Fui()` (L499192) answers `"visible"` exactly when
// the dialog store holds an open, unsuppressed dialog — so the composer is GONE while a dialog is up.
// `layout:"inline"` vs `"modal"` (`ypi`, L507338) decides only WHERE the dialog draws: in the scrollable
// transcript flow, or in the overlaid modal slot. Exit-plan-mode is the only `"modal"` entry.
//
// A mid-typing draft is protected by the OPPOSITE mechanism — SUPPRESSION. `Xrl()` (L499196) renders no dialog
// at all while the composer's activity flag is set; the flag is `value.trim().length > 0`, written on every
// input change and cleared by a trailing 1500 ms debounce after the last keystroke (`TC`, L547796-802, with
// `fs = 1500` at L547654); while it holds, the composer shows a dim `Waiting for permission…` row (L496241).
// So the three states this file pins are upstream's three: none / suppressed / visible.
import { describe, it, expect } from "vitest";
import React from "react";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { WAITING_FOR_PERMISSION } from "../../src/tui/ChatComposer.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { PendingEntry } from "../../src/permissions/pending.js";

const frame = (f: () => string | undefined) => f() ?? "";
const flat = (f: () => string | undefined) => frame(f).replace(/\x1b\[[0-9;]*m/g, "").replace(/\n/g, " ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await sleep(0); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await sleep(5); }
}
/** The composer's own prompt row is `❯` + NBSP (F5 t2); the transcript's echo uses a normal space, so this
 *  substring is a deterministic "the composer is mounted" probe and safe to assert negatively. */
const GLYPH = "❯ ";
/** "A decision dialog is on screen". `permissionEntry` parks an Edit, which is what a real session parks far
 *  more often than anything else — and since F6 T7 that routes to `FilePermission`, whose frame title this is
 *  (`UMy` L228438). It was the generic body's `Allow Claude to use` until the switchboard grew a file arm. */
const DIALOG = "Edit file";

// Every history read here points at a throwaway fleet root, so no test touches the real ~/.claude prompt log.
const roots: string[] = [];
const tmpEnv = (): NodeJS.ProcessEnv => {
  const root = mkdtempSync(join(tmpdir(), "ccx-inline-dialog-"));
  roots.push(root);
  return { ...process.env, CCX_FLEET_ROOT: root };
};
const cleanupRoots = () => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); };

const permissionEntry = (toolUseID = "t"): PendingEntry =>
  ({ sessionId: "s", toolUseID, toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
const questionEntry = (): PendingEntry => ({ sessionId: "s", toolUseID: "q", toolName: "AskUserQuestion", kind: "question",
  input: { questions: [{ question: "Red or blue?", multiSelect: false, options: [{ label: "red" }, { label: "blue" }] }] }, createdAt: Date.now() });
const planEntry = (): PendingEntry =>
  ({ sessionId: "s", toolUseID: "p", toolName: "ExitPlanMode", kind: "plan", input: { plan: "ship it" }, createdAt: Date.now() });

/** `typingIdleMs` is the injected `fs`. Tests that want a STABLE suppressed state pass a long one; tests that
 *  watch the window close pass a short one and wait it out for real (the house pattern — see `yankHintMs`). */
const app = (fake: ReturnType<typeof fakeRemote>, typingIdleMs: number, hookOpts?: { initialMode?: string; initialModel?: string }) =>
  render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env: tmpEnv() }} typingIdleMs={typingIdleMs} hookOpts={hookOpts} />);
const IDLE_SHORT = 40, IDLE_LONG = 10000;

describe("decision dialog — VISIBLE (upstream's `on === \"visible\"`)", () => {
  it("draws in the transcript flow and the composer is not rendered at all", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("hello"); await waitFor(() => frame(lastFrame).includes("hello"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));      // fakeRemote's reply: the transcript
    // Submitting emptied the buffer, which cancels the activity window outright (`b9.cancel()`), so this
    // decision is visible immediately rather than after `fs`.
    fake.parkPermission(permissionEntry());
    await waitFor(() => frame(lastFrame).includes(DIALOG));
    const f = flat(lastFrame);
    expect(f).toContain("ok");                        // transcript stays — the dialog is in the FLOW, not over it
    expect(f).not.toContain(GLYPH);                   // …and the prompt input is gone (KVf's gate, L549494)
    expect(f).not.toContain(WAITING_FOR_PERMISSION);  // nothing is being suppressed
    cleanupRoots();
  });

  it("takes digits and Escape with no composer under it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(permissionEntry("d1"));
    await waitFor(() => frame(lastFrame).includes(DIALOG));
    stdin.write("2");
    await waitFor(() => fake.answeredCalls.length === 1);
    // Row 2 is `tal`'s session row now, not the generic body's tool-name allowlist: an in-directory write with
    // no engine suggestion behind it constructs `iHr`'s own grant (F6 T7).
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "d1", decision: { kind: "allow_with_updates", updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] } });
    await waitFor(() => frame(lastFrame).includes(GLYPH));            // composer comes back with the answer
    fake.parkPermission(permissionEntry("d2"));
    await waitFor(() => frame(lastFrame).includes(DIALOG));
    stdin.write("\x1b");
    await waitFor(() => fake.answeredCalls.length === 2);
    expect(fake.answeredCalls[1]).toEqual({ toolUseID: "d2", decision: { kind: "deny" } });
    cleanupRoots();
  });

  it("an idle draft survives the composer being unmounted for the dialog and comes back with it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("survive me"); await waitFor(() => frame(lastFrame).includes("survive me"));
    await sleep(IDLE_SHORT * 3);                                      // the activity window closes on its own
    fake.parkPermission(permissionEntry("d3"));
    await waitFor(() => frame(lastFrame).includes(DIALOG));
    expect(flat(lastFrame)).not.toContain(GLYPH);
    expect(flat(lastFrame)).not.toContain("survive me");              // the composer really is unmounted
    stdin.write("1");
    await waitFor(() => fake.answeredCalls.length === 1);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    expect(flat(lastFrame)).toContain("survive me");                  // …but the durable editor state is not lost
    stdin.write(" more"); await waitFor(() => flat(lastFrame).includes("survive me more"));
    cleanupRoots();
  });

  it("a question dialog behaves the same way and answers from the flow", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(questionEntry());
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    expect(flat(lastFrame)).not.toContain(GLYPH);
    stdin.write("2");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "q", decision: { kind: "question_answer", answers: { "Red or blue?": "blue" } } });
    cleanupRoots();
  });

  // Reviewer issue 3: the `kind !== "plan"` exclusion on the inline slot must be pinned, or a plan decision
  // would draw a permission box above its own dialog (the inline slot's else-branch is PermissionDialog).
  it("a plan decision draws ONLY the modal plan dialog — no stray permission box above it", async () => {
    const fake = fakeRemote();
    const { lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(planEntry());
    await waitFor(() => frame(lastFrame).includes("Ready to code?"));
    expect(frame(lastFrame)).not.toContain(DIALOG);                   // the exclusion, pinned
    expect(frame(lastFrame)).not.toContain(GLYPH);                    // modal: composer replaced, as before
    cleanupRoots();
  });

  it("an overlay still wins outright over a parked decision, which re-renders fresh when it closes", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("?");                                                 // the `?` shortcuts overlay
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    fake.parkPermission(permissionEntry("hidden"));
    await sleep(30);
    expect(frame(lastFrame)).not.toContain(DIALOG);                   // exclusivity: no dialog under the overlay
    stdin.write("\x1b");                                              // the overlay's own Escape
    await waitFor(() => frame(lastFrame).includes(DIALOG));           // revealed by the same key={toolUseID} door
    stdin.write("1");
    await waitFor(() => fake.answeredCalls.length === 1);             // the park was never lost, only hidden
    cleanupRoots();
  });
});

describe("decision dialog — SUPPRESSED (upstream's `Xrl()` null while typing)", () => {
  it("a decision arriving mid-draft renders nothing; the composer keeps the screen and shows the waiting row", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_LONG);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("mid draft"); await waitFor(() => frame(lastFrame).includes("mid draft"));
    fake.parkPermission(permissionEntry("s1"));
    await waitFor(() => frame(lastFrame).includes(WAITING_FOR_PERMISSION));
    const f = flat(lastFrame);
    expect(f).not.toContain(DIALOG);                                  // the dialog renders NOTHING while typing
    expect(f).toContain(GLYPH);                                       // the composer is still here…
    expect(f).toContain("mid draft");                                 // …with the draft untouched
    expect(fake.answeredCalls).toEqual([]);                           // and nothing has been answered
    cleanupRoots();
  });

  // Reviewer issue 2, re-shaped: the scenario that matters under the corrected model is the SUPPRESSED state,
  // where the composer genuinely owns the keyboard over a parked decision. Escape must be the composer's own
  // Esc-Esc clear arm, never the dialog's deny.
  it("Escape while suppressed belongs to the COMPOSER, not to the withheld dialog", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_LONG);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("mid draft"); await waitFor(() => frame(lastFrame).includes("mid draft"));
    fake.parkPermission(permissionEntry("s2"));
    await waitFor(() => frame(lastFrame).includes(WAITING_FOR_PERMISSION));
    stdin.write("\x1b");
    await waitFor(() => flat(lastFrame).includes("again to clear"));  // CM15's arm — the composer's Escape
    expect(fake.answeredCalls).toEqual([]);                           // …and NOT a deny
    expect(flat(lastFrame)).toContain("mid draft");
    cleanupRoots();
  });

  it("reveals the dialog when the typing window closes, and hides the composer with it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("still typing"); await waitFor(() => frame(lastFrame).includes("still typing"));
    fake.parkPermission(permissionEntry("s3"));
    await waitFor(() => frame(lastFrame).includes(WAITING_FOR_PERMISSION));
    expect(frame(lastFrame)).not.toContain(DIALOG);
    await waitFor(() => frame(lastFrame).includes(DIALOG));           // `fs` elapsed: the reveal, unaided
    expect(flat(lastFrame)).not.toContain(GLYPH);                     // …and the composer steps aside for it
    stdin.write("1");
    await waitFor(() => fake.answeredCalls.length === 1);
    await waitFor(() => flat(lastFrame).includes("still typing"));    // draft still there afterwards
    cleanupRoots();
  });

  it("emptying the draft reveals the dialog at once, without waiting out the window", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_LONG);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("throwaway"); await waitFor(() => frame(lastFrame).includes("throwaway"));
    fake.parkPermission(permissionEntry("s4"));
    await waitFor(() => frame(lastFrame).includes(WAITING_FOR_PERMISSION));
    stdin.write("\x15");                                              // ctrl+u empties the buffer
    // `b9.cancel()` + `Z1t(false)`: the flag drops on the keystroke, not `fs` later — and `fs` here is 10 s.
    await waitFor(() => frame(lastFrame).includes(DIALOG), 1000);
    cleanupRoots();
  });

  it("a draft of only whitespace does not suppress (upstream's `trim()`)", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_LONG);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("   ");
    await sleep(30);
    fake.parkPermission(permissionEntry("s5"));
    await waitFor(() => frame(lastFrame).includes(DIALOG), 1000);
    expect(frame(lastFrame)).not.toContain(WAITING_FOR_PERMISSION);
    cleanupRoots();
  });

  it("suppression covers the modal plan dialog too — `Xrl()` gates both variants", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("mid draft"); await waitFor(() => frame(lastFrame).includes("mid draft"));
    fake.parkPermission(planEntry());
    await waitFor(() => frame(lastFrame).includes(WAITING_FOR_PERMISSION));
    expect(frame(lastFrame)).not.toContain("Ready to code?");
    await waitFor(() => frame(lastFrame).includes("Ready to code?"));   // …until the window closes
    cleanupRoots();
  });
});

// ── Wave T Task 10 fix — the two props ChatApp sources for the plan dialog's one-of arm ────────────────
// PlanDialog decides WHICH approval arm it can offer from `model` and `bypassAvailable`, and ChatApp:464 is
// the single line that sources them. Nothing pinned that line: every other ChatApp test renders with no
// model and no hookOpts, which is exactly the neither-available arm — so deleting both props left all 186
// ChatApp-level tests green and silently restored the pre-t10 "always grant the narrowest mode" defect.
// These two tests are the missing pin, one per source, asserting BOTH the label the human reads and the
// mode the answer actually carries. The bypass one deliberately cycles the LIVE mode away from the launch
// mode first, because the plausible mis-sourcing is `bypassAvailable={state.mode === "bypassPermissions"}`
// — which tracks where the session is now, not what it launched with, and which a test that never moved the
// mode could not tell apart from the real thing.
describe("plan dialog availability — the wiring ChatApp owns", () => {
  it("the bypass arm follows the LAUNCH mode, and survives the live mode moving off it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT, { initialMode: "bypassPermissions" });
    await waitFor(() => flat(lastFrame).includes("mode bypassPermissions"));
    // bypassPermissions is OFF the Tab ladder (useChat's `ladderNext`), so shift+tab re-enters at `default`:
    // the live mode is now something the launch flag is not.
    stdin.write("\x1b[Z");
    await waitFor(() => flat(lastFrame).includes("mode default"));
    fake.parkPermission(planEntry());
    await waitFor(() => frame(lastFrame).includes("Ready to code?"));
    expect(flat(lastFrame)).toContain("Yes, and bypass permissions");
    expect(flat(lastFrame)).not.toContain("Yes, auto-accept edits");
    stdin.write("1");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "p", decision: { kind: "plan_approve", mode: "bypassPermissions" } });
    cleanupRoots();
  });

  it("the auto arm follows the model ChatApp hands down", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT, { initialModel: "claude-opus-5" });   // autoModel.ts's live-verified set
    await waitFor(() => flat(lastFrame).includes("model claude-opus-5"));
    fake.parkPermission(planEntry());
    await waitFor(() => frame(lastFrame).includes("Ready to code?"));
    expect(flat(lastFrame)).toContain("Yes, and use auto mode");
    expect(flat(lastFrame)).not.toContain("Yes, auto-accept edits");
    stdin.write("1");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "p", decision: { kind: "plan_approve", mode: "auto" } });
    cleanupRoots();
  });
});
