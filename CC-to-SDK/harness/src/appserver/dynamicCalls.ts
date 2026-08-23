// appserver/dynamicCalls.ts — M7: a dynamic tool call is a PARKED PROMISE, and this is the registry that
// holds it. The model calls a client-declared tool, the MCP handler parks here, the call travels to the
// thread's subscribers as `tool/callRequested`, and whichever of them answers `tool/callResult` first
// resolves the promise the model has been blocked on all along.
//
// DELIBERATELY THE SAME SHAPE AS `ThreadDecisions` (broker.ts:42), which was read before this was written.
// M1 already solved "an in-process await that only a remote client can settle", and every hard-won rule
// there applies verbatim here, so the two read as one idea rather than two:
//
//   ONE INSTANCE PER THREAD, minted beside the decisions registry and released with it.
//   PARKS SURVIVE ZERO CLIENTS. Nothing expires; a detach-first server parks forever and replays on attach.
//   THE PROMISE AND THE NOTIFICATION SETTLE OFF THE SAME CALL, so a client can never see one without the
//   other, and one settlement announces exactly once.
//   `reset` vs `teardown` IS THE LATCH, and only the latch. A reopen/swap/interrupt settles what is parked
//   and stays open, because the SAME registry object serves the replacement engine and latching it would
//   auto-cancel every later call with nothing on the wire saying why. A close settles AND latches, because
//   a late engine callback arriving after close would otherwise park with nobody left to answer it.
//
// TWO THINGS ARE NOT INHERITED FROM `ThreadDecisions`, both because a tool call is answered by identity
// rather than by kind:
//
//   THE callId IS OPAQUE — `dyncall:<randomUUID()>`. It is a settlement AUTHORITY, not a label: `tool/
//   callResult` checks subscription first, and unguessability is the second belt behind it. Nothing
//   derives it from the tool name, the turn, or a counter.
//
//   SETTLEMENTS ARE REMEMBERED, in a 128-deep ring. `unknown` ("no such pending tool call", -32602) and
//   `alreadySettled` (-33002) are different facts for a client — one says its state is wrong, the other
//   says it lost a race — and without a memory of what this registry really did settle, every late answer
//   would read as the first. The ring bounds that memory; past it the discrimination degrades to `unknown`
//   (never to a false `ok`, which is what matters), and a randomUUID id can never be re-minted, so the
//   eviction can only ever cost the nicer message.
//
// EVERY EXIT ANSWERS THE MODEL (D-M4-9). A cancelled settle resolves an `isError` result whose note names
// the reason, because that note is the whole of what the model learns about the cancellation.
import { randomUUID } from "node:crypto";

/** The wire's result content items (camelCase, mirroring `turn/start`'s input items) — converted to MCP
 *  content blocks by `toCallResult` in `dynamicTools.ts`. */
export type ToolCallContentItem =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string }
  | { type: "inputAudio"; audioUrl: string };

/** A parked call, exactly as `tool/callRequested` announces it and `subscribe` replays it. `turnId` is
 *  REQUIRED, not optional: a dynamic tool call only ever originates inside a model turn, so a park that
 *  cannot name its turn is a bug at the caller, not a call with a missing field. `epoch` is the engine
 *  generation the park belongs to — see `respond`. */
export type PendingToolCall = {
  callId: string;
  threadId: string;
  turnId: string;
  namespace?: string;
  tool: string;
  arguments: Record<string, unknown>;
  epoch: number;
};

/** The MCP `CallToolResult` as far as this layer cares: opaque content blocks plus the error flag. Kept
 *  structural rather than importing the SDK's type — nothing here inspects a block, and the conversion
 *  that BUILDS them (`toCallResult`) is the one place their shape is decided. */
export type CallToolResultLike = { content: Array<Record<string, unknown>>; isError?: boolean };

export type DynamicCallEvent = { kind: "requested"; entry: PendingToolCall } | { kind: "settled"; callId: string };

/** How many settled callIds stay discriminable. */
const TOMBSTONE_LIMIT = 128;

/** The ONE cancelled shape, exported because Task 4 cancels some calls WITHOUT the registry ever seeing
 *  them (a stale engine generation, an interrupted turn, no active turn) and those cancellations must be
 *  indistinguishable from these to the model. */
export function cancelledCallResult(reason: string): CallToolResultLike {
  return { content: [{ type: "text", text: `Tool call cancelled: ${reason}` }], isError: true };
}

