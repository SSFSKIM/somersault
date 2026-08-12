// appserver/schema/workspace.ts — the workspace cluster's params: the pair (M3 §2) and, since Task 13,
// `thread/shellCommand` (§3). The pair is SERVER-scoped — neither names a `threadId`, because neither
// addresses a conversation at all; they answer for the machine this server runs on, and a client that wants
// a thread's tree reads `threadView.cwd` and passes it as a root. `thread/shellCommand` is the same subject
// from the other end: still this machine, but rooted on a thread's own cwd, which is why it names one.
import { z } from "zod/v4";
/** ABSOLUTE-only, enforced in the handler rather than here: a relative path is a well-typed string, and
 *  the refusal a client needs to read is "that path is not absolute", not "Invalid params". */
export const fsReadParams = z.object({ path: z.string().min(1) });
/** The most roots one `fs/search` may drive. Each root is an INDEPENDENT recursive walk that runs BEFORE
 *  `limit` narrows anything, so an unbounded array is disproportionate fs work off a single frame (external
 *  review F4) — the same unbounded-client-driven-work class the fix-wave-1 queue cap bounds. 64 is generous
 *  for any real multi-root workspace and still bounds the walk fan-out; the handler additionally dedupes
 *  normalized roots so two spellings of one directory walk once. */
export const MAX_SEARCH_ROOTS = 64;
/** `query` is deliberately NOT `.min(1)`: an empty query is a legal request with an empty answer (§2 —
 *  Codex's own behavior), not a client bug. `limit` caps at Codex's MATCH_LIMIT of 50, which is also the
 *  default — a cap this small is what keeps a whole-tree re-walk answerable without a warm index. */
export const fsSearchParams = z.object({
  query: z.string(),
  roots: z.array(z.string().min(1)).max(MAX_SEARCH_ROOTS).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
/** M3 §3 — the one method in this module that DOES name a thread, because the thread is what says where the
 *  command runs. The description rides the generated artifact (schema/emit.ts) for the one thing the shape
 *  cannot carry: a client that knows Codex's `thread/shellCommand` expects the output to reach the model,
 *  and here it never does. `command` is a full shell string, so `.min(1)` is the only structural claim
 *  worth making about it. */
export const shellCommandParams = z.object({ threadId: z.string().min(1), command: z.string().min(1) })
  .describe("unsandboxed; output returns to the calling client only — the model never sees it (deviation from Codex's stream-into-turn)");
