// test/unit/appserver/config-write.test.ts — M5 Task 3: the write primitives the Task 4 handlers run
// inside. Everything here touches only its own `mkdtemp` directory.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, lstatSync, unlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** The one interleave the filesystem will not schedule for us: a foreign lock whose bytes CHANGE
 *  between the implementation's two consecutive reads. A real second writer cannot be timed into that
 *  gap — both reads are already queued on the libuv threadpool by the time this thread runs again — so
 *  it is forced at the fs boundary. Null by default: every other read in this file is the real one. */
const fsHook = vi.hoisted(() => ({ readFile: null as ((path: string) => string | null) | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    readFile: async (path: unknown, ...rest: unknown[]) => {
      const forced = fsHook.readFile?.(String(path));
      if (typeof forced === "string") return forced;
      return (real.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    },
  };
});

const { applyEdit, versionToken, withFileLock, readTargetDoc, writeTargetDoc, resolveRealTarget, ConfigError } = await import("../../../src/appserver/configWrite.js");

/** `os.tmpdir()` is itself behind a symlink on macOS (`/var` → `/private/var`), so a temp path and its
 *  realpath differ before this file creates any link of its own. Resolving the root here keeps the
 *  symlink row below measuring the link it made, not the platform's. */
const mkTemp = (prefix: string): string => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const sleep = (ms: number, value: string) => new Promise<string>((r) => setTimeout(() => r(value), ms));

describe("applyEdit (D-M5-13 merge table)", () => {
  it("replace sets the leaf exactly; siblings survive", () => {
    expect(applyEdit({ a: { x: 1 } }, ["a", "y"], 2, "replace")).toEqual({ a: { x: 1, y: 2 } });
    expect(applyEdit({ a: { x: 1, y: [1] } }, ["a", "y"], "z", "replace")).toEqual({ a: { x: 1, y: "z" } });
  });
  it("upsert deep-merges with the read-side customizer (arrays concat+SVZ-dedupe)", () => {
    expect(applyEdit({ p: { allow: ["A"] } }, ["p"], { allow: ["A", "B"] }, "upsert")).toEqual({ p: { allow: ["A", "B"] } });
  });
  it("upsert grows a NEW array — `effectiveView` aliases a single contributor's array into the doc", () => {
    // The doc an upsert is applied to is the one `effectiveView`/`readTargetDoc` handed over, and for a
    // key only one layer contributed, its array IS that layer's array — the same object, not a copy.
    // An in-place concat here would edit the layer through the alias, so purity is not a style choice.
    const layerArray = ["A"];
    const doc = { permissions: { allow: layerArray } };
    expect(applyEdit(doc, ["permissions"], { allow: ["B"] }, "upsert")).toEqual({ permissions: { allow: ["A", "B"] } });
    expect(layerArray).toEqual(["A"]);
    expect(doc).toEqual({ permissions: { allow: ["A"] } });
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
    const dir = mkTemp("m5w-");
    expect(await readTargetDoc(join(dir, "no.json"))).toEqual({ doc: {}, version: "absent" });
    writeFileSync(join(dir, "bad.json"), "{nope");
    await expect(readTargetDoc(join(dir, "bad.json"))).rejects.toThrow(ConfigError);
  });
  it("readTargetDoc refuses a target that EXISTS but could not be read (Task 2 review I1, write half)", async () => {
    // "absent" is reserved for NO SUCH FILE. A target we could not read is not absent, and returning
    // `{doc:{},version:"absent"}` for it would let a caller's `expectedVersion:"absent"` create-if-new
    // write flatten a settings file whose bytes nobody ever saw. A DIRECTORY at the settings path is
    // the reproduction that needs no permission bit — root and mode-ignoring filesystems get EISDIR too.
    const dir = mkTemp("m5w-");
    const p = join(dir, "settings.json");
    mkdirSync(p);
    await expect(readTargetDoc(p)).rejects.toThrow(ConfigError);
    await expect(readTargetDoc(p)).rejects.toMatchObject({ code: "ConfigValidationError" });
  });
  it("writeTargetDoc round-trips with a matching token AND creates the missing .claude parent", async () => {
    const dir = mkTemp("m5w-");
    const p = join(dir, ".claude", "settings.json"); // parent does NOT exist (fresh project)
    const { version } = await writeTargetDoc(p, { model: "opus" });
    const back = await readTargetDoc(p);
    expect(back.doc).toEqual({ model: "opus" });
    expect(back.version).toBe(version);
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
  });
  it("a symlinked target resolves: the write lands in the real file, the link survives", async () => {
    const dir = mkTemp("m5w-");
    writeFileSync(join(dir, "real.json"), "{}\n");
    symlinkSync(join(dir, "real.json"), join(dir, "link.json"));
    expect(await resolveRealTarget(join(dir, "link.json"))).toBe(join(dir, "real.json"));
    expect(lstatSync(join(dir, "link.json")).isSymbolicLink()).toBe(true);
  });
});

describe("withFileLock (D-M5-14 rev 3)", () => {
  it("serializes concurrent critical sections on one path and releases", async () => {
    const dir = mkTemp("m5l-");
    const p = join(dir, "s.json");
    const order: string[] = [];
    // Both calls are issued before either can finish, and the first holds for 40ms — so the second
    // really is in flight while the first is inside its critical section, not merely after it.
    await Promise.all([
      withFileLock(p, async () => { order.push("a-in"); await new Promise((r) => setTimeout(r, 40)); order.push("a-out"); }),
      withFileLock(p, async () => { order.push("b-in"); order.push("b-out"); }),
    ]);
    expect(order).toEqual(["a-in", "a-out", "b-in", "b-out"]);
    expect(existsSync(p + ".lock")).toBe(false);
  });
  it("the in-process chain stops a same-process writer from breaking OUR OWN live lock", async () => {
    // The <file>.lock is the cross-PROCESS half, and on its own it is not enough here: with a short
    // stale window every lock looks breakable on sight, so the second request in THIS process would
    // sweep away the first request's lock while the first is still inside its critical section. A
    // stale sweep is for a dead writer's leftovers, never a live holder's — and what makes that
    // unreachable is the chain, which keeps the second call away from the lock file entirely until
    // the first has released it. Drop the chain and the two critical sections interleave.
    const dir = mkTemp("m5l-");
    const p = join(dir, "s.json");
    const order: string[] = [];
    await Promise.all([
      withFileLock(p, async () => { order.push("a-in"); await new Promise((r) => setTimeout(r, 60)); order.push("a-out"); }, { staleMs: 0 }),
      withFileLock(p, async () => { order.push("b-in"); order.push("b-out"); }, { staleMs: 0 }),
    ]);
    expect(order).toEqual(["a-in", "a-out", "b-in", "b-out"]);
    expect(existsSync(p + ".lock")).toBe(false);
  });
  it("breaks a stale-and-stable foreign lock instead of hanging", async () => {
    const dir = mkTemp("m5l-");
    const p = join(dir, "s.json");
    writeFileSync(p + ".lock", "dead-owner");
    expect(await withFileLock(p, async () => "ran", { staleMs: 0 })).toBe("ran");
  });
  it("never unlinks a foreign LIVE lock — it waits for that owner to release", async () => {
    const dir = mkTemp("m5l-");
    const p = join(dir, "s.json");
    const lock = p + ".lock";
    writeFileSync(lock, "live-owner"); // mtime is NOW: nowhere near the 30s stale window
    const pending = withFileLock(p, async () => "ran");
    expect(await Promise.race([pending, sleep(150, "still-locked")])).toBe("still-locked");
    expect(readFileSync(lock, "utf8")).toBe("live-owner"); // the live owner's lock is untouched
    unlinkSync(lock); // the owner finishes and releases
    expect(await pending).toBe("ran");
    expect(existsSync(lock)).toBe(false);
  });
  it("breaks a stale lock only when it is also STABLE — moving bytes are left alone", async () => {
    const dir = mkTemp("m5l-");
    const p = join(dir, "s.json");
    const lock = p + ".lock";
    writeFileSync(lock, "foreign-A");
    let n = 0;
    fsHook.readFile = (path) => (path === lock ? `foreign-${++n}` : null); // every read a different owner
    const pending = withFileLock(p, async () => "ran", { staleMs: 0 });
    expect(await Promise.race([pending, sleep(150, "still-locked")])).toBe("still-locked");
    expect(readFileSync(lock, "utf8")).toBe("foreign-A"); // never unlinked while its bytes moved
    fsHook.readFile = null; // the other writer stops: two reads now agree, and only then is it stale-AND-stable
    expect(await pending).toBe("ran");
    expect(existsSync(lock)).toBe(false); // our own release, by nonce, cleaned up after us
  });
  it("release never unlinks a FOREIGN lock (nonce ownership)", async () => {
    const dir = mkTemp("m5l-");
    const p = join(dir, "s.json");
    await withFileLock(p, async () => { writeFileSync(p + ".lock", "foreign-nonce"); }); // steal mid-hold
    expect(readFileSync(p + ".lock", "utf8")).toBe("foreign-nonce"); // OUR release left it alone
  });
});
