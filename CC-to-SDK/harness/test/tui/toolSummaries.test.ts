// F3 Task 5 (LT1): the typed result rows, one test per census-01 §Q1 template. Every literal here is quoted
// from `~/claude-code-bundle/2.1.220/cli.pretty.js` (line tags in `toolSummaries.ts`), and where a row has BOTH
// a sidecar source and an honest flat fallback, both are driven — sidecar presence is per CALL (P94), so a
// template proven only through its sidecar is a template that breaks on the 132-of-148 flat-only Reads.
import { describe, expect, it } from "vitest";
import { summaryLines } from "../../src/tui/toolSummaries.js";
import { normalizeToolResult } from "../../src/tui/toolResult.js";
import type { RenderLine } from "../../src/tui/render.js";
import type { ProjectionOptions, ResultProjection } from "../../src/tui/toolRenderer.js";
import type { ToolEvent } from "../../src/tui/transcriptModel.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

const base = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
const eventFor = (name: string, input: unknown, content: unknown, sidecar?: unknown, isError = false): ToolEvent => ({
  id: `${name}-1`, name, input, callSequence: 1, route: "top-level",
  result: { content, isError, resultSequence: 2, ...(sidecar === undefined ? {} : { sidecar: { scope: "call" as const, value: sidecar } }) },
});
function rows(event: ToolEvent, projection: ResultProjection = "compact"): readonly RenderLine[] | undefined {
  const verbose = projection === "detail-all";
  const options: ProjectionOptions = { ...base, projection, verbose };
  return summaryLines(event, normalizeToolResult(event, { verbose }), options);
}
const texts = (event: ToolEvent, projection?: ResultProjection) => (rows(event, projection) ?? []).map((line) => line.text);
const one = (event: ToolEvent, projection?: ResultProjection) => texts(event, projection).join("\n");
/** Bold is a SEGMENT, never a `**` literal (F3 Task 1/2): this returns the bolded substrings of every row. */
const bolds = (event: ToolEvent, projection?: ResultProjection) =>
  (rows(event, projection) ?? []).flatMap((line) => (line.segments ?? []).filter((s) => s.bold === true).map((s) => s.text));
const errorColor = () => resolveThemeColor(themeTokens().error);

describe("F3 typed result rows — Read", () => {
  it("renders the text row from `file.numLines` and from the flat line count, bolding only the number", () => {
    const sidecar = eventFor("Read", { file_path: "/work/a.ts" }, "x\n", { type: "text", file: { filePath: "/work/a.ts", numLines: 340, startLine: 1, totalLines: 340 } });
    expect(one(sidecar)).toBe("Read 340 lines"); expect(bolds(sidecar)).toEqual(["340"]);
    expect(one(eventFor("Read", { file_path: "/work/a.ts" }, "one\ntwo\nthree"))).toBe("Read 3 lines");
    expect(one(eventFor("Read", { file_path: "/work/a.ts" }, "only"))).toBe("Read 1 line");          // ternary pluralization
    expect(one(eventFor("Read", { file_path: "/work/a.ts" }, "x", { type: "text", file: { numLines: 1 } }))).toBe("Read 1 line");
  });
  it("renders image, pdf and parts rows with upstream's `pl` human size", () => {
    expect(one(eventFor("Read", { file_path: "/work/a.png" }, "[image]", { type: "image", file: { originalSize: 2048 } }))).toBe("Read image (2KB)");
    expect(one(eventFor("Read", { file_path: "/work/a.pdf" }, "[pdf]", { type: "pdf", file: { originalSize: 1536 } }))).toBe("Read PDF (1.5KB)");
    const parts = eventFor("Read", { file_path: "/work/a.pdf" }, "[pdf]", { type: "parts", file: { count: 3, originalSize: 900 } });
    expect(one(parts)).toBe("Read 3 pages (900 bytes)"); expect(bolds(parts)).toEqual(["3"]);
    expect(one(eventFor("Read", { file_path: "/work/a.pdf" }, "[pdf]", { type: "parts", file: { count: 1, originalSize: 900 } }))).toBe("Read 1 page (900 bytes)");
  });
  it("renders notebook cells, and an empty notebook as the error-coloured sentence with no count", () => {
    const notebook = eventFor("Read", { file_path: "/work/a.ipynb" }, "[nb]", { type: "notebook", file: { cells: [{}, {}] } });
    expect(one(notebook)).toBe("Read 2 cells"); expect(bolds(notebook)).toEqual(["2"]);   // upstream has NO singular form here
    expect(one(eventFor("Read", { file_path: "/work/a.ipynb" }, "[nb]", { type: "notebook", file: { cells: [{}] } }))).toBe("Read 1 cells");
    const empty = eventFor("Read", { file_path: "/work/a.ipynb" }, "[nb]", { type: "notebook", file: { cells: [] } });
    expect(rows(empty)).toEqual([{ text: "No cells found in notebook", color: errorColor() }]);
  });
  it("renders both file_unchanged variants dim, keyed on the seeded source", () => {
    expect(rows(eventFor("Read", { file_path: "/work/a.ts" }, "", { type: "file_unchanged", source: "seeded", file: { filePath: "/work/src/deep/app.ts" } })))
      .toEqual([{ text: "Already in context (app.ts)", dim: true }]);
    expect(rows(eventFor("Read", { file_path: "/work/a.ts" }, "", { type: "file_unchanged", source: "reread", file: { filePath: "/work/a.ts" } })))
      .toEqual([{ text: "Unchanged since last read", dim: true }]);
  });
  it("falls back to the flat text row when a Read sidecar fails its narrow shape guard", () => {
    expect(one(eventFor("Read", { file_path: "/work/a.ts" }, "one\ntwo", { type: "image", file: { originalSize: "2048" } }))).toBe("Read 2 lines");
    expect(one(eventFor("Read", { file_path: "/work/a.ts" }, "one\ntwo", { type: "parts", file: { count: -1, originalSize: 10 } }))).toBe("Read 2 lines");
  });
});

