# M7 dynamic tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan rev 6** — five adversarial review rounds folded in (Revision Notes). **Review base for every M7 review is `781683b4cf`.**

**Goal:** A client declares tools at `thread/start`/`thread/resume` and IS the tool runtime — the model's call parks and travels to thread subscribers as `tool/callRequested`, the client's `tool/callResult` settles it — with zero wire-grammar change (the park trio).

**Architecture:** The spec is `CC-to-SDK/docs/superpowers/specs/2026-08-23-agent-appserver-m7-dynamic-tools-design.md` (rev 3, updated through planning round 5) — read it first; on any conflict the spec wins. Nine tasks, bottom-up, each a reviewable unit: converter → declaration semantics → registry → wire trio → lifecycle+status → server builder → overlay plumbing → declaration exposure (the ONE wire-visible commit) → acceptance. Declarations are serializable thread state (never config); fresh MCP server instances are built per engine construction on a server-owned transient carrier.

**Tech Stack:** TypeScript ESM (imports end `.js`), zod v4, vitest, `@modelcontextprotocol/sdk` (added to `dependencies` — production code imports it; a devDependency or peer-transitive resolution breaks strict installs).

**The advertisement path (rev 4, controller-measured):** BOTH zod paths lose declared constraints in `tools/list` (built objects v3+v4 lose descriptions+bounds+`.int()`; raw shapes keep only descriptions). So the builder constructs a **fresh `McpServer` wrapper and installs explicit handlers on `wrapper.server`** (the exposed low-level `Server` — this satisfies the Agent SDK's declared `instance: McpServer` type instead of structurally faking it; r5 finding 3). **The tools CAPABILITY must be registered BEFORE either handler is installed** (r6 finding 1: `setRequestHandler` in the pinned MCP SDK throws "Server does not support tools" against unregistered capabilities — construct with `{capabilities: {tools: {}}, instructions}` or call `wrapper.server.registerCapabilities({tools:{}})` first; the exchange asserts initialize ADVERTISES the capability). Handlers: `ListToolsRequestSchema` → each tool's **VERBATIM declared JSON Schema** + `_meta: {"anthropic/alwaysLoad": spec.deferLoading !== true}`; `CallToolRequestSchema` → validate `req.params.arguments ?? {}` (the MCP contract makes `arguments` OPTIONAL — a zero-argument call of an empty-object tool must park, not fail) with `jsonSchemaToZod`'s converted schema (passthrough/strict live here; invalid arguments return an MCP validation error, never park), then park. Entries are `{type: "sdk", name, instance: wrapper} satisfies McpSdkServerConfigWithInstance`. The implementer MUST verify a bare `McpServer` with zero registered tools does not install its own conflicting ListTools handler — and report the finding.

## Global Constraints

- **Caps (named once in `src/appserver/dynamicTools.ts`):** `MAX_DYNAMIC_TOOLS = 32` functions total; per-tool `inputSchema` ≤ 8_192 UTF-8 bytes (`Buffer.byteLength(JSON.stringify(schema), "utf8")`), ≤ 8 deep, ≤ 64 nodes; `MAX_TOOL_DESCRIPTION_CHARS = 2_000`; result `MAX_RESULT_ITEMS = 16`, `MAX_RESULT_PAYLOAD_BYTES = 131_072` — UTF-8 bytes of the EMITTED MCP content (every block's `text`/`data`/`mimeType` summed). Over-cap results **settle `isError` naming the cap, never refuse the method**; the wire schema puts NO count bound on `contentItems`. `inputImage` MIME must be `image/*`, `inputAudio` `audio/*` — mismatch settles `isError`.
- **Names:** `toolName` regex `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/` **plus a NO-`__` rule on namespaces AND function names** (r5 finding 2: `__` is the SDK's delimiter — `ops` + `prod__run` and `ops__prod` + `run` both read `mcp__ops__prod__run`; refuse the substring in either position, tested in both orientations). Namespace `dyn` RESERVED; duplicate namespaces refused. Collisions compare **CANONICAL model-visible names** (the SDK normalizes chars outside `[A-Za-z0-9_-]` to `_`): every `overlayServerNames` product (incl. `dyn`) vs the occupied set = normalized keys of **the effective pre-overlay MCP map under `resolveOptions`' OWN-PROPERTY replacement semantics** — `"mcpServers" in extraOptions ? extraOptions.mcpServers : config.mcpServers`, names enumerated only when the selected value is record-like (an own `null` or `{}` replaces the typed map and occupies NOTHING) — plus `INJECTED_SERVER_NAMES` (Session's in-process built-ins, reserved UNCONDITIONALLY even when flag-gated off; export the const beside the injection code). Settings/plugin-discovered servers under non-strict MCP config cannot be enumerated at declaration time — a PUBLISHED bound, not a refusal. Function names checked against `NATIVE_TOOL_NAMES` (Task 2's drift-gated map). Every declaration refusal is `-32602` naming the offender.
- **Settlement authority is subscribers-only, enforced twice:** `tool/callResult` refuses a non-subscriber peer BEFORE any registry lookup, and `callId`s are opaque (`dyncall:<randomUUID()>`).
- **Errors:** unknown `callId` → `-32602` "no such pending tool call"; already-settled/stale-generation → `-33002`; non-subscriber → `-32602` "only a subscriber of this thread can settle its tool calls" (`ERR`, `src/appserver/rpc.ts:12`). Tombstone ring 128.
- **`alwaysLoad: spec.deferLoading !== true`** — Codex's polarity.
- **`record.config` NEVER holds runtime handles**; the overlay rides ONLY the transient engine config (`dynamicToolServers`, SERVER-OWNED: client `config` or `extraOptions` carrying the key refuses `-32602` "dynamicToolServers is server-owned" on BOTH admission spines). **`review/start` deliberately does NOT inherit declarations** (spec rev 3) — pinned by a real row.
- **`mcpServer/set` on a declaring thread refuses** (conservative until the keyed survival row).
- **Content items camelCase**; conversion `inputText`→text, `inputImage`→`{type:"image",data,mimeType}`, `inputAudio`→audio; `success:false`→`isError:true`; malformed media settles `isError` (never a throw — a throw would leave the call parked; D-M4-9).
- **Thread status must reflect a parked tool call** (r5 finding 6): `threadStatus`'s `waitingOn` gains the tool-call kind; status changes broadcast on park and on settlement; the M2 design deferred this until a second waiter kind existed — it now does.
- **Regenerate the published schema artifact in the same change** that touches `schema/index.ts`.
- Never run keyed/live tests (quota until 2026-08-26 1pm); live suites skip cleanly keyless; never read/print `CC-to-SDK/.env`. Never edit `scripts/drift-check.mjs`. NO Co-Authored-By trailers; `git add` explicit paths only. All commands from `CC-to-SDK/harness` unless stated.

---

### Task 1: `schemaToZod.ts` — the conversion subset (validation layer ONLY)

**Files:** Create `src/appserver/schemaToZod.ts`; Test `test/unit/schemaToZod.test.ts`.

**Interfaces** (Tasks 2 and 6 rely on):

```ts
export type ConvertOk = { ok: true; schema: z.ZodTypeAny; strict: boolean };
export type ConvertErr = { ok: false; keyword: string };
export function jsonSchemaToZod(schema: Record<string, unknown>): ConvertOk | ConvertErr;
```

Its ONLY consumer is Task 6's `CallToolRequestSchema` handler — advertisement is verbatim (plan header). `.strict()` iff `additionalProperties === false`, else `.passthrough()`.

**Root allowlist:** only `type`("object")/`properties`/`required`/`additionalProperties`(boolean)/`description`; `required` strings ⊆ properties keys. **Field allowlist:** `type`/`description`/`enum`/`const`/`minLength`/`maxLength`/`minimum`/`maximum`/`items`; first unknown key refuses naming itself; field or items `type:"object"` refuses `type:object (nested objects unsupported)`.

**Value-domain totality — conversion NEVER throws:** `properties` a plain object of plain objects; `minimum`/`maximum` finite numbers; **`minLength`/`maxLength` NON-NEGATIVE INTEGERS** (JSON Schema's requirement); `min > max` (either kind) refuses as inconsistent; `items` a plain object; `enum` non-empty, members matching `type`; `const` string/number/boolean. Defensive wrap → `{ok:false, keyword:"<path>: unsupported shape"}`, never `-32603`.

**String length counts CODE POINTS** (r5 finding 5): JSON Schema `minLength`/`maxLength` count Unicode code points; zod `.min()`/`.max()` count UTF-16 units — `{maxLength:1}` must ACCEPT `"😀"`. Implement as `.refine(v => [...v].length <= max)` (and min), not `.max()`.

- [ ] **Step 1: failing tests** — the rev-5 suite: object-root rows; root-keyword refusals (`oneOf`, `$ref`, schema-valued `additionalProperties` → `additionalProperties:<schema>`, dangling `required:b not in properties`); full field-subset conversion honoring `required`/bounds/int; passthrough default (extras SURVIVE `.parse`); strict refusal; field-keyword refusals; totality rows (`properties:null`, `minLength:"3"`, `maximum:Infinity`, `items:null`, `enum:[]`, `enum:[1]` on string — assert `.ok === false` each); **bounds rows: `minLength:-1` refuses, `maxLength:1.5` refuses, `minLength:2 > maxLength:1` refuses, `minimum:5 > maximum:1` refuses; `{maxLength:1}` accepts `"😀"` and rejects `"ab"`; `{minLength:2}` rejects `"😀"` and accepts `"😀a"`**.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: commit** — `git add src/appserver/schemaToZod.ts test/unit/schemaToZod.test.ts && git commit -m "feat(appserver): the M7 conversion subset — total, code-point-true, validation-only"`

---

### Task 2: Declaration semantics — caps, names, catalog (wire-SILENT)

**Files:** Create `src/appserver/dynamicTools.ts`; Test `test/unit/appserver/dynamic-tools-validate.test.ts`.

Nothing touches the wire, the schema registry, or `ThreadRecord` — Task 8 exposes declarations only when Task 6-7 have made them runnable.

**Interfaces** (Tasks 3–9 rely on):

```ts
export const MAX_DYNAMIC_TOOLS = 32; export const MAX_TOOL_DESCRIPTION_CHARS = 2_000;
export const MAX_SCHEMA_BYTES = 8_192; export const MAX_SCHEMA_DEPTH = 8; export const MAX_SCHEMA_NODES = 64;
export const MAX_RESULT_ITEMS = 16; export const MAX_RESULT_PAYLOAD_BYTES = 131_072;
export const RESERVED_NAMESPACE = "dyn";
export const NATIVE_TOOL_MAP: Readonly<Record<string, string>>;  // sdk-tools.d.ts interface → runtime name
export const RUNTIME_ONLY_NATIVE: readonly string[];             // native tools with NO interface in the union — "Skill", "ToolSearch", "LSP", "SendMessage" at minimum; BEST-EFFORT with provenance commented (r7 finding 3: the guard is client-UX protection against confusing names — model-level collision is already impossible since dynamic names are mcp__-prefixed; state that in the comment). The union's generic `McpInput` has NO single runtime name — EXCLUDE it from the map alongside `ToolOutputSchemas`, with a comment.
export const NATIVE_TOOL_NAMES: readonly string[];               // = [...Object.values(NATIVE_TOOL_MAP), ...RUNTIME_ONLY_NATIVE]
export function canonicalServerName(name: string): string;       // the SDK's normalization: /[^A-Za-z0-9_-]/g → "_"
export type DynamicToolFunction = { type: "function"; name: string; description: string; inputSchema: Record<string, unknown>; deferLoading?: boolean };
export type DynamicToolSpec = DynamicToolFunction | { type: "namespace"; name: string; description: string; tools: DynamicToolFunction[] };
export function overlayServerNames(specs: DynamicToolSpec[]): string[];  // namespaces + ("dyn" iff bare functions)
export function validateDeclarations(specs: DynamicToolSpec[], occupiedServerNames: string[]): { ok: true } | { ok: false; message: string };
```

`validateDeclarations` (semantic checks; shape is Task 8's zod): function count ≤ 32; per-tool schema byte/depth/node caps; `jsonSchemaToZod(...).ok`; **no `__` in any namespace or function name**; namespaces unique, ≠ `dyn`; every `overlayServerNames` product ∉ `occupiedServerNames.map(canonicalServerName)`; function names unique per namespace and within `dyn`; no function name ∈ `NATIVE_TOOL_NAMES`.

**The catalog drift test** (r4 f4 + r5 f9 + r8 f1): parse the vendored `sdk-tools.d.ts` `ToolInputSchemas` union — **45 raw `*Input` members at 0.3.237 (assert that count) plus the trailing `ToolOutputSchemas` reference; the extraction excludes `ToolOutputSchemas` AND the generic `McpInput` (no single runtime name) → 44 MAPPED members**; assert set equality of those 44 with `NATIVE_TOOL_MAP`'s keys; assert `FileEditInput→Edit`, `FileReadInput→Read`, `FileWriteInput→Write` explicitly. An SDK bump adding a tool forces a mapping decision.

- [ ] **Step 1: failing tests** — 33 functions → "32"; programmatic byte boundary (serialized form measured at EXACTLY 8_192 passes / 8_193 refuses, values asserted); depth 9; 65 nodes; `oneOf` names itself + the tool; namespace `dyn`; duplicate namespaces; **namespace `ops_prod` refused when occupied holds `ops.prod`** (canonicalization); **function `prod__run` refused; namespace `ops__prod` refused** (both `__` orientations); bare functions + occupied `dyn` refused; namespace `cc-context` refused; duplicate functions (both scopes); functions named `TaskCreate` and `AskUserQuestion`; **functions named `Skill` and `ToolSearch` refused** (runtime-only natives outside the union); the drift test; a Codex-shaped fixture → `{ok:true}`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: commit** — `git add src/appserver/dynamicTools.ts test/unit/appserver/dynamic-tools-validate.test.ts && git commit -m "feat(appserver): declaration semantics — canonical names, the drift-gated catalog"`

---

### Task 3: `DynamicCalls` registry + result conversion (pure)

**Files:** Create `src/appserver/dynamicCalls.ts`; Modify `src/appserver/dynamicTools.ts` (`toCallResult`), `src/appserver/turnItems.ts` (export `parseDataUrl`); Test `test/unit/appserver/dynamic-calls.test.ts`.

**Interfaces** (Tasks 4–9 rely on):

```ts
export type ToolCallContentItem = { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string } | { type: "inputAudio"; audioUrl: string };
export type PendingToolCall = { callId: string; threadId: string; turnId: string; namespace?: string; tool: string; arguments: Record<string, unknown>; epoch: number };
export type CallToolResultLike = { content: Array<Record<string, unknown>>; isError?: boolean };
export class DynamicCalls {
  constructor(emit: (ev: { kind: "requested"; entry: PendingToolCall } | { kind: "settled"; callId: string }) => void);
  park(entry: Omit<PendingToolCall, "callId">, signal?: AbortSignal): Promise<CallToolResultLike>;  // callId = `dyncall:${randomUUID()}`
  respond(callId: string, epochNow: number, result: CallToolResultLike): { ok: true } | { ok: false; code: "unknown" | "alreadySettled" };
  pending(): PendingToolCall[];
  reset(reason: string): void;      // reopen/swap/interrupt: settle all cancelled naming reason, NO latch
  teardown(reason: string): void;   // close/shutdown: settle + latch; park() after teardown resolves cancelled IMMEDIATELY
}
```

`respond` with a live entry whose `epoch !== epochNow` → `alreadySettled` (the belt; the swap's reset normally wins). Cancelled settles resolve `{content:[{type:"text",text:"Tool call cancelled: <reason>"}], isError:true}`. Tombstones: `string[]` 128 + `Set`. `turnId` REQUIRED — a dynamic call only originates inside a model turn.

**`parseDataUrl`** (extracted from `decodeDataUrl`'s internals, which it then calls; declared MIME kept — M7's audio cannot be sniffed): `(url) → {ok:true; payload; mimeType} | {ok:false; reason}`, `MAX_DATA_URL_CHARS` payload bound. `test/unit/turn-items.test.ts` stays 21/21 untouched.

**`toCallResult(items, success)`** — UTF-8-byte budget over the EMITTED blocks (text/data/mimeType summed); 17 items → isError naming `16`; MIME family checks; malformed media → isError naming index+reason; never throws.

- [ ] **Step 1: failing tests** — park→respond; first-wins; duplicate `alreadySettled`; fabricated `unknown`; ring forgets entry 1 after 130 (1→unknown, 129/130→alreadySettled); epoch-mismatch belt; pre-aborted + mid-park abort; teardown latch + post-teardown park cancels immediately; reset non-latching; reason strings land in the note; `toCallResult`: 3 kinds; 17 items; **60_000-char Hangul (~180_000 UTF-8 bytes) → isError while 130_000-byte ASCII passes (both asserted via `Buffer.byteLength`)**; `inputImage` declaring `text/plain` → isError; malformed audio → isError; `parseDataUrl` rows; turn-items 21/21.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → both suites PASS.
- [ ] **Step 5: commit** — `git add src/appserver/dynamicCalls.ts src/appserver/dynamicTools.ts src/appserver/turnItems.ts test/unit/appserver/dynamic-calls.test.ts && git commit -m "feat(appserver): DynamicCalls — opaque ids, tombstones, byte-true result caps"`

---

### Task 4: The call machinery — notification, replay, authority (method UNREGISTERED)

**Files:** Create `src/appserver/schema/dynamicTools.ts` (the schemas DEFINED, **not registered** — r6 finding 4: registering `tool/callResult` before declarations exist publishes an unusable stable method; Task 8 registers it beside the declaration exposure and regenerates the artifact there); Modify `src/appserver/server.ts` (the handler FUNCTION exported-but-undispatched + `dynamicCalls` map/mint/release beside decisions + `parkToolCall`/`pendingToolCalls` seams + the notification emit), `src/appserver/subscribe.ts:131-133` (replay); Test `test/unit/appserver/dynamic-tools.test.ts` (NEW).

**Interfaces** (Tasks 5–9 rely on): `srv.parkToolCall(threadId: string, generation: number, call: { namespace?: string; tool: string; arguments: Record<string, unknown> }, signal?: AbortSignal): Promise<CallToolResultLike>` — `generation` is the IMMUTABLE token the server-build closure captured at ITS build (swapEngine bumps `record.epoch` BEFORE disposing the old engine, so a late old-engine callback must identify itself); `generation !== record.epoch` → resolve cancelled immediately ("engine generation superseded"), no registry touch; **a `parkBarrier` latched by `turn/interrupt` and cleared only when the NEXT submit DISPATCHES → resolve cancelled immediately ("turn interrupted")** (r6 finding 3 + r8 finding 3: `record.interruptRequested` alone re-opens at the next `beginTurn`'s arrival-time clear, so a CallTool from the interrupted turn delayed past the next turn's start would be rebound to the successor; the barrier holds through that window — the runner's dispatch point, Task 5's `releaseSlot` vicinity, is where the old engine's work is provably behind the new submit. The residual — a request delayed past the next DISPATCH — is a published bound in the spec, not silently absorbed); stamps `threadId`/`epoch: generation`/`turnId = activeTurnId(record)` internally; NO active turn → resolve cancelled immediately ("no active turn"). `srv.pendingToolCalls(threadId)`.

`schema/dynamicTools.ts`: `toolCallResultParams = z.object({ threadId: min(1), callId: min(1), contentItems: z.array(<the 3-kind discriminated union — imageUrl/audioUrl are PLAIN `z.string()`, no startsWith("data:")>), success: z.boolean() })` — **media URLs are NOT schema-validated** (r8 finding 4: a `.startsWith` refusal would `-32602` a malformed URL BEFORE the handler and leave the call parked, contradicting the settle-as-isError contract; parsing and MIME-family validation live in `toCallResult`, which always answers) — NO count bound, and a `.describe()` on `contentItems` stating the images-round convention: the byte caps do not multiply — the whole request must still fit the 256 KiB inbound frame AFTER JSON escaping (control characters inflate ~6×), and an over-frame request dies -32700 with a null id BEFORE the handler, leaving the call parked but ANSWERABLE by a smaller retry (r7 finding 1; a test row proves the retry path: over-frame result → -32700, then a small result settles the same call) — **plus `toolCallResultResult = z.object({}).strict()`** (r6 finding 7: the registry supports result schemas and the stable artifact emits a `results` map; a generated client must be able to validate the acknowledgment). NEITHER is registered here — Task 8 registers `{ params, result }` and regenerates. Handler `toolCallResult` exported from `src/appserver/dynamicTools.ts` (or a sibling), NOT yet in the dispatch table: record (`-33004`) → **subscriber check FIRST** → `respond(callId, record.epoch, toCallResult(...))` → unknown `-32602` / alreadySettled `-33002` / ok `{}`. Notification `tool/callRequested` `{threadId, callId, turnId, namespace?, tool, arguments}` via `srv.broadcast` (subscribers only). Replay in subscribe.ts between pending decisions (:131-132) and status (:133). Registry mints beside `makeDecisions` (:943) unconditionally, releases in `closeRecord` (:886, `teardown("thread closed")`).

- [ ] **Step 1: failing rows** (boot idiom from `decisions.test.ts`; park via `srv.parkToolCall`; the handler driven DIRECTLY with a real ConnCtx from the booted wire — the dispatch entry arrives in Task 8, where these same behaviors get one wire-driven smoke): subscriber gets the full-shape notification (`callId` matches `/^dyncall:[0-9a-f-]{36}$/`); watcher-only peer gets NOTHING; **watcher and unsubscribed-initialized peers presenting the REAL callId → non-subscriber refusal, park pending**; zero-subscriber park waits, subscribe replays the full request, disconnect-then-reattach settles; first-wins/duplicate/fabricated; 17-item AND 65-item results settle isError (handler acks `{}`); stale-generation park resolves cancelled with no notification; **park during the interrupt window (`record.interruptRequested` up) resolves cancelled immediately**; no-active-turn park cancels; replay ordering decisions→toolCalls→status.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → suite + full `test/unit/appserver` + `npx tsc --noEmit` (no artifact change — nothing registered).
- [ ] **Step 5: commit** — `git add src/appserver/schema/dynamicTools.ts src/appserver/server.ts src/appserver/subscribe.ts src/appserver/dynamicCalls.ts src/appserver/dynamicTools.ts test/unit/appserver/dynamic-tools.test.ts && git commit -m "feat(appserver): the call machinery — authority, replay, opaque settlement (unregistered)"`

---

### Task 5: Lifecycle seams + thread status

**Files:** Modify `src/appserver/rewind.ts` (`swapEngine` + `threadReopen`), `src/appserver/turns.ts` (interrupt path), `src/appserver/registry.ts` (`threadStatus` — the waiter kind), `src/appserver/server.ts` (shutdown; statusChanged wiring), **`src/appserver/subscribe.ts` (the REPLAYED status must derive from both registries too — r6 finding 5: replay computes `waitingOn` from decisions alone, so a zero-subscriber park followed by subscribe would replay the call yet report the thread merely active)**, the status schema if the enum is published (check `schema/` for the status shape); Test: extend `test/unit/appserver/dynamic-tools.test.ts`.

- `swapEngine`: `reset("engine swapped")` **immediately after the epoch bump, BEFORE the `session.dispose()` await** (dispose can wait on the parked handler — reset-after-dispose is a circular wait; comment the ordering at the call site). Rewind AND `thread/clear` inherit.
- `threadReopen`: `reset("thread reopened")` beside the decisions reset. Server shutdown: `teardown("server shutting down")` beside decisions.
- **`turn/interrupt` (turns.ts): `reset("turn interrupted")` BEFORE awaiting `record.session.interrupt()`** — same circular-wait shape; `decision/respond`'s abortTurn arm routes through the same site.
- **Thread status** (r5 finding 6): `threadStatus` (registry.ts:355) currently derives `waitingOn: "decision"` from pending decisions; a thread parked on `tool/callResult` must not read as merely busy. Extend the derivation with the tool-call waiter (vocabulary: `waitingOn: "toolCall"`; if BOTH pend, decisions win — the client must answer the permission first; comment why), broadcast `thread/status/changed` on park and settlement (the emit callback), and update the published status schema if one exists.
- [ ] **Step 1: failing rows** — deadlock-shaped fakes (`dispose`/`interrupt` resolve only after the park settles) on `thread/close`, rewind swap, `thread/clear`, AND `turn/interrupt` → each completes, park resolves with ITS reason string; **the late-park deadlock row (r6 finding 3): a fake whose `interrupt()` launches a NEW park after the reset and awaits it — both the park (cancelled "turn interrupted") and the interrupt must complete**; shutdown row; reopen reset row; old-generation reuse (park → swap → new park → old callId answers `-33002`, new untouched); **status rows: park → `thread/status/changed` carries the tool-call waiter to SUBSCRIBERS ONLY (r7 finding 5: `thread/status/changed` is subscriber-scoped everywhere today — a watcher-only rule for this one edge would leak per-turn activity to existence observers; assert the watcher does NOT receive it); settle → status returns; decisions-beat-toolCall precedence; zero-subscriber park → subscribe → the REPLAYED status ends `waitingOn:"toolCall"`; reopen with ONLY dynamic calls reset (no decisions) → the final broadcast status is idle, and the factory-throw reopen path likewise ends idle (r7 finding 4: widen `threadReopen`'s ghost-park correction predicate to BOTH registries — settlement during `swapInFlight` broadcasts through a suppressed window and needs the final retraction)**.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → suite + full appserver + emit-schema/schemaGen if the status schema moved + tsc.
- [ ] **Step 5: commit** — `git add src/appserver/rewind.ts src/appserver/turns.ts src/appserver/registry.ts src/appserver/server.ts src/appserver/subscribe.ts test/unit/appserver/dynamic-tools.test.ts <schema files if touched> && git commit -m "feat(appserver): every teardown answers, and a parked tool call is visible thread state"`

---

### Task 6: The server builder + instance-direct exchange

**Files:** Create `src/appserver/dynamicServers.ts`; Modify `package.json` + lockfile (**`@modelcontextprotocol/sdk` into `dependencies`** at the version the agent-sdk vendors — check its package.json; r5 finding 4); Test `test/unit/appserver/dynamic-tools-exchange.test.ts` (NEW, instance-direct half).

**Interfaces** (Tasks 7–9 rely on):

```ts
/** Declarations → FRESH McpServer wrappers (one per namespace + `dyn`), handlers installed on
 *  wrapper.server per the plan header. NEVER cached, NEVER in record.config: call at EVERY engine
 *  construction. Returns name → ({type:"sdk", name, instance} satisfies McpSdkServerConfigWithInstance). */
export function buildDynamicServers(
  specs: DynamicToolSpec[],
  park: (call: { namespace?: string; tool: string; arguments: Record<string, unknown>; signal?: AbortSignal }) => Promise<CallToolResultLike>,
): Record<string, unknown>;
```

CallTool handler: **dispatch by `req.params.name` over an IMMUTABLE name-keyed table built once per server** (r7 finding 2: a namespace holds many tools, one handler — each entry carries its own converted schema; an unknown name returns MCP InvalidParams, never parks), parse `req.params.arguments ?? {}` with THAT tool's converted schema (built once at construction — `jsonSchemaToZod` validated ok at declaration; throw-on-!ok as invariant), park `{namespace, tool: req.params.name, arguments: parsed, signal: extra?.signal}` (verify `RequestHandlerExtra.signal` in the vendored types; report).

- [ ] **Step 1: failing exchange rows** (in-memory client over `InMemoryTransport.createLinkedPair()` against `entry.instance` — connect the WRAPPER; its low-level server carries our handlers): initialize ADVERTISES the tools capability (strict client); `listTools` returns the VERBATIM declared JSON Schema (deep-equal against the declaration object); `instructions` on initialize; `_meta["anthropic/alwaysLoad"]` true/false per deferLoading; passthrough extras reach the park `arguments`; strict extras refused at CallTool (never parked); a bound violation errors without parking; **a call OMITTING `arguments` on an empty-object tool parks with `{}`**; **two differently-shaped tools in ONE namespace called CONCURRENTLY — each validates against ITS OWN schema, both park, settled in REVERSE order, each resolves with its own result; an unknown tool name → MCP InvalidParams, nothing parked** (r7 finding 2); abort propagates via `extra.signal`; three content kinds round-trip through a synthetic park.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (+ dependency). **Step 4:** run → suite + `npm ls @modelcontextprotocol/sdk` resolves from the harness's own dependencies + tsc.
- [ ] **Step 5: commit** — `git add src/appserver/dynamicServers.ts package.json package-lock.json test/unit/appserver/dynamic-tools-exchange.test.ts && git commit -m "feat(appserver): dynamic servers — verbatim advertisement on a typed McpServer wrapper"`

---

### Task 7: The transient overlay — carrier, factories, refusals

**Files:** Modify `src/config/types.ts` (`dynamicToolServers?: Record<string, unknown>`), `src/config/resolveOptions.ts` (merge LAST on the RETURNED object), **`src/appserver/registry.ts` (the wire-silent `dynamicTools` field — moved here from Task 8)**, `src/appserver/server.ts:722-733` + `:757-799` (transient engineCfg; `record.config` = the clean base), `src/appserver/rewind.ts` (`defaultReopenFactory`/`defaultResumeAtFactory`), `src/appserver/settingsOps.ts` (`defaultFreshFactory` — thread/clear's factory lives HERE), `src/appserver/mcp.ts:115-158` (the declaring-thread refusal), `src/session/session.ts` (export `INJECTED_SERVER_NAMES` beside the injection code); Test: extend `dynamic-tools.test.ts` + the resolveOptions suite (find: `grep -rl "resolveOptions" test/unit`).

**This task also adds the wire-silent `ThreadRecord.dynamicTools` field and the internal declaration plumbing** (moved from Task 8 — r6 finding 2: the overlay helper needs the declarations at engine construction, and admission cannot read a record that does not exist yet). The builder context is an **immutable value, not the record** (both admission spines deliberately call the factory BEFORE constructing the ThreadRecord so a synchronous factory throw cannot orphan state — that invariant stands):

```ts
type DynamicBuildCtx = { threadId: string; generation: number; specs: DynamicToolSpec[] };
function withDynamicServers(srv: AppServer, ctx: DynamicBuildCtx, cfg: OpenSessionConfig): OpenSessionConfig {
  if (!ctx.specs.length) return cfg;
  const park = (call: ...) => srv.parkToolCall(ctx.threadId, ctx.generation, call, call.signal);
  return { ...cfg, dynamicToolServers: buildDynamicServers(ctx.specs, park) };
}
```

Initial admission: `{threadId: <the minted id>, generation: 0, specs}` — the epoch ALWAYS starts 0, so no record read is needed pre-factory; the record (with `record.dynamicTools = specs`) and both registries are registered ONLY after the factory succeeds, exactly as decisions already are. Swap factories: `{threadId: record.id, generation: record.epoch, specs: record.dynamicTools ?? []}` sampled AFTER the bump, at THEIR build. All three swap factories + both admission spines flow through this ONE helper; verify and report. **A factory-throw row proves no leak** (declaring thread/start whose factory throws → no record, no DynamicCalls entry, the error surfaces as today). `resolveOptions`: on the object the function RETURNS, immediately before the return: merge `config.dynamicToolServers` into its `mcpServers` (overlay wins). `mcpServer/set` on `record.dynamicTools?.length` → `-32602` naming the declaration.

- [ ] **Step 1: failing rows** (fake factory captures config; fake engine captures `setMcpServers`): start with ns+bare → engineCfg keys `[ns,"dyn"]`, `record.config` clean; resume → the `startThread` spine's factory receives fresh servers; **real `review/start` on a declaring target → review engine has NO `dynamicToolServers`, review record no `dynamicTools`** (the deliberate exclusion); set refusal on declaring / unchanged on non-declaring; swap rows ×3 (rewind, clear, reopen) — **compare `captured1.dynamicToolServers[ns].instance !== captured2...instance`** (the WRAPPED Server identity, not the entry object — a rewrapped cached instance must fail; r5 finding 8) and connect BOTH generations' instances to transports successfully; resolveOptions merge-last row (extraOptions clobber + overlay wins).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → suite + full appserver + resolveOptions + mcp suites + tsc.
- [ ] **Step 5: commit** — `git add src/config/types.ts src/config/resolveOptions.ts src/appserver/registry.ts src/appserver/server.ts src/appserver/rewind.ts src/appserver/settingsOps.ts src/appserver/mcp.ts src/session/session.ts test/unit/appserver/dynamic-tools.test.ts <resolveOptions suite> && git commit -m "feat(appserver): the transient overlay — fresh instances every build, review excluded, set refused"`

---

### Task 8: Declaration exposure — the ONE wire-visible commit

**Files:** Modify `src/appserver/schema/threads.ts` (shapes + `dynamicTools` on `threadStartParams` AND `threadResumeParams`), **`src/appserver/schema/index.ts` (register `"tool/callResult": { params: toolCallResultParams, result: toolCallResultResult }` — the method goes live HERE, beside the declarations that make it usable; r6 finding 4)**, `src/appserver/server.ts:423-460` + the resume handler (ONE shared validation helper for both spines; the dispatch-table entry for the Task-4 handler); Test: extend `dynamic-tools.test.ts`.

Shapes per the spec (toolName regex + the no-`__` refine; description `.max(MAX_TOOL_DESCRIPTION_CHARS)`; tagged namespace children). Handler helper: refuse client `config.dynamicToolServers`/`extraOptions.dynamicToolServers` (server-owned); `validateDeclarations(specs, occupiedNames)` with **`occupiedNames` derived by OWN-PROPERTY replacement semantics** (r8 finding 5: `"mcpServers" in extraOptions ? extraOptions.mcpServers : config.mcpServers` — an own `null` or `{}` replaces the typed map and occupies NOTHING; enumerate names only when the selected value is record-like; a `??` fallback would wrongly resurrect the typed map under an own `null`) plus `INJECTED_SERVER_NAMES`; stamp `record.dynamicTools` (the field exists since Task 7); **the `initialize` RESULT gains a `dynamicTools: true` capability marker, and `initialize` gets a REGISTERED result schema** (r8 finding 2 — neither initialize nor server/status carries capabilities today and neither registers a result; pick initialize, define its complete current result shape + the marker as `toolCallResultResult`-style zod, register it so the artifact's `results` map publishes it, and assert the marker over the real wire — the F9 lesson: an old server SILENTLY strips the optional declaration field and starts the thread toolless; a generated client must be able to detect the downgrade before declaring); regenerate the artifact — **assert `stable.results["tool/callResult"]` is present in the schemaGen expectations**.

- [ ] **Step 1: failing wire rows** — semantic refusals through the wire (spot: cap, extraOptions collision, `cc-context`, `oneOf`, `__`); shape refusals; the Codex fixture accepted at start AND resume; resume with an invalid set refuses; **hostile `dynamicToolServers` rows on BOTH spines**; after a declaring start, `record.config` JSON-round-trips clean with no `dynamicToolServers`/`instance`; **one wire-driven settlement smoke now that the method is dispatched** (duplicate → `-33002` THROUGH the wire — Task 4 pinned the handler's matrix; this proves the dispatch entry); an end-to-end keyless smoke: declare → fake engine's config carries the servers → park via the REAL production closure (drive the captured instance's CallTool with the in-memory client) → `tool/callRequested` on the wire → `tool/callResult` over the wire → CallTool resolves.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → suite + full appserver + emit-schema + schemaGen + tsc.
- [ ] **Step 5: commit** — `git add src/appserver/schema/threads.ts src/appserver/schema/index.ts src/appserver/server.ts test/unit/appserver/dynamic-tools.test.ts schema/json/stable/appserver.json && git commit -m "feat(appserver): dynamicTools declared on the wire — one commit, already runnable"`

---

### Task 9: Production exchange, live test, scorecard, acceptance

**Files:** Test `test/unit/appserver/dynamic-tools-exchange.test.ts` (production half), `test/live/appserver-dynamic-tools.test.ts` (NEW, keyless-skip); Modify `CC-to-SDK/docs/parity/appserver.md`, the spec's living tail.

- [ ] **Step 1: production-wiring exchange rows** — boot a REAL AppServer (factory captures config AND parks its submit so a turn holds ACTIVE); declare ns+bare at `thread/start`; start a turn; connect `capturedConfig.dynamicToolServers[ns].instance` in-memory; `client.callTool` → wire subscriber observes `tool/callRequested` with the ACTIVE turnId → answer via the REAL method — **three rows: text, image, audio** → `callTool` resolves with the corresponding block. Status visible during the park (Task 5's waiter).
- [ ] **Step 2: live test** (key-gated per `test/live/appserver-image-input.test.ts`; first keyed run after 2026-08-26 1pm): scenario A (spec row 6): `decision/requested` → allow → `tool/callRequested` → answer "42" → `mcp`-species item → reply contains 42; plus the set refusal. Scenario B (spec row 7): N=3 calls, `required` field present in every `arguments`. Keyless → clean skip.
- [ ] **Step 3: scorecard** — `tool/callResult` method row **`shipped(M7)`** — the drift gate REFUSES a probe-gated row whose method is registered (drift-check.mjs:158), so the row ships with the keyed residual named IN PROSE (bridge, permission ordering, stream species, model adherence — first keyed run 2026-08-26); the **`tool/callRequested` notification row carries `probe-gated`** (no registry entry, the gate allows it) flipping after the keyed run; `thread/start`/`thread/resume` notes; `mcpServer/set` refusal sentence; prose inventories :55/:285/:306; totals. `node scripts/drift-check.mjs` → exit 0 from `CC-to-SDK/`.
- [ ] **Step 4: full acceptance** — the spec's keyless rows verbatim (mapped over the split files), full appserver suite, tsc.
- [ ] **Step 5: spec retro** — replace Pending; state the keyed gate; Surprises for execution-time discoveries.
- [ ] **Step 6: commit** — `git add test/unit/appserver/dynamic-tools-exchange.test.ts test/live/appserver-dynamic-tools.test.ts CC-to-SDK/docs/parity/appserver.md CC-to-SDK/docs/superpowers/specs/2026-08-23-agent-appserver-m7-dynamic-tools-design.md && git commit -m "feat(appserver): M7 acceptance — production wiring crossed keylessly; keyed residual named"` (doc paths repo-root-relative — adjust for your cwd).

---

## Revision Notes (plan)

- rev 9 (2026-08-24): plan re-review round 8 — 5 findings, all accepted. The catalog arithmetic corrected (45 raw union members incl. the generic `McpInput`; excluding it and the `ToolOutputSchemas` tail → 44 mapped); the downgrade marker pinned to `initialize` with a REGISTERED result schema published under the artifact's `results` map; the interrupt guard upgraded from the record flag to a `parkBarrier` held until the NEXT submit dispatches (the flag alone re-opened at `beginTurn`'s clear, letting an interrupted turn's delayed CallTool rebind to the successor; the past-dispatch residual is a published bound); media URLs became plain strings at the RPC boundary so malformed media reaches `toCallResult` and SETTLES instead of dying `-32602` parked; occupied-name selection uses own-property semantics (an own `null`/`{}` occupies nothing; `??` would resurrect the typed map) and the Global Constraints union sentence was corrected to match.
- rev 8 (2026-08-24): plan re-review round 7 — 7 findings, all accepted (two modified). CallTool dispatches over an immutable name-keyed table (unknown name → InvalidParams; two-tools-one-namespace concurrent + reverse-settle row); the frame-inflation hazard handled by the images-round convention (a `.describe` naming the 256 KiB post-escaping bound + a row proving an over-frame result leaves the call ANSWERABLE by a smaller retry) rather than a cap cut; `McpInput` excluded from the catalog map and `RUNTIME_ONLY_NATIVE` extended (`LSP`, `SendMessage`) with the guard's purpose documented (client UX — the `mcp__` prefix already makes model-level collision impossible); reopen's ghost-park correction predicate widened to both registries with dynamic-only and factory-throw idle rows; tool-call status stays SUBSCRIBER-only (the watcher assertion inverted — status was never watcher-scoped); occupied names follow `resolveOptions`' replacement semantics (`extraOptions.mcpServers ?? config.mcpServers`), not a union; the initialize/server-status surface gains a `dynamicTools` capability marker so a new client can detect an old server that silently strips the field (the F9 lesson); Task 7's commit gains registry.ts and Task 9's commit enumerates its files.
- rev 7 (2026-08-24): plan re-review round 6 — 7 findings, all accepted. Tools CAPABILITY registered before handlers (the pinned MCP SDK's setRequestHandler throws otherwise — every declaring thread would die at construction); the builder context became an immutable `{threadId, generation, specs}` value because both admission spines call the factory BEFORE the record exists (initial generation is always 0; the record + registries register only after factory success, with a factory-throw no-leak row); `parkToolCall` also refuses while `record.interruptRequested` is up (a late CallTool in the async interrupt window re-parked and recreated the deadlock the reset closed) with a fake whose `interrupt()` launches a post-reset park; the `tool/callResult` registration + result schema (`z.object({}).strict()`, emitted under the artifact's `results` map) + wire-driven rows moved to Task 8 beside the declarations (Task 4 ships the machinery unregistered); subscribe.ts joined Task 5 so the REPLAYED status derives from both registries; `RUNTIME_ONLY_NATIVE` (`Skill`, `ToolSearch` at minimum) supplements the interface-derived catalog — the union misses runtime-only natives.
- rev 6 (2026-08-24): plan re-review round 5 — 13 findings, all accepted after verification (two claims verified against the tree: drift-check.mjs:158 does refuse registered probe-gated methods; the union does carry a 46th `ToolOutputSchemas` member). Restructured 6 tasks → 9 (wire trio / lifecycle+status split; builder / overlay / exposure split). New substance: the method row ships with prose residual while the notification row carries probe-gated (the gate's own vocabulary rules); no-`__` name rule (delimiter aliasing); `McpServer` wrapper with handlers on `wrapper.server` (`satisfies McpSdkServerConfigWithInstance`); `@modelcontextprotocol/sdk` into `dependencies`; code-point length refinements; thread status gains the tool-call waiter (decisions win when both pend); `arguments ?? {}`; `.instance` identity in swap rows + both generations connect; the 46-member exclusion rule; spec's stale review-survival/converted-advertisement/sdk.d.ts clauses swept; hostile carrier rows on both spines.
- rev 5 (2026-08-24): round 4 — 5 findings; 4 accepted, 1 inverted (review/start deliberately does NOT inherit declarations; the reviewer had read the protective clause as a promise). Stale `tool()`/`createSdkMcpServer` instructions swept; canonical-name collisions; `sdk-tools.d.ts` catalog via `NATIVE_TOOL_MAP`; non-negative integer length bounds.
- rev 4 (2026-08-24): round 3 — 8 findings; 7 accepted (2 modified), 1 refuted-and-worse (the zod measurement → the low-level advertisement redesign). Generation tokens; required turnId; occupied-set collisions incl. unconditional injected names; catalog re-sourced; UTF-8 result caps + MIME families; settingsOps.ts; resume factory row; swap reset ordering; production exchange across all three kinds; row-7 restored; programmatic byte fixtures.
- rev 3/rev 2 (2026-08-24): rounds 2 and 1 — 8 + 20 findings (19 accepted round 1; the "10K-token repository maximum" rejected as nonexistent). Transient engine config; merge-last on the returned object; subscriber authority + opaque ids; no schema count bound; conservative set refusal; deadlock-shaped fakes; `parseDataUrl`; wire-silent staging; internal identity stamping; UTF-8 schema caps; root allowlist; namespace dedup; three swap paths.
- rev 1 (2026-08-24): five tasks.
