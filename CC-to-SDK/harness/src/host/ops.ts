import { z } from "zod/v4";
import type { FleetState } from "../fleet/roster.js";

export interface HostStatus { state: FleetState; status: "busy" | "idle"; waitingFor?: string }
const decisionKind = z.enum(["allow_once", "allow_always", "deny"]);
const withId = { id: z.number().int().nonnegative().optional() };
export const hostOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), ...withId }),
  z.object({ op: z.literal("stop"), ...withId }),
  z.object({ op: z.literal("pending"), ...withId }),
  z.object({ op: z.literal("answer"), toolUseID: z.string().min(1), decision: decisionKind, by: z.string().min(1), ...withId }),
  z.object({ op: z.literal("prompt"), text: z.string().min(1), ...withId }),
  z.object({ op: z.literal("interrupt"), ...withId }),
  z.object({ op: z.literal("follow"), ...withId }),
  z.object({ op: z.literal("unfollow"), ...withId }),
]);
export type HostOp = z.infer<typeof hostOp>;
