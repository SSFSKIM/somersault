// test/tui/question-decline.test.tsx — BL6: Esc on an AskUserQuestion dialog.
//
// TWO DEFECTS, ONE GESTURE. The owner filed "AskUserQuestion declines don't behave like native", and the
// diagnosis (probe 109, six live runs) found both halves in the one `onDeny={() => resolveDecision({kind:
// "deny"})}` at ChatApp's question arm:
//   A. WHAT THE MODEL IS TOLD. A bare deny is also what teardown and the zero-connection rule send, so the
//      gate could only answer with its "nobody is here" copy — the opposite of what a human at the keyboard
//      just did. The decline now carries its own discriminator and gets upstream's `Dpt` text instead.
//   B. WHAT THE TURN DOES. Native's option list answers Escape with `{behavior:"deny"}` into `cancelAndAbort`
//      (2.1.220 cli.pretty.js:504427-504431 → :271972), whose empty-feedback guard (:271764) fires
//      `abortController.abort()`: ONE Esc, turn over, every sibling question resolved at once (:503050,
//      :279323, :298463). ccx declined one dialog and kept going, which is why the owner's transcript shows
//      three Esc presses half a second apart.
//
// Scope, pinned below: QUESTION dialogs only. The 3-way permission dialog and the plan dialog keep the Esc
// they have — a permission deny is an answer to one tool call and the turn goes on around it.
import { describe, it, expect } from "vitest";
import React from "react";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { ChatSession } from "../../src/session/chatSession.js";

const frame = (f: () => string | undefined) => f() ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await sleep(0); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await sleep(5); }
}
const GLYPH = "❯ ";

const roots: string[] = [];
const tmpEnv = (): NodeJS.ProcessEnv => {
  const root = mkdtempSync(join(tmpdir(), "ccx-question-decline-"));
  roots.push(root);
  return { ...process.env, CCX_FLEET_ROOT: root };
};
const cleanupRoots = () => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); };

const questionEntry = (toolUseID = "q"): PendingEntry => ({ sessionId: "s", toolUseID, toolName: "AskUserQuestion", kind: "question",
  input: { questions: [{ question: "Red or blue?", multiSelect: false, options: [{ label: "red" }, { label: "blue" }] }] }, createdAt: Date.now() });
const permissionEntry = (toolUseID = "d"): PendingEntry =>
  ({ sessionId: "s", toolUseID, toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
const planEntry = (): PendingEntry =>
  ({ sessionId: "s", toolUseID: "p", toolName: "ExitPlanMode", kind: "plan", input: { plan: "ship it" }, createdAt: Date.now() });

/** One fake plus its interrupt counter — the whole of Fix B is "did the turn end too". */
const spy = () => { const calls = { interrupts: 0 }; return { calls, fake: fakeRemote({ interrupt: () => { calls.interrupts++; } }) }; };

const app = (fake: ReturnType<typeof fakeRemote>, mode: "classic" | "fullscreen") => render(
  <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()}
    renderer={{ mode, reason: "env_on" }} deps={{ env: tmpEnv(), columns: () => 80, rows: () => 24 }} typingIdleMs={5} />);

// Both renderers mount the question dialog from ONE arm of ChatApp's tree (the element list is handed to the
// dock in fullscreen and rendered inline in classic), so this pair is a guard against that ever forking —
// not two implementations under test.
describe.each(["classic", "fullscreen"] as const)("Esc on a question dialog (%s renderer)", (mode) => {
  it("tells the model the USER declined, and ends the whole turn", async () => {
    const { calls, fake } = spy();
    const { stdin, lastFrame } = app(fake, mode);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(questionEntry());
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("\x1b");
    await waitFor(() => fake.answeredCalls.length === 1);
    // Fix A on the wire: the discriminator, not the copy. `feedback` is the human's OWN typed words
    // everywhere else it appears, so canon boilerplate must not travel in it.
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "q", decision: { kind: "deny", reason: "declined" } });
    // Fix B: the visible park settles AND the turn is interrupted — which is what sweeps the siblings.
    await waitFor(() => calls.interrupts === 1);
    await waitFor(() => frame(lastFrame).includes(GLYPH));   // the dialog is gone; the composer is back
    cleanupRoots();
  });
});

