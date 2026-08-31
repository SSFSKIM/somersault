// The canonical closure-ledger row list — the campaign's definition of "what
// must be owned", transcribed from the spec so it is machine-checkable.
//
// Source of truth: docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md
//   §1.1 in-scope subsystem table  → the 15 `subsystem` rows below
//   §1.3 headless tool catalog     → the 31 `tool` rows below
//   "Roadmap — the cut" (C1–C17)   → the `wave` on each row
//
// This module is the *shape*; `reforge/ledger.json` carries the mutable state
// (ownership state, dependency edges, upstream footprints). `ledger/check.ts`
// refuses any ledger.json whose row set is not exactly this list.
//
// Changing this list is a deliberate act with only two legitimate causes
// (spec §1.1): a row ships (state moves in ledger.json — no change here), or a
// row moves to the §1.2 exclusion ledger with evidence, which means moving it
// from CANONICAL_ROWS to EXCLUDED_ROWS *with its reason recorded*. A pin bump
// that introduces a newly shipped upstream subsystem adds a new `unowned` row.

export const WAVES = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9",
  "C10", "C11", "C12", "C13", "C14", "C15", "C16", "C17",
] as const;
export type Wave = (typeof WAVES)[number];

/** Spec §1.1 / §5. `stale` is the pin-bump invalidation state. */
export const LEDGER_STATES = ["unowned", "spliced", "standalone-complete", "assembled", "stale"] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

export const ROW_KINDS = ["subsystem", "tool"] as const;
export type RowKind = (typeof ROW_KINDS)[number];

export interface CanonicalRow {
  id: string;
  kind: RowKind;
  title: string;
  wave: Wave;
}

/**
 * §1.1's table, in table order. Wave assignment follows §6's wave→scope table
 * through the roadmap's W→C mapping (W1..W14 → C4..C17).
 */
const SUBSYSTEM_ROWS: CanonicalRow[] = [
  { id: "subsystem/tool-result-formatters", kind: "subsystem", wave: "C4", title: "Tool result formatters + validators (Read, Edit, Bash, Grep, task family)" },
  { id: "subsystem/tool-descriptions", kind: "subsystem", wave: "C5", title: "Tool-description functions + their satellite chunks' other exports" },
  { id: "subsystem/environment-and-system-prompt", kind: "subsystem", wave: "C6", title: "Environment block + system-prompt assembly" },
  { id: "subsystem/compaction", kind: "subsystem", wave: "C7", title: "Compaction: summarization prompt, compact_boundary emit, trigger policy" },
  { id: "subsystem/hook-dispatch", kind: "subsystem", wave: "C8", title: "Hook dispatch + hooks chunks" },
  { id: "subsystem/permissions", kind: "subsystem", wave: "C9", title: "Permission decisions + rule matching/parsing" },
  { id: "subsystem/control-protocol", kind: "subsystem", wave: "C10", title: "Control-protocol switch (control_request/control_response subtypes)" },
  { id: "subsystem/moat-tools", kind: "subsystem", wave: "C11", title: "Moat tools: SendMessage/ListAgents, Workflow, ScheduleWakeup, TaskCreate family, Skill, plan/worktree tools" },
  { id: "subsystem/session-storage", kind: "subsystem", wave: "C12", title: "Session/transcript storage; resume/fork" },
  { id: "subsystem/bash-executor", kind: "subsystem", wave: "C13", title: "Bash executor (exec/timeout/background) + command-safety AST" },
  { id: "subsystem/mcp-adapter", kind: "subsystem", wave: "C14", title: "MCP adapter (thin layer over the vendored MCP SDK)" },
  { id: "subsystem/slash-commands-and-skills", kind: "subsystem", wave: "C14", title: "Slash commands + skills loading" },
  { id: "subsystem/subagent-dispatch", kind: "subsystem", wave: "C15", title: "Agent/Task subagent dispatch" },
  { id: "subsystem/query-loop", kind: "subsystem", wave: "C16", title: "Query loop / turn driver (retry, 529, model fallback, compaction driver)" },
  { id: "subsystem/sandboxing", kind: "subsystem", wave: "C15", title: "Sandboxing (platform launchers behind an interface)" },
];

