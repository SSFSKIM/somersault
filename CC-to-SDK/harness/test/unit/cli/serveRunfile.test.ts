// cli/serveRunfile.test.ts — `ccx serve`'s run-file cleanup (gap 9), asserted through the real exported
// removeRunFile with a real tmp-dir file. Pure fs, no port/process/signals.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeRunFile } from "../../../src/cli/serveMain.js";

describe("removeRunFile", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ccx-runfile-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("removes an existing run-file", () => {
    const path = join(dir, "appserver.json");
    writeFileSync(path, JSON.stringify({ port: 1234, tokenFile: "/tmp/tok" }));
    expect(existsSync(path)).toBe(true);
    removeRunFile(path);
    expect(existsSync(path)).toBe(false);
  });

  it("does not throw when the run-file is already gone (crashed previous serve, or manual cleanup)", () => {
    const path = join(dir, "missing.json");
    expect(existsSync(path)).toBe(false);
    expect(() => removeRunFile(path)).not.toThrow();
  });
});
