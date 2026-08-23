import { daemonRequest } from "./client.js";
import { daemonOp, DAEMON_MAX_FRAME_BYTES } from "./types.js";
import type { ListEntry, RestartPolicy } from "./types.js";
import type { ControlFrame, ControlResponse } from "../bridge/types.js";
import type { CompactOutcome } from "../compaction/index.js";
import type { ProactiveStatus, ProactiveConfigInput } from "../proactive/types.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { PermissionDecision } from "../permissions/types.js";
import { normalizeTurnInput } from "../session/turnInput.js";
import type { UserContentBlock, UserTurnInput } from "../session/turnInput.js";

/** The minimal daemon-read surface collect() needs (injected → unit-testable without a socket). */
export interface MonitorClient {
  list(): Promise<ListEntry[]>;
  contextUsage(id: string): Promise<unknown>;
  pendingPermissions?(): Promise<PendingEntry[]>;
}

/** The full operator client: the read subset + the drive ops. Each method wraps daemonRequest with the
 *  matching op and throws on { ok:false } — EXCEPT control(), which returns the raw ControlResponse so the
 *  UI can surface { ok:false, error } itself. */
export interface DaemonClient extends MonitorClient {
  submit(id: string, prompt: string, onChunk: (m: unknown) => void): Promise<{ result: unknown }>;
  control(id: string, frame: ControlFrame): Promise<ControlResponse>;
  compact(id: string): Promise<CompactOutcome>;
  spawn(opts?: { model?: string; restart?: RestartPolicy; resume?: string }): Promise<string>;
  stop(id: string): Promise<void>;
  fork(id: string): Promise<{ id: string; sessionId?: string }>;
  /** Conversation rewind (time-travel). Default in-place = DESTRUCTIVE (transcript truncated at the
   *  anchor, same ids); { fork: true } opens a new anchored daemon session, original untouched. */
  rewind(id: string, messageId: string, opts?: { fork?: boolean }): Promise<{ id: string }>;
  /** Fresh init payload (commands/agents/models/account…) re-fetched from the running CLI. */
  reinitialize(id: string): Promise<unknown>;
  /** The session's live background-task set (task_id/task_type/description). */
  backgroundTasks(id: string): Promise<unknown[]>;
  stopTask(id: string, taskId: string): Promise<void>;
  startProactive(id: string, config?: ProactiveConfigInput): Promise<ProactiveStatus>;
  stopProactive(id: string): Promise<void>;
  pendingPermissions(): Promise<PendingEntry[]>;
  respondPermission(toolUseID: string, decision: PermissionDecision): Promise<void>;
  // runtime MCP topology (W3.5) — JSON-safe configs only (stdio/sse/http; SDK-type rejected daemon-side)
  mcpStatus(id: string): Promise<unknown[]>;
  mcpSetServers(id: string, servers: Record<string, Record<string, unknown>>): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> }>;
  /** ADVISORY (probe 52b): a disabled server is resurrected by the next model tool call — gate with permissions, not toggle. */
  mcpToggle(id: string, name: string, enabled: boolean): Promise<void>;
  mcpReconnect(id: string, name: string): Promise<void>;
  /** Per-server permission-mode pin — rules-layer only (probe 49); does not silence a canUseTool broker. */
  mcpModeOverride(id: string, name: string, mode: string | null): Promise<unknown>;
  /** BLOCK ARRAYS ONLY, AND NON-EMPTY — deliberately NOT `UserTurnInput` (plan-review r2 F-DAEMON,
   *  verified: the `submit_content` schema's `input` is `z.array(userContentBlock).min(1)`, and
   *  `normalizeTurnInput` preserves a bare string as a string, so a `UserTurnInput`-typed method would
   *  let a perfectly typed call be refused on the wire as `invalid op payload`). A string has an op of
   *  its own and always did: `submit`. The type is the routing rule, so the wrong call cannot compile.
   *
   *  Normalizes (so the wire carries the normalizer's canonical output), **parses the exact outgoing op
   *  against the daemon's own `daemonOp` schema**, preflights the serialized size, then sends. Only
   *  after the payload has been proven schema-valid locally does a `bad request`-class answer get
   *  mapped to DAEMON_IMAGE_SKEW_NOTICE — that mapping is sound only because the client knows its own
   *  payload is good. */
  submitContent(id: string, blocks: NonEmptyBlocks, onChunk: (m: unknown) => void): Promise<{ result: unknown }>;
}

