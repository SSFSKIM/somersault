// appserver/schema/peer.ts — M8's two methods. Each publishes a `result` (M5's D-M5-19): these are new,
// so there is no incremental-adoption excuse for omitting one.
import { z } from "zod/v4";

/** The three values the CLI's own `crossSessionInbound` setting takes. It has no method of its own: the
 *  policy is decided at ADMISSION (appserver/peerPolicy.ts), so this enum is consumed by
 *  `threadStartParams`/`threadResumeParams` rather than by a setter's params. */
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
