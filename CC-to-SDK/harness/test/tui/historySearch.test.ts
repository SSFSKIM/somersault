import { describe, it, expect } from "vitest";
import { HISTORY_SCOPES, nextScope, promptEntries, mergeEntries, rankHistory, ageLabel } from "../../src/tui/historySearch.js";

// rowKind counts a user row as a prompt only WITH a uuid (Wave-1 fixture rule).
const prompt = (text: string, uuid = "u1", timestamp?: string) =>
  ({ type: "user", uuid, ...(timestamp ? { timestamp } : {}), message: { content: text } });

describe("scopes", () => {
  it("cycle session → project → everywhere → session (bundle SDo order)", () => {
    expect(HISTORY_SCOPES).toEqual(["session", "project", "everywhere"]);
    expect(nextScope("session")).toBe("project");
    expect(nextScope("everywhere")).toBe("session");
  });
});

describe("promptEntries", () => {
  it("extracts prompt rows only, newest first, row timestamp preferred over fallback", () => {
    const msgs = [
      prompt("first", "u1", "2026-07-31T10:00:00Z"),
      { type: "user", uuid: "u2", message: { content: [{ type: "tool_result", tool_use_id: "t", content: "x" }] } },
      { type: "user", uuid: "u3", message: { content: "<command-name>/help</command-name>" } },
      { type: "assistant", message: { content: [{ type: "text", text: "reply" }] } },
      prompt("second", "u4"),
    ];
    const es = promptEntries(msgs, 999);
    expect(es.map((e) => e.text)).toEqual(["second", "first"]);
    expect(es[1].ts).toBe(Date.parse("2026-07-31T10:00:00Z"));
    expect(es[0].ts).toBe(999);
  });
  it("skips blank prompts", () => {
    expect(promptEntries([prompt("   ")], 1)).toEqual([]);
  });
});

describe("mergeEntries", () => {
  it("merges newest-first across lists and dedupes exact texts keeping the newest", () => {
    const merged = mergeEntries([
      [{ text: "deploy", ts: 100 }, { text: "old", ts: 50 }],
      [{ text: "deploy", ts: 200 }, { text: "new", ts: 150 }],
    ]);
    expect(merged).toEqual([{ text: "deploy", ts: 200 }, { text: "new", ts: 150 }, { text: "old", ts: 50 }]);
  });
});

describe("rankHistory — substring class before subsequence class (bundle oDb)", () => {
  const es = [{ text: "fix the tests", ts: 3 }, { text: "run typecheck", ts: 2 }, { text: "tweak espresso settings", ts: 1 }];
  it("empty query returns everything in order", () => {
    expect(rankHistory(es, "  ")).toEqual(es);
  });
  it("substring matches come first, subsequence matches after, order kept within class", () => {
    // "tes": substring of "fix the tests"; subsequence of "tweak espresso settings" (t…e…s); not in "run typecheck" (no s after e).
    expect(rankHistory(es, "tes").map((e) => e.text)).toEqual(["fix the tests", "tweak espresso settings"]);
  });
  it("case-insensitive; no match → empty", () => {
    expect(rankHistory(es, "TYPECHECK").map((e) => e.text)).toEqual(["run typecheck"]);
    expect(rankHistory(es, "zzz")).toEqual([]);
  });
});

describe("ageLabel", () => {
  it("s/m/h/d buckets", () => {
    const now = 1_000_000_000_000;
    expect(ageLabel(now - 30_000, now)).toBe("30s");
    expect(ageLabel(now - 5 * 60_000, now)).toBe("5m");
    expect(ageLabel(now - 3 * 3_600_000, now)).toBe("3h");
    expect(ageLabel(now - 50 * 3_600_000, now)).toBe("2d");
  });
});
