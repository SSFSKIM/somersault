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