describe("BL6 scope: the other two dialogs keep the Esc they had", () => {
  it("a permission dialog still declines one call and leaves the turn running", async () => {
    const { calls, fake } = spy();
    const { stdin, lastFrame } = app(fake, "classic");
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(permissionEntry());
    await waitFor(() => frame(lastFrame).includes("Edit file"));
    stdin.write("\x1b");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "d", decision: { kind: "deny" } });   // no discriminator
    await sleep(30);
    expect(calls.interrupts).toBe(0);
    cleanupRoots();
  });

  it("a plan dialog still sends a feedback-less plan_reject and does not interrupt from the client", async () => {
    const { calls, fake } = spy();
    const { stdin, lastFrame } = app(fake, "classic");
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(planEntry());
    await waitFor(() => frame(lastFrame).includes("Ready to code?"));
    stdin.write("\x1b");
    await waitFor(() => fake.answeredCalls.length === 1);
    // The plan family's turn-ending lives in the GATE (`interrupt: true` on a bare plan_reject, wave 2 A4),
    // not in the client — so this arm must stay clear of useChat's interrupt.
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "p", decision: { kind: "plan_reject" } });
    await sleep(30);
    expect(calls.interrupts).toBe(0);
    cleanupRoots();
  });
});

// BL6 REVIEW, Important 1. The interrupt used to fire unconditionally: `resolveDecision` resolved the same
// way whether OUR outcome settled the park, another attached client got there first, or the answer never
// landed at all — so an Esc could kill a turn somebody else had legitimately answered. It is now gated on
// this client's answer actually settling the park.
describe("BL6 review: the decline only ends the turn when OUR answer settled the park", () => {
  it("another attached client answered first — the Esc is a no-op again, not a turn-killer", async () => {
    const calls = { interrupts: 0 };
    // The host's lost-race receipt (host.ts:860): `ok`, but somebody else owns the settle. The park is gone
    // for a reason that is not ours, and their answer's turn must survive our keystroke.
    const fake = fakeRemote({ interrupt: () => { calls.interrupts++; }, answerDecision: async () => ({ ok: true, alreadyAnsweredBy: "other" }) });
    const { stdin, lastFrame } = app(fake, "classic");
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(questionEntry());
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("\x1b");
    await waitFor(() => fake.answeredCalls.length === 1);
    await waitFor(() => frame(lastFrame).includes("answered by other"));   // the existing notice, unchanged
    await sleep(30);
    expect(calls.interrupts).toBe(0);
    cleanupRoots();
  });

  it("the answer never lands (host death / the 10s deadline) — no interrupt, and the dialog stays up", async () => {
    const calls = { interrupts: 0 };
    const fake = fakeRemote({ interrupt: () => { calls.interrupts++; }, answerDecision: async () => { throw new Error("host connection closed"); } });
    const { stdin, lastFrame } = app(fake, "classic");
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(questionEntry());
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("answer failed"));
    await sleep(30);
    // Interrupting here would abort a turn whose park is still live host-side — useChat un-marks the entry
    // as ours precisely so a later settle still renders, and the dialog is deliberately NOT cleared.
    expect(calls.interrupts).toBe(0);
    expect(frame(lastFrame)).toContain("Red or blue?");
    cleanupRoots();
  });
});

// BL6 REVIEW, Important 2 — CANON-CONFIRMED. Upstream routes an EMPTY submit on an input row into the very
// handler Escape uses: the question panel's Esc key calls its `onCancel` prop (2.1.220 cli.pretty.js:504083),
// the panel hands that same prop to both list primitives (`V3`/`jr`, :504153 and :504161), and the list's
// input row answers an empty submit with `H3e?.()` — that prop again (:397115-397118). Both land on `NMn`
// (:504425-504431, wired at :504546), which fires `tengu_ask_user_question_rejected` and denies. So the
// gesture IS the decline, telemetry included, and it must end the turn exactly as Escape does.
describe("BL6 review: Enter on an EMPTY Other row is the same decline as Esc (canon RLe)", () => {
  it("ends the turn, claimed by the human, with no fabricated answer", async () => {
    const { calls, fake } = spy();
    const { stdin, lastFrame } = app(fake, "classic");
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission(questionEntry());
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");                                        // the digit focuses the (empty) Other input row
    await waitFor(() => frame(lastFrame).includes("Type something."));
    await sleep(20);
    stdin.write("\r");                                       // empty submit → Select's onCancel → onDeny
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "q", decision: { kind: "deny", reason: "declined" } });
    await waitFor(() => calls.interrupts === 1);
    cleanupRoots();
  });
});

// BL6 REVIEW, Minor 3. The mount-time guard for a malformed payload (`input.questions` not an array) shared
// `onDeny`, so a tool payload no human ever saw reported a human decline AND ended the turn. It is its own
// callback now: a bare system deny, no `reason:"declined"`, no interrupt.
describe("BL6 review: a malformed question payload is not a human decline", () => {
  it("sends a bare deny and leaves the turn alone", async () => {
    const { calls, fake } = spy();
    const { lastFrame } = app(fake, "classic");
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission({ ...questionEntry("bad"), input: {} });
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "bad", decision: { kind: "deny" } });
    await sleep(30);
    expect(calls.interrupts).toBe(0);
    cleanupRoots();
  });
});
