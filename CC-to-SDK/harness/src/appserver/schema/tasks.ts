// appserver/schema/tasks.ts — M2b Wave 3: the background-task trio's params. Verbatim from the task brief.
import { z } from "zod/v4";
export const taskListParams = z.object({ threadId: z.string().min(1) });
export const taskStopParams = z.object({ threadId: z.string().min(1), taskId: z.string().min(1) });
// `toolUseId` is genuinely OPTIONAL, not nullable (unlike schema/mcp.ts's `mode`): the engine's own
// `backgroundAll(toolUseId?)` reads absence as "background every in-flight foreground task", which is the
// Ctrl+B default — omitting it asserts the broad form rather than declining to say.
export const turnBackgroundParams = z.object({ threadId: z.string().min(1), toolUseId: z.string().optional() });
