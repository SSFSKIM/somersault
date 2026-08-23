// harness/src/appserver/imageStage.ts — F10 T-IMGREACH Task 7 (I3a): the app-server image stage
// REGISTRY. The transport fact that shapes this module: inbound app-server frames cap at 256 KiB
// (peer.ts:8 `MAX_IN`), so a legal 512,000-byte image (~683 KB base64) can never ride one JSON-RPC
// frame — a client must send it in chunks, exactly like the host's own staging path
// (`host/imageStaging.ts`), just over the socket instead of the filesystem.
//
// Scope, deliberately narrow (plan-review r2 F18): this is the registry ONLY — no schema, no handler,
// no wire. Resource-lifecycle risk (this file) and wire risk (Task 10) are separate review problems.
//
// Everything time- or policy-dependent is injected (`ImageStageDeps`), so every cell in this module's
// test is deterministic and the validate-once contract is observable with a spy rather than inferred.
import { MAX_BASE64_INPUT_BYTES, validateImageBlock, type UserContentBlock } from "../session/turnInput.js";
import { randomUUID } from "node:crypto";

/** base64 bytes of ONE chunk's `data`. Kept well under `peer.ts`'s 256 KiB frame cap so a chunk plus
 *  its JSON-RPC envelope never risks tripping that ceiling on its own. */
export const IMAGE_STAGE_CHUNK_MAX = 128 * 1024;
/** PNG and JPEG ONLY — the formats the shared validator can actually read (re-review r3). `validateImageBlock`
 *  resolves dimensions with `pngDimensions(decoded) ?? jpegDimensions(decoded)`; anything else returns
 *  `unreadable image data`, so allowlisting GIF/WebP here would accept a stage at the handler and then fail it
 *  at completion with a confusing reason. Narrowing is also honest PARITY inside ccx: the F9 host stage path
 *  (`src/host/ops.ts:63` takes `mediaType: z.string().min(1)` with no allowlist at all) already strands a GIF
 *  the same way, because its bytes reach the same normalizer. See Spec-drift note 8 for the follow-up. */
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg"] as const;
export const MAX_STAGES_PER_CONNECTION = 4;
export const MAX_STAGED_BYTES_GLOBAL = 32 * 1024 * 1024;    // across ALL connections (round-2 F7:
export const MAX_STAGES_GLOBAL = 64;                        // per-connection caps alone are unbounded
                                                             // under unbounded connections)
export const STAGE_IDLE_MS = 60_000;                        // since the LAST chunk
export const STAGE_ABSOLUTE_MS = 600_000;                   // 10 min per stage, from the first chunk

/** A single JSON-RPC-agnostic refusal code every `chunk()` failure carries. The wire mapping to a real
 *  JSON-RPC error code is the handler's job (Task 10) — this registry has no wire, so it needs SOME
 *  numeric code to satisfy `StageResult`'s shape today without inventing a wire contract early. */
const STAGE_REFUSAL_CODE = -32602; // "Invalid params" (JSON-RPC's own generic client-error code)

/** ONE chunk of a staged image, as the REGISTRY sees it. Declared HERE, in the module that consumes it, so
 *  this task typechecks and commits alone (re-review r3: the r2 draft referenced this name from Task 10's Zod
 *  schema, which does not exist yet at this point in the branch). Task 10's `imageStageParams` must then be
 *  shown to SATISFY this DTO rather than replace it — one shape, declared once, asserted at the wire. */
export interface ImageStageChunk {
  stageId: string;
  seq: number;
  last: boolean;
  /** Total BASE64 bytes the client will send for this stage, declared on every chunk. */
  bytesTotal: number;
  /** REQUIRED on `seq: 0` and validated against IMAGE_MEDIA_TYPES there; ignored on later chunks. Optional in
   *  the type because `seq` is a number, not a discriminant — the registry enforces the rule, not the shape. */
  mediaType?: string;
  data: string;
}

/** What a COMPLETED stage holds. Validation and canonicalization happen ONCE, at completion (round-3 F5),
 *  through the injected validator. `decodedBytes` rides along so the per-turn aggregate can be closed from
 *  the CACHE — the reservation path must never decode again (plan-review r2 F-STAGE). `charge` is the
 *  serialized-queue cost of the CANONICAL block (`Buffer.byteLength(JSON.stringify(block), "utf8")`) — the
 *  same unit `appserver/queue.ts`'s `MAX_QUEUED_BYTES` accounting uses, so a caller admitting a turn onto
 *  that queue (Task 12) can fold a reservation's summed `charge` straight into its own byte budget without
 *  re-serializing anything. */
export interface CompletedStage { block: UserContentBlock; decodedBytes: number; charge: number }

