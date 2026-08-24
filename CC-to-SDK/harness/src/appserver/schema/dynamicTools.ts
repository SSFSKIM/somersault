// appserver/schema/dynamicTools.ts — M7: the wire shape of `tool/callResult`, the method a client's tool
// runtime settles a parked dynamic tool call with.
//
// DEFINED HERE, REGISTERED NOWHERE YET. `schema/index.ts` does not import this file: registering
// `tool/callResult` before the DECLARATION half exists would publish a stable method no client can
// legitimately reach — there is no way to obtain a `callId` until a thread can declare tools. Task 8
// registers `{ params: toolCallResultParams, result: toolCallResultResult }` beside the declaration
// exposure and regenerates the published artifact in that same change.
//
// WHAT THIS SCHEMA DELIBERATELY DOES NOT CHECK is the interesting part. A settlement is an ANSWER, and an
// answer must always land: every refusal here is a -32602 raised BEFORE the handler, which leaves the call
// parked while the client believes it has answered — the model then waits forever (D-M4-9). So the media
// URLs are plain strings (no `startsWith("data:")`), and `contentItems` carries no count bound. Parsing,
// the MIME-family rule and both result caps live in `toCallResult` (dynamicTools.ts), which converts what
// it can and settles the rest as an `isError` result naming the problem. What IS refused here is only what
// makes the request unanswerable in the first place: a missing or empty identity, or an item that is not
// one of the three kinds at all.
import { z } from "zod/v4";
import { MAX_IN } from "../peer.js";
import { MAX_RESULT_ITEMS, MAX_RESULT_PAYLOAD_BYTES } from "../dynamicTools.js";
import type { ToolCallContentItem } from "../dynamicCalls.js";

/** The result's content items — camelCase, mirroring `turn/start`'s INPUT items so a client writes one
 *  item vocabulary for both directions. */
const contentItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("inputText"), text: z.string() }),
  z.object({ type: z.literal("inputImage"), imageUrl: z.string() }),
  z.object({ type: z.literal("inputAudio"), audioUrl: z.string() }),
]);

/** The schema/registry type match, asserted rather than described — the union above and the registry's
 *  `ToolCallContentItem` are written in different files and nothing else makes them move together
 *  (schema/turns.ts's `inputItem` guard is the precedent, including this deferred-conditional identity
 *  trick: a mutual `extends` would pass for a union that gained a member on one side only). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const _contentItemMatches: Equal<z.infer<typeof contentItem>, ToolCallContentItem> = true;
void _contentItemMatches;

export const toolCallResultParams = z.object({
  threadId: z.string().min(1),
  // OPAQUE and unguessable (`dyncall:<uuid>`) — it is a settlement AUTHORITY, not a label. The server
  // checks subscription first and this second; nothing derives it from the tool name or the turn.
  callId: z.string().min(1),
  contentItems: z.array(contentItem)
    .describe(`The result caps do NOT refuse this method: over ${MAX_RESULT_ITEMS} items, or over ${MAX_RESULT_PAYLOAD_BYTES} UTF-8 bytes of emitted content, still returns {} and settles the call with an isError result naming the cap — as does a media URL that is not a base64 \`data:\` URL of the right MIME family (image/* for inputImage, audio/* for inputAudio). The caps also do NOT multiply: whatever they allow, the whole request must still fit the ${MAX_IN / 1024} KiB inbound frame cap AFTER JSON escaping, which inflates control characters roughly sixfold. A frame over that cap is refused as a parse error (-32700) with a NULL id before this method is reached — the call is then still parked and still answerable, so the recovery is to retry the same callId with a smaller result.`),
  // The client's own tool outcome, not the transport's: `false` keeps the content and marks it `isError`.
  success: z.boolean(),
});

/** The acknowledgment, published because the registry supports result schemas and the stable artifact
 *  emits a `results` map — a generated client must be able to validate what it gets back. `{}` is the
 *  whole of it: the method's effect is the settlement, and everything a client could want to know about
 *  that (who won, what the model saw) is either an error code or a later notification. */
export const toolCallResultResult = z.object({}).strict();