describe("F3 typed result rows — Edit and Write", () => {
  const patch = (added: number, removed: number) => [{ oldStart: 1, oldLines: removed, newStart: 1, newLines: added, lines: [...Array.from({ length: removed }, (_, i) => `-old ${i}`), ...Array.from({ length: added }, (_, i) => `+new ${i}`)] }];
  const edit = (added: number, removed: number) => eventFor("Edit", { file_path: "/work/a.ts", old_string: "old", new_string: "new" }, "Updated /work/a.ts", { filePath: "/work/a.ts", oldString: "old", newString: "new", originalFile: "old", replaceAll: false, userModified: false, structuredPatch: patch(added, removed) });
  it("joins the two clauses with `, ` and pluralizes with `> 1`, not with the ordinary pluralizer", () => {
    expect(one(edit(1, 3))).toBe("Added 1 line, removed 3 lines");
    expect(bolds(edit(1, 3))).toEqual(["1", "3"]);
    expect(one(edit(2, 2))).toBe("Added 2 lines, removed 2 lines");
  });
  it("capitalizes the removed clause POSITIONALLY and omits a zero clause entirely", () => {
    expect(one(edit(0, 1))).toBe("Removed 1 line");
    expect(one(edit(0, 3))).toBe("Removed 3 lines");
    expect(one(edit(4, 0))).toBe("Added 4 lines");
  });
  it("returns no typed row for an Edit with no recognized patch — a line-count guess is not a diff", () => {
    expect(rows(eventFor("Edit", { file_path: "/work/a.ts", old_string: "a\nb\nc", new_string: "a\nB\nc" }, "Updated /work/a.ts"))).toBeUndefined();
    expect(rows(edit(0, 0))).toBeUndefined();
    expect(rows(eventFor("Edit", { file_path: "/work/a.ts" }, "Updated", { filePath: "/work/a.ts", oldString: "o", newString: "n", structuredPatch: [{ lines: "not-an-array" }] }))).toBeUndefined();
  });
  it("counts a Write create from the sidecar content first and the complete input second", () => {
    const sidecar = eventFor("Write", { file_path: "/work/n.md", content: "ignored" }, "Created", { type: "create", filePath: "/work/n.md", content: "one\ntwo\nthree\n", originalFile: null, structuredPatch: [], userModified: false });
    expect(one(sidecar)).toBe("Wrote 3 lines"); expect(bolds(sidecar)).toEqual(["3"]);
    expect(one(eventFor("Write", { file_path: "/work/n.md", content: "a\nb" }, "Created"))).toBe("Wrote 2 lines");
    expect(one(eventFor("Write", { file_path: "/work/n.md", content: "solo" }, "Created"))).toBe("Wrote 1 line");
  });
  it("routes a Write UPDATE through the same diff summary as Edit", () => {
    expect(one(eventFor("Write", { file_path: "/work/a.ts", content: "new" }, "Updated", { type: "update", filePath: "/work/a.ts", content: "new", originalFile: "old", structuredPatch: patch(2, 1), userModified: false }))).toBe("Added 2 lines, removed 1 line");
  });
});

