// appserver/schema/settingsOps.ts — M2b Task 3b: the settings-ops nonet's params (the nine host-wire ops
// gap 6 named). Built on `threadIdParams.extend(...)` like schema/rewind.ts, so the shared `threadId` rule
// lives in exactly one place. `add`/`remove` share one schema per pair: the two methods differ in what
// they do with the value, not in what a caller may say.
import { z } from "zod/v4";
import { threadIdParams } from "./core.js";

export const settingsReadParams = threadIdParams;
export const directoryListParams = threadIdParams;
export const directoryPathParams = threadIdParams.extend({ path: z.string().min(1) });
// `behavior` is the SDK's three-bucket permission vocabulary, mirrored from host/ops.ts's add_rule/
// remove_rule — a fourth bucket would land in `flagPerms` as a key `applyFlagSettings` silently ignores.
export const permissionRuleParams = threadIdParams.extend({
  behavior: z.enum(["allow", "ask", "deny"]),
  rule: z.string().min(1),
});
export const outputStyleSetParams = threadIdParams.extend({ style: z.string().min(1) });
// The one CLOSED value domain in this file, and not for symmetry: probe 102 found
// `applyFlagSettings({effortLevel})` accepts a bogus level SILENTLY, so the wire is the only thing
// standing between a client's typo and an effort setting that reads as applied and is not. The enum is
// host/ops.ts's `set_effort` list verbatim — two wires, one vocabulary.
export const effortSetParams = threadIdParams.extend({ level: z.enum(["low", "medium", "high", "xhigh", "max"]) });
export const threadClearParams = threadIdParams;
