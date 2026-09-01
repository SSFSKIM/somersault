// test/tui/help-dialog.test.tsx — F6 T14 (DG62): `/help`'s tabbed dialog. What is pinned here is upstream's
// own copy (`RNa` L459684-759 / `pei` L459650-682), the three tabs, the browser over the LIVE catalog, the two
// conditional footers, and the two seams that make this a dialog rather than a printed list: `/help` opens it
// and dismissing it leaves "Help dialog dismissed" in the transcript.
//
// The `?` overlay and this dialog render the SAME grid component, so the grid's own behaviour is not re-tested
// here (shortcuts-grid.test.tsx owns it) — only that both surfaces really do print it.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import {
  HelpDialog, HELP_INTRO, HELP_DOCS_URL, HELP_DOCS_LABEL, HELP_FEEDBACK_LINE, HELP_TALL_ROWS,
  BROWSE_DEFAULT_TITLE, BROWSE_CUSTOM_TITLE, NO_CUSTOM_COMMANDS, browserOptions, splitCommands, showsFeedbackLine,
} from "../../src/tui/HelpDialog.js";
import { withModSep, formatBindingLower } from "../../src/tui/keys/hints.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

const frame = (f: () => string | undefined) => f() ?? "";
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const unwrapped = (s: string): string => stripAnsi(s).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ");
const flat = (f: () => string | undefined) => unwrapped(frame(f));
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const settle = () => new Promise((r) => setTimeout(r, 30));

const CATALOG: CommandEntry[] = [
  { name: "compact", description: "summarize the conversation", source: "local" },
  { name: "agents", description: "manage subagents", source: "catalog" },
  { name: "brainstorm", description: "explore a design", source: "catalog" },
];

describe("<HelpDialog> — the tabs and their copy", () => {
  it("opens on General with upstream's pitch, the Shortcuts heading and the grid", async () => {
    const { lastFrame } = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />);
    await waitFor(() => flat(lastFrame).includes("Help"));
    const f = flat(lastFrame);
    expect(f).toContain(HELP_INTRO);
    expect(f).toContain("Shortcuts");
    expect(f).toContain("! for shell mode");                  // the same `ShortcutsGrid` the `?` overlay draws
    expect(f).toContain("ctrl + t to toggle tasks");
    expect(f).toContain("General");
    expect(f).toContain("Commands");
    expect(f).toContain("Custom commands");
  });

  it("Tab moves to the Commands browser, which lists the LIVE catalog under upstream's title", async () => {
    const { stdin, lastFrame } = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />);
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    stdin.write("\t");
    await waitFor(() => flat(lastFrame).includes(BROWSE_DEFAULT_TITLE));
    const f = flat(lastFrame);
    expect(f).toContain("/agents");
    expect(f).toContain("/brainstorm");
    expect(f).toContain("/compact");
    expect(f).toContain("summarize the conversation");
    expect(f).not.toContain(HELP_INTRO);                      // the General panel is gone, not stacked
  });

  it("`/` filters the browser against the live catalog, and Esc clears the query without closing", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<HelpDialog commands={CATALOG} onClose={() => { closed++; }} rows={40} columns={100} />);
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    stdin.write("\t");
    await waitFor(() => flat(lastFrame).includes(BROWSE_DEFAULT_TITLE));
    stdin.write("/");
    await waitFor(() => flat(lastFrame).includes("Search commands"));
    stdin.write("brain");
    await waitFor(() => !flat(lastFrame).includes("/compact"));
    expect(flat(lastFrame)).toContain("/brainstorm");
    stdin.write("\x1b");                                      // Esc leaves the query, not the dialog
    await waitFor(() => flat(lastFrame).includes("/compact"));
    expect(closed).toBe(0);
  });

  // FSW BACKLOG 2: `/help` renders the SAME grid as the `?` overlay, so it inherits the alternate-screen-only
  // rows — but only when the alternate screen is what mounted it. ChatApp threads its own renderer mode into
  // the `fullscreen` prop; unpinned, a wiring slip would either hide the row from `/help` or promise a key the
  // classic tree does not own.
  it("prints the alternate-screen-only rows only when the alternate screen is mounting it", async () => {
    const general = async (fullscreen: boolean) => {
      const r = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} fullscreen={fullscreen} />);
      await waitFor(() => flat(r.lastFrame).includes(HELP_INTRO));
      const out = flat(r.lastFrame);
      r.unmount();
      return out;
    };
    expect(await general(true)).toContain("v to open in $EDITOR when scrolled");
    expect(await general(false)).not.toContain("to open in $EDITOR when scrolled");
  });

  it("Custom commands shows upstream's empty state — the SDK catalog carries nothing that can be classed custom", async () => {
    const { stdin, lastFrame } = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />);
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    stdin.write("\t"); await waitFor(() => flat(lastFrame).includes(BROWSE_DEFAULT_TITLE));
    stdin.write("\t"); await waitFor(() => flat(lastFrame).includes(NO_CUSTOM_COMMANDS));
    expect(flat(lastFrame)).not.toContain(BROWSE_CUSTOM_TITLE);   // the title is replaced by the empty state
    expect(splitCommands(CATALOG).custom).toEqual([]);
    expect(splitCommands(CATALOG).defaults).toHaveLength(3);
  });
});

