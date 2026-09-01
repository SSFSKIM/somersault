// test/tui/mcp-dialog.test.tsx — T-MENU task 4: the `/mcp` browser. Direct-component tests drive
// `McpDialog` under the keymap (drill/pop cycle, windowing counters, field/tool rendering, absent/malformed
// fields, every status literal). The `/mcp` wiring tests (through the real `ChatApp`/`useChat`) live in
// `mcp-wiring.test.tsx` — see the note at the bottom of this file for why they are a separate file.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { McpDialog, MCP_EMPTY, mcpFetchErrorText } from "../../src/tui/McpDialog.js";
import { type McpServerRow } from "../../src/tui/mcpDialogModel.js";

// Every render in this file leaves an Ink instance mounted with LIVE `useSelectKeys`/keymap subscriptions
// (help-dialog.test.tsx's own `.unmount()` calls guard the same thing). Left mounted, ~15 renders' worth of
// stale input listeners accumulate across this one file and contend for the event loop with whichever test
// runs next — exactly the "useInput-timing flake" vitest.config.ts's `fileParallelism:false` comment already
// names, just within-file instead of cross-file. `mount()`/the ChatApp tests below register each instance
// here so it unmounts before the next test starts.
let mounted: { unmount: () => void } | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const frame = (f: () => string | undefined) => stripAnsi(f() ?? "");
const flat = (f: () => string | undefined) => frame(f).replace(/\n/g, " ").replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const LOCAL: McpServerRow = {
  name: "linear", status: "connected", scope: "project", type: "stdio", command: "node server.js",
  tools: [
    { name: "create_issue", description: "Create a Linear issue", annotations: { destructive: true } },
    { name: "search_issues", description: "Search issues by query", annotations: { readOnly: true, openWorld: true } },
  ],
};
const REMOTE: McpServerRow = {
  name: "notion", status: "connected", scope: "user", type: "http", url: "https://mcp.notion.com/mcp",
  tools: [{ name: "notion-search" }],
};
const FAILED: McpServerRow = { name: "broken", status: "failed", error: "spawn ENOENT", scope: "local", tools: [] };
const NEEDS_AUTH: McpServerRow = { name: "figma", status: "needs-auth", scope: "user", tools: [] };
const PENDING: McpServerRow = { name: "slow", status: "pending", scope: "project", tools: [] };
const DISABLED: McpServerRow = { name: "off", status: "disabled", scope: "local", tools: [] };

async function mount(servers: McpServerRow[], rows = 30) {
  const instance = render(<McpDialog fetchServers={async () => servers} onClose={() => {}} rows={rows} columns={100} />);
  mounted = instance;
  await tick();
  await waitFor(() => !frame(instance.lastFrame).includes("Loading"));
  return instance;
}

describe("McpDialog — root list", () => {
  it("shows the frame title, the pluralized subtitle, and every rich payload's name and status", async () => {
    const { lastFrame } = await mount([LOCAL, REMOTE, FAILED, NEEDS_AUTH, PENDING, DISABLED]);
    const f = flat(lastFrame);
    expect(f).toContain("Manage MCP servers");
    expect(f).toContain("6 servers");
    expect(f).toContain("linear");
    expect(f).toContain("notion");
    expect(f).toContain("broken");
    expect(f).toContain("failed: spawn ENOENT");
    expect(f).toContain("figma");
    expect(f).toContain("needs authentication");
    expect(f).toContain("slow");
    expect(f).toContain("connecting…");
    expect(f).toContain("off");
    expect(f).toContain("disabled");
  });

  it("groups servers under section headers, omitting empty groups", async () => {
    const { lastFrame } = await mount([LOCAL, REMOTE, FAILED]);
    const f = flat(lastFrame);
    expect(f).toContain("Project MCPs");
    expect(f).toContain("User MCPs");
    expect(f).toContain("Local MCPs");
    expect(f).not.toContain("Enterprise MCPs");
    expect(f).not.toContain("claude.ai");
    expect(f).not.toContain("Other MCPs");
  });

  it("shows the canon empty-list message when there are no servers", async () => {
    const { lastFrame } = await mount([]);
    expect(flat(lastFrame)).toContain(MCP_EMPTY);
    expect(flat(lastFrame)).toContain("0 servers");
  });

  // bl10 fix wave 1, finding 2: a rejected `mcpServerStatus()` (an older host, a transport failure) used to
  // be swallowed by `.catch(() => setServers([]))`, which read onscreen as "No MCP servers configured." —
  // indistinguishable from a host that genuinely has none. The old text-only `/mcp` command surfaced a
  // failure; this dialog must too, with a distinct error line that carries the failure's own message.
  it("shows a distinct error line when fetchServers rejects, never the empty-list literal", async () => {
    const instance = render(<McpDialog fetchServers={() => Promise.reject(new Error("ECONNRESET"))} onClose={() => {}} rows={30} columns={100} />);
    mounted = instance;
    await tick();
    await waitFor(() => !frame(instance.lastFrame).includes("Loading"));
    const f = flat(instance.lastFrame);
    expect(f).toContain(mcpFetchErrorText("ECONNRESET"));
    expect(f).not.toContain(MCP_EMPTY);
  });

  // bl10 fix wave 1, finding 3: `Select`'s own table binds navigate/select unconditionally, but an empty
  // root list has nothing to move a cursor onto or accept — advertising them here is the no-op-hint defect.
  // Only `select:cancel`'s Esc-to-close is ever live in this state.
  it("advertises only cancel — no navigate/select — over the empty server list", async () => {
    const { lastFrame } = await mount([]);
    const f = flat(lastFrame);
    expect(f).toContain("cancel");
    expect(f).not.toContain("navigate");
    expect(f).not.toContain("select");
  });

  it("windows the list with counted ↑/↓ more-above/below indicators", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `server-${i}`, status: "connected" as const, scope: "project", tools: [] }));
    // rows=14 -> mcpListVisibleRows(14) = 6, well under the 11 combined heading+server rows, so the window
    // overflows both ends once the cursor moves off the first page.
    const { stdin, lastFrame } = await mount(many, 14);
    expect(flat(lastFrame)).toMatch(/↓ \d+ more below/);        // the initial page already overflows below
    expect(flat(lastFrame)).not.toMatch(/↑ \d+ more above/);    // …but not above, at the top of the list
    for (let i = 0; i < 5; i++) { stdin.write("\x1b[B"); await tick(); }
    const f = flat(lastFrame);
    expect(f).toMatch(/↑ \d+ more above/);
    expect(f).toMatch(/↓ \d+ more below/);
  });
});

