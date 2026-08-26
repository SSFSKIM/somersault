// appserver/schema/index.ts — the method→schema registry. Wave 4's generator and drift gate walk THIS
// record: a shipped method missing here is a build failure, so wire and artifact cannot drift (spec §9).
import type { z } from "zod/v4";
import { threadIdParams, initializeParams, initializeResult, okResult, serverStatusParams } from "./core.js";
import { threadStartParams, threadResumeParams, threadReadParams, threadListParams, threadCompactStartParams, threadReinitializeParams, threadForkParams, threadNameSetParams, threadTagSetParams, threadDeleteParams } from "./threads.js";
import { turnStartParams, turnInterruptParams, turnSteerParams, turnStartContentParams, turnSteerContentParams } from "./turns.js";
import { imageStageParams } from "./images.js";
import { decisionRespondParams, decisionListParams } from "./decisions.js";
import { modelSetParams, permissionModeSetParams, thinkingSetParams, settingsApplyParams } from "./settings.js";
import { rewindAnchorsParams, rewindDryRunParams, rewindParams, reopenParams } from "./rewind.js";
import { mcpStatusParams, mcpNameParams, mcpToggleParams, mcpSetParams, mcpOverrideParams } from "./mcp.js";
import { taskListParams, taskStopParams, turnBackgroundParams } from "./tasks.js";
import { settingsReadParams, directoryListParams, directoryPathParams, permissionRuleParams, outputStyleSetParams, effortSetParams, threadClearParams } from "./settingsOps.js";
import { fleetListParams, threadAttachParams, threadStopParams } from "./fleet.js";
import { fsReadParams, fsSearchParams, shellCommandParams } from "./workspace.js";
import { reviewStartParams } from "./review.js";
import { configReadParams, configReadResult, configValueWriteParams, configBatchWriteParams, configWriteResult } from "./config.js";
import { threadSearchParams, threadSearchResult, threadSearchOccurrencesParams, threadSearchOccurrencesResult } from "./search.js";
import { capabilitiesReadResult } from "./introspect.js";
import { toolCallResultParams, toolCallResultResult } from "./dynamicTools.js";
import { peerListParams, peerListResult, peerSendParams, peerSendResult, crossSessionInboundSetParams, crossSessionInboundSetResult } from "./peer.js";

/** `experimental`: this method is an X-gate in the spec's sense — it exists because a probe found the seam
 *  reachable, and it may change shape or disappear without a deprecation. It is the ONLY thing that decides
 *  which generated artifact a method lands in (`schema/emit.ts`: stable file XOR experimental file), so
 *  flipping the marker is how a method graduates — there is no second list to keep in step. Absent, not
 *  `false`, on a stable method: the marker is an exception, and an entry that says nothing says "stable". */
/** `result` (M5, spec D-M5-19): the method's RESPONSE shape, published beside its params. Optional and
 *  incremental on purpose — the 59 methods that predate M5 declare none, and the spec rejected
 *  retrofitting them in this milestone, so an entry without it means "response shape not yet published",
 *  never "no response". `schema/emit.ts` emits every declared one into the artifact's `results` map. */
