// appserver/schema/rewind.ts — M2b Wave 3: the rewind trio's params (spec §9: zod is the single source
// of truth; the schema IS the validator). Built on `threadIdParams.extend(...)` like schema/threads.ts's
// own thread-scoped shapes, so the shared `threadId` rule lives in exactly one place.
import { z } from "zod/v4";
import { threadIdParams } from "./core.js";

export const rewindAnchorsParams = threadIdParams;
export const rewindDryRunParams = threadIdParams.extend({ uuid: z.string().min(1) });
// `prevUuid` is REQUIRED-but-nullable, not optional: `null` is the meaningful value ("this prompt is the
// first — there is no conversation anchor before it"), and a client that simply forgot the field must not
// be read as asserting that. `scope` mirrors the host wire's RewindScope: "code" restores only the working
// tree, "conversation" only the transcript, "both" is the Esc-Esc default.
export const rewindParams = threadIdParams.extend({
  uuid: z.string().min(1),
  prevUuid: z.string().min(1).nullable(),
  scope: z.enum(["both", "conversation", "code"]),
});
