# M7 dynamic tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan rev 2** — the adversarial plan review's findings folded in (19 accepted after verification, 1 rejected — Revision Notes at the bottom). **Review base for every M7 review is `781683b4cf`** (the branch point off the images round), NOT main — the images stack is a separate milestone under its own PR #8.

**Goal:** A client declares tools at `thread/start`/`thread/resume` and IS the tool runtime — the model's call parks and travels to thread subscribers as `tool/callRequested`, the client's `tool/callResult` settles it — with zero wire-grammar change (the park trio), closing the largest capability gap vs Codex's app-server.

**Architecture:** The spec is `CC-to-SDK/docs/superpowers/specs/2026-08-23-agent-appserver-m7-dynamic-tools-design.md` (rev 2 + the rev 2p planning amendments) — read it first; on any conflict the spec wins. Six tasks, bottom-up: the pure schema→zod converter; the declaration module (types/caps/validation, wire-SILENT — nothing public until it can work); the DynamicCalls registry + result conversion (pure); the wire trio + lifecycle (params exposure, handler with subscriber authority, notification, replay, every teardown seam); per-engine server building + the overlay carried on a TRANSIENT engine config (`record.config` never holds runtime handles); the in-memory MCP exchange crossing the PRODUCTION wiring + scorecard closure. `mcpServer/set` ships the conservative fallback: REFUSED on declaring threads until the keyed survival row proves the SDK carries instances on a runtime set.

**Tech Stack:** TypeScript ESM (imports end `.js`), zod v4, vitest, `@modelcontextprotocol/sdk` (the LOW-LEVEL `Server` plus the in-memory client). Dense hand-style, no Prettier. All commands run from `CC-to-SDK/harness` unless stated.

**The advertisement path is the LOW-LEVEL MCP `Server`, not `createSdkMcpServer`/`tool()` (rev 4, controller-measured 2026-08-24):** an in-memory probe showed BOTH zod paths lose the declared constraints in `tools/list` — a built object (zod v3 AND v4 alike) loses descriptions, min/max, and `.int()`; a raw shape keeps descriptions but still loses every bound. No zod-mediated advertisement can carry the declared schema to the model. So `dynamicServers.ts` builds a low-level `Server` (`@modelcontextprotocol/sdk/server/index.js`) per namespace with explicit handlers: `ListToolsRequestSchema` → each tool's **VERBATIM declared JSON Schema** (plus `_meta: {"anthropic/alwaysLoad": spec.deferLoading !== true}` per tool, and the namespace description as `instructions` in the server construction options) — full Codex-parity fidelity, byte-comparable in tests; `CallToolRequestSchema` → validate arguments with `jsonSchemaToZod`'s converted schema (passthrough/strict semantics live HERE — a strict-refused or invalid argument set returns an MCP validation error, never parks), then park. The instance is handed to the engine as a `{type:"sdk", name, instance}` entry — the `McpSdkServerConfigWithInstance` shape. The MCP layer is pinned keylessly by the exchange rows; the agent-sdk bridge accepting a low-level instance is the keyed row's residual (it calls `instance.connect(transport)`, which the low-level `Server` implements).

## Global Constraints

