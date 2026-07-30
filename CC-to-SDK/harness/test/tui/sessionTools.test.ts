// tui/test/sessionTools.test.ts — pure U5 helpers: export markdown, files-in-context.
import { describe, it, expect } from "vitest";
import { exportMarkdown, defaultExportName, filesInContext, formatFiles } from "../../src/tui/sessionTools.js";

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
});
