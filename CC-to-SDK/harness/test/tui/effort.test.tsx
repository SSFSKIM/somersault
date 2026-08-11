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
  MAX_EFFORT_CAVEAT, MODEL_FOOTER, effortGlyph, effortHint, effortRowText, effortTitle, effortUnsupportedText,
  isEffortLevel, stepEffort, type EffortLevel,
} from "../../src/tui/modelPickerModel.js";
import { formatStatus, formatEffortSet } from "../../src/tui/commands.js";
import { LOCAL_OUTPUT_GUTTER } from "../../src/tui/species.js";
// The other two spellings of the same domain. `modelPickerModel.ts` says this file pins all three equal, so
// this file has to actually SEE all three: the tui may not import config at runtime (that boundary is the
// whole reason the literal is written out three times), but a test is not bound by it.
import { EFFORT_LEVELS as ARGS_EFFORT_LEVELS } from "../../src/cli/args.js";
import { harnessConfigSchema } from "../../src/config/validate.js";

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
/** A bounded quiet period for the ABSENCE assertions below. `waitFor` can only prove something happened;
 *  proving nothing did needs a window generous enough for the thing to have happened — the hint's own path
 *  is a resolved promise plus a state commit plus an effect, which is microtasks, so ~20 macrotask turns is
 *  orders of magnitude of headroom and still costs a few milliseconds. */
async function settle(turns = 20) { for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 1)); }
/** The fold's own sentence, written out here rather than imported, so the formatter cannot redefine what
 *  this file claims it prints. `formatEffortSet` is pinned against it in its own describe below. */
const EFFORT_SET_TEXT = (level: string) => `Set effort level to ${level} (this session only)`;
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

// THE CROSS-BOUNDARY PIN `modelPickerModel.ts` promises. The five levels are written out three times — the
// tui's ordered array (which the picker steps through), `cli/args.ts`'s object domain (which `--effort`
// checks with `Object.hasOwn`) and `config/validate.ts`'s zod enum (which the config file is parsed against)
// — because the tui and config halves may not import one another. Nothing in the type system connects them,
// so a level added to one and forgotten in the other two would ship: `--effort ultracode` accepted at launch
// and refused by `/effort`, or the reverse. This is the only thing that notices.
describe("the effort domain, across all three of its spellings", () => {
  it("the tui array, the `--effort` flag domain and the config enum are the same five levels", () => {
    const configLevels = harnessConfigSchema.shape.effort.unwrap().options;
    expect([...EFFORT_LEVELS]).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // Sets, not arrays, for the two that carry no order: only the tui's copy is ordered (the picker steps
    // through it left-to-right), and asserting order on the others would pin something they don't mean.
    expect(new Set(Object.keys(ARGS_EFFORT_LEVELS))).toEqual(new Set(EFFORT_LEVELS));
    expect(new Set(configLevels)).toEqual(new Set(EFFORT_LEVELS));
    // …and the tui's runtime gate agrees with all three, in both directions.
    for (const l of [...Object.keys(ARGS_EFFORT_LEVELS), ...configLevels]) expect(isEffortLevel(l)).toBe(true);
    expect(isEffortLevel("ultracode")).toBe(false);      // upstream has it; ccx does not — see `commands.ts`
    expect(isEffortLevel("auto")).toBe(false);
  });
});

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

// W2 T5 fold (s2qa4-10). Canon's row is `  ⎿  Set effort level to low (saved as your default for new
// sessions): Quick, straightforward implementation with minimal overhead` (frames-s2qa4/08-cc-effort-args).
// Ours keeps the gutter and the level and diverges on the two clauses it cannot honestly print: ccx's
// `/effort` writes NO default (`EffortDialog`'s own subtitle says "This session only"), and ccx has no
// per-level description table at all — the ones in the frame are 2.1.226 copy for a seven-level domain that
// includes `ultracode`/`auto`, which ccx does not have (see the domain describe at the top of this file).
describe("formatEffortSet — the /effort <level> result row (s2qa4-10)", () => {
  it("is one `⎿` local-output row naming the level and its scope", () => {
    const [row] = formatEffortSet("low");
    expect(row!.text).toBe("Set effort level to low (this session only)");
    expect(row!.gutter).toEqual({ text: LOCAL_OUTPUT_GUTTER, dim: true });
    expect(formatEffortSet("xhigh")[0]!.text).toBe(EFFORT_SET_TEXT("xhigh"));   // the RAW level, as the wire spells it
  });
});

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

