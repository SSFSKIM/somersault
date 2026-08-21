// tui/test/effort.test.tsx — WAVE C TASK 11 (EP-C6): the effort surfaces. Canon is the grounding annex
// §C6.1 (glyphs), §C6.2 (the decaying hint), §C6.3 (the /model picker's effort row) and §C6.4 (the
// standalone dialog's footer); every literal below is a transcription and the bundle line sits on the
// assertion it produced. The MECHANISM half — `Query.applyFlagSettings({effortLevel})`, no `setEffort`, and
// NO SDK-side validation — is probe 102 (`waveC-grounding-probes.md` §(f)), which is why the wire tests
// below assert both that a valid level travels and that an out-of-domain one never reaches the wire at all.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
// ChatApp and every dialog under it read stdin through `<KeymapProvider>`, never `useInput` (F2 task 6) —
// rendered bare they have NO input path at all and `stdin.write` goes nowhere, silently.
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { EffortDialog } from "../../src/tui/EffortDialog.js";
import { createNotificationStore } from "../../src/tui/notifications.js";
import {
  EFFORT_ADJUST_HINT, EFFORT_DIALOG_FOOTER, EFFORT_HINT_KEY, EFFORT_HINT_TIMEOUT_MS, EFFORT_LEVELS,
  EFFORT_HELP_DESCRIPTIONS, EFFORT_STATUS_DESCRIPTIONS, MAX_EFFORT_CAVEAT, MODEL_FOOTER, effortGlyph,
  effortHint, effortRowText, effortTitle, effortUnsupportedText, isEffortLevel, isPersistableEffortLevel,
  stepEffort, type EffortLevel,
} from "../../src/tui/modelPickerModel.js";
import { formatStatus, formatEffortSet, formatEffortHelp, formatEffortCurrent } from "../../src/tui/commands.js";
import { LOCAL_OUTPUT_GUTTER } from "../../src/tui/species.js";
import { loadPrefs, savePrefs } from "../../src/tui/prefs.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 *  this file claims it prints. `formatEffortSet` is pinned against it in its own describe below. T-EFFORT:
 *  the suffix is now conditional on whether the level persists (`isPersistableEffortLevel`) — `persisted`
 *  is a required param, not a default, so a test forgetting to pass it fails loudly instead of silently
 *  asserting the wrong suffix. */
const EFFORT_SET_TEXT = (level: string, persisted: boolean) => `Set effort level to ${level}${persisted ? " (saved as your default for new sessions)" : " (this session only)"}`;
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

// W2 T5 fold (s2qa4-10), T-EFFORT (2026-08-21). Canon's row is `  ⎿  Set effort level to low (saved as your
// default for new sessions): Quick, straightforward implementation with minimal overhead`
// (frames-s2qa4/08-cc-effort-args). T-EFFORT retired the SCOPE divergence this comment used to carry — the
// suffix is no longer hardcoded, it reflects the SAME write `applyEffort` just made. The trailing `: <desc>`
// clause stays cut by choice, not by missing data (`rCb` exists and IS ported — see `formatEffortCurrent`,
// which owns it for `/effort current`|`status`); see `formatEffortSet`'s own doc comment in commands.ts.
describe("formatEffortSet — the /effort <level> result row (s2qa4-10)", () => {
  it("is one `⎿` local-output row naming the level, with the PERSISTED suffix when the level is persistable", () => {
    const [row] = formatEffortSet("low", true);
    expect(row!.text).toBe(EFFORT_SET_TEXT("low", true));
    expect(row!.text).toBe("Set effort level to low (saved as your default for new sessions)");
    expect(row!.gutter).toEqual({ text: LOCAL_OUTPUT_GUTTER, dim: true });
    expect(formatEffortSet("xhigh", true)[0]!.text).toBe(EFFORT_SET_TEXT("xhigh", true));   // the RAW level, as the wire spells it
  });
  // `max` is the one level canon's persistable filter excludes (`Qdt`) — its confirmation keeps the OLD
  // session-only suffix even though every other level now says it was saved.
  it("keeps the SESSION-ONLY suffix when persisted is false — max's own case", () => {
    expect(formatEffortSet("max", false)[0]!.text).toBe("Set effort level to max (this session only)");
  });
});

