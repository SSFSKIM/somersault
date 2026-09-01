// The permission subsystem's prose constants, owned outright in ONE place
// (§2.4 `primitive`).
//
// Same argument as `shared/tool-names.js`: upstream declares each of these as a
// single-token `var` in one chunk and reads it from several, so its VALUE can
// change while its minified name stays put — which moves no anchor, no target
// hash and no capture hash. The adapters that receive the graph's copy assert it
// against the owned one on every delegation, and that assertion is the only
// cheap thing in the campaign that can see an upstream rewording.
//
// Three of the five are user-facing sentences, and one is a telemetry token that
// is ALSO user-facing: `PERMISSION_CHECK_CRASHED_REASON` is stamped into a
// decision's `reason` and rendered by the message builder, so it reaches a
// permission prompt as prose despite reading like an event name.

/**
 * Upstream `Hye` / `PERMISSION_CHECK_CRASHED_REASON`, chunk-fy12d89p.
 *
 * The reason a decision carries when a tool's own permission check threw an
 * error the classifier did not recognise AND the caller opted into treating a
 * crash as an objection. Reaching it means the engine could not evaluate the
 * call, so the safe answer is to ask.
 */
export const PERMISSION_CHECK_CRASHED_REASON = "permission_check_crashed";

/**
 * Upstream `d7e`, chunk-fy12d89p.
 *
 * The reason an MCP server's own `effectiveMaxPermission: "ask"` ceiling
 * produces. It is a POLICY ceiling rather than a decision: it applies after the
 * tool has answered and regardless of what the tool said.
 */
export const ORGANIZATION_ASK_REASON = "Your organization requires approval for this tool";

/**
 * Upstream `uoe` / `UNRECOGNIZED_PERMISSION_MODE_ERROR`, chunk-af80z9sa.
 *
 * The mode-change guard's refusal for a mode it cannot parse. Upstream builds it
 * by joining its own mode enumeration in SORTED order, so this string is a
 * second, independent statement of the mode axis — and
 * `research/fixtures/permission-surface-<pin>.json` records that enumeration
 * from four other places. A mode added upstream changes this sentence, and the
 * adapter's assertion is what notices.
 */
export const UNRECOGNIZED_PERMISSION_MODE_ERROR =
  "Cannot set permission mode: must be one of acceptEdits, auto, bypassPermissions, default, dontAsk, plan";

/**
 * Upstream `Vve`, chunk-fy12d89p.
 *
 * The first of the three bypass refusals, and the only one held in a constant —
 * the other two are written inline at their return sites, which is why they live
 * in the owned module rather than here.
 */
export const RESTRICTED_BYPASS_ERROR = "bypassPermissions not supported in restricted mode";