// W2 T5: the Haiku row carries NO `supportsEffort` key, which is what the LIVE catalog returns (probe 103 —
// every other model's entry has `supportsEffort: true` plus `supportedEffortLevels`; haiku omits both). The
// old fixture spelled it `false`, a value the catalog never sends, which is why the suite stayed green while
// the shipped surface treated Haiku as an effort model.
const EFFORT_CAPS = [
  { value: "opus", displayName: "Opus 5", description: "most capable", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "haiku", displayName: "Haiku 4.5", description: "fastest" },
];

function mountApp(opts: { effortCalls: string[]; store?: ReturnType<typeof createNotificationStore>; initialEffort?: string; initialModel?: string; capsGate?: Promise<void>; capsFail?: boolean }) {
  // `capsGate` HOLDS the catalog response open. It is the only way to observe the PRE-catalog window at all:
  // `capabilities()` otherwise settles in a microtask, so "no hint yet" and "hint posted" both land before a
  // poll loop's first tick and the gate the hint waits on would be indistinguishable from no gate.
  // `capsFail` makes the same call REJECT, which is the other half of the settled latch — a session whose
  // catalog never answers still gets its hint, because unknown-support is not the same as no-support.
  const fake = fakeEffortRemote(opts.effortCalls, { capabilities: async () => { await opts.capsGate; if (opts.capsFail) throw new Error("catalog unavailable"); return { models: EFFORT_CAPS, commands: [], mcpServers: [] }; } });
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

  // ── THE CATALOG GATE. Upstream answers "does this model have an effort axis" from a SYNCHRONOUS local
  // registry (`Fk`, L76243), so it never posts the hint for a model without one — not for a single frame.
  // ccx's only authority is `capabilities()`, one round-trip away, so it WAITS for that call to settle
  // before posting anything. Three branches, and all three are pinned because each one alone would pass
  // against a wrong implementation: post-when-supported alone passes if the gate were missing entirely,
  // never-post-when-unsupported alone passes if the hint were never built, and post-when-the-catalog-fails
  // is the branch that keeps the gate from turning a broken catalog into a permanently silent hint.
  it("posts NOTHING until the catalog settles, then posts once it says the model HAS an effort axis", async () => {
    const store = createNotificationStore();
    let release!: () => void;
    const capsGate = new Promise<void>((r) => { release = r; });
    mountApp({ effortCalls: [], store, initialEffort: "high", initialModel: "claude-opus-5", capsGate });
    await settle();
    expect(store.state().current).toBeNull();                              // gated: the catalog has not answered
    release();
    await waitFor(() => store.state().current?.key === EFFORT_HINT_KEY);   // …and posts when it does
    expect(store.state().current?.text).toBe("● high · /effort");
  });

  it("NEVER posts on a model the catalog says has no effort axis — no wrong-hint frame at all", async () => {
    const store = createNotificationStore();
    const seen: (string | null)[] = [];
    store.subscribe(() => { seen.push(store.state().current?.text ?? null); });
    let release!: () => void;
    const capsGate = new Promise<void>((r) => { release = r; });
    mountApp({ effortCalls: [], store, initialEffort: "high", initialModel: "haiku", capsGate });
    await settle();
    release();
    await settle();
    // Not just "null at the end" — nothing was ever pushed. A post-then-withdraw would leave its text here.
    expect(seen.filter((t) => t !== null)).toEqual([]);
    expect(store.state().current).toBeNull();
  });

  it("posts when the catalog FAILS — an unanswerable capability is unknown support, not absent support", async () => {
    const store = createNotificationStore();
    mountApp({ effortCalls: [], store, initialEffort: "high", initialModel: "claude-opus-5", capsFail: true });
    await waitFor(() => store.state().current?.key === EFFORT_HINT_KEY);
    expect(store.state().current?.text).toBe("● high · /effort");
  });
});

