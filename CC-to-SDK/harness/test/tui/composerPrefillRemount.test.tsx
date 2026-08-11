// test/tui/composerPrefillRemount.test.tsx — final whole-branch review Important 1: a consumed rewind
// prefill must never resurrect into the composer. `composerPrefill` used to be cleared nowhere, and the
// "already applied" dedup lived in a ChatComposer-local ref — but the composer UNMOUNTS every time any
// popup arm takes over (shortcuts overlay, rewind picker, bg-tasks panel, model/session picker, any
// decision dialog), which resets that ref to 0 on the next mount while `composerPrefill` still held the
// already-consumed text. So: rewind → prefill applied → user edits+submits → a dialog answered mid-turn
// → composer remounts still holding the OLD prefill state → the ref resets → the effect re-applies the
// stale rewound prompt. This harness mirrors ChatApp's exact conditional (shortcutsOpen ? overlay :
// composer) without the rest of the tree, so opening/closing the `?` overlay — the cheapest popup arm —
// reproduces the same mount/unmount ChatApp would.
import { describe, it, expect } from "vitest";
import React from "react";
// F2 task 6: ChatApp/ChatComposer read stdin through <KeymapProvider> now, not `useInput` — rendered bare
// they have no input path at all, so every render here goes through the provider wrapper.
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { Box, Text } from "ink";
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { initialEditorState, type EditorState } from "../../src/tui/editor.js";
import { ShortcutsOverlay } from "../../src/tui/ShortcutsOverlay.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../../src/session/chatSession.js";

const frame = (f: () => string | undefined) => (f() ?? "").replace(/\n/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

type RewindFakeOpts = { rewind?: (anchor: RewindAnchor, scope: RewindScope) => Promise<void> };
function fakeRewindSession(rewindOpts: RewindFakeOpts = {}, remoteOpts: FakeRemoteOpts = {}) {
  const base = fakeRemote(remoteOpts);
  return { ...base, rewindAnchors: async () => [] as RewindAnchor[], rewindDryRun: async () => ({ canRewind: true }) as RewindDryRun, rewind: rewindOpts.rewind ?? (async () => {}) };
}

const ANCHOR: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "fix the parser", index: 2 };

type Api = { confirmRewind?: (a: RewindAnchor, s: RewindScope) => void; openShortcuts?: () => void; closeShortcuts?: () => void };

/** Mirrors ChatApp's `{shortcutsOpen ? <ShortcutsOverlay/> : ... : <ChatComposer/>}` ternary exactly —
 *  the composer is fully absent from the tree while the overlay is open, not merely hidden. */
function Harness({ makeSession, deps, api }: { makeSession: () => ChatSession; deps: any; api: Api }) {
  const c = useChat(makeSession, {}, deps);
  api.confirmRewind = (c as any).confirmRewind;
  api.openShortcuts = c.openShortcuts;
  api.closeShortcuts = c.closeShortcuts;
  const s = c.state as any;
  return (
    <Box flexDirection="column">
      {s.shortcutsOpen
        ? <ShortcutsOverlay onClose={c.closeShortcuts} />
        : <ChatComposer onSubmit={c.submit} cwd={process.cwd()} commandCatalog={s.commandCatalog} onHelp={c.openShortcuts} prefill={s.composerPrefill} onPrefillApplied={(c as any).clearPrefill} />}
    </Box>
  );
}

