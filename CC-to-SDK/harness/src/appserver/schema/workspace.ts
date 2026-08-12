// appserver/schema/workspace.ts — the workspace pair's params (M3 §2). Both are SERVER-scoped: neither
// names a `threadId`, because neither addresses a conversation at all — they answer for the machine this
// server runs on. A client that wants a thread's tree reads `threadView.cwd` and passes it as a root.
import { z } from "zod/v4";
/** ABSOLUTE-only, enforced in the handler rather than here: a relative path is a well-typed string, and
 *  the refusal a client needs to read is "that path is not absolute", not "Invalid params". */
export const fsReadParams = z.object({ path: z.string().min(1) });
/** `query` is deliberately NOT `.min(1)`: an empty query is a legal request with an empty answer (§2 —
 *  Codex's own behavior), not a client bug. `limit` caps at Codex's MATCH_LIMIT of 50, which is also the
 *  default — a cap this small is what keeps a whole-tree re-walk answerable without a warm index. */
export const fsSearchParams = z.object({
  query: z.string(),
  roots: z.array(z.string().min(1)).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
