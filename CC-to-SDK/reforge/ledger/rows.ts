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
 * through the roadmap's W→C mapping (W1..W14 → C4..C17) — except where a child
 * subdivided a row with measured evidence, which is a deliberate two-file edit
 * (here and in ledger.json) reviewed like any other scope change.
 */
const SUBSYSTEM_ROWS: CanonicalRow[] = [
  // §1.1's first row was "formatters + validators". C4 SUBDIVIDED it, with
  // evidence: the Edit tool's error results are not produced by
  // `mapToolResultToToolResultBlockParam` at all but by a sibling
  // `validateInput` — 3,317 minified chars against the formatters' 155–1,590,
  // with filesystem reads, read-state access, telemetry and gate reads (mostly
  // `effectful-port` captures), needing its own scenario (a deliberately
  // missing `old_string`) and its own gate row. Keeping the two halves in one
  // row would have made "the formatter family is owned" and "the validator
  // family is owned" indistinguishable states. See the campaign spec's Revision
  // Notes for the subdivision, and reforge/ledger.json for the validator row's
  // open wave assignment.
  { id: "subsystem/tool-result-formatters", kind: "subsystem", wave: "C4", title: "Tool result formatters (Read, Edit, Bash, Grep, Glob, Write, task family)" },
  // REASSIGNED C4 -> C13 (2026-09-03, W8a, on the W10 scout's measurement): the
  // validator family is not a formatter sibling that C4 happened not to reach.
  // Its largest members are the Bash tool's, they share the command-safety
  // chain and the shell parser with the executor, and owning them apart from
  // that chain would mean owning a caller whose callee is upstream's. The wave
  // that owns the parser owns them.
  { id: "subsystem/tool-result-validators", kind: "subsystem", wave: "C13", title: "Tool-result validators (Edit's validateInput and its 19 siblings)" },
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
  // ADDED 2026-09-03 (W8a). X2 says one row per headless catalog tool, and
  // `PowerShell` IS presented headlessly — under `CLAUDE_CODE_USE_POWERSHELL_TOOL`,
  // which is inside the env allowlist, and proven so by the committed
  // `m3-flip-observed-flip-…` cassette: the flipped catalog is 23 tools, not 22.
  // (The same measurement corrects a claim three documents carried: `Read` does
  // NOT leave the array. PowerShell is INSERTED at the sorted index 10 and Read
  // shifts to 11 — a positional diff read as a substitution.) Its chunk is
  // W10's, so the row is C13's and not this wave's.
  { id: "tool/PowerShell", kind: "tool", wave: "C13", title: "PowerShell — presented only under the in-allowlist CLAUDE_CODE_USE_POWERSHELL_TOOL override" },
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
  // REASSIGNED C11 -> C5 (2026-09-03, W8a). It sat at C11 by the default rule
  // above, not by a judgement about WebFetch: nothing in it is moat work, and
  // the only client-side surface anything owns today is its description, which
  // C5 spliced (`webfetch-description`) and which C5's subsystem row already
  // names as an edge.
  { id: "tool/WebFetch", kind: "tool", wave: "C5", title: "WebFetch" },
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
  /**
   * §1.2's one PIN-CONDITIONAL exclusion kind: gate-dead with no lever AT THIS
   * PIN. Every other exclusion in the table is structural and permanent (the TUI
   * never traverses the seam; a vendored library is imported at assembly; the
   * search runs server-side) — this one expires the moment upstream flips a
   * compiled-in default, and a row that quietly stays out after that is a row
   * the campaign lost rather than excluded.
   *
   * So the condition is declared rather than described, and `ledger/check.ts`
   * holds it against the pinned `gate-defaults-<pin>.json`: the gate must still
   * carry this default and must still have no env override. A pin bump that
   * changes either reddens the ledger, and the row is re-adjudicated — back into
   * CANONICAL_ROWS if it is now reachable, or here again with fresh evidence.
   *
   * `default` is the compiled-in value that makes the row unreachable, which is
   * not always `false`: a kill switch defaulting TRUE hides the disabled arm.
   */
  gateDead?: { gate: string; default: boolean };
}

