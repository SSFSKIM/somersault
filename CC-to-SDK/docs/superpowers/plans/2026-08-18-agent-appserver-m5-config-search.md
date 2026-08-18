# M5 — Config Domain + Thread Search/Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven new app-server methods — `config/read`, `config/value/write`, `config/batchWrite`, `thread/search`, `thread/searchOccurrences`, `thread/archive`, `thread/unarchive` — plus two notifications and an `archived` filter on `thread/list`, per the rev-2 spec `CC-to-SDK/docs/superpowers/specs/2026-08-18-agent-appserver-m5-config-search-design.md` (read it before Task 1; its Decision Log D-M5-1..17 is binding).

**Architecture:** Three independent stages over the existing `src/appserver/` hub: (A) a config-files domain that reads/writes Claude's settings layers with upstream's exact deep-merge semantics, per-leaf origins, and a lock-held compare-and-swap; (B) store search with global keyset ordering, intra-file cursor resume, and hard scan bounds; (C) archive state as per-session marker files. Each stage lands behind the standing registration discipline (zod schema in `methodSchemas` + handler in `server.ts` + scorecard row + drift gate).

**Tech Stack:** TypeScript ESM (`.js` import specifiers), zod v4 (`zod/v4`), vitest, node:crypto/fs/path, the existing appserver spine (`Handler`, `ERR`, `peer.replyError(id, code, msg, data?)`, `broadcastServer`).

## Global Constraints (verbatim from the spec)

- Layer chain: **user** (`~/.claude/settings.json`) < **project** (`<cwd>/.claude/settings.json`) < **local** (`<cwd>/.claude/settings.local.json`) < **managed** (macOS `/Library/Application Support/ClaudeCode/managed-settings.json`, Linux `/etc/claude-code/managed-settings.json`; read-only; absent file = absent layer).
- Merge = upstream's: deep merge for objects, **concatenate-and-dedupe for arrays**; origins are **dotted leaf paths**; array leaves name **every contributing layer** in precedence order.
- `keyPath` is an **array of string segments** (D-M5-12). Merge table (D-M5-13): `replace` sets the leaf; `upsert` deep-merges with the read-side customizer; missing parents created as objects; non-object parent → `ConfigValidationError`, file untouched; `replace` + `value:null` deletes; `upsert` + `null` → `ConfigValidationError`.
- Version token = **sha256 hex of raw file bytes**, `"absent"` for a missing file. CAS = per-file in-process queue **+ pid-stamped lockfile `<file>.lock` held across read→validate→write-tmp→rename** (D-M5-14). Omitted `expectedVersion` = last-wins.
- No arbitrary `filePath` ever. `cwd` must be absolute + existing, canonicalized with `realpath` before composing; responses report the canonical `filePath` (D-M5-4). `target ∈ user|project|local`; managed is not in the enum.
- Unknown top-level keys → `warnings` entry, never a refusal (D-M5-5).
- Config errors ride `error.data.code` ∈ `ConfigVersionConflict | ConfigValidationError` on `-32602` (D-M5-9).
- Writes bind at next engine spawn; **no reload flag** (D-M5-2).
- Search bounds (D-M5-17): `searchTerm` 2–256 UTF-16 units; `limit` ≤ 50 (default 20); snippet ≤ 200 units centered; ≤ **40 files** and ≤ **4000 rows** examined per page; **1 MiB row cap** (skipped rows counted in `skipped`); one content scan at a time per server.
- Sort tokens Codex-verbatim: `created_at | updated_at | recency_at` (`recency_at` ≡ `lastModified`; missing `createdAt` sorts last); tiebreak `sessionId`; keyset cursor `(sortValue, sessionId, rowIndex)`; a page may return zero matches with non-null `nextCursor` (D-M5-15/16).
- Search honesty (D-M5-8): a store read failure is an **error**, never `[]`.
- Occurrence fields: `snippet`, `snippetMatchRange {start,end}` (UTF-16), row `uuid`, `rowOffset`, and `readCursor` = `"<epoch>:<rowOffset+1>"` on a live thread, `null` cold (D-M5-7).
- Archive: marker files `<ccxDir>/archived/<sessionId>`; create/unlink idempotent (`EEXIST`/`ENOENT` → `{ok:true}`); live-guard refuses then **re-checks after marker creation** (unlink + BUSY if a resume won) (D-M5-3/10). Responses `{ok:true}`; notifications `thread/archived` / `thread/unarchived` carry `{sessionId}`.
- Wire names verbatim; `sourceKinds`/`backwardsCursor` deliberately absent (D-M5-6).
- House rules: dense hand-style (no Prettier), `.js` import specifiers, DI-by-deps with call-site defaults, TDD, no `Co-Authored-By` in commits. All commands run from `CC-to-SDK/harness/`.

## File Structure

- Create `src/appserver/configLayers.ts` — layer paths, read+parse, upstream merge, leaf origins. Pure + DI fs.
- Create `src/appserver/configWrite.ts` — `ConfigError`, `applyEdit` merge table, `versionToken`, `withFileLock` CAS.
- Create `src/appserver/configDomain.ts` — the three config handlers.
- Create `src/appserver/schema/config.ts` — zod params for the config trio.
- Create `src/appserver/searchScan.ts` — sort, cursor codec, row text, snippet. Pure.
- Create `src/appserver/search.ts` — `thread/search` + `thread/searchOccurrences` handlers, exclusive-scan chain.
- Create `src/appserver/schema/search.ts` — zod params for the search pair.
- Create `src/appserver/archive.ts` — marker store + archive/unarchive handlers.
- Modify `src/appserver/schema/threads.ts` — `threadListParams` gains `archived`.
- Modify `src/appserver/sessionLib.ts` — export `resolveThreadId` + `findLiveBySessionId`; `threadList` applies the archived filter.
- Modify `src/appserver/schema/index.ts` + `src/appserver/server.ts` — register all seven methods; `AppServerDeps` gains `configHome?`, `managedSettingsPath?`, `ccxDir?`.
- Create `probes/probes/111-context-usage-structured.ts`, `probes/probes/112-terminal-slash-commands.ts` (absorb spikes).
- Create `test/unit/appserver/config-layers.test.ts`, `config-write.test.ts`, `config-domain.test.ts`, `search-scan.test.ts`, `search.test.ts`, `archive.test.ts`; `test/live/appserver-m5-acceptance.test.ts`.
- Modify `docs/parity/appserver.md` (rows), `docs/parity/coverage.md` (note), regen `harness/schema/json/*` via `npm run emit-schema`.

---

## Stage A — config read

### Task 1: Layer reading, upstream merge, leaf origins (`configLayers.ts`)

**Files:**
- Create: `src/appserver/configLayers.ts`
- Test: `test/unit/appserver/config-layers.test.ts`

**Interfaces:**
- Consumes: nothing new (node:fs/promises, node:path, node:os).
- Produces (later tasks rely on these exact signatures):
  - `type LayerName = "user" | "project" | "local" | "managed"`
  - `interface ConfigLayer { name: LayerName; filePath: string; config?: Record<string, unknown>; disabledReason?: string }`
  - `layerPaths(homeDir: string, managedSettingsPath: string, cwd?: string): Array<{ name: LayerName; filePath: string }>` — precedence order user→project→local→managed
  - `readLayers(paths, deps?): Promise<ConfigLayer[]>` — absent file = layer omitted; unparseable = `disabledReason`
  - `settingsMerge(target: unknown, source: unknown): unknown` — deep objects, concat+dedupe arrays, source wins scalars
  - `effectiveView(layers: ConfigLayer[]): { config: Record<string, unknown>; origins: Record<string, LayerName | LayerName[]> }`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/config-layers.test.ts
import { describe, it, expect } from "vitest";
import { layerPaths, readLayers, settingsMerge, effectiveView, type ConfigLayer } from "../../../src/appserver/configLayers.js";

const L = (name: ConfigLayer["name"], config?: Record<string, unknown>, disabledReason?: string): ConfigLayer =>
  ({ name, filePath: `/x/${name}.json`, ...(config ? { config } : {}), ...(disabledReason ? { disabledReason } : {}) });

