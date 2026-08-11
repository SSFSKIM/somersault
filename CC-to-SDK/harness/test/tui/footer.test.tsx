// test/tui/footer.test.tsx — Wave C Task 2 (EP-C1b): the one-row footer that replaced `ChatStatusBar`.
// Three subjects, in the order the modules stack: `modeTable.ts` (upstream's six-mode table, annex §C4.c),
// `footerModel.ts` (the pure hint-list / crowd-out / agents logic, annex §C1.3-§C1.5) and `<Footer>` itself
// (the composed row, annex §C1.1-§C1.2).
//
// House idioms this file follows rather than inventing: `renderWithKeymap` for anything that reads the
// binding table (a bare render has no `<KeymapProvider>` and every chord would resolve to the defaults by
// a different path), `lastFrame()` + a local `plain()` ANSI strip, and no fake timers — the 2500 ms agents
// flash is a PURE function of an injected `now`, so time is a number here and never a scheduler.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { Footer } from "../../src/tui/Footer.js";
import { MODE_TABLE, modeIndicator, modeSymbol, modeColor, modeTitle } from "../../src/tui/modeTable.js";
import { agentsAffordance, buildHintList, hintText, suppressHint, AGENTS_FLASH_MS } from "../../src/tui/footerModel.js";
import { defaultLookup } from "../../src/tui/keys/hints.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";
import { Text } from "ink";
import { useChat } from "../../src/tui/useChat.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const tok = (name: "inactive" | "planMode" | "autoAccept" | "warning" | "error") => resolveThemeColor(themeTokens()[name]);
/** Every prop the component needs, at the HOME STATE — each test overrides the one field it is about. */
const home = {
  mode: "default", busy: false, draftNonEmpty: false, isInputEmpty: true, searching: false,
  statusLineConfigured: false, pasting: false, pasteExpandHint: false, bashMode: false,
  agents: { count: 0 }, bindings: defaultLookup, composerOwnsKeys: true,
} as const;
const frameOf = (props: Partial<React.ComponentProps<typeof Footer>> = {}): string =>
  plain(render(<Footer {...home} {...props} />).lastFrame());

describe("modeTable (annex §C4.c)", () => {
  it("carries upstream's six modes verbatim", () => {
    expect(Object.keys(MODE_TABLE)).toEqual(["default", "plan", "acceptEdits", "bypassPermissions", "dontAsk", "auto"]);
    expect(MODE_TABLE.default).toMatchObject({ title: "Manual", shortTitle: "Manual", indicator: "manual mode", symbol: "⏸", color: "inactive" });
    expect(MODE_TABLE.plan).toMatchObject({ title: "Plan", shortTitle: "Plan", indicator: "plan mode", symbol: "⏸", color: "planMode" });
    expect(MODE_TABLE.acceptEdits).toMatchObject({ title: "Accept edits", shortTitle: "Accept", indicator: "accept edits", symbol: "⏵⏵", color: "autoAccept" });
    expect(MODE_TABLE.bypassPermissions).toMatchObject({ title: "Bypass Permissions", shortTitle: "Bypass", indicator: "bypass permissions", symbol: "⏵⏵", color: "error" });
    expect(MODE_TABLE.dontAsk).toMatchObject({ title: "Don't Ask", shortTitle: "DontAsk", indicator: "don't ask", symbol: "⏵⏵", color: "error" });
    expect(MODE_TABLE.auto).toMatchObject({ title: "Auto", shortTitle: "Auto", indicator: "auto mode", symbol: "⏵⏵", color: "warning" });
  });
  it("falls back to `default` for an unknown mode (`n4r`, L41497)", () => {
    expect(modeIndicator("no-such-mode")).toBe("manual mode");
    expect(modeSymbol("no-such-mode")).toBe("⏸");
    expect(modeTitle("no-such-mode")).toBe("Manual");
    expect(modeColor("no-such-mode")).toBe(tok("inactive"));
  });
  it("resolves each mode's colour to its live theme token", () => {
    expect(modeColor("default")).toBe(tok("inactive"));
    expect(modeColor("plan")).toBe(tok("planMode"));
    expect(modeColor("acceptEdits")).toBe(tok("autoAccept"));
    expect(modeColor("auto")).toBe(tok("warning"));
    expect(modeColor("bypassPermissions")).toBe(tok("error"));
    expect(modeColor("dontAsk")).toBe(tok("error"));
  });
});

