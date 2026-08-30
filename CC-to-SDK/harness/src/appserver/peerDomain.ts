// appserver/peerDomain.ts — `peer/list` and `peer/send`. Both are SERVER-scoped: they name no thread, so
// they bypass the -33005 engine-gone and origin gates, exactly as `fleet/list` and `config/*` do.
import { randomUUID } from "node:crypto";
import { ERR } from "./rpc.js";
import type { AppServer, Handler } from "./server.js";
import { peerListParams, peerSendParams } from "./schema/peer.js";
import { buildEnvelope, envelopeBodies, MAX_FRAME_CHARS, parseAddress, sameNamespace, UNSAFE_ATTR_CHARS } from "../peer/address.js";
import { peerTokenFor, type PeerRow } from "../peer/roster.js";

/** Rows plus the two things only this server can add: which of them it holds, and whether a status could
 *  ever come back from them. */
async function rows(srv: AppServer): Promise<Array<PeerRow & { threadId?: string; statusReachable: boolean }>> {
  const gw = srv.gateway();
  const held = new Map<string, string>();
  for (const r of srv.registry.list()) if (r.sessionId) held.set(r.sessionId, r.id);
  const raw = await srv.peerRows();
  return raw.map((r) => {
    const parsedAddr = parseAddress(r.address);
    const reachable = Boolean(gw) && parsedAddr?.kind === "uds" && sameNamespace(parsedAddr.path, gw!.socketPath);
    const threadId = r.sessionId ? held.get(r.sessionId) : undefined;
    return { ...r, ...(threadId ? { threadId } : {}), statusReachable: reachable };
  });
}

export const peerList: Handler = async (srv, ctx, id, params) => {
  const parsed = peerListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const all = await rows(srv);
  ctx.peer.reply(id, { peers: parsed.data.aliveOnly ? all.filter((p) => p.alive) : all });
};

export const peerSend: Handler = async (srv, ctx, id, params) => {
  const parsed = peerSendParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const gw = srv.gateway();
  if (!gw) { ctx.peer.replyError(id, ERR.ATTACH_FAILED, "peer gateway unavailable — this server bound no reply address"); return; }
  const { target, message, priority, fromThreadId } = parsed.data;

  const direct = parseAddress(target);
  if (direct?.kind === "bridge") { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "bridge: addresses are the cross-machine path and are not supported"); return; }

  // Resolution copies `thread/attach`'s rule exactly: a SIMULTANEOUS filter, where more than one match is
  // an error carrying the matches rather than a precedence. A wrong guess delivers into somebody else's
  // session, which no default is worth.
  const all = await rows(srv);
  const matches = all.filter((p) => p.sessionId === target || String(p.pid) === target || p.address === target || p.name === target);
  if (matches.length === 0) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, `no peer matches ${JSON.stringify(target)}`); return; }
  if (matches.length > 1) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, `ambiguous target ${JSON.stringify(target)}: ${matches.map((m) => m.address).join(", ")}`); return; }
  const peer = matches[0];
  const addr = parseAddress(peer.address);
  if (addr?.kind !== "uds") { ctx.peer.replyError(id, ERR.INVALID_PARAMS, `peer has no usable address: ${peer.address}`); return; }

  // Attribution ONLY. `from` stays the gateway's address (receipts come back over a connection whose pid
  // the kernel checks, so no other value could receive them) and `from-mode` is decided by the envelope
  // builder, which offers no way to ask for anything but "prompting".
  let fromSession: string | undefined;
  let fromName: string | undefined;
  if (fromThreadId) {
    const rec = srv.registry.get(fromThreadId);
    if (!rec) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
    if (rec.origin === "fleet") { ctx.peer.replyError(id, ERR.UNSUPPORTED_FOR_ORIGIN, "unsupported for fleet-origin threads"); return; }
    fromSession = rec.sessionId;
    fromName = rec.title;
  }
  for (const [what, value] of [["from-session", fromSession], ["from-name", fromName]] as const) {
    if (value !== undefined && UNSAFE_ATTR_CHARS.test(value)) {
      // Refusing beats sending: an unescapable character makes the receiver's parse-and-reserialize
      // disagree with ours, which silently downgrades the envelope to plain text and drops the
      // attribution — a permission decision made on wrong information.
      ctx.peer.replyError(id, ERR.INVALID_PARAMS, `${what} contains a character that cannot ride an envelope attribute`);
      return;
    }
  }

  const body = buildEnvelope({ from: gw.address, ...(fromSession ? { fromSession } : {}), ...(fromName ? { fromName } : {}) })(message);
  if (body.length > MAX_FRAME_CHARS) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, `message too large for cross-session delivery: ${body.length} characters, limit ${MAX_FRAME_CHARS}`);
    return;
  }

  // The sender's own decoder is the honest oracle for "will this body survive its wrapper": a message
  // carrying an unbalanced wrapper tag decodes back truncated, and refusing is recoverable where a silent
  // truncation is not (tracker 2026-08-30; the foreign-sender half of that entry has no fix we control).
  // The question is asked of a PAIR as well as of one envelope, because one envelope does not ask all of it:
  // a body holding an unclosed `<cross-session-message …>` opener decodes back intact ALONE (the decoder's
  // last-closing-tag salvage terminates it at the real terminator) and then swallows a neighbour's opening
  // tag once the receiver collapses two arrivals into one frame — the two-envelope row probe 121 measured,
  // where the merge destroys both bodies rather than one. A second copy is the cheapest frame that puts this
  // body beside a sibling it does not control. Balanced quotes of either grammar round-trip in both, so the
  // 52 measured envelope-quoting rows are untouched.
  const intact = (raw: string, count: number) => { const d = envelopeBodies(raw); return d.length === count && d.every((b) => b === message); };
  if (!intact(body, 1) || !intact(`${body}\n${body}`, 2)) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, "message contains an unbalanced <cross-session-message> tag and would be truncated in delivery; balance or remove it");
    return;
  }

  // A UUID, always, and never the client's: a non-UUID msg_id comes back with no `orig_msg_id` on the
  // receipt, so nothing correlates and the status channel silently stops working (probe 117b Q4).
  const msgId = randomUUID();
  const token = peerTokenFor(addr.path, peer.pid, srv.peerEnv());
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user",
    ...(peer.sessionId ? { session_id: peer.sessionId } : {}),
    from: gw.address,
    message: { content: body },
    priority: priority ?? "next",
    msg_id: msgId,
  });
  srv.receipts.track(msgId, ctx);
  await gw.sendFrames(addr.path, frames);
  ctx.peer.reply(id, {
    msgId,
    address: peer.address,
    ...(peer.sessionId ? { targetSessionId: peer.sessionId } : {}),
    delivered: false,
    statusReachable: peer.statusReachable,
  });
};
