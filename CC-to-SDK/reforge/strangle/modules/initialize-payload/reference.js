// PARITY LAYER (§2.5 `reference`) — the payload an `initialize` control request
// is answered with (upstream `_f`, re-exported as
// `_buildInitializeResponsePayloadForTesting`, 2.1.251, chunk-dvbbv89q).
//
// THE FIRST THING EVERY SDK SESSION LEARNS ABOUT THE ENGINE. It is the answer to
// the handshake: which slash commands exist, which agents, which models are
// available and which are not, which output styles, what account is
// authenticated, what permission mode the session is in, whether host hooks were
// applied, and the whole session-state snapshot.
//
// AND IT WAS INVISIBLE UNTIL THIS WAVE. `sdk.mjs` consumes the initialize
// response — no SDK-driven scenario has ever seen one field of it — so the only
// thing that can grade it is the raw driver, which now sends `initialize` and
// reads the answer straight off the wire. That is the whole argument for the
// driver's existence, made concrete: ~1 KB of behaviour with no observer.
//
// THE SHAPE IS AN OBJECT LITERAL FOLLOWED BY SEVEN ASSIGNMENTS, and the split is
// upstream's, not a transcription artifact. The literal's spread arms are
// conditional; the assignments are unconditional and are what a host reads to
// decide whether to offer remote control at all. The order is preserved because
// the parity oracle compares the two objects key by key.
//
// TWO CONDITIONAL ARMS, both keyed off the same VS-Code-entrypoint predicate:
// `unavailable_models` appears only when some model is unavailable, and the two
// auto-mode fields appear only on that entrypoint. Under the harness neither
// fires, so both are graded by the oracle rather than by the driver.
//
// `pid` IS IN THE PAYLOAD AND IS SCRUBBED BY THE DIFFER. Two engines are two
// processes; it is the one field that can never agree and says nothing. The
// scrub carries its own negative controls (src/differ.test.ts) proving the rest
// of the payload still diffs.

/**
 * @param commandSource        the source the slash-command list is rendered from
 * @param agents               the active agent definitions
 * @param models               the models this session may use
 * @param unavailableModels    models it may not, when any
 * @param getAppState          port — the live app state
 * @param fastModeInput        the fast-mode input, or undefined
 * @param getSessionState      port — the session-state snapshot the host receives
 * @param hooksApplied         whether the host's hooks were applied (tri-state; undefined means "not asked")
 * @param storageV5            port — the storage handle the output-style listing needs
 * @param settings             port — the settings record carrying the chosen output style
 * @param defaultOutputStyle   primitive — the style used when none is chosen
 * @param listOutputStyles     port — every available output style, keyed by name
 * @param cwd                  port — the session's working directory
 * @param accountInformation   port — the authenticated account, when first-party
 * @param isVsCodeEntrypoint   port — gates the two auto-mode fields
 * @param autoDefaultNudgeEligible  port — is the auto-mode nudge eligible at all?
 * @param autoDefaultNudge     port — the nudge's own mode, when there is one
 * @param toSlashCommands      port — render the command list
 * @param apiProvider          port — which API provider is authenticated
 * @param renderPermissionMode port — a mode's external (host-facing) name
 * @param modeIsDefaultFallback port — did the mode come from the default fallback?
 * @param feedbackSurveyConfig port — the feedback survey configuration
 * @param analyticsDisabled    port — is analytics reporting off?
 * @param footerIndicator      port — the footer indicator the host should show
 * @param proactivity          port — the proactivity settings for this state
 * @param remoteControlPreference port — the operator's stored preference, or undefined
 * @param remoteControlSuppressed port — is remote control suppressed outright?
 * @param remoteControlDefault port — the default when no preference is stored
 * @param remoteControlAvailable port — can this session do remote control?
 * @param featureGate          port — a feature gate, with its compiled-in default
 * @param fastModeState        port — the fast-mode state to report
 * @param fastModeDisabledReason port — why fast mode is off, when it is
 */
export async function buildInitializeResponsePayload(
  commandSource,
  agents,
  models,
  unavailableModels,
  getAppState,
  fastModeInput,
  getSessionState,
  hooksApplied,
  storageV5,
  settings,
  defaultOutputStyle,
  listOutputStyles,
  cwd,
  accountInformation,
  isVsCodeEntrypoint,
  autoDefaultNudgeEligible,
  autoDefaultNudge,
  toSlashCommands,
  apiProvider,
  renderPermissionMode,
  modeIsDefaultFallback,
  feedbackSurveyConfig,
  analyticsDisabled,
  footerIndicator,
  proactivity,
  remoteControlPreference,
  remoteControlSuppressed,
  remoteControlDefault,
  remoteControlAvailable,
  featureGate,
  fastModeState,
  fastModeDisabledReason,
) {
  const outputStyle = settings()?.outputStyle || defaultOutputStyle;
  const styles = await listOutputStyles(cwd(), storageV5);
  const account = accountInformation();
  const mode = getAppState().toolPermissionContext.mode;
  const nudge = isVsCodeEntrypoint() && autoDefaultNudgeEligible() ? autoDefaultNudge(getAppState().toolPermissionContext, { requireOnboarding: false }) : null;
  const payload = {
    commands: toSlashCommands(commandSource),
    agents: agents.map((a) => ({ name: a.agentType, description: a.whenToUse, model: a.model })),
    output_style: outputStyle,
    available_output_styles: Object.keys(styles),
    models,
    ...(unavailableModels.length > 0 && { unavailable_models: unavailableModels }),
    account: {
      email: account?.email,
      organization: account?.organization,
      subscriptionType: account?.subscription,
      tokenSource: account?.tokenSource,
      apiKeySource: account?.apiKeySource,
      apiProvider: apiProvider(),
    },
    pid: process.pid,
    current_permission_mode: renderPermissionMode(mode),
    hooks_applied: hooksApplied,
    ...(isVsCodeEntrypoint() && {
      permission_mode_from_default_fallback: modeIsDefaultFallback() && mode === "auto",
      ...(nudge && { auto_default_nudge: renderPermissionMode(nudge) }),
    }),
    feedback_survey_config: feedbackSurveyConfig(),
    analytics_disabled: analyticsDisabled(),
    proactivity: proactivity(getAppState()),
    footer_indicator: footerIndicator(),
  };
  const preference = remoteControlPreference();
  const autoEnable = !remoteControlSuppressed() && (preference ?? remoteControlDefault());
  payload.remote_control_auto_enable = autoEnable;
  payload.remote_control_available = remoteControlAvailable();
  payload.remote_control_auto_on_by_default = autoEnable && preference === undefined;
  payload.ide_rc_auto_enable_gate = featureGate("tengu_ide_rc_auto_enable", false);
  const state = getAppState();
  payload.fast_mode_state = fastModeState(fastModeInput ?? null, state.fastMode);
  payload.fast_mode_disabled_reason = fastModeDisabledReason(fastModeInput ?? null) ?? undefined;
  payload.session_state = getSessionState();
  return payload;
}
