// src/appserver/configWrite.ts — write primitives (spec D-M5-13/14 rev 3, lock rev D-M5-24; plan
// review F3/F4/F14/F20). The version check is ATOMIC WITH THE WRITE: callers run
// read→validate→apply→commit inside `withFileLock`, which stacks an in-process per-path chain (two
// requests in this server) under a `<file>.lock` DIRECTORY (two servers on this machine). Ownership is
// the NAME of the marker inside that directory and never its bytes; the claim is published by `rename`;
// liveness is a LEASE the holder refreshes. The block above `withFileLock` says why each is load-bearing.
import { readFile, writeFile, rename, unlink, stat, chmod, mkdir, realpath, lstat, readlink, readdir, rmdir, utimes } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { settingsMerge } from "./configLayers.js";

// `ConfigLocked` is NOT a validation failure: the request was well-formed and the target real, another
// writer simply holds it. configDomain maps it to a different wire code for exactly that reason.
export class ConfigError extends Error {
  constructor(public code: "ConfigVersionConflict" | "ConfigValidationError" | "ConfigLocked", message: string) { super(message); }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The same three keys refused as keyPath SEGMENTS are refused anywhere inside a written VALUE (review
 *  M4). Without this the rule disagreed with itself: a literal `__proto__` key inside an upsert value
 *  reaches `settingsMerge`'s `out[k] = …`, which invokes `Object.prototype`'s `__proto__` SETTER — the
 *  merged node's prototype is reassigned and the key vanishes from the written JSON, while the same key
 *  under `replace` round-trips intact. A silent vanish is a worse answer than a refusal.
 *
 *  The walk is DEPTH-BOUNDED, and it is the first thing a written value meets, so the bound covers the
 *  two recursions behind it (`settingsMerge`, `JSON.stringify`) too. A value nested past the engine's
 *  stack survives `JSON.parse` but threw `RangeError` here, which configDomain maps to INTERNAL — a
 *  client-supplied shape has to come back as a validation refusal. 64 is two orders of magnitude under
 *  the depth that still walked fine (4000) and an order of magnitude over the deepest real settings
 *  shape (a hook matcher nests about eight). */
const MAX_VALUE_DEPTH = 64;
function assertWritableValue(value: unknown, path: string[], depth = 0): void {
  if (depth > MAX_VALUE_DEPTH) throw new ConfigError("ConfigValidationError", `value nests deeper than ${MAX_VALUE_DEPTH} levels (at value path "${path.join(".")}")`);
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) assertWritableValue(value[i], [...path, String(i)], depth + 1); return; }
  if (!isPlainObject(value)) return;
  for (const k of Object.keys(value)) {
    if (FORBIDDEN.has(k)) throw new ConfigError("ConfigValidationError", `key "${k}" is not writable (at value path "${[...path, k].join(".")}")`);
    assertWritableValue(value[k], [...path, k], depth + 1);
  }
}

/** D-M5-13 exactly: replace sets (null deletes); upsert deep-merges with the READ side's customizer
 *  (null refuses); parents created as objects; a non-object parent refuses with the doc untouched.
 *  The three prototype segments refuse outright (D-M5-12 rev 3) — as a keyPath segment AND anywhere
 *  inside the value — and every lookup is own-property: an opaque-segment contract must not be a
 *  pollution channel. Pure — returns a new doc. */
