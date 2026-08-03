// tui/test/keys-migration-dialogs.test.tsx — F2 task 8: the dialogs and pickers are on the keymap engine.
// Eleven components stopped calling `useInput`; the four families they split into (Select / Confirmation /
// Settings+Tabs) are contexts in the binding table now, so each surface inherits the WHOLE context instead of
// the handful of keys its own handler happened to read. That is what these tests pin:
//   * KB15 — pageup/pagedown/home/end exist in the Select family for the first time (SessionPicker is the
//     representative; a page is the component's visible-row count, else PAGE_ROWS).
//   * KB14 — j/k and ctrl+n/ctrl+p now navigate in EVERY Select-family surface, not the two that hand-rolled
//     them (ThemeDialog, OutputStylePicker).
//   * The `k` reassignment: the table's `k` = select:previous wins over BgTasksPanel's legacy `k` = stop, so
//     stop is `x` only.
//   * QuestionDialog's free-text row keeps `y`/`n`/`enter` LITERAL while typing (the Confirmation scope is
//     gated off there), which is the one place the table would otherwise eat a user's answer.
// Rendered bare these components have no input path at all — every render goes through `renderWithKeymap`.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { SessionPicker } from "../../src/tui/SessionPicker.js";
import { ModelPicker } from "../../src/tui/ModelPicker.js";
import { OutputStylePicker } from "../../src/tui/OutputStylePicker.js";
import { ThemeDialog } from "../../src/tui/ThemeDialog.js";
import { BgTasksPanel } from "../../src/tui/BgTasksPanel.js";
import { QuestionDialog } from "../../src/tui/QuestionDialog.js";
import { PlanDialog } from "../../src/tui/PlanDialog.js";
import { AddDirDialog } from "../../src/tui/AddDirDialog.js";
import type { AddDirVerdict } from "../../src/tui/addDir.js";
import type { BgTaskRow } from "../../src/tui/bgTaskMeta.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { RewindAnchor, RewindDryRun } from "../../src/session/chatSession.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

// Byte sequences for the four keys Ink's `useInput` could not name at all (P86 §1.1) plus the two vi keys.
const PAGEUP = "\x1b[5~", PAGEDOWN = "\x1b[6~", HOME = "\x1b[H", END = "\x1b[F";
const CTRL_N = "\x0e", CTRL_P = "\x10";

const SESSIONS = Array.from({ length: 25 }, (_, i) => ({
  sessionId: `S${String(i).padStart(7, "0")}`, summary: `row ${String(i).padStart(2, "0")}`, lastModified: i,
}));
/** SessionPicker marks the selected row with `inverse` — an SGR 7 run that must contain that row's summary. */
const rowSelected = (f: string, n: number) => new RegExp(`\\x1b\\[7m[^\\x1b]*row ${String(n).padStart(2, "0")}`).test(f);
/** Every other picker marks it with a leading "❯ ". */
const cursorOn = (f: string, label: string) => f.includes(`❯ ${label}`);

describe("F2 task 8 — Select family: KB15 paging (SessionPicker is the representative)", () => {
  it("pageup/pagedown move a whole page and clamp; home/end jump to the first/last row", async () => {
    const { stdin, lastFrame } = render(<SessionPicker sessions={SESSIONS} onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => rowSelected(frame(lastFrame), 0));
    stdin.write(PAGEDOWN); await waitFor(() => rowSelected(frame(lastFrame), 10));
    stdin.write(PAGEDOWN); await waitFor(() => rowSelected(frame(lastFrame), 20));
    stdin.write(PAGEDOWN); await waitFor(() => rowSelected(frame(lastFrame), 24));   // clamps at the last row
    stdin.write(PAGEUP);   await waitFor(() => rowSelected(frame(lastFrame), 14));
    stdin.write(HOME);     await waitFor(() => rowSelected(frame(lastFrame), 0));
    stdin.write(PAGEUP);   await waitFor(() => rowSelected(frame(lastFrame), 0));    // clamps at the first row
    stdin.write(END);      await waitFor(() => rowSelected(frame(lastFrame), 24));
  });

  it("Enter after paging picks the row the page landed on, not the one it started from", async () => {
    let picked: { sessionId: string } | undefined;
    const { stdin, lastFrame } = render(<SessionPicker sessions={SESSIONS} onPick={(s) => { picked = s; }} onCancel={() => {}} />);
    await waitFor(() => rowSelected(frame(lastFrame), 0));
    stdin.write(END); await waitFor(() => rowSelected(frame(lastFrame), 24));
    stdin.write("\r"); await waitFor(() => picked !== undefined);
    expect(picked!.sessionId).toBe("S0000024");
  });

  it("paging an EMPTY list is inert (no crash, no selection)", async () => {
    const { stdin, lastFrame } = render(<SessionPicker sessions={[]} onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("no sessions"));
    for (const k of [PAGEDOWN, PAGEUP, HOME, END, "\r"]) stdin.write(k);
    await tick();
    expect(frame(lastFrame)).toContain("no sessions");
  });
});

