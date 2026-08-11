// tui/pasteCache.ts — CM26's on-disk paste cache (F5 task 5), transcribed from 2.1.220 rather than invented:
//  · `RUd` (L317317)  the key — `sha256(content).hex.slice(0, 16)`, sixteen chars, not the whole digest
//  · `MUd` (L317321)  the path — `${hash}.txt` inside one flat directory
//  · `ru_` (L317324)  the write — mkdir -p, then `write(path, content, 384)`, i.e. mode 0o600, and every
//                     failure swallowed into a log line (`Failed to store paste`), never rethrown
//
// WHY it exists at all: the `pastedContents` map in EditorState dies with the buffer at submit, but the chip
// LABEL survives in the session transcript. Task 7's history recall pulls a `[Pasted text #N …]` back out of
// a transcript this process may not even have written, so the payload has to be somewhere a later process can
// find it — content-addressed, because the recalled label carries no path.
//
// Two deliberate divergences from upstream, both recorded rather than hidden:
//  1. SYNCHRONOUS. Upstream's `ru_` is async and fires and forgets; ours is called from a keystroke handler
//     that must not interleave, and a paste is one write of at most a few hundred KB.
//  2. NO in-memory LRU fallback. Upstream, on a failed write, parks the content in a 1 MiB-capped Map (`tu_`
//     / `Z2e`, L317305-L317329) that `PUd` consults before the disk. Ours skips silently. The only reader is
//     a recall out of a PERSISTED transcript, so an entry that never reached the disk would have to survive a
//     process exit to be useful — an LRU no reader can hit is a cache with no purpose. The user-visible
//     consequence is upstream's own fallback text, `[Pasted text #N — content no longer available]` (`ou_`,
//     L317398), which task 7 renders for exactly this case.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fleetRoot } from "../fleet/paths.js";

/** One flat directory beside `roster/` and `run/`, so `CCX_FLEET_ROOT` isolates it in tests exactly like
 *  every other fleet path (prefs.ts:14 is the same move). */
export function pasteCacheDir(env?: NodeJS.ProcessEnv): string { return join(fleetRoot(env), "paste-cache"); }
/** `RUd`. Sixteen hex chars is 64 bits — upstream's choice, kept: a collision needs ~4 billion distinct
 *  pastes in one cache before it is even likely, and the failure mode is showing the wrong old paste, not
 *  corruption. Content-addressed, so re-pasting the same text is idempotent on disk. */
export function pasteHash(content: string): string { return createHash("sha256").update(content).digest("hex").slice(0, 16); }
/** `MUd`. */
export function pastePath(hash: string, env?: NodeJS.ProcessEnv): string { return join(pasteCacheDir(env), `${hash}.txt`); }

/** `ru_`. UNCONDITIONAL: no existsSync check in front of it, because the write is the cheap half and a
 *  stat-then-write is a race with nothing to win. 0o600 is not decoration — a paste is the single most
 *  likely place for an API key or a private diff to land, and this file outlives the session.
 *
 *  Silent on failure BY CONTRACT: the caller is ChatComposer's keystroke handler, and a read-only home or a
 *  full disk must cost the user their paste cache, not their keystroke. */
export function storePaste(content: string, env?: NodeJS.ProcessEnv): void {
  try {
    mkdirSync(pasteCacheDir(env), { recursive: true });
    writeFileSync(pastePath(pasteHash(content), env), content, { mode: 0o600 });
  } catch { /* CM26: the cache is best-effort; task 7 renders `content no longer available` on the miss. */ }
}

/** `PUd` minus its LRU arm. A miss — never stored, purged, unreadable — is `null`, distinct from the empty
 *  string, which is a real (if useless) stored payload. */
export function loadPaste(hash: string, env?: NodeJS.ProcessEnv): string | null {
  try { return readFileSync(pastePath(hash, env), "utf8"); } catch { return null; }
}
