# M7 — dynamic tools: client-declared tools over the park trio

**Date:** 2026-08-23 · **Owner approval:** design B of the product-trio presentation, approved verbatim.
**Grounding:** `docs/superpowers/grounding/2026-08-23-product-trio-ground.md` §2 + its 2026-08-23
amendment; probe 115 (`probes/probes/115-dynamic-tool-raw-schema.ts`).
**Sequencing:** executes AFTER the images round, on its own branch, reviewed as its own isolated diff.
**Rev 4** — rev 2 absorbed the adversarial spec review (twelve findings), rev 3 the round-3 measurement that
moved advertisement to the low-level MCP `Server`, and rev 4 closes execution (Revision Notes).
**Status: SHIPPED keyless, 2026-08-24** — every keyed row is written, landed and unobserved; the first keyed
run is due after 2026-08-26 1pm (Outcomes & Retrospective).

## Purpose

The largest capability gap Codex's app-server still holds over this one: a client declares tools at
`thread/start` and **is** the tool runtime — the model's call travels to the client, the client's answer
comes back as the tool result. This milestone ships that, using the D1-preserving park trio the server
already runs for elicitation (park + notification + answer method) — **the wire grammar does not
change**; no server→client request frame exists after this milestone either.

Non-goals, decided: fleet threads (structural, not a refusal — `thread/start` creates inProcess records
only, and the attach paths that mint fleet records carry no `dynamicTools` field, so the surface simply
does not exist there; the host-wire bridge is D-M4-8's family, later); mid-thread re-declaration
(`thread/start` only, matching Codex); tool-call timeouts (the turn's own interrupt/abort is the bound,
matching elicitation).

## Wire design

### Declaration — `thread/start` (and `thread/resume`, rev 2p) gain `dynamicTools`

**Downgrade detection (rev 3, planning rounds 7-8 — the F9 lesson):** an OLD server's `z.object`
silently STRIPS the unknown optional field and starts the thread toolless — no refusal, no signal. The
`initialize` RESULT therefore gains a `dynamicTools: true` marker, and `initialize` gets a REGISTERED
result schema so the published artifact's `results` map carries the marker; a client that intends to
declare MUST check it and treat its absence as "this server cannot host my tools".

**A published bound (planning round 8):** a CallTool request from an interrupted turn delayed past the
NEXT turn's submit dispatch can be attributed to the successor turn — the park barrier holds from
`turn/interrupt` until the next dispatch, which closes the window the in-process transport can
realistically hit; beyond it, provenance does not exist on the MCP path. Media URLs in
`tool/callResult` are deliberately NOT schema-validated: a malformed data: URL must reach the
conversion layer and settle the call `isError` rather than die `-32602` with the call still parked.

**A second published bound (final review, round 3):** `tool/callRequested` is broadcast to every
subscriber and the FIRST `tool/callResult` settles the call, so multiple subscribers that each execute a
non-idempotent tool all execute it and the losers hear `-33002 ALREADY_SETTLED` after the fact. Single
execution is therefore the client's contract, not the server's: the server cannot know which subscriber
hosts the tool runtime, and a lease protocol would be a wire redesign for a property the decisions surface
already publishes the same way (`decision/requested` is broadcast and first-answer-wins too).

A typed param BESIDE `config`, so the config identity guard is untouched — and so the declarations are
**never part of config at all**: they live in dedicated thread state (below), which is what keeps
`review/start`'s config inheritance and the `extraOptions` merge structurally unable to carry or
clobber them.

```ts
// appserver/schema/threads.ts
const toolName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const dynamicToolFunction = z.object({
  name: toolName,
  description: z.string().max(MAX_TOOL_DESCRIPTION_CHARS),
  inputSchema: z.record(z.string(), z.unknown()),   // raw JSON Schema, object-root, converted — see below
  deferLoading: z.boolean().optional(),
});
export const dynamicToolSpec = z.discriminatedUnion("type", [
  dynamicToolFunction.extend({ type: z.literal("function") }),
  z.object({
    type: z.literal("namespace"), name: toolName,
    description: z.string().max(MAX_TOOL_DESCRIPTION_CHARS),
    // Codex's DynamicToolNamespaceTool children are TAGGED (`type:"function"`) — mirrored exactly, so a
    // canonical Codex declaration cross-parses; an acceptance row pins a Codex-shaped fixture.
    tools: z.array(dynamicToolFunction.extend({ type: z.literal("function") })).min(1),
  }),
]);
// thread/start params: { ..., dynamicTools: z.array(dynamicToolSpec).optional() }
```

**Declaration caps — the model-context guard the wire cap is not** (review finding 1: peer.ts's 256 KiB
frame bounds the REQUEST, not what lands in every later model turn):
`MAX_DYNAMIC_TOOLS = 32` functions total across namespaces; per-tool `inputSchema` ≤ 8 KiB serialized,
≤ 8 levels deep, ≤ **256** schema nodes (execution amendment, 2026-08-24: under the generic-JSON node
counting Task 2 defined — every JSON value is one node — the original 64 refused a 15-property tool at
65 nodes while the byte cap never fired; 256 ≈ 5,600 bytes keeps the two caps co-binding);
`MAX_TOOL_DESCRIPTION_CHARS = 2_000`. Refused loudly at
`thread/start`, each with a message naming the offender — as are: a name colliding with the native tool
catalog or with any configured MCP server name ([[sdk-mcp-tool-shadowing-and-permission]]), a duplicate
name, the reserved namespace `dyn`, and a schema outside the conversion subset (the message names the
unsupported keyword).

### The call — notification out, method back

- **Notification** `tool/callRequested` → **thread SUBSCRIBERS only** — never watchers, which
  `fanout.ts` defines as thread-EXISTENCE observers, a scope that must not receive tool arguments or a
  usable settlement key (review finding 2; an acceptance row proves a watcher-only peer sees neither).
  Shape: `{threadId, callId, turnId, namespace?, tool, arguments}`.
- **Replay on subscribe** (review finding 3): pending calls are part of the thread's replayable state —
  `thread/subscribe` replays each pending call as a `tool/callRequested` after the pending-decision
  replay it already performs. A call parked with ZERO subscribers waits; the first subscriber to attach
  hears it. This is what makes "the declarer died, a reattaching client answers" true rather than
  claimed.
- **Method** `tool/callResult`:
  `{threadId, callId, contentItems: [...], success: boolean}` — items are
  `{type:"inputText", text}` | `{type:"inputImage", imageUrl}` | `{type:"inputAudio", audioUrl}`
  (Codex's trio, camelCase; media as `data:` URLs, the images round's parser reused). Result caps
  (finding 1's other half): ≤ 16 content items, ≤ 128 KiB total text/media payload — an over-cap result
  settles the call as `isError` with a cap-naming note rather than entering model context oversized.
  Errors: unknown `callId` → `-32602` "no such pending tool call"; an already-settled `callId` →
  `-33002 ALREADY_SETTLED` (distinguishable from unknown via the settled-tombstone ring, below);
  a `callId` from a PREVIOUS engine generation → `-33002`-class refusal, never applied to the
  replacement engine's state.

### Trust and routing

Delivered to subscribers; first `tool/callResult` with the key wins — the decision registry's trust
model (any SUBSCRIBER can already answer a permission park; watchers never could and still cannot).
Enforced twice (rev 2p): the method refuses a peer that is not in the thread's subscriber set, and
`callId`s are OPAQUE (`dyncall:<uuid>`) — a guessable counter would hand settlement authority to any
initialized peer that knows a threadId. Rejected: binding calls to the declaring CONNECTION (threads
outlive connections; reattach is the fleet model — and the replay above is what makes reattach
actually work).

## Runtime design

### Declarations are thread state; servers are built per engine

`ThreadRecord` gains `dynamicTools?: DynamicToolDecl[]` — the SERIALIZABLE declarations, never live
server instances (review finding 6: an MCP `Server` instance rejects a second transport, so an instance
stored in config and inherited anywhere — a review thread, a rewind replacement — is a landmine; and
config is exactly what `review/start` copies and `extraOptions.mcpServers` can clobber). At every
engine build (thread/start, thread/resume, rewind/clear/reopen swaps), the config assembly constructs
**fresh LOW-LEVEL MCP `Server` instances** (rev 3 — `createSdkMcpServer`/`tool()` are NOT used anywhere:
Surprises records the measurement; ListTools returns the declared JSON Schema verbatim, CallTool
validates via the conversion subset then parks) and hands them to the engine on the server-owned
transient carrier as an **immutable overlay**:

- one server per namespace (server name = namespace name); un-namespaced functions under the reserved
  **`dyn`**; the namespace `description` rides the low-level server's `instructions` construction
  option, so Codex's model-visible namespace description has a real home, not a dropped field;
- **`review/start` deliberately does NOT inherit declarations** (rev 3): a review thread is a derived
  analysis engine, not the client's tool runtime — declarations living outside config is precisely what
  makes the exclusion structural, and an acceptance row pins it;
- **`mcpServer/set` refuses on a declaring thread** (rev 2p — supersedes rev 2's merge-into-every-set):
  whether the SDK's runtime `setMcpServers` control frame can carry an in-process server INSTANCE is
  unverifiable keylessly, and an accepted set that silently dropped the declarations would erase
  thread-lifetime state. Conservative-first: a declaring thread answers `mcpServer/set` with `-32602`
  naming the dynamic declaration; the refusal is relaxed only after a keyed survival row proves
  instances ride a runtime set. Non-declaring threads are untouched. The overlay itself needs no
  runtime set: every engine BUILD carries it (fresh instances on the transient engine config).
- model-visible names are `mcp__<ns>__<name>` — an SDK naming constraint, noted as a Codex-parity
  nuance, not hidden.

### Schema conversion (probe 115's consequence; role narrowed by rev 3)

The SDK runtime refuses raw JSON Schema at `registerTool` (probe 115: explicit check) — and rev 3's
measurement showed the zod detour ALSO cannot advertise the declaration (Surprises). So the split is:
**advertisement is the low-level MCP `Server` returning the declared JSON Schema verbatim; conversion
is the VALIDATION layer** at CallTool. New module `appserver/schemaToZod.ts` converts, with the subset
REQUIRING an **object root** (MCP tools take object-shaped arguments; a scalar root would advertise
`{}` while validating the scalar — finding 7):

- root: `type:"object"` with `properties`/`required`; `additionalProperties: false` → strict zod,
  absent or `true` → **passthrough** zod (JSON Schema's own default admits extra keys; a stripping
  object would silently rewrite valid client arguments — finding 7);
- fields: `string`/`number`/`integer`/`boolean`/`array`(+`items`)/`enum`(strings/numbers)/`const`,
  `description`, bounds `minimum`/`maximum`/`minLength`/`maxLength`.

Anything else refuses the DECLARATION at `thread/start`, naming the keyword. Fidelity is asserted
keylessly by an **in-memory MCP exchange**: drive the built server instance's `tools/list` and compare
the advertised JSON Schema against the declaration; drive `tools/call` and assert passthrough keys
survive to the parked call's `arguments`.

### The handler — park, notify, settle, and the registry that owns it

A dedicated per-thread **DynamicCalls registry**, explicitly mirroring the elicitation/decision
lifecycle rather than assumed into it (review finding 4):

1. handler mints `callId`, stores the FULL pending request (for subscribe replay), notifies
   subscribers, awaits settlement;
2. `tool/callResult` settles atomically (first answer wins; the resolver leaves the pending map and the
   callId enters a bounded settled-tombstone ring, size 128, which is what lets a duplicate answer earn
   `-33002` while a fabricated id earns `-32602` without unbounded memory);
3. **every teardown path settles pending calls as cancelled** (`success:false`, `isError:true`, a note
   naming why — the callback always answers, D-M4-9): the turn's abort signal (wired the way
   elicitation attaches `options.signal`), thread close latch (settle + refuse new parks),
   `thread/reopen`'s non-latching reset, engine swaps (generation stamp: the registry records the
   engine generation at park time; settlement and teardown check it), and server shutdown;
4. result conversion: `inputText`→`{type:"text"}`, `inputImage`→`{type:"image", data, mimeType}`,
   `inputAudio`→`{type:"audio", data, mimeType}` (all three MCP block types verified present);
   `success:false` → `isError: true`.

### deferLoading — Codex's polarity, not the SDK's

Codex deserializes an omitted `deferLoading` as `false`, and `false` means DIRECT exposure (verified in
`dynamic_tools.rs`: `#[serde(default)]` on a `bool`); the SDK's default for MCP tools is deferred
behind ToolSearch. So the mapping is `alwaysLoad: spec.deferLoading !== true` — omitted and `false`
load directly (Codex-compatible), only an explicit `true` defers (review finding 9; tested at all three
values).

### Items and permissions

The stream's `tool_use` for `mcp__…` names classifies as the `mcp` species (`items/types.ts:47`), and
dynamic tools ride the normal permission surface (broker parks, allow/deny, permissionMode) — both
verified by the KEYED end-to-end row rather than claimed from the keyless seams (review finding 11: a
directly-invoked handler bypasses registration, canUseTool, and stream mapping, so keyless rows assert
what the in-memory MCP exchange actually exercises, and the live row owns the rest).

## Acceptance (behavior-phrased)

Keyless (run from `CC-to-SDK/harness`). **File mapping, corrected at execution (T9):** the rows below were
specified against one unit file and the implementation split them across four, so each item now names where
its rows actually live. No row was dropped or weakened in the move; the mapping is the only thing that
changed.

1. `npx vitest run test/unit/appserver/dynamic-tools-validate.test.ts test/unit/appserver/dynamic-tools.test.ts test/unit/appserver/dynamic-calls.test.ts`
   — declaration validation (each cap and
   collision refused with its named message; a canonical Codex-shaped namespace fixture with tagged
   children parses) lives in `dynamic-tools-validate.test.ts` (the pure gate) and `dynamic-tools.test.ts`
   (the same gate reached over the wire at `thread/start`/`thread/resume`); the registry's own lifecycle —
   first-answer-wins, duplicate answer `-33002` vs fabricated id `-32602`, result caps settling as
   `isError`, generation stamps — is `dynamic-calls.test.ts`; and the park trio through the REAL wire is
   `dynamic-tools.test.ts`: `tool/callRequested` reaches a subscriber and
   NOT a watcher-only peer; zero-subscriber park + replay-on-subscribe delivers the full pending
   request; disconnect-then-reattach settlement; abort/close/reopen/shutdown/interrupt each settle
   pending calls as cancelled; a previous-generation answer never touches the replacement engine.
2. `npx vitest run test/unit/schemaToZod.test.ts` — subset round-trips; object-root requirement;
   `additionalProperties` absent/true → extra keys SURVIVE to parsed arguments, false → refused;
   out-of-subset keywords refuse naming themselves.
3. An **in-memory MCP exchange** row — `npx vitest run test/unit/appserver/dynamic-tools-exchange.test.ts`,
   its own file: the built server's `tools/list`
   advertises **the declared JSON Schema VERBATIM — deep-equal against the declaration object** (rev 3:
   advertisement is the low-level Server's, not a conversion); `tools/call` round-trips through park →
   wire answer → MCP content result, for all three content kinds. Two rows sit elsewhere by subject rather
   than by mechanism: **`review/start` on a declaring target inherits NO declarations** and **a parked call
   is visible thread status** (the tool-call waiter, broadcast on park and settlement; decisions win when
   both pend) are in `dynamic-tools.test.ts`, beside the overlay and status rows they belong with. T9 adds
   the **production half** at the foot of the exchange file: a real `AppServer`, a declaring `thread/start`,
   a turn held ACTIVE, the instance the factory was handed, and the answer travelling the REGISTERED
   `tool/callResult` over the wire — text, image and audio each crossing the whole path.
4. `npx vitest run test/unit/appserver` — full suite green, including `mcpServer/set` vs the overlay
   across thread/rewind, thread/clear, thread/reopen.
5. `node scripts/drift-check.mjs` (from `CC-to-SDK/`) — exit 0; the scorecard gains `tool/callResult`
   (method row, `shipped(M7)`, keyed residual in prose — the gate refuses `probe-gated` on a registered
   method), `tool/callRequested` (notification row, `probe-gated` until the keyed run), the `thread/start`
   and `thread/resume` `dynamicTools` notes, the `mcpServer/set` refusal, and the M7 known-limits paragraph.
6. `npx vitest run test/live/appserver-dynamic-tools.test.ts` with NO key present — the keyed file below
   skips cleanly (3 skipped, 0 run). A skipped suite proves the gating and nothing else, which is why the
   rows it gates are still called unobserved everywhere they are cited.

Keyed (quota-gated — after 2026-08-26 1pm; the numbering continues the keyless list so every acceptance
item in this spec has one unique number, which is what "spec row N" cites):

7. A live test declares one tool (the probe-115 schema), and asserts end to end: the broker parks the
   call's PERMISSION first (`decision/requested` → answered over the wire), then `tool/callRequested`
   arrives, is answered over the wire, an `mcp`-species tool item completes on the stream, and the
   model's reply uses the tool's answer; skips cleanly keyless.
8. Schema fidelity live: the model's `arguments` conform to the declared schema; a required field is
   never absent across N calls (the in-memory tools/list row is the deterministic half; this row is the
   model-behavior half).

## Decision Log

- **Park trio over a reverse-request frame** — unchanged from rev 1 (grounding amendment); zero
  wire-grammar change.
- **Subscribers-only delivery; watchers excluded.** Watchers are thread-existence observers
  (fanout.ts's own definition); tool arguments are execution data and the callId is settlement
  authority. Rejected: rev 1's subscribers+watchers fan-out (leak + race authority to unrelated peers).
- **Pending calls are replayable thread state.** Without replay, "a reattaching client can answer" was
  false (one-shot notification, no discovery). Rejected: a pending-call list METHOD (a second surface
  where subscribe replay already has the semantics and the ordering).
- **Declarations in dedicated thread state; fresh server instances per engine build; immutable overlay
  vs `mcpServer/set`.** Instances are single-transport and config is inherited/clobberable — factories
  + overlay is what survives rewind/clear/reopen without collision or reuse, **and `review/start` is
  deliberately EXCLUDED** (rev 3: a review thread is a derived analysis engine, not the client's tool
  runtime; the exclusion is structural because declarations live outside config). Rejected: storing
  instances in config (finding 6's landmine), letting set replace declaration servers (silent
  disappearance of thread-lifetime state).
- **Caps on declarations AND results.** The wire frame bounds one request; the model's context pays for
  every declaration on every turn and every result once — the caps are the context guard. Values are
  generous for real tools and named in one place.
- **Object-root + passthrough-by-default conversion.** JSON Schema admits extra keys unless
  `additionalProperties:false`; a stripping zod object would silently rewrite valid arguments.
- **`alwaysLoad: deferLoading !== true`** — Codex's polarity (omitted = direct), measured in its serde
  default, not assumed from the SDK's.
- **Fleet non-goal restated as structural.** `thread/start` mints inProcess records only; no fleet
  path carries the field; rev 1's `-33006` refusal was unreachable and is withdrawn.
- **Reserved `dyn` namespace; no timeouts; `data:`-only media** — unchanged from rev 1.

## Surprises & Discoveries

- **The protocol layer, not our handler, decides what `__proto__` survives (T6, measured).** The pinned MCP SDK parses every request before any handler runs, and its `CallToolRequest` arguments record rebuild DROPS a `__proto__` own key (a null-prototype object arrives with the key gone). The park-the-validated-original rule (never zod's parse output) stands as the contract — but its observable discriminator today is caller key ORDER, which the protocol parse preserves and zod v4's loose-object output re-orders (declared keys first). The exchange suite pins the rule via key order and carries a labelled bound row asserting the upstream strip, so an SDK bump that starts preserving the key surfaces there.
- **A root `type: "object"` omission is namespace-lethal at advertisement (T6).** MCP's `ToolSchema` requires the literal; verbatim advertisement passes the omission through and a strict client rejects the entire `tools/list`, disabling every sibling tool. Decision: refuse at declaration time in `validateDeclarations` (-32602 naming the tool), enforced in Task 7; the T1 converter stays a permissive subset.
- **An unsettled park holds the MCP caller for the transport's request timeout (T6, informational for T9).** The MCP SDK's default request timeout is 60 s; the agent SDK's `MCP_TOOL_TIMEOUT` is effectively unbounded in production, so the bound matters only to tests (the exchange rows pass explicit short timeouts).

- **An invariant stated on two spines had a witness on only one (T7).** The admission ordering — call the engine factory BEFORE writing the record and both per-thread registries, so a factory that throws orphans nothing — held in code on `createThread` and on `startThread` alike, and one row covered it. Re-applying the exact mutation to the OTHER spine (`startThread`, the resume path) left the entire 1,332-row app-server suite green: a real gap, invisible because the rule read as one rule. The lesson generalizes past this milestone: when a rule is written twice, sabotage each site separately — a passing suite is evidence about the site the row happens to drive, not about the rule. The twin row exists now, and it reddens alone under that mutation.

- **A park failure reached the model as a raw `-32603` with a stack (T7, a live defect and not merely a coverage gap).** The seam's contract is that `parkToolCall` answers every refusal with a RESOLVED cancellation, so the model always gets something it can read. Nothing enforced it: any throw or rejection from the app server's own park binding — a registry lookup, a generation check — travelled out of the MCP handler as a transport error, which the model can neither read nor act on and which ends the turn instead of redirecting it. The fix is a guard at the CallTool call site (a strict superset of the binding, since the binding's whole body executes inside it) answering `isError` with the reason. Measured both ways: with the guard, `isError: true` naming the failure; without it, `MCP error -32603`. The general rule this leaves behind: a "the callback always answers" contract needs a guard at the seam that would otherwise leak the exception, not only a discipline in the code that raises it.

- **Rev 1 had the deferLoading polarity backwards** — the SDK's deferred-by-default and Codex's
  direct-by-default pull opposite ways, and only reading Codex's serde default settles which side a
  Codex-compatible client expects.
- **Rev 1's fleet refusal was a contract for a wire that doesn't exist** — `thread/start` cannot name a
  fleet origin at all. A refusal you cannot reach is not a decision; the structural statement is.
- **No zod path can advertise the declared schema** (planning round 3, controller-measured 2026-08-24):
  a built zod object — v3 and v4 alike — loses descriptions, min/max, AND `.int()` in the MCP
  `tools/list` advertisement; a raw shape keeps descriptions but still loses every bound. The round-3
  reviewer claimed v3 preserves them; the measurement refuted the claim while confirming the defect it
  pointed at, worse. Consequence: rev 3 abandons `createSdkMcpServer`/`tool()` for the LOW-LEVEL MCP
  `Server` — ListTools returns the client's declared JSON Schema VERBATIM (full Codex parity, exactly
  testable), CallTool validates with the converted zod (where passthrough/strict semantics live), and
  `_meta["anthropic/alwaysLoad"]` + `instructions` are set directly.

## Outcomes & Retrospective

**Shipped, 2026-08-24, over nine tasks on branch `appserver-m7-dynamic-tools`.** A client declares tools at
`thread/start` or `thread/resume` and IS their runtime: the model's call parks in the server, reaches the
thread's subscribers as `tool/callRequested`, and the first subscriber to answer `tool/callResult` supplies
what the model reads. The wire grammar did not change — no server→client request frame exists after this
milestone either — and the whole feature rides the park trio the server already ran for elicitation. Six
new source modules and one rename (`schemaToZod.ts`, `dynamicTools.ts`, `dynamicCalls.ts`,
`dynamicServers.ts`, `toolCallResult.ts`, `schema/dynamicTools.ts`, plus the admission, overlay and status
seams threaded through `server.ts`, `subscribe.ts`, `rewind.ts` and `settingsOps.ts`), one new registered
method (the 67th), one new notification (the 30th), and a `dynamicTools: true` marker on `initialize`'s
newly registered result schema so a client can detect an old server rather than be silently downgraded.

**Keyless acceptance is complete and green.** `test/unit/appserver` runs 75 files / 1,368 tests; the
milestone's own rows live in `dynamic-tools-validate.test.ts` (the declaration gate), `dynamic-calls.test.ts`
(the registry lifecycle), `dynamic-tools.test.ts` (the wire: park, notify, replay, authority, every
teardown, the overlay across all three swaps, `review/start`'s exclusion, the status waiter),
`dynamic-tools-exchange.test.ts` (a real MCP client against the built instances — verbatim `tools/list`,
validation, dispatch, and T9's production half crossing a real `AppServer` with all three result kinds) and
`test/unit/schemaToZod.test.ts` (the conversion subset). `node scripts/drift-check.mjs` exits 0 at 102
scorecard rows and 67 registered methods.

**The keyed gate — nothing below has been observed, and the first run is due after 2026-08-26 1pm** (the
weekly quota was exhausted for the whole of execution, so every live row in this milestone was written and
landed against a clean skip). `test/live/appserver-dynamic-tools.test.ts` carries both scenarios: **A**
(spec row 7) — a declared tool reaches a real model, the broker parks `decision/requested` FIRST, the call
then travels as `tool/callRequested`, the client's answer comes back as the tool result, an `mcp`-species
item completes on the stream, the reply carries a per-run nonce the model could not have invented, and
`mcpServer/set` is refused on the same declaring thread; **B** (spec row 8) — three calls in one turn, the
declared `required` field present in every `arguments`. Three further questions ride that same run:

- **Does `_meta` survive the SDK→CLI control-protocol hop?** (T6 review.) The `tools/list` payload is
  JSON-serialized onto the CLI's control protocol, and `anthropic/alwaysLoad` is the field the whole
  `deferLoading` polarity rests on. The keyless rows prove we EMIT it; only a live run proves the CLI
  received it — a `deferLoading: true` tool should be absent from the model's direct tool list and
  reachable through ToolSearch.
- **Does the SDK accept an AUDIO tool result at all?** (T3 review.) `{type:"audio", data, mimeType}` is the
  correct MCP `AudioContent` shape and it round-trips through our conversion and through a real MCP client
  — but Claude takes no audio INPUT, so an audio tool RESULT may still fail the turn downstream. If it
  does, the `audio/*` MIME family is guarding a path that always fails, and the honest answer is to say so
  on the scorecard rather than keep a shape nothing can carry. This is a discovery item, not a predicted
  failure: it is unmeasured in either direction.
- **What actually bounds an unsettled park in production?** (T6.) `MCP_TOOL_TIMEOUT` is effectively
  unbounded there, where every test passes an explicit short deadline. The milestone's stated bound is the
  turn's own interrupt/abort (matching elicitation, and every teardown path settles), so a live run is where
  a client that simply never answers gets its real duration measured rather than assumed.

**What the process is worth repeating for.** The design survived nine planning-review rounds (~62 findings)
before a line was written, and the one thing that repeatedly moved the design was MEASUREMENT rather than
argument: the zod-advertisement question was settled by a measurement that refuted the reviewer's claim
while confirming a worse version of the defect it pointed at, and the resulting rev-3 pivot to the low-level
MCP `Server` is the reason `tools/list` returns the client's declared schema verbatim instead of a lossy
rebuild. The per-task reviews then found what planning structurally could not: two of the three entries
added to Surprises above are execution-time discoveries about seams that read as obviously correct — an
invariant with a witness on only one of the two spines that state it, and a "the callback always answers"
contract with nothing enforcing it at the seam that leaks. Both were found by sabotage, not by reading.

**What is deliberately not here.** Fleet threads (structural — no fleet admission path carries the field;
`tool/callResult` on one answers `-32602` because the registry is real and empty, which is the true
statement); mid-thread re-declaration; tool-call timeouts of our own. And the four client-facing limits the
scorecard now states rather than implies: the unconditional `cc-context`/`cc-compact` name reservation,
declarations NOT persisting into resume defaults (they must be re-sent on every `thread/resume`),
`thread/fork` and `review/start` minting threads with no declaration path, and settings-file MCP servers
being invisible to the occupied-name check.

## Revision Notes

- rev 1 (2026-08-23): initial spec from the approved design-B presentation + probe 115.
- rev 2 (2026-08-23): adversarial spec review — twelve findings, all accepted after verification
  (watcher scope read from fanout.ts; deferLoading polarity from dynamic_tools.rs's serde default;
  `instructions` verified in sdk.d.ts; the fleet refusal confirmed unreachable). Structural changes:
  subscribers-only delivery; pending-call replay on subscribe; a dedicated DynamicCalls registry with
  abort-signal wiring, close latch, reopen reset, generation stamps, and settled tombstones;
  declarations as thread state with per-engine fresh instances and an immutable overlay against
  `mcpServer/set`; declaration and result caps; object-root passthrough conversion; tagged namespace
  children + `instructions` mapping; acceptance rebuilt around the in-memory MCP exchange plus a keyed
  end-to-end row. Process: M7 lands as its own isolated branch/diff (finding 12).
- rev 2p (2026-08-24, the planning pass — three amendments before execution): (1) `dynamicTools` is
  accepted at `thread/resume` too — declarations are in-memory thread state, so a resumed thread
  otherwise has no path to tools; validation identical. (2) `mcpServer/set` on a declaring thread
  REFUSES (conservative-first) — rev 2's merge-into-every-set assumed the SDK's runtime control frame
  can carry in-process instances, which is unverifiable keylessly; relaxation gates on a keyed survival
  row. (3) Settlement authority made enforceable: the method checks the subscriber set and `callId`s
  are opaque UUIDs — rev 2 granted the authority but nothing enforced it against a guessed counter.
- rev 3 (2026-08-24, planning round 3): (1) advertisement moves to the LOW-LEVEL MCP `Server` with the
  declared JSON Schema returned VERBATIM (see Surprises — no zod path preserves it); `schemaToZod`
  becomes the VALIDATION layer only. Fidelity acceptance strengthens from "structural" to deep-equal.
  (2) `dynamicToolServers` (the transient engine-config carrier) is SERVER-OWNED: client config or
  extraOptions carrying the key refuses -32602, and `record.config` never contains it. (3) Names the
  Session's in-process built-ins reserve UNCONDITIONALLY (even when flag-gated off); servers the SDK
  discovers from settings/plugins under non-strict MCP config cannot be enumerated at declaration time —
  that residual collision is a PUBLISHED bound, not a refusal. (4) `NATIVE_TOOL_NAMES` is a pinned
  fixture drift-tested against the vendored sdk-tools.d.ts `ToolInputSchemas` union (45 `*Input`
  members at 0.3.237, the trailing `ToolOutputSchemas` reference excluded by the extraction). (5)
  `turn/interrupt` and abortTurn settle pending calls ("turn interrupted") BEFORE awaiting the engine
  interrupt — the same circular-wait shape as dispose. (6) The `tool/callResult` METHOD row ships with
  its keyed residual named in prose (the drift gate refuses a registered method's probe-gated row —
  drift-check.mjs:158); the `tool/callRequested` NOTIFICATION row carries `probe-gated`, flipping after
  both keyed scenarios pass post-2026-08-26. (7) Planning round 5: a parked tool call is VISIBLE thread
  status — `waitingOn` gains the tool-call kind, broadcast on park and settlement, decisions winning
  when both pend; namespace and function names additionally refuse the `__` substring (the SDK's
  delimiter — `ops`+`prod__run` and `ops__prod`+`run` alias to one model-visible name); collision
  comparison is on canonical (underscore-normalized) server names; `review/start` exclusion and
  verbatim advertisement are stated in the sections they govern.
- rev 4 (2026-08-24, the execution close — Task 9): nothing in the design moved; three things about it were
  written down that had not been. (1) The Acceptance section's FILE MAPPING is corrected in place — the rows
  were specified against one unit file and shipped across four (`dynamic-tools-validate`, `dynamic-tools`,
  `dynamic-calls`, `dynamic-tools-exchange`), plus the keyed file and the keyless-skip run; no row was
  dropped or weakened, and the item text now says where each lives; the keyed rows are renumbered 7 and 8
  so the keyless addition and the keyed scenarios no longer share the number 6, and every "spec row N"
  citation moved with them. (2) Surprises gains the two
  execution-time discoveries the planning rounds could not have produced, both found by sabotage rather than
  by reading: an invariant stated on two spines with a witness on only one, and a "the callback always
  answers" contract with nothing enforcing it at the seam that leaks. (3) Outcomes & Retrospective replaces
  its placeholder, and states the KEYED GATE explicitly — first keyed run after 2026-08-26 1pm, carrying
  scenarios A and B plus the `_meta` SDK→CLI hop check (T6 review), the audio model-acceptance question (T3
  review; a discovery item, unmeasured in either direction) and the production park bound. Every live claim
  in this spec is "not yet observed" until that run happens.
