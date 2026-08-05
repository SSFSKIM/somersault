// test/tui/inline-dialog.test.tsx — F6 Task 5 (DG27): a permission or question dialog renders INLINE, between
// the transcript and a still-mounted composer, instead of replacing the composer the way every overlay does.
// Upstream gives every dialog but exit-plan-mode `layout:"inline"` (bundle L507338, L507345-351).
//
// The whole task is really one question — WHO OWNS THE KEYBOARD — because the F2 registry resolves innermost
// by MOUNT ORDER (keys/registry.ts) and a composer that is still mounted below the dialog is a live claimant.
// Two halves are pinned here:
//   · the MECHANISM, at component level, where the composer's durable `editorStateRef` is reachable: while the
//     dialog is up, Escape / digits / letters reach the DIALOG and the draft in that ref does not move by one
//     character. It is asserted on the ref and never on the frame — the composer's `Try "…"` placeholder is a
//     randomized draw (placeholder.ts), so a frame-level negative is a flake waiting to happen (F5 lesson).
//   · the ARRANGEMENT, at app level: transcript + dialog + composer all on screen at once, the draft intact
//     across appear-and-resolve, plan approval still modal, and an overlay still winning outright over a
//     parked decision (ChatApp's accepted oddity — the decision re-renders fresh on overlay close).
import { describe, it, expect } from "vitest";
import React from "react";
import { Box } from "ink";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ChatComposer, type InputOwner } from "../../src/tui/ChatComposer.js";
import { PermissionDialog } from "../../src/tui/PermissionDialog.js";
import { initialEditorState, bufferText, type EditorState } from "../../src/tui/editor.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { PermissionDecision } from "../../src/index.js";

const frame = (f: () => string | undefined) => f() ?? "";
const flat = (f: () => string | undefined) => frame(f).replace(/\x1b\[[0-9;]*m/g, "").replace(/\n/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** The composer's own prompt row is `❯` + NBSP (F5 t2); the transcript's echo uses a normal space. */
const GLYPH = "❯ ";

// Every history read in this file points at a throwaway fleet root, so no test reads (or writes) the real
// ~/.claude prompt log.
const roots: string[] = [];
const tmpEnv = (): NodeJS.ProcessEnv => {
  const root = mkdtempSync(join(tmpdir(), "ccx-inline-dialog-"));
  roots.push(root);
  return { ...process.env, CCX_FLEET_ROOT: root };
};
const cleanupRoots = () => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); };

const permissionEntry = (toolUseID = "t"): PendingEntry =>
  ({ sessionId: "s", toolUseID, toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });

// ── The component-level harness. It is ChatApp's NEW arrangement with nothing else in it: the dialog above,
// the composer below and still mounted, and the one `inputOwnerRef` that tells the composer it is no longer
// the owner. ChatApp computes that ref exactly this way (`state.pending` → "decision").
type Api = { park?: () => void; resolve?: () => void };
function InlineHarness({ editorStateRef, api, decisions }: {
  editorStateRef: React.MutableRefObject<EditorState>;
  api: Api;
  decisions: PermissionDecision[];
}) {
  const [pending, setPending] = React.useState(false);
  api.park = () => setPending(true);
  api.resolve = () => setPending(false);
  // Written during render, before the children render — ChatApp's own discipline.
  const inputOwnerRef = React.useRef<InputOwner>("composer");
  inputOwnerRef.current = pending ? "decision" : "composer";
  return (
    <Box flexDirection="column">
      {pending ? <PermissionDialog req={{ toolName: "Edit", input: { file_path: "f.ts" } }} onDecision={(d) => { decisions.push(d); setPending(false); }} /> : null}
      <ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} inputOwnerRef={inputOwnerRef} editorStateRef={editorStateRef} historyEnv={tmpEnv()} />
    </Box>
  );
}
/** A ref the composer will not re-seed from disk (`historySeeded` is the durable gate — ChatComposer.tsx). */
const seededRef = (): React.MutableRefObject<EditorState> => ({ current: { ...initialEditorState(), historySeeded: true } });