export function applyEdit(doc: Record<string, unknown>, keyPath: string[], value: unknown, strategy: "replace" | "upsert"): Record<string, unknown> {
  if (keyPath.length === 0) throw new ConfigError("ConfigValidationError", "keyPath must not be empty");
  for (const seg of keyPath) if (FORBIDDEN.has(seg)) throw new ConfigError("ConfigValidationError", `keyPath segment "${seg}" is not writable`);
  assertWritableValue(value, keyPath);
  const out = { ...doc };
  let node = out;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const seg = keyPath[i];
    const cur = own(node, seg) ? node[seg] : undefined;
    if (cur === undefined) { const next: Record<string, unknown> = {}; node[seg] = next; node = next; continue; }
    if (!isPlainObject(cur)) throw new ConfigError("ConfigValidationError", `keyPath segment "${seg}" is not an object`);
    const copy = { ...cur }; node[seg] = copy; node = copy;
  }
  const leaf = keyPath[keyPath.length - 1];
  if (strategy === "replace") {
    if (value === null) delete node[leaf]; else node[leaf] = value;
    return out;
  }
  if (value === null) throw new ConfigError("ConfigValidationError", "upsert with null has no meaning; use replace to delete");
  node[leaf] = own(node, leaf) ? settingsMerge(node[leaf], value) : value;
  return out;
}

/** TWO cases only — BYTES in, token out. The wire's THIRD token, "unreadable" (a settings file that is
 *  there but whose bytes never reached us), is minted by configDomain.ts's versions walk from LAYER
 *  state; it is not a property of any bytes, so it cannot be minted here.
 *
 *  A `Buffer`, and the type is the point (fix wave H / H3). D-M5-18 defines the version token as the
 *  sha256 of the file's RAW BYTES, and every caller used to reach it through `readFile(…, "utf8")` — so
 *  what was hashed was the DECODED TEXT, and the published definition and the implementation disagreed.
 *  They disagree observably: 0x80 and 0x81 inside an otherwise valid JSON string are two different files
 *  that both decode to U+FFFD, so both were minted the same token while their sha256s differ. Taking a
 *  `Buffer` is what makes the decoded string unhashable here rather than merely unhashed. */
export function versionToken(bytes: Buffer | null): string {
  return bytes === null ? "absent" : createHash("sha256").update(bytes).digest("hex");
}

export async function readTargetDoc(filePath: string): Promise<{ doc: Record<string, unknown>; version: string }> {
  let bytes: Buffer;
  try { bytes = await readFile(filePath); }
  catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { doc: {}, version: "absent" };
    // The write-side half of Task 2 review I1: a target that EXISTS but could not be read (EACCES on a
    // write-only settings file, EISDIR on a directory at the path) is refused as a validation failure,
    // not leaked as an internal error — never write bytes over bytes we were never able to see.
    throw new ConfigError("ConfigValidationError", `target settings file could not be read: ${(e as Error).message ?? String(e)}`);
  }
  const body = bytes.toString("utf8").replace(/^﻿/, "");
  // A blank (or BOM-only) file is an EMPTY doc, exactly as `readLayers` already treats it — upstream's
  // loader does too (review I2). Sending it to JSON.parse instead made `config/read` report the file
  // healthy while every write against it refused forever, with no way out through the API. The token is
  // the hash of the real bytes, NOT "absent": the file exists, and a CAS check must be able to see it.
  if (body.trim() === "") return { doc: {}, version: versionToken(bytes) };
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new ConfigError("ConfigValidationError", "target settings file is not valid JSON; fix it before writing through this API"); }
  if (!isPlainObject(parsed)) throw new ConfigError("ConfigValidationError", "target settings file is not a JSON object");
  return { doc: parsed, version: versionToken(bytes) };
}

/** ONE spelling per LOOKUP path (review I2): whatever a caller names, this answers with the same string
 *  before and after that file's own creation. `realpath` answers only for a path that EXISTS, so a file
 *  resolved before and after creation came back under two different names — the literal one first, the
 *  canonical one after — and on macOS, where `/var` and `/tmp` are themselves symlinks, those two strings
 *  genuinely differ. A client could then correlate neither its own two write replies nor a write reply
 *  with a read reply, and the pre-creation spelling took a DIFFERENT `<file>.lock`.
 *
 *  So the deepest ANCESTOR that exists is canonicalized and the missing tail is rejoined onto it: the
 *  answer no longer depends on whether the leaf — or its parent directory — has been created yet.
 *
 *  It canonicalizes the PARENT and keeps the leaf, which is what makes it the right answer for
 *  `config/read`'s `layers[].filePath` — the read side reports WHERE A LAYER IS LOOKED UP. It is therefore
 *  NOT always the same string as `resolveRealTarget`'s, which follows the leaf link to report the real file
 *  a write landed in (and that file is the lock identity). The two diverge in exactly one shape — the
 *  settings file itself is a symlink — and there each answer is the correct one for its own caller: a
 *  project `settings.json` symlinked at the user file makes `config/read` name `<proj>/.claude/settings.json`
 *  (the project layer really is looked up there) while the write reply names `<home>/.claude/settings.json`
 *  (the bytes really landed there). Everywhere else — including every path whose leaf is a plain file or
 *  does not exist yet — the two agree, which is the correlation the I2 fix was for. */
