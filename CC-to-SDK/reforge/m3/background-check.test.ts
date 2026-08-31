// Negative controls for the `background-task` substance assertion. That
// scenario is substanceOnly, so checkBackgroundTask is the ONLY thing grading
// the engine under test — if it accepts malformed correlation identifiers, a
// foreground dispatch, or a task that never settles, an engine can drop exactly
// the frames ccx needs to key its task panel, close it out, and bank the usage,
// and still be graded green. Each case below is a way an engine can be wrong
// that a weaker check (presence-only, or an equality satisfied by undefined ===
// undefined) would have waved through.
//
// The well-formed transcript mirrors the real capture in
// transcripts/m1-background-task-A.jsonl, trimmed to the frames the check reads.
//
// Run: cd reforge && npx tsx m3/background-check.test.ts
import { checkBackgroundTask } from "./scenarios.js";

const TOOL_USE_ID = "toolu_01Wep5xk6suYMYvaBG71xjyV";
const TASK_ID = "ad6fafa416f93578c";

interface NotificationSpec {
  task_id?: string;
  tool_use_id?: string;
  status?: string;
}

interface Overrides {
  startedTaskId?: string;
  startedToolUseId?: string;
  changedTaskId?: string;
  /** The Agent tool_use block's `input.run_in_background` (default true). */
  runInBackground?: unknown;
  /** `task_started.is_backgrounded` (default true). */
  isBackgrounded?: unknown;
  /** Terminal bookends to emit; [] means the task never settles. */
  notifications?: NotificationSpec[];
  /** Splice the notifications ahead of task_started instead of after it. */
  notifyBeforeStart?: boolean;
}

const notification = (n: NotificationSpec) => ({
  type: "system",
  subtype: "task_notification",
  task_id: "task_id" in n ? n.task_id : TASK_ID,
  tool_use_id: "tool_use_id" in n ? n.tool_use_id : TOOL_USE_ID,
  status: "status" in n ? n.status : "completed",
  output_file: "/tmp/reforge/task.output",
  summary: "DISPATCHED",
  usage: { total_tokens: 28371, tool_uses: 0, duration_ms: 19 },
  session_id: "s",
});

/** The real frame shapes, with the correlation identifiers made injectable. */
const transcript = (o: Overrides = {}): unknown[] => {
  const notifications = (o.notifications ?? [{}]).map(notification);
  return [
    { type: "system", subtype: "init", session_id: "s", tools: ["Agent"] },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: TOOL_USE_ID,
            name: "Agent",
            input: {
              description: "Reply with fixed word",
              subagent_type: "general-purpose",
              run_in_background: "runInBackground" in o ? o.runInBackground : true,
            },
          },
        ],
      },
      session_id: "s",
    },
    ...(o.notifyBeforeStart ? notifications : []),
    {
      type: "system",
      subtype: "background_tasks_changed",
      tasks:
        "changedTaskId" in o
          ? o.changedTaskId === undefined
            ? [{ task_type: "local_agent", description: "Reply with fixed word" }]
            : [{ task_id: o.changedTaskId, task_type: "local_agent", description: "Reply with fixed word" }]
          : [{ task_id: TASK_ID, task_type: "local_agent", description: "Reply with fixed word" }],
      session_id: "s",
    },
    {
      type: "system",
      subtype: "task_started",
      ...("startedTaskId" in o
        ? o.startedTaskId === undefined
          ? {}
          : { task_id: o.startedTaskId }
        : { task_id: TASK_ID }),
      ...("startedToolUseId" in o
        ? o.startedToolUseId === undefined
          ? {}
          : { tool_use_id: o.startedToolUseId }
        : { tool_use_id: TOOL_USE_ID }),
      description: "Reply with fixed word",
      subagent_type: "general-purpose",
      is_backgrounded: "isBackgrounded" in o ? o.isBackgrounded : true,
      session_id: "s",
    },
    {
      type: "user",
      message: { role: "user", content: [{ tool_use_id: TOOL_USE_ID, type: "tool_result", content: "Async agent launched successfully." }] },
      session_id: "s",
    },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: { role: "assistant", content: [{ type: "text", text: "DISPATCHED" }] },
      session_id: "s",
    },
    // Level signal (REPLACE semantics): the teardown frame carries an empty array,
    // so "some frame carried a tasks array" alone proves nothing.
    { type: "system", subtype: "background_tasks_changed", tasks: [], session_id: "s" },
    // The real capture also carries a task_updated patch alongside the terminal
    // bookend; it is NOT the bookend, and must not be mistaken for one.
    {
      type: "system",
      subtype: "task_updated",
      task_id: TASK_ID,
      patch: { status: "completed", end_time: 1788178717376 },
      session_id: "s",
    },
    ...(o.notifyBeforeStart ? [] : notifications),
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: { role: "assistant", content: [{ type: "text", text: "REFORGE_BG_OK" }] },
      session_id: "s",
    },
    { type: "result", subtype: "success", is_error: false, result: "Background agent completed with result: REFORGE_BG_OK" },
  ];
};

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  if (!cond) failures++;
};
const rejects = (name: string, msgs: unknown[]) => {
  const reason = checkBackgroundTask(msgs);
  check(name, reason !== null, reason ?? "accepted");
};

