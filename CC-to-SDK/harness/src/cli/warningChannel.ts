// cli/warningChannel.ts — Wave-2 Task 4 (s2qa3-11): Node's `warning` channel, taken over by ccx.
//
// THE DEFECT. ccx hands the SDK a `canUseTool` for every engine it opens (`host.ts` `engineConfig()` →
// `resolveOptions.ts`'s `options.canUseTool = createPermissionGate(...)`), INCLUDING a launch that also asks
// for `bypassPermissions`. The SDK answers that combination with
// `process.emitWarning(…, { code: "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED" })` at query construction, and Node's
// DEFAULT warning listener prints it straight to stderr — which is the terminal Ink is painting. The bypass
// consent gate runs immediately before the session opens, so the sentence lands on top of the first frame.
//
// WHY THE FIX IS HERE AND NOT AT THE OPTION. "Don't pass `canUseTool` in bypass" is not free: the permission
// mode is runtime-mutable (`host.ts` → `session.setPermissionMode`) while `canUseTool` can only be supplied at
// query construction. A bypass launch without it is permanently brokerless the moment the user steps the mode
// back down to `default`/`plan` — reachable from the Tab ladder. So the option stays as it is and the noise is
// stopped at the process boundary, one place, which also inoculates the frame against the sibling
// `allowedTools`-shadowing warning the same SDK function emits.
//
// The debug seam is `statusLine.ts:109`'s idiom verbatim (`CCX_DEBUG` → stderr, otherwise silence): inside a
// live Ink render an unguarded stderr write is exactly the thing this module exists to prevent.

/** Where a routed warning goes. Two sinks, because the two classes are not the same message: an SDK warning
 *  is plumbing the user cannot act on (debug seam, silent by default) and anything else is ours to report. */
export interface WarningSink {
  stderr: (line: string) => void;
  debug: (line: string) => void;
}

const defaultSink: WarningSink = {
  // `ccx: <what went wrong>` is the program's one stderr shape (`main.ts`'s `fail`, `bin.ts`'s top-level
  // catch); a warning wears it too, with the severity spelled out so it is not read as a failed command.
  stderr: (line) => process.stderr.write(`${line}\n`),
  debug: (line) => { if (process.env.CCX_DEBUG) process.stderr.write(`${line}\n`); },
};

/** Pure: decide where ONE warning goes and write it there. Every `CLAUDE_SDK_*` code is dropped off stderr by
 *  PREFIX rather than by exact code, so the sibling shadowing warnings (and any the SDK adds later) are
 *  covered without a second edit. Everything else is re-printed once — dropping unrelated Node warnings
 *  (deprecations, listener leaks, unhandled rejection notices) would be trading one silent defect for another. */
export function routeWarning(w: Error & { code?: string }, sink: WarningSink = defaultSink): void {
  if (w.code?.startsWith("CLAUDE_SDK_")) { sink.debug(`${w.code}: ${w.message}`); return; }
  // `name` is "Warning" for a plain `emitWarning(msg)`; anything else (DeprecationWarning,
  // MaxListenersExceededWarning) is load-bearing and kept.
  sink.stderr(`ccx: warning: ${w.name && w.name !== "Warning" ? `${w.name}: ` : ""}${w.message}`);
}

/** Own the channel. `removeAllListeners` FIRST: Node installs its default printer lazily and would otherwise
 *  still write its own `(node:pid) [CODE] Warning: …` line beside ours — the very thing we are removing from
 *  the frame. Also makes a second install a no-op rather than a double print. Called from `bin.ts` before
 *  anything mounts Ink or constructs a query. */
export function installWarningChannel(sink: WarningSink = defaultSink): void {
  process.removeAllListeners("warning");
  process.on("warning", (w) => routeWarning(w as Error & { code?: string }, sink));
}
