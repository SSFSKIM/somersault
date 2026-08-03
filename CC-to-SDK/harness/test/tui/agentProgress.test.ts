// tui/test/agentProgress.test.ts — F3 Task 7 (LT16/LT17): the honest totals ladder, the `system/task_*`
// capture that feeds its second rung, and the arrival stamps that feed its third. Every number here is
// P83's (docs/superpowers/research/2026-07-31-tui-clone/11-p83-agent-usage-identity.md): the shapes are the
// probe's, and the ONE thing no rung may ever do is sum child `usage`.
import { describe, it, expect } from "vitest";
import { agentBatches, agentBatchHeader, agentBatchKey, agentBatchTotalsText, agentBatchView, agentChildren, agentDoneText, agentIsAsync, agentSubagentType, agentTotals, hiddenToolUsesLine, indentRenderLine, ingestTaskFrame, isAgentTool, stampAgentCalls, type AgentMeta } from "../../src/tui/agentProgress.js";
import type { ToolEvent } from "../../src/tui/transcriptModel.js";

const nested = (id: string, seq: number, parent = "agent-1"): ToolEvent =>
  ({ id, name: "Read", input: { file_path: `/work/${id}.ts` }, callSequence: seq, route: "nested", parent_tool_use_id: parent, result: { content: "x", isError: false, resultSequence: seq } });
const agentCall = (sidecar?: unknown): ToolEvent =>
  ({ id: "agent-1", name: "Agent", input: { description: "review the diff", prompt: "p" }, callSequence: 1, route: "top-level", result: { content: "report", isError: false, resultSequence: 9, ...(sidecar === undefined ? {} : { sidecar: { scope: "call" as const, value: sidecar } }) } });
const openAgent = (): ToolEvent => ({ id: "agent-1", name: "Agent", input: { description: "review the diff", prompt: "p" }, callSequence: 1, route: "top-level" });
// P94's completed Agent sidecar (07-p94-tool-census.md § Agent) with P83's worked-example numbers.
const COMPLETED = { agentId: "a1", agentType: "probe-reader", resolvedModel: "claude-sonnet-5", status: "completed", totalToolUseCount: 3, totalTokens: 24100, totalDurationMs: 72000 };
// P83 pass C: a PARALLEL dispatch's sidecar — no totals whatsoever.
const ASYNC = { agentId: "a1", isAsync: true, outputFile: "/tmp/o", canReadOutputFile: true, description: "d", prompt: "p", resolvedModel: "claude-fable-5", status: "async_launched" };
const NOTIFY: AgentMeta = { notify: { total_tokens: 4195, tool_uses: 2, duration_ms: 4484 } };

describe("F3 Task 7: agentChildren", () => {
  it("selects only THIS parent's nested calls, ordered by callSequence", () => {
    const events: ToolEvent[] = [
      { id: "top-1", name: "Read", input: {}, callSequence: 1, route: "top-level" },
      nested("c-2", 4), nested("c-1", 2), nested("other", 3, "agent-2"),
    ];
    expect(agentChildren(events, "agent-1").map((e) => e.id)).toEqual(["c-1", "c-2"]);
    expect(agentChildren(events, "agent-9")).toEqual([]);
  });
  it("keeps source order for two calls that shared one assistant message", () => {
    const events = [nested("c-a", 2), nested("c-b", 2)];
    expect(agentChildren(events, "agent-1").map((e) => e.id)).toEqual(["c-a", "c-b"]);
  });
  it("names only the tool our wire actually emits", () => {
    expect(isAgentTool("Agent")).toBe(true); expect(isAgentTool("Task")).toBe(false); expect(isAgentTool("Bash")).toBe(false);
  });
});