// T-EFFORT: `prefs.ts`'s ACTUAL file loader (not the `deps.loadPrefs` mock every other test in this file
// uses) — nothing else in the suite exercises its `effort` shape-validation branch, since `cli-main.test.ts`
// injects `loadPrefs` entirely. An isolated `CCX_FLEET_ROOT` per test, `reduced-motion.test.tsx`'s pattern.
describe("prefs.ts — the `effort` key's load/save round trip", () => {
  const roots: string[] = [];
  const tmpRoot = (): NodeJS.ProcessEnv => { const d = mkdtempSync(join(tmpdir(), "ccx-effort-prefs-")); roots.push(d); return { ...process.env, CCX_FLEET_ROOT: d }; };
  afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it("round-trips a valid level", () => {
    const env = tmpRoot();
    savePrefs({ effort: "xhigh" }, env);
    expect(loadPrefs(env).effort).toBe("xhigh");
  });
  it("drops a hand-edited value outside the EffortLevel shape, like theme/tui's own closed-set guard", () => {
    const env = tmpRoot();
    savePrefs({ effort: "xhigh" }, env);
    // Simulate hand-editing the file to something the domain never produces.
    savePrefs({ effort: "ultracode" as never }, env);
    expect(loadPrefs(env).effort).toBeUndefined();
  });
  it("a save does not disturb a neighbouring key — the shallow-merge contract every other pref relies on", () => {
    const env = tmpRoot();
    savePrefs({ theme: "dark" }, env);
    savePrefs({ effort: "low" }, env);
    const prefs = loadPrefs(env);
    expect(prefs.effort).toBe("low");
    expect(prefs.theme).toBe("dark");
  });
});

describe("isPersistableEffortLevel — canon's `Qdt` (106479-106483)", () => {
  it("admits low|medium|high|xhigh and excludes max", () => {
    expect(isPersistableEffortLevel("low")).toBe(true);
    expect(isPersistableEffortLevel("medium")).toBe(true);
    expect(isPersistableEffortLevel("high")).toBe(true);
    expect(isPersistableEffortLevel("xhigh")).toBe(true);
    expect(isPersistableEffortLevel("max")).toBe(false);
    expect(isPersistableEffortLevel("auto")).toBe(false);
    expect(isPersistableEffortLevel(undefined)).toBe(false);
  });
});

// T-EFFORT Arm 2. `k$i` (422910-422918): zero-indent bullets (the `⎿` gutter supplies ALL the visible
// indent — see `withLocalOutputGutter`'s comment in commands.ts), one blank line between the usage line and
// "Effort levels:", and `auto` listed last even though ccx's own parser refuses it (canon always lists it
// absent an org cap; ccx has none).
describe("formatEffortHelp — `/effort help` (canon's `k$i`, 422910-422918)", () => {
  // `Line.tsx` renders each `RenderLine`'s `gutter` independently (no shared flex column across an array of
  // lines — see `withLocalOutputGutter`'s comment), so continuation alignment has to be baked into the
  // TEXT as literal padding, exactly like `render.ts`'s `withAssistantBullet`/`withThinkingGutter` already
  // do for their own bullets. `unpad` strips that mechanism back off before comparing canon's actual words,
  // so this test is about the CONTENT; the second test below is about the padding mechanism itself.
  const pad = " ".repeat(LOCAL_OUTPUT_GUTTER.length);
  const unpad = (t: string) => (t.startsWith(pad) ? t.slice(pad.length) : t);

  it("is byte-exact for ccx's uncapped, ultracode-off domain", () => {
    const lines = formatEffortHelp().map((l, i) => (i === 0 ? l.text : unpad(l.text)));
    expect(lines[0]).toBe("Usage: /effort [low|medium|high|xhigh|max|auto]");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("Effort levels:");
    expect(lines[3]).toBe("- low: Quick, straightforward implementation");
    expect(lines[4]).toBe("- medium: Balanced approach with standard testing");
    expect(lines[5]).toBe("- high: Comprehensive implementation with extensive testing");
    expect(lines[6]).toBe("- xhigh: Extended reasoning with thorough analysis (Fable 5, Opus 4.7+, Sonnet 5)");
    expect(lines[7]).toBe("- max: Maximum capability with deepest reasoning (Fable 5, Opus 4.6+, Sonnet 4.6+)");
    expect(lines[8]).toBe("- auto: Use the default effort level for your model");
    expect(lines).toHaveLength(9);
  });
  it("carries the gutter ONLY on the first line, and pads every non-blank continuation to the gutter's width", () => {
    const rows = formatEffortHelp();
    expect(rows[0]!.gutter).toEqual({ text: LOCAL_OUTPUT_GUTTER, dim: true });
    for (const row of rows.slice(1)) expect(row.gutter).toBeUndefined();
    expect(rows[1]!.text).toBe("");                                            // the blank separator stays LITERALLY blank
    expect(rows[3]!.text).toBe(`${pad}- low: Quick, straightforward implementation`);
  });
});