/** The client-side mapping the old peer cannot express (review F8). A pre-F10 daemon answers
 *  `bad request: …` for the new literal — indistinguishable, from the server's side, from a genuine
 *  payload error. But the CLIENT knows the payload is schema-valid (it built it and preflighted it), so
 *  a `bad request`-class answer to `submit_content` means exactly one thing. */
export const DAEMON_IMAGE_SKEW_NOTICE = "daemon does not support image submission (pre-F10 daemon)";

/** Refused CLIENT-SIDE, before a byte is written, when the serialized op exceeds the frame limit. */
export class DaemonFrameTooLargeError extends Error {
  readonly bytes: number;
  readonly limit: number;
  constructor(bytes: number, limit: number) {
    super(`serialized op is ${bytes} bytes, exceeding the ${limit}-byte frame limit`);
    this.bytes = bytes;
    this.limit = limit;
  }
}

/** NON-EMPTY block arrays only (re-review r3). `UserContentBlock[]` admits `[]`, which
 *  `normalizeTurnInput` faithfully preserves — and the wire schema's `.min(1)` then refuses it as
 *  `bad request`, which the skew mapping below would report as a pre-F10 daemon. A genuine bad payload
 *  must never be blamed on the peer's age, and the cheapest way to guarantee that is for the empty case
 *  not to compile. */
export type NonEmptyBlocks = readonly [UserContentBlock, ...UserContentBlock[]];

/** Serialize + size-check ONE op, with an INJECTABLE limit. Exported and parameterised for a reason
 *  that is worth stating (re-review r3): with the real 24 MiB limit, a NORMALIZED payload physically
 *  cannot reach it — `MAX_AGGREGATE_BYTES` bounds images at 5 MiB decoded (≈6.8 MiB of base64) and
 *  `MAX_TOTAL_TEXT` bounds text at ≈6 MiB of worst-case JSON escaping, ≈13 MiB together. The client
 *  preflight is therefore defence-in-depth over the SERVER's bound (which a raw writer can and does
 *  exceed), and the only honest way to test it is to lower its limit. A cell that can never go red is
 *  not a test. */
export function preflightOp(op: unknown, limit: number = DAEMON_MAX_FRAME_BYTES): number {
  const bytes = Buffer.byteLength(JSON.stringify(op), "utf8");
  if (bytes > limit) throw new DaemonFrameTooLargeError(bytes, limit);
  return bytes;
}

/** The one place a caller holding a `UserTurnInput` union turns it into a call — strings to `submit`,
 *  arrays to `submitContent`. Exported beside the client rather than left to each caller, for the same
 *  reason the app-server's drain has one dispatcher (Task 8): two call sites choosing independently is
 *  how one of them ends up flattening an image into text. */
export function daemonSubmitTurn(
  client: DaemonClient, id: string, input: UserTurnInput, onChunk: (m: unknown) => void,
): Promise<{ result: unknown }> {
  if (typeof input === "string") return client.submit(id, input, onChunk);
  // The ONE place a runtime-width `UserContentBlock[]` narrows to `NonEmptyBlocks`. Throwing here names
  // the caller's own mistake; letting `[]` through would earn a `bad request` and be misreported as
  // peer skew.
  const [head, ...rest] = input;
  if (head === undefined) throw new Error("submit_content requires at least one content block");
  return client.submitContent(id, [head, ...rest], onChunk);
}

export type RequestFn = (socketPath: string, op: unknown, onLine?: (o: unknown) => void) => Promise<any[]>;

/** Typed client over the daemon UDS op protocol — a thin wrapper over the already-public daemonRequest
 *  (no protocol duplication). The transport is injectable for unit tests; defaults to the real socket.
 *  `frameLimit` is the client-side preflight's DI seam (beside `request`), defaulting to
 *  `DAEMON_MAX_FRAME_BYTES`. */