describe("F3 Task 7: the totals ladder (P83)", () => {
  it("rung 1 — a recognized COMPLETED sidecar wins over everything else", () => {
    const totals = agentTotals(agentCall(COMPLETED), { ...NOTIFY, dispatchedAt: 0, resultAt: 999 }, [nested("c-1", 2)], 5000);
    expect(totals).toEqual({ toolUses: 3, tokens: 24100, durationMs: 72000, source: "sidecar" });
  });
  it("rung 1 rejects a sidecar that is not a recognized COMPLETED shape (async_launched, or no count)", () => {
    expect(agentTotals(agentCall(ASYNC), NOTIFY, [], 0).source).toBe("notification");
    expect(agentTotals(agentCall({ agentId: "a", status: "completed" }), NOTIFY, [], 0).source).toBe("notification");
  });
  it("rung 1 omits a field the sidecar does not carry rather than borrowing one", () => {
    const totals = agentTotals(agentCall({ ...COMPLETED, totalTokens: "lots", totalDurationMs: -1 }), NOTIFY, [], 0);
    expect(totals).toEqual({ toolUses: 3, source: "sidecar" });
  });
  it("rung 2 — task_notification.usage, the ONLY totals source for a parallel dispatch", () => {
    expect(agentTotals(agentCall(ASYNC), NOTIFY, [nested("c-1", 2)], 0)).toEqual({ toolUses: 2, tokens: 4195, durationMs: 4484, source: "notification" });
  });
  it("rung 3 — derived: children counted exactly, duration dispatch→result, tokens OMITTED", () => {
    const totals = agentTotals(agentCall(), { dispatchedAt: 1000, resultAt: 35000 }, [nested("c-1", 2), nested("c-2", 3)], 90000);
    expect(totals).toEqual({ toolUses: 2, durationMs: 34000, source: "derived" });
    expect(totals.tokens).toBeUndefined();          // summing child usage overshoots by 265–342% — never fabricate
  });
  it("rung 3 ticks against `now` while the call is OPEN and FREEZES at result arrival", () => {
    const meta: AgentMeta = { dispatchedAt: 1000 };
    expect(agentTotals(openAgent(), meta, [], 9000).durationMs).toBe(8000);
    expect(agentTotals(openAgent(), meta, [], 12000).durationMs).toBe(11000);
    const settled: AgentMeta = { dispatchedAt: 1000, resultAt: 12000 };
    expect(agentTotals(agentCall(), settled, [], 999999).durationMs).toBe(11000);
  });
  it("rung 3 omits the duration when no dispatch stamp was ever taken (a resumed/attached transcript)", () => {
    expect(agentTotals(agentCall(), undefined, [nested("c-1", 2)], 5000)).toEqual({ toolUses: 1, source: "derived" });
  });
});

describe("F3 Task 7: the Done literal (census 429620)", () => {
  it("joins exactly the clauses it has, with upstream's singular arm and compact token format", () => {
    expect(agentDoneText({ toolUses: 7, tokens: 24100, durationMs: 72000, source: "sidecar" })).toBe("Done (7 tool uses · 24.1k tokens · 1m 12s)");
    expect(agentDoneText({ toolUses: 1, tokens: 907, durationMs: 9236, source: "notification" })).toBe("Done (1 tool use · 907 tokens · 9s)");
    expect(agentDoneText({ toolUses: 7, durationMs: 34000, source: "derived" })).toBe("Done (7 tool uses · 34s)");
    expect(agentDoneText({ toolUses: 0, source: "derived" })).toBe("Done (0 tool uses)");
  });
  it("the hidden-row marker is the shared dim `… +N tool uses` sentence", () => {
    expect(hiddenToolUsesLine(2)).toEqual({ text: "… +2 tool uses (ctrl+o to expand)", dim: true });
    expect(hiddenToolUsesLine(1).text).toBe("… +1 tool use (ctrl+o to expand)");
  });
  it("indents a segmented row with its own plain segment (never inside the coloured bullet)", () => {
    const line = indentRenderLine({ text: "⏺ Read(a.ts)", segments: [{ text: "⏺ ", color: "red" }, { text: "Read", bold: true }] }, "  ");
    expect(line.text).toBe("  ⏺ Read(a.ts)");
    expect(line.segments).toEqual([{ text: "  " }, { text: "⏺ ", color: "red" }, { text: "Read", bold: true }]);
    expect(indentRenderLine({ text: "x", dim: true }, "  ")).toEqual({ text: "  x", dim: true });
  });
});