describe("F3 typed result rows — Grep and Glob", () => {
  const grep = (sidecar: unknown) => eventFor("Grep", { pattern: "x" }, "a.ts\nb.ts", sidecar);
  it("strips the trailing `s` at exactly one and keeps the plural at zero", () => {
    expect(one(grep({ mode: "files_with_matches", numFiles: 0, filenames: [] }))).toBe("Found 0 files");
    expect(one(grep({ mode: "files_with_matches", numFiles: 1, filenames: ["a.ts"] }))).toBe("Found 1 file (ctrl+o to expand)");
    expect(one(grep({ mode: "files_with_matches", numFiles: 3, filenames: ["a", "b", "c"] }))).toBe("Found 3 files (ctrl+o to expand)");
  });
  it("renders the content and count modes with their own labels and the secondary clause", () => {
    expect(one(grep({ mode: "content", numLines: 12, content: "hit" }))).toBe("Found 12 lines (ctrl+o to expand)");
    const counted = grep({ mode: "count", numMatches: 12, numFiles: 3, content: "hit" });
    expect(one(counted)).toBe("Found 12 matches across 3 files (ctrl+o to expand)");
    expect(bolds(counted)).toEqual(["12 ", "3 "]);                            // upstream bolds the count AND its trailing space
    // `matches`.slice(0,-1) is `matche`, and that is what 2.1.220 paints at exactly one — the trailing-`s` strip
    // is a blind string operation, not a pluralizer. Reproduced, not corrected: the bundle outranks our taste.
    expect(one(grep({ mode: "count", numMatches: 1, numFiles: 1, content: "hit" }))).toBe("Found 1 matche across 1 file (ctrl+o to expand)");
  });
  it("counts Glob from numFiles, else from the filenames it actually returned", () => {
    expect(one(eventFor("Glob", { pattern: "*.ts" }, "a.ts", { numFiles: 2, filenames: ["a.ts", "b.ts"] }))).toBe("Found 2 files (ctrl+o to expand)");
    expect(one(eventFor("Glob", { pattern: "*.ts" }, "a.ts", { filenames: ["a.ts"] }))).toBe("Found 1 file (ctrl+o to expand)");
    expect(rows(eventFor("Glob", { pattern: "*.ts" }, "a.ts\nb.ts"))).toBeUndefined();   // no source ⇒ no fabricated count
  });
  it("appends the raw matches under the typed row in the verbose projection only", () => {
    const event = grep({ mode: "content", numLines: 2, content: "a.ts:1:hit\nb.ts:9:hit" });
    expect(texts(event, "detail-all")).toEqual(["Found 2 lines (ctrl+o to expand)", "a.ts:1:hit", "b.ts:9:hit"]);
    expect(texts(event, "compact")).toEqual(["Found 2 lines (ctrl+o to expand)"]);
  });
});

