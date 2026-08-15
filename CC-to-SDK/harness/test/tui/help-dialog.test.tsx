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

  it("prints the dismiss chord from the live table, so a rebind moves it", async () => {
    const a = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />);
    await waitFor(() => flat(a.lastFrame).includes("esc to cancel"));
    a.unmount();
    const b = render(<HelpDialog commands={CATALOG} onClose={() => {}} rows={40} columns={100} />,
      { userLayers: [{ context: "Help", bindings: { "escape": null, "ctrl+q": "help:dismiss" } }] });
    await waitFor(() => flat(b.lastFrame).includes("ctrl + q to cancel"));
    expect(flat(b.lastFrame)).not.toContain("esc to cancel");
    b.unmount();
  });

  it("Escape dismisses from the General tab", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<HelpDialog commands={CATALOG} onClose={() => { closed++; }} rows={40} columns={100} />);
    await waitFor(() => flat(lastFrame).includes(HELP_INTRO));
    stdin.write("\x1b");
    await waitFor(() => closed === 1);
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
