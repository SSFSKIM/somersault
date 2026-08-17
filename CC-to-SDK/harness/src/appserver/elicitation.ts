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
import { broadcastToSubscribersAndWatchers } from "./fanout.js";
import type { PermissionBroker } from "../permissions/types.js";
import type { Peer } from "./peer.js";
import type { ConnCtx } from "./server.js";
import type { ElicitationRequest, OnElicitation } from "@anthropic-ai/claude-agent-sdk";

/** What this bridge needs from the app server, looked up LAZILY at elicitation time rather than captured:
 *  `record.config` (this callback included) outlives the engine it was built for — a rewind or
 *  `thread/reopen` hands the same config to a replacement — so a captured registry would be the wrong one,
 *  or a closed thread's. Structural rather than the AppServer type so nothing here depends on server.ts
 *  beyond the `ConnCtx` the shared fan-out helper is typed in. `pending()` is read for one purpose only:
 *  telling a park that reached the wire from a refusal that never did (see `announced` below). */
export interface ElicitationParkSource {
  threadDecisions(threadId: string): { broker(threadId: string): PermissionBroker; pending(): ReadonlyArray<{ toolUseID: string }> } | undefined;
  registry: { get(threadId: string): { subscribers: Iterable<Peer> } | undefined };
  watchers(): Iterable<ConnCtx>;
}

/** An `ElicitationRequest` carries no toolUseId and the park registry is keyed by one. `requestId` is the
 *  control envelope's own id and the value an out-of-band control_response would have to echo, so it is
 *  the one honest key — but it is the CLI's id, not ours, and a park key that repeats is not a cosmetic
 *  problem: `PendingDecisions.park` stores by key into a Map (permissions/pending.ts), so a second park
 *  under a taken key REPLACES the first resolver and that first promise never settles — the one hang the
 *  callback's own catch cannot cover. The monotonic suffix removes the assumption rather than confirming
 *  it; nothing parses this key, it travels to the wire whole. Prefixed so it cannot collide with a real
 *  tool_use id, and NOT idempotent by design — one call per elicitation. */
let parkSeq = 0;
export const elicitationKey = (requestId: string): string => `elicit:${requestId}#${++parkSeq}`;

export function makeOnElicitation(srv: ElicitationParkSource, threadId: string): OnElicitation {
  return async (request, options) => {
    // An answered elicitation is normally its own record on the wire — `decision/requested` then
    // `decision/resolved`. The exits below produce neither, and a refusal nothing reports is what leaves an
    // operator debugging "my MCP server's auth never completes" with nothing at all to go on. One
    // `warning`, in rewind.ts's shape (`{threadId, code, message}`, to subscribers and watchers alike),
    // plus the two ids that identify WHICH elicitation went quiet.
    const warn = (code: string, message: string) => {
      try {
        broadcastToSubscribersAndWatchers(srv.registry.get(threadId)?.subscribers ?? [], srv.watchers(), "warning",
          { threadId, code, message, serverName: request.serverName, requestId: options.requestId });
      } catch { /* the answer below is what the MCP server is owed; a failed report must not cost it */ }
    };
    try {
      const decisions = srv.threadDecisions(threadId);
      if (!decisions) { // nothing left to park into; the server is still owed an answer
        warn("elicitationNotParked", `elicitation from "${request.serverName}" (${options.requestId}) was cancelled: this thread has no decision registry`);
        return { action: "cancel" };
      }
      const key = elicitationKey(options.requestId);
      const settled = decisions.broker(threadId).request({
        // No tool is involved, so the server name is the most useful thing a dialog can put in the slot a
        // tool name usually fills; everything else it needs to render lives in `input`, which is the one
        // free-form field a PendingDecision carries to the wire.
        toolName: request.serverName,
        kind: "elicitation",
        toolUseID: key,
        input: { ...request },
        title: request.title, displayName: request.displayName, description: request.description,
        // The park's own abort listener settles on this (pending.ts), so an interrupted turn answers its
        // MCP server too instead of leaving the promise — and this callback — unresolved.
        signal: options.signal,
      });
      // Did it actually PARK? A request can be refused before it ever enters the registry — the unattended
      // fast path and the closed latch both return ahead of the park's own emit (broker.ts) — and such a
      // refusal produces no `decision/requested` and will produce no `decision/resolved`, so this is the
      // one moment it can be noticed. Read synchronously, before any await: `park()` registers inside the
      // Promise executor, which is the same instant broker.ts's own entry lookup relies on.
      const announced = decisions.pending().some((e) => e.toolUseID === key);
      const outcome = await settled;
      if (!announced) warn("elicitationNotParked", `elicitation from "${request.serverName}" (${options.requestId}) was refused without reaching a client — an unattended thread with nobody watching, or a thread already torn down`);
      // The mapper is total over well-typed outcomes but reads `outcome.kind` unguarded; a park that
      // settles with nothing at all is not its problem to solve.
      if (!outcome) return { action: "cancel" };
      // THE BACKSTOP, not the primary check. `decision/respond` now runs the same predicate against the parked
      // request BEFORE it settles anything (server.ts), because settling first meant the wire had already
      // reported `elicitation_accept` by the time this line downgraded the answer — an acceptance every client
      // and audit log recorded and the MCP server never received. This stays because not every settlement
      // comes through that handler: a fleet host's forwarded answer arrives via `settleView`, and teardown and
      // the abort listener settle parks with no client involved at all. Fail-closed either way — a refusal is
      // still a real `ElicitResult`.
      if (outcome.kind === "elicitation_accept" && !elicitationContentSatisfies(request, outcome.content)) return { action: "decline" };
      return outcomeToElicitResult(outcome);
    } catch (err) {
      warn("elicitationFailed", `elicitation from "${request.serverName}" (${options.requestId}) was cancelled: ${err instanceof Error ? err.message : String(err)}`);
      return { action: "cancel" };
    }
  };
}

