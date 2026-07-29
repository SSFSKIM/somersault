// appserver/schema/turns.ts — turn lifecycle params (M1 set; M2b's queue flag lands here).
import { z } from "zod/v4";
export const turnStartParams = z.object({ threadId: z.string().min(1), input: z.string() });
export const turnInterruptParams = z.object({ threadId: z.string().min(1), cancelQueued: z.boolean().optional() });
