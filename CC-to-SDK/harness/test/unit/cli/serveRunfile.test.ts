// cli/serveRunfile.test.ts — `ccx serve`'s run-file cleanup (gap 9), asserted through the real exported
// removeRunFile with a real tmp-dir file. Pure fs, no port/process/signals.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeRunFile } from "../../../src/cli/serveMain.js";

describe("removeRunFile", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ccx-runfile-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("removes an existing run-file whose recorded port matches ours", () => {
    const path = join(dir, "appserver.json");
    writeFileSync(path, JSON.stringify({ port: 1234, tokenFile: "/tmp/tok" }));
    expect(existsSync(path)).toBe(true);
    removeRunFile(path, 1234);
    expect(existsSync(path)).toBe(false);
  });

  it("does not throw when the run-file is already gone (crashed previous serve, or manual cleanup)", () => {
    const path = join(dir, "missing.json");
    expect(existsSync(path)).toBe(false);
    expect(() => removeRunFile(path, 1234)).not.toThrow();
  });

  it("leaves the file intact when its recorded port belongs to a different (later, still-live) server", () => {
    const path = join(dir, "appserver.json");
    const contents = JSON.stringify({ port: 5678, tokenFile: "/tmp/tok" });
    writeFileSync(path, contents);
    removeRunFile(path, 1234); // we are the stale first server; 5678 is the live second server
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(contents);
  });

  it("leaves an unparseable run-file intact and does not throw", () => {
    const path = join(dir, "appserver.json");
    writeFileSync(path, "not json");
    expect(() => removeRunFile(path, 1234)).not.toThrow();
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("not json");
  });

  it("leaves a run-file with no numeric port intact and does not throw", () => {
    const path = join(dir, "appserver.json");
    const contents = JSON.stringify({ tokenFile: "/tmp/tok" });
    writeFileSync(path, contents);
    expect(() => removeRunFile(path, 1234)).not.toThrow();
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(contents);
  });
});
