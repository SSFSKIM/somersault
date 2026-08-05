import { describe, it, expect } from "vitest";
import { commandKind, toCatalogEntry, mergeCommands, rankCommands, type CommandEntry } from "../../src/tui/commandComplete.js";

const cat = (name: string, description = ""): CommandEntry => ({ name, description, source: "catalog" });
const loc = (name: string): CommandEntry => ({ name, description: name, source: "local" });

describe("commandComplete", () => {
  it("toCatalogEntry normalizes object + string shapes; null on bad input", () => {
    expect(toCatalogEntry({ name: "review", description: "do a review", argumentHint: "<pr>" })).toEqual({ name: "review", description: "do a review", argumentHint: "<pr>", source: "catalog" });
    expect(toCatalogEntry("brainstorming")).toEqual({ name: "brainstorming", description: "", argumentHint: undefined, source: "catalog" });
    expect(toCatalogEntry({ description: "no name" })).toBeNull();
    expect(toCatalogEntry(null)).toBeNull();
  });
  it("mergeCommands keeps local first and local wins on a name collision", () => {
    const merged = mergeCommands([loc("model"), loc("help")], [cat("review"), cat("help")]);
    expect(merged.map((c) => c.name)).toEqual(["model", "help", "review"]);   // catalog "help" dropped (local wins)
    expect(merged.find((c) => c.name === "help")!.source).toBe("local");
  });
  it("rankCommands returns the first N for an empty query and fuzzy-filters otherwise", () => {
    const entries = [cat("brainstorming"), cat("writing-plans"), cat("review"), cat("ship")];
    expect(rankCommands(entries, "", 2).map((c) => c.name)).toEqual(["brainstorming", "writing-plans"]);
    expect(rankCommands(entries, "rev")[0].name).toBe("review");
  });
});

// ── DG55: the kind a command row carries into the popup's kind lane (`p9f`, bundle L489891) ─────────────
describe("commandKind — p9f (L489891) over ZLb (L489916)", () => {
  it("a LOCAL entry takes p9f's else-arm: ZLb[name] ?? 'action'", () => {
    expect(commandKind(loc("model"))).toBe("config");          // ZLb: model → config
    expect(commandKind(loc("mcp"))).toBe("config");
    expect(commandKind(loc("theme"))).toBe("config");
    expect(commandKind(loc("permissions"))).toBe("config");
    expect(commandKind(loc("output-style"))).toBe("config");
    expect(commandKind(loc("keybindings"))).toBe("config");
    expect(commandKind(loc("compact"))).toBe("action");        // ZLb: compact → action
    expect(commandKind(loc("clear"))).toBe("action");
    expect(commandKind(loc("resume"))).toBe("action");
    expect(commandKind(loc("rewind"))).toBe("action");
    expect(commandKind(loc("add-dir"))).toBe("action");
    expect(commandKind(loc("context"))).toBe("info");          // ZLb: context → info
    expect(commandKind(loc("status"))).toBe("info");
    expect(commandKind(loc("usage"))).toBe("info");
    expect(commandKind(loc("diff"))).toBe("info");
    expect(commandKind(loc("session"))).toBe("info");
    expect(commandKind(loc("help"))).toBe("info");
  });
  it("a local name upstream never had falls through ZLb to p9f's 'action' default", () => {
    for (const n of ["cost", "continue", "yolo", "think", "bg", "history", "settings", "allowed-tools", "files", "stats", "tag", "detach", "quit"])
      expect(commandKind(loc(n))).toBe("action");
  });
  it("a CATALOG entry is p9f's `type === 'prompt'` arm — a skill — unless ZLb knows the name", () => {
    expect(commandKind(cat("brainstorming"))).toBe("skill");
    expect(commandKind(cat("writing-plans"))).toBe("skill");
    // `review` and `doctor` really ARE prompt commands upstream and are absent from ZLb — so they stay skills.
    expect(commandKind(cat("review"))).toBe("skill");
    expect(commandKind(cat("doctor"))).toBe("skill");
    // …but the ten client-side controls probe 73 found in the live catalog are in ZLb, and it wins there.
    expect(commandKind(cat("agents"))).toBe("config");
    expect(commandKind(cat("color"))).toBe("config");
    expect(commandKind(cat("effort"))).toBe("config");
    expect(commandKind(cat("fast"))).toBe("config");
    expect(commandKind(cat("extra-usage"))).toBe("config");
    expect(commandKind(cat("heapdump"))).toBe("action");
  });
  it("ZLb's fourth bucket exists too — the agent commands", () => {
    expect(commandKind(cat("tasks"))).toBe("agent");
    expect(commandKind(cat("autopilot"))).toBe("agent");
    expect(commandKind(cat("workflows"))).toBe("agent");
  });
});