describe("configLayers", () => {
  it("layerPaths: user+managed without cwd; all four with cwd, in precedence order", () => {
    expect(layerPaths("/home/u", "/etc/m.json").map((p) => p.name)).toEqual(["user", "managed"]);
    const all = layerPaths("/home/u", "/etc/m.json", "/proj");
    expect(all.map((p) => p.name)).toEqual(["user", "project", "local", "managed"]);
    expect(all[0].filePath).toBe("/home/u/.claude/settings.json");
    expect(all[1].filePath).toBe("/proj/.claude/settings.json");
    expect(all[2].filePath).toBe("/proj/.claude/settings.local.json");
    expect(all[3].filePath).toBe("/etc/m.json");
  });
  it("settingsMerge: objects deep, arrays concat+dedupe, scalars source-wins", () => {
    expect(settingsMerge({ a: { x: 1 }, keep: 1 }, { a: { y: 2 } })).toEqual({ a: { x: 1, y: 2 }, keep: 1 });
    expect(settingsMerge({ p: ["A", "B"] }, { p: ["B", "C"] })).toEqual({ p: ["A", "B", "C"] });
    expect(settingsMerge({ m: "user" }, { m: "local" })).toEqual({ m: "local" });
    expect(settingsMerge(["A"], { o: 1 })).toEqual({ o: 1 }); // type change: source replaces
  });
  it("effectiveView: deep merge across layers with leaf origins; arrays name every contributor", () => {
    const { config, origins } = effectiveView([
      L("user", { permissions: { allow: ["WebFetch"] }, model: "opus" }),
      L("local", { permissions: { deny: ["Bash"] }, model: "sonnet" }),
    ]);
    expect(config).toEqual({ permissions: { allow: ["WebFetch"], deny: ["Bash"] }, model: "sonnet" });
    expect(origins["permissions.allow"]).toEqual(["user"]);
    expect(origins["permissions.deny"]).toEqual(["local"]);
    expect(origins["model"]).toBe("local"); // scalar leaf: single winner
  });
  it("effectiveView: an array contributed by two layers lists both in precedence order", () => {
    const { config, origins } = effectiveView([
      L("user", { permissions: { allow: ["A"] } }),
      L("project", { permissions: { allow: ["B"] } }),
    ]);
    expect(config).toEqual({ permissions: { allow: ["A", "B"] } });
    expect(origins["permissions.allow"]).toEqual(["user", "project"]);
  });
  it("effectiveView: a disabled layer contributes nothing", () => {
    const { config } = effectiveView([L("user", { model: "opus" }), L("local", undefined, "invalid JSON")]);
    expect(config).toEqual({ model: "opus" });
  });
  it("readLayers: absent file omitted, unparseable file becomes disabledReason", async () => {
    const files: Record<string, string> = { "/x/user.json": `{"model":"opus"}`, "/x/local.json": `{not json` };
    const deps = { readFile: async (p: string) => { if (p in files) return files[p]; const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; } };
    const layers = await readLayers([
      { name: "user", filePath: "/x/user.json" }, { name: "project", filePath: "/x/project.json" }, { name: "local", filePath: "/x/local.json" },
    ], deps);
    expect(layers.map((l) => l.name)).toEqual(["user", "local"]);
    expect(layers[0].config).toEqual({ model: "opus" });
    expect(layers[1].config).toBeUndefined();
    expect(layers[1].disabledReason).toMatch(/JSON/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/config-layers.test.ts`
Expected: FAIL — cannot resolve `../../../src/appserver/configLayers.js`.

- [ ] **Step 3: Implement**

```ts
// src/appserver/configLayers.ts — the settings-files layer chain (spec M5 §config, D-M5-1/5).
// Merge semantics are UPSTREAM'S OWN (Claude Code Src settings.ts settingsMergeCustomizer): deep merge
// for objects, concatenate-and-DEDUPE for arrays, source wins scalars/type-changes. Origins are dotted
// LEAF paths (Codex's fingerprint granularity): a value leaf names its single winning layer, an
// array-valued leaf names EVERY contributing layer in precedence order — with deep merge there is no
// single winner for a composite key, and pretending otherwise was rev 1's untruth (review F1).
import { readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";

export type LayerName = "user" | "project" | "local" | "managed";
export interface ConfigLayer { name: LayerName; filePath: string; config?: Record<string, unknown>; disabledReason?: string }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Precedence order (lowest→highest): user < project < local < managed. Without a cwd there is no
 *  project/local pair to resolve — user + managed only. */
export function layerPaths(homeDir: string, managedSettingsPath: string, cwd?: string): Array<{ name: LayerName; filePath: string }> {
  const out: Array<{ name: LayerName; filePath: string }> = [{ name: "user", filePath: join(homeDir, ".claude", "settings.json") }];
  if (cwd) {
    out.push({ name: "project", filePath: join(cwd, ".claude", "settings.json") });
    out.push({ name: "local", filePath: join(cwd, ".claude", "settings.local.json") });
  }
  out.push({ name: "managed", filePath: managedSettingsPath });
  return out;
}

/** Absent file = absent layer (never an error); unparseable or non-object = a layer entry with
 *  `disabledReason` and no config — healthy layers still serve (spec: config/read never hides them). */
export async function readLayers(
  paths: Array<{ name: LayerName; filePath: string }>,
  deps: { readFile: (p: string) => Promise<string> } = { readFile: (p) => fsReadFile(p, "utf8") },
): Promise<ConfigLayer[]> {
  const out: ConfigLayer[] = [];
  for (const { name, filePath } of paths) {
    let raw: string;
    try { raw = await deps.readFile(filePath); }
    catch (e) { if ((e as NodeJS.ErrnoException)?.code === "ENOENT") continue; out.push({ name, filePath, disabledReason: String((e as Error).message ?? e) }); continue; }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isPlainObject(parsed)) { out.push({ name, filePath, disabledReason: "settings file is not a JSON object" }); continue; }
      out.push({ name, filePath, config: parsed });
    } catch (e) { out.push({ name, filePath, disabledReason: `invalid JSON: ${(e as Error).message}` }); }
  }
  return out;
}

const uniqJson = (a: unknown[]): unknown[] => {
  const seen = new Set<string>();
  return a.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
};

/** Upstream's customizer, exactly: arrays concat+dedupe, plain objects merge deep, anything else the
 *  source replaces (including type changes). Never mutates its inputs. */
export function settingsMerge(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) return uniqJson([...target, ...source]);
  if (isPlainObject(target) && isPlainObject(source)) {
    const out: Record<string, unknown> = { ...target };
    for (const [k, v] of Object.entries(source)) out[k] = k in out ? settingsMerge(out[k], v) : v;
    return out;
  }
  return source;
}

/** Dotted leaf paths of one layer's config. A leaf is any non-plain-object value (arrays included) or
 *  an empty object. Dots inside a key are left as-is — origins are a REPORTING surface, and the write
 *  side's keyPath is an array of segments precisely so no path grammar has to round-trip (D-M5-12). */
function leafPaths(obj: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length > 0) out.push(...leafPaths(v, path));
    else out.push([path, v]);
  }
  return out;
}

/** The effective merge + per-leaf origins over layers given in precedence order (lowest first). */
export function effectiveView(layers: ConfigLayer[]): { config: Record<string, unknown>; origins: Record<string, LayerName | LayerName[]> } {
  let config: Record<string, unknown> = {};
  const contributors = new Map<string, LayerName[]>();
  for (const layer of layers) {
    if (!layer.config) continue;
    config = settingsMerge(config, layer.config) as Record<string, unknown>;
    for (const [path] of leafPaths(layer.config)) {
      const list = contributors.get(path) ?? [];
      if (!list.includes(layer.name)) list.push(layer.name);
      contributors.set(path, list);
    }
  }
  const origins: Record<string, LayerName | LayerName[]> = {};
  for (const [path, value] of leafPaths(config)) {
    const list = contributors.get(path);
    if (!list) continue; // a merged-into-existence intermediate; its own leaves are attributed
    origins[path] = Array.isArray(value) ? list : list[list.length - 1];
  }
  return { config, origins };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/appserver/config-layers.test.ts` — Expected: PASS (6 tests).
Run: `npm run typecheck` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/appserver/configLayers.ts test/unit/appserver/config-layers.test.ts
git commit -m "feat(as5): settings layer chain — upstream-exact merge, per-leaf origins (Task 1)"
```

### Task 2: `config/read` — schema, handler, registration

**Files:**
- Create: `src/appserver/schema/config.ts`, `src/appserver/configDomain.ts`
- Modify: `src/appserver/schema/index.ts` (import + 1 entry), `src/appserver/server.ts` (import + 1 handlers entry + 3 `AppServerDeps` slots)
- Test: `test/unit/appserver/config-domain.test.ts`

**Interfaces:**
- Consumes: Task 1's `layerPaths`/`readLayers`/`effectiveView`; the `Handler` type + `ERR` from `./server.js`/`./rpc.js`.
- Produces: `configReadParams` zod schema; handler `configRead`; **`AppServerDeps` gains `configHome?: string`, `managedSettingsPath?: string`, `ccxDir?: string`** (Tasks 3–10 use them); helper `resolveConfigCwd(cwd, deps): Promise<string>` (throws `ConfigError`-shaped `{code:"ConfigValidationError"}` on relative/missing paths) exported from `configDomain.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/config-domain.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer } from "../../../src/appserver/server.js";

// wireDirect convention used across the appserver unit suites: drive handleRequest and capture replies.
function wire(deps: Record<string, unknown>) {
  const out: any[] = [];
  const srv = new AppServer({}, deps as any);
  const peer = { reply: (id: any, result: any) => out.push({ id, result }), replyError: (id: any, code: number, message: string, data?: unknown) => out.push({ id, error: { code, message, data } }), notify: () => {} };
  const ctx = { peer, clientInfo: { name: "t" }, connId: 1 } as any;
  return { srv, ctx, out, call: (method: string, params: unknown, id: number) => (srv as any).dispatch(ctx, { id, method, params }) };
}

let home: string, proj: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "m5home-"));
  proj = mkdtempSync(join(tmpdir(), "m5proj-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(proj, ".claude"), { recursive: true });
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true }); });

describe("config/read", () => {
  it("merges the chain, attributes leaf origins, flags incompleteness", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", permissions: { allow: ["WebFetch"] } }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: "sonnet", permissions: { deny: ["Bash"] } }));
    const { call, out } = wire({ configHome: home, managedSettingsPath: join(home, "managed.json") });
    await call("config/read", { cwd: proj }, 1);
    const r = out.find((o) => o.id === 1)?.result;
    expect(r.config).toEqual({ model: "sonnet", permissions: { allow: ["WebFetch"], deny: ["Bash"] } });
    expect(r.origins["model"]).toBe("local");
    expect(r.origins["permissions.allow"]).toEqual(["user"]);
    expect(r.incomplete).toBe(true);
    expect(r.layers).toBeUndefined(); // opt-in only
  });
  it("includeLayers returns raw per-layer parses; a malformed layer carries disabledReason", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    writeFileSync(join(proj, ".claude", "settings.json"), "{broken");
    const { call, out } = wire({ configHome: home, managedSettingsPath: join(home, "managed.json") });
    await call("config/read", { cwd: proj, includeLayers: true }, 1);
    const r = out.find((o) => o.id === 1)?.result;
    expect(r.config).toEqual({ model: "opus" });
    const projLayer = r.layers.find((l: any) => l.name === "project");
    expect(projLayer.disabledReason).toMatch(/JSON/);
    expect(r.layers.find((l: any) => l.name === "user").config).toEqual({ model: "opus" });
  });
  it("relative or nonexistent cwd refuses -32602 with ConfigValidationError", async () => {
    const { call, out } = wire({ configHome: home, managedSettingsPath: join(home, "managed.json") });
    await call("config/read", { cwd: "relative/path" }, 1);
    expect(out.find((o) => o.id === 1)?.error?.data).toEqual({ code: "ConfigValidationError" });
    await call("config/read", { cwd: join(proj, "nope") }, 2);
    expect(out.find((o) => o.id === 2)?.error?.code).toBe(-32602);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/appserver/config-domain.test.ts` → FAIL ("config/read" unknown method / module missing).

- [ ] **Step 3: Implement schema + handler + registration**

```ts
// src/appserver/schema/config.ts — the config trio's params (spec M5, D-M5-12).
import { z } from "zod/v4";

export const configReadParams = z.object({
  includeLayers: z.boolean().optional(),
  cwd: z.string().min(1).optional(),
});
export const keyPathParam = z.array(z.string().min(1)).min(1).max(32);
export const configTargetParam = z.enum(["user", "project", "local"]);
export const configValueWriteParams = z.object({
  keyPath: keyPathParam,
  value: z.unknown(),
  mergeStrategy: z.enum(["replace", "upsert"]),
  target: configTargetParam.default("user"),
  cwd: z.string().min(1).optional(),
  expectedVersion: z.string().min(1).optional(),
});
export const configBatchWriteParams = z.object({
  edits: z.array(z.object({ keyPath: keyPathParam, value: z.unknown(), mergeStrategy: z.enum(["replace", "upsert"]) })).min(1).max(64),
  target: configTargetParam.default("user"),
  cwd: z.string().min(1).optional(),
  expectedVersion: z.string().min(1).optional(),
});
```

```ts
// src/appserver/configDomain.ts — config/read (this task), config/value/write + config/batchWrite (Task 4).
// A FILES surface with upstream's own merge semantics; the engine's applied view stays on
// thread/settings/read + get_settings and this module never pretends otherwise (spec M5 §config).
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { homedir, platform } from "node:os";
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { layerPaths, readLayers, effectiveView } from "./configLayers.js";
import { configReadParams } from "./schema/config.js";

export const DEFAULT_MANAGED_PATH = platform() === "darwin"
  ? "/Library/Application Support/ClaudeCode/managed-settings.json"
  : "/etc/claude-code/managed-settings.json";

export class ConfigError extends Error {
  constructor(public code: "ConfigVersionConflict" | "ConfigValidationError", message: string) { super(message); }
}

/** cwd must be ABSOLUTE and EXISTING, and is canonicalized before any path composes off it (D-M5-4:
 *  a symlinked path writes where it really points, and the response reports the canonical truth). */
export async function resolveConfigCwd(cwd: string, deps: { realpath: (p: string) => Promise<string> } = { realpath }): Promise<string> {
  if (!isAbsolute(cwd)) throw new ConfigError("ConfigValidationError", "cwd must be an absolute path");
  try { return await deps.realpath(cwd); }
  catch { throw new ConfigError("ConfigValidationError", `cwd does not exist: ${cwd}`); }
}

export const configRead: Handler = async (srv, ctx, id, params) => {
  const parsed = configReadParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const home = srv.deps.configHome ?? homedir();
  const managed = srv.deps.managedSettingsPath ?? DEFAULT_MANAGED_PATH;
  try {
    const cwd = parsed.data.cwd !== undefined ? await resolveConfigCwd(parsed.data.cwd) : undefined;
    const layers = await readLayers(layerPaths(home, managed, cwd));
    const { config, origins } = effectiveView(layers);
    // `incomplete` is CONSTANT true by design: non-file policy sources (remote managed sync, MDM/registry)
    // are invisible to a files read, and this server cannot detect their absence — the engine's own
    // get_settings view is the complete one (spec: the completeness statement).
    ctx.peer.reply(id, { config, origins, incomplete: true, ...(parsed.data.includeLayers ? { layers } : {}) });
  } catch (e) {
    if (e instanceof ConfigError) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, e.message, { code: e.code }); return; }
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};
```

In `src/appserver/schema/index.ts` add to the imports and registry:

```ts
import { configReadParams, configValueWriteParams, configBatchWriteParams } from "./config.js";
// … in methodSchemas:
  "config/read": { params: configReadParams },
```

In `src/appserver/server.ts`: add to `AppServerDeps` (after the session-store slots):

```ts
  // M5: the config-files domain + archive markers. `configHome` is the base of the user layer
  // (`<configHome>/.claude/settings.json`), defaulted to os.homedir() at each call site so tests
  // point the whole domain at a temp dir; `managedSettingsPath` likewise overrides the platform
  // managed file; `ccxDir` is the server-state dir (`~/.claude/ccx`) the archive markers live under.
  configHome?: string;
  managedSettingsPath?: string;
  ccxDir?: string;
```

and register the handler (import `configRead` from `./configDomain.js`; add `"config/read": configRead,` to the handlers table beside `"review/start"`).

- [ ] **Step 4: Run tests** — `npx vitest run test/unit/appserver/config-domain.test.ts` → PASS; `npm run typecheck` → clean. NOTE: the drift gate will FAIL from this task until Task 10's scorecard rows land — that is expected mid-plan; do not "fix" it by unregistering methods.

- [ ] **Step 5: Commit**

```bash
git add src/appserver/schema/config.ts src/appserver/configDomain.ts src/appserver/schema/index.ts src/appserver/server.ts test/unit/appserver/config-domain.test.ts
git commit -m "feat(as5): config/read — layered effective view with per-leaf origins (Task 2)"
```

## Stage B — config writes

### Task 3: The merge table, version token, and lock-held CAS (`configWrite.ts`)

**Files:**
- Create: `src/appserver/configWrite.ts`
- Test: `test/unit/appserver/config-write.test.ts`

**Interfaces:**
- Consumes: Task 1's `settingsMerge`; Task 2's `ConfigError` (move it — **`ConfigError` lives here from this task on**, `configDomain.ts` re-imports it from `./configWrite.js`).
- Produces:
  - `applyEdit(doc: Record<string, unknown>, keyPath: string[], value: unknown, strategy: "replace" | "upsert"): Record<string, unknown>` — returns a NEW doc, throws `ConfigError("ConfigValidationError", …)` per the merge table.
  - `versionToken(bytes: string | null): string` — sha256 hex, `"absent"` for null.
  - `withFileLock<T>(filePath: string, fn: () => Promise<T>, deps?): Promise<T>` — in-process per-path chain + `<file>.lock` pid-stamped `wx` lockfile, stale-broken after 10s.
  - `readTargetDoc(filePath, deps?): Promise<{ doc: Record<string, unknown>; version: string }>` — throws `ConfigValidationError` on malformed JSON.
  - `writeTargetDoc(filePath, doc, deps?): Promise<{ version: string }>` — 2-space JSON + trailing newline, tmp+rename.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/config-write.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { applyEdit, versionToken, withFileLock, readTargetDoc, writeTargetDoc, ConfigError } from "../../../src/appserver/configWrite.js";

describe("applyEdit (D-M5-13 merge table)", () => {
  it("replace sets the leaf exactly; siblings survive", () => {
    expect(applyEdit({ a: { x: 1 } }, ["a", "y"], 2, "replace")).toEqual({ a: { x: 1, y: 2 } });
    expect(applyEdit({ a: { x: 1, y: [1] } }, ["a", "y"], "z", "replace")).toEqual({ a: { x: 1, y: "z" } });
  });
  it("upsert deep-merges with the read-side customizer (arrays concat+dedupe)", () => {
    expect(applyEdit({ p: { allow: ["A"] } }, ["p"], { allow: ["A", "B"] }, "upsert")).toEqual({ p: { allow: ["A", "B"] } });
  });
  it("missing parents are created as objects; a non-object parent refuses untouched", () => {
    expect(applyEdit({}, ["a", "b", "c"], 1, "replace")).toEqual({ a: { b: { c: 1 } } });
    const doc = { a: 5 };
    expect(() => applyEdit(doc, ["a", "b"], 1, "replace")).toThrow(ConfigError);
    expect(doc).toEqual({ a: 5 });
  });
  it("replace null deletes; upsert null refuses; a dotted segment is one key", () => {
    expect(applyEdit({ a: 1, b: 2 }, ["a"], null, "replace")).toEqual({ b: 2 });
    expect(() => applyEdit({ a: 1 }, ["a"], null, "upsert")).toThrow(ConfigError);
    expect(applyEdit({}, ["k.with.dots"], 1, "replace")).toEqual({ "k.with.dots": 1 });
  });
  it("never mutates its input", () => {
    const doc = { a: { x: 1 } };
    applyEdit(doc, ["a", "y"], 2, "replace");
    expect(doc).toEqual({ a: { x: 1 } });
  });
});

describe("versionToken + docs io", () => {
  it("token is sha256 of raw bytes; absent for missing", () => {
    expect(versionToken(null)).toBe("absent");
    expect(versionToken("x")).toBe(createHash("sha256").update("x").digest("hex"));
  });
  it("readTargetDoc: missing file = empty doc + absent; malformed refuses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5w-"));
    expect(await readTargetDoc(join(dir, "no.json"))).toEqual({ doc: {}, version: "absent" });
    writeFileSync(join(dir, "bad.json"), "{nope");
    await expect(readTargetDoc(join(dir, "bad.json"))).rejects.toThrow(ConfigError);
  });
  it("writeTargetDoc round-trips through readTargetDoc with a matching token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5w-"));
    const p = join(dir, "s.json");
    const { version } = await writeTargetDoc(p, { model: "opus" });
    const back = await readTargetDoc(p);
    expect(back.doc).toEqual({ model: "opus" });
    expect(back.version).toBe(version);
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
  });
});

