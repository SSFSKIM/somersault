// appserver/schema/threads.ts — thread lifecycle params (M1 set; Waves 1-2 extend this file).
import { z } from "zod/v4";
import { archivedParam, epochCursorParam, listCursorParam, threadIdParams } from "./core.js";
export const threadStartParams = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadResumeParams = z.object({
  sessionId: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
// Task 13: epoch-qualified cursor (epochCursorParam, not the plain decimal offset it was split from) —
// see schema/core.ts's comment on why thread/read alone needs this shape.
export const threadReadParams = threadIdParams.extend(epochCursorParam.shape);
// M6: `listCursorParam`, the keyset (core.ts), in the position `cursorParam` held — the field order is
// unchanged, so re-cursoring costs the byte-pinned artifact one `pattern` and one `description`.
// Task 12: extends the cursor shape with `cwd` (rather than reusing the alias directly) — the merged
// thread/list forwards `cwd` to deps.listSessions to scope the store side of the merge to one project.
// M5 Task 10 adds `archived`, the ONLY change this milestone makes to an existing method and additive by
// construction: the field is optional and its omitted reading is what this method already did. It is
// `core.ts`'s shared `archivedParam`, the same object `thread/search` publishes — the spec gives the
// partition to both methods in one sentence, so they publish one spelling of it.
export const threadListParams = listCursorParam.extend({ cwd: z.string().optional(), ...archivedParam.shape });
// Task 11: both `{ threadId }`-only — named here (rather than inlining threadIdParams at the index.ts
// registration site) so the method->schema table reads self-documenting, matching this file's other
// thread-lifecycle params.
export const threadCompactStartParams = threadIdParams;
export const threadReinitializeParams = threadIdParams;
// Task 12 (session library): `threadId` on all four accepts EITHER a registry id (`thr_…`) or a bare
// store sessionId — see sessionLib.ts's resolveThreadId, the one place that rule is implemented.
export const threadForkParams = z.object({
  threadId: z.string().min(1),
  upToMessageId: z.string().optional(),
  title: z.string().optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadNameSetParams = z.object({ threadId: z.string().min(1), title: z.string().min(1) });
export const threadTagSetParams = z.object({ threadId: z.string().min(1), tag: z.string().nullable() });
export const threadDeleteParams = z.object({ threadId: z.string().min(1) });