/** An EXCLUSIVE reservation (plan-review r2 F-STAGE). The earlier `claim`/`commit` pair could not express
 *  rollback: queue admission happens AFTER the claim, so a refused admission either wedged the stage
 *  forever (if claim reserved) or let two concurrent requests consume the same stage (if it did not).
 *  A reservation takes the stages out of circulation, and exactly one of `commit`/`abort` releases it. */
export interface StageReservation {
  readonly token: string;
  /** The cached, already-canonical blocks, in the order the ids were given. */
  readonly blocks: readonly UserContentBlock[];
  readonly decodedBytes: number;   // summed, from the cache
  readonly charge: number;         // summed serialized-queue bytes, from the cache
}

export type StageResult =
  | { ok: true; complete: false }
  | { ok: true; complete: true }
  | { ok: false; code: number; message: string };

/** Everything time- or policy-dependent is injected, so every cell below is deterministic and the
 *  validate-once contract is observable with a spy rather than inferred. */
export interface ImageStageDeps {
  now?: () => number;
  /** Defaults to `validateImageBlock` (Task 2). ONE image, ONE decode. */
  validate?: (block: UserContentBlock & { type: "image" }) => ReturnType<typeof validateImageBlock>;
}

/** In-flight or completed state of one stage, keyed by `${connId}:${stageId}` (a client's own stageId
 *  string is only unique WITHIN its connection). `firstChunkAt`/`lastChunkAt` are never touched by
 *  reserve/abort — that is what lets `abort` restore the ORIGINAL deadlines instead of resetting the
 *  clock (invariant (b) below). */
interface StageEntry {
  connId: number;
  stageId: string;
  bytesTotal: number;
  mediaType: string;       // captured once, from seq 0; later chunks' mediaType is ignored
  assembled: string;       // concatenated base64 received so far (the raw, pre-canonical bytes)
  nextSeq: number;
  complete: boolean;
  completed?: CompletedStage;   // set exactly once, when `complete` first becomes true
  reservedToken?: string;
  firstChunkAt: number;
  lastChunkAt: number;
}

interface ReservationRecord { connId: number; keys: readonly string[] }

/** Two invariants a later edit could quietly break, so they are stated here rather than left implicit:
 *   (a) `reserve` reads `CompletedStage.block` off the cache and NEVER calls `deps.validate` — the only
 *       call site for the validator in this whole file is `settleIfComplete`, at completion.
 *   (b) `sweep` skips every entry with a `reservedToken` set, and `abort` clears that token WITHOUT
 *       touching `firstChunkAt`/`lastChunkAt` — a reservation pauses eligibility for expiry, it does not
 *       reset the clock that decides it. */
export class ImageStageRegistry {
  private readonly now: () => number;
  private readonly validate: (block: UserContentBlock & { type: "image" }) => ReturnType<typeof validateImageBlock>;
  private readonly stages = new Map<string, StageEntry>();          // `${connId}:${stageId}` → entry
  private readonly connStages = new Map<number, Set<string>>();     // connId → its own stageIds (local, not the composite key)
  private readonly reservations = new Map<string, ReservationRecord>();
  private stagedBytes = 0;

  constructor(deps?: ImageStageDeps) {
    this.now = deps?.now ?? Date.now;
    this.validate = deps?.validate ?? validateImageBlock;
  }

  private key(connId: number, stageId: string): string { return `${connId}:${stageId}`; }
  private refuse(message: string): StageResult { return { ok: false, code: STAGE_REFUSAL_CODE, message }; }
  private connCount(connId: number): number { return this.connStages.get(connId)?.size ?? 0; }

  private addToConn(connId: number, stageId: string): void {
    let set = this.connStages.get(connId);
    if (!set) { set = new Set(); this.connStages.set(connId, set); }
    set.add(stageId);
  }
  private removeFromConn(connId: number, stageId: string): void {
    const set = this.connStages.get(connId);
    if (!set) return;
    set.delete(stageId);
    if (set.size === 0) this.connStages.delete(connId);
  }
  /** The ONE place a stage entry leaves `this.stages` — always paired with releasing its bytes and its
   *  per-connection slot, so `stagedBytes`/`stats()` can never drift from what `this.stages` actually holds. */
  private deleteEntry(key: string, entry: StageEntry): void {
    this.stages.delete(key);
    this.stagedBytes -= entry.assembled.length;
    this.removeFromConn(entry.connId, entry.stageId);
  }

