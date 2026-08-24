// src/appserver/archive.ts — archived-ness as per-session marker files (spec D-M5-3 rev 3; review F8).
// One atomic create / one unlink per transition: NO read-modify-write exists for two processes to
// race, and cross-process STATE is correct because list/search re-read the directory per request.
// Push freshness stays per-server (broadcasts reach the emitting server's own clients) — documented.
// The handlers land in Task 9; this task is the store the search stage consumes.
import { mkdir, readdir, writeFile, unlink, chmod, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/** `mkdir`'s `mode` is UMASK-MASKED and `chmod` is not — the rule `configWrite.ts` states for every mode it
 *  installs, applied here because this path had the same hole (fix wave G / P2-5#4). Under `umask 0200` a
 *  directory asked for 0700 lands 0500, and the marker write one line down then fails EACCES for a store
 *  this process itself just created.
 *
 *  THE REPAIR HAS TO HAPPEN DURING THE WALK, not after it, and that was measured rather than assumed: a
 *  single `mkdir(…, {recursive:true})` under that mask creates the first missing PARENT at 0500 and then
 *  fails EACCES creating its child inside it, so there is no "afterwards" to repair from. Hence the chain
 *  is built one level at a time and each level is chmod'ed the moment it exists.
 *
 *  ONLY what this call found MISSING. A level that already existed at the survey is left exactly as its
 *  operator set it, which a blanket `chmod` would silently overwrite.
 *
 *  A CONCURRENT `EEXIST` IS NOT "someone else's, leave it" — it is "not yet usable, and only my own chmod
 *  is ordered before my own write" (fix wave H / H2). Skipping the chmod there was the same defect one
 *  branch over: under `umask 0200` the winner creates a level 0500 and repairs it a syscall later, and in
 *  that gap a loser that treats `EEXIST` as complete walks straight into it. So every level this call had
 *  to create is chmod'ed by THIS call before it descends, whoever won the race to create it; the mode
 *  asked for is the same one every creator of this tree asks for, so a peer's level is never given a mode
 *  its own creator did not want.
 *
 *  THE BOUNDARY LEVEL — the deepest one that already existed at the survey — is the walk's one blind
 *  spot, and it stayed open through G and H2: a peer's `mkdir` from a syscall ago is still at its masked
 *  0500, this call's survey files it under "existing, not mine to touch", and the first create INSIDE it
 *  lands in the peer's mkdir-to-chmod gap (measured 2026-08-23 on the four-process row: `EACCES mkdir
 *  …/d0/d1`, ~1 trial in 36). Chmod'ing the boundary is not an answer — it existed before this call
 *  looked, so its mode may be an OPERATOR's deliberate restriction, and overriding that would turn an
 *  honest refusal into a silent unlock. What closes it is `withBirthGrace` below: the gap is transient by
 *  construction (the peer's chmod is the very next syscall), so an `EACCES` here is retried briefly and
 *  only ever re-raised — nothing is chmod'ed that this call did not create, so a real restriction still
 *  refuses with the same errno, ~127ms later on an error path where that costs nothing.
 *
 *  TRIED AND REJECTED, so nobody improves their way back into it: giving each level an atomic birth at
 *  its final mode by staging (mkdir sibling, chmod private, `rename` into place — `writeTargetDoc`'s file
 *  pattern, applied to directories). It removes the gap on paper; on macOS/APFS it fails WORSE in
 *  practice, measured on this same suite: `rename` over an existing EMPTY directory — which POSIX
 *  requires to succeed, and which two same-instant winners inevitably do to each other — makes concurrent
 *  `mkdir`/`open` calls resolving through the replaced directory fail `EINVAL` (observed on both the
 *  four-process row and the six-child idempotence row). An atomic swap of the NAME is not atomic for the
 *  processes already inside, and there is no portable no-replace rename to reach for.
 *
 *  The `EEXIST` is re-asserted with a recursive `mkdir` first, which no-ops on a directory and re-raises
 *  on a FILE — so a path that is a file rather than a directory keeps raising the errno it always did
 *  (instead of being chmod'ed and then failing later and vaguer), and the type question is answered by a
 *  syscall rather than by a check that could go stale between asking and acting. When nothing is missing
 *  at all, that same recursive `mkdir` still runs, exactly as before. */
async function mkdirOwnerOnly(dir: string): Promise<void> {
  const missing: string[] = [];
  for (let cur = dir; ; cur = dirname(cur)) {
    if (await stat(cur).then(() => true, () => false)) break;
    missing.unshift(cur);
    if (dirname(cur) === cur) break;                     // the root: nothing above it to climb to
  }
  if (missing.length === 0) { await mkdir(dir, { recursive: true }); return; }
  for (const p of missing) {
    try { await withBirthGrace(() => mkdir(p, { mode: 0o700 })); }
    catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      await mkdir(p, { recursive: true }); // no-op on a directory; re-raises EEXIST on a file
    }
    await chmod(p, 0o700);
  }
}

/** A store level's mkdir-to-chmod gap, seen from the outside, is an `EACCES` that will be gone by the
 *  next syscall — retried on a short doubling ladder and then re-raised as-is. The ladder is the whole
 *  contract: total wait ≤127ms bounds what a genuinely restricted store adds to its refusal, and the
 *  final bare attempt is what keeps the errno and message byte-identical to the unretried call's. Only
 *  `EACCES` is graced — every other errno, `EEXIST` above all (idempotence's fast path), leaves on the
 *  first throw. */
async function withBirthGrace<T>(op: () => Promise<T>): Promise<T> {
  for (const wait of [1, 2, 4, 8, 16, 32, 64]) {
    try { return await op(); }
    catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EACCES") throw e;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return op();
}

export async function createArchiveMarker(sessionId: string, deps: ArchiveDeps): Promise<void> {
  checkId(sessionId);
  // 0700 like the root's two other creators (cli/serveMain.ts's runDir, fleet/roster.ts): `mkdir` applies a
  // mode only to directories it actually CREATES, so whichever writer arrives first sets it permanently —
  // and an embedder using the published `./appserver` export arrives here first, where `ccx serve` would
  // not. Without it a co-tenant on a shared host can enumerate the operator's archived session ids.
  await mkdirOwnerOnly(dirOf(deps));
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
  // `withBirthGrace`: when the store EXISTED at this call's survey, the marker write is the first
  // syscall to enter it — and can land in its creator's mkdir-to-chmod gap exactly as the walk can.
  try { await withBirthGrace(() => writeFile(join(dirOf(deps), sessionId), "", { flag: "wx" })); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e; }
}
export async function removeArchiveMarker(sessionId: string, deps: ArchiveDeps): Promise<void> {
  checkId(sessionId);
  try { await unlink(join(dirOf(deps), sessionId)); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e; }
}
