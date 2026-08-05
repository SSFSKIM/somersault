// tui/test/tabs.test.tsx — the `Tabs` strip (F6 T2). Every expectation is a transcription of 2.1.220's `awr`
// (L435094-435105, the item) and `Jx`'s header row (L435076, the `gap:1` container), and the chip claims read
// the RAW SGR frame: "the current tab is inverse-video and bold" is an ATTRIBUTE statement, and a plain-text
// frame cannot tell it from any other tab.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { Tabs } from "../../src/tui/select/Tabs.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const TABS = [{ id: "Status", title: "Status" }, { id: "Config", title: "Config" }, { id: "Usage", title: "Usage" }];

/** Drives `active` from `onChange`, the way every host dialog does. */
function Harness({ initial = "Config", ...rest }: { initial?: string; color?: "claude"; disableNavigation?: boolean }) {
  const [active, setActive] = React.useState(initial);
  return <Tabs tabs={TABS} active={active} onChange={setActive} {...rest} />;
}
async function mount(ui: React.ReactElement) {
  const r = render(ui);
  await waitFor(() => frame(r.lastFrame).length > 0);
  return r;
}

describe("<Tabs> chip rendering (awr, L435094-435105)", () => {
  it("pads EVERY title with one space either side and renders the current chip inverse + bold", async () => {
    const r = await mount(<Harness />);
    const f = frame(r.lastFrame);
    expect(f).toContain("\x1b[7m\x1b[1m Config \x1b[22m\x1b[27m");   // inverse + bold, ` title `
    expect(f).toContain(" Status ");                                  // …and the padding is on the others too
    expect(f).not.toContain("\x1b[7m\x1b[1m Status ");                // but the attributes are not
    expect(f.replace(/\x1b\[[0-9;]*m/g, "")).toContain(" Status   Config  ");   // gap:1 between chips, no separator glyph
  });

  it("moves the inverse chip with the active tab", async () => {
    const r = await mount(<Harness initial="Status" />);
    expect(frame(r.lastFrame)).toContain("\x1b[7m\x1b[1m Status \x1b[22m\x1b[27m");
    r.stdin.write("\t");
    await waitFor(() => frame(r.lastFrame).includes("\x1b[7m\x1b[1m Config \x1b[22m\x1b[27m"));
    expect(frame(r.lastFrame)).not.toContain("\x1b[7m\x1b[1m Status ");
  });

  it("renders the current chip as a filled badge instead when a colour is asked for (T_, L422149)", async () => {
    const r = await mount(<Harness color="claude" />);
    const f = frame(r.lastFrame);
    expect(f).toContain("\x1b[48;2;215;119;87m");                     // background = the `claude` token
    expect(f).toContain("\x1b[38;2;0;0;0m");                          // foreground = `inverseText` (dark theme)
    expect(f).not.toContain("\x1b[7m\x1b[1m Config ");                // …and NOT the inverse chip
  });
});

describe("<Tabs> keys (context Tabs, bindings.ts / bundle L186118)", () => {
  it("tab and right go next, shift+tab and left go previous, both wrapping (L435041-435046)", async () => {
    const r = await mount(<Harness initial="Status" />);
    const chip = () => TABS.find((t) => frame(r.lastFrame).includes(`\x1b[7m\x1b[1m ${t.title} \x1b[22m\x1b[27m`))!.id;
    r.stdin.write("\x1b[C");                                          // right → Config
    await waitFor(() => chip() === "Config");
    r.stdin.write("\t");                                              // tab → Usage
    await waitFor(() => chip() === "Usage");
    r.stdin.write("\x1b[C");                                          // right off the end wraps → Status
    await waitFor(() => chip() === "Status");
    r.stdin.write("\x1b[D");                                          // left off the front wraps → Usage
    await waitFor(() => chip() === "Usage");
    r.stdin.write("\x1b[Z");                                          // shift+tab → Config
    await waitFor(() => chip() === "Config");
  });

  it("disableNavigation registers no handlers at all — the strip renders and the keys do nothing", async () => {
    const r = await mount(<Harness initial="Status" disableNavigation />);
    expect(frame(r.lastFrame)).toContain("\x1b[7m\x1b[1m Status \x1b[22m\x1b[27m");
    for (const k of ["\t", "\x1b[C", "\x1b[D", "\x1b[Z"]) { r.stdin.write(k); await tick(); }
    expect(frame(r.lastFrame)).toContain("\x1b[7m\x1b[1m Status \x1b[22m\x1b[27m");
  });
});