type DurableApi = { open?: () => void; close?: () => void; bumpClear?: () => void };
function DurableHarness({ editorStateRef, consumedPrefillTokenRef, consumedClearTokenRef, prefill, api, onSubmit = () => {} }: {
  editorStateRef: React.MutableRefObject<EditorState>;
  consumedPrefillTokenRef?: React.MutableRefObject<number>;
  consumedClearTokenRef?: React.MutableRefObject<number>;
  prefill?: { text: string; token: number } | null;
  api: DurableApi;
  onSubmit?: (text: string) => void;
}) {
  const [overlayOpen, setOverlayOpen] = React.useState(false);
  // ChatApp's own `clearDraftToken` state, mirrored here: Ctrl-C's first press bumps it from wherever the
  // app is — including while the overlay owns the screen and the composer is not in the tree at all.
  const [clearDraftToken, setClearDraftToken] = React.useState(0);
  api.open = () => setOverlayOpen(true);
  api.close = () => setOverlayOpen(false);
  api.bumpClear = () => setClearDraftToken((n) => n + 1);
  return <Box flexDirection="column">
    {overlayOpen
      ? <Text>Settings overlay</Text>
      : <ChatComposer editorStateRef={editorStateRef} consumedPrefillTokenRef={consumedPrefillTokenRef} consumedClearTokenRef={consumedClearTokenRef} clearDraftToken={clearDraftToken} prefill={prefill} onSubmit={onSubmit} cwd={process.cwd()} commandCatalog={[]} />}
  </Box>;
}

describe("composer prefill: consumed at most once across a popup remount (Important 1)", () => {
  it("a rewind prefill, once applied, does not resurrect after the shortcuts overlay opens and closes", async () => {
    const session = fakeRewindSession({ rewind: async () => {} });
    const deps = { getSessionMessages: async () => [] as any[], rewindReplayRetry: { attempts: 1, delayMs: 0 } };
    const api: Api = {};
    const { lastFrame } = render(<Harness makeSession={() => session} deps={deps} api={api} />);
    await new Promise((r) => setTimeout(r, 20));   // let the composer's useInput subscribe

    // 1. Rewind sets composerPrefill; the mounted composer applies it into its buffer.
    api.confirmRewind!(ANCHOR, "both");
    await waitFor(() => frame(lastFrame).includes("fix the parser"));

    // 2. A popup arm takes over — the composer unmounts (ChatApp does this for every dialog/picker,
    // Esc-Esc rewind, bg-tasks panel, model/session picker; the `?` overlay is the cheapest to drive).
    api.openShortcuts!();
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    expect(frame(lastFrame)).not.toContain("fix the parser");   // composer is gone, not just hidden

    // 3. The popup closes — the composer REMOUNTS fresh (a new component instance, ref reset to 0).
    api.closeShortcuts!();
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));   // composer remounted (placeholder or otherwise)
    await new Promise((r) => setTimeout(r, 60));           // let the remounted composer's apply-effect settle

    // The already-consumed prefill must not resurrect into the freshly-mounted, empty composer.
    expect(frame(lastFrame)).not.toContain("fix the parser");
  });
});

