// PARITY LAYER (§2.5 `reference`) — apply a host's `set_model` control request
// (upstream `km`, 2.1.251, chunk-dvbbv89q).
//
// THE ONE CONTROL SUBTYPE THAT CHANGES THE MODEL REQUEST BODY, which is why it
// is the wave's single required live recording: everything else W7 owns is
// gradeable off the wire against a cassette that was already there.
//
// SIX REFUSALS AND THREE ACCEPTANCES, in upstream's order. The refusals are the
// substance — each carries its own sentence and its own telemetry, and three of
// them ALSO have to reject a system_prompt that rode along with the model:
//
//   model is present but not a string  -> refuse; if a system_prompt came with
//                                         it, mark that rejected too.
//   system_prompt present but not a
//   non-empty string                   -> refuse, distinguishing "wrong type"
//                                         from "empty" in the telemetry only.
//   the model is UNRECOGNISED          -> refuse with a suggestion when the
//                                         normaliser found a near match.
//   the model is BLOCKED               -> refuse, and notice the restriction
//                                         against the currently active model.
//   a hook refuses the switch          -> refuse with the hook's own reason.
//
// …and the acceptances differ in what they leave behind:
//
//   "default"      resolve to the default model, and pass NULL to the hook and
//                  to the recorder — "no explicit model" is not the same claim
//                  as "this model".
//   "allowed"      the model as asked.
//   "steppedDown"  the model as resolved, PLUS a restriction notice, because the
//                  session got a family alias rather than what it asked for.
//                  This is the only acceptance that ends in `logFeatureSad`.
//
// THE BREADCRUMB CONDITION IS A CONJUNCTION AND IT SHORT-CIRCUITS. Breadcrumbs
// are injected only when the effective model actually moved OR its parsed
// identity did, AND the breadcrumb builder agrees; upstream calls the builder
// for its side effect and reads its answer, so a reimplementation that reordered
// those two would still "work" and would stop injecting.
//
// SYSTEM_PROMPT IS APPLIED LAST, after the model is in force, and only on the
// success path — every refusal above leaves it untouched.

/**
 * @param request                  the control request: `model`, `system_prompt`
 * @param surface                  the caller's surface object (session, model accessors, appliers)
 * @param logFeatureBad            port — telemetry for a rejected feature use
 * @param normalizeModel           port — classify the requested model
 * @param logEvent                 port — the unrecognised-model telemetry event
 * @param enumShape                port — render the shape of an unrecognised model for telemetry
 * @param unrecognizedModelError   port — the sentence an unrecognised model gets
 * @param describeModel            port — render the requested model for that sentence
 * @param authTokenSource          port — the token source a blocked model is reported against
 * @param restrictedModelError     port — the sentence a blocked model gets
 * @param activeMainLoopModel      port — the model in force right now
 * @param defaultMainLoopModel     port — the model `"default"` resolves to
 * @param consultModelSwitchHooks  port — the hook consult that can refuse the switch
 * @param logFeatureSad            port — telemetry for a degraded feature use
 * @param hookRefusalError         port — the sentence a hook refusal gets
 * @param recordModelChange        port — persist the change against the session
 * @param parseModel               port — parse a model string to its identity
 * @param shouldInjectBreadcrumbs  port — decide (and record) whether to inject breadcrumbs
 * @param logFeatureOk             port — telemetry for a successful feature use
 * @param toNotice                 port — render a hook message as a host notice
 */
