// tui/src/hookPairs.ts — bl7 T-HOOKBLOCK Task 1: pairs SDK `hook_started`/`hook_response` frames into
// completed hook runs, the ingest foundation Task 2's fold absorption and Task 3's rendering both build on.
// bl8 T-QY Task 1 widens retention to every reachable event (P119, 2026-08-30, SDK 0.3.237): PreToolUse,
// PostToolUse, Stop, UserPromptSubmit, SessionStart all pair and complete identically on the wire —
// `started` then `response`, same `hook_id`, no `tool_use_id` anywhere. SessionEnd is DEAD ON WIRE (P119
// §1: the hook runs, but no frame ever arrives) — no code path for it exists or should. `hook_progress` is
// ALIVE but carries no timing of its own (P119 §2: cumulative stdout snapshots, no `exit_code`); this class
// treats it as liveness-only — `progress()` is a documented no-op.
//
// P116 (2026-08-30, SDK 0.3.237) measured the wire: settings-layer command hooks now emit, per invocation,
// `system/hook_started {hook_id, hook_name:"PreToolUse:Read", hook_event:"PreToolUse", uuid, session_id}`
// then `system/hook_response {…same keys…, output, stdout, stderr, exit_code, outcome}` — NO duration
// field anywhere, so the started→response ARRIVAL DELTA is the only timing source this class can measure,
// and (for PreToolUse) attribution to a tool-use run is by arrival POSITION (the caller's `afterSequence`),
// never by id (spec D2). In-process `options.hooks` callbacks still emit nothing (P116 positive control B)
// — out of scope; ccx self-instruments those separately.
//
// The PreToolUse-only cluster-absorption filter (canon predicate `jar`) is NOT this class's job: bl8 spec
// D1 moves it to `toolFold.ts`'s `resolveRunHooks`, the one consumer that still needs it — a non-PreToolUse
// entry renders standalone (a later task) rather than being dropped here. This class only PAIRS and
// RETAINS every completed pair — it does not stamp a clock itself (the caller passes `now`) and does not
// read one, per the ingest-stamps-render-reads split (`foldPendingState.ts:56-58`).

/** One completed hook run, ready for a later task to fold into a tool-cluster's expanded block OR render as
 *  a standalone row. `id` is the wire `hook_id` — Task 3's stable row identity (plan-review F2). `event` is
 *  the frame's `hook_event` verbatim (`"PreToolUse"`, `"PostToolUse"`, `"Stop"`, `"UserPromptSubmit"`,
 *  `"SessionStart"` — P119's five reachable events). `exitCode`/`stderr` are copied off the response frame
 *  only when present (spread-only-when-defined style) — a plain successful hook still carries `exit_code:0`
 *  per P119, so their absence here means the frame itself omitted them, not that the hook failed.
 *  `afterSequence` is the document's latest retained sequence AT RESPONSE ARRIVAL — the call-time position
 *  PreToolUse absorption resolves entries against (spec D12), not a tool-use id the wire does not carry. */
export type HookRunEntry = {
  id: string; name: string; event: string; durationMs: number; afterSequence: number; exitCode?: number; stderr?: string;
};

/** Pairs `hook_started`/`hook_response` frames by `hook_id` and retains every completed pair, in arrival
 *  order, plus a live count of started-without-response hooks per event. One instance per live document
 *  (`useChat` owns it, clears it on rebuild — live-only, same rule as `thoughtMsRef`: nothing on the wire or
 *  on disk lets a resumed/attached session recover a hook's timing, so a rebuilt transcript shows none
 *  rather than a fabricated one). */
export class HookPairTracker {
  private startedAt = new Map<string, { at: number; event: string }>();
  private completed: HookRunEntry[] = [];

  /** Record a hook's start and return `true` unconditionally — the caller (`useChat`) reconciles on every
   *  non-replay start (bl8 plan-review F5): without a start-triggered repaint the live counter's row would
   *  never paint, since the next guaranteed projection lands only after the response removes it. */
  started(frame: { hook_id: string; hook_event: string }, now: number): true {
    this.startedAt.set(frame.hook_id, { at: now, event: frame.hook_event });
    return true;
  }

  /** Consume the matching `started()` stamp (if any) and retain one completed entry for EVERY event — the
   *  PreToolUse-only filter is a consumer's job now (spec D1). Returns `true` iff a pair was completed —
   *  the signal `useChat` reconciles on (spec D14): a hook frame never mutates the document, so nothing
   *  else would ever repaint an already-open run the moment its hook finishes, or paint a standalone/live
   *  hook row for any other event. */
  response(frame: { hook_id: string; hook_name: string; hook_event: string; exit_code?: number; stderr?: string }, now: number, afterSequence: number): boolean {
    const started = this.startedAt.get(frame.hook_id);
    if (started === undefined) return false;   // no started() seen for this id — dropped (P116: response-without-started is a valid absence, never assumed a duration)
    this.startedAt.delete(frame.hook_id);
    this.completed.push({
      id: frame.hook_id, name: frame.hook_name, event: frame.hook_event, durationMs: now - started.at, afterSequence,
      ...(frame.exit_code !== undefined && { exitCode: frame.exit_code }),
      ...(frame.stderr !== undefined && { stderr: frame.stderr }),
    });
    return true;
  }

  /** `hook_progress` is accepted as a documented no-op (P119 §2/§6): liveness only — the row it belongs to
   *  is already open via `started()`, and its cumulative stdout is never displayed (canon's `di` shows none
   *  either). Nothing here reads `frame` today; the parameter exists so a caller can pass the wire frame
   *  unchanged without a call-site branch. */
  progress(_frame: { hook_id: string }): void {}

  /** Started-without-response counts, keyed by `hook_event` — the live counter's source (spec D6): counts
   *  from THIS tracker, never from `hook_progress` (a recorded divergence — progress frames carry no signal
   *  this counter needs). */
  inProgress(): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const { event } of this.startedAt.values()) counts.set(event, (counts.get(event) ?? 0) + 1);
    return counts;
  }

  /** Completed entries, oldest first — arrival order, since `completed` is only ever pushed to. */
  entries(): readonly HookRunEntry[] { return this.completed; }

  /** Drop every started stamp and every completed entry — the rebuild-site call (a resume/rewind/clear has
   *  no hook source to show). */
  clear(): void { this.startedAt.clear(); this.completed = []; }
}
