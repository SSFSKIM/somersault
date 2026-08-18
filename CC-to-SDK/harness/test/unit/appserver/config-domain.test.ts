// test/unit/appserver/config-domain.test.ts — M5 Task 2: `config/read`, the settings-files domain's read half.
//
// Driven through the REAL wire (`srv.connect(sink)` + `conn.feed(...)`, review-start.test.ts's harness):
// `dispatch` is private and four-arg, so a request is the only way in — and going through it is what makes
// the params gate, the error codes and the reply shape observable at all.
//
// The whole domain is pointed at temp directories by the `configHome`/`managedSettingsPath` deps, so every
// case here reads files it wrote itself and never this machine's real ~/.claude.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { DEFAULT_MANAGED_PATH, defaultManagedPath } from "../../../src/appserver/configDomain.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { Ajv } from "ajv";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync, existsSync, symlinkSync, realpathSync } from "node:fs";
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
});
