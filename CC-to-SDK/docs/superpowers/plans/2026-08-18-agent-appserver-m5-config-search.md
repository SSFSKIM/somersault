# M5 — Config Domain + Thread Search/Archive Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven new app-server methods — `config/read`, `config/value/write`, `config/batchWrite`, `thread/search`, `thread/searchOccurrences`, `thread/archive`, `thread/unarchive` — plus two notifications and an `archived` filter on `thread/list`, per the **rev-3** spec `CC-to-SDK/docs/superpowers/specs/2026-08-18-agent-appserver-m5-config-search-design.md` (read it before Task 1; Decision Log D-M5-1..21 is binding). This plan is rev 2: its rev 1 failed an adversarial review on 20 counts — the test harness, the CAS lock, the cursor convention, and the stage discipline in this revision are all corrections, so deviate from them knowingly or not at all.

**Architecture:** Four stages over the existing `src/appserver/` hub, **each stage ending with its scorecard rows landed and the drift gate green**: (A) config read — layer chain with upstream's exact merge, per-leaf origins tracked through the merge, CAS tokens served; (B) config writes — segment-array edits with prototype-safe access, nonce-owned lockfile CAS; (C) search + archive — marker store first, then tuple-keyset search with storage-windowed scans, epoch-qualified occurrence cursors, admission-coordinated archive; (D) absorb spikes + live acceptance + final verification.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), zod v4 (`zod/v4`), vitest, node:crypto/fs/path, the existing appserver spine (`Handler`, `ERR`, `peer.replyError(id, code, msg, data?)`, `broadcastServer`, `srv.connect` + `conn.feed` test harness).

## Global Constraints (verbatim from the rev-3 spec)

- Layer chain: **user** (`~/.claude/settings.json`) < **project** (`<cwd>/.claude/settings.json`) < **local** (`<cwd>/.claude/settings.local.json`) < **managed** (macOS `/Library/Application Support/ClaudeCode/managed-settings.json`, Linux `/etc/claude-code/managed-settings.json`, **omitted entirely on win32**; read-only; absent file = absent layer). BOM stripped; blank/whitespace-only file = empty layer. Full upstream `SettingsSchema` validation deliberately NOT mirrored (recorded deviation).
- Merge = upstream's: deep merge for objects, arrays **concatenate + lodash-`uniq` dedupe (SameValueZero — parsed objects NEVER dedupe)**; origins are dotted leaf paths **tracked through the merge and reset when a value is replaced**; array leaves name every contributing layer in precedence order.
- `config/read` always serves **`versions`** — target→CAS-token map for the writable targets in view (D-M5-18) — plus `incomplete: true`.
- `keyPath` is an array of string segments; the segments `__proto__`, `constructor`, `prototype` refuse `ConfigValidationError`; merge/edit uses own-property access throughout (D-M5-12 rev 3). Merge table (D-M5-13): `replace` sets the leaf; `upsert` deep-merges with the read-side customizer; missing parents created as objects; non-object parent → `ConfigValidationError`, file untouched; `replace`+`null` deletes; `upsert`+`null` refuses.
- Version token = sha256 hex of raw file bytes, `"absent"` for missing. CAS (D-M5-14 rev 3): per-file in-process queue + **nonce-owned** lockfile `<file>.lock` (pid+random nonce written into it; release unlinks only after re-reading its OWN nonce; stale break at 30s only for a lock read as stale-and-stable; never unlink a foreign live lock), held across read→validate→write-tmp→rename. `.claude/` parent created before locking; a symlinked target is `realpath`-resolved first. Contract scoped to this protocol's writers (external editors = last-wins, stated). Omitted `expectedVersion` = last-wins.
- Every supplied `cwd` canonicalized ONCE, before the lock — a refusal must leave the target byte-identical. No arbitrary `filePath` ever; `target ∈ user|project|local`, default user.
- Batch masking evaluates **every** edit: `okOverridden` when any is masked, `overriddenMetadata` = first masked, `maskedEditIndexes` lists them all. Unknown top-level keys → `warnings`, never refusal. Config errors ride `error.data.code ∈ ConfigVersionConflict|ConfigValidationError` on `-32602`.
- Search bounds (D-M5-17 rev 3): term 2–256 UTF-16 units; `limit` ≤ 50 **clamped with a `warning`** (the `thread/read` precedent); snippet ≤ **max(200, term length)**; ≤ 40 files / ≤ 4000 rows per page; row cap **1,048,576 UTF-16 units**; transcripts read in **row windows** (`getSessionMessages {offset, limit}`); one scan at a time per server; skipped rows counted in `skipped`.
- Cursor (D-M5-15 rev 3, ONE convention): `(sortValue, sessionId, rowIndex)` names the NEXT position; resume = first session whose `(sortValue, sessionId)` tuple is ≥ cursor's in the requested direction; `rowIndex` applies only when that session IS the cursor's. Sort tokens `created_at|updated_at|recency_at`; missing `createdAt` sorts last; tiebreak `sessionId` asc.
- Search honesty (D-M5-8): store read failure = error, never `[]`.
- Occurrences: fields `snippet`, `snippetMatchRange`, row `uuid`, `rowOffset`, `readCursor` = `"<epoch>:<rowOffset+1>"` live / `null` cold; the occurrence continuation cursor is **epoch-qualified on live threads** and refused on mismatch; **cold targets must exist** → `THREAD_NOT_FOUND` (D-M5-20).
- Archive (D-M5-3/10 rev 3): marker files `<ccxDir>/archived/<sessionId>`; create/unlink idempotent; live-guard checks registry **and `resumingSessions`**, re-checks after marker creation (unlink + BUSY on race); **admission auto-unarchives** (`thread/resume`, resume-carrying `thread/start`, `thread/attach` remove the marker + broadcast `thread/unarchived`, D-M5-21); archive of a store-unknown session → `THREAD_NOT_FOUND`; unarchive idempotent for any session with a marker or store row. Responses `{ok:true}`; notifications carry `{sessionId}`.
- `thread/searchOccurrences`, `thread/archive`, `thread/unarchive` join **`ENGINE_GONE_EXEMPT`** (`server.ts:185`).
- Response schemas: `MethodSchema` gains an optional **`result`** slot, emitted into the artifacts; the seven M5 methods declare theirs (D-M5-19).
- **Every stage boundary leaves `node ../scripts/drift-check.mjs` green** — rows + regenerated artifacts land per stage, not in a final docs task.
- Unit tests use the REAL harness: `srv.connect(sink)` + `conn.feed(initialize)` + JSON reply lines — `dispatch` is private and four-arg; copy the scaffolding from `test/unit/appserver/review-start.test.ts` (`mkSink`/`parsed`/`boot`/`send`/`addRecord`). No ad-hoc dispatch calls.
- House rules: dense hand-style, `.js` specifiers, DI-by-deps with call-site defaults, TDD, no `Co-Authored-By`. All commands run from `CC-to-SDK/harness/`.

## File Structure

- Create `src/appserver/configLayers.ts` — paths, BOM/blank-aware reads (+raw bytes), upstream merge with origins-through-merge.
- Create `src/appserver/configWrite.ts` — `ConfigError`, `applyEdit`, `versionToken`, nonce lockfile, doc IO.
- Create `src/appserver/configDomain.ts` — the three config handlers.
- Create `src/appserver/schema/config.ts` — params AND result schemas for the config trio.
- Create `src/appserver/searchScan.ts` — sort/tuple compare, cursor codecs, corpus text, snippet.
- Create `src/appserver/search.ts` — the two search handlers + exclusive-scan chain.
- Create `src/appserver/schema/search.ts` — params AND result schemas for the search pair.
- Create `src/appserver/archive.ts` — marker store + archive/unarchive handlers.
- Modify `src/appserver/schema/index.ts` (`MethodSchema.result` slot + 7 entries), `src/appserver/schema/emit.ts` (emit `result`), `src/appserver/schema/threads.ts` (`archived` on `threadListParams`), `src/appserver/sessionLib.ts` (export `resolveThreadId`/`findLiveBySessionId`; archived filter), `src/appserver/server.ts` (deps `configHome?`/`managedSettingsPath?`/`ccxDir?`/`getSessionInfo?`; handler entries; `ENGINE_GONE_EXEMPT` trio; admission auto-unarchive), `src/appserver/fleet.ts` (attach auto-unarchive).
- Create `probes/probes/111-context-usage-structured.ts`, `probes/probes/112-terminal-slash-commands.ts`.
- Create `test/unit/appserver/config-layers.test.ts`, `config-write.test.ts`, `config-domain.test.ts`, `search-scan.test.ts`, `search.test.ts`, `archive.test.ts`; `test/live/appserver-m5-acceptance.test.ts`.
- Modify `docs/parity/appserver.md` (rows land per stage), `docs/parity/coverage.md`; regen `harness/schema/json/*` per stage via `npm run emit-schema`.

---

## Stage A — config read (gate green at stage end)

### Task 1: Layer reading + upstream merge with origins-through-merge (`configLayers.ts`)

**Files:** Create `src/appserver/configLayers.ts` · Test `test/unit/appserver/config-layers.test.ts`

**Interfaces (later tasks rely on these exact signatures):**
- `type LayerName = "user" | "project" | "local" | "managed"`
- `interface ConfigLayer { name: LayerName; filePath: string; config?: Record<string, unknown>; raw?: string; disabledReason?: string }` — `raw` present iff the file was read (even when unparseable; the CAS token hashes it)
- `layerPaths(homeDir: string, managedSettingsPath: string | null, cwd?: string): Array<{ name: LayerName; filePath: string }>` — `null` managed path (win32) omits the layer
- `readLayers(paths, deps?): Promise<ConfigLayer[]>`
- `settingsMerge(target: unknown, source: unknown): unknown` — deep objects, arrays concat + **SameValueZero uniq (objects never dedupe)**, source wins scalars/type-changes
- `effectiveView(layers: ConfigLayer[]): { config: Record<string, unknown>; origins: Record<string, LayerName | LayerName[]> }` — origins tracked DURING the merge; a replacement (scalar-over-anything, type change) **resets** the replaced subtree's contributors

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/config-layers.test.ts
import { describe, it, expect } from "vitest";
import { layerPaths, readLayers, settingsMerge, effectiveView, type ConfigLayer } from "../../../src/appserver/configLayers.js";

