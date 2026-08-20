// test/unit/appserver/config-domain.test.ts — M5 Task 2: `config/read`, the settings-files domain's read half.
//
// Driven through the REAL wire (`srv.connect(sink)` + `conn.feed(...)`, review-start.test.ts's harness):
// `dispatch` is private and four-arg, so a request is the only way in — and going through it is what makes
// the params gate, the error codes and the reply shape observable at all.
//
// The whole domain is pointed at temp directories by the `configHome`/`managedSettingsPath` deps, so every
// case here reads files it wrote itself and never this machine's real ~/.claude.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { DEFAULT_MANAGED_PATH, defaultManagedPath } from "../../../src/appserver/configDomain.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { Ajv } from "ajv";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, chmodSync, existsSync, symlinkSync, realpathSync, utimesSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const harnessRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Does `chmod 000` actually deny THIS process a read? Measured, never assumed: root reads regardless of
 *  mode, and a filesystem that ignores mode bits denies nothing either. Where permission is not permission
 *  the denied-read case below has no premise, so it skips rather than reporting a failure it caused —
 *  which is exactly why the "unreadable" sentinel is pinned by an EISDIR row that never consults this. */
const modeDenies = (() => {
  const dir = mkdtempSync(join(tmpdir(), "m5perm-"));
  try {
    const probe = join(dir, "probe.json"); writeFileSync(probe, "{}"); chmodSync(probe, 0o000);
    try { readFileSync(probe, "utf8"); return false; } catch { return true; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const servers: AppServer[] = [];
let conn: { feed(chunk: string): void };
let lines: string[];
let nextId = 100;

function boot(deps: AppServerDeps = {}): AppServer {
  const srv = new AppServer({}, deps);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
  return srv;
}

/** Feeds the request and waits for ITS reply before returning the id. The handler does real filesystem
 *  I/O (realpath + reads), so a single microtask — what `await` on the bare id would give — settles
 *  nothing; and a poll that gave up silently would turn a never-answered request into a confusing
 *  "cannot read property of undefined" instead of the honest "no reply". */
const send = async (method: string, params: unknown): Promise<number> => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  for (let i = 0; i < 200; i++) {
    if (parsed(lines).some((m) => m.id === id)) return id;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`no reply to ${method} (id ${id}) within 1s`);
};

/** `send` minus the wait. `conn.feed` runs the whole path to the handler SYNCHRONOUSLY (peer.feed →
 *  onFrame → `void dispatch(...)`), so the handler is already executing by the time this returns and two
 *  calls in one statement block are genuinely overlapped, not merely adjacent. */
const sendNoAwait = (method: string, params: unknown): number => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  return id;
};
/** Polls a predicate on a 2s budget and THROWS on exhaustion — a condition that never arrives has to read
 *  as itself, not as a later "cannot read property of undefined". */
const waitFor = async (pred: () => boolean): Promise<void> => {
  for (let i = 0; i < 400; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error("waitFor timed out after 2s");
};

afterEach(async () => { for (const s of servers.splice(0)) await s.shutdown().catch(() => {}); });

let home: string, proj: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "m5home-")); proj = mkdtempSync(join(tmpdir(), "m5proj-"));
  mkdirSync(join(home, ".claude"), { recursive: true }); mkdirSync(join(proj, ".claude"), { recursive: true });
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true }); });
const deps = () => ({ configHome: home, managedSettingsPath: join(home, "managed.json"), ccxDir: join(home, "ccx") });
const reply = (id: number) => parsed(lines).find((l) => l.id === id) as any;

/** The leaves a written value introduces, spelled as `config/read`'s own dotted `origins` keys — arrays
 *  are leaves, an object contributes one leaf per scalar/array under it. Deliberately RE-DERIVED here
 *  rather than imported from the handler: these rows exist to hold the write reply against the read
 *  reply, and sharing the production walk would let one bug satisfy both sides of that comparison. */
const leafKeys = (keyPath: string[], value: unknown): string[] => {
  if (typeof value === "object" && value !== null && !Array.isArray(value))
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leafKeys([...keyPath, k], v));
  return [keyPath.join(".")];
};
const LAYER_RANK = ["user", "project", "local", "managed"];
/** The merged view walked by SEGMENTS, exactly as `effectiveView` builds it: arrays are leaves, so an array
 *  on the way down is a miss. This is `config/read`'s own answer to "does this path still resolve?". */
const valueAtRead = (cfg: any, keyPath: string[]): unknown =>
  keyPath.reduce((n: any, s) => (n !== null && typeof n === "object" && !Array.isArray(n) && Object.prototype.hasOwnProperty.call(n, s) ? n[s] : undefined), cfg);
/** Does this merged value contain a region no `origins` entry can carry? `mergeTracked` records entries for
 *  LEAVES only, so an object node with no leaf beneath it is attributed to nobody, anywhere — the read
 *  reply cannot name the layer that put it there, and cannot say it was not put there by one either. */
const hasUnattributedRegion = (v: unknown): boolean => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  return entries.length === 0 || entries.some(([, child]) => hasUnattributedRegion(child));
};
/** A deep merge of layer contents, re-derived from upstream's documented rules (deep merge; arrays
 *  concatenate and dedupe primitives by SameValueZero while objects never dedupe) rather than imported
 *  from `configLayers.ts` — for the same reason `leafKeys` is re-derived: an oracle sharing the code it
 *  judges can only ever agree with it. */
const tMerge = (a: unknown, b: unknown): unknown => {
  const isObj = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: unknown[] = [], seen = new Set<unknown>();
    for (const x of [...a, ...b]) { if (x !== null && typeof x === "object") { out.push(x); continue; } if (!seen.has(x)) { seen.add(x); out.push(x); } }
    return out;
  }
  // An OBJECT over an ARRAY keeps the array: lodash assigns the source object's keys onto the array itself,
  // so index keys patch elements and everything else becomes a property no JSON shows. Transcribed from a
  // run of real lodash 4.18.1 under upstream's `settingsMergeCustomizer` (`/tmp/m5-fixB/lodash-probe.cjs`),
  // not from `configLayers.ts` — this oracle judges that file and must not be derived from it.
  if (Array.isArray(a) && isObj(b)) {
    const out = [...a] as unknown[];
    const bag = out as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) bag[k] = Object.prototype.hasOwnProperty.call(out, k) ? tMerge(bag[k], v) : v;
    return out;
  }
  if (isObj(a) && isObj(b)) {
    const out = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = Object.prototype.hasOwnProperty.call(out, k) ? tMerge(out[k], v) : v;
    return out;
  }
  return b;
};
const tEq = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => tEq(x, b[i]));
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && tEq((a as any)[k], (b as any)[k]));
};
/** The delete verdict as a COUNTERFACTUAL over the layer contents a case PLANTED, and the second oracle the
 *  sweep needs: `readVerdictForDelete` is derived from a read reply and therefore inherits the read side's
 *  own blind spot, which is exactly where the delete verdict used to be wrong. This one consults no
 *  attribution at all — with the target's layer taken away, does the value at the path still move when the
 *  layers ABOVE it are taken away too? The target's own planted content never enters either merge, so it
 *  does not matter that this map is what was planted BEFORE the delete landed. */
const deleteVerdictFromLayers = (planted: Record<string, unknown>, target: string, keyPath: string[]): "inForce" | "masked" => {
  const mergeOf = (names: string[]) => names.reduce<unknown>((acc, n) => (planted[n] === undefined ? acc : tMerge(acc, planted[n])), {});
  const without = valueAtRead(mergeOf(LAYER_RANK.filter((n) => n !== target)), keyPath);
  const below = valueAtRead(mergeOf(LAYER_RANK.filter((n) => LAYER_RANK.indexOf(n) < LAYER_RANK.indexOf(target))), keyPath);
  return without === undefined || tEq(without, below) ? "inForce" : "masked";
};
/** The read reply's SECOND blind spot for a delete, and it has nothing to do with `mergeTracked`'s leafless
 *  objects: a layer ABOVE the target holds, at or under the written path, exactly what the layers BELOW
 *  already serve there. Last-writer-wins attribution names the higher layer, so `readVerdictForDelete`
 *  reads "masked"; take that layer away and nothing at the path moves, so the delete is in force
 *  (D-M5-13d). Separating the two needs the layer CONTENTS, which a read reply does not carry.
 *
 *  Stated over what a case PLANTED — the above layers move nothing at the path, yet one of them put a leaf
 *  there — rather than as "the two oracles disagree", so a disagreement of any OTHER shape still fails the
 *  sweep instead of being quietly absorbed into the undecided count. */
const readOracleBlindToDuplicateAbove = (planted: Record<string, unknown>, target: string, keyPath: string[]): boolean => {
  const mergeOf = (names: string[]) => names.reduce<unknown>((acc, n) => (planted[n] === undefined ? acc : tMerge(acc, planted[n])), {});
  const below = valueAtRead(mergeOf(LAYER_RANK.filter((n) => LAYER_RANK.indexOf(n) < LAYER_RANK.indexOf(target))), keyPath);
  const without = valueAtRead(mergeOf(LAYER_RANK.filter((n) => n !== target)), keyPath);
  if (without === undefined || !tEq(without, below)) return false;
  const key = keyPath.join("."), under = `${key}.`;
  return LAYER_RANK.filter((n) => LAYER_RANK.indexOf(n) > LAYER_RANK.indexOf(target))
    .some((n) => planted[n] !== undefined && leafKeys([], planted[n]).some((k) => k === key || k.startsWith(under)));
};
/** What `config/read` says about a DELETE, which introduces no leaf and so can only be judged by absence:
 *  in force when the path resolves to nothing, or resolves to something no layer ABOVE the target
 *  contributes to (the client's own value is gone and something lower shows through).
 *
 *  `"unknown"` is the read side's declared blind spot, not a verdict: a path that still resolves while
 *  NOTHING is attributed at or under it is an object with no leaves, and `mergeTracked` records no `origins`
 *  entry for an object node — so the read reply cannot say who holds it, in either direction. Rows that
 *  construct that state assert the reply themselves and say why. */
const readVerdictForDelete = (r: any, target: string, keyPath: string[]): "inForce" | "masked" | "unknown" => {
  const served = valueAtRead(r.config, keyPath);
  if (served === undefined) return "inForce";
  // The blind spot is a property of the VALUE, not only of an empty contributor list: `origins` carries
  // entries for LEAVES, so any object node with no leaf beneath it — `{}`, `{z:{}}` — was put there by a
  // layer no read reply names, and it can sit BESIDE attributed leaves. Judging such a state from the
  // contributors that do exist would answer for a region they say nothing about, in either direction.
  if (hasUnattributedRegion(served)) return "unknown";
  const key = keyPath.join("."), under = `${key}.`, contributors: string[] = [];
  for (const [p, o] of Object.entries(r.origins)) {
    if (p !== key && !p.startsWith(under)) continue;
    for (const l of (Array.isArray(o) ? o : [o]) as string[]) if (!contributors.includes(l)) contributors.push(l);
  }
  if (!contributors.length) return "unknown";
  return contributors.some((l) => LAYER_RANK.indexOf(l) > LAYER_RANK.indexOf(target)) ? "masked" : "inForce";
};
/** The F1 contract in one assertion, and the reason it is written as a COMPARISON rather than as expected
 *  strings: the masking verdict is only meaningful as agreement with `config/read`. A value-writing edit is
 *  `ok` exactly when the read side attributes at least one of its leaves to the layer that was written, and
 *  masked exactly when it attributes none — an ABSENT entry is not "nobody is above me", it is "not mine".
 *  A delete inverts to absence (above), and an edit that introduces no leaf at all — an empty object,
 *  however nested — has nothing to mask. A masked edit's `effectiveValue` is the read side's own merged
 *  value at that keyPath, never one layer's private copy of it, and its `overridingLayer` may never name a
 *  layer BELOW the target: that would send a client to edit a file that overrides nothing.
 *
 *  Returns the number of edits the read reply could not judge (see `readVerdictForDelete`), so a generated
 *  sweep can report how much of itself the oracle actually decided instead of quietly skipping. */
