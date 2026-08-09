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
import { POINTER } from "../../src/tui/select/Select.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { HostEvent } from "../../src/host/wire.js";
import type { RewindAnchor, RewindDryRun } from "../../src/session/chatSession.js";
import { tmpdir } from "node:os";

const frame = (f: () => string | undefined) => f() ?? "";
/** Ink word-wraps, and a tmpdir() path is long enough to be split across two lines — match against the frame
 *  with newlines flattened when the needle is a path (chat.test.tsx uses the same trick). */
const flat = (f: () => string | undefined) => frame(f).replace(/\n/g, "");
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
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
/** F6 T11 rebuilt SessionPicker on the `Select` primitive, so the selected row is the one wearing the ❯
 *  gutter, not an `inverse` run — and the gutter sits in its own <Text>, so the check runs on the
 *  SGR-stripped frame. `rows`/`columns` are pinned by every render below because the picker windows its list
 *  off the terminal height now (`resumeVisibleRows`), and a page is that window. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rowSelected = (f: string, n: number) => new RegExp(`❯\\s+row ${String(n).padStart(2, "0")}`).test(plain(f));
/** rows={40} → resumeVisibleRows(40) = 15, which is both the window and the page. */
const PICKER_SIZE = { rows: 40, columns: 100 };
/** Every other picker marks it with a leading "❯ ". */
const cursorOn = (f: string, label: string) => f.includes(`❯ ${label}`);

describe("F2 task 8 — Select family: KB15 paging (SessionPicker is the representative)", () => {
  it("pageup/pagedown move a whole page and clamp; home/end jump to the first/last row", async () => {
    const { stdin, lastFrame } = render(<SessionPicker sessions={SESSIONS} onPick={() => {}} onCancel={() => {}} {...PICKER_SIZE} />);
    await waitFor(() => rowSelected(frame(lastFrame), 0));
    stdin.write(PAGEDOWN); await waitFor(() => rowSelected(frame(lastFrame), 15));
    stdin.write(PAGEDOWN); await waitFor(() => rowSelected(frame(lastFrame), 24));   // clamps at the last row
    stdin.write(PAGEUP);   await waitFor(() => rowSelected(frame(lastFrame), 9));
    stdin.write(HOME);     await waitFor(() => rowSelected(frame(lastFrame), 0));
    stdin.write(PAGEUP);   await waitFor(() => rowSelected(frame(lastFrame), 0));    // clamps at the first row
    stdin.write(END);      await waitFor(() => rowSelected(frame(lastFrame), 24));
  });

  it("Enter after paging picks the row the page landed on, not the one it started from", async () => {
    let picked: { sessionId: string } | undefined;
    const { stdin, lastFrame } = render(<SessionPicker sessions={SESSIONS} onPick={(s) => { picked = s; }} onCancel={() => {}} {...PICKER_SIZE} />);
    await waitFor(() => rowSelected(frame(lastFrame), 0));
    stdin.write(END); await waitFor(() => rowSelected(frame(lastFrame), 24));
    stdin.write("\r"); await waitFor(() => picked !== undefined);
    expect(picked!.sessionId).toBe("S0000024");
  });

  it("paging an EMPTY list is inert (no crash, no selection)", async () => {
    const { stdin, lastFrame } = render(<SessionPicker sessions={[]} onPick={() => {}} onCancel={() => {}} {...PICKER_SIZE} />);
    await waitFor(() => frame(lastFrame).includes("No conversations found in this project."));
    for (const k of [PAGEDOWN, PAGEUP, HOME, END, "\r"]) stdin.write(k);
    await tick();
    expect(frame(lastFrame)).toContain("No conversations found in this project.");
  });
});