- **Caps (exact values, named once in `src/appserver/dynamicTools.ts`):** `MAX_DYNAMIC_TOOLS = 32` functions total; per-tool `inputSchema` ≤ 8_192 **UTF-8 bytes** (`Buffer.byteLength(JSON.stringify(schema), "utf8")`), ≤ 8 levels deep, ≤ 64 schema nodes; `MAX_TOOL_DESCRIPTION_CHARS = 2_000`; result `MAX_RESULT_ITEMS = 16`, `MAX_RESULT_PAYLOAD_BYTES = 131_072` — measured as **UTF-8 bytes of the EMITTED MCP content** (every block's `text`/`data`/`mimeType` strings summed via `Buffer.byteLength`), never UTF-16 units. An over-cap result **settles the call `isError` with a cap-naming note, never refuses the method** (the wire schema puts NO count bound on `contentItems`; the 256 KiB frame is the only pre-handler bound). `inputImage` MIME must be `image/*` and `inputAudio` MIME `audio/*` — a mismatched family settles `isError` naming it.
- **Names:** `toolName` regex `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/`; namespace `dyn` RESERVED; duplicate namespace names across the declaration set refused. Collisions are checked for **every name `overlayServerNames` would produce — `dyn` included when bare functions exist** — against the EFFECTIVE occupied set: `Object.keys(config.mcpServers ?? {})` ∪ `Object.keys((config.extraOptions?.mcpServers as object) ?? {})` ∪ `INJECTED_SERVER_NAMES` (the in-process servers `Session` adds AFTER `resolveOptions` — enumerate them at the Session build site, export the const beside the injection code, and reserve them UNCONDITIONALLY even when their feature flags are off: a name that might be injected on the next engine swap is not a name a declaration may hold; state that reasoning in the const's comment). Servers the SDK discovers from settings/plugins under non-strict MCP config CANNOT be enumerated at thread/start — that residual is a PUBLISHED bound (spec rev 3), not a refusal. Function names are checked against `NATIVE_TOOL_NAMES` — a PINNED fixture of the complete current-SDK catalog, guarded by a drift test that parses the vendored `sdk.d.ts` tool-input declarations (45 interfaces at 0.3.237) and asserts set equality, so an SDK bump that adds a tool goes red instead of silently opening a shadowing hole. NOT `items/types.ts`'s display classifier (a subset omitting `TaskCreate`, `AskUserQuestion`, `Workflow`, …). Every declaration refusal is `-32602` naming the offender.
- **`config.dynamicToolServers` is SERVER-OWNED and never client-settable:** `thread/start`/`thread/resume` refuse a config (or `extraOptions`) carrying the key with `-32602` "dynamicToolServers is server-owned"; `record.config` never contains it (the overlay rides only the transient engine config).
- **Settlement authority is subscribers-only, enforced twice:** `tool/callResult` refuses a peer not in `record.subscribers` (before any registry lookup), AND `callId`s are opaque (`dyncall:<randomUUID()>`), never guessable counters.
- **Errors:** unknown `callId` → `-32602` "no such pending tool call"; already-settled/previous-generation → `-33002 ALREADY_SETTLED` (`ERR`, `src/appserver/rpc.ts:12`); non-subscriber settlement attempt → `-32602` "only a subscriber of this thread can settle its tool calls". Tombstone ring 128.
- **`alwaysLoad: spec.deferLoading !== true`** — Codex's polarity.
- **`record.config` NEVER holds runtime handles.** Live `createSdkMcpServer` instances ride only a TRANSIENT engine config (`{...cfg, dynamicToolServers}`) handed to the factory; `record.config` stays the serializable base (review/start inherits it — spec finding 6). Serializable truth: `ThreadRecord.dynamicTools`.
- **`mcpServer/set` on a declaring thread refuses** (`-32602`, message naming the dynamic declaration) — the conservative fallback, relaxed only after the keyed survival row passes (spec Decision Log, rev 2p).
- **Content items camelCase** (`inputText`/`inputImage`/`inputAudio`, media `data:` URLs); conversion: `inputText`→`{type:"text",text}`, `inputImage`→`{type:"image",data,mimeType}`, `inputAudio`→`{type:"audio",data,mimeType}`; `success:false` → `isError:true`; **malformed media settles `isError`** (a throw would leave the call parked — the callback always answers, D-M4-9).
- **Regenerate the published schema artifact in the same change** that touches `schema/index.ts` (`npm run emit-schema`; `test/unit/schemaGen.test.ts` byte-compares).
- Never run keyed/live tests (quota until 2026-08-26 1pm); live suites skip cleanly keyless; never read/print `CC-to-SDK/.env`. Never edit `scripts/drift-check.mjs`. NO Co-Authored-By trailers; `git add` explicit paths only.

---

### Task 1: `schemaToZod.ts` — the conversion subset

**Files:**
- Create: `src/appserver/schemaToZod.ts`
- Test: `test/unit/schemaToZod.test.ts`

**Interfaces:**
- Consumes: `zod/v4` only.
- Produces (Tasks 2 and 5 rely on these exact names):

```ts
export type ConvertOk = { ok: true; schema: z.ZodTypeAny; strict: boolean };
export type ConvertErr = { ok: false; keyword: string };  // the unsupported keyword, for the refusal message
export function jsonSchemaToZod(schema: Record<string, unknown>): ConvertOk | ConvertErr;
```

`ConvertOk.schema` is a built `z.object(...)` — `.strict()` when `additionalProperties === false`, `.passthrough()` when absent or `true`. Probe 115's measured error ("inputSchema must be a Zod schema or raw shape") admits a built schema; Task 5 hands it to `tool()` with a cast.

**Root allowlist (review finding 16):** the root may carry ONLY `type`, `properties`, `required`, `additionalProperties`, `description`. Any other root key (`oneOf`, `$ref`, `patternProperties`, …) → `{ok:false, keyword}`. `additionalProperties` must be absent or a BOOLEAN (a schema-valued one refuses `additionalProperties:<schema>`); `required` must be an array of strings each present in `properties` (else refuse `required:<name> not in properties`). Root `type` must be `"object"`.

**Value-domain totality (r3 finding 7): conversion NEVER throws.** Every keyword's VALUE is validated before use — `properties` must be a plain object of plain-object fields (`properties: null` refuses `properties:<non-object>`, not a walker crash); `minimum`/`maximum`/`minLength`/`maxLength` must be finite numbers (a string bound refuses naming the keyword); `items` must be a plain object; `enum` must be a non-empty array whose members match the field `type`; `const` a string/number/boolean. Wrap the walk defensively so an unforeseen shape still returns `{ok:false, keyword:"<path>: unsupported shape"}` rather than throwing into a `-32603`.

**Field allowlist:** per-field handled keys are `type`, `description`, `enum`, `const`, `minLength`, `maxLength`, `minimum`, `maximum`, `items`; the first unknown key on a field refuses naming it. Types: `string` (+`minLength`/`maxLength`), `number`/`integer` (+`minimum`/`maximum`, integer via `.int()`), `boolean`, `array`+`items` (items recurse through the FIELD walker; an items of `type:"object"` refuses `type:object (nested objects unsupported)`), `enum` of strings/numbers, `const` (`z.literal`), `description` via `.describe`. A field of `type:"object"` refuses `type:object (nested objects unsupported)`.

- [ ] **Step 1: Write the failing tests** — `test/unit/schemaToZod.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { jsonSchemaToZod } from "../../src/appserver/schemaToZod.js";

describe("jsonSchemaToZod", () => {
  it("requires an object root", () => {
    expect(jsonSchemaToZod({ type: "string" })).toEqual({ ok: false, keyword: "type:string (root must be object)" });
    expect(jsonSchemaToZod({})).toEqual({ ok: false, keyword: "type (root must be object)" });
  });
  it("refuses unknown ROOT keywords, schema-valued additionalProperties, and dangling required", () => {
    expect(jsonSchemaToZod({ type: "object", properties: {}, oneOf: [] })).toEqual({ ok: false, keyword: "oneOf" });
    expect(jsonSchemaToZod({ type: "object", properties: {}, $ref: "#/x" })).toEqual({ ok: false, keyword: "$ref" });
    expect(jsonSchemaToZod({ type: "object", properties: {}, additionalProperties: { type: "string" } }))
      .toEqual({ ok: false, keyword: "additionalProperties:<schema>" });
    expect(jsonSchemaToZod({ type: "object", properties: { a: { type: "string" } }, required: ["b"] }))
      .toEqual({ ok: false, keyword: "required:b not in properties" });
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
    expect(r.schema.safeParse({ n: 1 }).success).toBe(false);                 // required s missing
    expect(r.schema.safeParse({ s: "a", n: 9 }).success).toBe(false);         // maximum
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
  it("out-of-subset FIELD keywords refuse naming themselves", () => {
    expect(jsonSchemaToZod({ type: "object", properties: { u: { oneOf: [{ type: "string" }] } } }))
      .toEqual({ ok: false, keyword: "oneOf" });
    expect(jsonSchemaToZod({ type: "object", properties: { u: { type: "object" } } }))
      .toEqual({ ok: false, keyword: "type:object (nested objects unsupported)" });
    expect(jsonSchemaToZod({ type: "object", properties: { u: { $ref: "#/x" } } }))
      .toEqual({ ok: false, keyword: "$ref" });
  });
  it("is TOTAL over hostile values — refuses, never throws", () => {
    expect(jsonSchemaToZod({ type: "object", properties: null }).ok).toBe(false);
    expect(jsonSchemaToZod({ type: "object", properties: { u: { type: "string", minLength: "3" } } }).ok).toBe(false);
    expect(jsonSchemaToZod({ type: "object", properties: { u: { type: "number", maximum: Infinity } } }).ok).toBe(false);
    expect(jsonSchemaToZod({ type: "object", properties: { u: { type: "array", items: null } } }).ok).toBe(false);
    expect(jsonSchemaToZod({ type: "object", properties: { u: { type: "string", enum: [] } } }).ok).toBe(false);
    expect(jsonSchemaToZod({ type: "object", properties: { u: { type: "string", enum: [1] } } }).ok).toBe(false);
    // each returns {ok:false, keyword:...} — assert .ok only here, the keyword text is pinned per-row in the impl commit
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/schemaToZod.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** per the allowlists above.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git add src/appserver/schemaToZod.ts test/unit/schemaToZod.test.ts && git commit -m "feat(appserver): the M7 schema conversion subset — allowlisted root and fields, passthrough by default"`

---

### Task 2: The declaration module — types, caps, validation (wire-SILENT)

**Files:**
- Create: `src/appserver/dynamicTools.ts`
- Test: `test/unit/appserver/dynamic-tools-validate.test.ts`

Nothing in this task touches the wire, the schema registry, or `ThreadRecord` — a deliberately internal commit (review finding 11: exposing acceptance before tools can RUN ships a lying surface). Task 4 wires the params; Task 5 makes them work; both land before anything is externally visible.

**Interfaces:**
- Consumes: `jsonSchemaToZod` (Task 1).
- Produces (Tasks 3–6 rely on these exact names):

```ts
// src/appserver/dynamicTools.ts
export const MAX_DYNAMIC_TOOLS = 32;
export const MAX_TOOL_DESCRIPTION_CHARS = 2_000;
export const MAX_SCHEMA_BYTES = 8_192; export const MAX_SCHEMA_DEPTH = 8; export const MAX_SCHEMA_NODES = 64;
export const MAX_RESULT_ITEMS = 16; export const MAX_RESULT_PAYLOAD_BYTES = 131_072;
export const RESERVED_NAMESPACE = "dyn";
export const NATIVE_TOOL_NAMES: readonly string[];  // PINNED fixture of the complete current-SDK catalog; a drift test parses the vendored sdk.d.ts tool-input declarations and asserts SET EQUALITY (an SDK bump adding a tool goes red) — derive the initial list from that same parse, never from items/types.ts
export type DynamicToolFunction = { type: "function"; name: string; description: string; inputSchema: Record<string, unknown>; deferLoading?: boolean };
export type DynamicToolSpec = DynamicToolFunction | { type: "namespace"; name: string; description: string; tools: DynamicToolFunction[] };
/** Validate the whole declaration set. `occupiedServerNames` = the EFFECTIVE occupied set:
 *  config.mcpServers ∪ extraOptions.mcpServers ∪ INJECTED_SERVER_NAMES (Session's post-resolveOptions
 *  in-process servers — cc-context, cc-compact, and whatever else the Session build site enumerates;
 *  export that const beside the injection site and import it here). Returns the -32602 message on
 *  failure, naming the offender. */
export function validateDeclarations(specs: DynamicToolSpec[], occupiedServerNames: string[]): { ok: true } | { ok: false; message: string };
```

Checks, in order (each message names the offending tool/namespace/keyword/cap): flattened function count ≤ 32; per-tool schema `Buffer.byteLength(JSON.stringify(inputSchema), "utf8") ≤ 8_192`, depth ≤ 8, nodes ≤ 64; `jsonSchemaToZod(inputSchema).ok` (else name the keyword and the tool); **namespace names unique across the set**, none equal to `RESERVED_NAMESPACE`; **EVERY name `overlayServerNames(specs)` would produce — `dyn` included when bare functions exist — must be ∉ `occupiedServerNames`** (a client MCP server literally named `dyn`, or `cc-context`, would otherwise be silently overwritten by the merge-last overlay); bare-function names unique within `dyn`, per-namespace function names unique within their namespace; no function name ∈ `NATIVE_TOOL_NAMES`. (Name FORMAT and description length are the zod schema's job in Task 4 — validateDeclarations assumes shape-valid input and owns only the semantic checks.)

- [ ] **Step 1: Failing tests** — `test/unit/appserver/dynamic-tools-validate.test.ts` calls `validateDeclarations` DIRECTLY (no wire). Rows: 33 functions → message contains `32`; the byte boundary built PROGRAMMATICALLY — construct a schema whose `Buffer.byteLength(JSON.stringify(schema), "utf8")` is measured then padded (a description of `"힣".repeat(k)` sized so the serialized form lands at EXACTLY 8_192 bytes → passes, then one more character → refuses; assert both measured values in the test so the boundary is proven, not assumed); depth 9; 65 nodes; `oneOf` schema → message names `oneOf` and the tool; namespace `dyn`; two namespaces both named `ns1`; a namespace colliding with a client MCP name; **bare functions declared while `occupiedServerNames` contains `"dyn"`** → refused naming `dyn`; **a namespace named `cc-context`** (∈ INJECTED_SERVER_NAMES) → refused; duplicate function in `dyn`; duplicate function within one namespace; function named `TaskCreate` and function named `AskUserQuestion` (both OUTSIDE items/types.ts's display switch — proves the catalog is the complete one); **the catalog drift test: parse the vendored `sdk.d.ts` tool-input interface names (a regex over the declaration pattern — inspect the file to pin it; 45 at 0.3.237) and assert set equality with `NATIVE_TOOL_NAMES`**; a clean Codex-shaped fixture (namespace with tagged `type:"function"` children) → `{ok:true}`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git add src/appserver/dynamicTools.ts test/unit/appserver/dynamic-tools-validate.test.ts && git commit -m "feat(appserver): dynamic-tool declaration semantics — caps, collisions, the effective MCP map"`

---

### Task 3: `DynamicCalls` registry + result conversion (pure)

**Files:**
- Create: `src/appserver/dynamicCalls.ts`
- Modify: `src/appserver/dynamicTools.ts` (`toCallResult` + the shared data-URL parse), `src/appserver/turnItems.ts` (EXPORT the bounded data-URL parser — see below)
- Test: `test/unit/appserver/dynamic-calls.test.ts`

**Interfaces:**
- Consumes: nothing wire-side; `decodeDataUrl` semantics from `turnItems.ts`.
- Produces (Tasks 4–6 rely on these exact names):

```ts
// src/appserver/dynamicCalls.ts — explicitly mirrors ThreadDecisions (broker.ts:42); say so in the header
export type ToolCallContentItem = { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string } | { type: "inputAudio"; audioUrl: string };
export type PendingToolCall = { callId: string; threadId: string; turnId: string; namespace?: string; tool: string; arguments: Record<string, unknown>; epoch: number };
// turnId is REQUIRED (spec notification shape): a dynamic call only ever originates inside a model
// turn; a park attempted with no active turn is settled cancelled immediately by the seam (Task 4).
export type CallToolResultLike = { content: Array<Record<string, unknown>>; isError?: boolean };
export class DynamicCalls {
  constructor(emit: (ev: { kind: "requested"; entry: PendingToolCall } | { kind: "settled"; callId: string }) => void);
  /** Park one call; resolves with the MCP-shaped result. callId = `dyncall:${randomUUID()}` — OPAQUE
   *  (settlement authority must not be guessable; review finding 5). `signal` abort → settle cancelled. */
  park(entry: Omit<PendingToolCall, "callId">, signal?: AbortSignal): Promise<CallToolResultLike>;
  respond(callId: string, epochNow: number, result: CallToolResultLike): { ok: true } | { ok: false; code: "unknown" | "alreadySettled" };
  pending(): PendingToolCall[];
  reset(reason: string): void;      // reopen/engine-swap/turn-interrupt: settle all as cancelled naming `reason`, NO latch
  teardown(reason: string): void;   // close/shutdown: settle + latch — a park() after teardown resolves cancelled IMMEDIATELY
}
```

`respond` on a live entry whose `epoch !== epochNow` → `alreadySettled` (never applied — the swap's `reset()` normally beats it; the check is the belt for the in-flight race). Tombstone ring: `string[]` max 128 + a `Set` mirror. Cancelled settles resolve `{content:[{type:"text",text:"Tool call cancelled: <reason>"}], isError:true}` — the callback always answers (D-M4-9).

**The shared media parser (review finding 10):** `turnItems.ts`'s `decodeDataUrl` is module-private and deliberately DISCARDS the declared media type (the images round sniffs bytes instead — right for the SDK image union, wrong here: M7's audio blocks cannot be sniffed by the harness). Export from `turnItems.ts` a bounded parser
`export function parseDataUrl(url: string): { ok: true; payload: string; mimeType: string } | { ok: false; reason: string }`
— header split + base64 validation + the same `MAX_DATA_URL_CHARS` payload bound reused from `decodeDataUrl`'s internals (refactor `decodeDataUrl` to call it; the images-round suites `test/unit/turn-items.test.ts` MUST stay green untouched). `mimeType` comes from the header (declared), because M7 hands it to MCP blocks verbatim.

```ts
// dynamicTools.ts
/** Wire items → MCP blocks under the result caps. The payload budget is UTF-8 BYTES OF THE EMITTED
 *  CONTENT — sum Buffer.byteLength over every produced block's text/data/mimeType strings — so a
 *  multibyte text result cannot smuggle 3× the cap through a character count, and MIME metadata is
 *  budgeted too. Over-cap (items > MAX_RESULT_ITEMS or bytes > MAX_RESULT_PAYLOAD_BYTES) → an isError
 *  text block NAMING the cap. Malformed media (parseDataUrl not-ok) OR a MIME family mismatch
 *  (inputImage with a non-image/* type, inputAudio non-audio/*) → isError naming the item index and
 *  reason — NEVER a throw (a throw before respond would leave the call parked forever). */
export function toCallResult(items: ToolCallContentItem[], success: boolean): CallToolResultLike;
```

- [ ] **Step 1: Failing tests** — `test/unit/appserver/dynamic-calls.test.ts`, registry-direct (no wire): park→respond resolves the promise with the result; first answer wins, second → `alreadySettled`; fabricated id → `unknown`; tombstone ring forgets entry 1 after 130 settles (1→`unknown`, 129/130→`alreadySettled`); epoch-mismatch respond → `alreadySettled` and the promise resolves via `reset()` not the stale result; pre-aborted signal parks-and-immediately-cancels; abort mid-park cancels; `teardown()` settles all AND a subsequent `park()` resolves cancelled immediately (post-teardown re-park — finding 9); `reset()` settles all without latching (a park after reset works); `toCallResult`: 3-kind conversion, 17 items → isError naming `16`; the byte budget MEASURED — a 60_000-char Hangul text (~180_000 UTF-8 bytes, which a UTF-16 character count would have PASSED) → isError naming the payload cap, while a 130_000-byte ASCII text passes, both boundaries asserted with `Buffer.byteLength` in the test; an `inputImage` whose data: header declares `text/plain` → isError naming the MIME family; malformed `data:` audio → isError naming the reason (no throw); `parseDataUrl` unit rows incl. the payload bound; `npx vitest run test/unit/turn-items.test.ts` stays 21/21 after the refactor.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → both suites PASS.
- [ ] **Step 5: Commit** — `git add src/appserver/dynamicCalls.ts src/appserver/dynamicTools.ts src/appserver/turnItems.ts test/unit/appserver/dynamic-calls.test.ts && git commit -m "feat(appserver): DynamicCalls registry — opaque ids, tombstones, every settle path answers"`

---

### Task 4: The wire trio + lifecycle seams

**Files:**
- Create: `src/appserver/schema/dynamicTools.ts`
- Modify: `src/appserver/schema/index.ts` (+`tool/callResult`), `src/appserver/server.ts` (handler + `dynamicCalls` map/mint/release + `parkToolCall`/`pendingToolCalls` seams), `src/appserver/subscribe.ts:131-133` (replay), `src/appserver/rewind.ts` (`swapEngine` reset + `threadReopen` reset), **`src/appserver/turns.ts` (`turn/interrupt` settles pending dynamic calls "turn interrupted" BEFORE awaiting `record.session.interrupt()` — r3 finding 5: if the engine's interrupt waits on the in-flight MCP handler, and that handler awaits `tool/callResult`, the request deadlocks; also cover `decision/respond`'s abortTurn arm)**, shutdown path (`AppServer.close` — find where decisions tear down)
- NOTE (r3 finding 8): the DECLARATION surface — `dynamicTools` on `threadStartParams`/`threadResumeParams`, `validateDeclarations` wiring, `record.dynamicTools` stamping — moves to Task 5, landing in the SAME commit that installs working servers. Task 4 exposes only the call trio, which is inert without declarations (`parkToolCall` is its test seam and Task 5's production caller).
- Test: `test/unit/appserver/dynamic-tools.test.ts` (NEW — the wire matrix)

**Interfaces:**
- Consumes: T2's `validateDeclarations` + types; T3's `DynamicCalls`/`toCallResult`.
- Produces (Tasks 5–6 rely on): `srv.parkToolCall(threadId: string, generation: number, call: { namespace?: string; tool: string; arguments: Record<string, unknown> }, signal?: AbortSignal): Promise<CallToolResultLike>` — **`generation` is the IMMUTABLE token the server-build closure captured at ITS build time** (r2 finding 1: `swapEngine` bumps `record.epoch` BEFORE disposing the outgoing engine, so a late callback from the OLD engine's retained instance would otherwise be stamped with the replacement's epoch and turn). The seam refuses stale callers up front: `if (generation !== record.epoch)` → resolve cancelled immediately ("engine generation superseded"), touching no registry state. It then stamps `threadId`, `epoch: generation`, and `turnId = activeTurnId(record)` internally — and **a park with NO active turn resolves cancelled immediately** ("no active turn") — a dynamic call only ever originates inside a model turn, so an idle callback is stale or foreign by definition. `srv.pendingToolCalls(threadId): PendingToolCall[]` (same visibility as `pendingDecisions`, server.ts:990). `ThreadRecord.dynamicTools?: DynamicToolSpec[]` stamped at create/start.

`schema/dynamicTools.ts` (the METHOD only — the declaration shapes land in Task 5 with the servers):

```ts
export const toolCallResultParams = z.object({
  threadId: z.string().min(1), callId: z.string().min(1),
  contentItems: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("inputText"), text: z.string() }),
    z.object({ type: z.literal("inputImage"), imageUrl: z.string().startsWith("data:") }),
    z.object({ type: z.literal("inputAudio"), audioUrl: z.string().startsWith("data:") }),
  ])),  // NO count bound here — over-cap SETTLES isError (Global Constraints); the frame cap backstops
  success: z.boolean(),
});
```

Handler `toolCallResult` (dispatch beside `decision/respond`, server.ts:511 region): resolve record (`-33004`); **subscriber check FIRST**: `if (!record.subscribers.has(ctx.peer)) → -32602 "only a subscriber of this thread can settle its tool calls"` (review finding 5); then `respond(callId, record.epoch, toCallResult(items, success))` → `unknown` → `-32602` "no such pending tool call"; `alreadySettled` → `-33002`; ok → `{}`.

The DynamicCalls registry mints beside `makeDecisions` (:943 pattern) unconditionally (declarations arrive in Task 5; an empty registry is inert), releases in `closeRecord` (:886 — `teardown("thread closed")` + map delete), resets in `threadReopen`, resets in `swapEngine` **immediately after the epoch bump and BEFORE the `session.dispose()` await** (r2 finding 6: dispose can wait on the parked handler's promise — reset-after-dispose is a circular wait; the ordering is part of the contract, state it in a comment at the call site), settles in **`turn/interrupt` (turns.ts) with reason "turn interrupted" BEFORE the `record.session.interrupt()` await** (r3 finding 5 — same circular-wait shape; the `decision/respond` abortTurn arm routes through the same site), and tears down in the server shutdown path beside decisions. `reset`/`teardown` take the reason string that lands in the cancellation note (T3's signatures gain `reason: string`).

- [ ] **Step 1: Failing wire rows** — `test/unit/appserver/dynamic-tools.test.ts` (boot idiom from `decisions.test.ts`; park via `srv.parkToolCall` — declarations don't exist on the wire until Task 5, whose Step 1 owns the declaration wire rows):
  - park → subscriber receives `tool/callRequested` (full shape, `callId` matches `/^dyncall:[0-9a-f-]{36}$/`); watcher-only peer receives NOTHING;
  - **a watcher (and a second initialized-but-unsubscribed conn) sending `tool/callResult` with the REAL callId → the non-subscriber refusal, park still pending** (finding 5's authority row);
  - zero-subscriber park waits; subscribe replays the full pending request; disconnect-then-reattach settlement;
  - first-answer-wins; duplicate → `-33002`; fabricated → `-32602`; 17-item result settles isError (method replies `{}`); **65-item result ALSO settles isError** (finding 6 — no schema count bound);
  - lifecycle: abort signal; `thread/close` with a park OPEN — **the fake session's `dispose()` resolves only after the park settles** (the deadlock-shaped fake: `dispose: () => pendingSettled`), assert close COMPLETES and the park resolved cancelled; **the SAME deadlock-shaped fake on the rewind swap** (r2 finding 6: dispose waits on the park; the swap completes only if reset precedes the dispose await) and on `thread/clear`; **`turn/interrupt` with a park OPEN and a deadlock-shaped `interrupt()` (resolves only after the park settles) → the interrupt COMPLETES and the park resolved "turn interrupted"** (r3 finding 5); server `close()` (shutdown row); `thread/reopen` reset; old-generation reuse: park → rewind swap (epoch bump) → new park → answer the OLD callId → `-33002`, the NEW park untouched; **stale-generation caller: `srv.parkToolCall(threadId, oldEpoch, …)` after a swap resolves cancelled immediately with no registry entry and no notification** (r2 finding 1); a park attempted with no active turn resolves cancelled immediately;
  - replay ordering: pending-decision replay first, then `tool/callRequested`, then `thread/status/changed` (subscribe.ts:131-133 slot).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → suite + full `test/unit/appserver` + `npm run emit-schema` + `npx vitest run test/unit/schemaGen.test.ts` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/appserver/schema/dynamicTools.ts src/appserver/schema/index.ts src/appserver/server.ts src/appserver/subscribe.ts src/appserver/rewind.ts src/appserver/turns.ts src/appserver/dynamicCalls.ts test/unit/appserver/dynamic-tools.test.ts schema/json/stable/appserver.json && git commit -m "feat(appserver): the tool/callRequested-callResult trio — subscriber authority, replay, every teardown answers"`

---

### Task 5: Per-engine server building + the transient overlay

**Files:**
- Create: `src/appserver/dynamicServers.ts`
- Modify: `src/appserver/schema/threads.ts` (declaration shapes + params — moved here from Task 4 per r3 finding 8), `src/appserver/registry.ts` (`dynamicTools` field), `src/config/types.ts` (`dynamicToolServers?: Record<string, unknown>` on the config type `resolveOptions` reads — SERVER-OWNED, see below), `src/config/resolveOptions.ts`, `src/appserver/server.ts:423-460` (declaration validation) + `:722-733` + `:757-799`, `src/appserver/rewind.ts` (`swapBaseConfig` + `defaultReopenFactory` + `defaultResumeAtFactory`), **`src/appserver/settingsOps.ts` (`defaultFreshFactory` — `thread/clear`'s factory lives HERE, not in rewind.ts)**, `src/appserver/mcp.ts:115-158` (the refusal), **`src/session/session.ts` (or wherever the in-process built-ins inject — export `INJECTED_SERVER_NAMES` beside the injection code; r3 finding 3)**
- Test: `test/unit/appserver/dynamic-tools.test.ts` (declaration wire rows + overlay rows), the existing resolveOptions suite (find it: `grep -rl "resolveOptions" test/unit | head -3`)

**Interfaces:**
- Consumes: T2 types + `validateDeclarations`, T4's `srv.parkToolCall`, T1's converter, the LOW-LEVEL `Server` from `@modelcontextprotocol/sdk/server/index.js` (see the header — `createSdkMcpServer`/`tool()` are NOT used: both zod paths were measured losing the declared bounds in tools/list).
- Produces:

```ts
// src/appserver/dynamicServers.ts
/** Declarations → FRESH low-level MCP Server instances, one per namespace + `dyn` for bare functions.
 *  ListTools advertises each tool's VERBATIM declared JSON Schema + _meta["anthropic/alwaysLoad"]
 *  (deferLoading !== true) — zod-mediated advertisement measurably drops bounds (plan header).
 *  CallTool validates arguments with jsonSchemaToZod's converted schema (passthrough/strict live
 *  here; an invalid argument set returns an MCP validation error, never parks), then parks.
 *  Never cached on the record, never in record.config (instances are single-transport — spec
 *  finding 6): call at EVERY engine construction, hand the result ONLY to the transient engine
 *  config as {type:"sdk", name, instance} entries. */
export function buildDynamicServers(
  specs: DynamicToolSpec[],
  park: (call: { namespace?: string; tool: string; arguments: Record<string, unknown>; signal?: AbortSignal }) => Promise<CallToolResultLike>,
): Record<string, unknown>;
export function overlayServerNames(specs: DynamicToolSpec[]): string[];  // namespaces + ("dyn" iff bare functions exist)
```

Server construction: `new Server({ name, version: "1.0.0" }, { capabilities: { tools: {} }, instructions: description })`; `setRequestHandler(ListToolsRequestSchema, …)` returns `{ tools: [{ name, description, inputSchema: <the verbatim declared schema>, _meta: { "anthropic/alwaysLoad": spec.deferLoading !== true } }] }`; `setRequestHandler(CallToolRequestSchema, (req, extra) => …)` parses `req.params.arguments` with the converted zod schema and parks `{ namespace, tool, arguments: parsed, signal: extra?.signal }` (the MCP `RequestHandlerExtra` carries `signal` — verify in the vendored types and report). **Declaration wiring** (moved from T4): `threadStartParams`/`threadResumeParams` gain `dynamicTools: z.array(dynamicToolSpec).optional()` (shapes in `schema/threads.ts` importing `MAX_TOOL_DESCRIPTION_CHARS`); the handlers run `validateDeclarations(specs, occupiedNames)` with `occupiedNames = [...Object.keys(cfg?.mcpServers ?? {}), ...Object.keys((cfg?.extraOptions as {mcpServers?: object} | undefined)?.mcpServers ?? {}), ...INJECTED_SERVER_NAMES]`; failure → `-32602`; **a client config or extraOptions carrying `dynamicToolServers` → `-32602` "dynamicToolServers is server-owned"** (r3 finding 2); success → stamp `record.dynamicTools`; regenerate the published schema artifact here (this is the wire-visible commit).

**The transient engine config (review finding 4 — the load-bearing correction):** `record.config` must NEVER hold instances. At `createThread`/`startThread`:

```ts
const specs = opts.dynamicTools;                       // validated by Task 4's handler
const cfg = buildConfig(parsed, broker, onElicitation); // the serializable base — this is what record.config stores
const engineCfg = specs?.length
  ? { ...cfg, dynamicToolServers: buildDynamicServers(specs, parkFn) }   // transient — factory-only
  : cfg;
const session = factory(engineCfg);
// record literal: config: cfg  (NOT engineCfg — assert in tests)
```

with `parkFn` capturing the BUILD-TIME generation (r2 finding 1 — the token is immutable per server build, so a retained old instance identifies itself):

```ts
const generation = record.epoch;   // sampled ONCE, when this engine's servers are built
const parkFn = (call: { namespace?: string; tool: string; arguments: Record<string, unknown>; signal?: AbortSignal }) =>
  srv.parkToolCall(threadId, generation, { namespace: call.namespace, tool: call.tool, arguments: call.arguments }, call.signal);
```

(at initial create the epoch is 0; each swap factory samples the post-bump epoch at ITS build). Swap paths: `swapBaseConfig(record)` (rewind.ts:120) stays instance-free; each factory — `defaultReopenFactory` (rewind.ts), `defaultFreshFactory` (**settingsOps.ts**), `defaultResumeAtFactory` (rewind.ts) — wraps its config the same transient way from `record.dynamicTools` — all three MUST flow through one helper (`withDynamicServers(srv, record, cfg)`); verify and say so in the report.

**`resolveOptions` merge-last (review finding 3 — operate on the RETURNED object):** the function builds and returns a merged object after the `extraOptions` spread + `SERVER_OWNED` re-assertion (:133-134). Whatever that final local is named, add IMMEDIATELY BEFORE the return, on THAT object:

```ts
if (config.dynamicToolServers) merged.mcpServers = { ...(merged.mcpServers as Record<string, unknown> ?? {}), ...config.dynamicToolServers };
```

(read the function first; if the final object is `options` itself the review's concern is moot — pin it with the test either way). Test row: `extraOptions.mcpServers = {clobber:{}}` + `dynamicToolServers` → the RETURNED options' `mcpServers` carries both `clobber` and the overlay keys, overlay winning on collision.

**`mcpServer/set` refuses on declaring threads (review finding 7 — the conservative fallback):** in `mcpSet` (mcp.ts:115), before the chain: `if (record.dynamicTools?.length) → -32602 "this thread declares dynamic tools; mcpServer/set is unavailable on it until dynamic-declaration survival across a runtime set is verified (see the M7 spec Decision Log)"`. No merge attempt, no repush change (the repush map never contains overlay entries — the BUILD config carries them). Relaxation is gated on the keyed survival row (Task 6) and is EXPLICITLY out of this plan.

- [ ] **Step 1: Failing rows** — fake factory captures its config; fake engine captures `setMcpServers`:
  - **declaration wire rows (moved from T4):** each T2 semantic refusal arrives as `-32602` through the wire (spot-check: cap, an `extraOptions.mcpServers` collision, a `cc-context` collision, `oneOf`); shape refusals (bad name format, description over 2_000) → schema `-32602`; the Codex fixture accepted at `thread/start` AND `thread/resume` (DI store fake); resume with an INVALID set refuses; **hostile `config.dynamicToolServers` and `extraOptions.dynamicToolServers` at thread/start → the server-owned refusal, and a review-inheritance row: after a legit declaring start, `record.config` round-trips `JSON.stringify` cleanly with NO `dynamicToolServers`/`instance` anywhere** (r3 finding 2);
  - thread/start with ns+bare → factory config's `dynamicToolServers` keys `[ns,"dyn"]` AND `record.config` has NO `dynamicToolServers` key; `thread/resume` with declarations → the `startThread` spine's factory ALSO receives fresh `dynamicToolServers`; `mcpServer/set` on the declaring thread → the refusal; on a NON-declaring thread → unchanged behavior (existing mcp suite stays green); swap rows for ALL THREE paths — rewind, `thread/clear`, `thread/reopen` — each: factory re-called, fresh `dynamicToolServers` object AND fresh NESTED instance identity (`captured1.dynamicToolServers[ns] !== captured2.dynamicToolServers[ns]`); resolveOptions merge-last row (above); `overlayServerNames` unit rows.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → suite + full `test/unit/appserver` + the resolveOptions suite + the existing mcp suite + `npm run emit-schema` + `npx vitest run test/unit/schemaGen.test.ts` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/appserver/dynamicServers.ts src/appserver/schema/threads.ts src/appserver/registry.ts src/config/types.ts src/config/resolveOptions.ts src/appserver/server.ts src/appserver/rewind.ts src/appserver/settingsOps.ts src/appserver/mcp.ts src/session/session.ts test/unit/appserver/dynamic-tools.test.ts schema/json/stable/appserver.json <the resolveOptions suite file you extended> && git commit -m "feat(appserver): dynamic tools go live — verbatim advertisement, transient overlay, server-owned carrier"`

---

### Task 6: The exchange across the production wiring, live test, scorecard closure

**Files:**
- Test: `test/unit/appserver/dynamic-tools-exchange.test.ts` (NEW), `test/live/appserver-dynamic-tools.test.ts` (NEW, keyless-skip)
- Modify: `CC-to-SDK/docs/parity/appserver.md`, the spec's living tail

**Interfaces:** consumes everything. MCP client: `import { Client } from "@modelcontextprotocol/sdk/client/index.js"; import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";` — resolve through the agent-sdk's dependency tree; if not importable, add a devDependency at the agent-sdk's vendored version and record the choice.

- [ ] **Step 1: Exchange rows** (`dynamic-tools-exchange.test.ts`) — TWO layers:
  - *Instance-direct* (fidelity): `buildDynamicServers` with a synthetic park; `client.listTools()` advertises **the VERBATIM declared JSON Schema — deep-equal against the declaration object itself** (the low-level Server owns the advertisement, so this is exact, not structural; a deep-equal failure means the builder mutated the declaration); **the initialize result carries the namespace description as `instructions`**; passthrough extras reach the park's `arguments` AND `additionalProperties:false` arguments with extras are refused at CallTool with an MCP validation error (never parked); an argument set violating a declared bound (e.g. `minLength`) likewise errors without parking; `_meta["anthropic/alwaysLoad"]` asserted in tools/list: `true` for omitted/false `deferLoading`, `false` for `deferLoading:true`; **the handler's `extra.signal` reaches the park callback** (abort the client call, observe the cancellation).
  - ***Production-wiring*** (the seam-crossing rows): boot a REAL `AppServer` with a factory that CAPTURES its engine config AND parks its submit (so a turn can be held ACTIVE — `parkToolCall` requires an active turn); `thread/start` declares one namespace tool and one bare tool; start a turn (fake engine holds it in flight); take `capturedConfig.dynamicToolServers[ns].instance`, connect it over `InMemoryTransport.createLinkedPair()`; `client.callTool(...)` → the wire subscriber observes `tool/callRequested` (with the ACTIVE turnId); answer via the REAL `tool/callResult` method — **three rows, one per content kind: text, image (small PNG data: URL), audio (data: URL)** (r2 finding 7: the spec's "all three kinds cross tools/call → park → real wire answer → MCP result" must ride the PRODUCTION path, not only the synthetic one) → `callTool` resolves with the corresponding block. These rows cross T5's `parkFn` closure (generation token included), T4's identity stamping, and T3's registry keylessly.
- [ ] **Step 2: Live test** (`test/live/appserver-dynamic-tools.test.ts`, key-gated header per `test/live/appserver-image-input.test.ts`; quota note: first keyed run after 2026-08-26 1pm): scenario A (spec row 6): one thread, the probe-115 `{ticket: string}` tool; assert IN ORDER: `decision/requested` for the `mcp__dyn__…` tool (allow over the wire) → `tool/callRequested` (answer `inputText` "42") → `mcp`-species `item/completed` → model reply contains `42`; plus the `mcpServer/set` refusal on the declaring thread. **Scenario B (spec row 7 — NOT replaced, r2 finding 7): schema fidelity across N=3 model calls — a tool with a `required` field; assert every `tool/callRequested.arguments` carries it** (the in-memory tools/list row is the deterministic half; this is the model-behavior half). Keyless run now → clean skip.
- [ ] **Step 3: Scorecard** — `docs/parity/appserver.md`: server-origin section rows (table at :739): `tool/callResult` and `tool/callRequested` enter as **`probe-gated`** (r3 finding 6, the scorecard's own vocabulary — the keyless exchange pins the MCP layer, but the agent-sdk BRIDGE, permission ordering, stream species, and model schema adherence are keyed-only claims; the rows say so and name the flip condition: both keyed scenarios green after 2026-08-26 1pm, then a follow-up commit flips them to shipped(M7)); `thread/start`/`thread/resume` `dynamicTools` notes; the `mcpServer/set` row gains the declaring-thread refusal sentence; prose inventories :55/:285/:306; totals. From `CC-to-SDK/`: `node scripts/drift-check.mjs` → exit 0.
- [ ] **Step 4: Full acceptance** — the spec's keyless rows 1–5 verbatim (its `## Acceptance` — note row 1's file list maps onto the split test files; run all of them), full `npx vitest run test/unit/appserver`, `npx tsc --noEmit`.
- [ ] **Step 5: Spec retro** — replace the Pending line, STATING the probe-gate: the keyless closure is the MCP layer + wire + lifecycle; the keyed scenarios (bridge, permission ordering, stream species, model adherence) are the flip condition, first runnable after 2026-08-26 1pm. Surprises for anything execution overturned (the zod-advertisement measurement is already recorded by the planning pass).
- [ ] **Step 6: Commit** — explicit paths — `git commit -m "feat(appserver): M7 acceptance — the exchange crosses production wiring; rows probe-gated on the keyed run"`

---

### Final verification (inside Task 6, restated)

Spec acceptance rows 1–5 keyless, all green; rows 6–7 keyed, deferred past 2026-08-26 1pm with the live file skipping cleanly — and the scorecard rows stay `probe-gated` until they pass (the flip to `shipped(M7)` is a follow-up outside this plan). Full unit suite green before the final commit.

## Revision Notes (plan)

- rev 1 (2026-08-24): five tasks.
- rev 2 (2026-08-24): the adversarial plan review — 20 findings, 19 accepted after verification, 1 rejected (the "10K-token repository maximum" it cited for the result cap does not exist; the spec's approved 128 KiB stands). Accepted: transient engine config so `record.config` never holds instances; merge-last applied to the RETURNED options object; subscriber-only settlement authority + opaque callIds; no schema count bound on contentItems (over-cap always settles); `mcpServer/set` conservative refusal on declaring threads; a production-wiring exchange row; deadlock-shaped dispose fakes + shutdown + post-teardown re-park rows; the shared `parseDataUrl` extraction (declared MIME, not sniffed); Task 2 made wire-silent (params exposed only when tools can run); identity stamped inside `parkToolCall`; effective-MCP-map collisions (extraOptions included); UTF-8 byte caps; root keyword allowlist; duplicate-namespace refusal; all three swap paths + nested identity; Task 3 split (registry/conversion vs wire/lifecycle). Review base for M7 reviews: `781683b4cf`.
- rev 4 (2026-08-24): plan re-review round 3 — 8 findings; 7 accepted (2 modified), and finding 1's v3-preserves claim was REFUTED by a controller-run measurement that surfaced a WORSE truth: built zod objects (v3 AND v4) lose descriptions+bounds+int in tools/list, and raw shapes keep only descriptions — no zod path can advertise the declared schema. The design therefore moves to the LOW-LEVEL MCP `Server` with verbatim JSON Schema advertisement and jsonSchemaToZod validation at CallTool. Also: `dynamicToolServers` made server-owned (client config/extraOptions carrying it refuses; hostile + review-inheritance rows); INJECTED_SERVER_NAMES reserved UNCONDITIONALLY (a maybe-injected name is not declarable; the settings/plugin-discovery residual is a published bound, not a refusal — modification of the reviewer's refuse-when-non-strict); NATIVE_TOOL_NAMES pinned with an sdk.d.ts-parsing drift test (45 interfaces at 0.3.237; the memory-referenced probe is not a repo artifact); turn/interrupt (and abortTurn) settles pending calls before the engine-interrupt await, deadlock-shaped row added; scorecard rows enter `probe-gated`, flipping to shipped only after both keyed scenarios pass (modification of the reviewer's defer-everything); converter made value-domain TOTAL (never throws); the declaration surface moved from Task 4 to Task 5 so acceptance and working servers land in one commit.
- rev 3 (2026-08-24): plan re-review round 2 — 8 findings, all accepted. Build-time GENERATION token in every server closure (`parkToolCall` refuses stale generations up front; a late callback from a disposed engine can no longer be stamped as the replacement's); `turnId` required — no-active-turn parks resolve cancelled; the collision set covers every `overlayServerNames` product (`dyn` included) against the occupied set incl. `INJECTED_SERVER_NAMES` (cc-context/cc-compact land AFTER resolveOptions); `NATIVE_TOOL_NAMES` pinned from the complete measured catalog, not the display classifier (TaskCreate/AskUserQuestion rows prove it); result caps in UTF-8 bytes of the EMITTED content incl. MIME metadata + MIME family validation; `settingsOps.ts` (thread/clear's factory) added to Task 5's files and commit; a `thread/resume` factory-capture row; swap reset ordering pinned (after the epoch bump, BEFORE the dispose await) with deadlock-shaped swap/clear fakes; the production exchange crosses all THREE content kinds inside an active turn + instructions and extra.signal assertions; live scenario B restores spec row 7's N-call schema fidelity; byte-boundary fixtures constructed programmatically at exactly 8_192/8_193.
