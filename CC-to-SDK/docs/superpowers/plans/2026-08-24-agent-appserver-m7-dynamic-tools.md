# M7 dynamic tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client declares tools at `thread/start`/`thread/resume` and IS the tool runtime — the model's call parks and travels to thread subscribers as `tool/callRequested`, the client's `tool/callResult` settles it — with zero wire-grammar change (the park trio), closing the largest capability gap vs Codex's app-server.

**Architecture:** The spec is `CC-to-SDK/docs/superpowers/specs/2026-08-23-agent-appserver-m7-dynamic-tools-design.md` (rev 2) — read it first; on any conflict the spec wins. Built bottom-up: the pure schema→zod converter, then declaration validation + thread state, then the DynamicCalls registry + the wire trio (notification/method/replay), then per-engine server building + the immutable overlay, then the in-memory MCP exchange + scorecard closure. Declarations are serializable thread state (NEVER config); fresh `createSdkMcpServer` instances are built per engine construction and ride a dedicated server-owned config field merged LAST in `resolveOptions` — structurally immune to `extraOptions` and `mcpServers` replacement.

**Tech Stack:** TypeScript ESM (imports end `.js`), zod v4, vitest, `@anthropic-ai/claude-agent-sdk` (`createSdkMcpServer`/`tool`), `@modelcontextprotocol/sdk` (in-memory client for the exchange rows). Dense hand-style, no Prettier. All commands run from `CC-to-SDK/harness` unless stated.

## Global Constraints

- **Caps (exact values, named in one place — `src/appserver/dynamicTools.ts`):** `MAX_DYNAMIC_TOOLS = 32` functions total across namespaces; per-tool `inputSchema` ≤ 8_192 bytes serialized, ≤ 8 levels deep, ≤ 64 schema nodes; `MAX_TOOL_DESCRIPTION_CHARS = 2_000`; result ≤ 16 content items, ≤ 131_072 total payload chars (over-cap settles the call `isError` with a cap-naming note — it never refuses the method).
- **Names:** `toolName` regex `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/`; namespace `dyn` is RESERVED; declaration refusals are `-32602` with a message naming the offender (the colliding name, the unsupported keyword, the cap exceeded).
- **Delivery is subscribers-only.** `tool/callRequested` goes through `srv.broadcast` (server.ts:960 — `record.subscribers`), NEVER `broadcastToWatchers`/`broadcastServer`. A watcher-only peer must observe neither arguments nor a settleable `callId`.
- **Errors:** unknown `callId` → `-32602` "no such pending tool call"; already-settled/previous-generation → `-33002 ALREADY_SETTLED` (`ERR` at `src/appserver/rpc.ts:12`). Settled-tombstone ring size 128.
- **`alwaysLoad: spec.deferLoading !== true`** — Codex's polarity: omitted and `false` load directly, only explicit `true` defers.
- **Declarations are never part of `config`.** `ThreadRecord.dynamicTools` (serializable specs) is the only store; `record.config` is never rewritten; the config identity guard (`sessionIdentity.ts`) is untouched.
- **Content items are camelCase** (`inputText`/`inputImage`/`inputAudio`, media as `data:` URLs); conversion to MCP blocks: `inputText`→`{type:"text",text}`, `inputImage`→`{type:"image",data,mimeType}`, `inputAudio`→`{type:"audio",data,mimeType}`; `success:false` → `isError:true`.
- **Regenerate the published schema artifact in the same change** that touches `schema/index.ts` (`npm run emit-schema`; `test/unit/schemaGen.test.ts` byte-compares).
- Never run keyed/live tests (quota until 2026-08-26 1pm); live suites must skip cleanly keyless; never read/print `CC-to-SDK/.env`. Never edit `scripts/drift-check.mjs`. NO Co-Authored-By trailers; `git add` explicit paths only.

---

### Task 1: `schemaToZod.ts` — the conversion subset

**Files:**
- Create: `src/appserver/schemaToZod.ts`
- Test: `test/unit/schemaToZod.test.ts`

**Interfaces:**
- Consumes: `zod/v4` only.
- Produces (Tasks 2 and 4 rely on these exact names):

