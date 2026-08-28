// appserver/schema/peer.ts — M8's two methods. Each publishes a `result` (M5's D-M5-19): these are new,
// so there is no incremental-adoption excuse for omitting one.
import { z } from "zod/v4";
import { okResult } from "./core.js";

/** The three values the CLI's own `crossSessionInbound` setting takes, consumed by the two admission
 *  spines (`threadStartParams`/`threadResumeParams`) and by the runtime setter below. */
export const CROSS_SESSION_INBOUND = ["accept", "hold", "refuse"] as const;

const peerRow = z.object({
  address: z.string(),
  sessionId: z.string().optional(),
  pid: z.number().int(),
  entrypoint: z.string().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
  cwd: z.string().optional(),
  version: z.string().optional(),
  peerProtocol: z.number().int().optional(),
  peerFeatures: z.array(z.string()).optional(),
  alive: z.boolean(),
  inboxBound: z.boolean(),
  threadId: z.string().optional(),
  // Declared, not merely described: a client cannot implement "this peer can never answer" from prose.
  statusReachable: z.boolean(),
});

export const peerListParams = z.object({ aliveOnly: z.boolean().optional() });
export const peerListResult = z.object({ peers: z.array(peerRow) });

/** No `asMode`, and that absence is the security property: `from-mode` is always "prompting", decided by
 *  the gateway's own nature rather than by anything a caller can say. `fromThreadId` is ATTRIBUTION only —
 *  it sets from-session and from-name and touches the class not at all. */
export const peerSendParams = z.object({
  target: z.string().min(1),
  message: z.string().min(1),
  priority: z.enum(["now", "next", "later"]).optional(),
  fromThreadId: z.string().min(1).optional(),
});

/** `delivered` is a literal false, not a status: this method reports that the frame was WRITTEN. The CLI
 *  tells a sender nothing on the success path, so any other value would be the wire's own lie. */
export const peerSendResult = z.object({
  msgId: z.string(),
  address: z.string(),
  targetSessionId: z.string().optional(),
  delivered: z.literal(false),
  statusReachable: z.boolean(),
});

/** The runtime policy setter's params. `value` is the WHOLE policy, not a delta — the same enum admission
 *  takes, so a client writes one vocabulary either way.
 *
 *  THE SCHEMA CANNOT STATE THE RATCHET, and that is why the handler does. Probes 120/120b measured the
 *  live flag layer in both directions: every tightening move (`accept` > `hold` > `refuse`, ordered by
 *  permissiveness) took effect on the very next inbound message, and every loosening move was ignored in
 *  silence. A params schema has no access to the thread's current value, so `accept` is a legal REQUEST
 *  here and is refused `-32602` by `crossSessionInboundSet` (appserver/settings.ts) whenever the thread
 *  already sits somewhere stricter. Publishing the enum whole is the honest shape: the value space is the
 *  CLI's three, and which of them this thread may still move to depends on where it is. */
export const crossSessionInboundSetParams = z.object({
  threadId: z.string().min(1),
  value: z.enum(CROSS_SESSION_INBOUND),
});
/** The shared `{ok:true}`, not a private copy: this method reports acceptance and announces the value
 *  itself on `thread/settings/changed`, exactly as the other settings setters do. */
export const crossSessionInboundSetResult = okResult;
