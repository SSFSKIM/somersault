// src/appserver/configLayers.ts — the settings-files layer chain (spec M5 rev 3, D-M5-1/5).
// Merge semantics are UPSTREAM'S OWN (Claude Code Src settings.ts): lodash-style deep merge; arrays
// concatenate and dedupe with lodash `uniq` semantics — SameValueZero identity, so two structurally
// equal PARSED objects both survive (plan review F2: a structural dedupe silently ate hook entries).
// Origins are tracked THROUGH the merge and a replacement resets the replaced subtree's contributors
// — post-hoc accumulation falsely attributed layers whose values were discarded.
import { readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";

export type LayerName = "user" | "project" | "local" | "managed";
export interface ConfigLayer { name: LayerName; filePath: string; config?: Record<string, unknown>; raw?: string; disabledReason?: string }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Precedence order (lowest→highest): user < project < local < managed. `managedSettingsPath: null`
 *  (win32 — spec: Windows managed paths are out of this file-backed view) omits the layer. */
export function layerPaths(homeDir: string, managedSettingsPath: string | null, cwd?: string): Array<{ name: LayerName; filePath: string }> {
  const out: Array<{ name: LayerName; filePath: string }> = [{ name: "user", filePath: join(homeDir, ".claude", "settings.json") }];
  if (cwd) {
    out.push({ name: "project", filePath: join(cwd, ".claude", "settings.json") });
    out.push({ name: "local", filePath: join(cwd, ".claude", "settings.local.json") });
  }
  if (managedSettingsPath !== null) out.push({ name: "managed", filePath: managedSettingsPath });
  return out;
}

/** Absent file = absent layer. BOM stripped and a blank file is an EMPTY layer (upstream's loader does
 *  both); unparseable/non-object = a `disabledReason` entry with `raw` retained (the CAS token is a
 *  hash of bytes, and a client deserves the token even for a file it must fix). */
export async function readLayers(
  paths: Array<{ name: LayerName; filePath: string }>,
  deps: { readFile: (p: string) => Promise<string> } = { readFile: (p) => fsReadFile(p, "utf8") },
): Promise<ConfigLayer[]> {
  const out: ConfigLayer[] = [];
  for (const { name, filePath } of paths) {
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

/** lodash `uniq` semantics: SameValueZero on primitives; object/array entries are identity-compared,
 *  and two entries fresh from JSON.parse are never identical, so they all survive. */
const uniqSVZ = (a: unknown[]): unknown[] => {
  const prim = new Set<unknown>(); const out: unknown[] = [];
  for (const x of a) {
    if (typeof x === "object" && x !== null) { out.push(x); continue; }
    if (prim.has(x)) continue;
    prim.add(x); out.push(x);
  }
  return out;
};

export function settingsMerge(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) return uniqSVZ([...target, ...source]);
  if (isPlainObject(target) && isPlainObject(source)) {
    const out: Record<string, unknown> = { ...target };
    for (const [k, v] of Object.entries(source)) out[k] = Object.prototype.hasOwnProperty.call(out, k) ? settingsMerge(out[k], v) : v;
    return out;
  }
  return source;
}

/** Merge one layer in while maintaining per-leaf contributor lists. `origins` keys are dotted paths of
 *  LEAVES of the running effective config; a replacement deletes every entry under the replaced path
 *  before claiming it. */
function mergeTracked(target: Record<string, unknown>, source: Record<string, unknown>, layer: LayerName, origins: Map<string, LayerName[]>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const existing = Object.prototype.hasOwnProperty.call(out, k) ? out[k] : undefined;
    if (isPlainObject(existing) && isPlainObject(v)) { out[k] = mergeTracked(existing, v, layer, origins, path); continue; }
    if (Array.isArray(existing) && Array.isArray(v)) {
      out[k] = uniqSVZ([...existing, ...v]);
      const list = origins.get(path) ?? [];
      if (!list.includes(layer)) list.push(layer);
      origins.set(path, list);
      continue;
    }
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
