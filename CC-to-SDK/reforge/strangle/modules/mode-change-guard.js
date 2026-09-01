// ADAPTER — the graph-facing seam for the mode-change guard.
//
// Delegation signature:
//   guardPermissionModeChange(requested, context, parsePermissionMode,
//                             unrecognizedModeError, restrictedBypassError,
//                             bypassDisabled, autoModeGateEnabled,
//                             autoModeUnavailableReason,
//                             autoModeUnavailableNotification)
//
// Two `primitive` captures (§2.4), owned outright and asserted on every
// delegation. The unrecognised-mode message is the interesting one: upstream
// builds it by joining its own mode enumeration in sorted order, so this
// assertion fires the moment a permission mode is added, renamed or dropped —
// a change that moves no anchor, no target hash and no capture hash, and that
// `research/fixtures/permission-surface-<pin>.json` sees from four other places.
import { assertGraphValue } from "./shared/assert.js";
import { RESTRICTED_BYPASS_ERROR, UNRECOGNIZED_PERMISSION_MODE_ERROR } from "./shared/permission-constants.js";
import { guardPermissionModeChange } from "./mode-change-guard/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  guardPermissionModeChange(
    requested,
    context,
    parsePermissionMode,
    unrecognizedModeError,
    restrictedBypassError,
    bypassDisabled,
    autoModeGateEnabled,
    autoModeUnavailableReason,
    autoModeUnavailableNotification,
  ) {
    assertGraphValue("mode-change-guard", "unrecognizedModeError", unrecognizedModeError, UNRECOGNIZED_PERMISSION_MODE_ERROR);
    assertGraphValue("mode-change-guard", "restrictedBypassError", restrictedBypassError, RESTRICTED_BYPASS_ERROR);
    return guardPermissionModeChange(
      requested,
      context,
      parsePermissionMode,
      UNRECOGNIZED_PERMISSION_MODE_ERROR,
      RESTRICTED_BYPASS_ERROR,
      bypassDisabled,
      autoModeGateEnabled,
      autoModeUnavailableReason,
      autoModeUnavailableNotification,
    );
  },
});