describe("inline dialog — keyboard ownership (the mechanism)", () => {
  it("printable characters reach the dialog and leave the durable draft untouched", async () => {
    const editorStateRef = seededRef();
    const api: Api = {}, decisions: PermissionDecision[] = [];
    const { stdin, lastFrame } = render(<InlineHarness editorStateRef={editorStateRef} api={api} decisions={decisions} />);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("keepme");
    await waitFor(() => bufferText(editorStateRef.current) === "keepme");

    api.park!();
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("xyz");                                   // printables: bound in no context, so this is the FALLBACK
    stdin.write("q");                                     // …and a single unbound key event, the other fallback shape
    await new Promise((r) => setTimeout(r, 30));
    expect(bufferText(editorStateRef.current)).toBe("keepme");   // the draft, not the frame (randomized placeholder)
    expect(decisions).toEqual([]);                        // none of those letters is a decision either
    cleanupRoots();
  });

  it("Escape denies through the dialog instead of reaching the composer's chat:cancel", async () => {
    const editorStateRef = seededRef();
    const api: Api = {}, decisions: PermissionDecision[] = [];
    const { stdin, lastFrame } = render(<InlineHarness editorStateRef={editorStateRef} api={api} decisions={decisions} />);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("keepme");
    await waitFor(() => bufferText(editorStateRef.current) === "keepme");
    api.park!();
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("\x1b");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "deny" });
    // The composer's own Escape is the Esc-Esc clear arm, which would have wiped this buffer to history.
    expect(bufferText(editorStateRef.current)).toBe("keepme");
    cleanupRoots();
  });

  it("a digit picks the dialog's numbered row, and the composer takes keys again the moment it resolves", async () => {
    const editorStateRef = seededRef();
    const api: Api = {}, decisions: PermissionDecision[] = [];
    const { stdin, lastFrame } = render(<InlineHarness editorStateRef={editorStateRef} api={api} decisions={decisions} />);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("draft");
    await waitFor(() => bufferText(editorStateRef.current) === "draft");
    api.park!();
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("2");
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "allow_always" });
    expect(bufferText(editorStateRef.current)).toBe("draft");
    await waitFor(() => !frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("2");                                     // ownership handed straight back — no remount in between
    await waitFor(() => bufferText(editorStateRef.current) === "draft2");
    cleanupRoots();
  });
});

describe("inline dialog — the arrangement", () => {
  it("draws the transcript, the dialog and the composer at the same time", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env: tmpEnv() }} />);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("hello"); await waitFor(() => frame(lastFrame).includes("hello"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));       // fakeRemote's reply — the transcript
    stdin.write("mid-draft"); await waitFor(() => frame(lastFrame).includes("mid-draft"));

    fake.parkPermission(permissionEntry());
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    const f = flat(lastFrame);
    expect(f).toContain("ok");                       // transcript still above
    expect(f).toContain("Allow Claude to use");      // dialog in the middle
    expect(f).toContain(GLYPH);                      // composer still below, mounted and drawn
    expect(f).toContain("mid-draft");                // …holding the draft it held before the dialog arrived
    expect(f.indexOf("Allow Claude to use")).toBeLessThan(f.indexOf(GLYPH));   // dialog ABOVE the composer
    cleanupRoots();
  });

  it("the draft survives the dialog appearing and resolving, and keeps taking input after", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env: tmpEnv() }} />);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("survive me"); await waitFor(() => frame(lastFrame).includes("survive me"));
    fake.parkPermission(permissionEntry("d1"));
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("1");                                                     // allow once → the dialog goes away
    await waitFor(() => fake.answeredCalls.length === 1);
    await waitFor(() => !frame(lastFrame).includes("Allow Claude to use"));
    expect(flat(lastFrame)).toContain("survive me");
    stdin.write(" more"); await waitFor(() => flat(lastFrame).includes("survive me more"));
    cleanupRoots();
  });

  it("a parked question answers from the inline dialog while the composer stays on screen", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env: tmpEnv() }} />);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission({ sessionId: "s", toolUseID: "q", toolName: "AskUserQuestion", kind: "question",
      input: { questions: [{ question: "Red or blue?", multiSelect: false, options: [{ label: "red" }, { label: "blue" }] }] }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    expect(flat(lastFrame)).toContain(GLYPH);
    stdin.write("2");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "q", decision: { kind: "question_answer", answers: { "Red or blue?": "blue" } } });
    cleanupRoots();
  });

  it("plan approval stays MODAL — the one upstream layout:\"modal\" dialog replaces the composer", async () => {
    const fake = fakeRemote();
    const { lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env: tmpEnv() }} />);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    fake.parkPermission({ sessionId: "s", toolUseID: "p", toolName: "ExitPlanMode", kind: "plan", input: { plan: "ship it" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Approve this plan?"));
    expect(frame(lastFrame)).not.toContain(GLYPH);        // deterministic: the glyph is the composer's own row
    cleanupRoots();
  });

  it("an overlay still wins outright over a parked decision, which re-renders fresh when it closes", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env: tmpEnv() }} />);
    await waitFor(() => frame(lastFrame).includes(GLYPH));
    stdin.write("?");                                                     // the `?` shortcuts overlay (an overlay arm)
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    fake.parkPermission(permissionEntry("hidden"));
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("Allow Claude to use");        // exclusivity: no dialog under the overlay
    expect(frame(lastFrame)).not.toContain(GLYPH);                        // …and no composer either
    stdin.write("\x1b");                                                  // the overlay's own Escape
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    expect(flat(lastFrame)).toContain(GLYPH);                             // both come back together
    stdin.write("1");
    await waitFor(() => fake.answeredCalls.length === 1);                 // the park was never lost, only hidden
    cleanupRoots();
  });
});