export async function canonicalPath(filePath: string): Promise<string> {
  const tail: string[] = [];
  for (let cur = filePath; ;) {
    const parent = dirname(cur);
    tail.unshift(basename(cur));
    try { return join(await realpath(parent), ...tail); } catch { /* the parent is missing too — climb */ }
    // Belt and braces, and UNREACHABLE by measurement: `dirname` is its own fixed point only at the root,
    // and `realpath("/")` has already answered by then, so the climb itself is what guarantees this
    // function always answers. Kept anyway, because the alternative to a redundant exit here is a `for(;;)`
    // with no exit at all if some host ever fails to resolve its own root.
    if (parent === cur) return filePath;
    cur = parent;
  }
}

/** A symlinked settings file resolves so tmp+rename replaces the REAL file, never the link (plan review
 *  F14 — silently detaching managed symlinks). `realpath` answers only for a link whose target EXISTS;
 *  a link that dotfile managers and provisioning scripts laid down ahead of the first write dangles, and
 *  returning the literal path for it was the one case that still destroyed the link — the rename replaced
 *  it with a regular file and the intended target was never created (review I3). So a dangling link is
 *  walked by hand, relative targets against the link's own directory, and the walk is BOUNDED: a symlink
 *  loop must refuse, never become a second hang.
 *
 *  EVERY exit is canonicalized, not just the entry: the walk's exits are the ones that answer for a file
 *  that does not exist yet, which is exactly where the two-spellings-per-file bug lived (review I2).
 *
 *  No `mkdir` here (review M3): `withFileLock` and `writeTargetDoc` each create the parent they need WHEN
 *  IT CAN BE CREATED, and creating it during RESOLUTION meant a request refused between here and the write
 *  had already made a directory in a client-named location. The shapes `mkdir` cannot fix — a parent that
 *  is there but is not a usable directory — are the subject of `assertWritableParent` below. */
const SYMLINK_HOPS = 8;
export async function resolveRealTarget(filePath: string): Promise<string> {
  try { return await realpath(filePath); } catch { /* target missing, dangling link, or a loop — walk it */ }
  let cur = filePath;
  for (let hop = 0; hop < SYMLINK_HOPS; hop++) {
    try {
      const st = await lstat(cur);
      if (!st.isSymbolicLink()) return canonicalPath(cur); // nothing to follow: the path (it just does not exist yet)
    } catch { return canonicalPath(cur); } // no entry at all — the plain "file does not exist" case
    // A `readlink` failure used to fall into the same catch and answer with the LINK's own path, which
    // sent tmp+rename at the link and destroyed it — I3's detachment, re-entered through the error path.
    // Only ENOENT is benign: the link went away between the two calls, so there is nothing left to
    // detach and the literal path is still the answer. Any other failure means a link IS there and we
    // cannot resolve it, and writing would replace it — refuse.
    let link: string;
    try { link = await readlink(cur); }
    catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return canonicalPath(cur);
      throw new ConfigError("ConfigValidationError", `settings path is a symlink that could not be resolved (${cur}): ${(e as Error).message ?? String(e)}`);
    }
    cur = resolve(dirname(cur), link);
  }
  throw new ConfigError("ConfigValidationError", `settings path resolves through more than ${SYMLINK_HOPS} symlinks (or a symlink loop): ${filePath}`);
}

