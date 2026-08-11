// appserver/schema/turns.ts — turn lifecycle params (M1 set + M2b Wave 4's queue flags).
import { z } from "zod/v4";
/** `queue`: on a thread that is busy WITH A TURN, enqueue instead of refusing (-33001) — the reply is
 *  `{queued:true, turn:{id,status:"queued"}, position}` rather than `{turn}`. The METHOD is stable; the
 *  flag is the experimental part (spec Wave 4's `turn/queue` X-gate). */
export const turnStartParams = z.object({ threadId: z.string().min(1), input: z.string(), queue: z.boolean().optional() });
/** `turnId`: address ONE turn. Naming a queued turn cancels just that entry and never touches the engine
 *  (spec D-M2-10 — ids are minted at enqueue precisely so an unstarted turn is addressable); an id that
 *  is not in the queue falls through to the ordinary interrupt of whatever is running. `cancelQueued` is
 *  Stop-means-stop-everything: flush the whole queue, then interrupt. BOTH together: the flush runs
 *  first and `turnId` is resolved against its result — the receipt reports the named id under
 *  `cancelled` and the flushed set under `cancelledQueued` (turns.ts). */
export const turnInterruptParams = z.object({ threadId: z.string().min(1), cancelQueued: z.boolean().optional(), turnId: z.string().min(1).optional() });
