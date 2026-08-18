// src/appserver/configWrite.ts — write primitives (spec D-M5-13/14 rev 3; plan review F3/F4/F14/F20).
// The version check is ATOMIC WITH THE WRITE: callers run read→validate→apply→write inside
// withFileLock, which stacks an in-process per-path chain (two requests in this server) UNDER a
// NONCE-OWNED <file>.lock (two servers on this machine). The nonce is the ownership proof: release
// unlinks only its own, and a stale break only removes a lock read as stale-and-stable — rev 1's
// pid-stamp-never-read lock could be stolen mid-hold and then unlink its thief's lock.
import { readFile, writeFile, rename, unlink, stat, chmod, mkdir, realpath, lstat, readlink } from "node:fs/promises";
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

/** TWO cases only — bytes in, token out. The wire's THIRD token, "unreadable" (a settings file that is
 *  there but whose bytes never reached us), is minted by configDomain.ts's versions walk from LAYER
 *  state; it is not a property of any bytes, so it cannot be minted here. */
export function versionToken(bytes: string | null): string {
  return bytes === null ? "absent" : createHash("sha256").update(bytes).digest("hex");
}

export async function readTargetDoc(filePath: string): Promise<{ doc: Record<string, unknown>; version: string }> {
  let raw: string;
  try { raw = await readFile(filePath, "utf8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { doc: {}, version: "absent" };
    // The write-side half of Task 2 review I1: a target that EXISTS but could not be read (EACCES on a
    // write-only settings file, EISDIR on a directory at the path) is refused as a validation failure,
    // not leaked as an internal error — never write bytes over bytes we were never able to see.
    throw new ConfigError("ConfigValidationError", `target settings file could not be read: ${(e as Error).message ?? String(e)}`);
  }
  const body = raw.replace(/^﻿/, "");
  // A blank (or BOM-only) file is an EMPTY doc, exactly as `readLayers` already treats it — upstream's
  // loader does too (review I2). Sending it to JSON.parse instead made `config/read` report the file
  // healthy while every write against it refused forever, with no way out through the API. The token is
  // the hash of the real bytes, NOT "absent": the file exists, and a CAS check must be able to see it.
  if (body.trim() === "") return { doc: {}, version: versionToken(raw) };
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new ConfigError("ConfigValidationError", "target settings file is not valid JSON; fix it before writing through this API"); }
  if (!isPlainObject(parsed)) throw new ConfigError("ConfigValidationError", "target settings file is not a JSON object");
  return { doc: parsed, version: versionToken(raw) };
}

/** ONE spelling per settings file, wherever this domain names one — `resolveRealTarget`'s answer and
 *  `config/read`'s `layers[].filePath` alike (review I2). `realpath` answers only for a path that EXISTS,
 *  so a file resolved before and after its own creation came back under two different names — the literal
 *  one first, the canonical one after — and on macOS, where `/var` and `/tmp` are themselves symlinks,
 *  those two strings genuinely differ. A client could then correlate neither its own two write replies
 *  nor a write reply with a read reply, and the pre-creation spelling took a DIFFERENT `<file>.lock`.
 *
 *  So the deepest ANCESTOR that exists is canonicalized and the missing tail is rejoined onto it: the
 *  answer no longer depends on whether the leaf — or its parent directory — has been created yet. When
 *  not even the root resolves there is nothing to canonicalize and the literal path stands, which is also
 *  the answer for a dangling link pointing into a directory nobody has made (Task 3's own row). */