/**
 * §1.2's exit door, made machine-checkable: a row leaves CANONICAL_ROWS only by
 * arriving here with a reason and evidence, and `ledger.json` may not carry an
 * excluded row. Empty at W0 — no row has yet earned an evidence-backed
 * exclusion (the §1.2 table excludes whole *areas*, which never entered the
 * ledger at all).
 */
export const EXCLUDED_ROWS: ExcludedRow[] = [
  // ---- 2026-09-03, W8a: the first two rows to leave by this door ----------
  //
  // Both were C11 rows by the default assignment rule above, and W8's scout
  // measured that neither is moat work. They leave in opposite directions and
  // the difference is the point: one has a client-side surface other rows
  // already own, the other has no client-side surface at all. They also leave
  // under different KINDS — WebSearch's exclusion is structural and permanent,
  // Monitor's is PIN-CONDITIONAL and checked against the pin (see `gateDead`).
  {
    id: "tool/WebSearch",
    kind: "tool",
    reason:
      "§1.2 server boundary. A tool row closes on OWNED EXECUTION, and WebSearch has none to own: the search runs API-side and the client never issues a query. " +
      "What is left on this side is a description and a result formatter over a server-shaped payload, and those belong to subsystem/tool-descriptions and " +
      "subsystem/tool-result-formatters — neither of which can close a tool row. Excluding it is therefore narrower than it sounds: it removes a row that could " +
      "never have been closed, and removes nothing anyone could have owned.",
    evidence:
      "reforge/research/2026-09-02-w8-moat-tools-scout.md §7.4; the row's own §1.3 title, which said so before it was assigned; " +
      "research/fixtures/moat-tools-2.1.251.json (WebSearch presented in the corpus with FOUR description variants and no execution path in any recorded body)",
  },
  {
    id: "tool/Monitor",
    kind: "tool",
    // The kind this row needed §1.2 to have. `Feature gates are neither spliced
    // nor excluded` (§1.2) is about gated CODE INSIDE an owned row — reforge
    // pins the resolver rather than carving branches out of a splice. A row
    // whose ENTIRE surface is unreachable at the pin is a different question,
    // and answering it with §3.3 would have left the row in the ledger as
    // permanently unclosable work. It leaves through this door instead, with
    // the pin condition attached and checked by `ledger/check.ts`.
    gateDead: { gate: "tengu_amber_sentinel", default: false },
    reason:
      "GATE-DEAD AT THIS PIN, WITH NO LEVER, and it RE-ENTERS the canonical rows on a pin bump that flips the default — §1.2's one pin-conditional exclusion " +
      "kind, declared in `gateDead` above so `ledger/check.ts` can hold it against the pinned gate fixture rather than trusting this sentence. It is here because " +
      "'the moat includes persistent notifications' is a standing product claim that deserved a " +
      "measured answer rather than an absence. `MonitorTool.isEnabled(){return RI()&&as()}` and `RI(){return I(\"tengu_amber_sentinel\",!1)}`; the compiled-in " +
      "default in research/fixtures/gate-defaults-2.1.251.json is false, §3.3 pins every gate to its compiled-in default, and `tengu_amber_sentinel` is not among " +
      "that fixture's per-gate env overrides — so flip-liveness cannot reach it either. It is absent from all 82 recorded cassettes, and the GUARDS are what rule " +
      "it out; the absence alone would only have been a coincidence.",
    evidence:
      "reforge/research/2026-09-02-w8-moat-tools-scout.md §2.4 and §5.3; research/fixtures/gate-defaults-2.1.251.json (default false, absent from perGateEnvOverrides); " +
      "research/fixtures/moat-tools-2.1.251.json (12 recorded catalog shapes, none containing Monitor); " +
      "strangle/modules/shared/tool-names.js:MONITOR_TOOL_NAME (its name is owned because CronCreate's description points at it, and that arm is dark for the same reason)",
  },
];

export const SUBSYSTEM_IDS: string[] = SUBSYSTEM_ROWS.map((r) => r.id);
