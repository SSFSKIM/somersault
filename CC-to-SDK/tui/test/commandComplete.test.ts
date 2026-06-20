import { describe, it, expect } from "vitest";
import { toCatalogEntry, mergeCommands, rankCommands, type CommandEntry } from "../src/commandComplete.js";

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
