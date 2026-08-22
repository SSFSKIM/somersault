// test/tui/f6-acceptance.test.tsx — the F6 wave's six spec acceptance criteria, executed as written
// (spec `docs/superpowers/specs/2026-07-31-tui-clone-fidelity-design.md` § F6 Acceptance, as amended by its
// 2026-08-05 Revision Notes).
//
// These are NOT re-runs of the per-task suites. T1–T14 each pin their own body, reducer or literal in
// isolation; what had no pin anywhere was the COMPOSITE — one Bash consult travelling engine → park → wire →
// switchboard → frame; one "don't ask again" payload travelling dialog → outcome → gate → SDK result; one
// Edit prompt passing through all three of upstream's dialog states in one sitting; one plan rejection
// proved IDENTICAL down two different key paths. Criteria 1, 3 and 4 therefore drive the REAL `<ChatApp>`
// over `fakeRemote`, exactly as `inline-dialog.test.tsx` does, because those criteria are claims about the
// whole app and not about a component.
//
// TWO CRITERIA WERE REWRITTEN MID-WAVE, both against the bundle and both recorded in the spec's Revision
// Notes. They are pinned here in their CORRECTED form, and the superseded wording is named so a reader of
// the old spec text does not think a test is missing:
//
//   · #3 originally read "…the composer is still visible below it". It is not: `KVf` renders the prompt
//     input only while the dialog gate is not `"visible"` (L549494) and `Fui()` (L499192) is `"visible"`
//     exactly when the store holds an open, unsuppressed dialog. `layout:"inline"` vs `"modal"` decides
//     WHERE the dialog draws, never composer coexistence. A mid-draft prompt is protected by the opposite
//     mechanism — SUPPRESSION (`Xrl()` L499196) behind a dim `Waiting for permission…` row (L496241).
//   · #4 originally read "…submitting empty feedback keeps the dialog open". It does not: the census read
//     `lYf`'s `return null` (L500732-736), which sits on the images-only `"no"` arm an empty submit cannot
//     reach. `sYf` (L500713) sets no `allowEmptySubmitToCancel`, so `RLe` routes empty text to the Select's
//     `onCancel` (L397113-118) and `Gnl` wires that to `xnl` → `{behavior:"deny"}` (L500995) — byte for byte
//     what Esc does. The criterion is now an EQUALITY between the two paths, which is a stronger pin than
//     the sentence it replaced.
//
// CRITERION 2 IS SPLIT ON PURPOSE. Its first half (the payload the dialog emits and what the gate does with
// it) is unit-pinned below. Its second half — quit, relaunch, run the same command with no prompt — is a
// claim about a FRESH ENGINE PROCESS reading `.claude/settings.local.json`, which no keyless test can make.
// Probe 81 made it live (2026-08-05): the echoed suggestion with `destination` rewritten to `localSettings`
// wrote `{"permissions":{"allow":["Read(//…/**)"]}}` in upstream's own rule grammar, and a fresh `query()`
// over the same cwd with `settingSources:["local"]` consulted ZERO times. What is pinned here is everything
// this side of that boundary: the dialog's payload, and the gate turning it into the SDK's allow arm intact.
import React from "react";
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { WAITING_FOR_PERMISSION } from "../../src/tui/ChatComposer.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { BashPermission } from "../../src/tui/dialogs/BashPermission.js";
import { PlanDialog } from "../../src/tui/PlanDialog.js";
import { RewindPicker } from "../../src/tui/RewindPicker.js";
import { ModelPicker, type ModelInfo } from "../../src/tui/ModelPicker.js";
import { SessionPicker } from "../../src/tui/SessionPicker.js";
import { BgTasksPanel } from "../../src/tui/BgTasksPanel.js";
import { HelpDialog } from "../../src/tui/HelpDialog.js";
import { SettingsDialog } from "../../src/tui/SettingsDialog.js";
import { PermissionsDialog } from "../../src/tui/PermissionsDialog.js";
import { POINTER } from "../../src/tui/select/Select.js";
import { NBSP } from "../../src/tui/composerFrame.js";
import { createPermissionGate } from "../../src/permissions/gate.js";
import { themeTokens } from "../../src/tui/theme.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { PermissionBroker, PermissionDecision, PermissionUpdateLike } from "../../src/permissions/types.js";
import type { RewindAnchor, RewindDryRun } from "../../src/session/chatSession.js";
import type { SessionInfo } from "../../src/tui/useChat.js";
import type { BgTaskRow } from "../../src/tui/bgTaskMeta.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";
import type { AddDirVerdict } from "../../src/tui/addDir.js";

