// appserver/schema/index.ts — the method→schema registry. Wave 4's generator and drift gate walk THIS
// record: a shipped method missing here is a build failure, so wire and artifact cannot drift (spec §9).
import type { z } from "zod/v4";
import { threadIdParams, initializeParams, serverStatusParams } from "./core.js";
import { threadStartParams, threadResumeParams, threadReadParams, threadListParams, threadCompactStartParams, threadReinitializeParams, threadForkParams, threadNameSetParams, threadTagSetParams, threadDeleteParams } from "./threads.js";
import { turnStartParams, turnInterruptParams, turnSteerParams } from "./turns.js";
import { decisionRespondParams, decisionListParams } from "./decisions.js";
import { modelSetParams, permissionModeSetParams, thinkingSetParams, settingsApplyParams } from "./settings.js";
import { rewindAnchorsParams, rewindDryRunParams, rewindParams } from "./rewind.js";
import { mcpStatusParams, mcpNameParams, mcpToggleParams, mcpSetParams, mcpOverrideParams } from "./mcp.js";
import { taskListParams, taskStopParams, turnBackgroundParams } from "./tasks.js";
import { settingsReadParams, directoryListParams, directoryPathParams, permissionRuleParams, outputStyleSetParams, effortSetParams, threadClearParams } from "./settingsOps.js";
import { fleetListParams, threadAttachParams } from "./fleet.js";

/** `experimental`: this method is an X-gate in the spec's sense — it exists because a probe found the seam
 *  reachable, and it may change shape or disappear without a deprecation. It is the ONLY thing that decides
 *  which generated artifact a method lands in (`schema/emit.ts`: stable file XOR experimental file), so
 *  flipping the marker is how a method graduates — there is no second list to keep in step. Absent, not
 *  `false`, on a stable method: the marker is an exception, and an entry that says nothing says "stable". */
export interface MethodSchema { params: z.ZodType; experimental?: true }
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
};
