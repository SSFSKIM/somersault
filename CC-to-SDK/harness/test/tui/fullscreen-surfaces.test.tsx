// tui/test/fullscreen-surfaces.test.tsx — FSW Task 14: the six SURFACE deltas the fixed frame owes canon
// (grounding §4's table, rows D1 and D10–D14) plus the three amendments the T12 review attached to them.
//
// Every claim here is one row of that table, and each one is a difference the RENDERER makes to a surface both
// modes already have — which is why they are pinned together rather than beside their own components: the
// discriminator is always "classic renders X, fullscreen renders Y", and a test that only mounts one arm
// cannot see the delta at all.
//
//   D1  (bundle 484935) a configured-but-unresolved statusLine HOLDS a blank row in fullscreen and collapses
//       in classic — an async `sh -c 'sleep 3; echo LATE'` must not shove a fixed frame when it lands.
//   D10 (456219–456226 `rCn`, mounted at 455945 as `IDa`'s first child, above the dock band) the suggestion
//       popup is hoisted out of the composer into its own overlay ABOVE the dock; classic keeps it inline.
//   D11 (494644, `Utl = LRn ? null : …`) the composer's notification block is suppressed — WITH amendment 1's
//       exception: the `v` dump's receipt is `priority:"immediate"` and is the only feedback that keystroke
//       has, so the footer's right region (canon's own `Wtl` slot, 494681) hosts the immediate rank.
//   D12 (494654) the footer's right padding is 1 instead of 2.
//   D13 (494586) the footer grows canon's RIGHT REGION in fullscreen. Its canon tenant — the `focus` chip,
//       `LRn && kmk` where `kmk` is `briefTranscript` — is `/focus`, which is D20 and deferred, so the region
//       ships with the tenant amendment 1 gives it and the chip recorded absent.
//   D14 (549395, `ds() && jsx(lui)`) queued prompts move to the TAIL of the scrollable document.
//   A2  `v` is announced where it is live: on the jump pill, in canon's own words (547303, `v to open in …`).
import React from "react";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render } from "ink-testing-library";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Footer, footerRows, footerStatusRows } from "../../src/tui/Footer.js";
import { jumpPillText } from "../../src/tui/JumpPill.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { createNotificationStore } from "../../src/tui/notifications.js";
import { defaultLookup } from "../../src/tui/keys/hints.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";

const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const rowsOf = (frame: string | undefined): string[] => plain(frame).split("\n");
const frameOf = (f: () => string | undefined) => plain(f());
/** The composer's ready prompt — `❯` + U+00A0. */
const PROMPT = "❯ ";
const PAGE_UP = "\x1b[5~";
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

// The pill's `v` hint prints the editor's name, so the two variables it reads are pinned for the whole file
// rather than left to whatever the runner's shell exports.
beforeAll(() => { vi.stubEnv("VISUAL", ""); vi.stubEnv("EDITOR", ""); });
afterAll(() => { vi.unstubAllEnvs(); });

let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-t14-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

const home = {
  mode: "default", busy: false, draftNonEmpty: false, isInputEmpty: true, searching: false,
  statusLineConfigured: false, pasting: false, pasteExpandHint: false, bashMode: false,
  agents: { count: 0 }, bindings: defaultLookup, composerOwnsKeys: true,
} as const;
const footerFrame = (props: Partial<React.ComponentProps<typeof Footer>> = {}): string[] =>
  rowsOf(renderWithKeymap(<Footer {...home} {...props} />).lastFrame());

