// test/tui/mcpDialogModel.test.ts — T-MENU task 4: pure-model coverage for the `/mcp` browser. Normalization
// (rich local/remote payloads, raw names/descriptions, absent/malformed fields, every status literal),
// grouping, the view-stack transitions, and the windowing math the root list's counters read.
import { describe, it, expect } from "vitest";
import {
  normalizeMcpServers, buildListRows, serverIndices, flatIndexOfServer, mcpListVisibleRows, mcpWindow,
  MCP_ROOT_VIEW, enterServerMenu, enterServerTools, enterToolDetail, popMcpView, findServer, findTool,
  statusText, serverMenuFields, toolAnnotationLabels, mcpSubtitle, MCP_TITLE,
  type McpServerRow,
} from "../../src/tui/mcpDialogModel.js";

describe("normalizeMcpServers", () => {
  it("normalizes a rich LOCAL (stdio) server with tools, descriptions and annotations", () => {
    const rows = normalizeMcpServers([
      {
        name: "linear", status: "connected", scope: "project",
        config: { type: "stdio", command: "node", args: ["server.js"] },
        tools: [
          { name: "create_issue", description: "Create a Linear issue", annotations: { destructive: false, readOnly: false } },
          { name: "search_issues", description: "Search issues", annotations: { readOnly: true, openWorld: true } },
        ],
      },
    ]);
    expect(rows).toEqual<McpServerRow[]>([
      {
        name: "linear", status: "connected", scope: "project", type: "stdio", command: "node",
        tools: [
          { name: "create_issue", description: "Create a Linear issue", annotations: { destructive: false, readOnly: false } },
          { name: "search_issues", description: "Search issues", annotations: { readOnly: true, openWorld: true } },
        ],
      },
    ]);
  });

  it("normalizes a rich REMOTE (http) server, with a URL instead of a command", () => {
    const rows = normalizeMcpServers([
      { name: "notion", status: "connected", scope: "user", config: { type: "http", url: "https://mcp.notion.com/mcp" },
        tools: [{ name: "notion-search" }] },
    ]);
    expect(rows[0]).toMatchObject({ name: "notion", type: "http", url: "https://mcp.notion.com/mcp" });
    expect(rows[0]).not.toHaveProperty("command");
    expect(rows[0]!.tools).toEqual([{ name: "notion-search" }]);
  });

  it("carries raw names and descriptions through untouched (no title-casing, no truncation)", () => {
    const rows = normalizeMcpServers([
      { name: "my_weird-Server.99", status: "connected",
        tools: [{ name: "mcp__weird__tool_NAME", description: "does\nmulti-line\tstuff with \"quotes\"" }] },
    ]);
    expect(rows[0]!.name).toBe("my_weird-Server.99");
    expect(rows[0]!.tools[0]).toEqual({ name: "mcp__weird__tool_NAME", description: "does\nmulti-line\tstuff with \"quotes\"" });
  });

  it("every status literal survives, and an unrecognized one falls back to failed rather than throwing", () => {
    const rows = normalizeMcpServers([
      { name: "a", status: "connected" }, { name: "b", status: "failed", error: "spawn ENOENT" },
      { name: "c", status: "needs-auth" }, { name: "d", status: "pending" }, { name: "e", status: "disabled" },
      { name: "f", status: "bogus-status" }, { name: "g" },
    ]);
    expect(rows.map((r) => r.status)).toEqual(["connected", "failed", "needs-auth", "pending", "disabled", "failed", "failed"]);
    expect(rows[1]!.error).toBe("spawn ENOENT");
  });

  it("omits absent/malformed fields rather than crashing or inventing values", () => {
    const rows = normalizeMcpServers([
      { name: "sparse", status: "connected" },                                  // no config/scope/tools/error at all
      { name: "bad-config", status: "connected", config: "not-an-object" },
      { name: "bad-tools", status: "connected", tools: "not-an-array" },
      { name: "bad-tool-entries", status: "connected", tools: [null, 42, {}, { name: "" }, { name: 7 }, { name: "ok" }] },
      { name: "bad-annotations", status: "connected", tools: [{ name: "t", annotations: "nope" }] },
      { name: "bad-annotation-fields", status: "connected", tools: [{ name: "t", annotations: { readOnly: "yes" } }] },
    ]);
    expect(rows[0]).toEqual({ name: "sparse", status: "connected", tools: [] });
    expect(rows[1]).toEqual({ name: "bad-config", status: "connected", tools: [] });
    expect(rows[2]).toEqual({ name: "bad-tools", status: "connected", tools: [] });
    expect(rows[3]!.tools).toEqual([{ name: "ok" }]);                            // every malformed tool entry dropped
    expect(rows[4]!.tools).toEqual([{ name: "t" }]);                             // annotations not an object -> omitted
    expect(rows[5]!.tools).toEqual([{ name: "t" }]);                             // non-boolean annotation field -> omitted
  });

  it("drops a server with no usable name and never throws on non-array/garbage input", () => {
    expect(normalizeMcpServers([{ status: "connected" }, { name: "", status: "connected" }, { name: 7, status: "connected" }])).toEqual([]);
    expect(normalizeMcpServers(null)).toEqual([]);
    expect(normalizeMcpServers(undefined)).toEqual([]);
    expect(normalizeMcpServers("not an array")).toEqual([]);
    expect(normalizeMcpServers([null, 42, "x"])).toEqual([]);
  });
});

