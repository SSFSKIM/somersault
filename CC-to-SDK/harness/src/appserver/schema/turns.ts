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
/** `turn/steer` (X, probe 103b): mid-turn injection. No `turnId` — a steer aims at whatever is running
 *  RIGHT NOW, and the thread can only be running one turn; naming an id would invite a client to steer a
 *  turn that has already ended. `input` mirrors `turn/start`'s (a bare string, empty allowed). */
export const turnSteerParams = z.object({ threadId: z.string().min(1), input: z.string() });
/** `turn/startContent` (F10 T-IMGREACH Task 10/I3d): the wire completion of a staged-image turn.
 *  `stagedImageIds` names completed `image/stage` reservations (Task 7) in the ORDER they should join the
 *  turn, and requires at least one — a content turn with no image is just `turn/start`, so an empty array
 *  here is a caller mistake, not a degenerate valid case. `text` is optional (an image-only turn is a
 *  supported shape, I1's stranding label covers it); `queue` mirrors `turn/start`'s own flag. */
export const turnStartContentParams = z.object({
  threadId: z.string().min(1), text: z.string().optional(),
  stagedImageIds: z.array(z.string().min(1)).min(1), queue: z.boolean().optional(),
});