/** TARGETED, never a blanket catch — wrapping the whole write in one would swallow genuine internal
 *  failures under a validation code. `mkdir(…, {recursive:true})` creates a missing parent and is the
 *  ordinary first-write path, but it cannot fix a parent that is ALREADY something: a `.claude` that is a
 *  dangling symlink (ENOENT), a symlink loop (ELOOP), or a regular file (EEXIST) came back to the client as
 *  -32603 carrying node's raw `mkdir` message — an internal error for a filesystem shape the client owns
 *  and can repair. `stat` follows links, so the three shapes separate cleanly from "nothing there yet":
 *  that one is the ONLY ENOENT with no `lstat` entry behind it, and it is the one case that must proceed. */
export async function assertWritableParent(filePath: string): Promise<void> {
  const parent = dirname(filePath);
  let st;
  try { st = await stat(parent); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" && !(await lstat(parent).then(() => true, () => false)))
      return; // nothing there at all — `mkdir` creates it, which is the whole first-write path
    if (code === "ENOENT") throw new ConfigError("ConfigValidationError", `settings directory is a symlink that does not resolve: ${parent}`);
    throw new ConfigError("ConfigValidationError", `settings directory cannot be used (${code ?? "unknown error"}): ${parent}`);
  }
  if (!st.isDirectory()) throw new ConfigError("ConfigValidationError", `settings directory is not a directory: ${parent}`);
}

/** What a caller asserts about the bytes it is replacing, checked at the LAST instant before the rename.
 *  THREE independent detectors, because they fail independently and each answers about a different subject:
 *  `fence` asks the LOCK whether this process still holds it, `expectVersion` asks the FILE whether anyone
 *  committed since the caller read it, and `assertNotRelinked` asks the PATH whether it still names the same
 *  kind of thing it named when it was resolved. The second holds even if the lock fails in a way the first
 *  cannot see, which is the property that matters — no arrangement of an advisory lock can be trusted to
 *  the point of skipping it — and the third holds even when both of the others are satisfied, because a
 *  path swapped for a symlink keeps the lock valid and can keep the bytes identical. */
export interface CommitGuard {
  /** the token the doc being replaced hashed to when this caller read it */
  expectVersion: string;
  /** the lock's own liveness assertion; throws `ConfigLocked` if this process no longer owns the lock */
  fence: () => Promise<void>;
}

/** THE THIRD DETECTOR (fix wave G / G2), and the one neither of the other two can see. `resolveRealTarget`
 *  runs BEFORE the lock is taken (configDomain.ts) and its answer is the path everything after it names:
 *  the lock identity, the doc read, the version read, the rename. If a symlink is planted at that resolved
 *  path in the meantime, every READ follows it to some other file while `rename` replaces the LINK ENTRY —
 *  so the write detaches a link the operator's dotfile manager put there and leaves the file it pointed at
 *  untouched. Neither existing detector fires: the lock is still ours (the lock is a sibling path, not this
 *  one) and the version still matches whenever the link's target holds the same bytes — or is not asserted
 *  at all, since `expectedVersion` is optional on the wire.
 *
 *  So the IDENTITY of the path is re-asserted here, one syscall before the rename, exactly where the other
 *  two are and for the same reason: it is the narrowest window a userspace writer can leave. `lstat` and not
 *  `stat`, because following the link is precisely the mistake. THREE outcomes and only two may proceed —
 *  a regular entry (the ordinary case) and no entry at all (the first write to a path that does not exist
 *  yet, which `resolveRealTarget` answers for by design). A symlink refuses, and so does an `lstat` that
 *  fails for any reason other than ENOENT: an identity we could not establish is not an identity we may
 *  overwrite.
 *
 *  `ConfigLocked`, not a validation error, because the client's move is the one `BUSY` already means:
 *  re-read and retry. A retry re-runs `resolveRealTarget`, which follows the new link and takes the lock on
 *  the file it names — the write then lands where the operator pointed it. It is a NARROWING, not a proof:
 *  a link planted between this `lstat` and the `rename` is still undetectable from userspace, exactly as a
 *  byte written between the version read and the `rename` is. */
