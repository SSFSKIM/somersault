import { z } from "zod/v4";
import type { FleetState } from "../fleet/roster.js";

export interface HostStatus { state: FleetState; status: "busy" | "idle"; waitingFor?: string }
const withId = { id: z.number().int().nonnegative().optional() };
export const hostOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), ...withId }),
  z.object({ op: z.literal("stop"), ...withId }),
]);
export type HostOp = z.infer<typeof hostOp>;
