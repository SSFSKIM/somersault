// appserver/turns.ts — turn lifecycle (spec: Turn -> Item; item/started -> deltas -> item/completed).
// Split out of server.ts per the plan's "extract before letting a hot file sprawl" rule. `turn/interrupt`:
// SDK Query.interrupt() is zero-arg at 0.3.220 (Task 1 finding, verified twice against sdk.d.ts) — no
// public method carries cancel_queued, and M1 has no server-side turn/queue (later milestone) to flush
// anyway. `cancelQueued` is accepted on the wire and silently unused; Task 12 records the scorecard gap.
import { z } from "zod/v4";
import { ERR } from "./rpc.js";
import { TurnMapper } from "./items/mapper.js";
import type { ItemEvent, ItemDeltaChannel } from "./items/types.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer, Handler } from "./server.js";

const turnStartParams = z.object({ threadId: z.string().min(1), input: z.string() });
const turnInterruptParams = z.object({ threadId: z.string().min(1), cancelQueued: z.boolean().optional() });

const BUFFER_CAP = 500; // Task 9 replays this bound — bounded last-turn buffer, drop-oldest

function pushBounded(buf: ItemEvent[], ev: ItemEvent): void {
  buf.push(ev);
  if (buf.length > BUFFER_CAP) buf.shift();
}

function deltaMethod(channel: ItemDeltaChannel): string {
  if (channel === "text") return "item/agentMessage/delta";
  if (channel === "thinking") return "item/reasoning/delta";
  return "item/toolCall/argumentsDelta";
}

function emitItems(srv: AppServer, record: ThreadRecord, turnId: string, events: ItemEvent[]): void {
  for (const ev of events) {
    pushBounded(record.buffer, ev);
    if (ev.kind === "started") srv.broadcast(record.id, "item/started", { threadId: record.id, turnId, item: ev.item });
    else if (ev.kind === "completed") srv.broadcast(record.id, "item/completed", { threadId: record.id, turnId, item: ev.item });
    else srv.broadcast(record.id, deltaMethod(ev.channel), { threadId: record.id, turnId, itemId: ev.itemId, delta: ev.delta });
  }
}

function statusChanged(srv: AppServer, record: ThreadRecord): void {
  srv.broadcast(record.id, "thread/status/changed", { threadId: record.id, status: record.busy ? "active" : "idle" });
}

export const turnStart: Handler = (srv, ctx, id, params) => {
  const parsed = turnStartParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // Gate synchronously, at request-arrival time — NOT deferred inside the chain callback below. A
  // same-tick second turn/start (two requests dispatched before any microtask runs) must see this
  // thread already claimed even when `submit()` happens to settle within the same microtask batch
  // as the chain callback's return (its completion `.then` would otherwise clear `busy` before the
  // second request's chain-deferred check ever ran — proven by turns.test.ts's busy-gate case).
  if (record.busy) { ctx.peer.replyError(id, ERR.BUSY, "Thread is busy"); return; }
  record.busy = true;
  // The chain still gates the mint+submit work below so it stays ordered after any prior
  // thread-scoped chain item (e.g. a queued thread/close finishing its dispose first).
  record.chain = record.chain.then(() => {
    const turnId = `turn_${record.id}_${++record.turnSeq}`;
    record.interruptRequested = false;
    const turn = { id: turnId, status: "inProgress" };
    ctx.peer.reply(id, { turn });
    statusChanged(srv, record);
    srv.broadcast(record.id, "turn/started", { threadId: record.id, turn });

    const mapper = new TurnMapper(); // one instance per turn — dropped at completion, never reused
    const onSuccess = () => {
      emitItems(srv, record, turnId, mapper.finalize(false));
      record.busy = false;
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: { id: turnId, status: "completed" } });
      statusChanged(srv, record);
    };
    const onFailure = (err: unknown) => {
      emitItems(srv, record, turnId, mapper.finalize(true));
      record.busy = false;
      const status = record.interruptRequested ? "interrupted" : "failed";
      const turn2: Record<string, unknown> = { id: turnId, status };
      if (status === "failed") turn2.error = String(err);
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: turn2 });
      statusChanged(srv, record);
    };
    record.session.submit(parsed.data.input, (m) => emitItems(srv, record, turnId, mapper.ingest(m)))
      .then(onSuccess, onFailure)
      // belt-and-suspenders: onSuccess/onFailure must never leave busy stuck or reject unhandled —
      // if either somehow throws, still clear busy and report failed rather than wedging the thread
      .catch((err) => {
        record.busy = false;
        srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: { id: turnId, status: "failed", error: String(err) } });
        statusChanged(srv, record);
      });
  });
};

export const turnInterrupt: Handler = async (srv, ctx, id, params) => {
  const parsed = turnInterruptParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.interruptRequested = true;
  await record.session.interrupt(); // zero-arg (see file header) — params.cancelQueued accepted, unused
  ctx.peer.reply(id, { interrupted: true });
};
