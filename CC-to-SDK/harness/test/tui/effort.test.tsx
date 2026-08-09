// tui/test/effort.test.tsx — WAVE C TASK 11 (EP-C6): the effort surfaces. Canon is the grounding annex
// §C6.1 (glyphs), §C6.2 (the decaying hint), §C6.3 (the /model picker's effort row) and §C6.4 (the
// standalone dialog's footer); every literal below is a transcription and the bundle line sits on the
// assertion it produced. The MECHANISM half — `Query.applyFlagSettings({effortLevel})`, no `setEffort`, and
// NO SDK-side validation — is probe 102 (`waveC-grounding-probes.md` §(f)), which is why the wire tests
// below assert both that a valid level travels and that an out-of-domain one never reaches the wire at all.
import React from "react";
import { describe, it, expect } from "vitest";
// ChatApp and every dialog under it read stdin through `<KeymapProvider>`, never `useInput` (F2 task 6) —
// rendered bare they have NO input path at all and `stdin.write` goes nowhere, silently.
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { EffortDialog } from "../../src/tui/EffortDialog.js";
import { createNotificationStore } from "../../src/tui/notifications.js";
import {
  EFFORT_ADJUST_HINT, EFFORT_DIALOG_FOOTER, EFFORT_HINT_KEY, EFFORT_HINT_TIMEOUT_MS, EFFORT_LEVELS,
  MAX_EFFORT_CAVEAT, effortGlyph, effortHint, effortRowText, effortTitle, effortUnsupportedText, isEffortLevel,
  stepEffort, type EffortLevel,
} from "../../src/tui/modelPickerModel.js";
import { formatStatus } from "../../src/tui/commands.js";

/** Ink paints the row's colours INSIDE the text, so a substring assertion has to strip SGR first (the
 *  §C6.3 row is glyph/level/hint in three different colours — see `EffortRow.tsx`). `flat` additionally
 *  collapses every whitespace run: Ink hard-wraps at the pane width, and the composer's caret is followed by
 *  a NON-BREAKING space (U+00A0), which `\s` covers and a literal " " does not. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const frame = (f: () => string | undefined) => plain(f() ?? "").replace(/\n/g, " ");
const flat = (f: () => string | undefined) => frame(f).replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Type a slash command, WAIT for the composer to echo it, then submit — the same two-step every
 *  command-driving test in `chat.test.tsx` uses. One `write("/effort\r")` races the composer's own
 *  keystroke handling and the Return can land before the text does. */
