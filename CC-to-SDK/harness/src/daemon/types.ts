import { z } from "zod/v4";
import { controlFrame } from "../bridge/types.js";
import { proactiveConfig } from "../proactive/types.js";
import type { ProactiveStatus } from "../proactive/types.js";
import type { LimitState } from "../limits/classify.js";
import type { TelemetryConfig } from "../config/telemetry.js";
import type { AssertType, ExactType, PermissionDecision } from "../permissions/types.js";

export class DaemonError extends Error {}

export type SessionStatus = "idle" | "busy" | "errored" | "restarting";
export type RestartPolicy = "no" | "on-failure";

export interface SessionRecord {
  id: string;
  daemonPid: number;
  status: SessionStatus;
  model?: string;
  permissionMode?: string;        // live permission mode (Increment C); written back on set_permission_mode
  restart?: RestartPolicy;   // persisted spawn restart posture, for faithful boot-rehydration
  sessionId?: string;      // the SDK session_id (captured from Session.sessionId), for durable resume (Spec 2)
  createdAt: number;
  lastActiveAt: number;
  restarts?: number;       // count of automatic restarts (D2)
  limit?: LimitState;      // billing/limit state as of the session's last turn (Wave 1; undefined = healthy)
  mirrorErrors?: number;   // dropped sessionStore mirror batches so far (W3.3; undefined/0 = loss-free)
  warm?: boolean;          // session was born from a pre-warmed subprocess slot (W3.2)
}

/** A live-pool entry on the wire: a SessionRecord enriched with the session's proactive status (if any). */
export type ListEntry = SessionRecord & { proactive?: ProactiveStatus };

export interface DaemonOptions {
  dir?: string;            // registry dir (default ~/.claude/cc-daemon/sessions)
  maxSessions?: number;    // default 32
  idleTimeoutMs?: number;  // default 30 min; 0 disables idle reaping
  reapEvery?: number;      // reaper interval ms; default 30_000
  now?: () => number;      // injectable clock (testing)
  restart?: RestartPolicy; // daemon-wide default restart policy (default "no")
  maxRestarts?: number;    // cumulative cap before giving up; default 5
  backoffMs?: number;      // base restart backoff; default 500
  maxBackoffMs?: number;   // backoff cap; default 30_000
  scheduleRestart?: (fn: () => void, ms: number) => () => void; // returns a canceller (testing seam)
  sessionOptions?: (sessionId: string) => Record<string, unknown>; // per-session options merged over { model } (D3)
  sharedTasks?: boolean | { dir?: string; listId?: string };       // wire a shared cc-tasks store into every session (D3)
  contextTool?: boolean;   // daemon-wide: expose the cc-context GetContextUsage tool to every session's agent (D6)
  telemetry?: TelemetryConfig; // daemon-wide OTel env gates — every session's subprocess exports (W3.1)
  warmPool?: { size?: number }; // pre-warm default-config subprocesses; spawns matching the default cfg skip startup latency (W3.2). Warm path requires NO sessionOptions/sharedTasks/contextTool/compactTool (those mutate per-session Options, which a warm handle ignores).
  compactTool?: boolean;   // daemon-wide: expose the cc-compact RequestCompaction tool to every session's agent (Spec B)
  permissionTimeoutMs?: number; // parked permission-request lifetime before auto-deny (default 30_000)
  rehydrate?: boolean;     // adopt orphaned sessions on boot (resume on first access) instead of reaping them; default false
  isAlive?: (pid: number) => boolean; // override the daemonPid-liveness check (testing seam; default process.kill(pid,0))
}

