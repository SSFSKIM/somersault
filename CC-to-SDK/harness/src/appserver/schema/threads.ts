// appserver/schema/threads.ts — thread lifecycle params (M1 set; Waves 1-2 extend this file).
import { z } from "zod/v4";
import { archivedParam, epochCursorParam, listCursorParam, threadIdParams } from "./core.js";
import { MAX_TOOL_DESCRIPTION_CHARS } from "../dynamicTools.js";
import { CROSS_SESSION_INBOUND } from "./peer.js";

// M7 — THE DYNAMIC TOOL DECLARATION. A client that declares tools IS their runtime, so this shape is one
// half of the admission gate and `validateDeclarations` (dynamicTools.ts) is the other. The split is by
// KIND, not by convenience: everything here is decidable from the request alone (a name's characters, a
// description's length, whether a field is present at all) and is answered with the dispatcher's bare
// "Invalid params"; everything that needs to know what ELSE exists — the caps, the native catalog, the
// server slots already taken — is semantics, and is answered with a -32602 NAMING the offender.
//
// THE `__` DELIMITER IS DELIBERATELY NOT IN THIS REGEX, and that is the one place the split above is a
// judgment rather than a rule. `mcp__<server>__<tool>` makes the substring ambiguous in either half, so it
// must be refused — but a client that sends `prod__run` needs to be TOLD which of its names is wrong and
// why, and a shape refusal can only say "Invalid params". The semantic gate refuses it by name, and a
// `.refine` here would take that message away while publishing nothing in exchange: zod's JSON Schema
// conversion drops refinements, so the artifact a generated client validates against would not gain the
// check either.
const toolName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
/** CODE POINTS, NOT UTF-16 UNITS — `schemaToZod.ts`'s house rule, on the wire's own side of the same
 *  fence. draft-07 counts `maxLength` in Unicode code points, so the published `maxLength: 2000` admits
 *  2,000 emoji (4,000 UTF-16 units) while a zod `.max(2_000)` refuses them: the server would reject a
 *  description its own artifact tells clients to send. The bound is therefore a `.refine` over
 *  `[...v].length`, and `.meta()` republishes the keyword the refinement no longer emits — zod v4 merges
 *  a schema's registry metadata into `z.toJSONSchema`'s output verbatim (measured), so the artifact keeps
 *  the same `{"type":"string","maxLength":2000}` bytes while the runtime counts what draft-07 counts. */
const toolDescription = z
  .string()
  .refine((value) => [...value].length <= MAX_TOOL_DESCRIPTION_CHARS, `must be at most ${MAX_TOOL_DESCRIPTION_CHARS} characters`)
  .meta({ maxLength: MAX_TOOL_DESCRIPTION_CHARS });
/** Children are TAGGED (`type: "function"`) inside a namespace too — Codex's own
 *  `DynamicToolNamespaceTool` spells them that way, so a canonical Codex declaration cross-parses here. */
const dynamicToolFunction = z.object({
  type: z.literal("function"),
  name: toolName,
  description: toolDescription,
  // RAW JSON Schema, carried verbatim: it is advertised to the model's MCP client exactly as declared
  // (dynamicServers.ts), and every constraint on what may be in it — bytes, depth, nodes, the convertible
  // keyword subset, the required object root — is semantics.
  inputSchema: z.record(z.string(), z.unknown()),
  deferLoading: z.boolean().optional(),
});
export const dynamicToolSpec = z.discriminatedUnion("type", [
  dynamicToolFunction,
  z.object({
    type: z.literal("namespace"),
    name: toolName,
    // The SAME bound object as a function's, so the namespace half can never drift into UTF-16 counting
    // while the child half counts code points.
    description: toolDescription,
    // `.min(1)`: an empty namespace takes a real MCP server slot and publishes nothing into it — a server
    // the model is told about and can never call. Refused as a shape because "this array is empty" needs
    // nothing but the request to decide.
    tools: z.array(dynamicToolFunction).min(1),
  }),
]);
/** Declared BESIDE `config`, never inside it: the config identity guard, `review/start`'s config
 *  inheritance and the `extraOptions` merge then remain structurally unable to carry or clobber a
 *  declaration. Optional, and its absence is what every thread before M7 did. */
const dynamicToolsParam = { dynamicTools: z.array(dynamicToolSpec).optional() };

/** M8 — THE INBOUND POLICY, an ADMISSION param on both spines rather than a runtime setter: the CLI reads
 *  this key when it builds its flag layer, and nothing has measured that it re-reads it mid-session
 *  (appserver/peerPolicy.ts's header). Declared BESIDE `config`, never inside it, for the reason
 *  `dynamicTools` is — the server writes the key into every settings carrier the config can hold, so a
 *  client spelling it inside `config` too would only be arguing with the sanitizer about one field.
 *  OPTIONAL, and its omitted reading is `refuse`; that is why `initialize` publishes the `crossSession`
 *  marker (schema/core.ts), since an older server strips a param it has never heard of in silence. */
const crossSessionInboundParam = { crossSessionInbound: z.enum(CROSS_SESSION_INBOUND).optional() };

