// appserver/schema/threads.ts — thread lifecycle params (M1 set; Waves 1-2 extend this file).
import { z } from "zod/v4";
import { cursorParam, threadIdParams } from "./core.js";
export const threadStartParams = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadResumeParams = z.object({
  sessionId: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadReadParams = threadIdParams.extend(cursorParam.shape);
export const threadListParams = cursorParam;
// Task 11: both `{ threadId }`-only — named here (rather than inlining threadIdParams at the index.ts
// registration site) so the method->schema table reads self-documenting, matching this file's other
// thread-lifecycle params.
export const threadCompactStartParams = threadIdParams;
export const threadReinitializeParams = threadIdParams;
