// test/tui/clipboardHintChatAppWiring.test.tsx — F10 T-IMGREACH Task 14 fix wave (Cell 12): a MOUNTED
// regression proving the ambient clipboard hint fires through ChatApp's OWN production wiring, not
// through a harness that injects `readClipboardImage`/`checkClipboardImage` directly onto
// `<ChatComposer>` the way `clipboardHint.test.tsx`'s "wiring" describe block does (that block is why the
// feature's own suite went green while the real product never produced the hint — see the Task 14 Cell
// 12 report). Here `<ChatComposer>` is never touched directly: only `<ChatApp>` is rendered, under the
// SAME `KeymapProvider` -> `createFocusChain` -> ChatApp's pass-through `onFocusChange` prop route
// `chatMain.tsx` builds for the real `ccx` binary. The one thing faked is the platform-level child
// process (`node:child_process`'s `execFile`) — the real subprocess boundary `hasClipboardImage` crosses
// — mirroring the live pty proof's fake `osascript` always reporting a clipboard image present.
//
// Red-before/green-after is recorded in task-13-report.md's fix-wave section: reverting ChatApp.tsx's
// two added `<ChatComposer>` props (`readClipboardImage`/`checkClipboardImage`) makes this test fail,
// because the hint's own arm-gate (`ChatComposer.tsx:776`, `if (!readClipboardImageRef.current) return`)
// bails silently with nothing ChatApp supplies.
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { createFocusChain } from "../../src/tui/chatMain.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { CLIPBOARD_HINT_DEBOUNCE_MS } from "../../src/tui/clipboardHint.js";

// The ONE platform boundary this test fakes. A `null` error passed to the callback means exit code 0 —
// "there is a clipboard image" — exactly what a fake `osascript` returning 0 reports in the pty proof.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(
      (_cmd: string, _args: unknown, _opts: unknown, cb: (err: unknown, stdout: string, stderr: string) => void) => {
        cb(null, "", "");
      },
    ),
  };
});

const frame = (f: () => string | undefined): string => (f() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("ChatApp — the ambient clipboard hint through PRODUCTION wiring (F10 T-IMGREACH Task 14 Cell 12 regression)", () => {
  it("a real \\x1b[I focus-in report routed through KeymapProvider -> createFocusChain -> ChatApp's pass-through onFocusChange -> ChatComposer fires the hint, with nothing injected directly onto ChatComposer", async () => {
    const focusChain = createFocusChain();
    const { stdin, lastFrame, unmount } = render(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
        onFocusChange={focusChain.subscribe} />,
      { onFocusChange: focusChain.publish },
    );
    try {
      await tick();
      await waitFor(() => frame(lastFrame).includes("❯"));   // ❯ — the composer has mounted and painted
      vi.useFakeTimers();
      try {
        act(() => { stdin.write("\x1b[I"); });                    // the raw DECSET-1004 focus-in bytes
        await act(async () => { await vi.advanceTimersByTimeAsync(CLIPBOARD_HINT_DEBOUNCE_MS); });
      } finally {
        vi.useRealTimers();
      }
      expect(frame(lastFrame)).toContain("Image in clipboard · ctrl+v to paste");
    } finally {
      unmount();
    }
  });
});
