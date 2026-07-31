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
import { render } from "ink-testing-library";
import { Box } from "ink";
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
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

describe("composer prefill: consumed at most once across a popup remount (Important 1)", () => {
  it("a rewind prefill, once applied, does not resurrect after the shortcuts overlay opens and closes", async () => {
    const session = fakeRewindSession({ rewind: async () => {} });
    const deps = { getSessionMessages: async () => [] as any[] };
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
    await waitFor(() => frame(lastFrame).includes("›"));   // composer remounted (placeholder or otherwise)
    await new Promise((r) => setTimeout(r, 60));           // let the remounted composer's apply-effect settle

    // The already-consumed prefill must not resurrect into the freshly-mounted, empty composer.
    expect(frame(lastFrame)).not.toContain("fix the parser");
  });
});

// Task 3 (CM49): interrupt() rescues a queue into the composer via a "prepend" prefill, which must MERGE
// with whatever the user was mid-typing rather than clobber it. Mounts ChatComposer directly (no useChat)
// and drives `prefill` via rerender — the narrowest harness that can pin the merge contract in ChatComposer's
// own effect, independent of useChat's interrupt() wiring (covered end-to-end by chat.test.tsx instead).
describe("composer prefill: prepend mode merges with an existing draft (Task 3, CM49)", () => {
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