describe("app-scoped durable editor state across overlay remounts", () => {
  it("retains the current rescue draft, kill ring, and submit reset without restoring stale autocomplete", async () => {
    const editorStateRef = { current: initialEditorState() };
    const api: DurableApi = {};
    const submitted: string[] = [];
    const { stdin, lastFrame } = render(<DurableHarness editorStateRef={editorStateRef} api={api} onSubmit={(text) => submitted.push(text)} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("rescued prompt");
    await waitFor(() => frame(lastFrame).includes("rescued prompt"));
    api.open!();                                                    // immediate parent transition: no passive draft copy may race it
    await waitFor(() => frame(lastFrame).includes("Settings overlay"));
    api.close!();
    await waitFor(() => frame(lastFrame).includes("rescued prompt"));
    await new Promise((r) => setTimeout(r, 20));

    stdin.write(" edited");
    await waitFor(() => frame(lastFrame).includes("rescued prompt edited"));
    stdin.write("\x15");
    await waitFor(() => !frame(lastFrame).includes("rescued prompt edited"));
    api.open!(); await waitFor(() => frame(lastFrame).includes("Settings overlay"));
    api.close!(); await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x19");
    await waitFor(() => frame(lastFrame).includes("rescued prompt edited"));

    stdin.write("\r");
    await waitFor(() => submitted.length === 1);
    api.open!(); await waitFor(() => frame(lastFrame).includes("Settings overlay"));
    api.close!(); await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    expect(frame(lastFrame)).not.toContain("rescued prompt edited");

    editorStateRef.current = {
      ...initialEditorState(), lines: ["/review"], cursor: { row: 0, col: 7 },
      command: { span: { row: 0, start: 0, end: 7 }, query: "review", head: true, items: [{ name: "review", description: "stale popup", source: "catalog" }], catalog: [], index: 0 },
    };
    api.open!(); await waitFor(() => frame(lastFrame).includes("Settings overlay"));
    api.close!(); await waitFor(() => frame(lastFrame).includes("/review"));
    expect(frame(lastFrame)).not.toContain("stale popup");
  });

  it("keeps an edited durable draft when a stale parent prefill survives an overlay remount", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const consumedPrefillTokenRef = { current: 0 } as React.MutableRefObject<number>;
    const api: DurableApi = {};
    const { stdin, lastFrame } = render(
      <DurableHarness editorStateRef={editorStateRef} consumedPrefillTokenRef={consumedPrefillTokenRef}
        prefill={{ text: "old rewind", token: 17 }} api={api} />,
    );
    await waitFor(() => frame(lastFrame).includes("old rewind"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(" revised");
    await waitFor(() => frame(lastFrame).includes("old rewind revised"));

    api.open!(); await waitFor(() => frame(lastFrame).includes("Settings overlay"));
    api.close!(); await waitFor(() => frame(lastFrame).includes("old rewind revised"));
    await new Promise((r) => setTimeout(r, 30)); // allow a remounted passive prefill effect to expose a stale-token bug
    expect(frame(lastFrame)).toContain("old rewind revised");
    expect(consumedPrefillTokenRef.current).toBe(17);
  });
});

// WAVE C FINAL REVIEW, finding 1 — the mirror image of Important 1 above, and the reason both live in this
// file: `prefill`'s consumed cursor is APP-scoped and Ctrl-C's was COMPONENT-scoped, so the two tokens
// disagreed about what a remount means. A draft does not die when a dialog takes the screen — it is parked in
// the app-scoped `editorStateRef` and painted again on the way back — so a Ctrl-C pressed while the dialog is
// up has a real buffer to clear. Seeding the consumed marker FROM the live token at mount marked that bump
// as already-consumed, and the parked draft came back intact.
describe("composer clear channel: a Ctrl-C during a dialog still clears the PARKED draft (final review, finding 1)", () => {
  it("applies a clear-token bump that landed while the composer was unmounted", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const consumedClearTokenRef = { current: 0 } as React.MutableRefObject<number>;
    const api: DurableApi = {};
    const { stdin, lastFrame } = render(<DurableHarness editorStateRef={editorStateRef} consumedClearTokenRef={consumedClearTokenRef} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("half-typed prompt");
    await waitFor(() => frame(lastFrame).includes("half-typed prompt"));

    // A permission/question dialog takes the screen. The composer leaves the tree; the draft stays in the ref.
    api.open!(); await waitFor(() => frame(lastFrame).includes("Settings overlay"));
    // Ctrl-C's first press, from ChatApp, with no composer mounted to hear it.
    api.bumpClear!();
    await new Promise((r) => setTimeout(r, 20));
    api.close!(); await waitFor(() => frame(lastFrame).includes("❯ "));
    await new Promise((r) => setTimeout(r, 40));   // let the remounted composer's clear effect settle

    expect(frame(lastFrame)).not.toContain("half-typed prompt");
    expect(editorStateRef.current.lines.join("\n")).toBe("");
  });

  it("does not re-clear a draft typed AFTER the bump was already consumed", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const consumedClearTokenRef = { current: 0 } as React.MutableRefObject<number>;
    const api: DurableApi = {};
    const { stdin, lastFrame } = render(<DurableHarness editorStateRef={editorStateRef} consumedClearTokenRef={consumedClearTokenRef} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("first draft");
    await waitFor(() => frame(lastFrame).includes("first draft"));
    api.bumpClear!();                                     // Ctrl-C with the composer MOUNTED: clears on the spot
    await waitFor(() => !frame(lastFrame).includes("first draft"));
    expect(consumedClearTokenRef.current).toBe(1);

    stdin.write("second draft");
    await waitFor(() => frame(lastFrame).includes("second draft"));
    api.open!(); await waitFor(() => frame(lastFrame).includes("Settings overlay"));
    api.close!(); await waitFor(() => frame(lastFrame).includes("second draft"));
    await new Promise((r) => setTimeout(r, 40));
    expect(frame(lastFrame)).toContain("second draft");   // the consumed bump must not fire a second time
  });
});

// Task 3 (CM49): interrupt() rescues a queue into the composer via a "prepend" prefill, which must MERGE
// with whatever the user was mid-typing rather than clobber it. Mounts ChatComposer directly (no useChat)
// and drives `prefill` via rerender — the narrowest harness that can pin the merge contract in ChatComposer's
// own effect, independent of useChat's interrupt() wiring (covered end-to-end by chat.test.tsx instead).
describe("composer prefill: draft-start ownership", () => {
  it("notifies only when an external prefill turns an empty buffer nonempty", async () => {
    let starts = 0;
    const onDraftStart = () => { starts++; };
    const { lastFrame, rerender } = render(
      <ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} onDraftStart={onDraftStart} prefill={null} />,
    );
    await new Promise((r) => setTimeout(r, 20));

    rerender(<ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} onDraftStart={onDraftStart} prefill={{ text: "", token: 1 }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(starts).toBe(0);

    rerender(<ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} onDraftStart={onDraftStart} prefill={{ text: "recalled prompt", token: 2 }} />);
    await waitFor(() => frame(lastFrame).includes("recalled prompt"));
    expect(starts).toBe(1);

    rerender(<ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} onDraftStart={onDraftStart} prefill={{ text: "queued", token: 3, mode: "prepend" }} />);
    await waitFor(() => frame(lastFrame).includes("queued"));
    expect(starts).toBe(1);
  });
});

