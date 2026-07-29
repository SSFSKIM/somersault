// appserver/schema/settings.ts — Task 9's four settings-setter params (spec Wave 1). Verbatim from the
// task brief.
import { z } from "zod/v4";
export const modelSetParams = z.object({ threadId: z.string().min(1), model: z.string().min(1).nullable() });
export const permissionModeSetParams = z.object({ threadId: z.string().min(1), mode: z.string().min(1) });
export const thinkingSetParams = z.object({ threadId: z.string().min(1) })
  .and(z.union([z.object({ level: z.string().min(1) }), z.object({ maxTokens: z.number().int().nonnegative().nullable() })]));
export const settingsApplyParams = z.object({ threadId: z.string().min(1), settings: z.record(z.string(), z.unknown()) });
