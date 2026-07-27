// tui/src/taskList.ts — pure reducer: the SDK's native task ops (TaskCreate/TaskUpdate/TaskList) → a checklist.
// Probe 22b: TaskCreate input {subject}; the id arrives in the RESULT "Task #N created successfully: <subject>";
// TaskUpdate input {taskId,status} applies by id. No React/SDK. Unknown/partial frames ignored.
export type TaskStatus = "pending" | "in_progress" | "completed";
export interface TaskItem { id: string; subject: string; status: TaskStatus }

const resultText = (content: unknown): string =>
  typeof content === "string" ? content
  : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";

export class TaskList {
  private tasks = new Map<string, TaskItem>();      // id → item
  private pending = new Map<string, string>();      // TaskCreate tool_use_id → subject (awaiting result id)

  ingest(m: unknown): void {
    const mm = m as any;
    if (mm?.type === "assistant") for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_use") continue;
      if (b.name === "TaskCreate") this.pending.set(String(b.id ?? ""), String(b.input?.subject ?? ""));
      else if (b.name === "TaskUpdate") {
        const id = String(b.input?.taskId ?? ""), t = this.tasks.get(id);
        if (t && b.input?.status) t.status = b.input.status as TaskStatus;
      }
    } else if (mm?.type === "user") for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_result") continue;
      const subject = this.pending.get(String(b.tool_use_id ?? ""));
      if (subject === undefined) continue;
      const id = resultText(b.content).match(/Task #(\d+) created/)?.[1];
      if (id) this.tasks.set(id, { id, subject, status: "pending" });
      this.pending.delete(String(b.tool_use_id ?? ""));
    }
  }

  snapshot(): TaskItem[] { return [...this.tasks.values()].sort((a, b) => Number(a.id) - Number(b.id)); }
  reset(): void { this.tasks.clear(); this.pending.clear(); }
}