// ── D1 ────────────────────────────────────────────────────────────────────────────────────────────────────
describe("D1 — the statusLine's reserved row is fullscreen-only, and only while unresolved", () => {
  const cfg = { statusLineConfigured: true, bashMode: false, pasting: false, rows: 24 } as const;

  it("holds ONE row in fullscreen and none in classic while the command has not answered", () => {
    for (const text of [undefined, ""]) {
      expect(footerStatusRows({ ...cfg, statusLineText: text, fullscreen: true })).toBe(1);
      expect(footerStatusRows({ ...cfg, statusLineText: text, fullscreen: false })).toBe(0);
    }
  });

  it("renders nothing in EITHER mode when no statusLine is configured", () => {
    expect(footerStatusRows({ statusLineConfigured: false, bashMode: false, pasting: false, rows: 24, fullscreen: true })).toBe(0);
    expect(footerStatusRows({ statusLineConfigured: false, bashMode: false, pasting: false, rows: 24, fullscreen: false })).toBe(0);
  });

  it("counts the script's own lines in both modes once it HAS answered", () => {
    expect(footerStatusRows({ ...cfg, statusLineText: "a\nb", fullscreen: true })).toBe(2);
    expect(footerStatusRows({ ...cfg, statusLineText: "a\nb", fullscreen: false })).toBe(2);
  });

  it("keeps the four suppressors and the 15-row floor above the fullscreen arm", () => {
    expect(footerStatusRows({ ...cfg, statusLineText: undefined, fullscreen: true, bashMode: true })).toBe(0);
    expect(footerStatusRows({ ...cfg, statusLineText: undefined, fullscreen: true, pasting: true })).toBe(0);
    expect(footerStatusRows({ ...cfg, statusLineText: undefined, fullscreen: true, exitArm: { key: "Ctrl-C", verb: "exit" } })).toBe(0);
    expect(footerStatusRows({ ...cfg, statusLineText: undefined, fullscreen: true, rows: 14 })).toBe(0);
  });

  // THE PAINT AND THE RESERVATION ARE THE SAME PREDICATE (T13b review I4). `footerRows` is what the dock's
  // budget charges; a component that painted a row the count did not know about would have the dialog above it
  // compose into rows the frame then clips.
  it("paints exactly the rows `footerRows` charges, on both arms", () => {
    const unresolved = { statusLineConfigured: true, statusLineText: undefined, bashMode: false, pasting: false, rows: 24 } as const;
    expect(footerFrame({ ...unresolved, fullscreen: true })).toHaveLength(footerRows({ ...unresolved, fullscreen: true }));
    expect(footerFrame({ ...unresolved, fullscreen: false })).toHaveLength(footerRows({ ...unresolved, fullscreen: false }));
    expect(footerRows({ ...unresolved, fullscreen: true })).toBe(2);
    expect(footerRows({ ...unresolved, fullscreen: false })).toBe(1);
  });

  it("holds the row BLANK — the reservation is a space, never the last good line", () => {
    const lines = footerFrame({ statusLineConfigured: true, statusLineText: undefined, rows: 24, fullscreen: true });
    expect(lines[0]!.trim()).toBe("");
    expect(lines[1]).toContain("manual mode on");
  });
});

// ── D12 ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("D12 — the mode row's right padding", () => {
  // The padding is invisible on a short row, so it is measured where it BITES: a statusLine wider than the
  // pane truncates at the content width, and the content width is the terminal minus the two paddings.
  it("gives the fullscreen footer one more content column than classic (paddingRight 1 vs 2)", () => {
    const long = { statusLineConfigured: true, statusLineText: "x".repeat(400), rows: 24 } as const;
    const wide = footerFrame({ ...long, fullscreen: true })[0]!.length;
    const narrow = footerFrame({ ...long, fullscreen: false })[0]!.length;
    expect(wide - narrow).toBe(1);
  });
});

// ── D13 + amendment 1 ─────────────────────────────────────────────────────────────────────────────────────
describe("D13 / amendment 1 — the footer's right region, and what ccx puts in it", () => {
  const receipt = { key: "transcript-dump", text: "wrote /tmp/cc-transcript-1.txt", priority: "immediate" } as const;

  it("hosts an immediate-priority notification in fullscreen, right-flushed on the mode row", () => {
    const lines = footerFrame({ fullscreen: true, notice: receipt });
    expect(lines).toHaveLength(1);                                    // the same row — the geometry is paid for
    expect(lines[0]).toContain("manual mode on");
    expect(lines[0]).toContain("wrote /tmp/cc-transcript-1.txt");
    expect(lines[0]!.trimEnd().endsWith("wrote /tmp/cc-transcript-1.txt")).toBe(true);
  });

  it("costs the dock's reservation nothing — `footerRows` does not move when a receipt is up", () => {
    expect(footerRows({ statusLineConfigured: false, bashMode: false, pasting: false, rows: 24, fullscreen: true })).toBe(1);
    expect(footerFrame({ fullscreen: true, notice: receipt })).toHaveLength(1);
  });

  it("takes the immediate rank ONLY — the ranks the composer's own slot carries are not relocated here", () => {
    const hint = { key: "search-history-hint", text: "ctrl+r to search history", priority: "low" } as const;
    expect(footerFrame({ fullscreen: true, notice: hint })[0]).not.toContain("search history");
  });

  it("does not exist in classic — the composer's slot is still the one home there", () => {
    expect(footerFrame({ fullscreen: false, notice: receipt })[0]).not.toContain("wrote /tmp");
  });
});