export const threadStartParams = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
  ...dynamicToolsParam,
  ...crossSessionInboundParam,
});
export const threadResumeParams = z.object({
  sessionId: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
  // BOTH admission spines take it. A resumed conversation is the one that most needs a tool runtime back:
  // the transcript already contains calls to tools only the client can serve.
  ...dynamicToolsParam,
  // BOTH admission spines take it, for the same reason both take `dynamicTools`: a resumed thread is as
  // addressable by a peer as a fresh one, and a policy only one spine applies is not a policy.
  ...crossSessionInboundParam,
});
// Task 13: epoch-qualified cursor (epochCursorParam, not the plain decimal offset it was split from) —
// see schema/core.ts's comment on why thread/read alone needs this shape.
export const threadReadParams = threadIdParams.extend(epochCursorParam.shape);
/** ONE history item, as a page carries it. Deliberately OPEN (`z.looseObject`): `type` and `id` are true of
 *  every item and `origin` is M9's addition, but the rest of the item model — the tool-call shape, a
 *  review's findings — is `items/types.ts`'s, and publishing a hand-transcribed union of it here would
 *  create a second copy of that model with nothing tying the two together. A client validating a page
 *  against this learns what the wire guarantees; it is not told that a `toolCall`'s extra keys are illegal,
 *  because they are not.
 *
 *  `origin` is the M9 marker and the reason this result is published at all: it is what lets a client
 *  render an arrival AS an arrival, and — because a withheld arrival is still counted in `arrivals` below —
 *  what lets it count the marked items it received against the number the server logged. Carried VERBATIM
 *  as the engine stamped it (`verifiedPeerPid` is the only field the kernel vouches for), so this server
 *  re-describing its members would substitute its own opinion for a measured one. */
const threadReadItem = z.looseObject({
  type: z.string(),
  id: z.string(),
  origin: z.record(z.string(), z.unknown()).optional().describe("present only on a cross-session arrival; the sender attribution verbatim, as the engine stamped it"),
});
/** M9 (spec Stage C, criterion 21): `thread/read`'s reply, published for the first time — the method
 *  declared params alone until this milestone gave its response a member whose ABSENCE carries meaning.
 *
 *  Three states for `arrivals`, and a client must tell them apart. ABSENT: this server does not merge a
 *  cross-session arrival log into history (an embedder supplied its own transcript reader and no store), so
 *  no claim is made. `null`: the store is degraded and cannot vouch for its own count — "I cannot tell
 *  you", which a zero would have turned into a false all-clear. Present: `logged` is the PRE-eviction total
 *  the session received, so it may legitimately exceed the marked items any page returns; the excess is
 *  history the server knows it could not place, and saying so is the point.
 *
 *  `nextCursor` is `null` at the end of the walk and otherwise the epoch-qualified row cursor the params
 *  above accept, unchanged by M9 — arrivals ride rows rather than occupying them, so the coordinate space
 *  a client pages through is the one it already had. */
export const threadReadResult = z.object({
  data: z.array(threadReadItem),
  nextCursor: z.string().nullable().describe("pass back as `cursor` for the next (older) page; null when the walk is done"),
  arrivals: z.object({ logged: z.number().int(), dropped: z.number().int() }).nullable().optional()
    .describe("absent when this server merges no arrival log; null when the store is degraded; otherwise the pre-eviction totals"),
});
// M6: `listCursorParam`, the keyset (core.ts), in the position `cursorParam` held — the field order is
// unchanged, so re-cursoring costs the byte-pinned artifact one `pattern` and one `description`.
// Task 12: extends the cursor shape with `cwd` (rather than reusing the alias directly) — the merged
// thread/list forwards `cwd` to deps.listSessions to scope the store side of the merge to one project.
// M5 Task 10 adds `archived`, the ONLY change this milestone makes to an existing method and additive by
// construction: the field is optional and its omitted reading is what this method already did. It is
// `core.ts`'s shared `archivedParam`, the same object `thread/search` publishes — the spec gives the
// partition to both methods in one sentence, so they publish one spelling of it.
export const threadListParams = listCursorParam.extend({ cwd: z.string().optional(), ...archivedParam.shape });
// Task 11: both `{ threadId }`-only — named here (rather than inlining threadIdParams at the index.ts
// registration site) so the method->schema table reads self-documenting, matching this file's other
// thread-lifecycle params.
export const threadCompactStartParams = threadIdParams;
export const threadReinitializeParams = threadIdParams;
// Task 12 (session library): `threadId` on all four accepts EITHER a registry id (`thr_…`) or a bare
// store sessionId — see sessionLib.ts's resolveThreadId, the one place that rule is implemented.
export const threadForkParams = z.object({
  threadId: z.string().min(1),
  upToMessageId: z.string().optional(),
  title: z.string().optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadNameSetParams = z.object({ threadId: z.string().min(1), title: z.string().min(1) });
export const threadTagSetParams = z.object({ threadId: z.string().min(1), tag: z.string().nullable() });
export const threadDeleteParams = z.object({ threadId: z.string().min(1) });