```ts
export type ConvertOk = { ok: true; schema: z.ZodTypeAny; strict: boolean };
export type ConvertErr = { ok: false; keyword: string };  // the unsupported keyword, for the refusal message
export function jsonSchemaToZod(schema: Record<string, unknown>): ConvertOk | ConvertErr;
```

`ConvertOk.schema` is a fully-built `z.object(...)` — `.strict()` when `additionalProperties === false`, `.passthrough()` when absent or `true` (JSON Schema's own default admits extra keys; a stripping object would silently rewrite valid client arguments). Probe 115's measured error ("inputSchema must be a Zod schema or raw shape") admits a built schema, so a ZodObject is what Task 4 hands to `tool()` (with a cast past its `AnyZodRawShape` generic).

- [ ] **Step 1: Write the failing tests** — `test/unit/schemaToZod.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { jsonSchemaToZod } from "../../src/appserver/schemaToZod.js";

describe("jsonSchemaToZod", () => {
  it("requires an object root", () => {
    expect(jsonSchemaToZod({ type: "string" })).toEqual({ ok: false, keyword: "type:string (root must be object)" });
    expect(jsonSchemaToZod({})).toEqual({ ok: false, keyword: "type (root must be object)" });
  });
  it("converts the full field subset and honors required", () => {
    const r = jsonSchemaToZod({ type: "object", properties: {
      s: { type: "string", minLength: 1, maxLength: 10, description: "a string" },
      n: { type: "number", minimum: 0, maximum: 5 }, i: { type: "integer" }, b: { type: "boolean" },
      a: { type: "array", items: { type: "string" } },
      e: { type: "string", enum: ["x", "y"] }, c: { const: "fixed" },
    }, required: ["s", "n"] });
    if (!r.ok) throw new Error(r.keyword);
    expect(r.schema.safeParse({ s: "a", n: 1 }).success).toBe(true);
    expect(r.schema.safeParse({ n: 1 }).success).toBe(false);           // required s missing
    expect(r.schema.safeParse({ s: "a", n: 9 }).success).toBe(false);   // maximum
    expect(r.schema.safeParse({ s: "a", n: 1, i: 1.5 }).success).toBe(false); // integer
  });
  it("passthrough by default: extra keys SURVIVE parsing", () => {
    const r = jsonSchemaToZod({ type: "object", properties: { t: { type: "string" } }, required: ["t"] });
    if (!r.ok) throw new Error(r.keyword);
    expect(r.strict).toBe(false);
    expect(r.schema.parse({ t: "x", extra: 42 })).toEqual({ t: "x", extra: 42 });
  });
  it("additionalProperties:false → strict refusal of extra keys", () => {
    const r = jsonSchemaToZod({ type: "object", properties: { t: { type: "string" } }, additionalProperties: false });
    if (!r.ok) throw new Error(r.keyword);
    expect(r.strict).toBe(true);
    expect(r.schema.safeParse({ t: "x", extra: 1 }).success).toBe(false);
  });
  it("out-of-subset keywords refuse naming themselves", () => {
    expect(jsonSchemaToZod({ type: "object", properties: { u: { oneOf: [{ type: "string" }] } } }))
      .toEqual({ ok: false, keyword: "oneOf" });
    expect(jsonSchemaToZod({ type: "object", properties: { u: { type: "object" } } }))
      .toEqual({ ok: false, keyword: "type:object (nested objects unsupported)" });
    expect(jsonSchemaToZod({ type: "object", properties: { u: { $ref: "#/x" } } }))
      .toEqual({ ok: false, keyword: "$ref" });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/schemaToZod.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/appserver/schemaToZod.ts`. Field walker: `string` (+`minLength`/`maxLength`), `number`/`integer` (+`minimum`/`maximum`), `boolean`, `array`+`items` (items recurse through the same FIELD walker — arrays of scalars/enums; an `items` of type object refuses `type:object (nested objects unsupported)`), `enum` of strings/numbers (`z.enum`/`z.union` of literals), `const` (`z.literal`), `description` via `.describe`. Any OTHER keyword present on a field (`oneOf`, `anyOf`, `allOf`, `$ref`, `pattern`, `format`, `not`, nested `object`, …) returns `{ok:false, keyword}` — detect by allowlisting the handled keys per field and naming the first unknown one. Root: require `type:"object"`; walk `properties`; wrap required/optional off the `required` array; finish `.strict()` or `.passthrough()` per `additionalProperties`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run test/unit/schemaToZod.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/appserver/schemaToZod.ts test/unit/schemaToZod.test.ts && git commit -m "feat(appserver): the M7 schema conversion subset — object root, passthrough by default"`

---

### Task 2: Declarations — wire param, validation, thread state

**Files:**
- Modify: `src/appserver/schema/threads.ts` (params), `src/appserver/registry.ts` (record field), `src/appserver/server.ts:423-460` + `:722-733` + `:757-799` (handler reads + record stamping)
- Create: `src/appserver/dynamicTools.ts` (types, caps, `validateDeclarations`)
- Test: `test/unit/appserver/dynamic-tools.test.ts` (declaration half)

**Interfaces:**
- Consumes: `jsonSchemaToZod` (Task 1).
- Produces (Tasks 3–5 rely on these exact names):

```ts
// src/appserver/dynamicTools.ts
export const MAX_DYNAMIC_TOOLS = 32;
export const MAX_TOOL_DESCRIPTION_CHARS = 2_000;
export const MAX_SCHEMA_BYTES = 8_192; export const MAX_SCHEMA_DEPTH = 8; export const MAX_SCHEMA_NODES = 64;
export const RESERVED_NAMESPACE = "dyn";
export type DynamicToolFunction = { type: "function"; name: string; description: string; inputSchema: Record<string, unknown>; deferLoading?: boolean };
export type DynamicToolSpec = DynamicToolFunction | { type: "namespace"; name: string; description: string; tools: DynamicToolFunction[] };
/** Validate the whole declaration set against caps, names, collisions, and the conversion subset.
 *  `mcpServerNames` = Object.keys(config.mcpServers ?? {}). Returns the -32602 message on failure. */
export function validateDeclarations(specs: DynamicToolSpec[], mcpServerNames: string[]): { ok: true } | { ok: false; message: string };
export const NATIVE_TOOL_NAMES: readonly string[];  // the harness's own native enumeration (items/types.ts's switch list)
```

- `schema/threads.ts` gains (exact shapes from the spec):

```ts
const toolName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const dynamicToolFunction = z.object({
  name: toolName, description: z.string().max(MAX_TOOL_DESCRIPTION_CHARS),
  inputSchema: z.record(z.string(), z.unknown()), deferLoading: z.boolean().optional(),
});
export const dynamicToolSpec = z.discriminatedUnion("type", [
  dynamicToolFunction.extend({ type: z.literal("function") }),
  z.object({ type: z.literal("namespace"), name: toolName, description: z.string().max(MAX_TOOL_DESCRIPTION_CHARS),
    tools: z.array(dynamicToolFunction.extend({ type: z.literal("function") })).min(1) }),
]);
```

`threadStartParams` AND `threadResumeParams` gain `dynamicTools: z.array(dynamicToolSpec).optional()` — resume included because declarations are in-memory thread state: a resumed thread otherwise has NO path to tools (planning amendment; spec Revision Notes updated in this task). Mid-TURN/mid-thread re-declaration stays impossible — these are the only two minting methods.

- `ThreadRecord` gains `dynamicTools?: DynamicToolSpec[]` (registry.ts, beside `config` at :194, with a comment: serializable specs, never instances — spec finding 6).

- [ ] **Step 1: Failing tests** — declaration rows in `test/unit/appserver/dynamic-tools.test.ts`, using the per-file boot idiom copied from `test/unit/appserver/decisions.test.ts` (mkSink/boot/connect/req/waitReply). Rows, each asserting the -32602 message NAMES the offender:
  - over `MAX_DYNAMIC_TOOLS` (33 functions, one per namespace + bare mix) → message contains `"32"`;
  - description over 2_000 chars → schema-level -32602 (zod max);
  - schema over 8_192 bytes / depth 9 / 65 nodes (three rows) → message names the cap and the tool;
  - name colliding with `NATIVE_TOOL_NAMES[0]`; namespace colliding with a configured `mcpServers` key (pass `config.mcpServers = { shadowed: {} }`); duplicate function name within `dyn`; namespace literally `dyn` → each message names the name;
  - out-of-subset schema (`oneOf`) → message contains `oneOf`;
  - a CANONICAL Codex-shaped namespace fixture (tagged `type:"function"` children) parses and `thread/start` succeeds, `record.dynamicTools` stamped (assert via a follow-up `thread/start` reply success + the Task-3 wire rows will exercise state; here assert the reply is a clean `{threadId}`);
  - the same declaration set accepted at `thread/resume` (DI `listSessions`/store fake per `server.test.ts`'s boot).
- [ ] **Step 2: Run** — `npx vitest run test/unit/appserver/dynamic-tools.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `validateDeclarations`: flatten namespaces → count functions; per-tool: serialized `JSON.stringify(inputSchema).length ≤ MAX_SCHEMA_BYTES`, depth ≤ 8 (recursive walk), node count ≤ 64 (objects+arrays+leaves), `jsonSchemaToZod` must return ok (else `-32602` naming the keyword and the tool); names: no duplicates within a namespace (and within `dyn`'s bare set), no namespace named `dyn` or colliding with `mcpServerNames`, no function name in `NATIVE_TOOL_NAMES`. `NATIVE_TOOL_NAMES` = the `toolView` switch list (`items/types.ts:48-57`) exported as a const from `dynamicTools.ts` with a comment naming its source. Handler (`server.ts:437-451` region): after `safeParse`, if `parsed.data.dynamicTools`, call `validateDeclarations(specs, Object.keys((parsed.data.config?.mcpServers as object) ?? {}))`; on failure `replyError(id, ERR.INVALID_PARAMS, message)`; on success pass specs into `createThread`/`startThread` opts and stamp `record.dynamicTools` in the record literals (`server.ts:729`, `:786`).
- [ ] **Step 4: Run** — suite green; also `npx vitest run test/unit/appserver/server.test.ts` (handler region touched).
- [ ] **Step 5: Spec Revision Note** — append to the spec's `## Revision Notes`: `- rev 2 planning amendment (2026-08-24): dynamicTools accepted at thread/resume too — declarations are in-memory thread state, so a resumed thread otherwise has no path to tools; validation identical.`
- [ ] **Step 6: Commit** — `git add src/appserver/dynamicTools.ts src/appserver/schema/threads.ts src/appserver/registry.ts src/appserver/server.ts test/unit/appserver/dynamic-tools.test.ts CC-to-SDK/docs/superpowers/specs/2026-08-23-agent-appserver-m7-dynamic-tools-design.md && git commit -m "feat(appserver): dynamicTools declarations — wire param, caps, collisions, thread state"` (spec path relative to repo root — adjust when running from harness).

---

### Task 3: DynamicCalls registry + the wire trio

**Files:**
- Create: `src/appserver/dynamicCalls.ts`
- Modify: `src/appserver/dynamicTools.ts` (result conversion + caps), `src/appserver/schema/index.ts` (+`tool/callResult` registry entry), new `toolCallResultParams` in `src/appserver/schema/threads.ts` (or a new `schema/dynamicTools.ts` — one schema file per domain matches the codebase; create `schema/dynamicTools.ts`), `src/appserver/server.ts` (handler entry + `dynamicCalls` map beside `decisions` :382, mint beside `makeDecisions` :943, release in `closeRecord` :886), `src/appserver/subscribe.ts:131-133` (replay), `src/appserver/rewind.ts` (`swapEngine` settle + `threadReopen` reset), `src/appserver/settingsOps.ts` (`threadClear` settle via its swap)
- Test: `test/unit/appserver/dynamic-tools.test.ts` (wire rows)

**Interfaces:**
- Consumes: `ERR` (rpc.ts), `srv.broadcast` (server.ts:960), record epoch (registry.ts:289).
- Produces (Task 4 relies on these exact names):

```ts
// src/appserver/dynamicCalls.ts — explicitly mirrors ThreadDecisions (broker.ts:42), see its header
export type ToolCallContentItem = { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string } | { type: "inputAudio"; audioUrl: string };
export type PendingToolCall = { callId: string; threadId: string; turnId?: string; namespace?: string; tool: string; arguments: Record<string, unknown>; epoch: number };
export type CallToolResultLike = { content: Array<Record<string, unknown>>; isError?: boolean };
export class DynamicCalls {
  constructor(emit: (ev: { kind: "requested"; entry: PendingToolCall } | { kind: "settled"; callId: string }) => void);
  /** Park one call; resolves with the MCP-shaped result. `signal` aborts → settle cancelled. */
  park(entry: Omit<PendingToolCall, "callId">, signal?: AbortSignal): Promise<CallToolResultLike>;
  respond(callId: string, epochNow: number, result: CallToolResultLike): { ok: true } | { ok: false; code: "unknown" | "alreadySettled" };
  pending(): PendingToolCall[];
  reset(): void;      // reopen/engine-swap: settle all as cancelled, NO latch
  teardown(): void;   // close/shutdown: settle + latch (new parks refuse immediately)
}
```

`park` mints `callId = \`dyncall:${++seq}\``, stamps the caller-provided `epoch`, stores the FULL entry (subscribe replay needs it), emits `requested`, returns the settlement promise. Cancelled settles resolve `{content:[{type:"text",text:"Tool call cancelled: <reason>"}], isError:true}` (D-M4-9: the callback always answers). `respond`: unknown id → check the tombstone ring (`string[]` max 128 + a `Set`) — tombstoned → `alreadySettled`, else `unknown`; a live entry whose `epoch !== epochNow` is settled-as-cancelled by the swap path BEFORE respond can see it, but the check stays as a belt (treat mismatch as `alreadySettled`, never apply to current state).

- `tool/callResult` params (`schema/dynamicTools.ts`):

```ts
export const toolCallResultParams = z.object({
  threadId: z.string().min(1), callId: z.string().min(1),
  contentItems: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("inputText"), text: z.string() }),
    z.object({ type: z.literal("inputImage"), imageUrl: z.string().startsWith("data:") }),
    z.object({ type: z.literal("inputAudio"), audioUrl: z.string().startsWith("data:") }),
  ])).max(64),  // hard schema bound; the 16-item RESULT cap settles isError instead (Global Constraints)
  success: z.boolean(),
});
```

Registry entry `"tool/callResult": { params: toolCallResultParams }` in `schema/index.ts` → emit-schema regenerates.

- Result conversion + caps in `dynamicTools.ts`:

```ts
export const MAX_RESULT_ITEMS = 16; export const MAX_RESULT_PAYLOAD_CHARS = 131_072;
/** Convert wire items → MCP blocks, applying the result caps: over-cap converts to an isError
 *  text block NAMING the cap, never a refusal. data: URLs are parsed with the images round's
 *  decodeDataUrl (turnItems.ts) for media type + payload. */
export function toCallResult(items: ToolCallContentItem[], success: boolean): CallToolResultLike;
```

- Handler `toolCallResult` (in `dynamicTools.ts`, dispatch entry in server.ts beside `decision/respond` :511): resolve record (`-33004` unknown thread), `dynamicCalls.respond(callId, record.epoch, toCallResult(items, success))`; `unknown` → `-32602` "no such pending tool call"; `alreadySettled` → `-33002`; ok → reply `{}`.
- Notification: `emit` handler (minted in server.ts beside `makeDecisions`) broadcasts `tool/callRequested` `{threadId, callId, turnId?, namespace?, tool, arguments}` via `srv.broadcast` — subscribers only.
- Replay: `subscribe.ts` between the pending-decision loop (:131-132) and `thread/status/changed` (:133): `for (const call of srv.pendingToolCalls(record.id)) ctx.peer.notify("tool/callRequested", {...})`.
- Lifecycle: `closeRecord` (:886 region) → `teardown()` + map delete (mirror decisions); `threadReopen` (rewind.ts:576+) → `reset()` beside the decisions reset; `swapEngine` (rewind.ts:205, so rewind AND `threadClear`'s swap both inherit) → `reset()` before dispose; server shutdown path (find where decisions teardown on close — `AppServer.close`) → teardown.

- [ ] **Step 1: Failing wire rows** in `dynamic-tools.test.ts` (drive the REAL wire per the boot idiom; park by invoking the registered park path — Task 4 wires the SDK handler, so HERE park via a test seam: export `srv.parkToolCall(threadId, entry, signal?)` on AppServer (same visibility as `pendingDecisions` :990) and note in its doc comment that Task 4's server handlers are its production caller):
  - park → subscriber receives `tool/callRequested` with full shape; a watcher-only peer (initialize `{watchThreads:true}`, no subscribe) receives NOTHING;
  - zero-subscriber park waits; `thread/subscribe` replays the full pending request; answer settles it (`disconnect-then-reattach`: close the first conn, connect+subscribe a second, replay arrives, `tool/callResult` from the second settles);
  - first answer wins; duplicate → `-33002`; fabricated `callId` → `-32602`;
  - over-cap result (17 items; 132_000-char text) settles the park promise `isError` with the cap named, method still replies `{}`;
  - abort signal → park resolves cancelled; `thread/close` (teardown), `thread/reopen` (reset), rewind's `swapEngine` (reset) each settle pending as cancelled — assert the park promise resolution and that a late `tool/callResult` earns `-33002`;
  - tombstone ring bounded: settle 130 calls, the first two callIds now answer `unknown` (`-32602`) — the ring forgot them; 129th/130th → `-33002`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the interfaces above. **Step 4: Run** → suite green + `npx vitest run test/unit/appserver` (subscribe/rewind/settingsOps touched) + `npm run emit-schema` + `npx vitest run test/unit/schemaGen.test.ts`.
- [ ] **Step 5: Commit** — `git add src/appserver/dynamicCalls.ts src/appserver/dynamicTools.ts src/appserver/schema/dynamicTools.ts src/appserver/schema/index.ts src/appserver/server.ts src/appserver/subscribe.ts src/appserver/rewind.ts src/appserver/settingsOps.ts test/unit/appserver/dynamic-tools.test.ts schema/json/stable/appserver.json && git commit -m "feat(appserver): DynamicCalls registry + the tool/callRequested-callResult park trio"`

---

### Task 4: Per-engine server building + the immutable overlay

**Files:**
- Create: `src/appserver/dynamicServers.ts`
- Modify: `src/config/types.ts` (`OpenSessionConfig`/`HarnessConfig` gains `dynamicToolServers?: Record<string, unknown>`), `src/config/resolveOptions.ts` (merge LAST, after :133-134), `src/appserver/server.ts:722-733` + `:757-799` (build at create/start), `src/appserver/rewind.ts` (`swapBaseConfig` :120 or the three factories — attach fresh instances from `record.dynamicTools`), `src/appserver/mcp.ts:115-158` (overlay guard + merge into every push), `src/appserver/rewind.ts:298` (repush merge)
- Test: `test/unit/appserver/dynamic-tools.test.ts` (overlay rows), `test/unit/resolve-options.test.ts` (merge-last row — find the existing resolveOptions suite name first; `grep -rl resolveOptions test/unit | head -3`)

**Interfaces:**
- Consumes: `DynamicToolSpec` (T2), `DynamicCalls` via `srv.parkToolCall` (T3), `jsonSchemaToZod` (T1), `createSdkMcpServer`/`tool` from `@anthropic-ai/claude-agent-sdk`.
- Produces:

```ts
// src/appserver/dynamicServers.ts
/** Declarations → FRESH SDK server instances, one per namespace + `dyn` for bare functions.
 *  Never cached, never stored on the record (an MCP Server instance rejects a second transport —
 *  spec finding 6): call this at EVERY engine construction. */
export function buildDynamicServers(
  specs: DynamicToolSpec[],
  park: (call: { namespace?: string; tool: string; arguments: Record<string, unknown>; signal?: AbortSignal }) => Promise<CallToolResultLike>,
): Record<string, unknown>;  // name → McpSdkServerConfigWithInstance
export function overlayServerNames(specs: DynamicToolSpec[]): string[];
```

Per tool: `tool(name, description, converted, handler, { alwaysLoad: spec.deferLoading !== true })` where `converted = jsonSchemaToZod(spec.inputSchema)` (already validated ok at declaration — throw on !ok as an invariant). `tool()`'s generic wants a raw shape; pass the built ZodObject with an `as never` cast and a comment citing probe 115's runtime acceptance of schemas. Handler: `(args, extra) => park({ namespace, tool: name, arguments: args as Record<string, unknown>, signal: (extra as { signal?: AbortSignal } | undefined)?.signal })` — the MCP `RequestHandlerExtra` carries an AbortSignal; verify the field exists in the vendored `@modelcontextprotocol/sdk` types and note the finding in the task report. Namespace `description` → `createSdkMcpServer({ name, version: "1.0.0", instructions: description, tools })`.

**Config carriage (the structural immunity):** `resolveOptions.ts`, AFTER the `extraOptions` spread and `SERVER_OWNED` re-assertion (:133-134):

```ts
if (config.dynamicToolServers) options.mcpServers = { ...(options.mcpServers as Record<string, unknown> ?? {}), ...config.dynamicToolServers };
```

Build sites: in `createThread`/`startThread`, after minting the DynamicCalls registry (T3) and before the factory call, `cfg.dynamicToolServers = buildDynamicServers(specs, parkFn)` where `parkFn` is the closure that fills the thread-side fields AT CALL TIME (turnId/epoch must be read when the model calls, not when the engine is built):

```ts
const parkFn = (call: { namespace?: string; tool: string; arguments: Record<string, unknown>; signal?: AbortSignal }) =>
  srv.parkToolCall(threadId, { threadId, turnId: activeTurnId(record), namespace: call.namespace,
    tool: call.tool, arguments: call.arguments, epoch: record.epoch }, call.signal);
```

(`srv.parkToolCall(threadId, entry, signal?)` is Task 3's AppServer seam — same visibility as `pendingDecisions` at server.ts:990; Task 3's rows call it directly, this closure is its production caller. At `createThread` the record literal is built after the factory, so bind `record` via a `let` the same way `makeDecisions`' emit closure resolves late — follow the decisions wiring's exact pattern at server.ts:722-733.) Swap paths: `swapBaseConfig` (rewind.ts:120) re-derives from `record.config` — add, at its END: attach `dynamicToolServers` freshly built from `record.dynamicTools` (park closure over the record's registry). ALL THREE factories (`defaultReopenFactory`, `defaultFreshFactory`, `defaultResumeAtFactory`) flow through it — verify each does and say so in the report.

**`mcpServer/set` guard (mcp.ts):** before the engine push: `const overlay = overlayServerNames(record.dynamicTools ?? [])`; if any incoming key ∈ overlay → `-32602` `` `"${name}" is a dynamic-tool server owned by this thread's declaration and cannot be set` ``; else push `{...servers, ...buildDynamicServers?}` — NO: pushing rebuilt INSTANCES over the runtime wire is the SDK unknown (the engine's `setMcpServers` receipt suggests replace semantics; whether an in-process instance survives the control frame is unverifiable keylessly). Implement the spec's merge at OUR layer: merge the CURRENT overlay entries into the pushed map (`{...incoming, ...record's built overlay instances}` — hold the instances built at the LAST engine construction on a non-serialized record field `record.dynamicServerInstances` (typed `Record<string, unknown>`, stamped at every build, comment: runtime handle cache, NOT thread state — the serializable truth stays `record.dynamicTools`)), assert in unit tests (against the fake engine's captured `setMcpServers` arg) that the pushed map carries the overlay keys, and leave a `⚠️ live-row` note: whether the SDK honors instance entries on a runtime set is the keyed row's question; the declared fallback if it does not is to refuse `mcpServer/set` entirely on declaring threads (decision recorded in the spec Decision Log by Task 5).
**Repush (rewind.ts:298):** same merge on the repushed `record.mcpServersSet` map.

- [ ] **Step 1: Failing rows** — overlay rows in `dynamic-tools.test.ts` (fake engine captures `config` at factory + `setMcpServers` args): thread/start with one namespace + one bare function → factory config's `dynamicToolServers` has keys `[ns, "dyn"]`; `mcpServer/set` naming `ns` → `-32602` naming it; a set naming only `other` → pushed map carries `other` AND the overlay keys; rewind swap → factory called again with FRESH `dynamicToolServers` (different object identity, same keys) and repush map carries overlay keys; `resolveOptions` row: `config.extraOptions.mcpServers = {clobber:{}}` + `dynamicToolServers` → resolved `options.mcpServers` contains BOTH `clobber` and the overlay keys (overlay wins on collision).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → suite + full `test/unit/appserver` + the resolveOptions suite + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/appserver/dynamicServers.ts src/config/types.ts src/config/resolveOptions.ts src/appserver/server.ts src/appserver/rewind.ts src/appserver/mcp.ts src/appserver/registry.ts test/unit/appserver/dynamic-tools.test.ts <the resolveOptions suite file you extended in Step 1> && git commit -m "feat(appserver): dynamic-tool servers — fresh per engine build, merged last, immutable vs mcpServer/set"`

---

### Task 5: The in-memory MCP exchange, live test, scorecard closure

**Files:**
- Test: `test/unit/appserver/dynamic-tools-exchange.test.ts` (NEW), `test/live/appserver-dynamic-tools.test.ts` (NEW, keyless-skip)
- Modify: `CC-to-SDK/docs/parity/appserver.md`, the spec's living tail

**Interfaces:** consumes `buildDynamicServers` (T4). The MCP in-memory client: `import { Client } from "@modelcontextprotocol/sdk/client/index.js"; import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";` — resolve the package through the agent-sdk's own dependency tree; if it is not importable from the harness, add it as a devDependency at the version the agent-sdk vendors (check `node_modules/@anthropic-ai/claude-agent-sdk/package.json` dependencies) and record the choice.

- [ ] **Step 1: Exchange rows** (`dynamic-tools-exchange.test.ts`): build servers from a declaration with all subset field kinds + `additionalProperties` absent; connect the built instance (`McpSdkServerConfigWithInstance.instance`) over `InMemoryTransport.createLinkedPair()`; `client.listTools()` → the advertised JSON Schema carries every declared property, `required`, bounds, and the description (fidelity — compare structurally, not byte-wise: zod's emitter owns formatting); `client.callTool({name, arguments: {declared…, extra: 1}})` → the park callback receives `arguments` WITH the `extra` key (passthrough proof at the real MCP boundary); answer through the park's resolve with each of the three content kinds → `callTool` result carries `text`/`image`/`audio` blocks; `deferLoading` mapping: tools' `_meta["anthropic/alwaysLoad"]` is `true` for omitted/false and ABSENT/false for `deferLoading:true` (read the built definitions or the tools/list `_meta` — measure which surface carries it and pin that).
- [ ] **Step 2: Live test** (`test/live/appserver-dynamic-tools.test.ts`): copy the key-gating pattern from `test/live/appserver-image-input.test.ts` (header: quota-gated, first keyed run after 2026-08-26 1pm). One thread, one declared tool (probe 115's shape: `{ticket: string}`), prompt instructs calling it; assert IN ORDER: `decision/requested` for the `mcp__dyn__…` tool (answer allow over the wire) → `tool/callRequested` (answer `tool/callResult` `{contentItems:[{type:"inputText",text:"42"}], success:true}`) → an `mcp`-species `item/completed` on the stream → the model's reply contains `42`. Also the `mcpServer/set`-carries-instances question: after the tool answered once, `mcpServer/set {servers:{}}` then a second turn calling the tool again — if it still parks, the overlay survived (the ⚠️ from Task 4 resolves); if not, record the fallback decision in the spec Decision Log. Run keyless NOW → clean skip; do not source any env.
- [ ] **Step 3: Scorecard** — `docs/parity/appserver.md`: rows in the server-origin section (table at :739): `tool/callResult` (method, inProcess, shipped(M7)), `tool/callRequested` (notification row), a `thread/start`/`thread/resume` `dynamicTools` note in their rows; prose inventories at :55/:285/:306; totals section. From `CC-to-SDK/`: `node scripts/drift-check.mjs` → exit 0 (never edit the gate).
- [ ] **Step 4: Full acceptance** — run the spec's keyless rows 1–5 verbatim (spec `## Acceptance`); all green; `npx tsc --noEmit`; full `npx vitest run test/unit/appserver`.
- [ ] **Step 5: Spec retro** — replace `## Outcomes & Retrospective`'s Pending line; Surprises for anything planning/execution overturned (the resume amendment is already in Revision Notes).
- [ ] **Step 6: Commit** — explicit paths (tests, scorecard, spec) — `git commit -m "feat(appserver): M7 acceptance — in-memory MCP exchange, quota-gated live row, scorecard rows"`

---

### Final verification (inside Task 5, restated)

The spec's acceptance rows 1–5 ARE the verification; rows 6–7 (keyed) are deferred to after 2026-08-26 1pm and the live file must skip cleanly keyless. Full unit suite green before the final commit.
