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
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { SettingsDialog } from "../../src/tui/SettingsDialog.js";
import { PermissionsDialog } from "../../src/tui/PermissionsDialog.js";
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
import type { HostEvent } from "../../src/host/wire.js";
import type { RewindAnchor, RewindDryRun } from "../../src/session/chatSession.js";
import { tmpdir } from "node:os";

const frame = (f: () => string | undefined) => f() ?? "";
/** Ink word-wraps, and a tmpdir() path is long enough to be split across two lines — match against the frame
 *  with newlines flattened when the needle is a path (chat.test.tsx uses the same trick). */
const flat = (f: () => string | undefined) => frame(f).replace(/\n/g, "");
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

  // t8 review, Important 2. Enter STAYS DEAD at the choosing state, unlike everywhere else in the Confirmation
  // family: a dialog replaces the composer, so a user mid-sentence when the plan arrives presses Enter to send
  // and would otherwise approve the plan and leave plan mode. There is no row cursor here (↑/↓ scroll the plan
  // text), so Enter has no visible target to "take" the way PermissionDialog's highlighted row does — and the
  // footer advertises `y approve`, not Enter. Gating it keeps the screen and the behavior saying the same thing.
  it("PlanDialog: Enter at the choosing state approves NOTHING (only `y` does)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = render(<PlanDialog req={PLAN} onDecision={(o) => decisions.push(o)} />);
    await waitFor(() => frame(lastFrame).includes("Build it"));
    expect(frame(lastFrame)).not.toContain("enter approve");            // the footer never promised it
    stdin.write("\r"); await new Promise((r) => setTimeout(r, 30));
    expect(decisions, "Enter must not decide anything").toEqual([]);
    // …and it did not leak sideways either: still choosing, not typing feedback.
    expect(frame(lastFrame)).not.toContain("What should Claude do differently?");
    expect(frame(lastFrame)).toContain("1. Yes, and auto-accept edits");
    stdin.write("y"); await waitFor(() => decisions.length === 1);      // the advertised key still works
    expect(decisions[0]).toEqual({ kind: "plan_approve", acceptEdits: false });
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

  it("AddDirDialog: the entry phase types a path containing y/n verbatim (the Select actions re-project to text there)", async () => {
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
const TODO_ROW = "☐ a seeded todo";
/** ChatApp's TaskPanel renders NULL on an empty list, so with no task seeded a resurrected Ctrl-T toggles a
 *  panel nobody can see and the loop below stays blind to it (t8 review, Minor A). Two host frames, exactly the
 *  shape the engine sends: TaskCreate names the subject, its tool_result carries the id (taskList.ts). */
/** `/add-dir` refuses a session with no SettingsOps (useChat's hasSettingsOps gate) and fakeRemote has none —
 *  the same seven no-op methods chat.test.tsx's own fakeSettingsRemote supplies, kept local to this file. */
const settingsRemote = () => Object.assign(fakeRemote(), {
  getSettings: async () => ({}),
  listDirs: async () => [{ path: process.cwd(), source: "cwd" as const }],
  addDir: async () => {}, removeDir: async () => {}, setOutputStyle: async () => {},
  addRule: async () => {}, removeRule: async () => {},
});
function seedTodo(fake: { pushEvent: (ev: HostEvent) => void }) {
  const msg = (data: unknown) => fake.pushEvent({ kind: "message", data } as HostEvent);
  msg({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu-seed", name: "TaskCreate", input: { subject: "a seeded todo" } }] } });
  msg({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu-seed", content: "Task #1 created successfully: a seeded todo" }] } });
}
/** Seed the todo, watch the row appear (ChatApp opens the panel by default), then close the panel with a Ctrl-T
 *  the composer is still allowed to have. Two jobs: it settles the seed before the loop snapshots the frame, and
 *  it leaves the row HIDDEN with a live task behind it — so the loop's `not.toContain(TODO_ROW)` is a claim with
 *  teeth (Ctrl-T demonstrably renders that row the moment anything lets it through). */
async function armTodoRow(fake: { pushEvent: (ev: HostEvent) => void }, stdin: { write: (s: string) => void }, lastFrame: () => string | undefined) {
  seedTodo(fake);
  await waitFor(() => frame(lastFrame).includes(TODO_ROW));                        // the seeded task renders…
  stdin.write("\x14"); await waitFor(() => !frame(lastFrame).includes(TODO_ROW));   // …and ctrl+t closes the panel
}
/** Assert after EVERY key, never once at the end: pressed as a batch these keys cancel each other's damage
 *  (a leaked Ctrl-R opens history search, and the Ctrl-C two keys later closes it again), so a single
 *  end-state check passes against a table with its null bindings deleted. Sabotage-verified.
 *
 *  The four named negatives are not enough on their own (t8 review, Minor A): a resurrected Ctrl-T only opens
 *  the todo panel and a resurrected Ctrl-B may re-open a panel that is already open — neither moves any of
 *  them. So the loop ALSO pins the whole frame against the pre-loop snapshot: an inert key changes nothing at
 *  all, which is a claim every single-key regression has to break. Callers seed a todo first (see `seedTodo`)
 *  so that "nothing changed" has something to say about Ctrl-T. */
async function eachRootGlobalIsInert(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined, marker: string) {
  const before = frame(lastFrame);
  expect(before, "the marker must be on screen before the loop starts").toContain(marker);
  for (const k of ROOT_GLOBALS) {
    stdin.write(k);
    await new Promise((r) => setTimeout(r, 20));
    const f = frame(lastFrame), at = `after ${JSON.stringify(k)}`;
    expect(f, at).toContain(marker);                                  // the surface still owns the screen
    expect(f, at).not.toContain("Search prompts");                    // ctrl+r → history search
    expect(f, at).not.toContain("Transcript");                        // ctrl+o → the pager
    expect(f, at).not.toContain("switch model");                      // alt+p → the model picker
    expect(f, at).not.toContain("Press Ctrl-C again to exit");        // ctrl+c → the exit arm
    expect(f, at).not.toContain(TODO_ROW);                            // ctrl+t → the todo panel
    expect(f, at).toBe(before);                                       // …and nothing else moved either
  }
}

describe("F2 task 8 — the deleted gatedRef, replaced by the table (driven through the real ChatApp)", () => {
  it("a Select overlay (the bg panel) is deaf to every root global, and the composer gets them back on close", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    await armTodoRow(fake, stdin, lastFrame);
    stdin.write("\x02");                                            // ctrl+b while idle opens the panel
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    await eachRootGlobalIsInert(stdin, lastFrame, "Background tasks");
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x12"); await waitFor(() => frame(lastFrame).includes("Search prompts"));   // scoped, not global
  });

  it("a Settings overlay (/config) is deaf to them too", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    await armTodoRow(fake, stdin, lastFrame);
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    await eachRootGlobalIsInert(stdin, lastFrame, "Default permission mode");
  });

  // t8 review, Important 1. The standalone /add-dir overlay: `gatedRef` classified it as an "overlay" owner
  // (ChatApp's inputOwnerRef still does), so all six root globals were inert over BOTH of its phases. The
  // migration first pushed a scope only in the CONFIRM phase, leaving the entry phase — a half-typed path —
  // with no context at all: a Ctrl-R or Ctrl-B there renders history search / the bg panel ABOVE the addDir arm
  // in ChatApp's chain, which unmounts the dialog and discards what the user was typing. The scope is pushed in
  // both phases now, and its actions are routed through one phase-branching handler, so this drives BOTH.
  it("the /add-dir overlay is deaf to them in BOTH phases, and still types and navigates afterwards", async () => {
    const fake = settingsRemote();
    const target = tmpdir();                                        // a real directory outside cwd, so validation says ok
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    await armTodoRow(fake, stdin, lastFrame);
    stdin.write("/add-dir"); await waitFor(() => frame(lastFrame).includes("/add-dir"));
    stdin.write("\r");                                              // separate write: "text\r" in ONE chunk reads as a paste
    await waitFor(() => frame(lastFrame).includes("Enter the path to the directory:"));
    await eachRootGlobalIsInert(stdin, lastFrame, "Enter the path to the directory:");
    stdin.write(target); await waitFor(() => flat(lastFrame).includes(target));    // the path still types after all that
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("Yes, for this session"));
    await eachRootGlobalIsInert(stdin, lastFrame, "Yes, for this session");
    stdin.write("\x1b[B"); await waitFor(() => frame(lastFrame).includes("❯ Yes, and remember this directory"));
    stdin.write("k");      await waitFor(() => frame(lastFrame).includes("❯ Yes, for this session"));   // KB14, inherited from Select
    stdin.write("\x1b");   await waitFor(() => flat(lastFrame).includes("Did not add"));   // esc still cancels the menu
    expect(frame(lastFrame)).toContain("›");                                               // …back to the composer
  });

  // The other half of Important 1: with the scope pushed in both phases, the dialog's own keys must still be
  // exactly the two phases' keys — Select's `j`/`k` navigate the three-row menu, and the very same characters
  // are LITERAL text in the path prompt (they reach the fallback through the routed handler, not the table).
  it("the /add-dir entry phase types j/k/space as path text, while the confirm phase navigates with them", async () => {
    const validated: string[] = [];
    const { stdin, lastFrame } = render(
      <AddDirDialog onValidate={async (raw) => { validated.push(raw); return { kind: "missing", abs: raw } as AddDirVerdict; }}
        onConfirm={() => {}} onCancel={() => {}} />,
    );
    await waitFor(() => frame(lastFrame).includes("Enter the path to the directory:"));
    for (const ch of "/j k") { stdin.write(ch); await tick(); }
    await waitFor(() => frame(lastFrame).includes("/j k"));
    stdin.write("\r"); await waitFor(() => validated.length === 1);
    expect(validated[0]).toBe("/j k");                              // every one of them was text, not a table action

    // The confirm phase (reached here by prefill, the `/add-dir <path>` route) reads the same two keys as the list.
    let confirmed: [string, boolean] | undefined;
    const b = render(<AddDirDialog prefill="/tmp/x" onValidate={async () => ({ kind: "missing", abs: "" }) as AddDirVerdict}
      onConfirm={(abs, remember) => { confirmed = [abs, remember]; }} onCancel={() => {}} />);
    await waitFor(() => frame(b.lastFrame).includes("❯ Yes, for this session"));
    b.stdin.write("j"); await waitFor(() => frame(b.lastFrame).includes("❯ Yes, and remember this directory"));
    b.stdin.write("j"); await waitFor(() => frame(b.lastFrame).includes("❯ No"));
    b.stdin.write("k"); await waitFor(() => frame(b.lastFrame).includes("❯ Yes, and remember this directory"));
    b.stdin.write("\r"); await waitFor(() => confirmed !== undefined);
    expect(confirmed).toEqual(["/tmp/x", true]);
  });

  // Final review (deferred t8 minor). The pager REBOUND ctrl+b to scroll:fullPageUp, so its chord alias was the
  // one key still reaching `Task` from inside the overlay: `ctrl+x ctrl+b` backgrounded the running turn from a
  // surface that owns every other key on screen. `Transcript` nulls the alias now, as MessageSelector and
  // HistorySearch do — the table half is pinned in keys-bindings.test.ts, this is the behavior half.
  it("the transcript pager does not background the running turn through ctrl+b's chord alias", async () => {
    const background = vi.fn(async () => ({ ok: true }));
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); },
      background,
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("go");   await waitFor(() => frame(lastFrame).includes("go"));
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("⟳"));
    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("Transcript"));   // ctrl+o opens the pager
    stdin.write("\x18"); stdin.write("\x02");                                            // ctrl+x ctrl+b inside it
    await new Promise((r) => setTimeout(r, 30));
    expect(background, "the pager must not background the turn").not.toHaveBeenCalled();
    stdin.write("\x1b"); await waitFor(() => !frame(lastFrame).includes("Transcript"));   // esc leaves the pager…
    stdin.write("\x18"); stdin.write("\x02");                                            // …and the chord works again
    await waitFor(() => background.mock.calls.length === 1);
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
    await armTodoRow(fake, stdin, lastFrame);
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

// F2 final whole-branch review, P2: a rebind that RESOLVES must also DO something. The three dialogs that route
// every one of their actions into a single `onKey` re-checked the PHYSICAL key inside that body, so a user's
// `"x": "select:next"` resolved to the action, reached the handler, and moved nothing — the exact split (a key
// the table honours and the component ignores) the whole wave exists to remove. Each dialog's NAVIGABLE surface
// dispatches on the action now; its text-entry and modal-prompt phases stay physical, which is what keeps the
// default keys byte-identical (each component's header records the line).
describe("F2 final review — a custom rebind drives the dialogs' semantic ops, not just their default keys", () => {
  const settingsLayer = (bindings: Record<string, string | null>) => [{ context: "Settings" as const, bindings }];
  const settingsProps = () => ({
    tab: "Config", onTabChange: () => {}, mode: "default", thinkLevel: "default", outputStyle: "default",
    onDone: () => {}, applyMode: async () => {}, setThink: async () => {}, applyOutputStyle: async () => {},
    fetchStatus: async () => [], fetchUsage: async () => [], fetchStats: async () => [],
    onOpenModelPicker: () => {}, savePrefs: () => {},
  });
  const permProps = () => ({
    tab: "Allow", onTabChange: () => {}, denials: [], cwd: "/tmp",
    fetchSettings: async () => ({ sources: [{ source: "userSettings", settings: { permissions: { allow: ["Bash(ls)", "WebFetch"] } } }] }),
    fetchDirs: async () => [],
    addRule: async () => {}, removeRule: async () => {}, removeDir: async () => {},
    addDirValidate: async () => ({ kind: "missing", abs: "" }) as AddDirVerdict,
    confirmAddDir: async () => {}, cancelAddDir: () => {}, onDone: () => {},
  });

  it("SettingsDialog: `x` bound to select:next moves the row cursor (and `z` to select:previous moves it back)", async () => {
    const { stdin, lastFrame } = render(<SettingsDialog {...settingsProps()} />, { userLayers: settingsLayer({ x: "select:next", z: "select:previous" }) });
    await waitFor(() => frame(lastFrame).includes("❯ Theme"));
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("❯ Model"));
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("❯ Output style"));
    stdin.write("z"); await waitFor(() => frame(lastFrame).includes("❯ Model"));
  });

  it("SettingsDialog: the rebound key is still LITERAL TEXT inside the `/` search query (the mode branch stays physical)", async () => {
    const { stdin, lastFrame } = render(<SettingsDialog {...settingsProps()} />, { userLayers: settingsLayer({ x: "select:next", z: "select:previous" }) });
    await waitFor(() => frame(lastFrame).includes("❯ Theme"));
    stdin.write("/"); await waitFor(() => frame(lastFrame).includes("Search settings…"));
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("Type to filter"));
    expect(frame(lastFrame), "the query accumulated the character").toContain("x");
    expect(frame(lastFrame), "…and no row cursor moved under it").not.toContain("❯ Model");
  });

  it("PermissionsDialog: `x` bound to select:next moves the row cursor", async () => {
    const { stdin, lastFrame } = render(<PermissionsDialog {...permProps()} />, { userLayers: settingsLayer({ x: "select:next" }) });
    await waitFor(() => frame(lastFrame).includes("❯ Add a new rule…"));
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("❯ Bash(ls)"));
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("❯ WebFetch"));
  });

  it("PermissionsDialog: the rebound key is still LITERAL TEXT in the add-rule prompt (the sub-view stays physical)", async () => {
    const { stdin, lastFrame } = render(<PermissionsDialog {...permProps()} />, { userLayers: settingsLayer({ x: "select:next" }) });
    await waitFor(() => frame(lastFrame).includes("❯ Add a new rule…"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Enter permission rule…"));
    for (const ch of "xx") { stdin.write(ch); await tick(); }
    await waitFor(() => frame(lastFrame).includes("Add allow permission rule"));
    expect(frame(lastFrame)).toContain("xx");
  });

  it("AddDirDialog: `x` bound to select:next moves the confirm menu, and is still path text in the entry phase", async () => {
    const layer = [{ context: "Select" as const, bindings: { x: "select:next" } }];
    const b = render(<AddDirDialog prefill="/tmp/x" onValidate={async () => ({ kind: "missing", abs: "" }) as AddDirVerdict}
      onConfirm={() => {}} onCancel={() => {}} />, { userLayers: layer });
    await waitFor(() => frame(b.lastFrame).includes("❯ Yes, for this session"));
    b.stdin.write("x"); await waitFor(() => frame(b.lastFrame).includes("❯ Yes, and remember this directory"));
    b.stdin.write("x"); await waitFor(() => frame(b.lastFrame).includes("❯ No"));
    b.unmount();

    const validated: string[] = [];
    const a = render(<AddDirDialog onValidate={async (raw) => { validated.push(raw); return { kind: "missing", abs: raw } as AddDirVerdict; }}
      onConfirm={() => {}} onCancel={() => {}} />, { userLayers: layer });
    await waitFor(() => frame(a.lastFrame).includes("Enter the path to the directory:"));
    for (const ch of "/x") { a.stdin.write(ch); await tick(); }
    await waitFor(() => frame(a.lastFrame).includes("/x"));
    a.stdin.write("\r"); await waitFor(() => validated.length === 1);
    expect(validated[0], "the entry phase types the rebound key instead of navigating").toBe("/x");
  });
});
