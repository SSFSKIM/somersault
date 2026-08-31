// W1 corpus family — "per-tool result depth" (campaign spec C4 / §3.2).
//
// The three-surface diff grades a formatter only where the corpus actually makes
// its output observable, and the W1 anchor scout measured the gap: of the seven
// formatters this wave owns, **Edit and the whole task family had no covering
// scenario at all** (reforge/research/2026-08-31-w1-anchor-scout.md §5). A splice
// with no covering scenario is ungated by construction — the gate's solo-sabotage
// phase fails it outright — so these two scenarios are a precondition of the
// wave, not a nicety.
//
// Both are normally graded (no `substanceOnly`), so the transcripts / events /
// requests surfaces do the equivalence work and the substance checks guard only
// the hollow-pass class: they assert the scenario exercised the branches it
// claims, in terms that hold for ANY equivalent engine (they run against both
// sides).
import { baseOptions, drive, resultText, type Scenario } from "../src/harness.js";
import { SANDBOX } from "../src/runTurn.js";

/** Assistant tool_use blocks, optionally filtered by tool name. */
function toolUses(msgs: unknown[], name?: string): { name?: string; input?: Record<string, unknown> }[] {
  const out: { name?: string; input?: Record<string, unknown> }[] = [];
  for (const m of msgs) {
    const mm = m as { type?: string; message?: { content?: unknown } };
    if (mm.type !== "assistant") continue;
    const c = mm.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
      if (b?.type === "tool_use" && (!name || b.name === name)) out.push({ name: b.name, input: b.input });
    }
  }
  return out;
}

export const W1_SCENARIOS: Scenario[] = [
  {
    // Drives BOTH arms of the Edit tool's result formatter:
    //   replace_all false -> "The file <p> has been updated successfully.<suffix>"
    //   replace_all true  -> "The file <p> has been updated. All occurrences were
    //                         successfully replaced.<suffix>"
    // <suffix> is the freshness constant the Write formatter already owns, which
    // is why this scenario also pins the shared-constant retrofit: sabotaging
    // either arm, or corrupting the suffix, diverges the tool_result content in
    // the transcript AND in the next request body.
    //
    // Write comes first because the Edit tool refuses a file it has no read state
    // for ("File has not been read yet"), and Write establishes that state — so
    // this scenario stays on the success path and never reaches the validator
    // (which is a different function, out of C4's scope; see the scout's §4).
    tag: "edit-tool",
    title: "Edit single-occurrence and replace_all branches round-trip",
    run: (ctx) =>
      drive(
        `Work only inside the sandbox. Do exactly these three steps, in order, on the file at exactly this absolute path: ${SANDBOX}/edit-target.txt\n` +
          `1. Use the Write tool to create that file containing exactly three lines: ALPHA then BETA then ALPHA.\n` +
          `2. Use the Edit tool once with old_string BETA and new_string GAMMA. Do not set replace_all for this edit.\n` +
          `3. Use the Edit tool a second time with old_string ALPHA, new_string DELTA, and replace_all set to true.\n` +
          `Then reply with exactly EDIT_OK and nothing else.`,
        {
          ...baseOptions(ctx),
          allowedTools: ["Write", "Edit"],
          maxTurns: 8,
          permissionMode: "bypassPermissions",
        },
      ),
    check: (msgs) => {
      const writes = toolUses(msgs, "Write");
      if (writes.length === 0) return "Write tool never used";
      const edits = toolUses(msgs, "Edit");
      if (edits.length !== 2) return `expected exactly 2 Edit calls, saw ${edits.length}`;
      // The two BRANCHES are the point: one call must set replace_all and one
      // must not, or the scenario covers half the formatter it exists to cover.
      const replaceAll = edits.filter((e) => e.input?.replace_all === true);
      if (replaceAll.length !== 1) return `expected exactly 1 Edit with replace_all:true, saw ${replaceAll.length}`;
      for (const u of [...writes, ...edits]) {
        const p = u.input?.file_path;
        if (typeof p !== "string" || !p.startsWith(SANDBOX)) return `tool touched a path outside the sandbox: ${String(p)}`;
      }
      return resultText(msgs).includes("EDIT_OK") ? null : "final reply missing EDIT_OK";
    },
  },

  {
    // The task family's three remaining result formatters (TaskList, TaskGet,
    // TaskUpdate) plus the one already owned (TaskCreate). The walk is ordered so
    // every formatter renders a DIFFERENT shape:
    //   TaskList on an empty list -> "No tasks found"
    //   TaskCreate x2             -> "Task #N created successfully: <subject>"
    //   TaskList with tasks       -> "#1 [pending] REFORGE_TASK_ONE" lines
    //   TaskGet                   -> the multi-line "Task #1: …/Status: …/Description: …"
    //   TaskUpdate                -> "Updated task #1 status"
    // Recorded note: TaskUpdate's completion-nudge branch (`rb() && io()`) stays
    // DARK headlessly — both predicates are false without an agent-team context —
    // so this scenario covers the formatter, not that branch. Said plainly here
    // rather than implied by a green gate.
    tag: "task-family",
    title: "TaskList/TaskCreate/TaskGet/TaskUpdate results round-trip",
    run: (ctx) =>
      drive(
        "Use the task tools in exactly this order, and do not use any other tool:\n" +
          "1. TaskList — call it first, before creating anything.\n" +
          "2. TaskCreate with subject REFORGE_TASK_ONE and activeForm 'Doing REFORGE_TASK_ONE'.\n" +
          "3. TaskCreate with subject REFORGE_TASK_TWO and activeForm 'Doing REFORGE_TASK_TWO'.\n" +
          "4. TaskList again.\n" +
          "5. TaskGet for the first task (task id 1).\n" +
          "6. TaskUpdate the first task (task id 1) to status completed.\n" +
          "Then reply with exactly TASKS_OK and nothing else.",
        {
          ...baseOptions(ctx),
          allowedTools: ["TaskList", "TaskCreate", "TaskGet", "TaskUpdate"],
          maxTurns: 10,
          permissionMode: "bypassPermissions",
        },
      ),
    check: (msgs) => {
      for (const name of ["TaskList", "TaskCreate", "TaskGet", "TaskUpdate"]) {
        if (toolUses(msgs, name).length === 0) return `${name} never used`;
      }
      const creates = toolUses(msgs, "TaskCreate");
      if (creates.length !== 2) return `expected exactly 2 TaskCreate calls, saw ${creates.length}`;
      const subjects = JSON.stringify(creates.map((c) => c.input ?? {}));
      for (const s of ["REFORGE_TASK_ONE", "REFORGE_TASK_TWO"]) {
        if (!subjects.includes(s)) return `TaskCreate input never carried ${s}`;
      }
      // The empty-list arm is only covered if TaskList really ran before the
      // first TaskCreate; otherwise "No tasks found" is never rendered.
      const order = toolUses(msgs).map((u) => u.name);
      if (order.indexOf("TaskList") > order.indexOf("TaskCreate")) return "TaskList did not run before the first TaskCreate";
      return resultText(msgs).includes("TASKS_OK") ? null : "final reply missing TASKS_OK";
    },
  },
];
