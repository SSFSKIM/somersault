// Negative controls for the `background-task` substance assertion. That
// scenario is substanceOnly, so checkBackgroundTask is the ONLY thing grading
// the engine under test — if it accepts malformed correlation identifiers, an
// engine can drop exactly the fields ccx needs to key its task panel and still
// be graded green. Each case below is a way an engine can be wrong that a
// weaker check (presence-only, or an equality satisfied by undefined ===
// undefined) would have waved through.
//
// The well-formed transcript mirrors the real capture in
// transcripts/m1-background-task-A.jsonl, trimmed to the frames the check reads.
//
// Run: cd reforge && npx tsx m3/background-check.test.ts
import { checkBackgroundTask } from "./scenarios.js";

const TOOL_USE_ID = "toolu_01Wep5xk6suYMYvaBG71xjyV";
const TASK_ID = "ad6fafa416f93578c";

interface Overrides {
  startedTaskId?: string;
  startedToolUseId?: string;
  changedTaskId?: string;
}

/** The real frame shapes, with the correlation identifiers made injectable. */
const transcript = (o: Overrides = {}): unknown[] => [
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
          input: { description: "Reply with fixed word", subagent_type: "general-purpose", run_in_background: true },
        },
      ],
    },
    session_id: "s",
  },
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
    is_backgrounded: true,
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
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: { role: "assistant", content: [{ type: "text", text: "REFORGE_BG_OK" }] },
    session_id: "s",
  },
  { type: "result", subtype: "success", is_error: false, result: "Background agent completed with result: REFORGE_BG_OK" },
];

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

// (e) the real shape must still pass, or the check is merely strict, not correct.
const wellFormed = checkBackgroundTask(transcript());
check("well-formed transcript passes", wellFormed === null, wellFormed ?? "");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
