// appserver/schema/images.ts — F10 T-IMGREACH Task 10 (I3d): the wire shape for `image/stage` chunks.
// NEGOTIATED, like `turn/startContent` beside it (schema/turns.ts): an old server answers METHOD_NOT_FOUND
// for both rather than accepting a widened input it cannot honour (this file's own header brief: "an
// additive field would be silently stripped ... and a text-only turn would run with nobody told").
import { z } from "zod/v4";
import type { AssertType, ExactType } from "../../permissions/types.js";   // the tree's identity probe, as src/host/ops.ts:3 uses it
import type { ImageStageChunk } from "../imageStage.js";                   // Task 7's DTO — this file pins the wire TO it

/** One chunk of a staged image. Chunks carry BASE64, ≤ 128 KiB of `data` each — comfortably inside the
 *  256 KiB frame cap with room for the envelope. `mediaType` is REQUIRED ON THE FIRST CHUNK (round-2 F6:
 *  `UserContentBlock` requires `source.media_type`, and the host staging path retains it explicitly for
 *  the same reason — bytes alone cannot satisfy the contract), but bl5 T-SNIFF downgrades what "required"
 *  means: it is now a bounded non-empty HINT, not a format gate — the registry no longer checks it against
 *  the image allowlist at this point, because no bytes exist yet to sniff. Format acceptance is decided
 *  once, at completion, from the assembled bytes. It is handler-enforced rather than schema-enforced
 *  because `seq` is a number, not a discriminant — the registry (`imageStage.ts`'s `chunk()`) is that
 *  enforcement, and this handler passes its parsed params straight through with no re-mapping. */
export const imageStageParams = z.object({
  stageId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  last: z.boolean(),
  bytesTotal: z.number().int().positive(),      // total BASE64 bytes the client will send for this stage
  mediaType: z.string().min(1).optional(),      // required on seq 0 — see the handler
  data: z.string(),
});
/** The wire shape and the registry's own DTO are ONE shape (re-review r3). `ImageStageChunk` is declared by
 *  `src/appserver/imageStage.ts` (Task 7, which must compile without this file); this assertion is where the
 *  two are pinned together, so adding a field to either side without the other breaks the BUILD. */
type _StageChunkMatchesWire = AssertType<ExactType<z.infer<typeof imageStageParams>, ImageStageChunk>>;