describe("withFileLock (D-M5-14)", () => {
  it("serializes concurrent critical sections on one path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5l-"));
    const p = join(dir, "s.json");
    const order: string[] = [];
    await Promise.all([
      withFileLock(p, async () => { order.push("a-in"); await new Promise((r) => setTimeout(r, 40)); order.push("a-out"); }),
      withFileLock(p, async () => { order.push("b-in"); order.push("b-out"); }),
    ]);
    expect(order).toEqual(["a-in", "a-out", "b-in", "b-out"]);
    expect(existsSync(p + ".lock")).toBe(false); // released
  });
  it("breaks a stale foreign lockfile instead of hanging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5l-"));
    const p = join(dir, "s.json");
    writeFileSync(p + ".lock", "999999"); // dead pid, old mtime is simulated via staleMs=0
    const got = await withFileLock(p, async () => "ran", { staleMs: 0 });
    expect(got).toBe("ran");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/appserver/config-write.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/appserver/configWrite.ts — the write half's primitives (spec D-M5-13/14; review F2/F3).
// The version check is ATOMIC WITH THE WRITE, not advisory: callers run read→validate→write inside
// withFileLock, which stacks an in-process per-path promise chain (two requests in this server) UNDER
// a pid-stamped <file>.lock (two servers on this machine). tmp+rename alone was rev 1's TOCTOU.
import { readFile, writeFile, rename, open, unlink, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { settingsMerge } from "./configLayers.js";

export class ConfigError extends Error {
  constructor(public code: "ConfigVersionConflict" | "ConfigValidationError", message: string) { super(message); }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** D-M5-13, exactly: replace sets (null deletes); upsert deep-merges with the READ side's customizer
 *  (null refuses); parents created as objects; a non-object on the parent path refuses with the doc
 *  untouched. Pure — returns a new doc. keyPath segments are opaque keys (D-M5-12): no grammar. */
export function applyEdit(doc: Record<string, unknown>, keyPath: string[], value: unknown, strategy: "replace" | "upsert"): Record<string, unknown> {
  if (keyPath.length === 0) throw new ConfigError("ConfigValidationError", "keyPath must not be empty");
  const out = { ...doc };
  let node = out;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const seg = keyPath[i];
    const cur = node[seg];
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
  node[leaf] = leaf in node ? settingsMerge(node[leaf], value) : value;
  return out;
}

export function versionToken(bytes: string | null): string {
  return bytes === null ? "absent" : createHash("sha256").update(bytes).digest("hex");
}

export async function readTargetDoc(filePath: string, deps: { readFile: typeof readFile } = { readFile }): Promise<{ doc: Record<string, unknown>; version: string }> {
  let raw: string;
  try { raw = await deps.readFile(filePath, "utf8") as string; }
  catch (e) { if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { doc: {}, version: "absent" }; throw e; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ConfigError("ConfigValidationError", "target settings file is not valid JSON; fix it before writing through this API"); }
  if (!isPlainObject(parsed)) throw new ConfigError("ConfigValidationError", "target settings file is not a JSON object");
  return { doc: parsed, version: versionToken(raw) };
}

export async function writeTargetDoc(filePath: string, doc: Record<string, unknown>): Promise<{ version: string }> {
  const bytes = JSON.stringify(doc, null, 2) + "\n";
  const tmp = `${filePath}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  await writeFile(tmp, bytes, "utf8");
  await rename(tmp, filePath);
  return { version: versionToken(bytes) };
}

const chains = new Map<string, Promise<unknown>>();

/** In-process chain + on-disk lockfile. The lockfile is pid-stamped and considered stale after
 *  `staleMs` (default 10s) — a crashed writer must not wedge every future write. Polling, not
 *  fs.watch: the hold time is milliseconds, and a 25ms poll is simpler than a watcher's edge cases. */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>, opts: { staleMs?: number } = {}): Promise<T> {
  const staleMs = opts.staleMs ?? 10_000;
  const lockPath = `${filePath}.lock`;
  const prev = chains.get(filePath) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const deadline = Date.now() + staleMs + 5_000;
    for (;;) {
      try { const fh = await open(lockPath, "wx"); await fh.writeFile(String(process.pid)); await fh.close(); break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
        try { const s = await stat(lockPath); if (Date.now() - s.mtimeMs > staleMs) { await unlink(lockPath).catch(() => {}); continue; } } catch { continue; }
        if (Date.now() > deadline) throw new ConfigError("ConfigValidationError", "config target is locked by another writer");
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    try { return await fn(); } finally { await unlink(lockPath).catch(() => {}); }
  });
  chains.set(filePath, run);
  run.finally(() => { if (chains.get(filePath) === run) chains.delete(filePath); }).catch(() => {});
  return run as Promise<T>;
}
```

Also in `src/appserver/configDomain.ts`: delete its local `ConfigError` class and `import { ConfigError } from "./configWrite.js";` instead.

- [ ] **Step 4: Run tests** — `npx vitest run test/unit/appserver/config-write.test.ts test/unit/appserver/config-domain.test.ts` → PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/appserver/configWrite.ts src/appserver/configDomain.ts test/unit/appserver/config-write.test.ts
git commit -m "feat(as5): merge table + sha256 version token + lock-held CAS (Task 3)"
```

### Task 4: `config/value/write` + `config/batchWrite` handlers

**Files:**
- Modify: `src/appserver/configDomain.ts`, `src/appserver/schema/index.ts`, `src/appserver/server.ts`
- Test: `test/unit/appserver/config-domain.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 1–3 exactly as produced.
- Produces: handlers `configValueWrite`, `configBatchWrite`; both registered. Response shape `{status: "ok"|"okOverridden", version, filePath, overriddenMetadata?, warnings?}`.

- [ ] **Step 1: Append the failing tests**

```ts
describe("config/value/write + batchWrite", () => {
  const deps = () => ({ configHome: home, managedSettingsPath: join(home, "managed.json") });
  it("user-target upsert lands on disk, versions round-trip, stale CAS refuses byte-identical", async () => {
    const { call, out } = wire(deps());
    await call("config/value/write", { keyPath: ["permissions", "allow"], value: ["WebFetch"], mergeStrategy: "upsert" }, 1);
    const w1 = out.find((o) => o.id === 1)?.result;
    expect(w1.status).toBe("ok");
    expect(w1.filePath).toBe(join(home, ".claude", "settings.json"));
    const bytes = readFileSync(w1.filePath, "utf8");
    expect(JSON.parse(bytes)).toEqual({ permissions: { allow: ["WebFetch"] } });
    // stale token: reuse the PRE-write version ("absent") now that the file exists
    await call("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace", expectedVersion: "absent" }, 2);
    const e2 = out.find((o) => o.id === 2)?.error;
    expect(e2?.code).toBe(-32602);
    expect(e2?.data).toEqual({ code: "ConfigVersionConflict" });
    expect(readFileSync(w1.filePath, "utf8")).toBe(bytes); // untouched
    // fresh token: succeeds
    await call("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace", expectedVersion: w1.version }, 3);
    expect(out.find((o) => o.id === 3)?.result.status).toBe("ok");
  });
  it("two same-expectedVersion writers: exactly one ok, one ConfigVersionConflict", async () => {
    const { call, out } = wire(deps());
    await call("config/value/write", { keyPath: ["a"], value: 1, mergeStrategy: "replace" }, 1);
    const v = out.find((o) => o.id === 1)?.result.version;
    await Promise.all([
      call("config/value/write", { keyPath: ["b"], value: 2, mergeStrategy: "replace", expectedVersion: v }, 2),
      call("config/value/write", { keyPath: ["c"], value: 3, mergeStrategy: "replace", expectedVersion: v }, 3),
    ]);
    const results = [out.find((o) => o.id === 2), out.find((o) => o.id === 3)];
    expect(results.filter((r) => r?.result?.status === "ok")).toHaveLength(1);
    expect(results.filter((r) => r?.error?.data?.code === "ConfigVersionConflict")).toHaveLength(1);
  });
  it("okOverridden names the masking layer for a scalar leaf local also defines", async () => {
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: "sonnet" }));
    const { call, out } = wire(deps());
    await call("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace", target: "user", cwd: proj }, 1);
    const r = out.find((o) => o.id === 1)?.result;
    expect(r.status).toBe("okOverridden");
    expect(r.overriddenMetadata.overridingLayer).toBe("local");
    expect(r.overriddenMetadata.effectiveValue).toBe("sonnet");
  });
  it("unknown top-level key lands with a warning; project target without cwd refuses", async () => {
    const { call, out } = wire(deps());
    await call("config/value/write", { keyPath: ["notARealSetting"], value: 1, mergeStrategy: "replace" }, 1);
    expect(out.find((o) => o.id === 1)?.result.warnings?.[0]).toMatch(/notARealSetting/);
    await call("config/value/write", { keyPath: ["model"], value: "x", mergeStrategy: "replace", target: "project" }, 2);
    expect(out.find((o) => o.id === 2)?.error?.data?.code).toBe("ConfigValidationError");
  });
  it("batchWrite is ordered and atomic: a failing third edit leaves the file byte-identical", async () => {
    const { call, out } = wire(deps());
    await call("config/value/write", { keyPath: ["scalar"], value: 5, mergeStrategy: "replace" }, 1);
    const before = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    await call("config/batchWrite", { edits: [
      { keyPath: ["a"], value: 1, mergeStrategy: "replace" },
      { keyPath: ["b"], value: 2, mergeStrategy: "replace" },
      { keyPath: ["scalar", "child"], value: 3, mergeStrategy: "replace" }, // parent is 5 → refuses
    ] }, 2);
    expect(out.find((o) => o.id === 2)?.error?.data?.code).toBe("ConfigValidationError");
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(before);
    await call("config/batchWrite", { edits: [
      { keyPath: ["a"], value: ["x"], mergeStrategy: "replace" },
      { keyPath: ["a"], value: ["y"], mergeStrategy: "upsert" },
    ] }, 3);
    expect(out.find((o) => o.id === 3)?.result.status).toBe("ok");
    expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).a).toEqual(["x", "y"]); // in order
  });
});
```

- [ ] **Step 2: Run to verify failure** — new describe FAILs (methods unregistered).

- [ ] **Step 3: Implement** (append to `configDomain.ts`)

```ts
import { configValueWriteParams, configBatchWriteParams } from "./schema/config.js";
import { applyEdit, readTargetDoc, writeTargetDoc, withFileLock, ConfigError } from "./configWrite.js";
import { join } from "node:path";

/** Advisory only (D-M5-5): a key outside this list WARNS — upstream tolerates unknown keys, so must we.
 *  Curated from upstream's SettingsSchema top level; extend freely, never refuse on it. */
const KNOWN_TOP_LEVEL = new Set(["permissions", "env", "model", "hooks", "statusLine", "apiKeyHelper",
  "includeCoAuthoredBy", "cleanupPeriodDays", "additionalDirectories", "defaultMode", "outputStyle",
  "enableAllProjectMcpServers", "enabledMcpjsonServers", "disabledMcpjsonServers", "forceLoginMethod",
  "disableBypassPermissionsMode", "sandbox", "alwaysThinkingEnabled", "spinnerTipsEnabled", "attributions"]);

async function resolveTarget(srv: Parameters<Handler>[0], target: "user" | "project" | "local", cwd: string | undefined): Promise<string> {
  const home = srv.deps.configHome ?? homedir();
  if (target === "user") return join(home, ".claude", "settings.json");
  if (cwd === undefined) throw new ConfigError("ConfigValidationError", `target "${target}" requires cwd`);
  const real = await resolveConfigCwd(cwd);
  return join(real, ".claude", target === "project" ? "settings.json" : "settings.local.json");
}

/** Shared spine of the two write methods: lock → read+CAS → apply edits in order → single write →
 *  masking check. `edits` is one-element for config/value/write; the batch is atomic BY CONSTRUCTION
 *  (one in-memory doc, one final write — a failed edit throws before any byte moves; review F2). */
async function runConfigWrite(srv: Parameters<Handler>[0], ctx: Parameters<Handler>[1], id: Parameters<Handler>[2],
  data: { edits: Array<{ keyPath: string[]; value: unknown; mergeStrategy: "replace" | "upsert" }>; target: "user" | "project" | "local"; cwd?: string; expectedVersion?: string }): Promise<void> {
  try {
    const filePath = await resolveTarget(srv, data.target, data.cwd);
    const result = await withFileLock(filePath, async () => {
      const { doc, version } = await readTargetDoc(filePath);
      if (data.expectedVersion !== undefined && data.expectedVersion !== version)
        throw new ConfigError("ConfigVersionConflict", `expectedVersion ${data.expectedVersion} does not match current ${version}`);
      let next = doc;
      for (const e of data.edits) next = applyEdit(next, e.keyPath, e.value, e.mergeStrategy);
      const { version: newVersion } = await writeTargetDoc(filePath, next);
      return { newVersion };
    });
    const warnings = data.edits.filter((e) => !KNOWN_TOP_LEVEL.has(e.keyPath[0])).map((e) => `unknown top-level settings key "${e.keyPath[0]}" (written anyway)`);
    // Masking check (okOverridden, scalar/object leaves only — array leaves merge by contribution):
    // recompute the chain and ask whether a HIGHER-precedence layer than the target defines the same leaf.
    const home = srv.deps.configHome ?? homedir();
    const managed = srv.deps.managedSettingsPath ?? DEFAULT_MANAGED_PATH;
    const cwdReal = data.cwd !== undefined ? await resolveConfigCwd(data.cwd) : undefined;
    const layers = await readLayers(layerPaths(home, managed, cwdReal));
    const order: Array<"user" | "project" | "local" | "managed"> = ["user", "project", "local", "managed"];
    const above = order.slice(order.indexOf(data.target) + 1);
    let overridden: { message: string; overridingLayer: string; effectiveValue: unknown } | undefined;
    const last = data.edits[data.edits.length - 1];
    const leafOf = (cfg: Record<string, unknown> | undefined): { present: boolean; value?: unknown } => {
      let node: unknown = cfg;
      for (const seg of last.keyPath) { if (typeof node !== "object" || node === null || Array.isArray(node)) return { present: false }; node = (node as Record<string, unknown>)[seg]; if (node === undefined) return { present: false }; }
      return { present: true, value: node };
    };
    for (const name of above) {
      const layer = layers.find((l) => l.name === name);
      const hit = leafOf(layer?.config);
      if (hit.present && !Array.isArray(hit.value)) overridden = { message: `the ${name} layer defines this key with higher precedence`, overridingLayer: name, effectiveValue: hit.value };
    }
    ctx.peer.reply(id, {
      status: overridden ? "okOverridden" : "ok", version: result.newVersion, filePath,
      ...(overridden ? { overriddenMetadata: overridden } : {}), ...(warnings.length ? { warnings } : {}),
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

Register both: `schema/index.ts` gains `"config/value/write": { params: configValueWriteParams }` and `"config/batchWrite": { params: configBatchWriteParams }`; `server.ts` handlers gain `configValueWrite` / `configBatchWrite`.

- [ ] **Step 4: Run** — `npx vitest run test/unit/appserver/config-domain.test.ts test/unit/appserver/config-write.test.ts` → PASS; typecheck clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): config/value/write + config/batchWrite — CAS, okOverridden, warnings (Task 4)"`

## Stage C — search

### Task 5: Sort, cursor codec, row text, snippet (`searchScan.ts`)

**Files:**
- Create: `src/appserver/searchScan.ts`
- Test: `test/unit/appserver/search-scan.test.ts`

**Interfaces:**
- Consumes: `rowKind`, `promptText` from `../sessions/index.js`.
- Produces:
  - `SEARCH_CAPS = { maxFilesPerPage: 40, maxRowsPerPage: 4000, maxRowBytes: 1048576, maxLimit: 50, defaultLimit: 20, minTerm: 2, maxTerm: 256, snippetMax: 200 }`
  - `type SortKey = "created_at" | "updated_at" | "recency_at"`
  - `sortValueOf(info: {createdAt?: number; lastModified: number}, key: SortKey): number | null`
  - `sortForSearch<T extends {sessionId: string}>(rows: T[], key: SortKey, dir: "asc" | "desc", valueOf: (r: T) => number | null): T[]` — null values last in both directions, tiebreak sessionId asc
  - `encodeSearchCursor(c: {v: number | null; s: string; r: number}): string` / `decodeSearchCursor(s: string): {v: number | null; s: string; r: number} | null` (base64url JSON)
  - `rowSearchText(m: unknown): string | null` — corpus text of one row (`prompt` rows via `promptText`; assistant rows' text blocks joined with `\n`), `null` for out-of-corpus rows
  - `makeSnippet(text: string, start: number, len: number): { snippet: string; snippetMatchRange: { start: number; end: number } }` — ≤ 200 UTF-16 units centered on the match, range relative to the snippet

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/search-scan.test.ts
import { describe, it, expect } from "vitest";
import { SEARCH_CAPS, sortForSearch, sortValueOf, encodeSearchCursor, decodeSearchCursor, rowSearchText, makeSnippet } from "../../../src/appserver/searchScan.js";

describe("searchScan", () => {
  it("sortForSearch: created_at asc puts the true global oldest first; missing createdAt last; sessionId tiebreak", () => {
    const rows = [
      { sessionId: "b", createdAt: 200, lastModified: 1 }, { sessionId: "a", createdAt: 200, lastModified: 2 },
      { sessionId: "c", createdAt: 100, lastModified: 3 }, { sessionId: "d", lastModified: 4 },
    ];
    const asc = sortForSearch(rows, "created_at", "asc", (r) => sortValueOf(r as any, "created_at"));
    expect(asc.map((r) => r.sessionId)).toEqual(["c", "a", "b", "d"]);
    const desc = sortForSearch(rows, "created_at", "desc", (r) => sortValueOf(r as any, "created_at"));
    expect(desc.map((r) => r.sessionId)).toEqual(["a", "b", "c", "d"]); // nulls still last
  });
  it("cursor codec round-trips and rejects garbage", () => {
    const c = { v: 123, s: "sess", r: 7 };
    expect(decodeSearchCursor(encodeSearchCursor(c))).toEqual(c);
    expect(decodeSearchCursor("not-a-cursor")).toBeNull();
  });
  it("rowSearchText: prompts and assistant text are corpus; tool_results and echoes are not", () => {
    expect(rowSearchText({ type: "user", uuid: "u1", message: { content: "hello world" } })).toBe("hello world");
    expect(rowSearchText({ type: "assistant", message: { content: [{ type: "text", text: "found it" }, { type: "tool_use", name: "X", input: {} }] } })).toBe("found it");
    expect(rowSearchText({ type: "user", message: { content: [{ type: "tool_result", content: "noise" }] } })).toBeNull();
    expect(rowSearchText({ type: "user", uuid: "u2", message: { content: "<command-name>/clear</command-name>" } })).toBeNull();
  });
  it("makeSnippet: centered, capped at 200 units, range indexes into the snippet", () => {
    const long = "x".repeat(500) + "NEEDLE" + "y".repeat(500);
    const { snippet, snippetMatchRange } = makeSnippet(long, 500, 6);
    expect(snippet.length).toBeLessThanOrEqual(SEARCH_CAPS.snippetMax);
    expect(snippet.slice(snippetMatchRange.start, snippetMatchRange.end)).toBe("NEEDLE");
  });
});
```

- [ ] **Step 2: Run to verify failure** — module missing.

- [ ] **Step 3: Implement**

```ts
// src/appserver/searchScan.ts — pure search primitives (spec D-M5-15/16/17). Ordering is GLOBAL (a
// full metadata sort — metadata, not transcripts, so it is cheap); only the CONTENT scan is paged.
// The cursor is a keyset (sortValue, sessionId, rowIndex): the last examined session and the row
// within it, so caps bound work per request, never coverage (rev 1's byte cap was review F6).
import { rowKind, promptText } from "../sessions/index.js";

export const SEARCH_CAPS = { maxFilesPerPage: 40, maxRowsPerPage: 4000, maxRowBytes: 1_048_576, maxLimit: 50, defaultLimit: 20, minTerm: 2, maxTerm: 256, snippetMax: 200 } as const;
export type SortKey = "created_at" | "updated_at" | "recency_at";

export function sortValueOf(info: { createdAt?: number; lastModified: number }, key: SortKey): number | null {
  if (key === "created_at") return info.createdAt ?? null;
  return info.lastModified; // updated_at and recency_at are both lastModified on this store (spec D-M5-6)
}

export function sortForSearch<T extends { sessionId: string }>(rows: T[], _key: SortKey, dir: "asc" | "desc", valueOf: (r: T) => number | null): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = valueOf(a), vb = valueOf(b);
    if (va === null && vb === null) return a.sessionId < b.sessionId ? -1 : 1;
    if (va === null) return 1; // nulls last in BOTH directions
    if (vb === null) return -1;
    if (va !== vb) return (va - vb) * sign;
    return a.sessionId < b.sessionId ? -1 : 1;
  });
}

export function encodeSearchCursor(c: { v: number | null; s: string; r: number }): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
export function decodeSearchCursor(s: string): { v: number | null; s: string; r: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as { v?: unknown; s?: unknown; r?: unknown };
    if ((typeof parsed.v !== "number" && parsed.v !== null) || typeof parsed.s !== "string" || typeof parsed.r !== "number") return null;
    return { v: parsed.v, s: parsed.s, r: parsed.r };
  } catch { return null; }
}

