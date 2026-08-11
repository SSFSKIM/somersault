// tui/src/bgTaskMeta.ts — pure harvest of background-task metadata from frames the REPL already
// receives. The streamed background_tasks_changed snapshot carries only {task_id, task_type,
// description} (probe 74 Q3); the command, the output-file path, and the final status live in OTHER
// frames of the same stream: the assistant tool_use that started it (input.command + run_in_background —
// Q2), the tool_result text ("Command running in background with ID: <id>. Output is being written
// to: <path>. …" — Q1 verbatim), task_started's tool_use_id linking the two (Q2), and
// task_notification settling {status, summary}. Ingest is idempotent, so replayed/buffered dup frames
// (reconnect, attach) are harmless — no host/wire change anywhere in this slice.
import type { BackgroundTaskInfo } from "../session/session.js";

/** `startedAt`/`endedAt` are OUR clock, not the wire's: the snapshot carries no timestamps at all, so the
 *  moments `task_started` and `task_notification` ARRIVED are the only runtime we can honestly report (F6 T13 —
 *  the Background dialog's `Runtime:` row, bundle L479833). A row whose start we never saw (a reconnect that
 *  joined mid-task) carries neither, and the detail view then omits the row rather than inventing a duration. */
export interface BgTaskRow extends BackgroundTaskInfo { command?: string; outputFile?: string; status: string; summary?: string; startedAt?: number; endedAt?: number }

// \S+ means a path containing a space fails to parse — the panel then degrades to "(no output file
// reported)" rather than mis-splitting; the CLI's own task dir has no spaces on any platform we ship.
const RESULT_RE = /running in background with ID:\s*(\S+?)\.\s*Output is being written to:\s*(\S+?)\.\s/;
const FINISHED_CAP = 5;

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("\n");
  return "";
}

export class BgMetaHarvest {
  private commandByToolUse = new Map<string, string>();
  private toolUseByTask = new Map<string, string>();
  private meta = new Map<string, { outputFile?: string; status?: string; summary?: string; startedAt?: number; endedAt?: number }>();
  private infoByTask = new Map<string, BackgroundTaskInfo>();   // last-known info, for finished rows
  private finishedIds: string[] = [];                            // insertion order, capped

  constructor(private now: () => number = Date.now) {}

  /** Feed every `message` event's data (assistant tool_use inputs + user tool_result texts). */
  ingestMessage(m: unknown): void {
    const mm = m as any;
    if (mm?.type === "assistant") {
      for (const b of mm.message?.content ?? []) {
        if (b?.type === "tool_use" && b.input?.run_in_background && typeof b.input.command === "string" && b.id)
          this.commandByToolUse.set(String(b.id), b.input.command);
      }
    } else if (mm?.type === "user") {
      for (const b of mm.message?.content ?? []) {
        if (b?.type !== "tool_result") continue;
        const match = RESULT_RE.exec(resultText(b.content));
        if (match) this.upsert(match[1], { outputFile: match[2] });
      }
    }
  }

  /** Feed every `task` event's data. Frames arrive with a bare type OR as a system subtype (host re-emits both). */
  ingestTask(t: unknown): void {
    const tt = t as any;
    const sub = tt?.type === "system" ? tt.subtype : tt?.type;
    if (sub === "task_started" && tt.task_id) {
      const id = String(tt.task_id);
      if (tt.tool_use_id) this.toolUseByTask.set(id, String(tt.tool_use_id));
      this.infoByTask.set(id, { task_id: id, task_type: String(tt.task_type ?? ""), description: String(tt.description ?? "") });
      if (this.meta.get(id)?.startedAt === undefined) this.upsert(id, { startedAt: this.now() });   // a replayed dup must not restart the clock
    } else if (sub === "task_notification" && tt.task_id) {
      const id = String(tt.task_id);
      // Only tasks we saw start become finished rows — the host emits a SYNTHETIC task_notification
      // with task_id "rewind" when a rewind ends bg tasks; it must not fabricate a panel row.
      if (!this.infoByTask.has(id)) return;
      this.upsert(id, { status: String(tt.status ?? "completed"), endedAt: this.now(), ...(tt.summary ? { summary: String(tt.summary) } : {}) });
      if (!this.finishedIds.includes(id)) { this.finishedIds.push(id); if (this.finishedIds.length > FINISHED_CAP) this.finishedIds.shift(); }
    }
  }

  private upsert(taskId: string, patch: { outputFile?: string; status?: string; summary?: string; startedAt?: number; endedAt?: number }): void {
    this.meta.set(taskId, { ...this.meta.get(taskId), ...patch });
  }
  private commandFor(taskId: string): string | undefined {
    const tu = this.toolUseByTask.get(taskId);
    return tu ? this.commandByToolUse.get(tu) : undefined;
  }

  /** Live snapshot rows (always status "running") followed by finished rows, newest finish first. */
  rows(live: BackgroundTaskInfo[]): BgTaskRow[] {
    const liveIds = new Set(live.map((t) => t.task_id));
    const out: BgTaskRow[] = live.map((t) => {
      const m = this.meta.get(t.task_id);
      return { ...t, command: this.commandFor(t.task_id), outputFile: m?.outputFile, status: "running", ...(m?.startedAt !== undefined ? { startedAt: m.startedAt } : {}) };
    });
    for (const id of [...this.finishedIds].reverse()) {
      if (liveIds.has(id)) continue;
      const info = this.infoByTask.get(id)!;
      const m = this.meta.get(id) ?? {};
      out.push({ ...info, command: this.commandFor(id), outputFile: m.outputFile, status: m.status ?? "completed", ...(m.summary ? { summary: m.summary } : {}) , ...(m.startedAt !== undefined ? { startedAt: m.startedAt } : {}), ...(m.endedAt !== undefined ? { endedAt: m.endedAt } : {}) });
    }
    return out;
  }

  reset(): void { this.commandByToolUse.clear(); this.toolUseByTask.clear(); this.meta.clear(); this.infoByTask.clear(); this.finishedIds = []; }
}
