// test/tui/tick-consistency.test.tsx — F8 T8 review finding A (red→green): before the fix, `theme.ts` kept
// its OWN `TICK()` with only the non-Windows half of canon's predicate (`env.TERM !== "linux"`), while
// `select/Select.tsx` kept a SEPARATE, faithful copy of canon's full predicate (`EJi`, L104958-104962:
// non-win32 → the TERM check; win32 → an allowlist of terminal emulators known to render unicode). Under
// win32 with none of that allowlist present (an ordinary `cmd.exe`), the weak predicate said "unicode" while
// the full predicate said "ASCII" — so `PlanDialog`/`MultiSelect` (fed by Select's predicate) drew `√` while
// `banner.ts`'s startup checklist and `TaskPanel.tsx` (fed by theme.ts's predicate) drew `✔`, on the SAME
// terminal. The fix consolidates both into one function, `figures.ts`'s `TICK()`, that every consumer either
// calls directly or re-exports (`Select.tsx`) rather than recomputing. This file proves the consolidation:
// under the exact win32-no-markers arm the finding named, every consuming surface must agree.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { Select, type SelectOption } from "../../src/tui/select/Select.js";
import { MultiSelect } from "../../src/tui/select/MultiSelect.js";
import { PlanDialog } from "../../src/tui/PlanDialog.js";
import { renderTips, type Tip } from "../../src/tui/banner.js";
import { TICK, unicodeSupported } from "../../src/tui/figures.js";

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

/** The env markers canon's win32 arm checks for unicode support — cleared to "" (falsy for `Boolean(...)`,
 *  a non-match for the `===`/allowlist checks alike) so the run simulates an ORDINARY `cmd.exe`, not a
 *  Windows Terminal / ConEmu / VS Code integrated terminal that would legitimately earn the unicode glyph. */
const WIN_UNICODE_MARKERS = ["TERM", "WT_SESSION", "TERMINUS_SUBLIME", "ConEmuTask", "TERM_PROGRAM", "TERMINAL_EMULATOR"];

async function underWin32NoUnicode<T>(run: () => Promise<T> | T): Promise<T> {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  for (const k of WIN_UNICODE_MARKERS) vi.stubEnv(k, "");
  try { return await run(); }
  finally {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    vi.unstubAllEnvs();
  }
}

describe("figures.ts — the shared predicate itself (`EJi`, L104958-104962)", () => {
  it("win32 with none of the unicode-terminal markers present falls back to ASCII", async () => {
    await underWin32NoUnicode(() => {
      expect(unicodeSupported()).toBe(false);
      expect(TICK()).toBe("√");
    });
  });
  it("win32 WITH a recognized marker (e.g. Windows Terminal) still gets unicode", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    vi.stubEnv("WT_SESSION", "1");
    try { expect(TICK()).toBe("✔"); }
    finally { Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true }); vi.unstubAllEnvs(); }
  });
});

// Review finding A's own reproduction: "the plan dialog and multi-select draw √ while the startup checklist
// and task panel draw ✔". Each surface below is driven to actually PAINT a tick and checked against the
// SAME win32-no-markers arm — this is the red-green the task asked for; reverting Select.tsx/TaskPanel.tsx/
// banner.ts to import their own `TICK` from `theme.ts` (the pre-fix shape) turns this red again.
describe("Finding A — every consuming surface agrees under win32 with no unicode-terminal markers", () => {
  const noop = () => {};

  it("<Select>'s current-value tick", async () => {
    await underWin32NoUnicode(async () => {
      const opts: SelectOption[] = [{ value: "a", label: "alpha" }, { value: "b", label: "bravo" }];
      const r = renderWithKeymap(<Select options={opts} onChange={noop} onCancel={noop} defaultValue="a" rows={40} columns={100} />);
      await waitFor(() => plain(r.lastFrame()).includes("alpha"));
      const f = plain(r.lastFrame());
      expect(f).toContain("√");
      expect(f).not.toContain("✔");
    });
  });

  it("<MultiSelect>'s checked-box tick", async () => {
    await underWin32NoUnicode(async () => {
      const opts: SelectOption[] = [{ value: "a", label: "alpha" }, { value: "b", label: "bravo" }];
      const r = renderWithKeymap(<MultiSelect options={opts} values={new Set(["a"])} onToggle={noop} onSubmit={noop} onCancel={noop} submitButtonText="Submit" rows={40} />);
      await waitFor(() => plain(r.lastFrame()).includes("alpha"));
      const f = plain(r.lastFrame());
      expect(f).toContain("[√]");
      expect(f).not.toContain("[✔]");
    });
  });

  it("<PlanDialog>'s 'Plan saved!' tick (ctrl+g round-trip)", async () => {
    await underWin32NoUnicode(async () => {
      const PLAN = "# Build it\n\n- step one";
      const r = renderWithKeymap(<PlanDialog req={{ input: { plan: PLAN } }} onDecision={noop} editorName="vim"
        editor={(t: string) => `${t}\n- step two`} rows={40} />);
      await waitFor(() => plain(r.lastFrame()).includes("Build it"));
      r.stdin.write("\x07");                                          // ctrl+g
      await waitFor(() => plain(r.lastFrame()).includes("Plan saved!"));
      const f = plain(r.lastFrame());
      expect(f).toContain("√ Plan saved!");
      expect(f).not.toContain("✔ Plan saved!");
    });
  });

  it("banner.ts's startup-checklist tick (`renderTips`)", async () => {
    await underWin32NoUnicode(() => {
      const tips: Tip[] = [{ key: "done", text: "Finished thing", isEnabled: true, isComplete: true, isCompletable: true }];
      const text = renderTips(tips, false).map((l) => l.text).join("\n");
      expect(text).toContain("√ Finished thing");
      expect(text).not.toContain("✔");
    });
  });

  // TaskPanel's glyph table is a module-level constant (`TODO_GLYPH`, computed once at import) rather than
  // called per-render like the others — so proving it responds to the SAME env/platform arm requires a fresh
  // module instance evaluated AFTER the stub is in place, not the copy this file already imported at its top.
  it("TaskPanel.tsx's completed-row tick (`TODO_GLYPH`)", async () => {
    await underWin32NoUnicode(async () => {
      vi.resetModules();
      const { TODO_GLYPH } = await import("../../src/tui/TaskPanel.js");
      expect(TODO_GLYPH.completed).toBe("√");
    });
  });
});
