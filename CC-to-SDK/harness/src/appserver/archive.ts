// src/appserver/archive.ts — archived-ness as per-session marker files (spec D-M5-3 rev 3; review F8).
// One atomic create / one unlink per transition: NO read-modify-write exists for two processes to
// race, and cross-process STATE is correct because list/search re-read the directory per request.
// Push freshness stays per-server (broadcasts reach the emitting server's own clients) — documented.
// The handlers land in Task 9; this task is the store the search stage consumes.
import { mkdir, readdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ArchiveDeps { ccxDir?: string }
const dirOf = (deps: ArchiveDeps): string => join(deps.ccxDir ?? join(homedir(), ".claude", "ccx"), "archived");

/** Markers are filenames; a sessionId that could walk the path refuses loudly. Store ids are UUIDs,
 *  so this rejects nothing real. */
const checkId = (sessionId: string): void => {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId === "." || sessionId === "..")
    throw new Error(`sessionId is not marker-safe: ${JSON.stringify(sessionId)}`);
};

export async function listArchived(deps: ArchiveDeps): Promise<Set<string>> {
  try { return new Set(await readdir(dirOf(deps))); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return new Set(); throw e; }
}
export async function createArchiveMarker(sessionId: string, deps: ArchiveDeps): Promise<void> {
  checkId(sessionId);
  await mkdir(dirOf(deps), { recursive: true });
  try { await writeFile(join(dirOf(deps), sessionId), "", { flag: "wx" }); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e; }
}
export async function removeArchiveMarker(sessionId: string, deps: ArchiveDeps): Promise<void> {
  checkId(sessionId);
  try { await unlink(join(dirOf(deps), sessionId)); }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e; }
}