describe("F3 Task 7: the system/task_* capture", () => {
  const started = { type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "agent-1", subagent_type: "probe-reader", task_type: "local_agent", description: "Read probe fixture files" };
  it("task_started binds tool_use_id ↔ task_id ↔ type ↔ description and stamps its arrival", () => {
    const meta = new Map<string, AgentMeta>();
    ingestTaskFrame(meta, started, 500);
    expect(meta.get("agent-1")).toEqual({ taskId: "t1", subagentType: "probe-reader", taskType: "local_agent", description: "Read probe fixture files", startedAt: 500 });
  });
  it("accepts the bare-type frame shape too (the host forwards both)", () => {
    const meta = new Map<string, AgentMeta>();
    ingestTaskFrame(meta, { type: "task_started", tool_use_id: "b-1", task_type: "local_bash", task_id: "t2" }, 1);
    expect(meta.get("b-1")).toMatchObject({ taskType: "local_bash", taskId: "t2" });
  });
  it("task_notification carries the totals and does NOT clobber the identity task_started bound", () => {
    const meta = new Map<string, AgentMeta>();
    ingestTaskFrame(meta, started, 500);
    ingestTaskFrame(meta, { type: "system", subtype: "task_notification", task_id: "t1", tool_use_id: "agent-1", status: "completed", usage: { total_tokens: 3041, tool_uses: 3, duration_ms: 9235 } }, 9800);
    expect(meta.get("agent-1")).toMatchObject({ subagentType: "probe-reader", notify: { total_tokens: 3041, tool_uses: 3, duration_ms: 9235 } });
  });
  it("ignores a partial or non-numeric usage (a half-filled rung would be a fabricated row)", () => {
    const meta = new Map<string, AgentMeta>();
    ingestTaskFrame(meta, { type: "system", subtype: "task_notification", tool_use_id: "agent-1", usage: { tool_uses: 3 } }, 1);
    ingestTaskFrame(meta, { type: "system", subtype: "task_notification", tool_use_id: "agent-1", usage: { total_tokens: "x", tool_uses: 3, duration_ms: 5 } }, 1);
    expect(meta.get("agent-1")?.notify).toBeUndefined();
  });
  it("ignores frames without the join key (the host's synthetic rewind notification) and other subtypes", () => {
    const meta = new Map<string, AgentMeta>();
    ingestTaskFrame(meta, { type: "task_notification", task_id: "rewind", status: "stopped", summary: "background tasks ended by rewind" }, 1);
    ingestTaskFrame(meta, { type: "system", subtype: "task_progress", tool_use_id: "agent-1", usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 } }, 1);
    ingestTaskFrame(meta, "not a frame", 1);
    expect(meta.size).toBe(0);
  });
});

describe("F3 Task 7: the arrival stamps", () => {
  const dispatch = { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "agent-1", name: "Agent", input: {} }, { type: "tool_use", id: "bash-1", name: "Bash", input: {} }, { type: "tool_use", id: "read-1", name: "Read", input: {} }] } };
  it("stamps dispatch for the Agent/Bash calls only, and only the FIRST time each is observed", () => {
    const meta = new Map<string, AgentMeta>();
    stampAgentCalls(meta, dispatch, 100);
    stampAgentCalls(meta, dispatch, 900);                          // a follow replay redelivers the very same frame
    expect(meta.get("agent-1")?.dispatchedAt).toBe(100);
    expect(meta.get("bash-1")?.dispatchedAt).toBe(100);
    expect(meta.has("read-1")).toBe(false);
  });
  it("stamps result arrival from the top-level tool_result, once", () => {
    const meta = new Map<string, AgentMeta>();
    stampAgentCalls(meta, dispatch, 100);
    stampAgentCalls(meta, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "agent-1", content: "r" }] } }, 4000);
    stampAgentCalls(meta, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "agent-1", content: "r" }] } }, 8000);
    expect(meta.get("agent-1")?.resultAt).toBe(4000);
  });
  it("stamps the first CHILD frame's arrival on its parent and never dispatches a nested call", () => {
    const meta = new Map<string, AgentMeta>();
    stampAgentCalls(meta, { type: "assistant", parent_tool_use_id: "agent-1", message: { id: "m2", content: [{ type: "tool_use", id: "child-agent", name: "Agent", input: {} }] } }, 2500);
    stampAgentCalls(meta, { type: "assistant", parent_tool_use_id: "agent-1", message: { id: "m3", content: [] } }, 3500);
    expect(meta.get("agent-1")?.firstChildAt).toBe(2500);
    expect(meta.has("child-agent")).toBe(false);
    expect(meta.get("agent-1")?.dispatchedAt).toBeUndefined();
  });
  it("ignores a nested tool_result (its id belongs to the child, not to any dispatch we stamped)", () => {
    const meta = new Map<string, AgentMeta>();
    stampAgentCalls(meta, dispatch, 100);
    stampAgentCalls(meta, { type: "user", parent_tool_use_id: "agent-1", message: { content: [{ type: "tool_result", tool_use_id: "agent-1", content: "r" }] } }, 4000);
    expect(meta.get("agent-1")?.resultAt).toBeUndefined();
  });
});

