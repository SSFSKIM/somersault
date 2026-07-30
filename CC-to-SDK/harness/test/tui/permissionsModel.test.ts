// test/tui/permissionsModel.test.ts — the pure `/permissions` model (Wave 3 task 7): ruleRows/workspaceRows
// (Step 1's pinned interfaces), plus removeFromArray/appendDenial (this file's own supporting pure exports,
// each independently exercised the same way settingsFile.test.ts covers appendToArray). No React/session —
// everything here runs against plain data, matching settingsRows.test.ts's own convention for this package.
import { describe, it, expect } from "vitest";
import { ruleRows, workspaceRows, removeFromArray, appendDenial, SOURCE_LABELS, type DenialEntry } from "../../src/tui/permissionsModel.js";

describe("SOURCE_LABELS", () => {
  it("carries the exact verbatim label set (Global Constraints line 34's own table)", () => {
    expect(SOURCE_LABELS).toEqual({
      userSettings: "user settings", projectSettings: "shared project settings", localSettings: "project local settings",
      flagSettings: "command line arguments", policySettings: "enterprise managed settings", cliArg: "CLI argument",
      command: "command configuration", session: "current session", toolsNarrowing: "CLI tool narrowing", mcpServerPolicy: "MCP server policy",
    });
  });
});

describe("ruleRows", () => {
  it("no sources array (missing/malformed get_settings response) → []", () => {
    expect(ruleRows({}, "allow")).toEqual([]);
    expect(ruleRows(undefined, "allow")).toEqual([]);
    expect(ruleRows({ sources: "not-an-array" }, "allow")).toEqual([]);
  });

  it("merges rules across MULTIPLE sources for the same behavior, tagging each with its own source", () => {
    const settings = {
      sources: [
        { source: "flagSettings", settings: { permissions: { allow: ["WebFetch"] } } },
        { source: "userSettings", settings: { permissions: { allow: ["Bash(ls *)"] } } },
        { source: "policySettings", settings: { permissions: { deny: ["Bash(rm *)"] } } },   // different behavior — must not leak into "allow"
      ],
    };
    const rows = ruleRows(settings, "allow");
    expect(rows).toEqual([
      { rule: "Bash(ls *)", source: "userSettings", readOnly: true },
      { rule: "WebFetch", source: "flagSettings", readOnly: false },
    ]);
  });

  it("readOnly is false ONLY for the flagSettings source — every other source (incl. unknown ones) is readOnly", () => {
    const settings = {
      sources: [
        { source: "flagSettings", settings: { permissions: { ask: ["Read"] } } },
        { source: "cliArg", settings: { permissions: { ask: ["Grep"] } } },
        { source: "someFutureSource", settings: { permissions: { ask: ["Glob"] } } },
      ],
    };
    const rows = ruleRows(settings, "ask");
    expect(rows.find((r) => r.rule === "Read")!.readOnly).toBe(false);
    expect(rows.find((r) => r.rule === "Grep")!.readOnly).toBe(true);
    expect(rows.find((r) => r.rule === "Glob")!.readOnly).toBe(true);
  });

  it("sorts case-insensitively", () => {
    const settings = { sources: [{ source: "flagSettings", settings: { permissions: { deny: ["zsh", "Bash", "apple"] } } }] };
    expect(ruleRows(settings, "deny").map((r) => r.rule)).toEqual(["apple", "Bash", "zsh"]);
  });

  it("a source with no permissions, or no array for this behavior, contributes nothing (no throw)", () => {
    const settings = {
      sources: [
        { source: "userSettings", settings: {} },
        { source: "projectSettings", settings: { permissions: {} } },
        { source: "localSettings", settings: { permissions: { allow: "not-an-array" } } },
        { source: 42, settings: { permissions: { allow: ["ignored — non-string source"] } } },
      ],
    };
    expect(ruleRows(settings, "allow")).toEqual([]);
  });

  it("non-string entries inside a rules array are skipped, not crashed on", () => {
    const settings = { sources: [{ source: "flagSettings", settings: { permissions: { allow: ["Real", 42, null, { odd: true }] } } }] };
    expect(ruleRows(settings, "allow")).toEqual([{ rule: "Real", source: "flagSettings", readOnly: false }]);
  });
});