// ── the app-level deltas ──────────────────────────────────────────────────────────────────────────────────
const alphaEntries = (n = 40) => Array.from({ length: n }, (_, i) => ({
  kind: "sdk" as const, source: "disk" as const,
  message: { type: "assistant", parent_tool_use_id: null, uuid: `u-${i}`, message: { id: `m-${i}`, content: [{ type: "text", text: `ALPHA-${i}` }] } },
}));

describe("D10 — the command palette is hoisted above the dock in fullscreen", () => {
  const app = (mode: "fullscreen" | "classic") => (
    <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode, reason: "env_on" }} initialEntries={alphaEntries()}
      deps={{ columns: () => 80, rows: () => 24 }} />
  );
  /** The popup's own rows: a suggestion line begins with the command name at the popup's `paddingX: 2`. */
  const popupRow = (lines: string[]) => lines.findIndex((l) => /^\s{2}\/model\b/.test(l));
  const promptRow = (lines: string[]) => lines.findIndex((l) => l.includes(PROMPT));

  const typeSlash = async (r: ReturnType<typeof renderWithKeymap>) => {
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    r.stdin.write("/mode");
    await waitFor(() => popupRow(rowsOf(r.lastFrame())) >= 0);
    await settle();
  };

  it("puts the popup ABOVE the composer's prompt row in fullscreen", async () => {
    const r = renderWithKeymap(app("fullscreen"));
    await typeSlash(r);
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(23);                                   // the frame is still rows − 1
    expect(popupRow(lines)).toBeGreaterThanOrEqual(0);
    expect(popupRow(lines)).toBeLessThan(promptRow(lines));
    r.unmount();
  });

  it("keeps it BELOW the composer in classic — byte-for-byte where it always was", async () => {
    const r = renderWithKeymap(app("classic"));
    await typeSlash(r);
    const lines = rowsOf(r.lastFrame());
    expect(popupRow(lines)).toBeGreaterThan(promptRow(lines));
    r.unmount();
  });

  it("does not clip the composer off the frame while the palette is up", async () => {
    const r = renderWithKeymap(app("fullscreen"));
    await typeSlash(r);
    // The whole point of hoisting: the popup is half the terminal and the dock's steady-state cap is the other
    // half, so a palette left inside a `floor(rows/2)` band takes the composer and the footer with it.
    expect(frameOf(r.lastFrame)).toContain(PROMPT);
    expect(frameOf(r.lastFrame)).toContain("manual mode on");
    r.unmount();
  });
});