// NDJSON op protocol (one request per client connection).
const spawnOp = z.object({ op: z.literal("spawn"), model: z.string().optional(), restart: z.enum(["no", "on-failure"]).optional(), resume: z.string().optional(), permissionMode: z.string().optional() });
const submitOp = z.object({ op: z.literal("submit"), id: z.string(), prompt: z.string() });
const userContentBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), source: z.object({ type: z.literal("base64"), media_type: z.string().min(1), data: z.string() }) }),
]);
/** A NEW OP LITERAL, not a widened `prompt` field (F10 T-IMGREACH Task 12/I4): a discriminated union
 *  cannot ignore a discriminant it does not have, whereas an additive field on `submit` would be
 *  silently stripped by an old daemon's schema (Zod strips unknown keys) and run a text-only turn with
 *  nobody told. */
const submitContentOp = z.object({ op: z.literal("submit_content"), id: z.string(), input: z.array(userContentBlock).min(1) });
const listOp = z.object({ op: z.literal("list") });
const stopOp = z.object({ op: z.literal("stop"), id: z.string() });
const shutdownOp = z.object({ op: z.literal("shutdown") });
const controlOp = z.object({ op: z.literal("control"), id: z.string(), frame: controlFrame });
const startProactiveOp = z.object({ op: z.literal("start_proactive"), id: z.string(), config: proactiveConfig.optional() });
const stopProactiveOp = z.object({ op: z.literal("stop_proactive"), id: z.string() });
const sessionsOp = z.object({ op: z.literal("sessions"), cwd: z.string().optional(), limit: z.number().optional(), offset: z.number().optional() });
const messagesOp = z.object({ op: z.literal("messages"), id: z.string(), cwd: z.string().optional(), limit: z.number().optional(), offset: z.number().optional() });
const compactOp = z.object({ op: z.literal("compact"), id: z.string() });
const forkOp = z.object({ op: z.literal("fork"), id: z.string() });
const rewindOp = z.object({ op: z.literal("rewind"), id: z.string(), messageId: z.string(), fork: z.boolean().optional() });
const usageOp = z.object({ op: z.literal("usage"), id: z.string() });
const initOp = z.object({ op: z.literal("init"), id: z.string() });
const applyFlagSettingsOp = z.object({ op: z.literal("apply_flag_settings"), id: z.string(), settings: z.record(z.string(), z.unknown()) });
const renameSessionOp = z.object({ op: z.literal("rename"), id: z.string(), title: z.string(), cwd: z.string().optional() });
const tagSessionOp = z.object({ op: z.literal("tag"), id: z.string(), tag: z.string().nullable(), cwd: z.string().optional() });
const deleteSessionOp = z.object({ op: z.literal("delete"), id: z.string(), cwd: z.string().optional() });
// Mirrors PermissionDecision (permissions/types.ts). `allow_always` stays for back-compat (older clients
// still send it; it maps to the gate's in-memory Set) — the F6 dialogs emit `allow_with_updates` instead,
// whose `updatedPermissions` is the engine's own suggestion echoed back UNRESHAPED, hence the opaque
// record schema.
const permissionDecision = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow_once"), updatedInput: z.record(z.string(), z.unknown()).optional() }),
  z.object({ kind: z.literal("allow_with_updates"), updatedPermissions: z.array(z.record(z.string(), z.unknown())) }),
  z.object({ kind: z.literal("allow_always") }),
  z.object({ kind: z.literal("deny"), feedback: z.string().optional(), reason: z.literal("declined").optional() }),  // BL6 discriminator — same wire, same gate
]);
// SCHEMA-DRIFT GUARD (permissions/types.ts ExactType): this wire mirrors the PermissionDecision family
// EXACTLY — the daemon broker answers permission consults only, and the whole outcome reaches the same gate.
type _DaemonPermissionDecisionMatches = AssertType<ExactType<z.infer<typeof permissionDecision>, PermissionDecision>>;
const pendingPermissionsOp = z.object({ op: z.literal("pending_permissions") });
const permissionResponseOp = z.object({ op: z.literal("permission_response"), toolUseID: z.string(), decision: permissionDecision });
// runtime MCP topology (W3.5) — JSON-safe configs only; SDK-type (in-process) servers cannot cross the UDS wire
const mcpStatusOp = z.object({ op: z.literal("mcp_status"), id: z.string() });
const mcpSetServersOp = z.object({ op: z.literal("mcp_set_servers"), id: z.string(), servers: z.record(z.string(), z.record(z.string(), z.unknown())) });
const mcpToggleOp = z.object({ op: z.literal("mcp_toggle"), id: z.string(), name: z.string(), enabled: z.boolean() });
const mcpReconnectOp = z.object({ op: z.literal("mcp_reconnect"), id: z.string(), name: z.string() });
const mcpModeOverrideOp = z.object({ op: z.literal("mcp_mode_override"), id: z.string(), name: z.string(), mode: z.string().nullable() });