const L = (name: ConfigLayer["name"], config?: Record<string, unknown>, disabledReason?: string): ConfigLayer =>
  ({ name, filePath: `/x/${name}.json`, ...(config ? { config } : {}), ...(disabledReason ? { disabledReason } : {}) });

describe("configLayers", () => {
  it("layerPaths: user+managed without cwd; all four with cwd; null managed (win32) omitted", () => {
    expect(layerPaths("/h", "/etc/m.json").map((p) => p.name)).toEqual(["user", "managed"]);
    const all = layerPaths("/h", "/etc/m.json", "/proj");
    expect(all.map((p) => p.name)).toEqual(["user", "project", "local", "managed"]);
    expect(all[0].filePath).toBe("/h/.claude/settings.json");
    expect(all[1].filePath).toBe("/proj/.claude/settings.json");
    expect(all[2].filePath).toBe("/proj/.claude/settings.local.json");
    expect(layerPaths("/h", null, "/proj").map((p) => p.name)).toEqual(["user", "project", "local"]);
  });
  it("settingsMerge: objects deep, scalars source-wins, arrays concat with SameValueZero uniq — parsed objects never dedupe", () => {
    expect(settingsMerge({ a: { x: 1 }, keep: 1 }, { a: { y: 2 } })).toEqual({ a: { x: 1, y: 2 }, keep: 1 });
    expect(settingsMerge({ p: ["A", "B"] }, { p: ["B", "C"] })).toEqual({ p: ["A", "B", "C"] });
    // structurally-equal OBJECT entries both survive (lodash uniq is identity-based; fresh parses never equal)
    expect(settingsMerge({ h: [{ m: "Bash" }] }, { h: [{ m: "Bash" }] })).toEqual({ h: [{ m: "Bash" }, { m: "Bash" }] });
    expect(settingsMerge({ m: "user" }, { m: "local" })).toEqual({ m: "local" });
    expect(settingsMerge(["A"], { o: 1 })).toEqual({ o: 1 });
  });
  it("effectiveView: deep merge with leaf origins; arrays name every contributor in order", () => {
    const { config, origins } = effectiveView([
      L("user", { permissions: { allow: ["WebFetch"] }, model: "opus" }),
      L("local", { permissions: { deny: ["Bash"] }, model: "sonnet" }),
    ]);
    expect(config).toEqual({ permissions: { allow: ["WebFetch"], deny: ["Bash"] }, model: "sonnet" });
    expect(origins["permissions.allow"]).toEqual(["user"]);
    expect(origins["permissions.deny"]).toEqual(["local"]);
    expect(origins["model"]).toBe("local");
  });
  it("effectiveView: a REPLACEMENT resets the replaced subtree's contributors", () => {
    const { config, origins } = effectiveView([
      L("user", { thing: { deep: ["A"] } }),   // object subtree from user…
      L("local", { thing: "flat" }),           // …replaced wholesale by a scalar in local
    ]);
    expect(config).toEqual({ thing: "flat" });
    expect(origins["thing"]).toBe("local");
    expect(origins["thing.deep"]).toBeUndefined(); // user's discarded leaf is NOT falsely attributed
  });
  it("readLayers: absent omitted; BOM stripped; blank file = empty layer; unparseable = disabledReason with raw retained", async () => {
    const files: Record<string, string> = {
      "/x/user.json": "﻿" + `{"model":"opus"}`, "/x/project.json": "   \n", "/x/local.json": `{not json`,
    };
    const deps = { readFile: async (p: string) => { if (p in files) return files[p]; const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; } };
    const layers = await readLayers([
      { name: "user", filePath: "/x/user.json" }, { name: "project", filePath: "/x/project.json" },
      { name: "local", filePath: "/x/local.json" }, { name: "managed", filePath: "/x/managed.json" },
    ], deps);
    expect(layers.map((l) => l.name)).toEqual(["user", "project", "local"]);
    expect(layers[0].config).toEqual({ model: "opus" });
    expect(layers[1].config).toEqual({});            // blank = empty layer, not disabled
    expect(layers[2].config).toBeUndefined();
    expect(layers[2].disabledReason).toMatch(/JSON/);
    expect(layers[2].raw).toBe(`{not json`);          // raw retained — the CAS token hashes bytes, not parses
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/appserver/config-layers.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run** — `npx vitest run test/unit/appserver/config-layers.test.ts` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** — `git add src/appserver/configLayers.ts test/unit/appserver/config-layers.test.ts && git commit -m "feat(as5): layer chain — upstream-exact merge, origins through the merge (Task 1)"`

### Task 2: `config/read` + `MethodSchema.result` + stage-A gate

**Files:** Create `src/appserver/schema/config.ts`, `src/appserver/configDomain.ts` · Modify `src/appserver/schema/index.ts` (result slot + entry), `src/appserver/schema/emit.ts` (emit `result`), `src/appserver/server.ts` (4 deps slots + handler) · Modify `docs/parity/appserver.md` (+1 row) · Test `test/unit/appserver/config-domain.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `review-start.test.ts`'s harness pattern.
- Produces: `configReadParams` + `configReadResult` (zod); handler `configRead`; **`MethodSchema` gains `result?: z.ZodType`** and `emit.ts` emits it under a `result` key per method when declared; `AppServerDeps` gains `configHome?: string; managedSettingsPath?: string | null; ccxDir?: string; getSessionInfo?: (id: string) => Promise<unknown | undefined>`; `resolveConfigCwd(cwd): Promise<string>` and `DEFAULT_MANAGED_PATH: string | null` exported from `configDomain.ts`; `ConfigError` (temporary home here; Task 3 moves it to `configWrite.ts`).

- [ ] **Step 1: Write the failing test.** Scaffolding: copy `mkSink`/`parsed`/`boot`/`send` from `test/unit/appserver/review-start.test.ts` VERBATIM (the `srv.connect(sink)` + `conn.feed(initialize)` + parsed-lines pattern — `dispatch` is private and four-arg; it is unreachable any other way, and rev 1's ad-hoc harness could not run at all). If the copied `send` does not return the id it minted, extend it to return `nextId - 1`; keep the rest verbatim. Then:

```ts
// test/unit/appserver/config-domain.test.ts — harness copied from review-start.test.ts, then:
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

let home: string, proj: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "m5home-")); proj = mkdtempSync(join(tmpdir(), "m5proj-"));
  mkdirSync(join(home, ".claude"), { recursive: true }); mkdirSync(join(proj, ".claude"), { recursive: true });
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true }); });
const deps = () => ({ configHome: home, managedSettingsPath: join(home, "managed.json"), ccxDir: join(home, "ccx") });
const reply = (id: number) => parsed(lines).find((l) => l.id === id) as any;