describe("composer prefill: prepend mode merges with an existing draft (Task 3, CM49)", () => {
  it("a prepend-mode prefill retains a whitespace-only draft and submits exact bytes", async () => {
    const submitted: string[] = [];
    const { stdin, lastFrame, rerender } = render(
      <ChatComposer onSubmit={(value) => submitted.push(value)} cwd={process.cwd()} commandCatalog={[]} prefill={null} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("   ");
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    rerender(<ChatComposer onSubmit={(value) => submitted.push(value)} cwd={process.cwd()} commandCatalog={[]} prefill={{ text: "queued", token: 1, mode: "prepend" }} />);
    await waitFor(() => frame(lastFrame).includes("queued"));
    stdin.write("\r");
    await waitFor(() => submitted.length === 1);
    expect(submitted[0]).toBe("queued\n   ");
  });

  it("a prepend-mode prefill lands ABOVE an existing draft instead of replacing it; a replace/modeless prefill still replaces wholesale", async () => {
    const { stdin, lastFrame, rerender } = render(
      <ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} prefill={null} />,
    );
    await new Promise((r) => setTimeout(r, 20));   // let the composer's useInput subscribe

    stdin.write("my draft");
    await waitFor(() => frame(lastFrame).includes("my draft"));

    // A prepend prefill arrives (e.g. interrupt() rescuing the queue) while the draft is still there.
    rerender(<ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} prefill={{ text: "q1\nq2", token: 1, mode: "prepend" }} />);
    await waitFor(() => frame(lastFrame).includes("q1"));
    const merged = frame(lastFrame);
    expect(merged).toContain("q1");
    expect(merged).toContain("q2");
    expect(merged).toContain("my draft");   // draft survived, not clobbered

    // A later replace-mode (or modeless) prefill still replaces the buffer wholesale — existing rewind/
    // history-accept behavior (both call setComposerPrefill with no `mode`) must stay unchanged.
    rerender(<ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} prefill={{ text: "replaced", token: 2 }} />);
    await waitFor(() => frame(lastFrame).includes("replaced"));
    const replaced = frame(lastFrame);
    expect(replaced).not.toContain("my draft");
    expect(replaced).not.toContain("q1");
    expect(replaced).not.toContain("q2");
  });
});
