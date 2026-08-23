# M7 — dynamic tools: client-declared tools over the park trio

**Date:** 2026-08-23 · **Owner approval:** design B of the product-trio presentation, approved verbatim.
**Grounding:** `docs/superpowers/grounding/2026-08-23-product-trio-ground.md` §2 + its 2026-08-23
amendment; probe 115 (`probes/probes/115-dynamic-tool-raw-schema.ts`).
**Sequencing:** executes AFTER the images round (`2026-08-23-appserver-image-input-design.md`).

## Purpose

The largest capability gap Codex's app-server still holds over this one: a client declares tools at
`thread/start` and **is** the tool runtime — the model's call travels to the client, the client's answer
comes back as the tool result. This milestone ships that, using the D1-preserving park trio the server
already runs for elicitation (park + notification + answer method) — **the wire grammar does not
change**; no server→client request frame exists after this milestone either.

Non-goals, decided: fleet-origin threads (their engine options are fixed at spawn; declaring on one
refuses `-33006 UNSUPPORTED_FOR_ORIGIN` — the host-wire bridge is D-M4-8's family, later); mid-thread
re-declaration (`thread/start` only, matching Codex); tool-call timeouts (the turn's own
interrupt/abort is the bound, matching elicitation).

## Wire design

### Declaration — `thread/start` gains `dynamicTools`

A typed param BESIDE `config`, so the config identity guard is untouched:

```ts
// appserver/schema/threads.ts
const dynamicToolFunction = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),   // raw JSON Schema — converted, see below
  deferLoading: z.boolean().optional(),
});
export const dynamicToolSpec = z.discriminatedUnion("type", [
  dynamicToolFunction.extend({ type: z.literal("function") }),
  z.object({ type: z.literal("namespace"), name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
             description: z.string(), tools: z.array(dynamicToolFunction).min(1) }),
]);
// thread/start params: { ..., dynamicTools: z.array(dynamicToolSpec).optional() }
```

Codex's `DynamicToolSpec` shapes, camelCase (`Function {name, description, inputSchema, deferLoading}`
| `Namespace {name, description, tools}`). Refused loudly at `thread/start`, each with a message naming
the offender: a name colliding with the native tool catalog (shadowing would silently eat the tool — the
measured hazard in [[sdk-mcp-tool-shadowing-and-permission]]); a duplicate name within the declaration;
an `inputSchema` outside the conversion subset (the message names the unsupported keyword).

### The call — notification out, method back

