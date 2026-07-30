// tui/test/commands.test.ts — pure parser + formatters.
import { describe, it, expect } from "vitest";
import { parseCommand, COMMANDS, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, parseMcpArgs, formatMcpStatus, formatMcpUsage, pickMostRecent, parseResumeIntent, parseLaunchMode, parseLaunchThink, LOCAL_NAMES, LOCAL_COMMAND_ENTRIES } from "../../src/tui/commands.js";
import { CLIENT_SIDE_NOTES, formatClientSide } from "../../src/tui/commands.js";
import { parseConfigArg } from "../../src/tui/commands.js";
import { buildRows, type SettingsRowCtx } from "../../src/tui/settingsRows.js";

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

  it("renders the usage row only when a usage summary is passed", () => {
    const base = { model: "m", mode: "default", thinkLevel: "high", ctxPct: 1, sessionId: "s", cwd: "/x" };
    const withUsage = formatStatus({ ...base, usage: "5h 43% · 7d 12%" }).map((l) => l.text).join("\n");
    expect(withUsage).toContain("usage");
    expect(withUsage).toContain("5h 43% · 7d 12%");
    expect(formatStatus(base).map((l) => l.text).join("\n")).not.toContain("usage");
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

describe("/bg (Goal B task 7)", () => {
  it("is a registered command, in LOCAL_NAMES, and in the palette entries", () => {
    expect(COMMANDS.some((c) => c.name === "bg")).toBe(true);
    expect(LOCAL_NAMES.has("bg")).toBe(true);
    expect(LOCAL_COMMAND_ENTRIES.some((e) => e.name === "bg")).toBe(true);
  });
});

describe("/config key=value (W3 T6)", () => {
  const FRESH_CTX: SettingsRowCtx = { theme: "dark", model: undefined, outputStyle: "default", mode: "default", thinkLevel: "default" };
  const freshRows = () => buildRows(FRESH_CTX);

  it("no arg → open", () => {
    expect(parseConfigArg("", freshRows())).toEqual({ kind: "open" });
    expect(parseConfigArg("   ", freshRows())).toEqual({ kind: "open" });
  });

  it("malformed (no '=') → the exact usage error", () => {
    const r = parseConfigArg("nonsense", freshRows());
    expect(r.kind).toBe("error");
    expect((r as any).lines[0].text).toBe(`Expected key=value, got "nonsense". Run /config to see what's available.`);
  });

  it("unknown key → the exact 'isn't a /config setting' error", () => {
    const r = parseConfigArg("bogus=1", freshRows());
    expect(r.kind).toBe("error");
    expect((r as any).lines[0].text).toBe(`bogus isn't a /config setting. Run /config to see what's available.`);
  });

  it("thinking (boolean) rejects a non-true/false value", () => {
    const r = parseConfigArg("thinking=maybe", freshRows());
    expect(r.kind).toBe("error");
    expect((r as any).lines[0].text).toBe(`thinking takes true or false, not "maybe".`);
  });

  it("thinking=false against a row already off → the 'already off' notice, not a set", () => {
    const offRows = buildRows({ ...FRESH_CTX, thinkLevel: "off" });   // row.value === "false" already
    const r = parseConfigArg("thinking=false", offRows);
    expect(r).toEqual({ kind: "error", lines: [{ text: "thinking is already off.", dim: true }] });
  });

  it("thinking=false against a row currently on → a validated set", () => {
    const r = parseConfigArg("thinking=false", freshRows());   // FRESH_CTX.thinkLevel is "default" → row.value "true"
    expect(r.kind).toBe("set");
    expect((r as any).id).toBe("thinking");
    expect((r as any).value).toBe("false");
    expect((r as any).lines).toEqual([{ text: "Set thinking to false" }]);
  });

  it("permissionMode (enum) rejects an out-of-domain value, listing the exact 4 options", () => {
    const r = parseConfigArg("permissionMode=weird", freshRows());
    expect(r.kind).toBe("error");
    expect((r as any).lines[0].text).toBe("permissionMode takes one of: default, acceptEdits, plan, auto.");
  });

  it("permissionMode accepts a valid option", () => {
    const r = parseConfigArg("permissionMode=acceptEdits", freshRows());
    expect(r).toEqual({ kind: "set", id: "permissionMode", value: "acceptEdits", lines: [{ text: "Set permissionMode to acceptEdits" }] });
  });

  it("theme (managedEnum) rejects an id outside theme.ts's own THEME_LABELS domain", () => {
    const r = parseConfigArg("theme=bogus", freshRows());
    expect(r.kind).toBe("error");
    expect((r as any).lines[0].text).toBe("theme takes one of: auto, dark, light, dark-daltonized, light-daltonized.");
  });

  it("theme accepts a valid id — 'Set theme to dark'", () => {
    const r = parseConfigArg("theme=dark", freshRows());
    expect(r).toEqual({ kind: "set", id: "theme", value: "dark", lines: [{ text: "Set theme to dark" }] });
  });

  it("model and outputStyle are free-form (no fixed domain to check against)", () => {
    expect(parseConfigArg("model=claude-opus-4-8", freshRows())).toEqual({ kind: "set", id: "model", value: "claude-opus-4-8", lines: [{ text: "Set model to claude-opus-4-8" }] });
    expect(parseConfigArg("outputStyle=proactive", freshRows())).toEqual({ kind: "set", id: "outputStyle", value: "proactive", lines: [{ text: "Set outputStyle to proactive" }] });
  });

  it("tolerates spaces around '=' and trims the value", () => {
    const r = parseConfigArg("theme = dark ", freshRows());
    expect(r).toEqual({ kind: "set", id: "theme", value: "dark", lines: [{ text: "Set theme to dark" }] });
  });

  it("settings/output-style/keybindings are registered commands with the pinned summaries", () => {
    const byName = Object.fromEntries(COMMANDS.map((c) => [c.name, c.summary]));
    expect(byName.settings).toBe("alias of /config");
    expect(byName["output-style"]).toBe("output style moved to /config");
    expect(byName.keybindings).toBe("open your keyboard shortcuts file");
    expect(LOCAL_NAMES.has("settings")).toBe(true);
    expect(LOCAL_NAMES.has("output-style")).toBe(true);
    expect(LOCAL_NAMES.has("keybindings")).toBe(true);
  });
});

describe("U1 client-side honesty (Wave 1)", () => {
  // "config" left this list in Wave 3 task 5: /config now opens a real Settings dialog instead of printing
  // an honesty note (the note's own text said as much: "it arrives with the settings slice").
  it("covers exactly the six remaining client-side controls", () => {
    expect(Object.keys(CLIENT_SIDE_NOTES).sort()).toEqual(
      ["agents", "color", "effort", "extra-usage", "fast", "heapdump"]);
  });
  it("every note names the command and explains itself", () => {
    for (const name of Object.keys(CLIENT_SIDE_NOTES)) {
      const lines = formatClientSide(name);
      expect(lines).toHaveLength(1);
      expect(lines[0].text.startsWith(`/${name}: `)).toBe(true);
      expect(lines[0].text.length).toBeGreaterThan(`/${name}: `.length + 10);
    }
  });
  it("review and doctor are NOT client-side — they are prompt-type engine commands", () => {
    expect(CLIENT_SIDE_NOTES).not.toHaveProperty("review");
    expect(CLIENT_SIDE_NOTES).not.toHaveProperty("doctor");
  });
});