export interface MethodSchema { params: z.ZodType; result?: z.ZodType; experimental?: true }
export const methodSchemas: Record<string, MethodSchema> = {
  // M7: the FIRST server-scoped `result`, and the reason it exists is the handshake's `dynamicTools`
  // marker — a client cannot detect a server too old to host its tools any other way (core.ts states the
  // whole argument). Publishing it means the artifact's `results` map carries the marker, which is what
  // makes the detection a contract rather than a convention.
  "initialize": { params: initializeParams, result: initializeResult },
  "server/status": { params: serverStatusParams },
  "thread/start": { params: threadStartParams },
  "thread/resume": { params: threadResumeParams },
  "thread/list": { params: threadListParams },
  "thread/close": { params: threadIdParams },
  "thread/subscribe": { params: threadIdParams },
  "thread/unsubscribe": { params: threadIdParams },
  "thread/read": { params: threadReadParams },
  "turn/start": { params: turnStartParams },
  "turn/interrupt": { params: turnInterruptParams },
  "decision/list": { params: decisionListParams },
  "decision/respond": { params: decisionRespondParams },
  "thread/model/set": { params: modelSetParams },
  "thread/permissionMode/set": { params: permissionModeSetParams },
  "thread/thinking/set": { params: thinkingSetParams },
  "thread/settings/apply": { params: settingsApplyParams },
  // M5 Task 13 (D-M5-22) gives this read a second, OPTIONAL field — `terminalSlashCommands` — so it is the
  // one pre-M5 method that declares a `result`. That is not the retrofit D-M5-19 deferred: the slot is
  // filled here because the new field's ABSENCE carries meaning ("no init frame has arrived"), which is a
  // contract no params schema and no field name can state, and a client that cannot tell an absent key
  // from `[]` has been mis-told. The other four introspection reads still publish none — they relay
  // SDK-owned payloads verbatim, so the shape to validate against is the SDK's.
  "thread/capabilities/read": { params: threadIdParams, result: capabilitiesReadResult },
  "thread/contextUsage/read": { params: threadIdParams },
  "thread/usage/read": { params: threadIdParams },
  "thread/init/read": { params: threadIdParams },
  "account/read": { params: threadIdParams },
  "thread/compact/start": { params: threadCompactStartParams },
  "thread/reinitialize": { params: threadReinitializeParams },
  "thread/fork": { params: threadForkParams },
  "thread/name/set": { params: threadNameSetParams },
  "thread/tag/set": { params: threadTagSetParams },
  "thread/delete": { params: threadDeleteParams },
  "thread/rewind/anchors": { params: rewindAnchorsParams },
  "thread/rewind/dryRun": { params: rewindDryRunParams },
  "thread/rewind": { params: rewindParams },
  "mcpServer/status/list": { params: mcpStatusParams },
  "mcpServer/reconnect": { params: mcpNameParams },
  "mcpServer/toggle": { params: mcpToggleParams },
  "mcpServer/set": { params: mcpSetParams },
  "mcpServer/permissionModeOverride/set": { params: mcpOverrideParams },
  "task/list": { params: taskListParams },
  "task/stop": { params: taskStopParams },
  "turn/background": { params: turnBackgroundParams },
  "thread/settings/read": { params: settingsReadParams },
  "thread/directory/list": { params: directoryListParams },
  "thread/directory/add": { params: directoryPathParams },
  "thread/directory/remove": { params: directoryPathParams },
  "thread/permissionRule/add": { params: permissionRuleParams },
  "thread/permissionRule/remove": { params: permissionRuleParams },
  "thread/outputStyle/set": { params: outputStyleSetParams },
  "thread/effort/set": { params: effortSetParams },
  "thread/clear": { params: threadClearParams },
  // Task 5's probe promotions. Both reloads take the bare `{threadId}` — no options exist to pass, the
  // engine re-scans its whole plugin/skill set.
  // `turn/steer` is the spec's one X method that shipped: it rides `Query.streamInput`, an SDK surface with
  // no stability promise (probe 103b), so it is published in the experimental artifact only. The reloads
  // are NOT marked — they were probe-GATED, which is a question about whether to ship at all, not about
  // how stable the shape is once shipped; probe 105 answered it and they graduated straight to stable.
  "turn/steer": { params: turnSteerParams, experimental: true },
  // F10 T-IMGREACH Task 10 (I3d): the staged-image wire, both NEGOTIATED (task brief) — an old server
  // must answer METHOD_NOT_FOUND for either rather than accepting a widened `turn/start` input it cannot
  // honour (a text-only turn running with nobody told is the F9 failure this pair exists to end).
  // `image/stage` is server-scoped (no `threadId` — a stage lives on the CONNECTION, not on any thread)
  // and `turn/startContent` is the thread-scoped completion that resolves staged ids into blocks.
  "image/stage": { params: imageStageParams, experimental: true },
  "turn/startContent": { params: turnStartContentParams, experimental: true },
  // Task 11 (I3e): the mid-turn twin, negotiated for the identical reason — an old server must answer
  // METHOD_NOT_FOUND rather than accepting a widened `turn/steer` input it cannot honour.
  "turn/steerContent": { params: turnSteerContentParams, experimental: true },
  "plugin/reload": { params: threadIdParams },
  "skill/reload": { params: threadIdParams },
  // M3 Task 7's adoption pair (§1e). STABLE, not experimental: neither rides an unproven SDK seam — both
  // read this machine's own roster and the host wire that `ccx attach` has spoken since A2a.
  "fleet/list": { params: fleetListParams },
  "thread/attach": { params: threadAttachParams },
  // M3 Task 9 (§1e): the release half of adoption. Registered beside the pair above rather than with the
  // other thread-scoped methods because its MEANING is origin-branched — on a fleet thread it ends the
  // host, on an inProcess one it is `thread/close` — and reading it next to `thread/attach` is what makes
  // the pairing legible.
  "thread/stop": { params: threadStopParams },
  // M3 Task 12 (§2): the workspace pair. SERVER-scoped like the adoption pair above — no `threadId` —
  // and STABLE: both stand on node's own fs plus the TUI's shipped ranker, not on an SDK seam. (The SDK
  // seam that would have backed `fs/read`, `Query.readFile`, is probe-dead — probe 104.)
  "fs/read": { params: fsReadParams },
  "fs/search": { params: fsSearchParams },
  // M3 Task 13 (§3): the display-only shell escape, registered with the pair above because it shares their
  // module and their subject — this machine's filesystem — even though it is the one of the three that
  // names a thread. STABLE: `runBash` is our own primitive, and the deviation the params' `.describe()`
  // carries is about SEMANTICS (output never reaches the model), not about a shape that might move.
  "thread/shellCommand": { params: shellCommandParams },
  // M3 Task 14 (§4): the gap-10 recovery path. Registered last, matching `server.ts`'s table, though its
  // params live with the rest of the swap family in `schema/rewind.ts` — the module a reader looks in for
  // "what replaces a thread's engine". STABLE: the shape is a threadId and the mechanism is `swapEngine`,
  // both of which have shipped since M2b.
  "thread/reopen": { params: reopenParams },
  // M4 (§surface): the review domain's whole request surface, one method, registered last as `server.ts`'s
  // table takes it. STABLE, not experimental — the shape is Codex's own (`review.rs`), and the mechanism
  // under it is an ordinary turn on a thread this server creates, not an unproven SDK seam. The `target`
  // union rides out with it, so the generated artifact carries the four variants a client must choose from.
  "review/start": { params: reviewStartParams },
  // M5 (§config): the settings-files domain's read half, and the FIRST entry to declare a `result` —
  // D-M5-19's slot exists because a client cannot act on `versions` (the CAS token its next write must
  // carry) from a params schema alone. SERVER-scoped like `fs/read`: the subject is this machine's
  // settings files, not a thread. STABLE — the mechanism is node's own fs plus upstream's merge.
  "config/read": { params: configReadParams, result: configReadResult },
  // M5 (§config) Task 4: the write half, the pair that closes the domain's round trip — a client reads
  // `versions`, edits, and writes the token back. Both share `configWriteResult` because they share their
  // spine (`runConfigWrite`): one edit is the degenerate batch, and publishing two shapes for one reply
  // would let them drift. STABLE for the same reason `config/read` is — node's own fs plus upstream's
  // merge — and SERVER-scoped: the subject is a settings FILE, and no thread owns one.
  "config/value/write": { params: configValueWriteParams, result: configWriteResult },
  "config/batchWrite": { params: configBatchWriteParams, result: configWriteResult },
  // M5 (§search) Task 7: the store, searched. SERVER-scoped like the config trio — it names no thread; the
  // subject is every session on this machine, and the ones it finds are mostly threads this server never
  // opened. STABLE: the mechanism is the session store's own `listSessions`/`getSessionMessages` readers
  // plus our row classifier, none of it an unproven seam. Publishes a `result` (D-M5-19) because two of the
  // reply's three fields carry contracts a params schema cannot state — `nextCursor` may be non-null over
  // an EMPTY page (caps bound work, never coverage) and `skipped` is the disclosure that makes "no matches"
  // an honest claim — and a client that guesses either one wrong stops paging early or over-trusts the page.
  "thread/search": { params: threadSearchParams, result: threadSearchResult },
  // M5 (§search) Task 8: the store-wide search's sibling — ONE thread, EVERY hit in a row. THREAD-scoped
  // where its sibling is server-scoped, and that is the whole difference in kind: it names a thread, so both
  // dispatch gates can fire on it, and it is `ENGINE_GONE_EXEMPT` (server.ts) precisely because its subject
  // is disk rather than the engine — without the exemption the same session would be searchable by its bare
  // store id and refused by its own registry id. STABLE for its sibling's reasons (the store's own readers
  // plus our row classifier). Publishes a `result` (D-M5-19) carrying three contracts a params schema cannot
  // state: `snippetMatchRange` indexes into the occurrence's OWN snippet rather than into the row (two hits
  // in one row are two different windows), `readCursor` is `null` on a cold session rather than absent, and
  // `nextCursor` may again be non-null over an empty page.
  "thread/searchOccurrences": { params: threadSearchOccurrencesParams, result: threadSearchOccurrencesResult },
  // M5 (§archive) Task 9: the shelf pair. THREAD-scoped like the occurrence search above and
  // `ENGINE_GONE_EXEMPT` for the same reason — the subject is a marker FILE, so a thread whose engine died
  // must still be shelvable — and taking `threadIdParams` means either spelling of a thread works, a
  // registry id or a bare store sessionId, which is what lets a client archive a session this server has
  // never opened. STABLE: the mechanism is one atomic file create and one unlink, nothing SDK-shaped.
  // Both publish `okResult` (D-M5-19) and both publish the SAME one: the two methods are mirror images and
  // a client that reads one reply reads the other, so two spellings could only ever drift.
  "thread/archive": { params: threadIdParams, result: okResult },
  "thread/unarchive": { params: threadIdParams, result: okResult },
  // M7 (§the call) Task 8: the settlement method, registered LAST and registered NOW — Task 4 defined
  // both shapes and deliberately left them out of this table, because a method whose `callId` can only be
  // obtained by declaring tools is unreachable until `thread/start` accepts a declaration. That landed in
  // this same change, so the method goes live beside the params that make it usable. STABLE: the shape is
  // this milestone's own and rides no unproven SDK seam — the engine's side of it is an ordinary MCP
  // server this process builds. Publishes a `result` (D-M5-19) because the ack is load-bearing in a way
  // no params schema can state: `{}` means the answer was DELIVERED, and every other outcome — the race
  // lost, the id unknown, the thread gone — is an error code, so a client that cannot validate the empty
  // reply cannot tell "settled" from a reply it failed to understand.
  "tool/callResult": { params: toolCallResultParams, result: toolCallResultResult },
  // M8 (§peer): the cross-session domain, registered last because `tool/callResult` was — registration
  // order IS the artifact's order, and the scorecard lists these three after M7's settlement method.
  // `peer/list` and `peer/send` are SERVER-scoped (neither names a thread: the subject is every Claude
  // Code session on this machine, and the ones they reach are sessions this server never opened), while
  // `thread/crossSessionInbound/set` is thread-scoped — it sets ONE thread's inbound policy. All three
  // STABLE: the mechanism is this machine's own session registry plus the per-session Unix-socket inbox
  // the CLI already binds, not an unproven SDK seam. All three publish a `result` (D-M5-19) because
  // each reply carries a contract no params schema can state — `peer/list`'s `statusReachable` says a
  // peer can never answer, `peer/send`'s `delivered` is a literal `false` (the frame was WRITTEN; the
  // CLI tells a sender nothing on the success path), and the setter's ack is the closed `{ok:true}`.
  "peer/list": { params: peerListParams, result: peerListResult },
  "peer/send": { params: peerSendParams, result: peerSendResult },
  "thread/crossSessionInbound/set": { params: crossSessionInboundSetParams, result: crossSessionInboundSetResult },
};
