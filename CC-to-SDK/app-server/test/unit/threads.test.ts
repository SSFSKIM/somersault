import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { recordThread, lookupThread } from "../../src/threads.js";
import { Registry } from "../../src/registry.js";

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
});