/** The occurrence corpus (spec: Codex's "visible user messages and final assistant messages", via OUR
 *  classifier so search and replay cannot drift): user rows classified `prompt` by rows.ts, and
 *  assistant rows' text blocks. Everything else — tool_results, command echoes, caveats, compaction
 *  summaries — is out of corpus and returns null. */
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
  const max = SEARCH_CAPS.snippetMax;
  const pad = Math.max(0, Math.floor((max - len) / 2));
  const from = Math.max(0, start - pad);
  const snippet = text.slice(from, from + Math.max(max, len));
  return { snippet, snippetMatchRange: { start: start - from, end: start - from + len } };
}
```

- [ ] **Step 4: Run** — PASS + typecheck clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): search primitives — global keyset sort, cursor codec, corpus text, snippet (Task 5)"`

### Task 6: `thread/search` handler

**Files:**
- Create: `src/appserver/schema/search.ts`, `src/appserver/search.ts`
- Modify: `src/appserver/schema/index.ts`, `src/appserver/server.ts`, `src/appserver/sessionLib.ts` (add `export` to `resolveThreadId` and `findLiveBySessionId` — two-word diffs)
- Test: `test/unit/appserver/search.test.ts`

**Interfaces:**
- Consumes: Task 5 primitives; `storeOnlyView` + newly-exported `findLiveBySessionId` from `./sessionLib.js`; `threadView` from `./server.js`; `srv.deps.listSessions` / `srv.deps.getSessionMessages` (existing DI slots).
- Produces: `threadSearchParams`; handler `threadSearch`; `runScanExclusive(srv, fn)` (module-level `WeakMap<AppServer, Promise>` chain — Task 7 reuses it). Result rows `{thread, snippet}`; reply `{data, nextCursor, skipped?}`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/search.test.ts
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";