describe("<HelpDialog> — the footers", () => {
  it("always offers the docs link; the /feedback line needs BOTH 44 rows and a catalog that has the command", async () => {
    // The height gate is upstream's (L459766). The catalog gate is OURS — `/feedback` is upstream's own
    // client command and ccx does not implement it, so the sentence may only appear when the live engine
    // really reports one (T14 review ruling; the `/powerup` rule applied consistently). Probe 73's audit says
    // today's catalog does NOT carry it, so in the product the line is simply absent.
    const withFeedback: CommandEntry[] = [...CATALOG, { name: "feedback", description: "report a bug", source: "catalog" }];

    const short = render(<HelpDialog commands={withFeedback} onClose={() => {}} rows={HELP_TALL_ROWS - 1} columns={100} />);
    await waitFor(() => flat(short.lastFrame).includes(HELP_DOCS_URL));
    expect(flat(short.lastFrame)).toContain(`${HELP_DOCS_LABEL} ${HELP_DOCS_URL}`);
    expect(flat(short.lastFrame)).not.toContain(HELP_FEEDBACK_LINE);      // tall enough? no
    short.unmount();

    const noCommand = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={HELP_TALL_ROWS} columns={100} />);
    await waitFor(() => flat(noCommand.lastFrame).includes(HELP_DOCS_URL));
    expect(flat(noCommand.lastFrame)).not.toContain(HELP_FEEDBACK_LINE);   // command exists? no
    expect(flat(noCommand.lastFrame)).not.toContain("/feedback");
    noCommand.unmount();

    const both = render(<HelpDialog commands={withFeedback} onClose={() => {}} rows={HELP_TALL_ROWS} columns={100} />);
    await waitFor(() => flat(both.lastFrame).includes(HELP_FEEDBACK_LINE));
    both.unmount();

    expect(showsFeedbackLine(withFeedback, HELP_TALL_ROWS)).toBe(true);
    expect(showsFeedbackLine(withFeedback, HELP_TALL_ROWS - 1)).toBe(false);
    expect(showsFeedbackLine(CATALOG, HELP_TALL_ROWS)).toBe(false);
  });

  // T-MENU task 2 fix wave: the hand-written `{escChord} to cancel` line is gone, replaced by DialogFrame's
  // auto keyhint bar (`hintScope={["Help","Tabs"]}`) — still derived from the LIVE table, just through the
  // registry (`help:dismiss` → "dismiss") instead of this component's own `chord()` helper, so a rebind still
  // moves the printed chord.
  it("prints the dismiss chord from the live table, so a rebind moves it", async () => {
    const a = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />);
    await waitFor(() => flat(a.lastFrame).includes("Esc dismiss"));
    expect(flat(a.lastFrame)).not.toContain("esc to cancel");
    a.unmount();
    const b = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />,
      { userLayers: [{ context: "Help", bindings: { "escape": null, "ctrl+q": "help:dismiss" } }] });
    await waitFor(() => flat(b.lastFrame).includes("Ctrl-Q dismiss"));
    expect(flat(b.lastFrame)).not.toContain("Esc dismiss");
    b.unmount();
  });

  // bl10 fix wave 1, finding 3: `Tabs` is handed `disableNavigation={search !== null}` — while a Commands
  // query is open, tab/←/→ register no handler at all (Tabs.tsx's own `NO_ACTIONS` arm), but `Tabs`' table
  // still binds them, so blindly walking that scope kept advertising "switch tab" as live when it was not.
  it("drops the 'switch tab' hint while a Commands/Custom search query disables tab navigation", async () => {
    const { stdin, lastFrame } = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />);
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    stdin.write("\t");
    await waitFor(() => flat(lastFrame).includes(BROWSE_DEFAULT_TITLE));
    expect(flat(lastFrame)).toContain("switch tab");        // browsing: tab navigation is live
    stdin.write("/");
    await waitFor(() => flat(lastFrame).includes("Search commands"));
    expect(flat(lastFrame)).not.toContain("switch tab");    // searching: Tabs is disableNavigation'd
    stdin.write("\x1b");                                      // Esc clears the query, not the dialog
    await waitFor(() => flat(lastFrame).includes("/compact"));
    expect(flat(lastFrame)).toContain("switch tab");          // browsing again: tab navigation is back
  });

  // bl10 fix wave 2, finding 6: while a Commands/Custom search is active, Escape only clears the query (the
  // browser's own footer already says "Esc to clear") — but the auto keyhint bar's `hintScope={["Help"]}`
  // still walked `help:dismiss` and printed "esc dismiss" alongside it, two visible and CONTRADICTORY
  // instructions for the same key. The bar must drop `help:dismiss` while searching; the browser footer's own
  // "Esc to clear" text is untouched, and non-search state keeps advertising the real dismiss.
  it("does not advertise 'dismiss' in the auto keyhint bar while searching — the browser footer already carries Esc's meaning", async () => {
    const { stdin, lastFrame } = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />);
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    stdin.write("\t");
    await waitFor(() => flat(lastFrame).includes(BROWSE_DEFAULT_TITLE));
    expect(flat(lastFrame)).toContain("dismiss");             // browsing: the auto bar still advertises it
    stdin.write("/");
    await waitFor(() => flat(lastFrame).includes("Search commands"));
    const f = flat(lastFrame);
    expect(f).not.toContain("dismiss");                       // searching: the auto bar drops it
    expect(f).toContain("esc to clear");                      // …but the browser's own footer still says so
    stdin.write("\x1b");                                      // Esc clears the query, not the dialog
    await waitFor(() => flat(lastFrame).includes("/compact"));
    expect(flat(lastFrame)).toContain("dismiss");             // browsing again: the real dismiss hint is back
  });

  it("Escape dismisses from the General tab", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<HelpDialog commands={CATALOG} onClose={() => { closed++; }} rows={40} columns={100} />);
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    stdin.write("\x1b");
    await waitFor(() => closed === 1);
  });
});

