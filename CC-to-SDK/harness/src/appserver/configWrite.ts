// src/appserver/configWrite.ts — write primitives (spec D-M5-13/14 rev 3; plan review F3/F4/F14/F20).
// The version check is ATOMIC WITH THE WRITE: callers run read→validate→apply→write inside
// withFileLock, which stacks an in-process per-path chain (two requests in this server) UNDER a
// NONCE-OWNED <file>.lock (two servers on this machine). The nonce is the ownership proof: release
// unlinks only its own, and a stale break only removes a lock read as stale-and-stable — rev 1's
// pid-stamp-never-read lock could be stolen mid-hold and then unlink its thief's lock.
import { readFile, writeFile, rename, unlink, stat, mkdir, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { settingsMerge } from "./configLayers.js";

export class ConfigError extends Error {
  constructor(public code: "ConfigVersionConflict" | "ConfigValidationError", message: string) { super(message); }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** D-M5-13 exactly: replace sets (null deletes); upsert deep-merges with the READ side's customizer
 *  (null refuses); parents created as objects; a non-object parent refuses with the doc untouched.
 *  The three prototype segments refuse outright (D-M5-12 rev 3) and every lookup is own-property —
 *  an opaque-segment contract must not be a pollution channel. Pure — returns a new doc. */
export function applyEdit(doc: Record<string, unknown>, keyPath: string[], value: unknown, strategy: "replace" | "upsert"): Record<string, unknown> {
  if (keyPath.length === 0) throw new ConfigError("ConfigValidationError", "keyPath must not be empty");
  for (const seg of keyPath) if (FORBIDDEN.has(seg)) throw new ConfigError("ConfigValidationError", `keyPath segment "${seg}" is not writable`);
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
  let parsed: unknown;
  try { parsed = JSON.parse(raw.replace(/^﻿/, "")); }
  catch { throw new ConfigError("ConfigValidationError", "target settings file is not valid JSON; fix it before writing through this API"); }
  if (!isPlainObject(parsed)) throw new ConfigError("ConfigValidationError", "target settings file is not a JSON object");
  return { doc: parsed, version: versionToken(raw) };
}

/** Parent created; a symlinked settings file resolves so tmp+rename replaces the REAL file, never the
 *  link (plan review F14 — silently detaching managed symlinks). */
export async function resolveRealTarget(filePath: string): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true });
  try { return await realpath(filePath); } catch { return filePath; }
}

export async function writeTargetDoc(filePath: string, doc: Record<string, unknown>): Promise<{ version: string }> {
  await mkdir(dirname(filePath), { recursive: true });
  const bytes = JSON.stringify(doc, null, 2) + "\n";
  const tmp = `${filePath}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  await writeFile(tmp, bytes, "utf8");
  await rename(tmp, filePath);
  return { version: versionToken(bytes) };
}

const chains = new Map<string, Promise<unknown>>();

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
        try {
          const s = await stat(lockPath);
          if (Date.now() - s.mtimeMs > staleMs) {
            // stale AND stable: only unlink when two reads agree — never a lock whose content moved.
            const seen = await readFile(lockPath, "utf8").catch(() => null);
            const again = await readFile(lockPath, "utf8").catch(() => null);
            if (seen !== null && seen === again) await unlink(lockPath).catch(() => {});
            continue;
          }
        } catch { continue; }
        if (Date.now() > deadline) throw new ConfigError("ConfigValidationError", "config target is locked by another writer");
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
