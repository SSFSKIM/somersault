// tui/src/TaskPanel.tsx — the todo panel (F6 T13, DG56-DG60), rebuilt on upstream's own anatomy: `fra`
// (bundle L407097) → `fGo` in its `isStandalone` shape (L407114-407195) → one `PCp` row each (L407206-407264).
// The arithmetic lives in `taskPanelModel.ts`; this file is the header line, the rows and the two glyph tables.
//
// WHAT THE ROW ACTUALLY SAYS, and why each attribute is where it is (L407232-407255):
//   · the glyph carries the COLOUR (`DCp` L407196: completed `✔` success · in_progress `◼` claude · pending
//     `◻` uncoloured) and the subject carries the ATTRIBUTES — bold while in progress, strikethrough when
//     completed, and dim when completed OR blocked. They are two `Text` nodes precisely so the strike does not
//     run through the tick.
//   · the owner tag, the blocker clause and the activity sub-line are the three DECORATIONS, and each renders
//     only when the wire carried the field it needs (probe 81 Q3: all three are schema-optional and a real run
//     sent none of them). `taskList.ts` says the same thing from the ingest side.
//   · THERE IS NO EMPTY STATE. `fra` returns `null` on an empty list (L407099) and so do we — the panel is
//     not a box that says "no tasks", it is absent.
//
// The 30-second hoist (`MCp`, L407118-407136) needs a clock, so the completion timestamps live in a ref here
// and a timer forces the one repaint that lets a stale row sink. `now`/`schedule` are injectable for the same
// reason every other timed surface in this package injects them: a test must be able to watch the real rule.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import type { TaskItem, TaskStatus } from "./taskList.js";
import { truncateLabel } from "./select/selectModel.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";
import { TICK, unicodeSupported } from "./figures.js";
import {
  activityWidth, blockedByLine, OWNER_TAG_WIDTH, openTaskIds, orderTasks, RECENT_COMPLETE_MS, showsOwnerTag,
  subjectWidth, todoCounts, todoOverflowLine, todoWindowSize,
} from "./taskPanelModel.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

/** `Ge.tick` / `Ge.squareSmallFilled` / `Ge.squareSmall` (L104968) as `DCp` (L407196) picks them, with the
 *  ASCII fallbacks from the same table's `Lkg` block for a terminal that cannot draw them. */
// ONE predicate for the whole row, because canon uses one: `tick`, `squareSmallFilled` and `squareSmall`
// sit in the SAME table (L107735) and canon selects all three with a single `EJi` call. Splitting them —
// the tick on the win32-aware predicate, the squares on `TERM !== "linux"` — would draw an ASCII tick beside
// unicode squares on a bare cmd.exe, a mixed set canon never produces.
const UNICODE = unicodeSupported();
// `completed` is TICK() itself, not a literal — see figures.ts (F8 T8): the same glyph banner.ts's startup
// checklist and Select's list rows draw, so the surfaces can't disagree. Hoisted out of the ternary because
// it now shares that ternary's own predicate rather than varying independently of it.
const completed = TICK();
export const TODO_GLYPH: Record<TaskStatus, string> = UNICODE
  ? { completed, in_progress: "◼", pending: "◻" }
  : { completed, in_progress: "■", pending: "□" };
const GLYPH_COLOR: Record<TaskStatus, ThemeTokenName | undefined> = { completed: "success", in_progress: "claude", pending: undefined };
/** `Ge.ellipsis` — the activity line's trailing character, always drawn (L407255). */
const ELLIPSIS = "…";

