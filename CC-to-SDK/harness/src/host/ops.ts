import { z } from "zod/v4";
import type { FleetState } from "../fleet/roster.js";

export interface HostStatus { state: FleetState; status: "busy" | "idle"; waitingFor?: string; sessionId?: string; permissionMode?: string }
const decisionKind = z.enum(["allow_once", "allow_always", "deny"]);
// One SDK PermissionUpdate, carried verbatim (permissions/types.ts PermissionUpdateLike): an opaque
// record ON PURPOSE — the engine authors these and we echo them back, so the wire must not reshape or
// strip-by-schema anything inside one, including keys a future SDK adds.
const permissionUpdate = z.record(z.string(), z.unknown());
// Kept in lockstep with permissions/types.ts's PlanGrantMode and with appserver/server.ts's copy of this
// union (two wires, one shape) — a `satisfies` on the outcome type is not possible here: zod schemas are
// VALUES, so nothing in the compiler notices when one drifts from the other.
const planGrantMode = z.enum(["default", "acceptEdits", "bypassPermissions", "auto"]);
// Every answer that carries a PAYLOAD travels structured; the flat `decision` field above stays the
// legacy payload-free 3-way permission shape (spec: an old client's permission answer must still parse
// on a new host, see server.ts's dispatch arm). F6 T3 widened this from question/plan-only: the
// permission family gained editable input, a real "don't ask again" (updatedPermissions) and deny
// feedback, none of which fit in a bare string.
const structuredAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow_once"), updatedInput: z.record(z.string(), z.unknown()).optional() }),
  z.object({ kind: z.literal("allow_with_updates"), updatedPermissions: z.array(permissionUpdate) }),
  z.object({ kind: z.literal("allow_always") }),
  z.object({ kind: z.literal("deny"), feedback: z.string().optional() }),
  z.object({ kind: z.literal("question_answer"), answers: z.record(z.string(), z.string()), response: z.string().optional() }),
  // `mode` (permissions/types.ts PlanGrantMode) replaced a boolean `acceptEdits` in Wave T t10 — an ENUM,
  // not z.string(), because this schema is the only thing standing between a client's typo and a
  // setPermissionMode call the engine will reject.
  // `feedback` (Wave T t11) is the approver's typed sentence — ccx-local by construction (permissions/types.ts):
  // the app-server's `decision/resolved` fan-out is its one consumer, THIS host path forwards it nowhere, and
  // it never reaches the SDK's allow arm, which has no field for it.
  z.object({ kind: z.literal("plan_approve"), mode: planGrantMode, updatedPermissions: z.array(permissionUpdate).optional(), plan: z.string().optional(), feedback: z.string().optional() }),
  z.object({ kind: z.literal("plan_reject"), feedback: z.string().optional() }),
]);
const withId = { id: z.number().int().nonnegative().optional() };
export const hostOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), ...withId }),
  z.object({ op: z.literal("stop"), ...withId }),
  z.object({ op: z.literal("pending"), ...withId }),
  // Exactly one of `decision`/`answer` is required — dispatch (server.ts) rejects both-or-neither; the
  // schema itself only bounds the SHAPE of each, not their mutual exclusivity.
  z.object({ op: z.literal("answer"), toolUseID: z.string().min(1), by: z.string().min(1), decision: decisionKind.optional(), answer: structuredAnswer.optional(), ...withId }),
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
  // Live-feedback fix (2026-08-06): /clear was UI-only (wipe screen + fresh document, engine context
  // kept), which is not what upstream's /clear does — it frees the context. This op is the engine half:
  // the same swapEngine seam resume/rewind ride, opened FRESH (no resume key), busy-gated like both.
  z.object({ op: z.literal("clear"), ...withId }),
  // Schema-only for now — Task 4 wires their dispatch handlers; server.ts's placeholder arms return
  // {ok:false, error:"unsupported"} so the schema is never ahead of a crashing dispatch.
  z.object({ op: z.literal("tasks"), ...withId }),
  z.object({ op: z.literal("background"), ...withId }),
  z.object({ op: z.literal("stop_task"), taskId: z.string().min(1), ...withId }),
  // C5 T3: Esc-Esc rewind. `rewind_anchors`/`rewind_dryrun` are read-only; `rewind` is busy-gated in
  // server.ts's dispatch, exactly like `resume`.
  z.object({ op: z.literal("rewind_anchors"), ...withId }),
  z.object({ op: z.literal("rewind_dryrun"), uuid: z.string().min(1), ...withId }),
  z.object({ op: z.literal("rewind"), uuid: z.string().min(1), prevUuid: z.string().min(1).nullable(), scope: z.enum(["both", "conversation", "code"]), ...withId }),
  // W3 T1: settings/dirs ops. get_settings/list_dirs are read-only passthroughs; the rest mutate the
  // host's flag-state accumulator (see host.ts) and are never busy-gated — they don't touch the engine
  // conversation, only its dynamic flag layer.
  z.object({ op: z.literal("get_settings"), ...withId }),
  z.object({ op: z.literal("list_dirs"), ...withId }),
  z.object({ op: z.literal("add_dir"), path: z.string().min(1), ...withId }),
  z.object({ op: z.literal("remove_dir"), path: z.string().min(1), ...withId }),
  z.object({ op: z.literal("set_output_style"), style: z.string().min(1), ...withId }),
  z.object({ op: z.literal("add_rule"), behavior: z.enum(["allow", "ask", "deny"]), rule: z.string().min(1), ...withId }),
  z.object({ op: z.literal("remove_rule"), behavior: z.enum(["allow", "ask", "deny"]), rule: z.string().min(1), ...withId }),
]);
export type HostOp = z.infer<typeof hostOp>;
export type ControlOp = Extract<HostOp, { op: "set_model" | "set_permission_mode" | "set_thinking" | "capabilities" | "compact" | "usage" | "context_usage" | "mcp_status" | "mcp_reconnect" | "mcp_toggle" }>;