const expectAgreesWithRead = (w: any, r: any, target: string, edits: Array<{ keyPath: string[]; value: unknown }>, describedIndex?: number, readBlind: number[] = []): number => {
  let undecided = 0;
  edits.forEach((e, i) => {
    const masked = w.maskedEditIndexes?.includes(i) ?? false;
    const where = `edit ${i} "${e.keyPath.join(".")}"`;
    if (e.value === null) { // a delete — `upsert` with null is refused before any of this runs
      const verdict = readVerdictForDelete(r, target, e.keyPath);
      // `readBlind` is the caller's own declaration that this delete sits in the duplicate-above state,
      // which the read reply reports as "masked" and cannot tell from a real one — same undecided bucket,
      // different reason.
      if (verdict === "unknown" || readBlind.includes(i)) { undecided++; return; }
      expect(masked, `${where}: config/read's by-absence verdict is "${verdict}"`).toBe(verdict === "masked");
      return;
    }
    const leaves = leafKeys(e.keyPath, e.value);
    if (leaves.length === 0) { expect(masked, `${where}: introduces no leaf, so nothing of it can be masked`).toBe(false); return; }
    const attributed = leaves.some((k) => {
      const o = r.origins[k];
      return o === target || (Array.isArray(o) && o.includes(target));
    });
    expect(masked, `${where}: config/read attributes a leaf to "${target}"? ${attributed}`).toBe(!attributed);
  });
  expect(w.status).toBe(w.maskedEditIndexes ? "okOverridden" : "ok");
  if (w.maskedEditIndexes) expect(w.overriddenMetadata, "a masked edit owes the client an overridingLayer").toBeDefined();
  if (w.overriddenMetadata) {
    // WHICH masked edit the metadata describes is a reporting rule, not an agreement question: the first
    // one a layer ABOVE the target overrides, and a self-shadowed edit only when the batch holds nothing
    // better. A read reply cannot tell those two apart — that is what `describedIndex` is for, and the
    // default is the common case where the first masked edit is the described one.
    const kp = edits[describedIndex ?? w.maskedEditIndexes[0]].keyPath;
    expect(w.overriddenMetadata.effectiveValue).toEqual(valueAtRead(r.config, kp));
    expect(LAYER_RANK.indexOf(w.overriddenMetadata.overridingLayer), `overridingLayer "${w.overriddenMetadata.overridingLayer}" must not rank below the target "${target}"`).toBeGreaterThanOrEqual(LAYER_RANK.indexOf(target));
  }
  return undecided;
};

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
    // D-M5-18: versions ALWAYS present for the writable targets in view — the first-conditional-write
    // token. Every present file is compared against ITS OWN bytes: a `typeof === "string"` on `local`
    // passes just as happily when the token is computed from the user file, and a client's first
    // conditional write to settings.local.json would then carry another file's hash (review I3).
    expect(r.versions.user).toBe(sha256(readFileSync(join(home, ".claude", "settings.json"), "utf8")));
    expect(r.versions.local).toBe(sha256(readFileSync(join(proj, ".claude", "settings.local.json"), "utf8")));
    expect(r.versions.user).not.toBe(r.versions.local);
    expect(r.versions.project).toBe("absent"); // no such file — the one state that is NOT a hash
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
    // A malformed file still HAS bytes, so it still has a real CAS token — that is the whole point of
    // `readLayers` retaining `raw` on the disabled layer, and the client is owed the token precisely for
    // the file it must go fix. Asserting the hash, not merely a string: minting "absent" here would be
    // the exact inverse of what this row promises, and reads as "no such file" to a conditional write.
    expect(r.versions.project).toBe(sha256("{broken"));
  });
  /** FIX WAVE H / H3, the READ side of the same token. `config/read` mints a layer's version from the
   *  bytes `readLayers` kept, and that reader decoded them to a string first — so the token this method
   *  publishes was the hash of the decode, not of the file, exactly as the write side's was. Both halves
   *  must move together or a client's `expectedVersion`, taken from a `config/read` reply, would be
   *  compared against a token computed a different way one method over. */
  it("a layer's published version is the sha256 of its BYTES — two files that decode alike do not share one", async () => {
    const bytes = (b: number) => Buffer.concat([Buffer.from('{"model":"'), Buffer.from([b]), Buffer.from('"}\n')]);
    writeFileSync(join(home, ".claude", "settings.json"), bytes(0x80));
    writeFileSync(join(proj, ".claude", "settings.json"), bytes(0x81));
    boot(deps());
    const id = await send("config/read", { cwd: proj, includeLayers: true });
    const r = reply(id).result;
    expect(r.versions.user).toBe(createHash("sha256").update(bytes(0x80)).digest("hex"));
    expect(r.versions.project).toBe(createHash("sha256").update(bytes(0x81)).digest("hex"));
    expect(`user and project share a token: ${r.versions.user === r.versions.project}`)
      .toBe("user and project share a token: false");
  });
  it("a present-but-unreadable layer mints \"unreadable\", never \"absent\"", async () => {
    // D-M5-18's "absent" means NO SUCH FILE. A file that exists but whose bytes never reached us is a
    // third state, and this handler is the only place the difference is knowable — downstream sees the
    // token string alone. A DIRECTORY at the settings path is the reproduction used here because it is
    // the one no host can wave away: `readLayers` keeps every non-ENOENT failure as a layer without
    // `raw`, and EISDIR reaches that branch without depending on a permission bit that root — or a
    // filesystem ignoring mode — would not enforce. UNGUARDED on purpose: this is the only row pinning
    // the sentinel, and a row that can skip is a row a later collapse back to two tokens ships past.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    mkdirSync(join(proj, ".claude", "settings.json"));
    boot(deps());
    const id = await send("config/read", { cwd: proj, includeLayers: true });
    const r = reply(id).result;
    expect(r.layers.find((l: any) => l.name === "project").disabledReason).toMatch(/EISDIR|directory/i);
    expect(r.layers.find((l: any) => l.name === "project").raw).toBeUndefined();
    expect(r.versions.project).toBe("unreadable");
    expect(r.versions.user).toBe(sha256(readFileSync(join(home, ".claude", "settings.json"), "utf8"))); // healthy neighbour unaffected
    expect(r.versions.local).toBe("absent"); // and "absent" still means exactly what it meant
    expect(r.config).toEqual({ model: "opus" }); // the unreadable layer contributes nothing
  });
  it.skipIf(!modeDenies)("a denied read reaches the same \"unreadable\" token", async () => {
    // The motivating real case, and the reason the third state exists at all: mode 0200 is legal — write
    // permission is independent of read — so a settings file can be present, writable, and never
    // readable, and a CAS built on "absent" would take it as "create it" and overwrite bytes nobody read.
    // Guarded, because where mode bits are not enforced there is no denial to observe; the row above is
    // what keeps the sentinel pinned on those hosts, so this one may skip without costing coverage.
    const projSettings = join(proj, ".claude", "settings.json");
    writeFileSync(projSettings, JSON.stringify({ model: "sonnet" }));
    chmodSync(projSettings, 0o000);
    try {
      boot(deps());
      const id = await send("config/read", { cwd: proj, includeLayers: true });
      const r = reply(id).result;
      expect(r.layers.find((l: any) => l.name === "project").disabledReason).toMatch(/EACCES|permission/i);
      expect(r.layers.find((l: any) => l.name === "project").raw).toBeUndefined();
      expect(r.versions.project).toBe("unreadable");
    } finally { chmodSync(projSettings, 0o600); }
  });
  it("the reply on the wire validates against the published result schema — both arms", async () => {
    // D-M5-19 ships a RESULT schema, and a result schema nothing ever validates is decoration: this is the
    // one place the generated artifact meets an actual reply. `additionalProperties: false` is doing the
    // work in both directions — a key the handler invents fails here just as loudly as a required one it
    // drops. Both arms, because `layers` is the only optional key and includeLayers is what produces it.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    boot(deps());
    const validate = new Ajv({ strict: true }).compile(
      (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results["config/read"],
    );
    for (const params of [{ cwd: proj }, { cwd: proj, includeLayers: true }]) {
      const id = await send("config/read", params);
      expect(validate(reply(id).result), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it("relative and nonexistent cwd refuse -32602 ConfigValidationError; without cwd only user in versions", async () => {
    boot(deps());
    let id = await send("config/read", { cwd: "rel/path" });
    expect(reply(id).error.data).toEqual({ code: "ConfigValidationError" });
    // The MESSAGE, not just the code: a relative cwd and a missing one refuse with the same code, so
    // without this the absoluteness rule could be deleted outright and this case would still pass —
    // `realpath("rel/path")` merely fails for the other reason. What absoluteness actually guards is the
    // relative path that DOES resolve, against this process's cwd rather than the client's.
    expect(reply(id).error.message).toMatch(/absolute/);
    id = await send("config/read", { cwd: join(proj, "nope") });
    expect(reply(id).error.code).toBe(-32602);
    id = await send("config/read", {});
    expect(Object.keys(reply(id).result.versions)).toEqual(["user"]);
  });
  it("a cwd that is a regular file refuses exactly like one that does not exist", async () => {
    // `realpath` succeeds on a file, so without a directory check the read proceeds against
    // `<file>/.claude/settings.json` and answers with CAS tokens for two paths that can never exist —
    // a client could then send a conditional write against a hallucinated target.
    const file = join(proj, "settings-but-a-file.json");
    writeFileSync(file, "{}");
    boot(deps());
    const id = await send("config/read", { cwd: file });
    expect(reply(id).error.code).toBe(-32602);
    expect(reply(id).error.data).toEqual({ code: "ConfigValidationError" });
    expect(reply(id).error.message).toMatch(/not a directory/);
    expect(reply(id).result).toBeUndefined();
  });
});

describe("defaultManagedPath", () => {
  it("maps every platform arm, and DEFAULT_MANAGED_PATH is this host's", () => {
    // The win32 arm is the reason this is a function: read off `platform()` at module load, two of the
    // three arms are unrunnable on any given machine, and an inverted or dropped `null` there would ship
    // a Linux path as a Windows drive-root layer with no test able to say so.
    expect(defaultManagedPath("darwin")).toBe("/Library/Application Support/ClaudeCode/managed-settings.json");
    expect(defaultManagedPath("win32")).toBeNull();
    expect(defaultManagedPath("linux")).toBe("/etc/claude-code/managed-settings.json");
    expect(defaultManagedPath("freebsd")).toBe("/etc/claude-code/managed-settings.json"); // anything-but-those-two
    expect(DEFAULT_MANAGED_PATH).toBe(defaultManagedPath(platform())); // the exported const is that call
  });
});

describe("config/value/write + config/batchWrite", () => {
  it("user upsert lands; versions round-trip; stale CAS refuses byte-identical with the named code", async () => {
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["permissions", "allow"], value: ["WebFetch"], mergeStrategy: "upsert" });
    const w1 = reply(id).result;
    expect(w1.status).toBe("ok");
    // `realpathSync`, not the literal join: `mkdtemp` hands back `/var/folders/…` on macOS and `/var` is
    // itself a symlink, so the file's one true name is the `/private/var/…` form. The reply names the file
    // the write landed in — see the identity row below for why that name must not drift.
    expect(w1.filePath).toBe(realpathSync(join(home, ".claude", "settings.json")));
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
    // The overlap is PROVEN here, not hoped for: `feed` reaches `dispatch` synchronously, so both handlers
    // have already started, and no `await` inside either can have settled before this synchronous block
    // ends — hence neither can have replied. A row that only wrapped two awaited sends in `Promise.all`
    // would pass just as happily on two writers that ran strictly one after the other, which is precisely
    // the case this row exists to exclude.
    expect(reply(idA)).toBeUndefined();
    expect(reply(idB)).toBeUndefined();
    await waitFor(() => reply(idA) !== undefined && reply(idB) !== undefined);
    const results = [reply(idA), reply(idB)];
    expect(results.filter((r) => r.result?.status === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.error?.data?.code === "ConfigVersionConflict")).toHaveLength(1);
    // ...and the disk agrees with the replies: the winner's key landed and the loser's never did. Without
    // a critical section spanning read→CAS→write both writers read `v`, both matched, and both wrote —
    // two `ok`s and one silently clobbered edit.
    const finalBytes = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    const winner = results.find((r) => r.result?.status === "ok");
    expect(JSON.parse(finalBytes)).toEqual(winner === results[0] ? { a: 1, b: 2 } : { a: 1, c: 3 });
    expect(winner.result.version).toBe(sha256(finalBytes)); // the ok reply's token describes the file that exists
  });
  it("two SPELLINGS of one file take one lock — resolution happens before the lock, not inside it", async () => {
    // `withFileLock`'s in-process queue is keyed by the path STRING, so the resolved path is what must be
    // handed to it: resolve inside the critical section instead and two names for one file take two
    // different chains and two different `<file>.lock` files, and mutual exclusion is gone between exactly
    // the pair it was written for. Reproduced with a symlink, because that is how one settings file
    // legitimately acquires two names — dotfile managers and provisioning scripts lay them down.
    symlinkSync(join(home, ".claude", "settings.json"), join(proj, ".claude", "settings.json"));
    boot(deps());
    const id0 = await send("config/value/write", { keyPath: ["a"], value: 1, mergeStrategy: "replace" });
    const v = reply(id0).result.version;
    const idUser = sendNoAwait("config/value/write", { keyPath: ["b"], value: 2, mergeStrategy: "replace", expectedVersion: v });
    const idProj = sendNoAwait("config/value/write", { keyPath: ["c"], value: 3, mergeStrategy: "replace", target: "project", cwd: proj, expectedVersion: v });
    expect(reply(idUser)).toBeUndefined();
    expect(reply(idProj)).toBeUndefined(); // both in flight, as in the row above
    await waitFor(() => reply(idUser) !== undefined && reply(idProj) !== undefined);
    const results = [reply(idUser), reply(idProj)];
    // Both requests name the SAME bytes and carry the SAME token, so one of them must lose — and both
    // replies name the resolved file, never either link.
    expect(results.filter((r) => r.result?.status === "ok")).toHaveLength(1);
    expect(results.filter((r) => r.error?.data?.code === "ConfigVersionConflict")).toHaveLength(1);
    // `realpathSync`, not the literal join: on macOS `/tmp` and `/var` are themselves symlinks, so the
    // canonical name of this file is `/private/var/…`. That is also the honest expectation — the reply
    // names the file the write actually landed in, and neither link is that file.
    expect(results.find((r) => r.result)!.result.filePath).toBe(realpathSync(join(home, ".claude", "settings.json")));
    const finalBytes = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    expect(JSON.parse(finalBytes)).toEqual(results[0].result ? { a: 1, b: 2 } : { a: 1, c: 3 });
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
    // WHICH refusal, not merely that one happened: a relative cwd ALSO fails `realpath`, so without the
    // message this row would stay green with the absoluteness rule deleted — the read side's own review
    // lesson, re-entered on the write side where the cost of being wrong is a mutated file.
    expect(reply(id).error.message).toMatch(/absolute/);
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false); // rev 1 wrote first, refused after
  });
  it('expectedVersion "unreadable" is refused as an ASSERTION, ahead of the compare', async () => {
    // The third token is a sentinel for the SERVER's inability to read the file, not a state of its
    // content — a client holding it never saw the bytes whose continuity it would be asserting. It fails
    // closed either way, which is exactly why this row pins the CODE and the MESSAGE: delete the guard and
    // the request still refuses, but as `ConfigVersionConflict` with an opaque "does not match", and a
    // client would re-read, be handed "unreadable" again, and loop. "It refused" would ship that.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    const before = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    boot(deps());
    const id = await send("config/value/write", { keyPath: ["model"], value: "sonnet", mergeStrategy: "replace", expectedVersion: "unreadable" });
    expect(reply(id).error.code).toBe(-32602);
    expect(reply(id).error.data).toEqual({ code: "ConfigValidationError" });
    expect(reply(id).error.message).toMatch(/unreadable/);
    expect(reply(id).error.message).toMatch(/re-read/);
    expect(reply(id).result).toBeUndefined();
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(before);
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
  /** FIX WAVE H / H6. The leaf dedup keyed a path by joining its segments with a NUL, so two DIFFERENT
   *  leaves whose segments differ only in where that NUL falls collapsed onto one key — and `Map` keeps
   *  the last value for a duplicate key, so the surviving entry is the one written LAST and the other
   *  leaf is never looked up at all.
   *
   *  A settings key may contain a NUL: it comes out of `JSON.parse`, which accepts `\u0000` in a string,
   *  and the write path's keyPath screen refuses `.`-carrying segments and the three prototype names, not
   *  control characters. So this is a client-reachable pair, and the direction that shows is the harmful
   *  one: the LANDED leaf is dropped, only the masked leaf is asked about, and a write that really is in
   *  force is reported `okOverridden` naming a layer that overrides nothing of it. (The opposite order is
   *  not a defect — the rule is "ok when ANY leaf is attributed to the target", so dropping a masked leaf
   *  cannot change an answer the surviving landed leaf already decides.)
   *
   *  The repair is a key with no delimiter in it at all rather than an escape: `JSON.stringify` of the
   *  segment array, which is injective over string arrays for the same reason JSON round-trips. */
  it("two leaves that differ only in where a NUL falls are two leaves, not one (the dedup key is injective)", async () => {
    const NUL = "\u0000";
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ x: { a: { b: "PROJECT-WINS" } } }));
    boot(deps());
    // `a\u0000b` lands (nothing else defines it); `a.b` is masked by the project layer. They join to the
    // same NUL-delimited key, and `a\u0000b` — written FIRST — is the one the Map drops.
    const id = await send("config/value/write", {
      target: "user", cwd: proj, keyPath: ["x"], mergeStrategy: "upsert",
      value: { [`a${NUL}b`]: "USER-LANDS", a: { b: "user-masked" } },
    });
    const w = reply(id).result;
    // The write really is in force at the dropped leaf — asked of `config/read`, the side that decides it.
    const rid = await send("config/read", { cwd: proj });
    const r = reply(rid).result;
    expect(r.origins[`x.a${NUL}b`]).toBe("user");
    expect(r.config.x[`a${NUL}b`]).toBe("USER-LANDS");
    expect(`${w.status} ${w.overriddenMetadata?.overridingLayer ?? "-"}`).toBe("ok -");
    expect(w.maskedEditIndexes).toBeUndefined();
  });
  it("unknown top-level key warns; project without cwd refuses; batch is ordered and atomic", async () => {
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["notARealSetting"], value: 1, mergeStrategy: "replace" });
    expect(reply(id).result.warnings[0]).toMatch(/notARealSetting/);
    id = await send("config/value/write", { keyPath: ["model"], value: "x", mergeStrategy: "replace", target: "project" });
    expect(reply(id).error?.data?.code).toBe("ConfigValidationError");
    expect(reply(id).error.message).toMatch(/requires cwd/); // the missing-cwd refusal, not some later path failure
    const before = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    id = await send("config/batchWrite", { edits: [
      { keyPath: ["a"], value: ["x"], mergeStrategy: "replace" },
      { keyPath: ["a"], value: ["y"], mergeStrategy: "upsert" },
      { keyPath: ["notARealSetting", "child"], value: 3, mergeStrategy: "replace" }, // parent is scalar 1 → refuses
    ] });
    expect(reply(id).error?.data?.code).toBe("ConfigValidationError");
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(before); // byte-identical rollback
  });
  it("both write replies validate against their published result schemas — ok and okOverridden", async () => {
    // D-M5-19's `results` map now carries three methods, and a published response schema nothing ever
    // checks is decoration. `additionalProperties: false` works in both directions here — an invented key
    // fails as loudly as a dropped required one — and `okOverridden` is the arm that fills every optional
    // key at once, so between the two calls no part of the shape goes unvalidated.
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ a: "local-wins" }));
    boot(deps());
    const results = (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results;
    const ajv = new Ajv({ strict: true });
    const validateValue = ajv.compile(results["config/value/write"]);
    const validateBatch = ajv.compile(results["config/batchWrite"]);
    let id = await send("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace" });
    expect(reply(id).result.status).toBe("ok");
    expect(validateValue(reply(id).result), JSON.stringify(validateValue.errors)).toBe(true);
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits: [{ keyPath: ["a"], value: "user-val", mergeStrategy: "replace" }] });
    expect(reply(id).result.status).toBe("okOverridden"); // fills overriddenMetadata + maskedEditIndexes + warnings
    expect(validateBatch(reply(id).result), JSON.stringify(validateBatch.errors)).toBe(true);
  });
  it("a write reply's filePath is ONE stable identity — same across writes, same as config/read's", async () => {
    // `realpath` answers only for a path that EXISTS, so the first write to a fresh file used to reply with
    // the literal `/var/…` spelling and the second with the canonical `/private/var/…` one, while
    // `config/read` said `/var/…` forever. One file, more than one name, and no client able to correlate a
    // write reply with a read reply — or with its own earlier write — by string (review I2).
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["a"], value: 1, mergeStrategy: "replace" });
    const first = reply(id).result.filePath;
    expect(first).toBe(realpathSync(join(home, ".claude", "settings.json")));
    id = await send("config/value/write", { keyPath: ["b"], value: 2, mergeStrategy: "replace" });
    expect(reply(id).result.filePath).toBe(first); // second write, same file, same string
    id = await send("config/read", { cwd: proj, includeLayers: true });
    expect(reply(id).result.layers.find((l: any) => l.name === "user").filePath).toBe(first); // and the read agrees
    // The same has to hold when the target's PARENT does not exist yet either. Resolution no longer
    // creates it (review M3), so canonicalizing only the immediate parent would fall back to the literal
    // spelling on the first write and switch to the canonical one on the second — the identical bug, one
    // directory further up. The deepest EXISTING ancestor is canonicalized instead, so the answer does not
    // depend on which directories happen to be there yet.
    rmSync(join(home, ".claude"), { recursive: true, force: true });
    boot(deps());
    id = await send("config/value/write", { keyPath: ["a"], value: 1, mergeStrategy: "replace" });
    const fromNothing = reply(id).result.filePath;
    expect(fromNothing).toBe(realpathSync(join(home, ".claude", "settings.json")));
    id = await send("config/value/write", { keyPath: ["b"], value: 2, mergeStrategy: "replace" });
    expect(reply(id).result.filePath).toBe(fromNothing);
  });
  it("masking names the EFFECTIVE layer, agrees with config/read, and carves out only array-over-array", async () => {
    // Precedence runs user < project < local < managed, so the layer a client actually sees is the LAST
    // one above the target that defines the key, not the first. Naming the first told a client "project is
    // masking you"; it edited the project file and stayed masked, while `effectiveValue` — a field named
    // for the value in force — reported one the same server's `config/read` contradicted (review I1).
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ a: "PROJECT" }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ a: "LOCAL", k: ["L"] }));
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["a"], value: "USER", mergeStrategy: "replace", target: "user", cwd: proj });
    let r = reply(id).result;
    expect(r.status).toBe("okOverridden");
    expect(r.overriddenMetadata.overridingLayer).toBe("local");
    expect(r.overriddenMetadata.effectiveValue).toBe("LOCAL"); // the value served, not the first one found
    expect(r.overriddenMetadata.message).toMatch(/local/);     // the sentence names that layer too
    id = await send("config/read", { cwd: proj });
    expect(reply(id).result.origins["a"]).toBe("local");       // the cross-check that would have caught I1
    expect(reply(id).result.config.a).toBe("LOCAL");
    // Array over array is a CONTRIBUTION: both survive the merge, so nothing is masked...
    id = await send("config/value/write", { keyPath: ["k"], value: ["U"], mergeStrategy: "replace", target: "user", cwd: proj });
    expect(reply(id).result.status).toBe("ok");
    expect(reply(id).result.maskedEditIndexes).toBeUndefined();
    // ...but a higher array over a written SCALAR is a plain replacement — the scalar never reaches the
    // effective view, and exempting it reported `ok` for a write that had no effect at all (review M2).
    id = await send("config/value/write", { keyPath: ["k"], value: "scalar", mergeStrategy: "replace", target: "user", cwd: proj });
    r = reply(id).result;
    expect(r.status).toBe("okOverridden");
    expect(r.overriddenMetadata.overridingLayer).toBe("local");
    expect(r.overriddenMetadata.effectiveValue).toEqual(["L"]);
    id = await send("config/read", { cwd: proj });
    expect(reply(id).result.config.k).toEqual(["L"]); // the scalar really did not take effect
  });
  it("the managed layer masks too — it is the TOP of the precedence tuple", async () => {
    // `above` is a slice of the literal order tuple, and dropping its last element is a one-token edit no
    // other row notices: managed is the layer no user file can outrank, so a write it masks is exactly the
    // one a client most needs to be told about. It is also the highest, so it doubles as the I1 check.
    writeFileSync(join(home, "managed.json"), JSON.stringify({ model: "managed-model" }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: "local-model" }));
    boot(deps());
    const id = await send("config/value/write", { keyPath: ["model"], value: "user-model", mergeStrategy: "replace", target: "user", cwd: proj });
    const r = reply(id).result;
    expect(r.status).toBe("okOverridden");
    expect(r.overriddenMetadata.overridingLayer).toBe("managed");
    expect(r.overriddenMetadata.effectiveValue).toBe("managed-model");
  });
  it("a successful batch applies its edits IN ORDER (spec acceptance 3)", async () => {
    // The ordered/atomic row above asserts atomicity only: its batch REFUSES, so ordering never reaches
    // disk, and every batch that succeeds elsewhere has non-interacting edits. Reversing the apply loop
    // changed the bytes and no row noticed — "ordered" lived in a test's title. Both keys here are
    // order-sensitive in opposite directions: reversed, `permissions.allow` comes out `["A"]` (the upsert
    // lands on nothing and the replace then wins) and `model` comes out "first".
    boot(deps());
    const id = await send("config/batchWrite", { edits: [
      { keyPath: ["permissions", "allow"], value: ["A"], mergeStrategy: "replace" },
      { keyPath: ["permissions", "allow"], value: ["B"], mergeStrategy: "upsert" },
      { keyPath: ["model"], value: "first", mergeStrategy: "replace" },
      { keyPath: ["model"], value: "last", mergeStrategy: "replace" },
    ] });
    expect(reply(id).result.status).toBe("ok");
    expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")))
      .toEqual({ permissions: { allow: ["A", "B"] }, model: "last" });
  });
  it("real top-level keys warn about NOTHING; a nested key written at the top level does; one key warns once", async () => {
    // The advisory is never a refusal, which is exactly why it has to be TRUE — an untrue advisory is
    // worse than none, and the hand-written list was wrong in both directions (review M1). `attribution`
    // (upstream spells it singular), `language` and `disableAllHooks` are real top-level keys that warned;
    // `defaultMode`, `additionalDirectories` and `disableBypassPermissionsMode` live inside `permissions`,
    // so writing them at the top level is genuinely wrong and warned about nothing.
    boot(deps());
    for (const key of ["model", "attribution", "language", "disableAllHooks", "$schema"]) {
      const id = await send("config/value/write", { keyPath: [key], value: "x", mergeStrategy: "replace" });
      expect(reply(id).result.warnings, `a real top-level key must not warn: ${key}`).toBeUndefined();
    }
    for (const key of ["defaultMode", "additionalDirectories", "disableBypassPermissionsMode", "attributions"]) {
      const id = await send("config/value/write", { keyPath: [key], value: "x", mergeStrategy: "replace" });
      expect(reply(id).result.warnings?.[0], `this key is not top-level upstream and must warn: ${key}`).toMatch(key);
    }
    // One unknown key across three edits is one sentence, not three copies of it (review M5).
    const id = await send("config/batchWrite", { edits: [
      { keyPath: ["nope", "a"], value: 1, mergeStrategy: "replace" },
      { keyPath: ["nope", "b"], value: 2, mergeStrategy: "replace" },
      { keyPath: ["nope", "c"], value: 3, mergeStrategy: "replace" },
    ] });
    expect(reply(id).result.warnings).toEqual(['unknown top-level settings key "nope" (written anyway)']);
  });
  it("a lock that cannot be broken refuses BUSY (-33001)/ConfigLocked, not \"your params are wrong\"", async () => {
    // Contention is not a validation failure: the request was well-formed and its target real, another
    // writer simply holds it — and -32602 is the one reading guaranteed to stop a client retrying (review
    // I3). BUSY is where every other "retry shortly" in this server already lives, so no new -330xx code
    // is spent on it. The lock planted here is a LIVE holder's (D-M5-24): a claim directory whose marker
    // carries a lease an hour into the future, so no amount of waiting makes it breakable. That is the
    // pairing this milestone chose — a live holder is waited for and then REFUSED, never evicted, because
    // evicting one was measured destroying the evictor's own already-acknowledged write.
    // Only `Date` is faked — the 35s budget is otherwise real elapsed time, which a unit suite cannot
    // spend, and that budget IS the point: the stall is the reachable symptom, the refusal is the rare one.
    boot(deps());
    const lockDir = join(home, ".claude", "settings.json.lock");
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "9999-live-holder"), "9999-live-holder\n");
    const lease = new Date(Date.now() + 3_600_000);
    utimesSync(join(lockDir, "9999-live-holder"), lease, lease);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const id = sendNoAwait("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace" });
      await new Promise((r) => setTimeout(r, 50));  // let the handler compute its deadline off the live clock
      vi.setSystemTime(Date.now() + 60_000);        // ...then let that whole budget elapse
      await waitFor(() => reply(id) !== undefined);
      expect(reply(id).error.code).toBe(-33001);
      expect(reply(id).error.data).toEqual({ code: "ConfigLocked" });
      expect(reply(id).error.message).toMatch(/locked by another writer/);
      expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false); // and it wrote nothing
    } finally { vi.useRealTimers(); }
  });
  it("a refused write leaves no settings file and no leftovers", async () => {
    // Resolution used to `mkdir` the target's parent ahead of the lock and ahead of the CAS compare, so a
    // refused write had already created `<cwd>/.claude/` in a client-named directory (review M3). That
    // mkdir is gone: `withFileLock` and `writeTargetDoc` each create the parent they actually need. The
    // lock does have to live in that directory, so a refusal reached from INSIDE the critical section
    // still creates it — what must never survive is a settings file, a lock, or a tmp file.
    const fresh = mkdtempSync(join(tmpdir(), "m5cwd-"));
    boot(deps());
    try {
      const id = await send("config/value/write", { keyPath: ["model"], value: "x", mergeStrategy: "replace", target: "local", cwd: fresh, expectedVersion: sha256("bytes this file never held") });
      expect(reply(id).error.data).toEqual({ code: "ConfigVersionConflict" });
      expect(existsSync(join(fresh, ".claude", "settings.local.json"))).toBe(false);
      expect(existsSync(join(fresh, ".claude")) ? readdirSync(join(fresh, ".claude")) : []).toEqual([]);
    } finally { rmSync(fresh, { recursive: true, force: true }); }
  });
  it("an object write that PARTIALLY lands is `ok` — the verdict is the read side's, leaf by leaf", async () => {
    // The F1 defect, measured: masking was judged at the written keyPath while the merge operates leaf-wise
    // beneath it. Writing `env: {A}` under a project `env: {B}` reported `okOverridden` with
    // `effectiveValue {B:"2"}` — and the same server's `config/read` served `{A:"1",B:"2"}` and attributed
    // `env.A` to the layer just written. The client was told its write did nothing while the write was in
    // force. Same shape for `permissions.allow`, where BOTH layers' entries survive the merge.
    // The `env` edit is deliberately MIXED — `A` lands, `B` is masked — because that is the case the rule's
    // "only when NO leaf is in force" clause exists for: a per-leaf verdict alone would report the edit
    // masked on the strength of `B`, and the client would be told a write it can see took no effect.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ env: { B: "2" }, permissions: { allow: ["P"] } }));
    boot(deps());
    const edits = [
      { keyPath: ["env"], value: { A: "1", B: "9" }, mergeStrategy: "replace" },
      { keyPath: ["permissions"], value: { allow: ["U"] }, mergeStrategy: "replace" },
    ];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.env).toEqual({ A: "1", B: "2" });               // deep merge: the write landed at env.A
    expect(r.origins["env.A"]).toBe("user");
    expect(r.origins["env.B"]).toBe("project");                     // ...and did not, at env.B
    expect(r.config.permissions.allow).toEqual(["U", "P"]);         // arrays merge by contribution
    expect(r.origins["permissions.allow"]).toEqual(["user", "project"]);
    expect(w.status).toBe("ok");
    expect(w.maskedEditIndexes).toBeUndefined();
    expect(w.overriddenMetadata).toBeUndefined();
    expectAgreesWithRead(w, r, "user", edits);
  });
  it("an object write whose every written sub-key is defined above IS masked, at the MERGED value", async () => {
    // The other half of the same rule: nothing the edit introduces survives, so the edit is masked — and
    // `effectiveValue` is read out of the merged config, never out of the masking layer's own value. Those
    // two differ here on purpose: the user file's own `env.Z` is untouched by the project layer and stays
    // in the effective view, so a reply built from `top.value` would report `{A:"PROJ"}` for a key the read
    // side serves as `{Z:"z",A:"PROJ"}` — the same disagreement F1 exists to make impossible.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ env: { Z: "z" } }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ env: { A: "PROJ" } }));
    boot(deps());
    const edits = [{ keyPath: ["env"], value: { A: "1" }, mergeStrategy: "upsert" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(w.status).toBe("okOverridden");
    expect(w.maskedEditIndexes).toEqual([0]);
    expect(w.overriddenMetadata.overridingLayer).toBe("project");
    expect(r.config.env).toEqual({ Z: "z", A: "PROJ" });
    expect(w.overriddenMetadata.effectiveValue).toEqual(r.config.env); // the merged value, not the layer's
    expect(w.overriddenMetadata.effectiveValue).not.toEqual({ A: "PROJ" });
    expectAgreesWithRead(w, r, "user", edits);
  });
  it("a higher layer that replaced the written object's PARENT masks every leaf under it", async () => {
    // `origins` keys the LEAVES of the effective view, so a written leaf whose object parent a higher layer
    // overwrote with a scalar has no entry of its own — the layer that swallowed it is named at the parent.
    // Looking only at the exact leaf reads that absence as "nobody is above me" and reports `ok` for a write
    // that never reaches the effective view at all: the F1 disagreement, running the other way.
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ env: "not-an-object" }));
    boot(deps());
    const edits = [{ keyPath: ["env"], value: { A: "1" }, mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.env).toBe("not-an-object");   // the written object never reaches the effective view
    expect(r.origins["env"]).toBe("local");
    expect(r.origins["env.A"]).toBeUndefined();   // the leaf itself is unattributed — that is the trap
    expect(w.status).toBe("okOverridden");
    expect(w.maskedEditIndexes).toEqual([0]);
    expect(w.overriddenMetadata.overridingLayer).toBe("local");
    expect(w.overriddenMetadata.effectiveValue).toBe(r.config.env);
    expectAgreesWithRead(w, r, "user", edits);
  });
  it("a delete is in force by ABSENCE; masked only while the key is still defined ABOVE", async () => {
    // A delete introduces no value, so "is the leaf attributed to me?" has to invert: the delete took
    // effect exactly when nothing is served at that leaf any more. A key a HIGHER layer still defines is
    // the masked case; a key nothing else defines is plainly `ok`; and a key only a LOWER layer defines
    // is `ok` too — the target's own value really is gone, and calling `user` an "overriding" layer for a
    // `local` delete would send a client to edit a file that outranks nothing.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "U", outputStyle: "S" }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ model: "PROJ" }));
    boot(deps());
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits: [
      { keyPath: ["model"], value: null, mergeStrategy: "replace" },       // still defined by project
      { keyPath: ["outputStyle"], value: null, mergeStrategy: "replace" }, // nobody else defines it
    ] });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(w.maskedEditIndexes).toEqual([0]);
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("project");
    expect(r.origins["model"]).toBe("project");            // the read side says the same thing
    expect(w.overriddenMetadata.effectiveValue).toBe(r.config.model);
    expect(r.config.outputStyle).toBeUndefined();          // ...and the second delete really is in force
    expect(r.origins["outputStyle"]).toBeUndefined();
    // A `local` delete that falls back to the lower `user` layer: gone from local, so the delete worked.
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ language: "local-lang" }));
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ language: "user-lang" }));
    id = await send("config/value/write", { keyPath: ["language"], value: null, mergeStrategy: "replace", target: "local", cwd: proj });
    expect(reply(id).result.status).toBe("ok");
    expect(reply(id).result.maskedEditIndexes).toBeUndefined();
    id = await send("config/read", { cwd: proj });
    expect(reply(id).result.config.language).toBe("user-lang");
  });
  it("an OBJECT above the written path masks it — and config/read does not move one byte across the write", async () => {
    // The mirror of the F1 defect, and the hole that survived it: `origins` carries entries only for
    // LEAVES, so a higher layer holding an OBJECT at the written path leaves NO entry at that path at all.
    // The ancestor climb looks only upward, finds nothing, and the `masking.length === 0` clause — which
    // exists to make a DELETE in force by absence — then declares the leaf in force. The reply said `ok`
    // for a write with literally zero observable effect (review H1). The rows above never construct this:
    // they mask with scalars and arrays, both of which DO get an entry of their own.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ env: { B: "2" } }));
    boot(deps());
    let id = await send("config/read", { cwd: proj });
    const before = reply(id).result;
    const edits = [{ keyPath: ["env"], value: "SCALAR-FROM-USER", mergeStrategy: "replace" }];
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    // The strongest single assertion available: the merged view AND its attribution are byte-identical
    // before and after. Nothing a reader can observe changed, so `ok` cannot be an honest verdict.
    // (`versions` is deliberately excluded — the target file's CAS token moves, and must.)
    expect(JSON.stringify({ config: r.config, origins: r.origins })).toBe(JSON.stringify({ config: before.config, origins: before.origins }));
    expect(r.origins["env"]).toBeUndefined();      // no entry AT the path — the trap
    expect(r.origins["env.B"]).toBe("project");    // the masking layer is named only BELOW it
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("project");
    expectAgreesWithRead(w, r, "user", edits);
    // An ARRAY write under the same object does NOT hit this hole, and the reason is upstream's merge, not
    // this method: an object merged over an array keeps the ARRAY (measured against real lodash), so the
    // write is in force and the object above is a contributor to it. Kept as a row because the obvious
    // reading — "an object above always swallows what is below" — is what the array half used to assert.
    //   `origins["env"]` names the USER ALONE, and that is the half this row got wrong before: project's
    // key here is `B`, which is not an array index, so it rides the array as a property JSON never
    // serializes. A layer whose whole contribution is invisible on the wire is not a contributor to what
    // is served, and naming it is the B4 over-attribution one shape further along.
    const arrEdits = [{ keyPath: ["env"], value: ["a", "b"], mergeStrategy: "replace" }];
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits: arrEdits });
    const w2 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r2 = reply(id).result;
    expect(JSON.stringify(r2.config.env)).toBe('["a","b"]');   // the array survives the object above it
    expect(r2.origins["env"]).toEqual(["user"]);
    expect(w2.status).toBe("ok");
    expectAgreesWithRead(w2, r2, "user", arrEdits);
    // …and an array write IS masked by a SCALAR above it, which is the shape that still has no entry of its
    // own at the path. One row per side, so a change that lost either verdict fails here.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ env: "PROJECT-SCALAR" }));
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits: arrEdits });
    const w3 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r3 = reply(id).result;
    expect(r3.config.env).toBe("PROJECT-SCALAR");
    expect(w3.status).toBe("okOverridden");
    expect(w3.overriddenMetadata.overridingLayer).toBe("project");
    expectAgreesWithRead(w3, r3, "user", arrEdits);
  });
  it("an INDEX-keyed object above an array write masks it when it covers every element, and does NOT when it covers only some", async () => {
    // The regression fix wave B's B5 introduced, and the two sides of the rule that replaces it. B5 was
    // right that an object over an array keeps the array (real lodash) — but it made the object an
    // unconditional CO-CONTRIBUTOR in `origins`, and `maskingVerdict` reads that list by MEMBERSHIP. So a
    // write whose every element a higher layer's index keys had replaced still read as "attributed to me"
    // and was reported `ok`, in force, while `config/read` served the higher layer's value at the path.
    //
    // The ORACLE HERE IS THE VALUE, deliberately: `expectAgreesWithRead` compares attribution against
    // attribution, which is structurally incapable of catching an over-attribution — both sides read the
    // same wrong list and agree. It runs too (the two methods must still agree), but the assertion that
    // actually fails when this breaks is "is what I wrote present at that path in the merged view".
    const written = ["USER-WRITES-THIS"];
    const wrote = (r: any) => JSON.stringify(r.config.permissions.allow) === JSON.stringify(written);
    // (a) COVERED: one index key over a one-element array — nothing of the user's write is served.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["OLD"] } }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: { 0: "PROJECT-WINS" } } }));
    boot(deps());
    const edits = [{ keyPath: ["permissions", "allow"], value: written, mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toContain("USER-WRITES-THIS"); // the bytes DID land
    expect(wrote(r), "config/read must not serve the user's array here").toBe(false);
    expect(JSON.stringify(r.config.permissions.allow)).toBe('["PROJECT-WINS"]');
    expect(r.origins["permissions.allow"]).toEqual(["project"]);   // the user contributes nothing that shows
    expect(w.status).toBe("okOverridden");
    expect(w.maskedEditIndexes).toEqual([0]);
    expect(w.overriddenMetadata.overridingLayer).toBe("project");
    expect(w.overriddenMetadata.effectiveValue).toEqual(["PROJECT-WINS"]);
    expectAgreesWithRead(w, r, "user", edits);
    // (b) NOT COVERED: the same shape with a two-element write, where index 0 survives. The array the
    // client asked for is not what is served either — but part of it IS, so the write is in force and the
    // reply must NOT claim an override. Without this side the fix could be "always reset on an object",
    // which is the opposite error and equally wrong.
    const both = ["USER-KEEPS-THIS", "USER-LOSES-THIS"];
    const edits2 = [{ keyPath: ["permissions", "allow"], value: both, mergeStrategy: "replace" }];
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: { 1: "PROJECT-PATCHES-ONE" } } }));
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits: edits2 });
    const w2 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r2 = reply(id).result;
    expect(JSON.stringify(r2.config.permissions.allow)).toBe('["USER-KEEPS-THIS","PROJECT-PATCHES-ONE"]');
    expect(r2.origins["permissions.allow"]).toEqual(["user", "project"]);
    expect(w2.status).toBe("ok");
    expectAgreesWithRead(w2, r2, "user", edits2);
  });
  it("the masking object can be NESTED, and the write it masks can come from a MIDDLE layer", async () => {
    // Two independent generalisations of the same hole. Depth: the swallowing object sits three segments
    // down, so a fix that only looked one level below the leaf would still miss it. Rank: the masked write
    // targets `project`, not `user`, so the descendant contributors have to be filtered by PRECEDENCE and
    // not by "any layer that is not me" — the same rank test the scalar path has always used.
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: { PreToolUse: { cmd: { nested: "LOCAL" } } }, outputStyle: { a: 1 } }));
    boot(deps());
    const edits = [{ keyPath: ["hooks", "PreToolUse", "cmd"], value: "USERVAL", mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.hooks.PreToolUse.cmd).toEqual({ nested: "LOCAL" });
    expect(r.origins["hooks.PreToolUse.cmd"]).toBeUndefined();
    expect(r.origins["hooks.PreToolUse.cmd.nested"]).toBe("local");
    expect(w.overriddenMetadata.overridingLayer).toBe("local");
    expectAgreesWithRead(w, r, "user", edits);
    const projEdits = [{ keyPath: ["outputStyle"], value: "PROJVAL", mergeStrategy: "replace" }];
    id = await send("config/batchWrite", { target: "project", cwd: proj, edits: projEdits });
    const w2 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r2 = reply(id).result;
    expect(r2.config.outputStyle).toEqual({ a: 1 });
    expect(w2.overriddenMetadata.overridingLayer).toBe("local");
    expectAgreesWithRead(w2, r2, "project", projEdits);
  });
  it("a delete an OBJECT above still holds is masked; one whose fallback object is BELOW stays in force", async () => {
    // Both halves of "in force by absence" against the same object shape, because the fix to the hole runs
    // straight through the clause that principle rests on. Above the target: the key is still served, so
    // the delete did not take effect. Below it: the target's own value really is gone, and naming a layer
    // it outranks as the "overriding" one would send a client to edit a file that overrides nothing.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "U" }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: { deep: 1 } }));
    boot(deps());
    const edits = [{ keyPath: ["model"], value: null, mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.model).toEqual({ deep: 1 });   // still served, so the delete is masked
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("local");
    expectAgreesWithRead(w, r, "user", edits);
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ language: { deep: "user" } }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ language: "local-lang" }));
    id = await send("config/value/write", { keyPath: ["language"], value: null, mergeStrategy: "replace", target: "local", cwd: proj });
    expect(reply(id).result.status).toBe("ok");
    expect(reply(id).result.maskedEditIndexes).toBeUndefined();
    id = await send("config/read", { cwd: proj });
    expect(reply(id).result.config.language).toEqual({ deep: "user" });
    expect(reply(id).result.origins["language.deep"]).toBe("user"); // the descendants are all BELOW the target
  });
  it("a masked reply whose keyPath does not resolve OMITS effectiveValue, and still validates (review H2)", async () => {
    // `effectiveValue` is read out of the merged config, and that path does not always resolve: a scalar
    // above the written object leaves NO value at `env.A` at all. `JSON.stringify` then drops the key and
    // the reply violated its own published schema (`must have required property 'effectiveValue'`, under
    // `additionalProperties: false`). Absent, never `null` — a settings file may legitimately hold a null
    // leaf, so `null` would be ambiguous with a real value while absence is not.
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ env: "not-an-object" }));
    boot(deps());
    const results = (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results;
    const validate = new Ajv({ strict: true }).compile(results["config/value/write"]);
    let id = await send("config/value/write", { keyPath: ["env", "A"], value: "1", mergeStrategy: "replace", target: "user", cwd: proj });
    const w = reply(id).result;
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("local");
    expect("effectiveValue" in w.overriddenMetadata).toBe(false);
    expect(validate(w), JSON.stringify(validate.errors)).toBe(true);
    id = await send("config/read", { cwd: proj });
    expect(reply(id).result.config.env).toBe("not-an-object"); // the merged view has nothing at env.A
  });
  it("an empty-object edit introduces no leaf, so nothing of it can be masked — keyPath still guarded", async () => {
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ env: { B: "2" } }));
    boot(deps());
    // `value: {}` yields NO leaves, the per-leaf loop never runs, and the verdict falls to the
    // `maskedBy === undefined` arm. `ok` is the honest answer: nothing was added to the effective view,
    // so nothing of it can be masked. Nothing else in the suite reaches that arm.
    let id = await send("config/value/write", { keyPath: ["env"], value: {}, mergeStrategy: "upsert", target: "user", cwd: proj });
    let w = reply(id).result;
    expect(w.status).toBe("ok");
    expect(w.maskedEditIndexes).toBeUndefined();
    expect(w.uncheckedEditIndexes).toBeUndefined();
    // ...and `{}` is the one shape whose keyPath is not also a leaf, which is the whole reason the dotted
    // guard tests `e.keyPath` in its own right beside the leaves. Drop it and this goes silently unchecked.
    id = await send("config/value/write", { keyPath: ["env", "A.B"], value: {}, mergeStrategy: "upsert", target: "user", cwd: proj });
    w = reply(id).result;
    expect(w.uncheckedEditIndexes).toEqual([0]);
    expect(w.warnings.some((s: string) => /edit 0 \("env \/ A\.B"\)/.test(s))).toBe(true);
  });
  it("a batch reports its OWN masked indexes and describes the FIRST masked edit", async () => {
    // Two mutations lived here undetected because no row had a masked edit anywhere but index 0, and none
    // had two of them: `push(i)` → `push(0)` survived the whole suite, and so did `??=` → `=`, which
    // silently reports the LAST masked edit instead of the first the spec promises. Masked at 2 and 3, by
    // two different layers, kills both at once — and the surviving indexes are checked against the read
    // side's attribution rather than against a literal, so the row cannot drift from the rule.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ model: "P" }));
    writeFileSync(join(home, "managed.json"), JSON.stringify({ outputStyle: "M" }));
    boot(deps());
    const edits = [
      { keyPath: ["language"], value: "en", mergeStrategy: "replace" },
      { keyPath: ["fastMode"], value: true, mergeStrategy: "replace" },
      { keyPath: ["model"], value: "u", mergeStrategy: "replace" },       // masked by project
      { keyPath: ["outputStyle"], value: "u", mergeStrategy: "replace" }, // masked by managed
    ];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(w.maskedEditIndexes).toEqual([2, 3]);
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("project"); // the FIRST masked edit, not the last
    expect(w.overriddenMetadata.effectiveValue).toBe("P");
    expect(r.origins["model"]).toBe("project");
    expect(r.origins["outputStyle"]).toBe("managed");
    expect(r.origins["language"]).toBe("user");
    expectAgreesWithRead(w, r, "user", edits);
  });
  it("the warning names the TOP-LEVEL key, and distinct unknown keys each get their own", async () => {
    // Two more surviving mutations. Keying the filter on the LEAF segment instead of `keyPath[0]` warns
    // about nothing for `["nopeParent","model"]`, because the leaf name is a real settings key — the one
    // shape where being wrong is silent. And `[...new Set(...)]` → `.slice(0,1)` survived because the
    // dedupe row uses ONE unknown key three times, so accumulation of DISTINCT keys was never pinned.
    boot(deps());
    const id = await send("config/batchWrite", { edits: [
      { keyPath: ["nopeParent", "model"], value: "x", mergeStrategy: "replace" },
      { keyPath: ["alsoNope"], value: 1, mergeStrategy: "replace" },
    ] });
    expect(reply(id).result.warnings).toEqual([
      'unknown top-level settings key "nopeParent" (written anyway)',
      'unknown top-level settings key "alsoNope" (written anyway)',
    ]);
  });
  it("a keyPath segment carrying a literal dot: the override check is SKIPPED and says so", async () => {
    // `origins` addresses leaves by DOTTED path while a keyPath is an opaque segment array (D-M5-12), so a
    // segment containing a dot mis-splits and no verdict drawn from it can be trusted. This edit really IS
    // masked — and the read side cannot say so either, dropping the entry from `origins` entirely. Silence
    // would be a wrong verdict shipped as a right one, so the gap is reported in `warnings` and the edit is
    // left out of the masking answer: `ok` here means "not reported as overridden", and the sentence says
    // which key that applies to.
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ env: { "A.B": "LOCAL" } }));
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["env", "A.B"], value: "USER", mergeStrategy: "replace", target: "user", cwd: proj });
    const w = reply(id).result;
    expect(w.status).toBe("ok");
    expect(w.maskedEditIndexes).toBeUndefined();
    expect(w.overriddenMetadata).toBeUndefined();
    expect(w.uncheckedEditIndexes).toEqual([0]);      // the gap in MACHINE-READABLE form, beside the prose
    expect(w.warnings).toEqual(['could not check whether edit 0 ("env / A.B") is overridden — a key containing "." collides with this path, and the effective view addresses leaves by dotted path']);
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.env["A.B"]).toBe("LOCAL");        // masked in fact...
    expect(r.origins["env.A.B"]).toBeUndefined();     // ...and unattributable by either method
  });
  it("`status: \"ok\"` with unchecked edits is machine-readable: indexes, not prose (review M2)", async () => {
    // The verdict-unknown channel used to be one free-text sentence in `warnings`, and a client could not
    // tell "verdict unknown" from "verified in force" without string-matching it. Two edits sharing ONE
    // keyPath made that worse: the `Set` dedupe collapsed their two sentences into one, so a 64-edit batch
    // could report fewer gaps than it had. Indexes are per-edit by construction and cannot collapse.
    boot(deps());
    const id = await send("config/batchWrite", { target: "user", cwd: proj, edits: [
      { keyPath: ["env", "A.B"], value: "one", mergeStrategy: "replace" },
      { keyPath: ["model"], value: "checked", mergeStrategy: "replace" },  // no dot anywhere — a real verdict
      { keyPath: ["env", "A.B"], value: "two", mergeStrategy: "replace" }, // SAME keyPath as edit 0
    ] });
    const w = reply(id).result;
    expect(w.status).toBe("ok");
    expect(w.uncheckedEditIndexes).toEqual([0, 2]);   // both, and index 1 is genuinely checked
    expect(w.warnings).toHaveLength(2);               // the sentences no longer dedupe into one either
    expect(w.warnings[0]).toMatch(/edit 0 /);
    expect(w.warnings[1]).toMatch(/edit 2 /);
    // `additionalProperties: false`, so this also pins the schema regeneration: a new reply key that never
    // reached the published artifact fails here as loudly as a dropped required one.
    const results = (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results;
    const validate = new Ajv({ strict: true }).compile(results["config/batchWrite"]);
    expect(validate(w), JSON.stringify(validate.errors)).toBe(true);
  });
  it("a literal dot in ANOTHER layer's key does not let the reply name the client's own value as the overrider", async () => {
    // The guard used to see only the edit's OWN keys, so a collision arriving from a different layer went
    // unnoticed: `origins` keys leaves by dotted path (D-M5-12, a closed read-side limitation), and a
    // project `{"env.PROJKEY": "PROJ"}` occupies the very entry a user write of `["env","PROJKEY"]` would
    // be judged by. The reply said `okOverridden` / `project` / `effectiveValue: "USER"` — it named the
    // value the client had just written as the value overriding it, while `config/read` served that write
    // in force at `env.PROJKEY` beside a wholly separate `"env.PROJKEY"` key. Unknowable, so unchecked.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ "env.PROJKEY": "PROJ" }));
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["env", "PROJKEY"], value: "USER", mergeStrategy: "replace", target: "user", cwd: proj });
    const w = reply(id).result;
    expect(w.status).toBe("ok");
    expect(w.overriddenMetadata).toBeUndefined();     // never "your own value overrides you"
    expect(w.maskedEditIndexes).toBeUndefined();
    expect(w.uncheckedEditIndexes).toEqual([0]);
    expect(w.warnings.some((s: string) => /edit 0 \("env \/ PROJKEY"\)/.test(s))).toBe(true);
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.env.PROJKEY).toBe("USER");        // the write really IS in force...
    expect(r.config["env.PROJKEY"]).toBe("PROJ");     // ...beside a separate, literally-dotted key
    // A dotted key elsewhere in the merged view is NOT a hazard for an unrelated path — the guard must be
    // a collision test, not "any layer contains a dot anywhere", or every verdict in this repo goes silent.
    id = await send("config/value/write", { keyPath: ["model"], value: "m", mergeStrategy: "replace", target: "user", cwd: proj });
    expect(reply(id).result.uncheckedEditIndexes).toBeUndefined();
  });
  it("a parent that is there but is not a usable directory refuses ConfigValidationError, never -32603", async () => {
    // `mkdir(…, {recursive:true})` creates a missing parent — the ordinary first-write path — but cannot
    // fix a parent that is already SOMETHING ELSE, and node's raw message came back as -32603: an internal
    // error for a filesystem shape the client owns and can repair. The three shapes below are the ones
    // that reach it, and each names its own problem. Nothing may be created on the way out.
    for (const [label, plant] of [
      ["a dangling symlink", (h: string) => symlinkSync(join(h, "no-such-dir"), join(h, ".claude"))],
      ["a symlink loop", (h: string) => { symlinkSync(join(h, ".claude"), join(h, "loop")); symlinkSync(join(h, "loop"), join(h, ".claude")); }],
      ["a regular file", (h: string) => writeFileSync(join(h, ".claude"), "not a directory")],
    ] as const) {
      const h = mkdtempSync(join(tmpdir(), "m5parent-"));
      try {
        plant(h);
        boot({ configHome: h, managedSettingsPath: join(h, "managed.json"), ccxDir: join(h, "ccx") });
        const id = await send("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace" });
        expect(reply(id).error?.code, `${label}: must not be an internal error`).toBe(-32602);
        expect(reply(id).error.data, label).toEqual({ code: "ConfigValidationError" });
        expect(reply(id).error.message, label).toMatch(/settings directory/);
        expect(reply(id).error.message, `${label}: node's raw mkdir message must not be the answer`).not.toMatch(/mkdir/);
        expect(existsSync(join(h, ".claude", "settings.json")), label).toBe(false);
      } finally { rmSync(h, { recursive: true, force: true }); }
    }
  });
  it("a symlinked settings FILE: the read names where the layer is looked up, the write names the real file", async () => {
    // `canonicalPath` canonicalizes the PARENT and keeps the leaf, so `config/read` reports the link's own
    // path; `resolveRealTarget` follows the link, so the write reply reports the file the bytes landed in —
    // which is also the lock identity. Both are correct and each is the right one for its caller, so the
    // I2 claim of ONE spelling per file is narrowed rather than the behaviour changed. This row pins the
    // divergence so a later "fix" that collapses them has to argue with a test instead of a comment.
    writeFileSync(join(home, ".claude", "settings.json"), "{}");
    symlinkSync(join(home, ".claude", "settings.json"), join(proj, ".claude", "settings.json"));
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["model"], value: "x", mergeStrategy: "replace", target: "project", cwd: proj });
    const written = reply(id).result.filePath;
    expect(written).toBe(realpathSync(join(home, ".claude", "settings.json")));
    id = await send("config/read", { cwd: proj, includeLayers: true });
    const lookedUp = reply(id).result.layers.find((l: any) => l.name === "project").filePath;
    expect(lookedUp).toBe(join(realpathSync(join(proj, ".claude")), "settings.json"));
    expect(lookedUp).not.toBe(written); // the one shape where the two methods name one file two ways
  });
  it("an object above the written path that attributes NOTHING anywhere still masks it", async () => {
    // Divergence class 1, and the reason the verdict is now a LOOKUP rather than a search: an object built
    // only out of empty objects has no `origins` entry at the written leaf, none above it and none below it,
    // so every search for "who outranks me" comes back empty and the old `masking.length === 0` clause read
    // that as "nobody does". The rule says the opposite — an unattributed leaf is masked — and it is right:
    // the merged view below contains no trace of any of these writes.
    //
    // Both written values are SCALARS on purpose: an empty object above an ARRAY does not swallow it at all
    // under upstream's merge (the array survives — see the object-over-array rows), so an array here would
    // be testing the merge rule rather than this method's verdict.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: {}, env: { a: {} } }));
    writeFileSync(join(home, "managed.json"), JSON.stringify({ outputStyle: {} }));
    boot(deps());
    const edits = [
      { keyPath: ["hooks"], value: "USER", mergeStrategy: "replace" },        // top-level empty object above
      { keyPath: ["env", "a"], value: "W", mergeStrategy: "replace" },        // ...and one level deeper
    ];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config).toEqual({ hooks: {}, env: { a: {} }, outputStyle: {} }); // nothing written is in view
    expect(r.origins).toEqual({});                                           // ...and NOTHING is attributed
    expect(w.status).toBe("okOverridden");
    expect(w.maskedEditIndexes).toEqual([0, 1]);
    expect(w.overriddenMetadata.overridingLayer).toBe("project");            // named from the layer files
    expect(w.overriddenMetadata.effectiveValue).toEqual({});
    expectAgreesWithRead(w, r, "user", edits);
    // The same shape with `managed` masking a `project` target: the name comes off a rank scan, not off
    // "any layer that is not me", so the layer BELOW the target must not be the one reported.
    const projEdits = [{ keyPath: ["outputStyle"], value: "PROJ", mergeStrategy: "replace" }];
    id = await send("config/batchWrite", { target: "project", cwd: proj, edits: projEdits });
    const w2 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r2 = reply(id).result;
    expect(r2.config.outputStyle).toEqual({});
    expect(w2.status).toBe("okOverridden");
    expect(w2.overriddenMetadata.overridingLayer).toBe("managed");
    expectAgreesWithRead(w2, r2, "project", projEdits);
  });
  it("an ancestor FLATTENED at one layer and rebuilt at a higher one masks the leaf it never restored", async () => {
    // Divergence class 2 — no empty object anywhere. The middle layer's non-object wipes every `origins`
    // entry under the ancestor; the higher layer rebuilds it out of SIBLINGS of the written leaf. The leaf
    // itself therefore has no entry, no ancestor entry (the rebuild replaced it) and no descendants, so the
    // search comes back empty exactly as in class 1 — while the read side plainly serves someone else's
    // object at the ancestor. The name is the layer that FLATTENED it (`project`), not the one that rebuilt
    // it: without project's scalar the user's leaf and local's would deep-merge and both survive, so local
    // is not the file a client would have to edit.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: "P" }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: { c: "L" } }));
    boot(deps());
    const edits = [{ keyPath: ["hooks", "a"], value: "USER", mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.hooks).toEqual({ c: "L" });
    expect(r.origins).toEqual({ "hooks.c": "local" });   // a SIBLING is attributed; the written leaf is not
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("project");
    expect("effectiveValue" in w.overriddenMetadata).toBe(false); // `hooks.a` resolves to nothing at all
    expectAgreesWithRead(w, r, "user", edits);
  });
  it("the same shape in ordinary settings vocabulary: a project `statusLine: null` under a local object", async () => {
    // Class 2 with nothing contrived about it. `<proj>/.claude/settings.json` disables the status line with
    // a null; `settings.local.json` re-enables a command status line; the user adds the command. The reply
    // used to say `ok` for a write `config/read` serves nowhere and attributes to nobody.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ statusLine: null }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ statusLine: { type: "command" } }));
    boot(deps());
    const edits = [{ keyPath: ["statusLine", "command"], value: "~/bin/statusline.sh", mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.statusLine).toEqual({ type: "command" });
    expect(r.origins).toEqual({ "statusLine.type": "local" });
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("project");
    expectAgreesWithRead(w, r, "user", edits);
  });
  it("four layers deep: flattened at project, rebuilt at local AND managed, written at user", async () => {
    // The rebuild spread across two layers above the flattener, so the surviving entries name two different
    // layers and neither of them is on the written path. The verdict is still one lookup, and the name is
    // still the flattener.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ env: "off" }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ env: { L: "1" } }));
    writeFileSync(join(home, "managed.json"), JSON.stringify({ env: { M: "2" } }));
    boot(deps());
    const edits = [{ keyPath: ["env", "A"], value: "1", mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.env).toEqual({ L: "1", M: "2" });
    expect(r.origins).toEqual({ "env.L": "local", "env.M": "managed" });
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("project");
    expectAgreesWithRead(w, r, "user", edits);
  });
  it("a delete under an object that attributes NOTHING: masked when it is above, in force when below", async () => {
    // The delete half of class 1, and the ONE state neither method can settle from `origins` alone: the key
    // still resolves while nothing at or under it is attributed, because `mergeTracked` records no entry for
    // an object node. `readVerdictForDelete` reports that honestly as "unknown", so this row asserts the
    // reply by hand — and the tie is broken in the only safe direction: masked only when a layer that really
    // does hold the path outranks the target. Below the target it stays in force, or a client would be sent
    // to edit a file that overrides nothing.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: "U" }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["hooks"], value: null, mergeStrategy: "replace", target: "user", cwd: proj });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"))).toEqual({}); // it landed
    expect(r.config.hooks).toEqual({});                        // ...and the key is still served, from above
    expect(r.origins).toEqual({});
    expect(readVerdictForDelete(r, "user", ["hooks"])).toBe("unknown"); // pins WHY this row asserts by hand
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("project");
    // Same object, one rank down: `user` holds it and `local` deletes, so nothing above the target claims
    // the path and the delete is in force — the lower layer's value showing through is not a mask.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: {} }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: "L" }));
    id = await send("config/value/write", { keyPath: ["model"], value: null, mergeStrategy: "replace", target: "local", cwd: proj });
    const w2 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r2 = reply(id).result;
    expect(r2.config.model).toEqual({});
    expect(readVerdictForDelete(r2, "local", ["model"])).toBe("unknown");
    expect(w2.status).toBe("ok");
    expect(w2.maskedEditIndexes).toBeUndefined();
  });
  it("a delete under a flattened-then-rebuilt ancestor: gone from the view is in force, still served is masked", async () => {
    // The delete half of class 2, both directions, and both decidable from the read reply alone.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { a: "U" } }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: "P" }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: { c: "L" } }));
    boot(deps());
    const leafDelete = [{ keyPath: ["hooks", "a"], value: null, mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits: leafDelete });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(valueAtRead(r.config, ["hooks", "a"])).toBeUndefined(); // the path resolves to nothing: in force
    expect(w.status).toBe("ok");
    expectAgreesWithRead(w, r, "user", leafDelete);
    const ancestorDelete = [{ keyPath: ["hooks"], value: null, mergeStrategy: "replace" }];
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits: ancestorDelete });
    const w2 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r2 = reply(id).result;
    expect(r2.config.hooks).toEqual({ c: "L" });                  // still served, and by a layer above
    expect(w2.status).toBe("okOverridden");
    expect(w2.overriddenMetadata.overridingLayer).toBe("local");
    expectAgreesWithRead(w2, r2, "user", ancestorDelete);
  });
  it("a leaf BELOW a deleted path does not answer for the layers ABOVE it", async () => {
    // The state a search-shaped delete verdict cannot see, and the reason the verdict is now a
    // counterfactual over merges. B and C below differ by ONE thing — a user leaf under the deleted path,
    // strictly below the target — while the layer above the target is byte-identical in both. The old
    // verdict asked `origins` who stood near the path, found that user leaf, saw nobody above it in that
    // neighbourhood and returned `ok`; the tie-break built for precisely this state (`local` holds an
    // object attributed to nobody) was unreachable because the neighbourhood was not empty. So one case
    // said `ok` and the other `okOverridden` for the same masking layer.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { a: "U" } }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: { b: "P" } }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: { z: {} } }));
    boot(deps());
    const edits = [{ keyPath: ["hooks"], value: null, mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "project", cwd: proj, edits });
    const b = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const rb = reply(id).result;
    expect(rb.config.hooks).toEqual({ a: "U", z: {} });   // local's `z` really is served...
    expect(rb.origins).toEqual({ "hooks.a": "user" });    // ...and attributed to NOBODY, anywhere
    expect(readVerdictForDelete(rb, "project", ["hooks"])).toBe("unknown"); // so the read reply cannot judge it
    expect(b.status).toBe("okOverridden");
    expect(b.overriddenMetadata.overridingLayer).toBe("local");
    expect(b.overriddenMetadata.effectiveValue).toEqual({ a: "U", z: {} });
    // C — the same three files minus the user layer. The one difference is BELOW the target, so the
    // verdict may not move; before the counterfactual, only this one was reported.
    rmSync(join(home, ".claude", "settings.json"), { force: true });
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: { b: "P" } }));
    id = await send("config/batchWrite", { target: "project", cwd: proj, edits });
    const c = reply(id).result;
    expect(c.status).toBe(b.status);
    expect(c.overriddenMetadata.overridingLayer).toBe(b.overriddenMetadata.overridingLayer);
    expect(c.overriddenMetadata.effectiveValue).toEqual({ z: {} });
  });
  it("an EMPTY object above a deleted path that a lower layer fills is NOT a mask", async () => {
    // The other direction, and the reason the one-line widening of the old verdict — consult the layer
    // files whenever no contributor outranks the target — is not the fix: `local` DEFINES `hooks`, so that
    // question answers "masked", while `{}` merges into the object below and changes nothing that is
    // served. The delete really is in force and the client has no file to go and edit. Only a
    // counterfactual separates the two, because only it asks what the layer CONTRIBUTES rather than what
    // it holds.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { a: "U" } }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: { b: "P" } }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: {} }));
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["hooks"], value: null, mergeStrategy: "replace", target: "project", cwd: proj });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.hooks).toEqual({ a: "U" });      // exactly what the layer BELOW holds, nothing more
    expect(w.status).toBe("ok");
    expect(w.maskedEditIndexes).toBeUndefined();
    expect(w.overriddenMetadata).toBeUndefined();
    // ...and the same file, one key different, IS a mask — so this is not "local can never mask a project
    // delete", which is the reading a fix that simply skipped the layer scan would ship.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: { b: "P" } }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: { z: "L" } }));
    id = await send("config/value/write", { keyPath: ["hooks"], value: null, mergeStrategy: "replace", target: "project", cwd: proj });
    expect(reply(id).result.status).toBe("okOverridden");
    expect(reply(id).result.overriddenMetadata.overridingLayer).toBe("local");
  });
  it("a delete masked TWO ranks above, past a nearer layer that holds the path and contributes nothing", async () => {
    // Naming walks the whole chain above the target and names the LAST layer to move the value, not the
    // first one that holds the path: `local` holds `hooks` and contributes nothing, `managed` is what the
    // client would have to go and edit. The layer below plants leaves at three different depths under the
    // deleted path — every one of them an entry the old neighbourhood scan would have answered with.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { a: "U", deep: { x: "U", deeper: { y: "U" } } } }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: { b: "P" } }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ hooks: {} }));
    writeFileSync(join(home, "managed.json"), JSON.stringify({ hooks: { m: "M" } }));
    boot(deps());
    const edits = [{ keyPath: ["hooks"], value: null, mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "project", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.origins).toEqual({ "hooks.a": "user", "hooks.deep.x": "user", "hooks.deep.deeper.y": "user", "hooks.m": "managed" });
    expect(w.status).toBe("okOverridden");
    expect(w.overriddenMetadata.overridingLayer).toBe("managed");
    expect(w.overriddenMetadata.effectiveValue).toEqual(r.config.hooks);
    expectAgreesWithRead(w, r, "project", edits);
  });
  it("a layer above holding what a lower layer ALREADY serves is not a mask — and config/read still names it", async () => {
    // The one tree where the counterfactual and last-writer-wins attribution use different words, settled
    // deliberately (spec D-M5-13d). `local` holds exactly what `user` already serves, so taking `local`
    // away moves nothing at the path: no layer above the target is making a difference, which is the same
    // situation as a delete falling through to a lower layer and has never been anything but `ok`. The
    // search this verdict replaced said masked, because it read `origins` — and `origins` names `local`,
    // since a scalar replacement is attributed to whoever wrote last even when the bytes are identical.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "V" }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ model: "P" }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: "V" }));
    boot(deps());
    let id = await send("config/value/write", { keyPath: ["model"], value: null, mergeStrategy: "replace", target: "project", cwd: proj });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(w.status).toBe("ok");
    expect(w.maskedEditIndexes).toBeUndefined();
    expect(w.overriddenMetadata).toBeUndefined();
    // What `config/read` says about the SAME key, asserted rather than left implicit, because the two
    // replies really do describe this tree differently and a reader who expects one word will "fix" the
    // verdict back. Both are true: `local` last wrote the surviving value, AND nothing above the target
    // changes what is served. The contract is agreement about FORCE, not about naming — so the
    // attribution-derived reading below is a name, and is not usable as a verdict here.
    expect(r.config.model).toBe("V");
    expect(r.origins.model).toBe("local");
    expect(readVerdictForDelete(r, "project", ["model"])).toBe("masked");
    // ...and one byte apart, `local` DOES move the value and the same delete is masked. The two trees
    // differ in nothing but whether the higher layer's value is already the lower layer's.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ model: "P" }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: "W" }));
    id = await send("config/value/write", { keyPath: ["model"], value: null, mergeStrategy: "replace", target: "project", cwd: proj });
    expect(reply(id).result.status).toBe("okOverridden");
    expect(reply(id).result.overriddenMetadata.overridingLayer).toBe("local");
  });
  it("the MIRROR — a layer above holding exactly what a value write puts there — is masked, and stays masked", async () => {
    // Reachable, and deliberately NOT the delete's answer. A value write introduces a leaf, so the read
    // side has a first-class verdict about it and `origins` names `local`: the target's write is not what
    // is in force, and a later change to the user file would not be either. Reporting `ok` here would be
    // the two methods disagreeing about FORCE, which is the contract — unlike the delete above, where
    // `origins` only ever offered a name because a delete introduces no leaf to attribute.
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ outputStyle: "V" }));
    boot(deps());
    const edits = [{ keyPath: ["outputStyle"], value: "V", mergeStrategy: "replace" }];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(w.status).toBe("okOverridden");
    expect(w.maskedEditIndexes).toEqual([0]);
    expect(w.overriddenMetadata.overridingLayer).toBe("local");
    expect(w.overriddenMetadata.effectiveValue).toBe("V");   // the value the client wanted — served by someone else
    expect(r.config.outputStyle).toBe("V");
    expect(r.origins.outputStyle).toBe("local");
    expectAgreesWithRead(w, r, "user", edits);
  });
  it("the described masked edit is the first with a REAL overriding layer, not a self-shadowed earlier one", async () => {
    // `overriddenMetadata` describes ONE masked edit, and a self-shadowed edit names the TARGET — the
    // truth, and the one name a client can do nothing with. First-wins let such an edit evict the batch's
    // only actionable signpost: the client still learned WHICH edits were masked, but not that a real
    // layer was standing on one of them, nor which. Edit 0 here is undone by edit 1 inside the request;
    // edit 2 is masked by a layer that exists.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ outputStyle: "PROJ" }));
    boot(deps());
    const edits = [
      { keyPath: ["model"], value: "first", mergeStrategy: "replace" },
      { keyPath: ["model"], value: null, mergeStrategy: "replace" },
      { keyPath: ["outputStyle"], value: "mine", mergeStrategy: "replace" },
    ];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(w.maskedEditIndexes).toEqual([0, 2]);                     // both still reported
    expect(w.overriddenMetadata.overridingLayer).toBe("project");    // ...and the signpost is the real one
    expect(w.overriddenMetadata.effectiveValue).toBe("PROJ");
    expect(w.overriddenMetadata.message).toMatch(/project layer defines this key/);
    expectAgreesWithRead(w, r, "user", edits, 2);
    // The self-name is still the fallback, not a case that was deleted: a batch with nothing better to
    // report keeps naming the target, which is what the published schema's `overridingLayer` requires.
    const allSelf = [
      { keyPath: ["language"], value: "first", mergeStrategy: "replace" },
      { keyPath: ["language"], value: null, mergeStrategy: "replace" },
    ];
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits: allSelf });
    const w2 = reply(id).result;
    expect(w2.maskedEditIndexes).toEqual([0]);
    expect(w2.overriddenMetadata.overridingLayer).toBe("user");
  });
  it("an edit undone by a LATER edit in the SAME request is reported, and names a layer the schema accepts", async () => {
    // A consequence of the rule rather than a feature added beside it: edit 0's leaf is not attributed to
    // the target either, so the same lookup reports it. Nothing above the target claims the key, so the
    // naming step has only the target to name — which is the truth (the target's own file no longer holds
    // what edit 0 wrote) and keeps the reply inside its published schema, where `overridingLayer` is
    // required. The client used to be told `ok` for an edit whose value reached no file at all.
    boot(deps());
    const edits = [
      { keyPath: ["model"], value: "first", mergeStrategy: "replace" },
      { keyPath: ["model"], value: null, mergeStrategy: "replace" },
    ];
    let id = await send("config/batchWrite", { target: "user", cwd: proj, edits });
    const w = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config.model).toBeUndefined();
    expect(w.status).toBe("okOverridden");
    expect(w.maskedEditIndexes).toEqual([0]);          // ...and the delete at index 1 IS in force
    expect(w.overriddenMetadata.overridingLayer).toBe("user");
    expect(w.overriddenMetadata.message).toMatch(/no layer above user holds this key/);
    const results = (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results;
    const validate = new Ajv({ strict: true }).compile(results["config/batchWrite"]);
    expect(validate(w), JSON.stringify(validate.errors)).toBe(true);
    expectAgreesWithRead(w, r, "user", edits);
    // The value-over-value half is NOT reported, and cannot be by this rule: `origins` addresses LEAVES, not
    // values, so `model` is attributed to `user` and both edits are in force by the lookup. A client can see
    // which value won by reading it back; it could not see that edit 0 had been discarded entirely.
    const shadowed = [
      { keyPath: ["outputStyle"], value: "first", mergeStrategy: "replace" },
      { keyPath: ["outputStyle"], value: "second", mergeStrategy: "replace" },
    ];
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits: shadowed });
    const w2 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r2 = reply(id).result;
    expect(w2.status).toBe("ok");
    expect(r2.config.outputStyle).toBe("second");
    expect(r2.origins["outputStyle"]).toBe("user");
    expectAgreesWithRead(w2, r2, "user", shadowed);
  });
  it("a masking pass that cannot run leaves the write COMMITTED and reported ok, with every edit unchecked", async () => {
    // Whole-branch review M5 / verifier `scalpel-1#7` (D-M5-23c). The masking pass runs after the bytes are
    // on disk and used to be inside the handler's one try/catch, so a failure past the commit came back as
    // `-32603` — and a client that reads "failed" retries, while an `upsert` of an array is not idempotent
    // (arrays concatenate and dedupe by SameValueZero, so object entries never collapse). One hook
    // registration became two.
    //
    // The reachable trigger is a pathologically deep object in ANOTHER layer: `JSON.parse` accepts depths
    // `effectiveView`'s recursion cannot walk, and the write path's own depth screen covers only the value
    // it was handed. The depth here is more than an order of magnitude past the measured recursion limit
    // (~2.8k), and the `config/read` assertion below is what PROVES the premise held in this environment
    // rather than letting a deeper stack turn this row green for the wrong reason.
    const deep = '{"a":'.repeat(50_000) + "1" + "}".repeat(50_000);
    writeFileSync(join(proj, ".claude", "settings.json"), deep);
    boot(deps());
    const upsert = { keyPath: ["hooks", "PreToolUse"], value: [{ matcher: "Bash" }], mergeStrategy: "upsert" };
    let id = await send("config/read", { cwd: proj });
    expect(reply(id).error?.code, "premise: this layer really is past the merge's recursion limit").toBe(-32603);
    id = await send("config/value/write", { ...upsert, target: "user", cwd: proj });
    const w = reply(id).result;
    expect(reply(id).error, "the bytes landed, so this is not a failure").toBeUndefined();
    expect(w.status).toBe("ok");
    expect(w.uncheckedEditIndexes).toEqual([0]);       // "not reported as overridden", NOT "verified in force"
    expect(w.warnings[0]).toMatch(/the write landed, but whether it is overridden could not be checked/);
    expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).hooks.PreToolUse).toEqual([{ matcher: "Bash" }]);
    // The version in that degraded reply is a real CAS token, so the client's retry defence still works:
    // the same `expectedVersion` cannot be spent twice, which is what stops the duplicate.
    expect(w.version).toBe(sha256(readFileSync(join(home, ".claude", "settings.json"), "utf8")));
    id = await send("config/value/write", { ...upsert, target: "user", cwd: proj, expectedVersion: w.version });
    expect(reply(id).result.status).toBe("ok");
    id = await send("config/value/write", { ...upsert, target: "user", cwd: proj, expectedVersion: w.version });
    expect(reply(id).error.data.code).toBe("ConfigVersionConflict");
    // THE OTHER SIDE: with the deep layer gone the pass runs again and the real verdict comes back. A fence
    // that swallowed every verdict would pass every assertion above.
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: "PROJECT-WINS" } }));
    id = await send("config/value/write", { keyPath: ["hooks", "PreToolUse"], value: "USER", mergeStrategy: "replace", target: "user", cwd: proj });
    const w2 = reply(id).result;
    expect(w2.status).toBe("okOverridden");
    expect(w2.uncheckedEditIndexes).toBeUndefined();
    expect(w2.overriddenMetadata.overridingLayer).toBe("project");
  });
  it("SWEEP: generated layer states, driven through both methods, agree on every edit", async () => {
    // Examples find the state you thought of. Every divergence this method has shipped was found by a SWEEP
    // and missed by the examples written beside the fix — including the two this wave closes — so the rule
    // gets a generator, not another row. Each case plants one or two other layers, writes through
    // `config/batchWrite`, reads through `config/read`, and holds the write's verdict against the read's own
    // attribution. Bounded to stay in the unit suite: the layer chain is walked in PAIRS (plus a three-layer
    // pass for the flatten-then-rebuild shape) rather than over all sixteen subsets, and written values are
    // one representative of each shape the read side distinguishes — scalar, array, object, delete — rather
    // than a value space. Depth runs to three segments, which is where the ancestor/descendant asymmetries
    // live; the fourth segment adds no new relationship.
    boot(deps());
    const results = (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results;
    const validate = new Ajv({ strict: true }).compile(results["config/batchWrite"]);
    const layerFile: Record<string, string> = {
      user: join(home, ".claude", "settings.json"), project: join(proj, ".claude", "settings.json"),
      local: join(proj, ".claude", "settings.local.json"), managed: join(home, "managed.json"),
    };
    const plant = (path: string[], v: unknown): unknown => path.reduceRight((acc: unknown, seg) => ({ [seg]: acc }), v);
    let planted: Record<string, unknown> = {};
    const setLayers = (contents: Record<string, unknown>) => {
      planted = contents;
      for (const [name, file] of Object.entries(layerFile)) {
        if (contents[name] === undefined) rmSync(file, { force: true });
        else writeFileSync(file, JSON.stringify(contents[name]));
      }
    };
    let cases = 0, undecided = 0;
    const run = async (label: string, target: string, edits: any[]) => {
      cases++;
      lines.length = 0; // the reply lookup is a linear scan — keep it O(1) per case, not O(cases)
      let id = await send("config/batchWrite", { target, cwd: proj, edits });
      expect(reply(id).error, `${label}: the write itself must succeed`).toBeUndefined();
      const w = reply(id).result;
      expect(w.uncheckedEditIndexes, `${label}: no generated key carries a "." — every case must get a real verdict`).toBeUndefined();
      expect(validate(w), `${label}: ${JSON.stringify(validate.errors)}`).toBe(true);
      // Every case here is ONE edit, so the target can never be the layer standing on its own write: an
      // `overridingLayer` of the target means the naming step ran out of answers and fell back to it, which
      // is the shape a lost fallback takes. The verdict cannot catch that — naming never feeds it.
      if (w.overriddenMetadata) expect(w.overriddenMetadata.overridingLayer, `${label}: a single-edit request can only be masked from ABOVE`).not.toBe(target);
      id = await send("config/read", { cwd: proj });
      const r = reply(id).result;
      const readBlind = edits.flatMap((e, i) => (e.value === null && readOracleBlindToDuplicateAbove(planted, target, e.keyPath) ? [i] : []));
      try {
        undecided += expectAgreesWithRead(w, r, target, edits, undefined, readBlind);
        // Deletes are judged a SECOND time, by an oracle that reads no attribution at all: the read reply
        // reports "unknown" exactly where `mergeTracked` attributes nothing, and the class pass 3 exists
        // for lives inside that gap — every case of it would otherwise be counted, skipped, and shipped.
        for (const [i, e] of edits.entries()) {
          if (e.value !== null) continue;
          const expected = deleteVerdictFromLayers(planted, target, e.keyPath);
          expect(w.maskedEditIndexes?.includes(i) ?? false, `edit ${i}: the counterfactual over the planted layers says "${expected}"`).toBe(expected === "masked");
        }
      }
      catch (err) { throw new Error(`${label}\n  write: ${JSON.stringify(w)}\n  read:  ${JSON.stringify({ config: r.config, origins: r.origins })}\n  ${(err as Error).message}`); }
    };
    const writes: Array<{ label: string; value: unknown; mergeStrategy: string }> = [
      { label: "scalar", value: "W", mergeStrategy: "replace" },
      { label: "array", value: ["W"], mergeStrategy: "replace" },
      { label: "object", value: { x: "W" }, mergeStrategy: "replace" },
      { label: "object/upsert", value: { x: "W" }, mergeStrategy: "upsert" },
      { label: "delete", value: null, mergeStrategy: "replace" },
    ];
    // PASS 1 — one other layer, planted at every prefix of the written path, in every shape the merge
    // treats differently. `{}` and `{x:{}}` are the shapes that attribute NOTHING (class 1); `{z:"O"}` is a
    // sibling-only object; the scalar and array are the shapes that DO get an entry of their own.
    const shapes: Array<[string, unknown]> = [["scalar", "O"], ["empty", {}], ["nested-empty", { x: {} }], ["leaf", { x: "O" }], ["sibling", { z: "O" }]];
    for (const [target, other] of [["user", "project"], ["user", "managed"], ["project", "local"]] as const)
      for (const keyPath of [["hooks"], ["hooks", "a"], ["hooks", "a", "b"]])
        for (let depth = 1; depth <= keyPath.length; depth++)
          for (const [shapeLabel, shape] of shapes)
            for (const e of writes) {
              setLayers({ [target]: plant(keyPath, "SEED"), [other]: plant(keyPath.slice(0, depth), shape) });
              await run(`[1] ${target} writes ${e.label} at ${keyPath.join(".")} · ${other} holds ${shapeLabel} at depth ${depth}`, target, [{ keyPath, value: e.value, mergeStrategy: e.mergeStrategy }]);
            }
    // PASS 2 — three layers: a middle layer FLATTENS the ancestor and a higher one rebuilds it. This is the
    // shape where the leaf's whole neighbourhood in `origins` belongs to layers that are not on its path.
    for (const top of ["local", "managed"])
      for (const keyPath of [["hooks", "a"], ["hooks", "a", "b"]])
        for (const [midLabel, mid] of [["scalar", "FLAT"], ["null", null], ["array", ["F"]]] as Array<[string, unknown]>)
          for (const [topLabel, topVal] of [["sibling leaf", { c: "T" }], ["sibling empty", { a: {} }], ["empty", {}]] as Array<[string, unknown]>)
            for (const e of writes.filter((x) => x.label !== "object/upsert" && x.label !== "array")) {
              setLayers({ user: plant(keyPath, "SEED"), project: { hooks: mid }, [top]: { hooks: topVal } });
              await run(`[2] user writes ${e.label} at ${keyPath.join(".")} · project flattens with ${midLabel} · ${top} rebuilds ${topLabel}`, "user", [{ keyPath, value: e.value, mergeStrategy: e.mergeStrategy }]);
            }
    // PASS 3 — the target in the MIDDLE of the chain: leaves BELOW the written path, an object ABOVE it.
    // Passes 1 and 2 are structurally blind to this whole shape — pass 1 plants exactly one other layer,
    // and pass 2 always targets the BOTTOM layer — so nothing below the target ever contributed under the
    // written path, and a delete verdict that let one lower leaf answer for the layers above it passed
    // both. The above-layer shapes run from "holds the path and contributes nothing" (`{}`, and `{p:{}}`
    // over a leaf the lower layer put at `p`) to "contributes a region no `origins` entry can carry"
    // (`{z:{}}`) to plainly attributable ones, because the verdict has to separate holding from
    // contributing. `managed` doubles as the two-ranks-above case.
    //
    // `{p:"U"}` is the DUPLICATE-ABOVE shape (D-M5-13d): a leaf identical to one the layer below already
    // serves. It is a constant rather than a copy of `belowVal` on purpose — against `{p:"U"}` and
    // `{p:"U",q:{r:"U"}}` it duplicates and the delete is in force, against `{p:{q:"U"}}` its scalar
    // flattens the object and the delete really is masked, so one shape generates both sides of the line.
    for (const above of ["local", "managed"] as const)
      for (const keyPath of [["hooks"], ["hooks", "a"]])
        for (const [belowLabel, belowVal] of [["leaf", { p: "U" }], ["nested leaf", { p: { q: "U" } }], ["leaves at two depths", { p: "U", q: { r: "U" } }]] as Array<[string, unknown]>)
          for (const [aboveLabel, aboveVal] of [["empty", {}], ["empty at the lower leaf's key", { p: {} }], ["new key, empty", { z: {} }], ["new leaf", { z: "A" }], ["scalar", "A"], ["the lower leaf, identically", { p: "U" }]] as Array<[string, unknown]>)
            for (const e of writes) {
              setLayers({ user: plant(keyPath, belowVal), project: plant(keyPath, { own: "P" }), [above]: plant(keyPath, aboveVal) });
              await run(`[3] project writes ${e.label} at ${keyPath.join(".")} · user holds ${belowLabel} · ${above} holds ${aboveLabel}`, "project", [{ keyPath, value: e.value, mergeStrategy: e.mergeStrategy }]);
            }
    // Two facts, two assertions — they used to share one `toEqual` on a single object, which made a
    // deliberate change to the generator and a moved blind spot fail in exactly the same way.
    //
    // `cases` catches a generator that quietly stops generating: 558 from passes 1 and 2, 360 from pass 3.
    expect(cases, "the generator's own size").toBe(918);
    // `undecided` is the size of the READ side's blind spot measured from the outside, and it now has two
    // causes. FIRST, deletes whose path still resolves through a region `mergeTracked` attributes to
    // nobody — the residual this wave deliberately did not close in `configLayers.ts`: 18 from pass 1, 4
    // from pass 2, and 20 from pass 3 (the `{z:{}}` shape at every depth and above-layer, 12, plus `{p:{}}`
    // wherever it lands on a lower SCALAR and replaces it with a leafless object, 8). SECOND, the
    // duplicate-above state (D-M5-13d), where the read reply says "masked" and is naming rather than
    // judging: 8 from pass 3 — the two below-shapes `{p:"U"}` leaves unmoved, at both above-layers and both
    // depths. None of the 50 go unjudged: the counterfactual oracle in `run` decides every delete in the
    // sweep. If this moves, either the generator reaches new states or `mergeTracked` learned to attribute
    // object nodes — and then the read-derived oracle is stronger than it was, which deserves a second look.
    //
    // Pass 2 fell from 6 to 4 when the object-over-array merge was corrected: its two `flattens with array ·
    // rebuilds sibling empty` cases used to end at a leafless object (the rebuild replaced the array), and
    // now end at the array itself, which `origins` DOES attribute. The blind spot shrank because the merge
    // became upstream-exact, not because anything learned to attribute an object node.
    expect(undecided, "deletes the read reply alone cannot judge").toBe(50);
  }, 120_000);

  /** FIX WAVE G / P2-1#2 — the write side and the read side addressing one contribution at two different
   *  granularities. `introducedLeaves` walks the written VALUE, so an upsert of `{"0": …}` at
   *  `permissions.allow` reported the leaf `permissions.allow.0`; `effectiveView` never keys `origins`
   *  below an array, because an object merged over an array is an ARRAY contributor claimed at the array's
   *  own path. The lookup missed, the edit was marked `okOverridden`, and — with nothing above the target
   *  to name — it named the TARGET, telling the client its write was dead while `config/read` served
   *  exactly what it had written, from exactly that layer. Both replies are checked here, in one instant. */
  it("an upsert that patches an array BY INDEX is in force — the two methods agree at the array's own path", async () => {
    boot(deps());
    // The array is the USER layer's; the write goes to PROJECT, whose own file has no such key — so the
    // project layer's value really is an object merged over the user layer's array, which is the shape
    // `claimArray` exists for and the shape whose leaves the two methods spelled differently.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["FromUser", "AlsoUser"] } }));
    let id = await send("config/value/write", { keyPath: ["permissions", "allow"], value: { "0": "Patched" }, mergeStrategy: "upsert", target: "project", cwd: proj });
    const w = reply(id).result;
    // Measured before the fix: `okOverridden`, with `overriddenMetadata.overridingLayer: "project"` — the
    // reply naming the very layer it had just written, for an element `config/read` was already serving.
    expect([w.status, w.maskedEditIndexes, w.overriddenMetadata]).toEqual(["ok", undefined, undefined]);
    // …and the read side, at the same instant, must both SERVE the patched element and carry the written
    // layer in the array's contributor list. Either half alone would leave the disagreement possible.
    id = await send("config/read", { cwd: proj });
    let rd = reply(id).result;
    expect(rd.config.permissions.allow).toEqual(["Patched", "AlsoUser"]);
    expect(rd.origins["permissions.allow"]).toEqual(["user", "project"]);
    // THE OTHER SIDE, and it must stay MASKED: a NON-index key rides the array as a property JSON never
    // serializes, so nothing a client can see came of it. It truncates to the same array path, and
    // `claimArray` correspondingly refuses to name its layer — one mapping, two opposite answers.
    rmSync(join(proj, ".claude", "settings.json"));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["FromLocal"] } }));
    id = await send("config/value/write", { keyPath: ["permissions", "allow"], value: { PreToolUse: "x" }, mergeStrategy: "upsert", target: "project", cwd: proj });
    const w2 = reply(id).result;
    expect(w2.status).toBe("okOverridden");
    expect(w2.overriddenMetadata.overridingLayer).toBe("local");
    id = await send("config/read", { cwd: proj });
    rd = reply(id).result;
    expect([rd.config.permissions.allow, rd.origins["permissions.allow"]]).toEqual([["FromUser", "AlsoUser", "FromLocal"], ["user", "local"]]);
  });

  /** FIX WAVE G / G5, at the wire. The unit bound lives in `config-layers.test.ts`; this is the
   *  consequence it exists for — `config/read` serializing the merged view, and `config/value/write`
   *  merging a client's own value, both of which reach `JSON.stringify` before `Peer` can weigh a single
   *  buffered byte. Measured before the bound: 500 MB and 5.2 s of blocked event loop for one key. */
  it("an array index that would expand an array to billions of slots refuses on BOTH methods", async () => {
    boot(deps());
    // The READ side: a settings FILE on disk holds the shape, over a lower layer's array.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash"] } }));
    writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: { "4294967294": "x" } } }));
    let id = await send("config/read", { cwd: proj });
    expect(reply(id).result).toBeUndefined();
    expect([reply(id).error.code, reply(id).error.data.code]).toEqual([-32602, "ConfigValidationError"]);
    expect(reply(id).error.message).toMatch(/may not extend it past 65536 entries \(index "4294967294"\)/);
    // The WRITE side: the client's own upsert value, refused inside the lock with nothing written.
    rmSync(join(proj, ".claude", "settings.json"));
    const before = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    id = await send("config/value/write", { keyPath: ["permissions", "allow"], value: { "100000000": "x" }, mergeStrategy: "upsert", target: "user", cwd: proj });
    expect(reply(id).result).toBeUndefined();
    expect(reply(id).error.data.code).toBe("ConfigValidationError");
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(before);
    // …and the control: the same shape one index below the bound still merges and still writes, so the
    // refusal is a BOUND and not a new refusal of index keys.
    id = await send("config/value/write", { keyPath: ["permissions", "allow"], value: { "0": "Bash(pwd)" }, mergeStrategy: "upsert", target: "user", cwd: proj });
    expect(reply(id).result.status).toBe("ok");
  });
});