describe("F2 task 8 — KB14: j/k and ctrl+n/ctrl+p navigate in EVERY Select-family surface", () => {
  it("SessionPicker", async () => {
    const { stdin, lastFrame } = render(<SessionPicker sessions={SESSIONS} onPick={() => {}} onCancel={() => {}} {...PICKER_SIZE} />);
    await waitFor(() => rowSelected(frame(lastFrame), 0));
    stdin.write("j");    await waitFor(() => rowSelected(frame(lastFrame), 1));
    stdin.write(CTRL_N); await waitFor(() => rowSelected(frame(lastFrame), 2));
    stdin.write("k");    await waitFor(() => rowSelected(frame(lastFrame), 1));
    stdin.write(CTRL_P); await waitFor(() => rowSelected(frame(lastFrame), 0));
  });

  it("ModelPicker", async () => {
    const models = [{ value: "a", displayName: "Alpha" }, { value: "b", displayName: "Beta" }, { value: "c", displayName: "Gamma" }];
    const picked: string[] = [];
    const { stdin, lastFrame } = render(<ModelPicker models={models} onPick={(m) => picked.push(m.value)} onCancel={() => {}} savePrefs={() => {}} {...PICKER_SIZE} />);
    await waitFor(() => frame(lastFrame).includes("Select model"));
    // Same ❯-gutter rule as the session picker above — both pickers are `Select` lists as of F6 T11.
    const onRow = (label: string) => new RegExp(`❯\\s+\\d+\\.\\s+${label}`).test(plain(frame(lastFrame)));
    stdin.write("j");    await waitFor(() => onRow("Beta"));
    stdin.write(CTRL_N); await waitFor(() => onRow("Gamma"));
    stdin.write("k");    await waitFor(() => onRow("Beta"));
    stdin.write(CTRL_P); await waitFor(() => onRow("Alpha"));
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
    // F6 T13 rebuilt this surface into the Background dialog: the row is `❯ <command> (running)` now, not
    // `❯ <glyph> <short id>`. The key facts this test exists for are unchanged and re-pinned as they were.
    const cursorOnRow = (label: string) => stripAnsi(frame(lastFrame)).split("\n").some((l) => l.includes("❯") && l.includes(label));
    await waitFor(() => cursorOnRow("one"));   // three shells, one category → bare rows, no `Shells (n)` header
    stdin.write("j");    await waitFor(() => cursorOnRow("two"));
    stdin.write(CTRL_N); await waitFor(() => cursorOnRow("three"));
    stdin.write("k");    await waitFor(() => cursorOnRow("two"));
    stdin.write(CTRL_P); await waitFor(() => cursorOnRow("one"));
    expect(stopped).toEqual([]);                                  // `k` never stopped anything on the way
    stdin.write("x"); await waitFor(() => stopped.length === 1);   // stop is `x` alone now
    expect(stopped).toEqual(["aaa11111"]);
  });

  it("BgTasksPanel advertises the reassigned key: `x stop`, never `k/x stop`", async () => {
    const { lastFrame } = render(<BgTasksPanel tasks={[]} onStop={() => {}} onClose={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("No tasks currently running"));
    expect(frame(lastFrame)).toContain("x stop · escape close");
    expect(frame(lastFrame)).not.toContain("k/x stop");
  });
});

describe("F2 task 8 — Confirmation family: what the table adds, and what free text must keep", () => {
  const PLAN = { input: { plan: "# Build it\n\n- step one" } };
  const plan = (onDecision: (o: unknown) => void = () => {}) =>
    render(<PlanDialog req={PLAN} onDecision={onDecision} editorName="vim" editor={(t) => t} rows={40} />);

  // ── THE F2-TASK-8 PIN, DELIBERATELY REVERSED (F6 T9, plan rev2) ──────────────────────────────────────
  // What stood here: "Enter at the choosing state approves NOTHING (only `y` does)". That pin guarded a real
  // hazard — a user mid-sentence when the plan arrives presses Enter to send, and under a live Enter that
  // would have approved the plan and dropped them out of plan mode — and it was defensible while this dialog
  // had no row cursor at all (↑/↓ scrolled the plan text, so Enter had no visible target to take).
  //
  // Three things retired it, and fidelity then governs. The dialog is a `Select` list now (`Gnl` L501122
  // mounts `jr` over `sYf`'s options), so Enter HAS a visible target — the ❯ row — and upstream's Enter
  // accepts it. T5 made the dialog modal and composer-replacing, so there is no composer underneath to send
  // to. Typing-suppression holds a decision back while a draft is live, and the draft is preserved across the
  // dialog, so the mid-sentence Enter never reaches this component in the first place. Reversing the pin
  // rather than deleting it keeps the argument on the record where the next reader will find it.
  it("PlanDialog: Enter ACCEPTS THE FOCUSED ROW (was: approves nothing — reversed, see the note above)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = plan((o) => decisions.push(o));
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("\r"); await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ kind: "plan_approve", mode: "acceptEdits" });   // row 1 is focused on mount
  });

  // The other half of the reversal: `y` and `n` were `Confirmation` shortcuts this dialog re-homed in F0, and
  // upstream has no such shortcut on a plan — the list owns every key. They are inert on a pick row now.
  it("PlanDialog: y and n decide nothing on a pick row (the F0 re-homed shortcuts are gone)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = plan((o) => decisions.push(o));
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("y"); await tick();
    stdin.write("n"); await new Promise((r) => setTimeout(r, 30));
    expect(decisions).toEqual([]);
  });

  it("PlanDialog: y/n typed into the keep-planning row are TEXT (the Select owns the keyboard there)", async () => {
    const decisions: unknown[] = [];
    const { stdin, lastFrame } = plan((o) => decisions.push(o));
    await waitFor(() => frame(lastFrame).includes("Build it"));
    stdin.write("3"); await tick();                                    // a digit on an empty input row only moves the cursor
    stdin.write("y"); await tick();
    stdin.write("n"); await waitFor(() => frame(lastFrame).includes("yn"));
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

// PINS MOVED, NOT WEAKENED (F6 T2b). QuestionDialog no longer owns a single key: both question kinds are the
// F6 list primitives now, so the "Other" row is a permanent `type:"input"` row of a `Select` instead of a MODE
// this component enters, and the literal-text guarantee comes from `Select`'s own `RLe` semantics rather than
// from gating a `Confirmation` scope off. What each pin claims changed with the shape; what they PROTECT did
// not — a key the user typed into an answer must never be read as a decision:
//   · `y`/`n` are still literal in the Other row, and are now literal for a stronger reason (nothing binds
//     them here at all, in either mode) — so the third pin below is new: they are inert in LIST mode too.
//   · Enter still submits the typed text; Escape still declines.
//   · An EMPTY Enter used to close the row; upstream's `RLe` cancels the whole list on it (L397115-397118),
//     which for this dialog is a decline. Pinned in questionDialog.test.tsx, not weakened away.
describe("F6 task 2b — QuestionDialog's Other row keeps every decision key literal (Select's RLe semantics)", () => {
  const single = { questions: [{ question: "Red or blue?", header: "Color", multiSelect: false, options: [{ label: "red" }, { label: "blue" }] }] };
  /** `Select` paints the gutter and the index as separate Text nodes, so the raw frame has escapes between. */
  const bare = (f: () => string | undefined) => (f() ?? "").replace(/\x1b\[[0-9;]*m/g, "");

  it("y/n typed into the Other row are TEXT, and enter still submits what was typed", async () => {
    let denies = 0;
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");                                             // the digit focuses the (empty) Other row
    await waitFor(() => bare(lastFrame).includes("❯ 3."));
    stdin.write("y"); await waitFor(() => bare(lastFrame).includes("❯ 3. y"));
    stdin.write("n"); await waitFor(() => bare(lastFrame).includes("❯ 3. yn"));
    expect([answers.length, denies]).toEqual([0, 0]);              // neither key decided anything
    stdin.write("\r"); await waitFor(() => answers.length === 1);  // enter still SUBMITS the typed text
    expect(answers[0]).toEqual([{}, "yn"]);
    expect(denies).toBe(0);
  });

  it("digits typed into the Other row are TEXT too — they do not jump to another row", async () => {
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3"); await waitFor(() => bare(lastFrame).includes("❯ 3."));
    stdin.write("1"); await waitFor(() => bare(lastFrame).includes("❯ 3. 1"));
    expect(answers, "the digit must not have picked row 1").toEqual([]);
    stdin.write("\r"); await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{}, "1"]);
  });

  // NEW, and the honest replacement for the old "back in LIST mode n declines, y takes the highlighted
  // option". That behaviour was `Confirmation`'s, an F0 re-homing; upstream's question dialog is a `Select`
  // list with no such shortcut, and the scope is gone. Recorded as a deliberate loss in the task report.
  it("in LIST mode y/n are INERT now — enter picks the cursor row and escape declines", async () => {
    let denies = 0;
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("y"); await tick();
    stdin.write("n"); await tick();
    expect([answers.length, denies], "neither bare letter decides anything any more").toEqual([0, 0]);
    stdin.write("\r"); await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{ "Red or blue?": "red" }, undefined]);

    const b = render(<QuestionDialog req={{ input: single }} onAnswer={() => {}} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(b.lastFrame).includes("Red or blue?"));
    b.stdin.write("\x1b"); await waitFor(() => denies === 1);
  });

  it("escape from a half-typed Other row declines rather than silently discarding the answer", async () => {
    let denies = 0;
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={() => {}} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3"); await waitFor(() => bare(lastFrame).includes("❯ 3."));
    stdin.write("x"); await waitFor(() => bare(lastFrame).includes("❯ 3. x"));
    // `select:cancel` is the ONE action Select still registers while a text row has the cursor (L397418 /
    // Select.tsx's useSelectKeys call), so escape reaches the dialog instead of being typed.
    stdin.write("\x1b"); await waitFor(() => denies === 1);
  });
});

