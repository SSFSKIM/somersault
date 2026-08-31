// tui/test/tabs-shell.test.tsx — the `<Tab>` pane half of the tab shell (T-MENU task 1, canon `Zi` L122728)
// and the child-derived tab list `Tabs` grows to host it (canon `Pg` L122645): the tab list is DERIVED from
// `<Tab title id?>` children (`id ?? title`, canon's own rule), and the shell supports BOTH `defaultTab`
// (uncontrolled) and `selectedTab`+`onTabChange` (controlled) on top of the pre-existing explicit
// `tabs`+`active`+`onChange` calling convention, which must keep rendering byte-identical for callers not yet
// migrated onto the shell (`test/tui/tabs.test.tsx` already pins that convention; this file is additive).
import React from "react";
import { describe, it, expect } from "vitest";
import { Text } from "ink";
import { render as inkRender } from "ink-testing-library";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { Tabs, Tab } from "../../src/tui/select/Tabs.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const frame = (f: () => string | undefined) => plain(f() ?? "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function mount(ui: React.ReactElement) {
  const r = render(ui);
  await waitFor(() => frame(r.lastFrame).length > 0);
  return r;
}

describe("<Tab> pane (canon Zi, L122728)", () => {
  it("renders only the child whose id-or-title matches the active tab", async () => {
    const r = await mount(
      <Tabs defaultTab="Config">
        <Tab title="Status"><Text>status body</Text></Tab>
        <Tab title="Config"><Text>config body</Text></Tab>
      </Tabs>,
    );
    const f = frame(r.lastFrame);
    expect(f).toContain("config body");
    expect(f).not.toContain("status body");
  });

  it("keys a pane by id when given, not by title", async () => {
    const r = await mount(
      <Tabs defaultTab="cfg">
        <Tab title="Status" id="st"><Text>status body</Text></Tab>
        <Tab title="Config" id="cfg"><Text>config body</Text></Tab>
      </Tabs>,
    );
    expect(frame(r.lastFrame)).toContain("config body");
  });

  it("renders nothing when mounted with no <Tabs> shell above it (no context to read)", async () => {
    const r = inkRender(<Tab title="Status"><Text>status body</Text></Tab>);
    await tick();
    expect(frame(r.lastFrame)).not.toContain("status body");
  });
});

describe("<Tabs> deriving its list from children (canon Pg, L122645)", () => {
  it("builds the chip strip from <Tab> children, in order — the legacy chip styling unchanged", async () => {
    const r = await mount(
      <Tabs defaultTab="Status">
        <Tab title="Status"><Text>a</Text></Tab>
        <Tab title="Usage"><Text>b</Text></Tab>
      </Tabs>,
    );
    const f = frame(r.lastFrame);
    expect(f).toContain(" Status   Usage"); // gap:1 between chips, ` title ` padding on both — awr, L435094-435105
  });

  it("switches the visible pane when tab/shift+tab move the strip's active chip (uncontrolled, defaultTab)", async () => {
    const r = await mount(
      <Tabs defaultTab="Status">
        <Tab title="Status"><Text>status body</Text></Tab>
        <Tab title="Config"><Text>config body</Text></Tab>
      </Tabs>,
    );
    expect(frame(r.lastFrame)).toContain("status body");
    r.stdin.write("\t");
    await waitFor(() => frame(r.lastFrame).includes("config body"));
    expect(frame(r.lastFrame)).not.toContain("status body");
  });

  it("is CONTROLLED when selectedTab+onTabChange are given: the pane only moves when the caller updates selectedTab", async () => {
    function Harness() {
      const [sel, setSel] = React.useState("Status");
      return (
        <Tabs selectedTab={sel} onTabChange={setSel}>
          <Tab title="Status"><Text>status body</Text></Tab>
          <Tab title="Config"><Text>config body</Text></Tab>
        </Tabs>
      );
    }
    const r = await mount(<Harness />);
    expect(frame(r.lastFrame)).toContain("status body");
    r.stdin.write("\t");
    await waitFor(() => frame(r.lastFrame).includes("config body"));
    expect(frame(r.lastFrame)).not.toContain("status body");
  });
});

describe("<Tabs> explicit tabs/active/onChange API is unaffected (backward compatibility)", () => {
  it("renders only the chip strip with no <Tab> children — existing dialogs still switch their own bodies", async () => {
    const TAB_SPECS = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
    const r = await mount(<Tabs tabs={TAB_SPECS} active="a" onChange={() => {}} />);
    expect(frame(r.lastFrame)).toContain(" A   B");
  });
});
