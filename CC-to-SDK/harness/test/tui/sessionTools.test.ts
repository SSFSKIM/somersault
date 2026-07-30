// tui/test/sessionTools.test.ts — pure U5 helpers: export markdown, files-in-context, stats, session info.
import { describe, it, expect } from "vitest";
import { exportMarkdown, defaultExportName, filesInContext, formatFiles, formatStats, formatSessionInfo } from "../../src/tui/sessionTools.js";

const msgs = [
  // uuid mirrors a real persisted transcript row — rowKind only classifies a user row as "prompt" when
  // it carries one (rows.ts:28; a uuid-less user row is deliberately "other" per test/unit/rows.test.ts).
  { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "fix the bug" }] } },
  { type: "assistant", message: { content: [
    { type: "text", text: "Looking now." },
    { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/a.ts" } },
  ] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "…" }] } },
  { type: "assistant", message: { content: [
    { type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/repo/b.ts", old_string: "x", new_string: "y" } },
    { type: "text", text: "Done." },
  ] } },
];

describe("exportMarkdown", () => {
  it("renders prompts as headings, assistant text as body, tools as one-line markers; tool_results skipped", () => {
    const md = exportMarkdown(msgs as any[], { id: "abcd1234-rest" });
    expect(md).toContain("## › fix the bug");
    expect(md).toContain("Looking now.");
    expect(md).toContain("Read — /repo/a.ts");
    expect(md).toContain("Done.");
    expect(md).not.toContain("tool_result");
    expect(md.startsWith("# ccx conversation (abcd1234)")).toBe(true);
  });
  it("defaultExportName uses the short id", () => {
    expect(defaultExportName("abcd1234-rest")).toBe("conversation-abcd1234.md");
    expect(defaultExportName(undefined)).toBe("conversation-new.md");
  });
});

describe("filesInContext", () => {
  it("collects file paths from tool_use inputs, deduped, in touch order", () => {
    expect(filesInContext(msgs as any[])).toEqual(["/repo/a.ts", "/repo/b.ts"]);
  });
  it("formatFiles is honest when empty", () => {
    expect(formatFiles([])[0].text).toContain("no files");
    expect(formatFiles(["/x"]).map((l) => l.text).join("\n")).toContain("/x");
  });
  it("orders by LAST touch, not first touch and not alphabetical — a re-touch moves a file later", () => {
    // /repo/z.ts then /repo/a.ts then /repo/z.ts again: alphabetical would give a before z (matches
    // first-touch order here too, so it can't discriminate); last-touch instead puts z LAST because it
    // was re-touched after a.
    const reTouchZ = [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/z.ts" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "/repo/a.ts" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Edit", input: { file_path: "/repo/z.ts", old_string: "x", new_string: "y" } }] } },
    ];
    expect(filesInContext(reTouchZ as any[])).toEqual(["/repo/a.ts", "/repo/z.ts"]);

    // Decisive case: a2 then z2 then a2 again. First-touch order would be [a2, z2]; alphabetical order
    // would also be [a2, z2]. Last-touch is the ONLY ordering that puts z2 before a2 (a2 was re-touched
    // last), so this discriminates last-touch from both other orderings at once.
    const reTouchA2 = [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/a2.ts" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "/repo/z2.ts" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Edit", input: { file_path: "/repo/a2.ts", old_string: "x", new_string: "y" } }] } },
    ];
    expect(filesInContext(reTouchA2 as any[])).toEqual(["/repo/z2.ts", "/repo/a2.ts"]);
  });
});

describe("formatStats / formatSessionInfo", () => {
  it("counts prompts and tool calls and folds per-model usage", () => {
    const u = { session: { total_cost_usd: 0.5, total_duration_ms: 65000, model_usage: {
      "claude-opus-5": { inputTokens: 1000, outputTokens: 200, costUSD: 0.5 } } } };
    const lines = formatStats(u as any, msgs as any[]).map((l) => l.text).join("\n");
    expect(lines).toContain("prompts");
    expect(lines).toContain("2");                            // two tool calls in the fixture
    expect(lines).toContain("claude-opus-5");
  });
  it("session info shows the full id, title/tag when set, and the resume hint", () => {
    const lines = formatSessionInfo({ id: "abcd1234-5678", cwd: "/w",
      info: { summary: "fix bug", customTitle: "bugfix", tag: "sprint", gitBranch: "main", lastModified: 1753858800000 } })
      .map((l) => l.text).join("\n");
    expect(lines).toContain("abcd1234-5678");
    expect(lines).toContain("bugfix");
    expect(lines).toContain("#sprint");
    expect(lines).toContain("ccx --resume abcd1234-5678");
  });
});