const S = (sessionId: string, extra: Record<string, unknown> = {}) => ({ sessionId, summary: sessionId, lastModified: 1000, createdAt: 1000, ...extra });
// wire(): COPY VERBATIM from test/unit/appserver/config-domain.test.ts (landed in Task 2 — it exists
// in the repo when this task runs; each appserver test file owns its own scaffolding by convention).
function wire(deps: Record<string, unknown>) { /* paste Task 2's wire() body here, unchanged */ }

describe("thread/search", () => {
  it("finds a metadata match and a content match with snippets; results follow the global sort", async () => {
    const sessions = [S("old", { createdAt: 100, customTitle: "the auth bug fix" }), S("new", { createdAt: 900 })];
    const rowsBySession: Record<string, unknown[]> = {
      old: [], new: [{ type: "user", uuid: "u1", message: { content: "we fixed the auth bug here" } }],
    };
    const { call, out } = wire({ listSessions: async () => sessions, getSessionMessages: async (id: string) => rowsBySession[id] ?? [], ccxDir: "/nonexistent-ccx" });
    await call("thread/search", { searchTerm: "auth bug", sortKey: "created_at", sortDirection: "asc" }, 1);
    const r = out.find((o) => o.id === 1)?.result;
    expect(r.data).toHaveLength(2);
    expect(r.data[0].thread.sessionId).toBe("old");   // global asc order, oldest first
    expect(r.data[0].snippet).toContain("auth bug");
    expect(r.data[1].snippet).toContain("auth bug");
    expect(r.nextCursor).toBeNull();
  });
  it("a match beyond one page's row budget is found via nextCursor continuation (zero-hit page allowed)", async () => {
    const filler = Array.from({ length: 4100 }, (_, i) => ({ type: "user", uuid: `f${i}`, message: { content: `filler ${i}` } }));
    const sessions = [S("big")];
    const rows = [...filler, { type: "user", uuid: "hit", message: { content: "the NEEDLE row" } }];
    const { call, out } = wire({ listSessions: async () => sessions, getSessionMessages: async () => rows, ccxDir: "/nonexistent-ccx" });
    await call("thread/search", { searchTerm: "NEEDLE" }, 1);
    const p1 = out.find((o) => o.id === 1)?.result;
    expect(p1.data).toHaveLength(0);
    expect(p1.nextCursor).not.toBeNull();          // bounded progress, honestly reported
    await call("thread/search", { searchTerm: "NEEDLE", cursor: p1.nextCursor }, 2);
    const p2 = out.find((o) => o.id === 2)?.result;
    expect(p2.data).toHaveLength(1);
    expect(p2.data[0].snippet).toContain("NEEDLE");
  });
  it("a store read failure is an ERROR, never zero hits", async () => {
    const { call, out } = wire({ listSessions: async () => { throw new Error("EACCES: store dir unreadable"); }, ccxDir: "/nonexistent-ccx" });
    await call("thread/search", { searchTerm: "anything" }, 1);
    expect(out.find((o) => o.id === 1)?.error?.code).toBe(-32603);
  });
  it("term bounds refuse: too short and too long", async () => {
    const { call, out } = wire({ listSessions: async () => [], ccxDir: "/nonexistent-ccx" });
    await call("thread/search", { searchTerm: "x" }, 1);
    expect(out.find((o) => o.id === 1)?.error?.code).toBe(-32602);
    await call("thread/search", { searchTerm: "y".repeat(300) }, 2);
    expect(out.find((o) => o.id === 2)?.error?.code).toBe(-32602);
  });
  it("an oversized row is skipped and counted, not silently ignored", async () => {
    const rows = [{ type: "user", uuid: "big", message: { content: "z".repeat(1_100_000) } }, { type: "user", uuid: "u", message: { content: "small NEEDLE" } }];
    const { call, out } = wire({ listSessions: async () => [S("s1")], getSessionMessages: async () => rows, ccxDir: "/nonexistent-ccx" });
    await call("thread/search", { searchTerm: "NEEDLE" }, 1);
    const r = out.find((o) => o.id === 1)?.result;
    expect(r.data).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```ts
// src/appserver/schema/search.ts
import { z } from "zod/v4";
export const threadSearchParams = z.object({
  searchTerm: z.string(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().optional(),
  sortKey: z.enum(["created_at", "updated_at", "recency_at"]).default("created_at"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  archived: z.boolean().optional(),
  cwd: z.string().optional(),
});
export const threadSearchOccurrencesParams = z.object({
  threadId: z.string().min(1),
  searchTerm: z.string(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().optional(),
});
```

```ts
// src/appserver/search.ts — thread/search + thread/searchOccurrences (spec M5 §search; D-M5-6/7/8/15/16/17).
import { ERR } from "./rpc.js";
import type { AppServer, Handler } from "./server.js";
import { threadView } from "./server.js";
import { storeOnlyView, findLiveBySessionId, resolveThreadId } from "./sessionLib.js";
import { listSessions as realListSessions, getSessionMessages as realGetSessionMessages } from "../sessions/index.js";
import { SEARCH_CAPS, sortForSearch, sortValueOf, encodeSearchCursor, decodeSearchCursor, rowSearchText, makeSnippet, type SortKey } from "./searchScan.js";
import { threadSearchParams, threadSearchOccurrencesParams } from "./schema/search.js";
import { listArchived } from "./archive.js"; // Task 8; until it lands, stub `listArchived = async () => new Set()` locally and note it

// ONE content scan at a time per server (D-M5-17): a second search/occurrences request queues.
const scanChains = new WeakMap<AppServer, Promise<unknown>>();
export function runScanExclusive<T>(srv: AppServer, fn: () => Promise<T>): Promise<T> {
  const prev = scanChains.get(srv) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  scanChains.set(srv, run);
  return run;
}

const termError = (t: string): string | null =>
  t.length < SEARCH_CAPS.minTerm ? `searchTerm must be at least ${SEARCH_CAPS.minTerm} characters`
  : t.length > SEARCH_CAPS.maxTerm ? `searchTerm must be at most ${SEARCH_CAPS.maxTerm} characters` : null;

export const threadSearch: Handler = async (srv, ctx, id, params) => {
  const parsed = threadSearchParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const bad = termError(parsed.data.searchTerm);
  if (bad) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, bad); return; }
  const cursor = parsed.data.cursor !== undefined ? decodeSearchCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor !== undefined && cursor === null) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid cursor"); return; }
  const limit = Math.min(parsed.data.limit ?? SEARCH_CAPS.defaultLimit, SEARCH_CAPS.maxLimit);
  const termLc = parsed.data.searchTerm.toLowerCase();
  await runScanExclusive(srv, async () => {
    try {
      const listFn = srv.deps.listSessions ?? realListSessions;
      const getMessages = srv.deps.getSessionMessages ?? ((sid: string) => realGetSessionMessages(sid, {}));
      const all = (await listFn({ cwd: parsed.data.cwd })) as Array<{ sessionId: string; createdAt?: number; lastModified: number; summary: string; customTitle?: string; firstPrompt?: string; tag?: string }>;
      const archivedSet = await listArchived({ ccxDir: srv.deps.ccxDir });
      const wantArchived = parsed.data.archived === true;
      const rows = all.filter((r) => archivedSet.has(r.sessionId) === wantArchived);
      const key = parsed.data.sortKey as SortKey;
      const sorted = sortForSearch(rows, key, parsed.data.sortDirection, (r) => sortValueOf(r, key));
      // Resume strictly AT the cursor's session (its rowIndex says where inside it), else from the top.
      let startIdx = 0;
      if (cursor) { const i = sorted.findIndex((r) => r.sessionId === cursor.s); startIdx = i >= 0 ? i : 0; }
      const data: Array<{ thread: Record<string, unknown>; snippet: string }> = [];
      let filesScanned = 0, rowsScanned = 0, skipped = 0;
      let nextCursor: string | null = null;
      for (let i = startIdx; i < sorted.length; i++) {
        const info = sorted[i];
        let startRow = cursor && cursor.s === info.sessionId ? cursor.r : 0;
        // Metadata corpus first (free), only when entering the session fresh:
        if (startRow === 0) {
          const meta = [info.customTitle, info.summary, info.firstPrompt, info.tag].filter((x): x is string => typeof x === "string");
          const hitText = meta.find((t) => t.toLowerCase().includes(termLc));
          if (hitText) {
            const at = hitText.toLowerCase().indexOf(termLc);
            data.push({ thread: viewFor(srv, info), snippet: makeSnippet(hitText, at, termLc.length).snippet });
            if (data.length >= limit) { nextCursor = i + 1 < sorted.length ? encodeSearchCursor({ v: sortValueOf(sorted[i + 1], key), s: sorted[i + 1].sessionId, r: 0 }) : null; break; }
            continue; // metadata hit — the session is IN the results; no content scan needed for thread-level search
          }
        }
        // Content scan, budgeted:
        if (filesScanned >= SEARCH_CAPS.maxFilesPerPage || rowsScanned >= SEARCH_CAPS.maxRowsPerPage) {
          nextCursor = encodeSearchCursor({ v: sortValueOf(info, key), s: info.sessionId, r: startRow }); break;
        }
        filesScanned++;
        const messages = await getMessages(info.sessionId);
        let found = false;
        let r = startRow;
        for (; r < messages.length; r++) {
          if (rowsScanned >= SEARCH_CAPS.maxRowsPerPage) break;
          rowsScanned++;
          const text = rowSearchText(messages[r]);
          if (text === null) continue;
          if (text.length > SEARCH_CAPS.maxRowBytes) { skipped++; continue; }
          const at = text.toLowerCase().indexOf(termLc);
          if (at >= 0) { data.push({ thread: viewFor(srv, info), snippet: makeSnippet(text, at, termLc.length).snippet }); found = true; r++; break; }
        }
        if (r < messages.length && !found) { nextCursor = encodeSearchCursor({ v: sortValueOf(info, key), s: info.sessionId, r }); break; } // budget ran out mid-file
        if (found && data.length >= limit) { nextCursor = i + 1 < sorted.length ? encodeSearchCursor({ v: sortValueOf(sorted[i + 1], key), s: sorted[i + 1].sessionId, r: 0 }) : null; break; }
      }
      ctx.peer.reply(id, { data, nextCursor, ...(skipped ? { skipped } : {}) });
    } catch (e) {
      ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e)); // D-M5-8: never [] for a failed read
    }
  });
};

function viewFor(srv: AppServer, info: { sessionId: string } & Record<string, unknown>): Record<string, unknown> {
  const live = findLiveBySessionId(srv, info.sessionId);
  return live ? threadView(srv, live) : storeOnlyView(info as never);
}
```

Register `"thread/search"` in `methodSchemas` + handlers. Until Task 8 lands, put `const listArchived = async (_: {ccxDir?: string}) => new Set<string>();` at the top of `search.ts` with a `// Task 8 replaces this stub with ./archive.js's real reader` comment instead of the import.

- [ ] **Step 4: Run** — search tests PASS; whole unit suite still green: `npx vitest run test/unit` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): thread/search — global order, budgeted honest scan (Task 6)"`

### Task 7: `thread/searchOccurrences` + the jump contract

**Files:**
- Modify: `src/appserver/search.ts`, `src/appserver/schema/index.ts`, `src/appserver/server.ts`
- Test: `test/unit/appserver/search.test.ts` (append)

**Interfaces:**
- Consumes: `resolveThreadId` (exported in Task 6); the pager's cursor convention (`"<epoch>:<rowOffset+1>"` — `subscribe.ts` treats the row offset as an EXCLUSIVE upper bound and returns the newest rows below it, so +1 makes the window END at the hit row).
- Produces: handler `threadSearchOccurrences`; occurrence shape `{rowOffset, uuid, snippet, snippetMatchRange, readCursor}`.

- [ ] **Step 1: Append the failing tests**

```ts
describe("thread/searchOccurrences", () => {
  const ROWS = [
    { type: "user", uuid: "u0", message: { content: "alpha NEEDLE one" } },
    { type: "assistant", message: { content: [{ type: "text", text: "beta NEEDLE two and NEEDLE three" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "NEEDLE not in corpus" }] } },
  ];
  it("returns ordered occurrences with UTF-16 ranges, uuids, rowOffsets; cold thread readCursor null", async () => {
    const { call, out } = wire({ listSessions: async () => [], getSessionMessages: async () => ROWS, ccxDir: "/nonexistent-ccx" });
    await call("thread/searchOccurrences", { threadId: "cold-session", searchTerm: "NEEDLE" }, 1);
    const r = out.find((o) => o.id === 1)?.result;
    expect(r.data).toHaveLength(3); // two in the assistant row, one in the prompt; tool_result excluded
    expect(r.data[0]).toMatchObject({ rowOffset: 0, uuid: "u0", readCursor: null });
    expect(r.data[0].snippet.slice(r.data[0].snippetMatchRange.start, r.data[0].snippetMatchRange.end)).toBe("NEEDLE");
    expect(r.data[1].rowOffset).toBe(1);
    expect(r.data[2].rowOffset).toBe(1); // second hit in the same row
    expect(r.nextCursor).toBeNull();
  });
  it("live thread: readCursor is epoch-qualified inclusive and thread/read consumes it unchanged", async () => {
    // Start a real in-process thread against a fake engine, latch its sessionId, then verify the
    // readCursor a search returns is exactly what thread/read accepts and that the returned window's
    // NEWEST row is the hit row. Build wireWithLiveThread() from test/unit/appserver/subscribe.test.ts's
    // exact pattern (~line 264: a sessionFactory fake engine + a getSessionMessages dep + startThread +
    // the routed init frame that latches record.sessionId) — read that file first; it is the contract.
    const { srv, call, out } = wireWithLiveThread("live-sess", ROWS); // helper: copy the pager test's setup
    await call("thread/searchOccurrences", { threadId: "live-sess", searchTerm: "NEEDLE" }, 10);
    const r = out.find((o) => o.id === 10)?.result;
    const record = srv.registry.list()[0];
    expect(r.data[0].readCursor).toBe(`${record.epoch}:1`); // rowOffset 0 + 1
    await call("thread/read", { threadId: record.id, cursor: r.data[0].readCursor, limit: 1 }, 11);
    const page = out.find((o) => o.id === 11)?.result;
    expect(page.data[page.data.length - 1]).toMatchObject({ uuid: "u0" }); // window ENDS at the hit
  });
  it("occurrence limit caps hits with a continuation cursor", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ type: "user", uuid: `u${i}`, message: { content: `row NEEDLE ${i}` } }));
    const { call, out } = wire({ listSessions: async () => [], getSessionMessages: async () => many, ccxDir: "/nonexistent-ccx" });
    await call("thread/searchOccurrences", { threadId: "cold", searchTerm: "NEEDLE", limit: 50 }, 1);
    const r = out.find((o) => o.id === 1)?.result;
    expect(r.data).toHaveLength(50);
    expect(r.nextCursor).not.toBeNull();
    await call("thread/searchOccurrences", { threadId: "cold", searchTerm: "NEEDLE", cursor: r.nextCursor }, 2);
    expect(out.find((o) => o.id === 2)?.result.data).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** (append to `search.ts`)

```ts
export const threadSearchOccurrences: Handler = async (srv, ctx, id, params) => {
  const parsed = threadSearchOccurrencesParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const bad = termError(parsed.data.searchTerm);
  if (bad) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, bad); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  const cursor = parsed.data.cursor !== undefined ? decodeSearchCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor !== undefined && cursor === null) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid cursor"); return; }
  const limit = Math.min(parsed.data.limit ?? SEARCH_CAPS.defaultLimit, SEARCH_CAPS.maxLimit);
  const termLc = parsed.data.searchTerm.toLowerCase();
  await runScanExclusive(srv, async () => {
    try {
      const getMessages = srv.deps.getSessionMessages ?? ((sid: string) => realGetSessionMessages(sid, {}));
      const messages = await getMessages(resolved.sessionId);
      // The jump contract (D-M5-7): live thread → the pager's own epoch-qualified INCLUSIVE cursor
      // ("<epoch>:<rowOffset+1>" — subscribe.ts's offset is an exclusive upper bound, so +1 makes the
      // returned window END at the hit); cold → null, the occurrence is self-contained.
      const live = findLiveBySessionId(srv, resolved.sessionId);
      const data: Array<Record<string, unknown>> = [];
      let rowsScanned = 0, skipped = 0;
      let nextCursor: string | null = null;
      let r = cursor?.s === resolved.sessionId ? cursor.r : 0;
      let fromChar = cursor?.s === resolved.sessionId && cursor.v !== null ? cursor.v : 0;
      outer: for (; r < messages.length; r++, fromChar = 0) {
        if (rowsScanned >= SEARCH_CAPS.maxRowsPerPage) { nextCursor = encodeSearchCursor({ v: 0, s: resolved.sessionId, r }); break; }
        rowsScanned++;
        const text = rowSearchText(messages[r]);
        if (text === null) continue;
        if (text.length > SEARCH_CAPS.maxRowBytes) { skipped++; continue; }
        const textLc = text.toLowerCase();
        for (let at = textLc.indexOf(termLc, fromChar); at >= 0; at = textLc.indexOf(termLc, at + 1)) {
          const { snippet, snippetMatchRange } = makeSnippet(text, at, termLc.length);
          data.push({
            rowOffset: r, uuid: (messages[r] as { uuid?: string }).uuid ?? null, snippet, snippetMatchRange,
            readCursor: live ? `${live.epoch}:${r + 1}` : null,
          });
          if (data.length >= limit) { nextCursor = encodeSearchCursor({ v: at + 1, s: resolved.sessionId, r }); break outer; }
        }
      }
      ctx.peer.reply(id, { data, nextCursor, ...(skipped ? { skipped } : {}) });
    } catch (e) { ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e)); }
  });
};
```

Register `"thread/searchOccurrences"` in both tables. (The occurrence cursor reuses the keyset codec with `v` = the in-row character resume position — document that in a one-line comment where it is minted.)

- [ ] **Step 4: Run** — search tests + full unit suite PASS; typecheck clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): thread/searchOccurrences — corpus hits with a consumable inclusive jump (Task 7)"`

