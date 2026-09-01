// PARITY LAYER (§2.5 `reference`) — the `initialize` control handler (upstream
// `Ey`, 2.1.251, chunk-dvbbv89q).
//
// THE HANDSHAKE. Every SDK-driven session sends exactly one `initialize` before
// its first prompt, so this runs on every scenario the corpus has, and it is
// where the session's whole configuration surface is applied: the system prompt
// and its append, plan-mode instructions, the subagent prompt suffix, tool
// aliases, dynamic-section exclusions, prompt suggestions, subagent text
// forwarding, skills, agent definitions, host hooks and the JSON schema. Then it
// answers with the initialize payload (`initialize-payload`, owned separately).
//
// TWO ENTRY POINTS IN ONE FUNCTION, and the first one returns before any of the
// above runs:
//
//   REINITIALIZE — a host reconnecting to a session already in flight. It does
//     NOT re-apply configuration. It re-registers the host's hook callbacks
//     (retiring the previous generation with a fixed deny-shaped fallback so an
//     in-flight consult cannot hang on a callback nobody will answer), reports
//     how much was pending, answers with the payload PLUS the pending permission
//     and dialog requests, and re-drives the app state. It returns `{}` — no
//     restricted model, no merged agents — which is the caller's signal that
//     nothing was configured.
//   INITIALIZE — the ordinary path.
//
// THE HOST-HOOK OWNERSHIP TEST IS NOT A FORMALITY. Hooks are re-registered only
// when the host owns the stdin origin; a session whose stdin belongs to someone
// else gets `undefined`, which the telemetry then reports as "not applied" and
// the payload reports as a tri-state (`true` / `false` / absent, and absent
// means "the host did not ask").
//
// THE AGENT ARM IS THE SUBTLE ONE. It runs only when an agent was selected at
// launch AND the definition list resolves it AND it is not already the main
// thread's agent — but the `initialPrompt` is prepended EITHER WAY, through two
// different branches, so an agent that is already active still contributes its
// opening message. Inside the arm: the agent's system prompt is adopted only if
// none was set and the agent is not built-in; and its model is adopted only if
// the user pinned none, with the exempt/allowed models applied as an override
// and everything else returned to the caller as a RESTRICTED model for it to
// notice. Two different destinations for one field, chosen by two predicates.
//
// THE ANSWER IS ENQUEUED BEFORE THE HANDSHAKE TELEMETRY, and the auth-status
// frame after it. Order is behaviour on a wire the host reads in sequence.

/**
 * @param request                the initialize control request
 * @param requestId              the request id the answer must carry
 * @param isReinitialize         reconnect rather than first handshake
 * @param outbound               port — the outbound frame queue
 * @param commandSource          the slash-command source the payload renders
 * @param models                 the models the payload reports
 * @param unavailableModels      the models it reports as unavailable
 * @param transport              port — hook callbacks, pending requests, session state
 * @param enableAuthStatus       does the host want an auth_status frame?
 * @param options                the mutable launch options this handler configures
 * @param getAgents              port — the session's agent definitions
 * @param getAppState            port — the live app state
 * @param setAppState            port — update the app state (tool aliases)
 * @param getFastMode            port — the fast-mode input the payload reports
 * @param hostOwnsHooks          port — may the host's hooks be applied at all?
 * @param retiredCallbackAnswer  port — the answer a retired hook callback gives
 * @param registerHookCallbacks  port — register the host's hook callbacks
 * @param logEvent               port — telemetry
 * @param telemetryNumber        port — sanitise a count for telemetry
 * @param buildPayload           port — the initialize response payload (owned separately)
 * @param activeAgents           port — narrow a definition list to the active agents
 * @param onReinitialized        port — re-drive the app state after a reconnect
 * @param isEmptySystemPrompt    port — recognise the "explicitly empty" prompt shape
 * @param normalizeDialogKinds   port — normalise the host's declared dialog kinds
 * @param recordDialogKinds      port — record them against the session
 * @param isRestartedWorkerEpoch port — attach-time vs create-time, for that record
 * @param env                    port — the process environment record
 * @param setPerTaskStopAffordance port — the per-task stop affordance flag
 * @param applySkills            port — apply the host's skill list
 * @param parseAgentDefinitions  port — parse the host's agent definitions
 * @param mainThreadAgentType    port — the agent the main thread is already running
 * @param findAgentDefinition    port — resolve an agent type in a definition list
 * @param setActiveAgentType     port — make that agent the active one
 * @param applyAgentDefinition   port — apply the rest of the agent's definition
 * @param isBuiltInAgent         port — built-in agents do not donate their prompt
 * @param parseModel             port — parse the agent's model string
 * @param isExemptModelPick      port — an exempt pick is applied, not restricted
 * @param isModelAllowed         port — an allowed model is applied, not restricted
 * @param applyModelOverride     port — apply the agent's model as an override
 * @param applyJsonSchema        port — apply the host's structured-output schema
 * @param countBy                port — count matching MCP clients for telemetry
 * @param mcpNonBlocking         port — the MCP non-blocking flag, for telemetry
 * @param authStatusService      port — the auth-status singleton
 * @param newUuid                port — the auth_status frame's uuid
 * @param currentSessionId       port — the auth_status frame's session id
 */