export function connectDaemon(socketPath: string, request: RequestFn = daemonRequest, frameLimit: number = DAEMON_MAX_FRAME_BYTES): DaemonClient {
  const one = async (op: unknown): Promise<any> => {
    const [res] = await request(socketPath, op);
    if (!res?.ok) throw new Error(res?.error ?? "daemon op failed");
    return res;
  };
  return {
    async list() { return (await one({ op: "list" })).sessions as ListEntry[]; },
    async contextUsage(id) { return (await one({ op: "control", id, frame: { type: "context_usage" } })).usage; },
    async control(id, frame) { const [res] = await request(socketPath, { op: "control", id, frame }); return res as ControlResponse; },
    async submit(id, prompt, onChunk) {
      const lines = await request(socketPath, { op: "submit", id, prompt }, (o: any) => { if (o?.type === "chunk") onChunk(o.message); });
      const done = lines.find((l: any) => l?.type === "done");
      if (!done) { const err = lines.find((l: any) => l && l.ok === false); throw new Error(err?.error ?? "submit produced no result"); }
      return { result: done.result };
    },
    async submitContent(id, blocks, onChunk) {
      // `blocks` is a NON-EMPTY ARRAY by type, so `normalizeTurnInput` returns an array and never an
      // empty one — which is exactly what the `submit_content` schema's `.min(1)` requires. That is the
      // whole reason this parameter is neither `UserTurnInput` nor a plain `UserContentBlock[]`.
      const normalized = normalizeTurnInput([...blocks]) as UserContentBlock[];
      const op = { op: "submit_content", id, input: normalized };
      // PREVALIDATE OUR OWN PAYLOAD (re-review r3). The skew mapping below is only sound if a
      // `bad request` answer cannot possibly be about the payload — so prove that here, against the
      // daemon's own schema, before anything is written. A failure is this client's bug, said plainly.
      const parsed = daemonOp.safeParse(op);
      if (!parsed.success) throw new Error(`invalid submit_content payload: ${parsed.error.message}`);
      preflightOp(op, frameLimit);   // throws DaemonFrameTooLargeError before a byte is written
      const lines = await request(socketPath, op, (o: any) => { if (o?.type === "chunk") onChunk(o.message); });
      const done = lines.find((l: any) => l?.type === "done");
      if (done) return { result: done.result };
      const err = lines.find((l: any) => l && l.ok === false);
      const message = err?.error ?? "submit_content produced no result";
      // THE MAPPING (review F8). This client built the payload and preflighted it, so a `bad
      // request`-class answer to THIS op cannot mean "your payload is wrong" — it means the peer's
      // schema has never heard of the literal. `unknown op` is the same verdict from a peer new enough
      // to say so.
      if (/^bad request:/.test(message) || message === "unknown op") throw new Error(DAEMON_IMAGE_SKEW_NOTICE);
      throw new Error(message);
    },
    async compact(id) { return (await one({ op: "compact", id })).outcome as CompactOutcome; },
    async spawn(opts) { return (await one({ op: "spawn", ...(opts ?? {}) })).id as string; },
    async stop(id) { await one({ op: "stop", id }); },
    async fork(id) { const r = await one({ op: "fork", id }); return { id: r.id, sessionId: r.sessionId }; },
    async rewind(id, messageId, opts) { return { id: (await one({ op: "rewind", id, messageId, ...(opts?.fork ? { fork: true } : {}) })).id as string }; },
    async reinitialize(id) { return (await one({ op: "control", id, frame: { type: "reinitialize" } })).init; },
    async backgroundTasks(id) { return (await one({ op: "control", id, frame: { type: "background_tasks" } })).tasks as unknown[]; },
    async stopTask(id, taskId) { await one({ op: "control", id, frame: { type: "stop_task", taskId } }); },
    async startProactive(id, config) { return (await one({ op: "start_proactive", id, ...(config ? { config } : {}) })).status as ProactiveStatus; },
    async stopProactive(id) { await one({ op: "stop_proactive", id }); },
    async pendingPermissions() { return (await one({ op: "pending_permissions" })).pending as PendingEntry[]; },
    async respondPermission(toolUseID, decision) { await one({ op: "permission_response", toolUseID, decision }); },
    async mcpStatus(id) { return (await one({ op: "mcp_status", id })).servers as unknown[]; },
    async mcpSetServers(id, servers) { return (await one({ op: "mcp_set_servers", id, servers })).result; },
    async mcpToggle(id, name, enabled) { await one({ op: "mcp_toggle", id, name, enabled }); },
    async mcpReconnect(id, name) { await one({ op: "mcp_reconnect", id, name }); },
    async mcpModeOverride(id, name, mode) { return (await one({ op: "mcp_mode_override", id, name, mode })).result; },
  };
}
