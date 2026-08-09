// cli/resolveResume.ts — what `--resume <arg>` accepts.
//
// DELIBERATE EXTENSION, not parity (W-S6). Upstream accepts a FULL 36-char UUID or a filesystem path and
// nothing else: `xN` (L1459) tests /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i and
// the session-file lookup `e2_` (L369966) is an exact filename join, never a prefix scan. An 8-char id
// resumes nothing upstream. But ccx PRINTS two different 8-char ids — `/status`'s UUID prefix
// (commands.ts:237) and the detachable banner's fleet roster short id — so refusing them would make the
// product's own output unusable against its own flag. Both resolve here; anything else fails loudly.
import { listSessions } from "../sessions/reader.js";
import { resolveTarget } from "./lifecycle.js";

export type ResumeResolution =
  | { kind: "session"; id: string }
  | { kind: "pending"; short: string }      // a roster row exists but has minted no session id yet
  | { kind: "unknown"; arg: string };

export interface ResolveResumeDeps { listSessions: typeof listSessions; resolveTarget: typeof resolveTarget }
const realDeps: ResolveResumeDeps = { listSessions, resolveTarget };

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Full UUID → exact transcript id → unique UUID prefix → fleet roster short id → unknown. A full UUID is
 *  taken AS TYPED, exactly as upstream does: a session persisted under another directory is not in this
 *  directory's listing, and rejecting it here would refuse an id that resumes perfectly well. */
export async function resolveResumeArg(arg: string, deps: ResolveResumeDeps = realDeps): Promise<ResumeResolution> {
  if (FULL_UUID.test(arg)) return { kind: "session", id: arg };
  const sessions = await deps.listSessions();
  if (sessions.some((s) => s.sessionId === arg)) return { kind: "session", id: arg };
  // Ambiguity THROWS rather than picking the newest: resuming a conversation the user did not name is
  // worse than making them type four more characters (same rule as lifecycle.ts's findTarget).
  const prefixed = sessions.filter((s) => s.sessionId.startsWith(arg));
  if (prefixed.length > 1) throw new Error(`ambiguous session id ${JSON.stringify(arg)} — matches: ${prefixed.map((s) => s.sessionId).join(", ")}`);
  if (prefixed.length === 1) return { kind: "session", id: prefixed[0].sessionId };
  // A throw here is the ordinary "not a roster short id" answer (resolveTarget is sync and throws on a
  // miss AND on an ambiguous one) — both fall through to `unknown`, which the caller reports by name.
  try {
    const row = deps.resolveTarget(arg);
    return row.sessionId ? { kind: "session", id: row.sessionId } : { kind: "pending", short: row.short };
  } catch { return { kind: "unknown", arg }; }
}
