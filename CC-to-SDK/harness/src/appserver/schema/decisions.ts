// appserver/schema/decisions.ts — decision params. Mirrors DecisionOutcome (src/permissions/types.ts)
// and the host wire (host/ops.ts) — never trust a client-supplied `by` (spec §6, server-stamped only).
import { z } from "zod/v4";
import { cursorParam, threadIdParams } from "./core.js";
// A parked set is small and unpaged today (reply always carries nextCursor: null), but the params shape
// reuses cursorParam so the envelope is uniform across every list method and Task 13 need touch only
// core.ts's regex if/when this ever pages for real.
export const decisionListParams = threadIdParams.extend(cursorParam.shape);
// `updatedPermissions` entries are opaque records: they are the engine's own PermissionUpdate suggestions
// travelling back verbatim (permissions/types.ts PermissionUpdateLike), so the schema must not narrow them.
const permissionUpdateParams = z.record(z.string(), z.unknown());
export const decisionOutcomeParams = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow_once"), updatedInput: z.record(z.string(), z.unknown()).optional() }),
  z.object({ kind: z.literal("allow_with_updates"), updatedPermissions: z.array(permissionUpdateParams) }),
  z.object({ kind: z.literal("allow_always") }),
  z.object({ kind: z.literal("deny"), feedback: z.string().optional() }),
  z.object({ kind: z.literal("question_answer"), answers: z.record(z.string(), z.string()), response: z.string().optional() }),
  // The granted mode, not a boolean (Wave T t10) — the same enum host/ops.ts pins, kept in lockstep by
  // hand because zod schemas are values and no compiler check spans the two wires.
  z.object({ kind: z.literal("plan_approve"), mode: z.enum(["default", "acceptEdits", "bypassPermissions", "auto"]), updatedPermissions: z.array(permissionUpdateParams).optional(), plan: z.string().optional(), feedback: z.string().optional() }),
  z.object({ kind: z.literal("plan_reject"), feedback: z.string().optional() }),
]);
export const decisionRespondParams = z.object({
  threadId: z.string().min(1),
  toolUseId: z.string().min(1),
  answer: decisionOutcomeParams,
  abortTurn: z.boolean().optional(),
});