## Stage D — archive

### Task 8: Marker store + `thread/archive` / `thread/unarchive`

**Files:**
- Create: `src/appserver/archive.ts`
- Modify: `src/appserver/search.ts` (swap the Task-6 stub for the real `listArchived` import), `src/appserver/schema/index.ts`, `src/appserver/server.ts`
- Test: `test/unit/appserver/archive.test.ts`

**Interfaces:**
- Consumes: `resolveThreadId`, `findLiveBySessionId` from `./sessionLib.js`; `srv.broadcastServer`.
- Produces: `listArchived(deps: {ccxDir?: string}): Promise<Set<string>>`, `createArchiveMarker(sessionId, deps)`, `removeArchiveMarker(sessionId, deps)`; handlers `threadArchive`, `threadUnarchive` (both take `threadIdParams`).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/appserver/archive.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listArchived, createArchiveMarker, removeArchiveMarker } from "../../../src/appserver/archive.js";
// wire() as in config-domain.test.ts; wireWithLiveThread() as in search.test.ts.

describe("archive markers", () => {
  it("create/list/remove round-trip; both directions idempotent; absent dir = empty set", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    expect(await listArchived({ ccxDir: join(ccxDir, "never-made") })).toEqual(new Set());
    await createArchiveMarker("sess-1", { ccxDir });
    await createArchiveMarker("sess-1", { ccxDir }); // EEXIST → fine
    expect(await listArchived({ ccxDir })).toEqual(new Set(["sess-1"]));
    await removeArchiveMarker("sess-1", { ccxDir });
    await removeArchiveMarker("sess-1", { ccxDir }); // ENOENT → fine
    expect(await listArchived({ ccxDir })).toEqual(new Set());
  });
  it("a path-hostile sessionId refuses instead of composing a path", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    await expect(createArchiveMarker("../escape", { ccxDir })).rejects.toThrow(/sessionId/);
  });
});