- **Notification** `tool/callRequested` → subscribers and watchers (fanout.ts's existing helper):
  `{threadId, callId, turnId, namespace?, tool, arguments}` — Codex's `DynamicToolCallRequest` minus
  `startedAtMs` (`emittedAtMs` already stamps every notification at the peer layer).
- **Method** `tool/callResult`:
  `{threadId, callId, contentItems: [...], success: boolean}` where a content item is
  `{type:"inputText", text}` | `{type:"inputImage", imageUrl}` | `{type:"inputAudio", audioUrl}` —
  Codex's `DynamicToolCallOutputContentItem` trio, camelCase. `imageUrl`/`audioUrl` admit `data:` URLs
  only (the images round's rule, same reason). Reply `{ok: true}`.
  - unknown `callId` → `-32602` with "no such pending tool call";
  - a second answer for a settled call → `-33002 ALREADY_SETTLED`;
  - thread mismatch (callId parked under a different thread) → `-33004 THREAD_NOT_FOUND` semantics
    are wrong here — it is `-32602`, the callId simply is not pending under that thread.

### Trust and routing

Broadcast + first `tool/callResult` with the key wins — the decision registry's exact trust model (any
subscriber can already answer a permission park). The declaring client is in practice the answerer; a
thread reattached after its declarer died can be answered by the new attachee. Rejected: binding calls
to the declaring CONNECTION (threads outlive connections; reattach is the fleet model).

## Runtime design

### Per-thread in-process MCP servers

At `thread/start` (inProcess origin, `dynamicTools` present), the server builds one
`createSdkMcpServer` per namespace — server name = namespace name; un-namespaced functions live under
the reserved namespace **`dyn`** (`dyn` therefore collides as a declared namespace name → refused).
Model-visible names are `mcp__<ns>__<name>` — an SDK naming constraint, noted as a Codex-parity nuance
(Codex shows bare names), not hidden.

### Schema conversion (probe 115's consequence)

The SDK runtime refuses raw JSON Schema at `registerTool` (`inputSchema must be a Zod schema or raw
shape` — probe 115, explicit check). New module `appserver/schemaToZod.ts` converts the declared
subset:

- `type`: `object`/`string`/`number`/`integer`/`boolean`/`array`; `enum` (strings/numbers); `const`
- `properties`/`required`/`additionalProperties:false`/`items`/`description`
- bounds: `minimum`/`maximum`/`minLength`/`maxLength`

Anything else (`$ref`, `oneOf`/`anyOf`, `pattern`, formats, nested unions…) refuses the DECLARATION at
`thread/start`, naming the keyword — a weak silently-converted schema would degrade every call the
model makes, invisibly. The permissive-shape fallback (schema prose in the description) is deliberately
NOT taken; revisit only if the subset proves too small against real clients.

### The handler — park, broadcast, settle

Each registered tool's handler:

1. mint `callId` (`toolcall:<uuid>`), park a resolver in the thread record's `toolCalls` map;
2. broadcast `tool/callRequested`;
3. await settlement; convert `contentItems` → MCP `CallToolResult` content
   (`inputText`→`{type:"text"}`; `inputImage`→`{type:"image", data, mimeType}` from the data: URL;
   `inputAudio`→`{type:"audio", data, mimeType}` — all three MCP block types exist, verified in
   `@modelcontextprotocol/sdk` types); `success:false` → `isError: true`.

**The callback always answers** (elicitation's rule, D-M4-9): turn interrupt/abort, `thread/clear`'s
engine swap, thread close, and server shutdown each settle every pending call with
`{success:false, contentItems:[{type:"inputText", text:"tool call cancelled: <why>"}], isError:true}` —
a rejected or hanging handler would wedge the SDK MCP server exactly as an unanswered elicitation
would. Settlement hooks ride the same points elicitation's parks already use.

### deferLoading

SDK MCP tools are deferred behind ToolSearch by default ([[sdk-mcp-tools-deferred-not-inline]]).
`deferLoading:false` maps to `tool()` extras `alwaysLoad:true`; absent or `true` maps to the default.

### Items and permissions — existing machinery, verified not assumed

- The stream's `tool_use` for `mcp__…` names already classifies as the `mcp` species in
  `items/types.ts:47` — dynamic tool calls appear as tool items on the thread with no new mapper work.
  One acceptance row pins it.
- Dynamic tools ride the normal permission surface under their `mcp__<ns>__<name>` names — broker
  parks, allow/deny rules, `permissionMode` — with no special-casing. One acceptance row pins that a
  broker-parked dynamic call still resolves.

## Acceptance (behavior-phrased)

Keyless (run from `CC-to-SDK/harness`):

1. `npx vitest run test/unit/appserver/dynamic-tools.test.ts` — declaration validation (collision,
   duplicate, out-of-subset each refused with its named message; fleet origin → -33006); the park trio
   driven through the REAL wire (handler invoked directly with DI): callRequested broadcast shape,
   callResult settles and converts all three content kinds, unknown callId -32602, double answer
   -33002, abort/close/shutdown each settle pending calls as cancelled.
2. `npx vitest run test/unit/schemaToZod.test.ts` — subset conversion round-trips (converted zod
   accepts/rejects what the source schema says); every out-of-subset keyword refuses naming itself.
3. `npx vitest run test/unit/appserver` — full suite green.
4. `node scripts/drift-check.mjs` — exit 0; the method count grows by one (`tool/callResult`), the
   scorecard gains its row plus the `tool/callRequested` notification row and the `thread/start`
   `dynamicTools` note.

Keyed (quota-gated — after 2026-08-26 1pm):

5. A live test declares one tool (`get_ticket`, the probe-115 schema), lets the model call it, answers
   over the wire, and asserts the model's reply uses the tool's answer; skips cleanly keyless.
6. Probe 115's fidelity half: the converted schema is what the model sees (the live call's `arguments`
   conform; a deliberately missing required field never arrives).

## Decision Log

- **Park trio over a reverse-request frame.** The grounding doc assumed a D1 breach; `elicitation.ts`
  proves the trio already expresses server-blocks-on-client. Same trust model, same failure semantics,
  zero wire-grammar change. Rejected: Codex-mirror server→client requests (new frame discipline, id
  spaces, response routing — all cost, no capability the trio lacks).
- **Convert-with-bounded-subset over permissive-shape fallback** (probe 115). A tool whose model-visible
  schema is `{}`-ish degrades every call invisibly; a loud declaration refusal degrades nothing.
- **`dynamicTools` beside `config`, not inside it.** The config identity guard (sessionIdentity.ts)
  stays untouched; declarations are not config.
- **inProcess-only v1, -33006 on fleet.** Fleet engines' SDK options are fixed at spawn; a host-wire
  dynamic-tools op is D-M4-8's bridge family, designed once for elicitation + tools together, later.
- **Reserved `dyn` namespace** for un-namespaced functions; declaring a namespace named `dyn` refuses.
- **No timeouts.** Matching elicitation: the turn's interrupt is the bound; a long-running client tool
  is legitimate. An operator who wants a bound interrupts the turn.
- **`data:`-only media in contentItems**, matching the images round's rule and reusing its parser.

## Surprises & Discoveries

Pending — written during execution.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- rev 1 (2026-08-23): initial spec from the approved design-B presentation + probe 115.
