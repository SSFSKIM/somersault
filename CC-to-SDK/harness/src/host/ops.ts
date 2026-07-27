import { z } from "zod/v4";
import type { FleetState } from "../fleet/roster.js";

export interface HostStatus { state: FleetState; status: "busy" | "idle"; waitingFor?: string; sessionId?: string }
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
  z.object({ op: z.literal("set_model"), model: z.string().min(1).optional(), ...withId }),
  z.object({ op: z.literal("set_permission_mode"), mode: z.string().min(1), ...withId }),
  z.object({ op: z.literal("set_thinking"), maxTokens: z.number().int().nullable(), ...withId }),
  z.object({ op: z.literal("capabilities"), ...withId }),
  z.object({ op: z.literal("compact"), ...withId }),
  z.object({ op: z.literal("usage"), ...withId }),
  z.object({ op: z.literal("context_usage"), ...withId }),
  z.object({ op: z.literal("mcp_status"), ...withId }),
  z.object({ op: z.literal("mcp_reconnect"), name: z.string().min(1), ...withId }),
  z.object({ op: z.literal("mcp_toggle"), name: z.string().min(1), enabled: z.boolean(), ...withId }),
  z.object({ op: z.literal("resume"), sessionId: z.string().min(1), ...withId }),
]);
export type HostOp = z.infer<typeof hostOp>;
export type ControlOp = Extract<HostOp, { op: "set_model" | "set_permission_mode" | "set_thinking" | "capabilities" | "compact" | "usage" | "context_usage" | "mcp_status" | "mcp_reconnect" | "mcp_toggle" }>;
