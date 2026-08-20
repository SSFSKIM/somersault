// tui/src/taskList.ts — pure reducer: the SDK's native task ops (TaskCreate/TaskUpdate/TaskList) → a checklist.
// Probe 22b: TaskCreate input {subject}; the id arrives in the RESULT "Task #N created successfully: <subject>";
// TaskUpdate input {taskId,status} applies by id. No React/SDK. Unknown/partial frames ignored.
//
// F6 T13 widened the ingest to the THREE DECORATIONS the todo panel draws (DG56-DG58). The tool schemas are
// the bundle's own (TaskCreate `wzy` L286299: `{subject, description, activeForm?, metadata?}`; TaskUpdate
// `S.strictObject` L286488: `{taskId, subject?, description?, activeForm?, status?, addBlocks?, addBlockedBy?,
// owner?, metadata?}`), and every one of the three is OPTIONAL there — probe 81 Q3 watched a real run and saw
// TaskCreate `{subject, description}` ×3 + TaskUpdate `{taskId, status}` and nothing else. So they are ingested
// WHEN PRESENT and the row renders each decoration only when the wire carried it; nothing is defaulted into
// existence (an empty `blockedBy: []` on every item would make the panel's blocker line a permanent lie about
// having been told something).
export type TaskStatus = "pending" | "in_progress" | "completed";
export interface TaskItem {
  id: string; subject: string; status: TaskStatus;
  /** `activeForm` — "Running tests", the present-continuous label the panel prints under an in-progress row. */
  activeForm?: string;
  /** `owner` — an agent name, TaskUpdate only. Rendered as ` (@name)` at ≥60 columns. */
  owner?: string;
  /** Accumulated `addBlockedBy` ids (the tool has no `blockedBy` input — only the additive form). Absent
   *  rather than empty when nothing has ever blocked this task. */
  blockedBy?: string[];
  /** Set when this task's `TaskCreate` arrived on a NESTED frame (the frame carried a `parent_tool_use_id`).
   *  Absent = the main agent's, following this file's absent-rather-than-empty rule. Canon can ask "is this
   *  the main agent's task?" because its task store is per-agent; ours is global, so the origin is recorded
   *  here instead. Only the spinner's message ladder reads it — the panel shows every task regardless. */
  subagent?: true;
}

const resultText = (content: unknown): string =>
  typeof content === "string" ? content
  : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
/** `addBlockedBy` is `S.array(S.string())`, but ids reach us as whatever the model sent — numbers included. */
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

export class TaskList {
  private tasks = new Map<string, TaskItem>();      // id → item
  private pending = new Map<string, { subject: string; activeForm?: string; subagent?: true }>();   // TaskCreate tool_use_id → what it said (awaiting result id)

  ingest(m: unknown): void {
    const mm = m as any;
    if (mm?.type === "assistant") {
      // Provenance lives on the FRAME, never on the content block, and it is bound to THIS pending create —
      // the result that carries the id arrives later, on a frame of its own that says nothing about origin.
      // Same idiom as every other nested-frame reader here (toolRenderer `isNested`): a top-level frame sends
      // `parent_tool_use_id: null` on the wire, so only a non-empty string means nested.
      const nested = str(mm.parent_tool_use_id) ? (true as const) : undefined;
      for (const b of mm.message?.content ?? []) {
        if (b?.type !== "tool_use") continue;
        if (b.name === "TaskCreate") this.pending.set(String(b.id ?? ""), { subject: String(b.input?.subject ?? ""), ...(str(b.input?.activeForm) ? { activeForm: str(b.input.activeForm)! } : {}), ...(nested ? { subagent: nested } : {}) });
        else if (b.name === "TaskUpdate") {
          const id = String(b.input?.taskId ?? ""), t = this.tasks.get(id);
          if (!t) continue;
          if (b.input?.status) t.status = b.input.status as TaskStatus;
          if (str(b.input?.subject)) t.subject = str(b.input.subject)!;
          if (str(b.input?.activeForm)) t.activeForm = str(b.input.activeForm)!;
          if (str(b.input?.owner)) t.owner = str(b.input.owner)!;
          const added = ids(b.input?.addBlockedBy);
          if (added.length) t.blockedBy = [...new Set([...(t.blockedBy ?? []), ...added])];
        }
      }
    } else if (mm?.type === "user") for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_result") continue;
      const created = this.pending.get(String(b.tool_use_id ?? ""));
      if (created === undefined) continue;
      const id = resultText(b.content).match(/Task #(\d+) created/)?.[1];
      if (id) this.tasks.set(id, { id, subject: created.subject, status: "pending", ...(created.activeForm ? { activeForm: created.activeForm } : {}), ...(created.subagent ? { subagent: created.subagent } : {}) });
      this.pending.delete(String(b.tool_use_id ?? ""));
    }
  }

  snapshot(): TaskItem[] { return [...this.tasks.values()].sort((a, b) => Number(a.id) - Number(b.id)); }
  reset(): void { this.tasks.clear(); this.pending.clear(); }
}
