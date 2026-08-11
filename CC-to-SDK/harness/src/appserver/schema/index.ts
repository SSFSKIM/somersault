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

export interface MethodSchema { params: z.ZodType }
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
  "turn/steer": { params: turnSteerParams },
  "plugin/reload": { params: threadIdParams },
  "skill/reload": { params: threadIdParams },
};
