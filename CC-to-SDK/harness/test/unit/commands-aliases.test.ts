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

  // F6 T13 (DG61): upstream's `/tasks` + `/bashes` reach OUR canonical `/bg`, which stays the name the
  // dispatch switch is written against (bundle L350769 is the upstream row; the keep-decision is in commands.ts).
  it("/bg takes upstream's /tasks and /bashes as aliases, and all three dispatch to the bg arm", () => {
    expect(COMMANDS.find((c) => c.name === "bg")?.aliases).toEqual(["tasks", "bashes"]);
    expect(canonicalCommand("tasks")).toBe("bg");
    expect(canonicalCommand("bashes")).toBe("bg");
    expect(canonicalCommand("bg")).toBe("bg");
    expect(LOCAL_NAMES.has("tasks")).toBe(true);
    expect(LOCAL_NAMES.has("bashes")).toBe(true);
    expect(LOCAL_COMMAND_ENTRIES.filter((e) => e.name === "tasks" || e.name === "bashes")).toEqual([]);
    expect(rankCommands(LOCAL_COMMAND_ENTRIES, "bashes")[0]?.name).toBe("bg");
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
    // The fixture has to make ONE entry win TWO candidate slots, or cap-before-fold and cap-after-fold agree
    // and the test proves nothing: `undo-thing` is hit by its NAME and by its alias `undo`, so a cap applied
    // to the scored candidates would spend two of the three slots on one row and return two rows for a cap
    // of three (t10 review, minor 3).
    const entries = [entry("undo-thing", ["undo"]), entry("undoubtedly"), entry("undock")];
    const ranked = rankCommands(entries, "und", 3);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((e) => e.name).sort()).toEqual(["undo-thing", "undock", "undoubtedly"]);
  });

  it("completion: nothing is capped away before the fold — every command stays REACHABLE past 50 candidates", () => {
    // `rankCandidates`' own default cap is 50 (fileComplete.ts:123). Passing the candidate count explicitly is
    // what keeps a >50-command catalog whole; commandComplete's existing doc comment is about exactly this
    // failure ("a cap here does not merely shorten the view — it makes the tail of the catalog UNREACHABLE").
    const entries = Array.from({ length: 80 }, (_, i) => entry(`cmd${String(i).padStart(2, "0")}`));
    expect(rankCommands(entries, "cmd")).toHaveLength(80);
    expect(rankCommands(entries, "cmd79").map((e) => e.name)).toContain("cmd79");
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