/** What an aborted park is called in its note. The `signal` a park carries belongs to the engine's own
 *  call, so its abort means the runtime gave up on the tool call — a different fact from the thread-level
 *  reasons `reset`/`teardown` name. */
const ABORT_REASON = "aborted";

type Live = { entry: PendingToolCall; resolve: (result: CallToolResultLike) => void; cancel: () => void };

export class DynamicCalls {
  private live = new Map<string, Live>();
  private ring: string[] = [];                   // settled callIds, oldest first
  private ringSet = new Set<string>();           // the same ids, for O(1) discrimination
  private closed = false;                        // set by teardown(); latches, see the header
  private closedReason = "";

  constructor(private emit: (ev: DynamicCallEvent) => void) {}

  /** Park a call and hand back the promise the MCP handler returns to the engine. Synchronous up to the
   *  announcement: by the time this returns, the entry lists and the `requested` event has fired, so a
   *  caller can never observe a call that exists but has not been announced. */
  park(entry: Omit<PendingToolCall, "callId">, signal?: AbortSignal): Promise<CallToolResultLike> {
    if (this.closed) return Promise.resolve(cancelledCallResult(this.closedReason));
    // An `abort` listener added to an ALREADY-aborted signal never fires, so a pre-aborted park would sit
    // in `live` forever, awaited by nobody and answerable by anybody.
    if (signal?.aborted) return Promise.resolve(cancelledCallResult(ABORT_REASON));

    const callId = `dyncall:${randomUUID()}`;
    const full: PendingToolCall = { ...entry, callId };
    const settled = new Promise<CallToolResultLike>((resolve) => {
      const onAbort = () => this.settle(callId, cancelledCallResult(ABORT_REASON));
      signal?.addEventListener("abort", onAbort, { once: true });
      this.live.set(callId, { entry: full, resolve, cancel: () => signal?.removeEventListener("abort", onAbort) });
    });
    // Announced OUTSIDE the executor: a throwing emit (the broadcast is somebody else's code) would
    // otherwise reject the promise the model is awaiting instead of surfacing at the caller.
    this.emit({ kind: "requested", entry: full });
    return settled;
  }

  /** Answer a parked call. `epochNow` is the record's CURRENT engine generation, and a live entry stamped
   *  with a different one is refused rather than settled — the belt behind the swap's own `reset()`, which
   *  normally clears these first. Refusing (not settling) is deliberate: the entry stays parked so the
   *  reset that is coming still settles it exactly once, with a reason naming the swap. */
  respond(callId: string, epochNow: number, result: CallToolResultLike): { ok: true } | { ok: false; code: "unknown" | "alreadySettled" } {
    const live = this.live.get(callId);
    if (!live) return { ok: false, code: this.ringSet.has(callId) ? "alreadySettled" : "unknown" };
    if (live.entry.epoch !== epochNow) return { ok: false, code: "alreadySettled" };
    this.settle(callId, result);
    return { ok: true };
  }

  /** The parked calls, in park order — `tool/callRequested`'s replay on subscribe, and `threadStatus`'s
   *  tool-call waiter kind. By reference, as `ThreadDecisions.pending()` is. */
  pending(): PendingToolCall[] {
    return [...this.live.values()].map((p) => p.entry);
  }

  /** Reopen / engine swap / interrupt: settle everything parked as cancelled, naming the reason, and stay
   *  OPEN. See the header for why the latch is the whole distinction from `teardown`. */
  reset(reason: string): void {
    // A fresh result per call, not one shared object: these travel to different awaiters, and a shared
    // `content` array would make one consumer's handling of its result visible in everyone else's.
    for (const callId of [...this.live.keys()]) this.settle(callId, cancelledCallResult(reason));
  }

  /** Thread close / shutdown: `reset` plus the latch, after which a park answers cancelled IMMEDIATELY
   *  with this same reason rather than joining a registry nobody is listening to. */
  teardown(reason: string): void {
    this.closed = true;
    this.closedReason = reason;
    this.reset(reason);
  }

  /** The one settlement path — every exit above funnels through it, so the tombstone, the resolve and the
   *  announcement can never come apart. */
  private settle(callId: string, result: CallToolResultLike): void {
    const live = this.live.get(callId);
    if (!live) return;
    live.cancel();
    this.live.delete(callId);
    this.ring.push(callId);
    this.ringSet.add(callId);
    if (this.ring.length > TOMBSTONE_LIMIT) this.ringSet.delete(this.ring.shift()!);
    live.resolve(result);
    this.emit({ kind: "settled", callId });
  }
}