export async function applyModelSwitchRequest(
  request,
  surface,
  logFeatureBad,
  normalizeModel,
  logEvent,
  enumShape,
  unrecognizedModelError,
  describeModel,
  authTokenSource,
  restrictedModelError,
  activeMainLoopModel,
  defaultMainLoopModel,
  consultModelSwitchHooks,
  logFeatureSad,
  hookRefusalError,
  recordModelChange,
  parseModel,
  shouldInjectBreadcrumbs,
  logFeatureOk,
  toNotice,
) {
  const requested = request.model;
  if (requested != null && typeof requested !== "string") {
    logFeatureBad("model_switch", "invalid_model_type");
    if (request.system_prompt !== undefined) logFeatureBad("system_prompt_switch", "model_switch_rejected");
    return { ok: false, error: "set_model: model must be a string" };
  }
  const systemPrompt = request.system_prompt;
  if (systemPrompt !== undefined && (typeof systemPrompt !== "string" || systemPrompt === "")) {
    logFeatureBad("system_prompt_switch", typeof systemPrompt !== "string" ? "invalid_type" : "empty");
    return { ok: false, error: "set_model: system_prompt must be a non-empty string when present" };
  }
  const asked = requested ?? "default";
  const classified = normalizeModel(asked);
  let applied;
  let steppedDown;
  switch (classified.kind) {
    case "unrecognized":
      logEvent("tengu_set_model_unrecognized", {
        shape: enumShape(classified.shape),
        had_suggestion: classified.suggestion !== undefined,
        surface: surface.surface,
      });
      logFeatureBad("model_switch", "unrecognized_model");
      if (typeof systemPrompt === "string") logFeatureBad("system_prompt_switch", "model_switch_rejected");
      return { ok: false, error: unrecognizedModelError(describeModel(asked), classified.suggestion) };
    case "blocked": {
      const source = authTokenSource(surface.getActiveModel());
      surface.noticeRestrictedModel(asked, source);
      logFeatureBad("model_switch", "not_allowed");
      if (typeof systemPrompt === "string") logFeatureBad("system_prompt_switch", "model_switch_rejected");
      return { ok: false, error: restrictedModelError(asked, source ?? activeMainLoopModel()) };
    }
    case "default":
      applied = defaultMainLoopModel();
      steppedDown = null;
      break;
    case "allowed":
      applied = classified.model;
      steppedDown = null;
      break;
    case "steppedDown":
      applied = classified.model;
      steppedDown = classified.model;
      break;
    // Upstream's switch has NO default clause, and the arm it does not have is
    // behaviour: a kind outside the normaliser's five-way union falls through
    // with the applied model left undefined and the switch proceeds. `break` is
    // exactly that, written down so the branch inventory can mark it (§3.1
    // refuses an unmarkable construct rather than skipping it). The oracle runs
    // a sixth kind through both sides to prove the two agree.
    default:
      break;
  }
  const readState = () => {
    const state = surface.readAppState();
    return {
      mainLoopModel: state.mainLoopModel ?? surface.getActiveModel() ?? activeMainLoopModel(),
      mainLoopModelForSession: state.mainLoopModelForSession,
      toolPermissionContext: state.toolPermissionContext,
    };
  };
  const explicit = classified.kind === "default" ? null : applied;
  const consult = await consultModelSwitchHooks(surface.session, readState, explicit, "sdk");
  if (consult.decision !== "proceed") {
    logFeatureSad("model_switch", "blocked_by_hook");
    if (typeof systemPrompt === "string") logFeatureBad("system_prompt_switch", "model_switch_rejected");
    return { ok: false, error: hookRefusalError(consult) };
  }
  const before = activeMainLoopModel();
  const previous = surface.getActiveModel();
  const conversationModel = surface.getConversationModel();
  recordModelChange(surface.session, readState(), explicit, "sdk");
  surface.applyModel(applied);
  if (
    (activeMainLoopModel() !== before || parseModel(applied) !== parseModel(previous ?? before)) &&
    shouldInjectBreadcrumbs({ appliedModel: applied, previousModel: previous ?? before, conversationModel })
  ) {
    surface.injectModelSwitchBreadcrumbs(asked, applied);
  }
  surface.recordAllowedModelApplied();
  if (steppedDown !== null) {
    surface.noticeRestrictedModel(asked, steppedDown);
    logFeatureSad("model_switch", "family_alias_stepped_down");
  } else {
    logFeatureOk("model_switch");
  }
  if (typeof systemPrompt === "string") {
    surface.setSystemPrompt(systemPrompt);
    logFeatureOk("system_prompt_switch");
  }
  return consult.messages.length > 0 ? { ok: true, notices: consult.messages.map(toNotice) } : { ok: true };
}