// (a) no task_id at all on task_started — the id ccx keys its task panel by.
rejects("missing task_id on task_started is rejected", transcript({ startedTaskId: undefined }));

// (b) present but empty — a truthiness guard, not a `in`-operator guard.
rejects("empty-string task_id on task_started is rejected", transcript({ startedTaskId: "" }));

// (c) the frame must name the tool call it came from, not just any id.
rejects(
  "tool_use_id not matching the Agent tool_use id is rejected",
  transcript({ startedToolUseId: "toolu_REFORGE_WRONG" }),
);
rejects("missing tool_use_id on task_started is rejected", transcript({ startedToolUseId: undefined }));

// (d) the level signal must actually list the announced task. Both the absent
// key (the undefined === undefined vacuity) and a mismatched id must fail.
rejects(
  "background_tasks_changed entry lacking task_id is rejected",
  transcript({ changedTaskId: undefined }),
);
rejects(
  "background_tasks_changed entry with a different task_id is rejected",
  transcript({ changedTaskId: "0000000000000000" }),
);
// The vacuity in combination: neither side carries an id, so a bare equality
// would have compared undefined to undefined and passed.
rejects(
  "task_id absent on BOTH task_started and the changed entry is rejected",
  transcript({ startedTaskId: undefined, changedTaskId: undefined }),
);

// (e) backgroundness. Correlated frames plus a fold-back are all producible by a
// dispatch that BLOCKED — the scenario claims background work, so both the ask
// and the engine's registration of it have to be visible.
rejects(
  "a dispatch that did not ask for background is rejected",
  transcript({ runInBackground: false }),
);
rejects(
  "a dispatch with no run_in_background at all is rejected",
  transcript({ runInBackground: undefined }),
);
rejects(
  "task_started.is_backgrounded false (task ran in the foreground) is rejected",
  transcript({ isBackgrounded: false }),
);

// (f) the completion lifecycle. ccx settles its panel entry and banks the task's
// usage off the terminal task_notification; an engine that never emits one
// leaves the entry running forever.
rejects("no task_notification at all is rejected", transcript({ notifications: [] }));
rejects(
  "task_notification naming a different task_id is rejected",
  transcript({ notifications: [{ task_id: "0000000000000000" }] }),
);
rejects(
  "task_notification lacking task_id is rejected",
  transcript({ notifications: [{ task_id: undefined }] }),
);
rejects(
  "task_notification whose tool_use_id does not match the dispatch is rejected",
  transcript({ notifications: [{ tool_use_id: "toolu_REFORGE_WRONG" }] }),
);
rejects(
  "a non-completed terminal status with no completed frame is rejected",
  transcript({ notifications: [{ status: "failed" }] }),
);
rejects(
  "duplicate completed task_notification for the same task is rejected",
  transcript({ notifications: [{}, {}] }),
);
rejects(
  "a completion notification preceding task_started is rejected",
  transcript({ notifyBeforeStart: true }),
);

// (g) the round-3 adversarial mutation, reproduced verbatim: strip every
// task_notification frame AND set both background flags false. A foreground run
// with no completion lifecycle — the exact engine this check exists to fail.
rejects(
  "round-3 mutation (no task_notification + both background flags false) is rejected",
  transcript({ notifications: [], runInBackground: false, isBackgrounded: false }),
);

// (h) the real shape must still pass, or the check is merely strict, not correct.
const wellFormed = checkBackgroundTask(transcript());
check("well-formed transcript passes", wellFormed === null, wellFormed ?? "");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