describe("F2 task 8 — KB14: j/k and ctrl+n/ctrl+p navigate in EVERY Select-family surface", () => {
  it("SessionPicker", async () => {
    const { stdin, lastFrame } = render(<SessionPicker sessions={SESSIONS} onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => rowSelected(frame(lastFrame), 0));
    stdin.write("j");    await waitFor(() => rowSelected(frame(lastFrame), 1));
    stdin.write(CTRL_N); await waitFor(() => rowSelected(frame(lastFrame), 2));
    stdin.write("k");    await waitFor(() => rowSelected(frame(lastFrame), 1));
    stdin.write(CTRL_P); await waitFor(() => rowSelected(frame(lastFrame), 0));
  });

  it("ModelPicker", async () => {
    const models = [{ value: "a", displayName: "Alpha" }, { value: "b", displayName: "Beta" }, { value: "c", displayName: "Gamma" }];
    const picked: string[] = [];
    const { stdin, lastFrame } = render(<ModelPicker models={models} onPick={(m) => picked.push(m.value)} onCancel={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("switch model"));
    stdin.write("j");    await waitFor(() => /\x1b\[7m[^\x1b]*Beta/.test(frame(lastFrame)));
    stdin.write(CTRL_N); await waitFor(() => /\x1b\[7m[^\x1b]*Gamma/.test(frame(lastFrame)));
    stdin.write("k");    await waitFor(() => /\x1b\[7m[^\x1b]*Beta/.test(frame(lastFrame)));
    stdin.write(CTRL_P); await waitFor(() => /\x1b\[7m[^\x1b]*Alpha/.test(frame(lastFrame)));
    stdin.write("\r");   await waitFor(() => picked.length === 1);
    expect(picked).toEqual(["a"]);
  });

  it("OutputStylePicker", async () => {
    const { stdin, lastFrame } = render(<OutputStylePicker onPick={() => {}} onCancel={() => {}} />);
    await waitFor(() => cursorOn(frame(lastFrame), "Default"));
    stdin.write("j");    await waitFor(() => cursorOn(frame(lastFrame), "Proactive"));
    stdin.write(CTRL_N); await waitFor(() => cursorOn(frame(lastFrame), "Explanatory"));
    stdin.write("k");    await waitFor(() => cursorOn(frame(lastFrame), "Proactive"));
    stdin.write(CTRL_P); await waitFor(() => cursorOn(frame(lastFrame), "Default"));
  });

  it("ThemeDialog (already hand-rolled j/k — it must keep working through the table)", async () => {
    const { stdin, lastFrame } = render(<ThemeDialog onDone={() => {}} savePrefs={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Choose the text style"));
    stdin.write("j");    await waitFor(() => cursorOn(frame(lastFrame), "Dark mode"));
    stdin.write(CTRL_N); await waitFor(() => cursorOn(frame(lastFrame), "Light mode"));
    stdin.write("k");    await waitFor(() => cursorOn(frame(lastFrame), "Dark mode"));
    stdin.write(CTRL_P); await waitFor(() => cursorOn(frame(lastFrame), "Auto (match terminal)"));
  });

  it("BgTasksPanel — where `k` USED to stop a task and now navigates (the table wins)", async () => {
    const tasks: BgTaskRow[] = [
      { task_id: "aaa11111", task_type: "local_bash", description: "one", command: "one", status: "running" },
      { task_id: "bbb22222", task_type: "local_bash", description: "two", command: "two", status: "running" },
      { task_id: "ccc33333", task_type: "local_bash", description: "three", command: "three", status: "running" },
    ];
    const stopped: string[] = [];
    const { stdin, lastFrame } = render(<BgTasksPanel tasks={tasks} onStop={(id) => stopped.push(id)} onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    stdin.write("j");    await waitFor(() => frame(lastFrame).includes("❯ ⟳ bbb22222"));
    stdin.write(CTRL_N); await waitFor(() => frame(lastFrame).includes("❯ ⟳ ccc33333"));
    stdin.write("k");    await waitFor(() => frame(lastFrame).includes("❯ ⟳ bbb22222"));
    stdin.write(CTRL_P); await waitFor(() => frame(lastFrame).includes("❯ ⟳ aaa11111"));
    expect(stopped).toEqual([]);                                  // `k` never stopped anything on the way
    stdin.write("x"); await waitFor(() => stopped.length === 1);   // stop is `x` alone now
    expect(stopped).toEqual(["aaa11111"]);
  });

  it("BgTasksPanel advertises the reassigned key: `x stop`, never `k/x stop`", async () => {
    const { lastFrame } = render(<BgTasksPanel tasks={[]} onStop={() => {}} onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    expect(frame(lastFrame)).toContain("⏎ output · x stop · esc close");
    expect(frame(lastFrame)).not.toContain("k/x stop");
  });
});

describe("F2 task 8 — Confirmation family: what the table adds, and what free text must keep", () => {
  const PLAN = { input: { plan: "# Build it\n\n- step one" } };

  it("PlanDialog: y approves with acceptEdits FALSE (auto-accept stays the explicit `1`); n opens the feedback line", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = render(<PlanDialog req={PLAN} onDecision={(o) => decisions.push(o)} />);
    await waitFor(() => frame(lastFrame).includes("Build it"));
    expect(frame(lastFrame)).toContain("y approve");                // the new affordance is advertised, not hidden
    stdin.write("y"); await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: false });

    const b = render(<PlanDialog req={PLAN} onDecision={() => {}} />);
    await waitFor(() => frame(b.lastFrame).includes("Build it"));
    b.stdin.write("n"); await waitFor(() => frame(b.lastFrame).includes("What should Claude do differently?"));
  });

  it("PlanDialog: y/n typed into the feedback line are TEXT (the scope is gated off while typing)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = render(<PlanDialog req={PLAN} onDecision={(o) => decisions.push(o)} />);
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("3"); await waitFor(() => frame(lastFrame).includes("What should Claude do differently?"));
    stdin.write("y"); await waitFor(() => frame(lastFrame).includes("differently? y"));
    stdin.write("n"); await waitFor(() => frame(lastFrame).includes("differently? yn"));
    expect(decisions).toEqual([]);
    stdin.write("\r"); await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_reject", feedback: "yn" });
  });

  it("AddDirDialog: the entry phase types a path containing y/n verbatim (its Confirmation scope is off there)", async () => {
    const validated: string[] = [];
    let confirmed = 0, cancelled = 0;
    const { stdin, lastFrame } = render(
      <AddDirDialog onValidate={async (raw) => { validated.push(raw); return { kind: "missing", abs: raw } as AddDirVerdict; }}
        onConfirm={() => { confirmed++; }} onCancel={() => { cancelled++; }} />,
    );
    await waitFor(() => frame(lastFrame).includes("Enter the path to the directory:"));
    for (const ch of "/tmp/yes-no") { stdin.write(ch); await tick(); }
    await waitFor(() => frame(lastFrame).includes("/tmp/yes-no"));
    expect([confirmed, cancelled]).toEqual([0, 0]);                 // no key was read as a decision
    stdin.write("\r"); await waitFor(() => validated.length === 1);
    expect(validated[0]).toBe("/tmp/yes-no");                       // Enter validated exactly what was typed
  });
});

describe("F2 task 8 — QuestionDialog's free-text row keeps the Confirmation keys literal", () => {
  const single = { questions: [{ question: "Red or blue?", header: "Color", multiSelect: false, options: [{ label: "red" }, { label: "blue" }] }] };

  it("y/n typed into the Other row are TEXT, not confirm:yes/confirm:no", async () => {
    let denies = 0;
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");                                             // open the Other row
    await waitFor(() => frame(lastFrame).includes("❯ Other:"));
    stdin.write("y"); await waitFor(() => frame(lastFrame).includes("❯ Other: y"));
    stdin.write("n"); await waitFor(() => frame(lastFrame).includes("❯ Other: yn"));
    expect([answers.length, denies]).toEqual([0, 0]);              // neither key decided anything
    stdin.write("\r"); await waitFor(() => answers.length === 1);  // enter still SUBMITS the typed text
    expect(answers[0]).toEqual([{}, "yn"]);
    expect(denies).toBe(0);
  });

  it("back in LIST mode the same keys are the table's: n declines, y takes the highlighted option", async () => {
    let denies = 0;
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={() => {}} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("n"); await waitFor(() => denies === 1);

    const answers: [Record<string, string>, string | undefined][] = [];
    const b = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(b.lastFrame).includes("Red or blue?"));
    b.stdin.write("y"); await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{ "Red or blue?": "red" }, undefined]);
  });

  it("escape leaves the Other row without denying (the scope comes back with it)", async () => {
    let denies = 0;
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={() => {}} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3"); await waitFor(() => frame(lastFrame).includes("❯ Other:"));
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("❯ Other: x"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("3. Other…"));
    expect(denies).toBe(0);                                       // esc closed the row, it did not decline
    stdin.write("\x1b"); await waitFor(() => denies === 1);        // …and now it declines
  });
});

// The guard-retirement half of task 8. ChatApp's `gatedRef`/`settledGatedRef` used to be the ONLY thing
// stopping Ctrl-R/Ctrl-O/Ctrl-T/Ctrl-B/Ctrl-C/alt+p from firing underneath a visible dialog; both are deleted,
// and the job now belongs to the null bindings in each surface's own context (plus, for the one surface with
// no keys at all, a swallow). These drive the REAL ChatApp so that the replacement is tested where the
// deletion happened, not just in the table.
const ROOT_GLOBALS = ["\x12", "\x0f", "\x14", "\x02", "\x03", "\x1bp", "\x1bt"];   // ctrl+r/o/t/b/c, alt+p, alt+t
/** Assert after EVERY key, never once at the end: pressed as a batch these keys cancel each other's damage
 *  (a leaked Ctrl-R opens history search, and the Ctrl-C two keys later closes it again), so a single
 *  end-state check passes against a table with its null bindings deleted. Sabotage-verified. */
async function eachRootGlobalIsInert(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined, marker: string) {
  for (const k of ROOT_GLOBALS) {
    stdin.write(k);
    await new Promise((r) => setTimeout(r, 20));
    const f = frame(lastFrame), at = `after ${JSON.stringify(k)}`;
    expect(f, at).toContain(marker);                                  // the surface still owns the screen
    expect(f, at).not.toContain("Search prompts");                    // ctrl+r → history search
    expect(f, at).not.toContain("Transcript");                        // ctrl+o → the pager
    expect(f, at).not.toContain("switch model");                      // alt+p → the model picker
    expect(f, at).not.toContain("Press Ctrl-C again to exit");        // ctrl+c → the exit arm
  }
}

describe("F2 task 8 — the deleted gatedRef, replaced by the table (driven through the real ChatApp)", () => {
  it("a Select overlay (the bg panel) is deaf to every root global, and the composer gets them back on close", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x02");                                            // ctrl+b while idle opens the panel
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    await eachRootGlobalIsInert(stdin, lastFrame, "Background tasks");
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x12"); await waitFor(() => frame(lastFrame).includes("Search prompts"));   // scoped, not global
  });

  it("a Settings overlay (/config) is deaf to them too", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    await eachRootGlobalIsInert(stdin, lastFrame, "Default permission mode");
  });

  it("the ⏪ restoring hold swallows everything for as long as the rewind runs", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    const anchor: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "the first prompt", index: 1 };
    const fake = {
      ...fakeRemote(), rewindAnchors: async () => [anchor],
      rewindDryRun: async () => ({ canRewind: true }) as RewindDryRun,
      rewind: async () => { await held; },
    };
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ getSessionMessages: async () => [] as never[] }} />,
    );
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Rewind to a previous message"));
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("Restore conversation only"));
    stdin.write("2");    await waitFor(() => frame(lastFrame).includes("restoring"));
    await eachRootGlobalIsInert(stdin, lastFrame, "restoring");
    // …and the keys the hold must eat that are nobody's global: escape, enter, and the Task chord.
    for (const k of ["\x1b", "\r", "\x18\x02"]) { stdin.write(k); await new Promise((r) => setTimeout(r, 20)); }
    expect(frame(lastFrame)).toContain("restoring");
    expect(frame(lastFrame)).not.toContain("Background tasks");     // ctrl+x ctrl+b did not survive it either
    release();
    await waitFor(() => !frame(lastFrame).includes("restoring"));
  });
});