// The guard-retirement half of task 8. ChatApp's `gatedRef`/`settledGatedRef` used to be the ONLY thing
// stopping Ctrl-R/Ctrl-O/Ctrl-T/Ctrl-B/Ctrl-C/alt+p from firing underneath a visible dialog; both are deleted,
// and the job now belongs to the null bindings in each surface's own context (plus, for the one surface with
// no keys at all, a swallow). These drive the REAL ChatApp so that the replacement is tested where the
// deletion happened, not just in the table.
const ROOT_GLOBALS = ["\x12", "\x0f", "\x14", "\x02", "\x03", "\x1bp", "\x1bt"];   // ctrl+r/o/t/b/c, alt+p, alt+t
/** The panel's pending row. Ink lays the row out by MEASURED width and `◻` measures two columns while
 *  printing as one, so the gutter between glyph and subject is one space or two — every assertion below goes
 *  through this regex rather than a literal (F6 T13). */
const TODO_ROW = /◻\s+a seeded todo/;
const todoRowVisible = (f: () => string | undefined) => TODO_ROW.test(frame(f));
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
  await waitFor(() => todoRowVisible(lastFrame));                                   // the seeded task renders…
  stdin.write("\x14"); await waitFor(() => !todoRowVisible(lastFrame));              // …and ctrl+t closes the panel
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
    expect(f, at).not.toContain("Search prompts");                    // ctrl+r → the /history picker
    expect(f, at).not.toContain("search prompts:");                   // …nor the composer's inline search (F5 t12)
    expect(f, at).not.toContain("Transcript");                        // ctrl+o → the pager
    expect(f, at).not.toContain("Select model");                      // alt+p → the model picker
    expect(f, at).not.toContain("Press Ctrl-C again to exit");        // ctrl+c → the exit arm
    expect(f, at).not.toMatch(TODO_ROW);                              // ctrl+t → the todo panel
    expect(f, at).toBe(before);                                       // …and nothing else moved either
  }
}