// ── F3 Task 8: same-message agent batches (LT3) ─────────────────────────────────────────────────────────
// Upstream `bdf` (452545) groups ≥2 tool_use blocks that share BOTH one assistant message and one tool
// name; `Xha` (429745) renders the unit. The publication rule is ours and is the load-bearing one: Static
// is append-only, so a batch may publish only once EVERY member has a result.
describe("F3 Task 8: batch detection", () => {
  const dispatch = (id: string, callSequence: number, input: Record<string, unknown> = {}, name = "Agent"): ToolEvent =>
    ({ id, name, input: { description: `do ${id}`, prompt: "p", ...input }, callSequence, route: "top-level" });
  const settle = (event: ToolEvent, resultSequence: number, isError = false, sidecar?: unknown): ToolEvent =>
    ({ ...event, result: { content: "r", isError, resultSequence, ...(sidecar === undefined ? {} : { sidecar: { scope: "call" as const, value: sidecar } }) } });

  it("keys on the assistant message AND the tool name (census 01#253–257)", () => {
    expect(agentBatchKey(dispatch("a1", 4))).toBe("4:Agent");
    expect(agentBatchKey(dispatch("b1", 4, {}, "Bash"))).toBe("4:Bash");
  });

  it("batches two Agents that shared one message, and NOTHING else", () => {
    const batches = agentBatches([dispatch("a1", 4), dispatch("a2", 4)]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.memberIds).toEqual(["a1", "a2"]);
    // One Agent alone is Task 7's standalone path; an Agent + a Bash, or two Agents from different
    // messages, are never one unit; and `Task` is not a name our wire emits at all (`isAgentTool`).
    expect(agentBatches([dispatch("a1", 4)])).toEqual([]);
    expect(agentBatches([dispatch("a1", 4), dispatch("b1", 4, {}, "Bash")])).toEqual([]);
    expect(agentBatches([dispatch("a1", 4), dispatch("t1", 4, {}, "Task")])).toEqual([]);
    // Membership is `isAgentTool`, not "≥2 of any one name": upstream only groups tools that declare
    // `renderGroupedToolUse`, so two same-message Bash calls (or Reads, or `Task`s, which our wire never
    // emits) stay ordinary calls rather than becoming agents.
    expect(agentBatches([dispatch("b1", 4, {}, "Bash"), dispatch("b2", 4, {}, "Bash")])).toEqual([]);
    expect(agentBatches([dispatch("r1", 4, {}, "Read"), dispatch("r2", 4, {}, "Read")])).toEqual([]);
    expect(agentBatches([dispatch("t1", 4, {}, "Task"), dispatch("t2", 4, {}, "Task")])).toEqual([]);
    expect(agentBatches([dispatch("a1", 4), dispatch("a2", 5)])).toEqual([]);
    expect(agentBatches([{ ...dispatch("n1", 4), route: "nested", parent_tool_use_id: "a1" }, { ...dispatch("n2", 4), route: "nested", parent_tool_use_id: "a1" }])).toEqual([]);
  });

  it("is complete only when EVERY member has a result, and anchors at the last one to arrive", () => {
    const open = agentBatches([settle(dispatch("a1", 4), 9), dispatch("a2", 4)])[0]!;
    expect(open.complete).toBe(false);
    expect(open.anchorSequence).toBe(4);                                   // the shared dispatch, not a member result
    const done = agentBatches([settle(dispatch("a1", 4), 9), settle(dispatch("a2", 4), 12)])[0]!;
    expect(done.complete).toBe(true);
    expect(done.anchorSequence).toBe(12);
  });

  it("resolves the subagent type from the input, then the task_started map, folding the defaults to `Agent`", () => {
    expect(agentSubagentType(dispatch("a1", 4, { subagent_type: "reviewer" }), undefined)).toBe("reviewer");
    expect(agentSubagentType(dispatch("a1", 4), { subagentType: "reviewer" })).toBe("reviewer");
    expect(agentSubagentType(dispatch("a1", 4, { subagent_type: "general-purpose" }), undefined)).toBe("Agent");
    expect(agentSubagentType(dispatch("a1", 4, { subagent_type: "worker" }), undefined)).toBe("Agent");
    expect(agentSubagentType(dispatch("a1", 4), undefined)).toBe("Agent");
  });

  it("reads asynchrony from the dispatch input OR the launch sidecar (P83: parallel members resolve async)", () => {
    expect(agentIsAsync(dispatch("a1", 4))).toBe(false);
    expect(agentIsAsync(dispatch("a1", 4, { run_in_background: true }))).toBe(true);
    expect(agentIsAsync(settle(dispatch("a1", 4), 9, false, { status: "async_launched" }))).toBe(true);
    expect(agentIsAsync(settle(dispatch("a1", 4), 9, false, { status: "remote_launched" }))).toBe(true);
    expect(agentIsAsync(settle(dispatch("a1", 4), 9, false, { status: "completed" }))).toBe(false);
  });

  it("renders `Xha`'s three header forms, with the count as the ONE bold run", () => {
    const view = (events: readonly ToolEvent[], meta?: Map<string, AgentMeta>) => agentBatchView(agentBatches(events)[0]!, meta);
    const running = view([dispatch("a1", 4), dispatch("a2", 4)]);
    expect(agentBatchHeader(running)).toEqual({ before: "Running ", count: "2", after: " agents…", manage: false, expand: true });
    const finished = view([settle(dispatch("a1", 4), 9), settle(dispatch("a2", 4), 10)]);
    expect(agentBatchHeader(finished)).toEqual({ before: "", count: "2", after: " agents finished", manage: false, expand: true });
    // A shared NON-default subagent_type qualifies the noun; a mixed batch falls back to the bare one.
    const typed = view([dispatch("a1", 4, { subagent_type: "reviewer" }), dispatch("a2", 4, { subagent_type: "reviewer" })]);
    expect(agentBatchHeader(typed).after).toBe(" reviewer agents…");
    const mixed = view([dispatch("a1", 4, { subagent_type: "reviewer" }), dispatch("a2", 4, { subagent_type: "writer" })]);
    expect(agentBatchHeader(mixed).after).toBe(" agents…");
    // All resolved AND every member async: the launch form, with `(↓ to manage)` and NO ctrl+o hint.
    const async_ = view([settle(dispatch("a1", 4), 9, false, { status: "async_launched" }), settle(dispatch("a2", 4), 10, false, { status: "async_launched" })]);
    expect(agentBatchHeader(async_)).toEqual({ before: "", count: "2", after: " background agents launched", manage: true, expand: false });
    // Still running, but every member is a background dispatch: the ctrl+o hint is gone even so.
    const asyncOpen = view([dispatch("a1", 4, { run_in_background: true }), dispatch("a2", 4, { run_in_background: true })]);
    expect(agentBatchHeader(asyncOpen)).toEqual({ before: "Running ", count: "2", after: " agents…", manage: false, expand: false });
  });

  it("carries per-member resolution, error and description into the view", () => {
    const batch = agentBatches([settle(dispatch("a1", 4, { description: "review\n the  diff" }), 9, true), dispatch("a2", 4)])[0]!;
    const view = agentBatchView(batch, undefined);
    expect(view.members.map((m) => ({ resolved: m.resolved, isError: m.isError, description: m.description }))).toEqual([
      { resolved: true, isError: true, description: "review the diff" },
      { resolved: false, isError: false, description: "do a2" },
    ]);
    expect(view).toMatchObject({ allResolved: false, anyError: true, allAsync: false, hideType: true });
    expect(view.sharedType).toBeUndefined();                               // the bare `Agent` fallback never qualifies the noun
  });

  it("spells the per-agent totals clause with upstream's singular arm and compact tokens (`jla` 422193)", () => {
    expect(agentBatchTotalsText({ toolUses: 3, tokens: 24100, source: "sidecar" })).toBe(" · 3 tool uses · 24.1k tokens");
    expect(agentBatchTotalsText({ toolUses: 1, source: "derived" })).toBe(" · 1 tool use");
    expect(agentBatchTotalsText({ toolUses: 0, source: "derived" })).toBe(" · 0 tool uses");
  });
});
