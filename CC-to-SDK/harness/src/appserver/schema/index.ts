// appserver/schema/index.ts — the method→schema registry. Wave 4's generator and drift gate walk THIS
// record: a shipped method missing here is a build failure, so wire and artifact cannot drift (spec §9).
import type { z } from "zod/v4";
import { threadIdParams, initializeParams, serverStatusParams } from "./core.js";
import { threadStartParams, threadResumeParams, threadReadParams, threadListParams, threadCompactStartParams, threadReinitializeParams, threadForkParams, threadNameSetParams, threadTagSetParams, threadDeleteParams } from "./threads.js";
import { turnStartParams, turnInterruptParams } from "./turns.js";
import { decisionRespondParams, decisionListParams } from "./decisions.js";
import { modelSetParams, permissionModeSetParams, thinkingSetParams, settingsApplyParams } from "./settings.js";

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
};