const frame = (f: () => string | undefined) => f() ?? "";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const flat = (f: () => string | undefined) => plain(frame(f)).replace(/\s*\n\s*/g, " ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await sleep(5); }
}
/** The token is `rgb(r,g,b)` and Ink paints it as a truecolor SGR — read the token, not a hex (the house
 *  helper, shared with bash-permission.test.tsx and dialog-frame.test.tsx). */
const sgr = (name: "warning") => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(themeTokens()[name]);
  return `\x1b[38;2;${m![1]};${m![2]};${m![3]}m`;
};
/** Ink's `dimColor` is SGR 2. The criterion says the description is **dim**, so the text assertion alone
 *  would pass against a plain description — the raw line is what carries the claim. */
const DIM = "\x1b[2m";
/** The raw (escape-bearing) line `text` renders on — one row per line, so this is that row's whole SGR
 *  state (the idiom bg-dialog.test.tsx and task-panel.test.tsx share). */
const rawLine = (f: () => string | undefined, text: string): string =>
  frame(f).split("\n").find((l) => plain(l).includes(text)) ?? "";
/** The composer's own prompt row (`❯` + NBSP, F5 t2); the transcript echo uses a NORMAL space, so this is a
 *  deterministic "the composer is mounted" probe and safe to assert negatively. The NBSP is what makes it
 *  discriminating, so it is built from the exported constants rather than typed as a literal. */
const COMPOSER = POINTER + NBSP;

// Every ChatApp mount here points at a throwaway fleet root, so no criterion touches the real prompt log.
const roots: string[] = [];
const tmpEnv = (): NodeJS.ProcessEnv => {
  const root = mkdtempSync(join(tmpdir(), "ccx-f6acc-"));
  roots.push(root);
  return { ...process.env, CCX_FLEET_ROOT: root };
};
const cleanupRoots = () => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); };

const IDLE_SHORT = 40, IDLE_LONG = 10_000;
const app = (fake: ReturnType<typeof fakeRemote>, typingIdleMs = IDLE_SHORT) =>
  render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env: tmpEnv() }} typingIdleMs={typingIdleMs} />);

const entry = (over: Partial<PendingEntry> & Pick<PendingEntry, "toolName" | "input">): PendingEntry =>
  ({ sessionId: "s", toolUseID: "t", kind: "permission", createdAt: Date.now(), ...over } as PendingEntry);

