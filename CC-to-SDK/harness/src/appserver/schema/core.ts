// appserver/schema/core.ts — shared shapes (spec §9: zod is the single source of truth; the schema IS
// the validator — handlers import from here, never declare inline).
import { z } from "zod/v4";
export const threadIdParams = z.object({ threadId: z.string().min(1) });
export const initializeParams = z.object({
  clientInfo: z.object({ name: z.string() }),
  authorization: z.string().optional(),
  // Both connection-scoped (spec Wave 0, D-M2-5): watchThreads opts this connection into server-scoped
  // thread-existence fan-out (fanout.ts); optOutNotificationMethods is honored at the last hop, Peer.notify.
  watchThreads: z.boolean().optional(),
  optOutNotificationMethods: z.array(z.string()).optional(),
});
export const serverStatusParams = z.object({});
// The one cursor shape, reused (via .extend(cursorParam.shape)) by thread/read, thread/list, and
// decision/list (Task 2's review: the shape stayed inlined in threadReadParams; Task 13 changes only
// THIS regex when the cursor becomes epoch-qualified — one definition means one change).
export const cursorParam = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().positive().optional(),
});
