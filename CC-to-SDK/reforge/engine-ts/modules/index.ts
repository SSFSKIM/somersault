// The one registration site for engine-ts's owned modules (contract X7).
//
// `main.ts` imports this module for its side effects, before it reads the
// registry. A wave child that ships a standalone-complete module adds its import
// + `register(...)` call here and moves its closure-ledger row in the same
// commit.
//
// ## What "dual-wired" means concretely (§2.4)
//
// There is ONE owned implementation per module, and it lives at
// `strangle/modules/<name>/reference.js` — plain ESM, no globalThis, no
// minified identifier anywhere in it. Two wirings import that same file:
//
//   1. the strangler adapter (`strangle/modules/<name>.js`), which installs it
//      into the extracted graph's `globalThis.__reforge` and equality-asserts
//      the graph's `primitive` captures against the module's owned values;
//   2. this file, which registers it as part of engine-ts's owned set.
//
// Importing it HERE is not decoration: `check-reachability.ts` walks this import
// graph, so every reference module is proven — statically, per run — to reach no
// extraction chunk, no pinned binary and no `build/` artifact. A registration
// that merely named a string would prove nothing about the code it names.
//
// Registration is still a claim of ownership, not a proof of it. The proof is
// the two-phase gate (X1) plus the ledger row the wave moves (X2). The `entry`
// column below is checked so the claim at least refers to something that exists.
import { register } from "../registry.js";

import * as writeToolResult from "../../strangle/modules/write-tool-result/reference.js";
import * as editToolResult from "../../strangle/modules/edit-tool-result/reference.js";
import * as readToolResult from "../../strangle/modules/read-tool-result/reference.js";
import * as bashToolResult from "../../strangle/modules/bash-tool-result/reference.js";
import * as grepToolResult from "../../strangle/modules/grep-tool-result/reference.js";
import * as globResult from "../../strangle/modules/glob-result/reference.js";
import * as taskCreateResult from "../../strangle/modules/task-create-result/reference.js";
import * as taskGetResult from "../../strangle/modules/task-get-result/reference.js";
import * as taskListResult from "../../strangle/modules/task-list-result/reference.js";
import * as taskUpdateResult from "../../strangle/modules/task-update-result/reference.js";
import * as envBlock from "../../strangle/modules/env-block/reference.js";
import * as textDelta from "../../strangle/modules/text-delta/reference.js";
import * as sessionMaterialize from "../../strangle/modules/session-materialize/reference.js";
import * as globDescription from "../../strangle/modules/glob-description/reference.js";
import * as readDescription from "../../strangle/modules/read-description/reference.js";
import * as grepDescription from "../../strangle/modules/grep-description/reference.js";
import * as webFetchDescription from "../../strangle/modules/webfetch-description/reference.js";
import * as postToolHooks from "../../strangle/modules/post-tool-hooks/reference.js";
import * as preToolHooks from "../../strangle/modules/pre-tool-hooks/reference.js";
import * as postToolBatchHooks from "../../strangle/modules/post-tool-batch-hooks/reference.js";
import * as userPromptSubmitHooks from "../../strangle/modules/user-prompt-submit-hooks/reference.js";
import * as stopHooks from "../../strangle/modules/stop-hooks/reference.js";
import * as subagentStartHooks from "../../strangle/modules/subagent-start-hooks/reference.js";
import * as messageDisplayHooks from "../../strangle/modules/message-display-hooks/reference.js";
import * as postToolFailureHooks from "../../strangle/modules/post-tool-failure-hooks/reference.js";
import * as sessionStartHooks from "../../strangle/modules/session-start-hooks/reference.js";
import * as sessionEndHooks from "../../strangle/modules/session-end-hooks/reference.js";
import * as preCompactHooks from "../../strangle/modules/pre-compact-hooks/reference.js";
// C8's second round: the nine dispatchers the registry-derived re-measurement
// made spliceable.
import * as postCompactHooks from "../../strangle/modules/post-compact-hooks/reference.js";
import * as notificationHooks from "../../strangle/modules/notification-hooks/reference.js";
import * as instructionsLoadedHooks from "../../strangle/modules/instructions-loaded-hooks/reference.js";
import * as stopFailureHooks from "../../strangle/modules/stop-failure-hooks/reference.js";
import * as taskCreatedHooks from "../../strangle/modules/task-created-hooks/reference.js";
import * as taskCompletedHooks from "../../strangle/modules/task-completed-hooks/reference.js";
import * as permissionRequestHooks from "../../strangle/modules/permission-request-hooks/reference.js";
import * as userPromptExpansionHooks from "../../strangle/modules/user-prompt-expansion-hooks/reference.js";
import * as fileChangedHooks from "../../strangle/modules/file-changed-hooks/reference.js";
import * as permissionDecision from "../../strangle/modules/permission-decision/reference.js";
// W6 / C9 — the permission subsystem's decision chain, mode axis and headless
// broker seam. Fifteen modules; the subsystem does NOT close on them (the
// mode-aware decision body above the pre-check and the broker's own
// `createCanUseTool` are §2.3 deferrals recorded on the ledger row).
import * as permissionPrecheck from "../../strangle/modules/permission-precheck/reference.js";
import * as ruleBasedPermissions from "../../strangle/modules/rule-based-permissions/reference.js";
import * as allowRuleDecision from "../../strangle/modules/allow-rule-decision/reference.js";
import * as classifierStreak from "../../strangle/modules/classifier-streak/reference.js";
import * as modeChangeGuard from "../../strangle/modules/mode-change-guard/reference.js";
import * as modeTransition from "../../strangle/modules/mode-transition/reference.js";
import * as permissionRequestHookDecision from "../../strangle/modules/permission-request-hook-decision/reference.js";
import * as brokerResponseMap from "../../strangle/modules/broker-response-map/reference.js";
import * as brokerPermissionUpdates from "../../strangle/modules/broker-permission-updates/reference.js";
import * as controlResponseSuccess from "../../strangle/modules/control-response-success/reference.js";
import * as controlResponseError from "../../strangle/modules/control-response-error/reference.js";
import * as compactionPrompt from "../../strangle/modules/compaction-prompt/reference.js";
import * as systemPromptBlocks from "../../strangle/modules/system-prompt-blocks/reference.js";
import * as systemPromptWire from "../../strangle/modules/system-prompt-wire/reference.js";
import * as identityPrompt from "../../strangle/modules/identity-prompt/reference.js";
import * as contextReminder from "../../strangle/modules/context-reminder/reference.js";
import * as contextPromptLines from "../../strangle/modules/context-prompt-lines/reference.js";
import * as subagentPrompt from "../../strangle/modules/subagent-prompt/reference.js";
import * as compactBoundary from "../../strangle/modules/compact-boundary/reference.js";
import * as compactBoundaryWire from "../../strangle/modules/compact-boundary-wire/reference.js";
import * as compactContinuation from "../../strangle/modules/compact-continuation/reference.js";
import * as autoCompactTrigger from "../../strangle/modules/auto-compact-trigger/reference.js";