export async function canonicalPath(filePath: string): Promise<string> {
  const tail: string[] = [];
  for (let cur = filePath; ;) {
    const parent = dirname(cur);
    tail.unshift(basename(cur));
    try { return join(await realpath(parent), ...tail); } catch { /* the parent is missing too — climb */ }
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
 *  No `mkdir` here (review M3): `withFileLock` and `writeTargetDoc` each create the parent they need, and
 *  creating it during RESOLUTION meant a request refused between here and the write had already made a
 *  directory in a client-named location. */
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

/** 2-space JSON + trailing newline, installed by tmp+rename. The rename installs the TMP file's mode, so
 *  an existing target's mode is carried over first — settings files legitimately hold `env` values and
 *  `apiKeyHelper` paths, and without this the first write through this API turned a deliberate 0600 into
 *  the umask default 0644 (review I1). The tmp is CREATED at that mode instead of being repaired into it
 *  afterwards: the repair left the SAME private bytes sitting in the same directory at the umask default
 *  for the length of the write (measured — a 0600 settings file's tmp observed at 644 mid-write). The
 *  chmod stays, because `writeFile`'s `mode` is umask-masked and can only land NARROWER than asked, so
 *  it is the chmod that actually installs the destination's mode. A target that does not exist yet has
 *  no mode to carry and is created 0600 — its bytes are the same class of secret, and there is no later
 *  step that would narrow it. Anything that fails before the rename takes the tmp with it: nothing used
 *  to, so a failed rename (EISDIR against a directory at the path) parked those bytes on disk for good. */
export async function writeTargetDoc(filePath: string, doc: Record<string, unknown>): Promise<{ version: string }> {
  await mkdir(dirname(filePath), { recursive: true });
  const bytes = JSON.stringify(doc, null, 2) + "\n";
  const tmp = `${filePath}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  const mode = await stat(filePath).then((s) => s.mode & 0o7777, () => null);
  try {
    await writeFile(tmp, bytes, { encoding: "utf8", mode: mode ?? 0o600 });
    if (mode !== null) await chmod(tmp, mode);
    await rename(tmp, filePath);
  } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
  return { version: versionToken(bytes) };
}

const chains = new Map<string, Promise<unknown>>();

/** BLOCKS while a foreign lock is held, and the wait is the common outcome — not the refusal. A lock left
 *  behind by a dead writer is only breakable once it reads STALE (older than `staleMs`, 30s by default),
 *  so a contended call typically sits for the remainder of that window, breaks the leftover, and returns
 *  `ok`; `ConfigLocked` fires only when the lock cannot be unlinked or a live writer holds it past the
 *  deadline (`staleMs` + 5s). One number therefore sets both "when is a lock stale" and "how long do I
 *  wait" — a real seam, deliberately not split here (M5 review I3), so callers that surface this on a wire
 *  must say so: see configDomain.ts's `runConfigWrite`. */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>, opts: { staleMs?: number } = {}): Promise<T> {
  const staleMs = opts.staleMs ?? 30_000;
  const lockPath = `${filePath}.lock`;
  const nonce = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const prev = chains.get(filePath) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    await mkdir(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + staleMs + 5_000;
    for (;;) {
      try { await writeFile(lockPath, nonce, { flag: "wx" }); break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
        // ONLY a successful break may skip the retry budget (review C1). Every other outcome — the
        // unlink failed (an immutable lock, or a read-only directory: EPERM/EACCES), the lock's bytes
        // moved between the two reads, the lock vanished mid-inspection — falls through to the deadline
        // and the sleep. `continue`ing on those instead was an unbounded HOT spin: no refusal ever
        // fired, and because the spinning call sits inside the in-process chain, every later write to
        // that path queued behind it forever with no cancellation path.
        let broke = false;
        try {
          const s = await stat(lockPath);
          if (Date.now() - s.mtimeMs > staleMs) {
            // stale AND stable: only unlink when two reads agree — never a lock whose content moved.
            const seen = await readFile(lockPath, "utf8").catch(() => null);
            const again = await readFile(lockPath, "utf8").catch(() => null);
            if (seen !== null && seen === again) broke = await unlink(lockPath).then(() => true, () => false);
          }
        } catch { /* the lock vanished mid-inspection — the retried `wx` below is the answer */ }
        if (broke) continue;
        if (Date.now() > deadline) throw new ConfigError("ConfigLocked", "config target is locked by another writer");
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    try { return await fn(); }
    finally {
      const owner = await readFile(lockPath, "utf8").catch(() => null);
      if (owner === nonce) await unlink(lockPath).catch(() => {});
    }
  });
  chains.set(filePath, run);
  run.finally(() => { if (chains.get(filePath) === run) chains.delete(filePath); }).catch(() => {});
  return run as Promise<T>;
}