describe("config/read", () => {
  it("merges the chain, attributes leaf origins, serves CAS tokens, flags incompleteness", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", permissions: { allow: ["WebFetch"] } }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: "sonnet" }));
    boot(deps());
    const id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config).toEqual({ model: "sonnet", permissions: { allow: ["WebFetch"] } });
    expect(r.origins["model"]).toBe("local");
    expect(r.origins["permissions.allow"]).toEqual(["user"]);
    expect(r.incomplete).toBe(true);
    // D-M5-18: versions ALWAYS present for the writable targets in view — the first-conditional-write token.
    const userBytes = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    expect(r.versions.user).toBe(createHash("sha256").update(userBytes).digest("hex"));
    expect(r.versions.project).toBe("absent");
    expect(typeof r.versions.local).toBe("string");
    expect(r.layers).toBeUndefined();
  });
  it("includeLayers returns raw parses; malformed layer = disabledReason, healthy layers still serve", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    writeFileSync(join(proj, ".claude", "settings.json"), "{broken");
    boot(deps());
    const id = await send("config/read", { cwd: proj, includeLayers: true });
    const r = reply(id).result;
    expect(r.config).toEqual({ model: "opus" });
    expect(r.layers.find((l: any) => l.name === "project").disabledReason).toMatch(/JSON/);
  });
  it("relative and nonexistent cwd refuse -32602 ConfigValidationError; without cwd only user in versions", async () => {
    boot(deps());
    let id = await send("config/read", { cwd: "rel/path" });
    expect(reply(id).error.data).toEqual({ code: "ConfigValidationError" });
    id = await send("config/read", { cwd: join(proj, "nope") });
    expect(reply(id).error.code).toBe(-32602);
    id = await send("config/read", {});
    expect(Object.keys(reply(id).result.versions)).toEqual(["user"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — unknown method `config/read`.

- [ ] **Step 3: Implement.** `schema/config.ts` (params + results — the result schema IS the D-M5-19 contract):

```ts
// src/appserver/schema/config.ts — the config trio's params AND results (spec D-M5-12/18/19).
import { z } from "zod/v4";

export const configReadParams = z.object({ includeLayers: z.boolean().optional(), cwd: z.string().min(1).optional() });
const layerName = z.enum(["user", "project", "local", "managed"]);
export const configReadResult = z.object({
  config: z.record(z.string(), z.unknown()),
  origins: z.record(z.string(), z.union([layerName, z.array(layerName)])),
  versions: z.record(z.string(), z.string()),
  incomplete: z.literal(true),
  layers: z.array(z.object({ name: layerName, filePath: z.string(), config: z.record(z.string(), z.unknown()).optional(), raw: z.string().optional(), disabledReason: z.string().optional() })).optional(),
});
export const keyPathParam = z.array(z.string().min(1)).min(1).max(32);
export const configTargetParam = z.enum(["user", "project", "local"]);
const mergeStrategy = z.enum(["replace", "upsert"]);
export const configValueWriteParams = z.object({
  keyPath: keyPathParam, value: z.unknown(), mergeStrategy,
  target: configTargetParam.default("user"), cwd: z.string().min(1).optional(), expectedVersion: z.string().min(1).optional(),
});
export const configBatchWriteParams = z.object({
  edits: z.array(z.object({ keyPath: keyPathParam, value: z.unknown(), mergeStrategy })).min(1).max(64),
  target: configTargetParam.default("user"), cwd: z.string().min(1).optional(), expectedVersion: z.string().min(1).optional(),
});
export const configWriteResult = z.object({
  status: z.enum(["ok", "okOverridden"]), version: z.string(), filePath: z.string(),
  overriddenMetadata: z.object({ message: z.string(), overridingLayer: layerName, effectiveValue: z.unknown() }).optional(),
  maskedEditIndexes: z.array(z.number().int()).optional(),
  warnings: z.array(z.string()).optional(),
});
```

`configDomain.ts` (this task ships `configRead` only):

```ts
// src/appserver/configDomain.ts — config/read here; the writes land in Task 4.
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { homedir, platform } from "node:os";
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { layerPaths, readLayers, effectiveView } from "./configLayers.js";
import { configReadParams } from "./schema/config.js";

/** win32: null — the spec declares Windows managed paths out of this file-backed view, and a Linux
 *  default there would invent a drive-root layer (plan review F19). */
export const DEFAULT_MANAGED_PATH: string | null = platform() === "darwin"
  ? "/Library/Application Support/ClaudeCode/managed-settings.json"
  : platform() === "win32" ? null : "/etc/claude-code/managed-settings.json";

// Task 3 moves this class to configWrite.ts and re-imports it here — the write primitives throw it too.
export class ConfigError extends Error {
  constructor(public code: "ConfigVersionConflict" | "ConfigValidationError", message: string) { super(message); }
}

export async function resolveConfigCwd(cwd: string, deps: { realpath: (p: string) => Promise<string> } = { realpath }): Promise<string> {
  if (!isAbsolute(cwd)) throw new ConfigError("ConfigValidationError", "cwd must be an absolute path");
  try { return await deps.realpath(cwd); }
  catch { throw new ConfigError("ConfigValidationError", `cwd does not exist: ${cwd}`); }
}

// Task 3 replaces this inline token with configWrite.ts's versionToken (same contract).
const token = (raw: string | undefined): string => raw === undefined ? "absent" : createHash("sha256").update(raw).digest("hex");

export const configRead: Handler = async (srv, ctx, id, params) => {
  const parsed = configReadParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const home = srv.deps.configHome ?? homedir();
  const managed = srv.deps.managedSettingsPath !== undefined ? srv.deps.managedSettingsPath : DEFAULT_MANAGED_PATH;
  try {
    const cwd = parsed.data.cwd !== undefined ? await resolveConfigCwd(parsed.data.cwd) : undefined;
    const paths = layerPaths(home, managed, cwd);
    const layers = await readLayers(paths);
    const { config, origins } = effectiveView(layers);
    // D-M5-18: CAS tokens for every WRITABLE target in view — walked off `paths` (absent layers are
    // not in `layers`, and an absent writable file's token is the string "absent").
    const versions: Record<string, string> = {};
    for (const { name, filePath } of paths) {
      if (name === "managed") continue;
      versions[name] = token(layers.find((l) => l.filePath === filePath)?.raw);
    }
    ctx.peer.reply(id, { config, origins, versions, incomplete: true, ...(parsed.data.includeLayers ? { layers } : {}) });
  } catch (e) {
    if (e instanceof ConfigError) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, e.message, { code: e.code }); return; }
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};
```

`schema/index.ts`: widen the interface and register —

```ts
export interface MethodSchema { params: z.ZodType; result?: z.ZodType; experimental?: true }
// … import { configReadParams, configReadResult } from "./config.js"; and in methodSchemas:
  "config/read": { params: configReadParams, result: configReadResult },
```

`schema/emit.ts`: at the point where each method's entry is assembled from `methodSchemas`, convert and attach `result` when declared — the SAME zod→draft-7 pipeline the params go through (read the file first; the change is a few lines at the per-method assembly point). Extend `test/unit/appserver/schemaGen.test.ts` with one assertion: the emitted stable document's `config/read` entry has a `result` key and `thread/start`'s has none.

`server.ts`: add the four `AppServerDeps` slots —

```ts
  // M5: the config-files domain + archive markers. `configHome` is the base of the user layer
  // (`<configHome>/.claude/settings.json`), defaulted to os.homedir() at each call site so tests point
  // the whole domain at a temp dir; `managedSettingsPath` overrides the platform managed file (null =
  // no managed layer, the win32 default); `ccxDir` is the server-state dir (`~/.claude/ccx`) the
  // archive markers live under; `getSessionInfo` backs the D-M5-20 existence checks.
  configHome?: string;
  managedSettingsPath?: string | null;
  ccxDir?: string;
  getSessionInfo?: (id: string) => Promise<unknown | undefined>;
```

and register (import `configRead` from `./configDomain.js`; add `"config/read": configRead,` beside `"review/start"`).

- [ ] **Step 4: Stage-A gate.** Add the `config/read` scorecard row to `docs/parity/appserver.md`'s server-origin table (copy a review-domain row's format: seam token repeats the wire name; source `appserver/configDomain.ts`; origin scope `N/A`; status `shipped(M5)` with a description naming versions/origins/incomplete and the SettingsSchema deviation). Run `npm run emit-schema`. Run `node ../scripts/drift-check.mjs` → **exit 0** (60 registered methods, 91 rows). Full unit suite → green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): config/read + MethodSchema.result — stage A green (Task 2)"`

## Stage B — config writes (gate green at stage end)

### Task 3: `configWrite.ts` — merge table, token, nonce-owned lock

**Files:** Create `src/appserver/configWrite.ts` · Modify `src/appserver/configDomain.ts` (`ConfigError` moves here; inline token swapped for `versionToken`) · Test `test/unit/appserver/config-write.test.ts`

**Interfaces:**
- `ConfigError` (now lives HERE; `configDomain.ts` re-imports)
- `applyEdit(doc: Record<string, unknown>, keyPath: string[], value: unknown, strategy: "replace" | "upsert"): Record<string, unknown>` — pure, returns a new doc; refuses `__proto__`/`constructor`/`prototype`; own-property access throughout
- `versionToken(bytes: string | null): string` — two cases only: `null` → `"absent"`, otherwise sha256 hex.
  The wire has a THIRD token, `"unreadable"` (Task 2 review I1), for a settings file that exists but could
  not be read. It is minted by `configDomain.ts`'s versions walk from layer state, never by this function.
- `withFileLock<T>(filePath: string, fn: () => Promise<T>, opts?: { staleMs?: number }): Promise<T>` — in-process per-path chain + nonce-owned `<file>.lock`
- `readTargetDoc(filePath): Promise<{ doc: Record<string, unknown>; version: string }>` — missing (ENOENT) → `{doc: {}, version: "absent"}`; malformed → `ConfigValidationError`; **any other read
  failure (EACCES, EISDIR) → `ConfigValidationError` too**, so the write path refuses a file it could not
  read instead of leaking a raw fs error as an internal error. This is the write-side half of Task 2
  review I1: never write bytes over bytes you were never able to see.
- `writeTargetDoc(filePath, doc): Promise<{ version: string }>` — creates the parent dir, 2-space JSON + trailing newline, tmp+rename
- `resolveRealTarget(filePath): Promise<string>` — parent created; `realpath` when the file exists (symlinked settings → the real file), else the literal path

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/config-write.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { applyEdit, versionToken, withFileLock, readTargetDoc, writeTargetDoc, resolveRealTarget, ConfigError } from "../../../src/appserver/configWrite.js";

describe("applyEdit (D-M5-13 merge table)", () => {
  it("replace sets the leaf exactly; siblings survive", () => {
    expect(applyEdit({ a: { x: 1 } }, ["a", "y"], 2, "replace")).toEqual({ a: { x: 1, y: 2 } });
    expect(applyEdit({ a: { x: 1, y: [1] } }, ["a", "y"], "z", "replace")).toEqual({ a: { x: 1, y: "z" } });
  });
  it("upsert deep-merges with the read-side customizer (arrays concat+SVZ-dedupe)", () => {
    expect(applyEdit({ p: { allow: ["A"] } }, ["p"], { allow: ["A", "B"] }, "upsert")).toEqual({ p: { allow: ["A", "B"] } });
  });
  it("missing parents created; non-object parent refuses untouched", () => {
    expect(applyEdit({}, ["a", "b", "c"], 1, "replace")).toEqual({ a: { b: { c: 1 } } });
    const doc = { a: 5 };
    expect(() => applyEdit(doc, ["a", "b"], 1, "replace")).toThrow(ConfigError);
    expect(doc).toEqual({ a: 5 });
  });
  it("replace null deletes; upsert null refuses; a dotted segment is one key; input never mutated", () => {
    expect(applyEdit({ a: 1, b: 2 }, ["a"], null, "replace")).toEqual({ b: 2 });
    expect(() => applyEdit({ a: 1 }, ["a"], null, "upsert")).toThrow(ConfigError);
    expect(applyEdit({}, ["k.with.dots"], 1, "replace")).toEqual({ "k.with.dots": 1 });
    const doc = { a: { x: 1 } };
    applyEdit(doc, ["a", "y"], 2, "replace");
    expect(doc).toEqual({ a: { x: 1 } });
  });
  it("refuses the three prototype segments and never touches the prototype chain", () => {
    for (const seg of ["__proto__", "constructor", "prototype"]) {
      expect(() => applyEdit({}, [seg], 1, "replace")).toThrow(ConfigError);
      expect(() => applyEdit({}, ["a", seg], 1, "upsert")).toThrow(ConfigError);
    }
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe("token + doc IO", () => {
  it("token: sha256 of bytes, absent for null", () => {
    expect(versionToken(null)).toBe("absent");
    expect(versionToken("x")).toBe(createHash("sha256").update("x").digest("hex"));
  });
  it("readTargetDoc: missing = empty+absent; malformed refuses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5w-"));
    expect(await readTargetDoc(join(dir, "no.json"))).toEqual({ doc: {}, version: "absent" });
    writeFileSync(join(dir, "bad.json"), "{nope");
    await expect(readTargetDoc(join(dir, "bad.json"))).rejects.toThrow(ConfigError);
  });
  it("writeTargetDoc round-trips with a matching token AND creates the missing .claude parent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5w-"));
    const p = join(dir, ".claude", "settings.json"); // parent does NOT exist (fresh project)
    const { version } = await writeTargetDoc(p, { model: "opus" });
    const back = await readTargetDoc(p);
    expect(back.doc).toEqual({ model: "opus" });
    expect(back.version).toBe(version);
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
  });
  it("a symlinked target resolves: the write lands in the real file, the link survives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5w-"));
    writeFileSync(join(dir, "real.json"), "{}\n");
    symlinkSync(join(dir, "real.json"), join(dir, "link.json"));
    expect(await resolveRealTarget(join(dir, "link.json"))).toBe(join(dir, "real.json"));
    expect(lstatSync(join(dir, "link.json")).isSymbolicLink()).toBe(true);
  });
});

