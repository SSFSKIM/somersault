// appserver/schema/core.ts — shared shapes (spec §9: zod is the single source of truth; the schema IS
// the validator — handlers import from here, never declare inline).
import { z } from "zod/v4";
export const threadIdParams = z.object({ threadId: z.string().min(1) });
export const initializeParams = z.object({
  clientInfo: z.object({ name: z.string() }),
  authorization: z.string().optional(),
});
export const serverStatusParams = z.object({});