// bl10 fix wave 7, W7-2 sweep: the `/` query's own echoed input line and the "No commands match …" message
// both embed the raw, user-typed `search` string with no width bound at all — `SettingsDialog`'s own `/`
// search box had the identical gap (fw7 W7-1's cited surface, same fix wave). Height comparison, not `flat`
// (which collapses newlines and would hide the very wrap this pins).
describe("HelpDialog — the `/` query echo and no-match message clip to the frame budget (bl10 fw7 W7-2 sweep)", () => {
  it("clips an over-long, non-matching query so the frame is the same height as a short one", async () => {
    const short = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={30} columns={80} />);
    await waitFor(() => flat(short.lastFrame).includes(HELP_INTRO));
    short.stdin.write("\t");
    await waitFor(() => flat(short.lastFrame).includes(BROWSE_DEFAULT_TITLE));
    short.stdin.write("/");
    await waitFor(() => flat(short.lastFrame).includes("Search commands"));
    short.stdin.write("z");
    await waitFor(() => flat(short.lastFrame).includes('No commands match "z"'));
    const shortLines = stripAnsi(frame(short.lastFrame)).split("\n").length;
    short.unmount();

    const long = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={30} columns={80} />);
    await waitFor(() => flat(long.lastFrame).includes(HELP_INTRO));
    long.stdin.write("\t");
    await waitFor(() => flat(long.lastFrame).includes(BROWSE_DEFAULT_TITLE));
    long.stdin.write("/");
    await waitFor(() => flat(long.lastFrame).includes("Search commands"));
    const query = "z".repeat(100);
    long.stdin.write(query);
    await waitFor(() => flat(long.lastFrame).includes("No commands match"));
    const longLines = stripAnsi(frame(long.lastFrame)).split("\n").length;
    long.unmount();

    expect(longLines, "an unclipped query — echoed AND embedded in the no-match message — wraps into extra rows").toBe(shortLines);
  });

  // The manual (non-`Select`) search-result render maps `browserOptions` straight into `<Text>{o.label}</Text>`
  // with no clip of its own — unlike the `Select`-driven browsing list, whose two-column layout already
  // truncates the label. A live catalog's command name is not this dialog's to bound by convention alone.
  it("clips an over-long command name in the filtered search-result row", async () => {
    const long = "x".repeat(200);
    const short = render(<HelpDialog commands={[{ name: "z", description: "d", source: "catalog" }]} onClose={() => {}} rows={30} columns={80} />);
    await waitFor(() => flat(short.lastFrame).includes(HELP_INTRO));
    short.stdin.write("\t");
    await waitFor(() => flat(short.lastFrame).includes(BROWSE_DEFAULT_TITLE));
    short.stdin.write("/");
    await waitFor(() => flat(short.lastFrame).includes("Search commands"));
    short.stdin.write("z");
    await waitFor(() => flat(short.lastFrame).includes("/z"));
    const shortLines = stripAnsi(frame(short.lastFrame)).split("\n").length;
    short.unmount();

    const wide = render(<HelpDialog commands={[{ name: long, description: "d", source: "catalog" }]} onClose={() => {}} rows={30} columns={80} />);
    await waitFor(() => flat(wide.lastFrame).includes(HELP_INTRO));
    wide.stdin.write("\t");
    await waitFor(() => flat(wide.lastFrame).includes(BROWSE_DEFAULT_TITLE));
    wide.stdin.write("/");
    await waitFor(() => flat(wide.lastFrame).includes("Search commands"));
    wide.stdin.write("x");
    await waitFor(() => flat(wide.lastFrame).includes("/x"));
    const wideLines = stripAnsi(frame(wide.lastFrame)).split("\n").length;
    wide.unmount();

    expect(wideLines, "an unclipped command-name label wraps the filtered row into extra lines").toBe(shortLines);
  });
});