describe("F3 typed result rows — Bash", () => {
  const bash = (sidecar: unknown, content = "", input: Record<string, unknown> = { command: "printf ok" }) => eventFor("Bash", input, content, sidecar);
  const core = { stdout: "", stderr: "", interrupted: false, noOutputExpected: false, isImage: false };
  it("picks exactly one dim empty-output line in upstream's priority order", () => {
    expect(rows(bash({ ...core, backgroundTaskId: "t1", returnCodeInterpretation: "exit 1", noOutputExpected: true }))).toEqual([{ text: "Running in the background (↓ to manage)", dim: true }]);
    expect(rows(bash({ ...core, returnCodeInterpretation: "Command exited with code 1", noOutputExpected: true }))).toEqual([{ text: "Command exited with code 1", dim: true }]);
    expect(rows(bash({ ...core, noOutputExpected: true }))).toEqual([{ text: "Done", dim: true }]);
    expect(rows(bash({ ...core }))).toEqual([{ text: "(No output)", dim: true }]);
    expect(rows(bash(undefined, "   \n "))).toEqual([{ text: "(No output)", dim: true }]);   // flat fallback: blank output is still no output
  });
  it("renders the image sentinel dim and NOTHING else, even with a timeout on the input", () => {
    expect(rows(bash({ ...core, isImage: true, stdout: "binary" }, "", { command: "screencap", timeout: 120000 }))).toEqual([{ text: "[Image data detected and sent to Claude]", dim: true }]);
  });
  it("keeps stdout as the raw folded body and adds the dim timeout suffix from the complete input", () => {
    expect(texts(bash({ ...core, stdout: "one\ntwo" }, "one\ntwo"))).toEqual(["one", "two"]);
    expect(texts(bash({ ...core, stdout: "one" }, "one", { command: "sleep 1", timeout: 120000 }))).toEqual(["one", "(timeout 2m)"]);
    expect(rows(bash({ ...core }, "", { command: "sleep 1", timeout: 90000 }))).toEqual([{ text: "(No output)", dim: true }, { text: "(timeout 1m 30s)", dim: true }]);
  });
  it("colours stderr, strips the sandbox-violations block and splits the cwd-reset trailer onto its own dim row", () => {
    const event = bash({ ...core, stderr: "<sandbox_violations>secret</sandbox_violations>boom\nShell cwd was reset to /work" });
    expect(rows(event)).toEqual([{ text: "boom", color: errorColor() }, { text: "Shell cwd was reset to /work", dim: true }]);
    expect(texts(bash({ ...core, stdout: "out", stderr: "warn" }))).toEqual(["out", "warn"]);
  });
});

describe("F3 typed result rows — web tools", () => {
  it("renders WebFetch only when a byte/status source exists, bolding the human size", () => {
    const event = eventFor("WebFetch", { url: "https://x" }, "body", { bytes: 43110, code: 200, codeText: "OK", result: "extracted body" });
    expect(one(event)).toBe("Received 42.1KB (200 OK)"); expect(bolds(event)).toEqual(["42.1KB"]);
    expect(texts(event, "detail-all")).toEqual(["Received 42.1KB (200 OK)", "extracted body"]);
    expect(rows(eventFor("WebFetch", { url: "https://x" }, "body"))).toBeUndefined();
    expect(rows(eventFor("WebFetch", { url: "https://x" }, "body", { code: 200, codeText: "OK" }))).toBeUndefined();
  });
  it("renders WebSearch with its OWN rounding formatter, never `ra`", () => {
    expect(one(eventFor("WebSearch", { query: "x" }, "res", { searchCount: 3, durationSeconds: 4.4 }))).toBe("Did 3 searches in 4s");
    expect(one(eventFor("WebSearch", { query: "x" }, "res", { searchCount: 1, durationSeconds: 0.82 }))).toBe("Did 1 search in 820ms");
    expect(one(eventFor("WebSearch", { query: "x" }, "res", { results: ["q", { title: "a" }, { title: "b" }], durationSeconds: 1 }))).toBe("Did 2 searches in 1s");
    expect(rows(eventFor("WebSearch", { query: "x" }, "res", { searchCount: 3 }))).toBeUndefined();
    expect(rows(eventFor("WebSearch", { query: "x" }, "res"))).toBeUndefined();
  });
});

