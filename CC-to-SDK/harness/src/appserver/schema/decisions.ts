// appserver/schema/decisions.ts — decision params. Mirrors DecisionOutcome (src/permissions/types.ts)
// and the host wire (host/ops.ts) — never trust a client-supplied `by` (spec §6, server-stamped only).
import { z } from "zod/v4";
export const decisionOutcomeParams = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow_once") }),
  z.object({ kind: z.literal("allow_always") }),
  z.object({ kind: z.literal("deny") }),
  z.object({ kind: z.literal("question_answer"), answers: z.record(z.string(), z.string()), response: z.string().optional() }),
  z.object({ kind: z.literal("plan_approve"), acceptEdits: z.boolean() }),
  z.object({ kind: z.literal("plan_reject"), feedback: z.string().optional() }),
]);
export const decisionRespondParams = z.object({
  threadId: z.string().min(1),
  toolUseId: z.string().min(1),
  answer: decisionOutcomeParams,
  abortTurn: z.boolean().optional(),
});
