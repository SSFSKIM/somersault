// tui/test/commands.test.ts — pure parser + formatters.
import { describe, it, expect } from "vitest";
import { parseCommand, COMMANDS, formatHelp, formatModel, formatCompact, formatContext, formatUnknown, pickMostRecent, parseResumeIntent, parseLaunchMode } from "../src/commands.js";

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
});

describe("resume helpers", () => {
  it("/continue is in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "continue")).toBe(true);
  });
  it("/yolo is in the command table", () => {
    expect(COMMANDS.some((c) => c.name === "yolo")).toBe(true);
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
