import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCcx } from "../../src/cli/args.js";

describe("parseCcx", () => {
  it("parses doperpowers' exact spawn line", () => {
    const a = parseCcx(["--bg", "--permission-mode", "auto", "-n", "worker-3", "--worktree", "wt", "do the thing"]);
    expect(a).toMatchObject({ command: "run", bg: true, name: "worker-3", worktree: "wt", prompt: "do the thing" });
    expect(a.config.permissionMode).toBe("auto");
  });
  it("parses --settings inline JSON into an object, not the raw string", () => {
    // config/settings.ts spreads this field: a raw string becomes {0:"{",1:'"',…} with no error anywhere.
    const a = parseCcx(["--bg", "--settings", '{"env":{"ANTHROPIC_BASE_URL":"http://localhost:8317"}}', "-n", "w", "x"]);
    expect(a.config.settings).toEqual({ env: { ANTHROPIC_BASE_URL: "http://localhost:8317" } });
    expect({ ...a.config.settings }).toEqual({ env: { ANTHROPIC_BASE_URL: "http://localhost:8317" } });
  });
  it("reads --settings as a file path — doperpowers passes DAEMON_CLAUDE_SETTINGS as a path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccx-settings-"));
    const file = join(dir, "gateway.json");
    writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://localhost:8317" } }));
    try {
      const a = parseCcx(["--bg", "--permission-mode", "auto", "-n", "w", "--settings", file, "x"]);
      expect(a.config.settings).toEqual({ env: { ANTHROPIC_BASE_URL: "http://localhost:8317" } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("throws on a --settings value that is neither JSON nor a readable file", () => {
    expect(() => parseCcx(["--bg", "--settings", "/no/such/settings.json", "x"])).toThrow(/\/no\/such\/settings\.json/);
  });
  it("throws on a --settings file that is not a JSON object", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccx-settings-"));
    const file = join(dir, "broken.json");
    writeFileSync(file, "not json at all");
    try { expect(() => parseCcx(["--bg", "--settings", file, "x"])).toThrow(/broken\.json/); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("throws on a value-taking flag with no value instead of configuring nothing", () => {
    // A dangling --permission-mode/--settings used to silently configure the field with no value at
    // all rather than fail loudly on an unattended worker.
    expect(() => parseCcx(["--bg", "-n", "w", "--permission-mode"])).toThrow(/--permission-mode/);
    expect(() => parseCcx(["--bg", "-n", "w", "--settings"])).toThrow(/--settings/);
    expect(() => parseCcx(["--bg", "--name"])).toThrow(/--name/);
  });
  it("rejects a permission mode outside the union", () => {
    // resolveOptions forwards the value as-is and gates the auto-model repair on `=== "auto"`, so a
    // near-miss ships an invalid mode straight to the SDK and skips the repair.
    expect(() => parseCcx(["--bg", "--permission-mode", "Auto", "x"])).toThrow(/Auto/);
    expect(() => parseCcx(["--bg", "--permission-mode", "yolo", "x"])).toThrow(/permission-mode/);
    expect(() => parseCcx(["--bg", "--permission-mode", "constructor", "x"])).toThrow(/constructor/);
  });
  it("parses --model and --effort, and rejects an effort outside the union", () => {
    const a = parseCcx(["--bg", "-n", "w", "--model", "claude-opus-4-8", "--effort", "xhigh", "x"]);
    expect(a.config.model).toBe("claude-opus-4-8");
    expect(a.config.effort).toBe("xhigh");
    expect(() => parseCcx(["--bg", "--effort", "extreme", "x"])).toThrow(/extreme/);
  });
  it("parses --idle-timeout into idleTimeoutSec — grammar only, no --detachable requirement here", () => {
    // The "only with --detachable" policy lives in main.ts's switch (Task 8), not the parser: the
    // detached child re-parses its OWN argv without --detachable but WITH this forwarded flag, so a
    // grammar-level rule would kill every detachable child at startup.
    expect(parseCcx(["--detachable", "--idle-timeout", "30"])).toMatchObject({ idleTimeoutSec: 30 });
    expect(parseCcx(["--bg", "--idle-timeout", "30", "x"])).toMatchObject({ idleTimeoutSec: 30 });
  });
  it("rejects a non-integer, zero or negative --idle-timeout", () => {
    expect(() => parseCcx(["--idle-timeout", "0", "x"])).toThrow(/--idle-timeout requires a positive integer/);
    expect(() => parseCcx(["--idle-timeout", "-5", "x"])).toThrow(/--idle-timeout requires a positive integer/);
    expect(() => parseCcx(["--idle-timeout", "3.5", "x"])).toThrow(/--idle-timeout requires a positive integer/);
    expect(() => parseCcx(["--idle-timeout", "soon", "x"])).toThrow(/--idle-timeout requires a positive integer/);
  });
  it("throws on a dangling --idle-timeout with no value", () => {
    expect(() => parseCcx(["--idle-timeout"])).toThrow(/--idle-timeout/);
  });
  it("throws on a second positional rather than running an agent on the first word", () => {
    expect(() => parseCcx(["fix", "the", "bug"])).toThrow(/the/);
    expect(() => parseCcx(["stop", "a1b2c3d4", "e5f6a7b8"])).toThrow(/e5f6a7b8/);
  });
  it("parses the resume fork", () => {
    const a = parseCcx(["--bg", "--resume", "uuid-1", "-n", "w", "next"]);
    expect(a.config.resume).toBe("uuid-1"); expect(a.bg).toBe(true);
  });
  it("parses -c / --continue (A10)", () => {
    expect(parseCcx(["-c"]).continue).toBe(true);
    expect(parseCcx(["--continue"]).continue).toBe(true);
    expect(parseCcx([]).continue).toBe(false);
  });
  it("parses subcommands with their flags", () => {
    expect(parseCcx(["agents", "--json", "--all"])).toMatchObject({ command: "agents", json: true, all: true });
    expect(parseCcx(["agents", "--cwd", "/repo"])).toMatchObject({ command: "agents", cwdFilter: "/repo" });
    expect(parseCcx(["stop", "a1b2c3d4"])).toMatchObject({ command: "stop", target: "a1b2c3d4" });
    expect(parseCcx(["rm", "a1b2c3d4"])).toMatchObject({ command: "rm", target: "a1b2c3d4" });
    expect(parseCcx(["attach", "a1b2c3d4"])).toMatchObject({ command: "attach", target: "a1b2c3d4" });
    expect(parseCcx(["fleet", "gc"])).toMatchObject({ command: "gc" });
  });
  it("parses -p and --detachable", () => {
    expect(parseCcx(["-p", "hello"])).toMatchObject({ command: "run", print: true, prompt: "hello" });
    expect(parseCcx(["--detachable"])).toMatchObject({ command: "run", detachable: true });
  });
  it("fails loudly on a recognized-but-unsupported flag", () => {
    // A silently ignored --permission-mode in a background worker is a safety bug, not a UX wart.
    expect(() => parseCcx(["--bg", "--remote-control", "x"])).toThrow(/--remote-control/);
  });
  it("fails on an unknown flag rather than treating it as the prompt", () => {
    expect(() => parseCcx(["--nope"])).toThrow(/--nope/);
  });
  it("parses --think with a level name or a raw token count", () => {
    expect(parseCcx(["--think", "high", "x"])).toMatchObject({ think: "high" });
    expect(parseCcx(["--think", "off", "x"])).toMatchObject({ think: "off" });
    expect(parseCcx(["--think", "12000", "x"])).toMatchObject({ think: "12000" });
  });
  it("rejects an unknown --think level", () => {
    expect(() => parseCcx(["--think", "extreme", "x"])).toThrow(/--think/);
  });
  it("throws on a dangling --think with no value", () => {
    expect(() => parseCcx(["--think"])).toThrow(/--think/);
  });
});
