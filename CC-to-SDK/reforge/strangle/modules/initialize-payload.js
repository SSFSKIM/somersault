// ADAPTER — the graph-facing seam for the initialize response payload.
//
// Delegation signature: the nine values upstream's own parameters carry, then
// twenty-two forwarded captures (§2.4). One is `primitive` — the default output
// style — and is equality-asserted on every delegation, which is the only cheap
// thing that would see upstream change that constant's VALUE without moving its
// name. The rest are `effectful-port`: settings, account, gates, remote-control
// preferences and the session-state snapshot are all state this wave does not
// own, so each is a typed argument and a ledger edge.
import { assertGraphValue } from "./shared/assert.js";
import { DEFAULT_OUTPUT_STYLE } from "./shared/output-style.js";
import { buildInitializeResponsePayload } from "./initialize-payload/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  buildInitializeResponsePayload(
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
    ...ports
  ) {
    assertGraphValue("initialize-payload", "defaultOutputStyle", defaultOutputStyle, DEFAULT_OUTPUT_STYLE);
    return buildInitializeResponsePayload(
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
      DEFAULT_OUTPUT_STYLE,
      ...ports,
    );
  },
});
