// appserver/schema/threads.ts — thread lifecycle params (M1 set; Waves 1-2 extend this file).
import { z } from "zod/v4";
export const threadStartParams = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadResumeParams = z.object({
  sessionId: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadReadParams = z.object({
  threadId: z.string().min(1),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().positive().optional(),
});