export async function handleInitialize(
  request,
  requestId,
  isReinitialize,
  outbound,
  commandSource,
  models,
  unavailableModels,
  transport,
  enableAuthStatus,
  options,
  getAgents,
  getAppState,
  setAppState,
  getFastMode,
  hostOwnsHooks,
  retiredCallbackAnswer,
  registerHookCallbacks,
  logEvent,
  telemetryNumber,
  buildPayload,
  activeAgents,
  onReinitialized,
  isEmptySystemPrompt,
  normalizeDialogKinds,
  recordDialogKinds,
  isRestartedWorkerEpoch,
  env,
  setPerTaskStopAffordance,
  applySkills,
  parseAgentDefinitions,
  mainThreadAgentType,
  findAgentDefinition,
  setActiveAgentType,
  applyAgentDefinition,
  isBuiltInAgent,
  parseModel,
  isExemptModelPick,
  isModelAllowed,
  applyModelOverride,
  applyJsonSchema,
  countBy,
  mcpNonBlocking,
  authStatusService,
  newUuid,
  currentSessionId,
) {
  let restrictedAgentModel;
  if (isReinitialize) {
    const hostHooks = hostOwnsHooks(request, transport);
    let settled = 0;
    if (hostHooks) {
      settled = transport.retireSdkHostHookCallbacks(retiredCallbackAnswer);
      registerHookCallbacks(hostHooks, (event, id) => transport.createHookCallback(event, id));
    }
    const pendingPermissions = transport.getPendingPermissionRequests();
    const pendingDialogs = transport.getPendingUserDialogRequests();
    logEvent("tengu_reinit_pending_redelivery", {
      n_pending_permissions: telemetryNumber(pendingPermissions.length),
      n_pending_dialogs: telemetryNumber(pendingDialogs.length),
      host_hooks_resent: request.hooks !== undefined,
      host_hooks_applied: hostHooks !== undefined,
      n_settled_hook_callbacks: telemetryNumber(settled),
    });
    outbound.enqueue({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: await buildPayload(
          commandSource,
          activeAgents(getAgents()),
          models,
          unavailableModels,
          getAppState,
          getFastMode(),
          () => transport.sessionState.getState(),
          request.hooks ? hostHooks !== undefined : undefined,
          options.storageV5,
        ),
        pending_permission_requests: pendingPermissions,
        pending_user_dialog_requests: pendingDialogs,
      },
    });
    onReinitialized(getAppState());
    return {};
  }
  if (request.systemPrompt !== undefined) options.systemPrompt = isEmptySystemPrompt(request.systemPrompt) ? "" : request.systemPrompt;
  if (request.supportedDialogKinds !== undefined) {
    const kinds = normalizeDialogKinds(request.supportedDialogKinds);
    recordDialogKinds(kinds, isRestartedWorkerEpoch(env.CLAUDE_CODE_WORKER_EPOCH) ? "attach_time" : "create_time");
    transport.sessionState.notifyInternalMetadataChanged({ declared_dialog_kinds: kinds });
  }
  if (request.perTaskStopAffordance === true) setPerTaskStopAffordance(true);
  if (request.appendSystemPrompt !== undefined) options.appendSystemPrompt = request.appendSystemPrompt;
  if (request.planModeInstructions !== undefined) options.planModeInstructions = request.planModeInstructions;
  if (request.appendSubagentSystemPrompt !== undefined) options.appendSubagentSystemPrompt = request.appendSubagentSystemPrompt;
  if (request.toolAliases !== undefined) {
    options.toolAliases = request.toolAliases;
    setAppState((state) => ({ ...state, toolPermissionContext: { ...state.toolPermissionContext, toolAliases: request.toolAliases } }));
  }
  if (request.excludeDynamicSections !== undefined) options.excludeDynamicSections = request.excludeDynamicSections;
  if (request.promptSuggestions !== undefined) options.promptSuggestions = request.promptSuggestions;
  if (request.forwardSubagentText !== undefined) options.forwardSubagentText = request.forwardSubagentText;
  if (request.skills !== undefined) applySkills(request.skills);
  let mergedStdinAgents;
  if (request.agents) mergedStdinAgents = parseAgentDefinitions(request.agents, "flagSettings");
  const agentList = () => activeAgents(mergedStdinAgents ? [...getAgents(), ...mergedStdinAgents] : getAgents());
  if (options.agent) {
    const alreadyActive = mainThreadAgentType() === options.agent;
    const definition = findAgentDefinition(agentList(), options.agent);
    if (definition && !alreadyActive) {
      setActiveAgentType(definition.agentType);
      applyAgentDefinition(definition);
      if (!options.systemPrompt && !isBuiltInAgent(definition)) {
        const prompt = definition.getSystemPrompt();
        if (prompt) options.systemPrompt = prompt;
      }
      if (!options.userSpecifiedModel && definition.model && definition.model !== "inherit") {
        const parsed = parseModel(definition.model);
        if (isExemptModelPick(parsed) || isModelAllowed(parsed)) applyModelOverride(parsed);
        else restrictedAgentModel = definition.model;
      }
      if (definition.initialPrompt) transport.prependUserMessage(definition.initialPrompt);
    } else if (definition?.initialPrompt) {
      transport.prependUserMessage(definition.initialPrompt);
    }
  }
  if (request.hooks) registerHookCallbacks(request.hooks, (event, id) => transport.createHookCallback(event, id));
  if (request.jsonSchema) applyJsonSchema(request.jsonSchema);
  outbound.enqueue({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: await buildPayload(
        commandSource,
        agentList(),
        models,
        unavailableModels,
        getAppState,
        getFastMode(),
        () => transport.sessionState.getState(),
        request.hooks ? true : undefined,
        options.storageV5,
      ),
    },
  });
  const mcp = getAppState().mcp;
  logEvent("tengu_sdk_init_handshake", {
    uptime_ms: Math.round(process.uptime() * 1000),
    mcp_client_count: mcp.clients.length,
    mcp_pending_count: countBy(mcp.clients, (client) => client.type === "pending"),
    mcpNonBlocking: mcpNonBlocking(),
    session_mirror: !!options.sessionMirror,
  });
  if (enableAuthStatus) {
    const status = authStatusService.getInstance().getStatus();
    if (status) {
      outbound.enqueue({
        type: "auth_status",
        isAuthenticating: status.isAuthenticating,
        output: status.output,
        error: status.error,
        uuid: newUuid(),
        session_id: currentSessionId(),
      });
    }
  }
  return { restrictedAgentModel, mergedStdinAgents };
}