  /** Feeds one chunk. Refuses BEFORE any allocation when `bytesTotal` exceeds MAX_BASE64_INPUT_BYTES, when
   *  `data` exceeds IMAGE_STAGE_CHUNK_MAX, on a bad/missing first-chunk mediaType, on an out-of-order or
   *  duplicate `seq`, on assembled bytes exceeding `bytesTotal`, and on any of the four caps. On the LAST
   *  chunk it runs the injected validator exactly once and caches the result; a stage whose bytes are not
   *  a decodable image FAILS HERE, with the reason on the completion reply — never at reservation. */
  chunk(connId: number, p: ImageStageChunk): StageResult {
    if (p.data.length > IMAGE_STAGE_CHUNK_MAX) return this.refuse(`chunk data exceeds the ${IMAGE_STAGE_CHUNK_MAX}-byte limit`);
    if (p.bytesTotal > MAX_BASE64_INPUT_BYTES) return this.refuse(`bytesTotal exceeds the ${MAX_BASE64_INPUT_BYTES}-byte limit`);

    const key = this.key(connId, p.stageId);
    const existing = this.stages.get(key);

    if (!existing) {
      if (p.seq !== 0) return this.refuse(`unknown stage "${p.stageId}" cannot resume at seq ${p.seq}`);
      if (typeof p.mediaType !== "string" || !(IMAGE_MEDIA_TYPES as readonly string[]).includes(p.mediaType)) {
        return this.refuse(`first chunk of stage "${p.stageId}" needs a mediaType in [${IMAGE_MEDIA_TYPES.join(", ")}]`);
      }
      if (p.data.length > p.bytesTotal) return this.refuse(`assembled bytes exceed the declared bytesTotal for stage "${p.stageId}"`);
      if (this.connCount(connId) >= MAX_STAGES_PER_CONNECTION) return this.refuse(`connection already has ${MAX_STAGES_PER_CONNECTION} stages open`);
      if (this.stages.size >= MAX_STAGES_GLOBAL) return this.refuse(`${MAX_STAGES_GLOBAL} stages are already open globally`);
      if (this.stagedBytes + p.data.length > MAX_STAGED_BYTES_GLOBAL) return this.refuse(`staging this chunk would exceed the ${MAX_STAGED_BYTES_GLOBAL}-byte global staging budget`);

      const t = this.now();
      const entry: StageEntry = {
        connId, stageId: p.stageId, bytesTotal: p.bytesTotal, mediaType: p.mediaType,
        assembled: p.data, nextSeq: 1, complete: p.last, firstChunkAt: t, lastChunkAt: t,
      };
      this.stages.set(key, entry);
      this.addToConn(connId, p.stageId);
      this.stagedBytes += p.data.length;
      return this.settleIfComplete(key, entry);
    }

    if (existing.reservedToken) return this.refuse(`stage "${p.stageId}" is reserved`);
    if (existing.complete) return this.refuse(`stage "${p.stageId}" is already complete`);
    if (p.seq !== existing.nextSeq) return this.refuse(`stage "${p.stageId}" expected seq ${existing.nextSeq}, got ${p.seq}`);
    if (existing.assembled.length + p.data.length > existing.bytesTotal) return this.refuse(`assembled bytes exceed the declared bytesTotal for stage "${p.stageId}"`);
    if (this.stagedBytes + p.data.length > MAX_STAGED_BYTES_GLOBAL) return this.refuse(`staging this chunk would exceed the ${MAX_STAGED_BYTES_GLOBAL}-byte global staging budget`);

    existing.assembled += p.data;
    existing.nextSeq++;
    existing.lastChunkAt = this.now();
    this.stagedBytes += p.data.length;
    if (p.last) existing.complete = true;
    return this.settleIfComplete(key, existing);
  }

  /** Runs the injected validator EXACTLY ONCE, the instant a stage's `complete` flag first goes true —
   *  never again after (invariant (a): `reserve` only ever reads the cached `completed`). A stage that
   *  fails validation is deleted immediately: it never occupies a slot waiting to be reserved and fail
   *  again, and its bytes are released right away rather than waiting for a sweep. */
  private settleIfComplete(key: string, entry: StageEntry): StageResult {
    if (!entry.complete) return { ok: true, complete: false };
    if (entry.completed) return { ok: true, complete: true }; // already settled (defensive; chunk() never re-enters here)
    const block: UserContentBlock & { type: "image" } = { type: "image", source: { type: "base64", media_type: entry.mediaType, data: entry.assembled } };
    const verdict = this.validate(block);
    if (!verdict.ok) {
      this.deleteEntry(key, entry);
      return this.refuse(verdict.reason);
    }
    const charge = Buffer.byteLength(JSON.stringify(verdict.block), "utf8");
    entry.completed = { block: verdict.block, decodedBytes: verdict.decodedBytes, charge };
    return { ok: true, complete: true };
  }