// T-EFFORT Arm 2. `YXn` (422962-422973), minus canon's ultracode/CLI-pin branches. Pins ONE description
// string from EACH table (`_lT` here via `formatEffortHelp`'s own test above, `rCb` here) so the two can
// never silently collapse into one — `high`'s two sentences are close enough in shape that a copy-paste
// mistake reusing `_lT` for this arm would still look plausible on a skim.
describe("formatEffortCurrent — `/effort current`|`status` (canon's `YXn`, 422962-422973)", () => {
  it("names the level and reads the rCb table — a DIFFERENT sentence from the help block's for the SAME level", () => {
    const [row] = formatEffortCurrent("high", "xhigh");
    expect(row!.text).toBe("Current effort level: high (Comprehensive implementation with extensive testing and documentation)");
    expect(row!.gutter).toEqual({ text: LOCAL_OUTPUT_GUTTER, dim: true });
    // The two tables' `high` entries differ (one is even a near-prefix of the other, so a substring check
    // would pass by accident) — proof `formatEffortCurrent` is NOT reading `_lT`, by exact string identity.
    expect(EFFORT_STATUS_DESCRIPTIONS.high).not.toBe(EFFORT_HELP_DESCRIPTIONS.high);
    expect(row!.text).toBe(`Current effort level: high (${EFFORT_STATUS_DESCRIPTIONS.high})`);
    expect(row!.text).not.toBe(`Current effort level: high (${EFFORT_HELP_DESCRIPTIONS.high})`);
  });
  it("falls back to the harness default when no level is known yet — ccx's own 'auto' state", () => {
    const [row] = formatEffortCurrent(undefined, "xhigh");
    expect(row!.text).toBe("Effort level: auto (currently xhigh)");
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
  // W2 T5 FIX (review M2). The statusLine PAYLOAD has always been capability-gated — a model the catalog
  // said has no effort axis reports no effort block at all — and `/status` was not, so on haiku a script
  // printed nothing while the dialog printed a row. The gate is the same one, threaded in here. NB the two
  // absences stay distinct: no AXIS drops the row, no VALUE YET (`ccx attach`, which never learns a launch
  // level) keeps it with the `default` fallback above.
  it("drops the row entirely when the catalog says the model has no effort axis", () => {
    const lines = formatStatus({ mode: "default", effort: "high", effortSupported: false }).map((l) => l.text);
    expect(lines.some((t) => t.includes("effort"))).toBe(false);
    expect(lines).toContain("  thinking   default");                     // …and the rest of the block is untouched
    expect(formatStatus({ mode: "default", effort: "high", effortSupported: true }).map((l) => l.text)).toContain("  effort     high");
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
  // T-EFFORT: `applyEffort` now persists on every successful set — WITHOUT this injected `savePrefs`, every
  // `/effort`/picker/dialog test in this file would fall through to the REAL `savePrefs` and write to this
  // machine's actual `~/.claude/ccx/prefs.json`. `saves` is returned so persistence-specific tests can
  // assert on it; every other test gets a safe sink for free (`reduced-motion.test.tsx`'s exact pattern).
  const saves: Record<string, unknown>[] = [];
  const r = renderWithKeymap(
    <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()}
      hookOpts={{ initialModel: opts.initialModel ?? "claude-opus-5", ...(opts.initialEffort ? { initialEffort: opts.initialEffort } : {}) }}
      deps={{ ...(opts.store ? { notifications: opts.store } : {}), savePrefs: (patch) => { saves.push(patch); } }} />,
  );
  return { ...r, fake, saves };
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

  it("confirming fires the `set_effort` wire op with the staged level, persists it, and prints NO 'Cancelled'", async () => {
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
    // T-EFFORT Arm 1: the dialog's OWN Enter persists too — `confirmEffort` funnels through the same
    // `applyEffort` choke point a typed `/effort <level>` does (R2 §2.2's `Z5t`).
    await waitFor(() => r.saves.length > 0);
    expect(r.saves).toEqual([{ effort: "xhigh" }]);
    // T-EFFORT Arm 3, the trap's OTHER half: `closeEffortDialog` (which `confirmEffort` calls to dismiss
    // the dialog) must NOT print "Cancelled" — only the Esc path (`cancelEffortDialog`) may.
    await settle();
    expect(flat(r.lastFrame)).not.toContain("Cancelled");
  });

  it("Esc fires NO wire op, persists nothing, and prints `⎿ Cancelled`", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort");
    await waitFor(() => frame(r.lastFrame).includes(EFFORT_DIALOG_FOOTER));
    r.stdin.write("\x1b[C"); await waitFor(() => flat(r.lastFrame).includes("xHigh effort"));
    r.stdin.write("\x1b");
    await waitFor(() => !frame(r.lastFrame).includes(EFFORT_DIALOG_FOOTER));
    expect(calls).toEqual([]);
    // T-EFFORT Arm 3 — canon's single word (R2 §3.1), behind the SAME `⎿` gutter every other arm uses.
    await waitFor(() => flat(r.lastFrame).includes("Cancelled"));
    expect(flat(r.lastFrame)).toContain("⎿ Cancelled");
    await settle();
    expect(r.saves).toEqual([]);
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

  // T-EFFORT: the refusal copy is now canon's own `Invalid argument: … Valid options are: …` (`TlT`,
  // R2 §1.5), behind the `⎿` gutter like every other `/effort` arm — replacing ccx's old plain,
  // error-coloured "unknown effort level" line (which no longer exists anywhere in the source).
  it("an OUT-OF-DOMAIN level is refused client-side and NO wire op fires (probe 102: the SDK would take it silently)", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort bogus");
    await waitFor(() => flat(r.lastFrame).includes("Invalid argument"));
    expect(calls).toEqual([]);
    expect(flat(r.lastFrame)).toContain("Invalid argument: bogus. Valid options are: low, medium, high, xhigh, max, auto");
    expect(flat(r.lastFrame)).toContain("⎿ Invalid argument");   // through the local-output gutter, not a bare error line
    await settle();
    expect(r.saves).toEqual([]);
  });

  // T-EFFORT Arm 2 guard: canon's branch order is help → current/status → bare → level (R2 §1.1), and
  // ccx's dispatch had to be re-ordered to match — these three strings must never fall through to the
  // level parser and be refused as bogus levels the way "bogus" itself correctly is above.
  it("`help`/`current`/`status` are sub-verbs, never refused as out-of-domain levels", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort help");
    await waitFor(() => flat(r.lastFrame).includes("Effort levels:"));
    expect(flat(r.lastFrame)).not.toContain("Invalid argument");
    await runCommand(r, "/effort current");
    await waitFor(() => flat(r.lastFrame).includes("Current effort level"));
    await runCommand(r, "/effort status");
    await waitFor(() => (flat(r.lastFrame).match(/Current effort level/g)?.length ?? 0) >= 2);
    expect(calls).toEqual([]);                     // none of the three ever reached applyEffort
  });

  // W2 T5 fold (s2qa4-10): the argument form applied SILENTLY — once the ten-second chip expired, the
  // transcript recorded that a command was typed and not what it did.
  it("`/effort <level>` prints the ⎿ result row naming the level and its PERSISTED suffix, and a REFUSED level prints none", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort low");
    await waitFor(() => flat(r.lastFrame).includes(EFFORT_SET_TEXT("low", true)));
    expect(flat(r.lastFrame)).toContain(`⎿ ${EFFORT_SET_TEXT("low", true)}`);
    await waitFor(() => r.saves.length > 0);
    expect(r.saves).toEqual([{ effort: "low" }]);
    await runCommand(r, "/effort bogus");
    await waitFor(() => flat(r.lastFrame).includes("Invalid argument"));
    expect(flat(r.lastFrame)).not.toContain(EFFORT_SET_TEXT("bogus", true));
    expect(flat(r.lastFrame)).not.toContain(EFFORT_SET_TEXT("bogus", false));
    expect(r.saves).toEqual([{ effort: "low" }]);    // the refusal wrote nothing new
  });

  // T-EFFORT Arm 1: `max` is canon's own exclusion (`Qdt`) — it applies and confirms exactly like any other
  // level, but is the one case that still says "(this session only)" and writes nothing to prefs.
  it("`/effort max` applies and confirms, but does NOT persist — the one level `Qdt` excludes", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await runCommand(r, "/effort max");
    await waitFor(() => calls.length > 0);
    expect(calls).toEqual(["max"]);
    await waitFor(() => flat(r.lastFrame).includes(EFFORT_SET_TEXT("max", false)));
    expect(flat(r.lastFrame)).toContain("Set effort level to max (this session only)");
    await settle();
    expect(r.saves).toEqual([]);
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
    // W2 T5 FIX (review L4): the notice NAMES the level that rode out with the model (L471428-471429).
    // The chip decays in ten seconds; this row is the transcript's only lasting record of the change.
    expect(flat(r.lastFrame)).toContain("Set model to Opus 5 and saved as your default for new sessions with max effort");
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

  // W2 T5 FIX (review M1), the app-level repro of the component pin in `model-picker.test.tsx`: the arrows
  // move on a model that HAS the axis, the pick lands on one that does not, and nothing about effort may
  // leave the picker — no `set_effort` on the wire, and no effort clause in the notice.
  it("stepping on Opus and picking Haiku fires no wire op and names no effort in the notice", async () => {
    const calls: string[] = [];
    const r = mountApp({ effortCalls: calls, initialEffort: "high" });
    await openPickerAndStepTwice(r);
    r.stdin.write("\x1b[B");                                            // ↓ → Haiku 4.5
    await waitFor(() => flat(r.lastFrame).includes(effortUnsupportedText("Haiku 4.5")));
    r.stdin.write("\r");
    await waitFor(() => !flat(r.lastFrame).includes(MODEL_FOOTER));
    await settle();
    expect(calls).toEqual([]);
    expect(flat(r.lastFrame)).toContain("Set model to Haiku 4.5 and saved as your default for new sessions");
    // Not "the frame has no `effort` in it" — the §C6.2 hint is still on screen from the Opus mount. The
    // claim is about the NOTICE: no level rode out, so no clause was appended to it.
    expect(flat(r.lastFrame)).not.toContain("with max effort");
  });
});

// W2 T5 FIX (review M2) — `/status` reads the SAME capability gate the statusLine payload does. The two
// surfaces report one fact and must not be able to disagree about it.
describe("/status on a model with no effort axis (review M2)", () => {
  it("prints no effort row at all", async () => {
    const r = mountApp({ effortCalls: [], initialEffort: "high", initialModel: "haiku" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await settle();                                                     // let the catalog land
    await runCommand(r, "/status");
    await waitFor(() => flat(r.lastFrame).includes("thinking"));
    expect(flat(r.lastFrame)).not.toContain("effort");
  });

  it("…and still prints it on a model that has one", async () => {
    const r = mountApp({ effortCalls: [], initialEffort: "high", initialModel: "claude-opus-5" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await settle();
    await runCommand(r, "/status");
    await waitFor(() => flat(r.lastFrame).includes("effort high"));
  });

  // T-EFFORT's seeding hazard (R2 §4.7), VERIFIED rather than newly gated: `initialEffort` is now reachable
  // from a persisted prefs default (`cli/main.ts`'s `persistedEffort`), applied before the catalog round-trip
  // can confirm the model even HAS an effort axis (the same ordering problem canon itself has, and answers
  // downstream at the reporting surfaces rather than at seed time — R2 §4.7's closing paragraph). Once a
  // value reaches `opts.initialEffort` its origin (a `--effort` flag vs. a persisted default) is
  // indistinguishable to useChat, so THIS is the seeded case: both existing gates — the hint's
  // `effortCapsSettled` latch and `/status`'s `effortSupported !== false` check — must independently
  // suppress it on a non-supporting model. No new gate was added for T-EFFORT; this test is the proof
  // neither of the two pre-existing ones needed one.
  it("a SEEDED effort default on a non-supporting model is suppressed at BOTH reporting surfaces", async () => {
    const store = createNotificationStore();
    const r = mountApp({ effortCalls: [], store, initialEffort: "high", initialModel: "haiku" });
    await waitFor(() => frame(r.lastFrame).includes("❯"));
    await settle();                                                     // let the catalog land
    expect(store.state().current).toBeNull();                           // the hint latch suppressed it
    await runCommand(r, "/status");
    await waitFor(() => flat(r.lastFrame).includes("thinking"));
    expect(flat(r.lastFrame)).not.toContain("effort");                  // the status gate suppressed it too
  });
});
