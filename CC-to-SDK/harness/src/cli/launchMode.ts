import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULTS } from "../config/types.js";
import { resolveModelAlias } from "../config/models.js";
import { isAutoSupportedModel } from "../config/autoModel.js";

/** F9 T-AUTO A1 (spec 2026-08-22-f9-wave-design.md "Track T-AUTO"): the interactive launch-mode gate,
 *  shared by main.ts's foreground constructor and hostMain.ts's --detachable child so the two can never
 *  split (EP-T1's original defect, now on the model axis too — see the call sites). An EXPLICIT
 *  --permission-mode always wins outright, even `auto` on a model that cannot run it — resolveOptions.ts's
 *  own explicit-auto gate then forces an auto-capable model, unchanged, because the user asked for auto
 *  by name. When the mode is unset, the gate is the PREDICATE `isAutoSupportedModel`, never the
 *  transformer `resolveAutoModel`: the transformer silently converts an unsupported model to Sonnet, and
 *  using it as a gate here would swap the model out from under a launch that never asked for auto at all —
 *  exactly the silent downgrade resolveOptions.ts's own comment says it avoids for the explicit case.
 *  Alias-resolve FIRST (a tier name like "opus" is not an id `isAutoSupportedModel` recognizes; autoModel
 *  .ts's own doc demands this ordering). */
export function resolveLaunchPermissionMode(args: { explicitMode?: PermissionMode; effectiveModel: string | undefined }): { mode: PermissionMode; explicit: boolean } {
  if (args.explicitMode) return { mode: args.explicitMode, explicit: true };
  const model = resolveModelAlias(args.effectiveModel ?? DEFAULTS.model);
  return { mode: isAutoSupportedModel(model) ? "auto" : "default", explicit: false };
}