describe("McpDialog — drill/pop cycle", () => {
  it("Enter on the focused server drills into server-menu, showing its field block", async () => {
    const { stdin, lastFrame } = await mount([LOCAL]);
    stdin.write("\r"); await tick();
    const f = flat(lastFrame);
    expect(f).toContain("linear");
    expect(f).toContain("Type:");
    expect(f).toContain("stdio");
    expect(f).toContain("Command:");
    expect(f).toContain("node server.js");
    expect(f).toContain("Status:");
    expect(f).toContain("connected");
    expect(f).not.toContain("URL:");                       // stdio server carries no URL
    expect(f).toContain("Tools (2)");
  });

  it("a remote (http) server's menu shows URL:, not Command:", async () => {
    const { stdin, lastFrame } = await mount([REMOTE]);
    stdin.write("\r"); await tick();
    const f = flat(lastFrame);
    expect(f).toContain("URL:");
    expect(f).toContain("https://mcp.notion.com/mcp");
    expect(f).not.toContain("Command:");
  });

  it("Enter again from server-menu drills into server-tools, listing row.tools", async () => {
    const { stdin, lastFrame } = await mount([LOCAL]);
    stdin.write("\r"); await tick();          // -> server-menu
    stdin.write("\r"); await tick();          // -> server-tools (the "Tools (2)" affordance)
    const f = flat(lastFrame);
    expect(f).toContain("create_issue");
    expect(f).toContain("Create a Linear issue");
    expect(f).toContain("search_issues");
    expect(f).toContain("Search issues by query");
  });

  it("Enter on a focused tool drills into server-tool-detail with name, description and annotations", async () => {
    const { stdin, lastFrame } = await mount([LOCAL]);
    stdin.write("\r"); await tick();          // -> server-menu
    stdin.write("\r"); await tick();          // -> server-tools
    stdin.write("\r"); await tick();          // -> server-tool-detail (first tool, create_issue)
    const f = flat(lastFrame);
    expect(f).toContain("create_issue");
    expect(f).toContain("Description:");
    expect(f).toContain("Create a Linear issue");
    expect(f).toContain("Annotations:");
    expect(f).toContain("destructive");
  });

  it("a tool with no annotations shows no Annotations: line", async () => {
    const { stdin, lastFrame } = await mount([REMOTE]);
    stdin.write("\r"); await tick();          // -> server-menu
    stdin.write("\r"); await tick();          // -> server-tools
    stdin.write("\r"); await tick();          // -> server-tool-detail (notion-search)
    const f = flat(lastFrame);
    expect(f).toContain("notion-search");
    expect(f).not.toContain("Annotations:");
    expect(f).not.toContain("Description:");   // no description on this tool either
  });

  it("Esc pops exactly one level at a time, back to the exact list it started from", async () => {
    const { stdin, lastFrame } = await mount([LOCAL]);
    stdin.write("\r"); await tick();          // -> server-menu
    stdin.write("\r"); await tick();          // -> server-tools
    stdin.write("\r"); await tick();          // -> server-tool-detail
    stdin.write("\x1b"); await tick();
    expect(flat(lastFrame)).toContain("create_issue");     // back on server-tools
    expect(flat(lastFrame)).not.toContain("Description:");
    stdin.write("\x1b"); await tick();
    expect(flat(lastFrame)).toContain("Tools (2)");         // back on server-menu
    stdin.write("\x1b"); await tick();
    expect(flat(lastFrame)).toContain("Manage MCP servers"); // back on the root list
    expect(flat(lastFrame)).toContain("linear");
  });

  it("a server with zero tools has no Tools() affordance and Enter in server-menu is a dead key", async () => {
    const { stdin, lastFrame } = await mount([FAILED]);
    stdin.write("\r"); await tick();          // -> server-menu
    expect(flat(lastFrame)).not.toContain("Tools (");
    stdin.write("\r"); await tick();          // no-op — no tools to drill into
    expect(flat(lastFrame)).not.toContain("No tools.");     // still on server-menu, not server-tools
    // bl10 fix wave 1, finding 3: no "View tools" row means count is 0 here too — navigate/select are no-ops.
    const f = flat(lastFrame);
    expect(f).toContain("cancel");
    expect(f).not.toContain("navigate");
    expect(f).not.toContain("select");
  });
});

