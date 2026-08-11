// test/unit/paste-cache.test.ts — F5 task 5, the on-disk half. Pins transcribed from the 2.1.220 bundle:
//  · `RUd` (L317317) sha256, hex, first 16 chars — NOT the full digest
//  · `MUd` (L317321) `${hash}.txt` inside the cache dir
//  · `ru_` (L317324) mkdir -p, mode 0o600 (upstream's literal `384`), every failure swallowed
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPaste, pasteCacheDir, pasteHash, pastePath, storePaste } from "../../src/tui/pasteCache.js";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-paste-")) }; });
afterEach(() => { rmSync(env.CCX_FLEET_ROOT!, { recursive: true, force: true }); });

describe("pasteHash — RUd", () => {
  it("is the first 16 hex chars of the sha256, not the whole digest", () => {
    const h = pasteHash("hello");
    expect(h).toBe(createHash("sha256").update("hello").digest("hex").slice(0, 16));
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
  it("is content-addressed: same content → same key, one byte apart → different", () => {
    expect(pasteHash("a\nb")).toBe(pasteHash("a\nb"));
    expect(pasteHash("a\nb")).not.toBe(pasteHash("a\nc"));
  });
  it("hashes the bytes, so a multibyte payload is stable", () => { expect(pasteHash("héllo…")).toHaveLength(16); });
});

describe("paths — MUd, under the fleet root", () => {
  it("puts the cache beside the roster, in its own `paste-cache` segment", () => {
    expect(pasteCacheDir(env)).toBe(join(env.CCX_FLEET_ROOT!, "paste-cache"));
    expect(pastePath("0123456789abcdef", env)).toBe(join(env.CCX_FLEET_ROOT!, "paste-cache", "0123456789abcdef.txt"));
  });
});

describe("storePaste / loadPaste", () => {
  it("round-trips content through the hash", () => {
    const body = "line one\nline two\n" + "x".repeat(900);
    storePaste(body, env);
    expect(loadPaste(pasteHash(body), env)).toBe(body);
  });
  it("round-trips leading/trailing whitespace byte-exactly (t5 review: a trailing newline is the common real shape)", () => {
    const body = "\n  body with edges  \n";
    storePaste(body, env);
    expect(loadPaste(pasteHash(body), env)).toBe(body);
  });
  it("creates the directory it needs (mkdir -p, first run)", () => {
    expect(existsSync(pasteCacheDir(env))).toBe(false);
    storePaste("body", env);
    expect(existsSync(pasteCacheDir(env))).toBe(true);
  });
  it("writes the file 0600 — a paste can hold a secret the user never meant to publish", () => {
    storePaste("token=sk-live-1", env);
    expect(statSync(pastePath(pasteHash("token=sk-live-1"), env)).mode & 0o777).toBe(0o600);
  });
  it("writes UNCONDITIONALLY: an existing file for the same hash is rewritten, not skipped", () => {
    const p = pastePath(pasteHash("body"), env);
    storePaste("body", env);
    writeFileSync(p, "TAMPERED");
    storePaste("body", env);
    expect(readFileSync(p, "utf8")).toBe("body");
  });
  it("preserves an empty-string payload rather than confusing it with a miss", () => {
    storePaste("", env);
    expect(loadPaste(pasteHash(""), env)).toBe("");
  });
  it("returns null for a hash that was never stored", () => { expect(loadPaste("deadbeefdeadbeef", env)).toBeNull(); });
  it("swallows an unwritable root instead of throwing into the keystroke handler", () => {
    // The root's PARENT is a regular file, so mkdir fails ENOTDIR — the closest thing to a read-only
    // home we can build without root. A paste must still land in the buffer when the cache cannot.
    const file = join(env.CCX_FLEET_ROOT!, "not-a-dir");
    writeFileSync(file, "x");
    const broken = { CCX_FLEET_ROOT: join(file, "nested") };
    expect(() => storePaste("body", broken)).not.toThrow();
    expect(loadPaste(pasteHash("body"), broken)).toBeNull();
  });
  it("loadPaste returns null on a directory sitting where the file should be", () => {
    mkdirSync(pastePath("0000000000000000", env), { recursive: true });
    expect(loadPaste("0000000000000000", env)).toBeNull();
  });
});