/**
 * §1.3's 31 headless native tools, in the spec's listing order. A tool row
 * closes on **owned execution** or an evidence-backed exclusion — which is
 * strictly more than owning its result formatter or its description.
 *
 * Wave assignment rule (applied uniformly, so the default is inspectable):
 * a tool row takes the wave that §6 gives its *execution* — Bash → C13,
 * Skill → C14, Agent → C15, and the file/search tool layer → C4; every tool
 * §6 leaves unassigned defaults to **C11**, whose charter is literally
 * "ledger rows per catalog tool" with per-tool headless reachability probed
 * first (§1.3, §6 W8). C11 decomposes at dispatch and may reassign or exclude
 * rows there — that is the designed adjudication point, not a gap here.
 */
const TOOL_ROWS: CanonicalRow[] = [
  { id: "tool/Agent", kind: "tool", wave: "C15", title: "Agent — subagent dispatch tool" },
  { id: "tool/AskUserQuestion", kind: "tool", wave: "C11", title: "AskUserQuestion" },
  { id: "tool/Bash", kind: "tool", wave: "C13", title: "Bash" },
  { id: "tool/CronCreate", kind: "tool", wave: "C11", title: "CronCreate" },
  { id: "tool/CronDelete", kind: "tool", wave: "C11", title: "CronDelete" },
  { id: "tool/CronList", kind: "tool", wave: "C11", title: "CronList" },
  { id: "tool/Edit", kind: "tool", wave: "C4", title: "Edit" },
  { id: "tool/EnterPlanMode", kind: "tool", wave: "C11", title: "EnterPlanMode" },
  { id: "tool/ExitPlanMode", kind: "tool", wave: "C11", title: "ExitPlanMode" },
  { id: "tool/EnterWorktree", kind: "tool", wave: "C11", title: "EnterWorktree" },
  { id: "tool/ExitWorktree", kind: "tool", wave: "C11", title: "ExitWorktree" },
  { id: "tool/Glob", kind: "tool", wave: "C4", title: "Glob" },
  { id: "tool/Grep", kind: "tool", wave: "C4", title: "Grep" },
  { id: "tool/ListAgents", kind: "tool", wave: "C11", title: "ListAgents" },
  { id: "tool/NotebookEdit", kind: "tool", wave: "C4", title: "NotebookEdit" },
  { id: "tool/Read", kind: "tool", wave: "C4", title: "Read" },
  { id: "tool/RemoteTrigger", kind: "tool", wave: "C11", title: "RemoteTrigger" },
  { id: "tool/ReportFindings", kind: "tool", wave: "C11", title: "ReportFindings" },
  { id: "tool/ScheduleWakeup", kind: "tool", wave: "C11", title: "ScheduleWakeup" },
  { id: "tool/SendMessage", kind: "tool", wave: "C11", title: "SendMessage" },
  { id: "tool/Skill", kind: "tool", wave: "C14", title: "Skill" },
  { id: "tool/TaskCreate", kind: "tool", wave: "C11", title: "TaskCreate" },
  { id: "tool/TaskGet", kind: "tool", wave: "C11", title: "TaskGet" },
  { id: "tool/TaskList", kind: "tool", wave: "C11", title: "TaskList" },
  { id: "tool/TaskOutput", kind: "tool", wave: "C11", title: "TaskOutput" },
  { id: "tool/TaskStop", kind: "tool", wave: "C11", title: "TaskStop" },
  { id: "tool/TaskUpdate", kind: "tool", wave: "C11", title: "TaskUpdate" },
  { id: "tool/WebFetch", kind: "tool", wave: "C11", title: "WebFetch" },
  { id: "tool/WebSearch", kind: "tool", wave: "C11", title: "WebSearch — server-executed; the client-side surface is formatting only (§1.2)" },
  { id: "tool/Workflow", kind: "tool", wave: "C11", title: "Workflow" },
  { id: "tool/Write", kind: "tool", wave: "C4", title: "Write" },
];

export const CANONICAL_ROWS: CanonicalRow[] = [...SUBSYSTEM_ROWS, ...TOOL_ROWS];

export interface ExcludedRow {
  id: string;
  kind: RowKind;
  /** Why it is out of scope, in §1.2's terms. */
  reason: string;
  /** What settled it — a probe, a scenario, a research doc. §1.3 demands evidence. */
  evidence: string;
}

/**
 * §1.2's exit door, made machine-checkable: a row leaves CANONICAL_ROWS only by
 * arriving here with a reason and evidence, and `ledger.json` may not carry an
 * excluded row. Empty at W0 — no row has yet earned an evidence-backed
 * exclusion (the §1.2 table excludes whole *areas*, which never entered the
 * ledger at all).
 */
export const EXCLUDED_ROWS: ExcludedRow[] = [];

export const SUBSYSTEM_IDS: string[] = SUBSYSTEM_ROWS.map((r) => r.id);
