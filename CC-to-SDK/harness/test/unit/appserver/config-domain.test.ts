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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, chmodSync, existsSync, symlinkSync, realpathSync } from "node:fs";
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
/** The F1 contract in one assertion, and the reason it is written as a COMPARISON rather than as expected
 *  strings: the masking verdict is only meaningful as agreement with `config/read`. An edit is `ok` exactly
 *  when the read side attributes at least one of its leaves to the layer that was written, and masked
 *  exactly when it attributes none — and a masked edit's `effectiveValue` is the read side's own merged
 *  value at that keyPath, never one layer's private copy of it. Three waves of hard-coded expectations
 *  shipped the opposite verdict green, because nothing ever asked the other method what it thought. */
const expectAgreesWithRead = (w: any, r: any, target: string, edits: Array<{ keyPath: string[]; value: unknown }>) => {
  edits.forEach((e, i) => {
    const attributed = leafKeys(e.keyPath, e.value).some((k) => {
      const o = r.origins[k];
      return o === target || (Array.isArray(o) && o.includes(target));
    });
    expect(w.maskedEditIndexes?.includes(i) ?? false, `edit ${i} "${e.keyPath.join(".")}": config/read attributes a leaf to "${target}"? ${attributed}`).toBe(!attributed);
  });
  expect(w.status).toBe(w.maskedEditIndexes ? "okOverridden" : "ok");
  if (w.overriddenMetadata) {
    const kp = edits[w.maskedEditIndexes[0]].keyPath;
    expect(w.overriddenMetadata.effectiveValue).toEqual(kp.reduce((n: any, s) => (n === undefined || n === null ? undefined : n[s]), r.config));
  }
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
    // is spent on it. The lock is planted as a DIRECTORY: `wx` still fails EEXIST, but the stale-and-stable
    // pair of reads both come back null, so the break can never succeed and the deadline is the only exit.
    // Only `Date` is faked — the 35s budget is otherwise real elapsed time, which a unit suite cannot
    // spend, and that budget IS the point: the stall is the reachable symptom, the refusal is the rare one.
    boot(deps());
    mkdirSync(join(home, ".claude", "settings.json.lock"));
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
    // Same hole in array shape: `effectiveView` tracks an array as a contributor list, so an array write
    // is one leaf too and has no entry of its own once an object above replaces it.
    const arrEdits = [{ keyPath: ["env"], value: ["a", "b"], mergeStrategy: "replace" }];
    id = await send("config/batchWrite", { target: "user", cwd: proj, edits: arrEdits });
    const w2 = reply(id).result;
    id = await send("config/read", { cwd: proj });
    const r2 = reply(id).result;
    expect(r2.config.env).toEqual({ B: "2" });     // the array never reaches the effective view either
    expect(w2.status).toBe("okOverridden");
    expectAgreesWithRead(w2, r2, "user", arrEdits);
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
});
