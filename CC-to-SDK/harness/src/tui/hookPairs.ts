// tui/src/hookPairs.ts — bl7 T-HOOKBLOCK Task 1: pairs SDK `hook_started`/`hook_response` frames into
// completed PreToolUse runs, the ingest foundation Task 2's fold absorption and Task 3's rendering both
// build on.
//
// P116 (2026-08-30, SDK 0.3.237) measured the wire: settings-layer command hooks now emit, per invocation,
// `system/hook_started {hook_id, hook_name:"PreToolUse:Read", hook_event:"PreToolUse", uuid, session_id}`
// then `system/hook_response {…same keys…, output, stdout, stderr, exit_code, outcome}` — NO duration
// field anywhere and NO `tool_use_id`, so the started→response ARRIVAL DELTA is the only timing source
// this class can measure, and attribution to a tool-use run is by arrival POSITION (the caller's
// `afterSequence`), never by id (spec D2). In-process `options.hooks` callbacks still emit nothing (P116
// positive control B) — out of scope; ccx self-instruments those separately.
//
// PreToolUse-only (canon predicate `jar`): `response()` drops every other `hook_event` and any `hook_id`
// with no matching `started()` call. This class only PAIRS and RETAINS — it does not stamp a clock itself
// (the caller passes `now`) and does not read one, per the ingest-stamps-render-reads split
// (`foldPendingState.ts:56-58`).

/** One completed PreToolUse hook run, ready for a later task to fold into a tool-cluster's expanded block.
 *  `afterSequence` is the document's latest retained sequence AT RESPONSE ARRIVAL — the call-time position
 *  absorption resolves entries against (spec D12), not a tool-use id the wire does not carry. */
export type HookRunEntry = { name: string; durationMs: number; afterSequence: number };

/** Pairs `hook_started`/`hook_response` frames by `hook_id` and retains only completed PreToolUse runs, in
 *  arrival order. One instance per live document (`useChat` owns it, clears it on rebuild — live-only,
 *  same rule as `thoughtMsRef`: nothing on the wire or on disk lets a resumed/attached session recover a
 *  hook's timing, so a rebuilt transcript shows none rather than a fabricated one). */
export class HookPairTracker {
  private startedAt = new Map<string, number>();
  private completed: HookRunEntry[] = [];

  /** Record a hook's start. `hook_event` is accepted (not just `hook_id`) to match the wire frame's shape
   *  one-for-one, but the PreToolUse filter is applied at `response()` — a started stamp is kept for any
   *  event so a later non-PreToolUse response still consumes (and clears) it rather than leaking the id. */
  started(frame: { hook_id: string; hook_event: string }, now: number): void {
    this.startedAt.set(frame.hook_id, now);
  }

  /** Consume the matching `started()` stamp (if any) and, for a PreToolUse pair only, retain one completed
   *  entry. Returns `true` iff a PreToolUse pair was completed — the signal `useChat` reconciles on (spec
   *  D14): a hook frame never mutates the document, so nothing else would ever repaint an already-open run
   *  the moment its hook finishes. */
  response(frame: { hook_id: string; hook_name: string; hook_event: string }, now: number, afterSequence: number): boolean {
    const at = this.startedAt.get(frame.hook_id);
    if (at === undefined) return false;              // no started() seen for this id — dropped (P116: response-without-started is a valid absence, never assumed a duration)
    this.startedAt.delete(frame.hook_id);
    if (frame.hook_event !== "PreToolUse") return false;   // canon `jar`: only PreToolUse absorbs into the tool-cluster block
    this.completed.push({ name: frame.hook_name, durationMs: now - at, afterSequence });
    return true;
  }

  /** Completed PreToolUse entries, oldest first — arrival order, since `completed` is only ever pushed to. */
  entries(): readonly HookRunEntry[] { return this.completed; }

  /** Drop every started stamp and every completed entry — the rebuild-site call (a resume/rewind/clear has
   *  no hook source to show). */
  clear(): void { this.startedAt.clear(); this.completed = []; }
}