describe("workspaceRows", () => {
  it("cwd → dim-suffixed '(Original working directory)', path segment plain", () => {
    const [line] = workspaceRows([{ path: "/repo", source: "cwd" }]);
    expect(line.text).toBe("/repo (Original working directory)");
    expect(line.segments).toEqual([{ text: "/repo" }, { text: " (Original working directory)", dim: true }]);
  });

  it("launch → dim-suffixed '(from launch config)' (ours, not upstream copy)", () => {
    const [line] = workspaceRows([{ path: "/launch-dir", source: "launch" }]);
    expect(line.text).toBe("/launch-dir (from launch config)");
    expect(line.segments).toEqual([{ text: "/launch-dir" }, { text: " (from launch config)", dim: true }]);
  });

  it("session → plain path, no suffix, no segments (the removable ones)", () => {
    const [line] = workspaceRows([{ path: "/session-dir", source: "session" }]);
    expect(line.text).toBe("/session-dir");
    expect(line.segments).toBeUndefined();
  });

  it("preserves row order and handles a mix in one call", () => {
    const lines = workspaceRows([{ path: "/a", source: "cwd" }, { path: "/b", source: "launch" }, { path: "/c", source: "session" }]);
    expect(lines.map((l) => l.text)).toEqual(["/a (Original working directory)", "/b (from launch config)", "/c"]);
  });
});

describe("removeFromArray", () => {
  it("removes the value when present, leaving siblings untouched", () => {
    const patch = removeFromArray(["permissions", "allow"], "WebFetch");
    const next = patch({ theme: "dark", permissions: { allow: ["WebFetch", "Bash"], deny: ["Read"] } });
    expect(next).toEqual({ theme: "dark", permissions: { allow: ["Bash"], deny: ["Read"] } });
  });

  it("value absent → no-op (array unchanged, still a fresh clone)", () => {
    const original = { permissions: { allow: ["Bash"] } };
    const patch = removeFromArray(["permissions", "allow"], "NotThere");
    const next = patch(original);
    expect(next).toEqual({ permissions: { allow: ["Bash"] } });
    expect(next).not.toBe(original);          // still a clone, not a write-through
  });

  it("missing path (nothing to remove from) → yields an empty array there, no throw", () => {
    const patch = removeFromArray(["permissions", "allow"], "X");
    expect(patch({})).toEqual({ permissions: { allow: [] } });
  });

  it("does not mutate the input object or its nested arrays", () => {
    const original = { permissions: { allow: ["keep", "drop"] } };
    const keepArr = original.permissions.allow;
    const patch = removeFromArray(["permissions", "allow"], "drop");
    const next = patch(original);
    expect(original.permissions.allow).toBe(keepArr);           // same reference — untouched
    expect(original.permissions.allow).toEqual(["keep", "drop"]);
    expect(next.permissions.allow).toEqual(["keep"]);
  });
});

describe("appendDenial", () => {
  const base: DenialEntry[] = [];

  it("only records decision === 'deny' — allow/question/plan outcomes are no-ops (same reference back)", () => {
    expect(appendDenial(base, "allow_once", "Bash", { command: "ls" }, "me", 1)).toBe(base);
    expect(appendDenial(base, "allow_always", "Bash", { command: "ls" }, "me", 1)).toBe(base);
    expect(appendDenial(base, "question_answer", "AskUserQuestion", {}, "me", 1)).toBe(base);
    expect(appendDenial(base, "plan_approve", "ExitPlanMode", {}, "me", 1)).toBe(base);
  });

  it("a deny appends {display, by, at}, display = toolName(targetSummary) via render.ts's own toolTarget", () => {
    const ledger = appendDenial([], "deny", "Bash", { command: "rm -rf /" }, "auto", 1000);
    expect(ledger).toEqual([{ display: "Bash(rm -rf /)", by: "auto", at: 1000 }]);
  });

  it("Edit/Write/Read summarize by file_path (matches toolTarget's own tool-specific rule)", () => {
    const ledger = appendDenial([], "deny", "Edit", { file_path: "src/x.ts" }, "auto", 2000);
    expect(ledger).toEqual([{ display: "Edit(src/x.ts)", by: "auto", at: 2000 }]);
  });

  it("an unrecognized tool falls back to the first input value (toolTarget's generic case)", () => {
    const ledger = appendDenial([], "deny", "WebFetch", { url: "https://example.com" }, "auto", 3000);
    expect(ledger).toEqual([{ display: "WebFetch(https://example.com)", by: "auto", at: 3000 }]);
  });

  it("caps at the 20 most recent entries — oldest evicted first", () => {
    let ledger: DenialEntry[] = [];
    for (let i = 0; i < 25; i++) ledger = appendDenial(ledger, "deny", "Bash", { command: `cmd${i}` }, "auto", i);
    expect(ledger).toHaveLength(20);
    expect(ledger[0].display).toBe("Bash(cmd5)");      // entries 0-4 evicted
    expect(ledger[19].display).toBe("Bash(cmd24)");
  });
});