describe("footerModel.suppressHint (annex §C1.5)", () => {
  it("is upstream's `zqf = (draft non-empty) || isSearching || statusLineConfigured`", () => {
    expect(suppressHint({ draftNonEmpty: false, searching: false, statusLineConfigured: false })).toBe(false);
    expect(suppressHint({ draftNonEmpty: true, searching: false, statusLineConfigured: false })).toBe(true);
    expect(suppressHint({ draftNonEmpty: false, searching: true, statusLineConfigured: false })).toBe(true);
    expect(suppressHint({ draftNonEmpty: false, searching: false, statusLineConfigured: true })).toBe(true);
  });
});

describe("footerModel.agentsAffordance (annex §C1.4)", () => {
  const at = (o: Parameters<typeof agentsAffordance>[0], now = 0) => agentsAffordance(o, now)!;
  it("renders nothing with no background agents and no flash", () => {
    expect(at({ count: 0 })).toBeNull();
  });
  it("is the dim `← for agents` while agents exist and neither flash is live", () => {
    expect(hintText(at({ count: 3 }))).toBe("← for agents");
  });
  it("flashes `← N agents` while awaiting, pluralised, and expires after 2500 ms", () => {
    expect(hintText(at({ count: 2, awaiting: { count: 2, since: 0 } }, 0))).toBe("← 2 agents");
    expect(hintText(at({ count: 1, awaiting: { count: 1, since: 0 } }, 0))).toBe("← 1 agent");
    expect(hintText(at({ count: 2, awaiting: { count: 2, since: 0 } }, AGENTS_FLASH_MS - 1))).toBe("← 2 agents");
    expect(hintText(at({ count: 2, awaiting: { count: 2, since: 0 } }, AGENTS_FLASH_MS))).toBe("← for agents");
  });
  it("flashes `← N done`, and a done flash outranks a stale awaiting one", () => {
    expect(hintText(at({ count: 0, done: { count: 2, since: 100 } }, 200))).toBe("← 2 done");
    expect(hintText(at({ count: 2, awaiting: { count: 2, since: 0 }, done: { count: 1, since: 0 } }, 10))).toBe("← 1 done");
    expect(at({ count: 0, done: { count: 2, since: 100 } }, 100 + AGENTS_FLASH_MS)).toBeNull();   // flash over, no agents left
  });
  it("clamps a count over 99 to `99+`", () => {
    expect(hintText(at({ count: 120, awaiting: { count: 120, since: 0 } }, 0))).toBe("← 99+ agents");
  });
});

describe("footerModel.buildHintList (annex §C1.3)", () => {
  const base = { showHint: true, isInputEmpty: true, mode: "default", busy: false, interruptChord: "esc", agents: { count: 0 }, now: 0 };
  const keys = (o: Partial<typeof base>) => buildHintList({ ...base, ...o }).map((h) => h.key);
  it("home state is `? for shortcuts` alone", () => {
    expect(buildHintList(base).map(hintText)).toEqual(["? for shortcuts"]);
  });
  it("crowds `? for shortcuts` out the moment another hint exists (`G2.length === 0`)", () => {
    expect(buildHintList({ ...base, busy: true }).map(hintText)).toEqual(["esc to interrupt"]);
  });
  it("crowds `? for shortcuts` out on a NON-DEFAULT mode (`!(ttl && HRn)`)", () => {
    expect(keys({ mode: "plan" })).toEqual([]);
    expect(keys({ mode: "acceptEdits" })).toEqual([]);
  });
  it("keeps `← for agents` alongside `? for shortcuts` — the canonical home footer (§C4.c)", () => {
    expect(buildHintList({ ...base, agents: { count: 1 } }).map(hintText)).toEqual(["? for shortcuts", "← for agents"]);
  });
  it("kills every hint when showHint is false, and the agents affordance when the input is non-empty", () => {
    expect(keys({ showHint: false, agents: { count: 1 } })).toEqual(["fg-agents"]);
    expect(keys({ showHint: false, isInputEmpty: false, agents: { count: 1 } })).toEqual([]);
  });
});