describe("mcpSubtitle / MCP_TITLE", () => {
  it("singularizes exactly at 1 and pluralizes elsewhere", () => {
    expect(mcpSubtitle(0)).toBe("0 servers");
    expect(mcpSubtitle(1)).toBe("1 server");
    expect(mcpSubtitle(2)).toBe("2 servers");
  });
  it("the frame title is canon's literal", () => { expect(MCP_TITLE).toBe("Manage MCP servers"); });
});

const row = (over: Partial<McpServerRow> = {}): McpServerRow => ({ name: "x", status: "connected", tools: [], ...over });

describe("buildListRows (grouping)", () => {
  it("groups by scope in canon's order, alphabetized within a group", () => {
    const servers = [
      row({ name: "z-proj", scope: "project" }), row({ name: "a-proj", scope: "project" }),
      row({ name: "u1", scope: "user" }), row({ name: "loc1", scope: "local" }),
      row({ name: "ent1", scope: "enterprise" }),
    ];
    const rows = buildListRows(servers);
    expect(rows.map((r) => (r.kind === "heading" ? `H:${r.label}` : `S:${r.server.name}`))).toEqual([
      "H:Project MCPs", "S:a-proj", "S:z-proj",
      "H:Local MCPs", "S:loc1",
      "H:User MCPs", "S:u1",
      "H:Enterprise MCPs", "S:ent1",
    ]);
  });

  it("omits a heading for a group with zero members", () => {
    const rows = buildListRows([row({ name: "solo", scope: "project" })]);
    expect(rows).toEqual([{ kind: "heading", label: "Project MCPs" }, { kind: "server", server: expect.objectContaining({ name: "solo" }) }]);
  });

  it("groups claude.ai servers by transport, not by scope", () => {
    const rows = buildListRows([row({ name: "claude-connector", scope: "claudeai", type: "claudeai-proxy" })]);
    expect(rows[0]).toEqual({ kind: "heading", label: "claude.ai" });
  });

  it("folds managed into the enterprise group rather than opening a second heading", () => {
    const rows = buildListRows([row({ name: "m1", scope: "managed" }), row({ name: "e1", scope: "enterprise" })]);
    expect(rows.filter((r) => r.kind === "heading")).toEqual([{ kind: "heading", label: "Enterprise MCPs" }]);
  });

  it("an unrecognized or absent scope falls into Other MCPs rather than being dropped", () => {
    const rows = buildListRows([row({ name: "no-scope" }), row({ name: "weird", scope: "dynamic" })]);
    const headings = rows.filter((r) => r.kind === "heading").map((r) => (r as { label: string }).label);
    expect(headings).toEqual(["Other MCPs"]);
    expect(rows.map((r) => r.kind === "server" ? r.server.name : null).filter(Boolean)).toEqual(["no-scope", "weird"]);
  });

  it("an empty server list produces an empty row list", () => { expect(buildListRows([])).toEqual([]); });
});

describe("serverIndices / flatIndexOfServer", () => {
  it("finds only the server rows, skipping headings", () => {
    const rows = buildListRows([row({ name: "a", scope: "project" }), row({ name: "b", scope: "user" })]);
    expect(serverIndices(rows)).toEqual([1, 3]);
    expect(flatIndexOfServer(rows, 0)).toBe(1);
    expect(flatIndexOfServer(rows, 1)).toBe(3);
    expect(flatIndexOfServer(rows, 5)).toBe(-1);
  });
});