/** Does this accept's content satisfy what the server ASKED for? The mapper cannot answer this — it never
 *  sees the request — and a well-formed `{action:"accept"}` the server then rejects is a worse failure than
 *  a clean refusal, because it reads as success on the way out.
 *
 *  EXPORTED because the answer is needed one step EARLIER than this module: `decision/respond` calls it against
 *  the parked request before it settles the decision, so the wire never announces an acceptance the MCP server
 *  will not be given. One predicate, two call sites — the alternative was two implementations of "does this
 *  answer fit", which is precisely the drift that produced the disagreement in the first place.
 *
 *  WHAT IS CHECKED, exactly: every `required` field is present; a declared primitive `type` matches; a
 *  declared option set contains the value, in all FOUR spellings MCP's restricted subset allows (an enum
 *  schema may be `enum`, legacy `enum`+`enumNames`, titled `oneOf:[{const,title}]` — which carries no
 *  `enum` key at all — or a multi-select `type:"array"` whose `items` holds either of the last two forms);
 *  and an undeclared key only when the schema closed itself with `additionalProperties:false`, since JSON
 *  Schema allows extras by default and refusing them would decline answers real servers accept.
 *
 *  WHAT IS DELIBERATELY NOT: `minimum`/`maximum`, `minLength`/`maxLength`/`format`, `minItems`/`maxItems`.
 *  Those bounds belong to the server's own validator, and its refusal of one is a normal protocol error —
 *  whereas the shapes above are the failures a client's dialog cannot render its way out of (an option
 *  that was never offered, a field that is not there), which is where an accept-then-reject actually
 *  costs the human a round trip. A check we only half-implement declines answers the server would take. */
export function elicitationContentSatisfies(request: ElicitationRequest, content?: Record<string, string | number | boolean | string[]>): boolean {
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
  const options = declaredOptions(property);
  if (options && !options.includes(value)) return false;
  switch (property.type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array": {
      // A multi-select's option set lives on `items`, one level down, and an answer carrying an item that
      // was never offered is still an array — so without this the whole shape passes on `Array.isArray`.
      if (!Array.isArray(value)) return false;
      const items = declaredOptions((property.items ?? {}) as Record<string, unknown>);
      return !items || value.every((item) => items.includes(item));
    }
    // A type we do not model is not ours to refuse — the server's own schema is the authority, and
    // declining what we merely fail to understand would refuse answers it would have taken.
    default: return true;
  }
}

/** The option set a schema declares, in whichever of MCP's spellings it used — `enum` (untitled, and the
 *  legacy `enum`+`enumNames` form) or `{const,title}` pairs under `oneOf` (a titled single-select, which
 *  has no `enum` key) / `anyOf` (a titled multi-select's `items`). `undefined` means "not an enum at all",
 *  which is not the same as an empty option set and must not be read as one. */
function declaredOptions(schema: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(schema.enum)) return schema.enum;
  const titled = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
  return titled?.map((option) => (option as { const?: unknown }).const);
}