describe("<Footer> — the composed row (annex §C1.1-§C1.2)", () => {
  it("home state: `⏸ manual mode on · ? for shortcuts`, with no cycle parenthetical", () => {
    const f = frameOf();
    expect(f).toContain("⏸ manual mode on");
    expect(f).toContain("? for shortcuts");
    expect(f).not.toContain("shift+tab to cycle");
  });
  it("adds the agents affordance when background agents exist", () => {
    expect(frameOf({ agents: { count: 2 } })).toContain("← for agents");
  });
  it("a non-default mode adds `(shift+tab to cycle)` and drops `? for shortcuts`", () => {
    const f = frameOf({ mode: "plan" });
    expect(f).toContain("⏸ plan mode on (shift+tab to cycle)");
    expect(f).not.toContain("? for shortcuts");
  });
  // WAVE C TASK 7 widened this from four modes to SIX and added the colour half below. Task 2 pinned the
  // table's colour TOKENS and the chip's TEXT, but never that the rendered chip actually wears its mode's
  // token — the frame those tests read is ANSI-stripped, so `<Text color={modeColor(mode)}>` could have been
  // `<Text>` and the whole suite would have stayed green.
  it("renders all SIX mode chips verbatim (annex §C4.c)", () => {
    expect(frameOf({ mode: "default" })).toContain("⏸ manual mode on");
    expect(frameOf({ mode: "plan" })).toContain("⏸ plan mode on");
    expect(frameOf({ mode: "acceptEdits" })).toContain("⏵⏵ accept edits on");
    expect(frameOf({ mode: "auto" })).toContain("⏵⏵ auto mode on");
    expect(frameOf({ mode: "bypassPermissions" })).toContain("⏵⏵ bypass permissions on");
    expect(frameOf({ mode: "dontAsk" })).toContain("⏵⏵ don't ask on");
  });
  it("paints all SIX chips in their own `$O` token — grey/plan/accept/warning/error/error", () => {
    // The token is `rgb(r,g,b)` and Ink paints it as a truecolor SGR (bg-dialog.test.tsx's `sgr` idiom); the
    // chip is the first thing on its row, so the row's opening escape IS the chip's colour.
    const sgr = (name: Parameters<typeof tok>[0]) => {
      const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(themeTokens()[name]);
      return `\x1b[38;2;${m![1]};${m![2]};${m![3]}m`;
    };
    const rawChipRow = (mode: string, needle: string) =>
      (render(<Footer {...home} mode={mode} />).lastFrame() ?? "").split("\n").find((l) => plain(l).includes(needle)) ?? "";
    expect(rawChipRow("default", "manual mode on")).toContain(`${sgr("inactive")}⏸`);
    expect(rawChipRow("plan", "plan mode on")).toContain(`${sgr("planMode")}⏸`);
    expect(rawChipRow("acceptEdits", "accept edits on")).toContain(`${sgr("autoAccept")}⏵⏵`);
    expect(rawChipRow("auto", "auto mode on")).toContain(`${sgr("warning")}⏵⏵`);
    expect(rawChipRow("bypassPermissions", "bypass permissions on")).toContain(`${sgr("error")}⏵⏵`);
    expect(rawChipRow("dontAsk", "don't ask on")).toContain(`${sgr("error")}⏵⏵`);
  });
  it("collapses to the mode chip ALONE while a draft is live (§C1.5)", () => {
    const f = frameOf({ draftNonEmpty: true, isInputEmpty: false, agents: { count: 2 } });
    expect(f).toContain("⏸ manual mode on");
    expect(f).not.toContain("? for shortcuts");
    expect(f).not.toContain("← for agents");
  });
  it("suppresses the hint list while searching and while a statusLine is configured", () => {
    expect(frameOf({ searching: true })).not.toContain("? for shortcuts");
    expect(frameOf({ statusLineConfigured: true })).not.toContain("? for shortcuts");
  });
  it("advertises no Chat chord while a dialog owns the keyboard, but keeps the chip", () => {
    const f = frameOf({ mode: "plan", composerOwnsKeys: false });
    expect(f).toContain("⏸ plan mode on");
    expect(f).not.toContain("shift+tab to cycle");
    expect(plain(render(<Footer {...home} composerOwnsKeys={false} />).lastFrame())).not.toContain("? for shortcuts");
  });

  it("the exit arm REPLACES the whole row, with the key coming in as a prop", () => {
    const f = frameOf({ exitArm: { key: "Ctrl-C", verb: "exit" } });
    expect(f).toContain("Press Ctrl-C again to exit");
    expect(f).not.toContain("manual mode on");
    expect(frameOf({ exitArm: { key: "Ctrl-D", verb: "exit" } })).toContain("Press Ctrl-D again to exit");
  });
  it("`Pasting…` replaces the whole row", () => {
    const f = frameOf({ pasting: true });
    expect(f).toContain("Pasting…");
    expect(f).not.toContain("manual mode on");
  });
  it("`paste again to expand` replaces the row — but never while searching (L493772)", () => {
    expect(frameOf({ pasteExpandHint: true })).toContain("paste again to expand");
    expect(frameOf({ pasteExpandHint: true, searching: true })).not.toContain("paste again to expand");
  });
  it("bash mode replaces the chip with `! for shell mode`", () => {
    const f = frameOf({ bashMode: true });
    expect(f).toContain("! for shell mode");
    expect(f).not.toContain("manual mode on");
  });

  it("draws the statusLine text on its own row ABOVE the footer row", () => {
    const lines = plain(render(<Footer {...home} statusLineConfigured statusLineText="~/repo (main)" />).lastFrame()).split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]).toContain("~/repo (main)");
    expect(lines[1]).toContain("manual mode on");
  });
  it("hides the statusLine row while the exit arm or a paste is up (L494626)", () => {
    expect(frameOf({ statusLineConfigured: true, statusLineText: "SL", exitArm: { key: "Ctrl-C", verb: "exit" } })).not.toContain("SL");
    expect(frameOf({ statusLineConfigured: true, statusLineText: "SL", pasting: true })).not.toContain("SL");
  });
  it("renders no statusLine row when nothing supplies the text", () => {
    expect(plain(render(<Footer {...home} statusLineConfigured />).lastFrame()).split("\n").filter((l) => l.trim() !== "")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WAVE C TASK 10 (EP-C2b): the statusLine row STOPS being a placeholder. Task 2 drew the slot with a
// bare `<Text wrap="truncate">`; this block pins what annex §C2.6 actually specifies — the script's own
// ANSI preserved with dim FORCED over every span, `m3f`'s carry-forward across lines, and the full
// five-term visibility guard (L494626). The frames here are read RAW: an ANSI-stripped frame cannot
// tell a dim row from a bright one, which is exactly the property under test.
const rawFrame = (props: Partial<React.ComponentProps<typeof Footer>> = {}): string =>
  (render(<Footer {...home} {...props} />).lastFrame() ?? "");
const DIM = "\x1b[2m";

describe("<Footer> statusLine row — colour (annex §C2.6, `wc`'s forced dim)", () => {
  it("paints an uncoloured script's output as plain DIM text", () => {
    const f = rawFrame({ statusLineConfigured: true, statusLineText: "~/repo (main)" });
    expect(f).toContain(`${DIM}~/repo (main)`);
  });
  // NB Ink RE-EMITS the escapes rather than passing our bytes through — its frame writer runs every line
  // through `slice-ansi`, which tracks the open attributes and prints the minimal delta. So the exact byte
  // string this component hands Ink is pinned in test/unit/statusline.test.ts (on `statusLineRows`), and
  // what is asserted HERE is the property that survives that rewrite: which cells end up dim.
  it("keeps the script's own colour AND forces dim back on over it", () => {
    const row = (rawFrame({ statusLineConfigured: true, statusLineText: "\x1b[32mok\x1b[0m done" }).split("\n"))[0];
    expect(row).toContain(`\x1b[32m${DIM}ok`);        // the span keeps its green and gains dim
    // The script's own `\x1b[0m` would have ended a chalk-applied dim for good. Here the only dim CLOSE on
    // the row is after the last character, so ` done` — everything past that reset — is still dim.
    expect(row.indexOf("\x1b[22m")).toBeGreaterThan(row.indexOf("done"));
  });
  it("replays an earlier line's SGR onto the next one (`m3f`), and draws one row per line", () => {
    const f = render(<Footer {...home} statusLineConfigured statusLineText={"\x1b[31mtop\nbottom"} />).lastFrame() ?? "";
    const rows = f.split("\n").filter((l) => plain(l).trim() !== "");
    expect(plain(rows[0])).toContain("top");
    expect(plain(rows[1])).toContain("bottom");
    expect(rows[1]).toContain(`\x1b[31m${DIM}bottom`);
    expect(plain(rows[2])).toContain("manual mode on");     // the footer row stays last
  });
  it("indents the slot by `padding` on both sides (`paddingX = padding ?? 0`)", () => {
    const at = (padding?: number) => {
      const f = plain(render(<Footer {...home} statusLineConfigured statusLinePadding={padding} statusLineText="SL" />).lastFrame() ?? "");
      return (f.split("\n").find((l) => l.includes("SL")) ?? "").indexOf("SL");
    };
    expect(at(3) - at(0)).toBe(3);          // the outer footer's own paddingLeft={2} is common to both
  });
});

describe("<Footer> statusLine row — the visibility guard (annex §C2.6, L494626)", () => {
  const shows = (props: Partial<React.ComponentProps<typeof Footer>>) =>
    plain(render(<Footer {...home} statusLineConfigured statusLineText="SL" {...props} />).lastFrame()).includes("SL");
  it("draws under the home state", () => { expect(shows({})).toBe(true); });
  it("is hidden in BASH mode — upstream's `mode === \"prompt\"` term", () => { expect(shows({ bashMode: true })).toBe(false); });
  it("is hidden while the exit arm is up and while a paste is in flight", () => {
    expect(shows({ exitArm: { key: "Ctrl-C", verb: "exit" } })).toBe(false);
    expect(shows({ pasting: true })).toBe(false);
  });
  it("is hidden in a pane shorter than 15 rows (`Rtl`, `nVf = 15`)", () => {
    expect(shows({ rows: 14 })).toBe(false);
    expect(shows({ rows: 15 })).toBe(true);
  });
  it("is hidden when no statusLine is configured, whatever text is handed in", () => {
    expect(plain(render(<Footer {...home} statusLineConfigured={false} statusLineText="SL" />).lastFrame())).not.toContain("SL");
  });
  it("survives the `suppressHint` it causes: the row draws and `? for shortcuts` is gone", () => {
    const f = plain(render(<Footer {...home} statusLineConfigured statusLineText="SL" />).lastFrame());
    expect(f).toContain("SL");
    expect(f).not.toContain("? for shortcuts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WAVE C TASK 10 — the driver WIRED. The two blocks above prove the row renders what it is handed;
// this one proves something hands it anything at all. No spawn and no wall clock: the runner is a
// fake (so the "command" never reaches a shell) and the 300 ms debounce runs on an injected clock,
// the same discipline test/unit/statusline.test.ts holds the driver itself to.
function slClock() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    deps: {
      setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (h: unknown) => { timers.delete(h as number); },
    },
    pending: () => timers.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { timers.delete(id); t.fn(); }
    },
  };
}
const waitFor = async (cond: () => boolean, timeout = 2000) => {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
};

/** W2 T6 — the boot run goes through the 300 ms window now (see `StatusLineDriver.mountRun`), and ccx's
 *  boot is a handful of promises landing a tick apart, so "the boot has settled" is a few pumped windows
 *  rather than one. Pumping the INJECTED clock keeps these tests off the wall clock exactly as before. */
async function settleBoot(clock: { advance(ms: number): void }): Promise<void> {
  for (let i = 0; i < 5; i++) { clock.advance(300); await new Promise((r) => setTimeout(r, 10)); }
}

describe("useChat drives the statusLine (annex §C2.4's triggers, over ccx's own deltas)", () => {
  // W2 T6 retitled and re-shaped this cell: the mount run is DEBOUNCED now (it used to be immediate, which
  // is what made a boot cost two runs), so the first text appears one window in rather than at once.
  it("runs ONCE for the whole boot, publishes the text, and re-runs 300 ms after a thinking delta", async () => {
    const fake = fakeRemote({ getContextUsage: () => ({ totalTokens: 4000, maxTokens: 200_000 }) });
    const clock = slClock(), runs: string[] = [];
    const api: { setThink?: (l: string) => Promise<void> } = {};
    function SLHost() {
      const c = useChat(() => fake, { cwd: "/repo", statusLine: { type: "command", command: "my-status" }, initialModel: "claude-opus-4-6" },
        { home: "/fake-home", statusLine: { runStatusLine: (_c, payload) => { runs.push(payload); return Promise.resolve(`SL#${runs.length}`); }, ...clock.deps } });
      api.setThink = c.setThink;
      return <Text>[{c.state.statusLineText ?? "-"}]</Text>;
    }
    const { lastFrame } = render(<SLHost />);
    await settleBoot(clock);
    await waitFor(() => (lastFrame() ?? "").includes("[SL#1]"));
    expect(runs).toHaveLength(1);                    // the whole boot, coalesced (was: mount run + correction)
    const payload = JSON.parse(runs[0]);
    expect(payload).toMatchObject({ cwd: "/repo", model: { id: "claude-opus-4-6" }, thinking: { enabled: true }, workspace: { current_dir: "/repo" } });
    expect("effort" in payload).toBe(false);
    // D-W8: the mount-time `getContextUsage()` means the BOOT payload already carries a real window, where
    // it used to carry `context_window_size: 0` with both percentages null until the first turn ended.
    expect(payload.context_window).toMatchObject({ context_window_size: 200_000, total_input_tokens: 4000, used_percentage: 2 });

    await api.setThink!("off");
    // The poke rides a React EFFECT (upstream's own delta list, not a per-setter call), so the debounce is
    // armed a commit after the setter returns — wait for the timer to exist rather than for a wall clock.
    await waitFor(() => clock.pending() > 0);
    expect(runs).toHaveLength(1);                    // armed, still inside the 300 ms window
    clock.advance(300);
    await waitFor(() => (lastFrame() ?? "").includes("[SL#2]"));
    expect(JSON.parse(runs[1])).toMatchObject({ thinking: { enabled: false } });
  });

  // WAVE C FINAL REVIEW, finding 2 — the payload's `cost` / `context_window` blocks are fed by two REFS the
  // turn-end refreshers write, and `/clear` swaps the engine underneath them. `replaceDocument` reset the
  // rendered `ctxPct` but not these, so the very next run — a `/config` flip, the refresh poll, anything —
  // carried the NEW session identity with the OLD conversation's dollars and tokens. Wave S's rule, on the
  // boundary Wave S named: a measurement dies with the conversation it measured.
  it("drops the cleared conversation's cost and context from the payload, and repaints at the boundary (final review, finding 2)", async () => {
    const usage = { session: { total_cost_usd: 4.25, total_duration_ms: 9000, total_api_duration_ms: 8000, total_lines_added: 3, total_lines_removed: 1, model_usage: { "claude-opus-4-6": { inputTokens: 900, outputTokens: 120 } } } };
    const fake = fakeRemote({ getContextUsage: () => ({ totalTokens: 4000, maxTokens: 200_000 }), usage: () => usage });
    const clock = slClock(), runs: string[] = [];
    const api: { run?: (t: string) => void } = {};
    function SLHost() {
      const c = useChat(() => fake, { cwd: "/repo", statusLine: { type: "command", command: "my-status" }, initialModel: "claude-opus-4-6" },
        // `getSessionInfo` is injected for the reason every keyless tui test injects it: the turn below
        // triggers the ai-title read, and the real one would open the developer's own ~/.claude.
        { home: "/fake-home", getSessionInfo: async () => ({}) as any, statusLine: { runStatusLine: (_c, payload) => { runs.push(payload); return Promise.resolve(`SL#${runs.length}`); }, ...clock.deps } });
      api.run = c.submit;
      return <Text>[{c.state.statusLineText ?? "-"}]</Text>;
    }
    // The refreshers are two independent fire-and-forget awaits and the driver debounces every poke, so
    // "how many 300 ms windows until the reading lands" is not something a test should hard-code: pump the
    // injected clock until the condition holds instead.
    const pumpUntil = async (cond: () => boolean, timeout = 2000) => {
      const start = Date.now();
      for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("pumpUntil timeout"); clock.advance(300); await new Promise((r) => setTimeout(r, 5)); }
    };
    const { unmount } = render(<SLHost />);
    try {
      await settleBoot(clock);
      await waitFor(() => runs.length === 1);                    // the boot, as one run

      api.run!("hello");                                          // one whole turn → both refreshers land + poke
      await pumpUntil(() => runs.some((p) => JSON.parse(p).cost.total_cost_usd === 4.25));
      const measured = JSON.parse(runs[runs.length - 1]);
      expect(measured.cost.total_cost_usd).toBe(4.25);
      expect(measured.context_window).toMatchObject({ total_input_tokens: 4000, context_window_size: 200_000, used_percentage: 2 });

      const before = runs.length;
      api.run!("/clear");
      // HALF ONE: the boundary itself pokes, so an idle statusLine repaints instead of sitting on the old
      // numbers until some unrelated delta happens along.
      await pumpUntil(() => runs.length > before);
      // HALF TWO: and what it repaints with carries nothing the cleared conversation measured.
      const after = JSON.parse(runs[runs.length - 1]);
      expect(after.cost).toEqual({ total_cost_usd: 0, total_duration_ms: 0, total_api_duration_ms: 0, total_lines_added: 0, total_lines_removed: 0 });
      expect(after.context_window).toMatchObject({ total_input_tokens: 0, context_window_size: 0, current_usage: null, used_percentage: null, remaining_percentage: null });
    } finally { unmount(); }
  });
});