async function runCommand(r: { stdin: { write(s: string): void }; lastFrame: () => string | undefined }, cmd: string) {
  // Ink subscribes stdin in a PASSIVE effect, so a write issued in the same macrotask as the render (which
  // is what a `waitFor` whose condition is already true leaves you in) is dropped on the floor — silently,
  // which is what makes it worth a line of comment (harness/CLAUDE.md's own rule).
  await tick();
  r.stdin.write(cmd);
  // The composer's echo, NOT the frame at large: the effort HINT itself contains the literal `/effort`, so a
  // whole-frame check here would pass before a single character had been typed (it did, for one debugging
  // round). `❯` + the text is the composer's own row.
  await waitFor(() => flat(r.lastFrame).includes(`❯ ${cmd}`));
  r.stdin.write("\r");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// §C6.1 / §C6.2 / §C6.3 / §C6.4 — the pure literals
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

describe("effort glyphs — `F7o` (L440864)", () => {
  it("is the five-glyph table, with `●` as the default arm", () => {
    expect(EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortGlyph("low")).toBe("○");
    expect(effortGlyph("medium")).toBe("◐");
    expect(effortGlyph("high")).toBe("●");
    expect(effortGlyph("xhigh")).toBe("◉");
    expect(effortGlyph("max")).toBe("◈");
    expect(effortGlyph(undefined)).toBe("●");            // `default: return ePi`
  });
  it("`Jir` title-cases, and `xhigh` is special-cased to the literal `xHigh` (L441659)", () => {
    expect(effortTitle("low")).toBe("Low");
    expect(effortTitle("xhigh")).toBe("xHigh");
    expect(effortTitle("max")).toBe("Max");
  });
});

describe("the picker's effort row, verbatim (§C6.3, L441142)", () => {
  it("renders `● High effort (default) ←/→ to adjust` when the level IS the default", () => {
    expect(effortRowText("high", true)).toBe("● High effort (default) ←/→ to adjust");
  });
  it("drops the `(default)` clause — and its space — when it is not", () => {
    expect(effortRowText("high", false)).toBe("● High effort ←/→ to adjust");
    expect(effortRowText("low", false)).toBe("○ Low effort ←/→ to adjust");
    expect(effortRowText("xhigh", false)).toBe("◉ xHigh effort ←/→ to adjust");
    expect(effortRowText("max", false)).toBe("◈ Max effort ←/→ to adjust");
  });
  it("the unsupported branch names the model when it has one, and does not when it does not", () => {
    expect(effortUnsupportedText("Haiku 4.5")).toBe("● Effort not supported for Haiku 4.5");
    expect(effortUnsupportedText()).toBe("● Effort not supported");
  });
  it("the max caveat is `TQt` (L76519) verbatim", () => {
    expect(MAX_EFFORT_CAVEAT).toBe("May use excessive tokens resulting in long response times or overthinking. Use sparingly for the hardest tasks.");
  });
  it("the adjust hint is `←/→ to adjust` (`kUe`'s arrowSep, L183786/L183849)", () => {
    expect(EFFORT_ADJUST_HINT).toBe("←/→ to adjust");
  });
});

describe("stepping — `xrf` (L441195): wraps modulo the SUPPORTED list", () => {
  it("steps forward and wraps off the end", () => {
    expect(stepEffort(EFFORT_LEVELS, "low", 1)).toBe("medium");
    expect(stepEffort(EFFORT_LEVELS, "max", 1)).toBe("low");
  });
  it("steps back and wraps off the front", () => {
    expect(stepEffort(EFFORT_LEVELS, "medium", -1)).toBe("low");
    expect(stepEffort(EFFORT_LEVELS, "low", -1)).toBe("max");
  });
  it("wraps modulo a RESTRICTED list — a model without xhigh/max never steps onto one", () => {
    const three: readonly EffortLevel[] = ["low", "medium", "high"];
    expect(stepEffort(three, "high", 1)).toBe("low");
    expect(stepEffort(three, "low", -1)).toBe("high");
  });
  it("a current level outside the list lands on the list's first entry rather than throwing", () => {
    expect(stepEffort(["low", "medium"], "max", 1)).toBe("low");
  });
});

describe("the ephemeral hint — `prf` (L440857)", () => {
  it("is `{glyph} {raw lowercase level} · /effort`, for every level", () => {
    expect(effortHint("high")).toBe("● high · /effort");
    expect(effortHint("low")).toBe("○ low · /effort");
    expect(effortHint("medium")).toBe("◐ medium · /effort");
    expect(effortHint("xhigh")).toBe("◉ xhigh · /effort");
    expect(effortHint("max")).toBe("◈ max · /effort");
  });
  it("carries upstream's key and 10 000 ms deadline (`Nd`, L496132)", () => {
    expect(EFFORT_HINT_KEY).toBe("effort-level");
    expect(EFFORT_HINT_TIMEOUT_MS).toBe(10_000);
  });
});

describe("the domain — ccx validates, because the SDK does not (probe 102)", () => {
  it("accepts exactly the five levels the CLI's `--effort` accepts (args.ts)", () => {
    for (const l of EFFORT_LEVELS) expect(isEffortLevel(l)).toBe(true);
    for (const bad of ["bogus", "HIGH", "", "off", "ultra", undefined, null, 3]) expect(isEffortLevel(bad)).toBe(false);
  });
});

describe("the standalone dialog's footer (§C6.4, L447278)", () => {
  it("is `←/→ to adjust · Enter to confirm · Esc to cancel`", () => {
    expect(EFFORT_DIALOG_FOOTER).toBe("←/→ to adjust · Enter to confirm · Esc to cancel");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// The standalone dialog (§C6.4)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

function mountDialog(props: Partial<React.ComponentProps<typeof EffortDialog>> = {}) {
  const confirmed: EffortLevel[] = [];
  let cancelled = false;
  const r = renderWithKeymap(
    <EffortDialog
      level={props.level ?? "high"}
      levels={props.levels ?? EFFORT_LEVELS}
      {...(props.defaultEffort !== undefined ? { defaultEffort: props.defaultEffort } : {})}
      {...(props.modelName !== undefined ? { modelName: props.modelName } : {})}
      {...(props.supported !== undefined ? { supported: props.supported } : {})}
      onConfirm={(l) => confirmed.push(l)}
      onCancel={() => { cancelled = true; }}
    />,
  );
  return { ...r, confirmed, wasCancelled: () => cancelled };
}

describe("EffortDialog", () => {
  it("renders the effort row and the §C6.4 footer", async () => {
    const r = mountDialog({ level: "high", defaultEffort: "high" });
    await waitFor(() => frame(r.lastFrame).length > 0);
    expect(flat(r.lastFrame)).toContain(effortRowText("high", true));
    expect(flat(r.lastFrame)).toContain(EFFORT_DIALOG_FOOTER);
  });
  it("→ steps up and ← steps back, WITHOUT confirming (the footer's own contract)", async () => {
    const r = mountDialog({ level: "high" });
    await tick();
    r.stdin.write("\x1b[C");
    await waitFor(() => flat(r.lastFrame).includes("xHigh effort"));
    expect(r.confirmed).toEqual([]);
    r.stdin.write("\x1b[D");
    await waitFor(() => flat(r.lastFrame).includes("High effort"));
    expect(r.confirmed).toEqual([]);
  });
  it("Enter confirms the STAGED level, Esc confirms nothing", async () => {
    const r = mountDialog({ level: "high" });
    await tick();
    r.stdin.write("\x1b[C");
    await waitFor(() => flat(r.lastFrame).includes("xHigh effort"));
    r.stdin.write("\r");
    await waitFor(() => r.confirmed.length > 0);
    expect(r.confirmed).toEqual(["xhigh"]);

    const s = mountDialog({ level: "high" });
    await tick();
    s.stdin.write("\x1b[C"); await waitFor(() => flat(s.lastFrame).includes("xHigh effort"));
    s.stdin.write("\x1b");
    await waitFor(() => s.wasCancelled());
    expect(s.confirmed).toEqual([]);
  });
  it("prints the max caveat only while `max` is staged", async () => {
    const r = mountDialog({ level: "xhigh" });
    await tick();                                       // the provider's stdin subscription is passive
    expect(flat(r.lastFrame)).not.toContain(MAX_EFFORT_CAVEAT);
    r.stdin.write("\x1b[C");
    await waitFor(() => flat(r.lastFrame).includes(MAX_EFFORT_CAVEAT));
  });
  it("the unsupported branch names the model and refuses to step or confirm", async () => {
    const r = mountDialog({ supported: false, modelName: "Haiku 4.5" });
    await tick();
    expect(flat(r.lastFrame)).toContain(effortUnsupportedText("Haiku 4.5"));
    r.stdin.write("\x1b[C"); await tick();
    r.stdin.write("\r"); await tick();
    expect(r.confirmed).toEqual([]);
    r.stdin.write("\x1b");
    await waitFor(() => r.wasCancelled());
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// `/status` (EP-C6's acceptance reads the field there)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

describe("formatStatus", () => {
  it("carries the effort row, in the same 11-column gutter every other row uses", () => {
    const lines = formatStatus({ mode: "default", effort: "xhigh" }).map((l) => l.text);
    expect(lines).toContain("  effort     xhigh");
  });
  it("falls back to `default` when nothing has set one", () => {
    expect(formatStatus({ mode: "default" }).map((l) => l.text)).toContain("  effort     default");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// The REPL wiring: the hint, the dialog, and the `set_effort` wire op
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

/** fakeRemote() extended onto the SettingsOps surface (which is where `setEffort` lives) — the same
 *  extension shape `chat.test.tsx`'s `fakeSettingsRemote` uses, plus the effort spy this file needs. */
function fakeEffortRemote(effortCalls: string[], remoteOpts: FakeRemoteOpts = {}) {
  const base = fakeRemote(remoteOpts);
  return {
    ...base,
    getSettings: async () => ({}),
    listDirs: async () => [{ path: process.cwd(), source: "cwd" as const }],
    addDir: async () => {}, removeDir: async () => {},
    setOutputStyle: async () => {}, addRule: async () => {}, removeRule: async () => {},
    setEffort: async (level: string) => { effortCalls.push(level); },
  };
}

const EFFORT_CAPS = [
  { value: "opus", displayName: "Opus 5", description: "most capable", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "haiku", displayName: "Haiku 4.5", description: "fastest", supportsEffort: false },
];

function mountApp(opts: { effortCalls: string[]; store?: ReturnType<typeof createNotificationStore>; initialEffort?: string; initialModel?: string; capsGate?: Promise<void> }) {
  // `capsGate` HOLDS the catalog response open. It is the only way to observe the pre-catalog window at all:
  // `capabilities()` otherwise settles in a microtask, so the optimistic hint and its withdrawal both land
  // before a poll loop's first tick and the two halves of the documented divergence are indistinguishable.
  const fake = fakeEffortRemote(opts.effortCalls, { capabilities: async () => { await opts.capsGate; return { models: EFFORT_CAPS, commands: [], mcpServers: [] }; } });
  const r = renderWithKeymap(
    <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()}
      hookOpts={{ initialModel: opts.initialModel ?? "claude-opus-5", ...(opts.initialEffort ? { initialEffort: opts.initialEffort } : {}) }}
      deps={{ ...(opts.store ? { notifications: opts.store } : {}) }} />,
  );
  return { ...r, fake };
}

describe("the decaying hint (§C6.2)", () => {
  it("posts at mount with the LAUNCH effort, at priority `high` and 10 000 ms", async () => {
    const store = createNotificationStore();
    const r = mountApp({ effortCalls: [], store, initialEffort: "xhigh" });
    await waitFor(() => store.state().current?.key === EFFORT_HINT_KEY);
    expect(store.state().current).toMatchObject({ key: EFFORT_HINT_KEY, text: "◉ xhigh · /effort", priority: "high", timeoutMs: EFFORT_HINT_TIMEOUT_MS });
    expect(frame(r.lastFrame)).toContain("◉ xhigh · /effort");
  });

  it("RE-POSTS on every change — remove-then-add, so the ten seconds start again (L496126-134)", async () => {
    const store = createNotificationStore();
    const seen: string[] = [];
    store.subscribe(() => { seen.push(store.state().current?.text ?? "REMOVED"); });
    const r = mountApp({ effortCalls: [], store, initialEffort: "high" });
    await waitFor(() => store.state().current?.text === "● high · /effort");
    await runCommand(r, "/effort");
    await waitFor(() => frame(r.lastFrame).includes(EFFORT_DIALOG_FOOTER));
    r.stdin.write("\x1b[C");                                        // stage xhigh
    await waitFor(() => flat(r.lastFrame).includes("xHigh effort"));
    r.stdin.write("\r");                                            // confirm
    await waitFor(() => store.state().current?.text === "◉ xhigh · /effort");
    // The producer-side remove is OBSERVABLE, and that is the point of the assertion: the store passed
    // through empty between the two texts, which is upstream's `hp()`-then-`Nd()` and is what restarts the
    // clock on a store that would otherwise dedup the re-add.
    const at = seen.lastIndexOf("◉ xhigh · /effort");
    expect(seen.slice(0, at)).toContain("REMOVED");
    expect(store.state().current?.timeoutMs).toBe(EFFORT_HINT_TIMEOUT_MS);
  });

  // DIVERGENCE, pinned in both halves (useChat's `effortSupported` says why): upstream answers "does this
  // model have an effort axis" from a SYNCHRONOUS local registry (`Fk`, L76243) and so never posts the hint
  // for a model without one. ccx's only authority is the catalog, one round-trip away, so it posts
  // optimistically and WITHDRAWS. Both halves are asserted here rather than only the end state — the end
  // state alone would also pass if the hint had never been implemented at all.
  it("posts optimistically pre-catalog, then WITHDRAWS once the catalog says the model has no effort axis", async () => {
    const store = createNotificationStore();
    let release!: () => void;
    const capsGate = new Promise<void>((r) => { release = r; });
    mountApp({ effortCalls: [], store, initialEffort: "high", initialModel: "haiku", capsGate });
    await waitFor(() => store.state().current?.key === EFFORT_HINT_KEY);   // optimistic, pre-catalog
    release();
    await waitFor(() => store.state().current === null);                   // …and withdrawn once it lands
  });
});

describe("/effort", () => {
  it("opens the dialog — and the U1 redirect note is GONE", async () => {
    const r = mountApp({ effortCalls: [], initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort");
    try { await waitFor(() => frame(r.lastFrame).includes(EFFORT_DIALOG_FOOTER)); } catch (e) { console.log("DBG-F2", JSON.stringify(r.lastFrame())); throw e; }
    expect(frame(r.lastFrame)).not.toContain("effort maps to the thinking budget");
  });

  it("confirming fires the `set_effort` wire op with the staged level", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort");
    await waitFor(() => frame(r.lastFrame).includes(EFFORT_DIALOG_FOOTER));
    r.stdin.write("\x1b[C");
    await waitFor(() => flat(r.lastFrame).includes("xHigh effort"));
    r.stdin.write("\r");
    await waitFor(() => calls.length > 0);
    expect(calls).toEqual(["xhigh"]);
  });

  it("Esc fires NO wire op", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort");
    await waitFor(() => frame(r.lastFrame).includes(EFFORT_DIALOG_FOOTER));
    r.stdin.write("\x1b[C"); await waitFor(() => flat(r.lastFrame).includes("xHigh effort"));
    r.stdin.write("\x1b");
    await waitFor(() => !frame(r.lastFrame).includes(EFFORT_DIALOG_FOOTER));
    expect(calls).toEqual([]);
  });

  it("`/effort <level>` applies a level in the domain WITHOUT opening the dialog", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort low");
    await waitFor(() => calls.length > 0);
    expect(calls).toEqual(["low"]);
    expect(frame(r.lastFrame)).not.toContain(EFFORT_DIALOG_FOOTER);
  });

  it("an OUT-OF-DOMAIN level is refused client-side and NO wire op fires (probe 102: the SDK would take it silently)", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort bogus");
    await waitFor(() => frame(r.lastFrame).includes("unknown effort level"));
    expect(calls).toEqual([]);
    expect(flat(r.lastFrame)).toContain("try low/medium/high/xhigh/max");
  });
});
