// cli/resolveResume.ts — what `--resume <arg>` accepts, and what it refuses.
//
// DELIBERATE EXTENSION, not parity (W-S6). Upstream accepts a FULL 36-char UUID or a filesystem path and
// nothing else: `xN` (L1459) tests /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i and
// the session-file lookup `e2_` (L369966) is an exact filename join, never a prefix scan. An 8-char id
// resumes nothing upstream. But ccx PRINTS two different 8-char ids — `/status`'s UUID prefix
// (commands.ts:237) and the detachable banner's fleet roster short id — so refusing them would make the
// product's own output unusable against its own flag. Both resolve here; anything else fails loudly.
//
// EVERY id is validated against THIS DIRECTORY's listing, a full UUID included — it is not waved through
// on shape (review, t9). The REPL's own reader is cwd-scoped, so an id this directory does not hold
// resumes NOTHING: the user gets a dim `⚠ couldn't resume … no history found` over a fresh session at
// exit 0, which is the quiet failure W-S6 exists to remove. Unlisted here means `unknown` means exit 1.
// The listing is cwd-scoped for cost as well as truth (measured: global 4405 rows / 2.2s vs ~343ms here)
// and takes NO limit — a prefix of a session older than the picker's window must still resolve.
import { listSessions } from "../sessions/reader.js";
import { resolveTarget } from "./lifecycle.js";
import { TERMINAL } from "../fleet/roster.js";

export type ResumeResolution =
  | { kind: "session"; id: string }
  | { kind: "pending"; short: string }      // a roster row exists but has minted no session id yet
  | { kind: "live"; short: string }         // a roster row whose session is still running — attach, don't resume
  | { kind: "unknown"; arg: string };

export interface ResolveResumeDeps { listSessions: typeof listSessions; resolveTarget: typeof resolveTarget }
const realDeps: ResolveResumeDeps = { listSessions, resolveTarget };

/** Exact transcript id → unique UUID prefix → fleet roster short id → unknown. `cwd` is the directory the
 *  ids were printed in, and scopes the transcript listing to it. */
export async function resolveResumeArg(arg: string, cwd: string, deps: ResolveResumeDeps = realDeps): Promise<ResumeResolution> {
  const sessions = await deps.listSessions({ cwd });
  if (sessions.some((s) => s.sessionId === arg)) return { kind: "session", id: arg };
  // Ambiguity THROWS rather than picking the newest: resuming a conversation the user did not name is
  // worse than making them type four more characters (same rule as lifecycle.ts's findTarget).
  const prefixed = sessions.filter((s) => s.sessionId.startsWith(arg));
  if (prefixed.length > 1) throw new Error(`ambiguous session id ${JSON.stringify(arg)} — matches: ${prefixed.map((s) => s.sessionId).join(", ")}`);
  if (prefixed.length === 1) return { kind: "session", id: prefixed[0].sessionId };
  let row;
  try { row = deps.resolveTarget(arg); }
  catch (e) {
    // resolveTarget throws for TWO different things. "No such target" is the ordinary answer here and
    // falls through to `unknown`; an AMBIGUOUS one is a true statement the caller must print instead of
    // the false "no conversation found" — so it is rethrown rather than flattened.
    if (/ambiguous/i.test((e as Error).message)) throw e;
    return { kind: "unknown", arg };
  }
  // The exact mirror of prepareAttach's own guard (attach.ts:20), which refuses a TERMINAL row and points
  // at `--resume`: a still-running session must be ATTACHED to, because resuming it would start a second
  // engine over the one transcript. Between them the two surfaces cover every row with no overlap.
  if (!TERMINAL.has(row.state)) return { kind: "live", short: row.short };
  return row.sessionId ? { kind: "session", id: row.sessionId } : { kind: "pending", short: row.short };
}
