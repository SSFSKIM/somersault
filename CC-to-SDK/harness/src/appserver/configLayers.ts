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
/** `raw` is the file's BYTES, not its decoded text (fix wave H / H3): the CAS token it feeds is defined as
 *  the sha256 of the bytes on disk, and a `string` here is a decode the hash can never undo — two files
 *  differing only in invalid UTF-8 decode alike and were minted one token for two files. */
export interface ConfigLayer { name: LayerName; filePath: string; config?: Record<string, unknown>; raw?: Buffer; disabledReason?: string }
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
  deps: { readFile: (p: string) => Promise<Buffer> } = { readFile: (p) => fsReadFile(p) },
): Promise<ConfigLayer[]> {
  const out: ConfigLayer[] = [];
  for (const { name, filePath, disabledReason } of paths) {
    // Already known unreadable before any file was named — a drop-in DIRECTORY that could not be listed.
    if (disabledReason !== undefined) { out.push({ name, filePath, disabledReason }); continue; }
    let raw: Buffer;
    try { raw = await deps.readFile(filePath); }
    catch (e) { if ((e as NodeJS.ErrnoException)?.code === "ENOENT") continue; out.push({ name, filePath, disabledReason: String((e as Error).message ?? e) }); continue; }
    const body = raw.toString("utf8").replace(/^﻿/, "");
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

/** An own key that addresses an array ELEMENT, hoisted above `settingsMerge` because the bound below has to
 *  recognise one. `"01"`, `"1.0"`, `"-1"` and `" 1"` are properties, not indexes — `settingsMerge` assigns
 *  them, and they ride the array exactly as `PreToolUse` does, WITHOUT moving `length`. */
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

/** The merge's own refusal (fix wave G / G5). Not a `ConfigError`: this module knows nothing about wire
 *  codes and must not — `configWrite.ts` owns that class and imports THIS file, so the dependency only runs
 *  one way. `configDomain.ts` assigns the code, exactly as it does for the store's typed refusals. */
export class SettingsMergeError extends Error {}

/** An object merged over an array patches it BY INDEX, and an index past the end extends it with holes —
 *  upstream's own lodash behaviour, and `settingsMerge` reproduces it deliberately. What upstream never has
 *  to survive is the same array being SERIALIZED onto a wire afterwards. One key of `"100000000"` makes the
 *  array 100,000,001 slots long, and `config/read` then hands `JSON.stringify` a sparse array that renders
 *  as 500 MB of `null,` — measured at 5.2 s of blocked event loop for that one key, 1.5 s for `"30000000"`,
 *  and at the 32-bit ceiling (`"4294967294"`) `JSON.stringify` throws `RangeError: Invalid string length`,
 *  which reaches the client as an internal error for a shape it supplied. All of it happens BEFORE `Peer`
 *  can weigh the buffered output, so the pressure gate that exists for exactly this cannot fire.
 *
 *  So an index may PATCH any existing element for free, and may EXTEND the array only within a bound. 65536
 *  is chosen against what a settings array is: `permissions.allow` in the largest real policy is a few
 *  thousand rules, and the bound is an order of magnitude past that while a 65536-slot array serializes in
 *  a few milliseconds. It applies to this branch ALONE — array-over-array concatenation is untouched, so a
 *  legitimately long array assembled the ordinary way is unaffected, and only the shape whose cost is
 *  wildly out of proportion to its input is refused.
 *
 *  Both origins reach it and both should: a client's `upsert` (refused as a bad parameter) and a settings
 *  file already on disk (refused as a file to go fix — the same answer `readTargetDoc` gives unparseable
 *  bytes). The engine's own lodash would build the same array, so a view that reported it would be
 *  describing a config no engine can actually serve either. */
const MAX_MERGE_ARRAY_LENGTH = 65_536;
function assertIndexInBounds(key: string, length: number): void {
  if (!ARRAY_INDEX.test(key)) return;                       // a property, not an index: `length` never moves
  const i = Number(key);
  if (i < length || i < MAX_MERGE_ARRAY_LENGTH) return;     // patches an element, or extends within bounds
  throw new SettingsMergeError(`an object merged over an array may not extend it past ${MAX_MERGE_ARRAY_LENGTH} entries (index "${key}")`);
}

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
    for (const [k, v] of mergeableEntries(source)) {
      assertIndexInBounds(k, out.length);
      bag[k] = Object.prototype.hasOwnProperty.call(out, k) ? settingsMerge(bag[k], v) : v;
    }
    return out;
  }
  if (isPlainObject(target) && isPlainObject(source)) {
    const out: Record<string, unknown> = { ...target };
    for (const [k, v] of mergeableEntries(source)) out[k] = Object.prototype.hasOwnProperty.call(out, k) ? settingsMerge(out[k], v) : v;
    return out;
  }
  return source;
}

