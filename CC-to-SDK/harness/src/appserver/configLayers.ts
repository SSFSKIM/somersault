// src/appserver/configLayers.ts — the settings-files layer chain (spec M5 rev 3, D-M5-1/5).
// Merge semantics are UPSTREAM'S OWN (Claude Code Src settings.ts): lodash-style deep merge; arrays
// concatenate and dedupe with lodash `uniq` semantics — SameValueZero identity, so two structurally
// equal PARSED objects both survive (plan review F2: a structural dedupe silently ate hook entries).
// Origins are tracked THROUGH the merge and a replacement resets the replaced subtree's contributors
// — post-hoc accumulation falsely attributed layers whose values were discarded.
import { readFile as fsReadFile, readdir as fsReaddir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";

export type LayerName = "user" | "project" | "local" | "managed";
export interface ConfigLayer { name: LayerName; filePath: string; config?: Record<string, unknown>; raw?: string; disabledReason?: string }
/** A path to read, or — for the one source that is a DIRECTORY listing rather than a file — a reason it
 *  could not be listed. `readLayers` passes such an entry straight through as a disabled layer. */
export interface LayerPath { name: LayerName; filePath: string; disabledReason?: string }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export interface LayerPathDeps { readdir: (p: string) => Promise<Dirent[]> }
const defaultLayerPathDeps: LayerPathDeps = { readdir: (p) => fsReaddir(p, { withFileTypes: true }) };

/** The managed layer is a FAMILY of files, not one file: `managed-settings.json` first, then every
 *  `managed-settings.d/*.json` sorted alphabetically merged on top — the systemd/sudoers drop-in shape,
 *  so independent teams can ship policy fragments without editing one admin-owned file. Ungated in the
 *  shipped SDK 0.3.234 bundle and in the reference's `loadManagedFileSettings`; a config domain that
 *  reads only the base file computes its masking verdicts on a managed machine WITHOUT the active policy.
 *
 *  The filter is upstream's: regular files and symlinks, `.json` suffix, no dotfiles. So is the tolerance
 *  for a missing directory (ENOENT/ENOTDIR — the ordinary case on every unmanaged machine). Anything else
 *  is a policy source that exists and could not be read, and that is reported as a disabled layer rather
 *  than as "no drop-ins": absence and unreadability are the one pair this milestone must never collapse. */
async function managedDropInPaths(managedSettingsPath: string, deps: LayerPathDeps): Promise<LayerPath[]> {
  const dir = join(dirname(managedSettingsPath), "managed-settings.d");
  let entries: Dirent[];
  try { entries = await deps.readdir(dir); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    return [{ name: "managed", filePath: dir, disabledReason: `managed drop-in directory could not be read: ${(e as Error).message ?? String(e)}` }];
  }
  return entries
    .filter((d) => (d.isFile() || d.isSymbolicLink()) && d.name.endsWith(".json") && !d.name.startsWith("."))
    .map((d) => d.name).sort()
    .map((name) => ({ name: "managed" as const, filePath: join(dir, name) }));
}

/** Precedence order (lowest→highest): user < project < local < managed. `managedSettingsPath: null`
 *  (win32 — spec: Windows managed paths are out of this file-backed view) omits the layer.
 *
 *  `userConfigDir` is the `.claude` DIRECTORY itself, not the home directory above it: `CLAUDE_CONFIG_DIR`
 *  replaces that directory outright (`config/claudeHome.ts`), so a home-shaped parameter cannot express
 *  where a user who exports it actually keeps settings. */
export async function layerPaths(userConfigDir: string, managedSettingsPath: string | null, cwd?: string, deps: LayerPathDeps = defaultLayerPathDeps): Promise<LayerPath[]> {
  const out: LayerPath[] = [{ name: "user", filePath: join(userConfigDir, "settings.json") }];
  if (cwd) {
    out.push({ name: "project", filePath: join(cwd, ".claude", "settings.json") });
    out.push({ name: "local", filePath: join(cwd, ".claude", "settings.local.json") });
  }
  if (managedSettingsPath !== null) {
    out.push({ name: "managed", filePath: managedSettingsPath });
    out.push(...await managedDropInPaths(managedSettingsPath, deps));
  }
  return out;
}

/** Absent file = absent layer. BOM stripped and a blank file is an EMPTY layer (upstream's loader does
 *  both); unparseable/non-object = a `disabledReason` entry with `raw` retained (the CAS token is a
 *  hash of bytes, and a client deserves the token even for a file it must fix). */
export async function readLayers(
  paths: LayerPath[],
  deps: { readFile: (p: string) => Promise<string> } = { readFile: (p) => fsReadFile(p, "utf8") },
): Promise<ConfigLayer[]> {
  const out: ConfigLayer[] = [];
  for (const { name, filePath, disabledReason } of paths) {
    // Already known unreadable before any file was named — a drop-in DIRECTORY that could not be listed.
    if (disabledReason !== undefined) { out.push({ name, filePath, disabledReason }); continue; }
    let raw: string;
    try { raw = await deps.readFile(filePath); }
    catch (e) { if ((e as NodeJS.ErrnoException)?.code === "ENOENT") continue; out.push({ name, filePath, disabledReason: String((e as Error).message ?? e) }); continue; }
    const body = raw.replace(/^﻿/, "");
    if (body.trim() === "") { out.push({ name, filePath, config: {}, raw }); continue; }
    try {
      const parsed: unknown = JSON.parse(body);
      if (!isPlainObject(parsed)) { out.push({ name, filePath, raw, disabledReason: "settings file is not a JSON object" }); continue; }
      out.push({ name, filePath, config: parsed, raw });
    } catch (e) { out.push({ name, filePath, raw, disabledReason: `invalid JSON: ${(e as Error).message}` }); }
  }
  return out;
}

/** lodash `uniq` semantics for the values that reach us: primitives dedupe by SameValueZero; object and
 *  array entries are pushed unconditionally and never dedupe — not even against their own reference.
 *  That is a deliberate simplification of lodash (which WOULD collapse a repeated reference): entries
 *  here come fresh from JSON.parse, so no two are ever identical and the identity check can't fire. */
const uniqSVZ = (a: unknown[]): unknown[] => {
  const prim = new Set<unknown>(); const out: unknown[] = [];
  for (const x of a) {
    if (typeof x === "object" && x !== null) { out.push(x); continue; }
    if (prim.has(x)) continue;
    prim.add(x); out.push(x);
  }
  return out;
};

/** The source keys a merge may carry, which is every own key EXCEPT `__proto__`.
 *
 *  Not a hardening bolted onto upstream's semantics — it IS upstream's semantics, measured at both steps
 *  of its pipeline: every settings file is validated by `SettingsSchema()` before lodash sees it, and zod's
 *  object build drops an own `__proto__` whatever its value (measured on zod 4.4.3, the reference's pin);
 *  lodash's own `safeGet` then drops it a second time for object values. So the engine's effective settings
 *  never carry the key, and a view that reported one would be describing a config no engine has.
 *
 *  It is also what keeps a merge from reassigning the accumulator's PROTOTYPE: `out[k] = v` on that key
 *  invokes `Object.prototype`'s setter, which is how `origins` came to name `__proto__.polluted` for a leaf
 *  `config` did not carry — attribution recorded for a key the very same statement had failed to create.
 *  `constructor` and `prototype` are NOT screened here: upstream keeps them (lodash's `constructor` rule
 *  fires only for function values, which JSON cannot produce), and assigning either is an ordinary own
 *  property that shadows harmlessly. The WRITE side refuses all three as input (D-M5-12a) — a different
 *  question, asked of a client rather than of a file already on disk. */
const mergeableEntries = (source: Record<string, unknown>): Array<[string, unknown]> =>
  Object.entries(source).filter(([k]) => k !== "__proto__");

/** UPSTREAM-EXACT for the mixed shapes, which is not the obvious answer for one of them: an OBJECT merged
 *  over an ARRAY keeps the array (lodash walks the source's keys onto the array itself), so a numeric key
 *  patches an element, a numeric key past the end extends with holes, and a non-index key becomes a
 *  property JSON never shows. Measured against real lodash 4.18.1 with upstream's own customizer. Ours
 *  used to return the object, so `config/read` served `{"PreToolUse":1}` where the engine holds
 *  `["x","y"]`. The reverse (an array over an object) really is a replacement, and always agreed. */
export function settingsMerge(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) return uniqSVZ([...target, ...source]);
  if (Array.isArray(target) && isPlainObject(source)) {
    const out = [...target] as unknown[];
    const bag = out as unknown as Record<string, unknown>;
    for (const [k, v] of mergeableEntries(source)) bag[k] = Object.prototype.hasOwnProperty.call(out, k) ? settingsMerge(bag[k], v) : v;
    return out;
  }
  if (isPlainObject(target) && isPlainObject(source)) {
    const out: Record<string, unknown> = { ...target };
    for (const [k, v] of mergeableEntries(source)) out[k] = Object.prototype.hasOwnProperty.call(out, k) ? settingsMerge(out[k], v) : v;
    return out;
  }
  return source;
}