export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, submitContentOp, listOp, stopOp, shutdownOp, controlOp, startProactiveOp, stopProactiveOp, sessionsOp, messagesOp, compactOp, forkOp, rewindOp, usageOp, initOp, applyFlagSettingsOp, renameSessionOp, tagSessionOp, deleteSessionOp, pendingPermissionsOp, permissionResponseOp, mcpStatusOp, mcpSetServersOp, mcpToggleOp, mcpReconnectOp, mcpModeOverrideOp]);
export type DaemonOp = z.infer<typeof daemonOp>;

/** Inbound frame cap, DERIVED FROM THE CANONICAL CONTENT MAXIMUM (round-2 F9 + round-3 F3):
 *    20 images × ~683 KB canonical base64 ≈ 13.7 MiB      (the base64 alphabet needs no JSON escapes)
 *  + MAX_TOTAL_TEXT (1,048,576 UTF-16 units) × 6 bytes/unit worst-case JSON-escaped ≈ 6 MiB
 *  + envelope overhead                                     → ~20 MiB, +20% margin → 24 MiB.
 *  v3's 16 MiB was wrong twice: it used 2 bytes per UTF-16 unit where the wire is UTF-8 JSON (escapes cost
 *  up to 6), and it admitted non-canonical whitespace-padded base64 that could stretch an admitted frame
 *  toward 100 MiB. Both halves are closed here AND upstream: the client runs `normalizeTurnInput` before
 *  transport (it is in-process with the library) and the normalizer canonicalizes every passing image's
 *  data to `decoded.toString("base64")`, so padding and whitespace never reach this socket.
 *
 *  WHERE THIS CAP ACTUALLY BINDS (re-review r3): on the SERVER, against a RAW writer — anything that is not
 *  this client, including a hostile one, and that is what the raw-frame cells exercise. It does NOT bind a
 *  normalized client payload: `MAX_AGGREGATE_BYTES` caps the image half at 5 MiB decoded (~6.8 MiB base64,
 *  because only ten 512,000-byte images fit) and `MAX_TOTAL_TEXT` caps the text half at ~6 MiB escaped, so
 *  ~13 MiB is the normalized ceiling. The 24 MiB figure is deliberately kept above the derivation's own
 *  20 MiB worst case; the client-side preflight over it is defence-in-depth, tested at an injected limit. */
export const DAEMON_MAX_FRAME_BYTES = 24 * 1024 * 1024;
/** A partial line held STRICTLY LONGER than this without a newline drops the connection with a logged reason
 *  (round-2 F11: one byte held forever still exhausts connections, so a byte cap alone is not a bound).
 *
 *  THE BOUNDARY IS INCLUSIVE, and it is stated here because the implementation has to spell it (re-review
 *  r3): `triple()` marks the cap row as PASSING for every limit in this track, so a line held for exactly
 *  DAEMON_PARTIAL_LINE_MS must SURVIVE. `setTimeout(fn, DAEMON_PARTIAL_LINE_MS)` fires the moment the clock
 *  reaches that value and would kill it, so the timer is armed at `DAEMON_PARTIAL_LINE_MS + 1` — the one
 *  extra millisecond is what makes "older than" literally true. Do not "simplify" the `+ 1` away: it is the
 *  difference between the documented rule and the opposite one. */
export const DAEMON_PARTIAL_LINE_MS = 10_000;
