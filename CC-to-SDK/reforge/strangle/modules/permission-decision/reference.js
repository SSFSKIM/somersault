// PARITY LAYER (§2.5 `reference`) — the permission chain's deny-stamping link
// (upstream `kye` / `hasPermissionsToUseToolWithSink`, 2.1.251, chunk-fy12d89p).
//
// C5x's mechanism spike for the ARROW-INITIALIZER target shape. The chain's
// three entry points are one `var` statement with three declarators
// (`Dd=async(…)=>{…},kye=async(…)=>{…},von=async(…)=>{…}`), so W6 has no target
// until the transform can excise a single declarator's initializer and leave its
// neighbours untouched.
//
// WHAT IT OWNS. One decision: a `deny` from the mode-aware decision body is
// stamped with where it was decided, and every other behaviour passes through
// unchanged. `decideLocation` travels with the decision into telemetry and into
// the ask-path's own bookkeeping, so "which link denied this" is a real
// behavioural claim and not an annotation.
//
// The decision body itself (`von`, 11.6 KB, mode handling, rule application, the
// ask path, the classifier) stays a port — the W5–W7 scout measured it
// S-module-shaped, and it is W6's to design rather than this spike's to smuggle.
//
// PARAMETERS. The first five are named from measured call sites
// (`Dd(tool, input, context, assistantMessage, toolUseId, …)`); the last two are
// pass-through. Upstream's own name for the seventh is the "sink" of
// `hasPermissionsToUseToolWithSink`, and the sixth reaches the pre-check's
// fourth parameter. The headless call site — `Dd`, which the SDK's
// `createCanUseTool` seam calls — passes both as `undefined`; two other call
// sites in the graph do not, and neither is on the headless path.
//
// The upstream body ends `{...decision, decideLocation:"pre-ask", ...!1}`. The
// trailing `...!1` is a minifier artifact: spreading a boolean contributes no
// properties, so it is a no-op in both key set and key ORDER. Reproducing it
// would be transcribing the minifier, not the behaviour.

export async function permissionDecisionWithSink(
  tool,
  input,
  context,
  assistantMessage,
  toolUseId,
  precheckArg,
  sink,
  decide,
) {
  const decision = await decide(tool, input, context, assistantMessage, toolUseId, precheckArg, sink);
  return decision.behavior === "deny" ? { ...decision, decideLocation: "pre-ask" } : decision;
}