describe("withFileLock (D-M5-14 rev 3)", () => {
  it("serializes concurrent critical sections on one path and releases", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5l-"));
    const p = join(dir, "s.json");
    const order: string[] = [];
    await Promise.all([
      withFileLock(p, async () => { order.push("a-in"); await new Promise((r) => setTimeout(r, 40)); order.push("a-out"); }),
      withFileLock(p, async () => { order.push("b-in"); order.push("b-out"); }),
    ]);
    expect(order).toEqual(["a-in", "a-out", "b-in", "b-out"]);
    expect(existsSync(p + ".lock")).toBe(false);
  });
  it("breaks a stale-and-stable foreign lock instead of hanging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5l-"));
    const p = join(dir, "s.json");
    writeFileSync(p + ".lock", "dead-owner");
    expect(await withFileLock(p, async () => "ran", { staleMs: 0 })).toBe("ran");
  });
  it("release never unlinks a FOREIGN lock (nonce ownership)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5l-"));
    const p = join(dir, "s.json");
    await withFileLock(p, async () => { writeFileSync(p + ".lock", "foreign-nonce"); }); // steal mid-hold
    expect(readFileSync(p + ".lock", "utf8")).toBe("foreign-nonce"); // OUR release left it alone
  });
});
```

- [ ] **Step 2: Run to verify failure** — module missing.

- [ ] **Step 3: Implement**

```ts
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

export function versionToken(bytes: string | null): string {
  return bytes === null ? "absent" : createHash("sha256").update(bytes).digest("hex");
}

