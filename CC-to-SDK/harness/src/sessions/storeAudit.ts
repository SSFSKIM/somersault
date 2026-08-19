// src/sessions/storeAudit.ts — whether the local session store can be READ, established by reading it
// ourselves (spec D-M5-25; D-M5-8's contract on the production origin).
//
// WHY THIS EXISTS. D-M5-8 says a store read failure is an error, never an empty page. The handlers'
// error paths were correct code that could not run: the SDK's readers swallow every filesystem failure
// (`listSessions` wraps its `readdir` `catch { return [] }`, `getSessionMessages` returns `[]`,
// `getSessionInfo` returns `undefined`), so an unreadable store is indistinguishable from an empty one on
// the wire — a clean zero-hit page, `nextCursor: null`, the shape reserved for "there is nothing more".
// Every unit row that pinned the contract injected a reader that THROWS, which is a substitute more honest
// than the real dependency: it proves the handler's handling of an error the shipped reader never raises.
//
// We cannot make that reader throw. So the failure is established the other way round — the precondition
// is verified with plain `fs`, where an errno propagates, exactly as the archive marker store's `readdir`
// already does one call away on the same request. This file is deliberately NOT a second reader: it opens
// no transcript and parses nothing. It answers one question — is every directory of this store listable
// and every transcript in it openable — and it answers by throwing the store's own errno.
import { readdir, access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir } from "../config/claudeHome.js";

/** The store's root, in the ONE spelling the engine uses: `<CLAUDE_CONFIG_DIR ?? ~/.claude>/projects`,
 *  the SDK's own `join(Zt(), "projects")` (`claudeConfigDir` carries the measurement for the first half).
 *  One directory segment is the whole of what this module knows about the store's layout — it deliberately
 *  does NOT reproduce the cwd-to-project-directory mangling, which is SDK-internal (a character fold, a
 *  200-character truncation with a hash suffix, and a `CLAUDE_CODE_PROJECT_DIR_NAME` override), so nothing
 *  here can silently point at the wrong directory when that mapping changes. */
export const sessionStoreRoot = (env: NodeJS.ProcessEnv = process.env): string => join(claudeConfigDir(env), "projects");

/** ENOENT is ABSENCE, and absence is the one honest empty: a store that was never written, a project
 *  directory removed while we walked it, a transcript deleted between its dirent and our `access`. Every
 *  other errno is an inability to read something that IS there — the thing D-M5-8 forbids reporting as
 *  "no matches". */
const absent = (e: unknown): boolean => (e as NodeJS.ErrnoException)?.code === "ENOENT";

/** Node's own text for the read a directory-shaped transcript would fail, composed here because we never
 *  perform that read — the dirent already told us. Errno-shaped so it refuses through the same branch of
 *  `storeRefusal` every other store failure does. */
const notAFile = (path: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${path}'`), { code: "EISDIR", syscall: "read", path });

/** Throws the store's own errno for the FIRST thing it cannot read; returns for a store it can read whole.
 *  Never returns a verdict — a partial answer is what D-M5-8 exists to forbid.
 *
 *  The walk mirrors the SDK's own enumeration (`readdir` the root, `isDirectory()` dirents only, then each
 *  project directory) so it can neither miss a directory the reader visits nor invent one it does not. Per
 *  transcript it costs ONE `access`: `stat` is reached only for a dirent that is not already a regular
 *  file. Measured on a real 1005-directory / 4643-transcript store: ~30-45 ms for the dirent walk and
 *  ~125-160 ms with the per-file check, against ~1.9-2.25 s for the `listSessions()` it verifies.
 *
 *  Re-run per request, never cached, for the archive markers' reason (D-M5-3): readability is state
 *  another process changes with one `chmod`, and a set held across requests answers for the moment this
 *  server last looked. */
export async function auditSessionStore(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const root = sessionStoreRoot(env);
  let projects;
  try { projects = await readdir(root, { withFileTypes: true }); }
  catch (e) { if (absent(e)) return; throw e; }
  for (const d of projects) {
    if (!d.isDirectory()) continue;
    const dir = join(root, d.name);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (e) { if (absent(e)) continue; throw e; }
    for (const f of entries) {
      if (!f.name.endsWith(".jsonl")) continue;
      const path = join(dir, f.name);
      try {
        // R_OK on the PATH (symlinks followed, as the reader's own `open` would) — and a DIRECTORY passes
        // R_OK while every read of it fails EISDIR, so the kind is checked too. `f.isFile()` short-circuits
        // the `stat` for the regular file every real transcript is.
        await access(path, constants.R_OK);
        if (!f.isFile() && !(await stat(path)).isFile()) throw notAFile(path);
      } catch (e) { if (absent(e)) continue; throw e; }
    }
  }
}
