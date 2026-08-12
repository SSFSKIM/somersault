// tui/src/taskPanelModel.ts — the PURE half of the todo panel (F6 T13, DG56-DG58): the counts, the sort, the
// window and the overflow sentence. Transcribed from `fGo` (bundle L407114-407195), whose rules are all
// arithmetic on the list and therefore belong outside the component that draws them.
//
// THE WINDOW IS A FUNCTION OF THE TERMINAL HEIGHT, not of the list (L407118): `i <= 10 ? 0 : min(5, max(3,
// i - 14))`. Its zero arm is not a guard — on a ten-row terminal upstream shows the header and NOTHING else
// (the overflow line is itself gated on `u > 0`, L407191), because there is no room. Faithful, quirk and all.
import stringWidth from "string-width";
import type { TaskItem, TaskStatus } from "./taskList.js";

/** `MCp = 30000` (L407265): how long a task that JUST completed stays pinned at the top of the window before
 *  it sinks to the tail with the other completed ones. */
export const RECENT_COMPLETE_MS = 30_000;

/** `u` (L407118). */
export function todoWindowSize(rows: number): number {
  return rows <= 10 ? 0 : Math.min(5, Math.max(3, rows - 14));
}

/** HOW TALL `TaskPanel` COMPOSES (FSW T13b), so the fullscreen dock band can reserve its rows before handing
 *  what is left to a decision dialog. Its `marginTop` and count header, one row per shown task, the activity
 *  line under the in-progress one, and the overflow line when the window hid something.
 *    EXACT FOR THE ORDINARY LIST, short by one per EXTRA row that is simultaneously in progress — TodoWrite's
 *  discipline keeps that at one, and the panel's own test pins this count against what it renders. */
export function todoPanelRows(tasks: readonly TaskItem[], rows: number): number {
  if (tasks.length === 0) return 0;
  const window = todoWindowSize(rows);
  const shown = Math.min(tasks.length, window);
  const activity = tasks.some((t) => t.status === "in_progress" && t.activeForm) ? 1 : 0;
  return 2 + shown + activity + (window > 0 && tasks.length > shown ? 1 : 0);
}

/** `Pyn` (L407108-407113): numeric when both ids parse, lexicographic otherwise. */
export function compareTaskIds(a: TaskItem, b: TaskItem): number {
  const x = parseInt(a.id, 10), y = parseInt(b.id, 10);
  if (!isNaN(x) && !isNaN(y)) return x - y;
  return a.id.localeCompare(b.id);
}

const count = (tasks: readonly TaskItem[], status: TaskStatus): number => tasks.filter((t) => t.status === status).length;

export interface TodoCounts { total: number; done: number; inProgress: number; open: number }
/** `y`/`_`/`E` (L407160). `open` is the PENDING count — upstream's header calls it "open", and in-progress is
 *  the remainder, so the three never fail to add up even if a status we do not model arrives. */
export function todoCounts(tasks: readonly TaskItem[]): TodoCounts {
  const done = count(tasks, "completed"), open = count(tasks, "pending");
  return { total: tasks.length, done, open, inProgress: tasks.length - done - open };
}

/** The ids of every task that is not finished — what a blocker id is checked against (`A`, L407160), so a
 *  blocker that has since completed stops dimming the row it blocked. */
export const openTaskIds = (tasks: readonly TaskItem[]): Set<string> =>
  new Set(tasks.filter((t) => t.status !== "completed").map((t) => t.id));

/** `L407161-407179`. The windowed order is: just-completed, in progress, pending (unblocked first), then the
 *  older completed ones; `completedAt` is the caller's map of "when did this id become completed WHILE THE
 *  PANEL WAS MOUNTED" (upstream's `l.current`), so a list that arrives already-completed sorts as old. Under
 *  the window threshold the list is simply id-sorted (L407179). */
export function orderTasks(tasks: readonly TaskItem[], opts: { window: number; completedAt?: ReadonlyMap<string, number>; now?: number }): { shown: TaskItem[]; hidden: TaskItem[] } {
  if (tasks.length <= opts.window) return { shown: [...tasks].sort(compareTaskIds), hidden: [] };
  const now = opts.now ?? Date.now(), at = opts.completedAt;
  const fresh: TaskItem[] = [], stale: TaskItem[] = [];
  for (const t of tasks.filter((x) => x.status === "completed")) {
    const when = at?.get(t.id);
    (when !== undefined && now - when < RECENT_COMPLETE_MS ? fresh : stale).push(t);
  }
  fresh.sort(compareTaskIds); stale.sort(compareTaskIds);
  const running = tasks.filter((t) => t.status === "in_progress").sort(compareTaskIds);
  const open = openTaskIds(tasks);
  const pending = tasks.filter((t) => t.status === "pending").sort((a, b) => {
    const ba = (a.blockedBy ?? []).some((id) => open.has(id)), bb = (b.blockedBy ?? []).some((id) => open.has(id));
    if (ba !== bb) return ba ? 1 : -1;                                  // blocked rows sink below unblocked ones
    return compareTaskIds(a, b);
  });
  const ordered = [...fresh, ...running, ...pending, ...stale];
  return { shown: ordered.slice(0, opts.window), hidden: ordered.slice(opts.window) };
}

/** `k` (L407180-407190) — ` … +2 in progress, 3 pending`, in that order, zero clauses dropped. Empty string
 *  for an empty tail, which is also what gates the row (`u > 0 && k`, L407191). */
export function todoOverflowLine(hidden: readonly TaskItem[]): string {
  if (hidden.length === 0) return "";
  const parts: string[] = [];
  const inProgress = count(hidden, "in_progress"), pending = count(hidden, "pending"), completed = count(hidden, "completed");
  if (inProgress > 0) parts.push(`${inProgress} in progress`);
  if (pending > 0) parts.push(`${pending} pending`);
  if (completed > 0) parts.push(`${completed} completed`);
  return parts.length ? ` … +${parts.join(", ")}` : "";
}

/** `ura` (L407245): ` › blocked by #12, #13`, ids sorted NUMERICALLY (`qeH` L407091) and `#`-prefixed
 *  (`VeH` L407094). Only the blockers that are still open are passed in. */
export function blockedByLine(openBlockers: readonly string[]): string {
  return ` › blocked by ${[...openBlockers].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((id) => `#${id}`).join(", ")}`;
}

/** `Dyn` (L407212): the owner tag renders only at ≥60 columns. Upstream ANDs a third condition — the owner is
 *  a teammate whose agent is running right now (`p_0`, from the `runningSubagents` registry at L407150-407158)
 *  — which has no headless equivalent here: our wire carries the owner STRING and no teammate registry at all
 *  (probe 81 Q3). Presence of the name is therefore the whole gate, and that is a recorded divergence. */
export const showsOwnerTag = (owner: string | undefined, columns: number): owner is string => columns >= 60 && !!owner;

/** `Ut(\` (@${owner})\`)` (L407214) — upstream measures the tag with its own DISPLAY-width function, not
 *  `.length`, so a CJK or emoji owner name costs the columns it actually paints. `string-width` is the same
 *  measure `truncateLabel` (upstream's `gi`) already runs on the subject this budget is subtracted from. */
export const OWNER_TAG_WIDTH = (owner: string): number => stringWidth(` (@${owner})`);
/** `xCp` / `LCp` (L407217/L407222): the subject gets what is left after the fixed 15-column budget and the
 *  owner tag; the activity line gets the same budget without it. Never below 15. */
export const subjectWidth = (columns: number, ownerTag: number): number => Math.max(15, columns - 15 - ownerTag);
export const activityWidth = (columns: number): number => Math.max(15, columns - 15);