export async function readTargetDoc(filePath: string): Promise<{ doc: Record<string, unknown>; version: string }> {
  let raw: string;
  try { raw = await readFile(filePath, "utf8"); }
  // D-M5-18a: ENOENT is the only benign read failure. EACCES/EISDIR refuse as a VALIDATION error —
  // rethrowing the raw fs error would surface an unreadable settings file at the wire as an internal
  // error carrying an `EISDIR` string. Never write bytes over bytes you were never able to see.
  catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { doc: {}, version: "absent" };
    throw new ConfigError("ConfigValidationError", `target settings file could not be read: ${(e as Error).message}`);
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
```

`configDomain.ts`: delete its local `ConfigError` and inline `token`; `import { ConfigError, versionToken } from "./configWrite.js";`. **The versions walk keeps its THREE cases — do NOT collapse it to `versionToken(raw ?? null)`.** That collapse was this plan's original text and it silently reverts Task 2's review fix I1: `raw` is `undefined` both for a layer that is absent and for one that exists but could not be read, and `?? null` maps both to `"absent"`. Keep: layer not in view → `"absent"`; layer in view with no `raw` (EACCES, EISDIR) → `"unreadable"`; otherwise → `versionToken(raw)`. `versionToken` stays a pure two-case bytes→token function; the third case is layer state, not bytes, and belongs to the caller.

- [ ] **Step 4: Run** — config-write + config-domain + config-layers suites PASS; typecheck clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): merge table + nonce-owned lock CAS primitives (Task 3)"`

### Task 4: The write handlers + stage-B gate

**Files:** Modify `src/appserver/configDomain.ts`, `src/appserver/schema/index.ts` (2 entries with `result: configWriteResult`), `src/appserver/server.ts` (2 handlers), `docs/parity/appserver.md` (+2 rows) · Test `test/unit/appserver/config-domain.test.ts` (append)

**Interfaces:** handlers `configValueWrite`, `configBatchWrite`; responses per `configWriteResult`. The shared spine `runConfigWrite` **canonicalizes `cwd` exactly once, FIRST** — before target resolution, the lock, or any write, reused for masking — and the lock's critical section covers read→CAS→apply-all-edits→write.

- [ ] **Step 1: Append the failing tests** (feed harness; `reply(id)` helper from Task 2's file; `sendNoAwait`/`waitFor` are two-line variants defined beside the copied scaffolding — `sendNoAwait` feeds without awaiting a tick, `waitFor` polls with a 2s timeout):

```ts
describe("config/value/write + config/batchWrite", () => {
  it("user upsert lands; versions round-trip; stale CAS refuses byte-identical with the named code", async () => {
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["permissions", "allow"], value: ["WebFetch"], mergeStrategy: "upsert" });
    const w1 = reply(id).result;
    expect(w1.status).toBe("ok");
    expect(w1.filePath).toBe(join(home, ".claude", "settings.json"));
    const bytes = readFileSync(w1.filePath, "utf8");
    expect(JSON.parse(bytes)).toEqual({ permissions: { allow: ["WebFetch"] } });
    id = await send("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace", expectedVersion: "absent" });
    const e2 = reply(id).error;
    expect(e2.code).toBe(-32602);
    expect(e2.data).toEqual({ code: "ConfigVersionConflict" });
    expect(readFileSync(w1.filePath, "utf8")).toBe(bytes);
    id = await send("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace", expectedVersion: w1.version });
    expect(reply(id).result.status).toBe("ok");
  });
  it("two same-expectedVersion writers issued in one tick: exactly one ok, one conflict", async () => {
    boot(deps());
    const id0 = await send("config/value/write", { keyPath: ["a"], value: 1, mergeStrategy: "replace" });
    const v = reply(id0).result.version;
    const idA = sendNoAwait("config/value/write", { keyPath: ["b"], value: 2, mergeStrategy: "replace", expectedVersion: v });
    const idB = sendNoAwait("config/value/write", { keyPath: ["c"], value: 3, mergeStrategy: "replace", expectedVersion: v });
    await waitFor(() => reply(idA) !== undefined && reply(idB) !== undefined);
    const results = [reply(idA), reply(idB)];
    expect(results.filter((r) => r.result?.status === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.error?.data?.code === "ConfigVersionConflict")).toHaveLength(1);
  });
  it("an external mutation between token mint and write defeats the stale token", async () => {
    boot(deps());
    const id0 = await send("config/value/write", { keyPath: ["a"], value: 1, mergeStrategy: "replace" });
    const v = reply(id0).result.version;
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ external: true }) + "\n"); // another server
    const id1 = await send("config/value/write", { keyPath: ["b"], value: 2, mergeStrategy: "replace", expectedVersion: v });
    expect(reply(id1).error?.data?.code).toBe("ConfigVersionConflict");
  });
  it("a refused cwd never mutates the user file (validate-before-write)", async () => {
    boot(deps());
    const id = await send("config/value/write", { keyPath: ["model"], value: "x", mergeStrategy: "replace", target: "user", cwd: "rel/path" });
    expect(reply(id).error?.data?.code).toBe("ConfigValidationError");
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false); // rev 1 wrote first, refused after
  });
  it("okOverridden names the masking layer; batch masking sees EVERY edit", async () => {
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ a: "local-wins" }));
    boot(deps());
    const id = await send("config/batchWrite", { target: "user", cwd: proj, edits: [
      { keyPath: ["a"], value: "user-val", mergeStrategy: "replace" },   // masked by local
      { keyPath: ["b"], value: "clear", mergeStrategy: "replace" },      // unmasked, and LAST
    ] });
    const r = reply(id).result;
    expect(r.status).toBe("okOverridden");                                // rev 1 checked only the last edit
    expect(r.overriddenMetadata.overridingLayer).toBe("local");
    expect(r.maskedEditIndexes).toEqual([0]);
  });
  it("unknown top-level key warns; project without cwd refuses; batch is ordered and atomic", async () => {
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["notARealSetting"], value: 1, mergeStrategy: "replace" });
    expect(reply(id).result.warnings[0]).toMatch(/notARealSetting/);
    id = await send("config/value/write", { keyPath: ["model"], value: "x", mergeStrategy: "replace", target: "project" });
    expect(reply(id).error?.data?.code).toBe("ConfigValidationError");
    const before = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    id = await send("config/batchWrite", { edits: [
      { keyPath: ["a"], value: ["x"], mergeStrategy: "replace" },
      { keyPath: ["a"], value: ["y"], mergeStrategy: "upsert" },
      { keyPath: ["notARealSetting", "child"], value: 3, mergeStrategy: "replace" }, // parent is scalar 1 → refuses
    ] });
    expect(reply(id).error?.data?.code).toBe("ConfigValidationError");
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(before); // byte-identical rollback
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** (append to `configDomain.ts`):

```ts
import { configValueWriteParams, configBatchWriteParams } from "./schema/config.js";
import { applyEdit, readTargetDoc, writeTargetDoc, resolveRealTarget, withFileLock } from "./configWrite.js";
import { join } from "node:path";

/** Advisory only (D-M5-5): a key outside this list WARNS — upstream tolerates unknown keys, so must we. */
const KNOWN_TOP_LEVEL = new Set(["permissions", "env", "model", "hooks", "statusLine", "apiKeyHelper",
  "includeCoAuthoredBy", "cleanupPeriodDays", "additionalDirectories", "defaultMode", "outputStyle",
  "enableAllProjectMcpServers", "enabledMcpjsonServers", "disabledMcpjsonServers", "forceLoginMethod",
  "disableBypassPermissionsMode", "sandbox", "alwaysThinkingEnabled", "spinnerTipsEnabled", "attributions"]);

type WriteData = { edits: Array<{ keyPath: string[]; value: unknown; mergeStrategy: "replace" | "upsert" }>; target: "user" | "project" | "local"; cwd?: string; expectedVersion?: string };

async function runConfigWrite(srv: Parameters<Handler>[0], ctx: Parameters<Handler>[1], id: Parameters<Handler>[2], data: WriteData): Promise<void> {
  try {
    // cwd canonicalized ONCE, FIRST — before target resolution, the lock, or any write. A refusal must
    // leave every file byte-identical (plan review F5: rev 1 validated a user-target cwd only after
    // the write had landed, so the error reply lied about refusing).
    const cwdReal = data.cwd !== undefined ? await resolveConfigCwd(data.cwd) : undefined;
    if ((data.target === "project" || data.target === "local") && cwdReal === undefined)
      throw new ConfigError("ConfigValidationError", `target "${data.target}" requires cwd`);
    const home = srv.deps.configHome ?? homedir();
    const nominal = data.target === "user" ? join(home, ".claude", "settings.json")
      : join(cwdReal as string, ".claude", data.target === "project" ? "settings.json" : "settings.local.json");
    const filePath = await resolveRealTarget(nominal);
    const written = await withFileLock(filePath, async () => {
      // `"unreadable"` (Task 2 review I1) is refused as an ASSERTION, ahead of the compare: it is a
      // sentinel for the server's inability to read the file, not a state of its content, so a client
      // holding it never saw the bytes it would be asserting continuity of. Mechanically it can never
      // legitimately match — still unreadable and `readTargetDoc` refuses; readable again and the token
      // is a hash — so this is only about failing closed BY DESIGN with a diagnosable message rather
      // than by accident with an opaque one.
      if (data.expectedVersion === "unreadable")
        throw new ConfigError("ConfigValidationError", 'expectedVersion "unreadable" cannot be asserted — re-read config first');
      const { doc, version } = await readTargetDoc(filePath);
      if (data.expectedVersion !== undefined && data.expectedVersion !== version)
        throw new ConfigError("ConfigVersionConflict", `expectedVersion ${data.expectedVersion} does not match current ${version}`);
      let next = doc;
      for (const e of data.edits) next = applyEdit(next, e.keyPath, e.value, e.mergeStrategy);
      return writeTargetDoc(filePath, next);
    });
    const warnings = data.edits.filter((e) => !KNOWN_TOP_LEVEL.has(e.keyPath[0])).map((e) => `unknown top-level settings key "${e.keyPath[0]}" (written anyway)`);
    // Masking: EVERY edit evaluated (plan review F15); scalar/object leaves only — array leaves merge
    // by contribution and the read side's contributor origins tell that story.
    const managed = srv.deps.managedSettingsPath !== undefined ? srv.deps.managedSettingsPath : DEFAULT_MANAGED_PATH;
    const layers = await readLayers(layerPaths(home, managed, cwdReal));
    const order = ["user", "project", "local", "managed"] as const;
    const above = order.slice(order.indexOf(data.target) + 1);
    const leafOf = (cfg: Record<string, unknown> | undefined, keyPath: string[]): { present: boolean; value?: unknown } => {
      let node: unknown = cfg;
      for (const seg of keyPath) {
        if (typeof node !== "object" || node === null || Array.isArray(node) || !Object.prototype.hasOwnProperty.call(node, seg)) return { present: false };
        node = (node as Record<string, unknown>)[seg];
      }
      return { present: true, value: node };
    };
    const maskedEditIndexes: number[] = [];
    let overriddenMetadata: { message: string; overridingLayer: string; effectiveValue: unknown } | undefined;
    data.edits.forEach((e, i) => {
      for (const name of above) {
        const hit = leafOf(layers.find((l) => l.name === name)?.config, e.keyPath);
        if (hit.present && !Array.isArray(hit.value)) {
          maskedEditIndexes.push(i);
          overriddenMetadata ??= { message: `the ${name} layer defines this key with higher precedence`, overridingLayer: name, effectiveValue: hit.value };
          break;
        }
      }
    });
    ctx.peer.reply(id, {
      status: maskedEditIndexes.length ? "okOverridden" : "ok", version: written.version, filePath,
      ...(overriddenMetadata ? { overriddenMetadata } : {}),
      ...(maskedEditIndexes.length ? { maskedEditIndexes } : {}),
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (e) {
    if (e instanceof ConfigError) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, e.message, { code: e.code }); return; }
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
}

export const configValueWrite: Handler = async (srv, ctx, id, params) => {
  const parsed = configValueWriteParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { keyPath, value, mergeStrategy, target, cwd, expectedVersion } = parsed.data;
  await runConfigWrite(srv, ctx, id, { edits: [{ keyPath, value, mergeStrategy }], target, cwd, expectedVersion });
};

export const configBatchWrite: Handler = async (srv, ctx, id, params) => {
  const parsed = configBatchWriteParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  await runConfigWrite(srv, ctx, id, parsed.data);
};
```

Register both in `methodSchemas` (with `result: configWriteResult`) and the handlers table.

- [ ] **Step 4: Stage-B gate** — two scorecard rows (`config/value/write`, `config/batchWrite`, origin `N/A`, `shipped(M5)`); `npm run emit-schema`; drift gate → exit 0 (62 methods, 93 rows); full unit suite green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): config writes — CAS under nonce lock, all-edits masking — stage B green (Task 4)"`

## Stage C — search + archive (gate green at stage end)

### Task 5: Archive marker store (primitives only — search consumes it, so it lands FIRST)

**Files:** Create `src/appserver/archive.ts` (store half only — NO handlers yet) · Test `test/unit/appserver/archive.test.ts`

Rev 1 shipped `thread/search` against a stubbed always-empty archive reader — the plan review called that a deliberately false interface (F17); landing the store first is the fix.

**Interfaces:** `ArchiveDeps { ccxDir?: string }` · `listArchived(deps): Promise<Set<string>>` · `createArchiveMarker(sessionId, deps): Promise<void>` · `removeArchiveMarker(sessionId, deps): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/archive.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listArchived, createArchiveMarker, removeArchiveMarker } from "../../../src/appserver/archive.js";

describe("archive markers", () => {
  it("create/list/remove round-trip; both directions idempotent; absent dir = empty set", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    expect(await listArchived({ ccxDir: join(ccxDir, "never-made") })).toEqual(new Set());
    await createArchiveMarker("sess-1", { ccxDir });
    await createArchiveMarker("sess-1", { ccxDir }); // EEXIST → fine
    expect(await listArchived({ ccxDir })).toEqual(new Set(["sess-1"]));
    expect(existsSync(join(ccxDir, "archived", "sess-1"))).toBe(true);
    await removeArchiveMarker("sess-1", { ccxDir });
    await removeArchiveMarker("sess-1", { ccxDir }); // ENOENT → fine
    expect(await listArchived({ ccxDir })).toEqual(new Set());
  });
  it("a path-hostile sessionId refuses instead of composing a path", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    await expect(createArchiveMarker("../escape", { ccxDir })).rejects.toThrow(/sessionId/);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run** — PASS + typecheck.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): archive marker store (Task 5)"`

### Task 6: Search primitives (`searchScan.ts`)

**Files:** Create `src/appserver/searchScan.ts` · Test `test/unit/appserver/search-scan.test.ts`

**Interfaces:**
- `SEARCH_CAPS = { maxFilesPerPage: 40, maxRowsPerPage: 4000, maxRowUnits: 1_048_576, maxLimit: 50, defaultLimit: 20, minTerm: 2, maxTerm: 256, snippetMax: 200, windowRows: 500 } as const`
- `type SortKey = "created_at" | "updated_at" | "recency_at"`
- `sortValueOf(info: { createdAt?: number; lastModified: number }, key: SortKey): number | null`
- `compareTuple(a: { v: number | null; s: string }, b: { v: number | null; s: string }, dir: "asc" | "desc"): number` — **the ONE ordering** shared by sort and cursor resume: null `v` last in BOTH directions, tiebreak `s` ascending
- `sortForSearch<T extends { sessionId: string }>(rows: T[], dir, valueOf): T[]` — implemented ON `compareTuple`
- `encodeSearchCursor/decodeSearchCursor` for `{ v: number | null; s: string; r: number }`; `encodeOccCursor/decodeOccCursor` for `{ s: string; r: number; c: number; e: number | null }` — base64url JSON, full shape validation on decode (null on garbage; the codecs cross-reject each other's shapes)
- `rowSearchText(m: unknown): string | null` — corpus text (user rows classified `prompt` by `rows.ts` via `promptText`; assistant rows' text blocks joined `\n`); null out of corpus
- `makeSnippet(text, start, len): { snippet, snippetMatchRange }` — cap **max(snippetMax, len)**

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/search-scan.test.ts
import { describe, it, expect } from "vitest";
import { SEARCH_CAPS, sortForSearch, sortValueOf, compareTuple, encodeSearchCursor, decodeSearchCursor, encodeOccCursor, decodeOccCursor, rowSearchText, makeSnippet } from "../../../src/appserver/searchScan.js";

describe("searchScan", () => {
  it("compareTuple: nulls last both directions; sessionId tiebreak asc", () => {
    const t = (v: number | null, s: string) => ({ v, s });
    expect(compareTuple(t(1, "a"), t(2, "a"), "asc")).toBeLessThan(0);
    expect(compareTuple(t(1, "a"), t(2, "a"), "desc")).toBeGreaterThan(0);
    expect(compareTuple(t(null, "a"), t(1, "z"), "asc")).toBeGreaterThan(0);
    expect(compareTuple(t(null, "a"), t(1, "z"), "desc")).toBeGreaterThan(0);
    expect(compareTuple(t(5, "a"), t(5, "b"), "desc")).toBeLessThan(0);
  });
  it("sortForSearch rides compareTuple: created_at asc oldest-first, missing createdAt last, id ties", () => {
    const rows = [
      { sessionId: "b", createdAt: 200, lastModified: 1 }, { sessionId: "a", createdAt: 200, lastModified: 2 },
      { sessionId: "c", createdAt: 100, lastModified: 3 }, { sessionId: "d", lastModified: 4 },
    ];
    const vo = (r: any) => sortValueOf(r, "created_at");
    expect(sortForSearch(rows, "asc", vo).map((r) => r.sessionId)).toEqual(["c", "a", "b", "d"]);
    expect(sortForSearch(rows, "desc", vo).map((r) => r.sessionId)).toEqual(["a", "b", "c", "d"]);
  });
  it("both cursor codecs round-trip and reject garbage AND each other", () => {
    const c = { v: 123, s: "sess", r: 7 };
    expect(decodeSearchCursor(encodeSearchCursor(c))).toEqual(c);
    expect(decodeSearchCursor("not-a-cursor")).toBeNull();
    const o = { s: "x", r: 3, c: 17, e: 2 };
    expect(decodeOccCursor(encodeOccCursor(o))).toEqual(o);
    expect(decodeOccCursor(encodeOccCursor({ s: "x", r: 0, c: 0, e: null }))!.e).toBeNull();
    expect(decodeOccCursor(encodeSearchCursor(c))).toBeNull();
    expect(decodeSearchCursor(encodeOccCursor(o))).toBeNull();
  });
  it("rowSearchText: prompts + assistant text are corpus; tool_results and echoes are not", () => {
    expect(rowSearchText({ type: "user", uuid: "u1", message: { content: "hello world" } })).toBe("hello world");
    expect(rowSearchText({ type: "assistant", message: { content: [{ type: "text", text: "found it" }, { type: "tool_use", name: "X", input: {} }] } })).toBe("found it");
    expect(rowSearchText({ type: "user", message: { content: [{ type: "tool_result", content: "noise" }] } })).toBeNull();
    expect(rowSearchText({ type: "user", uuid: "u2", message: { content: "<command-name>/clear</command-name>" } })).toBeNull();
  });
  it("makeSnippet: centered, capped at max(200, termLen), range indexes the snippet — a 256-unit term fits", () => {
    const long = "x".repeat(500) + "NEEDLE" + "y".repeat(500);
    const { snippet, snippetMatchRange } = makeSnippet(long, 500, 6);
    expect(snippet.length).toBeLessThanOrEqual(SEARCH_CAPS.snippetMax);
    expect(snippet.slice(snippetMatchRange.start, snippetMatchRange.end)).toBe("NEEDLE");
    const bigTerm = "T".repeat(256);
    const r2 = makeSnippet("a".repeat(50) + bigTerm + "b".repeat(50), 50, 256);
    expect(r2.snippet.slice(r2.snippetMatchRange.start, r2.snippetMatchRange.end)).toBe(bigTerm);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```ts
// src/appserver/searchScan.ts — pure search primitives (spec D-M5-15/16/17 rev 3). ONE tuple ordering
// shared by the sort and the cursor resume — the rev-1 plan let them diverge and the review caught a
// session locator masquerading as a keyset (F8). Two cursor codecs live beside it for the same reason.
import { rowKind, promptText } from "../sessions/index.js";

export const SEARCH_CAPS = { maxFilesPerPage: 40, maxRowsPerPage: 4000, maxRowUnits: 1_048_576, maxLimit: 50, defaultLimit: 20, minTerm: 2, maxTerm: 256, snippetMax: 200, windowRows: 500 } as const;
export type SortKey = "created_at" | "updated_at" | "recency_at";

export function sortValueOf(info: { createdAt?: number; lastModified: number }, key: SortKey): number | null {
  if (key === "created_at") return info.createdAt ?? null;
  return info.lastModified; // updated_at ≡ recency_at ≡ lastModified on this store (D-M5-6)
}

export function compareTuple(a: { v: number | null; s: string }, b: { v: number | null; s: string }, dir: "asc" | "desc"): number {
  if (a.v === null && b.v === null) return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
  if (a.v === null) return 1; // nulls last in BOTH directions
  if (b.v === null) return -1;
  if (a.v !== b.v) return dir === "asc" ? a.v - b.v : b.v - a.v;
  return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
}

export function sortForSearch<T extends { sessionId: string }>(rows: T[], dir: "asc" | "desc", valueOf: (r: T) => number | null): T[] {
  return [...rows].sort((a, b) => compareTuple({ v: valueOf(a), s: a.sessionId }, { v: valueOf(b), s: b.sessionId }, dir));
}

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
const unb64 = (s: string): unknown => { try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")); } catch { return null; } };

export function encodeSearchCursor(c: { v: number | null; s: string; r: number }): string { return b64(c); }
export function decodeSearchCursor(s: string): { v: number | null; s: string; r: number } | null {
  const p = unb64(s) as { v?: unknown; s?: unknown; r?: unknown; c?: unknown } | null;
  if (!p || (typeof p.v !== "number" && p.v !== null) || typeof p.s !== "string" || typeof p.r !== "number" || "c" in p) return null;
  return { v: p.v, s: p.s, r: p.r };
}
export function encodeOccCursor(c: { s: string; r: number; c: number; e: number | null }): string { return b64(c); }
export function decodeOccCursor(s: string): { s: string; r: number; c: number; e: number | null } | null {
  const p = unb64(s) as { s?: unknown; r?: unknown; c?: unknown; e?: unknown; v?: unknown } | null;
  if (!p || typeof p.s !== "string" || typeof p.r !== "number" || typeof p.c !== "number" || (typeof p.e !== "number" && p.e !== null) || "v" in p) return null;
  return { s: p.s, r: p.r, c: p.c, e: p.e };
}

/** The corpus (spec: Codex's "visible user messages and final assistant messages", via OUR classifier
 *  so search and replay cannot drift): user rows rows.ts classifies `prompt`, and assistant rows' text
 *  blocks. Everything else returns null. */
export function rowSearchText(m: unknown): string | null {
  const row = m as { type?: string; message?: { content?: unknown } };
  if (row?.type === "assistant") {
    const c = row.message?.content;
    if (!Array.isArray(c)) return null;
    const texts = c.filter((b: any) => b?.type === "text").map((b: any) => String(b.text ?? ""));
    return texts.length ? texts.join("\n") : null;
  }
  if (row?.type === "user") return rowKind(m) === "prompt" ? promptText(m) : null;
  return null;
}

export function makeSnippet(text: string, start: number, len: number): { snippet: string; snippetMatchRange: { start: number; end: number } } {
  const max = Math.max(SEARCH_CAPS.snippetMax, len); // a term longer than 200 units still fits its own snippet
  const pad = Math.max(0, Math.floor((max - len) / 2));
  const from = Math.max(0, start - pad);
  const snippet = text.slice(from, from + max);
  return { snippet, snippetMatchRange: { start: start - from, end: start - from + len } };
}
```

- [ ] **Step 4: Run** — PASS + typecheck.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): search primitives — one tuple order, two cursor codecs (Task 6)"`

### Task 7: `thread/search`

**Files:** Create `src/appserver/schema/search.ts`, `src/appserver/search.ts` · Modify `src/appserver/schema/index.ts` (entry + result), `src/appserver/server.ts` (handler), `src/appserver/sessionLib.ts` (add `export` to `resolveThreadId` and `findLiveBySessionId` — two-word diffs) · Test `test/unit/appserver/search.test.ts`

**Interfaces:**
- `threadSearchParams`: `searchTerm: z.string()`, `cursor?`, `limit?: z.number().int().positive()`, `sortKey: z.enum(["created_at","updated_at","recency_at"]).default("created_at")`, `sortDirection: z.enum(["asc","desc"]).default("desc")`, `archived: z.boolean().optional()`, `cwd: z.string().optional()`
- `threadSearchResult = z.object({ data: z.array(z.object({ thread: z.record(z.string(), z.unknown()), snippet: z.string() })), nextCursor: z.string().nullable(), skipped: z.number().int().optional() })`
- Handler `threadSearch`; `runScanExclusive(srv, fn)` (WeakMap chain, exported — Task 8 reuses); the REAL `listArchived` from `./archive.js` (Task 5 made it real — no stub, review F17); `viewFor(srv, info)` = live via `findLiveBySessionId` → `threadView`, else `storeOnlyView`.

**Normative control flow (the rev-1 flow failed review on resume/mint asymmetry — implement THIS):**

```
parse → term bounds (2–256 → -32602) → decode cursor (garbage → -32602)
limit: requested > 50 → clamp to 50 + srv.warn(ctx.peer, "limitClamped", "thread/search limit clamped to 50")
runScanExclusive(srv, async () => {
  all = await listFn({cwd}); archivedSet = await listArchived({ccxDir}); rows = all.filter(has === wantArchived)
  sorted = sortForSearch(rows, dir, r => sortValueOf(r, key))
  startIdx = cursor ? first i where compareTuple(tuple(sorted[i]), cursor, dir) >= 0 : 0
  data = []; filesScanned = rowsScanned = skipped = 0; nextCursor = null
  for i in startIdx..len-1:
    info = sorted[i]; tup = {v: sortValueOf(info, key), s: info.sessionId}
    startRow = (cursor && compareTuple(tup, cursor, dir) === 0) ? cursor.r : 0
    if startRow === 0:                                  # metadata corpus, free, once per session
      hit = first of [customTitle, summary, firstPrompt, tag] containing termLc
      if hit: push {thread: viewFor(info), snippet: makeSnippet(hit, idx, len).snippet}
              if data.length >= limit: nextCursor = i+1 < len ? encode({...tuple(sorted[i+1]), r: 0}) : null; break
              continue
    if filesScanned >= maxFilesPerPage or rowsScanned >= maxRowsPerPage:
      nextCursor = encode({...tup, r: startRow}); break
    filesScanned++
    r = startRow; found = false
    loop:                                               # WINDOWED reads — never the whole transcript
      want = min(windowRows, maxRowsPerPage - rowsScanned)
      if want <= 0: nextCursor = encode({...tup, r}); break outer-for
      window = await getMessages(info.sessionId, {offset: r, limit: want})
      for row in window:
        rowsScanned++; text = rowSearchText(row); r++
        if text === null: continue
        if text.length > maxRowUnits: skipped++; continue
        at = text.toLowerCase().indexOf(termLc)
        if at >= 0: push {thread: viewFor(info), snippet}; found = true; break loop
      if window.length < want: break loop               # session exhausted
    if found and data.length >= limit:
      nextCursor = i+1 < len ? encode({...tuple(sorted[i+1]), r: 0}) : null; break
  reply {data, nextCursor, ...(skipped && {skipped})}
}) catch → replyError INTERNAL (never [] — D-M5-8)
```

- [ ] **Step 1: Write the failing test** (feed harness — copy the scaffolding from `test/unit/appserver/config-domain.test.ts`, landed in Task 2; it exists in the repo when this task runs):
  - Metadata + content match with snippets under `created_at` asc — global order asserted (oldest first even when the store returns sessions shuffled recency-first).
  - Beyond-budget continuation: >4000 filler rows then a hit → page 1 zero hits with non-null `nextCursor`; page 2 finds it. Inside this test, spy `getSessionMessages` and assert NO call requests `limit > SEARCH_CAPS.windowRows` (plan review F9 — bounds hold at the storage boundary).
  - Deleted-cursor-session resume: take a page cursor, remove that session from the fake store, request page 2 with a spy → no session sorted BEFORE the cursor tuple is fetched again; scanning proceeds from the successor.
  - Store failure → `-32603` (never `[]`); term bounds → `-32602` both ends; `limit: 60` on 60 metadata hits → 50 results + a `warning` line with `code: "limitClamped"` on the wire.
  - Oversized row (>1,048,576 chars) skipped and counted in `skipped` while a later small row still matches.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `schema/search.ts` + `search.ts` per the normative flow. Register with `result: threadSearchResult`.
- [ ] **Step 4: Run** — `npm run emit-schema` (schemaGen.test.ts compares the VENDORED artifacts to a fresh generation, so every method-registering task must regenerate and commit them — pre-flight finding), then search + full unit suite green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): thread/search — tuple resume, windowed honest scans (Task 7)"`

### Task 8: `thread/searchOccurrences`

**Files:** Modify `src/appserver/search.ts`, `src/appserver/schema/search.ts` (+`threadSearchOccurrencesParams` = `{threadId: z.string().min(1), searchTerm, cursor?, limit?}` and result), `src/appserver/schema/index.ts`, `src/appserver/server.ts` · Test `test/unit/appserver/search.test.ts` (append)

**Interfaces:** occurrence = `{ rowOffset: number, uuid: string | null, snippet, snippetMatchRange, readCursor: string | null }`; result = `{ data, nextCursor, skipped? }`; continuation cursor = `encodeOccCursor {s, r, c, e}`.

**Handler deltas from the search handler (all review-driven):**
- **Existence (D-M5-20):** after `resolveThreadId`, when no live record backs the sessionId: `const info = await (srv.deps.getSessionInfo ?? ((sid) => realGetSessionInfo(sid, {})))(sessionId); if (info === undefined) → replyError(ERR.THREAD_NOT_FOUND, "Thread not found")`.
- **Epoch qualification:** live thread → minted cursors carry `e: live.epoch`; an incoming cursor with `e !== null && (!live || e !== live.epoch)` → `-32602` `"cursor invalidated by a rewind; re-read from the start"` (the pager's own message). Cold cursors carry `e: null`.
- **Windowed reads** exactly as Task 7 (share a small `readWindow` helper inside `search.ts`).
- Multi-hit rows resume via `c`: inner loop `for (at = textLc.indexOf(termLc, fromChar); at >= 0; at = textLc.indexOf(termLc, at + 1))`; on limit: mint `{s, r: currentRow, c: at + 1, e}`; `fromChar` applies only when the cursor names the current row.
- `readCursor` = `` `${live.epoch}:${rowOffset + 1}` `` when live, `null` cold — the pager's exclusive-upper-bound convention makes +1 inclusive (verified against `subscribe.ts`).

- [ ] **Step 1: Append the failing tests**
  - Cold thread: fake `getSessionInfo` knows `"cold-session"`; hits across a prompt row and a two-hit assistant row (tool_result rows excluded); assert order, `rowOffset`s, `uuid`s, UTF-16 ranges, `readCursor: null`, `nextCursor: null`. Unknown id → the `THREAD_NOT_FOUND` error code.
  - Live jump: build the live thread from `test/unit/appserver/subscribe.test.ts`'s exact pattern (~line 264: `sessionFactory` fake engine + `getSessionMessages` dep + a fed `thread/start` + the routed init frame that latches `record.sessionId`). For **every** returned occurrence assert `readCursor === \`${record.epoch}:${occ.rowOffset + 1}\``, then feed `thread/read {threadId, cursor: occ.readCursor, limit: 1}` and assert `JSON.stringify(page.data)` contains that occurrence's matched row text (items expose id/text, not uuid — plan review F10; a serialized-content assertion is shape-robust).
  - Same-row page boundary: one row, 3 hits, `limit: 2` → page 1 = two occurrences with equal `rowOffset`; the continuation returns the 3rd (proves `c` resumes WITHIN a row).
  - Epoch invalidation: take a live continuation cursor, `record.epoch += 1` (simulated rewind), resend → `-32602` with the invalidation message.
  - Limit cap: 60 single-hit rows, `limit: 50` → 50 + non-null cursor; continuation yields 10.

- [ ] **Steps 2–4:** red → implement → `npm run emit-schema` (vendored-artifact discipline, as Task 7) → search + full unit suite green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): thread/searchOccurrences — epoch-qualified cursors, proven jumps (Task 8)"`

### Task 9: Archive handlers + admission coordination + exemptions

**Files:** Modify `src/appserver/archive.ts` (add the handlers), `src/appserver/server.ts` (register both; `ENGINE_GONE_EXEMPT` += the trio; admission auto-unarchive in `startThread`'s resume path), `src/appserver/fleet.ts` (attach auto-unarchive) · Test `test/unit/appserver/archive.test.ts` (append)

**Handler contract:**
- Params `threadIdParams`; result `z.object({ ok: z.literal(true) })` — define `okResult` in `schema/core.ts` unless an equivalent exists (check first, reuse if so); both methods register with it.
- **Live-guard** = `findLiveBySessionId(srv, sid) !== undefined || srv.resumingSessions.has(sid)` — checked BEFORE marker creation and AGAIN after; a failed re-check unlinks the marker and refuses `ERR.BUSY` `"Thread is live in this server — close it first"` (plan review F12: a resume mid-admission holds only the reservation).
- **Existence (D-M5-20):** archive of a cold session requires `getSessionInfo(sid)` to return a row, else `THREAD_NOT_FOUND`. Unarchive proceeds when a marker exists OR the store knows the session; both absent → `THREAD_NOT_FOUND`.
- **Share the store-knows ATOM, not the refusal (Task 8 report, concern 4 — controller-adjudicated).**
  Task 8 raised that its five-line existence refusal and this task's will drift on what *"the store does
  not know this session"* means. The concern is right; its proposed fix is not. **The three admission
  rules are genuinely different predicates and must stay different** — `thread/searchOccurrences` admits
  on `live record OR store row`; `thread/archive` admits on `store row` alone, because a live thread is
  separately refused `ERR.BUSY` by the live-guard above (importing Task 8's live-record fallback here
  would admit exactly the case this method must reject); `thread/unarchive` admits on `marker OR store
  row`. Extracting the whole refusal would flatten three rules into one and invert `archive`.
  What actually must not drift is the **single atom all three share** — the store lookup and its
  dependency-injection default, which Task 8 spells at `src/appserver/search.ts:257`:
  ```ts
  const getInfo = srv.deps.getSessionInfo ?? ((sid: string) => realGetSessionInfo(sid, {}));
  ```
  **Do this:** lift that one binding into a shared exported helper (suggested: `storeKnows(srv, sid):
  Promise<boolean>` beside the other shared server helpers, or a `resolveGetInfo(srv)` accessor if you
  prefer to keep the await at the call site), repoint `search.ts:257` at it in the same commit, and
  compose each of the three admission rules from it locally. Re-spelling the binding inline is the
  defect to avoid: the unit tests inject through `srv.deps`, so a handler that omits the `srv.deps`
  override reads the **real** session store while its tests still pass — green for the wrong reason,
  which is the failure mode this milestone has already paid for twice.
  Pin it: one row asserting the injected `deps.getSessionInfo` is what each new handler consults (assert
  the injected spy was called, not merely that the reply was right — a handler reading the real store can
  still produce a correct-looking refusal).
- **`ENGINE_GONE_EXEMPT`** (`server.ts:185`): add `"thread/searchOccurrences"`, `"thread/archive"`, `"thread/unarchive"` with the comment `// M5: disk/sidecar reads that must answer for a thread whose engine died (spec rev 3)`.
- **Error mapping (Task 5 review, item 2) — the store throws protocol-free, this handler maps.** Task 5's
  store throws a bare `Error` from `checkId` and lets raw errnos escape; both now cross the wire from a
  public method. Follow the repo's existing hybrid, which is what `configWrite.ts` and `configDomain.ts`
  already do: the store stays protocol-free, the handler assigns the code.
  - Give `checkId` a **typed** error and map it to `-32602` here. This is belt-and-braces, not the primary
    defense: both handlers run the D-M5-20 existence check first, and a path-hostile `threadId` is by
    construction not a session `getSessionInfo` knows, so it refuses `THREAD_NOT_FOUND` before the store
    is touched. Worth having anyway because `threadIdParams` is only `z.string().min(1)`
    (`schema/core.ts:4`), so **the ordering is the whole defense** — D-M5-18a's own words for this shape:
    fail closed by design with a diagnosable message rather than by accident with an opaque one.
  - **Leave errnos on `-32603`.** `ENOTDIR` from a corrupted state directory and `EACCES` describe the
    *server's* inability, not the client's parameter, so internal is the correct code — D-M5-18a rules
    against reporting a server failure as though it described the client's data, not against errnos as
    such (`readTargetDoc` puts an errno message straight into its `ConfigError`). **Strip the absolute
    path from the message**: as written it carries the operator's home directory onto the wire.
  - **Case-collision note (Task 5 review, Minor 3):** the store's marker names are case-sensitive while
    APFS and NTFS are not, so `archive("ABCdef")` then `archive("abcdef")` both report success while
    `listArchived()` returns one name — and `unarchive("abcdef")` would unlink `ABCdef`'s marker. Not
    reachable with today's lowercase-UUID session ids, but this handler is where it would become
    client-visible (`{ok:true}` plus a broadcast, with `thread/list {archived:true}` omitting the row).
    Do not add normalization; assert the current behavior in a row so the assumption is pinned.
- **Admission auto-unarchive (D-M5-21):** in `server.ts`'s `startThread`, on the resume path at the point where admission has SUCCEEDED (record registered, reservation released — read the function first and place it where no later step can fail), and at the equivalent point in `fleet.ts`'s attach:

```ts
    // D-M5-21: opening a conversation takes it off the shelf — and it is what keeps "a live thread is
    // never hidden from the default list" true across servers, since markers are re-read per request.
    if ((await listArchived({ ccxDir: this.deps.ccxDir })).has(sessionId)) {
      await removeArchiveMarker(sessionId, { ccxDir: this.deps.ccxDir });
      this.broadcastServer("thread/unarchived", { sessionId });
    }
```

- No test-only hooks: races are driven for real through the feed harness.

- [ ] **Step 1: Append the failing tests**
  - Cold archive round-trip: fake `getSessionInfo` knows `"cold-1"`; archive → `{ok:true}` + a `thread/archived {sessionId}` notification LINE on a watching connection + marker on disk; unarchive mirrors with `thread/unarchived`; both idempotent; unknown id → `THREAD_NOT_FOUND` for archive AND unarchive-without-marker.
  - Live refusal: `addRecord`-built live thread → archive by registry id → `-33001` `/close it first/`.
  - Reservation refusal: `srv.resumingSessions.add("racing")` directly → archive `"racing"` → `-33001`; marker absent afterward.
  - Real race convergence: fed `thread/resume` (fake `sessionFactory`) and fed `thread/archive` for the same sessionId in the same tick → await both replies → the end state is consistent: session live AND unarchived (marker absent), the archive either refused BUSY or its marker removed by admission.
  - Resume-auto-unarchive: archive a cold session, then feed `thread/resume` for it → marker gone + `thread/unarchived` broadcast observed.
  - Exemption: `addRecord` a thread whose fake engine has `isEnded: () => true`; call occurrences/archive/unarchive by its registry id → none replies `-33005`.

- [ ] **Steps 2–4:** red → implement → `npm run emit-schema` (vendored-artifact discipline, as Task 7) → archive + full unit suite green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): archive handlers — admission-coordinated, exempt, existence-checked (Task 9)"`

### Task 10: `thread/list` archived filter + stage-C gate

**Files:** Modify `src/appserver/schema/threads.ts` (`archived: z.boolean().optional()` on `threadListParams`), `src/appserver/sessionLib.ts` (`threadList`) · `docs/parity/appserver.md` (+4 method rows, +2 notification rows) · Test append in `archive.test.ts`

- [ ] **Step 1: Append the failing test**

```ts
describe("thread/list archived filter", () => {
  it("default hides archived; archived:true shows only archived", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    const sessions = [{ sessionId: "a", summary: "a", lastModified: 1 }, { sessionId: "b", summary: "b", lastModified: 2 }];
    boot({ listSessions: async () => sessions, ccxDir });
    await createArchiveMarker("a", { ccxDir });
    let id = await send("thread/list", {});
    expect(reply(id).result.data.map((r: any) => r.sessionId)).toEqual(["b"]);
    id = await send("thread/list", { archived: true });
    expect(reply(id).result.data.map((r: any) => r.sessionId)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — in `threadList`, after `const merged = [...liveViews, ...storeOnlyViews];`:

```ts
  const archivedSet = await listArchived({ ccxDir: srv.deps.ccxDir });
  const wantArchived = parsed.data.archived === true;
  const filtered = merged.filter((v) => {
    const sid = v.sessionId as string | undefined;
    if (sid === undefined) return !wantArchived; // an unlatched live row cannot be archived
    return archivedSet.has(sid) === wantArchived;
  });
```

and paginate `filtered` instead of `merged` (three renames below). `import { listArchived } from "./archive.js";`.

- [ ] **Step 4: Stage-C gate** — rows for `thread/search` (origin `N/A` — no thread named), `thread/searchOccurrences`, `thread/archive`, `thread/unarchive` (origin `both`) and the two notifications (`both`); the section prose records the covered-by (`config/mcpServer/reload` ≡ our `mcpServer/reconnect`) and the D-M5-6 deviations (`sourceKinds`, `backwardsCursor`, `uuid`-for-`turnId/itemId`, `sessionId` notification payloads). `npm run emit-schema`; drift gate → **exit 0, 66 registered methods, 99 rows**; full unit suite green (existing thread/list tests must stay green — no markers, nothing filtered).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): archived filter — stage C green, 66 methods / 99 rows (Task 10)"`

## Stage D — absorb, acceptance, verification

### Task 11: Totals + coverage narrative

**Files:** Modify `docs/parity/appserver.md` (Totals: restate the per-landing tally sentence for this sweep; the notification recipe 27 → 29 with the two new names; the M5 sentence in "Shipped, per the code"), `docs/parity/coverage.md` (domain-10 cell gains: "**Agent app-server M5 SHIPPED (2026-08-…)** — config read/write over the settings layers, thread search/occurrences, archive markers; 66 methods / 29 notifications, drift-gated").

- [ ] Steps: edit → `node ../scripts/drift-check.mjs` green with tallies matching the prose → full unit suite → commit `docs(as5): totals + coverage — M5 surface recorded (Task 11)`.

### Task 12: SPIKE — probes 111/112, WITH producer-seam identification

**Files:** Create `probes/probes/111-context-usage-structured.ts`, `probes/probes/112-terminal-slash-commands.ts`.

**Questions:** (a) does a headless `/context` turn deliver the 0.3.234 `context_usage` structured sibling, and ON WHICH message; (b) does a headless init carry `terminal_slash_commands`. Spec promote-or-discard verbatim: "What is alive gets wired — the structured card into the context-usage surface, `terminal_slash_commands` as a field on `thread/capabilities/read` … What is dead flips the `full-potential.md` rows and ships nothing."

- [ ] **Step 1:** Build 111 on probe 110's `openStreaming` scaffold: send the literal text `/context`, log every message's `type`/`subtype` and `JSON.stringify(msg.context_usage ?? "ABSENT")`.
- [ ] **Step 2:** Build 112: one `query()` turn ("reply OK"), log `init.terminal_slash_commands ?? "ABSENT"` and `init.slash_commands?.length` from the `system/init` frame.
- [ ] **Step 3:** Run keyed from `probes/` (`set -a; . ../.env; set +a; npx tsx probes/111-…`; likewise 112). Record raw output.
- [ ] **Step 4 (the review-driven duty, F13):** For each ALIVE verdict, name the **producer seam** before anything is wired: for `terminal_slash_commands`, which frame carries it and whether `router.ts`'s `routeInit` (where `record.sessionId` latches) sees it on BOTH origins or inProcess-only — say which the evidence shows. For `context_usage`, whether the appserver's frame router actually receives the carrying frame on the `/context` path — if the frame never reaches us, the verdict is **DEAD-for-us** regardless of the SDK's declaration; record that distinction.
- [ ] **Step 5:** Route verdicts: spec `## Surprises & Discoveries` dated entries; `full-potential.md` rows flipped with evidence.
- [ ] **Step 6: Commit** — `git add ../probes/probes/111* ../probes/probes/112* ../docs && git commit -m "probe(111/112): 0.3.234 absorb verdicts + producer seams (Task 12 spike)"`

### Task 13: Wire the absorb survivors (CONDITIONAL — scope fixed by Task 12's seam notes)

Alive `terminal_slash_commands` → stamp on the record in `routeInit` (the seam Task 12 verified), serve as an optional field from `thread/capabilities/read`, absent-key when the engine never sent it. Alive `context_usage` → forward on the existing item/notification the router already emits for that turn (no retention). **Tests must inject the field through the SAME frame path the probe observed** — a fake that hands the handler a pre-stamped record proves nothing (plan review F13). DEAD on both → ledger line `Task 13: skipped (both probes dead)`, rows flipped, done — spec acceptance 8 is satisfied by the recorded verdicts either way.

Commit `feat(as5): absorb survivors wired through their real seams (Task 13)` (or the skip ledger line).

### Task 14: Keyed live acceptance

**Files:** Create `test/live/appserver-m5-acceptance.test.ts` — gate on the standard `live` describe; scaffold from `test/live/appserver-m4-acceptance.test.ts`; **every config path pointed at a temp `configHome`/`ccxDir`, never the real `~/.claude`**.

Legs: (1) config chain live — plant user+local, read sees deep merge + origins + versions; fresh-then-stale CAS pair → one ok one conflict; local-masked user write → `okOverridden`. (2) search over the real store — real thread, marker turn, close; `thread/search` finds it with a snippet. (3) the jump — live thread, `searchOccurrences` → every `readCursor` fed to `thread/read` unchanged → hit text present. (4) archive round-trip — archive the closed session (hidden by default, shown under `archived:true`, notifications observed on a second subscribed client), then **`thread/resume` it → marker auto-removed + `thread/unarchived` observed (D-M5-21)**; archive of a live thread refuses BUSY.

- [ ] Steps: write (keyless run skips clean) → controller runs keyed (`set -a; . ../.env; set +a; npx vitest run test/live/appserver-m5-acceptance.test.ts`) → commit `test(as5): keyed live acceptance (Task 14)`. (Implementers stop at the clean keyless skip; the controller runs the keyed pass — `harness/CLAUDE.md`'s standing division.)

### Task 15: FINAL VERIFICATION — the spec's acceptance as written

- [ ] `npm run typecheck` → clean; `npx vitest run test/unit` → green; `npx vitest run test/tui` → green.
- [ ] `node ../scripts/drift-check.mjs` → exit 0, `66 registered methods`, `99 rows`, `shipped(M5) 9`.
- [ ] Walk spec acceptance 1–8 against their pinning tests (1↔Tasks 1/2, 2↔Tasks 3/4 CAS, 3↔Task 4 batch, 4↔Task 4 masking/fencing, 5↔Task 7, 6↔Task 8, 7↔Tasks 9/10, 8↔Tasks 12/13). Any unpinned item is a FAIL — fix before proceeding.
- [ ] Controller reruns keyed: M5 acceptance AND M4 acceptance (regression — config/search must not disturb the review domain).
- [ ] Write the spec's `## Outcomes & Retrospective`; refresh `coverage.md` + memory per the milestone ritual; commit.

---

## Self-review notes (author, at plan rev 2)

- Every plan-review finding is either implemented above (F1–F12, F14–F20 → named task deltas) or scoped with the spec's recorded deviation (SettingsSchema non-mirroring, D-M5-5; limit clamp-not-refuse, D-M5-17). F13's producer-seam duty lives in Task 12; F17's ordering fix is Task 5-before-Task 7; F18's per-stage gates are Tasks 2/4/10.
- Handler tests use ONLY the `review-start.test.ts` harness pattern (`srv.connect` + `conn.feed`); no test calls the private `dispatch`.
- The two cursor codecs live beside `compareTuple` in one module so ordering, resume, and mint cannot drift apart; the codecs cross-reject each other's shapes.
- Registered-method arithmetic: 59 + 1 (stage A) + 2 (stage B) + 4 (stage C) = 66; rows 90 + 9 = 99; notifications 27 + 2 = 29.
