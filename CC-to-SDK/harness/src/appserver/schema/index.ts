// appserver/schema/index.ts — the method→schema registry. Wave 4's generator and drift gate walk THIS
// record: a shipped method missing here is a build failure, so wire and artifact cannot drift (spec §9).
import type { z } from "zod/v4";
import { threadIdParams, initializeParams, serverStatusParams } from "./core.js";
import { threadStartParams, threadResumeParams, threadReadParams, threadListParams, threadCompactStartParams, threadReinitializeParams, threadForkParams, threadNameSetParams, threadTagSetParams, threadDeleteParams } from "./threads.js";
import { turnStartParams, turnInterruptParams, turnSteerParams } from "./turns.js";
import { decisionRespondParams, decisionListParams } from "./decisions.js";
import { modelSetParams, permissionModeSetParams, thinkingSetParams, settingsApplyParams } from "./settings.js";
import { rewindAnchorsParams, rewindDryRunParams, rewindParams, reopenParams } from "./rewind.js";
import { mcpStatusParams, mcpNameParams, mcpToggleParams, mcpSetParams, mcpOverrideParams } from "./mcp.js";
import { taskListParams, taskStopParams, turnBackgroundParams } from "./tasks.js";
import { settingsReadParams, directoryListParams, directoryPathParams, permissionRuleParams, outputStyleSetParams, effortSetParams, threadClearParams } from "./settingsOps.js";
import { fleetListParams, threadAttachParams, threadStopParams } from "./fleet.js";
import { fsReadParams, fsSearchParams, shellCommandParams } from "./workspace.js";
import { reviewStartParams } from "./review.js";
import { configReadParams, configReadResult } from "./config.js";

/** `experimental`: this method is an X-gate in the spec's sense — it exists because a probe found the seam
 *  reachable, and it may change shape or disappear without a deprecation. It is the ONLY thing that decides
 *  which generated artifact a method lands in (`schema/emit.ts`: stable file XOR experimental file), so
 *  flipping the marker is how a method graduates — there is no second list to keep in step. Absent, not
 *  `false`, on a stable method: the marker is an exception, and an entry that says nothing says "stable". */
/** `result` (M5, spec D-M5-19): the method's RESPONSE shape, published beside its params. Optional and
 *  incremental on purpose — the 59 methods that predate M5 declare none, and the spec rejected
 *  retrofitting them in this milestone, so an entry without it means "response shape not yet published",
 *  never "no response". `schema/emit.ts` emits every declared one into the artifact's `results` map. */
