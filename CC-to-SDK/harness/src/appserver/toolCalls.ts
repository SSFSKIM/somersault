// appserver/toolCalls.ts — M7: `tool/callResult`, the one method a client uses to settle a parked dynamic
// tool call. The park side lives in `server.ts` (`parkToolCall`, the `tool/callRequested` broadcast) and
// the registry in `dynamicCalls.ts`; this is the wire half, kept out of `dynamicTools.ts` because that
// module is declaration semantics and result conversion and touches neither the wire nor `ThreadRecord`.
//
// NOT IN THE DISPATCH TABLE YET, deliberately. Until a thread can DECLARE tools there is no way to obtain
// a `callId`, so publishing the method would advertise a stable surface nothing can reach. Task 8 adds the
// dispatch entry and the schema registration together, in the one wire-visible commit.
//
// ORDER IS THE CONTRACT, and it is the reason this is a handful of lines with a long comment:
//
//   THREAD FIRST (-33004). A settlement names a thread; if that thread is gone there is nothing else true
//   to say about the request.
//
//   SUBSCRIPTION SECOND, BEFORE ANY REGISTRY LOOKUP (-32602). Settlement authority is subscribers-only,
//   and checking it ahead of the lookup is what keeps the opaque `callId` opaque: a non-subscriber holding
//   a real id and one holding a fabricated id get the SAME answer, so this method can never be used to
//   probe which calls exist. The unguessable id is the second belt, not the first.
//
//   CONVERSION LAST, AND IT ALWAYS ANSWERS. `toCallResult` never throws and never refuses — an over-cap or
//   malformed answer settles the call as `isError` and this method still replies `{}` (D-M4-9). The only
//   failures left are about the call's IDENTITY: unknown (-32602) and already-settled (-33002), which are
//   different facts a client acts on differently — "your state is wrong" versus "you lost the race".
import { ERR } from "./rpc.js";
import { toCallResult } from "./dynamicTools.js";
import { toolCallResultParams } from "./schema/dynamicTools.js";
import type { Handler } from "./server.js";

export const toolCallResult: Handler = (srv, ctx, id, params) => {
  const parsed = toolCallResultParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  const calls = srv.threadDynamicCalls(parsed.data.threadId);
  // Both or neither: the registry is minted with the record and dropped with it (server.ts's closeRecord),
  // so the pair is checked as one — decision/respond's own arm is the precedent.
  if (!record || !calls) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  if (!record.subscribers.has(ctx.peer)) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, "only a subscriber of this thread can settle its tool calls");
    return;
  }
  // `record.epoch` is the CURRENT generation — the registry refuses (rather than settles) an entry parked
  // under an older one, so a swap's own reset still answers it exactly once with a reason naming the swap.
  const outcome = calls.respond(parsed.data.callId, record.epoch, toCallResult(parsed.data.contentItems, parsed.data.success));
  if (!outcome.ok) {
    if (outcome.code === "alreadySettled") ctx.peer.replyError(id, ERR.ALREADY_SETTLED, "Already settled");
    else ctx.peer.replyError(id, ERR.INVALID_PARAMS, "no such pending tool call");
    return;
  }
  ctx.peer.reply(id, {});
};