/** Does anything `target` holds still SHOW once `source` is merged over it by `settingsMerge`? The
 *  question a contributor list has to answer for the lower layers, and the one that used to be assumed.
 *
 *  It mirrors `settingsMerge`'s own three branches, so it cannot drift from what the merge actually does:
 *  concatenation keeps everything (any element at all survives), an object over an array or over an
 *  object keeps whatever the source does not cover — and where it does cover a key, the same question is
 *  asked one level down, because an object merged onto an object element does not displace it. Anything
 *  else is a replacement, and nothing of the target survives it.
 *
 *  Only `mergeableEntries` counts as coverage: `__proto__` is never applied, so it can never displace. */
function survivesMerge(target: unknown, source: unknown): boolean {
  if (Array.isArray(target) && Array.isArray(source)) return target.length > 0;
  if (Array.isArray(target) && isPlainObject(source)) {
    const covered = new Map(mergeableEntries(source));
    return target.some((el, i) => !covered.has(String(i)) || survivesMerge(el, covered.get(String(i))));
  }
  if (isPlainObject(target) && isPlainObject(source)) {
    const covered = new Map(mergeableEntries(source));
    return Object.keys(target).some((k) => !covered.has(k) || survivesMerge(target[k], covered.get(k)));
  }
  return false;
}

/** Merge one layer in while maintaining per-leaf contributor lists. `origins` keys are dotted paths of
 *  LEAVES of the running effective config; a replacement deletes every entry under the replaced path
 *  before claiming it. */
function mergeTracked(target: Record<string, unknown>, source: Record<string, unknown>, layer: LayerName, origins: Map<string, LayerName[]>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  /** ONE array-contributor step, for both array branches. A contributor list is a claim about what is
   *  SERVED at this path, so each side is asked its own question and neither answer is assumed:
   *  `lowerSurvives` keeps the layers already there, `sourceShows` adds this one. Both were assumed true
   *  before, and both directions of that were wrong on a real settings shape. A source that shows nothing
   *  (only NON-index keys, which ride the array as properties JSON never serializes) named a layer whose
   *  contribution no reader of this reply can see — B4's cosmetic over-attribution. A source that
   *  displaces every element the array had (index keys covering all of them) left the lower layer in the
   *  list, and `maskingVerdict` decides "is my write in force?" by MEMBERSHIP of that list — so a
   *  `config/value/write` whose value a higher layer had completely replaced was reported `ok`, in force,
   *  while `config/read` served the higher layer's value at the same path. Both methods derive from this
   *  one map, which is what makes their agreement structural; an over-attribution here is therefore not
   *  cosmetic on the write side, it is a wrong verdict.
   *
   *  Neither surviving is possible only for two empty arrays, where the path serves `[]` and no layer put
   *  anything in it; the last writer is named, which is what a scalar replacement would answer too. */
  const claimArray = (path: string, lowerSurvives: boolean, sourceShows: boolean): void => {
    const list = lowerSurvives ? (origins.get(path) ?? []) : [];
    if ((sourceShows || list.length === 0) && !list.includes(layer)) list.push(layer);
    origins.set(path, list);
  };
  for (const [k, v] of mergeableEntries(source)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const existing = Object.prototype.hasOwnProperty.call(out, k) ? out[k] : undefined;
    if (isPlainObject(existing) && isPlainObject(v)) { out[k] = mergeTracked(existing, v, layer, origins, path); continue; }
    // Concatenation: every element of both sides survives (`uniqSVZ` collapses equal primitives, which
    // leaves the element jointly theirs), so each side contributes exactly when it has an element to give.
    if (Array.isArray(existing) && Array.isArray(v)) { out[k] = uniqSVZ([...existing, ...v]); claimArray(path, existing.length > 0, v.length > 0); continue; }
    // An object over an array is NOT a replacement upstream — the array survives and the object's keys are
    // walked onto it (`settingsMerge`). So this is an array contributor like the branch above, and the
    // object's own keys get no `origins` entries of their own: the ones JSON shows are array ELEMENTS,
    // addressed at this path, and the rest are properties no reader of this reply can ever see. Which is
    // also why only an INDEX key counts as this layer showing, and why a source that covers every index
    // takes the path over outright.
    if (Array.isArray(existing) && isPlainObject(v)) { out[k] = settingsMerge(existing, v); claimArray(path, survivesMerge(existing, v), mergeableEntries(v).some(([key]) => ARRAY_INDEX.test(key))); continue; }
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