async function assertNotRelinked(filePath: string): Promise<void> {
  const kind = await lstat(filePath).then(
    (s) => (s.isSymbolicLink() ? "symlink" : "entry"),
    (e) => ((e as NodeJS.ErrnoException)?.code === "ENOENT" ? "absent" : "unknown"),
  );
  if (kind === "entry" || kind === "absent") return;
  throw new ConfigError("ConfigLocked",
    kind === "symlink"
      ? "the settings path became a symlink while this write was being prepared; nothing was written — re-read and retry"
      : "the settings path could not be re-identified while this write was being prepared; nothing was written — re-read and retry");
}

/** 2-space JSON + trailing newline, installed by tmp+rename. The rename installs the TMP file's mode, so
 *  an existing target's mode is carried over first — settings files legitimately hold `env` values and
 *  `apiKeyHelper` paths, and without this the first write through this API turned a deliberate 0600 into
 *  the umask default 0644 (review I1). The tmp is CREATED at that mode instead of being repaired into it
 *  afterwards: the repair left the SAME private bytes sitting in the same directory at the umask default
 *  for the length of the write (measured — a 0600 settings file's tmp observed at 644 mid-write). The
 *  chmod stays, because `writeFile`'s `mode` is umask-masked and can only land NARROWER than asked, so
 *  it is the chmod that actually installs the mode — and it is UNCONDITIONAL (fix wave C), because the
 *  umask masks the fallback too: a FRESH file promised 0600 (D-M5-14b) landed at 0400 under `umask 0277`
 *  and at 0200 under `umask 0477`, and 0200 is a file this API can then never read back, so `config/read`
 *  reported the layer `unreadable` and every later write to it refused. `chmod` is not umask-masked, so
 *  one call makes the promise true in both directions. A target that does not exist yet has no mode to
 *  carry and is created 0600 — its bytes are the same class of secret, and there is no later step that
 *  would narrow it. Anything that fails before the rename takes the tmp with it: nothing used to, so a
 *  failed rename (EISDIR against a directory at the path) parked those bytes on disk for good. */