describe("/effort", () => {
  it("opens the dialog — and the U1 redirect note is GONE", async () => {
    const r = mountApp({ effortCalls: [], initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort");
    await waitFor(() => frame(r.lastFrame).includes(EFFORT_DIALOG_FOOTER));
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

  // W2 T5 fold (s2qa4-10): the argument form applied SILENTLY — once the ten-second chip expired, the
  // transcript recorded that a command was typed and not what it did.
  it("`/effort <level>` prints the ⎿ result row naming the level, and a REFUSED level prints none", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort low");
    await waitFor(() => flat(r.lastFrame).includes(EFFORT_SET_TEXT("low")));
    expect(flat(r.lastFrame)).toContain(`⎿ ${EFFORT_SET_TEXT("low")}`);
    await runCommand(r, "/effort bogus");
    await waitFor(() => frame(r.lastFrame).includes("unknown effort level"));
    expect(flat(r.lastFrame)).not.toContain(EFFORT_SET_TEXT("bogus"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// W2 T5 (s2qa4-05) — the `/model` picker's effort row is a TRANSACTION, at the REPL level: what the wire
// sees, and what `/status` says afterwards. The component-level pins live in `model-picker.test.tsx`; these
// two are the finding's own repro, which is an app-level one (`/model`, arrows, Esc, `/status`).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

describe("the /model picker's effort row (s2qa4-05)", () => {
  async function openPickerAndStepTwice(r: ReturnType<typeof mountApp>) {
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/model");
    await waitFor(() => flat(r.lastFrame).includes(MODEL_FOOTER));
    await tick();
    r.stdin.write("\x1b[C"); await waitFor(() => flat(r.lastFrame).includes("xHigh effort"));
    r.stdin.write("\x1b[C"); await waitFor(() => flat(r.lastFrame).includes("Max effort"));
  }

  it("Esc discards the stepped level: no wire op, and /status still reports the level the session had", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await openPickerAndStepTwice(r);
    r.stdin.write("\x1b");
    await waitFor(() => !flat(r.lastFrame).includes(MODEL_FOOTER));
    await settle();
    expect(calls).toEqual([]);
    await runCommand(r, "/status");
    await waitFor(() => flat(r.lastFrame).includes("effort high"));
    expect(flat(r.lastFrame)).not.toContain("effort max");
  });

  it("Enter commits it once, and /status reports the level the last arrow left", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await openPickerAndStepTwice(r);
    r.stdin.write("\r");
    await waitFor(() => calls.length > 0);
    await settle();
    expect(calls).toEqual(["max"]);
    await runCommand(r, "/status");
    await waitFor(() => flat(r.lastFrame).includes("effort max"));
  });

  it("the cursor on Haiku locks the row — the live catalog omits `supportsEffort` and absence means absent", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/model");
    await waitFor(() => flat(r.lastFrame).includes(MODEL_FOOTER));
    await tick();
    r.stdin.write("\x1b[B");                                            // ↓ → Haiku 4.5
    await waitFor(() => flat(r.lastFrame).includes(effortUnsupportedText("Haiku 4.5")));
    expect(flat(r.lastFrame)).not.toContain(EFFORT_ADJUST_HINT);
    r.stdin.write("\x1b[D"); r.stdin.write("\x1b[D");                   // ←← : inert
    await settle();
    expect(flat(r.lastFrame)).toContain(effortUnsupportedText("Haiku 4.5"));
    r.stdin.write("\r");
    await waitFor(() => !flat(r.lastFrame).includes(MODEL_FOOTER));
    expect(calls).toEqual([]);
  });
});
