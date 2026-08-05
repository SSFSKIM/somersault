// test/unit/commands-aliases.test.ts — the command-alias mechanism introduced by F6 T10 (upstream's own
// descriptor field: `{name:"rewind", aliases:["checkpoint","undo"]}`, bundle L353066). Three properties, and
// all three have to hold together or an alias is a trap rather than a shortcut:
//   · it DISPATCHES  — `canonicalCommand` maps it to the arm that implements it;
//   · it stays LOCAL — `LOCAL_NAMES` contains it, so typing it never forwards the word to the model;
//   · it COMPLETES   — the palette narrows to the CANONICAL row, and never grows a duplicate row for it.
import { describe, it, expect } from "vitest";
import { COMMANDS, LOCAL_NAMES, LOCAL_COMMAND_ENTRIES, canonicalCommand } from "../../src/tui/commands.js";
import { rankCommands, toCatalogEntry, mergeCommands, type CommandEntry } from "../../src/tui/commandComplete.js";

const entry = (name: string, aliases?: string[]): CommandEntry => ({ name, description: "", source: "local", ...(aliases ? { aliases } : {}) });

describe("command aliases", () => {
  it("/rewind declares upstream's two aliases", () => {
    const rewind = COMMANDS.find((c) => c.name === "rewind");
    expect(rewind?.aliases).toEqual(["checkpoint", "undo"]);
  });

  it("canonicalCommand maps an alias to its command and leaves everything else alone", () => {
    expect(canonicalCommand("checkpoint")).toBe("rewind");
    expect(canonicalCommand("undo")).toBe("rewind");
    expect(canonicalCommand("rewind")).toBe("rewind");
    expect(canonicalCommand("status")).toBe("status");
    expect(canonicalCommand("not-a-command")).toBe("not-a-command");   // unknown names pass through for formatUnknown
  });

  it("aliases are LOCAL names — dispatch must never submit /undo to the model as a prompt", () => {
    expect(LOCAL_NAMES.has("checkpoint")).toBe(true);
    expect(LOCAL_NAMES.has("undo")).toBe(true);
  });

  it("aliases ride on the canonical entry, not on rows of their own", () => {
    const rows = LOCAL_COMMAND_ENTRIES.filter((e) => e.name === "checkpoint" || e.name === "undo");
    expect(rows).toEqual([]);
    expect(LOCAL_COMMAND_ENTRIES.find((e) => e.name === "rewind")?.aliases).toEqual(["checkpoint", "undo"]);
  });

  it("completion: typing an alias surfaces the canonical row exactly once", () => {
    const ranked = rankCommands(LOCAL_COMMAND_ENTRIES, "undo");
    expect(ranked.filter((e) => e.name === "rewind")).toHaveLength(1);
    expect(ranked[0]?.name).toBe("rewind");
    expect(ranked.some((e) => e.name === "undo")).toBe(false);
    expect(rankCommands(LOCAL_COMMAND_ENTRIES, "checkpoint")[0]?.name).toBe("rewind");
  });

  it("completion: a name still outranks a foreign alias that happens to fuzzy-match", () => {
    const entries = [entry("status"), entry("rewind", ["undo"])];
    expect(rankCommands(entries, "status")[0]?.name).toBe("status");
  });

  it("completion: one candidate owned by two commands surfaces BOTH (no silent shadowing)", () => {
    const entries = [entry("alpha", ["shared"]), entry("beta", ["shared"])];
    const ranked = rankCommands(entries, "shared");
    expect(ranked.map((e) => e.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("completion: the cap counts ROWS, not scored candidates", () => {
    // Without the fold-then-cap order the alias hit and its own canonical row eat two of the three slots.
    const entries = [entry("rewind", ["undo", "checkpoint"]), entry("undoubtedly"), entry("undock")];
    expect(rankCommands(entries, "und", 3)).toHaveLength(3);
  });

  it("an empty query is untouched by the alias machinery (catalog order, capped)", () => {
    const entries = [entry("a", ["x"]), entry("b")];
    expect(rankCommands(entries, "").map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("toCatalogEntry carries a live catalog command's aliases through, and tolerates junk", () => {
    expect(toCatalogEntry({ name: "rewind", aliases: ["undo", 7, ""] })?.aliases).toEqual(["undo"]);
    expect(toCatalogEntry({ name: "plain" })?.aliases).toBeUndefined();
    expect(toCatalogEntry({ name: "odd", aliases: "undo" })?.aliases).toBeUndefined();
  });

  it("merge still lets a local entry win a name collision, aliases included", () => {
    const merged = mergeCommands([entry("rewind", ["undo"])], [toCatalogEntry({ name: "rewind", aliases: ["nope"] })!]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.aliases).toEqual(["undo"]);
  });
});
