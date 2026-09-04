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
import * as processLifecycle from "../../strangle/modules/process-lifecycle/reference.js";
import * as shellParser from "../../strangle/modules/shell-parser/reference.js";
import * as twnIsShuttingDown from "../../strangle/modules/twn-is-shutting-down/reference.js";
import * as twnClaimShutdown from "../../strangle/modules/twn-claim-shutdown/reference.js";
import * as twnReleaseShutdownClaim from "../../strangle/modules/twn-release-shutdown-claim/reference.js";
import * as twnShutdownSync from "../../strangle/modules/twn-shutdown-sync/reference.js";
import * as kySigintHandler from "../../strangle/modules/ky-sigint-handler/reference.js";
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
import * as permissionDeniedHooks from "../../strangle/modules/permission-denied-hooks/reference.js";
import * as userPromptExpansionHooks from "../../strangle/modules/user-prompt-expansion-hooks/reference.js";
import * as fileChangedHooks from "../../strangle/modules/file-changed-hooks/reference.js";
import * as cwdChangedHooks from "../../strangle/modules/cwd-changed-hooks/reference.js";
import * as hookJsonContract from "../../strangle/modules/hook-json-contract/reference.js";
import * as hookStderrTail from "../../strangle/modules/hook-stderr-tail/reference.js";
// C10.6's fix round — three more of the pure belt, taken to prove the corrected
// anchorability measurement rather than to add bytes.
import * as hookOutputSync from "../../strangle/modules/hook-output-sync/reference.js";
import * as cronCreateDescription from "../../strangle/modules/cron-create-description/reference.js";
import * as cronDeleteDescription from "../../strangle/modules/cron-delete-description/reference.js";
import * as cronListDescription from "../../strangle/modules/cron-list-description/reference.js";
import * as enterWorktreeDescription from "../../strangle/modules/enter-worktree-description/reference.js";
import * as exitWorktreeDescription from "../../strangle/modules/exit-worktree-description/reference.js";
import * as reportFindingsDescription from "../../strangle/modules/report-findings-description/reference.js";
import * as taskStopDescription from "../../strangle/modules/task-stop-description/reference.js";
import * as remoteTriggerDescription from "../../strangle/modules/remote-trigger-description/reference.js";
import * as listAgentsDescription from "../../strangle/modules/list-agents-description/reference.js";
import * as sendMessageDescription from "../../strangle/modules/send-message-description/reference.js";
import * as scheduleWakeupDescription from "../../strangle/modules/schedule-wakeup-description/reference.js";
import * as taskOutputDescription from "../../strangle/modules/task-output-description/reference.js";
import * as workflowDescription from "../../strangle/modules/workflow-description/reference.js";
import * as enterPlanModeDescription from "../../strangle/modules/enter-plan-mode-description/reference.js";
import * as exitPlanModeDescription from "../../strangle/modules/exit-plan-mode-description/reference.js";
import * as askUserQuestionDescription from "../../strangle/modules/ask-user-question-description/reference.js";
import * as hookOutputAsync from "../../strangle/modules/hook-output-async/reference.js";
import * as hookInvocationText from "../../strangle/modules/hook-invocation-text/reference.js";
import * as permissionDecision from "../../strangle/modules/permission-decision/reference.js";
// W6 / C9 — the permission subsystem's decision chain, mode axis and headless
// broker seam. Fifteen modules; the subsystem does NOT close on them (the
// mode-aware decision body above the pre-check and the broker's own
// `createCanUseTool` are §2.3 deferrals recorded on the ledger row).
import * as permissionPrecheck from "../../strangle/modules/permission-precheck/reference.js";
// C9's fix round: two shape tests over a decisionReason that the wave had
// adjudicated dark and the corpus's first `auto` cell showed to be live. They
// live in `shared/` because the owned decision modules use them directly as well.
import * as safetyCheckReason from "../../strangle/modules/safety-check-reason/reference.js";
import * as askRuleReason from "../../strangle/modules/ask-rule-reason/reference.js";
import * as ruleBasedPermissions from "../../strangle/modules/rule-based-permissions/reference.js";
import * as allowRuleDecision from "../../strangle/modules/allow-rule-decision/reference.js";
import * as modeChangeGuard from "../../strangle/modules/mode-change-guard/reference.js";
import * as modeTransition from "../../strangle/modules/mode-transition/reference.js";
import * as permissionRequestHookDecision from "../../strangle/modules/permission-request-hook-decision/reference.js";
import * as brokerResponseMap from "../../strangle/modules/broker-response-map/reference.js";
import * as brokerPermissionUpdates from "../../strangle/modules/broker-permission-updates/reference.js";
import * as controlResponseSuccess from "../../strangle/modules/control-response-success/reference.js";
import * as controlResponseError from "../../strangle/modules/control-response-error/reference.js";
import * as thinkingConfig from "../../strangle/modules/thinking-config/reference.js";
import * as permissionModeSetter from "../../strangle/modules/permission-mode-setter/reference.js";
import * as modelSwitch from "../../strangle/modules/model-switch/reference.js";
import * as initializePayload from "../../strangle/modules/initialize-payload/reference.js";
import * as initializeHandler from "../../strangle/modules/initialize-handler/reference.js";
import * as compactionPrompt from "../../strangle/modules/compaction-prompt/reference.js";
import * as systemPromptBlocks from "../../strangle/modules/system-prompt-blocks/reference.js";
import * as systemPromptWire from "../../strangle/modules/system-prompt-wire/reference.js";
import * as identityPrompt from "../../strangle/modules/identity-prompt/reference.js";
import * as contextReminder from "../../strangle/modules/context-reminder/reference.js";
import * as contextPromptLines from "../../strangle/modules/context-prompt-lines/reference.js";
import * as subagentPrompt from "../../strangle/modules/subagent-prompt/reference.js";
// W7.5 / C10.5 — the OS() prompt SECTIONS. W3 owns the pipeline that partitions
// and wires the prompt; these are six of the sections that go into it.
import * as executingActionsSection from "../../strangle/modules/executing-actions-section/reference.js";
import * as doingTasksSection from "../../strangle/modules/doing-tasks-section/reference.js";
import * as systemSection from "../../strangle/modules/system-section/reference.js";
import * as toneAndStyleSection from "../../strangle/modules/tone-and-style-section/reference.js";
import * as usingToolsSection from "../../strangle/modules/using-tools-section/reference.js";
import * as identitySecuritySection from "../../strangle/modules/identity-security-section/reference.js";
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
  // W7.5 / C10.5 — the section builders behind the preset's prose.
  ["executing-actions-section", "subsystem/environment-and-system-prompt", executingActionsSection.executingActionsSection],
  ["doing-tasks-section", "subsystem/environment-and-system-prompt", doingTasksSection.doingTasksSection],
  ["system-section", "subsystem/environment-and-system-prompt", systemSection.systemSection],
  ["tone-and-style-section", "subsystem/environment-and-system-prompt", toneAndStyleSection.toneAndStyleSection],
  ["using-tools-section", "subsystem/environment-and-system-prompt", usingToolsSection.usingToolsSection],
  ["identity-security-section", "subsystem/environment-and-system-prompt", identitySecuritySection.identitySecuritySection],
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
  ["permission-denied-hooks", "subsystem/hook-dispatch", permissionDeniedHooks.permissionDeniedHooks],
  ["user-prompt-expansion-hooks", "subsystem/hook-dispatch", userPromptExpansionHooks.userPromptExpansionHooks],
  ["file-changed-hooks", "subsystem/hook-dispatch", fileChangedHooks.fileChangedHooks],
  // W7.5 — FileChanged's twin, unspliceable until its firing condition was created.
  ["cwd-changed-hooks", "subsystem/hook-dispatch", cwdChangedHooks.cwdChangedHooks],
  // W7.6a — the layer BENEATH the dispatchers: the one interpreter of a hook's
  // parsed JSON output, shared by all five of the executor's answer paths.
  ["hook-json-contract", "subsystem/hook-dispatch", hookJsonContract.hookJsonContract],
  // …and the one pure helper BOTH executors share, which is what "two consumers
  // of shared pure helpers" (design §2) means at its smallest scale.
  ["hook-stderr-tail", "subsystem/hook-dispatch", hookStderrTail.hookStderrTail],
  // …and the fix round's three. The sync/async pair is upstream's own
  // discriminator between a hook RESULT and an async ACKNOWLEDGEMENT, declared
  // as two functions rather than one and its negation because they guard
  // different things; the invocation text is what the streaming executor
  // actually runs for a command hook, and what three other consumers use to name
  // a hook in an attachment.
  ["hook-output-sync", "subsystem/hook-dispatch", hookOutputSync.hookOutputIsSync],
  ["hook-output-async", "subsystem/hook-dispatch", hookOutputAsync.hookOutputIsAsync],
  ["hook-invocation-text", "subsystem/hook-dispatch", hookInvocationText.hookInvocationText],
  // W6 / C9. Two of these belong to the CONTROL PROTOCOL rather than to
  // permissions — the success and error response envelopes — and are registered
  // under that subsystem: the permission wave took them because the
  // `can_use_tool` round trip is the only control request the permission chain
  // itself issues, and leaving the return leg unowned would have stopped the
  // chain's ownership mid-round-trip. W7 inherits the request leg.
  ["permission-precheck", "subsystem/permissions", permissionPrecheck.permissionPrecheck],
  ["safety-check-reason", "subsystem/permissions", safetyCheckReason.findSafetyCheckReason],
  ["ask-rule-reason", "subsystem/permissions", askRuleReason.isAskRuleDrivenReason],
  ["rule-based-permissions", "subsystem/permissions", ruleBasedPermissions.checkRuleBasedPermissions],
  ["allow-rule-decision", "subsystem/permissions", allowRuleDecision.allowRuleDecision],
  ["mode-change-guard", "subsystem/permissions", modeChangeGuard.guardPermissionModeChange],
  ["mode-transition", "subsystem/permissions", modeTransition.transitionPermissionMode],
  ["permission-request-hook-decision", "subsystem/permissions", permissionRequestHookDecision.permissionRequestHookDecision],
  ["broker-response-map", "subsystem/permissions", brokerResponseMap.brokerResponseMap],
  ["broker-permission-updates", "subsystem/permissions", brokerPermissionUpdates.brokerPermissionUpdates],
  ["control-response-success", "subsystem/control-protocol", controlResponseSuccess.controlResponseSuccess],
  ["control-response-error", "subsystem/control-protocol", controlResponseError.controlResponseError],
  // C10 / W7 — the named handlers the live dispatch arms delegate to. The
  // ladder itself is not takeable (its arms carry loop control); these are.
  ["thinking-config", "subsystem/control-protocol", thinkingConfig.resolveThinkingConfig],
  ["permission-mode-setter", "subsystem/control-protocol", permissionModeSetter.applyPermissionModeRequest],
  ["model-switch", "subsystem/control-protocol", modelSwitch.applyModelSwitchRequest],
  ["initialize-payload", "subsystem/control-protocol", initializePayload.buildInitializeResponsePayload],
  ["initialize-handler", "subsystem/control-protocol", initializeHandler.handleInitialize],
  // C11a / W8a — the moat-tool description belt. Sixteen tools whose prose the
  // engine renders into every graded request body and whose `call` no scenario
  // has ever run; owning the description is the whole of what is observable
  // about them today, and under this campaign's strategy it is also the whole
  // of what makes them customizable.
  ["cron-create-description", "subsystem/moat-tools", cronCreateDescription.cronCreateDescription],
  ["cron-delete-description", "subsystem/moat-tools", cronDeleteDescription.cronDeleteDescription],
  ["cron-list-description", "subsystem/moat-tools", cronListDescription.cronListDescription],
  ["enter-worktree-description", "subsystem/moat-tools", enterWorktreeDescription.enterWorktreeDescription],
  ["exit-worktree-description", "subsystem/moat-tools", exitWorktreeDescription.exitWorktreeDescription],
  ["report-findings-description", "subsystem/moat-tools", reportFindingsDescription.reportFindingsDescription],
  ["task-stop-description", "subsystem/moat-tools", taskStopDescription.taskStopDescription],
  ["remote-trigger-description", "subsystem/moat-tools", remoteTriggerDescription.remoteTriggerDescription],
  ["list-agents-description", "subsystem/moat-tools", listAgentsDescription.listAgentsDescription],
  ["send-message-description", "subsystem/moat-tools", sendMessageDescription.sendMessageDescription],
  ["schedule-wakeup-description", "subsystem/moat-tools", scheduleWakeupDescription.scheduleWakeupDescription],
  ["task-output-description", "subsystem/moat-tools", taskOutputDescription.taskOutputDescription],
  ["workflow-description", "subsystem/moat-tools", workflowDescription.workflowDescription],
  ["enter-plan-mode-description", "subsystem/moat-tools", enterPlanModeDescription.enterPlanModeDescription],
  ["exit-plan-mode-description", "subsystem/moat-tools", exitPlanModeDescription.exitPlanModeDescription],
  ["ask-user-question-description", "subsystem/moat-tools", askUserQuestionDescription.askUserQuestionDescription],
  // C16b / W13a — the process lifecycle latch, the campaign's second S-CHUNK.
  // Registered under the query loop because that is what consults it: the turn
  // driver reads it, the streaming tool loop reads it, and the hook layer's
  // shutdown arms are built out of it. The row does not close on it — one latch
  // is not the loop — but the executor children (C10.7/C10.8) can now consume
  // `isShuttingDown`/`hang` from an owned module instead of stubbing them.
  ["process-lifecycle", "subsystem/query-loop", processLifecycle.isShuttingDown],
  // …and the shutdown coordinator's own methods around it. Four of `TWn`'s 44
  // members: the in-progress claim's reader, its two writers, and the
  // synchronous shutdown entry point that commits the latch. The other 40 stay
  // upstream's, each with a verdict in the ledger row.
  ["twn-is-shutting-down", "subsystem/query-loop", twnIsShuttingDown.twnIsShuttingDown],
  ["twn-claim-shutdown", "subsystem/query-loop", twnClaimShutdown.twnClaimShutdown],
  ["twn-release-shutdown-claim", "subsystem/query-loop", twnReleaseShutdownClaim.twnReleaseShutdownClaim],
  ["twn-shutdown-sync", "subsystem/query-loop", twnShutdownSync.twnShutdownSync],
  // …and the headless dispatcher's SIGINT handler — the one of the graph's six
  // lifecycle signal handlers that fits a target shape, measured rather than
  // chosen (research/fixtures/process-lifecycle-<pin>.json records the
  // excisability of all six).
  ["ky-sigint-handler", "subsystem/query-loop", kySigintHandler.kySigintHandler],
  // C13a / W10a — the bash parser, the campaign's THIRD S-chunk and its largest
  // ownership: 62,907 upstream bytes reimplemented behind the same seven
  // exports. Registered under the Bash executor because that is the subsystem
  // whose row it belongs to, and because everything else in W10 reads its
  // nodes — the command-safety chain, the destructive classifier and the
  // per-subcommand permission aggregate all start from a tree this module built.
  // The row does not close on it: the executor, the spawn, the sandbox wrap and
  // the backgrounding are all still upstream's, and are C13b through C13e's.
  ["shell-parser", "subsystem/bash-executor", shellParser.parseOrAbort],
];

for (const [name, subsystem, entry] of OWNED) {
  if (typeof entry !== "function") {
    throw new Error(`engine-ts: '${name}' registers a module whose entry point is not a function — the reference module moved or its export was renamed`);
  }
  register({ name, subsystem });
}

export {};
