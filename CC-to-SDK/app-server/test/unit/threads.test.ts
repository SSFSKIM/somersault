import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { Registry } from "../../src/registry.js";

// Forces recordThread's renameSync (the atomic-commit step) to fail on demand, so we can prove a
// crash mid-write leaves the previous threads.json untouched instead of truncated/corrupt.
let failRename = false;
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: (...args: Parameters<typeof actual.renameSync>) => {
    if (failRename) throw new Error("simulated crash mid-write");
    return actual.renameSync(...args);
  } };
});

import { recordThread, lookupThread } from "../../src/threads.js";

describe("threads sidecar", () => {
  it("records and looks up across instances; unknown -> undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccas-"));
    recordThread("thr_ab12cd34", "sdk_123", "/w", dir);
    expect(lookupThread("thr_ab12cd34", dir)).toMatchObject({ sessionId: "sdk_123", cwd: "/w" });
    expect(lookupThread("thr_nope", dir)).toBeUndefined();
  });
  it("prunes to 200 newest", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccas-"));
    for (let i = 0; i < 210; i++) recordThread(`thr_${String(i).padStart(8, "0")}`, `s${i}`, "/w", dir);
    expect(lookupThread("thr_00000005", dir)).toBeUndefined();
    expect(lookupThread("thr_00000209", dir)).toBeDefined();
  });
  it("allocId is random-unique across Registry instances", () => {
    const a = new Registry().allocId(), b = new Registry().allocId();
    expect(a).toMatch(/^thr_[0-9a-f]{8}$/); expect(a).not.toBe(b);
  });
  it("atomic write: a crash during commit (rename) leaves the prior threads.json intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccas-"));
    recordThread("thr_first000", "sdk_first", "/w", dir);
    const before = readFileSync(join(dir, "threads.json"), "utf8");
    failRename = true;
    expect(() => recordThread("thr_second00", "sdk_second", "/w", dir)).toThrow("simulated crash mid-write");
    failRename = false;
    // the failed commit never replaced threads.json — it's byte-identical to before the crash
    expect(readFileSync(join(dir, "threads.json"), "utf8")).toBe(before);
    expect(lookupThread("thr_first000", dir)).toMatchObject({ sessionId: "sdk_first" });
    expect(lookupThread("thr_second00", dir)).toBeUndefined();
    // and a subsequent successful call still commits cleanly (mock reset correctly, no lingering state)
    recordThread("thr_second00", "sdk_second", "/w", dir);
    expect(lookupThread("thr_second00", dir)).toMatchObject({ sessionId: "sdk_second" });
  });
});