describe("F3 typed result rows — the remaining census tools", () => {
  it("dot-joins the Skill clauses and switches to the forked pair", () => {
    expect(one(eventFor("Skill", { command: "s" }, "ok", { allowedTools: ["Read", "Bash"], model: "sonnet" }))).toBe("Successfully loaded skill · 2 tools allowed · sonnet");
    expect(one(eventFor("Skill", { command: "s" }, "ok", { allowedTools: ["Read"] }))).toBe("Successfully loaded skill · 1 tool allowed");
    expect(one(eventFor("Skill", { command: "s" }, "ok", { allowedTools: [] }))).toBe("Successfully loaded skill");
    expect(one(eventFor("Skill", { command: "s" }, "ok", { status: "forked", background: true }))).toBe("Running in the background");
    expect(one(eventFor("Skill", { command: "s" }, "ok", { status: "forked" }))).toBe("Done");
  });
  it("clips the TaskStop command to two lines / 160 chars and marks a clip with the ellipsis form", () => {
    expect(one(eventFor("TaskStop", { task_id: "t" }, "ok", { command: "npm test" }))).toBe("npm test · stopped");
    expect(one(eventFor("TaskStop", { task_id: "t" }, "ok", { command: "a\nb\nc" }))).toBe("a\nb… · stopped");
    expect(one(eventFor("TaskStop", { task_id: "t" }, "ok", { command: "x".repeat(200) }))).toBe(`${"x".repeat(160)}… · stopped`);
    expect(rows(eventFor("TaskStop", { task_id: "t" }, "ok"))).toBeUndefined();
  });
  it("renders the plan-mode pair and the two worktree rows", () => {
    const plan = rows(eventFor("EnterPlanMode", {}, "ok"))!;
    expect(plan.map((l) => l.text)).toEqual(["⏺ Entered plan mode", "  Claude is now exploring and designing an implementation approach."]);
    expect(plan[0]!.segments?.[0]).toEqual({ text: "⏺", color: resolveThemeColor(themeTokens().planMode) });
    expect(plan[1]!.dim).toBe(true);
    const enter = eventFor("EnterWorktree", {}, "ok", { worktreeBranch: "feat/x", worktreePath: "/work/.wt/x" });
    expect(texts(enter)).toEqual(["Switched to worktree on branch feat/x", "/work/.wt/x"]); expect(bolds(enter)).toEqual(["feat/x"]);
    expect(texts(eventFor("ExitWorktree", {}, "ok", { action: "keep", worktreeBranch: "feat/x", originalCwd: "/work" }))).toEqual(["Kept worktree (branch feat/x)", "Returned to /work"]);
    expect(texts(eventFor("ExitWorktree", {}, "ok", { action: "remove", originalCwd: "/work" }))).toEqual(["Removed worktree", "Returned to /work"]);
  });
  it("walks the TaskOutput ladder", () => {
    expect(rows(eventFor("TaskOutput", { task_id: "t" }, "ok", { retrieval_status: "success" }))).toEqual([{ text: "No task output available", dim: true }]);
    expect(texts(eventFor("TaskOutput", { task_id: "t" }, "ok", { retrieval_status: "success", task: { task_type: "local_bash", output: "hello", error: null } }))).toEqual(["hello"]);
    expect(rows(eventFor("TaskOutput", { task_id: "t" }, "ok", { retrieval_status: "success", task: { task_type: "local_agent", description: "worker", result: "a\nb" } })))
      .toEqual([{ text: "Read output (ctrl+o to expand)", dim: true }]);
    expect(texts(eventFor("TaskOutput", { task_id: "t" }, "ok", { retrieval_status: "success", task: { task_type: "local_agent", description: "worker", result: "a\nb" } }), "detail-all"))
      .toEqual(["worker (2 lines)", "a", "b"]);
    expect(rows(eventFor("TaskOutput", { task_id: "t" }, "ok", { retrieval_status: "timeout", task: { task_type: "local_agent" } }))).toEqual([{ text: "Task is still running…", dim: true }]);
    expect(rows(eventFor("TaskOutput", { task_id: "t" }, "ok", { retrieval_status: "failed", task: { task_type: "local_agent" } }))).toEqual([{ text: "Task not ready", dim: true }]);
    expect(texts(eventFor("TaskOutput", { task_id: "t" }, "ok", { retrieval_status: "success", task: { task_type: "remote_agent", description: "cloud", status: "running", output: "x" } })))
      .toEqual(["  cloud [running]", "     (ctrl+o to expand)"]);
  });
});

describe("F3 typed result rows — the routing rules", () => {
  it("never reroutes a non-success status, so the interrupted/rejected/error surfaces stay exactly as they are", () => {
    expect(rows(eventFor("Read", { file_path: "/work/a.ts" }, "Interrupted"))).toBeUndefined();
    expect(rows(eventFor("Read", { file_path: "/work/a.ts" }, "Tool use rejected", undefined, true))).toBeUndefined();
    expect(rows(eventFor("Read", { file_path: "/work/a.ts" }, "File does not exist", undefined, true))).toBeUndefined();
  });
  it("returns undefined for unknown tools and for the suppressed bookkeeping set", () => {
    expect(rows(eventFor("FutureTool", { a: 1 }, "whatever"))).toBeUndefined();
    for (const name of ["TaskCreate", "TaskUpdate", "ToolSearch"]) expect(rows(eventFor(name, { a: 1 }, "ok"))).toBeUndefined();
  });
  it("renders the same typed row in the compact and the detail projections", () => {
    const event = eventFor("Read", { file_path: "/work/a.ts" }, "x", { type: "text", file: { numLines: 41 } });
    for (const projection of ["compact", "detail-all", "detail-collapsed"] as const) expect(one(event, projection)).toBe("Read 41 lines");
  });
});