// F6 T2 review, Important 1 — the DECISION half of the same gate, driven through the real ChatApp. The four
// surfaces above are OVERLAYS and must be deaf; a dialog answering the MODEL is the opposite and must stay
// reachable, which is what the `Confirmation` block's own comment has always said. Moving QuestionDialog's
// lists onto the F6 primitives quietly broke that for multiSelect (the `Select` context nulls all six), and
// this pin is what stops it coming back — for BOTH question kinds, since they take different code paths.
describe("F6 task 2 — a QuestionDialog decision keeps the root globals (owner === decision falls through)", () => {
  const parkQuestion = (fake: ReturnType<typeof fakeRemote>, multiSelect: boolean) => fake.parkPermission({
    sessionId: "s", toolUseID: "q", toolName: "AskUserQuestion", kind: "question",
    input: { questions: [{ question: "Which one?", options: [{ label: "alpha" }, { label: "bravo" }], multiSelect }] },
    createdAt: Date.now(),
  });

  it.each([false, true])("multiSelect=%s: ctrl+c arms the exit hint over the parked question", async (multiSelect) => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    parkQuestion(fake, multiSelect);
    await waitFor(() => frame(lastFrame).includes("Which one?"));
    stdin.write("\x03");
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-C again to exit"));
    expect(frame(lastFrame), "…and the dialog is still the one on screen").toContain("Which one?");
  });

  it.each([false, true])("multiSelect=%s: ctrl+o still opens the transcript pager over it", async (multiSelect) => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    parkQuestion(fake, multiSelect);
    await waitFor(() => frame(lastFrame).includes("Which one?"));
    stdin.write("\x0f");
    await waitFor(() => frame(lastFrame).includes("Transcript"));
  });
});

