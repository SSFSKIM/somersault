// test/unit/prefs.test.ts — bl7 T-ADVISOR task 1: advisorModel round-trips through the ccx-prefs seam
// (src/tui/prefs.ts) exactly like `model` does — type-checked on read (which model ids exist is the
// engine's question, not this file's), dropped rather than coerced on a hand-edited bad value.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { loadPrefs, savePrefs } from "../../src/tui/prefs.js";

describe("prefs.ts advisorModel", () => {
  let dir: string | undefined;
  const env = () => { dir = mkdtempSync(join(tmpdir(), "ccx-prefs-test-")); return { CCX_FLEET_ROOT: dir }; };
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("round-trips a saved advisorModel", () => {
    const e = env();
    savePrefs({ advisorModel: "claude-opus-4-8" }, e);
    expect(loadPrefs(e).advisorModel).toBe("claude-opus-4-8");
  });

  it("is absent by default", () => {
    const e = env();
    expect(loadPrefs(e).advisorModel).toBeUndefined();
  });

  it("drops a hand-edited non-string/empty advisorModel rather than coercing it", () => {
    const e = env();
    savePrefs({ advisorModel: "x" }, e);
    // simulate a hand-edited bad value by writing malformed JSON directly, then reading it back
    writeFileSync(join(dir!, "prefs.json"), JSON.stringify({ advisorModel: 5 }));
    expect(loadPrefs(e).advisorModel).toBeUndefined();
    writeFileSync(join(dir!, "prefs.json"), JSON.stringify({ advisorModel: "" }));
    expect(loadPrefs(e).advisorModel).toBeUndefined();
  });
});
