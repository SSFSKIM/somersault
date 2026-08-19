// src/appserver/archive.ts — archived-ness as per-session marker files (spec D-M5-3 rev 3; review F8).
// One atomic create / one unlink per transition: NO read-modify-write exists for two processes to
// race, and cross-process STATE is correct because list/search re-read the directory per request.
// Push freshness stays per-server (broadcasts reach the emitting server's own clients) — documented.
// The handlers land in Task 9; this task is the store the search stage consumes.
import { mkdir, readdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fleetRoot } from "../fleet/paths.js";

export interface ArchiveDeps { ccxDir?: string }
/** The default root is `fleetRoot()` — the repo's ONE definition of `~/.claude/ccx` — not a second
 *  spelling of it. It honours the `CCX_FLEET_ROOT` override that ops use to relocate ccx state and that
 *  the suite's per-file backstop uses to stay off a developer's live home; a private copy would fail
 *  silently, since a readdir of the wrong directory just answers "nothing is archived". */
const dirOf = (deps: ArchiveDeps): string => join(deps.ccxDir ?? fleetRoot(), "archived");

/** This store's ONE typed refusal (Task 9). The store itself stays protocol-free — it knows nothing about
 *  JSON-RPC codes, exactly as `configWrite.ts` knows nothing about them and `configDomain.ts` assigns them
 *  — but a handler mapping this to a PARAMETER error rather than an internal one must be able to tell it
 *  apart from an errno, and message-matching a bare `Error` is the version of that which rots. */
export class MarkerIdError extends Error {}

/** Markers are filenames; a sessionId that could walk the path refuses loudly. Store ids are UUIDs,
 *  so this rejects nothing real. */
const checkId = (sessionId: string): void => {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId === "." || sessionId === "..")
    throw new MarkerIdError(`sessionId is not marker-safe: ${JSON.stringify(sessionId)}`);
};

export async function listArchived(deps: ArchiveDeps): Promise<Set<string>> {
  try { return new Set(await readdir(dirOf(deps))); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return new Set(); throw e; }
}
/** The archived PARTITION's one predicate (D-M5-3), shared by `thread/search` (Task 7) and `thread/list`
 *  (Task 10) — the two methods the spec hands the partition to, in one sentence. It is a partition and not
 *  a filter: `wantArchived` false keeps only the sessions with NO marker, true keeps only the ones with a
 *  marker, and every session is in exactly one half. A second spelling of that could only ever drift into
 *  "true also shows the unarchived ones", which is the reading a filter would have.
 *
 *  `sessionId` is optional because ONE caller has rows without one: `thread/list` merges this server's live
 *  registry in, and a record whose engine has not yet reported a session id (router.ts's routeInit latches
 *  it off the first turn's init frame) has no id a marker could name — so it cannot be archived, and the
 *  DEFAULT half is where it belongs.
 *
 *  That branch is a TYPE and a statement, not a behavioural fix, and the distinction is worth writing down
 *  because it was measured rather than assumed: `Set<string>.has(undefined)` is `false` for a set built
 *  from a `readdir`, so `false === wantArchived` is `!wantArchived` — the same answer the branch gives, at
 *  every input. A mutation replacing the whole ternary with `archived.has(sessionId as string) ===
 *  wantArchived` is therefore EQUIVALENT and no test can catch it (verified: it is green). What the branch
 *  buys is that the cast — which would be a lie about the type — is not needed, and that the rule reads as
 *  the domain fact it is. What it is NOT is arbitrary: flipping it to `? wantArchived` puts an unlatched
 *  live row in the archived half, which is wrong and which a row does catch. */
export const inArchivedPartition = (archived: Set<string>, sessionId: string | undefined, wantArchived: boolean): boolean =>
  sessionId === undefined ? !wantArchived : archived.has(sessionId) === wantArchived;

export async function createArchiveMarker(sessionId: string, deps: ArchiveDeps): Promise<void> {
  checkId(sessionId);
  // 0700 like the root's two other creators (cli/serveMain.ts's runDir, fleet/roster.ts): `mkdir` applies a
  // mode only to directories it actually CREATES, so whichever writer arrives first sets it permanently —
  // and an embedder using the published `./appserver` export arrives here first, where `ccx serve` would
  // not. Without it a co-tenant on a shared host can enumerate the operator's archived session ids.
  await mkdir(dirOf(deps), { recursive: true, mode: 0o700 });
  // `wx` is O_CREAT|O_EXCL: EEXIST is the idempotent re-archive, and no state this store itself produces
  // can tell it from a plain `w` (the marker is empty, so a truncating create leaves identical bytes). The
  // exclusivity is still load-bearing for states it does NOT produce: O_EXCL refuses to FOLLOW a symlink at
  // the marker path, so a hand-placed or crash-left `archived/<id>` pointing at a real file is left intact
  // where `w` would truncate it.
  //   ASSUMED, not enforced: that this EEXIST means "your marker is already there". On a case-insensitive
  // filesystem (APFS, NTFS) it can instead mean "some other name folds onto this one" — create "abcdef"
  // over an existing "ABCdef" returns ok while `listArchived` keeps showing only "ABCdef", and the matching
  // remove unlinks the OTHER session's marker. Unreachable with today's lowercase-UUID ids; the character
  // screen admits A-Z, so an id scheme that ever mixes case must fold before it gets here.
  //   DURABILITY is deliberately not addressed: nothing fsyncs the marker or its parent directory, so a
  // power loss just after a successful return can lose the archive. Torn writes are impossible regardless
  // (O_CREAT|O_EXCL plus a zero-byte write leaves either no dirent or the intended marker; `unlink` is
  // atomic), and nothing else in this repo fsyncs either — `writeTargetDoc` does not. Considered, accepted.
  try { await writeFile(join(dirOf(deps), sessionId), "", { flag: "wx" }); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e; }
}
export async function removeArchiveMarker(sessionId: string, deps: ArchiveDeps): Promise<void> {
  checkId(sessionId);
  try { await unlink(join(dirOf(deps), sessionId)); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e; }
}
