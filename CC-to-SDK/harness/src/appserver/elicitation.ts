// appserver/elicitation.ts — an MCP server's request for user input, PARKED as a decision.
//
// THE RULE IS "THE CALLBACK ALWAYS ANSWERS", not "the mapper never returns null". `OnElicitation`
// resolving null sends no response at all (sdk.d.ts:1300-1318), and a REJECTED promise hangs the MCP
// server in exactly the same way — for a `mode:"url"` auth elicitation that is a browser tab that never
// resolves. So the whole body sits inside one catch and every exit is a real `ElicitResult`.
//
// WHICH refusal each failure gets is a separate question, and the split follows D-M4-9's asymmetry.
// `cancel` ("dismissed without an explicit choice") is what a failure INSIDE US earns: a rejected park, a
// registry that is gone, an outcome the mapper cannot read — nobody decided anything there, and `decline`
// would report a refusal no human gave. `decline` ("the user explicitly declined") is for the one failure a
// human DID cause: an accept whose content the server would reject. That one is also definitive rather than
// retryable, which is the honest signal — sending the same answer again would fail the same way.
import { outcomeToElicitResult } from "./elicitationMap.js";
import type { PermissionBroker } from "../permissions/types.js";
import type { ElicitationRequest, OnElicitation } from "@anthropic-ai/claude-agent-sdk";

/** The one thing this bridge needs from the app server, looked up LAZILY at elicitation time rather than
 *  captured: `record.config` (this callback included) outlives the engine it was built for — a rewind or
 *  `thread/reopen` hands the same config to a replacement — so a captured registry would be the wrong one,
 *  or a closed thread's. Structural rather than the AppServer type so nothing here depends on server.ts. */
export interface ElicitationParkSource {
  threadDecisions(threadId: string): { broker(threadId: string): PermissionBroker } | undefined;
}

/** An `ElicitationRequest` carries no toolUseId and the park registry is keyed by one. `requestId` is the
 *  control envelope's own id — unique per request, and the value an out-of-band control_response would
 *  have to echo — so it is the one honest key. Prefixed so it cannot collide with a real tool_use id. */
export const elicitationKey = (requestId: string): string => `elicit:${requestId}`;

export function makeOnElicitation(srv: ElicitationParkSource, threadId: string): OnElicitation {
  return async (request, options) => {
    try {
      const decisions = srv.threadDecisions(threadId);
      if (!decisions) return { action: "cancel" }; // nothing left to park into; the server is still owed an answer
      const outcome = await decisions.broker(threadId).request({
        // No tool is involved, so the server name is the most useful thing a dialog can put in the slot a
        // tool name usually fills; everything else it needs to render lives in `input`, which is the one
        // free-form field a PendingDecision carries to the wire.
        toolName: request.serverName,
        kind: "elicitation",
        toolUseID: elicitationKey(options.requestId),
        input: { ...request },
        title: request.title, displayName: request.displayName, description: request.description,
        // The park's own abort listener settles on this (pending.ts), so an interrupted turn answers its
        // MCP server too instead of leaving the promise — and this callback — unresolved.
        signal: options.signal,
      });
      // The mapper is total over well-typed outcomes but reads `outcome.kind` unguarded; a park that
      // settles with nothing at all is not its problem to solve.
      if (!outcome) return { action: "cancel" };
      if (outcome.kind === "elicitation_accept" && !contentSatisfies(request, outcome.content)) return { action: "decline" };
      return outcomeToElicitResult(outcome);
    } catch {
      return { action: "cancel" };
    }
  };
}

/** Does this accept's content satisfy what the server ASKED for? The mapper cannot answer this — it never
 *  sees the request — and a well-formed `{action:"accept"}` the server then rejects is a worse failure than
 *  a clean refusal, because it reads as success on the way out.
 *
 *  Checks MCP's own restricted schema subset (a flat object of primitives, `required`, `enum`) and nothing
 *  more: an undeclared extra key passes, because JSON Schema allows extras unless a schema closes itself,
 *  and refusing them would decline answers real servers accept. */
function contentSatisfies(request: ElicitationRequest, content?: Record<string, string | number | boolean | string[]>): boolean {
  if (request.mode === "url") return true;      // an url-mode elicitation has no form to fill in
  const schema = request.requestedSchema;
  if (!schema) return true;                     // nothing declared, so nothing to fail against
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (Array.isArray(schema.required) ? schema.required : []) as string[];
  const values = content ?? {};                 // an accept with NO content still owes every required field
  for (const key of required) if (!(key in values)) return false;
  for (const [key, value] of Object.entries(values)) {
    const property = properties[key];
    if (!property) { if (schema.additionalProperties === false) return false; continue; }
    if (!valueMatches(property, value)) return false;
  }
  return true;
}

function valueMatches(property: Record<string, unknown>, value: unknown): boolean {
  if (Array.isArray(property.enum) && !property.enum.includes(value)) return false;
  switch (property.type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    // A type we do not model is not ours to refuse — the server's own schema is the authority, and
    // declining what we merely fail to understand would refuse answers it would have taken.
    default: return true;
  }
}
