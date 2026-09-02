// PARITY LAYER (§2.5 `reference`) — one of C11a's sixteen moat-tool
// description builders. The text this returns is what the engine sends as the
// tool's `description` in every graded request body, so a single changed
// character is a byte difference on the requests surface: transcription is the
// whole risk and the differential is the whole defence. Nothing here is
// reflowed or re-punctuated, and the \u2014 escapes are upstream's own (the
// bundle contains zero literal em-dash bytes).
//
// The belt's only SIBLING-METHOD row: TaskOutput writes its prompt inline in the
// tool object rather than delegating to a named constant, so the excision is the
// method and the delegation is the method's own shape. Zero free variables.
//
// The text is a deprecation notice that still ships in every catalog, which is
// worth recording plainly: 1,049 bytes of every graded request body tell the
// model not to use a tool the engine still presents.
export function taskOutputDescription() {return`DEPRECATED: Background tasks return their output file path in the tool result, and you receive a <task-notification> with the same path when the task completes.
- For bash tasks: prefer using the Read tool on that output file path \u2014 it contains stdout/stderr.
- For local_agent tasks: use the Agent tool result directly. Do NOT Read the .output file \u2014 it is a symlink to the full subagent conversation transcript (JSONL) and will overflow your context window.
- For remote_agent tasks: prefer using the Read tool on the output file path \u2014 it contains the streamed remote session output (same as bash).

- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions`}