// ── ACCEPTANCE #1 ───────────────────────────────────────────────────────────────────────────────────────
// "A Bash permission prompt is titled `Bash command`, shows the rendered command and its dim description,
//  asks `Do you want to proceed?`, and for `rm -rf` or `git reset --hard` adds the matching warning line in
//  the warning colour."
//
// Driven through `<ChatApp>` rather than `<BashPermission>` because the criterion is about what a USER sees
// when the engine asks — which means the park has to survive the wire, `permissionKind` has to route it to
// the bash arm, and the switchboard has to mount that arm. Each of those is pinned in isolation elsewhere;
// none of them is pinned together anywhere else.
describe("F6 acceptance #1 — the Bash consult renders as `dZf` end to end, warning included", () => {
  it("titles, commands, describes, asks — and warns in the warning role for `rm -rf`", async () => {
    const fake = fakeRemote();
    const { lastFrame } = app(fake);
    await waitFor(() => frame(lastFrame).includes(COMPOSER));
    fake.parkPermission(entry({ toolName: "Bash", input: { command: "rm -rf build" }, description: "Clear the build output" }));
    await waitFor(() => frame(lastFrame).includes("Bash command"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Bash command");                                   // `Ed` title, L505286
    expect(f).toContain("rm -rf build");                                   // the rendered command, plain
    expect(f).toContain("Clear the build output");                         // …and its description under it
    expect(rawLine(lastFrame, "Clear the build output")).toContain(DIM);   // which the criterion says is DIM
    expect(rawLine(lastFrame, "rm -rf build")).not.toContain(DIM);         // …unlike the command above it
    expect(f).toContain("Do you want to proceed?");                        // `zTe`'s default question, L505939
    expect(f).toContain("Note: may recursively force-remove files");       // the destructive table's row
    expect(frame(lastFrame)).toContain(`${sgr("warning")}Note: may recursively force-remove files`);
    // …and the warning sits BETWEEN the command and the question, which is where `dZf` puts it.
    const lines = f.split("\n");
    const warn = lines.findIndex((l) => l.includes("Note: may"));
    expect(warn).toBeGreaterThan(lines.findIndex((l) => l.includes("rm -rf build")));
    expect(warn).toBeLessThan(lines.findIndex((l) => l.includes("Do you want to proceed?")));
    cleanupRoots();
  });

  it("carries the OTHER named pattern too, and stays silent on a command the table does not match", async () => {
    const fake = fakeRemote();
    const { lastFrame } = app(fake);
    await waitFor(() => frame(lastFrame).includes(COMPOSER));
    fake.parkPermission(entry({ toolUseID: "g1", toolName: "Bash", input: { command: "git reset --hard HEAD~1" } }));
    await waitFor(() => frame(lastFrame).includes("Bash command"));
    expect(plain(frame(lastFrame))).toContain("Note: may discard uncommitted changes");

    const quiet = fakeRemote();
    const b = app(quiet);
    await waitFor(() => frame(b.lastFrame).includes(COMPOSER));
    quiet.parkPermission(entry({ toolUseID: "g2", toolName: "Bash", input: { command: "ls -la" } }));
    await waitFor(() => frame(b.lastFrame).includes("Bash command"));
    expect(plain(frame(b.lastFrame))).not.toContain("Note: may");
    cleanupRoots();
  });
});

// ── ACCEPTANCE #2 ───────────────────────────────────────────────────────────────────────────────────────
// "Choosing `Yes, and don't ask again for: npm run *`, then quitting and relaunching ccx, runs the same
//  command with no prompt — and the rule is visible in `.claude/settings.local.json`."
//
// See the file header for why this is two halves and where the second one lives. The first half is a chain
// of three: the row's seed (`twoWordPrefix`, T6), the outcome the row emits, and the gate's translation of
// that outcome into the SDK's allow arm. A break anywhere in it makes the relaunch half meaningless, and no
// per-task suite crosses the dialog/gate boundary.
const npmRule: PermissionUpdateLike =
  { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm run:*" }], behavior: "allow", destination: "session" };

describe("F6 acceptance #2 — the don't-ask-again row emits a localSettings rule the gate hands straight on", () => {
  it("row 2 reads `npm run *` and answers with ONE addRules update destined for localSettings", async () => {
    const got: PermissionDecision[] = [];
    const v = render(<BashPermission req={{ input: { command: "npm run build" }, suggestions: [npmRule] }} cwd="/repo" onDecision={(d) => got.push(d)} />);
    await waitFor(() => frame(v.lastFrame).length > 0);
    // The literal the criterion quotes, curly apostrophe and all (`$Qf`, L504861-870).
    expect(plain(frame(v.lastFrame))).toContain("2. Yes, and don’t ask again for: npm run *");
    v.stdin.write("2");
    await waitFor(() => got.length === 1);
    expect(got[0]).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm run *" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("`createPermissionGate` turns that outcome into the SDK allow arm with the rule intact", async () => {
    // The wire the engine sees. `updatedPermissions` must arrive BYTE-IDENTICAL — probe 81's whole result
    // hangs on the engine receiving the destination we chose, not one we let a normalizer rewrite.
    const outcome = {
      kind: "allow_with_updates" as const,
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm run *" }], behavior: "allow", destination: "localSettings" }] as PermissionUpdateLike[],
    };
    const broker: PermissionBroker = { request: async () => outcome };
    const gate = createPermissionGate(broker);
    const result = await gate("Bash", { command: "npm run build" }, { signal: new AbortController().signal, toolUseID: "x" });
    expect(result).toEqual({ behavior: "allow", updatedInput: { command: "npm run build" }, updatedPermissions: outcome.updatedPermissions });
    // The in-memory `allowed` Set is deliberately NOT also written (gate.ts): the persisted rule replaces it
    // rather than shadowing it, which is what makes the relaunch half the only thing that can suppress the
    // second consult. A second consult in the SAME process therefore still reaches the broker.
    let asked = 0;
    const counting = createPermissionGate({ request: async () => { asked++; return outcome; } });
    await counting("Bash", { command: "npm run build" }, { signal: new AbortController().signal, toolUseID: "y" });
    await counting("Bash", { command: "npm run build" }, { signal: new AbortController().signal, toolUseID: "z" });
    expect(asked).toBe(2);
  });
});

// ── ACCEPTANCE #3 ───────────────────────────────────────────────────────────────────────────────────────
// "An Edit permission prompt shows the real diff in the transcript flow — the transcript stays visible, no
//  screen-covering modal; the composer is hidden while the dialog is visible; a prompt arriving mid-draft is
//  suppressed behind a dim `Waiting for permission…` row until typing pauses."
//
// All three of upstream's dialog states in one run, in the order a real session produces them: a turn lands
// in the transcript, a draft is half-typed, the consult arrives SUPPRESSED, the typing window closes, the
// dialog becomes VISIBLE with its diff, and answering returns to NONE with the draft intact.
describe("F6 acceptance #3 — the Edit consult walks none → suppressed → visible without covering the transcript", () => {
  it("suppresses behind `Waiting for permission…` mid-draft, then reveals a real diff in the flow", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = app(fake, IDLE_SHORT);
    await waitFor(() => frame(lastFrame).includes(COMPOSER));
    stdin.write("first turn\r");
    await waitFor(() => frame(lastFrame).includes("ok"));                  // the transcript now holds a reply
    for (const ch of "half typed") { stdin.write(ch); await tick(); }
    await waitFor(() => frame(lastFrame).includes("half typed"));

    const edit = entry({ toolUseID: "e1", toolName: "Edit", input: { file_path: "src/app.ts", old_string: "const a = 1", new_string: "const a = 2" } });
    fake.parkPermission(edit);
    // SUPPRESSED: the dialog renders nothing, the composer keeps the screen and says why.
    await waitFor(() => frame(lastFrame).includes(WAITING_FOR_PERMISSION));
    expect(flat(lastFrame)).not.toContain("Edit file");
    expect(flat(lastFrame)).toContain("half typed");
    expect(fake.answeredCalls).toEqual([]);

    // VISIBLE: `fs` elapses unaided.
    await waitFor(() => frame(lastFrame).includes("Edit file"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("-const a = 1");                                   // the REAL diff, not a summary
    expect(f).toContain("+const a = 2");
    expect(f).toContain("ok");                                             // the transcript is still there…
    expect(f).not.toContain(COMPOSER);                                     // …and the composer is not (L549494)
    expect(f).not.toContain(WAITING_FOR_PERMISSION);

    // NONE: answering restores the composer, and the half-typed draft survived the unmount.
    stdin.write("1");
    await waitFor(() => fake.answeredCalls.length === 1);
    await waitFor(() => frame(lastFrame).includes(COMPOSER));
    expect(flat(lastFrame)).toContain("half typed");
    cleanupRoots();
  });
});

// ── ACCEPTANCE #4 ───────────────────────────────────────────────────────────────────────────────────────
// "A plan approval is titled `Ready to code?`; choosing `No, keep planning` and submitting empty feedback
//  rejects with no feedback, exactly as Esc does."  (Rewritten — see the file header.)
//
// "Exactly as" is the load-bearing phrase, so this is an EQUALITY between two answered payloads produced by
// two different key paths through the real app, not two independent literal assertions.
describe("F6 acceptance #4 — an empty keep-planning submit denies byte-for-byte as Esc does", () => {
  const planEntry = () => entry({ toolUseID: "p", toolName: "ExitPlanMode", kind: "plan", input: { plan: "ship it" } });

  it("titles `Ready to code?` and answers identically down the empty-submit and the Escape paths", async () => {
    const viaSubmit = fakeRemote();
    const a = app(viaSubmit);
    await waitFor(() => frame(a.lastFrame).includes(COMPOSER));
    viaSubmit.parkPermission(planEntry());
    await waitFor(() => frame(a.lastFrame).includes("Ready to code?"));
    expect(plain(frame(a.lastFrame))).toContain("Tell Claude what to change");   // the keep-planning row IS its placeholder
    a.stdin.write("\x1b[B"); await tick();                                       // ↓ → row 2
    a.stdin.write("\x1b[B"); await tick();                                       // ↓ → the input row
    a.stdin.write("\r");                                                         // submit it EMPTY
    await waitFor(() => viaSubmit.answeredCalls.length === 1);

    const viaEsc = fakeRemote();
    const b = app(viaEsc);
    await waitFor(() => frame(b.lastFrame).includes(COMPOSER));
    viaEsc.parkPermission(planEntry());
    await waitFor(() => frame(b.lastFrame).includes("Ready to code?"));
    b.stdin.write("\x1b");
    await waitFor(() => viaEsc.answeredCalls.length === 1);

    expect(viaSubmit.answeredCalls[0]).toEqual(viaEsc.answeredCalls[0]);
    expect(viaSubmit.answeredCalls[0]).toEqual({ toolUseID: "p", decision: { kind: "plan_reject" } });
    expect(viaSubmit.answeredCalls[0].decision).not.toHaveProperty("feedback");
    cleanupRoots();
  });
});

// ── ACCEPTANCE #5 ───────────────────────────────────────────────────────────────────────────────────────
// "The rewind picker shows each row's file-change summary before anything is selected."
//
// The pin that matters is the NEGATIVE half: nothing has been selected, no Enter has been pressed, and the
// summaries are on screen anyway. The C5 picker computed them on Enter, so a regression toward that shape
// would still satisfy a "summaries appear eventually" assertion.
describe("F6 acceptance #5 — every rewind row carries its file-change summary with nothing selected yet", () => {
  const ANCHORS: RewindAnchor[] = [
    { uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2, timestamp: new Date(Date.now() - 5 * 60_000).toISOString() },
    { uuid: "uA", prevUuid: null, text: "first prompt", index: 0 },
  ];
  const dry: Record<string, RewindDryRun> = {
    uB: { canRewind: true, filesChanged: ["/repo/src/b.ts"], insertions: 4, deletions: 2 },
    uA: { canRewind: true, filesChanged: ["/repo/src/a.ts", "/repo/src/c.ts"], insertions: 7, deletions: 0 },
  };

  it("renders `<basename> +A -R` and `N files changed +A` on the rows themselves, before any Enter", async () => {
    const confirmed: unknown[] = [];
    const { lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={async (uuid) => dry[uuid]!} onConfirm={(...a) => confirmed.push(a)} onClose={() => {}} rows={40} columns={80} />,
    );
    await waitFor(() => plain(frame(lastFrame)).includes("b.ts"));
    await waitFor(() => plain(frame(lastFrame)).includes("2 files changed"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("b.ts +4 -2");                                     // `g3`'s badge (ASCII hyphen, T10)
    expect(f).toContain("2 files changed +7");
    // Still the LIST, not the confirmation panel: no restore options, no manual-edit warning, no callback.
    expect(f).toContain("enter to continue · esc to cancel");
    expect(f).not.toContain("Restore conversation");
    expect(f).not.toContain("Rewinding does not affect files");
    expect(confirmed).toEqual([]);                                         // …and nothing has been chosen
  });
});

// ── ACCEPTANCE #6 ───────────────────────────────────────────────────────────────────────────────────────
// "`j`/`k`, `ctrl+n`/`ctrl+p`, PageUp/PageDown and Home/End move the selection in every list in the app."
//
// **NARROWED, and the narrowing is the honest part.** What is true is "every list on T1's `Select`" — which
// as of Wave S t6b is the NINE surfaces below, and the narrowing no longer costs this criterion a surface.
//
// WAVE S t5 AND t6b CLOSED THE ORIGINAL SHORTFALL, one half each. This block used to name two older overlays
// that failed two of the five groups: `SettingsDialog` and `PermissionsDialog` push the `Settings` context,
// which binds `up`/`down`/`j`/`k`/`ctrl+p`/`ctrl+n` but **no `pageup`/`pagedown`/`home`/`end` at all**
// (bindings.ts), and their key fallback swallows the unresolved keys rather than passing them on. Both are
// `Select` lists now, and in both the fix was the MIGRATION rather than four new bindings on the `Settings`
// context: the inner `Select` pushes the `Select` context innermost, where those four keys already resolve,
// and it brings the WINDOW that makes a page mean something (a list that renders every row it has has no page
// to turn — the "resolves but moves nothing" defect F2 exists to remove). t5 did Settings' five Config rows;
// t6b did Permissions' rule and workspace lists, which are the genuinely UNBOUNDED ones here, so the window it
// brought is load-bearing rather than nominal. Both are pinned below like every other member, and the parity
// doc's F6 divergence row is closed with them (docs/parity/tui-ux.md, the `pageup`/`pagedown`/`home`/`end`
// row). Upstream's own Permissions is now the narrower surface: `jr` gives it `pageup`/`pagedown` and has no
// `home`/`end` anywhere, and it draws no counted indicators (recorded divergence, W-S11).
//
// Each key group gets a FRESH MOUNT rather than a walk from one state to the next, because a surface whose
// last row is a `type:"input"` row (the plan dialog) deregisters every movement action while that row has the
// cursor (`useSelectKeys`, upstream's `if (!m)` at L396672) — End must be assertable without stranding the
// walk on it.
//
// THREE RECORDED EXCEPTIONS among the seven, each pinned in its own shape below rather than silently skipped,
// and each carried into the parity doc's F6 divergence table:
//   · `MultiSelect` binds no Home/End at all (`tQs`, T2) — bundle-faithful, and narrower than the criterion's
//     literal wording. The single-select surfaces below are what "every list" means here.
//   · The session picker is modeless-search, so an UNBOUND printable types into the query; `j`/`k` are bound
//     and stay navigation, which is what this criterion asks for and is what is pinned.
//   · The background dialog drives `useSelectKeys` DIRECTLY (it renders its own section-grouped rows rather
//     than mounting a `Select`), so it inherits that hook's `wrap:false` default and CLAMPS at both ends
//     where every `Select`-rendered list wraps. Every key still moves the selection — which is the criterion
//     — so it is pinned with `wrap:false` and recorded, not "fixed" inside a verification task.
const KEYS = { j: "j", k: "k", ctrlN: "\x0e", ctrlP: "\x10", pageDown: "\x1b[6~", pageUp: "\x1b[5~", home: "\x1b[H", end: "\x1b[F" };

/** The label on the row carrying the `❯` gutter. Reading from the FIRST `❯` on the line rather than from the
 *  line's start is what makes this work for the surfaces that draw inside a box (the rewind picker's rows are
 *  prefixed by the frame's `│`), and no surface here mounts a composer, which is the only other `❯` in the
 *  tree. */
const focusedRow = (f: () => string | undefined): string => {
  const line = plain(frame(f)).split("\n").find((l) => l.includes(POINTER));
  return line === undefined ? "" : line.slice(line.indexOf(POINTER) + POINTER.length);
};

type View = { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined };

/** Open fresh, wait for the list, press `keys`, answer "which row has the cursor now". Fresh per key group
 *  on purpose — see the block comment above. `open` is async because a surface may need a keystroke of its
 *  own to reach its list (the help dialog's Tab), and a key written before Ink's passive subscription lands
 *  is a key that never happened (harness/CLAUDE.md's tui rule). */
async function after(open: () => Promise<View>, keys: string[]): Promise<string> {
  const v = await open();
  await waitFor(() => focusedRow(v.lastFrame) !== "");
  for (const key of keys) { v.stdin.write(key); await tick(); }
  await tick();
  return focusedRow(v.lastFrame);
}

/** One criterion-6 run: `rows` are the surface's option labels in DISPLAY order, `start` the row the surface
 *  opens on, `wrap` whether stepping off an end comes round (`Select`'s contract; see the exceptions above).
 *  Pages and Home/End always clamp. */
function pinsListNavigation(name: string, open: () => Promise<View>, rows: string[], { start = 0, wrap = true }: { start?: number; wrap?: boolean } = {}) {
  const n = rows.length;
  const at = (i: number) => rows[wrap ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))]!;
  describe(`F6 acceptance #6 — ${name}`, () => {
    it("opens on its own default row", async () => { expect(await after(open, [])).toContain(at(start)); });
    it("j / k step down and up", async () => {
      expect(await after(open, [KEYS.j])).toContain(at(start + 1));
      expect(await after(open, [KEYS.k])).toContain(at(start - 1));
    });
    it("ctrl+n / ctrl+p step down and up", async () => {
      expect(await after(open, [KEYS.ctrlN])).toContain(at(start + 1));
      expect(await after(open, [KEYS.ctrlP])).toContain(at(start - 1));
    });
    it("PageDown / PageUp clamp to the ends", async () => {
      expect(await after(open, [KEYS.pageDown])).toContain(rows[n - 1]!);
      expect(await after(open, [KEYS.pageUp])).toContain(rows[0]!);
    });
    it("Home / End jump to the ends", async () => {
      expect(await after(open, [KEYS.home])).toContain(rows[0]!);
      expect(await after(open, [KEYS.end])).toContain(rows[n - 1]!);
    });
  });
}

/** Render, then wait until the list is on screen. */
const opened = async (ui: React.ReactElement, ready: string): Promise<View> => {
  const v = render(ui);
  await waitFor(() => plain(frame(v.lastFrame)).includes(ready));
  return v;
};

pinsListNavigation(
  // The rows are matched on their RENDERED INDEX PREFIX, not their bare label: a bare `Yes` is a prefix of
  // row 2's `Yes, and don’t ask again for: …`, so `toContain("Yes")` would pass with the cursor on either
  // row and the j/k assertions would prove nothing. Every row here carries a `Select` index column.
  "the permission dialog's option list",
  () => opened(<BashPermission req={{ input: { command: "npm run build" }, suggestions: [npmRule] }} cwd="/repo" onDecision={() => {}} />, "Bash command"),
  ["1. Yes", "2. Yes, and don’t ask again for: npm run *", "3. No"],
);

pinsListNavigation(
  "the plan dialog's option list (last row is an input row)",
  () => opened(<PlanDialog req={{ input: { plan: "# Build it\n\n- step one" } }} onDecision={() => {}} editorName="vim" editor={(t: string) => t} rows={40} />, "Ready to code?"),
  ["Yes, auto-accept edits", "Yes, manually approve edits", "Tell Claude what to change"],
);

pinsListNavigation(
  "the rewind picker's anchor list (opens on the trailing `(current)` row)",
  () => opened(<RewindPicker anchors={[
    { uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2 },
    { uuid: "uA", prevUuid: null, text: "first prompt", index: 0 },
  ]} onDryRun={() => new Promise<RewindDryRun>(() => {})} onConfirm={() => {}} onClose={() => {}} rows={40} columns={80} />, "(current)"),
  ["first prompt", "second prompt", "(current)"],
  { start: 2 },
);

const MODELS: ModelInfo[] = [
  { value: "opus", displayName: "Opus 5", description: "most capable" },
  { value: "sonnet", displayName: "Sonnet 4.7", description: "balanced" },
  { value: "haiku", displayName: "Haiku 4.5", description: "fastest" },
];
pinsListNavigation(
  "the model picker",
  () => opened(<ModelPicker models={MODELS} onPick={() => {}} onCancel={() => {}} savePrefs={() => {}} rows={40} columns={100} />, "Haiku 4.5"),
  ["Opus 5", "Sonnet 4.7", "Haiku 4.5"],
);

const NOW = 1_700_000_000_000;
const SESSIONS: SessionInfo[] = [
  { sessionId: "1111aaaa-0001", summary: "refactor the parser", lastModified: NOW },
  { sessionId: "2222bbbb-0002", summary: "write the release notes", lastModified: NOW - 3600_000 },
  { sessionId: "3333cccc-0003", summary: "fix the flaky test", lastModified: NOW - 86_400_000 },
];
pinsListNavigation(
  "the session picker (modeless search — the bound keys stay navigation)",
  () => opened(<SessionPicker sessions={SESSIONS} onPick={() => {}} onCancel={() => {}} loadMessages={async () => ({ state: "loaded", messages: [] })} renameSession={async () => {}} rows={40} columns={100} />, "fix the flaky test"),
  ["refactor the parser", "write the release notes", "fix the flaky test"],
);

const bg = (id: string, command: string): BgTaskRow =>
  ({ task_id: id, task_type: "local_bash", description: command, command, outputFile: `/tmp/${id}.out`, status: "running" });
pinsListNavigation(
  "the background dialog (drives `useSelectKeys` directly — clamps where a `Select` wraps)",
  () => opened(<BgTasksPanel tasks={[bg("s1", "seq 1 20"), bg("s2", "npm test"), bg("s3", "tail -f log")]} onStop={() => {}} onClose={() => {}} />, "tail -f log"),
  ["seq 1 20", "npm test", "tail -f log"],
  { wrap: false },
);

const CATALOG: CommandEntry[] = [
  { name: "agents", description: "manage subagents", source: "catalog" },
  { name: "brainstorm", description: "explore a design", source: "catalog" },
  { name: "compact", description: "summarize the conversation", source: "local" },
];
// WAVE S t5 — the Config tab's rows, at a pane tall enough that the whole catalog is on screen (the
// windowing itself is settings-dialog.test.tsx's; what this pins is that all five key groups now arrive here).
// TEN rows since F8 T6 added `Reduce motion` below W-C T7's `Show turn duration`, T-CH34 added `Terminal
// progress bar` below THAT, W-C T12 added `Prompt suggestions` below that, and F9 T-MOUSE Task 7's `Copy on
// select` is now the list's last row.
const SETTINGS_PROPS = {
  tab: "Config", onTabChange: () => {}, mode: "default", thinkLevel: "default", outputStyle: "default",
  onDone: () => {}, applyMode: async () => {}, setThink: async () => {}, applyOutputStyle: async () => {},
  fetchStatus: async () => [], fetchUsage: async () => [], fetchStats: async () => [],
  onOpenModelPicker: () => {}, savePrefs: () => {}, showTurnDuration: true, setShowTurnDuration: () => {}, reduceMotion: false, setReduceMotion: () => {},
  progressBarEnabled: true, setProgressBarEnabled: () => {}, promptSuggestionEnabled: false, setPromptSuggestionEnabled: () => {},
  copyOnSelect: true, setCopyOnSelect: () => {},
};
pinsListNavigation(
  "the Settings dialog's Config list",
  () => opened(<SettingsDialog {...SETTINGS_PROPS} rows={40} columns={100} />, "Prompt suggestions"),
  ["Theme", "Model", "Output style", "Default permission mode", "Thinking mode", "Show turn duration", "Reduce motion", "Terminal progress bar", "Prompt suggestions", "Copy on select"],
);

// WAVE S t6b — the Allow tab's rule list, at a pane tall enough that all three rows are on screen (the
// windowing itself is permissions-dialog.test.tsx's; what this pins is that all five key groups arrive here).
// This dialog FETCHES its rows, so `opened` waits on a rule rather than on the frame's title.
const PERMISSIONS_PROPS = {
  tab: "Allow", onTabChange: () => {}, denials: [], cwd: "/tmp",
  fetchSettings: async () => ({ sources: [{ source: "userSettings", settings: { permissions: { allow: ["Bash(ls)", "WebFetch"] } } }] }) as unknown,
  fetchDirs: async () => [],
  addRule: async () => {}, removeRule: async () => {}, removeDir: async () => {},
  addDirValidate: async () => ({ kind: "missing", abs: "" }) as AddDirVerdict,
  confirmAddDir: async () => {}, cancelAddDir: () => {}, onDone: () => {},
};
pinsListNavigation(
  "the Permissions dialog's Allow rule list",
  () => opened(<PermissionsDialog {...PERMISSIONS_PROPS} rows={40} columns={100} />, "WebFetch"),
  ["Add a new rule…", "Bash(ls)", "WebFetch"],
);

pinsListNavigation(
  "the help dialog's command browser",
  async () => {
    const v = await opened(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />, "Shortcuts");
    v.stdin.write("\t");                                                   // Tab → the Commands tab
    await waitFor(() => plain(frame(v.lastFrame)).includes("/brainstorm"));
    return v;
  },
  ["/agents", "/brainstorm", "/compact"],
);