describe("thread/archive + thread/unarchive", () => {
  it("archives a cold session: {ok:true}, broadcast, marker on disk; unarchive mirrors", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    const notes: any[] = [];
    const { srv, call, out } = wire({ listSessions: async () => [], ccxDir });
    (srv as any).broadcastServer = (m: string, p: unknown) => notes.push({ m, p });
    await call("thread/archive", { threadId: "cold-1" }, 1);
    expect(out.find((o) => o.id === 1)?.result).toEqual({ ok: true });
    expect(notes).toContainEqual({ m: "thread/archived", p: { sessionId: "cold-1" } });
    expect(existsSync(join(ccxDir, "archived", "cold-1"))).toBe(true);
    await call("thread/unarchive", { threadId: "cold-1" }, 2);
    expect(out.find((o) => o.id === 2)?.result).toEqual({ ok: true });
    expect(notes).toContainEqual({ m: "thread/unarchived", p: { sessionId: "cold-1" } });
    expect(existsSync(join(ccxDir, "archived", "cold-1"))).toBe(false);
  });
  it("refuses a live thread with BUSY 'close it first'", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    const { call, out, record } = wireWithLiveThread("live-sess", [], { ccxDir });
    await call("thread/archive", { threadId: record.id }, 1);
    const e = out.find((o) => o.id === 1)?.error;
    expect(e?.code).toBe(-33001);
    expect(e?.message).toMatch(/close it first/);
  });
  it("converges when a resume wins the race: marker removed, BUSY", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    const { srv, call, out } = wire({ listSessions: async () => [], ccxDir });
    // Simulate the race: the post-create re-check sees a live record that appeared mid-flight.
    let checks = 0;
    (srv as any).__testLiveCheck = () => (++checks >= 2 ? ({ id: "thr_x" } as any) : undefined);
    await call("thread/archive", { threadId: "racing" }, 1);
    expect(out.find((o) => o.id === 1)?.error?.code).toBe(-33001);
    expect(existsSync(join(ccxDir, "archived", "racing"))).toBe(false); // unlinked on convergence
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```ts
// src/appserver/archive.ts — archived-ness as per-session marker files (spec D-M5-3/10; review F8).
// One atomic create / one unlink per transition: there is NO read-modify-write for two processes to
// race, and cross-process STATE is correct because list/search re-read the directory per request.
// Push freshness stays per-server (broadcasts reach the emitting server's own clients) — documented.
import { mkdir, readdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { threadIdParams } from "./schema/core.js";
import { resolveThreadId, findLiveBySessionId } from "./sessionLib.js";

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

const LIVE_MSG = "Thread is live in this server — close it first";

export const threadArchive: Handler = async (srv, ctx, id, params) => {
  const parsed = threadIdParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  const liveCheck = (srv as { __testLiveCheck?: () => unknown }).__testLiveCheck ?? (() => findLiveBySessionId(srv, resolved.sessionId));
  try {
    if (liveCheck()) { ctx.peer.replyError(id, ERR.BUSY, LIVE_MSG); return; }
    await createArchiveMarker(resolved.sessionId, { ccxDir: srv.deps.ccxDir });
    // D-M5-10: re-check AFTER the marker lands. If a resume won the race, converge — unlink + refuse —
    // so no interleaving ends with a live session hidden from the default list.
    if (liveCheck()) { await removeArchiveMarker(resolved.sessionId, { ccxDir: srv.deps.ccxDir }); ctx.peer.replyError(id, ERR.BUSY, LIVE_MSG); return; }
    ctx.peer.reply(id, { ok: true });
    srv.broadcastServer("thread/archived", { sessionId: resolved.sessionId });
  } catch (e) { ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e)); }
};

export const threadUnarchive: Handler = async (srv, ctx, id, params) => {
  const parsed = threadIdParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  try {
    await removeArchiveMarker(resolved.sessionId, { ccxDir: srv.deps.ccxDir });
    ctx.peer.reply(id, { ok: true });
    srv.broadcastServer("thread/unarchived", { sessionId: resolved.sessionId });
  } catch (e) { ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e)); }
};
```

Register `"thread/archive"` and `"thread/unarchive"` (both `{ params: threadIdParams }`) + handlers; in `search.ts` replace the stub with `import { listArchived } from "./archive.js";`.

- [ ] **Step 4: Run** — archive + search + full unit suite PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): archive/unarchive — marker files, converging live-guard (Task 8)"`

### Task 9: The `archived` filter on `thread/list`

**Files:**
- Modify: `src/appserver/schema/threads.ts` (`threadListParams` gains `archived: z.boolean().optional()`), `src/appserver/sessionLib.ts` (`threadList`)
- Test: `test/unit/appserver/archive.test.ts` (append)