  private isExpired(entry: StageEntry, now: number): boolean {
    return now - entry.lastChunkAt > STAGE_IDLE_MS || now - entry.firstChunkAt > STAGE_ABSOLUTE_MS;
  }

  /** ATOMIC and EXCLUSIVE: takes every id or NONE, and the taken stages are unreservable until the token
   *  is settled. Returns the CACHED blocks — no decode happens on this path. */
  reserve(connId: number, stageIds: readonly string[]): { ok: true; reservation: StageReservation } | { ok: false; message: string } {
    const now = this.now();
    const entries: StageEntry[] = [];
    for (const id of stageIds) {
      const entry = this.stages.get(this.key(connId, id));
      if (!entry) return { ok: false, message: `unknown or incomplete stage "${id}"` };
      if (entry.reservedToken) return { ok: false, message: `stage "${id}" is already reserved` };
      if (!entry.complete || !entry.completed) return { ok: false, message: `unknown or incomplete stage "${id}"` };
      if (this.isExpired(entry, now)) return { ok: false, message: `stage "${id}" has expired` };
      entries.push(entry);
    }
    const token = randomUUID();
    for (const e of entries) e.reservedToken = token;
    this.reservations.set(token, { connId, keys: stageIds.map((id) => this.key(connId, id)) });
    const blocks = entries.map((e) => e.completed!.block);
    const decodedBytes = entries.reduce((n, e) => n + e.completed!.decodedBytes, 0);
    const charge = entries.reduce((n, e) => n + e.completed!.charge, 0);
    return { ok: true, reservation: { token, blocks, decodedBytes, charge } };
  }

  /** Settles a reservation by consuming it: the stages are deleted and their bytes released. Called only
   *  once the turn has actually been admitted. Unknown/settled token → throws (a programming error). */
  commit(token: string): void {
    const record = this.reservations.get(token);
    if (!record) throw new Error(`commit: unknown or already-settled reservation token "${token}"`);
    for (const key of record.keys) {
      const entry = this.stages.get(key);
      if (entry) this.deleteEntry(key, entry);
    }
    this.reservations.delete(token);
  }

  /** Settles a reservation by RELEASING it: the stages return to circulation and keep their original
   *  deadlines — a refused queue admission or a capability refusal costs the client nothing but a retry. */
  abort(token: string): void {
    const record = this.reservations.get(token);
    if (!record) throw new Error(`abort: unknown or already-settled reservation token "${token}"`);
    for (const key of record.keys) {
      const entry = this.stages.get(key);
      if (entry) entry.reservedToken = undefined;   // deadlines untouched — see class-level note (b)
    }
    this.reservations.delete(token);
  }

  /** Idle + absolute expiry sweep. A RESERVED stage is never swept; its deadline resumes on abort. */
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of Array.from(this.stages)) {
      if (entry.reservedToken) continue;
      if (this.isExpired(entry, now)) this.deleteEntry(key, entry);
    }
  }

  /** Drops every stage entry for `connId` (via `deleteEntry`, whether or not it is reserved — a reservation
   *  does not shield a stage from its OWN connection dying) AND every `ReservationRecord` opened by that
   *  connection. The second half is required, not optional: once the stage entries are gone, no caller can
   *  ever `commit`/`abort` a token minted on this connection, so a record left in `this.reservations` would
   *  sit there forever — unbounded growth under repeated connect→reserve→disconnect cycles that none of the
   *  stage-side caps bound, because the stage entries themselves ARE reclaimed above. */
  dropConnection(connId: number): void {
    const ids = this.connStages.get(connId);
    if (ids) {
      for (const stageId of Array.from(ids)) {
        const key = this.key(connId, stageId);
        const entry = this.stages.get(key);
        if (entry) this.deleteEntry(key, entry);
      }
    }
    for (const [token, record] of Array.from(this.reservations)) {
      if (record.connId === connId) this.reservations.delete(token);
    }
  }

  /** READ-ONLY, for tests and for the server's own logging. Never a mutation seam. `reservedCount` counts
   *  stage ENTRIES still holding a token (drops to 0 once `dropConnection` deletes them); `reservationCount`
   *  counts outstanding entries in `this.reservations` itself — the two can diverge only as a leak signal,
   *  since every live reservation's stages are still in `this.stages` until commit/abort/dropConnection. */
  stats(): { stagedBytes: number; stageCount: number; reservedCount: number; reservationCount: number; connections: number } {
    let reservedCount = 0;
    for (const entry of this.stages.values()) if (entry.reservedToken) reservedCount++;
    return { stagedBytes: this.stagedBytes, stageCount: this.stages.size, reservedCount, reservationCount: this.reservations.size, connections: this.connStages.size };
  }
}