export interface MethodSchema { params: z.ZodType; result?: z.ZodType; experimental?: true }
export const methodSchemas: Record<string, MethodSchema> = {
  "initialize": { params: initializeParams },
  "server/status": { params: serverStatusParams },
  "thread/start": { params: threadStartParams },
  "thread/resume": { params: threadResumeParams },
  "thread/list": { params: threadListParams },
  "thread/close": { params: threadIdParams },
  "thread/subscribe": { params: threadIdParams },
  "thread/unsubscribe": { params: threadIdParams },
  "thread/read": { params: threadReadParams },
  "turn/start": { params: turnStartParams },
  "turn/interrupt": { params: turnInterruptParams },
  "decision/list": { params: decisionListParams },
  "decision/respond": { params: decisionRespondParams },
  "thread/model/set": { params: modelSetParams },
  "thread/permissionMode/set": { params: permissionModeSetParams },
  "thread/thinking/set": { params: thinkingSetParams },
  "thread/settings/apply": { params: settingsApplyParams },
  "thread/capabilities/read": { params: threadIdParams },
  "thread/contextUsage/read": { params: threadIdParams },
  "thread/usage/read": { params: threadIdParams },
  "thread/init/read": { params: threadIdParams },
  "account/read": { params: threadIdParams },
  "thread/compact/start": { params: threadCompactStartParams },
  "thread/reinitialize": { params: threadReinitializeParams },
  "thread/fork": { params: threadForkParams },
  "thread/name/set": { params: threadNameSetParams },
  "thread/tag/set": { params: threadTagSetParams },
  "thread/delete": { params: threadDeleteParams },
  "thread/rewind/anchors": { params: rewindAnchorsParams },
  "thread/rewind/dryRun": { params: rewindDryRunParams },
  "thread/rewind": { params: rewindParams },
  "mcpServer/status/list": { params: mcpStatusParams },
  "mcpServer/reconnect": { params: mcpNameParams },
  "mcpServer/toggle": { params: mcpToggleParams },
  "mcpServer/set": { params: mcpSetParams },
  "mcpServer/permissionModeOverride/set": { params: mcpOverrideParams },
  "task/list": { params: taskListParams },
  "task/stop": { params: taskStopParams },
  "turn/background": { params: turnBackgroundParams },
  "thread/settings/read": { params: settingsReadParams },
  "thread/directory/list": { params: directoryListParams },
  "thread/directory/add": { params: directoryPathParams },
  "thread/directory/remove": { params: directoryPathParams },
  "thread/permissionRule/add": { params: permissionRuleParams },
  "thread/permissionRule/remove": { params: permissionRuleParams },
  "thread/outputStyle/set": { params: outputStyleSetParams },
  "thread/effort/set": { params: effortSetParams },
  "thread/clear": { params: threadClearParams },
  // Task 5's probe promotions. Both reloads take the bare `{threadId}` — no options exist to pass, the
  // engine re-scans its whole plugin/skill set.
  // `turn/steer` is the spec's one X method that shipped: it rides `Query.streamInput`, an SDK surface with
  // no stability promise (probe 103b), so it is published in the experimental artifact only. The reloads
  // are NOT marked — they were probe-GATED, which is a question about whether to ship at all, not about
  // how stable the shape is once shipped; probe 105 answered it and they graduated straight to stable.
  "turn/steer": { params: turnSteerParams, experimental: true },
  "plugin/reload": { params: threadIdParams },
  "skill/reload": { params: threadIdParams },
  // M3 Task 7's adoption pair (§1e). STABLE, not experimental: neither rides an unproven SDK seam — both
  // read this machine's own roster and the host wire that `ccx attach` has spoken since A2a.
  "fleet/list": { params: fleetListParams },
  "thread/attach": { params: threadAttachParams },
  // M3 Task 9 (§1e): the release half of adoption. Registered beside the pair above rather than with the
  // other thread-scoped methods because its MEANING is origin-branched — on a fleet thread it ends the
  // host, on an inProcess one it is `thread/close` — and reading it next to `thread/attach` is what makes
  // the pairing legible.
  "thread/stop": { params: threadStopParams },
  // M3 Task 12 (§2): the workspace pair. SERVER-scoped like the adoption pair above — no `threadId` —
  // and STABLE: both stand on node's own fs plus the TUI's shipped ranker, not on an SDK seam. (The SDK
  // seam that would have backed `fs/read`, `Query.readFile`, is probe-dead — probe 104.)
  "fs/read": { params: fsReadParams },
  "fs/search": { params: fsSearchParams },
  // M3 Task 13 (§3): the display-only shell escape, registered with the pair above because it shares their
  // module and their subject — this machine's filesystem — even though it is the one of the three that
  // names a thread. STABLE: `runBash` is our own primitive, and the deviation the params' `.describe()`
  // carries is about SEMANTICS (output never reaches the model), not about a shape that might move.
  "thread/shellCommand": { params: shellCommandParams },
  // M3 Task 14 (§4): the gap-10 recovery path. Registered last, matching `server.ts`'s table, though its
  // params live with the rest of the swap family in `schema/rewind.ts` — the module a reader looks in for
  // "what replaces a thread's engine". STABLE: the shape is a threadId and the mechanism is `swapEngine`,
  // both of which have shipped since M2b.
  "thread/reopen": { params: reopenParams },
  // M4 (§surface): the review domain's whole request surface, one method, registered last as `server.ts`'s
  // table takes it. STABLE, not experimental — the shape is Codex's own (`review.rs`), and the mechanism
  // under it is an ordinary turn on a thread this server creates, not an unproven SDK seam. The `target`
  // union rides out with it, so the generated artifact carries the four variants a client must choose from.
  "review/start": { params: reviewStartParams },
  // M5 (§config): the settings-files domain's read half, and the FIRST entry to declare a `result` —
  // D-M5-19's slot exists because a client cannot act on `versions` (the CAS token its next write must
  // carry) from a params schema alone. SERVER-scoped like `fs/read`: the subject is this machine's
  // settings files, not a thread. STABLE — the mechanism is node's own fs plus upstream's merge.
  "config/read": { params: configReadParams, result: configReadResult },
};