// bl10 fix wave 2, finding 4: `serverFocus`/`toolFocus` were plain render-captured state, but `useSelectKeys`'
// own contract (selectKeys.ts:18-22) requires a GETTER for any focus that can move more than once per stdin
// chunk — the provider dispatches every event of one chunk in a loop with NO render in between, so a plain
// number (or an `onAccept` closure that reads it) sees the PRE-chunk value for every event but the first.
// `Select.tsx`'s own fix for the identical hazard is the house pattern: ref-backed focus, a getter passed to
// `useSelectKeys`, the ref updated synchronously in `onMove`, and `onAccept` reading the ref.
describe("McpDialog — same-chunk move+accept lands on the post-move row (bl10 fw2 F4)", () => {
  const A: McpServerRow = { name: "a-server", status: "connected", scope: "project", tools: [] };
  const B: McpServerRow = { name: "b-server", status: "connected", scope: "project", tools: [] };
  const C: McpServerRow = { name: "c-server", status: "connected", scope: "project", tools: [] };

  it("root list: `j` then Enter in ONE chunk opens the SECOND server, not the first", async () => {
    const { stdin, lastFrame } = await mount([A, B, C]);
    stdin.write("j\r");                                      // one chunk: move to b-server, then accept
    await waitFor(() => flat(lastFrame).includes("Status:"));
    const f = flat(lastFrame);
    expect(f).toContain("b-server");
    expect(f).not.toContain("a-server");
  });

  it("server-tools: `j` then Enter in ONE chunk drills into the SECOND tool, not the first", async () => {
    const withTools: McpServerRow = {
      name: "srv", status: "connected", scope: "project",
      tools: [{ name: "tool-one" }, { name: "tool-two" }, { name: "tool-three" }],
    };
    const { stdin, lastFrame } = await mount([withTools]);
    stdin.write("\r"); await tick();          // -> server-menu
    stdin.write("\r"); await tick();          // -> server-tools
    stdin.write("j\r");                       // one chunk: move to tool-two, then accept -> tool-detail
    await waitFor(() => flat(lastFrame).includes("srv"));
    await waitFor(() => flat(lastFrame).includes("tool-two"));
    const f = flat(lastFrame);
    expect(f).toContain("tool-two");
  });
});

describe("McpDialog — onClose", () => {
  it("root Esc closes the dialog", async () => {
    let closed = false;
    const instance = render(<McpDialog fetchServers={async () => [LOCAL]} onClose={() => { closed = true; }} rows={30} columns={100} />);
    mounted = instance;
    await tick();
    await waitFor(() => !frame(instance.lastFrame).includes("Loading"));
    instance.stdin.write("\x1b");
    await tick();
    expect(closed).toBe(true);
  });
});

// The `/mcp` wiring tests (spec A2/D5-bl10) live in `mcp-wiring.test.tsx` — a SEPARATE file, mirroring
// status-family-dialog.test.tsx's own split from its dialog's component tests. Not just tidiness: this
// file's ~15 direct `McpDialog` renders above (each with a live `useSelectKeys` subscription, unmounted via
// the `afterEach` at the top) leave enough accumulated event-loop pressure in ONE vitest worker that a
// ChatApp-level test's own composer-mount `waitFor` starts missing its 2s budget — the exact "useInput-
// timing flake" vitest.config.ts's `fileParallelism:false` comment already names, reproduced within a file
// instead of across files. A fresh file is a fresh worker's fresh event loop.
