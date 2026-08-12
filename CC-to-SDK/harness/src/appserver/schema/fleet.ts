// appserver/schema/fleet.ts — fleet adoption params (M3 §1e). Both methods are SERVER-scoped: neither
// takes a `threadId`, because neither addresses a thread this server already holds — `fleet/list` reports
// the machine's roster and `thread/attach` is what turns one of those rows into a thread.
import { z } from "zod/v4";
/** Un-chained and un-paged: the roster is a directory of small files, and a fleet that needs a cursor is
 *  a fleet nobody could run on one machine. Declared as a closed empty object anyway, like
 *  `serverStatusParams` — an unknown key is a client bug worth an early -32602, not a silent no-op. */
export const fleetListParams = z.object({});
/** `target` is resolved by the CLI's own rule (`src/cli/lifecycle.ts`): a SIMULTANEOUS filter over roster
 *  `short` | `sessionId` | `name`, where more than one hit is an error carrying the matches rather than a
 *  precedence — a wrong guess would attach to someone else's session. */
export const threadAttachParams = z.object({ target: z.string().min(1) });