**Interfaces:** consumes Task 8's `listArchived`. Semantics (Codex-verbatim): absent/false **excludes** archived sessions; `true` returns **only** archived. A live row with no latched sessionId is unaffected by either mode (it cannot be archived).

- [ ] **Step 1: Append the failing test**

```ts
describe("thread/list archived filter", () => {
  it("default hides archived; archived:true shows only archived", async () => {
    const ccxDir = mkdtempSync(join(tmpdir(), "m5ccx-"));
    const sessions = [{ sessionId: "a", summary: "a", lastModified: 1 }, { sessionId: "b", summary: "b", lastModified: 2 }];
    const { call, out } = wire({ listSessions: async () => sessions, ccxDir });
    await createArchiveMarker("a", { ccxDir });
    await call("thread/list", {}, 1);
    expect(out.find((o) => o.id === 1)?.result.data.map((r: any) => r.sessionId)).toEqual(["b"]);
    await call("thread/list", { archived: true }, 2);
    expect(out.find((o) => o.id === 2)?.result.data.map((r: any) => r.sessionId)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — in `threadList`, after `const merged = [...liveViews, ...storeOnlyViews];` insert:

```ts
  const archivedSet = await listArchived({ ccxDir: srv.deps.ccxDir });
  const wantArchived = parsed.data.archived === true;
  const filtered = merged.filter((v) => {
    const sid = v.sessionId as string | undefined;
    if (sid === undefined) return !wantArchived; // an unlatched live row cannot be archived
    return archivedSet.has(sid) === wantArchived;
  });
```

and paginate `filtered` instead of `merged` (three renames in the following lines). Add `archived: z.boolean().optional(),` to `threadListParams` and `import { listArchived } from "./archive.js";` to `sessionLib.ts`.

- [ ] **Step 4: Run** — full unit suite PASS (the existing thread/list tests must stay green — the default path with no markers filters nothing).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as5): thread/list archived filter (Task 9)"`

## Stage E — absorb spikes + docs

### Task 10: Scorecard rows, schema artifacts, drift gate green

**Files:**
- Modify: `docs/parity/appserver.md` (new section + 9 rows), `docs/parity/coverage.md` (domain-10 M5 note), regenerate `harness/schema/json/{stable,experimental}/appserver.json` via `npm run emit-schema`.

**Interfaces:** none — this is the documentation/gate task. Row format: copy the review-domain section's table shape exactly (`| seam token | source | protocol method | origin scope | status |`). Seven method rows + two notification rows, statuses `shipped(M5)`; origin scope: `thread/archive`/`thread/unarchive`/`thread/searchOccurrences` → `both`; `thread/search`, `config/read`, `config/value/write`, `config/batchWrite` → `N/A` (no thread named); notifications `thread/archived`/`thread/unarchived` → `both`. Add a "Config + search/archive domain — M5" section before `## Totals`, modeled on the review section; update the Totals paragraph's "M4 added two rows" narrative with an M5 sentence (rows 90 → 99, methods "59 at M4's close → 66", notifications 27 → 29). Also update the `shipped(M5)` legend line in the header status legend.

- [ ] **Step 1:** `npm run emit-schema` → regenerated artifacts under `harness/schema/json/`; `git diff --stat` shows the two JSON files moving.
- [ ] **Step 2:** Write the scorecard section + rows + legend + totals updates — the section prose must also record the covered-by: Codex's `config/mcpServer/reload` ships no row because our existing `mcpServer/reconnect` covers that seam (spec: "recorded covered-by on the scorecard, not a gap"); coverage.md domain-10 cell gains one sentence ("**Agent app-server M5 SHIPPED (2026-08-…)** — config read/write over the settings layers, thread search/occurrences, archive markers; 66 methods / 29 notifications, drift-gated").
- [ ] **Step 3:** Run: `node ../scripts/drift-check.mjs` — Expected: exit 0, `66 registered methods`, `99 rows by status: … shipped(M5) 9 …`, no staleness, zero schema-less methods. This gate was RED since Task 2 — this task is what turns it green; if it still fails, the failure names the missing row.
- [ ] **Step 4:** Full unit suite + typecheck green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs(as5): scorecard + artifacts — 66 methods, 99 rows, gate green (Task 10)"`

### Task 11: SPIKE — probes 111/112 (the 0.3.234 absorb)

**Files:**
- Create: `probes/probes/111-context-usage-structured.ts`, `probes/probes/112-terminal-slash-commands.ts`

**The questions:** (a) does a headless `/context` slash-command turn deliver the new `context_usage` structured sibling (SDK 0.3.234 `SDKContextUsage`) on its synthetic assistant message? (b) does a headless init frame carry `terminal_slash_commands`? Spec promote-or-discard criteria verbatim: "What is alive gets wired — the structured card into the context-usage surface, `terminal_slash_commands` as a field on `thread/capabilities/read` … What is dead flips the `full-potential.md` rows and ships nothing."

- [ ] **Step 1: Build probe 111** — streaming-input session (copy probe 110's `openStreaming` helper), send the literal text `/context`, read every message until the result frame, and log `JSON.stringify(msg.context_usage ?? "ABSENT")` for each assistant message plus the message `type`/`subtype` it rode on.
- [ ] **Step 2: Build probe 112** — single `query()` turn ("reply OK"), log `init.terminal_slash_commands ?? "ABSENT"` and `init.slash_commands?.length` from the `system/init` frame.
- [ ] **Step 3: Run keyed** — `set -a; . ../.env; set +a; npx tsx probes/111-context-usage-structured.ts` (repeat for 112) from `probes/`. Record raw output.
- [ ] **Step 4: Route the verdicts** — spec `## Surprises & Discoveries` gains a dated entry per probe; `docs/parity/full-potential.md`'s two 🔬 rows flip to 🟢/✅-with-evidence or 🚫 per result.
- [ ] **Step 5: Apply the criteria** — ALIVE → Task 12 wires it; DEAD → delete nothing (probes are the evidence base — they stay), Task 12 shrinks to the alive subset or is skipped entirely, and the ledger records which.
- [ ] **Step 6: Commit** — `git add ../probes/probes/111* ../probes/probes/112* ../docs && git commit -m "probe(111/112): 0.3.234 absorb verdicts (Task 11 spike)"`

### Task 12: Wire the absorb survivors (CONDITIONAL — scope set by Task 11)

**Files (alive-case):**
- Modify: `src/appserver/server.ts` (or the capabilities handler's module) — `thread/capabilities/read` reply gains `terminalCommands: string[] | undefined` read from the thread's retained init result field `terminal_slash_commands`; `thread/contextUsage/read` reply gains `structured?: SDKContextUsage` when the engine exposes it.
- Test: extend the existing capabilities/context unit tests with a fake init carrying the field, asserting passthrough (present when the engine reports it, absent-key when not — never `null`-invented).

Steps follow the standing TDD five-step shape (failing test → red → wire the passthrough → green → commit `feat(as5): absorb 0.3.234 survivors (Task 12)`). If Task 11 returned DEAD on both: record `Task 12: skipped (both probes dead)` in the ledger and move on — the spec's acceptance item 8 is satisfied by the recorded verdicts either way.

## Stage F — verification

### Task 13: Keyed live acceptance suite

**Files:**
- Create: `test/live/appserver-m5-acceptance.test.ts`

Gate on the standard `const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip`. Structure it as the M4 acceptance file is structured (an `AppServer` + real WS client helper — copy `appserver-m4-acceptance.test.ts`'s scaffolding). Legs, each mapping one spec acceptance item that needs a live engine or real store, with every config path pointed at a **temp `configHome`/`ccxDir`** (never the real `~/.claude`):

1. **Config chain live** (spec acceptance 1–4 condensed): plant user+local files in temp dirs, `config/read` sees the deep merge + origins; `config/value/write` twice (fresh + stale token) → one ok, one `ConfigVersionConflict`; write a local-masked user key → `okOverridden` naming `local`.
2. **Search over the real store** (item 5): open a real thread, run a turn containing a unique marker, close it; `thread/search {searchTerm: marker}` finds the session with a snippet.
3. **The jump** (item 6): on a live thread with a marker turn, `thread/searchOccurrences` → take `readCursor` → `thread/read` with it unchanged → the window's last row contains the marker.
4. **Archive round-trip** (item 7): archive the closed session → absent from default `thread/list`, present under `archived:true`, notifications observed on a subscribed second client; unarchive restores; archive of a live thread refuses BUSY.

- [ ] **Step 1:** Write the suite (keyless run must skip cleanly: `npx vitest run test/live/appserver-m5-acceptance.test.ts` → skipped).
- [ ] **Step 2:** Controller runs it keyed: `set -a; . ../.env; set +a; npx vitest run test/live/appserver-m5-acceptance.test.ts` → Expected: 4 legs pass. (Implementers stop at the clean keyless skip; the controller runs the keyed pass — harness/CLAUDE.md's standing division.)
- [ ] **Step 3: Commit** — `git add test/live/appserver-m5-acceptance.test.ts && git commit -m "test(as5): keyed live acceptance — config chain, search, jump, archive (Task 13)"`

### Task 14: FINAL VERIFICATION — the spec's acceptance as written

- [ ] **Step 1:** `npm run typecheck` → clean.
- [ ] **Step 2:** `npx vitest run test/unit` → all green (expect ~230+ files).
- [ ] **Step 3:** `npx vitest run test/tui` → all green (untouched by M5, but the suite guards regressions).
- [ ] **Step 4:** `node ../scripts/drift-check.mjs` → exit 0; report shows `66 registered methods`, `99 rows`, `shipped(M5) 9`.
- [ ] **Step 5:** Walk spec acceptance items 1–8 one by one against the tests that pin them (1↔config-domain merge test, 2↔CAS tests, 3↔batch tests, 4↔masking/jail tests, 5↔search tests, 6↔occurrence tests + live leg 3, 7↔archive tests + live leg 4, 8↔Task 11 verdicts). Any item without a passing pin is a FAIL — fix before proceeding.
- [ ] **Step 6:** Controller reruns the keyed live suites: M5 acceptance (Task 13) **and** the M4 acceptance (regression — config/search must not have disturbed the review domain).
- [ ] **Step 7:** Write the spec's `## Outcomes & Retrospective`, update `docs/parity/coverage.md` + memory per the standing milestone ritual, and commit `spec(m5): outcomes — …`.

---

## Self-review notes (author, at plan time)

- Spec coverage: acceptance 1–4 → Tasks 1–4; 5 → Tasks 5–6; 6 → Task 7; 7 → Tasks 8–9; 8 → Tasks 11–12; artifacts/gate → Task 10; live → Task 13; final → Task 14. No spec section is uncovered.
- The drift gate is deliberately RED between Tasks 2 and 10 (methods registered before rows exist). The ledger should note it once so reviewers don't flag it per-task; each task's own suite must still be green.
- `wire()`/`wireWithLiveThread()` helpers are copied per test file rather than shared — the appserver unit suites' existing convention (each file owns its scaffolding); follow it, don't invent a shared helper module.
- Occurrence cursor reuses the search cursor codec with `v` repurposed as the in-row character position — one codec, two documented meanings, chosen over a second codec for one field.