export async function writeTargetDoc(filePath: string, doc: Record<string, unknown>, guard?: CommitGuard): Promise<{ version: string }> {
  await mkdir(dirname(filePath), { recursive: true });
  // ONE bytes value, built once: it is what `writeFile` puts on disk AND what the reply's token hashes,
  // so the two cannot describe different things (fix wave H / H3).
  const bytes = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, "utf8");
  const tmp = `${filePath}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  const mode = await stat(filePath).then((s) => s.mode & 0o7777, () => null);
  try {
    await writeFile(tmp, bytes, { mode: mode ?? 0o600 });
    await chmod(tmp, mode ?? 0o600);
    // The guard sits HERE — after the tmp is complete, one syscall before the rename — because that is
    // the narrowest window a userspace writer can leave between "I am still the writer" and "these bytes
    // are the file". Checking earlier leaves the whole serialization of the write inside the window;
    // checking after the rename is not a check at all, it is a post-mortem on a destroyed update.
    if (guard !== undefined) {
      await guard.fence();
      await assertNotRelinked(filePath);
      const current = await readFile(filePath).then(versionToken, (e) => ((e as NodeJS.ErrnoException)?.code === "ENOENT" ? "absent" : null));
      if (current !== guard.expectVersion)
        throw new ConfigError("ConfigLocked", "the settings file changed while this write was being prepared; nothing was written — re-read and retry");
    }
    await rename(tmp, filePath);
  } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
  return { version: versionToken(bytes) };
}

const chains = new Map<string, Promise<unknown>>();

/** `mkdir` is umask-masked and `readdir` needs r+x, so a lock created under a umask that masks the owner
 *  bits would be a lock nobody can inspect — the shape that wedged the old lock permanently. `chmod` is
 *  not umask-masked, which is why every mode this file installs goes through one. */
const LOCK_DIR_MODE = 0o700;
const errnoOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code;

/** ONE sentence for both halves of `fence`'s check. Ownership can be lost by the directory no longer naming
 *  this writer OR by the refresh finding the marker gone, and those are two detections of ONE fact — the
 *  client's move is identical, so a second string would only be a second thing to match on. */
const LOCK_BROKEN = "this writer's lock was broken while it was held; nothing was written";

/** A lock is a NON-EMPTY DIRECTORY at `<file>.lock`, published by `rename`, holding exactly one marker
 *  file whose NAME is the owner's nonce (D-M5-24). Three properties fall out of that shape, and each one
 *  closes a defect measured on the `open(wx)` + `unlink` lock it replaces:
 *
 *  1. **Acquire is one atomic syscall against an already-complete claim.** The claim is assembled in a
 *     staging directory beside the target and renamed into place; `rename` onto a NON-EMPTY directory
 *     fails ENOTEMPTY, so a live claim cannot be clobbered, and there is no instant in which the lock
 *     exists without naming its owner. The old lock had that instant and a contending process was caught
 *     inside it, reading an empty owner off a lock mid-creation.
 *  2. **Every delete is content-conditional — which POSIX gives no way to make an `unlink` be.** The
 *     owner is the marker's NAME, so `unlink(<lock>/<nonce>)` can only ever destroy that one owner's
 *     claim; a successor's marker has a different name and is untouched. Removing the directory
 *     afterwards is `rmdir`, whose emptiness precondition IS the atomic "no successor has claimed it"
 *     test. And `unlink` cannot remove a directory at all (EPERM), so a fresh claim is immune BY TYPE to
 *     the pathname-only delete that used to destroy it: with one abandoned lock and four contenders,
 *     43 of 250 trials on one machine and 32 of 250 on another put two or more processes inside the
 *     critical section at once, every one of them losing an update, with zero refusals reported.
 *  3. **Staleness is a LEASE, not an age.** The holder refreshes its marker's mtime on a timer, so a
 *     slow-but-live holder is no longer indistinguishable from a dead one. At production settings a
 *     writer stalled 45s had its lock broken at exactly 30s; the evictor then passed its version check,
 *     committed, and was told `ok` — and the evicted writer's own rename destroyed those bytes 15s later.
 *     A holder that cannot refresh (SIGSTOP, a blocked event loop, a clock jump) can still be evicted, so
 *     it must also FENCE before it commits: see `fence` below and `CommitGuard`.
 *
 *  Nothing here ever reads the lock's bytes. That is what unwedges a lock created under a umask masking
 *  the owner-read bit: the old release read its own nonce back to prove ownership, could not, and left
 *  the lock in place forever — every later write to that target blocked out the deadline and refused.
 *
 *  BLOCKS while a foreign lock is live, and the wait is a normal outcome. A DEAD writer's leftover is
 *  breakable once its lease is older than `staleMs` (30s by default), so a call that meets one waits out
 *  the remainder of that window, breaks it, and proceeds. `ConfigLocked` fires when the leftover cannot be
 *  removed, or when a live holder keeps its lease past the deadline (`staleMs` + 5s) — which is now the
 *  honest answer to a genuinely slow peer rather than the theft it used to be. One number still sets both
 *  "when is a lease dead" and "how long do I wait" (M5 review I3); callers that surface this on a wire must
 *  say so — see configDomain.ts's `runConfigWrite`. */
export async function withFileLock<T>(filePath: string, fn: (fence: () => Promise<void>) => Promise<T>, opts: { staleMs?: number } = {}): Promise<T> {
  const staleMs = opts.staleMs ?? 30_000;
  const lockPath = `${filePath}.lock`;
  const nonce = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const stagePath = `${lockPath}.stage-${nonce}`;
  const markerPath = join(lockPath, nonce);
  const prev = chains.get(filePath) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    await mkdir(dirname(lockPath), { recursive: true });
    // The staging directory is removed on every exit from the loop below, including the refusal — but a
    // process KILLED while it waits leaves one behind, and nothing reclaims it. Accepted, and named here
    // rather than swept: the same is already true of `writeTargetDoc`'s tmp file, the residue is inert
    // (no reader of this directory looks at it, and it never blocks an acquisition), and a sweep by age
    // would be a new way to destroy a live contender's claim-in-waiting.
    await mkdir(stagePath);
    await chmod(stagePath, LOCK_DIR_MODE);
    // The marker's CONTENT is a human reading it with `cat` during an incident; the mode it lands at is
    // whatever the umask allows, and nothing depends on reading it, because ownership rides the name.
    await writeFile(join(stagePath, nonce), `${nonce}\n${new Date().toISOString()}\n`, { mode: 0o600 });
    const deadline = Date.now() + staleMs + 5_000;
    try {
      for (;;) {
        // The lease starts when the claim LANDS, not when it was assembled. Without this a writer that
        // waited out another's critical section acquired a claim already older than the stale window and
        // was broken by the next contender within milliseconds — measured at 5 of 5 trials, three
        // processes, sections outliving a 400ms window. One `utimes` per attempt keeps the marker's age
        // bounded by a single syscall at the instant the `rename` publishes it.
        const born = new Date();
        await utimes(join(stagePath, nonce), born, born).catch(() => {});
        try { await rename(stagePath, lockPath); break; }
        catch (e) {
          const code = errnoOf(e);
          // ENOTEMPTY/EEXIST: someone's claim is there. ENOTDIR/EISDIR: something that is not one of our
          // directories is. Anything else is a real filesystem failure and is not ours to absorb.
          if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOTDIR" && code !== "EISDIR") throw e;
          // ONLY a successful break may skip the retry budget (D-M5-14a #1). Every other outcome — the
          // unlink failed (an immutable lock, or a read-only directory: EPERM/EACCES), a successor
          // claimed the path first, the lock vanished mid-inspection — falls through to the deadline and
          // the sleep. `continue`ing on those instead was an unbounded HOT spin: no refusal ever fired,
          // and because the spinning call sits inside the in-process chain, every later write to that
          // path queued behind it forever with no cancellation path.
          if (await breakDeadLock(lockPath, staleMs)) continue;
          if (Date.now() > deadline) throw new ConfigError("ConfigLocked", "config target is locked by another writer");
          await new Promise((r) => setTimeout(r, 25));
        }
      }
    } catch (e) {
      await unlink(join(stagePath, nonce)).catch(() => {});
      await rmdir(stagePath).catch(() => {});
      throw e;
    }
    // Held. The lease is refreshed from a timer, so the common stall — a critical section waiting on slow
    // I/O — keeps the lock without the holder doing anything. `unref` so a lock never keeps a process
    // alive past its work; while real work is in flight the loop is alive and the timer fires.
    let lost = false;
    const touch = async (): Promise<void> => {
      const now = new Date();
      // Only a marker that is GONE means eviction. A transient utimes failure just skips one refresh —
      // treating it as eviction would fail a write for a hiccup, which is the opposite of the point.
      await utimes(markerPath, now, now).catch((e) => { if (errnoOf(e) === "ENOENT") lost = true; });
    };
    const beat = setInterval(() => { void touch(); }, Math.max(50, Math.floor(staleMs / 3)));
    beat.unref?.();
    /** Asserts, at the caller's chosen instant, that this process still owns the lock — and refreshes the
     *  lease while it is there, so the margin AFTER a successful fence is a full `staleMs` rather than
     *  whatever was left of it. That margin is what makes the check safe despite not being atomic with
     *  the commit it guards: no other process may break a lease it has just seen refreshed. */
    const fence = async (): Promise<void> => {
      const names = lost ? null : await readdir(lockPath).catch(() => null);
      if (names === null || names.length !== 1 || names[0] !== nonce) { lost = true; throw new ConfigError("ConfigLocked", LOCK_BROKEN); }
      // THE REFRESH IS THE SECOND HALF OF THE CHECK, not a courtesy after it (fix wave G / G1). `touch`
      // reports eviction by SETTING `lost` and RESOLVING — it must, because a transient `utimes` failure has
      // to be survivable — so a fence that ignored its outcome had a hole exactly one syscall wide: the
      // `readdir` above sees this writer's own marker, a stale-lock breaker unlinks it before the `utimes`
      // lands, `lost` becomes true, and the fence returns `ok` anyway. The caller then read its version and
      // renamed, which is an EVICTED owner and its successor committing from the same version — the
      // lost-update class this whole lock exists to eliminate, re-entered through its own guard.
      //   Note what makes the window real rather than theoretical: eviction is what happens to a holder that
      // cannot refresh, and a holder that cannot refresh is one whose event loop or fs threadpool is stalled
      // — which is also what stretches this window from microseconds to hundreds of milliseconds. The two
      // are the SAME condition, so the gap is widest exactly when it is likeliest to be entered.
      await touch();
      if (lost) throw new ConfigError("ConfigLocked", LOCK_BROKEN);
    };
    try { return await fn(fence); }
    finally {
      clearInterval(beat);
      // Release is ownership-scoped BY CONSTRUCTION, not by a read-then-check: the only marker we can
      // name is our own, and `rmdir` refuses the moment a successor has claimed the directory. An
      // overrun owner therefore cannot delete its successor's lock even in principle.
      await unlink(markerPath).catch(() => {});
      await rmdir(lockPath).catch(() => {});
    }
  });
  chains.set(filePath, run);
  run.finally(() => { if (chains.get(filePath) === run) chains.delete(filePath); }).catch(() => {});
  return run as Promise<T>;
}

/** One inspection of a lock we could not take. Answers whether something was actually REMOVED, because
 *  that is the only outcome allowed to skip the retry budget. It never removes a claim whose lease is
 *  alive, and it cannot remove a claim other than the one it inspected. */
async function breakDeadLock(lockPath: string, staleMs: number): Promise<boolean> {
  let names: string[];
  try { names = await readdir(lockPath); }
  catch (e) {
    // ENOTDIR: something that is not a directory holds the path — a lock written by a build older than
    // D-M5-24, or a file another tool left behind. It carries no lease, and reading its bytes is exactly
    // what used to wedge under a hostile umask, so it is broken on AGE alone: the only guarantee the
    // format it belongs to ever made. Leaving it would dead-end every future write to this target.
    if (errnoOf(e) === "ENOTDIR") {
      const st = await stat(lockPath).catch(() => null);
      if (st === null || Date.now() - st.mtimeMs <= staleMs) return false;
      return await unlink(lockPath).then(() => true, () => false);
    }
    return false; // ENOENT (it went away mid-inspection) or EACCES — the retried rename is the answer
  }
  // An EMPTY lock directory is nobody's claim: a break or a release is mid-flight, or a process died
  // between the two halves of one. A claim is renamed in fully formed, so it is never empty, and `rmdir`
  // cannot touch one. (`rename` over an empty directory succeeds anyway; this is for the filesystems
  // where it does not, and it keeps an abandoned husk from outliving its owner.)
  if (names.length === 0) return await rmdir(lockPath).then(() => true, () => false);
  const st = await stat(join(lockPath, names[0])).catch(() => null);
  if (st === null || Date.now() - st.mtimeMs <= staleMs) return false; // the lease is alive: a LIVE holder
  const unlinked = await unlink(join(lockPath, names[0])).then(() => true, () => false);
  const removed = await rmdir(lockPath).then(() => true, () => false);
  return unlinked || removed;
}