describe("browserOptions", () => {
  it("dedups by name, sorts by name, and clips the description to `columns - 10` (`FIr`, L459455)", () => {
    const dupes: CommandEntry[] = [...CATALOG, { name: "compact", description: "a second row for one name", source: "catalog" }];
    const opts = browserOptions(dupes, 30);
    expect(opts.map((o) => o.value)).toEqual(["agents", "brainstorm", "compact"]);
    expect(opts.map((o) => o.label)).toEqual(["/agents", "/brainstorm", "/compact"]);
    expect(opts[0]!.description!.length).toBeLessThanOrEqual(20);
  });
});

describe("/help drives the dialog end to end", () => {
  it("opens on /help, carries the session's own command catalog, and leaves a dismissal line behind", async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [], mcpServers: [], commands: [{ name: "brainstorm", description: "explore a design" }] }) });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("/help"); await waitFor(() => frame(lastFrame).includes("/help"));
    stdin.write("\r");
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    expect(frame(lastFrame)).not.toContain("❯ ");            // the composer yields to the dialog
    stdin.write("\t");
    await waitFor(() => flat(lastFrame).includes("/brainstorm"));  // the LIVE catalog, not a static list
    stdin.write("\x1b");
    await waitFor(() => flat(lastFrame).includes("Help dialog dismissed"));
    await settle();
    expect(frame(lastFrame)).toContain("❯ ");                // …and the composer comes back
  });

  // T14 review, Minor 2: the "same grid" test above compares CONTENT, so a fork of the grid inside this
  // dialog — same sentences, dead to the live table — would sail straight past it. This one pins the
  // LIVENESS through /help specifically: rebind the action in the user layer and the /help grid must move
  // with it. Only a component that really reads `useBindingLookup()` can pass.
  it("the /help grid resolves from the LIVE table — a rebind moves the sentence inside the dialog", async () => {
    const moved = process.platform === "darwin" ? "opt+k" : "alt+k";
    const { lastFrame } = render(<HelpDialog commands={[]} onClose={() => {}} rows={40} columns={100} />,
      { userLayers: [{ context: "Global", bindings: { "ctrl+t": null, "alt+k": "app:toggleTodos" } }] });
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    const f = flat(lastFrame);
    expect(f).toContain(`${withModSep(formatBindingLower(moved))} to toggle tasks`);
    expect(f).not.toContain("ctrl + t to toggle tasks");
    expect(f).toContain("ctrl + o for verbose output");            // …and everything unrebound is untouched
  });

  it("the `?` overlay and /help print the SAME grid", async () => {
    const a = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(a.lastFrame).includes("❯ "));
    a.stdin.write("?");
    await waitFor(() => flat(a.lastFrame).includes("Keyboard shortcuts"));
    const overlay = flat(a.lastFrame);
    a.unmount();

    const b = render(<HelpDialog commands={[]} onClose={() => {}} rows={40} columns={100} />);
    await waitFor(() => flat(b.lastFrame).includes(HELP_INTRO));
    const dialog = flat(b.lastFrame);
    // WAVE C TASK 14 removed `# for memory` from this list with the mode itself; `? for this help` takes its
    // place as the ccx-extra cell that proves the two surfaces share one table rather than two literals.
    for (const cell of ["! for shell mode", "double tap esc to clear input", "ctrl + t to toggle tasks", "/keybindings to customize", "? for this help"]) {
      expect(overlay, `the ? overlay lost "${cell}"`).toContain(cell);
      expect(dialog, `the /help grid lost "${cell}"`).toContain(cell);
    }
    expect(overlay).not.toContain("# for memory");
    expect(dialog).not.toContain("# for memory");
    b.unmount();
  });
});
