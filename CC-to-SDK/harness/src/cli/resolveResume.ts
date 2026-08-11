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
// exit 0, which is the quiet failure W-S6 exists to remove. Unlisted here means exit 1 — `unknown` for an id
// nothing knows about, `foreign` for a fleet row whose transcript lives under another project (see below).
// The listing is cwd-scoped for cost as well as truth (measured: global 4405 rows / 2.2s vs ~343ms here)
// and takes NO limit — a prefix of a session older than the picker's window must still resolve.
import { listSessions } from "../sessions/reader.js";
import { resolveTarget } from "./lifecycle.js";
import { listRoster, TERMINAL } from "../fleet/roster.js";

export type ResumeResolution =
  | { kind: "session"; id: string }
  | { kind: "pending"; short: string }      // a roster row exists but has minted no session id yet
  | { kind: "live"; short: string }         // a roster row whose session is still running — attach, don't resume
  | { kind: "foreign"; short: string; path: string }   // a roster row whose transcript lives under another project
  | { kind: "unknown"; arg: string };

export interface ResolveResumeDeps { listSessions: typeof listSessions; resolveTarget: typeof resolveTarget; listRoster: typeof listRoster }
const realDeps: ResolveResumeDeps = { listSessions, resolveTarget, listRoster };

/** The fleet row that is STILL RUNNING this session id, if any (external review, finding 1). Liveness used
 *  to be tested in the roster branch alone, so the same running session was refused when named by its
 *  4-char fleet short and waved through when named by the 8-char UUID prefix `/status` prints or by the
 *  full uuid — the transcript listing matched first, and main booted a second engine over a live
 *  transcript. Every id resolution now passes through here, so the two spellings answer alike.
 *
 *  KNOWN CAVEAT, accepted (recorded at Task 9): a host that CRASHED still reads `working` until fleet gc
 *  finalizes it, so its id resolves `live` and the user is sent to an attach that will fail. That costs one
 *  failed attach naming the short id; the alternative — waving it through — costs a second engine writing
 *  the same transcript as a live one. The cheap wrong answer is the right default. */
function liveRowFor(id: string, deps: ResolveResumeDeps): { short: string } | undefined {
  return deps.listRoster().find((r) => r.sessionId === id && !TERMINAL.has(r.state));
}

/** Exact transcript id → unique UUID prefix → fleet roster short id → unknown. `cwd` is the directory the
 *  ids were printed in, and scopes the transcript listing to it. Every arm that would hand back an id runs
 *  the two cross-checks the fleet roster makes possible: is that session still RUNNING (attach instead), and
 *  does this directory actually hold its transcript (say which one does). */
export async function resolveResumeArg(arg: string, cwd: string, deps: ResolveResumeDeps = realDeps): Promise<ResumeResolution> {
  const sessions = await deps.listSessions({ cwd });
  const resumable = (id: string): ResumeResolution => {
    const live = liveRowFor(id, deps);
    return live ? { kind: "live", short: live.short } : { kind: "session", id };
  };
  if (sessions.some((s) => s.sessionId === arg)) return resumable(arg);
  // Ambiguity THROWS rather than picking the newest: resuming a conversation the user did not name is
  // worse than making them type four more characters (same rule as lifecycle.ts's findTarget).
  const prefixed = sessions.filter((s) => s.sessionId.startsWith(arg));
  if (prefixed.length > 1) throw new Error(`ambiguous session id ${JSON.stringify(arg)} — matches: ${prefixed.map((s) => s.sessionId).join(", ")}`);
  if (prefixed.length === 1) return resumable(prefixed[0].sessionId);
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
  if (!row.sessionId) return { kind: "pending", short: row.short };
  // The roster is FLEET-WIDE; the reader the resumed REPL replays through is cwd-scoped (its `dir` covers
  // this project AND its worktrees, which is why a worktree row still passes here). A terminal row from
  // ANOTHER project therefore handed back an id this directory cannot read, and the launch ended in a
  // fresh REPL under one dim `no history found` — the quiet failure this resolver exists to remove
  // (external review, finding 3). A FOURTH outcome rather than `unknown`: the row demonstrably exists and
  // `ccx agents` lists it, so "No conversation found" would send the user hunting a typo that is not
  // there, while the row names the directory the id IS resumable from.
  if (!sessions.some((s) => s.sessionId === row.sessionId)) return { kind: "foreign", short: row.short, path: row.worktree ?? row.cwd };
  return { kind: "session", id: row.sessionId };
}