function TodoRow({ task, openBlockers, columns }: { task: TaskItem; openBlockers: string[]; columns: number }) {
  const completed = task.status === "completed", inProgress = task.status === "in_progress";
  const blocked = openBlockers.length > 0;
  const glyphColor = GLYPH_COLOR[task.status];
  const owner = showsOwnerTag(task.owner, columns) ? task.owner : undefined;
  const subject = truncateLabel(task.subject, subjectWidth(columns, owner ? OWNER_TAG_WIDTH(owner) : 0));
  // `ICp` (L407212): the activity line is for an in-progress row that is NOT waiting on anything.
  const activity = inProgress && !blocked && task.activeForm ? truncateLabel(task.activeForm, activityWidth(columns)) : undefined;
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={glyphColor ? role(glyphColor) : undefined}>{TODO_GLYPH[task.status]} </Text>
        <Text bold={inProgress} strikethrough={completed} dimColor={completed || blocked}>{subject}</Text>
        {owner ? <Text dimColor>{` (@${owner})`}</Text> : null}
        {blocked ? <Text dimColor>{blockedByLine(openBlockers)}</Text> : null}
      </Box>
      {activity ? <Box><Text dimColor>{"  "}{activity}{ELLIPSIS}</Text></Box> : null}
    </Box>
  );
}

export function TaskPanel({ tasks, columns = 80, rows = 24, now = Date.now, schedule }: {
  tasks: TaskItem[];
  /** The live terminal width — ChatApp already tracks it, and the owner tag's ≥60 gate is the only reader. */
  columns?: number;
  /** The live terminal height: the WINDOW is a function of it (`todoWindowSize`), not of the list. */
  rows?: number;
  now?: () => number;
  /** Fire `cb` once, `ms` from now, returning its canceller — the repaint that lets a just-completed row sink
   *  after 30s. Defaults to setTimeout; injected in tests so the rule can be watched without waiting. */
  schedule?: (cb: () => void, ms: number) => () => void;
}) {
  // id → the moment it became completed WHILE MOUNTED. Seeded on the first render from the list as it arrived
  // (`c.current`, L407116-407117), so tasks that were already done when the panel appeared count as OLD.
  const completedAt = useRef(new Map<string, number>());
  const seen = useRef<Set<string> | null>(null);
  const [, repaint] = useState(0);
  const stamp = now();
  const done = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
  if (seen.current === null) seen.current = done;
  for (const id of done) if (!seen.current.has(id)) completedAt.current.set(id, stamp);
  for (const id of [...completedAt.current.keys()]) if (!done.has(id)) completedAt.current.delete(id);
  seen.current = done;

  // One timer, armed for the EARLIEST pending expiry (L407125-407136). Re-armed on every task change, which is
  // also how a hoist that expired while nothing else repainted gets its frame.
  useEffect(() => {
    if (completedAt.current.size === 0) return;
    const at = now();
    let soonest = Infinity;
    for (const when of completedAt.current.values()) { const due = when + RECENT_COMPLETE_MS; if (due > at && due < soonest) soonest = due; }
    if (soonest === Infinity) return;
    const fire = () => repaint((n) => n + 1);
    if (schedule) return schedule(fire, soonest - at);
    const t = setTimeout(fire, soonest - at);
    return () => clearTimeout(t);
  }, [tasks, now, schedule]);

  if (tasks.length === 0) return null;                                   // `fra` L407099 — no empty state
  const { total, done: doneCount, inProgress, open } = todoCounts(tasks);
  const window = todoWindowSize(rows);
  const { shown, hidden } = orderTasks(tasks, { window, completedAt: completedAt.current, now: stamp });
  const overflow = todoOverflowLine(hidden);
  const blockersOpen = openTaskIds(tasks);
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <Box>
        <Text dimColor>
          <Text bold>{total}</Text> tasks (<Text bold>{doneCount}</Text> done, {inProgress > 0 ? <><Text bold>{inProgress}</Text> in progress, </> : null}<Text bold>{open}</Text> open)
        </Text>
      </Box>
      {shown.map((t) => (
        <TodoRow key={t.id} task={t} columns={columns}
          openBlockers={(t.blockedBy ?? []).filter((id) => blockersOpen.has(id))} />
      ))}
      {window > 0 && overflow ? <Text dimColor>{overflow}</Text> : null}
    </Box>
  );
}