/** Merge one layer in while maintaining per-leaf contributor lists. `origins` keys are dotted paths of
 *  LEAVES of the running effective config; a replacement deletes every entry under the replaced path
 *  before claiming it. */
function mergeTracked(target: Record<string, unknown>, source: Record<string, unknown>, layer: LayerName, origins: Map<string, LayerName[]>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  const claimArray = (path: string): void => {
    const list = origins.get(path) ?? [];
    if (!list.includes(layer)) list.push(layer);
    origins.set(path, list);
  };
  for (const [k, v] of mergeableEntries(source)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const existing = Object.prototype.hasOwnProperty.call(out, k) ? out[k] : undefined;
    if (isPlainObject(existing) && isPlainObject(v)) { out[k] = mergeTracked(existing, v, layer, origins, path); continue; }
    if (Array.isArray(existing) && Array.isArray(v)) { out[k] = uniqSVZ([...existing, ...v]); claimArray(path); continue; }
    // An object over an array is NOT a replacement upstream — the array survives and the object's keys are
    // walked onto it (`settingsMerge`). So this is an array contributor like the branch above, and the
    // object's own keys get no `origins` entries of their own: the ones JSON shows are array ELEMENTS,
    // addressed at this path, and the rest are properties no reader of this reply can ever see.
    if (Array.isArray(existing) && isPlainObject(v)) { out[k] = settingsMerge(existing, v); claimArray(path); continue; }
    // Replacement (new key, scalar-over-X, or type change): the discarded value's leaves are no longer
    // in the effective view — reset every contributor at or under this path, then claim it.
    for (const key of [...origins.keys()]) if (key === path || key.startsWith(path + ".")) origins.delete(key);
    if (isPlainObject(v)) { out[k] = mergeTracked({}, v, layer, origins, path); }
    else { out[k] = v; origins.set(path, [layer]); }
  }
  return out;
}

export function effectiveView(layers: ConfigLayer[]): { config: Record<string, unknown>; origins: Record<string, LayerName | LayerName[]> } {
  let config: Record<string, unknown> = {};
  const tracked = new Map<string, LayerName[]>();
  for (const layer of layers) { if (layer.config) config = mergeTracked(config, layer.config, layer.name, tracked, ""); }
  const origins: Record<string, LayerName | LayerName[]> = {};
  // Dotted re-walk is a REPORTING convenience: a key containing a literal dot can mis-split and the
  // entry is simply dropped from origins — the write side never round-trips these paths (D-M5-12).
  const leafValue = (path: string): unknown => path.split(".").reduce<unknown>((n, seg) => (isPlainObject(n) ? n[seg] : undefined), config);
  for (const [path, list] of tracked) {
    const v = leafValue(path);
    if (v === undefined) continue;
    origins[path] = Array.isArray(v) ? list : list[list.length - 1];
  }
  return { config, origins };
}
