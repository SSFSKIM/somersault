import { z } from "zod/v4";
import type { FleetState } from "../fleet/roster.js";
import type { AssertType, DecisionOutcome, ExactType } from "../permissions/types.js";

/** M3 §1a-c: `model` and `thinkingTokens` join `permissionMode` as host-published settings truth. All three
 *  are OPTIONAL for the same reason — a host that was never told one has nothing truthful to publish, and a
 *  mirroring client must be able to tell "unset" from "set". Without them a foreign client's `set_model`
 *  could never reach another client's mirror: `status`/`state` is the only settings channel there is, and it
 *  carried the mode alone. */
/** `short` is the host's OWN roster key, and the one field here that never moves for the life of the
 *  process — which is why the attach path (appserver/fleet.ts) identifies a socket by it and not by
 *  `sessionId`: a host that resumed or cleared is running a different conversation than the roster row it
 *  is still described by, and refusing THAT would refuse a legitimate attach to the very same host.
 *  Optional so a host predating the field reports none, which reads as "cannot say", never as a mismatch. */
export interface HostStatus { state: FleetState; status: "busy" | "idle"; waitingFor?: string; short?: string; sessionId?: string; permissionMode?: string; model?: string; thinkingTokens?: number }
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
  // `reason` (BL6) is the human-decline discriminator (permissions/types.ts) and MUST be listed: zod strips
  // unknown keys, so an omission here would silently swallow it on the way to the gate and the decline would
  // go on being reported as "No user is available to answer."
  z.object({ kind: z.literal("deny"), feedback: z.string().optional(), reason: z.literal("declined").optional() }),
  z.object({ kind: z.literal("question_answer"), answers: z.record(z.string(), z.string()), response: z.string().optional() }),
  // `mode` (permissions/types.ts PlanGrantMode) replaced a boolean `acceptEdits` in Wave T t10 — an ENUM,
  // not z.string(), because this schema is the only thing standing between a client's typo and a
  // setPermissionMode call the engine will reject.
  // `feedback` (Wave T t11) is the approver's typed sentence — ccx-local by construction (permissions/types.ts):
  // it never reaches the SDK's allow arm, which has no field for it. It DOES now reach other host clients:
  // M3 §1a-e put the whole outcome on `decision_settled.answer`, so a client that did not win the race can
  // see what was granted (this host path used to forward the kind string alone).
  z.object({ kind: z.literal("plan_approve"), mode: planGrantMode, updatedPermissions: z.array(permissionUpdate).optional(), plan: z.string().optional(), feedback: z.string().optional() }),
  z.object({ kind: z.literal("plan_reject"), feedback: z.string().optional() }),
]);
// SCHEMA-DRIFT GUARD (permissions/types.ts ExactType). This wire carries every DecisionOutcome member
// EXCEPT the elicitation family: an MCP elicitation never reaches `canUseTool` and is answered through the
// app server, so no host op ever names one. Written as an Exclude rather than a hand-listed set, so a NEW
// non-elicitation outcome breaks this build instead of being silently stripped here at runtime.
type HostAnswerKind = Exclude<DecisionOutcome["kind"], `elicitation_${string}`>;
type _HostAnswerKindsCovered = AssertType<ExactType<z.infer<typeof structuredAnswer>["kind"], HostAnswerKind>>;
type _HostAnswerFieldsMatch = AssertType<ExactType<z.infer<typeof structuredAnswer>, Extract<DecisionOutcome, { kind: HostAnswerKind }>>>;
const withId = { id: z.number().int().nonnegative().optional() };
// F9 T-IMAGE Task 5 (I3b): the small DESCRIPTOR the client sends to mint a staging file — never the
// image bytes themselves, which stay off this socket entirely (server.ts's MAX_FRAME bounds client→host
// traffic to 256 KiB; a real screenshot's base64 would blow through it). `dimensions`/`size` travel here
// even though the host does not enforce the pixel/byte caps itself at THIS op — that is
// `session/turnInput.ts`'s job at the message builder, which re-decodes the header rather than trusting
// any caller's claim — they exist so `ImageStaging.stage`'s bookkeeping has a full descriptor to keep.
const imageDescriptor = {
  mediaType: z.string().min(1),
  dimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  size: z.number().int().nonnegative(),
  sha256: z.string().min(1),
};
export const hostOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), ...withId }),
  z.object({ op: z.literal("stop"), ...withId }),
  z.object({ op: z.literal("pending"), ...withId }),
  // Exactly one of `decision`/`answer` is required — dispatch (server.ts) rejects both-or-neither; the
  // schema itself only bounds the SHAPE of each, not their mutual exclusivity.
  z.object({ op: z.literal("answer"), toolUseID: z.string().min(1), by: z.string().min(1), decision: decisionKind.optional(), answer: structuredAnswer.optional(), ...withId }),
  // F9 T-IMAGE Task 5 (I3b): mint a staging file for ONE image. The reply carries the path the client
  // then writes the actual bytes to (over the filesystem, never this socket) before claiming it in a
  // `prompt` op's `images` array. Deliberately its OWN op rather than folded into `prompt`'s schema — the
  // whole point of the negotiated protocol (spec v3.1) is that an OLD host's discriminated union does not
  // recognize this literal at all and answers "unknown op" (zod's own safeParse failure, server.ts's
  // dispatch), which is the LOUD version-skew signal the client keys its notice off of. A bare extra field
  // on `prompt` (v3's rejected design) would instead be silently STRIPPED by an old host's `prompt` schema
  // and run a text-only turn with nobody told.
  z.object({ op: z.literal("stageImage"), ...imageDescriptor, ...withId }),
  // M3 §1a-b: `uuid` is the CALLER's id for the user item this turn starts from, handed straight to
  // Session.submit's existing `{uuid}` opt so the pushed SDKUserMessage carries it. An orchestrating client
  // (the app server's fleet threads) mints item ids before it sends the prompt and must be able to stitch
  // its own item to the persisted row; an unstamped prompt makes that impossible. `.min(1)`, so a client
  // that computed an empty id is refused here rather than stamping the turn with nothing.
  // `images` (F9 T-IMAGE Task 5/I3b) is the CLAIM list — every entry names a file this same client already
  // staged via `stageImage` and has since written bytes to. `stagedId` is deliberately just `z.string()`
  // (not re-validated as a path shape here): the host treats it as an opaque key into its own staged map
  // (`ImageStaging`), so a claim for an id it never minted simply reads back as "missing" rather than a
  // schema rejection — one failure path instead of two.
  // final-review finding 2: `text` alone is no longer `.min(1)` — an image-only submit
  // (`assembleUserContent("", images)` via the remote `chatSession`) has nothing to put there. The
  // `.refine` below is what still refuses a truly empty prompt (no text AND no images): text may be
  // empty/absent ONLY when at least one image is claimed.
  z.object({
    op: z.literal("prompt"), text: z.string().optional(), uuid: z.string().min(1).optional(),
    images: z.array(z.object({ stagedId: z.string().min(1), sha256: z.string().min(1) })).optional(),
    ...withId,
  }).refine((v) => (v.text?.length ?? 0) > 0 || (v.images?.length ?? 0) > 0, { message: "prompt requires text or at least one image" }),
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
  // WAVE C TASK 11 (EP-C6): the effort op, in the same never-busy-gated flag-layer group as set_output_style.
  // The value domain is CLOSED here — the one op in this union whose payload is an enum rather than a free
  // string — and that is not symmetry, it is probe 102: `applyFlagSettings({effortLevel})` accepts a bogus
  // level SILENTLY, so a frame that got past the client-side gate must not get past the schema too.
  z.object({ op: z.literal("set_effort"), level: z.enum(["low", "medium", "high", "xhigh", "max"]), ...withId }),
]);
export type HostOp = z.infer<typeof hostOp>;
export type ControlOp = Extract<HostOp, { op: "set_model" | "set_permission_mode" | "set_thinking" | "capabilities" | "compact" | "usage" | "context_usage" | "mcp_status" | "mcp_reconnect" | "mcp_toggle" }>;