describe("D11 — the composer's notification block, suppressed in fullscreen", () => {
  const app = (mode: "fullscreen" | "classic", notifications: ReturnType<typeof createNotificationStore>) => (
    <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode, reason: "env_on" }} initialEntries={alphaEntries()}
      deps={{ columns: () => 80, rows: () => 24, notifications }} />
  );

  it("drops a non-immediate hint in fullscreen and keeps it in classic", async () => {
    const hint = { key: "external-editor-hint", text: "SOME-COMPOSER-HINT", priority: "low" } as const;
    const fs = createNotificationStore();
    const rf = renderWithKeymap(app("fullscreen", fs));
    await waitFor(() => frameOf(rf.lastFrame).includes(PROMPT));
    fs.add(hint);
    await settle();
    expect(frameOf(rf.lastFrame)).not.toContain("SOME-COMPOSER-HINT");
    rf.unmount();

    const cs = createNotificationStore();
    const rc = renderWithKeymap(app("classic", cs));
    await waitFor(() => frameOf(rc.lastFrame).includes(PROMPT));
    cs.add(hint);
    await settle();
    expect(frameOf(rc.lastFrame)).toContain("SOME-COMPOSER-HINT");
    rc.unmount();
  });

  // AMENDMENT 1 — the suppression may not silence the ONE feedback `v` has.
  it("still shows an immediate-priority receipt in fullscreen (the `v` dump's only feedback)", async () => {
    const store = createNotificationStore();
    const r = renderWithKeymap(app("fullscreen", store));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    store.add({ key: "transcript-dump", text: "wrote /tmp/cc-transcript-2.txt", priority: "immediate" });
    await settle();
    expect(frameOf(r.lastFrame)).toContain("wrote /tmp/cc-transcript-2.txt");
    r.unmount();
  });
});

describe("D14 — queued prompts live at the document's tail in fullscreen", () => {
  const app = (mode: "fullscreen" | "classic", fake: ReturnType<typeof fakeRemote>) => (
    <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode, reason: "env_on" }} initialEntries={alphaEntries()}
      deps={{ columns: () => 80, rows: () => 24 }} />
  );
  /** A session whose turn never ends: the second prompt is queued rather than sent. */
  const stuck = () => fakeRemote({ submit: () => new Promise<{ result: unknown }>(() => {}) });
  const queueOne = async (r: ReturnType<typeof renderWithKeymap>) => {
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    r.stdin.write("first\r");
    await waitFor(() => frameOf(r.lastFrame).includes("first"));
    r.stdin.write("QUEUEDPROMPT\r");
    await waitFor(() => frameOf(r.lastFrame).includes("QUEUEDPROMPT"));
    await settle();
  };

  it("scrolls away with the transcript — it is a document row, not a dock row", async () => {
    const r = renderWithKeymap(app("fullscreen", stuck()));
    await queueOne(r);
    for (let i = 0; i < 6; i++) { r.stdin.write(PAGE_UP); await tick(); }
    await settle();
    expect(frameOf(r.lastFrame)).not.toContain("QUEUEDPROMPT");        // gone: it was in the scrollable
    expect(frameOf(r.lastFrame)).toContain(PROMPT);                    // …and the dock is still there
    r.unmount();
  });

  it("stays pinned in the dock in classic, where scrolling cannot reach it", async () => {
    const r = renderWithKeymap(app("classic", stuck()));
    await queueOne(r);
    expect(frameOf(r.lastFrame)).toContain("QUEUEDPROMPT");
    r.unmount();
  });
});

// ── amendment 2 ───────────────────────────────────────────────────────────────────────────────────────────
describe("amendment 2 — `v` is announced where it is live", () => {
  // Canon advertises the same escape on its own transcript screen: `↑↓ scroll · v to open in <editor> · ?
  // for shortcuts` (bundle 547303). ccx's `v` is registered exactly while the JUMP PILL is up (T12), so the
  // pill is the one surface that can name it without promising a key the composer currently owns.
  it("adds canon's phrase as the pill's longest variant when the dump is live", () => {
    expect(jumpPillText(3, "ctrl+end", 80, "editor")).toContain("v to open in editor");
    expect(jumpPillText(3, "ctrl+end", 80, "nvim")).toContain("v to open in nvim");
  });

  it("drops the phrase before the words when the pane is too narrow, and never promises it while `v` is not ours", () => {
    expect(jumpPillText(3, "ctrl+end", 26, "editor")).not.toContain("v to open");
    expect(jumpPillText(3, "ctrl+end", 26, "editor")).toContain("3 new messages");
    expect(jumpPillText(3, "ctrl+end", 80)).not.toContain("v to open");
  });

  it("is on screen the moment the frame is scrolled off its tail", async () => {
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={alphaEntries()}
        deps={{ columns: () => 80, rows: () => 24 }} />,
    );
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    r.stdin.write(PAGE_UP);
    await settle();
    expect(frameOf(r.lastFrame)).toContain("v to open in");
    r.unmount();
  });
});
