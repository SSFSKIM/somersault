// appserver/schema/index.ts — the method→schema registry. Wave 4's generator and drift gate walk THIS
// record: a shipped method missing here is a build failure, so wire and artifact cannot drift (spec §9).
import type { z } from "zod/v4";
import { threadIdParams, initializeParams, serverStatusParams } from "./core.js";
import { threadStartParams, threadResumeParams, threadReadParams } from "./threads.js";
import { turnStartParams, turnInterruptParams } from "./turns.js";
import { decisionRespondParams } from "./decisions.js";

export interface MethodSchema { params: z.ZodType }
export const methodSchemas: Record<string, MethodSchema> = {
  "initialize": { params: initializeParams },
  "server/status": { params: serverStatusParams },
  "thread/start": { params: threadStartParams },
  "thread/resume": { params: threadResumeParams },
  "thread/list": { params: serverStatusParams }, // no params today; Wave 2 replaces with cursor/filter shape
  "thread/close": { params: threadIdParams },
  "thread/subscribe": { params: threadIdParams },
  "thread/unsubscribe": { params: threadIdParams },
  "thread/read": { params: threadReadParams },
  "turn/start": { params: turnStartParams },
  "turn/interrupt": { params: turnInterruptParams },
  "decision/list": { params: threadIdParams },
  "decision/respond": { params: decisionRespondParams },
};
