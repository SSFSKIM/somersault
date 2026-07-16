import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../../src/index.js";

function fakeQuery() {
  const q: any = (async function* () { yield { type: "result", subtype: "success", result: "ok" }; })();
  return q;
}

describe("taskTools integration", () => {
  it("does not register the server when taskTools is unset", () => {
    const h = createHarness({}, { query: fakeQuery });
    expect(h.tasks).toBeUndefined();
    expect((h.options as any).mcpServers?.["cc-tasks"]).toBeUndefined();
  });
  it("registers cc-tasks and exposes harness.tasks when enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasks-"));
    const h = createHarness({ taskTools: { dir } }, { query: fakeQuery });
    expect((h.options as any).mcpServers["cc-tasks"]).toBeTruthy();
    expect(h.tasks).toBeTruthy();
    const t = await h.tasks!.create({ subject: "wired" });
    expect(t.id).toBe(1);
  });
  it("disallows the native Task tools so cc-tasks is authoritative (D3 shadowing)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasks-"));
    const h = createHarness({ taskTools: { dir } }, { query: fakeQuery });
    const dis = (h.options as any).disallowedTools as string[];
    for (const t of ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TodoWrite"]) expect(dis).toContain(t);
    // and it merges, not clobbers, a caller's own disallow list
    const h2 = createHarness({ taskTools: { dir }, disallowedTools: ["WebSearch"] }, { query: fakeQuery });
    expect((h2.options as any).disallowedTools).toContain("WebSearch");
    expect((h2.options as any).disallowedTools).toContain("TaskCreate");
  });
  it("preserves user-supplied mcpServers alongside cc-tasks", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasks-"));
    const h = createHarness(
      { taskTools: { dir }, mcpServers: { other: { type: "stdio", command: "echo" } } },
      { query: fakeQuery },
    );
    expect((h.options as any).mcpServers.other).toBeTruthy();
    expect((h.options as any).mcpServers["cc-tasks"]).toBeTruthy();
  });
});