describe("F2 task 8 — the deleted gatedRef, replaced by the table (driven through the real ChatApp)", () => {
  it("a Select overlay (the bg panel) is deaf to every root global, and the composer gets them back on close", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    await armTodoRow(fake, stdin, lastFrame);
    stdin.write("\x02");                                            // ctrl+b while idle opens the panel
    await waitFor(() => frame(lastFrame).includes("No tasks currently running"));
    await eachRootGlobalIsInert(stdin, lastFrame, "No tasks currently running");
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    // F5 t12: ctrl+r opens the composer's inline search now, so "the composer got its keys back" is the
    // inline row appearing — the picker's title would be the wrong thing to wait for.
    stdin.write("\x12"); await waitFor(() => frame(lastFrame).includes("search prompts:"));   // scoped, not global
  });

  it("a Settings overlay (/config) is deaf to them too", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    expect(frame(lastFrame)).toContain("❯\u00a0");                                               // …back to the composer
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("go");   await waitFor(() => frame(lastFrame).includes("go"));
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
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
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ getSessionMessages: async () => [] as never[], rewindReplayRetry: { attempts: 1, delayMs: 0 } }} />,
    );
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    await armTodoRow(fake, stdin, lastFrame);
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("Restore the code and/or conversation"));
    stdin.write("k");    await waitFor(() => frame(lastFrame).includes("❯"));
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("Confirm you want to restore"));
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("restoring"));
    await eachRootGlobalIsInert(stdin, lastFrame, "restoring");
    // …and the keys the hold must eat that are nobody's global: escape, enter, and the Task chord.
    for (const k of ["\x1b", "\r", "\x18\x02"]) { stdin.write(k); await new Promise((r) => setTimeout(r, 20)); }
    expect(frame(lastFrame)).toContain("restoring");
    expect(frame(lastFrame)).not.toContain("No tasks currently running");   // ctrl+x ctrl+b did not survive it either
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
    onOpenModelPicker: () => {}, savePrefs: () => {}, showTurnDuration: true, setShowTurnDuration: () => {},
  });
  const permProps = () => ({
    tab: "Allow", onTabChange: () => {}, denials: [], cwd: "/tmp",
    fetchSettings: async () => ({ sources: [{ source: "userSettings", settings: { permissions: { allow: ["Bash(ls)", "WebFetch"] } } }] }),
    fetchDirs: async () => [],
    addRule: async () => {}, removeRule: async () => {}, removeDir: async () => {},
    addDirValidate: async () => ({ kind: "missing", abs: "" }) as AddDirVerdict,
    confirmAddDir: async () => {}, cancelAddDir: () => {}, onDone: () => {},
  });

  // WAVE S t5/t6b — EVERY case below strips ANSI before matching `❯ <row>`. Both dialogs' lists are a `Select`
  // now (Settings' Config list as of t5, Permissions' rule and workspace lists as of t6b), so the pointer is
  // the list's own gutter span and the raw frame reads `❯\x1b[39m Theme`. The claim each case makes — a rebind
  // resolving to a semantic op, and that op moving the cursor — is unchanged; only the match is.
  //   THE FAILURE MODE IS WHY THIS NOTE EXISTS: these are `waitFor` PREDICATES, not `expect`s, so a raw match
  // against a Select-drawn pointer surfaces as a bare "waitFor timeout" with no string diff — it reads like a
  // hang, not a mismatch. t6b turned three of these cases red exactly that way.
  it("SettingsDialog: `x` bound to select:next moves the row cursor (and `z` to select:previous moves it back)", async () => {
    const { stdin, lastFrame } = render(<SettingsDialog {...settingsProps()} />, { userLayers: settingsLayer({ x: "select:next", z: "select:previous" }) });
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Theme"));
    stdin.write("x"); await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Model"));
    stdin.write("x"); await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Output style"));
    stdin.write("z"); await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Model"));
  });

  /** The frame's lines with the box rules and padding taken off, so a whole line can be matched EXACTLY. The
   *  query echo is its own line and its content is the query — an `includes` for the query text would also hit
   *  the row bodies ("For custom themes…" contains a `th`), which is how a query assertion goes quiet. */
  const rowsOf = (f: () => string | undefined) => stripAnsi(frame(f)).split("\n").map((l) => l.replace(/[│╭╮╰╯]/g, "").trim());

  // WAVE S t5 REVIEW — THE QUERY IS `th` NOW, NOT `x`, AND THAT IS THE CASE'S WHOLE LOAD. `x` matches no
  // Config row, so this dialog rendered its EMPTY-QUERY branch — `No settings match "x"`, zero rows, zero
  // pointers — and the negative assertion could not fail: there was no `Model` row in the frame to carry a
  // cursor either way, so it could not tell a cursor that moved from one that did not. (It was vacuous before
  // t5 as well, by a different route: the old row body gated its pointer on `search === null`. Not a t5
  // regression, and fixed here because t5 is what put a real `Select` behind the question.) `th` filters to
  // Theme + Thinking mode, so rows ARE painted and a pointer drawn under an open query WOULD be visible —
  // checked by mounting the `Select` over the query's arm, which turns this case red and leaves the rest of
  // the file green. The rebound keys move with the query: `t`/`h` are the characters being typed, so they are
  // the two the layer binds to semantic ops here.
  it("SettingsDialog: the rebound key is still LITERAL TEXT inside the `/` search query (the mode branch stays physical)", async () => {
    const { stdin, lastFrame } = render(<SettingsDialog {...settingsProps()} />, { userLayers: settingsLayer({ t: "select:next", h: "select:previous" }) });
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Theme"));
    stdin.write("/"); await waitFor(() => frame(lastFrame).includes("Search settings…"));
    for (const ch of "th") { stdin.write(ch); await tick(); }
    await waitFor(() => rowsOf(lastFrame).some((l) => l.startsWith("Thinking mode")));
    expect(rowsOf(lastFrame), "the query accumulated both rebound characters").toContain("th");
    // ANY pointer in this frame would be a live row cursor, and the reason there is none is not that "two rows
    // are on screen and nothing windows them" — that explanation has been stale since Task 5 windowed this
    // list, and the t6b review round caught it. The real reason is structural: the `Select` is NOT MOUNTED
    // while the query is open (SettingsDialog.tsx:279-281 renders the filtered rows as plain `<Text>` instead,
    // deliberately, so `j`/`k`/enter/space stay text). The two rows painted here are that plain branch's.
    expect(stripAnsi(frame(lastFrame)), "…and no row cursor moved under it").not.toContain(POINTER);
  });

  it("PermissionsDialog: `x` bound to select:next moves the row cursor", async () => {
    const { stdin, lastFrame } = render(<PermissionsDialog {...permProps()} />, { userLayers: settingsLayer({ x: "select:next" }) });
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Add a new rule…"));
    stdin.write("x"); await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Bash(ls)"));
    stdin.write("x"); await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ WebFetch"));
  });

  it("PermissionsDialog: the rebound key is still LITERAL TEXT in the add-rule prompt (the sub-view stays physical)", async () => {
    const { stdin, lastFrame } = render(<PermissionsDialog {...permProps()} />, { userLayers: settingsLayer({ x: "select:next" }) });
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Add a new rule…"));
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

// F6 Task 2: both tabbed dialogs render their strip through the shared `Tabs` primitive, which also OWNS
// `tabs:next`/`tabs:previous` now. Two claims per dialog: the chip really is the inverse-video one `awr`
// paints (L435104 — the SGR frame is the only place that shows), and the gating the parent's `route()` used
// to provide still holds now that the registration moved into the child.
describe("F6 task 2 — Settings/Permissions adopt <Tabs> with no behavioural change", () => {
  const chip = (title: string) => `\x1b[7m\x1b[1m ${title} \x1b[22m\x1b[27m`;
  function SettingsHost({ initial = "Config" }: { initial?: string }) {
    const [tab, setTab] = React.useState(initial);
    return <SettingsDialog tab={tab} onTabChange={setTab} mode="default" thinkLevel="default" outputStyle="default"
      onDone={() => {}} applyMode={async () => {}} setThink={async () => {}} applyOutputStyle={async () => {}}
      fetchStatus={async () => [{ text: "status-row" }]} fetchUsage={async () => []} fetchStats={async () => []}
      onOpenModelPicker={() => {}} savePrefs={() => {}} showTurnDuration setShowTurnDuration={() => {}} />;
  }
  function PermissionsHost() {
    const [tab, setTab] = React.useState("Allow");
    return <PermissionsDialog tab={tab} onTabChange={setTab} denials={[]} cwd="/tmp"
      fetchSettings={async () => ({ sources: [{ source: "userSettings", settings: { permissions: { allow: ["Bash(ls)"] } } }] })}
      fetchDirs={async () => []} addRule={async () => {}} removeRule={async () => {}} removeDir={async () => {}}
      addDirValidate={async () => ({ kind: "missing", abs: "" }) as AddDirVerdict}
      confirmAddDir={async () => {}} cancelAddDir={() => {}} onDone={() => {}} />;
  }

  it("SettingsDialog: the active tab is an inverse+bold chip, and tab/← still cycle the strip", async () => {
    const { stdin, lastFrame } = render(<SettingsHost />);
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Theme"));
    expect(frame(lastFrame)).toContain(chip("Config"));
    expect(frame(lastFrame)).toContain(" Status ");
    stdin.write("\t"); await waitFor(() => frame(lastFrame).includes(chip("Usage")));
    stdin.write("\x1b[D"); await waitFor(() => frame(lastFrame).includes(chip("Config")));
    stdin.write("\x1b[Z"); await waitFor(() => frame(lastFrame).includes(chip("Status")));
  });

  it("SettingsDialog: the `/` query still swallows tab/←/→ — the strip is handed disableNavigation", async () => {
    const { stdin, lastFrame } = render(<SettingsHost />);
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Theme"));
    stdin.write("/"); await waitFor(() => frame(lastFrame).includes("Search settings…"));
    // ASSERT AFTER EVERY KEY, never once at the end: tab/→/←/shift+tab pressed as a batch walk the strip in a
    // circle and land back on Config, so a single end-state check passes against a strip with no gating at all
    // (sabotage-verified — dropping `disableNavigation` leaves this loop green if it only looks once).
    for (const k of ["\t", "\x1b[C", "\x1b[D", "\x1b[Z"]) {
      stdin.write(k); await tick();
      expect(frame(lastFrame), `${JSON.stringify(k)} must not move the strip`).toContain(chip("Config"));
      expect(frame(lastFrame)).toContain("Type to filter");
    }
  });

  it("PermissionsDialog: inverse chip, cycling, and a sub-view that still keeps the strip off the keyboard", async () => {
    const { stdin, lastFrame } = render(<PermissionsHost />);
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Add a new rule…"));
    expect(frame(lastFrame)).toContain(chip("Allow"));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes(chip("Ask")));
    stdin.write("\x1b[D"); await waitFor(() => frame(lastFrame).includes(chip("Allow")));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Enter permission rule…"));
    for (const k of ["\t", "\x1b[C", "\x1b[Z"]) {
      stdin.write(k); await tick();
      expect(frame(lastFrame), "the add-rule prompt still owns the keyboard").toContain("Enter permission rule…");
    }
    stdin.write("\x1b"); await waitFor(() => stripAnsi(frame(lastFrame)).includes("❯ Add a new rule…"));
    expect(frame(lastFrame), "and the tab never moved behind it").toContain(chip("Allow"));
  });
});
