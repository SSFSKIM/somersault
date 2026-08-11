// appserver/schema/settings.ts — Task 9's four settings-setter params (spec Wave 1). Verbatim from the
// task brief.
import { z } from "zod/v4";
import { THINK_LEVELS } from "../../tui/thinkLevels.js";
export const modelSetParams = z.object({ threadId: z.string().min(1), model: z.string().min(1).nullable() });
export const permissionModeSetParams = z.object({ threadId: z.string().min(1), mode: z.string().min(1) });
// `level` is the shared vocabulary, not any string: the downstream `thinkBudget` maps an unknown name to
// budget 0, so a typo used to disable thinking outright and still reply {ok:true}. Validating against
// THINK_LEVELS (imported, never re-listed — a second copy would drift the moment a rung is added) turns
// that into INVALID_PARAMS. A caller who wants an off-vocabulary budget has the `maxTokens` arm.
export const thinkingSetParams = z.object({ threadId: z.string().min(1) })
  .and(z.union([z.object({ level: z.enum(THINK_LEVELS) }), z.object({ maxTokens: z.number().int().nonnegative().nullable() })]));
export const settingsApplyParams = z.object({ threadId: z.string().min(1), settings: z.record(z.string(), z.unknown()) });