describe("windowing (mcpListVisibleRows / mcpWindow)", () => {
  it("never returns fewer than 1 visible row even on a tiny terminal", () => {
    expect(mcpListVisibleRows(0)).toBe(1);
    expect(mcpListVisibleRows(8)).toBe(1);
  });
  it("scales with the terminal height above the chrome budget", () => { expect(mcpListVisibleRows(28)).toBe(20); });
  it("windows around the focus, reporting start/end for the overflow counters", () => {
    expect(mcpWindow(10, 0, 3)).toEqual({ start: 0, end: 3 });
    expect(mcpWindow(10, 9, 3)).toEqual({ start: 7, end: 10 });
    expect(mcpWindow(10, 5, 3)).toEqual({ start: 3, end: 6 });   // no `prev` window: bottom-anchors on first render past page 1
  });
});

describe("view-stack transitions", () => {
  it("Enter drills exactly one level at a time, matching canon's router", () => {
    expect(MCP_ROOT_VIEW).toEqual({ type: "list" });
    expect(enterServerMenu("linear")).toEqual({ type: "server-menu", server: "linear" });
    expect(enterServerTools("linear")).toEqual({ type: "server-tools", server: "linear" });
    expect(enterToolDetail("linear", "search_issues")).toEqual({ type: "server-tool-detail", server: "linear", tool: "search_issues" });
  });

  it("Esc pops exactly one level; the root's Esc closes (null)", () => {
    expect(popMcpView({ type: "list" })).toBeNull();
    expect(popMcpView({ type: "server-menu", server: "linear" })).toEqual({ type: "list" });
    expect(popMcpView({ type: "server-tools", server: "linear" })).toEqual({ type: "server-menu", server: "linear" });
    expect(popMcpView({ type: "server-tool-detail", server: "linear", tool: "t" })).toEqual({ type: "server-tools", server: "linear" });
  });

  it("the full drill/pop cycle returns to the exact view it started from", () => {
    let view = MCP_ROOT_VIEW;
    view = enterServerMenu("linear");
    view = enterServerTools("linear");
    view = enterToolDetail("linear", "search_issues");
    expect(view).toEqual({ type: "server-tool-detail", server: "linear", tool: "search_issues" });
    view = popMcpView(view)!;
    view = popMcpView(view)!;
    view = popMcpView(view)!;
    expect(view).toEqual({ type: "list" });
    expect(popMcpView(view)).toBeNull();
  });
});

describe("findServer / findTool", () => {
  const servers = [row({ name: "a" }), row({ name: "b", tools: [{ name: "t1" }, { name: "t2" }] })];
  it("finds by exact name, undefined on a miss", () => {
    expect(findServer(servers, "b")).toBe(servers[1]);
    expect(findServer(servers, "missing")).toBeUndefined();
    expect(findTool(servers[1]!, "t2")).toEqual({ name: "t2" });
    expect(findTool(servers[1]!, "missing")).toBeUndefined();
  });
});

describe("statusText / serverMenuFields", () => {
  it("renders one line per status literal", () => {
    expect(statusText(row({ status: "connected" }))).toBe("connected");
    expect(statusText(row({ status: "pending" }))).toBe("connecting…");
    expect(statusText(row({ status: "needs-auth" }))).toBe("needs authentication");
    expect(statusText(row({ status: "disabled" }))).toBe("disabled");
    expect(statusText(row({ status: "failed" }))).toBe("failed");
    expect(statusText(row({ status: "failed", error: "spawn ENOENT" }))).toBe("failed: spawn ENOENT");
  });

  it("emits Type:/URL:/Command:/Status: only for fields the row carries, Status: always present", () => {
    expect(serverMenuFields(row({ status: "connected" }))).toEqual([{ label: "Status:", value: "connected" }]);
    expect(serverMenuFields(row({ status: "connected", type: "stdio", command: "node" }))).toEqual([
      { label: "Type:", value: "stdio" }, { label: "Command:", value: "node" }, { label: "Status:", value: "connected" },
    ]);
    expect(serverMenuFields(row({ status: "failed", type: "http", url: "https://x", error: "timeout" }))).toEqual([
      { label: "Type:", value: "http" }, { label: "URL:", value: "https://x" }, { label: "Status:", value: "failed: timeout" },
    ]);
  });
});

describe("toolAnnotationLabels", () => {
  it("lists only the TRUE flags, in canon's order", () => {
    expect(toolAnnotationLabels({ name: "t" })).toEqual([]);
    expect(toolAnnotationLabels({ name: "t", annotations: {} })).toEqual([]);
    expect(toolAnnotationLabels({ name: "t", annotations: { readOnly: false, destructive: false, openWorld: false } })).toEqual([]);
    expect(toolAnnotationLabels({ name: "t", annotations: { readOnly: true } })).toEqual(["read-only"]);
    expect(toolAnnotationLabels({ name: "t", annotations: { readOnly: true, destructive: true, openWorld: true } }))
      .toEqual(["read-only", "destructive", "open-world"]);
  });
});