/** name, closure-ledger subsystem row, and the module's entry point. */
const OWNED: [string, string, unknown][] = [
  // Ten of the graph's 44 tool-result formatters (C4 / W1).
  ["write-tool-result", "subsystem/tool-result-formatters", writeToolResult.writeToolResultBlock],
  ["edit-tool-result", "subsystem/tool-result-formatters", editToolResult.editToolResultBlock],
  ["read-tool-result", "subsystem/tool-result-formatters", readToolResult.readToolResultBlock],
  ["bash-tool-result", "subsystem/tool-result-formatters", bashToolResult.bashToolResultBlock],
  ["grep-tool-result", "subsystem/tool-result-formatters", grepToolResult.grepToolResultBlock],
  ["glob-result", "subsystem/tool-result-formatters", globResult.globResultBlock],
  ["task-create-result", "subsystem/tool-result-formatters", taskCreateResult.taskCreateResultBlock],
  ["task-get-result", "subsystem/tool-result-formatters", taskGetResult.taskGetResultBlock],
  ["task-list-result", "subsystem/tool-result-formatters", taskListResult.taskListResultBlock],
  ["task-update-result", "subsystem/tool-result-formatters", taskUpdateResult.taskUpdateResultBlock],
  // The W0a mechanism spikes, standalone-complete since C4's retrofit. Their
  // SUBSYSTEMS belong to later waves — one owned module is not an owned
  // subsystem, and the ledger says so.
  ["env-block", "subsystem/environment-and-system-prompt", envBlock.envBlock],
  ["text-delta", "subsystem/query-loop", textDelta.appendTextDelta],
  ["session-materialize", "subsystem/session-storage", sessionMaterialize.materializeSessionFile],
  // Four of the catalog's tool descriptions (C5 / W2). `glob-description` is the
  // campaign's first S-CHUNK: it is not a function spliced out of a chunk but the
  // whole of chunk-y30v0ja7, so registering it claims its two tool-name constants
  // as well as its description function. The other three are S-method splices —
  // their chunks carry 15/17/4 exports of unrelated behaviour and stay upstream's.
  //
  // The SUBSYSTEM row they contribute to does not close on them: its charter is
  // every description function plus the satellite chunks' other exports, and
  // three of those four chunks are still upstream's. reforge/ledger.json says so.
  ["glob-description", "subsystem/tool-descriptions", globDescription.globDescription],
  ["read-description", "subsystem/tool-descriptions", readDescription.readDescription],
  ["grep-description", "subsystem/tool-descriptions", grepDescription.grepDescription],
  ["webfetch-description", "subsystem/tool-descriptions", webFetchDescription.webFetchDescription],
  // C5x's three mechanism-round-2 modules. They shipped as permanent owned
  // splices rather than rehearsals, but their registration was missed — an X7
  // gap the skeleton test caught the moment the next wave added a row, and one
  // nothing in the gate was watching (skeleton.test.ts is not a gate phase).
  // Registered here by W3 for the same reason C5x's attestation obligation
  // lands here: the owning wave closes what the mechanism wave deferred.
  ["post-tool-hooks", "subsystem/hook-dispatch", postToolHooks.postToolHooks],
  ["permission-decision", "subsystem/permissions", permissionDecision.permissionDecisionWithSink],
  ["compaction-prompt", "subsystem/compaction", compactionPrompt.summarizationPrompt],
  // W3's prompt-assembly pipeline (C6). Six modules, one subsystem row, and the
  // row still does not close on them: the section BUILDERS behind the preset's
  // 27 KB block are upstream's, and so is the tool serializer. reforge/ledger.json
  // says so.
  ["system-prompt-blocks", "subsystem/environment-and-system-prompt", systemPromptBlocks.systemPromptBlocks],
  ["system-prompt-wire", "subsystem/environment-and-system-prompt", systemPromptWire.systemPromptTextBlocks],
  ["identity-prompt", "subsystem/environment-and-system-prompt", identityPrompt.identityPrompt],
  ["context-reminder", "subsystem/environment-and-system-prompt", contextReminder.contextReminderMessages],
  ["context-prompt-lines", "subsystem/environment-and-system-prompt", contextPromptLines.contextPromptLines],
  ["subagent-prompt", "subsystem/environment-and-system-prompt", subagentPrompt.subagentPrompt],
  // W4's compaction units (C7). Four modules, and with C5x's summarization
  // prompt the row now holds the whole client-side compaction surface EXCEPT the
  // drivers: what the model is asked, what its answer becomes, what the session
  // wakes up with, what the boundary records, and what decides to compact. The
  // async generators that act on that decision are the query loop's (C16), so
  // the row is `spliced`, not `standalone-complete` — reforge/ledger.json says so.
  ["compact-boundary", "subsystem/compaction", compactBoundary.compactBoundary],
  ["compact-boundary-wire", "subsystem/compaction", compactBoundaryWire.compactBoundaryWire],
  ["compact-continuation", "subsystem/compaction", compactContinuation.compactContinuation],
  ["auto-compact-trigger", "subsystem/compaction", autoCompactTrigger.autoCompactTrigger],
  // W5's hook dispatchers (C8). NINETEEN modules, and with C5x's PostToolUse
  // dispatcher that is TWENTY functions covering TWENTY-ONE of the TWENTY-THREE
  // events the engine is measured to fire headlessly — `stop-hooks` serves Stop
  // and SubagentStop through one internal conditional, and the two model-switch
  // dispatchers are a recorded ledger gap rather than an omission.
  //
  // The count moved twice, and both moves were measurement rather than work.
  // C8's boundary round found the wave's "all eight" claim resting on a probe
  // whose negatives were vacuous; its second round found the re-measurement
  // still choosing its own watched list, and derived the population from
  // upstream's dispatcher registry instead — which took the live set from twelve
  // events to twenty-three.
  //
  // The row stays `spliced`, not `standalone-complete`: what these delegate
  // INTO — the 23 KB shared executor, its awaiting sibling and the watcher-hooks
  // helper, with matching, command/callback/http/mcp invocation, timeouts and
  // cancellation — is a port and S-module-shaped, so the subsystem does not
  // close on the dispatchers. reforge/ledger.json says so.
  ["pre-tool-hooks", "subsystem/hook-dispatch", preToolHooks.preToolHooks],
  ["post-tool-batch-hooks", "subsystem/hook-dispatch", postToolBatchHooks.postToolBatchHooks],
  ["user-prompt-submit-hooks", "subsystem/hook-dispatch", userPromptSubmitHooks.userPromptSubmitHooks],
  ["stop-hooks", "subsystem/hook-dispatch", stopHooks.stopHooks],
  ["subagent-start-hooks", "subsystem/hook-dispatch", subagentStartHooks.subagentStartHooks],
  ["message-display-hooks", "subsystem/hook-dispatch", messageDisplayHooks.messageDisplayHooks],
  ["post-tool-failure-hooks", "subsystem/hook-dispatch", postToolFailureHooks.postToolFailureHooks],
  ["session-start-hooks", "subsystem/hook-dispatch", sessionStartHooks.sessionStartHooks],
  ["session-end-hooks", "subsystem/hook-dispatch", sessionEndHooks.sessionEndHooks],
  ["pre-compact-hooks", "subsystem/hook-dispatch", preCompactHooks.preCompactHooks],
  ["post-compact-hooks", "subsystem/hook-dispatch", postCompactHooks.postCompactHooks],
  ["notification-hooks", "subsystem/hook-dispatch", notificationHooks.notificationHooks],
  ["instructions-loaded-hooks", "subsystem/hook-dispatch", instructionsLoadedHooks.instructionsLoadedHooks],
  ["stop-failure-hooks", "subsystem/hook-dispatch", stopFailureHooks.stopFailureHooks],
  ["task-created-hooks", "subsystem/hook-dispatch", taskCreatedHooks.taskCreatedHooks],
  ["task-completed-hooks", "subsystem/hook-dispatch", taskCompletedHooks.taskCompletedHooks],
  ["permission-request-hooks", "subsystem/hook-dispatch", permissionRequestHooks.permissionRequestHooks],
  ["user-prompt-expansion-hooks", "subsystem/hook-dispatch", userPromptExpansionHooks.userPromptExpansionHooks],
  ["file-changed-hooks", "subsystem/hook-dispatch", fileChangedHooks.fileChangedHooks],
  // W6 / C9. Two of these belong to the CONTROL PROTOCOL rather than to
  // permissions — the success and error response envelopes — and are registered
  // under that subsystem: the permission wave took them because the
  // `can_use_tool` round trip is the only control request the permission chain
  // itself issues, and leaving the return leg unowned would have stopped the
  // chain's ownership mid-round-trip. W7 inherits the request leg.
  ["permission-precheck", "subsystem/permissions", permissionPrecheck.permissionPrecheck],
  ["rule-based-permissions", "subsystem/permissions", ruleBasedPermissions.checkRuleBasedPermissions],
  ["allow-rule-decision", "subsystem/permissions", allowRuleDecision.allowRuleDecision],
  ["classifier-streak", "subsystem/permissions", classifierStreak.classifierOnlyStreakActive],
  ["mode-change-guard", "subsystem/permissions", modeChangeGuard.guardPermissionModeChange],
  ["mode-transition", "subsystem/permissions", modeTransition.transitionPermissionMode],
  ["permission-request-hook-decision", "subsystem/permissions", permissionRequestHookDecision.permissionRequestHookDecision],
  ["broker-response-map", "subsystem/permissions", brokerResponseMap.brokerResponseMap],
  ["broker-permission-updates", "subsystem/permissions", brokerPermissionUpdates.brokerPermissionUpdates],
  ["control-response-success", "subsystem/control-protocol", controlResponseSuccess.controlResponseSuccess],
  ["control-response-error", "subsystem/control-protocol", controlResponseError.controlResponseError],
];

for (const [name, subsystem, entry] of OWNED) {
  if (typeof entry !== "function") {
    throw new Error(`engine-ts: '${name}' registers a module whose entry point is not a function — the reference module moved or its export was renamed`);
  }
  register({ name, subsystem });
}

export {};
