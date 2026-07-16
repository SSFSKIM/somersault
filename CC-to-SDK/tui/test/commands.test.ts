// tui/test/commands.test.ts — pure parser + formatters.
import { describe, it, expect } from "vitest";
import { parseCommand, COMMANDS, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, parseMcpArgs, formatMcpStatus, formatMcpUsage, pickMostRecent, parseResumeIntent, parseLaunchMode, parseLaunchThink } from "../src/commands.js";

describe("parseCommand", () => {
  it("splits a slash command into name + args", () => {
    expect(parseCommand("/model claude-opus-4-8")).toEqual({ name: "model", args: "claude-opus-4-8" });
    expect(parseCommand("/help")).toEqual({ name: "help", args: "" });
    expect(parseCommand("  /compact  ")).toEqual({ name: "compact", args: "" });
  });
  it("returns null for non-commands and a bare slash", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("/")).toBeNull();
    expect(parseCommand("  ")).toBeNull();
  });
});

describe("formatters", () => {
  it("help lists every command", () => {
    const lines = formatHelp().map((l) => l.text).join("\n");
    for (const c of COMMANDS) expect(lines).toContain(`/${c.name}`);
  });
  it("model: set vs show-current", () => {
    expect(formatModel("opus")).toEqual([{ text: "model → opus" }]);
    expect(formatModel(undefined, "sonnet")).toEqual([{ text: "model: sonnet", dim: true }]);
  });
  it("compact: success shows before→after, failure is dim", () => {
    expect(formatCompact({ ok: true, preTokens: 31000, postTokens: 6000 })).toEqual([{ text: "✦ compacted 31k → 6k" }]);
    expect(formatCompact({ ok: false, error: "Not enough messages" })[0].dim).toBe(true);
  });
  it("context renders a one-line digest", () => {
    expect(formatContext({ percentUsed: 9, tokensUsed: 18500, maxTokens: 200000, tokensRemaining: 181500, status: "ok" }))
      .toEqual([{ text: "ctx 9% · 18.5k / 200k · ok", dim: true }]);
  });
  it("unknown", () => {
    expect(formatUnknown("zzz")).toEqual([{ text: "Unknown command: /zzz · try /help", color: "red" }]);
  });
  it("think: set vs show-current", () => {
    expect(formatThink("high")).toEqual([{ text: "thinking → high" }]);
    expect(formatThink(undefined, "default")).toEqual([{ text: "thinking: default", dim: true }]);
  });
  it("cost: shows total, tokens, duration, per-model breakdown", () => {
    const lines = formatCost({ session: { total_cost_usd: 0.0123, total_duration_ms: 65000, model_usage: { "claude-opus-4-8": { inputTokens: 1200, outputTokens: 340, costUSD: 0.0123 } } }, subscription_type: null }).map((l) => l.text).join("\n");
    expect(lines).toContain("$0.0123");
    expect(lines).toContain("1.2k in · 340 out");
    expect(lines).toContain("1m 05s");
    expect(lines).toContain("claude-opus-4-8");
  });
  it("cost: subscription auth shows 'included in your <plan> plan' instead of $0", () => {
    const lines = formatCost({ session: { total_cost_usd: 0, model_usage: {} }, subscription_type: "max" }).map((l) => l.text).join("\n");
    expect(lines).toContain("included in your max plan");
  });
  it("status: snapshots model · mode · thinking · context · session", () => {
    const lines = formatStatus({ model: "claude-opus-4-8", mode: "acceptEdits", thinkLevel: "high", ctxPct: 42, sessionId: "abcdef1234", cwd: "/x" }).map((l) => l.text).join("\n");
    expect(lines).toContain("acceptEdits");
    expect(lines).toContain("high");
    expect(lines).toContain("42% used");
    expect(lines).toContain("abcdef12");
  });
  it("cost/status are in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "cost")).toBe(true);
    expect(COMMANDS.some((c) => c.name === "status")).toBe(true);
  });
});

describe("resume helpers", () => {
  it("/continue is in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "continue")).toBe(true);
  });
  it("/yolo is in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "yolo")).toBe(true);
  });
  it("/think is in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "think")).toBe(true);
  });
  it("pickMostRecent returns the max-lastModified session id", () => {
    expect(pickMostRecent([{ sessionId: "a", lastModified: 5 }, { sessionId: "b", lastModified: 9 }, { sessionId: "c", lastModified: 2 }])).toBe("b");
    expect(pickMostRecent([])).toBeUndefined();
  });
  it("parseResumeIntent reads --resume <id>, --continue, -c", () => {
    expect(parseResumeIntent(["--resume", "sess-1"])).toEqual({ kind: "id", id: "sess-1" });
    expect(parseResumeIntent(["--continue"])).toEqual({ kind: "continue" });
    expect(parseResumeIntent(["-c"])).toEqual({ kind: "continue" });
    expect(parseResumeIntent(["--model", "x"])).toBeUndefined();
  });
});

describe("parseLaunchMode", () => {
  it("reads a valid --permission-mode, else default", () => {
    expect(parseLaunchMode(["--permission-mode", "auto"])).toBe("auto");
    expect(parseLaunchMode(["--permission-mode", "acceptEdits"])).toBe("acceptEdits");
    expect(parseLaunchMode(["--permission-mode", "bogus"])).toBe("default");
    expect(parseLaunchMode(["--model", "x"])).toBe("default");
  });
});

describe("parseLaunchThink", () => {
  it("reads a valid --think level, else undefined", () => {
    expect(parseLaunchThink(["--think", "high"])).toBe("high");
    expect(parseLaunchThink(["--think", "off"])).toBe("off");
    expect(parseLaunchThink(["--think", "bogus"])).toBeUndefined();
    expect(parseLaunchThink(["--model", "x"])).toBeUndefined();
  });
});

describe("/mcp (W3.5)", () => {
  it("parses status / reconnect / toggle forms", () => {
    expect(parseMcpArgs("")).toEqual({ kind: "status" });
    expect(parseMcpArgs("reconnect linear")).toEqual({ kind: "reconnect", name: "linear" });
    expect(parseMcpArgs("toggle linear off")).toEqual({ kind: "toggle", name: "linear", enabled: false });
    expect(parseMcpArgs("toggle linear on")).toEqual({ kind: "toggle", name: "linear", enabled: true });
    expect(parseMcpArgs("toggle linear")).toBeNull();       // missing on|off
    expect(parseMcpArgs("bogus")).toBeNull();
  });
  it("formats status rows and the empty case", () => {
    expect(formatMcpStatus([]).map((l) => l.text)).toEqual(["mcp: no servers"]);
    const lines = formatMcpStatus([{ name: "linear", status: "connected" }]).map((l) => l.text);
    expect(lines[0]).toBe("MCP servers");
    expect(lines[1]).toContain("linear");
    expect(lines[1]).toContain("connected");
    expect(formatMcpUsage()[0].text).toContain("advisory");
  });
  it("is a registered command", () => {
    expect(COMMANDS.some((c) => c.name === "mcp")).toBe(true);
  });
});
