// tui/test/commands.test.ts — pure parser + formatters.
import { describe, it, expect } from "vitest";
import { parseCommand, COMMANDS, formatModel, formatThink, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, parseMcpArgs, formatMcpStatus, formatMcpUsage, pickMostRecent, parseLaunchMode, parseLaunchThink, LOCAL_NAMES, LOCAL_COMMAND_ENTRIES } from "../../src/tui/commands.js";
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
  it("model: set vs show-current", () => {
    expect(formatModel("opus")).toEqual([{ text: "model → opus" }]);
    expect(formatModel(undefined, "sonnet")).toEqual([{ text: "model: sonnet", dim: true }]);
  });
  it("compact: success shows before→after, failure is dim", () => {
    // `31k`, not `31.0k`: the compaction family takes `formatTokens` (upstream `va`), not `formatCompactNumber`
    // (upstream `_d`) — W-S t7's "one spelling everywhere" rule was wrong and this is the assertion it moved.
    // See the two-forms note in `commands.ts`; `/cost` below still keeps the tenth because `E0y` does.
    expect(formatCompact({ ok: true, preTokens: 31000, postTokens: 6000 })).toEqual([{ text: "✦ compacted 31k → 6k" }]);
    expect(formatCompact({ ok: false, error: "Not enough messages" })[0].dim).toBe(true);
  });
  it("context renders a one-line digest", () => {
    // `200k`, not `200.0k`, and `18.5k` keeps the tenth it earned: `formatTokens` is upstream's `va`, which
    // `Wcn` (L315889) spells this exact used/max pair with. Both halves in one assertion on purpose — the
    // regression this pins is a whole-number rounding up to `.0`, which only shows next to a real fraction.
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
  // W-S t7. `/cost` is a TRANSCRIPTION of upstream's `Aze` (cli.pretty.js L217733-217739) and the `E0y`
  // usage block it embeds (L217683-217704) — not the invented `Session cost` / total / tokens / duration
  // layout it replaced. Every value in the block starts at ONE column (23): the four labels are hard-padded
  // there and the model names are `` `${name}:`.padStart(21) `` ahead of a body that opens with two spaces.
  // These assert whole rows rather than substrings on purpose — a row that silently loses its padding still
  // contains every phrase a `toContain` would look for, so only the full string can catch it.
  it("cost: transcribes upstream's four label rows and the per-model usage block", () => {
    const lines = formatCost({ session: {
      total_cost_usd: 1.2345, total_api_duration_ms: 36_000, total_duration_ms: 374_000,
      total_lines_added: 1, total_lines_removed: 12,
      model_usage: { "claude-sonnet-5": { inputTokens: 3600, outputTokens: 914, cacheReadInputTokens: 439_700,
        cacheCreationInputTokens: 11_400, webSearchRequests: 2, costUSD: 0.2246, contextWindow: 200_000, maxOutputTokens: 64_000 } },
    }, subscription_type: null });
    expect(lines.map((l) => l.text)).toEqual([
      "Total cost:            $1.23",
      "Total duration (API):  36s",
      "Total duration (wall): 6m 14s",
      "Total code changes:    1 line added, 12 lines removed",
      "Usage by model:",
      "     claude-sonnet-5:  3.6k input, 914 output, 439.7k cache read, 11.4k cache write, 2 web search ($0.2246)",
    ]);
    expect(lines.every((l) => l.dim === true)).toBe(true);   // upstream wraps the whole block in `vt.dim`
  });
  it("cost: omits the web-search clause when the count is zero, and folds by canonical model", () => {
    const lines = formatCost({ session: { total_cost_usd: 0.0123, model_usage: {
      "claude-opus-5-20260101": { inputTokens: 700, outputTokens: 140, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.0100, canonicalModel: "claude-opus-5" },
      "claude-opus-5":          { inputTokens: 500, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.0023, canonicalModel: "claude-opus-5" },
    } }, subscription_type: null }).map((l) => l.text);
    expect(lines.slice(4)).toEqual(["Usage by model:", "       claude-opus-5:  1.2k input, 340 output, 0 cache read, 0 cache write ($0.0123)"]);
    expect(lines.join("\n")).not.toContain("web search");
  });
  it("cost: with no model usage at all prints upstream's single `Usage:` line", () => {
    expect(formatCost({ session: { total_cost_usd: 0, model_usage: {} }, subscription_type: null }).map((l) => l.text)).toEqual([
      "Total cost:            $0.0000",
      "Total duration (API):  0s",
      "Total duration (wall): 0s",
      "Total code changes:    0 lines added, 0 lines removed",
      "Usage:                 0 input, 0 output, 0 cache read, 0 cache write",
    ]);
  });
  // W-S t7 review. `/cost`'s half of the per-surface formatter pin (`/stats`'s lives in sessionTools.test.ts;
  // `/context` and `/compact` are pinned onto `formatTokens` above). Every count in the transcription tests
  // carries a real fraction — `3.6k`, `439.7k`, `1.2k` — and BOTH compact forms spell those identically, so
  // none of them can tell `_d` from `va`. Only a ROUND four-figure count can: `E0y` (L217696) is a `_d` site,
  // so `5000` must read `5.0k` and never `5k`.
  it("cost: usage counts keep `_d`'s mandatory tenth (`5.0k`), not `va`'s `5k`", () => {
    const lines = formatCost({ session: { total_cost_usd: 0.1, model_usage: { "claude-opus-5": {
      inputTokens: 5000, outputTokens: 2000, cacheReadInputTokens: 90_000, cacheCreationInputTokens: 1000, webSearchRequests: 0, costUSD: 0.1 } } } }).map((l) => l.text);
    expect(lines[5]).toBe("       claude-opus-5:  5.0k input, 2.0k output, 90.0k cache read, 1.0k cache write ($0.1000)");
  });
  it("cost: subscription auth puts the plan in the transcribed row's value slot (deliberate divergence)", () => {
    const lines = formatCost({ session: { total_cost_usd: 0, model_usage: {} }, subscription_type: "max" }).map((l) => l.text);
    expect(lines[0]).toBe("Total cost:            included in your max plan");   // the row keeps upstream's padding
    expect(lines[1]).toBe("Total duration (API):  0s");                          // and the rest of the block is untouched
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
  // A GUARD, not evidence for EP-S2 — it passes before and after the host fix, because the formatter was
  // never the broken half. It exists so nobody deletes the `if (s.sessionId)` gate the fix now feeds:
  // the row must appear the moment an id exists, and stay absent while it does not.
  it("status: prints the session row once an id exists, and omits it entirely before (EP-S2 guard)", () => {
    const withId = formatStatus({ mode: "default", thinkLevel: "default", sessionId: "0d7a7a9d-1111-2222-3333-444455556666" }).map((l) => l.text).join("\n");
    expect(withId).toContain("session    0d7a7a9d");
    expect(formatStatus({ mode: "default", thinkLevel: "default" }).map((l) => l.text).join("\n")).not.toContain("session");
  });
  // FSW T5, acceptance F9 quoted: "`/status` names the renderer, its provenance reason, and which correction
  // stack is live (§A2a)." All three in one row, byte-pinned — the reason word is the whole point of the row
  // (a user who cannot see WHY the renderer is what it is cannot tell a deliberate pin from a silent
  // fallback), and the padding puts it in the same label column as every row above it.
  it("status: names the renderer, its provenance reason and the live correction stack", () => {
    const lines = formatStatus({ mode: "default", renderer: { mode: "classic", reason: "default_off" } }).map((l) => l.text);
    expect(lines.at(-1)).toBe("  renderer   classic (default_off) · corrections: main-screen stack");
    // The reason travels verbatim: a tmux -CC launch must not read as "the default did this".
    expect(formatStatus({ mode: "default", renderer: { mode: "classic", reason: "tmux_cc_off" } }).map((l) => l.text).at(-1))
      .toBe("  renderer   classic (tmux_cc_off) · corrections: main-screen stack");
    // FSW T9 — and the OTHER stack is real now. Fullscreen constructs none of the main-screen machinery
    // (chatMain's gate); what it has instead is the fixed frame plus D21's post-resize erase, and this row is
    // where a launch that somehow ran one screen's stack under the other screen would be visible.
    expect(formatStatus({ mode: "default", renderer: { mode: "fullscreen", reason: "env_on" } }).map((l) => l.text).at(-1))
      .toBe("  renderer   fullscreen (env_on) · corrections: alt-screen repaint contract");
    // No decision to report → no row, like every other optional row here. Not a guessed "classic".
    expect(formatStatus({ mode: "default" }).map((l) => l.text).join("\n")).not.toContain("renderer");
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

describe("/detach (F0 KB5 — detach moved off Ctrl-Z)", () => {
  it("is a registered command, in LOCAL_NAMES, and in the palette entries", () => {
    expect(COMMANDS.some((c) => c.name === "detach")).toBe(true);
    expect(LOCAL_NAMES.has("detach")).toBe(true);
    expect(LOCAL_COMMAND_ENTRIES.some((e) => e.name === "detach")).toBe(true);
  });
});

describe("/config key=value (W3 T6)", () => {
  const FRESH_CTX: SettingsRowCtx = { theme: "dark", model: undefined, outputStyle: "default", mode: "default", thinkLevel: "default", showTurnDuration: true, promptSuggestionEnabled: false };
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

  // W-C T7's second boolean row — the same generic arm, reached through its own id.
  it("showTurnDuration=false is a validated set, and repeating it against an off row is the 'already off' notice", () => {
    const r = parseConfigArg("showTurnDuration=false", freshRows());
    expect(r.kind).toBe("set");
    expect((r as any).id).toBe("showTurnDuration");
    expect((r as any).value).toBe("false");
    const off = parseConfigArg("showTurnDuration=false", buildRows({ ...FRESH_CTX, showTurnDuration: false }));
    expect(off).toEqual({ kind: "error", lines: [{ text: "showTurnDuration is already off.", dim: true }] });
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
    // F2 task 9 retired the W3 divergence: the file IS our customization surface now, so this is upstream's
    // own "Open your keyboard shortcuts file" — the read-only keymap is only the no-editor fallback.
    expect(byName.keybindings).toBe("open your keyboard shortcuts file (~/.claude/keybindings.json)");
    expect(LOCAL_NAMES.has("settings")).toBe(true);
    expect(LOCAL_NAMES.has("output-style")).toBe(true);
    expect(LOCAL_NAMES.has("keybindings")).toBe(true);
  });
});

describe("U1 client-side honesty (Wave 1)", () => {
  // "config" left this list in Wave 3 task 5: /config now opens a real Settings dialog instead of printing
  // an honesty note (the note's own text said as much: "it arrives with the settings slice").
  // "effort" left it in WAVE C TASK 11 for the same reason and by the same route: `/effort` is a real local
  // command now — it opens the EffortDialog and drives `applyFlagSettings({effortLevel})` through the
  // `set_effort` wire op (probe 102). Its old note redirected the user to `/think`, which was true only
  // while the effort axis was unreachable.
  it("covers exactly the five remaining client-side controls", () => {
    expect(Object.keys(CLIENT_SIDE_NOTES).sort()).toEqual(
      ["agents", "color", "extra-usage", "fast", "heapdump"]);
    expect(CLIENT_SIDE_NOTES).not.toHaveProperty("effort");
    expect(LOCAL_NAMES.has("effort")).toBe(true);                // …and it dispatches locally instead
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
