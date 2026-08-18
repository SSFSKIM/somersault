// test/unit/appserver/config-write.test.ts — M5 Task 3: the write primitives the Task 4 handlers run
// inside. Everything here touches only its own `mkdtemp` directory.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, lstatSync, unlinkSync, realpathSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Interleaves and failures the filesystem will not schedule for us. (1) A foreign lock whose bytes
 *  CHANGE between the implementation's two consecutive reads: a real second writer cannot be timed into
 *  that gap — both reads are already queued on the libuv threadpool by the time this thread runs again.
 *  (2) A stale lock whose `unlink` FAILS: real on disk (an immutable file, a mode-0555 directory) but
 *  both reproductions are platform-specific and neither works as root. (3) The instant the tmp file
 *  exists and nothing has narrowed it yet — real, and a poller does catch it, but only on a machine
 *  whose scheduler leaves the window open long enough to be sampled. (4) A `readlink` that fails for
 *  anything but a vanished link: the only real cause is an unreadable directory, and that stops `lstat`
 *  one call earlier, so the case never reaches the code under test. All four are forced at the fs
 *  boundary. Null by default: every other call in this file is the real one. */
const fsHook = vi.hoisted(() => ({
  readFile: null as ((path: string) => string | null) | null,
  denyUnlink: null as ((path: string) => boolean) | null,
  afterWriteFile: null as ((path: string) => void) | null,
  readlink: null as ((path: string) => Error | null) | null,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    readFile: async (path: unknown, ...rest: unknown[]) => {
      const forced = fsHook.readFile?.(String(path));
      if (typeof forced === "string") return forced;
      return (real.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    },
    unlink: async (path: unknown, ...rest: unknown[]) => {
      if (fsHook.denyUnlink?.(String(path))) throw Object.assign(new Error("EPERM: operation not permitted, unlink"), { code: "EPERM" });
      return (real.unlink as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    },
    writeFile: async (path: unknown, ...rest: unknown[]) => {
      const out = await (real.writeFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
      fsHook.afterWriteFile?.(String(path)); // the gap between the file existing and the next call
      return out;
    },
    readlink: async (path: unknown, ...rest: unknown[]) => {
      const forced = fsHook.readlink?.(String(path));
      if (forced) throw forced;
      return (real.readlink as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
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
  it("refuses the same three keys INSIDE a value, at any depth, under both strategies (review M4)", () => {
    // Only `JSON.parse` mints an own `__proto__` KEY — a `{__proto__: …}` literal sets the prototype
    // instead, so the wire's shape has to be built through the parser to be the shape a client sends.
    for (const k of ["__proto__", "constructor", "prototype"]) {
      const top = JSON.parse(`{"${k}": {"x": 1}}`);
      expect(() => applyEdit({}, ["a"], top, "replace")).toThrow(ConfigError);
      expect(() => applyEdit({}, ["a"], top, "upsert")).toThrow(ConfigError);
      const nested = JSON.parse(`{"deep": [{"env": {"${k}": "v"}}]}`);
      expect(() => applyEdit({}, ["a"], nested, "replace")).toThrow(ConfigError);
      expect(() => applyEdit({ a: { deep: [] } }, ["a"], nested, "upsert")).toThrow(ConfigError);
    }
    // The consequence this closes: under `upsert` the key used to reach `settingsMerge`'s `out[k] = …`,
    // which invoked Object.prototype's `__proto__` SETTER — the key silently vanished from the written
    // JSON while `replace` kept it. Disagreeing halves of one rule, and the quiet half was the lossy one.
    expect(() => applyEdit({ a: { z: 1 } }, ["a"], JSON.parse('{"__proto__": {"p": 1}}'), "upsert")).toThrow(/is not writable/);
    expect(({} as any).p).toBeUndefined();
  });
  it("a value nested past the depth bound REFUSES instead of blowing the stack (F3)", () => {
    // The value walk recursed unbounded, and so do the two recursions behind it (`settingsMerge`,
    // `JSON.stringify`). A value deep enough to survive `JSON.parse` threw RangeError, which
    // configDomain maps to INTERNAL — so a client-supplied shape came back as an internal error instead
    // of a validation refusal. Depth is the client's to choose, so the refusal has to be ours.
    let deepArr: unknown = 1; for (let i = 0; i < 10_000; i++) deepArr = [deepArr];
    expect(() => applyEdit({}, ["a"], deepArr, "replace")).toThrow(ConfigError);
    expect(() => applyEdit({}, ["a"], deepArr, "replace")).toThrow(/nests deeper/);
    let deepObj: unknown = 1; for (let i = 0; i < 10_000; i++) deepObj = { n: deepObj };
    expect(() => applyEdit({ a: {} }, ["a"], deepObj, "upsert")).toThrow(ConfigError);
    // ...and the bound sits far above any shape a settings file actually has.
    let ordinary: unknown = 1; for (let i = 0; i < 60; i++) ordinary = { n: ordinary };
    expect(() => applyEdit({}, ["a"], ordinary, "replace")).not.toThrow();
  });
  it("segment lookup is OWN-property: an inherited name is an absent parent, not a refusal (review M2)", () => {
    // A raw `node[seg]` here would find `Object.prototype.toString` — a function, so "not an object" —
    // and refuse a keyPath the opaque-segment contract says is perfectly ordinary. Own-property access
    // is what keeps the prototype chain out of the traversal in BOTH directions.
    expect(applyEdit({}, ["toString", "x"], 1, "replace")).toEqual({ toString: { x: 1 } });
    expect(applyEdit({}, ["hasOwnProperty"], 1, "replace")).toEqual({ hasOwnProperty: 1 });
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
  it("a BLANK target is an EMPTY doc with a REAL token — not a permanent refusal (review I2)", async () => {
    // `readLayers` already calls a blank or BOM-only file an empty layer, because upstream's loader
    // does. The write side sending the same bytes to JSON.parse made `config/read` report the file
    // healthy while every write against it refused forever — `touch ~/.claude/settings.json`, or a
    // crash-truncated file, and the API had no way back out. The token is the hash of the real bytes:
    // "absent" is reserved for NO SUCH FILE, and this file exists.
    const dir = mkTemp("m5w-");
    const zero = join(dir, "zero.json"); writeFileSync(zero, "");
    expect(await readTargetDoc(zero)).toEqual({ doc: {}, version: versionToken("") });
    expect((await readTargetDoc(zero)).version).not.toBe("absent");
    const ws = join(dir, "ws.json"); const wsBytes = "﻿ \n\t\n"; writeFileSync(ws, wsBytes);
    expect(await readTargetDoc(ws)).toEqual({ doc: {}, version: versionToken(wsBytes) });
  });
  it("writeTargetDoc round-trips with a matching token AND creates the missing .claude parent", async () => {
    const dir = mkTemp("m5w-");
    const p = join(dir, ".claude", "settings.json"); // parent does NOT exist (fresh project)
    const { version } = await writeTargetDoc(p, { model: "opus" });
    const back = await readTargetDoc(p);
    expect(back.doc).toEqual({ model: "opus" });
    expect(back.version).toBe(version);
    // The exact bytes, not just the trailing newline: 2-space indent is the shape a human edits this
    // file in, and a settings file rewritten as one long line is a diff nobody can read (review M3).
    expect(readFileSync(p, "utf8")).toBe('{\n  "model": "opus"\n}\n');
  });
  it("writeTargetDoc preserves an existing target's MODE; a new file is created 0600 (review I1 + F1)", async () => {
    // tmp+rename installs the TMP file's mode, so a settings file deliberately kept at 0600 — they hold
    // `env` values and `apiKeyHelper` paths — came back 0644 after one write through this API.
    const dir = mkTemp("m5w-");
    const p = join(dir, "settings.json");
    writeFileSync(p, "{}\n"); chmodSync(p, 0o600); // chmod separately: writeFileSync's mode is umask-masked
    await writeTargetDoc(p, { model: "opus" });
    expect((statSync(p).mode & 0o777).toString(8)).toBe("600");
    // A target that does not exist has no mode to carry over, so what the rename installs is the tmp's
    // own restrictive mode (F1) — narrower than the umask default it used to inherit, deliberately: the
    // first bytes ever written to a settings file are the same class of secret as every later write.
    const fresh = join(dir, "fresh.json");
    await writeTargetDoc(fresh, { a: 1 });
    expect((statSync(fresh).mode & 0o777).toString(8)).toBe("600");
  });
  it("the TMP file is never observable at a wider mode than the destination (F1)", async () => {
    // The exposure is real and a directory poller does catch it — a 0600 settings file's tmp seen at 644
    // holding the same bytes — but whether the poll lands inside the window is the scheduler's call. The
    // fs boundary gives the same instant deterministically: the hook runs after the tmp's own `writeFile`
    // resolves and before the `chmod` that used to be the only thing narrowing it. A row that checked
    // only the FINAL file's mode is what let this through, so this one never looks at the final file.
    const dir = mkTemp("m5w-");
    const p = join(dir, "settings.json");
    writeFileSync(p, '{"env":{"SECRET":"shhh"}}\n'); chmodSync(p, 0o600);
    const seen: number[] = [];
    fsHook.afterWriteFile = (path) => { if (path.includes(".tmp-")) seen.push(statSync(path).mode & 0o777); };
    try { await writeTargetDoc(p, { env: { SECRET: "shhh-rotated" } }); } finally { fsHook.afterWriteFile = null; }
    expect(seen).toHaveLength(1); // the tmp really was written and really was sampled
    expect((seen[0] & ~0o600 & 0o777).toString(8)).toBe("0"); // not one bit the destination does not grant
  });
  it("a failure between the write and the rename leaves NO tmp file behind (F1)", async () => {
    // A DIRECTORY at the settings path: `stat` answers, the tmp is written, and the rename fails EISDIR.
    // Nothing removed it, so a failed rename — or a crash in the same gap — parked a copy of the private
    // bytes next to the file indefinitely, at whatever mode the tmp happened to have.
    const dir = mkTemp("m5w-");
    const p = join(dir, "settings.json");
    mkdirSync(p);
    await expect(writeTargetDoc(p, { env: { SECRET: "shhh" } })).rejects.toThrow();
    expect(readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });
  it("a symlinked target resolves: the write lands in the real file, the link survives", async () => {
    const dir = mkTemp("m5w-");
    const real = join(dir, "real.json"), link = join(dir, "link.json");
    writeFileSync(real, "{}\n");
    symlinkSync(real, link);
    expect(await resolveRealTarget(link)).toBe(real);
    // The row used to stop at the resolution and claim the write in its title (review M5). Perform it:
    // the claim worth measuring is that the LINK is still a link afterwards, which is what tmp+rename
    // over the nominal path would have destroyed.
    await writeTargetDoc(await resolveRealTarget(link), { model: "opus" });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({ model: "opus" });
    expect((await readTargetDoc(link)).doc).toEqual({ model: "opus" }); // reachable through the link too
  });
  it("a DANGLING symlink resolves to its target: the link survives its own first write (review I3)", async () => {
    // A dotfile manager or provisioning script links ahead of the first write, so the target does not
    // exist yet and `realpath` cannot answer. Returning the literal path for that case sent tmp+rename
    // at the LINK — it replaced the link with a regular file and the intended target was never created,
    // the exact detachment the resolution exists to prevent.
    const dir = mkTemp("m5w-");
    const real = join(dir, "nested", "real.json"), link = join(dir, "link.json");
    symlinkSync(join("nested", "real.json"), link); // RELATIVE target, resolved against the link's dir
    expect(existsSync(real)).toBe(false);
    expect(await resolveRealTarget(link)).toBe(real);
    await writeTargetDoc(await resolveRealTarget(link), { model: "opus" });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({ model: "opus" });
    // A path that is simply not there is still the literal path — resolution must not invent a target.
    expect(await resolveRealTarget(join(dir, "nope.json"))).toBe(join(dir, "nope.json"));
  });
  it("a readlink failure that is NOT a vanished link refuses — it never answers with the link (F2)", async () => {
    // `lstat` says symlink and `readlink` then fails. Swallowing that returned the LINK's own path, and
    // writeTargetDoc's rename replaced the link with a regular file — I3's detachment exactly, re-entered
    // through the error path. We know a link is there and cannot resolve it, so writing would destroy it.
    const dir = mkTemp("m5w-");
    const link = join(dir, "link.json");
    symlinkSync(join(dir, "nested", "real.json"), link); // dangling, so the walk (not realpath) answers
    fsHook.readlink = (path) => (path === link ? Object.assign(new Error("EACCES: permission denied, readlink"), { code: "EACCES" }) : null);
    try {
      await expect(resolveRealTarget(link)).rejects.toMatchObject({ code: "ConfigValidationError" });
    } finally { fsHook.readlink = null; }
    expect(lstatSync(link).isSymbolicLink()).toBe(true); // refused before anything could write over it
    // The benign half stays benign: the link VANISHED between the lstat and the readlink, so there is
    // nothing left to detach and the literal path is still the right answer.
    fsHook.readlink = (path) => (path === link ? Object.assign(new Error("ENOENT: no such file or directory, readlink"), { code: "ENOENT" }) : null);
    try { expect(await resolveRealTarget(link)).toBe(link); } finally { fsHook.readlink = null; }
  });
  it("a symlink LOOP refuses instead of walking forever", async () => {
    const dir = mkTemp("m5w-");
    symlinkSync(join(dir, "b.json"), join(dir, "a.json"));
    symlinkSync(join(dir, "a.json"), join(dir, "b.json"));
    await expect(resolveRealTarget(join(dir, "a.json"))).rejects.toMatchObject({ code: "ConfigValidationError" });
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
  it("REFUSES at the deadline when a stale lock cannot be broken — it never spins forever", async () => {
    // The reachable hot spin (review C1): the lock is stale AND stable, so the break is attempted, but
    // the unlink FAILS — an immutable lock file, or a lock inside a directory that went read-only. The
    // failure is swallowed, and a `continue` that skipped both the deadline check and the 25ms sleep
    // turned that into an unbounded busy loop: measured still spinning at 7s against a 5.05s deadline,
    // ~7.9s of CPU, ~6.5k iterations/s. The refusal never fired — and because the spin sits inside the
    // in-process chain, every later write to that path queued behind it permanently.
    // ONLY a successful break may skip the retry budget. This row is the assertion whose absence is why
    // C1 shipped: nothing anywhere pinned the refusal, so nothing noticed it was unreachable.
    const dir = mkTemp("m5l-");
    const p = join(dir, "s.json");
    const lock = p + ".lock";
    writeFileSync(lock, "dead-owner");
    fsHook.denyUnlink = (path) => path === lock; // the break is attempted every pass and every pass fails
    const t0 = Date.now();
    const cpu0 = process.cpuUsage();
    const outcome = await Promise.race([
      withFileLock(p, async () => "ran", { staleMs: 0 }).then((v) => `RESOLVED:${v}`, (e: { code?: string; message: string }) => `${e.code}:${e.message}`),
      sleep(9_000, "STILL-SPINNING"),
    ]);
    const elapsed = Date.now() - t0, cpu = process.cpuUsage(cpu0);
    fsHook.denyUnlink = null; // let a sabotaged (deadline-less) build finish instead of spinning past the run
    // `ConfigLocked`, NOT `ConfigValidationError` (M5 Task 4 review I3): the request was well-formed and
    // the target real — another writer holds it. The two codes take different wire codes downstream
    // (BUSY -33001 vs INVALID_PARAMS -32602) precisely because only one of them means "stop retrying".
    expect(outcome).toBe("ConfigLocked:config target is locked by another writer");
    expect(elapsed).toBeGreaterThanOrEqual(5_000); // the deadline is staleMs + 5s — it waited the budget out
    expect(elapsed).toBeLessThan(7_000);           // ...and refused promptly once the budget was spent
    expect((cpu.user + cpu.system) / 1000).toBeLessThan(1_500); // it SLEPT through the wait, it did not burn it
    expect(readFileSync(lock, "utf8")).toBe("dead-owner"); // the unbreakable lock is still exactly as found
  }, 20_000);
  it("release never unlinks a FOREIGN lock (nonce ownership)", async () => {
    const dir = mkTemp("m5l-");
    const p = join(dir, "s.json");
    await withFileLock(p, async () => { writeFileSync(p + ".lock", "foreign-nonce"); }); // steal mid-hold
    expect(readFileSync(p + ".lock", "utf8")).toBe("foreign-nonce"); // OUR release left it alone
  });
});
